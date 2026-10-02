import ollama, { type Tool } from 'ollama';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { createServer as createHttpServer } from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const MODEL = process.env.OLLAMA_MODEL?.trim() || 'qwen3.5:9b';
const PORT = Number(process.env.AI_BRIDGE_PORT || 3000);
const HOST = process.env.AI_BRIDGE_HOST?.trim() || '127.0.0.1';
const SYNC_ON_START = process.env.PLUGPARK_SYNC_ON_START !== '0';

const allowedOrigins = new Set(
  (
    process.env.AI_ALLOWED_ORIGINS ||
    [
      'https://plugpark.dtdt4865.workers.dev',
      'http://127.0.0.1:8787',
      'http://localhost:5173',
      'http://127.0.0.1:5173',
    ].join(',')
  )
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
);

type WebContext = {
  userLat?: number | null;
  userLng?: number | null;
  radiusKm?: number | null;
};

type SessionMessages = any[];

type AiPlaceReference = {
  id: string;
  name: string;
  address?: string | null;
  parking: {
    capacity: number | null;
    available: number | null;
  };
  charging: {
    totalAvailable: number | null;
    fastAvailable: number | null;
    slowAvailable: number | null;
  };
};

type AgentReply = {
  answer: string;
  places: AiPlaceReference[];
};

const SYSTEM_PROMPT = `
너는 PlugPark의 로컬 AI 도우미다.

PlugPark는 부산 공영주차장과 전기차 충전 정보를 제공한다.

[데이터 규칙]
- 주차장이나 충전 정보가 필요하면 제공된 Tool을 사용한다.
- Tool 결과에 없는 정보는 만들어내지 않는다.
- 데이터가 없으면 없다고 말한다.
- 주차 잔여면을 임의로 "충분하다", "여유롭다"고 평가하지 않는다.
- 실제 숫자를 그대로 설명한다.
- totalInstalled는 전체 충전기 설치 수다.
- fastInstalled는 급속 설치 수다.
- fastAvailable은 현재 사용 가능한 급속 충전기 수다.
- slowInstalled는 완속 설치 수다.
- slowAvailable은 현재 사용 가능한 완속 충전기 수다.
- 각 수치를 혼동하지 않는다.

[Tool 선택 규칙]
- 장소명/주소/지역명을 단순 검색: search_places
- 특정 장소의 상세 정보: get_place_detail
- 위도/경도 또는 반경을 기준으로 추천: recommend_places
- 여러 장소의 실제 수치를 비교: compare_places
- 현재 위치 컨텍스트가 있고 "내 근처", "주변", "가까운 곳", "추천" 요청이면 recommend_places를 우선 사용한다.
- recommend_places가 적합한 요청을 search_places 여러 번 호출해서 처리하지 않는다.

[인자 규칙]
- 사용자가 명시한 좌표, 반경, 충전 방식, 추천 개수를 임의로 바꾸지 않는다.
- 급속이라고 하면 chargerPreference=fast다.
- 완속이라고 하면 chargerPreference=slow다.
- 주차 우선이라고 하면 mode=parking이다.
- 충전 우선이라고 하면 mode=charging이다.
- 웹 컨텍스트의 현재 위치는 사용자가 "내 근처", "내 주변", "가까운 곳"처럼 요청할 때만 위치 기반 추천에 사용한다.

[응답 규칙]
- Tool에 실제 전달된 조건과 다른 조건을 답변에 쓰지 않는다.
- 불필요한 영어 표현을 섞지 않는다.
- 자연스러운 한국어로 짧고 명확하게 설명한다.
- 0m인 경우 "현재 위치와 같은 좌표"처럼 설명한다.
- 웹 컨텍스트의 좌표값 자체를 불필요하게 답변에 노출하지 않는다.
`;

async function syncPlacesSnapshot() {
  if (!SYNC_ON_START) return;

  const syncScript = 'scripts/sync-places.ts';
  if (!existsSync(syncScript)) {
    console.warn('[SYNC] scripts/sync-places.ts가 없어 기존 MCP 데이터 상태를 유지합니다.');
    return;
  }

  console.log('[SYNC] PlugPark 운영 데이터를 로컬 snapshot으로 동기화합니다.');

  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      process.platform === 'win32' ? 'npx.cmd' : 'npx',
      ['tsx', syncScript],
      {
        cwd: process.cwd(),
        env: process.env,
        stdio: 'inherit',
      },
    );

    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      if (existsSync('data/places.json')) {
        console.warn(
          `[SYNC] 최신 동기화 실패(code=${code}). 기존 data/places.json으로 계속합니다.`,
        );
        resolve();
        return;
      }

      reject(new Error(`PlugPark snapshot 동기화 실패(code=${code})`));
    });
  });
}

const client = new Client({
  name: 'plugpark-web-bridge',
  version: '1.0.0',
});

const transport = new StdioClientTransport({
  command: process.platform === 'win32' ? 'npx.cmd' : 'npx',
  args: ['tsx', 'src/server.ts'],
  cwd: process.cwd(),
});

await syncPlacesSnapshot();

await client.connect(transport);

const { tools: mcpTools } = await client.listTools();

const ollamaTools: Tool[] = mcpTools.map((tool) => ({
  type: 'function',
  function: {
    name: tool.name,
    description: tool.description ?? '',
    parameters: tool.inputSchema as Tool['function']['parameters'],
  },
}));

const sessions = new Map<string, SessionMessages>();

function getSession(sessionId: string) {
  const key = sessionId || 'default';
  let messages = sessions.get(key);

  if (!messages) {
    messages = [{ role: 'system', content: SYSTEM_PROMPT }];
    sessions.set(key, messages);
  }

  if (sessions.size > 20) {
    const oldest = sessions.keys().next().value;
    if (oldest && oldest !== key) sessions.delete(oldest);
  }

  return messages;
}

function numberOrNull(value: unknown) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeContext(value: unknown): WebContext {
  if (!value || typeof value !== 'object') return {};

  const source = value as Record<string, unknown>;

  return {
    userLat: numberOrNull(source.userLat),
    userLng: numberOrNull(source.userLng),
    radiusKm: numberOrNull(source.radiusKm),
  };
}

function normalizeToolArguments(
  toolName: string,
  rawArgs: Record<string, unknown>,
  userText: string,
  context: WebContext,
) {
  const args: Record<string, unknown> = { ...rawArgs };
  const text = userText;
  const compact = userText.replace(/\s+/g, ' ').trim();

  if (toolName === 'recommend_places') {
    const latMatch = compact.match(/위도\s*[:=]?\s*([+-]?\d+(?:\.\d+)?)/i);
    const lngMatch = compact.match(/경도\s*[:=]?\s*([+-]?\d+(?:\.\d+)?)/i);

    if (latMatch) args.userLat = Number(latMatch[1]);
    if (lngMatch) args.userLng = Number(lngMatch[1]);

    const radiusMatch = compact.match(/(?:반경\s*)?(1|3|5)\s*km/i);
    if (radiusMatch) args.radiusKm = Number(radiusMatch[1]);

    const limitMatch = compact.match(/([1-5])\s*곳/);
    if (limitMatch) args.limit = Number(limitMatch[1]);

    if (text.includes('급속')) {
      args.chargerPreference = 'fast';
    } else if (text.includes('완속')) {
      args.chargerPreference = 'slow';
    } else if (/상관\s*없|아무거나|충전\s*방식.*무관/.test(compact)) {
      args.chargerPreference = 'any';
    }

    if (/주차\s*(?:를\s*)?(?:우선|중심)/.test(compact)) {
      args.mode = 'parking';
    } else if (
      /충전\s*(?:을\s*)?(?:우선|중심)/.test(compact) ||
      text.includes('급속') ||
      text.includes('완속')
    ) {
      args.mode = 'charging';
    }

    const nearbyRequest = /내\s*(?:근처|주변)|가까운|근처|주변|추천/.test(compact);
    if (nearbyRequest && context.userLat != null && context.userLng != null) {
      if (args.userLat == null) args.userLat = context.userLat;
      if (args.userLng == null) args.userLng = context.userLng;
      if (args.radiusKm == null && context.radiusKm != null) args.radiusKm = context.radiusKm;
    }
  }

  if (toolName === 'search_places') {
    if (text.includes('급속')) args.fastOnly = true;

    if (
      /충전\s*(?:이\s*)?(?:가능|할\s*수)/.test(compact) ||
      /사용\s*가능.*충전/.test(compact)
    ) {
      args.chargingAvailable = true;
    }

    if (
      /주차\s*(?:자리|가능|잔여)/.test(compact) ||
      /남은\s*자리/.test(compact)
    ) {
      args.parkingAvailable = true;
    }
  }

  return args;
}

function contextNote(context: WebContext) {
  if (context.userLat == null || context.userLng == null) return '';

  const radiusText = context.radiusKm != null ? `, 현재 선택 반경 ${context.radiusKm}km` : '';
  return `\n\n[PlugPark 웹 컨텍스트: 현재 위치 사용 가능${radiusText}. 위치 기반 요청이면 위도 ${context.userLat}, 경도 ${context.userLng}를 사용한다.]`;
}

function asRecord(value: unknown): Record<string, any> | null {
  return value && typeof value === 'object' ? value as Record<string, any> : null;
}

function normalizeAiPlace(value: unknown): AiPlaceReference | null {
  const source = asRecord(value);
  if (!source) return null;

  const id = typeof source.id === 'string' ? source.id.trim() : '';
  const name = typeof source.name === 'string' ? source.name.trim() : '';
  if (!id || !name) return null;

  const parking = asRecord(source.parking) ?? {};
  const charging = asRecord(source.charging) ?? {};

  return {
    id,
    name,
    address: typeof source.address === 'string' ? source.address : null,
    parking: {
      capacity: numberOrNull(parking.capacity),
      available: numberOrNull(parking.available),
    },
    charging: {
      totalAvailable: numberOrNull(charging.totalAvailable),
      fastAvailable: numberOrNull(charging.fastAvailable),
      slowAvailable: numberOrNull(charging.slowAvailable),
    },
  };
}

function collectToolPlaces(
  toolName: string,
  toolText: string,
  target: Map<string, AiPlaceReference>,
) {
  if (!toolText) return;

  let parsed: Record<string, any>;

  try {
    parsed = JSON.parse(toolText) as Record<string, any>;
  } catch {
    return;
  }

  const candidates: unknown[] = [];

  if (toolName === 'search_places' && Array.isArray(parsed.places)) {
    candidates.push(...parsed.places);
  } else if (toolName === 'get_place_detail' && parsed.found === true && parsed.place) {
    candidates.push(parsed.place);
  } else if (toolName === 'recommend_places' && Array.isArray(parsed.recommendations)) {
    for (const item of parsed.recommendations) {
      const record = asRecord(item);
      if (record?.place) candidates.push(record.place);
    }
  } else if (toolName === 'compare_places' && Array.isArray(parsed.places)) {
    candidates.push(...parsed.places);
  }

  for (const candidate of candidates) {
    const place = normalizeAiPlace(candidate);
    if (!place || target.has(place.id)) continue;
    target.set(place.id, place);
    if (target.size >= 5) break;
  }
}

async function runAgent(
  sessionId: string,
  userText: string,
  context: WebContext,
): Promise<AgentReply> {
  const messages = getSession(sessionId);
  const relatedPlaces = new Map<string, AiPlaceReference>();
  const augmentedUserText = `${userText}${contextNote(context)}`;

  messages.push({
    role: 'user',
    content: augmentedUserText,
  });

  for (let step = 0; step < 5; step++) {
    const response = await ollama.chat({
      model: MODEL,
      messages,
      tools: ollamaTools,
      stream: false,
    });

    messages.push(response.message);

    const toolCalls = response.message.tool_calls ?? [];

    if (toolCalls.length === 0) {
      return {
        answer: response.message.content || '응답이 없습니다.',
        places: [...relatedPlaces.values()],
      };
    }

    for (const toolCall of toolCalls) {
      const toolName = toolCall.function.name;
      const rawArgs = (toolCall.function.arguments ?? {}) as Record<string, unknown>;
      const args = normalizeToolArguments(toolName, rawArgs, userText, context);

      console.log(`[MCP] ${toolName}`, args);

      const result = await client.callTool({
        name: toolName,
        arguments: args,
      });

      const toolText = result.content
        .filter((item: any) => item.type === 'text')
        .map((item: any) => item.text)
        .join('\n');

      collectToolPlaces(toolName, toolText, relatedPlaces);

      messages.push({
        role: 'tool',
        tool_name: toolName,
        content: toolText || '결과 없음',
      });
    }
  }

  return {
    answer: 'Tool 호출 횟수가 너무 많아 작업을 중단했습니다.',
    places: [...relatedPlaces.values()],
  };
}

async function readJsonBody(req: any) {
  return await new Promise<any>((resolve, reject) => {
    let body = '';

    req.on('data', (chunk: Buffer) => {
      body += chunk.toString('utf8');

      if (body.length > 1_000_000) {
        reject(new Error('요청이 너무 큽니다.'));
        req.destroy();
      }
    });

    req.on('end', () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('JSON 형식이 올바르지 않습니다.'));
      }
    });

    req.on('error', reject);
  });
}

function isOriginAllowed(origin: string | undefined) {
  if (!origin) return true;
  return allowedOrigins.has(origin);
}

function applyCors(req: any, res: any) {
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined;

  if (origin && isOriginAllowed(origin)) {
    res.setHeader('access-control-allow-origin', origin);
    res.setHeader('vary', 'Origin');
  }

  res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type');

  if (req.headers['access-control-request-private-network'] === 'true') {
    res.setHeader('access-control-allow-private-network', 'true');
  }
}

async function healthPayload() {
  try {
    const list = await ollama.list();
    const models = Array.isArray((list as any)?.models) ? (list as any).models : [];
    const modelInstalled = models.some(
      (item: any) => item?.model === MODEL || item?.name === MODEL,
    );

    return {
      status: modelInstalled ? 200 : 503,
      body: {
        ok: modelInstalled,
        provider: 'ollama',
        model: MODEL,
        mcp: true,
        tools: mcpTools.map((tool) => tool.name),
        reason: modelInstalled ? undefined : 'model_not_installed',
      },
    };
  } catch {
    return {
      status: 503,
      body: {
        ok: false,
        provider: 'ollama',
        model: MODEL,
        mcp: true,
        reason: 'ollama_unreachable',
      },
    };
  }
}

const server = createHttpServer(async (req, res) => {
  try {
    const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined;

    if (!isOriginAllowed(origin)) {
      res.writeHead(403, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: '허용되지 않은 Origin입니다.' }));
      return;
    }

    applyCors(req, res);

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === 'GET' && req.url === '/health') {
      const health = await healthPayload();
      res.writeHead(health.status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      });
      res.end(JSON.stringify(health.body));
      return;
    }

    if (req.method === 'POST' && req.url === '/api/chat') {
      const body = await readJsonBody(req);
      const sessionId = String(body.sessionId ?? 'default').trim().slice(0, 120) || 'default';
      const message = String(body.message ?? '').trim();
      const context = normalizeContext(body.context);

      if (!message) {
        res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: '메시지가 비어 있습니다.' }));
        return;
      }

      const reply = await runAgent(sessionId, message, context);

      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      });
      res.end(JSON.stringify(reply));
      return;
    }

    if (req.method === 'POST' && req.url === '/api/reset') {
      const body = await readJsonBody(req);
      const sessionId = String(body.sessionId ?? '').trim();

      if (sessionId) {
        sessions.delete(sessionId);
      }

      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.method === 'GET' && req.url === '/') {
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      });
      res.end(JSON.stringify({
        ok: true,
        service: 'PlugPark Local AI Bridge',
        health: '/health',
      }));
      return;
    }

    res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Not Found' }));
  } catch (error) {
    console.error(error);

    res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      error: error instanceof Error ? error.message : String(error),
    }));
  }
});

server.listen(PORT, HOST, () => {
  console.log('');
  console.log('PlugPark Local AI Bridge');
  console.log(`http://${HOST}:${PORT}`);
  console.log(`Model: ${MODEL}`);
  console.log(`MCP Tools: ${mcpTools.map((tool) => tool.name).join(', ')}`);
  console.log('');
});

async function shutdown() {
  server.close();
  await client.close();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
