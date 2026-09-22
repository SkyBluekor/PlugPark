const BASE_URL = process.env.PLUGPARK_URL || 'https://plugpark.dtdt4865.workers.dev';
const EXPECTED_VERSION = 'v0.6.2';

async function getJson(path) {
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { throw new Error(`${path}: JSON 아님 (HTTP ${response.status})`); }
  if (!response.ok || data?.ok === false) {
    throw new Error(`${path}: ${data?.error || data?.message || `HTTP ${response.status}`}`);
  }
  return data;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

console.log('\n[1/3] D1 read model 상태 확인');
const state = await getJson('/api/d1/read-model-state?v=62');
assert(state.dataLayerVersion === EXPECTED_VERSION, `버전 불일치: ${state.dataLayerVersion}`);
assert(state.ready === true, 'read model ready=true가 아닙니다.');
assert(Number(state.parkingCount) > 0, 'parkingCount가 0입니다.');
assert(Number(state.chargerCount) > 30000, `active chargerCount가 너무 작습니다: ${state.chargerCount}`);
assert(Number(state.stationCount) > 4000, `stationCount가 너무 작습니다: ${state.stationCount}`);
console.log(`  PASS · 주차장 ${state.parkingCount} · 활성 충전기 ${state.chargerCount} · 충전소 ${state.stationCount} · 매칭 주차장 ${state.matchedParkingCount}`);

console.log('[2/3] /api/places D1 read path 확인');
const places = await getJson('/api/places?v=62');
assert(places.dataLayerVersion === EXPECTED_VERSION, `places 버전 불일치: ${places.dataLayerVersion}`);
assert(places.dataSource === 'd1-read-model', `dataSource 불일치: ${places.dataSource}`);
assert(places.upstreamEvCalls === 0, `upstreamEvCalls가 0이 아닙니다: ${places.upstreamEvCalls}`);
assert(Array.isArray(places.places) && places.places.length > 0, 'places 결과가 비어 있습니다.');
console.log(`  PASS · ${places.places.length}곳 반환 · EV upstream 호출 경로 0`);

console.log('[3/3] 센텀 매칭 진단');
const centum = await getJson('/api/d1/match-debug?q=%EC%84%BC%ED%85%80');
assert(Array.isArray(centum.items) && centum.items.length > 0, '센텀 관련 주차장/충전소를 찾지 못했습니다.');
const linked = centum.items.filter((item) => item.stat_id);
console.log(`  PASS · 센텀 관련 ${centum.items.length}행 · 실제 EV 연결 ${linked.length}행`);

console.log('\n✅ PlugPark v0.6.2 remote smoke verify 완료');
