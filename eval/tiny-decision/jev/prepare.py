"""Explicit opt-in download of the author's pinned merged decision checkpoint."""
import argparse
import hashlib
import json
from pathlib import Path
from urllib.request import urlopen

MODEL = "Athekunal/llm-jev-qwen3-0.6b"
REVISION = "92727826acf82f170d3c05da74e5784907d3ea5c"
HASHES = {
    "chat_template.jinja": "a55ee1b1660128b7098723e0abcd92caa0788061051c62d51cbe87d9cf1974d8",
    "config.json": "8e93c2725fce6a85c8a855bd260c10f34b10dfaa5a70bf84f2192ff03170e9d9",
    "model.safetensors": "ecb07d72f94ae9bc96955ca2f9ea5f7e2901a1cee4d0a3f156c8a1aecb843b7b",
    "tokenizer_config.json": "04b1682c59acbd057f4c9072297faa73d56fc9de053094c659cdb4c464f58f86",
    "tokenizer.json": "be75606093db2094d7cd20f3c2f385c212750648bd6ea4fb2bf507a6a4c55506",
}


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify(directory):
    observed = {name: sha256(directory / name) for name in HASHES}
    if observed != HASHES:
        raise ValueError("Checkpoint files differ from the pinned reviewed revision")
    return observed


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default=".tmp/models/llm-jev-qwen3-0.6b")
    parser.add_argument("--download", action="store_true")
    args = parser.parse_args()
    destination = Path(args.output)
    if args.download:
        destination.mkdir(parents=True, exist_ok=True)
        for name, expected in HASHES.items():
            path = destination / name
            if path.exists() and sha256(path) == expected:
                continue
            temporary = path.with_suffix(path.suffix + ".partial")
            with urlopen(f"https://huggingface.co/{MODEL}/resolve/{REVISION}/{name}", timeout=120) as source, temporary.open("wb") as target:
                for chunk in iter(lambda: source.read(1024 * 1024), b""):
                    target.write(chunk)
            if sha256(temporary) != expected:
                raise ValueError(f"Downloaded checksum mismatch: {name}")
            temporary.replace(path)
    print(json.dumps({"model": MODEL, "revision": REVISION, "hashes": verify(destination)}))
