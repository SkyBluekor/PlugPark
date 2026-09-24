import type { ChargerSummary } from '../types';

export type ChargerKind = 'fast' | 'slow';
export type ChargerPreferenceView = 'any' | ChargerKind;

const RESTRICTED_ACCESS_PATTERN = /(입주민|입주자|거주자|직원|관계자|회원|사내)\s*전용/i;

function safeCount(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

export function hasRestrictedChargerAccess(charger: ChargerSummary) {
  return charger.stations.some((station) => RESTRICTED_ACCESS_PATTERN.test(station));
}

export function chargerAvailabilityText(charger: ChargerSummary, kind: ChargerKind) {
  const label = kind === 'fast' ? '급속' : '완속';
  const installed = safeCount(kind === 'fast' ? charger.fast : charger.slow) ?? 0;
  const available = safeCount(kind === 'fast' ? charger.availableFast : charger.availableSlow);

  if (installed <= 0) return `인근 ${label} 없음`;

  if (charger.statusFresh === true && available != null) {
    return `인근 ${label} 충전 가능 상태 ${available}기 / 주변 총 ${installed}기`;
  }
  if (charger.statusFresh === false) {
    return `인근 ${label} ${installed}기 · 상태 갱신 지연`;
  }
  return `인근 ${label} ${installed}기 · 현재 상태 확인 필요`;
}

export function chargerSelectionText(
  charger: ChargerSummary,
  preference: ChargerPreferenceView,
) {
  if (preference === 'fast' || preference === 'slow') {
    return chargerAvailabilityText(charger, preference);
  }

  const installed = safeCount(charger.total) ?? 0;
  const available = safeCount(charger.available);
  if (installed <= 0) return '인근 EV 충전정보 없음';

  if (charger.statusFresh === true && available != null) {
    return `인근 충전 가능 상태 ${available}기 / 주변 총 ${installed}기`;
  }
  if (charger.statusFresh === false) {
    return `인근 충전기 ${installed}기 · 상태 갱신 지연`;
  }
  return `인근 충전기 ${installed}기 · 현재 상태 확인 필요`;
}
