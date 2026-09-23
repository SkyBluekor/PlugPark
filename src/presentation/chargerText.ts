import type { ChargerSummary } from '../types';

export type ChargerKind = 'fast' | 'slow';
export type ChargerPreferenceView = 'any' | ChargerKind;

function safeCount(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

export function chargerAvailabilityText(charger: ChargerSummary, kind: ChargerKind) {
  const label = kind === 'fast' ? '급속' : '완속';
  const installed = safeCount(kind === 'fast' ? charger.fast : charger.slow) ?? 0;
  const available = safeCount(kind === 'fast' ? charger.availableFast : charger.availableSlow);

  if (installed <= 0) return `${label} 없음`;

  if (charger.statusFresh === true && available != null) {
    return `${label} ${available}기 가능 / 총 ${installed}기`;
  }
  if (charger.statusFresh === false) {
    return `${label} ${installed}기 설치 · 상태 갱신 지연`;
  }
  return `${label} ${installed}기 설치 · 현재 상태 확인 필요`;
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
  if (installed <= 0) return 'EV 충전정보 없음';

  if (charger.statusFresh === true && available != null) {
    return `충전 ${available}기 가능 / 총 ${installed}기`;
  }
  if (charger.statusFresh === false) {
    return `충전기 ${installed}기 설치 · 상태 갱신 지연`;
  }
  return `충전기 ${installed}기 설치 · 현재 상태 확인 필요`;
}
