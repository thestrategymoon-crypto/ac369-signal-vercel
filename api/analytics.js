// api/analytics.js — AC369 FUSION v12.1
// FIX: CryptoCompare as klines primary (Binance Futures blocked on Vercel)
// FIX: Minimum 30 candle guard (prevents 100% fake score from 4 candles)
// FIX: Remove [Sumber: coingecko] from narrative
// Returns: { btc:{currentPrice,...}, eth:{currentPrice,...}, smartMoneyNarrative }

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const [btcData, ethData] = await Promise.all([
      analyzeAsset('BTC'),
      analyzeAsset('ETH'),
    ]);

    res.setHeader('Cache-Control', 's-maxage=30');
    return res.status(200).json({
      btc: btcData,
      eth: ethData,
      smartMoneyNarrative: buildNarrative(btcData, ethData),
      timestamp: Date.now(),
    });
  } catch (e) {
    return res.status(500).json({ error: e.message, btc: null, eth: null });
  }
}

// ── SAFE FETCH ────────────────────────────────────────────────
async function sf(url, ms = 6000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
    });
    clearTimeout(t);
    if (!r.ok) return null;
    return await r.json();
  } catch { clearTimeout(t); return null; }
}

// ── FETCH TICKER ──────────────────────────────────────────────
// FIX: All 5 sources fetched in PARALLEL — fastest wins (not sequential)
async function fetchTicker(sym) {
  const cgId = { BTC: 'bitcoin', ETH: 'ethereum' }[sym];
  const [fR, sR, ccR, cgR, capR] = await Promise.allSettled([
    sf('https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=' + sym + 'USDT', 6000),
    sf('https://api.binance.com/api/v3/ticker/24hr?symbol=' + sym + 'USDT', 6000),
    sf('https://min-api.cryptocompare.com/data/pricemultifull?fsyms=' + sym + '&tsyms=USD', 6000),
    cgId ? sf('https://api.coingecko.com/api/v3/simple/price?ids=' + cgId + '&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true', 6000) : Promise.resolve(null),
    cgId ? sf('https://api.coincap.io/v2/assets/' + cgId, 6000) : Promise.resolve(null),
  ]);
  const f=fR.value, s=sR.value, cc=ccR.value, cg=cgR.value, cap=capR.value;
  if (f && !f.code && +f.lastPrice > 0) return { price: +f.lastPrice, change24h: +f.priceChangePercent, vol: +f.quoteVolume, src: 'binance_futures' };
  if (s && !s.code && +s.lastPrice > 0) return { price: +s.lastPrice, change24h: +s.priceChangePercent, vol: +s.quoteVolume, src: 'binance_spot' };
  if (cc?.RAW?.[sym]?.USD?.PRICE > 0) { const d=cc.RAW[sym].USD; return { price: d.PRICE, change24h: d.CHANGEPCT24HOUR||0, vol: d.TOTALVOLUME24HTO||0, src: 'cryptocompare' }; }
  if (cgId && cg?.[cgId]?.usd > 0) return { price: cg[cgId].usd, change24h: cg[cgId].usd_24h_change||0, vol: cg[cgId].usd_24h_vol||0, src: 'coingecko' };
  if (cgId && cap?.data?.priceUsd > 0) return { price: +cap.data.priceUsd, change24h: +(cap.data.changePercent24Hr||0), vol: +(cap.data.volumeUsd24Hr||0), src: 'coincap' };
  return null;
}

// ── FETCH KLINES (CryptoCompare FIRST — always accessible) ────
async function fetchKlines(sym, interval, limit = 200) {
  // ── PRIORITY 1: CryptoCompare (never blocked by Vercel) ──────
  const ccEndp = interval === '1d' ? 'histoday' : 'histohour';
  const ccLimit = interval === '4h' ? limit * 4 : limit;
  const ccRes = await sf(`https://min-api.cryptocompare.com/data/v2/${ccEndp}?fsym=${sym}&tsym=USD&limit=${ccLimit}`);
  if (ccRes?.Response === 'Success' && ccRes.Data?.Data?.length >= 30) {
    let data = ccRes.Data.Data
      .filter(d => d.close > 0)
      .map(d => ({ t: d.time * 1000, o: d.open, h: d.high, l: d.low, c: d.close, v: d.volumeto }));
    if (interval === '4h') {
      const agg = [];
      for (let i = 0; i + 3 < data.length; i += 4) {
        const sl = data.slice(i, i + 4);
        agg.push({ t: sl[0].t, o: sl[0].o, h: Math.max(...sl.map(k => k.h)), l: Math.min(...sl.map(k => k.l)), c: sl[3].c, v: sl.reduce((s, k) => s + k.v, 0) });
      }
      return agg;
    }
    return data;
  }

  // ── PRIORITY 2: Binance Futures ───────────────────────────────
  const iv = interval;
  let d = await sf(`https://fapi.binance.com/fapi/v1/klines?symbol=${sym}USDT&interval=${iv}&limit=${limit}`);
  if (Array.isArray(d) && d.length >= 30) return d.map(k => ({ t: +k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] }));

  // ── PRIORITY 3: Binance Spot ─────────────────────────────────
  d = await sf(`https://api.binance.com/api/v3/klines?symbol=${sym}USDT&interval=${iv}&limit=${limit}`);
  if (Array.isArray(d) && d.length >= 30) return d.map(k => ({ t: +k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] }));

  // ── PRIORITY 4: CoinGecko OHLC (min 10 candles) ──────────────
  const cgId = { BTC: 'bitcoin', ETH: 'ethereum' }[sym];
  if (cgId) {
    const days = interval === '1d' ? 90 : interval === '4h' ? 30 : 14;
    const cg = await sf(`https://api.coingecko.com/api/v3/coins/${cgId}/ohlc?vs_currency=usd&days=${days}`);
    if (Array.isArray(cg) && cg.length >= 10) return cg.map(d => ({ t: d[0], o: d[1], h: d[2], l: d[3], c: d[4], v: 0 }));
  }
  return [];
}

// ── MATH ──────────────────────────────────────────────────────
function EMA(c, p) {
  if (!c || c.length < p) return c?.[c.length - 1] || 0;
  const k = 2 / (p + 1); let e = c.slice(0, p).reduce((a, b) => a + b, 0) / p;
  for (let i = p; i < c.length; i++) e = c[i] * k + e * (1 - k); return e;
}
function SMA(c, p) { return c && c.length >= p ? c.slice(-p).reduce((a, b) => a + b, 0) / p : c?.[c.length - 1] || 0; }
function RSI(c, p = 14) {
  if (!c || c.length < p + 1) return 50;
  let g = 0, l = 0;
  for (let i = 1; i <= p; i++) { const d = c[i] - c[i - 1]; d >= 0 ? g += d : l -= d; }
  let ag = g / p, al = l / p;
  for (let i = p + 1; i < c.length; i++) { const d = c[i] - c[i - 1]; ag = (ag * (p - 1) + (d >= 0 ? d : 0)) / p; al = (al * (p - 1) + (d < 0 ? -d : 0)) / p; }
  return al === 0 ? 100 : +((100 - 100 / (1 + ag / al)).toFixed(2));
}
function ATR(K, p = 14) {
  if (!K || K.length < 2) return 0;
  const tr = K.slice(1).map((k, i) => Math.max(k.h - k.l, Math.abs(k.h - K[i].c), Math.abs(k.l - K[i].c)));
  return tr.slice(-p).reduce((a, b) => a + b, 0) / Math.min(p, tr.length);
}
function BB(c, p = 20) {
  if (!c || c.length < p) return { upper: 0, lower: 0, mid: 0, width: 0, position: 50, squeeze: false };
  const sl = c.slice(-p), m = sl.reduce((a, b) => a + b, 0) / p;
  const sd = Math.sqrt(sl.reduce((s, v) => s + (v - m) ** 2, 0) / p);
  const up = m + 2 * sd, dn = m - 2 * sd;
  return { upper: +up.toFixed(6), lower: +dn.toFixed(6), mid: +m.toFixed(6), width: +(sd > 0 ? (4 * sd / m) * 100 : 0).toFixed(2), position: +(sd > 0 ? ((c[c.length - 1] - dn) / (4 * sd) * 100) : 50).toFixed(1), squeeze: sd > 0 && (4 * sd / m) * 100 < 3 };
}
function MACD(c) {
  if (!c || c.length < 35) return { macd: 0, signal: 0, histogram: 0, bullish: false, bearish: false, crossUp: false, crossDown: false };
  const k12 = 2 / 13, k26 = 2 / 27, k9 = 2 / 10;
  let e12 = c.slice(0, 12).reduce((a, b) => a + b, 0) / 12, e26 = c.slice(0, 26).reduce((a, b) => a + b, 0) / 26;
  const mv = [];
  for (let i = 26; i < c.length; i++) { e12 = c[i] * k12 + e12 * (1 - k12); e26 = c[i] * k26 + e26 * (1 - k26); mv.push(e12 - e26); }
  let sig = mv.slice(0, 9).reduce((a, b) => a + b, 0) / 9;
  for (let i = 9; i < mv.length; i++) sig = mv[i] * k9 + sig * (1 - k9);
  const ml = mv[mv.length - 1], ph = mv[mv.length - 2] || ml, hist = ml - sig, prevH = ph - sig;
  return { macd: +ml.toFixed(6), signal: +sig.toFixed(6), histogram: +hist.toFixed(6), bullish: ml > 0 && hist > 0, bearish: ml < 0 && hist < 0, crossUp: hist > 0 && prevH <= 0, crossDown: hist < 0 && prevH >= 0 };
}
function findSR(K, price, lb = 5) {
  const hh = [], ll = [];
  for (let i = lb; i < K.length - lb; i++) {
    let iH = true, iL = true;
    for (let j = i - lb; j <= i + lb; j++) { if (j === i) continue; if (K[j].h >= K[i].h) iH = false; if (K[j].l <= K[i].l) iL = false; }
    if (iH) hh.push(K[i].h); if (iL) ll.push(K[i].l);
  }
  return { resistance: hh.filter(h => h > price).sort((a, b) => a - b).slice(0, 3), support: ll.filter(l => l < price).sort((a, b) => b - a).slice(0, 3) };
}
function build4hFrom1h(K) {
  const out = [];
  for (let i = 0; i + 3 < K.length; i += 4) { const sl = K.slice(i, i + 4); out.push({ t: sl[0].t, o: sl[0].o, h: Math.max(...sl.map(k => k.h)), l: Math.min(...sl.map(k => k.l)), c: sl[3].c, v: sl.reduce((s, k) => s + k.v, 0) }); }
  return out;
}

// ── MAIN ANALYSIS ─────────────────────────────────────────────
async function analyzeAsset(sym) {
  const errReturn = (msg) => ({
    symbol: sym + 'USDT', ticker: sym, currentPrice: 0, change24h: 0, dataSource: 'error',
    probabilityScore: 50, confluenceSignal: 'Neutral', action: 'HOLD', overallTrend: 'NEUTRAL',
    technicalSummary: msg, rsi: { '1h': 50, '4h': 50, '1d': 50 },
    maStatus: { position: 'N/A' }, macd: {}, bb: {}, atr: {},
    keyLevels: { support: 0, resistance: 0, supportLevels: [], resistanceLevels: [] },
    trends: { '1h': 'NEUTRAL', '4h': 'NEUTRAL', '1d': 'NEUTRAL', overall: 'NEUTRAL' },
    scoreBreakdown: { bull: 0, bear: 0, total: 0, bullPct: 50 }, fundingRate: 0, pivots: null,
  });

  try {
    const [ticker, K1h, K4h_raw, K1d] = await Promise.all([
      fetchTicker(sym),
      fetchKlines(sym, '1h', 200),
      fetchKlines(sym, '4h', 200),
      fetchKlines(sym, '1d', 200),
    ]);

    if (!ticker || ticker.price <= 0) return errReturn('No price data');

    const price = ticker.price;

    // Build 4H from 1H if needed
    const K4h = K4h_raw.length >= 30 ? K4h_raw : (K1h.length >= 40 ? build4hFrom1h(K1h) : []);

    // CRITICAL: Minimum candle guard — prevents fake 100% scores
    // Need at least 30 candles for meaningful analysis
    const safe1h = K1h.length >= 30 ? K1h : [];
    const safe4h = K4h.length >= 30 ? K4h : [];
    const safe1d = K1d.length >= 30 ? K1d : (K4h.length >= 30 ? K4h : []);

    // If we have too few candles, return neutral
    if (safe4h.length < 30 && safe1h.length < 30) {
      return errReturn(`Data tidak cukup untuk analisis akurat (${K1h.length} candle 1H, ${K4h_raw.length} candle 4H). Coba lagi.`);
    }

    // Use best available
    const c1h = safe1h.map(k => k.c);
    const c4h = safe4h.map(k => k.c);
    const c1d = safe1d.map(k => k.c);
    const K4hBest = safe4h.length > 0 ? safe4h : safe1h;

    // ── INDICATORS ────────────────────────────────────────────
    const rsi1h = safe1h.length >= 15 ? RSI(c1h, 14) : 50;
    const rsi4h = safe4h.length >= 15 ? RSI(c4h, 14) : (safe1h.length >= 15 ? RSI(c1h, 14) : 50);
    const rsi1d = safe1d.length >= 15 ? RSI(c1d, 14) : rsi4h;

    const ne = (arr, p) => Math.min(p, arr.length - 1) || 1;
    const cRef = safe4h.length > 0 ? c4h : c1h;

    const ema9_1h = safe1h.length > 9 ? EMA(c1h, ne(c1h, 9)) : price;
    const ema21_1h = safe1h.length > 21 ? EMA(c1h, ne(c1h, 21)) : price;
    const ema50_1h = safe1h.length > 50 ? EMA(c1h, ne(c1h, 50)) : price;
    const ema20_4h = EMA(cRef, ne(cRef, 20));
    const ema50_4h = EMA(cRef, ne(cRef, 50));
    const ema200_4h = EMA(cRef, ne(cRef, Math.min(200, cRef.length)));
    const ema50_1d = safe1d.length > 10 ? EMA(c1d, ne(c1d, Math.min(50, c1d.length))) : price;
    const ema200_1d = safe1d.length > 10 ? EMA(c1d, ne(c1d, Math.min(200, c1d.length))) : price;

    const bb4h = BB(cRef, ne(cRef, 20));
    const atr4h = ATR(K4hBest, 14);
    const macd4h = MACD(cRef);
    const macd1d = safe1d.length >= 35 ? MACD(c1d) : macd4h;

    // ── TREND SCORING ─────────────────────────────────────────
    const ts1h = (price > ema9_1h ? 1 : -1) + (price > ema21_1h ? 1 : -1) + (price > ema50_1h ? 1 : -1) + (macd4h.bullish ? 0.5 : -0.5) + (rsi1h > 50 ? 0.5 : -0.5);
    const ts4h = (price > ema20_4h ? 2 : -2) + (price > ema50_4h ? 2 : -2) + (price > ema200_4h ? 2 : -2) + (macd4h.bullish ? 1 : -1) + (rsi4h > 50 ? 0.5 : -0.5);
    const ts1d = (price > ema50_1d ? 2 : -2) + (price > ema200_1d ? 2 : -2) + (macd1d.bullish ? 1 : -1) + (rsi1d > 50 ? 0.5 : -0.5);

    const gt = (s, t) => s > t ? 'BULLISH' : s > 0 ? 'BULLISH_WEAK' : s < -t ? 'BEARISH' : s < 0 ? 'BEARISH_WEAK' : 'NEUTRAL';
    const t1h = gt(ts1h, 2), t4h = gt(ts4h, 3), t1d = gt(ts1d, 2);
    const overall = gt(ts1h * 0.2 + ts4h * 0.4 + ts1d * 0.4, 2);

    // ── SUPPORT/RESISTANCE ────────────────────────────────────
    const srRef = K4hBest.length >= 15 ? K4hBest : safe1h;
    const sr = srRef.length >= 15 ? findSR(srRef, price, Math.min(5, Math.floor(srRef.length / 10))) : { resistance: [], support: [] };
    const sup = sr.support[0] || +(price * 0.95).toFixed(4);
    const res = sr.resistance[0] || +(price * 1.05).toFixed(4);

    // ── SCORE (balanced, not biased) ──────────────────────────
    let bs = 0, br = 0;
    if (t1d === 'BULLISH') bs += 15; else if (t1d === 'BEARISH') br += 15; else if (t1d === 'BULLISH_WEAK') bs += 7; else br += 7;
    if (t4h === 'BULLISH') bs += 12; else if (t4h === 'BEARISH') br += 12; else if (t4h === 'BULLISH_WEAK') bs += 5; else br += 5;
    if (t1h === 'BULLISH') bs += 8; else if (t1h === 'BEARISH') br += 8; else if (t1h === 'BULLISH_WEAK') bs += 3; else br += 3;
    if (rsi4h < 30) bs += 15; else if (rsi4h > 70) br += 15; else if (rsi4h < 45) bs += 5; else if (rsi4h > 55) br += 5;
    if (macd4h.bullish) bs += 10; else if (macd4h.bearish) br += 10;
    if (macd4h.crossUp) bs += 5; else if (macd4h.crossDown) br += 5;
    if (bb4h.position < 15) bs += 10; else if (bb4h.position > 85) br += 10; else if (bb4h.position < 35) bs += 4; else if (bb4h.position > 65) br += 4;
    if (ticker.change24h > 3) bs += 5; else if (ticker.change24h < -3) br += 5;

    const tot = bs + br;
    // Cap at 95% max — never 100% unless ALL signals align perfectly
    const rawProb = tot > 0 ? Math.round(Math.max(bs, br) / tot * 100) : 50;
    const prob = Math.min(95, rawProb); // CRITICAL: cap at 95%

    const sig = bs > br ? (prob >= 65 ? 'Strong Buy' : 'Buy') : br > bs ? (prob >= 65 ? 'Strong Sell' : 'Sell') : 'Neutral';

    // ── MA POSITION ───────────────────────────────────────────
    const maPct = ema200_4h > 0 ? ((price - ema200_4h) / ema200_4h * 100).toFixed(1) : '0';
    const maPos = ema200_4h > 0 ? (price > ema200_4h ? `Above EMA200 (+${maPct}%)` : `Below EMA200 (${maPct}%)`) : 'Calculating...';

    // ── PIVOT ─────────────────────────────────────────────────
    let pivot = null;
    if (K4hBest.length >= 2) {
      const pv = K4hBest[K4hBest.length - 2], P = (pv.h + pv.l + pv.c) / 3;
      pivot = { P: +P.toFixed(4), R1: +(2 * P - pv.l).toFixed(4), R2: +(P + pv.h - pv.l).toFixed(4), S1: +(2 * P - pv.h).toFixed(4), S2: +(P - (pv.h - pv.l)).toFixed(4) };
    }

    // ── TECHNICAL SUMMARY ─────────────────────────────────────
    const candles4h = safe4h.length > 0 ? safe4h.length : safe1h.length;
    const dataQuality = candles4h >= 100 ? 'Excellent' : candles4h >= 50 ? 'Good' : candles4h >= 30 ? 'Acceptable' : 'Limited';
    const parts = [];
    parts.push(overall === 'BULLISH' ? 'Tren bullish — multi-TF aligned.' : overall === 'BEARISH' ? 'Tren bearish — tekanan jual dominan.' : 'Tren mixed — tunggu konfirmasi.');
    if (rsi4h < 30) parts.push(`RSI 4H oversold (${rsi4h}) — potensi reversal.`);
    else if (rsi4h > 70) parts.push(`RSI 4H overbought (${rsi4h}) — waspada.`);
    else parts.push(`RSI 4H: ${rsi4h} (${rsi4h > 50 ? 'bullish' : 'bearish'} zone).`);
    if (macd4h.crossUp) parts.push('MACD golden cross.');
    else if (macd4h.crossDown) parts.push('MACD death cross.');
    else parts.push(macd4h.bullish ? 'MACD bullish.' : 'MACD bearish.');
    if (bb4h.squeeze) parts.push(`BB squeeze — breakout imminent.`);
    parts.push(`Data: ${candles4h} candles (${dataQuality}).`);

    return {
      symbol: sym + 'USDT', ticker: sym,
      currentPrice: +price.toFixed(4), change24h: +ticker.change24h.toFixed(2),
      dataSource: ticker.src, dataQuality, candleCount: candles4h,
      probabilityScore: prob,
      confluenceSignal: sig,
      action: sig.includes('Buy') ? 'BUY' : sig.includes('Sell') ? 'SELL' : 'HOLD',
      overallTrend: overall,
      technicalSummary: parts.join(' '),
      rsi: { '1h': rsi1h, '4h': rsi4h, '1d': rsi1d },
      maStatus: { position: maPos, ema20_4h: +ema20_4h.toFixed(4), ema50_4h: +ema50_4h.toFixed(4), ema200_4h: +ema200_4h.toFixed(4), crossSignal: ema9_1h > ema21_1h ? 'EMA9>EMA21' : 'EMA9<EMA21' },
      macd: { '4h': macd4h, '1d': macd1d },
      bb: { '4h': bb4h, squeeze: bb4h.squeeze },
      atr: { '4h': +atr4h.toFixed(4), atrPct: +(atr4h / price * 100).toFixed(2), volatility: atr4h / price * 100 > 5 ? 'HIGH' : atr4h / price * 100 > 2 ? 'MEDIUM' : 'LOW' },
      keyLevels: { support: +sup.toFixed(4), resistance: +res.toFixed(4), supportLevels: sr.support.slice(0, 2).map(s => +s.toFixed(4)), resistanceLevels: sr.resistance.slice(0, 2).map(r => +r.toFixed(4)) },
      pivots: pivot,
      trends: { '1h': t1h, '4h': t4h, '1d': t1d, overall, scores: { ts1h: +ts1h.toFixed(2), ts4h: +ts4h.toFixed(2), ts1d: +ts1d.toFixed(2) } },
      scoreBreakdown: { bull: bs, bear: br, total: tot, bullPct: tot > 0 ? Math.min(95, Math.round(bs / tot * 100)) : 50 },
      fundingRate: 0,
    };
  } catch (e) { return errReturn('Error: ' + e.message); }
}

function buildNarrative(btc, eth) {
  if (!btc || btc.currentPrice === 0) return 'Data pasar sedang dimuat...';
  const p = [];
  // No [Sumber: xxx] tag — clean output for members
  if (btc.overallTrend === 'BULLISH' && eth?.overallTrend === 'BULLISH') p.push('BTC & ETH keduanya bullish — risk-on aktif, kondisi baik untuk altcoin.');
  else if (btc.overallTrend === 'BULLISH') p.push('BTC bullish, ETH masih laggard — rotasi ke altcoin belum dimulai sepenuhnya.');
  else if (btc.overallTrend === 'BEARISH') p.push('BTC bearish — smart money distribusi, manajemen risiko ketat.');
  else p.push('Market transisi — tunggu konfirmasi tren sebelum entry besar.');
  const r = btc.rsi?.['4h'] || 50;
  if (r < 30) p.push(`RSI BTC oversold (${r}) — zona akumulasi institusional historis.`);
  else if (r > 70) p.push(`RSI BTC overbought (${r}) — potensi distribusi smart money.`);
  if (btc.macd?.['4h']?.crossUp) p.push('MACD BTC golden cross — momentum bullish baru dimulai.');
  if (btc.macd?.['4h']?.crossDown) p.push('MACD BTC death cross — momentum bearish menguat.');
  if (btc.bb?.['4h']?.squeeze) p.push('BB squeeze — ekspansi volatilitas imminent.');
  return p.join(' ') || 'Pasar dalam kondisi normal — pantau level kunci.';
}
