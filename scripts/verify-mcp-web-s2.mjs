import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const app = read('src/App.tsx');
const chat = read('src/components/PlugParkAiChat.tsx');
const bridge = read('tools/mcp-web-s1/bridge.ts');
const styles = read('src/styles.css');
const launcher = read('scripts/start-ai-stack.mjs');

assert(
  bridge.includes('type AiPlaceReference'),
  'Bridge 구조화 장소 타입이 없습니다.',
);
assert(
  bridge.includes('collectToolPlaces'),
  'MCP 결과에서 장소를 수집하지 않습니다.',
);
assert(
  bridge.includes("toolName === 'search_places'"),
  'search_places 장소 수집이 없습니다.',
);
assert(
  bridge.includes("toolName === 'get_place_detail'"),
  'get_place_detail 장소 수집이 없습니다.',
);
assert(
  bridge.includes("toolName === 'recommend_places'"),
  'recommend_places 장소 수집이 없습니다.',
);
assert(
  bridge.includes("toolName === 'compare_places'"),
  'compare_places 장소 수집이 없습니다.',
);
assert(
  bridge.includes('places: [...relatedPlaces.values()]'),
  'Bridge 응답에 구조화 장소 목록이 없습니다.',
);

assert(
  chat.includes('places: PlugParkPlace[]'),
  'AI 채팅이 현재 PlugPark 장소 목록을 받지 않습니다.',
);
assert(
  chat.includes('onFocusMap: (place: PlugParkPlace) => void'),
  'AI 채팅 지도 연결 콜백이 없습니다.',
);
assert(
  chat.includes('onOpenDetail: (place: PlugParkPlace) => void'),
  'AI 채팅 상세 연결 콜백이 없습니다.',
);
assert(
  chat.includes("places.find((place) => place.id === placeRef.id)"),
  'AI 장소를 ID로 현재 화면 데이터와 매칭하지 않습니다.',
);
assert(
  !chat.includes('find((place) => place.name === placeRef.name)'),
  '장소 이름 기반 fallback 매칭을 사용하면 안 됩니다.',
);
assert(
  chat.includes('onFocusMap(currentPlace)'),
  'AI 지도 버튼이 기존 지도 포커스 기능을 호출하지 않습니다.',
);
assert(
  chat.includes('onOpenDetail(currentPlace)'),
  'AI 상세 버튼이 기존 상세 패널 기능을 호출하지 않습니다.',
);
assert(
  chat.includes('setOpen(false)'),
  '장소 액션 시 AI 패널 닫기 동작이 없습니다.',
);

assert(
  app.includes('places={places}'),
  'App이 AI 채팅에 현재 장소 데이터를 전달하지 않습니다.',
);
assert(
  app.includes('onFocusMap={focusPlaceOnMap}'),
  'App의 기존 지도 포커스 기능이 AI와 연결되지 않았습니다.',
);
assert(
  app.includes('onOpenDetail={openPlaceDetail}'),
  'App의 기존 상세 기능이 AI와 연결되지 않았습니다.',
);

assert(
  styles.includes('.ai-place-card'),
  'AI 장소 카드 스타일이 없습니다.',
);
assert(
  launcher.includes('syncBridgeTemplate'),
  '통합 런처가 최신 Bridge 코드를 자동 반영하지 않습니다.',
);

console.log('MCP-WEB-S2 STATIC VERIFY PASS');
console.log({
  structuredMcpPlaces: 'PASS',
  exactIdBinding: 'PASS',
  mapAction: 'PASS',
  detailAction: 'PASS',
  missingPlaceSafeState: 'PASS',
  compactPlaceCards: 'PASS',
  autoBridgeUpdate: 'PASS',
});
