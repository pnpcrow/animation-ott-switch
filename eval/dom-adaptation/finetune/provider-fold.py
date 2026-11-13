"""One predeclared Netflix/work-disjoint development fold, same fixed recipes."""
import copy
import json
import random
import time
from pathlib import Path

import numpy as np
import torch
from transformers import ElectraModel, ElectraTokenizerFast

from prepare import MODEL, REVISION, ROOT, digest, verify
from train import DIRECTORY, SEED, Ranker, labels, loss, predictions, score, tokenize


def main():
    output = Path('eval/dom-adaptation/finetune/provider-fold.json')
    if output.exists():
        raise ValueError('Refuse to overwrite completed fold')
    started = time.perf_counter()
    torch.set_num_threads(4)
    torch.set_num_interop_threads(1)
    torch.use_deterministic_algorithms(True)
    random.seed(SEED)
    np.random.seed(SEED)
    torch.manual_seed(SEED)
    verify()
    audit_path = Path('eval/dom-adaptation/corpus-audit.json')
    audit = json.loads(audit_path.read_text(encoding='utf-8'))
    fold = next(row for row in audit['folds'] if row['provider']=='netflix')
    assert len(fold['trainIds']) == 63 and len(fold['testIds']) == 15
    assert not set(fold['trainIds']) & set(fold['testIds'])
    tokenizer = ElectraTokenizerFast.from_pretrained(ROOT,local_files_only=True)
    old, _ = tokenize(DIRECTORY/'development-inputs.json',tokenizer)
    recent, _ = tokenize(DIRECTORY/'holdout-inputs.json',tokenizer)
    rows = {row['id']:row for row in old+recent}
    all_gold = {**labels('eval/light-dom/data/development-labels.json'),**labels('eval/light-dom/data/holdout-labels.json')}
    train = [rows[key] for key in fold['trainIds']]
    test = [rows[key] for key in fold['testIds']]
    gold_train = {key:all_gold[key] for key in fold['trainIds']}
    gold_test = {key:all_gold[key] for key in fold['testIds']}
    for row in train:
        row['accepted'] = [row['ids'].index(value) for value in gold_train[row['id']]]
    base = ElectraModel.from_pretrained(ROOT,local_files_only=True,attn_implementation='eager')
    frozen = Ranker(base)
    initial_state = copy.deepcopy(frozen.state_dict())
    original_design = json.loads(Path('eval/dom-adaptation/finetune/design.json').read_text(encoding='utf-8'))
    report = {
        'schemaVersion':1,'model':MODEL,'revision':REVISION,'seed':SEED,
        'fold':fold,'status':'retrospective provider/work-disjoint development fold; not a new untouched benchmark',
        'recipeSourceSha256':digest(Path('eval/dom-adaptation/finetune/design.json')),
        'recipes':original_design['recipes'],'sourceSha256':digest(Path(__file__)),
        'auditSha256':digest(audit_path),'sharedTrainSourceSha256':digest(Path(__file__).with_name('train.py')),
        'inputsSha256':{str(path):digest(path) for path in [DIRECTORY/'development-inputs.json',DIRECTORY/'holdout-inputs.json']},
        'frozenAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),
    }
    Path('eval/dom-adaptation/finetune/provider-design.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8',newline='\n')
    for parameter in frozen.encoder.parameters():
        parameter.requires_grad=False
    frozen.eval()
    begin=time.perf_counter()
    with torch.inference_mode():
        cached=[frozen.features(row['inputs']).clone().detach() for row in train]
    cached=[value.clone() for value in cached]
    cache_ms=(time.perf_counter()-begin)*1000
    optimizer=torch.optim.AdamW(frozen.rank.parameters(),lr=0.01,weight_decay=0.01)
    losses=[]
    begin=time.perf_counter()
    for epoch in range(200):
        optimizer.zero_grad()
        objective=torch.stack([loss(frozen.rank(value).squeeze(-1),row['accepted']) for value,row in zip(cached,train)]).mean()
        objective.backward()
        optimizer.step()
        losses.append(float(objective.detach()))
    report['frozenEncoder']={'trainingMs':(time.perf_counter()-begin)*1000,'cacheMs':cache_ms,'losses':losses,'trainingPredictions':predictions(frozen,train),'testPredictions':predictions(frozen,test)}
    print(json.dumps({'stage':'provider-frozen-complete'}),flush=True)
    full=Ranker(copy.deepcopy(base))
    full.load_state_dict(initial_state)
    for parameter in full.parameters():
        parameter.requires_grad=True
    torch.manual_seed(SEED)
    optimizer=torch.optim.AdamW([{'params':full.encoder.parameters(),'lr':0.00002},{'params':full.rank.parameters(),'lr':0.001}],weight_decay=0.01)
    generator=random.Random(SEED)
    losses,orders=[],[]
    begin=time.perf_counter()
    for epoch in range(3):
        full.train()
        order=list(range(len(train)))
        generator.shuffle(order)
        orders.append([train[index]['id'] for index in order])
        values=[]
        for index in order:
            row=train[index]
            optimizer.zero_grad()
            objective=loss(full(**row['inputs']),row['accepted'])
            objective.backward()
            torch.nn.utils.clip_grad_norm_(full.parameters(),1.0)
            optimizer.step()
            values.append(float(objective.detach()))
        losses.append(values)
        print(json.dumps({'stage':'provider-full-epoch','epoch':epoch+1,'meanLoss':sum(values)/len(values),'elapsedMs':(time.perf_counter()-begin)*1000}),flush=True)
    report['fullEncoder']={'trainingMs':(time.perf_counter()-begin)*1000,'losses':losses,'caseOrder':orders,'trainingPredictions':predictions(full,train),'testPredictions':predictions(full,test)}
    for key in ['frozenEncoder','fullEncoder']:
        report[key]['trainingScore']=score(report[key]['trainingPredictions'],gold_train)
        report[key]['testScore']=score(report[key]['testPredictions'],gold_test)
    report['elapsedMs']=(time.perf_counter()-started)*1000
    report['finishedAt']=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())
    output.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8',newline='\n')
    print(json.dumps({key:report[key]['testScore'] for key in ['frozenEncoder','fullEncoder']}),flush=True)


if __name__=='__main__':
    main()
