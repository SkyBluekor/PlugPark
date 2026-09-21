interface Env {
  BUSAN_PARKING_API_KEY?: string;
  EV_CHARGER_API_KEY?: string;
  MATCH_RADIUS_METERS?: string;
  ASSETS: Fetcher;
}

type AnyObject = Record<string, any>;

const PARKING_URL = 'https://apis.data.go.kr/6260000/BusanPblcPrkngInfoService/getPblcPrkngInfo';
const EV_INFO_URL = 'https://apis.data.go.kr/B552584/EvCharger/getChargerInfo';
const EV_STATUS_URL = 'https://apis.data.go.kr/B552584/EvCharger/getChargerStatus';
const EV_INITIAL_PAGE_SIZE = 1000;
const EV_MIN_PAGE_SIZE = 250;
const EV_MAX_RETRIES = 0;
const EV_CACHE_MS = 2 * 60 * 1000;

let evMemoryCache: { expiresAt: number; items: AnyObject[] } | null = null;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api/health') {
      return json({
        ok: true,
        parkingSecretConfigured: Boolean(env.BUSAN_PARKING_API_KEY),
        evSecretConfigured: Boolean(env.EV_CHARGER_API_KEY),
      });
    }

    if (url.pathname === '/api/places') {
      return handlePlaces(env);
    }

    if (url.pathname === '/api/parking') {
      if (!env.BUSAN_PARKING_API_KEY) return configError();
      try {
        return json({ ok: true, items: await fetchParking(env.BUSAN_PARKING_API_KEY) }, 200, 60);
      } catch (error) {
        return upstreamError(error);
      }
    }

    if (url.pathname === '/api/chargers') {
      if (!env.EV_CHARGER_API_KEY) return configError();
      try {
        return json({ ok: true, items: await fetchChargers(env.EV_CHARGER_API_KEY) }, 200, 60);
      } catch (error) {
        return upstreamError(error);
      }
    }

    if (url.pathname === '/api/ev-diagnostics') {
      if (!env.EV_CHARGER_API_KEY) return configError();
      return handleEvDiagnostics(env.EV_CHARGER_API_KEY);
    }

    return env.ASSETS.fetch(request);
  },
};

async function handlePlaces(env: Env) {
  if (!env.BUSAN_PARKING_API_KEY || !env.EV_CHARGER_API_KEY) return configError();

  try {
    const radius = clamp(Number(env.MATCH_RADIUS_METERS || '200'), 50, 500);
    const [parkingRaw, chargerRaw] = await Promise.all([
      fetchParking(env.BUSAN_PARKING_API_KEY),
      fetchChargers(env.EV_CHARGER_API_KEY),
    ]);

    const parking = parkingRaw.map(normalizeParking).filter(hasCoordinates);
    const chargers = chargerRaw.map(normalizeCharger).filter(hasCoordinates).filter((c) => c.deleted !== true);

    const places = parking
      .map((p) => matchPlace(p, chargers, radius))
      .filter((p): p is NonNullable<typeof p> => Boolean(p))
      .sort((a, b) => {
        if ((b.charger.available > 0) !== (a.charger.available > 0)) return b.charger.available > 0 ? 1 : -1;
        const aParking = a.availableParking ?? -1;
        const bParking = b.availableParking ?? -1;
        if ((bParking > 0) !== (aParking > 0)) return bParking > 0 ? 1 : -1;
        return b.charger.available - a.charger.available;
      });

    return json({
      ok: true,
      generatedAt: new Date().toISOString(),
      matchRadiusMeters: radius,
      parkingCount: parking.length,
      chargerCount: chargers.length,
      matchedCount: places.length,
      places,
    }, 200, 60);
  } catch (error) {
    return upstreamError(error);
  }
}

async function fetchParking(serviceKey: string): Promise<AnyObject[]> {
  const url = new URL(PARKING_URL);
  // Decoding 인증키 사용 권장: URLSearchParams가 안전하게 인코딩합니다.
  url.searchParams.set('serviceKey', normalizeServiceKey(serviceKey));
  url.searchParams.set('numOfRows', '1000');
  url.searchParams.set('pageNo', '1');
  url.searchParams.set('resultType', 'json');
  const data = await fetchJson(url);
  ensureNormalResult(data, '부산 공영주차장');
  return extractItems(data);
}

async function fetchJson(url: URL) {
  const response = await fetch(url.toString(), {
    headers: { Accept: 'application/json' },
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Upstream HTTP ${response.status}: ${compactText(body).slice(0, 220)}`);
  try {
    return JSON.parse(body);
  } catch {
    throw new Error(`JSON 응답이 아닙니다: ${compactText(body).slice(0, 220)}`);
  }
}

async function fetchChargers(serviceKey: string): Promise<AnyObject[]> {
  if (evMemoryCache && evMemoryCache.expiresAt > Date.now()) {
    return evMemoryCache.items;
  }

  const normalizedKey = normalizeServiceKey(serviceKey);
  let pageSize = EV_INITIAL_PAGE_SIZE;
  let first: AnyObject | null = null;
  let lastError: unknown = null;

  // 큰 응답이 원본 서버/게이트웨이에서 timeout 나는 경우를 대비해
  // 1000 → 500 → 250 순으로 자동 축소합니다. 250에서도 실패하면 과도한 API 호출을 막기 위해 중단합니다.
  while (pageSize >= EV_MIN_PAGE_SIZE) {
    try {
      first = await fetchEvInfoPage(normalizedKey, 1, pageSize);
      ensureNormalResult(first, '전기차 충전소');
      break;
    } catch (error) {
      lastError = error;
      if (!isSizeOrGatewayFailure(error) || pageSize === EV_MIN_PAGE_SIZE) throw error;
      pageSize = Math.max(EV_MIN_PAGE_SIZE, Math.floor(pageSize / 2));
      console.warn(`EV info page 1 failed; reducing page size to ${pageSize}`, safeError(error));
    }
  }

  if (!first) {
    throw lastError instanceof Error ? lastError : new Error('전기차 충전소 첫 페이지 호출 실패');
  }

  const firstItems = extractItems(first);
  const totalCount = toNumber(deepFindFirst(first, 'totalCount')) ?? firstItems.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const allItems = [...firstItems];

  // 너무 많은 동시 요청으로 초당 제한에 걸리지 않도록 3개씩 처리합니다.
  for (let startPage = 2; startPage <= totalPages; startPage += 3) {
    const pages = [startPage, startPage + 1, startPage + 2].filter((p) => p <= totalPages);
    const payloads = await Promise.all(
      pages.map((pageNo) => fetchEvInfoPage(normalizedKey, pageNo, pageSize)),
    );
    for (const payload of payloads) {
      ensureNormalResult(payload, '전기차 충전소');
      allItems.push(...extractItems(payload));
    }
  }

  evMemoryCache = {
    expiresAt: Date.now() + EV_CACHE_MS,
    items: allItems,
  };

  return allItems;
}

async function fetchEvInfoPage(serviceKey: string, pageNo: number, pageSize: number) {
  const url = buildEvUrl(EV_INFO_URL, serviceKey, pageNo, pageSize, { zcode: '26' });
  return fetchStructuredWithRetry(url, EV_MAX_RETRIES);
}

function buildEvUrl(
  base: string,
  serviceKey: string,
  pageNo: number,
  pageSize: number,
  extras: Record<string, string> = {},
  keyName: 'serviceKey' | 'ServiceKey' = 'serviceKey',
) {
  const url = new URL(base);

  // getChargerInfo는 첨부 v1.25 가이드의 `serviceKey`를 사용합니다.
  // 현재 공공데이터포털에 노출된 getChargerStatus는 `ServiceKey`를 사용합니다.
  url.searchParams.set(keyName, serviceKey);
  url.searchParams.set('pageNo', String(pageNo));
  url.searchParams.set('numOfRows', String(pageSize));

  // dataType을 강제하지 않습니다.
  // 문서상 JSON/XML을 지원하지만 현재 포털은 XML 표기가 있어 기본 응답을 받아 양쪽 모두 파싱합니다.
  for (const [key, value] of Object.entries(extras)) {
    url.searchParams.set(key, value);
  }

  return url;
}

async function fetchStructured(url: URL) {
  const response = await fetch(url.toString(), {
    headers: {
      Accept: 'application/xml, text/xml, application/json;q=0.9, */*;q=0.1',
    },
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Upstream HTTP ${response.status}: ${compactText(text).slice(0, 220)}`);
  }

  return parseStructuredPayload(text, response.headers.get('content-type') || '');
}

async function fetchStructuredWithRetry(url: URL, maxRetries: number) {
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await fetchStructured(url);
    } catch (error) {
      lastError = error;
      if (!isRetryableUpstreamError(error) || attempt === maxRetries) break;
      await sleep(300 * (attempt + 1));
    }
  }

  throw lastError instanceof Error ? lastError : new Error('외부 API 호출 실패');
}

function parseStructuredPayload(raw: string, contentType: string): AnyObject {
  const body = raw.trim();
  if (!body) throw new Error('외부 API가 빈 응답을 반환했습니다.');

  const looksJson = contentType.includes('json') || body.startsWith('{') || body.startsWith('[');
  if (looksJson) {
    try {
      return JSON.parse(body);
    } catch (error) {
      throw new Error(`JSON 파싱 실패: ${safeError(error)}`);
    }
  }

  if (body.startsWith('<')) {
    return parseEvXml(body);
  }

  // 일부 게이트웨이 오류가 text/plain으로 JSON을 반환하는 경우를 한 번 더 허용합니다.
  try {
    return JSON.parse(body);
  } catch {
    throw new Error(`알 수 없는 응답 형식: ${compactText(body).slice(0, 220)}`);
  }
}

function parseEvXml(xml: string): AnyObject {
  const itemBlocks = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map((m) => m[1]);
  const items = itemBlocks.map((block) => {
    const item: AnyObject = {};
    for (const match of block.matchAll(/<([A-Za-z0-9_]+)>([\s\S]*?)<\/\1>/g)) {
      item[match[1]] = decodeXml(match[2].trim());
    }
    return item;
  });

  const resultCode = xmlTag(xml, 'resultCode');
  const resultMsg = xmlTag(xml, 'resultMsg');
  const totalCount = xmlTag(xml, 'totalCount');
  const pageNo = xmlTag(xml, 'pageNo');
  const numOfRows = xmlTag(xml, 'numOfRows');

  return {
    response: {
      header: {
        resultCode,
        resultMsg,
      },
      body: {
        totalCount,
        pageNo,
        numOfRows,
        items: { item: items },
      },
    },
  };
}

function xmlTag(xml: string, tag: string) {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = xml.match(new RegExp(`<${escaped}>([\\s\\S]*?)<\\/${escaped}>`, 'i'));
  return match ? decodeXml(match[1].trim()) : undefined;
}

function decodeXml(value: string) {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

async function handleEvDiagnostics(serviceKey: string) {
  const key = normalizeServiceKey(serviceKey);
  const probes = [
    ['getChargerInfo', buildEvUrl(EV_INFO_URL, key, 1, 10, { zcode: '26' })],
    ['getChargerStatus', buildEvUrl(EV_STATUS_URL, key, 1, 10, { zcode: '26', period: '5' }, 'ServiceKey')],
  ] as const;

  const results = [];
  for (const [name, url] of probes) {
    const startedAt = Date.now();
    try {
      const response = await fetch(url.toString(), {
        headers: { Accept: 'application/xml, text/xml, application/json;q=0.9, */*;q=0.1' },
      });
      const raw = await response.text();
      let parsed: AnyObject | null = null;
      let parseError: string | null = null;
      try {
        parsed = parseStructuredPayload(raw, response.headers.get('content-type') || '');
      } catch (error) {
        parseError = safeError(error);
      }

      results.push({
        name,
        httpStatus: response.status,
        elapsedMs: Date.now() - startedAt,
        contentType: response.headers.get('content-type'),
        resultCode: parsed ? deepFindFirst(parsed, 'resultCode') ?? null : null,
        resultMsg: parsed ? deepFindFirst(parsed, 'resultMsg') ?? null : null,
        totalCount: parsed ? deepFindFirst(parsed, 'totalCount') ?? null : null,
        itemCount: parsed ? extractItems(parsed).length : 0,
        parseError,
        responsePreview: compactText(raw).slice(0, 240),
      });
    } catch (error) {
      results.push({
        name,
        httpStatus: null,
        elapsedMs: Date.now() - startedAt,
        error: safeError(error),
      });
    }
  }

  return json({
    ok: results.every((r: AnyObject) => r.httpStatus === 200 && (!r.resultCode || String(r.resultCode) === '00')),
    generatedAt: new Date().toISOString(),
    note: '인증키 값은 응답에 포함하지 않습니다. 각 엔드포인트를 10건만 호출한 진단 결과입니다.',
    results,
  }, 200);
}

function compactText(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function safeError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isSizeOrGatewayFailure(error: unknown) {
  if (!(error instanceof Error)) return false;
  return /Upstream HTTP (408|413|429|500|502|503|504|520|521|522|523|524)/.test(error.message)
    || /timeout|timed out|connection|network/i.test(error.message);
}

function isRetryableUpstreamError(error: unknown) {
  if (!(error instanceof Error)) return false;
  return /Upstream HTTP (408|429|500|502|503|504|520|521|522|523|524)/.test(error.message);
}

function normalizeServiceKey(serviceKey: string) {
  const trimmed = serviceKey.trim();
  try {
    // 공공데이터포털의 Encoding 인증키를 Secret에 넣어도 이중 인코딩되지 않도록
    // 한 번만 decode합니다. Decoding 인증키는 그대로 유지됩니다.
    return decodeURIComponent(trimmed);
  } catch {
    return trimmed;
  }
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function ensureNormalResult(payload: AnyObject, source: string) {
  const resultCode = deepFindFirst(payload, 'resultCode');
  const resultMsg = deepFindFirst(payload, 'resultMsg');
  if (resultCode != null && String(resultCode) !== '00') {
    throw new Error(`${source} API 오류 ${resultCode}: ${resultMsg || 'unknown'}`);
  }
}

function extractItems(payload: any): AnyObject[] {
  const common = [
    payload?.response?.body?.items?.item,
    payload?.body?.items?.item,
    payload?.items?.item,
    payload?.response?.body?.items,
    payload?.body?.items,
  ];
  for (const value of common) {
    if (Array.isArray(value)) return value;
    if (value && typeof value === 'object' && !Array.isArray(value)) return [value];
  }

  const found = deepFindFirst(payload, 'item');
  if (Array.isArray(found)) return found;
  if (found && typeof found === 'object') return [found];
  return [];
}

function deepFindFirst(node: any, key: string): any {
  if (!node || typeof node !== 'object') return undefined;
  if (Object.prototype.hasOwnProperty.call(node, key)) return node[key];
  for (const value of Object.values(node)) {
    const found = deepFindFirst(value, key);
    if (found !== undefined) return found;
  }
  return undefined;
}

function normalizeParking(p: AnyObject) {
  const capacity = toNumber(p.pkCnt);
  const availableParking = toNumber(p.currava);
  const basicTime = textValue(p.pkBascTime);
  const baseFee = textValue(p.tenMin);
  const feeText = baseFee
    ? `${basicTime || '기본'}분 ${Number(baseFee).toLocaleString('ko-KR')}원`
    : textValue(p.feeInfo) || '요금 정보 확인 필요';

  const start = textValue(p.svcSrtTe);
  const end = textValue(p.svcEndTe);

  return {
    id: textValue(p.mgntNum) || textValue(p.pkNam) || crypto.randomUUID(),
    name: textValue(p.pkNam) || '이름 없는 공영주차장',
    address: textValue(p.doroAddr) || textValue(p.jibunAddr) || '주소 정보 없음',
    lat: toNumber(p.xCdnt),
    lng: toNumber(p.yCdnt),
    capacity,
    availableParking,
    feeText,
    operationText: start || end ? `${start || '?'} ~ ${end || '?'}` : textValue(p.oprDay) || '운영시간 확인 필요',
    parkingUpdatedAt: textValue(p.fnlDt) || null,
  };
}

function normalizeCharger(c: AnyObject) {
  return {
    stationId: textValue(c.statId),
    chargerId: textValue(c.chgerId),
    stationName: textValue(c.statNm) || '전기차 충전소',
    lat: toNumber(c.lat),
    lng: toNumber(c.lng),
    type: textValue(c.chgerType),
    status: textValue(c.stat),
    output: toNumber(c.output),
    updatedAt: textValue(c.statUpdDt) || null,
    deleted: textValue(c.delYn) === 'Y',
  };
}

function matchPlace(parking: any, chargers: any[], radius: number) {
  const nearby = chargers
    .map((c) => ({ ...c, distance: haversineMeters(parking.lat, parking.lng, c.lat, c.lng) }))
    .filter((c) => c.distance <= radius);
  if (!nearby.length) return null;

  const stations = [...new Set(nearby.map((c) => c.stationName).filter(Boolean))];
  const available = nearby.filter((c) => c.status === '2').length;
  const charging = nearby.filter((c) => c.status === '3').length;
  const fast = nearby.filter(isFastCharger).length;
  const slow = nearby.length - fast;
  const nearestDistanceMeters = Math.min(...nearby.map((c) => c.distance));
  const lastUpdated = nearby.map((c) => c.updatedAt).filter(Boolean).sort().at(-1) || null;

  return {
    ...parking,
    charger: {
      total: nearby.length,
      available,
      charging,
      fast,
      slow,
      stations,
      nearestDistanceMeters: Math.round(nearestDistanceMeters),
      lastUpdated,
    },
    source: 'live' as const,
  };
}

function isFastCharger(c: any) {
  if (typeof c.output === 'number' && c.output > 0) return c.output >= 50;
  return ['01', '03', '04', '05', '06', '07', '09', '10'].includes(c.type);
}

function hasCoordinates<T extends { lat: number | null; lng: number | null }>(item: T): item is T & { lat: number; lng: number } {
  return Number.isFinite(item.lat) && Number.isFinite(item.lng);
}

function haversineMeters(aLat: number, aLng: number, bLat: number, bLng: number) {
  const R = 6371000;
  const rad = (v: number) => (v * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function toNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(String(value).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function textValue(value: unknown) {
  return value == null ? '' : String(value).trim();
}

function clamp(v: number, min: number, max: number) {
  if (!Number.isFinite(v)) return min;
  return Math.min(Math.max(v, min), max);
}

function json(data: unknown, status = 200, maxAge = 0) {
  const headers = new Headers({ 'content-type': 'application/json; charset=utf-8' });
  if (maxAge) headers.set('cache-control', `public, max-age=${maxAge}`);
  return new Response(JSON.stringify(data), { status, headers });
}

function configError() {
  return json({
    ok: false,
    error: 'API Secret이 설정되지 않았습니다. 로컬은 .dev.vars, 운영은 wrangler secret 또는 Cloudflare Dashboard Secrets를 사용하세요.',
  }, 503);
}

function upstreamError(error: unknown) {
  console.error(error);
  return json({ ok: false, error: error instanceof Error ? error.message : '외부 API 호출 실패' }, 502);
}
