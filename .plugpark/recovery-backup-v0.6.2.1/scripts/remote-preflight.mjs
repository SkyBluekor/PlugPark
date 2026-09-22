import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const BASE_URL = process.env.PLUGPARK_URL || 'https://plugpark.dtdt4865.workers.dev';
const EXPECTED_LOCAL_VERSION = 'v0.6.2.1';
const LOCAL_RESULT = resolve('.plugpark', 'local-verify-result.json');
const BASELINE_FILE = resolve('.plugpark', 'source-baseline.json');

const critical = [
  'package.json',
  'worker/index.ts',
  'src/App.tsx',
  'src/types.ts',
  'migrations/0001_v0_5_1_foundation.sql',
  'migrations/0002_v0_6_0_read_models.sql',
];

function fail(message) {
  throw new Error(message);
}

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
  const cli = findWranglerCli();
  const r = spawnSync(process.execPath, [cli, 'whoami'], {
    cwd: ROOT,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' },
  });
  if (r.error) throw r.error;
  if (r.status !== 0) {
    process.stderr.write(r.stderr || '');
    fail(`wrangler whoami 실패 (exit=${r.status})`);
  }
}

console.log('\nPlugPark v0.6.2.1 REMOTE PREFLIGHT');
console.log('※ 이 단계는 remote write를 수행하지 않습니다.\n');

if (!existsSync(LOCAL_RESULT)) fail('local-verify-result.json이 없습니다. npm run verify:local을 먼저 통과해야 합니다.');
if (!existsSync(BASELINE_FILE)) fail('source-baseline.json이 없습니다. npm run verify:local을 먼저 통과해야 합니다.');

const local = JSON.parse(await readFile(LOCAL_RESULT, 'utf8'));
if (local.remoteWrites !== 0) fail(`로컬 검증 remoteWrites=${local.remoteWrites}; 기대값 0`);
if (local.upstreamEvCalls !== 0) fail(`로컬 검증 upstreamEvCalls=${local.upstreamEvCalls}; 기대값 0`);
if (local.state?.ready !== true) fail('로컬 read model ready=true가 아닙니다.');
if (local.state?.dataLayerVersion !== EXPECTED_LOCAL_VERSION) {
  fail(`로컬 검증 버전=${local.state?.dataLayerVersion}; 기대=${EXPECTED_LOCAL_VERSION}`);
}
console.log('LOCAL VERIFY 결과 ... PASS');

const baseline = JSON.parse(await readFile(BASELINE_FILE, 'utf8'));
for (const rel of critical) {
  const expected = baseline.files?.[rel];
  if (!expected) continue;
  const current = await sha256(resolve(rel));
  if (current !== expected) {
    fail(`LOCAL VERIFY 후 소스가 변경됐습니다: ${rel}\n다시 npm run verify:local을 실행하세요.`);
  }
}
console.log('검증 이후 소스 변경 없음 ... PASS');

wranglerWhoami();
console.log('Cloudflare 인증 ... PASS');

const health = await getJson('/api/health?preflight=62');
if (!health.d1Configured) fail('Remote Worker에 D1 binding DB가 없습니다.');
if (!health.parkingSecretConfigured) fail('BUSAN_PARKING_API_KEY가 Remote Worker에 없습니다.');
if (!health.ingestAdminTokenConfigured) fail('INGEST_ADMIN_TOKEN이 Remote Worker에 없습니다.');
console.log(`Remote health ... PASS · deployed=${health.dataLayerVersion}`);

const ev = await getJson('/api/d1/ev-info-state?preflight=62');
if (ev.state?.status !== 'complete') fail(`EV Info 상태가 complete가 아닙니다: ${ev.state?.status}`);
if (Number(ev.stored?.chargerCount || 0) < 30000) {
  fail(`EV chargerCount가 비정상적으로 작습니다: ${ev.stored?.chargerCount}`);
}
console.log(`EV Info remote ... PASS · chargers=${ev.stored.chargerCount} · stations=${ev.stored.stationCount}`);

console.log('\n주의: Cloudflare는 현재 남은 일일 D1 write quota를 이 스크립트에 제공하지 않습니다.');
console.log('release 단계는 각 write stage를 딱 1회만 실행하며, quota/auth/network 오류에서 자동 재POST하지 않습니다.');
console.log('\n✅ REMOTE PREFLIGHT: PASS');
