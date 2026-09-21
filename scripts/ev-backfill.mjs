import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const API_URL = 'https://apis.data.go.kr/B552584/EvCharger/getChargerInfo';
const PAGE_SIZE = 1000;
const UPLOAD_CHUNK_SIZE = 100;
const STATE_FILE = resolve('.plugpark', 'ev-backfill-state.json');
const WORKER_BASE_URL = (process.env.PLUGPARK_BASE_URL || 'https://plugpark.dtdt4865.workers.dev').replace(/\/$/, '');
const RUN_ID = `local-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;

function clean(v) { return v == null ? '' : String(v).trim(); }
function normalizeKey(key) {
  const trimmed = key.trim();
  try { return decodeURIComponent(trimmed); } catch { return trimmed; }
}
function headerOf(payload) {
  return payload?.response?.header ?? payload?.header ?? payload?.OpenAPI_ServiceResponse?.cmmMsgHeader ?? {};
}
function bodyOf(payload) { return payload?.response?.body ?? payload?.body ?? {}; }
function itemsOf(payload) {
  const body = bodyOf(payload);
  const node = body?.items?.item ?? body?.items ?? payload?.items?.item ?? payload?.items ?? [];
  return Array.isArray(node) ? node : node && typeof node === 'object' ? [node] : [];
}
function metaNumber(payload, key) {
  const h = headerOf(payload); const b = bodyOf(payload);
  const raw = h?.[key] ?? b?.[key] ?? payload?.[key];
  if (raw == null || String(raw).trim() === '') return null;
  const n = Number(raw); return Number.isFinite(n) ? n : null;
}
function validateEnvelope(payload, requestedPage) {
  const h = headerOf(payload);
  const reason = clean(h.returnReasonCode);
  const auth = clean(h.returnAuthMsg);
  const err = clean(h.errMsg);
  const code = clean(h.resultCode);
  if (reason || auth || err) throw new Error(`OPENAPI_ERROR reason=${reason || '-'} auth=${auth || '-'} err=${err || '-'}`);
  if (code && code !== '00') throw new Error(`OPENAPI_ERROR resultCode=${code} resultMsg=${clean(h.resultMsg)}`);
  const page = metaNumber(payload, 'pageNo');
  if (page != null && page !== requestedPage) throw new Error(`PAGE_MISMATCH requested=${requestedPage} response=${page}`);
}
function validateItem(item) {
  if (!clean(item?.statId) || !clean(item?.chgerId) || !clean(item?.statNm)) {
    throw new Error('필수 EV 식별자가 비어 있습니다.');
  }
  if (clean(item?.zcode) !== '26') {
    throw new Error(`REGION_MISMATCH statId=${clean(item?.statId)} zcode=${clean(item?.zcode)}`);
  }
}
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function loadState() {
  if (existsSync(STATE_FILE)) {
    const parsed = JSON.parse(await readFile(STATE_FILE, 'utf8'));
    if (parsed.pageSize !== PAGE_SIZE) {
      throw new Error(`기존 backfill state pageSize=${parsed.pageSize}; 현재=${PAGE_SIZE}. ${STATE_FILE}을 삭제 후 다시 실행하세요.`);
    }
    return parsed;
  }
  return { pageSize: PAGE_SIZE, nextPage: 1, totalPages: null, totalCount: null, complete: false };
}
async function saveState(state) {
  await mkdir(dirname(STATE_FILE), { recursive: true });
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

async function fetchPage(serviceKey, pageNo) {
  const url = new URL(API_URL);
  url.searchParams.set('serviceKey', normalizeKey(serviceKey));
  url.searchParams.set('pageNo', String(pageNo));
  url.searchParams.set('numOfRows', String(PAGE_SIZE));
  url.searchParams.set('zcode', '26');
  url.searchParams.set('dataType', 'JSON');

  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      const body = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${body.slice(0, 250)}`);
      const payload = JSON.parse(body);
      validateEnvelope(payload, pageNo);
      const raw = itemsOf(payload);
      const unique = new Map();
      for (const item of raw) {
        validateItem(item);
        unique.set(`${clean(item.statId)}:${clean(item.chgerId)}`, item);
      }
      return { items: [...unique.values()], rawCount: raw.length, totalCount: metaNumber(payload, 'totalCount') };
    } catch (error) {
      lastError = error;
      if (attempt < 4) {
        const delay = [0, 1000, 2500, 5000][attempt] ?? 5000;
        console.log(`  ↻ EV API 재시도 ${attempt + 1}/4 (${delay / 1000}초)`);
        await sleep(delay);
      }
    }
  }
  throw lastError;
}

async function postWorker(adminToken, payload, label) {
  let lastError;
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    try {
      const res = await fetch(`${WORKER_BASE_URL}/api/admin/d1/ev-info-bulk-upsert`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(payload),
      });
      const text = await res.text();
      let data = null;
      try { data = JSON.parse(text); } catch { /* plain error page */ }

      if (res.ok && data?.ok) return data;
      if (res.status === 401 || res.status === 403) {
        throw new Error(`${label}: 관리자 토큰 인증 실패 (${res.status})`);
      }
      throw new Error(`${label}: HTTP ${res.status} ${data?.error || text.slice(0, 180)}`);
    } catch (error) {
      lastError = error;
      if (String(error?.message || error).includes('관리자 토큰 인증 실패')) throw error;
      if (attempt < 8) {
        const delays = [1000, 2000, 4000, 8000, 12000, 15000, 20000];
        const delay = delays[Math.min(attempt - 1, delays.length - 1)];
        console.log(`  ↻ ${label} 재시도 ${attempt + 1}/8 (${Math.round(delay / 1000)}초)`);
        await sleep(delay);
      }
    }
  }
  throw lastError;
}

async function uploadPage(adminToken, pageNo, items) {
  const totalChunks = Math.ceil(items.length / UPLOAD_CHUNK_SIZE);
  for (let offset = 0, chunkNo = 1; offset < items.length; offset += UPLOAD_CHUNK_SIZE, chunkNo += 1) {
    const chunk = items.slice(offset, offset + UPLOAD_CHUNK_SIZE);
    process.stdout.write(`  D1 upload ${offset + 1}-${offset + chunk.length} / ${items.length} ... `);
    const result = await postWorker(
      adminToken,
      { items: chunk, pageNo },
      `page ${pageNo} chunk ${chunkNo}/${totalChunks}`,
    );
    console.log(`${result.storedCount}건`);
  }
}

const rl = createInterface({ input, output });
try {
  let key = process.env.EV_CHARGER_API_KEY || '';
  if (!key) key = await rl.question('EV_CHARGER_API_KEY를 입력하세요: ');
  if (!key.trim()) throw new Error('EV_CHARGER_API_KEY가 필요합니다.');

  let adminToken = process.env.PLUGPARK_INGEST_TOKEN || '';
  if (!adminToken) adminToken = await rl.question('PLUGPARK_INGEST_TOKEN을 입력하세요: ');
  if (!adminToken.trim()) throw new Error('PLUGPARK_INGEST_TOKEN이 필요합니다.');

  let state = await loadState();
  if (state.complete) {
    console.log('이미 backfill 완료 상태입니다.');
    process.exit(0);
  }

  console.log(`\nPlugPark EV D1 backfill 시작: pageSize=${PAGE_SIZE}, resume page=${state.nextPage}`);
  console.log('Wrangler import를 사용하지 않고 Worker → D1 직접 업로드 방식으로 진행합니다.\n');

  while (!state.complete) {
    const pageNo = state.nextPage;
    process.stdout.write(`EV page ${pageNo}${state.totalPages ? ` / ${state.totalPages}` : ''} 조회... `);
    const page = await fetchPage(key, pageNo);
    console.log(`${page.items.length}건`);

    if (state.totalCount != null && page.totalCount != null && state.totalCount !== page.totalCount) {
      throw new Error(`TOTAL_COUNT_CHANGED ${state.totalCount} -> ${page.totalCount}`);
    }
    if (page.totalCount != null) {
      state.totalCount = page.totalCount;
      state.totalPages = Math.ceil(page.totalCount / PAGE_SIZE);
    }

    await uploadPage(adminToken, pageNo, page.items);

    const nextPage = pageNo + 1;
    const complete = page.rawCount < PAGE_SIZE || (state.totalPages != null && nextPage > state.totalPages);

    await postWorker(adminToken, {
      items: [],
      checkpoint: {
        pageNo,
        nextPage,
        totalPages: state.totalPages,
        reportedTotalCount: state.totalCount,
        complete,
        runId: RUN_ID,
      },
    }, `page ${pageNo} checkpoint`);

    state.nextPage = nextPage;
    state.complete = complete;
    await saveState(state);
    console.log(`✓ checkpoint nextPage=${state.nextPage}${state.complete ? ' · COMPLETE' : ''}\n`);
  }

  console.log('EV Info D1 전체 backfill 완료.');
  console.log(`확인: curl.exe "${WORKER_BASE_URL}/api/d1/ev-info-state?v=53"`);
} finally {
  rl.close();
}
