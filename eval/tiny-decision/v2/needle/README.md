# Needle 3: field-specific template design

This round changes only the observation serializer and tool schemas around the same pinned Needle 3 model and Cactus 4.1 WASM CPU runtime. It does not alter the model, native confidence threshold, decoding limit, or per-query reset. The evaluated function calls are read as classifications; no function, DOM action, or navigation is executed.

## Frozen design

Four deliberately different templates are compared:

- `field-enum`: one tool dedicated to the requested field, one neutral candidate enum, compact observed facts.
- `contrast-enum`: the same tool shape with a short field-specific positive/negative example using fictional content.
- `candidate-tools`: one no-argument tool per candidate. The question occurs once in the input, rather than being repeated in each tool description as in v1.
- `relation-enum`: one candidate enum with parent/context relationships expressed in short sentences.

Original candidate IDs such as `t1` are mapped to neutral `node_01` values only at the model boundary; the original ID is restored when scoring. This avoids presenting field IDs that were previously confused with conversation-turn references. The mapping depends only on observed candidate order. Unknown tools, fabricated nodes, multiple calls, engine failures and ungrounded arguments are rejected. Suppressed proposals remain diagnostics and are never converted into correct abstention.

After development, a parser audit found that the frozen candidate-tool parser's prefix matching could accept an invented `choose_title_absent` name. `choice-guard.mjs` now enforces exact membership in the actual request's tool names before that parser, including suppressed diagnostics. This guard lives outside the frozen prompt compiler and changes no model input, confidence gate or selection. `reports/development-schema-audit.json` checks all 48 original responses and records zero unregistered names, so the prior scores/selection are unchanged. Three regression cases cover the invented alias, valid names, native failure and suppressed calls. Fresh reports record the guard and runner hashes separately from the unchanged template/feature hashes.

The shared `featurePack` exposes observed tags, source attributes, visible headings, hidden/navigation/inert state, DOM parents, dialog position, image alt text and dimensions. It provides no `isMain`, `isArtwork`, correct-answer hint, provider-specific selector or reference label. Our bounded serialization still removes some text and geometry detail; it is not a lossless full-DOM representation.

The intended payload budget is 1,800 Unicode code points and the hard limit is 2,200. The budget sums serialized tools JSON and plain input text, matching the two native ABI string arguments; the unchanged generation-limit configuration is not prompt content. The summaries also measure complete `{tools,input}` JSON serialization separately, including its wrapper/escape overhead. UTF-8 bytes are reported separately. The predeclared text tiers are 96/72/48/32; the first fitting tier is used and recorded without removing candidates. A request still over budget at tier 32 is an explicit failure. Native input token count and internal context truncation remain unobservable through this C ABI, so character counts cannot prove absence of internal truncation.

## Development and fresh validation

All 48 v1 examples, including the previously seen holdout, are now development data. `../sampling.mjs` selects 12 examples without model predictions: two per field × positive/none, with the second preferring another hostname and work. The selected IDs and excluded rows are recorded before inference. Each of four templates sees exactly those 12 examples.

The best development template is frozen by accuracy, fewer false selections, valid outputs, latency and stable-name tie break. The fresh validation input and labels are read only after that lock exists. A separate validation invocation checks the exact feature-source and template hashes against the completed development report. Do not modify or format those sources between development and validation.

The initial payload audit of the 48 development calls had no hard-limit errors and a maximum of 1,942 characters. Four candidate-tool requests exceeded the 1,800 target (1,827–1,942); the other 44 fit the target. These are measured request sizes, not model-token estimates.

```powershell
node --test eval/tiny-decision/v2/sampling.test.mjs eval/tiny-decision/v2/needle/templates.test.mjs eval/tiny-decision/v2/needle/choice-guard.test.mjs eval/tiny-decision/v2/needle/diagnostics.test.mjs
node scripts/needle3-v2-eval.mjs --development=eval/tiny-decision/v2/data/development-inputs.json --dry-run --output=artifacts/needle-v2-payloads.json
node scripts/needle3-v2-eval.mjs --development=eval/tiny-decision/v2/data/development-inputs.json --output=artifacts/needle-v2-development.json
node scripts/needle3-v2-eval.mjs --selection=artifacts/needle-v2-development.json --holdout=eval/tiny-decision/v2/data/holdout-inputs.json --output=artifacts/needle-v2-holdout.json
```

The runner reads the matching `-labels.json` sidecar only for stratification/scoring, and only constructs model inputs through the observation-only feature function. Explicit `--development-labels` / `--holdout-labels` arguments override the sidecar path. Downloading the official binaries remains an explicit v1 setup command (`node scripts/needle3-eval.mjs --download-model`); this v2 runner only verifies existing local binaries.

Template screening on 12 reused cases is exploratory and may still overfit the development layouts. Improvements must be reported on the fresh cases, with positive-field correctness and correct abstention separated. Comparison with v1 on new pages must use matched cases; v1's old 18-case result is not a directly comparable baseline for a different dataset.

These cases pair mostly Korean page values with English task instructions and short fictional contrast examples. They do not establish performance across languages, full live browser DOMs or other tool-routing tasks. The v1/v2 comparison changes both prompt structure and the bounded observation representation, so it measures the combined input design rather than isolating wording alone. Source-page fields are correlated; 18 field decisions from six fresh pages are not 18 independent websites.

## Development results

The 48 official-engine calls completed on 2026-11-13. The fixed selection policy chose `field-enum` at `2026-11-13T12:22:49.548Z`, before opening fresh inputs. The source and feature hashes are stored in `reports/development.json` and `reports/development-summary.json`.

| Template        | Final positive / 6 | Final none / 6 | Observed proposal positive / 6 | Observed proposal none / 6 | Wrong concrete choices | Median ms | Max chars |
| --------------- | -----------------: | -------------: | -----------------------------: | -------------------------: | ---------------------: | --------: | --------: |
| field-enum      |                  0 |              2 |                              0 |                          6 |                      0 |    15,986 |     1,358 |
| contrast-enum   |                  0 |              1 |                              0 |                          6 |                      0 |    16,247 |     1,459 |
| candidate-tools |                  0 |              0 |                              1 |                          2 |                      2 |    12,890 |     1,942 |
| relation-enum   |                  0 |              1 |                              0 |                          6 |                      0 |    15,008 |     1,416 |

“Observed proposal” includes a single suppressed call that maps to a supplied candidate ID. It is not a valid final output, a pure-model logit or proof of correct evidence grounding. The three enum templates proposed `absent` for all twelve cases; their six proposal-level matches therefore reflect the six negative cases, not successful title/image/description recognition. None of these four tested designs solved a positive field through the native engine gate on development. This result does not establish that all possible Needle templates must fail.

The selected template used 252–328 tool-JSON characters (median 319), including descriptions. Its tool schema with description values emptied used 169–245 characters (median 239); this counts names, keys and enum values and is not a native-token measurement. All selected-template development calls fit 1,358 characters / 2,036 UTF-8 bytes across the two native argument strings, or 1,389 characters / 2,067 bytes as complete `{tools,input}` JSON. CPU timings were observed during a shared development session and are not an isolated performance benchmark.

For the matched v1 control, the predeclared subset is the first positive and first explicit none case in frozen input order for each of title/image/description. The control uses the original `tool-routing` serializer, engine and runner without tuning. The wrapper writes the selection protocol before executing it and can summarize the same six cases from the completed v2 holdout:

```powershell
node scripts/needle3-v2-control.mjs --selection=eval/tiny-decision/v2/needle/reports/development.json --holdout=eval/tiny-decision/v2/data/holdout-inputs.json --output=eval/tiny-decision/v2/needle/reports/v1-matched-control.json --comparison=eval/tiny-decision/v2/needle/reports/holdout.json
```

Fresh validation must wait until all models' development selections are locked, so another model's fresh results cannot indirectly influence this round's template design.
