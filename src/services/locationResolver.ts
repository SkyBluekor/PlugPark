import {
  isBusanCoordinates,
  kakaoKeywordSearch,
  loadKakaoMapSdk,
} from './kakaoSdk';
import { extractNearbyLandmark } from './locationIntent';

export { replaceNearbyLandmark } from './locationIntent';

export type LandmarkResolveFailure =
  | 'NOT_NEARBY_REQUEST'
  | 'SDK_UNAVAILABLE'
  | 'NO_RESULTS'
  | 'OUTSIDE_BUSAN'
  | 'LOW_CONFIDENCE';

export type LandmarkResolveResult =
  | {
      ok: true;
      rawLandmark: string;
      name: string;
      lat: number;
      lng: number;
      score: number;
      queries: string[];
      candidateCount: number;
    }
  | {
      ok: false;
      rawLandmark: string;
      reason: LandmarkResolveFailure;
      queries: string[];
      candidateCount: number;
      bestScore: number | null;
    };

function normalizePlaceLookupText(value: string) {
  return String(value || '')
    .toLowerCase()
    .replace(/부산광역시|부산시/g, '부산')
    .replace(/[\s,\.·ㆍ()\[\]{}\-_\/]/g, '')
    .trim();
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

  return [...new Set(queries.map((query) => query.trim()).filter(Boolean))];
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
    };
  }

  const queries = buildLandmarkQueries(rawLandmark);

  let kakao: any;
  try {
    kakao = await loadKakaoMapSdk(appKey);
  } catch {
    return {
      ok: false,
      rawLandmark,
      reason: 'SDK_UNAVAILABLE',
      queries,
      candidateCount: 0,
      bestScore: null,
    };
  }

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
    };
  }

  return {
    ok: true,
    rawLandmark,
    name: String(best.item?.place_name || rawLandmark).trim() || rawLandmark,
    lat: Number(best.item?.y),
    lng: Number(best.item?.x),
    score: best.score,
    queries,
    candidateCount: busanCandidates.length,
  };
}
