// api/analytics.js - AC369 FUSION Stable
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'max-age=0, s-maxage=60');

  try {
    const [btc, eth] = await Promise.allSettled([
      analyzeAsset('BTCUSDT'),
      analyzeAsset('ETHUSDT')
    ]);

    const btcData = getValue(btc, getFallbackAsset('BTC'));
    const ethData = getValue(eth, getFallbackAsset('ETH'));

    res.status(200).json({
      timestamp: new Date().toISOString(),
      btc: btcData,
      eth: ethData,
      smartMoneyNarrative: generateNarrative(btcData, ethData)
    });
  } catch (error) {
    res.status(500).json({
      btc: getFallbackAsset('BTC'),
      eth: getFallbackAsset('ETH'),
      smartMoneyNarrative: 'Data sementara tidak tersedia.'
    });
  }
}

function getValue(promise, fallback) {
  return promise.status === 'fulfilled' ? promise.value : fallback;
}

function getFallbackAsset(symbol) {
  return {
    symbol: symbol,
    currentPrice: symbol === 'BTC' ? '78000' : '2400',
    probabilityScore: 50,
    confluenceSignal: 'Neutral',
    confluenceStrength: 'Rendah',
    keySignals: [{ name: 'Menunggu data', bullish: true, active: true, weight: 0 }],
    technicalSummary: 'Data real-time sedang dimuat ulang...',
    maStatus: { ma50: 'N/A', ma200: 'N/A', position: 'Tidak tersedia' }
  };
}

async function analyzeAsset(symbol) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 7000);

  try {
    const [klines1h, klines1d, ticker] = await Promise.all([
      fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1h&limit=100`, { signal: controller.signal }).then(r => r.json()),
      fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1d&limit=200`, { signal: controller.signal }).then(r => r.json()),
      fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`, { signal: controller.signal }).then(r => r.json())
    ]);
    clearTimeout(timeoutId);

    const closes1h = klines1h.map(k => parseFloat(k[4]));
    const closes1d = klines1d.map(k => parseFloat(k[4]));
    const currentPrice = parseFloat(ticker.lastPrice);
    const change24h = parseFloat(ticker.priceChangePercent);

    const rsi = calculateRSI(closes1h, 14);
    const ma50 = closes1d.slice(-50).reduce((a, b) => a + b, 0) / 50;
    const ma200 = closes1d.slice(-200).reduce((a, b) => a + b, 0) / 200;

    let score = 50;
    const signals = [];
    if (rsi < 35) { score += 15; signals.push({ name: 'RSI Oversold (1H)', bullish: true, active: true, weight: 15 }); }
    else if (rsi > 65) { score -= 15; signals.push({ name: 'RSI Overbought (1H)', bullish: false, active: true, weight: 15 }); }
    if (currentPrice > ma200) { score += 10; signals.push({ name: 'Di atas 200MA', bullish: true, active: true, weight: 10 }); }
    else { score -= 10; signals.push({ name: 'Di bawah 200MA', bullish: false, active: true, weight: 10 }); }
    if (change24h > 5) { score += 10; signals.push({ name: 'Momentum 24h positif', bullish: true, active: true, weight: 10 }); }
    else if (change24h < -5) { score -= 10; signals.push({ name: 'Momentum 24h negatif', bullish: false, active: true, weight: 10 }); }

    score = Math.max(0, Math.min(100, score));
    let signal = 'Neutral', strength = 'Rendah';
    if (score >= 65) { signal = 'Buy'; strength = 'Sedang'; }
    else if (score >= 75) { signal = 'Strong Buy'; strength = 'Tinggi'; }
    else if (score <= 35) { signal = 'Sell'; strength = 'Sedang'; }
    else if (score <= 25) { signal = 'Strong Sell'; strength = 'Tinggi'; }

    return {
      symbol: symbol.replace('USDT', ''),
      currentPrice: currentPrice.toFixed(2),
      probabilityScore: Math.round(score),
      confluenceSignal: signal,
      confluenceStrength: strength,
      keySignals: signals,
      technicalSummary: `RSI 1H: ${rsi.toFixed(1)} | Harga ${currentPrice > ma200 ? 'di atas' : 'di bawah'} 200MA`,
      maStatus: { ma50: ma50.toFixed(2), ma200: ma200.toFixed(2), position: currentPrice > ma200 ? 'Above 200MA' : 'Below 200MA' }
    };
  } catch (e) {
    clearTimeout(timeoutId);
    throw e;
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

function generateNarrative(btc, eth) {
  if (btc.confluenceSignal.includes('Buy') && eth.confluenceSignal.includes('Buy')) return '💰 BTC & ETH menunjukkan sinyal beli. Konfluensi positif.';
  if (btc.confluenceSignal.includes('Buy')) return '📈 Bitcoin memimpin dengan sinyal beli.';
  if (eth.confluenceSignal.includes('Buy')) return '💎 Ethereum menunjukkan kekuatan relatif.';
  return '📊 Pasar dalam fase konsolidasi.';
}
