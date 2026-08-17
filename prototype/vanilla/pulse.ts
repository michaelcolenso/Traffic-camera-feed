export type PulseD1Statement = {
  bind: (...values: unknown[]) => PulseD1Statement;
  all: <T>() => Promise<{ results?: T[] }>;
};

type PulseD1Database = {
  prepare: (query: string) => PulseD1Statement;
};

export type PulseBindings = { HISTORY_DB?: PulseD1Database };

type SnapshotRow = {
  camera_id: string;
  camera_label: string;
  captured_at: number;
  r2_key: string;
  sha256: string;
  is_duplicate: number;
  visual_fingerprint: string | null;
  mean_luma: number | null;
  visual_contrast: number | null;
  latitude: number | null;
  longitude: number | null;
};

type ConfidenceBand = 'low' | 'moderate' | 'high';
type Severity = 'low' | 'moderate' | 'high';
type ObservationState = 'insufficient_data' | 'baseline' | 'changing' | 'persistent' | 'recovering';
type ChangeType = 'scene_shift' | 'brightness_shift' | 'visibility_shift' | 'high_visual_activity' | 'persistent_change' | 'stable';

type FrameMetrics = {
  pixelDifference: number;
  brightnessDelta: number;
  contrastDelta: number;
};

type Observation = {
  cameraId: string;
  label: string;
  observedAt: number;
  capturedAt: number;
  changeType: ChangeType;
  direction?: 'up' | 'down' | 'recovering';
  severity: Severity;
  confidence: ConfidenceBand;
  confidenceScore: number;
  state: ObservationState;
  baselineWindowMinutes: number;
  sampleCount: number;
  persistenceSamples: number;
  transitions: number;
  uniqueScenes: number;
  transitionRate: number;
  score: number;
  reason: string;
  corridor: string | null;
  latitude: number | null;
  longitude: number | null;
  metrics: FrameMetrics & { sceneDiversity: number; transitionRate: number };
  evidence: {
    beforeCapturedAt: number | null;
    afterCapturedAt: number;
    beforeImageUrl: string | null;
    afterImageUrl: string;
    firstObservedAt: number | null;
    lastObservedAt: number;
  };
  display: { headline: string; detail: string };
};

type CorrelatedEvent = {
  id: string;
  title: string;
  cameraIds: string[];
  cameraCount: number;
  firstObservedAt: number;
  lastObservedAt: number;
  severity: Severity;
  confidence: ConfidenceBand;
  center: { lat: number; lng: number } | null;
  detail: string;
};

const DEFAULT_WINDOW_MINUTES = 60;
const MAX_WINDOW_MINUTES = 360;
const MAX_LIMIT = 24;
const MIN_SURFACED_SCORE = 25;
const CORRELATION_RADIUS_KM = 1.4;
const CORRELATION_WINDOW_MS = 10 * 60 * 1000;

function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', 'public, max-age=20, s-maxage=45, stale-while-revalidate=90');
  return new Response(JSON.stringify(data), { ...init, headers });
}

function historyImageUrl(key: string | null): string | null {
  return key ? `/api/history/image?key=${encodeURIComponent(key)}` : null;
}

function corridorWeight(label: string): { weight: number; corridor: string | null } {
  const value = label.toLowerCase();
  const groups: Array<[string, string[], number]> = [
    ['I-5', ['i-5', 'i5', 'interstate 5'], 4],
    ['Aurora / SR-99', ['aurora', 'sr 99', 'sr99'], 4],
    ['West Seattle', ['west seattle', 'spokane st', 'spokane street'], 4],
    ['Major bridge', ['bridge', 'fremont', 'ballard', 'montlake', 'university bridge'], 3],
    ['Downtown core', ['1st ave', '2nd ave', '3rd ave', '4th ave', '5th ave', '6th ave', 'pike', 'pine', 'madison', 'yesler', 'jackson'], 2],
  ];
  for (const [corridor, terms, weight] of groups) {
    if (terms.some((term) => value.includes(term))) return { weight, corridor };
  }
  return { weight: 0, corridor: null };
}

function decodeFingerprint(value: string | null): number[] | null {
  if (!value) return null;
  try {
    const raw = atob(value);
    const result = Array.from(raw, (char) => char.charCodeAt(0));
    return result.length ? result : null;
  } catch {
    return null;
  }
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function baselineFingerprint(rows: SnapshotRow[]): { pixels: number[]; mean: number; contrast: number; row: SnapshotRow } | null {
  const usable = rows.map((row) => ({ row, pixels: decodeFingerprint(row.visual_fingerprint) })).filter((item): item is { row: SnapshotRow; pixels: number[] } => Boolean(item.pixels));
  if (usable.length < 3) return null;
  const length = usable[0].pixels.length;
  if (!length || usable.some((item) => item.pixels.length !== length)) return null;
  const pixels = Array.from({ length }, (_, index) => median(usable.map((item) => item.pixels[index])));
  return {
    pixels,
    mean: median(usable.map((item) => Number(item.row.mean_luma) || 0)),
    contrast: median(usable.map((item) => Number(item.row.visual_contrast) || 0)),
    row: usable[Math.floor(usable.length / 2)].row,
  };
}

function compareFrame(row: SnapshotRow, baseline: { pixels: number[]; mean: number; contrast: number }): FrameMetrics | null {
  const pixels = decodeFingerprint(row.visual_fingerprint);
  if (!pixels || pixels.length !== baseline.pixels.length) return null;
  const pixelDifference = pixels.reduce((sum, value, index) => sum + Math.abs(value - baseline.pixels[index]), 0) / (pixels.length * 255);
  const brightnessDelta = ((Number(row.mean_luma) || 0) - baseline.mean) / 255;
  const contrastDelta = ((Number(row.visual_contrast) || 0) - baseline.contrast) / 128;
  return {
    pixelDifference: Number(pixelDifference.toFixed(4)),
    brightnessDelta: Number(brightnessDelta.toFixed(4)),
    contrastDelta: Number(contrastDelta.toFixed(4)),
  };
}

function isMeaningfulChange(metrics: FrameMetrics | null): boolean {
  return Boolean(metrics && (metrics.pixelDifference >= 0.08 || Math.abs(metrics.brightnessDelta) >= 0.1 || metrics.contrastDelta <= -0.15));
}

function confidenceBand(value: number): ConfidenceBand {
  if (value >= 0.76) return 'high';
  if (value >= 0.48) return 'moderate';
  return 'low';
}

function severityBand(value: number): Severity {
  if (value >= 0.66) return 'high';
  if (value >= 0.34) return 'moderate';
  return 'low';
}

function deriveObservation(rows: SnapshotRow[], now: number, windowMinutes: number): Observation | null {
  if (rows.length < 2) return null;
  const latest = rows[rows.length - 1];
  const transitions = rows.reduce((sum, row) => sum + (row.is_duplicate ? 0 : 1), 0);
  const uniqueScenes = new Set(rows.map((row) => row.sha256)).size;
  const transitionRate = rows.length ? transitions / rows.length : 0;
  const corridor = corridorWeight(latest.camera_label || '');
  const ageMinutes = Math.max(0, (now - latest.captured_at) / 60000);
  const freshness = Math.max(0, 1 - ageMinutes / 20);

  const visualRows = rows.filter((row) => row.visual_fingerprint);
  const baselineRows = visualRows.length >= 6 ? visualRows.slice(0, Math.max(3, visualRows.length - 3)) : visualRows.slice(0, 3);
  const baseline = baselineFingerprint(baselineRows);

  if (!baseline) {
    const confidenceScore = Math.min(0.72, rows.length / 10);
    const confidence = confidenceBand(confidenceScore);
    if (confidence === 'low' || transitions < 2 || uniqueScenes < 2) return null;
    const score = Math.round(Math.min(64, transitions * 7 + transitionRate * 24 + freshness * 8 + corridor.weight));
    if (score < MIN_SURFACED_SCORE) return null;
    const headline = transitions >= 5 ? 'Repeated scene changes' : 'Recent visual change';
    return {
      cameraId: latest.camera_id,
      label: latest.camera_label,
      observedAt: now,
      capturedAt: latest.captured_at,
      changeType: transitions >= 5 ? 'high_visual_activity' : 'scene_shift',
      severity: severityBand(score / 100),
      confidence,
      confidenceScore: Number(confidenceScore.toFixed(2)),
      state: 'changing',
      baselineWindowMinutes: windowMinutes,
      sampleCount: rows.length,
      persistenceSamples: 1,
      transitions,
      uniqueScenes,
      transitionRate: Number(transitionRate.toFixed(3)),
      score,
      reason: headline,
      corridor: corridor.corridor,
      latitude: latest.latitude,
      longitude: latest.longitude,
      metrics: { pixelDifference: 0, brightnessDelta: 0, contrastDelta: 0, sceneDiversity: uniqueScenes, transitionRate: Number(transitionRate.toFixed(3)) },
      evidence: {
        beforeCapturedAt: rows[0]?.captured_at ?? null,
        afterCapturedAt: latest.captured_at,
        beforeImageUrl: historyImageUrl(rows[0]?.r2_key ?? null),
        afterImageUrl: historyImageUrl(latest.r2_key)!,
        firstObservedAt: rows[Math.max(0, rows.length - Math.min(transitions, rows.length))]?.captured_at ?? null,
        lastObservedAt: latest.captured_at,
      },
      display: { headline, detail: `${transitions} meaningful scene transitions in the recent window` },
    };
  }

  const recent = visualRows.slice(-4);
  const comparisons = recent.map((row) => ({ row, metrics: compareFrame(row, baseline) }));
  const changed = comparisons.map((item) => isMeaningfulChange(item.metrics));
  let persistenceSamples = 0;
  for (let index = changed.length - 1; index >= 0 && changed[index]; index -= 1) persistenceSamples += 1;
  const latestMetrics = comparisons[comparisons.length - 1]?.metrics ?? null;
  const latestChanged = isMeaningfulChange(latestMetrics);
  const previousChanged = changed.slice(0, -1).some(Boolean);
  let state: ObservationState = 'baseline';
  if (latestChanged && persistenceSamples >= 3) state = 'persistent';
  else if (latestChanged) state = 'changing';
  else if (previousChanged) state = 'recovering';

  const sampleConfidence = Math.min(1, visualRows.length / 8);
  const persistenceConfidence = Math.min(1, Math.max(1, persistenceSamples) / 3);
  const confidenceScore = Math.min(1, sampleConfidence * (0.72 + persistenceConfidence * 0.28));
  const confidence = confidenceBand(confidenceScore);
  if (confidence === 'low') return null;

  const pixel = latestMetrics?.pixelDifference ?? 0;
  const brightness = latestMetrics?.brightnessDelta ?? 0;
  const contrast = latestMetrics?.contrastDelta ?? 0;
  const magnitude = Math.max(pixel / 0.2, Math.abs(brightness) / 0.2, Math.max(0, -contrast) / 0.3);
  const severity = severityBand(Math.min(1, magnitude));

  let changeType: ChangeType = 'stable';
  let direction: Observation['direction'];
  let headline = 'Stable recent view';
  let detail = 'No strong visual change detected';

  if (state === 'recovering') {
    changeType = 'scene_shift';
    direction = 'recovering';
    headline = 'Returning toward recent baseline';
    detail = 'Recent visual change is no longer present in the newest capture';
  } else if (state === 'persistent') {
    changeType = 'persistent_change';
    headline = 'Persistent visual change';
    detail = `Different from baseline across ${persistenceSamples} consecutive captures`;
  } else if (Math.abs(brightness) >= 0.12) {
    changeType = 'brightness_shift';
    direction = brightness > 0 ? 'up' : 'down';
    headline = brightness > 0 ? 'Scene became materially brighter' : 'Scene became materially darker';
    detail = `Brightness shifted ${Math.round(Math.abs(brightness) * 100)}% from the recent baseline`;
  } else if (contrast <= -0.16) {
    changeType = 'visibility_shift';
    direction = 'down';
    headline = 'Visibility or contrast dropped';
    detail = `Contrast is ${Math.round(Math.abs(contrast) * 100)}% below the recent baseline`;
  } else if (pixel >= 0.1) {
    changeType = 'scene_shift';
    headline = pixel >= 0.16 ? 'Large visual change' : 'Scene shifted from recent baseline';
    detail = `Visual difference is ${Math.round(pixel * 100)}% from the recent baseline`;
  } else if (transitions >= 5 && transitionRate >= 0.35) {
    changeType = 'high_visual_activity';
    headline = 'Repeated scene changes';
    detail = `${transitions} scene transitions in the recent window`;
  }

  if (changeType === 'stable' && state === 'baseline') return null;

  const stateBoost = state === 'persistent' ? 22 : state === 'changing' ? 12 : state === 'recovering' ? 5 : 0;
  const severityBoost = severity === 'high' ? 28 : severity === 'moderate' ? 18 : 8;
  const persistenceBoost = Math.min(18, persistenceSamples * 6);
  const confidenceBoost = confidence === 'high' ? 16 : 10;
  const churnBoost = Math.min(8, transitionRate * 12);
  const score = Math.round(Math.min(100, stateBoost + severityBoost + persistenceBoost + confidenceBoost + freshness * 8 + churnBoost + corridor.weight));
  if (score < MIN_SURFACED_SCORE) return null;

  const firstChanged = [...comparisons].reverse().findLast ? undefined : undefined;
  let firstObservedAt: number | null = null;
  for (let index = changed.length - persistenceSamples; index < changed.length; index += 1) {
    if (index >= 0 && changed[index]) { firstObservedAt = comparisons[index].row.captured_at; break; }
  }

  return {
    cameraId: latest.camera_id,
    label: latest.camera_label,
    observedAt: now,
    capturedAt: latest.captured_at,
    changeType,
    ...(direction ? { direction } : {}),
    severity,
    confidence,
    confidenceScore: Number(confidenceScore.toFixed(2)),
    state,
    baselineWindowMinutes: windowMinutes,
    sampleCount: rows.length,
    persistenceSamples,
    transitions,
    uniqueScenes,
    transitionRate: Number(transitionRate.toFixed(3)),
    score,
    reason: headline,
    corridor: corridor.corridor,
    latitude: latest.latitude,
    longitude: latest.longitude,
    metrics: {
      pixelDifference: Number(pixel.toFixed(4)),
      brightnessDelta: Number(brightness.toFixed(4)),
      contrastDelta: Number(contrast.toFixed(4)),
      sceneDiversity: uniqueScenes,
      transitionRate: Number(transitionRate.toFixed(3)),
    },
    evidence: {
      beforeCapturedAt: baseline.row.captured_at,
      afterCapturedAt: latest.captured_at,
      beforeImageUrl: historyImageUrl(baseline.row.r2_key),
      afterImageUrl: historyImageUrl(latest.r2_key)!,
      firstObservedAt,
      lastObservedAt: latest.captured_at,
    },
    display: { headline, detail },
  };
}

function haversineKm(a: Observation, b: Observation): number {
  if (a.latitude == null || a.longitude == null || b.latitude == null || b.longitude == null) return Infinity;
  const toRad = (value: number) => value * Math.PI / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function correlate(items: Observation[]): CorrelatedEvent[] {
  const eligible = items.filter((item) => item.latitude != null && item.longitude != null && item.confidence !== 'low' && item.score >= 35);
  const used = new Set<string>();
  const events: CorrelatedEvent[] = [];
  for (const anchor of eligible) {
    if (used.has(anchor.cameraId)) continue;
    const group = eligible.filter((candidate) => !used.has(candidate.cameraId) && Math.abs(candidate.capturedAt - anchor.capturedAt) <= CORRELATION_WINDOW_MS && haversineKm(anchor, candidate) <= CORRELATION_RADIUS_KM);
    if (group.length < 2) continue;
    group.forEach((item) => used.add(item.cameraId));
    const lat = group.reduce((sum, item) => sum + Number(item.latitude), 0) / group.length;
    const lng = group.reduce((sum, item) => sum + Number(item.longitude), 0) / group.length;
    const highCount = group.filter((item) => item.severity === 'high').length;
    const highConfidence = group.filter((item) => item.confidence === 'high').length;
    const corridors = group.map((item) => item.corridor).filter(Boolean) as string[];
    const corridor = corridors.length ? corridors.sort((a, b) => corridors.filter((value) => value === b).length - corridors.filter((value) => value === a).length)[0] : null;
    const title = corridor ? `${corridor} area changing` : 'Nearby cameras changing';
    events.push({
      id: `event-${anchor.cameraId}-${anchor.capturedAt}`,
      title,
      cameraIds: group.map((item) => item.cameraId),
      cameraCount: group.length,
      firstObservedAt: Math.min(...group.map((item) => item.evidence.firstObservedAt || item.capturedAt)),
      lastObservedAt: Math.max(...group.map((item) => item.capturedAt)),
      severity: highCount ? 'high' : group.some((item) => item.severity === 'moderate') ? 'moderate' : 'low',
      confidence: highConfidence >= Math.ceil(group.length / 2) ? 'high' : 'moderate',
      center: { lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)) },
      detail: `${group.length} nearby cameras changed within ${Math.round(CORRELATION_WINDOW_MS / 60000)} minutes`,
    });
  }
  return events.sort((a, b) => b.cameraCount - a.cameraCount || b.lastObservedAt - a.lastObservedAt).slice(0, 8);
}

export async function handlePulseRequest(request: Request, url: URL, env: PulseBindings): Promise<Response | null> {
  if (url.pathname !== '/api/pulse') return null;
  if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET' } });
  if (!env.HISTORY_DB) return json({ error: 'Pulse history is not configured' }, { status: 503 });
  const windowMinutes = Math.min(Math.max(Math.floor(Number(url.searchParams.get('window') || DEFAULT_WINDOW_MINUTES)), 15), MAX_WINDOW_MINUTES);
  const limit = Math.min(Math.max(Math.floor(Number(url.searchParams.get('limit') || 12)), 1), MAX_LIMIT);
  const now = Date.now();
  const cutoff = now - windowMinutes * 60000;
  const result = await env.HISTORY_DB.prepare(`
    SELECT camera_id, camera_label, captured_at, r2_key, sha256, is_duplicate,
           visual_fingerprint, mean_luma, visual_contrast, latitude, longitude
      FROM camera_snapshots
     WHERE captured_at >= ?
     ORDER BY camera_id ASC, captured_at ASC
  `).bind(cutoff).all<SnapshotRow>();

  const grouped = new Map<string, SnapshotRow[]>();
  for (const row of result.results ?? []) {
    const rows = grouped.get(row.camera_id) ?? [];
    rows.push(row);
    grouped.set(row.camera_id, rows);
  }

  const all = [...grouped.values()]
    .map((rows) => deriveObservation(rows, now, windowMinutes))
    .filter((item): item is Observation => Boolean(item))
    .sort((a, b) => b.score - a.score || b.persistenceSamples - a.persistenceSamples || b.capturedAt - a.capturedAt);
  const items = all.slice(0, limit);
  const events = correlate(all);
  const active = all.filter((item) => item.score >= 35).length;
  const top = all.slice(0, Math.min(10, all.length));
  const pulseScore = top.length ? Math.round(top.reduce((sum, item) => sum + item.score, 0) / top.length) : 0;
  const state = events.length >= 3 || pulseScore >= 65 ? 'high activity' : events.length || pulseScore >= 40 ? 'active' : pulseScore >= 20 ? 'some movement' : 'quiet';

  return json({
    generatedAt: now,
    windowMinutes,
    pulseScore,
    state,
    activeCameras: active,
    camerasAnalyzed: grouped.size,
    observationCount: all.length,
    eventCount: events.length,
    methodology: 'Ranks deterministic visual observations using recent camera baselines, persistence, severity, confidence and freshness. Nearby qualifying observations may be correlated. It does not infer crashes, congestion, weather, incidents or causes.',
    events,
    items,
  });
}
