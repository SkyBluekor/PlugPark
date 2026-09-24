-- PlugPark v0.8.0-R1 typed availability one-shot initialization
-- Existing D1 ev_chargers + ev_status only. No public API calls.
-- Raw charger rows are aggregated once into a TEMP table and reused.

DROP TABLE IF EXISTS r1_typed_availability_init;

CREATE TABLE r1_typed_availability_init (
  stat_id TEXT PRIMARY KEY,
  available_count INTEGER NOT NULL,
  available_fast_count INTEGER NOT NULL,
  available_slow_count INTEGER NOT NULL
);

INSERT INTO r1_typed_availability_init (
  stat_id,
  available_count,
  available_fast_count,
  available_slow_count
)

SELECT
  c.stat_id AS stat_id,
  SUM(CASE WHEN COALESCE(s.status, c.info_status) = '2' THEN 1 ELSE 0 END) AS available_count,
  SUM(CASE
        WHEN COALESCE(s.status, c.info_status) = '2'
         AND (CASE
                WHEN c.output_kw >= 50 THEN 1
                WHEN c.output_kw IS NULL
                 AND c.charger_type IN ('01','03','04','05','06','07','09','10') THEN 1
                ELSE 0
              END) = 1
        THEN 1 ELSE 0
      END) AS available_fast_count,
  SUM(CASE
        WHEN COALESCE(s.status, c.info_status) = '2'
         AND (CASE
                WHEN c.output_kw >= 50 THEN 1
                WHEN c.output_kw IS NULL
                 AND c.charger_type IN ('01','03','04','05','06','07','09','10') THEN 1
                ELSE 0
              END) = 0
        THEN 1 ELSE 0
      END) AS available_slow_count
FROM ev_chargers c
LEFT JOIN ev_status s USING(stat_id, chger_id)
WHERE COALESCE(c.del_yn, '') <> 'Y'
GROUP BY c.stat_id;

UPDATE ev_stations
SET
  available_count = COALESCE(
    (SELECT a.available_count FROM r1_typed_availability_init a WHERE a.stat_id = ev_stations.stat_id),
    0
  ),
  available_fast_count = COALESCE(
    (SELECT a.available_fast_count FROM r1_typed_availability_init a WHERE a.stat_id = ev_stations.stat_id),
    0
  ),
  available_slow_count = COALESCE(
    (SELECT a.available_slow_count FROM r1_typed_availability_init a WHERE a.stat_id = ev_stations.stat_id),
    0
  );

UPDATE ev_station_live_status
SET
  available_count = COALESCE(
    (SELECT a.available_count FROM r1_typed_availability_init a WHERE a.stat_id = ev_station_live_status.stat_id),
    0
  ),
  available_fast_count = COALESCE(
    (SELECT a.available_fast_count FROM r1_typed_availability_init a WHERE a.stat_id = ev_station_live_status.stat_id),
    0
  ),
  available_slow_count = COALESCE(
    (SELECT a.available_slow_count FROM r1_typed_availability_init a WHERE a.stat_id = ev_station_live_status.stat_id),
    0
  );

DROP TABLE r1_typed_availability_init;
