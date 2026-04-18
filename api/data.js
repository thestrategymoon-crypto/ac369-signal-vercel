// api/data.js — Multi-source data proxy
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { source, ...params } = req.query;

  try {
    let url, data;

    if (source === 'feargreed') {
      // Alternative.me Fear & Greed Index
      url = 'https://api.alternative.me/fng/?limit=30&format=json';
      const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
      data = await r.json();

    } else if (source === 'coingecko_global') {
      url = 'https://api.coingecko.com/api/v3/global';
      const r = await fetch(url, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(10000)
      });
      data = await r.json();

    } else if (source === 'coingecko_trending') {
      url = 'https://api.coingecko.com/api/v3/search/trending';
      const r = await fetch(url, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(10000)
      });
      data = await r.json();

    } else if (source === 'binance_trades') {
      // Recent trades for CVD calculation
      const sym = params.symbol || 'BTCUSDT';
      url = `https://api.binance.com/api/v3/trades?symbol=${sym}&limit=1000`;
      const r = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(12000)
      });
      data = await r.json();

    } else if (source === 'binance_depth') {
      // Order book depth for imbalance
      const sym = params.symbol || 'BTCUSDT';
      url = `https://api.binance.com/api/v3/depth?symbol=${sym}&limit=50`;
      const r = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(8000)
      });
      data = await r.json();

    } else if (source === 'futures_liq') {
      // Liquidation orders (forced orders)
      const sym = params.symbol || 'BTCUSDT';
      url = `https://fapi.binance.com/fapi/v1/forceOrders?symbol=${sym}&limit=200`;
      const r = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(8000)
      });
      data = await r.json();

    } else if (source === 'futures_aggTrades') {
      // Aggregated trades for CVD futures
      const sym = params.symbol || 'BTCUSDT';
      url = `https://fapi.binance.com/fapi/v1/aggTrades?symbol=${sym}&limit=500`;
      const r = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(10000)
      });
      data = await r.json();

    } else if (source === 'futures_klines') {
      const sym = params.symbol || 'BTCUSDT';
      const interval = params.interval || '1h';
      const limit = params.limit || '48';
      url = `https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=${interval}&limit=${limit}`;
      const r = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(10000)
      });
      data = await r.json();

    } else if (source === 'futures_premiumIndex') {
      const sym = params.symbol || 'BTCUSDT';
      url = `https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${sym}`;
      const r = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(8000)
      });
      data = await r.json();

    } else {
      return res.status(400).json({ error: 'Unknown source: ' + source });
    }

    res.setHeader('Cache-Control', 's-maxage=15, stale-while-revalidate=30');
    return res.status(200).json(data);

  } catch (e) {
    return res.status(500).json({ error: e.message, source });
  }
}
