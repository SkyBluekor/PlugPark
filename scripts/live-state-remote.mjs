const BASE_URL = process.env.PLUGPARK_URL || 'https://plugpark.dtdt4865.workers.dev';

for (const path of ['/api/health?live-state=1', '/api/d1/live-state?live-state=1', '/api/places?live-state=1']) {
  const r = await fetch(`${BASE_URL}${path}`, { headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' } });
  const raw = await r.text();
  console.log(`\n${path} · HTTP ${r.status}`);
  try { console.log(JSON.stringify(JSON.parse(raw), null, 2)); }
  catch { console.log(raw.slice(0, 1000)); }
}
