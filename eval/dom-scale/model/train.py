"""Train fixed architecture/input ablations using work-group development split only."""
import argparse
import gc
import hashlib
import importlib.metadata
import json
import random
import time
from pathlib import Path
from urllib.parse import urlparse

import numpy as np
import torch
from safetensors.torch import save_file

from shared import MODEL, REVISION, SEED, RECIPES, PINNED_SOURCE, digest, read, write, verify_base, initialize, tokenizer, tokenize, loss, choose, score

SOURCE = Path('eval/dom-scale/model')
ALLOWED = ['laftel.net','aniplustv.com','crunchyroll.com','primevideo.com','wavve.com','tving.com','coupangplay.com','watcha.com']


def predictions(model, rows, microbatch=None):
    model.eval()
    output = []
    with torch.inference_mode():
        for row in rows:
            if row.get('error'):
                output.append({'id': row['id'], 'field': row['field'], 'candidateIds': row['ids'], 'error': row['error']})
                continue
            start = time.perf_counter()
            chunks = []
            size = microbatch or len(row['ids'])
            for offset in range(0, len(row['ids']), size):
                batch = {name: value[offset:offset+size] for name,value in row['inputs'].items()}
                chunks.extend(model(**batch).tolist())
            output.append({'id': row['id'], 'field': row['field'], 'candidateIds': row['ids'], 'scores': chunks, 'selected': choose(row['ids'],chunks), 'inferenceMs': (time.perf_counter()-start)*1000})
    return output


def duplicate_negative_pages(inputs, gold, compact_plan):
    """Deduplicate complete negative pages with identical model-visible facts only."""
    by_input={row['id']:row for row in inputs}
    by_plan={row['id']:row for row in compact_plan['cases']}
    pages={}
    for label in gold: pages.setdefault(label['provenance']['pageId'],[]).append(label)
    buckets={}
    for page_id,labels in pages.items():
        if len(labels)!=3 or {by_input[row['id']]['field'] for row in labels}!={'title','image','description'}: continue
        if any(row.get('quality',{}).get('excludeFromTraining') or row.get('missingGold') or (row.get('acceptedIds') or [row['expectedId']])!=['__none__'] for row in labels): continue
        provider=labels[0]['provenance'].get('provider') or urlparse(labels[0]['provenance']['url']).hostname
        fields=[]
        for label in sorted(labels,key=lambda row:by_input[row['id']]['field']):
            planned=by_plan[label['id']]
            # Candidate ID and order are mapping data, not model-visible content.
            candidates=sorted(json.dumps(row['variants'],sort_keys=True,ensure_ascii=False) for row in planned['candidates'])
            fields.append({'field':planned['field'],'candidates':candidates})
        signature=hashlib.sha256(json.dumps({'provider':provider,'fields':fields},sort_keys=True,ensure_ascii=False).encode('utf-8')).hexdigest()
        buckets.setdefault(signature,[]).append({'pageId':page_id,'caseIds':[row['id'] for row in labels]})
    groups=[]
    for signature,pages in buckets.items():
        if len(pages)<2:continue
        ordered=sorted(pages,key=lambda row:row['pageId'])
        groups.append({'modelRepresentationSha256':signature,'canonicalPageId':ordered[0]['pageId'],'canonicalCaseIds':ordered[0]['caseIds'],'excludedPages':ordered[1:]})
    return groups


def split_records(inputs, gold, reserved_work_hashes=(), negative_duplicates=()):
    assert len(inputs) == len({row['id'] for row in inputs})
    assert len(gold) == len({row['id'] for row in gold})
    assert {row['id'] for row in inputs} == {row['id'] for row in gold}
    by_input = {row['id']: row for row in inputs}
    eligible, excluded, groups, accepted_in_pool = [], [], {}, {}
    duplicate_lookup={case_id:group['canonicalPageId'] for group in negative_duplicates for page in group['excludedPages'] for case_id in page['caseIds']}
    for label in gold:
        source = label['provenance']
        assert hashlib.sha256(source['work'].encode('utf-8')).hexdigest() not in reserved_work_hashes, 'Reserved held-out work entered training/development'
        if label.get('quality',{}).get('excludeFromTraining'):
            missing=label.get('quality',{}).get('allAcceptedOutsidePool') or label.get('quality',{}).get('collectorMiss')
            excluded.append({'id':label['id'],'reason':'annotated target outside bounded candidate pool' if missing else 'collector flagged duplicate or unsuitable training observation','duplicateOf':source.get('duplicateOf'),'missingIds':(label.get('acceptedIds') or [label['expectedId']]) if missing else []})
            continue
        if label['id'] in duplicate_lookup:
            excluded.append({'id':label['id'],'reason':'identical whole-negative-page model-visible representation','duplicateOf':duplicate_lookup[label['id']]})
            continue
        host = urlparse(source['url']).hostname
        assert any(host == domain or host.endswith('.'+domain) for domain in ALLOWED), f'Held-out/unmapped provider in training: {host}'
        observed_host = urlparse(by_input[label['id']]['pageEvidence']['url']).hostname
        if not observed_host or not any(observed_host == domain or observed_host.endswith('.'+domain) for domain in ALLOWED):
            excluded.append({'id':label['id'],'reason':'navigation did not capture a supported service origin','observedHost':observed_host})
            continue
        accepted = label.get('acceptedIds') or [label['expectedId']]
        options = {row['id'] for row in by_input[label['id']]['options']}
        missing = [value for value in accepted if value not in options]
        present = [value for value in accepted if value in options]
        if not present:
            # Never fabricate a target in a bounded pool. Keep explicit exclusions.
            assert label.get('missingGold') or label.get('quality',{}).get('missingGold') or label.get('quality',{}).get('allAcceptedOutsidePool') or label.get('quality',{}).get('expectedOutsidePool')
            excluded.append({'id': label['id'], 'reason':'annotated target outside bounded candidate pool', 'missingIds':missing})
            continue
        accepted_in_pool[label['id']]=present
        work = source['work']
        assert source['pageId'] and work
        group = 'page:'+source['pageId'] if work.startswith('none-') else 'work:'+work
        groups.setdefault(group,[]).append(label['id'])
        eligible.append(label['id'])
    # Deterministic grouping fixed without predictions, same work in all views/providers.
    ordered = sorted(groups, key=lambda group: hashlib.sha256(f'{SEED}:{group}'.encode()).hexdigest())
    assert len(ordered) >= 5, 'At least five work/page groups required'
    validation_groups = set(ordered[::5])
    train_ids = sorted(key for group,ids in groups.items() if group not in validation_groups for key in ids)
    validation_ids = sorted(key for group,ids in groups.items() if group in validation_groups for key in ids)
    assert not set(train_ids)&set(validation_ids) and set(train_ids)|set(validation_ids) == set(eligible)
    return {'seed':SEED,'method':'SHA256-seeded work/page groups; every fifth group validates; no prediction-based stratification','groups':groups,'trainIds':train_ids,'validationIds':validation_ids,'acceptedInPool':accepted_in_pool,'excluded':excluded,'wholeNegativePageDuplicates':negative_duplicates}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--inputs',required=True)
    parser.add_argument('--labels',required=True)
    parser.add_argument('--plans',required=True)
    parser.add_argument('--reserved-work-hashes',required=True)
    parser.add_argument('--output',default='eval/dom-scale/model')
    parser.add_argument('--weights',default='.tmp/dom-scale/model/weights')
    args=parser.parse_args()
    output, weights = Path(args.output), Path(args.weights)
    if (output/'training.json').exists(): raise ValueError('Refuse to overwrite completed run')
    torch.set_num_threads(4)
    torch.set_num_interop_threads(1)
    torch.use_deterministic_algorithms(True)
    random.seed(SEED); np.random.seed(SEED); torch.manual_seed(SEED)
    files = verify_base()
    tok = tokenizer()
    inputs, annotations = read(args.inputs), read(args.labels)
    reserved = read(args.reserved_work_hashes)
    assert reserved['algorithm']=='sha256-utf8-canonical-work-key'
    assert reserved['workHashes'] and len(reserved['workHashes'])==len(set(reserved['workHashes']))
    assert all(len(value)==64 and all(c in '0123456789abcdef' for c in value) for value in reserved['workHashes'])
    duplicates=duplicate_negative_pages(inputs,annotations,read(Path(args.plans)/'full-compact.json'))
    split = split_records(inputs, annotations, set(reserved['workHashes']),duplicates)
    gold_all = {row['id']: row.get('acceptedIds') or [row['expectedId']] for row in annotations}
    all_rows, audits = {}, {}
    for recipe in RECIPES:
        plan=read(Path(args.plans)/(recipe+'.json'))
        assert plan['inputsSha256'] == digest(args.inputs)
        assert plan['representationSha256'] == digest(SOURCE/'representation.mjs')
        all_rows[recipe], audits[recipe] = tokenize(plan,tok)
    common_sources = [SOURCE/'train.py',SOURCE/'shared.py',SOURCE/'representation.mjs',SOURCE/'prepare-inputs.mjs',SOURCE/'export.py',SOURCE/'predict.py',PINNED_SOURCE,Path('eval/tiny-decision/v2/features.mjs'),Path('eval/dom-adaptation/templates.mjs')]
    design = {
        'schemaVersion':1,'model':MODEL,'revision':REVISION,'files':files,'seed':SEED,
        'sources':{str(path).replace('\\','/'):digest(path) for path in common_sources},
        'data':{args.inputs:digest(args.inputs),args.labels:digest(args.labels)},
        'reservedWorkManifest':{'path':args.reserved_work_hashes,'sha256':digest(args.reserved_work_hashes),'groups':len(reserved['workHashes'])},
        'plans':{recipe:digest(Path(args.plans)/(recipe+'.json')) for recipe in RECIPES},
        'recipes':RECIPES,'split':split,
        'optimizer':{'name':'AdamW','encoderLearningRate':2e-5,'headLearningRate':1e-3,'weightDecay':0.01,'gradientClip':1.0,'epochs':3,'caseBatch':'complete candidate list','dropout':'original encoder training dropout'},
        'selection':'validation correct descending, false selections ascending, parameter count ascending, recipe ID; final epoch only',
        'tokenAudit':audits,
        'versions':{name:importlib.metadata.version(name) for name in ['torch','transformers','numpy','tokenizers','safetensors']},
        'frozenAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),
    }
    write(output/'design.json',design)
    weights.mkdir(parents=True,exist_ok=True)
    results=[]
    for recipe in RECIPES:
        random.seed(SEED); np.random.seed(SEED); torch.manual_seed(SEED)
        model=initialize(recipe)
        by_id={row['id']:row for row in all_rows[recipe]}
        train=[by_id[key] for key in split['trainIds']]
        validation=[by_id[key] for key in split['validationIds']]
        for row in train: row['accepted']=[row['ids'].index(value) for value in split['acceptedInPool'][row['id']]]
        optimizer=torch.optim.AdamW([{'params':model.encoder.parameters(),'lr':2e-5},{'params':model.rank.parameters(),'lr':1e-3}],weight_decay=0.01)
        generator=random.Random(SEED)
        losses,orders=[],[]
        started=time.perf_counter()
        for epoch in range(3):
            model.train()
            order=list(range(len(train)));generator.shuffle(order)
            orders.append([train[index]['id'] for index in order])
            values=[]
            for step,index in enumerate(order):
                row=train[index]
                if row['ids']==['__none__']:
                    values.append(0.0);continue
                optimizer.zero_grad()
                objective=loss(model(**row['inputs']),row['accepted'])
                objective.backward()
                torch.nn.utils.clip_grad_norm_(model.parameters(),1.0)
                optimizer.step()
                values.append(float(objective.detach()))
                if (step+1)%50==0: print(__import__('json').dumps({'recipe':recipe,'epoch':epoch+1,'step':step+1,'total':len(train),'elapsedMs':(time.perf_counter()-started)*1000}),flush=True)
            losses.append(values)
            print(__import__('json').dumps({'recipe':recipe,'epoch':epoch+1,'meanLoss':sum(values)/len(values),'elapsedMs':(time.perf_counter()-started)*1000}),flush=True)
        training_ms=(time.perf_counter()-started)*1000
        checkpoint=weights/(recipe+'.safetensors')
        save_file({key:value.detach().contiguous() for key,value in model.state_dict().items()},str(checkpoint))
        result={'recipe':recipe,'parameters':sum(p.numel() for p in model.parameters()),'trainingMs':training_ms,'losses':losses,'caseOrder':orders,'checkpoint':{'path':str(checkpoint),'bytes':checkpoint.stat().st_size,'sha256':digest(checkpoint)},'trainPredictions':predictions(model,train),'validationPredictions':predictions(model,validation)}
        result['trainScore']=score(result['trainPredictions'],{key:gold_all[key] for key in split['trainIds']})
        result['validationScore']=score(result['validationPredictions'],{key:gold_all[key] for key in split['validationIds']})
        result['validationMicrobatch2Predictions']=predictions(model,validation,2)
        result['microbatch2SameChoices']=sum(a['selected']==b['selected'] for a,b in zip(result['validationPredictions'],result['validationMicrobatch2Predictions']))
        result['microbatch2MaximumLogitDifference']=max(abs(x-y) for a,b in zip(result['validationPredictions'],result['validationMicrobatch2Predictions']) for x,y in zip(a['scores'],b['scores']))
        results.append(result)
        write(output/(recipe+'-training.json'),result)
        print(__import__('json').dumps({'recipe':recipe,'validation':result['validationScore'],'microbatchSame':result['microbatch2SameChoices']}),flush=True)
        del model,optimizer;gc.collect()
    selected=sorted(results,key=lambda row:(-row['validationScore']['correct'],row['validationScore']['falseSelections'],row['parameters'],row['recipe']))[0]['recipe']
    report={'schemaVersion':1,'designSha256':digest(output/'design.json'),'recipes':results,'selected':selected,'completedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())}
    write(output/'training.json',report)
    write(output/'model-freeze.json',{'schemaVersion':1,'selected':selected,'designSha256':digest(output/'design.json'),'trainingSha256':digest(output/'training.json'),'models':{row['recipe']:row['checkpoint'] for row in results},'sources':design['sources'],'frozenAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'holdoutStatus':'No holdout input or labels were read by this runner; all three fixed recipes may now be evaluated without retuning.'})


if __name__=='__main__': main()
