import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const BASE_URL = process.env.PLUGPARK_URL || 'https://plugpark.dtdt4865.workers.dev';
const LOCAL_RESULT = resolve('.plugpark','live-local-verify-result.json');
const PROBE_RESULT = resolve('.plugpark','parking-api-probe.json');
const RESULT_FILE = resolve('.plugpark','live-remote-release-result.json');

function parseEnvText(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0,eq).trim();
    let value = line.slice(eq+1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value=value.slice(1,-1);
    out[key]=value;
  }
  return out;
}

async function readDevVars() {
  const p=resolve('.dev.vars');
  if(!existsSync(p)) return {};
  return parseEnvText(await readFile(p,'utf8'));
}

function findBin(...candidates) {
  for (const candidate of candidates) {
    const full=resolve('node_modules',...candidate);
    if(existsSync(full)) return full;
  }
  throw new Error('Wrangler CLI를 찾지 못했습니다. npm install 상태를 확인하세요.');
}

function runNode(label, scriptPath, args=[]) {
  console.log(`\n${label}`);
  const r=spawnSync(process.execPath,[scriptPath,...args],{
    cwd:ROOT,stdio:'inherit',shell:false,windowsHide:true,
    env:{...process.env,CI:'1',WRANGLER_SEND_METRICS:'false'},
  });
  if(r.error) throw r.error;
  if(r.status!==0) throw new Error(`${label} 실패 (exit=${r.status})`);
}

function runWrangler(label,args) {
  const cli=findBin(['wrangler','bin','wrangler.js'],['wrangler','bin','wrangler.cjs']);
  runNode(label,cli,args);
}

async function getJson(path) {
  const r=await fetch(`${BASE_URL}${path}`,{headers:{Accept:'application/json','Cache-Control':'no-cache'}});
  const raw=await r.text();
  let data;
  try { data=JSON.parse(raw); }
  catch { throw new Error(`${path}: JSON 응답 아님 (HTTP ${r.status})`); }
  if(!r.ok || data?.ok===false) throw new Error(`${path}: ${data?.error || data?.message || `HTTP ${r.status}`}`);
  return data;
}

async function postOnce(path,token,label) {
  process.stdout.write(`${label} (1회) ... `);
  let r;
  try {
    r=await fetch(`${BASE_URL}${path}`,{
      method:'POST',
      headers:{Accept:'application/json',Authorization:`Bearer ${token}`,'Cache-Control':'no-cache'},
    });
  } catch(error) {
    console.log('FAIL');
    throw new Error(`${label}: ${error instanceof Error?error.message:String(error)}\n자동 재시도하지 않았습니다.`);
  }
  const raw=await r.text();
  let data;
  try { data=JSON.parse(raw); }
  catch {
    console.log('FAIL');
    throw new Error(`${label}: JSON 응답 아님 (HTTP ${r.status}). 자동 재시도하지 않았습니다.`);
  }
  if(!r.ok || data?.ok===false) {
    console.log('FAIL');
    throw new Error(`${label}: ${data?.error || data?.message || `HTTP ${r.status}`}\n자동 재시도하지 않았습니다.`);
  }
  console.log('PASS');
  return data;
}

console.log('\nPlugPark v0.7.1 PREPARED LIVE RELEASE');
console.log('이미 통과한 Local/Probe 결과 재사용 → read-only preflight → 원격 write 각 1회');

if(!existsSync(LOCAL_RESULT)) throw new Error('LIVE LOCAL VERIFY 결과가 없습니다. prepare:live:resume을 먼저 통과하세요.');
if(!existsSync(PROBE_RESULT)) throw new Error('Parking API probe 결과가 없습니다. prepare:live:resume을 먼저 통과하세요.');

const local=JSON.parse(await readFile(LOCAL_RESULT,'utf8'));
if(local.dataLayerVersion!=='v0.7.1' || Number(local.remoteWrites)!==0 || Number(local.upstreamLiveCalls)!==0) {
  throw new Error('LIVE LOCAL VERIFY receipt가 release 조건을 만족하지 않습니다.');
}
const probe=JSON.parse(await readFile(PROBE_RESULT,'utf8'));
if(probe.ok!==true || probe.releaseReady!==true || probe.runtimeAdapterReady!==true || Number(probe.publicApiCalls)!==2 || Number(probe.remoteD1Writes)!==0) {
  throw new Error('Parking v2 probe receipt가 release 조건을 만족하지 않습니다.');
}
console.log('Prepared receipts ... PASS');

runNode('1) LIVE REMOTE PREFLIGHT (read-only)',resolve('scripts','live-remote-preflight.mjs'));

const devVars=await readDevVars();
const token=String(process.env.PLUGPARK_INGEST_TOKEN || devVars.INGEST_ADMIN_TOKEN || '').trim();
if(!token) {
  console.log('로컬 INGEST_ADMIN_TOKEN 없음 · 기존 Remote secret은 변경하지 않습니다.');
  console.log('관리자 POST 대신 배포 후 기존 5분 Cron이 실제 sync를 수행할 때까지 확인합니다.');
}

runWrangler('2) D1 migrations remote (1회)', ['d1','migrations','apply','plugpark-db','--remote']);
const deployedAt=Date.now();
runWrangler('3) Worker deploy + Cron 활성화 (1회)', ['deploy']);

const health=await getJson('/api/health?release=071');
if(health.dataLayerVersion!=='v0.7.1') throw new Error(`배포 버전=${health.dataLayerVersion}`);
if(!health.realtimeParkingUrlConfigured) throw new Error('배포 후 ParkingInfoService_v2 endpoint가 적용되지 않았습니다.');
console.log('배포 확인 ... PASS · v0.7.1');

let ev=null;
let parking=null;
let live=null;

if(token) {
  ev=await postOnce('/api/admin/live-sync?kind=ev&mode=incremental',token,'EV Status incremental sync');
  parking=await postOnce('/api/admin/live-sync?kind=parking&mode=incremental',token,'Parking realtime batch sync');
  live=await getJson('/api/d1/live-state?release=071');
} else {
  const deadline=Date.now()+12*60_000;
  let lastEv=null;
  let lastParking=null;

  while(Date.now()<deadline) {
    live=await getJson('/api/d1/live-state?release=071-cron');
    lastEv=live?.evStatus?.lastSuccessAt || null;
    lastParking=live?.parkingRealtime?.lastSuccessAt || null;

    const evMs=lastEv ? Date.parse(lastEv) : Number.NaN;
    const parkingMs=lastParking ? Date.parse(lastParking) : Number.NaN;
    const evRan=Number.isFinite(evMs) && evMs >= deployedAt - 30_000;
    const parkingRan=Number.isFinite(parkingMs) && parkingMs >= deployedAt - 30_000;

    process.stdout.write(
      `Cron sync 대기 ... EV=${evRan?'PASS':lastEv || 'pending'} · Parking=${parkingRan?'PASS':lastParking || 'pending'}\r`
    );

    if(evRan && parkingRan) {
      process.stdout.write('\nCron live sync ... PASS\n');
      break;
    }
    await new Promise((resolve)=>setTimeout(resolve,20_000));
  }

  if(!live) throw new Error('배포 후 live-state를 확인하지 못했습니다.');
  const evMs=live.evStatus?.lastSuccessAt ? Date.parse(live.evStatus.lastSuccessAt) : Number.NaN;
  const parkingMs=live.parkingRealtime?.lastSuccessAt ? Date.parse(live.parkingRealtime.lastSuccessAt) : Number.NaN;
  if(!Number.isFinite(evMs) || evMs < deployedAt - 30_000) {
    throw new Error('12분 안에 배포 후 EV Cron sync를 확인하지 못했습니다. 자동 재POST는 하지 않았습니다.');
  }
  if(!Number.isFinite(parkingMs) || parkingMs < deployedAt - 30_000) {
    throw new Error('12분 안에 배포 후 Parking Cron sync를 확인하지 못했습니다. 자동 재POST는 하지 않았습니다.');
  }

  ev={ mode:'cron', lastSuccessAt:live.evStatus.lastSuccessAt };
  parking={ mode:'cron', lastSuccessAt:live.parkingRealtime.lastSuccessAt };
}
const places=await getJson('/api/places?release=071');

if(places.upstreamEvCalls!==0 || places.upstreamParkingCalls!==0) {
  throw new Error(`사용자 read path upstream 호출 감지: EV=${places.upstreamEvCalls}, Parking=${places.upstreamParkingCalls}`);
}
if(live.evStatus.status!=='complete') throw new Error(`evStatus=${live.evStatus.status}`);
if(live.evStatus.coverageComplete!==true) throw new Error('EV baseline coverageComplete=true가 아닙니다.');
if(live.parkingRealtime.status!=='complete') throw new Error(`parkingRealtime=${live.parkingRealtime.status}`);

const result={
  releasedAt:new Date().toISOString(),
  version:'v0.7.1',
  remoteMigrationCommands:1,
  deployCalls:1,
  evSyncCalls:token ? 1 : 0,
  parkingSyncCalls:token ? 1 : 0,
  syncTrigger:token ? 'admin-post' : 'cron',
  ev,
  parking,
  live,
  placesCount:places.places?.length || 0,
  userReadUpstreamCalls:{ev:places.upstreamEvCalls,parking:places.upstreamParkingCalls},
};
await mkdir(resolve('.plugpark'),{recursive:true});
await writeFile(RESULT_FILE,JSON.stringify(result,null,2)+'\n','utf8');

console.log('\n✅ LIVE REMOTE RELEASE: PASS');
console.log(`EV Status rows=${live.evStatus.storedRows} · syncFresh=${live.evStatus.syncFresh}`);
console.log(`Parking snapshot=${live.parkingRealtime.itemCount}곳 · fresh=${live.parkingRealtime.fresh}`);
if(token) {
  console.log(`이번 Parking sync API calls=${parking.apiCalls ?? '?'} · catalog calls=${parking.catalogCalls ?? '?'}`);
} else {
  console.log('이번 live sync trigger=Cron · 기존 Remote INGEST_ADMIN_TOKEN 유지');
}
console.log('사용자 /api/places upstream call=0');
