export type PulseD1Statement = {
  bind: (...values: unknown[]) => PulseD1Statement;
  all: <T>() => Promise<{ results?: T[] }>;
};

type PulseD1Database = {
  prepare: (query: string) => PulseD1Statement;
};

export type PulseBindings = { HISTORY_DB?: PulseD1Database };

type PulseRow = {
  camera_id: string;
  camera_label: string;
  samples: number;
  transitions: number;
  unique_scenes: number;
  latest_captured_at: number;
  latest_duplicate: number;
};

const DEFAULT_WINDOW_MINUTES = 60;
const MAX_WINDOW_MINUTES = 360;
const MAX_LIMIT = 24;

function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', 'public, max-age=20, s-maxage=45, stale-while-revalidate=90');
  return new Response(JSON.stringify(data), { ...init, headers });
}

function corridorWeight(label: string): { weight: number; corridor: string | null } {
  const value = label.toLowerCase();
  const groups: Array<[string, string[], number]> = [
    ['I-5', ['i-5', 'i5', 'interstate 5'], 10],
    ['Aurora / SR-99', ['aurora', 'sr 99', 'sr99'], 9],
    ['West Seattle', ['west seattle', 'spokane st', 'spokane street'], 9],
    ['Major bridge', ['bridge', 'fremont', 'ballard', 'montlake', 'university bridge'], 8],
    ['Downtown core', ['1st ave', '2nd ave', '3rd ave', '4th ave', '5th ave', '6th ave', 'pike', 'pine', 'madison', 'yesler', 'jackson'], 6],
  ];
  for (const [corridor, terms, weight] of groups) {
    if (terms.some((term) => value.includes(term))) return { weight, corridor };
  }
  return { weight: 2, corridor: null };
}

function scoreRow(row: PulseRow, now: number) {
  const samples = Number(row.samples) || 0;
  const transitions = Number(row.transitions) || 0;
  const uniqueScenes = Number(row.unique_scenes) || 0;
  const latestCapturedAt = Number(row.latest_captured_at) || 0;
  const changedNow = Number(row.latest_duplicate) === 0;
  const ageMinutes = Math.max(0, (now - latestCapturedAt) / 60000);
  const transitionRate = samples ? transitions / samples : 0;
  const freshness = Math.max(0, 1 - ageMinutes / 20);
  const confidence = Math.min(1, samples / 8);
  const corridor = corridorWeight(row.camera_label || '');
  const hasChangeEvidence = transitions > 0 || uniqueScenes > 1 || changedNow;
  let score = 0;
  if (hasChangeEvidence) {
    score += Math.min(48, transitions * 8);
    score += Math.min(18, Math.max(0, uniqueScenes - 1) * 4.5);
    score += Math.min(14, transitionRate * 24);
    score += changedNow ? 10 : 0;
    score += freshness * 6;
    score += corridor.weight;
    score *= 0.55 + confidence * 0.45;
  }
  score = Math.round(Math.max(0, Math.min(100, score)));
  let reason = corridor.corridor ? 'Stable recent view on ' + corridor.corridor : 'Stable recent view';
  if (transitions >= 5) reason = 'Repeated scene changes';
  else if (transitionRate >= 0.5 && samples >= 4) reason = 'High visual churn';
  else if (changedNow && transitions >= 2) reason = 'Fresh scene shift';
  else if (uniqueScenes >= 4) reason = 'Several distinct recent scenes';
  else if (transitions >= 1 && corridor.corridor) reason = 'Change on ' + corridor.corridor;
  else if (transitions >= 1 || changedNow) reason = 'Recent scene change';
  return {
    cameraId: row.camera_id,
    label: row.camera_label,
    score,
    reason,
    corridor: corridor.corridor,
    samples,
    transitions,
    uniqueScenes,
    transitionRate: Number(transitionRate.toFixed(3)),
    changedNow,
    confidence: Number(confidence.toFixed(2)),
    capturedAt: latestCapturedAt,
    ageMinutes: Number(ageMinutes.toFixed(1)),
  };
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
    WITH recent AS (
      SELECT camera_id, camera_label, captured_at, sha256, is_duplicate
        FROM camera_snapshots
       WHERE captured_at >= ?
    ), ranked AS (
      SELECT camera_id, camera_label, captured_at, is_duplicate,
             ROW_NUMBER() OVER (PARTITION BY camera_id ORDER BY captured_at DESC) AS recency_rank
        FROM recent
    ), aggregate AS (
      SELECT camera_id,
             MAX(camera_label) AS camera_label,
             COUNT(*) AS samples,
             SUM(CASE WHEN is_duplicate = 0 THEN 1 ELSE 0 END) AS transitions,
             COUNT(DISTINCT sha256) AS unique_scenes,
             MAX(captured_at) AS latest_captured_at
        FROM recent
       GROUP BY camera_id
    )
    SELECT aggregate.camera_id, aggregate.camera_label, aggregate.samples, aggregate.transitions,
           aggregate.unique_scenes, aggregate.latest_captured_at,
           ranked.is_duplicate AS latest_duplicate
      FROM aggregate
      JOIN ranked ON ranked.camera_id = aggregate.camera_id AND ranked.recency_rank = 1
     WHERE aggregate.samples >= 2
  `).bind(cutoff).all<PulseRow>();
  const all = (result.results ?? []).map((row) => scoreRow(row, now)).sort((a, b) => b.score - a.score || b.transitions - a.transitions || b.capturedAt - a.capturedAt);
  const items = all.slice(0, limit);
  const active = all.filter((item) => item.score >= 20).length;
  const top = all.slice(0, Math.min(10, all.length));
  const pulseScore = top.length ? Math.round(top.reduce((sum, item) => sum + item.score, 0) / top.length) : 0;
  const state = pulseScore >= 60 ? 'high activity' : pulseScore >= 35 ? 'active' : pulseScore >= 15 ? 'some movement' : 'quiet';
  return json({
    generatedAt: now,
    windowMinutes,
    pulseScore,
    state,
    activeCameras: active,
    camerasAnalyzed: all.length,
    methodology: 'Ranks observed camera-scene change frequency, recency, sample confidence, and corridor relevance. It does not infer crashes, congestion, or causes.',
    items,
  });
}
