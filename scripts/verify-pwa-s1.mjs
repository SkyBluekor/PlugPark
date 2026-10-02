import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath));
const readText = (relativePath) => read(relativePath).toString('utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function pngSize(relativePath) {
  const bytes = read(relativePath);
  assert(bytes.length >= 24, `${relativePath}: PNG 파일이 너무 작습니다.`);
  assert(bytes.subarray(1, 4).toString('ascii') === 'PNG', `${relativePath}: PNG 형식이 아닙니다.`);
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
}

const manifest = JSON.parse(readText('public/manifest.webmanifest'));
assert(manifest.name?.includes('PlugPark'), 'manifest.name에 PlugPark가 필요합니다.');
assert(manifest.short_name === 'PlugPark', 'manifest.short_name이 PlugPark여야 합니다.');
assert(manifest.start_url === '/', 'manifest.start_url은 / 이어야 합니다.');
assert(manifest.display === 'standalone', 'manifest.display는 standalone이어야 합니다.');

const icon192 = pngSize('public/icons/plugpark-192.png');
const icon512 = pngSize('public/icons/plugpark-512.png');
const maskable512 = pngSize('public/icons/plugpark-maskable-512.png');
assert(icon192.width === 192 && icon192.height === 192, '192px 아이콘 크기가 올바르지 않습니다.');
assert(icon512.width === 512 && icon512.height === 512, '512px 아이콘 크기가 올바르지 않습니다.');
assert(maskable512.width === 512 && maskable512.height === 512, 'maskable 512px 아이콘 크기가 올바르지 않습니다.');

const sw = readText('public/service-worker.js');
assert(sw.includes("url.pathname.startsWith('/api/')"), 'Service Worker에 /api/* 제외 규칙이 없습니다.');
assert(sw.includes('event.respondWith(fetch(request))'), '/api/* NetworkOnly 처리가 없습니다.');
assert(sw.includes('self.skipWaiting()'), 'Service Worker 즉시 업데이트 설정이 없습니다.');
assert(sw.includes('self.clients.claim()'), 'Service Worker clients.claim 설정이 없습니다.');

const indexHtml = readText('index.html');
assert(indexHtml.includes('rel="manifest"'), 'index.html에 manifest 연결이 없습니다.');
assert(indexHtml.includes('/icons/plugpark-192.png'), 'index.html에 Apple touch icon 연결이 없습니다.');

const main = readText('src/main.tsx');
assert(main.includes("serviceWorker.register('/service-worker.js'"), 'Service Worker 등록 코드가 없습니다.');
assert(main.includes("updateViaCache: 'none'"), 'Service Worker 업데이트 캐시 방지 설정이 없습니다.');

const app = readText('src/App.tsx');
assert(app.includes("PwaActions"), 'App.tsx에 PWA UI가 연결되지 않았습니다.');

const pwaActions = readText('src/components/PwaActions.tsx');
assert(pwaActions.includes('QRCodeSVG'), 'QR 렌더링이 연결되지 않았습니다.');
assert(pwaActions.includes('window.location.origin'), 'QR URL은 현재 origin을 사용해야 합니다.');
assert(pwaActions.includes('beforeinstallprompt'), 'PWA 설치 이벤트 처리가 없습니다.');

const pkg = JSON.parse(readText('package.json'));
assert(pkg.dependencies?.['qrcode.react'], 'qrcode.react 의존성이 없습니다.');

console.log('PWA-S1 STATIC VERIFY PASS');
console.log({
  manifest: 'PASS',
  serviceWorker: 'PASS',
  apiNetworkOnly: 'PASS',
  icon192: `${icon192.width}x${icon192.height}`,
  icon512: `${icon512.width}x${icon512.height}`,
  maskable512: `${maskable512.width}x${maskable512.height}`,
  installUi: 'PASS',
  qrUsesCurrentOrigin: 'PASS',
});
