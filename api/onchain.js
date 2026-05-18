// api/onchain.js — v16 FIX
// ROOT CAUSE FIX: Single-symbol queries only (no all-tickers)
// Before: /ticker/24hr (2MB response) → NOW: /ticker/24hr?symbol=BTCUSDT (tiny)
// Before: Bybit ?category=linear (500 symbols) → NOW: &symbol=BTCUSDT (1 symbol)

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=30');
  if (req.method === 'OPTIONS') return res.status(200).end();
  const t0 = Date.now();

  const sf = async (url, ms) => {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), ms);
    try {
      const r = await fetch(url, { signal: c.signal, headers: { Accept: 'application/json', 'User-Agent': 'AC369/1.0' } });
      clearTimeout(t); if (!r.ok) return null; return await r.json();
    } catch { clearTimeout(t); return null; }
  };

  try {
    const [btcTickR, byBTCR, byLSR, fngR, glR, memR, feesR, hashR] = await Promise.allSettled([
      sf('https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT', 4000),
      sf('https://api.bybit.com/v5/market/tickers?category=linear&symbol=BTCUSDT', 4000),
      sf('https://api.bybit.com/v5/market/account-ratio?category=linear&symbol=BTCUSDT&period=1h&limit=1', 4000),
      sf('https://api.alternative.me/fng/?limit=1&format=json', 4000),
      sf('https://api.coingecko.com/api/v3/global', 4000),
      sf('https://mempool.space/api/mempool', 4000),
      sf('https://mempool.space/api/v1/fees/recommended', 3000),
      sf('https://mempool.space/api/v1/mining/hashrate/3d', 4000),
    ]);
    const blockHR = await sf('https://mempool.space/api/blocks/tip/height', 3000);

    const bTick  = btcTickR.status === 'fulfilled' ? btcTickR.value : null;
    const byBTC  = byBTCR.status  === 'fulfilled' ? byBTCR.value?.result?.list?.[0] : null;
    const btcPrice = bTick?.lastPrice ? +bTick.lastPrice : (byBTC?.lastPrice ? +byBTC.lastPrice : 0);
    const btcChg24 = bTick?.priceChangePercent ? +bTick.priceChangePercent : (byBTC?.price24hPcnt ? +(+byBTC.price24hPcnt * 100).toFixed(2) : 0);
    const btcHigh  = bTick?.highPrice  ? +bTick.highPrice  : 0;
    const btcLow   = bTick?.lowPrice   ? +bTick.lowPrice   : 0;
    const btcVol   = bTick?.quoteVolume ? +bTick.quoteVolume : 0;
    const vol24hPct = btcPrice > 0 && btcHigh > btcLow ? +((btcHigh - btcLow) / btcPrice * 100).toFixed(2) : 0;

    const frRaw = byBTC?.fundingRate ? parseFloat(byBTC.fundingRate) : null;
    const frPct = frRaw !== null ? +(frRaw * 100).toFixed(4) : null;
    const frAnn = frRaw !== null ? +(frRaw * 100 * 3 * 365).toFixed(1) : null;
    const frSig = frPct === null ? '—' : frPct < -0.01 ? '⚡ Short Squeeze Setup!' : frPct < -0.003 ? '🟢 Negatif — squeeze potential' : frPct < 0.003 ? '⚖️ Netral' : frPct < 0.02 ? '⚠️ Long Bias' : frPct < 0.05 ? '⚠️ Overleveraged Longs' : '🔴 EXTREME';

    let oiVal = null, oiLabel = '—';
    if (byBTC?.openInterestValue) {
      oiVal  = +(parseFloat(byBTC.openInterestValue) / 1e9).toFixed(2);
      oiLabel = oiVal > 30 ? 'VERY HIGH' : oiVal > 20 ? 'HIGH' : oiVal > 10 ? 'NORMAL' : 'LOW';
    }

    let lsRatio = null, longPct = null, shortPct = null, lsSig = '—';
    const byLS = byLSR.status === 'fulfilled' ? byLSR.value?.result?.list?.[0] : null;
    if (byLS?.buyRatio) {
      const b = parseFloat(byLS.buyRatio), s = 1 - b;
      lsRatio  = s > 0 ? +(b / s).toFixed(3) : 1;
      longPct  = +(b * 100).toFixed(1);
      shortPct = +(s * 100).toFixed(1);
      lsSig    = lsRatio < 0.65 ? '⚡ Short overloaded — squeeze pending' : lsRatio < 0.9 ? '🟢 Slight short bias' : lsRatio > 2.0 ? '🔴 Long overloaded — dump risk' : lsRatio > 1.5 ? '⚠️ Slight long bias' : '⚖️ Balanced';
    } else if (frRaw !== null) {
      longPct  = +Math.max(35, Math.min(72, 52 + frRaw * 300)).toFixed(1);
      shortPct = +(100 - longPct).toFixed(1);
      lsRatio  = +(longPct / shortPct).toFixed(3);
      lsSig    = '~Est. dari FR';
    }

    const fng = fngR.status === 'fulfilled' ? fngR.value : null;
    const fgVal = fng?.data?.[0] ? parseInt(fng.data[0].value) : 50;
    const fgLabel = fng?.data?.[0]?.value_classification || 'Neutral';
    const fgStatus = fgVal <= 25 ? '🔥 Extreme Fear — buy zone terbaik' : fgVal <= 45 ? '😨 Fear — akumulasi bertahap' : fgVal >= 80 ? '🤑 Extreme Greed — waspada' : fgVal >= 65 ? '😄 Greed' : '😐 Neutral';

    const gld = glR.status === 'fulfilled' ? glR.value?.data : null;
    const btcDomPct = gld?.market_cap_percentage?.btc ? +gld.market_cap_percentage.btc.toFixed(1) : 58;

    const REALIZED  = 56576;
    const mvrvProxy = btcPrice > 0 ? +(btcPrice / REALIZED).toFixed(2) : null;
    const mvrvLabel = !mvrvProxy ? '—' : mvrvProxy < 0.8 ? '🔥 Extreme Undervalue' : mvrvProxy < 1.2 ? '🟢 Fair value — cheap' : mvrvProxy < 1.8 ? '⚖️ Fair value' : mvrvProxy < 2.5 ? '⚠️ Mulai mahal' : mvrvProxy < 3.5 ? '🔴 Bubble' : '💀 Extreme bubble';
    const nupl = btcPrice > 0 ? +Math.min(0.95, Math.max(-0.5, (btcPrice - REALIZED) / btcPrice)).toFixed(3) : null;
    const nuplLabel = nupl === null ? '—' : nupl < -0.25 ? '💎 CAPITULATION' : nupl < 0 ? '🌱 HOPE' : nupl < 0.25 ? '📈 OPTIMISM' : nupl < 0.5 ? '🔥 BELIEF' : nupl < 0.75 ? '⚠️ THRILL' : '🔴 EUPHORIA';
    const sopr = btcChg24 !== 0 ? +(1 + btcChg24 / 100).toFixed(3) : 1.000;
    const soprLabel = sopr >= 1.015 ? '📤 PROFIT TAKING' : sopr >= 1.003 ? '↑ MILD PROFIT' : sopr >= 0.990 ? '↔️ BREAKEVEN' : sopr >= 0.970 ? '↓ MILD LOSS' : '📉 LOSS SELLING';

    const mem = memR.status === 'fulfilled' ? memR.value : null;
    const fees = feesR.status === 'fulfilled' ? feesR.value : null;
    const hash = hashR.status === 'fulfilled' ? hashR.value : null;
    const blockH = typeof blockHR === 'number' ? blockHR : typeof blockHR === 'string' ? parseInt(blockHR) : 949671;
    const hashRate  = hash?.currentHashrate ? +(hash.currentHashrate / 1e18).toFixed(1) : null;
    const hashRateT = hashRate ? (hashRate > 600 ? 'ATH Zone 🔥' : hashRate > 500 ? 'Very High' : 'Normal') : '—';
    const mempoolTx = mem?.count || null;
    const mempoolMB = mem?.vsize ? +(mem.vsize / 1e6).toFixed(1) : null;
    const fastFee   = fees?.fastestFee || null;
    const feeStatus = fastFee ? (fastFee > 100 ? '🔴 Sangat Mahal' : fastFee > 40 ? '⚠️ Mahal' : fastFee > 15 ? '🟡 Sedang' : '🟢 Murah') : '—';

    const HALVING = 1050000;
    const bLeft   = Math.max(0, HALVING - blockH);
    const dLeft   = Math.round(bLeft * 10 / 60 / 24);
    const halvPct = +Math.min(100, Math.max(0, (blockH - 840000) / (HALVING - 840000) * 100)).toFixed(1);

    let bull = 40, bear = 40;
    if (fgVal <= 20) bull += 20; else if (fgVal <= 35) bull += 10; else if (fgVal <= 45) bull += 5;
    else if (fgVal >= 80) bear += 20; else if (fgVal >= 65) bear += 10; else if (fgVal >= 55) bear += 5;
    if (frPct !== null) { if (frPct < -0.01) bull += 20; else if (frPct < 0) bull += 8; else if (frPct > 0.08) bear += 20; else if (frPct > 0.04) bear += 8; }
    if (lsRatio !== null) { if (lsRatio < 0.65) bull += 15; else if (lsRatio > 2.0) bear += 15; }
    if (btcChg24 > 5) bull += 10; else if (btcChg24 > 2) bull += 5; else if (btcChg24 < -5) bear += 10; else if (btcChg24 < -2) bear += 5;
    if (mvrvProxy) { if (mvrvProxy < 1.2) bull += 8; else if (mvrvProxy > 2.5) bear += 8; }
    const total = bull + bear;
    const bullBias = total > 0 ? Math.round(bull / total * 100) : 50;
    const overallSignal = bullBias >= 72 ? '📈 STRONG BULLISH' : bullBias >= 60 ? '🟢 BULLISH' : bullBias <= 28 ? '📉 STRONG BEARISH' : bullBias <= 40 ? '🔴 BEARISH' : '⚖️ NEUTRAL';

    const aiPrompt = `BTC: $${btcPrice.toLocaleString('en-US',{maximumFractionDigits:0})} | ${btcChg24>=0?'+':''}${btcChg24.toFixed(2)}% | Vol $${(btcVol/1e9).toFixed(1)}B\nF&G: ${fgVal} (${fgLabel}) | FR: ${frPct??'N/A'}% | Ann: ${frAnn??'N/A'}%\nL/S: ${lsRatio??'N/A'} | Long: ${longPct??'—'}% | Short: ${shortPct??'—'}%\nOI: $${oiVal??'N/A'}B | BTC Dom: ${btcDomPct}%\nMVRV proxy: ${mvrvProxy??'N/A'} | NUPL: ${nupl??'N/A'}\nBlock: ${blockH.toLocaleString()} | Hash: ${hashRate??'—'} EH/s\nBull: ${bull} | Bear: ${bear} | ${bullBias}% Bull | ${overallSignal}`;

    return res.status(200).json({
      ok: true, ts: Date.now(), elapsed: Date.now() - t0, version: 'v16',
      sources: ['Binance Spot (single)', 'Bybit Linear (single)', 'Alternative.me', 'CoinGecko', 'mempool.space'],
      btcPrice, btcChg24h: +btcChg24.toFixed(2), btcVol, btcHigh, btcLow, vol24hPct,
      fgVal, fgLabel, fgStatus, frPct, frAnn, frSig, frSrc: 'Bybit',
      oiVal, oiLabel, lsRatio, longPct, shortPct, lsSig,
      mvrvProxy, mvrvLabel, nuplProxy: nupl, nuplLabel, soprProxy: sopr, soprLabel,
      btcDomPct, blockH, hashRate, hashRateT, mempoolTx, mempoolMB, fastFee, feeStatus,
      blocksLeft: bLeft, daysLeft: dLeft, halvingPct: halvPct,
      bullPts: bull, bearPts: bear, bullBias, overallSignal,
      weeklyOutlook: {
        sentimentNote: `F&G ${fgVal}/100 (${fgLabel}).\n${fgStatus}`,
        derivNote: frPct !== null ? `FR ${frPct}% per 8h (Bybit).\nL/S: ${longPct||'?'}%/${shortPct||'?'}%.\n${lsSig}.` : `OI: $${oiVal||'N/A'}B. ${lsSig}.`,
        domNote: `BTC Dom ${btcDomPct}%.\n${btcDomPct > 57 ? 'BTC season.' : btcDomPct < 45 ? 'Altseason.' : 'Transisi.'}`,
        trendNote: `BTC ${btcChg24 >= 0 ? '+' : ''}${btcChg24.toFixed(2)}% (24h). $${(btcVol/1e9).toFixed(1)}B.\n${Math.abs(btcChg24) < 0.5 ? 'Sideways.' : btcChg24 > 2 ? 'Momentum bullish.' : btcChg24 < -2 ? 'Tekanan jual.' : 'Mild.'}`,
      },
      aiPrompt, dataOk: btcPrice > 0,
    });
  } catch (e) {
    return res.status(200).json({
      ok: false, error: e.message, ts: Date.now(), elapsed: Date.now() - t0, version: 'v16',
      btcPrice: 0, fgVal: 50, fgLabel: 'Neutral', fgStatus: '—',
      frPct: null, frSig: '—', oiVal: null, oiLabel: '—', lsRatio: null,
      longPct: null, shortPct: null, lsSig: '—', mvrvProxy: null, mvrvLabel: '—',
      nuplProxy: null, nuplLabel: '—', soprProxy: 1, soprLabel: '↔️ BREAKEVEN',
      btcDomPct: 58, blockH: 949671, hashRate: null, mempoolTx: null, fastFee: null,
      blocksLeft: 100329, daysLeft: 696, halvingPct: 52, feeStatus: '—', hashRateT: '—',
      bullBias: 50, overallSignal: '⚖️ NEUTRAL', weeklyOutlook: {}, aiPrompt: '', dataOk: false,
    });
  }
}
