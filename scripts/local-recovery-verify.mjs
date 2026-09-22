import { spawn, spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const DB_NAME = 'plugpark-db';
const PORT = Number(process.env.PLUGPARK_LOCAL_PORT || 8799);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const TOKEN = 'plugpark-local-recovery-token';
const STATE_DIR = resolve('.plugpark', 'local-verify-state');
const COMBINED_SCHEMA = resolve('.plugpark', 'local-schema.sql');
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

async function getJson(path) {
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
  });
  const raw = await response.text();
  let data;
  try { data = JSON.parse(raw); } catch { throw new Error(`${path}: JSON 아님 (${response.status}) ${raw.slice(0, 200)}`); }
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
    },
  });
  const raw = await response.text();
  let data;
  try { data = JSON.parse(raw); } catch { throw new Error(`${path}: JSON 아님 (${response.status}) ${raw.slice(0, 200)}`); }
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
      const r = await fetch(`${BASE_URL}/api/health`, { headers: { Accept: 'application/json' } });
      if (r.ok) return;
      last = `HTTP ${r.status}`;
    } catch (e) {
      last = e instanceof Error ? e.message : String(e);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`로컬 Worker 시작 대기 시간 초과: ${last || 'unknown'}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

console.log('\nPlugPark v0.6.2.1 LOCAL-FIRST VERIFY');
console.log('Remote Cloudflare/D1 write는 수행하지 않습니다.\n');

runNodeScript(
  '현재 소스 baseline 저장',
  resolve('scripts', 'source-baseline.mjs'),
);

const tsc = resolveNodeBin(['typescript', 'bin', 'tsc']);
const vite = resolveNodeBin(['vite', 'bin', 'vite.js']);
runNodeScript('TypeScript build', tsc, ['-b']);
runNodeScript('Vite production build', vite, ['build']);

rmSync(STATE_DIR, { recursive: true, force: true });
await mkdir(resolve('.plugpark'), { recursive: true });

const migrationFiles = [
  resolve('migrations', '0001_v0_5_1_foundation.sql'),
  resolve('migrations', '0002_v0_6_0_read_models.sql'),
];
for (const file of migrationFiles) {
  assert(existsSync(file), `migration 없음: ${file}`);
}
assert(existsSync(FIXTURE_SQL), `fixture 없음: ${FIXTURE_SQL}`);

const combined = (await Promise.all(migrationFiles.map((p) => readFile(p, 'utf8')))).join('\n\n');
await writeFile(COMBINED_SCHEMA, combined, 'utf8');

runWrangler('Local D1 schema 생성', [
  'd1', 'execute', DB_NAME,
  '--local',
  `--file=${COMBINED_SCHEMA}`,
  `--persist-to=${STATE_DIR}`,
  '--yes',
]);
runWrangler('Local fixture seed', [
  'd1', 'execute', DB_NAME,
  '--local',
  `--file=${FIXTURE_SQL}`,
  `--persist-to=${STATE_DIR}`,
  '--yes',
]);

const wranglerCli = resolveNodeBin(['wrangler', 'bin', 'wrangler.js'], ['wrangler', 'bin', 'wrangler.cjs']);
const child = spawn(process.execPath, [
  wranglerCli,
  'dev',
  '--local',
  '--port', String(PORT),
  `--persist-to=${STATE_DIR}`,
  '--var', 'LOCAL_FIXTURE_MODE:true',
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

  for (const stage of ['stations', 'parking', 'matches']) {
    process.stdout.write(`Read model ${stage} ... `);
    const stageResult = await postJson(`/api/admin/d1/prepare-read-models?stage=${stage}`);
    if (stage === 'parking') {
      const m = stageResult?.metrics?.parking;
      assert(Number(m?.duplicateCount || 0) >= 1, `parking duplicate regression 미검출: ${JSON.stringify(m)}`);
      assert(Number(m?.uniqueCount || 0) === 3, `parking uniqueCount 기대=3, 실제=${m?.uniqueCount}`);
    }
    console.log('PASS');
  }

  const state = await getJson('/api/d1/read-model-state?v=62');
  assert(state.dataLayerVersion === 'v0.6.2.1', `dataLayerVersion=${state.dataLayerVersion}`);
  assert(state.ready === true, 'read model ready=true가 아님');
  assert(Number(state.chargerCount) === 4, `삭제 충전기 제외 active chargerCount 기대=4, 실제=${state.chargerCount}`);
  assert(Number(state.stationCount) === 2, `stationCount 기대=2, 실제=${state.stationCount}`);
  assert(Number(state.parkingCount) === 3, `parkingCount 기대=3, 실제=${state.parkingCount}`);
  console.log(`Read model state ... PASS · parking=${state.parkingCount}, charger=${state.chargerCount}, station=${state.stationCount}`);

  const places = await getJson('/api/places?v=62');
  assert(places.dataSource === 'd1-read-model', `dataSource=${places.dataSource}`);
  assert(places.upstreamEvCalls === 0, `upstreamEvCalls=${places.upstreamEvCalls}`);
  assert(Array.isArray(places.places) && places.places.length === 3, `places=${places.places?.length}`);
  const centumPlace = places.places.find((p) => String(p.name || '').includes('센텀'));
  assert(centumPlace, '센텀 주차장이 /api/places에 없음');
  assert(Number(centumPlace.charger?.total || 0) === 2, `센텀 charger total 기대=2, 실제=${centumPlace.charger?.total}`);
  assert(Array.isArray(centumPlace.charger?.stations) && centumPlace.charger.stations.includes('센텀시티'), '센텀시티 station 매칭 실패');
  console.log('/api/places D1-only ... PASS · upstream EV=0');

  const centum = await getJson('/api/d1/match-debug?q=%EC%84%BC%ED%85%80');
  const linked = (centum.items || []).filter((x) => x.stat_id === 'STCENT01');
  assert(linked.length > 0, '센텀 회귀 테스트: STCENT01 매칭 없음');
  const hasContained = linked.some((x) => String(x.match_type).includes('normalized_name'));
  assert(hasContained, `센텀 회귀 테스트: match_type 이상 ${linked.map((x) => x.match_type).join(',')}`);
  console.log('센텀 회귀 테스트 ... PASS');

  const output = {
    verifiedAt: new Date().toISOString(),
    dataLayerVersion: state.dataLayerVersion,
    remoteWrites: 0,
    state,
    centumMatches: linked.length,
    places: places.places.length,
    upstreamEvCalls: places.upstreamEvCalls,
  };
  await writeFile(resolve('.plugpark', 'local-verify-result.json'), JSON.stringify(output, null, 2) + '\n', 'utf8');

  console.log('\n✅ LOCAL VERIFY: PASS');
  console.log('Cloudflare remote write: 0');
  console.log('다음 단계는 이 PASS 결과를 기준으로 remote preflight 후 1회 적용입니다.');
} catch (error) {
  await writeFile(resolve('.plugpark', 'local-wrangler.log'), devLog.slice(-20000), 'utf8').catch(() => {});
  console.error('\n❌ LOCAL VERIFY: FAIL');
  console.error(error instanceof Error ? error.message : String(error));
  console.error('로그: .plugpark/local-wrangler.log');
  process.exitCode = 1;
} finally {
  if (child.exitCode == null) {
    child.kill('SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (child.exitCode == null) child.kill('SIGKILL');
  }
}
