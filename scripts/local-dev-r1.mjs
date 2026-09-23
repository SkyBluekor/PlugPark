import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT=process.cwd();
const PORT=Number(process.env.PLUGPARK_LOCAL_PORT||8787);
const BASE_URL=`http://127.0.0.1:${PORT}`;
const STATE=resolve('.plugpark','r1-local-state');
const TOKEN='plugpark-r1-local-only';

function bin(){
  for(const p of [['wrangler','bin','wrangler.js'],['wrangler','bin','wrangler.cjs']]){
    const f=resolve('node_modules',...p);
    if(existsSync(f)) return f;
  }
  throw new Error('npm ci 후 다시 실행하세요.');
}

const reset=spawnSync(process.execPath,[resolve('scripts','local-reset-r1.mjs')],{
  cwd:ROOT,
  stdio:'inherit',
  shell:false,
  windowsHide:true,
  env:{...process.env,CI:'1',WRANGLER_SEND_METRICS:'false'}
});
if(reset.error) throw reset.error;
if(reset.status!==0) process.exit(reset.status??1);

const child=spawn(process.execPath,[
  bin(),'dev','--local',
  '--port',String(PORT),
  `--persist-to=${STATE}`,
  '--var','LOCAL_FIXTURE_MODE:true',
  '--var','LIVE_SYNC_ENABLED:true',
  '--var',`INGEST_ADMIN_TOKEN:${TOKEN}`,
  '--var','MATCH_RADIUS_METERS:200'
],{
  cwd:ROOT,
  stdio:['inherit','inherit','inherit'],
  shell:false,
  windowsHide:true,
  env:{...process.env,WRANGLER_SEND_METRICS:'false'}
});

async function waitForServer(timeoutMs=60000){
  const deadline=Date.now()+timeoutMs;
  let lastError='not started';
  while(Date.now()<deadline){
    if(child.exitCode!=null) throw new Error(`wrangler dev가 먼저 종료되었습니다 (exit=${child.exitCode})`);
    try{
      const r=await fetch(`${BASE_URL}/api/health`,{headers:{Accept:'application/json'}});
      if(r.ok) return;
      lastError=`HTTP ${r.status}`;
    }catch(error){
      lastError=error instanceof Error?error.message:String(error);
    }
    await new Promise(r=>setTimeout(r,400));
  }
  throw new Error(`Local Worker 시작 시간 초과: ${lastError}`);
}

async function post(path){
  const r=await fetch(`${BASE_URL}${path}`,{
    method:'POST',
    headers:{
      Accept:'application/json',
      Authorization:`Bearer ${TOKEN}`,
      'Cache-Control':'no-cache'
    }
  });
  const raw=await r.text();
  let data;
  try{ data=JSON.parse(raw); }
  catch{ throw new Error(`${path}: JSON 아님 (HTTP ${r.status}) ${raw.slice(0,250)}`); }
  if(!r.ok||data?.ok===false){
    throw new Error(`${path}: ${data?.error||data?.message||`HTTP ${r.status}`}`);
  }
  return data;
}

try{
  process.stdout.write('\nLocal Worker 시작 ... ');
  await waitForServer();
  console.log('PASS');

  for(const stage of ['stations','parking','matches']){
    process.stdout.write(`Read model ${stage} 준비 ... `);
    await post(`/api/admin/d1/prepare-read-models?stage=${stage}`);
    console.log('PASS');
  }

  process.stdout.write('Fixture live sync ... ');
  const sync=await post('/api/admin/live-sync?kind=all&mode=incremental');
  if(Number(sync?.ev?.apiCalls||0)!==0) throw new Error(`fixture EV apiCalls=${sync?.ev?.apiCalls}`);
  if(Number(sync?.parking?.apiCalls||0)!==0) throw new Error(`fixture parking apiCalls=${sync?.parking?.apiCalls}`);
  console.log('PASS');

  console.log('\n✅ PlugPark LOCAL DEV READY');
  console.log(`UI/API: ${BASE_URL}`);
  console.log('LOCAL_FIXTURE_MODE=true · Cloudflare remote usage=0 · public API calls=0');
  console.log('Ctrl+C 종료\n');
}catch(error){
  console.error('\n❌ LOCAL DEV PREPARE FAIL');
  console.error(error instanceof Error?error.message:String(error));
  if(child.exitCode==null) child.kill('SIGTERM');
  process.exitCode=1;
}

for(const signal of ['SIGINT','SIGTERM']){
  process.on(signal,()=>{ if(child.exitCode==null) child.kill(signal); });
}
child.on('exit',code=>{
  if(process.exitCode==null) process.exitCode=code??0;
});
