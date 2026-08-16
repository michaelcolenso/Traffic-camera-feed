from pathlib import Path

# Progressive camera rendering so initial React work scales with the viewport, not the full SDOT dataset.
app = Path('src/App.tsx')
text = app.read_text()
text = text.replace(
    "import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';",
    "import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';",
    1,
)
text = text.replace(
    "type CollectionMode = 'all' | 'any';\n",
    "type CollectionMode = 'all' | 'any';\n\nconst INITIAL_CAMERA_COUNT = 24;\nconst CAMERA_PAGE_SIZE = 24;\n",
    1,
)
needle = "  const [lastSuccessfulSync, setLastSuccessfulSync] = useState<number | null>(null);\n  const deferredQuery = useDeferredValue(searchQuery);\n"
replacement = "  const [lastSuccessfulSync, setLastSuccessfulSync] = useState<number | null>(null);\n  const [visibleCameraCount, setVisibleCameraCount] = useState(INITIAL_CAMERA_COUNT);\n  const loadMoreRef = useRef<HTMLDivElement>(null);\n  const deferredQuery = useDeferredValue(searchQuery);\n"
assert needle in text
text = text.replace(needle, replacement, 1)
needle = "  const filteredCameras = useMemo(\n    () => filterCameras(cameras ?? [], deferredQuery, activeCollections, healthByCamera, collectionMode),\n    [activeCollections, cameras, collectionMode, deferredQuery, healthByCamera],\n  );\n\n"
replacement = needle + "  const displayedCameras = useMemo(\n    () => filteredCameras.slice(0, visibleCameraCount),\n    [filteredCameras, visibleCameraCount],\n  );\n\n  useEffect(() => {\n    setVisibleCameraCount(INITIAL_CAMERA_COUNT);\n  }, [activeCollections, collectionMode, deferredQuery, source]);\n\n  useEffect(() => {\n    const target = loadMoreRef.current;\n    if (!target || visibleCameraCount >= filteredCameras.length) return;\n\n    const observer = new IntersectionObserver(\n      ([entry]) => {\n        if (entry.isIntersecting) {\n          setVisibleCameraCount((current) => Math.min(current + CAMERA_PAGE_SIZE, filteredCameras.length));\n        }\n      },\n      { rootMargin: '1000px 0px' },\n    );\n\n    observer.observe(target);\n    return () => observer.disconnect();\n  }, [filteredCameras.length, visibleCameraCount]);\n\n"
assert needle in text
text = text.replace(needle, replacement, 1)
needle = '''              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3 xl:grid-cols-4">
                {filteredCameras?.map((camera) => (
                  <CameraCard key={camera.imageurl.url} camera={camera} searchQuery={deferredQuery} onFocus={setFocusedCamera} onHealthChange={handleHealthChange} />
                ))}
              </div>'''
replacement = '''              <>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3 xl:grid-cols-4">
                  {displayedCameras.map((camera, index) => (
                    <CameraCard
                      key={camera.imageurl.url}
                      camera={camera}
                      searchQuery={deferredQuery}
                      priority={index === 0}
                      onFocus={setFocusedCamera}
                      onHealthChange={handleHealthChange}
                    />
                  ))}
                </div>
                {displayedCameras.length < filteredCameras.length && (
                  <div ref={loadMoreRef} className="flex min-h-24 items-center justify-center py-6" aria-live="polite">
                    <span className="rounded-full border border-slate-300/15 bg-slate-900/60 px-3 py-1.5 text-[11px] uppercase tracking-[0.12em] text-slate-300">
                      Loading more cameras · {displayedCameras.length} of {filteredCameras.length}
                    </span>
                  </div>
                )}
              </>'''
assert needle in text
text = text.replace(needle, replacement, 1)
app.write_text(text)

# Make the first visible snapshot an eager/high-priority LCP candidate and fix Lighthouse a11y findings.
card = Path('src/components/CameraCard.tsx')
text = card.read_text()
text = text.replace("  refreshInterval?: number;\n", "  refreshInterval?: number;\n  priority?: boolean;\n", 1)
text = text.replace(
    "export const CameraCard: React.FC<CameraCardProps> = ({ camera, searchQuery = '', refreshInterval = 30_000, onFocus, onHealthChange }) => {",
    "export const CameraCard: React.FC<CameraCardProps> = ({ camera, searchQuery = '', refreshInterval = 30_000, priority = false, onFocus, onHealthChange }) => {",
    1,
)
text = text.replace("          <h3\n", "          <h2\n", 1).replace("          </h3>\n", "          </h2>\n", 1)
text = text.replace('            loading="lazy"\n            decoding="async"\n            fetchPriority="low"', "            loading={priority ? 'eager' : 'lazy'}\n            decoding=\"async\"\n            fetchPriority={priority ? 'high' : 'low'}", 1)
text = text.replace("            aria-label={`Open focus mode for ${camera.cameralabel}`}", "            aria-label={`View camera ${camera.cameralabel}`}", 1)
card.write_text(text)

# Remove render-blocking Google Fonts; system stacks preserve the technical visual language without a network dependency.
css = Path('src/index.css')
text = css.read_text()
text = text.replace('@import url("https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Orbitron:wght@500;600;700&display=swap");\n', '', 1)
text = text.replace('  font-family: "JetBrains Mono", "SFMono-Regular", Menlo, Monaco, Consolas, "Liberation Mono",\n    monospace;', '  font-family: ui-monospace, "SFMono-Regular", Menlo, Monaco, Consolas, "Liberation Mono", monospace;', 1)
text = text.replace('  font-family: "Orbitron", "JetBrains Mono", "SFMono-Regular", Menlo, Monaco, Consolas, monospace;', '  font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;', 1)
css.write_text(text)
