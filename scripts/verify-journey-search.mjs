import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Exercise the actual React handlers and map effects without a map API key or network.
function compile(file, imports, globals = {}) {
  const source = fs.readFileSync(file, 'utf8').replaceAll('import.meta.env', '({})');
  const output = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, { module, exports: module.exports, require(name) {
    if (!(name in imports)) throw new Error(`Unexpected dependency: ${name}`);
    return imports[name];
  }, console, ...globals }, { filename: file });
  return module.exports;
}

function hooks() {
  const slots = [];
  const effects = [];
  let index = 0;
  return {
    slots, effects,
    reset() { index = 0; effects.length = 0; },
    react: {
      useState(initial) {
        const slot = index++;
        if (!(slot in slots)) slots[slot] = typeof initial === 'function' ? initial() : initial;
        return [slots[slot], (next) => { slots[slot] = typeof next === 'function' ? next(slots[slot]) : next; }];
      },
      useRef(initial) { const slot = index++; if (!(slot in slots)) slots[slot] = { current: initial }; return slots[slot]; },
      useMemo: (fn) => fn(), useCallback: (fn) => fn,
      useEffect: (fn) => effects.push(fn),
    },
  };
}
const jsx = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
function nodes(root) {
  if (!root || typeof root !== 'object') return [];
  if (Array.isArray(root)) return root.flatMap(nodes);
  return [root, ...nodes(root.props?.children)];
}
function find(tree, predicate) { const found = nodes(tree).find(predicate); assert(found, 'Expected UI element is missing'); return found; }
const component = (name) => ({ __esModule: true, default: name });
const appHooks = hooks();
let lookup = async () => ({ ok: true, lat: 35.21795, lng: 129.01923, canonicalName: '한국폴리텍대학 부산캠퍼스' });
const App = compile('src/App.tsx', {
  react: appHooks.react, 'react/jsx-runtime': jsx,
  './components/KakaoMap': component('KakaoMap'), './components/PwaActions': component('PwaActions'),
  './components/LocationIcon': component('LocationIcon'), './components/PlugParkAiChat': component('PlugParkAiChat'),
  './components/RecommendationPanel': component('RecommendationPanel'), './mock': { mockPlaces: [] },
  './presentation/chargerText': { chargerAvailabilityText: () => '', chargerSelectionText: () => '', hasRestrictedChargerAccess: () => false },
  './recommendation/recommendPlaces': { recommendPlaces: () => [] },
  './services/locationResolver': { resolveLocation: (...args) => lookup(...args) },
}, { window: { requestAnimationFrame() {} } }).default;
const makePlace = (id, lat, lng) => ({ id, name: `주차장 ${id}`, address: '부산 북구 덕천동', lat, lng,
  charger: { total: 1, available: 1, fast: 1, slow: 0, stations: [] } });
appHooks.slots[0] = [makePlace('near', 35.219, 129.02), makePlace('far', 35.17, 129.13)];
const render = () => { appHooks.reset(); return App(); };
const input = (tree) => find(tree, (n) => n.props?.id === 'destination-input');
const search = (tree) => find(tree, (n) => n.props?.className === 'destination-search');
const map = (tree) => find(tree, (n) => n.type === 'KakaoMap').props;
const event = { preventDefault() {} };
let tree = render();
input(tree).props.onChange({ target: { value: '폴리텍 대학' } });
tree = render();
assert.equal(map(tree).places.length, 2, 'Typing must not remove places before destination resolution');
await search(tree).props.onSubmit(event);
await new Promise(resolve => setTimeout(resolve, 0));
tree = render();
assert.equal(map(tree).searchTarget.name, '한국폴리텍대학 부산캠퍼스');
assert.equal(map(tree).userLocation, null, 'A destination must not pretend to be device geolocation');
assert.equal(map(tree).radiusKm, 3);
assert.deepEqual(Array.from(map(tree).places, (p) => p.id), ['near'], 'Nearby filtering must use coordinates, not the college name');
assert.equal(find(tree, (n) => n.type === 'PlugParkAiChat').props.searchTarget.name, map(tree).searchTarget.name);

lookup = async () => ({ ok: false, reason: 'NO_RESULTS' });
input(tree).props.onChange({ target: { value: '알수없는장소' } });
tree = render(); await search(tree).props.onSubmit(event); await new Promise(resolve => setTimeout(resolve, 0)); tree = render();
assert.equal(map(tree).searchTarget.name, '한국폴리텍대학 부산캠퍼스', 'Failed searches must preserve the confirmed destination');

let resolveLate;
lookup = () => new Promise((resolve) => { resolveLate = resolve; });
input(tree).props.onChange({ target: { value: '부산역' } }); tree = render();
const pending = search(tree).props.onSubmit(event);
input(tree).props.onChange({ target: { value: '' } });
resolveLate({ ok: true, lat: 35.115, lng: 129.04, canonicalName: '부산역' });
await pending; await new Promise(resolve => setTimeout(resolve, 0)); tree = render();
assert.equal(map(tree).searchTarget, null, 'Cleared destinations must not return when old requests finish');
assert.equal(map(tree).places.length, 2);

// Verify the actual map effects keep a destination pin even when no parking matches.
const mapHooks = hooks();
const overlays = [], circles = [], moves = [];
const fakeMap = { panTo: (p) => moves.push(p), getLevel: () => 8, setLevel() {}, setBounds: (b) => moves.push(b) };
const fakeKakao = { maps: {
  LatLng: class { constructor(lat, lng) { this.lat = lat; this.lng = lng; } },
  LatLngBounds: class { constructor(...corners) { this.corners = corners; } extend() {} },
  CustomOverlay: class { constructor(options) { this.options = options; overlays.push(this); } setMap() {} },
  Circle: class { constructor(options) { this.options = options; circles.push(this); } setMap() {} },
} };
const MapComponent = compile('src/components/KakaoMap.tsx', {
  react: mapHooks.react, 'react/jsx-runtime': jsx, './LocationIcon': component('LocationIcon'),
  '../services/kakaoSdk': { isBusanCoordinates: () => true, kakaoKeywordSearch: async () => [], loadKakaoMapSdk: async () => fakeKakao },
}, {
  document: { createElement: () => ({ setAttribute() {}, append() {}, addEventListener() {} }) },
  window: { setTimeout: (callback) => setTimeout(callback, 0) },
}).default;
const mapProps = { places: [], focusedPlace: null, userLocation: null,
  searchTarget: { lat: 35.21795, lng: 129.01923, name: '<목적지>' }, radiusKm: 3,
  onSelect() {}, onLocate() {}, onCoordinateCorrection() {} };
MapComponent(mapProps);
// Refs are initialized in declaration order; set only the map runtime and ready status.
mapHooks.slots[1].current = fakeMap;
mapHooks.slots[2].current = fakeKakao;
mapHooks.slots[11] = 'ready';
mapHooks.reset(); const mapTree = MapComponent(mapProps);
for (const effect of mapHooks.effects) effect();
assert.equal(overlays.length, 1, 'Destination needs its own overlay with no parking results');
assert.equal(overlays[0].options.content.className, 'kakao-destination-marker');
assert.equal(circles[0].options.radius, 3000);
assert.equal(moves.length, 1, 'Destination should establish the map viewport');
assert(!nodes(mapTree).some((n) => n.props?.className === 'map-state map-empty'), 'Empty result overlay must not obscure destination');

function renderMap(props) {
  mapHooks.reset(); MapComponent(props);
  for (const effect of mapHooks.effects) effect();
}
renderMap({ ...mapProps, onSelect() {} });
assert.equal(moves.length, 1, 'Page rerenders must not reset a manually panned destination view');
const focusedPlace = makePlace('near', 35.219, 129.02);
renderMap({ ...mapProps, focusedPlace, focusRequestId: 1 });
assert.equal(moves.length, 2, 'Explicit place focus should move the map');
mapHooks.slots[9] += 1;
renderMap({ ...mapProps, focusedPlace: { ...focusedPlace }, focusRequestId: 1 });
assert.equal(moves.length, 2, 'Coordinate updates must not recenter the focused view');
renderMap(mapProps);
assert.equal(moves.length, 2, 'Closing a detail panel must not return to the destination');
renderMap({ ...mapProps, radiusKm: 5 });
assert.equal(moves.length, 3, 'An explicit radius change should adjust the viewport');
renderMap({ ...mapProps, searchTarget: null, places: [focusedPlace] });
renderMap({ ...mapProps, searchTarget: null, places: [{ ...focusedPlace }], onSelect() {} });
assert.equal(moves.length, 3, 'Place and marker updates must preserve the map camera');
renderMap({ ...mapProps, searchTarget: null, focusedPlace, focusRequestId: 2 });
assert.equal(moves.length, 4, 'Repeated explicit focus on the same place must still work');
console.log('Map camera: preserve pan on rerender, data updates and detail close; move only for explicit destination/radius/place requests ... PASS');
console.log('Journey search: destination resolution, coordinate radius, independent geolocation, failure preservation, stale-request cancellation, empty-results pin and radius ... PASS');
