// api/bias.js - AC369 FUSION v12.1 (Daily Market Bias Real-Time)
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  res.setHeader('Cache-Control', 's-maxage=60');

  const sf = async (url, ms = 8000) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
      const r = await fetch(url, {
        signal: ctrl.signal,
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }
      });
      clearTimeout(t);
      if (!r.ok) return null;
      return await r.json();
    } catch { clearTimeout(t); return null; }
  };

  try {
    // Fetch Fear & Greed, Global Data, Altcoin Season secara paralel
    const [fgData, globalData, altSeasonData, mvrvData] = await Promise.all([
      sf('https://api.alternative.me/fng/?limit=1'),
      sf('https://api.coingecko.com/api/v3/global'),
      sf('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&price_change_percentage=90d'),
      sf('https://community-api.coinmetrics.io/v4/timeseries/asset-metrics?assets=btc&metrics=CapMVRVCur&frequency=1d&page_size=1')
    ]);

    // Fear & Greed
    const fgValue = fgData?.data?.[0]?.value ? parseInt(fgData.data[0].value) : null;
    let fgClass = '—';
    if (fgValue !== null) {
      if (fgValue <= 25) fgClass = 'Extreme Fear';
      else if (fgValue <= 45) fgClass = 'Fear';
      else if (fgValue <= 55) fgClass = 'Neutral';
      else if (fgValue <= 75) fgClass = 'Greed';
      else fgClass = 'Extreme Greed';
    }

    // BTC Dominance
    const btcDom = globalData?.data?.market_cap_percentage?.btc
      ? parseFloat(globalData.data.market_cap_percentage.btc).toFixed(2) + '%'
      : '—';

    // Altcoin Season Index
    let altIndex = '—';
    if (altSeasonData && Array.isArray(altSeasonData)) {
      const btc = altSeasonData.find(c => c.symbol === 'btc');
      const btcChange = btc?.price_change_percentage_90d || 0;
      let count = 0;
      altSeasonData.slice(0, 100).forEach(c => {
        if (c.symbol !== 'btc' && (c.price_change_percentage_90d || 0) > btcChange) count++;
      });
      altIndex = Math.round((count / 75) * 100);
    }

    // MVRV Z-Score
    let mvrv = '—';
    if (mvrvData?.data?.[0]?.CapMVRVCur?.values?.length > 0) {
      const vals = mvrvData.data[0].CapMVRVCur.values;
      mvrv = parseFloat(vals[vals.length - 1]).toFixed(2);
    }

    // Tentukan bias
    let bias = 'NEUTRAL';
    let biasDesc = 'Selektif – ikuti setup terbaik.';
    if (fgValue !== null && btcDom !== '—') {
      const dom = parseFloat(btcDom);
      if (fgValue > 60 && dom > 58) {
        bias = 'BULLISH';
        biasDesc = 'Sentimen bullish, BTC dominan – akumulasi.';
      } else if (fgValue < 35 && dom < 45) {
        bias = 'BEARISH';
        biasDesc = 'Fear tinggi, Altcoin unggul – defensive.';
      } else if (fgValue > 70) {
        bias = 'BULLISH';
        biasDesc = 'Extreme Greed – waspada koreksi.';
      } else if (fgValue < 25) {
        bias = 'BEARISH';
        biasDesc = 'Extreme Fear – peluang akumulasi jangka panjang.';
      }
    }

    res.status(200).json({
      bias,
      biasDescription: biasDesc,
      fearGreed: fgValue || '—',
      fearGreedClass: fgClass,
      btcDominance: btcDom,
      altcoinSeason: altIndex !== '—' ? altIndex + '/100' : '—',
      mvrv: mvrv,
      timestamp: new Date().toISOString()
    });
  } catch (e) {
    res.status(200).json({
      bias: 'NEUTRAL',
      biasDescription: 'Data tertunda – tunggu refresh.',
      fearGreed: '—',
      fearGreedClass: '—',
      btcDominance: '—',
      altcoinSeason: '—',
      mvrv: '—'
    });
  }
}
