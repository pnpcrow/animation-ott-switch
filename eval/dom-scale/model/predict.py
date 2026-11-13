"""Run all frozen q8 models on observed inputs only; never load held-out labels."""
import argparse
import json
from pathlib import Path
import time
import onnxruntime as ort
from shared import RECIPES, digest, read, write, tokenizer, tokenize
from export import verify_freeze, onnx_predictions, browser_plan


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--plans',required=True)
    parser.add_argument('--output',required=True)
    parser.add_argument('--model-dir',default='eval/dom-scale/model')
    args=parser.parse_args()
    directory=Path(args.model_dir);output=Path(args.output);output.mkdir(parents=True,exist_ok=True)
    freeze=verify_freeze(directory/'model-freeze.json')
    exports=read(directory/'exports.json');assert exports['freezeSha256']==digest(directory/'model-freeze.json')
    tok=tokenizer();options=ort.SessionOptions();options.intra_op_num_threads=4;options.inter_op_num_threads=1
    for recipe in RECIPES:
        exported=next(row for row in exports['models'] if row['recipe']==recipe)
        assert digest(exported['modelPath'])==exported['q8']['sha256']
        path=Path(args.plans)/(recipe+'.json');plan=read(path)
        assert plan['representationSha256']==digest('eval/dom-scale/model/representation.mjs')
        rows,audit=tokenize(plan,tok,allow_errors=True)
        session=ort.InferenceSession(exported['modelPath'],sess_options=options,providers=['CPUExecutionProvider'])
        full=onnx_predictions(session,rows);micro=onnx_predictions(session,rows,2)
        meta={'id':'dom-scale-'+recipe,'recipe':recipe,'sha256':exported['q8']['sha256'],'outputName':'scores','pooling':'logits'}
        result={'schemaVersion':1,'recipe':recipe,'freezeSha256':digest(directory/'model-freeze.json'),'exportsSha256':digest(directory/'exports.json'),'inputPlanSha256':digest(path),'modelSha256':meta['sha256'],'tokenAudit':audit,'predictions':full,'micro2Predictions':micro,'finishedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())}
        write(output/(recipe+'-predictions.json'),result)
        write(output/(recipe+'-full-browser.json'),browser_plan(rows,meta,full))
        write(output/(recipe+'-micro2-browser.json'),browser_plan(rows,meta,micro,2))
        print(json.dumps({'recipe':recipe,'cases':len(rows),'errors':sum(bool(row.get('error')) for row in full),'output':str(output)}),flush=True)


if __name__=='__main__':main()
