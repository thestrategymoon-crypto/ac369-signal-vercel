// api/search.js - AC369 FUSION Search & Deep Analysis (Super Detail)
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'max-age=0, s-maxage=120');

  const symbol = (req.query.symbol || '').toUpperCase().trim();
  if (!symbol) {
    return res.status(400).json({ error: 'Parameter ?symbol= diperlukan. Contoh: /api/search?symbol=ADA' });
  }

  let coinName = symbol;
  let currentPrice = 0;
  let change24h = 0;
  let marketCap = 0;
  let totalVolume = 0;

  try {
    // 1. Dapatkan data harga dari CoinGecko / Binance
    try {
      const searchUrl = `https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(symbol)}`;
      const searchRes = await fetchWithRetry(searchUrl);
      if (searchRes.ok) {
        const searchData = await searchRes.json();
        const matchedCoin = searchData.coins?.find(c => c.symbol.toUpperCase() === symbol);
        if (matchedCoin) {
          const detailUrl = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${matchedCoin.id}&order=market_cap_desc&sparkline=false&price_change_percentage=24h`;
          const detailRes = await fetchWithRetry(detailUrl);
          if (detailRes.ok) {
            const detailData = await detailRes.json();
            if (detailData && detailData.length > 0) {
              const info = detailData[0];
              coinName = info.name || symbol;
              currentPrice = info.current_price || 0;
              change24h = info.price_change_percentage_24h || 0;
              marketCap = info.market_cap || 0;
              totalVolume = info.total_volume || 0;
            }
          }
        }
      }
    } catch (e) {}

    // Fallback ke Binance
    if (currentPrice === 0) {
      try {
        const ticker = await fetchWithRetry(`https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}USDT`);
        if (ticker.ok) {
          const t = await ticker.json();
          currentPrice = parseFloat(t.lastPrice) || 0;
          change24h = parseFloat(t.priceChangePercent) || 0;
          totalVolume = parseFloat(t.quoteVolume) || 0;
        }
      } catch (e) {}
    }

    if (currentPrice === 0) {
      return res.status(404).json({ error: `Koin "${symbol}" tidak ditemukan.` });
    }

    // 2. Ambil OHLCV untuk 3 timeframe: 1H, 4H, 1D (dengan retry)
    const [klines1h, klines4h, klines1d] = await Promise.all([
      fetchKlinesWithRetry(symbol, '1h', 100),
      fetchKlinesWithRetry(symbol, '4h', 100),
      fetchKlinesWithRetry(symbol, '1d', 100)
    ]);

    // 3. Analisis per timeframe (threshold diturunkan ke 5 candle)
    const tf1h = analyzeTimeframe(klines1h, '1H', currentPrice, change24h);
    const tf4h = analyzeTimeframe(klines4h, '4H', currentPrice, change24h);
    const tf1d = analyzeTimeframe(klines1d, '1D', currentPrice, change24h);

    // 4. Rekomendasi trading super detail
    const recommendation = generateTradeRecommendation(tf1h, tf4h, tf1d, currentPrice, change24h);

    // 5. Astrologi
    const astrology = getAstrologySignal(new Date());

    // 6. Level support & resistance dari 1D (atau fallback ke 4H)
    let support = (currentPrice * 0.95).toFixed(4);
    let resistance = (currentPrice * 1.05).toFixed(4);
    const sourceKlines = klines1d.length >= 10 ? klines1d : (klines4h.length >= 10 ? klines4h : klines1h);
    if (sourceKlines.length >= 10) {
      const lows = sourceKlines.slice(-20).map(c => c.low).filter(v => v > 0);
      const highs = sourceKlines.slice(-20).map(c => c.high).filter(v => v > 0);
      if (lows.length > 0) support = Math.min(...lows).toFixed(4);
      if (highs.length > 0) resistance = Math.max(...highs).toFixed(4);
    }

    const result = {
      symbol,
      name: coinName,
      price: currentPrice,
      change24h,
      marketCap,
      volume24h: totalVolume,
      support,
      resistance,
      timeframes: {
        '1H': tf1h,
        '4H': tf4h,
        '1D': tf1d
      },
      recommendation,
      astrology,
      timestamp: new Date().toISOString()
    };

    res.status(200).json(result);
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: error.message });
  }
}

// ==================== FETCH DENGAN RETRY ====================
async function fetchWithRetry(url, retries = 2) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'application/json'
  };
  for (let i = 0; i < retries; i++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(url, { headers, signal: controller.signal });
      clearTimeout(timeout);
      return res;
    } catch (e) {
      if (i === retries - 1) throw e;
      await new Promise(r => setTimeout(r, 1000));
    }
  }
}

async function fetchKlinesWithRetry(symbol, interval, limit) {
  try {
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}USDT&interval=${interval}&limit=${limit}`;
    const res = await fetchWithRetry(url);
    if (!res || !res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    return data.map(c => ({
      open: parseFloat(c[1]), high: parseFloat(c[2]), low: parseFloat(c[3]),
      close: parseFloat(c[4]), volume: parseFloat(c[5])
    }));
  } catch (e) {
    return [];
  }
}

// ==================== ANALISIS PER TIMEFRAME (Super Detail) ====================
function analyzeTimeframe(ohlcv, label, currentPrice, change24h) {
  if (!ohlcv || ohlcv.length < 5) {
    // Fallback: analisis minimal berdasarkan harga & perubahan 24h
    const fakePatterns = [];
    if (change24h > 3) fakePatterns.push({ name: 'Momentum Naik', signal: 'bullish', probability: 55 });
    else if (change24h < -3) fakePatterns.push({ name: 'Momentum Turun', signal: 'bearish', probability: 55 });
    else fakePatterns.push({ name: 'Sideways (Data Terbatas)', signal: 'neutral', probability: 40 });

    return {
      rsi: 'N/A',
      patterns: fakePatterns,
      elliottWave: { wave: 'Data OHLCV terbatas', confidence: 10, description: 'Binance tidak merespons untuk timeframe ini' },
      smc: { signal: 'Neutral', summary: 'Data tidak cukup untuk analisis SMC', orderBlock: null, liquiditySweep: null, fvg: null }
    };
  }

  const closes = ohlcv.map(c => c.close);
  const volumes = ohlcv.map(c => c.volume);
  const highs = ohlcv.map(c => c.high);
  const lows = ohlcv.map(c => c.low);

  const rsi = closes.length >= 14 ? calculateRSI(closes, 14).toFixed(1) : 'N/A';
  const patterns = detectAllPatterns(ohlcv);
  const elliottWave = detectElliottWave(ohlcv);
  const smc = analyzeSMCDetail(ohlcv);

  return { rsi, patterns, elliottWave, smc };
}

// ==================== POLA GRAFIK SUPER LENGKAP ====================
function detectAllPatterns(ohlcv) {
  const patterns = [];
  if (ohlcv.length < 3) return patterns;
  const lastIdx = ohlcv.length - 1;
  const last = ohlcv[lastIdx];
  const prev = ohlcv[lastIdx - 1];
  const body = Math.abs(last.close - last.open);
  const prevBody = Math.abs(prev.close - prev.open);
  const lowerWick = Math.min(last.open, last.close) - last.low;
  const upperWick = last.high - Math.max(last.open, last.close);
  const range = last.high - last.low;

  // 1. Bullish Engulfing
  if (prev.close < prev.open && last.close > last.open && last.open <= prev.close && last.close >= prev.open)
    patterns.push({ name: 'Bullish Engulfing 🔥', signal: 'bullish', probability: 80 });
  // 2. Bearish Engulfing
  if (prev.close > prev.open && last.close < last.open && last.open >= prev.close && last.close <= prev.open)
    patterns.push({ name: 'Bearish Engulfing 🔥', signal: 'bearish', probability: 80 });
  // 3. Hammer
  if (lowerWick > body * 2 && upperWick < body * 0.6 && body > 0)
    patterns.push({ name: 'Hammer (Bullish Reversal)', signal: 'bullish', probability: 75 });
  // 4. Shooting Star
  if (upperWick > body * 2 && lowerWick < body * 0.6 && body > 0)
    patterns.push({ name: 'Shooting Star (Bearish Reversal)', signal: 'bearish', probability: 75 });
  // 5. Doji
  if (range > 0 && body < range * 0.1) {
    if (lowerWick > upperWick * 1.5) patterns.push({ name: 'Dragonfly Doji (Bullish)', signal: 'bullish', probability: 65 });
    else if (upperWick > lowerWick * 1.5) patterns.push({ name: 'Gravestone Doji (Bearish)', signal: 'bearish', probability: 65 });
    else patterns.push({ name: 'Doji (Indecision)', signal: 'neutral', probability: 50 });
  }
  // 6. Piercing Line
  if (prev.close < prev.open && last.close > last.open && last.open < prev.low && last.close > (prev.open + prev.close) / 2)
    patterns.push({ name: 'Piercing Line (Bullish)', signal: 'bullish', probability: 70 });
  // 7. Dark Cloud Cover
  if (prev.close > prev.open && last.close < last.open && last.open > prev.high && last.close < (prev.open + prev.close) / 2)
    patterns.push({ name: 'Dark Cloud Cover (Bearish)', signal: 'bearish', probability: 70 });
  // 8. Three White Soldiers
  if (ohlcv.length >= 3) {
    const c1 = ohlcv[lastIdx - 2], c2 = ohlcv[lastIdx - 1], c3 = ohlcv[lastIdx];
    if (c1.close > c1.open && c2.close > c2.open && c3.close > c3.open && c2.close > c1.close && c3.close > c2.close)
      patterns.push({ name: 'Three White Soldiers 🚀', signal: 'bullish', probability: 85 });
  }
  // 9. Three Black Crows
  if (ohlcv.length >= 3) {
    const c1 = ohlcv[lastIdx - 2], c2 = ohlcv[lastIdx - 1], c3 = ohlcv[lastIdx];
    if (c1.close < c1.open && c2.close < c2.open && c3.close < c3.open && c2.close < c1.close && c3.close < c2.close)
      patterns.push({ name: 'Three Black Crows 📉', signal: 'bearish', probability: 85 });
  }
  // 10. Morning Star
  if (ohlcv.length >= 3) {
    const c1 = ohlcv[lastIdx - 2], c2 = ohlcv[lastIdx - 1], c3 = ohlcv[lastIdx];
    if (c1.close < c1.open && Math.abs(c2.close - c2.open) < (c2.high - c2.low) * 0.3 && c3.close > c3.open && c3.close > (c1.open + c1.close) / 2)
      patterns.push({ name: 'Morning Star ⭐', signal: 'bullish', probability: 80 });
  }
  // 11. Evening Star
  if (ohlcv.length >= 3) {
    const c1 = ohlcv[lastIdx - 2], c2 = ohlcv[lastIdx - 1], c3 = ohlcv[lastIdx];
    if (c1.close > c1.open && Math.abs(c2.close - c2.open) < (c2.high - c2.low) * 0.3 && c3.close < c3.open && c3.close < (c1.open + c1.close) / 2)
      patterns.push({ name: 'Evening Star ⭐', signal: 'bearish', probability: 80 });
  }

  if (patterns.length === 0) {
    const change = ((last.close - prev.close) / prev.close) * 100;
    if (change > 2) patterns.push({ name: 'Momentum Naik', signal: 'bullish', probability: 55 });
    else if (change < -2) patterns.push({ name: 'Momentum Turun', signal: 'bearish', probability: 55 });
    else patterns.push({ name: 'Sideways', signal: 'neutral', probability: 40 });
  }
  return patterns.slice(0, 4);
}

// ==================== ELLIOTT WAVE SUPER DETAIL ====================
function detectElliottWave(ohlcv) {
  if (!ohlcv || ohlcv.length < 10) return { wave: 'Data tidak cukup', confidence: 10, description: 'Perlu minimal 10 candle' };

  const swings = findSwingPoints(ohlcv, 3);
  if (swings.length < 3) return { wave: 'Struktur belum jelas', confidence: 15, description: 'Swing point tidak ditemukan' };

  const recent = swings.slice(-7);
  const highs = recent.filter(s => s.type === 'high');
  const lows = recent.filter(s => s.type === 'low');

  if (highs.length < 2 || lows.length < 2) return { wave: 'Menunggu formasi', confidence: 20, description: 'Pola swing belum lengkap' };

  const lastHigh = highs[highs.length - 1];
  const prevHigh = highs[highs.length - 2];
  const lastLow = lows[lows.length - 1];
  const prevLow = lows[lows.length - 2];
  const currentPrice = ohlcv[ohlcv.length - 1].close;

  // Wave 3 impulsif naik
  if (lastHigh.price > prevHigh.price && lastLow.price > prevLow.price && currentPrice > lastLow.price) {
    const wave1 = Math.abs((highs[1]?.price || prevHigh.price) - (lows[0]?.price || prevLow.price));
    const wave3 = Math.abs(lastHigh.price - lastLow.price);
    const ratio = wave1 > 0 ? wave3 / wave1 : 0;
    let desc = 'Higher high & higher low → tren naik kuat';
    if (ratio > 1.5 && ratio < 1.7) desc = `Extension 1.618 (rasio ${ratio.toFixed(2)}) → Wave 3 kuat`;
    return { wave: 'Wave 3 (Impulsif)', confidence: 55, description: desc };
  }

  // Wave korektif turun
  if (lastHigh.price < prevHigh.price && lastLow.price < prevLow.price && currentPrice < lastHigh.price) {
    const fibRetrace = ((prevHigh.price - lastLow.price) / (prevHigh.price - prevLow.price)) * 100;
    let desc = 'Lower high & lower low → fase koreksi';
    if (fibRetrace > 50 && fibRetrace < 62) desc = `Retracement 61.8% Fibonacci (${fibRetrace.toFixed(0)}%) → support kuat`;
    return { wave: 'Wave Korektif (ABC)', confidence: 50, description: desc };
  }

  // Harga di atas rata-rata 20 candle → potensi Wave 1 atau 3
  const ma20 = ohlcv.slice(-20).reduce((s, c) => s + c.close, 0) / Math.min(20, ohlcv.length);
  if (currentPrice > ma20) {
    return { wave: 'Potensi Wave 1/3', confidence: 35, description: `Harga di atas MA20 ($${ma20.toFixed(2)}) → bullish` };
  }

  return { wave: 'Konsolidasi', confidence: 25, description: 'Tidak ada struktur impulsif yang jelas' };
}

function findSwingPoints(ohlcv, lookback) {
  const swings = [];
  for (let i = lookback; i < ohlcv.length - lookback; i++) {
    let isSwingHigh = true, isSwingLow = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      if (ohlcv[j].high >= ohlcv[i].high) isSwingHigh = false;
      if (ohlcv[j].low <= ohlcv[i].low) isSwingLow = false;
    }
    if (isSwingHigh) swings.push({ price: ohlcv[i].high, type: 'high' });
    if (isSwingLow) swings.push({ price: ohlcv[i].low, type: 'low' });
  }
  return swings;
}

// ==================== SMC SUPER DETAIL (Order Block, Liquidity Sweep, FVG) ====================
function analyzeSMCDetail(ohlcv) {
  if (!ohlcv || ohlcv.length < 5) return { signal: 'Neutral', summary: 'Data OHLCV minimal 5 candle diperlukan', orderBlock: null, liquiditySweep: null, fvg: null };

  const ob = findOrderBlock(ohlcv);
  const ls = findLiquiditySweep(ohlcv);
  const fvg = findFairValueGap(ohlcv);

  // Prioritas: Liquidity Sweep > Order Block > FVG > Tren
  if (ls.detected) {
    return {
      signal: ls.direction,
      summary: ls.description,
      orderBlock: ob.detected ? ob.type : null,
      liquiditySweep: ls.direction,
      fvg: fvg.detected ? fvg.type : null
    };
  }

  if (ob.detected) {
    return {
      signal: ob.type.includes('Demand') ? 'Bullish' : 'Bearish',
      summary: ob.description,
      orderBlock: ob.type,
      liquiditySweep: null,
      fvg: fvg.detected ? fvg.type : null
    };
  }

  if (fvg.detected) {
    return {
      signal: fvg.type.includes('Bullish') ? 'Bullish' : 'Bearish',
      summary: fvg.description,
      orderBlock: null,
      liquiditySweep: null,
      fvg: fvg.type
    };
  }

  // Analisis tren pendek
  const closes = ohlcv.slice(-5).map(c => c.close);
  if (closes.length >= 2) {
    const trend = closes[closes.length - 1] > closes[0] ? 'Bullish' : 'Bearish';
    const strength = Math.abs(closes[closes.length - 1] - closes[0]) / closes[0];
    if (strength > 0.02) {
      return {
        signal: trend,
        summary: `Tren ${trend === 'Bullish' ? 'naik' : 'turun'} ${(strength * 100).toFixed(1)}% dalam 5 candle`,
        orderBlock: null,
        liquiditySweep: null,
        fvg: null
      };
    }
  }

  return { signal: 'Neutral', summary: 'Tidak ada sinyal SMC signifikan', orderBlock: null, liquiditySweep: null, fvg: null };
}

function findOrderBlock(ohlcv) {
  if (ohlcv.length < 5) return { detected: false, type: null, price: null, description: '' };
  const recent = ohlcv.slice(-10);
  let maxVol = 0, obCandle = recent[0];
  for (let i = 0; i < recent.length; i++) {
    if (recent[i].volume > maxVol) { maxVol = recent[i].volume; obCandle = recent[i]; }
  }
  const avgVol = recent.reduce((a, b) => a + b.volume, 0) / recent.length;
  if (obCandle.volume < avgVol * 1.2) return { detected: false, type: null, price: null, description: '' };

  const isBullish = obCandle.close > obCandle.open;
  const currentPrice = ohlcv[ohlcv.length - 1].close;
  const blockHigh = obCandle.high;
  const blockLow = obCandle.low;

  if (isBullish && currentPrice >= blockLow * 0.995 && currentPrice <= blockHigh * 1.005) {
    return {
      detected: true,
      type: 'Demand Zone (Akumulasi Whale)',
      price: blockLow,
      description: `Support kuat di $${blockLow.toFixed(4)} (volume ${(obCandle.volume / avgVol).toFixed(1)}x rata-rata)`
    };
  }
  if (!isBullish && currentPrice >= blockLow * 0.995 && currentPrice <= blockHigh * 1.005) {
    return {
      detected: true,
      type: 'Supply Zone (Distribusi Whale)',
      price: blockHigh,
      description: `Resistance kuat di $${blockHigh.toFixed(4)} (volume ${(obCandle.volume / avgVol).toFixed(1)}x rata-rata)`
    };
  }
  return { detected: false, type: null, price: null, description: '' };
}

function findLiquiditySweep(ohlcv) {
  if (ohlcv.length < 10) return { detected: false };
  const range = ohlcv.slice(-20, -1);
  if (range.length === 0) return { detected: false };
  const recentHigh = Math.max(...range.map(c => c.high));
  const recentLow = Math.min(...range.map(c => c.low));
  const last = ohlcv[ohlcv.length - 1];

  if (last.high > recentHigh && last.close < recentHigh) {
    return {
      detected: true,
      direction: 'Bearish',
      description: `🚨 Sweep resistance $${recentHigh.toFixed(4)} → Stop hunt, potensi turun`
    };
  }
  if (last.low < recentLow && last.close > recentLow) {
    return {
      detected: true,
      direction: 'Bullish',
      description: `🚨 Sweep support $${recentLow.toFixed(4)} → Liquidity grab, potensi naik`
    };
  }
  return { detected: false };
}

function findFairValueGap(ohlcv) {
  if (ohlcv.length < 3) return { detected: false, type: null, description: '' };
  const lastIdx = ohlcv.length - 1;
  const prev2 = ohlcv[lastIdx - 2];
  const last = ohlcv[lastIdx];
  const currentPrice = ohlcv[lastIdx].close;

  // Bullish FVG: low candle sebelumnya > high candle setelahnya (gap naik)
  if (prev2.low > last.high && currentPrice < prev2.low && currentPrice > last.high) {
    return {
      detected: true,
      type: 'Bullish FVG (Imbalance)',
      description: `Gap $${last.high.toFixed(4)} - $${prev2.low.toFixed(4)} → area support`
    };
  }
  // Bearish FVG: high candle sebelumnya < low candle setelahnya (gap turun)
  if (prev2.high < last.low && currentPrice > prev2.high && currentPrice < last.low) {
    return {
      detected: true,
      type: 'Bearish FVG (Imbalance)',
      description: `Gap $${prev2.high.toFixed(4)} - $${last.low.toFixed(4)} → area resistance`
    };
  }
  return { detected: false, type: null, description: '' };
}

// ==================== REKOMENDASI TRADING SUPER DETAIL ====================
function generateTradeRecommendation(tf1h, tf4h, tf1d, price, change24h) {
  let score = 50;
  const reasons = [];
  const details = [];

  for (const [label, tf] of [['1H', tf1h], ['4H', tf4h], ['1D', tf1d]]) {
    let tfScore = 0;

    // SMC
    if (tf.smc.signal === 'Bullish') { tfScore += 15; reasons.push(`SMC ${label}: ${tf.smc.summary}`); }
    else if (tf.smc.signal === 'Bearish') { tfScore -= 15; reasons.push(`SMC ${label}: ${tf.smc.summary}`); }

    // Pola
    const bullishP = tf.patterns.filter(p => p.signal === 'bullish').length;
    const bearishP = tf.patterns.filter(p => p.signal === 'bearish').length;
    if (bullishP > bearishP) { tfScore += 8; reasons.push(`Pola ${label}: ${bullishP} bullish`); }
    else if (bearishP > bullishP) { tfScore -= 8; reasons.push(`Pola ${label}: ${bearishP} bearish`); }

    // Elliott
    if (tf.elliottWave.wave.includes('Wave 3')) { tfScore += 12; reasons.push(`Elliott ${label}: Wave 3`); }
    else if (tf.elliottWave.wave.includes('Wave 5')) { tfScore += 6; reasons.push(`Elliott ${label}: Wave 5`); }
    else if (tf.elliottWave.wave.includes('Korektif')) { tfScore -= 10; reasons.push(`Elliott ${label}: Korektif`); }

    // RSI
    const rsi = parseFloat(tf.rsi);
    if (!isNaN(rsi)) {
      if (rsi < 30) { tfScore += 10; reasons.push(`RSI ${label}: Oversold (${rsi})`); }
      else if (rsi > 70) { tfScore -= 10; reasons.push(`RSI ${label}: Overbought (${rsi})`); }
    }

    score += tfScore;

    details.push({
      timeframe: label,
      rsi: tf.rsi,
      patterns: tf.patterns.map(p => `${p.name} (${p.signal})`).join(', ') || '-',
      elliott: `${tf.elliottWave.wave} (${tf.elliottWave.confidence}%)`,
      smc: `${tf.smc.signal}: ${tf.smc.summary}`,
      orderBlock: tf.smc.orderBlock || '-',
      liquiditySweep: tf.smc.liquiditySweep || '-',
      fvg: tf.smc.fvg || '-',
      tfScore: tfScore
    });
  }

  // Tambahan dari perubahan 24h
  if (change24h > 8) { score += 15; reasons.push('Momentum 24h sangat positif'); }
  else if (change24h > 3) { score += 8; reasons.push('Momentum 24h positif'); }
  else if (change24h < -8) { score -= 15; reasons.push('Momentum 24h sangat negatif'); }
  else if (change24h < -3) { score -= 8; reasons.push('Momentum 24h negatif'); }

  // Batasi skor
  score = Math.max(0, Math.min(100, score));

  let action = 'HOLD (Tahan)';
  let confidence = 'Netral';
  let explanation = '';

  if (score >= 75) {
    action = '🟢 LONG (Beli)';
    confidence = 'Tinggi';
    explanation = 'Mayoritas sinyal bullish di semua timeframe. Konfluensi kuat mendukung kenaikan harga.';
  } else if (score >= 60) {
    action = '🟢 LONG (Beli)';
    confidence = 'Sedang';
    explanation = 'Beberapa sinyal bullish terdeteksi, namun perlu konfirmasi tambahan.';
  } else if (score <= 25) {
    action = '🔴 SHORT (Jual)';
    confidence = 'Tinggi';
    explanation = 'Mayoritas sinyal bearish di semua timeframe. Konfluensi kuat mendukung penurunan harga.';
  } else if (score <= 40) {
    action = '🔴 SHORT (Jual)';
    confidence = 'Sedang';
    explanation = 'Beberapa sinyal bearish terdeteksi, namun perlu konfirmasi tambahan.';
  } else {
    action = '⚪ HOLD (Tahan)';
    confidence = 'Netral';
    explanation = 'Sinyal campuran di berbagai timeframe. Pasar sedang konsolidasi, tunggu breakout.';
  }

  return {
    action,
    confidence,
    score,
    explanation,
    reasons: reasons.slice(0, 6),
    details,
    summary: `Skor ${score}/100 → ${action} (Keyakinan: ${confidence}). ${explanation}`
  };
}

// ==================== RSI ====================
function calculateRSI(prices, period = 14) {
  if (prices.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = prices.length - period; i < prices.length; i++) {
    const diff = prices[i] - prices[i - 1];
    if (diff > 0) gains += diff;
    else losses -= diff;
  }
  const avgGain = gains / period, avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  return 100 - (100 / (1 + avgGain / avgLoss));
}

// ==================== ASTROLOGI ====================
function getAstrologySignal(date) {
  const phase = getMoonPhase(date);
  const signals = {
    'New Moon': { signal: '🔄 Awal Siklus', interpretation: 'Potensi tren baru, volatilitas tinggi, ideal untuk entry posisi' },
    'Waxing Crescent': { signal: '🌱 Kenaikan', interpretation: 'Momentum bullish mulai terbentuk, akumulasi bertahap' },
    'First Quarter': { signal: '⚡ Tekanan', interpretation: 'Keputusan besar, volatilitas meningkat, waspada fakeout' },
    'Waxing Gibbous': { signal: '📈 Optimis', interpretation: 'Tren bullish dominan, momentum kuat' },
    'Full Moon': { signal: '🌕 Puncak', interpretation: 'Potensi reversal, volatilitas ekstrem, ideal untuk take profit' },
    'Waning Gibbous': { signal: '📉 Koreksi', interpretation: 'Mulai jenuh, potensi koreksi, pertimbangkan partial exit' },
    'Last Quarter': { signal: '🔻 Pelepasan', interpretation: 'Distribusi, tekanan jual meningkat' },
    'Waning Crescent': { signal: '💤 Akhir', interpretation: 'Konsolidasi, volume rendah, tunggu setup jelas' }
  };
  return {
    moonPhase: phase.name,
    illumination: phase.illumination,
    signal: signals[phase.name]?.signal || 'Neutral',
    interpretation: signals[phase.name]?.interpretation || ''
  };
}

function getMoonPhase(date) {
  const LUNAR_MONTH = 29.53058867;
  const KNOWN_NEW_MOON = new Date('2000-01-06T18:14:00Z').getTime();
  const diff = date.getTime() - KNOWN_NEW_MOON;
  const days = diff / (1000 * 60 * 60 * 24);
  const age = ((days % LUNAR_MONTH) + LUNAR_MONTH) % LUNAR_MONTH;
  const illumination = Math.round(Math.sin((age / LUNAR_MONTH) * Math.PI * 2) * 50 + 50);
  let name;
  if (age < 1.84566) name = 'New Moon';
  else if (age < 5.53699) name = 'Waxing Crescent';
  else if (age < 9.22831) name = 'First Quarter';
  else if (age < 12.91963) name = 'Waxing Gibbous';
  else if (age < 16.61096) name = 'Full Moon';
  else if (age < 20.30228) name = 'Waning Gibbous';
  else if (age < 23.99361) name = 'Last Quarter';
  else if (age < 27.68493) name = 'Waning Crescent';
  else name = 'New Moon';
  return { name, illumination };
}
