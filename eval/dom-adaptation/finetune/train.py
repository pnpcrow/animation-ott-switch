"""Fixed two-recipe pilot. Existing holdout is retrospective, not new evidence."""
import copy
import hashlib
import importlib.metadata
import json
import random
import time
from pathlib import Path

import numpy as np
import torch
from transformers import ElectraModel, ElectraTokenizerFast

from prepare import MODEL, REVISION, ROOT, digest, verify

DIRECTORY = Path(".tmp/dom-adaptation/finetune")
REPORT = Path("eval/dom-adaptation/finetune/report.json")
SEED = 20261113


def read(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def labels(path):
    rows = read(path)
    assert len({row['id'] for row in rows}) == len(rows)
    return {row['id']: row.get('acceptedIds', [row['expectedId']]) for row in rows}


def loss(scores, accepted):
    return torch.logsumexp(scores, 0) - torch.logsumexp(scores[accepted], 0)


class Ranker(torch.nn.Module):
    def __init__(self, base):
        super().__init__()
        self.encoder = base
        self.rank = torch.nn.Linear(base.config.hidden_size, 1)
        torch.nn.init.normal_(self.rank.weight, std=0.02)
        torch.nn.init.zeros_(self.rank.bias)

    def features(self, inputs):
        return self.encoder(**inputs).last_hidden_state[:, 0]

    def forward(self, input_ids, attention_mask, token_type_ids):
        return self.rank(self.features(dict(input_ids=input_ids, attention_mask=attention_mask, token_type_ids=token_type_ids))).squeeze(-1)


def tokenize(path, tokenizer):
    plan = read(path)
    assert plan['maximumTokens'] == 384
    rows, audits = [], []
    for row in plan['cases']:
        encoded = []
        for candidate in row['candidates']:
            seen = []
            for variant in candidate['variants']:
                values = tokenizer(variant['query'], variant['passage'], truncation=False, padding=False)
                seen.append({'textLimit': variant['textLimit'], 'tokens': len(values['input_ids'])})
                if len(values['input_ids']) <= 384:
                    encoded.append(values)
                    audits.append({'caseId': row['id'], 'candidateId': candidate['id'], 'attempts': seen})
                    break
            else:
                raise ValueError(f"No explicit tier fits token budget: {row['id']}/{candidate['id']}")
        ids = [candidate['id'] for candidate in row['candidates']]
        assert ids.count('__none__') == 1 and len(ids) == len(set(ids))
        batch = tokenizer.pad(encoded, padding=True, return_tensors='pt')
        rows.append({'id': row['id'], 'field': row['field'], 'ids': ids, 'inputs': dict(batch)})
    assert len({row['id'] for row in rows}) == len(rows)
    return rows, audits


def predictions(model, rows):
    model.eval()
    results = []
    with torch.inference_mode():
        for row in rows:
            start = time.perf_counter()
            scores = model(**row['inputs']).tolist()
            elapsed = (time.perf_counter()-start)*1000
            order = sorted(range(len(scores)), key=lambda i: scores[i], reverse=True)
            selected = '__none__' if len(order) > 1 and scores[order[0]] == scores[order[1]] else row['ids'][order[0]]
            results.append({'id': row['id'], 'field': row['field'], 'candidateIds': row['ids'], 'scores': scores, 'selected': selected, 'inferenceMs': elapsed})
    return results


def score(predicted, gold):
    assert {row['id'] for row in predicted} == set(gold)
    correct = positive = none = false_select = abstain = 0
    for row in predicted:
        accepted = gold[row['id']]
        ok = row['selected'] in accepted
        correct += ok
        positive += ok and '__none__' not in accepted
        none += ok and '__none__' in accepted
        false_select += not ok and row['selected'] != '__none__'
        abstain += row['selected'] == '__none__'
    return dict(total=len(predicted), correct=correct, positiveCorrect=positive, noneCorrect=none, falseSelections=false_select, abstentions=abstain)


def main():
    if REPORT.exists():
        raise ValueError('Refuse to overwrite completed pilot; use a new experiment directory')
    begin = time.perf_counter()
    random.seed(SEED)
    np.random.seed(SEED)
    torch.manual_seed(SEED)
    torch.set_num_threads(4)
    torch.set_num_interop_threads(1)
    torch.use_deterministic_algorithms(True)
    files = verify()
    tokenizer = ElectraTokenizerFast.from_pretrained(ROOT, local_files_only=True)
    tokenizer.model_max_length = 384
    train, train_audit = tokenize(DIRECTORY/'development-inputs.json', tokenizer)
    retrospective, retrospective_audit = tokenize(DIRECTORY/'holdout-inputs.json', tokenizer)
    gold_train = labels('eval/light-dom/data/development-labels.json')
    assert len(train) == 66 and len(retrospective) == 18
    assert set(gold_train) == {row['id'] for row in train}
    assert not {row['id'] for row in train} & {row['id'] for row in retrospective}
    for row in train:
        row['accepted'] = [row['ids'].index(value) for value in gold_train[row['id']]]
    # Discriminator head is intentionally unused; no random-head zero-shot score.
    base = ElectraModel.from_pretrained(ROOT, local_files_only=True, attn_implementation='eager')
    initial = Ranker(base)
    initial_state = copy.deepcopy(initial.state_dict())
    report = {
        'schemaVersion': 1, 'model': MODEL, 'revision': REVISION, 'files': files,
        'seed': SEED, 'trainingCases': 66, 'retrospectiveCases': 18,
        'validationStatus': 'Previously published and inspected 18 cases; not fresh holdout or generalization evidence.',
        'runtime': 'stock PyTorch CPU fp32, eager attention, 4 threads',
        'parameters': sum(p.numel() for p in initial.parameters()),
        'sourceSha256': {str(path): digest(path) for path in [Path(__file__), Path(__file__).with_name('prepare.py'), Path(__file__).with_name('prepare-inputs.mjs'), Path('eval/dom-adaptation/templates.mjs'), Path('eval/tiny-decision/v2/features.mjs')]},
        'dataSha256': {str(path): digest(path) for path in [DIRECTORY/'development-inputs.json', DIRECTORY/'holdout-inputs.json', Path('eval/light-dom/data/development-labels.json'), Path('eval/light-dom/data/holdout-labels.json')]},
        'versions': {name: importlib.metadata.version(name) for name in ['torch','transformers','numpy','tokenizers']},
        'tokenAudit': {'training': train_audit, 'retrospective': retrospective_audit},
        'recipes': {
            'frozenEncoder': {'epochs': 200, 'learningRate': 0.01, 'weightDecay': 0.01, 'batch': 'all 66 cached case lists per optimizer step', 'encoderDropout': False},
            'fullEncoder': {'epochs': 3, 'encoderLearningRate': 0.00002, 'headLearningRate': 0.001, 'weightDecay': 0.01, 'batch': 'one complete candidate list per optimizer step', 'gradientClip': 1.0, 'encoderDropout': True},
        },
        'objective': 'listwise negative log probability of any accepted candidate; NONE is a separately encoded outcome',
        'frozenBeforeTrainingAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
    }
    Path('eval/dom-adaptation/finetune/design.json').write_text(json.dumps({k:v for k,v in report.items() if k!='tokenAudit'}, ensure_ascii=False, indent=2)+'\n',encoding='utf-8',newline='\n')
    frozen = initial
    for param in frozen.encoder.parameters():
        param.requires_grad = False
    frozen.eval()
    cache_start = time.perf_counter()
    with torch.inference_mode():
        cached = [frozen.features(row['inputs']).clone().detach() for row in train]
    # Inference-mode tensors must be ordinary tensors for autograd on the head.
    cached = [values.clone() for values in cached]
    cache_ms = (time.perf_counter()-cache_start)*1000
    optimizer = torch.optim.AdamW(frozen.rank.parameters(), lr=0.01, weight_decay=0.01)
    losses = []
    started = time.perf_counter()
    for epoch in range(200):
        optimizer.zero_grad()
        objective = torch.stack([loss(frozen.rank(values).squeeze(-1), row['accepted']) for values,row in zip(cached,train)]).mean()
        objective.backward()
        optimizer.step()
        losses.append(float(objective.detach()))
    report['frozenEncoder'] = {'trainableParameters': sum(p.numel() for p in frozen.parameters() if p.requires_grad), 'cacheMs': cache_ms, 'trainingMs': (time.perf_counter()-started)*1000, 'losses': losses, 'trainingPredictions': predictions(frozen, train), 'retrospectivePredictions': predictions(frozen, retrospective)}
    print(json.dumps({'stage':'frozen-complete','training':score(report['frozenEncoder']['trainingPredictions'],gold_train)}),flush=True)
    full = Ranker(copy.deepcopy(base))
    full.load_state_dict(initial_state)
    for param in full.parameters():
        param.requires_grad = True
    torch.manual_seed(SEED)
    optimizer = torch.optim.AdamW([{'params': full.encoder.parameters(), 'lr':0.00002}, {'params':full.rank.parameters(),'lr':0.001}], weight_decay=0.01)
    losses, orders = [], []
    started = time.perf_counter()
    generator = random.Random(SEED)
    for epoch in range(3):
        full.train()
        order = list(range(len(train)))
        generator.shuffle(order)
        orders.append([train[index]['id'] for index in order])
        values = []
        for index in order:
            row = train[index]
            optimizer.zero_grad()
            objective = loss(full(**row['inputs']), row['accepted'])
            objective.backward()
            torch.nn.utils.clip_grad_norm_(full.parameters(), 1.0)
            optimizer.step()
            values.append(float(objective.detach()))
        losses.append(values)
        print(json.dumps({'stage':'full-epoch','epoch':epoch+1,'meanLoss':sum(values)/len(values),'elapsedMs':(time.perf_counter()-started)*1000}),flush=True)
    training_ms = (time.perf_counter()-started)*1000
    checkpoint = DIRECTORY/'full-ranker.safetensors'
    from safetensors.torch import save_file
    save_file({key:value.detach().contiguous() for key,value in full.state_dict().items()},str(checkpoint))
    report['fullEncoder'] = {'trainableParameters': sum(p.numel() for p in full.parameters()), 'trainingMs': training_ms, 'losses':losses, 'caseOrder':orders, 'checkpoint':{'path':str(checkpoint),'bytes':checkpoint.stat().st_size,'sha256':digest(checkpoint)}, 'trainingPredictions':predictions(full,train),'retrospectivePredictions':predictions(full,retrospective)}
    # These labels are first read after both fixed recipes have completed.
    gold_retrospective = labels('eval/light-dom/data/holdout-labels.json')
    for key in ['frozenEncoder','fullEncoder']:
        report[key]['trainingScore'] = score(report[key]['trainingPredictions'],gold_train)
        report[key]['retrospectiveScore'] = score(report[key]['retrospectivePredictions'],gold_retrospective)
    report['completedAt'] = time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())
    report['totalWallMs'] = (time.perf_counter()-begin)*1000
    REPORT.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n')
    print(json.dumps({key:report[key]['retrospectiveScore'] for key in ['frozenEncoder','fullEncoder']}),flush=True)


if __name__ == '__main__':
    main()
