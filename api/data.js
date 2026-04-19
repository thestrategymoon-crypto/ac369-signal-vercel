// api/data.js — AC369 FUSION ENGINE v5.2
// FIXES:
// 1. SL minimum 1.5% untuk SWING, 0.8% untuk SCALP (tidak mudah kena noise)
// 2. SL di bawah STRUKTUR — bukan di swing low terakhir (liquidity sweep zone)
// 3. Timeframe classification: SCALP (1H entry) / SWING (4H entry) / POSITION (1D)
// 4. Leverage recommendation berdasarkan SL distance + volatility
// 5. Entry hanya setelah konfirmasi candle — bukan market order langsung
// 6. Confirmed entry: tunggu retrace ke OB/Demand, bukan chase di current price

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  const { source, ...params } = req.query;

  try {
    let data;

    // ── BASIC PROXIES ────────────────────────────────────────────
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
      const r = await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${params.symbol||'BTCUSDT'}&interval=${params.interval||'4h'}&limit=${params.limit||'200'}`, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(12000) });
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
    // FUSION ENGINE v5.2 — INSTITUTIONAL-GRADE ENTRY/SL/TP
    // ══════════════════════════════════════════════════════════════
    } else if (source === 'fusion') {
      const sym = params.symbol || 'BTCUSDT';

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

      // ── MATH ─────────────────────────────────────────────────────
      const EMA = (c, p) => {
        if (c.length < p) return c[c.length-1];
        const k = 2/(p+1); let e = c.slice(0,p).reduce((a,b)=>a+b,0)/p;
        for (let i=p; i<c.length; i++) e = c[i]*k + e*(1-k);
        return e;
      };
      const RSI = (c, p=14) => {
        if (c.length < p+1) return 50; let g=0,l=0;
        for (let i=c.length-p; i<c.length; i++) { const d=c[i]-c[i-1]; if(d>0)g+=d;else l-=d; }
        return 100-(100/(1+g/(l||0.001)));
      };
      const ATR = (K, p=14) => {
        const t = K.slice(1).map((k,i)=>Math.max(k.h-k.l, Math.abs(k.h-K[i].c), Math.abs(k.l-K[i].c)));
        return t.slice(-p).reduce((a,b)=>a+b,0)/p;
      };
      const BB = (c,p=20) => {
        const s=c.slice(-p), m=s.reduce((a,b)=>a+b,0)/p, sd=Math.sqrt(s.reduce((x,v)=>x+(v-m)**2,0)/p);
        return {upper:m+2*sd, lower:m-2*sd, mid:m, sd, width:4*sd/m};
      };
      const STOCH = (K,p=14) => {
        const r=K.slice(-p), hi=Math.max(...r.map(k=>k.h)), lo=Math.min(...r.map(k=>k.l));
        return hi===lo?50:((K[K.length-1].c-lo)/(hi-lo))*100;
      };

      const atr4h = ATR(K4h);
      const atr1h = ATR(K1h.length ? K1h : K4h);
      const atr1d = ATR(K1d.length ? K1d : K4h);
      const c4h = K4h.map(k=>k.c), c1d = K1d.map(k=>k.c), c1w = K1w.map(k=>k.c);
      const bb4h = BB(c4h);
      const stoch4h = STOCH(K4h);
      const rsi1h = RSI(K1h.map(k=>k.c));
      const rsi4h = RSI(c4h);
      const rsi1d = RSI(c1d);
      const macd4h = EMA(c4h,12) - EMA(c4h,26);
      const ema20_4h=EMA(c4h,20), ema50_4h=EMA(c4h,50), ema200_4h=EMA(c4h,Math.min(200,c4h.length));
      const ema200_1d=EMA(c1d,Math.min(200,c1d.length));

      // ── VOLATILITY CLASSIFICATION ─────────────────────────────────
      // ATR as % of price — determines trade style recommendation
      const atrPct4h = (atr4h / currentPrice) * 100;
      const atrPct1h = (atr1h / currentPrice) * 100;
      let volatilityClass, volatilityLabel;
      if (atrPct4h > 5) { volatilityClass = 'HIGH'; volatilityLabel = 'High Volatility'; }
      else if (atrPct4h > 2.5) { volatilityClass = 'MEDIUM'; volatilityLabel = 'Medium Volatility'; }
      else { volatilityClass = 'LOW'; volatilityLabel = 'Low Volatility'; }

      // ── SWING FINDER ──────────────────────────────────────────────
      const findSwings = (K, lb=4) => {
        const h=[], l=[];
        for (let i=lb; i<K.length-lb; i++) {
          let iH=true, iL=true;
          for (let j=i-lb; j<=i+lb; j++) { if(j===i)continue; if(K[j].h>=K[i].h)iH=false; if(K[j].l<=K[i].l)iL=false; }
          if(iH) h.push({i, p:K[i].h, t:K[i].t});
          if(iL) l.push({i, p:K[i].l, t:K[i].t});
        }
        return {h, l};
      };

      const sw4h = findSwings(K4h, 4);
      const sw1h = findSwings(K1h, 3);
      const sw1d = findSwings(K1d, 3);

      // ══════════════════════════════════════════════════════════════
      // TIMEFRAME CLASSIFICATION & TRADE STYLE
      // ══════════════════════════════════════════════════════════════
      // 1H aligned  + 4H aligned = SCALP (entry on 1H, manage on 4H)
      // 4H aligned  + 1D aligned = SWING (entry on 4H, manage on 1D)
      // 1D + 1W aligned          = POSITION (entry on 1D)
      const analyzeTF = (K, closes) => {
        if (!K.length || !closes.length) return { s:0, rsi:50, bull:false, bear:false, trend:'UNKNOWN' };
        const e200=EMA(closes,Math.min(200,closes.length)), e50=EMA(closes,Math.min(50,closes.length)), e20=EMA(closes,Math.min(20,closes.length));
        const p=closes[closes.length-1], rsi=RSI(closes), mac=EMA(closes,12)-EMA(closes,26);
        const last20=K.slice(-20), hh=last20[last20.length-1].h>last20[0].h, hl=last20[last20.length-1].l>last20[0].l;
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

      // Trade style recommendation
      let tradeStyle, tradeStyleDesc, entryTF, manageTF, holdTime;
      const allBull = tf1h.bull && tf4h.bull && tf1d.bull;
      const swingBull = tf4h.bull && tf1d.bull;
      const scalp1h = tf1h.bull && tf4h.s >= 0;
      const allBear = tf1h.bear && tf4h.bear && tf1d.bear;
      const swingBear = tf4h.bear && tf1d.bear;

      if (allBull || allBear) {
        tradeStyle = 'SWING';
        tradeStyleDesc = 'SWING TRADE — Entry & kelola posisi di chart 4H, konfirmasi dari 1D';
        entryTF = '4H'; manageTF = '1D'; holdTime = '2-7 hari';
      } else if (swingBull || swingBear) {
        tradeStyle = 'SWING';
        tradeStyleDesc = 'SWING TRADE — Setup 4H + 1D aligned. Hold 2-5 hari.';
        entryTF = '4H'; manageTF = '1D'; holdTime = '2-5 hari';
      } else if (scalp1h || (tf1h.bear && tf4h.s <= 0)) {
        tradeStyle = 'SCALP';
        tradeStyleDesc = 'SCALP/INTRADAY — Setup 1H. Exit dalam 4-24 jam. Pantau aktif.';
        entryTF = '1H'; manageTF = '4H'; holdTime = '4-24 jam';
      } else {
        tradeStyle = 'SCALP';
        tradeStyleDesc = 'SCALP — Short-term setup. Monitor ketat, exit cepat.';
        entryTF = '1H'; manageTF = '4H'; holdTime = '2-12 jam';
      }

      // ── MARKET STRUCTURE ─────────────────────────────────────────
      const rH4h=sw4h.h.slice(-6), rL4h=sw4h.l.slice(-6);
      let structBias='NEUTRAL', bosType=null;
      if (rH4h.length>=2 && rL4h.length>=2) {
        const hhPat=rH4h[rH4h.length-1].p>rH4h[rH4h.length-2].p;
        const hlPat=rL4h[rL4h.length-1].p>rL4h[rL4h.length-2].p;
        const lhPat=rH4h[rH4h.length-1].p<rH4h[rH4h.length-2].p;
        const llPat=rL4h[rL4h.length-1].p<rL4h[rL4h.length-2].p;
        if(hhPat&&hlPat){structBias='BULLISH';bosType={type:'BULL',price:rH4h[rH4h.length-1].p,label:'BOS Bullish — HH+HL confirmed'};}
        else if(lhPat&&llPat){structBias='BEARISH';bosType={type:'BEAR',price:rL4h[rL4h.length-1].p,label:'BOS Bearish — LH+LL confirmed'};}
        else if(hhPat||hlPat) structBias='BULLISH_WEAK';
        else if(lhPat||llPat) structBias='BEARISH_WEAK';
      }

      // ── ORDER BLOCKS ─────────────────────────────────────────────
      const OBs = [];
      for (let i=2; i<K4h.length-1; i++) {
        const c=K4h[i], n=K4h[i+1];
        if (c.c<c.o && n.c>n.o && (n.c-n.o)/n.o>0.005) {
          const hi=Math.max(c.o,c.c), lo=Math.min(c.o,c.c);
          if (currentPrice>lo*0.96) OBs.push({type:'BULL',hi,lo,mid:(hi+lo)/2,t:c.t,dist:Math.abs(currentPrice-(hi+lo)/2)/currentPrice*100});
        }
        if (c.c>c.o && n.c<n.o && (n.o-n.c)/n.o>0.005) {
          const hi=Math.max(c.o,c.c), lo=Math.min(c.o,c.c);
          if (currentPrice<hi*1.04) OBs.push({type:'BEAR',hi,lo,mid:(hi+lo)/2,t:c.t,dist:Math.abs(currentPrice-(hi+lo)/2)/currentPrice*100});
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
      const bullFVGs=FVGs.filter(f=>f.type==='BULL'&&!f.filled).sort((a,b)=>Math.abs(currentPrice-a.mid)-Math.abs(currentPrice-b.mid));
      const bearFVGs=FVGs.filter(f=>f.type==='BEAR'&&!f.filled).sort((a,b)=>Math.abs(currentPrice-a.mid)-Math.abs(currentPrice-b.mid));

      // ── SUPPLY & DEMAND ───────────────────────────────────────────
      const avgVol = K4h.slice(-50).reduce((s,k)=>s+k.v,0)/50;
      const SDZ = [];
      for (let i=3; i<K4h.length-1; i++) {
        const k=K4h[i], body=Math.abs(k.c-k.o), rng=k.h-k.l;
        if (k.v>avgVol*1.5 && rng>0 && body/rng>0.55) {
          if (k.c>k.o) SDZ.push({type:'DEMAND',hi:Math.max(k.o,k.c),lo:Math.min(k.o,k.c)-atr4h*0.3,mid:(k.o+k.c)/2,vx:(k.v/avgVol).toFixed(1),t:k.t});
          else SDZ.push({type:'SUPPLY',hi:Math.max(k.o,k.c)+atr4h*0.3,lo:Math.min(k.o,k.c),mid:(k.o+k.c)/2,vx:(k.v/avgVol).toFixed(1),t:k.t});
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

      // Key highs/lows for TP targeting
      const recentHighs=sw4h.h.slice(-8).map(h=>h.p).filter(h=>h>currentPrice).sort((a,b)=>a-b);
      const recentLows=sw4h.l.slice(-8).map(l=>l.p).filter(l=>l<currentPrice).sort((a,b)=>b-a);

      // ── CHART PATTERNS ───────────────────────────────────────────
      const patterns = [];
      const Kl=K4h[K4h.length-1], Kp=K4h[K4h.length-2], Kp2=K4h[K4h.length-3];
      const lB=Math.abs(Kl.c-Kl.o), lR=Kl.h-Kl.l, lLW=Math.min(Kl.c,Kl.o)-Kl.l, lUW=Kl.h-Math.max(Kl.c,Kl.o);
      if(Kp.c<Kp.o&&Kl.c>Kl.o&&Kl.c>Kp.o&&Kl.o<Kp.c) patterns.push({name:'Bullish Engulfing',type:'BULL',str:'HIGH',prob:72,detail:'Strong bullish reversal candle',action:'LONG entry di close'});
      if(Kp.c>Kp.o&&Kl.c<Kl.o&&Kl.c<Kp.o&&Kl.o>Kp.c) patterns.push({name:'Bearish Engulfing',type:'BEAR',str:'HIGH',prob:71,detail:'Strong bearish reversal candle',action:'SHORT entry di close'});
      if(lR>0&&lLW>lB*2&&lUW<lB*0.5&&lR>atr4h*0.7) patterns.push({name:'Bullish Pin Bar',type:'BULL',str:'HIGH',prob:74,detail:'Rejection kuat dari support — ekor panjang bawah',action:'LONG di close pin bar'});
      if(lR>0&&lUW>lB*2&&lLW<lB*0.5&&lR>atr4h*0.7) patterns.push({name:'Bearish Pin Bar',type:'BEAR',str:'HIGH',prob:73,detail:'Rejection kuat dari resistance — ekor panjang atas',action:'SHORT di close'});
      if(Kp2.c<Kp2.o&&Math.abs(Kp.c-Kp.o)<atr4h*0.3&&Kl.c>Kl.o&&Kl.c>(Kp2.o+Kp2.c)/2) patterns.push({name:'Morning Star',type:'BULL',str:'HIGH',prob:76,detail:'3-candle reversal di support',action:'LONG konfirmasi'});
      if(Kp2.c>Kp2.o&&Math.abs(Kp.c-Kp.o)<atr4h*0.3&&Kl.c<Kl.o&&Kl.c<(Kp2.o+Kp2.c)/2) patterns.push({name:'Evening Star',type:'BEAR',str:'HIGH',prob:75,detail:'3-candle reversal di resistance',action:'SHORT konfirmasi'});
      if(Kl.h<Kp.h&&Kl.l>Kp.l) patterns.push({name:'Inside Bar',type:tf4h.bull?'BULL':'BEAR',str:'MEDIUM',prob:65,detail:`Konsolidasi — breakout ${tf4h.bull?'bullish':'bearish'} imminent`,action:'Entry setelah breakout'});
      if(sw4h.l.length>=2){const l1=sw4h.l[sw4h.l.length-2].p,l2=sw4h.l[sw4h.l.length-1].p;if(Math.abs(l1-l2)/l1<0.015&&currentPrice>Math.max(l1,l2)*1.005) patterns.push({name:'Double Bottom',type:'BULL',str:'HIGH',prob:78,detail:`Support kuat $${((l1+l2)/2).toFixed(4)}`,action:'LONG dengan SL di bawah bottom'});}
      if(sw4h.h.length>=2){const h1=sw4h.h[sw4h.h.length-2].p,h2=sw4h.h[sw4h.h.length-1].p;if(Math.abs(h1-h2)/h1<0.015&&currentPrice<Math.min(h1,h2)*0.995) patterns.push({name:'Double Top',type:'BEAR',str:'HIGH',prob:77,detail:`Resistance kuat $${((h1+h2)/2).toFixed(4)}`,action:'SHORT dengan SL di atas top'});}
      if(stoch4h<20) patterns.push({name:'Stoch Oversold',type:'BULL',str:'MEDIUM',prob:64,detail:`Stochastic ${stoch4h.toFixed(0)} — deep oversold`,action:'LONG confirmation'});
      if(stoch4h>80) patterns.push({name:'Stoch Overbought',type:'BEAR',str:'MEDIUM',prob:64,detail:`Stochastic ${stoch4h.toFixed(0)} — deep overbought`,action:'SHORT confirmation'});

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
      const wibH=(nowDate.getUTCHours()+7)%24, wibMin=nowDate.getUTCMinutes(), wibT=wibH+wibMin/60;
      let killZone;
      if(wibT>=2&&wibT<5) killZone={name:'ASIA OPEN',active:true,color:'#a855f7',prob:3,desc:'02:00-05:00 WIB'};
      else if(wibT>=8&&wibT<12) killZone={name:'LONDON OPEN',active:true,color:'#4488ff',prob:8,desc:'08:00-12:00 WIB — Highest probability'};
      else if(wibT>=15&&wibT<17) killZone={name:'LONDON/NY OVERLAP',active:true,color:'#00ffd0',prob:10,desc:'15:00-17:00 WIB — Peak liquidity'};
      else if(wibT>=19&&wibT<23) killZone={name:'NY OPEN',active:true,color:'#FFB300',prob:7,desc:'19:00-23:00 WIB'};
      else{const next=wibT<2?{n:'ASIA OPEN',h:2}:wibT<8?{n:'LONDON OPEN',h:8}:wibT<19?{n:'NY OPEN',h:19}:{n:'ASIA OPEN',h:26};killZone={name:next.n,active:false,color:'#5a6a7e',prob:0,desc:`Next in ${(next.h-wibT).toFixed(1)}h`};}

      // ── ASTROLOGY ─────────────────────────────────────────────────
      const astro = (() => {
        const yr=nowDate.getUTCFullYear(),mo=nowDate.getUTCMonth()+1,dy=nowDate.getUTCDay(),dom=nowDate.getUTCDate(),hr=nowDate.getUTCHours();
        const JD=(y,m,dd)=>{const a=Math.floor((14-m)/12),yr2=y+4800-a,mn=m+12*a-3;return dd+Math.floor((153*mn+2)/5)+365*yr2+Math.floor(yr2/4)-Math.floor(yr2/100)+Math.floor(yr2/400)-32045;};
        const jdNow=JD(yr,mo,dom)+(hr/24),refNM=2460320.5,syn=29.53058867;
        const dsN=((jdNow-refNM)%syn+syn)%syn;
        let mp,me,mb,ma,md;
        if(dsN<1.5){mp='New Moon';me='🌑';mb='BULL';ma=8;md='New Moon: BTC historis bullish 3-5 hari setelah New Moon';}
        else if(dsN<6){mp='Waxing Crescent';me='🌒';mb='BULL';ma=4;md='Waxing Crescent: energy meningkat, tren cenderung menguat';}
        else if(dsN<8.5){mp='First Quarter';me='🌓';mb='NEUTRAL';ma=0;md='First Quarter: titik keputusan, sering konsolidasi';}
        else if(dsN<13){mp='Waxing Gibbous';me='🌔';mb='BULL';ma=5;md='Waxing Gibbous: momentum bullish tinggi';}
        else if(dsN<15.5){mp='Full Moon';me='🌕';mb='NEUTRAL';ma=-3;md='Full Moon: waspada reversal dan volatilitas tinggi';}
        else if(dsN<20){mp='Waning Gibbous';me='🌖';mb='BEAR';ma=-4;md='Waning Gibbous: distribusi cenderung terjadi';}
        else if(dsN<22.5){mp='Last Quarter';me='🌗';mb='BEAR';ma=-5;md='Last Quarter: tekanan jual meningkat';}
        else if(dsN<27){mp='Waning Crescent';me='🌘';mb='BEAR';ma=-3;md='Waning Crescent: akumulasi diam-diam smart money';}
        else{mp='Dark Moon';me='🌑';mb='BULL';ma=6;md='Dark Moon: potensi reversal besar dalam 48 jam';}
        const halvings=[{date:new Date('2024-04-20')}];
        const dsH=(nowMs-halvings[0].date.getTime())/(1000*60*60*24);
        let hp,hb,hd;
        if(dsH<90){hp='POST-HALVING EARLY';hb='NEUTRAL';hd='Awal post-halving: sideways 1-3 bulan sebelum bull run';}
        else if(dsH<365){hp='BULL CYCLE EARLY';hb='BULL';hd=`Bull cycle (${Math.round(dsH)}d post-halving). Historis BTC +200-400%`;}
        else if(dsH<547){hp='BULL CYCLE PEAK';hb='BULL';hd='Bull cycle mature. Peak biasanya 12-18 bulan post-halving';}
        else if(dsH<730){hp='DISTRIBUTION';hb='NEUTRAL';hd='Distribusi: volatilitas tinggi';}
        else{hp='BEAR CYCLE';hb='BEAR';hd='Bear cycle: waktu akumulasi';}
        const mthS={1:{bias:'BULL',adj:6,name:'January'},2:{bias:'BULL',adj:4,name:'February'},3:{bias:'NEUTRAL',adj:0,name:'March'},4:{bias:'BULL',adj:5,name:'April'},5:{bias:'BEAR',adj:-3,name:'May'},6:{bias:'BEAR',adj:-4,name:'June'},7:{bias:'NEUTRAL',adj:-2,name:'July'},8:{bias:'NEUTRAL',adj:2,name:'August'},9:{bias:'BEAR',adj:-5,name:'September'},10:{bias:'BULL',adj:8,name:'October'},11:{bias:'BULL',adj:7,name:'November'},12:{bias:'BULL',adj:5,name:'December'}};
        const cs=mthS[mo];
        const dayB=[{bias:'BULL',adj:2},{bias:'BULL',adj:3},{bias:'NEUTRAL',adj:1},{bias:'NEUTRAL',adj:0},{bias:'BULL',adj:2},{bias:'NEUTRAL',adj:-1},{bias:'BEAR',adj:-2}];
        const cd=dayB[dy];
        const mercPhase=((jdNow-JD(2024,4,1))%115.88+115.88)%115.88;
        const mercRetro=mercPhase>90&&mercPhase<120;
        let aB=0,arB=0;
        if(mb==='BULL')aB+=Math.abs(ma);else if(mb==='BEAR')arB+=Math.abs(ma);
        if(hb==='BULL')aB+=10;else if(hb==='BEAR')arB+=10;else{aB+=3;arB+=3;}
        if(cs.bias==='BULL')aB+=Math.abs(cs.adj);else if(cs.bias==='BEAR')arB+=Math.abs(cs.adj);
        if(cd.bias==='BULL')aB+=cd.adj;else if(cd.bias==='BEAR')arB+=Math.abs(cd.adj);
        if(mercRetro)arB+=3;
        const aT=aB+arB,aBP=aT>0?Math.round(aB/aT*100):50;
        return{moonPhase:mp,moonEmoji:me,moonBias:mb,moonProbAdj:ma,moonDetail:md,daysSinceNew:parseFloat(dsN.toFixed(1)),daysToNextNM:parseFloat((syn-dsN).toFixed(1)),daysToFull:parseFloat((dsN<14.75?14.75-dsN:syn-dsN+14.75).toFixed(1)),halvingPhase:hp,halvingBias:hb,halvingDetail:hd,daysSinceH:Math.round(dsH),monthName:cs.name,monthBias:cs.bias,monthAdj:cs.adj,dayName:['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][dy],dayBias:cd.bias,mercRetro,astroBull:aB,astroBear:arB,astroBullPct:aBP,astroSignal:aBP>=65?'BULLISH':aBP<=35?'BEARISH':'NEUTRAL',nextNMDate:new Date(nowMs+(syn-dsN)*86400000).toLocaleDateString('id-ID'),fullMoonDate:new Date(nowMs+(dsN<14.75?14.75-dsN:syn-dsN+14.75)*86400000).toLocaleDateString('id-ID'),cyclePos:parseFloat((dsH%1460/1460*100).toFixed(1))};
      })();

      // ── SCORING ───────────────────────────────────────────────────
      let bullPts=0, bearPts=0;
      const scoreLog=[];

      if(tf1w.bull){bullPts+=15;scoreLog.push({cat:'Weekly',d:'UPTREND weekly',pts:15,side:'bull'});}
      else if(tf1w.bear){bearPts+=15;scoreLog.push({cat:'Weekly',d:'DOWNTREND weekly',pts:15,side:'bear'});}
      else if(tf1w.s>0){bullPts+=7;scoreLog.push({cat:'Weekly',d:'Bullish bias weekly',pts:7,side:'bull'});}
      else{bearPts+=7;scoreLog.push({cat:'Weekly',d:'Bearish bias weekly',pts:7,side:'bear'});}

      if(tf1d.bull){bullPts+=12;scoreLog.push({cat:'Daily',d:'UPTREND daily',pts:12,side:'bull'});}
      else if(tf1d.bear){bearPts+=12;scoreLog.push({cat:'Daily',d:'DOWNTREND daily',pts:12,side:'bear'});}
      else if(tf1d.s>0){bullPts+=6;scoreLog.push({cat:'Daily',d:'Bullish bias daily',pts:6,side:'bull'});}
      else{bearPts+=6;scoreLog.push({cat:'Daily',d:'Bearish bias daily',pts:6,side:'bear'});}

      const nearBullOB=bullOBs[0]||null,nearBearOB=bearOBs[0]||null;
      const nearDem=demZones[0]||null,nearSup=supZones[0]||null;

      const rH4hSlice=sw4h.h.slice(-6),rL4hSlice=sw4h.l.slice(-6);
      const hhPat=rH4hSlice.length>=2&&rH4hSlice[rH4hSlice.length-1].p>rH4hSlice[rH4hSlice.length-2].p;
      const hlPat=rL4hSlice.length>=2&&rL4hSlice[rL4hSlice.length-1].p>rL4hSlice[rL4hSlice.length-2].p;
      const lhPat=rH4hSlice.length>=2&&rH4hSlice[rH4hSlice.length-1].p<rH4hSlice[rH4hSlice.length-2].p;
      const llPat=rL4hSlice.length>=2&&rL4hSlice[rL4hSlice.length-1].p<rL4hSlice[rL4hSlice.length-2].p;
      if(hhPat&&hlPat){bullPts+=16;scoreLog.push({cat:'Structure',d:'HH+HL bullish — confirmed uptrend structure',pts:16,side:'bull'});}
      else if(lhPat&&llPat){bearPts+=16;scoreLog.push({cat:'Structure',d:'LH+LL bearish — confirmed downtrend structure',pts:16,side:'bear'});}
      else if(hhPat||hlPat){bullPts+=8;scoreLog.push({cat:'Structure',d:'Partial bullish structure',pts:8,side:'bull'});}
      else if(lhPat||llPat){bearPts+=8;scoreLog.push({cat:'Structure',d:'Partial bearish structure',pts:8,side:'bear'});}
      if(bosType){if(bosType.type==='BULL'){bullPts+=4;scoreLog.push({cat:'BOS',d:bosType.label,pts:4,side:'bull'});}else{bearPts+=4;scoreLog.push({cat:'BOS',d:bosType.label,pts:4,side:'bear'});}}

      if(nearBullOB&&nearBullOB.dist<4){bullPts+=15;scoreLog.push({cat:'SMC Zone',d:`Bullish OB $${nearBullOB.lo.toFixed(4)}-$${nearBullOB.hi.toFixed(4)}`,pts:15,side:'bull'});}
      else if(nearDem&&Math.abs(currentPrice-nearDem.mid)/currentPrice*100<5){bullPts+=12;scoreLog.push({cat:'SMC Zone',d:`Demand Zone ${nearDem.vx}x vol`,pts:12,side:'bull'});}
      else if(nearBearOB&&nearBearOB.dist<4){bearPts+=15;scoreLog.push({cat:'SMC Zone',d:`Bearish OB $${nearBearOB.lo.toFixed(4)}-$${nearBearOB.hi.toFixed(4)}`,pts:15,side:'bear'});}
      else if(nearSup&&Math.abs(nearSup.mid-currentPrice)/currentPrice*100<5){bearPts+=12;scoreLog.push({cat:'SMC Zone',d:`Supply Zone ${nearSup.vx}x vol`,pts:12,side:'bear'});}
      else scoreLog.push({cat:'SMC Zone',d:'Price not at key zone',pts:0,side:'neutral'});

      const bP=patterns.filter(p=>p.type==='BULL'),brP=patterns.filter(p=>p.type==='BEAR');
      const sbP=bP.filter(p=>p.str==='HIGH').length,sbrP=brP.filter(p=>p.str==='HIGH').length;
      if(sbP>=2){bullPts+=12;scoreLog.push({cat:'Patterns',d:`${sbP} HIGH bull patterns`,pts:12,side:'bull'});}
      else if(bP.length>=2){bullPts+=8;scoreLog.push({cat:'Patterns',d:`${bP.length} bull patterns`,pts:8,side:'bull'});}
      else if(bP.length===1){bullPts+=4;scoreLog.push({cat:'Patterns',d:bP[0].name,pts:4,side:'bull'});}
      else if(sbrP>=2){bearPts+=12;scoreLog.push({cat:'Patterns',d:`${sbrP} HIGH bear patterns`,pts:12,side:'bear'});}
      else if(brP.length>=2){bearPts+=8;scoreLog.push({cat:'Patterns',d:`${brP.length} bear patterns`,pts:8,side:'bear'});}
      else if(brP.length===1){bearPts+=4;scoreLog.push({cat:'Patterns',d:brP[0].name,pts:4,side:'bear'});}
      else scoreLog.push({cat:'Patterns',d:'No significant pattern',pts:0,side:'neutral'});

      const astroPts=Math.min(Math.abs(astro.astroBullPct-50)/5,10);
      if(astro.astroSignal==='BULLISH'){bullPts+=Math.round(astroPts);scoreLog.push({cat:'Astrology',d:`${astro.moonEmoji} ${astro.moonPhase} + ${astro.halvingPhase} + ${astro.monthName}`,pts:Math.round(astroPts),side:'bull'});}
      else if(astro.astroSignal==='BEARISH'){bearPts+=Math.round(astroPts);scoreLog.push({cat:'Astrology',d:`${astro.moonEmoji} ${astro.moonPhase} bearish cycle`,pts:Math.round(astroPts),side:'bear'});}
      else scoreLog.push({cat:'Astrology',d:`${astro.moonEmoji} ${astro.moonPhase} neutral`,pts:0,side:'neutral'});

      if(rsi1d<35&&rsi4h<40){bullPts+=8;scoreLog.push({cat:'RSI',d:`RSI 4H ${rsi4h.toFixed(0)} + 1D ${rsi1d.toFixed(0)} oversold`,pts:8,side:'bull'});}
      else if(rsi1d>68&&rsi4h>65){bearPts+=8;scoreLog.push({cat:'RSI',d:`RSI 4H ${rsi4h.toFixed(0)} + 1D ${rsi1d.toFixed(0)} overbought`,pts:8,side:'bear'});}
      else if(rsi4h<40){bullPts+=4;scoreLog.push({cat:'RSI',d:`RSI 4H ${rsi4h.toFixed(0)} oversold`,pts:4,side:'bull'});}
      else if(rsi4h>65){bearPts+=4;scoreLog.push({cat:'RSI',d:`RSI 4H ${rsi4h.toFixed(0)} overbought`,pts:4,side:'bear'});}
      else scoreLog.push({cat:'RSI',d:`RSI 4H ${rsi4h.toFixed(0)} neutral`,pts:0,side:'neutral'});

      let dB=0,drB=0,dLog=[];
      if(fundRate<-0.04){dB+=3;dLog.push(`FR ${fundRate.toFixed(4)}% neg`);}else if(fundRate>0.08){drB+=3;dLog.push(`FR ${fundRate.toFixed(4)}% high`);}
      if(lsRatioV<0.85){dB+=3;dLog.push(`L/S ${lsRatioV.toFixed(2)} retail short`);}else if(lsRatioV>1.9){drB+=3;dLog.push(`L/S ${lsRatioV.toFixed(2)} retail long`);}
      if(takerR>1.12){dB+=4;dLog.push(`Taker ${takerR.toFixed(2)} buy`);}else if(takerR<0.88){drB+=4;dLog.push(`Taker ${takerR.toFixed(2)} sell`);}
      if(dB>drB){bullPts+=Math.min(dB,10);scoreLog.push({cat:'Derivatives',d:dLog.join(' | ')||'Bullish deriv',pts:Math.min(dB,10),side:'bull'});}
      else if(drB>dB){bearPts+=Math.min(drB,10);scoreLog.push({cat:'Derivatives',d:dLog.join(' | ')||'Bearish deriv',pts:Math.min(drB,10),side:'bear'});}
      else scoreLog.push({cat:'Derivatives',d:'Neutral',pts:0,side:'neutral'});

      if(nearBSL&&((nearBSL.price-currentPrice)/currentPrice*100)<8){bullPts+=5;scoreLog.push({cat:'Liquidity',d:`BSL $${nearBSL.price.toFixed(4)} — magnet above`,pts:5,side:'bull'});}
      if(nearSSL&&((currentPrice-nearSSL.price)/currentPrice*100)<8){bearPts+=5;scoreLog.push({cat:'Liquidity',d:`SSL $${nearSSL.price.toFixed(4)} — magnet below`,pts:5,side:'bear'});}
      if(killZone.active){bullPts+=killZone.prob;bearPts+=killZone.prob;scoreLog.push({cat:'Kill Zone',d:`${killZone.name} active`,pts:killZone.prob,side:'both'});}

      // ── DECISION ──────────────────────────────────────────────────
      const biasDir=bullPts>bearPts?'LONG':bearPts>bullPts?'SHORT':'NEUTRAL';
      const totalMax=Math.max(bullPts,bearPts);
      const probability=Math.round(50+Math.min((totalMax/110)*100,95)*0.42);
      const mtfOK=(biasDir==='LONG'&&mtfBull>=6)||(biasDir==='SHORT'&&mtfBear>=6);
      const zoneOK=scoreLog.some(s=>s.cat==='SMC Zone'&&s.pts>=12);

      let decision,decColor;
      if(probability>=82&&mtfOK&&zoneOK){decision=biasDir==='LONG'?'🎯 SNIPER LONG — HIGH PROBABILITY':'🎯 SNIPER SHORT — HIGH PROBABILITY';decColor=biasDir==='LONG'?'#00ffd0':'#ff4466';}
      else if(probability>=72&&mtfOK){decision=biasDir==='LONG'?'⏳ LONG SETUP — WAIT FOR ZONE':'⏳ SHORT SETUP — WAIT FOR ZONE';decColor='#FFB300';}
      else if(probability>=65){decision=biasDir==='LONG'?'👀 LONG BIAS — LOW CONFIDENCE':'👀 SHORT BIAS — LOW CONFIDENCE';decColor='#a855f7';}
      else{decision='⛔ NO TRADE — WAIT FOR SETUP';decColor='#5a6a7e';}

      // ════════════════════════════════════════════════════════════
      // ENTRY CARD v5.2 — INSTITUTIONAL SL PLACEMENT
      // KEY FIXES:
      // 1. SL minimum distance enforced (SWING: 1.5%, SCALP: 0.8%)
      // 2. SL placed BELOW structure (OB low, demand zone low, or 2*ATR)
      //    NOT at swing low (which is liquidity that will be swept)
      // 3. SL buffer: 0.5% below the structural level
      // 4. Leverage recommendation: max 1/(SL% * 3) for safe sizing
      // ════════════════════════════════════════════════════════════
      let entryCard = null;

      if (probability >= 72 && biasDir !== 'NEUTRAL') {
        const isLong = biasDir === 'LONG';

        // ── STEP 1: ENTRY PRICE ────────────────────────────────────
        // For WAIT setups: entry at OB/Demand zone (not current price)
        // For SNIPER: current price but with LIMIT order
        let entryPrice = currentPrice;
        let entryType = 'LIMIT'; // Always LIMIT, never market

        // If price is above OB/Demand for LONG, wait for retrace
        if (isLong && nearBullOB && nearBullOB.hi < currentPrice && (currentPrice-nearBullOB.hi)/currentPrice*100 > 1) {
          entryPrice = nearBullOB.hi; // Wait for retrace to OB top
          entryType = 'LIMIT — Tunggu retrace';
        } else if (isLong && nearDem && nearDem.hi < currentPrice && (currentPrice-nearDem.hi)/currentPrice*100 > 1) {
          entryPrice = nearDem.hi;
          entryType = 'LIMIT — Tunggu retrace ke Demand';
        } else if (!isLong && nearBearOB && nearBearOB.lo > currentPrice && (nearBearOB.lo-currentPrice)/currentPrice*100 > 1) {
          entryPrice = nearBearOB.lo;
          entryType = 'LIMIT — Tunggu retrace';
        }

        // ── STEP 2: STOP LOSS — INSTITUTIONAL PLACEMENT ────────────
        // Critical: SL must NOT be at swing low (liquidity that gets swept)
        // SL must be BELOW the structural support (OB low, demand zone bottom)
        // With a buffer below the zone

        // Minimum SL distance based on trade style
        const minSLPct = tradeStyle === 'SWING' ? 0.015 : 0.008; // 1.5% swing, 0.8% scalp
        const slBuffer = 0.005; // 0.5% buffer below/above structure

        let slPrice;
        let slBasis = ''; // What the SL is based on

        if (isLong) {
          // Priority: below OB low > below Demand zone low > 2*ATR below entry
          const obSL = nearBullOB ? nearBullOB.lo * (1 - slBuffer) : null;
          const demSL = nearDem ? nearDem.lo * (1 - slBuffer) : null;
          const atrSL = entryPrice - atr4h * 2.0; // 2x ATR for proper room
          const minSL = entryPrice * (1 - minSLPct); // Minimum distance

          // Collect valid SL candidates (must be below entry)
          const slCandidates = [];
          if (obSL && obSL < entryPrice) { slCandidates.push({price: obSL, basis: 'below OB low (buffer 0.5%)'}); }
          if (demSL && demSL < entryPrice) { slCandidates.push({price: demSL, basis: 'below Demand zone (buffer 0.5%)'}); }
          slCandidates.push({price: atrSL, basis: '2x ATR below entry'});

          // Filter: must be below entry, pick the highest valid one (tightest)
          const validSLs = slCandidates.filter(s => s.price < entryPrice);

          if (validSLs.length > 0) {
            // Take tightest valid SL
            const tightestSL = validSLs.reduce((best, s) => s.price > best.price ? s : best);
            // But enforce minimum distance
            if (tightestSL.price >= minSL) {
              slPrice = minSL; // Use minimum if OB is too close
              slBasis = `Minimum ${(minSLPct*100).toFixed(1)}% (OB terlalu dekat — SL diperluas ke min distance)`;
            } else {
              slPrice = tightestSL.price;
              slBasis = tightestSL.basis;
            }
          } else {
            slPrice = Math.min(minSL, atrSL);
            slBasis = '2x ATR below entry (no valid OB/Demand)';
          }

          // FINAL CHECK: Ensure SL is at least minSLPct below entry
          if (slPrice >= entryPrice * (1 - minSLPct / 2)) {
            slPrice = entryPrice * (1 - minSLPct);
            slBasis = `Forced minimum ${(minSLPct*100).toFixed(1)}% distance`;
          }
          // Hard safety
          if (slPrice >= entryPrice) slPrice = entryPrice * (1 - minSLPct);

        } else {
          // SHORT: SL above structure
          const obSL = nearBearOB ? nearBearOB.hi * (1 + slBuffer) : null;
          const supSL = nearSup ? nearSup.hi * (1 + slBuffer) : null;
          const atrSL = entryPrice + atr4h * 2.0;
          const minSL = entryPrice * (1 + minSLPct);

          const slCandidates = [];
          if (obSL && obSL > entryPrice) slCandidates.push({price: obSL, basis: 'above OB high (buffer 0.5%)'});
          if (supSL && supSL > entryPrice) slCandidates.push({price: supSL, basis: 'above Supply zone (buffer 0.5%)'});
          slCandidates.push({price: atrSL, basis: '2x ATR above entry'});

          const validSLs = slCandidates.filter(s => s.price > entryPrice);
          if (validSLs.length > 0) {
            const tightestSL = validSLs.reduce((best, s) => s.price < best.price ? s : best);
            if (tightestSL.price <= minSL) {
              slPrice = minSL;
              slBasis = `Minimum ${(minSLPct*100).toFixed(1)}% (OB terlalu dekat)`;
            } else {
              slPrice = tightestSL.price;
              slBasis = tightestSL.basis;
            }
          } else {
            slPrice = Math.max(minSL, atrSL);
            slBasis = '2x ATR above entry';
          }
          if (slPrice <= entryPrice * (1 + minSLPct / 2)) {
            slPrice = entryPrice * (1 + minSLPct);
            slBasis = `Forced minimum ${(minSLPct*100).toFixed(1)}% distance`;
          }
          if (slPrice <= entryPrice) slPrice = entryPrice * (1 + minSLPct);
        }

        // ── STEP 3: RISK DISTANCE ──────────────────────────────────
        const riskDist = Math.abs(entryPrice - slPrice);
        const slPctActual = (riskDist / entryPrice) * 100;

        // ── STEP 4: TAKE PROFITS — Minimum 1:3 RR ─────────────────
        let tp1Price, tp2Price, tp3Price;
        if (isLong) {
          // TP1: 1:1.5 — first resistance or FVG
          const tp1Base = entryPrice + riskDist * 1.5;
          // TP2: 1:3 — guaranteed minimum
          const tp2Base = entryPrice + riskDist * 3.0;
          // TP3: 1:5 — BSL or higher
          const tp3Base = entryPrice + riskDist * 5.0;

          tp1Price = tp1Base;
          // Use nearby resistance as TP1 target if available and above tp1Base
          if (recentHighs.length > 0 && recentHighs[0] > tp1Base) tp1Price = recentHighs[0] * 0.998;

          tp2Price = tp2Base;
          if (nearBSL && nearBSL.price > tp2Base) tp2Price = nearBSL.price * 0.998;
          else if (recentHighs.length > 1 && recentHighs[1] > tp2Base) tp2Price = recentHighs[1] * 0.998;

          tp3Price = tp3Base;
          if (nearBSL && nearBSL.price > tp3Price) tp3Price = nearBSL.price * 0.997;

          // ENFORCE ORDERING: tp1 < tp2 < tp3, all above entry
          if (tp1Price <= entryPrice) tp1Price = entryPrice + riskDist * 1.5;
          if (tp2Price <= tp1Price) tp2Price = tp1Price + riskDist * 1.0;
          if (tp3Price <= tp2Price) tp3Price = tp2Price + riskDist * 1.5;
        } else {
          const tp1Base = entryPrice - riskDist * 1.5;
          const tp2Base = entryPrice - riskDist * 3.0;
          const tp3Base = entryPrice - riskDist * 5.0;

          tp1Price = tp1Base;
          if (recentLows.length > 0 && recentLows[0] < tp1Base) tp1Price = recentLows[0] * 1.002;

          tp2Price = tp2Base;
          if (nearSSL && nearSSL.price < tp2Base) tp2Price = nearSSL.price * 1.002;

          tp3Price = tp3Base;

          if (tp1Price >= entryPrice) tp1Price = entryPrice - riskDist * 1.5;
          if (tp2Price >= tp1Price) tp2Price = tp1Price - riskDist * 1.0;
          if (tp3Price >= tp2Price) tp3Price = tp2Price - riskDist * 1.5;
        }

        // ── STEP 5: LEVERAGE RECOMMENDATION ───────────────────────
        // Safe leverage = max leverage where position does NOT exceed 30% of capital
        // Formula: max_leverage = 1 / (SL_pct * 3)
        // Conservative: never exceed 10x, prefer 3-5x for swing
        const maxSafeLev = Math.min(Math.floor(1 / (slPctActual / 100 * 3)), tradeStyle === 'SWING' ? 10 : 15);
        let recLev, recLevReason, recLevColor;
        if (maxSafeLev >= 10) {
          recLev = tradeStyle === 'SWING' ? 5 : 8;
          recLevReason = `Max aman: ${maxSafeLev}x. Rekomendasi ${tradeStyle === 'SWING' ? '3-5x' : '5-8x'} untuk buffer tambahan.`;
          recLevColor = 'GREEN';
        } else if (maxSafeLev >= 5) {
          recLev = Math.min(maxSafeLev - 1, tradeStyle === 'SWING' ? 5 : 8);
          recLevReason = `SL ${slPctActual.toFixed(1)}% — gunakan max ${recLev}x untuk kelola risiko.`;
          recLevColor = 'YELLOW';
        } else {
          recLev = Math.max(maxSafeLev - 1, 1);
          recLevReason = `SL ${slPctActual.toFixed(1)}% cukup lebar — kurangi leverage ke ${recLev}x maks.`;
          recLevColor = 'RED';
        }

        const rr1 = Math.abs(tp1Price - entryPrice) / riskDist;
        const rr2 = Math.abs(tp2Price - entryPrice) / riskDist;
        const rr3 = Math.abs(tp3Price - entryPrice) / riskDist;

        // ── STEP 6: VALIDATION ─────────────────────────────────────
        const isValid = isLong
          ? (slPrice < entryPrice && tp1Price > entryPrice && tp2Price > tp1Price && tp3Price > tp2Price)
          : (slPrice > entryPrice && tp1Price < entryPrice && tp2Price < tp1Price && tp3Price < tp2Price);

        if (isValid) {
          const dec = currentPrice > 1000 ? 2 : currentPrice > 10 ? 3 : currentPrice > 1 ? 4 : 6;
          const r = (n) => parseFloat(n.toFixed(dec));

          // Confirmed entry: tell user to wait for candle close at entry level
          const entryConfirmation = probability >= 82
            ? `Entry SEKARANG jika ${isLong ? 'candle 4H close di atas' : 'candle 4H close di bawah'} $${r(entryPrice)}`
            : `TUNGGU candle ${entryTF} close di $${r(entryPrice)} sebelum entry — jangan chase`;

          entryCard = {
            direction: biasDir,
            tradeStyle,
            tradeStyleDesc,
            entryTF,
            manageTF,
            holdTime,
            entryType,
            entryConfirmation,
            entry: r(entryPrice),
            sl: r(slPrice),
            tp1: r(tp1Price),
            tp2: r(tp2Price),
            tp3: r(tp3Price),
            rr1: parseFloat(rr1.toFixed(2)),
            rr2: parseFloat(rr2.toFixed(2)),
            rr3: parseFloat(rr3.toFixed(2)),
            slPct: parseFloat(slPctActual.toFixed(2)),
            tp1Pct: parseFloat((Math.abs(tp1Price-entryPrice)/entryPrice*100).toFixed(2)),
            tp2Pct: parseFloat((Math.abs(tp2Price-entryPrice)/entryPrice*100).toFixed(2)),
            tp3Pct: parseFloat((Math.abs(tp3Price-entryPrice)/entryPrice*100).toFixed(2)),
            slBasis,
            leverage: { rec: recLev, max: maxSafeLev, reason: recLevReason, color: recLevColor },
            obZone: isLong ? nearBullOB : nearBearOB,
            sdZone: isLong ? nearDem : nearSup,
            liqTarget: isLong ? nearBSL : nearSSL,
            fvgTarget: isLong ? (bullFVGs[0]||null) : (bearFVGs[0]||null),
            invalidation: `Close candle ${isLong?'di bawah':'di atas'} $${r(slPrice)} = trade INVALID, exit SEGERA tanpa ragu`,
            volatilityClass, volatilityLabel, atrPct4h: parseFloat(atrPct4h.toFixed(2)),
          };
        }
      }

      data = {
        symbol:sym, timestamp:nowMs, currentPrice,
        decision, decColor, probability, biasDir,
        tradeStyle, tradeStyleDesc, entryTF, manageTF, holdTime,
        entryCard,
        astro, killZone,
        mtf:{bull:mtfBull,bear:mtfBear,aligned:mtfOK,tf1h:tf1h.trend,tf4h:tf4h.trend,tf1d:tf1d.trend,tf1w:tf1w.trend},
        structure:{bias:structBias,bos:bosType},
        smc:{nearBullOB,nearBearOB,nearDem,nearSup,bullFVG:bullFVGs[0]||null,bearFVG:bearFVGs[0]||null},
        liquidity:{nearBSL,nearSSL},
        chartPatterns:patterns.slice(0,8),
        scoreLog, score:{bull:bullPts,bear:bearPts},
        indicators:{
          rsi1h:parseFloat(rsi1h.toFixed(1)),rsi4h:parseFloat(rsi4h.toFixed(1)),rsi1d:parseFloat(rsi1d.toFixed(1)),
          stoch4h:parseFloat(stoch4h.toFixed(1)),macd4h:parseFloat(macd4h.toFixed(6)),
          bb4h_pos:parseFloat(((currentPrice-bb4h.lower)/(bb4h.upper-bb4h.lower)*100).toFixed(1)),
          bb4h_width:parseFloat((bb4h.width*100).toFixed(2)),
          ema20_4h:parseFloat(ema20_4h.toFixed(6)),ema50_4h:parseFloat(ema50_4h.toFixed(6)),ema200_4h:parseFloat(ema200_4h.toFixed(6)),
          fundRate:parseFloat(fundRate.toFixed(4)),lsRatio:parseFloat(lsRatioV.toFixed(2)),
          takerRatio:parseFloat(takerR.toFixed(3)),fng:fngVal,oiChg:parseFloat(oiChgPct.toFixed(2)),
          atr4h:parseFloat(atr4h.toFixed(6)),atr1d:parseFloat(atr1d.toFixed(6)),
          atrPct4h:parseFloat(atrPct4h.toFixed(2)),volatilityClass,volatilityLabel
        }
      };

    // ── CONFLUENCE LEGACY ────────────────────────────────────────
    } else if (source === 'confluence') {
      const sym=params.symbol||'BTCUSDT';
      const[k4h,k1d,oiH,lsR,taker,fund,depth,fng]=await Promise.allSettled([fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=4h&limit=200`).then(r=>r.json()),fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=1d&limit=100`).then(r=>r.json()),fetch(`https://fapi.binance.com/futures/data/openInterestHist?symbol=${sym}&period=4h&limit=20`).then(r=>r.json()),fetch(`https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${sym}&period=4h&limit=10`).then(r=>r.json()),fetch(`https://fapi.binance.com/futures/data/takerlongshortRatio?symbol=${sym}&period=4h&limit=10`).then(r=>r.json()),fetch(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${sym}`).then(r=>r.json()),fetch(`https://api.binance.com/api/v3/depth?symbol=${sym}&limit=50`).then(r=>r.json()),fetch(`https://api.alternative.me/fng/?limit=1&format=json`).then(r=>r.json())]);
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
