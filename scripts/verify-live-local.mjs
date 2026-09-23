import { spawn, spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const DB_NAME = 'plugpark-db';
const PORT = Number(process.env.PLUGPARK_LIVE_LOCAL_PORT || 8800);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const TOKEN = 'plugpark-live-local-token';
const STATE_DIR = resolve('.plugpark', 'live-local-state');
const COMBINED_SCHEMA = resolve('.plugpark', 'live-local-schema.sql');
const FIXTURE_SQL = resolve('tests', 'fixtures', 'local-recovery-seed.sql');

function resolveNodeBin(...candidates) {
  for (const candidate of candidates) {
    const full = resolve('node_modules', ...candidate);
    if (existsSync(full)) return full;
  }
  throw new Error(`로컬 실행 파일을 찾지 못했습니다: ${candidates.map((x) => x.join('/')).join(', ')}`);
}

function runNodeScript(label, script, args = []) {
  process.stdout.write(`${label} ... `);
  const r = spawnSync(process.execPath, [script, ...args], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: false,
    windowsHide: true,
    env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' },
  });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`${label} 실패 (exit=${r.status})`);
  console.log('PASS');
}

function runWrangler(label, args) {
  const cli = resolveNodeBin(['wrangler', 'bin', 'wrangler.js'], ['wrangler', 'bin', 'wrangler.cjs']);
  runNodeScript(label, cli, args);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function getJson(path) {
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
  });
  const raw = await response.text();
  let data;
  try { data = JSON.parse(raw); }
  catch { throw new Error(`${path}: JSON 아님 (${response.status}) ${raw.slice(0, 200)}`); }
  if (!response.ok || data?.ok === false) {
    throw new Error(`${path}: ${data?.error || data?.message || `HTTP ${response.status}`}`);
  }
  return data;
}

async function postJson(path) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${TOKEN}`,
      'Cache-Control': 'no-cache',
    },
  });
  const raw = await response.text();
  let data;
  try { data = JSON.parse(raw); }
  catch { throw new Error(`${path}: JSON 아님 (${response.status}) ${raw.slice(0, 200)}`); }
  if (!response.ok || data?.ok === false) {
    throw new Error(`${path}: ${data?.error || data?.message || `HTTP ${response.status}`}`);
  }
  return data;
}

async function waitForServer(child, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    if (child.exitCode != null) throw new Error(`wrangler dev가 먼저 종료되었습니다 (exit=${child.exitCode})`);
    try {
      const r = await fetch(`${BASE_URL}/api/health`);
      if (r.ok) return;
      last = `HTTP ${r.status}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Local Worker 시작 시간 초과: ${last || 'unknown'}`);
}

console.log('\nPlugPark v0.7.1 LIVE DATA LOCAL VERIFY');
console.log('원칙: Remote Cloudflare write 0 · 실제 공공 API call 0 · fixture만 사용\n');

runNodeScript('현재 소스 baseline 저장', resolve('scripts', 'source-baseline.mjs'));

const tsc = resolveNodeBin(['typescript', 'bin', 'tsc']);
const vite = resolveNodeBin(['vite', 'bin', 'vite.js']);
runNodeScript('TypeScript build', tsc, ['-b']);
runNodeScript('Vite production build', vite, ['build']);

rmSync(STATE_DIR, { recursive: true, force: true });
await mkdir(resolve('.plugpark'), { recursive: true });

const migrationFiles = [
  resolve('migrations', '0001_v0_5_1_foundation.sql'),
  resolve('migrations', '0002_v0_6_0_read_models.sql'),
  resolve('migrations', '0003_v0_7_0_live_data.sql'),
  resolve('migrations', '0004_v0_7_1_parking_facility_catalog.sql'),
  resolve('migrations', '0005_v0_7_2_parking_match_rules.sql'),
  resolve('migrations', '0006_v0_8_0_typed_charger_availability.sql'),
];
for (const file of migrationFiles) assert(existsSync(file), `migration 없음: ${file}`);
assert(existsSync(FIXTURE_SQL), `fixture 없음: ${FIXTURE_SQL}`);

const combined = (await Promise.all(migrationFiles.map((p) => readFile(p, 'utf8')))).join('\n\n');
await writeFile(COMBINED_SCHEMA, combined, 'utf8');

runWrangler('Local D1 schema 생성', [
  'd1', 'execute', DB_NAME, '--local',
  `--file=${COMBINED_SCHEMA}`, `--persist-to=${STATE_DIR}`, '--yes',
]);
runWrangler('Local fixture seed', [
  'd1', 'execute', DB_NAME, '--local',
  `--file=${FIXTURE_SQL}`, `--persist-to=${STATE_DIR}`, '--yes',
]);

const wranglerCli = resolveNodeBin(['wrangler', 'bin', 'wrangler.js'], ['wrangler', 'bin', 'wrangler.cjs']);
const child = spawn(process.execPath, [
  wranglerCli, 'dev', '--local',
  '--port', String(PORT),
  `--persist-to=${STATE_DIR}`,
  '--var', 'LOCAL_FIXTURE_MODE:true',
  '--var', 'LIVE_SYNC_ENABLED:true',
  '--var', `INGEST_ADMIN_TOKEN:${TOKEN}`,
  '--var', 'MATCH_RADIUS_METERS:200',
], {
  cwd: ROOT,
  stdio: ['ignore', 'pipe', 'pipe'],
  shell: false,
  windowsHide: true,
  env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' },
});

let devLog = '';
child.stdout?.on('data', (buf) => {
  const s = buf.toString();
  devLog += s;
  if (process.env.PLUGPARK_VERBOSE_LOCAL === '1') process.stdout.write(s);
});
child.stderr?.on('data', (buf) => {
  const s = buf.toString();
  devLog += s;
  if (process.env.PLUGPARK_VERBOSE_LOCAL === '1') process.stderr.write(s);
});

try {
  process.stdout.write('Local Worker 시작 ... ');
  await waitForServer(child);
  console.log('PASS');

  const health = await getJson('/api/health?live=70');
  assert(health.dataLayerVersion === 'v0.7.1', `dataLayerVersion=${health.dataLayerVersion}`);
  assert(health.parkingMatchVersion === 'v0.7.2-P2', `parkingMatchVersion=${health.parkingMatchVersion}`);
  assert(health.liveSyncEnabled === true, 'liveSyncEnabled=true가 아님');
  console.log('v0.7.1 health ... PASS');

  for (const stage of ['stations', 'parking', 'matches']) {
    process.stdout.write(`Read model ${stage} ... `);
    await postJson(`/api/admin/d1/prepare-read-models?stage=${stage}`);
    console.log('PASS');
  }

  process.stdout.write('Fixture EV Status + Parking live sync ... ');
  const sync = await postJson('/api/admin/live-sync?kind=all&mode=incremental');
  assert(sync.ev?.apiCalls === 0, `fixture EV apiCalls=${sync.ev?.apiCalls}`);
  assert(sync.parking?.apiCalls === 0, `fixture parking apiCalls=${sync.parking?.apiCalls}`);
  assert(Number(sync.ev?.changed || 0) === 1, `EV changed 기대=1, 실제=${sync.ev?.changed}`);
  assert(Number(sync.parking?.matchedCount || 0) === 3, `parking matched 기대=3, 실제=${sync.parking?.matchedCount}`);
  assert(Number(sync.parking?.updatedCount || 0) === 3, `parking updated 기대=3, 실제=${sync.parking?.updatedCount}`);
  assert(Number(sync.parking?.invalidNumberCount || 0) === 2, `parking invalid 기대=2, 실제=${sync.parking?.invalidNumberCount}`);
  console.log('PASS');

  process.stdout.write('EV Status idempotence ... ');
  const evSecond = await postJson('/api/admin/live-sync?kind=ev&mode=incremental');
  assert(Number(evSecond.ev?.changed || 0) === 0, `두 번째 EV sync changed=${evSecond.ev?.changed}`);
  console.log('PASS');

  const liveState = await getJson('/api/d1/live-state?v=70');
  assert(liveState.userReadUpstreamCalls === 0, 'userReadUpstreamCalls가 0이 아님');
  assert(liveState.evStatus.status === 'complete', `ev status=${liveState.evStatus.status}`);
  assert(liveState.evStatus.coverageComplete === true, 'EV baseline coverageComplete=true가 아님');
  assert(liveState.parkingRealtime.status === 'complete', `parking status=${liveState.parkingRealtime.status}`);
  assert(liveState.parkingRealtime.itemCount === 3, `parking itemCount=${liveState.parkingRealtime.itemCount}`);
  assert(liveState.todayUsage.evStatus === 0, `fixture ev API usage=${liveState.todayUsage.evStatus}`);
  assert(liveState.todayUsage.parkingRealtime === 0, `fixture parking API usage=${liveState.todayUsage.parkingRealtime}`);
  console.log('Live state ... PASS · upstream fixture calls=0');

  const places = await getJson('/api/places?v=70');
  assert(places.dataLayerVersion === 'v0.7.1', `places version=${places.dataLayerVersion}`);
  assert(places.parkingMatchVersion === 'v0.7.2-P2', `places parkingMatchVersion=${places.parkingMatchVersion}`);
  assert(places.upstreamEvCalls === 0, `upstreamEvCalls=${places.upstreamEvCalls}`);
  assert(places.upstreamParkingCalls === 0, `upstreamParkingCalls=${places.upstreamParkingCalls}`);
  assert(places.realtimeParkingCount === 3, `realtimeParkingCount=${places.realtimeParkingCount}`);
  assert(places.realtimeParkingFresh === true, 'realtimeParkingFresh=true가 아님');
  assert(places.evStatusFresh === true, 'evStatusFresh=true가 아님');

  const centum = places.places.find((p) => String(p.name || '').includes('센텀'));
  assert(centum, '센텀 주차장 없음');
  assert(centum.availableParking === 35, `센텀 aggregate availableParking=${centum.availableParking}`);
  assert(centum.occupiedParking === 55, `센텀 aggregate occupiedParking=${centum.occupiedParking}`);
  assert(centum.capacity === 90, `센텀 aggregate capacity=${centum.capacity}`);
  assert(centum.parkingUpdatedAt === '2026-09-22 09:04:00', `센텀 conservative freshness=${centum.parkingUpdatedAt}`);
  assert(centum.parkingRealtime === true, '센텀 parkingRealtime=true가 아님');
  assert(centum.parkingRealtimeFresh === true, '센텀 realtime fresh=false');
  assert(centum.charger?.total === 2, `센텀 charger total=${centum.charger?.total}`);
  assert(centum.charger?.available === 1, `센텀 available charger=${centum.charger?.available}`);
  assert(centum.charger?.availableFast === 1, `센텀 availableFast=${centum.charger?.availableFast}`);
  assert(centum.charger?.availableSlow === 0, `센텀 availableSlow=${centum.charger?.availableSlow}`);
  assert(centum.charger?.availableFast + centum.charger?.availableSlow === centum.charger?.available, '센텀 typed availability 합계 불일치');
  assert(centum.charger?.charging === 1, `센텀 charging=${centum.charger?.charging}`);

  const citizen = places.places.find((p) => String(p.name || '').includes('시민공원'));
  assert(citizen, '시민공원 주차장 없음');
  assert(citizen.availableParking === 15, `시민공원 availableParking=${citizen.availableParking}`);
  assert(citizen.charger?.available === 1, `시민공원 available charger=${citizen.charger?.available}`);
  assert(citizen.charger?.availableFast === 1, `시민공원 availableFast=${citizen.charger?.availableFast}`);
  assert(citizen.charger?.availableSlow === 0, `시민공원 availableSlow=${citizen.charger?.availableSlow}`);
  assert(citizen.charger?.availableFast + citizen.charger?.availableSlow === citizen.charger?.available, '시민공원 typed availability 합계 불일치');
  assert(citizen.charger?.unavailable === 1, `시민공원 unavailable=${citizen.charger?.unavailable}`);

  const invalidProtected = places.places.find((p) => p.id === 'PARK003');
  assert(invalidProtected, 'invalid overwrite 보호 fixture PARK003 없음');
  assert(invalidProtected.availableParking === 7, `invalid overwrite available=${invalidProtected.availableParking}`);
  assert(invalidProtected.occupiedParking === 23, `invalid overwrite occupied=${invalidProtected.occupiedParking}`);
  assert(invalidProtected.capacity === 30, `invalid overwrite capacity=${invalidProtected.capacity}`);
  assert(invalidProtected.parkingUpdatedAt === '2026-09-22 08:00:00', `invalid overwrite timestamp=${invalidProtected.parkingUpdatedAt}`);
  console.log('/api/places D1-only live overlay ... PASS');

  const result = {
    verifiedAt: new Date().toISOString(),
    dataLayerVersion: 'v0.7.1',
    parkingMatchVersion: 'v0.7.2-P2',
    remoteWrites: 0,
    upstreamLiveCalls: 0,
    liveState,
    centum: {
      parkingAvailable: centum.availableParking,
      chargerAvailable: centum.charger.available,
      chargerCharging: centum.charger.charging,
    },
  };
  await writeFile(resolve('.plugpark', 'live-local-verify-result.json'), JSON.stringify(result, null, 2) + '\n', 'utf8');

  console.log('\n✅ LIVE LOCAL VERIFY: PASS');
  console.log('Cloudflare remote write: 0');
  console.log('실제 공공 API call: 0');
  console.log('다음 단계: read-only remote preflight 후 1회 release');
} catch (error) {
  await writeFile(resolve('.plugpark', 'live-local-wrangler.log'), devLog.slice(-20000), 'utf8').catch(() => {});
  console.error('\n❌ LIVE LOCAL VERIFY: FAIL');
  console.error(error instanceof Error ? error.message : String(error));
  console.error('로그: .plugpark/live-local-wrangler.log');
  process.exitCode = 1;
} finally {
  if (child.exitCode == null) {
    child.kill('SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (child.exitCode == null) child.kill('SIGKILL');
  }
}
