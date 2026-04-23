// api/analytics.js - AC369 FUSION v6 (Zero NaN)
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'max-age=0, s-maxage=60');

  try {
    const btc = await analyzeAsset('BTCUSDT');
    const eth = await analyzeAsset('ETHUSDT');

    res.status(200).json({
      timestamp: new Date().toISOString(),
      btc,
      eth,
      smartMoneyNarrative: generateNarrative(btc, eth)
    });
  } catch (error) {
    console.error('Analytics error:', error);
    res.status(500).json({ error: 'Gagal mengambil data analitik.' });
  }
}

async function analyzeAsset(symbol) {
  let currentPrice = 0;
  let change24h = 0;
  let rsi = 50;

  try {
    // 1. Ambil ticker 24h
    const tickerRes = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`);
    const ticker = await tickerRes.json();
    
    // Parsing defensif
    currentPrice = parseFloat(ticker.lastPrice) || parseFloat(ticker.weightedAvgPrice) || 0;
    change24h = parseFloat(ticker.priceChangePercent) || 0;

    // 2. Ambil klines untuk RSI
    const klinesRes = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1h&limit=100`);
    const klines = await klinesRes.json();
    
    if (Array.isArray(klines) && klines.length > 14) {
      const closes = klines.map(k => {
        const close = parseFloat(k[4]);
        return isNaN(close) ? 0 : close;
      }).filter(v => v > 0);
      
      if (closes.length >= 14) {
        rsi = calculateRSI(closes, 14);
        if (isNaN(rsi)) rsi = 50;
      }
    }
  } catch (e) {
    console.error(`Error fetching ${symbol}:`, e.message);
  }

  // Jika harga masih 0, berarti gagal total
  if (currentPrice === 0) {
    throw new Error(`Tidak bisa mendapatkan harga untuk ${symbol}`);
  }

  // 3. Hitung skor
  let score = 50;
  const signals = [];

  if (rsi < 30) {
    score += 20;
    signals.push({ name: 'RSI Oversold', bullish: true, active: true, weight: 20 });
  } else if (rsi > 70) {
    score -= 20;
    signals.push({ name: 'RSI Overbought', bullish: false, active: true, weight: 20 });
  }

  if (change24h > 5) {
    score += 15;
    signals.push({ name: 'Momentum 24h positif', bullish: true, active: true, weight: 15 });
  } else if (change24h < -5) {
    score -= 15;
    signals.push({ name: 'Momentum 24h negatif', bullish: false, active: true, weight: 15 });
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  let signal = 'Neutral';
  let strength = 'Rendah';
  if (score >= 70) { signal = 'Strong Buy'; strength = 'Tinggi'; }
  else if (score >= 60) { signal = 'Buy'; strength = 'Sedang'; }
  else if (score <= 30) { signal = 'Strong Sell'; strength = 'Tinggi'; }
  else if (score <= 40) { signal = 'Sell'; strength = 'Sedang'; }

  return {
    symbol: symbol.replace('USDT', ''),
    currentPrice: currentPrice.toFixed(2),
    probabilityScore: score,
    confluenceSignal: signal,
    confluenceStrength: strength,
    keySignals: signals,
    technicalSummary: `RSI 1H: ${rsi.toFixed(1)} | 24h: ${change24h.toFixed(1)}%`,
    maStatus: { ma50: 'N/A', ma200: 'N/A', position: 'Limited data' }
  };
}

function calculateRSI(prices, period = 14) {
  if (!prices || prices.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = prices.length - period; i < prices.length; i++) {
    const diff = prices[i] - prices[i - 1];
    if (isNaN(diff)) continue;
    if (diff > 0) gains += diff;
    else losses -= diff;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  const rsi = 100 - (100 / (1 + rs));
  return isNaN(rsi) ? 50 : rsi;
}

function generateNarrative(btc, eth) {
  if (btc.probabilityScore > 60 && eth.probabilityScore > 60) return '💰 BTC & ETH momentum positif.';
  if (btc.probabilityScore > 60) return '📈 Bitcoin unggul.';
  if (eth.probabilityScore > 60) return '💎 Ethereum unggul.';
  return '📊 Pasar netral.';
}
