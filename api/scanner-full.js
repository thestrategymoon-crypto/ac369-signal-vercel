// api/scanner-full.js - AC369 FUSION Full Altcoin Scanner (Fase 1)
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'max-age=0, s-maxage=300'); // Cache 5 menit

  try {
    // Ambil data dari CoinGecko (250 koin per halaman, bisa di-loop untuk 600+)
    const allCoins = [];
    const pages = 3; // 3 halaman = 750 koin (cukup untuk 600+)
    
    for (let page = 1; page <= pages; page++) {
      const response = await fetch(
        `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=${page}&sparkline=false&price_change_percentage=24h`
      );
      const data = await response.json();
      allCoins.push(...data);
      
      // Jeda 1 detik antar halaman untuk menghindari rate limit
      if (page < pages) await new Promise(r => setTimeout(r, 1000));
    }

    // Filter koin dengan volume > $1M dan market cap > $10M (hindari koin sampah)
    const filteredCoins = allCoins.filter(c => 
      c.total_volume > 1000000 && c.market_cap > 10000000
    );

    // Analisis probabilitas breakout untuk setiap koin (paralel, tapi batasi concurrency)
    const results = [];
    const batchSize = 5;
    
    for (let i = 0; i < filteredCoins.length; i += batchSize) {
      const batch = filteredCoins.slice(i, i + batchSize);
      const batchResults = await Promise.allSettled(
        batch.map(coin => analyzeCoin(coin))
      );
      
      batchResults.forEach((result, idx) => {
        if (result.status === 'fulfilled' && result.value) {
          results.push(result.value);
        }
      });
      
      // Jeda antar batch
      await new Promise(r => setTimeout(r, 500));
    }

    // Urutkan berdasarkan probabilitas breakout (tertinggi ke terendah)
    results.sort((a, b) => b.breakoutProbability.score - a.breakoutProbability.score);

    res.status(200).json({
      timestamp: new Date().toISOString(),
      totalScanned: filteredCoins.length,
      results: results.slice(0, 50) // Kembalikan 50 teratas untuk respons cepat
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

// Fungsi analisis per koin
async function analyzeCoin(coin) {
  const symbol = coin.symbol.toUpperCase();
  
  // Coba ambil data OHLCV dari Binance (jika tersedia)
  let ohlcv = null;
  try {
    const binanceRes = await fetch(
      `https://api.binance.com/api/v3/klines?symbol=${symbol}USDT&interval=1d&limit=30`
    );
    if (binanceRes.ok) {
      const data = await binanceRes.json();
      ohlcv = data.map(c => ({
        open: parseFloat(c[1]),
        high: parseFloat(c[2]),
        low: parseFloat(c[3]),
        close: parseFloat(c[4]),
        volume: parseFloat(c[5])
      }));
    }
  } catch (e) {
    // Jika tidak ada di Binance, lanjutkan tanpa data OHLCV
  }

  // Hitung probabilitas breakout
  const breakoutProb = calculateBreakoutProbability(coin, ohlcv);

  return {
    symbol: symbol,
    name: coin.name,
    price: coin.current_price,
    marketCap: coin.market_cap,
    volume24h: coin.total_volume,
    priceChange24h: coin.price_change_percentage_24h,
    breakoutProbability: breakoutProb,
    hasOHLCV: !!ohlcv
  };
}

// Fungsi hitung probabilitas breakout
function calculateBreakoutProbability(coin, ohlcv) {
  let score = 0;
  const reasons = [];

  // 1. Perubahan harga 24 jam (momentum)
  const change = coin.price_change_percentage_24h || 0;
  if (change > 10) {
    score += 25;
    reasons.push(`Momentum sangat kuat (+${change.toFixed(1)}%)`);
  } else if (change > 5) {
    score += 15;
    reasons.push(`Momentum positif (+${change.toFixed(1)}%)`);
  } else if (change < -5) {
    score -= 10;
    reasons.push(`Momentum negatif (${change.toFixed(1)}%)`);
  }

  // 2. Analisis OHLCV (jika tersedia)
  if (ohlcv && ohlcv.length >= 20) {
    const last = ohlcv[ohlcv.length - 1];
    const prevVolumes = ohlcv.slice(-20, -1).map(c => c.volume);
    const avgVolume = prevVolumes.reduce((a, b) => a + b, 0) / prevVolumes.length;
    
    // Volume spike
    const volumeRatio = last.volume / avgVolume;
    if (volumeRatio > 2.5) {
      score += 30;
      reasons.push(`Volume melonjak ${volumeRatio.toFixed(1)}x rata-rata`);
    } else if (volumeRatio > 1.5) {
      score += 15;
      reasons.push(`Volume meningkat ${volumeRatio.toFixed(1)}x`);
    }

    // Harga dekat resistance 20-hari
    const highest20 = Math.max(...ohlcv.slice(-20, -1).map(c => c.high));
    const distanceToResistance = ((highest20 - last.close) / last.close) * 100;
    if (distanceToResistance < 2 && distanceToResistance > 0) {
      score += 20;
      reasons.push(`Harga dekat resistance (${distanceToResistance.toFixed(1)}% lagi)`);
    }

    // Harga di atas MA20
    const ma20 = ohlcv.slice(-20).reduce((sum, c) => sum + c.close, 0) / 20;
    if (last.close > ma20) {
      score += 10;
      reasons.push('Harga di atas MA20');
    }
  }

  // Normalisasi skor ke 0-100
  const normalizedScore = Math.max(0, Math.min(100, score + 50));
  
  return {
    score: normalizedScore,
    reasons: reasons.slice(0, 3),
    interpretation: normalizedScore >= 70 ? '🔥 Probabilitas Tinggi' : 
                     normalizedScore >= 50 ? '📈 Perlu Dipantau' : 
                     '💤 Probabilitas Rendah'
  };
}
