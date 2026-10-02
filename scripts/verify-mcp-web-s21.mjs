import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const kakaoSdk = read('src/services/kakaoSdk.ts');
const resolver = read('src/services/locationResolver.ts');
const map = read('src/components/KakaoMap.tsx');
const chat = read('src/components/PlugParkAiChat.tsx');
const bridge = read('tools/mcp-web-s1/bridge.ts');
const launcher = read('scripts/start-ai-stack.mjs');

assert(
  kakaoSdk.includes('export function loadKakaoMapSdk'),
  '공용 Kakao SDK loader가 없습니다.',
);
assert(
  kakaoSdk.includes('libraries=services'),
  '공용 Kakao SDK loader가 services 라이브러리를 로드하지 않습니다.',
);
assert(
  map.includes("from '../services/kakaoSdk'"),
  'KakaoMap이 공용 SDK loader를 사용하지 않습니다.',
);
assert(
  !map.includes('let sdkPromise: Promise<any> | null = null'),
  'KakaoMap에 별도 SDK loader 상태가 남아 있습니다.',
);

assert(
  resolver.includes('export async function resolveNearbyLandmark'),
  'Location Resolver가 없습니다.',
);
assert(
  resolver.includes("reason: 'SDK_UNAVAILABLE'"),
  'SDK 실패 원인이 구분되지 않습니다.',
);
assert(
  resolver.includes("reason: 'NO_RESULTS'"),
  '검색 결과 없음 원인이 구분되지 않습니다.',
);
assert(
  resolver.includes("reason: 'OUTSIDE_BUSAN'"),
  '부산 외 후보 실패 원인이 구분되지 않습니다.',
);
assert(
  resolver.includes("reason: 'LOW_CONFIDENCE'"),
  '낮은 신뢰도 실패 원인이 구분되지 않습니다.',
);
assert(
  resolver.includes("'한국폴리텍대학 부산캠퍼스'"),
  '폴리텍 별칭 검색 후보가 없습니다.',
);
assert(
  resolver.includes('replaceNearbyLandmark'),
  '위치 보충 답변을 원래 주변 검색과 합치는 기능이 없습니다.',
);

assert(
  chat.includes('pendingNearby'),
  '주변 검색 위치 보충 상태가 없습니다.',
);
assert(
  chat.includes('replaceNearbyLandmark(pendingNearby.originalRequest, message)'),
  '후속 장소 입력이 원래 주변 검색 요청으로 복원되지 않습니다.',
);
assert(
  chat.includes('resolveNearbyLandmark(appKey, effectiveMessage)'),
  'AI 채팅이 공용 Location Resolver를 호출하지 않습니다.',
);
assert(
  chat.includes('targetResolveReason:'),
  'Resolver 실패 원인이 Bridge로 전달되지 않습니다.',
);
assert(
  chat.includes('targetResolveQueries:'),
  'Resolver 실제 검색어가 Bridge로 전달되지 않습니다.',
);
assert(
  chat.includes('targetCandidateCount:'),
  'Resolver 후보 수가 Bridge로 전달되지 않습니다.',
);

assert(
  bridge.includes("const BRIDGE_API_VERSION = 'MCP_WEB_S21B_V1'"),
  'S2.1 Bridge API 버전이 아닙니다.',
);
assert(
  bridge.includes("'[LOC] FAIL'"),
  '랜드마크 실패 진단 로그가 없습니다.',
);
assert(
  bridge.includes("'[LOC] OK'"),
  '랜드마크 성공 진단 로그가 없습니다.',
);
assert(
  bridge.includes('context.targetResolveFailed && context.targetQuery'),
  '랜드마크 실패 시 일반 Tool fallback 차단이 없습니다.',
);
assert(
  launcher.includes("REQUIRED_BRIDGE_API_VERSION = 'MCP_WEB_S21B_V1'"),
  '런처가 S2.1 Bridge 버전을 요구하지 않습니다.',
);

console.log('MCP-WEB-S2.1 LOCATION RESOLVER VERIFY PASS');
console.log({
  sharedKakaoSdk: 'PASS',
  explicitResolverFailures: 'PASS',
  landmarkAliases: 'PASS',
  pendingLocationClarification: 'PASS',
  searchFallbackBlocked: 'PASS',
  terminalLocationDiagnostics: 'PASS',
});
