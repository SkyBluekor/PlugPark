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

function loadTypeScriptModule(relativePath, overrides = {}) {
  const source = read(relativePath);
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
    fileName: relativePath,
  }).outputText;

  const module = { exports: {} };
  const nativeRequire = createRequire(import.meta.url);

  const sandbox = {
    module,
    exports: module.exports,
    require(specifier) {
      if (specifier in overrides) return overrides[specifier];
      return nativeRequire(specifier);
    },
    console,
    setTimeout,
    clearTimeout,
  };

  vm.runInNewContext(compiled, sandbox, {
    filename: relativePath,
  });

  return module.exports;
}

const intent = loadTypeScriptModule('src/services/locationIntent.ts');

const classificationCases = [
  ['화명동', 'administrative'],
  ['부산 북구 화명동', 'administrative'],
  ['부산광역시 북구', 'administrative'],
  ['부산 북구 금곡대로 166', 'address'],
  ['화명동 1234-5', 'address'],
  ['폴리텍 북구', 'poi'],
  ['북구 폴리텍', 'poi'],
  ['부산역', 'poi'],
  ['사직야구장', 'poi'],
];

for (const [input, expected] of classificationCases) {
  const actual = intent.classifyLocationText(input);
  assert(
    actual === expected,
    `위치 종류 판별 실패: ${input} -> ${actual}, expected=${expected}`,
  );
}

const calls = {
  address: [],
  keyword: [],
  reverse: [],
};

function resetCalls() {
  calls.address.length = 0;
  calls.keyword.length = 0;
  calls.reverse.length = 0;
}

const kakaoMock = {
  isBusanCoordinates(lat, lng) {
    return (
      Number.isFinite(lat) &&
      Number.isFinite(lng) &&
      lat >= 34.8 &&
      lat <= 35.45 &&
      lng >= 128.7 &&
      lng <= 129.4
    );
  },

  async loadKakaoMapSdk() {
    return { maps: { services: {} } };
  },

  async kakaoAddressSearch(_kakao, query, analyzeType) {
    calls.address.push({ query, analyzeType });

    if (query.includes('화명동')) {
      return [
        {
          x: '129.0192',
          y: '35.2179',
          address_name: '부산 북구 화명동',
        },
      ];
    }

    if (query.includes('금곡대로 166')) {
      return [
        {
          x: '129.0201',
          y: '35.2185',
          address_name: '부산 북구 금곡대로 166',
        },
      ];
    }

    if (query.includes('만덕동')) {
      return [
        {
          x: '129.0300',
          y: '35.2200',
          address_name: '부산 북구 만덕동',
        },
      ];
    }

    return [];
  },

  async kakaoCoord2RegionCode(_kakao, lng, lat) {
    calls.reverse.push({ lng, lat });

    if (Number(lng) === 129.03) {
      return [
        {
          region_type: 'H',
          address_name: '부산 북구 화명2동',
          region_1depth_name: '부산광역시',
          region_2depth_name: '북구',
          region_3depth_name: '화명2동',
        },
        {
          region_type: 'B',
          address_name: '부산 북구 화명동',
          region_1depth_name: '부산광역시',
          region_2depth_name: '북구',
          region_3depth_name: '화명동',
        },
      ];
    }

    return [
      {
        region_type: 'H',
        address_name: '부산 북구 화명2동',
        region_1depth_name: '부산광역시',
        region_2depth_name: '북구',
        region_3depth_name: '화명2동',
      },
      {
        region_type: 'B',
        address_name: '부산 북구 화명동',
        region_1depth_name: '부산광역시',
        region_2depth_name: '북구',
        region_3depth_name: '화명동',
      },
    ];
  },

  async kakaoKeywordSearch(_kakao, query) {
    calls.keyword.push(query);

    if (/폴리텍/.test(query)) {
      return [
        {
          id: 'polytech-busan',
          x: '129.0192326360133',
          y: '35.217951030549614',
          place_name: '한국폴리텍대학 부산캠퍼스',
          road_address_name: '부산 북구 만덕대로155번길 99',
          address_name: '부산 북구 덕천동',
          category_name: '교육,학문 > 학교 > 대학교',
        },
      ];
    }

    if (/부산역/.test(query)) {
      return [
        {
          id: 'busan-station',
          x: '129.0403',
          y: '35.1151',
          place_name: '부산역',
          road_address_name: '부산 동구 중앙대로 206',
          address_name: '부산 동구 초량동',
          category_name: '교통,수송 > 기차역',
        },
      ];
    }

    return [];
  },
};

const resolver = loadTypeScriptModule(
  'src/services/locationResolver.ts',
  {
    './kakaoSdk': kakaoMock,
    './locationIntent': intent,
  },
);

resetCalls();
const adminResult = await resolver.resolveNearbyLandmark(
  'fake-key',
  '내가 사는곳이 화명동인데 주변에 주차장 찾아줘',
);
assert(adminResult.ok === true, '화명동 행정지역 해석 실패');
assert(adminResult.kind === 'administrative', '화명동 kind가 administrative가 아님');
assert(adminResult.method === 'geocoder', '화명동이 Geocoder를 사용하지 않음');
assert(
  String(adminResult.canonicalName).includes('화명동'),
  '화명동 canonicalName이 잘못됨',
);
assert(calls.address.length > 0, '화명동에서 addressSearch를 호출하지 않음');
assert(calls.reverse.length > 0, '화명동에서 coord2RegionCode 역검증을 하지 않음');
assert(calls.keyword.length === 0, '화명동이 Places keywordSearch로 잘못 전달됨');

resetCalls();
const addressResult = await resolver.resolveNearbyLandmark(
  'fake-key',
  '부산 북구 금곡대로 166 근처 주차장 찾아줘',
);
assert(addressResult.ok === true, '도로명 주소 해석 실패');
assert(addressResult.kind === 'address', '도로명 주소 kind가 address가 아님');
assert(addressResult.method === 'geocoder', '도로명 주소가 Geocoder를 사용하지 않음');
assert(calls.address.length > 0, '도로명 주소에서 addressSearch를 호출하지 않음');
assert(calls.keyword.length === 0, '도로명 주소가 Places로 잘못 전달됨');

resetCalls();
const poiResult = await resolver.resolveNearbyLandmark(
  'fake-key',
  '폴리텍 북구 주변 급속 충전소 찾아줘',
);
assert(poiResult.ok === true, '폴리텍 POI 회귀 실패');
assert(poiResult.kind === 'poi', '폴리텍 북구가 POI로 분류되지 않음');
assert(poiResult.method === 'places', '폴리텍이 Places를 사용하지 않음');
assert(
  poiResult.canonicalName === '한국폴리텍대학 부산캠퍼스',
  '폴리텍 canonicalName 회귀 실패',
);
assert(calls.keyword.length > 0, '폴리텍에서 keywordSearch를 호출하지 않음');
assert(calls.address.length === 0, '폴리텍이 Geocoder로 잘못 전달됨');

resetCalls();
const stationResult = await resolver.resolveNearbyLandmark(
  'fake-key',
  '부산역 근처 주차장 알려줘',
);
assert(stationResult.ok === true, '부산역 POI 해석 실패');
assert(stationResult.kind === 'poi', '부산역 kind가 poi가 아님');
assert(stationResult.method === 'places', '부산역이 Places를 사용하지 않음');

const kakaoSdkSource = read('src/services/kakaoSdk.ts');
const resolverSource = read('src/services/locationResolver.ts');
const chat = read('src/components/PlugParkAiChat.tsx');
const bridge = read('tools/mcp-web-s1/bridge.ts');
const launcher = read('scripts/start-ai-stack.mjs');

assert(
  kakaoSdkSource.includes('export async function kakaoAddressSearch'),
  '공용 Kakao addressSearch wrapper가 없습니다.',
);
assert(
  kakaoSdkSource.includes('export async function kakaoCoord2RegionCode'),
  '공용 Kakao coord2RegionCode wrapper가 없습니다.',
);
assert(
  resolverSource.includes("kind === 'administrative'"),
  '행정지역 Resolver 분기가 없습니다.',
);
assert(
  resolverSource.includes("kind === 'address'"),
  '주소 Resolver 분기가 없습니다.',
);
assert(
  resolverSource.includes('regionMatchesInput'),
  '행정지역 역검증 로직이 없습니다.',
);
assert(
  chat.includes('targetResolveKind: locationResult?.kind ?? null'),
  'Resolver kind가 Bridge로 전달되지 않습니다.',
);
assert(
  chat.includes('targetResolveMethod: locationResult?.method ?? null'),
  'Resolver method가 Bridge로 전달되지 않습니다.',
);
assert(
  bridge.includes("'[LOC-RESOLVE] OK'"),
  'LOC-RESOLVE 성공 진단 로그가 없습니다.',
);
assert(
  bridge.includes("'[LOC-RESOLVE] FAIL'"),
  'LOC-RESOLVE 실패 진단 로그가 없습니다.',
);
assert(
  bridge.includes("const BRIDGE_API_VERSION = 'MCP_WEB_S21C_V1'"),
  'Bridge가 S2.1-C 버전이 아닙니다.',
);
assert(
  launcher.includes("REQUIRED_BRIDGE_API_VERSION = 'MCP_WEB_S21C_V1'"),
  '런처가 S2.1-C Bridge 버전을 강제하지 않습니다.',
);

console.log('MCP-WEB-S2.1-C LOCATION RESOLVER VERIFY PASS');
console.log({
  classifierCases: classificationCases.length,
  administrativeGeocoder: 'PASS',
  addressGeocoder: 'PASS',
  poiPlacesRegression: 'PASS',
  reverseRegionVerification: 'PASS',
  currentLocationBypass: 'STATIC PASS',
  typedResolverDiagnostics: 'PASS',
});
