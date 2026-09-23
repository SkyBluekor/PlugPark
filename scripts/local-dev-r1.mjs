import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT=process.cwd();
const PORT=Number(process.env.PLUGPARK_LOCAL_PORT||8787);
const STATE=resolve('.plugpark','r1-local-state');
const TOKEN='plugpark-r1-local-only';

function bin(){
  for(const p of [['wrangler','bin','wrangler.js'],['wrangler','bin','wrangler.cjs']]){
    const f=resolve('node_modules',...p); if(existsSync(f)) return f;
  }
  throw new Error('npm ci 후 다시 실행하세요.');
}
const reset=spawnSync(process.execPath,[resolve('scripts','local-reset-r1.mjs')],{
  cwd:ROOT,stdio:'inherit',shell:false,windowsHide:true,
  env:{...process.env,CI:'1',WRANGLER_SEND_METRICS:'false'}
});
if(reset.error) throw reset.error;
if(reset.status!==0) process.exit(reset.status??1);

const child=spawn(process.execPath,[
  bin(),'dev','--local','--port',String(PORT),`--persist-to=${STATE}`,
  '--var','LOCAL_FIXTURE_MODE:true','--var','LIVE_SYNC_ENABLED:true',
  '--var',`INGEST_ADMIN_TOKEN:${TOKEN}`,'--var','MATCH_RADIUS_METERS:200'
],{
  cwd:ROOT,stdio:'inherit',shell:false,windowsHide:true,
  env:{...process.env,WRANGLER_SEND_METRICS:'false'}
});
console.log(`\nPlugPark local Worker: http://127.0.0.1:${PORT}`);
console.log('Cloudflare remote usage=0 · Ctrl+C 종료\n');
for(const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>{if(child.exitCode==null) child.kill(signal);});
child.on('exit',code=>process.exit(code??0));
