// api/onchain.js — AC369 FUSION BTC ONCHAIN INTELLIGENCE v2.0
// ══════════════════════════════════════════════════════════════════
// Comprehensive BTC onchain + derivatives + market data
// Sources: Binance, Alternative.me, CoinGecko, mempool.space, blockchain.info
// ══════════════════════════════════════════════════════════════════

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=30');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const sf = async (url, ms = 7000) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
      const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } });
      clearTimeout(t); if (!r.ok) return null; return await r.json();
    } catch { clearTimeout(t); return null; }
  };
  const sfTxt = async (url, ms = 6000) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
      const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
      clearTimeout(t); if (!r.ok) return null; return await r.text();
    } catch { clearTimeout(t); return null; }
  };

  try {
    const t0 = Date.now();

    // Parallel fetch all sources
    const [
      btcTickerR, fngR, cgBtcR,
      fundingR, oiR, lsRatioR,
      heightR, mempoolR, diffR, hashR, feesR,
    ] = await Promise.allSettled([
      // BTC price + derivatives from Binance
      sf('https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT', 6000),
      // Fear & Greed
      sf('https://api.alternative.me/fng/?limit=3&format=json', 5000),
      // CoinGecko BTC market data (MVRV proxy, dominance)
      sf('https://api.coingecko.com/api/v3/coins/bitcoin?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false', 8000),
      // Binance Futures funding rate
      sf('https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT', 5000),
      // Binance Futures OI
      sf('https://fapi.binance.com/fapi/v1/openInterest?symbol=BTCUSDT', 5000),
      // Binance Futures L/S ratio
      sf('https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=BTCUSDT&period=5m&limit=1', 5000),
      // mempool.space block height
      sfTxt('https://mempool.space/api/blocks/tip/height', 5000),
      // mempool.space mempool
      sf('https://mempool.space/api/mempool', 5000),
      // mempool.space difficulty
      sf('https://mempool.space/api/v1/difficulty-adjustment', 5000),
      // mempool.space hashrate
      sf('https://mempool.space/api/v1/mining/hashrate/3d', 6000),
      // mempool.space fees
      sf('https://mempool.space/api/v1/fees/recommended', 4000),
    ]);

    // Extract data
    const btcT   = btcTickerR.status === 'fulfilled' ? btcTickerR.value : null;
    const fng    = fngR.status === 'fulfilled' ? fngR.value : null;
    const cgBtc  = cgBtcR.status === 'fulfilled' ? cgBtcR.value : null;
    const prem   = fundingR.status === 'fulfilled' ? fundingR.value : null;
    const oi     = oiR.status === 'fulfilled' ? oiR.value : null;
    const ls     = lsRatioR.status === 'fulfilled' && Array.isArray(lsRatioR.value) ? lsRatioR.value[0] : null;
    const height = heightR.status === 'fulfilled' ? parseInt(heightR.value) || null : null;
    const mem    = mempoolR.status === 'fulfilled' ? mempoolR.value : null;
    const diff   = diffR.status === 'fulfilled' ? diffR.value : null;
    const hash   = hashR.status === 'fulfilled' ? hashR.value : null;
    const fees   = feesR.status === 'fulfilled' ? feesR.value : null;

    // BTC Price data
    const btcPrice  = btcT ? +(btcT.lastPrice || 0) : (cgBtc?.market_data?.current_price?.usd || 0);
    const btcChg24h = btcT ? +(btcT.priceChangePercent || 0) : (cgBtc?.market_data?.price_change_percentage_24h || 0);
    const btcVol    = btcT ? +(btcT.quoteVolume || 0) : 0;
    const btcHigh   = btcT ? +(btcT.highPrice || btcPrice) : btcPrice;
    const btcLow    = btcT ? +(btcT.lowPrice  || btcPrice) : btcPrice;
    const vol24hPct = btcPrice > 0 ? +((btcHigh - btcLow) / btcPrice * 100).toFixed(2) : 0;

    // Fear & Greed
    const fgVal    = fng?.data?.[0] ? parseInt(fng.data[0].value) : 50;
    const fgLabel  = fng?.data?.[0]?.value_classification || 'Neutral';
    const fgStatus = fgVal <= 25 ? 'Extreme Fear — potential buy zone' : fgVal <= 45 ? 'Fear — cautious accumulation' : fgVal >= 75 ? 'Extreme Greed — consider reducing' : fgVal >= 55 ? 'Greed — momentum' : 'Neutral';

    // Funding Rate
    const fr    = prem?.lastFundingRate != null ? parseFloat(prem.lastFundingRate) : null;
    const frPct = fr != null ? +(fr * 100).toFixed(4) : null;
    const frAnn = fr != null ? +(fr * 100 * 3 * 365).toFixed(1) : null; // 3 fundings/day * 365
    const frSig = fr == null ? 'N/A' : fr < -0.005 ? '⚡ Short Squeeze Setup' : fr < 0 ? '⚖️ Netral (slight short bias)' : fr < 0.01 ? '⚖️ Netral' : fr < 0.05 ? '⚠️ Long Bias' : '🔴 Overleveraged Longs';

    // OI
    const oiVal = oi?.openInterest ? +(parseFloat(oi.openInterest) * btcPrice / 1e9).toFixed(2) : null;
    const oiLabel = oiVal ? (oiVal > 15 ? 'HIGH — crowded' : oiVal > 8 ? 'NORMAL' : 'LOW — accumulation') : 'N/A';

    // Long/Short Ratio
    const lsRatio     = ls?.longShortRatio ? +parseFloat(ls.longShortRatio).toFixed(3) : null;
    const longPct     = ls?.longAccount    ? +(parseFloat(ls.longAccount) * 100).toFixed(1) : null;
    const shortPct    = ls?.shortAccount   ? +(parseFloat(ls.shortAccount) * 100).toFixed(1) : null;
    const lsSig = lsRatio == null ? 'N/A' :
      lsRatio < 0.7 ? 'Short overloaded — squeeze pending' :
      lsRatio > 1.5 ? 'Long overloaded — potential dump' : 'Balanced';

    // MVRV proxy (from price vs realized price estimate)
    // Rough proxy: price / 200-day MA estimate from CoinGecko
    const ath = cgBtc?.market_data?.ath?.usd || btcPrice * 2;
    const mvrvProxy = btcPrice > 0 ? +(btcPrice / (ath * 0.45)).toFixed(2) : 1.5;
    const mvrvLabel = mvrvProxy < 1 ? 'Undervalued — accumulate' : mvrvProxy < 2 ? 'Fair value zone' : mvrvProxy < 3 ? 'Overheated — caution' : 'Bubble risk';

    // NUPL proxy (rough: if price > 60% of ATH → hope/optimism)
    const athPct    = ath > 0 ? btcPrice / ath : 0.5;
    const nuplProxy = +(athPct - 0.3).toFixed(3);
    const nuplLabel = nuplProxy < 0 ? 'CAPITULATION' : nuplProxy < 0.25 ? 'HOPE' : nuplProxy < 0.5 ? 'OPTIMISM' : nuplProxy < 0.75 ? 'BELIEF' : 'EUPHORIA';

    // SOPR proxy (rough daily price change signal)
    const soprProxy = +(1 + btcChg24h / 100).toFixed(3);
    const soprLabel = soprProxy >= 1.01 ? 'PROFIT TAKING' : soprProxy >= 0.99 ? 'BREAKEVEN' : 'LOSS SELLING';

    // BTC Dominance from CoinGecko
    const btcDom    = cgBtc?.market_data?.market_cap?.usd && cgBtc?.market_data?.total_supply
      ? null // calculated below
      : null;
    // Use cached from macro or fallback
    const btcDomPct = cgBtc?.market_cap_percentage?.btc || 58;

    // Block data from mempool.space
    const blockH   = height || 896000;
    const hashRate = hash?.currentHashrate ? +(hash.currentHashrate / 1e18).toFixed(1) : null;
    const diffTxt  = diff?.difficulty ? +(diff.difficulty / 1e12).toFixed(1) : null;
    const mempoolTx = mem?.count || null;
    const fastFee  = fees?.fastestFee || null;
    const HALVING  = 1050000;
    const bLeft    = Math.max(0, HALVING - blockH);
    const dLeft    = Math.round(bLeft * 10 / 60 / 24);
    const halvPct  = +Math.min(100, ((blockH - 840000) / (1050000 - 840000) * 100)).toFixed(1);

    // ── BULL / BEAR SCORING ────────────────────────────────────────
    let bullPts = 0, bearPts = 0;
    if (fgVal <= 25) bullPts += 25;
    else if (fgVal <= 40) bullPts += 15;
    else if (fgVal >= 75) bearPts += 20;
    else if (fgVal >= 60) bearPts += 10;

    if (fr != null) {
      if (fr < -0.005) bullPts += 20; // negative funding = bullish
      else if (fr < 0) bullPts += 10;
      else if (fr > 0.05) bearPts += 20;
      else if (fr > 0.02) bearPts += 10;
    }
    if (lsRatio != null) {
      if (lsRatio < 0.7) bullPts += 15;
      else if (lsRatio > 1.5) bearPts += 15;
    }
    if (btcChg24h > 3) bullPts += 10;
    else if (btcChg24h > 0) bullPts += 5;
    else if (btcChg24h < -3) bearPts += 10;
    else if (btcChg24h < 0) bearPts += 5;

    if (mvrvProxy < 1.5) bullPts += 10;
    else if (mvrvProxy > 3) bearPts += 10;

    const totalPts = bullPts + bearPts;
    const bullBias = totalPts > 0 ? Math.round(bullPts / totalPts * 100) : 50;
    const overallSignal = bullBias >= 70 ? '📈 BULLISH' : bullBias >= 55 ? '🟢 MILD BULLISH' : bullBias <= 30 ? '📉 BEARISH' : bullBias <= 45 ? '🔴 MILD BEARISH' : '⚖️ NEUTRAL';

    // ── WEEKLY OUTLOOK ─────────────────────────────────────────────
    const sentimentNote = fgVal <= 35
      ? `F&G ${fgVal}/100 (Fear).\nNeutral — tunggu signal lebih kuat.`
      : fgVal >= 65
      ? `F&G ${fgVal}/100 (Greed).\nHati-hati — momentum bisa berbalik.`
      : `F&G ${fgVal}/100 (Neutral).\nMarket ranging — butuh katalis baru.`;

    const derivNote = fr != null && lsRatio != null
      ? `Funding ${frPct}% | L/S ${longPct}% / ${shortPct}%.\n${lsSig}.`
      : `Funding ${frPct != null ? frPct + '%' : 'N/A'} — ${frSig}`;

    const domNote = `${btcDomPct.toFixed(1)}% — ${btcDomPct > 55 ? 'BTC season aktif.\nHold altcoins minimal.' : btcDomPct < 45 ? 'Alt season brewing.\nAltcoin risk/reward meningkat.' : 'Transisi BTC/Alt.\nSelektif pilih altcoin.'}`;

    const trendNote = `${btcChg24h >= 0 ? '+' : ''}${btcChg24h.toFixed(2)}% hari ini.\n${Math.abs(btcChg24h) < 1 ? 'Sideways — patience mode.' : btcChg24h > 3 ? 'Momentum bullish — trailing stop.' : btcChg24h > 0 ? 'Mild bullish — monitor resistance.' : btcChg24h < -3 ? 'Downtrend — risk off.' : 'Mild bearish — support watch.'}`;

    const aiPrompt = `Analisa seluruh data BTC onchain di bawah secara profesional seperti hedge fund crypto intelligence dashboard.

DATA AKTUAL:
- BTC Price: $${btcPrice.toLocaleString('en-US', {maximumFractionDigits: 0})} | 24H: ${btcChg24h >= 0 ? '+' : ''}${btcChg24h.toFixed(2)}%
- F&G: ${fgVal}/100 (${fgLabel})
- Funding Rate: ${frPct != null ? frPct + '%' : 'N/A'} | Ann: ${frAnn != null ? frAnn + '%' : 'N/A'}
- L/S Ratio: ${lsRatio || 'N/A'} | Long: ${longPct || '—'}% | Short: ${shortPct || '—'}%
- OI: ${oiVal != null ? '$' + oiVal + 'B' : 'N/A'} (${oiLabel})
- MVRV Proxy: ${mvrvProxy} (${mvrvLabel})
- NUPL Proxy: ${nuplProxy} (${nuplLabel})
- SOPR Proxy: ${soprProxy} (${soprLabel})
- BTC Dominance: ${btcDomPct.toFixed(1)}%
- Volatility 24H: ${vol24hPct}% range
- Bull Score: ${bullPts}pts | Bear Score: ${bearPts}pts | Bias: ${bullBias}%

Fokus: sentimen, squeeze potential, arah 24H-7D, buyer vs seller strength, continuation probability.
Format: 1.Summary 2.Smart Money 3.Danger Zone 4.Best Case 5.Worst Case 6.Bias 7.Scalp 8.Swing 9.Altcoin Risk 10.Final`;

    return res.status(200).json({
      timestamp: Date.now(),
      scanTime: ((Date.now() - t0) / 1000).toFixed(1),
      dataOk: !!(btcT || prem || fng),
      sources: ['Binance', 'Alternative.me', 'CoinGecko'],
      // Price
      btcPrice, btcChg24h: +btcChg24h.toFixed(2), btcVol, vol24hPct,
      btcHigh, btcLow,
      // Sentiment
      fgVal, fgLabel, fgStatus,
      // Derivatives
      frPct, frAnn, frSig,
      oiVal, oiLabel,
      lsRatio, longPct, shortPct, lsSig,
      // On-chain metrics
      mvrvProxy, mvrvLabel,
      nuplProxy, nuplLabel,
      soprProxy, soprLabel,
      btcDomPct: +btcDomPct.toFixed(1),
      // Scoring
      bullPts, bearPts, bullBias,
      overallSignal,
      // Block data
      blockH, hashRate, diffTxt,
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
      overallSignal: '⚖️ NEUTRAL', bullBias: 50,
      bullPts: 0, bearPts: 0, blockH: 896000,
      blocksLeft: 154000, daysLeft: 1069, halvingPct: 26.7,
      weeklyOutlook: {}, aiPrompt: '',
    });
  }
}
