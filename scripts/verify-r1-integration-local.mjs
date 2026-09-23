import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, rmSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import ts from 'typescript';

const ROOT=process.cwd();
const DB='plugpark-db';
const PORT=Number(process.env.PLUGPARK_R1_VERIFY_PORT||8791);
const BASE_URL=\`http://127.0.0.1:\${PORT}\`;
const TOKEN='plugpark-r1-local-only';
const STATE=resolve('.plugpark','r1-local-state');
const UPGRADE_STATE=resolve('.plugpark','r1-upgrade-state');

function wrangler(){
  for(const p of [['wrangler','bin','wrangler.js'],['wrangler','bin','wrangler.cjs']]){
    const file=resolve('node_modules',...p);
    if(existsSync(file)) return file;
  }
  throw new Error('wrangler가 없습니다. npm ci 후 다시 실행하세요.');
}

function runNode(label,script,args=[]){
  process.stdout.write(\`\${label} ... \`);
  const r=spawnSync(process.execPath,[script,...args],{
    cwd:ROOT,stdio:'inherit',shell:false,windowsHide:true,
    env:{...process.env,CI:'1',WRANGLER_SEND_METRICS:'false'}
  });
  if(r.error) throw r.error;
  assert.equal(r.status,0,\`\${label} 실패 (exit=\${r.status})\`);
  console.log('PASS');
}

function runWrangler(label,args){
  process.stdout.write(\`\${label} ... \`);
  const r=spawnSync(process.execPath,[wrangler(),...args],{
    cwd:ROOT,stdio:'inherit',shell:false,windowsHide:true,
    env:{...process.env,CI:'1',WRANGLER_SEND_METRICS:'false'}
  });
  if(r.error) throw r.error;
  assert.equal(r.status,0,\`\${label} 실패 (exit=\${r.status})\`);
  console.log('PASS');
}

async function waitForServer(child,timeoutMs=60000){
  const deadline=Date.now()+timeoutMs;
  let lastError='not started';
  while(Date.now()<deadline){
    if(child.exitCode!=null) throw new Error(\`wrangler dev 조기 종료 (exit=\${child.exitCode})\`);
    try{
      const response=await fetch(\`\${BASE_URL}/api/health\`,{headers:{Accept:'application/json'}});
      if(response.ok) return;
      lastError=\`HTTP \${response.status}\`;
    }catch(error){
      lastError=error instanceof Error?error.message:String(error);
    }
    await new Promise(resolve=>setTimeout(resolve,350));
  }
  throw new Error(\`local Worker 시작 시간 초과: \${lastError}\`);
}

async function jsonRequest(path,init){
  const response=await fetch(\`\${BASE_URL}\${path}\`,{
    ...init,
    headers:{
      Accept:'application/json',
      'Cache-Control':'no-cache',
      ...(init?.headers||{})
    }
  });
  const raw=await response.text();
  let data;
  try{data=JSON.parse(raw);}
  catch{throw new Error(\`\${path}: JSON 아님 (HTTP \${response.status}) \${raw.slice(0,200)}\`);}
  if(!response.ok||data?.ok===false){
    throw new Error(\`\${path}: \${data?.error||data?.message||\`HTTP \${response.status}\`}\`);
  }
  return data;
}

async function post(path){
  return jsonRequest(path,{
    method:'POST',
    headers:{Authorization:\`Bearer \${TOKEN}\`}
  });
}

async function loadRecommendationEngine(){
  const source=await readFile(resolve('src','recommendation','recommendPlaces.ts'),'utf8');
  const js=ts.transpileModule(source,{
    compilerOptions:{
      target:ts.ScriptTarget.ES2022,
      module:ts.ModuleKind.ES2022,
      verbatimModuleSyntax:false
    },
    fileName:'recommendPlaces.ts'
  }).outputText;
  const runtimePath=resolve('.plugpark','recommendPlaces.r1-integration.mjs');
  await writeFile(runtimePath,js,'utf8');
  return import(\`file:///\${runtimePath.replace(/\\\\/g,'/')}?v=\${Date.now()}\`);
}

function assertTypedAvailability(place){
  const c=place.charger;
  for(const [name,value] of [
    ['total',c.total],['available',c.available],['fast',c.fast],['slow',c.slow],
    ['availableFast',c.availableFast],['availableSlow',c.availableSlow]
  ]){
    assert.equal(typeof value,'number',\`\${place.id} charger.\${name} number 아님\`);
    assert.ok(Number.isFinite(value)&&value>=0,\`\${place.id} charger.\${name} 음수/비정상\`);
  }
  assert.ok(c.availableFast<=c.fast,\`\${place.id} availableFast > fast\`);
  assert.ok(c.availableSlow<=c.slow,\`\${place.id} availableSlow > slow\`);
  assert.ok(c.availableFast+c.availableSlow<=c.available,\`\${place.id} typed available 합 > total available\`);
}

function assertRecommendationContract(items,mode,preference){
  assert.ok(items.length>0,\`\${mode}/\${preference}: 추천 0건\`);
  assert.ok(items.length<=3,\`\${mode}/\${preference}: 추천 3건 초과\`);
  for(const item of items){
    const place=item.place;
    assert.ok(Number.isFinite(place.lat)&&Number.isFinite(place.lng),\`\${place.id}: 추천 좌표 없음\`);
    assert.ok(!(place.parkingRealtime&&place.parkingRealtimeFresh===true&&place.availableParking===0),\`\${place.id}: fresh 만차 추천됨\`);
    if(mode==='charging'&&preference==='fast') assert.ok(place.charger.fast>0,\`\${place.id}: fast=0 급속 추천\`);
    if(mode==='charging'&&preference==='slow') assert.ok(place.charger.slow>0,\`\${place.id}: slow=0 완속 추천\`);
    if(mode==='charging'&&preference==='any') assert.ok(place.charger.total>0,\`\${place.id}: 충전기 없는 장소 추천\`);
    if(place.charger.statusFresh===false){
      assert.ok(!item.reasons.some(reason=>/사용 가능/.test(reason)),\`\${place.id}: stale 상태 사용 가능 단정\`);
    }
  }
}

console.log('\\nPlugPark v0.8.0-R1 LOCAL INTEGRATION');
console.log('Cloudflare remote read=0 · write=0 · deploy=0 · public API=0\\n');

await mkdir(resolve('.plugpark'),{recursive:true});
runNode('Fresh DB migration + fixture',resolve('scripts','local-reset-r1.mjs'));

rmSync(UPGRADE_STATE,{recursive:true,force:true});
const migrationNames=(await readdir(resolve('migrations')))
  .filter(name=>/^\\d+.*\\.sql$/i.test(name))
  .sort();
const baseNames=migrationNames.filter(name=>name<'0006_');
assert.ok(baseNames.length>=5,'0001~0005 migration 목록 부족');
const baseSql=(await Promise.all(baseNames.map(name=>readFile(resolve('migrations',name),'utf8')))).join('\\n\\n');
const upgradeBaseFile=resolve('.plugpark','r1-upgrade-base.sql');
await writeFile(upgradeBaseFile,baseSql,'utf8');
runWrangler('Upgrade base 0001~0005',[
  'd1','execute',DB,'--local',\`--file=\${upgradeBaseFile}\`,\`--persist-to=\${UPGRADE_STATE}\`,'--yes'
]);
runWrangler('Upgrade migration 0006',[
  'd1','execute',DB,'--local','--file=migrations/0006_v0_8_0_typed_charger_availability.sql',
  \`--persist-to=\${UPGRADE_STATE}\`,'--yes'
]);
runWrangler('Upgrade typed columns query',[
  'd1','execute',DB,'--local',
  '--command=SELECT available_fast_count, available_slow_count FROM ev_stations LIMIT 0; SELECT available_fast_count, available_slow_count FROM ev_station_live_status LIMIT 0;',
  \`--persist-to=\${UPGRADE_STATE}\`,'--yes'
]);

const child=spawn(process.execPath,[
  wrangler(),'dev','--local',
  '--port',String(PORT),
  \`--persist-to=\${STATE}\`,
  '--var','LOCAL_FIXTURE_MODE:true',
  '--var','LIVE_SYNC_ENABLED:true',
  '--var',\`INGEST_ADMIN_TOKEN:\${TOKEN}\`,
  '--var','MATCH_RADIUS_METERS:200'
],{
  cwd:ROOT,
  stdio:'inherit',
  shell:false,
  windowsHide:true,
  env:{...process.env,CI:'1',WRANGLER_SEND_METRICS:'false'}
});

let failed=false;
try{
  process.stdout.write('Local Worker boot ... ');
  await waitForServer(child);
  console.log('PASS');

  for(const stage of ['stations','parking','matches']){
    process.stdout.write(\`Read model \${stage} ... \`);
    await post(\`/api/admin/d1/prepare-read-models?stage=\${stage}\`);
    console.log('PASS');
  }

  process.stdout.write('Fixture live sync ... ');
  const sync=await post('/api/admin/live-sync?kind=all&mode=incremental');
  assert.equal(Number(sync?.ev?.apiCalls||0),0,'fixture EV public API 호출 발생');
  assert.equal(Number(sync?.parking?.apiCalls||0),0,'fixture parking public API 호출 발생');
  console.log('PASS');

  process.stdout.write('/api/places contract ... ');
  const data=await jsonRequest(\`/api/places?r1verify=\${Date.now()}\`);
  assert.equal(data.ok,true);
  assert.equal(data.runtimeMode,'local-fixture','runtimeMode local-fixture 아님');
  assert.equal(data.upstreamEvCalls,0,'user read EV upstream 호출');
  assert.equal(data.upstreamParkingCalls,0,'user read parking upstream 호출');
  assert.equal(data.readModelReady,true,'readModelReady 아님');
  assert.equal(data.evSnapshotComplete,true,'evSnapshotComplete 아님');
  assert.ok(Array.isArray(data.places)&&data.places.length>0,'places 비어 있음');
  console.log(\`PASS · \${data.places.length} places\`);

  process.stdout.write('Typed availability invariants ... ');
  const evPlaces=data.places.filter(place=>place.charger?.total>0);
  assert.ok(evPlaces.length>0,'EV 매칭 장소 없음');
  evPlaces.forEach(assertTypedAvailability);
  console.log(\`PASS · \${evPlaces.length} EV places\`);

  process.stdout.write('Recommendation integration ... ');
  const withCoords=data.places.find(place=>Number.isFinite(place.lat)&&Number.isFinite(place.lng));
  assert.ok(withCoords,'좌표 있는 fixture 장소 없음');
  const {recommendPlaces}=await loadRecommendationEngine();
  const common={
    userLat:withCoords.lat,
    userLng:withCoords.lng,
    radiusKm:null,
    limit:3
  };
  const cases=[
    ['charging','any'],
    ['charging','fast'],
    ['charging','slow'],
    ['parking','any']
  ];
  for(const [mode,chargerPreference] of cases){
    const items=recommendPlaces(data.places,{...common,mode,chargerPreference});
    assertRecommendationContract(items,mode,chargerPreference);
  }
  console.log('PASS · parking/charging(any/fast/slow)');

  console.log('\\n✅ R1 LOCAL INTEGRATION: PASS');
  console.log('Fresh migrations PASS · 0001~0005→0006 upgrade PASS');
  console.log('Local Worker/API PASS · typed availability PASS · recommendation PASS');
  console.log('Remote D1 read=0 · write=0 · deploy=0 · public API=0');
}catch(error){
  failed=true;
  console.error('\\n❌ R1 LOCAL INTEGRATION: FAIL');
  console.error(error instanceof Error?error.stack||error.message:String(error));
  process.exitCode=1;
}finally{
  if(child.exitCode==null){
    child.kill('SIGTERM');
    await Promise.race([
      once(child,'exit').catch(()=>undefined),
      new Promise(resolve=>setTimeout(resolve,2500))
    ]);
  }
  if(!failed) rmSync(UPGRADE_STATE,{recursive:true,force:true});
}
