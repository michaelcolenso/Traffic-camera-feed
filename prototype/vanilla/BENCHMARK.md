# Cloudflare-Native Architecture Benchmark

Final feature-parity benchmark run: GitHub Actions `31925598169` on the same `ubuntu-latest` runner for both architectures.

Both targets were measured with three Lighthouse mobile runs using identical Lighthouse flags and runner conditions after the replacement passed its Wrangler validation, deployment smoke test, and Playwright feature-parity suite.

| Architecture | Scores | Min | Median | Median LCP | Median TBT | Max CLS | Median transfer | A11y min |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| Production React (`cams.hoxel.dev`) | 76 / 87 / 87 | 76 | 87 | 3.54 s | 145 ms | 0.0003 | 277 KiB | 100 |
| Cloudflare Worker + Static Assets + progressive JS | 100 / 99 / 99 | 99 | 99 | 2.12 s | 0 ms | 0 | 267 KiB | 100 |

## Raw measurements

### React production

1. Performance 76; Accessibility 100; FCP 2229 ms; LCP 3494 ms; TBT 503 ms; CLS 0.000302; transfer 283477 bytes.
2. Performance 87; Accessibility 100; FCP 2050 ms; LCP 3701 ms; TBT 123 ms; CLS 0.000302; transfer 283485 bytes.
3. Performance 87; Accessibility 100; FCP 2050 ms; LCP 3540 ms; TBT 145 ms; CLS 0.000293; transfer 284429 bytes.

### Cloudflare-native feature-parity replacement

1. Performance 100; Accessibility 100; FCP 968 ms; LCP 1230 ms; TBT 0 ms; CLS 0; transfer 273734 bytes.
2. Performance 99; Accessibility 100; FCP 1366 ms; LCP 2124 ms; TBT 0 ms; CLS 0; transfer 274155 bytes.
3. Performance 99; Accessibility 100; FCP 1364 ms; LCP 2121 ms; TBT 0 ms; CLS 0; transfer 273937 bytes.

## Enforced replacement budget

The benchmark workflow fails unless all of these remain true:

- minimum mobile Lighthouse performance >= 95
- median LCP <= 2.5 seconds
- median TBT <= 100 milliseconds
- maximum CLS <= 0.05
- minimum accessibility score >= 98

The final run passed every threshold.

## Feature parity covered by browser regression tests

The Playwright parity test exercises the production-critical interaction model rather than only checking that the page loads:

- initial edge-rendered camera cards
- all seven camera collections
- search and shareable query-string state
- collection filter query-string state
- focus modal
- map-mode switching and URL state
- source settings
- SDOT source-switch behavior with deterministic upstream mocking
- real `/api/cameras` route behavior
- real transformed camera image path

## Replacement architecture

- A Cloudflare Worker handles `/` and returns the first six current Seattle camera cards plus the filter toolbar directly as HTML.
- The Worker fetches and normalizes the ArcGIS camera layer with Cloudflare edge caching; SDOT Socrata remains an alternate source.
- Workers Static Assets serves the small CSS and progressive-enhancement JavaScript.
- `/api/image` validates Seattle camera paths and uses Cloudflare image transforms with AVIF/WebP negotiation.
- `/api/video` proxies HLS playlists and segments and rewrites same-origin playlist references.
- Search, collections, diagnostics, URL state, periodic refresh, focus navigation, and mobile navigation are framework-free browser enhancements.
- MapLibre and HLS.js are loaded only when those features are invoked.

## Decision

The feature-parity replacement clears the performance budget with substantial margin while retaining the core production behaviors. The production cutover can therefore be handled as a deployment/configuration change rather than another architecture experiment. React remains in the repository during the initial cutover window as the fastest rollback path.
