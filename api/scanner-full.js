// api/scanner-full.js — v17 POWERFUL
// 250 koin dari CoinGecko markets (RELIABLE — sudah terbukti bekerja)
// RSI real dari CryptoCompare top 50 koin
// Probability scoring multi-factor yang akurat

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=20');
  if (req.method === 'OPTIONS') return res.status(200).end();
  const t0 = Date.now();

  const sf = async (url, ms) => {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), ms);
    try {
      const r = await fetch(url, { signal: c.signal, headers: { Accept: 'application/json', 'User-Agent': 'AC369/1.0' } });
      clearTimeout(t); if (!r.ok) return null; return await r.json();
    } catch { clearTimeout(t); return null; }
  };

  // ── RSI Wilder ────────────────────────────────────────────
  const RSI14 = (a) => {
    if (!a || a.length < 16) return null;
    let ag=0, al=0;
    for (let i=1;i<=14;i++){const d=a[i]-a[i-1];d>0?ag+=d:al-=d;}
    ag/=14; al/=14;
    for (let i=15;i<a.length;i++){const d=a[i]-a[i-1];ag=(ag*13+Math.max(d,0))/14;al=(al*13+Math.max(-d,0))/14;}
    return al===0?100:+(100-100/(1+ag/al)).toFixed(2);
  };

  const EMA = (a,p) => {
    if (!a||a.length<2) return a?.[a.length-1]||0;
    const k=2/(p+1); let e=a.slice(0,Math.min(p,a.length)).reduce((s,v)=>s+v,0)/Math.min(p,a.length);
    for(let i=Math.min(p,a.length);i<a.length;i++) e=a[i]*k+e*(1-k);
    return e;
  };

  // MACD signal
  const macdSignal = (a) => {
    if (!a||a.length<36) return {bull:false,bear:false,xUp:false,xDown:false};
    const k12=2/13,k26=2/27,k9=2/10;
    let e12=a.slice(0,12).reduce((s,v)=>s+v,0)/12, e26=a.slice(0,26).reduce((s,v)=>s+v,0)/26;
    const mv=[];
    for(let i=26;i<a.length;i++){e12=a[i]*k12+e12*(1-k12);e26=a[i]*k26+e26*(1-k26);mv.push(e12-e26);}
    let sig=mv.slice(0,9).reduce((s,v)=>s+v,0)/9;
    for(let i=9;i<mv.length;i++) sig=mv[i]*k9+sig*(1-k9);
    const last=mv[mv.length-1], prev=mv[mv.length-2]||last, hist=last-sig, prevH=prev-sig;
    return {bull:last>0&&hist>0, bear:last<0&&hist<0, xUp:hist>0&&prevH<=0, xDown:hist<0&&prevH>=0};
  };

  // Astro
  const getAstro = () => {
    const jd=Date.now()/86400000+2440587.5;
    const dnm=((jd-2460320.5)%29.53058867+29.53058867)%29.53058867;
    const phases=[[1.5,'New Moon','🌑'],[8.5,'First Quarter','🌓'],[16,'Full Moon','🌕'],[22,'Waning','🌖'],[29.5,'Waning Crescent','🌘']];
    let moonPhase='Dark Moon', moonEmoji='🌑';
    for(const[l,p,e]of phases)if(dnm<l){moonPhase=p;moonEmoji=e;break;}
    const dsh=Math.floor((Date.now()-1713571200000)/86400000);
    const halvPhase=dsh<365?'Bull Early 🔥':dsh<480?'Bull Peak ⚡':dsh<730?'Distribution ⚠️':'Accumulation 🌱';
    return{moonPhase,moonEmoji,halvingPhase:halvPhase,daysSinceHalving:dsh,chaotic:moonPhase==='Full Moon'||moonPhase==='New Moon'};
  };

  const astro = getAstro();

  try {
    // ── STEP 1: CoinGecko markets 250 koin + F&G parallel ─
    const [cgR, cgR2, fngR] = await Promise.allSettled([
      // Page 1: top 250 by volume
      sf('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=volume_desc&per_page=250&page=1&sparkline=false&price_change_percentage=24h,7d', 7000),
      // F&G
      sf('https://api.alternative.me/fng/?limit=1&format=json', 4000),
      // BTC DOM for context
      sf('https://api.coingecko.com/api/v3/global', 5000),
    ]);

    const markets = cgR.status==='fulfilled' && Array.isArray(cgR.value) ? cgR.value : [];
    const fg = fngR.status==='fulfilled' ? parseInt(fngR.value?.data?.[0]?.value||50) : 50;
    const btcDom = cgR2.status==='fulfilled' ? +(cgR2.value?.data?.market_cap_percentage?.btc||58).toFixed(1) : 58;

    if (!markets.length) {
      return res.status(200).json({ok:false,error:'CoinGecko markets unavailable',ts:Date.now(),totalScanned:0,totalQualified:0,results:[],topSetups:{institutional:[],fullSend:[],highProbBull:[],smcSetups:[],ewSetups:[],volumeBreakout:[],strongSell:[]},marketOverview:{marketMood:'UNKNOWN',bullishCount:0,bearishCount:0,avgChange24h:0}});
    }

    // Filter out stablecoins and low quality
    const STABLES = new Set(['tether','usd-coin','binance-usd','dai','trueusd','first-digital-usd','usdd','frax','usdb']);
    const filtered = markets.filter(c => !STABLES.has(c.id) && (c.total_volume||0) > 1e6 && c.current_price > 0);

    // BTC reference for comparison
    const btcRef = markets.find(c => c.id === 'bitcoin');
    const btcPx  = btcRef?.current_price || 0;
    const btcChg = btcRef?.price_change_percentage_24h || 0;

    // ── STEP 2: RSI for top 50 from CryptoCompare ─────────
    const top50 = filtered.slice(0, 50).map(c => c.symbol.toUpperCase());
    const rsiMap = {};

    const ccBatch = await Promise.allSettled(
      top50.map(sym =>
        sf(`https://min-api.cryptocompare.com/data/v2/histohour?fsym=${sym}&tsym=USD&limit=32&aggregate=4&e=CCCAGG`, 5000)
      )
    );

    ccBatch.forEach((r, i) => {
      if (r.status !== 'fulfilled' || r.value?.Response !== 'Success') return;
      const raw = r.value?.Data?.Data;
      if (!raw || raw.length < 16) return;
      const closes = raw.filter(d => d.close > 0).map(d => +d.close);
      if (closes.length < 16) return;
      const rsi  = RSI14(closes);
      const ema9 = EMA(closes, 9);
      const ema21= EMA(closes, 21);
      const ema50= EMA(closes, Math.min(50, closes.length-1));
      const macd = macdSignal(closes);
      // Store
      rsiMap[top50[i]] = { rsi, ema9, ema21, ema50, macd, closes, hasReal: rsi !== null };
    });

    // ── STEP 3: Score each coin ───────────────────────────
    const results = filtered.map((c, idx) => {
      const sym   = c.symbol.toUpperCase();
      const price = c.current_price || 0;
      const ch24  = c.price_change_percentage_24h || 0;
      const ch7d  = c.price_change_percentage_7d || 0;
      const vol   = c.total_volume || 0;
      const mcap  = c.market_cap || 0;
      const high  = c.high_24h || price * 1.01;
      const low   = c.low_24h  || price * 0.99;
      const mcapRank = c.market_cap_rank || 999;

      // Price position in 24h range (0=at low, 1=at high)
      const pricePos = high > low ? (price - low) / (high - low) : 0.5;
      // Body as % of range
      const range = high > low ? (high - low) / price * 100 : 0;

      // RSI from CryptoCompare (real) or estimated
      const rsiData = rsiMap[sym];
      const rsi = rsiData?.hasReal ? rsiData.rsi : Math.max(10, Math.min(90,
        50 + ch24 * 2.5 + (pricePos - 0.5) * 25
      ));
      const rsiReal = rsiData?.hasReal || false;

      // EMA alignment (from real data or estimated)
      let emaScore = 0;
      if (rsiData?.closes?.length >= 20) {
        const lastP = rsiData.closes[rsiData.closes.length-1];
        if (lastP > rsiData.ema9)  emaScore += 1;
        if (lastP > rsiData.ema21) emaScore += 1;
        if (lastP > rsiData.ema50) emaScore += 1;
      } else {
        // Estimate from multi-timeframe price action
        if (ch24 > 0) emaScore += 1;
        if (ch7d  > 0) emaScore += 1;
        if (pricePos > 0.6) emaScore += 1;
      }

      // Trend per timeframe (estimate)
      const trend1h = rsi > 58 ? 'BULL' : rsi < 42 ? 'BEAR' : 'SIDE';
      const trend4h = rsiData?.macd?.bull || (ch24 > 1 && pricePos > 0.5) ? 'BULL' : (ch24 < -1 && pricePos < 0.5) ? 'BEAR' : 'SIDE';
      const trend1d = ch7d > 3 ? 'BULL' : ch7d < -3 ? 'BEAR' : 'SIDE';
      const bullTF  = [trend1h,trend4h,trend1d].filter(t=>t==='BULL').length;
      const bearTF  = [trend1h,trend4h,trend1d].filter(t=>t==='BEAR').length;

      // Multi-factor score
      let score = 0;

      // RSI signals
      if      (rsi < 25) score += 4;   // extreme oversold
      else if (rsi < 35) score += 3;   // oversold
      else if (rsi < 45) score += 1;   // mild bearish
      else if (rsi > 75) score -= 4;   // extreme overbought
      else if (rsi > 65) score -= 2;   // overbought
      else if (rsi > 55) score += 1;   // bullish momentum

      // MACD
      if (rsiData?.macd?.xUp)   score += 3;
      if (rsiData?.macd?.bull)  score += 1;
      if (rsiData?.macd?.xDown) score -= 3;
      if (rsiData?.macd?.bear)  score -= 1;

      // EMA alignment
      score += emaScore;
      if (emaScore === 3) score += 1; // bonus for perfect alignment
      if (emaScore === 0 && bullTF === 0) score -= 1;

      // Momentum (24h)
      if      (ch24 > 15) { score += 3; }
      else if (ch24 > 8)  { score += 2; }
      else if (ch24 > 3)  { score += 1; }
      else if (ch24 < -15){ score -= 3; }
      else if (ch24 < -8) { score -= 2; }
      else if (ch24 < -3) { score -= 1; }

      // 7-day trend
      if      (ch7d > 20) score += 2;
      else if (ch7d > 8)  score += 1;
      else if (ch7d < -20) score -= 2;
      else if (ch7d < -8)  score -= 1;

      // Trend alignment bonus
      if (bullTF === 3) score += 2;
      if (bearTF === 3) score -= 2;

      // Volume signal (vol/mcap ratio)
      const volRatio = mcap > 0 ? vol / mcap : 0;
      if (volRatio > 0.2) score += 1; // high relative volume

      // Price position (near low is bullish signal)
      if (pricePos < 0.2 && rsi < 45) score += 1;  // at low + oversold
      if (pricePos > 0.85 && rsi > 65) score -= 1; // at high + overbought

      // Probability calculation (bell curve around 50%)
      const rawProb = 50 + score * 5;
      const probability = Math.max(2, Math.min(98, Math.round(rawProb)));

      // Trend alignment label
      let taLabel = '⚖️ SIDEWAYS', taColor = 'neutral';
      if (bullTF === 3) { taLabel = '🚀 FULL SEND'; taColor = 'full-bull'; }
      else if (bullTF >= 2) { taLabel = '📈 STRONG BULL'; taColor = 'bull'; }
      else if (bearTF === 3) { taLabel = '💀 FULL BEAR'; taColor = 'full-bear'; }
      else if (bearTF >= 2) { taLabel = '📉 STRONG BEAR'; taColor = 'bear'; }

      // SMC proxy from price action
      const smcBullish = pricePos < 0.3 && rsi < 45 && ch24 > -5;  // discount zone + potential reversal
      const smcBearish = pricePos > 0.7 && rsi > 55 && ch24 < 5;   // premium zone
      const smc = {
        signal: smcBullish ? 'Bullish' : smcBearish ? 'Bearish' : 'Neutral',
        hasBOS: Math.abs(ch24) > 5 && vol > 50e6,
        hasCHoCH: false,
        inBullOB: smcBullish,
        inBearOB: smcBearish,
        inBullFVG: pricePos < 0.25,
      };

      // Elliott Wave estimation
      let ewWave = 'Unknown', ewConf = 0;
      if (ch7d > 0) { // weekly uptrend
        if (rsi < 38) { ewWave = 'Wave 2 Pullback'; ewConf = 65; }
        else if (rsi >= 45 && rsi <= 62 && ch24 > 0) { ewWave = 'Wave 3 — Impulse'; ewConf = 72; }
        else if (rsi > 70 && ch7d > 15) { ewWave = 'Wave 5 In Progress'; ewConf = 58; }
        else if (rsi >= 55 && rsi < 70) { ewWave = 'Wave 3 Extension'; ewConf = 65; }
        else { ewWave = 'Wave 4 Correction'; ewConf = 52; }
      } else { // downtrend
        if (rsi < 30) { ewWave = 'Wave C Capitulation'; ewConf = 68; }
        else if (rsi < 45) { ewWave = 'Wave A/C Bearish'; ewConf = 60; }
        else { ewWave = 'Corrective Phase'; ewConf = 48; }
      }

      // Candle pattern from OHLC
      let candlePat = '';
      if (pricePos > 0.8 && range < 2) candlePat = 'Near High 📈';
      else if (pricePos < 0.2 && range < 2) candlePat = 'Near Low — watch ⚠️';
      else if (range > 5 && ch24 > 3) candlePat = 'Bull Marubozu 🐂';
      else if (range > 5 && ch24 < -3) candlePat = 'Bear Marubozu 🐻';
      else candlePat = ch24 >= 0 ? 'Bullish Candle' : 'Bearish Candle';

      // Build signals text
      const signals = [];
      if (rsi < 30) signals.push(`RSI ${rsi.toFixed(0)} extreme oversold ← entry zone`);
      else if (rsi < 38) signals.push(`RSI ${rsi.toFixed(0)} oversold — reversal signal`);
      if (rsiData?.macd?.xUp)  signals.push('MACD golden cross ✅ — momentum new');
      if (smcBullish)          signals.push('Discount zone (SMC) — demand area');
      if (ch24 > 8)            signals.push(`+${ch24.toFixed(1)}% 24h momentum`);
      if (ch7d > 15)           signals.push(`+${ch7d.toFixed(1)}% 7d trend strong`);
      if (volRatio > 0.15)     signals.push('Volume/MCap elevated — smart money activity');
      if (bullTF === 3)        signals.push('Multi-TF aligned bullish 🚀');
      if (rsiData?.macd?.xDown) signals.push('MACD death cross ⚠️');
      if (smcBearish)          signals.push('Premium zone — distribution risk');
      if (rsi > 75)            signals.push(`RSI ${rsi.toFixed(0)} overbought — waspada`);

      const vt = vol>=1e9?5:vol>=200e6?4:vol>=50e6?3:vol>=10e6?2:vol>=1e6?1:0;

      return {
        rank: idx+1, symbol: sym, name: c.name,
        price, change24h: +ch24.toFixed(2), change7d: +ch7d.toFixed(2),
        volume24h: vol, mcap, mcapRank,
        high24h: high, low24h: low, pricePos: +pricePos.toFixed(3), range: +range.toFixed(2),
        rsi: rsi ? +rsi.toFixed(2) : 50, rsiReal, vt,
        trendAlignment: taLabel, taColor,
        trend1h, trend4h, trend1d,
        bullTF, bearTF,
        smc,
        elliottWave: { wave: ewWave, confidence: ewConf, description: ewWave },
        chartPatterns: candlePat ? [{ name: candlePat, signal: ch24 >= 0 ? 'bullish' : 'bearish' }] : [],
        probability,
        score,
        signals: signals.slice(0, 4),
        astrology: { moonPhase: astro.moonPhase, moonEmoji: astro.moonEmoji, halvingPhase: astro.halvingPhase, chaotic: astro.chaotic },
        hasRealRSI: rsiReal,
      };
    });

    // Sort by score desc
    results.sort((a, b) => b.score - a.score || b.probability - a.probability);
    results.forEach((r, i) => r.rank = i+1);

    // ── CATEGORIZE ────────────────────────────────────────
    const institutional  = results.filter(r => r.score >= 3 && r.rsi < 70 && r.probability >= 58 && r.volume24h >= 5e6).slice(0, 60);
    const fullSend       = results.filter(r => r.taColor === 'full-bull' || (r.score >= 5 && r.probability >= 70)).slice(0, 40);
    const highProbBull   = results.filter(r => r.probability >= 68 && r.score >= 3).slice(0, 40);
    const smcSetups      = results.filter(r => r.smc?.inBullOB && r.score >= 2).slice(0, 40);
    const ewSetups       = results.filter(r => r.elliottWave?.wave?.includes('Wave 3') && r.probability >= 58).slice(0, 30);
    const volumeBreakout = results.filter(r => r.vt >= 3 && r.change24h > 2).sort((a,b) => b.volume24h - a.volume24h).slice(0, 40);
    const strongSell     = results.filter(r => r.score <= -3 || r.taColor === 'full-bear').sort((a,b) => a.score - b.score).slice(0, 30);

    // Market overview
    const bullishCount = results.filter(r => r.score > 0).length;
    const bearishCount = results.filter(r => r.score < 0).length;
    const avgCh24 = results.length ? +(results.reduce((s,r)=>s+r.change24h,0)/results.length).toFixed(2) : 0;
    const avgRSI  = results.filter(r=>r.rsiReal).length
      ? +(results.filter(r=>r.rsiReal).reduce((s,r)=>s+r.rsi,0)/results.filter(r=>r.rsiReal).length).toFixed(1)
      : 50;
    const mood    = avgCh24>3?'STRONG BULL':avgCh24>1?'BULL':avgCh24<-3?'STRONG BEAR':avgCh24<-1?'BEAR':'NEUTRAL';

    return res.status(200).json({
      ok: true, ts: Date.now(), elapsed: Date.now()-t0, version: 'v17',
      src: 'coingecko_markets+cryptocompare_rsi',
      fg, btcDom, btcPrice: btcPx, btcChg24h: btcChg,
      totalScanned: filtered.length,
      totalQualified: results.length,
      rsiRealCount: Object.keys(rsiMap).filter(k => rsiMap[k].hasReal).length,

      results,
      topSetups: {
        institutional,
        fullSend,
        highProbBull,
        smcSetups,
        ewSetups,
        volumeBreakout,
        strongSell,
      },
      marketOverview: {
        marketMood: mood,
        bullishCount,
        bearishCount,
        avgChange24h: avgCh24,
        avgRSI,
        totalCoins: results.length,
      },
      astroContext: astro,
    });

  } catch (e) {
    return res.status(200).json({
      ok: false, error: e.message, ts: Date.now(), elapsed: Date.now()-t0, version: 'v17',
      totalScanned: 0, totalQualified: 0, results: [],
      topSetups: { institutional:[], fullSend:[], highProbBull:[], smcSetups:[], ewSetups:[], volumeBreakout:[], strongSell:[] },
      marketOverview: { marketMood: 'UNKNOWN', bullishCount: 0, bearishCount: 0, avgChange24h: 0 },
      astroContext: getAstro(),
    });
  }
}
