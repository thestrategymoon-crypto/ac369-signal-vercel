// api/analytics.js - AC369 FUSION Probability Engine (Optimized)
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'max-age=0, s-maxage=30');

  try {
    const [btc, eth] = await Promise.allSettled([
      analyzeAsset('BTCUSDT'),
      analyzeAsset('ETHUSDT')
    ]);

    const result = {
      timestamp: new Date().toISOString(),
      btc: getValue(btc, { error: 'Timeout', currentPrice: '0', probabilityScore: 0, confluenceSignal: 'N/A' }),
      eth: getValue(eth, { error: 'Timeout', currentPrice: '0', probabilityScore: 0, confluenceSignal: 'N/A' }),
      smartMoneyNarrative: generateNarrative(getValue(btc, {}), getValue(eth, {}))
    };

    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

function getValue(promise, fallback) {
  return promise.status === 'fulfilled' ? promise.value : fallback;
}

// Fetch dengan timeout
async function fetchWithTimeout(url, timeout = 6000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(id);
    return await response.json();
  } catch (e) {
    clearTimeout(id);
    throw e;
  }
}

async function analyzeAsset(symbol) {
  try {
    // Ambil data 1h, 4h, 1d dengan timeout
    const [klines1h, klines4h, klines1d] = await Promise.all([
      fetchWithTimeout(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1h&limit=100`, 5000),
      fetchWithTimeout(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=4h&limit=100`, 5000),
      fetchWithTimeout(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1d&limit=200`, 5000)
    ]);

    const close1h = klines1h.map(k => parseFloat(k[4]));
    const close4h = klines4h.map(k => parseFloat(k[4]));
    const close1d = klines1d.map(k => parseFloat(k[4]));
    const volume1h = klines1h.map(k => parseFloat(k[5]));

    const currentPrice = close1d[close1d.length - 1];

    // Hitung indikator
    const rsi1h = calculateRSI(close1h, 14);
    const rsi4h = calculateRSI(close4h, 14);
    const volumeSpike = detectVolumeSpike(volume1h);
    
    const ma50 = close1d.slice(-50).reduce((a, b) => a + b, 0) / 50;
    const ma200 = close1d.slice(-200).reduce((a, b) => a + b, 0) / 200;

    // Hitung probabilitas sederhana
    const probability = calculateSimpleProbability({ rsi1h, rsi4h, volumeSpike, currentPrice, ma50, ma200 });

    return {
      symbol: symbol.replace('USDT', ''),
      currentPrice: currentPrice.toFixed(2),
      probabilityScore: probability.score,
      confluenceSignal: probability.signal,
      confluenceStrength: probability.strength,
      keySignals: probability.signals,
      technicalSummary: probability.summary,
      maStatus: {
        ma50: ma50.toFixed(2),
        ma200: ma200.toFixed(2),
        position: currentPrice > ma200 ? 'Above 200MA (Bull Market)' : 'Below 200MA (Bear Market)'
      }
    };
  } catch (e) {
    // Fallback: data dummy agar dashboard tetap muncul
    return {
      symbol: symbol.replace('USDT', ''),
      currentPrice: '85000',
      probabilityScore: 55,
      confluenceSignal: 'Neutral',
      confluenceStrength: 'Rendah',
      keySignals: [{ name: 'Data tertunda', bullish: true, active: true, weight: 0 }],
      technicalSummary: 'Menunggu data real-time...',
      maStatus: { ma50: 'N/A', ma200: 'N/A', position: 'Data tidak tersedia' }
    };
  }
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

function detectVolumeSpike(volumes) {
  const recent = volumes.slice(-5);
  const avg = recent.reduce((a, b) => a + b, 0) / recent.length;
  const last = volumes[volumes.length - 1];
  const ratio = last / avg;
  return {
    ratio: ratio.toFixed(2),
    isSpike: ratio > 2.0
  };
}

function calculateSimpleProbability(ind) {
  let score = 50;
  const signals = [];
  let bullishCount = 0;

  if (ind.rsi1h < 35) { score += 15; signals.push({ name: 'RSI 1H Oversold', bullish: true, active: true, weight: 15 }); bullishCount++; }
  else if (ind.rsi1h > 65) { score -= 15; signals.push({ name: 'RSI 1H Overbought', bullish: false, active: true, weight: 15 }); }

  if (ind.rsi4h < 35) { score += 10; signals.push({ name: 'RSI 4H Oversold', bullish: true, active: true, weight: 10 }); bullishCount++; }
  else if (ind.rsi4h > 65) { score -= 10; signals.push({ name: 'RSI 4H Overbought', bullish: false, active: true, weight: 10 }); }

  if (ind.volumeSpike.isSpike) {
    if (ind.currentPrice > ind.ma50) { score += 15; signals.push({ name: 'Volume Spike Bullish', bullish: true, active: true, weight: 15 }); bullishCount++; }
    else { score -= 15; signals.push({ name: 'Volume Spike Bearish', bullish: false, active: true, weight: 15 }); }
  }

  if (ind.currentPrice > ind.ma200) { score += 10; signals.push({ name: 'Above 200MA', bullish: true, active: true, weight: 10 }); bullishCount++; }
  else { score -= 10; signals.push({ name: 'Below 200MA', bullish: false, active: true, weight: 10 }); }

  score = Math.max(0, Math.min(100, score));

  let signal = 'Neutral';
  let strength = 'Rendah';
  if (score >= 65) { signal = 'Buy'; strength = bullishCount >= 3 ? 'Tinggi' : 'Sedang'; }
  else if (score <= 35) { signal = 'Sell'; strength = 'Sedang'; }

  return {
    score: Math.round(score),
    signal,
    strength,
    signals: signals.slice(0, 5),
    summary: bullishCount >= 3 ? 'Mayoritas sinyal bullish' : bullishCount >= 1 ? 'Beberapa sinyal bullish' : 'Sinyal bearish dominan'
  };
}

function generateNarrative(btc, eth) {
  if (!btc || !eth) return 'Menunggu data...';
  if (btc.confluenceSignal === 'Buy' && eth.confluenceSignal === 'Buy') return '💰 Smart Money akumulasi BTC & ETH. Konfluensi sinyal beli.';
  if (btc.confluenceSignal === 'Buy') return '🐋 Fokus pada Bitcoin. ETH masih konsolidasi.';
  if (eth.confluenceSignal === 'Buy') return '💎 Ethereum mulai menarik minat.';
  return '📊 Pasar mixed, tunggu konfirmasi.';
}
