# Lightweight DOM model evaluation data

All previously evaluated **66 field tasks from 22 pages** are development data: the first experiment's 48 plus v2's subsequently consumed 18. Their observed candidates, IDs, option ordering and correct/accepted labels are retained exactly; only the task split changes to `development`. No old test set remains an independent test after its outcomes have informed this round.

The new holdout contains **18 tasks from six actual public page captures**: four new works on four established providers, a genre landing/index page and a service-terms page. It has 12 positive title/artwork/synopsis targets and six absent-detail targets. The three fields from each page are correlated, so this is six page clusters, not eighteen independent web pages. Provider-layout generalization is not established by this sample.

## Separation

`*-inputs.json` contains observed candidate and page evidence only. `*-labels.json` contains scoring and provenance; `holdout-annotations.json` adds the manual rationale and canonical title. The collector and input constructor never consult labels. Model/template authors should read only development until their design, thresholds and model revisions are frozen. The dataset author reviewed captured screenshots, HTML and local structure before any evaluated model output. This is a practical within-session separation, not an externally administered benchmark.

`manifest.json` records byte hashes, capture method, counts, recall and known limitations. The root model author is told only the new cohort size, schema, hash and candidate recall before the global model/template freeze. The holdout collector and the source list below reveal targets and should likewise stay closed during selection.

## Captures and annotation

All captures use anonymous separate Playwright Chromium contexts, Korean locale, 1440×1000 viewport, `domcontentloaded` followed by 4.5 seconds. There is no sign-in, page editing or inserted DOM content. HTML and screenshot binaries remain under ignored `.tmp/light-dom-holdout/` and are not committed. Sources were located through official search results and actual links in previously captured official pages.

- [Netflix series detail](https://www.netflix.com/kr/title/80182123)
- [Apple TV series detail](https://tv.apple.com/kr/show/나의-히어로-아카데미아/umc.cmc.q5m1ulm329damie9vyu8ooty)
- [TVING series detail](https://www.tving.com/contents/P001774558)
- [Laftel series modal](https://laftel.net/item/15371)
- [Netflix genre index](https://www.netflix.com/kr/browse/genre/6721)
- [Laftel service terms](https://policy.laftel.net/service/), which resolved to its current versioned URL

The four positive target works are absent from the previous twelve work groups. Search/genre cards can naturally mention previously seen works; those cards are distractors, not held-out positive target identities. No attempted page was discarded or replaced in this collection.

The unmodified v1 generic collector and v2 enrichment produce bounded candidate groups in traversal order. The first eight are retained, `__none__` is added, and the existing SHA256-based deterministic case/candidate shuffle is applied. The fixed candidate pool includes an accepted answer for all 12 positive fields and all 18 tasks. This is sample-specific candidate recall, not a guarantee of general DOM extraction coverage. No gold candidate was inserted or promoted.

One non-detail image field has **zero concrete candidates** and therefore only the `none` choice. Keep this actual observation in the complete cohort, but also report the 17 nontrivial decisions separately. Do not present an automatic success on the empty pool as learned classification skill. Model errors and missing outputs remain in their planned denominators.

The annotation permits equivalent official plot variants or responsive artwork renditions where they represent the same current work. Text-title graphics, service coins/logos, episode thumbnails/plots, homepage recommendations, marketing and article/legal prose are excluded. A playing preview on a detail page does not make it a full playback page. Age-gated visible placeholders do not qualify as artwork; current-work OG artwork can still be a valid observed candidate.

## Reproduction

```powershell
node eval/light-dom/collect-development.mjs
node eval/light-dom/collect-holdout.mjs
node eval/light-dom/collect-inputs.mjs
# Review actual captures and create/update annotations before a NEW dataset freeze.
node eval/light-dom/collect-freeze.mjs
node --test eval/light-dom/dataset.test.mjs
```

Rerunning collection changes live data and invalidates the existing annotation/freeze unless reviewed again. The checked-in observation and input records suffice for model inference without redownloading pages. These tasks measure current-work **element selection**, not cross-OTT identity matching, availability, navigation success or authenticated modal coverage. Once the new results are inspected for tuning, this holdout must also be considered consumed.

Page text and image URLs remain materials of their respective providers; the repository's code license does not grant additional rights over those source materials. No model weights, media files, credentials or user browser profile are part of this dataset.
