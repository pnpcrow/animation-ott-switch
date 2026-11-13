# Isolated browser encoder runtime

`scripts/light-dom-browser.mjs` runs a local ONNX encoder or reranker in an isolated Chromium process. It reuses the pinned ONNX Runtime Web 1.31.1 evaluation dependency under `eval/tiny-decision/slayer/node_modules`; the extension package does not depend on this runtime. It permits only explicitly mapped loopback assets and records rejected external requests. The task's page HTML is not uploaded to a remote inference service.

The common input format contains pretokenized batches, no labels:

```json
{
  "model": {"id":"model-id","revision":"commit","sha256":"onnx-file-sha256","outputName":"logits","pooling":"logits"},
  "batches": [{"id":"diagnostic-batch","repeats":3,"inputs":{
    "input_ids":{"type":"int64","dims":[1,3],"data":[0,25,1]},
    "attention_mask":{"type":"int64","dims":[1,3],"data":[1,1,1]}
  }}],
  "reference": {"diagnostic-batch":[0.5]}
}
```

`reference` is an optional numerical reference, never a class or DOM gold label. The browser does not receive it as a model input. `pooling: "logits"` preserves output values; `"mean"` applies attention-mask mean pooling then L2 normalization; `"cls"` selects the first token and L2-normalizes it. The model's documented pooling must determine that choice before evaluation.

```powershell
npm --prefix eval/tiny-decision/slayer ci --ignore-scripts --no-audit --no-fund
node scripts/light-dom-browser.mjs --jobs=.tmp/light-dom/jobs.json --model=.tmp/light-dom/model.onnx --provider=wasm --output=artifacts/light-dom-wasm.json
node scripts/light-dom-browser.mjs --jobs=.tmp/light-dom/jobs.json --model=.tmp/light-dom/model.onnx --provider=webgpu --output=artifacts/light-dom-webgpu.json
node --test eval/light-dom/runtime/readout.test.mjs
```

Measured quantities are deliberately separate:

- Exact ONNX file size and SHA-256, served asset bytes, and input-job hash.
- Session load time over local loopback. This is **not** internet download latency.
- First run of each batch and repeated warm runs of that exact batch. These include output readout/pooling but exclude precomputed tokenization.
- Actual intercepted GPU queue submissions and compute-pipeline creation, with pipeline labels. Requesting WebGPU does not establish that all operations ran on GPU; ONNX Runtime may execute unsupported operations on CPU.
- JS heap snapshots, logical explicitly created GPU-buffer bytes, and the complete isolated Chromium process set's Windows working set/private bytes. These are different metrics. Logical buffers do not measure physical VRAM; process memory includes browser/runtime overhead and cannot isolate a single model. GC-only buffer release is not observable by the wrapper.
- Optional maximum output difference from the same quantized ONNX model's native reference. Source FP32-to-quantized differences are measured separately during model preparation.

The runtime does not execute a selected DOM action or navigate to an OTT work. Numerical compatibility and speed do not establish extraction quality. Browser lifecycle, tokenization inside an extension worker, cache eviction and real low-end-device behavior need separate integration tests.

## KURE preparation

`prepare_kure.py` downloads only the explicitly requested official revision, verifies the author checkpoint hash, loads the stock Transformers ModernBERT architecture with `trust_remote_code=False`, exports ONNX and quantizes matrix/embedding operations. Original checkpoints and exported weights stay under ignored `.tmp`; only code and compact measurements belong in Git.

```powershell
.tmp/slayer-venv/Scripts/python.exe eval/light-dom/runtime/prepare_kure.py --download
.tmp/slayer-venv/Scripts/python.exe eval/light-dom/runtime/verify_kure.py
.tmp/slayer-venv/Scripts/python.exe eval/light-dom/runtime/run_kure.py --jobs=.tmp/light-dom-development-jobs.json --output=artifacts/kure-development.json --browser-jobs=.tmp/light-dom/kure-browser-development.json
```

The author [KURE-Reranker-nano model card](https://huggingface.co/nlpai-lab/KURE-Reranker-nano) identifies a Korean/English cross-encoder with one scalar relevance score. It is not a pretrained DOM classifier. Its published GPU retrieval throughput is not used as a browser or OTT accuracy estimate. The pinned author checkpoint is 597,306,212 bytes; deployment-size claims must use the actual exported quantized artifact, not parameter count times a nominal bit width.

The tested local export contains **151,093,062 bytes** after quantizing MatMul and Gather weights (including the embedding table), versus 597,933,389 bytes for the FP32 ONNX graph. The source has 149,323,009 measured parameters. FP32 export agreement was checked at batch sizes 1/2/4 and sequence lengths 17/129/257/384, including padding and the local-attention boundary; maximum absolute error was 7.16e-6. A separate three-pair q8 diagnostic differed from FP32 by up to 0.14754 logit, so quantized model accuracy must be evaluated directly.

The q8 development run completed all 822 planned pairs across 132 field/template cases (130 actual batches; two cases have no concrete candidates). All pairs fit the first 96-character evidence tier and 326 tokens or fewer. The first run was interrupted by a Windows JSON-write lock; it was not used for selection. The completed run uses atomic JSON publication with retry, avoiding partial-result reads. Runtime/environment requirements are recorded in `requirements-kure.txt`, with model/executable revisions and checksums in the output reports. These artifacts were not included in the extension's package.

## KURE browser development measurements

Six predeclared development fields (title/image/description for a detail page and a search page) were run in each provider. The WASM run used three iterations per batch; the WebGPU diagnostic used one per batch after the slow WASM measurements. These are runtime diagnostics on already-used development cases, not additional accuracy holdout examples. The provider uses one WASM thread. Some CPU work overlapped the other agent's small-model evaluation; values are observed on this workstation, not an isolated hardware benchmark.

| Diagnostic | WASM CPU | Requested WebGPU |
| --- | ---: | ---: |
| Model session load | 2.81 s | 3.56 s |
| First pass median per field batch | 10.46 s | 10.53 s |
| Repeated identical batch median | 11.22 s | Not measured |
| Maximum native-q8 logit difference | 0.33735 | 0.55120 |
| Entire isolated Chrome working-set baseline | 409 MB | 409 MB |
| Entire isolated Chrome working-set observed peak | 1,195 MB | 1,301 MB |
| Actual GPU submissions | 0 | 2,001 |
| Logical live GPU-buffer observed peak | 0 | 556.83 MB |

The native CPU reference used four threads, with development field-batch median 1.18 seconds. It cannot be substituted for browser latency. The quantized graph requests WebGPU successfully but emits an ONNX Runtime mixed-provider warning; intercepted queue calls prove some GPU computation, not that all operations use GPU. The measured file size is under the provisional 200 MB weight budget, yet the observed browser time and memory are unsuitable for calling it a lightweight default. These tests do not exhaust possible operator rewrites, thread configurations or inference optimizations.

Native-to-browser logit differences are not treated as numerical parity. Fresh browser output must be scored separately with the already fixed model threshold. The final fresh browser protocol is one selected-template pass over every nonempty case; failed outputs must remain in the full case denominator. Gold labels never enter the runtime.

`WorkingSet64` is summed across this isolated browser's process IDs and can count shared pages more than once; it is not unique physical RAM. `PrivateMemorySize64` is private committed memory, not necessarily resident memory. The GPU-buffer estimate must not be added to the working-set sum, especially on integrated GPUs with shared system memory. Loading may temporarily retain multiple model copies; session release does not guarantee that the browser's memory arena returns all memory to the OS. Exact process samples are retained in each report.

The first WASM development probe predates inline `pairIds` metadata. Its exact batch-to-pair mapping and job checksum are preserved in `../reports/kure-browser-development-map.json`. Later reports include `batchPlan`, each row's `pairIds`, input-job/source-job hashes, and harness/browser/readout source hashes directly. The metadata-only additions did not change tensors, output readout, model weights or scoring.

The final KURE WebGPU run completed all 17 nonempty fresh batches (128 candidate pairs) once with the locked Korean template and threshold. Model load was 3.60 seconds, the 17-batch first-pass median was 10.56 seconds and p95 was 12.95 seconds. It observed 5,312 GPU submissions, a 690.19 MB logical live-buffer peak, and maximum native-q8 output difference 0.45686. Whole-browser working set rose from 410.57 MB to an observed 1,350.68 MB, while private committed memory reached 1,617.77 MB. These remain separate, nonadditive measurements.

Applying the unchanged threshold to those actual browser logits gave 5/18 correct fields: 2/12 fields on work pages and 3/6 correct absent fields, with four wrong concrete choices. One absent image field has no candidate and does not need inference; excluding that trivial case gives 4/17. These results cover only the fixed six new public pages. They support rejecting this tested KURE configuration as the extension's lightweight default, not a claim about every possible fine-tune or optimized KURE implementation.

Primary runtime references: [ONNX Runtime WebGPU](https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html), [Transformers.js quantization choices](https://huggingface.co/docs/transformers.js/guides/dtypes). This harness uses ONNX Runtime directly, so a Transformers.js architecture entry is not required once an ONNX graph and tokenizer are available.
