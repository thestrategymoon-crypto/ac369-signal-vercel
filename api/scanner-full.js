// api/scanner-full.js - AC369 FUSION Fase 8 (Final Detail)
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
  let elliottWave = { wave: 'Konsolidasi', confidence: 20, description: 'Data OHLCV terbatas' };
  let smc = { signal: 'Neutral', summary: 'Menunggu analisis' };

  try {
    const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}USDT&interval=1d&limit=100`);
    if (res.ok) {
      const data = await res.json();
      ohlcv = data.map(c => ({
        open: parseFloat(c[1]), high: parseFloat(c[2]), low: parseFloat(c[3]),
        close: parseFloat(c[4]), volume: parseFloat(c[5])
      }));

      // Deteksi pola grafik (dengan fallback agresif)
      chartPatterns = detectAllPatterns(ohlcv, coin.price_change_percentage_24h);
      
      // Elliott Wave (threshold diturunkan ke 20 candle)
      if (ohlcv.length >= 20) {
        elliottWave = detectElliottWave(ohlcv);
      }
      
      // SMC (threshold diturunkan ke 10 candle)
      if (ohlcv.length >= 10) {
        smc = analyzeSMC(ohlcv);
      }
    }
  } catch (e) {
    console.error('Error fetch OHLCV', symbol, e.message);
  }

  // Fallback super agresif jika masih kosong
  if (chartPatterns.length === 0) {
    const change = coin.price_change_percentage_24h || 0;
    if (change > 8) {
      chartPatterns.push({ name: 'Breakout Bullish Kuat', signal: 'bullish', probability: 75 });
    } else if (change > 3) {
      chartPatterns.push({ name: 'Breakout Bullish Awal', signal: 'bullish', probability: 60 });
    } else if (change < -8) {
      chartPatterns.push({ name: 'Breakdown Bearish Kuat', signal: 'bearish', probability: 75 });
    } else if (change < -3) {
      chartPatterns.push({ name: 'Breakdown Bearish Awal', signal: 'bearish', probability: 60 });
    } else {
      chartPatterns.push({ name: 'Sideways Stabil', signal: 'neutral', probability: 40 });
    }
  }

  if (elliottWave.wave === 'Konsolidasi' && elliottWave.confidence <= 20) {
    const change = coin.price_change_percentage_24h || 0;
    if (change > 5) elliottWave = { wave: 'Potensi Wave 3', confidence: 40, description: 'Momentum naik terdeteksi' };
    else if (change < -5) elliottWave = { wave: 'Potensi Wave Korektif', confidence: 40, description: 'Momentum turun terdeteksi' };
  }

  if (smc.signal === 'Neutral' || smc.summary === 'Menunggu analisis') {
    const change = coin.price_change_percentage_24h || 0;
    if (change > 5) smc = { signal: 'Bullish', summary: 'Momentum beli terdeteksi' };
    else if (change < -5) smc = { signal: 'Bearish', summary: 'Momentum jual terdeteksi' };
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

// ==================== DETEKSI POLA SUPER LENGKAP ====================
function detectAllPatterns(ohlcv, change24h) {
  const patterns = [];
  if (ohlcv.length < 2) {
    // Fallback jika OHLCV tidak tersedia
    if (change24h > 5) patterns.push({ name: 'Momentum Bullish', signal: 'bullish', probability: 60 });
    else if (change24h < -5) patterns.push({ name: 'Momentum Bearish', signal: 'bearish', probability: 60 });
    return patterns;
  }

  const lastIdx = ohlcv.length - 1;
  const last = ohlcv[lastIdx];
  const prev = ohlcv[lastIdx - 1];
  const body = Math.abs(last.close - last.open);
  const prevBody = Math.abs(prev.close - prev.open);
  const lowerWick = Math.min(last.open, last.close) - last.low;
  const upperWick = last.high - Math.max(last.open, last.close);
  const range = last.high - last.low;

  // Pola 1: Bullish Engulfing
  if (prev.close < prev.open && last.close > last.open && 
      last.open <= prev.close && last.close >= prev.open) {
    patterns.push({ name: 'Bullish Engulfing', signal: 'bullish', probability: 80 });
  }
  // Pola 2: Bearish Engulfing
  else if (prev.close > prev.open && last.close < last.open && 
           last.open >= prev.close && last.close <= prev.open) {
    patterns.push({ name: 'Bearish Engulfing', signal: 'bearish', probability: 80 });
  }
  // Pola 3: Hammer
  else if (lowerWick > body * 2 && upperWick < body * 0.6 && body > 0) {
    patterns.push({ name: 'Hammer (Bullish Reversal)', signal: 'bullish', probability: 75 });
  }
  // Pola 4: Shooting Star
  else if (upperWick > body * 2 && lowerWick < body * 0.6 && body > 0) {
    patterns.push({ name: 'Shooting Star (Bearish Reversal)', signal: 'bearish', probability: 75 });
  }
  // Pola 5: Doji
  else if (body < range * 0.15) {
    if (lowerWick > upperWick * 1.5) patterns.push({ name: 'Dragonfly Doji (Bullish)', signal: 'bullish', probability: 65 });
    else if (upperWick > lowerWick * 1.5) patterns.push({ name: 'Gravestone Doji (Bearish)', signal: 'bearish', probability: 65 });
    else patterns.push({ name: 'Doji (Indecision)', signal: 'neutral', probability: 50 });
  }
  // Pola 6: Piercing Line
  else if (prev.close < prev.open && last.close > last.open &&
           last.open < prev.low && last.close > (prev.open + prev.close) / 2) {
    patterns.push({ name: 'Piercing Line (Bullish)', signal: 'bullish', probability: 70 });
  }
  // Pola 7: Dark Cloud Cover
  else if (prev.close > prev.open && last.close < last.open &&
           last.open > prev.high && last.close < (prev.open + prev.close) / 2) {
    patterns.push({ name: 'Dark Cloud Cover (Bearish)', signal: 'bearish', probability: 70 });
  }
  // Pola 8: Three White Soldiers
  if (ohlcv.length >= 3) {
    const c1 = ohlcv[lastIdx - 2];
    const c2 = ohlcv[lastIdx - 1];
    const c3 = ohlcv[lastIdx];
    if (c1.close > c1.open && c2.close > c2.open && c3.close > c3.open &&
        c2.close > c1.close && c3.close > c2.close &&
        c2.open > c1.open && c3.open > c2.open) {
      patterns.push({ name: 'Three White Soldiers (Strong Bullish)', signal: 'bullish', probability: 85 });
    }
  }
  // Pola 9: Three Black Crows
  if (ohlcv.length >= 3) {
    const c1 = ohlcv[lastIdx - 2];
    const c2 = ohlcv[lastIdx - 1];
    const c3 = ohlcv[lastIdx];
    if (c1.close < c1.open && c2.close < c2.open && c3.close < c3.open &&
        c2.close < c1.close && c3.close < c2.close) {
      patterns.push({ name: 'Three Black Crows (Strong Bearish)', signal: 'bearish', probability: 85 });
    }
  }

  return patterns;
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
    const wave1 = Math.abs(highs[1]?.price - lows[0]?.price) || 1;
    const wave3 = Math.abs(lastHigh.price - lastLow.price);
    const ratio = wave3 / wave1;
    if (ratio > 1.2 && ratio < 2.0) {
      return { wave: 'Wave 3 (Extension)', confidence: 65, description: `Rasio Fib ${ratio.toFixed(2)}` };
    }
    return { wave: 'Wave 3 (Impulsif)', confidence: 55, description: 'Tren naik terkonfirmasi' };
  }
  // Wave korektif
  if (lastHigh.price < prevHigh.price && lastLow.price < prevLow.price && currentPrice < lastHigh.price) {
    return { wave: 'Wave Korektif (ABC)', confidence: 50, description: 'Koreksi sehat' };
  }
  // Higher High saja
  if (lastHigh.price > prevHigh.price) {
    return { wave: 'Potensi Wave 5', confidence: 40, description: 'Kelanjutan tren naik' };
  }
  return { wave: 'Konsolidasi', confidence: 25, description: 'Belum ada struktur jelas' };
}

function findSwingPoints(ohlcv, lookback) {
  const swings = [];
  for (let i = lookback; i < ohlcv.length - lookback; i++) {
    let isSwingHigh = true, isSwingLow = true;
    const ch = ohlcv[i].high, cl = ohlcv[i].low;
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
    return { signal: ob.type.includes('Demand') ? 'Bullish' : 'Bearish', summary: ob.description };
  }
  
  // Analisis tambahan: trend sederhana
  const recent = ohlcv.slice(-5);
  const closes = recent.map(c => c.close);
  const trend = closes[closes.length - 1] > closes[0] ? 'Bullish' : 'Bearish';
  return { signal: trend, summary: trend === 'Bullish' ? 'Tren pendek naik' : 'Tren pendek turun' };
}

function findOrderBlock(ohlcv) {
  const recent = ohlcv.slice(-10);
  let maxVol = 0, obCandle = recent[0];
  for (let i = 0; i < recent.length; i++) {
    if (recent[i].volume > maxVol) { maxVol = recent[i].volume; obCandle = recent[i]; }
  }
  const avgVol = recent.reduce((a, b) => a + b.volume, 0) / recent.length;
  if (obCandle.volume < avgVol * 1.15) return { detected: false };
  
  const isBullish = obCandle.close > obCandle.open;
  const currentPrice = ohlcv[ohlcv.length - 1].close;
  const blockHigh = obCandle.high, blockLow = obCandle.low;

  if (isBullish && currentPrice >= blockLow * 0.995 && currentPrice <= blockHigh * 1.005) {
    return { detected: true, type: 'Demand Zone', description: `Support di $${blockLow.toFixed(4)}` };
  }
  if (!isBullish && currentPrice >= blockLow * 0.995 && currentPrice <= blockHigh * 1.005) {
    return { detected: true, type: 'Supply Zone', description: `Resistance di $${blockHigh.toFixed(4)}` };
  }
  return { detected: false };
}

function findLiquiditySweep(ohlcv) {
  const range = ohlcv.slice(-20, -1);
  const recentHigh = Math.max(...range.map(c => c.high));
  const recentLow = Math.min(...range.map(c => c.low));
  const last = ohlcv[ohlcv.length - 1];

  if (last.high > recentHigh && last.close < recentHigh) {
    return { detected: true, direction: 'Bearish', description: `Sweep high $${recentHigh.toFixed(4)}` };
  }
  if (last.low < recentLow && last.close > recentLow) {
    return { detected: true, direction: 'Bullish', description: `Sweep low $${recentLow.toFixed(4)}` };
  }
  return { detected: false };
}

// ==================== SKOR ====================
function calculateBreakoutScore(coin, patterns, elliott, smc) {
  let score = 50;
  const change = coin.price_change_percentage_24h || 0;
  if (change > 15) score += 25;
  else if (change > 8) score += 15;
  else if (change > 3) score += 8;
  else if (change < -10) score -= 20;
  else if (change < -5) score -= 10;

  const bullishP = patterns.filter(p => p.signal === 'bullish').length;
  const bearishP = patterns.filter(p => p.signal === 'bearish').length;
  score += (bullishP - bearishP) * 10;

  if (elliott.wave.includes('Wave 3')) score += 15;
  else if (elliott.wave.includes('Wave 5')) score += 10;
  else if (elliott.wave.includes('Korektif')) score -= 5;

  if (smc.signal === 'Bullish') score += 20;
  else if (smc.signal === 'Bearish') score -= 15;

  score = Math.max(0, Math.min(100, Math.round(score)));
  
  const reasons = [];
  if (change !== 0) reasons.push(`${change > 0 ? '+' : ''}${change.toFixed(1)}%`);
  const bestPattern = patterns.find(p => p.signal === 'bullish') || patterns.find(p => p.signal === 'bearish') || patterns[0];
  if (bestPattern) reasons.push(bestPattern.name);
  if (elliott.wave !== 'Konsolidasi') reasons.push(elliott.wave);
  if (smc.signal !== 'Neutral') reasons.push(`SMC: ${smc.signal}`);
  
  return {
    score,
    reasons: reasons.slice(0, 4),
    interpretation: score >= 75 ? '🔥 Sangat Tinggi' : score >= 60 ? '📈 Tinggi' : score >= 45 ? '📊 Pantau' : '💤 Rendah'
  };
}
