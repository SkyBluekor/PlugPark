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
  'wrangler.toml',
  '.github/workflows/v071-local-verify.yml',
  'worker/index.ts',
  'src/App.tsx',
  'src/types.ts',
  'src/recommendation/recommendationTypes.ts',
  'src/recommendation/recommendPlaces.ts',
  'src/components/RecommendationPanel.tsx',
  'src/presentation/chargerText.ts',
  'migrations/0001_v0_5_1_foundation.sql',
  'migrations/0002_v0_6_0_read_models.sql',
  'migrations/0003_v0_7_0_live_data.sql',
  'migrations/0004_v0_7_1_parking_facility_catalog.sql',
  'migrations/0005_v0_7_2_parking_match_rules.sql',
  'migrations/0006_v0_8_0_typed_charger_availability.sql',
  'scripts/verify-live-local.mjs',
  'scripts/local-reset-r1.mjs',
  'scripts/local-dev-r1.mjs',
  'scripts/verify-r1-local-only.mjs',
  'scripts/test-recommendation-r1.mjs',
  'scripts/test-recommendation-ui-r1.mjs',
  'scripts/analyze-parking-match-candidates.mjs',
  'scripts/verify-parking-match-v072.mjs',
  'scripts/verify-release-v072-p2.mjs',
  'scripts/verify-d1-read-budget-v072.mjs',
  'scripts/preflight-v072-p2.mjs',
  'scripts/release-v072-p2.mjs',
  'tests/fixtures/parking-realtime-coverage-v072-replay.json',
  'tests/fixtures/local-recovery-seed.sql',
  'scripts/prepare-live-release.mjs',
  'scripts/resume-live-release.mjs',
  'scripts/check-parking-endpoint.mjs',
  'scripts/probe-parking-api.mjs',
  'scripts/live-remote-preflight.mjs',
  'scripts/release-live.mjs',
  'tests/contracts/busan-facilities-parking.contract.json',
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
