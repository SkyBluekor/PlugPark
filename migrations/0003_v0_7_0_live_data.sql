-- PlugPark v0.7.0 live data finalization
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS ev_station_live_status (
  stat_id TEXT PRIMARY KEY,
  available_count INTEGER NOT NULL DEFAULT 0,
  charging_count INTEGER NOT NULL DEFAULT 0,
  unavailable_count INTEGER NOT NULL DEFAULT 0,
  status_updated_at TEXT,
  synced_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS parking_realtime_snapshot_chunks (
  chunk_no INTEGER PRIMARY KEY,
  fetched_at TEXT NOT NULL,
  item_count INTEGER NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS parking_realtime_links (
  parking_code TEXT PRIMARY KEY,
  realtime_name TEXT NOT NULL,
  parking_id TEXT,
  match_method TEXT NOT NULL,
  match_score REAL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_parking_realtime_links_parking_id
  ON parking_realtime_links(parking_id);
