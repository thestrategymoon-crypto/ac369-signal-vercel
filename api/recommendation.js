// api/recommendation.js - disederhanakan
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const analyticsRes = await fetch(`https://${req.headers.host}/api/analytics`).then(r => r.json());
    const btc = analyticsRes.btc;
    const eth = analyticsRes.eth;

    const buildRec = (asset) => ({
      price: asset.currentPrice,
      probabilityScore: asset.probabilityScore,
      confluenceSignal: asset.confluenceSignal,
      action: asset.confluenceSignal.includes('Buy') ? 'BUY' : (asset.confluenceSignal.includes('Sell') ? 'SELL' : 'HOLD'),
      keyLevels: { support: (parseFloat(asset.currentPrice)*0.95).toFixed(2), resistance: (parseFloat(asset.currentPrice)*1.05).toFixed(2) },
      reasoning: [asset.technicalSummary]
    });

    res.status(200).json({
      btc: buildRec(btc),
      eth: buildRec(eth),
      tradingPlan: { daily: [], swing: [], watchlist: [] },
      marketNarrative: analyticsRes.smartMoneyNarrative
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
