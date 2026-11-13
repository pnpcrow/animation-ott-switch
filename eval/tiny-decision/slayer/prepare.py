"""Opt-in download of the exact reviewed model revision; no execution here."""
import hashlib
import json
from pathlib import Path
import urllib.request

MODEL = "SlayerLab/Slayer-149M-Decision-v1"
REVISION = "ccfd7d3d91f3894beb1cd096b5d067333ba3d4c7"
target = Path(".tmp/slayer-model")
target.mkdir(parents=True, exist_ok=True)
files = ["config.json", "modeling_slayer_balanced.py", "README.md", "tokenizer_config.json", "tokenizer.json", "model.safetensors"]
manifest = {"model": MODEL, "revision": REVISION, "files": []}
for name in files:
    path = target / name
    if not path.exists():
        with urllib.request.urlopen(f"https://huggingface.co/{MODEL}/resolve/{REVISION}/{name}", timeout=60) as response, path.open("wb") as output:
            while chunk := response.read(4 * 1024 * 1024):
                output.write(chunk)
    content = path.read_bytes()
    manifest["files"].append({"name": name, "bytes": len(content), "sha256": hashlib.sha256(content).hexdigest()})
target.joinpath("download-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
print(json.dumps(manifest, indent=2))
