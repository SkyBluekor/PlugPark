import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const RESULT = resolve('.plugpark', 'parking-api-probe.json');
const REQUIRED = ['parkgcd','parknm','curravacnt','parkingcnt','maxcnt','lastupdatetime'];
const SINGLE_FILTER_NAMES = ['parkgcd','parkcd','pParkGCd'];

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

function sanitizeUrl(input) {
  const u = new URL(input);
  for (const key of ['serviceKey','ServiceKey']) {
    if (u.searchParams.has(key)) u.searchParams.set(key, '<redacted>');
  }
  return u.toString();
}

function endpointHash(input) {
  const u = new URL(input);
  u.searchParams.delete('serviceKey');
  u.searchParams.delete('ServiceKey');
  return createHash('sha256').update(u.toString()).digest('hex');
}

function collectObjects(value, out = []) {
  if (!value || typeof value !== 'object') return out;
  if (Array.isArray(value)) {
    for (const v of value) collectObjects(v, out);
    return out;
  }
  if (REQUIRED.some((k) => Object.prototype.hasOwnProperty.call(value, k))) out.push(value);
  for (const v of Object.values(value)) collectObjects(v, out);
  return out;
}

function findKeyDeep(value, key) {
  if (!value || typeof value !== 'object') return null;
  if (!Array.isArray(value) && Object.prototype.hasOwnProperty.call(value, key)) return value[key];
  for (const v of Object.values(value)) {
    const found = findKeyDeep(v, key);
    if (found != null) return found;
  }
  return null;
}

function xmlFirst(text, key) {
  const m = text.match(new RegExp('<' + key + '>([\\s\\S]*?)<\\/' + key + '>', 'i'));
  return m ? m[1].trim() : null;
}

function analyzeBody(text) {
  try {
    const json = JSON.parse(text);
    const objects = collectObjects(json);
    const first = objects[0] || null;
    return {
      sample: first ? Object.fromEntries(REQUIRED.map((k) => [k, first[k] == null ? null : String(first[k])])) : null,
      itemCount: objects.length,
      totalCount: numberOrNull(findKeyDeep(json, 'totalCount')),
      resultCode: findKeyDeep(json, 'resultCode'),
      format: 'json',
    };
  } catch {}

  const sample = Object.fromEntries(REQUIRED.map((k) => [k, xmlFirst(text, k)]));
  const hasSample = REQUIRED.some((k) => sample[k] != null);
  const itemCount = (text.match(/<parkgcd>/gi) || []).length;
  return {
    sample: hasSample ? sample : null,
    itemCount,
    totalCount: numberOrNull(xmlFirst(text, 'totalCount')),
    resultCode: xmlFirst(text, 'resultCode'),
    format: 'xml-or-text',
  };
}

function numberOrNull(v) {
  if (v == null || String(v).trim() === '') return null;
  const n = Number(String(v).replace(/,/g,'').trim());
  return Number.isFinite(n) ? n : null;
}

function shouldReplaceServiceKey(value) {
  const v = String(value || '').trim();
  return !v || /서비스|인증|service.?key|api.?key|replace/i.test(v);
}

console.log('\nPlugPark parking API contract probe');
console.log('원칙: 실제 API GET 1회 · Cloudflare/D1 write 0 · 요청 파라미터 추측 0\n');

const fileEnv = await localEnv();
const endpoint = String(process.env.BUSAN_REALTIME_PARKING_API_URL || fileEnv.BUSAN_REALTIME_PARKING_API_URL || '').trim();
const key = String(process.env.BUSAN_PARKING_API_KEY || fileEnv.BUSAN_PARKING_API_KEY || '').trim();

if (!endpoint) throw new Error('BUSAN_REALTIME_PARKING_API_URL이 없습니다. 공공데이터포털 활용신청 화면의 실제 상세기능 요청주소가 필요합니다.');
if (!key) throw new Error('BUSAN_PARKING_API_KEY가 없습니다. .dev.vars 또는 현재 환경변수를 확인하세요.');

const url = new URL(endpoint);
if (!['http:','https:'].includes(url.protocol)) throw new Error('실시간 주차 URL은 http/https여야 합니다.');

let serviceKeyName = null;
for (const candidate of ['serviceKey','ServiceKey']) {
  if (url.searchParams.has(candidate)) {
    serviceKeyName = candidate;
    if (shouldReplaceServiceKey(url.searchParams.get(candidate))) url.searchParams.set(candidate, key);
    break;
  }
}
if (!serviceKeyName) url.searchParams.set('serviceKey', key);

const originalUrl = new URL(endpoint);
const queryParameterNames = [...originalUrl.searchParams.keys()].filter((x) => !/^servicekey$/i.test(x));
const singleParkingFilterPresent = SINGLE_FILTER_NAMES.some((name) => originalUrl.searchParams.has(name));

console.log('endpoint:', sanitizeUrl(url.toString()));
console.log('query params:', queryParameterNames.join(', ') || '(none)');

const response = await fetch(url, {
  method: 'GET',
  headers: { Accept: 'application/json, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.1' },
});
const body = await response.text();
const analysis = analyzeBody(body);
const sample = analysis.sample;
const missing = sample ? REQUIRED.filter((k) => sample[k] == null || String(sample[k]).trim() === '') : [...REQUIRED];

const available = numberOrNull(sample?.curravacnt);
const occupied = numberOrNull(sample?.parkingcnt);
const capacity = numberOrNull(sample?.maxcnt);
const numericConsistent =
  available == null || occupied == null || capacity == null ||
  Math.abs((available + occupied) - capacity) <= 1;

const contractOk = response.ok && !!sample && missing.length === 0;
const fullSnapshotComplete =
  analysis.itemCount >= 2 &&
  (analysis.totalCount == null || analysis.itemCount >= analysis.totalCount);

const releaseReady = contractOk && fullSnapshotComplete && !singleParkingFilterPresent;
const releaseBlockers = [];
if (!contractOk) releaseBlockers.push('required-response-contract-failed');
if (singleParkingFilterPresent) releaseBlockers.push('single-parking-filter-present');
if (analysis.itemCount < 2) releaseBlockers.push('only-one-or-zero-items');
if (analysis.totalCount != null && analysis.itemCount < analysis.totalCount) releaseBlockers.push('partial-page-pagination-not-documented');

const result = {
  probedAt: new Date().toISOString(),
  ok: contractOk,
  releaseReady,
  releaseBlockers,
  httpStatus: response.status,
  responseFormat: analysis.format,
  endpointHash: endpointHash(endpoint),
  endpoint: sanitizeUrl(endpoint),
  queryParameterNames,
  singleParkingFilterPresent,
  resultCode: analysis.resultCode,
  requiredFields: REQUIRED,
  missingFields: missing,
  itemCount: analysis.itemCount,
  totalCount: analysis.totalCount,
  fullSnapshotComplete,
  numericConsistent,
  sample: sample ? {
    parkgcd: sample.parkgcd,
    parknm: sample.parknm,
    curravacnt: sample.curravacnt,
    parkingcnt: sample.parkingcnt,
    maxcnt: sample.maxcnt,
    lastupdatetime: sample.lastupdatetime,
  } : null,
  remoteD1Writes: 0,
  publicApiCalls: 1,
};

await mkdir(resolve('.plugpark'), { recursive: true });
await writeFile(RESULT, JSON.stringify(result, null, 2) + '\n', 'utf8');

console.log('\nHTTP', response.status);
console.log('response format:', analysis.format);
console.log('required fields:', missing.length === 0 ? 'PASS' : 'FAIL · missing=' + missing.join(','));
console.log('items:', analysis.itemCount, 'totalCount:', analysis.totalCount ?? '(none)');
console.log('numeric consistency:', numericConsistent ? 'PASS' : 'WARN · 원본 수치를 자동보정하지 않습니다.');
console.log('full snapshot:', fullSnapshotComplete ? 'PASS' : 'NOT CONFIRMED');
console.log('release ready:', releaseReady ? 'YES' : 'NO · ' + releaseBlockers.join(', '));
console.log('result:', RESULT);

if (!contractOk) throw new Error('PARKING_API_CONTRACT_PROBE_FAILED');
if (!releaseReady) throw new Error('PARKING_API_PROBE_NOT_RELEASE_READY');

console.log('\n✅ PARKING API PROBE: PASS');
console.log('Public API call: 1 · Remote D1 write: 0');
