import {
  isBusanCoordinates,
  kakaoAddressSearch,
  kakaoCoord2RegionCode,
  kakaoKeywordSearch,
  loadKakaoMapSdk,
} from './kakaoSdk';
import {
  classifyLocationText,
  extractNearbyLandmark,
  type LocationKind,
} from './locationIntent';

export { replaceNearbyLandmark } from './locationIntent';

export type LocationResolveFailure =
  | 'NOT_NEARBY_REQUEST'
  | 'SDK_UNAVAILABLE'
  | 'NO_RESULTS'
  | 'OUTSIDE_BUSAN'
  | 'LOW_CONFIDENCE'
  | 'REGION_MISMATCH'
  | 'ADDRESS_NOT_FOUND'
  | 'AMBIGUOUS_REGION';

export type LocationResolveMethod = 'geocoder' | 'places';

export type LandmarkResolveResult =
  | {
      ok: true;
      rawLandmark: string;
      name: string;
      canonicalName: string;
      lat: number;
      lng: number;
      score: number;
      queries: string[];
      candidateCount: number;
      kind: Exclude<LocationKind, 'current-location' | 'unknown'>;
      method: LocationResolveMethod;
      confidence: 'high' | 'medium';
    }
  | {
      ok: false;
      rawLandmark: string;
      reason: LocationResolveFailure;
      queries: string[];
      candidateCount: number;
      bestScore: number | null;
      kind: LocationKind;
      method: LocationResolveMethod | null;
    };

function normalizePlaceLookupText(value: string) {
  return String(value || '')
    .toLowerCase()
    .replace(/부산광역시|부산시/g, '부산')
    .replace(/[\s,\.·ㆍ()\[\]{}\-_\/]/g, '')
    .trim();
}

function normalizedQueryList(values: string[]) {
  return [...new Set(values.map((value) => value.replace(/\s+/g, ' ').trim()).filter(Boolean))];
}

function stripBusanPrefix(value: string) {
  return value
    .replace(/^(?:부산광역시|부산시|부산)\s*/u, '')
    .trim();
}

function busanScopedQueries(raw: string) {
  const clean = raw.replace(/\s+/g, ' ').trim();
  const withoutBusan = stripBusanPrefix(clean);

  const alreadyBusanScoped = /^(?:부산광역시|부산시|부산)\s/u.test(clean);

  return normalizedQueryList([
    alreadyBusanScoped ? clean : '',
    withoutBusan ? `부산광역시 ${withoutBusan}` : '',
    withoutBusan ? `부산 ${withoutBusan}` : '',
    clean,
    withoutBusan,
  ]);
}

function administrativeTokens(raw: string) {
  return stripBusanPrefix(raw)
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => /^[가-힣0-9]+(?:동|읍|면|리|구|군|시)$/u.test(token));
}

function candidateCoordinates(item: any) {
  const lat = Number(item?.y);
  const lng = Number(item?.x);
  if (!isBusanCoordinates(lat, lng)) return null;
  return { lat, lng };
}

function candidateAddressName(item: any) {
  return String(
    item?.address_name ||
      item?.road_address?.address_name ||
      item?.address?.address_name ||
      '',
  ).trim();
}

function regionHaystack(regions: any[]) {
  return regions
    .map((region) =>
      [
        region?.address_name,
        region?.region_1depth_name,
        region?.region_2depth_name,
        region?.region_3depth_name,
        region?.region_4depth_name,
      ]
        .filter(Boolean)
        .join(' '),
    )
    .join(' ');
}

function isBusanRegion(regions: any[]) {
  const haystack = regionHaystack(regions);
  return /부산(?:광역시)?/u.test(haystack);
}

function regionMatchesInput(raw: string, regions: any[]) {
  if (!isBusanRegion(regions)) return false;

  const tokens = administrativeTokens(raw);
  if (tokens.length === 0) return true;

  const haystack = normalizePlaceLookupText(regionHaystack(regions));
  return tokens.every((token) =>
    haystack.includes(normalizePlaceLookupText(token)),
  );
}

function canonicalRegionName(raw: string, item: any, regions: any[]) {
  const direct = candidateAddressName(item);
  if (direct && /부산/u.test(direct)) return direct;

  const tokens = administrativeTokens(raw);
  const preferred =
    regions.find((region) => {
      const name = String(region?.address_name || '');
      return (
        /부산/u.test(name) &&
        tokens.every((token) =>
          normalizePlaceLookupText(name).includes(
            normalizePlaceLookupText(token),
          ),
        )
      );
    }) ||
    regions.find((region) => region?.region_type === 'B') ||
    regions.find((region) => region?.region_type === 'H') ||
    regions[0];

  return String(preferred?.address_name || raw).trim() || raw;
}

export function buildLandmarkQueries(rawLandmark: string) {
  const clean = rawLandmark.replace(/\s+/g, ' ').trim();
  const tokens = clean.split(' ').filter(Boolean);
  const district = tokens.find((token) => /^[가-힣]+구$/.test(token)) || '';
  const rest = tokens.filter((token) => token !== district);
  const restText = rest.join(' ').trim();

  const queries = [
    `부산 ${clean}`,
    district && restText ? `부산 ${district} ${restText}` : '',
    district && restText ? `부산 ${restText} ${district}` : '',
    clean,
  ];

  if (/폴리텍/.test(restText || clean)) {
    const expanded = (restText || clean)
      .replace(/한국폴리텍(?:대학)?/g, '한국폴리텍대학')
      .replace(/폴리텍(?:대학)?/g, '폴리텍대학');

    queries.push(
      district ? `부산 ${district} ${expanded}` : `부산 ${expanded}`,
      district ? `부산 ${expanded} ${district}` : '',
      '한국폴리텍대학 부산캠퍼스',
    );
  }

  return normalizedQueryList(queries);
}

function districtTokens(rawLandmark: string) {
  return rawLandmark
    .split(/\s+/)
    .filter((token) => /^[가-힣]+구$/.test(token));
}

export function landmarkCandidateScore(rawLandmark: string, item: any) {
  const lat = Number(item?.y);
  const lng = Number(item?.x);
  if (!isBusanCoordinates(lat, lng)) return Number.NEGATIVE_INFINITY;

  const rawTokens = rawLandmark
    .replace(/^(?:부산광역시|부산시|부산)\s*/u, '')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);

  const name = String(item?.place_name || '');
  const address =
    `${String(item?.road_address_name || '')} ${String(item?.address_name || '')}`;
  const normalizedName = normalizePlaceLookupText(name);
  const normalizedAddress = normalizePlaceLookupText(address);
  const normalizedHaystack = `${normalizedName}${normalizedAddress}`;

  let score = 0;

  for (const token of rawTokens) {
    const normalizedToken = normalizePlaceLookupText(token);
    if (!normalizedToken) continue;

    if (normalizedName.includes(normalizedToken)) {
      score += /^[가-힣]+구$/.test(token) ? 18 : 48;
    } else if (normalizedHaystack.includes(normalizedToken)) {
      score += /^[가-힣]+구$/.test(token) ? 32 : 20;
    }
  }

  for (const district of districtTokens(rawLandmark)) {
    if (address.includes(district)) score += 45;
    else score -= 35;
  }

  if (/폴리텍/.test(rawLandmark) && /폴리텍/.test(name)) score += 70;
  if (/대학/.test(rawLandmark) && /대학/.test(name)) score += 15;
  if (/캠퍼스/.test(name)) score += 8;

  return score;
}

async function resolveAdministrative(
  kakao: any,
  rawLandmark: string,
): Promise<LandmarkResolveResult> {
  const queries = busanScopedQueries(rawLandmark);
  const seen = new Set<string>();
  let candidateCount = 0;
  let busanCandidateCount = 0;
  let regionMismatchCount = 0;

  for (const analyzeType of ['EXACT', 'SIMILAR'] as const) {
    for (const query of queries) {
      const results = await kakaoAddressSearch(kakao, query, analyzeType, 30);
      candidateCount += results.length;

      for (const item of results) {
        const coords = candidateCoordinates(item);
        if (!coords) continue;

        const key = `${coords.lat}|${coords.lng}|${candidateAddressName(item)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        busanCandidateCount += 1;

        const regions = await kakaoCoord2RegionCode(
          kakao,
          coords.lng,
          coords.lat,
        );

        if (!regionMatchesInput(rawLandmark, regions)) {
          regionMismatchCount += 1;
          continue;
        }

        const canonicalName = canonicalRegionName(
          rawLandmark,
          item,
          regions,
        );

        return {
          ok: true,
          rawLandmark,
          name: canonicalName,
          canonicalName,
          lat: coords.lat,
          lng: coords.lng,
          score: analyzeType === 'EXACT' ? 100 : 90,
          queries,
          candidateCount,
          kind: 'administrative',
          method: 'geocoder',
          confidence: analyzeType === 'EXACT' ? 'high' : 'medium',
        };
      }
    }
  }

  if (candidateCount === 0) {
    return {
      ok: false,
      rawLandmark,
      reason: 'ADDRESS_NOT_FOUND',
      queries,
      candidateCount: 0,
      bestScore: null,
      kind: 'administrative',
      method: 'geocoder',
    };
  }

  if (busanCandidateCount === 0) {
    return {
      ok: false,
      rawLandmark,
      reason: 'OUTSIDE_BUSAN',
      queries,
      candidateCount,
      bestScore: null,
      kind: 'administrative',
      method: 'geocoder',
    };
  }

  return {
    ok: false,
    rawLandmark,
    reason: regionMismatchCount > 0 ? 'REGION_MISMATCH' : 'AMBIGUOUS_REGION',
    queries,
    candidateCount,
    bestScore: null,
    kind: 'administrative',
    method: 'geocoder',
  };
}

async function resolveAddress(
  kakao: any,
  rawLandmark: string,
): Promise<LandmarkResolveResult> {
  const queries = busanScopedQueries(rawLandmark);
  let candidateCount = 0;

  for (const analyzeType of ['EXACT', 'SIMILAR'] as const) {
    for (const query of queries) {
      const results = await kakaoAddressSearch(kakao, query, analyzeType, 30);
      candidateCount += results.length;

      for (const item of results) {
        const coords = candidateCoordinates(item);
        if (!coords) continue;

        const regions = await kakaoCoord2RegionCode(
          kakao,
          coords.lng,
          coords.lat,
        );
        if (!isBusanRegion(regions)) continue;

        const canonicalName =
          candidateAddressName(item) ||
          String(
            regions.find((region) => region?.region_type === 'B')
              ?.address_name || rawLandmark,
          ).trim();

        return {
          ok: true,
          rawLandmark,
          name: canonicalName || rawLandmark,
          canonicalName: canonicalName || rawLandmark,
          lat: coords.lat,
          lng: coords.lng,
          score: analyzeType === 'EXACT' ? 100 : 85,
          queries,
          candidateCount,
          kind: 'address',
          method: 'geocoder',
          confidence: analyzeType === 'EXACT' ? 'high' : 'medium',
        };
      }
    }
  }

  return {
    ok: false,
    rawLandmark,
    reason: candidateCount > 0 ? 'OUTSIDE_BUSAN' : 'ADDRESS_NOT_FOUND',
    queries,
    candidateCount,
    bestScore: null,
    kind: 'address',
    method: 'geocoder',
  };
}

async function resolvePoi(
  kakao: any,
  rawLandmark: string,
): Promise<LandmarkResolveResult> {
  const queries = buildLandmarkQueries(rawLandmark);
  const candidates: any[] = [];
  const seen = new Set<string>();

  for (const query of queries) {
    const results = await kakaoKeywordSearch(kakao, query, 15);

    for (const item of results) {
      const key =
        `${item?.id || ''}|${item?.x || ''}|${item?.y || ''}|${item?.place_name || ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push(item);
    }
  }

  if (candidates.length === 0) {
    return {
      ok: false,
      rawLandmark,
      reason: 'NO_RESULTS',
      queries,
      candidateCount: 0,
      bestScore: null,
      kind: 'poi',
      method: 'places',
    };
  }

  const busanCandidates = candidates.filter((item) =>
    isBusanCoordinates(Number(item?.y), Number(item?.x)),
  );

  if (busanCandidates.length === 0) {
    return {
      ok: false,
      rawLandmark,
      reason: 'OUTSIDE_BUSAN',
      queries,
      candidateCount: candidates.length,
      bestScore: null,
      kind: 'poi',
      method: 'places',
    };
  }

  const ranked = busanCandidates
    .map((item) => ({
      item,
      score: landmarkCandidateScore(rawLandmark, item),
    }))
    .filter((entry) => Number.isFinite(entry.score))
    .sort((a, b) => b.score - a.score);

  const best = ranked[0];

  if (!best || best.score < 55) {
    return {
      ok: false,
      rawLandmark,
      reason: 'LOW_CONFIDENCE',
      queries,
      candidateCount: busanCandidates.length,
      bestScore: best?.score ?? null,
      kind: 'poi',
      method: 'places',
    };
  }

  const name =
    String(best.item?.place_name || rawLandmark).trim() || rawLandmark;

  return {
    ok: true,
    rawLandmark,
    name,
    canonicalName: name,
    lat: Number(best.item?.y),
    lng: Number(best.item?.x),
    score: best.score,
    queries,
    candidateCount: busanCandidates.length,
    kind: 'poi',
    method: 'places',
    confidence: best.score >= 90 ? 'high' : 'medium',
  };
}

export async function resolveNearbyLandmark(
  appKey: string,
  message: string,
): Promise<LandmarkResolveResult> {
  const rawLandmark = extractNearbyLandmark(message);

  if (!rawLandmark) {
    return {
      ok: false,
      rawLandmark: '',
      reason: 'NOT_NEARBY_REQUEST',
      queries: [],
      candidateCount: 0,
      bestScore: null,
      kind: 'unknown',
      method: null,
    };
  }

  const kind = classifyLocationText(rawLandmark);

  let kakao: any;
  try {
    kakao = await loadKakaoMapSdk(appKey);
  } catch {
    return {
      ok: false,
      rawLandmark,
      reason: 'SDK_UNAVAILABLE',
      queries: [],
      candidateCount: 0,
      bestScore: null,
      kind,
      method: null,
    };
  }

  if (kind === 'administrative') {
    return await resolveAdministrative(kakao, rawLandmark);
  }

  if (kind === 'address') {
    return await resolveAddress(kakao, rawLandmark);
  }

  return await resolvePoi(kakao, rawLandmark);
}
