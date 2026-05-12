// api/onchain.js — AC369 FUSION BTC ONCHAIN v4.0
// ══════════════════════════════════════════════════════════════════
// Uses SAME endpoints as working altcoins.js + macro.js
// Key: use /api/v3/ticker/24hr (ALL tickers) not ?symbol= filter
// ══════════════════════════════════════════════════════════════════

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=30');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const sf = async (url, ms = 8000) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    try {
      const r = await fetch(url, {
        signal: ctrl.signal,
        headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' }
      });
      clearTimeout(timer);
      if (!r.ok) return null;
      return await r.json();
    } catch { clearTimeout(timer); return null; }
  };

  try {
    const t0 = Date.now();

    // ── WAVE 1: Core (proven working endpoints) ────────────────────
    const [allTickersR, fngR, globalR, btcFutR] = await Promise.allSettled([
      // ALL spot tickers (no ?symbol filter - this WORKS on Vercel)
      sf('https://api.binance.com/api/v3/ticker/24hr', 9000),
      sf('https://api.alternative.me/fng/?limit=1&format=json', 6000),
      sf('https://api.coingecko.com/api/v3/global', 8000),
      // Futures ALL tickers (also works in altcoins.js)
      sf('https://fapi.binance.com/fapi/v1/ticker/24hr', 8000),
    ]);

    const allTickers = allTickersR.status === 'fulfilled' && Array.isArray(allTickersR.value)
      ? allTickersR.value : [];
    const btcFutTickers = btcFutR.status === 'fulfilled' && Array.isArray(btcFutR.value)
      ? btcFutR.value : [];
    const fng    = fngR.status    === 'fulfilled' ? fngR.value    : null;
    const global = globalR.status === 'fulfilled' ? globalR.value : null;

    // Extract BTC from spot tickers
    const btcSpot = allTickers.find(t => t.symbol === 'BTCUSDT') || null;
    // Extract BTC from futures tickers
    const btcFut  = btcFutTickers.find(t => t.symbol === 'BTCUSDT') || null;

    let btcPrice  = btcSpot ? +(btcSpot.lastPrice || 0)  : btcFut ? +(btcFut.lastPrice || 0) : 0;
    let btcChg24h = btcSpot ? +(btcSpot.priceChangePercent || 0) : btcFut ? +(btcFut.priceChangePercent || 0) : 0;
    let btcHigh   = btcSpot ? +(btcSpot.highPrice || 0) : btcFut ? +(btcFut.highPrice || 0) : 0;
    let btcLow    = btcSpot ? +(btcSpot.lowPrice  || 0) : btcFut ? +(btcFut.lowPrice  || 0) : 0;
    let btcVol    = btcSpot ? +(btcSpot.quoteVolume || 0) : 0;

    const vol24hPct = btcPrice > 0 && btcHigh > btcLow
      ? +((btcHigh - btcLow) / btcPrice * 100).toFixed(2) : 0;

    // ── WAVE 2: Derivatives ─────────────────────────────────────────
    const [premR, fundR, oiHistR, lsR, lsTopR, takerR] = await Promise.allSettled([
      sf('https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT', 6000),
      sf('https://fapi.binance.com/fapi/v1/fundingRate?symbol=BTCUSDT&limit=1', 6000),
      sf('https://fapi.binance.com/futures/data/openInterestHist?symbol=BTCUSDT&period=1h&limit=1', 6000),
      sf('https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=BTCUSDT&period=5m&limit=1', 6000),
      sf('https://fapi.binance.com/futures/data/topLongShortPositionRatio?symbol=BTCUSDT&period=5m&limit=1', 6000),
      sf('https://fapi.binance.com/futures/data/takerbuybasevol?symbol=BTCUSDT&contractType=PERPETUAL&period=5m&limit=12', 6000),
    ]);

    const prem   = premR.status   === 'fulfilled' ? premR.value   : null;
    const fund   = fundR.status   === 'fulfilled' && Array.isArray(fundR.value) ? fundR.value[0] : null;
    const oiHist = oiHistR.status === 'fulfilled' && Array.isArray(oiHistR.value) ? oiHistR.value[0] : null;
    const lsGlob = lsR.status     === 'fulfilled' ? (Array.isArray(lsR.value)    ? lsR.value[0]    : lsR.value)    : null;
    const lsTop  = lsTopR.status  === 'fulfilled' ? (Array.isArray(lsTopR.value) ? lsTopR.value[0] : lsTopR.value) : null;
    const taker  = takerR.status  === 'fulfilled' ? takerR.value  : null;

    // ── WAVE 3: Block data ──────────────────────────────────────────
    const [heightR, mempoolR, diffR, hashR, feesR] = await Promise.allSettled([
      sf('https://mempool.space/api/blocks/tip/height', 7000),
      sf('https://mempool.space/api/mempool', 6000),
      sf('https://mempool.space/api/v1/difficulty-adjustment', 6000),
      sf('https://mempool.space/api/v1/mining/hashrate/3d', 7000),
      sf('https://mempool.space/api/v1/fees/recommended', 5000),
    ]);

    const mem  = mempoolR.status === 'fulfilled' ? mempoolR.value : null;
    const diff = diffR.status    === 'fulfilled' ? diffR.value    : null;
    const hash = hashR.status    === 'fulfilled' ? hashR.value    : null;
    const fees = feesR.status    === 'fulfilled' ? feesR.value    : null;
    const heightVal = heightR.status === 'fulfilled' ? heightR.value : null;
    const blockH = typeof heightVal === 'number' ? heightVal
                 : typeof heightVal === 'string' ? (parseInt(heightVal) || 896000) : 896000;

    // ── F&G ─────────────────────────────────────────────────────────
    const fgVal   = fng?.data?.[0] ? parseInt(fng.data[0].value) : 50;
    const fgLabel = fng?.data?.[0]?.value_classification || 'Neutral';
    const fgStatus = fgVal <= 25 ? 'Extreme Fear — potential buy zone'
                   : fgVal <= 45 ? 'Fear — cautious accumulation'
                   : fgVal >= 75 ? 'Extreme Greed — consider reducing'
                   : fgVal >= 55 ? 'Greed — momentum continues' : 'Neutral';

    // ── BTC DOMINANCE ───────────────────────────────────────────────
    const btcDomPct = global?.data?.market_cap_percentage?.btc
      ? +global.data.market_cap_percentage.btc.toFixed(1) : 58.0;

    // ── FUNDING RATE ─────────────────────────────────────────────────
    // Try premiumIndex first, then fundingRate history
    const fr = prem?.lastFundingRate != null ? parseFloat(prem.lastFundingRate)
             : fund?.fundingRate != null     ? parseFloat(fund.fundingRate)
             : null;
    const markPx = prem?.markPrice ? +prem.markPrice : btcPrice;
    const frPct  = fr != null ? +(fr * 100).toFixed(4) : null;
    const frAnn  = fr != null ? +(fr * 100 * 3 * 365).toFixed(1) : null;
    const frSig  = fr == null      ? '—'
                 : fr < -0.01     ? '⚡ Short Squeeze Setup!'
                 : fr < -0.003    ? '🟢 Negative — squeeze potential'
                 : fr < 0.003     ? '⚖️ Netral'
                 : fr < 0.02      ? '⚠️ Long Bias'
                 : fr < 0.05      ? '⚠️ Overleveraged Longs'
                 :                  '🔴 Extreme — danger zone';

    // ── OPEN INTEREST ────────────────────────────────────────────────
    let oiVal = null, oiLabel = '—';
    // Try premiumIndex OI, then OI history
    const oiRaw = prem?.openInterest || oiHist?.sumOpenInterest || null;
    if (oiRaw && btcPrice > 0) {
      oiVal  = +(parseFloat(oiRaw) * btcPrice / 1e9).toFixed(2);
      oiLabel = oiVal > 20 ? 'HIGH — crowded' : oiVal > 10 ? 'NORMAL' : oiVal > 5 ? 'LOW — accumulation' : 'VERY LOW';
    }

    // ── LONG / SHORT ─────────────────────────────────────────────────
    let lsRatio = null, longPct = null, shortPct = null, lsSig = '—';
    const lsSrc = lsGlob?.longShortRatio ? lsGlob : lsTop?.longShortRatio ? lsTop : null;

    if (lsSrc) {
      lsRatio = +parseFloat(lsSrc.longShortRatio).toFixed(3);
      const la = parseFloat(lsSrc.longAccount || 0);
      const sa = parseFloat(lsSrc.shortAccount || 0);
      longPct  = la > 0 && la < 1 ? +(la*100).toFixed(1) : +(lsRatio/(1+lsRatio)*100).toFixed(1);
      shortPct = sa > 0 && sa < 1 ? +(sa*100).toFixed(1) : +(100-longPct).toFixed(1);
    } else if (Array.isArray(taker) && taker.length >= 3) {
      const totalBuy  = taker.reduce((s,r) => s + parseFloat(r.buyVol  || 0), 0);
      const totalSell = taker.reduce((s,r) => s + parseFloat(r.sellVol || 0), 0);
      if (totalBuy + totalSell > 0) {
        longPct  = +((totalBuy  / (totalBuy+totalSell)) * 100).toFixed(1);
        shortPct = +((totalSell / (totalBuy+totalSell)) * 100).toFixed(1);
        lsRatio  = +(totalBuy / Math.max(totalSell, 0.001)).toFixed(3);
      }
    }

    if (lsRatio != null) {
      lsSig = lsRatio < 0.65 ? 'Short overloaded — squeeze pending ⚡'
            : lsRatio < 0.9  ? 'Slight short bias'
            : lsRatio > 1.8  ? 'Long overloaded — potential dump ⚠️'
            : lsRatio > 1.2  ? 'Slight long bias'
            :                  'Balanced';
    }

    // ── MVRV PROXY ───────────────────────────────────────────────────
    // Realized price estimate: ATH × 0.52 ≈ $56,576 at ATH $108,800
    const REALIZED_PX = 56576;
    const mvrvProxy  = btcPrice > 0 ? +(btcPrice / REALIZED_PX).toFixed(2) : null;
    const mvrvLabel  = !mvrvProxy   ? '—'
                     : mvrvProxy < 0.8  ? 'Undervalued — buy zone'
                     : mvrvProxy < 1.3  ? 'Fair value (cheap zone)'
                     : mvrvProxy < 1.8  ? 'Fair value zone'
                     : mvrvProxy < 2.5  ? 'Caution — extended'
                     :                    'Bubble risk';

    // ── NUPL PROXY ───────────────────────────────────────────────────
    const nupl = btcPrice > 0
      ? +Math.min(0.95, Math.max(-0.5, (btcPrice - REALIZED_PX) / btcPrice)).toFixed(3)
      : null;
    const nuplLabel = nupl == null ? '—'
                    : nupl < -0.2  ? 'CAPITULATION (buy zone)'
                    : nupl < 0.0   ? 'HOPE (early recovery)'
                    : nupl < 0.25  ? 'OPTIMISM'
                    : nupl < 0.5   ? 'BELIEF'
                    : nupl < 0.75  ? 'THRILL / EUPHORIA'
                    :                'EUPHORIA (reduce)';

    // ── SOPR PROXY ───────────────────────────────────────────────────
    const sopr      = btcChg24h !== 0 ? +(1 + btcChg24h/100).toFixed(3) : null;
    const soprLabel = sopr == null   ? 'Neutral (no price change)'
                    : sopr >= 1.015  ? 'PROFIT TAKING'
                    : sopr >= 1.003  ? 'MILD PROFIT'
                    : sopr >= 0.99   ? 'BREAKEVEN'
                    : sopr >= 0.97   ? 'MILD LOSS'
                    :                  'LOSS SELLING';

    // ── BLOCK DATA ───────────────────────────────────────────────────
    const hashRate  = hash?.currentHashrate ? +(hash.currentHashrate / 1e18).toFixed(1) : null;
    const diffTxt   = diff?.difficulty ? +(diff.difficulty / 1e12).toFixed(1) : null;
    const epochPct  = diff?.progressPercent ? +diff.progressPercent.toFixed(1) : null;
    const blkRemain = diff?.remainingBlocks || null;
    const mempoolTx = mem?.count  || null;
    const mempoolMB = mem?.vsize  ? +(mem.vsize / 1e6).toFixed(1) : null;
    const fastFee   = fees?.fastestFee || null;
    const HALVING   = 1050000;
    const bLeft     = Math.max(0, HALVING - blockH);
    const dLeft     = Math.round(bLeft * 10 / 60 / 24);
    const halvPct   = +Math.min(100, ((blockH - 840000) / (HALVING - 840000) * 100)).toFixed(1);

    // ── BULL/BEAR SCORE ──────────────────────────────────────────────
    let bull = 0, bear = 0;
    if (fgVal <= 25) bull += 25; else if (fgVal <= 40) bull += 15;
    else if (fgVal >= 75) bear += 20; else if (fgVal >= 60) bear += 10;
    if (fr != null) {
      if (fr < -0.005) bull += 20; else if (fr < 0) bull += 10;
      else if (fr > 0.05) bear += 20; else if (fr > 0.02) bear += 10;
    }
    if (lsRatio != null) {
      if (lsRatio < 0.7) bull += 15; else if (lsRatio > 1.5) bear += 15;
    }
    if (btcChg24h > 3) bull += 10; else if (btcChg24h > 0) bull += 5;
    else if (btcChg24h < -3) bear += 10; else if (btcChg24h < 0) bear += 5;
    if (mvrvProxy && mvrvProxy < 1.5) bull += 10;
    else if (mvrvProxy && mvrvProxy > 2.5) bear += 10;

    const total    = bull + bear;
    const bullBias = total > 0 ? Math.round(bull/total*100) : 50;
    const overallSignal = bullBias >= 70 ? '📈 BULLISH'
                        : bullBias >= 60 ? '🟢 MILD BULLISH'
                        : bullBias <= 30 ? '📉 BEARISH'
                        : bullBias <= 40 ? '🔴 MILD BEARISH' : '⚖️ NEUTRAL';

    // ── OUTLOOK ──────────────────────────────────────────────────────
    const sentimentNote = fgVal <= 35 ? `F&G ${fgVal}/100 (Fear).\nTunggu signal lebih kuat.`
      : fgVal >= 65 ? `F&G ${fgVal}/100 (Greed).\nHati-hati — potensi reversal.`
      : `F&G ${fgVal}/100 (${fgLabel}).\nMarket ranging.`;
    const derivNote = frPct != null
      ? `Funding ${frPct}% | L/S ${longPct||'?'}% / ${shortPct||'?'}%.\n${lsSig}.`
      : `Derivatives: L/S ${longPct||'?'}% / ${shortPct||'?'}%. ${lsSig}.`;
    const domNote = `${btcDomPct}% — ${btcDomPct > 55 ? 'BTC season aktif.\nAltcoin hold minimal.'
      : btcDomPct < 45 ? 'Alt season potential.\nAltcoin risk/reward meningkat.'
      : 'Transisi BTC/Alt.\nSelektif pilih altcoin.'}`;
    const trendNote = `${btcChg24h>=0?'+':''}${btcChg24h.toFixed(2)}% hari ini. Vol: $${(btcVol/1e9).toFixed(1)}B.\n${
      btcChg24h > 3 ? 'Momentum bullish — trailing stop.'
      : btcChg24h > 0 ? 'Mild bullish — monitor resistance.'
      : btcChg24h < -3 ? 'Downtrend aktif — risk off.'
      : Math.abs(btcChg24h) < 0.5 ? 'Sideways — patience mode.'
      : 'Mild bearish — support watch.'}`;

    // AI Prompt
    const aiPrompt = [
      'Analisa BTC onchain data di bawah seperti hedge fund analyst profesional.',
      '',
      `BTC: $${btcPrice.toLocaleString('en-US',{maximumFractionDigits:0})} | ${btcChg24h>=0?'+':''}${btcChg24h.toFixed(2)}% | Vol $${(btcVol/1e9).toFixed(1)}B | Range ${vol24hPct}%`,
      `F&G: ${fgVal}/100 (${fgLabel}) | Funding: ${frPct!=null?frPct+'%':'N/A'} | Ann: ${frAnn!=null?frAnn+'%':'N/A'}`,
      `L/S: ${lsRatio||'N/A'} (Long ${longPct||'—'}% / Short ${shortPct||'—'}%) | ${lsSig}`,
      `OI: ${oiVal!=null?'$'+oiVal+'B':'N/A'} | MVRV: ${mvrvProxy||'N/A'} (${mvrvLabel})`,
      `NUPL: ${nupl||'N/A'} (${nuplLabel}) | SOPR: ${sopr||'N/A'} (${soprLabel})`,
      `BTC Dom: ${btcDomPct}% | Hash: ${hashRate||'—'} EH/s | Block: ${blockH.toLocaleString()}`,
      `Bull: ${bull}pts | Bear: ${bear}pts | Bias: ${bullBias}% Bull`,
      '',
      'Berikan: 1.Summary 2.Smart Money 3.Danger Zone 4.Best Case 5.Worst Case 6.Bias 7.Scalp 8.Swing 9.Altcoin Risk 10.Final',
      'Gaya: profesional, data-driven, tajam, tanpa disclaimer lemah.',
    ].join('\n');

    return res.status(200).json({
      timestamp: Date.now(), scanTime: ((Date.now()-t0)/1000).toFixed(1),
      dataOk: btcPrice > 0,
      sources: ['Binance Spot', 'Binance Futures', 'Alternative.me', 'CoinGecko', 'mempool.space'],
      btcPrice, btcChg24h: +btcChg24h.toFixed(2), btcVol, vol24hPct,
      btcHigh, btcLow, markPx: +markPx.toFixed(2),
      fgVal, fgLabel, fgStatus,
      frPct, frAnn, frSig,
      oiVal, oiLabel,
      lsRatio, longPct, shortPct, lsSig,
      mvrvProxy, mvrvLabel,
      nuplProxy: nupl, nuplLabel,
      soprProxy: sopr, soprLabel,
      btcDomPct,
      bullPts: bull, bearPts: bear, bullBias, overallSignal,
      blockH, hashRate, diffTxt, epochPct, blkRemain,
      mempoolTx, mempoolMB, fastFee,
      blocksLeft: bLeft, daysLeft: dLeft, halvingPct: halvPct,
      weeklyOutlook: { sentimentNote, derivNote, domNote, trendNote },
      aiPrompt,
    });

  } catch(e) {
    return res.status(200).json({
      timestamp: Date.now(), dataOk: false, error: e.message,
      btcPrice: 0, fgVal: 50, fgLabel: 'Neutral', fgStatus: 'Neutral',
      overallSignal: '⚖️ NEUTRAL', bullBias: 50, bullPts: 0, bearPts: 0,
      frSig: '—', lsSig: '—', oiLabel: '—', mvrvLabel: '—',
      nuplLabel: '—', soprLabel: '—',
      btcDomPct: 58, mvrvProxy: null, nuplProxy: null, soprProxy: null,
      blockH: 896000, blocksLeft: 154000, daysLeft: 1069, halvingPct: 26.7,
      weeklyOutlook: {}, aiPrompt: '',
    });
  }
}
