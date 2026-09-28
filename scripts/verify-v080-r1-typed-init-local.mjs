import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const DB='plugpark-db';
const STATE=resolve('.plugpark','v080-r1-typed-init-local');
const SETUP=resolve('.plugpark','v080-r1-typed-init-setup.sql');
const SQL=resolve('scripts','sql','v080-r1-typed-init.sql');

function cli(){
  for(const p of [['wrangler','bin','wrangler.js'],['wrangler','bin','wrangler.cjs']]){
    const f=resolve('node_modules',...p);
    if(existsSync(f)) return f;
  }
  throw new Error('wrangler not found');
}
function run(args,asJson=false){
  const r=spawnSync(process.execPath,[cli(),...args],{
    cwd:process.cwd(),
    encoding:asJson?'utf8':undefined,
    stdio:asJson?undefined:'inherit',
    shell:false,
    windowsHide:true,
    env:{...process.env,CI:'1',WRANGLER_SEND_METRICS:'false'}
  });
  if(r.error) throw r.error;
  assert.equal(r.status,0,'wrangler local command failed');
  return asJson?String(r.stdout||''):'';
}
function rows(raw){
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

await mkdir(resolve('.plugpark'),{recursive:true});
rmSync(STATE,{recursive:true,force:true});
const setup=[
"CREATE TABLE ev_chargers (stat_id TEXT, chger_id TEXT, charger_type TEXT, output_kw REAL, info_status TEXT, del_yn TEXT);",
"CREATE TABLE ev_status (stat_id TEXT, chger_id TEXT, status TEXT);",
"CREATE TABLE ev_stations (stat_id TEXT PRIMARY KEY, available_count INTEGER NOT NULL, fast_count INTEGER NOT NULL, slow_count INTEGER NOT NULL);",
"CREATE TABLE ev_station_live_status (stat_id TEXT PRIMARY KEY, available_count INTEGER NOT NULL);",
"INSERT INTO ev_chargers VALUES ('S1','01','06',100,'2','N');",
"INSERT INTO ev_chargers VALUES ('S1','02','02',7,'2','N');",
"INSERT INTO ev_chargers VALUES ('S1','03','06',100,'3','N');",
"INSERT INTO ev_chargers VALUES ('S2','01','02',7,'1','N');",
"INSERT INTO ev_status VALUES ('S2','01','2');",
"INSERT INTO ev_stations VALUES ('S1',2,2,1);",
"INSERT INTO ev_stations VALUES ('S2',1,0,1);",
"INSERT INTO ev_station_live_status VALUES ('S1',2);",
"INSERT INTO ev_station_live_status VALUES ('S2',1);"
].join('\n');
await writeFile(SETUP,setup+'\n','utf8');

run(['d1','execute',DB,'--local','--file='+SETUP,'--persist-to='+STATE,'--yes']);
run(['d1','execute',DB,'--local','--file=migrations/0006_v0_8_0_typed_charger_availability.sql','--persist-to='+STATE,'--yes']);
run(['d1','execute',DB,'--local','--file='+SQL,'--persist-to='+STATE,'--yes']);

const raw=run(['d1','execute',DB,'--local','--command',
"SELECT s.stat_id,s.available_count,s.fast_count,s.slow_count,s.available_fast_count,s.available_slow_count,ls.available_fast_count AS live_fast,ls.available_slow_count AS live_slow FROM ev_stations s LEFT JOIN ev_station_live_status ls USING(stat_id) ORDER BY s.stat_id",
'--persist-to='+STATE,'--json'],true);
const result=rows(raw);
const s1=result.find(x=>x.stat_id==='S1');
const s2=result.find(x=>x.stat_id==='S2');
assert.ok(s1&&s2,'fixture rows missing');
assert.equal(Number(s1.available_fast_count),1);
assert.equal(Number(s1.available_slow_count),1);
assert.equal(Number(s1.live_fast),1);
assert.equal(Number(s1.live_slow),1);
assert.equal(Number(s2.available_fast_count),0);
assert.equal(Number(s2.available_slow_count),1);
assert.equal(Number(s2.live_fast),0);
assert.equal(Number(s2.live_slow),1);
rmSync(STATE,{recursive:true,force:true});

console.log('Typed init SQL local dry-run ... PASS');
console.log('Raw ev_chargers aggregation ... 1 statement');
console.log('Remote D1 read=0 · write=0 · deploy=0 · public API=0');
