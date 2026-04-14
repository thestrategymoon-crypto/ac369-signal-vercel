// api/binance.js — Vercel serverless function
// Proxies Binance API calls server-side (zero CORS issues)

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 's-maxage=15, stale-while-revalidate=60');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { path, ...params } = req.query;
  if (!path) return res.status(400).json({ error: 'path required' });

  const apiPath = Array.isArray(path) ? path.join('/') : path;
  const qs = new URLSearchParams(params).toString();
  const url = `https://api.binance.com/api/v3/${apiPath}${qs ? '?' + qs : ''}`;

  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'AC369/1.0' },
      signal: AbortSignal.timeout(12000),
    });
    const data = await r.json();
    return res.status(r.ok ? 200 : r.status).json(data);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
