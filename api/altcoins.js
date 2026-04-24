// api/altcoins.js - AC369 FUSION (RSI & Breakout Akurat)
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'max-age=0, s-maxage=60');

  try {
    const allRes = await fetch('https://api.binance.com/api/v3/ticker/24hr');
    const all = await allRes.json();
    const usdt = all.filter(t => t.symbol.endsWith('USDT') && !t.symbol.includes('BUSD') && !t.symbol.includes('TUSD') && !t.symbol.includes('USDC'));

    // Top Gainers
    const gainers = [...usdt].sort((a, b) => parseFloat(b.priceChangePercent) - parseFloat(a.priceChangePercent)).slice(0, 15)
      .map(t => ({ symbol: t.symbol.replace('USDT', ''), price: parseFloat(t.lastPrice).toFixed(4), change24h: parseFloat(t.priceChangePercent).toFixed(2) + '%' }));

    // Volume Breakout (Volume > 3x rata-rata 7 hari dari klines)
    const breakouts = [];
    for (const t of usdt.slice(0, 30)) {
      try {
        const klinesRes = await fetch(`https://api.binance.com/api/v3/klines?symbol=${t.symbol}&interval=1d&limit=8`);
        if (!klinesRes.ok) continue;
        const klines = await klinesRes.json();
        if (klines.length < 8) continue;
        const vols = klines.slice(0, 7).map(k => parseFloat(k[5]));
        const avgVol = vols.reduce((a,b)=>a+b,0)/7;
        const todayVol = parseFloat(klines[7][5]);
        if (todayVol > avgVol * 3) {
          breakouts.push({
            symbol: t.symbol.replace('USDT', ''),
            price: parseFloat(t.lastPrice).toFixed(4),
            volumeRatio: (todayVol/avgVol).toFixed(1) + 'x',
            change24h: parseFloat(t.priceChangePercent).toFixed(2) + '%'
          });
        }
      } catch (e) {}
    }

    // RSI Ekstrem (7 major coins)
    const majors = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'ADAUSDT', 'XRPUSDT', 'DOGEUSDT'];
    const rsiExtremes = [];
    for (const sym of majors) {
      try {
        const klinesRes = await fetch(`https://api.binance.com/api/v3/klines?symbol=${sym}&interval=1h&limit=100`);
        if (!klinesRes.ok) continue;
        const klines = await klinesRes.json();
        const closes = klines.map(k => parseFloat(k[4])).filter(v => !isNaN(v) && v > 0);
        if (closes.length < 14) continue;
        const rsi = calculateRSI(closes, 14);
        const ticker = usdt.find(t => t.symbol === sym);
        const price = ticker ? parseFloat(ticker.lastPrice).toFixed(4) : 'N/A';
        let condition = 'Neutral';
        if (rsi < 30) condition = 'Oversold (Peluang Beli)';
        else if (rsi > 70) condition = 'Overbought (Hati-hati)';
        rsiExtremes.push({ symbol: sym.replace('USDT', ''), price, rsi: rsi.toFixed(2), condition });
      } catch (e) {}
    }

    const narrative = `Top gainer: ${gainers[0]?.symbol || 'N/A'} (+${gainers[0]?.change24h || '0%'}). ` +
      (rsiExtremes.filter(r => r.condition.includes('Oversold')).map(r => r.symbol).join(', ') || 'Tidak ada RSI oversold.');

    res.status(200).json({ timestamp: new Date().toISOString(), topGainers: gainers, volumeBreakouts: breakouts.slice(0, 10), rsiExtremes, narrative });
  } catch (e) {
    res.status(200).json({ topGainers: [], volumeBreakouts: [], rsiExtremes: [], narrative: 'Data altcoin gagal dimuat.' });
  }
}

function calculateRSI(prices, period = 14) {
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
