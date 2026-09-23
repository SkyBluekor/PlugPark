import { spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const ROOT=process.cwd();
const DB='plugpark-db';
const STATE=resolve('.plugpark','r1-local-state');
const SCHEMA=resolve('.plugpark','r1-local-schema.sql');
const FIXTURE=resolve('tests','fixtures','local-recovery-seed.sql');

function wrangler(){
  for(const p of [['wrangler','bin','wrangler.js'],['wrangler','bin','wrangler.cjs']]){
    const f=resolve('node_modules',...p); if(existsSync(f)) return f;
  }
  throw new Error('npm ci 후 다시 실행하세요.');
}
function run(label,args){
  process.stdout.write(label+' ... ');
  const r=spawnSync(process.execPath,[wrangler(),...args],{cwd:ROOT,stdio:'inherit',shell:false,windowsHide:true,env:{...process.env,CI:'1',WRANGLER_SEND_METRICS:'false'}});
  if(r.error) throw r.error;
  if(r.status!==0) throw new Error(label+' 실패');
  console.log('PASS');
}
console.log('\nPlugPark R1 LOCAL RESET');
console.log('Remote Cloudflare read=0 · write=0 · public API=0\n');
rmSync(STATE,{recursive:true,force:true});
await mkdir(resolve('.plugpark'),{recursive:true});
const names=(await readdir(resolve('migrations'))).filter(n=>/^\d+.*\.sql$/i.test(n)).sort();
const sql=(await Promise.all(names.map(n=>readFile(resolve('migrations',n),'utf8')))).join('\n\n');
await writeFile(SCHEMA,sql,'utf8');
run('Local D1 migrations',['d1','execute',DB,'--local',`--file=${SCHEMA}`,`--persist-to=${STATE}`,'--yes']);
run('Local fixture seed',['d1','execute',DB,'--local',`--file=${FIXTURE}`,`--persist-to=${STATE}`,'--yes']);
console.log('\n✅ LOCAL RESET PASS · 운영 Cloudflare 사용량 0');
