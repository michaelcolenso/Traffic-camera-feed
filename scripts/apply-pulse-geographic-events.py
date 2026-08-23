from pathlib import Path


def replace_once(path: str, old: str, new: str, label: str) -> None:
    p = Path(path)
    s = p.read_text()
    count = s.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    p.write_text(s.replace(old, new, 1))


js = "prototype/vanilla/public/benchmark.js"
replace_once(
    js,
    "let pulse = null;\nlet pulseByCamera = new Map();\nconst PULSE_REFRESH_MS = 60000;",
    "let pulse = null;\nlet pulseByCamera = new Map();\nlet activePulseEventId = null;\nconst PULSE_REFRESH_MS = 60000;",
    "Pulse event state",
)

old_map = """function renderMapMarkers() {
  if (!map) return;
  mapMarkers.forEach((marker)=>marker.remove()); mapMarkers=[];
  const mappable = filtered.filter((camera)=>Number.isFinite(camera.lat)&&Number.isFinite(camera.lng));
  $('#map-count').textContent = `${mappable.length} active cameras`;
  for (const camera of mappable) {
    const el=document.createElement('button');
    el.className=`camera-marker ${camera.videoUrl?'live':''} ${getHealth(camera).lastImageError?'issue':''} ${isUnusual(camera)?'changed':''}`;
    el.title=camera.label;
    el.setAttribute('aria-label',`View ${camera.label}`);
    el.addEventListener('click',(event)=>{event.stopPropagation();openFocus(camera.id);map.flyTo({center:[camera.lng,camera.lat],zoom:Math.max(map.getZoom(),13)});});
    mapMarkers.push(new maplibregl.Marker({element:el}).setLngLat([camera.lng,camera.lat]).addTo(map));
  }
}"""
new_map = """function renderMapMarkers() {
  if (!map) return;
  mapMarkers.forEach((marker)=>marker.remove()); mapMarkers=[];
  const mappable = filtered.filter((camera)=>Number.isFinite(camera.lat)&&Number.isFinite(camera.lng));
  const activeEvent=pulseEventById(activePulseEventId);
  const eventIds=new Set(activeEvent?.cameraIds||[]);
  $('#map-count').textContent = activeEvent ? `${eventIds.size} cameras in active area · ${mappable.length} mapped` : `${mappable.length} active cameras`;
  for (const camera of mappable) {
    const el=document.createElement('button');
    const inEvent=eventIds.has(camera.id);
    el.className=`camera-marker ${camera.videoUrl?'live':''} ${getHealth(camera).lastImageError?'issue':''} ${isUnusual(camera)?'changed':''} ${inEvent?'event-active':activeEvent?'event-muted':''}`;
    el.title=camera.label;
    el.setAttribute('aria-label',`${inEvent?'Active area camera: ':'View '}${camera.label}`);
    el.addEventListener('click',(event)=>{event.stopPropagation();openFocus(camera.id);map.flyTo({center:[camera.lng,camera.lat],zoom:Math.max(map.getZoom(),13)});});
    mapMarkers.push(new maplibregl.Marker({element:el}).setLngLat([camera.lng,camera.lat]).addTo(map));
  }
  renderPulseEventHud();
}"""
replace_once(js, old_map, new_map, "map event highlighting")

pulse_anchor = """function pulseCamera(item) { return cameraById(item.cameraId); }
function pulseTime(value) {"""
pulse_helpers = """function pulseCamera(item) { return cameraById(item.cameraId); }
function pulseEventById(id) {
  if (!id) return null;
  return (pulse?.events||[]).find((event)=>event.id===id)||null;
}
function pulseEventCameras(event) {
  return (event?.cameraIds||[]).map(cameraById).filter((camera)=>camera&&Number.isFinite(camera.lat)&&Number.isFinite(camera.lng));
}
function renderPulseEventHud() {
  if (!mapEl) return;
  let hud=$('#pulse-event-hud');
  if (!hud) {
    mapEl.insertAdjacentHTML('beforeend','<aside id="pulse-event-hud" class="pulse-event-hud" hidden></aside>');
    hud=$('#pulse-event-hud');
  }
  const event=pulseEventById(activePulseEventId);
  if (!event) { hud.hidden=true;hud.innerHTML='';return; }
  const memberButtons=(event.cameraIds||[]).map((id)=>cameraById(id)).filter(Boolean).map((camera)=>`<button type="button" class="pulse-event-camera" data-event-camera="${escapeHtml(camera.id)}">${escapeHtml(camera.label)}</button>`).join('');
  hud.hidden=false;
  hud.innerHTML=`<div class="pulse-event-hud-head"><div><p class="eyebrow">Active area</p><strong>${escapeHtml(event.title)}</strong><span>${event.cameraCount} cameras · ${escapeHtml(event.confidence)} confidence · ${pulseTime(event.lastObservedAt)}</span></div><button type="button" class="pulse-event-clear" data-clear-pulse-event aria-label="Clear active area">×</button></div><p>${escapeHtml(event.detail)}</p><div class="pulse-event-members">${memberButtons}</div><small>Correlated visual observations only. Open a camera for its evidence and time machine.</small>`;
  hud.querySelectorAll('[data-event-camera]').forEach((button)=>button.addEventListener('click',()=>openFocus(button.dataset.eventCamera)));
  hud.querySelector('[data-clear-pulse-event]')?.addEventListener('click',clearPulseEvent);
}
function focusPulseEvent(event=pulseEventById(activePulseEventId)) {
  if (!map||!event) return;
  const members=pulseEventCameras(event);
  if (members.length===1) {
    map.flyTo({center:[members[0].lng,members[0].lat],zoom:14});
    return;
  }
  if (members.length>1) {
    const bounds=new maplibregl.LngLatBounds();
    members.forEach((camera)=>bounds.extend([camera.lng,camera.lat]));
    map.fitBounds(bounds,{padding:matchMedia('(max-width:640px)').matches?54:96,maxZoom:14});
    return;
  }
  if (event.center) map.flyTo({center:[event.center.lng,event.center.lat],zoom:13});
}
async function openPulseEvent(id) {
  const event=pulseEventById(id);if(!event)return;
  activePulseEventId=id;
  renderPulse();
  setView('map');
  await ensureMap();
  renderMapMarkers();
  focusPulseEvent(event);
}
function clearPulseEvent() {
  activePulseEventId=null;
  renderPulse();
  if (view==='map') { renderMapMarkers();fitMap(); }
}
function pulseTime(value) {"""
replace_once(js, pulse_anchor, pulse_helpers, "Pulse map helpers")

old_events = """  const events=(pulse.events||[]).slice(0,4).map((event)=>`<div class="phase2-event" data-severity="${escapeHtml(event.severity)}"><strong>${escapeHtml(event.title)}</strong><span>${escapeHtml(event.detail)} · ${escapeHtml(event.confidence)} confidence</span></div>`).join('');"""
new_events = """  const events=(pulse.events||[]).slice(0,6).map((event)=>{
    const active=event.id===activePulseEventId;
    return `<button type="button" class="phase2-event ${active?'active':''}" data-pulse-event="${escapeHtml(event.id)}" data-severity="${escapeHtml(event.severity)}" aria-pressed="${active}"><span class="phase2-event-copy"><strong>${escapeHtml(event.title)}</strong><span>${event.cameraCount} cameras · ${pulseTime(event.lastObservedAt)} · ${escapeHtml(event.confidence)} confidence</span></span><span class="phase2-event-action">Map area →</span></button>`;
  }).join('');"""
replace_once(js, old_events, new_events, "interactive event cards")

old_pulse_html = """  pulseEl.innerHTML=`<div class="pulse-head"><div><p class="eyebrow">Seattle Pulse</p><div class="pulse-title"><strong>${escapeHtml(pulse.state)}</strong><span>${pulse.pulseScore}/100</span></div></div><div class="pulse-meta"><span>${pulse.activeCameras} active cameras</span><span>${pulse.camerasAnalyzed} analyzed</span><button id="pulse-refresh" class="chip">Refresh</button></div></div>${events?`<div class="phase2-events" aria-label="Correlated areas">${events}</div>`:''}<div class="pulse-rail">${cards||'<div class="pulse-empty">History is still warming up.</div>'}</div><p class="pulse-method">Observed visual change only — Pulse does not infer crashes, congestion, weather, incidents, or causes.</p>`;
  pulseEl.querySelectorAll('[data-pulse-camera]').forEach((button)=>button.addEventListener('click',()=>openFocus(button.dataset.pulseCamera)));
  $('#pulse-refresh')?.addEventListener('click',()=>loadPulse(true));"""
new_pulse_html = """  pulseEl.innerHTML=`<div class="pulse-head"><div><p class="eyebrow">Seattle Pulse</p><div class="pulse-title"><strong>${escapeHtml(pulse.state)}</strong><span>${pulse.pulseScore}/100</span></div></div><div class="pulse-meta">${pulse.eventCount?`<span>${pulse.eventCount} active ${pulse.eventCount===1?'area':'areas'}</span>`:''}<span>${pulse.activeCameras} active cameras</span><span>${pulse.camerasAnalyzed} analyzed</span><button id="pulse-refresh" class="chip">Refresh</button></div></div>${events?`<div class="phase2-events" aria-label="Correlated active areas">${events}</div>`:''}<div class="pulse-rail">${cards||'<div class="pulse-empty">History is still warming up.</div>'}</div><p class="pulse-method">Observed visual change only — Pulse does not infer crashes, congestion, weather, incidents, or causes.</p>`;
  pulseEl.querySelectorAll('[data-pulse-camera]').forEach((button)=>button.addEventListener('click',()=>openFocus(button.dataset.pulseCamera)));
  pulseEl.querySelectorAll('[data-pulse-event]').forEach((button)=>button.addEventListener('click',()=>openPulseEvent(button.dataset.pulseEvent)));
  $('#pulse-refresh')?.addEventListener('click',()=>loadPulse(true));"""
replace_once(js, old_pulse_html, new_pulse_html, "Pulse event wiring")

replace_once(
    js,
    "    pulse=next;\n    const observationIndex=Array.isArray(next.observationIndex)?next.observationIndex:next.items;",
    "    pulse=next;\n    if (activePulseEventId && !pulseEventById(activePulseEventId)) activePulseEventId=null;\n    const observationIndex=Array.isArray(next.observationIndex)?next.observationIndex:next.items;",
    "stale Pulse event cleanup",
)

css = Path("prototype/vanilla/public/evidence.css")
css.write_text(
    css.read_text()
    + r'''

/* Geographic Seattle Pulse active areas. */
.phase2-event{appearance:none;text-align:left;display:flex;align-items:center;justify-content:space-between;gap:.8rem;cursor:pointer;font:inherit;transition:border-color .16s ease,background .16s ease,transform .16s ease}
.phase2-event:hover,.phase2-event:focus-visible{border-color:rgba(103,232,249,.58);background:rgba(8,47,73,.38);outline:none;transform:translateY(-1px)}
.phase2-event.active{border-color:rgba(103,232,249,.78);background:rgba(8,145,178,.2);box-shadow:inset 0 0 0 1px rgba(103,232,249,.18)}
.phase2-event-copy{min-width:0}.phase2-event-copy strong,.phase2-event-copy span{display:block}.phase2-event-action{flex:0 0 auto;color:#67e8f9;font-size:.64rem;font-weight:700;white-space:nowrap}
.camera-marker.event-active{width:1.35rem;height:1.35rem;border-width:3px;border-color:#cffafe;box-shadow:0 0 0 5px rgba(34,211,238,.22),0 0 22px rgba(34,211,238,.82)}
.camera-marker.event-muted{opacity:.22;box-shadow:none;transform:scale(.78)}
.pulse-event-hud{position:absolute;z-index:5;left:1rem;bottom:1rem;width:min(28rem,calc(100% - 2rem));max-height:min(44vh,25rem);overflow:auto;padding:.8rem;border:1px solid rgba(103,232,249,.34);border-radius:.9rem;background:rgba(2,6,23,.92);backdrop-filter:blur(16px);box-shadow:0 18px 45px rgba(0,0,0,.45)}
.pulse-event-hud[hidden]{display:none}.pulse-event-hud-head{display:flex;align-items:flex-start;justify-content:space-between;gap:.7rem}.pulse-event-hud-head strong{display:block;color:#ecfeff;font-size:.86rem;margin:.18rem 0}.pulse-event-hud-head span,.pulse-event-hud>p,.pulse-event-hud>small{display:block;color:#94a3b8;font-size:.66rem;line-height:1.45}.pulse-event-hud>p{margin:.65rem 0}.pulse-event-clear{flex:0 0 auto;width:2rem;height:2rem;border:1px solid rgba(148,163,184,.24);border-radius:999px;background:rgba(15,23,42,.8);color:#cbd5e1;cursor:pointer}.pulse-event-members{display:flex;flex-wrap:wrap;gap:.35rem;margin:.6rem 0}.pulse-event-camera{border:1px solid rgba(103,232,249,.2);border-radius:.55rem;background:rgba(8,47,73,.28);color:#cffafe;padding:.4rem .5rem;font-size:.64rem;cursor:pointer}.pulse-event-camera:hover,.pulse-event-camera:focus-visible{border-color:rgba(103,232,249,.6);outline:none}
@media(max-width:640px){.phase2-event{max-width:19rem}.pulse-event-hud{left:.5rem;bottom:.5rem;width:calc(100% - 1rem);max-height:42vh}.pulse-event-members{flex-wrap:nowrap;overflow-x:auto}.pulse-event-camera{flex:0 0 auto;max-width:15rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}}
'''
)

pulse_ts = "prototype/vanilla/pulse.ts"
old_corridor = """function corridorWeight(label: string): { weight: number; corridor: string | null } {
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
}"""
new_corridor = """function corridorWeight(label: string): { weight: number; corridor: string | null } {
  const value = label.toLowerCase();
  const groups: Array<[string, RegExp[], number]> = [
    ['I-5', [/\\bi-?5\\b/, /\\binterstate 5\\b/], 4],
    ['Aurora / SR-99', [/\\baurora(?: ave(?:nue)?)?\\b/, /\\bsr[ -]?99\\b/], 4],
    ['West Seattle', [/\\bwest seattle\\b/, /\\bspokane (?:st|street)\\b/], 4],
    ['Major bridge', [/\\bbridge\\b/, /\\bfremont\\b/, /\\bballard\\b/, /\\bmontlake\\b/, /\\buniversity bridge\\b/], 3],
    ['Downtown core', [/\\b1st ave(?:nue)?\\b/, /\\b2nd ave(?:nue)?\\b/, /\\b3rd ave(?:nue)?\\b/, /\\b4th ave(?:nue)?\\b/, /\\b5th ave(?:nue)?\\b/, /\\b6th ave(?:nue)?\\b/, /\\bpike(?: st(?:reet)?)?\\b/, /\\bpine(?: st(?:reet)?)?\\b/, /\\bmadison(?: st(?:reet)?)?\\b/, /\\byesler(?: way)?\\b/, /\\bjackson(?: st(?:reet)?)?\\b/], 2],
  ];
  for (const [corridor, patterns, weight] of groups) {
    if (patterns.some((pattern) => pattern.test(value))) return { weight, corridor };
  }
  return { weight: 0, corridor: null };
}"""
replace_once(pulse_ts, old_corridor, new_corridor, "boundary-safe Pulse corridor classification")

test = "tests/vanilla-parity.mjs"
old_test = """  await page.locator('[data-mobile-view="map"]').click();
  check(new URL(page.url()).searchParams.get('view') === 'map', 'map URL state missing');
  check(await page.locator('#map').isVisible(), 'map shell missing');
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'test-artifacts/mobile-map.png', fullPage: true });
  await page.locator('[data-mobile-view="grid"]').click();"""
new_test = """  const eventCameras = bootstrap.filter((camera) => Number.isFinite(camera.lat) && Number.isFinite(camera.lng)).slice(0, 2);
  if (eventCameras.length === 2) {
    const now = Date.now();
    await page.route('**/api/pulse**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          generatedAt: now,
          windowMinutes: 60,
          pulseScore: 64,
          state: 'active',
          activeCameras: 2,
          camerasAnalyzed: bootstrap.length,
          observationCount: 2,
          eventCount: 1,
          methodology: 'test fixture',
          observationIndex: eventCameras.map((camera, index) => ({ cameraId: camera.id, capturedAt: now - index * 60000, score: 70 - index, reason: 'Test visual change', state: 'changing', severity: 'moderate', confidence: 'high', display: { headline: 'Test visual change', detail: 'Parity fixture' } })),
          events: [{ id: 'parity-active-area', title: 'Parity active area', cameraIds: eventCameras.map((camera) => camera.id), cameraCount: 2, firstObservedAt: now - 120000, lastObservedAt: now, severity: 'moderate', confidence: 'high', center: { lat: (eventCameras[0].lat + eventCameras[1].lat) / 2, lng: (eventCameras[0].lng + eventCameras[1].lng) / 2 }, detail: '2 nearby cameras changed within 10 minutes' }],
          items: [],
        }),
      });
    });
    if (await page.locator('#pulse-refresh').count()) await page.locator('#pulse-refresh').click();
    else await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(120);
    const activeArea = page.locator('[data-pulse-event="parity-active-area"]');
    check(await activeArea.count() === 1, 'Pulse active-area control missing');
    await activeArea.click();
    await page.waitForTimeout(900);
    check(new URL(page.url()).searchParams.get('view') === 'map', 'Pulse active area did not switch to map view');
    check(await page.locator('#pulse-event-hud').isVisible(), 'Pulse active-area map HUD missing');
    check(await page.locator('.camera-marker.event-active').count() === 2, 'Pulse event member cameras were not highlighted');
    check(await page.locator('#pulse-event-hud [data-event-camera]').count() === 2, 'Pulse active-area member controls missing');
    await page.locator('#pulse-event-hud [data-event-camera]').first().click();
    check(await page.locator('#modal[open]').count() === 1, 'Pulse active-area camera did not open evidence focus');
    await page.locator('#close').click();
    await page.locator('[data-clear-pulse-event]').click();
    check(!(await page.locator('#pulse-event-hud').isVisible()), 'Pulse active area did not clear');
    await page.unroute('**/api/pulse**');
    await page.locator('[data-mobile-view="grid"]').click();
  } else {
    failures.push('not enough geocoded cameras for Pulse event map test');
  }

  await page.locator('[data-mobile-view="map"]').click();
  check(new URL(page.url()).searchParams.get('view') === 'map', 'map URL state missing');
  check(await page.locator('#map').isVisible(), 'map shell missing');
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'test-artifacts/mobile-map.png', fullPage: true });
  await page.locator('[data-mobile-view="grid"]').click();"""
replace_once(test, old_test, new_test, "Pulse geographic parity coverage")
