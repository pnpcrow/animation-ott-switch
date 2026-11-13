# Expanded training collection, November 13 2026

The first frozen cohort contains **58 new anonymous public captures + 2 authenticated Laftel captures = 60 pages / 180 field decisions**. Captures are real browser observations, not generated DOM templates. This is a limited convenience sample, not evidence of complete support for all OTT states.

The final collection adds **7 public captures + 13 existing-Chrome-profile captures**, totaling **80 pages / 240 field decisions**. `collection-manifest.json` connects the two immutable cohort manifests, `final-coverage.json` gives the combined denominator, and `audit.json` verifies source hashes, schema and a bounded privacy scan. Add `additional-inputs.json` / `additional-labels.json` to the initial files by unique case ID. The frozen raw cases retain duplicate and collector-miss records; downstream training exclusions are explicit.

Run from the repository root:

```powershell
node eval/dom-scale/collection-train/discover.mjs
node eval/dom-scale/collection-train/collect.mjs
node eval/dom-scale/collection-train/sanitize.mjs
node eval/dom-scale/collection-train/annotate.mjs
node eval/dom-scale/collection-train/freeze.mjs
```

Re-collection is a new cohort and requires fresh manual review; running these commands must not silently replace an already evaluated frozen corpus. `collect.mjs --only=<id>` and `--providers=aniplus,wavve` support controlled retry before freezing. Authenticated captures require the separate read-only CUA collector and are not reproduced by anonymous Playwright.

## Scope and labels

Eight training services were selected before collection. Netflix and Apple TV, and the reserved work identities listed in the frozen manifest, were excluded as targets/search queries. Work groups retain seasons/movies in the same franchise together. Incidental recommendations are not edited away; therefore "unseen work" means unseen target identity, not guaranteed absence of all title tokens.

The collector preserves its first 18 observed candidate values in each field. Model inputs contain the first 12 plus `__none__`; deterministic option shuffling changes presentation only. Manual answers do not influence extraction, order, cap or input text. Original field candidates absent from the model pool remain misses, never relabeled as none. All accepted answers in this cohort are inside the pool.

Annotations were made by reviewing captured DOM values, contextual text, routes/media state and relevant screenshots **before any model predictions**. A clean current-work title, official representative artwork and series/movie synopsis are positive. Search pages, login gates, challenges, denied access and full players abstain for all three fields. An unavailable Laftel work still has an observed title/artwork but its `{줄거리}` placeholder is not a description. A muted Laftel preview inside an actual work modal remains a positive detail. Wavve's `/player/vod?...landing=season` was a series detail with zero video elements, so URL text alone does not make it a player.

`annotations.json` holds page-specific decisions and reasons, `labels.json` holds field answers, and `inputs.json` deliberately excludes annotations/provider/work/page-kind metadata. `pageEvidence.media` is an actual DOM observation. The two authenticated snapshots use a distinct privacy-preserving collector version; their hashes are separately frozen.

## Coverage and limitations

| Service | Captures | Observed coverage |
| --- | ---: | --- |
| Laftel | 16 | search, work modal, detail, unavailable work, login, player login gate, one actual authenticated playing episode |
| Aniplus | 6 | search and detail |
| Crunchyroll | 6 | anonymous challenge only; no claim of successful work/player coverage |
| Prime Video | 8 | search and five work details; subscription required for playback |
| Wavve | 6 | search, two season details, login |
| TVING | 7 | search and four details; playback requires subscription |
| Coupang Play | 4 | anonymous access denied only |
| Watcha | 7 | search shell and four details |

There are 18 search, 3 work-modal, 20 detail, 2 unavailable-detail, 2 login, 4 player-login-gate, 6 challenge, 4 denied and 1 actual full-player captures. **The four anonymous player shells are not counted as successful playback.** Failed playback-control clicks remain in observation `actions`; they do not create fictitious player captures. One repeated unavailable Laftel state is marked `duplicateOf` and its three decisions excluded from training. Challenge/blocked repetitions remain in the attempt denominator and should be deduplicated or grouped by the training pipeline, not presented as ten different successful work examples.

Manual navigation corrections happened before annotation/predictions: Aniplus search text included genre text and Wavve first matching alt node was hidden, so the observed visible search-card selectors were corrected and those providers recaptured. A mistyped TVING URL `P001653526` produced the error route; the verified discovery URL `P001654042` replaced it. These replaced exploratory navigation failures are disclosed here and are not counted as legitimate detail captures.

Full public HTML and screenshots remain under ignored `.tmp/dom-scale/train`; they are not part of the dataset publication. Annotation-only body/buttons are removed from committed observations after review. Public Laftel commenter profile names/images are redacted without changing candidate IDs or order. Anonymous collection uses isolated browser contexts and reads no user profile. Authenticated collection stores no HTML, cookies, account fields, storage or video URLs. Public CDN image URLs, including Watcha image-transformation tokens, remain as observed artwork references.

## Final additional cohort

| Service | Final total | Additional observed states |
| --- | ---: | --- |
| Laftel | 16 | No change from first cohort |
| Aniplus | 8 | Two actual empty search results; failed card openings remain attempts |
| Crunchyroll | 10 | Signed-in detail, real full episode playback, empty search and populated search |
| Prime Video | 11 | Existing-profile detail with preview, actual submitted search, SPA detail with stale previous-work OG metadata |
| Wavve | 10 | Two searches, another actual season detail, login redirect |
| TVING | 8 | Another actual search |
| Coupang Play | 7 | Signed-in search, detail with preview, real full episode playback |
| Watcha | 10 | Hydrated search and two details with playing previews; login/subscription controls still visible |

The actual full-player count is three (Laftel, Crunchyroll, Coupang), with `paused=false`, positive elapsed time and `readyState=4`. Auto-playing previews on Prime/Watcha/Coupang details are deliberately separate. Existing Chrome profile does not imply a subscription: Watcha still exposed a login link and subscription-required playback; Prime required membership. Neither is counted as full episode playback.

The Coupang current-work title and synopsis were visibly present, but the collector's first 18 candidates contained recommendation titles and episode plots. There was also no valid representative artwork in those observations; the exact omitted static artwork URL was not retained and is explicitly unresolved. These three decisions use `__missing__`, `missingGold` and `allAcceptedOutsidePool`, remain in the collection-failure denominator, and are excluded from training. They are never converted to `none` or injected into candidates.

The Prime SPA hard case navigated from Hazbin Hotel through a real search to Blade of the Immortal: visible heading, hero and synopsis changed, while OG image/description still belonged to Hazbin Hotel. Manual labels select the visible current-work values. This is an observed site state, not an artificially edited template.

The full collection has 91 answerable positive decisions, 146 none decisions and 3 missing-gold decisions. Three decisions from an unchanged unavailable Laftel page are marked duplicate. These raw counts precede the training pipeline's whole-page negative deduplication and work-group split.

Authenticated-source provenance is versioned: `auth-collector-v3.mjs` is the exact collector copy used for the 13 later snapshots. The first two Laftel snapshots used the source whose original SHA was already frozen. `audit.mjs` reconstructs that source by reverting only the subsequent Netflix profile-selector privacy edit and accepts the recovered file **only when its bytes match the original frozen hash**; that exact source is preserved as `auth-collector-v1.mjs`. No candidate, gold or model input changed during this audit.
