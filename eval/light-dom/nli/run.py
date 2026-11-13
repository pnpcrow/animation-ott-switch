"""Pinned q8 NLI pair scoring. Labels never enter tokenization or inference."""
import argparse
import ctypes
import hashlib
import importlib.metadata
import json
import os
import platform
import time
from pathlib import Path

import numpy as np
import onnxruntime as ort
from tokenizers import Tokenizer

from prepare import MODEL, REVISION, digest, verify


def memory():
    if os.name != "nt":
        return {"platform": platform.system(), "measurement": "not measured"}

    class Counters(ctypes.Structure):
        _fields_ = [("cb", ctypes.c_ulong), ("PageFaultCount", ctypes.c_ulong)] + [
            (name, ctypes.c_size_t) for name in [
                "PeakWorkingSetSize", "WorkingSetSize", "QuotaPeakPagedPoolUsage",
                "QuotaPagedPoolUsage", "QuotaPeakNonPagedPoolUsage", "QuotaNonPagedPoolUsage",
                "PagefileUsage", "PeakPagefileUsage", "PrivateUsage",
            ]
        ]

    counters = Counters()
    counters.cb = ctypes.sizeof(counters)
    get_handle = ctypes.windll.kernel32.GetCurrentProcess
    get_handle.restype = ctypes.c_void_p
    read = ctypes.windll.psapi.GetProcessMemoryInfo
    read.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_ulong]
    if not read(get_handle(), ctypes.byref(counters), ctypes.sizeof(counters)):
        return {"platform": "Windows", "measurement": "GetProcessMemoryInfo failed"}
    return {"workingSetBytes": counters.WorkingSetSize, "peakWorkingSetBytes": counters.PeakWorkingSetSize, "privateBytes": counters.PrivateUsage}


def select_variant(tokenizer, pair, max_tokens):
    audits = []
    for variant in pair.get("variants", [pair]):
        encoded = tokenizer.encode(variant["premise"], variant["hypothesis"], add_special_tokens=True)
        audits.append({"textLimit": variant.get("textLimit"), "tokens": len(encoded.ids)})
        if len(encoded.ids) <= max_tokens:
            return variant, encoded, audits
    raise ValueError("No declared text tier fits token budget: " + json.dumps(audits))


def prepare_batch(encodings, input_names, pad_token=1):
    size = max(len(encoding.ids) for encoding in encodings)
    ids = np.full((len(encodings), size), pad_token, dtype=np.int64)
    mask = np.zeros((len(encodings), size), dtype=np.int64)
    segments = np.zeros((len(encodings), size), dtype=np.int64)
    for index, encoding in enumerate(encodings):
        width = len(encoding.ids)
        ids[index, :width] = encoding.ids
        mask[index, :width] = encoding.attention_mask
        segments[index, :width] = encoding.type_ids
    values = {"input_ids": ids, "attention_mask": mask, "token_type_ids": segments}
    if any(name not in values for name in input_names):
        raise ValueError("Unexpected ONNX input names")
    return {name: values[name] for name in input_names}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--jobs", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--model", default=".tmp/light-dom-nli/model")
    parser.add_argument("--threads", type=int, default=2)
    parser.add_argument("--browser-jobs")
    args = parser.parse_args()
    overall = time.perf_counter()
    raw_jobs = Path(args.jobs).read_bytes()
    jobs = json.loads(raw_jobs)
    if not 1 <= jobs["maxTokens"] <= 512:
        raise ValueError("Explicit token budget must fit the model's 512-token maximum")
    pairs = {pair["id"]: pair for pair in jobs["pairs"]}
    if len(pairs) != len(jobs["pairs"]):
        raise ValueError("Duplicate pair ID")
    planned = [pair_id for case in jobs["cases"] for pair_id in case["pairIds"]]
    if len(planned) != len(set(planned)) or set(planned) != set(pairs):
        raise ValueError("Case plans must cover each pair once")
    model_dir = Path(args.model)
    initial_memory = memory()
    verify_start = time.perf_counter()
    model_files = verify(model_dir)
    verify_ms = (time.perf_counter() - verify_start) * 1000
    token_start = time.perf_counter()
    tokenizer = Tokenizer.from_file(str(model_dir / "tokenizer.json"))
    tokenizer.no_truncation()
    tokenizer.no_padding()
    tokenizer_load_ms = (time.perf_counter() - token_start) * 1000
    session_start = time.perf_counter()
    options = ort.SessionOptions()
    options.intra_op_num_threads = args.threads
    options.inter_op_num_threads = 1
    options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    session = ort.InferenceSession(str(model_dir / "onnx/model_quantized.onnx"), sess_options=options, providers=["CPUExecutionProvider"])
    session_load_ms = (time.perf_counter() - session_start) * 1000
    input_names = [item.name for item in session.get_inputs()]
    output_name = session.get_outputs()[0].name
    report = {
        "schemaVersion": 1, "model": MODEL, "revision": REVISION,
        "modelSha256": model_files["onnx/model_quantized.onnx"]["sha256"],
        "modelFiles": model_files, "jobsSha256": hashlib.sha256(raw_jobs).hexdigest(),
        "implementationSha256": digest(Path(__file__)),
        "inputsSha256": jobs.get("inputsSha256"), "templateSha256": jobs.get("templateSha256"),
        "runtime": "ONNX Runtime native CPU q8", "providers": session.get_providers(),
        "versions": {name: importlib.metadata.version(name) for name in ["onnxruntime", "numpy", "tokenizers"]},
        "python": platform.python_version(), "threads": args.threads,
        "maximumInputTokens": jobs["maxTokens"], "classes": ["entailment", "neutral", "contradiction"],
        "scoreDefinition": "entailment logit minus contradiction logit; not calibrated correctness probability",
        "inputOrder": ["candidate premise", "field hypothesis"],
        "verifyMs": verify_ms, "tokenizerLoadMs": tokenizer_load_ms, "sessionLoadMs": session_load_ms,
        "loadMs": verify_ms + tokenizer_load_ms + session_load_ms,
        "initialMemory": initial_memory, "afterLoadMemory": memory(),
        "timingNote": "Pair elapsedMs is its share of one parent case's session.run batch. Sum shares to recover the measured parent inference duration. Tokenization and feed construction are separate; browser pretokenized timing also excludes tokenization. Native process working set is not browser memory.",
        "predictions": [], "batches": [],
    }
    browser = {"model": {"id": MODEL, "revision": REVISION, "sha256": report["modelSha256"], "outputName": output_name, "pooling": "logits"}, "jobsSha256": report["jobsSha256"], "batches": [], "reference": {}}
    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)

    def save():
        payload = (json.dumps(report, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
        temporary = out.with_name(out.name + f".{os.getpid()}.part")
        for attempt in range(6):
            try:
                temporary.write_bytes(payload)
                temporary.replace(out)
                return
            except OSError:
                if attempt == 5:
                    raise
                time.sleep(0.05 * (attempt + 1))

    for case_number, case in enumerate(jobs["cases"]):
        batch_id = case["id"] + "::" + case["template"]
        token_start = time.perf_counter()
        selected, errors = [], []
        for pair_id in case["pairIds"]:
            pair = pairs[pair_id]
            if pair["caseId"] != case["id"] or pair["template"] != case["template"]:
                raise ValueError("Pair identity disagrees with parent plan")
            try:
                variant, encoding, audits = select_variant(tokenizer, pair, jobs["maxTokens"])
                selected.append((pair, variant, encoding, audits))
            except Exception as error:
                errors.append({"id": pair_id, "caseId": pair["caseId"], "candidateId": pair["candidateId"], "template": pair["template"], "field": pair["field"], "error": str(error), "elapsedMs": 0})
        token_ms = (time.perf_counter() - token_start) * 1000
        if selected:
            feed_start = time.perf_counter()
            feeds = prepare_batch([item[2] for item in selected], input_names)
            feed_ms = (time.perf_counter() - feed_start) * 1000
            begin = time.perf_counter()
            try:
                outputs = session.run([output_name], feeds)[0]
                infer_ms = (time.perf_counter() - begin) * 1000
                if outputs.shape != (len(selected), 3) or not np.isfinite(outputs).all():
                    raise ValueError("Invalid NLI output shape or non-finite logits")
                for row, logits in zip(selected, outputs):
                    pair, variant, encoding, audits = row
                    logits = logits.astype(np.float64)
                    exponentials = np.exp(logits - logits.max())
                    report["predictions"].append({
                        "id": pair["id"], "caseId": pair["caseId"], "candidateId": pair["candidateId"], "template": pair["template"], "field": pair["field"],
                        "score": float(logits[0] - logits[2]), "logits": logits.tolist(), "probabilities": (exponentials / exponentials.sum()).tolist(),
                        "textLimit": variant["textLimit"], "tokens": len(encoding.ids), "tierAudit": audits,
                        "elapsedMs": infer_ms / len(selected), "batchId": batch_id,
                    })
                browser["batches"].append({"id": batch_id, "pairIds": [row[0]["id"] for row in selected], "repeats": 1, "inputs": {name: {"type": "int64", "dims": list(value.shape), "data": value.reshape(-1).tolist()} for name, value in feeds.items()}})
                browser["reference"][batch_id] = outputs.reshape(-1).tolist()
                report["batches"].append({"id": batch_id, "pairIds": [row[0]["id"] for row in selected], "inferenceMs": infer_ms, "tokenizationMs": token_ms, "feedMs": feed_ms, "paddedShape": list(next(iter(feeds.values())).shape), "memory": memory()})
            except Exception as error:
                infer_ms = (time.perf_counter() - begin) * 1000
                errors.extend({"id": row[0]["id"], "caseId": row[0]["caseId"], "candidateId": row[0]["candidateId"], "template": row[0]["template"], "field": row[0]["field"], "error": str(error), "elapsedMs": infer_ms / len(selected), "batchId": batch_id} for row in selected)
        report["predictions"].extend(errors)
        save()
        print(json.dumps({"case": case_number + 1, "total": len(jobs["cases"]), "batchId": batch_id, "pairs": len(selected), "errors": len(errors), "inferenceMs": report["batches"][-1]["inferenceMs"] if selected and not errors else None}), flush=True)
    if len(report["predictions"]) != len(planned) or len(set(row["id"] for row in report["predictions"])) != len(planned):
        raise ValueError("Prediction coverage differs from the frozen plan")
    report["afterInferenceMemory"] = memory()
    report["totalWallMs"] = (time.perf_counter() - overall) * 1000
    report["finishedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    save()
    if args.browser_jobs:
        browser_out = Path(args.browser_jobs)
        browser_out.parent.mkdir(parents=True, exist_ok=True)
        browser_out.write_text(json.dumps(browser, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8", newline="\n")
    print(json.dumps({"finishedAt": report["finishedAt"], "predictions": len(report["predictions"]), "errors": sum("error" in row for row in report["predictions"]), "output": str(out), "browserJobs": args.browser_jobs}), flush=True)


if __name__ == "__main__":
    main()
