import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const VERSION='v0.7.2-P1';
const BASE='https://apis.data.go.kr/B552587/ParkingInfoService_v2';
const PROD='https://plugpark.dtdt4865.workers.dev';
const LIST='/getParkingList_v2';
const LIVE='/getParkingInfoList_v2';
const EXPECTED=50, MAX_LIVE=50, MAX_CALLS=51;
const REQUIRED=['parkgcd','parknm','curravacnt','parkingcnt','maxcnt','lastupdatetime'];
const OUT_JSON=resolve('.plugpark','parking-realtime-coverage-audit.json');
const OUT_CSV=resolve('.plugpark','parking-realtime-coverage-audit.csv');

function parseEnv(text){
  const out={};
  for(const raw of text.split(/\r?\n/)){
    const line=raw.trim();
    if(!line || line.startsWith('#')) continue;
    const i=line.indexOf('=');
    if(i<=0) continue;
    let v=line.slice(i+1).trim();
    if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'"))) v=v.slice(1,-1);
    out[line.slice(0,i).trim()]=v;
  }
  return out;
}
async function envFile(){
  const p=resolve('.dev.vars');
  return existsSync(p)?parseEnv(await readFile(p,'utf8')):{};
}
function baseUrl(input){
  const u=new URL(input);
  u.search=''; u.hash='';
  u.pathname=u.pathname.replace(/\/(?:getParkingList_v2|getParkingInfoList_v2)\/?$/i,'').replace(/\/$/,'');
  return u.toString().replace(/\/$/,'');
}
function makeUrl(base,path){ return new URL(baseUrl(base)+path); }
function obj(v){ return !!v && typeof v==='object' && !Array.isArray(v); }
function deep(v,key){
  if(!v || typeof v!=='object') return null;
  if(!Array.isArray(v) && Object.prototype.hasOwnProperty.call(v,key)) return v[key];
  for(const x of Object.values(v)){ const found=deep(x,key); if(found!=null) return found; }
  return null;
}
function items(v){
  if(!obj(v)) return [];
  const response=obj(v.response)?v.response:v;
  const body=obj(response.body)?response.body:v.body;
  const node=body?.items ?? v.items;
  const item=node?.item ?? node;
  if(Array.isArray(item)) return item.filter(obj);
  return obj(item)?[item]:[];
}
function scalar(raw,names){
  if(!obj(raw)) return '';
  const entries=Object.entries(raw);
  for(const name of names){
    const wanted=name.toLowerCase().replace(/[^a-z0-9]/g,'');
    const hit=entries.find(([k])=>k.toLowerCase().replace(/[^a-z0-9]/g,'')===wanted);
    if(hit && String(hit[1]??'').trim()) return String(hit[1]).trim();
  }
  return '';
}
function num(v){
  if(v==null || String(v).trim()==='') return null;
  const n=Number(String(v).replace(/,/g,'').trim());
  return Number.isFinite(n)?n:null;
}
function clean(v){
  const s=String(v??'').trim();
  return !s || s==='-' || s.toLowerCase()==='null' ? '' : s;
}
function normName(v){
  return clean(v).toLowerCase()
    .replace(/부산광역시|부산시/g,'')
    .replace(/공영주차장|노외공영주차장|노상공영주차장|공영|주차장/g,'')
    .replace(/[\s,\.·ㆍ()\[\]{}\-_\/]/g,'').trim();
}
function dice(a,b){
  if(!a||!b) return 0;
  if(a===b) return 1;
  if(a.length<2||b.length<2) return 0;
  const pairs=(s)=>{ const m=new Map(); for(let i=0;i<s.length-1;i++){ const p=s.slice(i,i+2); m.set(p,(m.get(p)||0)+1); } return m; };
  const l=pairs(a), r=pairs(b);
  let inter=0, lc=0, rc=0;
  for(const n of l.values()) lc+=n;
  for(const n of r.values()) rc+=n;
  for(const [p,n] of l) inter+=Math.min(n,r.get(p)||0);
  return 2*inter/(lc+rc);
}
function matcher(basePlaces){
  const bases=basePlaces.map((p,index)=>({index,id:String(p?.id??''),name:String(p?.name??''),n:normName(p?.name??'')})).filter(x=>x.id&&x.n);
  const used=new Set();
  return (name)=>{
    const n=normName(name);
    if(!n) return {status:'BASE_UNMATCHED',matched:false,parkingId:null,parkingName:null,method:'unmatched',score:null};
    const c=bases.filter(x=>!used.has(x.index));
    const exact=c.filter(x=>x.n===n);
    let chosen=null, method='unmatched', score=null;
    if(exact.length===1){ chosen=exact[0]; method='exact-name'; score=1; }
    else if(exact.length>1){ method='ambiguous'; }
    else{
      const contained=c.filter(x=>Math.min(x.n.length,n.length)>=4 && (x.n.includes(n)||n.includes(x.n)));
      if(contained.length===1){ chosen=contained[0]; method='contained-name'; score=.94; }
      else if(contained.length>1){ method='ambiguous'; }
      else{
        const ranked=c.map(x=>({x,s:dice(n,x.n)})).sort((a,b)=>b.s-a.s);
        const best=ranked[0], second=ranked[1];
        if(best && best.s>=.84 && (!second || best.s-second.s>=.08)){ chosen=best.x; method='similar-name'; score=Number(best.s.toFixed(3)); }
        else if(best && best.s>=.84){ method='ambiguous'; score=Number(best.s.toFixed(3)); }
      }
    }
    if(!chosen) return {status:method==='ambiguous'?'BASE_AMBIGUOUS':'BASE_UNMATCHED',matched:false,parkingId:null,parkingName:null,method,score};
    used.add(chosen.index);
    return {status:'BASE_MATCHED',matched:true,parkingId:chosen.id,parkingName:chosen.name,method,score};
  };
}
function inspect(raw){
  if(!obj(raw)) return {apiStatus:'LIVE_SCHEMA_INVALID',missingFields:[...REQUIRED],available:null,occupied:null,capacity:null,numericConsistent:false,error:'response item is not an object'};
  const missing=REQUIRED.filter(k=>!Object.prototype.hasOwnProperty.call(raw,k)||clean(raw[k])==='');
  const available=num(raw.curravacnt), occupied=num(raw.parkingcnt), capacity=num(raw.maxcnt);
  if(missing.length) return {apiStatus:'LIVE_SCHEMA_INVALID',missingFields:missing,available,occupied,capacity,numericConsistent:false,error:'missing='+missing.join(',')};
  const ok=available!=null&&occupied!=null&&capacity!=null&&available>=0&&occupied>=0&&capacity>=0&&Math.abs(available+occupied-capacity)<=1;
  if(!ok) return {apiStatus:'LIVE_NUMERIC_INVALID',missingFields:[],available,occupied,capacity,numericConsistent:false,error:'numeric mismatch: available='+available+', occupied='+occupied+', capacity='+capacity};
  return {apiStatus:'LIVE_OK',missingFields:[],available,occupied,capacity,numericConsistent:true,error:null};
}
function csvCell(v){
  const s=v==null?'':String(v);
  return /[",\r\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;
}
function csv(rows){
  const h=['code','name','api_status','available','occupied','capacity','source_updated_at','match_status','matched_id','matched_name','match_method','match_score','error'];
  const body=rows.map(x=>[x.parkingCode,x.realtimeName||x.listName,x.apiStatus,x.available,x.occupied,x.capacity,x.sourceUpdatedAt,x.baseMatch?.status??'',x.baseMatch?.parkingId??'',x.baseMatch?.parkingName??'',x.baseMatch?.method??'',x.baseMatch?.score??'',x.error??'']);
  return [h,...body].map(r=>r.map(csvCell).join(',')).join('\n')+'\n';
}
function summary(rows,total){
  const c=s=>rows.filter(x=>x.apiStatus===s).length;
  const m=s=>rows.filter(x=>x.baseMatch?.status===s).length;
  const usable=rows.filter(x=>x.apiStatus==='LIVE_OK'&&x.baseMatch?.status==='BASE_MATCHED').length;
  return {parkingCount:total,liveOk:c('LIVE_OK'),liveEmpty:c('LIVE_EMPTY'),schemaInvalid:c('LIVE_SCHEMA_INVALID'),numericInvalid:c('LIVE_NUMERIC_INVALID'),apiError:c('API_ERROR'),httpError:c('HTTP_ERROR'),networkError:c('NETWORK_ERROR'),matched:m('BASE_MATCHED'),unmatched:m('BASE_UNMATCHED'),ambiguous:m('BASE_AMBIGUOUS'),usable,coveragePercent:Number((usable/total*100).toFixed(1))};
}
function print(s,calls){
  console.log('\n==================================================');
  console.log('PlugPark Parking Realtime Coverage Audit');
  console.log('==================================================');
  console.log('목록 주차장             : '+s.parkingCount);
  console.log('실시간 정상             : '+s.liveOk);
  console.log('실시간 빈 응답          : '+s.liveEmpty);
  console.log('스키마 비정상           : '+s.schemaInvalid);
  console.log('수치 비정상             : '+s.numericInvalid);
  console.log('API 오류                : '+s.apiError);
  console.log('HTTP 오류               : '+s.httpError);
  console.log('네트워크 오류           : '+s.networkError);
  console.log('PlugPark 매칭 성공      : '+s.matched);
  console.log('매칭 실패               : '+s.unmatched);
  console.log('모호한 매칭             : '+s.ambiguous);
  console.log('실제 사용 가능          : '+s.usable+' / '+s.parkingCount);
  console.log('Coverage                : '+s.coveragePercent.toFixed(1)+'%');
  console.log('Public API calls        : '+calls);
  console.log('Remote D1 writes        : 0');
  console.log('Cloudflare writes       : 0');
  console.log('==================================================');
}
async function selfTest(){
  const match=matcher([{id:'B1',name:'해운대센텀시티 공영주차장'}]);
  const good=inspect({parkgcd:'A01',parknm:'해운대센텀시티 공영주차장',curravacnt:'31',parkingcnt:'49',maxcnt:'80',lastupdatetime:'2026-09-22 15:00:00'});
  const bad=inspect({parkgcd:'A02',parknm:'X',curravacnt:'40',parkingcnt:'70',maxcnt:'100',lastupdatetime:'2026-09-22 15:00:00'});
  const m=match('해운대센텀시티 공영주차장');
  if(good.apiStatus!=='LIVE_OK'||bad.apiStatus!=='LIVE_NUMERIC_INVALID'||m.status!=='BASE_MATCHED'||m.method!=='exact-name') throw new Error('coverage audit self-test failed');
  console.log('✅ PARKING COVERAGE AUDIT SELF-TEST: PASS');
  console.log('Public API calls: 0 · Remote D1 writes: 0 · Cloudflare writes: 0');
}
if(process.argv.includes('--self-test')){ await selfTest(); process.exit(0); }
if(!process.argv.includes('--confirm-live-audit')){
  console.error('\n[BLOCKED] 실제 전수 조회는 명시적 확인이 필요합니다.');
  console.error('npm run audit:parking-coverage 로 실행하세요.\n');
  process.exit(2);
}

const fileEnv=await envFile();
const key=String(process.env.BUSAN_PARKING_API_KEY||fileEnv.BUSAN_PARKING_API_KEY||'').trim();
if(!key) throw new Error('BUSAN_PARKING_API_KEY가 없습니다. 로컬 .dev.vars를 확인하세요.');
const apiBase=baseUrl(String(process.env.BUSAN_REALTIME_PARKING_API_URL||fileEnv.BUSAN_REALTIME_PARKING_API_URL||BASE).trim());
const prod=String(process.env.PLUGPARK_URL||PROD).replace(/\/$/,'');
let calls=0, liveCalls=0;

async function apiGet(url,label,isLive=false){
  if(isLive && liveCalls>=MAX_LIVE) throw new Error('AUDIT_CALL_BUDGET_EXCEEDED: realtime > 50');
  if(calls>=MAX_CALLS) throw new Error('AUDIT_CALL_BUDGET_EXCEEDED: total > 51');
  calls++; if(isLive) liveCalls++;
  let r;
  try{ r=await fetch(url,{method:'GET',headers:{Accept:'application/json'}}); }
  catch(e){ return {kind:'NETWORK_ERROR',status:null,json:null,resultCode:null,error:e instanceof Error?e.message:String(e)}; }
  const text=await r.text();
  let json=null; try{json=JSON.parse(text);}catch{}
  if(!r.ok) return {kind:'HTTP_ERROR',status:r.status,json,resultCode:null,error:label+': HTTP '+r.status};
  const rc=json?deep(json,'resultCode'):null, rm=json?deep(json,'resultMsg'):null;
  if(rc!=null && !['00','0'].includes(String(rc).trim())) return {kind:'API_ERROR',status:r.status,json,resultCode:String(rc),error:label+': resultCode='+rc+(rm?' '+rm:'')};
  if(!json) return {kind:'LIVE_SCHEMA_INVALID',status:r.status,json:null,resultCode:null,error:label+': JSON 응답이 아닙니다.'};
  return {kind:'OK',status:r.status,json,resultCode:rc==null?null:String(rc),error:null};
}
async function productionPlaces(){
  const r=await fetch(prod+'/api/places?coverage-audit=1',{method:'GET',headers:{Accept:'application/json','Cache-Control':'no-cache'}});
  const text=await r.text(); let json;
  try{json=JSON.parse(text);}catch{throw new Error('/api/places JSON 실패 HTTP '+r.status);}
  if(!r.ok||json?.ok===false) throw new Error('/api/places read 실패: '+(json?.error||r.status));
  if(Number(json.upstreamEvCalls||0)!==0||Number(json.upstreamParkingCalls||0)!==0) throw new Error('AUDIT_ABORT: /api/places upstream call 감지');
  if(!Array.isArray(json.places)||!json.places.length) throw new Error('AUDIT_ABORT: base parking 데이터 없음');
  return json;
}

console.log('\nPlugPark '+VERSION+' Parking Realtime Coverage Audit');
console.log('공공 API 최대 51회 · retry 0 · Remote D1/Cloudflare write 0\n');

const places=await productionPlaces();
const match=matcher(places.places);
console.log('PlugPark base read model ... PASS · parking='+places.places.length+' · upstream=0');

const listUrl=makeUrl(apiBase,LIST);
listUrl.searchParams.set('serviceKey',key);
listUrl.searchParams.set('pageNo','1');
listUrl.searchParams.set('numOfRows','100');
listUrl.searchParams.set('resultType','json');
const listRes=await apiGet(listUrl,'getParkingList_v2');
if(listRes.kind!=='OK') throw new Error('PARKING_LIST_FAILED: '+listRes.error);
const listItems=items(listRes.json);
const total=num(deep(listRes.json,'totalCount'));
const codes=new Set(listItems.map(x=>scalar(x,['parkgcd','pParkGCd','parkingCode','parkGcd'])).filter(Boolean));
if(total!==EXPECTED||listItems.length!==EXPECTED||codes.size!==EXPECTED) throw new Error('PARKING_LIST_COUNT_CHANGED: expected=50 totalCount='+total+' itemCount='+listItems.length+' uniqueCodes='+codes.size+'. 실시간 전수조사를 시작하지 않았습니다.');
console.log('Parking list ... PASS · totalCount='+total+' · items='+listItems.length+' · uniqueCodes='+codes.size);

const rows=[];
for(let i=0;i<listItems.length;i++){
  const li=listItems[i];
  const code=scalar(li,['parkgcd','pParkGCd','parkingCode','parkGcd']);
  const listName=scalar(li,['parknm','pParkNm','parkingName','parkNm']);
  const u=makeUrl(apiBase,LIVE);
  u.searchParams.set('serviceKey',key);
  u.searchParams.set('pageNo','1');
  u.searchParams.set('numOfRows','10');
  u.searchParams.set('pParkGCd',code);
  u.searchParams.set('resultType','json');
  const res=await apiGet(u,'getParkingInfoList_v2 '+code,true);
  const row={index:i+1,parkingCode:code,listName,realtimeName:'',apiStatus:'LIVE_EMPTY',httpStatus:res.status,resultCode:res.resultCode??null,available:null,occupied:null,capacity:null,sourceUpdatedAt:null,numericConsistent:null,missingFields:[],baseMatch:null,error:null};
  if(res.kind!=='OK'){
    row.apiStatus=res.kind; row.error=res.error; rows.push(row);
    console.log('['+String(i+1).padStart(2,'0')+'/50] '+code+' '+row.apiStatus); continue;
  }
  const live=items(res.json);
  if(!live.length){ rows.push(row); console.log('['+String(i+1).padStart(2,'0')+'/50] '+code+' LIVE_EMPTY'); continue; }
  const raw=live[0], checked=inspect(raw);
  row.apiStatus=checked.apiStatus;
  row.realtimeName=clean(raw.parknm)||listName;
  row.available=checked.available; row.occupied=checked.occupied; row.capacity=checked.capacity;
  row.sourceUpdatedAt=clean(raw.lastupdatetime)||null;
  row.numericConsistent=checked.numericConsistent; row.missingFields=checked.missingFields; row.error=checked.error;
  if(live.length>1) row.error=[row.error,'unexpected itemCount='+live.length].filter(Boolean).join('; ');
  row.baseMatch=match(row.realtimeName);
  rows.push(row);
  console.log('['+String(i+1).padStart(2,'0')+'/50] '+code+' '+row.apiStatus+' · '+row.baseMatch.status);
}
if(calls>MAX_CALLS||liveCalls>MAX_LIVE) throw new Error('AUDIT_CALL_BUDGET_EXCEEDED: public='+calls+' realtime='+liveCalls);

const sum=summary(rows,listItems.length);
const report={
  version:VERSION,auditedAt:new Date().toISOString(),
  source:{service:'ParkingInfoService_v2',listOperation:LIST,realtimeOperation:LIVE,baseEndpoint:apiBase},
  productionReadModel:{url:prod,parkingCount:places.places.length,userReadUpstreamEvCalls:Number(places.upstreamEvCalls||0),userReadUpstreamParkingCalls:Number(places.upstreamParkingCalls||0)},
  requests:{list:1,realtime:liveCalls,total:calls,maxTotal:MAX_CALLS,retries:0},
  remoteD1Writes:0,cloudflareWrites:0,workerDeploys:0,summary:sum,items:rows
};
await mkdir(resolve('.plugpark'),{recursive:true});
await writeFile(OUT_JSON,JSON.stringify(report,null,2)+'\n','utf8');
await writeFile(OUT_CSV,csv(rows),'utf8');
print(sum,calls);
console.log('\nJSON: '+OUT_JSON);
console.log('CSV : '+OUT_CSV);
console.log('\n✅ PARKING REALTIME COVERAGE AUDIT: COMPLETE');
