// api/memes.js — AC369 FUSION MEME INTELLIGENCE v3.0
// ══════════════════════════════════════════════════════════════════
// INSTITUTIONAL-GRADE MEME COIN SCANNER
// Following hedge fund analyst standards — no hallucination
//
// ENGINE 1: MARKET STRUCTURE     (HH/HL/LH/LL, BOS, CHoCH, Sweep)
// ENGINE 2: ORDER BOOK           (Walls, Absorption, Imbalance)
// ENGINE 3: WHALE DETECTOR       (>$80k/>$250k/>$1M trades)
// ENGINE 4: DERIVATIVES          (OI, Funding, L/S, Squeeze)
// ENGINE 5: MOMENTUM & VOLUME    (Volume Delta, CVD, Divergence)
//
// CONFIDENCE SCORE: 0-100 | Entry ONLY if score >= 65
// OUTPUT: Exact Entry / SL / TP1 / TP2 / TP3 / Verdict
// ══════════════════════════════════════════════════════════════════

const MEME_SYMBOLS = [
  'DOGE','SHIB','PEPE','BONK','WIF','FLOKI','BRETT','MOG','NEIRO',
  'GOAT','PNUT','ACT','TURBO','PEOPLE','MOODENG','LUNC','BOME',
  'MEME','HOT','DOGS','HMSTR','CATI','NOT','BABYDOGE',
  'GIGA','POPCAT','PONKE','SLERF','AIDOGE',
];

const MEME_META = {
  DOGE:{cat:'OG',gen:1,chain:'Multi'}, SHIB:{cat:'OG',gen:1,chain:'ETH'},
  LUNC:{cat:'OG',gen:1,chain:'Terra'}, PEPE:{cat:'Frog',gen:2,chain:'ETH'},
  BRETT:{cat:'Frog',gen:2,chain:'Base'}, MOG:{cat:'Frog',gen:2,chain:'ETH'},
  BONK:{cat:'SOL',gen:2,chain:'Solana'}, WIF:{cat:'SOL',gen:2,chain:'Solana'},
  POPCAT:{cat:'SOL',gen:2,chain:'Solana'}, PONKE:{cat:'SOL',gen:2,chain:'Solana'},
  SLERF:{cat:'SOL',gen:2,chain:'Solana'}, FLOKI:{cat:'Dog',gen:2,chain:'Multi'},
  BABYDOGE:{cat:'Dog',gen:2,chain:'BSC'}, NEIRO:{cat:'Cat',gen:3,chain:'ETH'},
  MOODENG:{cat:'Animal',gen:3,chain:'ETH'}, CATI:{cat:'TON',gen:3,chain:'TON'},
  GOAT:{cat:'AI Meme',gen:3,chain:'SOL'}, ACT:{cat:'AI Meme',gen:3,chain:'SOL'},
  TURBO:{cat:'AI Meme',gen:3,chain:'ETH'}, PNUT:{cat:'Political',gen:3,chain:'SOL'},
  PEOPLE:{cat:'Political',gen:2,chain:'ETH'}, BOME:{cat:'Inscription',gen:3,chain:'SOL'},
  GIGA:{cat:'Chad',gen:3,chain:'SOL'}, MEME:{cat:'Meta',gen:2,chain:'ETH'},
  HOT:{cat:'Utility',gen:1,chain:'NEAR'}, DOGS:{cat:'TON',gen:3,chain:'TON'},
  HMSTR:{cat:'TON',gen:3,chain:'TON'}, NOT:{cat:'TON',gen:3,chain:'TON'},
  AIDOGE:{cat:'AI',gen:3,chain:'ARB'},
};

const MEME_FUTURES = new Set(['DOGE','SHIB','PEPE','BONK','WIF','FLOKI','PEOPLE','LUNC','MEME','TURBO','NOT']);
const STABLES = new Set(['USDT','USDC','BUSD','DAI','FDUSD']);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 's-maxage=25');
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
  // Uses 4H klines to determine trend, BOS, CHoCH, liquidity sweep
  // ════════════════════════════════════════════════════════════════
  function analyzeStructure(klines, price) {
    if (!klines || klines.length < 8) {
      return { trend: 'UNKNOWN', bos: false, choch: false, sweep: false, score: 5, note: 'DATA TIDAK TERSEDIA — klines' };
    }
    const cls  = klines.map(k => +k[4]);
    const high = klines.map(k => +k[2]);
    const low  = klines.map(k => +k[3]);
    const vol  = klines.map(k => +k[5]);
    const n    = cls.length;

    // Find recent pivot highs/lows (simplified swing detection)
    const pivotH = [], pivotL = [];
    for (let i = 2; i < n - 2; i++) {
      if (high[i] > high[i-1] && high[i] > high[i-2] && high[i] > high[i+1] && high[i] > high[i+2]) pivotH.push({ v: high[i], i });
      if (low[i]  < low[i-1]  && low[i]  < low[i-2]  && low[i]  < low[i+1]  && low[i]  < low[i+2])  pivotL.push({ v: low[i],  i });
    }

    // Trend: compare last 2 pivots
    const lastH = pivotH.slice(-2);
    const lastL = pivotL.slice(-2);
    let trend = 'SIDEWAYS', trendScore = 0;
    if (lastH.length >= 2 && lastL.length >= 2) {
      const hhhl = lastH[1].v > lastH[0].v && lastL[1].v > lastL[0].v;
      const lhll = lastH[1].v < lastH[0].v && lastL[1].v < lastL[0].v;
      if (hhhl)  { trend = 'UPTREND';   trendScore = 15; }
      else if (lhll) { trend = 'DOWNTREND'; trendScore = -10; }
      else       { trend = 'RANGING';   trendScore = 3; }
    }

    // BOS: price breaks above recent pivot high
    const recentHigh = pivotH.length ? Math.max(...pivotH.slice(-3).map(p => p.v)) : high[n-1];
    const recentLow  = pivotL.length ? Math.min(...pivotL.slice(-3).map(p => p.v)) : low[n-1];
    const bos = price > recentHigh * 1.001;
    const bosBear = price < recentLow * 0.999;

    // CHoCH: after downtrend, first bullish pivot
    const prevTrend = lastH.length >= 2 && lastH[0].v > lastH[1].v; // was bearish
    const choch = prevTrend && cls[n-1] > cls[n-2] && cls[n-1] > cls[n-3];

    // Liquidity sweep: wick below recent low then recovery
    const lastCandle = { o: +klines[n-1][1], h: high[n-1], l: low[n-1], c: cls[n-1] };
    const wick = lastCandle.l < recentLow && lastCandle.c > recentLow;
    const wickSize = lastCandle.h - lastCandle.l > 0 ? (recentLow - lastCandle.l) / (lastCandle.h - lastCandle.l) : 0;
    const sweep = wick && wickSize > 0.25;

    // CVD proxy: sum of (close > open ? vol : -vol) for last 10 candles
    const cvdArr = cls.slice(-10).map((c, i) => c > +klines[n-10+i][1] ? vol[n-10+i] : -vol[n-10+i]);
    const cvd = cvdArr.reduce((a, b) => a + b, 0);
    const cvdBull = cvd > 0;

    // Volume trend
    const avgVol = vol.slice(-10).reduce((a, b) => a + b, 0) / 10;
    const lastVol = vol[n-1];
    const volExpansion = lastVol > avgVol * 1.5;

    let structScore = trendScore;
    const structNotes = [];
    if (bos && trend === 'UPTREND')   { structScore += 15; structNotes.push(`BOS: price broke ${fmtP(recentHigh)} — bullish structure`); }
    if (choch)                         { structScore += 12; structNotes.push('CHoCH: first bullish shift after downtrend'); }
    if (sweep)                         { structScore += 12; structNotes.push(`Liquidity Sweep: wick below ${fmtP(recentLow)} — stops cleared`); }
    if (cvdBull)                       { structScore += 8;  structNotes.push('CVD positive: net buying pressure'); }
    if (volExpansion)                  { structScore += 8;  structNotes.push(`Volume ${(lastVol/avgVol).toFixed(1)}x above avg`); }
    if (bosBear && trend === 'DOWNTREND') { structScore -= 15; structNotes.push(`BOS BEARISH: broke ${fmtP(recentLow)}`); }

    return {
      trend, bos, bosBear, choch, sweep, cvdBull, volExpansion,
      recentHigh: +recentHigh.toFixed(8), recentLow: +recentLow.toFixed(8),
      score: Math.max(-20, Math.min(20, structScore)),
      notes: structNotes,
      premium: price > (recentHigh + recentLow) / 2,
      discount: price < (recentHigh + recentLow) / 2,
    };
  }

  // ════════════════════════════════════════════════════════════════
  // ENGINE 2: ORDER BOOK
  // ════════════════════════════════════════════════════════════════
  function analyzeOrderBook(depth, price) {
    if (!depth?.bids?.length || !depth?.asks?.length) {
      return { signal: 'DATA TIDAK TERSEDIA', score: 0, imbalance: 1 };
    }
    const bids = depth.bids.slice(0, 15).map(([p, q]) => ({ p: +p, q: +q, usd: +p * +q }));
    const asks = depth.asks.slice(0, 15).map(([p, q]) => ({ p: +p, q: +q, usd: +p * +q }));
    const totalBid = bids.reduce((a, b) => a + b.usd, 0);
    const totalAsk = asks.reduce((a, b) => a + b.usd, 0);
    const imbalance = totalAsk > 0 ? totalBid / totalAsk : 1;

    // Find walls (single level > 15% of side)
    const bidWalls = bids.filter(b => b.usd > totalBid * 0.15).sort((a, b) => b.p - a.p);
    const askWalls = asks.filter(a => a.usd > totalAsk * 0.15).sort((a, b) => a.p - b.p);

    // Absorption: price moved up but big ask wall absorbed
    const biggestBid = bids.reduce((a, b) => b.usd > a.usd ? b : a, bids[0]);
    const biggestAsk = asks.reduce((a, b) => b.usd > a.usd ? b : a, asks[0]);
    const wallRatio  = biggestAsk.usd > 0 ? biggestBid.usd / biggestAsk.usd : 1;

    let signal = 'BALANCED', obScore = 0;
    const notes = [];
    if (imbalance > 2.5)       { signal = 'STRONG BUY PRESSURE'; obScore = 20; notes.push(`Bid/Ask ${imbalance.toFixed(1)}x — buyers dominating`); }
    else if (imbalance > 1.5)  { signal = 'BUY PRESSURE';        obScore = 14; notes.push(`Bid/Ask ${imbalance.toFixed(1)}x`); }
    else if (imbalance > 1.1)  { signal = 'MILD BUY';             obScore = 7; }
    else if (imbalance < 0.5)  { signal = 'STRONG SELL PRESSURE'; obScore = -18; notes.push(`Ask/Bid ${(1/imbalance).toFixed(1)}x — sellers dominating`); }
    else if (imbalance < 0.75) { signal = 'SELL PRESSURE';        obScore = -12; }

    if (wallRatio > 3)  { obScore += 8; notes.push(`Whale bid wall $${fmtUSD(biggestBid.usd)} at $${fmtP(biggestBid.p)}`); }
    if (wallRatio < 0.3){ obScore -= 8; notes.push(`Whale ask wall $${fmtUSD(biggestAsk.usd)} at $${fmtP(biggestAsk.p)}`); }

    const support    = bidWalls[0]?.p || bids[0]?.p || price * 0.97;
    const resistance = askWalls[0]?.p || asks[0]?.p || price * 1.03;

    return {
      signal, imbalance: +imbalance.toFixed(2), score: Math.max(-20, Math.min(20, obScore)),
      totalBidUSD: +totalBid.toFixed(0), totalAskUSD: +totalAsk.toFixed(0),
      support: +support.toFixed(8), resistance: +resistance.toFixed(8),
      bidWalls: bidWalls.slice(0, 2).map(w => ({ p: w.p, usd: +w.usd.toFixed(0) })),
      askWalls: askWalls.slice(0, 2).map(w => ({ p: w.p, usd: +w.usd.toFixed(0) })),
      notes,
    };
  }

  // ════════════════════════════════════════════════════════════════
  // ENGINE 3: WHALE DETECTOR
  // ════════════════════════════════════════════════════════════════
  function analyzeWhales(trades, price) {
    if (!trades?.length) return { signal: 'DATA TIDAK TERSEDIA', score: 0, whales: [] };

    const whales = [];
    let buyVol = 0, sellVol = 0, totalVol = 0;

    for (const t of trades) {
      const usd = +t.p * +t.q;
      const isSell = t.m; // maker = sell
      totalVol += usd;
      if (isSell) sellVol += usd;
      else buyVol += usd;

      // Whale thresholds: $80k, $250k, $1M
      if (usd >= 80000) {
        const tier = usd >= 1000000 ? '🐳 MEGA ($1M+)' : usd >= 250000 ? '🐳 LARGE ($250k+)' : '🐟 MID ($80k+)';
        whales.push({
          side: isSell ? 'SELL' : 'BUY',
          usd: +usd.toFixed(0), price: +t.p,
          tier, ago: Math.round((Date.now() - t.T) / 60000),
        });
      }
    }

    const buyRatio   = totalVol > 0 ? buyVol / totalVol : 0.5;
    const whaleBuy   = whales.filter(w => w.side === 'BUY').reduce((a, w) => a + w.usd, 0);
    const whaleSell  = whales.filter(w => w.side === 'SELL').reduce((a, w) => a + w.usd, 0);
    const netWhale   = whaleBuy - whaleSell;
    const whaleRatio = (whaleBuy + whaleSell) > 0 ? whaleBuy / (whaleBuy + whaleSell) : 0.5;
    const recent5    = whales.filter(w => w.ago <= 5).length;

    let signal = 'NO WHALE ACTIVITY', whaleScore = 0;
    const notes = [];

    if (whales.length === 0) {
      signal = 'NO WHALE ACTIVITY'; whaleScore = 0;
    } else if (whaleRatio > 0.80) {
      signal = 'WHALE ACCUMULATION 🐳'; whaleScore = 20;
      notes.push(`$${fmtUSD(whaleBuy)} whale buys — institutional accumulation`);
    } else if (whaleRatio > 0.65) {
      signal = 'NET WHALE BUY'; whaleScore = 14;
      notes.push(`Net +$${fmtUSD(netWhale)} whale buying`);
    } else if (whaleRatio < 0.25) {
      signal = 'WHALE DISTRIBUTION ⚠️'; whaleScore = -20;
      notes.push(`$${fmtUSD(whaleSell)} whale sells — POTENSI MANIPULASI MARKET`);
    } else if (whaleRatio < 0.40) {
      signal = 'NET WHALE SELL'; whaleScore = -12;
    } else {
      signal = 'MIXED WHALE ACTIVITY'; whaleScore = 3;
    }

    if (recent5 >= 3 && whaleScore > 0) {
      whaleScore = Math.min(20, whaleScore + 5);
      notes.push(`${recent5} whale trades in last 5 min — active accumulation`);
    }

    // Manipulation warning: price dropping but whale buying
    const manipulation = whaleRatio > 0.7 && buyRatio < 0.4;
    if (manipulation) notes.push('POTENSI MANIPULASI: whale buy + retail sell — SM engineering');

    return {
      signal, score: Math.max(-20, Math.min(20, whaleScore)),
      whales: whales.sort((a, b) => b.usd - a.usd).slice(0, 5),
      whaleBuyUSD: +whaleBuy.toFixed(0), whaleSellUSD: +whaleSell.toFixed(0),
      netWhaleUSD: +netWhale.toFixed(0), whaleRatio: +whaleRatio.toFixed(2),
      buyRatio: +buyRatio.toFixed(2), manipulation, notes,
    };
  }

  // ════════════════════════════════════════════════════════════════
  // ENGINE 4: DERIVATIVES
  // ════════════════════════════════════════════════════════════════
  function analyzeDerivatives(fundingRate, oi, lsRatio) {
    if (fundingRate === null && oi === null) {
      return { signal: 'DATA TIDAK TERSEDIA', score: 0, squeeze: 'NONE' };
    }

    let derivScore = 0;
    let signal = 'NEUTRAL';
    const notes = [];
    let squeeze = 'NONE';

    const fr = fundingRate !== null ? fundingRate * 100 : null;

    if (fr !== null) {
      if (fr < -0.01)      { derivScore += 18; signal = 'SHORT SQUEEZE SETUP'; notes.push(`Funding ${fr.toFixed(4)}% — shorts paying longs, squeeze imminent`); squeeze = 'SHORT'; }
      else if (fr < 0)     { derivScore += 10; notes.push(`Negative funding — mild short squeeze bias`); }
      else if (fr > 0.05)  { derivScore -= 15; signal = 'LONG TRAP'; notes.push(`Funding ${fr.toFixed(4)}% — overleveraged longs, liquidation risk`); squeeze = 'LONG'; }
      else if (fr > 0.02)  { derivScore -= 8; notes.push(`Funding elevated — caution`); }
      else                  { derivScore += 4; }
    }

    if (lsRatio !== null) {
      const longPct = +(lsRatio / (1 + lsRatio) * 100).toFixed(1);
      if (longPct > 68)    { derivScore -= 10; notes.push(`${longPct}% long — crowded, stop hunt risk`); }
      else if (longPct < 38){ derivScore += 12; notes.push(`${longPct}% long = short squeeze fuel`); }
    }

    return {
      signal, score: Math.max(-20, Math.min(20, derivScore)),
      fundingRate: fr !== null ? +fr.toFixed(4) : null,
      squeeze, notes,
    };
  }

  // ════════════════════════════════════════════════════════════════
  // ENGINE 5: MOMENTUM & VOLUME
  // ════════════════════════════════════════════════════════════════
  function analyzeMomentum(klines, price, ch24) {
    if (!klines || klines.length < 5) {
      return { signal: 'DATA TIDAK TERSEDIA', score: 0 };
    }
    const cls = klines.map(k => +k[4]);
    const vol = klines.map(k => +k[5]);
    const n   = klines.length;

    // EMA 9 and 21
    const ema = (arr, p) => {
      const k = 2 / (p + 1); let e = arr[0];
      for (let i = 1; i < arr.length; i++) e = arr[i] * k + e * (1 - k);
      return e;
    };
    const ema9  = ema(cls, 9);
    const ema21 = ema(cls, Math.min(21, n));

    // RSI proxy (14 period)
    let gains = 0, losses = 0;
    const period = Math.min(14, n - 1);
    for (let i = n - period; i < n; i++) {
      const diff = cls[i] - cls[i - 1];
      if (diff > 0) gains += diff; else losses += Math.abs(diff);
    }
    const rs  = losses > 0 ? gains / losses : 100;
    const rsi = 100 - (100 / (1 + rs));

    // Volume delta (last 5 candles)
    const volDelta = cls.slice(-5).reduce((acc, c, i) => {
      const idx = n - 5 + i;
      return acc + (c > +klines[idx][1] ? vol[idx] : -vol[idx]);
    }, 0);

    // Volume divergence: price going up but volume decreasing
    const avgVol5  = vol.slice(-5).reduce((a, b) => a + b, 0) / 5;
    const avgVol20 = vol.slice(-20).reduce((a, b) => a + b, 0) / Math.min(20, n);
    const volRatio = avgVol20 > 0 ? avgVol5 / avgVol20 : 1;

    // Momentum state
    const above21  = price > ema21;
    const emaCross = cls[n-1] > ema9 && cls[n-3] < ema9; // recent cross above

    let signal = 'NEUTRAL', momScore = 0;
    const notes = [];

    if (rsi < 30)        { momScore += 15; signal = 'OVERSOLD BOUNCE'; notes.push(`RSI ${rsi.toFixed(0)} — oversold, reversal likely`); }
    else if (rsi > 75)   { momScore -= 12; signal = 'OVERBOUGHT ⚠️'; notes.push(`RSI ${rsi.toFixed(0)} — overbought, correction risk`); }
    else if (rsi > 55 && above21) { momScore += 8; signal = 'BULLISH MOMENTUM'; }
    else if (rsi < 45)   { momScore -= 5; }

    if (volDelta > 0)    { momScore += 8; notes.push(`Volume delta +${(volDelta/1e6).toFixed(1)}M — net buying`); }
    else                 { momScore -= 5; }

    if (volRatio > 1.8)  { momScore += 8; notes.push(`Volume ${volRatio.toFixed(1)}x above 20-period avg — expansion`); }
    else if (volRatio < 0.5) { momScore -= 8; notes.push('BREAKOUT LEMAH: volume declining'); }

    const emaJunction = emaCross && above21;
    if (emaJunction) { momScore += 5; notes.push('EMA cross above: bullish momentum signal'); }

    // Divergence: price down but RSI up = bullish div
    const bullDiv = ch24 < -3 && rsi > 45;
    if (bullDiv) { momScore += 8; notes.push('Bullish divergence: price down, momentum up'); }

    return {
      signal, score: Math.max(-20, Math.min(20, momScore)),
      rsi: +rsi.toFixed(1), ema9: +ema9.toFixed(8), ema21: +ema21.toFixed(8),
      above21, volRatio: +volRatio.toFixed(2), volDelta: +volDelta.toFixed(0),
      notes,
    };
  }

  // ════════════════════════════════════════════════════════════════
  // CONFIDENCE SCORE (following spec exactly)
  // ════════════════════════════════════════════════════════════════
  function calcConfidence(struct, ob, whale, deriv, mom, ch24, fg) {
    let score = 30; // base
    const breakdown = {};

    // +20 whale accumulation
    if (whale.whaleRatio > 0.65 && whale.whales.length > 0) { score += 20; breakdown.whale = '+20 (whale accumulation)'; }
    else if (whale.score > 0) { score += whale.score; breakdown.whale = `+${whale.score} (whale activity)`; }
    else if (whale.score < 0) { score += whale.score; breakdown.whale = `${whale.score} (whale selling)`; }

    // +20 order book imbalance
    if (ob.imbalance > 2.0) { score += 20; breakdown.ob = '+20 (OB imbalance >2x)'; }
    else if (ob.score > 0)  { score += ob.score; breakdown.ob = `+${ob.score} (OB)`; }
    else if (ob.score < 0)  { score += ob.score; breakdown.ob = `${ob.score} (OB selling)`; }

    // +15 liquidity sweep
    if (struct.sweep) { score += 15; breakdown.sweep = '+15 (liquidity sweep confirmed)'; }
    else if (struct.bos) { score += 10; breakdown.sweep = '+10 (BOS confirmed)'; }

    // +15 breakout structure
    if (struct.bos && struct.trend === 'UPTREND') { score += 15; breakdown.struct = '+15 (BOS + uptrend)'; }
    else if (struct.trend === 'UPTREND') { score += 8; breakdown.struct = '+8 (uptrend)'; }
    else if (struct.trend === 'DOWNTREND') { score -= 10; breakdown.struct = '-10 (downtrend)'; }

    // +10 funding supports direction
    if (deriv.score >= 15) { score += 10; breakdown.deriv = '+10 (funding supports)'; }
    else if (deriv.score > 0) { score += 5; breakdown.deriv = '+5 (funding mild)'; }
    else if (deriv.score < -10) { score += deriv.score; breakdown.deriv = `${deriv.score} (funding against)`; }

    // +10 volume expansion
    if (struct.volExpansion || mom.volRatio > 1.5) { score += 10; breakdown.vol = '+10 (volume expansion)'; }

    // +10 market correlation (F&G, CVD)
    if (fg <= 25) { score += 10; breakdown.market = '+10 (extreme fear = buy zone)'; }
    else if (fg <= 40) { score += 5; breakdown.market = '+5 (fear zone)'; }
    else if (fg >= 75) { score -= 8; breakdown.market = '-8 (greed zone)'; }

    // Momentum bonus
    if (mom.score > 0) { score += Math.min(8, mom.score); }
    else if (mom.score < 0) { score += Math.max(-8, mom.score); }

    // CVD confirmation
    if (struct.cvdBull) score += 5;

    const final = Math.max(0, Math.min(100, Math.round(score)));
    return { score: final, breakdown };
  }

  // ════════════════════════════════════════════════════════════════
  // SETUP BUILDER — Entry / SL / TP with structural basis
  // ════════════════════════════════════════════════════════════════
  function buildTradeSetup(price, high, low, confidence, struct, ob, deriv) {
    // SL: below structural support (OB wall or swing low), NOT 24h low
    const structuralSupport = ob.support > 0 && ob.support < price ? ob.support : struct.recentLow || price * 0.90;
    const sl     = +(Math.min(structuralSupport * 0.992, price * 0.88)).toFixed(8);
    const slPct  = +((price - sl) / price * 100).toFixed(1);
    const slDist = price - sl;

    // Entry: current or slight discount
    const entry  = +(price * 1.001).toFixed(8);

    // TP levels: use resistance or multipliers
    const structResist = ob.resistance > price ? ob.resistance : price * 1.05;
    const tp1 = +(Math.min(structResist, price + slDist * 1.5)).toFixed(8);
    const tp2 = +(price + slDist * 3.0).toFixed(8);
    const tp3 = +(price + slDist * 5.0).toFixed(8);

    const tp1Pct = +((tp1 - price) / price * 100).toFixed(1);
    const tp2Pct = +((tp2 - price) / price * 100).toFixed(1);
    const tp3Pct = +((tp3 - price) / price * 100).toFixed(1);

    const rr1 = slDist > 0 ? +((tp1 - price) / slDist).toFixed(1) : 1.5;
    const rr2 = slDist > 0 ? +((tp2 - price) / slDist).toFixed(1) : 3.0;

    // Verdict (following spec)
    let verdict, verdictColor;
    if (confidence >= 80) { verdict = '🎯 HIGH PROBABILITY LONG'; verdictColor = '#00ff88'; }
    else if (confidence >= 65) { verdict = '✅ BUY'; verdictColor = '#00ffd0'; }
    else if (confidence >= 50) { verdict = '⏳ WAIT CONFIRMATION'; verdictColor = '#FFB300'; }
    else if (deriv.squeeze === 'LONG') { verdict = '❌ AVOID — LONG TRAP'; verdictColor = '#ff4466'; }
    else { verdict = '🚫 NO TRADE / NO CLEAR EDGE'; verdictColor = '#666'; }

    const risk = slPct > 15 ? 'HIGH' : slPct > 8 ? 'MEDIUM' : 'LOW';

    return {
      entry, sl, slPct,
      slNote: `Below SM support $${fmtP(structuralSupport)} (structural)`,
      tp1, tp1Pct, tp2, tp2Pct, tp3, tp3Pct,
      rr1, rr2,
      verdict, verdictColor, risk,
    };
  }

  // ════════════════════════════════════════════════════════════════
  // MAIN HANDLER
  // ════════════════════════════════════════════════════════════════
  try {
    const t0 = Date.now();

    // ── 5-SOURCE TICKER FALLBACK ──────────────────────────────────
    const [binR, fngR] = await Promise.allSettled([
      (async () => {
        const b1 = await sf('https://api.binance.com/api/v3/ticker/24hr', 8000);
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
        const cg = await sf('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&category=meme-token&order=volume_desc&per_page=50&page=1&sparkline=false&price_change_percentage=24h', 9000);
        if (Array.isArray(cg)) return cg.map(c => ({
          symbol: c.symbol.toUpperCase() + 'USDT',
          lastPrice: String(c.current_price || 0),
          priceChangePercent: String(c.price_change_percentage_24h || 0),
          quoteVolume: String(c.total_volume || 0),
          highPrice: String((c.current_price || 0) * 1.04),
          lowPrice: String((c.current_price || 0) * 0.96),
          openPrice: String((c.current_price || 0) / (1 + (c.price_change_percentage_24h || 0) / 100)),
        }));
        return [];
      })(),
      sf('https://api.alternative.me/fng/?limit=1&format=json', 5000),
    ]);

    const allTickers = binR.status === 'fulfilled' && Array.isArray(binR.value) ? binR.value : [];
    const fg = fngR.status === 'fulfilled' ? parseInt(fngR.value?.data?.[0]?.value || 50) : 50;

    if (!allTickers.length) {
      return res.status(200).json({ version: 'v3.0', error: null, all: [], totalScanned: 0, fg, timestamp: Date.now() });
    }

    const tickerMap = {};
    allTickers.forEach(t => { if (t?.symbol) tickerMap[t.symbol] = t; });

    // Deep scan top memes: klines + orderbook + trades + funding in parallel
    const TOP_DEEP = MEME_SYMBOLS.filter(s => tickerMap[s + 'USDT']).slice(0, 12);

    const deepResults = await Promise.allSettled(
      TOP_DEEP.map(sym => Promise.allSettled([
        sf(`https://api.binance.com/api/v3/klines?symbol=${sym}USDT&interval=4h&limit=20`, 4000),
        sf(`https://api.binance.com/api/v3/depth?symbol=${sym}USDT&limit=15`, 3500),
        sf(`https://api.binance.com/api/v3/aggTrades?symbol=${sym}USDT&limit=300`, 3500),
      ]))
    );

    // Funding rates (batch)
    const fundingR = await sf('https://fapi.binance.com/fapi/v1/premiumIndex', 4000);
    const fundingMap = {};
    if (Array.isArray(fundingR)) {
      fundingR.forEach(f => {
        const s = (f.symbol || '').replace('USDT', '');
        if (s) fundingMap[s] = parseFloat(f.lastFundingRate || 0);
      });
    }

    // Process each meme
    const results = [];

    for (let idx = 0; idx < TOP_DEEP.length; idx++) {
      const sym = TOP_DEEP[idx];
      const ticker = tickerMap[sym + 'USDT'];
      if (!ticker) continue;

      const price  = +(ticker.lastPrice || 0);
      const ch24   = +(ticker.priceChangePercent || 0);
      const vol    = +(ticker.quoteVolume || 0);
      const high   = +(ticker.highPrice || price * 1.04);
      const low    = +(ticker.lowPrice  || price * 0.96);
      const open   = +(ticker.openPrice || price);

      if (price <= 0 || vol < 500000) continue;

      const symDeep = deepResults[idx];
      const [klinesR, depthR, tradesR] = symDeep.status === 'fulfilled'
        ? symDeep.value
        : [{ status: 'rejected' }, { status: 'rejected' }, { status: 'rejected' }];

      const klines = klinesR.status === 'fulfilled' && Array.isArray(klinesR.value) ? klinesR.value : null;
      const depth  = depthR.status === 'fulfilled' ? depthR.value : null;
      const trades = tradesR.status === 'fulfilled' && Array.isArray(tradesR.value) ? tradesR.value : null;
      const fr     = MEME_FUTURES.has(sym) ? (fundingMap[sym] || null) : null;

      // Run all 5 engines
      const struct = analyzeStructure(klines, price);
      const ob     = analyzeOrderBook(depth, price);
      const whale  = analyzeWhales(trades, price);
      const deriv  = analyzeDerivatives(fr, null, null);
      const mom    = analyzeMomentum(klines, price, ch24);

      // Confidence score
      const conf   = calcConfidence(struct, ob, whale, deriv, mom, ch24, fg);

      // Filter: only build full setup if score >= 50
      if (conf.score < 50 && Math.abs(ch24) < 3) continue;

      // Trade setup
      const setup  = buildTradeSetup(price, high, low, conf.score, struct, ob, deriv);

      const meta   = MEME_META[sym] || { cat: 'Meme', gen: 2, chain: '?' };

      results.push({
        symbol: sym,
        category: meta.cat, chain: meta.chain, gen: meta.gen,
        price, ch24: +ch24.toFixed(2), vol,
        volM: +(vol / 1e6).toFixed(1),
        high, low,
        fundingRate: fr !== null ? +(fr * 100).toFixed(4) : null,
        confidence: conf.score,
        confidenceLabel: conf.score >= 80 ? '🔥 HIGH PROBABILITY' : conf.score >= 65 ? '✅ VALID SETUP' : conf.score >= 50 ? '⚠️ LOW CONFIDENCE' : '🚫 NO TRADE',
        confBreakdown: conf.breakdown,
        // Engine results
        structure: struct,
        orderBook: ob,
        whale: { ...whale, whales: whale.whales.slice(0, 4) },
        derivatives: deriv,
        momentum: mom,
        // Final output
        verdict: setup.verdict,
        verdictColor: setup.verdictColor,
        risk: setup.risk,
        trade: setup,
        // Status flags
        hasKlines: !!klines,
        hasOrderBook: !!(depth?.bids?.length),
        hasWhaleData: !!(trades?.length),
      });
    }

    // Also process remaining symbols (no deep scan, just base ticker)
    const deepSyms = new Set(TOP_DEEP);
    MEME_SYMBOLS.forEach(sym => {
      if (deepSyms.has(sym)) return;
      const ticker = tickerMap[sym + 'USDT'];
      if (!ticker) return;
      const price = +(ticker.lastPrice || 0);
      const ch24  = +(ticker.priceChangePercent || 0);
      const vol   = +(ticker.quoteVolume || 0);
      if (price <= 0 || vol < 1e6) return;
      const meta = MEME_META[sym] || { cat: 'Meme', gen: 2, chain: '?' };
      results.push({
        symbol: sym, category: meta.cat, chain: meta.chain, gen: meta.gen,
        price, ch24: +ch24.toFixed(2), vol, volM: +(vol/1e6).toFixed(1),
        high: +(ticker.highPrice||price*1.04), low: +(ticker.lowPrice||price*0.96),
        fundingRate: null, confidence: 35,
        confidenceLabel: '📊 BASIC DATA',
        confBreakdown: {}, structure: null, orderBook: null,
        whale: { signal: 'DATA TIDAK TERSEDIA', score: 0, whales: [], whaleBuyUSD: 0, whaleSellUSD: 0, netWhaleUSD: 0, whaleRatio: 0.5, notes: [] },
        derivatives: null, momentum: null,
        verdict: 'NO TRADE / NO CLEAR EDGE', verdictColor: '#666', risk: 'HIGH',
        trade: {
          entry: price, sl: +(price * 0.88).toFixed(8), slPct: 12,
          slNote: 'Basic SL — no structural data', tp1: +(price * 1.15).toFixed(8), tp1Pct: 15,
          tp2: +(price * 1.30).toFixed(8), tp2Pct: 30, tp3: +(price * 1.60).toFixed(8), tp3Pct: 60,
          rr1: 1.2, rr2: 2.5, verdict: 'NO TRADE / NO CLEAR EDGE', verdictColor: '#666', risk: 'HIGH',
        },
        hasKlines: false, hasOrderBook: false, hasWhaleData: false,
      });
    });

    results.sort((a, b) => b.confidence - a.confidence || b.vol - a.vol);

    // Build tabs
    const elite     = results.filter(r => r.confidence >= 65).slice(0, 8);
    const trending  = results.filter(r => r.ch24 > 5).sort((a, b) => b.ch24 - a.ch24).slice(0, 8);
    const whaleSet  = results.filter(r => r.whale?.whaleRatio > 0.6).slice(0, 6);
    const oversold  = results.filter(r => r.momentum?.rsi < 35).sort((a, b) => a.momentum.rsi - b.momentum.rsi).slice(0, 6);
    const dips      = results.filter(r => r.ch24 < -5 && r.confidence >= 45).slice(0, 6);

    // Market stats
    const deepScanned = results.filter(r => r.hasKlines).length;
    const avg24h = results.length ? +(results.reduce((a, r) => a + r.ch24, 0) / results.length).toFixed(2) : 0;
    const pumping = results.filter(r => r.ch24 > 8).length;
    const dumping = results.filter(r => r.ch24 < -8).length;
    const validSetups = results.filter(r => r.confidence >= 65).length;

    return res.status(200).json({
      version: 'v3.0',
      timestamp: Date.now(),
      scanTime: ((Date.now() - t0) / 1000).toFixed(1),
      fg, fgLabel: fg <= 25 ? 'Extreme Fear' : fg <= 45 ? 'Fear' : fg >= 75 ? 'Greed' : 'Neutral',
      totalScanned: results.length,
      deepScanned,
      stats: { avg24h, pumping, dumping, validSetups, memeSignal: avg24h > 5 ? 'BULL' : avg24h < -5 ? 'BEAR' : 'NEUTRAL' },
      all: results,
      elite,
      trending,
      whaleAccum: whaleSet,
      oversold,
      dips,
    });

  } catch (e) {
    // Never return 500 with empty data
    return res.status(200).json({
      version: 'v3.0', error: e.message, all: [], totalScanned: 0,
      fg: 50, timestamp: Date.now(), stats: {},
      elite: [], trending: [], whaleAccum: [], oversold: [], dips: [],
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
  if (!n) return '—';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K';
  return '$' + n;
}
