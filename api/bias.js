// api/bias.js — AC369 FUSION v14
// FAST: CryptoCompare klines (never blocked), Bybit for FR
// Target: < 8 seconds total response time

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  res.setHeader('Cache-Control', 's-maxage=90');

  const sf = async (url, ms = 5000) => {
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
    // All 4 fetches in parallel — lean and fast
    const [fngR, ccR, globalR, bybtcR] = await Promise.allSettled([
      sf('https://api.alternative.me/fng/?limit=1&format=json', 4000),
      sf('https://min-api.cryptocompare.com/data/v2/histohour?fsym=BTC&tsym=USD&limit=100', 5000),
      sf('https://api.coingecko.com/api/v3/global', 5000),
      sf('https://api.bybit.com/v5/market/tickers?category=linear&symbol=BTCUSDT', 4000),
    ]);

    let biasScore = 0;
    const details = [];
    let fgValue = 50, btcDom = 58, btcTrend = 'NEUTRAL', altIdx = 50;

    // ── F&G ──────────────────────────────────────────────────
    if (fngR.status === 'fulfilled' && fngR.value?.data?.[0]) {
      fgValue = parseInt(fngR.value.data[0].value);
      if      (fgValue <= 20) { biasScore += 3; details.push(`F&G ${fgValue} (Extreme Fear)`); }
      else if (fgValue <= 35) { biasScore += 2; details.push(`F&G ${fgValue} (Fear — akumulasi bertahap)`); }
      else if (fgValue <= 45) { biasScore += 1; details.push(`F&G ${fgValue} (Mild Fear)`); }
      else if (fgValue >= 80) { biasScore -= 3; details.push(`F&G ${fgValue} (Extreme Greed)`); }
      else if (fgValue >= 65) { biasScore -= 2; details.push(`F&G ${fgValue} (Greed)`); }
      else if (fgValue >= 55) { biasScore -= 1; details.push(`F&G ${fgValue} (Mild Greed)`); }
      else                    { details.push(`F&G ${fgValue} (Neutral)`); }
    }

    // ── BTC DOM ───────────────────────────────────────────────
    if (globalR.status === 'fulfilled' && globalR.value?.data) {
      btcDom = +((globalR.value.data.market_cap_percentage?.btc || 58).toFixed(1));
      if      (btcDom > 62) { biasScore -= 2; details.push(`BTC Dom ${btcDom}% (sangat tinggi)`); }
      else if (btcDom > 57) { biasScore -= 1; details.push(`BTC Dom ${btcDom}% (BTC season)`); }
      else if (btcDom < 48) { biasScore += 2; details.push(`BTC Dom ${btcDom}% (Altseason!)`); }
      else if (btcDom < 52) { biasScore += 1; details.push(`BTC Dom ${btcDom}% (Alt trending)`); }
      else                  { details.push(`BTC Dom ${btcDom}%`); }
    }

    // ── BTC TREND via CryptoCompare 1H → aggregate 4H ────────
    const cc = ccR.status === 'fulfilled' ? ccR.value : null;
    if (cc?.Response === 'Success' && cc.Data?.Data?.length > 40) {
      const raw = cc.Data.Data.filter(d => d.close > 0).map(d => d.close);
      // Build 4H from 1H
      const c4h = [];
      for (let i = 0; i + 3 < raw.length; i += 4) c4h.push(raw[i + 3]);
      if (c4h.length >= 20) {
        const n = c4h.length, last = c4h[n - 1];
        const ema20 = c4h.slice(-20).reduce((a, b) => a + b, 0) / 20;
        const ema50 = n >= 50 ? c4h.slice(-50).reduce((a, b) => a + b, 0) / 50 : c4h.reduce((a, b) => a + b, 0) / n;
        // RSI 14
        let g = 0, l = 0, p = Math.min(14, n - 1);
        for (let i = n - p; i < n; i++) { const d = c4h[i] - c4h[i - 1]; d >= 0 ? g += d : l -= d; }
        const ag = g / p, al = l / p;
        const rsi = al === 0 ? 100 : parseFloat((100 - 100 / (1 + ag / al)).toFixed(1));
        const ts = (last > ema20 ? 1 : -1) + (last > ema50 ? 1 : -1) + (rsi > 50 ? 0.5 : -0.5);
        if      (ts >= 2)  { btcTrend = 'BULLISH';      biasScore += 3; details.push(`BTC 4H BULLISH (RSI ${rsi})`); }
        else if (ts > 0)   { btcTrend = 'BULLISH_WEAK'; biasScore += 1; details.push(`BTC 4H lemah bullish (RSI ${rsi})`); }
        else if (ts <= -2) { btcTrend = 'BEARISH';      biasScore -= 3; details.push(`BTC 4H BEARISH (RSI ${rsi})`); }
        else if (ts < 0)   { btcTrend = 'BEARISH_WEAK'; biasScore -= 1; details.push(`BTC 4H lemah bearish (RSI ${rsi})`); }
        else               { details.push(`BTC 4H neutral (RSI ${rsi})`); }
      }
    }

    // ── FUNDING RATE from Bybit ───────────────────────────────
    const byT = bybtcR.status === 'fulfilled' ? bybtcR.value?.result?.list?.[0] : null;
    if (byT?.fundingRate) {
      const fr = parseFloat(byT.fundingRate) * 100;
      if      (fr < -0.01) { biasScore += 2; details.push(`FR ${fr.toFixed(4)}% (negative — squeeze potential)`); }
      else if (fr < 0)     { biasScore += 1; details.push(`FR ${fr.toFixed(4)}% (slightly negative)`); }
      else if (fr > 0.06)  { biasScore -= 2; details.push(`FR ${fr.toFixed(4)}% (overleveraged longs)`); }
      else if (fr > 0.03)  { biasScore -= 1; details.push(`FR ${fr.toFixed(4)}% (elevated)`); }
    }

    // ── FINAL BIAS ────────────────────────────────────────────
    let bias, biasLabel, recommendation;
    if      (biasScore >= 6)  { bias = 'STRONG_BULL'; biasLabel = '🚀 STRONG BULLISH'; recommendation = '✅ Kondisi ideal Long. Prioritaskan entry bullish berkualitas tinggi.'; }
    else if (biasScore >= 3)  { bias = 'BULLISH';     biasLabel = '📈 BULLISH';         recommendation = '✅ Kondisi bagus untuk Long. Filter sinyal beli yang kuat.'; }
    else if (biasScore <= -6) { bias = 'STRONG_BEAR'; biasLabel = '💀 STRONG BEARISH'; recommendation = '⚠️ Prioritaskan Short/Sell atau Cash. Altcoin naik = dead-cat bounce.'; }
    else if (biasScore <= -3) { bias = 'BEARISH';     biasLabel = '📉 BEARISH';         recommendation = '⚠️ Hati-hati Long. Altcoin naik kemungkinan dead-cat bounce.'; }
    else                      { bias = 'NEUTRAL';     biasLabel = '⚖️ NEUTRAL';          recommendation = '⚖️ Selektif. Ikuti setup berkualitas tinggi saja, sizing kecil.'; }

    // ── ASTRO ─────────────────────────────────────────────────
    const jd  = Date.now() / 86400000 + 2440587.5;
    const dnm = ((jd - 2460320.5) % 29.53058867 + 29.53058867) % 29.53058867;
    const moonPhases = [[1.5,'New Moon','🌑'],[7.5,'Waxing Crescent','🌒'],[8.5,'First Quarter','🌓'],[14,'Waxing Gibbous','🌔'],[16,'Full Moon','🌕'],[22,'Waning','🌖']];
    let moonPhase = 'Dark Moon', moonEmoji = '🌘';
    for (const [limit, phase, emoji] of moonPhases) { if (dnm < limit) { moonPhase = phase; moonEmoji = emoji; break; } }
    const dsh = Math.floor((Date.now() - new Date('2024-04-20').getTime()) / 86400000);
    const halvingPhase = dsh < 90 ? 'Post-Halving Early' : dsh < 365 ? 'Bull Cycle Early ✅' : dsh < 547 ? 'Bull Cycle Peak ⚠️' : dsh < 730 ? 'Distribution ⚠️' : 'Bear Market / Accumulation';

    return res.status(200).json({
      timestamp: Date.now(), version: 'v14',
      bias, biasLabel, biasScore,
      fgValue, btcDom, btcTrend, altIdx,
      details,
      recommendation,
      astro: { moonPhase, moonEmoji, halvingPhase, daysSinceHalving: dsh, daysSinceNM: +dnm.toFixed(1) },
    });

  } catch (e) {
    return res.status(200).json({
      error: e.message, timestamp: Date.now(), version: 'v14',
      bias: 'NEUTRAL', biasLabel: '⚖️ NEUTRAL', biasScore: 0,
      fgValue: 50, btcDom: 58, btcTrend: 'NEUTRAL', altIdx: 50,
      details: ['Error: ' + e.message], recommendation: 'Data tidak tersedia — coba refresh.',
      astro: { moonPhase: 'Unknown', moonEmoji: '🌙', halvingPhase: 'Bull Cycle', daysSinceHalving: 390 },
    });
  }
}
