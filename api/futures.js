// api/futures.js — Vercel serverless function
// Proxies Binance Futures API (fapi.binance.com)

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=120');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { endpoint, ...params } = req.query;
  if (!endpoint) return res.status(400).json({ error: 'endpoint required' });

  const qs = new URLSearchParams(params).toString();
  const url = `https://fapi.binance.com/${endpoint}${qs ? '?' + qs : ''}`;

  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'AC369/1.0' },
      signal: AbortSignal.timeout(10000),
    });
    const data = await r.json();
    return res.status(r.ok ? 200 : r.status).json(data);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
