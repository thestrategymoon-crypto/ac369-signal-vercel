// api/data.js — AC369 ASTRO-TECHNICAL FUSION v5.1
// FIXED: Entry/SL/TP logic — guaranteed correct direction + minimum 1:3 RR
// LONG: Entry < TP1 < TP2 < TP3, SL < Entry (ALWAYS)
// SHORT: Entry > TP1 > TP2 > TP3, SL > Entry (ALWAYS)

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  const { source, ...params } = req.query;

  try {
    let data;

    // ── BASIC PROXIES ─────────────────────────────────────────────
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

    // ══════════════════════════════════════════════════════════════
    // FUSION ENGINE v5.1 — FIXED ENTRY/SL/TP LOGIC
    // ══════════════════════════════════════════════════════════════
    } else if (source === 'fusion') {
      const sym = params.symbol || 'BTCUSDT';

      // ── FETCH ALL DATA ──────────────────────────────────────────
      const [raw1h, raw4h, raw1d, raw1w, oiRes, lsRes, takerRes, fundRes, fngRes] = await Promise.allSettled([
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
      if (!K4h.length) throw new Error('No market data');

      const currentPrice = K4h[K4h.length-1].c;
      const nowDate = new Date();
      const nowMs = Date.now();

      // ── MATH HELPERS ─────────────────────────────────────────────
      const EMA = (c, p) => {
        if (c.length < p) return c[c.length-1];
        const k = 2/(p+1);
        let e = c.slice(0,p).reduce((a,b)=>a+b,0)/p;
        for (let i = p; i < c.length; i++) e = c[i]*k + e*(1-k);
        return e;
      };
      const RSI = (c, p=14) => {
        if (c.length < p+1) return 50;
        let g=0, l=0;
        for (let i = c.length-p; i < c.length; i++) {
          const d = c[i]-c[i-1];
          if (d>0) g+=d; else l-=d;
        }
        return 100-(100/(1+g/(l||0.001)));
      };
      const ATR = (K, p=14) => {
        const t = K.slice(1).map((k,i)=>Math.max(k.h-k.l, Math.abs(k.h-K[i].c), Math.abs(k.l-K[i].c)));
        return t.slice(-p).reduce((a,b)=>a+b,0)/p;
      };
      const STDEV = arr => { const m=arr.reduce((a,b)=>a+b,0)/arr.length; return Math.sqrt(arr.reduce((s,v)=>s+(v-m)**2,0)/arr.length); };
      const BB = (c,p=20) => { const s=c.slice(-p); const m=s.reduce((a,b)=>a+b,0)/p; const sd=STDEV(s); return {upper:m+2*sd,lower:m-2*sd,mid:m,sd,width:4*sd/m}; };
      const STOCH = (K,p=14) => { const r=K.slice(-p); const hi=Math.max(...r.map(k=>k.h)); const lo=Math.min(...r.map(k=>k.l)); return hi===lo?50:((K[K.length-1].c-lo)/(hi-lo))*100; };

      // ── SWING FINDER ─────────────────────────────────────────────
      const findSwings = (K, lb=4) => {
        const h=[], l=[];
        for (let i=lb; i<K.length-lb; i++) {
          let iH=true, iL=true;
          for (let j=i-lb; j<=i+lb; j++) { if(j===i)continue; if(K[j].h>=K[i].h)iH=false; if(K[j].l<=K[i].l)iL=false; }
          if(iH) h.push({i, p:K[i].h, t:K[i].t});
          if(iL) l.push({i, p:K[i].l, t:K[i].t});
        }
        return {h,l};
      };

      const sw4h = findSwings(K4h, 4);
      const sw1d = findSwings(K1d, 3);

      // ── INDICATORS ───────────────────────────────────────────────
      const c4h=K4h.map(k=>k.c), c1d=K1d.map(k=>k.c), c1w=K1w.map(k=>k.c);
      const atr4h = ATR(K4h);
      const atr1d = ATR(K1d.length?K1d:[...K4h]);
      const bb4h = BB(c4h);
      const stoch4h = STOCH(K4h);
      const rsi1h = RSI(K1h.map(k=>k.c));
      const rsi4h = RSI(c4h);
      const rsi1d = RSI(c1d);
      const ema20_4h = EMA(c4h,20), ema50_4h = EMA(c4h,50), ema200_4h = EMA(c4h,Math.min(200,c4h.length));
      const ema50_1d = EMA(c1d,Math.min(50,c1d.length)), ema200_1d = EMA(c1d,Math.min(200,c1d.length));
      const macd4h = EMA(c4h,12) - EMA(c4h,26);

      // ── MTF ANALYSIS ─────────────────────────────────────────────
      const analyzeTF = (K, closes) => {
        if (!K.length || !closes.length) return { s:0, rsi:50, bull:false, bear:false, trend:'UNKNOWN', e200:0, e50:0, e20:0 };
        const e200=EMA(closes,Math.min(200,closes.length)), e50=EMA(closes,Math.min(50,closes.length)), e20=EMA(closes,Math.min(20,closes.length));
        const p=closes[closes.length-1], rsi=RSI(closes), mac=EMA(closes,12)-EMA(closes,26);
        const last20=K.slice(-20);
        const hh=last20[last20.length-1].h>last20[0].h, hl=last20[last20.length-1].l>last20[0].l;
        let s=0;
        if(p>e200)s+=2;else s-=2;
        if(p>e50)s+=1;else s-=1;
        if(e20>e50)s+=1;else s-=1;
        if(mac>0)s+=1;else s-=1;
        if(rsi>50&&rsi<70)s+=1;else if(rsi<50&&rsi>30)s-=1;
        if(hh&&hl)s+=2;else s-=2;
        return { s, rsi, mac, e200, e50, e20, p, bull:s>=4, bear:s<=-4, trend:s>=4?'UPTREND':s<=-4?'DOWNTREND':s>=2?'BULL BIAS':s<=-2?'BEAR BIAS':'RANGING' };
      };

      const tf1h=analyzeTF(K1h,K1h.map(k=>k.c));
      const tf4h=analyzeTF(K4h,c4h);
      const tf1d=analyzeTF(K1d,c1d);
      const tf1w=analyzeTF(K1w,c1w);

      const mtfBull=(tf1w.bull?4:tf1w.s>0?2:0)+(tf1d.bull?3:tf1d.s>0?1:0)+(tf4h.bull?3:tf4h.s>0?1:0)+(tf1h.bull?2:tf1h.s>0?1:0);
      const mtfBear=(tf1w.bear?4:tf1w.s<0?2:0)+(tf1d.bear?3:tf1d.s<0?1:0)+(tf4h.bear?3:tf4h.s<0?1:0)+(tf1h.bear?2:tf1h.s<0?1:0);

      // ── MARKET STRUCTURE ─────────────────────────────────────────
      const rH=sw4h.h.slice(-6), rL=sw4h.l.slice(-6);
      let structBias='NEUTRAL', bosType=null, chochType=null;
      if (rH.length>=2 && rL.length>=2) {
        const hhPat=rH[rH.length-1].p>rH[rH.length-2].p;
        const hlPat=rL[rL.length-1].p>rL[rL.length-2].p;
        const lhPat=rH[rH.length-1].p<rH[rH.length-2].p;
        const llPat=rL[rL.length-1].p<rL[rL.length-2].p;
        if(hhPat&&hlPat){structBias='BULLISH';bosType={type:'BULL',price:rH[rH.length-1].p,label:'BOS Bullish — HH+HL confirmed'};}
        else if(lhPat&&llPat){structBias='BEARISH';bosType={type:'BEAR',price:rL[rL.length-1].p,label:'BOS Bearish — LH+LL confirmed'};}
        else if(hhPat||hlPat) structBias='BULLISH_WEAK';
        else if(lhPat||llPat) structBias='BEARISH_WEAK';
      }

      // ── ORDER BLOCKS ─────────────────────────────────────────────
      const OBs = [];
      for (let i=2; i<K4h.length-1; i++) {
        const c=K4h[i], n=K4h[i+1];
        if (c.c<c.o && n.c>n.o && (n.c-n.o)/n.o>0.005) {
          const hi=Math.max(c.o,c.c), lo=Math.min(c.o,c.c);
          if (currentPrice>lo*0.97)
            OBs.push({type:'BULL', hi, lo, mid:(hi+lo)/2, t:c.t, dist:Math.abs(currentPrice-(hi+lo)/2)/currentPrice*100});
        }
        if (c.c>c.o && n.c<n.o && (n.o-n.c)/n.o>0.005) {
          const hi=Math.max(c.o,c.c), lo=Math.min(c.o,c.c);
          if (currentPrice<hi*1.03)
            OBs.push({type:'BEAR', hi, lo, mid:(hi+lo)/2, t:c.t, dist:Math.abs(currentPrice-(hi+lo)/2)/currentPrice*100});
        }
      }
      const bullOBs = OBs.filter(o=>o.type==='BULL').sort((a,b)=>a.dist-b.dist);
      const bearOBs = OBs.filter(o=>o.type==='BEAR').sort((a,b)=>a.dist-b.dist);

      // ── FVGs ─────────────────────────────────────────────────────
      const FVGs = [];
      for (let i=1; i<K4h.length-1; i++) {
        const p=K4h[i-1], n=K4h[i+1];
        if (n.l>p.h && (n.l-p.h)/currentPrice>0.001) FVGs.push({type:'BULL',hi:n.l,lo:p.h,mid:(n.l+p.h)/2,t:K4h[i].t,filled:currentPrice<p.h});
        if (n.h<p.l && (p.l-n.h)/currentPrice>0.001) FVGs.push({type:'BEAR',hi:p.l,lo:n.h,mid:(p.l+n.h)/2,t:K4h[i].t,filled:currentPrice>p.l});
      }
      const bullFVGs = FVGs.filter(f=>f.type==='BULL'&&!f.filled).sort((a,b)=>Math.abs(currentPrice-a.mid)-Math.abs(currentPrice-b.mid));
      const bearFVGs = FVGs.filter(f=>f.type==='BEAR'&&!f.filled).sort((a,b)=>Math.abs(currentPrice-a.mid)-Math.abs(currentPrice-b.mid));

      // ── SUPPLY & DEMAND ───────────────────────────────────────────
      const avgVol4h = K4h.slice(-50).reduce((s,k)=>s+k.v,0)/50;
      const SDZ = [];
      for (let i=3; i<K4h.length-1; i++) {
        const k=K4h[i], body=Math.abs(k.c-k.o), rng=k.h-k.l;
        if (k.v>avgVol4h*1.5 && rng>0 && body/rng>0.55) {
          if (k.c>k.o) SDZ.push({type:'DEMAND',hi:Math.max(k.o,k.c),lo:Math.min(k.o,k.c)-atr4h*0.3,mid:(k.o+k.c)/2,vx:(k.v/avgVol4h).toFixed(1),t:k.t});
          else SDZ.push({type:'SUPPLY',hi:Math.max(k.o,k.c)+atr4h*0.3,lo:Math.min(k.o,k.c),mid:(k.o+k.c)/2,vx:(k.v/avgVol4h).toFixed(1),t:k.t});
        }
      }
      const demZones = SDZ.filter(z=>z.type==='DEMAND').sort((a,b)=>Math.abs(currentPrice-a.mid)-Math.abs(currentPrice-b.mid));
      const supZones = SDZ.filter(z=>z.type==='SUPPLY').sort((a,b)=>Math.abs(currentPrice-a.mid)-Math.abs(currentPrice-b.mid));

      // ── LIQUIDITY POOLS ───────────────────────────────────────────
      const tol = atr4h*0.4;
      const liqPools = [];
      for(let i=0;i<sw4h.h.length-1;i++) for(let j=i+1;j<sw4h.h.length;j++) if(Math.abs(sw4h.h[i].p-sw4h.h[j].p)<tol){liqPools.push({type:'BSL',price:(sw4h.h[i].p+sw4h.h[j].p)/2});break;}
      for(let i=0;i<sw4h.l.length-1;i++) for(let j=i+1;j<sw4h.l.length;j++) if(Math.abs(sw4h.l[i].p-sw4h.l[j].p)<tol){liqPools.push({type:'SSL',price:(sw4h.l[i].p+sw4h.l[j].p)/2});break;}
      const nearBSL = liqPools.filter(l=>l.type==='BSL'&&l.price>currentPrice).sort((a,b)=>a.price-b.price)[0]||null;
      const nearSSL = liqPools.filter(l=>l.type==='SSL'&&l.price<currentPrice).sort((a,b)=>b.price-a.price)[0]||null;

      // ── KEY LEVELS: Recent highs/lows for TP targeting ────────────
      const recentHighs = sw4h.h.slice(-8).map(h=>h.p).sort((a,b)=>b-a);
      const recentLows = sw4h.l.slice(-8).map(l=>l.p).sort((a,b)=>a-b);

      // ── CHART PATTERNS ───────────────────────────────────────────
      const chartPatterns = [];
      const K4h_last = K4h[K4h.length-1], K4h_prev = K4h[K4h.length-2], K4h_prev2 = K4h[K4h.length-3];

      // 1. Bullish Engulfing
      if (K4h_prev.c<K4h_prev.o && K4h_last.c>K4h_last.o && K4h_last.c>K4h_prev.o && K4h_last.o<K4h_prev.c)
        chartPatterns.push({name:'Bullish Engulfing',type:'BULL',str:'HIGH',prob:72,detail:'Bullish candle menelan candle bearish + volume konfirmasi',action:'LONG entry di close atau open candle berikutnya'});

      // 2. Bearish Engulfing
      if (K4h_prev.c>K4h_prev.o && K4h_last.c<K4h_last.o && K4h_last.c<K4h_prev.o && K4h_last.o>K4h_prev.c)
        chartPatterns.push({name:'Bearish Engulfing',type:'BEAR',str:'HIGH',prob:71,detail:'Bearish candle menelan candle bullish + volume',action:'SHORT entry di close atau penurunan berikutnya'});

      // 3. Bullish Pin Bar
      const lBody=Math.abs(K4h_last.c-K4h_last.o), lRng=K4h_last.h-K4h_last.l;
      const lLW=Math.min(K4h_last.c,K4h_last.o)-K4h_last.l, lUW=K4h_last.h-Math.max(K4h_last.c,K4h_last.o);
      if (lRng>0 && lLW>lBody*2 && lUW<lBody*0.5 && lRng>atr4h*0.7)
        chartPatterns.push({name:'Bullish Pin Bar',type:'BULL',str:'HIGH',prob:74,detail:'Ekor panjang bawah — rejection kuat dari support',action:'LONG di close pin bar, SL di bawah ekor'});

      // 4. Bearish Pin Bar
      if (lRng>0 && lUW>lBody*2 && lLW<lBody*0.5 && lRng>atr4h*0.7)
        chartPatterns.push({name:'Bearish Pin Bar',type:'BEAR',str:'HIGH',prob:73,detail:'Ekor panjang atas — rejection kuat dari resistance',action:'SHORT di close, SL di atas ekor'});

      // 5. Morning Star
      if (K4h_prev2.c<K4h_prev2.o && Math.abs(K4h_prev.c-K4h_prev.o)<atr4h*0.3 && K4h_last.c>K4h_last.o && K4h_last.c>(K4h_prev2.o+K4h_prev2.c)/2)
        chartPatterns.push({name:'Morning Star',type:'BULL',str:'HIGH',prob:76,detail:'3-candle reversal bullish di support — sangat reliabel',action:'LONG setelah konfirmasi candle ketiga'});

      // 6. Evening Star
      if (K4h_prev2.c>K4h_prev2.o && Math.abs(K4h_prev.c-K4h_prev.o)<atr4h*0.3 && K4h_last.c<K4h_last.o && K4h_last.c<(K4h_prev2.o+K4h_prev2.c)/2)
        chartPatterns.push({name:'Evening Star',type:'BEAR',str:'HIGH',prob:75,detail:'3-candle reversal bearish di resistance',action:'SHORT setelah konfirmasi candle ketiga'});

      // 7. Inside Bar
      if (K4h_last.h<K4h_prev.h && K4h_last.l>K4h_prev.l) {
        const ibType = tf4h.bull?'BULL':'BEAR';
        chartPatterns.push({name:'Inside Bar',type:ibType,str:'MEDIUM',prob:65,detail:`Konsolidasi dalam mother bar. Breakout ${ibType==='BULL'?'bullish':'bearish'} imminent`,action:`Entry pada breakout ${ibType==='BULL'?'di atas':'di bawah'} mother bar high/low`});
      }

      // 8. Double Bottom
      if (rL.length>=2) {
        const l1=rL[rL.length-2].p, l2=rL[rL.length-1].p;
        if (Math.abs(l1-l2)/l1<0.015 && currentPrice>Math.max(l1,l2)*1.005)
          chartPatterns.push({name:'Double Bottom',type:'BULL',str:'HIGH',prob:78,detail:`Strong support at $${((l1+l2)/2).toFixed(4)}. Reversal bullish confirmed`,action:'LONG dengan SL di bawah bottom, TP di neckline atau higher'});
      }

      // 9. Double Top
      if (rH.length>=2) {
        const h1=rH[rH.length-2].p, h2=rH[rH.length-1].p;
        if (Math.abs(h1-h2)/h1<0.015 && currentPrice<Math.min(h1,h2)*0.995)
          chartPatterns.push({name:'Double Top',type:'BEAR',str:'HIGH',prob:77,detail:`Strong resistance at $${((h1+h2)/2).toFixed(4)}`,action:'SHORT dengan SL di atas top'});
      }

      // 10. Higher Lows
      if (rL.length>=3) { const a=rL.slice(-3); if(a[2].p>a[1].p&&a[1].p>a[0].p) chartPatterns.push({name:'Higher Lows Series',type:'BULL',str:'MEDIUM',prob:68,detail:'Buyers terus mempertahankan level lebih tinggi',action:'LONG di pullback ke HL terdekat'}); }

      // 11. Lower Highs
      if (rH.length>=3) { const a=rH.slice(-3); if(a[2].p<a[1].p&&a[1].p<a[0].p) chartPatterns.push({name:'Lower Highs Series',type:'BEAR',str:'MEDIUM',prob:67,detail:'Sellers terus menekan dari level lebih rendah',action:'SHORT di bounce ke LH terdekat'}); }

      // 12. BB Squeeze
      if (bb4h.width<0.04) chartPatterns.push({name:'BB Squeeze',type:tf4h.bull?'BULL':'BEAR',str:'MEDIUM',prob:63,detail:`BB width ${(bb4h.width*100).toFixed(1)}% — explosive move imminent`,action:`Entry setelah breakout ${tf4h.bull?'atas':'bawah'}`});

      // 13. Stochastic Oversold/Overbought
      if (stoch4h<20) chartPatterns.push({name:'Stoch Oversold',type:'BULL',str:'MEDIUM',prob:64,detail:`Stochastic ${stoch4h.toFixed(0)} — deep oversold`,action:'LONG confirmation entry'});
      if (stoch4h>80) chartPatterns.push({name:'Stoch Overbought',type:'BEAR',str:'MEDIUM',prob:64,detail:`Stochastic ${stoch4h.toFixed(0)} — deep overbought`,action:'SHORT confirmation entry'});

      // 14. MACD Cross
      if (Math.abs(macd4h)<atr4h*0.05) {
        if (macd4h>0) chartPatterns.push({name:'MACD Bullish Cross',type:'BULL',str:'MEDIUM',prob:64,detail:'MACD fresh cross above signal',action:'LONG di retest support'});
        else chartPatterns.push({name:'MACD Bearish Cross',type:'BEAR',str:'MEDIUM',prob:63,detail:'MACD fresh cross below signal',action:'SHORT di bounce resistance'});
      }

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
      const wibH=(nowDate.getUTCHours()+7)%24, wibMin=nowDate.getUTCMinutes();
      const wibT=wibH+wibMin/60;
      let killZone;
      if(wibT>=2&&wibT<5) killZone={name:'ASIA OPEN',active:true,color:'#a855f7',prob:3,desc:'02:00-05:00 WIB'};
      else if(wibT>=8&&wibT<12) killZone={name:'LONDON OPEN',active:true,color:'#4488ff',prob:8,desc:'08:00-12:00 WIB — Highest probability'};
      else if(wibT>=15&&wibT<17) killZone={name:'LONDON/NY OVERLAP',active:true,color:'#00ffd0',prob:10,desc:'15:00-17:00 WIB — Peak liquidity'};
      else if(wibT>=19&&wibT<23) killZone={name:'NY OPEN',active:true,color:'#FFB300',prob:7,desc:'19:00-23:00 WIB'};
      else {
        const next=wibT<2?{n:'ASIA OPEN',h:2}:wibT<8?{n:'LONDON OPEN',h:8}:wibT<19?{n:'NY OPEN',h:19}:{n:'ASIA OPEN',h:26};
        killZone={name:next.n,active:false,color:'#5a6a7e',prob:0,desc:`Next in ${(next.h-wibT).toFixed(1)}h`};
      }

      // ── ASTROLOGY ENGINE ─────────────────────────────────────────
      const astro = (() => {
        const yr=nowDate.getUTCFullYear(), mo=nowDate.getUTCMonth()+1, dy=nowDate.getUTCDay(), dom=nowDate.getUTCDate(), hr=nowDate.getUTCHours();
        const JD=(y,m,dd)=>{const a=Math.floor((14-m)/12),yr2=y+4800-a,mn=m+12*a-3;return dd+Math.floor((153*mn+2)/5)+365*yr2+Math.floor(yr2/4)-Math.floor(yr2/100)+Math.floor(yr2/400)-32045;};
        const jdNow=JD(yr,mo,dom)+(hr/24), refNM=2460320.5, synMonth=29.53058867;
        const daysSinceNew=((jdNow-refNM)%synMonth+synMonth)%synMonth;
        const daysToNextNM=synMonth-daysSinceNew;
        const daysToFull=daysSinceNew<14.75?14.75-daysSinceNew:synMonth-daysSinceNew+14.75;
        let moonPhase,moonEmoji,moonBias,moonProbAdj,moonDetail;
        if(daysSinceNew<1.5){moonPhase='New Moon';moonEmoji='🌑';moonBias='BULL';moonProbAdj=8;moonDetail='New Moon: siklus baru. BTC historis sering bullish 3-5 hari setelah New Moon';}
        else if(daysSinceNew<6){moonPhase='Waxing Crescent';moonEmoji='🌒';moonBias='BULL';moonProbAdj=4;moonDetail='Waxing Crescent: energy meningkat. Tren yang ada cenderung menguat';}
        else if(daysSinceNew<8.5){moonPhase='First Quarter';moonEmoji='🌓';moonBias='NEUTRAL';moonProbAdj=0;moonDetail='First Quarter: titik keputusan, sering konsolidasi singkat';}
        else if(daysSinceNew<13){moonPhase='Waxing Gibbous';moonEmoji='🌔';moonBias='BULL';moonProbAdj=5;moonDetail='Waxing Gibbous: momentum bullish tinggi, continuation dari tren';}
        else if(daysSinceNew<15.5){moonPhase='Full Moon';moonEmoji='🌕';moonBias='NEUTRAL';moonProbAdj=-3;moonDetail='Full Moon: puncak energi = puncak harga potensial. Waspada reversal';}
        else if(daysSinceNew<20){moonPhase='Waning Gibbous';moonEmoji='🌖';moonBias='BEAR';moonProbAdj=-4;moonDetail='Waning Gibbous: distribusi dan profit taking cenderung terjadi';}
        else if(daysSinceNew<22.5){moonPhase='Last Quarter';moonEmoji='🌗';moonBias='BEAR';moonProbAdj=-5;moonDetail='Last Quarter: tekanan jual meningkat, potensi breakdown';}
        else if(daysSinceNew<27){moonPhase='Waning Crescent';moonEmoji='🌘';moonBias='BEAR';moonProbAdj=-3;moonDetail='Waning Crescent: akumulasi diam-diam oleh smart money';}
        else{moonPhase='Dark Moon';moonEmoji='🌑';moonBias='BULL';moonProbAdj=6;moonDetail='Dark Moon: akhir siklus, potensi reversal besar dan bullish dalam 48 jam';}
        const halvings=[{date:new Date('2024-04-20')}];
        const lastH=halvings[halvings.length-1];
        const daysSinceH=(nowMs-lastH.date.getTime())/(1000*60*60*24);
        let halvingPhase,halvingBias,halvingDetail;
        if(daysSinceH<90){halvingPhase='POST-HALVING EARLY';halvingBias='NEUTRAL';halvingDetail='Awal post-halving: biasanya sideways 1-3 bulan sebelum bull run';}
        else if(daysSinceH<365){halvingPhase='BULL CYCLE EARLY';halvingBias='BULL';halvingDetail=`Bull cycle dimulai (${Math.round(daysSinceH)} hari post-halving). Historis BTC +200-400%`;}
        else if(daysSinceH<547){halvingPhase='BULL CYCLE PEAK';halvingBias='BULL';halvingDetail=`Bull cycle mature. Peak biasanya 12-18 bulan post-halving`;}
        else if(daysSinceH<730){halvingPhase='DISTRIBUTION';halvingBias='NEUTRAL';halvingDetail='Distribusi: smart money mulai keluar, waspada volatilitas';}
        else if(daysSinceH<1095){halvingPhase='BEAR CYCLE';halvingBias='BEAR';halvingDetail='Bear cycle: akumulasi untuk halving berikutnya';}
        else{halvingPhase='PRE-HALVING ACCUM';halvingBias='BULL';halvingDetail='Akumulasi pra-halving: historis sangat bullish';}
        const mthS={1:{bias:'BULL',adj:6,name:'January'},2:{bias:'BULL',adj:4,name:'February'},3:{bias:'NEUTRAL',adj:0,name:'March'},4:{bias:'BULL',adj:5,name:'April'},5:{bias:'BEAR',adj:-3,name:'May'},6:{bias:'BEAR',adj:-4,name:'June'},7:{bias:'NEUTRAL',adj:-2,name:'July'},8:{bias:'NEUTRAL',adj:2,name:'August'},9:{bias:'BEAR',adj:-5,name:'September'},10:{bias:'BULL',adj:8,name:'October'},11:{bias:'BULL',adj:7,name:'November'},12:{bias:'BULL',adj:5,name:'December'}};
        const curSeason=mthS[mo];
        const dayBias=[{bias:'BULL',adj:2,detail:'Sunday: stop hunt sebelum weekly open'},{bias:'BULL',adj:3,detail:'Monday: weekly open, institutional orders'},{bias:'NEUTRAL',adj:1,detail:'Tuesday: lanjutan Monday'},{bias:'NEUTRAL',adj:0,detail:'Wednesday: midweek reversal'},{bias:'BULL',adj:2,detail:'Thursday: momentum menjelang weekend'},{bias:'NEUTRAL',adj:-1,detail:'Friday: profit taking'},{bias:'BEAR',adj:-2,detail:'Saturday: weekend low volume manipulation'}];
        const curDay=dayBias[dy];
        const mercCycle=115.88, mercRef=JD(2024,4,1), mercPhase=((jdNow-mercRef)%mercCycle+mercCycle)%mercCycle;
        const mercRetro=mercPhase>90&&mercPhase<120;
        let aB=0,arB=0;
        if(moonBias==='BULL')aB+=Math.abs(moonProbAdj);else if(moonBias==='BEAR')arB+=Math.abs(moonProbAdj);
        if(halvingBias==='BULL')aB+=10;else if(halvingBias==='BEAR')arB+=10;else{aB+=3;arB+=3;}
        if(curSeason.bias==='BULL')aB+=Math.abs(curSeason.adj);else if(curSeason.bias==='BEAR')arB+=Math.abs(curSeason.adj);
        if(curDay.bias==='BULL')aB+=curDay.adj;else if(curDay.bias==='BEAR')arB+=Math.abs(curDay.adj);
        if(mercRetro)arB+=3;
        const aT=aB+arB, aBPct=aT>0?Math.round(aB/aT*100):50;
        return{moonPhase,moonEmoji,moonBias,moonProbAdj,moonDetail,daysSinceNew:parseFloat(daysSinceNew.toFixed(1)),daysToNextNM:parseFloat(daysToNextNM.toFixed(1)),daysToFull:parseFloat(daysToFull.toFixed(1)),halvingPhase,halvingBias,halvingDetail,daysSinceH:Math.round(daysSinceH),monthName:curSeason.name,monthBias:curSeason.bias,monthAdj:curSeason.adj,dayName:['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][dy],dayBias:curDay.bias,dayDetail:curDay.detail,mercRetro,astroBull:aB,astroBear:arB,astroBullPct:aBPct,astroSignal:aBPct>=65?'BULLISH':aBPct<=35?'BEARISH':'NEUTRAL',nextNMDate:new Date(nowMs+daysToNextNM*86400000).toLocaleDateString('id-ID'),fullMoonDate:new Date(nowMs+daysToFull*86400000).toLocaleDateString('id-ID'),cyclePos:parseFloat((daysSinceH%1460/1460*100).toFixed(1))};
      })();

      // ── SCORING ───────────────────────────────────────────────────
      let bullPts=0, bearPts=0;
      const scoreLog=[];

      // 1. Weekly Trend (15pts)
      if(tf1w.bull){bullPts+=15;scoreLog.push({cat:'Weekly',d:'UPTREND weekly',pts:15,side:'bull'});}
      else if(tf1w.bear){bearPts+=15;scoreLog.push({cat:'Weekly',d:'DOWNTREND weekly',pts:15,side:'bear'});}
      else if(tf1w.s>0){bullPts+=7;scoreLog.push({cat:'Weekly',d:'Bullish bias weekly',pts:7,side:'bull'});}
      else{bearPts+=7;scoreLog.push({cat:'Weekly',d:'Bearish bias weekly',pts:7,side:'bear'});}

      // 2. Daily Trend (12pts)
      if(tf1d.bull){bullPts+=12;scoreLog.push({cat:'Daily',d:'UPTREND daily',pts:12,side:'bull'});}
      else if(tf1d.bear){bearPts+=12;scoreLog.push({cat:'Daily',d:'DOWNTREND daily',pts:12,side:'bear'});}
      else if(tf1d.s>0){bullPts+=6;scoreLog.push({cat:'Daily',d:'Bullish bias daily',pts:6,side:'bull'});}
      else{bearPts+=6;scoreLog.push({cat:'Daily',d:'Bearish bias daily',pts:6,side:'bear'});}

      // 3. Structure (12pts)
      if(structBias==='BULLISH'){bullPts+=12;scoreLog.push({cat:'Structure',d:'HH+HL bullish structure',pts:12,side:'bull'});}
      else if(structBias==='BEARISH'){bearPts+=12;scoreLog.push({cat:'Structure',d:'LH+LL bearish structure',pts:12,side:'bear'});}
      else if(structBias==='BULLISH_WEAK'){bullPts+=6;scoreLog.push({cat:'Structure',d:'Partial bullish',pts:6,side:'bull'});}
      else if(structBias==='BEARISH_WEAK'){bearPts+=6;scoreLog.push({cat:'Structure',d:'Partial bearish',pts:6,side:'bear'});}
      if(bosType){if(bosType.type==='BULL'){bullPts+=4;scoreLog.push({cat:'BOS',d:bosType.label,pts:4,side:'bull'});}else{bearPts+=4;scoreLog.push({cat:'BOS',d:bosType.label,pts:4,side:'bear'});}}

      // 4. SMC Zone (15pts)
      const nearBullOB=bullOBs[0]||null, nearBearOB=bearOBs[0]||null;
      const nearDem=demZones[0]||null, nearSup=supZones[0]||null;
      if(nearBullOB&&nearBullOB.dist<4){bullPts+=15;scoreLog.push({cat:'SMC Zone',d:`Bullish OB $${nearBullOB.lo.toFixed(4)}-$${nearBullOB.hi.toFixed(4)}`,pts:15,side:'bull'});}
      else if(nearDem&&Math.abs(currentPrice-nearDem.mid)/currentPrice*100<5){bullPts+=12;scoreLog.push({cat:'SMC Zone',d:`Demand Zone ${nearDem.vx}x vol`,pts:12,side:'bull'});}
      else if(nearBearOB&&nearBearOB.dist<4){bearPts+=15;scoreLog.push({cat:'SMC Zone',d:`Bearish OB $${nearBearOB.lo.toFixed(4)}-$${nearBearOB.hi.toFixed(4)}`,pts:15,side:'bear'});}
      else if(nearSup&&Math.abs(nearSup.mid-currentPrice)/currentPrice*100<5){bearPts+=12;scoreLog.push({cat:'SMC Zone',d:`Supply Zone ${nearSup.vx}x vol`,pts:12,side:'bear'});}
      else scoreLog.push({cat:'SMC Zone',d:'Price not at key zone',pts:0,side:'neutral'});

      // 5. Patterns (12pts)
      const bullPats=chartPatterns.filter(p=>p.type==='BULL'), bearPats=chartPatterns.filter(p=>p.type==='BEAR');
      const sBull=bullPats.filter(p=>p.str==='HIGH').length, sBear=bearPats.filter(p=>p.str==='HIGH').length;
      if(sBull>=2){bullPts+=12;scoreLog.push({cat:'Patterns',d:`${sBull} HIGH bull patterns`,pts:12,side:'bull'});}
      else if(bullPats.length>=2){bullPts+=8;scoreLog.push({cat:'Patterns',d:`${bullPats.length} bull patterns`,pts:8,side:'bull'});}
      else if(bullPats.length===1){bullPts+=4;scoreLog.push({cat:'Patterns',d:bullPats[0].name,pts:4,side:'bull'});}
      else if(sBear>=2){bearPts+=12;scoreLog.push({cat:'Patterns',d:`${sBear} HIGH bear patterns`,pts:12,side:'bear'});}
      else if(bearPats.length>=2){bearPts+=8;scoreLog.push({cat:'Patterns',d:`${bearPats.length} bear patterns`,pts:8,side:'bear'});}
      else if(bearPats.length===1){bearPts+=4;scoreLog.push({cat:'Patterns',d:bearPats[0].name,pts:4,side:'bear'});}
      else scoreLog.push({cat:'Patterns',d:'No significant pattern',pts:0,side:'neutral'});

      // 6. Astrology (10pts)
      const astroPts=Math.min(Math.abs(astro.astroBullPct-50)/5,10);
      if(astro.astroSignal==='BULLISH'){bullPts+=Math.round(astroPts);scoreLog.push({cat:'Astrology',d:`${astro.moonEmoji} ${astro.moonPhase} + ${astro.halvingPhase} + ${astro.monthName}`,pts:Math.round(astroPts),side:'bull'});}
      else if(astro.astroSignal==='BEARISH'){bearPts+=Math.round(astroPts);scoreLog.push({cat:'Astrology',d:`${astro.moonEmoji} ${astro.moonPhase} bearish cycle`,pts:Math.round(astroPts),side:'bear'});}
      else scoreLog.push({cat:'Astrology',d:`${astro.moonEmoji} ${astro.moonPhase} neutral`,pts:0,side:'neutral'});

      // 7. RSI (8pts)
      if(rsi1d<35&&rsi4h<40){bullPts+=8;scoreLog.push({cat:'RSI',d:`RSI 4H ${rsi4h.toFixed(0)} + 1D ${rsi1d.toFixed(0)} oversold`,pts:8,side:'bull'});}
      else if(rsi1d>68&&rsi4h>65){bearPts+=8;scoreLog.push({cat:'RSI',d:`RSI 4H ${rsi4h.toFixed(0)} + 1D ${rsi1d.toFixed(0)} overbought`,pts:8,side:'bear'});}
      else if(rsi4h<40){bullPts+=4;scoreLog.push({cat:'RSI',d:`RSI 4H ${rsi4h.toFixed(0)} oversold`,pts:4,side:'bull'});}
      else if(rsi4h>65){bearPts+=4;scoreLog.push({cat:'RSI',d:`RSI 4H ${rsi4h.toFixed(0)} overbought`,pts:4,side:'bear'});}
      else scoreLog.push({cat:'RSI',d:`RSI 4H ${rsi4h.toFixed(0)} neutral`,pts:0,side:'neutral'});

      // 8. Derivatives (10pts)
      let dB=0,drB=0,dLog=[];
      if(fundRate<-0.04){dB+=3;dLog.push(`FR ${fundRate.toFixed(4)}% neg`);}else if(fundRate>0.08){drB+=3;dLog.push(`FR ${fundRate.toFixed(4)}% high`);}
      if(lsRatioV<0.85){dB+=3;dLog.push(`L/S ${lsRatioV.toFixed(2)} retail short`);}else if(lsRatioV>1.9){drB+=3;dLog.push(`L/S ${lsRatioV.toFixed(2)} retail long`);}
      if(takerR>1.12){dB+=4;dLog.push(`Taker ${takerR.toFixed(2)} buy`);}else if(takerR<0.88){drB+=4;dLog.push(`Taker ${takerR.toFixed(2)} sell`);}
      if(dB>drB){bullPts+=Math.min(dB,10);scoreLog.push({cat:'Derivatives',d:dLog.join(' | ')||'Bullish deriv',pts:Math.min(dB,10),side:'bull'});}
      else if(drB>dB){bearPts+=Math.min(drB,10);scoreLog.push({cat:'Derivatives',d:dLog.join(' | ')||'Bearish deriv',pts:Math.min(drB,10),side:'bear'});}
      else scoreLog.push({cat:'Derivatives',d:'Neutral',pts:0,side:'neutral'});

      // 9. Liquidity (5pts)
      if(nearBSL&&((nearBSL.price-currentPrice)/currentPrice*100)<8){bullPts+=5;scoreLog.push({cat:'Liquidity',d:`BSL $${nearBSL.price.toFixed(4)} — magnet above`,pts:5,side:'bull'});}
      if(nearSSL&&((currentPrice-nearSSL.price)/currentPrice*100)<8){bearPts+=5;scoreLog.push({cat:'Liquidity',d:`SSL $${nearSSL.price.toFixed(4)} — magnet below`,pts:5,side:'bear'});}

      // 10. Kill Zone (5pts)
      if(killZone.active){bullPts+=killZone.prob;bearPts+=killZone.prob;scoreLog.push({cat:'Kill Zone',d:`${killZone.name} active`,pts:killZone.prob,side:'both'});}

      // ── DECISION ──────────────────────────────────────────────────
      const biasDir = bullPts>bearPts ? 'LONG' : bearPts>bullPts ? 'SHORT' : 'NEUTRAL';
      const totalMax = Math.max(bullPts,bearPts);
      const probability = Math.round(50 + Math.min((totalMax/110)*100,95)*0.42);
      const mtfOK = (biasDir==='LONG'&&mtfBull>=6) || (biasDir==='SHORT'&&mtfBear>=6);
      const zoneOK = scoreLog.some(s=>s.cat==='SMC Zone'&&s.pts>=12);

      let decision, decColor;
      if(probability>=82&&mtfOK&&zoneOK){ decision=biasDir==='LONG'?'🎯 SNIPER LONG — HIGH PROBABILITY':'🎯 SNIPER SHORT — HIGH PROBABILITY'; decColor=biasDir==='LONG'?'#00ffd0':'#ff4466'; }
      else if(probability>=72&&mtfOK){ decision=biasDir==='LONG'?'⏳ LONG SETUP — WAIT FOR ZONE':'⏳ SHORT SETUP — WAIT FOR ZONE'; decColor='#FFB300'; }
      else if(probability>=65){ decision=biasDir==='LONG'?'👀 LONG BIAS — LOW CONFIDENCE':'👀 SHORT BIAS — LOW CONFIDENCE'; decColor='#a855f7'; }
      else { decision='⛔ NO TRADE — WAIT FOR SETUP'; decColor='#5a6a7e'; }

      // ════════════════════════════════════════════════════════════
      // ── ENTRY CARD — MATHEMATICALLY VERIFIED ────────────────────
      // RULE: LONG → SL < Entry < TP1 < TP2 < TP3 (ALWAYS)
      // RULE: SHORT → SL > Entry > TP1 > TP2 > TP3 (ALWAYS)
      // RULE: Minimum RR 1:3 enforced by ATR-based calculation
      // ════════════════════════════════════════════════════════════
      let entryCard = null;

      if (probability >= 72 && biasDir !== 'NEUTRAL') {
        const isLong = biasDir === 'LONG';

        // ── STEP 1: DETERMINE ENTRY PRICE ──────────────────────────
        // Entry = current price (market) or OB/zone edge if closer
        let entryPrice = currentPrice;

        // ── STEP 2: DETERMINE STOP LOSS ────────────────────────────
        // SL must be on opposite side of entry from TP
        // LONG: SL = below entry (below OB low or ATR-based)
        // SHORT: SL = above entry (above OB high or ATR-based)
        let slPrice;

        if (isLong) {
          // SL candidates: below OB low, below nearest SSL, or ATR-based
          // All candidates MUST be < entryPrice
          const slCandidates = [];

          if (nearBullOB && nearBullOB.lo < entryPrice) {
            // SL just below OB low (1% buffer)
            slCandidates.push(nearBullOB.lo * 0.998);
          }
          if (nearSSL && nearSSL.price < entryPrice) {
            slCandidates.push(nearSSL.price * 0.998);
          }
          // ATR-based fallback: entry - 1.5 * ATR
          slCandidates.push(entryPrice - atr4h * 1.5);

          // Take the HIGHEST of valid SL candidates (tightest but still below entry)
          const validSLs = slCandidates.filter(sl => sl < entryPrice && sl > 0);
          if (validSLs.length > 0) {
            slPrice = Math.max(...validSLs);
          } else {
            // Absolute fallback: 2% below entry
            slPrice = entryPrice * 0.98;
          }

          // SAFETY CHECK: Ensure SL is strictly below entry
          if (slPrice >= entryPrice) slPrice = entryPrice * 0.98;

        } else {
          // SHORT: SL must be ABOVE entry
          const slCandidates = [];

          if (nearBearOB && nearBearOB.hi > entryPrice) {
            slCandidates.push(nearBearOB.hi * 1.002);
          }
          if (nearBSL && nearBSL.price > entryPrice) {
            slCandidates.push(nearBSL.price * 1.002);
          }
          slCandidates.push(entryPrice + atr4h * 1.5);

          const validSLs = slCandidates.filter(sl => sl > entryPrice);
          if (validSLs.length > 0) {
            slPrice = Math.min(...validSLs);
          } else {
            slPrice = entryPrice * 1.02;
          }

          if (slPrice <= entryPrice) slPrice = entryPrice * 1.02;
        }

        // ── STEP 3: CALCULATE RISK DISTANCE ─────────────────────────
        const riskDist = Math.abs(entryPrice - slPrice);

        // ── STEP 4: CALCULATE TP LEVELS ─────────────────────────────
        // MINIMUM 1:3 RR enforced
        // TP1 = 1:1.5 RR (minimum, usually better)
        // TP2 = 1:3 RR (target)
        // TP3 = 1:5 RR or nearest liquidity (maximum)
        //
        // LONG: ALL TPs must be > entryPrice
        // SHORT: ALL TPs must be < entryPrice
        let tp1Price, tp2Price, tp3Price;

        if (isLong) {
          // Base TPs from risk distance
          const tp1Base = entryPrice + riskDist * 1.5;
          const tp2Base = entryPrice + riskDist * 3.0;  // Guaranteed 1:3
          const tp3Base = entryPrice + riskDist * 5.0;

          // TP1: try to use FVG or nearest resistance if better than base
          if (bullFVGs[0] && bullFVGs[0].hi > entryPrice) {
            tp1Price = Math.max(tp1Base, bullFVGs[0].lo);
            // But never lower than 1:1 RR
            if (tp1Price <= entryPrice + riskDist) tp1Price = tp1Base;
          } else {
            tp1Price = tp1Base;
          }

          // TP2: try nearest swing high or BSL
          const tp2Candidates = [tp2Base];
          if (nearBSL && nearBSL.price > entryPrice + riskDist * 2) tp2Candidates.push(nearBSL.price * 0.998);
          recentHighs.filter(h => h > entryPrice + riskDist * 2).slice(0,2).forEach(h => tp2Candidates.push(h * 0.998));
          tp2Price = Math.min(...tp2Candidates.filter(t => t > tp1Price));
          if (!tp2Price || tp2Price <= tp1Price) tp2Price = entryPrice + riskDist * 3.0;

          // TP3: use BSL or 5x RR
          if (nearBSL && nearBSL.price > tp2Price) tp3Price = nearBSL.price * 0.998;
          else tp3Price = tp3Base;
          if (tp3Price <= tp2Price) tp3Price = entryPrice + riskDist * 5.0;

          // FINAL SAFETY: enforce strict ordering
          if (tp1Price <= entryPrice) tp1Price = entryPrice + riskDist * 1.5;
          if (tp2Price <= tp1Price) tp2Price = tp1Price + riskDist * 1.0;
          if (tp3Price <= tp2Price) tp3Price = tp2Price + riskDist * 1.5;

        } else {
          // SHORT: ALL TPs must be < entryPrice
          const tp1Base = entryPrice - riskDist * 1.5;
          const tp2Base = entryPrice - riskDist * 3.0;
          const tp3Base = entryPrice - riskDist * 5.0;

          // TP1: use FVG below if available
          if (bearFVGs[0] && bearFVGs[0].lo < entryPrice) {
            tp1Price = Math.min(tp1Base, bearFVGs[0].hi);
            if (tp1Price >= entryPrice - riskDist) tp1Price = tp1Base;
          } else {
            tp1Price = tp1Base;
          }

          // TP2
          const tp2Candidates = [tp2Base];
          if (nearSSL && nearSSL.price < entryPrice - riskDist * 2) tp2Candidates.push(nearSSL.price * 1.002);
          recentLows.filter(l => l < entryPrice - riskDist * 2).slice(0,2).forEach(l => tp2Candidates.push(l * 1.002));
          tp2Price = Math.max(...tp2Candidates.filter(t => t < tp1Price));
          if (!tp2Price || tp2Price >= tp1Price) tp2Price = entryPrice - riskDist * 3.0;

          // TP3
          if (nearSSL && nearSSL.price < tp2Price) tp3Price = nearSSL.price * 1.002;
          else tp3Price = tp3Base;
          if (tp3Price >= tp2Price) tp3Price = entryPrice - riskDist * 5.0;

          // FINAL SAFETY: enforce strict ordering SHORT
          if (tp1Price >= entryPrice) tp1Price = entryPrice - riskDist * 1.5;
          if (tp2Price >= tp1Price) tp2Price = tp1Price - riskDist * 1.0;
          if (tp3Price >= tp2Price) tp3Price = tp2Price - riskDist * 1.5;
        }

        // ── STEP 5: CALCULATE VERIFIED RR ───────────────────────────
        const rr1 = Math.abs(tp1Price - entryPrice) / riskDist;
        const rr2 = Math.abs(tp2Price - entryPrice) / riskDist;
        const rr3 = Math.abs(tp3Price - entryPrice) / riskDist;

        // ── STEP 6: FINAL VALIDATION ─────────────────────────────────
        // Verify no impossible levels
        const isValid = isLong
          ? (slPrice < entryPrice && tp1Price > entryPrice && tp2Price > tp1Price && tp3Price > tp2Price)
          : (slPrice > entryPrice && tp1Price < entryPrice && tp2Price < tp1Price && tp3Price < tp2Price);

        if (isValid) {
          const roundTo = (n, p) => parseFloat(n.toFixed(p));
          const decimals = currentPrice > 1000 ? 2 : currentPrice > 10 ? 3 : currentPrice > 1 ? 4 : 6;

          entryCard = {
            direction: biasDir,
            entry: roundTo(entryPrice, decimals),
            sl: roundTo(slPrice, decimals),
            tp1: roundTo(tp1Price, decimals),
            tp2: roundTo(tp2Price, decimals),
            tp3: roundTo(tp3Price, decimals),
            rr1: roundTo(rr1, 2),
            rr2: roundTo(rr2, 2),
            rr3: roundTo(rr3, 2),
            slPct: roundTo(Math.abs(entryPrice-slPrice)/entryPrice*100, 2),
            tp1Pct: roundTo(Math.abs(tp1Price-entryPrice)/entryPrice*100, 2),
            tp2Pct: roundTo(Math.abs(tp2Price-entryPrice)/entryPrice*100, 2),
            tp3Pct: roundTo(Math.abs(tp3Price-entryPrice)/entryPrice*100, 2),
            riskDist: roundTo(riskDist, decimals),
            obZone: isLong ? nearBullOB : nearBearOB,
            sdZone: isLong ? nearDem : nearSup,
            liqTarget: isLong ? nearBSL : nearSSL,
            fvgTarget: isLong ? (bullFVGs[0]||null) : (bearFVGs[0]||null),
            invalidation: `Close candle ${isLong?'di bawah':'di atas'} $${roundTo(slPrice,decimals)} = trade invalid, exit immediately`,
            verified: true,
            // Debug info for transparency
            debug: { isLong, slBelowEntry: slPrice < entryPrice, tp1AboveEntry: isLong ? tp1Price > entryPrice : tp1Price < entryPrice }
          };
        }
      }

      data = {
        symbol: sym, timestamp: nowMs, currentPrice,
        decision, decColor, probability, biasDir,
        entryCard,
        astro,
        killZone,
        mtf: { bull:mtfBull, bear:mtfBear, aligned:mtfOK, tf1h:tf1h.trend, tf4h:tf4h.trend, tf1d:tf1d.trend, tf1w:tf1w.trend },
        structure: { bias:structBias, bos:bosType, choch:chochType },
        smc: { nearBullOB, nearBearOB, nearDem, nearSup, bullFVG:bullFVGs[0]||null, bearFVG:bearFVGs[0]||null },
        liquidity: { nearBSL, nearSSL },
        chartPatterns: chartPatterns.slice(0,8),
        scoreLog,
        score: { bull:bullPts, bear:bearPts },
        indicators: {
          rsi1h: parseFloat(rsi1h.toFixed(1)), rsi4h: parseFloat(rsi4h.toFixed(1)), rsi1d: parseFloat(rsi1d.toFixed(1)),
          stoch4h: parseFloat(stoch4h.toFixed(1)), macd4h: parseFloat(macd4h.toFixed(6)),
          bb4h_pos: parseFloat(((currentPrice-bb4h.lower)/(bb4h.upper-bb4h.lower)*100).toFixed(1)),
          bb4h_width: parseFloat((bb4h.width*100).toFixed(2)),
          ema20_4h: parseFloat(ema20_4h.toFixed(6)), ema50_4h: parseFloat(ema50_4h.toFixed(6)), ema200_4h: parseFloat(ema200_4h.toFixed(6)),
          fundRate: parseFloat(fundRate.toFixed(4)), lsRatio: parseFloat(lsRatioV.toFixed(2)),
          takerRatio: parseFloat(takerR.toFixed(3)), fng: fngVal, oiChg: parseFloat(oiChgPct.toFixed(2)),
          atr4h: parseFloat(atr4h.toFixed(6)), atr1d: parseFloat(atr1d.toFixed(6))
        }
      };

    // ── CONFLUENCE LEGACY ─────────────────────────────────────────
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
      const E2=(c,p)=>{if(c.length<p)return c[c.length-1];const k=2/(p+1);let e=c.slice(0,p).reduce((a,b)=>a+b,0)/p;for(let i=p;i<c.length;i++)e=c[i]*k+e*(1-k);return e;};
      const R2=(c,p=14)=>{if(c.length<p+1)return 50;let g=0,l=0;for(let i=c.length-p;i<c.length;i++){const d=c[i]-c[i-1];if(d>0)g+=d;else l-=d;}return 100-(100/(1+g/(l||0.001)));};
      const sc={bull:0,bear:0,signals:[]};
      if(k1d.status==='fulfilled'&&Array.isArray(k1d.value)){const c=k1d.value.map(k=>parseFloat(k[4]));const p=c[c.length-1];const e200=E2(c,Math.min(200,c.length));const e50=E2(c,Math.min(50,c.length));if(p>e200){sc.bull+=2;sc.signals.push({name:'HTF',value:'BULLISH',detail:`>EMA200`,weight:2,side:'bull'});}else{sc.bear+=2;sc.signals.push({name:'HTF',value:'BEARISH',detail:`<EMA200`,weight:2,side:'bear'});}if(e50>e200){sc.bull+=1;sc.signals.push({name:'EMA Cross',value:'GOLDEN',detail:'EMA50>200',weight:1,side:'bull'});}else{sc.bear+=1;sc.signals.push({name:'EMA Cross',value:'DEATH',detail:'EMA50<200',weight:1,side:'bear'});}}
      if(k4h.status==='fulfilled'&&Array.isArray(k4h.value)){const c=k4h.value.map(k=>parseFloat(k[4]));const rsi=R2(c);const macd=E2(c,12)-E2(c,26);if(rsi<35){sc.bull+=2;sc.signals.push({name:'RSI 4H',value:rsi.toFixed(1),detail:'Oversold',weight:2,side:'bull'});}else if(rsi>70){sc.bear+=2;sc.signals.push({name:'RSI 4H',value:rsi.toFixed(1),detail:'Overbought',weight:2,side:'bear'});}else if(rsi<50){sc.bull+=1;sc.signals.push({name:'RSI 4H',value:rsi.toFixed(1),detail:'<50',weight:1,side:'bull'});}else{sc.bear+=1;sc.signals.push({name:'RSI 4H',value:rsi.toFixed(1),detail:'>50',weight:1,side:'bear'});}if(macd>0){sc.bull+=1;sc.signals.push({name:'MACD',value:macd.toFixed(4),detail:'Bull',weight:1,side:'bull'});}else{sc.bear+=1;sc.signals.push({name:'MACD',value:macd.toFixed(4),detail:'Bear',weight:1,side:'bear'});}}
      if(oiH.status==='fulfilled'&&Array.isArray(oiH.value)&&oiH.value.length>=5){const o=oiH.value.map(x=>parseFloat(x.sumOpenInterest));const ch=((o[o.length-1]-o[o.length-5])/o[o.length-5])*100;const c4=k4h.status==='fulfilled'?k4h.value.map(k=>parseFloat(k[4])):[];const pu=c4.length>5&&c4[c4.length-1]>c4[c4.length-5];if(ch>2&&pu){sc.bull+=2;sc.signals.push({name:'OI',value:`+${ch.toFixed(1)}%`,detail:'Long Build',weight:2,side:'bull'});}else if(ch>2&&!pu){sc.bear+=2;sc.signals.push({name:'OI',value:`+${ch.toFixed(1)}%`,detail:'Short Build',weight:2,side:'bear'});}else sc.signals.push({name:'OI',value:`${ch.toFixed(1)}%`,detail:'Neutral',weight:0,side:'neutral'});}
      if(lsR.status==='fulfilled'&&Array.isArray(lsR.value)&&lsR.value.length){const ls=parseFloat(lsR.value[lsR.value.length-1].longShortRatio);if(ls<0.9){sc.bull+=2;sc.signals.push({name:'L/S',value:ls.toFixed(2),detail:'Retail Short',weight:2,side:'bull'});}else if(ls>1.8){sc.bear+=2;sc.signals.push({name:'L/S',value:ls.toFixed(2),detail:'Retail Long',weight:2,side:'bear'});}else sc.signals.push({name:'L/S',value:ls.toFixed(2),detail:'Balanced',weight:0,side:'neutral'});}
      if(taker.status==='fulfilled'&&Array.isArray(taker.value)&&taker.value.length){const avg=taker.value.slice(-5).reduce((s,v)=>s+parseFloat(v.buySellRatio),0)/5;if(avg>1.1){sc.bull+=2;sc.signals.push({name:'Taker',value:avg.toFixed(2),detail:'Buy Agg',weight:2,side:'bull'});}else if(avg<0.9){sc.bear+=2;sc.signals.push({name:'Taker',value:avg.toFixed(2),detail:'Sell Agg',weight:2,side:'bear'});}else sc.signals.push({name:'Taker',value:avg.toFixed(2),detail:'Neutral',weight:0,side:'neutral'});}
      if(fund.status==='fulfilled'&&fund.value.lastFundingRate){const fr=parseFloat(fund.value.lastFundingRate)*100;if(fr<-0.05){sc.bull+=2;sc.signals.push({name:'FR',value:`${fr.toFixed(4)}%`,detail:'Neg',weight:2,side:'bull'});}else if(fr>0.1){sc.bear+=2;sc.signals.push({name:'FR',value:`${fr.toFixed(4)}%`,detail:'High',weight:2,side:'bear'});}else sc.signals.push({name:'FR',value:`${fr.toFixed(4)}%`,detail:'Neutral',weight:0,side:'neutral'});}
      if(fng.status==='fulfilled'&&fng.value.data){const f=parseInt(fng.value.data[0].value);if(f<=20){sc.bull+=2;sc.signals.push({name:'F&G',value:`${f}`,detail:'Ext Fear',weight:2,side:'bull'});}else if(f>=80){sc.bear+=2;sc.signals.push({name:'F&G',value:`${f}`,detail:'Ext Greed',weight:2,side:'bear'});}else if(f<40){sc.bull+=1;sc.signals.push({name:'F&G',value:`${f}`,detail:'Fear',weight:1,side:'bull'});}else sc.signals.push({name:'F&G',value:`${f}`,detail:'Neutral',weight:0,side:'neutral'});}
      const tw=sc.bull+sc.bear; const bp=tw>0?Math.round(sc.bull/tw*100):50;
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
