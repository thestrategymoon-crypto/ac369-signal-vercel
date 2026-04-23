// api/altcoins.js - AC369 FUSION Altcoin Scanner (Optimized)
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'max-age=0, s-maxage=60');

  try {
    // Fetch ticker 24h dari Binance dengan timeout 8 detik
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    const response = await fetch('https://api.binance.com/api/v3/ticker/24hr', {
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    const allTickers = await response.json();

    // Filter pair USDT dengan volume > $2M dan exclude stablecoin/weird pairs
    const usdtPairs = [];
    for (let i = 0; i < allTickers.length; i++) {
      const t = allTickers[i];
      if (!t.symbol.endsWith('USDT')) continue;
      if (t.symbol.includes('BUSD') || t.symbol.includes('TUSD') || t.symbol.includes('USDC')) continue;
      if (t.symbol.includes('BULL') || t.symbol.includes('BEAR')) continue;
      if (t.symbol.includes('UP') || t.symbol.includes('DOWN')) continue;

      const volume = parseFloat(t.quoteVolume);
      if (volume > 2000000) {
        usdtPairs.push(t);
      }
    }

    // 1. Top Gainers (urutkan berdasarkan priceChangePercent)
    const gainers = [...usdtPairs]
      .sort((a, b) => parseFloat(b.priceChangePercent) - parseFloat(a.priceChangePercent))
      .slice(0, 15)
      .map(t => ({
        symbol: t.symbol.replace('USDT', ''),
        price: parseFloat(t.lastPrice).toFixed(4),
        change24h: parseFloat(t.priceChangePercent).toFixed(2) + '%',
        volume24h: (parseFloat(t.quoteVolume) / 1e6).toFixed(2) + 'M'
      }));

    // 2. Volume Breakout (hanya perkiraan dari volume 24h vs rata-rata sederhana)
    // Karena kita tidak fetch klines, kita gunakan perbandingan dengan volume median
    const volumes = usdtPairs.map(t => parseFloat(t.quoteVolume));
    volumes.sort((a, b) => a - b);
    const medianVolume = volumes[Math.floor(volumes.length / 2)];

    const breakouts = [];
    for (let i = 0; i < usdtPairs.length; i++) {
      const t = usdtPairs[i];
      const vol = parseFloat(t.quoteVolume);
      if (vol > medianVolume * 3) {
        breakouts.push({
          symbol: t.symbol.replace('USDT', ''),
          price: parseFloat(t.lastPrice).toFixed(4),
          volumeRatio: (vol / medianVolume).toFixed(2) + 'x',
          change24h: parseFloat(t.priceChangePercent).toFixed(2) + '%',
          narrative: vol > medianVolume * 5 ? '🔥 Volume ekstrem' : '📊 Volume di atas rata-rata'
        });
      }
    }
    // Urutkan berdasarkan volume ratio
    breakouts.sort((a, b) => parseFloat(b.volumeRatio) - parseFloat(a.volumeRatio));

    // 3. RSI Ekstrem (untuk major coins)
    // Kita fetch klines hanya untuk 7 koin utama, bukan semua
    const majorSymbols = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'ADAUSDT', 'XRPUSDT', 'DOGEUSDT'];
    const rsiData = [];

    for (const sym of majorSymbols) {
      try {
        const klinesRes = await fetch(`https://api.binance.com/api/v3/klines?symbol=${sym}&interval=1h&limit=100`);
        const klines = await klinesRes.json();
        const closes = klines.map(k => parseFloat(k[4]));
        const rsi = calculateRSI(closes, 14);

        let condition = 'Neutral';
        if (rsi < 30) condition = 'Oversold (Peluang Beli)';
        else if (rsi > 70) condition = 'Overbought (Hati-hati)';

        const ticker = usdtPairs.find(t => t.symbol === sym);
        const price = ticker ? parseFloat(ticker.lastPrice).toFixed(4) : 'N/A';

        rsiData.push({
          symbol: sym.replace('USDT', ''),
          price: price,
          rsi: rsi.toFixed(2),
          condition: condition
        });
      } catch (e) {
        rsiData.push({
          symbol: sym.replace('USDT', ''),
          price: 'N/A',
          rsi: 'N/A',
          condition: 'Gagal fetch'
        });
      }
    }

    // 4. Narasi Altcoin
    const narrative = generateNarrative(gainers, breakouts, rsiData);

    res.status(200).json({
      timestamp: new Date().toISOString(),
      topGainers: gainers,
      volumeBreakouts: breakouts.slice(0, 10),
      rsiExtremes: rsiData,
      narrative: narrative
    });

  } catch (error) {
    console.error('Altcoins API Error:', error);
    res.status(500).json({
      error: error.message,
      topGainers: [],
      volumeBreakouts: [],
      rsiExtremes: [],
      narrative: 'Gagal mengambil data altcoin. Coba lagi nanti.'
    });
  }
}

// Fungsi hitung RSI
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
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

// Fungsi generate narasi
function generateNarrative(gainers, breakouts, rsi) {
  const parts = [];

  if (gainers.length > 0) {
    parts.push(`Top gainer: ${gainers[0].symbol} (+${gainers[0].change24h})`);
  }

  if (breakouts.length > 0) {
    parts.push(`${breakouts.length} koin dengan volume di atas 3x rata-rata`);
  }

  const oversold = rsi.filter(r => r.condition.includes('Oversold')).map(r => r.symbol);
  if (oversold.length > 0) {
    parts.push(`RSI oversold: ${oversold.join(', ')}`);
  }

  const overbought = rsi.filter(r => r.condition.includes('Overbought')).map(r => r.symbol);
  if (overbought.length > 0) {
    parts.push(`RSI overbought: ${overbought.join(', ')}`);
  }

  return parts.length > 0 ? parts.join('. ') + '.' : 'Tidak ada sinyal altcoin signifikan.';
}
