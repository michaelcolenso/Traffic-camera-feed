# Creative Changes Implementation Plan

This plan turns the ideas in `CREATIVE_IDEAS.md` into an incremental delivery path. It assumes the app remains a Vite/React client that consumes public camera feeds, with optional Cloudflare Worker support for proxying or enrichment when browser-only APIs are not enough.

## Guiding principles

- Ship features behind small, reversible UI surfaces before adding new infrastructure.
- Prefer client-side state for prototypes, then promote to persisted storage only after the interaction proves useful.
- Keep media bandwidth predictable: never autoplay multiple live streams by default.
- Preserve accessibility for keyboard users, screen readers, and reduced-motion preferences.
- Treat camera and incident feeds as best-effort public data; expose stale, missing, and failed states clearly.

## Phase 0: Foundation and shared primitives

**Goal:** Prepare reusable building blocks so the creative features do not become one-off UI paths.

1. Add stable camera identifiers derived from feed IDs when available, falling back to URL/label hashes.
2. Create shared camera-selection state that can be used by grid cards, the map panel, focus mode, storyboards, and share links.
3. Introduce reusable UI primitives for chips, drawers, modal panels, empty states, and media status badges.
4. Add a small telemetry model for `lastImageRefresh`, `lastImageError`, `lastStreamError`, `lastDataRefresh`, and `feedLatencyMs`.
5. Add unit-friendly helpers for camera filtering, corridor label matching, URL state serialization, distance calculations, and freshness scoring.

**Exit criteria:** The current grid and map continue to work, and new state/helper utilities are covered by type checking and focused tests if a test runner is added.

## Phase 1: Smart Camera Collections

**Goal:** Give users quick ways to reduce the camera wall to meaningful subsets.

1. Define collection presets: `Has live stream`, `Downtown`, `Bridges`, `I-5`, `Aurora`, `Recently refreshed`, and `Signal issues`.
2. Implement a `CameraCollectionBar` that appears near search controls on desktop and inside a compact sheet on mobile.
3. Combine collection filters with existing text search using predictable AND semantics.
4. Surface active-filter chips with single-click removal and a `Clear all` action.
5. Add route/corridor keyword dictionaries in a dedicated config file so labels are easy to tune without editing component logic.

**Dependencies:** Phase 0 filter helpers and media status telemetry.

**Risks:** Feed labels may be inconsistent. Start with transparent keyword matching and document how to update presets.

## Phase 2: Cinematic Focus Mode

**Goal:** Let users inspect one camera in a polished, presentation-ready view.

1. Add a `FocusCameraModal` that opens from card media, map previews, and keyboard shortcuts.
2. Show a large still image by default, with an explicit live-stream play button when video is available.
3. Include title, coordinates, latest refresh time, external SDOT link, copy-link action, nearby-camera shortcuts, and refresh controls.
4. Support arrow-key navigation through the active filtered camera list.
5. Respect escape-to-close, focus trapping, and reduced-motion settings.

**Dependencies:** Phase 0 shared selected-camera state and reusable modal primitives.

**Risks:** Live HLS playback varies by browser. Keep still image fallback visible and expose stream failures.

## Phase 3: Shareable Camera Briefings

**Goal:** Make the current app state easy to share and restore.

1. Define URL parameters for `source`, `view`, `q`, `collections`, `camera`, `lat`, `lng`, and `zoom`.
2. Add serialization/deserialization helpers with validation and safe defaults.
3. Update state from the URL on initial load without clobbering invalid parameters.
4. Push lightweight URL updates when users change view mode, search, collections, selected camera, or map viewport.
5. Add `Copy briefing link` buttons in the focus modal, map selected-camera panel, and command areas.
6. Include a small toast or status message after copying.

**Dependencies:** Phase 0 URL helpers, Phase 1 collections, Phase 2 selected-camera behavior.

**Risks:** Over-updating history can make back-button behavior noisy. Use `replaceState` for continuous updates and `pushState` for deliberate share actions.

## Phase 4: Reliability Console

**Goal:** Make public-feed health visible to users and easier to debug.

1. Track image load success/failure per camera card and map preview.
2. Track data refresh start/end timestamps and compute feed latency.
3. Add status badges for stale images, failed images, stream unavailable, and live-capable cameras.
4. Add a settings-panel diagnostics section with total cameras, mappable cameras, image failures, live streams, last refresh, and current source.
5. Add a `ReliabilityConsole` drawer with sortable lists for failing or stale cameras.
6. Provide a manual `Retry failed` action that refreshes affected camera timestamps and triggers SWR revalidation when needed.

**Dependencies:** Phase 0 telemetry model.

**Risks:** Browser image errors can be transient. Avoid alarming copy; use measured language such as `Last image failed` or `Needs refresh`.

## Phase 5: Traffic Mood Map

**Goal:** Make map status instantly readable while preserving the existing dark HUD style.

1. Define marker classes for normal, live-capable, stale, failed, selected, and user-tagged severe states.
2. Derive marker mood from reliability telemetry first; keep congestion inference out of scope until validated data exists.
3. Add a compact map legend that explains colors and pulses.
4. Add optional clustering or density styling if marker overlap becomes a problem.
5. Later, integrate incident/closure severity to influence marker halos or nearby area overlays.

**Dependencies:** Phase 4 reliability signals and existing MapLibre marker rendering.

**Risks:** Too much animation can hurt readability and accessibility. Gate pulses with reduced-motion styles.

## Phase 6: Snapshot Compare

**Goal:** Let users see whether a scene has changed over the last few refreshes.

1. Store a bounded in-memory history of image URLs/timestamps per camera while the page is open.
2. Capture history only when a camera is visible or selected to avoid unnecessary bandwidth.
3. Add a scrubber to focus mode with stops such as `Now`, `30s`, `1m`, and `2m` when snapshots exist.
4. Provide a side-by-side compare toggle for `Now` versus the oldest available snapshot.
5. Consider optional IndexedDB persistence only after validating memory and privacy implications.

**Dependencies:** Phase 2 focus mode and Phase 4 image-refresh telemetry.

**Risks:** Cache-busted image URLs do not guarantee changed content. Label the feature as snapshot history, not guaranteed traffic movement.

## Phase 7: Camera Storyboards

**Goal:** Create a hands-free carousel for kiosks, second monitors, and ambient viewing.

1. Allow users to start a storyboard from the current filtered list, a collection, or selected cameras.
2. Build a full-screen `StoryboardView` with large media, camera title, progress indicator, and pause/next/previous controls.
3. Add dwell-time settings such as 5, 10, 20, and 30 seconds.
4. Use still images by default; require a deliberate action to play video for the current camera.
5. Add keyboard shortcuts for space, arrows, escape, and full-screen toggle.

**Dependencies:** Phase 1 collections, Phase 2 focus media components, Phase 3 URL state if storyboards should be shareable.

**Risks:** Fullscreen APIs differ across browsers. Keep storyboard usable without browser fullscreen.

## Phase 8: Commute Mission Control

**Goal:** Personalize the app around saved routes and recurring commuter decisions.

1. Add a `SavedRoute` model with name, ordered camera IDs, optional notes, and preferred view mode.
2. Start with localStorage persistence and import/export JSON before building account-backed storage.
3. Let users add/remove cameras from a route from cards, focus mode, and map previews.
4. Add a route dashboard with route health, camera count, live-stream count, stale/failure count, and one-tap storyboard/focus actions.
5. Add a `Morning briefing` layout that shows route cameras in order with reliability and latest snapshot metadata.
6. Later, support rough polyline drawing or map-based route planning if camera-to-route matching becomes important.

**Dependencies:** Phase 1 collections, Phase 2 focus mode, Phase 4 reliability console, Phase 7 storyboard mode.

**Risks:** LocalStorage can be cleared and does not roam across devices. Provide export/import early and avoid storing sensitive commute notes by default.

## Phase 9: Incident-Aware Overlays

**Goal:** Attach road context to nearby cameras without making unsupported claims from images.

1. Identify authoritative public incident, construction, and closure feeds that allow browser or Worker access.
2. Create a normalized `RoadEvent` model with type, title, coordinates/geometry, source, updated time, and severity when available.
3. If CORS or API keys are needed, add a Worker endpoint that proxies and caches the road-event feed.
4. Add map layers for events and a camera-panel section for nearby incidents within a configurable radius.
5. Add filters for event type and recency.
6. Update share links so a briefing can preserve incident-layer visibility.

**Dependencies:** Phase 3 share state and Phase 5 map mood/legend work.

**Risks:** External feed schemas and licensing can change. Keep adapters isolated and cite source/update times in the UI.

## Phase 10: AI-Assisted Camera Notes

**Goal:** Provide optional briefing assistance while avoiding unvalidated automated traffic judgments.

1. Define the first AI use case as text composition from structured metadata and user-selected notes, not automated image interpretation.
2. Add a `BriefingDraft` model that includes selected cameras, route/collection name, visible reliability data, nearby incidents when available, and user-entered observations.
3. Add an explicit `Generate draft` action behind an environment-gated API configuration.
4. Route generation through a server/Worker endpoint so API keys are never exposed in the browser.
5. Add clear UX copy that drafts require human review.
6. Log only operational metadata needed for debugging; do not store camera images or personal routes unless a user opts in.

**Dependencies:** Phase 3 shareable briefings, Phase 8 routes, and Phase 9 incidents for richer context.

**Risks:** AI output can be inaccurate. Keep generation optional, reviewable, and grounded in visible structured data.

## Cross-cutting testing plan

- Run `npm run lint` for every change set.
- Add component tests once a test harness is selected for filter logic, URL serialization, and camera-state reducers.
- Add Playwright smoke tests for grid load, map load, collection filtering, focus modal open/close, URL restoration, and storyboard keyboard controls.
- Manually verify mobile layout for command dock, collection filters, focus mode, and storyboard mode.
- Use reduced-motion and keyboard-only passes before shipping animated or full-screen experiences.

## Suggested release milestones

1. **Milestone A: Find and focus** — Phases 0-2.
2. **Milestone B: Share and trust** — Phases 3-4.
3. **Milestone C: Visual intelligence** — Phases 5-6.
4. **Milestone D: Ambient workflows** — Phase 7.
5. **Milestone E: Personal commute workflows** — Phase 8.
6. **Milestone F: Context and assisted reporting** — Phases 9-10.
