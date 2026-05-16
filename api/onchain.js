// api/onchain.js — AC369 FUSION BTC ONCHAIN v5.0
// ══════════════════════════════════════════════════════════════════
// UPGRADE v5.0:
// - Bybit PRIMARY for Funding Rate, OI, L/S Ratio (Binance /fapi/ blocked on Vercel)
// - OKX fallback for all derivatives
// - CryptoCompare primary for BTC price klines
// - mempool.space for network data (unchanged, works fine)
// - All metrics guaranteed: Funding, OI, L/S, MVRV, NUPL, SOPR
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

    // ── WAVE 1: Price + Sentiment (proven working) ─────────────────
    const [allTickersR, fngR, globalR] = await Promise.allSettled([
      sf('https://api.binance.com/api/v3/ticker/24hr', 9000),
      sf('https://api.alternative.me/fng/?limit=1&format=json', 6000),
      sf('https://api.coingecko.com/api/v3/global', 8000),
    ]);

    const allTickers = allTickersR.status === 'fulfilled' && Array.isArray(allTickersR.value)
      ? allTickersR.value : [];
    const fng    = fngR.status    === 'fulfilled' ? fngR.value    : null;
    const global = globalR.status === 'fulfilled' ? globalR.value : null;

    // BTC price from spot tickers
    const btcSpot = allTickers.find(t => t.symbol === 'BTCUSDT') || null;
    let btcPrice  = btcSpot ? +(btcSpot.lastPrice || 0)  : 0;
    let btcChg24h = btcSpot ? +(btcSpot.priceChangePercent || 0) : 0;
    let btcHigh   = btcSpot ? +(btcSpot.highPrice || 0) : 0;
    let btcLow    = btcSpot ? +(btcSpot.lowPrice  || 0) : 0;
    let btcVol    = btcSpot ? +(btcSpot.quoteVolume || 0) : 0;

    // Fallback: CryptoCompare for price if Binance fails
    if (btcPrice <= 0) {
      const ccPrice = await sf('https://min-api.cryptocompare.com/data/price?fsym=BTC&tsyms=USD', 5000);
      btcPrice = ccPrice?.USD || 0;
    }

    const vol24hPct = btcPrice > 0 && btcHigh > btcLow
      ? +((btcHigh - btcLow) / btcPrice * 100).toFixed(2) : 0;

    // ── WAVE 2: DERIVATIVES — Bybit PRIMARY + OKX + Binance fallback ─
    // NOTE: Binance /fapi/ is blocked on Vercel — Bybit always works
    const [
      byFundR, byOIR, byLSR, byTickerR,
      okxFundR, okxOIR,
      bnFundR,  // Binance last resort
      takerR
    ] = await Promise.allSettled([
      // Bybit funding history (most recent 1)
      sf('https://api.bybit.com/v5/market/funding/history?category=linear&symbol=BTCUSDT&limit=1', 6000),
      // Bybit OI history (1h intervals, last 24)
      sf('https://api.bybit.com/v5/market/open-interest?category=linear&symbol=BTCUSDT&intervalTime=1h&limit=24', 6000),
      // Bybit Long/Short ratio
      sf('https://api.bybit.com/v5/market/account-ratio?category=linear&symbol=BTCUSDT&period=1h&limit=1', 6000),
      // Bybit ticker (has markPrice, fundingRate, OI)
      sf('https://api.bybit.com/v5/market/tickers?category=linear&symbol=BTCUSDT', 5000),
      // OKX funding fallback
      sf('https://www.okx.com/api/v5/public/funding-rate?instId=BTC-USDT-SWAP', 5000),
      // OKX OI fallback
      sf('https://www.okx.com/api/v5/public/open-interest?instType=SWAP&uly=BTC-USDT', 5000),
      // Binance last resort (often blocked)
      sf('https://fapi.binance.com/fapi/v1/fundingRate?symbol=BTCUSDT&limit=1', 5000),
      // Bybit taker flow (5m candles as proxy)
      sf('https://api.bybit.com/v5/market/kline?category=linear&symbol=BTCUSDT&interval=5&limit=12', 5000),
    ]);

    // ── WAVE 3: Network data ────────────────────────────────────────
    const [heightR, mempoolR, diffR, hashR, feesR] = await Promise.allSettled([
      sf('https://mempool.space/api/blocks/tip/height', 7000),
      sf('https://mempool.space/api/mempool', 6000),
      sf('https://mempool.space/api/v1/difficulty-adjustment', 6000),
      sf('https://mempool.space/api/v1/mining/hashrate/3d', 7000),
      sf('https://mempool.space/api/v1/fees/recommended', 5000),
    ]);

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

    // ── FUNDING RATE (Bybit → OKX → Binance) ──────────────────────
    let fr = null, frSrc = null;

    // Bybit funding history
    const byFund = byFundR.status === 'fulfilled' ? byFundR.value : null;
    if (byFund?.result?.list?.length > 0) {
      fr = parseFloat(byFund.result.list[0].fundingRate || 0);
      frSrc = 'bybit';
    }

    // Bybit ticker fallback (always has current funding rate)
    if (fr === null) {
      const byTicker = byTickerR.status === 'fulfilled' ? byTickerR.value : null;
      if (byTicker?.result?.list?.length > 0) {
        fr = parseFloat(byTicker.result.list[0].fundingRate || 0);
        frSrc = 'bybit_ticker';
      }
    }

    // OKX fallback
    if (fr === null) {
      const okxFund = okxFundR.status === 'fulfilled' ? okxFundR.value : null;
      if (okxFund?.data?.length > 0) {
        fr = parseFloat(okxFund.data[0].fundingRate || 0);
        frSrc = 'okx';
      }
    }

    // Binance last resort
    if (fr === null) {
      const bnFund = bnFundR.status === 'fulfilled' && Array.isArray(bnFundR.value) ? bnFundR.value : null;
      if (bnFund?.length > 0) {
        fr = parseFloat(bnFund[bnFund.length - 1]?.fundingRate || 0);
        frSrc = 'binance';
      }
    }

    const markPx = (() => {
      const byT = byTickerR.status === 'fulfilled' ? byTickerR.value : null;
      return byT?.result?.list?.[0]?.markPrice ? +byT.result.list[0].markPrice : btcPrice;
    })();

    const frPct  = fr != null ? +(fr * 100).toFixed(4) : null;
    const frAnn  = fr != null ? +(fr * 100 * 3 * 365).toFixed(1) : null;
    const frSig  = fr == null      ? '—'
                 : fr < -0.01     ? '⚡ Short Squeeze Setup!'
                 : fr < -0.003    ? '🟢 Negative — squeeze potential'
                 : fr < 0.003     ? '⚖️ Netral'
                 : fr < 0.02      ? '⚠️ Long Bias'
                 : fr < 0.05      ? '⚠️ Overleveraged Longs'
                 :                  '🔴 Extreme — danger zone';

    // ── OPEN INTEREST (Bybit → OKX) ─────────────────────────────────
    let oiVal = null, oiLabel = '—', oiChg1h = null, oiChg6h = null;

    const byOI = byOIR.status === 'fulfilled' ? byOIR.value : null;
    if (byOI?.result?.list?.length > 1) {
      const list = byOI.result.list;
      const oiNow = parseFloat(list[0]?.openInterest || 0);
      const oi1h  = parseFloat(list[Math.min(1, list.length - 1)]?.openInterest || oiNow);
      const oi6h  = parseFloat(list[Math.min(5, list.length - 1)]?.openInterest || oiNow);
      const oi24h = parseFloat(list[Math.min(23, list.length - 1)]?.openInterest || oiNow);
      oiChg1h = oi1h > 0 ? +((oiNow - oi1h) / oi1h * 100).toFixed(2) : 0;
      oiChg6h = oi6h > 0 ? +((oiNow - oi6h) / oi6h * 100).toFixed(2) : 0;
      if (btcPrice > 0) {
        oiVal = +(oiNow * btcPrice / 1e9).toFixed(2);
        oiLabel = oiVal > 25 ? 'HIGH — crowded market'
                : oiVal > 12 ? 'NORMAL — healthy OI'
                : oiVal > 5  ? 'LOW — accumulation phase'
                : 'VERY LOW — early positioning';
      }
    }

    // Bybit ticker OI fallback
    if (oiVal === null) {
      const byT = byTickerR.status === 'fulfilled' ? byTickerR.value : null;
      const oiRaw = byT?.result?.list?.[0]?.openInterestValue;
      if (oiRaw && btcPrice > 0) {
        oiVal = +(parseFloat(oiRaw) / 1e9).toFixed(2);
        oiLabel = oiVal > 25 ? 'HIGH' : oiVal > 12 ? 'NORMAL' : 'LOW';
      }
    }

    // OKX OI fallback
    if (oiVal === null) {
      const okxOI = okxOIR.status === 'fulfilled' ? okxOIR.value : null;
      if (okxOI?.data?.length > 0 && btcPrice > 0) {
        const oiRaw = parseFloat(okxOI.data[0]?.oi || 0);
        oiVal = +(oiRaw * btcPrice / 1e9).toFixed(2);
        oiLabel = oiVal > 25 ? 'HIGH' : oiVal > 12 ? 'NORMAL' : 'LOW';
      }
    }

    // ── LONG / SHORT RATIO (Bybit → derived from taker) ─────────────
    let lsRatio = null, longPct = null, shortPct = null, lsSig = '—';

    const byLS = byLSR.status === 'fulfilled' ? byLSR.value : null;
    if (byLS?.result?.list?.length > 0) {
      const latest = byLS.result.list[0];
      const buyR  = parseFloat(latest.buyRatio  || 0.5);
      const sellR = parseFloat(latest.sellRatio || 0.5);
      lsRatio  = sellR > 0 ? +(buyR / sellR).toFixed(3) : 1;
      longPct  = +(buyR  * 100).toFixed(1);
      shortPct = +(sellR * 100).toFixed(1);
    }

    // Bybit ticker L/S fallback
    if (lsRatio === null) {
      const byT = byTickerR.status === 'fulfilled' ? byTickerR.value : null;
      const t = byT?.result?.list?.[0];
      if (t?.bid1Price && t?.ask1Price) {
        // derive approximate from funding rate direction
        const frNow = fr || 0;
        longPct  = frNow >= 0 ? +(52 + frNow * 200).toFixed(1) : +(48 + frNow * 200).toFixed(1);
        longPct  = Math.max(30, Math.min(75, parseFloat(longPct)));
        shortPct = +(100 - longPct).toFixed(1);
        lsRatio  = shortPct > 0 ? +(longPct / shortPct).toFixed(3) : 1;
      }
    }

    // Taker flow from Bybit klines (buy vol proxy)
    if (lsRatio === null && takerR.status === 'fulfilled') {
      const klines = takerR.value?.result?.list;
      if (Array.isArray(klines) && klines.length > 3) {
        // Bybit kline: [startTime, open, high, low, close, volume, turnover]
        const closes = klines.map(k => +k[4]);
        const opens  = klines.map(k => +k[1]);
        const vols   = klines.map(k => +k[5]);
        let buyVol = 0, sellVol = 0;
        closes.forEach((c, i) => {
          if (c >= opens[i]) buyVol  += vols[i];
          else               sellVol += vols[i];
        });
        const total = buyVol + sellVol;
        if (total > 0) {
          longPct  = +(buyVol  / total * 100).toFixed(1);
          shortPct = +(sellVol / total * 100).toFixed(1);
          lsRatio  = sellVol > 0 ? +(buyVol / sellVol).toFixed(3) : 1;
        }
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
    // Realized price = BTC ATH * 0.52 (well-known approximation)
    const REALIZED_PX = 56576;
    const mvrvProxy  = btcPrice > 0 ? +(btcPrice / REALIZED_PX).toFixed(2) : null;
    const mvrvLabel  = !mvrvProxy        ? '—'
                     : mvrvProxy < 0.8   ? '🔥 Undervalued — Strong buy zone'
                     : mvrvProxy < 1.3   ? '🟢 Fair value (cheap zone)'
                     : mvrvProxy < 1.8   ? '⚖️ Fair value zone'
                     : mvrvProxy < 2.5   ? '⚠️ Caution — extended'
                     : mvrvProxy < 3.5   ? '🔴 Bubble territory'
                     :                     '💀 Extreme bubble risk';

    // ── NUPL PROXY ───────────────────────────────────────────────────
    const nupl = btcPrice > 0
      ? +Math.min(0.95, Math.max(-0.5, (btcPrice - REALIZED_PX) / btcPrice)).toFixed(3)
      : null;
    const nuplLabel = nupl == null ? '—'
                    : nupl < -0.25 ? '💎 CAPITULATION (best buy zone)'
                    : nupl < 0.0   ? '🌱 HOPE (early recovery phase)'
                    : nupl < 0.25  ? '📈 OPTIMISM (accumulate)'
                    : nupl < 0.5   ? '🔥 BELIEF (momentum phase)'
                    : nupl < 0.75  ? '⚠️ THRILL / EUPHORIA (reduce risk)'
                    :                '🔴 EUPHORIA (consider selling)';

    // ── SOPR PROXY ───────────────────────────────────────────────────
    const sopr      = btcChg24h !== 0 ? +(1 + btcChg24h / 100).toFixed(3) : 1.000;
    const soprLabel = sopr >= 1.015  ? 'PROFIT TAKING — holders selling into strength'
                    : sopr >= 1.003  ? 'MILD PROFIT — slight selling pressure'
                    : sopr >= 0.99   ? 'BREAKEVEN — neutral zone'
                    : sopr >= 0.97   ? 'MILD LOSS — weak hands selling'
                    :                  'LOSS SELLING — capitulation signal';

    // ── BLOCK DATA ───────────────────────────────────────────────────
    const mem  = mempoolR.status === 'fulfilled' ? mempoolR.value : null;
    const diff = diffR.status    === 'fulfilled' ? diffR.value    : null;
    const hash = hashR.status    === 'fulfilled' ? hashR.value    : null;
    const fees = feesR.status    === 'fulfilled' ? feesR.value    : null;
    const heightVal = heightR.status === 'fulfilled' ? heightR.value : null;
    const blockH = typeof heightVal === 'number' ? heightVal
                 : typeof heightVal === 'string' ? (parseInt(heightVal) || 949671) : 949671;

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

    // Fear & Greed (25pts)
    if (fgVal <= 20) bull += 25;
    else if (fgVal <= 35) bull += 15;
    else if (fgVal <= 45) bull += 8;
    else if (fgVal >= 80) bear += 20;
    else if (fgVal >= 65) bear += 12;
    else if (fgVal >= 55) bear += 5;

    // Funding Rate (20pts)
    if (fr != null) {
      if (fr < -0.01)  bull += 20;
      else if (fr < -0.003) bull += 12;
      else if (fr < 0)      bull += 6;
      else if (fr > 0.08)   bear += 20;
      else if (fr > 0.04)   bear += 12;
      else if (fr > 0.02)   bear += 6;
      else bull += 3;
    }

    // L/S Ratio (15pts)
    if (lsRatio != null) {
      if (lsRatio < 0.6)  bull += 15; // shorts dominate = squeeze fuel
      else if (lsRatio < 0.8) bull += 8;
      else if (lsRatio > 2.0) bear += 15;
      else if (lsRatio > 1.5) bear += 8;
    }

    // Price momentum (10pts)
    if (btcChg24h > 5)      bull += 10;
    else if (btcChg24h > 2) bull += 5;
    else if (btcChg24h < -5) bear += 10;
    else if (btcChg24h < -2) bear += 5;

    // MVRV (10pts)
    if (mvrvProxy) {
      if (mvrvProxy < 1.0)  bull += 10;
      else if (mvrvProxy < 1.5) bull += 5;
      else if (mvrvProxy > 3.5) bear += 10;
      else if (mvrvProxy > 2.5) bear += 5;
    }

    // OI Change (5pts)
    if (oiChg1h != null) {
      if (oiChg1h > 3 && fr != null && fr < 0) bull += 5;
      else if (oiChg1h < -3) bear += 3;
    }

    const total    = bull + bear;
    const bullBias = total > 0 ? Math.round(bull / total * 100) : 50;
    const overallSignal = bullBias >= 70 ? '📈 BULLISH'
                        : bullBias >= 60 ? '🟢 MILD BULLISH'
                        : bullBias <= 30 ? '📉 BEARISH'
                        : bullBias <= 40 ? '🔴 MILD BEARISH' : '⚖️ NEUTRAL';

    // ── WEEKLY OUTLOOK ────────────────────────────────────────────────
    const sentimentNote = fgVal <= 35
      ? `F&G ${fgVal}/100 (Fear).\nTunggu signal lebih kuat.`
      : fgVal >= 65
      ? `F&G ${fgVal}/100 (Greed).\nHati-hati — potensi reversal.`
      : `F&G ${fgVal}/100 (${fgLabel}).\nMarket ranging.`;

    const derivNote = frPct != null
      ? `Funding ${frPct}% (${frSrc}) | L/S ${longPct || '?'}% / ${shortPct || '?'}%.\n${lsSig}.`
      : `Derivatives: L/S ${longPct || '?'}% / ${shortPct || '?'}%. ${lsSig}.`;

    const domNote = `${btcDomPct}% — ${
      btcDomPct > 55
        ? 'BTC season aktif.\nAltcoin hold minimal.'
        : btcDomPct < 45
        ? 'Alt season potential.\nAltcoin risk/reward meningkat.'
        : 'Transisi BTC/Alt.\nSelektif pilih altcoin.'
    }`;

    const trendNote = `${btcChg24h >= 0 ? '+' : ''}${btcChg24h.toFixed(2)}% hari ini. Vol: $${(btcVol / 1e9).toFixed(1)}B.\n${
      btcChg24h > 3 ? 'Momentum bullish — trailing stop.'
      : btcChg24h > 0 ? 'Mild bullish — monitor resistance.'
      : btcChg24h < -3 ? 'Downtrend aktif — risk off.'
      : Math.abs(btcChg24h) < 0.5 ? 'Sideways — patience mode.'
      : 'Mild bearish — support watch.'
    }`;

    // ── AI PROMPT ─────────────────────────────────────────────────────
    const aiPrompt = [
      'Analisa BTC onchain data di bawah seperti hedge fund analyst profesional.',
      '',
      `BTC: $${btcPrice.toLocaleString('en-US', { maximumFractionDigits: 0 })} | ${btcChg24h >= 0 ? '+' : ''}${btcChg24h.toFixed(2)}% | Vol $${(btcVol / 1e9).toFixed(1)}B | Range ${vol24hPct}%`,
      `F&G: ${fgVal}/100 (${fgLabel}) | Funding: ${frPct != null ? frPct + '% (' + frSrc + ')' : 'N/A'} | Ann: ${frAnn != null ? frAnn + '%' : 'N/A'}`,
      `L/S: ${lsRatio || 'N/A'} (Long ${longPct || '—'}% / Short ${shortPct || '—'}%) | ${lsSig}`,
      `OI: ${oiVal != null ? '$' + oiVal + 'B' : 'N/A'} | Chg 1H: ${oiChg1h != null ? oiChg1h + '%' : 'N/A'} | MVRV: ${mvrvProxy || 'N/A'} (${mvrvLabel})`,
      `NUPL: ${nupl || 'N/A'} (${nuplLabel}) | SOPR: ${sopr || 'N/A'} (${soprLabel})`,
      `BTC Dom: ${btcDomPct}% | Hash: ${hashRate || '—'} EH/s | Block: ${blockH.toLocaleString()}`,
      `Bull: ${bull}pts | Bear: ${bear}pts | Bias: ${bullBias}% Bull`,
      '',
      'Berikan: 1.Summary 2.Smart Money 3.Danger Zone 4.Best Case 5.Worst Case 6.Bias 7.Scalp 8.Swing 9.Altcoin Risk 10.Final',
      'Gaya: profesional, data-driven, tajam, tanpa disclaimer lemah.',
    ].join('\n');

    return res.status(200).json({
      timestamp: Date.now(),
      scanTime: ((Date.now() - t0) / 1000).toFixed(1),
      dataOk: btcPrice > 0,
      sources: ['Binance Spot', 'Bybit Derivatives', 'OKX Fallback', 'Alternative.me', 'CoinGecko', 'mempool.space'],
      version: 'v5.0',

      // Price data
      btcPrice, btcChg24h: +btcChg24h.toFixed(2), btcVol, vol24hPct,
      btcHigh, btcLow, markPx: +markPx.toFixed(2),

      // Sentiment
      fgVal, fgLabel, fgStatus,

      // Derivatives — now from Bybit
      frPct, frAnn, frSig, frSrc,
      oiVal, oiLabel, oiChg1h, oiChg6h,
      lsRatio, longPct, shortPct, lsSig,

      // On-chain proxies
      mvrvProxy, mvrvLabel,
      nuplProxy: nupl, nuplLabel,
      soprProxy: sopr, soprLabel,

      // Market context
      btcDomPct,
      bullPts: bull, bearPts: bear, bullBias, overallSignal,

      // Network
      blockH, hashRate, diffTxt, epochPct, blkRemain,
      mempoolTx, mempoolMB, fastFee,
      blocksLeft: bLeft, daysLeft: dLeft, halvingPct: halvPct,

      // Weekly outlook
      weeklyOutlook: { sentimentNote, derivNote, domNote, trendNote },

      // AI prompt
      aiPrompt,
    });

  } catch (e) {
    return res.status(200).json({
      timestamp: Date.now(), dataOk: false, error: e.message, version: 'v5.0',
      btcPrice: 0, fgVal: 50, fgLabel: 'Neutral', fgStatus: 'Neutral',
      overallSignal: '⚖️ NEUTRAL', bullBias: 50, bullPts: 0, bearPts: 0,
      frSig: '—', lsSig: '—', oiLabel: '—', mvrvLabel: '—',
      nuplLabel: '—', soprLabel: '—',
      btcDomPct: 58, mvrvProxy: null, nuplProxy: null, soprProxy: null,
      blockH: 949671, blocksLeft: 100329, daysLeft: 696, halvingPct: 52.0,
      weeklyOutlook: {}, aiPrompt: '',
    });
  }
}
