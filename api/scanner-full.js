// api/scanner-full.js - AC369 FUSION (Stabil Manual - Tanpa Pustaka Eksternal)
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'max-age=0, s-maxage=300');

  try {
    const allCoins = [];
    
    // Ambil 2 halaman dari CoinGecko (500 koin)
    for (let page = 1; page <= 2; page++) {
      try {
        const response = await fetch(
          `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=${page}&sparkline=false&price_change_percentage=24h`
        );
        const data = await response.json();
        data.forEach(c => allCoins.push(c));
      } catch (e) {
        console.error(`Gagal fetch halaman ${page}:`, e.message);
      }
      await new Promise(r => setTimeout(r, 500));
    }

    // Filter koin dengan volume dan market cap minimum
    const filteredCoins = allCoins.filter(c => c.total_volume > 2000000 && c.market_cap > 20000000);

    const results = [];
    const batchSize = 4;
    
    for (let i = 0; i < filteredCoins.length; i += batchSize) {
      const batch = filteredCoins.slice(i, i + batchSize).map(coin => analyzeCoin(coin));
      const settled = await Promise.allSettled(batch);
      
      settled.forEach(result => {
        if (result.status === 'fulfilled' && result.value) {
          results.push(result.value);
        }
      });
      
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

async function analyzeCoin(coin) {
  const symbol = coin.symbol.toUpperCase();
  
  let ohlcv = null;
  let chartPatterns = [];
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}USDT&interval=1d&limit=30`, {
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    
    if (res.ok) {
      const data = await res.json();
      ohlcv = data.map(c => ({
        open: parseFloat(c[1]),
        high: parseFloat(c[2]),
        low: parseFloat(c[3]),
        close: parseFloat(c[4]),
        volume: parseFloat(c[5])
      }));
      
      if (ohlcv.length >= 3) {
        chartPatterns = detectAllPatterns(ohlcv);
      }
    }
  } catch (e) {
    // Gagal fetch OHLCV, lanjut tanpa data pola
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

// ==================== DETEKSI POLA MANUAL (LENGKAP) ====================
function detectAllPatterns(ohlcv) {
  const patterns = [];
  const last = ohlcv[ohlcv.length - 1];
  const prev = ohlcv[ohlcv.length - 2];
  const prev2 = ohlcv.length > 2 ? ohlcv[ohlcv.length - 3] : null;
  
  const body = Math.abs(last.close - last.open);
  const prevBody = Math.abs(prev.close - prev.open);
  const upperWick = last.high - Math.max(last.open, last.close);
  const lowerWick = Math.min(last.open, last.close) - last.low;
  const range = last.high - last.low;
  
  // 1. Bullish Engulfing
  if (prev.close < prev.open && last.close > last.open && last.open < prev.close && last.close > prev.open) {
    patterns.push({ name: 'Bullish Engulfing', signal: 'bullish', probability: 75 });
  }
  
  // 2. Bearish Engulfing
  if (prev.close > prev.open && last.close < last.open && last.open > prev.close && last.close < prev.open) {
    patterns.push({ name: 'Bearish Engulfing', signal: 'bearish', probability: 75 });
  }
  
  // 3. Hammer
  if (lowerWick > body * 2 && upperWick < body * 0.5 && body > 0) {
    patterns.push({ name: 'Hammer', signal: 'bullish', probability: 70 });
  }
  
  // 4. Shooting Star
  if (upperWick > body * 2 && lowerWick < body * 0.5 && body > 0) {
    patterns.push({ name: 'Shooting Star', signal: 'bearish', probability: 70 });
  }
  
  // 5. Doji
  if (body < range * 0.1) {
    const isDragonfly = lowerWick > range * 0.6;
    const isGravestone = upperWick > range * 0.6;
    if (isDragonfly) patterns.push({ name: 'Dragonfly Doji', signal: 'bullish', probability: 65 });
    else if (isGravestone) patterns.push({ name: 'Gravestone Doji', signal: 'bearish', probability: 65 });
    else patterns.push({ name: 'Doji', signal: 'neutral', probability: 50 });
  }
  
  // 6. Morning Star
  if (prev2 && prev2.close < prev2.open && prevBody < (prev.high - prev.low) * 0.3 && last.close > last.open && last.close > (prev2.open + prev2.close) / 2) {
    patterns.push({ name: 'Morning Star', signal: 'bullish', probability: 80 });
  }
  
  // 7. Evening Star
  if (prev2 && prev2.close > prev2.open && prevBody < (prev.high - prev.low) * 0.3 && last.close < last.open && last.close < (prev2.open + prev2.close) / 2) {
    patterns.push({ name: 'Evening Star', signal: 'bearish', probability: 80 });
  }
  
  // 8. Three White Soldiers
  if (ohlcv.length >= 3) {
    const c1 = ohlcv[ohlcv.length - 3];
    const c2 = ohlcv[ohlcv.length - 2];
    const c3 = ohlcv[ohlcv.length - 1];
    if (c1.close > c1.open && c2.close > c2.open && c3.close > c3.open &&
        c2.close > c1.close && c3.close > c2.close) {
      patterns.push({ name: 'Three White Soldiers', signal: 'bullish', probability: 85 });
    }
  }
  
  // 9. Three Black Crows
  if (ohlcv.length >= 3) {
    const c1 = ohlcv[ohlcv.length - 3];
    const c2 = ohlcv[ohlcv.length - 2];
    const c3 = ohlcv[ohlcv.length - 1];
    if (c1.close < c1.open && c2.close < c2.open && c3.close < c3.open &&
        c2.close < c1.close && c3.close < c2.close) {
      patterns.push({ name: 'Three Black Crows', signal: 'bearish', probability: 85 });
    }
  }

  return patterns;
}

// ==================== HITUNG SKOR BREAKOUT ====================
function calculateBreakoutScore(coin, ohlcv, patterns) {
  let score = 50;
  const reasons = [];
  
  const change = coin.price_change_percentage_24h || 0;
  if (change > 15) { score += 25; reasons.push(`+${change.toFixed(1)}%`); }
  else if (change > 8) { score += 15; reasons.push(`+${change.toFixed(1)}%`); }
  else if (change < -5) { score -= 10; reasons.push(`${change.toFixed(1)}%`); }
  
  if (ohlcv && ohlcv.length >= 20) {
    const last = ohlcv[ohlcv.length - 1];
    const avgVol = ohlcv.slice(-20, -1).reduce((s, c) => s + c.volume, 0) / 20;
    if (last.volume > avgVol * 2.5) { score += 20; reasons.push('Volume spike'); }
    
    const ma20 = ohlcv.slice(-20).reduce((s, c) => s + c.close, 0) / 20;
    if (last.close > ma20) { score += 10; reasons.push('>MA20'); }
    
    const high20 = Math.max(...ohlcv.slice(-20).map(c => c.high));
    if (last.close > high20 * 0.98) { score += 10; reasons.push('Near high'); }
  }
  
  const bullish = patterns.filter(p => p.signal === 'bullish');
  const bearish = patterns.filter(p => p.signal === 'bearish');
  if (bullish.length) { score += bullish.length * 8; reasons.push(bullish[0].name); }
  if (bearish.length) { score -= bearish.length * 8; }
  
  score = Math.max(0, Math.min(100, Math.round(score)));
  
  return {
    score,
    reasons: reasons.slice(0, 3),
    interpretation: score >= 70 ? '🔥 Tinggi' : score >= 50 ? '📈 Pantau' : '💤 Rendah'
  };
}
// Fallback: Jika tidak ada pola terdeteksi, cek simple price action
if (patterns.length === 0) {
  const change = ((last.close - prev.close) / prev.close) * 100;
  if (change > 5) patterns.push({ name: 'Breakout Bullish', signal: 'bullish', probability: 60 });
  else if (change < -5) patterns.push({ name: 'Breakdown Bearish', signal: 'bearish', probability: 60 });
}
