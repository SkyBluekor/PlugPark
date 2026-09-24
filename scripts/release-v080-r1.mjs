import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import ts from 'typescript';

const VERSION='v0.8.0-R1';
const DATA_LAYER='v0.7.1';
const PARKING_MATCH='v0.7.2-P2';
const DB='plugpark-db';
const BASE_URL=process.env.PLUGPARK_URL||'https://plugpark.dtdt4865.workers.dev';
const PREFLIGHT=resolve('.plugpark','v080-r1-preflight-result.json');
const TYPED_RECEIPT=resolve('.plugpark','v080-r1-typed-init-result.json');
const RESULT=resolve('.plugpark','v080-r1-release-result.json');

function fail(message){throw new Error(message);}
function cli(){
  for(const p of [['wrangler','bin','wrangler.js'],['wrangler','bin','wrangler.cjs']]){
    const f=resolve('node_modules',...p);
    if(existsSync(f)) return f;
  }
  fail('wrangler not found');
}
function childEnv(interactiveCloudflare=false){
  const env={...process.env,WRANGLER_SEND_METRICS:'false'};
  if(interactiveCloudflare) delete env.CI;
  else env.CI='1';
  return env;
}
function runNode(label,script,args=[],interactiveCloudflare=false){
  console.log('\n'+label);
  const r=spawnSync(process.execPath,[script,...args],{stdio:'inherit',shell:false,windowsHide:true,env:childEnv(interactiveCloudflare)});
  if(r.error) throw r.error;
  if(r.status!==0) fail(label+' failed. Do not retry automatically.');
}
function runWranglerOnce(label,args,json=false){
  console.log('\n'+label+' · automatic retry=0');
  const r=spawnSync(process.execPath,[cli(),...args],{
    encoding:json?'utf8':undefined,
    stdio:json?undefined:'inherit',
    shell:false,windowsHide:true,
    env:childEnv(true)
  });
  if(r.error) throw r.error;
  if(r.status!==0) fail(label+' failed or unclear. Inspect remote state before any retry.');
  return json?String(r.stdout||''):'';
}
function gitHead(){
  const r=spawnSync('git',['rev-parse','HEAD'],{encoding:'utf8',shell:false,windowsHide:true});
  if(r.error||r.status!==0) fail('git HEAD failed');
  return r.stdout.trim();
}
function parseEnv(text){
  const out={};
  for(const raw of text.split(/\r?\n/)){
    const line=raw.trim();
    if(!line||line.startsWith('#')) continue;
    const i=line.indexOf('=');
    if(i<=0) continue;
    let value=line.slice(i+1).trim();
    if((value.startsWith('"')&&value.endsWith('"'))||(value.startsWith("'")&&value.endsWith("'"))) value=value.slice(1,-1);
    out[line.slice(0,i).trim()]=value;
  }
  return out;
}
async function token(){
  let value=String(process.env.PLUGPARK_INGEST_TOKEN||'').trim();
  if(value) return value;
  const path=resolve('.dev.vars');
  if(existsSync(path)) value=String(parseEnv(await readFile(path,'utf8')).INGEST_ADMIN_TOKEN||'').trim();
  return value;
}
async function getJson(path){
  const r=await fetch(BASE_URL+path,{headers:{Accept:'application/json','Cache-Control':'no-cache'}});
  const raw=await r.text();
  let data;
  try{data=JSON.parse(raw);}catch{fail(path+' non-JSON');}
  if(!r.ok||data?.ok===false) fail(path+' failed: '+(data?.error||r.status));
  return data;
}
async function postOnce(path,auth,label){
  process.stdout.write(label+' (1회) ... ');
  let r;
  try{
    r=await fetch(BASE_URL+path,{method:'POST',headers:{Accept:'application/json',Authorization:'Bearer '+auth,'Cache-Control':'no-cache'}});
  }catch(error){
    console.log('FAIL');
    fail(label+' network error. Automatic retry disabled. '+String(error));
  }
  const raw=await r.text();
  let data;
  try{data=JSON.parse(raw);}catch{console.log('FAIL');fail(label+' non-JSON. Automatic retry disabled.');}
  if(!r.ok||data?.ok===false){console.log('FAIL');fail(label+' failed. Automatic retry disabled. '+(data?.error||r.status));}
  console.log('PASS');
  return data;
}
async function loadRecommendation(){
  const source=await readFile(resolve('src','recommendation','recommendPlaces.ts'),'utf8');
  const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,verbatimModuleSyntax:false}}).outputText;
  const path=resolve('.plugpark','recommendPlaces.v080-release.mjs');
  await writeFile(path,js,'utf8');
  return import('file:///'+path.replace(/\\/g,'/')+'?v='+Date.now());
}
function validatePlaces(data){
  assert.equal(data.runtimeMode,'live');
  assert.equal(data.recommendationVersion,VERSION);
  assert.equal(data.dataLayerVersion,DATA_LAYER);
  assert.equal(data.parkingMatchVersion,PARKING_MATCH);
  assert.equal(Number(data.upstreamEvCalls),0);
  assert.equal(Number(data.upstreamParkingCalls),0);
  assert.equal(data.readModelReady,true);
  assert.equal(data.evSnapshotComplete,true);
  for(const place of data.places||[]){
    const c=place.charger;
    if(!c) continue;
    for(const key of ['total','available','fast','slow','availableFast','availableSlow']){
      assert.ok(Number.isFinite(c[key])&&c[key]>=0,place.id+' '+key+' invalid');
    }
    assert.ok(c.availableFast<=c.fast,place.id+' fast invariant');
    assert.ok(c.availableSlow<=c.slow,place.id+' slow invariant');
    assert.ok(c.availableFast+c.availableSlow<=c.available,place.id+' available invariant');
  }
}
function validateRecommendations(items,mode,pref){
  assert.ok(items.length>0,mode+'/'+pref+' returned no recommendations');
  assert.ok(items.length<=3,mode+'/'+pref+' >3');
  for(const item of items){
    const p=item.place;
    assert.ok(Number.isFinite(p.lat)&&Number.isFinite(p.lng),'recommendation without coords');
    assert.ok(!(p.parkingRealtime&&p.parkingRealtimeFresh===true&&p.availableParking===0),'fresh full parking recommended');
    if(mode==='charging'&&pref==='fast') assert.ok(p.charger.fast>0,'fast=0 recommended');
    if(mode==='charging'&&pref==='slow') assert.ok(p.charger.slow>0,'slow=0 recommended');
    if(p.charger.statusFresh===false) assert.ok(!item.reasons.some(x=>/사용 가능/.test(x)),'stale availability claim');
  }
}

runNode('1) R1 LOCAL RELEASE GATE',resolve('scripts','verify-r1-release-gate.mjs'));
runNode('2) R1 RELEASE TOOLING VERIFY',resolve('scripts','verify-release-v080-r1.mjs'));
runNode('3) R1 REMOTE PREFLIGHT (READ ONLY)',resolve('scripts','preflight-v080-r1.mjs'),[],true);

if(!existsSync(PREFLIGHT)) fail('preflight receipt missing');
const preflight=JSON.parse(await readFile(PREFLIGHT,'utf8'));
const head=gitHead();
if(preflight.version!==VERSION||preflight.gitHead!==head||Number(preflight.remoteWrites)!==0||Number(preflight.deployCalls)!==0) fail('preflight receipt mismatch');

const auth=await token();
if(!auth) fail('PLUGPARK_INGEST_TOKEN or .dev.vars INGEST_ADMIN_TOKEN required before any remote write');

const deploymentsBefore=runWranglerOnce('4) Read previous deployment', ['deployments','list','--json'], true);
const previousDeploymentId=(deploymentsBefore.match(/[0-9a-f]{8}-[0-9a-f-]{27,}/i)||[])[0]||null;
if(!previousDeploymentId) fail('previous deployment id not found; stop before remote write');

runWranglerOnce('5) D1 migration 0006', ['d1','migrations','apply',DB,'--remote']);
runNode('6) Typed availability remote init',resolve('scripts','init-v080-r1-typed-availability.mjs'),['--remote','--confirm-remote'],true);

if(!existsSync(TYPED_RECEIPT)) fail('typed init receipt missing');
const typed=JSON.parse(await readFile(TYPED_RECEIPT,'utf8'));
if(typed.version!==VERSION||typed.mode!=='remote'||Number(typed.writeCommands)!==1) fail('typed init receipt mismatch');

runWranglerOnce('7) Worker deploy', ['deploy']);

const health=await getJson('/api/health?v080-r1-release=1');
if(health.dataLayerVersion!==DATA_LAYER||health.parkingMatchVersion!==PARKING_MATCH||health.recommendationVersion!==VERSION) fail('deployed worker identity mismatch');

const ev=await postOnce('/api/admin/live-sync?kind=ev&mode=incremental',auth,'8) EV incremental sync');

const places=await getJson('/api/places?v080-r1-release=1');
validatePlaces(places);
const withCoords=(places.places||[]).find(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lng));
if(!withCoords) fail('production places have no coordinates');
const mod=await loadRecommendation();
for(const [mode,pref] of [['charging','any'],['charging','fast'],['charging','slow'],['parking','any']]){
  validateRecommendations(mod.recommendPlaces(places.places,{mode,chargerPreference:pref,userLat:withCoords.lat,userLng:withCoords.lng,radiusKm:null,limit:3}),mode,pref);
}

await mkdir(resolve('.plugpark'),{recursive:true});
await writeFile(RESULT,JSON.stringify({
  releaseVersion:VERSION,
  gitCommit:head,
  releasedAt:new Date().toISOString(),
  previousDeploymentId,
  preflightPassed:true,
  migrationCommands:1,
  typedInitCommands:1,
  deployCalls:1,
  evIncrementalSyncCalls:1,
  evFullBackfillCalls:0,
  parkingSyncCalls:0,
  parkingFullAuditCalls:0,
  upstreamEvCallsOnPlaces:Number(places.upstreamEvCalls),
  upstreamParkingCallsOnPlaces:Number(places.upstreamParkingCalls),
  placesCount:Array.isArray(places.places)?places.places.length:0,
  smokePassed:true,
  ev
},null,2)+'\n','utf8');

console.log('\n✅ v0.8.0-R1 REMOTE RELEASE: PASS');
console.log('previous deployment='+previousDeploymentId);
console.log('migration=1 · typed init=1 · deploy=1 · EV incremental=1');
console.log('EV full backfill=0 · parking sync=0 · full audit=0');
console.log('/api/places upstream EV=0 · Parking=0');
