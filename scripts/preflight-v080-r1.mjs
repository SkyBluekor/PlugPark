import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const VERSION='v0.8.0-R1';
const DB='plugpark-db';
const EXPECTED_BRANCH='feat/v0.8.0-r1-recommendation';
const BASE_URL=process.env.PLUGPARK_URL||'https://plugpark.dtdt4865.workers.dev';
const LOCAL_RECEIPT=resolve('.plugpark','v080-r1-local-gate-result.json');
const RESULT=resolve('.plugpark','v080-r1-preflight-result.json');

function fail(message){throw new Error(message);}
function cli(){
  for(const p of [['wrangler','bin','wrangler.js'],['wrangler','bin','wrangler.cjs']]){
    const f=resolve('node_modules',...p);
    if(existsSync(f)) return f;
  }
  fail('wrangler not found');
}
function git(args){
  const r=spawnSync('git',args,{encoding:'utf8',shell:false,windowsHide:true});
  if(r.error||r.status!==0) fail('git '+args.join(' ')+' failed');
  return r.stdout.trim();
}
function wrangler(args,capture=false){
  const r=spawnSync(process.execPath,[cli(),...args],{
    encoding:'utf8',shell:false,windowsHide:true,
    env:{...process.env,CI:'1',WRANGLER_SEND_METRICS:'false',NO_COLOR:'1'}
  });
  if(r.error) throw r.error;
  if(r.status!==0){process.stderr.write(r.stderr||'');fail('wrangler read-only command failed');}
  return capture?String(r.stdout||''):null;
}
function migrationNames(raw){
  const plain=String(raw||'')
    .replace(/\u001b\[[0-9;]*m/g,'')
    .replace(/\r\n/g,'\n');
  const names=plain.match(/\b\d{4}_[A-Za-z0-9._-]+\.sql\b/g)||[];
  return [...new Set(names)].sort();
}
async function getJson(path){
  const r=await fetch(BASE_URL+path,{headers:{Accept:'application/json','Cache-Control':'no-cache'}});
  const raw=await r.text();
  let data;
  try{data=JSON.parse(raw);}catch{fail(path+' returned non-JSON');}
  if(!r.ok||data?.ok===false) fail(path+' failed: '+(data?.error||r.status));
  return data;
}

if(!existsSync(LOCAL_RECEIPT)) fail('run npm run verify:r1 first');
const local=JSON.parse(await readFile(LOCAL_RECEIPT,'utf8'));
const head=git(['rev-parse','HEAD']);
const branch=git(['rev-parse','--abbrev-ref','HEAD']);
const status=git(['status','--short']);
if(status) fail('working tree must be clean before remote preflight');
if(branch!==EXPECTED_BRANCH) fail('release branch mismatch: '+branch);
if(local.version!==VERSION||local.passed!==true||local.gitHead!==head) fail('local R1 gate receipt does not match HEAD');
if(Number(local.remoteD1Writes)!==0||Number(local.deployCalls)!==0) fail('local receipt contains remote activity');

wrangler(['whoami']);
console.log('Cloudflare auth ... PASS');

const pending=migrationNames(wrangler(['d1','migrations','list',DB,'--remote'],true));
if(pending.length!==1||!pending[0].startsWith('0006_')){
  fail('expected exactly pending migration 0006, got: '+JSON.stringify(pending));
}
console.log('Remote pending migrations ... PASS · '+pending[0]);

const health=await getJson('/api/health?v080-r1-preflight=1');
if(!health.d1Configured||!health.evSecretConfigured||!health.parkingSecretConfigured||!health.ingestAdminTokenConfigured) fail('production config incomplete');

const places=await getJson('/api/places?v080-r1-preflight=1');
if(Number(places.upstreamEvCalls)!==0||Number(places.upstreamParkingCalls)!==0) fail('production /api/places upstream call detected');
if(places.readModelReady!==true) fail('production read model not ready');

await mkdir(resolve('.plugpark'),{recursive:true});
await writeFile(RESULT,JSON.stringify({
  version:VERSION,
  gitHead:head,
  gitBranch:branch,
  verifiedAt:new Date().toISOString(),
  pendingMigrations:pending,
  remoteWrites:0,
  deployCalls:0,
  publicApiSyncCalls:0,
  currentDeployment:{
    dataLayerVersion:health.dataLayerVersion,
    parkingMatchVersion:health.parkingMatchVersion||null,
    recommendationVersion:health.recommendationVersion||null
  },
  productionPlacesCount:Array.isArray(places.places)?places.places.length:0,
  productionUserReadUpstreamCalls:{ev:Number(places.upstreamEvCalls),parking:Number(places.upstreamParkingCalls)}
},null,2)+'\n','utf8');

console.log('Production health + places ... PASS');
console.log('Remote D1 write=0 · deploy=0 · sync calls=0');
console.log('Receipt: '+RESULT);
