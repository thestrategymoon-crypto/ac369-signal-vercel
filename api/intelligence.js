// api/intelligence.js — AC369 FUSION INTELLIGENCE v2.0
// ══════════════════════════════════════════════════════════════════
// UPGRADE v2.0:
// - Bybit PRIMARY for all derivatives (Binance /fapi/ blocked on Vercel)
// - OKX fallback for funding + OI
// - Taker flow from Bybit kline candle delta (buy>close vs sell>close)
// - BTC correlation using Binance spot klines (always accessible)
// - Liquidation zones recalculated with real Bybit funding data
// - Intelligence scan now returns real coin results (not empty)
// ══════════════════════════════════════════════════════════════════

const FUTURES_SYMS = [
  'BTC','ETH','SOL','BNB','XRP',
  'ADA','AVAX','DOGE','LINK','DOT',
  'ARB','OP','APT','SUI','TIA',
  'INJ','NEAR','ATOM','FET','RNDR',
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
  // Uses real Bybit funding + OI data
  // ════════════════════════════════════════════════════════════════
  function calcLiquidation(price, fundingRate, oiValue) {
    if (!price || price <= 0) return null;
    const fr = fundingRate !== null && fundingRate !== undefined ? fundingRate : 0;
    const longBias = fr >= 0;
    const fundAbs  = Math.abs(fr * 100);

    const leverages = [5, 10, 20, 50];
    const longLiqZones = leverages.map(lev => ({
      leverage: lev,
      price: +(price * (1 - 1 / lev)).toFixed(4),
      distPct: +(100 / lev).toFixed(1),
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

    const cascadeRisk = longLiqZones.reduce((risk, z) => {
      const dist = (price - z.price) / price * 100;
      if (dist <= 5)  return risk + z.intensity * 0.5;
      if (dist <= 10) return risk + z.intensity * 0.3;
      return risk;
    }, 0);

    const dangerLong  = longLiqZones.filter(z => z.intensity > 20).sort((a, b) => b.intensity - a.intensity)[0] || longLiqZones[1];
    const dangerShort = shortLiqZones.filter(z => z.intensity > 20).sort((a, b) => b.intensity - a.intensity)[0] || shortLiqZones[1];

    let liqSignal = 'NEUTRAL', liqScore = 0;
    if (fr < -0.005) {
      liqSignal = '🔥 SHORT SQUEEZE ZONE'; liqScore = 25;
    } else if (fr > 0.05 && cascadeRisk > 50) {
      liqSignal = '⚠️ LONG LIQ CASCADE RISK'; liqScore = -15;
    } else if (fr > 0.02) {
      liqSignal = '⚠️ OVERLEVERAGED LONGS'; liqScore = -8;
    } else if (fr < 0) {
      liqSignal = '📈 NEGATIVE FUNDING — LONG BIAS'; liqScore = 15;
    } else {
      liqSignal = '⚖️ BALANCED'; liqScore = 5;
    }

    return {
      fundingPct: +(fr * 100).toFixed(4),
      fundingTrend: fr > 0.04 ? 'EXTREME_LONG' : fr > 0 ? 'LONG_BIAS' : fr < -0.01 ? 'EXTREME_SHORT' : 'SHORT_BIAS',
      longBias,
      longLiqZones, shortLiqZones,
      dangerLong, dangerShort,
      cascadeRisk: Math.min(100, Math.round(cascadeRisk)),
      oiUSD: oiValue ? +(oiValue / 1e6).toFixed(1) : null,
      signal: liqSignal, score: liqScore,
      closestLongLiq:  +(longLiqZones[1]?.price  || price * 0.9).toFixed(4),
      closestShortLiq: +(shortLiqZones[1]?.price || price * 1.1).toFixed(4),
    };
  }

  // ════════════════════════════════════════════════════════════════
  // ENGINE 2: TAKER FLOW MONITOR
  // Uses Bybit kline candle delta: close>open = buy candle
  // ════════════════════════════════════════════════════════════════
  function analyzeTakerFlow(klines) {
    if (!klines || klines.length < 4) {
      return { signal: 'DATA TIDAK TERSEDIA', score: 0, ratio: 0.5, trend: 'UNKNOWN', buyPct: 50, sellPct: 50 };
    }

    // Bybit kline format: [startTime, open, high, low, close, volume, turnover]
    // Calculate buy/sell volume from candle direction
    let buyVol = 0, sellVol = 0;
    const rows = klines.slice(-12);
    const half1 = rows.slice(0, 6);
    const half2 = rows.slice(6);

    rows.forEach(k => {
      const o = +k[1], c = +k[4], v = +k[5];
      if (c >= o) buyVol  += v;
      else        sellVol += v;
    });

    const totalVol = buyVol + sellVol;
    const ratio    = totalVol > 0 ? buyVol / totalVol : 0.5;

    // Trend: first half vs second half
    let r1buy = 0, r1sell = 0, r2buy = 0, r2sell = 0;
    half1.forEach(k => { if (+k[4] >= +k[1]) r1buy += +k[5]; else r1sell += +k[5]; });
    half2.forEach(k => { if (+k[4] >= +k[1]) r2buy += +k[5]; else r2sell += +k[5]; });
    const r1 = (r1buy + r1sell) > 0 ? r1buy / (r1buy + r1sell) : 0.5;
    const r2 = (r2buy + r2sell) > 0 ? r2buy / (r2buy + r2sell) : 0.5;
    const trend = r2 - r1 > 0.04 ? 'RISING ↗' : r2 - r1 < -0.04 ? 'FALLING ↘' : 'FLAT →';

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

    if (r2 > r1 && takerScore > 0) takerScore = Math.min(25, takerScore + 4);
    if (r2 < r1 && takerScore < 0) takerScore = Math.max(-20, takerScore - 4);

    return {
      signal, score: takerScore,
      ratio: +ratio.toFixed(3), trend,
      buyPct:  +(ratio * 100).toFixed(1),
      sellPct: +((1 - ratio) * 100).toFixed(1),
      history: rows.slice(-8).map(k => ({
        buy:  +(+k[4] >= +k[1] ? +k[5] : 0).toFixed(0),
        sell: +(+k[4] < +k[1]  ? +k[5] : 0).toFixed(0),
        ts:   +k[0],
      })),
    };
  }

  // ════════════════════════════════════════════════════════════════
  // ENGINE 3: BTC CORRELATION SCANNER
  // Uses Binance spot klines (always accessible from Vercel)
  // ════════════════════════════════════════════════════════════════
  function calcCorrelation(btcKlines, coinKlines) {
    if (!btcKlines?.length || !coinKlines?.length) return null;
    const n = Math.min(btcKlines.length, coinKlines.length, 20);
    if (n < 8) return null;

    // Use % returns
    const btcRets = [], coinRets = [];
    for (let i = 1; i < n; i++) {
      // Binance spot kline format: [openTime, open, high, low, close, ...]
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

    const meanB = btcRets.reduce((s, v) => s + v, 0) / btcRets.length;
    const meanC = coinRets.reduce((s, v) => s + v, 0) / coinRets.length;
    let num = 0, denB = 0, denC = 0;
    for (let i = 0; i < btcRets.length; i++) {
      const db = btcRets[i] - meanB, dc = coinRets[i] - meanC;
      num += db * dc; denB += db * db; denC += dc * dc;
    }
    const corr = (denB > 0 && denC > 0) ? num / Math.sqrt(denB * denC) : 0;

    const recentBTC  = btcRets.slice(-4).reduce((s, v) => s + v, 0);
    const recentCoin = coinRets.slice(-4).reduce((s, v) => s + v, 0);
    const divergence = recentCoin - recentBTC;
    const beta = denB > 0 ? num / denB : 1;

    let corrSignal = 'NEUTRAL', corrScore = 0;
    if (divergence > 0.02 && corr < 0.75) {
      corrSignal = '⭐ BULLISH DIVERGENCE';  corrScore = 20;
    } else if (divergence > 0.01) {
      corrSignal = '📈 OUTPERFORMING BTC';   corrScore = 12;
    } else if (divergence < -0.02 && corr < 0.75) {
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
      divergence: +(divergence * 100).toFixed(2),
      recentBTC:  +(recentBTC  * 100).toFixed(2),
      recentCoin: +(recentCoin * 100).toFixed(2),
      signal: corrSignal, score: corrScore,
      strength: Math.abs(corr) > 0.8 ? 'STRONG' : Math.abs(corr) > 0.5 ? 'MODERATE' : 'WEAK',
    };
  }

  // ════════════════════════════════════════════════════════════════
  // COMBINED SIGNAL
  // ════════════════════════════════════════════════════════════════
  function combineEngines(liq, taker, corr, ch24) {
    let total = 40;
    const reasons = [], warnings = [];

    if (taker.score !== 0) {
      total += taker.score;
      if (taker.score >= 15)  reasons.push('Aggressive buyers dominating taker flow');
      else if (taker.score <= -15) warnings.push('Aggressive sellers — avoid long entry');
    }
    if (corr) {
      total += corr.score;
      if (corr.score >= 15)  reasons.push(`Bullish divergence +${corr.divergence}% vs BTC`);
      else if (corr.score <= -10) warnings.push('Underperforming BTC — weak relative strength');
    }
    if (liq) {
      total += liq.score;
      if (liq.score >= 15)  reasons.push('Short squeeze setup: negative funding');
      else if (liq.score <= -10) warnings.push('Long liquidation cascade risk');
    }
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

  // ════════════════════════════════════════════════════════════════
  // MAIN HANDLER
  // ════════════════════════════════════════════════════════════════
  try {
    const t0 = Date.now();

    // ── STEP 1: Spot tickers + F&G + BTC klines ──────────────────
    const [tickerR, fngR, btcSpotKlinesR] = await Promise.allSettled([
      (async () => {
        const b1 = await sf('https://api.binance.com/api/v3/ticker/24hr', 8000);
        if (Array.isArray(b1) && b1.length > 100) return b1;
        const by = await sf('https://api.bybit.com/v5/market/tickers?category=spot', 7000);
        if (by?.result?.list?.length > 50) return by.result.list.map(t => ({
          symbol: t.symbol || '', lastPrice: t.lastPrice || '0',
          priceChangePercent: t.price24hPcnt ? (parseFloat(t.price24hPcnt) * 100).toFixed(4) : '0',
          quoteVolume: t.turnover24h || '0',
        }));
        return null;
      })(),
      sf('https://api.alternative.me/fng/?limit=1&format=json', 4000),
      // BTC spot klines for correlation (always accessible)
      sf('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=15m&limit=22', 5000),
    ]);

    const allTickers = tickerR.status === 'fulfilled' && Array.isArray(tickerR.value) ? tickerR.value : [];
    const fg = fngR.status === 'fulfilled' ? parseInt(fngR.value?.data?.[0]?.value || 50) : 50;
    const btcSpotKlines = btcSpotKlinesR.status === 'fulfilled' ? btcSpotKlinesR.value : null;

    const tickerMap = {};
    allTickers.forEach(t => { if (t?.symbol) tickerMap[t.symbol] = t; });

    // ── STEP 2: Bybit batch derivatives for all symbols ───────────
    // Fetch funding rates + OI from Bybit in one call (all linear)
    const [byAllTickersR, byBTCKlinesR] = await Promise.allSettled([
      sf('https://api.bybit.com/v5/market/tickers?category=linear', 6000),
      sf('https://api.bybit.com/v5/market/kline?category=linear&symbol=BTCUSDT&interval=5&limit=12', 5000),
    ]);

    const byAllTickers = byAllTickersR.status === 'fulfilled'
      ? byAllTickersR.value?.result?.list || []
      : [];
    const byTickerMap = {};
    byAllTickers.forEach(t => {
      if (t?.symbol) byTickerMap[t.symbol] = t;
    });

    // BTC taker flow
    const btcByKlines = byBTCKlinesR.status === 'fulfilled'
      ? byBTCKlinesR.value?.result?.list || null
      : null;
    const btcTakerFlow = analyzeTakerFlow(btcByKlines);

    // Process each symbol in parallel — use Bybit data for derivatives
    const symResults = await Promise.allSettled(
      FUTURES_SYMS.slice(0, 15).map(async (sym) => {
        try {
          const ticker = tickerMap[sym + 'USDT'];
          if (!ticker) return null;
          const price = +(ticker.lastPrice || 0);
          const ch24  = +(ticker.priceChangePercent || 0);
          if (price <= 0) return null;
          const base = sym;

          // Bybit derivatives data (from batch)
          const byT = byTickerMap[sym + 'USDT'] || null;
          const fr     = byT?.fundingRate ? parseFloat(byT.fundingRate) : null;
          const oiVal  = byT?.openInterestValue ? +(parseFloat(byT.openInterestValue)).toFixed(0) : null;
          const markPx = byT?.markPrice ? parseFloat(byT.markPrice) : price;
          const mktDev = markPx > 0 ? +((price - markPx) / markPx * 100).toFixed(3) : 0;

          // Fetch coin-specific klines (spot, always accessible) + Bybit klines for taker
          const [coinKlinesR, bySymKlinesR] = await Promise.allSettled([
            sf(`https://api.binance.com/api/v3/klines?symbol=${sym}USDT&interval=15m&limit=22`, 4000),
            sym !== 'BTC'
              ? sf(`https://api.bybit.com/v5/market/kline?category=linear&symbol=${sym}USDT&interval=5&limit=12`, 4000)
              : Promise.resolve(null),
          ]);

          const coinKlines  = coinKlinesR.status === 'fulfilled' ? coinKlinesR.value : null;
          const bySymKlines = bySymKlinesR.status === 'fulfilled'
            ? (bySymKlinesR.value?.result?.list || null)
            : null;

          // Run engines
          const liq    = calcLiquidation(price, fr, oiVal);
          const flow   = analyzeTakerFlow(sym === 'BTC' ? btcByKlines : bySymKlines);
          const correl = (btcSpotKlines && coinKlines && sym !== 'BTC')
            ? calcCorrelation(btcSpotKlines, coinKlines) : null;
          const combined = combineEngines(liq, flow, correl, ch24);

          return {
            symbol: base, price, ch24: +ch24.toFixed(2),
            vol: +(ticker.quoteVolume || 0),
            markPrice: +markPx.toFixed(4), mktDev,
            fundingPct: fr !== null ? +(fr * 100).toFixed(4) : null,
            oiUSD: oiVal ? +(oiVal / 1e6).toFixed(1) + 'M' : null,
            hasFullData: !!(byT && btcSpotKlines),
            liq, flow, correl,
            score: combined.score,
            signal: combined.signal,
            reasons: combined.reasons,
            warnings: combined.warnings,
          };
        } catch { return null; }
      })
    );

    const results = symResults
      .filter(r => r.status === 'fulfilled' && r.value)
      .map(r => r.value)
      .sort((a, b) => b.score - a.score);

    // Market-wide stats
    const btcR = results.find(r => r.symbol === 'BTC');
    const btcFunding = btcR?.fundingPct || null;
    const btcMktDev  = btcR?.mktDev    || 0;

    const allRatios = results.filter(r => r.flow?.ratio).map(r => r.flow.ratio);
    const avgTakerBuy = allRatios.length
      ? +(allRatios.reduce((s, v) => s + v, 0) / allRatios.length * 100).toFixed(1)
      : 50;

    const divergent   = results.filter(r => r.correl?.score >= 15).slice(0, 5);
    const highProb    = results.filter(r => r.score >= 65).slice(0, 5);
    const squeezeSets = results.filter(r => r.liq?.signal?.includes('SQUEEZE')).slice(0, 4);

    return res.status(200).json({
      version: 'v2.0',
      timestamp: Date.now(),
      scanTime: ((Date.now() - t0) / 1000).toFixed(1),
      fg, fgLabel: fg <= 25 ? 'Extreme Fear' : fg <= 45 ? 'Fear' : fg >= 75 ? 'Greed' : 'Neutral',
      totalScanned: results.length,
      market: {
        btcFunding, btcMktDev, avgTakerBuy,
        takerSignal: avgTakerBuy > 58 ? 'NET BUY' : avgTakerBuy < 42 ? 'NET SELL' : 'BALANCED',
        btcTakerFlow,
      },
      results, highProb, divergent, squeezeSets,
    });

  } catch (e) {
    return res.status(200).json({
      version: 'v2.0', error: e.message,
      results: [], highProb: [], divergent: [], squeezeSets: [],
      timestamp: Date.now(), market: {},
    });
  }
}
