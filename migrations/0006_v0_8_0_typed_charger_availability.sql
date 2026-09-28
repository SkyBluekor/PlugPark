-- PlugPark v0.8.0-R1 typed charger availability
PRAGMA foreign_keys = ON;

ALTER TABLE ev_stations ADD COLUMN available_fast_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ev_stations ADD COLUMN available_slow_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ev_station_live_status ADD COLUMN available_fast_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ev_station_live_status ADD COLUMN available_slow_count INTEGER NOT NULL DEFAULT 0;
