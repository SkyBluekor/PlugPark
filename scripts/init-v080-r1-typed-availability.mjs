import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const DB='plugpark-db';
const SQL=resolve('scripts','sql','v080-r1-typed-init.sql');
const RECEIPT=resolve('.plugpark','v080-r1-typed-init-result.json');
const remote=process.argv.includes('--remote');
const explicitLocal=process.argv.includes('--local');
const confirmed=process.argv.includes('--confirm-remote');
if(remote&&!confirmed) throw new Error('remote typed init requires --confirm-remote');
if(remote&&explicitLocal) throw new Error('choose either --local or --remote');
const local=!remote;

function cli(){
  for(const p of [['wrangler','bin','wrangler.js'],['wrangler','bin','wrangler.cjs']]){
    const f=resolve('node_modules',...p);
    if(existsSync(f)) return f;
  }
  throw new Error('wrangler not found');
}
function exec(args,asJson=false){
  const env={...process.env,WRANGLER_SEND_METRICS:'false'};
  if(remote) delete env.CI;
  else env.CI='1';
  const r=spawnSync(process.execPath,[cli(),...args],{
    cwd:process.cwd(),
    encoding:asJson?'utf8':undefined,
    stdio:asJson?undefined:'inherit',
    shell:false,
    windowsHide:true,
    env
  });
  if(r.error) throw r.error;
  if(r.status!==0) throw new Error('Wrangler command failed. Do not retry automatically. exit='+r.status);
  return asJson?String(r.stdout||''):'';
}
function findRows(raw){
  const start=raw.indexOf('[');
  const value=JSON.parse(start>=0?raw.slice(start):raw);
  const out=[];
  const walk=(v)=>{
    if(Array.isArray(v)) for(const x of v) walk(x);
    else if(v&&typeof v==='object'){
      if(Array.isArray(v.results)) out.push(...v.results);
      for(const x of Object.values(v)) walk(x);
    }
  };
  walk(value);
  return out;
}

const location=remote?'--remote':'--local';
const persist=local?['--persist-to='+resolve('.plugpark','r1-local-state')]:[];
console.log('Typed availability init · '+(remote?'REMOTE CONFIRMED':'LOCAL'));
console.log('write command=1 · automatic retry=0');

exec(['d1','execute',DB,location,'--file='+SQL,'--yes',...persist]);

const verifySql="SELECT 'stations' AS model, COUNT(*) AS row_count, SUM(CASE WHEN available_fast_count<0 OR available_slow_count<0 OR available_fast_count>fast_count OR available_slow_count>slow_count OR available_fast_count+available_slow_count>available_count THEN 1 ELSE 0 END) AS invalid_count FROM ev_stations UNION ALL SELECT 'live' AS model, COUNT(*) AS row_count, SUM(CASE WHEN s.stat_id IS NULL OR ls.available_fast_count<0 OR ls.available_slow_count<0 OR ls.available_fast_count>s.fast_count OR ls.available_slow_count>s.slow_count OR ls.available_fast_count+ls.available_slow_count>ls.available_count THEN 1 ELSE 0 END) AS invalid_count FROM ev_station_live_status ls LEFT JOIN ev_stations s USING(stat_id)";
const raw=exec(['d1','execute',DB,location,'--command',verifySql,'--json',...persist],true);
const rows=findRows(raw).filter(x=>x&&x.model);
assert.equal(rows.length,2,'typed verification rows missing');
for(const row of rows) assert.equal(Number(row.invalid_count||0),0,row.model+' typed invariant failure');

await mkdir(resolve('.plugpark'),{recursive:true});
await writeFile(RECEIPT,JSON.stringify({
  version:'v0.8.0-R1',
  mode:remote?'remote':'local',
  writeCommands:1,
  verificationQueries:1,
  rawVerificationScans:0,
  rows,
  verifiedAt:new Date().toISOString()
},null,2)+'\n','utf8');

console.log('Typed availability invariants ... PASS');
console.log('Receipt: '+RECEIPT);
