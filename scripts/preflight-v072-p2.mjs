import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const VERSION = 'v0.7.2-P2';
const DATA_LAYER_VERSION = 'v0.7.1';
const BASE_URL = process.env.PLUGPARK_URL || 'https://plugpark.dtdt4865.workers.dev';
const LOCAL_RESULT = resolve('.plugpark', 'live-local-verify-result.json');
const MATCH_RESULT = resolve('.plugpark', 'parking-match-v072-verify-result.json');
const BASELINE_FILE = resolve('.plugpark', 'source-baseline.json');
const PARKING_PROBE_FILE = resolve('.plugpark', 'parking-api-probe.json');
const RESULT_FILE = resolve('.plugpark', 'v072-p2-preflight-result.json');

const critical = [
  'package.json',
  'wrangler.toml',
  '.github/workflows/v071-local-verify.yml',
  'worker/index.ts',
  'src/App.tsx',
  'src/types.ts',
  'migrations/0001_v0_5_1_foundation.sql',
  'migrations/0002_v0_6_0_read_models.sql',
  'migrations/0003_v0_7_0_live_data.sql',
  'migrations/0004_v0_7_1_parking_facility_catalog.sql',
  'migrations/0005_v0_7_2_parking_match_rules.sql',
  'scripts/verify-live-local.mjs',
  'scripts/verify-parking-match-v072.mjs',
  'scripts/verify-release-v072-p2.mjs',
  'scripts/verify-d1-read-budget-v072.mjs',
  'scripts/preflight-v072-p2.mjs',
  'scripts/release-v072-p2.mjs',
  'tests/fixtures/parking-realtime-coverage-v072-replay.json',
  'tests/fixtures/local-recovery-seed.sql',
  'scripts/probe-parking-api.mjs',
  'tests/contracts/busan-facilities-parking.contract.json',
];

function fail(message) { throw new Error(message); }

async function readJson(path, label) {
  if (!existsSync(path)) fail(label + ' 파일이 없습니다: ' + path);
  return JSON.parse(await readFile(path, 'utf8'));
}

async function sha256(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

function git(args) {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', shell: false, windowsHide: true });
  if (r.error) throw r.error;
  if (r.status !== 0) fail('git ' + args.join(' ') + ' 실패');
  return r.stdout.trim();
}

function findWranglerCli() {
  for (const rel of [
    ['node_modules', 'wrangler', 'bin', 'wrangler.js'],
    ['node_modules', 'wrangler', 'bin', 'wrangler.cjs'],
  ]) {
    const full = resolve(...rel);
    if (existsSync(full)) return full;
  }
  fail('Wrangler CLI를 찾지 못했습니다. npm install 상태를 확인하세요.');
}

function wranglerWhoami() {
  const r = spawnSync(process.execPath, [findWranglerCli(), 'whoami'], {
    cwd: ROOT,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' },
  });
  if (r.error) throw r.error;
  if (r.status !== 0) {
    process.stderr.write(r.stderr || '');
    fail('wrangler whoami 실패 (exit=' + r.status + ')');
  }
}

async function getJson(path) {
  const response = await fetch(BASE_URL + path, {
    headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
  });
  const raw = await response.text();
  let data;
  try { data = JSON.parse(raw); }
  catch { fail(path + ': JSON 응답이 아닙니다 (HTTP ' + response.status + ')'); }
  if (!response.ok || data?.ok === false) {
    fail(path + ': ' + (data?.error || data?.message || ('HTTP ' + response.status)));
  }
  return data;
}

console.log('\nPlugPark ' + VERSION + ' REMOTE PREFLIGHT');
console.log('read-only only · Remote D1 write 0 · public parking full audit 0\n');

const local = await readJson(LOCAL_RESULT, 'LIVE LOCAL VERIFY receipt');
if (local.dataLayerVersion !== DATA_LAYER_VERSION) fail('local dataLayerVersion=' + local.dataLayerVersion);
if (local.parkingMatchVersion !== VERSION) fail('local parkingMatchVersion=' + local.parkingMatchVersion);
if (Number(local.remoteWrites) !== 0) fail('local remoteWrites=' + local.remoteWrites);
if (Number(local.upstreamLiveCalls) !== 0) fail('local upstreamLiveCalls=' + local.upstreamLiveCalls);
console.log('LIVE LOCAL receipt ... PASS');

const match = await readJson(MATCH_RESULT, 'P2 replay receipt');
if (match.version !== VERSION || match.passed !== true) fail('P2 replay receipt version/pass 불일치');
if (Number(match.publicApiCalls) !== 0 || Number(match.remoteD1Writes) !== 0) fail('P2 replay가 remote/public call 0 조건을 위반했습니다.');
if (Number(match.productionRuleCount) !== 14) fail('productionRuleCount=' + match.productionRuleCount);
if (Number(match.aggregateRuleCount) !== 4) fail('aggregateRuleCount=' + match.aggregateRuleCount);
if (Number(match.legacyRegressionCount) !== 0) fail('legacyRegressionCount=' + match.legacyRegressionCount);
if (Number(match.duplicateOverwriteCount) !== 0) fail('duplicateOverwriteCount=' + match.duplicateOverwriteCount);
console.log('P2 replay receipt ... PASS');

const baseline = await readJson(BASELINE_FILE, 'source baseline');
const currentHead = git(['rev-parse', 'HEAD']);
const currentBranch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
const currentStatus = git(['status', '--short']);
if (currentStatus) fail('release 전에 git working tree가 깨끗해야 합니다:\n' + currentStatus);
if (baseline.gitHead && baseline.gitHead !== currentHead) fail('baseline gitHead=' + baseline.gitHead + ' current=' + currentHead);

for (const rel of critical) {
  const expected = baseline.files?.[rel];
  if (!expected) fail('baseline hash 누락: ' + rel);
  if (!existsSync(resolve(rel))) fail('critical source 없음: ' + rel);
  const current = await sha256(resolve(rel));
  if (current !== expected) fail('LOCAL VERIFY 이후 source 변경: ' + rel);
}
console.log('Source integrity ... PASS · git=' + currentHead.slice(0, 12));

wranglerWhoami();
console.log('Cloudflare auth ... PASS');

const health = await getJson('/api/health?v072-p2-preflight=1');
if (!health.d1Configured) fail('Remote D1 binding 없음');
if (!health.evSecretConfigured) fail('EV_CHARGER_API_KEY 없음');
if (!health.parkingSecretConfigured) fail('BUSAN_PARKING_API_KEY 없음');
if (!health.ingestAdminTokenConfigured) fail('INGEST_ADMIN_TOKEN 없음');
console.log('Remote health ... PASS · deployed data layer=' + health.dataLayerVersion);

const evInfo = await getJson('/api/d1/ev-info-state?v072-p2-preflight=1');
if (evInfo.state?.status !== 'complete') fail('EV Info status=' + evInfo.state?.status);
if (Number(evInfo.stored?.chargerCount || 0) < 30000) fail('EV chargerCount=' + evInfo.stored?.chargerCount);
console.log('EV baseline ... PASS · chargers=' + evInfo.stored.chargerCount);

const readModel = await getJson('/api/d1/read-model-state?v072-p2-preflight=1');
if (readModel.ready !== true) fail('read model ready=true가 아님');
console.log('Read model ... PASS · parking=' + readModel.parkingCount + ' · stations=' + readModel.stationCount);

const places = await getJson('/api/places?v072-p2-preflight=1');
if (Number(places.upstreamEvCalls) !== 0 || Number(places.upstreamParkingCalls) !== 0) {
  fail('현재 production user read upstream 호출 감지');
}
console.log('Production /api/places upstream ... PASS · 0/0');

const probe = await readJson(PARKING_PROBE_FILE, 'Parking API probe receipt');
if (probe.ok !== true || probe.releaseReady !== true || probe.runtimeAdapterReady !== true) fail('Parking probe release-ready가 아닙니다.');
if (Number(probe.publicApiCalls) !== 2 || Number(probe.remoteD1Writes) !== 0) fail('Parking probe call/write count 불일치');
console.log('Parking API probe receipt ... PASS · public calls=2 · remote write=0');

const wranglerText = await readFile(resolve('wrangler.toml'), 'utf8');
if (!wranglerText.includes('https://apis.data.go.kr/B552587/ParkingInfoService_v2')) fail('ParkingInfoService_v2 endpoint가 wrangler.toml에 없습니다.');
if (!wranglerText.includes('crons = ["*/5 * * * *"]')) fail('5분 parking Cron 설정을 확인할 수 없습니다.');
console.log('Wrangler config ... PASS');

const result = {
  verifiedAt: new Date().toISOString(),
  version: VERSION,
  dataLayerVersion: DATA_LAYER_VERSION,
  gitHead: currentHead,
  gitBranch: currentBranch,
  sourceIntegrity: true,
  localVerifyPassed: true,
  replayVerifyPassed: true,
  productionReadUpstreamCalls: { ev: 0, parking: 0 },
  remoteWrites: 0,
  publicParkingFullAuditCalls: 0,
  parkingProbeCallsReused: 2,
  currentlyDeployed: {
    dataLayerVersion: health.dataLayerVersion,
    parkingMatchVersion: health.parkingMatchVersion || null,
  },
};
await mkdir(resolve('.plugpark'), { recursive: true });
await writeFile(RESULT_FILE, JSON.stringify(result, null, 2) + '\n', 'utf8');

console.log('\n✅ ' + VERSION + ' REMOTE PREFLIGHT: PASS');
console.log('Remote D1 write=0 · Worker deploy=0 · public 51-call audit=0');
