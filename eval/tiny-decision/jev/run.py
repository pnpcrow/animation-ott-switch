"""Offline-after-download CPU evaluation of the author's LLM-as-Jev checkpoint."""
import argparse
import hashlib
import json
import platform
import time
from pathlib import Path
import torch
import transformers
from transformers import AutoTokenizer, AutoModelForCausalLM
from scoring import suffix_scores, full_reference_scores
from prepare import verify

parser = argparse.ArgumentParser()
parser.add_argument("--model", default=".tmp/models/llm-jev-qwen3-0.6b")
parser.add_argument("--jobs", required=True)
parser.add_argument("--output", required=True)
parser.add_argument("--threads", type=int, default=4)
parser.add_argument("--limit", type=int)
parser.add_argument("--verify-reference", action="store_true")
args = parser.parse_args()
torch.set_num_threads(args.threads)
torch.set_num_interop_threads(1)
source = Path(args.jobs).read_bytes()
jobs = json.loads(source)
rows = jobs["cases"][:args.limit] if args.limit else jobs["cases"]
started = time.perf_counter()
model_hashes = verify(Path(args.model))
tokenizer = AutoTokenizer.from_pretrained(args.model, local_files_only=True, trust_remote_code=False)
model = AutoModelForCausalLM.from_pretrained(args.model, local_files_only=True, trust_remote_code=False, dtype=torch.float32, attn_implementation="sdpa").eval()
report = {"schemaVersion":1,"model":"Athekunal/llm-jev-qwen3-0.6b","revision":"92727826acf82f170d3c05da74e5784907d3ea5c","runtime":"PyTorch CPU float32 SDPA shared-prefix full-suffix readout","python":platform.python_version(),"torch":torch.__version__,"transformers":transformers.__version__,"threads":args.threads,"loadMs":(time.perf_counter()-started)*1000,"jobsSha256":hashlib.sha256(source).hexdigest(),"datasetSha256":jobs.get("datasetSha256"),"templateSha256":jobs.get("templateSha256"),"results":[]}
report.update(modelHashes=model_hashes,parameters=sum(p.numel() for p in model.parameters()),confidenceMeaning="Softmax over listed full suffixes, not calibrated correctness probability",timingNote="Load includes checksum verification; inference excludes optional full-reference check. Concurrent evaluation processes may contend for CPU.")
destination=Path(args.output)
destination.parent.mkdir(parents=True,exist_ok=True)
def save():
    destination.write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
for number, row in enumerate(rows):
    # Gold and provenance never enter the chat template or model tensors.
    user = row["prompt"].removesuffix("Best answer: [")
    prompt = tokenizer.apply_chat_template([{"role":"user","content":user}], tokenize=False, add_generation_prompt=True, enable_thinking=False) + "Best answer: ["
    began=time.perf_counter()
    result={"id":row["id"],"split":row["split"],"template":row["template"],"scenario":row.get("scenario"),"expectedId":row["expectedId"],"acceptedIds":row.get("acceptedIds",[row["expectedId"]]),"options":[{"id":o["id"]} for o in row["options"]]}
    try:
        output=suffix_scores(model,tokenizer,prompt,len(row["options"]),row.get("indexBase",1))
        result.update(output)
        best=max(range(len(output["probabilities"])),key=output["probabilities"].__getitem__)
        result.update(chosenId=row["options"][best]["id"],valid=True,correct=row["options"][best]["id"] in row.get("acceptedIds",[row["expectedId"]]))
        result["elapsedMs"]=(time.perf_counter()-began)*1000
        if args.verify_reference and number == 0:
            verify_began=time.perf_counter()
            reference=full_reference_scores(model,tokenizer,prompt,len(row["options"]),row.get("indexBase",1))
            error=max(abs(a-b) for a,b in zip(reference,output["logScores"]))
            report["referenceMaxAbsLogScoreError"]=error
            report["referenceCheckMs"]=(time.perf_counter()-verify_began)*1000
            if error>0.002: raise ValueError(f"Shared-cache reference mismatch: {error}")
    except Exception as error:
        result.update(valid=False,correct=False,error=str(error))
    result.setdefault("elapsedMs",(time.perf_counter()-began)*1000)
    report["results"].append(result)
    save()
    print(json.dumps({"index":number+1,"total":len(rows),"id":row["id"],"template":row["template"],"correct":result.get("correct"),"ms":round(result["elapsedMs"]),"error":result.get("error")},ensure_ascii=False),flush=True)
report["finishedAt"]=time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime())
save()
