"""Development-only data and input diagnostics. No optimizer or model selection."""
import argparse
import hashlib
from collections import Counter,defaultdict
from pathlib import Path
import json
import time

import torch
from shared import read, write, digest, tokenizer, tokenize, initialize, RECIPES
from train import split_records, duplicate_negative_pages


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--inputs',required=True);parser.add_argument('--labels',required=True)
    parser.add_argument('--plans',required=True);parser.add_argument('--reserved-work-hashes',required=True)
    parser.add_argument('--output',required=True);parser.add_argument('--profile',action='store_true')
    args=parser.parse_args()
    inputs,labels=read(args.inputs),read(args.labels)
    reserved=read(args.reserved_work_hashes)
    duplicates=duplicate_negative_pages(inputs,labels,read(Path(args.plans)/'full-compact.json'))
    split=split_records(inputs,labels,set(reserved['workHashes']),duplicates)
    by_label={row['id']:row for row in labels}
    tok=tokenizer();reports=[]
    torch.set_num_threads(4);torch.set_num_interop_threads(1)
    for recipe in RECIPES:
        plan=read(Path(args.plans)/(recipe+'.json'))
        assert plan['inputsSha256']==digest(args.inputs)
        rows,audit=tokenize(plan,tok)
        duplicate=defaultdict(list)
        for row in plan['cases']:
            value=json.dumps(sorted([json.dumps(c['variants'],sort_keys=True,ensure_ascii=False) for c in row['candidates']]),ensure_ascii=False).encode()
            duplicate[hashlib.sha256(value).hexdigest()].append(row['id'])
        cross=[ids for ids in duplicate.values() if set(ids)&set(split['trainIds']) and set(ids)&set(split['validationIds'])]
        report={'recipe':recipe,'cases':len(rows),'pairs':len(audit),'maximumTokens':max(item['attempts'][-1]['tokens'] for item in audit),'selectedTierCounts':dict(Counter(str(item['attempts'][-1]['textLimit']) for item in audit)),'duplicateModelVisibleGroupsAcrossSplit':cross}
        if args.profile:
            model=initialize(recipe);model.eval()
            row=next(row for row in rows if row['id'] in split['trainIds'] and len(row['ids'])>1)
            times=[]
            with torch.inference_mode():
                for _ in range(3):
                    started=time.perf_counter();model(**row['inputs']);times.append((time.perf_counter()-started)*1000)
            report['nontrainingCpuProfile']={'caseId':row['id'],'shape':list(row['inputs']['input_ids'].shape),'milliseconds':times,'parameters':sum(p.numel() for p in model.parameters()),'note':'Pretrained encoder plus random head. Timing only; no accuracy measured or optimizer used.'}
            del model
        reports.append(report)
    result={'schemaVersion':1,'status':'development preflight, no training','inputsSha256':digest(args.inputs),'labelsSha256':digest(args.labels),'split':split,'distribution':{part:{'cases':len(split[part+'Ids']),'positive':sum('__none__' not in (by_label[key].get('acceptedIds') or [by_label[key]['expectedId']]) for key in split[part+'Ids']),'providers':dict(Counter(by_label[key]['provenance'].get('provider') or 'unknown' for key in split[part+'Ids']))} for part in ['train','validation']},'recipes':reports}
    write(args.output,result)
    print(json.dumps({'distribution':result['distribution'],'excluded':len(split['excluded']),'recipes':reports},ensure_ascii=False))


if __name__=='__main__':main()
