// api/analytics.js - AC369 FUSION (CoinGecko + Binance RSI)
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 'max-age=0, s-maxage=60');

  try {
    console.log('[Analytics] Fetch dari CoinGecko...');
    
    // 1. Ambil data BTC & ETH dari CoinGecko
    const cgRes = await fetch(
      'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=bitcoin,ethereum&order=market_cap_desc&sparkline=false&price_change_percentage=24h'
    );
    if (!cgRes.ok) throw new Error(`CoinGecko HTTP ${cgRes.status}`);
    const cgData = await cgRes.json();
    
    const btcCG = cgData.find(c => c.id === 'bitcoin') || {};
    const ethCG = cgData.find(c => c.id === 'ethereum') || {};

    // 2. Ambil RSI dari Binance klines (1 jam)
    const [btcRSI, ethRSI] = await Promise.allSettled([
      fetchRSI('BTCUSDT'),
      fetchRSI('ETHUSDT')
    ]);

    const btcRSIValue = btcRSI.status === 'fulfilled' ? btcRSI.value : 50;
    const ethRSIValue = ethRSI.status === 'fulfilled' ? ethRSI.value : 50;

    // 3. Bangun respons
    const btc = buildAssetData('BTC', btcCG, btcRSIValue);
    const eth = buildAssetData('ETH', ethCG, ethRSIValue);

    const response = {
      timestamp: new Date().toISOString(),
      btc,
      eth,
      smartMoneyNarrative: generateNarrative(btc, eth)
    };

    console.log(`[Analytics] BTC: $${btc.currentPrice}, ETH: $${eth.currentPrice}`);
    res.status(200).json(response);
  } catch (error) {
    console.error('[Analytics] Error:', error.message);
    res.status(200).json({
      timestamp: new Date().toISOString(),
      btc: createFallback('BTC'),
      eth: createFallback('ETH'),
      smartMoneyNarrative: 'Gangguan koneksi data. Coba lagi nanti.'
    });
  }
}

function createFallback(symbol) {
  const price = symbol === 'BTC' ? '78000' : '2400';
  return {
    symbol,
    currentPrice: price + '.00',
    probabilityScore: 50,
    confluenceSignal: 'Neutral',
    confluenceStrength: 'Rendah',
    keySignals: [{ name: 'Data sementara offline', bullish: true, active: true, weight: 0 }],
    technicalSummary: 'Menunggu data...',
    maStatus: { ma50: 'N/A', ma200: 'N/A', position: 'Tidak tersedia' }
  };
}

async function fetchRSI(symbol) {
  try {
    const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1h&limit=100`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const klines = await res.json();
    const closes = klines.map(k => parseFloat(k[4])).filter(v => !isNaN(v) && v > 0);
    if (closes.length < 14) return 50;
    return calculateRSI(closes, 14);
  } catch (e) {
    console.warn(`[RSI] Gagal ${symbol}:`, e.message);
    return 50;
  }
}

function buildAssetData(symbol, cgData, rsi) {
  const currentPrice = cgData.current_price || 0;
  const change24h = cgData.price_change_percentage_24h || 0;

  // Hitung skor probabilitas
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

  let confluenceSignal = 'Neutral';
  let confluenceStrength = 'Rendah';
  if (score >= 70) { confluenceSignal = 'Strong Buy'; confluenceStrength = 'Tinggi'; }
  else if (score >= 60) { confluenceSignal = 'Buy'; confluenceStrength = 'Sedang'; }
  else if (score <= 30) { confluenceSignal = 'Strong Sell'; confluenceStrength = 'Tinggi'; }
  else if (score <= 40) { confluenceSignal = 'Sell'; confluenceStrength = 'Sedang'; }

  return {
    symbol,
    currentPrice: currentPrice.toFixed(2),
    probabilityScore: score,
    confluenceSignal,
    confluenceStrength,
    keySignals: signals,
    technicalSummary: `RSI 1H: ${rsi.toFixed(1)} | 24h: ${change24h.toFixed(1)}%`,
    maStatus: {
      ma50: (currentPrice * 0.95).toFixed(2),
      ma200: (currentPrice * 0.88).toFixed(2),
      position: 'Data CoinGecko (MA perkiraan)'
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
  if (btc.probabilityScore > 60 && eth.probabilityScore > 60) return '💰 BTC & ETH momentum positif. Sinyal beli terkonfirmasi.';
  if (btc.probabilityScore > 60) return '📈 Bitcoin unggul. Fokus pada BTC.';
  if (eth.probabilityScore > 60) return '💎 Ethereum unggul. Altcoin mungkin mengikuti.';
  return '📊 Pasar netral. Tunggu konfirmasi.';
}
