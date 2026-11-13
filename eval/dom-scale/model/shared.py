"""Pinned stock encoder, bounded observed-input tokenization, and listwise readout."""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path

import torch
from transformers import ElectraConfig, ElectraModel, ElectraTokenizerFast

PINNED_SOURCE = Path('eval/dom-adaptation/finetune/prepare.py')
_spec = importlib.util.spec_from_file_location('dom_scale_pinned', PINNED_SOURCE)
_pinned = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_pinned)
MODEL, REVISION, BASE = _pinned.MODEL, _pinned.REVISION, _pinned.ROOT
SEED = 20261114
RECIPES = {
    'full-natural': {'layers': list(range(12)), 'maximumTokens': 384},
    'full-compact': {'layers': list(range(12)), 'maximumTokens': 160},
    'small-compact': {'layers': [2, 5, 8, 11], 'maximumTokens': 160},
}


def read(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def write(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')


def verify_base():
    return _pinned.verify()


class Ranker(torch.nn.Module):
    def __init__(self, encoder):
        super().__init__()
        self.encoder = encoder
        self.rank = torch.nn.Linear(encoder.config.hidden_size, 1)
        torch.nn.init.normal_(self.rank.weight, std=0.02)
        torch.nn.init.zeros_(self.rank.bias)

    def forward(self, input_ids, attention_mask, token_type_ids):
        output = self.encoder(input_ids=input_ids, attention_mask=attention_mask, token_type_ids=token_type_ids)
        return self.rank(output.last_hidden_state[:, 0]).squeeze(-1)


def initialize(recipe):
    base = ElectraModel.from_pretrained(BASE, local_files_only=True, attn_implementation='eager')
    layers = RECIPES[recipe]['layers']
    if layers != list(range(12)):
        original = base.encoder.layer
        base.encoder.layer = torch.nn.ModuleList([copy.deepcopy(original[index]) for index in layers])
        base.config.num_hidden_layers = len(layers)
    # Reset immediately before head initialization so every recipe has same head.
    torch.manual_seed(SEED)
    return Ranker(base)


def empty_model(recipe):
    config = ElectraConfig.from_pretrained(BASE, local_files_only=True)
    config.num_hidden_layers = len(RECIPES[recipe]['layers'])
    config._attn_implementation = 'eager'
    return Ranker(ElectraModel(config))


def tokenizer():
    return ElectraTokenizerFast.from_pretrained(BASE, local_files_only=True)


def tokenize(plan, tok, allow_errors=False):
    assert plan['recipe'] in RECIPES
    maximum = RECIPES[plan['recipe']]['maximumTokens']
    assert plan['maximumTokens'] == maximum
    assert plan['layers'] == RECIPES[plan['recipe']]['layers']
    assert len({row['id'] for row in plan['cases']}) == len(plan['cases'])
    rows, audit = [], []
    for row in plan['cases']:
        encoded, chosen, error = [], [], None
        ids = [candidate['id'] for candidate in row['candidates']]
        assert len(ids) == len(set(ids)) and ids.count('__none__') == 1
        for candidate in row['candidates']:
            attempts = []
            for variant in candidate['variants']:
                values = tok(variant['query'], variant['passage'], truncation=False, padding=False)
                attempts.append({'textLimit': variant['textLimit'], 'tokens': len(values['input_ids'])})
                if len(values['input_ids']) <= maximum:
                    encoded.append(values)
                    chosen.append({'candidateId': candidate['id'], **variant, 'tokens': len(values['input_ids']), 'tokenIds':values['input_ids'], 'attentionMask':values['attention_mask'], 'tokenTypeIds':values['token_type_ids']})
                    break
            else:
                error = f"No explicit tier fits token budget: {row['id']}/{candidate['id']}"
            audit.append({'caseId': row['id'], 'candidateId': candidate['id'], 'attempts': attempts, 'error': error})
        if error:
            if not allow_errors:
                raise ValueError(error)
            rows.append({'id': row['id'], 'field': row['field'], 'ids': ids, 'error': error})
            continue
        batch = dict(tok.pad(encoded, padding=True, return_tensors='pt'))
        rows.append({'id': row['id'], 'field': row['field'], 'ids': ids, 'inputs': batch, 'pairs': chosen})
    return rows, audit


def loss(scores, accepted):
    assert accepted and len(accepted) == len(set(accepted))
    assert min(accepted) >= 0 and max(accepted) < scores.numel()
    return torch.logsumexp(scores, dim=0) - torch.logsumexp(scores[accepted], dim=0)


def choose(ids, scores):
    assert len(ids) == len(scores) and len(ids) == len(set(ids)) and len(ids) > 0
    assert all(torch.isfinite(torch.tensor(score)).item() for score in scores)
    order = sorted(range(len(ids)), key=lambda index: scores[index], reverse=True)
    return '__none__' if len(order) > 1 and scores[order[0]] == scores[order[1]] else ids[order[0]]


def labels(path):
    rows = read(path)
    assert len(rows) == len({row['id'] for row in rows})
    return {row['id']: row.get('acceptedIds') or [row['expectedId']] for row in rows}


def score(predicted, gold):
    assert len(predicted) == len({row['id'] for row in predicted})
    assert {row['id'] for row in predicted} == set(gold)
    result = dict(total=len(predicted), correct=0, positiveCorrect=0, noneCorrect=0, falseSelections=0, abstentions=0, errors=0)
    for row in predicted:
        accepted = gold[row['id']]
        if row.get('error'):
            result['errors'] += 1
            continue
        ok = row['selected'] in accepted
        result['correct'] += int(ok)
        result['positiveCorrect'] += int(ok and '__none__' not in accepted)
        result['noneCorrect'] += int(ok and '__none__' in accepted)
        result['falseSelections'] += int(not ok and row['selected'] != '__none__')
        result['abstentions'] += int(row['selected'] == '__none__')
    return result
