import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const app = await readFile('src/App.tsx','utf8');
const panel = await readFile('src/components/RecommendationPanel.tsx','utf8');
const css = await readFile('src/styles.css','utf8');

assert(app.includes("useState<RecommendationMode>('charging')"), '기본 추천 기준이 charging이 아닙니다.');
assert(app.includes("useState<ChargerPreference>('any')"), '기본 충전 방식이 any가 아닙니다.');
assert(app.includes('recommendPlaces(places, {'), '추천 엔진이 원본 places에 연결되지 않았습니다.');
assert(!app.includes('recommendPlaces(filteredPlaces, {'), '전체 목록 filter가 추천 엔진에 섞였습니다.');
assert(app.includes('limit: 3'), '추천 limit=3이 아닙니다.');
assert(app.includes('<RecommendationPanel'), 'RecommendationPanel이 App에 연결되지 않았습니다.');
assert(app.includes('onSelectPlace={setSelected}'), '추천 장소가 기존 selected 상태와 연결되지 않았습니다.');
assert(app.includes('getDirectionsUrl={kakaoDirectionsUrl}'), '기존 Kakao 길찾기 URL을 재사용하지 않습니다.');

assert(panel.includes('aria-labelledby="recommendation-title"'), '추천 section 접근성 label이 없습니다.');
assert(panel.includes('aria-pressed={mode ==='), '추천 기준 aria-pressed가 없습니다.');
assert(panel.includes("mode === 'charging'"), '충전 방식 조건부 표시가 없습니다.');
assert(panel.includes('recommendation.reasons'), '추천 이유를 표시하지 않습니다.');
assert(panel.includes('recommendation.warnings'), '추천 warning을 표시하지 않습니다.');
assert(panel.includes('<a'), '길찾기가 실제 링크가 아닙니다.');
assert(panel.includes('target="_blank"'), '길찾기 새 탭 처리가 없습니다.');
assert(!panel.includes('recommendation.score'), '내부 score가 UI에 노출됩니다.');
assert(!panel.includes('recommendation.rankGroup'), '내부 rankGroup이 UI에 노출됩니다.');
assert(!/\bfetch\s*\(/.test(panel), 'RecommendationPanel에서 네트워크 호출을 수행합니다.');

for (const selector of [
  '.recommendation-panel',
  '.recommendation-row',
  '.recommendation-controls',
  '.recommendation-actions',
]) {
  assert(css.includes(selector), `${selector} 스타일이 없습니다.`);
}

assert(css.includes('@media(max-width:560px)'), '모바일 레이아웃 규칙이 없습니다.');

console.log('RecommendationPanel wiring ... PASS');
console.log('Recommendation controls/accessibility ... PASS');
console.log('Recommendation reasons/warnings ... PASS');
console.log('Map selection + Kakao directions reuse ... PASS');
console.log('Internal score/rankGroup hidden ... PASS');
console.log('Recommendation UI network calls ... 0');
console.log('\n✅ R1-2 RECOMMENDATION UI STATIC VERIFY: PASS');
console.log('Cloudflare remote read=0 · write=0 · deploy=0 · public API=0');
