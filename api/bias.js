// api/bias.js — MINIMAL RELIABLE (no dependencies that can fail)
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Default response — always returned even if all APIs fail
  const defaults = {
    ok: true, version: 'v18-minimal',
    bias: 'NEUTRAL', biasLabel: '⚖️ NEUTRAL', biasColor: 'amber',
    recommendation: 'Market transisi. DCA spot di discount zone. Setup swing: convergence ≥70.',
    totalScore: 0, details: [], fgValue: 50, fgClass: 'Neutral',
    btcPrice: null, btcChange: 0, btcTrend: 'SIDEWAYS', btcRSI: null,
    btcFR: 0, btcLS: null, btcLongPct: null, btcShortPct: null,
    btcDom: null, mcapChg24h: 0,
    astro: { moonPhase: 'Waxing Gibbous', moonEmoji: '🌔', halvingPhase: 'Bull Cycle', chaotic: false },
    ts: Date.now(), elapsed: 0
  };

  try {
    // ONE simple Bybit call — no timeout complexity
    const ctrl = new AbortController();
    const tmr = setTimeout(() => ctrl.abort(), 5000);
    
    let btcPrice = 0, btcFR = 0, btcOI = 0;
    try {
      const r = await fetch(
        'https://api.bybit.com/v5/market/tickers?category=linear&symbol=BTCUSDT',
        { signal: ctrl.signal, headers: { 'User-Agent': 'AC369/18' } }
      );
      clearTimeout(tmr);
      if (r.ok) {
        const d = await r.json();
        const t = d?.result?.list?.[0];
        if (t) {
          btcPrice = parseFloat(t.lastPrice) || 0;
          btcFR = parseFloat(t.fundingRate) || 0;
          btcOI = parseFloat(t.openInterestValue) || 0;
        }
      }
    } catch(e) { clearTimeout(tmr); }

    // ONE alt.me call for FG
    let fgVal = 50, fgClass = 'Neutral';
    try {
      const r2 = await fetch('https://api.alternative.me/fng/?limit=1&format=json');
      if (r2.ok) {
        const d2 = await r2.json();
        fgVal = parseInt(d2?.data?.[0]?.value) || 50;
        fgClass = d2?.data?.[0]?.value_classification || 'Neutral';
      }
    } catch(e) {}

    // Simple bias calculation
    let score = 0;
    if (fgVal <= 25) score += 3; else if (fgVal <= 45) score += 1;
    else if (fgVal >= 75) score -= 2; else if (fgVal >= 60) score -= 1;
    if (btcFR < -0.0003) score += 2; else if (btcFR > 0.0005) score -= 2;

    let bias, biasLabel, biasColor, recommendation;
    if (score >= 4) { bias='BULL'; biasLabel='📈 BULLISH'; biasColor='green'; recommendation='Bias bullish. Prioritaskan long setup dengan konfirmasi volume.'; }
    else if (score >= 2) { bias='MILD_BULL'; biasLabel='↗️ MILD BULL'; biasColor='amber'; recommendation='Mild bullish. Selective entry saja. Sizing 50-70%.'; }
    else if (score <= -4) { bias='BEAR'; biasLabel='📉 BEARISH'; biasColor='red'; recommendation='Bias bearish. Kurangi exposure. Hanya oversold RSI<25.'; }
    else if (score <= -2) { bias='MILD_BEAR'; biasLabel='↘️ MILD BEAR'; biasColor='amber'; recommendation='Mild bearish. Sizing 30-50%. DCA slow.'; }
    else { bias='NEUTRAL'; biasLabel='⚖️ NEUTRAL'; biasColor='amber'; recommendation='Market transisi. DCA spot di discount zone.'; }

    const frPct = parseFloat((btcFR * 100).toFixed(4));
    const details = [
      `F&G ${fgVal} (${fgClass})`,
      `FR ${frPct >= 0 ? '+' : ''}${frPct}%${btcFR < -0.0003 ? ' Squeeze 🎯' : btcFR > 0.0005 ? ' Overheated ⚠️' : ''}`,
      btcPrice > 0 ? `BTC $${btcPrice.toLocaleString()}` : '',
      btcOI > 0 ? `OI $${(btcOI/1e9).toFixed(1)}B` : '',
    ].filter(Boolean);

    // Moon phase
    const jd = Date.now()/86400000+2440587.5;
    const dm = ((jd-2460320.5)%29.53058867+29.53058867)%29.53058867;
    const phases = [[1.5,'New Moon','🌑'],[8.5,'First Quarter','🌓'],[16,'Full Moon','🌕'],[22,'Waning','🌖'],[29.5,'Waning Crescent','🌘']];
    let mp='Dark Moon', me='🌑';
    for(const [lim,p,e] of phases) if(dm<lim){mp=p;me=e;break;}
    const ds = Math.floor((Date.now()-1713571200000)/86400000);

    return res.status(200).json({
      ok: true, version: 'v18-minimal', ts: Date.now(), elapsed: Date.now() - (req._startTime||Date.now()),
      bias, biasLabel, biasColor, recommendation, totalScore: score, details,
      fgValue: fgVal, fgClass,
      btcPrice: btcPrice || null, btcChange: 0, btcTrend: score>=2?'BULLISH':score<=-2?'BEARISH':'SIDEWAYS',
      btcFR: frPct, btcLS: null, btcDom: null, mcapChg24h: 0,
      astro: { moonPhase: mp, moonEmoji: me, halvingPhase: ds<240?'Bull Cycle 🔥':'Late Cycle', chaotic: mp==='Full Moon'||mp==='New Moon', daysSinceHalving: ds }
    });

  } catch(e) {
    return res.status(200).json({ ...defaults, error: e.message, ts: Date.now() });
  }
}
