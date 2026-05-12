// api/onchain.js — AC369 FUSION BTC ONCHAIN INTELLIGENCE v2.1
// Comprehensive: BTC onchain + derivatives + market + block data
// Sources: Binance, Alternative.me, CoinGecko, mempool.space

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=30');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const sf = async (url, ms = 7000) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    try {
      const r = await fetch(url, {
        signal: ctrl.signal,
        headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json,text/plain,*/*' }
      });
      clearTimeout(timer);
      if (!r.ok) return null;
      const ct = r.headers.get('content-type') || '';
      if (ct.includes('json')) return await r.json();
      const txt = await r.text();
      try { return JSON.parse(txt); } catch { return txt; }
    } catch { clearTimeout(timer); return null; }
  };

  try {
    const t0 = Date.now();

    // ── PARALLEL FETCH ─────────────────────────────────────────────
    const [
      btcTickerR,    // BTC 24hr ticker from Binance SPOT
      fngR,          // Fear & Greed
      domR,          // BTC dominance from CoinGecko global
      premiumR,      // Funding rate + mark price
      oiR,           // Open Interest
      lsR,           // Long/Short Ratio
      lsTopR,        // Top Trader L/S (fallback)
      takerR,        // Taker buy/sell volume (for L/S proxy)
      heightR,       // Block height
      mempoolR,      // Mempool stats
      diffR,         // Difficulty adjustment
      hashR,         // Hash rate
      feesR,         // Fee recommendations
    ] = await Promise.allSettled([
      sf('https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT', 6000),
      sf('https://api.alternative.me/fng/?limit=3&format=json', 5000),
      sf('https://api.coingecko.com/api/v3/global', 7000),
      sf('https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT', 5000),
      sf('https://fapi.binance.com/fapi/v1/openInterest?symbol=BTCUSDT', 5000),
      sf('https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=BTCUSDT&period=5m&limit=1', 5000),
      sf('https://fapi.binance.com/futures/data/topLongShortPositionRatio?symbol=BTCUSDT&period=5m&limit=1', 5000),
      sf('https://fapi.binance.com/futures/data/takerbuybasevol?symbol=BTCUSDT&contractType=PERPETUAL&period=5m&limit=12', 5000),
      sf('https://mempool.space/api/blocks/tip/height', 5000),
      sf('https://mempool.space/api/mempool', 5000),
      sf('https://mempool.space/api/v1/difficulty-adjustment', 5000),
      sf('https://mempool.space/api/v1/mining/hashrate/3d', 6000),
      sf('https://mempool.space/api/v1/fees/recommended', 4000),
    ]);

    const ok  = s => s.status === 'fulfilled' && s.value != null;
    const val = s => s.status === 'fulfilled' ? s.value : null;

    const btcT   = ok(btcTickerR) ? val(btcTickerR) : null;
    const fng    = ok(fngR)       ? val(fngR)       : null;
    const domData= ok(domR)       ? val(domR)       : null;
    const prem   = ok(premiumR)   ? val(premiumR)   : null;
    const oiData = ok(oiR)        ? val(oiR)        : null;
    const ls     = ok(lsR)        ? (Array.isArray(val(lsR)) ? val(lsR)[0] : val(lsR)) : null;
    const lsTop  = ok(lsTopR)     ? (Array.isArray(val(lsTopR)) ? val(lsTopR)[0] : val(lsTopR)) : null;
    const taker  = ok(takerR)     ? val(takerR)     : null;
    const mem    = ok(mempoolR)   ? val(mempoolR)   : null;
    const diff   = ok(diffR)      ? val(diffR)      : null;
    const hash   = ok(hashR)      ? val(hashR)      : null;
    const fees   = ok(feesR)      ? val(feesR)      : null;

    // Block height (text response)
    const heightRaw = ok(heightR) ? val(heightR) : null;
    const blockH = typeof heightRaw === 'number' ? heightRaw
                 : typeof heightRaw === 'string' ? (parseInt(heightRaw) || 896000) : 896000;

    // ── BTC PRICE ──────────────────────────────────────────────────
    const btcPrice  = btcT ? +(btcT.lastPrice || 0) : 0;
    const btcChg24h = btcT ? +(btcT.priceChangePercent || 0) : 0;
    const btcHigh   = btcT ? +(btcT.highPrice || btcPrice) : btcPrice;
    const btcLow    = btcT ? +(btcT.lowPrice  || btcPrice) : btcPrice;
    const btcVol24h = btcT ? +(btcT.quoteVolume || 0) : 0;
    // Intraday price range % (volatility proxy)
    const vol24hPct = btcPrice > 0 && btcHigh > btcLow
      ? +((btcHigh - btcLow) / btcPrice * 100).toFixed(2) : 0;

    // ── FEAR & GREED ───────────────────────────────────────────────
    const fgVal   = fng?.data?.[0] ? parseInt(fng.data[0].value) : 50;
    const fgLabel = fng?.data?.[0]?.value_classification || 'Neutral';
    const fgStatus = fgVal <= 25 ? 'Extreme Fear — potential buy zone'
                   : fgVal <= 45 ? 'Fear — cautious accumulation'
                   : fgVal >= 75 ? 'Extreme Greed — consider reducing'
                   : fgVal >= 55 ? 'Greed — momentum continues' : 'Neutral';

    // ── BTC DOMINANCE ──────────────────────────────────────────────
    const btcDomPct = domData?.data?.market_cap_percentage?.btc
      ? +domData.data.market_cap_percentage.btc.toFixed(1) : 58;

    // ── FUNDING RATE ───────────────────────────────────────────────
    const fr    = prem?.lastFundingRate != null ? parseFloat(prem.lastFundingRate) : null;
    const markPx = prem?.markPrice ? +prem.markPrice : btcPrice;
    const frPct = fr != null ? +(fr * 100).toFixed(4) : null;
    const frAnn = fr != null ? +(fr * 100 * 3 * 365).toFixed(1) : null;
    const frSig = fr == null ? 'N/A'
                : fr < -0.01  ? '⚡ Short Squeeze Setup — shorts losing money'
                : fr < -0.003 ? '⚡ Negative — squeeze potential'
                : fr < 0.003  ? '⚖️ Netral'
                : fr < 0.02   ? '⚠️ Long Bias'
                : fr < 0.05   ? '⚠️ Overleveraged Longs'
                :               '🔴 Extreme Long Bias — danger';

    // ── OPEN INTEREST ──────────────────────────────────────────────
    // openInterest is in BTC contracts
    let oiVal = null, oiLabel = 'N/A';
    if (oiData?.openInterest && btcPrice > 0) {
      oiVal = +(parseFloat(oiData.openInterest) * btcPrice / 1e9).toFixed(2);
      oiLabel = oiVal > 20 ? 'HIGH — crowded market' : oiVal > 10 ? 'NORMAL' : 'LOW — accumulation phase';
    }

    // ── LONG/SHORT RATIO ───────────────────────────────────────────
    // Try global L/S first, then top trader, then derive from taker flow
    let lsRatio = null, longPct = null, shortPct = null, lsSig = 'N/A';

    if (ls?.longShortRatio) {
      lsRatio = +parseFloat(ls.longShortRatio).toFixed(3);
      // longAccount is a decimal: 0.4312 = 43.12%
      const la = parseFloat(ls.longAccount || 0);
      const sa = parseFloat(ls.shortAccount || 0);
      longPct  = la > 0 ? +(la * 100).toFixed(1) : +(lsRatio / (1 + lsRatio) * 100).toFixed(1);
      shortPct = sa > 0 ? +(sa * 100).toFixed(1) : +(100 - longPct).toFixed(1);
    } else if (lsTop?.longShortRatio) {
      // Top trader fallback
      lsRatio = +parseFloat(lsTop.longShortRatio).toFixed(3);
      const la = parseFloat(lsTop.longAccount || 0);
      longPct  = la > 0 ? +(la * 100).toFixed(1) : +(lsRatio / (1 + lsRatio) * 100).toFixed(1);
      shortPct = +(100 - longPct).toFixed(1);
    } else if (taker && Array.isArray(taker) && taker.length > 0) {
      // Derive from taker flow if L/S endpoint unavailable
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
      lsSig = lsRatio < 0.6  ? 'Short overloaded — squeeze pending ⚡'
            : lsRatio < 0.85 ? 'Slight short bias — watch for reversal'
            : lsRatio > 1.8  ? 'Long overloaded — potential dump ⚠️'
            : lsRatio > 1.2  ? 'Slight long bias — caution on longs'
            :                  'Balanced';
    }

    // ── MVRV PROXY ─────────────────────────────────────────────────
    // Real MVRV needs on-chain data. Proxy: current vs estimated realized price
    // Realized price proxy ≈ 55% of ATH (rough historical average)
    const cgMktCap = domData?.data?.total_market_cap?.btc
      ? btcPrice * 19900000 : btcPrice * 19900000;
    const realizedPxProxy = 45000; // ~historical BTC realized price estimate
    const mvrvProxy = btcPrice > 0 ? +(btcPrice / realizedPxProxy).toFixed(2) : 1.5;
    const mvrvLabel = mvrvProxy < 0.8 ? 'Undervalued — accumulate (rare)'
                    : mvrvProxy < 1.5 ? 'Fair value zone'
                    : mvrvProxy < 2.5 ? 'Overheated — caution'
                    :                   'Bubble risk zone';

    // ── NUPL & SOPR PROXIES ────────────────────────────────────────
    // NUPL proxy: how much of market cap is unrealized profit
    const nupl = +Math.min(0.95, Math.max(-0.3, (btcPrice - realizedPxProxy) / btcPrice)).toFixed(3);
    const nuplLabel = nupl < -0.1 ? 'CAPITULATION' : nupl < 0.1 ? 'HOPE'
                    : nupl < 0.3  ? 'OPTIMISM' : nupl < 0.55 ? 'BELIEF' : 'EUPHORIA';

    // SOPR proxy: today's price vs yesterday
    const sopr = +(1 + btcChg24h / 100).toFixed(3);
    const soprLabel = sopr >= 1.01 ? 'PROFIT TAKING' : sopr >= 0.99 ? 'BREAKEVEN' : 'LOSS SELLING';

    // ── BLOCK DATA ──────────────────────────────────────────────────
    const hashRate  = hash?.currentHashrate ? +(hash.currentHashrate / 1e18).toFixed(1) : null;
    const diffTxt   = diff?.difficulty ? +(diff.difficulty / 1e12).toFixed(1) : null;
    const epochPct  = diff?.progressPercent ? +diff.progressPercent.toFixed(1) : null;
    const blkRemain = diff?.remainingBlocks || null;
    const mempoolTx = mem?.count || null;
    const fastFee   = fees?.fastestFee || null;
    const HALVING   = 1050000;
    const bLeft     = Math.max(0, HALVING - blockH);
    const dLeft     = Math.round(bLeft * 10 / 60 / 24);
    const halvPct   = +Math.min(100, ((blockH - 840000) / (HALVING - 840000) * 100)).toFixed(1);

    // ── BULL/BEAR SCORING ──────────────────────────────────────────
    let bull = 0, bear = 0;
    // F&G
    if (fgVal <= 25) bull += 25; else if (fgVal <= 40) bull += 15;
    else if (fgVal >= 75) bear += 20; else if (fgVal >= 60) bear += 10;
    // Funding
    if (fr != null) {
      if (fr < -0.005) bull += 20; else if (fr < 0) bull += 10;
      else if (fr > 0.05) bear += 20; else if (fr > 0.02) bear += 10;
    }
    // L/S
    if (lsRatio != null) {
      if (lsRatio < 0.7) bull += 15; else if (lsRatio > 1.5) bear += 15;
    }
    // Price momentum
    if (btcChg24h > 3) bull += 10; else if (btcChg24h > 0) bull += 5;
    else if (btcChg24h < -3) bear += 10; else if (btcChg24h < 0) bear += 5;
    // MVRV
    if (mvrvProxy < 1.5) bull += 10; else if (mvrvProxy > 3) bear += 10;

    const total   = bull + bear;
    const bullBias = total > 0 ? Math.round(bull / total * 100) : 50;
    const overallSignal = bullBias >= 70 ? '📈 BULLISH' : bullBias >= 60 ? '🟢 MILD BULLISH'
                        : bullBias <= 30 ? '📉 BEARISH' : bullBias <= 40 ? '🔴 MILD BEARISH' : '⚖️ NEUTRAL';

    // ── WEEKLY OUTLOOK ─────────────────────────────────────────────
    const sentimentNote = fgVal <= 35
      ? `F&G ${fgVal}/100 (Fear).\nNeutral — tunggu signal lebih kuat.`
      : fgVal >= 65
      ? `F&G ${fgVal}/100 (Greed).\nHati-hati — momentum bisa berbalik.`
      : `F&G ${fgVal}/100 (Neutral).\nMarket ranging — butuh katalis baru.`;

    const derivNote = frPct != null
      ? `Funding ${frPct}% | L/S ${longPct || '—'}% / ${shortPct || '—'}%.\n${lsSig}.`
      : `Funding data unavailable.`;

    const domNote = `${btcDomPct}% — ${btcDomPct > 55 ? 'BTC season aktif.\nHold altcoins minimal.'
      : btcDomPct < 45 ? 'Alt season brewing.\nAltcoin risk/reward meningkat.'
      : 'Transisi BTC/Alt.\nSelektif pilih altcoin.'}`;

    const trendNote = `${btcChg24h >= 0 ? '+' : ''}${btcChg24h.toFixed(2)}% hari ini.\n${
      Math.abs(btcChg24h) < 1 ? 'Sideways — patience mode.'
      : btcChg24h > 3 ? 'Momentum bullish — trailing stop.'
      : btcChg24h > 0 ? 'Mild bullish — monitor resistance.'
      : btcChg24h < -3 ? 'Downtrend — risk off.'
      : 'Mild bearish — support watch.'}`;

    // ── AI PROMPT ──────────────────────────────────────────────────
    const aiPrompt = `Analisa seluruh data BTC onchain di bawah secara profesional seperti hedge fund crypto intelligence dashboard.

DATA AKTUAL:
- BTC Price: $${btcPrice.toLocaleString('en-US',{maximumFractionDigits:0})} | 24H: ${btcChg24h>=0?'+':''}${btcChg24h.toFixed(2)}% | Vol: $${(btcVol24h/1e9).toFixed(1)}B
- F&G: ${fgVal}/100 (${fgLabel})
- Funding Rate: ${frPct!=null?frPct+'%':'N/A'} | Annualized: ${frAnn!=null?frAnn+'%':'N/A'}
- L/S Ratio: ${lsRatio||'N/A'} | Long: ${longPct||'—'}% | Short: ${shortPct||'—'}%
- OI: ${oiVal!=null?'$'+oiVal+'B':'N/A'} (${oiLabel})
- MVRV Proxy: ${mvrvProxy} (${mvrvLabel})
- NUPL Proxy: ${nupl} (${nuplLabel})
- SOPR Proxy: ${sopr} (${soprLabel})
- BTC Dominance: ${btcDomPct}%
- Volatility 24H: ${vol24hPct}% range
- Hash Rate: ${hashRate||'—'} EH/s
- Bull Score: ${bull}pts | Bear Score: ${bear}pts | Bias: ${bullBias}%

Fokus: sentimen, squeeze potential, arah 24H-7D, buyer vs seller strength, continuation probability.

Berikan output:
1. Summary market
2. Smart money interpretation
3. Danger zone
4. Best scenario
5. Worst scenario
6. Trading bias
7. Scalping insight
8. Swing insight
9. Altcoin risk level
10. Final conclusion`;

    return res.status(200).json({
      timestamp: Date.now(),
      scanTime: ((Date.now()-t0)/1000).toFixed(1),
      dataOk: !!(btcT || prem || fng),
      sources: ['Binance','Alternative.me','CoinGecko','mempool.space'],
      // Price
      btcPrice, btcChg24h:+btcChg24h.toFixed(2), btcVol24h, vol24hPct,
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
      mempoolTx, fastFee,
      blocksLeft: bLeft, daysLeft: dLeft, halvingPct: halvPct,
      // Outlook
      weeklyOutlook: { sentimentNote, derivNote, domNote, trendNote },
      aiPrompt,
    });

  } catch (e) {
    return res.status(200).json({
      timestamp: Date.now(), dataOk: false, error: e.message,
      btcPrice: 0, fgVal: 50, fgLabel: 'Neutral',
      overallSignal: '⚖️ NEUTRAL', bullBias: 50, bullPts: 0, bearPts: 0,
      btcDomPct: 58, mvrvProxy: 1.5, mvrvLabel: 'Fair value zone',
      nuplProxy: 0.2, nuplLabel: 'HOPE', soprProxy: 1.0, soprLabel: 'BREAKEVEN',
      blockH: 896000, blocksLeft: 154000, daysLeft: 1069, halvingPct: 26.7,
      weeklyOutlook: {}, aiPrompt: '',
    });
  }
}
