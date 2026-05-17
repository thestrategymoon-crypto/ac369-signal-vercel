// api/analytics.js — v15 REBUILT
// ONLY Binance SPOT klines (never blocked on Vercel)
// NO fapi.binance.com — that's BLOCKED
// Max 7 seconds total

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=10');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const t0 = Date.now();

  const sf = async (url, ms) => {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), ms);
    try {
      const r = await fetch(url, { signal: c.signal, headers: { Accept: 'application/json', 'User-Agent': 'AC369/1.0' } });
      clearTimeout(t);
      if (!r.ok) return null;
      return await r.json();
    } catch { clearTimeout(t); return null; }
  };

  // Math helpers
  const EMA = (c, p) => {
    if (!c || c.length < 2) return c?.[c.length - 1] || 0;
    const k = 2 / (p + 1);
    let e = c.slice(0, Math.min(p, c.length)).reduce((a, b) => a + b, 0) / Math.min(p, c.length);
    for (let i = Math.min(p, c.length); i < c.length; i++) e = c[i] * k + e * (1 - k);
    return +e.toFixed(8);
  };

  const RSI = (c, p = 14) => {
    if (!c || c.length < p + 2) return 50;
    let ag = 0, al = 0;
    for (let i = 1; i <= p; i++) { const d = c[i] - c[i - 1]; d >= 0 ? ag += d : al -= d; }
    ag /= p; al /= p;
    for (let i = p + 1; i < c.length; i++) {
      const d = c[i] - c[i - 1];
      ag = (ag * (p - 1) + (d >= 0 ? d : 0)) / p;
      al = (al * (p - 1) + (d < 0 ? -d : 0)) / p;
    }
    return al === 0 ? 100 : +(100 - 100 / (1 + ag / al)).toFixed(2);
  };

  const ATR = (K, p = 14) => {
    if (!K || K.length < 2) return 0;
    const tr = K.slice(1).map((k, i) => Math.max(k.h - k.l, Math.abs(k.h - K[i].c), Math.abs(k.l - K[i].c)));
    return tr.slice(-p).reduce((a, b) => a + b, 0) / Math.min(p, tr.length);
  };

  const MACD = (c) => {
    if (!c || c.length < 35) return { bullish: false, bearish: false, crossUp: false, crossDown: false, histogram: 0 };
    const k12 = 2 / 13, k26 = 2 / 27, k9 = 2 / 10;
    let e12 = c.slice(0, 12).reduce((a, b) => a + b, 0) / 12;
    let e26 = c.slice(0, 26).reduce((a, b) => a + b, 0) / 26;
    const mv = [];
    for (let i = 26; i < c.length; i++) {
      e12 = c[i] * k12 + e12 * (1 - k12);
      e26 = c[i] * k26 + e26 * (1 - k26);
      mv.push(e12 - e26);
    }
    let sig = mv.slice(0, 9).reduce((a, b) => a + b, 0) / 9;
    for (let i = 9; i < mv.length; i++) sig = mv[i] * k9 + sig * (1 - k9);
    const last = mv[mv.length - 1], prev = mv[mv.length - 2] || last;
    const hist = last - sig, prevH = prev - sig;
    return { bullish: last > 0 && hist > 0, bearish: last < 0 && hist < 0, crossUp: hist > 0 && prevH <= 0, crossDown: hist < 0 && prevH >= 0, histogram: +hist.toFixed(8), macd: +last.toFixed(8), signal: +sig.toFixed(8) };
  };

  const BB = (c, p = 20) => {
    if (!c || c.length < p) return { upper: 0, lower: 0, mid: 0, width: 0, position: 50, squeeze: false };
    const sl = c.slice(-p), m = sl.reduce((a, b) => a + b, 0) / p;
    const sd = Math.sqrt(sl.reduce((s, v) => s + (v - m) ** 2, 0) / p);
    const up = m + 2 * sd, dn = m - 2 * sd;
    const last = c[c.length - 1];
    return {
      upper: +up.toFixed(6), lower: +dn.toFixed(6), mid: +m.toFixed(6),
      width: sd > 0 ? +((4 * sd / m) * 100).toFixed(2) : 0,
      position: sd > 0 ? +((last - dn) / (4 * sd) * 100).toFixed(1) : 50,
      squeeze: sd > 0 && (4 * sd / m) * 100 < 3,
    };
  };

  const analyze = (sym, K4h, K1h, ticker) => {
    if (!K4h || K4h.length < 20) return null;
    const c4 = K4h.map(k => k.c);
    const c1 = K1h && K1h.length >= 20 ? K1h.map(k => k.c) : c4;
    const price = ticker?.price || c4[c4.length - 1];
    const ch24  = ticker?.ch24 || 0;
    const vol   = ticker?.vol || 0;

    const rsi4h = RSI(c4, 14);
    const rsi1h = RSI(c1, 14);
    const rsi1d = RSI(c4.filter((_, i) => i % 6 === 0), 14); // 1D approx

    const ema9   = EMA(c4, 9);
    const ema21  = EMA(c4, 21);
    const ema50  = EMA(c4, Math.min(50, c4.length - 1));
    const ema200 = EMA(c4, Math.min(200, c4.length - 1));
    const macd   = MACD(c4);
    const bb4h   = BB(c4, 20);
    const atr4h  = ATR(K4h, 14);

    // Trend score
    let tScore = 0;
    if (price > ema9)   tScore += 1;
    if (price > ema21)  tScore += 1;
    if (price > ema50)  tScore += 1;
    if (price > ema200) tScore += 2;
    if (macd.bullish)   tScore += 1;
    if (rsi4h > 50)     tScore += 1;
    else                tScore -= 1;
    if (macd.crossUp)   tScore += 2;
    if (macd.crossDown) tScore -= 2;

    const action = tScore >= 5 ? 'STRONG BUY' : tScore >= 3 ? 'BUY' : tScore <= -5 ? 'STRONG SELL' : tScore <= -3 ? 'SELL' : 'HOLD';
    const probRaw = Math.min(95, Math.abs(tScore) / 8 * 100);
    const probabilityScore = Math.round(50 + (tScore > 0 ? probRaw : -probRaw) * 0.5);

    // Support / Resistance from recent highs/lows
    const highs = K4h.slice(-30).map(k => k.h).sort((a, b) => b - a);
    const lows  = K4h.slice(-30).map(k => k.l).sort((a, b) => a - b);
    const resistance = highs.find(h => h > price) || price * 1.05;
    const support    = lows.find(l => l < price) || price * 0.95;

    // Pivot points from last candle
    const pv = K4h[K4h.length - 2] || K4h[K4h.length - 1];
    const P  = (pv.h + pv.l + pv.c) / 3;
    const pivot = { P: +P.toFixed(4), R1: +(2*P-pv.l).toFixed(4), R2: +(P+pv.h-pv.l).toFixed(4), S1: +(2*P-pv.h).toFixed(4), S2: +(P-(pv.h-pv.l)).toFixed(4) };

    // Summary text
    const trend4h = tScore >= 3 ? 'BULLISH' : tScore <= -3 ? 'BEARISH' : 'NEUTRAL';
    const parts = [];
    if (trend4h === 'BULLISH') parts.push('Tren 4H bullish — EMA aligned.');
    else if (trend4h === 'BEARISH') parts.push('Tren 4H bearish — tekanan jual.');
    else parts.push('Tren 4H sideways/konsolidasi.');
    if (rsi4h < 30) parts.push(`RSI ${rsi4h} — oversold, potensi reversal.`);
    else if (rsi4h > 70) parts.push(`RSI ${rsi4h} — overbought, waspada koreksi.`);
    else parts.push(`RSI ${rsi4h} — zona normal.`);
    if (macd.crossUp)  parts.push('MACD golden cross ✅');
    if (macd.crossDown) parts.push('MACD death cross ⚠️');
    if (bb4h.squeeze) parts.push('BB squeeze — breakout imminent!');
    parts.push(`EMA 200: $${EMA(c4, Math.min(200, c4.length - 1)).toLocaleString('en-US', { maximumFractionDigits: 2 })}`);

    return {
      symbol: sym + 'USDT', ticker: sym,
      currentPrice: +price.toFixed(8),
      change24h: +ch24.toFixed(2),
      volume24h: +vol.toFixed(0),
      dataSource: 'binance_spot_klines',
      candleCount: K4h.length,
      probabilityScore: Math.max(1, Math.min(99, probabilityScore)),
      confluenceSignal: action.includes('BUY') ? 'Bullish' : action.includes('SELL') ? 'Bearish' : 'Neutral',
      action,
      overallTrend: trend4h,
      technicalSummary: parts.join(' '),
      rsi: { '1h': rsi1h, '4h': rsi4h, '1d': rsi1d },
      maStatus: {
        ema9: +ema9.toFixed(4), ema21: +ema21.toFixed(4),
        ema50: +ema50.toFixed(4), ema200: +ema200.toFixed(4),
        position: price > ema200 ? `Above EMA200 (+${((price-ema200)/ema200*100).toFixed(1)}%)` : `Below EMA200 (${((price-ema200)/ema200*100).toFixed(1)}%)`,
      },
      macd: { '4h': macd },
      bb: { '4h': bb4h, squeeze: bb4h.squeeze },
      atr: { '4h': +atr4h.toFixed(6), atrPct: +(atr4h/price*100).toFixed(2), volatility: atr4h/price*100 > 5 ? 'HIGH' : atr4h/price*100 > 2 ? 'MEDIUM' : 'LOW' },
      keyLevels: { support: +support.toFixed(4), resistance: +resistance.toFixed(4) },
      pivotPoints: { '4H': pivot },
      trends: { '1h': rsi1h > 55 ? 'BULLISH' : rsi1h < 45 ? 'BEARISH' : 'NEUTRAL', '4h': trend4h, '1d': trend4h, overall: trend4h },
      scoreBreakdown: { tScore, bullPct: Math.max(1, Math.min(99, 50 + tScore * 6)) },
    };
  };

  try {
    // Fetch BTC 4H, ETH 4H, BTC 1H, ETH 1H, all tickers — all parallel
    const [btcK4R, ethK4R, btcK1R, ethK1R, tickersR] = await Promise.allSettled([
      sf('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=4h&limit=100', 6000),
      sf('https://api.binance.com/api/v3/klines?symbol=ETHUSDT&interval=4h&limit=100', 6000),
      sf('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=48', 5000),
      sf('https://api.binance.com/api/v3/klines?symbol=ETHUSDT&interval=1h&limit=48', 5000),
      sf('https://api.binance.com/api/v3/ticker/24hr', 7000),
    ]);

    const toK = arr => Array.isArray(arr) ? arr.map(k => ({ t: +k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] })) : [];

    const btcK4 = btcK4R.status === 'fulfilled' ? toK(btcK4R.value) : [];
    const ethK4 = ethK4R.status === 'fulfilled' ? toK(ethK4R.value) : [];
    const btcK1 = btcK1R.status === 'fulfilled' ? toK(btcK1R.value) : [];
    const ethK1 = ethK1R.status === 'fulfilled' ? toK(ethK1R.value) : [];
    const allT  = tickersR.status === 'fulfilled' && Array.isArray(tickersR.value) ? tickersR.value : [];

    const tMap = {};
    allT.forEach(t => { tMap[t.symbol] = { price: +t.lastPrice, ch24: +t.priceChangePercent, vol: +t.quoteVolume }; });

    const btcData = btcK4.length >= 20 ? analyze('BTC', btcK4, btcK1, tMap['BTCUSDT']) : null;
    const ethData = ethK4.length >= 20 ? analyze('ETH', ethK4, ethK1, tMap['ETHUSDT']) : null;

    // Smart money narrative
    let narrative = 'Analisis teknikal sedang diproses...';
    if (btcData) {
      const lines = [];
      const bt = btcData.overallTrend, et = ethData?.overallTrend;
      if (bt === 'BULLISH' && et === 'BULLISH') lines.push('🟢 BTC & ETH keduanya bullish — kondisi risk-on aktif, altcoin berpeluang follow.');
      else if (bt === 'BULLISH')  lines.push('📈 BTC bullish tapi ETH masih laggard — rotasi ke altcoin belum penuh.');
      else if (bt === 'BEARISH')  lines.push('🔴 BTC bearish — smart money distribusi. Risk management ketat.');
      else                        lines.push('⚖️ Market dalam fase konsolidasi. Tunggu konfirmasi breakout.');
      const r = btcData.rsi?.['4h'] || 50;
      if (r < 30) lines.push(`RSI BTC oversold (${r}) — zona akumulasi institusional.`);
      else if (r > 70) lines.push(`RSI BTC overbought (${r}) — potensi profit taking.`);
      if (btcData.macd?.['4h']?.crossUp)   lines.push('MACD BTC golden cross — momentum bullish baru dimulai.');
      if (btcData.macd?.['4h']?.crossDown) lines.push('MACD BTC death cross — waspadai penurunan lanjutan.');
      if (btcData.bb?.['4h']?.squeeze)     lines.push('BB squeeze — ekspansi volatilitas besar akan segera terjadi.');
      narrative = lines.join(' ');
    }

    return res.status(200).json({
      ok: true, ts: Date.now(), elapsed: Date.now() - t0, version: 'v15',
      btc: btcData, eth: ethData,
      smartMoneyNarrative: narrative,
    });

  } catch (e) {
    return res.status(200).json({
      ok: false, error: e.message, ts: Date.now(), version: 'v15',
      btc: null, eth: null, smartMoneyNarrative: 'Error: ' + e.message,
    });
  }
}
