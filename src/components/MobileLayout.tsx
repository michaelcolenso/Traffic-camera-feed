import { useEffect, useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { TrafficCamera } from '../types';
import { cn } from '../lib/utils';

function inferZone(label: string): string {
  const u = label.toUpperCase();
  if (u.includes('I-5') || u.includes('I5')) return 'I-5 Corridor';
  if (u.includes('SR-99') || u.includes('SR 99') || (u.includes('99') && !u.includes('SR 520'))) return 'SR-99';
  if (u.includes('SR-520') || u.includes('SR 520') || u.includes('520')) return 'SR-520';
  if (u.includes(' NE') || u.startsWith('NE ') || u.includes('NORTH')) return 'North Seattle';
  if (u.includes(' SE') || u.startsWith('SE ') || u.includes('SOUTH')) return 'South Seattle';
  if (u.includes(' NW') || u.startsWith('NW ')) return 'Northwest';
  if (u.includes(' SW') || u.startsWith('SW ')) return 'Southwest';
  if (u.includes('EAST') || u.includes('BELLEVUE') || u.includes('REDMOND') || u.includes('KIRKLAND')) return 'Eastside';
  if (u.includes('AURORA') || u.includes('DEXTER') || u.includes('MERCER') || u.includes('WESTLAKE')) return 'Aurora / Westlake';
  return 'Downtown / Other';
}

const ZONE_ORDER = [
  'I-5 Corridor',
  'SR-99',
  'SR-520',
  'Aurora / Westlake',
  'North Seattle',
  'South Seattle',
  'Northwest',
  'Southwest',
  'Eastside',
  'Downtown / Other',
];

interface CameraThumbProps {
  camera: TrafficCamera;
  onClick: () => void;
}

function CameraThumb({ camera, onClick }: CameraThumbProps) {
  const [imgSrc, setImgSrc] = useState(camera.imageurl.url);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const iv = setInterval(() => {
      setImgSrc(`${camera.imageurl.url}?t=${Date.now()}`);
    }, 30_000);
    return () => clearInterval(iv);
  }, [camera.imageurl.url]);

  return (
    <button
      onClick={onClick}
      className="group relative w-44 shrink-0 snap-start overflow-hidden rounded-2xl border border-slate-400/15 bg-slate-900/70 transition-all duration-200 hover:border-cyan-300/40 hover:shadow-[0_0_18px_rgba(41,216,255,0.2)] focus-visible:outline-2 focus-visible:outline-cyan-400"
      style={{ aspectRatio: '16/10' }}
    >
      {!loaded && (
        <div className="skeleton-panel absolute inset-0" />
      )}
      <img
        src={imgSrc}
        alt={camera.cameralabel}
        className={cn(
          'h-full w-full object-cover transition-opacity duration-300',
          loaded ? 'opacity-100' : 'opacity-0',
        )}
        onLoad={() => setLoaded(true)}
        onError={() => setLoaded(true)}
        loading="lazy"
      />
      {/* Label overlay */}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950/90 to-transparent px-2 py-2">
        <p className="truncate text-[10px] uppercase tracking-[0.1em] text-slate-300 group-hover:text-cyan-200">
          {camera.cameralabel}
        </p>
      </div>
      {/* Live video indicator */}
      {camera.video_url?.url && (
        <div className="absolute right-1.5 top-1.5 flex items-center gap-1 rounded-full border border-cyan-300/40 bg-slate-950/80 px-1.5 py-0.5">
          <span className="status-pulse h-1.5 w-1.5 rounded-full bg-cyan-400" />
          <span className="text-[9px] uppercase tracking-widest text-cyan-300">Live</span>
        </div>
      )}
    </button>
  );
}

interface ZoneRowProps {
  zone: string;
  cameras: TrafficCamera[];
  onCameraSelect: (camera: TrafficCamera, peers: TrafficCamera[]) => void;
}

function ZoneRow({ zone, cameras, onCameraSelect }: ZoneRowProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  return (
    <section className="mb-6">
      <div className="mb-3 flex items-center justify-between px-4">
        <div className="flex items-center gap-2">
          <span className="h-px w-4 bg-cyan-400/50" />
          <h2 className="font-display text-[10px] uppercase tracking-[0.22em] text-cyan-300/80">
            {zone}
          </h2>
        </div>
        <span className="text-[10px] uppercase tracking-[0.14em] text-slate-500">
          {cameras.length} {cameras.length === 1 ? 'cam' : 'cams'}
        </span>
      </div>

      <div
        ref={scrollRef}
        className="scroll-hide flex gap-3 overflow-x-auto px-4 pb-2 snap-x snap-mandatory"
      >
        {cameras.map((cam) => (
          <CameraThumb
            key={cam.imageurl.url}
            camera={cam}
            onClick={() => onCameraSelect(cam, cameras)}
          />
        ))}
        {/* Peek indicator */}
        {cameras.length > 2 && (
          <div className="flex shrink-0 items-center pr-1 text-slate-600">
            <ChevronRight className="h-4 w-4" />
          </div>
        )}
      </div>
    </section>
  );
}

interface MobileLayoutProps {
  cameras: TrafficCamera[];
  onCameraSelect: (camera: TrafficCamera, zonePeers: TrafficCamera[]) => void;
}

export function MobileLayout({ cameras, onCameraSelect }: MobileLayoutProps) {
  // Group cameras by zone
  const zoneMap = new Map<string, TrafficCamera[]>();
  for (const cam of cameras) {
    const zone = inferZone(cam.cameralabel);
    if (!zoneMap.has(zone)) zoneMap.set(zone, []);
    zoneMap.get(zone)!.push(cam);
  }

  // Sort zones by predefined order, then alphabetically for unlisted ones
  const zones = [...zoneMap.keys()].sort((a, b) => {
    const ia = ZONE_ORDER.indexOf(a);
    const ib = ZONE_ORDER.indexOf(b);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a.localeCompare(b);
  });

  if (cameras.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
        <p className="font-display text-sm uppercase tracking-[0.16em] text-slate-400">
          No cameras found
        </p>
      </div>
    );
  }

  return (
    <div className="pt-2 pb-4">
      {zones.map((zone) => (
        <ZoneRow
          key={zone}
          zone={zone}
          cameras={zoneMap.get(zone)!}
          onCameraSelect={onCameraSelect}
        />
      ))}
    </div>
  );
}
