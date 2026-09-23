import { spawnSync } from 'node:child_process';

const npm=process.platform==='win32'?'npm.cmd':'npm';

function run(label,script){
  console.log(\`\\n=== \${label} ===\`);
  const r=spawnSync(npm,['run',script],{
    cwd:process.cwd(),
    stdio:'inherit',
    shell:false,
    windowsHide:true,
    env:{...process.env,CI:'1',WRANGLER_SEND_METRICS:'false'}
  });
  if(r.error) throw r.error;
  if(r.status!==0){
    console.error(\`\\n❌ R1 RELEASE GATE STOP · \${label}\`);
    process.exit(r.status??1);
  }
}

console.log('\\nPlugPark v0.8.0-R1 LOCAL RELEASE GATE');
console.log('원격 Cloudflare/API를 호출하지 않는 최종 로컬 검증입니다.');

run('Recommendation','test:recommendation');
run('Recommendation UI / Map / Detail','test:recommendation-ui');
run('Live local contracts','verify:live');
run('Parking match regression','verify:parking-match-v072');
run('D1 read budget','verify:d1-read-budget-v072');
run('Local-only safety','verify:r1-local-only');
run('TypeScript + Vite build','build');
run('Local Worker + D1 integration','verify:r1-integration');

console.log('\\n✅ PlugPark v0.8.0-R1 LOCAL RELEASE GATE: PASS');
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
