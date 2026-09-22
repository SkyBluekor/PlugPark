import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const BASE_URL = process.env.PLUGPARK_URL || 'https://plugpark.dtdt4865.workers.dev';
const LOCAL_RESULT = resolve('.plugpark', 'live-local-verify-result.json');
const BASELINE_FILE = resolve('.plugpark', 'source-baseline.json');
const PARKING_PROBE_FILE = resolve('.plugpark', 'parking-api-probe.json');

const critical = [
  'package.json',
  'worker/index.ts',
  'src/App.tsx',
  'src/types.ts',
  'migrations/0001_v0_5_1_foundation.sql',
  'migrations/0002_v0_6_0_read_models.sql',
  'migrations/0003_v0_7_0_live_data.sql',
  'migrations/0004_v0_7_1_parking_facility_catalog.sql',
  'scripts/verify-live-local.mjs',
  'scripts/prepare-live-release.mjs',
  'scripts/probe-parking-api.mjs',
  'scripts/live-remote-preflight.mjs',
  'scripts/release-live.mjs',
  'tests/contracts/busan-facilities-parking.contract.json',
];

function fail(message) { throw new Error(message); }

async function sha256(path) {
  const data = await readFile(path);
  return createHash('sha256').update(data).digest('hex');
}

async function getJson(path) {
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
  });
  const raw = await response.text();
  let data;
  try { data = JSON.parse(raw); }
  catch { fail(`${path}: JSON 응답이 아닙니다 (HTTP ${response.status})`); }
  if (!response.ok || data?.ok === false) {
    fail(`${path}: ${data?.error || data?.message || `HTTP ${response.status}`}`);
  }
  return data;
}

function findWranglerCli() {
  for (const rel of [
    ['node_modules', 'wrangler', 'bin', 'wrangler.js'],
    ['node_modules', 'wrangler', 'bin', 'wrangler.cjs'],
  ]) {
    const full = resolve(...rel);
    if (existsSync(full)) return full;
  }
  fail('로컬 Wrangler CLI를 찾지 못했습니다. npm install 상태를 확인하세요.');
}

function wranglerWhoami() {
  const r = spawnSync(process.execPath, [findWranglerCli(), 'whoami'], {
    cwd: ROOT, encoding: 'utf8', shell: false, windowsHide: true,
    env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' },
  });
  if (r.error) throw r.error;
  if (r.status !== 0) {
    process.stderr.write(r.stderr || '');
    fail(`wrangler whoami 실패 (exit=${r.status})`);
  }
}

console.log('\nPlugPark v0.7.1 LIVE REMOTE PREFLIGHT');
console.log('※ read-only 검사입니다. Remote D1 write/API sync를 수행하지 않습니다.\n');

if (!existsSync(LOCAL_RESULT)) fail('live-local-verify-result.json이 없습니다. npm run verify:live-local을 먼저 통과하세요.');
if (!existsSync(BASELINE_FILE)) fail('source-baseline.json이 없습니다. npm run verify:live-local을 먼저 통과하세요.');

const local = JSON.parse(await readFile(LOCAL_RESULT, 'utf8'));
if (local.dataLayerVersion !== 'v0.7.1') fail(`local version=${local.dataLayerVersion}`);
if (local.remoteWrites !== 0) fail(`local remoteWrites=${local.remoteWrites}`);
if (local.upstreamLiveCalls !== 0) fail(`local upstreamLiveCalls=${local.upstreamLiveCalls}`);
console.log('LIVE LOCAL VERIFY 결과 ... PASS');

const baseline = JSON.parse(await readFile(BASELINE_FILE, 'utf8'));
for (const rel of critical) {
  const expected = baseline.files?.[rel];
  if (!expected || !existsSync(resolve(rel))) continue;
  const current = await sha256(resolve(rel));
  if (current !== expected) {
    fail(`LOCAL VERIFY 후 소스가 변경됐습니다: ${rel}\n다시 npm run verify:live-local을 실행하세요.`);
  }
}
console.log('검증 이후 소스 변경 없음 ... PASS');

wranglerWhoami();
console.log('Cloudflare 인증 ... PASS');

const health = await getJson('/api/health?live-preflight=70');
if (!health.d1Configured) fail('Remote D1 binding이 없습니다.');
if (!health.evSecretConfigured) fail('EV_CHARGER_API_KEY가 없습니다.');
if (!health.parkingSecretConfigured) fail('BUSAN_PARKING_API_KEY가 없습니다.');
if (!health.ingestAdminTokenConfigured) fail('INGEST_ADMIN_TOKEN이 없습니다.');
console.log(`Remote health ... PASS · currently deployed=${health.dataLayerVersion}`);

const evInfo = await getJson('/api/d1/ev-info-state?live-preflight=70');
if (evInfo.state?.status !== 'complete') fail(`EV Info status=${evInfo.state?.status}`);
if (Number(evInfo.stored?.chargerCount || 0) < 30000) fail(`EV chargerCount=${evInfo.stored?.chargerCount}`);
console.log(`EV Info ... PASS · chargers=${evInfo.stored.chargerCount}`);

const readModel = await getJson('/api/d1/read-model-state?live-preflight=70');
if (readModel.ready !== true) fail('기존 v0.6 read model ready=true가 아닙니다.');
console.log(`v0.6 read model ... PASS · parking=${readModel.parkingCount} · stations=${readModel.stationCount}`);

if (!existsSync(PARKING_PROBE_FILE)) {
  fail('parking-api-probe.json이 없습니다. npm run probe:parking-api를 1회 실행해 실제 API 계약을 확인하세요.');
}
const parkingProbe = JSON.parse(await readFile(PARKING_PROBE_FILE, 'utf8'));
if (
  parkingProbe.ok !== true ||
  parkingProbe.releaseReady !== true ||
  parkingProbe.runtimeAdapterReady !== true ||
  Number(parkingProbe.publicApiCalls || 0) !== 2 ||
  Number(parkingProbe.remoteD1Writes || 0) !== 0
) {
  fail('Parking API probe가 release-ready PASS가 아닙니다. 단건 필터/부분 페이지 여부를 먼저 해결하세요.');
}
console.log('Parking API contract probe ... PASS · 실제 API 2회 · D1 write 0');

const wranglerText = await readFile(resolve('wrangler.toml'), 'utf8');
if (!wranglerText.includes('https://apis.data.go.kr/B552587/ParkingInfoService_v2')) {
  fail('wrangler.toml에 부산시설공단 ParkingInfoService_v2 public endpoint가 없습니다.');
}
console.log('Parking API public endpoint config ... PASS · deploy 시 [vars]로 적용');

if (health.realtimeParkingUrlConfigured) {
  console.log('현재 배포본 Parking URL ... CONFIGURED');
} else {
  console.log('현재 배포본 Parking URL ... 아직 미설정 · 새 deploy에서 [vars]로 적용 예정');
}

console.log('\n✅ LIVE REMOTE PREFLIGHT: PASS');
console.log('Remote write: 0');
