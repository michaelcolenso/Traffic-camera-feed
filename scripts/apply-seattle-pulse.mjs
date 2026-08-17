import fs from 'node:fs';

const pulse = `export type PulseD1Statement = {
  bind: (...values: unknown[]) => PulseD1Statement;
  all: <T>() => Promise<{ results?: T[] }>;
};

export type PulseD1Database = {
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
  const transitionRate = samples > 1 ? transitions / (samples - 1) : 0;
  const freshness = Math.max(0, 1 - ageMinutes / 20);
  const confidence = Math.min(1, samples / 8);
  const corridor = corridorWeight(row.camera_label || '');

  let score = 0;
  score += Math.min(44, transitions * 11);
  score += Math.min(18, Math.max(0, uniqueScenes - 1) * 4.5);
  score += transitionRate * 12;
  score += changedNow ? 8 : 0;
  score += freshness * 8;
  score += corridor.weight;
  score *= 0.55 + confidence * 0.45;
  score = Math.round(Math.max(0, Math.min(100, score)));

  let reason = 'Recent scene change';
  if (transitions >= 5) reason = 'Repeated scene changes';
  else if (transitionRate >= 0.65 && samples >= 4) reason = 'High visual churn';
  else if (changedNow && transitions >= 2) reason = 'Fresh scene shift';
  else if (uniqueScenes >= 4) reason = 'Several distinct recent scenes';
  else if (corridor.corridor && transitions >= 1) reason = `Change on ${corridor.corridor}`;

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
      SELECT camera_id, camera_label, captured_at, sha256, is_duplicate,
             LAG(sha256) OVER (PARTITION BY camera_id ORDER BY captured_at) AS previous_sha
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
             SUM(CASE WHEN previous_sha IS NOT NULL AND previous_sha <> sha256 THEN 1 ELSE 0 END) AS transitions,
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
  const active = all.filter((item) => item.score >= 25).length;
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
`;
fs.writeFileSync('prototype/vanilla/pulse.ts', pulse);

function replace(path, from, to) {
  let text = fs.readFileSync(path, 'utf8');
  if (!text.includes(from)) throw new Error(`Anchor not found in ${path}: ${from.slice(0,80)}`);
  text = text.replace(from, to);
  fs.writeFileSync(path, text);
}

replace('prototype/vanilla/worker.ts',
  "import { captureHistory, handleHistoryRequest, purgeHistory, type HistoryBindings } from './history';",
  "import { captureHistory, handleHistoryRequest, purgeHistory, type HistoryBindings } from './history';\nimport { handlePulseRequest, type PulseBindings } from './pulse';");

replace('prototype/vanilla/worker.ts',
  '<section class="toolbar">',
  '<section id="pulse" class="pulse" aria-label="Seattle Pulse"><div class="pulse-loading"><div><p class="eyebrow">Seattle Pulse</p><strong>Reading the city…</strong></div><span>Ranking recent camera changes</span></div></section>\n    <section class="toolbar">');

replace('prototype/vanilla/worker.ts',
  'async fetch(request: Request, env: Env & HistoryBindings): Promise<Response> {\n    const url = new URL(request.url);\n    const historyResponse = await handleHistoryRequest(request, url, env);\n    if (historyResponse) return historyResponse;',
  'async fetch(request: Request, env: Env & HistoryBindings & PulseBindings): Promise<Response> {\n    const url = new URL(request.url);\n    const historyResponse = await handleHistoryRequest(request, url, env);\n    if (historyResponse) return historyResponse;\n    const pulseResponse = await handlePulseRequest(request, url, env);\n    if (pulseResponse) return pulseResponse;');

replace('prototype/vanilla/public/benchmark.js',
  "let timelapseTimer = null;\nconst ANOMALY_START_DELAY = 12000;",
  "let timelapseTimer = null;\nlet pulse = null;\nlet pulseTimer = null;\nconst PULSE_REFRESH_MS = 60000;\nconst ANOMALY_START_DELAY = 12000;");

replace('prototype/vanilla/public/benchmark.js',
  "const sourceError = $('#source-error');",
  "const sourceError = $('#source-error');\nconst pulseEl = $('#pulse');");

const pulseJs = `
function pulseCamera(item) { return cameraById(item.cameraId); }
function pulseTime(value) {
  const minutes=Math.max(0,Math.round((Date.now()-value)/60000));
  return minutes<1?'just now':minutes===1?'1 min ago':\`${'${minutes}'} min ago\`;
}
function renderPulse() {
  if (!pulseEl) return;
  if (!pulse) {
    pulseEl.innerHTML='<div class="pulse-loading"><div><p class="eyebrow">Seattle Pulse</p><strong>Reading the city…</strong></div><span>Ranking recent camera changes</span></div>';
    return;
  }
  const items=(pulse.items||[]).filter((item)=>pulseCamera(item)).slice(0,6);
  const cards=items.map((item,index)=>{
    const camera=pulseCamera(item);
    return \`<button class="pulse-card" data-pulse-camera="\${escapeHtml(item.cameraId)}"><span class="pulse-rank">#\${index+1}</span><span class="pulse-thumb"><img src="\${imageUrl(camera,480,true)}" alt="" width="160" height="90" loading="lazy"></span><span class="pulse-copy"><strong>\${escapeHtml(camera.label)}</strong><small>\${escapeHtml(item.reason)} · \${item.transitions} changes · \${pulseTime(item.capturedAt)}</small></span><span class="pulse-score" title="Evidence-based Pulse score">\${item.score}</span></button>\`;
  }).join('');
  pulseEl.innerHTML=\`<div class="pulse-head"><div><p class="eyebrow">Seattle Pulse</p><div class="pulse-title"><strong>\${pulse.state}</strong><span>\${pulse.pulseScore}/100</span></div></div><div class="pulse-meta"><span>\${pulse.activeCameras} active cameras</span><span>\${pulse.camerasAnalyzed} analyzed</span><button id="pulse-refresh" class="chip">Refresh</button></div></div><div class="pulse-rail">\${cards||'<div class="pulse-empty">History is still warming up.</div>'}</div><p class="pulse-method">Observed visual change only — Pulse does not infer crashes, congestion, or causes.</p>\`;
  pulseEl.querySelectorAll('[data-pulse-camera]').forEach((button)=>button.addEventListener('click',()=>openFocus(button.dataset.pulseCamera)));
  $('#pulse-refresh')?.addEventListener('click',()=>loadPulse(true));
}
async function loadPulse(force=false) {
  if (!pulseEl || document.hidden) return;
  const url=new URL('/api/pulse',location.origin);url.searchParams.set('window','60');url.searchParams.set('limit','12');if(force)url.searchParams.set('_',Date.now());
  try {
    const response=await fetch(url,{headers:{Accept:'application/json'}});
    if(!response.ok)throw new Error(\`Pulse returned \${response.status}\`);
    const next=await response.json();
    if(!Array.isArray(next.items))throw new Error('Unexpected Pulse payload');
    pulse=next;renderPulse();
  } catch {
    if(!pulse)pulseEl.innerHTML='<div class="pulse-loading pulse-error"><div><p class="eyebrow">Seattle Pulse</p><strong>Pulse temporarily unavailable</strong></div><button id="pulse-retry" class="chip">Retry</button></div>';
    $('#pulse-retry')?.addEventListener('click',()=>loadPulse(true));
  }
}
`;
replace('prototype/vanilla/public/benchmark.js',
  '\nfunction openFocus(id) {',
  `\n${pulseJs}\nfunction openFocus(id) {`);

replace('prototype/vanilla/public/benchmark.js',
  "setInterval(()=>loadCameras(false),5*60*1000);",
  "setInterval(()=>loadCameras(false),5*60*1000);\npulseTimer=setInterval(()=>loadPulse(false),PULSE_REFRESH_MS);");

replace('prototype/vanilla/public/benchmark.js',
  "refilter();setView(view);renderDiagnostics();\nif (focusedId) queueMicrotask(()=>openFocus(focusedId));",
  "refilter();setView(view);renderDiagnostics();renderPulse();\nqueueMicrotask(()=>loadPulse(false));\nif (focusedId) queueMicrotask(()=>openFocus(focusedId));");

const pulseCss = `

/* Seattle Pulse */
.pulse{max-width:80rem;margin:.9rem auto 0;padding:0 1rem}
.pulse-loading,.pulse-head{display:flex;justify-content:space-between;align-items:center;gap:1rem;border:1px solid rgba(103,232,249,.18);background:linear-gradient(120deg,rgba(8,47,73,.5),rgba(15,23,42,.72));border-radius:1rem;padding:.8rem 1rem}
.pulse-loading strong,.pulse-title strong{font-family:"Arial Narrow","Avenir Next Condensed","Helvetica Neue Condensed",Arial,sans-serif;text-transform:capitalize}
.pulse-loading>span,.pulse-meta,.pulse-method,.pulse-card small{font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono",monospace;color:#94a3b8;font-size:.64rem}
.pulse-title{display:flex;align-items:baseline;gap:.6rem;margin-top:.14rem}.pulse-title strong{font-size:1rem}.pulse-title span{color:#67e8f9;font-weight:700;font-size:.72rem}
.pulse-meta{display:flex;align-items:center;gap:.65rem;flex-wrap:wrap;justify-content:flex-end}.pulse-meta .chip{padding:.38rem .58rem}
.pulse-rail{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(15.5rem,1fr);gap:.55rem;overflow-x:auto;padding:.55rem 0 .15rem;scrollbar-width:thin}
.pulse-card{position:relative;display:grid;grid-template-columns:4.5rem minmax(0,1fr) auto;align-items:center;gap:.6rem;text-align:left;border:1px solid rgba(148,163,184,.16);background:rgba(15,23,42,.72);color:#e2e8f0;border-radius:.85rem;padding:.45rem;cursor:pointer;min-width:0}
.pulse-card:hover,.pulse-card:focus-visible{border-color:rgba(103,232,249,.42);outline:none;background:rgba(8,47,73,.56)}
.pulse-thumb{display:block;aspect-ratio:16/9;overflow:hidden;border-radius:.55rem;background:#111827}.pulse-thumb img{width:100%;height:100%;object-fit:cover;display:block}
.pulse-copy{min-width:0}.pulse-copy strong{display:block;font-family:"Arial Narrow","Avenir Next Condensed","Helvetica Neue Condensed",Arial,sans-serif;font-size:.72rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.pulse-card small{display:block;margin-top:.18rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pulse-score{align-self:start;border:1px solid rgba(103,232,249,.28);background:rgba(8,145,178,.12);color:#cffafe;border-radius:.55rem;padding:.22rem .35rem;font-size:.65rem;font-weight:700;font-variant-numeric:tabular-nums}
.pulse-rank{position:absolute;left:.25rem;top:.25rem;z-index:2;background:rgba(2,6,23,.82);color:#67e8f9;border-radius:.35rem;padding:.12rem .24rem;font-size:.52rem;font-weight:700}
.pulse-method{margin:.35rem .15rem 0;color:#64748b}.pulse-empty{padding:1rem;color:#94a3b8;font-size:.72rem}.pulse-error{border-color:rgba(251,113,133,.25)}
@media(max-width:640px){.pulse{padding:0 .75rem;margin-top:.65rem}.pulse-head{align-items:flex-start}.pulse-meta>span{display:none}.pulse-rail{grid-auto-columns:84vw}.pulse-method{font-size:.58rem}}
`;
fs.appendFileSync('prototype/vanilla/public/benchmark.css', pulseCss);

replace('.github/workflows/deploy-cloudflare.yml',
  "history_status=\"$(curl --silent --show-error --max-time 10 -o /tmp/cams-history -w '%{http_code}' \"https://cams.hoxel.dev/api/history/status?smoke=${nonce}\" || true)\"\n            echo \"Production readiness ${attempt}/12: home=${home_status}, js=${js_status}, cameras=${api_status}, history=${history_status}\"",
  "history_status=\"$(curl --silent --show-error --max-time 10 -o /tmp/cams-history -w '%{http_code}' \"https://cams.hoxel.dev/api/history/status?smoke=${nonce}\" || true)\"\n            pulse_status=\"$(curl --silent --show-error --max-time 10 -o /tmp/cams-pulse -w '%{http_code}' \"https://cams.hoxel.dev/api/pulse?limit=3&smoke=${nonce}\" || true)\"\n            echo \"Production readiness ${attempt}/12: home=${home_status}, js=${js_status}, cameras=${api_status}, history=${history_status}, pulse=${pulse_status}\"");

replace('.github/workflows/deploy-cloudflare.yml',
  "if [ \"$home_status\" = \"200\" ] && [ \"$js_status\" = \"200\" ] && [ \"$api_status\" = \"200\" ] && [ \"$history_status\" = \"200\" ] \\",
  "if [ \"$home_status\" = \"200\" ] && [ \"$js_status\" = \"200\" ] && [ \"$api_status\" = \"200\" ] && [ \"$history_status\" = \"200\" ] && [ \"$pulse_status\" = \"200\" ] \\");

replace('.github/workflows/deploy-cloudflare.yml',
  "&& jq -e 'has(\"frames\") and has(\"cameras\") and has(\"latest\")' /tmp/cams-history >/dev/null; then",
  "&& jq -e 'has(\"frames\") and has(\"cameras\") and has(\"latest\")' /tmp/cams-history >/dev/null \\\n              && jq -e 'has(\"pulseScore\") and (.items | type == \"array\") and has(\"methodology\")' /tmp/cams-pulse >/dev/null; then");

console.log('Seattle Pulse implementation applied');
