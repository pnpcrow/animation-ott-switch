# Independent expanded DOM holdout

This directory is blind to the model-training and development agents until model settings, weights, and preprocessing are frozen. Only `manifest.json` aggregate counts/hashes and `reserved-work-hashes.json` may be shared before that freeze. The collector/annotator does not participate in model tuning and has not inspected model predictions while deciding annotations.

## Collection and isolation

Netflix and Apple TV are entire-service holdouts. Laftel and TVING provide a separate known-service/unseen-work cohort. Canonical work families are reserved with the training collector before capture, including their search queries and blocked routes. Incidental recommendation titles are retained as real DOM distractors; they do not make a page an independent target-work example. A hash-only exclusion guard lets training validate work isolation without inspecting held-out titles or URLs.

`plan.json` and `append-plan.json` enumerate anonymous attempted routes and actions. Official links were discovered using official pages and official search results; no login, challenge, age gate, or entitlement bypass was used. `capture.mjs` reuses the existing generic bounded collector and enrichment without a site-specific answer selector. Captures preserve the first 18 observed candidates per field. The fixed model pool is the first 12 plus `__none__`, shuffled deterministically without using annotations. Gold outside that pool remains an extraction failure, never a newly relabeled none.

`observations.json` preserves every anonymous capture and `auth-observations.json` preserves the five authenticated captures. `annotations.json` records the independent observed state and every inclusion/exclusion reason. URL intent is not taken as proof of a modal, search result, or player. In particular, anonymous Netflix modal/watch URLs redirected to public details, and Apple search routes stayed on a popular-search landing. Playback access buttons sometimes opened subscription or login dialogs. These do not establish actual full-player coverage. Two later authenticated Netflix play-link navigations did establish actual playback with `paused=false`, `readyState=4`, positive time, and a large player viewport; each tab was closed immediately after capture.

Raw anonymous HTML/screenshots are temporary, ignored files in `.tmp/dom-scale/holdout/`. HTML hashes are retained. Authentication-flow query tokens are stripped from committed URL evidence. Public company support contacts in anonymous page evidence are not user credentials. Authenticated capture, if present, uses the separate privacy-limited read-only collector rather than raw HTML or page body dumps; it does not persist cookies, user storage, video URLs, account fields, or profile imagery. Different capture variants must be reported because their candidate-discovery semantics differ.

## Annotation policy

An opened detail or current-work description modal has a clean series/movie title, representative official artwork, and a series/movie plot when those are observed. Logos, episode names/plots/images, generic service marketing, age-gate artwork, and background recommendations are distractors. Multiple equivalent official hero/OG/responsive images or equivalent synopsis nodes may be accepted. A native work modal need not have `role=dialog`.

Search pages, login screens, blocking authentication/subscription dialogs, and actual full-player states return none for all three fields. A preview video inside the detail is still a detail, not a full player. Stale work metadata underneath a blocking login is not sufficient to select the work.

Duplicates, unchanged pages after failed actions, and incomplete loading transitions are excluded from classification scoring **before any model outputs are viewed**, with their attempted routes retained in the collection denominator. Search/login/blocked states are otherwise included. `requestedKind` and `observedKind` are kept in labels/provenance, never inserted into model-visible input evidence.

## Rebuild

Before freeze, run `node eval/dom-scale/holdout/sanitize.mjs`, `node eval/dom-scale/holdout/annotate.mjs`, then `node eval/dom-scale/holdout/build.mjs`. Inputs and labels are separate files. `build.mjs` validates observed gold IDs, preserves out-of-pool failures, and writes file hashes and coverage counts to `manifest.json`. After `data-freeze.json` is written, do not regenerate or alter inputs, labels, or annotations based on failures.

The final dataset has 52 attempts, 40 scored pages, and 120 field cases. Twelve attempts are excluded: one duplicate login, four detail redirects duplicating prior captures, two unavailable trailer actions with unchanged detail, one unchanged login-click detail, three semantically duplicate search landings, and one incomplete sign-in spinner. They remain in collection coverage denominators. Authenticated work modals expose three real candidate-recall failures: one clean title lies outside the first12, and two current-work images are absent even from original18. Independent target evidence for the latter is in `auth-annotation-evidence.json`, never injected into model inputs. These cases remain failures in end-to-end selection accuracy, with empty image `acceptedIds`; they must not be treated as none examples.

The anonymous append capture encountered a Windows file-write contention failure. It was resumed from saved capture IDs after adding serialized atomic writes and bounded retries; no model results or labels were involved in that operational retry.

This evaluates bounded DOM candidate selection. It does not by itself validate cross-provider title matching, entitlement, region availability, or successful extension navigation end to end.
