// api/scanner-full.js - AC369 FUSION (Enhanced)
import { detectElliottWave, analyzeSMC } from './elliott-smc.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'max-age=0, s-maxage=300');
  try {
    const allCoins = [];
    for (let page = 1; page <= 2; page++) {
      const response = await fetch(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=${page}&sparkline=false&price_change_percentage=24h`);
      const data = await response.json();
      data.forEach(c => allCoins.push(c));
    }
    const filtered = allCoins.filter(c => c.total_volume > 3000000 && c.market_cap > 30000000);
    const results = [];
    for (const coin of filtered.slice(0, 80)) {
      const analysis = await analyzeCoin(coin);
      if (analysis) results.push(analysis);
    }
    results.sort((a, b) => b.breakoutProbability.score - a.breakoutProbability.score);
    res.status(200).json({ timestamp: new Date().toISOString(), totalScanned: filtered.length, results: results.slice(0, 40) });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

async function analyzeCoin(coin) {
  const symbol = coin.symbol.toUpperCase();
  const change24h = coin.price_change_percentage_24h || 0;
  let ohlcv = [], chartPatterns = [], elliottWave = { wave: 'Konsolidasi', confidence: 25, description: '' }, smc = { signal: 'Neutral', summary: '' };
  try {
    const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}USDT&interval=1d&limit=100`);
    if (res.ok) {
      const data = await res.json();
      ohlcv = data.map(c => ({ open: parseFloat(c[1]), high: parseFloat(c[2]), low: parseFloat(c[3]), close: parseFloat(c[4]), volume: parseFloat(c[5]) }));
      chartPatterns = detectAllPatterns(ohlcv, change24h);
      if (ohlcv.length >= 30) elliottWave = detectElliottWave(ohlcv);
      if (ohlcv.length >= 15) smc = analyzeSMC(ohlcv);
    }
  } catch (e) {}
  if (chartPatterns.length === 0) chartPatterns = getMomentumPatterns(change24h);
  if (elliottWave.confidence < 30) elliottWave = getMomentumElliott(change24h);
  if (smc.signal === 'Neutral') smc = getMomentumSMC(change24h);
  const prob = calculateScore(coin, chartPatterns, elliottWave, smc);
  return { symbol, name: coin.name, price: coin.current_price, volume24h: coin.total_volume, priceChange24h: change24h, breakoutProbability: prob, chartPatterns: chartPatterns.slice(0, 3), elliottWave, smc, astrology: getAstrologySignal(new Date()) };
}

// Gunakan fungsi deteksi pola, Elliott, SMC, Astro dari file-file sebelumnya (sama).
