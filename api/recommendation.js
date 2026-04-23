// api/recommendation.js - AC369 FUSION Final
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const base = `https://${req.headers.host}`;
    const analyticRes = await fetch(`${base}/api/analytics`);
    const analyticData = await analyticRes.json();

    const build = (asset) => {
      const price = parseFloat(asset.currentPrice) || 0;
      const score = asset.probabilityScore || 50;
      const signal = asset.confluenceSignal || 'Neutral';
      let action = 'HOLD';
      if (signal.includes('Buy')) action = 'BUY';
      else if (signal.includes('Sell')) action = 'SELL';

      return {
        price: price.toFixed(2),
        probabilityScore: score,
        confluenceSignal: signal,
        action,
        keyLevels: {
          support: (price * 0.95).toFixed(2),
          resistance: (price * 1.05).toFixed(2)
        },
        reasoning: [asset.technicalSummary || 'Analisis teknikal.']
      };
    };

    res.status(200).json({
      btc: build(analyticData.btc),
      eth: build(analyticData.eth),
      tradingPlan: { daily: [], swing: [], watchlist: [] },
      marketNarrative: analyticData.smartMoneyNarrative || 'Pasar netral.'
    });
  } catch (e) {
    console.error('[Recommendation] Error:', e);
    res.status(200).json({
      btc: { price: '77500', probabilityScore: 50, confluenceSignal: 'Neutral', action: 'HOLD', keyLevels: {support:'73625',resistance:'81375'}, reasoning: ['Data offline'] },
      eth: { price: '2300', probabilityScore: 50, confluenceSignal: 'Neutral', action: 'HOLD', keyLevels: {support:'2185',resistance:'2415'}, reasoning: ['Data offline'] },
      tradingPlan: { daily: [], swing: [], watchlist: [] },
      marketNarrative: 'Data pasar offline.'
    });
  }
}
