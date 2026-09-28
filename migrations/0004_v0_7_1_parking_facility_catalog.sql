-- PlugPark v0.7.1 부산시설공단 v2 parking contract
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS parking_facility_catalog (
  parking_code TEXT PRIMARY KEY,
  parking_name TEXT,
  refreshed_at TEXT NOT NULL,
  last_polled_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_parking_facility_catalog_poll
  ON parking_facility_catalog(last_polled_at, parking_code);
