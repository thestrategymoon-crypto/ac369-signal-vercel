// api/analytics.js - AC369 FUSION (RSI Real-time)
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'max-age=0, s-maxage=60');

  try {
    const [btc, eth] = await Promise.allSettled([analyzeAsset('BTCUSDT'), analyzeAsset('ETHUSDT')]);
    const btcData = btc.status === 'fulfilled' ? btc.value : createFallback('BTC');
    const ethData = eth.status === 'fulfilled' ? eth.value : createFallback('ETH');

    res.status(200).json({
      timestamp: new Date().toISOString(),
      btc: btcData,
      eth: ethData,
      smartMoneyNarrative: generateNarrative(btcData, ethData)
    });
  } catch (error) {
    res.status(200).json({
      btc: createFallback('BTC'),
      eth: createFallback('ETH'),
      smartMoneyNarrative: 'Gangguan data.'
    });
  }
}

function createFallback(symbol) {
  return {
    symbol,
    currentPrice: symbol === 'BTC' ? '78000.00' : '2400.00',
    probabilityScore: 50,
    confluenceSignal: 'Neutral',
    confluenceStrength: 'Rendah',
    keySignals: [{ name: 'Data offline', bullish: true, active: true, weight: 0 }],
    technicalSummary: 'Menunggu data real-time...',
    maStatus: { ma50: 'N/A', ma200: 'N/A', position: 'Tidak tersedia' }
  };
}

async function analyzeAsset(symbol) {
  const display = symbol.replace('USDT', '');
  let currentPrice = 0, change24h = 0, rsi = 50, ma50 = 'N/A', ma200 = 'N/A', maPosition = 'N/A';

  // Harga dari CoinGecko
  try {
    const id = symbol === 'BTCUSDT' ? 'bitcoin' : 'ethereum';
    const cgRes = await fetch(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${id}&sparkline=false&price_change_percentage=24h`);
    if (cgRes.ok) {
      const data = await cgRes.json();
      if (data[0]) {
        currentPrice = data[0].current_price || 0;
        change24h = data[0].price_change_percentage_24h || 0;
      }
    }
  } catch (e) {}

  // RSI dari Binance
  try {
    const klinesRes = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1h&limit=100`);
    if (klinesRes.ok) {
      const klines = await klinesRes.json();
      const closes = klines.map(k => parseFloat(k[4])).filter(v => !isNaN(v) && v > 0);
      if (closes.length >= 14) rsi = calculateRSI(closes, 14);
      if (closes.length >= 50) ma50 = (closes.slice(-50).reduce((a,b)=>a+b,0)/50).toFixed(2);
      if (closes.length >= 200) {
        ma200 = (closes.slice(-200).reduce((a,b)=>a+b,0)/200).toFixed(2);
        maPosition = currentPrice > parseFloat(ma200) ? 'Above 200MA (Bull)' : 'Below 200MA (Bear)';
      }
    }
  } catch (e) {}

  if (!currentPrice) {
    currentPrice = symbol === 'BTCUSDT' ? 78000 : 2400;
    change24h = 0;
  }

  let score = 50;
  const signals = [];
  if (rsi < 30) { score += 20; signals.push({ name: 'RSI Oversold', bullish: true, active: true, weight: 20 }); }
  else if (rsi > 70) { score -= 20; signals.push({ name: 'RSI Overbought', bullish: false, active: true, weight: 20 }); }
  if (change24h > 5) { score += 15; signals.push({ name: 'Momentum 24h positif', bullish: true, active: true, weight: 15 }); }
  else if (change24h < -5) { score -= 15; signals.push({ name: 'Momentum 24h negatif', bullish: false, active: true, weight: 15 }); }
  if (maPosition.includes('Above')) { score += 10; signals.push({ name: 'Above 200MA', bullish: true, active: true, weight: 10 }); }
  else if (maPosition.includes('Below')) { score -= 10; signals.push({ name: 'Below 200MA', bullish: false, active: true, weight: 10 }); }

  score = Math.max(0, Math.min(100, Math.round(score)));
  let signal = 'Neutral', strength = 'Rendah';
  if (score >= 70) { signal = 'Strong Buy'; strength = 'Tinggi'; }
  else if (score >= 60) { signal = 'Buy'; strength = 'Sedang'; }
  else if (score <= 30) { signal = 'Strong Sell'; strength = 'Tinggi'; }
  else if (score <= 40) { signal = 'Sell'; strength = 'Sedang'; }

  return {
    symbol: display,
    currentPrice: currentPrice.toFixed(2),
    probabilityScore: score,
    confluenceSignal: signal,
    confluenceStrength: strength,
    keySignals: signals,
    technicalSummary: `RSI 1H: ${rsi.toFixed(1)} | 24h: ${change24h.toFixed(1)}%`,
    maStatus: { ma50, ma200, position: maPosition }
  };
}

function calculateRSI(prices, period = 14) {
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

function generateNarrative(btc, eth) {
  if (btc.probabilityScore > 60 && eth.probabilityScore > 60) return '💰 BTC & ETH sinyal beli kuat.';
  if (btc.probabilityScore > 60) return '📈 Bitcoin memimpin bullish.';
  if (eth.probabilityScore > 60) return '💎 Ethereum unggul.';
  return '📊 Pasar netral.';
}
