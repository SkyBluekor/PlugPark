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
const envType = read('src/vite-env.d.ts');
const envExample = read('.env.example');
const bridge = read('tools/mcp-web-s1/bridge.ts');
const installer = read('tools/apply_mcp_web_s1.ps1');

assert(app.includes('<PlugParkAiChat'), 'App.tsx에 AI 채팅이 연결되지 않았습니다.');
assert(chat.includes('VITE_LOCAL_AI_BRIDGE_URL'), 'AI bridge URL 환경변수가 연결되지 않았습니다.');
assert(chat.includes('/health'), 'AI health check가 없습니다.');
assert(chat.includes('/api/chat'), 'AI chat endpoint 호출이 없습니다.');
assert(chat.includes('userLat'), '현재 위치 컨텍스트 전달이 없습니다.');
assert(envType.includes('VITE_LOCAL_AI_BRIDGE_URL'), 'Vite env 타입이 없습니다.');
assert(envExample.includes('http://127.0.0.1:3000'), '기본 AI bridge 예제가 없습니다.');

assert(bridge.includes("OLLAMA_MODEL"), '모델 설정 분리가 없습니다.');
assert(bridge.includes("qwen3.5:9b"), '기본 Qwen 모델이 없습니다.');
assert(bridge.includes("search_places"), 'MCP Tool 규칙이 없습니다.');
assert(bridge.includes("recommend_places"), '추천 Tool 규칙이 없습니다.');
assert(bridge.includes("access-control-allow-origin"), 'CORS 처리가 없습니다.');
assert(bridge.includes("access-control-allow-private-network"), 'Private Network preflight 처리가 없습니다.');
assert(bridge.includes("req.url === '/health'"), 'Bridge health endpoint가 없습니다.');
assert(bridge.includes("req.url === '/api/chat'"), 'Bridge chat endpoint가 없습니다.');
assert(bridge.includes('syncPlacesSnapshot'), 'Bridge 시작 시 snapshot 동기화가 없습니다.');
assert(bridge.includes('scripts/sync-places.ts'), '기존 MCP snapshot sync 경로를 사용하지 않습니다.');
assert(bridge.includes('PLUGPARK_SYNC_ON_START'), 'snapshot 동기화 비활성화 설정이 없습니다.');
assert(bridge.includes('sessions = new Map'), '대화 세션 분리가 없습니다.');

assert(installer.includes('PlugPark-MCP'), 'PlugPark-MCP 적용 스크립트가 없습니다.');
assert(installer.includes('src\\bridge.ts'), 'Bridge 설치 대상이 올바르지 않습니다.');

console.log('MCP-WEB-S1 STATIC VERIFY PASS');
console.log({
  plugParkChatUi: 'PASS',
  optionalBridge: 'PASS',
  localHealthCheck: 'PASS',
  userLocationContext: 'PASS',
  modelConfig: 'PASS',
  cors: 'PASS',
  mcpBridgeTemplate: 'PASS',
  snapshotSyncOnStart: 'PASS',
  siblingInstaller: 'PASS',
});
