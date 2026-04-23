// api/scanner-full.js - Hanya CoinGecko, tanpa Binance
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'max-age=0, s-maxage=300');

  try {
    const allCoins = [];
    for (let page = 1; page <= 2; page++) {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 8000);
      try {
        const r = await fetch(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=${page}&sparkline=false&price_change_percentage=24h`, { signal: controller.signal });
        clearTimeout(id);
        const data = await r.json();
        data.forEach(c => allCoins.push(c));
      } catch (e) { clearTimeout(id); }
      await new Promise(r => setTimeout(r, 500));
    }

    const filtered = allCoins.filter(c => c.total_volume > 2000000 && c.market_cap > 20000000);
    const results = filtered.map(coin => {
      const change = coin.price_change_percentage_24h || 0;
      let score = 50;
      if (change > 10) score += 25;
      else if (change > 5) score += 15;
      else if (change < -5) score -= 10;
      if (coin.total_volume > 50000000) score += 10;
      score = Math.max(0, Math.min(100, score));
      return {
        symbol: coin.symbol.toUpperCase(),
        name: coin.name,
        price: coin.current_price,
        volume24h: coin.total_volume,
        priceChange24h: change,
        breakoutProbability: {
          score: Math.round(score),
          reasons: [change > 0 ? `+${change.toFixed(1)}%` : `${change.toFixed(1)}%`, `Vol: $${(coin.total_volume/1e6).toFixed(1)}M`],
          interpretation: score >= 70 ? '🔥 Tinggi' : score >= 50 ? '📈 Pantau' : '💤 Rendah'
        },
        chartPatterns: [],
        elliottWave: { wave: '-', confidence: 0, description: '' },
        smc: { signal: 'Neutral', summary: '' }
      };
    });

    results.sort((a, b) => b.breakoutProbability.score - a.breakoutProbability.score);

    res.status(200).json({
      timestamp: new Date().toISOString(),
      totalScanned: filtered.length,
      results: results.slice(0, 40)
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
