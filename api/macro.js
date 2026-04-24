// api/macro.js - AC369 FUSION (Altcoin Season Index Akurat)
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'max-age=0, s-maxage=120');

  try {
    const [fg, dom, mvrv, alt] = await Promise.allSettled([
      fetchFearGreed(), fetchDominance(), fetchMVRV(), fetchAltcoinSeason()
    ]);

    res.status(200).json({
      timestamp: new Date().toISOString(),
      fearGreed: get(fg, { value: '—', classification: '—' }),
      btcDominance: get(dom, { dominance: '—', interpretation: '—' }),
      mvrvZScore: get(mvrv, { value: 'N/A', zone: 'N/A', interpretation: 'Data tidak tersedia' }),
      altcoinSeason: get(alt, { index: '—', season: '—', note: '—' }),
      cycleSummary: buildSummary(get(fg, {}), get(alt, {}), get(dom, {}))
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

function get(p, fb) { return p.status === 'fulfilled' ? p.value : fb; }

async function fetchFearGreed() {
  const r = await fetch('https://api.alternative.me/fng/?limit=1');
  const d = await r.json();
  const v = parseInt(d.data[0].value);
  let c = v <= 25 ? 'Extreme Fear (Peluang Beli)' : v <= 45 ? 'Fear (Waspada)' : v <= 55 ? 'Neutral' : v <= 75 ? 'Greed (Hati-hati)' : 'Extreme Greed (Potensi Koreksi)';
  return { value: v, classification: c };
}

async function fetchDominance() {
  const r = await fetch('https://api.coingecko.com/api/v3/global');
  const d = await r.json();
  const btc = d.data.market_cap_percentage.btc;
  return { dominance: btc.toFixed(2) + '%', interpretation: btc > 55 ? 'BTC Dominan' : btc < 45 ? 'Altcoin Season potensial' : 'Seimbang' };
}

async function fetchMVRV() {
  try {
    const r = await fetch('https://community-api.coinmetrics.io/v4/timeseries/asset-metrics?assets=btc&metrics=CapMVRVCur&frequency=1d&page_size=1');
    const d = await r.json();
    const v = parseFloat(d.data[0].CapMVRVCur.values[0]);
    return { value: v.toFixed(2), zone: v > 3.5 ? 'Zona Puncak' : v < 1.0 ? 'Zona Dasar' : 'Zona Netral', interpretation: v < 1.2 ? 'Undervalued' : v > 3 ? 'Overvalued' : 'Netral' };
  } catch (e) { return { value: 'N/A', zone: 'N/A', interpretation: 'Data tidak tersedia' }; }
}

async function fetchAltcoinSeason() {
  try {
    // Ambil data 90 hari dari CoinGecko
    const r = await fetch('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&price_change_percentage=90d');
    const coins = await r.json();
    const btc = coins.find(c => c.symbol === 'btc');
    const btcChange = btc?.price_change_percentage_90d || 0;
    let count = 0;
    coins.slice(0, 100).forEach(c => {
      if (c.symbol !== 'btc' && (c.price_change_percentage_90d || 0) > btcChange) count++;
    });
    const index = Math.round((count / 75) * 100);
    const season = index >= 75 ? '🌕 Altcoin Season' : index >= 50 ? '⚖️ Transisi ke Altcoin' : '₿ Bitcoin Season';
    return { index: Math.min(100, index), season, note: `${count} dari 100 altcoin ungguli BTC dalam 90 hari` };
  } catch (e) {
    return { index: '—', season: '—', note: 'Gagal fetch' };
  }
}

function buildSummary(fg, alt, dom) {
  const parts = [];
  if (fg.value < 30) parts.push('Sentimen Extreme Fear.');
  else if (fg.value > 70) parts.push('Sentimen Extreme Greed.');
  if (alt.index >= 75) parts.push(`${alt.season}: ${alt.note}`);
  else if (alt.index > 0) parts.push(`Altcoin Season Index: ${alt.index}/100.`);
  if (dom.dominance) {
    const d = parseFloat(dom.dominance);
    if (d > 60) parts.push('BTC Dominance tinggi.');
  }
  return parts.join(' ') || 'Pasar dalam fase transisi.';
}
