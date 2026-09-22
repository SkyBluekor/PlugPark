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
const PARKING_CONFIG_FILE = resolve('.plugpark', 'parking-api-config.json');

const critical = [
  'package.json',
  'worker/index.ts',
  'src/App.tsx',
  'src/types.ts',
  'migrations/0001_v0_5_1_foundation.sql',
  'migrations/0002_v0_6_0_read_models.sql',
  'migrations/0003_v0_7_0_live_data.sql',
  'scripts/verify-live-local.mjs',
  'scripts/live-remote-preflight.mjs',
  'scripts/release-live.mjs',
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
if (parkingProbe.ok !== true || Number(parkingProbe.publicApiCalls || 0) !== 1 || Number(parkingProbe.remoteD1Writes || 0) !== 0) {
  fail('Parking API probe 결과가 PASS가 아닙니다. 실제 요청주소/필드 계약을 먼저 확인하세요.');
}
console.log('Parking API contract probe ... PASS · 실제 API 1회 · D1 write 0');

if (!existsSync(PARKING_CONFIG_FILE)) {
  fail('parking-api-config.json이 없습니다. npm run configure:parking-api로 probe한 URL을 Remote Worker에 먼저 설정하세요.');
}
const parkingConfig = JSON.parse(await readFile(PARKING_CONFIG_FILE, 'utf8'));
if (parkingConfig.endpointHash !== parkingProbe.endpointHash || Number(parkingConfig.remoteD1Writes || 0) !== 0) {
  fail('Parking API remote 설정이 현재 probe 결과와 일치하지 않습니다. npm run configure:parking-api를 다시 실행하세요.');
}
console.log('Parking API remote config receipt ... PASS');

if (health.realtimeParkingUrlConfigured) {
  console.log('현재 Remote Worker 실시간 주차 URL ... CONFIGURED');
} else {
  console.log('현재 Remote Worker 실시간 주차 URL ... NOT CONFIGURED');
  console.log('  → probe는 통과했지만 release 전에 Cloudflare Worker 변수/secret 설정이 필요합니다.');
}

console.log('\n✅ LIVE REMOTE PREFLIGHT: PASS');
console.log('Remote write: 0');
