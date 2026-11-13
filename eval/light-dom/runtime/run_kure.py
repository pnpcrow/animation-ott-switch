"""Pinned local q8 cross-encoder inference; no labels or implicit truncation."""
import argparse, hashlib, json, os, platform, time
from pathlib import Path
os.environ["HF_HUB_OFFLINE"]="1";os.environ["TOKENIZERS_PARALLELISM"]="false"
import numpy as np,onnxruntime as ort,transformers
from transformers import AutoTokenizer

p=argparse.ArgumentParser();p.add_argument("--jobs",required=True);p.add_argument("--output",required=True);p.add_argument("--directory",default=".tmp/light-dom/kure");p.add_argument("--threads",type=int,default=4);p.add_argument("--browser-jobs");p.add_argument("--browser-cases",default="witch-title,witch-image,witch-description,frieren-wavve-search-title,frieren-wavve-search-image,frieren-wavve-search-description");p.add_argument("--browser-template",default="en-role");args=p.parse_args()
def sha(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()
root=Path(args.directory);export=json.loads((root/"export.json").read_text(encoding="utf-8"));source=Path(args.jobs).read_bytes();jobs=json.loads(source)
for filename,info in export["source"]["files"].items():
    if sha(root/filename)!=info["sha256"]:raise ValueError(f"Pinned source/tokenizer changed: {filename}")
onnx_path=root/"model_q8.onnx";digest=sha(onnx_path)
if digest!=export["export"]["q8Sha256"]:raise ValueError("Pinned ONNX artifact changed")
tokenizer=AutoTokenizer.from_pretrained(root,trust_remote_code=False,local_files_only=True)
options=ort.SessionOptions();options.intra_op_num_threads=args.threads;options.inter_op_num_threads=1
began=time.perf_counter();session=ort.InferenceSession(str(onnx_path),options,providers=["CPUExecutionProvider"]);load_ms=(time.perf_counter()-began)*1000
names=[x.name for x in session.get_inputs()]
report={"schemaVersion":1,"model":export["model"],"revision":export["revision"],"modelSha256":digest,"modelBytes":onnx_path.stat().st_size,"jobsSha256":hashlib.sha256(source).hexdigest(),"inputsSha256":jobs.get("inputsSha256"),"templateSha256":jobs.get("templateSha256"),"runtime":"ONNX Runtime CPU q8, MatMul and Gather quantized", "onnxruntime":ort.__version__,"transformers":transformers.__version__,"python":platform.python_version(),"threads":args.threads,"loadMs":load_ms,"runnerSha256":sha(__file__),"predictions":[],"batches":[],"maxTokens":jobs["maxTokens"],"startedAt":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime()),"timingNote":"Inference batch time divided by batch size for pair costs; summed case costs recover full inference cost. Tokenization measured separately. No class labels are read."}
destination=Path(args.output);destination.parent.mkdir(parents=True,exist_ok=True)
def save():
    # Publish complete JSON atomically; Windows readers/scanners may briefly hold the path.
    temporary=destination.with_suffix(destination.suffix+".writing")
    payload=json.dumps(report,ensure_ascii=False,indent=2)+"\n"
    for retry in range(20):
        try:
            temporary.write_text(payload,encoding="utf-8",newline="\n");temporary.replace(destination);return
        except OSError:
            if retry==19:raise
            time.sleep(0.05*(retry+1))
if len(set(pair["id"] for pair in jobs["pairs"]))!=len(jobs["pairs"]):raise ValueError("Duplicate pair ID")
by_id={pair["id"]:pair for pair in jobs["pairs"]}
if set(by_id)!=set(pair_id for case in jobs["cases"] for pair_id in case["pairIds"]):raise ValueError("Pair plan coverage mismatch")
browser={"model":{"id":export["model"],"revision":export["revision"],"sha256":digest,"outputName":"logits","pooling":"logits"},"batches":[],"reference":{},"nativeJobsSha256":report["jobsSha256"],"note":"Fixed development cases for numerical/runtime diagnostic; not an independent accuracy estimate."}
browser_ids=set(args.browser_cases.split(","))
for number,case in enumerate(jobs["cases"]):
    selected=[]
    for pair_id in case["pairIds"]:
        pair=by_id[pair_id];start=time.perf_counter();variants=[];chosen=None
        for variant in pair["variants"]:
            inputs=tokenizer(variant["query"],variant["passage"],truncation=False,padding=False)
            tokens=len(inputs["input_ids"]);variants.append({"textLimit":variant["textLimit"],"tokens":tokens})
            if tokens<=jobs["maxTokens"]:chosen=(variant,inputs,tokens);break
        tokenization_ms=(time.perf_counter()-start)*1000
        meta={k:pair[k] for k in ["id","caseId","field","template","candidateId"]};meta.update(tokenizationMs=tokenization_ms,tiers=variants)
        if chosen is None:
            report["predictions"].append({**meta,"error":"No declared text tier fits token budget; no truncation or candidate deletion","elapsedMs":0})
        else:
            variant,inputs,tokens=chosen;selected.append((meta,inputs,variant,tokens))
    if selected:
        if len(selected)>8:raise ValueError("Expected no more than eight observed candidates")
        inputs=tokenizer.pad([x[1] for x in selected],padding=True,return_tensors="np")
        feeds={name:np.asarray(inputs[name],dtype=np.int64) for name in names}
        start=time.perf_counter()
        try:
            output=session.run(None,feeds)[0];elapsed=(time.perf_counter()-start)*1000
            if output.shape!=(len(selected),1) or not np.isfinite(output).all():raise ValueError("Expected one finite scalar relevance logit per candidate")
            batch_id=case["id"]+"::"+case["template"]
            report["batches"].append({"id":batch_id,"pairIds":[x[0]["id"] for x in selected],"size":len(selected),"shape":list(feeds["input_ids"].shape),"elapsedMs":elapsed})
            for index,(meta,_,variant,tokens) in enumerate(selected):
                report["predictions"].append({**meta,"score":float(output[index,0]),"logits":output[index].tolist(),"textLimit":variant["textLimit"],"tokens":tokens,"elapsedMs":elapsed/len(selected),"batchId":batch_id})
            if args.browser_jobs and case["id"] in browser_ids and case["template"]==args.browser_template:
                browser["batches"].append({"id":batch_id,"pairIds":[x[0]["id"] for x in selected],"inputs":{name:{"type":"int64","dims":list(value.shape),"data":value.flatten().tolist()} for name,value in feeds.items()},"repeats":3})
                browser["reference"][batch_id]=output.flatten().tolist()
        except Exception as error:
            elapsed=(time.perf_counter()-start)*1000
            for meta,_,variant,tokens in selected:report["predictions"].append({**meta,"textLimit":variant["textLimit"],"tokens":tokens,"elapsedMs":elapsed/len(selected),"error":str(error)})
    save();print(json.dumps({"case":number+1,"total":len(jobs["cases"]),"id":case["id"],"template":case["template"],"pairs":len(selected),"completed":len(report["predictions"])}),flush=True)
if len(report["predictions"])!=len(jobs["pairs"]):raise ValueError("Missing planned prediction")
report["finishedAt"]=time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime());save()
if args.browser_jobs:
    out=Path(args.browser_jobs);out.parent.mkdir(parents=True,exist_ok=True);out.write_text(json.dumps(browser,ensure_ascii=False,indent=2)+"\n",encoding="utf-8",newline="\n")
