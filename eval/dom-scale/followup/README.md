# Development-motivated fourth condition

This follow-up was authorized after the original full-compact and small-compact development runs both selected `__none__` for every validation case. All original designs, sources, models and results are retained. Held-out observations, gold and outputs had not been read when this condition was chosen.

`small-natural` uses original pretrained encoder layers `[2, 5, 8, 11]`, the same scalar head initialization, the original natural input text, and the original 384-token limit. It starts from the pinned pretrained checkpoint, not a DOM-trained checkpoint. Work split, exclusions, 153 training cases, 57 validation cases, 3 epochs, optimizer and training order match the original full-natural condition exactly. Only encoder depth changes.

The wrapper imports frozen original training/export/prediction implementations and changes their shared recipe registry in process memory. Original source files remain unchanged. Before training it checks exact prepared natural inputs and freezes the wrapper hashes. It checks the exact split and optimizer before training, then verifies epoch case orders afterward. It adds wrapper hashes to its own design and model freeze. `selection.json` ranks all original three conditions and this follow-up using the original development-only rule, and also records the highest-ranking four-layer candidate. All four models remain available for independent evaluation.

Run from the repository root:

```powershell
node eval/dom-scale/followup/prepare-inputs.mjs --inputs=eval/dom-scale/model/data/inputs.json --output=.tmp/dom-scale/followup/plans
.tmp/slayer-venv/Scripts/python.exe eval/dom-scale/followup/pipeline.py train --inputs eval/dom-scale/model/data/inputs.json --labels eval/dom-scale/model/data/labels.json --plans .tmp/dom-scale/followup/plans --reserved-work-hashes eval/dom-scale/holdout/reserved-work-hashes.json --output eval/dom-scale/followup --weights .tmp/dom-scale/followup/weights
.tmp/slayer-venv/Scripts/python.exe eval/dom-scale/followup/pipeline.py export --plans .tmp/dom-scale/followup/plans --labels eval/dom-scale/model/data/labels.json --output eval/dom-scale/followup --artifacts .tmp/dom-scale/followup/exports
```

After the root agent freezes all processing, the independent evaluator may prepare observed holdout inputs and predict without exposing gold to this pipeline:

```powershell
node eval/dom-scale/followup/prepare-inputs.mjs --inputs=eval/dom-scale/holdout/inputs.json --output=.tmp/dom-scale/holdout/followup-plans
.tmp/slayer-venv/Scripts/python.exe eval/dom-scale/followup/pipeline.py predict --plans .tmp/dom-scale/holdout/followup-plans --output eval/dom-scale/holdout/supplemental/predictions --model-dir eval/dom-scale/followup
```

Predictions and browser plans retain the original schema and every candidate ID. Native full-field and microbatch-two q8 predictions are both emitted. The original export implementation checks nine dynamic fp32 shape combinations and scores q8/full/microbatch modes on the development set. No production extension behavior changes in this experiment.
