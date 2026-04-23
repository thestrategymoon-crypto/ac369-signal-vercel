// api/macro.js - AC369 FUSION Macro & On-Chain Data
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'max-age=0, s-maxage=120');

  try {
    const [fg, dom, mvrv, altSeason] = await Promise.allSettled([
      fetchFearGreed(),
      fetchBTCDominance(),
      fetchMVRVZScore(),
      fetchAltcoinSeason()
    ]);

    const result = {
      timestamp: new Date().toISOString(),
      fearGreed: getValue(fg, { error: 'Unavailable' }),
      btcDominance: getValue(dom, { error: 'Unavailable' }),
      mvrvZScore: getValue(mvrv, { error: 'Unavailable' }),
      altcoinSeason: getValue(altSeason, { error: 'Unavailable' }),
      cycleSummary: generateCycleSummary(getValue(fg,{}), getValue(mvrv,{}), getValue(dom,{}))
    };

    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

function getValue(p, fb) { return p.status === 'fulfilled' ? p.value : fb; }

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

async function fetchMVRVZScore() {
  try {
    const res = await fetch('https://community-api.coinmetrics.io/v4/timeseries/asset-metrics?assets=btc&metrics=CapMVRVCur&frequency=1d&page_size=1');
    const data = await res.json();
    const val = parseFloat(data.data[0].CapMVRVCur.values[0]);
    let zone = val > 3.5 ? 'Zona Puncak' : val < 1.0 ? 'Zona Dasar' : 'Zona Netral';
    return { value: val.toFixed(2), zone, interpretation: val < 1.2 ? '🔥 Akumulasi jangka panjang' : val > 3 ? '⚠️ Risiko tinggi' : '📈 Tren sehat' };
  } catch { return { value: 'N/A', zone: 'Data tidak tersedia' }; }
}

async function fetchAltcoinSeason() {
  try {
    const res = await fetch('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1');
    const coins = await res.json();
    const btc = coins.find(c => c.symbol === 'btc');
    const btcChange = btc.price_change_percentage_24h || 0;
    let count = 0;
    coins.slice(0,100).forEach(c => { if (c.symbol !== 'btc' && c.price_change_percentage_24h > btcChange) count++; });
    const index = Math.round((count / 75) * 100);
    let season = index > 75 ? '🌕 Altcoin Season' : index < 25 ? '₿ Bitcoin Season' : '⚖️ Transisi';
    return { index: Math.min(100, index), season, outperformingCount: count };
  } catch { return { error: 'Gagal fetch' }; }
}

function generateCycleSummary(fg, mvrv, dom) {
  const parts = [];
  if (fg.value < 30) parts.push('Sentimen Extreme Fear (baik untuk akumulasi)');
  else if (fg.value > 70) parts.push('Sentimen Extreme Greed (waspada koreksi)');
  if (mvrv.zone?.includes('Dasar')) parts.push('MVRV Z-Score menunjukkan pasar undervalued');
  else if (mvrv.zone?.includes('Puncak')) parts.push('MVRV Z-Score menunjukkan pasar overvalued');
  if (dom.dominance) {
    const d = parseFloat(dom.dominance);
    if (d > 60) parts.push('BTC Dominance tinggi, fokus Bitcoin');
    else if (d < 45) parts.push('BTC Dominance rendah, Altcoin Season potensial');
  }
  return parts.length ? parts.join('. ') + '.' : 'Pasar dalam fase transisi.';
}
