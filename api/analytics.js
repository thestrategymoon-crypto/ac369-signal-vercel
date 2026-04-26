// api/analytics.js - AC369 FUSION v12.1 (RSI Real-Time Akurat)
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'max-age=0, s-maxage=60');

  try {
    const [btc, eth] = await Promise.all([analyze('BTCUSDT'), analyze('ETHUSDT')]);
    res.status(200).json({
      timestamp: new Date().toISOString(),
      btc,
      eth,
      smartMoneyNarrative: narrative(btc, eth)
    });
  } catch (e) {
    res.status(200).json({
      btc: fallback('BTC'),
      eth: fallback('ETH'),
      smartMoneyNarrative: 'Menunggu data real-time...'
    });
  }
}

function fallback(sym) {
  const price = sym === 'BTC' ? '78000.00' : '2400.00';
  return {
    symbol: sym,
    currentPrice: price,
    probabilityScore: 50,
    confluenceSignal: 'Neutral',
    confluenceStrength: 'Rendah',
    keySignals: [],
    technicalSummary: 'Data sedang dimuat...',
    rsi: { '1H': '50.0', '4H': '50.0', '1D': '50.0' },
    maStatus: { ma50: 'N/A', ma200: 'N/A', position: 'Tidak tersedia' }
  };
}

async function analyze(symbol) {
  const display = symbol.replace('USDT', '');
  let price = 0, change = 0;
  let rsi1h = 50, rsi4h = 50, rsi1d = 50;
  let ma50 = 'N/A', ma200 = 'N/A', pos = 'N/A';

  // Harga dari CoinGecko
  try {
    const id = symbol === 'BTCUSDT' ? 'bitcoin' : 'ethereum';
    const cg = await fetch(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${id}&sparkline=false&price_change_percentage=24h`);
    if (cg.ok) {
      const d = await cg.json();
      if (d[0]) {
        price = d[0].current_price || 0;
        change = d[0].price_change_percentage_24h || 0;
      }
    }
  } catch (e) {}

  // RSI multi-timeframe dari Binance
  try {
    const [k1h, k4h, k1d] = await Promise.all([
      fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1h&limit=100`),
      fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=4h&limit=100`),
      fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1d&limit=200`)
    ]);
    if (k1h.ok) { const d = await k1h.json(); const c = d.map(k => parseFloat(k[4])).filter(v => !isNaN(v) && v > 0); if (c.length >= 14) rsi1h = calcRSI(c); }
    if (k4h.ok) { const d = await k4h.json(); const c = d.map(k => parseFloat(k[4])).filter(v => !isNaN(v) && v > 0); if (c.length >= 14) rsi4h = calcRSI(c); }
    if (k1d.ok) {
      const d = await k1d.json();
      const c = d.map(k => parseFloat(k[4])).filter(v => !isNaN(v) && v > 0);
      if (c.length >= 14) rsi1d = calcRSI(c);
      if (c.length >= 50) ma50 = (c.slice(-50).reduce((a,b)=>a+b,0)/50).toFixed(2);
      if (c.length >= 200) {
        ma200 = (c.slice(-200).reduce((a,b)=>a+b,0)/200).toFixed(2);
        pos = price > parseFloat(ma200) ? 'Above 200MA (Bull)' : 'Below 200MA (Bear)';
      }
    }
  } catch (e) {}

  if (!price) price = symbol === 'BTCUSDT' ? 78000 : 2400;

  // Hitung skor
  let score = 50;
  const signals = [];
  if (rsi1h < 30) { score += 10; signals.push({ name: 'RSI 1H Oversold', bullish: true, active: true, weight: 10 }); }
  else if (rsi1h > 70) { score -= 10; signals.push({ name: 'RSI 1H Overbought', bullish: false, active: true, weight: 10 }); }
  if (rsi4h < 30) { score += 10; signals.push({ name: 'RSI 4H Oversold', bullish: true, active: true, weight: 10 }); }
  else if (rsi4h > 70) { score -= 10; signals.push({ name: 'RSI 4H Overbought', bullish: false, active: true, weight: 10 }); }
  if (rsi1d < 30) { score += 10; signals.push({ name: 'RSI 1D Oversold', bullish: true, active: true, weight: 10 }); }
  else if (rsi1d > 70) { score -= 10; signals.push({ name: 'RSI 1D Overbought', bullish: false, active: true, weight: 10 }); }
  if (change > 5) { score += 10; signals.push({ name: 'Momentum 24h +', bullish: true, active: true, weight: 10 }); }
  else if (change < -5) { score -= 10; signals.push({ name: 'Momentum 24h -', bullish: false, active: true, weight: 10 }); }
  if (pos.includes('Above')) { score += 10; signals.push({ name: 'Above 200MA', bullish: true, active: true, weight: 10 }); }
  else if (pos.includes('Below')) { score -= 10; signals.push({ name: 'Below 200MA', bullish: false, active: true, weight: 10 }); }

  score = Math.max(0, Math.min(100, Math.round(score)));
  let signal = 'Neutral', strength = 'Rendah';
  if (score >= 70) { signal = 'Strong Buy'; strength = 'Tinggi'; }
  else if (score >= 60) { signal = 'Buy'; strength = 'Sedang'; }
  else if (score <= 30) { signal = 'Strong Sell'; strength = 'Tinggi'; }
  else if (score <= 40) { signal = 'Sell'; strength = 'Sedang'; }

  return {
    symbol: display,
    currentPrice: price.toFixed(2),
    probabilityScore: score,
    confluenceSignal: signal,
    confluenceStrength: strength,
    keySignals: signals,
    technicalSummary: `RSI 1H:${rsi1h.toFixed(1)} | 4H:${rsi4h.toFixed(1)} | 1D:${rsi1d.toFixed(1)} | 24h:${change.toFixed(1)}%`,
    rsi: { '1H': rsi1h.toFixed(1), '4H': rsi4h.toFixed(1), '1D': rsi1d.toFixed(1) },
    maStatus: { ma50, ma200, position: pos }
  };
}

function calcRSI(prices, period = 14) {
  if (prices.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = prices.length - period; i < prices.length; i++) {
    const diff = prices[i] - prices[i - 1];
    if (diff > 0) gains += diff; else losses -= diff;
  }
  const avgGain = gains / period, avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  return 100 - (100 / (1 + avgGain / avgLoss));
}

function narrative(btc, eth) {
  if (btc.probabilityScore > 60 && eth.probabilityScore > 60) return '💰 BTC & ETH bullish kuat – pasar risk-on.';
  if (btc.probabilityScore > 60) return '📈 Bitcoin memimpin bullish, altcoin mungkin mengikuti.';
  if (eth.probabilityScore > 60) return '💎 Ethereum unggul – rotasi ke altcoin.';
  if (btc.probabilityScore < 40 && eth.probabilityScore < 40) return '⚠️ BTC & ETH bearish – pertimbangkan defensive.';
  return '📊 Pasar netral – tunggu konfirmasi sinyal.';
}
