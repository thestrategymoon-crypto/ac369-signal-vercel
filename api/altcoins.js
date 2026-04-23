// api/altcoins.js - AC369 FUSION Final (Anti Blokir)
const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'id-ID,id;q=0.9'
};

async function fetchWithRetry(url, retries = 2) {
  for (let i = 0; i < retries; i++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(url, { headers: FETCH_HEADERS, signal: controller.signal });
      clearTimeout(timeout);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      if (i === retries - 1) throw e;
      await new Promise(r => setTimeout(r, 1000));
    }
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'max-age=0, s-maxage=60');

  const fallback = {
    timestamp: new Date().toISOString(),
    topGainers: [],
    volumeBreakouts: [],
    rsiExtremes: [],
    narrative: 'Data altcoin sementara tidak tersedia.'
  };

  try {
    console.log('[Altcoins] Fetch ticker dengan User-Agent...');
    const all = await fetchWithRetry('https://api.binance.com/api/v3/ticker/24hr');
    const usdtPairs = all.filter(t => 
      t.symbol.endsWith('USDT') && 
      !t.symbol.includes('BUSD') && 
      !t.symbol.includes('TUSD') &&
      !t.symbol.includes('USDC')
    );

    // Top Gainers
    const topGainers = usdtPairs
      .sort((a, b) => parseFloat(b.priceChangePercent) - parseFloat(a.priceChangePercent))
      .slice(0, 10)
      .map(t => ({
        symbol: t.symbol.replace('USDT', ''),
        price: parseFloat(t.lastPrice).toFixed(4),
        change24h: parseFloat(t.priceChangePercent).toFixed(2) + '%'
      }));

    // Volume Breakouts (median)
    const volumes = usdtPairs.map(t => parseFloat(t.quoteVolume)).filter(v => !isNaN(v));
    volumes.sort((a,b) => a-b);
    const medianVol = volumes[Math.floor(volumes.length/2)] || 1000000;
    const breakouts = usdtPairs
      .filter(t => parseFloat(t.quoteVolume) > medianVol * 3)
      .slice(0, 5)
      .map(t => ({
        symbol: t.symbol.replace('USDT', ''),
        price: parseFloat(t.lastPrice).toFixed(4),
        volumeRatio: (parseFloat(t.quoteVolume) / medianVol).toFixed(1) + 'x'
      }));

    // RSI untuk 7 koin utama
    const majors = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'ADAUSDT', 'XRPUSDT', 'DOGEUSDT'];
    const rsiExtremes = [];
    for (const sym of majors) {
      try {
        const klines = await fetchWithRetry(`https://api.binance.com/api/v3/klines?symbol=${sym}&interval=1h&limit=100`);
        const closes = klines.map(k => parseFloat(k[4])).filter(v => !isNaN(v) && v > 0);
        if (closes.length < 14) continue;
        const rsi = calculateRSI(closes);
        const ticker = usdtPairs.find(t => t.symbol === sym);
        let price = 'N/A';
        if (ticker) {
          const p = parseFloat(ticker.lastPrice);
          if (!isNaN(p)) price = p.toFixed(4);
        }
        let condition = 'Netral';
        if (rsi < 30) condition = 'Jenuh Jual';
        else if (rsi > 70) condition = 'Jenuh Beli';
        rsiExtremes.push({
          symbol: sym.replace('USDT', ''),
          price,
          rsi: rsi.toFixed(2),
          condition
        });
      } catch (e) {
        console.warn(`[Altcoins] Gagal RSI ${sym}:`, e.message);
      }
    }

    const narrative = topGainers.length > 0
      ? `🔥 Top gainer: ${topGainers[0].symbol} (+${topGainers[0].change24h}). `
      : '';

    res.status(200).json({
      timestamp: new Date().toISOString(),
      topGainers,
      volumeBreakouts: breakouts,
      rsiExtremes,
      narrative: narrative || 'Belum ada data gainer signifikan.'
    });
  } catch (e) {
    console.error('[Altcoins] Error:', e.message);
    res.status(200).json(fallback);
  }
}

function calculateRSI(prices, period = 14) {
  if (prices.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = prices.length - period; i < prices.length; i++) {
    const diff = prices[i] - prices[i - 1];
    if (diff > 0) gains += diff;
    else losses -= diff;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  return 100 - (100 / (1 + avgGain / avgLoss));
}
