import { readFile } from 'node:fs/promises';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const worker = await readFile('worker/index.ts', 'utf8');

const placesStart = worker.indexOf('async function handlePlaces');
const placesEnd = worker.indexOf('/* -------------------------------------------------------------------------- */\n/* v0.7.0 live data sync', placesStart);
assert(placesStart >= 0 && placesEnd > placesStart, 'handlePlaces 영역을 찾지 못했습니다.');
const places = worker.slice(placesStart, placesEnd);

assert(places.includes('getLiveFreshnessState(env.DB, env)'), 'public /api/places가 lightweight freshness state를 사용하지 않습니다.');
assert(!places.includes('getLiveState(env.DB, env)'), 'public /api/places에서 expensive getLiveState 호출이 남아 있습니다.');

const readModelStart = worker.indexOf('async function getReadModelState');
const readModelEnd = worker.indexOf('function readRowToPlace', readModelStart);
assert(readModelStart >= 0 && readModelEnd > readModelStart, 'getReadModelState 영역을 찾지 못했습니다.');
const readModel = worker.slice(readModelStart, readModelEnd);
assert(!readModel.includes('FROM ev_chargers'), 'getReadModelState에서 ev_chargers full scan이 남아 있습니다.');
assert(readModel.includes("jobByName.get('ev_info')?.reported_total_count"), 'EV charger count가 persisted sync metadata를 사용하지 않습니다.');

const freshnessStart = worker.indexOf('async function getLiveFreshnessState');
const freshnessEnd = worker.indexOf('async function getLiveState', freshnessStart);
assert(freshnessStart >= 0 && freshnessEnd > freshnessStart, 'getLiveFreshnessState 영역을 찾지 못했습니다.');
const freshness = worker.slice(freshnessStart, freshnessEnd);
assert(!freshness.includes('ev_chargers'), 'lightweight freshness helper가 ev_chargers를 읽습니다.');
assert(!freshness.includes('FROM ev_status'), 'lightweight freshness helper가 ev_status table을 직접 읽습니다.');
assert(freshness.includes('FROM sync_state'), 'lightweight freshness helper가 sync_state를 사용하지 않습니다.');

console.log('Public /api/places large-table count scan ... PASS · removed');
console.log('Read-model state ev_chargers scan ... PASS · removed');
console.log('EV freshness source ... PASS · sync_state metadata');
console.log('\n✅ v0.7.2-P2 D1 READ BUDGET STATIC VERIFY: PASS');
console.log('Remote D1 read=0 · Remote D1 write=0');
