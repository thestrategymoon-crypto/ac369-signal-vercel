// api/recommendation.js - Mesin Rekomendasi Harian AC369 FUSION
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'max-age=0, s-maxage=120');

  try {
    // Panggil endpoint internal secara paralel
    const [analyticsRes, macroRes, scannerRes] = await Promise.allSettled([
      fetch(`${getBaseUrl(req)}/api/analytics`).then(r => r.json()),
      fetch(`${getBaseUrl(req)}/api/macro`).then(r => r.json()),
      fetch(`${getBaseUrl(req)}/api/scanner`).then(r => r.json())
    ]);

    const analytics = getValue(analyticsRes, {});
    const macro = getValue(macroRes, {});
    const scanner = getValue(scannerRes, {});

    // Bentuk rekomendasi
    const recommendation = {
      timestamp: new Date().toISOString(),
      btc: buildBTCAnalysis(analytics.btc, macro),
      eth: buildETHAnalysis(analytics.eth, macro),
      altcoins: {
        dailyPicks: scanner.dailyOpportunities || [],
        swingPicks: scanner.swingOpportunities || [],
        rsiAlerts: scanner.rsiAlerts || []
      },
      marketNarrative: buildMarketNarrative(analytics, macro, scanner),
      tradingPlan: buildTradingPlan(analytics, macro, scanner)
    };

    res.status(200).json(recommendation);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

function getBaseUrl(req) {
  const host = req.headers.host;
  const protocol = host.includes('localhost') ? 'http' : 'https';
  return `${protocol}://${host}`;
}

function getValue(promise, fallback) {
  return promise.status === 'fulfilled' ? promise.value : fallback;
}

function buildBTCAnalysis(btc, macro) {
  if (!btc) return { error: 'Data tidak tersedia' };
  
  const sentiment = macro.fearGreed?.value || 50;
  const mvrvZone = macro.mvrvZScore?.zone || 'Netral';
  
  let action = 'HOLD';
  let reasoning = [];
  
  if (btc.confluenceSignal?.includes('Buy') && sentiment < 40 && mvrvZone.includes('Dasar')) {
    action = 'STRONG BUY';
    reasoning.push('Konfluensi sinyal beli kuat');
    reasoning.push('Sentimen pasar takut (Fear) - peluang akumulasi');
    reasoning.push('MVRV Z-Score menunjukkan pasar undervalued');
  } else if (btc.confluenceSignal?.includes('Buy') && btc.probabilityScore > 55) {
    action = 'BUY';
    reasoning.push(`Probabilitas bullish ${btc.probabilityScore}%`);
    reasoning.push('Beberapa indikator teknikal selaras');
  } else if (btc.confluenceSignal?.includes('Sell')) {
    action = 'SELL';
    reasoning.push('Sinyal jual terdeteksi, pertimbangkan take profit');
  }
  
  return {
    symbol: 'BTC',
    price: btc.currentPrice,
    probabilityScore: btc.probabilityScore,
    confluenceSignal: btc.confluenceSignal,
    action: action,
    reasoning: reasoning.length ? reasoning : ['Pasar sideways, tunggu konfirmasi'],
    keyLevels: {
      support: (parseFloat(btc.currentPrice) * 0.95).toFixed(2),
      resistance: (parseFloat(btc.currentPrice) * 1.05).toFixed(2)
    }
  };
}

function buildETHAnalysis(eth, macro) {
  // Mirip dengan buildBTCAnalysis
  if (!eth) return { error: 'Data tidak tersedia' };
  
  const sentiment = macro.fearGreed?.value || 50;
  
  let action = 'HOLD';
  let reasoning = [];
  
  if (eth.confluenceSignal?.includes('Buy') && eth.probabilityScore > 55) {
    action = 'BUY';
    reasoning.push(`Probabilitas bullish ${eth.probabilityScore}%`);
    reasoning.push('Konfluensi sinyal teknikal mendukung');
  } else if (eth.confluenceSignal?.includes('Sell')) {
    action = 'SELL';
    reasoning.push('Sinyal jual terdeteksi');
  }
  
  return {
    symbol: 'ETH',
    price: eth.currentPrice,
    probabilityScore: eth.probabilityScore,
    confluenceSignal: eth.confluenceSignal,
    action: action,
    reasoning: reasoning.length ? reasoning : ['Pasar sideways, pantau level support'],
    keyLevels: {
      support: (parseFloat(eth.currentPrice) * 0.95).toFixed(2),
      resistance: (parseFloat(eth.currentPrice) * 1.05).toFixed(2)
    }
  };
}

function buildMarketNarrative(analytics, macro, scanner) {
  const parts = [];
  
  // Narasi dari Smart Money
  if (analytics.smartMoneyNarrative) {
    parts.push(analytics.smartMoneyNarrative);
  }
  
  // Narasi dari Macro
  if (macro.fearGreed) {
    const fg = macro.fearGreed;
    if (fg.value < 30) parts.push(`Sentimen pasar Extreme Fear (${fg.value}) - kondisi ideal untuk akumulasi.`);
    else if (fg.value > 70) parts.push(`Sentimen pasar Extreme Greed (${fg.value}) - waspada potensi koreksi.`);
  }
  
  // Narasi dari Scanner
  if (scanner.swingOpportunities?.length > 3) {
    parts.push(`Terdeteksi ${scanner.swingOpportunities.length} altcoin dengan volume breakout >3x, sinyal kuat rotasi ke altcoin.`);
  }
  
  return parts.join(' ');
}

function buildTradingPlan(analytics, macro, scanner) {
  const plan = {
    daily: [],
    swing: [],
    watchlist: []
  };
  
  // Rencana Daily
  if (scanner.dailyOpportunities?.length) {
    scanner.dailyOpportunities.slice(0, 3).forEach(coin => {
      plan.daily.push({
        symbol: coin.symbol,
        entry: coin.price,
        target: (parseFloat(coin.price) * 1.05).toFixed(4),
        stopLoss: (parseFloat(coin.price) * 0.97).toFixed(4),
        rationale: `Momentum kuat (+${coin.change24h}), volume ${coin.volume24h}`
      });
    });
  }
  
  // Rencana Swing
  if (scanner.swingOpportunities?.length) {
    scanner.swingOpportunities.slice(0, 3).forEach(coin => {
      plan.swing.push({
        symbol: coin.symbol,
        entry: coin.price,
        target: (parseFloat(coin.price) * 1.10).toFixed(4),
        stopLoss: (parseFloat(coin.price) * 0.95).toFixed(4),
        rationale: `Volume breakout ${coin.volumeRatio}, strategi ${coin.strategy}`
      });
    });
  }
  
  // Watchlist (RSI Oversold)
  if (scanner.rsiAlerts?.length) {
    scanner.rsiAlerts.filter(r => r.condition.includes('Oversold')).slice(0, 3).forEach(coin => {
      plan.watchlist.push({
        symbol: coin.symbol,
        currentPrice: coin.price,
        rsi: coin.rsi,
        note: 'Pantau untuk potensi bounce'
      });
    });
  }
  
  return plan;
}
