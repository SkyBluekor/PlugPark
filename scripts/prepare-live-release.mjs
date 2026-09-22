import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();

function run(label, relativePath) {
  const scriptPath = resolve(relativePath);
  if (!existsSync(scriptPath)) throw new Error(`스크립트 없음: ${relativePath}`);
  console.log(`\n=== ${label} ===`);
  const r = spawnSync(process.execPath, [scriptPath], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: false,
    windowsHide: true,
    env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' },
  });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`${label} 실패 (exit=${r.status})`);
}

console.log('\nPlugPark v0.7.1 LIVE RELEASE PREPARATION');
console.log('Endpoint check → Local verify → 실제 Parking API 1회 probe → Remote URL 설정 → read-only preflight');

run('0) PARKING ENDPOINT CHECK', 'scripts/check-parking-endpoint.mjs');
run('1) LIVE LOCAL VERIFY', 'scripts/verify-live-local.mjs');
run('2) PARKING API PROBE (실제 API GET 1회)', 'scripts/probe-parking-api.mjs');
run('3) PARKING API REMOTE CONFIG (D1 write 0)', 'scripts/configure-parking-api.mjs');
run('4) LIVE REMOTE PREFLIGHT (read-only)', 'scripts/live-remote-preflight.mjs');

console.log('\n✅ LIVE RELEASE PREPARATION: PASS');
console.log('다음 명령: npm run release:live');
