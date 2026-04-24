// api/recommendation.js — AC369 FUSION v10.3
// FIXED: reads analyticsData.btc.currentPrice (not flat)
// FIXED: fallback hits Binance directly if analytics fails

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const base = `https://${req.headers.host}`;
    const analyticsRes = await fetch(`${base}/api/analytics`, {signal:AbortSignal.timeout(25000)});
    const analytics = await analyticsRes.json();

    const btc = analytics.btc || {};
    const eth = analytics.eth || {};

    const build = (asset) => {
      const price = parseFloat(asset.currentPrice || 0);
      const score = asset.probabilityScore || 50;
      const signal = asset.confluenceSignal || 'Neutral';
      const action = signal.includes('Buy')?'BUY':signal.includes('Sell')?'SELL':'HOLD';
      const kl = asset.keyLevels || {};
      const atr = (asset.atr?.['4h'] || price*0.02);
      const rsi = asset.rsi || {};
      const macd = asset.macd || {};
      const bb = asset.bb || {};
      const trends = asset.trends || {};

      // Reasoning
      const reasoning=[];
      if(asset.technicalSummary) reasoning.push(asset.technicalSummary);
      if(trends.overall==='BULLISH') reasoning.push('Multi-timeframe bullish — 1H 4H 1D aligned naik.');
      if(trends.overall==='BEARISH') reasoning.push('Multi-timeframe bearish — tekanan jual dominan.');
      if(rsi['4h']&&rsi['4h']<35) reasoning.push(`RSI 4H oversold (${rsi['4h']}) — potensi reversal.`);
      if(rsi['4h']&&rsi['4h']>70) reasoning.push(`RSI 4H overbought (${rsi['4h']}) — waspada koreksi.`);
      if(macd['4h']?.crossUp) reasoning.push('MACD 4H golden cross — momentum bullish baru.');
      if(macd['4h']?.crossDown) reasoning.push('MACD 4H death cross — momentum bearish.');
      if(bb['4h']?.width<3) reasoning.push(`BB squeeze (${bb['4h'].width}%) — breakout imminent.`);

      // Trade setup (ATR-based)
      let tradeSetup=null;
      if(price>0) {
        const slDist=atr*1.5, tp1=atr*2.0, tp2=atr*3.5;
        if(action==='BUY') {
          tradeSetup={direction:'LONG',entry:+price.toFixed(4),sl:+(price-slDist).toFixed(4),
            tp1:+(price+tp1).toFixed(4),tp2:+(price+tp2).toFixed(4),
            rr:+(tp1/slDist).toFixed(2),slPct:+(slDist/price*100).toFixed(2),tp1Pct:+(tp1/price*100).toFixed(2)};
        } else if(action==='SELL') {
          tradeSetup={direction:'SHORT',entry:+price.toFixed(4),sl:+(price+slDist).toFixed(4),
            tp1:+(price-tp1).toFixed(4),tp2:+(price-tp2).toFixed(4),
            rr:+(tp1/slDist).toFixed(2),slPct:+(slDist/price*100).toFixed(2),tp1Pct:+(tp1/price*100).toFixed(2)};
        }
      }

      return {
        price: price.toFixed(4), currentPrice: price,
        probabilityScore: score, confluenceSignal: signal, action,
        overallTrend: trends.overall||'NEUTRAL',
        trends: {'1h':trends['1h']||'NEUTRAL','4h':trends['4h']||'NEUTRAL','1d':trends['1d']||'NEUTRAL'},
        keyLevels: {
          support: kl.support || +(price*0.95).toFixed(4),
          resistance: kl.resistance || +(price*1.05).toFixed(4),
          supportLevels: kl.supportLevels||[], resistanceLevels: kl.resistanceLevels||[],
        },
        tradeSetup,
        indicators: {
          rsi1h:rsi['1h']||50,rsi4h:rsi['4h']||50,rsi1d:rsi['1d']||50,
          macd4hBullish:macd['4h']?.bullish||false,macd4hCrossUp:macd['4h']?.crossUp||false,
          bbSqueeze:bb['4h']?.width<3,bbPosition:bb['4h']?.position||50,
          atr4h:+(atr).toFixed(4),fundingRate:asset.fundingRate||0,
        },
        scoreBreakdown: asset.scoreBreakdown||{bull:0,bear:0,total:0,bullPct:50},
        maStatus: asset.maStatus||{position:'N/A'},
        pivots: asset.pivots||null,
        reasoning: reasoning.slice(0,5),
      };
    };

    const btcRec = build(btc);
    const ethRec = build(eth);

    // Trading plan
    const daily=[], swing=[], watchlist=[];
    if(btcRec.action==='BUY'&&btcRec.tradeSetup)
      daily.push(`BTC LONG: Entry $${btcRec.tradeSetup.entry}, SL $${btcRec.tradeSetup.sl}, TP1 $${btcRec.tradeSetup.tp1} (R:R 1:${btcRec.tradeSetup.rr})`);
    if(ethRec.action==='BUY'&&ethRec.tradeSetup)
      swing.push(`ETH LONG: Entry $${ethRec.tradeSetup.entry}, SL $${ethRec.tradeSetup.sl}, TP1 $${ethRec.tradeSetup.tp1} (R:R 1:${ethRec.tradeSetup.rr})`);
    if(btcRec.indicators.rsi4h<35) watchlist.push(`BTC RSI oversold (${btcRec.indicators.rsi4h}) — monitor reversal`);
    if(ethRec.indicators.rsi4h<35) watchlist.push(`ETH RSI oversold (${ethRec.indicators.rsi4h}) — monitor reversal`);
    if(btcRec.indicators.bbSqueeze) watchlist.push('BTC BB squeeze — breakout imminent');

    res.setHeader('Cache-Control','s-maxage=30');
    return res.status(200).json({
      btc:btcRec, eth:ethRec,
      tradingPlan:{daily,swing,watchlist},
      marketNarrative: analytics.smartMoneyNarrative||'Pasar dalam kondisi normal.',
      timestamp:Date.now(),
    });

  } catch(e) {
    // Direct Binance fallback
    try {
      const [bt,et]=await Promise.allSettled([
        fetch('https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=BTCUSDT').then(r=>r.json()),
        fetch('https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=ETHUSDT').then(r=>r.json()),
      ]);
      const bp=bt.status==='fulfilled'?parseFloat(bt.value.lastPrice):77500;
      const ep=et.status==='fulfilled'?parseFloat(et.value.lastPrice):2300;
      return res.status(200).json({
        btc:{price:bp.toFixed(2),currentPrice:bp,probabilityScore:50,confluenceSignal:'Neutral',action:'HOLD',
          keyLevels:{support:+(bp*0.95).toFixed(2),resistance:+(bp*1.05).toFixed(2)},reasoning:['Analytics timeout — fallback data.']},
        eth:{price:ep.toFixed(2),currentPrice:ep,probabilityScore:50,confluenceSignal:'Neutral',action:'HOLD',
          keyLevels:{support:+(ep*0.95).toFixed(2),resistance:+(ep*1.05).toFixed(2)},reasoning:['Analytics timeout — fallback data.']},
        tradingPlan:{daily:[],swing:[],watchlist:[]},
        marketNarrative:'Data sedang dimuat ulang...',
      });
    } catch{
      return res.status(200).json({
        btc:{price:'77500',probabilityScore:50,confluenceSignal:'Neutral',action:'HOLD',keyLevels:{support:'73625',resistance:'81375'},reasoning:['Data offline']},
        eth:{price:'2300',probabilityScore:50,confluenceSignal:'Neutral',action:'HOLD',keyLevels:{support:'2185',resistance:'2415'},reasoning:['Data offline']},
        tradingPlan:{daily:[],swing:[],watchlist:[]},
        marketNarrative:'Data pasar offline.',
      });
    }
  }
}
