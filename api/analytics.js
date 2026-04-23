// api/analytics.js - AC369 FUSION Probability Engine
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
      btc: getValue(btc, { error: 'Timeout' }),
      eth: getValue(eth, { error: 'Timeout' }),
      smartMoneyNarrative: generateNarrative(getValue(btc), getValue(eth))
    };

    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

function getValue(promise, fallback) {
  return promise.status === 'fulfilled' ? promise.value : fallback;
}

// Fungsi utama analisis per aset
async function analyzeAsset(symbol) {
  const [klines1h, klines4h, klines1d] = await Promise.all([
    fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1h&limit=100`).then(r => r.json()),
    fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=4h&limit=100`).then(r => r.json()),
    fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1d&limit=200`).then(r => r.json())
  ]);

  const close1h = klines1h.map(k => parseFloat(k[4]));
  const close4h = klines4h.map(k => parseFloat(k[4]));
  const close1d = klines1d.map(k => parseFloat(k[4]));
  const volume1h = klines1h.map(k => parseFloat(k[5]));

  // Hitung indikator
  const rsi1h = calculateRSI(close1h, 14);
  const rsi4h = calculateRSI(close4h, 14);
  const macd1h = calculateMACD(close1h);
  const macd4h = calculateMACD(close4h);
  const volumeSpike = detectVolumeSpike(volume1h);
  
  const ma50 = close1d.slice(-50).reduce((a, b) => a + b, 0) / 50;
  const ma200 = close1d.slice(-200).reduce((a, b) => a + b, 0) / 200;
  const currentPrice = close1d[close1d.length - 1];

  const ema12 = calculateEMA(close1d, 12);
  const ema26 = calculateEMA(close1d, 26);
  const ema50 = calculateEMA(close1d, 50);

  // Hitung probabilitas
  const probability = calculateProbability({
    rsi1h, rsi4h,
    macd1h, macd4h,
    volumeSpike,
    priceVsMA: {
      above50: currentPrice > ma50,
      above200: currentPrice > ma200,
      goldenCross: ema12 > ema26 && ema26 > ema50
    }
  });

  // Deteksi konfluensi
  const confluence = detectConfluence(probability.signals);

  return {
    symbol: symbol.replace('USDT', ''),
    currentPrice: currentPrice.toFixed(2),
    probabilityScore: probability.score,
    confluenceSignal: confluence.signal,
    confluenceStrength: confluence.strength,
    keySignals: probability.signals.filter(s => s.active).slice(0, 5),
    technicalSummary: generateTechnicalSummary(probability),
    maStatus: {
      ma50: ma50.toFixed(2),
      ma200: ma200.toFixed(2),
      position: currentPrice > ma200 ? 'Above 200MA (Bull Market)' : 'Below 200MA (Bear Market)'
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

function calculateEMA(prices, period) {
  const k = 2 / (period + 1);
  let ema = prices[0];
  for (let i = 1; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }
  return ema;
}

function calculateMACD(prices) {
  const ema12 = calculateEMA(prices, 12);
  const ema26 = calculateEMA(prices, 26);
  const macdLine = ema12 - ema26;
  // Hitung signal line (EMA 9 dari macdLine) - sederhanakan dengan data yang ada
  const signalLine = macdLine * 0.9; // aproksimasi
  return { macdLine, signalLine, histogram: macdLine - signalLine };
}

function detectVolumeSpike(volumes) {
  const recent = volumes.slice(-5);
  const avg = recent.reduce((a, b) => a + b, 0) / recent.length;
  const last = volumes[volumes.length - 1];
  const ratio = last / avg;
  return {
    ratio: ratio.toFixed(2),
    isSpike: ratio > 2.0,
    interpretation: ratio > 3 ? 'Volume meledak (Whale aktif)' : ratio > 2 ? 'Volume meningkat' : 'Normal'
  };
}

function calculateProbability(ind) {
  let score = 0;
  const signals = [];

  // RSI 1H (bobot 10)
  if (ind.rsi1h < 30) { score += 10; signals.push({ name: 'RSI 1H Oversold', bullish: true, active: true, weight: 10 }); }
  else if (ind.rsi1h > 70) { score -= 10; signals.push({ name: 'RSI 1H Overbought', bullish: false, active: true, weight: 10 }); }

  // RSI 4H (bobot 15)
  if (ind.rsi4h < 35) { score += 15; signals.push({ name: 'RSI 4H Oversold', bullish: true, active: true, weight: 15 }); }
  else if (ind.rsi4h > 65) { score -= 15; signals.push({ name: 'RSI 4H Overbought', bullish: false, active: true, weight: 15 }); }

  // MACD 1H (bobot 10)
  if (ind.macd1h.histogram > 0) { score += 10; signals.push({ name: 'MACD 1H Bullish', bullish: true, active: true, weight: 10 }); }
  else { score -= 10; signals.push({ name: 'MACD 1H Bearish', bullish: false, active: true, weight: 10 }); }

  // MACD 4H (bobot 15)
  if (ind.macd4h.histogram > 0) { score += 15; signals.push({ name: 'MACD 4H Bullish', bullish: true, active: true, weight: 15 }); }
  else { score -= 15; signals.push({ name: 'MACD 4H Bearish', bullish: false, active: true, weight: 15 }); }

  // Volume Spike (bobot 20)
  if (ind.volumeSpike.isSpike) {
    if (ind.priceVsMA.above50) { score += 20; signals.push({ name: 'Volume Spike (Akumulasi)', bullish: true, active: true, weight: 20 }); }
    else { score -= 20; signals.push({ name: 'Volume Spike (Distribusi)', bullish: false, active: true, weight: 20 }); }
  }

  // MA Status (bobot 30)
  if (ind.priceVsMA.above200) { score += 15; signals.push({ name: 'Di atas 200MA', bullish: true, active: true, weight: 15 }); }
  else { score -= 15; signals.push({ name: 'Di bawah 200MA', bullish: false, active: true, weight: 15 }); }

  if (ind.priceVsMA.goldenCross) { score += 15; signals.push({ name: 'EMA Golden Cross', bullish: true, active: true, weight: 15 }); }

  const normalized = Math.max(-100, Math.min(100, score));
  return { score: Math.round((normalized + 100) / 2), signals };
}

function detectConfluence(signals) {
  const active = signals.filter(s => s.active);
  const bullish = active.filter(s => s.bullish).length;
  const bearish = active.filter(s => !s.bullish).length;
  const totalWeight = active.reduce((sum, s) => sum + s.weight, 0);

  let signal = 'Neutral', strength = 'Rendah';
  if (bullish >= 3 && totalWeight >= 40) { signal = 'Strong Buy'; strength = 'Tinggi'; }
  else if (bullish >= 2 && totalWeight >= 30) { signal = 'Buy'; strength = 'Sedang'; }
  else if (bearish >= 3 && totalWeight >= 40) { signal = 'Strong Sell'; strength = 'Tinggi'; }
  else if (bearish >= 2 && totalWeight >= 30) { signal = 'Sell'; strength = 'Sedang'; }

  return { signal, strength };
}

function generateTechnicalSummary(prob) {
  const active = prob.signals.filter(s => s.active);
  const bullishNames = active.filter(s => s.bullish).map(s => s.name);
  const bearishNames = active.filter(s => !s.bullish).map(s => s.name);
  if (bullishNames.length > bearishNames.length) {
    return `Mayoritas sinyal bullish (${bullishNames.length} vs ${bearishNames.length}). ${bullishNames.slice(0,2).join(', ')}`;
  } else if (bearishNames.length > bullishNames.length) {
    return `Mayoritas sinyal bearish (${bearishNames.length} vs ${bullishNames.length}). ${bearishNames.slice(0,2).join(', ')}`;
  }
  return 'Sinyal berimbang, pasar konsolidasi.';
}

function generateNarrative(btc, eth) {
  if (btc.error || eth.error) return 'Data tidak lengkap.';
  const btcBuy = btc.confluenceSignal.includes('Buy');
  const ethBuy = eth.confluenceSignal.includes('Buy');
  if (btcBuy && ethBuy) return '💰 Smart Money sedang akumulasi BTC dan ETH. Konfluensi sinyal beli kuat, potensi rally dalam waktu dekat.';
  if (btcBuy && !ethBuy) return '🐋 Fokus Smart Money pada Bitcoin. ETH masih konsolidasi.';
  if (!btcBuy && ethBuy) return '💎 Ethereum mulai menarik minat institusi meski BTC sideways. Sinyal awal Altcoin Season.';
  if (btc.confluenceSignal.includes('Sell') && eth.confluenceSignal.includes('Sell')) return '⚠️ Tekanan jual terdeteksi di BTC dan ETH. Waspada koreksi.';
  return '📊 Pasar mixed, tidak ada konfluensi jelas. Wait and see.';
}
