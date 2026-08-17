CREATE TABLE IF NOT EXISTS camera_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  camera_id TEXT NOT NULL,
  camera_label TEXT NOT NULL,
  captured_at INTEGER NOT NULL,
  r2_key TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  bytes INTEGER NOT NULL DEFAULT 0,
  is_duplicate INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_camera_snapshots_camera_time
  ON camera_snapshots(camera_id, captured_at DESC);

CREATE INDEX IF NOT EXISTS idx_camera_snapshots_time
  ON camera_snapshots(captured_at);

CREATE INDEX IF NOT EXISTS idx_camera_snapshots_r2_key
  ON camera_snapshots(r2_key);
