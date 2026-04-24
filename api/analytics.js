// api/analytics.js — AC369 FUSION v10.4
// MULTI-SOURCE FALLBACK: Futures → Spot → CoinGecko → CryptoCompare
// Vercel dapat memblokir fapi.binance.com — kita coba semua sumber

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const [btcResult, ethResult] = await Promise.all([
      analyzeAsset('BTC'),
      analyzeAsset('ETH'),
    ]);

    res.setHeader('Cache-Control', 's-maxage=30');
    return res.status(200).json({
      btc: btcResult,
      eth: ethResult,
      smartMoneyNarrative: buildNarrative(btcResult, ethResult),
      timestamp: Date.now(),
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

// ── FETCH WITH TIMEOUT ────────────────────────────────────────────────────────
async function ft(url, ms = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }
    });
    clearTimeout(timer);
    if (!r.ok) return null;
    return await r.json();
  } catch {
    clearTimeout(timer);
    return null;
  }
}

// ── MULTI-SOURCE KLINES FETCH ─────────────────────────────────────────────────
async function fetchKlines(symbol, interval, limit = 200) {
  const sym = symbol.toUpperCase();

  // 1. Binance Futures
  const fMap = { '1h': '1h', '4h': '4h', '1d': '1d' };
  const fRes = await ft(`https://fapi.binance.com/fapi/v1/klines?symbol=${sym}USDT&interval=${fMap[interval]}&limit=${limit}`);
  if (Array.isArray(fRes) && fRes.length > 10) {
    return fRes.map(k => ({ t: +k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] }));
  }

  // 2. Binance Spot
  const sRes = await ft(`https://api.binance.com/api/v3/klines?symbol=${sym}USDT&interval=${fMap[interval]}&limit=${limit}`);
  if (Array.isArray(sRes) && sRes.length > 10) {
    return sRes.map(k => ({ t: +k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] }));
  }

  // 3. CryptoCompare (no rate limit issues)
  const ccInterval = interval === '1d' ? 'histoday' : 'histohour';
  const ccLimit = interval === '4h' ? limit * 4 : limit;
  const ccRes = await ft(`https://min-api.cryptocompare.com/data/v2/${ccInterval}?fsym=${sym}&tsym=USD&limit=${ccLimit}&api_key=`);
  if (ccRes?.Response === 'Success' && ccRes.Data?.Data?.length > 10) {
    let data = ccRes.Data.Data.map(d => ({
      t: d.time * 1000, o: d.open, h: d.high, l: d.low, c: d.close, v: d.volumeto
    }));
    // Aggregate 1h → 4h
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

  // 4. CoinGecko OHLC (last resort — limited data)
  const cgIdMap = { BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', BNB: 'binancecoin' };
  const cgId = cgIdMap[sym];
  if (cgId) {
    const cgDays = interval === '1d' ? 90 : interval === '4h' ? 14 : 7;
    const cgRes = await ft(`https://api.coingecko.com/api/v3/coins/${cgId}/ohlc?vs_currency=usd&days=${cgDays}`);
    if (Array.isArray(cgRes) && cgRes.length > 10) {
      return cgRes.map(d => ({ t: d[0], o: d[1], h: d[2], l: d[3], c: d[4], v: 0 }));
    }
  }

  return [];
}

// ── MULTI-SOURCE TICKER FETCH ─────────────────────────────────────────────────
async function fetchTicker(symbol) {
  const sym = symbol.toUpperCase();

  // 1. Binance Futures
  const fRes = await ft(`https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${sym}USDT`);
  if (fRes && parseFloat(fRes.lastPrice) > 0) {
    return {
      price: parseFloat(fRes.lastPrice),
      change24h: parseFloat(fRes.priceChangePercent || 0),
      volume24h: parseFloat(fRes.quoteVolume || 0),
      source: 'binance_futures'
    };
  }

  // 2. Binance Spot
  const sRes = await ft(`https://api.binance.com/api/v3/ticker/24hr?symbol=${sym}USDT`);
  if (sRes && parseFloat(sRes.lastPrice) > 0) {
    return {
      price: parseFloat(sRes.lastPrice),
      change24h: parseFloat(sRes.priceChangePercent || 0),
      volume24h: parseFloat(sRes.quoteVolume || 0),
      source: 'binance_spot'
    };
  }

  // 3. CoinGecko simple price
  const cgIdMap = { BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', BNB: 'binancecoin', XRP: 'ripple', ADA: 'cardano', AVAX: 'avalanche-2', DOGE: 'dogecoin', DOT: 'polkadot', LINK: 'chainlink' };
  const cgId = cgIdMap[sym];
  if (cgId) {
    const cgRes = await ft(`https://api.coingecko.com/api/v3/simple/price?ids=${cgId}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true`);
    if (cgRes && cgRes[cgId]) {
      return {
        price: cgRes[cgId].usd || 0,
        change24h: cgRes[cgId].usd_24h_change || 0,
        volume24h: cgRes[cgId].usd_24h_vol || 0,
        source: 'coingecko'
      };
    }
  }

  // 4. CoinCap
  const capMap = { BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', BNB: 'binance-coin' };
  const capId = capMap[sym];
  if (capId) {
    const capRes = await ft(`https://api.coincap.io/v2/assets/${capId}`);
    if (capRes?.data?.priceUsd) {
      return {
        price: parseFloat(capRes.data.priceUsd) || 0,
        change24h: parseFloat(capRes.data.changePercent24Hr) || 0,
        volume24h: parseFloat(capRes.data.volumeUsd24Hr) || 0,
        source: 'coincap'
      };
    }
  }

  return null;
}

// ── MATH FUNCTIONS ────────────────────────────────────────────────────────────
const EMA = (c, p) => {
  if (!c || c.length < p) return c?.[c.length - 1] || 0;
  const k = 2 / (p + 1);
  let e = c.slice(0, p).reduce((a, b) => a + b, 0) / p;
  for (let i = p; i < c.length; i++) e = c[i] * k + e * (1 - k);
  return e;
};
const SMA = (c, p) => c && c.length >= p ? c.slice(-p).reduce((a, b) => a + b, 0) / p : c?.[c.length - 1] || 0;

// RSI dengan Wilder's Smoothing — akurat vs TradingView
const RSI = (c, p = 14) => {
  if (!c || c.length < p + 1) return 50;
  let g = 0, l = 0;
  for (let i = 1; i <= p; i++) { const d = c[i] - c[i - 1]; d >= 0 ? g += d : l -= d; }
  let ag = g / p, al = l / p;
  for (let i = p + 1; i < c.length; i++) {
    const d = c[i] - c[i - 1];
    ag = (ag * (p - 1) + (d >= 0 ? d : 0)) / p;
    al = (al * (p - 1) + (d < 0 ? -d : 0)) / p;
  }
  return al === 0 ? 100 : parseFloat((100 - 100 / (1 + ag / al)).toFixed(2));
};

const ATR = (K, p = 14) => {
  if (!K || K.length < 2) return 0;
  const trs = K.slice(1).map((k, i) => Math.max(k.h - k.l, Math.abs(k.h - K[i].c), Math.abs(k.l - K[i].c)));
  return trs.slice(-p).reduce((a, b) => a + b, 0) / Math.min(p, trs.length);
};

const BB = (c, p = 20) => {
  if (!c || c.length < p) return { upper: 0, lower: 0, mid: 0, width: 0, position: 50 };
  const sl = c.slice(-p), m = sl.reduce((a, b) => a + b, 0) / p;
  const sd = Math.sqrt(sl.reduce((s, v) => s + (v - m) ** 2, 0) / p);
  const up = m + 2 * sd, dn = m - 2 * sd;
  return {
    upper: +up.toFixed(6), lower: +dn.toFixed(6), mid: +m.toFixed(6),
    width: +(sd > 0 ? (4 * sd / m) * 100 : 0).toFixed(2),
    position: +(sd > 0 ? ((c[c.length - 1] - dn) / (4 * sd) * 100) : 50).toFixed(1)
  };
};

const MACD = (c) => {
  if (!c || c.length < 35) return { macd: 0, signal: 0, histogram: 0, bullish: false, bearish: false, crossUp: false, crossDown: false };
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
  const ml = mv[mv.length - 1], ph = mv[mv.length - 2] || ml, hist = ml - sig, prevH = ph - sig;
  return {
    macd: +ml.toFixed(6), signal: +sig.toFixed(6), histogram: +hist.toFixed(6),
    bullish: ml > 0 && hist > 0, bearish: ml < 0 && hist < 0,
    crossUp: hist > 0 && prevH <= 0, crossDown: hist < 0 && prevH >= 0
  };
};

const findSR = (K, price, lb = 5) => {
  const hh = [], ll = [];
  for (let i = lb; i < K.length - lb; i++) {
    let iH = true, iL = true;
    for (let j = i - lb; j <= i + lb; j++) {
      if (j === i) continue;
      if (K[j].h >= K[i].h) iH = false;
      if (K[j].l <= K[i].l) iL = false;
    }
    if (iH) hh.push(K[i].h);
    if (iL) ll.push(K[i].l);
  }
  return {
    resistance: hh.filter(h => h > price).sort((a, b) => a - b).slice(0, 3),
    support: ll.filter(l => l < price).sort((a, b) => b - a).slice(0, 3)
  };
};

// ── MAIN ASSET ANALYSIS ───────────────────────────────────────────────────────
async function analyzeAsset(symbol) {
  try {
    // Fetch all data sources in parallel
    const [tickerData, K1h, K4h, K1d] = await Promise.all([
      fetchTicker(symbol),
      fetchKlines(symbol, '1h', 200),
      fetchKlines(symbol, '4h', 200),
      fetchKlines(symbol, '1d', 200),
    ]);

    if (!tickerData || tickerData.price === 0) {
      throw new Error('No price data from any source');
    }

    const price = tickerData.price;
    const change24h = tickerData.change24h;
    const dataSource = tickerData.source;

    // Use best available candle data
    const bestK1h = K1h.length > 10 ? K1h : [];
    const bestK4h = K4h.length > 10 ? K4h : (K1h.length > 40 ? buildK4hFrom1h(K1h) : []);
    const bestK1d = K1d.length > 10 ? K1d : [];

    // Get closes arrays
    const c1h = bestK1h.map(k => k.c);
    const c4h = bestK4h.map(k => k.c);
    const c1d = bestK1d.map(k => k.c);

    // Use available data or fallback to price-based estimates
    const useC = (c) => c.length > 14 ? c : null;
    const c4hSafe = useC(c4h) || useC(c1h) || [price];
    const c1hSafe = useC(c1h) || [price];
    const c1dSafe = useC(c1d) || useC(c4h) || [price];

    // ── INDICATORS ─────────────────────────────────────────────────
    const rsi1h = RSI(c1hSafe, 14);
    const rsi4h = RSI(c4hSafe, 14);
    const rsi1d = RSI(c1dSafe, 14);

    const ema9_1h = EMA(c1hSafe, Math.min(9, c1hSafe.length));
    const ema21_1h = EMA(c1hSafe, Math.min(21, c1hSafe.length));
    const ema50_1h = EMA(c1hSafe, Math.min(50, c1hSafe.length));
    const sma200_1h = SMA(c1hSafe, Math.min(200, c1hSafe.length));

    const ema20_4h = EMA(c4hSafe, Math.min(20, c4hSafe.length));
    const ema50_4h = EMA(c4hSafe, Math.min(50, c4hSafe.length));
    const ema200_4h = EMA(c4hSafe, Math.min(200, c4hSafe.length));

    const ema50_1d = EMA(c1dSafe, Math.min(50, c1dSafe.length));
    const ema200_1d = EMA(c1dSafe, Math.min(200, c1dSafe.length));

    const K4hBest = bestK4h.length > 10 ? bestK4h : bestK1h;
    const bb4h = BB(c4hSafe, Math.min(20, c4hSafe.length));
    const atr4h = ATR(K4hBest.length > 10 ? K4hBest : bestK1h);
    const macd4h = MACD(c4hSafe);
    const macd1d = MACD(c1dSafe);

    // ── TREND SCORING ───────────────────────────────────────────────
    const ts1h = (price > ema9_1h ? 1 : -1) + (price > ema21_1h ? 1 : -1) + (price > ema50_1h ? 1 : -1) + (macd4h.bullish ? 0.5 : -0.5) + (rsi1h > 50 ? 0.5 : -0.5);
    const ts4h = (price > ema20_4h ? 2 : -2) + (price > ema50_4h ? 2 : -2) + (price > ema200_4h ? 2 : -2) + (macd4h.bullish ? 1 : -1) + (rsi4h > 50 ? 0.5 : -0.5);
    const ts1d = (price > ema50_1d ? 2 : -2) + (price > ema200_1d ? 2 : -2) + (macd1d.bullish ? 1 : -1) + (rsi1d > 50 ? 0.5 : -0.5);
    const gt = (s, t) => s > t ? 'BULLISH' : s > 0 ? 'BULLISH_WEAK' : s < -t ? 'BEARISH' : s < 0 ? 'BEARISH_WEAK' : 'NEUTRAL';
    const t1h = gt(ts1h, 2), t4h = gt(ts4h, 3), t1d = gt(ts1d, 2);
    const overall = gt(ts1h * 0.2 + ts4h * 0.4 + ts1d * 0.4, 2);

    // ── SUPPORT / RESISTANCE ────────────────────────────────────────
    const srK = K4hBest.length > 15 ? K4hBest : bestK1h;
    const sr4h = srK.length >= 15 ? findSR(srK, price, 5) : { resistance: [], support: [] };
    const srKd = bestK1d.length >= 10 ? findSR(bestK1d, price, 3) : { resistance: [], support: [] };
    const sup = srKd.support[0] || sr4h.support[0] || price * 0.95;
    const res = srKd.resistance[0] || sr4h.resistance[0] || price * 1.05;

    // ── SCORE ───────────────────────────────────────────────────────
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
    const prob = tot > 0 ? Math.round((Math.max(bs, br) / tot) * 100) : 50;
    const sig = bs > br ? (prob >= 65 ? 'Strong Buy' : 'Buy') : br > bs ? (prob >= 65 ? 'Strong Sell' : 'Sell') : 'Neutral';

    // ── MA POSITION ─────────────────────────────────────────────────
    const maPct = ema200_4h > 0 ? ((price - ema200_4h) / ema200_4h * 100).toFixed(1) : '0';
    const maPos = ema200_4h > 0 ? (price > ema200_4h ? `Above EMA200 4H (+${maPct}%)` : `Below EMA200 4H (${maPct}%)`) : 'Calculating...';

    // ── PIVOT POINTS ─────────────────────────────────────────────────
    let pivot = null;
    const pivotK = K4hBest.length >= 2 ? K4hBest : bestK1h;
    if (pivotK.length >= 2) {
      const pv = pivotK[pivotK.length - 2], P = (pv.h + pv.l + pv.c) / 3;
      pivot = {
        P: +P.toFixed(4), R1: +(2 * P - pv.l).toFixed(4), R2: +(P + pv.h - pv.l).toFixed(4),
        R3: +(pv.h + 2 * (P - pv.l)).toFixed(4), S1: +(2 * P - pv.h).toFixed(4),
        S2: +(P - (pv.h - pv.l)).toFixed(4), S3: +(pv.l - 2 * (pv.h - P)).toFixed(4)
      };
    }

    // ── TECHNICAL SUMMARY ────────────────────────────────────────────
    const parts = [];
    if (c4hSafe.length < 30) parts.push(`⚠ Data terbatas (${c4hSafe.length} candle) — analisis dari ${dataSource}.`);
    if (overall === 'BULLISH') parts.push('Tren makro bullish — multi-timeframe aligned naik.');
    else if (overall === 'BEARISH') parts.push('Tren makro bearish — tekanan jual dominan.');
    else parts.push('Tren mixed — konfirmasi diperlukan sebelum entry.');
    if (rsi4h < 30) parts.push(`RSI 4H oversold (${rsi4h}) — potensi reversal kuat.`);
    else if (rsi4h > 70) parts.push(`RSI 4H overbought (${rsi4h}) — waspada distribusi.`);
    else parts.push(`RSI 4H: ${rsi4h} (${rsi4h > 50 ? 'bullish zone' : 'bearish zone'}).`);
    if (macd4h.crossUp) parts.push('MACD 4H cross up — sinyal beli terkonfirmasi.');
    else if (macd4h.crossDown) parts.push('MACD 4H cross down — sinyal jual.');
    else if (macd4h.bullish) parts.push('MACD 4H bullish — momentum positif.');
    else parts.push('MACD 4H bearish — tekanan jual berlanjut.');
    if (bb4h.width < 3) parts.push(`BB squeeze (${bb4h.width}%) — ekspansi volatilitas imminent.`);

    return {
      symbol: symbol + 'USDT', ticker: symbol,
      currentPrice: +price.toFixed(4),
      change24h: +change24h.toFixed(2),
      dataSource,
      probabilityScore: prob,
      confluenceSignal: sig,
      action: sig.includes('Buy') ? 'BUY' : sig.includes('Sell') ? 'SELL' : 'HOLD',
      overallTrend: overall,
      technicalSummary: parts.join(' '),
      rsi: {
        '1h': rsi1h, '4h': rsi4h, '1d': rsi1d,
        signal1h: rsi1h < 30 ? 'OVERSOLD' : rsi1h > 70 ? 'OVERBOUGHT' : rsi1h > 50 ? 'BULLISH' : 'BEARISH',
        signal4h: rsi4h < 30 ? 'OVERSOLD' : rsi4h > 70 ? 'OVERBOUGHT' : rsi4h > 50 ? 'BULLISH' : 'BEARISH',
        signal1d: rsi1d < 30 ? 'OVERSOLD' : rsi1d > 70 ? 'OVERBOUGHT' : rsi1d > 50 ? 'BULLISH' : 'BEARISH',
      },
      maStatus: {
        position: maPos,
        ema9_1h: +ema9_1h.toFixed(4), ema21_1h: +ema21_1h.toFixed(4),
        ema50_1h: +ema50_1h.toFixed(4), sma200_1h: +sma200_1h.toFixed(4),
        ema20_4h: +ema20_4h.toFixed(4), ema50_4h: +ema50_4h.toFixed(4), ema200_4h: +ema200_4h.toFixed(4),
        ema50_1d: +ema50_1d.toFixed(4), ema200_1d: +ema200_1d.toFixed(4),
        crossSignal: ema9_1h > ema21_1h ? (ema21_1h > ema50_1h ? 'Golden Cross' : 'EMA9>EMA21') : 'EMA9<EMA21',
      },
      macd: { '4h': macd4h, '1d': macd1d },
      bb: { '4h': bb4h, squeeze: bb4h.width < 3 },
      atr: {
        '4h': +atr4h.toFixed(4),
        atrPct: +(atr4h / price * 100).toFixed(2),
        volatility: atr4h / price * 100 > 5 ? 'HIGH' : atr4h / price * 100 > 2 ? 'MEDIUM' : 'LOW',
      },
      keyLevels: {
        support: +sup.toFixed(4), resistance: +res.toFixed(4),
        supportLevels: sr4h.support.slice(0, 2).map(s => +s.toFixed(4)),
        resistanceLevels: sr4h.resistance.slice(0, 2).map(r => +r.toFixed(4)),
      },
      pivots: pivot,
      trends: {
        '1h': t1h, '4h': t4h, '1d': t1d, overall,
        scores: { ts1h: +ts1h.toFixed(2), ts4h: +ts4h.toFixed(2), ts1d: +ts1d.toFixed(2) }
      },
      scoreBreakdown: { bull: bs, bear: br, total: tot, bullPct: tot > 0 ? Math.round(bs / tot * 100) : 50 },
      fundingRate: 0,
    };
  } catch (e) {
    return {
      symbol: symbol + 'USDT', ticker: symbol, currentPrice: 0, change24h: 0, dataSource: 'error',
      probabilityScore: 50, confluenceSignal: 'Neutral', action: 'HOLD', overallTrend: 'NEUTRAL',
      technicalSummary: 'Error: ' + e.message,
      rsi: { '1h': 50, '4h': 50, '1d': 50 },
      maStatus: { position: 'N/A' }, macd: {}, bb: {}, atr: {},
      keyLevels: { support: 0, resistance: 0, supportLevels: [], resistanceLevels: [] },
      trends: { '1h': 'NEUTRAL', '4h': 'NEUTRAL', '1d': 'NEUTRAL', overall: 'NEUTRAL' },
      scoreBreakdown: { bull: 0, bear: 0, total: 0, bullPct: 50 },
      fundingRate: 0, pivots: null, error: e.message
    };
  }
}

// Build 4H candles from 1H
function buildK4hFrom1h(K1h) {
  const out = [];
  for (let i = 0; i + 3 < K1h.length; i += 4) {
    const sl = K1h.slice(i, i + 4);
    out.push({ t: sl[0].t, o: sl[0].o, h: Math.max(...sl.map(k => k.h)), l: Math.min(...sl.map(k => k.l)), c: sl[3].c, v: sl.reduce((s, k) => s + k.v, 0) });
  }
  return out;
}

function buildNarrative(btc, eth) {
  if (!btc || btc.currentPrice === 0) return 'Data pasar sedang dimuat dari multiple sources...';
  const p = [];
  if (btc.overallTrend === 'BULLISH' && eth?.overallTrend === 'BULLISH') p.push('BTC & ETH keduanya bullish — risk-on aktif, kondisi baik untuk altcoin.');
  else if (btc.overallTrend === 'BULLISH') p.push('BTC bullish, ETH laggard — kapital fokus di BTC dulu sebelum rotasi altcoin.');
  else if (btc.overallTrend === 'BEARISH') p.push('BTC bearish — smart money distribusi, manajemen risiko ketat.');
  else p.push('Market transisi — tunggu konfirmasi tren sebelum entry besar.');
  const r = btc.rsi?.['4h'] || 50;
  if (r < 30) p.push(`RSI BTC oversold (${r}) — zona akumulasi institusional historis.`);
  else if (r > 70) p.push(`RSI BTC overbought (${r}) — potensi distribusi smart money.`);
  if (btc.macd?.['4h']?.crossUp) p.push('MACD BTC 4H golden cross — momentum bullish baru dimulai.');
  if (btc.macd?.['4h']?.crossDown) p.push('MACD BTC 4H death cross — momentum bearish menguat.');
  if (btc.dataSource) p.push(`[Data source: ${btc.dataSource}]`);
  return p.join(' ') || 'Pasar dalam kondisi normal — pantau level kunci.';
}
