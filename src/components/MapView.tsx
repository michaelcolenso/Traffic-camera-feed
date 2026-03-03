import { useCallback, useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import { ExternalLink, RefreshCw, Video as VideoIcon, X } from 'lucide-react';
import 'maplibre-gl/dist/maplibre-gl.css';
import { TrafficCamera } from '../types';

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
      tileSize: 256,
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
}

export function MapView({ cameras }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const [selected, setSelected] = useState<TrafficCamera | null>(null);
  const [imgTimestamp, setImgTimestamp] = useState(Date.now());

  const handleClose = useCallback(() => setSelected(null), []);

  useEffect(() => {
    if (!containerRef.current) return;

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

    map.on('load', () => {
      const validCameras = cameras.filter(
        (c) =>
          c.location?.latitude &&
          c.location?.longitude &&
          !isNaN(parseFloat(c.location.latitude)) &&
          !isNaN(parseFloat(c.location.longitude)),
      );

      validCameras.forEach((camera) => {
        const lat = parseFloat(camera.location.latitude);
        const lng = parseFloat(camera.location.longitude);

        const el = document.createElement('div');
        el.className = 'camera-marker';

        const marker = new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).addTo(map);

        el.addEventListener('click', (e) => {
          e.stopPropagation();
          setSelected(camera);
          setImgTimestamp(Date.now());
          map.flyTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 13), duration: 420 });
        });

        markersRef.current.push(marker);
      });
    });

    return () => {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      map.remove();
      mapRef.current = null;
    };
  }, [cameras]);

  return (
    <div className="relative w-full" style={{ height: 'calc(100vh - 84px)' }}>
      <div ref={containerRef} className="absolute inset-0" />

      <div className="absolute left-4 top-4 rounded-full border border-cyan-300/45 bg-slate-950/80 px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-cyan-100 backdrop-blur-md">
        {cameras.length} active nodes
      </div>

      {selected && (
        <aside className="glass-panel-strong absolute bottom-5 right-4 z-10 w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-2xl">
          <header className="flex items-center justify-between border-b border-slate-300/15 px-4 py-3">
            <span className="font-display truncate text-[11px] uppercase tracking-[0.12em] text-slate-100">
              {selected.cameralabel}
            </span>
            <button
              onClick={handleClose}
              className="rounded-full border border-slate-300/20 p-1 text-slate-400 transition hover:border-slate-200/35 hover:text-slate-100"
              aria-label="Close"
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
                className="flex items-center gap-1.5 rounded-lg border border-slate-300/20 bg-slate-900/70 px-2 py-1.5 text-xs text-slate-300 transition hover:border-slate-200/35"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                SDOT page
              </a>
            )}
            <button
              onClick={() => setImgTimestamp(Date.now())}
              className="ml-auto flex items-center gap-1.5 rounded-lg border border-slate-300/20 bg-slate-900/70 px-2 py-1.5 text-xs text-slate-300 transition hover:border-slate-200/35"
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
