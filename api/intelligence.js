// api/intelligence.js — v16
// 3-Engine: Liquidation Heatmap + Taker Flow + BTC Correlation
// Sumber: Bybit single-symbol (tidak diblokir), CryptoCompare klines
// ⚠️ TIDAK ADA api.binance.com/fapi — semua Bybit

const COINS = [
  'BTC','ETH','BNB','SOL','XRP','ADA','AVAX','DOGE','LINK','DOT',
  'NEAR','APT','SUI','INJ','ARB','OP','TIA','PEPE','TON','RENDER',
];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=15');
  if (req.method === 'OPTIONS') return res.status(200).end();
  const t0 = Date.now();

  const sf = async (url, ms) => {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), ms);
    try {
      const r = await fetch(url, { signal: c.signal, headers: { Accept: 'application/json', 'User-Agent': 'AC369/1.0' } });
      clearTimeout(t); if (!r.ok) return null; return await r.json();
    } catch { clearTimeout(t); return null; }
  };

  // RSI helper
  const RSI14 = (a) => {
    if (!a || a.length < 16) return null;
    let ag=0, al=0;
    for (let i=1;i<=14;i++){const d=a[i]-a[i-1];d>0?ag+=d:al-=d;}
    ag/=14; al/=14;
    for (let i=15;i<a.length;i++){const d=a[i]-a[i-1];ag=(ag*13+Math.max(d,0))/14;al=(al*13+Math.max(-d,0))/14;}
    return al===0?100:+(100-100/(1+ag/al)).toFixed(2);
  };

  const EMA = (a,p) => {
    if (!a||a.length<2) return a?.[a.length-1]||0;
    const k=2/(p+1); let e=a.slice(0,Math.min(p,a.length)).reduce((s,v)=>s+v,0)/Math.min(p,a.length);
    for(let i=Math.min(p,a.length);i<a.length;i++) e=a[i]*k+e*(1-k);
    return +e.toFixed(6);
  };

  try {
    // ── STEP 1: BTC base data + F&G parallel ──────────────
    const [btcTickR, btcKlineR, fngR, glR] = await Promise.allSettled([
      sf('https://api.bybit.com/v5/market/tickers?category=linear&symbol=BTCUSDT', 4000),
      sf('https://min-api.cryptocompare.com/data/v2/histohour?fsym=BTC&tsym=USD&limit=56&aggregate=4&e=CCCAGG', 5000),
      sf('https://api.alternative.me/fng/?limit=1&format=json', 3000),
      sf('https://api.coingecko.com/api/v3/global', 4000),
    ]);

    const btcTick = btcTickR.status==='fulfilled' ? btcTickR.value?.result?.list?.[0] : null;
    const btcKRaw = btcKlineR.status==='fulfilled' && btcKlineR.value?.Response==='Success'
      ? btcKlineR.value.Data?.Data?.filter(d=>d.close>0) : [];
    const btcCloses = btcKRaw.map(d=>+d.close);
    const btcPrice  = btcTick ? +(btcTick.lastPrice||0) : 0;
    const btcFr     = btcTick?.fundingRate ? +(parseFloat(btcTick.fundingRate)*100).toFixed(4) : null;
    const btcOi     = btcTick?.openInterestValue ? +(parseFloat(btcTick.openInterestValue)/1e9).toFixed(2) : null;
    const btcRSI    = RSI14(btcCloses);
    const btcEMA200 = EMA(btcCloses, Math.min(200, btcCloses.length-1));
    const fg        = fngR.status==='fulfilled' ? parseInt(fngR.value?.data?.[0]?.value||50) : 50;
    const btcDom    = glR.status==='fulfilled' ? +(glR.value?.data?.market_cap_percentage?.btc||58).toFixed(1) : 58;

    // BTC 24h change
    const btcChg = btcCloses.length >= 6
      ? +((btcCloses[btcCloses.length-1] - btcCloses[btcCloses.length-6]) / btcCloses[btcCloses.length-6] * 100).toFixed(2)
      : 0;

    // ── STEP 2: Per-coin analysis (parallel, max 8 coins) ─
    // Use CryptoCompare for klines + Bybit for derivatives
    const batch1 = COINS.slice(0, 8);
    const batch2 = COINS.slice(8, 16);

    const analyseCoin = async (sym) => {
      const [kR, tickR] = await Promise.allSettled([
        sf(`https://min-api.cryptocompare.com/data/v2/histohour?fsym=${sym}&tsym=USD&limit=48&aggregate=4&e=CCCAGG`, 5000),
        sf(`https://api.bybit.com/v5/market/tickers?category=linear&symbol=${sym}USDT`, 3500),
      ]);

      const tick = tickR.status==='fulfilled' ? tickR.value?.result?.list?.[0] : null;
      const kRaw = kR.status==='fulfilled' && kR.value?.Response==='Success'
        ? kR.value.Data?.Data?.filter(d=>d.close>0) : [];
      const closes = kRaw.map(d=>+d.close);

      const price  = tick ? +(tick.lastPrice||0) : (closes.length ? closes[closes.length-1] : 0);
      const fr     = tick?.fundingRate ? +(parseFloat(tick.fundingRate)*100).toFixed(4) : null;
      const oi     = tick?.openInterestValue ? +(parseFloat(tick.openInterestValue)/1e6).toFixed(1) : null;
      const oiUSD  = oi ? `$${oi}M` : null;
      const ch24   = closes.length >= 6
        ? +((closes[closes.length-1]-closes[closes.length-6])/closes[closes.length-6]*100).toFixed(2)
        : (tick?.price24hPcnt ? +(parseFloat(tick.price24hPcnt)*100).toFixed(2) : 0);

      const rsi    = RSI14(closes);
      const ema200 = closes.length >= 20 ? EMA(closes, Math.min(200,closes.length-1)) : price;
      const ema50  = closes.length >= 10 ? EMA(closes, Math.min(50,closes.length-1))  : price;

      // ── ENGINE 1: LIQUIDATION HEATMAP (proxy via FR + OI) ──
      const liqScore = (() => {
        let s = 0, sig = 'No Data', cascadeRisk = 0;
        if (fr === null) return { score: 0, signal: 'No Data', cascadeRisk: 0 };
        // Negative funding = shorts overloaded = bullish long squeeze setup
        if      (fr < -0.02)  { s = 25; sig = '⚡ Short Squeeze IMMINENT'; cascadeRisk = 85; }
        else if (fr < -0.005) { s = 15; sig = '🟢 Short Squeeze Potential'; cascadeRisk = 60; }
        else if (fr < 0)      { s = 8;  sig = '🟢 Mild Negative FR'; cascadeRisk = 35; }
        else if (fr > 0.08)   { s = -25; sig = '🔴 Long Liquidation Risk'; cascadeRisk = 80; }
        else if (fr > 0.04)   { s = -15; sig = '⚠️ Long Squeeze Risk'; cascadeRisk = 55; }
        else if (fr > 0.02)   { s = -8;  sig = '⚠️ Elevated Longs'; cascadeRisk = 30; }
        else                   { s = 3;   sig = '⚖️ Balanced Funding'; cascadeRisk = 15; }
        return { score: s, signal: sig, cascadeRisk, fr };
      })();

      // ── ENGINE 2: TAKER FLOW (proxy via price action + RSI) ─
      const flowScore = (() => {
        if (!closes.length || rsi === null) return { score: 0, signal: 'No Data', buyPct: 50, sellPct: 50 };
        // Estimate taker flow from RSI + momentum
        const momentum  = closes.length >= 3 ? (closes[closes.length-1]-closes[closes.length-3])/closes[closes.length-3]*100 : 0;
        const rsiNorm   = (rsi - 50) / 50; // -1 to 1
        const momNorm   = Math.max(-1, Math.min(1, momentum / 5));
        const buyPct    = +Math.max(20, Math.min(80, 50 + (rsiNorm + momNorm) * 15)).toFixed(1);
        const sellPct   = +(100 - buyPct).toFixed(1);
        let s = 0, sig = 'Neutral';
        if      (buyPct >= 65) { s = 18; sig = '🟢 NET BUY — inflow kuat'; }
        else if (buyPct >= 58) { s = 10; sig = '🟢 Mild Buy Dominance'; }
        else if (buyPct <= 35) { s = -18; sig = '🔴 NET SELL — outflow kuat'; }
        else if (buyPct <= 42) { s = -10; sig = '🔴 Mild Sell Dominance'; }
        else                    { s = 2;  sig = '⚖️ Balanced Flow'; }
        return { score: s, signal: sig, buyPct, sellPct };
      })();

      // ── ENGINE 3: BTC CORRELATION ─────────────────────────
      const corrScore = (() => {
        if (!closes.length || !btcCloses.length) return { score: 0, signal: 'No Data' };
        // Compare 6-period returns
        const n = Math.min(closes.length, btcCloses.length, 10);
        const coinRet  = closes.length >= n ? (closes[closes.length-1]-closes[closes.length-n])/closes[closes.length-n]*100 : ch24;
        const btcRet   = btcCloses.length >= n ? (btcCloses[btcCloses.length-1]-btcCloses[btcCloses.length-n])/btcCloses[btcCloses.length-n]*100 : btcChg;
        const divergence = +(coinRet - btcRet).toFixed(2);
        // Calculate correlation coefficient
        let corr = null;
        if (closes.length >= 10 && btcCloses.length >= 10) {
          const len = Math.min(closes.length, btcCloses.length);
          const cx = closes.slice(-len), cy = btcCloses.slice(-len);
          const mx = cx.reduce((s,v)=>s+v,0)/len, my = cy.reduce((s,v)=>s+v,0)/len;
          const num = cx.reduce((s,v,i)=>s+(v-mx)*(cy[i]-my),0);
          const denom = Math.sqrt(cx.reduce((s,v)=>s+(v-mx)**2,0)*cy.reduce((s,v)=>s+(v-my)**2,0));
          corr = denom > 0 ? +(num/denom).toFixed(3) : null;
        }
        let s = 0, sig = 'Correlated';
        if      (divergence > 8)  { s = 20; sig = '⭐ Strong Divergence (+)'; }
        else if (divergence > 4)  { s = 12; sig = '🟢 Mild Divergence (+)'; }
        else if (divergence > 2)  { s = 6;  sig = '🟢 Slight Outperform'; }
        else if (divergence < -8) { s = -20; sig = '🔴 Strong Lagging'; }
        else if (divergence < -4) { s = -12; sig = '🔴 Mild Underperform'; }
        else if (divergence < -2) { s = -6;  sig = '⚠️ Slight Underperform'; }
        else                       { s = 0;   sig = '⚖️ BTC Correlated'; }
        return { score: s, signal: sig, divergence, correlation: corr, recentCoin: +coinRet.toFixed(2), recentBTC: +btcRet.toFixed(2) };
      })();

      // ── TOTAL SCORE ──────────────────────────────────────
      const totalScore = Math.max(-100, Math.min(100, liqScore.score + flowScore.score + corrScore.score));
      const hasFullData = !!(rsi && fr !== null);

      let signal = {}, reasons = [], warnings = [];
      if      (totalScore >= 40) { signal = { label:'🚀 STRONG BUY — Triple Engine Bullish', color:'var(--g)',   action:'BUY AGRESIF' }; }
      else if (totalScore >= 20) { signal = { label:'🟢 BUY Setup — Multi Engine Aligned',  color:'var(--g2)',  action:'BUY NORMAL' }; }
      else if (totalScore >= 8)  { signal = { label:'🟡 Mild Buy — Partial Setup',           color:'var(--amber)', action:'BUY KECIL' }; }
      else if (totalScore <= -40){ signal = { label:'💀 STRONG SELL — Triple Engine Bearish', color:'var(--red)', action:'SELL / SHORT' }; }
      else if (totalScore <= -20){ signal = { label:'🔴 SELL Setup — Bearish Aligned',        color:'var(--red)', action:'KURANGI LONG' }; }
      else if (totalScore <= -8) { signal = { label:'⚠️ Mild Bearish — Caution',             color:'var(--amber)', action:'WAIT' }; }
      else                       { signal = { label:'⚖️ NEUTRAL — No Edge',                  color:'var(--muted)', action:'WAIT' }; }

      // Build reasons
      if (liqScore.score > 0)  reasons.push(liqScore.signal);
      if (flowScore.score > 0) reasons.push(flowScore.signal);
      if (corrScore.score > 0) reasons.push(corrScore.signal);
      if (rsi && rsi < 30)     reasons.push(`RSI ${rsi} oversold — reversal zone`);
      if (price > ema200 && ema200 > 0) reasons.push('Harga di atas EMA200 — uptrend');
      if (liqScore.score < 0)  warnings.push(liqScore.signal);
      if (flowScore.score < 0) warnings.push(flowScore.signal);
      if (rsi && rsi > 75)     warnings.push(`RSI ${rsi} overbought`);
      if (liqScore.cascadeRisk > 70) warnings.push(`Cascade risk ${liqScore.cascadeRisk}%`);

      return {
        symbol: sym, price: +price.toFixed(8), ch24,
        rsi, ema200: +ema200.toFixed(4), ema50: +ema50.toFixed(4),
        fundingPct: fr,
        oiUSD, hasFullData,
        liq:    liqScore,
        flow:   flowScore,
        correl: corrScore,
        score:  totalScore,
        signal, reasons, warnings,
      };
    };

    // Run batch 1 and batch 2 parallel
    const [batch1Results, batch2Results] = await Promise.allSettled([
      Promise.allSettled(batch1.map(analyseCoin)),
      Promise.allSettled(batch2.map(analyseCoin)),
    ]);

    const allResults = [
      ...(batch1Results.status==='fulfilled' ? batch1Results.value : []),
      ...(batch2Results.status==='fulfilled' ? batch2Results.value : []),
    ]
    .filter(r => r.status === 'fulfilled' && r.value?.price > 0)
    .map(r => r.value)
    .sort((a,b) => b.score - a.score);

    // Market overview
    const avgTakerBuy = allResults.length
      ? +(allResults.reduce((s,c)=>s+(c.flow?.buyPct||50),0)/allResults.length).toFixed(1) : 50;
    const takerSignal = avgTakerBuy >= 58 ? 'NET BUY' : avgTakerBuy <= 42 ? 'NET SELL' : 'BALANCED';

    const highProb    = allResults.filter(c => c.score >= 20);
    const squeezeSets = allResults.filter(c => c.liq?.score > 10);
    const divergent   = allResults.filter(c => (c.correl?.divergence||0) > 3);

    return res.status(200).json({
      ok: true, ts: Date.now(), elapsed: Date.now()-t0, version: 'v16',
      btcPrice, btcFr, btcOi, btcRSI, btcChg, btcDom, fg,
      market: {
        avgTakerBuy, takerSignal,
        btcFunding: btcFr,
        btcRsi:     btcRSI,
        bullBias:   allResults.filter(c=>c.score>0).length,
        bearBias:   allResults.filter(c=>c.score<0).length,
      },
      results:     allResults,
      highProb,
      squeezeSets,
      divergent,
    });

  } catch (e) {
    return res.status(200).json({
      ok: false, error: e.message, ts: Date.now(), elapsed: Date.now()-t0, version: 'v16',
      btcPrice: 0, fg: 50, btcDom: 58,
      market: { avgTakerBuy: 50, takerSignal: 'BALANCED', btcFunding: null },
      results: [], highProb: [], squeezeSets: [], divergent: [],
    });
  }
}
