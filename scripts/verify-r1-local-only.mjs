import { readFile } from 'node:fs/promises';
function ok(v,m){if(!v) throw new Error(m);}
const pkg=JSON.parse(await readFile('package.json','utf8'));
const worker=await readFile('worker/index.ts','utf8');
const reset=await readFile('scripts/local-reset-r1.mjs','utf8');
for(const name of ['local:reset','local:verify']){
  const s=pkg.scripts?.[name]; ok(typeof s==='string',name+' 없음');
  ok(!s.includes('--remote')&&!/deploy|release:/i.test(s),name+'이 remote 작업을 포함함');
}
ok(!reset.includes("'--remote'")&&!reset.includes('"--remote"'),'local reset에 remote 호출 있음');
const a=worker.indexOf('async function handlePlaces');
const b=worker.indexOf('/* -------------------------------------------------------------------------- */\n/* v0.7.0 live data sync',a);
const places=worker.slice(a,b);
ok(a>=0&&b>a,'handlePlaces 범위 없음');
ok(!places.includes('FROM ev_chargers'),'/api/places가 ev_chargers 직접 scan');
ok(places.includes('ls.available_fast_count'),'fast live read-model 누락');
ok(places.includes('ls.available_slow_count'),'slow live read-model 누락');
console.log('R1 local-only guard ... PASS');
console.log('Cloudflare remote read=0 · write=0 · deploy=0');
