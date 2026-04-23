// api/analytics.js - AC369 FUSION v6 (Ultra Simple & Stable)
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
    console.error('Analytics critical error:', error);
    // Jangan kirim fallback data dummy, biarkan frontend menampilkan error.
    res.status(500).json({ error: 'Gagal mengambil data analitik.' });
  }
}

async function analyzeAsset(symbol) {
  // 1. Ambil harga terbaru
  const tickerRes = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`);
  const ticker = await tickerRes.json();
  const currentPrice = parseFloat(ticker.lastPrice);
  const change24h = parseFloat(ticker.priceChangePercent);

  // 2. Ambil data 1 jam untuk RSI sederhana
  let rsi = 50;
  try {
    const klinesRes = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1h&limit=100`);
    const klines = await klinesRes.json();
    const closes = klines.map(k => parseFloat(k[4]));
    rsi = calculateRSI(closes, 14);
  } catch (e) {
    console.warn(`Gagal hitung RSI untuk ${symbol}, gunakan default 50`);
  }

  // 3. Hitung skor probabilitas sederhana
  let score = 50;
  const signals = [];

  if (rsi < 30) {
    score += 20;
    signals.push({ name: 'RSI Oversold (1H)', bullish: true, active: true, weight: 20 });
  } else if (rsi > 70) {
    score -= 20;
    signals.push({ name: 'RSI Overbought (1H)', bullish: false, active: true, weight: 20 });
  }

  if (change24h > 5) {
    score += 15;
    signals.push({ name: 'Momentum 24h positif', bullish: true, active: true, weight: 15 });
  } else if (change24h < -5) {
    score -= 15;
    signals.push({ name: 'Momentum 24h negatif', bullish: false, active: true, weight: 15 });
  }

  // Normalisasi skor
  score = Math.max(0, Math.min(100, score));
  
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
    technicalSummary: `RSI 1H: ${rsi.toFixed(1)} | Perubahan 24h: ${change24h.toFixed(1)}%`,
    maStatus: {
      ma50: 'N/A',
      ma200: 'N/A',
      position: 'Data terbatas'
    }
  };
}

function calculateRSI(prices, period = 14) {
  if (prices.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = prices.length - period; i < prices.length; i++) {
    const diff = prices[i] - prices[i - 1];
    if (diff > 0) gains += diff;
    else losses -= diff;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  return 100 - (100 / (1 + avgGain / avgLoss));
}

function generateNarrative(btc, eth) {
  if (btc.probabilityScore > 60 && eth.probabilityScore > 60) return '💰 BTC & ETH dalam momentum positif.';
  if (btc.probabilityScore > 60) return '📈 Bitcoin menunjukkan kekuatan.';
  if (eth.probabilityScore > 60) return '💎 Ethereum unggul.';
  return '📊 Pasar dalam fase netral.';
}
