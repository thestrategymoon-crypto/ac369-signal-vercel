// api/data.js — AC369 SNIPER ENTRY SYSTEM v4.0
// Institutional-grade: SMC + MTF + Chart Patterns + Liquidity + Kill Zone
// Only outputs HIGH PROBABILITY setups (≥75% confluence)

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  const { source, ...params } = req.query;

  try {
    let data;

    // ─── BASIC PROXIES ────────────────────────────────────────────────
    if (source === 'feargreed') {
      const r = await fetch('https://api.alternative.me/fng/?limit=30&format=json', { signal: AbortSignal.timeout(8000) });
      data = await r.json();

    } else if (source === 'coingecko_global') {
      const r = await fetch('https://api.coingecko.com/api/v3/global', { headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(10000) });
      data = await r.json();

    } else if (source === 'coingecko_trending') {
      const r = await fetch('https://api.coingecko.com/api/v3/search/trending', { headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(10000) });
      data = await r.json();

    } else if (source === 'binance_depth') {
      const sym = params.symbol || 'BTCUSDT';
      const r = await fetch(`https://api.binance.com/api/v3/depth?symbol=${sym}&limit=50`, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) });
      data = await r.json();

    } else if (source === 'futures_klines') {
      const sym = params.symbol || 'BTCUSDT';
      const interval = params.interval || '4h';
      const limit = params.limit || '200';
      const r = await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=${interval}&limit=${limit}`, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(12000) });
      const raw = await r.json();
      data = raw.map(k => ({ t: k[0], o: parseFloat(k[1]), h: parseFloat(k[2]), l: parseFloat(k[3]), c: parseFloat(k[4]), v: parseFloat(k[5]), takerBuy: parseFloat(k[9]) }));

    } else if (source === 'oi_history') {
      const sym = params.symbol || 'BTCUSDT';
      const r = await fetch(`https://fapi.binance.com/futures/data/openInterestHist?symbol=${sym}&period=${params.period || '4h'}&limit=${params.limit || '50'}`, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10000) });
      data = await r.json();

    } else if (source === 'longshort') {
      const sym = params.symbol || 'BTCUSDT';
      const r = await fetch(`https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${sym}&period=${params.period || '4h'}&limit=${params.limit || '50'}`, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10000) });
      data = await r.json();

    } else if (source === 'taker_volume') {
      const sym = params.symbol || 'BTCUSDT';
      const r = await fetch(`https://fapi.binance.com/futures/data/takerlongshortRatio?symbol=${sym}&period=${params.period || '4h'}&limit=${params.limit || '50'}`, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10000) });
      data = await r.json();

    } else if (source === 'funding_current') {
      const sym = params.symbol || 'BTCUSDT';
      const r = await fetch(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${sym}`, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) });
      data = await r.json();

    } else if (source === 'futures_ticker') {
      const sym = params.symbol || 'BTCUSDT';
      const r = await fetch(`https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${sym}`, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) });
      data = await r.json();

    } else if (source === 'spot_tickers') {
      const r = await fetch('https://api.binance.com/api/v3/ticker/24hr', { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(12000) });
      const all = await r.json();
      data = all.filter(t => t.symbol.endsWith('USDT') && parseFloat(t.quoteVolume) > 10000000)
        .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume)).slice(0, 50)
        .map(t => ({ symbol: t.symbol, price: parseFloat(t.lastPrice), change: parseFloat(t.priceChangePercent), volume: parseFloat(t.quoteVolume), high: parseFloat(t.highPrice), low: parseFloat(t.lowPrice) }));

    // ══════════════════════════════════════════════════════════════════
    // ─── SNIPER ENTRY ENGINE v4.0 ─────────────────────────────────────
    // ══════════════════════════════════════════════════════════════════
    } else if (source === 'sniper') {
      const sym = params.symbol || 'BTCUSDT';

      // ── FETCH ALL DATA IN PARALLEL ──────────────────────────────────
      const [
        raw1h, raw4h, raw1d,
        oiRes, lsRes, takerRes,
        fundingRes, depthRes, fngRes
      ] = await Promise.allSettled([
        fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=1h&limit=200`).then(r => r.json()),
        fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=4h&limit=200`).then(r => r.json()),
        fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=1d&limit=100`).then(r => r.json()),
        fetch(`https://fapi.binance.com/futures/data/openInterestHist?symbol=${sym}&period=4h&limit=20`).then(r => r.json()),
        fetch(`https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${sym}&period=4h&limit=10`).then(r => r.json()),
        fetch(`https://fapi.binance.com/futures/data/takerlongshortRatio?symbol=${sym}&period=4h&limit=10`).then(r => r.json()),
        fetch(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${sym}`).then(r => r.json()),
        fetch(`https://api.binance.com/api/v3/depth?symbol=${sym}&limit=100`).then(r => r.json()),
        fetch(`https://api.alternative.me/fng/?limit=1&format=json`).then(r => r.json()),
      ]);

      const parseK = raw => Array.isArray(raw) ? raw.map(k => ({
        t: k[0], o: parseFloat(k[1]), h: parseFloat(k[2]),
        l: parseFloat(k[3]), c: parseFloat(k[4]), v: parseFloat(k[5]),
        takerBuy: parseFloat(k[9] || 0)
      })) : [];

      const K1h = raw1h.status === 'fulfilled' ? parseK(raw1h.value) : [];
      const K4h = raw4h.status === 'fulfilled' ? parseK(raw4h.value) : [];
      const K1d = raw1d.status === 'fulfilled' ? parseK(raw1d.value) : [];

      if (!K4h.length) throw new Error('No klines data available');

      const currentPrice = K4h[K4h.length - 1].c;

      // ── MATH HELPERS ──────────────────────────────────────────────
      const calcEMA = (closes, period) => {
        if (closes.length < period) return closes[closes.length - 1];
        const k = 2 / (period + 1);
        let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
        for (let i = period; i < closes.length; i++) ema = closes[i] * k + ema * (1 - k);
        return ema;
      };

      const calcRSI = (closes, period = 14) => {
        if (closes.length < period + 1) return 50;
        let gains = 0, losses = 0;
        for (let i = closes.length - period; i < closes.length; i++) {
          const d = closes[i] - closes[i - 1];
          if (d > 0) gains += d; else losses -= d;
        }
        return 100 - (100 / (1 + gains / (losses || 0.001)));
      };

      const calcATR = (K, period = 14) => {
        const trs = K.slice(1).map((k, i) => Math.max(k.h - k.l, Math.abs(k.h - K[i].c), Math.abs(k.l - K[i].c)));
        return trs.slice(-period).reduce((a, b) => a + b, 0) / period;
      };

      const calcBB = (closes, period = 20) => {
        const slice = closes.slice(-period);
        const mid = slice.reduce((a, b) => a + b, 0) / period;
        const std = Math.sqrt(slice.reduce((s, v) => s + (v - mid) ** 2, 0) / period);
        return { upper: mid + 2 * std, lower: mid - 2 * std, mid, std };
      };

      const calcStoch = (K, period = 14) => {
        const recent = K.slice(-period);
        const high = Math.max(...recent.map(k => k.h));
        const low = Math.min(...recent.map(k => k.l));
        return high === low ? 50 : ((K[K.length - 1].c - low) / (high - low)) * 100;
      };

      // ── MULTI-TIMEFRAME ANALYSIS ──────────────────────────────────
      const analyzeTF = (K) => {
        if (!K.length) return { bull: false, bear: false, score: 0, rsi: 50, trend: 'UNKNOWN' };
        const closes = K.map(k => k.c);
        const price = closes[closes.length - 1];
        const ema20 = calcEMA(closes, Math.min(20, closes.length));
        const ema50 = calcEMA(closes, Math.min(50, closes.length));
        const ema200 = calcEMA(closes, Math.min(200, closes.length));
        const rsi = calcRSI(closes);
        const macd = calcEMA(closes, 12) - calcEMA(closes, 26);
        const atr = calcATR(K);

        // Higher highs / higher lows
        const last20 = K.slice(-20);
        const hh = last20[last20.length - 1].h > last20[0].h;
        const hl = last20[last20.length - 1].l > last20[0].l;

        let score = 0;
        if (price > ema200) score += 2; else score -= 2;
        if (price > ema50) score += 1; else score -= 1;
        if (ema20 > ema50) score += 1; else score -= 1;
        if (macd > 0) score += 1; else score -= 1;
        if (rsi > 50 && rsi < 70) score += 1;
        else if (rsi < 50 && rsi > 30) score -= 1;
        if (hh && hl) score += 2; else score -= 2;

        return {
          score, rsi, macd, atr,
          ema20, ema50, ema200, price,
          bull: score >= 4,
          bear: score <= -4,
          trend: score >= 4 ? 'UPTREND' : score <= -4 ? 'DOWNTREND' : score >= 2 ? 'BULLISH BIAS' : score <= -2 ? 'BEARISH BIAS' : 'RANGING'
        };
      };

      const tf1h = analyzeTF(K1h);
      const tf4h = analyzeTF(K4h);
      const tf1d = analyzeTF(K1d);

      // MTF Alignment
      const mtfBullScore = (tf1d.bull ? 3 : tf1d.score > 0 ? 1 : 0) + (tf4h.bull ? 3 : tf4h.score > 0 ? 1 : 0) + (tf1h.bull ? 2 : tf1h.score > 0 ? 1 : 0);
      const mtfBearScore = (tf1d.bear ? 3 : tf1d.score < 0 ? 1 : 0) + (tf4h.bear ? 3 : tf4h.score < 0 ? 1 : 0) + (tf1h.bear ? 2 : tf1h.score < 0 ? 1 : 0);
      const mtfAligned = mtfBullScore >= 6 || mtfBearScore >= 6;
      const mtfBias = mtfBullScore > mtfBearScore ? 'BULL' : mtfBearScore > mtfBullScore ? 'BEAR' : 'NEUTRAL';

      // ── ATR & KEY LEVELS ──────────────────────────────────────────
      const atr4h = calcATR(K4h);
      const atr1d = calcATR(K1d);
      const closes4h = K4h.map(k => k.c);
      const bb = calcBB(closes4h);
      const stoch = calcStoch(K4h);

      // ── SWING STRUCTURE ───────────────────────────────────────────
      const findSwings = (K, lookback = 3) => {
        const highs = [], lows = [];
        for (let i = lookback; i < K.length - lookback; i++) {
          let isH = true, isL = true;
          for (let j = i - lookback; j <= i + lookback; j++) {
            if (j === i) continue;
            if (K[j].h >= K[i].h) isH = false;
            if (K[j].l <= K[i].l) isL = false;
          }
          if (isH) highs.push({ i, price: K[i].h, t: K[i].t });
          if (isL) lows.push({ i, price: K[i].l, t: K[i].t });
        }
        return { highs, lows };
      };

      const swings4h = findSwings(K4h, 4);
      const swings1d = findSwings(K1d, 3);

      // Market structure
      const recentHighs4h = swings4h.highs.slice(-5);
      const recentLows4h = swings4h.lows.slice(-5);
      let structureBias = 'NEUTRAL';
      if (recentHighs4h.length >= 2 && recentLows4h.length >= 2) {
        const hhPattern = recentHighs4h[recentHighs4h.length - 1].price > recentHighs4h[recentHighs4h.length - 2].price;
        const hlPattern = recentLows4h[recentLows4h.length - 1].price > recentLows4h[recentLows4h.length - 2].price;
        const lhPattern = recentHighs4h[recentHighs4h.length - 1].price < recentHighs4h[recentHighs4h.length - 2].price;
        const llPattern = recentLows4h[recentLows4h.length - 1].price < recentLows4h[recentLows4h.length - 2].price;
        if (hhPattern && hlPattern) structureBias = 'BULLISH';
        else if (lhPattern && llPattern) structureBias = 'BEARISH';
        else if (hhPattern || hlPattern) structureBias = 'BULLISH_WEAK';
        else if (lhPattern || llPattern) structureBias = 'BEARISH_WEAK';
      }

      // BOS detection
      let lastBOS = null;
      if (recentHighs4h.length >= 2) {
        const lastH = recentHighs4h[recentHighs4h.length - 1];
        const prevH = recentHighs4h[recentHighs4h.length - 2];
        if (currentPrice > lastH.price && lastH.price > prevH.price) lastBOS = { type: 'BULL', price: lastH.price, label: 'BOS Bullish Confirmed' };
        else if (currentPrice < lastH.price && lastH.price < prevH.price) lastBOS = { type: 'BEAR', price: lastH.price, label: 'BOS Bearish Confirmed' };
      }

      // ── ORDER BLOCKS ──────────────────────────────────────────────
      const orderBlocks = [];
      for (let i = 2; i < K4h.length - 1; i++) {
        const c = K4h[i], n = K4h[i + 1];
        if (c.c < c.o && n.c > n.o && (n.c - n.o) / n.o > 0.006) {
          const obH = Math.max(c.o, c.c), obL = Math.min(c.o, c.c);
          if (currentPrice > obL && currentPrice < obH * 1.15)
            orderBlocks.push({ type: 'BULL', high: obH, low: obL, mid: (obH + obL) / 2, t: c.t, dist: ((currentPrice - (obH + obL) / 2) / currentPrice * 100) });
        }
        if (c.c > c.o && n.c < n.o && (n.o - n.c) / n.o > 0.006) {
          const obH = Math.max(c.o, c.c), obL = Math.min(c.o, c.c);
          if (currentPrice < obH && currentPrice > obL * 0.85)
            orderBlocks.push({ type: 'BEAR', high: obH, low: obL, mid: (obH + obL) / 2, t: c.t, dist: (((obH + obL) / 2 - currentPrice) / currentPrice * 100) });
        }
      }
      const bullOBs = orderBlocks.filter(o => o.type === 'BULL').sort((a, b) => Math.abs(a.dist) - Math.abs(b.dist));
      const bearOBs = orderBlocks.filter(o => o.type === 'BEAR').sort((a, b) => Math.abs(a.dist) - Math.abs(b.dist));
      const nearestBullOB = bullOBs[0] || null;
      const nearestBearOB = bearOBs[0] || null;

      // ── FAIR VALUE GAPS ───────────────────────────────────────────
      const fvgs = [];
      for (let i = 1; i < K4h.length - 1; i++) {
        const p = K4h[i - 1], n = K4h[i + 1];
        if (n.l > p.h && (n.l - p.h) / currentPrice > 0.001)
          fvgs.push({ type: 'BULL', high: n.l, low: p.h, mid: (n.l + p.h) / 2, t: K4h[i].t, filled: currentPrice < p.h });
        if (n.h < p.l && (p.l - n.h) / currentPrice > 0.001)
          fvgs.push({ type: 'BEAR', high: p.l, low: n.h, mid: (p.l + n.h) / 2, t: K4h[i].t, filled: currentPrice > p.l });
      }
      const bullFVGs = fvgs.filter(f => f.type === 'BULL' && !f.filled).sort((a, b) => Math.abs(currentPrice - a.mid) - Math.abs(currentPrice - b.mid));
      const bearFVGs = fvgs.filter(f => f.type === 'BEAR' && !f.filled).sort((a, b) => Math.abs(currentPrice - a.mid) - Math.abs(currentPrice - b.mid));

      // ── SUPPLY & DEMAND ZONES ─────────────────────────────────────
      const avgVol = K4h.slice(-50).reduce((s, k) => s + k.v, 0) / 50;
      const sdZones = [];
      for (let i = 3; i < K4h.length - 1; i++) {
        const k = K4h[i];
        const bodySize = Math.abs(k.c - k.o);
        const totalRange = k.h - k.l;
        if (k.v > avgVol * 1.5 && totalRange > 0 && bodySize / totalRange > 0.55) {
          if (k.c > k.o && currentPrice > k.l * 0.98)
            sdZones.push({ type: 'DEMAND', high: Math.max(k.o, k.c), low: Math.min(k.o, k.c) - atr4h * 0.3, mid: (k.o + k.c) / 2, volX: (k.v / avgVol).toFixed(1), t: k.t });
          if (k.c < k.o && currentPrice < k.h * 1.02)
            sdZones.push({ type: 'SUPPLY', high: Math.max(k.o, k.c) + atr4h * 0.3, low: Math.min(k.o, k.c), mid: (k.o + k.c) / 2, volX: (k.v / avgVol).toFixed(1), t: k.t });
        }
      }
      const demandZones = sdZones.filter(z => z.type === 'DEMAND').sort((a, b) => Math.abs(currentPrice - a.mid) - Math.abs(currentPrice - b.mid));
      const supplyZones = sdZones.filter(z => z.type === 'SUPPLY').sort((a, b) => Math.abs(currentPrice - a.mid) - Math.abs(currentPrice - b.mid));
      const nearestDemand = demandZones[0] || null;
      const nearestSupply = supplyZones[0] || null;

      // ── LIQUIDITY POOLS ───────────────────────────────────────────
      const liqPools = [];
      const tol = atr4h * 0.4;
      for (let i = 0; i < swings4h.highs.length - 1; i++) {
        for (let j = i + 1; j < swings4h.highs.length; j++) {
          if (Math.abs(swings4h.highs[i].price - swings4h.highs[j].price) < tol) {
            const liqPrice = (swings4h.highs[i].price + swings4h.highs[j].price) / 2;
            liqPools.push({ type: 'BSL', price: liqPrice, dist: ((liqPrice - currentPrice) / currentPrice * 100) });
            break;
          }
        }
      }
      for (let i = 0; i < swings4h.lows.length - 1; i++) {
        for (let j = i + 1; j < swings4h.lows.length; j++) {
          if (Math.abs(swings4h.lows[i].price - swings4h.lows[j].price) < tol) {
            const liqPrice = (swings4h.lows[i].price + swings4h.lows[j].price) / 2;
            liqPools.push({ type: 'SSL', price: liqPrice, dist: ((currentPrice - liqPrice) / currentPrice * 100) });
            break;
          }
        }
      }
      const nearestBSL = liqPools.filter(l => l.type === 'BSL' && l.dist > 0).sort((a, b) => a.dist - b.dist)[0] || null;
      const nearestSSL = liqPools.filter(l => l.type === 'SSL' && l.dist > 0).sort((a, b) => a.dist - b.dist)[0] || null;

      // ── CHART PATTERN DETECTION ───────────────────────────────────
      const patterns = [];
      const last30 = K4h.slice(-30);
      const last10 = K4h.slice(-10);

      // 1. Bullish/Bearish Engulfing
      const last2 = K4h.slice(-2);
      if (last2[0].c < last2[0].o && last2[1].c > last2[1].o &&
        last2[1].c > last2[0].o && last2[1].o < last2[0].c)
        patterns.push({ name: 'Bullish Engulfing', type: 'BULL', strength: 'HIGH', detail: 'Strong reversal candle — buyers overwhelmed sellers' });
      if (last2[0].c > last2[0].o && last2[1].c < last2[1].o &&
        last2[1].c < last2[0].o && last2[1].o > last2[0].c)
        patterns.push({ name: 'Bearish Engulfing', type: 'BEAR', strength: 'HIGH', detail: 'Strong reversal candle — sellers overwhelmed buyers' });

      // 2. Pin Bar / Hammer / Shooting Star
      const lastK = K4h[K4h.length - 1];
      const lastBody = Math.abs(lastK.c - lastK.o);
      const lastRange = lastK.h - lastK.l;
      const lastLowerWick = Math.min(lastK.c, lastK.o) - lastK.l;
      const lastUpperWick = lastK.h - Math.max(lastK.c, lastK.o);
      if (lastRange > 0) {
        if (lastLowerWick > lastBody * 2 && lastUpperWick < lastBody * 0.5 && lastRange > atr4h * 0.8)
          patterns.push({ name: 'Bullish Pin Bar', type: 'BULL', strength: 'HIGH', detail: 'Rejection of lower prices — strong buying pressure' });
        if (lastUpperWick > lastBody * 2 && lastLowerWick < lastBody * 0.5 && lastRange > atr4h * 0.8)
          patterns.push({ name: 'Bearish Pin Bar', type: 'BEAR', strength: 'HIGH', detail: 'Rejection of upper prices — strong selling pressure' });
      }

      // 3. Inside Bar (consolidation before breakout)
      if (K4h.length >= 2) {
        const prev = K4h[K4h.length - 2], curr = K4h[K4h.length - 1];
        if (curr.h < prev.h && curr.l > prev.l)
          patterns.push({ name: 'Inside Bar', type: mtfBias === 'BULL' ? 'BULL' : 'BEAR', strength: 'MEDIUM', detail: `Consolidation within mother bar — breakout expected ${mtfBias === 'BULL' ? 'upward' : 'downward'}` });
      }

      // 4. Double Bottom / Double Top
      if (recentLows4h.length >= 2) {
        const l1 = recentLows4h[recentLows4h.length - 2].price;
        const l2 = recentLows4h[recentLows4h.length - 1].price;
        if (Math.abs(l1 - l2) / l1 < 0.02 && currentPrice > Math.max(l1, l2) * 1.01)
          patterns.push({ name: 'Double Bottom', type: 'BULL', strength: 'HIGH', detail: `Strong support at $${((l1 + l2) / 2).toFixed(2)} — reversal confirmed` });
      }
      if (recentHighs4h.length >= 2) {
        const h1 = recentHighs4h[recentHighs4h.length - 2].price;
        const h2 = recentHighs4h[recentHighs4h.length - 1].price;
        if (Math.abs(h1 - h2) / h1 < 0.02 && currentPrice < Math.min(h1, h2) * 0.99)
          patterns.push({ name: 'Double Top', type: 'BEAR', strength: 'HIGH', detail: `Strong resistance at $${((h1 + h2) / 2).toFixed(2)} — reversal confirmed` });
      }

      // 5. Higher Low (bullish) / Lower High (bearish)
      if (recentLows4h.length >= 3) {
        const l1 = recentLows4h[recentLows4h.length - 3].price;
        const l2 = recentLows4h[recentLows4h.length - 2].price;
        const l3 = recentLows4h[recentLows4h.length - 1].price;
        if (l3 > l2 && l2 > l1) patterns.push({ name: 'Higher Lows Series', type: 'BULL', strength: 'MEDIUM', detail: 'Consistent higher lows — buyers defending higher levels' });
      }
      if (recentHighs4h.length >= 3) {
        const h1 = recentHighs4h[recentHighs4h.length - 3].price;
        const h2 = recentHighs4h[recentHighs4h.length - 2].price;
        const h3 = recentHighs4h[recentHighs4h.length - 1].price;
        if (h3 < h2 && h2 < h1) patterns.push({ name: 'Lower Highs Series', type: 'BEAR', strength: 'MEDIUM', detail: 'Consistent lower highs — sellers capping every bounce' });
      }

      // 6. Bollinger Band Squeeze + Breakout
      if (bb.std / bb.mid < 0.015) {
        patterns.push({ name: 'BB Squeeze', type: mtfBias === 'BULL' ? 'BULL' : 'BEAR', strength: 'MEDIUM', detail: `Low volatility squeeze — explosive move imminent. Bias: ${mtfBias}` });
      }

      // 7. Stochastic Oversold/Overbought
      if (stoch < 20) patterns.push({ name: 'Stoch Oversold', type: 'BULL', strength: 'MEDIUM', detail: `Stochastic ${stoch.toFixed(0)} — oversold territory, reversal likely` });
      if (stoch > 80) patterns.push({ name: 'Stoch Overbought', type: 'BEAR', strength: 'MEDIUM', detail: `Stochastic ${stoch.toFixed(0)} — overbought territory, pullback likely` });

      // ── DERIVATIVES DATA ──────────────────────────────────────────
      let fundingRate = 0, lsRatioVal = 1, takerRatio = 1, fngVal = 50;
      let oiTrend = 'NEUTRAL';

      if (fundingRes.status === 'fulfilled') fundingRate = parseFloat(fundingRes.value.lastFundingRate || 0) * 100;
      if (lsRes.status === 'fulfilled' && Array.isArray(lsRes.value) && lsRes.value.length)
        lsRatioVal = parseFloat(lsRes.value[lsRes.value.length - 1].longShortRatio);
      if (takerRes.status === 'fulfilled' && Array.isArray(takerRes.value) && takerRes.value.length)
        takerRatio = takerRes.value.slice(-5).reduce((s, v) => s + parseFloat(v.buySellRatio), 0) / 5;
      if (fngRes.status === 'fulfilled' && fngRes.value.data)
        fngVal = parseInt(fngRes.value.data[0].value);
      if (oiRes.status === 'fulfilled' && Array.isArray(oiRes.value) && oiRes.value.length >= 5) {
        const oiV = oiRes.value.map(o => parseFloat(o.sumOpenInterest));
        const oiChg = (oiV[oiV.length - 1] - oiV[oiV.length - 5]) / oiV[oiV.length - 5] * 100;
        if (oiChg > 2 && tf4h.bull) oiTrend = 'LONG_BUILD';
        else if (oiChg > 2 && tf4h.bear) oiTrend = 'SHORT_BUILD';
        else if (oiChg < -2) oiTrend = 'SQUEEZE';
        else oiTrend = 'NEUTRAL';
      }

      // Order book imbalance
      let obImbalance = 0.5;
      if (depthRes.status === 'fulfilled' && depthRes.value.bids) {
        const bidV = depthRes.value.bids.reduce((s, b) => s + parseFloat(b[1]), 0);
        const askV = depthRes.value.asks.reduce((s, a) => s + parseFloat(a[1]), 0);
        obImbalance = bidV / (bidV + askV);
      }

      // ── KILL ZONE (WIB = UTC+7) ───────────────────────────────────
      const nowUTC = new Date();
      const wibHour = (nowUTC.getUTCHours() + 7) % 24;
      const wibMin = nowUTC.getUTCMinutes();
      const wibTime = wibHour + wibMin / 60;

      let killZone = null;
      if (wibTime >= 2 && wibTime < 5) killZone = { name: 'ASIA OPEN', color: '#a855f7', active: true, desc: 'Asia session — lower volatility, tighter ranges' };
      else if (wibTime >= 8 && wibTime < 12) killZone = { name: 'LONDON OPEN', color: '#4488ff', active: true, desc: 'Highest probability session — sharp moves expected' };
      else if (wibTime >= 15 && wibTime < 17) killZone = { name: 'LONDON/NY OVERLAP', color: '#00ffd0', active: true, desc: 'Peak liquidity — best time for breakouts' };
      else if (wibTime >= 19 && wibTime < 23) killZone = { name: 'NY OPEN', color: '#FFB300', active: true, desc: 'High volatility session — trend continuation likely' };
      else {
        const nextKZ = wibTime < 2 ? { name: 'ASIA OPEN', eta: `${(2 - wibTime).toFixed(1)}h` } :
          wibTime < 8 ? { name: 'LONDON OPEN', eta: `${(8 - wibTime).toFixed(1)}h` } :
          wibTime < 19 ? { name: 'NY OPEN', eta: `${(19 - wibTime).toFixed(1)}h` } :
          { name: 'ASIA OPEN', eta: `${(26 - wibTime).toFixed(1)}h` };
        killZone = { name: nextKZ.name, active: false, desc: `Next Kill Zone in ${nextKZ.eta}`, color: '#7a8499' };
      }

      // ══════════════════════════════════════════════════════════════
      // ── SNIPER SCORING SYSTEM (100 points max) ────────────────────
      // ══════════════════════════════════════════════════════════════
      let bullScore = 0, bearScore = 0;
      const scoreLog = [];

      // 1. MTF ALIGNMENT (max 25pts)
      if (mtfBullScore >= 6) { bullScore += 25; scoreLog.push({ cat: 'MTF', detail: 'ALL 3 TF BULLISH ALIGNED', pts: 25, side: 'bull' }); }
      else if (mtfBullScore >= 4) { bullScore += 15; scoreLog.push({ cat: 'MTF', detail: '2/3 TF BULLISH', pts: 15, side: 'bull' }); }
      else if (mtfBearScore >= 6) { bearScore += 25; scoreLog.push({ cat: 'MTF', detail: 'ALL 3 TF BEARISH ALIGNED', pts: 25, side: 'bear' }); }
      else if (mtfBearScore >= 4) { bearScore += 15; scoreLog.push({ cat: 'MTF', detail: '2/3 TF BEARISH', pts: 15, side: 'bear' }); }
      else scoreLog.push({ cat: 'MTF', detail: 'NO ALIGNMENT — conflicting TF', pts: 0, side: 'neutral' });

      // 2. MARKET STRUCTURE (max 20pts)
      if (structureBias === 'BULLISH') { bullScore += 20; scoreLog.push({ cat: 'Structure', detail: 'HH + HL confirmed — clean uptrend', pts: 20, side: 'bull' }); }
      else if (structureBias === 'BEARISH') { bearScore += 20; scoreLog.push({ cat: 'Structure', detail: 'LH + LL confirmed — clean downtrend', pts: 20, side: 'bear' }); }
      else if (structureBias === 'BULLISH_WEAK') { bullScore += 10; scoreLog.push({ cat: 'Structure', detail: 'Partial bullish structure', pts: 10, side: 'bull' }); }
      else if (structureBias === 'BEARISH_WEAK') { bearScore += 10; scoreLog.push({ cat: 'Structure', detail: 'Partial bearish structure', pts: 10, side: 'bear' }); }
      else scoreLog.push({ cat: 'Structure', detail: 'No clear market structure', pts: 0, side: 'neutral' });

      // 3. SMC ZONES (max 20pts)
      if (nearestBullOB && Math.abs(nearestBullOB.dist) < 3) {
        bullScore += 20;
        scoreLog.push({ cat: 'SMC Zone', detail: `Price at Bullish OB $${nearestBullOB.low.toFixed(2)}-$${nearestBullOB.high.toFixed(2)}`, pts: 20, side: 'bull' });
      } else if (nearestDemand && Math.abs((currentPrice - nearestDemand.mid) / currentPrice * 100) < 4) {
        bullScore += 15;
        scoreLog.push({ cat: 'SMC Zone', detail: `Price at Demand Zone ${nearestDemand.volX}x vol`, pts: 15, side: 'bull' });
      } else if (nearestBearOB && Math.abs(nearestBearOB.dist) < 3) {
        bearScore += 20;
        scoreLog.push({ cat: 'SMC Zone', detail: `Price at Bearish OB $${nearestBearOB.low.toFixed(2)}-$${nearestBearOB.high.toFixed(2)}`, pts: 20, side: 'bear' });
      } else if (nearestSupply && Math.abs((nearestSupply.mid - currentPrice) / currentPrice * 100) < 4) {
        bearScore += 15;
        scoreLog.push({ cat: 'SMC Zone', detail: `Price at Supply Zone ${nearestSupply.volX}x vol`, pts: 15, side: 'bear' });
      } else scoreLog.push({ cat: 'SMC Zone', detail: 'Price not at key SMC zone', pts: 0, side: 'neutral' });

      // 4. CHART PATTERNS (max 15pts)
      const bullPatterns = patterns.filter(p => p.type === 'BULL');
      const bearPatterns = patterns.filter(p => p.type === 'BEAR');
      const strongBullPat = bullPatterns.filter(p => p.strength === 'HIGH').length;
      const strongBearPat = bearPatterns.filter(p => p.strength === 'HIGH').length;
      if (strongBullPat >= 2) { bullScore += 15; scoreLog.push({ cat: 'Pattern', detail: `${strongBullPat} HIGH strength bull patterns`, pts: 15, side: 'bull' }); }
      else if (bullPatterns.length >= 2) { bullScore += 10; scoreLog.push({ cat: 'Pattern', detail: `${bullPatterns.length} bullish patterns confirmed`, pts: 10, side: 'bull' }); }
      else if (bullPatterns.length === 1) { bullScore += 5; scoreLog.push({ cat: 'Pattern', detail: `${bullPatterns[0].name} detected`, pts: 5, side: 'bull' }); }
      else if (strongBearPat >= 2) { bearScore += 15; scoreLog.push({ cat: 'Pattern', detail: `${strongBearPat} HIGH strength bear patterns`, pts: 15, side: 'bear' }); }
      else if (bearPatterns.length >= 2) { bearScore += 10; scoreLog.push({ cat: 'Pattern', detail: `${bearPatterns.length} bearish patterns confirmed`, pts: 10, side: 'bear' }); }
      else if (bearPatterns.length === 1) { bearScore += 5; scoreLog.push({ cat: 'Pattern', detail: `${bearPatterns[0].name} detected`, pts: 5, side: 'bear' }); }
      else scoreLog.push({ cat: 'Pattern', detail: 'No significant chart pattern', pts: 0, side: 'neutral' });

      // 5. DERIVATIVES (max 12pts)
      let derivScore = 0, derivSide = 'neutral', derivDetail = [];
      if (fundingRate < -0.04) { derivScore += 4; derivSide = 'bull'; derivDetail.push(`FR ${fundingRate.toFixed(4)}% (neg=long bias)`); }
      else if (fundingRate > 0.08) { derivScore += 4; derivSide = 'bear'; derivDetail.push(`FR ${fundingRate.toFixed(4)}% (high=caution)`); }
      if (lsRatioVal < 0.85) { derivScore += 4; if (derivSide !== 'bear') derivSide = 'bull'; derivDetail.push(`L/S ${lsRatioVal.toFixed(2)} (retail short=contrarian long)`); }
      else if (lsRatioVal > 1.9) { derivScore += 4; derivSide = 'bear'; derivDetail.push(`L/S ${lsRatioVal.toFixed(2)} (retail long=contrarian short)`); }
      if (takerRatio > 1.12) { derivScore += 4; if (derivSide !== 'bear') derivSide = 'bull'; derivDetail.push(`Taker ${takerRatio.toFixed(2)} (aggressive buying)`); }
      else if (takerRatio < 0.88) { derivScore += 4; derivSide = 'bear'; derivDetail.push(`Taker ${takerRatio.toFixed(2)} (aggressive selling)`); }
      if (derivScore > 0) {
        if (derivSide === 'bull') bullScore += derivScore;
        else bearScore += derivScore;
        scoreLog.push({ cat: 'Derivatives', detail: derivDetail.join(' | '), pts: derivScore, side: derivSide });
      } else scoreLog.push({ cat: 'Derivatives', detail: 'Neutral derivatives data', pts: 0, side: 'neutral' });

      // 6. RSI 4H ZONE (max 8pts)
      const rsi4h = tf4h.rsi;
      if (rsi4h < 35) { bullScore += 8; scoreLog.push({ cat: 'RSI 4H', detail: `RSI ${rsi4h.toFixed(1)} — oversold reversal zone`, pts: 8, side: 'bull' }); }
      else if (rsi4h > 68) { bearScore += 8; scoreLog.push({ cat: 'RSI 4H', detail: `RSI ${rsi4h.toFixed(1)} — overbought pullback zone`, pts: 8, side: 'bear' }); }
      else if (rsi4h > 45 && rsi4h < 60) { bullScore += 4; scoreLog.push({ cat: 'RSI 4H', detail: `RSI ${rsi4h.toFixed(1)} — bullish momentum zone`, pts: 4, side: 'bull' }); }
      else scoreLog.push({ cat: 'RSI 4H', detail: `RSI ${rsi4h.toFixed(1)} — neutral zone`, pts: 0, side: 'neutral' });

      // 7. KILL ZONE BONUS (max 5pts — extra boost if active)
      if (killZone.active) {
        const kzPts = killZone.name.includes('OVERLAP') ? 5 : killZone.name.includes('LONDON') || killZone.name.includes('NY') ? 4 : 2;
        bullScore += kzPts;
        bearScore += kzPts;
        scoreLog.push({ cat: 'Kill Zone', detail: `${killZone.name} active — higher probability window`, pts: kzPts, side: 'both' });
      }

      // 8. LIQUIDITY TARGET (directional bonus)
      if (nearestBSL && nearestBSL.dist < 8) { bullScore += 5; scoreLog.push({ cat: 'Liquidity', detail: `BSL at $${nearestBSL.price.toFixed(2)} (+${nearestBSL.dist.toFixed(1)}%) — price magnet`, pts: 5, side: 'bull' }); }
      if (nearestSSL && nearestSSL.dist < 8) { bearScore += 5; scoreLog.push({ cat: 'Liquidity', detail: `SSL at $${nearestSSL.price.toFixed(2)} (-${nearestSSL.dist.toFixed(1)}%) — price magnet`, pts: 5, side: 'bear' }); }

      // ── FINAL VERDICT ─────────────────────────────────────────────
      const totalBull = bullScore;
      const totalBear = bearScore;
      const totalMax = Math.max(totalBull, totalBear);
      const probability = Math.min(Math.round(totalMax / 100 * 100), 95);
      const biasDir = totalBull > totalBear ? 'LONG' : totalBear > totalBull ? 'SHORT' : 'NEUTRAL';

      // SNIPER FILTER — only output signal if conditions met
      const mtfAlignedForEntry = (biasDir === 'LONG' && mtfBullScore >= 4) || (biasDir === 'SHORT' && mtfBearScore >= 4);
      const atKeyZone = scoreLog.some(s => s.cat === 'SMC Zone' && s.pts >= 15);
      const hasPattern = scoreLog.some(s => s.cat === 'Pattern' && s.pts >= 5);
      const sufficientProb = probability >= 65;

      let decision, decisionColor, entryCard = null;

      if (!sufficientProb || !mtfAlignedForEntry) {
        decision = 'WAIT — NO SETUP';
        decisionColor = '#7a8499';
      } else if (probability >= 80 && atKeyZone && mtfAlignedForEntry) {
        decision = biasDir === 'LONG' ? '🎯 SNIPER LONG ENTRY' : '🎯 SNIPER SHORT ENTRY';
        decisionColor = biasDir === 'LONG' ? '#00ffd0' : '#ff4466';

        // Build precise entry card
        const isLong = biasDir === 'LONG';

        // Entry: at OB/Demand zone or current price if already at zone
        let entryPrice = currentPrice;
        let slPrice, tp1Price, tp2Price, tp3Price;

        if (isLong) {
          const zoneEntry = nearestBullOB ? nearestBullOB.high : nearestDemand ? nearestDemand.high : null;
          entryPrice = zoneEntry && zoneEntry < currentPrice * 1.005 ? zoneEntry : currentPrice;
          // SL: below OB low or SSL or -1.5*ATR
          const obSL = nearestBullOB ? nearestBullOB.low * 0.999 : null;
          const sslSL = nearestSSL ? nearestSSL.price * 0.999 : null;
          const atrSL = entryPrice - atr4h * 1.5;
          slPrice = Math.max(...[obSL, sslSL, atrSL].filter(Boolean));
          // TP: FVG/BSL/resistance
          const tp1Base = entryPrice + (entryPrice - slPrice) * 1.5;
          const tp2Base = entryPrice + (entryPrice - slPrice) * 2.5;
          const tp3Base = nearestBSL ? nearestBSL.price * 0.998 : entryPrice + (entryPrice - slPrice) * 4;
          tp1Price = bullFVGs[0] ? Math.min(bullFVGs[0].high, tp1Base) : tp1Base;
          tp2Price = tp2Base;
          tp3Price = tp3Base;
        } else {
          const zoneEntry = nearestBearOB ? nearestBearOB.low : nearestSupply ? nearestSupply.low : null;
          entryPrice = zoneEntry && zoneEntry > currentPrice * 0.995 ? zoneEntry : currentPrice;
          const obSL = nearestBearOB ? nearestBearOB.high * 1.001 : null;
          const bslSL = nearestBSL ? nearestBSL.price * 1.001 : null;
          const atrSL = entryPrice + atr4h * 1.5;
          slPrice = Math.min(...[obSL, bslSL, atrSL].filter(Boolean));
          const tp1Base = entryPrice - (slPrice - entryPrice) * 1.5;
          const tp2Base = entryPrice - (slPrice - entryPrice) * 2.5;
          const tp3Base = nearestSSL ? nearestSSL.price * 1.002 : entryPrice - (slPrice - entryPrice) * 4;
          tp1Price = bearFVGs[0] ? Math.max(bearFVGs[0].low, tp1Base) : tp1Base;
          tp2Price = tp2Base;
          tp3Price = tp3Base;
        }

        const slDist = Math.abs(entryPrice - slPrice);
        const rr1 = Math.abs(tp1Price - entryPrice) / slDist;
        const rr2 = Math.abs(tp2Price - entryPrice) / slDist;
        const rr3 = Math.abs(tp3Price - entryPrice) / slDist;

        entryCard = {
          direction: biasDir,
          entry: parseFloat(entryPrice.toFixed(6)),
          sl: parseFloat(slPrice.toFixed(6)),
          tp1: parseFloat(tp1Price.toFixed(6)),
          tp2: parseFloat(tp2Price.toFixed(6)),
          tp3: parseFloat(tp3Price.toFixed(6)),
          rr1: parseFloat(rr1.toFixed(2)),
          rr2: parseFloat(rr2.toFixed(2)),
          rr3: parseFloat(rr3.toFixed(2)),
          slPct: parseFloat((slDist / entryPrice * 100).toFixed(2)),
          invalidation: `Trade invalid if price closes ${biasDir === 'LONG' ? 'below' : 'above'} $${parseFloat(slPrice.toFixed(6))}`,
          obZone: biasDir === 'LONG' ? nearestBullOB : nearestBearOB,
          liqTarget: biasDir === 'LONG' ? nearestBSL : nearestSSL
        };
      } else if (probability >= 65) {
        decision = biasDir === 'LONG' ? '⏳ WAIT FOR PULLBACK' : biasDir === 'SHORT' ? '⏳ WAIT FOR PULLBACK' : 'WAIT — NO CLEAR BIAS';
        decisionColor = '#FFB300';
      } else {
        decision = 'WAIT — NO SETUP';
        decisionColor = '#7a8499';
      }

      data = {
        symbol: sym,
        timestamp: Date.now(),
        currentPrice,
        decision,
        decisionColor,
        probability,
        biasDir,
        entryCard,
        killZone,
        mtf: { bullScore: mtfBullScore, bearScore: mtfBearScore, aligned: mtfAlignedForEntry, bias: mtfBias, tf1h: tf1h.trend, tf4h: tf4h.trend, tf1d: tf1d.trend },
        structure: { bias: structureBias, lastBOS },
        smc: { nearestBullOB, nearestBearOB, nearestDemand, nearestSupply, bullFVG: bullFVGs[0] || null, bearFVG: bearFVGs[0] || null },
        liquidity: { nearestBSL, nearestSSL },
        patterns: patterns.slice(0, 5),
        scoreLog,
        scoreBreakdown: { bull: totalBull, bear: totalBear },
        indicators: { rsi4h: parseFloat(tf4h.rsi.toFixed(1)), rsi1d: parseFloat(tf1d.rsi.toFixed(1)), fundingRate: parseFloat(fundingRate.toFixed(4)), lsRatio: parseFloat(lsRatioVal.toFixed(2)), takerRatio: parseFloat(takerRatio.toFixed(3)), fng: fngVal, stoch: parseFloat(stoch.toFixed(1)), bbPosition: parseFloat(((currentPrice - bb.lower) / (bb.upper - bb.lower) * 100).toFixed(1)), atr4h: parseFloat(atr4h.toFixed(4)), oiTrend, obImbalance: parseFloat((obImbalance * 100).toFixed(1)) }
      };

    // ─── BASIC CONFLUENCE (legacy support) ────────────────────────
    } else if (source === 'confluence') {
      const sym = params.symbol || 'BTCUSDT';
      const [k4h, k1d, oiH, lsR, taker, fund, depth, fng] = await Promise.allSettled([
        fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=4h&limit=200`).then(r => r.json()),
        fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=1d&limit=100`).then(r => r.json()),
        fetch(`https://fapi.binance.com/futures/data/openInterestHist?symbol=${sym}&period=4h&limit=20`).then(r => r.json()),
        fetch(`https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${sym}&period=4h&limit=10`).then(r => r.json()),
        fetch(`https://fapi.binance.com/futures/data/takerlongshortRatio?symbol=${sym}&period=4h&limit=10`).then(r => r.json()),
        fetch(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${sym}`).then(r => r.json()),
        fetch(`https://api.binance.com/api/v3/depth?symbol=${sym}&limit=50`).then(r => r.json()),
        fetch(`https://api.alternative.me/fng/?limit=1&format=json`).then(r => r.json()),
      ]);
      const calcEMA2 = (c, p) => { if (c.length < p) return c[c.length-1]; const k2 = 2/(p+1); let e = c.slice(0,p).reduce((a,b)=>a+b,0)/p; for(let i=p;i<c.length;i++) e=c[i]*k2+e*(1-k2); return e; };
      const calcRSI2 = (c, p=14) => { if(c.length<p+1) return 50; let g=0,l=0; for(let i=c.length-p;i<c.length;i++){const d=c[i]-c[i-1];if(d>0)g+=d;else l-=d;} return 100-(100/(1+g/(l||0.001))); };
      const scores = { bull: 0, bear: 0, signals: [] };
      if (k1d.status==='fulfilled' && Array.isArray(k1d.value)) {
        const c=k1d.value.map(k=>parseFloat(k[4])); const p=c[c.length-1]; const e200=calcEMA2(c,Math.min(200,c.length)); const e50=calcEMA2(c,Math.min(50,c.length));
        if(p>e200){scores.bull+=2;scores.signals.push({name:'HTF Trend',value:'BULLISH',detail:`Price > EMA200 ($${e200.toFixed(0)})`,weight:2,side:'bull'});}
        else{scores.bear+=2;scores.signals.push({name:'HTF Trend',value:'BEARISH',detail:`Price < EMA200 ($${e200.toFixed(0)})`,weight:2,side:'bear'});}
        if(e50>e200){scores.bull+=1;scores.signals.push({name:'EMA Cross',value:'GOLDEN',detail:'EMA50>EMA200',weight:1,side:'bull'});}
        else{scores.bear+=1;scores.signals.push({name:'EMA Cross',value:'DEATH',detail:'EMA50<EMA200',weight:1,side:'bear'});}
      }
      if (k4h.status==='fulfilled' && Array.isArray(k4h.value)) {
        const c=k4h.value.map(k=>parseFloat(k[4])); const rsi=calcRSI2(c); const macd=calcEMA2(c,12)-calcEMA2(c,26);
        if(rsi<35){scores.bull+=2;scores.signals.push({name:'RSI 4H',value:rsi.toFixed(1),detail:'Oversold',weight:2,side:'bull'});}
        else if(rsi>70){scores.bear+=2;scores.signals.push({name:'RSI 4H',value:rsi.toFixed(1),detail:'Overbought',weight:2,side:'bear'});}
        else if(rsi<50){scores.bull+=1;scores.signals.push({name:'RSI 4H',value:rsi.toFixed(1),detail:'Below Midline',weight:1,side:'bull'});}
        else{scores.bear+=1;scores.signals.push({name:'RSI 4H',value:rsi.toFixed(1),detail:'Above Midline',weight:1,side:'bear'});}
        if(macd>0){scores.bull+=1;scores.signals.push({name:'MACD 4H',value:macd.toFixed(2),detail:'Bullish',weight:1,side:'bull'});}
        else{scores.bear+=1;scores.signals.push({name:'MACD 4H',value:macd.toFixed(2),detail:'Bearish',weight:1,side:'bear'});}
      }
      if(oiH.status==='fulfilled'&&Array.isArray(oiH.value)&&oiH.value.length>=5){const o=oiH.value.map(x=>parseFloat(x.sumOpenInterest));const ch=((o[o.length-1]-o[o.length-5])/o[o.length-5])*100;const c4=k4h.status==='fulfilled'?k4h.value.map(k=>parseFloat(k[4])):[];const pu=c4.length>5&&c4[c4.length-1]>c4[c4.length-5];if(ch>2&&pu){scores.bull+=2;scores.signals.push({name:'OI+Price',value:`+${ch.toFixed(1)}%`,detail:'Long Buildup',weight:2,side:'bull'});}else if(ch>2&&!pu){scores.bear+=2;scores.signals.push({name:'OI+Price',value:`+${ch.toFixed(1)}%`,detail:'Short Buildup',weight:2,side:'bear'});}else{scores.signals.push({name:'OI+Price',value:`${ch.toFixed(1)}%`,detail:'Neutral',weight:0,side:'neutral'});}}
      if(lsR.status==='fulfilled'&&Array.isArray(lsR.value)&&lsR.value.length){const ls=parseFloat(lsR.value[lsR.value.length-1].longShortRatio);if(ls<0.9){scores.bull+=2;scores.signals.push({name:'L/S Ratio',value:ls.toFixed(2),detail:'Retail Short→Contrarian LONG',weight:2,side:'bull'});}else if(ls>1.8){scores.bear+=2;scores.signals.push({name:'L/S Ratio',value:ls.toFixed(2),detail:'Retail Long→Contrarian SHORT',weight:2,side:'bear'});}else{scores.signals.push({name:'L/S Ratio',value:ls.toFixed(2),detail:'Balanced',weight:0,side:'neutral'});}}
      if(taker.status==='fulfilled'&&Array.isArray(taker.value)&&taker.value.length){const avg=taker.value.slice(-5).reduce((s,v)=>s+parseFloat(v.buySellRatio),0)/5;if(avg>1.1){scores.bull+=2;scores.signals.push({name:'Taker CVD',value:avg.toFixed(2),detail:'Buyers Aggressive',weight:2,side:'bull'});}else if(avg<0.9){scores.bear+=2;scores.signals.push({name:'Taker CVD',value:avg.toFixed(2),detail:'Sellers Aggressive',weight:2,side:'bear'});}else{scores.signals.push({name:'Taker CVD',value:avg.toFixed(2),detail:'Neutral',weight:0,side:'neutral'});}}
      if(fund.status==='fulfilled'&&fund.value.lastFundingRate){const fr=parseFloat(fund.value.lastFundingRate)*100;if(fr<-0.05){scores.bull+=2;scores.signals.push({name:'Funding',value:`${fr.toFixed(4)}%`,detail:'Very Negative→Long',weight:2,side:'bull'});}else if(fr>0.1){scores.bear+=2;scores.signals.push({name:'Funding',value:`${fr.toFixed(4)}%`,detail:'High→Caution',weight:2,side:'bear'});}else if(fr<0){scores.bull+=1;scores.signals.push({name:'Funding',value:`${fr.toFixed(4)}%`,detail:'Slight Long Bias',weight:1,side:'bull'});}else{scores.signals.push({name:'Funding',value:`${fr.toFixed(4)}%`,detail:'Neutral',weight:0,side:'neutral'});}}
      if(depth.status==='fulfilled'&&depth.value.bids){const bv=depth.value.bids.reduce((s,b)=>s+parseFloat(b[1]),0);const av=depth.value.asks.reduce((s,a)=>s+parseFloat(a[1]),0);const im=bv/(bv+av);if(im>0.6){scores.bull+=1;scores.signals.push({name:'Order Book',value:`${(im*100).toFixed(0)}% Bid`,detail:'Bid Dominant',weight:1,side:'bull'});}else if(im<0.4){scores.bear+=1;scores.signals.push({name:'Order Book',value:`${((1-im)*100).toFixed(0)}% Ask`,detail:'Ask Dominant',weight:1,side:'bear'});}else{scores.signals.push({name:'Order Book',value:`${(im*100).toFixed(0)}% Bid`,detail:'Balanced',weight:0,side:'neutral'});}}
      if(fng.status==='fulfilled'&&fng.value.data){const f=parseInt(fng.value.data[0].value);const fl=fng.value.data[0].value_classification;if(f<=20){scores.bull+=2;scores.signals.push({name:'F&G',value:`${f}`,detail:'Extreme Fear=Buy',weight:2,side:'bull'});}else if(f>=80){scores.bear+=2;scores.signals.push({name:'F&G',value:`${f}`,detail:'Extreme Greed=Caution',weight:2,side:'bear'});}else if(f<40){scores.bull+=1;scores.signals.push({name:'F&G',value:`${f}`,detail:'Fear Zone',weight:1,side:'bull'});}else{scores.signals.push({name:'F&G',value:`${f}`,detail:'Neutral',weight:0,side:'neutral'});}}
      const tw=scores.bull+scores.bear; const bp=tw>0?Math.round(scores.bull/tw*100):50;
      let verdict,strength,action;
      if(bp>=70){verdict='STRONG LONG';strength='HIGH';action='ENTRY VALID — Confluence ≥70% Bullish';}
      else if(bp>=55){verdict='LONG BIAS';strength='MEDIUM';action='CAUTIOUS LONG';}
      else if(bp<=30){verdict='STRONG SHORT';strength='HIGH';action='ENTRY VALID — Confluence ≥70% Bearish';}
      else if(bp<=45){verdict='SHORT BIAS';strength='MEDIUM';action='CAUTIOUS SHORT';}
      else{verdict='NEUTRAL';strength='LOW';action='NO TRADE';}
      data={symbol:sym,timestamp:Date.now(),verdict,strength,action,bullScore:scores.bull,bearScore:scores.bear,bullPct:bp,bearPct:100-bp,signals:scores.signals};

    } else {
      return res.status(400).json({ error: `Unknown source: ${source}` });
    }

    res.setHeader('Cache-Control', 's-maxage=15');
    return res.status(200).json(data);

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
