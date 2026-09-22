const BASE_URL = process.env.PLUGPARK_URL || 'https://plugpark.dtdt4865.workers.dev';

async function show(path) {
  const r = await fetch(`${BASE_URL}${path}`, { headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' } });
  const raw = await r.text();
  try { console.log(`\n${path}\n${JSON.stringify(JSON.parse(raw), null, 2)}`); }
  catch { console.log(`\n${path}\nHTTP ${r.status}\n${raw.slice(0, 1000)}`); }
}

await show('/api/health?status=62');
await show('/api/d1/ev-info-state?status=62');
await show('/api/d1/read-model-state?status=62');
