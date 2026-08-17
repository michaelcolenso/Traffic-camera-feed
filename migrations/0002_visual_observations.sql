ALTER TABLE camera_snapshots ADD COLUMN visual_fingerprint TEXT;
ALTER TABLE camera_snapshots ADD COLUMN mean_luma REAL;
ALTER TABLE camera_snapshots ADD COLUMN visual_contrast REAL;
ALTER TABLE camera_snapshots ADD COLUMN latitude REAL;
ALTER TABLE camera_snapshots ADD COLUMN longitude REAL;
