// api/altcoins.js — AC369 FUSION v10.2
// FIXED: RSI proper Wilder's smoothing, volume breakout real detection

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60');

  try {
    const [tickerRes, majorKlinesRes] = await Promise.allSettled([
      fetch('https://api.binance.com/api/v3/ticker/24hr', { signal: AbortSignal.timeout(12000) }).then(r => r.json()),
      // Fetch 1h klines for RSI on major coins
      Promise.allSettled([
        fetch('https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=1h&limit=100').then(r => r.json()),
        fetch('https://fapi.binance.com/fapi/v1/klines?symbol=ETHUSDT&interval=1h&limit=100').then(r => r.json()),
        fetch('https://fapi.binance.com/fapi/v1/klines?symbol=BNBUSDT&interval=1h&limit=100').then(r => r.json()),
        fetch('https://fapi.binance.com/fapi/v1/klines?symbol=SOLUSDT&interval=1h&limit=100').then(r => r.json()),
        fetch('https://fapi.binance.com/fapi/v1/klines?symbol=XRPUSDT&interval=1h&limit=100').then(r => r.json()),
        fetch('https://fapi.binance.com/fapi/v1/klines?symbol=ADAUSDT&interval=1h&limit=100').then(r => r.json()),
        fetch('https://fapi.binance.com/fapi/v1/klines?symbol=AVAXUSDT&interval=1h&limit=100').then(r => r.json()),
        fetch('https://fapi.binance.com/fapi/v1/klines?symbol=DOGEUSDT&interval=1h&limit=100').then(r => r.json()),
        fetch('https://fapi.binance.com/fapi/v1/klines?symbol=LINKUSDT&interval=1h&limit=100').then(r => r.json()),
        fetch('https://fapi.binance.com/fapi/v1/klines?symbol=DOTUSDT&interval=1h&limit=100').then(r => r.json()),
      ])
    ]);

    if (tickerRes.status !== 'fulfilled') throw new Error('Ticker data unavailable');

    const tickers = tickerRes.value;
    const STABLES = new Set(['USDT', 'USDC', 'BUSD', 'TUSD', 'DAI', 'FDUSD', 'USDP']);

    // ── RSI Wilder's Smoothing ────────────────────────────────────
    const calcRSI = (closes, period = 14) => {
      if (!closes || closes.length < period + 1) return 50;
      let gains = 0, losses = 0;
      for (let i = 1; i <= period; i++) {
        const d = closes[i] - closes[i - 1];
        if (d >= 0) gains += d; else losses -= d;
      }
      let ag = gains / period, al = losses / period;
      for (let i = period + 1; i < closes.length; i++) {
        const d = closes[i] - closes[i - 1];
        ag = (ag * (period - 1) + (d >= 0 ? d : 0)) / period;
        al = (al * (period - 1) + (d < 0 ? -d : 0)) / period;
      }
      if (al === 0) return 100;
      return parseFloat((100 - 100 / (1 + ag / al)).toFixed(2));
    };

    // ── TOP GAINERS ───────────────────────────────────────────────
    const filtered = tickers.filter(t =>
      t.symbol.endsWith('USDT') &&
      !STABLES.has(t.symbol.replace('USDT', '')) &&
      parseFloat(t.quoteVolume) > 2000000 &&
      parseFloat(t.lastPrice) > 0
    );

    const sorted = [...filtered].sort((a, b) => parseFloat(b.priceChangePercent) - parseFloat(a.priceChangePercent));
    const topGainers = sorted.slice(0, 15).map(t => ({
      symbol: t.symbol.replace('USDT', ''),
      price: parseFloat(parseFloat(t.lastPrice).toFixed(6)),
      change24h: parseFloat(parseFloat(t.priceChangePercent).toFixed(2)) + '%',
      volume: Math.round(parseFloat(t.quoteVolume)),
    }));

    // ── VOLUME BREAKOUTS ──────────────────────────────────────────
    // Coins dengan volume hari ini signifikan DAN price movement besar
    const volumeBreakouts = [...filtered]
      .filter(t => {
        const change = Math.abs(parseFloat(t.priceChangePercent));
        const vol = parseFloat(t.quoteVolume);
        return vol > 30000000 && change > 3;
      })
      .sort((a, b) => {
        // Sort by volume × abs(change) = conviction
        const scoreA = parseFloat(a.quoteVolume) * Math.abs(parseFloat(a.priceChangePercent));
        const scoreB = parseFloat(b.quoteVolume) * Math.abs(parseFloat(b.priceChangePercent));
        return scoreB - scoreA;
      })
      .slice(0, 10)
      .map(t => ({
        symbol: t.symbol.replace('USDT', ''),
        price: parseFloat(parseFloat(t.lastPrice).toFixed(6)),
        change24h: parseFloat(parseFloat(t.priceChangePercent).toFixed(2)) + '%',
        volumeUSD: Math.round(parseFloat(t.quoteVolume)),
        volumeRatio: 'High',
        signal: parseFloat(t.priceChangePercent) > 0 ? 'Bullish Breakout' : 'Bearish Breakdown',
      }));

    // ── RSI EXTREMES (major coins dengan RSI real) ────────────────
    const MAJORS = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'ADAUSDT', 'AVAXUSDT', 'DOGEUSDT', 'LINKUSDT', 'DOTUSDT'];
    const rsiList = [];

    const klinesData = majorKlinesRes.status === 'fulfilled' ? majorKlinesRes.value : [];

    for (let i = 0; i < MAJORS.length; i++) {
      const sym = MAJORS[i];
      const tickerInfo = tickers.find(t => t.symbol === sym);
      if (!tickerInfo) continue;

      let rsi = 50;
      let dataSource = 'default';

      // Try to use kline data
      try {
        const klineResult = klinesData[i];
        if (klineResult && klineResult.status === 'fulfilled' && Array.isArray(klineResult.value)) {
          const closes = klineResult.value.map(k => parseFloat(k[4])).filter(v => !isNaN(v) && v > 0);
          if (closes.length >= 15) {
            rsi = calcRSI(closes, 14);
            dataSource = 'real';
          }
        }
      } catch (e) {}

      let condition = 'Neutral';
      let conditionDetail = '';
      if (rsi < 25) { condition = 'Extreme Oversold'; conditionDetail = 'Peluang beli kuat'; }
      else if (rsi < 35) { condition = 'Oversold (Peluang Beli)'; conditionDetail = 'Potensi reversal naik'; }
      else if (rsi > 75) { condition = 'Extreme Overbought'; conditionDetail = 'Waspada distribusi'; }
      else if (rsi > 65) { condition = 'Overbought (Hati-hati)'; conditionDetail = 'Potensi koreksi'; }
      else if (rsi > 50) { condition = 'Bullish Zone'; conditionDetail = 'Momentum positif'; }
      else { condition = 'Bearish Zone'; conditionDetail = 'Momentum negatif'; }

      rsiList.push({
        symbol: sym.replace('USDT', ''),
        price: parseFloat(parseFloat(tickerInfo.lastPrice).toFixed(6)),
        change24h: parseFloat(tickerInfo.priceChangePercent).toFixed(2) + '%',
        rsi: rsi.toFixed(2),
        condition,
        conditionDetail,
        dataSource,
      });
    }

    // Sort by RSI extremity
    rsiList.sort((a, b) => {
      const distA = Math.abs(parseFloat(a.rsi) - 50);
      const distB = Math.abs(parseFloat(b.rsi) - 50);
      return distB - distA;
    });

    // ── NARRATIVE ─────────────────────────────────────────────────
    const topGainer = topGainers[0];
    const oversold = rsiList.filter(r => r.condition.includes('Oversold'));
    const overbought = rsiList.filter(r => r.condition.includes('Overbought'));
    const volumeLeaders = volumeBreakouts.slice(0, 3).map(v => v.symbol);

    const narrativeParts = [];
    if (topGainer) narrativeParts.push(`🔥 Top gainer: ${topGainer.symbol} (${topGainer.change24h}).`);
    if (oversold.length) narrativeParts.push(`📉 Oversold: ${oversold.map(r => `${r.symbol} RSI${r.rsi}`).join(', ')} — peluang reversal.`);
    if (overbought.length) narrativeParts.push(`📈 Overbought: ${overbought.map(r => r.symbol).join(', ')} — waspada koreksi.`);
    if (volumeLeaders.length) narrativeParts.push(`📊 Volume breakout: ${volumeLeaders.join(', ')}.`);

    res.setHeader('Cache-Control', 's-maxage=60');
    return res.status(200).json({
      timestamp: Date.now(),
      topGainers,
      topLosers: sorted.slice(-10).reverse().map(t => ({
        symbol: t.symbol.replace('USDT', ''),
        price: parseFloat(parseFloat(t.lastPrice).toFixed(6)),
        change24h: parseFloat(parseFloat(t.priceChangePercent).toFixed(2)) + '%',
        volume: Math.round(parseFloat(t.quoteVolume)),
      })),
      volumeBreakouts,
      rsiExtremes: rsiList,
      narrative: narrativeParts.join(' ') || 'Pasar dalam kondisi normal.',
    });

  } catch (e) {
    return res.status(200).json({
      topGainers: [], topLosers: [], volumeBreakouts: [], rsiExtremes: [],
      narrative: 'Data altcoin gagal dimuat: ' + e.message,
    });
  }
}
