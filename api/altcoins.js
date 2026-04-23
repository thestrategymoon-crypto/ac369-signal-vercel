// api/altcoins.js - AC369 FUSION Final Stable
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'max-age=0, s-maxage=60');

  const fallbackResponse = {
    timestamp: new Date().toISOString(),
    topGainers: [],
    volumeBreakouts: [],
    rsiExtremes: [],
    narrative: 'Data altcoin sementara tidak tersedia.'
  };

  try {
    console.log('[Altcoins] Fetch ticker...');
    const resp = await fetch('https://api.binance.com/api/v3/ticker/24hr');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const all = await resp.json();

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

    // Volume Breakouts (sederhana)
    const volumes = usdtPairs.map(t => parseFloat(t.quoteVolume)).filter(v => !isNaN(v));
    volumes.sort((a,b) => a-b);
    const medianVol = volumes[Math.floor(volumes.length/2)] || 1000000;
    const breakouts = usdtPairs
      .filter(t => parseFloat(t.quoteVolume) > medianVol * 3)
      .slice(0, 5)
      .map(t => ({
        symbol: t.symbol.replace('USDT', ''),
        price: parseFloat(t.lastPrice).toFixed(4),
        volumeRatio: (parseFloat(t.quoteVolume) / medianVol).toFixed(1) + 'x',
        narrative: 'Volume di atas rata-rata'
      }));

    // RSI untuk koin utama
    const majors = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'ADAUSDT', 'XRPUSDT', 'DOGEUSDT'];
    const rsiExtremes = [];
    for (const sym of majors) {
      try {
        const kUrl = `https://api.binance.com/api/v3/klines?symbol=${sym}&interval=1h&limit=100`;
        const kRes = await fetch(kUrl);
        if (!kRes.ok) continue;
        const klines = await kRes.json();
        const closes = klines.map(k => parseFloat(k[4])).filter(v => !isNaN(v) && v > 0);
        if (closes.length < 14) continue;
        const rsi = calculateRSI(closes);
        if (isNaN(rsi)) continue;
        const ticker = usdtPairs.find(t => t.symbol === sym);
        let price = 'N/A';
        if (ticker) {
          const p = parseFloat(ticker.lastPrice);
          if (!isNaN(p)) price = p.toFixed(4);
        }
        let condition = 'Neutral';
        if (rsi < 30) condition = 'Oversold (Peluang Beli)';
        else if (rsi > 70) condition = 'Overbought (Hati-hati)';
        rsiExtremes.push({
          symbol: sym.replace('USDT', ''),
          price: price,
          rsi: rsi.toFixed(2),
          condition: condition
        });
      } catch (ex) {
        // abaikan
      }
    }

    const narrative = `🔥 Top gainer: ${topGainers[0]?.symbol || 'N/A'} (+${topGainers[0]?.change24h || '0%'}). ` +
      (rsiExtremes.filter(r => r.condition.includes('Oversold')).map(r => r.symbol).join(', ') || 'Tidak ada RSI oversold.');

    res.status(200).json({
      timestamp: new Date().toISOString(),
      topGainers,
      volumeBreakouts: breakouts,
      rsiExtremes,
      narrative
    });
  } catch (error) {
    console.error('[Altcoins] Error:', error);
    res.status(200).json(fallbackResponse);
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
