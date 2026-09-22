import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const BASE_URL = process.env.PLUGPARK_URL || 'https://plugpark.dtdt4865.workers.dev';
const RESULT_FILE = resolve('.plugpark', 'remote-release-result.json');

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
    cwd: ROOT,
    stdio: 'inherit',
    shell: false,
    windowsHide: true,
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
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
  });
  const raw = await response.text();
  let data;
  try { data = JSON.parse(raw); }
  catch { throw new Error(`${path}: JSON 응답이 아닙니다 (HTTP ${response.status})`); }
  if (!response.ok || data?.ok === false) {
    throw new Error(`${path}: ${data?.error || data?.message || `HTTP ${response.status}`}`);
  }
  return data;
}

function classifyUnsafeRetry(message) {
  const m = String(message || '').toLowerCase();
  if (m.includes("daily row write limit") || m.includes("daily row read limit")) return 'D1_QUOTA';
  if (m.includes('authentication') || m.includes('unauthorized') || m.includes('forbidden')) return 'AUTH';
  if (m.includes('network') || m.includes('fetch failed') || m.includes('connection')) return 'NETWORK_UNKNOWN_COMMIT';
  return 'REMOTE_STAGE_FAILED';
}

async function postStageOnce(stage, token) {
  process.stdout.write(`Remote read model ${stage} (1회) ... `);
  let response;
  try {
    response = await fetch(`${BASE_URL}/api/admin/d1/prepare-read-models?stage=${encodeURIComponent(stage)}`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        'X-PlugPark-Release': 'v0.6.2',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log('FAIL');
    const kind = classifyUnsafeRetry(message);
    throw new Error(`${kind}: ${message}\n자동 재시도하지 않았습니다. npm run status:remote로 상태만 확인하세요.`);
  }

  const raw = await response.text();
  let data;
  try { data = JSON.parse(raw); }
  catch {
    console.log('FAIL');
    throw new Error(`REMOTE_STAGE_FAILED: ${stage} 응답이 JSON이 아닙니다 (HTTP ${response.status}). 자동 재시도하지 않았습니다.`);
  }

  if (!response.ok || data?.ok === false) {
    console.log('FAIL');
    const message = data?.error || data?.message || `HTTP ${response.status}`;
    const kind = classifyUnsafeRetry(message);
    throw new Error(`${kind}: ${message}\n자동 재시도하지 않았습니다.`);
  }

  console.log('PASS');
  return data;
}

console.log('\nPlugPark v0.6.2 SAFE REMOTE RELEASE');
console.log('원칙: Local PASS → read-only preflight → Worker deploy 1회 → stage별 write 1회 → smoke verify\n');

// Patch changed the Worker from v0.6.1 -> v0.6.2, so verify the exact code first.
runNode('1) LOCAL VERIFY', resolve('scripts', 'local-recovery-verify.mjs'));
runNode('2) REMOTE PREFLIGHT (read-only)', resolve('scripts', 'remote-preflight.mjs'));

let token = String(process.env.PLUGPARK_INGEST_TOKEN || '').trim();
if (!token) {
  const rl = createInterface({ input, output });
  token = String(await rl.question('PLUGPARK_INGEST_TOKEN을 입력하세요: ')).trim();
  rl.close();
}
if (!token) throw new Error('PLUGPARK_INGEST_TOKEN이 필요합니다.');

runWrangler('3) Worker deploy (딱 1회)', ['deploy']);

const deployedHealth = await getJson('/api/health?release=62');
if (deployedHealth.dataLayerVersion !== 'v0.6.2') {
  throw new Error(`배포 버전 확인 실패: ${deployedHealth.dataLayerVersion}`);
}
console.log('배포 확인 ... PASS · v0.6.2');

const stageResults = {};
for (const stage of ['stations', 'parking', 'matches']) {
  stageResults[stage] = await postStageOnce(stage, token);
}

runNode('4) REMOTE SMOKE VERIFY', resolve('scripts', 'verify-v0.6.mjs'));

const finalState = await getJson('/api/d1/read-model-state?release=62');
const result = {
  releasedAt: new Date().toISOString(),
  version: 'v0.6.2',
  deployCount: 1,
  writeStageCalls: { stations: 1, parking: 1, matches: 1 },
  ready: finalState.ready,
  parkingCount: finalState.parkingCount,
  chargerCount: finalState.chargerCount,
  stationCount: finalState.stationCount,
  matchedParkingCount: finalState.matchedParkingCount,
  matchCount: finalState.matchCount,
};
await writeFile(RESULT_FILE, JSON.stringify(result, null, 2) + '\n', 'utf8');

console.log('\n✅ REMOTE RELEASE: PASS');
console.log(`주차장 ${result.parkingCount} · 활성 충전기 ${result.chargerCount} · 충전소 ${result.stationCount}`);
console.log(`EV 매칭 주차장 ${result.matchedParkingCount} · match rows ${result.matchCount}`);
console.log('이제 실제 웹 화면 확인 1회만 남았습니다.');
