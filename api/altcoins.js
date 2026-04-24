// api/altcoins.js - AC369 FUSION (Data Altcoin Super Detail)
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'max-age=0, s-maxage=60');

  try {
    const tickerRes = await fetch('https://api.binance.com/api/v3/ticker/24hr');
    const all = await tickerRes.json();
    const usdt = all.filter(t => t.symbol.endsWith('USDT') && !t.symbol.includes('BUSD') && !t.symbol.includes('TUSD') && !t.symbol.includes('USDC'));

    // Top Gainers (15 koin)
    const gainers = [...usdt]
      .sort((a, b) => parseFloat(b.priceChangePercent) - parseFloat(a.priceChangePercent))
      .slice(0, 15)
      .map(t => ({
        symbol: t.symbol.replace('USDT', ''),
        price: parseFloat(t.lastPrice).toFixed(4),
        change24h: parseFloat(t.priceChangePercent).toFixed(2) + '%'
      }));

    // Volume Breakout (volume hari ini > 3x rata-rata 7 hari)
    const breakouts = [];
    for (const t of usdt.slice(0, 40)) {
      try {
        const k = await fetch(`https://api.binance.com/api/v3/klines?symbol=${t.symbol}&interval=1d&limit=8`);
        if (!k.ok) continue;
        const d = await k.json();
        if (d.length < 8) continue;
        const vols = d.slice(0, 7).map(c => parseFloat(c[5]));
        const avg = vols.reduce((a,b)=>a+b,0)/7;
        const today = parseFloat(d[7][5]);
        if (today > avg * 3) {
          breakouts.push({
            symbol: t.symbol.replace('USDT', ''),
            price: parseFloat(t.lastPrice).toFixed(4),
            volumeRatio: (today/avg).toFixed(1) + 'x',
            change24h: parseFloat(t.priceChangePercent).toFixed(2) + '%'
          });
        }
      } catch (e) {}
    }

    // RSI Ekstrem untuk 7 koin utama
    const majors = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'ADAUSDT', 'XRPUSDT', 'DOGEUSDT'];
    const rsiList = [];
    for (const sym of majors) {
      try {
        const k = await fetch(`https://api.binance.com/api/v3/klines?symbol=${sym}&interval=1h&limit=100`);
        if (!k.ok) continue;
        const data = await k.json();
        const closes = data.map(c => parseFloat(c[4])).filter(v => !isNaN(v) && v > 0);
        if (closes.length < 14) continue;
        const rsi = calcRSI(closes, 14);
        const t = usdt.find(x => x.symbol === sym);
        const price = t ? parseFloat(t.lastPrice).toFixed(4) : 'N/A';
        let cond = 'Neutral';
        if (rsi < 30) cond = 'Oversold (Peluang Beli)';
        else if (rsi > 70) cond = 'Overbought (Hati-hati)';
        rsiList.push({ symbol: sym.replace('USDT', ''), price, rsi: rsi.toFixed(2), condition: cond });
      } catch (e) {}
    }

    const narrative = `🔥 Top gainer: ${gainers[0]?.symbol || 'N/A'} (+${gainers[0]?.change24h || '0'}). ` +
      (rsiList.filter(r => r.condition.includes('Oversold')).map(r => r.symbol).join(', ') || 'Tidak ada RSI oversold.');

    res.status(200).json({
      timestamp: new Date().toISOString(),
      topGainers: gainers,
      volumeBreakouts: breakouts.slice(0, 10),
      rsiExtremes: rsiList,
      narrative
    });
  } catch (e) {
    res.status(200).json({
      topGainers: [], volumeBreakouts: [], rsiExtremes: [], narrative: 'Data altcoin gagal dimuat.'
    });
  }
}

function calcRSI(prices, period = 14) {
  if (prices.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = prices.length - period; i < prices.length; i++) {
    const diff = prices[i] - prices[i - 1];
    if (diff > 0) gains += diff; else losses -= diff;
  }
  const avgGain = gains / period, avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  return 100 - (100 / (1 + avgGain / avgLoss));
}
