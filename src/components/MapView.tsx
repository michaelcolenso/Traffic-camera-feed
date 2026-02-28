import { useEffect, useRef, useState, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { TrafficCamera } from '../types';
import { X, Video as VideoIcon, ExternalLink } from 'lucide-react';

// CartoDB Dark Matter tiles — free, no API key required
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

// Seattle city center default
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

        // Marker element
        const el = document.createElement('div');
        el.className =
          'w-3 h-3 rounded-full bg-emerald-500 border-2 border-emerald-200 shadow-md cursor-pointer ' +
          'hover:scale-150 transition-transform duration-150 hover:bg-emerald-400';

        const marker = new maplibregl.Marker({ element: el })
          .setLngLat([lng, lat])
          .addTo(map);

        el.addEventListener('click', (e) => {
          e.stopPropagation();
          setSelected(camera);
          setImgTimestamp(Date.now());
          map.flyTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 13), duration: 400 });
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
    // cameras reference is stable from SWR — no need to re-run on every re-render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameras]);

  return (
    <div className="relative w-full" style={{ height: 'calc(100vh - 73px)' }}>
      {/* Map canvas */}
      <div ref={containerRef} className="absolute inset-0" />

      {/* Camera count badge */}
      <div className="absolute top-4 left-4 rounded-full bg-zinc-900/80 border border-white/10 backdrop-blur-sm px-3 py-1 text-xs font-mono text-zinc-400">
        {cameras.length} cameras
      </div>

      {/* Selected camera panel */}
      {selected && (
        <div className="absolute bottom-6 right-4 w-80 rounded-xl border border-white/10 bg-zinc-900/95 backdrop-blur-md shadow-2xl overflow-hidden z-10">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 gap-2">
            <span className="font-mono text-xs font-medium text-zinc-300 truncate">
              {selected.cameralabel}
            </span>
            <button
              onClick={handleClose}
              className="shrink-0 rounded-full p-1 text-zinc-500 hover:text-zinc-200 hover:bg-white/10 transition-colors"
              aria-label="Close"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Snapshot */}
          <div className="aspect-video w-full bg-black">
            <img
              src={`${selected.imageurl.url}?t=${imgTimestamp}`}
              alt={selected.cameralabel}
              className="h-full w-full object-cover"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3 px-4 py-3 border-t border-white/5">
            {selected.video_url?.url && (
              <a
                href={selected.video_url.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-xs text-emerald-400 hover:text-emerald-300 transition-colors"
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
                className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                SDOT page
              </a>
            )}
            <button
              onClick={() => setImgTimestamp(Date.now())}
              className="ml-auto text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
            >
              Refresh
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
