// api/search.js — v16 SUPER DETAIL
// Sumber: CryptoCompare klines (tidak diblokir) + Bybit single-symbol + CoinGecko
// Full SMC/ICT + Elliott Wave + Multi-TF + Trade Setup + Astrology

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=20, stale-while-revalidate=10');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const raw = (req.query.symbol || req.query.s || '').toUpperCase().replace(/USDT$/,'').replace(/[^A-Z0-9]/g,'');
  if (!raw) return res.status(200).json({ error: 'Symbol diperlukan. Contoh: ?symbol=BTC', price: 0 });

  const t0 = Date.now();
  const sf = async (url, ms) => {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), ms);
    try {
      const r = await fetch(url, { signal: c.signal, headers: { Accept: 'application/json', 'User-Agent': 'AC369/1.0' } });
      clearTimeout(t); if (!r.ok) return null; return await r.json();
    } catch { clearTimeout(t); return null; }
  };

  // ── TA LIBRARY ────────────────────────────────────────────
  const EMA = (a, p) => {
    if (!a || a.length < 2) return a?.[a.length-1] || 0;
    const k = 2/(p+1); let e = a.slice(0,Math.min(p,a.length)).reduce((s,v)=>s+v,0)/Math.min(p,a.length);
    for (let i = Math.min(p,a.length); i < a.length; i++) e = a[i]*k + e*(1-k);
    return +e.toFixed(8);
  };

  const RSI14 = (a) => {
    if (!a || a.length < 16) return 50;
    let ag=0,al=0;
    for (let i=1;i<=14;i++){const d=a[i]-a[i-1];d>0?ag+=d:al-=d;}
    ag/=14; al/=14;
    for (let i=15;i<a.length;i++){const d=a[i]-a[i-1];ag=(ag*13+Math.max(d,0))/14;al=(al*13+Math.max(-d,0))/14;}
    return al===0?100:+(100-100/(1+ag/al)).toFixed(2);
  };

  const MACD = (a) => {
    if (!a||a.length<36) return {bullish:false,bearish:false,crossUp:false,crossDown:false,histogram:0,macd:0,signal:0,divergence:false};
    const k12=2/13,k26=2/27,k9=2/10;
    let e12=a.slice(0,12).reduce((s,v)=>s+v,0)/12, e26=a.slice(0,26).reduce((s,v)=>s+v,0)/26;
    const mv=[];
    for(let i=26;i<a.length;i++){e12=a[i]*k12+e12*(1-k12);e26=a[i]*k26+e26*(1-k26);mv.push(e12-e26);}
    let sig=mv.slice(0,9).reduce((s,v)=>s+v,0)/9;
    for(let i=9;i<mv.length;i++)sig=mv[i]*k9+sig*(1-k9);
    const last=mv[mv.length-1],prev=mv[mv.length-2]||last,hist=last-sig,prevH=prev-sig;
    // Divergence: price makes new high/low but MACD doesn't
    const priceUp=a[a.length-1]>a[a.length-10]||false;
    const macdUp=(mv[mv.length-1]||0)>(mv[mv.length-10]||0);
    const divergence=priceUp!==macdUp;
    return {bullish:last>0&&hist>0,bearish:last<0&&hist<0,crossUp:hist>0&&prevH<=0,crossDown:hist<0&&prevH>=0,histogram:+hist.toFixed(8),macd:+last.toFixed(8),signal:+sig.toFixed(8),divergence};
  };

  const STOCH_RSI = (a, rsiP=14, stochP=14) => {
    if (!a||a.length<rsiP*2) return {k:50,d:50,overbought:false,oversold:false};
    // Build RSI series
    const rsiSeries=[];
    for(let i=rsiP;i<a.length;i++){const sl=a.slice(i-rsiP,i+1);rsiSeries.push(RSI14(sl));}
    if(rsiSeries.length<stochP) return {k:50,d:50,overbought:false,oversold:false};
    const last=rsiSeries.slice(-stochP);
    const mn=Math.min(...last),mx=Math.max(...last);
    const k=mx===mn?50:+(((rsiSeries[rsiSeries.length-1]-mn)/(mx-mn))*100).toFixed(2);
    const d=rsiSeries.length>=stochP+2?+(rsiSeries.slice(-3).reduce((s,v)=>s+v,0)/3*1).toFixed(2):k;
    return {k,d,overbought:k>80&&d>80,oversold:k<20&&d<20};
  };

  const BB = (a,p=20) => {
    if (!a||a.length<p) return {upper:0,lower:0,mid:0,width:0,position:50,squeeze:false,expanding:false};
    const sl=a.slice(-p),m=sl.reduce((s,v)=>s+v,0)/p;
    const sd=Math.sqrt(sl.reduce((s,v)=>s+(v-m)**2,0)/p);
    const up=m+2*sd,dn=m-2*sd,last=a[a.length-1];
    const prevSl=a.slice(-p-5,-5),pm=prevSl.length>0?prevSl.reduce((s,v)=>s+v,0)/prevSl.length:m;
    const psd=prevSl.length>0?Math.sqrt(prevSl.reduce((s,v)=>s+(v-pm)**2,0)/prevSl.length):sd;
    return {upper:+up.toFixed(6),lower:+dn.toFixed(6),mid:+m.toFixed(6),width:sd>0?+((4*sd/m)*100).toFixed(2):0,position:sd>0?+((last-dn)/(4*sd)*100).toFixed(1):50,squeeze:sd>0&&(4*sd/m)*100<3,expanding:sd>psd*1.1};
  };

  const ATR = (K,p=14) => {
    if (!K||K.length<2) return {atr:0,atrPct:0,volatility:'LOW'};
    const tr=K.slice(1).map((k,i)=>Math.max(k.h-k.l,Math.abs(k.h-K[i].c),Math.abs(k.l-K[i].c)));
    const atr=tr.slice(-p).reduce((s,v)=>s+v,0)/Math.min(p,tr.length);
    const last=K[K.length-1].c||1;
    const pct=+(atr/last*100).toFixed(3);
    return {atr:+atr.toFixed(6),atrPct:pct,volatility:pct>5?'EXTREME':pct>3?'HIGH':pct>1.5?'MEDIUM':'LOW'};
  };

  // ── PIVOT POINTS (Classic) ────────────────────────────────
  const pivotPoints = (K) => {
    if (!K||K.length<2) return {};
    const prev=K[K.length-2];
    const P=(prev.h+prev.l+prev.c)/3;
    return {
      P:+P.toFixed(4), R1:+(2*P-prev.l).toFixed(4), R2:+(P+(prev.h-prev.l)).toFixed(4), R3:+(prev.h+2*(P-prev.l)).toFixed(4),
      S1:+(2*P-prev.h).toFixed(4), S2:+(P-(prev.h-prev.l)).toFixed(4), S3:+(prev.l-2*(prev.h-P)).toFixed(4),
    };
  };

  // ── SMC / ICT ANALYSIS ────────────────────────────────────
  const smcAnalysis = (K, price) => {
    if (!K||K.length<20) return {signal:'Insufficient Data',bullish:false};
    const n=K.length;

    // Swing highs / lows
    const swingHighs=[], swingLows=[];
    for(let i=2;i<n-2;i++){
      if(K[i].h>K[i-1].h&&K[i].h>K[i-2].h&&K[i].h>K[i+1].h&&K[i].h>K[i+2].h) swingHighs.push({i,price:K[i].h,time:K[i].t});
      if(K[i].l<K[i-1].l&&K[i].l<K[i-2].l&&K[i].l<K[i+1].l&&K[i].l<K[i+2].l) swingLows.push({i,price:K[i].l,time:K[i].t});
    }
    const lastSH=swingHighs.slice(-3), lastSL=swingLows.slice(-3);

    // BOS (Break of Structure)
    let bos=null, choch=null;
    const recentH=lastSH.length>0?lastSH[lastSH.length-1].price:0;
    const recentL=lastSL.length>0?lastSL[lastSL.length-1].price:Infinity;
    const prevH=lastSH.length>1?lastSH[lastSH.length-2].price:0;
    const prevL=lastSL.length>1?lastSL[lastSL.length-2].price:Infinity;

    if(price>recentH&&recentH>0){
      if(K[n-3]?.c<recentH) bos={type:'Bullish BOS',level:recentH,strength:'HIGH'};
    }
    if(price<recentL&&recentL<Infinity){
      if(K[n-3]?.c>recentL) bos={type:'Bearish BOS',level:recentL,strength:'HIGH'};
    }
    // CHoCH: break of structure against prevailing trend
    if(!bos&&prevH>0&&prevL<Infinity){
      if(price>prevH&&K[n-5]?.c<prevH) choch={type:'Bullish CHoCH',level:prevH};
      if(price<prevL&&K[n-5]?.c>prevL) choch={type:'Bearish CHoCH',level:prevL};
    }

    // Order Blocks — last bearish candle before bullish impulse (Bull OB) and vice versa
    let bullOB=null, bearOB=null;
    for(let i=n-15;i<n-3;i++){
      if(i<0) continue;
      const k=K[i],nxt=K[i+1],nxt2=K[i+2];
      // Bull OB: bearish candle followed by strong bullish move
      if(k.c<k.o&&nxt.c>nxt.o&&nxt2.c>nxt2.o&&nxt.c>k.o*1.005){
        const obH=Math.max(k.o,k.c), obL=Math.min(k.o,k.c);
        if(price>=obL*0.998&&price<=obH*1.01) bullOB={atPrice:+(obH+obL)/2,high:obH,low:obL,fresh:i>n-8};
      }
      // Bear OB: bullish candle followed by strong bearish move
      if(k.c>k.o&&nxt.c<nxt.o&&nxt2.c<nxt2.o&&nxt.c<k.o*0.995){
        const obH=Math.max(k.o,k.c), obL=Math.min(k.o,k.c);
        if(price>=obL*0.99&&price<=obH*1.002) bearOB={atPrice:+(obH+obL)/2,high:obH,low:obL,fresh:i>n-8};
      }
    }

    // FVG (Fair Value Gap)
    let bullFVG=null, bearFVG=null;
    for(let i=n-12;i<n-2;i++){
      if(i<0) continue;
      const gap_bull=K[i+2].l-K[i].h;
      const gap_bear=K[i].l-K[i+2].h;
      if(gap_bull>0&&K[i].h>0){const mid=(K[i+2].l+K[i].h)/2;if(price>=K[i].h&&price<=K[i+2].l) bullFVG={high:K[i+2].l,low:K[i].h,mid:+(mid).toFixed(4),priceIn:true,gapSize:+(gap_bull/K[i].h*100).toFixed(2)};}
      if(gap_bear>0&&K[i].l>0){const mid=(K[i].l+K[i+2].h)/2;if(price>=K[i+2].h&&price<=K[i].l) bearFVG={high:K[i].l,low:K[i+2].h,mid:+(mid).toFixed(4),priceIn:true,gapSize:+(gap_bear/K[i].l*100).toFixed(2)};}
    }

    // Liquidity Sweep
    let liquiditySweep=null;
    if(lastSL.length>0&&K[n-2]&&K[n-1]){
      const sweepL=lastSL[lastSL.length-1];
      if(K[n-2].l<sweepL.price&&K[n-1].c>sweepL.price) liquiditySweep={type:'Bullish Sweep',level:sweepL.price,candle:n-2};
    }
    if(lastSH.length>0&&K[n-2]&&K[n-1]){
      const sweepH=lastSH[lastSH.length-1];
      if(K[n-2].h>sweepH.price&&K[n-1].c<sweepH.price) liquiditySweep={type:'Bearish Sweep',level:sweepH.price,candle:n-2};
    }

    // Premium / Discount zone
    const rangeH=Math.max(...K.slice(-50).map(k=>k.h));
    const rangeL=Math.min(...K.slice(-50).map(k=>k.l));
    const rangeEq=(rangeH+rangeL)/2;
    const premiumDiscount=price>rangeEq?`Premium Zone (+${((price-rangeEq)/rangeEq*100).toFixed(1)}%)`:price<rangeEq?`Discount Zone (${((price-rangeEq)/rangeEq*100).toFixed(1)}%)`:'Equilibrium';

    const bullCount=(bos?.type?.includes('Bull')?2:0)+(choch?.type?.includes('Bull')?1:0)+(bullOB?2:0)+(bullFVG?1:0)+(liquiditySweep?.type?.includes('Bull')?2:0);
    const bearCount=(bos?.type?.includes('Bear')?2:0)+(choch?.type?.includes('Bear')?1:0)+(bearOB?2:0)+(bearFVG?1:0)+(liquiditySweep?.type?.includes('Bear')?2:0);
    const signal=bullCount>bearCount?'Bullish':bearCount>bullCount?'Bearish':'Neutral';

    return {
      signal, bullish:bullCount>bearCount,
      bos, hasBOS:!!bos, choch, hasCHoCH:!!choch,
      bullOB, bearOB, inBullOB:!!bullOB, inBearOB:!!bearOB,
      bullFVG, bearFVG, inBullFVG:!!bullFVG, inBearFVG:!!bearFVG,
      liquiditySweep,
      swingHighs:lastSH.slice(-2).map(s=>+s.price.toFixed(4)),
      swingLows:lastSL.slice(-2).map(s=>+s.price.toFixed(4)),
      premiumDiscount,
      score:{bull:bullCount,bear:bearCount},
    };
  };

  // ── ELLIOTT WAVE ESTIMATION ───────────────────────────────
  const elliottWave = (K, rsi, macd, price, ema200) => {
    if (!K||K.length<20) return {wave:'Unknown',confidence:0,description:'Insufficient data'};
    const n=K.length;
    const closes=K.map(k=>k.c);
    const recentHigh=Math.max(...closes.slice(-20));
    const recentLow=Math.min(...closes.slice(-20));
    const trend=price>ema200?'UP':'DOWN';
    const rsiOB=rsi>70, rsiOS=rsi<30, rsiMid=rsi>=45&&rsi<=60;
    const macdBull=macd.bullish||macd.crossUp;

    // Detect divergence (price new high but RSI lower)
    const prev10Closes=closes.slice(-10,n-2);
    const prevMaxPrice=prev10Closes.length>0?Math.max(...prev10Closes):price;
    const prev10RSI=RSI14(closes.slice(-15,-1));
    const bullDivergence=price>prevMaxPrice&&rsi<prev10RSI-5&&rsi>60;
    const bearDivergence=price<Math.min(...closes.slice(-10,n-2))&&rsi>prev10RSI+5&&rsi<40;

    let wave='', confidence=0, description='', targets={}, nextBullTarget=null, nextBearTarget=null;

    if(trend==='UP'){
      if(rsiOS&&macdBull){wave='Wave 2 Pullback';confidence=65;description='Koreksi dalam uptrend. Setup beli terbaik sebelum Wave 3.';nextBullTarget=+(recentHigh*1.05).toFixed(4);}
      else if(rsiMid&&macdBull&&!macd.divergence){wave='Wave 3 — Impulse';confidence=80;description='Wave terkuat — momentum bullish paling powerful. Target 1.618 dari Wave 1.';nextBullTarget=+(price*1.08).toFixed(4);}
      else if(rsi>=55&&rsi<70&&macdBull&&!bullDivergence){wave='Wave 3 Extension';confidence=75;description='Kelanjutan impulse. Volume tinggi mengkonfirmasi.';nextBullTarget=+(price*1.05).toFixed(4);}
      else if(rsiOB&&bullDivergence){wave='Wave 5 Ending';confidence=70;description='Divergence RSI — kemungkinan akhir impuls. Waspada reversal atau distribusi.';nextBullTarget=+(recentHigh*1.02).toFixed(4);}
      else if(rsiOB&&!bullDivergence){wave='Wave 5 In Progress';confidence=60;description='Fase akhir impulse. Momentum kuat tapi risiko reversal meningkat.';nextBullTarget=+(recentHigh*1.03).toFixed(4);}
      else if(!macdBull&&rsi<55&&price>ema200){wave='Wave 4 Correction';confidence=65;description='Koreksi Wave 4 — biasanya lebih dangkal dari Wave 2. Support di EMA.';nextBullTarget=+(recentHigh*1.06).toFixed(4);}
      else{wave='Impulse Phase';confidence=55;description='Struktur bullish, konfirmasi wave count dalam progress.';nextBullTarget=+(price*1.04).toFixed(4);}
    } else {
      if(bearDivergence&&rsi<35){wave='Wave C Bearish';confidence=70;description='Penurunan ABC selesai — potensi reversal bullish.';nextBullTarget=+(recentHigh*0.95).toFixed(4);}
      else if(rsiOS){wave='Wave C / Capitulation';confidence=65;description='Oversold ekstrem. Potensi bottom. Tunggu konfirmasi candle reversal.';nextBullTarget=+(price*1.10).toFixed(4);}
      else if(!macdBull&&rsi<50){wave='Wave A / Wave 3 Bear';confidence=60;description='Distribusi aktif. Jauhi long agresif.';nextBearTarget=+(recentLow*0.95).toFixed(4);}
      else{wave='Corrective Phase';confidence=50;description='Fase korektif/bearish. Tunggu struktur lebih jelas.';nextBearTarget=+(price*0.95).toFixed(4);}
    }

    return {wave,confidence,description,nextBullTarget,nextBearTarget};
  };

  // ── CHART PATTERNS ────────────────────────────────────────
  const detectPatterns = (K) => {
    if (!K||K.length<10) return [];
    const patterns=[];
    const n=K.length;
    const closes=K.map(k=>k.c),opens=K.map(k=>k.o),highs=K.map(k=>k.h),lows=K.map(k=>k.l);

    // Hammer / Inverted Hammer
    const last=K[n-1];
    const body=Math.abs(last.c-last.o),range=last.h-last.l;
    const lowerWick=Math.min(last.c,last.o)-last.l,upperWick=last.h-Math.max(last.c,last.o);
    if(body>0&&range>0){
      if(lowerWick/range>0.6&&body/range<0.3){patterns.push({name:'Hammer 🔨',signal:'bullish',confidence:72});}
      if(upperWick/range>0.6&&body/range<0.3){patterns.push({name:'Shooting Star ⭐',signal:'bearish',confidence:70});}
      if(body/range>0.8){patterns.push({name:last.c>last.o?'Bull Marubozu':'Bear Marubozu',signal:last.c>last.o?'bullish':'bearish',confidence:68});}
    }

    // Engulfing
    if(n>=2){
      const prev=K[n-2],curr=K[n-1];
      if(prev.c<prev.o&&curr.c>curr.o&&curr.o<prev.c&&curr.c>prev.o){patterns.push({name:'Bull Engulfing 🐂',signal:'bullish',confidence:78});}
      if(prev.c>prev.o&&curr.c<curr.o&&curr.o>prev.c&&curr.c<prev.o){patterns.push({name:'Bear Engulfing 🐻',signal:'bearish',confidence:76});}
    }

    // Doji
    if(body/range<0.1&&range>0){patterns.push({name:'Doji ⚖️',signal:'neutral',confidence:60});}

    // Simple trend patterns (Higher High, Lower Low)
    if(n>=10){
      const last5H=Math.max(...highs.slice(-5)),prev5H=Math.max(...highs.slice(-10,-5));
      const last5L=Math.min(...lows.slice(-5)),prev5L=Math.min(...lows.slice(-10,-5));
      if(last5H>prev5H&&last5L>prev5L){patterns.push({name:'Higher High/Higher Low',signal:'bullish',confidence:72});}
      if(last5H<prev5H&&last5L<prev5L){patterns.push({name:'Lower High/Lower Low',signal:'bearish',confidence:70});}
    }

    return patterns.slice(0,3);
  };

  // ── ASTROLOGY ─────────────────────────────────────────────
  const getAstro = () => {
    const jd=Date.now()/86400000+2440587.5;
    const dnm=((jd-2460320.5)%29.53058867+29.53058867)%29.53058867;
    const phases=[[1.5,'New Moon','🌑'],[7.5,'Waxing Crescent','🌒'],[8.5,'First Quarter','🌓'],[14,'Waxing Gibbous','🌔'],[16,'Full Moon','🌕'],[22,'Waning Gibbous','🌖'],[25,'Last Quarter','🌗'],[29.5,'Waning Crescent','🌘']];
    let moonPhase='Dark Moon', moonEmoji='🌑';
    for(const [lim,ph,em] of phases){if(dnm<lim){moonPhase=ph;moonEmoji=em;break;}}
    const dsh=Math.floor((Date.now()-1713571200000)/86400000);
    const halvPhase=dsh<90?'Post-Halving Early':dsh<365?'Bull Cycle Early 🔥':dsh<480?'Bull Peak Zone ⚡':dsh<730?'Distribution ⚠️':'Accumulation 🌱';
    const chaotic=moonPhase==='Full Moon'||moonPhase==='New Moon';
    return {moonPhase,moonEmoji,halvingPhase:halvPhase,daysSinceHalving:dsh,daysSinceNM:+dnm.toFixed(1),chaotic,warning:chaotic?`${moonEmoji} ${moonPhase} — volatilitas historis tinggi. Sizing hati-hati.`:null};
  };

  // ── MARKET STRUCTURE ─────────────────────────────────────
  const marketStructure = (K, price, ema9, ema21, ema50, ema200) => {
    if (!K||K.length<10) return {structure:'Unknown'};
    const closes=K.map(k=>k.c);
    const n=closes.length;
    const trending=Math.abs(ema9-ema200)/ema200>0.05;
    const bullAlign=ema9>ema21&&ema21>ema50&&ema50>ema200;
    const bearAlign=ema9<ema21&&ema21<ema50&&ema50<ema200;

    // Higher Highs/Lows for structure
    let hhCount=0,hlCount=0,lhCount=0,llCount=0;
    for(let i=3;i<Math.min(n,20);i+=3){
      if(K[i].h>K[i-3].h) hhCount++; else lhCount++;
      if(K[i].l>K[i-3].l) hlCount++; else llCount++;
    }
    const structure=bullAlign&&hhCount>lhCount?'Uptrend (HH/HL)':bearAlign&&llCount>hlCount?'Downtrend (LH/LL)':trending?'Trending (Neutral)':'Ranging/Consolidation';

    return {structure,bullAlign,bearAlign,trending,hhCount,hlCount,lhCount,llCount};
  };

  // ── GENERATE TRADE SETUP ──────────────────────────────────
  const tradeSetup = (price, smc, ew, atr, rsi, trend) => {
    const isLong=trend==='BULLISH'||(rsi<40&&!trend.includes('BEAR'));
    const direction=isLong?'LONG':'SHORT';
    const atrVal=atr.atr||price*0.02;

    let entry=price, sl, tp1, tp2, tp3;
    if(isLong){
      // Entry at OB or current price
      entry=smc.bullOB?.low??smc.bullFVG?.low??price;
      if(Math.abs(entry-price)/price>0.05) entry=price; // Don't use if too far
      // SL below swing low or OB
      const slRef=smc.swingLows?.length?Math.min(...smc.swingLows):price*(1-atr.atrPct*2/100);
      sl=Math.min(slRef,price-(atrVal*1.5));
      const risk=price-sl;
      tp1=+(price+risk*2).toFixed(6);
      tp2=+(price+risk*3.5).toFixed(6);
      tp3=+(price+risk*5).toFixed(6);
    } else {
      entry=smc.bearOB?.high??smc.bearFVG?.high??price;
      if(Math.abs(entry-price)/price>0.05) entry=price;
      const slRef=smc.swingHighs?.length?Math.max(...smc.swingHighs):price*(1+atr.atrPct*2/100);
      sl=Math.max(slRef,price+(atrVal*1.5));
      const risk=sl-price;
      tp1=+(price-risk*2).toFixed(6);
      tp2=+(price-risk*3.5).toFixed(6);
      tp3=+(price-risk*5).toFixed(6);
    }

    const riskPct=+Math.abs((price-sl)/price*100).toFixed(2);
    const tp1Pct=+Math.abs((tp1-price)/price*100).toFixed(2);
    const rrRatio=riskPct>0?+(tp1Pct/riskPct).toFixed(2):0;

    return {direction,entry:+entry.toFixed(6),sl:+sl.toFixed(6),tp1,tp2,tp3,riskPct,tp1Pct,rrRatio};
  };

  // ── GENERATE RECOMMENDATION ───────────────────────────────
  const makeRecommendation = (score, rsi, macd, smc, ew, bb, atr) => {
    const prob=Math.max(1,Math.min(99,50+score*5));
    let action, explanation;
    const reasons=[], warnings=[];

    if(score>=5){action='🟢 STRONG BUY';explanation='Konfluensi bullish tinggi. Semua sistem aligned. Entry dengan sizing normal.';}
    else if(score>=3){action='🟢 BUY';explanation='Bias bullish kuat. Entry valid dengan manajemen risiko.';}
    else if(score>=1){action='🟡 MILD BUY';explanation='Bias bullish lemah. Entry selektif, sizing kecil (25-50%).';}
    else if(score<=-5){action='🔴 STRONG SELL';explanation='Konfluensi bearish tinggi. Hindari long, pertimbangkan short.';}
    else if(score<=-3){action='🔴 SELL/SHORT';explanation='Bias bearish dominan. Exit long atau short dengan risiko terukur.';}
    else if(score<=-1){action='🔴 MILD SELL';explanation='Tekanan jual. Kurangi eksposur atau wait for better entry.';}
    else{action='⚖️ NEUTRAL/WAIT';explanation='Tidak ada edge jelas. Tunggu konfirmasi breakout atau level kunci.';}

    // Build reasons
    if(rsi<30) reasons.push('RSI oversold — potensi reversal kuat');
    else if(rsi>70) reasons.push('RSI overbought — waspada');
    if(macd.crossUp) reasons.push('MACD golden cross — momentum baru');
    if(macd.crossDown) warnings.push('MACD death cross — momentum melemah');
    if(smc.hasBOS) reasons.push(`${smc.bos?.type} — konfirmasi struktur`);
    if(smc.inBullOB) reasons.push('Harga di Bull Order Block — zona demand institusional');
    if(smc.inBearOB) warnings.push('Harga di Bear Order Block — zona supply institusional');
    if(smc.inBullFVG) reasons.push(`Bull FVG gap ${smc.bullFVG?.gapSize}% — zona rebalance`);
    if(smc.liquiditySweep?.type?.includes('Bull')) reasons.push('Bullish liquidity sweep — short squeeze potential');
    if(bb.squeeze) reasons.push('BB squeeze — ekspansi volatilitas imminent');
    if(bb.expanding) reasons.push('BB expanding — momentum aktif');
    if(ew.wave?.includes('Wave 3')) reasons.push(`${ew.wave} — fase terkuat dalam impulse`);
    if(macd.divergence) warnings.push('MACD divergence — momentum melemah');
    if(atr.volatility==='EXTREME') warnings.push('Volatilitas EXTREME — sizing kecil');

    return {action,explanation,probability:prob,score,reasons:reasons.slice(0,5),warnings:warnings.slice(0,3)};
  };

  // ── MAIN ANALYSIS ─────────────────────────────────────────
  try {
    const sym = raw;
    const symUsdt = sym+'USDT';

    // Fetch all data parallel
    const [cc4hR, cc1hR, cc1dR, byTickR, byLSR] = await Promise.allSettled([
      sf(`https://min-api.cryptocompare.com/data/v2/histohour?fsym=${sym}&tsym=USD&limit=800&aggregate=4&e=CCCAGG`, 7000),
      sf(`https://min-api.cryptocompare.com/data/v2/histohour?fsym=${sym}&tsym=USD&limit=96&aggregate=1&e=CCCAGG`, 6000),
      sf(`https://min-api.cryptocompare.com/data/v2/histoday?fsym=${sym}&tsym=USD&limit=200&e=CCCAGG`, 6000),
      sf(`https://api.bybit.com/v5/market/tickers?category=linear&symbol=${symUsdt}`, 4000),
      sf(`https://api.bybit.com/v5/market/account-ratio?category=linear&symbol=${symUsdt}&period=1h&limit=1`, 4000),
    ]);

    // Parse CryptoCompare data
    const toKlines = (r, field='Data') => {
      if(!r||r?.Response!=='Success') return [];
      const data=(r?.Data?.[field]||r?.Data?.Data||[]);
      return data.filter(d=>d.close>0).map(d=>({t:d.time,o:+d.open,h:+d.high,l:+d.low,c:+d.close,v:+(d.volumeto||0)}));
    };

    const K4h = cc4hR.status==='fulfilled'?toKlines(cc4hR.value):[];
    const K1h = cc1hR.status==='fulfilled'?toKlines(cc1hR.value):[];
    const K1d = cc1dR.status==='fulfilled'?toKlines(cc1dR.value,'Data'):[];

    if(K4h.length<10&&K1h.length<10) {
      return res.status(200).json({error:`Symbol ${sym} tidak ditemukan atau data tidak tersedia di CryptoCompare.`,price:0,symbol:symUsdt});
    }

    // Prices
    const byTick = byTickR.status==='fulfilled'?byTickR.value?.result?.list?.[0]:null;
    const byLS   = byLSR.status==='fulfilled'?byLSR.value?.result?.list?.[0]:null;

    // Current price — Bybit if available, else last CryptoCompare candle
    const latestCC = K1h.length?K1h[K1h.length-1]:K4h[K4h.length-1];
    const price = byTick?.lastPrice?+(byTick.lastPrice):(latestCC?.c||0);

    // 24h change
    const price24hAgo = K1h.length>=24?K1h[K1h.length-24].c:(K4h.length>=6?K4h[K4h.length-6].c:price);
    const change24h = price24hAgo>0?+((price-price24hAgo)/price24hAgo*100).toFixed(2):0;

    // Volume 24h (sum last 24 hourly candles)
    const vol24h = K1h.length>=24?K1h.slice(-24).reduce((s,k)=>s+k.v,0):0;

    // Derivatives
    const frPct = byTick?.fundingRate ? +(parseFloat(byTick.fundingRate)*100).toFixed(4) : null;
    const frAnn = frPct!==null ? +(frPct*3*365).toFixed(1) : null;
    const oiVal = byTick?.openInterestValue ? +(parseFloat(byTick.openInterestValue)/1e6).toFixed(1) : null;
    let longPct=null, shortPct=null, lsRatio=null;
    if(byLS?.buyRatio){const b=parseFloat(byLS.buyRatio);longPct=+(b*100).toFixed(1);shortPct=+((1-b)*100).toFixed(1);lsRatio=+(b/(1-b)).toFixed(3);}

    // ── TA CALCULATIONS ────────────────────────────────────
    // 4H
    const c4=K4h.map(k=>k.c);
    const rsi4h  = RSI14(c4);
    const macd4h = MACD(c4);
    const bb4h   = BB(c4,20);
    const stoch4h= STOCH_RSI(c4);
    const atr4h  = ATR(K4h,14);
    const ema9_4 = EMA(c4,9),  ema21_4=EMA(c4,21),  ema50_4=EMA(c4,Math.min(50,c4.length-1));
    const ema200_4=EMA(c4,Math.min(200,c4.length-1));
    const pvt4h  = pivotPoints(K4h);

    // 1H
    const c1=K1h.length>=20?K1h.map(k=>k.c):c4.slice(-48);
    const rsi1h  = RSI14(c1);
    const macd1h = MACD(c1);
    const ema21_1= EMA(c1,21), ema50_1=EMA(c1,Math.min(50,c1.length-1));
    const bb1h   = BB(c1,20);

    // 1D
    const c1d=K1d.length>=20?K1d.map(k=>k.c):c4.filter((_,i)=>i%6===0);
    const rsi1d  = RSI14(c1d);
    const macd1d = MACD(c1d);
    const ema50_1d=EMA(c1d,Math.min(50,c1d.length-1)), ema200_1d=EMA(c1d,Math.min(200,c1d.length-1));

    // Trends
    const trend4h=price>ema50_4&&rsi4h>50?'BULLISH':price<ema50_4&&rsi4h<50?'BEARISH':'NEUTRAL';
    const trend1h=rsi1h>55?'BULLISH':rsi1h<45?'BEARISH':'NEUTRAL';
    const trend1d=price>ema200_4&&rsi1d>50?'BULLISH':price<ema50_1d&&rsi1d<45?'BEARISH':'NEUTRAL';

    // Confluence score
    let confScore=0;
    if(price>ema9_4)  confScore+=1;
    if(price>ema21_4) confScore+=1;
    if(price>ema50_4) confScore+=1;
    if(price>ema200_4)confScore+=2;
    if(macd4h.bullish)confScore+=1;
    if(macd4h.crossUp)confScore+=2;
    if(macd4h.crossDown)confScore-=2;
    if(rsi4h>55)confScore+=1; else if(rsi4h<45)confScore-=1;
    if(rsi4h<30)confScore+=2; else if(rsi4h>75)confScore-=2;
    if(trend1d==='BULLISH')confScore+=1; else if(trend1d==='BEARISH')confScore-=1;
    if(bb4h.squeeze)confScore+=1;

    // SMC analysis
    const smc4H = smcAnalysis(K4h, price);
    const smc1H = smcAnalysis(K1h.length>=20?K1h:K4h.slice(-20), price);
    if(smc4H.hasBOS&&smc4H.bos?.type?.includes('Bull'))confScore+=2;
    if(smc4H.hasBOS&&smc4H.bos?.type?.includes('Bear'))confScore-=2;
    if(smc4H.inBullOB)confScore+=2; if(smc4H.inBearOB)confScore-=2;
    if(smc4H.inBullFVG)confScore+=1; if(smc4H.inBearFVG)confScore-=1;
    if(smc4H.liquiditySweep?.type?.includes('Bull'))confScore+=2;

    // Elliott Wave
    const ew4H = elliottWave(K4h,rsi4h,macd4h,price,ema200_4);
    const ew1D = elliottWave(K1d.length>=20?K1d:K4h,rsi1d,macd1d,price,ema200_1d);

    // Chart Patterns
    const patterns4h = detectPatterns(K4h);
    const patterns1h = detectPatterns(K1h.length>=10?K1h:K4h);

    // Market Structure
    const ms4H = marketStructure(K4h,price,ema9_4,ema21_4,ema50_4,ema200_4);

    // Key Levels
    const highs50=K4h.slice(-50).map(k=>k.h).sort((a,b)=>b-a);
    const lows50=K4h.slice(-50).map(k=>k.l).sort((a,b)=>a-b);
    const resistance=highs50.find(h=>h>price)||price*1.05;
    const support=lows50.find(l=>l<price)||price*0.95;
    const res2=highs50.filter(h=>h>resistance)[0]||resistance*1.03;
    const sup2=lows50.filter(l=>l<support)[0]||support*0.97;

    // Setup
    const setup = tradeSetup(price,smc4H,ew4H,atr4h,rsi4h,trend4h);
    const rec   = makeRecommendation(confScore,rsi4h,macd4h,smc4H,ew4H,bb4h,atr4h);
    const astro = getAstro();

    // Overall probability
    const probability=rec.probability;
    const bias=confScore>=3?'BULLISH':confScore<=-3?'BEARISH':'NEUTRAL';

    return res.status(200).json({
      ok:true, ts:Date.now(), elapsed:Date.now()-t0, version:'v16',
      symbol:symUsdt, ticker:sym, name:sym,
      price:+price.toFixed(8), change24h, volume24h:+vol24h.toFixed(0),
      dataSource:`CryptoCompare (${K4h.length} 4H candles) + Bybit`,

      // Derivatives
      derivatives:{frPct,frAnn,oiVal,longPct,shortPct,lsRatio,
        frSignal:frPct===null?'—':frPct<-0.005?'Short Squeeze Risk':frPct>0.05?'Long Overloaded':'Normal',
        hasDerivatives:!!byTick,
      },

      // Summary
      summary:{bias,oneLiner:`${rec.action} — ${ew4H.wave} (${probability}%) | RSI ${rsi4h} | ${smc4H.signal}`,confluenceScore:confScore},
      confluence:{probability,signal:rec.action,score:confScore},
      recommendation:rec,

      // Technical
      rsi:{'1h':rsi1h,'4h':rsi4h,'1d':rsi1d},
      macd:{'4h':macd4h,'1h':macd1h,'1d':macd1d},
      bb:{'4h':bb4h,'1h':bb1h},
      stoch:{'4h':stoch4h},
      atr:{'4h':atr4h},
      ema:{'9':+ema9_4.toFixed(4),'21':+ema21_4.toFixed(4),'50':+ema50_4.toFixed(4),'200':+ema200_4.toFixed(4)},

      // SMC/ICT
      smc:{'4H':smc4H,'1H':smc1H},
      marketStructure:{'4H':ms4H},
      elliottWave:{'4H':ew4H,'1D':ew1D},
      chartPatterns:patterns4h,
      pivotPoints:{'4H':pvt4h},
      keyLevels:{support:+support.toFixed(4),support2:+sup2.toFixed(4),resistance:+resistance.toFixed(4),resistance2:+res2.toFixed(4)},

      // Timeframes
      timeframes:{
        '1H':{rsi:rsi1h,trend:trend1h,ema50:+ema50_1.toFixed(4),bb:bb1h,macd:macd1h,smc:smc1H.signal,elliottWave:ew4H},
        '4H':{rsi:rsi4h,trend:trend4h,ema50:+ema50_4.toFixed(4),ema200:+ema200_4.toFixed(4),bb:bb4h,macd:macd4h,smc:smc4H,elliottWave:ew4H},
        '1D':{rsi:rsi1d,trend:trend1d,ema50:+ema50_1d.toFixed(4),ema200:+ema200_1d.toFixed(4),macd:macd1d,elliottWave:ew1D},
      },

      // Trade Setup
      tradeSetup:setup,

      // Astrology
      astrology:astro,

      // Data coverage
      candleCount:{'4H':K4h.length,'1H':K1h.length,'1D':K1d.length},
    });

  } catch(e) {
    return res.status(200).json({error:e.message,price:0,symbol:raw+'USDT',ts:Date.now(),version:'v16'});
  }
}
