"""Export the fixed adapted checkpoint and verify float/q8 scores, without retuning."""
import json
import time
from pathlib import Path

import numpy as np
import onnx
import onnxruntime as ort
from onnxruntime.quantization import QuantType, quantize_dynamic
import torch
from safetensors.torch import load_file
from transformers import ElectraConfig, ElectraModel, ElectraTokenizerFast

from prepare import MODEL, REVISION, ROOT, digest, verify
from train import DIRECTORY, Ranker, tokenize, labels, score


def main():
    torch.set_num_threads(4)
    torch.set_num_interop_threads(1)
    checkpoint = DIRECTORY/'full-ranker.safetensors'
    training = json.loads(Path('eval/dom-adaptation/finetune/report.json').read_text(encoding='utf-8'))
    assert digest(checkpoint) == training['fullEncoder']['checkpoint']['sha256']
    verify()
    for path, expected in training['dataSha256'].items():
        assert digest(Path(path)) == expected, path
    config = ElectraConfig.from_pretrained(ROOT,local_files_only=True)
    config._attn_implementation = 'eager'
    model = Ranker(ElectraModel(config))
    model.load_state_dict(load_file(checkpoint))
    model.eval()
    tokenizer = ElectraTokenizerFast.from_pretrained(ROOT,local_files_only=True)
    rows, _ = tokenize(DIRECTORY/'holdout-inputs.json',tokenizer)
    sample = tuple(rows[0]['inputs'][name] for name in ['input_ids','attention_mask','token_type_ids'])
    fp = DIRECTORY/'full-ranker-fp32.onnx'
    q8 = DIRECTORY/'full-ranker-q8.onnx'
    started = time.perf_counter()
    torch.onnx.export(model,sample,str(fp),input_names=['input_ids','attention_mask','token_type_ids'],output_names=['scores'],dynamic_axes={**{name:{0:'batch',1:'sequence'} for name in ['input_ids','attention_mask','token_type_ids']},'scores':{0:'batch'}},opset_version=17,dynamo=False)
    onnx.checker.check_model(str(fp))
    quantize_dynamic(str(fp),str(q8),weight_type=QuantType.QInt8,per_channel=True,op_types_to_quantize=['MatMul','Gather'])
    options = ort.SessionOptions()
    options.intra_op_num_threads = 4
    options.inter_op_num_threads = 1
    fp_session = ort.InferenceSession(str(fp),sess_options=options,providers=['CPUExecutionProvider'])
    q8_session = ort.InferenceSession(str(q8),sess_options=options,providers=['CPUExecutionProvider'])
    browser = {'model':{'id':MODEL+'-dom-pilot-q8','revision':REVISION,'sha256':digest(q8),'outputName':'scores','pooling':'logits'},'batches':[],'reference':{}}
    report = {'schemaVersion':1,'sourceSha256':digest(Path(__file__)),'checkpointSha256':digest(checkpoint),'inputsSha256':training['dataSha256'],'fp32':{'bytes':fp.stat().st_size,'sha256':digest(fp)},'q8':{'bytes':q8.stat().st_size,'sha256':digest(q8)},'runtime':'ONNX Runtime native CPU, 4 threads','rows':[],'dynamicChecks':[]}
    for length in [17,129,257,384]:
        generator = torch.Generator().manual_seed(20261113+length)
        ids = torch.randint(100,config.vocab_size,(2,length),generator=generator)
        inputs = {'input_ids':ids,'attention_mask':torch.ones_like(ids),'token_type_ids':torch.zeros_like(ids)}
        feed = {name:value.numpy() for name,value in inputs.items()}
        with torch.no_grad():
            reference = model(**inputs).numpy()
        actual = fp_session.run(['scores'],feed)[0]
        error = float(np.max(np.abs(reference-actual)))
        assert error < 0.0001, (length,error)
        report['dynamicChecks'].append({'length':length,'batch':2,'fp32MaxAbsError':error})
    for row in rows:
        feed = {name:value.numpy() for name,value in row['inputs'].items()}
        with torch.no_grad():
            reference = model(**row['inputs']).numpy()
        actual = fp_session.run(['scores'],feed)[0]
        fp_error = float(np.max(np.abs(reference-actual)))
        assert fp_error < 0.0001
        start = time.perf_counter()
        quantized = q8_session.run(['scores'],feed)[0]
        elapsed = (time.perf_counter()-start)*1000
        assert quantized.shape == (len(row['ids']),) and np.isfinite(quantized).all()
        order = np.argsort(-quantized)
        selected = '__none__' if len(order)>1 and quantized[order[0]] == quantized[order[1]] else row['ids'][order[0]]
        report['rows'].append({'id':row['id'],'field':row['field'],'candidateIds':row['ids'],'fp32Scores':actual.tolist(),'scores':quantized.tolist(),'selected':selected,'fp32MaxAbsError':fp_error,'q8MaxAbsError':float(np.max(np.abs(reference-quantized))),'inferenceMs':elapsed})
        browser['batches'].append({'id':row['id'],'pairIds':[row['id']+'::'+candidate for candidate in row['ids']],'repeats':1,'inputs':{name:{'type':'int64','dims':list(value.shape),'data':value.reshape(-1).tolist()} for name,value in feed.items()}})
        browser['reference'][row['id']] = quantized.tolist()
    report['retrospectiveScore'] = score(report['rows'],labels('eval/light-dom/data/holdout-labels.json'))
    report['elapsedMs'] = (time.perf_counter()-started)*1000
    report['finishedAt'] = time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())
    Path('eval/dom-adaptation/finetune/export-report.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8',newline='\n')
    (DIRECTORY/'browser-jobs.json').write_text(json.dumps(browser,separators=(',',':'))+'\n',encoding='utf-8',newline='\n')
    print(json.dumps({'q8Bytes':report['q8']['bytes'],'score':report['retrospectiveScore'],'maxQ8LogitError':max(row['q8MaxAbsError'] for row in report['rows'])}))


if __name__ == '__main__':
    main()
