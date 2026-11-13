"""Audit the exact frozen Slayer input budget without loading any model weights."""
import argparse
import hashlib
import json
from pathlib import Path
from transformers import AutoTokenizer


def audit(jobs, tokenizer, limit):
    results = []
    for row in jobs:
        prompt = row["prompt"]
        options = row["options"]
        if not isinstance(prompt, str) or not prompt.endswith("Best answer: ["):
            raise ValueError(f"Invalid prompt boundary: {row['id']}")
        if not options or len({option["id"] for option in options}) != len(options):
            raise ValueError(f"Invalid options: {row['id']}")
        base = row.get("indexBase", 0)
        prefix = tokenizer.encode(prompt, add_special_tokens=False)
        suffix_lengths = []
        for index in range(base, base + len(options)):
            combined = tokenizer.encode(prompt + f"{index}]", add_special_tokens=False)
            if combined[:len(prefix)] != prefix:
                raise ValueError(f"Tokenizer changed the answer boundary: {row['id']}")
            suffix_lengths.append(len(combined) - len(prefix))
        needed = len(prefix) + max(suffix_lengths)
        results.append({
            "id": row["id"], "template": row.get("template"), "split": row.get("split"),
            "promptTokens": len(prefix), "maximumSuffixTokens": max(suffix_lengths),
            "neededTokens": needed, "withinBudget": needed <= limit,
            "promptBytes": len(prompt.encode("utf-8")), "promptSha256": hashlib.sha256(prompt.encode()).hexdigest(),
        })
    return results


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--jobs", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--model-dir", default=".tmp/slayer-model")
    args = parser.parse_args()
    source = Path(args.jobs).read_bytes()
    payload = json.loads(source)
    jobs = payload if isinstance(payload, list) else payload["cases"]
    config = json.loads((Path(args.model_dir) / "config.json").read_text(encoding="utf-8"))
    expected = {
        "tokenizer.json": "d1ffe47f6fd8cc19ba7c3e5d2537699d6a99d09b584d3319944f4e40fe6c44ea",
        "tokenizer_config.json": "beb5e8e876d2615204c8e92d0540d2a8650ee649e12dc2f87582b9c8f2f23b03",
    }
    observed = {name: hashlib.sha256((Path(args.model_dir) / name).read_bytes()).hexdigest() for name in expected}
    if observed != expected or config["max_position_embeddings"] != 2048:
        raise ValueError("Tokenizer/context do not match the pinned reviewed Slayer model")
    tokenizer = AutoTokenizer.from_pretrained(args.model_dir, local_files_only=True, trust_remote_code=False)
    limit = config["max_position_embeddings"]
    rows = audit(jobs, tokenizer, limit)
    report = {
        "schemaVersion": 1, "model": "SlayerLab/Slayer-149M-Decision-v1",
        "jobsSha256": hashlib.sha256(source).hexdigest(), "limit": limit, "tokenizerHashes": observed,
        "count": len(rows), "overBudget": sum(not row["withinBudget"] for row in rows),
        "maximumTokens": max((row["neededTokens"] for row in rows), default=0), "rows": rows,
        "note": "No weights loaded, no labels inspected, no truncation or model inference performed.",
    }
    destination = Path(args.output)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({k: report[k] for k in ["count", "overBudget", "maximumTokens", "limit"]}))


if __name__ == "__main__":
    main()
