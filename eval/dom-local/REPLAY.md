# Consumed public DOM replay diagnostic

Generated: 2026-11-13T16:25:28.533Z; Chromium 158.0.8127.18.

Three public development snapshots from the previous experiment were reused. Their labels and source files were read without modification. They are consumed development evidence, not unseen service/work validation. No learned model was evaluated or retrained.

The snapshots were parsed into detached browser documents after removing scripts, event attributes, frames and external stylesheet links. Network access was blocked. Actual layout and external CSS are unavailable, so this diagnoses structure and text only. Browser size handling is tested separately in browser.mjs. Each field scan ran after five warmups with twenty measured repetitions.

| Page | Scope | Title recovered | Description prefix recovered | Image recovered | Fallback title / description / image | Max visited | Total local bytes | Per-field p50 range (ms) |
| --- | --- | ---: | ---: | ---: | --- | ---: | ---: | ---: |
| scale-laftel-jujutsu-kaisen-search-opened-work | automatic-scope | yes | yes | yes | matches-old-gold / matches-old-gold / matches-old-gold | 159 | 3703 | 0.50–0.80 |
| scale-laftel-jujutsu-kaisen-search-opened-work | caller-verified-root | yes | yes | yes | matches-old-gold / matches-old-gold / matches-old-gold | 92 | 3700 | 0.30–0.50 |
| scale-prime-look-back-detail | automatic-scope | yes | yes | no | matches-old-gold / matches-old-gold / abstained | 458 | 4159 | 1.10–1.60 |
| scale-prime-look-back-detail | caller-verified-root | yes | yes | no | matches-old-gold / matches-old-gold / abstained | 458 | 4159 | 1.00–1.60 |
| scale-tving-frieren-detail | automatic-scope | yes | yes | yes | abstained / abstained / abstained | 228 | 5433 | 0.70–1.00 |
| scale-tving-frieren-detail | caller-verified-root | yes | yes | yes | abstained / abstained / abstained | 227 | 5382 | 0.60–1.00 |

Recovered means at least one candidate matched an accepted old annotation. The old descriptions are bounded prefixes; prefix agreement is reported explicitly and is not an exact full-description metric. Multiple accepted artwork options are allowed. Candidate recovery does not mean a trained classifier selected it correctly. Abstention is expected when the scan is incomplete or several strong values compete.

Observed limitations: the Prime Video accepted image URLs occur in metadata/picture alternatives rather than matching img.src/video.poster candidates, so this visible-node collector misses that field. TVING includes competing work/episode headings and artwork/description candidates; the relevant candidates are present but the deterministic fallback abstains. Existing metadata and provider adapters remain necessary for these cases. The Laftel expandable synopsis and title-image alt cases informed fixes during this development replay, which is another reason these results must not be called fresh validation.

The caller-verified-root pass uses existing provider-adapter scope knowledge. It does not demonstrate provider-independent scope discovery. Results are diagnostic failures/successes, not a release accuracy target; retained metadata/provider extraction remains authoritative in production.

Source SHA-256: `361406ef77ada3b9e4dcf647286661e4e71822018e4a719740f3ff259d358f6f`
