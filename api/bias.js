// api/bias.js — AC369 FUSION v12.1 NEW
// Dedicated Daily Market Bias endpoint
// Called by refreshAll() on page load — no need to run scanner
// Combines: F&G + BTC Dominance + BTC 4H trend + Altcoin Season

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  res.setHeader('Cache-Control', 's-maxage=60');

  const sf = async (url, ms = 5000) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
      const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } });
      clearTimeout(t); if (!r.ok) return null; return await r.json();
    } catch { clearTimeout(t); return null; }
  };

  try {
    // Fetch F&G + BTC 4H klines + Global (dominance) in parallel
    const [fngRes, btcKlines4h, globalRes, tickerRes] = await Promise.allSettled([
      sf('https://api.alternative.me/fng/?limit=1&format=json'),
      // CryptoCompare first (always works), then Binance
      Promise.allSettled([
        sf('https://min-api.cryptocompare.com/data/v2/histohour?fsym=BTC&tsym=USD&limit=200', 5000),
        sf('https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=4h&limit=50', 5000),
        sf('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=4h&limit=50', 5000),
      ]).then(([ccR, fapiR, spotR]) => {
        const cc = ccR.value, fapi = fapiR.value, spot = spotR.value;
        if(cc?.Response === 'Success' && cc?.Data?.Data?.length > 20) return cc.Data.Data.map(x => +x.close).filter(v => v > 0);
        if(Array.isArray(fapi) && fapi.length > 10) return fapi.map(k => +k[4]);
        if(Array.isArray(spot)) return spot.map(k => +k[4]);
        return null;
      }),
      sf('https://api.coingecko.com/api/v3/global'),
      sf('https://api.binance.com/api/v3/ticker/24hr')
        .then(d => Array.isArray(d) && d.length > 100 ? d : null),
    ]);

    let biasScore = 0;
    const biasDetails = [];
    let fgValue = 50, btcDom = 58, btcTrend = 'NEUTRAL', altIdx = 0;

    // ── FEAR & GREED ──────────────────────────────────────────
    if (fngRes.status === 'fulfilled' && fngRes.value?.data) {
      fgValue = parseInt(fngRes.value.data[0].value);
      if (fgValue <= 20) { biasScore += 3; biasDetails.push(`F&G ${fgValue} (Extreme Fear — zona beli terbaik)`); }
      else if (fgValue <= 35) { biasScore += 2; biasDetails.push(`F&G ${fgValue} (Fear — akumulasi bertahap)`); }
      else if (fgValue <= 45) { biasScore += 1; biasDetails.push(`F&G ${fgValue} (Mild Fear)`); }
      else if (fgValue >= 80) { biasScore -= 3; biasDetails.push(`F&G ${fgValue} (Extreme Greed — distribusi)`); }
      else if (fgValue >= 65) { biasScore -= 2; biasDetails.push(`F&G ${fgValue} (Greed — kurangi eksposur)`); }
      else if (fgValue >= 55) { biasScore -= 1; biasDetails.push(`F&G ${fgValue} (Mild Greed)`); }
      else { biasDetails.push(`F&G ${fgValue} (Neutral)`); }
    }

    // ── BTC DOMINANCE ─────────────────────────────────────────
    if (globalRes.status === 'fulfilled' && globalRes.value?.data) {
      btcDom = parseFloat((globalRes.value.data.market_cap_percentage?.btc || 58).toFixed(1));
      if (btcDom > 62) { biasScore -= 2; biasDetails.push(`BTC Dom ${btcDom}% (terlalu tinggi — altcoin sangat lemah)`); }
      else if (btcDom > 57) { biasScore -= 1; biasDetails.push(`BTC Dom ${btcDom}% (BTC season — rotasi belum)`); }
      else if (btcDom < 48) { biasScore += 2; biasDetails.push(`BTC Dom ${btcDom}% (Altseason aktif!)`); }
      else if (btcDom < 52) { biasScore += 1; biasDetails.push(`BTC Dom ${btcDom}% (transisi ke altseason)`); }
      else { biasDetails.push(`BTC Dom ${btcDom}% (neutral)`); }
    }

    // ── BTC 4H TREND ──────────────────────────────────────────
    const closes = btcKlines4h.status === 'fulfilled' && Array.isArray(btcKlines4h.value) ? btcKlines4h.value.filter(v => v > 0) : null;
    if (closes && closes.length >= 20) {
      const last = closes[closes.length - 1];
      const n = closes.length;
      const ema20 = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
      const ema50 = n >= 50 ? closes.slice(-50).reduce((a, b) => a + b, 0) / 50 : closes.reduce((a, b) => a + b, 0) / n;

      // RSI 14
      let g = 0, l = 0;
      const rsiStart = Math.max(0, closes.length - 15);
      for (let i = rsiStart + 1; i < closes.length; i++) { const d = closes[i] - closes[i - 1]; d >= 0 ? g += d : l -= d; }
      const p = closes.length - rsiStart - 1;
      const ag = p > 0 ? g / p : 0, al = p > 0 ? l / p : 0;
      const rsi4h = al === 0 ? (g > 0 ? 100 : 50) : parseFloat((100 - 100 / (1 + ag / al)).toFixed(1));

      const tScore = (last > ema20 ? 1 : -1) + (last > ema50 ? 1 : -1) + (rsi4h > 50 ? 0.5 : -0.5);
      if (tScore >= 2) { btcTrend = 'BULLISH'; biasScore += 3; biasDetails.push(`BTC 4H BULLISH (EMA20/50 bullish, RSI ${rsi4h})`); }
      else if (tScore > 0) { btcTrend = 'BULLISH_WEAK'; biasScore += 1; biasDetails.push(`BTC 4H lemah bullish (RSI ${rsi4h})`); }
      else if (tScore <= -2) { btcTrend = 'BEARISH'; biasScore -= 3; biasDetails.push(`BTC 4H BEARISH (EMA bearish, RSI ${rsi4h})`); }
      else if (tScore < 0) { btcTrend = 'BEARISH_WEAK'; biasScore -= 1; biasDetails.push(`BTC 4H lemah bearish (RSI ${rsi4h})`); }
      else { biasDetails.push(`BTC 4H neutral (RSI ${rsi4h})`); }
    }

    // ── ALTCOIN SEASON CONTRIBUTION ───────────────────────────
    const tickers = tickerRes.status === 'fulfilled' ? tickerRes.value : null;
    if (Array.isArray(tickers) && tickers.length > 50) {
      const tMap = {};
      tickers.forEach(t => { if (t?.symbol) tMap[t.symbol] = t; });
      const btcChg = +(tMap['BTCUSDT']?.priceChangePercent || 0);
      const ALTS = ['ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT','ADAUSDT','AVAXUSDT','DOTUSDT','LINKUSDT','MATICUSDT','NEARUSDT','ARBUSDT'];
      let out = 0, tot = 0;
      ALTS.forEach(s => { if (tMap[s]) { tot++; if (+(tMap[s].priceChangePercent || 0) > btcChg) out++; } });
      altIdx = tot > 0 ? Math.round(out / tot * 100) : 0;
      if (altIdx >= 70) { biasScore += 1; biasDetails.push(`Altcoin ${altIdx}% outperform BTC — rotasi aktif`); }
      else if (altIdx <= 25) { biasScore -= 1; biasDetails.push(`Altcoin ${altIdx}% outperform BTC — BTC dominasi`); }
    }

    // ── COMPUTE FINAL BIAS ────────────────────────────────────
    let bias, biasLabel, biasColor, recommendation;
    if (biasScore >= 5) {
      bias = 'STRONG_BULL'; biasLabel = '🚀 STRONG BULLISH';
      recommendation = '✅ Bias STRONG BULL — kondisi ideal untuk Long. Prioritaskan entry bullish berkualitas tinggi.';
    } else if (biasScore >= 2) {
      bias = 'BULLISH'; biasLabel = '📈 BULLISH';
      recommendation = '✅ Bias BULLISH — kondisi bagus untuk Long. Filter sinyal beli yang kuat.';
    } else if (biasScore <= -5) {
      bias = 'STRONG_BEAR'; biasLabel = '💀 STRONG BEARISH';
      recommendation = '⚠️ Bias STRONG BEAR — prioritaskan Short/Sell atau Cash. Altcoin bullish MELAWAN ARUS KUAT.';
    } else if (biasScore <= -2) {
      bias = 'BEARISH'; biasLabel = '📉 BEARISH';
      recommendation = '⚠️ Bias BEARISH — hati-hati Long. Altcoin naik kemungkinan dead-cat bounce.';
    } else {
      bias = 'NEUTRAL'; biasLabel = '⚖️ NEUTRAL';
      recommendation = '⚖️ Bias NEUTRAL — selektif. Ikuti setup berkualitas tinggi saja, sizing kecil.';
    }

    // ── ASTRO ─────────────────────────────────────────────────
    const jd = Date.now() / 86400000 + 2440587.5;
    const dnm = ((jd - 2460320.5) % 29.53058867 + 29.53058867) % 29.53058867;
    let moonPhase, moonEmoji;
    if (dnm < 1.5) { moonPhase = 'New Moon'; moonEmoji = '🌑'; }
    else if (dnm < 7.5) { moonPhase = 'Waxing Crescent'; moonEmoji = '🌒'; }
    else if (dnm < 8.5) { moonPhase = 'First Quarter'; moonEmoji = '🌓'; }
    else if (dnm < 14) { moonPhase = 'Waxing Gibbous'; moonEmoji = '🌔'; }
    else if (dnm < 16) { moonPhase = 'Full Moon'; moonEmoji = '🌕'; }
    else if (dnm < 22) { moonPhase = 'Waning'; moonEmoji = '🌖'; }
    else { moonPhase = 'Dark Moon'; moonEmoji = '🌘'; }

    // Mercury Retrograde check
    const now = new Date();
    const mrs = [
      { s: new Date('2025-03-15'), e: new Date('2025-04-07') },
      { s: new Date('2025-07-18'), e: new Date('2025-08-11') },
      { s: new Date('2025-11-09'), e: new Date('2025-12-01') },
      { s: new Date('2026-03-08'), e: new Date('2026-03-31') },
      { s: new Date('2026-07-06'), e: new Date('2026-07-30') },
      { s: new Date('2026-10-28'), e: new Date('2026-11-18') },
    ];
    const inMR = mrs.some(p => now >= p.s && now <= p.e);
    const inMRShadow = mrs.some(p => {
      const ps = new Date(p.s.getTime() - 7 * 86400000);
      const pe = new Date(p.e.getTime() + 7 * 86400000);
      return now >= ps && now <= pe;
    });
    const mercuryWarning = inMR ? '⚠️ Mercury Retrograde — sinyal palsu tinggi, kurangi leverage' : inMRShadow ? '⚠️ Mercury Shadow — konfirmasi sinyal lebih ketat' : null;

    // Halving cycle
    const halvingDate = new Date('2024-04-20');
    const daysSinceHalving = Math.floor((now - halvingDate.getTime()) / 86400000);
    const halvingPhase = daysSinceHalving < 90 ? 'Post-Halving Early' : daysSinceHalving < 365 ? 'Bull Cycle Early ✅' : daysSinceHalving < 547 ? 'Bull Cycle Peak ⚠️' : daysSinceHalving < 730 ? 'Distribution ⚠️' : 'Bear Market / Accumulation';

    return res.status(200).json({
      timestamp: Date.now(),
      bias, biasLabel, biasScore,
      fgValue, btcDom, btcTrend, altIdx,
      details: biasDetails,
      recommendation,
      astro: { moonPhase, moonEmoji, halvingPhase, daysSinceHalving, inMercuryRetrograde: inMR, inMercuryShadow: inMRShadow, mercuryWarning, daysSinceNM: +dnm.toFixed(1) },
    });
  } catch (e) {
    return res.status(500).json({ error: e.message, bias: 'NEUTRAL', biasLabel: '⚖️ NEUTRAL', biasScore: 0, details: [] });
  }
}
