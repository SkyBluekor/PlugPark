import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

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

const devVars = resolve('.dev.vars');
const fileEnv = existsSync(devVars) ? parseEnvText(await readFile(devVars, 'utf8')) : {};
const endpoint = String(
  process.env.BUSAN_REALTIME_PARKING_API_URL ||
  fileEnv.BUSAN_REALTIME_PARKING_API_URL ||
  'https://apis.data.go.kr/B552587/ParkingInfoService_v2'
).trim();

if (!endpoint) {
  console.error('\n[BLOCKED] 부산시설공단 ParkingInfoService_v2 endpoint를 결정하지 못했습니다.');
  process.exit(2);
}

try {
  const u = new URL(endpoint);
  if (!['http:','https:'].includes(u.protocol)) throw new Error('http/https가 아님');
} catch {
  console.error('[BLOCKED] BUSAN_REALTIME_PARKING_API_URL 형식이 올바르지 않습니다.');
  process.exit(2);
}

console.log('Parking endpoint presence ... PASS');
