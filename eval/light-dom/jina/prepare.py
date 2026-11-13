"""Download only the pinned public ONNX Jina reranker artifacts; never execute remote code."""
import argparse
import hashlib
import json
import time
import urllib.request
from pathlib import Path

MODEL = 'jinaai/jina-reranker-v1-tiny-en'
REVISION = 'aca45de6945b5dc6399abcd2a9c55ded5dc9111f'
FILES = {'config.json': (1206, 'git:9bd79ab5a733e01e9d2121c5ed0c9ae761fd0d08'), 'onnx/model_quantized.onnx': (33424854, 'sha256:5fa8508528828b4ad9bc97c97b6e020984e3b745fbcb53f0a907e68704f8a18a'), 'special_tokens_map.json': (280, 'git:d5698132694f4f1bcff08fa7d937b1701812598e'), 'tokenizer.json': (2030772, 'git:61287c716716abd7a3096ff2f74a1de6e20d589b'), 'tokenizer_config.json': (1215, 'git:742b5d2b49f1a9222693ca4295f3226716f2f2bc')}


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
    parser.add_argument("--directory", default=".tmp/light-dom-jina/model")
    parser.add_argument("--download", action="store_true")
    parser.add_argument("--manifest", default="eval/light-dom/jina/model.json")
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
    report = {
        "schemaVersion": 1, "model": MODEL, "revision": REVISION,
        "license": "Apache-2.0", "parameters": 33046273,
        "architecture": "JinaBERT cross-encoder, 4 layers, hidden size 384, ALiBi",
        "maximumInputTokens": 8192, "files": files,
        "totalBytes": sum(item["bytes"] for item in files.values()),
        "preparedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "remoteModelCodeExecuted": False,
        "limitations": "English-only training and published evaluations; no Korean or DOM-specific capability is claimed. This is a sub-50MB negative/control candidate for the Korean DOM task.",
    }
    out = Path(args.manifest)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(json.dumps({"verifiedFiles": len(files), "totalBytes": report["totalBytes"], "manifest": str(out)}))
