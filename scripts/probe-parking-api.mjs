import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const RESULT = resolve('.plugpark', 'parking-api-probe.json');
const REQUIRED = ['parkgcd','parknm','curravacnt','parkingcnt','maxcnt','lastupdatetime'];

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
  if (!Array.isArray(value)) {
    if (REQUIRED.some((k) => Object.prototype.hasOwnProperty.call(value, k))) out.push(value);
    for (const v of Object.values(value)) collectObjects(v, out);
    return out;
  }
  for (const v of value) collectObjects(v, out);
  return out;
}

function xmlFirst(text, key) {
  const m = text.match(new RegExp('<' + key + '>([\\s\\S]*?)<\\/' + key + '>', 'i'));
  return m ? m[1].trim() : null;
}

function sampleFromBody(text) {
  try {
    const json = JSON.parse(text);
    const objects = collectObjects(json);
    if (objects.length > 0) {
      const o = objects[0];
      return Object.fromEntries(REQUIRED.map((k) => [k, o[k] == null ? null : String(o[k])]));
    }
  } catch {}
  const sample = Object.fromEntries(REQUIRED.map((k) => [k, xmlFirst(text, k)]));
  return REQUIRED.some((k) => sample[k] != null) ? sample : null;
}

function numberOrNull(v) {
  if (v == null || String(v).trim() === '') return null;
  const n = Number(String(v).replace(/,/g,'').trim());
  return Number.isFinite(n) ? n : null;
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
if (!url.searchParams.has('serviceKey') && !url.searchParams.has('ServiceKey')) {
  url.searchParams.set('serviceKey', key);
}

console.log('endpoint:', sanitizeUrl(url.toString()));
console.log('query params:', [...url.searchParams.keys()].filter((x) => !/^servicekey$/i.test(x)).join(', ') || '(none)');

const response = await fetch(url, {
  method: 'GET',
  headers: { Accept: 'application/json, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.1' },
});
const body = await response.text();

const sample = sampleFromBody(body);
const missing = sample ? REQUIRED.filter((k) => sample[k] == null || String(sample[k]).trim() === '') : [...REQUIRED];

const available = numberOrNull(sample?.curravacnt);
const occupied = numberOrNull(sample?.parkingcnt);
const capacity = numberOrNull(sample?.maxcnt);
const numericConsistent =
  available == null || occupied == null || capacity == null ||
  Math.abs((available + occupied) - capacity) <= 1;

const resultCode =
  (() => {
    try {
      const j = JSON.parse(body);
      return j?.response?.header?.resultCode ?? j?.header?.resultCode ?? null;
    } catch {
      return xmlFirst(body, 'resultCode');
    }
  })();

const ok = response.ok && !!sample && missing.length === 0;
const result = {
  probedAt: new Date().toISOString(),
  ok,
  httpStatus: response.status,
  endpointHash: endpointHash(endpoint),
  endpoint: sanitizeUrl(endpoint),
  queryParameterNames: [...new URL(endpoint).searchParams.keys()].filter((x) => !/^servicekey$/i.test(x)),
  resultCode,
  requiredFields: REQUIRED,
  missingFields: missing,
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
console.log('required fields:', missing.length === 0 ? 'PASS' : 'FAIL · missing=' + missing.join(','));
console.log('numeric consistency:', numericConsistent ? 'PASS' : 'FAIL · 원본 수치를 자동보정하지 않습니다.');
console.log('result:', RESULT);

if (!ok) {
  throw new Error('PARKING_API_CONTRACT_PROBE_FAILED');
}
console.log('\n✅ PARKING API PROBE: PASS');
console.log('Public API call: 1 · Remote D1 write: 0');
