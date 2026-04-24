// api/recommendation.js — AC369 FUSION v10.4
// FIXED: Direct Binance/CoinGecko price if analytics fails
// FIXED: keyLevels.support/resistance always has real value

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const ft = async (url, ms = 10000) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
      const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' } });
      clearTimeout(t); if (!r.ok) return null;
      return await r.json();
    } catch { clearTimeout(t); return null; }
  };

  try {
    const base = `https://${req.headers.host}`;
    const analyticsRes = await fetch(`${base}/api/analytics`, { signal: AbortSignal.timeout(28000) });
    const analytics = await analyticsRes.json();
    const btcData = analytics.btc || {};
    const ethData = analytics.eth || {};

    // If analytics returned $0, get real price directly
    let btcPrice = parseFloat(btcData.currentPrice || 0);
    let ethPrice = parseFloat(ethData.currentPrice || 0);

    if (btcPrice <= 0 || ethPrice <= 0) {
      // Multi-source price fetch
      const [btcTick, ethTick] = await Promise.allSettled([
        ft('https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=BTCUSDT')
          .then(d => d?.lastPrice ? d : ft('https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT'))
          .then(d => d?.lastPrice ? d : ft('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true'))
          .then(d => d?.bitcoin ? { lastPrice: d.bitcoin.usd, priceChangePercent: d.bitcoin.usd_24h_change } : null),
        ft('https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=ETHUSDT')
          .then(d => d?.lastPrice ? d : ft('https://api.binance.com/api/v3/ticker/24hr?symbol=ETHUSDT'))
          .then(d => d?.lastPrice ? d : ft('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd&include_24hr_change=true'))
          .then(d => d?.ethereum ? { lastPrice: d.ethereum.usd, priceChangePercent: d.ethereum.usd_24h_change } : null),
      ]);

      if (btcTick.status === 'fulfilled' && btcTick.value) {
        btcPrice = parseFloat(btcTick.value.lastPrice) || btcPrice;
        btcData.currentPrice = btcPrice;
        btcData.change24h = parseFloat(btcTick.value.priceChangePercent || 0);
      }
      if (ethTick.status === 'fulfilled' && ethTick.value) {
        ethPrice = parseFloat(ethTick.value.lastPrice) || ethPrice;
        ethData.currentPrice = ethPrice;
        ethData.change24h = parseFloat(ethTick.value.priceChangePercent || 0);
      }
    }

    const build = (asset, fallbackPrice) => {
      const price = parseFloat(asset.currentPrice || fallbackPrice || 0);
      const prob = asset.probabilityScore || 50;
      const signal = asset.confluenceSignal || 'Neutral';
      const action = signal.includes('Buy') ? 'BUY' : signal.includes('Sell') ? 'SELL' : 'HOLD';
      const kl = asset.keyLevels || {};
      const atr4h = asset.atr?.['4h'] || price * 0.02;
      const rsi = asset.rsi || {};
      const macd = asset.macd || {};
      const bb = asset.bb || {};
      const trends = asset.trends || {};

      // Always compute real support/resistance
      const support = kl.support > 0 ? kl.support : +(price * 0.95).toFixed(4);
      const resistance = kl.resistance > 0 ? kl.resistance : +(price * 1.05).toFixed(4);

      // Reasoning
      const reasoning = [];
      if (asset.technicalSummary) reasoning.push(asset.technicalSummary);
      if (trends.overall === 'BULLISH') reasoning.push('Multi-timeframe bullish — 1H 4H 1D aligned naik.');
      if (trends.overall === 'BEARISH') reasoning.push('Multi-timeframe bearish — tekanan jual dominan.');
      if (rsi['4h'] && rsi['4h'] < 35) reasoning.push(`RSI 4H oversold (${rsi['4h']}) — potensi reversal.`);
      if (rsi['4h'] && rsi['4h'] > 70) reasoning.push(`RSI 4H overbought (${rsi['4h']}) — waspada koreksi.`);
      if (macd['4h']?.crossUp) reasoning.push('MACD 4H golden cross — momentum bullish baru.');
      if (macd['4h']?.crossDown) reasoning.push('MACD 4H death cross — momentum bearish.');
      if (bb['4h']?.width < 3) reasoning.push(`BB squeeze (${bb['4h'].width}%) — ekspansi volatilitas imminent.`);

      // ATR-based trade setup
      let tradeSetup = null;
      if (price > 0 && atr4h > 0) {
        const slDist = atr4h * 1.5, tp1 = atr4h * 2.0, tp2 = atr4h * 3.5;
        if (action === 'BUY') {
          tradeSetup = {
            direction: 'LONG', entry: +price.toFixed(4),
            sl: +(price - slDist).toFixed(4), tp1: +(price + tp1).toFixed(4), tp2: +(price + tp2).toFixed(4),
            rr: +(tp1 / slDist).toFixed(2),
            slPct: +(slDist / price * 100).toFixed(2), tp1Pct: +(tp1 / price * 100).toFixed(2),
          };
        } else if (action === 'SELL') {
          tradeSetup = {
            direction: 'SHORT', entry: +price.toFixed(4),
            sl: +(price + slDist).toFixed(4), tp1: +(price - tp1).toFixed(4), tp2: +(price - tp2).toFixed(4),
            rr: +(tp1 / slDist).toFixed(2),
            slPct: +(slDist / price * 100).toFixed(2), tp1Pct: +(tp1 / price * 100).toFixed(2),
          };
        }
      }

      return {
        price: price.toFixed(4), currentPrice: price,
        probabilityScore: prob, confluenceSignal: signal, action,
        overallTrend: trends.overall || 'NEUTRAL',
        trends: { '1h': trends['1h'] || 'NEUTRAL', '4h': trends['4h'] || 'NEUTRAL', '1d': trends['1d'] || 'NEUTRAL' },
        keyLevels: { support, resistance, supportLevels: kl.supportLevels || [], resistanceLevels: kl.resistanceLevels || [] },
        tradeSetup,
        indicators: {
          rsi1h: rsi['1h'] || 50, rsi4h: rsi['4h'] || 50, rsi1d: rsi['1d'] || 50,
          macd4hBullish: macd['4h']?.bullish || false, macd4hCrossUp: macd['4h']?.crossUp || false,
          bbSqueeze: bb['4h']?.width < 3, bbPosition: bb['4h']?.position || 50,
          atr4h: +atr4h.toFixed(4), fundingRate: asset.fundingRate || 0,
        },
        scoreBreakdown: asset.scoreBreakdown || { bull: 0, bear: 0, total: 0, bullPct: 50 },
        maStatus: asset.maStatus || { position: 'N/A' },
        pivots: asset.pivots || null,
        dataSource: asset.dataSource || 'analytics',
        reasoning: reasoning.slice(0, 5),
      };
    };

    const btcRec = build(btcData, btcPrice);
    const ethRec = build(ethData, ethPrice);

    // Trading plan
    const daily = [], swing = [], watchlist = [];
    if (btcRec.action === 'BUY' && btcRec.tradeSetup)
      daily.push(`BTC LONG: Entry $${btcRec.tradeSetup.entry}, SL $${btcRec.tradeSetup.sl} (-${btcRec.tradeSetup.slPct}%), TP1 $${btcRec.tradeSetup.tp1} (+${btcRec.tradeSetup.tp1Pct}%) — R:R 1:${btcRec.tradeSetup.rr}`);
    else if (btcRec.action === 'SELL' && btcRec.tradeSetup)
      daily.push(`BTC SHORT: Entry $${btcRec.tradeSetup.entry}, SL $${btcRec.tradeSetup.sl}, TP1 $${btcRec.tradeSetup.tp1}`);
    if (ethRec.action === 'BUY' && ethRec.tradeSetup)
      swing.push(`ETH LONG: Entry $${ethRec.tradeSetup.entry}, SL $${ethRec.tradeSetup.sl}, TP1 $${ethRec.tradeSetup.tp1} — R:R 1:${ethRec.tradeSetup.rr}`);
    if (btcRec.indicators.rsi4h < 35) watchlist.push(`BTC RSI oversold (${btcRec.indicators.rsi4h}) — monitor reversal`);
    if (ethRec.indicators.rsi4h < 35) watchlist.push(`ETH RSI oversold (${ethRec.indicators.rsi4h}) — monitor reversal`);
    if (btcRec.indicators.bbSqueeze) watchlist.push('BTC BB squeeze — breakout imminent');
    if (btcRec.currentPrice > 0) watchlist.push(`BTC Support kunci: $${btcRec.keyLevels.support} — pantau level ini`);

    res.setHeader('Cache-Control', 's-maxage=30');
    return res.status(200).json({
      btc: btcRec, eth: ethRec,
      tradingPlan: { daily, swing, watchlist },
      marketNarrative: analytics.smartMoneyNarrative || 'Data pasar dimuat...',
      timestamp: Date.now(),
    });

  } catch (e) {
    // Full fallback — get price from multiple sources
    try {
      const [btcFetch, ethFetch] = await Promise.allSettled([
        Promise.race([
          fetch('https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=BTCUSDT').then(r => r.json()),
          fetch('https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT').then(r => r.json()),
          fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd').then(r => r.json()).then(d => ({ lastPrice: d.bitcoin?.usd })),
        ]),
        Promise.race([
          fetch('https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=ETHUSDT').then(r => r.json()),
          fetch('https://api.binance.com/api/v3/ticker/24hr?symbol=ETHUSDT').then(r => r.json()),
          fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd').then(r => r.json()).then(d => ({ lastPrice: d.ethereum?.usd })),
        ]),
      ]);

      const bp = btcFetch.status === 'fulfilled' ? parseFloat(btcFetch.value.lastPrice) || 0 : 0;
      const ep = ethFetch.status === 'fulfilled' ? parseFloat(ethFetch.value.lastPrice) || 0 : 0;

      return res.status(200).json({
        btc: {
          price: bp > 0 ? bp.toFixed(2) : 'N/A', currentPrice: bp,
          probabilityScore: 50, confluenceSignal: 'Neutral', action: 'HOLD',
          keyLevels: { support: +(bp * 0.95).toFixed(2), resistance: +(bp * 1.05).toFixed(2) },
          reasoning: ['Analytics timeout — menampilkan data harga langsung.'],
          dataSource: 'direct_fallback',
        },
        eth: {
          price: ep > 0 ? ep.toFixed(2) : 'N/A', currentPrice: ep,
          probabilityScore: 50, confluenceSignal: 'Neutral', action: 'HOLD',
          keyLevels: { support: +(ep * 0.95).toFixed(2), resistance: +(ep * 1.05).toFixed(2) },
          reasoning: ['Analytics timeout — menampilkan data harga langsung.'],
          dataSource: 'direct_fallback',
        },
        tradingPlan: { daily: [], swing: [], watchlist: [] },
        marketNarrative: 'Sedang menghubungkan ke server data...',
        error: e.message,
      });
    } catch {
      return res.status(200).json({
        btc: { price: '—', currentPrice: 0, probabilityScore: 50, confluenceSignal: 'Neutral', action: 'HOLD', keyLevels: { support: 0, resistance: 0 }, reasoning: ['Semua sumber data offline.'] },
        eth: { price: '—', currentPrice: 0, probabilityScore: 50, confluenceSignal: 'Neutral', action: 'HOLD', keyLevels: { support: 0, resistance: 0 }, reasoning: ['Semua sumber data offline.'] },
        tradingPlan: { daily: [], swing: [], watchlist: [] },
        marketNarrative: 'Server sedang tidak dapat diakses.',
      });
    }
  }
}
