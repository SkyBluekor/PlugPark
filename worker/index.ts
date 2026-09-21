interface Env {
  BUSAN_PARKING_API_KEY?: string;
  EV_CHARGER_API_KEY?: string;
  // 공공데이터포털의 "부산시설공단_공영주차장 시설 현황 조회 서비스" 상세기능 요청주소.
  // 공개 검색 화면에는 실제 요청주소가 노출되지 않으므로 환경변수로 주입합니다.
  BUSAN_REALTIME_PARKING_API_URL?: string;
  MATCH_RADIUS_METERS?: string;
  ASSETS: Fetcher;
}

type AnyObject = Record<string, any>;

type ParkingBase = {
  id: string;
  name: string;
  address: string;
  agency: string;
  lat: number | null;
  lng: number | null;
  capacity: number | null;
  availableParking: number | null;
  occupiedParking: number | null;
  feeText: string;
  operationText: string;
  parkingUpdatedAt: string | null;
  parkingRealtime: boolean;
  parkingSource: 'busan-city' | 'busan-facilities' | 'merged';
};

type Charger = {
  stationId: string;
  chargerId: string;
  stationName: string;
  address: string;
  lat: number | null;
  lng: number | null;
  type: string;
  status: string;
  output: number | null;
  updatedAt: string | null;
  deleted: boolean;
};

type ChargerStation = {
  stationId: string;
  stationName: string;
  address: string;
  lat: number;
  lng: number;
  chargers: Charger[];
};

const PARKING_BASE_URL =
  'https://apis.data.go.kr/6260000/BusanPblcPrkngInfoService/getPblcPrkngInfo';

const EV_INFO_URL =
  'https://apis.data.go.kr/B552584/EvCharger/getChargerInfo';

const EV_STATUS_URL =
  'https://apis.data.go.kr/B552584/EvCharger/getChargerStatus';

const EV_BUSAN_PAGE_SIZE = 2000;
const EV_BUSAN_MAX_PAGES = 10;
const EV_NATIONAL_FALLBACK_PAGE_SIZE = 9999;
const EV_NATIONAL_FALLBACK_MAX_PAGES = 10;
const EV_SNAPSHOT_TTL_SECONDS = 6 * 60 * 60;
const PLACES_TTL_SECONDS = 5 * 60;

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api/health') {
      return json({
        ok: true,
        parkingSecretConfigured: Boolean(env.BUSAN_PARKING_API_KEY),
        evSecretConfigured: Boolean(env.EV_CHARGER_API_KEY),
        realtimeParkingUrlConfigured: Boolean(env.BUSAN_REALTIME_PARKING_API_URL),
      });
    }

    if (url.pathname === '/api/parking-diagnostics') {
      if (!env.BUSAN_PARKING_API_KEY) return configError('BUSAN_PARKING_API_KEY');
      return handleParkingDiagnostics(env);
    }

    if (url.pathname === '/api/ev-diagnostics') {
      if (!env.EV_CHARGER_API_KEY) return configError('EV_CHARGER_API_KEY');
      return handleEvDiagnostics(env.EV_CHARGER_API_KEY);
    }

    if (url.pathname === '/api/parking') {
      if (!env.BUSAN_PARKING_API_KEY) return configError('BUSAN_PARKING_API_KEY');
      try {
        const result = await fetchMergedParking(env);
        return json({ ok: true, ...result }, 200, 60);
      } catch (error) {
        return upstreamError(error);
      }
    }

    if (url.pathname === '/api/parking-places') {
      if (!env.BUSAN_PARKING_API_KEY) return configError('BUSAN_PARKING_API_KEY');
      try {
        const result = await fetchMergedParking(env);
        return json({
          ok: true,
          places: result.items.map(toParkingOnlyPlace),
          realtimeParking: result.realtime,
          realtimeMessage: result.realtimeMessage,
        }, 200, 60);
      } catch (error) {
        return upstreamError(error);
      }
    }

    if (url.pathname === '/api/chargers') {
      if (!env.EV_CHARGER_API_KEY) return configError('EV_CHARGER_API_KEY');
      try {
        const snapshot = await getEvSnapshot(env, ctx);
        const withStatus = await overlayRecentEvStatus(snapshot.items, env.EV_CHARGER_API_KEY);
        return json({
          ok: true,
          items: withStatus,
          complete: snapshot.complete,
          source: snapshot.source,
        }, 200, 120);
      } catch (error) {
        return upstreamError(error);
      }
    }

    if (url.pathname === '/api/ev-summary') {
      if (!env.EV_CHARGER_API_KEY) return configError('EV_CHARGER_API_KEY');
      try {
        const snapshot = await getEvSnapshot(env, ctx);
        const chargers = snapshot.items
          .map(normalizeCharger)
          .filter((charger) => !charger.deleted)
          .filter(hasMapCoordinates);
        const stations = groupChargerStations(chargers);

        return json({
          ok: true,
          complete: snapshot.complete,
          source: snapshot.source,
          chargerCount: chargers.length,
          stationCount: stations.length,
        }, 200, 120);
      } catch (error) {
        return upstreamError(error);
      }
    }

    if (url.pathname === '/api/ev-search') {
      if (!env.EV_CHARGER_API_KEY) return configError('EV_CHARGER_API_KEY');
      try {
        const query = (url.searchParams.get('q') || '').trim().toLowerCase();
        if (!query) {
          return json({ ok: false, error: 'q 검색어를 입력해주세요.' }, 400);
        }

        const snapshot = await getEvSnapshot(env, ctx);
        const matches = snapshot.items
          .filter((row) => {
            const haystack = [
              pickText(row, ['statNm']),
              pickText(row, ['addr']),
              pickText(row, ['addrDetail']),
              pickText(row, ['statId']),
            ].join(' ').toLowerCase();
            return haystack.includes(query);
          })
          .slice(0, 100);

        return json({
          ok: true,
          query,
          complete: snapshot.complete,
          source: snapshot.source,
          count: matches.length,
          items: matches,
        }, 200, 60);
      } catch (error) {
        return upstreamError(error);
      }
    }

    if (url.pathname === '/api/places') {
      return handlePlaces(env, ctx);
    }

    if (url.pathname === '/api/ev-refresh') {
      if (!env.EV_CHARGER_API_KEY) return configError('EV_CHARGER_API_KEY');
      ctx.waitUntil(refreshFullEvSnapshot(env.EV_CHARGER_API_KEY));
      return json({ ok: true, message: 'EV 전체 스냅샷 갱신을 백그라운드에서 시작했습니다.' }, 202);
    }

    return env.ASSETS.fetch(request);
  },
};

async function handlePlaces(env: Env, ctx: ExecutionContext) {
  if (!env.BUSAN_PARKING_API_KEY) return configError('BUSAN_PARKING_API_KEY');
  if (!env.EV_CHARGER_API_KEY) return configError('EV_CHARGER_API_KEY');

  const radius = clamp(Number(env.MATCH_RADIUS_METERS || '200'), 50, 500);

  try {
    const [parkingResult, evSnapshot] = await Promise.all([
      fetchMergedParking(env),
      getEvSnapshot(env, ctx),
    ]);

    const chargerRows = await overlayRecentEvStatus(evSnapshot.items, env.EV_CHARGER_API_KEY);
    const chargers = chargerRows
      .map(normalizeCharger)
      .filter(hasMapCoordinates)
      .filter((c) => !c.deleted);

    const stations = groupChargerStations(chargers);

    // EV 매칭이 없어도 주차장은 유지합니다.
    const places = parkingResult.items
      .map((parking) => matchPlaceImproved(parking, stations, radius))
      .sort(sortPlaces);

    return json({
      ok: true,
      generatedAt: new Date().toISOString(),
      matchRadiusMeters: radius,
      parkingCount: parkingResult.items.length,
      chargerCount: chargers.length,
      chargerStationCount: stations.length,
      matchedCount: places.filter((p) => p.charger.total > 0).length,
      // matchedCount는 "EV가 매칭된 공영주차장 수"이고,
      // chargerStationCount/chargerCount가 부산 EV 충전소/충전기 전체 수입니다.
      evSnapshotComplete: evSnapshot.complete,
      evSnapshotSource: evSnapshot.source,
      realtimeParking: parkingResult.realtime,
      realtimeMessage: parkingResult.realtimeMessage,
      places,
    }, 200, PLACES_TTL_SECONDS);
  } catch (error) {
    return upstreamError(error);
  }
}

/* -------------------------------------------------------------------------- */
/* Parking                                                                     */
/* -------------------------------------------------------------------------- */

async function fetchMergedParking(env: Env): Promise<{
  items: ParkingBase[];
  realtime: boolean;
  realtimeMessage: string | null;
}> {
  const key = env.BUSAN_PARKING_API_KEY!;
  const basePromise = fetchBaseParking(key);

  if (!env.BUSAN_REALTIME_PARKING_API_URL) {
    const base = (await basePromise).map(normalizeBaseParking);
    return {
      items: base,
      realtime: false,
      realtimeMessage:
        'BUSAN_REALTIME_PARKING_API_URL이 아직 설정되지 않아 부산광역시 공영주차장 API를 사용 중입니다.',
    };
  }

  const [baseResult, realtimeResult] = await Promise.allSettled([
    basePromise,
    fetchRealtimeParking(key, env.BUSAN_REALTIME_PARKING_API_URL),
  ]);

  if (baseResult.status === 'rejected' && realtimeResult.status === 'rejected') {
    throw new Error(
      `주차 API 모두 실패: base=${safeError(baseResult.reason)} / realtime=${safeError(realtimeResult.reason)}`,
    );
  }

  const base = baseResult.status === 'fulfilled'
    ? baseResult.value.map(normalizeBaseParking)
    : [];

  if (realtimeResult.status === 'rejected') {
    return {
      items: base,
      realtime: false,
      realtimeMessage: `부산시설공단 실시간 API 호출 실패: ${safeError(realtimeResult.reason)}`,
    };
  }

  const liveRows = realtimeResult.value.map(normalizeRealtimeParking);
  const merged = mergeParkingRows(base, liveRows);

  return {
    items: merged,
    realtime: liveRows.some((p) => p.availableParking != null || p.occupiedParking != null),
    realtimeMessage: null,
  };
}

async function fetchBaseParking(serviceKey: string): Promise<AnyObject[]> {
  const url = new URL(PARKING_BASE_URL);
  url.searchParams.set('serviceKey', normalizeServiceKey(serviceKey));
  url.searchParams.set('numOfRows', '1000');
  url.searchParams.set('pageNo', '1');
  url.searchParams.set('resultType', 'json');

  const payload = await fetchStructured(url);
  ensureNormalResult(payload, '부산광역시 공영주차장');
  return extractItems(payload);
}

async function fetchRealtimeParking(serviceKey: string, endpoint: string): Promise<AnyObject[]> {
  const url = new URL(endpoint.trim());

  // 이미 상세기능 URL에 파라미터가 포함된 경우 값을 덮어쓰지 않습니다.
  if (!url.searchParams.has('serviceKey') && !url.searchParams.has('ServiceKey')) {
    url.searchParams.set('serviceKey', normalizeServiceKey(serviceKey));
  }
  if (!url.searchParams.has('pageNo')) url.searchParams.set('pageNo', '1');
  if (!url.searchParams.has('numOfRows')) url.searchParams.set('numOfRows', '200');
  if (!url.searchParams.has('resultType')) url.searchParams.set('resultType', 'json');

  const payload = await fetchStructured(url);
  ensureNormalResult(payload, '부산시설공단 실시간 주차');
  return extractItems(payload);
}

function normalizeBaseParking(p: AnyObject): ParkingBase {
  const capacity = pickNumber(p, ['pkCnt', 'parkingCnt', 'capacity', 'totalCnt']);
  const availableParking = pickNumber(p, ['currava', 'availableParking', 'availableCnt']);

  const basicTime = pickText(p, ['pkBascTime']);
  const baseFee = pickText(p, ['tenMin']);
  const feeText = baseFee
    ? `${basicTime || '기본'}분 ${Number(baseFee).toLocaleString('ko-KR')}원`
    : pickText(p, ['feeInfo']) || '요금 정보 확인 필요';

  const start = pickText(p, ['svcSrtTe']);
  const end = pickText(p, ['svcEndTe']);

  return {
    id: pickText(p, ['mgntNum', 'pParkGCd', 'parkingCode']) || pickText(p, ['pkNam', 'name']) || crypto.randomUUID(),
    name: pickText(p, ['pkNam', 'parkingName', 'parkName', 'name']) || '이름 없는 공영주차장',
    address: pickText(p, ['doroAddr', 'jibunAddr', 'address', 'addr']) || '주소 정보 없음',
    agency: pickText(p, ['guNm', 'agency', 'managementAgency']),
    lat: normalizeLat(pickNumber(p, ['lat', 'latitude', 'xCdnt'])),
    lng: normalizeLng(pickNumber(p, ['lng', 'longitude', 'lon', 'yCdnt'])),
    capacity,
    availableParking,
    occupiedParking:
      capacity != null && availableParking != null
        ? Math.max(0, capacity - availableParking)
        : null,
    feeText,
    operationText:
      start || end
        ? `${start || '?'} ~ ${end || '?'}`
        : pickText(p, ['oprDay']) || '운영시간 확인 필요',
    parkingUpdatedAt: pickText(p, ['fnlDt', 'updateDt', 'updatedAt']) || null,
    parkingRealtime: availableParking != null,
    parkingSource: 'busan-city',
  };
}

function normalizeRealtimeParking(p: AnyObject): ParkingBase {
  // 부산시설공단 실제 응답 필드 우선:
  // maxcnt       = 최대 주차 가능 대수
  // parkingcnt   = 현재 주차 대수
  // curravacnt   = 현재 주차 가능 대수
  let capacity = pickNumber(p, [
    'maxcnt',
    'maxParkingCount', 'maxParkingCnt', 'maxParkCnt', 'maximumParking',
    'capacity', 'totalCnt', 'pkCnt',
  ]);

  let availableParking = pickNumber(p, [
    'curravacnt',
    'availableParkingCount', 'availableParkingCnt', 'parkingAvailableCount',
    'parkingAvailable', 'availableCnt', 'availCnt', 'remainCnt',
    'remainCount', 'freeSpace', 'emptyCnt', 'possibleCnt',
  ]);

  let occupiedParking = pickNumber(p, [
    'parkingcnt',
    'currentParkingCount', 'currentParkingCnt', 'currentParking',
    'occupiedParkingCount', 'occupiedCnt', 'useCnt', 'parkingUseCnt',
    'currentCnt',
  ]);

  if (availableParking == null && capacity != null && occupiedParking != null) {
    availableParking = Math.max(0, capacity - occupiedParking);
  }
  if (occupiedParking == null && capacity != null && availableParking != null) {
    occupiedParking = Math.max(0, capacity - availableParking);
  }
  if (capacity == null && availableParking != null && occupiedParking != null) {
    capacity = availableParking + occupiedParking;
  }

  // 정상 응답은 maxcnt = parkingcnt + curravacnt 관계를 만족합니다.
  // 데이터가 일시적으로 어긋나면 maxcnt와 parkingcnt를 기준으로 잔여면을 보정합니다.
  if (
    capacity != null &&
    occupiedParking != null &&
    availableParking != null &&
    Math.abs(capacity - (occupiedParking + availableParking)) > 1
  ) {
    availableParking = Math.max(0, capacity - occupiedParking);
  }

  return {
    id: pickText(p, ['parkgcd', 'pParkGCd', 'parkCode', 'parkingCode', 'mgntNum', 'id']) || crypto.randomUUID(),
    name: pickText(p, [
      'parknm', 'pParkNm', 'pParkName', 'parkingName', 'parkName', 'pkNam',
      'facilityName', 'name',
    ]) || '부산시설공단 공영주차장',
    address: pickText(p, ['address', 'addr', 'roadAddress', 'doroAddr', 'jibunAddr']) || '',
    agency: pickText(p, ['guNm', 'agency', 'managementAgency', 'operatorName']),
    lat: normalizeLat(pickNumber(p, ['lat', 'latitude', 'x', 'xCdnt'])),
    lng: normalizeLng(pickNumber(p, ['lng', 'longitude', 'lon', 'y', 'yCdnt'])),
    capacity,
    availableParking,
    occupiedParking,
    feeText: pickText(p, ['feeText', 'parkingFee', 'feeInfo']) || '요금 정보 확인 필요',
    operationText: pickText(p, ['operationTime', 'operatingTime', 'useTime']) || '운영시간 확인 필요',
    parkingUpdatedAt:
      pickText(p, [
        'lastupdatetime',
        'lastUpdateDt', 'lastUpdatedAt', 'lastUpdate', 'updateDt',
        'updatedAt', 'updateTime', 'lastUpdDt',
      ]) || null,
    parkingRealtime: availableParking != null || occupiedParking != null,
    parkingSource: 'busan-facilities',
  };
}

function mergeParkingRows(base: ParkingBase[], live: ParkingBase[]): ParkingBase[] {
  const used = new Set<number>();
  const merged = base.map((parking) => {
    let bestIndex = -1;
    let bestScore = 0;

    for (let i = 0; i < live.length; i += 1) {
      if (used.has(i)) continue;
      const score = parkingIdentityScore(parking, live[i]);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }

    if (bestIndex < 0 || bestScore < 4) return parking;

    used.add(bestIndex);
    const r = live[bestIndex];

    return {
      ...parking,
      id: r.id || parking.id,
      capacity: r.capacity ?? parking.capacity,
      availableParking: r.availableParking ?? parking.availableParking,
      occupiedParking: r.occupiedParking ?? parking.occupiedParking,
      parkingUpdatedAt: r.parkingUpdatedAt ?? parking.parkingUpdatedAt,
      parkingRealtime: r.parkingRealtime || parking.parkingRealtime,
      parkingSource: 'merged' as const,
      lat: r.lat ?? parking.lat,
      lng: r.lng ?? parking.lng,
      address: parking.address !== '주소 정보 없음' ? parking.address : (r.address || parking.address),
      agency: parking.agency || r.agency,
      feeText: parking.feeText !== '요금 정보 확인 필요' ? parking.feeText : r.feeText,
      operationText:
        parking.operationText !== '운영시간 확인 필요'
          ? parking.operationText
          : r.operationText,
    };
  });

  // 부산시설공단 데이터에만 있는 주차장도 검색 목록에는 유지합니다.
  // 좌표가 없으면 프론트의 Kakao geocoder가 위치를 보완합니다.
  for (let i = 0; i < live.length; i += 1) {
    if (!used.has(i)) merged.push(live[i]);
  }

  return dedupeParking(merged);
}

function parkingIdentityScore(a: ParkingBase, b: ParkingBase) {
  let score = 0;

  const aid = normalizeIdentity(a.id);
  const bid = normalizeIdentity(b.id);
  if (aid && bid && aid === bid) score += 10;

  const an = normalizePlaceName(a.name);
  const bn = normalizePlaceName(b.name);
  if (an && bn) {
    if (an === bn) score += 8;
    else if (an.includes(bn) || bn.includes(an)) score += 6;
    else score += tokenOverlapScore(an, bn) * 4;
  }

  const aa = normalizeAddress(a.address);
  const ba = normalizeAddress(b.address);
  if (aa && ba) {
    if (aa === ba) score += 5;
    else score += tokenOverlapScore(aa, ba) * 3;
  }

  if (hasMapCoordinates(a) && hasMapCoordinates(b)) {
    const d = haversineMeters(a.lat, a.lng, b.lat, b.lng);
    if (d <= 40) score += 6;
    else if (d <= 100) score += 4;
    else if (d <= 250) score += 2;
  }

  return score;
}

function dedupeParking(items: ParkingBase[]) {
  const out: ParkingBase[] = [];
  for (const p of items) {
    const found = out.findIndex((q) => parkingIdentityScore(p, q) >= 8);
    if (found < 0) out.push(p);
    else if (parkingCompleteness(p) > parkingCompleteness(out[found])) out[found] = p;
  }
  return out;
}

function parkingCompleteness(p: ParkingBase) {
  return [
    p.capacity != null,
    p.availableParking != null,
    p.occupiedParking != null,
    p.parkingRealtime,
    Boolean(p.parkingUpdatedAt),
    hasMapCoordinates(p),
    p.address && p.address !== '주소 정보 없음',
  ].filter(Boolean).length;
}

/* -------------------------------------------------------------------------- */
/* EV snapshot + recent status                                                 */
/* -------------------------------------------------------------------------- */

async function getEvSnapshot(env: Env, ctx: ExecutionContext): Promise<{
  items: AnyObject[];
  complete: boolean;
  source: 'full-cache' | 'busan-live';
}> {
  const cache = getDefaultCache();

  if (cache) {
    const cached = await cache.match(evCacheRequest('full'));
    if (cached) {
      const payload = await cached.json() as { items?: AnyObject[]; generatedAt?: string };
      ctx.waitUntil(refreshFullEvSnapshotIfStale(env.EV_CHARGER_API_KEY!));
      return {
        items: payload.items || [],
        complete: true,
        source: 'full-cache',
      };
    }
  }

  // 중요:
  // 기존 quick snapshot(첫 1000건)을 더 이상 "부산 전체"로 취급하지 않습니다.
  // zcode=26으로 부산 페이지를 끝까지 읽고, 응답 필터가 무시되는 경우에만
  // 전국 페이지를 훑어 부산 데이터만 로컬 필터링합니다.
  const items = await fetchCompleteBusanEvInfo(env.EV_CHARGER_API_KEY!);

  if (cache) {
    ctx.waitUntil(
      Promise.all([
        cache.put(
          evCacheRequest('full'),
          cacheJson(
            { items, generatedAt: new Date().toISOString() },
            EV_SNAPSHOT_TTL_SECONDS,
          ),
        ),
        cache.put(
          evCacheRequest('full-meta'),
          cacheJson(
            { generatedAt: new Date().toISOString(), count: items.length },
            EV_SNAPSHOT_TTL_SECONDS,
          ),
        ),
      ]).then(() => undefined),
    );
  }

  return {
    items,
    complete: true,
    source: 'busan-live',
  };
}

async function refreshFullEvSnapshotIfStale(serviceKey: string) {
  const cache = getDefaultCache();
  if (!cache) return;

  const meta = await cache.match(evCacheRequest('full-meta'));

  if (meta) {
    try {
      const data = await meta.json() as { generatedAt?: string };
      const age = Date.now() - new Date(data.generatedAt || 0).getTime();
      if (Number.isFinite(age) && age < EV_SNAPSHOT_TTL_SECONDS * 1000) return;
    } catch {
      // 메타가 깨졌으면 새로 수집합니다.
    }
  }

  await refreshFullEvSnapshot(serviceKey);
}

async function refreshFullEvSnapshot(serviceKey: string) {
  const cache = getDefaultCache();
  if (!cache) return;

  const lockReq = evCacheRequest('refresh-lock');
  if (await cache.match(lockReq)) return;

  await cache.put(
    lockReq,
    cacheJson({ startedAt: new Date().toISOString() }, 120),
  );

  try {
    const items = await fetchCompleteBusanEvInfo(serviceKey);

    await Promise.all([
      cache.put(
        evCacheRequest('full'),
        cacheJson(
          { items, generatedAt: new Date().toISOString() },
          EV_SNAPSHOT_TTL_SECONDS,
        ),
      ),
      cache.put(
        evCacheRequest('full-meta'),
        cacheJson(
          { generatedAt: new Date().toISOString(), count: items.length },
          EV_SNAPSHOT_TTL_SECONDS,
        ),
      ),
    ]);
  } catch (error) {
    console.error('EV full snapshot refresh failed', error);
  }
}

async function fetchCompleteBusanEvInfo(serviceKey: string): Promise<AnyObject[]> {
  const key = normalizeServiceKey(serviceKey);
  const collected: AnyObject[] = [];
  const seen = new Set<string>();

  let filterLooksHonored: boolean | null = null;
  let previousUniqueCount = 0;
  let stagnantPages = 0;

  for (let pageNo = 1; pageNo <= EV_BUSAN_MAX_PAGES; pageNo += 1) {
    const url = buildEvUrl(
      EV_INFO_URL,
      key,
      pageNo,
      EV_BUSAN_PAGE_SIZE,
      { zcode: '26' },
    );

    const payload = await fetchStructured(url);
    ensureNormalResult(payload, `EV 부산 page ${pageNo}`);

    const rawRows = extractItems(payload);
    const busanRows = filterBusanEvRows(rawRows);

    if (pageNo === 1) {
      const ratio = rawRows.length ? busanRows.length / rawRows.length : 1;
      filterLooksHonored = ratio >= 0.8;

      // zcode=26을 보냈는데 첫 페이지가 대부분 타지역이라면,
      // API가 지역 필터를 무시하는 것으로 보고 전국 fallback으로 전환합니다.
      if (!filterLooksHonored) {
        return fetchBusanEvByNationalFallback(key);
      }
    }

    for (const row of busanRows) {
      const keyValue = evKey(row);
      if (keyValue === ':' || seen.has(keyValue)) continue;
      seen.add(keyValue);
      collected.push(row);
    }

    if (collected.length === previousUniqueCount) stagnantPages += 1;
    else stagnantPages = 0;
    previousUniqueCount = collected.length;

    // totalCount는 실제 필터 결과와 맞지 않는 경우가 있어 신뢰하지 않습니다.
    // 실제 반환 row 수와 신규 key 증가 여부로 종료합니다.
    if (rawRows.length < EV_BUSAN_PAGE_SIZE || rawRows.length === 0 || stagnantPages >= 2) {
      break;
    }
  }

  return dedupeEvRows(filterBusanEvRows(collected));
}

async function fetchBusanEvByNationalFallback(serviceKey: string): Promise<AnyObject[]> {
  const firstUrl = buildEvUrl(
    EV_INFO_URL,
    serviceKey,
    1,
    EV_NATIONAL_FALLBACK_PAGE_SIZE,
  );
  const firstPayload = await fetchStructured(firstUrl);
  ensureNormalResult(firstPayload, 'EV 전국 fallback page 1');

  const totalCountRaw = deepFindFirst(firstPayload, 'totalCount');
  const totalCount = Number(totalCountRaw);
  const calculatedPages = Number.isFinite(totalCount) && totalCount > 0
    ? Math.ceil(totalCount / EV_NATIONAL_FALLBACK_PAGE_SIZE)
    : EV_NATIONAL_FALLBACK_MAX_PAGES;

  const pageCount = Math.min(
    Math.max(calculatedPages, 1),
    EV_NATIONAL_FALLBACK_MAX_PAGES,
  );

  const collected: AnyObject[] = [];
  const firstRows = filterBusanEvRows(extractItems(firstPayload));
  collected.push(...firstRows);

  // 너무 큰 XML 여러 개를 한꺼번에 메모리에 올리지 않도록 2페이지씩 처리합니다.
  for (let startPage = 2; startPage <= pageCount; startPage += 2) {
    const pages = [startPage, startPage + 1].filter((page) => page <= pageCount);

    const payloads = await Promise.all(
      pages.map(async (pageNo) => {
        const url = buildEvUrl(
          EV_INFO_URL,
          serviceKey,
          pageNo,
          EV_NATIONAL_FALLBACK_PAGE_SIZE,
        );
        const payload = await fetchStructured(url);
        ensureNormalResult(payload, `EV 전국 fallback page ${pageNo}`);
        return payload;
      }),
    );

    for (const payload of payloads) {
      collected.push(...filterBusanEvRows(extractItems(payload)));
    }
  }

  return dedupeEvRows(collected);
}

async function overlayRecentEvStatus(infoRows: AnyObject[], serviceKey: string) {
  try {
    const statusUrl = buildEvUrl(
      EV_STATUS_URL,
      normalizeServiceKey(serviceKey),
      1,
      9999,
      { zcode: '26', period: '10' },
      'serviceKey',
    );

    const payload = await fetchStructured(statusUrl);
    ensureNormalResult(payload, 'EV 상태');
    const statuses = extractItems(payload);

    const statusMap = new Map<string, AnyObject>();
    for (const row of statuses) {
      statusMap.set(evKey(row), row);
    }

    return infoRows.map((row) => {
      const status = statusMap.get(evKey(row));
      return status
        ? {
            ...row,
            stat: status.stat ?? row.stat,
            statUpdDt: status.statUpdDt ?? row.statUpdDt,
            lastTsdt: status.lastTsdt ?? row.lastTsdt,
            lastTedt: status.lastTedt ?? row.lastTedt,
            nowTsdt: status.nowTsdt ?? row.nowTsdt,
          }
        : row;
    });
  } catch (error) {
    console.warn('Recent EV status overlay failed', safeError(error));
    return infoRows;
  }
}

function filterBusanEvRows(rows: AnyObject[]) {
  return rows.filter((row) => {
    const zcode = pickText(row, ['zcode']);
    const address = pickText(row, ['addr', 'address']);
    return zcode === '26' || address.startsWith('부산');
  });
}

function dedupeEvRows(rows: AnyObject[]) {
  const map = new Map<string, AnyObject>();
  for (const row of rows) {
    const key = evKey(row);
    if (key === ':') continue;
    map.set(key, row);
  }
  return [...map.values()];
}

function evKey(row: AnyObject) {
  return `${pickText(row, ['statId'])}:${pickText(row, ['chgerId'])}`;
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
  url.searchParams.set(keyName, serviceKey);
  url.searchParams.set('pageNo', String(pageNo));
  url.searchParams.set('numOfRows', String(pageSize));
  Object.entries(extras).forEach(([k, v]) => url.searchParams.set(k, v));
  return url;
}

/* -------------------------------------------------------------------------- */
/* EV matching                                                                 */
/* -------------------------------------------------------------------------- */

function normalizeCharger(c: AnyObject): Charger {
  return {
    stationId: pickText(c, ['statId']),
    chargerId: pickText(c, ['chgerId']),
    stationName: pickText(c, ['statNm']) || '전기차 충전소',
    address: pickText(c, ['addr', 'addrDetail']),
    lat: normalizeLat(pickNumber(c, ['lat'])),
    lng: normalizeLng(pickNumber(c, ['lng'])),
    type: pickText(c, ['chgerType']),
    status: pickText(c, ['stat']),
    output: pickNumber(c, ['output']),
    updatedAt: pickText(c, ['statUpdDt']) || null,
    deleted: pickText(c, ['delYn']) === 'Y',
  };
}

function groupChargerStations(chargers: (Charger & { lat: number; lng: number })[]): ChargerStation[] {
  const grouped = new Map<string, (Charger & { lat: number; lng: number })[]>();

  for (const c of chargers) {
    const key = c.stationId || `${normalizePlaceName(c.stationName)}:${c.lat.toFixed(5)}:${c.lng.toFixed(5)}`;
    const list = grouped.get(key) || [];
    list.push(c);
    grouped.set(key, list);
  }

  return [...grouped.entries()].map(([stationId, rows]) => ({
    stationId,
    stationName: rows[0].stationName,
    address: rows[0].address,
    lat: rows.reduce((s, r) => s + r.lat, 0) / rows.length,
    lng: rows.reduce((s, r) => s + r.lng, 0) / rows.length,
    chargers: rows,
  }));
}

function matchPlaceImproved(parking: ParkingBase, stations: ChargerStation[], radius: number) {
  const hasParkingCoords = hasMapCoordinates(parking);
  const candidateRadius = Math.max(radius, 500);

  const candidates = stations
    .map((station) => {
      const distance = hasParkingCoords
        ? haversineMeters(parking.lat, parking.lng, station.lat, station.lng)
        : null;
      const score = stationMatchScore(parking, station, distance, radius);
      return { station, distance, score };
    })
    .filter((candidate) => {
      if (candidate.distance != null) {
        return candidate.distance <= candidateRadius && candidate.score >= 4;
      }
      // 좌표가 없는 주차장은 이름/주소/관리기관 텍스트가 충분히 강할 때만 매칭합니다.
      return candidate.score >= 8;
    })
    .sort((a, b) => b.score - a.score || (a.distance ?? Number.MAX_SAFE_INTEGER) - (b.distance ?? Number.MAX_SAFE_INTEGER));

  const accepted = candidates.filter((candidate, index) => {
    if (index === 0) return true;
    const best = candidates[0];

    if (candidate.distance != null && candidate.distance > 250) return false;

    const stationName = normalizePlaceName(candidate.station.stationName);
    const bestName = normalizePlaceName(best.station.stationName);
    const parkingName = normalizePlaceName(parking.name);

    return (
      stationName.includes(bestName) ||
      bestName.includes(stationName) ||
      tokenOverlapScore(stationName, parkingName) >= 0.34
    );
  });

  if (!accepted.length) return toParkingOnlyPlace(parking);

  const chargerRows = accepted.flatMap((x) => x.station.chargers);
  const available = chargerRows.filter((c) => c.status === '2').length;
  const charging = chargerRows.filter((c) => c.status === '3').length;
  const fast = chargerRows.filter(isFastCharger).length;
  const slow = chargerRows.length - fast;
  const distances = accepted
    .map((x) => x.distance)
    .filter((d): d is number => d != null);
  const nearestDistanceMeters = distances.length ? Math.min(...distances) : null;
  const lastUpdated =
    chargerRows.map((c) => c.updatedAt).filter(Boolean).sort().at(-1) || null;

  return {
    ...parking,
    charger: {
      total: chargerRows.length,
      available,
      charging,
      fast,
      slow,
      stations: accepted.map((x) => x.station.stationName),
      nearestDistanceMeters: nearestDistanceMeters == null ? null : Math.round(nearestDistanceMeters),
      lastUpdated,
      matchConfidence: matchConfidenceLabel(accepted[0].score),
    },
    source: 'live' as const,
  };
}

function stationMatchScore(
  parking: ParkingBase,
  station: ChargerStation,
  distance: number | null,
  radius: number,
) {
  let score = 0;

  if (distance != null) {
    if (distance <= 50) score += 7;
    else if (distance <= 100) score += 5;
    else if (distance <= radius) score += 3;
    else if (distance <= 350) score += 1;
  }

  const pn = normalizePlaceName(parking.name);
  const sn = normalizePlaceName(station.stationName);

  if (pn && sn) {
    if (pn === sn) score += 8;
    else if (pn.includes(sn) || sn.includes(pn)) score += 6;
    else score += tokenOverlapScore(pn, sn) * 6;
  }

  const pa = normalizeAddress(parking.address);
  const sa = normalizeAddress(station.address);
  if (pa && sa && pa !== '주소 정보 없음') {
    score += tokenOverlapScore(pa, sa) * 4;
  }

  const agency = normalizePlaceName(parking.agency || '');
  if (agency && sn) {
    score += tokenOverlapScore(agency, sn) * 2;
  }

  return score;
}

function matchConfidenceLabel(score: number): 'high' | 'medium' | 'low' {
  if (score >= 10) return 'high';
  if (score >= 6) return 'medium';
  return 'low';
}

function isFastCharger(c: Charger) {
  if (typeof c.output === 'number' && c.output > 0) return c.output >= 50;
  return ['01', '03', '04', '05', '06', '07', '09', '10'].includes(c.type);
}

function sortPlaces(a: any, b: any) {
  const aEv = a.charger.available > 0 ? 1 : 0;
  const bEv = b.charger.available > 0 ? 1 : 0;
  if (aEv !== bEv) return bEv - aEv;

  const aParking = a.availableParking ?? -1;
  const bParking = b.availableParking ?? -1;
  if ((aParking > 0 ? 1 : 0) !== (bParking > 0 ? 1 : 0)) {
    return (bParking > 0 ? 1 : 0) - (aParking > 0 ? 1 : 0);
  }

  return b.charger.available - a.charger.available;
}

/* -------------------------------------------------------------------------- */
/* Response helpers                                                            */
/* -------------------------------------------------------------------------- */

function toParkingOnlyPlace(parking: ParkingBase) {
  return {
    ...parking,
    charger: {
      total: 0,
      available: 0,
      charging: 0,
      fast: 0,
      slow: 0,
      stations: [],
      nearestDistanceMeters: null,
      lastUpdated: null,
      matchConfidence: null,
    },
    source: 'live' as const,
  };
}

async function handleParkingDiagnostics(env: Env) {
  const results: AnyObject[] = [];

  try {
    const rows = await fetchBaseParking(env.BUSAN_PARKING_API_KEY!);
    results.push({
      name: 'busan-city-base',
      ok: true,
      count: rows.length,
      sampleKeys: rows[0] ? Object.keys(rows[0]).slice(0, 30) : [],
      sample: rows[0] || null,
    });
  } catch (error) {
    results.push({ name: 'busan-city-base', ok: false, error: safeError(error) });
  }

  if (env.BUSAN_REALTIME_PARKING_API_URL) {
    try {
      const rows = await fetchRealtimeParking(
        env.BUSAN_PARKING_API_KEY!,
        env.BUSAN_REALTIME_PARKING_API_URL,
      );
      results.push({
        name: 'busan-facilities-realtime',
        ok: true,
        count: rows.length,
        sampleKeys: rows[0] ? Object.keys(rows[0]).slice(0, 50) : [],
        sample: rows[0] || null,
      });
    } catch (error) {
      results.push({
        name: 'busan-facilities-realtime',
        ok: false,
        error: safeError(error),
      });
    }
  } else {
    results.push({
      name: 'busan-facilities-realtime',
      ok: false,
      error: 'BUSAN_REALTIME_PARKING_API_URL 미설정',
    });
  }

  return json({ ok: results.every((r) => r.ok), results }, 200);
}

async function handleEvDiagnostics(serviceKey: string) {
  const key = normalizeServiceKey(serviceKey);
  const probes = [
    ['getChargerInfo', buildEvUrl(EV_INFO_URL, key, 1, 10, { zcode: '26' })],
    ['getChargerStatus', buildEvUrl(EV_STATUS_URL, key, 1, 10, { zcode: '26', period: '5' }, 'ServiceKey')],
  ] as const;

  const results: AnyObject[] = [];

  for (const [name, url] of probes) {
    const startedAt = Date.now();
    try {
      const response = await fetch(url.toString(), {
        headers: { Accept: 'application/xml, text/xml, application/json;q=0.9, */*;q=0.1' },
      });
      const raw = await response.text();
      const parsed = parseStructuredPayload(raw, response.headers.get('content-type') || '');

      results.push({
        name,
        httpStatus: response.status,
        elapsedMs: Date.now() - startedAt,
        contentType: response.headers.get('content-type'),
        resultCode: deepFindFirst(parsed, 'resultCode') ?? null,
        resultMsg: deepFindFirst(parsed, 'resultMsg') ?? null,
        totalCount: deepFindFirst(parsed, 'totalCount') ?? null,
        itemCount: extractItems(parsed).length,
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
    ok: results.every((r) => r.httpStatus === 200 && (!r.resultCode || String(r.resultCode) === '00')),
    generatedAt: new Date().toISOString(),
    results,
  }, 200);
}

/* -------------------------------------------------------------------------- */
/* Generic HTTP/XML/JSON                                                       */
/* -------------------------------------------------------------------------- */

async function fetchStructured(url: URL) {
  const response = await fetch(url.toString(), {
    headers: {
      Accept: 'application/json, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.1',
    },
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Upstream HTTP ${response.status}: ${compactText(text).slice(0, 240)}`);
  }

  return parseStructuredPayload(text, response.headers.get('content-type') || '');
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

  if (body.startsWith('<')) return parseXmlPayload(body);

  try {
    return JSON.parse(body);
  } catch {
    throw new Error(`알 수 없는 응답 형식: ${compactText(body).slice(0, 240)}`);
  }
}

function parseXmlPayload(xml: string): AnyObject {
  const itemBlocks = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map((m) => m[1]);

  const items = itemBlocks.map((block) => {
    const item: AnyObject = {};
    for (const match of block.matchAll(/<([A-Za-z0-9_]+)>([\s\S]*?)<\/\1>/g)) {
      item[match[1]] = decodeXml(match[2].trim());
    }
    return item;
  });

  return {
    response: {
      header: {
        resultCode: xmlTag(xml, 'resultCode'),
        resultMsg: xmlTag(xml, 'resultMsg'),
      },
      body: {
        totalCount: xmlTag(xml, 'totalCount'),
        pageNo: xmlTag(xml, 'pageNo'),
        numOfRows: xmlTag(xml, 'numOfRows'),
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
    payload?.data,
    payload?.result,
    payload?.list,
  ];

  for (const value of common) {
    if (Array.isArray(value)) return value;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if (Array.isArray(value.item)) return value.item;
      return [value];
    }
  }

  const arrays = findArrays(payload);
  if (arrays.length) return arrays.sort((a, b) => b.length - a.length)[0];

  const found = deepFindFirst(payload, 'item');
  if (Array.isArray(found)) return found;
  if (found && typeof found === 'object') return [found];

  return [];
}

function findArrays(node: any, depth = 0): AnyObject[][] {
  if (depth > 8 || node == null) return [];
  if (Array.isArray(node)) {
    return node.length && node.every((x) => x && typeof x === 'object')
      ? [node as AnyObject[]]
      : [];
  }
  if (typeof node !== 'object') return [];

  return Object.values(node).flatMap((value) => findArrays(value, depth + 1));
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

/* -------------------------------------------------------------------------- */
/* String/coordinate helpers                                                   */
/* -------------------------------------------------------------------------- */

function normalizePlaceName(value: string) {
  return value
    .toLowerCase()
    .replace(/부산광역시|부산시설공단|공영|주차장|주차|전기차|전기자동차|ev|충전소|충전/g, ' ')
    .replace(/[()\[\]{}·ㆍ.,_\-/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeAddress(value: string) {
  return value
    .toLowerCase()
    .replace(/부산광역시|부산시/g, ' ')
    .replace(/[()\[\]{}·ㆍ.,_\-/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeIdentity(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9가-힣]/g, '');
}

function tokenOverlapScore(a: string, b: string) {
  const at = new Set(a.split(/\s+/).filter((x) => x.length >= 2));
  const bt = new Set(b.split(/\s+/).filter((x) => x.length >= 2));
  if (!at.size || !bt.size) return 0;

  let common = 0;
  for (const token of at) if (bt.has(token)) common += 1;

  return common / Math.max(at.size, bt.size);
}

function pickText(obj: AnyObject, keys: string[]) {
  const keyMap = new Map(
    Object.keys(obj).map((key) => [key.toLowerCase(), key]),
  );

  for (const wanted of keys) {
    const actual = keyMap.get(wanted.toLowerCase());
    if (!actual) continue;
    const value = obj[actual];
    if (value == null) continue;
    const text = String(value).trim();
    if (text && text !== '-' && text.toLowerCase() !== 'null') return text;
  }

  return '';
}

function pickNumber(obj: AnyObject, keys: string[]) {
  const text = pickText(obj, keys);
  if (!text) return null;
  const n = Number(text.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function normalizeLat(value: number | null) {
  if (value == null) return null;
  return value >= 34 && value <= 36 ? value : null;
}

function normalizeLng(value: number | null) {
  if (value == null) return null;
  return value >= 128 && value <= 130 ? value : null;
}

function hasMapCoordinates<T extends { lat: number | null; lng: number | null }>(
  item: T,
): item is T & { lat: number; lng: number } {
  return (
    item.lat != null &&
    item.lng != null &&
    item.lat >= 34 &&
    item.lat <= 36 &&
    item.lng >= 128 &&
    item.lng <= 130
  );
}

function haversineMeters(aLat: number, aLng: number, bLat: number, bLng: number) {
  const R = 6371000;
  const rad = (v: number) => (v * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;

  return 2 * R * Math.asin(Math.sqrt(h));
}

function clamp(v: number, min: number, max: number) {
  if (!Number.isFinite(v)) return min;
  return Math.min(Math.max(v, min), max);
}

function normalizeServiceKey(serviceKey: string) {
  const trimmed = serviceKey.trim();
  try {
    return decodeURIComponent(trimmed);
  } catch {
    return trimmed;
  }
}

function compactText(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function safeError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/* -------------------------------------------------------------------------- */
/* Cloudflare cache helpers                                                    */
/* -------------------------------------------------------------------------- */

function getDefaultCache(): Cache | null {
  if (typeof caches === 'undefined') return null;
  return (caches as unknown as { default: Cache }).default;
}

function evCacheRequest(kind: string) {
  return new Request(`https://plugpark.internal/cache/ev/${kind}`);
}

function cacheJson(data: unknown, ttlSeconds: number) {
  return new Response(JSON.stringify(data), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': `public, max-age=${ttlSeconds}`,
    },
  });
}

function json(data: unknown, status = 200, maxAge = 0) {
  const headers = new Headers({ 'content-type': 'application/json; charset=utf-8' });
  if (maxAge) headers.set('cache-control', `public, max-age=${maxAge}`);
  return new Response(JSON.stringify(data), { status, headers });
}

function configError(name: string) {
  return json({
    ok: false,
    error: `${name}이(가) 설정되지 않았습니다.`,
  }, 503);
}

function upstreamError(error: unknown) {
  console.error(error);
  return json(
    {
      ok: false,
      error: error instanceof Error ? error.message : '외부 API 호출 실패',
    },
    502,
  );
}
