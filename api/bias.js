// api/bias.js — v15 ULTRA LEAN
// Max 5 seconds total. 3 parallel calls only.
// NO Binance fapi, NO CryptoCompare (slow), NO CoinGecko (rate limit)

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  res.setHeader('Cache-Control', 's-maxage=90, stale-while-revalidate=30');

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
    // 3 parallel calls — all fast, all reliable
    const [fngR, byR, glR] = await Promise.allSettled([
      sf('https://api.alternative.me/fng/?limit=1&format=json', 4000),
      sf('https://api.bybit.com/v5/market/tickers?category=linear&symbol=BTCUSDT', 4000),
      sf('https://api.coingecko.com/api/v3/global', 4000),
    ]);

    // F&G
    const fgVal = fngR.status === 'fulfilled' && fngR.value?.data?.[0]
      ? parseInt(fngR.value.data[0].value) : 50;
    const fgCls = fngR.status === 'fulfilled' && fngR.value?.data?.[0]
      ? fngR.value.data[0].value_classification : 'Neutral';

    // Bybit BTC
    const byT = byR.status === 'fulfilled' ? byR.value?.result?.list?.[0] : null;
    const btcPx  = byT ? +byT.lastPrice : 0;
    const btcChg = byT?.price24hPcnt ? +(+byT.price24hPcnt * 100).toFixed(2) : 0;
    const frRaw  = byT?.fundingRate ? parseFloat(byT.fundingRate) : null;
    const frPct  = frRaw !== null ? +(frRaw * 100).toFixed(4) : null;

    // BTC Dom
    const btcDom = glR.status === 'fulfilled' && glR.value?.data?.market_cap_percentage?.btc
      ? +glR.value.data.market_cap_percentage.btc.toFixed(1) : 58.0;

    // Bias scoring
    let score = 0;
    const details = [];

    // F&G contribution
    if      (fgVal <= 20) { score += 3; details.push(`😱 F&G ${fgVal} (Extreme Fear — beli kuat)`); }
    else if (fgVal <= 35) { score += 2; details.push(`😨 F&G ${fgVal} (Fear — akumulasi bertahap)`); }
    else if (fgVal <= 45) { score += 1; details.push(`😟 F&G ${fgVal} (Mild Fear)`); }
    else if (fgVal >= 80) { score -= 3; details.push(`🤑 F&G ${fgVal} (Extreme Greed — distribusi)`); }
    else if (fgVal >= 65) { score -= 2; details.push(`😄 F&G ${fgVal} (Greed — waspada)`); }
    else if (fgVal >= 55) { score -= 1; details.push(`🙂 F&G ${fgVal} (Mild Greed)`); }
    else                  { details.push(`😐 F&G ${fgVal} (Neutral)`); }

    // BTC price change
    if      (btcChg > 5)  { score += 2; details.push(`🚀 BTC +${btcChg}% momentum bullish`); }
    else if (btcChg > 2)  { score += 1; details.push(`📈 BTC +${btcChg}% mild bullish`); }
    else if (btcChg < -5) { score -= 2; details.push(`📉 BTC ${btcChg}% downtrend aktif`); }
    else if (btcChg < -2) { score -= 1; details.push(`🔻 BTC ${btcChg}% mild bearish`); }
    else                  { details.push(`↔️ BTC ${btcChg >= 0 ? '+' : ''}${btcChg}% sideways`); }

    // BTC Dom
    if      (btcDom > 62) { score -= 2; details.push(`₿ Dom ${btcDom}% — BTC dominasi kuat, altcoin lemah`); }
    else if (btcDom > 57) { score -= 1; details.push(`₿ Dom ${btcDom}% — BTC season`); }
    else if (btcDom < 48) { score += 2; details.push(`🔄 Dom ${btcDom}% — Altseason aktif!`); }
    else if (btcDom < 52) { score += 1; details.push(`🔄 Dom ${btcDom}% — Rotasi ke altcoin`); }
    else                  { details.push(`₿ Dom ${btcDom}% — Netral`); }

    // Funding rate
    if (frPct !== null) {
      if      (frPct < -0.01) { score += 2; details.push(`⚡ FR ${frPct}% (negative — squeeze potential)`); }
      else if (frPct < 0)     { score += 1; details.push(`💚 FR ${frPct}% (slightly negative)`); }
      else if (frPct > 0.06)  { score -= 2; details.push(`⚠️ FR ${frPct}% (overleveraged longs)`); }
      else if (frPct > 0.03)  { score -= 1; details.push(`⚠️ FR ${frPct}% (elevated funding)`); }
      else                    { details.push(`⚖️ FR ${frPct}% (normal)`); }
    }

    // Final bias
    let bias, biasLabel, recommendation;
    if      (score >= 6)  { bias = 'STRONG_BULL'; biasLabel = '🚀 STRONG BULLISH'; recommendation = '✅ STRONG BULL — Kondisi ideal Long. Semua indikator aligned bullish. Entry berkualitas tinggi.'; }
    else if (score >= 3)  { bias = 'BULLISH';     biasLabel = '📈 BULLISH';         recommendation = '✅ BULLISH — Kondisi bagus Long. Filter setup terbaik. Sizing normal.'; }
    else if (score >= 1)  { bias = 'MILD_BULL';   biasLabel = '🟢 MILD BULLISH';    recommendation = '🟢 MILD BULL — Condisional. Hanya ambil setup berkualitas A+. Sizing kecil.'; }
    else if (score <= -6) { bias = 'STRONG_BEAR'; biasLabel = '💀 STRONG BEARISH';  recommendation = '🔴 STRONG BEAR — Cash atau Short only. Jangan beli altcoin.'; }
    else if (score <= -3) { bias = 'BEARISH';     biasLabel = '📉 BEARISH';          recommendation = '⚠️ BEARISH — Hati-hati Long. Altcoin naik = dead-cat bounce. Risk off.'; }
    else if (score <= -1) { bias = 'MILD_BEAR';   biasLabel = '🔴 MILD BEARISH';     recommendation = '⚠️ MILD BEAR — Defensive. Prioritaskan BTC/ETH over altcoin.'; }
    else                  { bias = 'NEUTRAL';     biasLabel = '⚖️ NEUTRAL';           recommendation = '⚖️ NEUTRAL — Market transisi. Setup selektif saja, sizing kecil.'; }

    // Astro
    const jd  = Date.now() / 86400000 + 2440587.5;
    const dnm = ((jd - 2460320.5) % 29.53058867 + 29.53058867) % 29.53058867;
    const phases = [[1.5,'New Moon','🌑'],[7.5,'Waxing Crescent','🌒'],[8.5,'First Quarter','🌓'],[14,'Waxing Gibbous','🌔'],[16,'Full Moon','🌕'],[22,'Waning','🌖']];
    let moonPhase = 'Dark Moon', moonEmoji = '🌘';
    for (const [lim, ph, em] of phases) { if (dnm < lim) { moonPhase = ph; moonEmoji = em; break; } }
    const dsh = Math.floor((Date.now() - 1713571200000) / 86400000); // since April 20 2024
    const halvingPhase = dsh < 90 ? 'Post-Halving Early' : dsh < 365 ? '🔥 Bull Cycle Early' : dsh < 547 ? '⚡ Bull Cycle Peak Zone' : dsh < 730 ? '⚠️ Distribution Zone' : 'Accumulation';

    return res.status(200).json({
      ok: true, ts: Date.now(), elapsed: Date.now() - t0, version: 'v15',
      bias, biasLabel, biasScore: score,
      fgValue: fgVal, fgClass: fgCls,
      btcPrice: btcPx, btcChg24h: btcChg,
      btcDom, frPct,
      btcTrend: btcChg > 2 ? 'BULLISH' : btcChg < -2 ? 'BEARISH' : 'NEUTRAL',
      details, recommendation,
      astro: { moonPhase, moonEmoji, halvingPhase, daysSinceHalving: dsh, daysSinceNM: +dnm.toFixed(1) },
    });

  } catch (e) {
    return res.status(200).json({
      ok: false, error: e.message, ts: Date.now(), version: 'v15',
      bias: 'NEUTRAL', biasLabel: '⚖️ NEUTRAL', biasScore: 0,
      fgValue: 50, fgClass: 'Neutral', btcPrice: 0, btcChg24h: 0, btcDom: 58, frPct: null,
      btcTrend: 'NEUTRAL', details: ['Error: ' + e.message],
      recommendation: '⚖️ Data tidak tersedia — coba refresh.',
      astro: { moonPhase: 'Unknown', moonEmoji: '🌙', halvingPhase: 'Bull Cycle', daysSinceHalving: 400 },
    });
  }
}
