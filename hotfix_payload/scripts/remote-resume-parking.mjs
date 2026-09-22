import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const BASE_URL = process.env.PLUGPARK_URL || 'https://plugpark.dtdt4865.workers.dev';

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
  const response = await fetch(`${BASE_URL}${path}`, { headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' } });
  const raw = await response.text();
  let data;
  try { data = JSON.parse(raw); } catch { throw new Error(`${path}: JSON 응답이 아닙니다 (HTTP ${response.status})`); }
  if (!response.ok || data?.ok === false) throw new Error(`${path}: ${data?.error || data?.message || `HTTP ${response.status}`}`);
  return data;
}

function classify(message) {
  const m = String(message || '').toLowerCase();
  if (m.includes('daily row write limit') || m.includes('daily row read limit')) return 'D1_QUOTA';
  if (m.includes('authentication') || m.includes('unauthorized') || m.includes('forbidden')) return 'AUTH';
  if (m.includes('network') || m.includes('connection') || m.includes('fetch failed')) return 'NETWORK_UNKNOWN_COMMIT';
  return 'REMOTE_STAGE_FAILED';
}

async function postOnce(stage, token) {
  process.stdout.write(`Remote read model ${stage} (1회) ... `);
  let response;
  try {
    response = await fetch(`${BASE_URL}/api/admin/d1/prepare-read-models?stage=${encodeURIComponent(stage)}`, {
      method: 'POST',
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, 'X-PlugPark-Release': 'v0.6.2.1' },
    });
  } catch (error) {
    console.log('FAIL');
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${classify(message)}: ${message}\n자동 재시도하지 않았습니다.`);
  }
  const raw = await response.text();
  let data;
  try { data = JSON.parse(raw); } catch {
    console.log('FAIL');
    throw new Error(`${stage}: JSON 응답이 아닙니다 (HTTP ${response.status}). 자동 재시도하지 않았습니다.`);
  }
  if (!response.ok || data?.ok === false) {
    console.log('FAIL');
    const message = data?.error || data?.message || `HTTP ${response.status}`;
    throw new Error(`${classify(message)}: ${message}\n자동 재시도하지 않았습니다.`);
  }
  console.log('PASS');
  if (stage === 'parking') {
    const m = data?.metrics?.parking;
    console.log(`  parking input=${m?.inputCount ?? '?'} · unique=${m?.uniqueCount ?? '?'} · duplicates=${m?.duplicateCount ?? '?'}`);
  }
  return data;
}

console.log('\nPlugPark v0.6.2.1 PARKING DEDUPE HOTFIX');
console.log('stations는 이미 PASS했으므로 다시 쓰지 않습니다. local verify → read-only preflight → deploy 1회 → parking 1회 → matches 1회\n');

runNode('1) LOCAL VERIFY (duplicate parking regression 포함)', resolve('scripts', 'local-recovery-verify.mjs'));
runNode('2) REMOTE PREFLIGHT (read-only)', resolve('scripts', 'remote-preflight.mjs'));

let token = String(process.env.PLUGPARK_INGEST_TOKEN || '').trim();
if (!token) {
  const rl = createInterface({ input, output });
  token = String(await rl.question('PLUGPARK_INGEST_TOKEN을 입력하세요: ')).trim();
  rl.close();
}
if (!token) throw new Error('PLUGPARK_INGEST_TOKEN이 필요합니다.');

runWrangler('3) Hotfix Worker deploy (1회)', ['deploy']);
const health = await getJson('/api/health?release=621');
if (health.dataLayerVersion !== 'v0.6.2.1') throw new Error(`배포 버전 확인 실패: ${health.dataLayerVersion}`);
console.log('배포 확인 ... PASS · v0.6.2.1');

await postOnce('parking', token);
await postOnce('matches', token);

runNode('4) REMOTE SMOKE VERIFY', resolve('scripts', 'verify-v0.6.mjs'));
console.log('\n✅ REMOTE RESUME: PASS');
console.log('stations 재생성 0회 · parking 1회 · matches 1회');
