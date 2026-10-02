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
const nearbyTool = read('tools/mcp-web-s1/nearby-tool.ts');

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
  bridge.includes("const BRIDGE_API_VERSION = 'MCP_WEB_S2_V5'"),
  'S2 Bridge API 버전이 없습니다.',
);
assert(
  bridge.includes('target.clear()'),
  '최종 MCP Tool 결과가 중간 검색 결과보다 우선되지 않습니다.',
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
assert(
  launcher.includes("REQUIRED_BRIDGE_API_VERSION = 'MCP_WEB_S2_V5'"),
  '통합 런처가 실행 중인 Bridge 버전을 검증하지 않습니다.',
);
assert(
  launcher.includes("node_modules', 'tsx', 'dist', 'cli.mjs"),
  '통합 런처가 PlugPark-MCP의 local tsx CLI를 사용하지 않습니다.',
);
assert(
  !launcher.includes("executable('npx')"),
  'Windows에서 EINVAL을 유발할 수 있는 npx.cmd spawn이 남아 있습니다.',
);
assert(
  bridge.includes("const TSX_CLI = resolve(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs')"),
  'Bridge가 local tsx CLI를 사용하지 않습니다.',
);
assert(
  bridge.includes("command: process.execPath"),
  'MCP stdio transport가 Node 실행 파일을 사용하지 않습니다.',
);
assert(
  !bridge.includes("process.platform === 'win32' ? 'npx.cmd' : 'npx'"),
  'Bridge에 Windows npx.cmd spawn이 남아 있습니다.',
);
assert(
  bridge.includes('extractLandmarkSearchTerm'),
  '근처/주변 질의에서 핵심 장소명을 정규화하지 않습니다.',
);
assert(
  chat.includes('resolveNearbyLandmark'),
  '브라우저에서 Kakao 기준 장소 좌표를 해석하지 않습니다.',
);
assert(
  chat.includes('buildLandmarkQueries'),
  '랜드마크 검색어 후보를 보강하지 않습니다.',
);
assert(
  chat.includes('landmarkCandidateScore'),
  'Kakao 랜드마크 후보를 지역/장소명 기준으로 평가하지 않습니다.',
);
assert(
  chat.includes('targetResolveFailed: Boolean(nearbyLandmark && !targetLocation)'),
  '랜드마크 좌표 해석 실패 상태를 Bridge에 전달하지 않습니다.',
);
assert(
  bridge.includes('context.targetResolveFailed && context.targetQuery'),
  '랜드마크 해석 실패 시 일반 search_places fallback을 차단하지 않습니다.',
);
assert(
  bridge.includes('[LOC] target='),
  'Bridge에 최종 기준 장소 좌표 진단 로그가 없습니다.',
);
assert(
  chat.includes('targetLat: targetLocation?.lat ?? null'),
  '해석한 기준 장소 좌표를 Bridge에 전달하지 않습니다.',
);
assert(
  bridge.includes('progressiveLandmarkRecommendation'),
  '기준 장소 주변 반경을 점진적으로 확장하지 않습니다.',
);
assert(
  bridge.includes("name: 'nearby_places'"),
  '점진 검색이 exact nearby MCP Tool을 호출하지 않습니다.',
);
assert(
  bridge.includes("collectToolPlaces('nearby_places'"),
  'nearby_places 결과가 구조화 장소 카드로 연결되지 않습니다.',
);
assert(
  nearbyTool.includes("registerTool(\n    'nearby_places'"),
  'exact nearby MCP Tool이 없습니다.',
);
assert(
  nearbyTool.includes('.sort((a, b) =>'),
  'nearby_places가 거리순 정렬을 수행하지 않습니다.',
);
assert(
  nearbyTool.includes('distanceMeters - b.distanceMeters'),
  'nearby_places의 거리 오름차순 보장이 없습니다.',
);
assert(
  launcher.includes('syncNearbyMcpTool'),
  '통합 런처가 nearby MCP Tool을 자동 설치하지 않습니다.',
);
assert(
  launcher.includes('PLUGPARK_MCP_WEB_NEARBY_TOOL'),
  '통합 런처가 MCP server.ts에 nearby Tool 등록을 패치하지 않습니다.',
);
assert(
  bridge.includes('[1, 3, 5, 10, 20]'),
  '점진적 주변 검색 반경 정책이 없습니다.',
);
assert(
  bridge.includes('count >= requestedCount'),
  '목표 장소 수를 찾았을 때 검색을 종료하지 않습니다.',
);
assert(
  bridge.includes('distanceMeters?: number | null'),
  '구조화 AI 장소에 거리 메타데이터가 없습니다.',
);
assert(
  bridge.includes('sort(') && bridge.includes('distanceMeters'),
  '점진 검색 결과를 거리 기준으로 정렬하지 않습니다.',
);
assert(
  chat.includes('formatAiDistance'),
  'AI 장소 카드에 거리 표시가 없습니다.',
);
assert(
  chat.includes('placeRef.rank'),
  'AI 장소 카드에 가까운 순서 번호가 없습니다.',
);
assert(
  bridge.includes('searchPlacesCalls > 2'),
  'search_places 반복 호출 상한이 없습니다.',
);
assert(
  bridge.includes('finalizeWithoutTools'),
  '검색 결과 이후 Tool 없이 답변을 종료하는 경로가 없습니다.',
);
assert(
  bridge.includes("args.parkingAvailable ="),
  '검색 조건의 주차 잔여 여부를 사용자 의도 기준으로 고정하지 않습니다.',
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
  bridgeVersionGuard: 'PASS',
  windowsSpawnCompatibility: 'PASS',
  searchLoopGuard: 'PASS',
  landmarkQueryNormalization: 'PASS',
  kakaoLandmarkResolution: 'PASS',
  koreanLandmarkQueryVariants: 'PASS',
  failedLandmarkFallbackBlock: 'PASS',
  progressiveRadiusSearch: 'PASS',
  exactNearbyMcpTool: 'PASS',
  distanceOrderedCards: 'PASS',
  distanceDisplay: 'PASS',
});
