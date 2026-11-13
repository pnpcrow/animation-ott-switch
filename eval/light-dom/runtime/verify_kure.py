"""Exercise ONNX export at different dynamic lengths/batch sizes before scoring."""
import hashlib,json,os,time
from pathlib import Path
os.environ["HF_HUB_OFFLINE"]="1"
import numpy as np,torch,transformers,onnxruntime as ort
from transformers import AutoModelForSequenceClassification
root=Path(".tmp/light-dom/kure");meta=json.loads((root/"export.json").read_text(encoding="utf-8"))
torch.set_num_threads(4);torch.set_num_interop_threads(1)
model=AutoModelForSequenceClassification.from_pretrained(root,local_files_only=True,trust_remote_code=False,dtype=torch.float32,attn_implementation="eager").eval();model.config.reference_compile=False
parameters=sum(p.numel() for p in model.parameters())
if parameters!=149323009:raise ValueError(f"Unexpected parameter count {parameters}")
options=ort.SessionOptions();options.intra_op_num_threads=4;options.inter_op_num_threads=1
session=ort.InferenceSession(str(root/"model.onnx"),options,providers=["CPUExecutionProvider"])
rng=np.random.default_rng(1729);rows=[]
for batch,length in [(1,17),(2,129),(4,257),(1,384)]:
    ids=rng.integers(2,49998,size=(batch,length),dtype=np.int64);mask=np.ones_like(ids);ids[:,0]=0;ids[:,-1]=1
    if batch>1:mask[-1,-7:]=0;ids[-1,-7:]=49999
    with torch.inference_mode():expected=model(input_ids=torch.from_numpy(ids),attention_mask=torch.from_numpy(mask)).logits.numpy()
    actual=session.run(None,{"input_ids":ids,"attention_mask":mask})[0]
    error=float(np.max(np.abs(expected-actual)));rows.append({"batch":batch,"sequence":length,"maxAbsoluteFp32Error":error})
    if error>0.005:raise ValueError(f"Dynamic export failed: {rows[-1]}")
result={"model":meta["model"],"revision":meta["revision"],"parameters":parameters,"fp32Sha256":meta["export"]["fp32Sha256"],"q8Sha256":meta["export"]["q8Sha256"],"cases":rows,"note":"Seeded arbitrary tokens validate graph shapes and mask handling, not semantic accuracy. Padded inputs and local-attention boundary lengths are included.","finishedAt":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime())}
(root/"dynamic-validation.json").write_text(json.dumps(result,indent=2)+"\n",encoding="utf-8",newline="\n");print(json.dumps(result),flush=True)
