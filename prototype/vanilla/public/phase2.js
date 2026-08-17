let phase2Pulse = null;
let refreshTimer = null;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
}

function relativeTime(value) {
  if (!value) return '';
  const minutes = Math.max(0, Math.round((Date.now() - value) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes === 1) return '1 min ago';
  return `${minutes} min ago`;
}

function confidenceLabel(value) {
  return value === 'high' ? 'high confidence' : value === 'moderate' ? 'moderate confidence' : '';
}

function injectStyles() {
  if (document.getElementById('phase2-styles')) return;
  const style = document.createElement('style');
  style.id = 'phase2-styles';
  style.textContent = `
    .pulse-card[data-observation-state="persistent"]{border-color:rgba(103,232,249,.5);box-shadow:inset 0 0 0 1px rgba(34,211,238,.08)}
    .pulse-card[data-observation-severity="high"] .pulse-copy small{color:#e2e8f0}
    .pulse-card .phase2-confidence{display:inline-block;margin-left:.35rem;color:#67e8f9;text-transform:uppercase;letter-spacing:.04em;font-size:.58rem}
    .phase2-events{display:flex;gap:.45rem;overflow-x:auto;padding:.15rem 0 .75rem;scrollbar-width:thin}
    .phase2-event{flex:0 0 auto;max-width:22rem;border:1px solid rgba(103,232,249,.22);background:rgba(8,47,73,.22);border-radius:.72rem;padding:.5rem .65rem;color:#cbd5e1;font-size:.68rem}
    .phase2-event strong{display:block;color:#cffafe;font-size:.72rem;margin-bottom:.12rem}
    .phase2-event span{color:#94a3b8}
    .phase2-evidence{color:#67e8f9;font-weight:700;white-space:nowrap}
    @media(max-width:640px){.phase2-event{max-width:17rem}}
  `;
  document.head.append(style);
}

function enhanceCollections() {
  document.querySelectorAll('[data-collection="unusual"]').forEach((button) => {
    const count = button.querySelector('span')?.textContent || '';
    const label = document.createTextNode(`Visual changes `);
    [...button.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE).forEach((node) => node.remove());
    button.insertBefore(label, button.firstChild);
    button.title = 'Cameras with meaningful visual change relative to a recent baseline.';
    if (count && button.querySelector('span')) button.querySelector('span').textContent = count;
  });
}

function enhancePulse() {
  if (!phase2Pulse) return;
  const pulse = document.getElementById('pulse');
  if (!pulse) return;
  const byId = new Map((phase2Pulse.items || []).map((item) => [item.cameraId, item]));
  pulse.querySelectorAll('[data-pulse-camera]').forEach((card) => {
    const observation = byId.get(card.dataset.pulseCamera);
    if (!observation) return;
    card.dataset.observationState = observation.state;
    card.dataset.observationSeverity = observation.severity;
    const copy = card.querySelector('.pulse-copy small');
    if (copy) {
      const persistence = observation.persistenceSamples >= 2 ? ` · ${observation.persistenceSamples} captures` : '';
      const confidence = confidenceLabel(observation.confidence);
      copy.innerHTML = `${escapeHtml(observation.display?.headline || observation.reason)} · ${escapeHtml(relativeTime(observation.capturedAt))}${escapeHtml(persistence)}${confidence ? ` <span class="phase2-confidence">${escapeHtml(confidence)}</span>` : ''} · <span class="phase2-evidence">Open evidence →</span>`;
      copy.title = observation.display?.detail || observation.reason || '';
    }
    const score = card.querySelector('.pulse-score');
    if (score) score.title = `${observation.display?.detail || observation.reason}. Score is secondary to the observation evidence.`;
  });

  let events = pulse.querySelector('.phase2-events');
  const pulseEvents = Array.isArray(phase2Pulse.events) ? phase2Pulse.events : [];
  if (!pulseEvents.length) {
    events?.remove();
    return;
  }
  if (!events) {
    events = document.createElement('div');
    events.className = 'phase2-events';
    const rail = pulse.querySelector('.pulse-rail');
    rail?.parentNode?.insertBefore(events, rail);
  }
  events.innerHTML = pulseEvents.slice(0, 4).map((event) => `<div class="phase2-event"><strong>${escapeHtml(event.title)}</strong><span>${escapeHtml(event.detail)} · ${escapeHtml(event.confidence)} confidence</span></div>`).join('');
}

async function loadPhase2Pulse(force = false) {
  if (document.hidden) return;
  try {
    const url = new URL('/api/pulse', location.origin);
    url.searchParams.set('limit', '12');
    if (force) url.searchParams.set('_', String(Date.now()));
    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) return;
    const data = await response.json();
    if (!Array.isArray(data.items)) return;
    phase2Pulse = data;
    enhancePulse();
    enhanceCollections();
  } catch {}
}

injectStyles();
const observer = new MutationObserver(() => {
  enhancePulse();
  enhanceCollections();
});
observer.observe(document.body, { childList: true, subtree: true });
queueMicrotask(() => loadPhase2Pulse(false));
refreshTimer = setInterval(() => loadPhase2Pulse(false), 60000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) loadPhase2Pulse(true);
});
window.addEventListener('pagehide', () => {
  observer.disconnect();
  if (refreshTimer) clearInterval(refreshTimer);
}, { once: true });
