import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const INPUT = resolve('.plugpark','parking-realtime-coverage-audit.json');
const OUTPUT = resolve('.plugpark','parking-match-candidates-v072.json');
const BASE_URL = process.env.PLUGPARK_URL || 'https://plugpark.dtdt4865.workers.dev';

function norm(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/부산광역시|부산시/g,'')
    .replace(/도시철도|국철|지하철/g,'')
    .replace(/공영주차장|노외공영주차장|노상공영주차장|공영|주차장/g,'')
    .replace(/주변|앞|뒤/g,'')
    .replace(/[\s,.·ㆍ()\[\]{}\-_\/]/g,'')
    .trim();
}

function dice(a,b) {
  if(!a || !b) return 0;
  if(a===b) return 1;
  if(a.length<2 || b.length<2) return 0;
  const pairs=(v)=>{
    const m=new Map();
    for(let i=0;i<v.length-1;i++){
      const p=v.slice(i,i+2);
      m.set(p,(m.get(p)||0)+1);
    }
    return m;
  };
  const l=pairs(a), r=pairs(b);
  let li=0, ri=0, inter=0;
  for(const n of l.values()) li+=n;
  for(const n of r.values()) ri+=n;
  for(const [p,n] of l) inter+=Math.min(n,r.get(p)||0);
  return 2*inter/(li+ri);
}

if(!existsSync(INPUT)) {
  throw new Error('P1 audit 결과가 없습니다: .plugpark/parking-realtime-coverage-audit.json');
}
const audit=JSON.parse(await readFile(INPUT,'utf8'));
const response=await fetch(BASE_URL+'/api/places?v072-match-candidates=1',{
  headers:{Accept:'application/json','Cache-Control':'no-cache'}
});
const raw=await response.text();
let places;
try { places=JSON.parse(raw); }
catch { throw new Error('/api/places JSON 응답이 아닙니다.'); }
if(!response.ok || places?.ok===false) throw new Error('/api/places read 실패');
if(places.upstreamEvCalls!==0 || places.upstreamParkingCalls!==0) {
  throw new Error('read-only 후보 분석 중 upstream 호출 감지');
}

const base=Array.isArray(places.places)?places.places:[];
const unmatched=(audit.items||[]).filter((item)=>item.baseMatch?.status!=='BASE_MATCHED');
const items=unmatched.map((target)=>{
  const tn=norm(target.realtimeName || target.listName);
  const cap=Number(target.capacity);
  const candidates=base.map((p)=>{
    const pn=norm(p.name);
    const nameScore=dice(tn,pn);
    const pcap=Number(p.capacity);
    const capScore=Number.isFinite(cap)&&cap>=0&&Number.isFinite(pcap)&&pcap>=0
      ? Math.max(0,1-Math.abs(pcap-cap)/Math.max(cap,pcap,1))
      : 0;
    return {
      parkingId:String(p.id||''),
      name:String(p.name||''),
      address:String(p.address||''),
      capacity:Number.isFinite(pcap)?pcap:null,
      score:Number((nameScore*0.85+capScore*0.15).toFixed(3)),
      nameScore:Number(nameScore.toFixed(3)),
      capacityScore:Number(capScore.toFixed(3)),
    };
  }).sort((a,b)=>b.score-a.score).slice(0,5);

  return {
    parkingCode:target.parkingCode,
    realtimeName:target.realtimeName || target.listName,
    capacity:target.capacity,
    apiStatus:target.apiStatus,
    candidates,
  };
});

const report={
  version:'v0.7.2-P2',
  generatedAt:new Date().toISOString(),
  sourceAuditVersion:audit.version,
  productionReadOnly:true,
  publicApiCalls:0,
  remoteWrites:0,
  unmatchedCount:items.length,
  items,
};
await mkdir(resolve('.plugpark'),{recursive:true});
await writeFile(OUTPUT,JSON.stringify(report,null,2)+'\n','utf8');

console.log('Parking match candidates:',items.length);
for(const item of items){
  const best=item.candidates[0];
  console.log(`${item.parkingCode} ${item.realtimeName} -> ${best?best.name:'(none)'} (${best?.score ?? 0})`);
}
console.log('Public API calls: 0 · Remote writes: 0');
console.log('result:',OUTPUT);
