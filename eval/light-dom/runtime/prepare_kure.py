"""Download a pinned author checkpoint, export stock ModernBERT, and quantize locally."""
import argparse, hashlib, json, os, time, urllib.request
from pathlib import Path

MODEL="nlpai-lab/KURE-Reranker-nano"
REVISION="8514b9e113f3b27c441ed9c2b50f81d80388b2fd"
WEIGHT_SHA="41e752090da96fcab4813a9ba82259c31c6d28453c18189322ae63d5599a30c0"
FILES=["config.json","tokenizer.json","tokenizer_config.json","special_tokens_map.json","added_tokens.json","vocab.txt","model.safetensors"]
parser=argparse.ArgumentParser();parser.add_argument("--download",action="store_true");parser.add_argument("--directory",default=".tmp/light-dom/kure");parser.add_argument("--skip-export",action="store_true");args=parser.parse_args()
root=Path(args.directory);root.mkdir(parents=True,exist_ok=True)
def sha(path):
    h=hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda:f.read(1024*1024),b""):h.update(block)
    return h.hexdigest()
for filename in FILES:
    path=root/filename
    if not path.exists():
        if not args.download:raise FileNotFoundError(f"Explicit --download needed for {filename}")
        url=f"https://huggingface.co/{MODEL}/resolve/{REVISION}/{filename}"
        with urllib.request.urlopen(url,timeout=90) as response,path.with_suffix(path.suffix+".part").open("wb") as out:
            while block:=response.read(1024*1024):out.write(block)
        path.with_suffix(path.suffix+".part").replace(path)
        print(json.dumps({"downloaded":filename,"bytes":path.stat().st_size}),flush=True)
if sha(root/"model.safetensors")!=WEIGHT_SHA:raise ValueError("Author checkpoint checksum mismatch")
hashes={f:sha(root/f) for f in FILES}
(root/"source.json").write_text(json.dumps({"model":MODEL,"revision":REVISION,"files":{f:{"sha256":hashes[f],"bytes":(root/f).stat().st_size} for f in FILES}},indent=2)+"\n",encoding="utf-8",newline="\n")
if args.skip_export:raise SystemExit(0)
os.environ["HF_HUB_OFFLINE"]="1";os.environ["TOKENIZERS_PARALLELISM"]="false"
import numpy as np
import torch,transformers,onnx,onnxruntime as ort
from transformers import AutoTokenizer,AutoModelForSequenceClassification
from onnxruntime.quantization import quantize_dynamic,QuantType
torch.set_num_threads(4);torch.set_num_interop_threads(1)
tokenizer=AutoTokenizer.from_pretrained(root,local_files_only=True,trust_remote_code=False)
model=AutoModelForSequenceClassification.from_pretrained(root,local_files_only=True,trust_remote_code=False,dtype=torch.float32,attn_implementation="eager").eval()
model.config.reference_compile=False
class Wrapper(torch.nn.Module):
    def __init__(self,model):super().__init__();self.model=model
    def forward(self,input_ids,attention_mask):return self.model(input_ids=input_ids,attention_mask=attention_mask,return_dict=False)[0]
wrapped=Wrapper(model).eval()
examples=[("현재 열린 작품의 줄거리는 무엇인가요?","어린 마녀는 저주를 풀기 위해 사람들과 여행을 시작한다."),("What is the work's title?","The River of Stars"),("대표 이미지를 찾습니다.","서비스 로고, 탐색 메뉴, 너비 32 높이 32")]
encoded=tokenizer([p[0] for p in examples],[p[1] for p in examples],padding=True,truncation=True,max_length=256,return_tensors="pt")
inputs={k:v for k,v in encoded.items() if k in ["input_ids","attention_mask"]}
reference=wrapped(**inputs).detach().numpy()
fp=root/"model.onnx";q8=root/"model_q8.onnx"
start=time.perf_counter()
torch.onnx.export(wrapped,tuple(inputs[k] for k in ["input_ids","attention_mask"]),fp,input_names=["input_ids","attention_mask"],output_names=["logits"],dynamic_axes={"input_ids":{0:"batch",1:"sequence"},"attention_mask":{0:"batch",1:"sequence"},"logits":{0:"batch"}},opset_version=18,dynamo=False,external_data=False)
del wrapped,model
print(json.dumps({"exportedBytes":fp.stat().st_size,"exportSeconds":time.perf_counter()-start}),flush=True)
options=ort.SessionOptions();options.intra_op_num_threads=4;options.inter_op_num_threads=1
native=ort.InferenceSession(str(fp),options,providers=["CPUExecutionProvider"])
actual=native.run(None,{k:v.numpy() for k,v in inputs.items()})[0]
fp_error=float(np.max(np.abs(actual-reference)))
if fp_error>0.005:raise ValueError(f"FP32 ONNX export mismatch: {fp_error}")
del native
quantize_dynamic(str(fp),str(q8),op_types_to_quantize=["MatMul","Gather"],weight_type=QuantType.QInt8,per_channel=True,extra_options={"MatMulConstBOnly":True})
quant=ort.InferenceSession(str(q8),options,providers=["CPUExecutionProvider"])
quantized=quant.run(None,{k:v.numpy() for k,v in inputs.items()})[0]
report={"model":MODEL,"revision":REVISION,"parameters":149323009,"source":json.loads((root/"source.json").read_text()),"torch":torch.__version__,"transformers":transformers.__version__,"onnx":onnx.__version__,"onnxruntime":ort.__version__,"export":{"opset":18,"stockArchitecture":"ModernBertForSequenceClassification","trustRemoteCode":False,"attentionImplementation":"eager","fp32Bytes":fp.stat().st_size,"fp32Sha256":sha(fp),"q8Bytes":q8.stat().st_size,"q8Sha256":sha(q8),"quantizedOperators":["MatMul","Gather"],"perChannel":True},"diagnostic":{"pairs":examples,"sourceLogits":reference.tolist(),"onnxLogits":actual.tolist(),"q8Logits":quantized.tolist(),"maxFp32Error":fp_error,"maxQ8Error":float(np.max(np.abs(quantized-reference))),"note":"Three illustrative pairs check export numerics only; not a DOM accuracy evaluation."},"finishedAt":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime())}
(root/"export.json").write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n",encoding="utf-8",newline="\n")
print(json.dumps(report["export"]),flush=True)
