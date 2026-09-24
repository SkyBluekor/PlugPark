import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import ts from 'typescript';

const source = await readFile(resolve('src','recommendation','recommendPlaces.ts'),'utf8');
const js = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ES2022,
    verbatimModuleSyntax: false,
  },
  fileName: 'recommendPlaces.ts',
}).outputText;

await mkdir(resolve('.plugpark'), { recursive: true });
const runtimePath = resolve('.plugpark','recommendPlaces.r1-runtime.mjs');
await writeFile(runtimePath, js, 'utf8');
const { recommendPlaces } = await import(`file:///${runtimePath.replace(/\\/g,'/') }?v=${Date.now()}`);

function basePlace(overrides = {}) {
  const place = {
    id: 'base',
    name: '기본 주차장',
    address: '부산광역시 테스트',
    agency: '테스트',
    lat: 35.1,
    lng: 129.0,
    capacity: 100,
    availableParking: 20,
    occupiedParking: 80,
    feeText: '',
    operationText: '',
    parkingUpdatedAt: '2026-09-23T00:00:00.000Z',
    parkingRealtime: true,
    parkingRealtimeFresh: true,
    parkingSource: 'merged',
    charger: {
      total: 4,
      available: 2,
      availableFast: 1,
      availableSlow: 1,
      charging: 1,
      unavailable: 1,
      fast: 2,
      slow: 2,
      stations: ['테스트충전소'],
      nearestDistanceMeters: 10,
      lastUpdated: '2026-09-23T00:00:00.000Z',
      statusFresh: true,
      matchConfidence: 'high',
    },
    source: 'live',
  };
  return {
    ...place,
    ...overrides,
    charger: { ...place.charger, ...(overrides.charger || {}) },
  };
}

const origin = { userLat:35.1, userLng:129.0 };
function opts(overrides={}) {
  return { mode:'charging', chargerPreference:'any', radiusKm:3, ...origin, ...overrides };
}
function northMeters(m) {
  return 35.1 + m / 111000;
}

let passed=0;
async function test(name, fn) {
  try { await fn(); passed += 1; console.log('PASS', name); }
  catch (error) { console.error('FAIL', name); throw error; }
}

const originalFetch = globalThis.fetch;
let fetchCalls = 0;
globalThis.fetch = async () => { fetchCalls += 1; throw new Error('recommendation must not fetch'); };

await test('01 좌표 없는 장소 제외', () => {
  const p=basePlace({id:'x',lat:null});
  assert.equal(recommendPlaces([p],opts()).length,0);
});

await test('02 반경 밖 제외', () => {
  const p=basePlace({id:'far',lat:northMeters(4000)});
  assert.equal(recommendPlaces([p],opts({radiusKm:3})).length,0);
});

await test('03 fresh 만차 제외', () => {
  const p=basePlace({id:'full',availableParking:0,parkingRealtime:true,parkingRealtimeFresh:true});
  assert.equal(recommendPlaces([p],opts()).length,0);
});

await test('04 실시간 주차 미제공은 완전 제외하지 않음', () => {
  const p=basePlace({id:'no-live',parkingRealtime:false,parkingRealtimeFresh:false,availableParking:null});
  assert.equal(recommendPlaces([p],opts({mode:'parking'})).length,1);
});

await test('05 충전 우선에서 EV 충전기 없는 곳 제외', () => {
  const p=basePlace({id:'no-ev',charger:{total:0,available:0,fast:0,slow:0,availableFast:0,availableSlow:0}});
  assert.equal(recommendPlaces([p],opts()).length,0);
});

await test('06 급속 우선에서 fast=0 제외', () => {
  const p=basePlace({id:'no-fast',charger:{fast:0,availableFast:0}});
  assert.equal(recommendPlaces([p],opts({chargerPreference:'fast'})).length,0);
});

await test('07 완속 우선에서 slow=0 제외', () => {
  const p=basePlace({id:'no-slow',charger:{slow:0,availableSlow:0}});
  assert.equal(recommendPlaces([p],opts({chargerPreference:'slow'})).length,0);
});

await test('08 availableFast 2 > availableFast 0', () => {
  const zero=basePlace({id:'zero',name:'제로',lat:northMeters(100),charger:{availableFast:0,fast:2}});
  const two=basePlace({id:'two',name:'투',lat:northMeters(700),charger:{availableFast:2,available:2,fast:2}});
  const r=recommendPlaces([zero,two],opts({chargerPreference:'fast'}));
  assert.equal(r[0].place.id,'two');
});

await test('09 availableSlow 1 > availableSlow 0', () => {
  const zero=basePlace({id:'zero',lat:northMeters(100),charger:{availableSlow:0,slow:2}});
  const one=basePlace({id:'one',lat:northMeters(500),charger:{availableSlow:1,available:1,slow:2}});
  const r=recommendPlaces([zero,one],opts({chargerPreference:'slow'}));
  assert.equal(r[0].place.id,'one');
});

await test('10 fresh 충전 상태 > stale 상태', () => {
  const stale=basePlace({id:'stale',lat:northMeters(100),charger:{availableFast:1,statusFresh:false}});
  const fresh=basePlace({id:'fresh',lat:northMeters(600),charger:{availableFast:1,statusFresh:true}});
  const r=recommendPlaces([stale,fresh],opts({chargerPreference:'fast'}));
  assert.equal(r[0].place.id,'fresh');
});

await test('11 충전 가능 장소가 조금 멀어도 충전 불가보다 우선', () => {
  const no=basePlace({id:'no',lat:northMeters(100),charger:{available:0,total:4,statusFresh:true}});
  const yes=basePlace({id:'yes',lat:northMeters(700),charger:{available:1,total:4,statusFresh:true}});
  assert.equal(recommendPlaces([no,yes],opts())[0].place.id,'yes');
});

await test('12 주차 우선에서 실제 잔여 있는 장소 우선', () => {
  const unknown=basePlace({id:'unknown',lat:northMeters(50),parkingRealtime:false,availableParking:null,capacity:200});
  const live=basePlace({id:'live',lat:northMeters(600),availableParking:8,capacity:20,parkingRealtime:true,parkingRealtimeFresh:true});
  assert.equal(recommendPlaces([unknown,live],opts({mode:'parking'}))[0].place.id,'live');
});

await test('13 음수 주차값 방어', () => {
  const neg=basePlace({id:'neg',availableParking:-10,parkingRealtime:true,parkingRealtimeFresh:false});
  const r=recommendPlaces([neg],opts({mode:'parking'}));
  assert.equal(r.length,1);
  assert.ok(!r[0].reasons.some(x=>x.includes('-10')));
});

await test('14 음수 charger 값 방어', () => {
  const neg=basePlace({id:'neg-charge',charger:{available:-2,availableFast:-2,total:2,fast:2,statusFresh:true}});
  const r=recommendPlaces([neg],opts({chargerPreference:'fast'}));
  assert.equal(r.length,1);
  assert.ok(!r[0].reasons.some(x=>x.includes('-2')));
});

await test('15 동일 등급이면 가까운 곳 우선', () => {
  const near=basePlace({id:'near',lat:northMeters(100)});
  const far=basePlace({id:'far',lat:northMeters(700)});
  assert.equal(recommendPlaces([far,near],opts())[0].place.id,'near');
});

await test('16 후보 2곳이면 정확히 2개 반환', () => {
  const a=basePlace({id:'a',lat:northMeters(100)});
  const b=basePlace({id:'b',lat:northMeters(200)});
  assert.equal(recommendPlaces([a,b],opts()).length,2);
});

await test('17 기본 limit=3 보장', () => {
  const items=[1,2,3,4,5].map((n)=>basePlace({id:String(n),lat:northMeters(n*100)}));
  assert.equal(recommendPlaces(items,opts()).length,3);
});

await test('18 입력 배열과 객체를 mutate하지 않음', () => {
  const items=[basePlace({id:'immutable'}),basePlace({id:'immutable2',lat:northMeters(200)})];
  const before=JSON.stringify(items);
  recommendPlaces(items,opts());
  assert.equal(JSON.stringify(items),before);
});

await test('19 추천 계산 중 API 호출 없음', () => {
  const before=fetchCalls;
  recommendPlaces([basePlace()],opts());
  assert.equal(fetchCalls,before);
});

await test('20 추천 엔진에 D1/Worker 의존 없음', async () => {
  const src=await readFile(resolve('src','recommendation','recommendPlaces.ts'),'utf8');
  assert.equal(/\bD1\b|env\.DB|wrangler|\/api\//i.test(src),false);
});

await test('21 stale 상태에서는 사용 가능 단정 문구 금지', () => {
  const p=basePlace({id:'stale-msg',charger:{availableFast:2,fast:3,statusFresh:false}});
  const [r]=recommendPlaces([p],opts({chargerPreference:'fast'}));
  assert.ok(r.reasons.includes('인근 급속 충전기 3기 설치'));
  assert.ok(!r.reasons.some(x=>x.includes('2기 사용 가능')));
  assert.ok(r.warnings.includes('충전기 상태 갱신 지연'));
});

await test('22 availableFast + availableSlow 계약 fixture 확인', () => {
  const p=basePlace({charger:{available:3,availableFast:2,availableSlow:1}});
  assert.equal(p.charger.availableFast+p.charger.availableSlow,p.charger.available);
});

await test('23 이용 제한 충전소 경고', () => {
  const p=basePlace({charger:{stations:['테스트아파트 입주민 전용 충전소']}});
  const [r]=recommendPlaces([p],opts());
  assert.ok(r.warnings.includes('일부 인근 충전소 이용 제한 가능'));
});

globalThis.fetch = originalFetch;

console.log(`\n✅ R1 RECOMMENDATION TEST: PASS · ${passed} cases`);
console.log(`fetch calls during recommendation=${fetchCalls}`);
console.log('Cloudflare remote read=0 · write=0 · deploy=0 · public API=0');
