// api/onchain.js — AC369 FUSION v14
// Bybit PRIMARY for all derivatives (Binance fapi BLOCKED on Vercel)
// Target: < 12 seconds total

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=30');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const sf = async (url, ms = 6000) => {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), ms);
    try {
      const r = await fetch(url, { signal: c.signal, headers: { 'User-Agent': 'AC369/1.0', Accept: 'application/json' } });
      clearTimeout(t);
      if (!r.ok) return null;
      return await r.json();
    } catch { clearTimeout(t); return null; }
  };

  try {
    const t0 = Date.now();

    // WAVE 1: All parallel (8 sources simultaneously)
    const [spotR, fngR, globalR, byLinearR, byLSR, memR, feesR, hashR] = await Promise.allSettled([
      sf('https://api.binance.com/api/v3/ticker/24hr', 8000),
      sf('https://api.alternative.me/fng/?limit=1&format=json', 4000),
      sf('https://api.coingecko.com/api/v3/global', 5000),
      sf('https://api.bybit.com/v5/market/tickers?category=linear', 6000),
      sf('https://api.bybit.com/v5/market/account-ratio?category=linear&symbol=BTCUSDT&period=1h&limit=1', 4000),
      sf('https://mempool.space/api/mempool', 5000),
      sf('https://mempool.space/api/v1/fees/recommended', 4000),
      sf('https://mempool.space/api/v1/mining/hashrate/3d', 5000),
    ]);

    // WAVE 2: Block height (lightweight)
    const heightR = await sf('https://mempool.space/api/blocks/tip/height', 4000);

    // ── BTC PRICE ─────────────────────────────────────────────
    const allSpot = spotR.status === 'fulfilled' && Array.isArray(spotR.value) ? spotR.value : [];
    const btcSpot = allSpot.find(t => t.symbol === 'BTCUSDT');
    const byLinear = byLinearR.status === 'fulfilled' ? (byLinearR.value?.result?.list || []) : [];
    const byBTC = byLinear.find(t => t.symbol === 'BTCUSDT');

    let btcPrice = btcSpot ? +(btcSpot.lastPrice || 0) : (byBTC ? +(byBTC.lastPrice || 0) : 0);
    let btcChg24h = btcSpot ? +(btcSpot.priceChangePercent || 0) : (byBTC?.price24hPcnt ? +(parseFloat(byBTC.price24hPcnt) * 100).toFixed(2) : 0);
    let btcHigh = btcSpot ? +(btcSpot.highPrice || 0) : 0;
    let btcLow  = btcSpot ? +(btcSpot.lowPrice  || 0) : 0;
    let btcVol  = btcSpot ? +(btcSpot.quoteVolume || 0) : 0;
    const vol24hPct = btcPrice > 0 && btcHigh > btcLow ? +((btcHigh - btcLow) / btcPrice * 100).toFixed(2) : 0;

    // ── BYBIT DERIVATIVES ─────────────────────────────────────
    const byMap = {};
    byLinear.forEach(t => { if (t?.symbol) byMap[t.symbol] = t; });
    const byBTCL = byMap['BTCUSDT'];

    // Funding Rate
    const frRaw = byBTCL?.fundingRate ? parseFloat(byBTCL.fundingRate) : null;
    const frPct = frRaw !== null ? +(frRaw * 100).toFixed(4) : null;
    const frAnn = frRaw !== null ? +(frRaw * 100 * 3 * 365).toFixed(1) : null;
    const frSig = frPct === null  ? '—'
                : frPct < -0.01  ? '⚡ Short Squeeze Setup!'
                : frPct < -0.003 ? '🟢 Negative — squeeze potential'
                : frPct < 0.003  ? '⚖️ Netral'
                : frPct < 0.02   ? '⚠️ Long Bias'
                : frPct < 0.05   ? '⚠️ Overleveraged Longs'
                :                  '🔴 Extreme — danger zone';

    // Open Interest
    let oiVal = null, oiLabel = '—';
    if (byBTCL?.openInterestValue && btcPrice > 0) {
      oiVal = +(parseFloat(byBTCL.openInterestValue) / 1e9).toFixed(2);
      oiLabel = oiVal > 25 ? 'HIGH — crowded market' : oiVal > 12 ? 'NORMAL — healthy OI' : oiVal > 5 ? 'LOW — accumulation' : 'VERY LOW';
    }

    // Long/Short Ratio
    let lsRatio = null, longPct = null, shortPct = null, lsSig = '—';
    const byLS = byLSR.status === 'fulfilled' ? byLSR.value?.result?.list?.[0] : null;
    if (byLS?.buyRatio) {
      const b = parseFloat(byLS.buyRatio), s = parseFloat(byLS.sellRatio || (1 - b));
      lsRatio = s > 0 ? +(b / s).toFixed(3) : 1;
      longPct  = +(b * 100).toFixed(1);
      shortPct = +(s * 100).toFixed(1);
    } else if (frRaw !== null) {
      // Estimate from funding rate direction
      longPct  = +Math.max(35, Math.min(72, 52 + frRaw * 200)).toFixed(1);
      shortPct = +(100 - longPct).toFixed(1);
      lsRatio  = shortPct > 0 ? +(longPct / shortPct).toFixed(3) : 1;
    }
    if (lsRatio !== null) {
      lsSig = lsRatio < 0.65 ? 'Short overloaded — squeeze pending ⚡'
            : lsRatio < 0.9  ? 'Slight short bias'
            : lsRatio > 1.8  ? 'Long overloaded — potential dump ⚠️'
            : lsRatio > 1.2  ? 'Slight long bias' : 'Balanced';
    }

    // ── F&G ───────────────────────────────────────────────────
    const fng = fngR.status === 'fulfilled' ? fngR.value : null;
    const fgVal   = fng?.data?.[0] ? parseInt(fng.data[0].value) : 50;
    const fgLabel = fng?.data?.[0]?.value_classification || 'Neutral';
    const fgStatus = fgVal <= 25 ? 'Extreme Fear — potential buy zone'
                   : fgVal <= 45 ? 'Fear — cautious accumulation'
                   : fgVal >= 75 ? 'Extreme Greed — consider reducing'
                   : fgVal >= 55 ? 'Greed — momentum continues' : 'Neutral';

    // ── BTC DOMINANCE ─────────────────────────────────────────
    const global = globalR.status === 'fulfilled' ? globalR.value : null;
    const btcDomPct = global?.data?.market_cap_percentage?.btc
      ? +global.data.market_cap_percentage.btc.toFixed(1) : 58.0;

    // ── ON-CHAIN PROXIES ──────────────────────────────────────
    const REALIZED_PX = 56576;
    const mvrvProxy = btcPrice > 0 ? +(btcPrice / REALIZED_PX).toFixed(2) : null;
    const mvrvLabel = !mvrvProxy ? '—'
                    : mvrvProxy < 0.8  ? '🔥 Undervalued — Strong buy zone'
                    : mvrvProxy < 1.3  ? '🟢 Fair value (cheap zone)'
                    : mvrvProxy < 1.8  ? '⚖️ Fair value zone'
                    : mvrvProxy < 2.5  ? '⚠️ Caution — extended'
                    : mvrvProxy < 3.5  ? '🔴 Bubble territory'
                    :                   '💀 Extreme bubble risk';

    const nupl = btcPrice > 0 ? +Math.min(0.95, Math.max(-0.5, (btcPrice - REALIZED_PX) / btcPrice)).toFixed(3) : null;
    const nuplLabel = nupl === null ? '—'
                    : nupl < -0.25  ? '💎 CAPITULATION (best buy zone)'
                    : nupl < 0.0    ? '🌱 HOPE (early recovery)'
                    : nupl < 0.25   ? '📈 OPTIMISM (accumulate)'
                    : nupl < 0.5    ? '🔥 BELIEF (momentum phase)'
                    : nupl < 0.75   ? '⚠️ THRILL / EUPHORIA'
                    :                 '🔴 EUPHORIA (consider selling)';

    const sopr = btcChg24h !== 0 ? +(1 + btcChg24h / 100).toFixed(3) : 1.000;
    const soprLabel = sopr >= 1.015 ? 'PROFIT TAKING'
                    : sopr >= 1.003 ? 'MILD PROFIT'
                    : sopr >= 0.99  ? 'BREAKEVEN'
                    : sopr >= 0.97  ? 'MILD LOSS'
                    :                 'LOSS SELLING';

    // ── NETWORK ───────────────────────────────────────────────
    const mem  = memR.status  === 'fulfilled' ? memR.value  : null;
    const fees = feesR.status === 'fulfilled' ? feesR.value : null;
    const hash = hashR.status === 'fulfilled' ? hashR.value : null;
    const blockH = typeof heightR === 'number' ? heightR : typeof heightR === 'string' ? parseInt(heightR) || 949671 : 949671;
    const hashRate = hash?.currentHashrate ? +(hash.currentHashrate / 1e18).toFixed(1) : null;
    const mempoolTx = mem?.count || null;
    const fastFee   = fees?.fastestFee || null;
    const HALVING = 1050000, bLeft = Math.max(0, HALVING - blockH);
    const dLeft = Math.round(bLeft * 10 / 60 / 24);
    const halvPct = +Math.min(100, ((blockH - 840000) / (HALVING - 840000) * 100)).toFixed(1);

    // ── BULL/BEAR SCORE ───────────────────────────────────────
    let bull = 0, bear = 0;
    if      (fgVal <= 20) bull += 25; else if (fgVal <= 35) bull += 15; else if (fgVal <= 45) bull += 8;
    else if (fgVal >= 80) bear += 20; else if (fgVal >= 65) bear += 12; else if (fgVal >= 55) bear += 5;
    if (frPct !== null) {
      if      (frPct < -0.01)  bull += 20; else if (frPct < -0.003) bull += 10; else if (frPct < 0) bull += 5;
      else if (frPct > 0.08)   bear += 20; else if (frPct > 0.04)   bear += 12; else if (frPct > 0.02) bear += 5;
      else bull += 3;
    }
    if (lsRatio !== null) {
      if      (lsRatio < 0.6)  bull += 15; else if (lsRatio < 0.8) bull += 8;
      else if (lsRatio > 2.0)  bear += 15; else if (lsRatio > 1.5) bear += 8;
    }
    if (btcChg24h > 5) bull += 10; else if (btcChg24h > 2) bull += 5;
    else if (btcChg24h < -5) bear += 10; else if (btcChg24h < -2) bear += 5;
    if (mvrvProxy) {
      if (mvrvProxy < 1.0) bull += 10; else if (mvrvProxy < 1.5) bull += 5;
      else if (mvrvProxy > 3.5) bear += 10; else if (mvrvProxy > 2.5) bear += 5;
    }
    const total = bull + bear;
    const bullBias = total > 0 ? Math.round(bull / total * 100) : 50;
    const overallSignal = bullBias >= 70 ? '📈 BULLISH' : bullBias >= 60 ? '🟢 MILD BULLISH'
                        : bullBias <= 30 ? '📉 BEARISH' : bullBias <= 40 ? '🔴 MILD BEARISH' : '⚖️ NEUTRAL';

    // ── WEEKLY OUTLOOK ────────────────────────────────────────
    const sentimentNote = fgVal <= 35 ? `F&G ${fgVal}/100 (Fear).\nTunggu signal lebih kuat.`
                        : fgVal >= 65 ? `F&G ${fgVal}/100 (Greed).\nHati-hati — potensi reversal.`
                        : `F&G ${fgVal}/100 (${fgLabel}).\nMarket ranging.`;
    const derivNote = frPct !== null
      ? `Funding ${frPct}% (Bybit) | L/S ${longPct || '?'}% / ${shortPct || '?'}%.\n${lsSig}.`
      : `Derivatives: L/S ${longPct || '?'}% / ${shortPct || '?'}%. ${lsSig}.`;
    const domNote = `${btcDomPct}% — ${btcDomPct > 55 ? 'BTC season aktif.\nAltcoin hold minimal.' : btcDomPct < 45 ? 'Alt season potential.\nAltcoin risk/reward meningkat.' : 'Transisi BTC/Alt.'}`;
    const trendNote = `${btcChg24h >= 0 ? '+' : ''}${btcChg24h.toFixed(2)}% hari ini. Vol: $${(btcVol / 1e9).toFixed(1)}B.\n${Math.abs(btcChg24h) < 0.5 ? 'Sideways — patience mode.' : btcChg24h > 3 ? 'Momentum bullish — trailing stop.' : btcChg24h > 0 ? 'Mild bullish.' : btcChg24h < -3 ? 'Downtrend aktif — risk off.' : 'Mild bearish.'}`;

    const aiPrompt = `BTC: $${btcPrice.toLocaleString('en-US',{maximumFractionDigits:0})} | ${btcChg24h>=0?'+':''}${btcChg24h.toFixed(2)}% | F&G: ${fgVal} | FR: ${frPct??'N/A'}% | L/S: ${longPct||'—'}/${shortPct||'—'} | OI: ${oiVal??'N/A'}B | MVRV: ${mvrvProxy??'N/A'} | Dom: ${btcDomPct}% | Hash: ${hashRate||'—'}EH/s | Bull: ${bull}pts Bear: ${bear}pts`;

    return res.status(200).json({
      timestamp: Date.now(), scanTime: ((Date.now()-t0)/1000).toFixed(1),
      dataOk: btcPrice > 0, version: 'v14',
      sources: ['Binance Spot','Bybit Derivatives','Alternative.me','CoinGecko','mempool.space'],
      btcPrice, btcChg24h: +btcChg24h.toFixed(2), btcVol, vol24hPct, btcHigh, btcLow,
      fgVal, fgLabel, fgStatus,
      frPct, frAnn, frSig, frSrc: 'bybit',
      oiVal, oiLabel,
      lsRatio, longPct, shortPct, lsSig,
      mvrvProxy, mvrvLabel,
      nuplProxy: nupl, nuplLabel,
      soprProxy: sopr, soprLabel,
      btcDomPct,
      bullPts: bull, bearPts: bear, bullBias, overallSignal,
      blockH, hashRate, mempoolTx, fastFee,
      blocksLeft: bLeft, daysLeft: dLeft, halvingPct: halvPct,
      weeklyOutlook: { sentimentNote, derivNote, domNote, trendNote },
      aiPrompt,
    });

  } catch (e) {
    return res.status(200).json({
      timestamp: Date.now(), dataOk: false, error: e.message, version: 'v14',
      btcPrice: 0, fgVal: 50, fgLabel: 'Neutral', fgStatus: 'Neutral',
      overallSignal: '⚖️ NEUTRAL', bullBias: 50, bullPts: 0, bearPts: 0,
      frSig: '—', lsSig: '—', oiLabel: '—', mvrvLabel: '—', nuplLabel: '—', soprLabel: '—',
      btcDomPct: 58, mvrvProxy: null, nuplProxy: null, soprProxy: null,
      blockH: 949671, blocksLeft: 100329, daysLeft: 696, halvingPct: 52.0,
      weeklyOutlook: {}, aiPrompt: '',
    });
  }
}
