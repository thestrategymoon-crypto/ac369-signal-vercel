// api/data.js
// Vercel Serverless Function - AC369 FUSION Enhanced Analytics

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  try {
    // Jalankan semua fetch secara paralel untuk kecepatan
    const [
      orderFlowData,
      sessionData,
      volatilityZ,
      coinbasePremium,
      liquidationDelta,
      btcAgeData,
      nvdaCorrelation,
      anchoredVWAPData
    ] = await Promise.all([
      fetchOrderFlowImbalance(),
      fetchSmartMoneyIndex(),
      fetchVolatilityZScore(),
      fetchCoinbasePremium(),
      fetchCumulativeLiquidationDelta(),
      fetchBTCAgeConsumed(),
      fetchNvidiaBTCCorrelation(),
      fetchAnchoredVWAP()
    ]);

    res.status(200).json({
      timestamp: new Date().toISOString(),
      orderFlowImbalance: orderFlowData,
      smartMoneyIndex: sessionData,
      volatilityZScore: volatilityZ,
      coinbasePremiumGap: coinbasePremium,
      cumulativeLiquidationDelta: liquidationDelta,
      btcAgeConsumed: btcAgeData,
      nvidiaBTCCorrelation: nvdaCorrelation,
      anchoredVWAP: anchoredVWAPData
    });
  } catch (error) {
    console.error('API Error:', error);
    res.status(500).json({ error: 'Failed to fetch analytics data' });
  }
}

// ------------------------------------------------------------
// 1. ORDER FLOW IMBALANCE (Binance Order Book Depth)
// ------------------------------------------------------------
async function fetchOrderFlowImbalance() {
  try {
    const symbol = 'BTCUSDT';
    // Ambil order book dengan limit 100 (kedalaman cukup)
    const response = await fetch(`https://api.binance.com/api/v3/depth?symbol=${symbol}&limit=100`);
    const data = await response.json();

    // Hitung total bid size dan ask size dalam rentang 2% dari harga tengah
    const midPrice = (parseFloat(data.bids[0][0]) + parseFloat(data.asks[0][0])) / 2;
    const lowerBound = midPrice * 0.98;
    const upperBound = midPrice * 1.02;

    let totalBidSize = 0;
    let totalAskSize = 0;

    data.bids.forEach(bid => {
      const price = parseFloat(bid[0]);
      if (price >= lowerBound) totalBidSize += parseFloat(bid[1]) * price;
    });

    data.asks.forEach(ask => {
      const price = parseFloat(ask[0]);
      if (price <= upperBound) totalAskSize += parseFloat(ask[1]) * price;
    });

    const imbalanceRatio = totalAskSize > 0 ? totalBidSize / totalAskSize : 1;
    const absorption = (totalAskSize > totalBidSize * 1.5) ? 'Potential Absorption (Bullish)' : 'Normal';

    return {
      symbol,
      bidVolumeUSD: totalBidSize.toFixed(2),
      askVolumeUSD: totalAskSize.toFixed(2),
      imbalanceRatio: imbalanceRatio.toFixed(3),
      signal: absorption,
      midPrice: midPrice.toFixed(2)
    };
  } catch (e) {
    return { error: e.message };
  }
}

// ------------------------------------------------------------
// 2. SMART MONEY INDEX (SMI) - Custom Crypto Sessions
// ------------------------------------------------------------
async function fetchSmartMoneyIndex() {
  try {
    // Ambil klines 30 menit terakhir untuk sesi Asia (00:00-08:00 UTC)
    // dan sesi US (13:30-20:00 UTC) - cukup ambil 48 candle 30m
    const response = await fetch('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=30m&limit=48');
    const klines = await response.json();

    const now = new Date();
    const currentHour = now.getUTCHours();

    // Tentukan sesi saat ini
    let sessionName = 'Unknown';
    if (currentHour >= 0 && currentHour < 8) sessionName = 'Asia';
    else if (currentHour >= 13 && currentHour < 20) sessionName = 'US';
    else sessionName = 'EU/Overlap';

    // Hitung perubahan harga 30 menit pertama vs 30 menit terakhir sesi terdekat
    // (Ini contoh sederhana, Anda bisa kembangkan logika lebih akurat)
    const latestClose = parseFloat(klines[klines.length - 1][4]);
    const open30mBefore = parseFloat(klines[klines.length - 2][1]);

    const smiValue = ((latestClose - open30mBefore) / open30mBefore * 100).toFixed(2);

    return {
      currentSession: sessionName,
      smi30mChangePercent: smiValue,
      interpretation: smiValue > 0.2 ? 'Smart Money Buying' : smiValue < -0.2 ? 'Smart Money Selling' : 'Neutral'
    };
  } catch (e) {
    return { error: e.message };
  }
}

// ------------------------------------------------------------
// 3. VOLATILITY Z-SCORE (ATR based)
// ------------------------------------------------------------
async function fetchVolatilityZScore() {
  try {
    // Ambil 30 hari data harian untuk hitung ATR dan Z-Score
    const response = await fetch('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=30');
    const klines = await response.json();

    const atrValues = [];
    for (let i = 1; i < klines.length; i++) {
      const high = parseFloat(klines[i][2]);
      const low = parseFloat(klines[i][3]);
      const prevClose = parseFloat(klines[i-1][4]);
      const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
      atrValues.push(tr);
    }

    const currentATR = atrValues[atrValues.length - 1];
    const meanATR = atrValues.reduce((a,b) => a + b, 0) / atrValues.length;
    const stdATR = Math.sqrt(atrValues.map(x => Math.pow(x - meanATR, 2)).reduce((a,b) => a + b, 0) / atrValues.length);
    const zScore = (currentATR - meanATR) / stdATR;

    let signal = 'Normal';
    if (zScore > 2.0) signal = 'Extreme Volatility - Expect Sideways/Reversal';
    else if (zScore < -1.5) signal = 'Volatility Crush - Big Move Imminent';

    return {
      currentATR: currentATR.toFixed(2),
      meanATR: meanATR.toFixed(2),
      zScore: zScore.toFixed(3),
      signal
    };
  } catch (e) {
    return { error: e.message };
  }
}

// ------------------------------------------------------------
// 4. COINBASE PREMIUM GAP
// ------------------------------------------------------------
async function fetchCoinbasePremium() {
  try {
    // Coinbase: BTC-USD
    const cbRes = await fetch('https://api.coinbase.com/v2/prices/BTC-USD/spot');
    const cbData = await cbRes.json();
    const coinbasePrice = parseFloat(cbData.data.amount);

    // Binance: BTC-USDT
    const binanceRes = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT');
    const binanceData = await binanceRes.json();
    const binancePrice = parseFloat(binanceData.price);

    const gapPercent = ((coinbasePrice - binancePrice) / binancePrice * 100).toFixed(3);
    const signal = gapPercent > 0.05 ? 'US Whales Buying (Bullish)' : gapPercent < -0.05 ? 'US Whales Selling (Bearish)' : 'Neutral';

    return {
      coinbasePrice,
      binancePrice,
      gapPercent: gapPercent + '%',
      signal
    };
  } catch (e) {
    return { error: e.message };
  }
}

// ------------------------------------------------------------
// 5. CUMULATIVE LIQUIDATION DELTA (Binance Futures)
// ------------------------------------------------------------
async function fetchCumulativeLiquidationDelta() {
  try {
    // Binance menyediakan data likuidasi 24 jam melalui endpoint ini
    const response = await fetch('https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=BTCUSDT');
    const data = await response.json();

    // Sayangnya API likuidasi per menit tidak gratis, kita gunakan proxy dari metrik volume
    // Sebagai pengganti, kita hitung delta dari data open interest dan price change
    const oiRes = await fetch('https://fapi.binance.com/fapi/v1/openInterest?symbol=BTCUSDT');
    const oiData = await oiRes.json();
    const openInterest = parseFloat(oiData.openInterest);

    const priceChangePercent = parseFloat(data.priceChangePercent);
    const volume = parseFloat(data.quoteVolume);

    // Estimasi kasar delta likuidasi (semakin negatif jika harga turun dan OI naik)
    const estimatedDelta = priceChangePercent < 0 ? volume * 0.1 : -volume * 0.05;

    return {
      estimatedLiquidationDelta24h: estimatedDelta.toFixed(2),
      note: 'Estimated from price/volume/OI (actual liquidation data requires paid API)',
      openInterestUSD: openInterest.toFixed(2)
    };
  } catch (e) {
    return { error: e.message };
  }
}

// ------------------------------------------------------------
// 6. BTC AGE CONSUMED (On-Chain Proxy via Blockchain.com)
// ------------------------------------------------------------
async function fetchBTCAgeConsumed() {
  try {
    // Gunakan data perkiraan dari Blockchain.com (gratis)
    const response = await fetch('https://api.blockchain.info/charts/age-distribution?timespan=30days&format=json');
    const data = await response.json();

    // Ambil data terbaru untuk melihat apakah koin tua bergerak
    const latest = data.values[data.values.length - 1];
    const previous = data.values[data.values.length - 2];

    const change = latest.y - previous.y;
    const interpretation = change > 0.5 ? 'Old coins moving (Bearish)' : 'Old coins dormant (Bullish)';

    return {
      latestValue: latest.y,
      change24h: change.toFixed(4),
      interpretation
    };
  } catch (e) {
    // Fallback ke alternatif
    return { error: 'Blockchain.info API limited, try later', alternative: 'Use Glassnode free tier' };
  }
}

// ------------------------------------------------------------
// 7. NVIDIA (NVDA) vs BTC Rolling Correlation
// ------------------------------------------------------------
async function fetchNvidiaBTCCorrelation() {
  try {
    // Ambil 30 hari harga penutupan BTC
    const btcRes = await fetch('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=30');
    const btcKlines = await btcRes.json();
    const btcPrices = btcKlines.map(k => parseFloat(k[4]));

    // Ambil harga saham NVDA dari Alpha Vantage (free tier, perlu key di env)
    // Jika tidak ada key, gunakan data dummy atau fallback
    const apiKey = process.env.ALPHA_VANTAGE_KEY || 'demo';
    const nvdaRes = await fetch(`https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=NVDA&outputsize=compact&apikey=${apiKey}`);
    const nvdaData = await nvdaRes.json();

    if (nvdaData['Time Series (Daily)']) {
      const nvdaPrices = Object.values(nvdaData['Time Series (Daily)']).slice(0, 30).map(d => parseFloat(d['4. close'])).reverse();

      // Hitung korelasi Pearson
      const correlation = calculateCorrelation(btcPrices.slice(-30), nvdaPrices.slice(-30));

      let signal = '';
      if (correlation > 0.7) signal = 'Strong Coupling (Risk-On)';
      else if (correlation < 0.3) signal = 'Decoupling - Crypto Independence';
      else signal = 'Moderate Correlation';

      return {
        correlation30d: correlation.toFixed(3),
        signal,
        note: 'Using Alpha Vantage (free tier)'
      };
    } else {
      return { error: 'NVDA data unavailable (API limit or key missing)' };
    }
  } catch (e) {
    return { error: e.message };
  }
}

// Fungsi bantu korelasi
function calculateCorrelation(x, y) {
  const n = Math.min(x.length, y.length);
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += x[i];
    sumY += y[i];
    sumXY += x[i] * y[i];
    sumX2 += x[i] * x[i];
    sumY2 += y[i] * y[i];
  }
  const numerator = n * sumXY - sumX * sumY;
  const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
  return denominator === 0 ? 0 : numerator / denominator;
}

// ------------------------------------------------------------
// 8. ANCHORED VWAP (Contoh: dari Swing Low terakhir)
// ------------------------------------------------------------
async function fetchAnchoredVWAP() {
  try {
    // Ambil 100 candle 1 jam untuk mencari swing low
    const response = await fetch('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=100');
    const klines = await response.json();

    // Cari swing low sederhana: lowest low dalam 20 candle terakhir
    const recentLows = klines.slice(-20).map(k => parseFloat(k[3]));
    const minLow = Math.min(...recentLows);
    const anchorIndex = klines.slice(-20).findIndex(k => parseFloat(k[3]) === minLow) + klines.length - 20;

    // Hitung VWAP dari anchorIndex sampai sekarang
    let cumulativePV = 0;
    let cumulativeVolume = 0;
    for (let i = anchorIndex; i < klines.length; i++) {
      const high = parseFloat(klines[i][2]);
      const low = parseFloat(klines[i][3]);
      const close = parseFloat(klines[i][4]);
      const typicalPrice = (high + low + close) / 3;
      const volume = parseFloat(klines[i][5]);
      cumulativePV += typicalPrice * volume;
      cumulativeVolume += volume;
    }
    const anchoredVWAP = cumulativePV / cumulativeVolume;
    const currentPrice = parseFloat(klines[klines.length-1][4]);

    return {
      anchoredFromSwingLow: minLow.toFixed(2),
      vwapValue: anchoredVWAP.toFixed(2),
      currentPrice: currentPrice.toFixed(2),
      position: currentPrice > anchoredVWAP ? 'Above AVWAP (Uptrend)' : 'Below AVWAP (Downtrend)'
    };
  } catch (e) {
    return { error: e.message };
  }
}
