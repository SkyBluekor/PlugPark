import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const PROBE_FILE = resolve('.plugpark', 'parking-api-probe.json');
const CONFIG_FILE = resolve('.plugpark', 'parking-api-config.json');

function parseEnvText(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

async function localEnv() {
  const p = resolve('.dev.vars');
  if (!existsSync(p)) return {};
  return parseEnvText(await readFile(p, 'utf8'));
}

function normalizedEndpoint(input) {
  const u = new URL(input);
  u.searchParams.delete('serviceKey');
  u.searchParams.delete('ServiceKey');
  return u.toString();
}

function endpointHash(input) {
  return createHash('sha256').update(normalizedEndpoint(input)).digest('hex');
}

function findWranglerCli() {
  for (const rel of [
    ['node_modules','wrangler','bin','wrangler.js'],
    ['node_modules','wrangler','bin','wrangler.cjs'],
  ]) {
    const full = resolve(...rel);
    if (existsSync(full)) return full;
  }
  throw new Error('로컬 Wrangler CLI를 찾지 못했습니다. npm install 상태를 확인하세요.');
}

console.log('\nPlugPark parking API remote configuration');
console.log('조건: 실제 API probe PASS 이후에만 URL 설정 · D1 write 0\n');

if (!existsSync(PROBE_FILE)) {
  throw new Error('parking-api-probe.json이 없습니다. npm run probe:parking-api를 먼저 실행하세요.');
}

const probe = JSON.parse(await readFile(PROBE_FILE, 'utf8'));
if (
  probe.ok !== true ||
  probe.releaseReady !== true ||
  Number(probe.publicApiCalls || 0) !== 1 ||
  Number(probe.remoteD1Writes || 0) !== 0
) {
  throw new Error('Parking API probe가 release-ready PASS가 아닙니다.');
}

const envFile = await localEnv();
const rawEndpoint = String(process.env.BUSAN_REALTIME_PARKING_API_URL || envFile.BUSAN_REALTIME_PARKING_API_URL || '').trim();
if (!rawEndpoint) throw new Error('BUSAN_REALTIME_PARKING_API_URL이 없습니다.');

const cleanEndpoint = normalizedEndpoint(rawEndpoint);
if (endpointHash(cleanEndpoint) !== probe.endpointHash) {
  throw new Error('현재 URL과 probe한 URL이 다릅니다. npm run probe:parking-api를 다시 실행하세요.');
}

const cli = findWranglerCli();
const result = spawnSync(
  process.execPath,
  [cli, 'secret', 'put', 'BUSAN_REALTIME_PARKING_API_URL'],
  {
    cwd: ROOT,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    input: cleanEndpoint + '\n',
    env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' },
  },
);

if (result.error) throw result.error;
if (result.status !== 0) {
  process.stderr.write(result.stderr || '');
  throw new Error('Cloudflare BUSAN_REALTIME_PARKING_API_URL 설정 실패');
}

await mkdir(resolve('.plugpark'), { recursive: true });
await writeFile(CONFIG_FILE, JSON.stringify({
  configuredAt: new Date().toISOString(),
  endpointHash: endpointHash(cleanEndpoint),
  remoteConfigWrites: 1,
  remoteD1Writes: 0,
}, null, 2) + '\n', 'utf8');

console.log('✅ Remote BUSAN_REALTIME_PARKING_API_URL 설정 완료');
console.log('serviceKey는 URL에서 제거했고 기존 BUSAN_PARKING_API_KEY secret을 사용합니다.');
console.log('config receipt:', CONFIG_FILE);
console.log('Remote D1 write: 0');
