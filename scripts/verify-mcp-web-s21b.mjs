import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';

const root = process.cwd();
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function loadTypeScriptModule(relativePath) {
  const source = read(relativePath);
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
    },
    fileName: relativePath,
  }).outputText;

  const module = { exports: {} };
  const sandbox = {
    module,
    exports: module.exports,
    require: createRequire(import.meta.url),
    console,
  };

  vm.runInNewContext(compiled, sandbox, {
    filename: relativePath,
  });

  return module.exports;
}

const intentSource = read('src/services/locationIntent.ts');
const resolver = read('src/services/locationResolver.ts');
const chat = read('src/components/PlugParkAiChat.tsx');
const bridge = read('tools/mcp-web-s1/bridge.ts');
const launcher = read('scripts/start-ai-stack.mjs');

const {
  parseLocationIntent,
  replaceNearbyLandmark,
  isLikelyLocationClarification,
} = loadTypeScriptModule('src/services/locationIntent.ts');

const cases = [
  ['화명동 주변 주차장 찾아줘', '화명동', 'explicit'],
  ['화명동 근처 급속 충전소 있어?', '화명동', 'explicit'],
  ['부산 북구 화명동에서 가까운 주차장 3개', '부산 북구 화명동', 'explicit'],
  ['내가 사는곳이 화명동인데 주변에 주차장 찾아줘', '화명동', 'residence'],
  ['내가 사는 곳은 화명동이야. 근처 충전소 알려줘', '화명동', 'residence'],
  ['나는 화명동 사는데 근처 급속 충전 가능한 곳 있어?', '화명동', 'residence'],
  ['우리 동네가 화명동이야 주변 주차장 좀', '화명동', 'residence'],
  ['지금 부산 북구 화명동인데 가까운 주차장 알려줘', '부산 북구 화명동', 'explicit'],
  ['폴리텍 북구 주변 급속 충전소 찾아줘', '폴리텍 북구', 'explicit'],
  ['부산역 근처 주차장 알려줘', '부산역', 'explicit'],
  ['사직야구장 주변 충전소', '사직야구장', 'explicit'],
];

for (const [input, location, source] of cases) {
  const parsed = parseLocationIntent(input);
  assert(parsed.isNearbyRequest === true, `주변 의도 인식 실패: ${input}`);
  assert(parsed.locationText === location, `위치 추출 실패: ${input} -> ${parsed.locationText}`);
  assert(parsed.source === source, `위치 source 실패: ${input} -> ${parsed.source}`);
}

for (const input of [
  '내 근처 급속 충전소 알려줘',
  '현재 위치 근처 충전소',
  '지금 내 위치에서 가까운 곳',
  '여기 주변 주차장 찾아줘',
]) {
  const parsed = parseLocationIntent(input);
  assert(parsed.isNearbyRequest === true, `현재 위치 주변 의도 실패: ${input}`);
  assert(parsed.locationText === null, `현재 위치를 장소명으로 오인: ${input}`);
  assert(parsed.source === 'current-location', `현재 위치 source 실패: ${input}`);
}

const unknownHome = parseLocationIntent('우리 집 근처에 주차장 찾아줘');
assert(unknownHome.isNearbyRequest === true, '우리 집 주변 의도 인식 실패');
assert(unknownHome.locationText === null, '우리 집을 지오코딩 가능한 장소명으로 오인');
assert(unknownHome.source === 'none', '우리 집 source는 none이어야 함');

const nonNearby = parseLocationIntent('화명동 주차장 알려줘');
assert(nonNearby.isNearbyRequest === false, '일반 텍스트 검색을 주변 검색으로 오인');

assert(
  replaceNearbyLandmark('폴리텍 주변 급속 충전소 찾아줘', '부산 북구 폴리텍') ===
    '부산 북구 폴리텍 주변 급속 충전소 찾아줘',
  '후속 위치 보충 시 기존 주변 검색 조건이 보존되지 않음',
);
assert(
  replaceNearbyLandmark(
    '내가 사는곳이 화명동인데 주변에 주차장 찾아줘',
    '부산 북구 화명동',
  ) === '내가 사는곳이 부산 북구 화명동인데 주변에 주차장 찾아줘',
  '거주지 표현 안의 위치만 교체하지 못함',
);
assert(
  isLikelyLocationClarification('부산 북구 폴리텍') === true,
  '폴리텍 위치 보충 응답을 인식하지 못함',
);
assert(
  isLikelyLocationClarification('화명동') === true,
  '행정동 위치 보충 응답을 인식하지 못함',
);
assert(
  isLikelyLocationClarification('급속 충전소 다시 찾아줘') === false,
  '새 요청을 위치 보충 응답으로 오인',
);

assert(
  intentSource.includes("source: 'current-location'"),
  'current-location 분기 구현이 없습니다.',
);
assert(
  resolver.includes("from './locationIntent'"),
  'Location Resolver가 공용 Location Intent Parser를 사용하지 않습니다.',
);
assert(
  chat.includes('parseLocationIntent(message)'),
  'AI 채팅이 원문 위치 의도를 파싱하지 않습니다.',
);
assert(
  chat.includes('isLikelyLocationClarification(message)'),
  '후속 위치 보충 판별이 없습니다.',
);
assert(
  chat.includes('locationIntentSource: effectiveIntent.source'),
  '위치 파싱 source를 Bridge에 전달하지 않습니다.',
);
assert(
  bridge.includes("'[LOC-PARSE]'"),
  'Bridge에 LOC-PARSE 진단 로그가 없습니다.',
);
assert(
  bridge.includes("const BRIDGE_API_VERSION = 'MCP_WEB_S21B_V1'"),
  'Bridge가 S2.1-B 버전이 아닙니다.',
);
assert(
  launcher.includes("REQUIRED_BRIDGE_API_VERSION = 'MCP_WEB_S21B_V1'"),
  '런처가 S2.1-B Bridge 버전을 강제하지 않습니다.',
);

console.log('MCP-WEB-S2.1-B LOCATION INTENT VERIFY PASS');
console.log({
  naturalLanguageLocationCases: cases.length,
  currentLocationCases: 4,
  unknownHomeGuard: 'PASS',
  clarificationRecovery: 'PASS',
  searchFallbackGuard: 'PASS',
  locationParseDiagnostics: 'PASS',
});
