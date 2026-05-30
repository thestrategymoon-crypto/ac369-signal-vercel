// api/bias.js - AC369 v18 CLEAN
// Pure ASCII, no backticks, no template literals
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60');
  if (req.method === 'OPTIONS') return res.status(200).end();
  const t0 = Date.now();
  const defaults = {
    ok: true, version: 'v18', bias: 'NEUTRAL', biasLabel: 'NEUTRAL', biasColor: 'amber',
    recommendation: 'Market transisi. DCA spot di discount zone.',
    totalScore: 0, details: [], fgValue: 50, fgClass: 'Neutral',
    btcPrice: null, btcChange: 0, btcTrend: 'SIDEWAYS',
    btcFR: 0, btcLS: null, btcLongPct: null, btcShortPct: null,
    btcDom: null, mcapChg24h: 0,
    astro: { moonPhase: 'Waxing', moonEmoji: 'moon', halvingPhase: 'Bull Cycle', chaotic: false },
    ts: Date.now(), elapsed: 0
  };
  try {
    var btcPrice = 0, btcFR = 0, btcOI = 0;
    try {
      var ctrl = new AbortController();
      var tmr = setTimeout(function() { ctrl.abort(); }, 5000);
      var r1 = await fetch('https://api.bybit.com/v5/market/tickers?category=linear&symbol=BTCUSDT', { signal: ctrl.signal });
      clearTimeout(tmr);
      if (r1.ok) {
        var d1 = await r1.json();
        var t1 = d1 && d1.result && d1.result.list && d1.result.list[0];
        if (t1) {
          btcPrice = parseFloat(t1.lastPrice) || 0;
          btcFR = parseFloat(t1.fundingRate) || 0;
          btcOI = parseFloat(t1.openInterestValue) || 0;
        }
      }
    } catch(e) { clearTimeout(tmr); }
    var fgVal = 50, fgClass = 'Neutral';
    try {
      var r2 = await fetch('https://api.alternative.me/fng/?limit=1&format=json');
      if (r2.ok) {
        var d2 = await r2.json();
        if (d2 && d2.data && d2.data[0]) {
          fgVal = parseInt(d2.data[0].value) || 50;
          fgClass = d2.data[0].value_classification || 'Neutral';
        }
      }
    } catch(e) {}
    var score = 0;
    if (fgVal <= 25) score += 3;
    else if (fgVal <= 45) score += 1;
    else if (fgVal >= 75) score -= 2;
    else if (fgVal >= 60) score -= 1;
    if (btcFR < -0.0003) score += 2;
    else if (btcFR > 0.0005) score -= 2;
    var bias, biasLabel, biasColor, recommendation;
    if (score >= 4) { bias='BULL'; biasLabel='BULLISH'; biasColor='green'; recommendation='Bias bullish. Prioritaskan long setup dengan konfirmasi volume.'; }
    else if (score >= 2) { bias='MILD_BULL'; biasLabel='MILD BULL'; biasColor='amber'; recommendation='Mild bullish. Selective entry saja. Sizing 50-70%.'; }
    else if (score <= -4) { bias='BEAR'; biasLabel='BEARISH'; biasColor='red'; recommendation='Bias bearish. Kurangi exposure. Hanya oversold RSI<25.'; }
    else if (score <= -2) { bias='MILD_BEAR'; biasLabel='MILD BEAR'; biasColor='amber'; recommendation='Mild bearish. Sizing 30-50%. DCA slow.'; }
    else { bias='NEUTRAL'; biasLabel='NEUTRAL'; biasColor='amber'; recommendation='Market transisi. DCA spot di discount zone.'; }
    var frPct = parseFloat((btcFR * 100).toFixed(4));
    var details = [];
    details.push('F&G ' + fgVal + ' (' + fgClass + ')');
    details.push('FR ' + (frPct >= 0 ? '+' : '') + frPct + '%' + (btcFR < -0.0003 ? ' Squeeze' : btcFR > 0.0005 ? ' Overheated' : ''));
    if (btcPrice > 0) details.push('BTC $' + btcPrice.toLocaleString());
    if (btcOI > 0) details.push('OI $' + (btcOI/1e9).toFixed(1) + 'B');
    var jd = Date.now()/86400000 + 2440587.5;
    var dm = ((jd - 2460320.5) % 29.53058867 + 29.53058867) % 29.53058867;
    var mp = 'Dark Moon', me = 'moon';
    if (dm < 1.5) { mp = 'New Moon'; me = 'new-moon'; }
    else if (dm < 8.5) { mp = 'First Quarter'; me = 'first-quarter'; }
    else if (dm < 16) { mp = 'Full Moon'; me = 'full-moon'; }
    else if (dm < 22) { mp = 'Waning'; me = 'waning'; }
    else { mp = 'Waning Crescent'; me = 'waning-crescent'; }
    var ds = Math.floor((Date.now() - 1713571200000) / 86400000);
    return res.status(200).json({
      ok: true, version: 'v18', ts: Date.now(), elapsed: Date.now() - t0,
      bias: bias, biasLabel: biasLabel, biasColor: biasColor,
      recommendation: recommendation, totalScore: score, details: details,
      fgValue: fgVal, fgClass: fgClass,
      btcPrice: btcPrice || null, btcChange: 0,
      btcTrend: score >= 2 ? 'BULLISH' : score <= -2 ? 'BEARISH' : 'SIDEWAYS',
      btcFR: frPct, btcLS: null, btcDom: null, mcapChg24h: 0,
      astro: {
        moonPhase: mp, moonEmoji: me,
        halvingPhase: ds < 240 ? 'Bull Cycle' : 'Late Cycle',
        chaotic: mp === 'Full Moon' || mp === 'New Moon',
        daysSinceHalving: ds
      }
    });
  } catch(e) {
    return res.status(200).json(Object.assign({}, defaults, { error: String(e.message || e), ts: Date.now(), elapsed: Date.now() - t0 }));
  }
}
