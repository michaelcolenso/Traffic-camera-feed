# UI/UX Audit: Seattle Traffic Watch

## Audit scope

This audit reviews the current React/Vite traffic-camera experience across the primary grid view, map view, focus modal, filtering controls, diagnostics, data-source settings, and mobile command dock. The review is based on source inspection of the application shell and core UI components, with build verification for implementation health.

## Executive summary

Seattle Traffic Watch has a strong operational concept: a dense, dark, telemetry-style interface for quickly scanning Seattle traffic camera snapshots, moving between map and grid workflows, and opening focused camera details. The product already includes thoughtful foundations such as URL-persisted filters, mobile-specific navigation, reduced-motion support, lazy image loading, and camera health tracking.

The largest UX risks are not visual polish; they are task clarity, accessibility, resilience, and discoverability. The interface currently leans heavily on small uppercase labels, icon-only controls, hover-revealed actions, and cyber/HUD styling. That aesthetic fits the product, but it can reduce comprehension for first-time users, keyboard users, low-vision users, and mobile users trying to complete simple tasks quickly.

## What works well

### 1. Strong visual identity and product focus

- The dark, glass-panel aesthetic creates a clear command-center feel that matches traffic monitoring.
- The product name, live telemetry framing, camera counts, and active-node language establish the app as a real-time scanning tool.
- Grid cards, map markers, and focus mode form a coherent information architecture around traffic-camera inspection.

### 2. Responsive layout foundations

- The app provides a dedicated mobile hero panel and bottom command dock instead of simply shrinking the desktop header.
- The grid uses responsive breakpoints from one column on small screens to four columns on large screens.
- The map and focus modal use viewport-constrained sizing, helping the experience stay usable on common screen sizes.

### 3. Useful operational workflows

- Users can search cameras, filter by collections, switch between grid and map, refresh feeds, and open a camera in focus mode.
- The focused camera modal supports Escape to close and arrow-key navigation between cameras.
- Query parameters persist search, active collections, selected camera, and view mode, supporting shareable operational states.

### 4. Performance-conscious patterns

- Camera cards lazy-load images and use an `IntersectionObserver` to stop video playback when cards leave the viewport.
- Static images refresh on an interval only while a live video is not playing.
- SWR refreshes the camera feed every five minutes while avoiding focus revalidation churn.

## Key findings by severity

### Critical

No critical UX blockers were found during static audit. The app has a complete path for loading data, scanning cameras, switching views, opening details, and recovering from data-source errors.

### High priority

#### 1. Icon-only and ambiguous controls reduce learnability

Several important controls rely on icons, titles, or short labels that are hard to understand without exploration. Examples include the settings button, mobile source toggle, card live-stream button, stop-stream button, external-link button, map close button, map refresh button, and focus-mode utility buttons.

**Why it matters:** First-time users may not understand how to change sources, open live video, distinguish snapshot from stream behavior, or return from transient UI states. Screen-reader users also receive inconsistent help because some controls lack explicit `aria-label` text.

**Recommendations:**

- Add visible text labels where space allows, especially for data source, refresh, focus, and stream actions.
- Add `aria-label` attributes to all icon-only buttons and external links.
- Use consistent action language: “Play live stream,” “Stop live stream,” “Open SDOT page,” “Open focus mode,” and “Refresh snapshot.”

#### 2. Hover-revealed card actions hide key functionality

On larger screens, the camera-card overlay actions are translated out of view until hover. This hides live-stream, coordinate, and external-source actions from users who browse by keyboard, touch, stylus, or assistive technology.

**Why it matters:** Traffic camera monitoring is action-oriented. Hidden actions make the UI feel cleaner but reduce discoverability and can block non-pointer users.

**Recommendations:**

- Keep the primary action visible at all times: “Open focus” or “View camera.”
- Reveal secondary actions progressively, but ensure they remain reachable and visible on keyboard focus using `focus-within` styles.
- Consider a persistent bottom metadata/action strip with subtle opacity instead of full off-screen translation.

#### 3. Modal focus management is incomplete

The focus modal has dialog semantics and keyboard shortcuts, but it does not visibly set initial focus, trap focus inside the modal, restore focus to the opener, or provide an accessible dialog name via `aria-labelledby`.

**Why it matters:** Keyboard and screen-reader users can accidentally tab behind the modal, lose context, or struggle to understand which dialog opened.

**Recommendations:**

- Add a modal title id and connect it with `aria-labelledby`.
- Move focus to the close button or modal heading on open.
- Trap Tab/Shift+Tab within the modal and restore focus to the triggering element on close.
- Add visible previous/next controls for the existing arrow-key navigation.

#### 4. Color contrast and typography density may harm readability

The app frequently uses very small text (`10px` or `11px`), uppercase labels, wide letter spacing, and muted slate colors over translucent dark panels. This supports the HUD aesthetic but can reduce readability, especially on mobile, outdoors, or for low-vision users.

**Why it matters:** Traffic-camera use can happen in quick, time-sensitive contexts. Labels and controls must be legible at a glance.

**Recommendations:**

- Increase minimum body/action text to 12px where possible and reserve 10px labels for decorative metadata only.
- Avoid uppercase tracking on long labels or descriptions.
- Audit slate-on-glass contrast ratios and raise muted text contrast for controls, counts, error text, and empty states.
- Add a high-legibility mode or tune CSS variables for better contrast while preserving the theme.

### Medium priority

#### 5. Search is useful but lacks guidance and result affordances

Search currently filters by camera label only. It does not show searchable fields, spell tolerance, suggestions, recent searches, matched term highlighting, or quick actions for empty results.

**Recommendations:**

- Make search placeholder more specific: “Search intersection, corridor, bridge, or camera ID.”
- Highlight matching substrings in camera names.
- Expand matching to coordinates, collection labels, source URLs, and normalized aliases where available.
- In empty states, show active filters and provide separate “Clear search” and “Clear all filters” actions.

#### 6. Filter behavior may not match user expectations

Collection filters combine with `every`, so selecting multiple collections means a camera must match all selected collections. Users may expect chips to behave as additive OR filters.

**Recommendations:**

- Clarify behavior with helper text such as “Showing cameras matching all selected filters.”
- Consider OR semantics for broad collection chips, or add a visible “Match all / Match any” toggle.
- Show count badges on each chip so users understand filter impact before selecting.

#### 7. Data-source settings are powerful but technical

The settings panel exposes a raw ArcGIS FeatureServer endpoint field and Socrata toggle. This is useful for operators but likely intimidating for casual users.

**Recommendations:**

- Add a short explanation of each source and when to use it.
- Add validation for empty or malformed ArcGIS URLs before applying.
- Provide a “Restore default ArcGIS endpoint” button.
- Show current source status and last successful sync time.

#### 8. Loading and error states could communicate progress better

Grid loading uses skeletons, while map loading uses a centered message. Error state explains source failure and provides retry, but it does not expose last known data, diagnostics, or source-switching options.

**Recommendations:**

- Keep stale camera data visible when refresh fails, with a non-blocking banner.
- Offer “Try SDOT source” or “Open data source settings” directly from ArcGIS error state.
- Add last successful sync timestamp to the header or diagnostics panel.

#### 9. Map view needs stronger wayfinding and legend support

Markers use color to represent live streams and issues, but there is no persistent legend. The map panel also lacks cluster behavior, selected-marker state, and an obvious route back to the grid context.

**Recommendations:**

- Add a small legend for snapshot, live-stream, and issue markers.
- Visually distinguish the selected marker.
- Add map controls for “Fit to visible cameras” and “Return to Seattle.”
- Consider marker clustering or density-based marker scaling at lower zoom levels.

### Low priority

#### 10. Product copy sometimes favors theme over clarity

Phrases such as “Online nodes,” “Live city telemetry,” “Camera network unreachable,” and “Retry sync” are evocative but may be less clear than user-centered wording.

**Recommendations:**

- Prefer plain-language labels for primary tasks: “Cameras,” “Live streams,” “Couldn’t load cameras,” and “Retry.”
- Keep thematic copy for secondary/supporting text.

#### 11. Snapshot history labels are misleading

Focus mode provides “Now,” “30s,” and “2m,” but the implementation maps the third option to one minute because it subtracts `index * 30_000`. This creates a trust issue if users rely on historical snapshots.

**Recommendations:**

- Correct the timestamps or rename the third label.
- If historic images are not available server-side, explain that these are cache-busted snapshot attempts rather than guaranteed archived frames.

#### 12. Mobile source switching is too opaque

The bottom dock source toggle displays only an icon and switches immediately between ArcGIS and SDOT. Users may trigger it accidentally and not understand what changed.

**Recommendations:**

- Add a visible text label such as “Source.”
- Show a toast or inline confirmation after switching.
- Route source changes through the same settings panel on mobile unless fast toggling is a known core operator need.

## Accessibility checklist

| Area | Current state | Recommendation |
| --- | --- | --- |
| Keyboard navigation | Basic buttons/inputs are native, modal supports Escape and arrow keys | Add focus trap, focus restoration, visible previous/next controls, and `focus-within` card actions |
| Screen readers | Some controls have labels, but many icon actions rely on title or visible context | Add `aria-label` to all icon-only controls and links; add `aria-labelledby` to modal |
| Contrast | Theme uses muted slate text over translucent backgrounds | Validate WCAG contrast and increase muted text contrast |
| Motion | Reduced-motion media query is present | Keep; also avoid map fly animations when reduced motion is requested |
| Touch targets | Many controls are reasonably padded, but some icon buttons are small | Target 44px minimum for primary mobile actions |
| Dialogs | Modal uses `role="dialog"` and `aria-modal="true"` | Add labelled dialog, focus trap, and restoration |

## UX heuristic review

### Visibility of system status

**Strengths:** Counts, live badges, refreshing icons, error panels, and diagnostics make status visible.

**Gaps:** Last sync time, source health, stale data state, and marker legend are missing.

### Match between system and real world

**Strengths:** Camera names, map view, coordinates, and SDOT links map to real traffic-monitoring concepts.

**Gaps:** “Nodes,” “telemetry,” and “sync” language may be too abstract for non-technical users.

### User control and freedom

**Strengths:** Clear filters, close buttons, retry, refresh, and URL state support user control.

**Gaps:** Data-source changes are easy to make accidentally on mobile, and modal navigation lacks visible controls.

### Consistency and standards

**Strengths:** Consistent glass panels, rounded controls, cyan active state, and dark theme.

**Gaps:** Some actions are links, some are buttons, and labels vary between “SDOT source,” “SDOT page,” “Open on SDOT,” and source controls.

### Error prevention and recovery

**Strengths:** Error boundary, data-source settings, and retry action exist.

**Gaps:** Raw URL input has no validation, empty states do not summarize all active constraints, and failed stream/image states could offer recovery actions.

## Prioritized roadmap

### Next 1–2 days

1. Add `aria-label` to icon-only buttons and external links.
2. Make card actions visible on keyboard focus with `focus-within` styles.
3. Correct the focus modal “2m” snapshot timestamp mismatch.
4. Add helper text that explains whether filters use AND or OR behavior.
5. Add a marker legend to the map view.

### Next sprint

1. Implement focus trapping/restoration and `aria-labelledby` in the focus modal.
2. Increase small muted label contrast and establish minimum legible type sizes.
3. Add source validation, current source status, and a restore-default button.
4. Add stale-data handling when a refresh fails after data has loaded.
5. Add visible previous/next controls in focus mode.

### Later enhancements

1. Add camera result highlighting and expanded search fields.
2. Add chip count badges and optional match-any filter mode.
3. Add map clustering and fit-to-results controls.
4. Add saved views or shareable presets for common corridors.
5. Add a high-legibility theme setting.

## Suggested success metrics

- Search-to-camera-open completion rate.
- Time to identify and open a camera from grid and map views.
- Percentage of users who switch views successfully.
- Data-source setting error rate.
- Stream play success/failure rate.
- Keyboard-only task completion for search, filter, open focus, navigate, and close.
- Mobile tap error rate on bottom dock controls.

## Conclusion

The current site has a compelling concept and a polished visual foundation, but its next level of quality depends on making core actions more explicit, accessible, and resilient. The most impactful improvements are small, targeted changes: clearer labels, better focus behavior, more visible actions, more transparent filtering, and a map legend. These changes would preserve the command-center identity while making the app easier to use under real-world traffic-monitoring conditions.
