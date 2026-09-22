import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const BASE_URL = process.env.PLUGPARK_URL || 'https://plugpark.dtdt4865.workers.dev';
const rl = createInterface({ input, output });
let token = (process.env.PLUGPARK_INGEST_TOKEN || '').trim();
if (!token) token = (await rl.question('PLUGPARK_INGEST_TOKEN을 입력하세요: ')).trim();
rl.close();
if (!token) throw new Error('PLUGPARK_INGEST_TOKEN이 필요합니다.');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function postStage(stage) {
  let lastError = null;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      process.stdout.write(`D1 read model ${stage} ... `);
      const response = await fetch(`${BASE_URL}/api/admin/d1/prepare-read-models?stage=${stage}`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });
      const raw = await response.text();
      let data;
      try { data = JSON.parse(raw); } catch { data = { error: raw.slice(0, 500) }; }
      if (!response.ok || !data.ok) throw new Error(data.error || `HTTP ${response.status}`);
      console.log('OK');
      return data;
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      console.log(`실패 (${message})`);

      const isDailyD1Quota =
        message.includes("exceeded D1's free tier daily row write limit") ||
        message.includes("exceeded D1's free tier daily row read limit");

      if (isDailyD1Quota) {
        console.error('');
        console.error('⛔ D1 Free 일일 한도 초과 — 재시도해도 성공하지 않습니다.');
        console.error('   Cloudflare Free 한도는 00:00 UTC(한국시간 09:00)에 초기화됩니다.');
        console.error('   이미 배포된 v0.6.0은 그대로 두고, 한도 초기화 후 npm run resume:v0.6 만 실행하세요.');
        throw error;
      }

      if (attempt < 5) {
        const waitMs = [1000, 2500, 5000, 8000][attempt - 1] ?? 8000;
        console.log(`  ↻ ${Math.round(waitMs / 1000)}초 후 재시도 ${attempt + 1}/5`);
        await sleep(waitMs);
      }
    }
  }
  throw lastError;
}

for (const stage of ['stations', 'parking', 'matches']) {
  await postStage(stage);
}

const stateResponse = await fetch(`${BASE_URL}/api/d1/read-model-state?v=60`, { headers: { Accept: 'application/json' } });
const state = await stateResponse.json();
console.log('\nPlugPark v0.6.0 read model 준비 완료');
console.log(JSON.stringify(state, null, 2));
if (!state?.ready) process.exitCode = 2;
