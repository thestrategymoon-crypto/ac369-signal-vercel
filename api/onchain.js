// ============================================================
// api/onchain.js — v17 FINAL
// ⚠️  TIDAK ADA api.binance.com SAMA SEKALI DI FILE INI
// BTC Price  : CoinGecko simple/price  ← SELALU BEKERJA
// FR / OI    : Bybit single-symbol    ← SELALU BEKERJA
// L/S Ratio  : Bybit account-ratio    ← SELALU BEKERJA
// Network    : mempool.space           ← SELALU BEKERJA
// F&G        : Alternative.me         ← SELALU BEKERJA
// BTC Dom    : CoinGecko global        ← SELALU BEKERJA
// ============================================================

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=10');
  if (req.method === 'OPTIONS') return res.status(200).end();
  const t0 = Date.now();

  const sf = async (url, ms) => {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), ms);
    try {
      const r = await fetch(url, {
        signal: c.signal,
        headers: { Accept: 'application/json', 'User-Agent': 'AC369/1.0' }
      });
      clearTimeout(t);
      if (!r.ok) return null;
      return await r.json();
    } catch { clearTimeout(t); return null; }
  };

  try {
    // ── SEMUA PARALLEL — 9 sumber, 0 Binance ──────────────
    const [
      cgPriceR,   // CoinGecko: BTC + ETH price
      fngR,       // Alternative.me: Fear & Greed
      cgGlobalR,  // CoinGecko: BTC Dominance
      byBTCR,     // Bybit single BTC: FR + OI
      byETHR,     // Bybit single ETH: FR + OI
      byLSR,      // Bybit: Long/Short Ratio
      memR,       // mempool.space: pending tx
      feesR,      // mempool.space: fees
      hashR,      // mempool.space: hashrate
    ] = await Promise.allSettled([
      sf('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true&include_market_cap=true', 5000),
      sf('https://api.alternative.me/fng/?limit=1&format=json', 4000),
      sf('https://api.coingecko.com/api/v3/global', 4000),
      sf('https://api.bybit.com/v5/market/tickers?category=linear&symbol=BTCUSDT', 5000),
      sf('https://api.bybit.com/v5/market/tickers?category=linear&symbol=ETHUSDT', 4000),
      sf('https://api.bybit.com/v5/market/account-ratio?category=linear&symbol=BTCUSDT&period=1h&limit=1', 4000),
      sf('https://mempool.space/api/mempool', 5000),
      sf('https://mempool.space/api/v1/fees/recommended', 4000),
      sf('https://mempool.space/api/v1/mining/hashrate/3d', 5000),
    ]);

    // Block height — ringan, pisah agar tidak ganggu wave 1
    const blockHR = await sf('https://mempool.space/api/blocks/tip/height', 4000);

    // ── BTC / ETH PRICE dari CoinGecko ────────────────────
    const cgP     = cgPriceR.status === 'fulfilled' ? cgPriceR.value : null;
    const btcPrice  = cgP?.bitcoin?.usd                      || 0;
    const ethPrice  = cgP?.ethereum?.usd                     || 0;
    const btcChg24  = cgP?.bitcoin?.usd_24h_change   ? +(cgP.bitcoin.usd_24h_change.toFixed(2))   : 0;
    const ethChg24  = cgP?.ethereum?.usd_24h_change  ? +(cgP.ethereum.usd_24h_change.toFixed(2))  : 0;
    const btcVol    = cgP?.bitcoin?.usd_24h_vol      || 0;
    const btcMCap   = cgP?.bitcoin?.usd_market_cap   || 0;

    // ── BYBIT SINGLE SYMBOL ────────────────────────────────
    const byBTC = byBTCR.status === 'fulfilled' ? byBTCR.value?.result?.list?.[0] : null;
    const byETH = byETHR.status === 'fulfilled' ? byETHR.value?.result?.list?.[0] : null;

    // Harga dari Bybit sebagai backup jika CoinGecko gagal
    const btcFinalPrice = btcPrice > 0 ? btcPrice : (byBTC?.lastPrice ? +byBTC.lastPrice : 0);
    const ethFinalPrice = ethPrice > 0 ? ethPrice : (byETH?.lastPrice ? +byETH.lastPrice : 0);

    // 24h High/Low dari Bybit (untuk volatility range)
    const btcH24 = byBTC?.highPrice24h ? +byBTC.highPrice24h : btcFinalPrice * 1.02;
    const btcL24 = byBTC?.lowPrice24h  ? +byBTC.lowPrice24h  : btcFinalPrice * 0.98;
    const vol24hPct = btcFinalPrice > 0 && btcH24 > btcL24
      ? +((btcH24 - btcL24) / btcFinalPrice * 100).toFixed(2)
      : 0;

    // ── FUNDING RATE (Bybit BTC) ───────────────────────────
    const frRaw = byBTC?.fundingRate ? parseFloat(byBTC.fundingRate) : null;
    const frPct = frRaw !== null ? +(frRaw * 100).toFixed(4)  : null;
    const frAnn = frRaw !== null ? +(frRaw * 100 * 3 * 365).toFixed(1) : null;
    const frSig = frPct === null   ? '—'
                : frPct < -0.01   ? '⚡ Short Squeeze Setup — long wins!'
                : frPct < -0.003  ? '🟢 Negative FR — squeeze potential'
                : frPct < 0.003   ? '⚖️ Netral — no directional edge'
                : frPct < 0.02    ? '⚠️ Long Bias — elevated'
                : frPct < 0.05    ? '⚠️ Overleveraged Longs'
                :                   '🔴 EXTREME — long liquidation risk';

    // ── OPEN INTEREST (Bybit BTC) ──────────────────────────
    let oiVal = null, oiLabel = '—';
    if (byBTC?.openInterestValue) {
      oiVal   = +(parseFloat(byBTC.openInterestValue) / 1e9).toFixed(2);
      oiLabel = oiVal > 30 ? 'VERY HIGH — crowded' : oiVal > 20 ? 'HIGH — leverage' : oiVal > 10 ? 'NORMAL' : 'LOW';
    }

    // ETH FR
    const ethFrRaw = byETH?.fundingRate ? parseFloat(byETH.fundingRate) : null;
    const ethFrPct = ethFrRaw !== null ? +(ethFrRaw * 100).toFixed(4) : null;

    // ── LONG / SHORT RATIO ─────────────────────────────────
    let lsRatio = null, longPct = null, shortPct = null, lsSig = '—';
    const byLS = byLSR.status === 'fulfilled' ? byLSR.value?.result?.list?.[0] : null;
    if (byLS?.buyRatio) {
      const b = parseFloat(byLS.buyRatio), s = 1 - b;
      lsRatio  = +(b / s).toFixed(3);
      longPct  = +(b * 100).toFixed(1);
      shortPct = +(s * 100).toFixed(1);
      lsSig    = lsRatio < 0.65 ? '⚡ Short overloaded — squeeze pending'
               : lsRatio < 0.9  ? '🟢 Slight short bias — mild bullish'
               : lsRatio > 2.2  ? '🔴 Long overloaded — dump risk'
               : lsRatio > 1.5  ? '⚠️ Slight long bias' : '⚖️ Balanced';
    } else if (frRaw !== null) {
      // Estimate dari funding rate
      longPct  = +Math.max(35, Math.min(72, 52 + frRaw * 300)).toFixed(1);
      shortPct = +(100 - longPct).toFixed(1);
      lsRatio  = +(longPct / shortPct).toFixed(3);
      lsSig    = '~Estimated from FR';
    }

    // ── FEAR & GREED ───────────────────────────────────────
    const fng     = fngR.status === 'fulfilled' ? fngR.value : null;
    const fgVal   = fng?.data?.[0] ? parseInt(fng.data[0].value)                      : 50;
    const fgLabel = fng?.data?.[0]?.value_classification                               || 'Neutral';
    const fgStatus = fgVal <= 20 ? '🔥 Extreme Fear — zona beli terkuat'
                   : fgVal <= 45 ? '😨 Fear — akumulasi bertahap'
                   : fgVal >= 80 ? '🤑 Extreme Greed — distribusi smart money'
                   : fgVal >= 65 ? '😄 Greed — waspada reversal' : '😐 Neutral';

    // ── BTC DOMINANCE ──────────────────────────────────────
    const cgG       = cgGlobalR.status === 'fulfilled' ? cgGlobalR.value?.data : null;
    const btcDomPct = cgG?.market_cap_percentage?.btc
      ? +cgG.market_cap_percentage.btc.toFixed(1) : 58.0;
    const totalMC   = cgG?.total_market_cap?.usd || 0;

    // ── ONCHAIN PROXIES ────────────────────────────────────
    const REALIZED  = 56576;
    const p = btcFinalPrice;
    const mvrvProxy = p > 0 ? +(p / REALIZED).toFixed(2) : null;
    const mvrvLabel = !mvrvProxy ? '—'
                    : mvrvProxy < 0.8  ? '🔥 Extreme Undervalue — beli kuat'
                    : mvrvProxy < 1.2  ? '🟢 Fair value — cheap zone'
                    : mvrvProxy < 1.8  ? '⚖️ Fair value zone'
                    : mvrvProxy < 2.5  ? '⚠️ Extended — caution'
                    : mvrvProxy < 3.5  ? '🔴 Bubble territory'
                    :                    '💀 Extreme bubble';

    const nupl = p > 0
      ? +Math.min(0.95, Math.max(-0.5, (p - REALIZED) / p)).toFixed(3)
      : null;
    const nuplLabel = nupl === null  ? '—'
                    : nupl < -0.25  ? '💎 CAPITULATION — beli sangat kuat'
                    : nupl < 0.0    ? '🌱 HOPE — early recovery'
                    : nupl < 0.25   ? '📈 OPTIMISM — accumulate'
                    : nupl < 0.5    ? '🔥 BELIEF — momentum phase'
                    : nupl < 0.75   ? '⚠️ THRILL/EUPHORIA'
                    :                 '🔴 EUPHORIA — consider exit';

    const sopr = btcChg24 !== 0 ? +(1 + btcChg24 / 100).toFixed(3) : 1.000;
    const soprLabel = sopr >= 1.015 ? '📤 PROFIT TAKING'
                    : sopr >= 1.003 ? '↑ MILD PROFIT'
                    : sopr >= 0.990 ? '↔️ BREAKEVEN'
                    : sopr >= 0.970 ? '↓ MILD LOSS'
                    :                 '📉 LOSS SELLING — capitulation signal';

    // ── BITCOIN NETWORK ────────────────────────────────────
    const mem    = memR.status   === 'fulfilled' ? memR.value   : null;
    const fees   = feesR.status  === 'fulfilled' ? feesR.value  : null;
    const hash   = hashR.status  === 'fulfilled' ? hashR.value  : null;
    const blockH = typeof blockHR === 'number' ? blockHR
                 : typeof blockHR === 'string' ? parseInt(blockHR) : 849671;

    const hashRate   = hash?.currentHashrate ? +(hash.currentHashrate / 1e18).toFixed(1) : null;
    const hashRateT  = hashRate
      ? (hashRate > 700 ? 'ATH Zone 🔥' : hashRate > 550 ? 'Very High' : hashRate > 400 ? 'High' : 'Normal')
      : '—';
    const mempoolTx  = mem?.count  || null;
    const mempoolMB  = mem?.vsize  ? +(mem.vsize / 1e6).toFixed(1) : null;
    const fastFee    = fees?.fastestFee  || null;
    const medFee     = fees?.halfHourFee || null;
    const feeStatus  = fastFee
      ? (fastFee > 100 ? '🔴 Sangat Mahal' : fastFee > 40 ? '⚠️ Mahal' : fastFee > 15 ? '🟡 Sedang' : '🟢 Murah')
      : '—';

    const HALVING_NEXT = 1050000;
    const bLeft   = Math.max(0, HALVING_NEXT - blockH);
    const dLeft   = Math.round(bLeft * 10 / 60 / 24);
    const halvPct = +Math.min(100, Math.max(0, (blockH - 840000) / (HALVING_NEXT - 840000) * 100)).toFixed(1);

    // ── BULL/BEAR SCORING ──────────────────────────────────
    let bull = 40, bear = 40;

    // F&G score
    if      (fgVal <= 20) bull += 20;
    else if (fgVal <= 35) bull += 10;
    else if (fgVal <= 45) bull +=  5;
    else if (fgVal >= 80) bear += 20;
    else if (fgVal >= 65) bear += 10;
    else if (fgVal >= 55) bear +=  5;

    // Funding rate score
    if (frPct !== null) {
      if      (frPct < -0.01)  bull += 20;
      else if (frPct < -0.003) bull += 10;
      else if (frPct < 0)      bull +=  5;
      else if (frPct > 0.08)   bear += 20;
      else if (frPct > 0.04)   bear += 10;
      else if (frPct > 0.02)   bear +=  5;
    }

    // L/S score
    if (lsRatio !== null) {
      if      (lsRatio < 0.65) bull += 15;
      else if (lsRatio < 0.9)  bull +=  8;
      else if (lsRatio > 2.0)  bear += 15;
      else if (lsRatio > 1.5)  bear +=  8;
    }

    // Price action score
    if      (btcChg24 >  5) bull += 10;
    else if (btcChg24 >  2) bull +=  5;
    else if (btcChg24 < -5) bear += 10;
    else if (btcChg24 < -2) bear +=  5;

    // MVRV score
    if (mvrvProxy) {
      if      (mvrvProxy < 0.8) bull += 15;
      else if (mvrvProxy < 1.2) bull +=  8;
      else if (mvrvProxy > 4.0) bear += 15;
      else if (mvrvProxy > 2.5) bear +=  8;
    }

    const total     = bull + bear;
    const bullBias  = total > 0 ? Math.round(bull / total * 100) : 50;
    const overallSignal = bullBias >= 72 ? '📈 STRONG BULLISH'
                        : bullBias >= 60 ? '🟢 BULLISH'
                        : bullBias <= 28 ? '📉 STRONG BEARISH'
                        : bullBias <= 40 ? '🔴 BEARISH'
                        :                  '⚖️ NEUTRAL';

    // ── WEEKLY OUTLOOK ─────────────────────────────────────
    const wkSentiment = `F&G ${fgVal}/100 (${fgLabel}).\n${fgStatus}`;
    const wkDeriv = frPct !== null
      ? `Funding ${frPct}% per 8h (Bybit).\nL/S: ${longPct || '?'}% / ${shortPct || '?'}%.\n${lsSig}.`
      : `OI: $${oiVal || 'N/A'}B.\n${oiLabel}.`;
    const wkDom = `BTC Dom ${btcDomPct}%.\n${
      btcDomPct > 57 ? 'BTC season — altcoin minimal.' :
      btcDomPct < 45 ? 'Altseason — altcoin risk/reward tinggi.' :
      'Transisi — selektif altcoin.'
    }`;
    const wkTrend = `BTC ${btcChg24 >= 0 ? '+' : ''}${btcChg24}% (24h).\nVol: $${(btcVol / 1e9).toFixed(1)}B.\n${
      vol24hPct > 5  ? 'Volatilitas tinggi — hati-hati.' :
      Math.abs(btcChg24) < 0.5 ? 'Sideways — compression phase.' :
      btcChg24 > 2   ? 'Momentum bullish aktif.' :
      btcChg24 < -2  ? 'Tekanan jual aktif.' : 'Mild movement.'
    }`;

    // ── AI PROMPT ──────────────────────────────────────────
    const aiPrompt = [
      'Analisa data BTC onchain/derivatives berikut seperti hedge fund analyst institutional.',
      `BTC: $${btcFinalPrice.toLocaleString('en-US',{maximumFractionDigits:0})} | ${btcChg24>=0?'+':''}${btcChg24}% | Vol $${(btcVol/1e9).toFixed(1)}B`,
      `ETH: $${ethFinalPrice.toLocaleString('en-US',{maximumFractionDigits:0})} | ${ethChg24>=0?'+':''}${ethChg24}%`,
      `F&G: ${fgVal}/100 (${fgLabel}) | BTC Dom: ${btcDomPct}%`,
      `FR BTC: ${frPct??'N/A'}% per 8h | Ann: ${frAnn??'N/A'}% | ${frSig}`,
      `FR ETH: ${ethFrPct??'N/A'}% | L/S: ${lsRatio??'N/A'} (Long ${longPct??'—'}% / Short ${shortPct??'—'}%) | ${lsSig}`,
      `OI BTC: $${oiVal??'N/A'}B | ${oiLabel}`,
      `MVRV proxy: ${mvrvProxy??'N/A'} | NUPL proxy: ${nupl??'N/A'} | SOPR proxy: ${sopr}`,
      `Hash: ${hashRate??'—'} EH/s (${hashRateT}) | Block: #${blockH.toLocaleString()} | Fee: ${fastFee??'—'} sat/vB`,
      `Bull: ${bull}pts | Bear: ${bear}pts | Bias: ${bullBias}% | Signal: ${overallSignal}`,
      '',
      'Berikan: 1.Kondisi pasar saat ini 2.Key risk utama 3.Rekomendasi posisi 4.Level support/resistance kunci.',
      'Format: tajam, data-driven, Bahasa Indonesia, no disclaimer.',
    ].join('\n');

    return res.status(200).json({
      ok: true, ts: Date.now(), elapsed: Date.now() - t0, version: 'v17',
      dataOk: btcFinalPrice > 0,
      sources: ['CoinGecko', 'Bybit Single-Symbol', 'Alternative.me', 'mempool.space'],

      // Prices
      btcPrice: btcFinalPrice, btcChg24h: btcChg24, btcVol, btcMCap, btcH24, btcL24, vol24hPct,
      ethPrice: ethFinalPrice, ethChg24h: ethChg24,

      // F&G
      fgVal, fgLabel, fgStatus,

      // Derivatives (Bybit single-symbol)
      frPct, frAnn, frSig, frSrc: 'Bybit',
      ethFrPct,
      oiVal, oiLabel,
      lsRatio, longPct, shortPct, lsSig,

      // Onchain proxies
      mvrvProxy, mvrvLabel,
      nuplProxy: nupl, nuplLabel,
      soprProxy: sopr, soprLabel,

      // Macro
      btcDomPct, totalMC,

      // Network
      blockH, hashRate, hashRateT,
      mempoolTx, mempoolMB, fastFee, medFee, feeStatus,
      blocksLeft: bLeft, daysLeft: dLeft, halvingPct: halvPct,

      // Scores
      bullPts: bull, bearPts: bear, bullBias, overallSignal,

      // Outlook
      weeklyOutlook: {
        sentimentNote: wkSentiment,
        derivNote:     wkDeriv,
        domNote:       wkDom,
        trendNote:     wkTrend,
      },

      aiPrompt,
    });

  } catch (e) {
    return res.status(200).json({
      ok: false, error: e.message, ts: Date.now(), elapsed: Date.now() - t0, version: 'v17',
      dataOk: false, btcPrice: 0, ethPrice: 0,
      fgVal: 50, fgLabel: 'Neutral', fgStatus: '—',
      frPct: null, frSig: '—', oiVal: null, oiLabel: '—',
      lsRatio: null, longPct: null, shortPct: null, lsSig: '—',
      mvrvProxy: null, mvrvLabel: '—', nuplProxy: null, nuplLabel: '—',
      soprProxy: null, soprLabel: '—',
      btcDomPct: 58, blockH: 949671, hashRate: null,
      mempoolTx: null, fastFee: null, feeStatus: '—',
      blocksLeft: 100329, daysLeft: 696, halvingPct: 52,
      bullBias: 50, overallSignal: '⚖️ NEUTRAL',
      weeklyOutlook: {}, aiPrompt: '',
    });
  }
}
