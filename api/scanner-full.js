// api/scanner-full.js - AC369 FUSION (Pola Dijamin Muncul)
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'max-age=0, s-maxage=300');
  try {
    const all = [];
    for (let p=1; p<=2; p++) {
      const r = await fetch(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=${p}&sparkline=false&price_change_percentage=24h`);
      const d = await r.json();
      d.forEach(c => all.push(c));
    }
    const filtered = all.filter(c => c.total_volume > 3000000 && c.market_cap > 30000000);
    const results = [];
    for (const coin of filtered.slice(0, 100)) {
      try {
        const analysis = await analyzeCoin(coin);
        if (analysis) results.push(analysis);
      } catch (e) {}
    }
    results.sort((a,b) => b.breakoutProbability.score - a.breakoutProbability.score);
    res.status(200).json({ timestamp: new Date().toISOString(), totalScanned: filtered.length, results: results.slice(0,40) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

async function analyzeCoin(coin) {
  const symbol = coin.symbol.toUpperCase();
  let ohlcv = [];
  let patterns = [];
  try {
    const r = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}USDT&interval=1d&limit=30`);
    if (r.ok) {
      const d = await r.json();
      ohlcv = d.map(c => ({
        open: parseFloat(c[1]), high: parseFloat(c[2]), low: parseFloat(c[3]), close: parseFloat(c[4]), volume: parseFloat(c[5])
      }));
      patterns = detectPatterns(ohlcv);
    }
  } catch (e) {}
  
  // Fallback pola minimal
  if (patterns.length === 0) {
    const change = coin.price_change_percentage_24h || 0;
    if (change > 5) patterns.push({ name: 'Breakout Bullish', signal: 'bullish', probability: 60 });
    else if (change < -5) patterns.push({ name: 'Breakdown Bearish', signal: 'bearish', probability: 60 });
    else patterns.push({ name: 'Sideways', signal: 'neutral', probability: 40 });
  }

  const prob = calculateScore(coin, patterns);
  return {
    symbol, name: coin.name,
    price: coin.current_price,
    volume24h: coin.total_volume,
    priceChange24h: coin.price_change_percentage_24h,
    breakoutProbability: prob,
    chartPatterns: patterns.slice(0,3),
    elliottWave: { wave: '-', confidence: 0, description: '' },
    smc: { signal: 'Neutral', summary: '' }
  };
}

function detectPatterns(ohlcv) {
  if (ohlcv.length < 2) return [];
  const last = ohlcv[ohlcv.length-1];
  const prev = ohlcv[ohlcv.length-2];
  const patterns = [];
  const body = Math.abs(last.close - last.open);
  const lowerWick = Math.min(last.open, last.close) - last.low;
  const upperWick = last.high - Math.max(last.open, last.close);
  
  if (prev.close < prev.open && last.close > last.open && last.close > prev.open) patterns.push({ name: 'Bullish Engulfing', signal: 'bullish', probability: 75 });
  if (prev.close > prev.open && last.close < last.open && last.close < prev.open) patterns.push({ name: 'Bearish Engulfing', signal: 'bearish', probability: 75 });
  if (lowerWick > body*2 && upperWick < body*0.5) patterns.push({ name: 'Hammer', signal: 'bullish', probability: 70 });
  if (upperWick > body*2 && lowerWick < body*0.5) patterns.push({ name: 'Shooting Star', signal: 'bearish', probability: 70 });
  return patterns;
}

function calculateScore(coin, patterns) {
  let score = 50;
  const change = coin.price_change_percentage_24h || 0;
  if (change > 10) score += 20;
  else if (change > 5) score += 10;
  else if (change < -5) score -= 10;
  
  const bullish = patterns.filter(p => p.signal === 'bullish').length;
  const bearish = patterns.filter(p => p.signal === 'bearish').length;
  score += (bullish - bearish) * 8;
  
  score = Math.max(0, Math.min(100, Math.round(score)));
  return {
    score,
    reasons: [change > 0 ? `+${change.toFixed(1)}%` : `${change.toFixed(1)}%`],
    interpretation: score >= 70 ? '🔥 Tinggi' : score >= 50 ? '📈 Pantau' : '💤 Rendah'
  };
}
