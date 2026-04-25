// api/analytics.js — AC369 FUSION v10.6 FINAL
// Returns: { btc:{currentPrice,...}, eth:{currentPrice,...}, smartMoneyNarrative }
// Fallback: Binance Futures → Binance Spot → CryptoCompare → CoinGecko

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

// ── SAFE FETCH ────────────────────────────────────────────────────────────────
async function sf(url, timeout = 9000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
    });
    clearTimeout(t);
    if (!r.ok) return null;
    const j = await r.json();
    return j;
  } catch { clearTimeout(t); return null; }
}

// ── FETCH TICKER ─────────────────────────────────────────────────────────────
async function fetchTicker(sym) {
  // 1. Binance Futures
  const fRes = await sf(`https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${sym}USDT`);
  if (fRes && +fRes.lastPrice > 0) return { price: +fRes.lastPrice, change24h: +fRes.priceChangePercent, vol: +fRes.quoteVolume, src: 'futures' };

  // 2. Binance Spot
  const sRes = await sf(`https://api.binance.com/api/v3/ticker/24hr?symbol=${sym}USDT`);
  if (sRes && +sRes.lastPrice > 0) return { price: +sRes.lastPrice, change24h: +sRes.priceChangePercent, vol: +sRes.quoteVolume, src: 'spot' };

  // 3. CoinGecko
  const cgId = { BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', BNB: 'binancecoin' }[sym];
  if (cgId) {
    const cgRes = await sf(`https://api.coingecko.com/api/v3/simple/price?ids=${cgId}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true`);
    if (cgRes?.[cgId]?.usd > 0) return { price: cgRes[cgId].usd, change24h: cgRes[cgId].usd_24h_change || 0, vol: cgRes[cgId].usd_24h_vol || 0, src: 'coingecko' };
  }

  // 4. CoinCap
  const capId = { BTC: 'bitcoin', ETH: 'ethereum' }[sym];
  if (capId) {
    const capRes = await sf(`https://api.coincap.io/v2/assets/${capId}`);
    if (capRes?.data?.priceUsd > 0) return { price: +capRes.data.priceUsd, change24h: +capRes.data.changePercent24Hr || 0, vol: +capRes.data.volumeUsd24Hr || 0, src: 'coincap' };
  }
  return null;
}

// ── FETCH KLINES ──────────────────────────────────────────────────────────────
async function fetchKlines(sym, interval, limit = 200) {
  const iMap = { '1h': '1h', '4h': '4h', '1d': '1d' };
  const iv = iMap[interval] || '1h';

  // 1. Binance Futures
  const fRes = await sf(`https://fapi.binance.com/fapi/v1/klines?symbol=${sym}USDT&interval=${iv}&limit=${limit}`);
  if (Array.isArray(fRes) && fRes.length > 14) return fRes.map(k => ({ t: +k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] }));

  // 2. Binance Spot
  const sRes = await sf(`https://api.binance.com/api/v3/klines?symbol=${sym}USDT&interval=${iv}&limit=${limit}`);
  if (Array.isArray(sRes) && sRes.length > 14) return sRes.map(k => ({ t: +k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] }));

  // 3. CryptoCompare (reliable, no geo-blocking)
  const ccEndp = interval === '1d' ? 'histoday' : 'histohour';
  const ccLim = interval === '4h' ? limit * 4 : limit;
  const ccRes = await sf(`https://min-api.cryptocompare.com/data/v2/${ccEndp}?fsym=${sym}&tsym=USD&limit=${ccLim}`);
  if (ccRes?.Response === 'Success' && ccRes.Data?.Data?.length > 14) {
    let data = ccRes.Data.Data.map(d => ({ t: d.time * 1000, o: d.open, h: d.high, l: d.low, c: d.close, v: d.volumeto }));
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

  // 4. CoinGecko OHLC (last resort)
  const cgId = { BTC: 'bitcoin', ETH: 'ethereum' }[sym];
  if (cgId) {
    const days = interval === '1d' ? 90 : interval === '4h' ? 14 : 7;
    const cgRes = await sf(`https://api.coingecko.com/api/v3/coins/${cgId}/ohlc?vs_currency=usd&days=${days}`);
    if (Array.isArray(cgRes) && cgRes.length > 10) return cgRes.map(d => ({ t: d[0], o: d[1], h: d[2], l: d[3], c: d[4], v: 0 }));
  }
  return [];
}

// ── MATH ──────────────────────────────────────────────────────────────────────
function EMA(c, p) {
  if (!c || c.length < p) return c?.[c.length - 1] || 0;
  const k = 2 / (p + 1);
  let e = c.slice(0, p).reduce((a, b) => a + b, 0) / p;
  for (let i = p; i < c.length; i++) e = c[i] * k + e * (1 - k);
  return e;
}
function SMA(c, p) { return c && c.length >= p ? c.slice(-p).reduce((a, b) => a + b, 0) / p : c?.[c.length - 1] || 0; }
function RSI(c, p = 14) {
  if (!c || c.length < p + 1) return 50;
  let g = 0, l = 0;
  for (let i = 1; i <= p; i++) { const d = c[i] - c[i - 1]; d >= 0 ? g += d : l -= d; }
  let ag = g / p, al = l / p;
  for (let i = p + 1; i < c.length; i++) {
    const d = c[i] - c[i - 1];
    ag = (ag * (p - 1) + (d >= 0 ? d : 0)) / p;
    al = (al * (p - 1) + (d < 0 ? -d : 0)) / p;
  }
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
  const pos = sd > 0 ? +((c[c.length - 1] - dn) / (4 * sd) * 100).toFixed(1) : 50;
  return { upper: +up.toFixed(4), lower: +dn.toFixed(4), mid: +m.toFixed(4), width: +(sd > 0 ? (4 * sd / m) * 100 : 0).toFixed(2), position: pos, squeeze: sd > 0 && (4 * sd / m) * 100 < 3 };
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
  for (let i = 0; i + 3 < K.length; i += 4) {
    const sl = K.slice(i, i + 4);
    out.push({ t: sl[0].t, o: sl[0].o, h: Math.max(...sl.map(k => k.h)), l: Math.min(...sl.map(k => k.l)), c: sl[3].c, v: sl.reduce((s, k) => s + k.v, 0) });
  }
  return out;
}

// ── MAIN ──────────────────────────────────────────────────────────────────────
async function analyzeAsset(sym) {
  const err = (msg) => ({
    symbol: sym + 'USDT', ticker: sym, currentPrice: 0, change24h: 0, dataSource: 'error',
    probabilityScore: 50, confluenceSignal: 'Neutral', action: 'HOLD', overallTrend: 'NEUTRAL',
    technicalSummary: msg, rsi: { '1h': 50, '4h': 50, '1d': 50 },
    maStatus: { position: 'N/A' }, macd: {}, bb: {}, atr: {},
    keyLevels: { support: 0, resistance: 0, supportLevels: [], resistanceLevels: [] },
    trends: { '1h': 'NEUTRAL', '4h': 'NEUTRAL', '1d': 'NEUTRAL', overall: 'NEUTRAL' },
    scoreBreakdown: { bull: 0, bear: 0, total: 0, bullPct: 50 }, fundingRate: 0, pivots: null,
  });

  try {
    const [ticker, K1h, K4h, K1d] = await Promise.all([
      fetchTicker(sym),
      fetchKlines(sym, '1h', 200),
      fetchKlines(sym, '4h', 200),
      fetchKlines(sym, '1d', 200),
    ]);

    if (!ticker || ticker.price <= 0) return err('No price data from any source');

    const price = ticker.price;
    const change24h = ticker.change24h;

    // Best available candles
    const bK1h = K1h.length > 14 ? K1h : [];
    const bK4h = K4h.length > 14 ? K4h : (K1h.length > 40 ? build4hFrom1h(K1h) : []);
    const bK1d = K1d.length > 14 ? K1d : [];

    const c1h = bK1h.map(k => k.c);
    const c4h = bK4h.map(k => k.c);
    const c1d = bK1d.map(k => k.c);

    // Safe arrays (fallback to price array if empty)
    const s1h = c1h.length > 14 ? c1h : [price];
    const s4h = c4h.length > 14 ? c4h : (c1h.length > 14 ? c1h : [price]);
    const s1d = c1d.length > 14 ? c1d : (c4h.length > 14 ? c4h : [price]);

    // ── INDICATORS ─────────────────────────────────────────────────
    const rsi1h = RSI(s1h), rsi4h = RSI(s4h), rsi1d = RSI(s1d);
    const n = (arr, p) => Math.min(p, arr.length - 1) || 1;

    const ema9_1h = EMA(s1h, n(s1h, 9));
    const ema21_1h = EMA(s1h, n(s1h, 21));
    const ema50_1h = EMA(s1h, n(s1h, 50));
    const sma200_1h = SMA(s1h, n(s1h, 200));
    const ema20_4h = EMA(s4h, n(s4h, 20));
    const ema50_4h = EMA(s4h, n(s4h, 50));
    const ema200_4h = EMA(s4h, n(s4h, 200));
    const ema50_1d = EMA(s1d, n(s1d, 50));
    const ema200_1d = EMA(s1d, n(s1d, 200));

    const K4hBest = bK4h.length > 10 ? bK4h : bK1h;
    const bb4h = BB(s4h, n(s4h, 20));
    const atr4h = ATR(K4hBest.length > 10 ? K4hBest : bK1h);
    const macd4h = MACD(s4h), macd1d = MACD(s1d);

    // ── TREND ──────────────────────────────────────────────────────
    const ts1h = (price > ema9_1h ? 1 : -1) + (price > ema21_1h ? 1 : -1) + (price > ema50_1h ? 1 : -1) + (macd4h.bullish ? 0.5 : -0.5) + (rsi1h > 50 ? 0.5 : -0.5);
    const ts4h = (price > ema20_4h ? 2 : -2) + (price > ema50_4h ? 2 : -2) + (price > ema200_4h ? 2 : -2) + (macd4h.bullish ? 1 : -1) + (rsi4h > 50 ? 0.5 : -0.5);
    const ts1d = (price > ema50_1d ? 2 : -2) + (price > ema200_1d ? 2 : -2) + (macd1d.bullish ? 1 : -1) + (rsi1d > 50 ? 0.5 : -0.5);
    const gt = (s, t) => s > t ? 'BULLISH' : s > 0 ? 'BULLISH_WEAK' : s < -t ? 'BEARISH' : s < 0 ? 'BEARISH_WEAK' : 'NEUTRAL';
    const t1h = gt(ts1h, 2), t4h = gt(ts4h, 3), t1d = gt(ts1d, 2);
    const overall = gt(ts1h * 0.2 + ts4h * 0.4 + ts1d * 0.4, 2);

    // ── SUPPORT/RESISTANCE ─────────────────────────────────────────
    const srK = K4hBest.length > 15 ? K4hBest : bK1h;
    const sr4h = srK.length >= 15 ? findSR(srK, price, 5) : { resistance: [], support: [] };
    const sr1d = bK1d.length >= 10 ? findSR(bK1d, price, 3) : { resistance: [], support: [] };
    const sup = sr1d.support[0] || sr4h.support[0] || +(price * 0.95).toFixed(4);
    const res = sr1d.resistance[0] || sr4h.resistance[0] || +(price * 1.05).toFixed(4);

    // ── SCORE ──────────────────────────────────────────────────────
    let bs = 0, br = 0;
    if (t1d === 'BULLISH') bs += 15; else if (t1d === 'BEARISH') br += 15; else if (t1d === 'BULLISH_WEAK') bs += 7; else br += 7;
    if (t4h === 'BULLISH') bs += 12; else if (t4h === 'BEARISH') br += 12; else if (t4h === 'BULLISH_WEAK') bs += 5; else br += 5;
    if (t1h === 'BULLISH') bs += 8; else if (t1h === 'BEARISH') br += 8; else if (t1h === 'BULLISH_WEAK') bs += 3; else br += 3;
    if (rsi4h < 30) bs += 15; else if (rsi4h > 70) br += 15; else if (rsi4h < 45) bs += 5; else if (rsi4h > 55) br += 5;
    if (macd4h.bullish) bs += 10; else if (macd4h.bearish) br += 10;
    if (macd4h.crossUp) bs += 5; else if (macd4h.crossDown) br += 5;
    if (bb4h.position < 15) bs += 10; else if (bb4h.position > 85) br += 10; else if (bb4h.position < 35) bs += 4; else if (bb4h.position > 65) br += 4;
    if (change24h > 3) bs += 5; else if (change24h < -3) br += 5;

    const tot = bs + br;
    const prob = tot > 0 ? Math.round(Math.max(bs, br) / tot * 100) : 50;
    const sig = bs > br ? (prob >= 65 ? 'Strong Buy' : 'Buy') : br > bs ? (prob >= 65 ? 'Strong Sell' : 'Sell') : 'Neutral';

    // MA position string
    const maPct = ema200_4h > 0 ? ((price - ema200_4h) / ema200_4h * 100).toFixed(1) : '0';
    const maPos = ema200_4h > 0 ? (price > ema200_4h ? `Above EMA200 4H (+${maPct}%)` : `Below EMA200 4H (${maPct}%)`) : 'Calculating...';

    // Pivot points
    let pivot = null;
    const pK = K4hBest.length >= 2 ? K4hBest : bK1h;
    if (pK.length >= 2) {
      const pv = pK[pK.length - 2], P = (pv.h + pv.l + pv.c) / 3;
      pivot = { P: +P.toFixed(4), R1: +(2 * P - pv.l).toFixed(4), R2: +(P + pv.h - pv.l).toFixed(4), S1: +(2 * P - pv.h).toFixed(4), S2: +(P - (pv.h - pv.l)).toFixed(4) };
    }

    // Technical summary
    const parts = [];
    if (s4h.length < 30) parts.push(`⚠ Data terbatas — analisis dari ${ticker.src}.`);
    parts.push(overall === 'BULLISH' ? 'Tren makro bullish — multi-TF aligned.' : overall === 'BEARISH' ? 'Tren makro bearish — jual dominan.' : 'Tren mixed — tunggu konfirmasi.');
    if (rsi4h < 30) parts.push(`RSI 4H oversold (${rsi4h}) — potensi reversal.`);
    else if (rsi4h > 70) parts.push(`RSI 4H overbought (${rsi4h}) — waspada distribusi.`);
    else parts.push(`RSI 4H: ${rsi4h} (${rsi4h > 50 ? 'bullish zone' : 'bearish zone'}).`);
    if (macd4h.crossUp) parts.push('MACD 4H cross up — sinyal beli.');
    else if (macd4h.crossDown) parts.push('MACD 4H cross down — sinyal jual.');
    else parts.push(macd4h.bullish ? 'MACD 4H bullish.' : 'MACD 4H bearish.');
    if (bb4h.squeeze) parts.push(`BB squeeze (${bb4h.width}%) — breakout imminent.`);

    return {
      symbol: sym + 'USDT', ticker: sym,
      currentPrice: +price.toFixed(4),
      change24h: +change24h.toFixed(2),
      dataSource: ticker.src,
      probabilityScore: prob,
      confluenceSignal: sig,
      action: sig.includes('Buy') ? 'BUY' : sig.includes('Sell') ? 'SELL' : 'HOLD',
      overallTrend: overall,
      technicalSummary: parts.join(' '),
      rsi: { '1h': rsi1h, '4h': rsi4h, '1d': rsi1d, signal1h: rsi1h < 30 ? 'OVERSOLD' : rsi1h > 70 ? 'OVERBOUGHT' : rsi1h > 50 ? 'BULLISH' : 'BEARISH', signal4h: rsi4h < 30 ? 'OVERSOLD' : rsi4h > 70 ? 'OVERBOUGHT' : rsi4h > 50 ? 'BULLISH' : 'BEARISH', signal1d: rsi1d < 30 ? 'OVERSOLD' : rsi1d > 70 ? 'OVERBOUGHT' : rsi1d > 50 ? 'BULLISH' : 'BEARISH' },
      maStatus: { position: maPos, ema9_1h: +ema9_1h.toFixed(4), ema21_1h: +ema21_1h.toFixed(4), ema50_1h: +ema50_1h.toFixed(4), sma200_1h: +sma200_1h.toFixed(4), ema20_4h: +ema20_4h.toFixed(4), ema50_4h: +ema50_4h.toFixed(4), ema200_4h: +ema200_4h.toFixed(4), ema50_1d: +ema50_1d.toFixed(4), ema200_1d: +ema200_1d.toFixed(4), crossSignal: ema9_1h > ema21_1h ? 'EMA9>EMA21' : 'EMA9<EMA21' },
      macd: { '4h': macd4h, '1d': macd1d },
      bb: { '4h': bb4h, squeeze: bb4h.squeeze },
      atr: { '4h': +atr4h.toFixed(4), atrPct: +(atr4h / price * 100).toFixed(2), volatility: atr4h / price * 100 > 5 ? 'HIGH' : atr4h / price * 100 > 2 ? 'MEDIUM' : 'LOW' },
      keyLevels: { support: +sup.toFixed(4), resistance: +res.toFixed(4), supportLevels: sr4h.support.slice(0, 2).map(s => +s.toFixed(4)), resistanceLevels: sr4h.resistance.slice(0, 2).map(r => +r.toFixed(4)) },
      pivots: pivot,
      trends: { '1h': t1h, '4h': t4h, '1d': t1d, overall, scores: { ts1h: +ts1h.toFixed(2), ts4h: +ts4h.toFixed(2), ts1d: +ts1d.toFixed(2) } },
      scoreBreakdown: { bull: bs, bear: br, total: tot, bullPct: tot > 0 ? Math.round(bs / tot * 100) : 50 },
      fundingRate: 0,
    };
  } catch (e) { return err('Error: ' + e.message); }
}

function buildNarrative(btc, eth) {
  if (!btc || btc.currentPrice === 0) return 'Data pasar sedang dimuat...';
  const p = [];
  if (btc.overallTrend === 'BULLISH' && eth?.overallTrend === 'BULLISH') p.push('BTC & ETH keduanya bullish — risk-on aktif, kondisi baik untuk altcoin.');
  else if (btc.overallTrend === 'BULLISH') p.push('BTC bullish, ETH laggard — rotasi ke altcoin belum dimulai.');
  else if (btc.overallTrend === 'BEARISH') p.push('BTC bearish — smart money distribusi, manajemen risiko ketat.');
  else p.push('Market transisi — tunggu konfirmasi sebelum entry besar.');
  const r = btc.rsi?.['4h'] || 50;
  if (r < 30) p.push(`RSI BTC oversold (${r}) — zona akumulasi institusional.`);
  else if (r > 70) p.push(`RSI BTC overbought (${r}) — potensi distribusi.`);
  if (btc.macd?.['4h']?.crossUp) p.push('MACD BTC 4H golden cross — momentum bullish baru dimulai.');
  if (btc.macd?.['4h']?.crossDown) p.push('MACD BTC 4H death cross — momentum bearish menguat.');
  p.push(`[Sumber: ${btc.dataSource || 'N/A'}]`);
  return p.join(' ');
}
