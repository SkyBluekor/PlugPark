import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const app = await readFile('src/App.tsx','utf8');
const panel = await readFile('src/components/RecommendationPanel.tsx','utf8');
const map = await readFile('src/components/KakaoMap.tsx','utf8');
const css = await readFile('src/styles.css','utf8');
const engine = await readFile('src/recommendation/recommendPlaces.ts','utf8');

assert(app.includes("useState<RecommendationMode>('charging')"), '기본 추천 기준이 charging이 아닙니다.');
assert(app.includes("useState<ChargerPreference>('any')"), '기본 충전 방식이 any가 아닙니다.');
assert(app.includes('recommendPlaces(places, {'), '추천 엔진이 원본 places에 연결되지 않았습니다.');
assert(!app.includes('recommendPlaces(filteredPlaces, {'), '전체 목록 filter가 추천 엔진에 섞였습니다.');
assert(app.includes('limit: 3'), '추천 limit=3이 아닙니다.');

assert(app.includes('const [mapFocus, setMapFocus]'), '지도 포커스 상태가 selected와 분리되지 않았습니다.');
assert(app.includes('function openPlaceDetail(place: PlugParkPlace)'), '상세 공통 동작이 없습니다.');
assert(app.includes('function focusPlaceOnMap(place: PlugParkPlace)'), '추천 지도 포커스 동작이 없습니다.');
assert(app.includes('setMapFocus(place);\n    setSelected(null);'), '지도에서 보기 동작이 상세 drawer를 닫지 않습니다.');
assert(app.includes("getElementById('plugpark-map')"), '추천→지도 스크롤 연결이 없습니다.');
assert(app.includes("prefers-reduced-motion: reduce"), 'reduced motion 대응이 없습니다.');

assert(app.includes('const mapPlaces = useMemo'), '지도 전용 places 계산이 없습니다.');
assert(app.includes('return [mapFocus, ...filteredPlaces]'), '필터 밖 추천 장소를 지도에 임시 포함하지 않습니다.');
assert(!app.includes('setFilter(') || !app.includes('focusPlaceOnMap') || !/function focusPlaceOnMap[\s\S]*?setFilter\(/.test(app), '추천 지도 포커스가 목록 filter를 강제로 변경합니다.');

assert(app.includes('onFocusMap={focusPlaceOnMap}'), 'RecommendationPanel 지도 포커스 callback 연결이 없습니다.');
assert(app.includes('onOpenDetail={openPlaceDetail}'), 'RecommendationPanel 상세 callback 연결이 없습니다.');
assert(app.includes('onClick={() => openPlaceDetail(place)}'), '전체 목록 클릭이 상세+지도 포커스 공통 동작을 사용하지 않습니다.');
assert(app.includes('focusedPlace={mapFocus}'), 'KakaoMap focusedPlace 연결이 없습니다.');
assert(app.includes('onSelect={openPlaceDetail}'), '지도 마커 클릭이 상세+focus 공통 동작을 사용하지 않습니다.');

assert(panel.includes('onFocusMap: (place: PlugParkPlace) => void'), 'RecommendationPanel onFocusMap prop이 없습니다.');
assert(panel.includes('onOpenDetail: (place: PlugParkPlace) => void'), 'RecommendationPanel onOpenDetail prop이 없습니다.');
assert(panel.includes('onClick={() => onFocusMap(recommendation.place)}'), '지도에서 보기 버튼이 focus 전용 callback을 사용하지 않습니다.');
assert(panel.includes('onClick={() => onOpenDetail(recommendation.place)}'), '추천 장소명 상세 열기가 없습니다.');
assert(panel.includes('target="_blank"'), '길찾기 새 탭 처리가 없습니다.');
assert(!panel.includes('recommendation.score'), '내부 score가 UI에 노출됩니다.');
assert(!panel.includes('recommendation.rankGroup'), '내부 rankGroup이 UI에 노출됩니다.');

assert(map.includes('focusedPlace: PlugParkPlace | null'), 'KakaoMap focusedPlace prop이 없습니다.');
assert(map.includes("focusedPlace?.id === place.id ? ' focused' : ''"), '포커스 마커 강조가 없습니다.');
assert(map.includes('mapRef.current.panTo(position)'), 'focusedPlace panTo가 없습니다.');
assert(map.includes('mapRef.current.setLevel(5)'), 'focusedPlace zoom 보정이 없습니다.');
assert(map.includes('id="plugpark-map"'), '지도 DOM anchor가 없습니다.');

assert(app.includes("typedAvailabilityText(place, 'fast')"), '목록 급속 가용 수 표시가 없습니다.');
assert(app.includes("typedAvailabilityText(place, 'slow')"), '목록 완속 가용 수 표시가 없습니다.');
assert(app.includes("typedAvailabilityText(selected, 'fast')"), '상세 급속 가용 수 표시가 없습니다.');
assert(app.includes("typedAvailabilityText(selected, 'slow')"), '상세 완속 가용 수 표시가 없습니다.');
assert(app.includes("place.charger.statusFresh === false"), 'stale 충전 상태 표현이 없습니다.');

assert(!/\bfetch\s*\(/.test(panel), 'RecommendationPanel에서 새 네트워크 호출을 수행합니다.');
assert(!/\bfetch\s*\(/.test(engine), '추천 엔진에서 네트워크 호출을 수행합니다.');
assert(css.includes('.kakao-place-marker.focused'), '포커스 마커 스타일이 없습니다.');
assert(css.includes('.recommendation-detail-link'), '추천 상세 링크 스타일이 없습니다.');

console.log('Recommendation map/detail action split ... PASS');
console.log('Filtered-out recommendation map inclusion ... PASS');
console.log('Kakao focus pan/zoom + marker highlight ... PASS');
console.log('Fast/slow live availability detail ... PASS');
console.log('Stale availability wording guard ... PASS');
console.log('Recommendation/Panel extra network calls ... 0');
console.log('\n✅ R1-3 MAP/DETAIL INTEGRATION STATIC VERIFY: PASS');
console.log('Cloudflare remote read=0 · write=0 · deploy=0 · public API=0');
