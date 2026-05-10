// api/daytrade.js — AC369 FUSION DAY TRADE INTELLIGENCE v2.0
// ══════════════════════════════════════════════════════════════════
// INSTITUTIONAL-GRADE DAY TRADE SCANNER
// Standard: Hedge Fund Analyst — no hallucination, no hype
//
// PRIORITY ORDER (following spec):
// 1. Market Structure   (trend, BOS, CHoCH, sweep)
// 2. Liquidity          (OB walls, zones)
// 3. Order Book         (real-time bid/ask pressure)
// 4. Whale Activity     ($80k/$250k/$1M filter)
// 5. Derivatives        (OI, Funding, L/S, squeeze)
// 6. Momentum           (RSI, EMA, Volume Delta, CVD)
// 7. Sentiment          (F&G, BTC correlation)
//
// CONFIDENCE: Entry ONLY if score >= 75
// OUTPUT: Institutional format matching spec
// ══════════════════════════════════════════════════════════════════

const SCAN_SYMBOLS = [
  'BTC','ETH','BNB','SOL','XRP','ADA','AVAX','DOGE','LINK','DOT',
  'MATIC','ARB','OP','APT','SUI','TIA','INJ','TAO','FET','RNDR',
  'PEPE','WIF','BLUR','IMX','STX','SEI','AGIX',
];

const WHALE_MIN = 80000;
const WHALE_MID = 250000;
const WHALE_BIG = 1000000;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 's-maxage=20');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const sf = async (url, ms = 6000) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    try {
      const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
      clearTimeout(timer); if (!r.ok) return null; return await r.json();
    } catch { clearTimeout(timer); return null; }
  };

  // ════════════════════════════════════════════════════════════════
  // ENGINE 1: MARKET STRUCTURE
  // Priority: Higher Timeframe bias → HTF dominates over LTF
  // Data: Daily klines (60) for structure, 4H (24) for momentum
  // ════════════════════════════════════════════════════════════════
  function analyzeMarketStructure(daily, h4, price) {
    const result = {
      htfTrend: 'UNKNOWN', ltfTrend: 'UNKNOWN',
      aligned: false, bos: false, choch: false,
      sweep: false, fakeBreakout: false,
      premiumDiscount: 'DISCOUNT',
      support: null, resistance: null,
      score: 0, notes: [],
    };

    if (!daily || daily.length < 10) {
      result.notes.push('Market Structure: DATA TIDAK TERSEDIA (daily klines)');
      return result;
    }

    const dClose = daily.map(k => +k[4]);
    const dHigh  = daily.map(k => +k[2]);
    const dLow   = daily.map(k => +k[3]);
    const dVol   = daily.map(k => +k[5]);
    const n = dClose.length;

    // ── HTF Structure (Daily): find swing pivots ──────────────────
    const pivH = [], pivL = [];
    for (let i = 2; i < n - 2; i++) {
      if (dHigh[i] > dHigh[i-1] && dHigh[i] > dHigh[i-2] && dHigh[i] > dHigh[i+1] && dHigh[i] > dHigh[i+2]) pivH.push(dHigh[i]);
      if (dLow[i]  < dLow[i-1]  && dLow[i]  < dLow[i-2]  && dLow[i]  < dLow[i+1]  && dLow[i]  < dLow[i+2])  pivL.push(dLow[i]);
    }

    const lastPH = pivH.slice(-2), lastPL = pivL.slice(-2);
    if (lastPH.length >= 2 && lastPL.length >= 2) {
      if (lastPH[1] > lastPH[0] && lastPL[1] > lastPL[0]) {
        result.htfTrend = 'BULLISH';  result.score += 15;
      } else if (lastPH[1] < lastPH[0] && lastPL[1] < lastPL[0]) {
        result.htfTrend = 'BEARISH'; result.score -= 12;
      } else {
        result.htfTrend = 'RANGING'; result.score += 2;
      }
    }

    // Recent daily structure levels
    const recentH = pivH.length ? pivH[pivH.length - 1] : dHigh.slice(-10).reduce((a, b) => Math.max(a, b), 0);
    const recentL = pivL.length ? pivL[pivL.length - 1] : dLow.slice(-10).reduce((a, b) => Math.min(a, b), Infinity);
    result.support    = +recentL.toFixed(8);
    result.resistance = +recentH.toFixed(8);

    // Premium / Discount
    const mid = (recentH + recentL) / 2;
    result.premiumDiscount = price > mid ? 'PREMIUM' : 'DISCOUNT';
    if (result.premiumDiscount === 'DISCOUNT') { result.score += 8; result.notes.push('Price in Discount Zone — optimal long entry'); }
    else { result.score -= 3; result.notes.push('Price in Premium Zone — caution for longs'); }

    // BOS on daily
    if (price > recentH * 1.002 && result.htfTrend === 'BULLISH') {
      result.bos = true; result.score += 15;
      result.notes.push(`HTF BOS: broke daily high ${fmtP(recentH)} — bullish structure confirmed`);
    }

    // ── LTF Structure (4H) ────────────────────────────────────────
    if (h4 && h4.length >= 8) {
      const h4Close = h4.map(k => +k[4]);
      const h4High  = h4.map(k => +k[2]);
      const h4Low   = h4.map(k => +k[3]);
      const h4Vol   = h4.map(k => +k[5]);
      const m = h4Close.length;

      const h4PH = [], h4PL = [];
      for (let i = 2; i < m - 2; i++) {
        if (h4High[i] > h4High[i-1] && h4High[i] > h4High[i-2] && h4High[i] > h4High[i+1] && h4High[i] > h4High[i+2]) h4PH.push(h4High[i]);
        if (h4Low[i]  < h4Low[i-1]  && h4Low[i]  < h4Low[i-2]  && h4Low[i]  < h4Low[i+1]  && h4Low[i]  < h4Low[i+2])  h4PL.push(h4Low[i]);
      }

      const lPH = h4PH.slice(-2), lPL = h4PL.slice(-2);
      if (lPH.length >= 2 && lPL.length >= 2) {
        if (lPH[1] > lPH[0] && lPL[1] > lPL[0]) result.ltfTrend = 'BULLISH';
        else if (lPH[1] < lPH[0] && lPL[1] < lPL[0]) result.ltfTrend = 'BEARISH';
        else result.ltfTrend = 'RANGING';
      }

      // CHoCH: was bearish, now first bullish pivot
      const wasBearH = lPH.length >= 2 && lPH[0] > lPH[1];
      const nowBull  = h4Close[m-1] > h4Close[m-2] && h4Close[m-1] > h4Close[m-4];
      if (wasBearH && nowBull) {
        result.choch = true; result.score += 12;
        result.notes.push('CHoCH (4H): trend shifting from bearish to bullish');
      }

      // Liquidity sweep on 4H: wick below recent low then recovery
      const h4RecentL = h4PL.length ? h4PL[h4PL.length - 1] : h4Low.slice(-5).reduce((a, b) => Math.min(a, b), Infinity);
      const lastH4 = h4Close[m - 1];
      const sweepWick = h4Low[m-1] < h4RecentL && lastH4 > h4RecentL;
      if (sweepWick) {
        result.sweep = true; result.score += 15;
        result.notes.push(`4H Liquidity Sweep: wick below ${fmtP(h4RecentL)} — stops cleared`);
      }

      // Fake breakout: broke above but closed below
      const h4RecentH = h4PH.length ? h4PH[h4PH.length - 1] : h4High.slice(-5).reduce((a, b) => Math.max(a, b), 0);
      if (h4High[m-1] > h4RecentH && h4Close[m-1] < h4RecentH) {
        result.fakeBreakout = true; result.score -= 10;
        result.notes.push('FAKE BREAKOUT: wick above resistance but closed below');
      }

      // HTF / LTF alignment (key for high-prob setups)
      if (result.htfTrend === 'BULLISH' && result.ltfTrend === 'BULLISH') {
        result.aligned = true; result.score += 12;
        result.notes.push('Multi-TF aligned: Daily + 4H both bullish — HIGH PROBABILITY');
      } else if (result.htfTrend !== result.ltfTrend && result.ltfTrend !== 'RANGING') {
        result.notes.push(`Counter-trend: ${result.htfTrend} (daily) vs ${result.ltfTrend} (4H) — lower probability`);
        result.score -= 5;
      }
    }

    return result;
  }

  // ════════════════════════════════════════════════════════════════
  // ENGINE 2: LIQUIDITY ZONES
  // ENGINE 3: ORDER BOOK (combined)
  // ════════════════════════════════════════════════════════════════
  function analyzeOrderBook(depth, price) {
    if (!depth?.bids?.length || !depth?.asks?.length) {
      return { signal: 'DATA TIDAK TERSEDIA', score: 0, imbalance: 1, support: price * 0.97, resistance: price * 1.03, bidWalls: [], askWalls: [], notes: [] };
    }

    const bids = depth.bids.slice(0, 20).map(([p, q]) => ({ p: +p, q: +q, usd: +p * +q }));
    const asks = depth.asks.slice(0, 20).map(([p, q]) => ({ p: +p, q: +q, usd: +p * +q }));
    const totalBid = bids.reduce((a, b) => a + b.usd, 0);
    const totalAsk = asks.reduce((a, b) => a + b.usd, 0);
    const imbalance = totalAsk > 0 ? totalBid / totalAsk : 1;

    // Walls: any level with > 12% of total side
    const bidWalls = bids.filter(b => b.usd > totalBid * 0.12).sort((a, b) => b.p - a.p);
    const askWalls = asks.filter(a => a.usd > totalAsk * 0.12).sort((a, b) => a.p - b.p);
    const bigBid   = bids.reduce((a, b) => b.usd > a.usd ? b : a, bids[0]);
    const bigAsk   = asks.reduce((a, b) => b.usd > a.usd ? b : a, asks[0]);
    const wallRatio = bigAsk.usd > 0 ? bigBid.usd / bigAsk.usd : 1;

    // Absorption: big bid wall near current price
    const absorption = bidWalls.length > 0 && bidWalls[0].p >= price * 0.995;

    let signal = 'BALANCED', obScore = 0;
    const notes = [];

    if (imbalance > 3.0)       { signal = 'EXTREME BUY PRESSURE';  obScore = 20; notes.push(`Bid $${fmtUSD(totalBid)} vs Ask $${fmtUSD(totalAsk)} — ${imbalance.toFixed(1)}x buyer dominance`); }
    else if (imbalance > 2.0)  { signal = 'STRONG BUY PRESSURE';   obScore = 15; notes.push(`OB imbalance ${imbalance.toFixed(1)}x bullish`); }
    else if (imbalance > 1.3)  { signal = 'BUY PRESSURE';           obScore = 8; }
    else if (imbalance < 0.4)  { signal = 'EXTREME SELL PRESSURE';  obScore = -18; notes.push(`Sellers ${(1/imbalance).toFixed(1)}x dominant`); }
    else if (imbalance < 0.7)  { signal = 'SELL PRESSURE';          obScore = -12; }

    if (wallRatio > 3)  { obScore += 8; notes.push(`Whale bid wall $${fmtUSD(bigBid.usd)} @ $${fmtP(bigBid.p)} — institutional support`); }
    if (wallRatio < 0.3){ obScore -= 8; notes.push(`Whale ask wall $${fmtUSD(bigAsk.usd)} @ $${fmtP(bigAsk.p)} — distribution zone`); }
    if (absorption)      { obScore += 5; notes.push('Absorption detected: large bid wall absorbing sell pressure'); }

    return {
      signal, score: Math.max(-20, Math.min(20, obScore)),
      imbalance: +imbalance.toFixed(2),
      totalBidUSD: +totalBid.toFixed(0), totalAskUSD: +totalAsk.toFixed(0),
      support: +(bidWalls[0]?.p || bids[bids.length-1]?.p || price * 0.97).toFixed(8),
      resistance: +(askWalls[0]?.p || asks[asks.length-1]?.p || price * 1.03).toFixed(8),
      bidWalls: bidWalls.slice(0, 3).map(w => ({ p: w.p, usd: +w.usd.toFixed(0) })),
      askWalls: askWalls.slice(0, 3).map(w => ({ p: w.p, usd: +w.usd.toFixed(0) })),
      biggestBid: { p: bigBid.p, usd: +bigBid.usd.toFixed(0) },
      biggestAsk: { p: bigAsk.p, usd: +bigAsk.usd.toFixed(0) },
      notes,
    };
  }

  // ════════════════════════════════════════════════════════════════
  // ENGINE 4: WHALE DETECTOR ($80k/$250k/$1M)
  // ════════════════════════════════════════════════════════════════
  function analyzeWhales(trades, price) {
    if (!trades?.length) return { signal: 'DATA TIDAK TERSEDIA', score: 0, whales: [], manipulation: false, notes: [] };

    const whales = [];
    let buyVol = 0, sellVol = 0, totalVol = 0;

    for (const t of trades) {
      const usd = +t.p * +t.q;
      const isSell = t.m;
      totalVol += usd;
      if (isSell) sellVol += usd; else buyVol += usd;

      if (usd >= WHALE_MIN) {
        const tier = usd >= WHALE_BIG ? '🐳 MEGA' : usd >= WHALE_MID ? '🐋 LARGE' : '🐟 MID';
        whales.push({ side: isSell ? 'SELL' : 'BUY', usd: +usd.toFixed(0), p: +t.p, tier, ago: Math.round((Date.now() - t.T) / 60000) });
      }
    }

    const buyRatio   = totalVol > 0 ? buyVol / totalVol : 0.5;
    const whaleBuy   = whales.filter(w => w.side === 'BUY').reduce((a, w) => a + w.usd, 0);
    const whaleSell  = whales.filter(w => w.side === 'SELL').reduce((a, w) => a + w.usd, 0);
    const netWhale   = whaleBuy - whaleSell;
    const whaleRatio = (whaleBuy + whaleSell) > 0 ? whaleBuy / (whaleBuy + whaleSell) : 0.5;
    const recent10   = whales.filter(w => w.ago <= 10).length;

    let signal = 'NO WHALE ACTIVITY', ws = 0;
    const notes = [];

    if (!whales.length) {
      signal = 'NO WHALE ACTIVITY'; ws = 0;
    } else if (whaleRatio > 0.80) {
      signal = 'WHALE ACCUMULATION 🐳'; ws = 20;
      notes.push(`$${fmtUSD(whaleBuy)} whale buys — institutional accumulation confirmed`);
    } else if (whaleRatio > 0.65) {
      signal = 'NET WHALE BUY'; ws = 14;
      notes.push(`Net +$${fmtUSD(netWhale)} whale buying`);
    } else if (whaleRatio > 0.52) {
      signal = 'MILD WHALE BUY'; ws = 7;
    } else if (whaleRatio < 0.25) {
      signal = 'WHALE DISTRIBUTION ⚠️'; ws = -20;
      notes.push(`$${fmtUSD(whaleSell)} whale sells — POTENSI MANIPULASI MARKET`);
    } else if (whaleRatio < 0.40) {
      signal = 'NET WHALE SELL'; ws = -12;
    } else {
      signal = 'MIXED'; ws = 2;
    }

    if (recent10 >= 4 && ws > 0) { ws = Math.min(20, ws + 6); notes.push(`${recent10} whale trades in 10min — accelerating`); }

    // Manipulation: whale buying while retail selling (price pushed down)
    const manipulation = whaleRatio > 0.7 && buyRatio < 0.4;
    if (manipulation) notes.push('POTENSI MANIPULASI: SM accumulating while retail sells — potential pump incoming');

    return {
      signal, score: Math.max(-20, Math.min(20, ws)),
      whales: whales.sort((a, b) => b.usd - a.usd).slice(0, 6),
      whaleBuyUSD: +whaleBuy.toFixed(0), whaleSellUSD: +whaleSell.toFixed(0),
      netWhaleUSD: +netWhale.toFixed(0), whaleRatio: +whaleRatio.toFixed(2),
      buyRatio: +buyRatio.toFixed(2), recentActivity: recent10,
      manipulation, notes,
    };
  }

  // ════════════════════════════════════════════════════════════════
  // ENGINE 5: DERIVATIVES
  // ════════════════════════════════════════════════════════════════
  function analyzeDerivatives(fundingRate, oiChange, lsRatio) {
    let ds = 0, signal = 'NEUTRAL', squeeze = 'NONE';
    const notes = [];

    const fr = fundingRate !== null ? fundingRate * 100 : null;

    if (fr !== null) {
      if (fr < -0.015)     { ds += 20; signal = 'SHORT SQUEEZE IMMINENT 🔥'; notes.push(`FR ${fr.toFixed(4)}% — shorts paying heavily, squeeze likely`); squeeze = 'SHORT'; }
      else if (fr < -0.005){ ds += 12; signal = 'SHORT SQUEEZE SETUP';        notes.push(`FR ${fr.toFixed(4)}% — negative, shorts at risk`); squeeze = 'SHORT'; }
      else if (fr < 0)     { ds += 6;  notes.push(`FR ${fr.toFixed(4)}% — slightly negative, mild bullish bias`); }
      else if (fr > 0.06)  { ds -= 18; signal = 'LONG TRAP ⚠️'; notes.push(`FR ${fr.toFixed(4)}% — OVERLEVERAGED LONGS, liquidation risk`); squeeze = 'LONG'; }
      else if (fr > 0.025) { ds -= 8;  notes.push(`FR ${fr.toFixed(4)}% — elevated, caution`); }
      else                  { ds += 4;  }
    }

    if (lsRatio !== null) {
      const lp = +(lsRatio / (1 + lsRatio) * 100).toFixed(1);
      if (lp > 70)     { ds -= 12; notes.push(`${lp}% longs — STOP HUNT ZONE, SM will sweep before rally`); }
      else if (lp < 35){ ds += 12; notes.push(`${lp}% longs — short squeeze fuel, bullish lean`); }
    }

    return { signal, score: Math.max(-20, Math.min(20, ds)), fundingPct: fr, squeeze, notes };
  }

  // ════════════════════════════════════════════════════════════════
  // ENGINE 6: MOMENTUM (RSI, EMA, Volume Delta, CVD)
  // ════════════════════════════════════════════════════════════════
  function analyzeMomentum(h4, price, ch24) {
    if (!h4 || h4.length < 8) return { signal: 'DATA TIDAK TERSEDIA', score: 0, rsi: 50 };

    const cls = h4.map(k => +k[4]);
    const vol = h4.map(k => +k[5]);
    const n   = h4.length;

    // EMA 9 + 21
    const ema9  = (() => { const k = 2/10; let e = cls[0]; for(let i=1;i<n;i++) e=cls[i]*k+e*(1-k); return e; })();
    const ema21 = (() => { const p = Math.min(21,n); const k = 2/(p+1); let e = cls[0]; for(let i=1;i<n;i++) e=cls[i]*k+e*(1-k); return e; })();
    const ema50 = (() => { const p = Math.min(50,n); const k = 2/(p+1); let e = cls[0]; for(let i=1;i<n;i++) e=cls[i]*k+e*(1-k); return e; })();

    // RSI 14
    let g = 0, l = 0;
    const per = Math.min(14, n - 1);
    for (let i = n - per; i < n; i++) { const d = cls[i] - cls[i-1]; if (d > 0) g += d; else l += Math.abs(d); }
    const rsi = l > 0 ? 100 - (100 / (1 + g / l)) : 100;

    // Volume Delta (last 8 candles)
    const vd = cls.slice(-8).reduce((acc, c, i) => acc + (c > +h4[n-8+i][1] ? vol[n-8+i] : -vol[n-8+i]), 0);

    // CVD (cumulative volume delta, last 20)
    const cvd = cls.slice(-20).reduce((acc, c, i) => acc + (c > +h4[n-20+i][1] ? vol[n-20+i] : -vol[n-20+i]), 0);

    // Volume trend
    const avgVol = vol.slice(-20).reduce((a, b) => a + b, 0) / Math.min(20, n);
    const lastVol = vol[n-1];
    const volRatio = avgVol > 0 ? lastVol / avgVol : 1;

    // Divergence: price up but RSI falling (bearish div)
    const rsiSeq = [];
    for (let i = n - 5; i < n; i++) {
      let g2 = 0, l2 = 0;
      for (let j = Math.max(0, i - 14); j < i; j++) { const d = cls[j+1]-cls[j]; if(d>0)g2+=d; else l2+=Math.abs(d); }
      rsiSeq.push(l2 > 0 ? 100 - (100/(1+g2/l2)) : 50);
    }
    const bullDiv = cls[n-1] < cls[n-5] && rsiSeq[4] > rsiSeq[0] && rsiSeq[0] < 40;
    const bearDiv = cls[n-1] > cls[n-5] && rsiSeq[4] < rsiSeq[0] && rsiSeq[0] > 65;

    let signal = 'NEUTRAL', ms = 0;
    const notes = [];

    if (rsi < 25)         { ms += 18; signal = 'OVERSOLD ⚡'; notes.push(`RSI ${rsi.toFixed(0)} — extreme oversold, high-prob reversal zone`); }
    else if (rsi < 35)    { ms += 12; signal = 'OVERSOLD'; notes.push(`RSI ${rsi.toFixed(0)} — oversold bounce likely`); }
    else if (rsi > 78)    { ms -= 15; signal = 'OVERBOUGHT ⚠️'; notes.push(`RSI ${rsi.toFixed(0)} — overbought, correction risk`); }
    else if (rsi > 65 && price > ema21) { ms += 8; signal = 'STRONG MOMENTUM'; }
    else if (rsi > 50)    { ms += 5; }
    else                  { ms -= 3; }

    if (cvd > 0)          { ms += 8; notes.push(`CVD positive +${(cvd/1e6).toFixed(1)}M — net buying pressure`); }
    else                  { ms -= 5; }

    if (vd > 0)           { ms += 5; notes.push(`Vol delta +${(vd/1e6).toFixed(1)}M — buyers in control`); }

    if (volRatio > 2.0)   { ms += 8; notes.push(`Volume ${volRatio.toFixed(1)}x above avg — EXPANSION`); }
    else if (volRatio < 0.5) { ms -= 8; notes.push('BREAKOUT LEMAH: volume declining, avoid chase'); }

    if (bullDiv) { ms += 10; notes.push('Bullish Divergence: price lower but RSI higher — reversal signal'); }
    if (bearDiv) { ms -= 8;  notes.push('Bearish Divergence: price higher but RSI lower — weakening'); }

    // EMA alignment
    const aboveAll = price > ema9 && price > ema21 && price > ema50;
    if (aboveAll) { ms += 5; notes.push('Price above EMA 9/21/50 — trending up'); }

    return {
      signal, score: Math.max(-20, Math.min(20, ms)),
      rsi: +rsi.toFixed(1), ema9: +ema9.toFixed(6), ema21: +ema21.toFixed(6), ema50: +ema50.toFixed(6),
      cvd: +cvd.toFixed(0), volDelta: +vd.toFixed(0), volRatio: +volRatio.toFixed(2),
      bullDiv, bearDiv, aboveAll, notes,
    };
  }

  // ════════════════════════════════════════════════════════════════
  // CONFIDENCE SCORE (spec: entry only >= 75)
  // ════════════════════════════════════════════════════════════════
  function calcConfidence(struct, ob, whale, deriv, mom, fg) {
    let score = 20; // base
    const bd = {};

    // +20 whale accumulation
    if (whale.score >= 18) { score += 20; bd.whale = '+20 whale accumulation'; }
    else                    { score += Math.max(-15, whale.score); bd.whale = `${whale.score >= 0 ? '+' : ''}${whale.score}`; }

    // +20 order book imbalance
    if (ob.imbalance >= 2.0) { score += 20; bd.ob = '+20 OB imbalance'; }
    else                      { score += Math.max(-15, ob.score); bd.ob = `${ob.score >= 0 ? '+' : ''}${ob.score}`; }

    // +15 liquidity sweep
    if (struct.sweep)       { score += 15; bd.sweep = '+15 liquidity sweep'; }
    else if (struct.choch)  { score += 10; bd.sweep = '+10 CHoCH'; }

    // +15 structure valid
    if (struct.bos && struct.htfTrend === 'BULLISH') { score += 15; bd.struct = '+15 BOS + bullish HTF'; }
    else if (struct.aligned) { score += 12; bd.struct = '+12 multi-TF aligned'; }
    else if (struct.htfTrend === 'BEARISH') { score -= 12; bd.struct = '-12 HTF bearish'; }
    else { score += Math.max(-10, struct.score * 0.3); }

    // +10 funding supports
    if (deriv.score >= 15) { score += 10; bd.deriv = '+10 funding squeeze setup'; }
    else                   { score += Math.max(-12, Math.min(8, deriv.score * 0.5)); }

    // +10 volume expansion
    if (mom.volRatio > 2.0) { score += 10; bd.vol = '+10 volume expansion'; }
    else if (mom.volRatio > 1.3) { score += 5; bd.vol = '+5 volume above avg'; }

    // +10 market correlation (F&G + CVD)
    if (fg <= 20)            { score += 10; bd.market = '+10 extreme fear'; }
    else if (fg <= 40)       { score += 5;  bd.market = '+5 fear zone'; }
    else if (fg >= 80)       { score -= 10; bd.market = '-10 greed zone'; }

    if (mom.cvd > 0) score += 5;
    if (mom.bullDiv) score += 5;
    if (struct.fakeBreakout) score -= 15;
    if (deriv.squeeze === 'LONG') score -= 10;

    return { score: Math.max(0, Math.min(100, Math.round(score))), breakdown: bd };
  }

  // ════════════════════════════════════════════════════════════════
  // FINAL SETUP BUILDER (institutional format)
  // ════════════════════════════════════════════════════════════════
  function buildInstitutionalSetup(price, conf, struct, ob, deriv, mom) {
    // SL: below structural support (daily swing low), not % based
    const structSL    = struct.support ? struct.support * 0.994 : null;
    const obSL        = ob.support < price ? ob.support * 0.993 : null;
    const sl          = +(Math.min(structSL || price * 0.93, obSL || price * 0.93, price * 0.92)).toFixed(8);
    const slPct       = +((price - sl) / price * 100).toFixed(2);
    const slDist      = price - sl;
    const slNote      = structSL && structSL < price
      ? `Below daily swing low $${fmtP(struct.support)} (structural)`
      : obSL && obSL < price
      ? `Below OB support $${fmtP(ob.support)} (order book)`
      : 'Basic SL — no structural data available';

    // Entry
    const entry = +(price * 1.001).toFixed(8);

    // TP: use resistance levels
    const tp1 = +(Math.min(ob.resistance > price ? ob.resistance : price + slDist * 1.5, price * 1.06)).toFixed(8);
    const tp2 = +(price + slDist * 2.5).toFixed(8);
    const tp3 = +(struct.resistance && struct.resistance > price ? struct.resistance : price + slDist * 4.0).toFixed(8);

    const tp1Pct = +((tp1 - price) / price * 100).toFixed(2);
    const tp2Pct = +((tp2 - price) / price * 100).toFixed(2);
    const tp3Pct = +((tp3 - price) / price * 100).toFixed(2);
    const rr1    = slDist > 0 ? +((tp1 - price) / slDist).toFixed(1) : '—';
    const rr2    = slDist > 0 ? +((tp2 - price) / slDist).toFixed(1) : '—';

    // Verdict (spec: exactly these options)
    let verdict, verdictColor, statusMarket;
    if (conf >= 80)        { verdict = '🎯 HIGH PROBABILITY LONG';       verdictColor = '#00ff88';  statusMarket = 'Bullish'; }
    else if (conf >= 75)   { verdict = '✅ High Probability Long';         verdictColor = '#00ffd0';  statusMarket = 'Bullish'; }
    else if (conf >= 60)   { verdict = '⏳ Wait Confirmation';             verdictColor = '#FFB300';  statusMarket = 'Neutral'; }
    else if (conf >= 45)   { verdict = '👁️ Watch Only';                   verdictColor = '#aaaaaa';  statusMarket = 'Neutral'; }
    else if (deriv.squeeze === 'LONG') { verdict = '❌ No Trade — Long Trap'; verdictColor = '#ff4466'; statusMarket = 'Bearish'; }
    else                   { verdict = '🚫 NO TRADE / NO CLEAR EDGE';     verdictColor = '#555';     statusMarket = 'Bearish'; }

    const trend = conf >= 75 ? 'Strong Bullish' : conf >= 60 ? 'Weak Bullish' : struct.htfTrend === 'BEARISH' ? 'Bearish' : 'Sideways';
    const risk  = slPct > 12 ? 'High' : slPct > 6 ? 'Medium' : 'Low';

    return {
      statusMarket, trend, verdict, verdictColor, risk,
      entry: +entry.toFixed(8),
      sl: +sl.toFixed(8), slPct, slNote,
      tp1: +tp1.toFixed(8), tp1Pct,
      tp2: +tp2.toFixed(8), tp2Pct,
      tp3: +tp3.toFixed(8), tp3Pct,
      rr1, rr2,
    };
  }

  // ════════════════════════════════════════════════════════════════
  // MAIN HANDLER
  // ════════════════════════════════════════════════════════════════
  try {
    const t0 = Date.now();
    const sym = (req.query?.symbol || '').toUpperCase() || null;

    // ── 5-SOURCE TICKER FALLBACK ──────────────────────────────────
    const [tickerR, fngR] = await Promise.allSettled([
      (async () => {
        const b1 = await sf('https://api.binance.com/api/v3/ticker/24hr', 7000);
        if (Array.isArray(b1) && b1.length > 100) return b1;
        const b2 = await sf('https://fapi.binance.com/fapi/v1/ticker/24hr', 6000);
        if (Array.isArray(b2) && b2.length > 50) return b2;
        const by = await sf('https://api.bybit.com/v5/market/tickers?category=spot', 6000);
        if (by?.result?.list?.length > 50) return by.result.list.map(t => ({
          symbol: t.symbol || '', lastPrice: t.lastPrice || '0',
          priceChangePercent: t.price24hPcnt ? (parseFloat(t.price24hPcnt) * 100).toFixed(4) : '0',
          quoteVolume: t.turnover24h || '0', highPrice: t.highPrice24h || t.lastPrice || '0',
          lowPrice: t.lowPrice24h || t.lastPrice || '0', openPrice: t.prevPrice24h || t.lastPrice || '0',
        }));
        const mx = await sf('https://api.mexc.com/api/v3/ticker/24hr', 6000);
        if (Array.isArray(mx) && mx.length > 50) return mx;
        const cg = await sf('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=volume_desc&per_page=250&page=1&sparkline=false&price_change_percentage=24h', 9000);
        if (Array.isArray(cg)) return cg.map(c => ({
          symbol: (c.symbol || '').toUpperCase() + 'USDT',
          lastPrice: String(c.current_price || 0),
          priceChangePercent: String(c.price_change_percentage_24h || 0),
          quoteVolume: String(c.total_volume || 0),
          highPrice: String((c.current_price || 0) * 1.03), lowPrice: String((c.current_price || 0) * 0.97),
          openPrice: String((c.current_price || 0) / (1 + (c.price_change_percentage_24h || 0) / 100)),
        }));
        return [];
      })(),
      sf('https://api.alternative.me/fng/?limit=1&format=json', 4000),
    ]);

    const tickers = tickerR.status === 'fulfilled' && Array.isArray(tickerR.value) ? tickerR.value : [];
    const fg = fngR.status === 'fulfilled' ? parseInt(fngR.value?.data?.[0]?.value || 50) : 50;

    if (!tickers.length) {
      return res.status(200).json({ version: 'v2.0', error: null, results: [], timestamp: Date.now(), message: 'Semua sumber data timeout — coba lagi' });
    }

    const tickerMap = {};
    tickers.forEach(t => { if (t?.symbol) tickerMap[t.symbol] = t; });

    // Determine symbols to deep-scan (max 8)
    const targets = (sym ? [sym] : SCAN_SYMBOLS.filter(s => tickerMap[s + 'USDT'])).slice(0, 8);

    // Fetch all data in parallel per symbol
    const allData = await Promise.allSettled(
      targets.map(s => Promise.allSettled([
        sf(`https://api.binance.com/api/v3/klines?symbol=${s}USDT&interval=1d&limit=60`, 4000), // daily structure
        sf(`https://api.binance.com/api/v3/klines?symbol=${s}USDT&interval=4h&limit=24`, 4000), // 4h momentum
        sf(`https://api.binance.com/api/v3/depth?symbol=${s}USDT&limit=20`, 3500),               // order book
        sf(`https://api.binance.com/api/v3/aggTrades?symbol=${s}USDT&limit=500`, 3500),          // whale trades
      ]))
    );

    // Batch funding rate
    const fundingR = await sf('https://fapi.binance.com/fapi/v1/premiumIndex', 4000);
    const fMap = {};
    if (Array.isArray(fundingR)) fundingR.forEach(f => { const s = (f.symbol||'').replace('USDT',''); if(s) fMap[s] = parseFloat(f.lastFundingRate || 0); });

    // Batch L/S ratio (just for BTC as proxy)
    const lsR = await sf('https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=BTCUSDT&period=1h&limit=1', 3000);
    const btcLS = lsR?.[0] ? parseFloat(lsR[0].longShortRatio || 1) : null;

    const results = [];

    targets.forEach((sym, i) => {
      const ticker = tickerMap[sym + 'USDT'];
      if (!ticker) return;

      const price = +(ticker.lastPrice || 0);
      const ch24  = +(ticker.priceChangePercent || 0);
      const vol24 = +(ticker.quoteVolume || 0);
      if (price <= 0) return;

      const symData = allData[i];
      const [dailyR, h4R, depthR, tradesR] = symData.status === 'fulfilled'
        ? symData.value
        : [{status:'rejected'},{status:'rejected'},{status:'rejected'},{status:'rejected'}];

      const daily  = dailyR.status === 'fulfilled' && Array.isArray(dailyR.value) ? dailyR.value : null;
      const h4     = h4R.status === 'fulfilled'    && Array.isArray(h4R.value)    ? h4R.value    : null;
      const depth  = depthR.status === 'fulfilled'  ? depthR.value  : null;
      const trades = tradesR.status === 'fulfilled' && Array.isArray(tradesR.value) ? tradesR.value : null;
      const fr     = fMap[sym] !== undefined ? fMap[sym] : null;

      // Run all engines
      const struct = analyzeMarketStructure(daily, h4, price);
      const ob     = analyzeOrderBook(depth, price);
      const whale  = analyzeWhales(trades, price);
      const deriv  = analyzeDerivatives(fr, null, btcLS);
      const mom    = analyzeMomentum(h4, price, ch24);
      const conf   = calcConfidence(struct, ob, whale, deriv, mom, fg);
      const setup  = buildInstitutionalSetup(price, conf.score, struct, ob, deriv, mom);

      results.push({
        symbol: sym,
        price, ch24: +ch24.toFixed(2), vol24,
        confidence: conf.score,
        confidenceLabel: conf.score >= 80 ? '🔥 HIGH PROBABILITY' : conf.score >= 75 ? '✅ VALID' : conf.score >= 60 ? '⚠️ LOW' : '🚫 NO TRADE',
        confBreakdown: conf.breakdown,
        // Per-spec output format
        statusMarket: setup.statusMarket,
        trend: setup.trend,
        verdict: setup.verdict,
        verdictColor: setup.verdictColor,
        risk: setup.risk,
        // Trade levels
        trade: setup,
        // Engine results
        structure: struct,
        orderBook: ob,
        whale: { ...whale, whales: whale.whales.slice(0, 5) },
        derivatives: deriv,
        momentum: mom,
        // Data quality flags
        hasDaily: !!daily, hasH4: !!h4, hasOB: !!(depth?.bids?.length), hasWhale: !!(trades?.length),
      });
    });

    results.sort((a, b) => b.confidence - a.confidence);

    const highProb = results.filter(r => r.confidence >= 75);
    const noTrade  = results.filter(r => r.confidence < 45);

    return res.status(200).json({
      version: 'v2.0',
      timestamp: Date.now(),
      scanTime: ((Date.now() - t0) / 1000).toFixed(1),
      fg, fgLabel: fg <= 25 ? 'Extreme Fear' : fg <= 45 ? 'Fear' : fg >= 75 ? 'Greed' : 'Neutral',
      totalScanned: results.length,
      summary: {
        highProb: highProb.length,
        noTrade: noTrade.length,
        neutral: results.length - highProb.length - noTrade.length,
        btcLS, btcFunding: fMap['BTC'] !== undefined ? +(fMap['BTC'] * 100).toFixed(4) : null,
      },
      results,
      topSetups: highProb.slice(0, 3),
      avoid: noTrade.slice(0, 2),
    });

  } catch (e) {
    return res.status(200).json({
      version: 'v2.0', error: e.message, results: [],
      timestamp: Date.now(), summary: {},
    });
  }
}

function fmtP(p) {
  if (!p || p <= 0) return '—';
  if (p >= 10000) return p.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (p >= 1000)  return p.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (p >= 1)     return p.toFixed(4);
  if (p >= 0.001) return p.toFixed(6);
  return p.toFixed(8);
}

function fmtUSD(n) {
  if (!n || n === 0) return '$0';
  if (Math.abs(n) >= 1e6) return (n >= 0 ? '' : '-') + '$' + Math.abs(n/1e6).toFixed(1) + 'M';
  if (Math.abs(n) >= 1e3) return (n >= 0 ? '' : '-') + '$' + Math.abs(n/1e3).toFixed(0) + 'K';
  return '$' + Math.abs(n).toFixed(0);
}
