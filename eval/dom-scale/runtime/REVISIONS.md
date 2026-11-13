# Runtime freeze history

The first runtime source freeze was followed by an independent contract review, before any blind model outputs were generated or inspected. The review found a tie-policy mismatch: Python selected NONE only on an exact tie, while the browser used a 1e-9 tolerance. The browser now follows the frozen Python exact-tie rule. A regression check covers both near ties and exact ties. No model, data, label, scoring threshold or candidate pool changed.

The original source manifest is retained as `initial-source-freeze.json`; `source-freeze.json` is the corrected pre-test runtime lock. Development smoke runs remain under ignored `.tmp/dom-scale/runtime` and are not presented as final model performance. Formal performance runs use the corrected source lock.
