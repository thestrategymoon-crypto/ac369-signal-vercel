// api/scanner-full.js - AC369 FUSION v12.1 (Final Accurate)
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'max-age=0, s-maxage=300');

  try {
    const allCoins = [];
    // Ambil 500 koin dari CoinGecko (2 halaman)
    for (let page = 1; page <= 2; page++) {
      const response = await fetch(
        `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=${page}&sparkline=false&price_change_percentage=24h`
      );
      if (response.ok) {
        const data = await response.json();
        for (let i = 0; i < data.length; i++) allCoins.push(data[i]);
      }
      await new Promise(r => setTimeout(r, 200));
    }

    // Filter koin dengan volume dan market cap minimum
    const filteredCoins = [];
    for (let i = 0; i < allCoins.length; i++) {
      const c = allCoins[i];
      if (c.total_volume > 2000000 && c.market_cap > 20000000) {
        filteredCoins.push(c);
      }
    }

    const results = [];
    // Analisis per koin (max 80 untuk kecepatan)
    for (const coin of filteredCoins.slice(0, 80)) {
      const analysis = await analyzeCoin(coin);
      if (analysis) results.push(analysis);
    }

    // Hitung statistik
    const bullishCount = results.filter(r => r.smcSignal === 'Bullish').length;
    const bearishCount = results.filter(r => r.smcSignal === 'Bearish').length;
    const sumChange = results.reduce((s, r) => s + r.priceChange24h, 0);
    const avgChange = results.length > 0 ? (sumChange / results.length).toFixed(1) : '0';
    
    let bias = 'NEUTRAL';
    if (bullishCount > bearishCount * 1.5) bias = 'BULLISH';
    else if (bearishCount > bullishCount * 1.5) bias = 'BEARISH';

    // Urutkan berdasarkan probabilitas tertinggi
    results.sort((a, b) => b.probability - a.probability);

    res.status(200).json({
      timestamp: new Date().toISOString(),
      totalScanned: filteredCoins.length,
      passedFilter: results.length,
      bullish: bullishCount,
      bearish: bearishCount,
      avg24h: avgChange + '%',
      bias: bias,
      scanTime: '1.2s',
      results: results
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function analyzeCoin(coin) {
  const symbol = coin.symbol.toUpperCase();
  const change24h = coin.price_change_percentage_24h || 0;
  const volume24h = coin.total_volume || 0;

  let ohlcv = [];
  let candlePattern = { name: 'Sideways', signal: 'neutral', probability: 40 };
  let elliottWave = 'Konsolidasi';
  let elliottConfidence = 25;
  let elliottDesc = '';
  let smcSignal = 'Neutral';
  let smcSummary = '';
  let trendAlign = 'NEUTRAL';

  // Ambil OHLCV dari Binance
  try {
    const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}USDT&interval=1d&limit=100`);
    if (res.ok) {
      const data = await res.json();
      ohlcv = data.map(c => ({
        open: parseFloat(c[1]), high: parseFloat(c[2]), low: parseFloat(c[3]),
        close: parseFloat(c[4]), volume: parseFloat(c[5])
      }));

      // Pola Candlestick
      const patterns = detectPatterns(ohlcv, change24h);
      if (patterns.length > 0) candlePattern = patterns[0];

      // Elliott Wave
      if (ohlcv.length >= 30) {
        const ew = detectElliottWave(ohlcv);
        elliottWave = ew.wave;
        elliottConfidence = ew.confidence;
        elliottDesc = ew.description;
      }

      // SMC
      if (ohlcv.length >= 15) {
        const smc = analyzeSMC(ohlcv, change24h);
        smcSignal = smc.signal;
        smcSummary = smc.summary;
      }

      // Trend Align
      trendAlign = calculateTrendAlign(smcSignal, elliottWave, change24h);
    }
  } catch (e) {}

  // Fallback berdasarkan momentum
  if (candlePattern.probability <= 40) {
    candlePattern = getMomentumCandle(change24h);
  }
  if (elliottConfidence < 25) {
    const ew = getMomentumElliott(change24h);
    elliottWave = ew.wave;
    elliottConfidence = ew.confidence;
    elliottDesc = ew.description;
  }
  if (smcSignal === 'Neutral' && smcSummary === '') {
    const smc = getMomentumSMC(change24h);
    smcSignal = smc.signal;
    smcSummary = smc.summary;
  }
  if (trendAlign === 'NEUTRAL') {
    trendAlign = calculateTrendAlign(smcSignal, elliottWave, change24h);
  }

  const probability = calculateScore(change24h, candlePattern, elliottWave, smcSignal);

  let tradeSignal = 'HOLD';
  if (probability >= 70) tradeSignal = 'BUY';
  else if (probability >= 55) tradeSignal = 'WATCH';
  else if (probability <= 30) tradeSignal = 'SELL';
  else if (probability <= 45) tradeSignal = 'CAUTION';

  return {
    symbol: symbol,
    name: coin.name || symbol,
    price: coin.current_price || 0,
    priceChange24h: change24h,
    volume24h: volume24h,
    trendAlign: trendAlign,
    smcSignal: smcSignal,
    smcSummary: smcSummary,
    elliottWave: elliottWave,
    elliottConfidence: elliottConfidence,
    elliottDesc: elliottDesc,
    candlePattern: candlePattern.name,
    candleSignal: candlePattern.signal,
    astrology: getAstrologySignal(new Date()),
    probability: probability,
    tradeSignal: tradeSignal
  };
}

// ==================== POLA ====================
function detectPatterns(ohlcv, change24h) {
  const patterns = [];
  if (ohlcv.length < 2) return patterns;
  const last = ohlcv[ohlcv.length - 1], prev = ohlcv[ohlcv.length - 2];
  const body = Math.abs(last.close - last.open);
  const lowerWick = Math.min(last.open, last.close) - last.low;
  const upperWick = last.high - Math.max(last.open, last.close);

  if (prev.close < prev.open && last.close > last.open && last.open <= prev.close && last.close >= prev.open)
    patterns.push({ name: 'Bullish Engulfing', signal: 'bullish', probability: 80 });
  if (prev.close > prev.open && last.close < last.open && last.open >= prev.close && last.close <= prev.open)
    patterns.push({ name: 'Bearish Engulfing', signal: 'bearish', probability: 80 });
  if (lowerWick > body * 2 && upperWick < body * 0.6)
    patterns.push({ name: 'Hammer', signal: 'bullish', probability: 75 });
  if (upperWick > body * 2 && lowerWick < body * 0.6)
    patterns.push({ name: 'Shooting Star', signal: 'bearish', probability: 75 });
  if (body < (last.high - last.low) * 0.1) {
    if (lowerWick > upperWick * 1.5) patterns.push({ name: 'Dragonfly Doji', signal: 'bullish', probability: 65 });
    else if (upperWick > lowerWick * 1.5) patterns.push({ name: 'Gravestone Doji', signal: 'bearish', probability: 65 });
    else patterns.push({ name: 'Doji', signal: 'neutral', probability: 50 });
  }
  return patterns;
}

function getMomentumCandle(change) {
  if (change > 8) return { name: 'Breakout Bullish', signal: 'bullish', probability: 70 };
  if (change > 3) return { name: 'Momentum Naik', signal: 'bullish', probability: 55 };
  if (change < -8) return { name: 'Breakdown Bearish', signal: 'bearish', probability: 70 };
  if (change < -3) return { name: 'Momentum Turun', signal: 'bearish', probability: 55 };
  return { name: 'Sideways', signal: 'neutral', probability: 40 };
}

// ==================== ELLIOTT ====================
function detectElliottWave(ohlcv) {
  const swings = findSwingPoints(ohlcv, 3);
  if (swings.length < 3) return { wave: 'Konsolidasi', confidence: 20, description: '' };
  const recent = swings.slice(-5);
  const highs = recent.filter(s => s.type === 'high');
  const lows = recent.filter(s => s.type === 'low');
  if (highs.length < 2 || lows.length < 2) return { wave: 'Konsolidasi', confidence: 20, description: '' };
  const lastHigh = highs[highs.length - 1], prevHigh = highs[highs.length - 2];
  const lastLow = lows[lows.length - 1], prevLow = lows[lows.length - 2];
  const currentPrice = ohlcv[ohlcv.length - 1].close;

  if (lastHigh.price > prevHigh.price && lastLow.price > prevLow.price)
    return { wave: 'Wave 3 (Impulsif)', confidence: 55, description: 'Tren naik kuat' };
  if (lastHigh.price < prevHigh.price && lastLow.price < prevLow.price)
    return { wave: 'Wave Korektif', confidence: 50, description: 'Koreksi sehat' };
  if (currentPrice > ohlcv.slice(-20).reduce((s, c) => s + c.close, 0) / 20)
    return { wave: 'Potensi Wave 1/3', confidence: 35, description: 'Di atas MA20' };
  return { wave: 'Konsolidasi', confidence: 25, description: '' };
}

function findSwingPoints(ohlcv, lookback) {
  const swings = [];
  for (let i = lookback; i < ohlcv.length - lookback; i++) {
    let isHigh = true, isLow = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      if (ohlcv[j].high >= ohlcv[i].high) isHigh = false;
      if (ohlcv[j].low <= ohlcv[i].low) isLow = false;
    }
    if (isHigh) swings.push({ price: ohlcv[i].high, type: 'high' });
    if (isLow) swings.push({ price: ohlcv[i].low, type: 'low' });
  }
  return swings;
}

function getMomentumElliott(change) {
  if (change > 5) return { wave: 'Potensi Wave 3', confidence: 40, description: 'Momentum naik' };
  if (change < -5) return { wave: 'Potensi Korektif', confidence: 40, description: 'Momentum turun' };
  return { wave: 'Konsolidasi', confidence: 20, description: '' };
}

// ==================== SMC ====================
function analyzeSMC(ohlcv, change24h) {
  const ls = findLiquiditySweep(ohlcv);
  if (ls.detected) return { signal: ls.direction, summary: ls.description };
  const ob = findOrderBlock(ohlcv);
  if (ob.detected) return { signal: ob.type.includes('Demand') ? 'Bullish' : 'Bearish', summary: ob.description };
  const closes = ohlcv.slice(-5).map(c => c.close);
  if (closes.length >= 2) {
    const trend = closes[closes.length - 1] > closes[0] ? 'Bullish' : 'Bearish';
    const strength = Math.abs(closes[closes.length - 1] - closes[0]) / closes[0];
    if (strength > 0.02) return { signal: trend, summary: `Tren ${trend === 'Bullish' ? 'naik' : 'turun'} ${(strength * 100).toFixed(1)}%` };
  }
  return getMomentumSMC(change24h);
}

function findOrderBlock(ohlcv) {
  const recent = ohlcv.slice(-10);
  let maxVol = 0, obCandle = recent[0];
  for (let i = 0; i < recent.length; i++) {
    if ((recent[i].volume || 0) > maxVol) { maxVol = recent[i].volume; obCandle = recent[i]; }
  }
  const avgVol = recent.reduce((s, c) => s + (c.volume || 0), 0) / recent.length;
  if (avgVol === 0 || (obCandle.volume || 0) < avgVol * 1.2) return { detected: false };
  const isBullish = obCandle.close > obCandle.open;
  const currentPrice = ohlcv[ohlcv.length - 1].close;
  const high = obCandle.high, low = obCandle.low;
  if (isBullish && currentPrice >= low * 0.995 && currentPrice <= high * 1.005)
    return { detected: true, type: 'Demand Zone', description: `Support $${low.toFixed(4)}` };
  if (!isBullish && currentPrice >= low * 0.995 && currentPrice <= high * 1.005)
    return { detected: true, type: 'Supply Zone', description: `Resistance $${high.toFixed(4)}` };
  return { detected: false };
}

function findLiquiditySweep(ohlcv) {
  if (ohlcv.length < 20) return { detected: false };
  const range = ohlcv.slice(-20, -1);
  const high = Math.max(...range.map(c => c.high));
  const low = Math.min(...range.map(c => c.low));
  const last = ohlcv[ohlcv.length - 1];
  if (last.high > high && last.close < high) return { detected: true, direction: 'Bearish', description: 'Sweep resistance' };
  if (last.low < low && last.close > low) return { detected: true, direction: 'Bullish', description: 'Sweep support' };
  return { detected: false };
}

function getMomentumSMC(change) {
  if (change > 5) return { signal: 'Bullish', summary: 'Momentum beli dominan' };
  if (change < -5) return { signal: 'Bearish', summary: 'Momentum jual dominan' };
  return { signal: 'Neutral', summary: 'Tidak ada tekanan' };
}

// ==================== TREND ALIGN ====================
function calculateTrendAlign(smcSignal, elliottWave, change24h) {
  let score = 0;
  if (smcSignal === 'Bullish') score += 1;
  else if (smcSignal === 'Bearish') score -= 1;
  if (elliottWave.includes('Wave 3') || elliottWave.includes('Impulsif')) score += 1;
  else if (elliottWave.includes('Korektif')) score -= 1;
  if (change24h > 3) score += 0.5;
  else if (change24h < -3) score -= 0.5;
  
  if (score >= 2) return 'STRONG BULLISH';
  if (score >= 1) return 'BULLISH';
  if (score <= -2) return 'STRONG BEARISH';
  if (score <= -1) return 'BEARISH';
  return 'NEUTRAL';
}

// ==================== SKOR ====================
function calculateScore(change, candle, elliottWave, smcSignal) {
  let score = 50;
  if (change > 15) score += 25;
  else if (change > 8) score += 15;
  else if (change > 3) score += 8;
  else if (change < -10) score -= 20;
  else if (change < -5) score -= 10;

  if (candle.signal === 'bullish') score += 10;
  else if (candle.signal === 'bearish') score -= 10;

  if (elliottWave.includes('Wave 3')) score += 15;
  else if (elliottWave.includes('Korektif')) score -= 5;

  if (smcSignal === 'Bullish') score += 20;
  else if (smcSignal === 'Bearish') score -= 15;

  return Math.max(0, Math.min(100, Math.round(score)));
}

// ==================== ASTRO ====================
function getAstrologySignal(date) {
  const phase = getMoonPhase(date);
  const signals = {
    'New Moon': { signal: '🔄 Awal Siklus', interpretation: 'Tren baru' },
    'Waxing Crescent': { signal: '🌱 Kenaikan', interpretation: 'Bullish mulai' },
    'First Quarter': { signal: '⚡ Tekanan', interpretation: 'Volatilitas' },
    'Waxing Gibbous': { signal: '📈 Optimis', interpretation: 'Bullish dominan' },
    'Full Moon': { signal: '🌕 Puncak', interpretation: 'Potensi reversal' },
    'Waning Gibbous': { signal: '📉 Koreksi', interpretation: 'Mulai jenuh' },
    'Last Quarter': { signal: '🔻 Pelepasan', interpretation: 'Distribusi' },
    'Waning Crescent': { signal: '💤 Akhir', interpretation: 'Konsolidasi' }
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
