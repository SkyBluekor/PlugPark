import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const OUT_DIR = resolve('.plugpark');
const OUT_FILE = resolve(OUT_DIR, 'source-baseline.json');

const critical = [
  'package.json',
  'worker/index.ts',
  'src/App.tsx',
  'src/types.ts',
  'migrations/0001_v0_5_1_foundation.sql',
  'migrations/0002_v0_6_0_read_models.sql',
  'migrations/0003_v0_7_0_live_data.sql',
  'scripts/verify-live-local.mjs',
  'scripts/live-remote-preflight.mjs',
  'scripts/release-live.mjs',
];

async function sha256(path) {
  if (!existsSync(path)) return null;
  const data = await readFile(path);
  return createHash('sha256').update(data).digest('hex');
}

function git(args) {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', shell: false });
  if (r.error || r.status !== 0) return null;
  return r.stdout.trim();
}

const files = {};
for (const rel of critical) {
  files[rel] = await sha256(resolve(rel));
}

const payload = {
  capturedAt: new Date().toISOString(),
  cwd: ROOT,
  gitHead: git(['rev-parse', 'HEAD']),
  gitBranch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
  gitStatus: git(['status', '--short']),
  files,
};

await mkdir(OUT_DIR, { recursive: true });
await writeFile(OUT_FILE, JSON.stringify(payload, null, 2) + '\n', 'utf8');

console.log(`[baseline] ${OUT_FILE}`);
if (payload.gitStatus) {
  console.log('[baseline] 현재 변경사항 있음 — 로컬 검증은 가능하지만 release 전에는 확인 필요');
}
