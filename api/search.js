// api/search.js — AC369 FUSION v10.6 FINAL
// Multi-source: Futures → Spot → CoinGecko → CryptoCompare
// Full: RSI(Wilder's) + EMA + MACD + BB + ATR + Elliott Wave + SMC + Astro

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const rawSym = (req.query.symbol || req.query.s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!rawSym) return res.status(400).json({ error: 'Parameter symbol diperlukan (contoh: ?symbol=BTC)' });
  const sym = rawSym.replace(/USDT$/, '');

  const sf = async (url, ms = 9000) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try { const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } }); clearTimeout(t); if (!r.ok) return null; return await r.json(); }
    catch { clearTimeout(t); return null; }
  };

  // ── FETCH KLINES (multi-source) ───────────────────────────────
  async function fetchK(interval, limit = 200) {
    const iv = interval;
    let d = await sf(`https://fapi.binance.com/fapi/v1/klines?symbol=${sym}USDT&interval=${iv}&limit=${limit}`);
    if (Array.isArray(d) && d.length > 14) return d.map(k => ({ t: +k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] }));
    d = await sf(`https://api.binance.com/api/v3/klines?symbol=${sym}USDT&interval=${iv}&limit=${limit}`);
    if (Array.isArray(d) && d.length > 14) return d.map(k => ({ t: +k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] }));
    const ccEndp = interval === '1d' ? 'histoday' : 'histohour';
    const ccLim = interval === '4h' ? limit * 4 : limit;
    const ccRes = await sf(`https://min-api.cryptocompare.com/data/v2/${ccEndp}?fsym=${sym}&tsym=USD&limit=${ccLim}`);
    if (ccRes?.Response === 'Success' && ccRes.Data?.Data?.length > 14) {
      let data = ccRes.Data.Data.map(d => ({ t: d.time * 1000, o: d.open, h: d.high, l: d.low, c: d.close, v: d.volumeto }));
      if (interval === '4h') {
        const agg = [];
        for (let i = 0; i + 3 < data.length; i += 4) { const sl = data.slice(i, i + 4); agg.push({ t: sl[0].t, o: sl[0].o, h: Math.max(...sl.map(k => k.h)), l: Math.min(...sl.map(k => k.l)), c: sl[3].c, v: sl.reduce((s, k) => s + k.v, 0) }); }
        return agg;
      }
      return data;
    }
    return [];
  }

  // ── FETCH PRICE ───────────────────────────────────────────────
  async function fetchPrice() {
    let d = await sf(`https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${sym}USDT`);
    if (d?.lastPrice > 0) return { price: +d.lastPrice, change24h: +d.priceChangePercent, vol: +d.quoteVolume, name: sym };
    d = await sf(`https://api.binance.com/api/v3/ticker/24hr?symbol=${sym}USDT`);
    if (d?.lastPrice > 0) return { price: +d.lastPrice, change24h: +d.priceChangePercent, vol: +d.quoteVolume, name: sym };
    const cgIds = { BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', BNB: 'binancecoin', XRP: 'ripple', ADA: 'cardano', AVAX: 'avalanche-2', DOGE: 'dogecoin', DOT: 'polkadot', LINK: 'chainlink', MATIC: 'matic-network', UNI: 'uniswap', ATOM: 'cosmos', NEAR: 'near', ARB: 'arbitrum', OP: 'optimism', SUI: 'sui', APT: 'aptos', INJ: 'injective-protocol', HYPE: 'hyperliquid' };
    const cgId = cgIds[sym] || sym.toLowerCase();
    d = await sf(`https://api.coingecko.com/api/v3/simple/price?ids=${cgId}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true&include_market_cap=true`);
    if (d?.[cgId]?.usd > 0) return { price: d[cgId].usd, change24h: d[cgId].usd_24h_change || 0, vol: d[cgId].usd_24h_vol || 0, name: sym };
    // Search by ticker
    const search = await sf(`https://api.coingecko.com/api/v3/search?query=${sym}`);
    const coin = search?.coins?.[0];
    if (coin) {
      const info = await sf(`https://api.coingecko.com/api/v3/simple/price?ids=${coin.id}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true`);
      if (info?.[coin.id]?.usd > 0) return { price: info[coin.id].usd, change24h: info[coin.id].usd_24h_change || 0, vol: info[coin.id].usd_24h_vol || 0, name: coin.name || sym };
    }
    return null;
  }

  // ── MATH ──────────────────────────────────────────────────────
  const EMA = (c, p) => { if (!c || c.length < p) return c?.[c.length - 1] || 0; const k = 2 / (p + 1); let e = c.slice(0, p).reduce((a, b) => a + b, 0) / p; for (let i = p; i < c.length; i++) e = c[i] * k + e * (1 - k); return e; };
  const SMA = (c, p) => c?.length >= p ? c.slice(-p).reduce((a, b) => a + b, 0) / p : c?.[c.length - 1] || 0;
  const RSI = (c, p = 14) => {
    if (!c || c.length < p + 1) return 50;
    let g = 0, l = 0;
    for (let i = 1; i <= p; i++) { const d = c[i] - c[i - 1]; d >= 0 ? g += d : l -= d; }
    let ag = g / p, al = l / p;
    for (let i = p + 1; i < c.length; i++) { const d = c[i] - c[i - 1]; ag = (ag * (p - 1) + (d >= 0 ? d : 0)) / p; al = (al * (p - 1) + (d < 0 ? -d : 0)) / p; }
    return al === 0 ? 100 : +((100 - 100 / (1 + ag / al)).toFixed(2));
  };
  const ATR = (K, p = 14) => { if (!K || K.length < 2) return 0; const tr = K.slice(1).map((k, i) => Math.max(k.h - k.l, Math.abs(k.h - K[i].c), Math.abs(k.l - K[i].c))); return tr.slice(-p).reduce((a, b) => a + b, 0) / Math.min(p, tr.length); };
  const BB = (c, p = 20) => { if (!c || c.length < p) return { upper: 0, lower: 0, mid: 0, width: 0, position: 50 }; const sl = c.slice(-p), m = sl.reduce((a, b) => a + b, 0) / p; const sd = Math.sqrt(sl.reduce((s, v) => s + (v - m) ** 2, 0) / p); return { upper: +(m + 2 * sd).toFixed(6), lower: +(m - 2 * sd).toFixed(6), mid: +m.toFixed(6), width: +(sd > 0 ? (4 * sd / m) * 100 : 0).toFixed(2), position: +(sd > 0 ? ((c[c.length - 1] - (m - 2 * sd)) / (4 * sd) * 100) : 50).toFixed(1) }; };
  const MACD = (c) => { if (!c || c.length < 35) return { macd: 0, signal: 0, histogram: 0, bullish: false, crossUp: false, crossDown: false }; const k12 = 2 / 13, k26 = 2 / 27, k9 = 2 / 10; let e12 = c.slice(0, 12).reduce((a, b) => a + b, 0) / 12, e26 = c.slice(0, 26).reduce((a, b) => a + b, 0) / 26; const mv = []; for (let i = 26; i < c.length; i++) { e12 = c[i] * k12 + e12 * (1 - k12); e26 = c[i] * k26 + e26 * (1 - k26); mv.push(e12 - e26); } let sig = mv.slice(0, 9).reduce((a, b) => a + b, 0) / 9; for (let i = 9; i < mv.length; i++) sig = mv[i] * k9 + sig * (1 - k9); const ml = mv[mv.length - 1], ph = mv[mv.length - 2] || ml, hist = ml - sig, prevH = ph - sig; return { macd: +ml.toFixed(6), signal: +sig.toFixed(6), histogram: +hist.toFixed(6), bullish: ml > 0 && hist > 0, bearish: ml < 0 && hist < 0, crossUp: hist > 0 && prevH <= 0, crossDown: hist < 0 && prevH >= 0 }; };

  // ── SWING PIVOTS ──────────────────────────────────────────────
  function swingPivots(K, lb = 5) {
    const highs = [], lows = [];
    for (let i = lb; i < K.length - lb; i++) {
      let iH = true, iL = true;
      for (let j = i - lb; j <= i + lb; j++) { if (j === i) continue; if (K[j].h >= K[i].h) iH = false; if (K[j].l <= K[i].l) iL = false; }
      if (iH) highs.push({ i, price: K[i].h, t: K[i].t }); if (iL) lows.push({ i, price: K[i].l, t: K[i].t });
    }
    return { highs, lows };
  }

  // ── ELLIOTT WAVE ──────────────────────────────────────────────
  function calcEW(K, closes, price) {
    if (!K || K.length < 20) return { wave: 'Insufficient Data', confidence: 0, description: 'Data tidak cukup' };
    const { highs, lows } = swingPivots(K, Math.min(5, Math.floor(K.length / 10)));
    const lastHigh = highs[highs.length - 1]?.price || price;
    const lastLow = lows[lows.length - 1]?.price || price * 0.9;
    const secondHigh = highs[highs.length - 2]?.price || lastHigh * 0.95;
    const secondLow = lows[lows.length - 2]?.price || lastLow * 1.05;

    const range = lastHigh - secondLow;
    const retrace = range > 0 ? (lastHigh - price) / range : 0;

    // Fibonacci levels from swing
    const fib = {
      fib236: +(lastHigh - range * 0.236).toFixed(4),
      fib382: +(lastHigh - range * 0.382).toFixed(4),
      fib500: +(lastHigh - range * 0.5).toFixed(4),
      fib618: +(lastHigh - range * 0.618).toFixed(4),
      fib786: +(lastHigh - range * 0.786).toFixed(4),
      ext127: +(secondLow + range * 1.272).toFixed(4),
      ext161: +(secondLow + range * 1.618).toFixed(4),
      ext200: +(secondLow + range * 2.0).toFixed(4),
      ext261: +(secondLow + range * 2.618).toFixed(4),
    };

    // Wave detection
    const rsi4h = RSI(closes.slice(-50), 14);
    let wave, confidence, description;
    if (price > lastHigh * 1.01) { wave = 'Wave 3 (Impulse Up)'; confidence = 78; description = 'Breakout di atas swing high — kemungkinan Wave 3 bullish'; }
    else if (retrace >= 0.236 && retrace <= 0.382 && rsi4h > 50) { wave = 'Wave 3 Developing'; confidence = 72; description = 'Retracement 23.6-38.2%, RSI bullish — setup Wave 3'; }
    else if (retrace >= 0.382 && retrace <= 0.5) { wave = 'Wave 4 (Konsolidasi)'; confidence = 65; description = 'Koreksi 38.2-50% — kemungkinan Wave 4 sebelum Wave 5'; }
    else if (retrace >= 0.5 && retrace <= 0.618) { wave = 'Wave 4/Wave C'; confidence = 60; description = 'Retracement 50-61.8% — transisi bearish atau deep Wave 4'; }
    else if (retrace > 0.618 && rsi4h < 45) { wave = 'Koreksi ABC (Bearish)'; confidence = 68; description = 'Retracement >61.8%, RSI bearish — pola koreksi ABC'; }
    else if (price < lastLow * 0.99) { wave = 'Wave C / Extended Bear'; confidence = 70; description = 'Breakdown di bawah swing low — pola bearish'; }
    else if (retrace < 0.236 && rsi4h > 60) { wave = 'Wave 5 (Puncak)'; confidence = 62; description = 'Retracement minimal, RSI tinggi — kemungkinan akhir wave'; }
    else { wave = 'Wave 1/2 (Early)'; confidence = 55; description = 'Pola awal — belum konfirmasi wave'; }

    return { wave, confidence, description, fibonacci: fib, swingHigh: +lastHigh.toFixed(4), swingLow: +secondLow.toFixed(4) };
  }

  // ── SMC ANALYSIS ──────────────────────────────────────────────
  function calcSMC(K, price) {
    if (!K || K.length < 20) return { signal: 'Neutral', summary: 'Data tidak cukup', bos: null, choch: null };
    const last = K.length - 1;
    const recent = K.slice(-30);

    // BOS/CHoCH detection
    let highs = [], lows = [];
    for (let i = 2; i < recent.length - 2; i++) {
      if (recent[i].h > recent[i - 1].h && recent[i].h > recent[i - 2].h && recent[i].h > recent[i + 1].h && recent[i].h > recent[i + 2].h) highs.push(recent[i].h);
      if (recent[i].l < recent[i - 1].l && recent[i].l < recent[i - 2].l && recent[i].l < recent[i + 1].l && recent[i].l < recent[i + 2].l) lows.push(recent[i].l);
    }
    const lastHH = highs[highs.length - 1], prevHH = highs[highs.length - 2];
    const lastLL = lows[lows.length - 1], prevLL = lows[lows.length - 2];

    let bosType = null;
    if (lastHH && prevHH && lastHH > prevHH) bosType = 'BOS Bullish (HH ' + lastHH.toFixed(4) + ')';
    if (lastLL && prevLL && lastLL < prevLL) bosType = 'BOS Bearish (LL ' + lastLL.toFixed(4) + ')';
    if (lastHH && prevHH && lastHH < prevHH && lastLL && prevLL && lastLL > prevLL) bosType = 'CHoCH Bullish';
    if (lastHH && prevHH && lastHH < prevHH) bosType = 'CHoCH Bearish — Tren berubah';

    // Order Block Detection
    let bullOB = null, bearOB = null;
    for (let i = last - 10; i < last; i++) {
      if (i < 0) continue;
      const candle = K[i], next = K[i + 1];
      if (!next) continue;
      if (candle.c < candle.o && next.c > next.o && next.c > candle.h) { bullOB = { hi: +(candle.o).toFixed(4), lo: +(candle.l).toFixed(4), idx: i }; }
      if (candle.c > candle.o && next.c < next.o && next.c < candle.l) { bearOB = { hi: +(candle.h).toFixed(4), lo: +(candle.c).toFixed(4), idx: i }; }
    }

    // FVG (Fair Value Gap)
    let bullFVG = null, bearFVG = null;
    for (let i = last - 15; i < last - 1; i++) {
      if (i < 1) continue;
      if (K[i + 1].l > K[i - 1].h) bullFVG = { lo: +(K[i - 1].h).toFixed(4), hi: +(K[i + 1].l).toFixed(4) };
      if (K[i + 1].h < K[i - 1].l) bearFVG = { hi: +(K[i - 1].l).toFixed(4), lo: +(K[i + 1].h).toFixed(4) };
    }

    // Liquidity sweep
    let liquiditySweep = null;
    const recentHighs = K.slice(-20).map(k => k.h).sort((a, b) => b - a);
    const recentLows = K.slice(-20).map(k => k.l).sort((a, b) => a - b);
    const prevStructureHigh = recentHighs[2];
    const prevStructureLow = recentLows[2];
    if (K[last].h > prevStructureHigh && K[last].c < prevStructureHigh) liquiditySweep = { type: 'BSL Swept', level: +prevStructureHigh.toFixed(4), detail: 'Liquidity above highs swept — potensi reversal' };
    if (K[last].l < prevStructureLow && K[last].c > prevStructureLow) liquiditySweep = { type: 'SSL Swept', level: +prevStructureLow.toFixed(4), detail: 'Liquidity below lows swept — potensi reversal' };

    // Premium/Discount
    const swingH = Math.max(...K.slice(-50).map(k => k.h));
    const swingL = Math.min(...K.slice(-50).map(k => k.l));
    const equilibrium = (swingH + swingL) / 2;
    const zone = price > equilibrium * 1.05 ? 'Premium Zone — pertimbangkan jual' : price < equilibrium * 0.95 ? 'Discount Zone — pertimbangkan beli' : 'Equilibrium Zone';

    let signal = 'Neutral', summary = '';
    const bullSignals = [bullOB, bullFVG, bosType?.includes('Bullish')].filter(Boolean).length;
    const bearSignals = [bearOB, bearFVG, bosType?.includes('Bearish')].filter(Boolean).length;
    if (bullSignals > bearSignals) { signal = 'Bullish'; summary = `${bosType || 'Tren naik'} | ${zone}`; }
    else if (bearSignals > bullSignals) { signal = 'Bearish'; summary = `${bosType || 'Tren turun'} | ${zone}`; }
    else { signal = 'Neutral'; summary = `${bosType || 'Sideways'} | ${zone}`; }

    return { signal, summary, bos: bosType, bullOB, bearOB, bullFVG, bearFVG, liquiditySweep, zone, equilibrium: +equilibrium.toFixed(4) };
  }

  // ── CHART PATTERNS ────────────────────────────────────────────
  function detectPatterns(K, price) {
    if (!K || K.length < 20) return [];
    const p = [], last = K.length - 1;
    const lc = K[last], plc = K[last - 1], pc = K[last - 2] || K[last - 1];
    const body = Math.abs(lc.c - lc.o), range = lc.h - lc.l;
    const lw = (Math.min(lc.o, lc.c) - lc.l), uw = (lc.h - Math.max(lc.o, lc.c));

    if (range > 0) {
      if (lw / range > 0.6 && body / range < 0.2) { p.push({ name: lc.c >= lc.o ? 'Hammer (Bullish)' : 'Hanging Man (Bearish)', signal: lc.c >= lc.o ? 'bullish' : 'bearish', probability: 68 }); }
      if (uw / range > 0.6 && body / range < 0.2) { p.push({ name: lc.c <= lc.o ? 'Shooting Star (Bearish)' : 'Inverted Hammer (Bullish)', signal: lc.c <= lc.o ? 'bearish' : 'bullish', probability: 67 }); }
      if (body / range < 0.1) { p.push({ name: 'Doji', signal: 'neutral', probability: 50 }); }
      if (lc.c > lc.o && lc.c > plc.h && body / (plc.h - plc.l || 1) > 1.5) { p.push({ name: 'Bullish Engulfing', signal: 'bullish', probability: 75 }); }
      if (lc.c < lc.o && lc.c < plc.l && body / (plc.h - plc.l || 1) > 1.5) { p.push({ name: 'Bearish Engulfing', signal: 'bearish', probability: 73 }); }
      if (plc.c > plc.o && lc.c < lc.o && lc.o > plc.c && lc.c < plc.o) { p.push({ name: 'Bearish Harami / Dark Cloud', signal: 'bearish', probability: 66 }); }
      if (plc.c < plc.o && lc.c > lc.o && lc.o < plc.c && lc.c > plc.o) { p.push({ name: 'Bullish Harami / Piercing', signal: 'bullish', probability: 65 }); }
      if (body / range > 0.8 && lc.c > lc.o) { p.push({ name: 'Strong Bullish Marubozu', signal: 'bullish', probability: 70 }); }
      if (body / range > 0.8 && lc.c < lc.o) { p.push({ name: 'Strong Bearish Marubozu', signal: 'bearish', probability: 70 }); }
    }
    return p.slice(0, 4);
  }

  // ── ASTROLOGY ─────────────────────────────────────────────────
  function calcAstro() {
    const jd = Date.now() / 86400000 + 2440587.5;
    const dnm = ((jd - 2460320.5) % 29.53058867 + 29.53058867) % 29.53058867;
    const halving = new Date('2024-04-20');
    const dsh = Math.floor((Date.now() - halving.getTime()) / 86400000);
    let mp, mi, interp;
    if (dnm < 1.5) { mp = 'New Moon 🌑'; mi = Math.round(dnm / 29.53 * 100); interp = 'New Moon — new cycle begins, accumulation phase'; }
    else if (dnm < 7.5) { mp = 'Waxing Crescent 🌒'; mi = Math.round(dnm / 29.53 * 100); interp = 'Waxing — building momentum'; }
    else if (dnm < 8.5) { mp = 'First Quarter 🌓'; mi = 50; interp = 'First Quarter — testing resistance'; }
    else if (dnm < 14) { mp = 'Waxing Gibbous 🌔'; mi = Math.round(dnm / 29.53 * 100); interp = 'Waxing — approaching peak energy'; }
    else if (dnm < 16) { mp = 'Full Moon 🌕'; mi = 100; interp = 'Full Moon — peak volatility, potential reversal'; }
    else if (dnm < 22) { mp = 'Waning 🌖'; mi = Math.round((29.53 - dnm) / 29.53 * 100); interp = 'Waning — distribution phase'; }
    else { mp = 'Dark Moon 🌘'; mi = Math.round((29.53 - dnm) / 29.53 * 100); interp = 'Dark Moon — final correction, setup for new cycle'; }
    const hp = dsh < 90 ? 'Post-Halving Early' : dsh < 365 ? 'Bull Cycle Early' : dsh < 547 ? 'Bull Cycle Peak' : dsh < 730 ? 'Distribution Phase' : 'Bear Market';
    const signal = dnm < 3 || dnm > 27 ? '🌑 New Cycle — Bullish Setup' : dnm > 13 && dnm < 17 ? '🌕 Full Moon — High Volatility' : dnm < 10 ? '🌒 Waxing — Momentum Building' : '🌘 Waning — Caution';
    return { moonPhase: mp, illumination: mi, halvingPhase: hp, daysSinceHalving: dsh, signal, interpretation: interp };
  }

  // ── TIMEFRAME ANALYSIS ────────────────────────────────────────
  function analyzeTimeframe(K, price) {
    if (!K || K.length < 5) return { rsi: 50, rsiLabel: 'Insufficient', trend: 'NEUTRAL', ema: {}, patterns: [], elliottWave: {}, smc: {} };
    const closes = K.map(k => k.c);
    const rsi = RSI(closes, 14);
    const atr = ATR(K, 14);
    const bb = BB(closes, 20);
    const macd = MACD(closes);
    const n = (p) => Math.min(p, closes.length - 1) || 1;
    const ema20 = EMA(closes, n(20)), ema50 = EMA(closes, n(50)), ema200 = EMA(closes, n(200));
    const ew = calcEW(K, closes, price);
    const smc = calcSMC(K, price);
    const patterns = detectPatterns(K, price);
    const trendScore = (price > ema20 ? 1 : -1) + (price > ema50 ? 1 : -1) + (price > ema200 ? 1 : -1) + (macd.bullish ? 1 : -1) + (rsi > 50 ? 0.5 : -0.5);
    const trend = trendScore >= 3 ? 'BULLISH' : trendScore >= 1 ? 'BULLISH_WEAK' : trendScore <= -3 ? 'BEARISH' : trendScore <= -1 ? 'BEARISH_WEAK' : 'NEUTRAL';
    const rsiLabel = rsi < 25 ? 'Extreme Oversold 🟢' : rsi < 35 ? 'Oversold 🟢' : rsi < 45 ? 'Bearish Zone' : rsi < 55 ? 'Neutral' : rsi < 65 ? 'Bullish Zone' : rsi < 75 ? 'Overbought 🔴' : 'Extreme Overbought 🔴';
    return { rsi, rsiLabel, trend, ema: { ema20: +ema20.toFixed(4), ema50: +ema50.toFixed(4), ema200: +ema200.toFixed(4) }, atr: +atr.toFixed(4), bb, macd, patterns, elliottWave: ew, smc };
  }

  try {
    const tickerData = await fetchPrice();
    if (!tickerData || tickerData.price <= 0) return res.status(404).json({ error: `Koin ${sym} tidak ditemukan. Pastikan simbol benar (contoh: BTC, ETH, SOL, HYPE)` });

    const price = tickerData.price;

    // Fetch all timeframes in parallel
    const [K1h, K4h, K1d] = await Promise.all([
      fetchK('1h', 200), fetchK('4h', 200), fetchK('1d', 200),
    ]);

    const tf1h = analyzeTimeframe(K1h, price);
    const tf4h = analyzeTimeframe(K4h.length > 14 ? K4h : K1h.length > 40 ? (() => { const a = []; for (let i = 0; i + 3 < K1h.length; i += 4) { const s = K1h.slice(i, i + 4); a.push({ t: s[0].t, o: s[0].o, h: Math.max(...s.map(k => k.h)), l: Math.min(...s.map(k => k.l)), c: s[3].c, v: s.reduce((x, k) => x + k.v, 0) }); } return a; })() : K1h, price);
    const tf1d = analyzeTimeframe(K1d.length > 14 ? K1d : K4h.length > 14 ? K4h : K1h, price);

    const astro = calcAstro();
    const K4hBest = K4h.length > 14 ? K4h : K1h;
    const atr4h = ATR(K4hBest, 14);
    const closes4h = K4hBest.map(k => k.c);

    // Support / Resistance
    let support = 0, resistance = 0;
    const { highs, lows } = swingPivots(K4hBest.length > 10 ? K4hBest : K1h, 5);
    const supLevels = lows.map(l => l.price).filter(v => v < price).sort((a, b) => b - a);
    const resLevels = highs.map(h => h.price).filter(v => v > price).sort((a, b) => a - b);
    support = supLevels[0] || price * 0.95;
    resistance = resLevels[0] || price * 1.05;

    // Overall recommendation
    const scores = { '1h': { BULLISH: 2, BULLISH_WEAK: 1, BEARISH: -2, BEARISH_WEAK: -1, NEUTRAL: 0 }[tf1h.trend] || 0, '4h': { BULLISH: 4, BULLISH_WEAK: 2, BEARISH: -4, BEARISH_WEAK: -2, NEUTRAL: 0 }[tf4h.trend] || 0, '1d': { BULLISH: 4, BULLISH_WEAK: 2, BEARISH: -4, BEARISH_WEAK: -2, NEUTRAL: 0 }[tf1d.trend] || 0 };
    const rsiScore = tf4h.rsi < 30 ? 3 : tf4h.rsi < 40 ? 1 : tf4h.rsi > 70 ? -3 : tf4h.rsi > 60 ? -1 : 0;
    const macdScore = tf4h.macd.crossUp ? 2 : tf4h.macd.crossDown ? -2 : tf4h.macd.bullish ? 1 : tf4h.macd.bearish ? -1 : 0;
    const totalScore = scores['1h'] + scores['4h'] + scores['1d'] + rsiScore + macdScore;
    const maxPos = 16;
    const recScore = Math.max(0, Math.min(100, Math.round((totalScore + maxPos) / (2 * maxPos) * 100)));
    let action, explanation, confidence;
    if (recScore >= 72) { action = '🟢 LONG (Buy)'; explanation = `Setup bullish kuat — ${tf4h.trend} pada 4H, RSI ${tf4h.rsi}`; confidence = 'Tinggi'; }
    else if (recScore >= 58) { action = '📈 WATCH (Pantau)'; explanation = `Setup forming, belum konfirm. Tunggu entry yang lebih baik.`; confidence = 'Sedang'; }
    else if (recScore <= 28) { action = '🔴 SHORT (Sell)'; explanation = `Setup bearish kuat — ${tf4h.trend} pada 4H, RSI ${tf4h.rsi}`; confidence = 'Tinggi'; }
    else if (recScore <= 42) { action = '📉 WATCH (Bearish)'; explanation = `Tekanan jual. Hindari buy, atau tunggu reversal.`; confidence = 'Sedang'; }
    else { action = '⚪ HOLD'; explanation = `Market sideways — tidak ada setup jelas`; confidence = 'Rendah'; }

    const reasons = [];
    if (scores['4h'] > 0) reasons.push(`✅ ${tf4h.smc.bos || 'Tren 4H bullish'} | ${tf4h.smc.summary}`);
    if (scores['1d'] > 0) reasons.push(`✅ SMC 1D: ${tf1d.smc.bos || 'Tren 1D positif'} | ${tf1d.smc.summary}`);
    if (scores['4h'] < 0) reasons.push(`❌ ${tf4h.smc.bos || 'Tren 4H bearish'} | ${tf4h.smc.summary}`);
    if (tf4h.rsi < 35) reasons.push(`✅ RSI 4H oversold (${tf4h.rsi}) — setup beli`);
    if (tf4h.rsi > 65) reasons.push(`❌ RSI 4H overbought (${tf4h.rsi}) — setup jual`);
    if (tf4h.macd.crossUp) reasons.push('✅ MACD 4H golden cross');
    if (tf4h.macd.crossDown) reasons.push('❌ MACD 4H death cross');

    // ATR-based trade setup
    let tradeSetup = null;
    if (atr4h > 0) {
      const slD = atr4h * 1.5, tp1 = atr4h * 2.0, tp2 = atr4h * 3.5, tp3 = atr4h * 5.5;
      if (action.includes('LONG')) {
        tradeSetup = { direction: 'LONG', entry: +price.toFixed(4), sl: +(price - slD).toFixed(4), tp1: +(price + tp1).toFixed(4), tp2: +(price + tp2).toFixed(4), tp3: +(price + tp3).toFixed(4), rr: +(tp1 / slD).toFixed(2), slPct: +(slD / price * 100).toFixed(2), tp1Pct: +(tp1 / price * 100).toFixed(2), note: 'Setup berbasis ATR 4H. Sesuaikan dengan market structure.' };
      } else if (action.includes('SHORT')) {
        tradeSetup = { direction: 'SHORT', entry: +price.toFixed(4), sl: +(price + slD).toFixed(4), tp1: +(price - tp1).toFixed(4), tp2: +(price - tp2).toFixed(4), tp3: +(price - tp3).toFixed(4), rr: +(tp1 / slD).toFixed(2), slPct: +(slD / price * 100).toFixed(2), tp1Pct: +(tp1 / price * 100).toFixed(2), note: 'Setup berbasis ATR 4H. Sesuaikan dengan market structure.' };
      }
    }

    res.setHeader('Cache-Control', 's-maxage=30');
    return res.status(200).json({
      symbol: sym, name: tickerData.name || sym,
      price, change24h: +tickerData.change24h.toFixed(2), volume24h: tickerData.vol,
      support: +support.toFixed(4), resistance: +resistance.toFixed(4),
      atr4h: +atr4h.toFixed(4),
      timeframes: { '1H': tf1h, '4H': tf4h, '1D': tf1d },
      recommendation: { action, explanation, score: recScore, confidence, reasons: reasons.slice(0, 5) },
      tradeSetup,
      astrology: astro,
      timestamp: Date.now(),
    });
  } catch (e) {
    return res.status(500).json({ error: e.message, symbol: sym });
  }
}
