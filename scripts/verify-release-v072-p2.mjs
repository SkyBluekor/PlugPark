import { readFile } from 'node:fs/promises';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const [worker, migration, pkgRaw, preflight, release, baseline, workflow] = await Promise.all([
  readFile('worker/index.ts', 'utf8'),
  readFile('migrations/0005_v0_7_2_parking_match_rules.sql', 'utf8'),
  readFile('package.json', 'utf8'),
  readFile('scripts/preflight-v072-p2.mjs', 'utf8'),
  readFile('scripts/release-v072-p2.mjs', 'utf8'),
  readFile('scripts/source-baseline.mjs', 'utf8'),
  readFile('.github/workflows/v071-local-verify.yml', 'utf8'),
]);
const pkg = JSON.parse(pkgRaw);

assert(worker.includes("const PARKING_MATCH_VERSION = 'v0.7.2-P2';"), 'PARKING_MATCH_VERSION 없음');
assert(worker.includes("const CACHE_VERSION = 'v7.2.0-p2';"), 'P2 cache namespace 없음');
assert(worker.includes('parkingMatchVersion: PARKING_MATCH_VERSION'), 'health/places parkingMatchVersion 노출 없음');

const ruleRows = [...migration.matchAll(/\(\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*([0-9.]+)\s*,\s*([01])\s*,/g)];
assert(ruleRows.length === 14, 'migration rule count=' + ruleRows.length);
const rules = new Map(ruleRows.map((m) => [m[1], { parkingId: m[2], aggregate: m[5] === '1' }]));
assert(!rules.has('A26') && !rules.has('A435'), 'A26/A435 rule 금지');
for (const code of ['A41','A50','A43','A44']) assert(rules.get(code)?.aggregate === true, code + ' aggregate rule 아님');

assert(pkg.version === '0.7.2', 'package version=' + pkg.version);
assert(pkg.scripts['preflight:v072-p2'] === 'node scripts/preflight-v072-p2.mjs', 'P2 preflight script 누락');
assert(pkg.scripts['release:v072-p2'] === 'node scripts/release-v072-p2.mjs', 'P2 release script 누락');
assert(pkg.scripts['verify:release-v072-p2'] === 'node scripts/verify-release-v072-p2.mjs', 'P2 release verify script 누락');

for (const path of ['scripts/preflight-v072-p2.mjs','scripts/release-v072-p2.mjs','scripts/verify-release-v072-p2.mjs','wrangler.toml','tests/fixtures/local-recovery-seed.sql']) {
  assert(baseline.includes("'" + path + "'"), 'baseline critical 누락: ' + path);
}

assert(preflight.includes('Remote D1 write 0'), 'preflight read-only marker 없음');
assert(preflight.includes("production user read upstream"), 'preflight /api/places upstream gate 없음');
assert(release.includes("'d1', 'migrations', 'apply', DB_NAME, '--remote'"), 'release remote migration command 없음');
assert(release.includes("runWranglerOnce('5) Worker deploy', ['deploy'])"), 'release deploy 1회 gate 없음');
assert(release.includes("health.parkingMatchVersion !== VERSION"), 'release worker version gate 없음');
assert(release.includes("Number(counts.rule_count) !== 14"), 'release rule count gate 없음');
assert(release.includes("Number(counts.aggregate_count) !== 4"), 'release aggregate count gate 없음');
assert(release.includes("publicParkingFullAuditCalls: 0"), 'release full audit=0 receipt 없음');
assert(release.includes("evFullBackfillCalls: 0"), 'release EV backfill=0 receipt 없음');
assert(!release.includes('ev:backfill'), 'release script에서 EV backfill 호출 금지');
assert(!release.includes('audit:parking-coverage'), 'release script에서 51-call audit 호출 금지');
assert(!release.includes('mode=full'), 'release script full reconcile 금지');
assert(workflow.includes('P2 release gate static verify'), 'CI static release gate 없음');
assert(workflow.includes('node --check scripts/release-v072-p2.mjs'), 'CI release syntax gate 없음');

console.log('P2 worker identity/cache ... PASS');
console.log('P2 migration rules ... PASS · 14 rules · aggregate=4 · A26/A435 omitted');
console.log('P2 release commands ... PASS · migration/deploy single-command guards');
console.log('Forbidden release operations ... PASS · full audit/backfill/full reconcile absent');
console.log('P2 source integrity list ... PASS');
console.log('\n✅ v0.7.2-P2 RELEASE GATE STATIC VERIFY: PASS');
console.log('Remote write=0 · deploy=0');
