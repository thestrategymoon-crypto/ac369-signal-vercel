// api/scanner-full.js - AC369 FUSION Scanner (Versi Ringan)
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'max-age=0, s-maxage=300');

  try {
    const allCoins = [];
    const pages = 2; // 500 koin
    
    for (let page = 1; page <= pages; page++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      
      try {
        const response = await fetch(
          `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=${page}&sparkline=false&price_change_percentage=24h`,
          { signal: controller.signal }
        );
        clearTimeout(timeoutId);
        const data = await response.json();
        for (let i = 0; i < data.length; i++) allCoins.push(data[i]);
      } catch (e) {
        clearTimeout(timeoutId);
      }
      
      if (page < pages) await new Promise(r => setTimeout(r, 1000));
    }

    const filteredCoins = [];
    for (let i = 0; i < allCoins.length; i++) {
      const c = allCoins[i];
      if (c.total_volume > 3000000 && c.market_cap > 30000000) {
        filteredCoins.push(c);
      }
    }

    const results = [];
    for (let i = 0; i < filteredCoins.length; i += 5) {
      const batch = filteredCoins.slice(i, i + 5).map(coin => analyzeCoinSimple(coin));
      const settled = await Promise.allSettled(batch);
      for (let j = 0; j < settled.length; j++) {
        if (settled[j].status === 'fulfilled' && settled[j].value) {
          results.push(settled[j].value);
        }
      }
      await new Promise(r => setTimeout(r, 200));
    }

    results.sort((a, b) => b.breakoutProbability.score - a.breakoutProbability.score);

    res.status(200).json({
      timestamp: new Date().toISOString(),
      totalScanned: filteredCoins.length,
      results: results.slice(0, 40)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function analyzeCoinSimple(coin) {
  const symbol = coin.symbol.toUpperCase();
  
  let ohlcv = null;
  let chartPatterns = [];
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}USDT&interval=1d&limit=30`, { signal: controller.signal });
    clearTimeout(timeoutId);
    
    if (res.ok) {
      const data = await res.json();
      ohlcv = data.map(c => ({
        open: parseFloat(c[1]), high: parseFloat(c[2]), low: parseFloat(c[3]), close: parseFloat(c[4]), volume: parseFloat(c[5])
      }));
      if (ohlcv.length >= 3) chartPatterns = detectChartPatterns(ohlcv);
    }
  } catch (e) {
    // Lanjut tanpa OHLCV
  }

  const breakoutProb = calculateBreakoutScore(coin, ohlcv, chartPatterns);

  return {
    symbol,
    name: coin.name,
    price: coin.current_price,
    volume24h: coin.total_volume,
    priceChange24h: coin.price_change_percentage_24h,
    breakoutProbability: breakoutProb,
    chartPatterns: chartPatterns.slice(0, 3),
    elliottWave: { wave: '-', confidence: 0, description: '' },
    smc: { signal: 'Neutral', summary: '' }
  };
}

function detectChartPatterns(ohlcv) {
  const patterns = [];
  const last = ohlcv[ohlcv.length - 1];
  const prev = ohlcv[ohlcv.length - 2];
  
  if (prev.close < prev.open && last.close > last.open && last.close > prev.open) {
    patterns.push({ name: 'Bullish Engulfing', signal: 'bullish', probability: 70 });
  }
  if (prev.close > prev.open && last.close < last.open && last.close < prev.open) {
    patterns.push({ name: 'Bearish Engulfing', signal: 'bearish', probability: 70 });
  }
  const body = Math.abs(last.close - last.open);
  const lowerWick = Math.min(last.open, last.close) - last.low;
  if (lowerWick > body * 2) patterns.push({ name: 'Hammer', signal: 'bullish', probability: 65 });
  
  return patterns;
}

function calculateBreakoutScore(coin, ohlcv, patterns) {
  let score = 50;
  const reasons = [];
  const change = coin.price_change_percentage_24h || 0;
  
  if (change > 10) { score += 20; reasons.push(`+${change.toFixed(1)}%`); }
  else if (change > 5) { score += 10; reasons.push(`+${change.toFixed(1)}%`); }
  else if (change < -5) { score -= 10; reasons.push(`${change.toFixed(1)}%`); }

  if (ohlcv && ohlcv.length >= 20) {
    const last = ohlcv[ohlcv.length - 1];
    const avgVol = ohlcv.slice(-20, -1).reduce((s, c) => s + c.volume, 0) / 20;
    if (last.volume > avgVol * 2) { score += 15; reasons.push('Volume spike'); }
  }

  const bullish = patterns.filter(p => p.signal === 'bullish');
  if (bullish.length) { score += 10; reasons.push(bullish[0].name); }

  score = Math.max(0, Math.min(100, score));
  return {
    score: Math.round(score),
    reasons: reasons.slice(0, 3),
    interpretation: score >= 70 ? '🔥 Tinggi' : score >= 50 ? '📈 Pantau' : '💤 Rendah'
  };
}
