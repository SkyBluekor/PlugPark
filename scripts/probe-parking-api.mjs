import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const RESULT = resolve('.plugpark', 'parking-api-probe.json');
const BASE_DEFAULT = 'https://apis.data.go.kr/B552587/ParkingInfoService_v2';
const LIST_PATH = '/getParkingList_v2';
const REALTIME_PATH = '/getParkingInfoList_v2';
const REALTIME_REQUIRED = ['parkgcd','parknm','curravacnt','parkingcnt','maxcnt','lastupdatetime'];

function parseEnvText(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}
async function localEnv() {
  const p = resolve('.dev.vars');
  if (!existsSync(p)) return {};
  return parseEnvText(await readFile(p, 'utf8'));
}
function normalizeBase(input) {
  const u = new URL(input);
  u.search = '';
  u.hash = '';
  u.pathname = u.pathname
    .replace(/\/(?:getParkingList_v2|getParkingInfoList_v2)\/?$/i, '')
    .replace(/\/$/, '');
  return u.toString().replace(/\/$/, '');
}
function endpoint(base, path) {
  return new URL(normalizeBase(base) + path);
}
function endpointHash(input) {
  return createHash('sha256').update(normalizeBase(input)).digest('hex');
}
function sanitizeUrl(input) {
  const u = new URL(input);
  for (const key of ['serviceKey','ServiceKey']) if (u.searchParams.has(key)) u.searchParams.set(key,'<redacted>');
  return u.toString();
}
function findKeyDeep(value, key) {
  if (!value || typeof value !== 'object') return null;
  if (!Array.isArray(value) && Object.prototype.hasOwnProperty.call(value,key)) return value[key];
  for (const v of Object.values(value)) {
    const found = findKeyDeep(v,key);
    if (found != null) return found;
  }
  return null;
}
function extractItems(value) {
  if (!value || typeof value !== 'object') return [];
  const response = value.response && typeof value.response === 'object' ? value.response : value;
  const body = response.body && typeof response.body === 'object' ? response.body : value.body;
  const itemsNode = body?.items ?? value.items;
  const item = itemsNode?.item ?? itemsNode;
  if (Array.isArray(item)) return item.filter((x)=>x && typeof x === 'object' && !Array.isArray(x));
  if (item && typeof item === 'object' && !Array.isArray(item)) return [item];
  return [];
}
function xmlFirst(text,key) {
  const m=text.match(new RegExp('<'+key+'>([\\s\\S]*?)<\\/'+key+'>','i'));
  return m?m[1].trim():null;
}
function numberOrNull(v) {
  if (v==null || String(v).trim()==='') return null;
  const n=Number(String(v).replace(/,/g,'').trim());
  return Number.isFinite(n)?n:null;
}
function parsePayload(text) {
  try { return { format:'json', value:JSON.parse(text) }; }
  catch { return { format:'xml-or-text', value:null }; }
}
function getScalar(raw, candidates) {
  if (!raw || typeof raw !== 'object') return { key:null, value:'' };
  const entries=Object.entries(raw);
  for (const candidate of candidates) {
    const normalizedCandidate=candidate.toLowerCase().replace(/[^a-z0-9]/g,'');
    const match=entries.find(([k])=>k.toLowerCase().replace(/[^a-z0-9]/g,'')===normalizedCandidate);
    if (match && String(match[1]??'').trim()) return { key:match[0], value:String(match[1]).trim() };
  }
  return { key:null, value:'' };
}
async function call(url,label) {
  const response=await fetch(url,{headers:{Accept:'application/json, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.1'}});
  const text=await response.text();
  if(!response.ok) throw new Error(`${label} HTTP ${response.status}: ${text.slice(0,300)}`);
  return { response, text, parsed:parsePayload(text) };
}

console.log('\nPlugPark 부산시설공단 ParkingInfoService_v2 contract probe');
console.log('문서 확정: 목록 /getParkingList_v2 → 코드별 실시간 /getParkingInfoList_v2');
console.log('원칙: 실제 공공 API 최대 2회 · Cloudflare/D1 write 0\n');

const env=await localEnv();
const configured=String(process.env.BUSAN_REALTIME_PARKING_API_URL || env.BUSAN_REALTIME_PARKING_API_URL || BASE_DEFAULT).trim();
const key=String(process.env.BUSAN_PARKING_API_KEY || env.BUSAN_PARKING_API_KEY || '').trim();
if(!key) throw new Error('BUSAN_PARKING_API_KEY가 없습니다. .dev.vars 또는 현재 환경변수를 확인하세요.');
const base=normalizeBase(configured);

const listUrl=endpoint(base,LIST_PATH);
listUrl.searchParams.set('serviceKey',key);
listUrl.searchParams.set('pageNo','1');
listUrl.searchParams.set('numOfRows','100');
listUrl.searchParams.set('resultType','json');

console.log('1) 목록 조회:',sanitizeUrl(listUrl.toString()));
const list=await call(listUrl.toString(),'getParkingList_v2');
let listItems=[];
let listTotal=null;
let listResultCode=null;
if(list.parsed.value){
  listItems=extractItems(list.parsed.value);
  listTotal=numberOrNull(findKeyDeep(list.parsed.value,'totalCount'));
  listResultCode=findKeyDeep(list.parsed.value,'resultCode');
} else {
  listTotal=numberOrNull(xmlFirst(list.text,'totalCount'));
  listResultCode=xmlFirst(list.text,'resultCode');
}
if(listItems.length===0 && list.parsed.value==null) {
  throw new Error('목록 응답이 XML이어서 현재 probe가 item 구조를 안전하게 추출하지 못했습니다. resultType=json 지원 여부를 확인해야 합니다.');
}
if(listItems.length===0) throw new Error('PARKING_LIST_EMPTY: getParkingList_v2가 0건을 반환했습니다.');

const firstList=listItems[0];
const code=getScalar(firstList,['parkgcd','pParkGCd','parkingCode','parkGcd']);
if(!code.value) {
  console.error('목록 첫 item keys:',Object.keys(firstList));
  throw new Error('PARKING_LIST_CODE_FIELD_UNCONFIRMED: 주차장 코드 필드를 확정하지 못했습니다.');
}

console.log(`   PASS · items=${listItems.length} totalCount=${listTotal ?? 'unknown'} codeField=${code.key} sampleCode=${code.value}`);

const realtimeUrl=endpoint(base,REALTIME_PATH);
realtimeUrl.searchParams.set('serviceKey',key);
realtimeUrl.searchParams.set('pageNo','1');
realtimeUrl.searchParams.set('numOfRows','10');
realtimeUrl.searchParams.set('pParkGCd',code.value);
realtimeUrl.searchParams.set('resultType','json');

console.log('2) 실시간 조회:',sanitizeUrl(realtimeUrl.toString()));
const rt=await call(realtimeUrl.toString(),'getParkingInfoList_v2');
let rtItems=[];
let rtResultCode=null;
if(rt.parsed.value){
  rtItems=extractItems(rt.parsed.value);
  rtResultCode=findKeyDeep(rt.parsed.value,'resultCode');
}
if(rtItems.length===0) throw new Error('PARKING_REALTIME_EMPTY: 샘플 주차장 코드의 실시간 응답이 0건입니다.');

const sample=rtItems[0];
const missing=REALTIME_REQUIRED.filter((key)=>!(key in sample) || String(sample[key]??'').trim()==='');
const available=numberOrNull(sample.curravacnt);
const occupied=numberOrNull(sample.parkingcnt);
const capacity=numberOrNull(sample.maxcnt);
const numericConsistent=
  available==null || occupied==null || capacity==null ||
  Math.abs((available+occupied)-capacity)<=1;

const contractVerified=missing.length===0;
const result={
  probedAt:new Date().toISOString(),
  ok:contractVerified,
  contractVerified,
  runtimeAdapterReady:true,
  releaseReady:contractVerified,
  releaseBlockers:contractVerified ? [] : ['request-response-contract-unverified'],
  baseEndpoint:base,
  endpointHash:endpointHash(base),
  operations:{
    list:{path:LIST_PATH,requestParams:['serviceKey','pageNo','numOfRows','resultType'],itemCount:listItems.length,totalCount:listTotal,resultCode:listResultCode,firstItemKeys:Object.keys(firstList),parkingCodeKey:code.key,sampleCode:code.value},
    realtime:{path:REALTIME_PATH,requestParams:['serviceKey','pageNo','numOfRows','pParkGCd','resultType'],resultCode:rtResultCode,missingFields:missing,firstItemKeys:Object.keys(sample),numericConsistent}
  },
  remoteD1Writes:0,
  publicApiCalls:2
};
await mkdir(resolve('.plugpark'),{recursive:true});
await writeFile(RESULT,JSON.stringify(result,null,2)+'\n','utf8');

console.log(`   ${contractVerified?'PASS':'FAIL'} · realtime fields ${missing.length===0?'확정':'missing='+missing.join(',')}`);
console.log('   numeric consistency:',numericConsistent?'PASS':'WARN · 자동보정하지 않음');
console.log('\n결과:',RESULT);
console.log('Public API calls: 2 · Remote D1 write: 0');
if(!contractVerified) throw new Error('PARKING_V2_CONTRACT_PROBE_FAILED');
console.log('\n✅ PARKING v2 REQUEST/RESPONSE CONTRACT: VERIFIED');
console.log('runtime adapter: LIST → pParkGCd별 REALTIME · READY');
