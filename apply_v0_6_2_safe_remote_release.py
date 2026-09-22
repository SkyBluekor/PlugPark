from pathlib import Path
import json, shutil, sys, subprocess

ROOT = Path.cwd()
WORKER = ROOT / "worker" / "index.ts"
PACKAGE = ROOT / "package.json"
LOCAL_VERIFY = ROOT / "scripts" / "local-recovery-verify.mjs"
PAYLOAD = Path(__file__).resolve().parent / "payload"
BACKUP = ROOT / ".plugpark" / "recovery-backup-v0.6.2"

def fail(msg):
    print(f"\n[ABORT] {msg}")
    raise SystemExit(2)

if not WORKER.exists() or not PACKAGE.exists() or not LOCAL_VERIFY.exists():
    fail("PlugPark v0.6.1 프로젝트 루트에서 실행하세요.")

pkg = json.loads(PACKAGE.read_text(encoding="utf-8"))
if pkg.get("name") != "plugpark":
    fail("package.json name이 plugpark가 아닙니다.")

worker = WORKER.read_text(encoding="utf-8")
required = [
    "const DATA_LAYER_VERSION = 'v0.6.1';",
    "async function rebuildEvStations(db: D1Database)",
    "async function replaceParkingReadModel(db: D1Database, items: ParkingBase[])",
    "async function rebuildParkingEvMatches(db: D1Database, radius: number)",
    "LOCAL_FIXTURE_MODE?: string;",
]
already = "const DATA_LAYER_VERSION = 'v0.6.2';" in worker and "await db.batch(statements);" in worker
missing = [x for x in required if x not in worker]
if missing and not already:
    fail("현재 소스가 검증된 v0.6.1 구조와 다릅니다. 아무 파일도 수정하지 않았습니다.\n누락: " + ", ".join(missing))

BACKUP.mkdir(parents=True, exist_ok=True)
for rel in ["worker/index.ts", "package.json", "scripts/local-recovery-verify.mjs", "scripts/verify-v0.6.mjs"]:
    src = ROOT / rel
    if src.exists():
        dst = BACKUP / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)

if not already:
    worker = worker.replace("const CACHE_VERSION = 'v6.1';", "const CACHE_VERSION = 'v6.2';", 1)
    worker = worker.replace("const DATA_LAYER_VERSION = 'v0.6.1';", "const DATA_LAYER_VERSION = 'v0.6.2';", 1)

    old = """async function rebuildEvStations(db: D1Database) {
  const now = new Date().toISOString();
  await db.prepare('DELETE FROM ev_stations').run();
  await db.prepare(
    `INSERT INTO ev_stations (
       stat_id, station_name, normalized_station_name, address, lat, lng,
       charger_count, available_count, charging_count, fast_count, slow_count,
       last_updated_at, synced_at
     )
     SELECT
       c.stat_id,
       MAX(c.station_name),
       MAX(c.normalized_station_name),
       MAX(COALESCE(c.address, '')),
       AVG(c.lat),
       AVG(c.lng),
       COUNT(*),
       SUM(CASE WHEN COALESCE(s.status, c.info_status) = '2' THEN 1 ELSE 0 END),
       SUM(CASE WHEN COALESCE(s.status, c.info_status) = '3' THEN 1 ELSE 0 END),
       SUM(CASE
             WHEN c.output_kw >= 50 THEN 1
             WHEN c.output_kw IS NULL AND c.charger_type IN ('01','03','04','05','06','07','09','10') THEN 1
             ELSE 0
           END),
       SUM(CASE
             WHEN c.output_kw >= 50 THEN 0
             WHEN c.output_kw IS NULL AND c.charger_type IN ('01','03','04','05','06','07','09','10') THEN 0
             ELSE 1
           END),
       MAX(COALESCE(s.status_updated_at, c.info_status_updated_at)),
       ?1
     FROM ev_chargers c
     LEFT JOIN ev_status s USING(stat_id, chger_id)
     WHERE COALESCE(c.del_yn, '') <> 'Y'
     GROUP BY c.stat_id`,
  ).bind(now).run();
}"""
    new = """async function rebuildEvStations(db: D1Database) {
  const now = new Date().toISOString();
  const insert = db.prepare(
    `INSERT INTO ev_stations (
       stat_id, station_name, normalized_station_name, address, lat, lng,
       charger_count, available_count, charging_count, fast_count, slow_count,
       last_updated_at, synced_at
     )
     SELECT
       c.stat_id,
       MAX(c.station_name),
       MAX(c.normalized_station_name),
       MAX(COALESCE(c.address, '')),
       AVG(c.lat),
       AVG(c.lng),
       COUNT(*),
       SUM(CASE WHEN COALESCE(s.status, c.info_status) = '2' THEN 1 ELSE 0 END),
       SUM(CASE WHEN COALESCE(s.status, c.info_status) = '3' THEN 1 ELSE 0 END),
       SUM(CASE
             WHEN c.output_kw >= 50 THEN 1
             WHEN c.output_kw IS NULL AND c.charger_type IN ('01','03','04','05','06','07','09','10') THEN 1
             ELSE 0
           END),
       SUM(CASE
             WHEN c.output_kw >= 50 THEN 0
             WHEN c.output_kw IS NULL AND c.charger_type IN ('01','03','04','05','06','07','09','10') THEN 0
             ELSE 1
           END),
       MAX(COALESCE(s.status_updated_at, c.info_status_updated_at)),
       ?1
     FROM ev_chargers c
     LEFT JOIN ev_status s USING(stat_id, chger_id)
     WHERE COALESCE(c.del_yn, '') <> 'Y'
     GROUP BY c.stat_id`,
  ).bind(now);

  // DELETE + INSERT를 하나의 D1 batch로 묶어 quota/network 실패 시 기존 read model을 보존합니다.
  await db.batch([
    db.prepare('DELETE FROM ev_stations'),
    insert,
  ]);
}"""
    if old not in worker:
        fail("rebuildEvStations 블록을 찾지 못했습니다.")
    worker = worker.replace(old, new, 1)

    old = """  await db.prepare('DELETE FROM parking_read_model').run();
  const syncedAt = new Date().toISOString();"""
    new = """  const syncedAt = new Date().toISOString();"""
    if old not in worker:
        fail("parking delete 블록을 찾지 못했습니다.")
    worker = worker.replace(old, new, 1)

    old = """  for (let offset = 0; offset < rows.length; offset += 100) {
    await db.prepare(sql).bind(JSON.stringify(rows.slice(offset, offset + 100))).run();
  }
}"""
    new = """  const statements: D1PreparedStatement[] = [
    db.prepare('DELETE FROM parking_read_model'),
  ];
  for (let offset = 0; offset < rows.length; offset += 100) {
    statements.push(db.prepare(sql).bind(JSON.stringify(rows.slice(offset, offset + 100))));
  }
  await db.batch(statements);
}"""
    if old not in worker:
        fail("parking insert loop를 찾지 못했습니다.")
    worker = worker.replace(old, new, 1)

    old = """  await db.prepare('DELETE FROM parking_ev_matches').run();
  const rows = [...matches.values()];"""
    new = """  const rows = [...matches.values()];"""
    if old not in worker:
        fail("matches delete 블록을 찾지 못했습니다.")
    worker = worker.replace(old, new, 1)

    old = """  for (let offset = 0; offset < rows.length; offset += 100) {
    await db.prepare(sql).bind(JSON.stringify(rows.slice(offset, offset + 100))).run();
  }
  return rows.length;
}"""
    new = """  const statements: D1PreparedStatement[] = [
    db.prepare('DELETE FROM parking_ev_matches'),
  ];
  for (let offset = 0; offset < rows.length; offset += 100) {
    statements.push(db.prepare(sql).bind(JSON.stringify(rows.slice(offset, offset + 100))));
  }
  await db.batch(statements);
  return rows.length;
}"""
    if old not in worker:
        fail("matches insert loop를 찾지 못했습니다.")
    worker = worker.replace(old, new, 1)

    WORKER.write_text(worker, encoding="utf-8")

# Copy scripts
for name in ["remote-preflight.mjs", "remote-release.mjs", "status-remote.mjs", "verify-v0.6.mjs"]:
    src = PAYLOAD / "scripts" / name
    dst = ROOT / "scripts" / name
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)

# Update local verify expected version.
lv = LOCAL_VERIFY.read_text(encoding="utf-8")
lv = lv.replace("PlugPark v0.6.1 LOCAL-FIRST VERIFY", "PlugPark v0.6.2 LOCAL-FIRST VERIFY")
lv = lv.replace("'/api/d1/read-model-state?v=61'", "'/api/d1/read-model-state?v=62'")
lv = lv.replace("'/api/places?v=61'", "'/api/places?v=62'")
# explicit version assertion, additive and idempotent
marker = "assert(state.ready === true, 'read model ready=true가 아님');"
if "dataLayerVersion === 'v0.6.2'" not in lv:
    lv = lv.replace(marker, "assert(state.dataLayerVersion === 'v0.6.2', `dataLayerVersion=${state.dataLayerVersion}`);\n  " + marker, 1)
lv = lv.replace("verifiedAt: new Date().toISOString(),", "verifiedAt: new Date().toISOString(),\n    dataLayerVersion: state.dataLayerVersion,", 1)
LOCAL_VERIFY.write_text(lv, encoding="utf-8")

pkg = json.loads(PACKAGE.read_text(encoding="utf-8"))
pkg["version"] = "0.6.2"
scripts = pkg.setdefault("scripts", {})
scripts["preflight:remote"] = "node scripts/remote-preflight.mjs"
scripts["status:remote"] = "node scripts/status-remote.mjs"
scripts["verify:remote"] = "node scripts/verify-v0.6.mjs"
scripts["release:remote"] = "node scripts/remote-release.mjs"
scripts["release"] = "node scripts/remote-release.mjs"
PACKAGE.write_text(json.dumps(pkg, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

print("\n[OK] PlugPark v0.6.2 SAFE REMOTE RELEASE 적용 완료")
print(f"[backup] {BACKUP}")
print("[remote write] 아직 0 — apply 단계에서는 Cloudflare를 수정하지 않습니다.")

if "--release" in sys.argv:
    print("\n[release] local verify → remote preflight → deploy 1회 → read-model stage 각 1회 → smoke verify\n")
    raise SystemExit(subprocess.call(["node", "scripts/remote-release.mjs"], cwd=ROOT))

print("\n다음 명령:")
print("  python .\\apply_v0_6_2_safe_remote_release.py --release")
