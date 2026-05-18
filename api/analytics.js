// api/analytics.js — v18 FAST
// CryptoCompare aggregate=4 → data 4H langsung (60 candles, ~15KB, cepat)
// Harga dari candle terakhir — NO CoinGecko (reduce rate limit pressure)
// Bybit single symbol sebagai backup harga

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=15');
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

  // ── TA HELPERS ─────────────────────────────────────────────
  const EMA = (a, p) => {
    if (!a || a.length < 2) return a?.[a.length-1] || 0;
    const k = 2/(p+1);
    let e = a.slice(0, Math.min(p,a.length)).reduce((s,v)=>s+v,0) / Math.min(p,a.length);
    for (let i = Math.min(p,a.length); i < a.length; i++) e = a[i]*k + e*(1-k);
    return +e.toFixed(6);
  };

  const RSI14 = (a) => {
    if (!a || a.length < 16) return 50;
    let ag=0, al=0;
    for (let i=1;i<=14;i++){const d=a[i]-a[i-1]; d>0?ag+=d:al-=d;}
    ag/=14; al/=14;
    for (let i=15;i<a.length;i++){const d=a[i]-a[i-1]; ag=(ag*13+Math.max(d,0))/14; al=(al*13+Math.max(-d,0))/14;}
    return al===0?100:+(100-100/(1+ag/al)).toFixed(2);
  };

  const MACD = (a) => {
    if (!a||a.length<36) return {bullish:false,bearish:false,crossUp:false,crossDown:false,histogram:0,macd:0,signal:0};
    const k12=2/13, k26=2/27, k9=2/10;
    let e12=a.slice(0,12).reduce((s,v)=>s+v,0)/12, e26=a.slice(0,26).reduce((s,v)=>s+v,0)/26;
    const mv=[];
    for(let i=26;i<a.length;i++){e12=a[i]*k12+e12*(1-k12); e26=a[i]*k26+e26*(1-k26); mv.push(e12-e26);}
    let sig=mv.slice(0,9).reduce((s,v)=>s+v,0)/9;
    for(let i=9;i<mv.length;i++) sig=mv[i]*k9+sig*(1-k9);
    const last=mv[mv.length-1], prev=mv[mv.length-2]||last;
    const hist=last-sig, prevH=prev-sig;
    return {bullish:last>0&&hist>0, bearish:last<0&&hist<0, crossUp:hist>0&&prevH<=0, crossDown:hist<0&&prevH>=0, histogram:+hist.toFixed(8), macd:+last.toFixed(8), signal:+sig.toFixed(8)};
  };

  const BB = (a, p=20) => {
    if (!a||a.length<p) return {upper:0,lower:0,mid:0,width:0,position:50,squeeze:false};
    const sl=a.slice(-p), m=sl.reduce((s,v)=>s+v,0)/p;
    const sd=Math.sqrt(sl.reduce((s,v)=>s+(v-m)**2,0)/p);
    const up=m+2*sd, dn=m-2*sd, last=a[a.length-1];
    return {upper:+up.toFixed(6), lower:+dn.toFixed(6), mid:+m.toFixed(6), width:sd>0?+((4*sd/m)*100).toFixed(2):0, position:sd>0?+((last-dn)/(4*sd)*100).toFixed(1):50, squeeze:sd>0&&(4*sd/m)*100<3};
  };

  const ATR = (K, p=14) => {
    if (!K||K.length<2) return 0;
    const tr=K.slice(1).map((k,i)=>Math.max(k.h-k.l,Math.abs(k.h-K[i].c),Math.abs(k.l-K[i].c)));
    return tr.slice(-p).reduce((s,v)=>s+v,0)/Math.min(p,tr.length);
  };

  // Parse CryptoCompare 4H response
  const parseCC4H = (r) => {
    if (!r || r?.Response !== 'Success') return [];
    const data = r?.Data?.Data || [];
    return data.filter(d => d.close > 0 && d.open > 0).map(d => ({
      t: d.time, o: +d.open, h: +d.high, l: +d.low, c: +d.close, v: +(d.volumeto||0)
    }));
  };

  const analyze = (sym, K4h, bybitTick) => {
    if (!K4h || K4h.length < 16) return null;
    const closes = K4h.map(k => k.c);
    const n = K4h.length;

    // Price: use Bybit if available, otherwise last candle
    const lastCandle = K4h[n-1].c;
    const byPrice    = bybitTick?.lastPrice ? +bybitTick.lastPrice : 0;
    const price      = byPrice > 0 ? byPrice : lastCandle;

    // 24h change: compare last vs 6 candles ago (6x4h = 24h)
    const p24h = n >= 6 ? K4h[n-6].c : K4h[0].c;
    const ch24 = p24h > 0 ? +((price - p24h) / p24h * 100).toFixed(2) : 0;

    // TA
    const rsi4h  = RSI14(closes);
    const rsi1h  = RSI14(closes.slice(-12));           // last 12x4H ≈ 2D
    const rsi1d  = RSI14(closes.filter((_,i)=>i%6===0)); // every 6th = 1D
    const ema9   = EMA(closes, 9);
    const ema21  = EMA(closes, 21);
    const ema50  = EMA(closes, Math.min(50, n-1));
    const ema200 = EMA(closes, Math.min(200, n-1));
    const macd   = MACD(closes);
    const bb     = BB(closes, 20);
    const atr    = ATR(K4h, 14);

    // Trend score
    let ts = 0;
    if (price > ema9)   ts += 1;
    if (price > ema21)  ts += 1;
    if (price > ema50)  ts += 1;
    if (price > ema200) ts += 2;
    if (macd.bullish)   ts += 1;
    if (rsi4h > 55)     ts += 1; else if (rsi4h < 45) ts -= 1;
    if (macd.crossUp)   ts += 2;
    if (macd.crossDown) ts -= 2;

    const trend4h  = ts >= 3 ? 'BULLISH' : ts <= -3 ? 'BEARISH' : 'NEUTRAL';
    const action   = ts >= 5 ? 'STRONG BUY' : ts >= 3 ? 'BUY' : ts <= -5 ? 'STRONG SELL' : ts <= -3 ? 'SELL' : 'HOLD';
    const prob     = Math.max(5, Math.min(95, 50 + ts * 7));

    // Key levels
    const hs = [...K4h.slice(-30).map(k=>k.h)].sort((a,b)=>b-a);
    const ls = [...K4h.slice(-30).map(k=>k.l)].sort((a,b)=>a-b);
    const resistance = hs.find(h => h > price) || price * 1.05;
    const support    = ls.find(l => l < price) || price * 0.95;

    // Pivot
    const pv = K4h[n-2] || K4h[n-1];
    const P  = (pv.h + pv.l + pv.c) / 3;
    const pivot = { P:+P.toFixed(4), R1:+(2*P-pv.l).toFixed(4), R2:+(P+pv.h-pv.l).toFixed(4), S1:+(2*P-pv.h).toFixed(4), S2:+(P-(pv.h-pv.l)).toFixed(4) };

    // Summary
    const parts = [];
    if (trend4h === 'BULLISH')  parts.push('Tren 4H bullish — EMA aligned upward.');
    else if (trend4h === 'BEARISH') parts.push('Tren 4H bearish — tekanan jual.');
    else parts.push('4H sideways/konsolidasi.');
    if (rsi4h < 30) parts.push(`RSI ${rsi4h} oversold — potensi reversal kuat.`);
    else if (rsi4h > 70) parts.push(`RSI ${rsi4h} overbought — waspada koreksi.`);
    else parts.push(`RSI ${rsi4h}.`);
    if (macd.crossUp)   parts.push('MACD golden cross ✅');
    if (macd.crossDown) parts.push('MACD death cross ⚠️');
    if (bb.squeeze)     parts.push('BB squeeze — breakout imminent!');
    parts.push(`EMA200: $${ema200.toLocaleString('en-US',{maximumFractionDigits:2})}.`);

    return {
      symbol: sym+'USDT', ticker: sym,
      currentPrice: +price.toFixed(6),
      change24h: ch24,
      dataSource: 'cryptocompare_4h',
      candleCount: n,
      probabilityScore: prob,
      confluenceSignal: action.includes('BUY') ? 'Bullish' : action.includes('SELL') ? 'Bearish' : 'Neutral',
      action, overallTrend: trend4h,
      technicalSummary: parts.join(' '),
      rsi: { '1h': rsi1h, '4h': rsi4h, '1d': rsi1d },
      maStatus: {
        ema9:+ema9.toFixed(4), ema21:+ema21.toFixed(4), ema50:+ema50.toFixed(4), ema200:+ema200.toFixed(4),
        position: price > ema200 ? `Above EMA200 (+${((price-ema200)/ema200*100).toFixed(1)}%)` : `Below EMA200 (${((price-ema200)/ema200*100).toFixed(1)}%)`,
      },
      macd: { '4h': macd },
      bb:   { '4h': bb, squeeze: bb.squeeze },
      atr:  { '4h': +atr.toFixed(6), atrPct: +(atr/price*100).toFixed(2), volatility: atr/price*100>5?'HIGH':atr/price*100>2?'MEDIUM':'LOW' },
      keyLevels: { support: +support.toFixed(4), resistance: +resistance.toFixed(4) },
      pivotPoints: { '4H': pivot },
      trends: { '1h': rsi1h>55?'BULLISH':rsi1h<45?'BEARISH':'NEUTRAL', '4h': trend4h, '1d': trend4h, overall: trend4h },
      scoreBreakdown: { tScore: ts, bullPct: Math.max(1, Math.min(99, 50+ts*7)) },
    };
  };

  try {
    // ── Fetch: CryptoCompare aggregate=4 (direct 4H, FAST small response)
    //          + Bybit single for realtime price
    const [btcR, ethR, byBTCR, byETHR] = await Promise.allSettled([
      // aggregate=4, limit=60 → 60 candles of 4H = 10 days. Fast ~15KB
      sf('https://min-api.cryptocompare.com/data/v2/histohour?fsym=BTC&tsym=USD&limit=60&aggregate=4&e=CCCAGG', 6000),
      sf('https://min-api.cryptocompare.com/data/v2/histohour?fsym=ETH&tsym=USD&limit=60&aggregate=4&e=CCCAGG', 6000),
      // Bybit realtime price (always works, not rate limited)
      sf('https://api.bybit.com/v5/market/tickers?category=linear&symbol=BTCUSDT', 4000),
      sf('https://api.bybit.com/v5/market/tickers?category=linear&symbol=ETHUSDT', 4000),
    ]);

    const btcK4  = btcR.status === 'fulfilled' ? parseCC4H(btcR.value) : [];
    const ethK4  = ethR.status === 'fulfilled' ? parseCC4H(ethR.value) : [];
    const byBTC  = byBTCR.status === 'fulfilled' ? byBTCR.value?.result?.list?.[0] : null;
    const byETH  = byETHR.status === 'fulfilled' ? byETHR.value?.result?.list?.[0] : null;

    const btcData = btcK4.length >= 16 ? analyze('BTC', btcK4, byBTC) : null;
    const ethData = ethK4.length >= 16 ? analyze('ETH', ethK4, byETH) : null;

    // Smart money narrative
    let narrative = 'Analisis teknikal sedang diproses...';
    if (btcData) {
      const bt = btcData.overallTrend, et = ethData?.overallTrend;
      const lines = [];
      if (bt==='BULLISH' && et==='BULLISH') lines.push('🟢 BTC & ETH keduanya bullish — risk-on aktif, altcoin berpeluang follow.');
      else if (bt==='BULLISH') lines.push('📈 BTC bullish tapi ETH laggard — rotasi belum penuh ke altcoin.');
      else if (bt==='BEARISH') lines.push('🔴 BTC bearish — smart money distribusi, risk management ketat.');
      else lines.push('⚖️ Market konsolidasi — tunggu konfirmasi breakout.');
      const r = btcData.rsi?.['4h'] || 50;
      if (r < 30) lines.push(`RSI BTC oversold (${r}) — zona akumulasi institusional.`);
      else if (r > 70) lines.push(`RSI BTC overbought (${r}) — potensi profit taking.`);
      if (btcData.macd?.['4h']?.crossUp)   lines.push('MACD BTC golden cross — momentum bullish baru.');
      if (btcData.macd?.['4h']?.crossDown) lines.push('MACD BTC death cross — waspadai penurunan.');
      if (btcData.bb?.['4h']?.squeeze)     lines.push('BB squeeze BTC — ekspansi volatilitas imminent!');
      narrative = lines.join(' ');
    }

    return res.status(200).json({
      ok: true, ts: Date.now(), elapsed: Date.now()-t0, version: 'v18',
      src: 'cryptocompare_4h_direct+bybit',
      btcCandleCount: btcK4.length, ethCandleCount: ethK4.length,
      btc: btcData, eth: ethData,
      smartMoneyNarrative: narrative,
    });

  } catch (e) {
    return res.status(200).json({
      ok: false, error: e.message, ts: Date.now(), elapsed: Date.now()-t0, version: 'v18',
      btc: null, eth: null, smartMoneyNarrative: 'Error: ' + e.message,
    });
  }
}
