// api/macro.js - AC369 FUSION (Altcoin Season Detail)
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'max-age=0, s-maxage=120');
  try {
    const [fg, dom, mvrv, altSeason] = await Promise.allSettled([fetchFearGreed(), fetchBTCDominance(), fetchMVRV(), fetchAltcoinSeason()]);
    res.status(200).json({
      timestamp: new Date().toISOString(),
      fearGreed: fg.status === 'fulfilled' ? fg.value : { value: '—', classification: '—' },
      btcDominance: dom.status === 'fulfilled' ? dom.value : { dominance: '—', interpretation: '—' },
      mvrvZScore: mvrv.status === 'fulfilled' ? mvrv.value : { value: '—', zone: '—', interpretation: '—' },
      altcoinSeason: altSeason.status === 'fulfilled' ? altSeason.value : { index: '—', season: '—', note: '—' },
      cycleSummary: generateSummary(fg.status === 'fulfilled' ? fg.value : {}, altSeason.status === 'fulfilled' ? altSeason.value : {})
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

async function fetchFearGreed() {
  const res = await fetch('https://api.alternative.me/fng/?limit=1');
  const data = await res.json();
  const val = parseInt(data.data[0].value);
  let cls = '';
  if (val <= 25) cls = 'Extreme Fear (Peluang Beli)';
  else if (val <= 45) cls = 'Fear (Waspada)';
  else if (val <= 55) cls = 'Neutral';
  else if (val <= 75) cls = 'Greed (Hati-hati)';
  else cls = 'Extreme Greed (Potensi Koreksi)';
  return { value: val, classification: cls };
}

async function fetchBTCDominance() {
  const res = await fetch('https://api.coingecko.com/api/v3/global');
  const data = await res.json();
  const dom = data.data.market_cap_percentage.btc;
  return { dominance: dom.toFixed(2) + '%', interpretation: dom > 55 ? 'BTC Dominan' : dom < 45 ? 'Altcoin Season potensial' : 'Seimbang' };
}

async function fetchMVRV() {
  try {
    const res = await fetch('https://community-api.coinmetrics.io/v4/timeseries/asset-metrics?assets=btc&metrics=CapMVRVCur&frequency=1d&page_size=1');
    const data = await res.json();
    const val = parseFloat(data.data[0].CapMVRVCur.values[0]);
    let zone = val > 3.5 ? 'Zona Puncak' : val < 1.0 ? 'Zona Dasar' : 'Zona Netral';
    return { value: val.toFixed(2), zone, interpretation: val < 1.2 ? 'Undervalued (Akumulasi)' : val > 3 ? 'Overvalued (Hati-hati)' : 'Netral' };
  } catch (e) { return { value: 'N/A', zone: 'N/A', interpretation: 'Data tidak tersedia' }; }
}

async function fetchAltcoinSeason() {
  try {
    const res = await fetch('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&price_change_percentage=90d');
    const coins = await res.json();
    const btc = coins.find(c => c.symbol === 'btc');
    const btcChange = btc?.price_change_percentage_90d || 0;
    let count = 0;
    coins.slice(0, 100).forEach(c => {
      if (c.symbol !== 'btc' && (c.price_change_percentage_90d || 0) > btcChange) count++;
    });
    const index = Math.round((count / 75) * 100);
    let season = index >= 75 ? '🌕 Altcoin Season' : index >= 50 ? '⚖️ Transisi ke Altcoin' : '₿ Bitcoin Season';
    return { index: Math.min(100, index), season, note: `${count} dari top 100 altcoin mengungguli BTC dalam 90 hari` };
  } catch (e) { return { index: '—', season: '—', note: 'Gagal fetch' }; }
}

function generateSummary(fg, alt) {
  const parts = [];
  if (fg.value < 30) parts.push('Sentimen Extreme Fear.');
  else if (fg.value > 70) parts.push('Sentimen Extreme Greed.');
  if (alt.index >= 75) parts.push(`${alt.season}: ${alt.note}`);
  return parts.join(' ') || 'Pasar dalam fase transisi.';
}
