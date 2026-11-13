"""Pinned public KoELECTRA weights. Stock architecture only, no remote code."""
import hashlib
import json
import shutil
import urllib.request
from pathlib import Path

MODEL = "monologg/koelectra-small-v3-discriminator"
REVISION = "7488f8db0f208beff4a1f3f9bb3ed04650a89ed7"
FILES = {
    "pytorch_model.bin": (56577499, "sha256:cb3a73908dd25ea9f5ccac1aafc164b941339f11f3499ea6f1a08a8435bb7522"),
    "config.json": (458, "git:e3ddc3ca86615fc69eb7b39cd4c078c64e93f142"),
    "tokenizer_config.json": (61, "git:18ccce5ca61739f097261d5c2008339c00f8e285"),
    "vocab.txt": (263326, "git:7842ecfa1975af77bae575314998f42c6feecdd6"),
}
ROOT = Path(".tmp/dom-adaptation/finetune/koelectra")


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def verify():
    result = {}
    for name, (size, checksum) in FILES.items():
        path = ROOT / name
        data = path.read_bytes()
        actual = digest(path)
        assert len(data) == size, name
        expected = "sha256:" + actual if checksum.startswith("sha256:") else "git:" + hashlib.sha1(f"blob {size}\0".encode() + data).hexdigest()
        assert expected == checksum, name
        result[name] = {"bytes": size, "sha256": actual}
    return result


if __name__ == "__main__":
    ROOT.mkdir(parents=True, exist_ok=True)
    for name, (size, _) in FILES.items():
        path = ROOT / name
        if not path.exists():
            temporary = path.with_suffix(path.suffix + ".part")
            with urllib.request.urlopen(f"https://huggingface.co/{MODEL}/resolve/{REVISION}/{name}", timeout=120) as response, temporary.open("wb") as output:
                shutil.copyfileobj(response, output)
            assert temporary.stat().st_size == size
            temporary.replace(path)
    files = verify()
    print(json.dumps({"model": MODEL, "revision": REVISION, "files": files}, indent=2))
