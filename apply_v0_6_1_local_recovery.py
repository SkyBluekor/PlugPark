from pathlib import Path
import json, shutil, sys, subprocess, datetime

ROOT = Path.cwd()
WORKER = ROOT / "worker" / "index.ts"
PACKAGE = ROOT / "package.json"
PAYLOAD = Path(__file__).resolve().parent / "payload"
BACKUP = ROOT / ".plugpark" / "recovery-backup-v0.6.1"

def fail(msg):
    print(f"\n[ABORT] {msg}")
    sys.exit(2)

if not WORKER.exists() or not PACKAGE.exists():
    fail("PlugPark 프로젝트 루트에서 실행하세요. worker/index.ts 또는 package.json을 찾지 못했습니다.")

pkg = json.loads(PACKAGE.read_text(encoding="utf-8"))
if pkg.get("name") != "plugpark":
    fail(f"package.json name이 plugpark가 아닙니다: {pkg.get('name')}")

worker = WORKER.read_text(encoding="utf-8")
required_markers = [
    "const DATA_LAYER_VERSION = 'v0.6.0';",
    "async function prepareD1ReadModels(env: Env, stage: ReadModelPrepareStage)",
    "async function rebuildEvStations(db: D1Database)",
    "if (stage === 'all' || stage === 'parking')",
]
missing = [m for m in required_markers if m not in worker]
already = "LOCAL_FIXTURE_MODE?: string;" in worker and "loadLocalParkingFixtureFromD1" in worker
if missing and not already:
    fail("현재 worker/index.ts가 예상한 v0.6.0 구조와 다릅니다. 파일을 덮어쓰지 않았습니다.\n누락: " + ", ".join(missing))

BACKUP.mkdir(parents=True, exist_ok=True)
for rel in ["worker/index.ts", "package.json"]:
    src = ROOT / rel
    dst = BACKUP / rel
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)

if not already:
    worker = worker.replace(
        "  MATCH_RADIUS_METERS?: string;\n  DB?: D1Database;",
        "  MATCH_RADIUS_METERS?: string;\n  LOCAL_FIXTURE_MODE?: string;\n  DB?: D1Database;",
        1,
    )
    worker = worker.replace(
        "const CACHE_VERSION = 'v6.0';\nconst DATA_LAYER_VERSION = 'v0.6.0';",
        "const CACHE_VERSION = 'v6.1';\nconst DATA_LAYER_VERSION = 'v0.6.1';",
        1,
    )

    old = """  if (stage === 'all' || stage === 'parking') {
    if (!env.BUSAN_PARKING_API_KEY) throw new Error('BUSAN_PARKING_API_KEY가 설정되지 않았습니다.');
    const parking = await fetchMergedParking(env);
    await replaceParkingReadModel(env.DB, parking.items);
    await markReadModelJob(env.DB, 'read_model_parking', runId);
    completed.push('parking');
  }"""
    new = """  if (stage === 'all' || stage === 'parking') {
    const parking = isLocalFixtureMode(env)
      ? await loadLocalParkingFixtureFromD1(env.DB)
      : await (async () => {
          if (!env.BUSAN_PARKING_API_KEY) {
            throw new Error('BUSAN_PARKING_API_KEY가 설정되지 않았습니다.');
          }
          return fetchMergedParking(env);
        })();
    await replaceParkingReadModel(env.DB, parking.items);
    await markReadModelJob(env.DB, 'read_model_parking', runId);
    completed.push('parking');
  }"""
    if old not in worker:
        fail("parking prepare 블록을 찾지 못했습니다. 원본은 백업했고 변경은 적용하지 않았습니다.")
    worker = worker.replace(old, new, 1)

    anchor = "async function rebuildEvStations(db: D1Database) {"
    helper = r"""function isLocalFixtureMode(env: Env) {
  return String(env.LOCAL_FIXTURE_MODE || '').toLowerCase() === 'true';
}

async function loadLocalParkingFixtureFromD1(db: D1Database): Promise<ParkingJoinResult> {
  const rows = await db.prepare(
    `SELECT
       p.parking_id, p.name,
       COALESCE(NULLIF(p.road_address, ''), NULLIF(p.jibun_address, ''), '주소 정보 없음') AS address,
       COALESCE(p.district, '') AS agency,
       p.lat, p.lng, p.capacity, p.fee_text, p.operation_text,
       r.parking_name AS realtime_name,
       r.available_count, r.occupied_count, r.max_count, r.source_updated_at
     FROM parking_lots p
     LEFT JOIN parking_realtime r
       ON r.normalized_name = p.normalized_name
     ORDER BY p.parking_id`,
  ).all<{
    parking_id: string;
    name: string;
    address: string;
    agency: string;
    lat: number | null;
    lng: number | null;
    capacity: number | null;
    fee_text: string | null;
    operation_text: string | null;
    realtime_name: string | null;
    available_count: number | null;
    occupied_count: number | null;
    max_count: number | null;
    source_updated_at: string | null;
  }>();

  const items: ParkingBase[] = rows.results.map((row) => {
    const hasRealtime = Boolean(row.realtime_name);
    return {
      id: row.parking_id,
      name: row.name,
      address: row.address,
      agency: row.agency,
      lat: row.lat == null ? null : Number(row.lat),
      lng: row.lng == null ? null : Number(row.lng),
      capacity: row.max_count == null
        ? (row.capacity == null ? null : Number(row.capacity))
        : Number(row.max_count),
      availableParking: row.available_count == null ? null : Number(row.available_count),
      occupiedParking: row.occupied_count == null ? null : Number(row.occupied_count),
      feeText: row.fee_text || '요금 정보 확인 필요',
      operationText: row.operation_text || '운영시간 확인 필요',
      parkingUpdatedAt: row.source_updated_at || null,
      parkingRealtime: hasRealtime,
      parkingSource: hasRealtime ? 'merged' : 'busan-city',
      realtimeMatch: {
        matched: hasRealtime,
        type: hasRealtime ? 'exact-name' : 'unmatched',
        realtimeName: row.realtime_name || null,
      },
    };
  });

  const realtimeCount = items.filter((item) => item.parkingRealtime).length;
  return {
    items,
    details: [],
    summary: {
      realtimeCount,
      matched: realtimeCount,
      exact: realtimeCount,
      contained: 0,
      similar: 0,
      ambiguous: 0,
      unmatched: items.length - realtimeCount,
    },
  };
}

"""
    if anchor not in worker:
        fail("rebuildEvStations anchor를 찾지 못했습니다.")
    worker = worker.replace(anchor, helper + anchor, 1)
    WORKER.write_text(worker, encoding="utf-8")

# copy additive files
for rel in [
    Path("scripts/source-baseline.mjs"),
    Path("scripts/local-recovery-verify.mjs"),
    Path("tests/fixtures/local-recovery-seed.sql"),
]:
    src = PAYLOAD / rel
    dst = ROOT / rel
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)

pkg = json.loads(PACKAGE.read_text(encoding="utf-8"))
pkg["version"] = "0.6.1"
scripts = pkg.setdefault("scripts", {})
scripts["baseline"] = "node scripts/source-baseline.mjs"
scripts["verify:local"] = "node scripts/local-recovery-verify.mjs"
PACKAGE.write_text(json.dumps(pkg, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

print("\n[OK] v0.6.1 LOCAL-FIRST recovery 적용 완료")
print(f"[backup] {BACKUP}")
print("[remote] Cloudflare/D1 remote에는 아무 것도 쓰지 않았습니다.")

if "--verify" in sys.argv:
    print("\n[verify] npm 대신 Node 기반 verify:local을 직접 실행합니다.\n")
    r = subprocess.run([sys.executable, "-c", "import subprocess; raise SystemExit(subprocess.call(['node','scripts/local-recovery-verify.mjs']))"], cwd=ROOT)
    raise SystemExit(r.returncode)

print("\n다음 명령:")
print("  npm run verify:local")
