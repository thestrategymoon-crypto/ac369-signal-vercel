// api/recommendation.js — AC369 FUSION v10.2
// FIXED: Baca data.btc dan data.eth dari analytics v10.2
// FIXED: keyLevels dari real support/resistance, bukan estimasi 5%

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const base = `https://${req.headers.host}`;

    // Fetch analytics yang sudah return {btc:{}, eth:{}}
    const analyticsRes = await fetch(`${base}/api/analytics`, {
      signal: AbortSignal.timeout(20000),
    });
    const analyticsData = await analyticsRes.json();

    // analytics.js v10.2 returns: { btc: {...}, eth: {...}, smartMoneyNarrative, timestamp }
    const btcData = analyticsData.btc || {};
    const ethData = analyticsData.eth || {};

    const buildRecommendation = (asset) => {
      const price = parseFloat(asset.currentPrice || 0);
      const score = asset.probabilityScore || 50;
      const signal = asset.confluenceSignal || 'Neutral';
      const trends = asset.trends || {};
      const keyLevels = asset.keyLevels || {};
      const bb = asset.bb || {};
      const atr = asset.atr || {};
      const macd = asset.macd || {};
      const rsi = asset.rsi || {};

      let action = 'HOLD';
      if (signal.includes('Buy')) action = 'BUY';
      else if (signal.includes('Sell')) action = 'SELL';

      // Generate detailed reasoning
      const reasoning = [];
      if (asset.technicalSummary) reasoning.push(asset.technicalSummary);
      if (trends.overall === 'BULLISH') reasoning.push('Multi-timeframe trend bullish — 1H, 4H, 1D aligned.');
      else if (trends.overall === 'BEARISH') reasoning.push('Multi-timeframe trend bearish — tekanan jual dominan.');
      if (rsi['4h'] && rsi['4h'] < 35) reasoning.push(`RSI 4H oversold (${rsi['4h']}) — potensi reversal kuat.`);
      if (rsi['4h'] && rsi['4h'] > 70) reasoning.push(`RSI 4H overbought (${rsi['4h']}) — waspada koreksi.`);
      if (macd['4h']?.crossUp) reasoning.push('MACD 4H cross up — momentum bullish baru dimulai.');
      if (macd['4h']?.crossDown) reasoning.push('MACD 4H cross down — momentum bearish dimulai.');
      if (bb['4h']?.width < 3) reasoning.push(`BB squeeze (${bb['4h'].width}%) — ekspansi volatilitas imminent.`);

      // ATR-based SL/TP suggestions
      const atr4h = atr['4h'] || price * 0.02;
      const slLong = parseFloat((price - atr4h * 1.5).toFixed(6));
      const tp1Long = parseFloat((price + atr4h * 2.0).toFixed(6));
      const tp2Long = parseFloat((price + atr4h * 3.5).toFixed(6));
      const slShort = parseFloat((price + atr4h * 1.5).toFixed(6));
      const tp1Short = parseFloat((price - atr4h * 2.0).toFixed(6));

      return {
        price: price.toFixed(4),
        currentPrice: price,
        probabilityScore: score,
        confluenceSignal: signal,
        action,
        overallTrend: trends.overall || 'NEUTRAL',
        trends: {
          '1h': trends['1h'] || 'NEUTRAL',
          '4h': trends['4h'] || 'NEUTRAL',
          '1d': trends['1d'] || 'NEUTRAL',
        },
        keyLevels: {
          support: keyLevels.support || parseFloat((price * 0.95).toFixed(4)),
          resistance: keyLevels.resistance || parseFloat((price * 1.05).toFixed(4)),
          supportLevels: keyLevels.supportLevels || [],
          resistanceLevels: keyLevels.resistanceLevels || [],
        },
        tradeSetup: action === 'BUY' ? {
          entry: parseFloat(price.toFixed(4)),
          sl: slLong,
          tp1: tp1Long,
          tp2: tp2Long,
          rr: parseFloat(((tp1Long - price) / (price - slLong)).toFixed(2)),
          slPct: parseFloat(((price - slLong) / price * 100).toFixed(2)),
          tp1Pct: parseFloat(((tp1Long - price) / price * 100).toFixed(2)),
        } : action === 'SELL' ? {
          entry: parseFloat(price.toFixed(4)),
          sl: slShort,
          tp1: tp1Short,
          rr: parseFloat(((price - tp1Short) / (slShort - price)).toFixed(2)),
          slPct: parseFloat(((slShort - price) / price * 100).toFixed(2)),
          tp1Pct: parseFloat(((price - tp1Short) / price * 100).toFixed(2)),
        } : null,
        indicators: {
          rsi1h: rsi['1h'] || 50,
          rsi4h: rsi['4h'] || 50,
          rsi1d: rsi['1d'] || 50,
          macd4hBullish: macd['4h']?.bullish || false,
          macd4hCrossUp: macd['4h']?.crossUp || false,
          bbSqueeze: bb['4h']?.width < 3,
          bbPosition: bb['4h']?.position || 50,
          atr4h: parseFloat((atr['4h'] || 0).toFixed(6)),
          fundingRate: asset.fundingRate || 0,
        },
        scoreBreakdown: asset.scoreBreakdown || { bull: 0, bear: 0, bullPct: 50 },
        maStatus: asset.maStatus || { position: 'N/A' },
        pivots: asset.pivots || null,
        reasoning: reasoning.slice(0, 5),
      };
    };

    const btcRec = buildRecommendation(btcData);
    const ethRec = buildRecommendation(ethData);

    // Generate trading plan
    const generateTradingPlan = (btcRec, ethRec) => {
      const daily = [];
      const swing = [];
      const watchlist = [];

      if (btcRec.action === 'BUY') {
        daily.push(`BTC LONG: Entry $${btcRec.price}, SL $${btcRec.tradeSetup?.sl || '—'}, TP1 $${btcRec.tradeSetup?.tp1 || '—'} (R:R ${btcRec.tradeSetup?.rr || '—'})`);
      } else if (btcRec.action === 'SELL') {
        daily.push(`BTC SHORT: Entry $${btcRec.price}, SL $${btcRec.tradeSetup?.sl || '—'}, TP1 $${btcRec.tradeSetup?.tp1 || '—'}`);
      }

      if (ethRec.action === 'BUY') {
        swing.push(`ETH LONG: Entry $${ethRec.price}, SL $${ethRec.tradeSetup?.sl || '—'}, TP1 $${ethRec.tradeSetup?.tp1 || '—'} (R:R ${ethRec.tradeSetup?.rr || '—'})`);
      }

      // Watchlist based on signals
      if (btcRec.indicators.rsi4h < 35) watchlist.push(`BTC: RSI oversold (${btcRec.indicators.rsi4h}) — monitor reversal`);
      if (ethRec.indicators.rsi4h < 35) watchlist.push(`ETH: RSI oversold (${ethRec.indicators.rsi4h}) — monitor reversal`);
      if (btcRec.indicators.bbSqueeze) watchlist.push(`BTC: BB squeeze — breakout imminent`);

      return { daily, swing, watchlist };
    };

    const tradingPlan = generateTradingPlan(btcRec, ethRec);

    res.setHeader('Cache-Control', 's-maxage=30');
    return res.status(200).json({
      btc: btcRec,
      eth: ethRec,
      tradingPlan,
      marketNarrative: analyticsData.smartMoneyNarrative || 'Pasar dalam kondisi normal.',
      timestamp: Date.now(),
    });

  } catch (e) {
    console.error('[Recommendation] Error:', e.message);
    // Fallback dengan data real dari Binance jika analytics gagal
    try {
      const [btcTicker, ethTicker] = await Promise.allSettled([
        fetch('https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=BTCUSDT').then(r => r.json()),
        fetch('https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=ETHUSDT').then(r => r.json()),
      ]);
      const btcPrice = btcTicker.status === 'fulfilled' ? parseFloat(btcTicker.value.lastPrice) : 77500;
      const ethPrice = ethTicker.status === 'fulfilled' ? parseFloat(ethTicker.value.lastPrice) : 2300;

      return res.status(200).json({
        btc: {
          price: btcPrice.toFixed(2), currentPrice: btcPrice,
          probabilityScore: 50, confluenceSignal: 'Neutral', action: 'HOLD',
          keyLevels: { support: parseFloat((btcPrice * 0.95).toFixed(2)), resistance: parseFloat((btcPrice * 1.05).toFixed(2)) },
          reasoning: ['Data analytics tidak tersedia — menampilkan fallback.'],
        },
        eth: {
          price: ethPrice.toFixed(2), currentPrice: ethPrice,
          probabilityScore: 50, confluenceSignal: 'Neutral', action: 'HOLD',
          keyLevels: { support: parseFloat((ethPrice * 0.95).toFixed(2)), resistance: parseFloat((ethPrice * 1.05).toFixed(2)) },
          reasoning: ['Data analytics tidak tersedia — menampilkan fallback.'],
        },
        tradingPlan: { daily: [], swing: [], watchlist: [] },
        marketNarrative: 'Data pasar sementara tidak tersedia. Coba refresh.',
        error: e.message,
      });
    } catch (fallbackErr) {
      return res.status(200).json({
        btc: { price: '77500', probabilityScore: 50, confluenceSignal: 'Neutral', action: 'HOLD', keyLevels: { support: '73625', resistance: '81375' }, reasoning: ['Data offline'] },
        eth: { price: '2300', probabilityScore: 50, confluenceSignal: 'Neutral', action: 'HOLD', keyLevels: { support: '2185', resistance: '2415' }, reasoning: ['Data offline'] },
        tradingPlan: { daily: [], swing: [], watchlist: [] },
        marketNarrative: 'Data pasar offline.',
      });
    }
  }
}
