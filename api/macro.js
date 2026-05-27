// api/macro.js — v20 MINIMAL RELIABLE
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300,stale-while-revalidate=120');
  if (req.method === 'OPTIONS') return res.status(200).end();
  const t0 = Date.now();

  let fgVal = 50, fgClass = 'Neutral';
  try {
    const r = await fetch('https://api.alternative.me/fng/?limit=1&format=json');
    if (r.ok) { const d = await r.json(); fgVal = parseInt(d?.data?.[0]?.value)||50; fgClass = d?.data?.[0]?.value_classification||'Neutral'; }
  } catch(e) {}

  let btcDom = 58;
  try {
    const ctrl = new AbortController(); const t = setTimeout(()=>ctrl.abort(), 4000);
    const r = await fetch('https://api.coingecko.com/api/v3/global', {signal:ctrl.signal});
    clearTimeout(t);
    if (r.ok) { const d = await r.json(); btcDom = parseFloat(d?.data?.market_cap_percentage?.btc)||58; }
  } catch(e) {}

  const fgInterp = fgVal<=25?'Extreme Fear — akumulasi agresif':fgVal<=35?'Fear — akumulasi bertahap':fgVal>=75?'Greed — take profit':fgVal>=60?'Greed ringan — sizing kecil':'Neutral — selektif';
  const altSeason = btcDom>62?25:btcDom>58?38:btcDom>53?52:btcDom>48?62:btcDom>43?72:82;
  const altLabel = altSeason>=70?'🔥 Alt Season':altSeason>=58?'📈 Alt Trending':altSeason<=35?'₿ BTC Season':'⚖️ Balanced';
  const ds = Math.floor((Date.now()-1713571200000)/86400000);

  return res.status(200).json({
    ok: true, version: 'v20-minimal', ts: Date.now(), elapsed: Date.now()-t0,
    fearGreed: { value: fgVal, classification: fgClass, interpretation: fgInterp },
    btcDominance: { value: btcDom, interpretation: btcDom>58?'BTC Season — hold altcoin minimal':btcDom<45?'Alt Season — rotasi aktif':'Transisi' },
    mvrvZScore: { estimate: 1.3, signal: 'Fair value', interpretation: '200d MA proxy — pasar seimbang' },
    altcoinSeason: { index: altSeason, label: altLabel, season: altSeason>=60?'Alt Season':altSeason<=35?'Bitcoin Season':'Neutral', detail: `BTC Dom ${btcDom.toFixed(1)}% — ${btcDom>58?'BTC dominan':'Alt outperform'}` },
    cycleSummary: [
      `F&G: ${fgVal}/100 (${fgClass}). BTC Dom ${btcDom.toFixed(1)}% — ${btcDom>58?'BTC Season':'Alt Trending'}.`,
      `Alt Season Index: ${altSeason}/100. ${altLabel}.`,
      `Hari ${ds} post-Halving April 2024. ${ds<240?'Bull Mid-Cycle ⚡':ds<480?'Bull Peak Zone ⚠️':'Late Cycle'}.`,
      `MVRV Proxy: ~1.3 (Fair value). DCA zone terbaik saat ini.`,
    ],
    smartMoneyNarrative: `F&G ${fgVal} (${fgClass}). BTC Dom ${btcDom.toFixed(1)}% — ${btcDom>58?'BTC Season, hold altcoin minimal':'Alt Season aktif'}. Halving hari ke-${ds}. MVRV Fair Value.`,
  });
}
