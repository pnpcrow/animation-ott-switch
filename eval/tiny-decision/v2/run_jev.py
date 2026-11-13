"""Pinned Jev runner with tokenizer-budgeted evidence variants and exact reuse."""
import argparse, hashlib, json, os, platform, sys, time
from pathlib import Path
os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
sys.path.insert(0,str(Path(__file__).resolve().parents[1] / "jev"))
from prepare import verify, MODEL, REVISION
from scoring import suffix_scores
import torch, transformers
from transformers import AutoTokenizer, AutoModelForCausalLM

parser=argparse.ArgumentParser()
parser.add_argument("--jobs",required=True);parser.add_argument("--output",required=True)
parser.add_argument("--model",default=".tmp/models/llm-jev-qwen3-0.6b")
parser.add_argument("--reuse",default="");parser.add_argument("--threads",type=int,default=4)
args=parser.parse_args()
torch.set_num_threads(args.threads);torch.set_num_interop_threads(1)
source=Path(args.jobs).read_bytes();jobs=json.loads(source)
start=time.perf_counter();hashes=verify(Path(args.model))
tokenizer=AutoTokenizer.from_pretrained(args.model,local_files_only=True,trust_remote_code=False)
model=AutoModelForCausalLM.from_pretrained(args.model,local_files_only=True,trust_remote_code=False,dtype=torch.float32,attn_implementation="sdpa").eval()
implementation=hashlib.sha256(Path(__file__).read_bytes()+Path(__file__).resolve().parents[1].joinpath("jev/scoring.py").read_bytes()).hexdigest()
reuse={}
for filename in filter(None,args.reuse.split(",")):
    prior=json.loads(Path(filename).read_text(encoding="utf-8"))
    if prior.get("revision")!=REVISION or prior.get("implementationSha256")!=implementation or not prior.get("finishedAt"):
        raise ValueError("Reuse requires completed same-model, same-implementation reports")
    for r in prior["results"]:
        if r.get("reuseKey"):reuse[r["reuseKey"]]=r
report={"schemaVersion":2,"model":MODEL,"revision":REVISION,"runtime":"PyTorch CPU float32 SDPA","threads":args.threads,"torch":torch.__version__,"transformers":transformers.__version__,"python":platform.python_version(),"modelHashes":hashes,"implementationSha256":implementation,"jobsSha256":hashlib.sha256(source).hexdigest(),"inputsSha256":jobs.get("inputsSha256"),"labelsSha256":jobs.get("labelsSha256"),"sampling":jobs.get("sampling"),"loadMs":(time.perf_counter()-start)*1000,"results":[]}
out=Path(args.output);out.parent.mkdir(parents=True,exist_ok=True)
def save():out.write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
for i,job in enumerate(jobs["cases"]):
    begin=time.perf_counter()
    row={k:job[k] for k in ["id","split","field","template","expectedId","acceptedIds"] if k in job}
    row["optionIds"]=[o["id"] for o in job["options"]]
    try:
        selected=None
        for variant in job.get("promptVariants",[{"textLimit":None,"prompt":job["prompt"]}]):
            user=variant["prompt"].removesuffix("Best answer: [").rstrip("\n")
            prompt=tokenizer.apply_chat_template([{"role":"user","content":user}],tokenize=False,add_generation_prompt=True,enable_thinking=False)+"Best answer: ["
            tokens=len(tokenizer.encode(prompt,add_special_tokens=False))
            if tokens+4<=4096:selected=(variant,prompt,tokens);break
        if selected is None:raise ValueError("No declared evidence tier fits tokenizer budget; no candidate removed")
        variant,prompt,tokens=selected
        key=hashlib.sha256(json.dumps({"prompt":prompt,"options":row["optionIds"],"indexBase":job.get("indexBase",1)},ensure_ascii=False,sort_keys=True).encode()).hexdigest()
        row.update(reuseKey=key,promptSha256=hashlib.sha256(prompt.encode()).hexdigest(),promptTokens=tokens,textLimit=variant.get("textLimit"))
        if key in reuse:
            old=reuse[key]
            for k in ["probabilities","logScores","legalRootMass","suffixTokens","chosenId","valid","error"]:
                if k in old:row[k]=old[k]
            row.update(reused=True,originalElapsedMs=old.get("elapsedMs"),elapsedMs=None)
        else:
            measured=suffix_scores(model,tokenizer,prompt,len(job["options"]),job.get("indexBase",1))
            best=max(range(len(measured["probabilities"])),key=measured["probabilities"].__getitem__)
            row.update(measured,chosenId=job["options"][best]["id"],valid=True,reused=False)
        row["correct"]=bool(row.get("valid") and row.get("chosenId") in job.get("acceptedIds",[job["expectedId"]]))
    except Exception as error:row.update(valid=False,correct=False,error=f"{type(error).__name__}: {error}")
    if "elapsedMs" not in row:row["elapsedMs"]=(time.perf_counter()-begin)*1000
    report["results"].append(row);save()
    print(json.dumps({"index":i+1,"total":len(jobs["cases"]),"id":row["id"],"template":row["template"],"correct":row.get("correct"),"reused":row.get("reused"),"tokens":row.get("promptTokens"),"ms":row.get("elapsedMs"),"error":row.get("error")},ensure_ascii=False),flush=True)
report["finishedAt"]=time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime());save()
