import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const VERSION = 'v0.7.2-P1';
const BASE_DEFAULT = 'https://apis.data.go.kr/B552587/ParkingInfoService_v2';
const PLUGPARK_URL = process.env.PLUGPARK_URL || 'https://plugpark.dtdt4865.workers.dev';
const OUT_DIR = resolve('.plugpark');
const JSON_OUT = resolve(OUT_DIR, 'parking-realtime-coverage-audit.json');
const CSV_OUT = resolve(OUT_DIR, 'parking-realtime-coverage-audit.csv');

const MAX_REALTIME_CALLS = 50;
const MAX_TOTAL_CALLS = 51;
const LIST_EXPECTED_COUNT = 50;
const REALTIME_REQUIRED = ['parkgcd','parknm','curravacnt','parkingcnt','maxcnt','lastupdatetime'];

let publicApiCalls = 0;
let realtimeCalls = 0;

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

function normalizeServiceKey(value) {
  const trimmed = String(value || '').trim();
  try { return decodeURIComponent(trimmed); } catch { return trimmed; }
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

function reserveCall(kind) {
  if (publicApiCalls + 1 > MAX_TOTAL_CALLS) throw new Error('AUDIT_CALL_BUDGET_EXCEEDED');
  if (kind === 'realtime' && realtimeCalls + 1 > MAX_REALTIME_CALLS) {
    throw new Error('AUDIT_REALTIME_CALL_BUDGET_EXCEEDED');
  }
  publicApiCalls += 1;
  if (kind === 'realtime') realtimeCalls += 1;
}

async function publicGet(url, kind) {
  reserveCall(kind);
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json, application/xml;q=0.5, */*;q=0.1' },
    });
    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { response, text, json, networkError: null };
  } catch (error) {
    return { response: null, text: '', json: null, networkError: error instanceof Error ? error.message : String(error) };
  }
}

function deepFind(value, key) {
  if (!value || typeof value !== 'object') return null;
  if (!Array.isArray(value) && Object.prototype.hasOwnProperty.call(value, key)) return value[key];
  for (const child of Object.values(value)) {
    const found = deepFind(child, key);
    if (found != null) return found;
  }
  return null;
}

function extractItems(payload) {
  if (!payload || typeof payload !== 'object') return [];
  const response = payload.response && typeof payload.response === 'object' ? payload.response : payload;
  const body = response.body && typeof response.body === 'object' ? response.body : payload.body;
  const itemsNode = body?.items ?? payload.items;
  const item = itemsNode?.item ?? itemsNode;
  if (Array.isArray(item)) return item.filter((x) => x && typeof x === 'object' && !Array.isArray(x));
  if (item && typeof item === 'object' && !Array.isArray(item)) return [item];
  return [];
}

function apiError(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const resultCode = deepFind(payload, 'resultCode');
  const resultMsg = deepFind(payload, 'resultMsg');
  const returnReasonCode = deepFind(payload, 'returnReasonCode');
  const returnAuthMsg = deepFind(payload, 'returnAuthMsg');
  const errMsg = deepFind(payload, 'errMsg');
  if (returnReasonCode || returnAuthMsg || errMsg) {
    return String(errMsg || returnAuthMsg || resultMsg || returnReasonCode);
  }
  if (resultCode != null && String(resultCode) !== '00') {
    return String(resultMsg || resultCode);
  }
  return null;
}

function flex(raw, candidates) {
  if (!raw || typeof raw !== 'object') return '';
  const entries = Object.entries(raw);
  for (const candidate of candidates) {
    const c = candidate.toLowerCase().replace(/[^a-z0-9]/g, '');
    const match = entries.find(([k]) => k.toLowerCase().replace(/[^a-z0-9]/g, '') === c);
    if (match && String(match[1] ?? '').trim()) return String(match[1]).trim();
  }
  return '';
}

function numberOrNull(v) {
  if (v == null || String(v).trim() === '') return null;
  const n = Number(String(v).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

function cleanValue(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed || trimmed === '-' || trimmed.toLowerCase() === 'null') return '';
  return trimmed;
}

function normalizeParkingName(value) {
  return cleanValue(value)
    .toLowerCase()
    .replace(/부산광역시|부산시/g, '')
    .replace(/공영주차장|노외공영주차장|노상공영주차장|공영|주차장/g, '')
    .replace(/[\s,\.·ㆍ()\[\]{}\-_\/]/g, '')
    .trim();
}

function diceSimilarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const pairs = (value) => {
    const map = new Map();
    for (let i = 0; i < value.length - 1; i += 1) {
      const pair = value.slice(i, i + 2);
      map.set(pair, (map.get(pair) || 0) + 1);
    }
    return map;
  };
  const left = pairs(a);
  const right = pairs(b);
  let intersection = 0;
  let leftCount = 0;
  let rightCount = 0;
  for (const count of left.values()) leftCount += count;
  for (const count of right.values()) rightCount += count;
  for (const [pair, count] of left) intersection += Math.min(count, right.get(pair) || 0);
  return (2 * intersection) / (leftCount + rightCount);
}

function matchBase(realtimeName, basePlaces) {
  const normalizedRealtime = normalizeParkingName(realtimeName);
  if (!normalizedRealtime) return { status: 'BASE_UNMATCHED', matched: false, parkingId: null, parkingName: null, method: 'unmatched', score: null };

  const candidates = basePlaces
    .map((base) => ({ base, normalized: normalizeParkingName(base.name) }))
    .filter((x) => x.normalized);

  const exact = candidates.filter((x) => x.normalized === normalizedRealtime);
  if (exact.length === 1) {
    const x = exact[0];
    return { status: 'BASE_MATCHED', matched: true, parkingId: x.base.id, parkingName: x.base.name, method: 'exact-name', score: 1 };
  }
  if (exact.length > 1) {
    return { status: 'BASE_AMBIGUOUS', matched: false, parkingId: null, parkingName: null, method: 'ambiguous', score: 1 };
  }

  const contained = candidates.filter((x) => {
    const shorter = Math.min(x.normalized.length, normalizedRealtime.length);
    return shorter >= 4 && (x.normalized.includes(normalizedRealtime) || normalizedRealtime.includes(x.normalized));
  });
  if (contained.length === 1) {
    const x = contained[0];
    return { status: 'BASE_MATCHED', matched: true, parkingId: x.base.id, parkingName: x.base.name, method: 'contained-name', score: 0.94 };
  }
  if (contained.length > 1) {
    return { status: 'BASE_AMBIGUOUS', matched: false, parkingId: null, parkingName: null, method: 'ambiguous', score: null };
  }

  const ranked = candidates
    .map((candidate) => ({ candidate, similarity: diceSimilarity(normalizedRealtime, candidate.normalized) }))
    .sort((a, b) => b.similarity - a.similarity);
  const best = ranked[0];
  const second = ranked[1];

  if (best && best.similarity >= 0.84 && (!second || best.similarity - second.similarity >= 0.08)) {
    return {
      status: 'BASE_MATCHED',
      matched: true,
      parkingId: best.candidate.base.id,
      parkingName: best.candidate.base.name,
      method: 'similar-name',
      score: Number(best.similarity.toFixed(3)),
    };
  }
  if (best && best.similarity >= 0.84) {
    return { status: 'BASE_AMBIGUOUS', matched: false, parkingId: null, parkingName: null, method: 'ambiguous', score: Number(best.similarity.toFixed(3)) };
  }
  return { status: 'BASE_UNMATCHED', matched: false, parkingId: null, parkingName: null, method: 'unmatched', score: best ? Number(best.similarity.toFixed(3)) : null };
}

async function fetchBasePlaces() {
  const response = await fetch(PLUGPARK_URL + '/api/places?parking-coverage-audit=1', {
    headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('PlugPark /api/places가 JSON이 아닙니다.'); }
  if (!response.ok || data?.ok === false) throw new Error('PlugPark /api/places read 실패: ' + (data?.error || response.status));
  if (data.upstreamEvCalls !== 0 || data.upstreamParkingCalls !== 0) {
    throw new Error('AUDIT_ABORT: /api/places read path에서 upstream 호출이 감지됐습니다.');
  }
  return Array.isArray(data.places) ? data.places.map((p) => ({ id: String(p.id ?? ''), name: String(p.name ?? '') })) : [];
}

function csvCell(value) {
  const text = value == null ? '' : String(value);
  return /[",\n\r]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

function toCsv(items) {
  const columns = [
    'code','name','api_status','available','occupied','capacity','source_updated_at',
    'match_status','matched_name','match_method','match_score','error'
  ];
  const lines = [columns.join(',')];
  for (const item of items) {
    const row = {
      code: item.parkingCode,
      name: item.realtimeName || item.listName,
      api_status: item.apiStatus,
      available: item.available,
      occupied: item.occupied,
      capacity: item.capacity,
      source_updated_at: item.sourceUpdatedAt,
      match_status: item.baseMatch?.status || '',
      matched_name: item.baseMatch?.parkingName || '',
      match_method: item.baseMatch?.method || '',
      match_score: item.baseMatch?.score ?? '',
      error: item.error || '',
    };
    lines.push(columns.map((c) => csvCell(row[c])).join(','));
  }
  return lines.join('\n') + '\n';
}

function summarize(items) {
  const count = (status) => items.filter((x) => x.apiStatus === status).length;
  const matched = items.filter((x) => x.baseMatch?.status === 'BASE_MATCHED').length;
  const unmatched = items.filter((x) => x.baseMatch?.status === 'BASE_UNMATCHED').length;
  const ambiguous = items.filter((x) => x.baseMatch?.status === 'BASE_AMBIGUOUS').length;
  const usable = items.filter((x) => x.apiStatus === 'LIVE_OK' && x.baseMatch?.status === 'BASE_MATCHED').length;
  return {
    parkingCount: items.length,
    liveOk: count('LIVE_OK'),
    liveEmpty: count('LIVE_EMPTY'),
    schemaInvalid: count('LIVE_SCHEMA_INVALID'),
    numericInvalid: count('LIVE_NUMERIC_INVALID'),
    apiError: count('API_ERROR'),
    httpError: count('HTTP_ERROR'),
    networkError: count('NETWORK_ERROR'),
    matched,
    unmatched,
    ambiguous,
    usable,
    coveragePercent: items.length ? Number((usable * 100 / items.length).toFixed(1)) : 0,
  };
}

function printSummary(summary) {
  console.log('\n==================================================');
  console.log('PlugPark Parking Realtime Coverage Audit');
  console.log('==================================================');
  console.log('목록 주차장             :', summary.parkingCount);
  console.log('실시간 정상             :', summary.liveOk);
  console.log('실시간 빈 응답          :', summary.liveEmpty);
  console.log('스키마 비정상           :', summary.schemaInvalid);
  console.log('수치 비정상             :', summary.numericInvalid);
  console.log('API 오류                :', summary.apiError);
  console.log('HTTP 오류               :', summary.httpError);
  console.log('네트워크 오류           :', summary.networkError);
  console.log('PlugPark 매칭 성공      :', summary.matched);
  console.log('매칭 실패               :', summary.unmatched);
  console.log('모호한 매칭             :', summary.ambiguous);
  console.log('실제 사용 가능          :', `${summary.usable} / ${summary.parkingCount}`);
  console.log('Coverage                :', summary.coveragePercent + '%');
  console.log('Public API calls        :', publicApiCalls);
  console.log('Remote D1 writes        : 0');
  console.log('Cloudflare writes       : 0');
  console.log('==================================================');
}

if (!process.argv.includes('--confirm-live-audit')) {
  console.error('실제 공공 API 전수 진단은 명시적 확인이 필요합니다.');
  console.error('실행: npm run audit:parking-coverage');
  process.exit(2);
}

const env = await localEnv();
const serviceKey = String(process.env.BUSAN_PARKING_API_KEY || env.BUSAN_PARKING_API_KEY || '').trim();
if (!serviceKey) throw new Error('BUSAN_PARKING_API_KEY가 없습니다. 로컬 .dev.vars를 확인하세요.');

const configured = String(
  process.env.BUSAN_REALTIME_PARKING_API_URL ||
  env.BUSAN_REALTIME_PARKING_API_URL ||
  BASE_DEFAULT
).trim();
const base = normalizeBase(configured);

console.log('\n' + VERSION + ' Parking Realtime Coverage Audit');
console.log('실제 공공 API 최대 51회 · retry 0 · Remote D1/Cloudflare write 0');
console.log('PlugPark production /api/places는 read-only 매칭 기준으로만 조회합니다.\n');

const basePlaces = await fetchBasePlaces();
if (basePlaces.length === 0) throw new Error('PlugPark base parking read model이 비어 있습니다.');
console.log('PlugPark base parking rows:', basePlaces.length);

const listUrl = new URL(base + '/getParkingList_v2');
listUrl.searchParams.set('serviceKey', normalizeServiceKey(serviceKey));
listUrl.searchParams.set('pageNo', '1');
listUrl.searchParams.set('numOfRows', '100');
listUrl.searchParams.set('resultType', 'json');

const listResult = await publicGet(listUrl, 'list');
if (listResult.networkError) throw new Error('PARKING_LIST_NETWORK_ERROR: ' + listResult.networkError);
if (!listResult.response.ok) throw new Error('PARKING_LIST_HTTP_ERROR: ' + listResult.response.status);
if (!listResult.json) throw new Error('PARKING_LIST_NON_JSON');
const listApiError = apiError(listResult.json);
if (listApiError) throw new Error('PARKING_LIST_API_ERROR: ' + listApiError);

const listItems = extractItems(listResult.json);
const totalCount = numberOrNull(deepFind(listResult.json, 'totalCount'));
if (totalCount !== LIST_EXPECTED_COUNT || listItems.length !== LIST_EXPECTED_COUNT) {
  throw new Error(`PARKING_LIST_COUNT_CHANGED: totalCount=${totalCount} itemCount=${listItems.length} expected=${LIST_EXPECTED_COUNT}`);
}

const catalog = listItems.map((raw) => ({
  code: flex(raw, ['parkgcd','pParkGCd','parkingCode','parkGcd']),
  name: flex(raw, ['parknm','pParkNm','parkingName','parkNm']),
})).filter((x) => x.code);

if (catalog.length !== LIST_EXPECTED_COUNT) {
  throw new Error(`PARKING_LIST_CODE_COUNT_INVALID: ${catalog.length}/${LIST_EXPECTED_COUNT}`);
}
console.log('목록 확인: PASS · 50/50');

const results = [];
for (let i = 0; i < catalog.length; i += 1) {
  const target = catalog[i];
  const url = new URL(base + '/getParkingInfoList_v2');
  url.searchParams.set('serviceKey', normalizeServiceKey(serviceKey));
  url.searchParams.set('pageNo', '1');
  url.searchParams.set('numOfRows', '10');
  url.searchParams.set('pParkGCd', target.code);
  url.searchParams.set('resultType', 'json');

  const call = await publicGet(url, 'realtime');
  const item = {
    parkingCode: target.code,
    listName: target.name,
    realtimeName: '',
    apiStatus: 'LIVE_EMPTY',
    available: null,
    occupied: null,
    capacity: null,
    sourceUpdatedAt: null,
    baseMatch: null,
    error: null,
  };

  if (call.networkError) {
    item.apiStatus = 'NETWORK_ERROR';
    item.error = call.networkError;
  } else if (!call.response.ok) {
    item.apiStatus = 'HTTP_ERROR';
    item.error = 'HTTP ' + call.response.status;
  } else if (!call.json) {
    item.apiStatus = 'LIVE_SCHEMA_INVALID';
    item.error = 'non-json response';
  } else {
    const err = apiError(call.json);
    if (err) {
      item.apiStatus = 'API_ERROR';
      item.error = err;
    } else {
      const rows = extractItems(call.json);
      if (rows.length === 0) {
        item.apiStatus = 'LIVE_EMPTY';
      } else {
        const raw = rows[0];
        const missing = REALTIME_REQUIRED.filter((key) => !(key in raw) || String(raw[key] ?? '').trim() === '');
        item.realtimeName = cleanValue(raw.parknm);
        item.available = numberOrNull(raw.curravacnt);
        item.occupied = numberOrNull(raw.parkingcnt);
        item.capacity = numberOrNull(raw.maxcnt);
        item.sourceUpdatedAt = cleanValue(raw.lastupdatetime) || null;

        if (missing.length > 0) {
          item.apiStatus = 'LIVE_SCHEMA_INVALID';
          item.error = 'missing=' + missing.join('|');
        } else if (
          item.available != null &&
          item.occupied != null &&
          item.capacity != null &&
          Math.abs((item.available + item.occupied) - item.capacity) > 1
        ) {
          item.apiStatus = 'LIVE_NUMERIC_INVALID';
          item.error = `available(${item.available})+occupied(${item.occupied})!=capacity(${item.capacity})`;
        } else {
          item.apiStatus = 'LIVE_OK';
        }

        item.baseMatch = matchBase(item.realtimeName || target.name, basePlaces);
      }
    }
  }

  results.push(item);
  const short = item.baseMatch?.status || '-';
  console.log(`[${String(i + 1).padStart(2,'0')}/50] ${target.code} · ${item.apiStatus} · ${short}`);
  if (i < catalog.length - 1) await new Promise((resolve) => setTimeout(resolve, 100));
}

if (publicApiCalls > MAX_TOTAL_CALLS || realtimeCalls > MAX_REALTIME_CALLS) {
  throw new Error('AUDIT_CALL_BUDGET_EXCEEDED');
}

const summary = summarize(results);
const report = {
  version: VERSION,
  auditedAt: new Date().toISOString(),
  source: {
    service: 'ParkingInfoService_v2',
    baseEndpoint: base,
    listOperation: '/getParkingList_v2',
    realtimeOperation: '/getParkingInfoList_v2',
  },
  requests: {
    list: publicApiCalls - realtimeCalls,
    realtime: realtimeCalls,
    total: publicApiCalls,
    maxTotal: MAX_TOTAL_CALLS,
    retry: 0,
  },
  remoteReads: {
    plugparkPlaces: 1,
  },
  remoteWrites: 0,
  cloudflareWrites: 0,
  summary,
  items: results,
};

await mkdir(OUT_DIR, { recursive: true });
await writeFile(JSON_OUT, JSON.stringify(report, null, 2) + '\n', 'utf8');
await writeFile(CSV_OUT, toCsv(results), 'utf8');

printSummary(summary);
console.log('JSON:', JSON_OUT);
console.log('CSV :', CSV_OUT);

if (publicApiCalls !== 51) {
  throw new Error(`AUDIT_CALL_COUNT_UNEXPECTED: ${publicApiCalls}/51`);
}
console.log('\n✅ PARKING REALTIME COVERAGE AUDIT: COMPLETE');
console.log('Public API calls=51 · retry=0 · Remote D1 write=0 · Cloudflare write=0');
