-- PlugPark v0.7.2-P2 parking realtime match rules
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS parking_match_rules (
  parking_code TEXT PRIMARY KEY,
  parking_id TEXT NOT NULL,
  match_type TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 1.0,
  allow_aggregate INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_parking_match_rules_parking_id
  ON parking_match_rules(parking_id);

-- High-confidence links confirmed from the v0.7.2-P1 coverage audit against the
-- existing 360-row parking read model. Ambiguous facilities are intentionally omitted.
INSERT OR IGNORE INTO parking_match_rules
  (parking_code, parking_id, match_type, confidence, allow_aggregate, note, updated_at)
VALUES
  ('A07',  '2007011298', 'CODE_RULE', 1.0, 0, '노포역 -> 도시철도 노포역', '2026-09-22T00:00:00.000Z'),
  ('A21',  '2019000001', 'CODE_RULE', 0.99, 0, '화명역 -> 국철 화명역 공영주차장', '2026-09-22T00:00:00.000Z'),
  ('A26',  '2008000002', 'CODE_RULE', 0.90, 0, '온천장역(남측) -> 도시철도 온천장역', '2026-09-22T00:00:00.000Z'),
  ('A27',  '2007011184', 'CODE_RULE', 1.0, 0, '구서역 -> 도시철도구서역', '2026-09-22T00:00:00.000Z'),
  ('A29',  '2007011207', 'CODE_RULE', 1.0, 0, '장전역 -> 도시철도 장전역', '2026-09-22T00:00:00.000Z'),
  ('A32',  '2007011110', 'CODE_RULE', 1.0, 0, '남산역 -> 도시철도 남산역', '2026-09-22T00:00:00.000Z'),
  ('A33',  '2009000025', 'CODE_RULE', 1.0, 0, '하단역 -> 도시철도 하단역 공영주차장', '2026-09-22T00:00:00.000Z'),
  ('A34',  '2007011236', 'CODE_RULE', 1.0, 0, '명륜역 -> 도시철도명륜역', '2026-09-22T00:00:00.000Z'),
  ('A35',  '2007011238', 'CODE_RULE', 1.0, 0, '동래역 -> 도시철도 동래역', '2026-09-22T00:00:00.000Z'),
  ('A48',  '2007011003', 'CODE_RULE', 0.90, 0, '대연고가밑 -> 대연고가도로 밑', '2026-09-22T00:00:00.000Z'),
  ('A433', '2007011024', 'CODE_RULE', 1.0, 0, '구남역 -> 도시철도 구남역', '2026-09-22T00:00:00.000Z'),
  ('A41',  '2019000002', 'CODE_RULE', 1.0, 1, '요트경기장 앞 1구역 aggregation', '2026-09-22T00:00:00.000Z'),
  ('A50',  '2019000002', 'CODE_RULE', 1.0, 1, '요트경기장 앞 2구역 aggregation', '2026-09-22T00:00:00.000Z'),
  ('A43',  '2008011648', 'CODE_RULE', 1.0, 1, '부전복개도로1 aggregation', '2026-09-22T00:00:00.000Z'),
  ('A44',  '2008011648', 'CODE_RULE', 1.0, 1, '부전복개도로2 aggregation', '2026-09-22T00:00:00.000Z');
