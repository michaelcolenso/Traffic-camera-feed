from pathlib import Path

# 1) Fix observation math: count actual adjacent SHA transitions, keep baseline disjoint
# from the recent evaluation set, and choose real evidence frame closest to median baseline.
pulse = Path('prototype/vanilla/pulse.ts')
s = pulse.read_text()
s = s.replace(
"""  const pixels = Array.from({ length }, (_, index) => median(usable.map((item) => item.pixels[index])));
  return {
    pixels,
    mean: median(usable.map((item) => Number(item.row.mean_luma) || 0)),
    contrast: median(usable.map((item) => Number(item.row.visual_contrast) || 0)),
    row: usable[Math.floor(usable.length / 2)].row,
  };""",
"""  const pixels = Array.from({ length }, (_, index) => median(usable.map((item) => item.pixels[index])));
  const mean = median(usable.map((item) => Number(item.row.mean_luma) || 0));
  const contrast = median(usable.map((item) => Number(item.row.visual_contrast) || 0));
  const representative = usable.reduce((best, item) => {
    const distance = item.pixels.reduce((sum, value, index) => sum + Math.abs(value - pixels[index]), 0);
    return !best || distance < best.distance ? { row: item.row, distance } : best;
  }, null as { row: SnapshotRow; distance: number } | null);
  return {
    pixels,
    mean,
    contrast,
    row: representative?.row ?? usable[0].row,
  };"""
)
s = s.replace(
"  const transitions = rows.reduce((sum, row) => sum + (row.is_duplicate ? 0 : 1), 0);",
"  const transitions = rows.slice(1).reduce((sum, row, index) => sum + (row.sha256 !== rows[index].sha256 ? 1 : 0), 0);"
)
s = s.replace(
"""  const visualRows = rows.filter((row) => row.visual_fingerprint);
  const baselineRows = visualRows.length >= 6 ? visualRows.slice(0, Math.max(3, visualRows.length - 3)) : visualRows.slice(0, 3);
  const baseline = baselineFingerprint(baselineRows);""",
"""  const visualRows = rows.filter((row) => row.visual_fingerprint);
  const recentCount = Math.min(4, Math.max(0, visualRows.length - 3));
  const baselineRows = recentCount > 0 ? visualRows.slice(0, -recentCount) : visualRows;
  const recent = recentCount > 0 ? visualRows.slice(-recentCount) : [];
  const baseline = baselineFingerprint(baselineRows);"""
)
s = s.replace("  const recent = visualRows.slice(-4);\n  const comparisons = recent.map((row) => ({ row, metrics: compareFrame(row, baseline) }));",
              "  const comparisons = recent.map((row) => ({ row, metrics: compareFrame(row, baseline) }));")
pulse.write_text(s)

# 2) Make DOM enhancement idempotent so MutationObserver cannot create a self-triggering rewrite loop.
phase2 = Path('prototype/vanilla/public/phase2.js')
j = phase2.read_text()
j = j.replace(
"""    if (copy) {
      const persistence = observation.persistenceSamples >= 2 ? ` · ${observation.persistenceSamples} captures` : '';
      const confidence = confidenceLabel(observation.confidence);
      copy.innerHTML = `${escapeHtml(observation.display?.headline || observation.reason)} · ${escapeHtml(relativeTime(observation.capturedAt))}${escapeHtml(persistence)}${confidence ? ` <span class=\"phase2-confidence\">${escapeHtml(confidence)}</span>` : ''} · <span class=\"phase2-evidence\">Open evidence →</span>`;
      copy.title = observation.display?.detail || observation.reason || '';
    }""",
"""    if (copy) {
      const persistence = observation.persistenceSamples >= 2 ? ` · ${observation.persistenceSamples} captures` : '';
      const confidence = confidenceLabel(observation.confidence);
      const markup = `${escapeHtml(observation.display?.headline || observation.reason)} · ${escapeHtml(relativeTime(observation.capturedAt))}${escapeHtml(persistence)}${confidence ? ` <span class=\"phase2-confidence\">${escapeHtml(confidence)}</span>` : ''} · <span class=\"phase2-evidence\">Open evidence →</span>`;
      const signature = `${observation.capturedAt}:${observation.state}:${observation.severity}:${observation.confidence}:${observation.persistenceSamples}:${observation.display?.headline || observation.reason}`;
      if (copy.dataset.phase2Signature !== signature) {
        copy.dataset.phase2Signature = signature;
        copy.innerHTML = markup;
        copy.title = observation.display?.detail || observation.reason || '';
      }
    }"""
)
# Only rewrite event rail when event payload actually changed.
j = j.replace(
"  events.innerHTML = pulseEvents.slice(0, 4).map((event) => `<div class=\"phase2-event\"><strong>${escapeHtml(event.title)}</strong><span>${escapeHtml(event.detail)} · ${escapeHtml(event.confidence)} confidence</span></div>`).join('');",
"""  const eventMarkup = pulseEvents.slice(0, 4).map((event) => `<div class=\"phase2-event\"><strong>${escapeHtml(event.title)}</strong><span>${escapeHtml(event.detail)} · ${escapeHtml(event.confidence)} confidence</span></div>`).join('');
  if (events.dataset.phase2Markup !== eventMarkup) {
    events.dataset.phase2Markup = eventMarkup;
    events.innerHTML = eventMarkup;
  }"""
)
phase2.write_text(j)

# 3) Remove redundant fingerprint-heavy index; camera/time index already exists in migration 0001.
migration = Path('migrations/0002_visual_observations.sql')
m = migration.read_text()
m = m.replace("\nCREATE INDEX IF NOT EXISTS idx_camera_snapshots_visual_time\n  ON camera_snapshots(camera_id, captured_at DESC, visual_fingerprint);\n", "")
migration.write_text(m)
