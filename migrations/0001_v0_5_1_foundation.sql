-- PlugPark v0.5.1 D1 foundation
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS parking_lots (
  parking_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  district TEXT,
  road_address TEXT,
  jibun_address TEXT,
  lat REAL,
  lng REAL,
  capacity INTEGER,
  fee_text TEXT,
  operation_text TEXT,
  source_updated_at TEXT,
  coordinate_source TEXT NOT NULL DEFAULT 'api',
  synced_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_parking_lots_normalized_name
  ON parking_lots(normalized_name);
CREATE INDEX IF NOT EXISTS idx_parking_lots_district
  ON parking_lots(district);

CREATE TABLE IF NOT EXISTS parking_realtime (
  parking_code TEXT PRIMARY KEY,
  parking_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  available_count INTEGER,
  occupied_count INTEGER,
  max_count INTEGER,
  validation_state TEXT NOT NULL DEFAULT 'unknown',
  source_updated_at TEXT,
  synced_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_parking_realtime_normalized_name
  ON parking_realtime(normalized_name);

CREATE TABLE IF NOT EXISTS ev_chargers (
  stat_id TEXT NOT NULL,
  chger_id TEXT NOT NULL,
  station_name TEXT NOT NULL,
  normalized_station_name TEXT NOT NULL,
  charger_type TEXT,
  address TEXT,
  address_detail TEXT,
  location TEXT,
  lat REAL,
  lng REAL,
  use_time TEXT,
  busi_id TEXT,
  bnm TEXT,
  busi_name TEXT,
  busi_call TEXT,
  info_status TEXT,
  info_status_updated_at TEXT,
  last_start_at TEXT,
  last_end_at TEXT,
  now_start_at TEXT,
  output_kw REAL,
  method TEXT,
  zcode TEXT NOT NULL,
  zscode TEXT,
  kind TEXT,
  kind_detail TEXT,
  parking_free TEXT,
  note TEXT,
  limit_yn TEXT,
  limit_detail TEXT,
  del_yn TEXT,
  del_detail TEXT,
  traffic_yn TEXT,
  year TEXT,
  floor_num TEXT,
  floor_type TEXT,
  maker TEXT,
  synced_at TEXT NOT NULL,
  PRIMARY KEY (stat_id, chger_id)
);

CREATE INDEX IF NOT EXISTS idx_ev_chargers_stat_id ON ev_chargers(stat_id);
CREATE INDEX IF NOT EXISTS idx_ev_chargers_station_name ON ev_chargers(station_name);
CREATE INDEX IF NOT EXISTS idx_ev_chargers_normalized_name ON ev_chargers(normalized_station_name);
CREATE INDEX IF NOT EXISTS idx_ev_chargers_zcode ON ev_chargers(zcode);
CREATE INDEX IF NOT EXISTS idx_ev_chargers_zscode ON ev_chargers(zscode);
CREATE INDEX IF NOT EXISTS idx_ev_chargers_del_yn ON ev_chargers(del_yn);

CREATE TABLE IF NOT EXISTS ev_status (
  stat_id TEXT NOT NULL,
  chger_id TEXT NOT NULL,
  status TEXT NOT NULL,
  status_updated_at TEXT,
  last_start_at TEXT,
  last_end_at TEXT,
  now_start_at TEXT,
  synced_at TEXT NOT NULL,
  PRIMARY KEY (stat_id, chger_id)
);

CREATE TABLE IF NOT EXISTS parking_ev_matches (
  parking_id TEXT NOT NULL,
  stat_id TEXT NOT NULL,
  match_type TEXT NOT NULL,
  match_score REAL,
  distance_m REAL,
  reviewed INTEGER NOT NULL DEFAULT 0,
  matched_at TEXT NOT NULL,
  PRIMARY KEY (parking_id, stat_id)
);

CREATE INDEX IF NOT EXISTS idx_parking_ev_matches_stat_id
  ON parking_ev_matches(stat_id);

CREATE TABLE IF NOT EXISTS sync_state (
  job_name TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  next_page INTEGER,
  total_pages INTEGER,
  reported_total_count INTEGER,
  last_success_at TEXT,
  last_error TEXT,
  run_id TEXT
);

CREATE TABLE IF NOT EXISTS api_usage_daily (
  usage_date TEXT NOT NULL,
  api_name TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (usage_date, api_name)
);
