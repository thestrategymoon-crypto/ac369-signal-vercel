// api/onchain.js — AC369 FUSION BTC ONCHAIN v3.0
// ══════════════════════════════════════════════════════════════════
// Comprehensive BTC Intelligence: Price + Derivatives + Metrics + Block
// Sources: Binance Spot → Bybit (price fallback)
//          fapi.binance.com (derivatives)
//          Alternative.me (F&G)
//          CoinGecko Global (dominance)
//          mempool.space (block data)
// ══════════════════════════════════════════════════════════════════

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 's-maxage=30');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const sf = async (url, ms = 8000) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    try {
      const r = await fetch(url, {
        signal: ctrl.signal,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AC369/3.0)', Accept: 'application/json' }
      });
      clearTimeout(timer);
      if (!r.ok) return null;
      return await r.json();
    } catch { clearTimeout(timer); return null; }
  };

  try {
    const t0 = Date.now();

    // ── WAVE 1: Core data (most reliable) ─────────────────────────
    const [spotR, fngR, globalR] = await Promise.allSettled([
      sf('https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT', 7000),
      sf('https://api.alternative.me/fng/?limit=1&format=json', 6000),
      sf('https://api.coingecko.com/api/v3/global', 8000),
    ]);

    const spot   = spotR.status   === 'fulfilled' ? spotR.value   : null;
    const fng    = fngR.status    === 'fulfilled' ? fngR.value    : null;
    const global = globalR.status === 'fulfilled' ? globalR.value : null;

    // BTC price from spot ticker
    let btcPrice  = spot ? +(spot.lastPrice  || 0) : 0;
    let btcChg24h = spot ? +(spot.priceChangePercent || 0) : 0;
    let btcHigh   = spot ? +(spot.highPrice  || 0) : 0;
    let btcLow    = spot ? +(spot.lowPrice   || 0) : 0;
    let btcVol    = spot ? +(spot.quoteVolume || 0) : 0;

    // Fallback: if Binance spot fails, try Bybit
    if (!btcPrice) {
      const bybit = await sf('https://api.bybit.com/v5/market/tickers?category=spot&symbol=BTCUSDT', 6000);
      const bt = bybit?.result?.list?.[0];
      if (bt) {
        btcPrice  = +(bt.lastPrice   || 0);
        btcChg24h = bt.price24hPcnt ? +(bt.price24hPcnt) * 100 : 0;
        btcHigh   = +(bt.highPrice24h || 0);
        btcLow    = +(bt.lowPrice24h  || 0);
        btcVol    = +(bt.turnover24h  || 0);
      }
    }

    const vol24hPct = btcPrice > 0 && btcHigh > btcLow
      ? +((btcHigh - btcLow) / btcPrice * 100).toFixed(2) : 0;

    // ── WAVE 2: Derivatives (fapi.binance.com) ─────────────────────
    const [premR, oiR, lsGlobalR, lsTopR, takerR] = await Promise.allSettled([
      sf('https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT', 6000),
      sf('https://fapi.binance.com/fapi/v1/openInterest?symbol=BTCUSDT', 6000),
      sf('https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=BTCUSDT&period=5m&limit=1', 6000),
      sf('https://fapi.binance.com/futures/data/topLongShortPositionRatio?symbol=BTCUSDT&period=5m&limit=1', 6000),
      sf('https://fapi.binance.com/futures/data/takerbuybasevol?symbol=BTCUSDT&contractType=PERPETUAL&period=5m&limit=12', 6000),
    ]);

    const prem    = premR.status    === 'fulfilled' ? premR.value    : null;
    const oiData  = oiR.status      === 'fulfilled' ? oiR.value      : null;
    const lsGlob  = lsGlobalR.status === 'fulfilled' ? (Array.isArray(lsGlobalR.value) ? lsGlobalR.value[0] : lsGlobalR.value) : null;
    const lsTop   = lsTopR.status   === 'fulfilled' ? (Array.isArray(lsTopR.value)  ? lsTopR.value[0]  : lsTopR.value)  : null;
    const taker   = takerR.status   === 'fulfilled' ? takerR.value   : null;

    // ── WAVE 3: Block data ──────────────────────────────────────────
    const [heightR, mempoolR, diffR, hashR, feesR] = await Promise.allSettled([
      sf('https://mempool.space/api/blocks/tip/height', 6000),
      sf('https://mempool.space/api/mempool', 6000),
      sf('https://mempool.space/api/v1/difficulty-adjustment', 6000),
      sf('https://mempool.space/api/v1/mining/hashrate/3d', 7000),
      sf('https://mempool.space/api/v1/fees/recommended', 5000),
    ]);

    const mem   = mempoolR.status === 'fulfilled' ? mempoolR.value : null;
    const diff  = diffR.status    === 'fulfilled' ? diffR.value    : null;
    const hash  = hashR.status    === 'fulfilled' ? hashR.value    : null;
    const fees  = feesR.status    === 'fulfilled' ? feesR.value    : null;

    // Block height
    const heightVal = heightR.status === 'fulfilled' ? heightR.value : null;
    const blockH = typeof heightVal === 'number' ? heightVal
                 : typeof heightVal === 'string' ? parseInt(heightVal) || 896000 : 896000;

    // ── FEAR & GREED ────────────────────────────────────────────────
    const fgVal   = fng?.data?.[0] ? parseInt(fng.data[0].value) : 50;
    const fgLabel = fng?.data?.[0]?.value_classification || 'Neutral';
    const fgStatus = fgVal <= 25 ? 'Extreme Fear — potential buy zone'
                   : fgVal <= 45 ? 'Fear — cautious accumulation'
                   : fgVal >= 75 ? 'Extreme Greed — consider reducing'
                   : fgVal >= 55 ? 'Greed — momentum continues' : 'Neutral';

    // ── BTC DOMINANCE ───────────────────────────────────────────────
    const btcDomPct = global?.data?.market_cap_percentage?.btc
      ? +global.data.market_cap_percentage.btc.toFixed(1) : 58.0;

    // ── FUNDING RATE ────────────────────────────────────────────────
    const fr    = prem?.lastFundingRate != null ? parseFloat(prem.lastFundingRate) : null;
    const markPx = prem?.markPrice ? +prem.markPrice : btcPrice;
    const frPct = fr != null ? +(fr * 100).toFixed(4) : null;
    const frAnn = fr != null ? +(fr * 100 * 3 * 365).toFixed(1) : null;
    const frSig = fr == null     ? 'Memuat...'
                : fr < -0.01    ? '⚡ Short Squeeze Setup!'
                : fr < -0.003   ? '🟢 Negative — squeeze potential'
                : fr < 0.003    ? '⚖️ Netral'
                : fr < 0.02     ? '⚠️ Long Bias'
                : fr < 0.05     ? '⚠️ Overleveraged Longs'
                :                 '🔴 Extreme — danger zone';

    // ── OPEN INTEREST ───────────────────────────────────────────────
    let oiVal = null, oiLabel = 'Memuat...';
    if (oiData?.openInterest && btcPrice > 0) {
      oiVal  = +(parseFloat(oiData.openInterest) * btcPrice / 1e9).toFixed(2);
      oiLabel = oiVal > 20 ? 'HIGH — crowded market'
              : oiVal > 10 ? 'NORMAL'
              : oiVal > 5  ? 'LOW — accumulation'
              : 'VERY LOW';
    }

    // ── LONG / SHORT RATIO ──────────────────────────────────────────
    let lsRatio = null, longPct = null, shortPct = null, lsSig = 'Memuat...';
    const lsSrc = lsGlob?.longShortRatio ? lsGlob : lsTop?.longShortRatio ? lsTop : null;

    if (lsSrc) {
      lsRatio = +parseFloat(lsSrc.longShortRatio).toFixed(3);
      const la = parseFloat(lsSrc.longAccount || 0);
      const sa = parseFloat(lsSrc.shortAccount || 0);
      if (la > 0 && la < 1) {
        longPct  = +(la * 100).toFixed(1);
        shortPct = +(sa > 0 ? sa * 100 : 100 - la * 100).toFixed(1);
      } else {
        longPct  = +(lsRatio / (1 + lsRatio) * 100).toFixed(1);
        shortPct = +(100 - longPct).toFixed(1);
      }
    } else if (Array.isArray(taker) && taker.length >= 3) {
      // Taker flow proxy
      const totalBuy  = taker.reduce((s, r) => s + parseFloat(r.buyVol  || 0), 0);
      const totalSell = taker.reduce((s, r) => s + parseFloat(r.sellVol || 0), 0);
      const total = totalBuy + totalSell;
      if (total > 0) {
        longPct  = +(totalBuy  / total * 100).toFixed(1);
        shortPct = +(totalSell / total * 100).toFixed(1);
        lsRatio  = +(totalBuy / Math.max(totalSell, 0.001)).toFixed(3);
      }
    }

    if (lsRatio != null) {
      lsSig = lsRatio < 0.65 ? 'Short overloaded — squeeze pending ⚡'
            : lsRatio < 0.9  ? 'Slight short bias'
            : lsRatio > 1.8  ? 'Long overloaded — potential dump ⚠️'
            : lsRatio > 1.2  ? 'Slight long bias — caution'
            :                  'Balanced';
    }

    // ── MVRV PROXY ──────────────────────────────────────────────────
    // BTC ATH ~$108,800. Realized price ≈ ATH × 0.50–0.55
    // At BTC ~$80K: realized ≈ $54K–60K, MVRV ≈ 1.3–1.5 (fair value)
    const btcAth      = 108800; // last known ATH
    const realizedPx  = Math.round(btcAth * 0.52); // ≈ $56,576
    const mvrvProxy   = btcPrice > 0 ? +(btcPrice / realizedPx).toFixed(2) : null;
    const mvrvLabel   = !mvrvProxy    ? 'N/A'
                      : mvrvProxy < 0.8  ? 'Undervalued — accumulate'
                      : mvrvProxy < 1.3  ? 'Fair value (cheap zone)'
                      : mvrvProxy < 1.8  ? 'Fair value zone'
                      : mvrvProxy < 2.5  ? 'Caution — extended'
                      :                    'Bubble risk';

    // ── NUPL PROXY ──────────────────────────────────────────────────
    // (marketPrice - realizedPrice) / marketPrice
    const nupl = btcPrice > 0
      ? +Math.min(0.95, Math.max(-0.5, (btcPrice - realizedPx) / btcPrice)).toFixed(3)
      : null;
    const nuplLabel = nupl == null ? 'N/A'
                    : nupl < -0.2  ? 'CAPITULATION (buy zone)'
                    : nupl < 0.0   ? 'HOPE (early recovery)'
                    : nupl < 0.25  ? 'OPTIMISM'
                    : nupl < 0.5   ? 'BELIEF'
                    : nupl < 0.75  ? 'THRILL / EUPHORIA'
                    :                'EUPHORIA (reduce)';

    // ── SOPR PROXY ──────────────────────────────────────────────────
    const sopr = btcChg24h !== 0 ? +(1 + btcChg24h / 100).toFixed(3) : 1.000;
    const soprLabel = sopr >= 1.015 ? 'PROFIT TAKING'
                    : sopr >= 1.003 ? 'MILD PROFIT'
                    : sopr >= 0.99  ? 'BREAKEVEN'
                    : sopr >= 0.97  ? 'MILD LOSS'
                    :                 'LOSS SELLING';

    // ── BLOCK DATA ──────────────────────────────────────────────────
    const hashRate  = hash?.currentHashrate ? +(hash.currentHashrate / 1e18).toFixed(1) : null;
    const diffTxt   = diff?.difficulty ? +(diff.difficulty / 1e12).toFixed(1) : null;
    const epochPct  = diff?.progressPercent ? +diff.progressPercent.toFixed(1) : null;
    const blkRemain = diff?.remainingBlocks  ? diff.remainingBlocks : null;
    const mempoolTx = mem?.count    || null;
    const mempoolMB = mem?.vsize    ? +(mem.vsize / 1e6).toFixed(1) : null;
    const fastFee   = fees?.fastestFee || null;
    const HALVING   = 1050000;
    const bLeft     = Math.max(0, HALVING - blockH);
    const dLeft     = Math.round(bLeft * 10 / 60 / 24);
    const halvPct   = +Math.min(100, ((blockH - 840000) / (HALVING - 840000) * 100)).toFixed(1);

    // ── BULL / BEAR SCORING ─────────────────────────────────────────
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
    const bullBias = total > 0 ? Math.round(bull / total * 100) : 50;
    const overallSignal = bullBias >= 70 ? '📈 BULLISH'
                        : bullBias >= 60 ? '🟢 MILD BULLISH'
                        : bullBias <= 30 ? '📉 BEARISH'
                        : bullBias <= 40 ? '🔴 MILD BEARISH' : '⚖️ NEUTRAL';

    // ── WEEKLY OUTLOOK ──────────────────────────────────────────────
    const sentimentNote = fgVal <= 35
      ? `F&G ${fgVal}/100 (Fear).\nNeutral — tunggu signal lebih kuat.`
      : fgVal >= 65
      ? `F&G ${fgVal}/100 (Greed).\nHati-hati — momentum bisa berbalik.`
      : `F&G ${fgVal}/100 (${fgLabel}).\nMarket ranging — butuh katalis baru.`;

    const derivNote = frPct != null
      ? `Funding ${frPct}% | L/S ${longPct || '?'}% / ${shortPct || '?'}%.\n${lsSig}.`
      : `Funding data: cek fapi.binance.com · L/S: ${longPct || '?'}% / ${shortPct || '?'}%.`;

    const domNote = `${btcDomPct}% — ${btcDomPct > 55 ? 'BTC season aktif.'
      : btcDomPct < 45 ? 'Alt season potential.'
      : 'Transisi BTC/Alt.'}\n${btcDomPct > 55 ? 'Altcoin hold minimal.' : btcDomPct < 45 ? 'Altcoin risk/reward meningkat.' : 'Selektif pilih altcoin.'}`;

    const trendNote = `${btcChg24h >= 0 ? '+' : ''}${btcChg24h.toFixed(2)}% hari ini.\n${
      Math.abs(btcChg24h) < 1 ? 'Sideways — patience mode.'
      : btcChg24h > 3 ? 'Momentum bullish — trailing stop.'
      : btcChg24h > 0 ? 'Mild bullish — monitor resistance.'
      : btcChg24h < -3 ? 'Downtrend aktif — risk off.'
      : 'Mild bearish — support watch.'}`;

    // ── AI PROMPT ───────────────────────────────────────────────────
    const aiPrompt = [
      'Analisa BTC onchain data di bawah seperti hedge fund crypto analyst.',
      '',
      '=== DATA AKTUAL ===',
      `BTC Price: $${btcPrice.toLocaleString('en-US',{maximumFractionDigits:0})} | 24H: ${btcChg24h>=0?'+':''}${btcChg24h.toFixed(2)}% | Vol: $${(btcVol/1e9).toFixed(1)}B`,
      `F&G: ${fgVal}/100 (${fgLabel}) | ${fgStatus}`,
      `Funding Rate: ${frPct != null ? frPct+'%' : 'N/A'} | Annualized: ${frAnn != null ? frAnn+'%' : 'N/A'}`,
      `L/S Ratio: ${lsRatio || 'N/A'} | Long: ${longPct || '—'}% | Short: ${shortPct || '—'}%`,
      `OI: ${oiVal != null ? '$'+oiVal+'B' : 'N/A'} | Volatility 24H: ${vol24hPct}%`,
      `MVRV Proxy: ${mvrvProxy || 'N/A'} (${mvrvLabel}) | NUPL: ${nupl || 'N/A'} (${nuplLabel})`,
      `SOPR: ${sopr} (${soprLabel}) | BTC Dom: ${btcDomPct}%`,
      `Hash Rate: ${hashRate || '—'} EH/s | Block: ${blockH.toLocaleString()}`,
      `Bull Score: ${bull}pts | Bear Score: ${bear}pts | Bias: ${bullBias}%`,
      '',
      '=== ANALISA REQUEST ===',
      'Berikan:',
      '1. Summary market (2-3 kalimat)',
      '2. Smart money interpretation',
      '3. Danger zone (level & kondisi)',
      '4. Best scenario (24H-7D)',
      '5. Worst scenario (24H-7D)',
      '6. Trading bias (LONG/SHORT/WAIT)',
      '7. Scalping insight',
      '8. Swing insight',
      '9. Altcoin risk level (1-10)',
      '10. Final conclusion',
      '',
      'Gaya: profesional, data-driven, tajam, tanpa disclaimer lemah.',
    ].join('\n');

    return res.status(200).json({
      timestamp: Date.now(),
      scanTime: ((Date.now() - t0) / 1000).toFixed(1),
      dataOk: !!(btcPrice && btcPrice > 0),
      sources: ['Binance', 'Alternative.me', 'CoinGecko', 'mempool.space'],
      // Price
      btcPrice, btcChg24h: +btcChg24h.toFixed(2), btcVol, vol24hPct,
      btcHigh, btcLow, markPx: +markPx.toFixed(2),
      // F&G
      fgVal, fgLabel, fgStatus,
      // Derivatives
      frPct, frAnn, frSig,
      oiVal, oiLabel,
      lsRatio, longPct, shortPct, lsSig,
      // Onchain metrics
      mvrvProxy, mvrvLabel,
      nuplProxy: nupl, nuplLabel,
      soprProxy: sopr, soprLabel,
      btcDomPct,
      // Scoring
      bullPts: bull, bearPts: bear, bullBias,
      overallSignal,
      // Block
      blockH, hashRate, diffTxt, epochPct, blkRemain,
      mempoolTx, mempoolMB, fastFee,
      blocksLeft: bLeft, daysLeft: dLeft, halvingPct: halvPct,
      // Outlook
      weeklyOutlook: { sentimentNote, derivNote, domNote, trendNote },
      aiPrompt,
    });

  } catch (e) {
    return res.status(200).json({
      timestamp: Date.now(), dataOk: false, error: e.message,
      btcPrice: 0, fgVal: 50, fgLabel: 'Neutral', fgStatus: 'Neutral',
      overallSignal: '⚖️ NEUTRAL', bullBias: 50, bullPts: 0, bearPts: 0,
      btcDomPct: 58, mvrvProxy: null, mvrvLabel: 'N/A',
      nuplProxy: null, nuplLabel: 'N/A', soprProxy: 1, soprLabel: 'BREAKEVEN',
      frSig: 'Data unavailable', lsSig: 'Data unavailable', oiLabel: 'N/A',
      blockH: 896000, blocksLeft: 154000, daysLeft: 1069, halvingPct: 26.7,
      weeklyOutlook: {}, aiPrompt: '',
    });
  }
}
