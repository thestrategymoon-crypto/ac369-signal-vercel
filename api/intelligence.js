// api/intelligence.js — AC369 FUSION INTELLIGENCE v1.0
// ══════════════════════════════════════════════════════════════════
// 3-ENGINE CONFLUENCE DASHBOARD
//
// ENGINE 1: LIQUIDATION INTELLIGENCE
//   → Calc long/short liquidation zones from OI + funding + price
//   → Distance from current price = danger/opportunity level
//   → Cascade risk: how many liquidations trigger if price moves X%
//
// ENGINE 2: TAKER FLOW MONITOR
//   → Aggressive buyers vs aggressive sellers (5m intervals)
//   → Ratio trend = momentum of intent, not price
//   → Best entry: taker buy rising + price at support
//
// ENGINE 3: BTC CORRELATION SCANNER
//   → Pearson correlation: coin vs BTC (last 12 × 15m = 3 hours)
//   → Divergence = coin decoupling from BTC = independent catalyst
//   → Bullish div: BTC flat/down + coin up = accumulation signal
//
// COMBINED SCORE: 0-100 (entry quality)
// ══════════════════════════════════════════════════════════════════

// Futures symbols to scan (top liquid perpetuals)
const FUTURES_SYMS = [
  'BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','XRPUSDT',
  'ADAUSDT','AVAXUSDT','DOGEUSDT','LINKUSDT','DOTUSDT',
  'MATICUSDT','ARBUSDT','OPUSDT','APTUSDT','SUIUSDT',
  'TIAUSDT','INJUSDT','NEARUSDT','ATOMUSDT','FETUSDT',
];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 's-maxage=25');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const sf = async (url, ms = 5000) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    try {
      const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
      clearTimeout(timer); if (!r.ok) return null; return await r.json();
    } catch { clearTimeout(timer); return null; }
  };

  // ════════════════════════════════════════════════════════════════
  // ENGINE 1: LIQUIDATION INTELLIGENCE
  // ════════════════════════════════════════════════════════════════
  function calcLiquidation(price, fundingRate, oiValue, klines) {
    if (!price || price <= 0) return null;
    const fr = fundingRate !== null ? fundingRate : 0;

    // Estimate typical long/short leverage distribution
    // When funding is positive → longs dominate → liq below price
    // When funding is negative → shorts dominate → liq above price
    const longBias = fr >= 0; // positive funding = more longs
    const fundAbs  = Math.abs(fr * 100); // funding as %

    // Liquidation zones at typical leverage levels: 5x, 10x, 20x, 50x
    // Liq price for long = entry × (1 - 1/leverage + maintenance_margin)
    // Simplified: liq ≈ entry × (1 - 1/leverage)
    const leverages = [5, 10, 20, 50];
    const longLiqZones  = leverages.map(lev => ({
      leverage: lev,
      price: +(price * (1 - 1 / lev)).toFixed(4),
      distPct: +(100 / lev).toFixed(1),
      // Intensity: higher funding = more longs at this leverage
      intensity: longBias
        ? Math.min(100, fundAbs * 20 + (lev <= 10 ? 40 : lev <= 20 ? 25 : 15))
        : Math.min(40, lev <= 5 ? 20 : 10),
    }));
    const shortLiqZones = leverages.map(lev => ({
      leverage: lev,
      price: +(price * (1 + 1 / lev)).toFixed(4),
      distPct: +(100 / lev).toFixed(1),
      intensity: !longBias
        ? Math.min(100, fundAbs * 20 + (lev <= 10 ? 40 : lev <= 20 ? 25 : 15))
        : Math.min(40, lev <= 5 ? 20 : 10),
    }));

    // Cascade risk: if price drops X%, how many long liquidations?
    const cascadeRisk = longLiqZones.reduce((risk, z) => {
      const dist = (price - z.price) / price * 100;
      if (dist <= 5)  return risk + z.intensity * 0.5;
      if (dist <= 10) return risk + z.intensity * 0.3;
      return risk;
    }, 0);
    const cascadeNorm = Math.min(100, Math.round(cascadeRisk));

    // Most dangerous zone (closest with highest intensity)
    const dangerLong  = longLiqZones.filter(z => z.intensity > 20).sort((a, b) => b.intensity - a.intensity)[0] || longLiqZones[1];
    const dangerShort = shortLiqZones.filter(z => z.intensity > 20).sort((a, b) => b.intensity - a.intensity)[0] || shortLiqZones[1];

    // OI context
    const oiM = oiValue ? +(oiValue / 1e6).toFixed(1) : null;

    // Signal
    let liqSignal = 'NEUTRAL', liqScore = 0;
    if (fr < -0.005) {
      liqSignal = '🔥 SHORT SQUEEZE ZONE';
      liqScore = 25; // short liq above = price pump catalyst
    } else if (fr > 0.05 && cascadeNorm > 50) {
      liqSignal = '⚠️ LONG LIQ CASCADE RISK';
      liqScore = -15;
    } else if (fr > 0.02) {
      liqSignal = '⚠️ OVERLEVERAGED LONGS';
      liqScore = -8;
    } else if (fr < 0) {
      liqSignal = '📈 NEGATIVE FUNDING — LONG BIAS';
      liqScore = 15;
    } else {
      liqSignal = '⚖️ BALANCED';
      liqScore = 5;
    }

    return {
      fundingPct:   +(fr * 100).toFixed(4),
      fundingTrend: fr > 0.02 ? 'EXTREME_LONG' : fr > 0 ? 'LONG_BIAS' : fr < -0.01 ? 'EXTREME_SHORT' : 'SHORT_BIAS',
      longBias,
      longLiqZones:  longLiqZones,
      shortLiqZones: shortLiqZones,
      dangerLong, dangerShort,
      cascadeRisk: cascadeNorm,
      oiUSD: oiM,
      signal: liqSignal,
      score: liqScore,
      closestLongLiq:  +(longLiqZones[1]?.price || price * 0.9).toFixed(4),  // 10x long liq
      closestShortLiq: +(shortLiqZones[1]?.price || price * 1.1).toFixed(4), // 10x short liq
    };
  }

  // ════════════════════════════════════════════════════════════════
  // ENGINE 2: TAKER FLOW MONITOR
  // ════════════════════════════════════════════════════════════════
  function analyzeTakerFlow(takerData) {
    if (!takerData?.length) {
      return { signal: 'DATA TIDAK TERSEDIA', score: 0, ratio: 0.5, trend: 'UNKNOWN' };
    }

    // takerData: [{buySellRatio, buyVol, sellVol, timestamp}]
    const rows = takerData.slice(-12); // last 12 periods
    const latest  = rows[rows.length - 1];
    const buyVol  = rows.reduce((s, r) => s + parseFloat(r.buyVol  || 0), 0);
    const sellVol = rows.reduce((s, r) => s + parseFloat(r.sellVol || 0), 0);
    const totalVol = buyVol + sellVol;
    const ratio    = totalVol > 0 ? buyVol / totalVol : 0.5;

    // Trend: is ratio increasing or decreasing?
    const firstHalf  = rows.slice(0, 6);
    const secondHalf = rows.slice(6);
    const r1 = firstHalf.reduce((s, r) => s + parseFloat(r.buyVol || 0), 0) /
               (firstHalf.reduce((s, r) => s + parseFloat(r.buyVol || 0) + parseFloat(r.sellVol || 0), 0) || 1);
    const r2 = secondHalf.reduce((s, r) => s + parseFloat(r.buyVol || 0), 0) /
               (secondHalf.reduce((s, r) => s + parseFloat(r.buyVol || 0) + parseFloat(r.sellVol || 0), 0) || 1);
    const trend = r2 - r1 > 0.03 ? 'RISING ↗' : r2 - r1 < -0.03 ? 'FALLING ↘' : 'FLAT →';
    const trendDir = r2 > r1 ? 1 : -1;

    // Last period ratio for recency
    const latestRatio = latest
      ? parseFloat(latest.buyVol || 0) / (parseFloat(latest.buyVol || 0) + parseFloat(latest.sellVol || 0) + 0.0001)
      : ratio;

    let signal = 'NEUTRAL', takerScore = 0;
    if (ratio > 0.65 && trend === 'RISING ↗') {
      signal = '🟢 AGGRESSIVE BUY SURGE'; takerScore = 25;
    } else if (ratio > 0.60) {
      signal = '🟢 BUYER DOMINANT';       takerScore = 18;
    } else if (ratio > 0.52) {
      signal = '🟩 MILD BUY PRESSURE';    takerScore = 10;
    } else if (ratio < 0.35 && trend === 'FALLING ↘') {
      signal = '🔴 AGGRESSIVE SELL SURGE'; takerScore = -20;
    } else if (ratio < 0.40) {
      signal = '🔴 SELLER DOMINANT';      takerScore = -15;
    } else if (ratio < 0.48) {
      signal = '🟥 MILD SELL PRESSURE';   takerScore = -8;
    } else {
      signal = '⚖️ BALANCED FLOW';         takerScore = 3;
    }

    if (trendDir > 0 && takerScore > 0) takerScore = Math.min(25, takerScore + 5);
    if (trendDir < 0 && takerScore < 0) takerScore = Math.max(-20, takerScore - 5);

    return {
      signal, score: takerScore,
      ratio: +ratio.toFixed(3),
      ratioLatest: +latestRatio.toFixed(3),
      trend,
      buyPct:  +(ratio * 100).toFixed(1),
      sellPct: +((1 - ratio) * 100).toFixed(1),
      totalVolUSD: +totalVol.toFixed(0),
      history: rows.slice(-8).map(r => ({
        buy:  +(parseFloat(r.buyVol  || 0)).toFixed(0),
        sell: +(parseFloat(r.sellVol || 0)).toFixed(0),
        ts:   r.timestamp || 0,
      })),
    };
  }

  // ════════════════════════════════════════════════════════════════
  // ENGINE 3: BTC CORRELATION SCANNER
  // ════════════════════════════════════════════════════════════════
  function calcCorrelation(btcKlines, coinKlines) {
    if (!btcKlines?.length || !coinKlines?.length) return null;
    const n = Math.min(btcKlines.length, coinKlines.length, 20);
    if (n < 8) return null;

    // Use % returns, not raw prices
    const btcRets  = [], coinRets = [];
    for (let i = 1; i < n; i++) {
      const pb0 = +btcKlines[btcKlines.length - n + i - 1][4];
      const pb1 = +btcKlines[btcKlines.length - n + i][4];
      const pc0 = +coinKlines[coinKlines.length - n + i - 1][4];
      const pc1 = +coinKlines[coinKlines.length - n + i][4];
      if (pb0 > 0 && pc0 > 0) {
        btcRets.push((pb1 - pb0) / pb0);
        coinRets.push((pc1 - pc0) / pc0);
      }
    }
    if (btcRets.length < 6) return null;

    // Pearson correlation
    const meanB = btcRets.reduce((s, v) => s + v, 0) / btcRets.length;
    const meanC = coinRets.reduce((s, v) => s + v, 0) / coinRets.length;
    let num = 0, denB = 0, denC = 0;
    for (let i = 0; i < btcRets.length; i++) {
      const db = btcRets[i] - meanB, dc = coinRets[i] - meanC;
      num += db * dc; denB += db * db; denC += dc * dc;
    }
    const corr = (denB > 0 && denC > 0) ? num / Math.sqrt(denB * denC) : 0;

    // Recent divergence: last 4 candles
    const recentBTC  = btcRets.slice(-4).reduce((s, v) => s + v, 0);
    const recentCoin = coinRets.slice(-4).reduce((s, v) => s + v, 0);
    const divergence = recentCoin - recentBTC; // positive = coin outperforming

    // Beta: how much coin moves per 1% BTC move
    const beta = denB > 0 ? num / denB : 1;

    let corrSignal = 'NEUTRAL', corrScore = 0;
    if (divergence > 0.02 && corr < 0.7) {
      corrSignal = '⭐ BULLISH DIVERGENCE';  corrScore = 20;
    } else if (divergence > 0.01) {
      corrSignal = '📈 OUTPERFORMING BTC';   corrScore = 12;
    } else if (divergence < -0.02 && corr < 0.7) {
      corrSignal = '⚠️ BEARISH DIVERGENCE';  corrScore = -15;
    } else if (divergence < -0.01) {
      corrSignal = '📉 UNDERPERFORMING BTC'; corrScore = -8;
    } else if (corr > 0.85) {
      corrSignal = '🔗 HIGH CORRELATION';    corrScore = 2;
    } else {
      corrSignal = '⚖️ TRACKING BTC';        corrScore = 0;
    }

    return {
      correlation: +corr.toFixed(3),
      beta: +beta.toFixed(2),
      divergence: +(divergence * 100).toFixed(2), // as %
      recentBTC:  +(recentBTC  * 100).toFixed(2),
      recentCoin: +(recentCoin * 100).toFixed(2),
      signal: corrSignal,
      score: corrScore,
      strength: Math.abs(corr) > 0.8 ? 'STRONG' : Math.abs(corr) > 0.5 ? 'MODERATE' : 'WEAK',
    };
  }

  // ════════════════════════════════════════════════════════════════
  // COMBINED SIGNAL
  // ════════════════════════════════════════════════════════════════
  function combineEngines(liq, taker, corr, ch24, price) {
    let total = 40; // base
    const reasons = [], warnings = [];

    // Taker flow (most real-time)
    if (taker.score !== 0) {
      total += taker.score;
      if (taker.score >= 15) reasons.push('Aggressive buyers dominating taker flow');
      else if (taker.score <= -15) warnings.push('Aggressive sellers — avoid long entry');
    }

    // Correlation / divergence
    if (corr) {
      total += corr.score;
      if (corr.score >= 15) reasons.push(`Bullish divergence +${corr.divergence}% vs BTC`);
      else if (corr.score <= -10) warnings.push('Underperforming BTC — weak relative strength');
    }

    // Liquidation engine
    if (liq) {
      total += liq.score;
      if (liq.score >= 15) reasons.push('Short squeeze setup: negative funding');
      else if (liq.score <= -10) warnings.push('Long liquidation cascade risk — overleveraged market');
    }

    // 24h momentum
    if (ch24 > 3) { total += 8; reasons.push(`+${ch24.toFixed(1)}% momentum supporting`); }
    else if (ch24 < -5) { total -= 8; warnings.push(`${ch24.toFixed(1)}% — downside momentum`); }

    const score = Math.max(0, Math.min(100, Math.round(total)));
    const signal =
      score >= 80 ? { label: '🎯 HIGH PROBABILITY LONG', color: '#00ff88', action: 'EXECUTE' } :
      score >= 65 ? { label: '✅ VALID LONG SETUP',       color: '#00ffd0', action: 'BUY' } :
      score >= 50 ? { label: '⏳ WAIT CONFIRMATION',      color: '#FFB300', action: 'WATCH' } :
      score >= 35 ? { label: '👁️ MONITOR ONLY',           color: '#888',    action: 'WAIT' } :
                    { label: '🚫 NO TRADE',               color: '#555',    action: 'AVOID' };

    return { score, signal, reasons: reasons.slice(0, 4), warnings: warnings.slice(0, 3) };
  }

  // ════════════════════════════════════════════════════════════════
  // MAIN HANDLER
  // ════════════════════════════════════════════════════════════════
  try {
    const t0 = Date.now();

    // Fetch BTC ticker + Fear & Greed first
    const [tickerR, fngR] = await Promise.allSettled([
      (async () => {
        // Try sources sequentially with timeout
        const b1 = await sf('https://api.binance.com/api/v3/ticker/24hr', 8000);
        if (Array.isArray(b1) && b1.length > 100) return b1;
        const b2 = await sf('https://fapi.binance.com/fapi/v1/ticker/24hr', 7000);
        if (Array.isArray(b2) && b2.length > 50) return b2;
        const by = await sf('https://api.bybit.com/v5/market/tickers?category=spot', 7000);
        if (by?.result?.list?.length > 50) return by.result.list.map(t => ({
          symbol: t.symbol||'', lastPrice: t.lastPrice||'0',
          priceChangePercent: t.price24hPcnt?(parseFloat(t.price24hPcnt)*100).toFixed(4):'0',
          quoteVolume: t.turnover24h||'0',
        }));
        return null;
      })(),
      sf('https://api.alternative.me/fng/?limit=1&format=json', 4000),
    ]);

    const allTickers = tickerR.status === 'fulfilled' && Array.isArray(tickerR.value) ? tickerR.value : [];
    const fg = fngR.status === 'fulfilled' ? parseInt(fngR.value?.data?.[0]?.value || 50) : 50;

    const tickerMap = {};
    allTickers.forEach(t => { if (t?.symbol) tickerMap[t.symbol] = t; });

    // Get BTC klines for correlation
    const btcKlines = await sf('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=15m&limit=22', 4500);

    // Process each futures symbol in parallel
    const symResults = await Promise.allSettled(
      FUTURES_SYMS.slice(0, 15).map(async (sym) => {
        try {
        const ticker = tickerMap[sym];
        if (!ticker) return null;
        const price = +(ticker.lastPrice || 0);
        const ch24  = +(ticker.priceChangePercent || 0);
        if (price <= 0) return null;
        const base = sym.replace('USDT', '');

        // Parallel fetch for this symbol
        const [premR, takerR, oiR, kR] = await Promise.allSettled([
          sf(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${sym}`, 3500),
          sf(`https://fapi.binance.com/futures/data/takerbuybasevol?symbol=${sym}&contractType=PERPETUAL&period=5m&limit=12`, 3500),
          sf(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${sym}`, 3000),
          base === 'BTC' ? Promise.resolve(btcKlines) :
            sf(`https://api.binance.com/api/v3/klines?symbol=${sym}&interval=15m&limit=22`, 3500),
        ]);

        const prem    = premR.status === 'fulfilled' ? premR.value : null;
        const taker   = takerR.status === 'fulfilled' && Array.isArray(takerR.value) ? takerR.value : null;
        const oi      = oiR.status === 'fulfilled' ? oiR.value : null;
        const klines  = kR.status === 'fulfilled' ? kR.value : null;

        const fr     = prem?.lastFundingRate ? parseFloat(prem.lastFundingRate) : null;
        const oiVal  = oi?.openInterest ? parseFloat(oi.openInterest) * price : null;
        const markPx = prem?.markPrice ? parseFloat(prem.markPrice) : price;
        const mktDev = markPx > 0 ? +((price - markPx) / markPx * 100).toFixed(3) : 0;

        // Run engines
        const liq    = calcLiquidation(price, fr, oiVal, klines);
        const flow   = analyzeTakerFlow(taker);
        const correl = (btcKlines && klines && base !== 'BTC')
          ? calcCorrelation(btcKlines, klines) : null;
        const combined = combineEngines(liq, flow, correl, ch24, price);

        return {
          symbol: base,
          price, ch24: +ch24.toFixed(2),
          vol: +(ticker.quoteVolume || 0),
          markPrice: +markPx.toFixed(4),
          mktDev, // spot vs futures premium/discount
          fundingPct: fr !== null ? +(fr * 100).toFixed(4) : null,
          oiUSD: oiVal ? +(oiVal / 1e6).toFixed(1) + 'M' : null,
          hasFullData: !!(prem && taker && klines),
          // Engine results
          liq, flow, correl,
          // Combined
          score: combined.score,
          signal: combined.signal,
          reasons: combined.reasons,
          warnings: combined.warnings,
        };
        } catch(symErr) { return null; } // safety catch per symbol
      })
    );

    const results = symResults
      .filter(r => r.status === 'fulfilled' && r.value)
      .map(r => r.value)
      .sort((a, b) => b.score - a.score);

    // BTC reference data
    const btcR = results.find(r => r.symbol === 'BTC');
    const btcFunding = btcR?.fundingPct || null;
    const btcMktDev  = btcR?.mktDev    || 0;

    // Market-wide taker flow summary
    const allBuyPct = results.filter(r => r.flow?.ratio).map(r => r.flow.ratio);
    const avgTakerBuy = allBuyPct.length
      ? +(allBuyPct.reduce((s, v) => s + v, 0) / allBuyPct.length * 100).toFixed(1)
      : 50;

    // Divergence leaders
    const divergent = results.filter(r => r.correl?.score >= 15).slice(0, 5);
    const highProb  = results.filter(r => r.score >= 65).slice(0, 5);
    const squeezeSets = results.filter(r => r.liq?.signal?.includes('SQUEEZE')).slice(0, 4);

    return res.status(200).json({
      version: 'v1.0',
      timestamp: Date.now(),
      scanTime: ((Date.now() - t0) / 1000).toFixed(1),
      fg, fgLabel: fg <= 25 ? 'Extreme Fear' : fg <= 45 ? 'Fear' : fg >= 75 ? 'Greed' : 'Neutral',
      totalScanned: results.length,
      market: {
        btcFunding,
        btcMktDev,
        avgTakerBuy,
        takerSignal: avgTakerBuy > 58 ? 'NET BUY' : avgTakerBuy < 42 ? 'NET SELL' : 'BALANCED',
      },
      results,
      highProb,
      divergent,
      squeezeSets,
    });

  } catch (e) {
    return res.status(200).json({
      version: 'v1.0', error: e.message,
      results: [], highProb: [], divergent: [], squeezeSets: [],
      timestamp: Date.now(), market: {},
    });
  }
}
