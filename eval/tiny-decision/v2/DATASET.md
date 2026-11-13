# DOM decision evaluation v2 — dataset protocol

The previous 48 examples (including their former holdout) are now **development only**. Their candidate IDs, values, option order and labels are unchanged. New evidence is attached to those candidates from the original saved HTML; no candidate is selected or inserted using a correct answer.

The new holdout is **18 field decisions from six actual public page captures**: four previously unused works on four services, plus a search page and an official help article. Each page yields title, representative image and series/movie synopsis tasks. These are element-selection tasks; catalogue availability, cross-service matching and navigation success are outside this dataset.

## Files and separation

| File                                 | Purpose                                                 | Permitted during template selection             |
| ------------------------------------ | ------------------------------------------------------- | ----------------------------------------------- |
| `data/development-inputs.json`       | Old 48 tasks with richer observed evidence              | Yes                                             |
| `data/development-labels.json`       | Old element labels and provenance                       | Yes                                             |
| `data/development-observations.json` | Old 16 bounded page observations                        | Yes                                             |
| `data/holdout-inputs.json`           | New 18 unlabeled tasks                                  | Only for schema checks; do not tune on outcomes |
| `data/holdout-observations.json`     | New six bounded DOM observations                        | Only for capture/schema checks                  |
| `data/holdout-labels.json`           | New element labels and provenance                       | After templates/settings are locked             |
| `data/holdout-annotations.json`      | Review notes and separate canonical-title references    | After templates/settings are locked             |
| `data/manifest.json`                 | Capture protocol, counts, pool recall and SHA256 freeze | Yes; no candidate answers in manifest           |

The dataset agent reviewed HTML, rendered screenshots and local relationships to annotate the new data, without seeing evaluated model outputs. The template author is instructed to avoid the new label/annotation files until selection is locked. This is a practical split within one coding session, not an independently administered benchmark. Once evaluated, these 18 examples must also be considered consumed for later tuning.

## Public sources and capture conditions

Captures were made on 2026-11-13 in an anonymous Chromium context, Korean locale, 1440×1000 viewport, after `domcontentloaded` and a fixed 4.5-second wait. No sign-in, interaction, injected content or synthetic page substitution was used.

- [Netflix title page](https://www.netflix.com/kr/title/81736884)
- [Apple TV show page](https://tv.apple.com/kr/show/%EC%8A%A4%ED%8C%8C%EC%9D%B4-%ED%8C%A8%EB%B0%80%EB%A6%AC/umc.cmc.1vuf6gpxnoqci1yey2n13h3nx)
- [TVING content page](https://www.tving.com/contents/P001654042)
- [Laftel movie modal](https://laftel.net/item/40587)
- [Laftel search view](https://laftel.net/search?keyword=%EC%8A%A4%ED%8C%8C%EC%9D%B4%20%ED%8C%A8%EB%B0%80%EB%A6%AC)
- [Netflix help article](https://help.netflix.com/ko/node/47765)

An initial [Laftel age-restricted detail](https://laftel.net/item/39431) led to a login page. Before model evaluation it was replaced by a publicly readable movie in the same previously unused franchise, so the holdout still contains four real work-detail pages. This access-driven replacement is recorded in the manifest. Both failed and final captures remain under ignored `.tmp/tiny-dom-v2-holdout/`; raw HTML, screenshots, session data and downloaded media are not committed.

## Generic candidate generation

The v1 generic collector supplies bounded candidates in deterministic traversal order: page/OG metadata, headings, image alt/source, video poster, paragraphs and generic description attributes/classes. Exact values are deduplicated, with at most three observed nodes per value and at most 18 values per field. A fixed **first-eight** cap is then applied, `__none__` is added, and options are deterministically shuffled using SHA256 of case ID + candidate ID. There is no provider-specific selector, work-title filter, label-based reranking or gold insertion.

`collect-inputs.mjs` has no label argument and does not read annotation files. `collect-freeze.mjs` attaches labels only after those input choices exist and reports missed gold rather than correcting the pool. Positive gold coverage in this frozen holdout is 12/12, and an accepted choice exists for 18/18 tasks. This checks the chosen small sample, not general extraction recall across all OTT pages or all DOM nodes. Some non-detail fields expose fewer than three candidates; they are retained as actual access/view states.

## Observed evidence and unknowns

The added node evidence includes `alt`, `title`, width/height attributes, natural and rendered image dimensions, nearby headings, parent roles, closest link, dialog membership, inert state and semantic ancestor region. Page evidence includes URL, document title, headings, dialog observations and a bounded body prefix excluding script/style/noscript/template content. None of these fields asserts a correct/main/artwork/scope class.

- `inLastVisibleDialogInDom` and `lastVisibleInDom` mean the final visible dialog in DOM order. They do **not** assert focus, topmost stacking order or actual active state.
- Existing candidate node observations are preserved. Enrichment requires exactly one matching tag/attribute/value/path. Paths are truncated to four ancestors, so collisions are explicitly `ambiguousPathAndValue`; missing or ambiguous nodes receive no guessed relationships.
- Offline development HTML cannot reproduce computed layout or natural image dimensions. Those added values stay `null`; original live `hidden`/`navigation` values remain unchanged. Page-level visibility in offline enrichment is limited to available attributes/styles. The live holdout has browser-measured geometry and natural dimensions where loaded; missing/zero values remain `null`.
- Nearby headings are taken from the first ancestor containing headings within five levels, capped at two. They are observed proximity, not a guaranteed work association. Generic link/URL evidence removes known signature/token query fields; these anonymous captures contain no user account state.

This richer representation can itself change results. Compare identical evidence with different template variants before attributing a gain to wording; comparisons to v1 combine representation and template effects. Root evaluation should keep canonical title recovery separate from exact/accepted element selection. A decorated title that normalizes to the expected title can be recoverable while still choosing the wrong element. Canonical target strings are annotations and must never enter model inputs or runtime title-normalization references.

## Reproduction and checks

```powershell
node eval/tiny-decision/v2/collect-development.mjs
node eval/tiny-decision/v2/collect-holdout.mjs
node eval/tiny-decision/v2/collect-inputs.mjs
# Review actual captures and create new annotations before freezing a new dataset.
node eval/tiny-decision/v2/collect-freeze.mjs
node --test eval/tiny-decision/v2/collect.test.mjs eval/tiny-decision/v2/dataset.test.mjs
```

Recollecting live pages creates a different dataset and invalidates the existing annotation/freeze unless reviewed again. Offline development enrichment requires the original ignored HTML captures; the checked-in observation/input files are sufficient to rerun model evaluation without those raw files. Tests verify unchanged old pools, ambiguous-path abstention, observed dimensions, script exclusion, input/label separation, fixed caps and frozen hashes.
