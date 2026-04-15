export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { path, ...params } = req.query;
    if (!path) return res.status(400).json({ error: 'path required' });
    
    const qs = new URLSearchParams(params).toString();
    const url = `https://api.binance.com/api/v3/${path}${qs ? '?' + qs : ''}`;
    
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(12000),
    });
    
    const data = await r.json();
    res.setHeader('Cache-Control', 's-maxage=10');
    return res.status(r.status).json(data);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
