ALTER TABLE camera_snapshots ADD COLUMN visual_fingerprint TEXT;
ALTER TABLE camera_snapshots ADD COLUMN mean_luma REAL;
ALTER TABLE camera_snapshots ADD COLUMN visual_contrast REAL;
ALTER TABLE camera_snapshots ADD COLUMN latitude REAL;
ALTER TABLE camera_snapshots ADD COLUMN longitude REAL;

CREATE INDEX IF NOT EXISTS idx_camera_snapshots_visual_time
  ON camera_snapshots(camera_id, captured_at DESC, visual_fingerprint);
