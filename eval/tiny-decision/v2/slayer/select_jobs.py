"""Choose the first predeclared prompt tier fitting the native tokenizer budget."""
import argparse
import hashlib
import json
from pathlib import Path
from transformers import AutoTokenizer
from budget import audit


parser = argparse.ArgumentParser()
parser.add_argument("--jobs", required=True)
parser.add_argument("--output", required=True)
parser.add_argument("--audit", required=True)
parser.add_argument("--model-dir", default=".tmp/slayer-model")
args = parser.parse_args()
source = Path(args.jobs).read_bytes()
payload = json.loads(source)
tokenizer = AutoTokenizer.from_pretrained(args.model_dir, local_files_only=True, trust_remote_code=False)
config = json.loads((Path(args.model_dir) / "config.json").read_text(encoding="utf-8"))
if config["max_position_embeddings"] != 2048:
    raise ValueError("Pinned Slayer context limit differs")
selected, decisions = [], []
for job in payload["cases"]:
    variants = job.get("promptVariants") or [{"textLimit": None, "prompt": job["prompt"]}]
    candidates = [{**job, "prompt": variant["prompt"]} for variant in variants]
    audits = audit(candidates, tokenizer, 2048)
    index = next((i for i, row in enumerate(audits) if row["withinBudget"]), len(variants) - 1)
    chosen = {key: value for key, value in job.items() if key != "promptVariants"}
    chosen.update(prompt=variants[index]["prompt"], promptSha256=audits[index]["promptSha256"],
                  chosenTextLimit=variants[index]["textLimit"], budget=audits[index])
    selected.append(chosen)
    decisions.append({"id": job["id"], "template": job["template"], "chosenTier": index,
                      "chosenTextLimit": variants[index]["textLimit"], "selected": audits[index],
                      "tiers": [{"textLimit": variant["textLimit"], **audit_row} for variant, audit_row in zip(variants, audits)]})
output = {**payload, "cases": selected, "unbudgetedJobsSha256": hashlib.sha256(source).hexdigest(),
          "budgetPolicy": "First ordered tier fitting 2048 tokens including complete suffix; if none fit retain smallest tier and count explicit inference failure. No labels are inspected."}
for path, value in [(args.output, output), (args.audit, {"sourceSha256": output["unbudgetedJobsSha256"], "limit": 2048, "decisions": decisions})]:
    destination = Path(path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"count": len(selected), "overBudget": sum(not row["budget"]["withinBudget"] for row in selected),
                  "tierCounts": {str(tier): sum(row["chosenTextLimit"] == tier for row in selected) for tier in [96, 72, 48, 32, None]},
                  "maximumTokens": max((row["budget"]["neededTokens"] for row in selected), default=0)}))
