# Collection/schema/annotation suitability review

Reviewed after both cohorts were frozen. No predictions were supplied to the collecting/annotating agent, and no candidate or gold was changed in this review.

## Suitable for the bounded experiment

- Original candidate order and first-18 observations are retained, first-12 inputs are label independent, and `none` appears exactly once. IDs are globally unique across the two cohorts.
- Metadata remains separate from input: page kind, target work, provider identity used for split, auth state and manual answers are only in labels/annotations. Natural page URLs and service text are still observations; the compact training representation is responsible for its declared URL/provider redaction.
- Every answer references an observed option, except the three explicitly recorded missing-gold decisions. Multiple valid official artwork or plot variants are accepted. A missing target never becomes a `none` answer.
- Actual playing video, muted previews, idle video elements, login gates and `/player`-named season-detail routes are distinguished by observed UI and media state. Player coverage claims are restricted to three actual episodes.
- Source/capture hashes are linked by both cohort manifests and the combined manifest. A recovered historical collector copy must match the original frozen SHA exactly. The bounded privacy scan passes; it is not a claim of formal automated PII detection.

## Remaining limitations, preserved for evaluation

1. **Candidate recall fails on a real Coupang detail.** The title and series synopsis are rendered in elements missed by generic heading/meta/paragraph selectors. Recommendations consume title slots and episode plots consume description slots. The exact current-work static image URL was not captured; image missing-gold therefore expresses an unresolved collection failure, not a known recovered URL. Model accuracy cannot repair missing input evidence. These cases remain excluded from supervised fitting and visible in failure counts.
2. **Collection is not full DOM understanding.** Ancestor chains are only four levels, semantic roles are sparse, many UI overlays have no ARIA dialog, and CSS background artwork is not generally collected. Original v2 enrichment and auth direct-read observations differ; source variants are explicitly marked.
3. **Coverage is uneven.** There are 13 named target work groups, but several services have only three or four named targets, and Coupang has one successfully opened work. Aniplus/TVING/Wavve actual full playback remains unobserved. Watcha/Prime subscription limitations persist. The sample cannot justify universal service/state coverage.
4. **Repeated negative shells require deduplication.** The original attempt denominator preserves blocked/challenge/search/login shells. Whole-page duplicate negative states must stay in one fold or be canonicalized before fitting. Partially shared generic fields in otherwise distinct pages should not erase useful work observations.
5. **Target holdout is not lexical absence.** Incidental recommendations can mention held-out titles. The work split isolates target/search identity and all season/movie variants, while provider-level holdouts isolate Netflix/Apple entirely. Reports must use that precise meaning.
6. **Manual review has finite certainty.** Labels were selected from DOM observations/context and selected screenshots before predictions, by one collecting agent. Independent review is still useful before production claims, especially main-artwork alternatives and the unresolved Coupang artwork miss. The experiment should report candidate recall and raw failures alongside classification scores.

The appropriate next step after this evaluation is to improve generic candidate collection on a separate development cohort, then recapture and refreeze. Changing extraction or annotations against the present blind-test answers would invalidate that test.
