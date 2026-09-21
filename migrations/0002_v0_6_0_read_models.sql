-- PlugPark v0.6.0 read models
-- Runtime prepare endpoint also creates these tables with IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS ev_stations (
  stat_id TEXT PRIMARY KEY,
  station_name TEXT NOT NULL,
  normalized_station_name TEXT NOT NULL,
  address TEXT,
  lat REAL,
  lng REAL,
  charger_count INTEGER NOT NULL,
  available_count INTEGER NOT NULL,
  charging_count INTEGER NOT NULL,
  fast_count INTEGER NOT NULL,
  slow_count INTEGER NOT NULL,
  last_updated_at TEXT,
  synced_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ev_stations_normalized_name ON ev_stations(normalized_station_name);
CREATE INDEX IF NOT EXISTS idx_ev_stations_coords ON ev_stations(lat, lng);

CREATE TABLE IF NOT EXISTS parking_read_model (
  parking_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  address TEXT,
  agency TEXT,
  lat REAL,
  lng REAL,
  capacity INTEGER,
  available_parking INTEGER,
  occupied_parking INTEGER,
  fee_text TEXT,
  operation_text TEXT,
  parking_updated_at TEXT,
  parking_realtime INTEGER NOT NULL DEFAULT 0,
  parking_source TEXT,
  realtime_match_type TEXT,
  realtime_name TEXT,
  synced_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_parking_read_model_name ON parking_read_model(normalized_name);
CREATE INDEX IF NOT EXISTS idx_parking_read_model_coords ON parking_read_model(lat, lng);
