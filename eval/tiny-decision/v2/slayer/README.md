# Slayer template and decision-form experiment

This is an isolated evaluation of the pinned `SlayerLab/Slayer-149M-Decision-v1` weights with the existing reviewed CPU scorer. It changes no extension runtime or default dependency. These v2 measurements use float32 PyTorch CPU, not WebGPU. Loading restores the checkpoint's declared tied embedding exactly as in the v1 runner.

## What is being tested

The previous experiment mainly changed instructions around the same serialized DOM. That does not distinguish a weak instruction from inadequate input evidence: an opaque image URL cannot reveal its picture, and a CSS class alone is weak evidence of current-work scope. V2 uses the common observed feature pack (including available alt text, dimensions, visibility, dialog membership and neighbors) and compares field instructions, short contrasting examples, JSON and plain-language representations. These observations are not heuristic-generated correctness labels. Missing facts remain unknown; the last visible dialog in DOM order is not asserted to be visually topmost.

All 48 old cases are development data. Six templates first use the same 12-case, provider/field/positive-negative sample. The two best templates expand to all 48; exactly matching screen inferences may be reused. Ranking is accuracy, fewer incorrect positive selections, more valid outputs, then stable template ID. Latency is excluded. Per-field winners are diagnostic only. A timestamped global template selection is locked before new holdout inputs or answers are read; team-wide development must also freeze before any fresh evaluation.

Each multichoice task retains all candidates and uses native 0-based numeric options. The real tokenizer selects the first fitting text-length tier from 96, 72, 48, 32 characters. The 2,048-token limit includes the entire numeric answer suffix. If no tier fits, inference explicitly fails and the case remains in the denominator. Labels are never consulted by budget selection. `*-inputs.json` archives preserve the exact selected prompts, option order, index base, token counts and hashes; `*-budget.json` records every predeclared tier. The existing suffix scorer is unchanged.

## Separate pointwise pilot

`pointwise.mjs` asks whether each observed candidate fits the requested field, using the same observed feature pack. Each candidate is scored twice with the two binary answer orders swapped. Its score is the mean of the two qualify-versus-reject log-odds. This cancels a pure fixed label-position preference algebraically; it is not a calibrated correctness probability and cannot remove all prompt-dependent bias. There are no inferred `isArtwork`, `isCorrectScope` or equivalent correctness features.

The highest-scoring candidate must strictly exceed one global threshold; tied maxima abstain. The threshold is selected only on the 12 development pilot cases. Missing or failed candidate calls invalidate the parent task instead of earning a correct abstention. All candidate calls and both answer orders count toward the parent's reported latency. Parent candidate order does not enter the prompt; stable tie abstention preserves order invariance.

Before observing pilot outputs, the fresh-evaluation gate was fixed: beat both the constant-none baseline and the best multichoice screen accuracy, with at least two correctly chosen positive elements out of six positive cases. The pilot's optimized score is optimistic, not independent validation. If the gate fails, no fresh holdout is consumed for this protocol. A passing protocol freezes its code hash and threshold before a single fresh run.

## Observed development results

The 12-case multichoice screen selected `json-evidence` (3/12 correct) and `contrast-example` (2/12 correct) for expansion. All 72 screen prompts fit the context budget; the maximum selected length including suffix was 2,028 tokens. This screen alone does not establish a successful template.

| Template           | Screen correct / 12 | Full development correct / 48 | Incorrect positive selections / 48 | Context failures / 48 |
| ------------------ | ------------------: | ----------------------------: | ---------------------------------: | --------------------: |
| `legacy-enriched`  |                   1 |                             — |                                  — |                     — |
| `field-rubric`     |                   1 |                             — |                                  — |                     — |
| `contrast-example` |                   2 |                            10 |                                 34 |                     0 |
| `json-evidence`    |                   3 |                            13 |                                 30 |                     1 |
| `natural-evidence` |                   2 |                             — |                                  — |                     — |
| `scope-first`      |                   2 |                             — |                                  — |                     — |

The final global selection is `json-evidence`, locked at `2026-11-13T12:25:32.947Z`. It also has higher development accuracy in each field than the other expanded template, so choosing between these two by field would not improve development accuracy. Its 27.1% development accuracy and 30 incorrect positive choices do not justify automatic DOM extraction. One description remained 2,079 tokens at the smallest tier and was explicitly rejected. The 96 expanded rows reused 24 byte-identical screen inferences and measured 72 new ones; all rows remain auditable individually.

After selection was locked, a paired development diagnostic reversed all candidate options for the first screen case in each field × positive/none stratum. All six pairs completed, but **0/6 retained the same chosen element**; correctness changed from 2/6 to 0/6. This is a small order-sensitivity diagnostic, not additional independent holdout data, and it did not change the chosen template. See `order.json` and `scripts/slayer-v2-order.mjs`.

The pointwise pilot made 154 calls for 77 observed candidates. Every individual call chose its first listed binary answer: swapping answer order reversed all 77 candidate decisions. Symmetric scoring removed that deterministic label choice from the final readout, but the best global development threshold still abstained on every parent task. It scored 6/12, equal to constant-none, with **0/6 correct positive selections** and 6/6 correct absent-field cases. The fresh-evaluation gate therefore failed and no pointwise fresh holdout was run.

All pointwise prompts fit at tier96 (maximum 642 tokens). Total candidate inference time was 210.96 seconds; parent-task p50/p95 were 13.86/25.66 seconds. These include both answer orders for every candidate and concurrent CPU contention, and exclude model loading. The report retains per-candidate log-odds and all threshold trials, including unsuccessful thresholds; the apparent 50% pilot accuracy is not evidence of useful content extraction.

## Reproduction

Use the isolated environment and pinned model prepared by `../../slayer/README.md`, then run from the repository root:

```powershell
node scripts/prepare-v2-jobs.mjs --sample=screen --index-base=0 --output=.tmp/v2-slayer-screen.json
node scripts/slayer-v2-eval.mjs --jobs=.tmp/v2-slayer-screen.json --output=eval/tiny-decision/v2/slayer/screen.json
node scripts/slayer-v2-select.mjs --input=eval/tiny-decision/v2/slayer/screen.json --output=eval/tiny-decision/v2/slayer/screen-selection.json --count=2
node scripts/prepare-v2-jobs.mjs --templates=json-evidence,contrast-example --index-base=0 --output=.tmp/v2-slayer-development.json
node scripts/slayer-v2-eval.mjs --jobs=.tmp/v2-slayer-development.json --output=eval/tiny-decision/v2/slayer/development.json --cache=eval/tiny-decision/v2/slayer/screen.json
node scripts/slayer-v2-select.mjs --input=eval/tiny-decision/v2/slayer/development.json --output=eval/tiny-decision/v2/slayer/selection.json --count=1
node scripts/slayer-v2-pointwise.mjs --mode=pilot --output=eval/tiny-decision/v2/slayer/pointwise-pilot.json
node --test eval/tiny-decision/v2/slayer/pointwise.test.mjs
```

Archive each completed run's input with `node scripts/slayer-v2-inputs.mjs --report=<report.json> --output=<inputs.json>`. Selection locks reject changed source results instead of silently replacing their timestamp. All output timing remains diagnostic: concurrent workloads and reuse of earlier measurements preclude a fair speed ranking.
