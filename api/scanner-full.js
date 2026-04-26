// api/scanner-full.js - AC369 FUSION v12.1 (Stable - No Import)
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

    for (const coin of filtered.slice(0, 80)) {
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
  const change24h = coin.price_change_percentage_24h || 0;

  let ohlcv = [];
  let chartPatterns = [];
  let elliottWave = { wave: 'Konsolidasi', confidence: 25, description: '' };
  let smc = { signal: 'Neutral', summary: '' };

  // Fetch OHLCV dari Binance (jika tersedia)
  try {
    const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}USDT&interval=1d&limit=100`);
    if (res.ok) {
      const data = await res.json();
      ohlcv = data.map(c => ({
        open: parseFloat(c[1]), high: parseFloat(c[2]), low: parseFloat(c[3]),
        close: parseFloat(c[4]), volume: parseFloat(c[5])
      }));

      chartPatterns = detectPatterns(ohlcv, change24h);
      if (ohlcv.length >= 30) elliottWave = detectElliottWave(ohlcv);
      if (ohlcv.length >= 15) smc = analyzeSMC(ohlcv);
    }
  } catch (e) {}

  // Fallback berdasarkan momentum
  if (chartPatterns.length === 0) chartPatterns = getMomentumPatterns(change24h);
  if (elliottWave.confidence < 25) elliottWave = getMomentumElliott(change24h);
  if (smc.signal === 'Neutral') smc = getMomentumSMC(change24h);

  const prob = calculateScore(coin, chartPatterns, elliottWave, smc);

  return {
    symbol,
    name: coin.name,
    price: coin.current_price,
    volume24h: coin.total_volume,
    priceChange24h: change24h,
    breakoutProbability: prob,
    chartPatterns: chartPatterns.slice(0, 3),
    elliottWave,
    smc,
    astrology: getAstrologySignal(new Date())
  };
}

// ==================== POLA ====================
function detectPatterns(ohlcv, change24h) {
  const patterns = [];
  if (ohlcv.length < 2) return getMomentumPatterns(change24h);
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
  return patterns.length > 0 ? patterns : getMomentumPatterns(change24h);
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
    return { wave: 'Wave Korektif (ABC)', confidence: 50, description: 'Koreksi sehat' };
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

// ==================== SMC ====================
function analyzeSMC(ohlcv) {
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
  return { signal: 'Neutral', summary: '' };
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

// ==================== FALLBACK ====================
function getMomentumPatterns(change) {
  if (change > 8) return [{ name: 'Breakout Bullish Kuat', signal: 'bullish', probability: 75 }];
  if (change > 3) return [{ name: 'Breakout Bullish Awal', signal: 'bullish', probability: 60 }];
  if (change < -8) return [{ name: 'Breakdown Bearish Kuat', signal: 'bearish', probability: 75 }];
  if (change < -3) return [{ name: 'Breakdown Bearish Awal', signal: 'bearish', probability: 60 }];
  return [{ name: 'Sideways Stabil', signal: 'neutral', probability: 40 }];
}

function getMomentumElliott(change) {
  if (change > 5) return { wave: 'Potensi Wave 3', confidence: 40, description: 'Momentum naik' };
  if (change < -5) return { wave: 'Potensi Korektif', confidence: 40, description: 'Momentum turun' };
  return { wave: 'Konsolidasi', confidence: 20, description: '' };
}

function getMomentumSMC(change) {
  if (change > 5) return { signal: 'Bullish', summary: 'Momentum beli dominan' };
  if (change < -5) return { signal: 'Bearish', summary: 'Momentum jual dominan' };
  return { signal: 'Neutral', summary: '' };
}

// ==================== SKOR ====================
function calculateScore(coin, patterns, elliott, smc) {
  let score = 50;
  const change = coin.price_change_percentage_24h || 0;
  if (change > 15) score += 25;
  else if (change > 8) score += 15;
  else if (change < -10) score -= 20;
  else if (change < -5) score -= 10;

  const bullish = patterns.filter(p => p.signal === 'bullish').length;
  const bearish = patterns.filter(p => p.signal === 'bearish').length;
  score += (bullish - bearish) * 10;

  if (elliott.wave.includes('Wave 3')) score += 15;
  else if (elliott.wave.includes('Korektif')) score -= 5;

  if (smc.signal === 'Bullish') score += 20;
  else if (smc.signal === 'Bearish') score -= 15;

  score = Math.max(0, Math.min(100, Math.round(score)));
  return {
    score,
    reasons: [change > 0 ? `+${change.toFixed(1)}%` : `${change.toFixed(1)}%`],
    interpretation: score >= 75 ? '🔥 Sangat Tinggi' : score >= 60 ? '📈 Tinggi' : score >= 45 ? '📊 Pantau' : '💤 Rendah'
  };
}

// ==================== ASTRO ====================
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
