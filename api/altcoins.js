// api/altcoins.js - AC369 FUSION Stable
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'max-age=0, s-maxage=60');

  try {
    const response = await fetch('https://api.binance.com/api/v3/ticker/24hr');
    const all = await response.json();
    
    const usdt = all.filter(t => t.symbol.endsWith('USDT') && !t.symbol.includes('BUSD') && !t.symbol.includes('TUSD') && !t.symbol.includes('USDC'));
    
    // Top Gainers
    const gainers = usdt
      .sort((a, b) => parseFloat(b.priceChangePercent) - parseFloat(a.priceChangePercent))
      .slice(0, 10)
      .map(t => ({
        symbol: t.symbol.replace('USDT', ''),
        price: parseFloat(t.lastPrice).toFixed(4),
        change24h: parseFloat(t.priceChangePercent).toFixed(2) + '%'
      }));

    // RSI untuk 7 koin utama
    const majors = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'ADAUSDT', 'XRPUSDT', 'DOGEUSDT'];
    const rsiList = [];
    for (const sym of majors) {
      try {
        const k = await fetch(`https://api.binance.com/api/v3/klines?symbol=${sym}&interval=1h&limit=100`);
        const klines = await k.json();
        const closes = klines.map(c => parseFloat(c[4])).filter(v => !isNaN(v));
        if (closes.length > 14) {
          const rsi = calculateRSI(closes);
          const ticker = usdt.find(t => t.symbol === sym);
          const price = ticker ? parseFloat(ticker.lastPrice).toFixed(4) : 'N/A';
          let cond = 'Neutral';
          if (rsi < 30) cond = 'Oversold';
          else if (rsi > 70) cond = 'Overbought';
          rsiList.push({ symbol: sym.replace('USDT', ''), price, rsi: rsi.toFixed(2), condition: cond });
        }
      } catch (e) {}
    }

    res.status(200).json({
      timestamp: new Date().toISOString(),
      topGainers: gainers,
      volumeBreakouts: [],
      rsiExtremes: rsiList,
      narrative: gainers.length ? `Top gainer: ${gainers[0].symbol} (+${gainers[0].change24h})` : 'Data tidak tersedia'
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

function calculateRSI(prices, period = 14) {
  if (prices.length < period) return 50;
  let gains = 0, losses = 0;
  for (let i = prices.length - period; i < prices.length; i++) {
    const diff = prices[i] - prices[i-1];
    if (diff > 0) gains += diff;
    else losses -= diff;
  }
  const avgGain = gains/period;
  const avgLoss = losses/period;
  if (avgLoss === 0) return 100;
  return 100 - (100/(1 + avgGain/avgLoss));
}
