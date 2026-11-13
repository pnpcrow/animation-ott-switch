"""Runtime development on training observations, never a model quality result."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path('eval/dom-scale/model').resolve()))
import onnxruntime as ort
from shared import read, write, tokenizer, tokenize, digest
from export import browser_plan, onnx_predictions

plan = read('.tmp/dom-scale/model/preflight-plans/full-compact.json')
plan['cases'] = plan['cases'][:6]
rows, _ = tokenize(plan, tokenizer())
options = ort.SessionOptions()
options.intra_op_num_threads = 1
options.inter_op_num_threads = 1
model = '.tmp/dom-adaptation/finetune/full-ranker-q8.onnx'
session = ort.InferenceSession(model, sess_options=options, providers=['CPUExecutionProvider'])
predictions = onnx_predictions(session, rows, 2)
meta = {'id': 'consumed-old-model-runtime-probe', 'sha256': digest(model), 'outputName': 'scores'}
write('.tmp/dom-scale/runtime/tokenizer-probe.json', browser_plan(rows, meta, predictions, 2))
