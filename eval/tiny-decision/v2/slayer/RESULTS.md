# Slayer v2 measured results

Frozen global template: `json-evidence` at `2026-11-13T12:25:32.947Z`. Runtime: PyTorch CPU (not WebGPU), float32.

All original 48 cases are development. The selected template is not re-tuned after the team-wide freeze.

| Development condition | Correct | Positive correct | Absent correct | Wrong positive choices | Errors |
| --- | ---: | ---: | ---: | ---: | ---: |
| json-evidence | 13/48 (27.1%) | 8/35 | 5/13 | 30 | 1 |
| contrast-example | 10/48 (20.8%) | 7/35 | 3/13 | 34 | 0 |
| Constant-none baseline (no model) | 13/48 (27.1%) | 0/35 | 13/13 | 0 | 0 |

The separate pointwise pilot returned 6/12, with 0/6 positive elements correct. Constant-none also scores 6/12. It made 154 binary calls and used 210.96 seconds total inference time. The predeclared fresh gate failed. These scores optimize a threshold on the pilot itself; they are not independent validation.

Binary answer reversal changed all 77 candidate decisions; 154/154 individual calls selected the first option. The fixed multichoice winner retained 0/6 element choices under candidate reversal in the six-case development diagnostic.

Fresh evaluation after team freeze at `2026-11-13T12:36:11.759Z`:

| Frozen fresh condition | Correct | Positive correct | Absent correct | Wrong positive choices | Errors |
| --- | ---: | ---: | ---: | ---: | ---: |
| Unchanged v1 Korean structure (1-based) | 4/18 (22.2%) | 1/12 | 3/6 | 7 | 5 |
| V2 legacy-enriched (0-based) | 4/18 (22.2%) | 1/12 | 3/6 | 13 | 0 |
| V2 json-evidence (0-based) | 6/18 (33.3%) | 2/12 | 4/6 | 11 | 0 |
| Constant-none baseline (no model) | 6/18 (33.3%) | 0/12 | 6/6 | 0 | 0 |

These 18 cases are a small frozen fixture cohort, not proof of production accuracy. They preserve all errors in the denominator.

On the 13 cases valid in both unchanged v1 and selected v2, correctness is 4/13 versus 4/13. Selected v2 makes 5 previously failed cases evaluable, of which 2 are correct. Against the v2 enriched control, 2 cases change from wrong to correct and 0 regress.

- All original 48 cases are development. Six templates screen on 12; top two expand to 48; one global winner is locked. Field-specific routing is not used.
- Raw observed features are used, not inferred correctness or artwork labels. Missing DOM attributes remain unknown.
- V2 uses native 0-based options and real-tokenizer tiers96/72/48/32; unchanged v1 uses its original 1-based options and uncompressed prompt. All options remain; over-budget cases fail explicitly.
- Slayer v1 winner is Korean korean-structure; legacy-enriched uses English dom-hierarchy. The v1-to-enriched comparison changes language/instruction and numbering as well as evidence, so it is not an isolated evidence ablation.
- The two v2 conditions share evidence compiler and native numbering. They compare template/serialization choices, but tokenizer-selected text tiers can also differ.
- CPU float32 inference, not new WebGPU timing. Concurrent load and reused observations preclude fair latency ranking.
