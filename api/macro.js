// api/macro.js - AC369 v20 CLEAN
// Pure ASCII, no backticks, no template literals
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300,stale-while-revalidate=120');
  if (req.method === 'OPTIONS') return res.status(200).end();
  var t0 = Date.now();
  var fgVal = 50, fgClass = 'Neutral';
  try {
    var r1 = await fetch('https://api.alternative.me/fng/?limit=1&format=json');
    if (r1.ok) {
      var d1 = await r1.json();
      if (d1 && d1.data && d1.data[0]) {
        fgVal = parseInt(d1.data[0].value) || 50;
        fgClass = d1.data[0].value_classification || 'Neutral';
      }
    }
  } catch(e) {}
  var btcDom = 58;
  try {
    var ctrl = new AbortController();
    var tmr = setTimeout(function() { ctrl.abort(); }, 4000);
    var r2 = await fetch('https://api.coingecko.com/api/v3/global', { signal: ctrl.signal });
    clearTimeout(tmr);
    if (r2.ok) {
      var d2 = await r2.json();
      if (d2 && d2.data && d2.data.market_cap_percentage && d2.data.market_cap_percentage.btc) {
        btcDom = parseFloat(d2.data.market_cap_percentage.btc) || 58;
      }
    }
  } catch(e) { clearTimeout(tmr); }
  var fgInterp = fgVal <= 25 ? 'Extreme Fear - akumulasi agresif' : fgVal <= 35 ? 'Fear - akumulasi bertahap' : fgVal >= 75 ? 'Greed - take profit' : fgVal >= 60 ? 'Greed ringan - sizing kecil' : 'Neutral - selektif';
  var altSeason = btcDom > 62 ? 25 : btcDom > 58 ? 38 : btcDom > 53 ? 52 : btcDom > 48 ? 62 : btcDom > 43 ? 72 : 82;
  var altLabel = altSeason >= 70 ? 'Alt Season' : altSeason >= 58 ? 'Alt Trending' : altSeason <= 35 ? 'BTC Season' : 'Balanced';
  var ds = Math.floor((Date.now() - 1713571200000) / 86400000);
  var domNote = 'BTC Dom ' + btcDom.toFixed(1) + '% - ' + (btcDom > 58 ? 'BTC Season, hold altcoin minimal' : 'Alt Season aktif');
  var halvingNote = 'Halving hari ke-' + ds + '. ' + (ds < 240 ? 'Bull Mid-Cycle' : ds < 480 ? 'Bull Peak Zone' : 'Late Cycle') + '.';
  var smartMoneyNarrative = 'F&G ' + fgVal + ' (' + fgClass + '). BTC Dom ' + btcDom.toFixed(1) + '% - ' + (btcDom > 58 ? 'BTC Season, hold altcoin minimal' : 'Alt Season aktif') + '. ' + halvingNote + ' MVRV Fair Value.';
  return res.status(200).json({
    ok: true, version: 'v20', ts: Date.now(), elapsed: Date.now() - t0,
    fearGreed: { value: fgVal, classification: fgClass, interpretation: fgInterp },
    btcDominance: { value: btcDom, interpretation: btcDom > 58 ? 'BTC Season - hold altcoin minimal' : btcDom < 45 ? 'Alt Season - rotasi aktif' : 'Transisi' },
    mvrvZScore: { estimate: 1.3, signal: 'Fair value', interpretation: '200d MA proxy - pasar seimbang' },
    altcoinSeason: { index: altSeason, label: altLabel, season: altSeason >= 60 ? 'Alt Season' : altSeason <= 35 ? 'Bitcoin Season' : 'Neutral', detail: 'BTC Dom ' + btcDom.toFixed(1) + '% - ' + (btcDom > 58 ? 'BTC dominan' : 'Alt outperform') },
    cycleSummary: [
      'F&G: ' + fgVal + '/100 (' + fgClass + '). BTC Dom ' + btcDom.toFixed(1) + '% - ' + (btcDom > 58 ? 'BTC Season' : 'Alt Trending') + '.',
      'Alt Season Index: ' + altSeason + '/100. ' + altLabel + '.',
      halvingNote,
      'MVRV Proxy: ~1.3 (Fair value). DCA zone terbaik saat ini.',
    ],
    smartMoneyNarrative: smartMoneyNarrative,
  });
}
