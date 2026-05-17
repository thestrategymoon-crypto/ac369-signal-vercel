// api/analytics.js — AC369 FUSION v13 REBUILT
// CryptoCompare primary for klines (never blocked), Bybit for price

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=30');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const sf = async (url, ms = 6000) => {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), ms);
    try {
      const r = await fetch(url, { signal: c.signal, headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } });
      clearTimeout(t); if (!r.ok) return null; return await r.json();
    } catch { clearTimeout(t); return null; }
  };

  async function fetchTicker(sym) {
    // Try Binance spot all-tickers (reliable), then Bybit, then CryptoCompare
    const [allR, byR, ccR] = await Promise.allSettled([
      sf('https://api.binance.com/api/v3/ticker/24hr', 8000).then(d => Array.isArray(d) ? d.find(t => t.symbol === sym + 'USDT') || null : null),
      sf(`https://api.bybit.com/v5/market/tickers?category=spot&symbol=${sym}USDT`, 5000),
      sf(`https://min-api.cryptocompare.com/data/pricemultifull?fsyms=${sym}&tsyms=USD`, 5000),
    ]);
    const all = allR.value, by = byR.value, cc = ccR.value;
    if (all && +all.lastPrice > 0) return { price: +all.lastPrice, change24h: +all.priceChangePercent, vol: +all.quoteVolume, src: 'binance_spot' };
    const byt = by?.result?.list?.[0];
    if (byt && +byt.lastPrice > 0) return { price: +byt.lastPrice, change24h: byt.price24hPcnt ? +(+byt.price24hPcnt * 100) : 0, vol: +(byt.turnover24h || 0), src: 'bybit' };
    if (cc?.RAW?.[sym]?.USD?.PRICE > 0) { const d = cc.RAW[sym].USD; return { price: d.PRICE, change24h: d.CHANGEPCT24HOUR || 0, vol: d.TOTALVOLUME24HTO || 0, src: 'cryptocompare' }; }
    return null;
  }

  async function fetchKlines(sym, limit = 200) {
    // CryptoCompare hourly → aggregate to 4H (always works)
    const cc = await sf(`https://min-api.cryptocompare.com/data/v2/histohour?fsym=${sym}&tsym=USD&limit=${limit}`, 6000);
    if (cc?.Response === 'Success' && cc.Data?.Data?.length >= 30) {
      const raw = cc.Data.Data.filter(d => d.close > 0);
      const agg4h = [];
      for (let i = 0; i + 3 < raw.length; i += 4) {
        const sl = raw.slice(i, i + 4);
        agg4h.push({ t: sl[0].time * 1000, o: sl[0].open, h: Math.max(...sl.map(k => k.high)), l: Math.min(...sl.map(k => k.low)), c: sl[3].close, v: sl.reduce((s, k) => s + k.volumeto, 0) });
      }
      return { h1: raw.map(d => ({ t: d.time * 1000, o: d.open, h: d.high, l: d.low, c: d.close, v: d.volumeto })), h4: agg4h, src: 'cryptocompare' };
    }
    // Binance spot fallback
    const [k1h, k4h] = await Promise.allSettled([
      sf(`https://api.binance.com/api/v3/klines?symbol=${sym}USDT&interval=1h&limit=200`, 5000),
      sf(`https://api.binance.com/api/v3/klines?symbol=${sym}USDT&interval=4h&limit=100`, 5000),
    ]);
    const h1 = k1h.status === 'fulfilled' && Array.isArray(k1h.value) ? k1h.value.map(k => ({ t: +k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] })) : [];
    const h4 = k4h.status === 'fulfilled' && Array.isArray(k4h.value) ? k4h.value.map(k => ({ t: +k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] })) : [];
    return { h1, h4, src: 'binance' };
  }

  function EMA(c, p) { if (!c || c.length < 2) return c?.[c.length - 1] || 0; const k = 2 / (p + 1); let e = c.slice(0, Math.min(p, c.length)).reduce((a, b) => a + b, 0) / Math.min(p, c.length); for (let i = Math.min(p, c.length); i < c.length; i++) e = c[i] * k + e * (1 - k); return e; }
  function RSI(c, p = 14) { if (!c || c.length < p + 1) return 50; let g = 0, l = 0; for (let i = 1; i <= p; i++) { const d = c[i] - c[i - 1]; d >= 0 ? g += d : l -= d; } let ag = g / p, al = l / p; for (let i = p + 1; i < c.length; i++) { const d = c[i] - c[i - 1]; ag = (ag * (p - 1) + (d >= 0 ? d : 0)) / p; al = (al * (p - 1) + (d < 0 ? -d : 0)) / p; } return al === 0 ? 100 : +((100 - 100 / (1 + ag / al)).toFixed(2)); }
  function ATR(K, p = 14) { if (!K || K.length < 2) return 0; const tr = K.slice(1).map((k, i) => Math.max(k.h - k.l, Math.abs(k.h - K[i].c), Math.abs(k.l - K[i].c))); return tr.slice(-p).reduce((a, b) => a + b, 0) / Math.min(p, tr.length); }
  function BB(c, p = 20) { if (!c || c.length < p) return { upper: 0, lower: 0, mid: 0, width: 0, position: 50, squeeze: false }; const sl = c.slice(-p), m = sl.reduce((a, b) => a + b, 0) / p; const sd = Math.sqrt(sl.reduce((s, v) => s + (v - m) ** 2, 0) / p); const up = m + 2 * sd, dn = m - 2 * sd; return { upper: +up.toFixed(6), lower: +dn.toFixed(6), mid: +m.toFixed(6), width: +(sd > 0 ? (4 * sd / m) * 100 : 0).toFixed(2), position: +(sd > 0 ? ((c[c.length - 1] - dn) / (4 * sd) * 100) : 50).toFixed(1), squeeze: sd > 0 && (4 * sd / m) * 100 < 3 }; }
  function MACD(c) { if (!c || c.length < 35) return { macd: 0, signal: 0, histogram: 0, bullish: false, bearish: false, crossUp: false, crossDown: false }; const k12 = 2 / 13, k26 = 2 / 27, k9 = 2 / 10; let e12 = c.slice(0, 12).reduce((a, b) => a + b, 0) / 12, e26 = c.slice(0, 26).reduce((a, b) => a + b, 0) / 26; const mv = []; for (let i = 26; i < c.length; i++) { e12 = c[i] * k12 + e12 * (1 - k12); e26 = c[i] * k26 + e26 * (1 - k26); mv.push(e12 - e26); } let sig = mv.slice(0, 9).reduce((a, b) => a + b, 0) / 9; for (let i = 9; i < mv.length; i++) sig = mv[i] * k9 + sig * (1 - k9); const ml = mv[mv.length - 1], ph = mv[mv.length - 2] || ml, hist = ml - sig, prevH = ph - sig; return { macd: +ml.toFixed(6), signal: +sig.toFixed(6), histogram: +hist.toFixed(6), bullish: ml > 0 && hist > 0, bearish: ml < 0 && hist < 0, crossUp: hist > 0 && prevH <= 0, crossDown: hist < 0 && prevH >= 0 }; }
  function findSR(K, price) { const hh = [], ll = []; for (let i = 3; i < K.length - 3; i++) { let iH = true, iL = true; for (let j = i - 3; j <= i + 3; j++) { if (j === i) continue; if (K[j].h >= K[i].h) iH = false; if (K[j].l <= K[i].l) iL = false; } if (iH) hh.push(K[i].h); if (iL) ll.push(K[i].l); } return { resistance: hh.filter(h => h > price).sort((a, b) => a - b).slice(0, 3), support: ll.filter(l => l < price).sort((a, b) => b - a).slice(0, 3) }; }

  async function analyzeAsset(sym) {
    const errReturn = msg => ({ symbol: sym + 'USDT', ticker: sym, currentPrice: 0, change24h: 0, dataSource: 'error', probabilityScore: 50, confluenceSignal: 'Neutral', action: 'HOLD', overallTrend: 'NEUTRAL', technicalSummary: msg, rsi: { '1h': 50, '4h': 50, '1d': 50 }, maStatus: { position: 'N/A' }, macd: {}, bb: {}, atr: {}, keyLevels: { support: 0, resistance: 0, supportLevels: [], resistanceLevels: [] }, trends: { '1h': 'NEUTRAL', '4h': 'NEUTRAL', '1d': 'NEUTRAL', overall: 'NEUTRAL' }, scoreBreakdown: { bull: 0, bear: 0, total: 0, bullPct: 50 }, pivots: null });
    try {
      const [ticker, klData] = await Promise.all([fetchTicker(sym), fetchKlines(sym, 200)]);
      if (!ticker || ticker.price <= 0) return errReturn('No price data');
      const price = ticker.price;
      const K4h = klData.h4.length >= 30 ? klData.h4 : klData.h1.length >= 40 ? (() => { const a = []; for (let i = 0; i + 3 < klData.h1.length; i += 4) { const sl = klData.h1.slice(i, i + 4); a.push({ t: sl[0].t, o: sl[0].o, h: Math.max(...sl.map(k => k.h)), l: Math.min(...sl.map(k => k.l)), c: sl[3].c, v: sl.reduce((s, k) => s + k.v, 0) }); } return a; })() : [];
      const K1h = klData.h1, K1d = K4h; // use 4H as daily proxy if no daily data
      if (K4h.length < 15) return errReturn('Data tidak cukup');
      const c4h = K4h.map(k => k.c), c1h = K1h.map(k => k.c);
      const rsi4h = RSI(c4h, 14), rsi1h = K1h.length >= 15 ? RSI(c1h, 14) : rsi4h, rsi1d = rsi4h;
      const ne = (arr, p) => Math.min(p, arr.length - 1) || 1;
      const ema20_4h = EMA(c4h, ne(c4h, 20)), ema50_4h = EMA(c4h, ne(c4h, 50)), ema200_4h = EMA(c4h, ne(c4h, Math.min(200, c4h.length)));
      const bb4h = BB(c4h, ne(c4h, 20)), atr4h = ATR(K4h, 14), macd4h = MACD(c4h);
      const ts4h = (price > ema20_4h ? 2 : -2) + (price > ema50_4h ? 2 : -2) + (price > ema200_4h ? 2 : -2) + (macd4h.bullish ? 1 : -1) + (rsi4h > 50 ? 0.5 : -0.5);
      const ts1h = K1h.length >= 20 ? (price > EMA(c1h, ne(c1h, 9)) ? 1 : -1) + (price > EMA(c1h, ne(c1h, 21)) ? 1 : -1) + (rsi1h > 50 ? 0.5 : -0.5) : ts4h * 0.5;
      const gt = s => s > 3 ? 'BULLISH' : s > 0 ? 'BULLISH_WEAK' : s < -3 ? 'BEARISH' : s < 0 ? 'BEARISH_WEAK' : 'NEUTRAL';
      const t4h = gt(ts4h), t1h = gt(ts1h), overall = gt(ts1h * 0.3 + ts4h * 0.7);
      const sr = K4h.length >= 15 ? findSR(K4h, price) : { resistance: [], support: [] };
      const sup = sr.support[0] || +(price * 0.95).toFixed(4), res = sr.resistance[0] || +(price * 1.05).toFixed(4);
      let bs = 0, br = 0;
      if (t4h === 'BULLISH') bs += 15; else if (t4h === 'BEARISH') br += 15; else if (t4h === 'BULLISH_WEAK') bs += 7; else br += 7;
      if (t1h === 'BULLISH') bs += 8; else if (t1h === 'BEARISH') br += 8;
      if (rsi4h < 30) bs += 15; else if (rsi4h > 70) br += 15; else if (rsi4h < 45) bs += 5; else if (rsi4h > 55) br += 5;
      if (macd4h.bullish) bs += 10; else if (macd4h.bearish) br += 10;
      if (macd4h.crossUp) bs += 5; else if (macd4h.crossDown) br += 5;
      if (bb4h.position < 15) bs += 10; else if (bb4h.position > 85) br += 10;
      if (ticker.change24h > 3) bs += 5; else if (ticker.change24h < -3) br += 5;
      const tot = bs + br;
      const prob = Math.min(95, tot > 0 ? Math.round(Math.max(bs, br) / tot * 100) : 50);
      const sig = bs > br ? (prob >= 65 ? 'Strong Buy' : 'Buy') : br > bs ? (prob >= 65 ? 'Strong Sell' : 'Sell') : 'Neutral';
      const maPct = ema200_4h > 0 ? ((price - ema200_4h) / ema200_4h * 100).toFixed(1) : '0';
      let pivot = null;
      if (K4h.length >= 2) { const pv = K4h[K4h.length - 2], P = (pv.h + pv.l + pv.c) / 3; pivot = { P: +P.toFixed(4), R1: +(2*P-pv.l).toFixed(4), R2: +(P+pv.h-pv.l).toFixed(4), S1: +(2*P-pv.h).toFixed(4), S2: +(P-(pv.h-pv.l)).toFixed(4) }; }
      const parts = [
        overall === 'BULLISH' ? 'Tren bullish — multi-TF aligned.' : overall === 'BEARISH' ? 'Tren bearish — tekanan jual dominan.' : 'Tren mixed.',
        rsi4h < 30 ? `RSI 4H oversold (${rsi4h}) — potensi reversal.` : rsi4h > 70 ? `RSI 4H overbought (${rsi4h}) — waspada.` : `RSI 4H: ${rsi4h}.`,
        macd4h.crossUp ? 'MACD golden cross.' : macd4h.crossDown ? 'MACD death cross.' : macd4h.bullish ? 'MACD bullish.' : 'MACD bearish.',
        bb4h.squeeze ? 'BB squeeze — breakout imminent.' : '',
        `Data: ${K4h.length} candles 4H (${klData.src}).`,
      ].filter(Boolean).join(' ');
      return {
        symbol: sym + 'USDT', ticker: sym, currentPrice: +price.toFixed(4), change24h: +ticker.change24h.toFixed(2),
        dataSource: klData.src, candleCount: K4h.length,
        probabilityScore: prob, confluenceSignal: sig,
        action: sig.includes('Buy') ? 'BUY' : sig.includes('Sell') ? 'SELL' : 'HOLD',
        overallTrend: overall, technicalSummary: parts,
        rsi: { '1h': rsi1h, '4h': rsi4h, '1d': rsi1d },
        maStatus: { position: ema200_4h > 0 ? (price > ema200_4h ? `Above EMA200 (+${maPct}%)` : `Below EMA200 (${maPct}%)`) : 'Calculating...', ema20_4h: +ema20_4h.toFixed(4), ema50_4h: +ema50_4h.toFixed(4), ema200_4h: +ema200_4h.toFixed(4) },
        macd: { '4h': macd4h }, bb: { '4h': bb4h, squeeze: bb4h.squeeze },
        atr: { '4h': +atr4h.toFixed(4), atrPct: +(atr4h / price * 100).toFixed(2), volatility: atr4h / price * 100 > 5 ? 'HIGH' : atr4h / price * 100 > 2 ? 'MEDIUM' : 'LOW' },
        keyLevels: { support: +sup.toFixed(4), resistance: +res.toFixed(4), supportLevels: sr.support.slice(0, 2).map(s => +s.toFixed(4)), resistanceLevels: sr.resistance.slice(0, 2).map(r => +r.toFixed(4)) },
        pivots: pivot, trends: { '1h': t1h, '4h': t4h, '1d': t4h, overall, scores: { ts1h: +ts1h.toFixed(2), ts4h: +ts4h.toFixed(2) } },
        scoreBreakdown: { bull: bs, bear: br, total: tot, bullPct: Math.min(95, tot > 0 ? Math.round(bs / tot * 100) : 50) },
      };
    } catch (e) { return errReturn('Error: ' + e.message); }
  }

  try {
    const [btcData, ethData] = await Promise.all([analyzeAsset('BTC'), analyzeAsset('ETH')]);
    let narrative = 'Data pasar sedang dimuat...';
    if (btcData && btcData.currentPrice > 0) {
      const p = [];
      if (btcData.overallTrend === 'BULLISH' && ethData?.overallTrend === 'BULLISH') p.push('BTC & ETH keduanya bullish — risk-on aktif, kondisi baik untuk altcoin.');
      else if (btcData.overallTrend === 'BULLISH') p.push('BTC bullish, ETH masih laggard — rotasi ke altcoin belum dimulai sepenuhnya.');
      else if (btcData.overallTrend === 'BEARISH') p.push('BTC bearish — smart money distribusi, manajemen risiko ketat.');
      else p.push('Market transisi — tunggu konfirmasi tren.');
      const r = btcData.rsi?.['4h'] || 50;
      if (r < 30) p.push(`RSI BTC oversold (${r}) — zona akumulasi institusional.`);
      else if (r > 70) p.push(`RSI BTC overbought (${r}) — potensi distribusi.`);
      if (btcData.macd?.['4h']?.crossUp) p.push('MACD BTC golden cross — momentum bullish baru.');
      if (btcData.macd?.['4h']?.crossDown) p.push('MACD BTC death cross — momentum bearish.');
      if (btcData.bb?.['4h']?.squeeze) p.push('BB squeeze — ekspansi volatilitas imminent.');
      narrative = p.join(' ') || 'Pasar dalam kondisi normal.';
    }
    return res.status(200).json({ btc: btcData, eth: ethData, smartMoneyNarrative: narrative, timestamp: Date.now(), version: 'v13' });
  } catch (e) {
    return res.status(200).json({ error: e.message, btc: null, eth: null, version: 'v13' });
  }
}
