"""Export all fixed models and compare q8/full-field/microbatch readouts on development only."""
import argparse
import json
import time
from pathlib import Path

import numpy as np
import onnx
import onnxruntime as ort
from onnxruntime.quantization import QuantType, quantize_dynamic
import torch
from safetensors.torch import load_file

from shared import MODEL, REVISION, BASE, RECIPES, digest, read, write, verify_base, empty_model, tokenizer, tokenize, choose, score


def tensor_data(value):
    return {'type':'int64','dims':list(value.shape),'data':value.reshape(-1).tolist()}


def verify_freeze(path):
    freeze=read(path)
    for source,expected in freeze['sources'].items():
        assert digest(source)==expected, source
    for model in freeze['models'].values(): assert digest(model['path'])==model['sha256']
    return freeze


def onnx_predictions(session, rows, microbatch=None):
    results=[]
    for row in rows:
        if row.get('error'):
            results.append({'id':row['id'],'field':row['field'],'candidateIds':row['ids'],'error':row['error']});continue
        if row['ids']==['__none__']:
            results.append({'id':row['id'],'field':row['field'],'candidateIds':row['ids'],'scores':[0.0],'selected':'__none__','inferenceMs':0.0,'automaticNone':True});continue
        start=time.perf_counter();scores=[]
        size=microbatch or len(row['ids'])
        for offset in range(0,len(row['ids']),size):
            feed={name:value[offset:offset+size].numpy() for name,value in row['inputs'].items()}
            # Trim only right padding, never attended content. This reduces scratch memory.
            length=int(feed['attention_mask'].sum(axis=1).max())
            feed={name:value[:,:length] for name,value in feed.items()}
            values=session.run(['scores'],feed)[0]
            assert values.shape==(min(size,len(row['ids'])-offset),) and np.isfinite(values).all()
            scores.extend(values.tolist())
        results.append({'id':row['id'],'field':row['field'],'candidateIds':row['ids'],'scores':scores,'selected':choose(row['ids'],scores),'inferenceMs':(time.perf_counter()-start)*1000})
    return results


def browser_plan(rows, model_meta, reference, microbatch=None):
    plan={'schemaVersion':2,'model':model_meta,'microbatch':microbatch,'batches':[],'cases':[],'autoCases':[],'reference':{},'tokenization':[]}
    by_id={row['id']:row for row in reference}
    for row in rows:
        case={'id':row['id'],'field':row['field'],'candidateIds':row['ids'],'batchIds':[]}
        if row.get('error'):
            case['error']=row['error'];plan['cases'].append(case);continue
        if row['ids']==['__none__']:
            plan['autoCases'].append({'id':row['id'],'field':row['field'],'selected':'__none__'});plan['cases'].append(case);continue
        size=microbatch or len(row['ids'])
        for offset in range(0,len(row['ids']),size):
            batch_id=f"{row['id']}::batch-{offset//size}"
            feed={name:value[offset:offset+size].numpy() for name,value in row['inputs'].items()}
            length=int(feed['attention_mask'].sum(axis=1).max());feed={name:value[:,:length] for name,value in feed.items()}
            candidate_ids=row['ids'][offset:offset+size]
            batch={'id':batch_id,'caseId':row['id'],'candidateIds':candidate_ids,'pairIds':[row['id']+'::'+candidate for candidate in candidate_ids],'repeats':1,'inputs':{name:tensor_data(value) for name,value in feed.items()}}
            plan['batches'].append(batch);case['batchIds'].append(batch_id)
            plan['reference'][batch_id]=by_id[row['id']]['scores'][offset:offset+size]
            plan['tokenization'].append({'batchId':batch_id,'pairs':row['pairs'][offset:offset+size],'paddingLength':length})
        plan['cases'].append(case)
    return plan


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--plans',required=True)
    parser.add_argument('--labels',required=True)
    parser.add_argument('--output',default='eval/dom-scale/model')
    parser.add_argument('--artifacts',default='.tmp/dom-scale/model/exports')
    args=parser.parse_args()
    output=Path(args.output);artifact=Path(args.artifacts);artifact.mkdir(parents=True,exist_ok=True)
    freeze=verify_freeze(output/'model-freeze.json')
    training=read(output/'training.json');assert digest(output/'training.json')==freeze['trainingSha256']
    design=read(output/'design.json');assert digest(output/'design.json')==freeze['designSha256']
    assert digest(args.labels)==design['data'][args.labels]
    gold_all={row['id']:row.get('acceptedIds') or [row['expectedId']] for row in read(args.labels)}
    ids=design['split']['validationIds'];gold={key:gold_all[key] for key in ids}
    torch.set_num_threads(4);torch.set_num_interop_threads(1)
    verify_base();tok=tokenizer();results=[]
    for recipe in RECIPES:
        begin=time.perf_counter()
        model=empty_model(recipe);model.load_state_dict(load_file(freeze['models'][recipe]['path']));model.eval()
        raw_plan=read(Path(args.plans)/(recipe+'.json'));assert digest(Path(args.plans)/(recipe+'.json'))==design['plans'][recipe]
        all_rows,_=tokenize(raw_plan,tok);by_id={row['id']:row for row in all_rows};rows=[by_id[key] for key in ids]
        sample=next(row for row in rows if len(row['ids'])>1)
        fp=artifact/(recipe+'-fp32.onnx');q8=artifact/(recipe+'-q8.onnx')
        torch.onnx.export(model,tuple(sample['inputs'][name] for name in ['input_ids','attention_mask','token_type_ids']),str(fp),input_names=['input_ids','attention_mask','token_type_ids'],output_names=['scores'],dynamic_axes={**{name:{0:'batch',1:'sequence'} for name in ['input_ids','attention_mask','token_type_ids']},'scores':{0:'batch'}},opset_version=17,dynamo=False)
        onnx.checker.check_model(str(fp))
        quantize_dynamic(str(fp),str(q8),weight_type=QuantType.QInt8,per_channel=True,op_types_to_quantize=['MatMul','Gather'])
        options=ort.SessionOptions();options.intra_op_num_threads=4;options.inter_op_num_threads=1
        fp_session=ort.InferenceSession(str(fp),sess_options=options,providers=['CPUExecutionProvider'])
        session=ort.InferenceSession(str(q8),sess_options=options,providers=['CPUExecutionProvider'])
        checks=[]
        for length in sorted(set([17,81,RECIPES[recipe]['maximumTokens']])):
            for count in [1,2,13]:
                generator=torch.Generator().manual_seed(20261114+length+count)
                values=torch.randint(100,model.encoder.config.vocab_size,(count,length),generator=generator)
                inputs={'input_ids':values,'attention_mask':torch.ones_like(values),'token_type_ids':torch.zeros_like(values)}
                with torch.inference_mode(): expected=model(**inputs).numpy()
                actual=fp_session.run(['scores'],{name:value.numpy() for name,value in inputs.items()})[0]
                error=float(np.max(np.abs(expected-actual)));assert error<0.0001,(recipe,length,count,error)
                checks.append({'length':length,'batch':count,'fp32MaximumError':error})
        reference=onnx_predictions(fp_session,rows)
        quantized=onnx_predictions(session,rows)
        chunked=onnx_predictions(session,rows,2)
        model_meta={'id':MODEL+'-dom-scale-'+recipe,'revision':REVISION,'recipe':recipe,'sha256':digest(q8),'outputName':'scores','pooling':'logits'}
        plans_dir=output/'browser-plans';plans_dir.mkdir(exist_ok=True)
        write(plans_dir/(recipe+'-full.json'),browser_plan(rows,model_meta,quantized))
        write(plans_dir/(recipe+'-micro2.json'),browser_plan(rows,model_meta,chunked,2))
        result={'recipe':recipe,'modelPath':str(q8),'fp32':{'bytes':fp.stat().st_size,'sha256':digest(fp)},'q8':{'bytes':q8.stat().st_size,'sha256':digest(q8)},'dynamicChecks':checks,'validationFp32Predictions':reference,'validationQ8Predictions':quantized,'validationMicro2Predictions':chunked,'validationFp32Score':score(reference,gold),'validationQ8Score':score(quantized,gold),'validationMicro2Score':score(chunked,gold),'q8SameChoices':sum(a['selected']==b['selected'] for a,b in zip(reference,quantized)),'micro2SameChoices':sum(a['selected']==b['selected'] for a,b in zip(quantized,chunked)),'q8MaximumLogitDifference':max(abs(x-y) for a,b in zip(reference,quantized) for x,y in zip(a['scores'],b['scores'])),'micro2MaximumLogitDifference':max(abs(x-y) for a,b in zip(quantized,chunked) for x,y in zip(a['scores'],b['scores'])),'elapsedMs':(time.perf_counter()-begin)*1000}
        results.append(result);write(output/(recipe+'-export.json'),result)
        print(json.dumps({'recipe':recipe,'bytes':result['q8']['bytes'],'q8':result['validationQ8Score'],'micro2SameChoices':result['micro2SameChoices']}),flush=True)
    write(output/'exports.json',{'schemaVersion':1,'freezeSha256':digest(output/'model-freeze.json'),'sourceSha256':digest(__file__),'models':results,'tokenizer':{name:{'bytes':(BASE/name).stat().st_size,'sha256':digest(BASE/name)} for name in ['vocab.txt','tokenizer_config.json']},'finishedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())})


if __name__=='__main__':main()
