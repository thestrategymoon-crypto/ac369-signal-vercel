// api/analytics.js - AC369 FUSION (RSI Real-time Akurat)
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'max-age=0, s-maxage=60');

  const [btc, eth] = await Promise.allSettled([analyze('BTCUSDT'), analyze('ETHUSDT')]);
  const btcData = btc.status === 'fulfilled' ? btc.value : fallback('BTC');
  const ethData = eth.status === 'fulfilled' ? eth.value : fallback('ETH');

  res.status(200).json({
    timestamp: new Date().toISOString(),
    btc: btcData,
    eth: ethData,
    smartMoneyNarrative: narrative(btcData, ethData)
  });
}

function fallback(sym) {
  return {
    symbol: sym,
    currentPrice: sym === 'BTC' ? '78000.00' : '2400.00',
    probabilityScore: 50,
    confluenceSignal: 'Neutral',
    confluenceStrength: 'Rendah',
    keySignals: [{ name: 'Menunggu data', bullish: true, active: true, weight: 0 }],
    technicalSummary: 'Data real-time sedang dimuat...',
    maStatus: { ma50: 'N/A', ma200: 'N/A', position: 'Tidak tersedia' }
  };
}

async function analyze(symbol) {
  const display = symbol.replace('USDT', '');
  let price = 0, change = 0, rsi = 50, ma50 = 'N/A', ma200 = 'N/A', pos = 'N/A';

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

  // RSI & MA dari Binance
  try {
    const k = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1h&limit=200`);
    if (k.ok) {
      const data = await k.json();
      const closes = data.map(c => parseFloat(c[4])).filter(v => !isNaN(v) && v > 0);
      if (closes.length >= 14) rsi = calcRSI(closes, 14);
      if (closes.length >= 50) {
        ma50 = (closes.slice(-50).reduce((a,b)=>a+b,0)/50).toFixed(2);
        if (closes.length >= 200) {
          ma200 = (closes.slice(-200).reduce((a,b)=>a+b,0)/200).toFixed(2);
          pos = price > parseFloat(ma200) ? 'Above 200MA (Bull)' : 'Below 200MA (Bear)';
        }
      }
    }
  } catch (e) {}

  if (!price) { price = symbol === 'BTCUSDT' ? 78000 : 2400; change = 0; }

  let score = 50;
  const signals = [];
  if (rsi < 30) { score += 20; signals.push({ name: 'RSI Oversold (1H)', bullish: true, active: true, weight: 20 }); }
  else if (rsi > 70) { score -= 20; signals.push({ name: 'RSI Overbought (1H)', bullish: false, active: true, weight: 20 }); }
  if (change > 5) { score += 15; signals.push({ name: 'Momentum 24h +', bullish: true, active: true, weight: 15 }); }
  else if (change < -5) { score -= 15; signals.push({ name: 'Momentum 24h -', bullish: false, active: true, weight: 15 }); }
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
    technicalSummary: `RSI 1H: ${rsi.toFixed(1)} | 24h: ${change.toFixed(1)}%`,
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
  if (btc.probabilityScore > 60 && eth.probabilityScore > 60) return '💰 BTC & ETH bullish kuat.';
  if (btc.probabilityScore > 60) return '📈 Bitcoin unggul.';
  if (eth.probabilityScore > 60) return '💎 Ethereum unggul.';
  return '📊 Pasar netral.';
}
