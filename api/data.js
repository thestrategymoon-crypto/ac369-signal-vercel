// api/data.js — AC369 ASTRO-TECHNICAL FUSION ENGINE v5.0
// SMC + Chart Pattern + Financial Astrology + Kill Zone + Sniper Entry
// Institutional-grade probabilistic analysis

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  const { source, ...params } = req.query;

  try {
    let data;

    // ─── BASIC PROXIES ────────────────────────────────────────────────
    if (source === 'feargreed') {
      const r = await fetch('https://api.alternative.me/fng/?limit=30&format=json', { signal: AbortSignal.timeout(8000) });
      data = await r.json();
    } else if (source === 'coingecko_global') {
      const r = await fetch('https://api.coingecko.com/api/v3/global', { headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(10000) });
      data = await r.json();
    } else if (source === 'coingecko_trending') {
      const r = await fetch('https://api.coingecko.com/api/v3/search/trending', { headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(10000) });
      data = await r.json();
    } else if (source === 'futures_klines') {
      const sym = params.symbol || 'BTCUSDT';
      const r = await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=${params.interval||'4h'}&limit=${params.limit||'200'}`, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(12000) });
      const raw = await r.json();
      data = raw.map(k => ({ t: k[0], o: parseFloat(k[1]), h: parseFloat(k[2]), l: parseFloat(k[3]), c: parseFloat(k[4]), v: parseFloat(k[5]) }));
    } else if (source === 'oi_history') {
      const r = await fetch(`https://fapi.binance.com/futures/data/openInterestHist?symbol=${params.symbol||'BTCUSDT'}&period=${params.period||'4h'}&limit=${params.limit||'50'}`, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10000) });
      data = await r.json();
    } else if (source === 'longshort') {
      const r = await fetch(`https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${params.symbol||'BTCUSDT'}&period=${params.period||'4h'}&limit=${params.limit||'50'}`, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10000) });
      data = await r.json();
    } else if (source === 'taker_volume') {
      const r = await fetch(`https://fapi.binance.com/futures/data/takerlongshortRatio?symbol=${params.symbol||'BTCUSDT'}&period=${params.period||'4h'}&limit=${params.limit||'50'}`, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10000) });
      data = await r.json();
    } else if (source === 'funding_current') {
      const r = await fetch(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${params.symbol||'BTCUSDT'}`, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) });
      data = await r.json();
    } else if (source === 'futures_ticker') {
      const r = await fetch(`https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${params.symbol||'BTCUSDT'}`, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) });
      data = await r.json();
    } else if (source === 'spot_tickers') {
      const r = await fetch('https://api.binance.com/api/v3/ticker/24hr', { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(12000) });
      const all = await r.json();
      data = all.filter(t => t.symbol.endsWith('USDT') && parseFloat(t.quoteVolume) > 10000000)
        .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume)).slice(0, 50)
        .map(t => ({ symbol: t.symbol, price: parseFloat(t.lastPrice), change: parseFloat(t.priceChangePercent), volume: parseFloat(t.quoteVolume), high: parseFloat(t.highPrice), low: parseFloat(t.lowPrice) }));

    // ══════════════════════════════════════════════════════════════════
    // ─── ASTRO-TECHNICAL FUSION ENGINE v5.0 ──────────────────────────
    // ══════════════════════════════════════════════════════════════════
    } else if (source === 'fusion') {
      const sym = params.symbol || 'BTCUSDT';

      // ── FETCH ALL DATA PARALLEL ──────────────────────────────────
      const [
        raw1h, raw4h, raw1d, raw1w,
        oiRes, lsRes, takerRes, fundRes, fngRes
      ] = await Promise.allSettled([
        fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=1h&limit=200`).then(r=>r.json()),
        fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=4h&limit=200`).then(r=>r.json()),
        fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=1d&limit=100`).then(r=>r.json()),
        fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=1w&limit=52`).then(r=>r.json()),
        fetch(`https://fapi.binance.com/futures/data/openInterestHist?symbol=${sym}&period=4h&limit=24`).then(r=>r.json()),
        fetch(`https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${sym}&period=4h&limit=10`).then(r=>r.json()),
        fetch(`https://fapi.binance.com/futures/data/takerlongshortRatio?symbol=${sym}&period=4h&limit=10`).then(r=>r.json()),
        fetch(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${sym}`).then(r=>r.json()),
        fetch(`https://api.alternative.me/fng/?limit=30&format=json`).then(r=>r.json()),
      ]);

      const parseK = raw => Array.isArray(raw) ? raw.map(k => ({
        t: k[0], o: parseFloat(k[1]), h: parseFloat(k[2]),
        l: parseFloat(k[3]), c: parseFloat(k[4]), v: parseFloat(k[5])
      })) : [];

      const K1h = raw1h.status==='fulfilled' ? parseK(raw1h.value) : [];
      const K4h = raw4h.status==='fulfilled' ? parseK(raw4h.value) : [];
      const K1d = raw1d.status==='fulfilled' ? parseK(raw1d.value) : [];
      const K1w = raw1w.status==='fulfilled' ? parseK(raw1w.value) : [];

      if (!K4h.length) throw new Error('No market data available');
      const currentPrice = K4h[K4h.length-1].c;
      const nowMs = Date.now();
      const nowDate = new Date(nowMs);

      // ── MATH ENGINE ──────────────────────────────────────────────
      const EMA = (c, p) => { if(c.length<p) return c[c.length-1]; const k=2/(p+1); let e=c.slice(0,p).reduce((a,b)=>a+b,0)/p; for(let i=p;i<c.length;i++) e=c[i]*k+e*(1-k); return e; };
      const RSI = (c, p=14) => { if(c.length<p+1) return 50; let g=0,l=0; for(let i=c.length-p;i<c.length;i++){const d=c[i]-c[i-1];if(d>0)g+=d;else l-=d;} return 100-(100/(1+g/(l||0.001))); };
      const ATR = (K, p=14) => { const t=K.slice(1).map((k,i)=>Math.max(k.h-k.l,Math.abs(k.h-K[i].c),Math.abs(k.l-K[i].c))); return t.slice(-p).reduce((a,b)=>a+b,0)/p; };
      const STDEV = (arr) => { const m=arr.reduce((a,b)=>a+b,0)/arr.length; return Math.sqrt(arr.reduce((s,v)=>s+(v-m)**2,0)/arr.length); };
      const BB = (c, p=20) => { const s=c.slice(-p); const m=s.reduce((a,b)=>a+b,0)/p; const sd=STDEV(s); return {upper:m+2*sd,lower:m-2*sd,mid:m,sd,width:4*sd/m}; };
      const STOCH = (K, p=14) => { const r=K.slice(-p); const hi=Math.max(...r.map(k=>k.h)); const lo=Math.min(...r.map(k=>k.l)); return hi===lo?50:((K[K.length-1].c-lo)/(hi-lo))*100; };
      const MACD = (c) => ({ macd: EMA(c,12)-EMA(c,26), signal: EMA(c.slice(-9).map((_,i)=>EMA(c.slice(0,c.length-8+i+1),12)-EMA(c.slice(0,c.length-8+i+1),26)),9) });
      const VWAP = (K) => { let pv=0,v=0; K.slice(-20).forEach(k=>{pv+=((k.h+k.l+k.c)/3)*k.v;v+=k.v;}); return pv/v; };

      // ── SWING FINDER ─────────────────────────────────────────────
      const swings = (K, lb=4) => {
        const h=[],l=[];
        for(let i=lb;i<K.length-lb;i++){
          let iH=true,iL=true;
          for(let j=i-lb;j<=i+lb;j++){if(j===i)continue;if(K[j].h>=K[i].h)iH=false;if(K[j].l<=K[i].l)iL=false;}
          if(iH)h.push({i,p:K[i].h,t:K[i].t});
          if(iL)l.push({i,p:K[i].l,t:K[i].t});
        }
        return {h,l};
      };

      const sw4h = swings(K4h,4);
      const sw1d = swings(K1d,3);

      // ── INDICATOR SUITE ───────────────────────────────────────────
      const c4h=K4h.map(k=>k.c), c1d=K1d.map(k=>k.c), c1w=K1w.map(k=>k.c);
      const atr4h=ATR(K4h), atr1d=ATR(K1d);
      const bb4h=BB(c4h);
      const stoch4h=STOCH(K4h);
      const macd4h=MACD(c4h);
      const vwap4h=VWAP(K4h);
      const rsi1h=RSI(K1h.map(k=>k.c));
      const rsi4h=RSI(c4h);
      const rsi1d=RSI(c1d);
      const ema20_4h=EMA(c4h,20), ema50_4h=EMA(c4h,50), ema200_4h=EMA(c4h,200);
      const ema50_1d=EMA(c1d,50), ema200_1d=EMA(c1d,200);
      const ema20_1w=EMA(c1w,20), ema50_1w=EMA(c1w,50);

      // ── MTF ANALYSIS ─────────────────────────────────────────────
      const mtfAnalyze = (K, closes) => {
        const p=closes[closes.length-1];
        const e200=EMA(closes,Math.min(200,closes.length));
        const e50=EMA(closes,Math.min(50,closes.length));
        const e20=EMA(closes,Math.min(20,closes.length));
        const rsi=RSI(closes);
        const mac=EMA(closes,12)-EMA(closes,26);
        const last10=K.slice(-10);
        const hh=last10[last10.length-1].h>last10[0].h;
        const hl=last10[last10.length-1].l>last10[0].l;
        let s=0;
        if(p>e200)s+=2;else s-=2;
        if(p>e50)s+=1;else s-=1;
        if(e20>e50)s+=1;else s-=1;
        if(mac>0)s+=1;else s-=1;
        if(rsi>50&&rsi<70)s+=1;else if(rsi<50&&rsi>30)s-=1;
        if(hh&&hl)s+=2;else s-=2;
        return { s, rsi, mac, e200, e50, e20, p, bull:s>=4, bear:s<=-4, trend:s>=4?'UPTREND':s<=-4?'DOWNTREND':s>=2?'BULL BIAS':s<=-2?'BEAR BIAS':'RANGING' };
      };

      const tf1h=mtfAnalyze(K1h,K1h.map(k=>k.c));
      const tf4h=mtfAnalyze(K4h,c4h);
      const tf1d=mtfAnalyze(K1d,c1d);
      const tf1w=mtfAnalyze(K1w,c1w);

      // MTF composite score
      const mtfBull=(tf1w.bull?4:tf1w.s>0?2:0)+(tf1d.bull?3:tf1d.s>0?1:0)+(tf4h.bull?3:tf4h.s>0?1:0)+(tf1h.bull?2:tf1h.s>0?1:0);
      const mtfBear=(tf1w.bear?4:tf1w.s<0?2:0)+(tf1d.bear?3:tf1d.s<0?1:0)+(tf4h.bear?3:tf4h.s<0?1:0)+(tf1h.bear?2:tf1h.s<0?1:0);

      // ── MARKET STRUCTURE ─────────────────────────────────────────
      const rH=sw4h.h.slice(-6), rL=sw4h.l.slice(-6);
      let structBias='NEUTRAL', bosType=null, chochType=null;
      if(rH.length>=2&&rL.length>=2){
        const hhPat=rH[rH.length-1].p>rH[rH.length-2].p;
        const hlPat=rL[rL.length-1].p>rL[rL.length-2].p;
        const lhPat=rH[rH.length-1].p<rH[rH.length-2].p;
        const llPat=rL[rL.length-1].p<rL[rL.length-2].p;
        if(hhPat&&hlPat){structBias='BULLISH';bosType={type:'BULL',price:rH[rH.length-1].p,label:'BOS Bullish — HH+HL structure'};}
        else if(lhPat&&llPat){structBias='BEARISH';bosType={type:'BEAR',price:rL[rL.length-1].p,label:'BOS Bearish — LH+LL structure'};}
        else if(hhPat&&!hlPat&&rL[rL.length-1].p>rL[rL.length-2].p){chochType={type:'BULL',label:'CHoCH Bullish — structure reversal up'};}
        else if(lhPat&&!llPat&&rH[rH.length-1].p<rH[rH.length-2].p){chochType={type:'BEAR',label:'CHoCH Bearish — structure reversal down'};}
        else if(hhPat||hlPat) structBias='BULLISH_WEAK';
        else if(lhPat||llPat) structBias='BEARISH_WEAK';
      }

      // ── ORDER BLOCKS ─────────────────────────────────────────────
      const OBs=[];
      for(let i=2;i<K4h.length-1;i++){
        const c=K4h[i],n=K4h[i+1];
        if(c.c<c.o&&n.c>n.o&&(n.c-n.o)/n.o>0.005){
          const hi=Math.max(c.o,c.c),lo=Math.min(c.o,c.c);
          if(currentPrice>lo*0.97&&currentPrice<hi*1.2)
            OBs.push({type:'BULL',hi,lo,mid:(hi+lo)/2,t:c.t,vol:c.v,dist:Math.abs(currentPrice-(hi+lo)/2)/currentPrice*100});
        }
        if(c.c>c.o&&n.c<n.o&&(n.o-n.c)/n.o>0.005){
          const hi=Math.max(c.o,c.c),lo=Math.min(c.o,c.c);
          if(currentPrice<hi*1.03&&currentPrice>lo*0.8)
            OBs.push({type:'BEAR',hi,lo,mid:(hi+lo)/2,t:c.t,vol:c.v,dist:Math.abs(currentPrice-(hi+lo)/2)/currentPrice*100});
        }
      }
      const bullOBs=OBs.filter(o=>o.type==='BULL').sort((a,b)=>a.dist-b.dist);
      const bearOBs=OBs.filter(o=>o.type==='BEAR').sort((a,b)=>a.dist-b.dist);

      // ── FVGs ─────────────────────────────────────────────────────
      const FVGs=[];
      for(let i=1;i<K4h.length-1;i++){
        const p=K4h[i-1],n=K4h[i+1];
        if(n.l>p.h&&(n.l-p.h)/currentPrice>0.001) FVGs.push({type:'BULL',hi:n.l,lo:p.h,mid:(n.l+p.h)/2,t:K4h[i].t,filled:currentPrice<p.h});
        if(n.h<p.l&&(p.l-n.h)/currentPrice>0.001) FVGs.push({type:'BEAR',hi:p.l,lo:n.h,mid:(p.l+n.h)/2,t:K4h[i].t,filled:currentPrice>p.l});
      }
      const bullFVGs=FVGs.filter(f=>f.type==='BULL'&&!f.filled).sort((a,b)=>Math.abs(currentPrice-a.mid)-Math.abs(currentPrice-b.mid));
      const bearFVGs=FVGs.filter(f=>f.type==='BEAR'&&!f.filled).sort((a,b)=>Math.abs(currentPrice-a.mid)-Math.abs(currentPrice-b.mid));

      // ── SUPPLY & DEMAND ───────────────────────────────────────────
      const avgVol4h=K4h.slice(-50).reduce((s,k)=>s+k.v,0)/50;
      const SDZ=[];
      for(let i=3;i<K4h.length-1;i++){
        const k=K4h[i],body=Math.abs(k.c-k.o),rng=k.h-k.l;
        if(k.v>avgVol4h*1.5&&rng>0&&body/rng>0.55){
          if(k.c>k.o) SDZ.push({type:'DEMAND',hi:Math.max(k.o,k.c),lo:Math.min(k.o,k.c)-atr4h*0.3,mid:(k.o+k.c)/2,vx:(k.v/avgVol4h).toFixed(1),t:k.t});
          else SDZ.push({type:'SUPPLY',hi:Math.max(k.o,k.c)+atr4h*0.3,lo:Math.min(k.o,k.c),mid:(k.o+k.c)/2,vx:(k.v/avgVol4h).toFixed(1),t:k.t});
        }
      }
      const demZones=SDZ.filter(z=>z.type==='DEMAND').sort((a,b)=>Math.abs(currentPrice-a.mid)-Math.abs(currentPrice-b.mid));
      const supZones=SDZ.filter(z=>z.type==='SUPPLY').sort((a,b)=>Math.abs(currentPrice-a.mid)-Math.abs(currentPrice-b.mid));

      // ── LIQUIDITY POOLS ───────────────────────────────────────────
      const tol=atr4h*0.4;
      const liqPools=[];
      for(let i=0;i<sw4h.h.length-1;i++) for(let j=i+1;j<sw4h.h.length;j++) if(Math.abs(sw4h.h[i].p-sw4h.h[j].p)<tol){liqPools.push({type:'BSL',price:(sw4h.h[i].p+sw4h.h[j].p)/2});break;}
      for(let i=0;i<sw4h.l.length-1;i++) for(let j=i+1;j<sw4h.l.length;j++) if(Math.abs(sw4h.l[i].p-sw4h.l[j].p)<tol){liqPools.push({type:'SSL',price:(sw4h.l[i].p+sw4h.l[j].p)/2});break;}
      const nearBSL=liqPools.filter(l=>l.type==='BSL'&&l.price>currentPrice).sort((a,b)=>a.price-b.price)[0]||null;
      const nearSSL=liqPools.filter(l=>l.type==='SSL'&&l.price<currentPrice).sort((a,b)=>b.price-a.price)[0]||null;

      // ══════════════════════════════════════════════════════════════
      // ── CHART PATTERN ENGINE (15 patterns) ────────────────────────
      // ══════════════════════════════════════════════════════════════
      const chartPatterns = [];
      const last2=K4h.slice(-2), last3=K4h.slice(-3), last5=K4h.slice(-5);
      const last=K4h[K4h.length-1], prev=K4h[K4h.length-2], prev2=K4h[K4h.length-3];

      // 1. Bullish Engulfing
      if(prev.c<prev.o&&last.c>last.o&&last.c>prev.o&&last.o<prev.c&&last.v>prev.v)
        chartPatterns.push({name:'Bullish Engulfing',type:'BULL',str:'HIGH',prob:72,tf:'4H',detail:'Bullish candle menelan candle bearish sebelumnya + volume konfirmasi',action:'LONG entry di close candle atau open candle berikutnya'});

      // 2. Bearish Engulfing
      if(prev.c>prev.o&&last.c<last.o&&last.c<prev.o&&last.o>prev.c&&last.v>prev.v)
        chartPatterns.push({name:'Bearish Engulfing',type:'BEAR',str:'HIGH',prob:71,tf:'4H',detail:'Bearish candle menelan candle bullish + volume konfirmasi',action:'SHORT entry di close atau penurunan berikutnya'});

      // 3. Bullish Pin Bar / Hammer
      const lastBody=Math.abs(last.c-last.o), lastRng=last.h-last.l;
      const lastLW=Math.min(last.c,last.o)-last.l, lastUW=last.h-Math.max(last.c,last.o);
      if(lastRng>0&&lastLW>lastBody*2&&lastUW<lastBody*0.5&&lastRng>atr4h*0.7&&last.c>last.o)
        chartPatterns.push({name:'Bullish Pin Bar',type:'BULL',str:'HIGH',prob:74,tf:'4H',detail:'Ekor panjang bawah menunjukkan rejection kuat dari level support',action:'LONG di close pin bar, SL di bawah ekor'});

      // 4. Bearish Pin Bar / Shooting Star
      if(lastRng>0&&lastUW>lastBody*2&&lastLW<lastBody*0.5&&lastRng>atr4h*0.7&&last.c<last.o)
        chartPatterns.push({name:'Bearish Pin Bar',type:'BEAR',str:'HIGH',prob:73,tf:'4H',detail:'Ekor panjang atas menunjukkan rejection kuat dari resistance',action:'SHORT di close, SL di atas ekor'});

      // 5. Morning Star (3 candles)
      if(prev2.c<prev2.o&&Math.abs(prev.c-prev.o)<atr4h*0.3&&last.c>last.o&&last.c>(prev2.o+prev2.c)/2)
        chartPatterns.push({name:'Morning Star',type:'BULL',str:'HIGH',prob:76,tf:'4H',detail:'3-candle reversal bullish: besar-doji/kecil-besar. Sangat reliabel di support',action:'LONG setelah konfirmasi candle ketiga menutup di atas midpoint'});

      // 6. Evening Star
      if(prev2.c>prev2.o&&Math.abs(prev.c-prev.o)<atr4h*0.3&&last.c<last.o&&last.c<(prev2.o+prev2.c)/2)
        chartPatterns.push({name:'Evening Star',type:'BEAR',str:'HIGH',prob:75,tf:'4H',detail:'3-candle reversal bearish: besar-doji-besar. Sangat reliabel di resistance',action:'SHORT setelah konfirmasi candle ketiga menutup di bawah midpoint'});

      // 7. Inside Bar
      if(last.h<prev.h&&last.l>prev.l){
        const ibDir=tf4h.bull?'BULL':'BEAR';
        chartPatterns.push({name:'Inside Bar',type:ibDir,str:'MEDIUM',prob:65,tf:'4H',detail:`Konsolidasi dalam mother bar. Breakout eksplosif akan terjadi ke arah ${ibDir==='BULL'?'atas':'bawah'}`,action:`Entry pada breakout ${ibDir==='BULL'?'di atas high':'di bawah low'} mother bar`});
      }

      // 8. Double Bottom
      if(rL.length>=2){
        const l1=rL[rL.length-2].p, l2=rL[rL.length-1].p;
        if(Math.abs(l1-l2)/l1<0.015&&currentPrice>Math.max(l1,l2)*1.005)
          chartPatterns.push({name:'Double Bottom',type:'BULL',str:'HIGH',prob:78,tf:'4H',detail:`Support kuat di $${((l1+l2)/2).toFixed(2)}. Reversal bullish dikonfirmasi dengan break neckline`,action:'LONG dengan SL di bawah double bottom, TP setara tinggi neckline'});
      }

      // 9. Double Top
      if(rH.length>=2){
        const h1=rH[rH.length-2].p, h2=rH[rH.length-1].p;
        if(Math.abs(h1-h2)/h1<0.015&&currentPrice<Math.min(h1,h2)*0.995)
          chartPatterns.push({name:'Double Top',type:'BEAR',str:'HIGH',prob:77,tf:'4H',detail:`Resistance kuat di $${((h1+h2)/2).toFixed(2)}. Reversal bearish dikonfirmasi`,action:'SHORT dengan SL di atas double top, TP setara tinggi formasi'});
      }

      // 10. Higher Lows Bull Trend
      if(rL.length>=3){const a=rL.slice(-3);if(a[2].p>a[1].p&&a[1].p>a[0].p)
        chartPatterns.push({name:'Higher Lows Series',type:'BULL',str:'MEDIUM',prob:68,tf:'4H',detail:'Pembeli terus mempertahankan level lebih tinggi — tren bullish sehat',action:'LONG di pullback ke HL terdekat (support dinamis)'});}

      // 11. Lower Highs Bear Trend
      if(rH.length>=3){const a=rH.slice(-3);if(a[2].p<a[1].p&&a[1].p<a[0].p)
        chartPatterns.push({name:'Lower Highs Series',type:'BEAR',str:'MEDIUM',prob:67,tf:'4H',detail:'Penjual terus menekan dari level lebih rendah — tren bearish kuat',action:'SHORT di bounce ke LH terdekat (resistance dinamis)'});}

      // 12. Bollinger Band Squeeze
      if(bb4h.width<0.04)
        chartPatterns.push({name:'BB Squeeze',type:tf4h.bull?'BULL':'BEAR',str:'MEDIUM',prob:63,tf:'4H',detail:`Volatilitas sangat rendah (BB width ${(bb4h.width*100).toFixed(1)}%) — ledakan pergerakan akan terjadi. Bias: ${tf4h.bull?'UP':'DOWN'}`,action:`Siapkan entry setelah breakout arah ${tf4h.bull?'atas':'bawah'} dengan volume konfirmasi`});

      // 13. Golden/Death Cross (EMA)
      if(ema20_4h>ema50_4h&&EMA(c4h.slice(0,-1),20)<EMA(c4h.slice(0,-1),50))
        chartPatterns.push({name:'Golden Cross EMA20/50',type:'BULL',str:'HIGH',prob:71,tf:'4H',detail:'EMA20 baru saja cross di atas EMA50 — sinyal bullish klasik',action:'LONG pada retest EMA20 sebagai support baru'});
      if(ema20_4h<ema50_4h&&EMA(c4h.slice(0,-1),20)>EMA(c4h.slice(0,-1),50))
        chartPatterns.push({name:'Death Cross EMA20/50',type:'BEAR',str:'HIGH',prob:70,tf:'4H',detail:'EMA20 baru saja cross di bawah EMA50 — sinyal bearish klasik',action:'SHORT pada bounce ke EMA20 sebagai resistance baru'});

      // 14. MACD Crossover
      if(macd4h.macd>macd4h.signal&&macd4h.macd-macd4h.signal<atr4h*0.1)
        chartPatterns.push({name:'MACD Bullish Cross',type:'BULL',str:'MEDIUM',prob:64,tf:'4H',detail:'MACD baru cross di atas signal line — momentum bullish dimulai',action:'LONG konfirmasi, entry setelah retest support'});
      if(macd4h.macd<macd4h.signal&&macd4h.signal-macd4h.macd<atr4h*0.1)
        chartPatterns.push({name:'MACD Bearish Cross',type:'BEAR',str:'MEDIUM',prob:63,tf:'4H',detail:'MACD baru cross di bawah signal line — momentum bearish dimulai',action:'SHORT konfirmasi, entry setelah bounce resistance'});

      // 15. RSI Divergence (Price vs RSI)
      if(rH.length>=2&&sw4h.h.length>=2){
        const ph1=rH[rH.length-2].p, ph2=rH[rH.length-1].p;
        const rsi_prev=RSI(c4h.slice(0,sw4h.h[sw4h.h.length-2].i+1));
        if(ph2>ph1&&rsi_prev>rsi4h)
          chartPatterns.push({name:'Bearish RSI Divergence',type:'BEAR',str:'HIGH',prob:73,tf:'4H',detail:'Price membuat high lebih tinggi tapi RSI membuat high lebih rendah — momentum melemah',action:'SHORT pada konfirmasi reversal candle di resistance'});
        if(rL.length>=2){
          const pl1=rL[rL.length-2].p, pl2=rL[rL.length-1].p;
          const rsi_prev2=RSI(c4h.slice(0,sw4h.l[sw4h.l.length-2].i+1));
          if(pl2<pl1&&rsi_prev2<rsi4h)
            chartPatterns.push({name:'Bullish RSI Divergence',type:'BULL',str:'HIGH',prob:74,tf:'4H',detail:'Price membuat low lebih rendah tapi RSI membuat low lebih tinggi — momentum menguat',action:'LONG pada konfirmasi reversal candle di support'});
        }
      }

      // ══════════════════════════════════════════════════════════════
      // ── FINANCIAL ASTROLOGY ENGINE ────────────────────────────────
      // ══════════════════════════════════════════════════════════════
      const astro = (() => {
        const d = nowDate;
        const year = d.getUTCFullYear();
        const month = d.getUTCMonth() + 1;
        const day = d.getUTCDay(); // 0=Sun
        const dayOfMonth = d.getUTCDate();
        const hour = d.getUTCHours();

        // ── 1. MOON PHASE (approximate) ─────────────────────────────
        // Known new moon reference: Jan 11, 2024 (JD 2460320.5)
        const JD = (y, m, dd) => {
          const a = Math.floor((14 - m) / 12);
          const yr = y + 4800 - a;
          const mn = m + 12 * a - 3;
          return dd + Math.floor((153 * mn + 2) / 5) + 365 * yr + Math.floor(yr / 4) - Math.floor(yr / 100) + Math.floor(yr / 400) - 32045;
        };
        const jdNow = JD(year, month, dayOfMonth) + (hour / 24);
        const refNewMoon = 2460320.5; // Jan 11, 2024
        const synodicMonth = 29.53058867;
        const daysSinceNew = ((jdNow - refNewMoon) % synodicMonth + synodicMonth) % synodicMonth;
        const moonPhaseDeg = (daysSinceNew / synodicMonth) * 360;

        let moonPhase, moonEmoji, moonBias, moonProbAdj, moonDetail;
        if (daysSinceNew < 1.5) { moonPhase = 'New Moon'; moonEmoji = '🌑'; moonBias = 'BULL'; moonProbAdj = 8; moonDetail = 'New Moon: siklus baru dimulai. Historis BTC sering reversal atau breakout bullish dalam 3-5 hari setelah New Moon'; }
        else if (daysSinceNew < 6) { moonPhase = 'Waxing Crescent'; moonEmoji = '🌒'; moonBias = 'BULL'; moonProbAdj = 4; moonDetail = 'Waxing Crescent: energy meningkat. Tren yang sedang berlangsung cenderung menguat'; }
        else if (daysSinceNew < 8.5) { moonPhase = 'First Quarter'; moonEmoji = '🌓'; moonBias = 'NEUTRAL'; moonProbAdj = 0; moonDetail = 'First Quarter: titik keputusan. Pasar sering mengalami konsolidasi atau sideways singkat'; }
        else if (daysSinceNew < 13) { moonPhase = 'Waxing Gibbous'; moonEmoji = '🌔'; moonBias = 'BULL'; moonProbAdj = 5; moonDetail = 'Waxing Gibbous: momentum bullish tinggi. Sering terjadi continuation dari tren yang ada'; }
        else if (daysSinceNew < 15.5) { moonPhase = 'Full Moon'; moonEmoji = '🌕'; moonBias = 'NEUTRAL'; moonProbAdj = -3; moonDetail = 'Full Moon: puncak energi = puncak harga potensial. Waspada reversal dan volatilitas tinggi'; }
        else if (daysSinceNew < 20) { moonPhase = 'Waning Gibbous'; moonEmoji = '🌖'; moonBias = 'BEAR'; moonProbAdj = -4; moonDetail = 'Waning Gibbous: energy mulai menurun. Distribusi dan profit taking cenderung terjadi'; }
        else if (daysSinceNew < 22.5) { moonPhase = 'Last Quarter'; moonEmoji = '🌗'; moonBias = 'BEAR'; moonProbAdj = -5; moonDetail = 'Last Quarter: tekanan jual meningkat. Retest level sebelumnya, potensi breakdown'; }
        else if (daysSinceNew < 27) { moonPhase = 'Waning Crescent'; moonEmoji = '🌘'; moonBias = 'BEAR'; moonProbAdj = -3; moonDetail = 'Waning Crescent: akumulasi diam-diam. Smart money sering akumulasi menjelang New Moon berikutnya'; }
        else { moonPhase = 'Dark Moon'; moonEmoji = '🌑'; moonBias = 'BULL'; moonProbAdj = 6; moonDetail = 'Dark Moon: akhir siklus, potensi reversal besar. BTC historis bullish dalam 48 jam setelah dark moon'; }

        const daysToNextNewMoon = synodicMonth - daysSinceNew;
        const daysToFullMoon = daysSinceNew < 14.75 ? 14.75 - daysSinceNew : synodicMonth - daysSinceNew + 14.75;

        // ── 2. PLANETARY CYCLES ──────────────────────────────────────
        // Saturn-Jupiter synodic cycle (≈19.86 years) — macro
        // Mercury retrograde (approximate)
        const mercuryCycle = 115.88; // synodic days
        const mercRef = JD(2024, 4, 1); // approx mercury retrograde ref
        const mercPhase = ((jdNow - mercRef) % mercuryCycle + mercuryCycle) % mercuryCycle;
        const mercRetrograde = mercPhase > 90 && mercPhase < 120; // approx 21 days retrograde per cycle

        // ── 3. SEASONALITY & TEMPORAL CYCLES ────────────────────────
        // Bitcoin 4-year halving cycle
        const halvings = [
          { date: new Date('2012-11-28'), block: 210000 },
          { date: new Date('2016-07-09'), block: 420000 },
          { date: new Date('2020-05-11'), block: 630000 },
          { date: new Date('2024-04-20'), block: 840000 },
        ];
        const lastHalving = halvings[halvings.length - 1];
        const daysSinceHalving = (nowMs - lastHalving.date.getTime()) / (1000 * 60 * 60 * 24);
        let halvingPhase, halvingBias, halvingDetail;
        if (daysSinceHalving < 0) { halvingPhase = 'PRE-HALVING'; halvingBias = 'BULL'; halvingDetail = 'Pre-halving periode: akumulasi institusional tinggi, upside bias kuat'; }
        else if (daysSinceHalving < 90) { halvingPhase = 'POST-HALVING EARLY'; halvingBias = 'NEUTRAL'; halvingDetail = 'Awal post-halving: biasanya sideways 1-3 bulan sebelum bull run dimulai'; }
        else if (daysSinceHalving < 365) { halvingPhase = 'BULL CYCLE EARLY'; halvingBias = 'BULL'; halvingDetail = `Bull cycle dimulai (${Math.round(daysSinceHalving)} hari post-halving). Historis BTC +200-400% dalam periode ini`; }
        else if (daysSinceHalving < 547) { halvingPhase = 'BULL CYCLE PEAK'; halvingBias = 'BULL'; halvingDetail = `Bull cycle mature (${Math.round(daysSinceHalving)} hari). Potensi ATH dalam 6-12 bulan. Peak biasanya 12-18 bulan post-halving`; }
        else if (daysSinceHalving < 730) { halvingPhase = 'DISTRIBUTION'; halvingBias = 'NEUTRAL'; halvingDetail = 'Fase distribusi: smart money mulai keluar. Waspada volatilitas ekstrem'; }
        else if (daysSinceHalving < 1095) { halvingPhase = 'BEAR CYCLE'; halvingBias = 'BEAR'; halvingDetail = 'Bear cycle: akumulasi untuk halving berikutnya. Waktu akumulasi jangka panjang'; }
        else { halvingPhase = 'ACCUMULATION'; halvingBias = 'BULL'; halvingDetail = 'Fase akumulasi pra-halving: historis sangat bullish 12 bulan sebelum halving'; }

        // Monthly seasonality (crypto historical)
        const monthSeasonality = {
          1: { bias: 'BULL', adj: 6, name: 'January', detail: 'January Effect: awal tahun sering bullish, fresh capital masuk pasar' },
          2: { bias: 'BULL', adj: 4, name: 'February', detail: 'February: momentum bull cycle biasanya berlanjut, institutional rebalancing' },
          3: { bias: 'NEUTRAL', adj: 0, name: 'March', detail: 'March: mixed, biasanya terjadi koreksi teknikal setelah rally' },
          4: { bias: 'BULL', adj: 5, name: 'April', detail: 'April: historis salah satu bulan terbaik untuk BTC (Uptober alternative)' },
          5: { bias: 'BEAR', adj: -3, name: 'May', detail: '"Sell in May" efek: distribusi institusional menjelang musim panas' },
          6: { bias: 'BEAR', adj: -4, name: 'June', detail: 'June: summer lull dimulai, volume rendah, downside bias' },
          7: { bias: 'NEUTRAL', adj: -2, name: 'July', detail: 'July: recovery dari summer low, sering terjadi bounce technical' },
          8: { bias: 'NEUTRAL', adj: 2, name: 'August', detail: 'August: biasanya flat atau recovery ringan menjelang Q4' },
          9: { bias: 'BEAR', adj: -5, name: 'September', detail: '"Rektember": historis bulan terburuk untuk crypto, sangat bearish' },
          10: { bias: 'BULL', adj: 8, name: 'October', detail: '"Uptober": historis bulan terbaik untuk BTC, sering dimulai leg up besar' },
          11: { bias: 'BULL', adj: 7, name: 'November', detail: 'November: momentum Q4 bull run, sering ATH territory' },
          12: { bias: 'BULL', adj: 5, name: 'December', detail: 'December: Santa rally crypto, institutional year-end positioning' },
        };
        const currentSeason = monthSeasonality[month];

        // Day of week
        const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const dayBias = {
          0: { bias: 'BULL', adj: 2, detail: 'Sunday: low volume, sering terjadi stop hunt sebelum weekly open' },
          1: { bias: 'BULL', adj: 3, detail: 'Monday: weekly open, institutional orders masuk, biasanya directional' },
          2: { bias: 'NEUTRAL', adj: 1, detail: 'Tuesday: lanjutan dari Monday momentum' },
          3: { bias: 'NEUTRAL', adj: 0, detail: 'Wednesday: midweek, sering terjadi reversal intraday' },
          4: { bias: 'BULL', adj: 2, detail: 'Thursday: momentum menjelang weekend, institutional closing' },
          5: { bias: 'NEUTRAL', adj: -1, detail: 'Friday: profit taking, volume menurun menjelang weekend' },
          6: { bias: 'BEAR', adj: -2, detail: 'Saturday: weekend low volume, sering terjadi manipulation' },
        };
        const currentDayBias = dayBias[day];

        // 4-year cycle position
        const cyclePosition = (daysSinceHalving % 1460) / 1460;

        // ── 4. COMPOSITE ASTRO SCORE ─────────────────────────────────
        let astroBull = 0, astroBear = 0;
        if (moonBias === 'BULL') astroBull += Math.abs(moonProbAdj);
        else if (moonBias === 'BEAR') astroBear += Math.abs(moonProbAdj);

        if (halvingBias === 'BULL') astroBull += 10;
        else if (halvingBias === 'BEAR') astroBear += 10;
        else { astroBull += 3; astroBear += 3; }

        if (currentSeason.bias === 'BULL') astroBull += Math.abs(currentSeason.adj);
        else if (currentSeason.bias === 'BEAR') astroBear += Math.abs(currentSeason.adj);

        if (currentDayBias.bias === 'BULL') astroBull += currentDayBias.adj;
        else if (currentDayBias.bias === 'BEAR') astroBear += Math.abs(currentDayBias.adj);

        if (mercRetrograde) { astroBear += 3; }

        const astroTotal = astroBull + astroBear;
        const astroBullPct = astroTotal > 0 ? Math.round(astroBull / astroTotal * 100) : 50;
        const astroSignal = astroBullPct >= 65 ? 'BULLISH' : astroBullPct <= 35 ? 'BEARISH' : 'NEUTRAL';

        return {
          moonPhase, moonEmoji, moonBias, moonProbAdj, moonDetail,
          daysToNextNewMoon: parseFloat(daysToNextNewMoon.toFixed(1)),
          daysToFullMoon: parseFloat(daysToFullMoon.toFixed(1)),
          daysSinceNew: parseFloat(daysSinceNew.toFixed(1)),
          moonPhaseDeg: parseFloat(moonPhaseDeg.toFixed(1)),
          halvingPhase, halvingBias, halvingDetail,
          daysSinceHalving: Math.round(daysSinceHalving),
          monthName: currentSeason.name,
          monthBias: currentSeason.bias,
          monthAdj: currentSeason.adj,
          monthDetail: currentSeason.detail,
          dayName: dayNames[day],
          dayBias: currentDayBias.bias,
          dayDetail: currentDayBias.detail,
          mercRetrograde, mercRetrogradDetail: mercRetrograde ? '⚠ Mercury Retrograde: komunikasi/kontrak/teknologi sering kacau. Hindari leverage tinggi' : 'Mercury Direct: kondisi normal, tidak ada hambatan planet',
          astroBull, astroBear, astroBullPct, astroSignal,
          cyclePosition: parseFloat((cyclePosition * 100).toFixed(1)),
          nextNewMoonDate: new Date(nowMs + daysToNextNewMoon * 86400000).toLocaleDateString('id-ID'),
          fullMoonDate: new Date(nowMs + daysToFullMoon * 86400000).toLocaleDateString('id-ID'),
        };
      })();

      // ── DERIVATIVES ───────────────────────────────────────────────
      let fundRate=0, lsRatioV=1, takerR=1, fngVal=50, oiChgPct=0;
      if(fundRes.status==='fulfilled') fundRate=parseFloat(fundRes.value.lastFundingRate||0)*100;
      if(lsRes.status==='fulfilled'&&Array.isArray(lsRes.value)&&lsRes.value.length) lsRatioV=parseFloat(lsRes.value[lsRes.value.length-1].longShortRatio);
      if(takerRes.status==='fulfilled'&&Array.isArray(takerRes.value)&&takerRes.value.length) takerR=takerRes.value.slice(-5).reduce((s,v)=>s+parseFloat(v.buySellRatio),0)/5;
      if(fngRes.status==='fulfilled'&&fngRes.value.data) fngVal=parseInt(fngRes.value.data[0].value);
      if(oiRes.status==='fulfilled'&&Array.isArray(oiRes.value)&&oiRes.value.length>=5){
        const ov=oiRes.value.map(o=>parseFloat(o.sumOpenInterest));
        oiChgPct=(ov[ov.length-1]-ov[ov.length-5])/ov[ov.length-5]*100;
      }

      // ── KILL ZONE ─────────────────────────────────────────────────
      const wibH=(nowDate.getUTCHours()+7)%24, wibM=nowDate.getUTCMinutes();
      const wibT=wibH+wibM/60;
      let killZone;
      if(wibT>=2&&wibT<5) killZone={name:'ASIA OPEN',active:true,color:'#a855f7',prob:3,desc:'02:00-05:00 WIB — Asia range establishment'};
      else if(wibT>=8&&wibT<12) killZone={name:'LONDON OPEN',active:true,color:'#4488ff',prob:8,desc:'08:00-12:00 WIB — Highest probability window'};
      else if(wibT>=15&&wibT<17) killZone={name:'LONDON/NY OVERLAP',active:true,color:'#00ffd0',prob:10,desc:'15:00-17:00 WIB — Maximum liquidity'};
      else if(wibT>=19&&wibT<23) killZone={name:'NY OPEN',active:true,color:'#FFB300',prob:7,desc:'19:00-23:00 WIB — High volatility NY session'};
      else{
        const next=wibT<2?{n:'ASIA OPEN',h:2}:wibT<8?{n:'LONDON OPEN',h:8}:wibT<19?{n:'NY OPEN',h:19}:{n:'ASIA OPEN',h:26};
        killZone={name:next.n,active:false,color:'#5a6a7e',prob:0,desc:`Next in ${(next.h-wibT).toFixed(1)}h`};
      }

      // ══════════════════════════════════════════════════════════════
      // ── FUSION SCORING SYSTEM (120 points max) ────────────────────
      // ══════════════════════════════════════════════════════════════
      let bullPts=0, bearPts=0;
      const scoreLog=[];

      // 1. WEEKLY TREND (max 15pts) — highest weight
      if(tf1w.bull){bullPts+=15;scoreLog.push({cat:'Weekly Trend',d:`UPTREND weekly — macro bullish`,pts:15,side:'bull'});}
      else if(tf1w.bear){bearPts+=15;scoreLog.push({cat:'Weekly Trend',d:'DOWNTREND weekly — macro bearish',pts:15,side:'bear'});}
      else if(tf1w.s>0){bullPts+=7;scoreLog.push({cat:'Weekly Trend',d:'Bullish bias weekly',pts:7,side:'bull'});}
      else{bearPts+=7;scoreLog.push({cat:'Weekly Trend',d:'Bearish bias weekly',pts:7,side:'bear'});}

      // 2. DAILY TREND (max 12pts)
      if(tf1d.bull){bullPts+=12;scoreLog.push({cat:'Daily Trend',d:'UPTREND daily',pts:12,side:'bull'});}
      else if(tf1d.bear){bearPts+=12;scoreLog.push({cat:'Daily Trend',d:'DOWNTREND daily',pts:12,side:'bear'});}
      else if(tf1d.s>0){bullPts+=6;scoreLog.push({cat:'Daily Trend',d:'Bullish bias daily',pts:6,side:'bull'});}
      else{bearPts+=6;scoreLog.push({cat:'Daily Trend',d:'Bearish bias daily',pts:6,side:'bear'});}

      // 3. MARKET STRUCTURE (max 12pts)
      if(structBias==='BULLISH'){bullPts+=12;scoreLog.push({cat:'Structure',d:'HH+HL confirmed bullish structure',pts:12,side:'bull'});}
      else if(structBias==='BEARISH'){bearPts+=12;scoreLog.push({cat:'Structure',d:'LH+LL confirmed bearish structure',pts:12,side:'bear'});}
      else if(structBias==='BULLISH_WEAK'){bullPts+=6;scoreLog.push({cat:'Structure',d:'Partial bullish structure',pts:6,side:'bull'});}
      else if(structBias==='BEARISH_WEAK'){bearPts+=6;scoreLog.push({cat:'Structure',d:'Partial bearish structure',pts:6,side:'bear'});}
      if(bosType){if(bosType.type==='BULL'){bullPts+=4;scoreLog.push({cat:'BOS',d:bosType.label,pts:4,side:'bull'});}else{bearPts+=4;scoreLog.push({cat:'BOS',d:bosType.label,pts:4,side:'bear'});}}
      if(chochType){if(chochType.type==='BULL'){bullPts+=5;scoreLog.push({cat:'CHoCH',d:chochType.label,pts:5,side:'bull'});}else{bearPts+=5;scoreLog.push({cat:'CHoCH',d:chochType.label,pts:5,side:'bear'});}}

      // 4. SMC ZONE AT PRICE (max 15pts)
      const nearBullOB=bullOBs[0]||null, nearBearOB=bearOBs[0]||null;
      const nearDem=demZones[0]||null, nearSup=supZones[0]||null;
      if(nearBullOB&&nearBullOB.dist<3){bullPts+=15;scoreLog.push({cat:'SMC Zone',d:`Price at Bullish OB $${nearBullOB.lo.toFixed(2)}-$${nearBullOB.hi.toFixed(2)}`,pts:15,side:'bull'});}
      else if(nearDem&&Math.abs(currentPrice-nearDem.mid)/currentPrice*100<4){bullPts+=12;scoreLog.push({cat:'SMC Zone',d:`Price at Demand Zone ${nearDem.vx}x vol`,pts:12,side:'bull'});}
      else if(nearBearOB&&nearBearOB.dist<3){bearPts+=15;scoreLog.push({cat:'SMC Zone',d:`Price at Bearish OB $${nearBearOB.lo.toFixed(2)}-$${nearBearOB.hi.toFixed(2)}`,pts:15,side:'bear'});}
      else if(nearSup&&Math.abs(nearSup.mid-currentPrice)/currentPrice*100<4){bearPts+=12;scoreLog.push({cat:'SMC Zone',d:`Price at Supply Zone ${nearSup.vx}x vol`,pts:12,side:'bear'});}
      else scoreLog.push({cat:'SMC Zone',d:'Price not at key zone',pts:0,side:'neutral'});

      // 5. CHART PATTERNS (max 12pts)
      const bullPats=chartPatterns.filter(p=>p.type==='BULL'), bearPats=chartPatterns.filter(p=>p.type==='BEAR');
      const strongBull=bullPats.filter(p=>p.str==='HIGH').length, strongBear=bearPats.filter(p=>p.str==='HIGH').length;
      if(strongBull>=2){bullPts+=12;scoreLog.push({cat:'Patterns',d:`${strongBull} HIGH confidence bull patterns`,pts:12,side:'bull'});}
      else if(bullPats.length>=2){bullPts+=8;scoreLog.push({cat:'Patterns',d:`${bullPats.length} bullish patterns: ${bullPats.map(p=>p.name).join(', ')}`,pts:8,side:'bull'});}
      else if(bullPats.length===1){bullPts+=4;scoreLog.push({cat:'Patterns',d:bullPats[0].name,pts:4,side:'bull'});}
      else if(strongBear>=2){bearPts+=12;scoreLog.push({cat:'Patterns',d:`${strongBear} HIGH confidence bear patterns`,pts:12,side:'bear'});}
      else if(bearPats.length>=2){bearPts+=8;scoreLog.push({cat:'Patterns',d:`${bearPats.length} bearish patterns`,pts:8,side:'bear'});}
      else if(bearPats.length===1){bearPts+=4;scoreLog.push({cat:'Patterns',d:bearPats[0].name,pts:4,side:'bear'});}
      else scoreLog.push({cat:'Patterns',d:'No significant pattern',pts:0,side:'neutral'});

      // 6. ASTROLOGY COMPOSITE (max 10pts)
      const astroPts=Math.min(Math.abs(astro.astroBullPct-50)/5,10);
      if(astro.astroSignal==='BULLISH'){bullPts+=Math.round(astroPts);scoreLog.push({cat:'Astrology',d:`${astro.moonEmoji} ${astro.moonPhase} + ${astro.halvingPhase} + ${astro.monthName} seasonality`,pts:Math.round(astroPts),side:'bull'});}
      else if(astro.astroSignal==='BEARISH'){bearPts+=Math.round(astroPts);scoreLog.push({cat:'Astrology',d:`${astro.moonEmoji} ${astro.moonPhase} + bearish cycle alignment`,pts:Math.round(astroPts),side:'bear'});}
      else scoreLog.push({cat:'Astrology',d:`${astro.moonEmoji} ${astro.moonPhase} — neutral astro window`,pts:0,side:'neutral'});

      // 7. RSI CONFLUENCE (max 8pts)
      if(rsi1d<35&&rsi4h<40){bullPts+=8;scoreLog.push({cat:'RSI',d:`RSI 4H ${rsi4h.toFixed(0)} + 1D ${rsi1d.toFixed(0)} oversold`,pts:8,side:'bull'});}
      else if(rsi1d>68&&rsi4h>65){bearPts+=8;scoreLog.push({cat:'RSI',d:`RSI 4H ${rsi4h.toFixed(0)} + 1D ${rsi1d.toFixed(0)} overbought`,pts:8,side:'bear'});}
      else if(rsi4h<40){bullPts+=4;scoreLog.push({cat:'RSI',d:`RSI 4H ${rsi4h.toFixed(0)} oversold`,pts:4,side:'bull'});}
      else if(rsi4h>65){bearPts+=4;scoreLog.push({cat:'RSI',d:`RSI 4H ${rsi4h.toFixed(0)} overbought`,pts:4,side:'bear'});}
      else scoreLog.push({cat:'RSI',d:`RSI 4H ${rsi4h.toFixed(0)} neutral`,pts:0,side:'neutral'});

      // 8. DERIVATIVES (max 10pts)
      let dBull=0,dBear=0,dLog=[];
      if(fundRate<-0.04){dBull+=3;dLog.push(`FR ${fundRate.toFixed(4)}% neg`);}else if(fundRate>0.08){dBear+=3;dLog.push(`FR ${fundRate.toFixed(4)}% high`);}
      if(lsRatioV<0.85){dBull+=3;dLog.push(`L/S ${lsRatioV.toFixed(2)} retail short`);}else if(lsRatioV>1.9){dBear+=3;dLog.push(`L/S ${lsRatioV.toFixed(2)} retail long`);}
      if(takerR>1.12){dBull+=4;dLog.push(`Taker ${takerR.toFixed(2)} aggressive buy`);}else if(takerR<0.88){dBear+=4;dLog.push(`Taker ${takerR.toFixed(2)} aggressive sell`);}
      if(oiChgPct>3&&tf4h.bull){dBull+=3;}else if(oiChgPct>3&&tf4h.bear){dBear+=3;}
      if(dBull>dBear){bullPts+=Math.min(dBull,10);scoreLog.push({cat:'Derivatives',d:dLog.join(' | ')||'Bullish derivatives',pts:Math.min(dBull,10),side:'bull'});}
      else if(dBear>dBull){bearPts+=Math.min(dBear,10);scoreLog.push({cat:'Derivatives',d:dLog.join(' | ')||'Bearish derivatives',pts:Math.min(dBear,10),side:'bear'});}
      else scoreLog.push({cat:'Derivatives',d:'Neutral derivatives',pts:0,side:'neutral'});

      // 9. LIQUIDITY TARGET (max 5pts)
      if(nearBSL&&((nearBSL.price-currentPrice)/currentPrice*100)<8){bullPts+=5;scoreLog.push({cat:'Liquidity',d:`BSL target $${nearBSL.price.toFixed(2)} — price magnet`,pts:5,side:'bull'});}
      if(nearSSL&&((currentPrice-nearSSL.price)/currentPrice*100)<8){bearPts+=5;scoreLog.push({cat:'Liquidity',d:`SSL target $${nearSSL.price.toFixed(2)} — price magnet`,pts:5,side:'bear'});}

      // 10. KILL ZONE BONUS (max 5pts)
      if(killZone.active){bullPts+=killZone.prob;bearPts+=killZone.prob;scoreLog.push({cat:'Kill Zone',d:`${killZone.name} active`,pts:killZone.prob,side:'both'});}

      // ── FINAL CALCULATION ─────────────────────────────────────────
      const totalMax=Math.max(bullPts,bearPts);
      const biasDir=bullPts>bearPts?'LONG':bearPts>bullPts?'SHORT':'NEUTRAL';
      // Probability: normalized to realistic range (50-92%)
      const rawProb=Math.min((totalMax/110)*100,95);
      const probability=Math.round(50+rawProb*0.42);

      // Sniper filter
      const mtfOK=(biasDir==='LONG'&&mtfBull>=6)||(biasDir==='SHORT'&&mtfBear>=6);
      const zoneOK=scoreLog.some(s=>s.cat==='SMC Zone'&&s.pts>=12);
      const patternOK=scoreLog.some(s=>s.cat==='Patterns'&&s.pts>=4);

      let decision, decColor;
      let entryCard=null;

      if(probability>=82&&mtfOK&&zoneOK){
        decision=biasDir==='LONG'?'🎯 SNIPER LONG — HIGH PROBABILITY':'🎯 SNIPER SHORT — HIGH PROBABILITY';
        decColor=biasDir==='LONG'?'#00ffd0':'#ff4466';
      } else if(probability>=72&&mtfOK){
        decision=biasDir==='LONG'?'⏳ LONG SETUP — WAIT FOR ZONE':'⏳ SHORT SETUP — WAIT FOR ZONE';
        decColor='#FFB300';
      } else if(probability>=65){
        decision=biasDir==='LONG'?'👀 LONG BIAS — LOW CONFIDENCE':'👀 SHORT BIAS — LOW CONFIDENCE';
        decColor='#a855f7';
      } else {
        decision='⛔ NO TRADE — WAIT FOR SETUP';
        decColor='#5a6a7e';
      }

      // Build entry card only for high prob
      if(probability>=72&&biasDir!=='NEUTRAL'){
        const isLong=biasDir==='LONG';
        let entry=currentPrice, slP, tp1P, tp2P, tp3P;
        if(isLong){
          const z=nearBullOB?nearBullOB.hi:nearDem?nearDem.hi:null;
          entry=z&&z<currentPrice*1.005?z:currentPrice;
          const slCandidates=[nearBullOB?nearBullOB.lo*0.999:null,nearSSL?nearSSL.price*0.998:null,entry-atr4h*1.5].filter(Boolean);
          slP=Math.max(...slCandidates);
          const dist=entry-slP;
          tp1P=bullFVGs[0]?Math.min(bullFVGs[0].hi,entry+dist*1.5):entry+dist*1.5;
          tp2P=entry+dist*2.5;
          tp3P=nearBSL?nearBSL.price*0.998:entry+dist*4;
        } else {
          const z=nearBearOB?nearBearOB.lo:nearSup?nearSup.lo:null;
          entry=z&&z>currentPrice*0.995?z:currentPrice;
          const slCandidates=[nearBearOB?nearBearOB.hi*1.001:null,nearBSL?nearBSL.price*1.001:null,entry+atr4h*1.5].filter(Boolean);
          slP=Math.min(...slCandidates);
          const dist=slP-entry;
          tp1P=bearFVGs[0]?Math.max(bearFVGs[0].lo,entry-dist*1.5):entry-dist*1.5;
          tp2P=entry-dist*2.5;
          tp3P=nearSSL?nearSSL.price*1.002:entry-dist*4;
        }
        const dist2=Math.abs(entry-slP);
        entryCard={
          direction:biasDir, entry:parseFloat(entry.toFixed(8)),
          sl:parseFloat(slP.toFixed(8)), tp1:parseFloat(tp1P.toFixed(8)),
          tp2:parseFloat(tp2P.toFixed(8)), tp3:parseFloat(tp3P.toFixed(8)),
          rr1:parseFloat((Math.abs(tp1P-entry)/dist2).toFixed(2)),
          rr2:parseFloat((Math.abs(tp2P-entry)/dist2).toFixed(2)),
          rr3:parseFloat((Math.abs(tp3P-entry)/dist2).toFixed(2)),
          slPct:parseFloat((dist2/entry*100).toFixed(2)),
          obZone:isLong?nearBullOB:nearBearOB,
          demZone:isLong?nearDem:nearSup,
          liqTarget:isLong?nearBSL:nearSSL,
          fvgTarget:isLong?bullFVGs[0]:bearFVGs[0],
          invalidation:`Close ${biasDir==='LONG'?'below':'above'} $${parseFloat(slP.toFixed(8))} invalidates this trade`
        };
      }

      data = {
        symbol:sym, timestamp:nowMs, currentPrice,
        decision, decColor, probability, biasDir,
        entryCard,
        astro,
        killZone,
        mtf:{ bull:mtfBull, bear:mtfBear, aligned:mtfOK, tf1h:tf1h.trend, tf4h:tf4h.trend, tf1d:tf1d.trend, tf1w:tf1w.trend },
        structure:{ bias:structBias, bos:bosType, choch:chochType },
        smc:{ bullOBs:bullOBs.slice(0,3), bearOBs:bearOBs.slice(0,3), nearBullOB, nearBearOB, nearDem, nearSup, bullFVG:bullFVGs[0]||null, bearFVG:bearFVGs[0]||null },
        liquidity:{ nearBSL, nearSSL },
        chartPatterns:chartPatterns.slice(0,8),
        scoreLog,
        score:{ bull:bullPts, bear:bearPts },
        indicators:{
          rsi1h:parseFloat(rsi1h.toFixed(1)), rsi4h:parseFloat(rsi4h.toFixed(1)), rsi1d:parseFloat(rsi1d.toFixed(1)),
          stoch4h:parseFloat(stoch4h.toFixed(1)), macd4h:parseFloat(macd4h.macd.toFixed(4)),
          bb4h_pos:parseFloat(((currentPrice-bb4h.lower)/(bb4h.upper-bb4h.lower)*100).toFixed(1)),
          bb4h_width:parseFloat((bb4h.width*100).toFixed(2)),
          vwap4h:parseFloat(vwap4h.toFixed(4)),
          ema20_4h:parseFloat(ema20_4h.toFixed(4)), ema50_4h:parseFloat(ema50_4h.toFixed(4)), ema200_4h:parseFloat(ema200_4h.toFixed(4)),
          fundRate:parseFloat(fundRate.toFixed(4)), lsRatio:parseFloat(lsRatioV.toFixed(2)),
          takerRatio:parseFloat(takerR.toFixed(3)), fng:fngVal, oiChg:parseFloat(oiChgPct.toFixed(2)),
          atr4h:parseFloat(atr4h.toFixed(6)), atr1d:parseFloat(atr1d.toFixed(6))
        }
      };

    // ─── CONFLUENCE LEGACY ────────────────────────────────────────
    } else if (source === 'confluence') {
      const sym = params.symbol || 'BTCUSDT';
      const [k4h,k1d,oiH,lsR,taker,fund,depth,fng] = await Promise.allSettled([
        fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=4h&limit=200`).then(r=>r.json()),
        fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=1d&limit=100`).then(r=>r.json()),
        fetch(`https://fapi.binance.com/futures/data/openInterestHist?symbol=${sym}&period=4h&limit=20`).then(r=>r.json()),
        fetch(`https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${sym}&period=4h&limit=10`).then(r=>r.json()),
        fetch(`https://fapi.binance.com/futures/data/takerlongshortRatio?symbol=${sym}&period=4h&limit=10`).then(r=>r.json()),
        fetch(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${sym}`).then(r=>r.json()),
        fetch(`https://api.binance.com/api/v3/depth?symbol=${sym}&limit=50`).then(r=>r.json()),
        fetch(`https://api.alternative.me/fng/?limit=1&format=json`).then(r=>r.json()),
      ]);
      const E=(c,p)=>{if(c.length<p)return c[c.length-1];const k=2/(p+1);let e=c.slice(0,p).reduce((a,b)=>a+b,0)/p;for(let i=p;i<c.length;i++)e=c[i]*k+e*(1-k);return e;};
      const R=(c,p=14)=>{if(c.length<p+1)return 50;let g=0,l=0;for(let i=c.length-p;i<c.length;i++){const d=c[i]-c[i-1];if(d>0)g+=d;else l-=d;}return 100-(100/(1+g/(l||0.001)));};
      const sc={bull:0,bear:0,signals:[]};
      if(k1d.status==='fulfilled'&&Array.isArray(k1d.value)){const c=k1d.value.map(k=>parseFloat(k[4]));const p=c[c.length-1];const e200=E(c,Math.min(200,c.length));const e50=E(c,Math.min(50,c.length));if(p>e200){sc.bull+=2;sc.signals.push({name:'HTF Trend',value:'BULLISH',detail:`Price>EMA200($${e200.toFixed(0)})`,weight:2,side:'bull'});}else{sc.bear+=2;sc.signals.push({name:'HTF Trend',value:'BEARISH',detail:`Price<EMA200($${e200.toFixed(0)})`,weight:2,side:'bear'});}if(e50>e200){sc.bull+=1;sc.signals.push({name:'EMA Cross',value:'GOLDEN',detail:'EMA50>EMA200',weight:1,side:'bull'});}else{sc.bear+=1;sc.signals.push({name:'EMA Cross',value:'DEATH',detail:'EMA50<EMA200',weight:1,side:'bear'});}}
      if(k4h.status==='fulfilled'&&Array.isArray(k4h.value)){const c=k4h.value.map(k=>parseFloat(k[4]));const rsi=R(c);const macd=E(c,12)-E(c,26);if(rsi<35){sc.bull+=2;sc.signals.push({name:'RSI 4H',value:rsi.toFixed(1),detail:'Oversold',weight:2,side:'bull'});}else if(rsi>70){sc.bear+=2;sc.signals.push({name:'RSI 4H',value:rsi.toFixed(1),detail:'Overbought',weight:2,side:'bear'});}else if(rsi<50){sc.bull+=1;sc.signals.push({name:'RSI 4H',value:rsi.toFixed(1),detail:'Below Mid',weight:1,side:'bull'});}else{sc.bear+=1;sc.signals.push({name:'RSI 4H',value:rsi.toFixed(1),detail:'Above Mid',weight:1,side:'bear'});}if(macd>0){sc.bull+=1;sc.signals.push({name:'MACD',value:macd.toFixed(2),detail:'Bull',weight:1,side:'bull'});}else{sc.bear+=1;sc.signals.push({name:'MACD',value:macd.toFixed(2),detail:'Bear',weight:1,side:'bear'});}}
      if(oiH.status==='fulfilled'&&Array.isArray(oiH.value)&&oiH.value.length>=5){const o=oiH.value.map(x=>parseFloat(x.sumOpenInterest));const ch=((o[o.length-1]-o[o.length-5])/o[o.length-5])*100;const c4=k4h.status==='fulfilled'?k4h.value.map(k=>parseFloat(k[4])):[];const pu=c4.length>5&&c4[c4.length-1]>c4[c4.length-5];if(ch>2&&pu){sc.bull+=2;sc.signals.push({name:'OI+Price',value:`+${ch.toFixed(1)}%`,detail:'Long Buildup',weight:2,side:'bull'});}else if(ch>2&&!pu){sc.bear+=2;sc.signals.push({name:'OI+Price',value:`+${ch.toFixed(1)}%`,detail:'Short Buildup',weight:2,side:'bear'});}else sc.signals.push({name:'OI+Price',value:`${ch.toFixed(1)}%`,detail:'Neutral',weight:0,side:'neutral'});}
      if(lsR.status==='fulfilled'&&Array.isArray(lsR.value)&&lsR.value.length){const ls=parseFloat(lsR.value[lsR.value.length-1].longShortRatio);if(ls<0.9){sc.bull+=2;sc.signals.push({name:'L/S',value:ls.toFixed(2),detail:'Retail Short→Long',weight:2,side:'bull'});}else if(ls>1.8){sc.bear+=2;sc.signals.push({name:'L/S',value:ls.toFixed(2),detail:'Retail Long→Short',weight:2,side:'bear'});}else sc.signals.push({name:'L/S',value:ls.toFixed(2),detail:'Balanced',weight:0,side:'neutral'});}
      if(taker.status==='fulfilled'&&Array.isArray(taker.value)&&taker.value.length){const avg=taker.value.slice(-5).reduce((s,v)=>s+parseFloat(v.buySellRatio),0)/5;if(avg>1.1){sc.bull+=2;sc.signals.push({name:'Taker',value:avg.toFixed(2),detail:'Buyers Agg',weight:2,side:'bull'});}else if(avg<0.9){sc.bear+=2;sc.signals.push({name:'Taker',value:avg.toFixed(2),detail:'Sellers Agg',weight:2,side:'bear'});}else sc.signals.push({name:'Taker',value:avg.toFixed(2),detail:'Neutral',weight:0,side:'neutral'});}
      if(fund.status==='fulfilled'&&fund.value.lastFundingRate){const fr=parseFloat(fund.value.lastFundingRate)*100;if(fr<-0.05){sc.bull+=2;sc.signals.push({name:'Funding',value:`${fr.toFixed(4)}%`,detail:'Neg→Long',weight:2,side:'bull'});}else if(fr>0.1){sc.bear+=2;sc.signals.push({name:'Funding',value:`${fr.toFixed(4)}%`,detail:'High→Short',weight:2,side:'bear'});}else sc.signals.push({name:'Funding',value:`${fr.toFixed(4)}%`,detail:'Neutral',weight:0,side:'neutral'});}
      if(fng.status==='fulfilled'&&fng.value.data){const f=parseInt(fng.value.data[0].value);if(f<=20){sc.bull+=2;sc.signals.push({name:'F&G',value:`${f}`,detail:'Ext Fear',weight:2,side:'bull'});}else if(f>=80){sc.bear+=2;sc.signals.push({name:'F&G',value:`${f}`,detail:'Ext Greed',weight:2,side:'bear'});}else if(f<40){sc.bull+=1;sc.signals.push({name:'F&G',value:`${f}`,detail:'Fear',weight:1,side:'bull'});}else sc.signals.push({name:'F&G',value:`${f}`,detail:'Neutral',weight:0,side:'neutral'});}
      const tw=sc.bull+sc.bear;const bp=tw>0?Math.round(sc.bull/tw*100):50;
      let verdict,strength,action;
      if(bp>=70){verdict='STRONG LONG';strength='HIGH';action='ENTRY VALID';}
      else if(bp>=55){verdict='LONG BIAS';strength='MEDIUM';action='CAUTIOUS LONG';}
      else if(bp<=30){verdict='STRONG SHORT';strength='HIGH';action='ENTRY VALID SHORT';}
      else if(bp<=45){verdict='SHORT BIAS';strength='MEDIUM';action='CAUTIOUS SHORT';}
      else{verdict='NEUTRAL';strength='LOW';action='NO TRADE';}
      data={symbol:sym,timestamp:Date.now(),verdict,strength,action,bullScore:sc.bull,bearScore:sc.bear,bullPct:bp,bearPct:100-bp,signals:sc.signals};

    } else {
      return res.status(400).json({ error: `Unknown source: ${source}` });
    }

    res.setHeader('Cache-Control', 's-maxage=15');
    return res.status(200).json(data);
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
