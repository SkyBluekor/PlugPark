import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const VERSION = 'v0.7.2-P2';
const DATA_LAYER_VERSION = 'v0.7.1';
const DB_NAME = 'plugpark-db';
const BASE_URL = process.env.PLUGPARK_URL || 'https://plugpark.dtdt4865.workers.dev';
const RESULT_FILE = resolve('.plugpark', 'v072-p2-release-result.json');
const PREFLIGHT_RESULT = resolve('.plugpark', 'v072-p2-preflight-result.json');

function fail(message) { throw new Error(message); }

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

function runNode(label, scriptPath, args = []) {
  console.log('\n' + label);
  const r = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: false,
    windowsHide: true,
    env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' },
  });
  if (r.error) throw r.error;
  if (r.status !== 0) fail(label + ' 실패 (exit=' + r.status + ')');
}

function runWranglerOnce(label, args) {
  console.log('\n' + label + ' · 자동 재시도 없음');
  const r = spawnSync(process.execPath, [findWranglerCli(), ...args], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: false,
    windowsHide: true,
    env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' },
  });
  if (r.error) throw r.error;
  if (r.status !== 0) fail(label + ' 실패/불명확. 같은 명령을 재실행하지 말고 remote state를 먼저 확인하세요. exit=' + r.status);
}

function wranglerJson(args) {
  const r = spawnSync(process.execPath, [findWranglerCli(), ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' },
  });
  if (r.error) throw r.error;
  if (r.status !== 0) {
    process.stderr.write(r.stderr || '');
    fail('Wrangler read-only query 실패 (exit=' + r.status + ')');
  }
  const raw = String(r.stdout || '').trim();
  try { return JSON.parse(raw); }
  catch {
    const start = raw.indexOf('[');
    if (start >= 0) {
      try { return JSON.parse(raw.slice(start)); } catch {}
    }
    fail('Wrangler JSON 출력 파싱 실패');
  }
}

function findRows(value) {
  if (Array.isArray(value)) {
    for (const item of value) {
      if (Array.isArray(item?.results)) return item.results;
      const nested = findRows(item);
      if (nested.length) return nested;
    }
  } else if (value && typeof value === 'object') {
    if (Array.isArray(value.results)) return value.results;
    for (const child of Object.values(value)) {
      const nested = findRows(child);
      if (nested.length) return nested;
    }
  }
  return [];
}

function queryRemote(sql) {
  const json = wranglerJson(['d1', 'execute', DB_NAME, '--remote', '--command', sql, '--json']);
  return findRows(json);
}

function parseEnvText(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    out[key] = value;
  }
  return out;
}

async function readDevVars() {
  const path = resolve('.dev.vars');
  if (!existsSync(path)) return {};
  return parseEnvText(await readFile(path, 'utf8'));
}

async function getJson(path) {
  const r = await fetch(BASE_URL + path, { headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' } });
  const raw = await r.text();
  let data;
  try { data = JSON.parse(raw); }
  catch { fail(path + ': JSON 응답 아님 (HTTP ' + r.status + ')'); }
  if (!r.ok || data?.ok === false) fail(path + ': ' + (data?.error || data?.message || ('HTTP ' + r.status)));
  return data;
}

async function postOnce(path, token, label) {
  process.stdout.write(label + ' (1회) ... ');
  let r;
  try {
    r = await fetch(BASE_URL + path, {
      method: 'POST',
      headers: { Accept: 'application/json', Authorization: 'Bearer ' + token, 'Cache-Control': 'no-cache' },
    });
  } catch (error) {
    console.log('FAIL');
    fail(label + ': ' + (error instanceof Error ? error.message : String(error)) + '\n자동 재POST하지 않았습니다.');
  }
  const raw = await r.text();
  let data;
  try { data = JSON.parse(raw); }
  catch {
    console.log('FAIL');
    fail(label + ': JSON 응답 아님 (HTTP ' + r.status + '). 자동 재POST하지 않았습니다.');
  }
  if (!r.ok || data?.ok === false) {
    console.log('FAIL');
    fail(label + ': ' + (data?.error || data?.message || ('HTTP ' + r.status)) + '\n자동 재POST하지 않았습니다.');
  }
  console.log('PASS');
  return data;
}

function gitHead() {
  const r = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8', shell: false, windowsHide: true });
  if (r.error || r.status !== 0) fail('git HEAD 확인 실패');
  return r.stdout.trim();
}

console.log('\nPlugPark ' + VERSION + ' SAFE REMOTE RELEASE');
console.log('local gates → read-only preflight → migration 1 command → rule reads → deploy 1 command → incremental sync/smoke');
console.log('금지: EV full backfill · 51-call audit · full reconcile · automatic retry\n');

runNode('1) LIVE LOCAL VERIFY', resolve('scripts', 'verify-live-local.mjs'));
runNode('2) P2 PARKING MATCH REPLAY', resolve('scripts', 'verify-parking-match-v072.mjs'));
runNode('3) P2 REMOTE PREFLIGHT (read-only)', resolve('scripts', 'preflight-v072-p2.mjs'));

if (!existsSync(PREFLIGHT_RESULT)) fail('P2 preflight receipt가 없습니다.');
const preflight = JSON.parse(await readFile(PREFLIGHT_RESULT, 'utf8'));
const releaseHead = gitHead();
if (preflight.version !== VERSION || preflight.gitHead !== releaseHead || preflight.remoteWrites !== 0) {
  fail('P2 preflight receipt가 현재 HEAD/release 조건과 일치하지 않습니다.');
}

runWranglerOnce('4) D1 migration remote', ['d1', 'migrations', 'apply', DB_NAME, '--remote']);

const countRows = queryRemote(
  "SELECT COUNT(*) AS rule_count, " +
  "SUM(CASE WHEN allow_aggregate=1 THEN 1 ELSE 0 END) AS aggregate_count, " +
  "SUM(CASE WHEN parking_code='A26' THEN 1 ELSE 0 END) AS a26_count, " +
  "SUM(CASE WHEN parking_code='A435' THEN 1 ELSE 0 END) AS a435_count " +
  "FROM parking_match_rules"
);
const counts = countRows[0] || {};
if (Number(counts.rule_count) !== 14) fail('remote parking_match_rules count=' + counts.rule_count);
if (Number(counts.aggregate_count) !== 4) fail('remote aggregate rule count=' + counts.aggregate_count);
if (Number(counts.a26_count) !== 0 || Number(counts.a435_count) !== 0) fail('remote forbidden rule detected');

const targetRows = queryRemote(
  "SELECT parking_code, parking_id, allow_aggregate FROM parking_match_rules " +
  "WHERE parking_code IN ('A41','A50','A43','A44') ORDER BY parking_code"
);
const targetMap = new Map(targetRows.map((row) => [String(row.parking_code), row]));
for (const code of ['A41', 'A50']) {
  const row = targetMap.get(code);
  if (!row || String(row.parking_id) !== '2019000002' || Number(row.allow_aggregate) !== 1) fail(code + ' remote aggregate rule mismatch');
}
for (const code of ['A43', 'A44']) {
  const row = targetMap.get(code);
  if (!row || String(row.parking_id) !== '2008011648' || Number(row.allow_aggregate) !== 1) fail(code + ' remote aggregate rule mismatch');
}
console.log('Remote P2 rules ... PASS · rules=14 · aggregate=4 · A26/A435=0');

runWranglerOnce('5) Worker deploy', ['deploy']);
const deployedAt = Date.now();

const health = await getJson('/api/health?v072-p2-release=1');
if (health.dataLayerVersion !== DATA_LAYER_VERSION) fail('deployed dataLayerVersion=' + health.dataLayerVersion);
if (health.parkingMatchVersion !== VERSION) fail('deployed parkingMatchVersion=' + health.parkingMatchVersion);
if (!health.realtimeParkingUrlConfigured || !health.d1Configured) fail('배포 후 D1/Parking endpoint config 불일치');
console.log('Worker identity ... PASS · ' + VERSION);

const devVars = await readDevVars();
const token = String(process.env.PLUGPARK_INGEST_TOKEN || devVars.INGEST_ADMIN_TOKEN || '').trim();
let ev = null;
let parking = null;
let live = null;

if (token) {
  ev = await postOnce('/api/admin/live-sync?kind=ev&mode=incremental', token, 'EV Status incremental sync');
  parking = await postOnce('/api/admin/live-sync?kind=parking&mode=incremental', token, 'Parking realtime incremental sync');
  live = await getJson('/api/d1/live-state?v072-p2-release=1');
} else {
  console.log('Local ingest token 없음 · Remote secret 변경 없이 Cron 결과만 확인합니다.');
  const deadline = Date.now() + 12 * 60_000;
  while (Date.now() < deadline) {
    live = await getJson('/api/d1/live-state?v072-p2-release-cron=1');
    const evMs = live?.evStatus?.lastSuccessAt ? Date.parse(live.evStatus.lastSuccessAt) : Number.NaN;
    const parkingMs = live?.parkingRealtime?.lastSuccessAt ? Date.parse(live.parkingRealtime.lastSuccessAt) : Number.NaN;
    const evRan = Number.isFinite(evMs) && evMs >= deployedAt - 30_000;
    const parkingRan = Number.isFinite(parkingMs) && parkingMs >= deployedAt - 30_000;
    process.stdout.write('Cron sync ... EV=' + (evRan ? 'PASS' : 'pending') + ' · Parking=' + (parkingRan ? 'PASS' : 'pending') + '\r');
    if (evRan && parkingRan) {
      process.stdout.write('\n');
      break;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 20_000));
  }
  if (!live) fail('배포 후 live-state 확인 실패');
  const evMs = live.evStatus?.lastSuccessAt ? Date.parse(live.evStatus.lastSuccessAt) : Number.NaN;
  const parkingMs = live.parkingRealtime?.lastSuccessAt ? Date.parse(live.parkingRealtime.lastSuccessAt) : Number.NaN;
  if (!Number.isFinite(evMs) || evMs < deployedAt - 30_000) fail('12분 내 EV Cron sync 확인 실패 · 자동 POST하지 않음');
  if (!Number.isFinite(parkingMs) || parkingMs < deployedAt - 30_000) fail('12분 내 Parking Cron sync 확인 실패 · 자동 POST하지 않음');
  ev = { mode: 'cron', lastSuccessAt: live.evStatus.lastSuccessAt };
  parking = { mode: 'cron', lastSuccessAt: live.parkingRealtime.lastSuccessAt };
}

const places = await getJson('/api/places?v072-p2-release=1');
if (places.parkingMatchVersion !== VERSION) fail('/api/places parkingMatchVersion=' + places.parkingMatchVersion);
if (Number(places.upstreamEvCalls) !== 0 || Number(places.upstreamParkingCalls) !== 0) fail('/api/places upstream call detected');
if (live.evStatus.status !== 'complete' || live.evStatus.coverageComplete !== true) fail('EV live state incomplete');
if (live.parkingRealtime.status !== 'complete') fail('Parking live state=' + live.parkingRealtime.status);

const result = {
  releaseVersion: VERSION,
  gitCommit: releaseHead,
  releasedAt: new Date().toISOString(),
  preflightPassed: true,
  localVerifyPassed: true,
  replayVerifyPassed: true,
  migrationCommands: 1,
  deployCalls: 1,
  manualEvSyncCalls: token ? 1 : 0,
  manualParkingSyncCalls: token ? 1 : 0,
  syncTrigger: token ? 'admin-post' : 'cron',
  parkingMatchRuleCount: Number(counts.rule_count),
  aggregateRuleCount: Number(counts.aggregate_count),
  parkingStatus: live.parkingRealtime.status,
  evStatus: live.evStatus.status,
  placesCount: Array.isArray(places.places) ? places.places.length : 0,
  upstreamEvCalls: Number(places.upstreamEvCalls),
  upstreamParkingCalls: Number(places.upstreamParkingCalls),
  remoteMigrationApplied: true,
  workerVersionVerified: true,
  publicParkingFullAuditCalls: 0,
  evFullBackfillCalls: 0,
  ev,
  parking,
};
await mkdir(resolve('.plugpark'), { recursive: true });
await writeFile(RESULT_FILE, JSON.stringify(result, null, 2) + '\n', 'utf8');

console.log('\n✅ ' + VERSION + ' REMOTE RELEASE: PASS');
console.log('migrationCommands=1 · deployCalls=1 · full audit=0 · EV backfill=0');
console.log('/api/places upstream EV=0 · Parking=0');
