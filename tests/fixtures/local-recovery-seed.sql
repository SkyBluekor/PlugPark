-- PlugPark v0.6.1 local recovery fixture
-- LOCAL ONLY. Remote D1에 실행하지 마세요.

DELETE FROM parking_ev_matches;
DELETE FROM parking_read_model;
DELETE FROM ev_stations;
DELETE FROM ev_status;
DELETE FROM parking_realtime;
DELETE FROM parking_lots;
DELETE FROM ev_chargers;
DELETE FROM sync_state;
DELETE FROM api_usage_daily;
DELETE FROM parking_realtime_snapshot_chunks;
DELETE FROM parking_match_rules;

INSERT INTO sync_state (
  job_name, status, next_page, total_pages, reported_total_count,
  last_success_at, last_error, run_id
) VALUES (
  'ev_info', 'complete', 34, 33, 5,
  '2026-09-22T00:00:00.000Z', NULL, 'local-fixture'
);

-- 센텀시티: 주차장 좌표가 없어도 포함 이름으로 매칭되어야 한다.
INSERT INTO parking_lots (
  parking_id, name, normalized_name, district, road_address, jibun_address,
  lat, lng, capacity, fee_text, operation_text, source_updated_at, coordinate_source, synced_at
) VALUES
('2019000008', '해운대센텀시티 공영주차장', '해운대센텀시티', '해운대구',
 '부산광역시 해운대구 센텀중앙로', '', NULL, NULL, 80, '10분 300원', '24시간',
 '2026-09-22T00:00:00.000Z', 'fixture', '2026-09-22T00:00:00.000Z'),
('PARK002', '부산시민공원 공영주차장', '부산시민공원', '부산진구',
 '부산광역시 부산진구 시민공원로 73', '', 35.1668, 129.0572, 100, '10분 300원', '24시간',
 '2026-09-22T00:00:00.000Z', 'fixture', '2026-09-22T00:00:00.000Z'),
('PARK003', '테스트 무충전 주차장', '테스트무충전', '동래구',
 '부산광역시 동래구 테스트로 1', '', 35.2000, 129.0800, 30, '무료', '09:00 ~ 18:00',
 '2026-09-22T00:00:00.000Z', 'fixture', '2026-09-22T00:00:00.000Z');

INSERT INTO parking_realtime (
  parking_code, parking_name, normalized_name, available_count, occupied_count,
  max_count, validation_state, source_updated_at, synced_at
) VALUES
('A01', '부산시민공원 공영주차장', '부산시민공원', 60, 40, 100, 'valid',
 '2026-09-22T00:00:00.000Z', '2026-09-22T00:00:00.000Z'),
-- 동일 normalized_name이 둘 이상이어도 parking_read_model PK 충돌이 나면 안 된다.
('A01-DUP', '부산시민공원', '부산시민공원', 58, 42, 100, 'valid',
 '2026-09-22T00:01:00.000Z', '2026-09-22T00:01:00.000Z');

INSERT INTO ev_chargers (
  stat_id, chger_id, station_name, normalized_station_name, charger_type,
  address, lat, lng, info_status, info_status_updated_at, output_kw,
  zcode, del_yn, synced_at
) VALUES
('STCENT01', '01', '센텀시티', '센텀시티', '06',
 '부산광역시 해운대구 센텀중앙로', 35.1695, 129.1300, '2', '20260922090000', 100,
 '26', 'N', '2026-09-22T00:00:00.000Z'),
('STCENT01', '02', '센텀시티', '센텀시티', '02',
 '부산광역시 해운대구 센텀중앙로', 35.1695, 129.1300, '3', '20260922090100', 7,
 '26', 'N', '2026-09-22T00:00:00.000Z'),
('STCENT01', '99', '센텀시티', '센텀시티', '06',
 '부산광역시 해운대구 센텀중앙로', 35.1695, 129.1300, '2', '20260922090200', 100,
 '26', 'Y', '2026-09-22T00:00:00.000Z'),
('STPARK01', '01', '부산시민공원', '부산시민공원', '06',
 '부산광역시 부산진구 시민공원로 73', 35.16681, 129.05721, '2', '20260922090300', 100,
 '26', 'N', '2026-09-22T00:00:00.000Z'),
('STPARK01', '02', '부산시민공원', '부산시민공원', '02',
 '부산광역시 부산진구 시민공원로 73', 35.16681, 129.05721, '1', '20260922090400', 7,
 '26', 'N', '2026-09-22T00:00:00.000Z');

INSERT INTO ev_status (
  stat_id, chger_id, status, status_updated_at, synced_at
) VALUES
('STPARK01', '02', '2', '20260922090500', '2026-09-22T00:00:00.000Z');


-- v0.7.2-P2: code rule aggregation + invalid-overwrite protection fixtures.
INSERT OR REPLACE INTO parking_match_rules (
  parking_code, parking_id, match_type, confidence, allow_aggregate, note, updated_at
) VALUES
(
  'A-CENTUM-2', '2019000008', 'CODE_RULE', 1.0, 1,
  'local aggregation fixture', '2026-09-22T00:00:00.000Z'
),
(
  'A-NEGATIVE', 'PARK003', 'CODE_RULE', 1.0, 0,
  'invalid update must not overwrite prior good snapshot', '2026-09-22T00:00:00.000Z'
);

INSERT OR REPLACE INTO parking_realtime_snapshot_chunks (
  chunk_no, fetched_at, item_count, payload_json
) VALUES (
  1,
  '2026-09-22T00:00:00.000Z',
  1,
  '[{"parkingId":"PARK003","parkingCode":"A-NEGATIVE","parkingName":"음수테스트","available":7,"occupied":23,"capacity":30,"sourceUpdatedAt":"2026-09-22 08:00:00","fetchedAt":"2026-09-22T00:00:00.000Z","components":[{"parkingCode":"A-NEGATIVE","parkingName":"음수테스트","available":7,"occupied":23,"capacity":30,"sourceUpdatedAt":"2026-09-22 08:00:00","fetchedAt":"2026-09-22T00:00:00.000Z"}]}]'
);
