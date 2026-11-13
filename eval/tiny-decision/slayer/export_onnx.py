"""Optional local ONNX export, with numerical agreement checked before use."""
import hashlib
import json
from pathlib import Path
import sys
import time
import numpy as np
import onnx
import torch
import onnxruntime as ort
from transformers import AutoModelForCausalLM
from scoring import advance
from run import EXPECTED_HASHES

torch.set_num_threads(4)
source = Path(".tmp/slayer-model").resolve()
for name, expected in EXPECTED_HASHES.items():
    if hashlib.sha256(source.joinpath(name).read_bytes()).hexdigest() != expected:
        raise ValueError("Unreviewed model revision")
model = AutoModelForCausalLM.from_pretrained(source, trust_remote_code=True, local_files_only=True, dtype=torch.float32).eval()
model.lm_head.weight = model.model.embed_tokens.weight

class LastToken(torch.nn.Module):
    def __init__(self, base):
        super().__init__()
        self.base = base
    def forward(self, input_ids):
        return advance(self.base, input_ids)[0]

wrapper = LastToken(model)
target = Path(".tmp/slayer-onnx")
target.mkdir(parents=True, exist_ok=True)
path = target / "model.onnx"
started = time.perf_counter()
torch.onnx.export(wrapper, (torch.tensor([[1, 2, 3, 4]], dtype=torch.int64),), str(path), input_names=["input_ids"], output_names=["log_probs"], dynamic_axes={"input_ids": {1: "sequence"}}, opset_version=18, dynamo=False, external_data=True)
print("Exported", time.perf_counter() - started, flush=True)
options = ort.SessionOptions()
options.intra_op_num_threads = 4
session = ort.InferenceSession(str(path), sess_options=options, providers=["CPUExecutionProvider"])
checks = []
for count in [4, 17, 53]:
    ids = torch.arange(10, 10 + count).reshape(1, -1).long()
    native = wrapper(ids).numpy()
    exported = session.run(None, {"input_ids": ids.numpy()})[0]
    error = float(np.max(np.abs(native - exported)))
    checks.append({"sequence": count, "maxAbsError": error})
    if error > 0.001:
        raise AssertionError(f"ONNX mismatch {error}")
initializers = onnx.load(str(path)).graph.initializer
report = {"model": "SlayerLab/Slayer-149M-Decision-v1", "revision": "ccfd7d3d91f3894beb1cd096b5d067333ba3d4c7", "uniqueModelParameters": sum(parameter.numel() for parameter in model.parameters()), "onnxInitializerElements": sum(int(np.prod(tensor.dims)) for tensor in initializers), "opset": 18, "dtype": "float32", "onnxruntime": ort.__version__, "bytes": path.stat().st_size, "sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "agreement": checks, "note": "CPU agreement only; browser provider validation is separate. ONNX stores both tied embedding and transposed output projection, so export storage exceeds the unique model parameter count."}
target.joinpath("export.json").write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps(report), flush=True)
