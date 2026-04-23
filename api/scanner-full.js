// api/scanner-full.js - Versi Ringan untuk Debugging
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'max-age=0, s-maxage=300');

  try {
    const allCoins = [];
    const pages = 1; // Hanya 1 halaman (250 koin) dulu
    
    for (let page = 1; page <= pages; page++) {
      const response = await fetch(
        `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=${page}&sparkline=false&price_change_percentage=24h`
      );
      const data = await response.json();
      
      for (let i = 0; i < data.length; i++) {
        allCoins.push(data[i]);
      }
    }

    const filteredCoins = [];
    for (let i = 0; i < allCoins.length; i++) {
      const c = allCoins[i];
      if (c.total_volume > 5000000 && c.market_cap > 50000000) {
        filteredCoins.push(c);
      }
    }

    const results = [];
    const batchSize = 3;
    
    for (let i = 0; i < filteredCoins.length; i += batchSize) {
      const batch = [];
      for (let j = i; j < Math.min(i + batchSize, filteredCoins.length); j++) {
        batch.push(analyzeCoinSimple(filteredCoins[j]));
      }
      
      const batchResults = await Promise.allSettled(batch);
      
      for (let k = 0; k < batchResults.length; k++) {
        const result = batchResults[k];
        if (result.status === 'fulfilled' && result.value) {
          results.push(result.value);
        }
      }
      
      await new Promise(r => setTimeout(r, 300));
    }

    results.sort((a, b) => b.breakoutProbability.score - a.breakoutProbability.score);

    res.status(200).json({
      timestamp: new Date().toISOString(),
      totalScanned: filteredCoins.length,
      results: results.slice(0, 30)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function analyzeCoinSimple(coin) {
  const symbol = coin.symbol.toUpperCase();
  
  // Hitung probabilitas sederhana tanpa OHLCV dulu
  const breakoutProb = {
    score: Math.min(100, Math.max(0, Math.round((coin.price_change_percentage_24h || 0) * 2 + 50))),
    reasons: [`Momentum ${coin.price_change_percentage_24h?.toFixed(1)}%`],
    interpretation: coin.price_change_percentage_24h > 5 ? '📈 Perlu Dipantau' : '💤 Probabilitas Rendah'
  };

  return {
    symbol: symbol,
    name: coin.name,
    price: coin.current_price,
    marketCap: coin.market_cap,
    volume24h: coin.total_volume,
    priceChange24h: coin.price_change_percentage_24h,
    breakoutProbability: breakoutProb,
    chartPatterns: [],
    elliottWave: { wave: 'N/A', confidence: 0, description: '' },
    smc: { signal: 'Neutral', summary: '' },
    hasOHLCV: false
  };
}
