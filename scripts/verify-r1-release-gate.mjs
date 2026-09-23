import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const RECEIPT=resolve('.plugpark','v080-r1-local-gate-result.json');

function npmRunCommand(script){
  const npmExecPath=String(process.env.npm_execpath||'').trim();
  if(npmExecPath){
    return {command:process.execPath,args:[npmExecPath,'run',script]};
  }
  if(process.platform==='win32'){
    return {
      command:process.env.ComSpec||'cmd.exe',
      args:['/d','/s','/c','npm.cmd','run',script],
    };
  }
  return {command:'npm',args:['run',script]};
}

function gitHead(){
  const r=spawnSync('git',['rev-parse','HEAD'],{encoding:'utf8',shell:false,windowsHide:true});
  if(r.error||r.status!==0) throw new Error('git HEAD 확인 실패');
  return r.stdout.trim();
}

function run(label,script){
  console.log(`\n=== ${label} ===`);
  const {command,args}=npmRunCommand(script);
  const r=spawnSync(command,args,{
    cwd:process.cwd(),
    stdio:'inherit',
    shell:false,
    windowsHide:true,
    env:{...process.env,CI:'1',WRANGLER_SEND_METRICS:'false'}
  });
  if(r.error) throw r.error;
  if(r.status!==0){
    console.error(`\n❌ R1 RELEASE GATE STOP · ${label}`);
    process.exit(r.status??1);
  }
}

console.log('\nPlugPark v0.8.0-R1 LOCAL RELEASE GATE');
console.log('원격 Cloudflare/API를 호출하지 않는 최종 로컬 검증입니다.');

run('Recommendation','test:recommendation');
run('Recommendation UI / Map / Detail','test:recommendation-ui');
run('Live local contracts','verify:live');
run('Parking match regression','verify:parking-match-v072');
run('D1 read budget','verify:d1-read-budget-v072');
run('Local-only safety','verify:r1-local-only');
run('TypeScript + Vite build','build');
run('Local Worker + D1 integration','verify:r1-integration');

console.log('\n✅ PlugPark v0.8.0-R1 LOCAL RELEASE GATE: PASS');
console.log('Recommendation       PASS');
console.log('Typed availability  PASS');
console.log('Parking match        PASS');
console.log('UI integration       PASS');
console.log('D1 read budget       PASS');
console.log('Local Worker / D1    PASS');
console.log('Build                PASS');
console.log('');
console.log('Remote D1 read       0');
console.log('Remote D1 write      0');
console.log('Deploy               0');
console.log('Public API call      0');

await mkdir(resolve('.plugpark'),{recursive:true});
await writeFile(RECEIPT,JSON.stringify({version:'v0.8.0-R1',gitHead:gitHead(),passed:true,remoteD1Reads:0,remoteD1Writes:0,deployCalls:0,publicApiCalls:0,verifiedAt:new Date().toISOString()},null,2)+'\n','utf8');
console.log('Local gate receipt: '+RECEIPT);
