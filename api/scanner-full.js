// api/scanner-full.js - AC369 FUSION Fase 8 (Elliott Wave & SMC)
import { detectElliottWave, analyzeSMC } from './elliott-smc.js';

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
  let elliottWave = { wave: '-', confidence: 0, description: '' };
  let smc = { signal: 'Neutral', summary: '' };

  try {
    const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}USDT&interval=1d&limit=100`);
    if (res.ok) {
      const data = await res.json();
      ohlcv = data.map(c => ({
        open: parseFloat(c[1]), high: parseFloat(c[2]), low: parseFloat(c[3]),
        close: parseFloat(c[4]), volume: parseFloat(c[5])
      }));

      // Deteksi pola candlestick
      chartPatterns = detectAllPatterns(ohlcv);

      // Deteksi Elliott Wave
      if (ohlcv.length >= 50) {
        elliottWave = detectElliottWave(ohlcv);
      }

      // Deteksi SMC
      if (ohlcv.length >= 20) {
        smc = analyzeSMC(ohlcv);
      }
    }
  } catch (e) {
    // Lanjut tanpa data OHLCV
  }

  // Fallback pola minimal
  if (chartPatterns.length === 0) {
    const change = coin.price_change_percentage_24h || 0;
    if (change > 5) chartPatterns.push({ name: 'Breakout Bullish', signal: 'bullish', probability: 60 });
    else if (change < -5) chartPatterns.push({ name: 'Breakdown Bearish', signal: 'bearish', probability: 60 });
    else chartPatterns.push({ name: 'Sideways', signal: 'neutral', probability: 40 });
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

function calculateBreakoutScore(coin, patterns, elliott, smc) {
  let score = 50;
  const change = coin.price_change_percentage_24h || 0;
  if (change > 10) score += 20;
  else if (change > 5) score += 10;
  else if (change < -5) score -= 10;

  // Bonus dari pola
  const bullishP = patterns.filter(p => p.signal === 'bullish').length;
  const bearishP = patterns.filter(p => p.signal === 'bearish').length;
  score += (bullishP - bearishP) * 8;

  // Bonus dari Elliott Wave
  if (elliott.wave.includes('Wave 3')) score += 15;
  else if (elliott.wave.includes('Wave 5')) score += 10;
  else if (elliott.wave.includes('Wave 4')) score -= 5;

  // Bonus dari SMC
  if (smc.signal === 'Bullish') score += 20;
  else if (smc.signal === 'Bearish') score -= 15;

  score = Math.max(0, Math.min(100, Math.round(score)));

  return {
    score,
    reasons: [change > 0 ? `+${change.toFixed(1)}%` : `${change.toFixed(1)}%`],
    interpretation: score >= 70 ? '🔥 Tinggi' : score >= 50 ? '📈 Pantau' : '💤 Rendah'
  };
}
