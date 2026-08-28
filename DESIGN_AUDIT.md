# Design audit: why the interface reads as AI-generated

Audited 28 Aug 2026 against `cams.hoxel.dev`. Source of record:
`prototype/vanilla/public/benchmark.css`, `evidence.css`, and the inline markup
in `prototype/vanilla/worker.ts`.

This is a visual-identity audit. It is separate from [UI_UX_AUDIT.md](./UI_UX_AUDIT.md),
which covers task clarity and accessibility and still stands.

## The headline finding

**167 of the 170 color declarations in the stylesheet are unedited Tailwind
default values.** The three exceptions — `#0d2840`, `#06111f`, `#0a1220` —
exist only to build the background glow.

The stylesheet does not use Tailwind. The palette was copied out of it:

| Value | Tailwind key | Role here |
| --- | --- | --- |
| `#020617` | slate-950 | ground |
| `#0f172a` | slate-900 | surfaces |
| `#94a3b8` | slate-400 | every hairline |
| `#67e8f9` | cyan-300 | accent (42 uses) |
| `#22d3ee` | cyan-400 | accent |
| `#cffafe` | cyan-100 | accent text |
| `#fda4af` | rose-300 | errors |

A palette is the cheapest place to put a point of view, and this one has none.
Nothing was chosen for Seattle, for traffic, or for a night camera frame.

## Twelve tells

Ordered by how loudly each announces itself.

### Color

1. **The palette is Tailwind's, unedited.** See above.
2. **One accent does every job.** `#67e8f9` appears 42 times: eyebrow, active
   chip, LIVE text, focus ring, map marker, compare divider, score pill, play
   hover, map HUD, nearby link, event badge, dock active state. When one hue
   means nine things it means nothing — a dark camera cannot look more urgent
   than a selected chip. Semantic color must be a separate system from the accent.
3. **The ambient corner glow.**
   `radial-gradient(circle at 15% 0,#0d2840 0,#06111f 28rem,#020617 62rem)`.
   The most reproduced background in generated design, and it fights the
   product: every frame is a night street lit sodium-amber and the chrome lays
   a blue wash over all of them.

### Surface

4. **Everything is a rounded, floating, blurred card.** 8 distinct radii, all
   inside the same 0.55–1rem band; 6 `backdrop-filter: blur()` declarations;
   the same `border:1px solid rgba(148,163,184,.16)` plus
   `box-shadow:0 12px 28px rgba(0,0,0,.18)` on cards, settings, diagnostics,
   dock, HUD, modal and pulse rail. Uniform treatment means no hierarchy.
5. **Pill inside a pill.** `.chip` at `.7rem` radius containing a `999px` badge
   for the count, seven across. A right-aligned numeral does the same work.

### Type

6. **A condensed intention that never arrives.** The stack
   `"Arial Narrow","Avenir Next Condensed","Helvetica Neue Condensed",Arial`
   with `font-stretch:condensed` resolves to plain Arial for most visitors —
   no webfont is loaded anywhere in the project. The typography that exists in
   the source has never been seen by anyone.
7. **Monospace worn as a costume.** `.sub`, `.toolbar-row`, `.diagnostics` and
   `.settings p` are mono with `tabular-nums`, and the strings they set are
   `"387 cameras · ArcGIS source"` and `"387 visible / 387 total"` — prose, not
   columns. Mono here signals *technical* rather than doing anything, and costs
   legibility at 0.67rem.
8. **The accent-colored uppercase eyebrow.** `.eyebrow` at `.65rem`, uppercase,
   `letter-spacing:.12em`, in cyan, reading "SEATTLE TRAFFIC TELEMETRY" above
   "Seattle Traffic Watch". The most reproduced layout unit in generated
   design, and here it restates the title in more words.

### Voice

9. **Product voice with nothing behind it.** "Seattle Pulse", "Reading the
   city…", "Ranking recent camera changes", "Diagnostics · 0 issues". The
   interface describes its own sophistication instead of saying what happened
   on the road. "Aurora northbound has been stopped for eleven minutes" is the
   same slot doing real work.
10. **The data model leaking into the controls.** "Match all / Match any",
    "ArcGIS source", "SDOT Socrata", "Signal issues" are implementation details
    promoted to buttons. Nobody holds a boolean-combination preference; they
    want *downtown bridges*.

### Layout

11. **The styling says command centre; the layout says landing page.**
    `max-width:80rem` centered, four columns, 1rem gaps, and `.pulse` reserving
    `min-height:9rem` that is empty at first paint. 341px of chrome before the
    first camera at 1440x900; 429px at 390x780, where exactly one camera is
    visible.
12. **Each card says "live" three times.** A LIVE badge, "Live" caption text,
    and a "Play live" button — plus the camera name burned into the SDOT frame
    and repeated as the card title. Four labels for two facts.

## What is worth keeping

The engineering is better than the surface, and none of the directions below
require giving any of it up: server-rendered critical HTML with a six-camera
bootstrap then hydration; a real, tight CSP; an image proxy that negotiates
AVIF/WebP, clamps widths and caches at the edge; `contain:content` and fixed
`aspect-ratio` boxes so nothing reflows; a mobile dock that is a decision
rather than a shrunk desktop. The information architecture is the right shape.

## Three directions

Working mockups live in [`design/alternatives/`](./design/alternatives/). Each
is a self-contained page that renders real SDOT frames; open one directly in a
browser. See that README for the density table.

- **A — Signal.** A civic document: paper ground, one heavy rule under the
  masthead, plates in a row. 0px radius, no shadows, no blur. Amber means
  *attention now*, red means *broken*, and neither is ever decorative. The
  light ground puts the night frames in a mat instead of competing with them.
  Cost: loses the after-dark comfort of a dark UI, so it needs a real dark
  counterpart rather than an inversion.
- **B — Wall.** The honest version of what the current design is dressed up as.
  Neutral black, no glow, no blur, no radius, 2px gutters, edge to edge, labels
  burned into the frame. One hue in the whole interface — red, for the
  recording dot. **36 cameras above the fold against the current 8**, and 76px
  of chrome against 341px. Cost: unfriendly to a first-time visitor who wanted
  one intersection, so search has to be excellent.
- **C — Plate.** The city as a photographic record: a serif lede that says what
  is happening in a sentence, one large frame carrying it, plates below. No
  accent hue at all; the frames supply every color. Cost: zero cameras above
  the fold — wrong for the primary view, right for Pulse and the Time Machine.

## Recommendation

**Signal for the chrome, Wall for the grid, Plate for the story pages.** They
are compatible and each is strongest where the others are weakest. If only one
ships, ship **Wall**: it removes every tell above at once, by removing the
effects rather than restyling them.

The order of work matters more than the direction, because the current
stylesheet cannot be restyled — 170 color literals, zero custom properties:

1. **Extract tokens first.** Replace all 170 literals with a variable set —
   ground, surface, rule, ink, muted, accent — plus a separate semantic trio
   for live / stale / down. Nothing changes visually; every later step becomes
   a one-file edit.
2. **Split the accent from the state colors.** The moment "selected" and
   "camera is down" stop sharing a hue, the interface starts communicating.
3. **Delete the effects.** All six backdrop blurs, the body gradient, the card
   drop shadows, the radii. Do this before choosing a direction — most of the
   machine-made quality goes with them whatever comes next.
4. **Load a real typeface, or design for the fallback.**
5. **Then apply a direction.** By that point it is a token file and a grid rule.
