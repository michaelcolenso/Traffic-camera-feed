# Cloudflare Vanilla Architecture Benchmark

Benchmark run: GitHub Actions `31924827268` on the same `ubuntu-latest` runner for both architectures.

Both targets were measured with three Lighthouse mobile runs using identical Lighthouse flags and runner conditions.

| Architecture | Scores | Min | Median | Median LCP | Median TBT | Max CLS | Median transfer |
|---|---|---:|---:|---:|---:|---:|---:|
| Production React (`cams.hoxel.dev`) | 74 / 87 / 85 | 74 | 85 | 3.70 s | 169 ms | 0.0003 | 287 KiB |
| Cloudflare Worker + Static Assets + vanilla JS | 100 / 100 / 100 | 100 | 100 | 1.53 s | 0 ms | 0 | 145 KiB |

## Raw measurements

### React

1. Performance 74; Accessibility 100; FCP 2261 ms; LCP 3465 ms; TBT 480 ms; CLS 0; transfer 294075 bytes.
2. Performance 87; Accessibility 100; FCP 2096 ms; LCP 3696 ms; TBT 123 ms; CLS 0.000302; transfer 294171 bytes.
3. Performance 85; Accessibility 100; FCP 2079 ms; LCP 3742 ms; TBT 169 ms; CLS 0.000302; transfer 294147 bytes.

### Cloudflare vanilla prototype

1. Performance 100; Accessibility 100; FCP 1146 ms; LCP 1561 ms; TBT 0 ms; CLS 0; transfer 147780 bytes.
2. Performance 100; Accessibility 100; FCP 1230 ms; LCP 1530 ms; TBT 0 ms; CLS 0; transfer 148049 bytes.
3. Performance 100; Accessibility 100; FCP 1251 ms; LCP 1401 ms; TBT 0 ms; CLS 0; transfer 148153 bytes.

## Prototype architecture

- Cloudflare Worker handles `/` and returns the first six current Seattle camera cards directly as HTML.
- The Worker fetches and normalizes the Seattle ArcGIS camera layer and uses Cloudflare edge caching for the source response.
- Workers Static Assets serves the small CSS and enhancement JavaScript.
- `/api/image` validates Seattle camera image paths and uses Cloudflare image transformation at 480 px with AVIF/WebP negotiation.
- The browser enhancement script handles search, progressive rendering, and a simple camera modal without a UI framework or hydration runtime.

## Interpretation

The benchmark strongly supports moving the critical camera-grid path away from a client-rendered React SPA toward edge-rendered HTML with small progressive enhancement. This prototype is not yet feature-parity with production: map mode, HLS playback, all collection filters, diagnostics, URL state, and the polished production UI still need to be ported before a production replacement decision.
