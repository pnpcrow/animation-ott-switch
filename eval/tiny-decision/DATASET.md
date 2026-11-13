# DOM element selection dataset

This is a small, frozen exploratory benchmark, not a claim of production accuracy. It tests choosing a title, representative artwork URL or series synopsis among observed DOM candidates. It does **not** test the complete extension, cross-service identity matching, retrieval recall, logged-in playback, or whether a subscription can play the work.

## Real observations and split

`data/observations.json` contains 16 actual public-page captures from isolated anonymous Playwright Chromium contexts. No existing user browser, credentials, cookies, account data or remote LLM was used. `capture-dataset.mjs` records capture time, requested/final URL and SHA-256 of the captured HTML. Raw HTML is retained locally under ignored `.tmp/tiny-dom-captures/`, rather than shipping executable page scripts or tracking payloads. The normalized observations needed to rebuild the benchmark are versioned.

| Split       | Distinct works | Captured pages | Field decisions | None gold | At least 3 DOM candidates |
| ----------- | -------------: | -------------: | --------------: | --------: | ------------------------: |
| Calibration |              4 |             10 |              30 |         7 |                        27 |
| Holdout     |              4 |              6 |              18 |         6 |                        11 |
| Total       |              8 |             16 |              48 |        13 |                        38 |

Calibration works are 어느 마녀가 죽을 때까지, 장송의 프리렌, 약사의 혼잣말 and 흉란영애 니아 리스톤. Holdout works are 카드캡터 체리, Re: 제로부터 시작하는 이세계 생활 감독판, 던전밥 and 수수께끼 풀이는 저녁식사 후에. Every page/field of the same work stays in one split. Four works per split does not imply equal page counts: calibration contains more cross-provider pages. Laftel layouts occur in both splits; this is work-held-out evaluation, not strict provider-held-out evaluation.

All ten requested services have real observations, but only seven have positive detail-page observations. Crunchyroll returned a security verification page; Coupang Play returned Access Denied; WATCHA exposed an incomplete public search shell. Those are abstention cases, **not** successful extraction or confirmed catalogue coverage. Wavve also has a genuine search-results negative with multiple version cards.

## Situations represented

The captured pages include clean headings versus decorated document titles, provider-wide marketing metadata, duplicated stale/current metadata, hidden responsive variants, title-as-image alt text, title logos versus posters/backdrops, navigation and provider icons, episode-1 SEO headings versus series titles, episode plots versus series synopses, recommendation cards, subtitle/director-cut versions, Japanese aliases, synopsis truncation/full accessibility text, a literal missing-synopsis placeholder, a search result list, incomplete hydration, security verification and access denial. These are observed states, not invented DOM examples. Some apparent modal/detail layers retain background recommendations; there is no validated before/after SPA navigation or active-versus-stale modal transition pair in this corpus.

The Apple page combines general series information with episode/version-specific content. The gold identifies the page's own series-level display fields, not a separately verified release/year identity. Likewise, recognizing a series page does not prove that another service carries the identical season/edition.

## Collector and candidate construction

`collect.mjs` is generic and does not know the intended work, provider adapter, annotations or expected selector. It observes document/OG/Twitter metadata, headings, image alt text/src, video posters and paragraph/description-like elements. It retains node tags, roles, classes, visibility/navigation state, up to three ancestor labels and neighboring text. The selected field's value is retained (alt text for title-image candidates, src for image candidates). Image candidate nodes do not additionally carry their alt text or dimensions in this frozen version; this limits what an image classifier can infer. There is no pixel model here.

Identical values are grouped with up to three node provenances. Up to 18 values per field survive a generic semantic-source-order bound. The dataset then takes the **first eight**, before consulting gold, and deterministically shuffles option order. It never inserts a missing gold candidate or filters using known work names. `quality.expectedOutsidePool` reports misses rather than silently dropping them; the frozen corpus has zero. Candidate generation is nevertheless a recall bottleneck: this experiment measures selection **conditional on this pool**, not extraction from arbitrary complete DOM.

Compact model input prefers a visible, non-navigation provenance where one exists, otherwise the first node. Text/URLs/classes/siblings are bounded; inputs are at most 3,207 characters before model-template overhead. This preserves useful evidence while keeping tiny-model prefill manageable, but can omit decisive structure. Only three ancestor levels are retained; modal status is visible only when represented there, and hidden content may be either stale content or a valid responsive rendition. `hidden` on `head` metadata is normal and is explicitly explained in the input.

Ten cases have fewer than three field candidates: Prime description (1), Aniplus image (2), WATCHA title/image/description (2/1/1), Coupang title/image/description (1/0/2), Crunchyroll image/description (1/1). The zero-image case is a plumbing/abstention check, not evidence of model discrimination. Report the multi-candidate subset separately.

## Annotation and scoring

`data/annotations.json` was manually reviewed against the captured official HTML, node ancestry and neighboring content, with no output from an evaluated model. This is an agent-authored reference set, not an independently double-annotated human gold standard. Netflix artwork/title-logo distinctions were additionally checked against the rendered public page. Annotation notes remain outside model inputs.

Each row contains `{id, split, provenance, field, scenario, document, question, options, expectedId, acceptedIds, quality}`. Only `document`, `question` and option text are model evidence. Provenance, scenarios, expected/accepted labels, annotation notes and quality flags must never enter prompts. `__none__` is always an option for unavailable work detail or insufficient field evidence. A literal placeholder or a search result card is not a current-work plot/title.

`expectedId` is the preferred reference. `acceptedIds` additionally includes equivalent series artwork renditions or metadata/visible synopsis variants. It excludes site logos, title-only graphics and episode thumbnails. Accepted-set scoring avoids counting a valid official artwork rendition as wrong solely because another rendering was preferred. Keep raw predictions so strict preferred-ID scoring can also be audited if needed.

Fields from one page, pages of one work, and provider layouts are correlated. **48 rows are not 48 independent page observations.** The holdout has only six pages and includes six relatively easy search/blocked negatives. Template selection must use calibration only; freeze the selected template before holdout, stress or ablation evaluation.

## Controls and baselines

`baseline.mjs` provides two separately labeled deterministic controls. The full-snapshot baseline uses raw generic tag/role/metadata/visibility/ancestry and multiple duplicate-node provenances. The compact baseline uses **only the same document and option text available to models**, parsed back into generic features. Neither prediction function reads annotations, provider/work-name lists or CSS class semantics. Both use generic search/block checks and episode/marketing exclusions. The compact control is a mechanical projection of the initial frozen rules, without later score-guided changes.

The full-snapshot baseline scored 24/30 calibration and 17/18 holdout. The fairer compact-input baseline scored 25/30 and 16/18. Its difference from the full snapshot illustrates the effect of compression and missing duplicate-node evidence. These are exploratory measurements on this exact corpus, not estimates for arbitrary streaming sites.

`stress.mjs` produces `data/dom-selection-stress.json`: 96 **dependent** variants (36 holdout), consisting of candidate permutation and deterministic CSS class renaming. They preserve candidate content and labels. Semantic roles/attributes are deliberately retained; changing them would alter the evidence rather than only its presentation. They are robustness checks, not additional independent examples or actual future website updates.

`ablation.mjs` produces `data/dom-selection-ablation.json`: 18 paired holdout cases retaining the exact document context, candidate values, option order and labels but removing ancestry, siblings, visibility, class and role information. Compare these with the same locked-template original holdout predictions to test whether the models actually benefit from DOM context. Do not select a new template on this ablation.

## Reproduction

```sh
# Rebuild frozen cases from versioned observations + separate annotations.
node eval/tiny-decision/dataset.mjs
node eval/tiny-decision/stress.mjs
node eval/tiny-decision/ablation.mjs
node --test eval/tiny-decision/dataset.test.mjs
node eval/tiny-decision/baseline.mjs

# Optional new real-world capture; websites may differ and old gold must be reviewed.
node eval/tiny-decision/capture-dataset.mjs
```

Do not run the last command over a frozen evaluation in progress. Refreshing actual pages may change candidate IDs, page variants, legal availability or access checks. Preserve a versioned prior dataset and re-annotate changed observations before treating a new capture as comparable.
