# Design direction mockups

Three alternative visual directions for Seattle Traffic Watch, written as
standalone pages. Open any of them directly in a browser — each fetches the
live camera catalogue from `https://cams.hoxel.dev/api/cameras` and renders
real SDOT frames, so they show the real content at real density rather than
placeholder boxes.

| File | Direction | Position |
| --- | --- | --- |
| `01-signal.html` | **Signal** | A civic document. Paper ground, one heavy rule, plates in a row. Reads like a transportation department published it. |
| `02-wall.html` | **Wall** | An operator's monitor wall. Neutral black, no glow or blur or radius, 2px gutters, edge to edge, labels burned into the frame. |
| `03-plate.html` | **Plate** | The city as a photographic record. Serif lede, one large frame, plates in a slow grid. Built for the Pulse and history features. |

`_data.js` is the shared loader. When a `/data.json` file is served from the
same origin it is used instead of the live API, which is how the screenshots in
the audit were captured against a fixed set of frames.

Measured on the rendered pages, catalogue padded to 60 cameras:

| Direction | Cameras above the fold, 1440x900 | Chrome before the first camera | Cameras, 390x780 | Chrome |
| --- | --- | --- | --- | --- |
| Current | 8 | 341px | 1 | 429px |
| A - Signal | 8 | 253px | 4 | 220px |
| B - Wall | 36 | 76px | 12 | 76px |
| C - Plate | 0 (by design) | 782px | 0 | 1165px |

These are mockups, not an implementation. Nothing here is wired into the
worker, and none of them are reachable from the deployed site.
