import json
import tempfile
import unittest
from pathlib import Path

import torch
from train import loss, tokenize


class Tokenizer:
    def __call__(self, query, passage, **kwargs):
        assert kwargs == {'truncation':False,'padding':False}
        return {'input_ids':list(range(int(passage))),'attention_mask':[1]*int(passage),'token_type_ids':[0]*int(passage)}

    def pad(self, rows, **kwargs):
        width=max(len(row['input_ids']) for row in rows)
        return {key:torch.tensor([row[key]+[0]*(width-len(row[key])) for row in rows]) for key in rows[0]}


class Contracts(unittest.TestCase):
    def test_multiple_valid_answers_receive_combined_probability(self):
        scores=torch.tensor([0.,0.,0.,0.],requires_grad=True)
        objective=loss(scores,[1,3])
        self.assertAlmostEqual(float(objective.detach()),0.69314718,places=6)
        objective.backward()
        self.assertTrue(torch.allclose(scores.grad,torch.tensor([.25,-.25,.25,-.25])))

    def test_permuting_options_preserves_listwise_objective(self):
        scores=torch.tensor([-2.,1.,0.,4.])
        self.assertAlmostEqual(float(loss(scores,[1,2])),float(loss(scores[[3,2,0,1]],[1,3])),places=6)

    def plan(self,candidates):
        return {'maximumTokens':384,'cases':[{'id':'case','field':'title','candidates':candidates}]}

    def candidate(self,id,lengths):
        return {'id':id,'variants':[{'query':'fixed','passage':str(length),'textLimit':limit} for limit,length in zip([96,64,32,16],lengths)]}

    def run_plan(self,plan):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'plan.json'
            path.write_text(json.dumps(plan))
            return tokenize(path,Tokenizer())

    def test_over_budget_tier_is_explicitly_replaced_without_option_loss(self):
        rows,audit=self.run_plan(self.plan([self.candidate('a',[400,300]),self.candidate('__none__',[30])]))
        self.assertEqual(rows[0]['ids'],['a','__none__'])
        self.assertEqual(audit[0]['attempts'],[{'textLimit':96,'tokens':400},{'textLimit':64,'tokens':300}])
        self.assertEqual(tuple(rows[0]['inputs']['input_ids'].shape),(2,300))

    def test_exhausted_tiers_fail_instead_of_truncating_or_dropping_candidate(self):
        with self.assertRaises(ValueError):
            self.run_plan(self.plan([self.candidate('a',[400,400,400,400]),self.candidate('__none__',[30])]))

    def test_missing_or_duplicate_none_outcome_is_rejected(self):
        for ids in [['a'],['a','__none__','__none__']]:
            with self.assertRaises(AssertionError):
                self.run_plan(self.plan([self.candidate(id,[30]) for id in ids]))


if __name__=='__main__':
    unittest.main()
