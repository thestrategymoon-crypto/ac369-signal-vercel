// api/scanner.js - Mesin Pemindai Altcoin Cerdas AC369 FUSION
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'max-age=0, s-maxage=60'); // Cache 1 menit

  try {
    // Ambil data dari berbagai sumber secara paralel
    const [tickers, topGainers, volumeBreakouts, rsiExtremes] = await Promise.allSettled([
      fetchAllTickers(),
      fetchTopGainers(),
      fetchVolumeBreakouts(),
      fetchRSIExtremes()
    ]);

    const result = {
      timestamp: new Date().toISOString(),
      dailyOpportunities: getValue(topGainers, []).slice(0, 5), // 5 koin teratas untuk daily
      swingOpportunities: getValue(volumeBreakouts, []), // Koin dengan volume spike untuk swing
      rsiAlerts: getValue(rsiExtremes, []), // Koin dengan RSI ekstrem
      marketSummary: generateSummary(getValue(topGainers, []), getValue(volumeBreakouts, []))
    };

    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

function getValue(promise, fallback) {
  return promise.status === 'fulfilled' ? promise.value : fallback;
}

// Mengambil semua ticker USDT dari Binance
async function fetchAllTickers() {
  const res = await fetch('https://api.binance.com/api/v3/ticker/24hr');
  const data = await res.json();
  // Filter hanya pair USDT, volume > $2M, dan bukan stablecoin
  return data.filter(t => 
    t.symbol.endsWith('USDT') && 
    !t.symbol.includes('BUSD') && 
    !t.symbol.includes('TUSD') &&
    !t.symbol.includes('USDC') &&
    parseFloat(t.quoteVolume) > 2000000
  );
}

// Mendapatkan koin dengan kenaikan harga tertinggi (untuk daily trading)
async function fetchTopGainers() {
  const tickers = await fetchAllTickers();
  return tickers
    .sort((a, b) => parseFloat(b.priceChangePercent) - parseFloat(a.priceChangePercent))
    .slice(0, 15)
    .map(t => ({
      symbol: t.symbol.replace('USDT', ''),
      price: parseFloat(t.lastPrice).toFixed(4),
      change24h: parseFloat(t.priceChangePercent).toFixed(2) + '%',
      volume24h: (parseFloat(t.quoteVolume) / 1e6).toFixed(2) + 'M',
      strategy: 'Daily Momentum'
    }));
}

// Mendeteksi koin dengan volume spike (untuk swing trading)
async function fetchVolumeBreakouts() {
  const tickers = await fetchAllTickers();
  const breakouts = [];
  
  // Batasi ke 30 koin teratas untuk efisiensi
  for (const t of tickers.slice(0, 40)) {
    try {
      const klinesRes = await fetch(`https://api.binance.com/api/v3/klines?symbol=${t.symbol}&interval=1h&limit=48`);
      const klines = await klinesRes.json();
      
      // Hitung volume rata-rata 24 jam terakhir
      const volumes = klines.slice(-24).map(k => parseFloat(k[5]));
      const avgVolume = volumes.reduce((a, b) => a + b, 0) / 24;
      const lastVolume = volumes[volumes.length - 1];
      const volumeRatio = lastVolume / avgVolume;
      
      // Jika volume saat ini 3x lebih besar dari rata-rata, itu adalah sinyal breakout
      if (volumeRatio > 3.0) {
        // Hitung juga kenaikan harga dalam 1 jam terakhir
        const prices = klines.slice(-2).map(k => parseFloat(k[4]));
        const priceChange = ((prices[1] - prices[0]) / prices[0]) * 100;
        
        breakouts.push({
          symbol: t.symbol.replace('USDT', ''),
          price: parseFloat(t.lastPrice).toFixed(4),
          volumeRatio: volumeRatio.toFixed(2) + 'x',
          priceChange1h: priceChange.toFixed(2) + '%',
          change24h: parseFloat(t.priceChangePercent).toFixed(2) + '%',
          strategy: 'Swing Breakout',
          strength: volumeRatio > 5 ? 'Sangat Kuat' : 'Kuat'
        });
      }
    } catch (e) {
      console.error(`Gagal memproses ${t.symbol}:`, e.message);
    }
  }
  
  return breakouts.sort((a, b) => parseFloat(b.volumeRatio) - parseFloat(a.volumeRatio)).slice(0, 10);
}

// Mendeteksi koin dengan RSI oversold/overbought
async function fetchRSIExtremes() {
  const tickers = await fetchAllTickers();
  const results = [];
  
  for (const t of tickers.slice(0, 50)) {
    try {
      const klinesRes = await fetch(`https://api.binance.com/api/v3/klines?symbol=${t.symbol}&interval=1h&limit=100`);
      const klines = await klinesRes.json();
      const closes = klines.map(k => parseFloat(k[4]));
      const rsi = calculateRSI(closes, 14);
      
      let condition = '';
      if (rsi < 30) condition = 'Oversold (Potensi Bounce)';
      else if (rsi > 70) condition = 'Overbought (Waspada Koreksi)';
      
      if (condition) {
        results.push({
          symbol: t.symbol.replace('USDT', ''),
          price: closes[closes.length - 1].toFixed(4),
          rsi: rsi.toFixed(2),
          condition: condition,
          strategy: rsi < 30 ? 'Buy the Dip' : 'Take Profit'
        });
      }
    } catch (e) {
      // Abaikan jika gagal
    }
  }
  
  return results.sort((a, b) => a.rsi - b.rsi);
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

function generateSummary(gainers, breakouts) {
  const topGainer = gainers[0]?.symbol || 'N/A';
  const breakoutCount = breakouts.length;
  return `Peluang hari ini: ${topGainer} memimpin kenaikan. Terdeteksi ${breakoutCount} altcoin dengan volume breakout >3x.`;
}
