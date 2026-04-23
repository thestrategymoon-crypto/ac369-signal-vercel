// api/altcoins.js - AC369 FUSION (Final Stable)
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'max-age=0, s-maxage=60');

  try {
    const response = await fetch('https://api.binance.com/api/v3/ticker/24hr');
    const allTickers = await response.json();

    const usdtPairs = allTickers.filter(t => 
      t.symbol.endsWith('USDT') && 
      !t.symbol.includes('BUSD') && 
      !t.symbol.includes('TUSD') &&
      !t.symbol.includes('USDC') &&
      parseFloat(t.quoteVolume) > 2000000
    );

    // Top Gainers
    const gainers = [...usdtPairs]
      .sort((a, b) => parseFloat(b.priceChangePercent) - parseFloat(a.priceChangePercent))
      .slice(0, 10)
      .map(t => ({
        symbol: t.symbol.replace('USDT', ''),
        price: parseFloat(t.lastPrice).toFixed(4),
        change24h: parseFloat(t.priceChangePercent).toFixed(2) + '%',
        volume24h: (parseFloat(t.quoteVolume) / 1e6).toFixed(2) + 'M'
      }));

    // RSI untuk major coins
    const majorSymbols = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'ADAUSDT', 'XRPUSDT', 'DOGEUSDT'];
    const rsiData = [];
    for (const sym of majorSymbols) {
      try {
        const klinesRes = await fetch(`https://api.binance.com/api/v3/klines?symbol=${sym}&interval=1h&limit=100`);
        const klines = await klinesRes.json();
        const closes = klines.map(k => parseFloat(k[4]));
        const rsi = calculateRSI(closes, 14);
        const ticker = usdtPairs.find(t => t.symbol === sym);
        const price = ticker ? parseFloat(ticker.lastPrice).toFixed(4) : 'N/A';
        let condition = 'Neutral';
        if (rsi < 30) condition = 'Oversold (Beli)';
        else if (rsi > 70) condition = 'Overbought (Jual)';
        rsiData.push({ symbol: sym.replace('USDT', ''), price, rsi: rsi.toFixed(2), condition });
      } catch (e) {
        rsiData.push({ symbol: sym.replace('USDT', ''), price: 'N/A', rsi: 'N/A', condition: 'Error' });
      }
    }

    res.status(200).json({
      timestamp: new Date().toISOString(),
      topGainers: gainers,
      volumeBreakouts: [],
      rsiExtremes: rsiData,
      narrative: gainers.length > 0 ? `Top gainer: ${gainers[0].symbol} (+${gainers[0].change24h})` : 'Tidak ada data gainer.'
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
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
