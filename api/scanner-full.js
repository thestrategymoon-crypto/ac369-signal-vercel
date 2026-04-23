// api/scanner-full.js - AC369 FUSION Fase 8 (All-in-One)
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'max-age=0, s-maxage=300');

  try {
    const allCoins = [];
    for (let page = 1; page <= 2; page++) {
      const response = await fetch(
        `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=${page}&sparkline=false&price_change_percentage=24h`
      );
      const data = await response.json();
      for (let i = 0; i < data.length; i++) allCoins.push(data[i]);
    }

    const filtered = allCoins.filter(c => c.total_volume > 3000000 && c.market_cap > 30000000);
    const results = [];

    for (const coin of filtered.slice(0, 100)) {
      const analysis = await analyzeCoin(coin);
      if (analysis) results.push(analysis);
    }

    results.sort((a, b) => b.breakoutProbability.score - a.breakoutProbability.score);

    res.status(200).json({
      timestamp: new Date().toISOString(),
      totalScanned: filtered.length,
      results: results.slice(0, 40)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function analyzeCoin(coin) {
  const symbol = coin.symbol.toUpperCase();
  let ohlcv = [];
  let chartPatterns = [];
  let elliottWave = { wave: 'Konsolidasi', confidence: 20, description: 'Data kurang' };
  let smc = { signal: 'Neutral', summary: '' };

  try {
    const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}USDT&interval=1d&limit=100`);
    if (res.ok) {
      const data = await res.json();
      ohlcv = data.map(c => ({
        open: parseFloat(c[1]), high: parseFloat(c[2]), low: parseFloat(c[3]),
        close: parseFloat(c[4]), volume: parseFloat(c[5])
      }));

      chartPatterns = detectAllPatterns(ohlcv);
      
      if (ohlcv.length >= 30) {
        elliottWave = detectElliottWave(ohlcv);
      }
      if (ohlcv.length >= 15) {
        smc = analyzeSMC(ohlcv);
      }
    }
  } catch (e) {
    console.error('Error fetch OHLCV', symbol, e.message);
  }

  const prob = calculateBreakoutScore(coin, chartPatterns, elliottWave, smc);

  return {
    symbol,
    name: coin.name,
    price: coin.current_price,
    volume24h: coin.total_volume,
    priceChange24h: coin.price_change_percentage_24h,
    breakoutProbability: prob,
    chartPatterns: chartPatterns.slice(0, 3),
    elliottWave,
    smc
  };
}

// ==================== ELLIOTT WAVE ====================
function detectElliottWave(ohlcv) {
  const swings = findSwingPoints(ohlcv, 3);
  if (swings.length < 3) return { wave: 'Konsolidasi', confidence: 20, description: 'Swing tidak cukup' };

  const recent = swings.slice(-5);
  const highs = recent.filter(s => s.type === 'high');
  const lows = recent.filter(s => s.type === 'low');

  if (highs.length < 2 || lows.length < 2) return { wave: 'Konsolidasi', confidence: 20, description: 'Pola belum terbentuk' };

  const lastHigh = highs[highs.length - 1];
  const prevHigh = highs[highs.length - 2];
  const lastLow = lows[lows.length - 1];
  const prevLow = lows[lows.length - 2];
  const currentPrice = ohlcv[ohlcv.length - 1].close;

  // Wave 3 impulsif naik
  if (lastHigh.price > prevHigh.price && lastLow.price > prevLow.price && currentPrice > lastLow.price) {
    return { wave: 'Wave 3 (Impulsif)', confidence: 55, description: 'Tren naik terkonfirmasi' };
  }
  // Korektif turun
  if (lastHigh.price < prevHigh.price && lastLow.price < prevLow.price && currentPrice < lastHigh.price) {
    return { wave: 'Wave Korektif', confidence: 50, description: 'Fase koreksi' };
  }
  return { wave: 'Konsolidasi', confidence: 25, description: 'Belum ada struktur jelas' };
}

function findSwingPoints(ohlcv, lookback) {
  const swings = [];
  for (let i = lookback; i < ohlcv.length - lookback; i++) {
    let isSwingHigh = true;
    let isSwingLow = true;
    const ch = ohlcv[i].high;
    const cl = ohlcv[i].low;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      if (ohlcv[j].high >= ch) isSwingHigh = false;
      if (ohlcv[j].low <= cl) isSwingLow = false;
    }
    if (isSwingHigh) swings.push({ index: i, price: ch, type: 'high' });
    if (isSwingLow) swings.push({ index: i, price: cl, type: 'low' });
  }
  return swings;
}

// ==================== SMC ====================
function analyzeSMC(ohlcv) {
  const ob = findOrderBlock(ohlcv);
  const ls = findLiquiditySweep(ohlcv);

  if (ls.detected) {
    return { signal: ls.direction, summary: ls.description };
  }
  if (ob.detected) {
    return { signal: ob.type === 'Demand Zone' ? 'Bullish' : 'Bearish', summary: ob.description };
  }
  return { signal: 'Neutral', summary: 'Tidak ada sinyal signifikan' };
}

function findOrderBlock(ohlcv) {
  const recent = ohlcv.slice(-10);
  let maxVol = 0;
  let obCandle = recent[0];
  for (let i = 0; i < recent.length; i++) {
    if (recent[i].volume > maxVol) {
      maxVol = recent[i].volume;
      obCandle = recent[i];
    }
  }
  const avgVol = recent.reduce((a, b) => a + b.volume, 0) / recent.length;
  if (obCandle.volume < avgVol * 1.2) return { detected: false };

  const isBullish = obCandle.close > obCandle.open;
  const currentPrice = ohlcv[ohlcv.length - 1].close;
  const blockHigh = obCandle.high;
  const blockLow = obCandle.low;

  if (isBullish && currentPrice >= blockLow && currentPrice <= blockHigh) {
    return { detected: true, type: 'Demand Zone', description: 'Area akumulasi' };
  }
  if (!isBullish && currentPrice >= blockLow && currentPrice <= blockHigh) {
    return { detected: true, type: 'Supply Zone', description: 'Area distribusi' };
  }
  return { detected: false };
}

function findLiquiditySweep(ohlcv) {
  const range = ohlcv.slice(-20, -1);
  const recentHigh = Math.max(...range.map(c => c.high));
  const recentLow = Math.min(...range.map(c => c.low));
  const last = ohlcv[ohlcv.length - 1];

  if (last.high > recentHigh && last.close < recentHigh) {
    return { detected: true, direction: 'Bearish', description: 'Sweep resistance' };
  }
  if (last.low < recentLow && last.close > recentLow) {
    return { detected: true, direction: 'Bullish', description: 'Sweep support' };
  }
  return { detected: false };
}

// ==================== POLA CANDLESTICK ====================
function detectAllPatterns(ohlcv) {
  const patterns = [];
  if (ohlcv.length < 2) return patterns;
  const last = ohlcv[ohlcv.length - 1];
  const prev = ohlcv[ohlcv.length - 2];
  const body = Math.abs(last.close - last.open);
  const lowerWick = Math.min(last.open, last.close) - last.low;
  const upperWick = last.high - Math.max(last.open, last.close);

  if (prev.close < prev.open && last.close > last.open && last.close > prev.open)
    patterns.push({ name: 'Bullish Engulfing', signal: 'bullish', probability: 75 });
  if (prev.close > prev.open && last.close < last.open && last.close < prev.open)
    patterns.push({ name: 'Bearish Engulfing', signal: 'bearish', probability: 75 });
  if (lowerWick > body * 2 && upperWick < body * 0.5)
    patterns.push({ name: 'Hammer', signal: 'bullish', probability: 70 });
  if (upperWick > body * 2 && lowerWick < body * 0.5)
    patterns.push({ name: 'Shooting Star', signal: 'bearish', probability: 70 });
  return patterns;
}

// ==================== SKOR ====================
function calculateBreakoutScore(coin, patterns, elliott, smc) {
  let score = 50;
  const change = coin.price_change_percentage_24h || 0;
  if (change > 10) score += 20;
  else if (change > 5) score += 10;
  else if (change < -5) score -= 10;

  const bullishP = patterns.filter(p => p.signal === 'bullish').length;
  const bearishP = patterns.filter(p => p.signal === 'bearish').length;
  score += (bullishP - bearishP) * 8;

  if (elliott.wave.includes('Wave 3')) score += 15;
  else if (elliott.wave.includes('Korektif')) score -= 5;

  if (smc.signal === 'Bullish') score += 20;
  else if (smc.signal === 'Bearish') score -= 15;

  score = Math.max(0, Math.min(100, Math.round(score)));
  return {
    score,
    reasons: [change > 0 ? `+${change.toFixed(1)}%` : `${change.toFixed(1)}%`],
    interpretation: score >= 70 ? '🔥 Tinggi' : score >= 50 ? '📈 Pantau' : '💤 Rendah'
  };
}
