import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

const [worker,types,pkgRaw,sql,init,preflight,release,baseline,workflow,docs]=await Promise.all([
  readFile('worker/index.ts','utf8'),
  readFile('src/types.ts','utf8'),
  readFile('package.json','utf8'),
  readFile('scripts/sql/v080-r1-typed-init.sql','utf8'),
  readFile('scripts/init-v080-r1-typed-availability.mjs','utf8'),
  readFile('scripts/preflight-v080-r1.mjs','utf8'),
  readFile('scripts/release-v080-r1.mjs','utf8'),
  readFile('scripts/source-baseline.mjs','utf8'),
  readFile('.github/workflows/v071-local-verify.yml','utf8'),
  readFile('docs/releases/v0.8.0-r1-release-plan.md','utf8')
]);
const pkg=JSON.parse(pkgRaw);

assert(worker.includes("const CACHE_VERSION = 'v8.0.0-r1';"),'R1 cache namespace missing');
assert(worker.includes("const RECOMMENDATION_VERSION = 'v0.8.0-R1';"),'R1 recommendation version missing');
assert((worker.match(/recommendationVersion: RECOMMENDATION_VERSION/g)||[]).length>=2,'health/places recommendationVersion missing');
assert(types.includes("recommendationVersion?: 'v0.8.0-R1'"),'PlacesResponse recommendation version missing');

assert(pkg.scripts['preflight:v080-r1']==='node scripts/preflight-v080-r1.mjs','R1 preflight script missing');
assert(pkg.scripts['release:v080-r1']==='node scripts/release-v080-r1.mjs','R1 release script missing');
assert(pkg.scripts['verify:release:v080-r1']==='node scripts/verify-release-v080-r1.mjs','R1 release verify script missing');
assert(pkg.scripts['init:typed:v080-r1']==='node scripts/init-v080-r1-typed-availability.mjs','R1 typed init script missing');

assert((sql.match(/FROM ev_chargers c/g)||[]).length===1,'typed init must aggregate raw ev_chargers once');
assert(sql.includes('CREATE TABLE r1_typed_availability_init'),'typed staging table missing');
assert(sql.includes('UPDATE ev_stations'),'ev_stations typed init missing');
assert(sql.includes('UPDATE ev_station_live_status'),'ev_station_live_status typed init missing');

assert(init.includes("if(remote&&!confirmed)"),'typed init remote confirmation guard missing');
assert(init.includes("writeCommands:1"),'typed init write receipt missing');
assert(init.includes("rawVerificationScans:0"),'typed init verification raw scan guard missing');

assert(preflight.includes("'d1','migrations','list',DB,'--remote'"),'preflight pending migration read missing');
assert(!preflight.includes("'--json'"),'preflight migrations list must not use unsupported --json');
assert(preflight.includes('delete env.CI'),'preflight must allow local Wrangler OAuth instead of forcing CI');
assert(preflight.includes("stdio:capture?['inherit','pipe','pipe']:'inherit'"),'preflight capture must preserve interactive stdin while capturing diagnostics');
assert(preflight.includes("['whoami','--json']"),'preflight must validate auth with whoami --json');
assert(preflight.includes('parseWhoami'),'preflight auth result parser missing');
assert(preflight.includes("failed (exit="),'preflight Wrangler errors must include command exit code');
assert(preflight.includes("match(/\\b\\d{4}_[A-Za-z0-9._-]+\\.sql\\b/g)"),'preflight text migration parser missing');
assert(preflight.includes("/api/health?v080-r1-preflight=1"),'preflight health missing');
assert(preflight.includes("/api/places?v080-r1-preflight=1"),'preflight places missing');
assert(!preflight.includes("'d1','execute'"),'preflight must not execute D1 SQL');

assert(release.includes("['d1','migrations','apply',DB,'--remote']"),'release migration once command missing');
assert(release.includes("['--remote','--confirm-remote']"),'release typed init confirmation missing');
assert(release.includes("runWranglerOnce('7) Worker deploy', ['deploy'])"),'release deploy once command missing');
assert(release.includes('env:childEnv(true)'),'remote Wrangler commands must not force CI');
assert(release.includes("stdio:json?['inherit','pipe','inherit']:'inherit'"),'release JSON capture must preserve interactive stdin');
assert(release.includes("[],true);"),'remote preflight child must allow local Wrangler OAuth');
assert(init.includes("if(remote) delete env.CI"),'remote typed init must allow local Wrangler OAuth');
assert(init.includes("stdio:asJson?['inherit','pipe','inherit']:'inherit'"),'typed init JSON capture must preserve interactive stdin');
assert(release.includes("kind=ev&mode=incremental"),'EV incremental sync missing');
assert(!release.includes('kind=parking'),'release must not force parking sync');
assert(!release.includes('ev:backfill'),'EV full backfill forbidden');
assert(!release.includes('mode=full'),'full reconcile forbidden');
assert(!release.includes('audit:parking-coverage'),'parking full audit forbidden');

for(const path of [
  'scripts/preflight-v080-r1.mjs',
  'scripts/init-v080-r1-typed-availability.mjs',
  'scripts/release-v080-r1.mjs',
  'scripts/verify-release-v080-r1.mjs',
  'scripts/verify-v080-r1-typed-init-local.mjs',
  'scripts/sql/v080-r1-typed-init.sql'
]) assert(baseline.includes("'"+path+"'"),'baseline missing '+path);

assert(workflow.includes('R1 release tooling verify'),'CI release tooling gate missing');
assert(workflow.includes('npm run verify:release:v080-r1'),'CI R1 release verify command missing');
assert(docs.includes('R1-6A'), 'release plan R1-6A section missing');

const r=spawnSync(process.execPath,['scripts/verify-v080-r1-typed-init-local.mjs'],{
  stdio:'inherit',shell:false,windowsHide:true,
  env:{...process.env,CI:'1',WRANGLER_SEND_METRICS:'false'}
});
if(r.error) throw r.error;
assert.equal(r.status,0,'typed init local dry-run failed');

console.log('R1 worker identity/cache ... PASS');
console.log('R1 typed init SQL ... PASS · raw aggregation once');
console.log('R1 preflight/release single-shot guards ... PASS');
console.log('Forbidden release operations ... PASS');
console.log('R1 source integrity list ... PASS');
console.log('\n✅ v0.8.0-R1 RELEASE TOOLING VERIFY: PASS');
console.log('Remote D1 read=0 · write=0 · deploy=0 · public API=0');
