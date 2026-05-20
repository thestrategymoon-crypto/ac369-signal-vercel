// api/search.js — v18 ICT POWERHOUSE
// Full ICT/SMC: Order Blocks, FVG, Liquidity Pools, BSL/SSL, OTE, Wyckoff
// High-Probability Long/Short Zones (bukan trade setup)
// CryptoCompare primary → CoinGecko fallback

const N = (v,d=0) => { const n=+v; return isNaN(n)||!isFinite(n)?d:n; };
const A = v => Array.isArray(v)?v:[];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Cache-Control','s-maxage=20,stale-while-revalidate=10');
  if (req.method==='OPTIONS') return res.status(200).end();

  const raw = (req.query.symbol||req.query.s||'').toUpperCase().replace(/USDT$/,'').replace(/[^A-Z0-9]/g,'');
  if (!raw) return res.status(200).json({error:'Symbol diperlukan. Contoh: ?symbol=BTC'});
  const t0 = Date.now();

  const sf = async (url, ms) => {
    const c = new AbortController();
    const t = setTimeout(()=>c.abort(), ms);
    try {
      const r = await fetch(url, {signal:c.signal, headers:{Accept:'application/json','User-Agent':'AC369/1.0'}});
      clearTimeout(t); return r.ok ? await r.json() : null;
    } catch { clearTimeout(t); return null; }
  };

  // ── RSI ───────────────────────────────────────────────
  const calcRSI = a => {
    try {
      if (!a||a.length<16) return null;
      let g=0,l=0;
      for(let i=1;i<=14;i++){const d=a[i]-a[i-1];d>0?g+=d:l-=d;}
      g/=14;l/=14;
      for(let i=15;i<a.length;i++){const d=a[i]-a[i-1];g=(g*13+Math.max(d,0))/14;l=(l*13+Math.max(-d,0))/14;}
      return l===0?100:+(100-100/(1+g/l)).toFixed(2);
    } catch { return null; }
  };

  // ── EMA ───────────────────────────────────────────────
  const calcEMA = (a, p) => {
    try {
      if (!a||a.length<2) return N(a?.[a.length-1]);
      const k=2/(p+1); let e=a.slice(0,Math.min(p,a.length)).reduce((s,v)=>s+v,0)/Math.min(p,a.length);
      for(let i=Math.min(p,a.length);i<a.length;i++) e=a[i]*k+e*(1-k);
      return e;
    } catch { return 0; }
  };

  // ── MACD ──────────────────────────────────────────────
  const calcMACD = a => {
    try {
      if (!a||a.length<36) return null;
      const k12=2/13,k26=2/27,k9=2/10;
      let e12=a.slice(0,12).reduce((s,v)=>s+v,0)/12, e26=a.slice(0,26).reduce((s,v)=>s+v,0)/26;
      const mv=[];
      for(let i=26;i<a.length;i++){e12=a[i]*k12+e12*(1-k12);e26=a[i]*k26+e26*(1-k26);mv.push(e12-e26);}
      let sig=mv.slice(0,9).reduce((s,v)=>s+v,0)/9;
      for(let i=9;i<mv.length;i++) sig=mv[i]*k9+sig*(1-k9);
      const n=mv.length, last=N(mv[n-1]), prev=N(mv[n-2]||last), h=last-sig, ph=prev-sig;
      const div=n>7&&last<N(mv[n-8])&&a[a.length-1]>a[a.length-8];
      return {bull:last>0&&h>0, bear:last<0&&h<0, xUp:h>0&&ph<=0, xDown:h<0&&ph>=0, div, hist:+h.toFixed(8), value:+last.toFixed(8)};
    } catch { return null; }
  };

  // ── BOLLINGER BANDS ───────────────────────────────────
  const calcBB = (a, p=20) => {
    try {
      if (!a||a.length<p) return null;
      const sl=a.slice(-p), m=sl.reduce((s,v)=>s+v,0)/p;
      const sd=Math.sqrt(sl.reduce((s,v)=>s+(v-m)**2,0)/p);
      const up=m+2*sd, dn=m-2*sd, last=a[a.length-1];
      const pos=sd>0?(last-dn)/(4*sd)*100:50;
      return {upper:+up.toFixed(6), lower:+dn.toFixed(6), mid:+m.toFixed(6), width:sd>0?+(4*sd/m*100).toFixed(2):0, position:+pos.toFixed(1), squeeze:sd>0&&4*sd/m*100<3};
    } catch { return null; }
  };

  // ══════════════════════════════════════════════════════
  // DEEP ICT/SMC ANALYSIS FROM KLINES
  // ══════════════════════════════════════════════════════
  const fullICT = (K, price) => {
    if (!K||K.length<15||!price) return null;
    const n = K.length;
    const f6 = v => v>0?+v.toFixed(6):null;
    const pct = (a,b) => b>0?+((a-b)/b*100).toFixed(2):0;

    // ── SWING STRUCTURE ──────────────────────────────
    const SH=[], SL=[];
    for(let i=3;i<n-3;i++){
      if(!K[i]||!K[i-1]||!K[i+1]||!K[i-2]||!K[i+2]) continue;
      if(K[i].h>K[i-1].h&&K[i].h>K[i-2].h&&K[i].h>K[i+1].h&&K[i].h>K[i+2].h) SH.push({i,p:K[i].h,c:K[i].c});
      if(K[i].l<K[i-1].l&&K[i].l<K[i-2].l&&K[i].l<K[i+1].l&&K[i].l<K[i+2].l) SL.push({i,p:K[i].l,c:K[i].c});
    }
    const rSH=SH.slice(-4), rSL=SL.slice(-4);
    const lSH=rSH[rSH.length-1]?.p||0;
    const lSL=rSL[rSL.length-1]?.p||1e12;
    const pSH=rSH[rSH.length-2]?.p||0;
    const pSL=rSL[rSL.length-2]?.p||1e12;

    // ── BOS / CHoCH (MSS) ────────────────────────────
    let bos=null, choch=null;
    // Scan last 15 candles for structure breaks
    for(let i=n-12;i<n;i++){
      if(!K[i]) continue;
      if(lSH>0&&K[i].c>lSH&&(i===0||K[i-1]?.c<lSH)&&!bos) bos={type:'Bullish BOS',level:f6(lSH),candle:i,pctAway:pct(price,lSH)};
      if(lSL<1e12&&K[i].c<lSL&&(i===0||K[i-1]?.c>lSL)&&!bos) bos={type:'Bearish BOS',level:f6(lSL),candle:i,pctAway:pct(price,lSL)};
    }
    if(!bos&&pSH>0&&price>pSH) choch={type:'Bullish CHoCH (MSS)',level:f6(pSH),desc:'Break of prior swing high — structure shift'};
    if(!bos&&pSL<1e12&&price<pSL) choch={type:'Bearish CHoCH (MSS)',level:f6(pSL),desc:'Break of prior swing low — structure shift'};

    // ── MULTIPLE ORDER BLOCKS ─────────────────────────
    const bullOBs=[], bearOBs=[];
    for(let i=Math.max(0,n-30);i<n-2;i++){
      const c=K[i], nx=K[i+1];
      if(!c||!nx||!c.o||!c.c||!nx.c) continue;
      // Bullish OB: last bearish candle before bullish impulse
      if(c.c<c.o&&nx.c>nx.o&&nx.c>c.o*1.003){
        const H=Math.max(c.o,c.c), L=Math.min(c.o,c.c);
        const mitigated=K.slice(i+2).some(k=>k&&k.l<L);
        bullOBs.push({H:f6(H),L:f6(L),mid:f6((H+L)/2),fresh:!mitigated,age:n-i-1,vol:c.v,inZone:price<=H*1.01&&price>=L*0.995,dist:pct(price,(H+L)/2)});
      }
      // Bearish OB: last bullish candle before bearish impulse
      if(c.c>c.o&&nx.c<nx.o&&nx.c<c.o*0.997){
        const H=Math.max(c.o,c.c), L=Math.min(c.o,c.c);
        const mitigated=K.slice(i+2).some(k=>k&&k.h>H);
        bearOBs.push({H:f6(H),L:f6(L),mid:f6((H+L)/2),fresh:!mitigated,age:n-i-1,vol:c.v,inZone:price<=H*1.005&&price>=L*0.99,dist:pct(price,(H+L)/2)});
      }
    }
    // Sort by relevance (fresh + close to price)
    const sortOB=(a)=>a.sort((x,y)=>(Math.abs(x.dist)-Math.abs(y.dist))||((y.fresh?1:0)-(x.fresh?1:0))).slice(0,3);
    const topBullOBs=sortOB(bullOBs), topBearOBs=sortOB(bearOBs);
    const inBullOB=topBullOBs.some(o=>o.inZone), inBearOB=topBearOBs.some(o=>o.inZone);

    // ── MULTIPLE FVGs ────────────────────────────────
    const bullFVGs=[], bearFVGs=[];
    for(let i=Math.max(0,n-25);i<n-2;i++){
      if(!K[i]||!K[i+2]) continue;
      const gapB=K[i+2].l-K[i].h;
      const gapBe=K[i].l-K[i+2].h;
      if(gapB>0){
        const filled=K.slice(i+3).some(k=>k&&k.l<=K[i].h);
        const inGap=price>=K[i].h&&price<=K[i+2].l;
        bullFVGs.push({H:f6(K[i+2].l),L:f6(K[i].h),mid:f6((K[i].h+K[i+2].l)/2),pct:+(gapB/K[i].h*100).toFixed(2),filled,inGap,age:n-i-1,dist:pct(price,(K[i].h+K[i+2].l)/2)});
      }
      if(gapBe>0){
        const filled=K.slice(i+3).some(k=>k&&k.h>=K[i].l);
        bearFVGs.push({H:f6(K[i].l),L:f6(K[i+2].h),mid:f6((K[i].l+K[i+2].h)/2),pct:+(gapBe/K[i].l*100).toFixed(2),filled,inGap:price>=K[i+2].h&&price<=K[i].l,age:n-i-1});
      }
    }
    const topBullFVGs=bullFVGs.filter(f=>!f.filled).sort((a,b)=>Math.abs(a.dist)-Math.abs(b.dist)).slice(0,3);
    const topBearFVGs=bearFVGs.filter(f=>!f.filled).sort((a,b)=>Math.abs(a.dist||0)-Math.abs(b.dist||0)).slice(0,2);

    // ── LIQUIDITY POOLS (BSL/SSL) ─────────────────────
    const bslPools=[], sslPools=[];
    // BSL = swing highs that haven't been taken yet
    rSH.forEach(sh=>{
      if(sh.p>price){
        const taken=K.slice(sh.i+1).some(k=>k&&k.h>sh.p);
        bslPools.push({level:f6(sh.p),taken,dist:pct(sh.p,price),type:'BSL (Buy-Side Liquidity)'});
      }
    });
    // SSL = swing lows not yet taken
    rSL.forEach(sl=>{
      if(sl.p<price){
        const taken=K.slice(sl.i+1).some(k=>k&&k.l<sl.p);
        sslPools.push({level:f6(sl.p),taken,dist:pct(sl.p,price),type:'SSL (Sell-Side Liquidity)'});
      }
    });
    // Equal Highs/Lows
    let eqH=null, eqL=null;
    if(rSH.length>=2){const d=Math.abs(rSH[rSH.length-1].p-rSH[rSH.length-2].p)/(rSH[rSH.length-1].p||1);if(d<0.006)eqH={level:f6(rSH[rSH.length-1].p),desc:'Equal Highs — BSL cluster, likely target for price',dist:pct(rSH[rSH.length-1].p,price)};}
    if(rSL.length>=2){const d=Math.abs(rSL[rSL.length-1].p-rSL[rSL.length-2].p)/(rSL[rSL.length-1].p||1);if(d<0.006)eqL={level:f6(rSL[rSL.length-1].p),desc:'Equal Lows — SSL cluster, likely target for short',dist:pct(rSL[rSL.length-1].p,price)};}

    // ── LIQUIDITY SWEEP DETECTION ─────────────────────
    let lastSweep=null;
    if(rSL.length>0&&n>=3){const s=rSL[rSL.length-1];if(K[n-2]?.l<s.p&&K[n-1]?.c>s.p){lastSweep={type:'Bullish SSL Sweep (smart money grab)',level:f6(s.p),desc:'Price swept sell-side liquidity then reversed up — institutional long entry likely',bullish:true};}}
    if(!lastSweep&&rSH.length>0&&n>=3){const s=rSH[rSH.length-1];if(K[n-2]?.h>s.p&&K[n-1]?.c<s.p){lastSweep={type:'Bearish BSL Sweep (smart money grab)',level:f6(s.p),desc:'Price swept buy-side liquidity then reversed down — institutional short entry likely',bullish:false};}}

    // ── OTE ZONE (ICT Optimal Trade Entry) ───────────
    const rangeH=Math.max(...K.slice(-30).map(k=>k.h||0));
    const rangeL=Math.min(...K.slice(-30).map(k=>k.l||1e12).filter(v=>v<1e12));
    const rangeR=rangeH-rangeL;
    const equil=(rangeH+rangeL)/2;
    const pip=rangeR>0?+((price-rangeL)/rangeR*100).toFixed(1):50;
    // OTE: 61.8-78.6% retracement from recent swing
    const oteL=rangeR>0?+(equil+(equil-rangeL)*0.382).toFixed(6):null;
    const oteH=rangeR>0?+(equil+(rangeH-equil)*0.382).toFixed(6):null;
    const oteLong=rangeR>0?+(rangeH-(rangeH-rangeL)*0.786).toFixed(6):null;  // 78.6% retrace
    const oteHigh=rangeR>0?+(rangeH-(rangeH-rangeL)*0.618).toFixed(6):null; // 61.8% retrace
    const inOTELong=oteLong&&oteHigh&&price>=oteLong&&price<=oteHigh;
    const inOTEShort=oteL&&oteH&&price>=oteL&&price<=oteH;
    const zone=pip>70?'Premium Zone (>70% — sell area)':pip>55?'Above Equilibrium (50-70%)':pip<30?'Discount Zone (<30% — buy area)':pip<45?'Below Equilibrium (30-50%)':'Equilibrium (50% — balanced)';

    // ── WYCKOFF PHASE ─────────────────────────────────
    let wyckoff={phase:'Undefined',desc:'Insufficient data for Wyckoff analysis'};
    try {
      const recentH=Math.max(...K.slice(-10).map(k=>k.h||0));
      const recentL=Math.min(...K.slice(-10).map(k=>k.l||1e12).filter(v=>v<1e12));
      const vol10=K.slice(-10).reduce((s,k)=>s+N(k.v),0)/10;
      const vol3=K.slice(-3).reduce((s,k)=>s+N(k.v),0)/3;
      const volIncrease=vol3>vol10*1.3;
      const isRanging=rangeR>0&&(recentH-recentL)/recentH<0.08;
      const nearLow=pip<25;
      const nearHigh=pip>75;
      const priceDown=K[n-1]?.c<K[n-6]?.c;
      const priceUp=K[n-1]?.c>K[n-6]?.c;
      if(nearLow&&volIncrease&&priceUp) wyckoff={phase:'Phase C — Spring/Test',desc:'Possible accumulation spring. Smart money testing support before markup. Watch for bullish confirmation.',bias:'bullish'};
      else if(nearLow&&isRanging) wyckoff={phase:'Phase B — Accumulation',desc:'Price ranging near lows. Possible accumulation phase. Institutional buyers absorbing supply.',bias:'bullish'};
      else if(nearLow&&!volIncrease) wyckoff={phase:'Phase A — Selling Climax',desc:'Possible end of markdown. Watch for increased volume + wick rejection for reversal.',bias:'neutral'};
      else if(nearHigh&&volIncrease&&priceDown) wyckoff={phase:'Phase C — UTAD/Distribution',desc:'Possible distribution. Price above range with high vol then reversal. UTAD (Upthrust After Distribution).',bias:'bearish'};
      else if(nearHigh&&isRanging) wyckoff={phase:'Phase B — Distribution',desc:'Price ranging near highs. Possible distribution. Institutional sellers offloading positions.',bias:'bearish'};
      else if(priceUp&&!isRanging&&pip>45) wyckoff={phase:'Markup Phase',desc:'Uptrend in progress. Strong demand. Pullbacks to OBs/FVGs are opportunities.',bias:'bullish'};
      else if(priceDown&&!isRanging&&pip<55) wyckoff={phase:'Markdown Phase',desc:'Downtrend in progress. Supply dominates. Rallies to bearish OBs are shorting opportunities.',bias:'bearish'};
      else wyckoff={phase:'Re-Accumulation / Consolidation',desc:'Sideways movement within uptrend. Potential energy building before next impulse.',bias:'neutral'};
    } catch {}

    // ── HIGH PROBABILITY ZONES ────────────────────────
    // Long zone: confluence of Bull OBs + FVGs + SSL + Discount
    const longZoneLevels=[];
    topBullOBs.slice(0,2).forEach(ob=>{if(ob.fresh) longZoneLevels.push({level:(+ob.L+ob.H)/2,src:'Bull OB',weight:3});});
    topBullFVGs.slice(0,2).forEach(fvg=>{longZoneLevels.push({level:+fvg.mid,src:'Bull FVG',weight:2});});
    sslPools.filter(s=>!s.taken).slice(0,2).forEach(s=>{longZoneLevels.push({level:+s.level,src:'SSL Zone',weight:2});});
    if(oteLong) longZoneLevels.push({level:+oteLong,src:'OTE 78.6%',weight:2});
    if(eqL) longZoneLevels.push({level:+eqL.level,src:'Equal Lows (SSL)',weight:3});

    // Short zone: confluence of Bear OBs + Bear FVGs + BSL + Premium
    const shortZoneLevels=[];
    topBearOBs.slice(0,2).forEach(ob=>{if(ob.fresh) shortZoneLevels.push({level:(+ob.L+ob.H)/2,src:'Bear OB',weight:3});});
    topBearFVGs.slice(0,1).forEach(fvg=>{shortZoneLevels.push({level:+fvg.mid,src:'Bear FVG',weight:2});});
    bslPools.filter(s=>!s.taken).slice(0,2).forEach(s=>{shortZoneLevels.push({level:+s.level,src:'BSL Zone',weight:2});});
    if(oteH) shortZoneLevels.push({level:+oteH,src:'OTE Level',weight:2});
    if(eqH) shortZoneLevels.push({level:+eqH.level,src:'Equal Highs (BSL)',weight:3});

    // Calculate zone ranges
    let longZone=null, shortZone=null;
    if(longZoneLevels.length>0){
      const sorted=longZoneLevels.map(x=>x.level).filter(x=>x>0).sort((a,b)=>a-b);
      if(sorted.length>=2){const lo=sorted[0],hi=sorted[sorted.length-1];longZone={low:f6(lo),high:f6(hi),midpoint:f6((lo+hi)/2),sources:longZoneLevels.slice(0,4).map(x=>x.src).join(' + '),strength:Math.min(98,50+longZoneLevels.reduce((s,x)=>s+x.weight,0)*3)};}
      else if(sorted.length===1){const v=sorted[0];longZone={low:f6(v*0.997),high:f6(v*1.003),midpoint:f6(v),sources:longZoneLevels[0].src,strength:55};}
    }
    if(shortZoneLevels.length>0){
      const sorted=shortZoneLevels.map(x=>x.level).filter(x=>x>0).sort((a,b)=>a-b);
      if(sorted.length>=2){const lo=sorted[0],hi=sorted[sorted.length-1];shortZone={low:f6(lo),high:f6(hi),midpoint:f6((lo+hi)/2),sources:shortZoneLevels.slice(0,4).map(x=>x.src).join(' + '),strength:Math.min(98,50+shortZoneLevels.reduce((s,x)=>s+x.weight,0)*3)};}
      else if(sorted.length===1){const v=sorted[0];shortZone={low:f6(v*0.997),high:f6(v*1.003),midpoint:f6(v),sources:shortZoneLevels[0].src,strength:55};}
    }

    // ── DISPLACEMENT CANDLES ──────────────────────────
    const displacements=[];
    for(let i=Math.max(0,n-10);i<n;i++){
      const k=K[i]; if(!k) continue;
      const rng=k.h-k.l;
      const avgRng=K.slice(Math.max(0,i-5),i).reduce((s,x)=>s+(x?.h-x?.l||0),0)/5;
      if(avgRng>0&&rng>avgRng*2.5&&N(k.v)>0){
        displacements.push({dir:k.c>k.o?'Bullish':'Bearish',size:+(rng/avgRng).toFixed(1),candle:n-i,level:k.c>k.o?f6(k.l):f6(k.h)});
      }
    }

    // ── SMC OVERALL SCORE ─────────────────────────────
    const bullScore=(inBullOB?3:0)+(topBullFVGs.filter(f=>f.inGap).length*2)+(bos?.type?.includes('Bull')?4:0)+(choch?.type?.includes('Bull')?3:0)+(lastSweep?.bullish===true?3:0)+(wyckoff.bias==='bullish'?2:0)+(pip<35?2:0);
    const bearScore=(inBearOB?3:0)+(bos?.type?.includes('Bear')?4:0)+(choch?.type?.includes('Bear')?3:0)+(lastSweep?.bullish===false?3:0)+(wyckoff.bias==='bearish'?2:0)+(pip>65?2:0);

    return {
      // Structure
      structure:{bos,choch,hasBOS:!!bos,hasCHoCH:!!choch,displacement:displacements[0]||null},
      // Order Blocks (multiple)
      orderBlocks:{bullish:topBullOBs,bearish:topBearOBs,inBullOB,inBearOB},
      // FVG (multiple)
      fvg:{bullish:topBullFVGs,bearish:topBearFVGs},
      // Liquidity
      liquidity:{bsl:bslPools.slice(0,3),ssl:sslPools.slice(0,3),eqH,eqL,lastSweep},
      // Zones
      zones:{pip,zone,equil:+equil.toFixed(6),rangeH:+rangeH.toFixed(6),rangeL:+rangeL.toFixed(6),inOTELong,inOTEShort,oteLong,oteHigh,oteL,oteH},
      // Wyckoff
      wyckoff,
      // High Probability Zones
      highProbZones:{long:longZone,short:shortZone},
      // Summary
      signal:bullScore>bearScore?'Bullish':bearScore>bullScore?'Bearish':'Neutral',
      bull:bullScore, bear:bearScore,
    };
  };

  // ── CHART PATTERNS ────────────────────────────────────
  const getPatterns = (K, price, h, l, ch24) => {
    try {
      const pats=[];
      const op=price>0&&ch24>-99?price/(1+ch24/100):price;
      const rng=h-l;
      if(rng>0){const bd=Math.abs(price-op)/rng,lw=(Math.min(price,op)-l)/rng,uw=(h-Math.max(price,op))/rng,pp=(price-l)/rng;
        if(lw>0.55&&bd<0.30&&uw<0.20&&pp<0.45) pats.push({name:'🔨 Hammer',signal:'bullish',winRate:76,desc:'Long lower wick. Buyers strongly rejected lower prices.'});
        if(uw>0.55&&bd<0.30&&lw<0.20&&pp>0.55) pats.push({name:'⭐ Shooting Star',signal:'bearish',winRate:75,desc:'Long upper wick. Sellers strongly rejected higher prices.'});
        if(bd>0.75&&ch24>3&&price>op) pats.push({name:'🐂 Bull Marubozu',signal:'bullish',winRate:77,desc:'Full-body bullish candle. Strong institutional buying momentum.'});
        if(bd>0.75&&ch24<-3&&price<op) pats.push({name:'🐻 Bear Marubozu',signal:'bearish',winRate:77,desc:'Full-body bearish candle. Strong institutional selling momentum.'});
      }
      if(A(K).length>=3){
        const kn=K.length,C=K[kn-1],P=K[kn-2],P2=K[kn-3];
        if(C&&P&&P2&&C.c&&P.c&&P2.c){
          const Cb=Math.abs(C.c-C.o),Pb=Math.abs(P.c-P.o),P2b=Math.abs(P2.c-P2.o),P2r=Math.max(P2.h-P2.l,0.001);
          if(P.c<P.o&&C.c>C.o&&C.o<=P.c&&C.c>=P.o&&Cb>Pb) pats.push({name:'🐂 Bullish Engulfing',signal:'bullish',winRate:78,desc:'Current candle engulfs prior bearish. Strong demand entry.'});
          if(P.c>P.o&&C.c<C.o&&C.o>=P.c&&C.c<=P.o&&Cb>Pb) pats.push({name:'🐻 Bearish Engulfing',signal:'bearish',winRate:78,desc:'Current candle engulfs prior bullish. Strong supply entry.'});
          if(P2.c<P2.o&&Pb/(P2b+0.001)<0.40&&C.c>C.o&&C.c>(P2.o+P2.c)/2) pats.push({name:'🌟 Morning Star',signal:'bullish',winRate:78,desc:'3-candle reversal. Selling exhaustion + buyer confirmation.'});
          if(P2.c>P2.o&&Pb/(P2b+0.001)<0.40&&C.c<C.o&&C.c<(P2.o+P2.c)/2) pats.push({name:'🌆 Evening Star',signal:'bearish',winRate:78,desc:'3-candle reversal. Buying exhaustion + seller confirmation.'});
          if(P2.c>P2.o&&P.c>P.o&&C.c>C.o&&P.c>P2.c&&C.c>P.c&&P2b/P2r>0.5) pats.push({name:'⚔️ 3 White Soldiers',signal:'bullish',winRate:83,desc:'3 consecutive bullish candles. Institutional accumulation momentum.'});
          if(P2.c<P2.o&&P.c<P.o&&C.c<C.o&&P.c<P2.c&&C.c<P.c&&P2b/P2r>0.5) pats.push({name:'🐦 3 Black Crows',signal:'bearish',winRate:83,desc:'3 consecutive bearish candles. Institutional distribution momentum.'});
          if(P.c<P.o&&C.c>C.o&&C.o<P.l&&C.c>(P.o+P.c)/2) pats.push({name:'🌙 Piercing Pattern',signal:'bullish',winRate:75,desc:'Bullish pierces >50% of prior bearish candle.'});
          if(P.c>P.o&&C.c<C.o&&C.o>P.h&&C.c<(P.o+P.c)/2) pats.push({name:'☁️ Dark Cloud Cover',signal:'bearish',winRate:75,desc:'Bearish pierces >50% of prior bullish candle.'});
          if(C.h<=P.h&&C.l>=P.l) pats.push({name:'📦 Inside Bar / NR4',signal:C.c>=C.o?'bullish':'bearish',winRate:76,desc:'Compression inside prior candle. Directional breakout imminent.'});
          if(kn>=8){const ref=N(K[kn-7]?.c);if(ref>0){const mv=(N(K[kn-3]?.c)-ref)/ref*100;const fl=Math.max(...K.slice(-4).map(k=>N(k?.h)))-Math.min(...K.slice(-4).map(k=>N(k?.l,1e9)));if(N(C.c)>0&&fl/N(C.c)*100<5){if(mv>5) pats.push({name:'🏴 Bull Flag',signal:'bullish',winRate:85,desc:'+'+mv.toFixed(1)+'% impulse + tight consolidation. Continuation setup.'});if(mv<-5) pats.push({name:'🏴 Bear Flag',signal:'bearish',winRate:85,desc:mv.toFixed(1)+'% drop + bounce. Continuation lower.';});}}}
        }
      }
      return pats.filter(p=>p.winRate>=75).sort((a,b)=>b.winRate-a.winRate).slice(0,3);
    } catch { return []; }
  };

  // ── ELLIOTT WAVE ──────────────────────────────────────
  const getEW = (rsi, ch24, ch7, macd, ema200, price) => {
    try {
      const trend=price>ema200?'UP':'DOWN';
      const uD=ch24>1.5, dD=ch24<-1.5, oS=rsi<32, oB=rsi>70;
      const uW=ch7>3, dW=ch7<-3;
      if(trend==='UP'){
        if(oS&&uW) return {w:'📉 Wave 2 Pullback',c:78,d:'Correction in uptrend. RSI '+rsi.toFixed(0)+' oversold — BEST ENTRY. Ideal before Wave 3 impulse.'};
        if(rsi>=42&&rsi<=65&&uD&&(macd?.xUp||macd?.bull)) return {w:'🚀 Wave 3 — Impulse',c:82,d:'Strongest phase. High volume confirms entry. Target 1.618x Wave 1.'};
        if(rsi>=55&&uD&&macd?.bull&&!macd?.div) return {w:'⚡ Wave 3 Extension',c:72,d:'Continuation of impulse. Trail stop from recent swing low.'};
        if(dD&&rsi>=38&&rsi<=55) return {w:'⚖️ Wave 4 Correction',c:65,d:'Consolidation before final Wave 5. Expect pullback to EMA/OB.'};
        if(oB&&macd?.div) return {w:'⚠️ Wave 5 Ending Diagonal',c:70,d:'RSI divergence + extended run. LIKELY PEAK. Reduce position.'};
        if(oB&&!macd?.div) return {w:'⚡ Wave 5 Progress',c:62,d:'Overbought but no divergence yet. Trail stop tightly.'};
        return {w:'↗️ Impulse Building',c:55,d:'Uptrend structure intact. Await pullback to OB/OTE for entry.'};
      } else {
        if(oS&&(macd?.xUp||uD)) return {w:'🔄 Wave C Complete',c:74,d:'RSI '+rsi.toFixed(0)+' oversold + positive momentum. Potential major bottom.'};
        if(oS&&!uD) return {w:'💎 Wave C Capitulation',c:74,d:'Extreme oversold. Near-term bottom forming. Confirm with reversal candle.'};
        if(uD&&ch24>4&&!oS) return {w:'🔄 Wave C → MSS',c:67,d:'Daily up in downtrend. Market Structure Shift developing.'};
        if(dW&&dD&&rsi<45) return {w:'📉 Wave A/C Bearish',c:70,d:'Downtrend active. Rallies to bear OBs/FVGs are shorting setups.'};
        if(Math.abs(ch24)<2) return {w:'⚖️ Coiling / Consolidation',c:55,d:'Tight range. Watch for volume breakout to determine direction.'};
        return {w:'⚖️ Corrective Phase',c:50,d:'Wait for clear directional setup with volume confirmation.'};
      }
    } catch { return {w:'⚖️ Corrective Phase',c:50,d:'Analysis in progress.'}; }
  };

  // ── ASTRO ─────────────────────────────────────────────
  const getAstro = () => {
    try {
      const jd=Date.now()/86400000+2440587.5;
      const dm=((jd-2460320.5)%29.53058867+29.53058867)%29.53058867;
      const ph=[[1.5,'New Moon','🌑'],[8.5,'First Quarter','🌓'],[16,'Full Moon','🌕'],[22,'Waning','🌖'],[29.5,'Waning Crescent','🌘']];
      let mp='Dark Moon',me='🌑';
      for(const[lim,p,e]of ph)if(dm<lim){mp=p;me=e;break;}
      const ds=Math.floor((Date.now()-1713571200000)/86400000);
      const hp=ds<365?'Bull Early 🔥':ds<480?'Bull Peak ⚡':ds<730?'Distribution ⚠️':'Accumulation 🌱';
      return {moonPhase:mp,moonEmoji:me,halvingPhase:hp,chaotic:mp==='Full Moon'||mp==='New Moon'};
    } catch { return {moonPhase:'—',moonEmoji:'🌙',halvingPhase:'Bull Cycle',chaotic:false}; }
  };

  // ── MAIN ──────────────────────────────────────────────
  try {
    const sym = raw;
    const astro = getAstro();

    // Parallel: CryptoCompare 4H klines + 1H klines + Bybit price
    const [cc4R, cc1R, byR] = await Promise.allSettled([
      sf('https://min-api.cryptocompare.com/data/v2/histohour?fsym='+sym+'&tsym=USD&limit=60&aggregate=4&e=CCCAGG', 6000),
      sf('https://min-api.cryptocompare.com/data/v2/histohour?fsym='+sym+'&tsym=USD&limit=48&aggregate=1&e=CCCAGG', 5000),
      sf('https://api.bybit.com/v5/market/tickers?category=linear&symbol='+sym+'USDT', 3000),
    ]);

    const parseCC = r => {
      try {
        if(r.status!=='fulfilled'||r.value?.Response!=='Success') return [];
        return A(r.value?.Data?.Data).filter(d=>N(d.close)>0&&N(d.close)<1e10&&N(d.high)>=N(d.low)).map(d=>({t:N(d.time),o:N(d.open),h:N(d.high),l:N(d.low),c:N(d.close),v:N(d.volumeto)}));
      } catch { return []; }
    };

    const K4h = parseCC(cc4R);
    const K1h = parseCC(cc1R);
    const byTick = byR.status==='fulfilled' ? byR.value?.result?.list?.[0] : null;

    // CoinGecko fallback if CC failed
    if(K4h.length<16){
      const cgSearch=await sf('https://api.coingecko.com/api/v3/search?query='+sym, 4000);
      const cgMatch=A(cgSearch?.coins).find(c=>c.symbol?.toUpperCase()===sym)||A(cgSearch?.coins)[0];
      if(!cgMatch) return res.status(200).json({ok:false,error:'Symbol '+sym+' tidak ditemukan di CryptoCompare dan CoinGecko.',price:0,symbol:sym+'USDT',ts:Date.now(),version:'v18'});
      const cgData=await sf('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids='+cgMatch.id+'&sparkline=false&price_change_percentage=24h,7d', 5000);
      const cg=Array.isArray(cgData)?cgData[0]:null;
      if(!cg||!cg.current_price) return res.status(200).json({ok:false,error:'Data market untuk '+sym+' tidak tersedia.',price:0,symbol:sym+'USDT',ts:Date.now(),version:'v18'});
      const p=N(cg.current_price),c24=N(cg.price_change_percentage_24h),c7=N(cg.price_change_percentage_7d);
      const h=N(cg.high_24h)||p*1.02, l=N(cg.low_24h)||p*0.98;
      const pp=(h>l)?(p-l)/(h-l):0.5;
      const estRSI=Math.max(10,Math.min(90,50+c24*2.5+(pp-0.5)*25+(c7>0?4:-4)));
      const ictLite=fullICT(null,p)||{};
      const smcEst={}; const zone=pp>0.7?'Premium Zone':pp<0.3?'Discount Zone':'Equilibrium';
      const ewLite=getEW(estRSI,c24,c7,null,p*(c7>0?0.9:1.1),p);
      const prob=Math.max(5,Math.min(95,50+(c24>0?5:-5)+(c7>0?5:-5)+(estRSI<35?8:estRSI>70?-8:0)));
      return res.status(200).json({ok:true,ts:Date.now(),elapsed:Date.now()-t0,version:'v18',symbol:sym+'USDT',ticker:sym,name:S(cg.name)||sym,price:p,change24h:+c24.toFixed(2),change7d:+c7.toFixed(2),volume24h:N(cg.total_volume),mcap:N(cg.market_cap),dataSource:'CoinGecko (Lite Analysis)',rsi:{'1H':+estRSI.toFixed(1),'4H':+estRSI.toFixed(1),'1D':+estRSI.toFixed(1)},macd:{'4H':null},bb:{'4H':null},ema:{},ict:null,smc:{signal:zone,zone,pip:+(pp*100).toFixed(1)},elliottWave:{'4H':ewLite},chartPatterns:[],probability:prob,confluence:{probability:prob,signal:prob>65?'BULLISH':prob<45?'BEARISH':'NEUTRAL'},summary:{bias:c24>0?'BULLISH':'BEARISH',oneLiner:'Limited data analysis (CoinGecko). Search with klines unavailable.'},astrology:astro});
    }

    // Full analysis from CryptoCompare klines
    const cls4 = K4h.map(k=>k.c);
    const cls1 = K1h.map(k=>k.c);
    const price = byTick?.lastPrice?N(byTick.lastPrice):K4h[K4h.length-1].c;

    // RSI multi-timeframe
    const rsi4h = calcRSI(cls4)||50;
    const rsi1h = calcRSI(cls1)||rsi4h;
    const rsi1d = calcRSI(cls4.filter((_,i)=>i%6===0))||rsi4h; // Approximate 1D from 4H

    // EMA
    const ema9  = calcEMA(cls4,9);
    const ema21 = calcEMA(cls4,21);
    const ema50 = calcEMA(cls4,Math.min(50,cls4.length-1));
    const ema200= calcEMA(cls4,Math.min(200,cls4.length-1));

    // MACD
    const macd4h = calcMACD(cls4);
    const macd1h = calcMACD(cls1);

    // BB
    const bb4h = calcBB(cls4,20);

    // 24h change from klines
    const price6ago = cls4[cls4.length-7]?.c||price;
    const ch24 = price6ago>0?+(( price-price6ago)/price6ago*100).toFixed(2):0;
    const price42ago = cls4[cls4.length-43]?.c||price;
    const ch7d = price42ago>0?+((price-price42ago)/price42ago*100).toFixed(2):0;

    // HIGH/LOW from last 6 candles
    const h24 = Math.max(...K4h.slice(-6).map(k=>k.h||0));
    const l24 = Math.min(...K4h.slice(-6).map(k=>k.l||1e12).filter(v=>v<1e12));

    // DEEP ICT Analysis
    const ict = fullICT(K4h, price);

    // Chart Patterns
    const chartPats = getPatterns(K4h, price, h24, l24, ch24);

    // Elliott Wave
    const ewRes = getEW(rsi4h, ch24, ch7d, macd4h, ema200, price);

    // Pivot Points
    const pv=K4h[K4h.length-2]||K4h[K4h.length-1];
    const P=(pv.h+pv.l+pv.c)/3;
    const pivot={P:+P.toFixed(6),R1:+(2*P-pv.l).toFixed(6),R2:+(P+pv.h-pv.l).toFixed(6),R3:+(2*P+(pv.h-pv.l)).toFixed(6),S1:+(2*P-pv.h).toFixed(6),S2:+(P-(pv.h-pv.l)).toFixed(6),S3:+(2*P-(2*pv.h-pv.l)).toFixed(6)};

    // ATR
    const atrArr=K4h.slice(1).map((k,i)=>Math.max(k.h-k.l,Math.abs(k.h-K4h[i].c),Math.abs(k.l-K4h[i].c)));
    const atr=atrArr.slice(-14).reduce((s,v)=>s+v,0)/14;
    const atrPct=+(atr/price*100).toFixed(3);

    // Trend
    const t4h=price>ema50?'BULLISH':price<ema50?'BEARISH':'NEUTRAL';
    const t1h=rsi1h>55?'BULLISH':rsi1h<45?'BEARISH':'NEUTRAL';
    const t1d=price>ema200?'BULLISH':price<ema200?'BEARISH':'NEUTRAL';

    // Probability
    let prob=50;
    if(price>ema9)  prob+=3;if(price>ema21)prob+=3;if(price>ema50)prob+=4;if(price>ema200)prob+=5;
    if(price<ema9)  prob-=3;if(price<ema21)prob-=3;if(price<ema50)prob-=4;if(price<ema200)prob-=5;
    if(macd4h?.xUp) prob+=8;if(macd4h?.xDown)prob-=8;if(macd4h?.bull)prob+=3;if(macd4h?.bear)prob-=3;
    if(rsi4h<30)    prob+=8;if(rsi4h>70)prob-=8;if(rsi4h>=45&&rsi4h<=60)prob+=3;
    if(ict?.signal==='Bullish')prob+=N(ict?.bull,0)*2;if(ict?.signal==='Bearish')prob-=N(ict?.bear,0)*2;
    if(chartPats.some(p=>p.signal==='bullish'&&p.winRate>=80))prob+=4;
    if(chartPats.some(p=>p.signal==='bearish'&&p.winRate>=80))prob-=4;
    prob=Math.max(2,Math.min(98,Math.round(prob)));

    const bias=prob>=65?'BULLISH':prob<=35?'BEARISH':'NEUTRAL';
    const biasLabel=prob>=72?'STRONG BULLISH':prob>=60?'BULLISH':prob>=52?'MILD BULLISH':prob<=28?'STRONG BEARISH':prob<=40?'BEARISH':prob<=48?'MILD BEARISH':'NEUTRAL';

    // One-liner summary
    const oneLiner=biasLabel+' | '+ewRes.w+' | RSI '+rsi4h.toFixed(0)+' | '+(ict?.signal||'Neutral');

    return res.status(200).json({
      ok:true, ts:Date.now(), elapsed:Date.now()-t0, version:'v18',
      symbol:sym+'USDT', ticker:sym,
      price:+price.toFixed(8), change24h:+ch24.toFixed(2), change7d:+ch7d.toFixed(2),
      high24h:+h24.toFixed(6), low24h:+l24.toFixed(6),
      volume24h:K4h.slice(-6).reduce((s,k)=>s+N(k.v),0),
      dataSource:'CryptoCompare (Full Analysis)',
      // Multi-TF RSI
      rsi:{'1H':+rsi1h.toFixed(2),'4H':+rsi4h.toFixed(2),'1D':+rsi1d.toFixed(2)},
      // EMA levels
      ema:{9:+ema9.toFixed(6),21:+ema21.toFixed(6),50:+ema50.toFixed(6),200:+ema200.toFixed(6)},
      // MACD
      macd:{'4H':macd4h,'1H':macd1h},
      // Bollinger Bands
      bb:{'4H':bb4h},
      // ATR
      atr:{value:+atr.toFixed(6),pct:atrPct,volatility:atrPct>5?'HIGH':atrPct>2?'MEDIUM':'LOW'},
      // Multi-TF Trend
      timeframes:{'1H':{rsi:+rsi1h.toFixed(2),trend:t1h},'4H':{rsi:+rsi4h.toFixed(2),trend:t4h,ema50:+ema50.toFixed(6),ema200:+ema200.toFixed(6)},'1D':{trend:t1d}},
      // Deep ICT Analysis
      ict,
      // Simplified smc for backward compat
      smc:{signal:ict?.signal||'Neutral',hasBOS:ict?.structure?.hasBOS,bosType:ict?.structure?.bos?.type,hasCHoCH:ict?.structure?.hasCHoCH,inBullOB:ict?.orderBlocks?.inBullOB,inBearOB:ict?.orderBlocks?.inBearOB,zone:ict?.zones?.zone,pip:ict?.zones?.pip},
      // Elliott Wave
      elliottWave:{'4H':ewRes},
      // Chart Patterns
      chartPatterns:chartPats,
      // Pivot Points
      pivotPoints:{'4H':pivot},
      // Probability
      probability:prob,
      confluence:{probability:prob,signal:biasLabel},
      // Summary
      summary:{bias,biasLabel,probability:prob,oneLiner},
      // Astrology
      astrology:astro,
      candleCount:{'4H':K4h.length,'1H':K1h.length},
    });

  } catch(e) {
    return res.status(200).json({ok:false,error:e.message,price:0,symbol:raw+'USDT',ts:Date.now(),version:'v18'});
  }
}

function S(v,d=''){return v!=null?String(v):d;}
