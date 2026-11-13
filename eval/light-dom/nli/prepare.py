"""Download only the pinned public ONNX NLI artifacts; never execute remote code."""
import argparse
import hashlib
import json
import time
import urllib.request
from pathlib import Path

MODEL = "onnx-community/multilingual-MiniLMv2-L6-mnli-xnli-ONNX"
REVISION = "ca5daf3d11b6c4b3143b1f4602a2edfb64c3ad7e"
AUTHOR_MODEL = "MoritzLaurer/multilingual-MiniLMv2-L6-mnli-xnli"
AUTHOR_REVISION = "0a71e92a985b6e1ad1828cf67ce9c459639c1dca"
FILES = {
    "config.json": (989, "git:c6b2a9ebeec877127ad50a3c88469599e6a887d0"),
    "tokenizer_config.json": (1286, "git:42ec646ea08bee4bae08b125e10bc40cca947677"),
    "special_tokens_map.json": (964, "git:b1879d702821e753ffe4245048eee415d54a9385"),
    "tokenizer.json": (17082832, "sha256:d0091a328b3441d754e481db5a390d7f3b8dabc6016869fd13ba350d23ddc4cd"),
    "onnx/model_quantized.onnx": (107415176, "sha256:55614f3c7da74184742eaa0006b978744437aa91de9ba4913db42f94d7844a8f"),
}


def digest(path):
    value = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def verify(directory):
    result = {}
    for name, (size, expected) in FILES.items():
        path = directory / name
        if not path.is_file() or path.stat().st_size != size:
            raise ValueError(f"Missing or wrong-sized pinned artifact: {name}")
        actual = digest(path)
        if expected.startswith("git:"):
            data = path.read_bytes()
            blob = hashlib.sha1(f"blob {len(data)}\0".encode() + data).hexdigest()
            if blob != expected[4:]:
                raise ValueError(f"Git blob checksum mismatch: {name}")
        elif actual != expected[7:]:
            raise ValueError(f"SHA256 mismatch: {name}")
        result[name] = {"bytes": size, "sha256": actual}
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--directory", default=".tmp/light-dom-nli/model")
    parser.add_argument("--download", action="store_true")
    parser.add_argument("--manifest", default="eval/light-dom/nli/model.json")
    args = parser.parse_args()
    directory = Path(args.directory)
    if args.download:
        for name, (size, expected) in FILES.items():
            path = directory / name
            if path.is_file() and path.stat().st_size == size:
                continue
            path.parent.mkdir(parents=True, exist_ok=True)
            temporary = path.with_name(path.name + ".part")
            url = f"https://huggingface.co/{MODEL}/resolve/{REVISION}/{name}"
            request = urllib.request.Request(url, headers={"User-Agent": "animation-ott-switch-light-dom-eval"})
            with urllib.request.urlopen(request, timeout=120) as response, temporary.open("wb") as handle:
                for chunk in iter(lambda: response.read(1024 * 1024), b""):
                    handle.write(chunk)
            if temporary.stat().st_size != size:
                raise ValueError(f"Incomplete download: {name}")
            temporary.replace(path)
            print(json.dumps({"downloaded": name, "bytes": size}), flush=True)
    files = verify(directory)
    config = json.loads((directory / "config.json").read_text(encoding="utf-8"))
    if config["id2label"] != {"0": "entailment", "1": "neutral", "2": "contradiction"}:
        raise ValueError("Unexpected NLI class order")
    report = {
        "schemaVersion": 1,
        "model": MODEL,
        "revision": REVISION,
        "authorModel": AUTHOR_MODEL,
        "authorRevision": AUTHOR_REVISION,
        "license": "MIT (author model; converted card retains the text but omits parsed license metadata)",
        "parameters": 106995075,
        "architecture": "XLMRobertaForSequenceClassification, 6 layers, hidden size 384",
        "classes": config["id2label"],
        "maximumInputTokens": 512,
        "files": files,
        "totalBytes": sum(item["bytes"] for item in files.values()),
        "preparedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "remoteModelCodeExecuted": False,
        "limitations": "NLI fine-tuning and reported XNLI evaluation cover 15 languages without Korean; Korean capability relies on multilingual pretraining/transfer and must be measured here. No DOM-specific training is claimed.",
    }
    out = Path(args.manifest)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(json.dumps({"verifiedFiles": len(files), "totalBytes": report["totalBytes"], "manifest": str(out)}))
