import type { PlugParkPlace } from '../types';
import type {
  ChargerPreference,
  PlaceRecommendation,
  RecommendationOptions,
} from './recommendationTypes';

const EARTH_RADIUS_METERS = 6_371_000;
const DEFAULT_LIMIT = 3;

function toRad(value: number) {
  return (value * Math.PI) / 180;
}

export function recommendationDistanceMeters(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
) {
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) *
      Math.cos(toRad(bLat)) *
      Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(h));
}

function nonNegative(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function positive(value: number | null | undefined) {
  const valid = nonNegative(value);
  return valid != null && valid > 0 ? valid : 0;
}

function parkingAvailability(place: PlugParkPlace) {
  return nonNegative(place.availableParking);
}

function parkingCapacity(place: PlugParkPlace) {
  const capacity = nonNegative(place.capacity);
  return capacity != null && capacity > 0 ? capacity : null;
}

function parkingRank(place: PlugParkPlace) {
  const available = parkingAvailability(place);
  if (place.parkingRealtime && place.parkingRealtimeFresh === true && available != null) {
    return available > 0 ? 0 : 99;
  }
  if (place.parkingRealtime && available != null) {
    return available > 0 ? 1 : 3;
  }
  if (parkingCapacity(place) != null) return 2;
  return 3;
}

function chargerInstalled(place: PlugParkPlace, preference: ChargerPreference) {
  if (preference === 'fast') return positive(place.charger.fast);
  if (preference === 'slow') return positive(place.charger.slow);
  return positive(place.charger.total);
}

function chargerAvailable(place: PlugParkPlace, preference: ChargerPreference) {
  if (preference === 'fast') return nonNegative(place.charger.availableFast);
  if (preference === 'slow') return nonNegative(place.charger.availableSlow);
  return nonNegative(place.charger.available);
}

function chargingRank(place: PlugParkPlace, preference: ChargerPreference) {
  const available = chargerAvailable(place, preference);
  if (available != null && available > 0 && place.charger.statusFresh === true) return 0;
  if (available != null && available > 0 && place.charger.statusFresh === false) return 1;
  if (available === 0) return 2;
  return 3;
}

function distanceReason(distanceMeters: number) {
  if (distanceMeters < 1000) return `${Math.round(distanceMeters)}m 거리`;
  return `${(distanceMeters / 1000).toFixed(1)}km 거리`;
}

function parkingMessages(place: PlugParkPlace, reasons: string[], warnings: string[]) {
  const available = parkingAvailability(place);
  const capacity = parkingCapacity(place);

  if (place.parkingRealtime && available != null) {
    if (place.parkingRealtimeFresh === true) {
      if (available > 0) reasons.push(`주차 ${available}면 남음`);
      else warnings.push('현재 실시간 주차 잔여 없음');
      return;
    }

    if (available > 0) reasons.push(`주차 잔여 ${available}면 기록`);
    warnings.push('주차 상태 갱신 지연');
    return;
  }

  if (capacity != null) reasons.push(`주차 총 ${capacity}면`);
  warnings.push('실시간 주차 잔여 미제공');
}

function chargingMessages(
  place: PlugParkPlace,
  preference: ChargerPreference,
  reasons: string[],
  warnings: string[],
) {
  const installed = chargerInstalled(place, preference);
  const available = chargerAvailable(place, preference);
  const label = preference === 'fast' ? '급속' : preference === 'slow' ? '완속' : '충전';

  if (available != null && available > 0 && place.charger.statusFresh === true) {
    reasons.push(`${label} ${available}기 사용 가능`);
    return;
  }

  if (installed > 0) {
    reasons.push(`${label} 충전기 ${installed}기 설치`);
  }

  if (place.charger.statusFresh === false) {
    warnings.push('충전기 상태 갱신 지연');
  } else if (available === 0) {
    warnings.push(`현재 사용 가능한 ${label} 충전기 없음`);
  } else if (available == null) {
    warnings.push(`${label} 충전기 가용 상태 확인 필요`);
  }
}

function scoreParking(place: PlugParkPlace, distanceMeters: number, rankGroup: number) {
  const available = parkingAvailability(place) ?? 0;
  const capacity = parkingCapacity(place);
  const ratio = capacity ? Math.min(1, available / capacity) : 0;
  const chargerBonus = positive(place.charger.available) > 0 ? 8 : 0;
  return (
    1000 -
    rankGroup * 200 +
    Math.min(120, available * 2) +
    ratio * 80 +
    chargerBonus -
    Math.min(150, distanceMeters / 20)
  );
}

function scoreCharging(
  place: PlugParkPlace,
  distanceMeters: number,
  rankGroup: number,
  preference: ChargerPreference,
) {
  const selectedAvailable = chargerAvailable(place, preference) ?? 0;
  const parkRank = parkingRank(place);
  const parkingBonus = parkRank === 0 ? 50 : parkRank === 1 ? 25 : parkRank === 2 ? 10 : 0;
  return (
    1000 -
    rankGroup * 200 +
    parkingBonus +
    Math.min(100, selectedAvailable * 20) -
    Math.min(150, distanceMeters / 20)
  );
}

function compareParking(a: PlaceRecommendation, b: PlaceRecommendation) {
  if (a.rankGroup !== b.rankGroup) return a.rankGroup - b.rankGroup;

  const aAvailable = parkingAvailability(a.place) ?? -1;
  const bAvailable = parkingAvailability(b.place) ?? -1;
  if (aAvailable !== bAvailable) return bAvailable - aAvailable;

  if (a.distanceMeters !== b.distanceMeters) return a.distanceMeters - b.distanceMeters;

  const aCharge = positive(a.place.charger.available);
  const bCharge = positive(b.place.charger.available);
  if (aCharge !== bCharge) return bCharge - aCharge;

  return a.place.name.localeCompare(b.place.name, 'ko');
}

function compareCharging(
  a: PlaceRecommendation,
  b: PlaceRecommendation,
  preference: ChargerPreference,
) {
  if (a.rankGroup !== b.rankGroup) return a.rankGroup - b.rankGroup;

  const aParkingRank = parkingRank(a.place);
  const bParkingRank = parkingRank(b.place);
  if (aParkingRank !== bParkingRank) return aParkingRank - bParkingRank;

  if (a.distanceMeters !== b.distanceMeters) return a.distanceMeters - b.distanceMeters;

  const aAvailable = chargerAvailable(a.place, preference) ?? -1;
  const bAvailable = chargerAvailable(b.place, preference) ?? -1;
  if (aAvailable !== bAvailable) return bAvailable - aAvailable;

  const aTotal = nonNegative(a.place.charger.available) ?? -1;
  const bTotal = nonNegative(b.place.charger.available) ?? -1;
  if (aTotal !== bTotal) return bTotal - aTotal;

  return a.place.name.localeCompare(b.place.name, 'ko');
}

export function recommendPlaces(
  places: readonly PlugParkPlace[],
  options: RecommendationOptions,
): PlaceRecommendation[] {
  const limit = Math.max(1, Math.trunc(options.limit ?? DEFAULT_LIMIT));
  const maxMeters = options.radiusKm == null ? null : options.radiusKm * 1000;
  const candidates: PlaceRecommendation[] = [];

  for (const place of places) {
    if (place.lat == null || place.lng == null) continue;
    if (!Number.isFinite(place.lat) || !Number.isFinite(place.lng)) continue;

    const distanceMeters = recommendationDistanceMeters(
      options.userLat,
      options.userLng,
      place.lat,
      place.lng,
    );
    if (maxMeters != null && distanceMeters > maxMeters) continue;

    // Fresh realtime full parking should not be recommended in either mode.
    if (
      place.parkingRealtime &&
      place.parkingRealtimeFresh === true &&
      parkingAvailability(place) === 0
    ) {
      continue;
    }

    if (options.mode === 'charging' && chargerInstalled(place, options.chargerPreference) <= 0) {
      continue;
    }

    const rankGroup =
      options.mode === 'parking'
        ? parkingRank(place)
        : chargingRank(place, options.chargerPreference);

    const reasons = [distanceReason(distanceMeters)];
    const warnings: string[] = [];

    if (options.mode === 'charging') {
      chargingMessages(place, options.chargerPreference, reasons, warnings);
      parkingMessages(place, reasons, warnings);
    } else {
      parkingMessages(place, reasons, warnings);
      if (positive(place.charger.total) > 0) {
        chargingMessages(place, 'any', reasons, warnings);
      }
    }

    const score =
      options.mode === 'parking'
        ? scoreParking(place, distanceMeters, rankGroup)
        : scoreCharging(place, distanceMeters, rankGroup, options.chargerPreference);

    candidates.push({
      place,
      distanceMeters,
      rankGroup,
      score,
      reasons,
      warnings: [...new Set(warnings)],
    });
  }

  const sorted = [...candidates].sort((a, b) =>
    options.mode === 'parking'
      ? compareParking(a, b)
      : compareCharging(a, b, options.chargerPreference),
  );

  return sorted.slice(0, limit);
}
