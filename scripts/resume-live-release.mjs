import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const LOCAL_RESULT = resolve('.plugpark','live-local-verify-result.json');
const BASELINE = resolve('.plugpark','source-baseline.json');

function run(label, relativePath) {
  const p = resolve(relativePath);
  console.log(`\n=== ${label} ===`);
  const r = spawnSync(process.execPath, [p], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: false,
    windowsHide: true,
    env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' },
  });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`${label} 실패 (exit=${r.status})`);
}

async function sha256(path) {
  const data = await readFile(path);
  return createHash('sha256').update(data).digest('hex');
}

if (!existsSync(LOCAL_RESULT) || !existsSync(BASELINE)) {
  throw new Error('기존 LIVE LOCAL VERIFY PASS 결과가 없습니다. npm run prepare:live를 실행하세요.');
}
const local = JSON.parse(await readFile(LOCAL_RESULT,'utf8'));
if (
  local.dataLayerVersion !== 'v0.7.1' ||
  Number(local.remoteWrites) !== 0 ||
  Number(local.upstreamLiveCalls) !== 0
) {
  throw new Error('기존 LIVE LOCAL VERIFY 결과를 재사용할 수 없습니다.');
}
const baseline = JSON.parse(await readFile(BASELINE,'utf8'));
for (const [rel, expected] of Object.entries(baseline.files || {})) {
  if (!expected || !existsSync(resolve(rel))) continue;
  const current = await sha256(resolve(rel));
  if (current !== expected) {
    throw new Error(`LOCAL VERIFY 이후 소스가 변경됐습니다: ${rel}\nnpm run verify:live를 다시 실행하세요.`);
  }
}

console.log('\nPlugPark v0.7.1 LIVE RELEASE RESUME');
console.log('기존 LOCAL PASS 재사용 · 실제 API probe부터 재개');
console.log('LIVE LOCAL VERIFY receipt ... PASS');

run('0) PARKING ENDPOINT CHECK', 'scripts/check-parking-endpoint.mjs');
run('2) PARKING v2 CONTRACT PROBE (실제 API 최대 2회)', 'scripts/probe-parking-api.mjs');
run('3) LIVE REMOTE PREFLIGHT (read-only)', 'scripts/live-remote-preflight.mjs');

console.log('\n✅ LIVE RELEASE PREPARATION RESUME: PASS');
console.log('다음 명령: npm run release:live');
