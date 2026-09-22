import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const BASE_URL = process.env.PLUGPARK_URL || 'https://plugpark.dtdt4865.workers.dev';
const RESULT_FILE = resolve('.plugpark', 'live-remote-release-result.json');

function findBin(...candidates) {
  for (const candidate of candidates) {
    const full = resolve('node_modules', ...candidate);
    if (existsSync(full)) return full;
  }
  throw new Error(`실행 파일을 찾지 못했습니다: ${candidates.map((x) => x.join('/')).join(', ')}`);
}

function runNode(label, script, args = []) {
  console.log(`\n${label}`);
  const r = spawnSync(process.execPath, [script, ...args], {
    cwd: ROOT, stdio: 'inherit', shell: false, windowsHide: true,
    env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' },
  });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`${label} 실패 (exit=${r.status})`);
}

function runWrangler(label, args) {
  const cli = findBin(['wrangler', 'bin', 'wrangler.js'], ['wrangler', 'bin', 'wrangler.cjs']);
  runNode(label, cli, args);
}

async function getJson(path) {
  const r = await fetch(`${BASE_URL}${path}`, { headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' } });
  const raw = await r.text();
  let data;
  try { data = JSON.parse(raw); }
  catch { throw new Error(`${path}: JSON 응답이 아닙니다 (HTTP ${r.status})`); }
  if (!r.ok || data?.ok === false) throw new Error(`${path}: ${data?.error || data?.message || `HTTP ${r.status}`}`);
  return data;
}

async function postOnce(path, token, label) {
  process.stdout.write(`${label} (1회) ... `);
  let r;
  try {
    r = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, 'Cache-Control': 'no-cache' },
    });
  } catch (error) {
    console.log('FAIL');
    throw new Error(`${label}: ${error instanceof Error ? error.message : String(error)}\n자동 재시도하지 않았습니다.`);
  }
  const raw = await r.text();
  let data;
  try { data = JSON.parse(raw); }
  catch {
    console.log('FAIL');
    throw new Error(`${label}: JSON 응답 아님 (HTTP ${r.status}). 자동 재시도하지 않았습니다.`);
  }
  if (!r.ok || data?.ok === false) {
    console.log('FAIL');
    throw new Error(`${label}: ${data?.error || data?.message || `HTTP ${r.status}`}\n자동 재시도하지 않았습니다.`);
  }
  console.log('PASS');
  return data;
}

console.log('\nPlugPark v0.7.0 LIVE SAFE RELEASE');
console.log('Local PASS → read-only preflight → migration 1회 → deploy 1회 → live sync 각 1회 → smoke\n');

runNode('1) LIVE LOCAL VERIFY', resolve('scripts', 'verify-live-local.mjs'));
runNode('2) LIVE REMOTE PREFLIGHT (read-only)', resolve('scripts', 'live-remote-preflight.mjs'));

let token = String(process.env.PLUGPARK_INGEST_TOKEN || '').trim();
if (!token) {
  const rl = createInterface({ input, output });
  token = String(await rl.question('PLUGPARK_INGEST_TOKEN을 입력하세요: ')).trim();
  rl.close();
}
if (!token) throw new Error('PLUGPARK_INGEST_TOKEN이 필요합니다.');

runWrangler('3) D1 migration remote (1회)', ['d1', 'migrations', 'apply', 'plugpark-db', '--remote']);
runWrangler('4) Worker deploy + 5분 Cron 활성화 (1회)', ['deploy']);

const health = await getJson('/api/health?live-release=70');
if (health.dataLayerVersion !== 'v0.7.0') throw new Error(`배포 버전=${health.dataLayerVersion}`);
console.log('배포 확인 ... PASS · v0.7.0');

const ev = await postOnce('/api/admin/live-sync?kind=ev&mode=incremental', token, 'EV Status incremental sync');
let parking = { skipped: true, reason: 'REALTIME_PARKING_URL_NOT_CONFIGURED' };
if (health.realtimeParkingUrlConfigured) {
  parking = await postOnce('/api/admin/live-sync?kind=parking&mode=incremental', token, 'Parking realtime sync');
} else {
  console.log('Parking realtime sync ... SKIP · BUSAN_REALTIME_PARKING_API_URL 미설정');
}

const live = await getJson('/api/d1/live-state?live-release=70');
const places = await getJson('/api/places?live-release=70');
if (places.upstreamEvCalls !== 0 || places.upstreamParkingCalls !== 0) {
  throw new Error(`사용자 read path upstream 호출 감지: EV=${places.upstreamEvCalls}, Parking=${places.upstreamParkingCalls}`);
}
if (live.evStatus.status !== 'complete') throw new Error(`evStatus=${live.evStatus.status}`);
if (health.realtimeParkingUrlConfigured && live.parkingRealtime.status !== 'complete') {
  throw new Error(`parkingRealtime=${live.parkingRealtime.status}`);
}

const result = {
  releasedAt: new Date().toISOString(),
  version: 'v0.7.0',
  remoteMigrationCalls: 1,
  deployCalls: 1,
  evSyncCalls: 1,
  parkingSyncCalls: health.realtimeParkingUrlConfigured ? 1 : 0,
  realtimeParkingConfigured: health.realtimeParkingUrlConfigured,
  ev,
  parking,
  live,
  placesCount: places.places?.length || 0,
  userReadUpstreamCalls: {
    ev: places.upstreamEvCalls,
    parking: places.upstreamParkingCalls,
  },
};
await writeFile(RESULT_FILE, JSON.stringify(result, null, 2) + '\n', 'utf8');

console.log('\n✅ LIVE REMOTE RELEASE: PASS');
console.log(`EV Status rows=${live.evStatus.storedRows} · fresh=${live.evStatus.fresh}`);
if (health.realtimeParkingUrlConfigured) {
  console.log(`Parking realtime=${live.parkingRealtime.itemCount}곳 · fresh=${live.parkingRealtime.fresh}`);
} else {
  console.log('Parking realtime=URL 미설정으로 SKIP');
}
console.log('사용자 /api/places upstream call=0');
