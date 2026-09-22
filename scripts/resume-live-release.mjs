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

async function localReceiptState() {
  if (!existsSync(LOCAL_RESULT) || !existsSync(BASELINE)) {
    return { reusable: false, reason: 'receipt-missing' };
  }

  const local = JSON.parse(await readFile(LOCAL_RESULT,'utf8'));
  if (
    local.dataLayerVersion !== 'v0.7.1' ||
    Number(local.remoteWrites) !== 0 ||
    Number(local.upstreamLiveCalls) !== 0
  ) {
    return { reusable: false, reason: 'receipt-invalid' };
  }

  const baseline = JSON.parse(await readFile(BASELINE,'utf8'));
  for (const [rel, expected] of Object.entries(baseline.files || {})) {
    if (!expected || !existsSync(resolve(rel))) continue;
    const current = await sha256(resolve(rel));
    if (current !== expected) {
      return { reusable: false, reason: 'source-changed', file: rel };
    }
  }

  return { reusable: true, reason: 'verified' };
}

console.log('\nPlugPark v0.7.1 LIVE RELEASE RESUME');

let receipt = await localReceiptState();
if (!receipt.reusable) {
  const suffix = receipt.file ? ` · changed=${receipt.file}` : '';
  console.log(`기존 LOCAL VERIFY receipt 재사용 불가 (${receipt.reason}${suffix})`);
  console.log('사용자에게 재실행을 요구하지 않고 LOCAL VERIFY를 1회 자동 갱신합니다.');
  console.log('원칙: Remote Cloudflare write 0 · 실제 공공 API call 0');
  run('1) LIVE LOCAL VERIFY REFRESH', 'scripts/verify-live-local.mjs');

  receipt = await localReceiptState();
  if (!receipt.reusable) {
    throw new Error(`LOCAL VERIFY 갱신 후에도 receipt를 재사용할 수 없습니다: ${receipt.reason}`);
  }
} else {
  console.log('기존 LOCAL PASS 재사용 · 실제 API probe부터 재개');
}

console.log('LIVE LOCAL VERIFY receipt ... PASS');

run('0) PARKING ENDPOINT CHECK', 'scripts/check-parking-endpoint.mjs');
run('2) PARKING v2 CONTRACT PROBE (실제 API 최대 2회)', 'scripts/probe-parking-api.mjs');
run('3) LIVE REMOTE PREFLIGHT (read-only)', 'scripts/live-remote-preflight.mjs');

console.log('\n✅ LIVE RELEASE PREPARATION RESUME: PASS');
console.log('다음 명령: npm run release:live');
