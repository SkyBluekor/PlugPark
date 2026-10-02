import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const siblingMcp = path.resolve(root, '..', 'PlugPark-MCP');
const mcpDir = path.resolve(process.env.PLUGPARK_MCP_DIR || siblingMcp);
const model = process.env.OLLAMA_MODEL?.trim() || 'qwen3.5:9b';
const bridgeUrl = process.env.VITE_LOCAL_AI_BRIDGE_URL?.trim() || 'http://127.0.0.1:3000';
const webUrl = process.env.PLUGPARK_WEB_URL?.trim() || 'https://plugpark.dtdt4865.workers.dev';
const noBrowser = process.env.PLUGPARK_NO_BROWSER === '1';
const REQUIRED_BRIDGE_API_VERSION = 'MCP_WEB_S2_V5';

const children = new Set();
let shuttingDown = false;
let startedOllama = false;

function mcpTsxCli() {
  const cli = path.resolve(mcpDir, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  if (!existsSync(cli)) {
    throw new Error(
      `PlugPark-MCP의 tsx 실행 파일을 찾지 못했습니다: ${cli}\n` +
      'D:\\Projects\\PlugPark-MCP에서 npm install을 한 번 실행해주세요.',
    );
  }
  return cli;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url, timeoutMs = 1800) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: controller.signal,
    });

    const body = await response.json().catch(() => ({}));
    return { response, body };
  } finally {
    clearTimeout(timer);
  }
}

async function isOllamaReady() {
  try {
    const { response } = await fetchJson('http://127.0.0.1:11434/api/tags');
    return response.ok;
  } catch {
    return false;
  }
}

async function getBridgeHealth() {
  try {
    const { response, body } = await fetchJson(`${bridgeUrl}/health`, 2500);
    return {
      reachable: true,
      ok: response.ok && body?.ok === true,
      body,
    };
  } catch {
    return {
      reachable: false,
      ok: false,
      body: null,
    };
  }
}

function assertCommand(command, args = ['--version']) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    shell: false,
  });

  if (result.error || result.status !== 0) {
    throw new Error(
      `${command} 실행 파일을 찾지 못했습니다. 먼저 설치 상태를 확인해주세요.`,
    );
  }
}

function modelInstalled() {
  const result = spawnSync('ollama', ['list'], {
    encoding: 'utf8',
    shell: false,
  });

  if (result.status !== 0) return false;

  return String(result.stdout || '')
    .split(/\r?\n/)
    .some((line) => line.trim().startsWith(model));
}

function track(child) {
  children.add(child);
  child.once('exit', () => children.delete(child));
  return child;
}

function killTree(child) {
  if (!child?.pid) return;

  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
      });
    } else {
      child.kill('SIGTERM');
    }
  } catch {
    // Best-effort cleanup only.
  }
}

function syncBridgeTemplate() {
  const source = path.resolve(root, 'tools', 'mcp-web-s1', 'bridge.ts');
  const target = path.resolve(mcpDir, 'src', 'bridge.ts');

  if (!existsSync(source)) {
    throw new Error(`Bridge template을 찾지 못했습니다: ${source}`);
  }

  const sourceText = readFileSync(source, 'utf8');
  const targetText = existsSync(target) ? readFileSync(target, 'utf8') : '';

  if (sourceText === targetText) {
    console.log('AI Bridge code    PASS  current');
    return target;
  }

  writeFileSync(target, sourceText, 'utf8');
  console.log('AI Bridge code    UPDATE');
  return target;
}

function syncNearbyMcpTool() {
  const source = path.resolve(root, 'tools', 'mcp-web-s1', 'nearby-tool.ts');
  const target = path.resolve(mcpDir, 'src', 'nearby-tool.ts');
  const serverPath = path.resolve(mcpDir, 'src', 'server.ts');

  if (!existsSync(source)) {
    throw new Error(`nearby-tool 템플릿을 찾지 못했습니다: ${source}`);
  }

  if (!existsSync(serverPath)) {
    throw new Error(`PlugPark-MCP server.ts를 찾지 못했습니다: ${serverPath}`);
  }

  const sourceText = readFileSync(source, 'utf8');
  const targetText = existsSync(target) ? readFileSync(target, 'utf8') : '';

  if (sourceText !== targetText) {
    writeFileSync(target, sourceText, 'utf8');
    console.log('Nearby MCP tool   UPDATE');
  } else {
    console.log('Nearby MCP tool   PASS  current');
  }

  let serverText = readFileSync(serverPath, 'utf8');
  const importLine = "import { registerNearbyPlacesTool } from './nearby-tool.ts';";

  if (!serverText.includes(importLine)) {
    serverText = `${importLine}\n${serverText}`;
  }

  if (!serverText.includes('// PLUGPARK_MCP_WEB_NEARBY_TOOL')) {
    const match = serverText.match(/(const server = new McpServer\(\{[\s\S]*?\}\);)/);

    if (!match) {
      throw new Error('PlugPark-MCP server.ts에서 McpServer 생성 위치를 찾지 못했습니다.');
    }

    serverText = serverText.replace(
      match[1],
      `${match[1]}\n\n  // PLUGPARK_MCP_WEB_NEARBY_TOOL\n  registerNearbyPlacesTool(server);`,
    );
  }

  writeFileSync(serverPath, serverText, 'utf8');
}

function openBrowser(url) {
  if (noBrowser) return;

  try {
    if (process.platform === 'win32') {
      const child = spawn('cmd', ['/c', 'start', '', url], {
        detached: true,
        stdio: 'ignore',
      });
      child.unref();
      return;
    }

    const command = process.platform === 'darwin' ? 'open' : 'xdg-open';
    const child = spawn(command, [url], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
  } catch {
    // Opening a browser is optional.
  }
}

async function waitUntil(check, timeoutMs, label) {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    if (await check()) return;
    await sleep(450);
  }

  throw new Error(`${label} 시작 확인 시간이 초과되었습니다.`);
}

async function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const child of [...children]) {
    killTree(child);
  }

  process.exit(code);
}

process.on('SIGINT', () => void shutdown(0));
process.on('SIGTERM', () => void shutdown(0));

async function main() {
  console.log('');
  console.log('==============================================================================');
  console.log('PLUGPARK LOCAL AI — ONE CLICK START');
  console.log('==============================================================================');
  console.log(`MCP project       ${mcpDir}`);
  console.log(`Model             ${model}`);
  console.log(`Bridge            ${bridgeUrl}`);
  console.log('');

  const serverPath = path.join(mcpDir, 'src', 'server.ts');

  if (!existsSync(serverPath)) {
    throw new Error(
      `PlugPark-MCP를 찾지 못했습니다: ${serverPath}\n` +
      'PLUGPARK_MCP_DIR 환경변수로 경로를 지정할 수 있습니다.',
    );
  }

  syncNearbyMcpTool();
  syncBridgeTemplate();

  assertCommand('ollama');

  if (await isOllamaReady()) {
    console.log('Ollama            PASS  already running');
  } else {
    console.log('Ollama            START');

    const child = track(
      spawn('ollama', ['serve'], {
        cwd: mcpDir,
        stdio: ['ignore', 'inherit', 'inherit'],
        windowsHide: true,
      }),
    );

    startedOllama = true;

    await waitUntil(isOllamaReady, 15000, 'Ollama');
    console.log('Ollama            PASS  started by launcher');

    child.once('exit', (code) => {
      if (!shuttingDown) {
        console.error(`Ollama exited unexpectedly: ${code}`);
      }
    });
  }

  if (!modelInstalled()) {
    throw new Error(
      `Ollama 모델이 없습니다: ${model}\n` +
      `한 번만 실행하세요: ollama pull ${model}`,
    );
  }

  console.log(`Model             PASS  ${model}`);

  const existingBridge = await getBridgeHealth();

  if (
    existingBridge.ok &&
    existingBridge.body?.apiVersion === REQUIRED_BRIDGE_API_VERSION
  ) {
    console.log('AI Bridge         PASS  already running');
    console.log('');
    console.log('PlugPark AI is ready.');
    console.log(`Open: ${webUrl}`);
    openBrowser(webUrl);

    if (startedOllama) {
      console.log('');
      console.log('이 창을 닫거나 Ctrl+C를 누르면 이 런처가 시작한 Ollama도 종료됩니다.');
      await new Promise(() => {});
    }

    return;
  }

  if (
    existingBridge.ok &&
    existingBridge.body?.apiVersion !== REQUIRED_BRIDGE_API_VERSION
  ) {
    throw new Error(
      '예전 AI Bridge가 아직 3000번 포트에서 실행 중입니다. ' +
      '기존 PlugPark AI 창을 한 번 닫고 START_PLUGPARK_AI.cmd를 다시 실행해주세요.',
    );
  }

  if (existingBridge.reachable && existingBridge.body?.reason === 'model_not_installed') {
    throw new Error(`AI Bridge는 실행 중이지만 모델 ${model}을 찾지 못했습니다.`);
  }

  console.log('AI Bridge         START');

  const bridge = track(
    spawn(process.execPath, [mcpTsxCli(), 'src/bridge.ts'], {
      cwd: mcpDir,
      env: {
        ...process.env,
        OLLAMA_MODEL: model,
      },
      stdio: 'inherit',
      windowsHide: true,
      shell: false,
    }),
  );

  bridge.once('exit', (code) => {
    if (!shuttingDown) {
      console.log('');
      console.log(`AI Bridge exited: ${code}`);
      void shutdown(code ?? 0);
    }
  });

  await waitUntil(
    async () => (await getBridgeHealth()).ok,
    30000,
    'PlugPark AI Bridge',
  );

  console.log('');
  console.log('==============================================================================');
  console.log('READY');
  console.log('==============================================================================');
  console.log('Ollama            PASS');
  console.log('Qwen              PASS');
  console.log('MCP Server        PASS');
  console.log('AI Bridge         PASS');
  console.log(`PlugPark          ${webUrl}`);
  console.log('');
  console.log('이제 브라우저의 오른쪽 아래 AI 버튼을 누르면 됩니다.');
  console.log('종료: Ctrl+C');
  console.log('');

  openBrowser(webUrl);

  await new Promise((resolve) => bridge.once('exit', resolve));
}

main().catch(async (error) => {
  console.error('');
  console.error('START FAIL');
  console.error(error instanceof Error ? error.message : String(error));
  await shutdown(1);
});
