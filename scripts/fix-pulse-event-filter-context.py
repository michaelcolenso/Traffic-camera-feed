from pathlib import Path

p = Path('prototype/vanilla/public/benchmark.js')
s = p.read_text()
old = """  const mappable = filtered.filter((camera)=>Number.isFinite(camera.lat)&&Number.isFinite(camera.lng));
  const activeEvent=pulseEventById(activePulseEventId);
  const eventIds=new Set(activeEvent?.cameraIds||[]);
  $('#map-count').textContent = activeEvent ? `${eventIds.size} cameras in active area · ${mappable.length} mapped` : `${mappable.length} active cameras`;"""
new = """  const filteredMappable = filtered.filter((camera)=>Number.isFinite(camera.lat)&&Number.isFinite(camera.lng));
  const activeEvent=pulseEventById(activePulseEventId);
  const eventMembers=pulseEventCameras(activeEvent);
  const eventIds=new Set(activeEvent?.cameraIds||[]);
  const mappable=activeEvent ? [...new Map([...filteredMappable,...eventMembers].map((camera)=>[camera.id,camera])).values()] : filteredMappable;
  $('#map-count').textContent = activeEvent ? `${eventMembers.length} cameras in active area · ${filteredMappable.length} filtered` : `${mappable.length} active cameras`;"""
if s.count(old) != 1:
    raise SystemExit(f'filter-context patch: expected one match, found {s.count(old)}')
p.write_text(s.replace(old, new, 1))
