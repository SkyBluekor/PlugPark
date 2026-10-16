import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function load(file, globals = {}) {
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInNewContext(source, { module, exports: module.exports, URL, Request, Response, Headers, AbortSignal, console, ...globals }, { filename: file });
  return module.exports;
}
const worker = load('worker/index.ts').default;
const env = {
  VITE_KAKAO_MAP_JS_KEY: 'public-javascript-sdk-key',
  EV_CHARGER_API_KEY: 'private-ev-key',
  INGEST_ADMIN_TOKEN: 'private-admin-token',
  Kakao_Developers_REST_API: 'private-rest-key',
  DB: new Proxy({}, { get() { throw new Error('Client config must not access D1'); } }),
};
const request = () => new Request('https://example.test/api/client-config');
const response = await worker.fetch(request(), env, {});
assert.equal(response.status, 200);
assert.equal(response.headers.get('cache-control'), 'no-store');
assert.deepEqual(await response.json(), { ok: true, kakaoMapJsKey: env.VITE_KAKAO_MAP_JS_KEY });
assert.equal((await worker.fetch(request(), {}, {})).status, 503);
assert.equal((await worker.fetch(new Request(request(), { method: 'POST' }), env, {})).status, 405);

function sdkHarness(runtimeEnv) {
  const stats = { configRequests: 0, scripts: 0 };
  const window = { setTimeout, clearTimeout };
  let currentScript;
  const document = {
    querySelector: () => currentScript ?? null,
    createElement: () => ({ dataset: {}, remove() { currentScript = null; } }),
    head: { appendChild(script) {
      currentScript = script;
      stats.scripts += 1;
      assert(script.src.includes('libraries=services'));
      window.kakao = { maps: { services: {}, load: (callback) => callback() } };
      queueMicrotask(() => script.onload());
    } },
  };
  const sdk = load('src/services/kakaoSdk.ts', {
    window, document,
    fetch: async (path, options) => {
      stats.configRequests += 1;
      assert.equal(path, '/api/client-config');
      assert.equal(options.cache, 'no-store');
      return worker.fetch(request(), runtimeEnv, {});
    },
  });
  return { sdk, stats };
}
// The browser bundle has NO VITE key, exactly like a cloud build without .env.
const runtime = sdkHarness(env);
const maps = await Promise.all([runtime.sdk.loadKakaoMapSdk(''), runtime.sdk.loadKakaoMapSdk('')]);
assert(maps.every((item) => item.maps.services));
assert.equal(runtime.stats.configRequests, 1, 'Map and search should share the config request');
assert.equal(runtime.stats.scripts, 1);

const baked = sdkHarness({});
await baked.sdk.loadKakaoMapSdk('local-public-sdk-key');
assert.equal(baked.stats.configRequests, 0, 'Local .env key should continue to work');

const retryEnv = {};
const retry = sdkHarness(retryEnv);
await assert.rejects(retry.sdk.loadKakaoMapSdk(''), /KAKAO_APP_KEY_MISSING/);
retryEnv.VITE_KAKAO_MAP_JS_KEY = 'configured-later';
await retry.sdk.loadKakaoMapSdk('');
assert.equal(retry.stats.configRequests, 2, 'Failed configuration loads must be retryable');
console.log('Map config: absent build key → runtime key → SDK; shared request; retry; local fallback; only public JS key; no D1 access ... PASS');
