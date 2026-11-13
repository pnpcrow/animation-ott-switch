# Local DOM browser development diagnostic

Generated: 2026-11-13T16:25:27.046Z; isolated headless Chromium 158.0.8127.18; viewport 1280 × 900.

Hand-authored fixtures: 6; field selection checks: 18; annotated candidate values recovered: 17/17. All expected selections/abstentions and native XPath roundtrips passed. These figures measure these fixtures only; they are not model accuracy or blind service/work validation.

| Fixture | Full fixture HTML bytes | Three local JSON inputs bytes | Largest per-field visited count | Per-field p50 range (ms) | Per-field p95 range (ms) |
| --- | ---: | ---: | ---: | ---: | ---: |
| late-active-modal | 58414 | 2714 | 13 | 0.10–0.10 | 0.20–0.20 |
| standalone-detail | 704 | 3530 | 19 | 0.00–0.10 | 0.10–0.20 |
| ambiguous-detail | 486 | 3318 | 19 | 0.00–0.10 | 0.10–0.20 |
| tooltip-and-body-decoys | 732 | 2960 | 18 | 0.00–0.10 | 0.10–0.20 |
| tiny-provider-image | 601 | 2666 | 13 | 0.00–0.10 | 0.10–0.10 |
| hidden-modal | 675 | 2666 | 11 | 0.00–0.00 | 0.10–0.20 |

The HTML column excludes the injected test bundle. It is a serialization-size reference, not the previous production extractor's input and not a browser RAM measurement. For small pages, structured context JSON can be larger than the source HTML. Each latency runs after 10 warmups, with 50 measured full field scans including scope discovery. Submillisecond readings are constrained by timer resolution; zero does not mean zero work.

The progressive fixture yielded its first title after 12 visited nodes versus 807 for the full scan. Calling close() prevented further candidates. An early candidate is not proof of uniqueness: deterministic fallback still needs a complete, unambiguous scan.

Both the hero and provider icon loaded an actual 1440 × 1440 SVG in Chromium. The collector preserved the hero's 720 × 405 rendered size separately from its intrinsic size and its parent's accessible label. The 23 × 23 provider icon was excluded. A changed DOM caused the same positional XPath to resolve to a different element/value, confirming that a locator alone cannot safely authorize later use.

Navigation evidence: two literal URLs plus one unknown dynamic action; 1345 serialized bytes. Logout, javascript: target and POST purchase form were excluded. No action executed. A collected URL remains unverified work evidence.

Limitations: synthetic development fixtures, no actual OTT CSS/runtime replay, no model inference, no unseen-service estimate, no process/heap RAM claim. The main benefit demonstrated here is bounded field-local evidence and retained disambiguating context. Actual candidate recall and classifier accuracy need a separately collected corpus before broader automatic adoption.

DOM source SHA-256: `361406ef77ada3b9e4dcf647286661e4e71822018e4a719740f3ff259d358f6f`

Link source SHA-256: `410e2b1a2a7e73c2c330392c36fa2340efb1abacda4da7d93f4fd226b0a8fb99`
