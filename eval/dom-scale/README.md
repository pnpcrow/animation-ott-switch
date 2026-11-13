# Expanded DOM adaptation experiment

This experiment expands real OTT observations, retrains a small Korean encoder from its original pinned checkpoint, and measures browser inference with bounded inputs and explicit worker lifetime. It does not enable an experimental model in the shipping extension.

## Data and separation

- New development collection: 80 pages / 240 title, image and description decisions from Laftel, Aniplus, Crunchyroll, Prime Video, Wavve, TVING, Coupang Play and Watcha.
- Independently collected blind test: 40 pages / 120 decisions. Netflix and Apple TV are excluded from development entirely; separate Laftel and TVING target works test transfer within supported services.
- The prior 84-decision DOM adaptation corpus is consumed research data. It is not used to train these new checkpoints. A six-field subset and its old checkpoint were used only to debug browser runtime contracts.
- Work/franchise groups stay together in the development split. Sixteen reserved canonical work hashes prevent target-work overlap with the blind test. Incidental recommendation text is not removed, so unseen work means an unseen **target**, not absence of every title token.
- Duplicate complete negative pages are removed by model-visible representation within provider, before the work split. Partial generic-field overlap is disclosed separately. Missing candidates, invalid origins and explicit duplicates have recorded exclusions; they do not become NONE training labels.

The raw candidate cap is 18 per field; the unchanged model cap is 12 plus NONE. Human gold does not change candidate selection or order. A target missing from the pool remains an end-to-end evaluation failure, including the three blind-test misses. Search, login, challenge and full playback states should abstain; a video preview within a genuine detail/modal does not turn it into a full player. Requested routes and observed states are recorded separately.

The collection contains five observed actual playing full-player screens across development and test. A login/subscription gate is not counted as playback. Coverage varies by service and is not a claim that every requested state was accessible everywhere. See the collection coverage and independent holdout report for the exact denominator.

Authenticated snapshots use the existing authorized Chrome sessions. Only bounded DOM candidates and contextual observations are saved; no cookies, browser storage, account fields, HTML or media stream URLs. Profile content and tracking query parameters are filtered. Source versions and original snapshot hashes preserve the separate anonymous/authenticated collection paths.

## Fixed model comparison

All recipes start from `monologg/koelectra-small-v3-discriminator` revision `7488f8db0f208beff4a1f3f9bb3ed04650a89ed7`, not the prior DOM-finetuned checkpoint. They use the same head initialization, three epochs, accepted-set listwise loss, encoder learning rate 2e-5 and head learning rate 1e-3.

| Recipe | Encoder | Maximum input |
| --- | --- | --- |
| full-natural | Original 12 layers | Natural description, 384 tokens |
| full-compact | Original 12 layers | Compact observed facts, 160 tokens |
| small-compact | Original layers 2, 5, 8, 11 | Same compact facts, 160 tokens |

Candidate identity, work identity and human page-kind annotations are not model features. Actual visible media/dialog observations are allowed. Explicit text-length tiers fit the token budget; tokens are never silently truncated. The development split contains 153 training and 57 validation decisions after 30 recorded exclusions. Final-epoch validation accuracy, then false selections, then parameter count, chooses the candidate before test outputs are opened. All three fixed recipes are reported regardless of the winner.

Models are exported to dynamic-shape ONNX and q8. Native FP32 versus q8 and full-candidate versus two-candidate microbatches are compared directly. Reduced precision and different batch shapes may change scores or choices; equivalence is measured rather than assumed. Model, data, representation, predictor and browser source hashes are frozen before blind evaluation. The independent evaluator retains failed cases in the denominator and reports field, provider, observed-state, positive/NONE and target-work-cluster uncertainty.

## Browser measurement

`scripts/dom-scale-browser.mjs` serves only local model/runtime assets to an isolated Chromium process. External requests are blocked. WASM uses one thread. The optimized path uses a dedicated module worker, sequential microbatches of two candidates, immediate tensor disposal, session release and worker termination. No WebGPU-capable device or hosted API is required.

The harness streams one field's fixture at a time; it does not copy the entire tokenized corpus into both the page and worker. With `--tokenize=on`, the browser regenerates the tensors using pinned `@huggingface/tokenizers` 0.2.0 and checks exact token ID, attention-mask and token-type parity against Python before inference. Mismatches fail the case. Timing reports tokenization and inference separately and together. DOM capture, template formatting, fixture I/O and model loading are not included in per-field inference latency. Local loading is not an Internet download benchmark.

Memory is the sum of working sets/private bytes for the isolated Chromium process set, sampled before loading, during inference, after release and after worker termination. It includes browser overhead, may count shared pages more than once, and is neither continuous peak RAM nor model-only allocation. Main-thread timer gaps diagnose blocking but are not measured user-interaction latency. Training and formal performance runs must not compete on the CPU.

The runtime development probe found no memory improvement from disabling the WASM arena/memory pattern, so the default remains enabled. The dedicated worker permits explicit teardown; it is not assumed to make the model itself faster. See the final measured report rather than interpreting development probes as final performance.

## Reproduction and records

Run Node contract checks with `npm run test:dom-scale`; Python model tests use the pinned local evaluation environment. The runtime tokenizer dependency is isolated from the extension: `npm ci --prefix eval/dom-scale/runtime`. Model weights, tokenizer assets and raw temporary captures live under ignored `.tmp/dom-scale`; manifests retain their checksums. Collection scripts require new human annotation when sites change; do not overwrite evaluated frozen records.

The `collection-train`, `auth-training`, `model`, `runtime` and `holdout` directories separate observation, training, performance and independent scoring evidence. Result files distinguish factual browser measurements from estimates and preserve unsuccessful cases.
