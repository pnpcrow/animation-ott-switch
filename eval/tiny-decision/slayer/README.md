# Slayer-149M-Decision evaluation

This isolated experiment evaluates actual pinned model weights. It does not add an AI dependency to the extension, and no remote inference API is used.

## Identity and limitations

- Official model: [SlayerLab/Slayer-149M-Decision-v1](https://huggingface.co/SlayerLab/Slayer-149M-Decision-v1/tree/ccfd7d3d91f3894beb1cd096b5d067333ba3d4c7), Apache-2.0, English model card, custom `slayer_balanced` architecture.
- Revision: `ccfd7d3d91f3894beb1cd096b5d067333ba3d4c7`.
- 149,333,081 parameters, 26 layers, hidden size 576, vocabulary 24,576, maximum context **2,048 tokens**. The 597,366,956-byte checkpoint is float32. Parameter count alone understates download size.
- The official repository contains no WebLLM/MLC or ONNX build. The browser experiment here uses a locally exported ONNX graph, not WebLLM. Export success is not evidence of built-in WebLLM compatibility.
- The model card reports general decision-task training and evaluation, not DOM selection or Korean OTT evaluation. Its published confidence calibration does not carry over automatically to this task.

## Readout and correctness checks

`run.py` uses the shared prompts unchanged, without a chat wrapper. Prompts end `Best answer: [`. For each candidate, it sums the actual token log probabilities of the entire numeric suffix (including `]`), then normalizes over the permitted candidates. `indexBase` comes from each job. Output probabilities are conditional closed-option scores, **not validated confidence that a title match is safe**. The selected option is the exact highest-scoring candidate; labels are consulted only after selection.

The pinned upstream wrapper and configuration were inspected before enabling local `trust_remote_code`. SHA-256 checks reject unreviewed model/code/tokenizer files, and loading runs offline. With Transformers 5.22.2, the custom wrapper does not restore its declared tied embedding/LM-head weights: it reports a missing head and otherwise initializes it randomly. We explicitly restore the checkpoint's declared embedding tie and assert the exact parameter count. Evaluating that random head would evaluate the wrong model.

The upstream forward method returns no KV cache. `scoring.py` implements an inference-only shared-prefix trie using the same weights and attention/normalization equations. The numerical comparison against the upstream full-sequence forward pass measured a maximum suffix-score difference of **2.87e-6** on a three-option diagnostic. `--reference-check` repeats this check on the first supplied job; its extra forward passes must be excluded from performance comparisons. Tokenizing the concatenated prompt/suffix must equal prefix tokens plus suffix tokens; this was also independently verified for all 1,165 candidates in the 150 calibration jobs. Inputs exceeding 2,048 tokens are recorded as failures without truncation, and remain in the accuracy denominator.

## Reproduce on Windows

Run from the repository root. Dependencies and model files stay under ignored `.tmp` directories; the extension dependency tree is unchanged.

```powershell
python -m venv .tmp/slayer-venv
.tmp/slayer-venv/Scripts/python.exe -m pip install torch==2.15.0 --index-url https://download.pytorch.org/whl/cpu
.tmp/slayer-venv/Scripts/python.exe -m pip install -r eval/tiny-decision/slayer/requirements.txt
.tmp/slayer-venv/Scripts/python.exe eval/tiny-decision/slayer/prepare.py
node scripts/prepare-tiny-decisions.mjs --dataset=eval/tiny-decision/data/dom-selection.json --output=.tmp/tiny-calibration.json --split=calibration
.tmp/slayer-venv/Scripts/python.exe eval/tiny-decision/slayer/run.py --jobs .tmp/tiny-calibration.json --output eval/tiny-decision/results/slayer-calibration-raw.json --threads 4
node scripts/slayer-report.mjs --input=eval/tiny-decision/results/slayer-calibration-raw.json --output=eval/tiny-decision/results/slayer-calibration.json
```

Lock the template using calibration only and the common `metrics.mjs` selection policy before preparing or running holdout jobs. Approved equivalent element IDs in `acceptedIds` count as correct; all original options and their order remain unchanged. Keep the raw report, selected template, dataset checksum, and completed/error rows together.

The completed full-input calibration selected `korean-structure` (6/30 correct) before the 18-case holdout. The native CPU holdout returned **3/18 correct**, with 14 completed choices, 4 context-limit failures and 8 incorrect positive selections. These results describe the shared 1-based prompt convention and do not establish the checkpoint's general capabilities. They do not justify autonomous DOM selection under that configuration.

All 18 holdout cases were also attempted in Chromium 158 with AMD RDNA3 WebGPU through the custom ONNX export. All 14 completed choices agreed with CPU; all 4 over-budget cases were rejected by both paths. The maximum suffix-score difference was 6.14e-5. GPU queue instrumentation recorded 12,420 submissions during the completed rows. The model loaded in 12.58 seconds; completed-case median was 4.91 seconds, but 9-option long inputs took up to 35.92 seconds. The repeated-prefix graph and concurrent workloads make these diagnostic timings, not a fair optimized CPU/GPU comparison.

After freezing that template, `node scripts/slayer-sensitivity.mjs` runs the common compact corpus, separate synthetic challenge, removal of DOM context, and class/permutation stress cohorts. These are separate paired sensitivity checks, not additional independent holdout examples. The compact representation reached 6/18 correct with 2 context-limit failures and still 8 incorrect positive selections. The 12-case synthetic challenge reached 3/12 correct. Removing DOM context reached 5/18; 13/14 commonly valid choices were unchanged. Class renaming retained 13/13 commonly valid choices, whereas option permutation retained only 3/14. These are observations about this fixed configuration; changes in context validity also affect overall accuracy.

`node scripts/slayer-index-sensitivity.mjs` checks the same locked prompt with only option labels changed from 1-based to 0-based, then repeats the original input to measure unconditioned probability mass at the decision root. `node scripts/slayer-author-format.mjs` separately uses the model-card-style state/question/options JSON, published English instructions, and 0-based labels. Both are fixed post-hoc format controls, not newly independent validation or template reselection. `legalRootMass` records the raw next-token probability mass assigned to distinct first tokens of permitted numeric suffixes; `jointSuffixLogMass` records complete permitted suffix probability mass before normalization. See the raw/summary reports under `../results/` for per-candidate scores and failure records.

Both numbering conventions and the fixed JSON control scored 3/18. Median legal root mass was 0.4984 for the repeated original prompt, 0.5446 for 0-based numbering and 0.0647 for JSON. The JSON control completed 15 cases and rejected 3 over-budget cases; its three correct answers were abstentions and all ten positive selections were incorrect. The original repeat reproduced all 14 completed choices. These controls did not improve measured accuracy, but do not exhaust possible training or prompt formats. Run `node scripts/slayer-format-report.mjs` after the controls to reproduce their paired summary.

## Optional browser compatibility experiment

`export_onnx.py` exports an opset-18, dynamic-sequence, float32 graph (654,464,302 bytes) and checks CPU ONNX Runtime agreement against PyTorch at lengths 4, 17 and 53. The observed maximum log-probability error was 1.72e-5. The graph stores 163,488,857 initializer elements because it materializes the tied input embedding and its transposed output projection separately; the source model still has 149,333,081 unique parameters. This is an export check, not a quality benchmark.

```powershell
.tmp/slayer-venv/Scripts/python.exe -m pip install onnx==1.23.2 onnxruntime==1.31.1
.tmp/slayer-venv/Scripts/python.exe eval/tiny-decision/slayer/export_onnx.py
npm --prefix eval/tiny-decision/slayer ci --ignore-scripts --no-audit --no-fund
.tmp/slayer-venv/Scripts/python.exe eval/tiny-decision/slayer/prepare_web_jobs.py --jobs .tmp/slayer-holdout.json --output .tmp/slayer-webgpu-jobs.json
node scripts/slayer-webgpu.mjs --jobs=.tmp/slayer-webgpu-jobs.json --output=eval/tiny-decision/results/slayer-webgpu.json --reference=eval/tiny-decision/results/slayer-holdout-raw.json
```

The harness serves only explicitly mapped local assets over loopback and blocks external browser requests. It requests ONNX Runtime Web 1.31.1's WebGPU provider and records the actual browser adapter plus direct WebGPU compute-pipeline and queue-submission calls. ONNX Runtime can assign shape/other operations to CPU, so this is a **mixed WebGPU/CPU** path. Legacy JSEP profiling callbacks may return no events under the newer native WebGPU runtime; the direct call counters establish whether GPU work actually occurred.

This simple browser graph repeats the prefix for later suffix tokens; the native runner reuses its KV trie. Their timings are not an optimized runtime comparison. The 2-case browser smoke report is a compatibility/numerical check, not a held-out accuracy estimate. Browser packaging, model quantization, memory optimization, and extension lifecycle integration remain separate work.

Primary runtime references: [ONNX Runtime WebGPU](https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html) and [large-model guidance](https://onnxruntime.ai/docs/tutorials/web/large-models.html).
