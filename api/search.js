// api/search.js - AC369 FUSION Search & Deep Analysis (Multi-Timeframe)
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
      const searchRes = await fetch(searchUrl);
      if (searchRes.ok) {
        const searchData = await searchRes.json();
        const matchedCoin = searchData.coins?.find(c => c.symbol.toUpperCase() === symbol);
        if (matchedCoin) {
          const detailUrl = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${matchedCoin.id}&order=market_cap_desc&sparkline=false&price_change_percentage=24h`;
          const detailRes = await fetch(detailUrl);
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
        const ticker = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}USDT`);
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

    // 2. Ambil OHLCV untuk 3 timeframe: 1H, 4H, 1D
    const [klines1h, klines4h, klines1d] = await Promise.all([
      fetchKlines(symbol, '1h', 100),
      fetchKlines(symbol, '4h', 100),
      fetchKlines(symbol, '1d', 100)
    ]);

    // 3. Analisis per timeframe
    const tf1h = analyzeTimeframe(klines1h, '1H', currentPrice);
    const tf4h = analyzeTimeframe(klines4h, '4H', currentPrice);
    const tf1d = analyzeTimeframe(klines1d, '1D', currentPrice);

    // 4. Rekomendasi trading
    const recommendation = generateTradeRecommendation(tf1h, tf4h, tf1d, currentPrice, change24h);

    // 5. Astrologi
    const astrology = getAstrologySignal(new Date());

    // 6. Level support & resistance dari 1D
    let support = (currentPrice * 0.95).toFixed(4);
    let resistance = (currentPrice * 1.05).toFixed(4);
    if (klines1d.length >= 20) {
      support = Math.min(...klines1d.slice(-20).map(c => c.low)).toFixed(4);
      resistance = Math.max(...klines1d.slice(-20).map(c => c.high)).toFixed(4);
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

// ==================== FETCH KLINES ====================
async function fetchKlines(symbol, interval, limit) {
  try {
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}USDT&interval=${interval}&limit=${limit}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    return data.map(c => ({
      open: parseFloat(c[1]), high: parseFloat(c[2]), low: parseFloat(c[3]),
      close: parseFloat(c[4]), volume: parseFloat(c[5])
    }));
  } catch (e) {
    return [];
  }
}

// ==================== ANALISIS PER TIMEFRAME ====================
function analyzeTimeframe(ohlcv, label, currentPrice) {
  if (!ohlcv || ohlcv.length < 10) {
    return { rsi: 'N/A', patterns: [], elliottWave: { wave: 'Data kurang', confidence: 0, description: '' }, smc: { signal: 'Neutral', summary: 'Data OHLCV tidak cukup' } };
  }

  const closes = ohlcv.map(c => c.close);
  const rsi = closes.length >= 14 ? calculateRSI(closes, 14).toFixed(1) : 'N/A';
  const patterns = detectAllPatterns(ohlcv);
  const elliottWave = detectElliottWave(ohlcv);
  const smc = analyzeSMC(ohlcv);

  return { rsi, patterns, elliottWave, smc };
}

// ==================== POLA GRAFIK ====================
function detectAllPatterns(ohlcv) {
  const patterns = [];
  if (ohlcv.length < 3) return patterns;
  const lastIdx = ohlcv.length - 1;
  const last = ohlcv[lastIdx];
  const prev = ohlcv[lastIdx - 1];
  const body = Math.abs(last.close - last.open);
  const lowerWick = Math.min(last.open, last.close) - last.low;
  const upperWick = last.high - Math.max(last.open, last.close);
  const range = last.high - last.low;

  // 1. Bullish Engulfing
  if (prev.close < prev.open && last.close > last.open && last.open <= prev.close && last.close >= prev.open)
    patterns.push({ name: 'Bullish Engulfing', signal: 'bullish', probability: 80 });
  // 2. Bearish Engulfing
  if (prev.close > prev.open && last.close < last.open && last.open >= prev.close && last.close <= prev.open)
    patterns.push({ name: 'Bearish Engulfing', signal: 'bearish', probability: 80 });
  // 3. Hammer
  if (lowerWick > body * 2 && upperWick < body * 0.6 && body > 0)
    patterns.push({ name: 'Hammer', signal: 'bullish', probability: 75 });
  // 4. Shooting Star
  if (upperWick > body * 2 && lowerWick < body * 0.6 && body > 0)
    patterns.push({ name: 'Shooting Star', signal: 'bearish', probability: 75 });
  // 5. Doji
  if (body < range * 0.1 && range > 0) {
    if (lowerWick > upperWick * 1.5) patterns.push({ name: 'Dragonfly Doji (Bullish)', signal: 'bullish', probability: 65 });
    else if (upperWick > lowerWick * 1.5) patterns.push({ name: 'Gravestone Doji (Bearish)', signal: 'bearish', probability: 65 });
    else patterns.push({ name: 'Doji', signal: 'neutral', probability: 50 });
  }
  // 6. Three White Soldiers
  if (ohlcv.length >= 3) {
    const c1 = ohlcv[lastIdx - 2], c2 = ohlcv[lastIdx - 1], c3 = ohlcv[lastIdx];
    if (c1.close > c1.open && c2.close > c2.open && c3.close > c3.open && c2.close > c1.close && c3.close > c2.close)
      patterns.push({ name: 'Three White Soldiers', signal: 'bullish', probability: 85 });
  }
  // 7. Three Black Crows
  if (ohlcv.length >= 3) {
    const c1 = ohlcv[lastIdx - 2], c2 = ohlcv[lastIdx - 1], c3 = ohlcv[lastIdx];
    if (c1.close < c1.open && c2.close < c2.open && c3.close < c3.open && c2.close < c1.close && c3.close < c2.close)
      patterns.push({ name: 'Three Black Crows', signal: 'bearish', probability: 85 });
  }

  if (patterns.length === 0) {
    const change = ((last.close - prev.close) / prev.close) * 100;
    if (change > 2) patterns.push({ name: 'Momentum Naik', signal: 'bullish', probability: 55 });
    else if (change < -2) patterns.push({ name: 'Momentum Turun', signal: 'bearish', probability: 55 });
    else patterns.push({ name: 'Sideways', signal: 'neutral', probability: 40 });
  }
  return patterns.slice(0, 3);
}

// ==================== ELLIOTT WAVE ====================
function detectElliottWave(ohlcv) {
  if (ohlcv.length < 30) return { wave: 'Data tidak cukup', confidence: 15, description: 'Perlu minimal 30 candle' };
  const swings = findSwingPoints(ohlcv, 3);
  if (swings.length < 3) return { wave: 'Struktur belum jelas', confidence: 20, description: 'Swing point tidak ditemukan' };
  const recent = swings.slice(-5);
  const highs = recent.filter(s => s.type === 'high');
  const lows = recent.filter(s => s.type === 'low');
  if (highs.length < 2 || lows.length < 2) return { wave: 'Menunggu formasi', confidence: 25, description: 'Pola belum lengkap' };

  const lastHigh = highs[highs.length - 1], prevHigh = highs[highs.length - 2];
  const lastLow = lows[lows.length - 1], prevLow = lows[lows.length - 2];
  const currentPrice = ohlcv[ohlcv.length - 1].close;

  if (lastHigh.price > prevHigh.price && lastLow.price > prevLow.price) {
    return { wave: 'Wave 3 (Impulsif)', confidence: 55, description: 'Higher high & higher low → tren naik kuat' };
  }
  if (lastHigh.price < prevHigh.price && lastLow.price < prevLow.price) {
    return { wave: 'Wave Korektif (ABC)', confidence: 50, description: 'Lower high & lower low → koreksi' };
  }
  if (currentPrice > ohlcv.slice(-10).reduce((s, c) => s + c.close, 0) / 10) {
    return { wave: 'Potensi Wave 1/3', confidence: 35, description: 'Harga di atas rata-rata 10 candle' };
  }
  return { wave: 'Konsolidasi', confidence: 25, description: 'Tidak ada struktur impulsif' };
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

// ==================== SMC ====================
function analyzeSMC(ohlcv) {
  if (ohlcv.length < 15) return { signal: 'Neutral', summary: 'Data tidak cukup', orderBlock: null, liquiditySweep: null };

  const ls = findLiquiditySweep(ohlcv);
  const ob = findOrderBlock(ohlcv);

  if (ls.detected) {
    return { signal: ls.direction, summary: ls.description, orderBlock: ob.detected ? ob.type : null, liquiditySweep: ls.direction };
  }
  if (ob.detected) {
    return { signal: ob.type.includes('Demand') ? 'Bullish' : 'Bearish', summary: ob.description, orderBlock: ob.type, liquiditySweep: null };
  }

  // Analisis tren pendek
  const closes = ohlcv.slice(-5).map(c => c.close);
  if (closes.length >= 2) {
    const trend = closes[closes.length - 1] > closes[0] ? 'Bullish' : 'Bearish';
    const strength = Math.abs(closes[closes.length - 1] - closes[0]) / closes[0];
    if (strength > 0.02) {
      return { signal: trend, summary: `Tren ${trend === 'Bullish' ? 'naik' : 'turun'} ${(strength * 100).toFixed(1)}%`, orderBlock: null, liquiditySweep: null };
    }
  }
  return { signal: 'Neutral', summary: 'Tidak ada sinyal signifikan', orderBlock: null, liquiditySweep: null };
}

function findOrderBlock(ohlcv) {
  const recent = ohlcv.slice(-10);
  let maxVol = 0, obCandle = recent[0];
  for (let i = 0; i < recent.length; i++) { if (recent[i].volume > maxVol) { maxVol = recent[i].volume; obCandle = recent[i]; } }
  const avgVol = recent.reduce((a, b) => a + b.volume, 0) / recent.length;
  if (obCandle.volume < avgVol * 1.2) return { detected: false, type: null, price: null, description: '' };

  const isBullish = obCandle.close > obCandle.open;
  const currentPrice = ohlcv[ohlcv.length - 1].close;
  const blockHigh = obCandle.high, blockLow = obCandle.low;

  if (isBullish && currentPrice >= blockLow * 0.995 && currentPrice <= blockHigh * 1.005)
    return { detected: true, type: 'Demand Zone (Akumulasi)', price: blockLow, description: `Support di $${blockLow.toFixed(4)}` };
  if (!isBullish && currentPrice >= blockLow * 0.995 && currentPrice <= blockHigh * 1.005)
    return { detected: true, type: 'Supply Zone (Distribusi)', price: blockHigh, description: `Resistance di $${blockHigh.toFixed(4)}` };
  return { detected: false, type: null, price: null, description: '' };
}

function findLiquiditySweep(ohlcv) {
  const range = ohlcv.slice(-20, -1);
  if (range.length === 0) return { detected: false };
  const recentHigh = Math.max(...range.map(c => c.high));
  const recentLow = Math.min(...range.map(c => c.low));
  const last = ohlcv[ohlcv.length - 1];

  if (last.high > recentHigh && last.close < recentHigh)
    return { detected: true, direction: 'Bearish', description: `Sweep resistance $${recentHigh.toFixed(4)} → potensi turun` };
  if (last.low < recentLow && last.close > recentLow)
    return { detected: true, direction: 'Bullish', description: `Sweep support $${recentLow.toFixed(4)} → potensi naik` };
  return { detected: false };
}

// ==================== REKOMENDASI TRADING ====================
function generateTradeRecommendation(tf1h, tf4h, tf1d, price, change24h) {
  let score = 50;
  const reasons = [];
  const details = [];

  // Skor dari sinyal SMC & Pola di setiap timeframe
  for (const [label, tf] of [['1H', tf1h], ['4H', tf4h], ['1D', tf1d]]) {
    const smcSignal = tf.smc.signal;
    if (smcSignal === 'Bullish') { score += 10; reasons.push(`SMC ${label}: Bullish`); }
    else if (smcSignal === 'Bearish') { score -= 10; reasons.push(`SMC ${label}: Bearish`); }

    const bullishPatterns = tf.patterns.filter(p => p.signal === 'bullish').length;
    const bearishPatterns = tf.patterns.filter(p => p.signal === 'bearish').length;
    if (bullishPatterns > bearishPatterns) { score += 5; reasons.push(`Pola ${label}: ${bullishPatterns} bullish`); }
    else if (bearishPatterns > bullishPatterns) { score -= 5; reasons.push(`Pola ${label}: ${bearishPatterns} bearish`); }

    if (tf.elliottWave.wave.includes('Wave 3')) { score += 10; reasons.push(`Elliott ${label}: ${tf.elliottWave.wave}`); }
    else if (tf.elliottWave.wave.includes('Wave 5')) { score += 5; reasons.push(`Elliott ${label}: ${tf.elliottWave.wave}`); }
    else if (tf.elliottWave.wave.includes('Korektif')) { score -= 10; reasons.push(`Elliott ${label}: Korektif`); }

    // Detail per timeframe
    details.push({
      timeframe: label,
      rsi: tf.rsi,
      patterns: tf.patterns.map(p => p.name).join(', ') || '-',
      elliott: tf.elliottWave.wave,
      smc: `${smcSignal}: ${tf.smc.summary}`
    });
  }

  // Tambahan dari perubahan 24h
  if (change24h > 5) { score += 10; reasons.push('Momentum 24h positif'); }
  else if (change24h < -5) { score -= 10; reasons.push('Momentum 24h negatif'); }

  // Konversi skor ke rekomendasi
  let action = 'HOLD';
  let confidence = '';
  if (score >= 75) { action = 'LONG (Beli)'; confidence = 'Tinggi'; }
  else if (score >= 60) { action = 'LONG (Beli)'; confidence = 'Sedang'; }
  else if (score <= 25) { action = 'SHORT (Jual)'; confidence = 'Tinggi'; }
  else if (score <= 40) { action = 'SHORT (Jual)'; confidence = 'Sedang'; }
  else { action = 'HOLD (Tahan)'; confidence = 'Netral'; }

  return {
    action,
    confidence,
    score,
    reasons: reasons.slice(0, 5),
    details,
    summary: `Skor ${score}/100 → ${action} (${confidence}). ${reasons.slice(0, 3).join('; ')}.`
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
    'New Moon': { signal: '🔄 Awal Siklus', interpretation: 'Potensi tren baru, volatilitas tinggi' },
    'Waxing Crescent': { signal: '🌱 Kenaikan', interpretation: 'Momentum bullish mulai terbentuk' },
    'First Quarter': { signal: '⚡ Tekanan', interpretation: 'Keputusan besar, volatilitas' },
    'Waxing Gibbous': { signal: '📈 Optimis', interpretation: 'Tren bullish dominan' },
    'Full Moon': { signal: '🌕 Puncak', interpretation: 'Potensi reversal, volatilitas ekstrem' },
    'Waning Gibbous': { signal: '📉 Koreksi', interpretation: 'Mulai jenuh, potensi turun' },
    'Last Quarter': { signal: '🔻 Pelepasan', interpretation: 'Distribusi, tekanan jual' },
    'Waning Crescent': { signal: '💤 Akhir', interpretation: 'Konsolidasi, volume rendah' }
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
