import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import { ExternalLink, LocateFixed, RefreshCw, Video as VideoIcon, X } from 'lucide-react';
import 'maplibre-gl/dist/maplibre-gl.css';
import { TrafficCamera } from '../types';
import { CameraHealth, getCameraId } from '../lib/cameras';

const DARK_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    'carto-dark': {
      type: 'raster',
      tiles: [
        'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
        'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
        'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
      ],
      tileSize: 512,
      attribution:
        '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, © <a href="https://carto.com/">CARTO</a>',
    },
  },
  layers: [
    {
      id: 'carto-dark-layer',
      type: 'raster',
      source: 'carto-dark',
      minzoom: 0,
      maxzoom: 22,
    },
  ],
};

const SEATTLE_CENTER: [number, number] = [-122.3321, 47.6062];

interface MapViewProps {
  cameras: TrafficCamera[];
  healthByCamera?: Record<string, CameraHealth>;
  onFocus?: (camera: TrafficCamera) => void;
}

function getCoordinates(camera: TrafficCamera): { lat: number; lng: number } | null {
  const lat = Number(camera.location?.latitude);
  const lng = Number(camera.location?.longitude);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  return { lat, lng };
}

export function MapView({ cameras, healthByCamera = {}, onFocus }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const [selected, setSelected] = useState<TrafficCamera | null>(null);
  const [imgTimestamp, setImgTimestamp] = useState(Date.now());

  const mappableCameras = useMemo(
    () =>
      cameras.filter((camera) => {
        const hasImage = Boolean(camera.imageurl?.url);
        return hasImage && getCoordinates(camera) !== null;
      }),
    [cameras],
  );

  const handleClose = useCallback(() => setSelected(null), []);
  const fitVisibleCameras = useCallback(() => {
    const map = mapRef.current;
    if (!map || mappableCameras.length === 0) return;

    const bounds = new maplibregl.LngLatBounds();
    mappableCameras.forEach((camera) => {
      const coords = getCoordinates(camera);
      if (coords) bounds.extend([coords.lng, coords.lat]);
    });

    map.fitBounds(bounds, { padding: 72, maxZoom: 14, duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 420 });
  }, [mappableCameras]);

  const returnToSeattle = useCallback(() => {
    mapRef.current?.flyTo({
      center: SEATTLE_CENTER,
      zoom: 11,
      duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 420,
    });
  }, []);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: DARK_STYLE,
      center: SEATTLE_CENTER,
      zoom: 11,
      attributionControl: false,
    });

    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

    mapRef.current = map;

    return () => {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = [];

    mappableCameras.forEach((camera) => {
      const coords = getCoordinates(camera);
      if (!coords) return;

      const el = document.createElement('button');
      const health = healthByCamera[getCameraId(camera)];
      el.className = `camera-marker${camera.video_url?.url ? ' camera-marker--live' : ''}${health?.lastImageError ? ' camera-marker--issue' : ''}${selected && getCameraId(selected) === getCameraId(camera) ? ' camera-marker--selected' : ''}`;
      el.type = 'button';
      el.setAttribute('aria-label', `View ${camera.cameralabel}`);
      el.setAttribute('title', camera.cameralabel);

      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([coords.lng, coords.lat])
        .addTo(map);

      el.addEventListener('click', (e) => {
        e.stopPropagation();
        setSelected(camera);
        setImgTimestamp(Date.now());
        map.flyTo({
          center: [coords.lng, coords.lat],
          zoom: Math.max(map.getZoom(), 13),
          duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 420,
        });
      });

      markersRef.current.push(marker);
    });
  }, [mappableCameras, healthByCamera, selected]);

  return (
    <div className="relative w-full" style={{ height: 'calc(100vh - 84px)' }}>
      <div ref={containerRef} className="absolute inset-0" />

      <div className="absolute left-4 top-4 rounded-full border border-cyan-300/45 bg-slate-950/80 px-3 py-1 text-[11px] uppercase tracking-[0.14em] text-cyan-100 backdrop-blur-md">
        {mappableCameras.length} active cameras
      </div>

      <div className="absolute left-4 top-14 max-w-xs rounded-2xl border border-slate-300/20 bg-slate-950/82 p-3 text-xs text-slate-200 backdrop-blur-md">
        <p className="mb-2 font-display text-[11px] uppercase tracking-[0.14em] text-cyan-100">Map legend</p>
        <div className="space-y-1.5">
          <span className="flex items-center gap-2"><span className="camera-marker pointer-events-none scale-75" /> Snapshot camera</span>
          <span className="flex items-center gap-2"><span className="camera-marker camera-marker--live pointer-events-none scale-75" /> Live stream available</span>
          <span className="flex items-center gap-2"><span className="camera-marker camera-marker--issue pointer-events-none scale-75" /> Recent signal issue</span>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button onClick={fitVisibleCameras} className="rounded-lg border border-cyan-300/35 bg-cyan-500/10 px-2 py-1.5 text-cyan-100 transition hover:bg-cyan-500/20">
            Fit cameras
          </button>
          <button onClick={returnToSeattle} className="rounded-lg border border-slate-300/25 px-2 py-1.5 text-slate-200 transition hover:border-slate-200/40">
            <LocateFixed className="mr-1 inline h-3.5 w-3.5" />Seattle
          </button>
        </div>
      </div>

      {selected && selected.imageurl?.url && (
        <aside className="glass-panel-strong absolute bottom-5 right-4 z-10 w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-2xl">
          <header className="flex items-center justify-between border-b border-slate-300/15 px-4 py-3">
            <span className="font-display truncate text-[11px] uppercase tracking-[0.12em] text-slate-100">
              {selected.cameralabel}
            </span>
            <button
              onClick={handleClose}
              className="rounded-full border border-slate-300/20 p-1 text-slate-300 transition hover:border-slate-200/35 hover:text-slate-100"
              aria-label="Close selected camera preview"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </header>

          <div className="aspect-video w-full bg-slate-950">
            <img
              src={`${selected.imageurl.url}?t=${imgTimestamp}`}
              alt={selected.cameralabel}
              className="h-full w-full object-cover"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
          </div>

          <footer className="flex flex-wrap items-center gap-3 border-t border-slate-300/10 px-4 py-3">
            {selected.video_url?.url && (
              <a
                href={selected.video_url.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 rounded-lg border border-cyan-300/40 bg-cyan-500/10 px-2 py-1.5 text-xs text-cyan-200 transition hover:bg-cyan-500/20"
                aria-label={`Open live stream for ${selected.cameralabel}`}
              >
                <VideoIcon className="h-3.5 w-3.5" />
                Live stream
              </a>
            )}
            {selected.web_url?.url && (
              <a
                href={selected.web_url.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 rounded-lg border border-slate-300/20 bg-slate-900/70 px-2 py-1.5 text-xs text-slate-200 transition hover:border-slate-200/35"
                aria-label={`Open SDOT page for ${selected.cameralabel}`}
              >
                <ExternalLink className="h-3.5 w-3.5" />
                SDOT page
              </a>
            )}
            <button
              onClick={() => onFocus?.(selected)}
              className="flex items-center gap-1.5 rounded-lg border border-cyan-300/40 bg-cyan-500/10 px-2 py-1.5 text-xs text-cyan-200 transition hover:bg-cyan-500/20"
              aria-label={`Open focus mode for ${selected.cameralabel}`}
            >
              Focus
            </button>
            <button
              onClick={() => setImgTimestamp(Date.now())}
              className="ml-auto flex items-center gap-1.5 rounded-lg border border-slate-300/20 bg-slate-900/70 px-2 py-1.5 text-xs text-slate-200 transition hover:border-slate-200/35"
              aria-label={`Refresh snapshot for ${selected.cameralabel}`}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </button>
          </footer>
        </aside>
      )}
    </div>
  );
}
