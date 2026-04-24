// api/search.js - AC369 FUSION (Final Multi-API)
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'max-age=0, s-maxage=120');

  const inputSymbol = (req.query.symbol || '').toUpperCase().trim();
  if (!inputSymbol) {
    return res.status(400).json({ error: 'Parameter ?symbol= diperlukan. Contoh: /api/search?symbol=ADA' });
  }

  let coinId = '';
  let coinName = inputSymbol;
  let currentPrice = 0;
  let change24h = 0;
  let marketCap = 0;
  let totalVolume = 0;

  try {
    // ====== STRATEGI 1: COINGECKO ======
    let found = false;
    try {
      // 1a. Cari ID dari CoinGecko Search
      const searchUrl = `https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(inputSymbol)}`;
      const searchRes = await fetchWithTimeout(searchUrl, 5000);
      if (searchRes && searchRes.ok) {
        const searchData = await searchRes.json();
        const matched = searchData.coins?.find(c => c.symbol.toUpperCase() === inputSymbol);
        if (matched) {
          coinId = matched.id;
          coinName = matched.name || coinName;

          // 1b. Ambil data harga
          const marketUrl = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${coinId}&order=market_cap_desc&sparkline=false&price_change_percentage=24h`;
          const marketRes = await fetchWithTimeout(marketUrl, 5000);
          if (marketRes && marketRes.ok) {
            const marketData = await marketRes.json();
            if (marketData && marketData.length > 0) {
              const info = marketData[0];
              currentPrice = info.current_price || 0;
              change24h = info.price_change_percentage_24h || 0;
              marketCap = info.market_cap || 0;
              totalVolume = info.total_volume || 0;
              found = true;
            }
          }
        }
      }
    } catch (e) {
      console.warn('CoinGecko gagal, coba Binance...');
    }

    // ====== STRATEGI 2: BINANCE (JIKA COINGECKO GAGAL) ======
    if (!found || currentPrice === 0) {
      try {
        const tickerUrl = `https://api.binance.com/api/v3/ticker/24hr?symbol=${inputSymbol}USDT`;
        const tickerRes = await fetchWithTimeout(tickerUrl, 5000);
        if (tickerRes && tickerRes.ok) {
          const ticker = await tickerRes.json();
          currentPrice = parseFloat(ticker.lastPrice) || 0;
          change24h = parseFloat(ticker.priceChangePercent) || 0;
          totalVolume = parseFloat(ticker.quoteVolume) || 0;
          if (currentPrice > 0) found = true;
        }
      } catch (e) {
        console.warn('Binance juga gagal...');
      }
    }

    if (!found || currentPrice === 0) {
      return res.status(404).json({ error: `Koin "${inputSymbol}" tidak ditemukan di CoinGecko maupun Binance.` });
    }

    // ====== AMBIL OHLCV DARI COINGECKO (DENGAN FALLBACK) ======
    let klines1h = [], klines4h = [], klines1d = [];
    if (coinId) {
      // CoinGecko OHLCV
      [klines1h, klines4h, klines1d] = await Promise.all([
        fetchCoinGeckoOHLCV(coinId, 2, inputSymbol),
        fetchCoinGeckoOHLCV(coinId, 14, inputSymbol),
        fetchCoinGeckoOHLCV(coinId, 100, inputSymbol)
      ]);
    }

    // Jika CoinGecko OHLCV kosong, coba Binance OHLCV
    if (klines1d.length < 5) {
      try {
        const binanceKlines = await fetchBinanceKlines(inputSymbol, '1d', 100);
        if (binanceKlines.length > klines1d.length) {
          klines1d = binanceKlines;
        }
      } catch (e) {}
    }
    if (klines4h.length < 5) {
      try {
        const binanceKlines = await fetchBinanceKlines(inputSymbol, '4h', 100);
        if (binanceKlines.length > klines4h.length) {
          klines4h = binanceKlines;
        }
      } catch (e) {}
    }
    if (klines1h.length < 5) {
      try {
        const binanceKlines = await fetchBinanceKlines(inputSymbol, '1h', 100);
        if (binanceKlines.length > klines1h.length) {
          klines1h = binanceKlines;
        }
      } catch (e) {}
    }

    // ====== ANALISIS ======
    const tf1h = analyzeTimeframe(klines1h, '1H', currentPrice, change24h);
    const tf4h = analyzeTimeframe(klines4h, '4H', currentPrice, change24h);
    const tf1d = analyzeTimeframe(klines1d, '1D', currentPrice, change24h);
    const recommendation = generateTradeRecommendation(tf1h, tf4h, tf1d, currentPrice, change24h);
    const astrology = getAstrologySignal(new Date());

    // Support & Resistance
    let support = (currentPrice * 0.95).toFixed(4);
    let resistance = (currentPrice * 1.05).toFixed(4);
    const src = klines1d.length >= 10 ? klines1d : (klines4h.length >= 10 ? klines4h : klines1h);
    if (src.length >= 10) {
      const lows = src.slice(-20).map(c => c.low).filter(v => v > 0);
      const highs = src.slice(-20).map(c => c.high).filter(v => v > 0);
      if (lows.length) support = Math.min(...lows).toFixed(4);
      if (highs.length) resistance = Math.max(...highs).toFixed(4);
    }

    res.status(200).json({
      symbol: inputSymbol,
      name: coinName,
      price: currentPrice,
      change24h,
      marketCap,
      volume24h: totalVolume,
      support,
      resistance,
      timeframes: { '1H': tf1h, '4H': tf4h, '1D': tf1d },
      recommendation,
      astrology,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Search Fatal Error:', error.message);
    res.status(500).json({ error: 'Terjadi kesalahan internal. Coba lagi nanti.' });
  }
}

// ==================== HELPER FETCH ====================
async function fetchWithTimeout(url, timeoutMs = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json'
      }
    });
    clearTimeout(timer);
    return res;
  } catch (e) {
    clearTimeout(timer);
    return null;
  }
}

async function fetchCoinGeckoOHLCV(coinId, days, symbol) {
  try {
    // CoinGecko gratis hanya mendukung granularity tertentu
    const url = `https://api.coingecko.com/api/v3/coins/${coinId}/ohlc?vs_currency=usd&days=${days}`;
    const res = await fetchWithTimeout(url, 8000);
    if (!res || !res.ok) return [];
    const json = await res.json();
    if (!Array.isArray(json)) return [];
    return json.map(item => ({
      open: item[1], high: item[2], low: item[3], close: item[4], volume: 0
    }));
  } catch (e) {
    return [];
  }
}

async function fetchBinanceKlines(symbol, interval, limit) {
  try {
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}USDT&interval=${interval}&limit=${limit}`;
    const res = await fetchWithTimeout(url, 6000);
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

// ==================== ANALISIS PER TIMEFRAME ====================
function analyzeTimeframe(ohlcv, label, currentPrice, change24h) {
  if (!ohlcv || ohlcv.length < 5) {
    return makeFallbackAnalysis(change24h);
  }
  const closes = ohlcv.map(c => c.close);
  const rsi = closes.length >= 14 ? calculateRSI(closes, 14).toFixed(1) : 'N/A';
  const patterns = detectAllPatterns(ohlcv);
  const elliottWave = detectElliottWave(ohlcv);
  const smc = analyzeSMCDetail(ohlcv);
  return { rsi, patterns, elliottWave, smc };
}

function makeFallbackAnalysis(change24h) {
  const patterns = [];
  if (change24h > 3) patterns.push({ name: 'Momentum Naik', signal: 'bullish', probability: 55 });
  else if (change24h < -3) patterns.push({ name: 'Momentum Turun', signal: 'bearish', probability: 55 });
  else patterns.push({ name: 'Sideways (Terbatas)', signal: 'neutral', probability: 40 });
  return {
    rsi: 'N/A',
    patterns,
    elliottWave: { wave: 'Data terbatas', confidence: 10, description: 'Candle dari API kurang' },
    smc: { signal: 'Neutral', summary: 'Data tidak cukup', orderBlock: null, liquiditySweep: null, fvg: null }
  };
}

// ==================== POLA GRAFIK ====================
function detectAllPatterns(ohlcv) {
  const patterns = [];
  if (ohlcv.length < 3) return patterns;
  const lastIdx = ohlcv.length - 1;
  const last = ohlcv[lastIdx], prev = ohlcv[lastIdx - 1];
  const body = Math.abs(last.close - last.open);
  const lowerWick = Math.min(last.open, last.close) - last.low;
  const upperWick = last.high - Math.max(last.open, last.close);
  const range = last.high - last.low;

  if (prev.close < prev.open && last.close > last.open && last.open <= prev.close && last.close >= prev.open)
    patterns.push({ name: 'Bullish Engulfing 🔥', signal: 'bullish', probability: 80 });
  if (prev.close > prev.open && last.close < last.open && last.open >= prev.close && last.close <= prev.open)
    patterns.push({ name: 'Bearish Engulfing 🔥', signal: 'bearish', probability: 80 });
  if (lowerWick > body * 2 && upperWick < body * 0.6 && body > 0)
    patterns.push({ name: 'Hammer (Bullish)', signal: 'bullish', probability: 75 });
  if (upperWick > body * 2 && lowerWick < body * 0.6 && body > 0)
    patterns.push({ name: 'Shooting Star (Bearish)', signal: 'bearish', probability: 75 });
  if (range > 0 && body < range * 0.1) {
    if (lowerWick > upperWick * 1.5) patterns.push({ name: 'Dragonfly Doji (Bullish)', signal: 'bullish', probability: 65 });
    else if (upperWick > lowerWick * 1.5) patterns.push({ name: 'Gravestone Doji (Bearish)', signal: 'bearish', probability: 65 });
    else patterns.push({ name: 'Doji', signal: 'neutral', probability: 50 });
  }
  if (ohlcv.length >= 3) {
    const c1 = ohlcv[lastIdx - 2], c2 = ohlcv[lastIdx - 1], c3 = ohlcv[lastIdx];
    if (c1.close > c1.open && c2.close > c2.open && c3.close > c3.open && c2.close > c1.close && c3.close > c2.close)
      patterns.push({ name: 'Three White Soldiers 🚀', signal: 'bullish', probability: 85 });
    if (c1.close < c1.open && c2.close < c2.open && c3.close < c3.open && c2.close < c1.close && c3.close < c2.close)
      patterns.push({ name: 'Three Black Crows 📉', signal: 'bearish', probability: 85 });
  }
  if (patterns.length === 0) {
    const change = ((last.close - prev.close) / prev.close) * 100;
    if (change > 2) patterns.push({ name: 'Momentum Naik', signal: 'bullish', probability: 55 });
    else if (change < -2) patterns.push({ name: 'Momentum Turun', signal: 'bearish', probability: 55 });
    else patterns.push({ name: 'Sideways', signal: 'neutral', probability: 40 });
  }
  return patterns.slice(0, 4);
}

// ==================== ELLIOTT WAVE ====================
function detectElliottWave(ohlcv) {
  if (!ohlcv || ohlcv.length < 10) return { wave: 'Data kurang', confidence: 10, description: '' };
  const swings = findSwingPoints(ohlcv, 3);
  if (swings.length < 3) return { wave: 'Struktur belum jelas', confidence: 15, description: '' };
  const recent = swings.slice(-7);
  const highs = recent.filter(s => s.type === 'high');
  const lows = recent.filter(s => s.type === 'low');
  if (highs.length < 2 || lows.length < 2) return { wave: 'Menunggu formasi', confidence: 20, description: '' };
  const lastHigh = highs[highs.length - 1], prevHigh = highs[highs.length - 2];
  const lastLow = lows[lows.length - 1], prevLow = lows[lows.length - 2];
  const currentPrice = ohlcv[ohlcv.length - 1].close;

  if (lastHigh.price > prevHigh.price && lastLow.price > prevLow.price && currentPrice > lastLow.price) {
    const wave1 = Math.abs((highs[1]?.price || prevHigh.price) - (lows[0]?.price || prevLow.price));
    const wave3 = Math.abs(lastHigh.price - lastLow.price);
    const ratio = wave1 > 0 ? wave3 / wave1 : 0;
    let desc = 'Higher high & higher low, tren naik';
    if (ratio > 1.5 && ratio < 1.7) desc = `Extension 1.618 (rasio ${ratio.toFixed(2)})`;
    return { wave: 'Wave 3 (Impulsif)', confidence: 55, description: desc };
  }
  if (lastHigh.price < prevHigh.price && lastLow.price < prevLow.price && currentPrice < lastHigh.price) {
    const fibRetrace = ((prevHigh.price - lastLow.price) / (prevHigh.price - prevLow.price)) * 100;
    let desc = 'Fase koreksi';
    if (fibRetrace > 50 && fibRetrace < 62) desc = `Retracement 61.8% (${fibRetrace.toFixed(0)}%)`;
    return { wave: 'Wave Korektif (ABC)', confidence: 50, description: desc };
  }
  const ma20 = ohlcv.slice(-20).reduce((s, c) => s + c.close, 0) / Math.min(20, ohlcv.length);
  if (currentPrice > ma20) return { wave: 'Potensi Wave 1/3', confidence: 35, description: 'Di atas MA20' };
  return { wave: 'Konsolidasi', confidence: 25, description: 'Struktur impulsif tidak jelas' };
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
function analyzeSMCDetail(ohlcv) {
  if (!ohlcv || ohlcv.length < 5) return { signal: 'Neutral', summary: 'Data tidak cukup', orderBlock: null, liquiditySweep: null, fvg: null };
  const ob = findOrderBlock(ohlcv);
  const ls = findLiquiditySweep(ohlcv);
  const fvg = findFairValueGap(ohlcv);

  if (ls.detected) return { signal: ls.direction, summary: ls.description, orderBlock: ob.detected ? ob.type : null, liquiditySweep: ls.direction, fvg: fvg.detected ? fvg.type : null };
  if (ob.detected) return { signal: ob.type.includes('Demand') ? 'Bullish' : 'Bearish', summary: ob.description, orderBlock: ob.type, liquiditySweep: null, fvg: fvg.detected ? fvg.type : null };
  if (fvg.detected) return { signal: fvg.type.includes('Bullish') ? 'Bullish' : 'Bearish', summary: fvg.description, orderBlock: null, liquiditySweep: null, fvg: fvg.type };

  const closes = ohlcv.slice(-5).map(c => c.close);
  if (closes.length >= 2) {
    const trend = closes[closes.length - 1] > closes[0] ? 'Bullish' : 'Bearish';
    const strength = Math.abs(closes[closes.length - 1] - closes[0]) / closes[0];
    if (strength > 0.02) return { signal: trend, summary: `Tren ${trend === 'Bullish' ? 'naik' : 'turun'} ${(strength * 100).toFixed(1)}% dalam 5 candle`, orderBlock: null, liquiditySweep: null, fvg: null };
  }
  return { signal: 'Neutral', summary: 'Tidak ada sinyal SMC', orderBlock: null, liquiditySweep: null, fvg: null };
}

function findOrderBlock(ohlcv) {
  const recent = ohlcv.slice(-10);
  let maxVol = 0, obCandle = recent[0];
  for (let i = 0; i < recent.length; i++) { if (recent[i].volume > maxVol) { maxVol = recent[i].volume; obCandle = recent[i]; } }
  const avgVol = recent.reduce((a, b) => a + b.volume, 0) / recent.length;
  if (avgVol === 0 || obCandle.volume < avgVol * 1.2) return { detected: false };
  const isBullish = obCandle.close > obCandle.open;
  const currentPrice = ohlcv[ohlcv.length - 1].close;
  const blockHigh = obCandle.high, blockLow = obCandle.low;
  if (isBullish && currentPrice >= blockLow * 0.995 && currentPrice <= blockHigh * 1.005)
    return { detected: true, type: 'Demand Zone', price: blockLow, description: `Support $${blockLow.toFixed(4)}` };
  if (!isBullish && currentPrice >= blockLow * 0.995 && currentPrice <= blockHigh * 1.005)
    return { detected: true, type: 'Supply Zone', price: blockHigh, description: `Resistance $${blockHigh.toFixed(4)}` };
  return { detected: false };
}

function findLiquiditySweep(ohlcv) {
  const range = ohlcv.slice(-20, -1);
  if (!range.length) return { detected: false };
  const recentHigh = Math.max(...range.map(c => c.high));
  const recentLow = Math.min(...range.map(c => c.low));
  const last = ohlcv[ohlcv.length - 1];
  if (last.high > recentHigh && last.close < recentHigh) return { detected: true, direction: 'Bearish', description: `Sweep high $${recentHigh.toFixed(4)}` };
  if (last.low < recentLow && last.close > recentLow) return { detected: true, direction: 'Bullish', description: `Sweep low $${recentLow.toFixed(4)}` };
  return { detected: false };
}

function findFairValueGap(ohlcv) {
  if (ohlcv.length < 3) return { detected: false };
  const lastIdx = ohlcv.length - 1;
  const prev2 = ohlcv[lastIdx - 2], last = ohlcv[lastIdx];
  if (prev2.low > last.high) return { detected: true, type: 'Bullish FVG', description: `Gap $${last.high.toFixed(4)} - $${prev2.low.toFixed(4)}` };
  if (prev2.high < last.low) return { detected: true, type: 'Bearish FVG', description: `Gap $${prev2.high.toFixed(4)} - $${last.low.toFixed(4)}` };
  return { detected: false };
}

// ==================== REKOMENDASI ====================
function generateTradeRecommendation(tf1h, tf4h, tf1d, price, change24h) {
  let score = 50;
  const reasons = [];
  for (const [label, tf] of [['1H', tf1h], ['4H', tf4h], ['1D', tf1d]]) {
    let tfScore = 0;
    if (tf.smc.signal === 'Bullish') { tfScore += 15; reasons.push(`SMC ${label}: ${tf.smc.summary}`); }
    else if (tf.smc.signal === 'Bearish') { tfScore -= 15; reasons.push(`SMC ${label}: ${tf.smc.summary}`); }
    const bullishP = tf.patterns.filter(p => p.signal === 'bullish').length;
    const bearishP = tf.patterns.filter(p => p.signal === 'bearish').length;
    if (bullishP > bearishP) { tfScore += 8; reasons.push(`Pola ${label}: ${bullishP} bullish`); }
    else if (bearishP > bullishP) { tfScore -= 8; reasons.push(`Pola ${label}: ${bearishP} bearish`); }
    if (tf.elliottWave.wave.includes('Wave 3')) { tfScore += 12; reasons.push(`Elliott ${label}: Wave 3`); }
    else if (tf.elliottWave.wave.includes('Korektif')) { tfScore -= 10; reasons.push(`Elliott ${label}: Korektif`); }
    const rsi = parseFloat(tf.rsi);
    if (!isNaN(rsi)) {
      if (rsi < 30) { tfScore += 10; reasons.push(`RSI ${label}: Oversold`); }
      else if (rsi > 70) { tfScore -= 10; reasons.push(`RSI ${label}: Overbought`); }
    }
    score += tfScore;
  }
  if (change24h > 8) { score += 15; reasons.push('Momentum 24h sangat positif'); }
  else if (change24h > 3) { score += 8; reasons.push('Momentum 24h positif'); }
  else if (change24h < -8) { score -= 15; reasons.push('Momentum 24h sangat negatif'); }
  else if (change24h < -3) { score -= 8; reasons.push('Momentum 24h negatif'); }
  score = Math.max(0, Math.min(100, score));
  let action = '⚪ HOLD (Tahan)', confidence = 'Netral', explanation = 'Sinyal campuran, pasar konsolidasi.';
  if (score >= 75) { action = '🟢 LONG (Beli)'; confidence = 'Tinggi'; explanation = 'Konfluensi bullish kuat di semua timeframe.'; }
  else if (score >= 60) { action = '🟢 LONG (Beli)'; confidence = 'Sedang'; explanation = 'Beberapa sinyal bullish, perlu konfirmasi.'; }
  else if (score <= 25) { action = '🔴 SHORT (Jual)'; confidence = 'Tinggi'; explanation = 'Konfluensi bearish kuat di semua timeframe.'; }
  else if (score <= 40) { action = '🔴 SHORT (Jual)'; confidence = 'Sedang'; explanation = 'Beberapa sinyal bearish, perlu konfirmasi.'; }
  return { action, confidence, score, explanation, reasons: reasons.slice(0, 6), summary: `Skor ${score}/100 → ${action} (${confidence}). ${explanation}` };
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
    'New Moon': { signal: '🔄 Awal Siklus', interpretation: 'Tren baru, volatilitas tinggi' },
    'Waxing Crescent': { signal: '🌱 Kenaikan', interpretation: 'Momentum bullish mulai' },
    'First Quarter': { signal: '⚡ Tekanan', interpretation: 'Keputusan besar, volatilitas' },
    'Waxing Gibbous': { signal: '📈 Optimis', interpretation: 'Bullish dominan' },
    'Full Moon': { signal: '🌕 Puncak', interpretation: 'Potensi reversal, volatilitas ekstrem' },
    'Waning Gibbous': { signal: '📉 Koreksi', interpretation: 'Mulai jenuh, potensi turun' },
    'Last Quarter': { signal: '🔻 Pelepasan', interpretation: 'Distribusi, tekanan jual' },
    'Waning Crescent': { signal: '💤 Akhir', interpretation: 'Konsolidasi, volume rendah' }
  };
  return { moonPhase: phase.name, illumination: phase.illumination, signal: signals[phase.name]?.signal || 'Neutral', interpretation: signals[phase.name]?.interpretation || '' };
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
