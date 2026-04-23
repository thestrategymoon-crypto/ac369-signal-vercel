// api/altcoins.js - Enhanced Altcoin Scanner
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const tickers = await fetch('https://api.binance.com/api/v3/ticker/24hr').then(r => r.json());
    const pairs = tickers.filter(t => t.symbol.endsWith('USDT') && !t.symbol.includes('BUSD') && !t.symbol.includes('TUSD') && !t.symbol.includes('USDC') && !t.symbol.includes('BULL') && !t.symbol.includes('BEAR') && parseFloat(t.volume) > 2000000);

    const gainers = [...pairs].sort((a,b) => parseFloat(b.priceChangePercent) - parseFloat(a.priceChangePercent)).slice(0,15).map(t => ({
      symbol: t.symbol.replace('USDT',''), price: parseFloat(t.lastPrice).toFixed(4), change24h: parseFloat(t.priceChangePercent).toFixed(2)+'%', volume24h: (parseFloat(t.quoteVolume)/1e6).toFixed(2)+'M'
    }));

    const breakouts = [];
    for (const t of pairs.slice(0,50)) {
      try {
        const kl = await fetch(`https://api.binance.com/api/v3/klines?symbol=${t.symbol}&interval=1d&limit=8`).then(r => r.json());
        const vols = kl.slice(0,7).map(k => parseFloat(k[5]));
        const avg = vols.reduce((a,b)=>a+b,0)/7;
        const today = parseFloat(kl[7][5]);
        const ratio = today/avg;
        if (ratio > 3.0) breakouts.push({
          symbol: t.symbol.replace('USDT',''), volumeRatio: ratio.toFixed(2)+'x', price: parseFloat(t.lastPrice).toFixed(4),
          change24h: parseFloat(t.priceChangePercent).toFixed(2)+'%', narrative: ratio>5?'🔥 Akumulasi Whale':'📈 Volume meningkat'
        });
      } catch {}
    }

    const majors = ['ETHUSDT','BNBUSDT','SOLUSDT','ADAUSDT','XRPUSDT','DOGEUSDT','AVAXUSDT'];
    const rsiData = [];
    for (const sym of majors) {
      try {
        const kl = await fetch(`https://api.binance.com/api/v3/klines?symbol=${sym}&interval=1h&limit=100`).then(r => r.json());
        const closes = kl.map(k => parseFloat(k[4]));
        const rsi = calculateRSI(closes, 14);
        let cond = 'Neutral';
        if (rsi > 70) cond = 'Overbought (Hati-hati)';
        else if (rsi < 30) cond = 'Oversold (Peluang Beli)';
        rsiData.push({ symbol: sym.replace('USDT',''), rsi: rsi.toFixed(2), condition: cond, price: closes[closes.length-1].toFixed(4) });
      } catch { rsiData.push({ symbol: sym.replace('USDT',''), error: 'Gagal' }); }
    }

    res.status(200).json({
      timestamp: new Date().toISOString(),
      topGainers: gainers,
      volumeBreakouts: breakouts.slice(0,10),
      rsiExtremes: rsiData,
      narrative: generateNarrative(gainers, breakouts, rsiData)
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

function calculateRSI(prices, period=14) {
  if (prices.length < period+1) return 50;
  let gains=0, losses=0;
  for (let i=prices.length-period; i<prices.length; i++) {
    const diff = prices[i]-prices[i-1];
    if (diff>0) gains+=diff; else losses-=diff;
  }
  const avgGain = gains/period, avgLoss = losses/period;
  if (avgLoss===0) return 100;
  return 100 - (100/(1+avgGain/avgLoss));
}

function generateNarrative(gainers, breakouts, rsi) {
  let nar = '';
  if (breakouts.length>5) nar = `🚀 Terdeteksi ${breakouts.length} altcoin dengan volume breakout >3x. Sinyal kuat rotasi ke altcoin. `;
  else if (breakouts.length>0) nar = `📊 Ada ${breakouts.length} altcoin dengan peningkatan volume. `;
  else nar = `💤 Tidak ada volume breakout signifikan. `;
  const oversold = rsi.filter(r=>r.condition?.includes('Oversold')).map(r=>r.symbol);
  if (oversold.length) nar += `RSI oversold pada ${oversold.join(', ')}. Potensi bounce. `;
  if (gainers[0]) nar += `Top gainer: ${gainers[0].symbol} (+${gainers[0].change24h}).`;
  return nar;
}
