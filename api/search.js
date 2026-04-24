// api/search.js - AC369 FUSION (CoinGecko OHLCV, No Binance)
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'max-age=0, s-maxage=120');

  const symbol = (req.query.symbol || '').toUpperCase().trim();
  if (!symbol) {
    return res.status(400).json({ error: 'Parameter ?symbol= diperlukan. Contoh: /api/search?symbol=ADA' });
  }

  let coinName = symbol;
  let coinId = '';
  let currentPrice = 0;
  let change24h = 0;
  let marketCap = 0;
  let totalVolume = 0;

  try {
    // 1. Cari ID CoinGecko dari simbol
    const searchUrl = `https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(symbol)}`;
    const searchRes = await fetchWithRetry(searchUrl);
    if (!searchRes || !searchRes.ok) throw new Error('CoinGecko search gagal');
    const searchData = await searchRes.json();
    const matchedCoin = searchData.coins?.find(c => c.symbol.toUpperCase() === symbol);
    if (!matchedCoin) throw new Error(`Simbol ${symbol} tidak ditemukan di CoinGecko`);
    coinId = matchedCoin.id;

    // 2. Ambil data harga & detail dari CoinGecko
    const detailUrl = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${coinId}&order=market_cap_desc&sparkline=false&price_change_percentage=24h`;
    const detailRes = await fetchWithRetry(detailUrl);
    if (detailRes && detailRes.ok) {
      const detailData = await detailRes.json();
      if (detailData && detailData.length > 0) {
        const info = detailData[0];
        coinName = info.name || symbol;
        currentPrice = info.current_price || 0;
        change24h = info.price_change_percentage_24h || 0;
        marketCap = info.market_cap || 0;
        totalVolume = info.total_volume || 0;
      }
    }

    if (currentPrice === 0) throw new Error('Harga tidak tersedia');

    // 3. Ambil OHLCV dari CoinGecko untuk 3 timeframe
    // 1H: days=2 (granularity otomatis per jam)
    // 4H: days=14 (granularity otomatis 4 jam untuk range 2-90 hari)
    // 1D: days=100 (granularity otomatis harian)
    const [klines1h, klines4h, klines1d] = await Promise.all([
      fetchCoinGeckoOHLCV(coinId, 2),    // 1H
      fetchCoinGeckoOHLCV(coinId, 14),   // 4H
      fetchCoinGeckoOHLCV(coinId, 100)   // 1D
    ]);

    // 4. Analisis per timeframe
    const tf1h = analyzeTimeframe(klines1h, '1H', currentPrice, change24h);
    const tf4h = analyzeTimeframe(klines4h, '4H', currentPrice, change24h);
    const tf1d = analyzeTimeframe(klines1d, '1D', currentPrice, change24h);

    // 5. Rekomendasi trading
    const recommendation = generateTradeRecommendation(tf1h, tf4h, tf1d, currentPrice, change24h);

    // 6. Astrologi
    const astrology = getAstrologySignal(new Date());

    // 7. Support & Resistance dari 1D
    let support = (currentPrice * 0.95).toFixed(4);
    let resistance = (currentPrice * 1.05).toFixed(4);
    const src = klines1d.length >= 10 ? klines1d : (klines4h.length >= 10 ? klines4h : klines1h);
    if (src.length >= 10) {
      const lows = src.slice(-20).map(c => c.low).filter(v => v > 0);
      const highs = src.slice(-20).map(c => c.high).filter(v => v > 0);
      if (lows.length) support = Math.min(...lows).toFixed(4);
      if (highs.length) resistance = Math.max(...highs).toFixed(4);
    }

    res.status(200).json({
      symbol,
      name: coinName,
      price: currentPrice,
      change24h,
      marketCap,
      volume24h: totalVolume,
      support,
      resistance,
      timeframes: { '1H': tf1h, '4H': tf4h, '1D': tf1d },
      recommendation,
      astrology,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Search error:', error.message);
    res.status(500).json({ error: error.message.includes('ditemukan') ? error.message : 'Gagal mengambil data. Coba lagi nanti.' });
  }
}

// ==================== FETCH COINGECKO OHLCV ====================
async function fetchCoinGeckoOHLCV(coinId, days) {
  try {
    const url = `https://api.coingecko.com/api/v3/coins/${coinId}/ohlcv?vs_currency=usd&days=${days}`;
    const res = await fetchWithRetry(url);
    if (!res || !res.ok) return [];
    const json = await res.json();
    if (!Array.isArray(json)) return [];
    return json.map(item => ({
      open: item[1],
      high: item[2],
      low: item[3],
      close: item[4],
      volume: 0 // CoinGecko tidak menyediakan volume di OHLCV gratis
    }));
  } catch (e) {
    return [];
  }
}

// ==================== FETCH DENGAN RETRY ====================
async function fetchWithRetry(url, retries = 2) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'application/json'
  };
  for (let i = 0; i < retries; i++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(url, { headers, signal: controller.signal });
      clearTimeout(timeout);
      return res;
    } catch (e) {
      if (i === retries - 1) return null;
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  return null;
}

// ==================== ANALISIS PER TIMEFRAME ====================
function analyzeTimeframe(ohlcv, label, currentPrice, change24h) {
  if (!ohlcv || ohlcv.length < 5) {
    return makeFallbackAnalysis(change24h);
  }
  const closes = ohlcv.map(c => c.close);
  const rsi = closes.length >= 14 ? calculateRSI(closes, 14).toFixed(1) : 'N/A';
  const patterns = detectAllPatterns(ohlcv);
  const elliottWave = detectElliottWave(ohlcv);
  const smc = analyzeSMCDetail(ohlcv);
  return { rsi, patterns, elliottWave, smc };
}

function makeFallbackAnalysis(change24h) {
  const patterns = [];
  if (change24h > 3) patterns.push({ name: 'Momentum Naik', signal: 'bullish', probability: 55 });
  else if (change24h < -3) patterns.push({ name: 'Momentum Turun', signal: 'bearish', probability: 55 });
  else patterns.push({ name: 'Sideways (Terbatas)', signal: 'neutral', probability: 40 });
  return {
    rsi: 'N/A',
    patterns,
    elliottWave: { wave: 'Data OHLCV terbatas', confidence: 10, description: 'Candle dari CoinGecko kurang' },
    smc: { signal: 'Neutral', summary: 'Data tidak cukup', orderBlock: null, liquiditySweep: null, fvg: null }
  };
}

// ... (fungsi detectAllPatterns, detectElliottWave, analyzeSMCDetail, dll. SAMA PERSIS dengan kode sebelumnya, tidak diubah) ...
// Masukkan semua fungsi analisis dari jawaban sebelumnya di sini!
