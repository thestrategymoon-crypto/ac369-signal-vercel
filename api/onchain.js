// api/onchain.js — v15 REBUILT
// Bybit PRIMARY for derivatives (Binance fapi BLOCKED on Vercel)
// All 8 sources in ONE parallel wave. Max 8 seconds total.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=10');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const t0 = Date.now();

  const sf = async (url, ms) => {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), ms);
    try {
      const r = await fetch(url, { signal: c.signal, headers: { Accept: 'application/json', 'User-Agent': 'AC369/1.0' } });
      clearTimeout(t);
      if (!r.ok) return null;
      return await r.json();
    } catch { clearTimeout(t); return null; }
  };

  try {
    // ── WAVE 1: All parallel ───────────────────────────────
    const [spotR, fngR, glR, byLinR, byLSR, memR, feesR, hashR] = await Promise.allSettled([
      sf('https://api.binance.com/api/v3/ticker/24hr', 7000),           // BTC price
      sf('https://api.alternative.me/fng/?limit=1&format=json', 4000), // F&G
      sf('https://api.coingecko.com/api/v3/global', 4000),              // BTC Dom
      sf('https://api.bybit.com/v5/market/tickers?category=linear', 6000), // ALL linear (funding, OI)
      sf('https://api.bybit.com/v5/market/account-ratio?category=linear&symbol=BTCUSDT&period=1h&limit=1', 4000), // L/S ratio
      sf('https://mempool.space/api/mempool', 5000),                   // mempool
      sf('https://mempool.space/api/v1/fees/recommended', 4000),       // fees
      sf('https://mempool.space/api/v1/mining/hashrate/3d', 5000),     // hashrate
    ]);

    // ── WAVE 2: Block height (fast) ────────────────────────
    const blockHR = await sf('https://mempool.space/api/blocks/tip/height', 4000);

    // ── BTC PRICE ──────────────────────────────────────────
    const allSpot = spotR.status === 'fulfilled' && Array.isArray(spotR.value) ? spotR.value : [];
    const btcSpot = allSpot.find(t => t?.symbol === 'BTCUSDT');
    const byLinear = byLinR.status === 'fulfilled' ? byLinR.value?.result?.list || [] : [];
    const byBTC    = byLinear.find(t => t?.symbol === 'BTCUSDT');

    const btcPrice = btcSpot ? +(btcSpot.lastPrice || 0) : (byBTC ? +(byBTC.lastPrice || 0) : 0);
    const btcChg24 = btcSpot ? +(btcSpot.priceChangePercent || 0) : (byBTC?.price24hPcnt ? +(parseFloat(byBTC.price24hPcnt) * 100).toFixed(2) : 0);
    const btcHigh  = btcSpot ? +(btcSpot.highPrice  || 0) : 0;
    const btcLow   = btcSpot ? +(btcSpot.lowPrice   || 0) : 0;
    const btcVol   = btcSpot ? +(btcSpot.quoteVolume || 0) : 0;
    const vol24hPct = btcPrice > 0 && btcHigh > btcLow ? +((btcHigh - btcLow) / btcPrice * 100).toFixed(2) : 0;

    // ── BYBIT LINEAR MAP ───────────────────────────────────
    const byMap = {};
    byLinear.forEach(t => { if (t?.symbol) byMap[t.symbol] = t; });
    const byBTCL = byMap['BTCUSDT'];

    // Funding Rate (Bybit)
    const frRaw = byBTCL?.fundingRate ? parseFloat(byBTCL.fundingRate) : null;
    const frPct  = frRaw !== null ? +(frRaw * 100).toFixed(4) : null;
    const frAnn  = frRaw !== null ? +(frRaw * 100 * 3 * 365).toFixed(1) : null;
    const frSig  = frPct === null  ? '—'
                 : frPct < -0.01  ? '⚡ Short Squeeze Setup — LONGS WIN'
                 : frPct < -0.003 ? '🟢 Negative FR — squeeze potential'
                 : frPct < 0.003  ? '⚖️ Netral — no edge'
                 : frPct < 0.02   ? '⚠️ Long Bias — elevated'
                 : frPct < 0.05   ? '⚠️ Overleveraged Longs'
                 :                  '🔴 EXTREME — long liquidation risk';

    // Open Interest (Bybit)
    let oiVal = null, oiLabel = '—';
    if (byBTCL?.openInterestValue) {
      oiVal = +(parseFloat(byBTCL.openInterestValue) / 1e9).toFixed(2);
      oiLabel = oiVal > 30 ? 'VERY HIGH — crowded, caution' : oiVal > 20 ? 'HIGH — leverage present' : oiVal > 10 ? 'NORMAL — healthy' : 'LOW — early positioning';
    }

    // Long / Short Ratio (Bybit)
    let lsRatio = null, longPct = null, shortPct = null, lsSig = '—';
    const byLS = byLSR.status === 'fulfilled' ? byLSR.value?.result?.list?.[0] : null;
    if (byLS?.buyRatio) {
      const b = parseFloat(byLS.buyRatio), s = 1 - b;
      lsRatio  = s > 0 ? +(b / s).toFixed(3) : 1;
      longPct  = +(b * 100).toFixed(1);
      shortPct = +(s * 100).toFixed(1);
      lsSig    = lsRatio < 0.6  ? '⚡ Short overloaded — long squeeze pending'
               : lsRatio < 0.9  ? '🟢 Slight short bias — mild bullish'
               : lsRatio > 2.2  ? '🔴 Long overloaded — dump potential'
               : lsRatio > 1.5  ? '⚠️ Slight long bias — elevated'
               :                  '⚖️ Balanced — no edge';
    } else if (frRaw !== null) {
      // Estimate from funding direction
      longPct  = +Math.max(35, Math.min(72, 52 + frRaw * 300)).toFixed(1);
      shortPct = +(100 - longPct).toFixed(1);
      lsRatio  = +(longPct / shortPct).toFixed(3);
      lsSig    = '~Estimated from FR';
    }

    // ── F&G ────────────────────────────────────────────────
    const fng    = fngR.status === 'fulfilled' ? fngR.value : null;
    const fgVal  = fng?.data?.[0] ? parseInt(fng.data[0].value) : 50;
    const fgLabel = fng?.data?.[0]?.value_classification || 'Neutral';
    const fgStatus = fgVal <= 25 ? '🔥 Extreme Fear — buy zone terbaik'
                   : fgVal <= 45 ? '😨 Fear — akumulasi bertahap'
                   : fgVal >= 80 ? '🤑 Extreme Greed — distribusi smart money'
                   : fgVal >= 65 ? '😄 Greed — waspada koreksi'
                   :               '😐 Neutral';

    // ── BTC DOM ─────────────────────────────────────────────
    const gld       = glR.status === 'fulfilled' ? glR.value?.data : null;
    const btcDomPct = gld?.market_cap_percentage?.btc ? +gld.market_cap_percentage.btc.toFixed(1) : 58;

    // ── ONCHAIN PROXIES ─────────────────────────────────────
    const REALIZED = 56576;
    const mvrvProxy = btcPrice > 0 ? +(btcPrice / REALIZED).toFixed(2) : null;
    const mvrvLabel = !mvrvProxy ? '—'
                    : mvrvProxy < 0.8  ? '🔥 Extreme Undervalue — Beli kuat'
                    : mvrvProxy < 1.2  ? '🟢 Fair value — cheap zone'
                    : mvrvProxy < 1.8  ? '⚖️ Fair value zone'
                    : mvrvProxy < 2.5  ? '⚠️ Mulai mahal — caution'
                    : mvrvProxy < 3.5  ? '🔴 Bubble territory'
                    :                   '💀 Extreme bubble';

    const nupl = btcPrice > 0 ? +Math.min(0.95, Math.max(-0.5, (btcPrice - REALIZED) / btcPrice)).toFixed(3) : null;
    const nuplLabel = nupl === null ? '—'
                    : nupl < -0.25 ? '💎 CAPITULATION — beli sangat kuat'
                    : nupl < 0.0   ? '🌱 HOPE — early recovery'
                    : nupl < 0.25  ? '📈 OPTIMISM — accumulate'
                    : nupl < 0.5   ? '🔥 BELIEF — momentum phase'
                    : nupl < 0.75  ? '⚠️ THRILL / EUPHORIA'
                    :                '🔴 EUPHORIA — pertimbangkan exit';

    const sopr = btcChg24 !== 0 ? +(1 + btcChg24 / 100).toFixed(3) : 1.000;
    const soprLabel = sopr >= 1.015 ? '📤 PROFIT TAKING — holders jual profit'
                    : sopr >= 1.003 ? '↑ MILD PROFIT — tekanan jual ringan'
                    : sopr >= 0.990 ? '↔️ BREAKEVEN — zona netral'
                    : sopr >= 0.970 ? '↓ MILD LOSS — weak hands jual rugi'
                    :                 '📉 LOSS SELLING — capitulation signal';

    // ── NETWORK ─────────────────────────────────────────────
    const mem    = memR.status   === 'fulfilled' ? memR.value   : null;
    const fees   = feesR.status  === 'fulfilled' ? feesR.value  : null;
    const hash   = hashR.status  === 'fulfilled' ? hashR.value  : null;
    const blockH = typeof blockHR === 'number' ? blockHR : typeof blockHR === 'string' ? parseInt(blockHR) : 949671;

    const hashRate  = hash?.currentHashrate ? +(hash.currentHashrate / 1e18).toFixed(1) : null;
    const hashRateT = hash?.currentHashrate ? (hash.currentHashrate / 1e18 > 600 ? 'ATH Zone 🔥' : hash.currentHashrate / 1e18 > 500 ? 'Very High' : hash.currentHashrate / 1e18 > 400 ? 'High' : 'Normal') : '—';
    const mempoolTx = mem?.count   || null;
    const mempoolMB = mem?.vsize   ? +(mem.vsize / 1e6).toFixed(1) : null;
    const fastFee   = fees?.fastestFee   || null;
    const medFee    = fees?.halfHourFee  || null;
    const slowFee   = fees?.minimumFee   || null;
    const feeStatus = fastFee ? (fastFee > 100 ? '🔴 Sangat Mahal' : fastFee > 40 ? '⚠️ Mahal' : fastFee > 15 ? '🟡 Sedang' : '🟢 Murah') : '—';

    // Halving countdown
    const HALVING   = 1050000;
    const bLeft     = Math.max(0, HALVING - blockH);
    const dLeft     = Math.round(bLeft * 10 / 60 / 24);
    const halvPct   = +Math.min(100, Math.max(0, (blockH - 840000) / (HALVING - 840000) * 100)).toFixed(1);

    // ── BULL/BEAR SCORING ────────────────────────────────────
    let bull = 40, bear = 40; // start at 40/40

    if (fgVal <= 20) bull += 20; else if (fgVal <= 35) bull += 10; else if (fgVal <= 45) bull += 5;
    else if (fgVal >= 80) bear += 20; else if (fgVal >= 65) bear += 10; else if (fgVal >= 55) bear += 5;

    if (frPct !== null) {
      if      (frPct < -0.01)  { bull += 20; }
      else if (frPct < -0.003) { bull += 10; }
      else if (frPct < 0)      { bull +=  5; }
      else if (frPct > 0.08)   { bear += 20; }
      else if (frPct > 0.04)   { bear += 10; }
      else if (frPct > 0.02)   { bear +=  5; }
    }

    if (lsRatio !== null) {
      if      (lsRatio < 0.6)  bull += 15;
      else if (lsRatio < 0.85) bull +=  8;
      else if (lsRatio > 2.0)  bear += 15;
      else if (lsRatio > 1.5)  bear +=  8;
    }

    if (btcChg24 > 5)  bull += 10; else if (btcChg24 > 2) bull += 5;
    else if (btcChg24 < -5) bear += 10; else if (btcChg24 < -2) bear += 5;

    if (mvrvProxy) {
      if      (mvrvProxy < 0.8) bull += 15; else if (mvrvProxy < 1.2) bull += 8;
      else if (mvrvProxy > 4.0) bear += 15; else if (mvrvProxy > 2.5) bear += 8;
    }

    const total    = bull + bear;
    const bullBias = total > 0 ? Math.round(bull / total * 100) : 50;
    const overallSignal = bullBias >= 72 ? '📈 STRONG BULLISH' : bullBias >= 60 ? '🟢 BULLISH'
                        : bullBias <= 28 ? '📉 STRONG BEARISH' : bullBias <= 40 ? '🔴 BEARISH' : '⚖️ NEUTRAL';

    // ── WEEKLY OUTLOOK ───────────────────────────────────────
    const wkSentiment = `F&G ${fgVal}/100 (${fgLabel}).\n${fgStatus}`;
    const wkDeriv     = frPct !== null ? `Funding ${frPct}% per 8h (Bybit).\nL/S: ${longPct||'?'}%/${shortPct||'?'}%.\n${lsSig}.` : `OI: $${oiVal||'N/A'}B.\n${lsSig}.`;
    const wkDom       = `BTC Dom ${btcDomPct}%.\n${btcDomPct > 57 ? 'BTC season — altcoin minimal.' : btcDomPct < 45 ? 'Altseason — altcoin risk/reward tinggi.' : 'Transisi — selektif altcoin.'}`;
    const wkTrend     = `BTC ${btcChg24 >= 0 ? '+' : ''}${btcChg24.toFixed(2)}% (24h).\nVol: $${(btcVol / 1e9).toFixed(1)}B.\n${vol24hPct > 5 ? 'Volatilitas tinggi — hati-hati.' : Math.abs(btcChg24) < 0.5 ? 'Sideways — compression phase.' : btcChg24 > 2 ? 'Momentum bullish.' : btcChg24 < -2 ? 'Tekanan jual aktif.' : 'Mild movement.'}`;

    // ── AI PROMPT ────────────────────────────────────────────
    const aiPrompt = [
      'Analisa data BTC onchain/derivatives berikut seperti hedge fund analyst top.',
      `BTC: $${btcPrice.toLocaleString('en-US',{maximumFractionDigits:0})} | ${btcChg24>=0?'+':''}${btcChg24.toFixed(2)}% | Vol $${(btcVol/1e9).toFixed(1)}B`,
      `F&G: ${fgVal}/100 (${fgLabel}) | Funding: ${frPct??'N/A'}% per 8h | Ann: ${frAnn??'N/A'}%`,
      `L/S: ${lsRatio??'N/A'} | Long: ${longPct??'—'}% | Short: ${shortPct??'—'}% | ${lsSig}`,
      `OI: $${oiVal??'N/A'}B | BTC Dom: ${btcDomPct}%`,
      `MVRV proxy: ${mvrvProxy??'N/A'} (${mvrvLabel})`,
      `NUPL proxy: ${nupl??'N/A'} (${nuplLabel})`,
      `Block: ${blockH.toLocaleString()} | Hash: ${hashRate??'—'} EH/s | Mempool: ${mempoolTx?.toLocaleString()??'—'} tx`,
      `Bull score: ${bull} | Bear score: ${bear} | Bias: ${bullBias}% Bull`,
      `Overall: ${overallSignal}`,
      '',
      'Berikan analisis singkat: 1.Kondisi pasar saat ini 2.Key risk 3.Rekomendasi posisi 4.Level watch',
      'Gaya: data-driven, tajam, no disclaimer. Bahasa Indonesia.',
    ].join('\n');

    return res.status(200).json({
      ok: true, ts: Date.now(), elapsed: Date.now() - t0, version: 'v15',
      sources: ['Binance Spot', 'Bybit Linear', 'Alternative.me', 'CoinGecko', 'mempool.space'],
      btcPrice, btcChg24h: +btcChg24.toFixed(2), btcVol, btcHigh, btcLow, vol24hPct,
      fgVal, fgLabel, fgStatus,
      frPct, frAnn, frSig, frSrc: 'Bybit',
      oiVal, oiLabel,
      lsRatio, longPct, shortPct, lsSig,
      mvrvProxy, mvrvLabel,
      nuplProxy: nupl, nuplLabel,
      soprProxy: sopr, soprLabel,
      btcDomPct,
      blockH, hashRate, hashRateT,
      mempoolTx, mempoolMB, fastFee, medFee, slowFee, feeStatus,
      blocksLeft: bLeft, daysLeft: dLeft, halvingPct: halvPct,
      bullPts: bull, bearPts: bear, bullBias, overallSignal,
      weeklyOutlook: { sentimentNote: wkSentiment, derivNote: wkDeriv, domNote: wkDom, trendNote: wkTrend },
      aiPrompt,
      dataOk: btcPrice > 0,
    });

  } catch (e) {
    return res.status(200).json({
      ok: false, error: e.message, ts: Date.now(), version: 'v15',
      btcPrice: 0, fgVal: 50, fgLabel: 'Neutral', fgStatus: '—',
      frPct: null, frSig: '—', oiVal: null, oiLabel: '—',
      lsRatio: null, longPct: null, shortPct: null, lsSig: '—',
      mvrvProxy: null, mvrvLabel: '—', nuplProxy: null, nuplLabel: '—', soprProxy: null, soprLabel: '—',
      btcDomPct: 58, blockH: 949671, hashRate: null, mempoolTx: null, fastFee: null,
      blocksLeft: 100329, daysLeft: 696, halvingPct: 52,
      bullBias: 50, overallSignal: '⚖️ NEUTRAL',
      weeklyOutlook: {}, aiPrompt: '', dataOk: false,
    });
  }
}
