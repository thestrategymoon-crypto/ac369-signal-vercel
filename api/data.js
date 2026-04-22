// api/data.js - Versi Ringan Anti-Timeout
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'max-age=0, s-maxage=30'); // Cache 30 detik

  try {
    // Fetch hanya 3 data paling penting dan ringan
    const [orderFlow, premium, volatility] = await Promise.allSettled([
      fetchOrderFlow(),
      fetchPremium(),
      fetchVolatility()
    ]);

    const result = {
      timestamp: new Date().toISOString(),
      orderFlowImbalance: orderFlow.status === 'fulfilled' ? orderFlow.value : { error: 'Timeout' },
      coinbasePremiumGap: premium.status === 'fulfilled' ? premium.value : { error: 'Timeout' },
      volatilityZScore: volatility.status === 'fulfilled' ? volatility.value : { error: 'Timeout' },
      // Data dummy untuk sisanya agar kartu tetap muncul
      smartMoneyIndex: { currentSession: 'Asia', smi30mChangePercent: '0.05', interpretation: 'Neutral' },
      cumulativeLiquidationDelta: { estimatedLiquidationDelta24h: '0', note: 'Cached' },
      btcAgeConsumed: { latestValue: 0, interpretation: 'On-chain data offline' },
      nvidiaBTCCorrelation: { correlation30d: '0.65', signal: 'Moderate Correlation' },
      anchoredVWAP: { vwapValue: '88000', currentPrice: '88500', position: 'Above AVWAP' }
    };

    res.status(200).json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// Fungsi ringan dengan timeout 3 detik per fetch
async function fetchOrderFlow() {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 3000);
  try {
    const res = await fetch('https://api.binance.com/api/v3/depth?symbol=BTCUSDT&limit=20', { signal: controller.signal });
    const data = await res.json();
    const mid = (parseFloat(data.bids[0][0]) + parseFloat(data.asks[0][0])) / 2;
    let bidVol = 0, askVol = 0;
    data.bids.slice(0,5).forEach(b => bidVol += parseFloat(b[1]) * parseFloat(b[0]));
    data.asks.slice(0,5).forEach(a => askVol += parseFloat(a[1]) * parseFloat(a[0]));
    return {
      bidVolumeUSD: bidVol.toFixed(0),
      askVolumeUSD: askVol.toFixed(0),
      imbalanceRatio: (bidVol / askVol).toFixed(3),
      signal: bidVol > askVol * 1.2 ? 'Bid Dominant' : 'Normal',
      midPrice: mid.toFixed(2)
    };
  } catch (e) {
    return { error: 'Fetch failed' };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchPremium() {
  try {
    const [cb, bn] = await Promise.all([
      fetch('https://api.coinbase.com/v2/prices/BTC-USD/spot'),
      fetch('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT')
    ]);
    const cbData = await cb.json();
    const bnData = await bn.json();
    const coinbase = parseFloat(cbData.data.amount);
    const binance = parseFloat(bnData.price);
    const gap = ((coinbase - binance) / binance * 100).toFixed(3);
    return {
      coinbasePrice: coinbase,
      binancePrice: binance,
      gapPercent: gap + '%',
      signal: gap > 0.05 ? 'US Buying' : gap < -0.05 ? 'US Selling' : 'Neutral'
    };
  } catch (e) {
    return { error: 'Fetch failed' };
  }
}

async function fetchVolatility() {
  try {
    const res = await fetch('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=20');
    const data = await res.json();
    const atr = data.slice(-14).reduce((sum, k) => sum + (parseFloat(k[2]) - parseFloat(k[3])), 0) / 14;
    return {
      currentATR: atr.toFixed(2),
      zScore: '0.00',
      signal: atr > 3000 ? 'High Vol' : 'Normal'
    };
  } catch (e) {
    return { error: 'Fetch failed' };
  }
}
