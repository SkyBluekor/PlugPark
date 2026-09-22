interface Env {
  BUSAN_PARKING_API_KEY?: string;
  EV_CHARGER_API_KEY?: string;
  BUSAN_REALTIME_PARKING_API_URL?: string;
  INGEST_ADMIN_TOKEN?: string;
  MATCH_RADIUS_METERS?: string;
  LOCAL_FIXTURE_MODE?: string;
  DB?: D1Database;
  ASSETS: Fetcher;
}

type RawObject = Record<string, unknown>;

type EvInfoSyncStateRow = {
  job_name: string;
  status: string;
  next_page: number | null;
  total_pages: number | null;
  reported_total_count: number | null;
  last_success_at: string | null;
  last_error: string | null;
  run_id: string | null;
};

type D1EvInfoPage = {
  items: EvChargerInfoApiItem[];
  rawCount: number;
  pageNo: number;
  numOfRows: number | null;
  totalCount: number | null;
  duplicateCount: number;
};

type BusanParkingApiItem = {
  mgntNum: string;
  pkNam: string;
  doroAddr: string;
  jibunAddr: string;
  pkCnt: string;
  xCdnt: string;
  yCdnt: string;
  guNm: string;
  pkFm: string;
  pkGubun: string;
  svcSrtTe: string;
  svcEndTe: string;
  pkBascTime: string;
  tenMin: string;
  feeAdd: string;
  feeInfo: string;
  currava: string;
  fnlDt: string;
};

type BusanRealtimeParkingApiItem = {
  parkgcd: string;
  parknm: string;
  curravacnt: string;
  parkingcnt: string;
  maxcnt: string;
  lastupdatetime: string;
};

type EvChargerInfoApiItem = {
  statNm: string;
  statId: string;
  chgerId: string;
  chgerType: string;
  addr: string;
  addrDetail: string;
  location: string;
  lat: string;
  lng: string;
  useTime: string;
  busiId: string;
  bnm: string;
  busiNm: string;
  busiCall: string;
  stat: string;
  statUpdDt: string;
  lastTsdt: string;
  lastTedt: string;
  nowTsdt: string;
  output: string;
  method: string;
  zcode: string;
  zscode: string;
  kind: string;
  kindDetail: string;
  parkingFree: string;
  note: string;
  limitYn: string;
  limitDetail: string;
  delYn: string;
  delDetail: string;
  trafficYn: string;
  year: string;
  floorNum: string;
  floorType: string;
  maker: string;
};

type EvChargerStatusApiItem = {
  busiId: string;
  statId: string;
  chgerId: string;
  stat: string;
  statUpdDt: string;
  lastTsdt: string;
  lastTedt: string;
  nowTsdt: string;
};

type ParkingMatchType = 'exact-name' | 'contained-name' | 'similar-name' | 'unmatched' | 'ambiguous';

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
  realtimeMatch: {
    matched: boolean;
    type: ParkingMatchType;
    realtimeName: string | null;
  };
};

type RealtimeJoinDetail = {
  realtimeCode: string;
  realtimeName: string;
  normalizedRealtimeName: string;
  baseId: string | null;
  baseName: string | null;
  type: ParkingMatchType;
  score: number | null;
};

type ParkingJoinResult = {
  items: ParkingBase[];
  details: RealtimeJoinDetail[];
  summary: {
    realtimeCount: number;
    matched: number;
    exact: number;
    contained: number;
    similar: number;
    ambiguous: number;
    unmatched: number;
  };
};

type SchemaCheck = {
  valid: boolean;
  missing: string[];
  receivedKeys: string[];
};

const PARKING_BASE_URL =
  'https://apis.data.go.kr/6260000/BusanPblcPrkngInfoService/getPblcPrkngInfo';
const EV_INFO_URL = 'https://apis.data.go.kr/B552584/EvCharger/getChargerInfo';
const EV_STATUS_URL = 'https://apis.data.go.kr/B552584/EvCharger/getChargerStatus';

const CACHE_VERSION = 'v6.2.1';
const DATA_LAYER_VERSION = 'v0.6.2.1';
const D1_EV_INFO_JOB = 'ev_info';
const D1_INGEST_MAX_PAGES_PER_REQUEST = 1;
const PARKING_BASE_PAGE_SIZE = 100;
const PARKING_BASE_MAX_PAGES = 20;
const PARKING_BASE_CACHE_SECONDS = 24 * 60 * 60;
const EV_INFO_PAGE_SIZE = 200;
const EV_STATUS_PAGE_SIZE = 500;
const PLACES_CACHE_SECONDS = 5;

const BASE_REQUIRED_FIELDS = ['pkNam'] as const;
const REALTIME_REQUIRED_FIELDS = [
  'parkgcd',
  'parknm',
  'curravacnt',
  'parkingcnt',
  'maxcnt',
  'lastupdatetime',
] as const;
const EV_INFO_REQUIRED_FIELDS = [
  'statNm',
  'statId',
  'chgerId',
  'chgerType',
  'addr',
  'lat',
  'lng',
  'stat',
  'statUpdDt',
  'zcode',
  'delYn',
] as const;
const EV_STATUS_REQUIRED_FIELDS = ['statId', 'chgerId', 'stat', 'statUpdDt'] as const;

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api/health') {
      return json({
        ok: true,
        dataLayerVersion: DATA_LAYER_VERSION,
        parkingSecretConfigured: Boolean(env.BUSAN_PARKING_API_KEY),
        evSecretConfigured: Boolean(env.EV_CHARGER_API_KEY),
        realtimeParkingUrlConfigured: Boolean(env.BUSAN_REALTIME_PARKING_API_URL),
        d1Configured: Boolean(env.DB),
        ingestAdminTokenConfigured: Boolean(env.INGEST_ADMIN_TOKEN),
      });
    }


    if (url.pathname === '/api/d1/health') {
      if (!env.DB) {
        return json({
          ok: false,
          dataLayerVersion: DATA_LAYER_VERSION,
          d1Configured: false,
          error: 'D1 binding DB가 아직 설정되지 않았습니다.',
        }, 503);
      }

      try {
        const row = await env.DB.prepare('SELECT 1 AS ok').first<{ ok: number }>();
        return json({
          ok: row?.ok === 1,
          dataLayerVersion: DATA_LAYER_VERSION,
          d1Configured: true,
        });
      } catch (error) {
        return json({
          ok: false,
          dataLayerVersion: DATA_LAYER_VERSION,
          d1Configured: true,
          error: safeError(error),
        }, 500);
      }
    }

    if (url.pathname === '/api/d1/ev-info-state') {
      if (!env.DB) return d1ConfigError();
      try {
        return json(await getD1EvInfoState(env.DB));
      } catch (error) {
        return json({ ok: false, error: safeError(error) }, 500);
      }
    }

    if (url.pathname === '/api/d1/ev-info-search') {
      if (!env.DB) return d1ConfigError();
      const q = (url.searchParams.get('q') || '').trim();
      if (!q) return json({ ok: false, error: 'q 검색어가 필요합니다.' }, 400);
      try {
        const rows = await env.DB.prepare(
          `SELECT stat_id, chger_id, station_name, address, lat, lng, zcode, zscode, del_yn, synced_at
             FROM ev_chargers
            WHERE station_name LIKE ?1 OR address LIKE ?1
            ORDER BY station_name, stat_id, chger_id
            LIMIT 100`,
        ).bind(`%${q}%`).all();
        return json({ ok: true, query: q, count: rows.results.length, items: rows.results });
      } catch (error) {
        return json({ ok: false, error: safeError(error) }, 500);
      }
    }

    if (url.pathname === '/api/admin/d1/ev-info-ingest') {
      if (request.method !== 'POST') {
        return json({ ok: false, error: 'POST 요청만 허용됩니다.' }, 405);
      }
      if (!env.DB) return d1ConfigError();
      if (!env.EV_CHARGER_API_KEY) return configError('EV_CHARGER_API_KEY');
      const authError = validateIngestAdmin(request, env);
      if (authError) return authError;

      const requestedPages = clamp(
        Math.trunc(Number(url.searchParams.get('pages') || '1')),
        1,
        D1_INGEST_MAX_PAGES_PER_REQUEST,
      );

      try {
        const result = await ingestEvInfoPagesToD1(
          env.DB,
          env.EV_CHARGER_API_KEY,
          requestedPages,
        );
        return json(result, 200);
      } catch (error) {
        return json({
          ok: false,
          error: safeError(error),
          state: await getD1EvInfoStateSafe(env.DB),
        }, 502);
      }
    }

    if (url.pathname === '/api/admin/d1/ev-info-bulk-upsert') {
      if (request.method !== 'POST') {
        return json({ ok: false, error: 'POST 요청만 허용됩니다.' }, 405);
      }
      if (!env.DB) return d1ConfigError();
      const authError = validateIngestAdmin(request, env);
      if (authError) return authError;

      try {
        const body = await request.json() as {
          items?: RawObject[];
          checkpoint?: {
            nextPage?: number;
            totalPages?: number | null;
            reportedTotalCount?: number | null;
            complete?: boolean;
            runId?: string;
            pageNo?: number;
          };
        };

        const rawItems = Array.isArray(body.items) ? body.items : [];
        if (rawItems.length > 100) {
          return json({ ok: false, error: '한 요청에는 EV item을 최대 100건까지 업로드할 수 있습니다.' }, 413);
        }

        let storedCount = 0;
        if (rawItems.length > 0) {
          const parsed = parseEvInfoItems(rawItems);
          if (parsed.invalid.length > 0) {
            return json({
              ok: false,
              error: 'EV_SCHEMA_MISMATCH',
              invalid: parsed.invalid.slice(0, 3).map((item) => ({
                index: item.index,
                missing: item.schema.missing,
              })),
            }, 400);
          }

          const wrongRegion = parsed.valid.filter((item) => item.zcode !== '26');
          if (wrongRegion.length > 0) {
            return json({
              ok: false,
              error: 'EV_REGION_MISMATCH',
              count: wrongRegion.length,
            }, 400);
          }

          const unique = new Map<string, EvChargerInfoApiItem>();
          for (const item of parsed.valid) {
            if (!item.statId.trim() || !item.chgerId.trim() || !item.statNm.trim()) {
              return json({ ok: false, error: 'EV_IDENTITY_INVALID' }, 400);
            }
            unique.set(evCompositeKey(item.statId, item.chgerId), item);
          }

          const items = [...unique.values()];
          await upsertEvInfoPage(env.DB, items);
          storedCount = items.length;
        }

        let checkpointSaved = false;
        if (body.checkpoint) {
          const nextPage = Math.trunc(Number(body.checkpoint.nextPage));
          const totalPagesRaw = body.checkpoint.totalPages;
          const totalCountRaw = body.checkpoint.reportedTotalCount;
          const totalPages = totalPagesRaw == null ? null : Math.trunc(Number(totalPagesRaw));
          const reportedTotalCount = totalCountRaw == null ? null : Math.trunc(Number(totalCountRaw));
          const runId = String(body.checkpoint.runId || crypto.randomUUID());

          if (!Number.isFinite(nextPage) || nextPage < 1) {
            return json({ ok: false, error: 'checkpoint.nextPage가 올바르지 않습니다.' }, 400);
          }
          if (totalPages != null && (!Number.isFinite(totalPages) || totalPages < 1)) {
            return json({ ok: false, error: 'checkpoint.totalPages가 올바르지 않습니다.' }, 400);
          }
          if (reportedTotalCount != null && (!Number.isFinite(reportedTotalCount) || reportedTotalCount < 0)) {
            return json({ ok: false, error: 'checkpoint.reportedTotalCount가 올바르지 않습니다.' }, 400);
          }

          await upsertSyncState(env.DB, {
            status: body.checkpoint.complete ? 'complete' : 'running',
            nextPage,
            totalPages,
            reportedTotalCount,
            lastSuccessAt: new Date().toISOString(),
            lastError: null,
            runId,
          });
          await incrementApiUsage(env.DB, 'ev_info_local_backfill');
          checkpointSaved = true;
        }

        return json({
          ok: true,
          storedCount,
          checkpointSaved,
          dataLayerVersion: DATA_LAYER_VERSION,
        });
      } catch (error) {
        return json({ ok: false, error: safeError(error) }, 500);
      }
    }


    if (url.pathname === '/api/admin/d1/prepare-read-models') {
      if (request.method !== 'POST') {
        return json({ ok: false, error: 'POST 요청만 허용됩니다.' }, 405);
      }
      if (!env.DB) return d1ConfigError();
      const authError = validateIngestAdmin(request, env);
      if (authError) return authError;

      const stage = (url.searchParams.get('stage') || 'all').trim().toLowerCase();
      if (!['all', 'stations', 'parking', 'matches'].includes(stage)) {
        return json({ ok: false, error: 'stage는 all/stations/parking/matches 중 하나여야 합니다.' }, 400);
      }

      try {
        const result = await prepareD1ReadModels(env, stage as ReadModelPrepareStage);
        return json(result, 200);
      } catch (error) {
        return json({ ok: false, stage, error: safeError(error) }, 500);
      }
    }

    if (url.pathname === '/api/d1/read-model-state') {
      if (!env.DB) return d1ConfigError();
      try {
        await ensureReadModelSchema(env.DB);
        return json(await getReadModelState(env.DB), 200, 5);
      } catch (error) {
        return json({ ok: false, error: safeError(error) }, 500);
      }
    }

    if (url.pathname === '/api/d1/match-debug') {
      if (!env.DB) return d1ConfigError();
      const q = (url.searchParams.get('q') || '').trim();
      if (!q) return json({ ok: false, error: 'q 검색어가 필요합니다.' }, 400);
      try {
        await ensureReadModelSchema(env.DB);
        const like = `%${q}%`;
        const normalizedLike = `%${normalizeParkingName(q)}%`;
        const rows = await env.DB.prepare(
          `SELECT p.parking_id, p.name AS parking_name, p.address AS parking_address,
                  p.lat AS parking_lat, p.lng AS parking_lng,
                  m.stat_id, m.match_type, m.match_score, m.distance_m,
                  s.station_name, s.address AS station_address,
                  s.lat AS station_lat, s.lng AS station_lng,
                  s.charger_count, s.available_count, s.charging_count
             FROM parking_read_model p
             LEFT JOIN parking_ev_matches m ON m.parking_id = p.parking_id
             LEFT JOIN ev_stations s ON s.stat_id = m.stat_id
            WHERE p.name LIKE ?1
               OR p.address LIKE ?1
               OR p.normalized_name LIKE ?2
               OR s.station_name LIKE ?1
               OR s.address LIKE ?1
            ORDER BY p.name, m.match_score DESC, m.distance_m ASC
            LIMIT 100`,
        ).bind(like, normalizedLike).all();
        return json({ ok: true, query: q, count: rows.results.length, items: rows.results });
      } catch (error) {
        return json({ ok: false, error: safeError(error) }, 500);
      }
    }

    if (url.pathname === '/api/parking' || url.pathname === '/api/parking-places') {
      if (!env.BUSAN_PARKING_API_KEY) return configError('BUSAN_PARKING_API_KEY');
      try {
        const parking = await fetchMergedParking(env);
        return json({
          ok: true,
          places: parking.items.map(toParkingOnlyPlace),
          realtimeParking: parking.realtimeCount > 0,
          realtimeParkingConfigured: parking.realtimeConfigured,
          realtimeParkingCount: parking.realtimeCount,
          realtimeMessage: parking.userMessage,
          parkingMatchSummary: parking.joinSummary,
        }, 200, 60);
      } catch (error) {
        return upstreamError(error);
      }
    }

    if (url.pathname === '/api/places') {
      return handlePlaces(env, ctx);
    }

    if (url.pathname === '/api/chargers') {
      if (!env.DB) return d1ConfigError();
      try {
        const rows = await env.DB.prepare(
          `SELECT stat_id, chger_id, station_name, charger_type, address, address_detail,
                  lat, lng, COALESCE(s.status, c.info_status) AS status,
                  COALESCE(s.status_updated_at, c.info_status_updated_at) AS status_updated_at,
                  output_kw, del_yn
             FROM ev_chargers c
             LEFT JOIN ev_status s USING(stat_id, chger_id)
            WHERE COALESCE(c.del_yn, '') <> 'Y'
            ORDER BY station_name, stat_id, chger_id
            LIMIT 1000`,
        ).all();
        return json({ ok: true, complete: true, source: 'd1', count: rows.results.length, items: rows.results }, 200, 60);
      } catch (error) {
        return json({ ok: false, error: safeError(error) }, 500);
      }
    }

    if (url.pathname === '/api/ev-summary' || url.pathname === '/api/ev-progress') {
      if (!env.DB) return d1ConfigError();
      try {
        await ensureReadModelSchema(env.DB);
        const state = await getReadModelState(env.DB);
        return json({
          ok: true,
          complete: state.ready,
          source: 'd1-read-model',
          chargerCount: state.chargerCount,
          stationCount: state.stationCount,
          matchedParkingCount: state.matchedParkingCount,
          readModelReady: state.ready,
        }, 200, 30);
      } catch (error) {
        return json({ ok: false, error: safeError(error) }, 500);
      }
    }

    if (url.pathname === '/api/ev-search') {
      if (!env.DB) return d1ConfigError();
      const q = (url.searchParams.get('q') || '').trim();
      if (!q) return json({ ok: false, error: 'q 검색어가 필요합니다.' }, 400);
      try {
        const rows = await env.DB.prepare(
          `SELECT stat_id, chger_id, station_name, address, address_detail, lat, lng,
                  charger_type, output_kw, info_status, info_status_updated_at, del_yn
             FROM ev_chargers
            WHERE COALESCE(del_yn, '') <> 'Y'
              AND (station_name LIKE ?1 OR address LIKE ?1 OR address_detail LIKE ?1 OR stat_id LIKE ?1)
            ORDER BY station_name, stat_id, chger_id
            LIMIT 100`,
        ).bind(`%${q}%`).all();
        return json({ ok: true, query: q, complete: true, source: 'd1', count: rows.results.length, items: rows.results }, 200, 30);
      } catch (error) {
        return json({ ok: false, error: safeError(error) }, 500);
      }
    }

    if (url.pathname === '/api/ev-refresh') {
      return json({
        ok: false,
        deprecated: true,
        message: 'v0.6.0부터 사용자 요청 기반 EV Info 수집은 사용하지 않습니다. D1 read model을 사용합니다.',
      }, 410);
    }

    if (url.pathname === '/api/diagnostics/parking' || url.pathname === '/api/parking-diagnostics') {
      if (!env.BUSAN_PARKING_API_KEY) return configError('BUSAN_PARKING_API_KEY');
      return diagnosticsParkingBase(env.BUSAN_PARKING_API_KEY);
    }

    if (url.pathname === '/api/diagnostics/parking-realtime') {
      if (!env.BUSAN_PARKING_API_KEY) return configError('BUSAN_PARKING_API_KEY');
      return diagnosticsParkingRealtime(env);
    }

    if (url.pathname === '/api/diagnostics/matching') {
      if (!env.BUSAN_PARKING_API_KEY) return configError('BUSAN_PARKING_API_KEY');
      return diagnosticsParkingMatching(env);
    }

    if (url.pathname === '/api/diagnostics/ev-info' || url.pathname === '/api/ev-diagnostics') {
      if (!env.EV_CHARGER_API_KEY) return configError('EV_CHARGER_API_KEY');
      return diagnosticsEvInfo(env.EV_CHARGER_API_KEY);
    }

    if (url.pathname === '/api/diagnostics/ev-status') {
      if (!env.EV_CHARGER_API_KEY) return configError('EV_CHARGER_API_KEY');
      return diagnosticsEvStatus(env.EV_CHARGER_API_KEY);
    }

    return env.ASSETS.fetch(request);
  },
};

async function handlePlaces(env: Env, _ctx: ExecutionContext) {
  if (!env.DB) return d1ConfigError();

  const cache = getDefaultCache();
  const cacheRequest = new Request(`https://plugpark.internal/${CACHE_VERSION}/places-d1`);
  if (cache) {
    const cached = await cache.match(cacheRequest);
    if (cached) return cached;
  }

  try {
    const state = await getReadModelState(env.DB);
    if (!state.ready) {
      return json({
        ok: false,
        dataLayerVersion: DATA_LAYER_VERSION,
        error: 'D1 read model 준비가 필요합니다. 배포 후 npm run data:prepare 를 한 번 실행해주세요.',
        readModelState: state,
      }, 503);
    }

    const rows = await env.DB.prepare(
      `SELECT
         p.parking_id, p.name, p.address, p.agency, p.lat, p.lng, p.capacity,
         p.available_parking, p.occupied_parking, p.fee_text, p.operation_text,
         p.parking_updated_at, p.parking_realtime, p.parking_source,
         p.realtime_match_type, p.realtime_name,
         COALESCE(SUM(s.charger_count), 0) AS charger_total,
         COALESCE(SUM(s.available_count), 0) AS charger_available,
         COALESCE(SUM(s.charging_count), 0) AS charger_charging,
         COALESCE(SUM(s.fast_count), 0) AS charger_fast,
         COALESCE(SUM(s.slow_count), 0) AS charger_slow,
         GROUP_CONCAT(DISTINCT s.station_name) AS station_names,
         MIN(m.distance_m) AS nearest_distance_m,
         MAX(s.last_updated_at) AS charger_last_updated,
         MAX(m.match_score) AS best_match_score
       FROM parking_read_model p
       LEFT JOIN parking_ev_matches m ON m.parking_id = p.parking_id
       LEFT JOIN ev_stations s ON s.stat_id = m.stat_id
       GROUP BY p.parking_id
       ORDER BY charger_available DESC, available_parking DESC, p.name ASC`,
    ).all<ParkingReadRow>();

    const places = rows.results.map(readRowToPlace);
    const payload = {
      ok: true,
      generatedAt: new Date().toISOString(),
      dataLayerVersion: DATA_LAYER_VERSION,
      dataSource: 'd1-read-model',
      upstreamEvCalls: 0,
      matchRadiusMeters: state.matchRadiusMeters,
      parkingCount: state.parkingCount,
      realtimeParkingCount: state.realtimeParkingCount,
      chargerCount: state.chargerCount,
      chargerStationCount: state.stationCount,
      matchedCount: state.matchedParkingCount,
      evSnapshotComplete: true,
      evSnapshotSource: 'd1-read-model',
      evProgress: null,
      readModelReady: true,
      realtimeParking: state.realtimeParkingCount > 0,
      realtimeParkingConfigured: Boolean(env.BUSAN_REALTIME_PARKING_API_URL),
      realtimeMessage: env.BUSAN_REALTIME_PARKING_API_URL ? '' : '실시간 주차정보 연동 전입니다.',
      places,
    };

    const response = json(payload, 200, PLACES_CACHE_SECONDS);
    if (cache) await cache.put(cacheRequest, response.clone());
    return response;
  } catch (error) {
    return json({ ok: false, dataLayerVersion: DATA_LAYER_VERSION, error: safeError(error) }, 500);
  }
}

/* -------------------------------------------------------------------------- */
/* v0.6.0 D1 read model                                                        */
/* -------------------------------------------------------------------------- */

type ReadModelPrepareStage = 'all' | 'stations' | 'parking' | 'matches';

type ParkingReadRow = {
  parking_id: string;
  name: string;
  address: string | null;
  agency: string | null;
  lat: number | null;
  lng: number | null;
  capacity: number | null;
  available_parking: number | null;
  occupied_parking: number | null;
  fee_text: string | null;
  operation_text: string | null;
  parking_updated_at: string | null;
  parking_realtime: number;
  parking_source: string | null;
  realtime_match_type: ParkingMatchType | null;
  realtime_name: string | null;
  charger_total: number;
  charger_available: number;
  charger_charging: number;
  charger_fast: number;
  charger_slow: number;
  station_names: string | null;
  nearest_distance_m: number | null;
  charger_last_updated: string | null;
  best_match_score: number | null;
};

type MatchCandidateRow = {
  parking_id: string;
  parking_name: string;
  parking_normalized_name: string;
  parking_address: string;
  parking_lat: number | null;
  parking_lng: number | null;
  stat_id: string;
  station_name: string;
  station_normalized_name: string;
  station_address: string;
  station_lat: number | null;
  station_lng: number | null;
};

async function ensureReadModelSchema(db: D1Database) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS ev_stations (
      stat_id TEXT PRIMARY KEY,
      station_name TEXT NOT NULL,
      normalized_station_name TEXT NOT NULL,
      address TEXT,
      lat REAL,
      lng REAL,
      charger_count INTEGER NOT NULL,
      available_count INTEGER NOT NULL,
      charging_count INTEGER NOT NULL,
      fast_count INTEGER NOT NULL,
      slow_count INTEGER NOT NULL,
      last_updated_at TEXT,
      synced_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_ev_stations_normalized_name ON ev_stations(normalized_station_name)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_ev_stations_coords ON ev_stations(lat, lng)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS parking_read_model (
      parking_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      normalized_name TEXT NOT NULL,
      address TEXT,
      agency TEXT,
      lat REAL,
      lng REAL,
      capacity INTEGER,
      available_parking INTEGER,
      occupied_parking INTEGER,
      fee_text TEXT,
      operation_text TEXT,
      parking_updated_at TEXT,
      parking_realtime INTEGER NOT NULL DEFAULT 0,
      parking_source TEXT,
      realtime_match_type TEXT,
      realtime_name TEXT,
      synced_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_parking_read_model_name ON parking_read_model(normalized_name)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_parking_read_model_coords ON parking_read_model(lat, lng)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS parking_ev_matches (
      parking_id TEXT NOT NULL,
      stat_id TEXT NOT NULL,
      match_type TEXT NOT NULL,
      match_score REAL,
      distance_m REAL,
      reviewed INTEGER NOT NULL DEFAULT 0,
      matched_at TEXT NOT NULL,
      PRIMARY KEY (parking_id, stat_id)
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_parking_ev_matches_stat_id ON parking_ev_matches(stat_id)`),
  ]);
}

async function prepareD1ReadModels(env: Env, stage: ReadModelPrepareStage) {
  if (!env.DB) throw new Error('D1 binding DB가 없습니다.');
  await ensureReadModelSchema(env.DB);
  const runId = `read-model-${crypto.randomUUID()}`;
  const radius = clamp(Number(env.MATCH_RADIUS_METERS || '200'), 50, 500);
  const completed: string[] = [];
  const metrics: Record<string, unknown> = {};

  if (stage === 'all' || stage === 'stations') {
    const evInfoState = await env.DB.prepare(
      `SELECT status, reported_total_count FROM sync_state WHERE job_name = ?1`,
    ).bind(D1_EV_INFO_JOB).first<{ status: string; reported_total_count: number | null }>();
    if (evInfoState?.status !== 'complete') {
      throw new Error('EV Info backfill이 complete 상태가 아닙니다. 먼저 EV Info 적재를 완료해주세요.');
    }
    await rebuildEvStations(env.DB);
    await markReadModelJob(env.DB, 'read_model_ev_stations', runId);
    completed.push('stations');
  }

  if (stage === 'all' || stage === 'parking') {
    const parking = isLocalFixtureMode(env)
      ? await loadLocalParkingFixtureFromD1(env.DB)
      : await (async () => {
          if (!env.BUSAN_PARKING_API_KEY) {
            throw new Error('BUSAN_PARKING_API_KEY가 설정되지 않았습니다.');
          }
          return fetchMergedParking(env);
        })();
    const parkingMetrics = await replaceParkingReadModel(env.DB, parking.items);
    metrics.parking = parkingMetrics;
    await markReadModelJob(env.DB, 'read_model_parking', runId);
    completed.push('parking');
  }

  if (stage === 'all' || stage === 'matches') {
    const matchCount = await rebuildParkingEvMatches(env.DB, radius);
    await markReadModelJob(env.DB, 'read_model_matches', runId, matchCount);
    completed.push('matches');
  }

  const state = await getReadModelState(env.DB);
  return { ok: true, dataLayerVersion: DATA_LAYER_VERSION, stage, completed, metrics, state };
}

function isLocalFixtureMode(env: Env) {
  return String(env.LOCAL_FIXTURE_MODE || '').toLowerCase() === 'true';
}

async function loadLocalParkingFixtureFromD1(db: D1Database): Promise<ParkingJoinResult> {
  const rows = await db.prepare(
    `SELECT
       p.parking_id, p.name,
       COALESCE(NULLIF(p.road_address, ''), NULLIF(p.jibun_address, ''), '주소 정보 없음') AS address,
       COALESCE(p.district, '') AS agency,
       p.lat, p.lng, p.capacity, p.fee_text, p.operation_text,
       r.parking_name AS realtime_name,
       r.available_count, r.occupied_count, r.max_count, r.source_updated_at
     FROM parking_lots p
     LEFT JOIN parking_realtime r
       ON r.normalized_name = p.normalized_name
     ORDER BY p.parking_id`,
  ).all<{
    parking_id: string;
    name: string;
    address: string;
    agency: string;
    lat: number | null;
    lng: number | null;
    capacity: number | null;
    fee_text: string | null;
    operation_text: string | null;
    realtime_name: string | null;
    available_count: number | null;
    occupied_count: number | null;
    max_count: number | null;
    source_updated_at: string | null;
  }>();

  const items: ParkingBase[] = rows.results.map((row) => {
    const hasRealtime = Boolean(row.realtime_name);
    return {
      id: row.parking_id,
      name: row.name,
      address: row.address,
      agency: row.agency,
      lat: row.lat == null ? null : Number(row.lat),
      lng: row.lng == null ? null : Number(row.lng),
      capacity: row.max_count == null
        ? (row.capacity == null ? null : Number(row.capacity))
        : Number(row.max_count),
      availableParking: row.available_count == null ? null : Number(row.available_count),
      occupiedParking: row.occupied_count == null ? null : Number(row.occupied_count),
      feeText: row.fee_text || '요금 정보 확인 필요',
      operationText: row.operation_text || '운영시간 확인 필요',
      parkingUpdatedAt: row.source_updated_at || null,
      parkingRealtime: hasRealtime,
      parkingSource: hasRealtime ? 'merged' : 'busan-city',
      realtimeMatch: {
        matched: hasRealtime,
        type: hasRealtime ? 'exact-name' : 'unmatched',
        realtimeName: row.realtime_name || null,
      },
    };
  });

  const realtimeCount = items.filter((item) => item.parkingRealtime).length;
  return {
    items,
    details: [],
    summary: {
      realtimeCount,
      matched: realtimeCount,
      exact: realtimeCount,
      contained: 0,
      similar: 0,
      ambiguous: 0,
      unmatched: items.length - realtimeCount,
    },
  };
}

async function rebuildEvStations(db: D1Database) {
  const now = new Date().toISOString();
  const insert = db.prepare(
    `INSERT INTO ev_stations (
       stat_id, station_name, normalized_station_name, address, lat, lng,
       charger_count, available_count, charging_count, fast_count, slow_count,
       last_updated_at, synced_at
     )
     SELECT
       c.stat_id,
       MAX(c.station_name),
       MAX(c.normalized_station_name),
       MAX(COALESCE(c.address, '')),
       AVG(c.lat),
       AVG(c.lng),
       COUNT(*),
       SUM(CASE WHEN COALESCE(s.status, c.info_status) = '2' THEN 1 ELSE 0 END),
       SUM(CASE WHEN COALESCE(s.status, c.info_status) = '3' THEN 1 ELSE 0 END),
       SUM(CASE
             WHEN c.output_kw >= 50 THEN 1
             WHEN c.output_kw IS NULL AND c.charger_type IN ('01','03','04','05','06','07','09','10') THEN 1
             ELSE 0
           END),
       SUM(CASE
             WHEN c.output_kw >= 50 THEN 0
             WHEN c.output_kw IS NULL AND c.charger_type IN ('01','03','04','05','06','07','09','10') THEN 0
             ELSE 1
           END),
       MAX(COALESCE(s.status_updated_at, c.info_status_updated_at)),
       ?1
     FROM ev_chargers c
     LEFT JOIN ev_status s USING(stat_id, chger_id)
     WHERE COALESCE(c.del_yn, '') <> 'Y'
     GROUP BY c.stat_id`,
  ).bind(now);

  // DELETE + INSERT를 하나의 D1 batch로 묶어 quota/network 실패 시 기존 read model을 보존합니다.
  await db.batch([
    db.prepare('DELETE FROM ev_stations'),
    insert,
  ]);
}

async function replaceParkingReadModel(db: D1Database, items: ParkingBase[]) {
  const syncedAt = new Date().toISOString();
  const deduped = dedupeParkingById(items);
  const rows = deduped.items.map((item) => ({
    parking_id: item.id,
    name: item.name,
    normalized_name: normalizeParkingName(item.name),
    address: item.address,
    agency: item.agency,
    lat: item.lat,
    lng: item.lng,
    capacity: item.capacity,
    available_parking: item.availableParking,
    occupied_parking: item.occupiedParking,
    fee_text: item.feeText,
    operation_text: item.operationText,
    parking_updated_at: item.parkingUpdatedAt,
    parking_realtime: item.parkingRealtime ? 1 : 0,
    parking_source: item.parkingSource,
    realtime_match_type: item.realtimeMatch.type,
    realtime_name: item.realtimeMatch.realtimeName,
    synced_at: syncedAt,
  }));

  const sql = `INSERT INTO parking_read_model (
      parking_id, name, normalized_name, address, agency, lat, lng, capacity,
      available_parking, occupied_parking, fee_text, operation_text,
      parking_updated_at, parking_realtime, parking_source,
      realtime_match_type, realtime_name, synced_at
    )
    SELECT
      json_extract(j.value, '$.parking_id'),
      json_extract(j.value, '$.name'),
      json_extract(j.value, '$.normalized_name'),
      json_extract(j.value, '$.address'),
      json_extract(j.value, '$.agency'),
      json_extract(j.value, '$.lat'),
      json_extract(j.value, '$.lng'),
      json_extract(j.value, '$.capacity'),
      json_extract(j.value, '$.available_parking'),
      json_extract(j.value, '$.occupied_parking'),
      json_extract(j.value, '$.fee_text'),
      json_extract(j.value, '$.operation_text'),
      json_extract(j.value, '$.parking_updated_at'),
      json_extract(j.value, '$.parking_realtime'),
      json_extract(j.value, '$.parking_source'),
      json_extract(j.value, '$.realtime_match_type'),
      json_extract(j.value, '$.realtime_name'),
      json_extract(j.value, '$.synced_at')
    FROM json_each(?1) AS j`;

  const statements: D1PreparedStatement[] = [
    db.prepare('DELETE FROM parking_read_model'),
  ];
  for (let offset = 0; offset < rows.length; offset += 100) {
    statements.push(db.prepare(sql).bind(JSON.stringify(rows.slice(offset, offset + 100))));
  }
  await db.batch(statements);
  return {
    inputCount: deduped.inputCount,
    uniqueCount: deduped.uniqueCount,
    duplicateCount: deduped.duplicateCount,
  };
}

async function rebuildParkingEvMatches(db: D1Database, radius: number) {
  const latDelta = radius / 111_000;
  const lngDelta = radius / 88_000;
  const candidateRows = await db.prepare(
    `SELECT
       p.parking_id,
       p.name AS parking_name,
       p.normalized_name AS parking_normalized_name,
       COALESCE(p.address, '') AS parking_address,
       p.lat AS parking_lat,
       p.lng AS parking_lng,
       s.stat_id,
       s.station_name,
       s.normalized_station_name AS station_normalized_name,
       COALESCE(s.address, '') AS station_address,
       s.lat AS station_lat,
       s.lng AS station_lng
     FROM parking_read_model p
     JOIN ev_stations s
       ON (
         (LENGTH(p.normalized_name) >= 4 AND LENGTH(s.normalized_station_name) >= 4 AND
           (INSTR(p.normalized_name, s.normalized_station_name) > 0 OR
            INSTR(s.normalized_station_name, p.normalized_name) > 0))
         OR
         (p.lat IS NOT NULL AND p.lng IS NOT NULL AND s.lat IS NOT NULL AND s.lng IS NOT NULL
           AND s.lat BETWEEN p.lat - ?1 AND p.lat + ?1
           AND s.lng BETWEEN p.lng - ?2 AND p.lng + ?2)
       )`,
  ).bind(latDelta, lngDelta).all<MatchCandidateRow>();

  const matches = new Map<string, {
    parking_id: string;
    stat_id: string;
    match_type: string;
    match_score: number;
    distance_m: number | null;
    reviewed: number;
    matched_at: string;
  }>();
  const matchedAt = new Date().toISOString();

  for (const row of candidateRows.results) {
    const pName = row.parking_normalized_name || '';
    const sName = row.station_normalized_name || '';
    const exactName = Boolean(pName && sName && pName === sName);
    const containedName = Boolean(
      pName && sName && Math.min(pName.length, sName.length) >= 4 &&
      (pName.includes(sName) || sName.includes(pName)),
    );
    const hasBothCoordinates =
      row.parking_lat != null && row.parking_lng != null &&
      row.station_lat != null && row.station_lng != null;
    const distance = hasBothCoordinates
      ? haversineMeters(row.parking_lat!, row.parking_lng!, row.station_lat!, row.station_lng!)
      : null;

    let matchType: string | null = null;
    let score = 0;
    if (exactName) {
      matchType = 'normalized_name';
      score = distance != null && distance <= radius ? 100 : 96;
    } else if (containedName) {
      // Important: no Dice threshold here. This intentionally fixes cases such as
      // "해운대센텀시티 공영주차장" ↔ "센텀시티" after normalization.
      matchType = 'normalized_name';
      score = distance != null && distance <= radius ? 94 : 88;
    } else if (distance != null && distance <= Math.min(radius, 80)) {
      matchType = 'coordinate';
      score = 84 - Math.min(12, (distance / Math.min(radius, 80)) * 12);
    } else if (distance != null && distance <= radius) {
      const addressSimilarity = diceSimilarity(
        normalizeAddress(row.parking_address),
        normalizeAddress(row.station_address),
      );
      const nameSimilarity = diceSimilarity(pName, sName);
      if (addressSimilarity >= 0.5 || nameSimilarity >= 0.45) {
        matchType = 'address_name';
        score = 76 + Math.max(addressSimilarity, nameSimilarity) * 8 - (distance / radius) * 8;
      }
    }

    if (!matchType) continue;
    const key = `${row.parking_id}:${row.stat_id}`;
    const candidate = {
      parking_id: row.parking_id,
      stat_id: row.stat_id,
      match_type: matchType,
      match_score: Math.round(score * 100) / 100,
      distance_m: distance == null ? null : Math.round(distance),
      reviewed: 0,
      matched_at: matchedAt,
    };
    const current = matches.get(key);
    if (!current || candidate.match_score > current.match_score) matches.set(key, candidate);
  }

  const rows = [...matches.values()];
  const sql = `INSERT INTO parking_ev_matches (
      parking_id, stat_id, match_type, match_score, distance_m, reviewed, matched_at
    )
    SELECT
      json_extract(j.value, '$.parking_id'),
      json_extract(j.value, '$.stat_id'),
      json_extract(j.value, '$.match_type'),
      json_extract(j.value, '$.match_score'),
      json_extract(j.value, '$.distance_m'),
      json_extract(j.value, '$.reviewed'),
      json_extract(j.value, '$.matched_at')
    FROM json_each(?1) AS j`;
  const statements: D1PreparedStatement[] = [
    db.prepare('DELETE FROM parking_ev_matches'),
  ];
  for (let offset = 0; offset < rows.length; offset += 100) {
    statements.push(db.prepare(sql).bind(JSON.stringify(rows.slice(offset, offset + 100))));
  }
  await db.batch(statements);
  return rows.length;
}

async function markReadModelJob(db: D1Database, jobName: string, runId: string, count: number | null = null) {
  await db.prepare(
    `INSERT INTO sync_state (
       job_name, status, next_page, total_pages, reported_total_count,
       last_success_at, last_error, run_id
     ) VALUES (?1, 'complete', NULL, NULL, ?2, ?3, NULL, ?4)
     ON CONFLICT(job_name) DO UPDATE SET
       status='complete', reported_total_count=excluded.reported_total_count,
       last_success_at=excluded.last_success_at, last_error=NULL, run_id=excluded.run_id`,
  ).bind(jobName, count, new Date().toISOString(), runId).run();
}

async function getReadModelState(db: D1Database) {
  const counts = await db.prepare(
    `SELECT
       (SELECT COUNT(*) FROM parking_read_model) AS parking_count,
       (SELECT COUNT(*) FROM parking_read_model WHERE parking_realtime = 1) AS realtime_parking_count,
       (SELECT COUNT(*) FROM ev_chargers WHERE COALESCE(del_yn, '') <> 'Y') AS charger_count,
       (SELECT COUNT(*) FROM ev_stations) AS station_count,
       (SELECT COUNT(DISTINCT parking_id) FROM parking_ev_matches) AS matched_parking_count,
       (SELECT COUNT(*) FROM parking_ev_matches) AS match_count`,
  ).first<{
    parking_count: number;
    realtime_parking_count: number;
    charger_count: number;
    station_count: number;
    matched_parking_count: number;
    match_count: number;
  }>();
  const jobs = await db.prepare(
    `SELECT job_name, status, last_success_at, last_error, reported_total_count
       FROM sync_state
      WHERE job_name IN ('ev_info','read_model_ev_stations','read_model_parking','read_model_matches')
      ORDER BY job_name`,
  ).all();
  const parkingCount = Number(counts?.parking_count || 0);
  const chargerCount = Number(counts?.charger_count || 0);
  const stationCount = Number(counts?.station_count || 0);
  const matchedParkingCount = Number(counts?.matched_parking_count || 0);
  const jobRows = jobs.results as Array<{ job_name: string; status: string }>;
  const completedJobs = new Set(
    jobRows.filter((row) => row.status === 'complete').map((row) => row.job_name),
  );
  const ready =
    parkingCount > 0 && chargerCount > 0 && stationCount > 0 &&
    completedJobs.has('read_model_ev_stations') &&
    completedJobs.has('read_model_parking') &&
    completedJobs.has('read_model_matches');
  return {
    ok: true,
    dataLayerVersion: DATA_LAYER_VERSION,
    ready,
    parkingCount,
    realtimeParkingCount: Number(counts?.realtime_parking_count || 0),
    chargerCount,
    stationCount,
    matchedParkingCount,
    matchCount: Number(counts?.match_count || 0),
    matchRadiusMeters: 200,
    jobs: jobs.results,
  };
}

function readRowToPlace(row: ParkingReadRow) {
  const score = row.best_match_score == null ? null : Number(row.best_match_score);
  return {
    id: row.parking_id,
    name: row.name,
    address: row.address || '주소 정보 없음',
    agency: row.agency || '',
    lat: row.lat == null ? null : Number(row.lat),
    lng: row.lng == null ? null : Number(row.lng),
    capacity: row.capacity == null ? null : Number(row.capacity),
    availableParking: row.available_parking == null ? null : Number(row.available_parking),
    occupiedParking: row.occupied_parking == null ? null : Number(row.occupied_parking),
    feeText: row.fee_text || '요금 정보 확인 필요',
    operationText: row.operation_text || '운영시간 확인 필요',
    parkingUpdatedAt: row.parking_updated_at || null,
    parkingRealtime: Number(row.parking_realtime || 0) === 1,
    parkingSource: (row.parking_source || 'busan-city') as ParkingBase['parkingSource'],
    realtimeMatch: {
      matched: Boolean(row.realtime_name),
      type: row.realtime_match_type || 'unmatched',
      realtimeName: row.realtime_name || null,
    },
    charger: {
      total: Number(row.charger_total || 0),
      available: Number(row.charger_available || 0),
      charging: Number(row.charger_charging || 0),
      fast: Number(row.charger_fast || 0),
      slow: Number(row.charger_slow || 0),
      stations: row.station_names ? row.station_names.split(',').filter(Boolean) : [],
      nearestDistanceMeters: row.nearest_distance_m == null ? null : Math.round(Number(row.nearest_distance_m)),
      lastUpdated: row.charger_last_updated || null,
      matchConfidence: score == null ? null : score >= 94 ? 'high' : score >= 82 ? 'medium' : 'low',
    },
    source: 'live' as const,
  };
}

/* -------------------------------------------------------------------------- */
/* Parking API data layer                                                      */
/* -------------------------------------------------------------------------- */

async function fetchMergedParking(env: Env): Promise<{
  items: ParkingBase[];
  realtimeConfigured: boolean;
  realtimeCount: number;
  userMessage: string;
  joinSummary: ParkingJoinResult['summary'];
  joinDetails: RealtimeJoinDetail[];
}> {
  const baseRaw = await fetchBaseParkingRaw(env.BUSAN_PARKING_API_KEY!);
  const baseParsed = parseBaseParkingItems(baseRaw.items);
  // 부산 공영주차장 원본 API가 페이지 경계/관리번호 중복을 반환해도
  // read model PK(parking_id)를 깨지 않도록 여기서 1차 정리합니다.
  const baseItems = dedupeParkingById(baseParsed.valid.map(normalizeBaseParking)).items;

  if (!env.BUSAN_REALTIME_PARKING_API_URL) {
    return {
      items: baseItems,
      realtimeConfigured: false,
      realtimeCount: 0,
      userMessage: '실시간 주차정보 연동 전입니다.',
      joinSummary: emptyJoinSummary(),
      joinDetails: [],
    };
  }

  try {
    const realtimeRaw = await fetchRealtimeParkingRaw(
      env.BUSAN_PARKING_API_KEY!,
      env.BUSAN_REALTIME_PARKING_API_URL,
    );
    const realtimeParsed = parseRealtimeParkingItems(realtimeRaw.items);
    const joined = joinRealtimeParkingByName(baseItems, realtimeParsed.valid);
    const realtimeCount = joined.items.filter(
      (item) => item.parkingRealtime && item.availableParking != null,
    ).length;

    return {
      items: joined.items,
      realtimeConfigured: true,
      realtimeCount,
      userMessage:
        joined.summary.matched > 0
          ? ''
          : '실시간 주차정보를 가져왔지만 기존 주차장과 이름을 연결하지 못했습니다.',
      joinSummary: joined.summary,
      joinDetails: joined.details,
    };
  } catch (error) {
    console.warn('Realtime parking unavailable', safeError(error));
    return {
      items: baseItems,
      realtimeConfigured: true,
      realtimeCount: 0,
      userMessage: '실시간 주차정보 업데이트가 지연되고 있습니다.',
      joinSummary: emptyJoinSummary(),
      joinDetails: [],
    };
  }
}

async function fetchBaseParkingRaw(serviceKey: string) {
  const cache = getDefaultCache();
  const cacheRequest = new Request(
    `https://plugpark.internal/cache/${CACHE_VERSION}/parking/base`,
  );

  if (cache) {
    const cached = await cache.match(cacheRequest);
    if (cached) {
      try {
        const payload = await cached.json() as {
          items?: RawObject[];
          totalCount?: number | null;
          pageCount?: number;
        };
        if (Array.isArray(payload.items) && payload.items.length > 0) {
          return {
            items: payload.items,
            totalCount:
              typeof payload.totalCount === 'number'
                ? payload.totalCount
                : payload.items.length,
            pageCount:
              typeof payload.pageCount === 'number'
                ? payload.pageCount
                : Math.ceil(payload.items.length / PARKING_BASE_PAGE_SIZE),
            source: 'cache' as const,
          };
        }
      } catch {
        // 깨진 캐시는 무시하고 원본 API를 다시 조회합니다.
      }
    }
  }

  const collected: RawObject[] = [];
  let totalCount: number | null = null;
  let pageCount = 0;

  for (let pageNo = 1; pageNo <= PARKING_BASE_MAX_PAGES; pageNo += 1) {
    const url = new URL(PARKING_BASE_URL);
    url.searchParams.set('serviceKey', normalizeServiceKey(serviceKey));
    url.searchParams.set('numOfRows', String(PARKING_BASE_PAGE_SIZE));
    url.searchParams.set('pageNo', String(pageNo));
    url.searchParams.set('resultType', 'json');

    const payload = await fetchStructuredWithBackoff(
      url,
      `부산광역시 공영주차장 page ${pageNo}`,
      3,
    );
    ensureNormalResult(payload, '부산광역시 공영주차장');

    const items = extractKnownItems(payload);
    if (pageNo === 1) {
      totalCount = readMetaNumber(payload, 'totalCount');
    }

    collected.push(...items);
    pageCount = pageNo;

    if (items.length === 0 || items.length < PARKING_BASE_PAGE_SIZE) break;
    if (totalCount != null && collected.length >= totalCount) break;
  }

  if (collected.length === 0) {
    throw new Error('부산광역시 공영주차장 API가 0건을 반환했습니다.');
  }

  const result = {
    items: collected,
    totalCount: totalCount ?? collected.length,
    pageCount,
    source: 'live' as const,
  };

  if (cache) {
    await cache.put(
      cacheRequest,
      cacheJson(result, PARKING_BASE_CACHE_SECONDS),
    );
  }

  return result;
}

async function fetchRealtimeParkingRaw(serviceKey: string, endpoint: string) {
  const original = new URL(endpoint.trim());
  const listTemplate = new URL(original.toString());

  if (!listTemplate.searchParams.has('serviceKey') && !listTemplate.searchParams.has('ServiceKey')) {
    listTemplate.searchParams.set('serviceKey', normalizeServiceKey(serviceKey));
  }

  // 공공데이터포털 테스트 URL에 A01 같은 단일 주차장 예제가 붙어 있어도
  // PlugPark에서는 전체 목록 조회를 먼저 시도합니다.
  const removedFilters: string[] = [];
  for (const key of ['parkgcd', 'parkcd', 'pParkGCd']) {
    if (listTemplate.searchParams.has(key)) {
      listTemplate.searchParams.delete(key);
      removedFilters.push(key);
    }
  }

  const pageSize = 100;
  const collected: RawObject[] = [];
  let totalCount: number | null = null;

  for (let pageNo = 1; pageNo <= 20; pageNo += 1) {
    const pageUrl = new URL(listTemplate.toString());
    pageUrl.searchParams.set('pageNo', String(pageNo));
    pageUrl.searchParams.set('numOfRows', String(pageSize));

    try {
      const payload = await fetchStructuredWithRetry(pageUrl, `부산시설공단 실시간 주차 page ${pageNo}`);
      ensureNormalResult(payload, '부산시설공단 실시간 주차');
      const items = extractKnownItems(payload);
      if (pageNo === 1) totalCount = readMetaNumber(payload, 'totalCount');
      collected.push(...items);
      if (items.length < pageSize || items.length === 0) break;
    } catch (error) {
      if (pageNo === 1 && removedFilters.length > 0) {
        const fallback = new URL(original.toString());
        if (!fallback.searchParams.has('serviceKey') && !fallback.searchParams.has('ServiceKey')) {
          fallback.searchParams.set('serviceKey', normalizeServiceKey(serviceKey));
        }
        const payload = await fetchStructuredWithRetry(fallback, '부산시설공단 실시간 주차 단일 조회');
        ensureNormalResult(payload, '부산시설공단 실시간 주차');
        return {
          items: extractKnownItems(payload),
          totalCount: readMetaNumber(payload, 'totalCount'),
          removedFilters,
          listMode: false,
        };
      }
      throw error;
    }
  }

  return { items: collected, totalCount, removedFilters, listMode: true };
}

function parseBaseParkingItems(rawItems: RawObject[]) {
  const valid: BusanParkingApiItem[] = [];
  const invalid: { index: number; schema: SchemaCheck }[] = [];

  rawItems.forEach((raw, index) => {
    const schema = validateFields(raw, BASE_REQUIRED_FIELDS);
    if (!schema.valid) {
      invalid.push({ index, schema });
      return;
    }

    valid.push({
      mgntNum: field(raw, 'mgntNum'),
      pkNam: field(raw, 'pkNam'),
      doroAddr: field(raw, 'doroAddr'),
      jibunAddr: field(raw, 'jibunAddr'),
      pkCnt: field(raw, 'pkCnt'),
      xCdnt: field(raw, 'xCdnt'),
      yCdnt: field(raw, 'yCdnt'),
      guNm: field(raw, 'guNm'),
      pkFm: field(raw, 'pkFm'),
      pkGubun: field(raw, 'pkGubun'),
      svcSrtTe: field(raw, 'svcSrtTe'),
      svcEndTe: field(raw, 'svcEndTe'),
      pkBascTime: field(raw, 'pkBascTime'),
      tenMin: field(raw, 'tenMin'),
      feeAdd: field(raw, 'feeAdd'),
      feeInfo: field(raw, 'feeInfo'),
      currava: field(raw, 'currava'),
      fnlDt: field(raw, 'fnlDt'),
    });
  });

  return { valid, invalid };
}

function parseRealtimeParkingItems(rawItems: RawObject[]) {
  const valid: BusanRealtimeParkingApiItem[] = [];
  const invalid: { index: number; schema: SchemaCheck }[] = [];

  rawItems.forEach((raw, index) => {
    const schema = validateFields(raw, REALTIME_REQUIRED_FIELDS);
    if (!schema.valid) {
      invalid.push({ index, schema });
      return;
    }

    valid.push({
      parkgcd: field(raw, 'parkgcd'),
      parknm: field(raw, 'parknm'),
      curravacnt: field(raw, 'curravacnt'),
      parkingcnt: field(raw, 'parkingcnt'),
      maxcnt: field(raw, 'maxcnt'),
      lastupdatetime: field(raw, 'lastupdatetime'),
    });
  });

  return { valid, invalid };
}

function normalizeBaseParking(item: BusanParkingApiItem): ParkingBase {
  const capacity = numberField(item.pkCnt);
  const basicMinutes = numberField(item.pkBascTime);
  const baseFee = numberField(item.tenMin);
  const address = cleanValue(item.doroAddr) || cleanValue(item.jibunAddr) || '주소 정보 없음';

  const normalizedName = normalizeParkingName(item.pkNam);
  const normalizedAddress = normalizeAddress(address);

  return {
    // 관리번호가 없는 서로 다른 주차장이 같은 이름을 쓸 수 있으므로 주소까지 fallback key에 포함합니다.
    id: cleanValue(item.mgntNum) || `base:${normalizedName}|${normalizedAddress}`,
    name: cleanValue(item.pkNam) || '이름 없는 공영주차장',
    address,
    agency: cleanValue(item.guNm),
    lat: latitudeField(item.xCdnt),
    lng: longitudeField(item.yCdnt),
    capacity,
    availableParking: null,
    occupiedParking: null,
    feeText:
      baseFee != null
        ? `${basicMinutes ?? 10}분 ${baseFee.toLocaleString('ko-KR')}원`
        : cleanValue(item.feeInfo) || '요금 정보 확인 필요',
    operationText:
      cleanValue(item.svcSrtTe) || cleanValue(item.svcEndTe)
        ? `${cleanValue(item.svcSrtTe) || '?'} ~ ${cleanValue(item.svcEndTe) || '?'}`
        : '운영시간 확인 필요',
    parkingUpdatedAt: null,
    parkingRealtime: false,
    parkingSource: 'busan-city',
    realtimeMatch: {
      matched: false,
      type: 'unmatched',
      realtimeName: null,
    },
  };
}

function normalizeRealtimeNumbers(item: BusanRealtimeParkingApiItem) {
  let available = numberField(item.curravacnt);
  let occupied = numberField(item.parkingcnt);
  let capacity = numberField(item.maxcnt);

  if (capacity == null && available != null && occupied != null) capacity = available + occupied;
  if (available == null && capacity != null && occupied != null) available = Math.max(0, capacity - occupied);
  if (occupied == null && capacity != null && available != null) occupied = Math.max(0, capacity - available);

  if (
    capacity != null &&
    available != null &&
    occupied != null &&
    Math.abs(capacity - (available + occupied)) > 1
  ) {
    available = Math.max(0, capacity - occupied);
  }

  return { available, occupied, capacity };
}

function joinRealtimeParkingByName(baseItems: ParkingBase[], realtimeItems: BusanRealtimeParkingApiItem[]): ParkingJoinResult {
  const output = baseItems.map((item) => ({ ...item, realtimeMatch: { ...item.realtimeMatch } }));
  const usedBaseIndexes = new Set<number>();
  const details: RealtimeJoinDetail[] = [];

  for (const realtime of realtimeItems) {
    const realtimeName = cleanValue(realtime.parknm);
    const normalizedRealtime = normalizeParkingName(realtimeName);

    if (!normalizedRealtime) {
      details.push({
        realtimeCode: cleanValue(realtime.parkgcd),
        realtimeName,
        normalizedRealtimeName: '',
        baseId: null,
        baseName: null,
        type: 'unmatched',
        score: null,
      });
      continue;
    }

    const candidates = output
      .map((base, index) => ({
        base,
        index,
        normalized: normalizeParkingName(base.name),
      }))
      .filter((candidate) => !usedBaseIndexes.has(candidate.index) && candidate.normalized);

    const exact = candidates.filter((candidate) => candidate.normalized === normalizedRealtime);
    let chosen: typeof candidates[number] | null = null;
    let type: ParkingMatchType = 'unmatched';
    let score: number | null = null;

    if (exact.length === 1) {
      chosen = exact[0];
      type = 'exact-name';
      score = 1;
    } else if (exact.length > 1) {
      type = 'ambiguous';
    } else {
      const contained = candidates.filter((candidate) => {
        const shorter = Math.min(candidate.normalized.length, normalizedRealtime.length);
        return shorter >= 4 && (
          candidate.normalized.includes(normalizedRealtime) ||
          normalizedRealtime.includes(candidate.normalized)
        );
      });

      if (contained.length === 1) {
        chosen = contained[0];
        type = 'contained-name';
        score = 0.94;
      } else if (contained.length > 1) {
        type = 'ambiguous';
      } else {
        const ranked = candidates
          .map((candidate) => ({
            candidate,
            similarity: diceSimilarity(normalizedRealtime, candidate.normalized),
          }))
          .sort((a, b) => b.similarity - a.similarity);

        const best = ranked[0];
        const second = ranked[1];
        if (best && best.similarity >= 0.84 && (!second || best.similarity - second.similarity >= 0.08)) {
          chosen = best.candidate;
          type = 'similar-name';
          score = Number(best.similarity.toFixed(3));
        } else if (best && best.similarity >= 0.84) {
          type = 'ambiguous';
          score = Number(best.similarity.toFixed(3));
        }
      }
    }

    if (!chosen) {
      details.push({
        realtimeCode: cleanValue(realtime.parkgcd),
        realtimeName,
        normalizedRealtimeName: normalizedRealtime,
        baseId: null,
        baseName: null,
        type,
        score,
      });
      continue;
    }

    usedBaseIndexes.add(chosen.index);
    const current = output[chosen.index];
    const numbers = normalizeRealtimeNumbers(realtime);
    output[chosen.index] = {
      ...current,
      capacity: numbers.capacity ?? current.capacity,
      availableParking: numbers.available,
      occupiedParking: numbers.occupied,
      parkingUpdatedAt: cleanValue(realtime.lastupdatetime) || current.parkingUpdatedAt,
      parkingRealtime: numbers.available != null,
      parkingSource: 'merged',
      realtimeMatch: {
        matched: true,
        type,
        realtimeName,
      },
    };

    details.push({
      realtimeCode: cleanValue(realtime.parkgcd),
      realtimeName,
      normalizedRealtimeName: normalizedRealtime,
      baseId: current.id,
      baseName: current.name,
      type,
      score,
    });
  }

  return {
    items: dedupeParking(output),
    details,
    summary: summarizeJoin(details),
  };
}

function emptyJoinSummary(): ParkingJoinResult['summary'] {
  return {
    realtimeCount: 0,
    matched: 0,
    exact: 0,
    contained: 0,
    similar: 0,
    ambiguous: 0,
    unmatched: 0,
  };
}

function summarizeJoin(details: RealtimeJoinDetail[]): ParkingJoinResult['summary'] {
  return {
    realtimeCount: details.length,
    matched: details.filter((item) => ['exact-name', 'contained-name', 'similar-name'].includes(item.type)).length,
    exact: details.filter((item) => item.type === 'exact-name').length,
    contained: details.filter((item) => item.type === 'contained-name').length,
    similar: details.filter((item) => item.type === 'similar-name').length,
    ambiguous: details.filter((item) => item.type === 'ambiguous').length,
    unmatched: details.filter((item) => item.type === 'unmatched').length,
  };
}

function parkingRowQuality(item: ParkingBase) {
  let score = 0;
  if (item.parkingRealtime) score += 100;
  if (item.availableParking != null) score += 20;
  if (item.occupiedParking != null) score += 10;
  if (item.lat != null && item.lng != null) score += 8;
  if (item.capacity != null) score += 4;
  if (item.address && item.address !== '주소 정보 없음') score += 2;
  if (item.agency) score += 1;
  return score;
}

function dedupeParkingById(items: ParkingBase[]) {
  const byId = new Map<string, ParkingBase>();
  let duplicateCount = 0;

  for (const item of items) {
    const id = String(item.id || '').trim();
    if (!id) continue;

    const current = byId.get(id);
    if (!current) {
      byId.set(id, item);
      continue;
    }

    duplicateCount += 1;
    const currentScore = parkingRowQuality(current);
    const incomingScore = parkingRowQuality(item);
    if (incomingScore > currentScore) {
      byId.set(id, item);
      continue;
    }

    // 동점이면 더 최신 실시간 시각을 가진 행을 선택합니다.
    if (incomingScore === currentScore) {
      const currentUpdated = String(current.parkingUpdatedAt || '');
      const incomingUpdated = String(item.parkingUpdatedAt || '');
      if (incomingUpdated > currentUpdated) byId.set(id, item);
    }
  }

  return {
    items: [...byId.values()],
    inputCount: items.length,
    uniqueCount: byId.size,
    duplicateCount,
  };
}

function dedupeParking(items: ParkingBase[]) {
  const byId = dedupeParkingById(items).items;
  const seen = new Set<string>();
  const result: ParkingBase[] = [];
  for (const item of byId) {
    const key = `${normalizeParkingName(item.name)}|${normalizeAddress(item.address)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

/* -------------------------------------------------------------------------- */
/* EV API data layer                                                           */
/* -------------------------------------------------------------------------- */

async function fetchEvInfoPage(serviceKey: string, pageNo: number) {
  const url = new URL(EV_INFO_URL);
  url.searchParams.set('serviceKey', normalizeServiceKey(serviceKey));
  url.searchParams.set('pageNo', String(pageNo));
  url.searchParams.set('numOfRows', String(EV_INFO_PAGE_SIZE));
  url.searchParams.set('zcode', '26');
  url.searchParams.set('dataType', 'JSON');

  const payload = await fetchStructuredWithRetry(url, `EV info page ${pageNo}`);
  ensureNormalResult(payload, 'EV getChargerInfo');
  const rawItems = extractKnownItems(payload);
  const parsed = parseEvInfoItems(rawItems);

  return {
    rawItems,
    validItems: parsed.valid.filter((item) => item.zcode === '26' || item.addr.startsWith('부산')),
    invalid: parsed.invalid,
    totalCount: readMetaNumber(payload, 'totalCount'),
  };
}

function parseEvInfoItems(rawItems: RawObject[]) {
  const valid: EvChargerInfoApiItem[] = [];
  const invalid: { index: number; schema: SchemaCheck }[] = [];

  rawItems.forEach((raw, index) => {
    const schema = validateFields(raw, EV_INFO_REQUIRED_FIELDS);
    if (!schema.valid) {
      invalid.push({ index, schema });
      return;
    }

    valid.push({
      statNm: field(raw, 'statNm'),
      statId: field(raw, 'statId'),
      chgerId: field(raw, 'chgerId'),
      chgerType: field(raw, 'chgerType'),
      addr: field(raw, 'addr'),
      addrDetail: field(raw, 'addrDetail'),
      location: field(raw, 'location'),
      lat: field(raw, 'lat'),
      lng: field(raw, 'lng'),
      useTime: field(raw, 'useTime'),
      busiId: field(raw, 'busiId'),
      bnm: field(raw, 'bnm'),
      busiNm: field(raw, 'busiNm'),
      busiCall: field(raw, 'busiCall'),
      stat: field(raw, 'stat'),
      statUpdDt: field(raw, 'statUpdDt'),
      lastTsdt: field(raw, 'lastTsdt'),
      lastTedt: field(raw, 'lastTedt'),
      nowTsdt: field(raw, 'nowTsdt'),
      output: field(raw, 'output'),
      method: field(raw, 'method'),
      zcode: field(raw, 'zcode'),
      zscode: field(raw, 'zscode'),
      kind: field(raw, 'kind'),
      kindDetail: field(raw, 'kindDetail'),
      parkingFree: field(raw, 'parkingFree'),
      note: field(raw, 'note'),
      limitYn: field(raw, 'limitYn'),
      limitDetail: field(raw, 'limitDetail'),
      delYn: field(raw, 'delYn'),
      delDetail: field(raw, 'delDetail'),
      trafficYn: field(raw, 'trafficYn'),
      year: field(raw, 'year'),
      floorNum: field(raw, 'floorNum'),
      floorType: field(raw, 'floorType'),
      maker: field(raw, 'maker'),
    });
  });

  return { valid, invalid };
}

function parseEvStatusItems(rawItems: RawObject[]) {
  const valid: EvChargerStatusApiItem[] = [];
  const invalid: { index: number; schema: SchemaCheck }[] = [];

  rawItems.forEach((raw, index) => {
    const schema = validateFields(raw, EV_STATUS_REQUIRED_FIELDS);
    if (!schema.valid) {
      invalid.push({ index, schema });
      return;
    }

    valid.push({
      busiId: field(raw, 'busiId'),
      statId: field(raw, 'statId'),
      chgerId: field(raw, 'chgerId'),
      stat: field(raw, 'stat'),
      statUpdDt: field(raw, 'statUpdDt'),
      lastTsdt: field(raw, 'lastTsdt'),
      lastTedt: field(raw, 'lastTedt'),
      nowTsdt: field(raw, 'nowTsdt'),
    });
  });

  return { valid, invalid };
}

function toParkingOnlyPlace(parking: ParkingBase) {
  return {
    ...parking,
    charger: {
      total: 0,
      available: 0,
      charging: 0,
      fast: 0,
      slow: 0,
      stations: [] as string[],
      nearestDistanceMeters: null as number | null,
      lastUpdated: null as string | null,
      matchConfidence: null as 'high' | 'medium' | 'low' | null,
    },
    source: 'live' as const,
  };
}

/* -------------------------------------------------------------------------- */
/* Diagnostics                                                                 */
/* -------------------------------------------------------------------------- */

async function diagnosticsParkingBase(serviceKey: string) {
  try {
    const raw = await fetchBaseParkingRaw(serviceKey);
    const parsed = parseBaseParkingItems(raw.items);
    return json({
      ok: parsed.invalid.length === 0,
      source: 'busan-city-parking',
      totalCount: raw.totalCount,
      itemCount: raw.items.length,
      pageCount: raw.pageCount,
      fetchSource: raw.source,
      validCount: parsed.valid.length,
      invalidCount: parsed.invalid.length,
      schema: schemaDiagnostic(raw.items[0], BASE_REQUIRED_FIELDS),
      sample: raw.items[0] || null,
      invalid: parsed.invalid.slice(0, 5),
    });
  } catch (error) {
    return upstreamError(error);
  }
}

async function diagnosticsParkingRealtime(env: Env) {
  if (!env.BUSAN_REALTIME_PARKING_API_URL) {
    return json({
      ok: false,
      configured: false,
      message: '실시간 주차 API URL이 아직 설정되지 않았습니다.',
      expectedFields: REALTIME_REQUIRED_FIELDS,
    }, 200);
  }

  try {
    const raw = await fetchRealtimeParkingRaw(
      env.BUSAN_PARKING_API_KEY!,
      env.BUSAN_REALTIME_PARKING_API_URL,
    );
    const parsed = parseRealtimeParkingItems(raw.items);
    return json({
      ok: parsed.invalid.length === 0 && parsed.valid.length > 0,
      configured: true,
      totalCount: raw.totalCount,
      itemCount: raw.items.length,
      validCount: parsed.valid.length,
      invalidCount: parsed.invalid.length,
      listMode: raw.listMode,
      removedSampleFilters: raw.removedFilters,
      schema: schemaDiagnostic(raw.items[0], REALTIME_REQUIRED_FIELDS),
      sample: raw.items[0] || null,
      invalid: parsed.invalid.slice(0, 5),
    });
  } catch (error) {
    return upstreamError(error);
  }
}

async function diagnosticsParkingMatching(env: Env) {
  try {
    const parking = await fetchMergedParking(env);
    return json({
      ok: true,
      summary: parking.joinSummary,
      matchedSamples: parking.joinDetails.filter((item) => ['exact-name', 'contained-name', 'similar-name'].includes(item.type)).slice(0, 20),
      ambiguous: parking.joinDetails.filter((item) => item.type === 'ambiguous').slice(0, 20),
      unmatched: parking.joinDetails.filter((item) => item.type === 'unmatched').slice(0, 20),
    });
  } catch (error) {
    return upstreamError(error);
  }
}

async function diagnosticsEvInfo(serviceKey: string) {
  try {
    const page = await fetchEvInfoPage(serviceKey, 1);
    return json({
      ok: page.invalid.length === 0,
      source: 'getChargerInfo',
      request: { pageNo: 1, numOfRows: EV_INFO_PAGE_SIZE, zcode: '26', dataType: 'JSON' },
      totalCountReported: page.totalCount,
      rawItemCount: page.rawItems.length,
      busanValidCount: page.validItems.length,
      regionFilterHonored: page.rawItems.length === 0 ? null : page.validItems.length / page.rawItems.length >= 0.8,
      schema: schemaDiagnostic(page.rawItems[0], EV_INFO_REQUIRED_FIELDS),
      sample: page.rawItems[0] || null,
      invalid: page.invalid.slice(0, 5),
    });
  } catch (error) {
    return upstreamError(error);
  }
}

async function diagnosticsEvStatus(serviceKey: string) {
  try {
    const url = new URL(EV_STATUS_URL);
    url.searchParams.set('serviceKey', normalizeServiceKey(serviceKey));
    url.searchParams.set('pageNo', '1');
    url.searchParams.set('numOfRows', String(Math.min(EV_STATUS_PAGE_SIZE, 100)));
    url.searchParams.set('period', '10');
    url.searchParams.set('zcode', '26');
    url.searchParams.set('dataType', 'JSON');
    const payload = await fetchStructuredWithRetry(url, 'EV status diagnostics');
    ensureNormalResult(payload, 'EV getChargerStatus');
    const rawItems = extractKnownItems(payload);
    const parsed = parseEvStatusItems(rawItems);
    return json({
      ok: parsed.invalid.length === 0,
      source: 'getChargerStatus',
      request: { pageNo: 1, numOfRows: Math.min(EV_STATUS_PAGE_SIZE, 100), period: 10, zcode: '26', dataType: 'JSON' },
      totalCountReported: readMetaNumber(payload, 'totalCount'),
      itemCount: rawItems.length,
      validCount: parsed.valid.length,
      schema: schemaDiagnostic(rawItems[0], EV_STATUS_REQUIRED_FIELDS),
      sample: rawItems[0] || null,
      invalid: parsed.invalid.slice(0, 5),
    });
  } catch (error) {
    return upstreamError(error);
  }
}

/* -------------------------------------------------------------------------- */
/* HTTP / payload parsing                                                      */
/* -------------------------------------------------------------------------- */


/* -------------------------------------------------------------------------- */
/* v0.5.1 D1 foundation + EV Info ingest                                     */
/* -------------------------------------------------------------------------- */

function d1ConfigError() {
  return json({
    ok: false,
    error: 'D1 binding DB가 설정되지 않았습니다. v0.5.1 설정 가이드를 적용해주세요.',
  }, 503);
}

function validateIngestAdmin(request: Request, env: Env): Response | null {
  const expected = env.INGEST_ADMIN_TOKEN?.trim();
  if (!expected) return configError('INGEST_ADMIN_TOKEN');
  const authorization = request.headers.get('authorization') || '';
  if (authorization !== `Bearer ${expected}`) {
    return json({ ok: false, error: 'EV ingest 관리자 인증에 실패했습니다.' }, 401);
  }
  return null;
}

async function getD1EvInfoState(db: D1Database) {
  const state = await db.prepare(
    `SELECT job_name, status, next_page, total_pages, reported_total_count,
            last_success_at, last_error, run_id
       FROM sync_state
      WHERE job_name = ?1`,
  ).bind(D1_EV_INFO_JOB).first<EvInfoSyncStateRow>();

  const counts = await db.prepare(
    `SELECT COUNT(*) AS charger_count,
            COUNT(DISTINCT stat_id) AS station_count,
            SUM(CASE WHEN del_yn = 'Y' THEN 1 ELSE 0 END) AS deleted_count
       FROM ev_chargers`,
  ).first<{ charger_count: number; station_count: number; deleted_count: number | null }>();

  return {
    ok: true,
    dataLayerVersion: DATA_LAYER_VERSION,
    job: D1_EV_INFO_JOB,
    state: state || {
      job_name: D1_EV_INFO_JOB,
      status: 'not-started',
      next_page: 1,
      total_pages: null,
      reported_total_count: null,
      last_success_at: null,
      last_error: null,
      run_id: null,
    },
    stored: {
      chargerCount: Number(counts?.charger_count || 0),
      stationCount: Number(counts?.station_count || 0),
      deletedCount: Number(counts?.deleted_count || 0),
    },
  };
}

async function getD1EvInfoStateSafe(db: D1Database) {
  try {
    return await getD1EvInfoState(db);
  } catch (error) {
    return { ok: false, error: safeError(error) };
  }
}

async function ingestEvInfoPagesToD1(
  db: D1Database,
  serviceKey: string,
  requestedPages: number,
) {
  const existing = await db.prepare(
    `SELECT job_name, status, next_page, total_pages, reported_total_count,
            last_success_at, last_error, run_id
       FROM sync_state
      WHERE job_name = ?1`,
  ).bind(D1_EV_INFO_JOB).first<EvInfoSyncStateRow>();

  let pageNo = Math.max(1, Number(existing?.next_page || 1));
  let totalPages = existing?.total_pages == null ? null : Number(existing.total_pages);
  let reportedTotalCount =
    existing?.reported_total_count == null ? null : Number(existing.reported_total_count);
  const runId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  const pages: Array<{
    pageNo: number;
    rawCount: number;
    storedCount: number;
    duplicateCount: number;
    totalCount: number | null;
  }> = [];

  // Do not mutate the durable checkpoint before a page succeeds.
  // If Cloudflare terminates this invocation (1102), the last good checkpoint stays intact.
  try {
    for (let step = 0; step < requestedPages; step += 1) {
      if (totalPages != null && pageNo > totalPages) break;

      await incrementApiUsage(db, 'ev_info');
      const page = await fetchEvInfoPageForD1(serviceKey, pageNo);
      await upsertEvInfoPage(db, page.items);

      if (page.totalCount != null) {
        if (reportedTotalCount != null && reportedTotalCount !== page.totalCount) {
          throw new Error(
            `EV_TOTAL_COUNT_CHANGED: 기존 ${reportedTotalCount}, page ${pageNo} 응답 ${page.totalCount}`,
          );
        }
        reportedTotalCount = page.totalCount;
        totalPages = Math.ceil(page.totalCount / EV_INFO_PAGE_SIZE);
      }

      const completedByShortPage = page.rawCount < EV_INFO_PAGE_SIZE;
      const nextPage = pageNo + 1;
      const completedByTotal = totalPages != null && nextPage > totalPages;
      const complete = completedByShortPage || completedByTotal;
      const completedAt = new Date().toISOString();

      pages.push({
        pageNo,
        rawCount: page.rawCount,
        storedCount: page.items.length,
        duplicateCount: page.duplicateCount,
        totalCount: page.totalCount,
      });

      pageNo = nextPage;
      await upsertSyncState(db, {
        status: complete ? 'complete' : 'running',
        nextPage: pageNo,
        totalPages,
        reportedTotalCount,
        lastSuccessAt: completedAt,
        lastError: null,
        runId,
      });

      if (complete) break;
    }
  } catch (error) {
    await upsertSyncState(db, {
      status: 'error',
      nextPage: pageNo,
      totalPages,
      reportedTotalCount,
      lastSuccessAt: existing?.last_success_at || null,
      lastError: safeError(error),
      runId,
    });
    throw error;
  }

  const state = await getD1EvInfoState(db);
  return {
    ok: true,
    runId,
    startedAt,
    pagesRequested: requestedPages,
    pagesProcessed: pages.length,
    pages,
    state,
  };
}

async function fetchEvInfoPageForD1(
  serviceKey: string,
  requestedPageNo: number,
): Promise<D1EvInfoPage> {
  const url = new URL(EV_INFO_URL);
  url.searchParams.set('serviceKey', normalizeServiceKey(serviceKey));
  url.searchParams.set('pageNo', String(requestedPageNo));
  url.searchParams.set('numOfRows', String(EV_INFO_PAGE_SIZE));
  url.searchParams.set('zcode', '26');
  url.searchParams.set('dataType', 'JSON');

  const payload = await fetchStructuredWithRetry(url, `D1 EV info page ${requestedPageNo}`);
  ensureNormalResult(payload, 'EV getChargerInfo');

  const responsePageNo = readMetaNumber(payload, 'pageNo');
  if (responsePageNo == null) {
    throw new Error(`EV_META_MISSING: pageNo가 없습니다. requested=${requestedPageNo}`);
  }
  if (responsePageNo !== requestedPageNo) {
    throw new Error(
      `EV_PAGE_MISMATCH: requested=${requestedPageNo}, response=${responsePageNo}`,
    );
  }

  const responseNumOfRows = readMetaNumber(payload, 'numOfRows');
  if (responseNumOfRows != null && responseNumOfRows !== EV_INFO_PAGE_SIZE) {
    throw new Error(
      `EV_PAGE_SIZE_MISMATCH: requested=${EV_INFO_PAGE_SIZE}, response=${responseNumOfRows}`,
    );
  }

  const rawItems = extractKnownItems(payload);
  const parsed = parseEvInfoItems(rawItems);
  if (parsed.invalid.length > 0) {
    const sample = parsed.invalid.slice(0, 3).map((item) => ({
      index: item.index,
      missing: item.schema.missing,
    }));
    throw new Error(
      `EV_SCHEMA_MISMATCH: page=${requestedPageNo}, invalid=${parsed.invalid.length}, sample=${JSON.stringify(sample)}`,
    );
  }

  const invalidIdentity = parsed.valid.filter(
    (item) => !item.statId.trim() || !item.chgerId.trim() || !item.statNm.trim(),
  );
  if (invalidIdentity.length > 0) {
    throw new Error(
      `EV_IDENTITY_INVALID: page=${requestedPageNo}, count=${invalidIdentity.length}`,
    );
  }

  const wrongRegion = parsed.valid.filter((item) => item.zcode !== '26');
  if (wrongRegion.length > 0) {
    const sample = wrongRegion.slice(0, 5).map((item) => ({
      statId: item.statId,
      chgerId: item.chgerId,
      stationName: item.statNm,
      zcode: item.zcode,
      address: item.addr,
    }));
    throw new Error(
      `EV_REGION_MISMATCH: zcode=26 요청에 타지역 ${wrongRegion.length}건. sample=${JSON.stringify(sample)}`,
    );
  }

  const unique = new Map<string, EvChargerInfoApiItem>();
  for (const item of parsed.valid) {
    unique.set(evCompositeKey(item.statId, item.chgerId), item);
  }

  return {
    items: [...unique.values()],
    rawCount: rawItems.length,
    pageNo: responsePageNo,
    numOfRows: responseNumOfRows,
    totalCount: readMetaNumber(payload, 'totalCount'),
    duplicateCount: parsed.valid.length - unique.size,
  };
}

async function upsertEvInfoPage(db: D1Database, items: EvChargerInfoApiItem[]) {
  const syncedAt = new Date().toISOString();

  // Preparing/binding 200 individual 38-column statements was expensive enough to
  // trigger Worker 1102 on the free CPU budget. D1 supports SQLite JSON functions,
  // so ship rows as JSON and expand them inside SQLite instead.
  const rows = items.map((item) => ({
    stat_id: item.statId,
    chger_id: item.chgerId,
    station_name: item.statNm,
    normalized_station_name: normalizeParkingName(item.statNm),
    charger_type: nullableText(item.chgerType),
    address: nullableText(item.addr),
    address_detail: nullableText(item.addrDetail),
    location: nullableText(item.location),
    lat: nullableNumber(item.lat),
    lng: nullableNumber(item.lng),
    use_time: nullableText(item.useTime),
    busi_id: nullableText(item.busiId),
    bnm: nullableText(item.bnm),
    busi_name: nullableText(item.busiNm),
    busi_call: nullableText(item.busiCall),
    info_status: nullableText(item.stat),
    info_status_updated_at: nullableText(item.statUpdDt),
    last_start_at: nullableText(item.lastTsdt),
    last_end_at: nullableText(item.lastTedt),
    now_start_at: nullableText(item.nowTsdt),
    output_kw: nullableNumber(item.output),
    method: nullableText(item.method),
    zcode: item.zcode,
    zscode: nullableText(item.zscode),
    kind: nullableText(item.kind),
    kind_detail: nullableText(item.kindDetail),
    parking_free: nullableText(item.parkingFree),
    note: nullableText(item.note),
    limit_yn: nullableText(item.limitYn),
    limit_detail: nullableText(item.limitDetail),
    del_yn: nullableText(item.delYn),
    del_detail: nullableText(item.delDetail),
    traffic_yn: nullableText(item.trafficYn),
    year: nullableText(item.year),
    floor_num: nullableText(item.floorNum),
    floor_type: nullableText(item.floorType),
    maker: nullableText(item.maker),
    synced_at: syncedAt,
  }));

  const sql = `INSERT INTO ev_chargers (
      stat_id, chger_id, station_name, normalized_station_name,
      charger_type, address, address_detail, location, lat, lng,
      use_time, busi_id, bnm, busi_name, busi_call,
      info_status, info_status_updated_at,
      last_start_at, last_end_at, now_start_at,
      output_kw, method, zcode, zscode, kind, kind_detail,
      parking_free, note, limit_yn, limit_detail,
      del_yn, del_detail, traffic_yn, year, floor_num, floor_type, maker,
      synced_at
    )
    SELECT
      json_extract(j.value, '$.stat_id'),
      json_extract(j.value, '$.chger_id'),
      json_extract(j.value, '$.station_name'),
      json_extract(j.value, '$.normalized_station_name'),
      json_extract(j.value, '$.charger_type'),
      json_extract(j.value, '$.address'),
      json_extract(j.value, '$.address_detail'),
      json_extract(j.value, '$.location'),
      json_extract(j.value, '$.lat'),
      json_extract(j.value, '$.lng'),
      json_extract(j.value, '$.use_time'),
      json_extract(j.value, '$.busi_id'),
      json_extract(j.value, '$.bnm'),
      json_extract(j.value, '$.busi_name'),
      json_extract(j.value, '$.busi_call'),
      json_extract(j.value, '$.info_status'),
      json_extract(j.value, '$.info_status_updated_at'),
      json_extract(j.value, '$.last_start_at'),
      json_extract(j.value, '$.last_end_at'),
      json_extract(j.value, '$.now_start_at'),
      json_extract(j.value, '$.output_kw'),
      json_extract(j.value, '$.method'),
      json_extract(j.value, '$.zcode'),
      json_extract(j.value, '$.zscode'),
      json_extract(j.value, '$.kind'),
      json_extract(j.value, '$.kind_detail'),
      json_extract(j.value, '$.parking_free'),
      json_extract(j.value, '$.note'),
      json_extract(j.value, '$.limit_yn'),
      json_extract(j.value, '$.limit_detail'),
      json_extract(j.value, '$.del_yn'),
      json_extract(j.value, '$.del_detail'),
      json_extract(j.value, '$.traffic_yn'),
      json_extract(j.value, '$.year'),
      json_extract(j.value, '$.floor_num'),
      json_extract(j.value, '$.floor_type'),
      json_extract(j.value, '$.maker'),
      json_extract(j.value, '$.synced_at')
    FROM json_each(?1) AS j
    WHERE 1
    ON CONFLICT(stat_id, chger_id) DO UPDATE SET
      station_name=excluded.station_name,
      normalized_station_name=excluded.normalized_station_name,
      charger_type=excluded.charger_type,
      address=excluded.address,
      address_detail=excluded.address_detail,
      location=excluded.location,
      lat=excluded.lat,
      lng=excluded.lng,
      use_time=excluded.use_time,
      busi_id=excluded.busi_id,
      bnm=excluded.bnm,
      busi_name=excluded.busi_name,
      busi_call=excluded.busi_call,
      info_status=excluded.info_status,
      info_status_updated_at=excluded.info_status_updated_at,
      last_start_at=excluded.last_start_at,
      last_end_at=excluded.last_end_at,
      now_start_at=excluded.now_start_at,
      output_kw=excluded.output_kw,
      method=excluded.method,
      zcode=excluded.zcode,
      zscode=excluded.zscode,
      kind=excluded.kind,
      kind_detail=excluded.kind_detail,
      parking_free=excluded.parking_free,
      note=excluded.note,
      limit_yn=excluded.limit_yn,
      limit_detail=excluded.limit_detail,
      del_yn=excluded.del_yn,
      del_detail=excluded.del_detail,
      traffic_yn=excluded.traffic_yn,
      year=excluded.year,
      floor_num=excluded.floor_num,
      floor_type=excluded.floor_type,
      maker=excluded.maker,
      synced_at=excluded.synced_at`;

  // Keep each JSON parameter comfortably below D1 row/binding size limits.
  for (let index = 0; index < rows.length; index += 100) {
    const chunk = rows.slice(index, index + 100);
    await db.prepare(sql).bind(JSON.stringify(chunk)).run();
  }
}

async function upsertSyncState(
  db: D1Database,
  value: {
    status: string;
    nextPage: number;
    totalPages: number | null;
    reportedTotalCount: number | null;
    lastSuccessAt: string | null;
    lastError: string | null;
    runId: string;
  },
) {
  await db.prepare(
    `INSERT INTO sync_state (
       job_name, status, next_page, total_pages, reported_total_count,
       last_success_at, last_error, run_id
     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
     ON CONFLICT(job_name) DO UPDATE SET
       status=excluded.status,
       next_page=excluded.next_page,
       total_pages=excluded.total_pages,
       reported_total_count=excluded.reported_total_count,
       last_success_at=excluded.last_success_at,
       last_error=excluded.last_error,
       run_id=excluded.run_id`,
  ).bind(
    D1_EV_INFO_JOB,
    value.status,
    value.nextPage,
    value.totalPages,
    value.reportedTotalCount,
    value.lastSuccessAt,
    value.lastError,
    value.runId,
  ).run();
}

async function incrementApiUsage(db: D1Database, apiName: string) {
  const usageDate = new Date().toISOString().slice(0, 10);
  await db.prepare(
    `INSERT INTO api_usage_daily (usage_date, api_name, request_count)
     VALUES (?1, ?2, 1)
     ON CONFLICT(usage_date, api_name) DO UPDATE SET
       request_count = request_count + 1`,
  ).bind(usageDate, apiName).run();
}

function nullableText(value: string) {
  const cleaned = cleanValue(value);
  return cleaned || null;
}

function nullableNumber(value: string) {
  return numberField(value);
}

async function fetchStructuredWithBackoff(
  url: URL,
  label: string,
  maxAttempts = 3,
) {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fetchStructured(url);
    } catch (error) {
      lastError = error;
      const message = safeError(error);
      const retryable =
        message.includes('503') ||
        message.includes('SERVICETIMEOUT') ||
        message.includes('서비스 연결실패');

      if (!retryable || attempt >= maxAttempts) {
        throw new Error(`${label} 실패: ${message}`);
      }

      await delay(350 * attempt);
    }
  }

  throw new Error(`${label} 실패: ${safeError(lastError)}`);
}

async function fetchStructuredWithRetry(url: URL, label: string) {
  try {
    return await fetchStructured(url);
  } catch (error) {
    const message = safeError(error);
    if (!message.includes('503') && !message.includes('SERVICETIMEOUT')) throw error;
    await delay(400);
    try {
      return await fetchStructured(url);
    } catch (retryError) {
      throw new Error(`${label} 재시도 실패: ${safeError(retryError)}`);
    }
  }
}

async function fetchStructured(url: URL): Promise<RawObject> {
  const response = await fetch(url.toString(), {
    headers: { Accept: 'application/json, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.1' },
  });
  const contentType = response.headers.get('content-type') || '';

  if (!response.ok) {
    const raw = await response.text();
    throw new Error(`Upstream HTTP ${response.status}: ${compact(raw).slice(0, 300)}`);
  }

  if (contentType.includes('json')) {
    const parsed = await response.json() as unknown;
    if (!isObject(parsed)) throw new Error('JSON root가 object가 아닙니다.');
    return parsed;
  }

  const raw = await response.text();
  return parseStructuredPayload(raw, contentType);
}

function parseStructuredPayload(raw: string, contentType: string): RawObject {
  const text = raw.trim();
  if (!text) throw new Error('외부 API가 빈 응답을 반환했습니다.');
  if (contentType.includes('json') || text.startsWith('{') || text.startsWith('[')) {
    try {
      const parsed = JSON.parse(text) as unknown;
      if (!isObject(parsed)) throw new Error('JSON root가 object가 아닙니다.');
      return parsed;
    } catch (error) {
      throw new Error(`JSON 파싱 실패: ${safeError(error)}`);
    }
  }
  if (text.startsWith('<')) return parseXmlPayload(text);
  throw new Error(`알 수 없는 응답 형식: ${compact(text).slice(0, 180)}`);
}

function parseXmlPayload(xml: string): RawObject {
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map((match) => {
    const item: RawObject = {};
    for (const fieldMatch of match[1].matchAll(/<([A-Za-z0-9_]+)(?:\s[^>]*)?>([\s\S]*?)<\/\1>|<([A-Za-z0-9_]+)\s*\/>/g)) {
      const key = fieldMatch[1] || fieldMatch[3];
      const value = fieldMatch[2] ?? '';
      if (key) item[key] = decodeXml(value.trim());
    }
    return item;
  });

  const resultCode = xmlTag(xml, 'resultCode');
  const resultMsg = xmlTag(xml, 'resultMsg');
  const returnReasonCode = xmlTag(xml, 'returnReasonCode');
  const returnAuthMsg = xmlTag(xml, 'returnAuthMsg');
  const errMsg = xmlTag(xml, 'errMsg');
  const totalCount = xmlTag(xml, 'totalCount');
  const pageNo = xmlTag(xml, 'pageNo');
  const numOfRows = xmlTag(xml, 'numOfRows');

  return {
    response: {
      header: {
        resultCode,
        resultMsg,
        returnReasonCode,
        returnAuthMsg,
        errMsg,
        totalCount,
        pageNo,
        numOfRows,
      },
      body: { items: { item: items }, totalCount, pageNo, numOfRows },
    },
  };
}

function extractKnownItems(payload: RawObject): RawObject[] {
  const response = objectField(payload, 'response');
  const body = objectField(response, 'body') || objectField(payload, 'body');
  const itemsNode = objectField(body, 'items') || objectField(payload, 'items');
  const item = itemsNode?.item;

  if (Array.isArray(item)) return item.filter(isObject);
  if (isObject(item)) return [item];
  if (Array.isArray(itemsNode)) return itemsNode.filter(isObject);
  return [];
}

function ensureNormalResult(payload: RawObject, source: string) {
  const resultCode = readMetaString(payload, 'resultCode');
  const resultMsg = readMetaString(payload, 'resultMsg');
  const returnReasonCode = readMetaString(payload, 'returnReasonCode');
  const returnAuthMsg = readMetaString(payload, 'returnAuthMsg');
  const errMsg = readMetaString(payload, 'errMsg');

  if (returnReasonCode || returnAuthMsg || errMsg) {
    throw new Error(
      `${source} API 오류 ${returnReasonCode || resultCode || 'UNKNOWN'}: ` +
      `${errMsg || returnAuthMsg || resultMsg || 'unknown'}`,
    );
  }

  if (resultCode && resultCode !== '00') {
    throw new Error(`${source} API 오류 ${resultCode}: ${resultMsg || 'unknown'}`);
  }
}

function readMetaString(payload: RawObject, key: string) {
  const response = objectField(payload, 'response');
  const header = objectField(response, 'header');
  const body = objectField(response, 'body');
  return field(header || {}, key) || field(body || {}, key) || field(payload, key);
}

function readMetaNumber(payload: RawObject, key: string) {
  const value = readMetaString(payload, key).trim();
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/* -------------------------------------------------------------------------- */
/* Primitive parsers / validation                                              */
/* -------------------------------------------------------------------------- */

function validateFields(raw: RawObject, required: readonly string[]): SchemaCheck {
  const receivedKeys = Object.keys(raw);
  const missing = required.filter((key) => !receivedKeys.includes(key));
  return { valid: missing.length === 0, missing: [...missing], receivedKeys };
}

function schemaDiagnostic(raw: RawObject | undefined, required: readonly string[]) {
  if (!raw) return { valid: false, missing: [...required], receivedKeys: [] };
  return validateFields(raw, required);
}

function field(raw: RawObject, key: string): string {
  const value = raw[key];
  if (value == null) return '';
  return String(value).trim();
}

function cleanValue(value: string) {
  const trimmed = value.trim();
  if (!trimmed || trimmed === '-' || trimmed.toLowerCase() === 'null') return '';
  return trimmed;
}

function numberField(value: string) {
  const cleaned = cleanValue(value).replace(/,/g, '');
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function latitudeField(value: string) {
  const parsed = numberField(value);
  return parsed != null && parsed >= 34 && parsed <= 36 ? parsed : null;
}

function longitudeField(value: string) {
  const parsed = numberField(value);
  return parsed != null && parsed >= 128 && parsed <= 130 ? parsed : null;
}

function normalizeParkingName(value: string) {
  return value
    .toLowerCase()
    .replace(/부산광역시|부산시/g, '')
    .replace(/공영주차장|노외공영주차장|노상공영주차장|공영|주차장/g, '')
    .replace(/[\s,\.·ㆍ()\[\]{}\-_\/]/g, '')
    .trim();
}

function normalizeAddress(value: string) {
  return cleanValue(value)
    .toLowerCase()
    .replace(/부산광역시|부산시/g, '')
    .replace(/[\s,\.·ㆍ()\[\]{}\-_\/]/g, '')
    .trim();
}

function diceSimilarity(a: string, b: string) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;

  const pairs = (value: string) => {
    const map = new Map<string, number>();
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

function evCompositeKey(statId: string, chgerId: string) {
  return `${statId}:${chgerId}`;
}

function haversineMeters(aLat: number, aLng: number, bLat: number, bLng: number) {
  const radius = 6371000;
  const rad = (value: number) => (value * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * radius * Math.asin(Math.sqrt(h));
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

function normalizeServiceKey(value: string) {
  const trimmed = value.trim();
  try {
    return decodeURIComponent(trimmed);
  } catch {
    return trimmed;
  }
}

function isObject(value: unknown): value is RawObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function objectField(value: RawObject | null | undefined, key: string): RawObject | null {
  if (!value) return null;
  const child = value[key];
  return isObject(child) ? child : null;
}

function xmlTag(xml: string, tag: string) {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = xml.match(new RegExp(`<${escaped}>([\\s\\S]*?)<\\/${escaped}>`, 'i'));
  return match ? decodeXml(match[1].trim()) : '';
}

function decodeXml(value: string) {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function compact(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function safeError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/* -------------------------------------------------------------------------- */
/* Cache / response helpers                                                    */
/* -------------------------------------------------------------------------- */

function getDefaultCache(): Cache | null {
  if (typeof caches === 'undefined') return null;
  return (caches as unknown as { default: Cache }).default;
}

function cacheJson(data: unknown, seconds: number) {
  return new Response(JSON.stringify(data), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': `public, max-age=${seconds}`,
    },
  });
}

function json(data: unknown, status = 200, maxAge = 0) {
  const headers = new Headers({ 'content-type': 'application/json; charset=utf-8' });
  if (maxAge > 0) headers.set('cache-control', `public, max-age=${maxAge}`);
  return new Response(JSON.stringify(data), { status, headers });
}

function configError(name: string) {
  return json({ ok: false, error: `${name}이(가) 설정되지 않았습니다.` }, 503);
}

function upstreamError(error: unknown) {
  console.error(error);
  return json({ ok: false, error: safeError(error) }, 502);
}
