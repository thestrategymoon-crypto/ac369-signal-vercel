// api/intelligence.js — AC369 FUSION v13 REBUILT
// Bybit PRIMARY for taker flow + derivatives (fapi blocked on Vercel)

const SCAN_SYMS = ['BTC','ETH','SOL','BNB','XRP','ADA','AVAX','DOGE','LINK','DOT','ARB','OP','APT','SUI','TIA','INJ','NEAR','ATOM','FET','RNDR'];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=25');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const sf = async (url, ms = 5000) => {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), ms);
    try {
      const r = await fetch(url, { signal: c.signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
      clearTimeout(t); if (!r.ok) return null; return await r.json();
    } catch { clearTimeout(t); return null; }
  };

  function calcLiquidation(price, fr) {
    if (!price || price <= 0) return null;
    const frVal = fr !== null ? fr : 0;
    const longBias = frVal >= 0;
    const leverages = [5, 10, 20, 50];
    const longLiqZones  = leverages.map(lev => ({ leverage: lev, price: +(price * (1 - 1 / lev)).toFixed(4), distPct: +(100 / lev).toFixed(1), intensity: longBias ? Math.min(100, Math.abs(frVal * 100) * 20 + (lev <= 10 ? 40 : 20)) : 20 }));
    const shortLiqZones = leverages.map(lev => ({ leverage: lev, price: +(price * (1 + 1 / lev)).toFixed(4), distPct: +(100 / lev).toFixed(1), intensity: !longBias ? Math.min(100, Math.abs(frVal * 100) * 20 + (lev <= 10 ? 40 : 20)) : 20 }));
    let signal = '⚖️ BALANCED', score = 5;
    if (frVal < -0.005)       { signal = '🔥 SHORT SQUEEZE ZONE';      score = 25; }
    else if (frVal > 0.05)    { signal = '⚠️ LONG LIQ CASCADE RISK';   score = -15; }
    else if (frVal > 0.02)    { signal = '⚠️ OVERLEVERAGED LONGS';     score = -8; }
    else if (frVal < 0)       { signal = '📈 NEGATIVE FUNDING — LONG BIAS'; score = 15; }
    return {
      fundingPct: +(frVal * 100).toFixed(4), longBias,
      longLiqZones, shortLiqZones, signal, score,
      cascadeRisk: Math.min(100, Math.round(longBias ? Math.abs(frVal * 100) * 30 : 10)),
      closestLongLiq:  +(longLiqZones[1]?.price  || price * 0.9).toFixed(4),
      closestShortLiq: +(shortLiqZones[1]?.price || price * 1.1).toFixed(4),
      dangerLong:  longLiqZones[1],
      dangerShort: shortLiqZones[1],
    };
  }

  function analyzeTakerFlow(klines) {
    // Bybit kline: [startTime, open, high, low, close, volume, turnover]
    if (!klines || klines.length < 4) return { signal: 'NO DATA', score: 0, ratio: 0.5, trend: 'UNKNOWN', buyPct: 50, sellPct: 50 };
    let buyVol = 0, sellVol = 0;
    const rows = klines.slice(-12);
    rows.forEach(k => { const o = +k[1], cl = +k[4], v = +k[5]; if (cl >= o) buyVol += v; else sellVol += v; });
    const total = buyVol + sellVol;
    const ratio = total > 0 ? buyVol / total : 0.5;
    const r1 = rows.slice(0, 6), r2 = rows.slice(6);
    let b1 = 0, s1 = 0, b2 = 0, s2 = 0;
    r1.forEach(k => { if (+k[4] >= +k[1]) b1 += +k[5]; else s1 += +k[5]; });
    r2.forEach(k => { if (+k[4] >= +k[1]) b2 += +k[5]; else s2 += +k[5]; });
    const rr1 = b1 + s1 > 0 ? b1 / (b1 + s1) : 0.5;
    const rr2 = b2 + s2 > 0 ? b2 / (b2 + s2) : 0.5;
    const trend = rr2 - rr1 > 0.04 ? 'RISING ↗' : rr2 - rr1 < -0.04 ? 'FALLING ↘' : 'FLAT →';
    let signal = 'NEUTRAL', score = 0;
    if      (ratio > 0.65 && trend === 'RISING ↗') { signal = '🟢 AGGRESSIVE BUY SURGE'; score = 25; }
    else if (ratio > 0.60)                          { signal = '🟢 BUYER DOMINANT';        score = 18; }
    else if (ratio > 0.52)                          { signal = '🟩 MILD BUY PRESSURE';     score = 10; }
    else if (ratio < 0.35 && trend === 'FALLING ↘') { signal = '🔴 AGGRESSIVE SELL SURGE'; score = -20; }
    else if (ratio < 0.40)                          { signal = '🔴 SELLER DOMINANT';       score = -15; }
    else if (ratio < 0.48)                          { signal = '🟥 MILD SELL PRESSURE';    score = -8; }
    else                                            { signal = '⚖️ BALANCED FLOW';          score = 3; }
    if (rr2 > rr1 && score > 0) score = Math.min(25, score + 4);
    if (rr2 < rr1 && score < 0) score = Math.max(-20, score - 4);
    return { signal, score, ratio: +ratio.toFixed(3), trend, buyPct: +(ratio * 100).toFixed(1), sellPct: +((1 - ratio) * 100).toFixed(1) };
  }

  function calcCorrelation(btcKlines, coinKlines) {
    if (!btcKlines?.length || !coinKlines?.length) return null;
    const n = Math.min(btcKlines.length, coinKlines.length, 20);
    if (n < 8) return null;
    const btcR = [], coinR = [];
    for (let i = 1; i < n; i++) {
      const pb0 = +btcKlines[btcKlines.length - n + i - 1][4], pb1 = +btcKlines[btcKlines.length - n + i][4];
      const pc0 = +coinKlines[coinKlines.length - n + i - 1][4], pc1 = +coinKlines[coinKlines.length - n + i][4];
      if (pb0 > 0 && pc0 > 0) { btcR.push((pb1 - pb0) / pb0); coinR.push((pc1 - pc0) / pc0); }
    }
    if (btcR.length < 6) return null;
    const mB = btcR.reduce((s, v) => s + v, 0) / btcR.length;
    const mC = coinR.reduce((s, v) => s + v, 0) / coinR.length;
    let num = 0, dB = 0, dC = 0;
    for (let i = 0; i < btcR.length; i++) { const db = btcR[i] - mB, dc = coinR[i] - mC; num += db * dc; dB += db * db; dC += dc * dc; }
    const corr = dB > 0 && dC > 0 ? num / Math.sqrt(dB * dC) : 0;
    const rB = btcR.slice(-4).reduce((s, v) => s + v, 0);
    const rC = coinR.slice(-4).reduce((s, v) => s + v, 0);
    const div = rC - rB;
    let signal = '⚖️ TRACKING BTC', score = 0;
    if      (div > 0.02 && corr < 0.75) { signal = '⭐ BULLISH DIVERGENCE'; score = 20; }
    else if (div > 0.01)                { signal = '📈 OUTPERFORMING BTC';   score = 12; }
    else if (div < -0.02 && corr < 0.75){ signal = '⚠️ BEARISH DIVERGENCE'; score = -15; }
    else if (div < -0.01)               { signal = '📉 UNDERPERFORMING BTC'; score = -8; }
    else if (corr > 0.85)               { signal = '🔗 HIGH CORRELATION';    score = 2; }
    return { correlation: +corr.toFixed(3), beta: +(dB > 0 ? num / dB : 1).toFixed(2), divergence: +(div * 100).toFixed(2), recentBTC: +(rB * 100).toFixed(2), recentCoin: +(rC * 100).toFixed(2), signal, score, strength: Math.abs(corr) > 0.8 ? 'STRONG' : Math.abs(corr) > 0.5 ? 'MODERATE' : 'WEAK' };
  }

  function combineEngines(liq, taker, corr, ch24) {
    let total = 40;
    const reasons = [], warnings = [];
    if (taker.score)  { total += taker.score; if (taker.score >= 15) reasons.push('Aggressive buyers dominating'); else if (taker.score <= -15) warnings.push('Aggressive sellers — avoid long'); }
    if (corr)         { total += corr.score;  if (corr.score >= 15)  reasons.push(`Bullish divergence +${corr.divergence}% vs BTC`); else if (corr.score <= -10) warnings.push('Underperforming BTC'); }
    if (liq)          { total += liq.score;   if (liq.score >= 15)   reasons.push('Short squeeze: negative funding'); else if (liq.score <= -10) warnings.push('Long liquidation cascade risk'); }
    if (ch24 > 3)  { total += 8;  reasons.push(`+${ch24.toFixed(1)}% momentum`); }
    else if (ch24 < -5) { total -= 8; warnings.push(`${ch24.toFixed(1)}% downside`); }
    const score = Math.max(0, Math.min(100, Math.round(total)));
    const signal =
      score >= 80 ? { label: '🎯 HIGH PROBABILITY LONG', color: '#00ff88', action: 'EXECUTE' } :
      score >= 65 ? { label: '✅ VALID LONG SETUP',       color: '#00ffd0', action: 'BUY' } :
      score >= 50 ? { label: '⏳ WAIT CONFIRMATION',      color: '#FFB300', action: 'WATCH' } :
      score >= 35 ? { label: '👁️ MONITOR ONLY',           color: '#888',    action: 'WAIT' } :
                    { label: '🚫 NO TRADE',               color: '#555',    action: 'AVOID' };
    return { score, signal, reasons: reasons.slice(0, 4), warnings: warnings.slice(0, 3) };
  }

  try {
    const t0 = Date.now();

    // ── STEP 1: Spot tickers + F&G + Bybit all linear ─────────
    const [tickerR, fngR, byAllR, btcSpotKR] = await Promise.allSettled([
      sf('https://api.binance.com/api/v3/ticker/24hr', 8000),
      sf('https://api.alternative.me/fng/?limit=1&format=json', 4000),
      sf('https://api.bybit.com/v5/market/tickers?category=linear', 6000),
      sf('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=15m&limit=22', 5000),
    ]);

    const allTickers = tickerR.status === 'fulfilled' && Array.isArray(tickerR.value) ? tickerR.value : [];
    const fg = fngR.status === 'fulfilled' ? parseInt(fngR.value?.data?.[0]?.value || 50) : 50;
    const byLinear = byAllR.status === 'fulfilled' ? byAllR.value?.result?.list || [] : [];
    const btcSpotK = btcSpotKR.status === 'fulfilled' ? btcSpotKR.value : null;

    const tickerMap = {}, byMap = {};
    allTickers.forEach(t => { if (t?.symbol) tickerMap[t.symbol] = t; });
    byLinear.forEach(t => { if (t?.symbol) byMap[t.symbol] = t; });

    // BTC taker flow from Bybit
    const btcByKR = await sf('https://api.bybit.com/v5/market/kline?category=linear&symbol=BTCUSDT&interval=5&limit=12', 5000);
    const btcByKlines = btcByKR?.result?.list || null;

    // ── STEP 2: Per-symbol parallel ───────────────────────────
    const symResults = await Promise.allSettled(
      SCAN_SYMS.slice(0, 15).map(async sym => {
        try {
          const ticker = tickerMap[sym + 'USDT'];
          if (!ticker) return null;
          const price = +(ticker.lastPrice || 0), ch24 = +(ticker.priceChangePercent || 0);
          if (price <= 0) return null;
          const byT = byMap[sym + 'USDT'] || null;
          const fr  = byT?.fundingRate ? parseFloat(byT.fundingRate) : null;
          const oiUSD = byT?.openInterestValue ? +(parseFloat(byT.openInterestValue) / 1e6).toFixed(1) + 'M' : null;
          const markPx = byT?.markPrice ? +parseFloat(byT.markPrice).toFixed(4) : price;

          const [coinKR, symByKR] = await Promise.allSettled([
            sym !== 'BTC' ? sf(`https://api.binance.com/api/v3/klines?symbol=${sym}USDT&interval=15m&limit=22`, 4000) : Promise.resolve(btcSpotK),
            sym !== 'BTC' ? sf(`https://api.bybit.com/v5/market/kline?category=linear&symbol=${sym}USDT&interval=5&limit=12`, 4000) : Promise.resolve(null),
          ]);

          const coinK   = coinKR.status === 'fulfilled' ? coinKR.value : null;
          const symByK  = symByKR.status === 'fulfilled' ? symByKR.value?.result?.list || null : null;
          const kForTaker = sym === 'BTC' ? btcByKlines : symByK;

          const liq    = calcLiquidation(price, fr);
          const flow   = analyzeTakerFlow(kForTaker);
          const corr   = btcSpotK && coinK && sym !== 'BTC' ? calcCorrelation(btcSpotK, coinK) : null;
          const comb   = combineEngines(liq, flow, corr, ch24);

          return {
            symbol: sym, price, ch24: +ch24.toFixed(2), vol: +(ticker.quoteVolume || 0),
            markPrice: markPx, mktDev: markPx > 0 ? +((price - markPx) / markPx * 100).toFixed(3) : 0,
            fundingPct: fr !== null ? +(fr * 100).toFixed(4) : null, oiUSD,
            hasFullData: !!(byT && kForTaker),
            liq, flow, correl: corr,
            score: comb.score, signal: comb.signal,
            reasons: comb.reasons, warnings: comb.warnings,
          };
        } catch { return null; }
      })
    );

    const results = symResults.filter(r => r.status === 'fulfilled' && r.value).map(r => r.value).sort((a, b) => b.score - a.score);
    const btcR = results.find(r => r.symbol === 'BTC');
    const allRatios = results.filter(r => r.flow?.ratio).map(r => r.flow.ratio);
    const avgTakerBuy = allRatios.length ? +(allRatios.reduce((s, v) => s + v, 0) / allRatios.length * 100).toFixed(1) : 50;

    return res.status(200).json({
      version: 'v13', timestamp: Date.now(), scanTime: ((Date.now() - t0) / 1000).toFixed(1),
      fg, fgLabel: fg <= 25 ? 'Extreme Fear' : fg <= 45 ? 'Fear' : fg >= 75 ? 'Greed' : 'Neutral',
      totalScanned: results.length,
      market: { btcFunding: btcR?.fundingPct || null, btcMktDev: btcR?.mktDev || 0, avgTakerBuy, takerSignal: avgTakerBuy > 58 ? 'NET BUY' : avgTakerBuy < 42 ? 'NET SELL' : 'BALANCED' },
      results,
      highProb:    results.filter(r => r.score >= 65).slice(0, 5),
      divergent:   results.filter(r => r.correl?.score >= 15).slice(0, 5),
      squeezeSets: results.filter(r => r.liq?.signal?.includes('SQUEEZE')).slice(0, 4),
    });
  } catch (e) {
    return res.status(200).json({ version: 'v13', error: e.message, results: [], highProb: [], divergent: [], squeezeSets: [], timestamp: Date.now(), market: {} });
  }
}
