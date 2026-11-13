# Separate synthetic and compact-input controls

`data/synthetic-challenge.json` contains 12 deliberately fictional cases, authored from explicit DOM states without using evaluated-model outputs. Each has four options and at most 1,000 input characters before template overhead. Its `split: holdout` is only a runner selection flag: **these are synthetic challenges, not additional independent real-page holdout samples**. Report them in a separate cohort and use the already locked model template; do not retune on them.

Cases cover an active dialog over hidden prior content, stale Watch/service metadata, episode versus series-logo title, preview-video node replacement, unrelated recommendation plots, exact title/season/medium search matching, ambiguous matching without enough identifiers, missing synopsis, stacked inert/foreground dialogs, an explicitly observed bilingual alias, a closed detail over search results, and complete accessible text versus a clipped synopsis. Fictional example URLs are not contacted. The gold follows the explicit state; it does not assert that the same state exists on any real OTT website.

`data/dom-selection-compact.json` is a paired sensitivity corpus derived solely from the frozen original `document` and `options.text`. It removes CSS classes while preserving tags, semantic roles/labels, ancestry, field attributes, visibility, navigation, and short neighboring text. Title values are capped at 80 Unicode code points; other values at 60; sibling text at 16; URI-decoded document context at 240. Option IDs/order, reference labels and all candidates remain unchanged. No raw DOM snapshot or label-dependent selection enters the transformation.

The purpose is to measure context-budget/compression sensitivity, especially for Korean text under byte-level tokenizers. Compact rows are not new independent evidence. Use only the previously locked winner template on its 18 holdout pairs. Shortening may remove useful detail and must not be presented as a transparent lossless optimization or a retuned model result. Derivation creates all 48 rows for reproducibility; calibration rows need not be rerun or used for template selection.

```sh
node eval/tiny-decision/challenge.mjs
node eval/tiny-decision/compact.mjs
node --test eval/tiny-decision/challenge.test.mjs
```

These scripts never rewrite the original observations, annotations, real-DOM cases, stress or ablation fixtures.
