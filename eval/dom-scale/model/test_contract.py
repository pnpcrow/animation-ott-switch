import unittest
import hashlib
import torch
from shared import loss, choose, score, RECIPES
from train import split_records, duplicate_negative_pages


class Contracts(unittest.TestCase):
    def test_loss_accepts_equivalent_targets_and_rejects_missing(self):
        values=torch.tensor([2.0,1.0,0.0],requires_grad=True)
        expected=-torch.log(torch.softmax(values,0)[:2].sum())
        self.assertAlmostEqual(float(loss(values,[0,1]).detach()),float(expected.detach()),places=6)
        with self.assertRaises(AssertionError):loss(values,[])
        with self.assertRaises(AssertionError):loss(values,[0,0])

    def test_readout_never_resolves_ties_by_candidate_order(self):
        self.assertEqual(choose(['a','b'],[1.0,1.0]),'__none__')
        self.assertEqual(choose(['b','a'],[2.0,1.0]),'b')
        with self.assertRaises(AssertionError):choose(['a'],[float('nan')])

    def test_inference_errors_stay_in_planned_denominator(self):
        result=score([{'id':'x','error':'budget'}],{'x':['__none__']})
        self.assertEqual(result['total'],1)
        self.assertEqual(result['correct'],0)
        self.assertEqual(result['errors'],1)

    def test_depth_ablation_keeps_same_context_budget(self):
        self.assertEqual(RECIPES['full-compact']['maximumTokens'],160)
        self.assertEqual(RECIPES['small-compact']['maximumTokens'],160)
        self.assertEqual(RECIPES['small-compact']['layers'],[2,5,8,11])

    def records(self):
        inputs=[];labels=[]
        for work in range(6):
            for field in ['title','image','description']:
                key=f'work{work}-{field}'
                inputs.append({'id':key,'pageEvidence':{'url':f'https://laftel.net/item/{work}'},'options':[{'id':'a'},{'id':'__none__'}]})
                labels.append({'id':key,'expectedId':'a','acceptedIds':['a'],'provenance':{'pageId':f'page{work}','work':f'work{work}','url':f'https://laftel.net/item/{work}'}})
        return inputs,labels

    def test_group_split_never_splits_fields_of_one_work(self):
        inputs,labels=self.records();split=split_records(inputs,labels)
        for ids in split['groups'].values():
            self.assertTrue(set(ids).issubset(split['trainIds']) or set(ids).issubset(split['validationIds']))
        self.assertFalse(set(split['trainIds'])&set(split['validationIds']))

    def test_held_out_service_cannot_enter_training(self):
        inputs,labels=self.records()
        labels[0]['provenance']['url']='https://www.netflix.com/title/123'
        with self.assertRaises(AssertionError):split_records(inputs,labels)

    def test_an_equivalent_target_inside_pool_remains_trainable(self):
        inputs,labels=self.records()
        labels[0]['acceptedIds']=['a','outside-pool']
        split=split_records(inputs,labels)
        self.assertEqual(split['acceptedInPool'][labels[0]['id']],['a'])
        self.assertFalse(split['excluded'])

    def test_blank_navigation_is_recorded_and_excluded_from_learning(self):
        inputs,labels=self.records()
        inputs[0]['pageEvidence']['url']='about:blank'
        split=split_records(inputs,labels)
        self.assertEqual(split['excluded'][0]['id'],inputs[0]['id'])
        self.assertNotIn(inputs[0]['id'],split['trainIds']+split['validationIds'])

    def test_reserved_holdout_work_hash_cannot_enter_training(self):
        inputs,labels=self.records()
        reserved={hashlib.sha256(b'work0').hexdigest()}
        with self.assertRaises(AssertionError):split_records(inputs,labels,reserved)

    def test_collector_duplicates_are_not_learned_or_used_for_selection(self):
        inputs,labels=self.records()
        labels[0]['quality']={'excludeFromTraining':True}
        labels[0]['provenance']['duplicateOf']='another-capture'
        split=split_records(inputs,labels)
        self.assertEqual(split['excluded'][0]['duplicateOf'],'another-capture')
        self.assertNotIn(labels[0]['id'],split['trainIds']+split['validationIds'])

    def test_only_complete_negative_pages_are_deduplicated(self):
        inputs,labels=self.records()
        for label in labels:label['expectedId']='__none__';label['acceptedIds']=['__none__']
        for row in inputs:row['field']=row['id'].rsplit('-',1)[-1]
        plan={'cases':[{'id':row['id'],'field':row['field'],'candidates':[{'id':'a','variants':[{'query':row['field'],'passage':'same observed facts'}]},{'id':'__none__','variants':[{'query':row['field'],'passage':'none outcome'}]}]} for row in inputs]}
        groups=duplicate_negative_pages(inputs,labels,plan)
        self.assertEqual(len(groups),1)
        self.assertEqual(len(groups[0]['excludedPages']),5)
        # A positive field makes the whole page ineligible for negative dedup.
        labels[0]['expectedId']='a';labels[0]['acceptedIds']=['a']
        groups=duplicate_negative_pages(inputs,labels,plan)
        self.assertEqual(len(groups[0]['excludedPages']),4)
        self.assertNotIn('page0',[groups[0]['canonicalPageId']]+[page['pageId'] for page in groups[0]['excludedPages']])


if __name__=='__main__':unittest.main()
