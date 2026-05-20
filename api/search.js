// api/search.js — v19 PARALLEL NO-TIMEOUT
// ROOT CAUSE FIX: CC + CG search berjalan PARALLEL (bukan sequential)
// v18: CC(5s) → CG search(4s) → CG markets(5s) = 14s ❌
// v19: CC∥CG_search(5s) → CG markets(3.5s) = 8.5s max ✅
// Full ICT/SMC: OB, FVG, Liquidity, BSL/SSL, OTE, Wyckoff, High-Prob Zones

const N=(v,d=0)=>{const n=+v;return isNaN(n)||!isFinite(n)?d:n;};
const A=v=>Array.isArray(v)?v:[];
const fp=(v,d=6)=>{const n=N(v);if(n===0)return'—';if(Math.abs(n)<0.001)return n.toExponential(3);return n.toFixed(Math.abs(n)>=1000?0:Math.abs(n)>=1?3:d);};

export default async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Cache-Control','s-maxage=20,stale-while-revalidate=10');
  if(req.method==='OPTIONS')return res.status(200).end();
  const raw=(req.query.symbol||req.query.s||'').toUpperCase().replace(/USDT$/,'').replace(/[^A-Z0-9]/g,'');
  if(!raw)return res.status(200).json({error:'Symbol diperlukan. Contoh: ?symbol=BTC'});
  const t0=Date.now();

  const sf=async(url,ms)=>{
    const c=new AbortController();const t=setTimeout(()=>c.abort(),ms);
    try{const r=await fetch(url,{signal:c.signal,headers:{Accept:'application/json','User-Agent':'AC369/1.0'}});clearTimeout(t);return r.ok?await r.json():null;}
    catch{clearTimeout(t);return null;}
  };

  // ── RSI ───────────────────────────────────────────────
  const rsi14=a=>{
    try{if(!a||a.length<16)return null;let g=0,l=0;
      for(let i=1;i<=14;i++){const d=a[i]-a[i-1];d>0?g+=d:l-=d;}g/=14;l/=14;
      for(let i=15;i<a.length;i++){const d=a[i]-a[i-1];g=(g*13+Math.max(d,0))/14;l=(l*13+Math.max(-d,0))/14;}
      return l===0?100:+(100-100/(1+g/l)).toFixed(2);
    }catch{return null;}
  };
  const emaCalc=(a,p)=>{
    try{if(!a||a.length<2)return N(a?.[a.length-1]);const k=2/(p+1);let e=a.slice(0,Math.min(p,a.length)).reduce((s,v)=>s+v,0)/Math.min(p,a.length);
      for(let i=Math.min(p,a.length);i<a.length;i++)e=a[i]*k+e*(1-k);return e;}catch{return 0;}
  };
  const macdCalc=a=>{
    try{if(!a||a.length<36)return null;const k12=2/13,k26=2/27,k9=2/10;
      let e12=a.slice(0,12).reduce((s,v)=>s+v,0)/12,e26=a.slice(0,26).reduce((s,v)=>s+v,0)/26;
      const mv=[];for(let i=26;i<a.length;i++){e12=a[i]*k12+e12*(1-k12);e26=a[i]*k26+e26*(1-k26);mv.push(e12-e26);}
      let sig=mv.slice(0,9).reduce((s,v)=>s+v,0)/9;for(let i=9;i<mv.length;i++)sig=mv[i]*k9+sig*(1-k9);
      const n=mv.length,last=N(mv[n-1]),prev=N(mv[n-2]||last),h=last-sig,ph=prev-sig;
      const div=n>7&&last<N(mv[n-8])&&a[a.length-1]>a[a.length-8];
      return{bull:last>0&&h>0,bear:last<0&&h<0,xUp:h>0&&ph<=0,xDown:h<0&&ph>=0,div};
    }catch{return null;}
  };
  const bbCalc=(a,p=20)=>{
    try{if(!a||a.length<p)return null;const sl=a.slice(-p),m=sl.reduce((s,v)=>s+v,0)/p;
      const sd=Math.sqrt(sl.reduce((s,v)=>s+(v-m)**2,0)/p);
      if(sd===0)return null;const up=m+2*sd,dn=m-2*sd,last=a[a.length-1];
      return{upper:+up.toFixed(8),lower:+dn.toFixed(8),mid:+m.toFixed(8),width:+(4*sd/m*100).toFixed(2),position:+((last-dn)/(4*sd)*100).toFixed(1),squeeze:(4*sd/m)*100<3};
    }catch{return null;}
  };

  // ══════════════════════════════════════════════════════
  // DEEP ICT/SMC ANALYSIS FROM KLINES
  // ══════════════════════════════════════════════════════
  const fullICT=(K,price)=>{
    try{
      if(!K||K.length<10||!price)return null;
      const n=K.length,f6=v=>v>0?+v.toFixed(8):null;
      const pct=(a,b)=>b>0?+((a-b)/b*100).toFixed(2):0;
      // Swing points
      const SH=[],SL=[];
      for(let i=3;i<n-3;i++){
        if(!K[i]||!K[i-1]||!K[i+1]||!K[i-2]||!K[i+2])continue;
        if(K[i].h>K[i-1].h&&K[i].h>K[i-2].h&&K[i].h>K[i+1].h&&K[i].h>K[i+2].h)SH.push({p:K[i].h,i});
        if(K[i].l<K[i-1].l&&K[i].l<K[i-2].l&&K[i].l<K[i+1].l&&K[i].l<K[i+2].l)SL.push({p:K[i].l,i});
      }
      const rSH=SH.slice(-4),rSL=SL.slice(-4);
      const lSH=rSH[rSH.length-1]?.p||0,lSL=rSL[rSL.length-1]?.p||1e12;
      const pSH=rSH[rSH.length-2]?.p||0,pSL=rSL[rSL.length-2]?.p||1e12;
      // BOS / CHoCH
      let bos=null,choch=null;
      for(let i=n-10;i<n;i++){
        if(!K[i])continue;
        if(lSH>0&&N(K[i].c)>lSH&&N(K[i-1]?.c||0)<lSH&&!bos)bos={type:'Bullish BOS',level:f6(lSH),pctAway:pct(price,lSH)};
        if(lSL<1e12&&N(K[i].c)<lSL&&N(K[i-1]?.c||1e12)>lSL&&!bos)bos={type:'Bearish BOS',level:f6(lSL),pctAway:pct(price,lSL)};
      }
      if(!bos&&pSH>0&&price>pSH)choch={type:'Bullish CHoCH (MSS)',level:f6(pSH),desc:'Break of prior swing high'};
      if(!bos&&pSL<1e12&&price<pSL)choch={type:'Bearish CHoCH (MSS)',level:f6(pSL),desc:'Break of prior swing low'};
      // Order Blocks (multiple)
      const bullOBs=[],bearOBs=[];
      for(let i=Math.max(0,n-30);i<n-2;i++){
        const c=K[i],nx=K[i+1];if(!c||!nx||!c.o||!c.c||!nx.c)continue;
        if(c.c<c.o&&nx.c>nx.o&&nx.c>c.o*1.002){
          const H=Math.max(c.o,c.c),L=Math.min(c.o,c.c);
          const mitigated=K.slice(i+2).some(k=>k&&N(k.l)<L);
          bullOBs.push({H:f6(H),L:f6(L),mid:f6((H+L)/2),fresh:!mitigated,age:n-i-1,inZone:price<=H*1.01&&price>=L*0.995,dist:pct(price,(H+L)/2)});
        }
        if(c.c>c.o&&nx.c<nx.o&&nx.c<c.o*0.998){
          const H=Math.max(c.o,c.c),L=Math.min(c.o,c.c);
          const mitigated=K.slice(i+2).some(k=>k&&N(k.h)>H);
          bearOBs.push({H:f6(H),L:f6(L),mid:f6((H+L)/2),fresh:!mitigated,age:n-i-1,inZone:price<=H*1.005&&price>=L*0.99,dist:pct(price,(H+L)/2)});
        }
      }
      const sOB=arr=>arr.sort((a,b)=>Math.abs(N(a.dist))-Math.abs(N(b.dist))).slice(0,3);
      const topBull=sOB(bullOBs),topBear=sOB(bearOBs);
      // FVG (multiple)
      const bullFVG=[],bearFVG=[];
      for(let i=Math.max(0,n-25);i<n-2;i++){
        if(!K[i]||!K[i+2])continue;
        const gB=N(K[i+2].l)-N(K[i].h);
        const gBe=N(K[i].l)-N(K[i+2].h);
        if(gB>0){const filled=K.slice(i+3).some(k=>k&&N(k.l)<=N(K[i].h));bullFVG.push({H:f6(K[i+2].l),L:f6(K[i].h),mid:f6((N(K[i].h)+N(K[i+2].l))/2),pct:+(gB/N(K[i].h)*100).toFixed(2),filled,inGap:price>=N(K[i].h)&&price<=N(K[i+2].l),age:n-i-1,dist:pct(price,(N(K[i].h)+N(K[i+2].l))/2)});}
        if(gBe>0){const filled=K.slice(i+3).some(k=>k&&N(k.h)>=N(K[i].l));bearFVG.push({H:f6(K[i].l),L:f6(K[i+2].h),mid:f6((N(K[i].l)+N(K[i+2].h))/2),pct:+(gBe/N(K[i].l)*100).toFixed(2),filled,age:n-i-1});}
      }
      const topBFVG=bullFVG.filter(f=>!f.filled).sort((a,b)=>Math.abs(N(a.dist))-Math.abs(N(b.dist))).slice(0,3);
      const topBeFVG=bearFVG.filter(f=>!f.filled).slice(0,2);
      // Liquidity (BSL/SSL)
      const bslPools=[],sslPools=[];
      rSH.forEach(sh=>{if(sh.p>price){const taken=K.slice(sh.i+1).some(k=>k&&N(k.h)>sh.p);bslPools.push({level:f6(sh.p),taken,dist:pct(sh.p,price)});}});
      rSL.forEach(sl=>{if(sl.p<price){const taken=K.slice(sl.i+1).some(k=>k&&N(k.l)<sl.p);sslPools.push({level:f6(sl.p),taken,dist:pct(sl.p,price)});}});
      let eqH=null,eqL=null;
      if(rSH.length>=2){const d=Math.abs(rSH[rSH.length-1].p-rSH[rSH.length-2].p)/(rSH[rSH.length-1].p||1);if(d<0.007)eqH={level:f6(rSH[rSH.length-1].p),dist:pct(rSH[rSH.length-1].p,price),desc:'Equal Highs — BSL cluster, likely target'};}
      if(rSL.length>=2){const d=Math.abs(rSL[rSL.length-1].p-rSL[rSL.length-2].p)/(rSL[rSL.length-1].p||1);if(d<0.007)eqL={level:f6(rSL[rSL.length-1].p),dist:pct(rSL[rSL.length-1].p,price),desc:'Equal Lows — SSL cluster, likely target'};}
      let lastSweep=null;
      if(rSL.length>0&&n>=3){const s=rSL[rSL.length-1];if(N(K[n-2]?.l)<s.p&&N(K[n-1]?.c)>s.p)lastSweep={type:'Bullish SSL Sweep',level:f6(s.p),bullish:true,desc:'SSL swept — institutional long entry likely'};}
      if(!lastSweep&&rSH.length>0&&n>=3){const s=rSH[rSH.length-1];if(N(K[n-2]?.h)>s.p&&N(K[n-1]?.c)<s.p)lastSweep={type:'Bearish BSL Sweep',level:f6(s.p),bullish:false,desc:'BSL swept — institutional short entry likely'};}
      // OTE + Zone
      const allH=K.slice(-30).map(k=>N(k?.h));const allL=K.slice(-30).map(k=>N(k?.l,1e12)).filter(v=>v<1e12);
      const kH=Math.max(...allH)||price*1.1,kL=Math.min(...allL)||price*0.9;
      const kR=kH-kL,eq=(kH+kL)/2;
      const pip=kR>0?+((price-kL)/kR*100).toFixed(1):50;
      const zone=pip>70?'Premium Zone (>70%)':pip>55?'Slight Premium':pip<30?'Discount Zone (<30%)':pip<45?'Slight Discount':'Equilibrium (50%)';
      const oteLong=kR>0?f6(kH-(kH-kL)*0.786):null;
      const oteHigh=kR>0?f6(kH-(kH-kL)*0.618):null;
      const inOTELong=!!(oteLong&&oteHigh&&price>=N(oteLong)&&price<=N(oteHigh));
      // Wyckoff
      let wyckoff={phase:'Consolidation',desc:'Insufficient range for Wyckoff analysis.',bias:'neutral'};
      try{
        const vol10=K.slice(-10).reduce((s,k)=>s+N(k.v),0)/10;
        const vol3=K.slice(-3).reduce((s,k)=>s+N(k.v),0)/3;
        const vI=vol3>vol10*1.3;
        const pU=N(K[n-1]?.c)>N(K[n-6]?.c),pD=N(K[n-1]?.c)<N(K[n-6]?.c);
        if(pip<25&&vI&&pU)wyckoff={phase:'Phase C — Spring',desc:'SSL sweep + volume uptick. Possible accumulation spring before markup.',bias:'bullish'};
        else if(pip<25&&!vI)wyckoff={phase:'Phase A/B — Accumulation',desc:'Price ranging near lows. Institutional buyers absorbing supply.',bias:'bullish'};
        else if(pip<30&&pU)wyckoff={phase:'Phase C — Test/Spring',desc:'Discount zone with upward momentum. Accumulation test in progress.',bias:'bullish'};
        else if(pip>75&&vI&&pD)wyckoff={phase:'Phase C — UTAD',desc:'BSL sweep + distribution. UTAD pattern — potential top formation.',bias:'bearish'};
        else if(pip>75&&!vI)wyckoff={phase:'Phase B — Distribution',desc:'Price ranging near highs. Institutional sellers offloading positions.',bias:'bearish'};
        else if(pU&&pip>45)wyckoff={phase:'Markup Phase',desc:'Uptrend in progress. Pullbacks to OBs/FVGs are long opportunities.',bias:'bullish'};
        else if(pD&&pip<55)wyckoff={phase:'Markdown Phase',desc:'Downtrend active. Rallies to bear OBs are short opportunities.',bias:'bearish'};
        else wyckoff={phase:'Re-Accumulation',desc:'Sideways within trend. Energy building before next impulse.',bias:'neutral'};
      }catch{}
      // High Probability Zones
      const longLevels=[],shortLevels=[];
      topBull.filter(o=>o.fresh).slice(0,2).forEach(o=>{longLevels.push({v:(N(o.L)+N(o.H))/2,src:'Bull OB',w:3});});
      topBFVG.slice(0,2).forEach(f=>{longLevels.push({v:N(f.mid),src:'Bull FVG',w:2});});
      sslPools.filter(s=>!s.taken).slice(0,2).forEach(s=>{longLevels.push({v:N(s.level),src:'SSL Pool',w:2});});
      if(eqL)longLevels.push({v:N(eqL.level),src:'Equal Lows',w:3});
      if(oteLong)longLevels.push({v:N(oteLong),src:'OTE 78.6%',w:2});
      topBear.filter(o=>o.fresh).slice(0,2).forEach(o=>{shortLevels.push({v:(N(o.L)+N(o.H))/2,src:'Bear OB',w:3});});
      topBeFVG.slice(0,1).forEach(f=>{shortLevels.push({v:N(f.mid),src:'Bear FVG',w:2});});
      bslPools.filter(s=>!s.taken).slice(0,2).forEach(s=>{shortLevels.push({v:N(s.level),src:'BSL Pool',w:2});});
      if(eqH)shortLevels.push({v:N(eqH.level),src:'Equal Highs',w:3});
      const mkZone=arr=>{
        if(!arr.length)return null;
        const vals=arr.map(x=>x.v).filter(v=>v>0).sort((a,b)=>a-b);
        if(!vals.length)return null;
        const lo=vals[0],hi=vals[vals.length-1],str=Math.min(98,50+arr.reduce((s,x)=>s+x.w,0)*3);
        return{low:f6(lo),high:f6(hi),midpoint:f6((lo+hi)/2),sources:arr.slice(0,4).map(x=>x.src).join(' + '),strength:str};
      };
      const bS=(topBull.filter(o=>o.inZone).length*3)+(topBFVG.filter(f=>f.inGap).length*2)+(bos?.type?.includes('Bull')?4:0)+(choch?.type?.includes('Bull')?3:0)+(lastSweep?.bullish===true?3:0)+(wyckoff.bias==='bullish'?2:0)+(pip<35?2:0);
      const beS=(topBear.filter(o=>o.inZone).length*3)+(bos?.type?.includes('Bear')?4:0)+(choch?.type?.includes('Bear')?3:0)+(lastSweep?.bullish===false?3:0)+(wyckoff.bias==='bearish'?2:0)+(pip>65?2:0);
      return{structure:{bos,choch,hasBOS:!!bos,hasCHoCH:!!choch},orderBlocks:{bullish:topBull,bearish:topBear,inBullOB:topBull.some(o=>o.inZone),inBearOB:topBear.some(o=>o.inZone)},fvg:{bullish:topBFVG,bearish:topBeFVG},liquidity:{bsl:bslPools.slice(0,3),ssl:sslPools.slice(0,3),eqH,eqL,lastSweep},zones:{pip,zone,inOTELong,oteLong,oteHigh,equil:+eq.toFixed(8)},wyckoff,highProbZones:{long:mkZone(longLevels),short:mkZone(shortLevels)},signal:bS>beS?'Bullish':beS>bS?'Bearish':'Neutral',bull:bS,bear:beS};
    }catch(e){return null;}
  };

  // ── CHART PATTERNS ────────────────────────────────────
  const getPatterns=(K,price,h,l,ch24)=>{
    try{
      const pats=[];
      const op=price>0&&ch24>-99?price/(1+ch24/100):price;
      const rng=h-l;
      if(rng>0){
        const bd=Math.abs(price-op)/rng,lw=(Math.min(price,op)-l)/rng,uw=(h-Math.max(price,op))/rng,pp=(price-l)/rng;
        if(lw>0.55&&bd<0.30&&uw<0.20&&pp<0.45)pats.push({name:'🔨 Hammer',signal:'bullish',winRate:76,desc:'Long lower wick. Buyers strongly rejected lower prices.'});
        if(uw>0.55&&bd<0.30&&lw<0.20&&pp>0.55)pats.push({name:'⭐ Shooting Star',signal:'bearish',winRate:75,desc:'Long upper wick. Sellers strongly rejected higher prices.'});
        if(bd>0.75&&ch24>3&&price>op)pats.push({name:'🐂 Bull Marubozu',signal:'bullish',winRate:77,desc:'Full-body candle. Strong institutional buying momentum.'});
        if(bd>0.75&&ch24<-3&&price<op)pats.push({name:'🐻 Bear Marubozu',signal:'bearish',winRate:77,desc:'Full-body candle. Strong institutional selling momentum.'});
      }
      if(A(K).length>=3){
        const kn=K.length,C=K[kn-1],P=K[kn-2],P2=K[kn-3];
        if(C&&P&&P2&&C.c&&P.c&&P2.c){
          const Cb=Math.abs(C.c-C.o),Pb=Math.abs(P.c-P.o),P2b=Math.abs(P2.c-P2.o);
          const P2r=Math.max(P2.h-P2.l,0.0001);
          if(P.c<P.o&&C.c>C.o&&C.o<=P.c&&C.c>=P.o&&Cb>Pb*0.9)pats.push({name:'🐂 Bullish Engulfing',signal:'bullish',winRate:78,desc:'Buyers absorbed prior selling. Strong demand entry.'});
          if(P.c>P.o&&C.c<C.o&&C.o>=P.c&&C.c<=P.o&&Cb>Pb*0.9)pats.push({name:'🐻 Bearish Engulfing',signal:'bearish',winRate:78,desc:'Sellers absorbed prior buying. Strong supply entry.'});
          if(P2.c<P2.o&&P2r>0&&Pb/(P2b+0.001)<0.40&&C.c>C.o&&C.c>(P2.o+P2.c)/2)pats.push({name:'🌟 Morning Star',signal:'bullish',winRate:78,desc:'3-candle reversal. Selling exhaustion + buyer confirmation.'});
          if(P2.c>P2.o&&P2r>0&&Pb/(P2b+0.001)<0.40&&C.c<C.o&&C.c<(P2.o+P2.c)/2)pats.push({name:'🌆 Evening Star',signal:'bearish',winRate:78,desc:'3-candle reversal. Buying exhaustion + seller confirmation.'});
          if(P2.c>P2.o&&P.c>P.o&&C.c>C.o&&P.c>P2.c&&C.c>P.c&&P2b/P2r>0.5)pats.push({name:'⚔️ 3 White Soldiers',signal:'bullish',winRate:83,desc:'3 consecutive bullish candles. Institutional accumulation.'});
          if(P2.c<P2.o&&P.c<P.o&&C.c<C.o&&P.c<P2.c&&C.c<P.c&&P2b/P2r>0.5)pats.push({name:'🐦 3 Black Crows',signal:'bearish',winRate:83,desc:'3 consecutive bearish candles. Institutional distribution.'});
          if(P.c<P.o&&C.c>C.o&&C.o<P.l&&C.c>(P.o+P.c)/2)pats.push({name:'🌙 Piercing Pattern',signal:'bullish',winRate:75,desc:'Bullish penetrates >50% of prior bearish body.'});
          if(P.c>P.o&&C.c<C.o&&C.o>P.h&&C.c<(P.o+P.c)/2)pats.push({name:'☁️ Dark Cloud Cover',signal:'bearish',winRate:75,desc:'Bearish penetrates >50% of prior bullish body.'});
          if(C.h<=P.h&&C.l>=P.l)pats.push({name:'📦 Inside Bar / NR4',signal:C.c>=C.o?'bullish':'bearish',winRate:76,desc:'Compression inside prior candle. Directional breakout imminent.'});
          if(kn>=8){const ref=N(K[kn-7]?.c);if(ref>0){const mv=(N(K[kn-3]?.c)-ref)/ref*100;const fl=Math.max(...K.slice(-4).map(k=>N(k?.h)))-Math.min(...K.slice(-4).map(k=>N(k?.l||1e9)));if(N(C.c)>0&&fl/N(C.c)*100<5){if(mv>5)pats.push({name:'🏴 Bull Flag',signal:'bullish',winRate:85,desc:'+'+mv.toFixed(1)+'% impulse + tight coil. Target +'+( mv*0.8).toFixed(1)+'%.'});if(mv<-5)pats.push({name:'🏴 Bear Flag',signal:'bearish',winRate:85,desc:mv.toFixed(1)+'% drop + bounce. Continuation lower.'});}}}
        }
      }
      return pats.filter(p=>p.winRate>=75).sort((a,b)=>b.winRate-a.winRate).slice(0,3);
    }catch{return[];}
  };

  // ── ELLIOTT WAVE ──────────────────────────────────────
  const getEW=(rsi,ch24,ch7,macd,ema200,price)=>{
    try{
      const trend=price>ema200?'UP':'DOWN';
      const uD=ch24>1.5,dD=ch24<-1.5,oS=rsi<32,oB=rsi>70,uW=ch7>3,dW=ch7<-3;
      if(trend==='UP'){
        if(oS&&uW)return{w:'📉 Wave 2 Pullback',c:78,d:'Correction in uptrend. RSI '+rsi.toFixed(0)+' oversold — BEST ENTRY. Stop below recent low.'};
        if(rsi>=42&&rsi<=65&&uD&&(macd?.xUp||macd?.bull))return{w:'🚀 Wave 3 — Impulse',c:82,d:'Strongest phase. Volume confirms entry. Target 1.618x Wave 1.'};
        if(rsi>=55&&uD&&macd?.bull&&!macd?.div)return{w:'⚡ Wave 3 Extension',c:72,d:'Continuation impulse. Trail stop from recent swing low.'};
        if(dD&&rsi>=38&&rsi<=55)return{w:'⚖️ Wave 4 Correction',c:65,d:"Consolidation before final Wave 5. Don't FOMO above."};
        if(oB&&macd?.div)return{w:'⚠️ Wave 5 Ending',c:70,d:'RSI divergence + extended run. LIKELY PEAK. Reduce size.'};
        if(oB&&!macd?.div)return{w:'⚡ Wave 5 Progress',c:62,d:'Overbought, no divergence yet. Trail stop tightly.'};
        return{w:'↗️ Impulse Building',c:55,d:'Uptrend intact. Await pullback to OB/OTE for entry.'};
      }else{
        if(oS&&(macd?.xUp||uD))return{w:'🔄 Wave C Complete',c:74,d:'RSI '+rsi.toFixed(0)+' oversold + positive momentum. Potential major bottom.'};
        if(oS)return{w:'💎 Wave C Capitulation',c:74,d:'Extreme oversold. Near-term bottom forming. Confirm with reversal candle.'};
        if(uD&&ch24>4)return{w:'🔄 Wave C → MSS',c:67,d:'Daily up in downtrend. Market Structure Shift developing.'};
        if(dW&&dD&&rsi<45)return{w:'📉 Wave A/C Bearish',c:70,d:'Downtrend active. Rallies to bear OBs are shorting setups.'};
        if(Math.abs(ch24)<2)return{w:'⚖️ Coiling / Consolidation',c:55,d:'Tight range. Watch for volume breakout for direction.'};
        return{w:'⚖️ Corrective Phase',c:50,d:'Wait for clear directional setup with volume confirmation.'};
      }
    }catch{return{w:'⚖️ Corrective Phase',c:50,d:'Analysis in progress.'};} 
  };

  // ── ASTRO ─────────────────────────────────────────────
  const getAstro=()=>{
    try{
      const jd=Date.now()/86400000+2440587.5,dm=((jd-2460320.5)%29.53058867+29.53058867)%29.53058867;
      const ph=[[1.5,'New Moon','🌑'],[8.5,'First Quarter','🌓'],[16,'Full Moon','🌕'],[22,'Waning','🌖'],[29.5,'Waning Crescent','🌘']];
      let mp='Dark Moon',me='🌑';for(const[lim,p,e]of ph)if(dm<lim){mp=p;me=e;break;}
      const ds=Math.floor((Date.now()-1713571200000)/86400000);
      return{moonPhase:mp,moonEmoji:me,halvingPhase:ds<365?'Bull Early 🔥':ds<480?'Bull Peak ⚡':ds<730?'Distribution ⚠️':'Accumulation 🌱',chaotic:mp==='Full Moon'||mp==='New Moon'};
    }catch{return{moonPhase:'—',moonEmoji:'🌙',halvingPhase:'Bull Cycle',chaotic:false};}
  };

  // ── LITE ANALYSIS from CoinGecko data only ────────────
  const analyzeFromCG=(sym,cg,astro)=>{
    try{
      const price=N(cg.current_price),ch24=N(cg.price_change_percentage_24h),ch7=N(cg.price_change_percentage_7d);
      const vol=N(cg.total_volume),h=N(cg.high_24h)||price*1.02,l=N(cg.low_24h)||price*0.98;
      const pPos=h>l?(price-l)/(h-l):0.5;
      const estRSI=Math.max(10,Math.min(90,50+ch24*2.5+(pPos-0.5)*25+(ch7>0?4:-4)));
      const ew=getEW(estRSI,ch24,ch7,null,price*(ch7>0?0.88:1.12),price);
      const pats=getPatterns(null,price,h,l,ch24);
      const pip=pPos*100;
      const zone=pip>70?'Premium Zone (>70%)':pip<30?'Discount Zone (<30%)':'Equilibrium';
      const hasBOS=Math.abs(ch24)>5,bosType=ch24>5?'Bullish BOS':ch24<-5?'Bearish BOS':'None';
      const hasCHoCH=ch24>3&&ch7<0;
      const inBullOB=pip<28,inBearOB=pip>72;
      const bS=(hasBOS&&ch24>5?3:0)+(inBullOB?2:0)+(hasCHoCH?2:0);
      const beS=(hasBOS&&ch24<-5?3:0)+(inBearOB?2:0);
      const smcEst={signal:bS>beS?'Bullish':beS>bS?'Bearish':'Neutral',hasBOS,bosType,hasCHoCH,chochType:hasCHoCH?'Bullish CHoCH (MSS)':'None',inBullOB,inBearOB,zone,pip:+pip.toFixed(1),bOB:inBullOB?{L:+l.toFixed(8),H:+(l+(h-l)*0.28).toFixed(8),mid:+(l+(h-l)*0.14).toFixed(8),fresh:true,age:1,inZone:true,dist:0}:null,beOB:inBearOB?{L:+(l+(h-l)*0.72).toFixed(8),H:+h.toFixed(8),mid:+(l+(h-l)*0.86).toFixed(8),fresh:true,age:1,inZone:true,dist:0}:null};
      let prob=50;
      if(ch24>0)prob+=4;if(ch7>0)prob+=5;if(estRSI<30)prob+=10;if(estRSI>70)prob-=10;
      if(pats.some(p=>p.signal==='bullish'&&p.winRate>=80))prob+=5;
      if(pats.some(p=>p.signal==='bearish'&&p.winRate>=80))prob-=5;
      prob=Math.max(5,Math.min(95,Math.round(prob)));
      const biasLabel=prob>=72?'STRONG BULLISH':prob>=60?'BULLISH':prob>=52?'MILD BULLISH':prob<=28?'STRONG BEARISH':prob<=40?'BEARISH':prob<=48?'MILD BEARISH':'NEUTRAL';
      const ictLite={structure:{bos:hasBOS?{type:bosType,level:+( ch24>5?h*0.98:l*1.02).toFixed(8)}:null,choch:hasCHoCH?{type:'Bullish CHoCH (MSS)',level:+(l+(h-l)*0.65).toFixed(8),desc:'Estimated from 24h/7d price action'}:null,hasBOS,hasCHoCH},orderBlocks:{bullish:inBullOB?[smcEst.bOB]:[],bearish:inBearOB?[smcEst.beOB]:[],inBullOB,inBearOB},fvg:{bullish:[],bearish:[]},liquidity:{bsl:[{level:+h.toFixed(8),dist:+pct(h,price).toFixed(2)}],ssl:[{level:+l.toFixed(8),dist:+pct(l,price).toFixed(2)}],eqH:null,eqL:null,lastSweep:null},zones:{pip:+pip.toFixed(1),zone,inOTELong:pip>=21.4&&pip<=38.2,oteLong:+(l+(h-l)*0.214).toFixed(8),oteHigh:+(l+(h-l)*0.382).toFixed(8)},wyckoff:{phase:pip<30?'Possible Accumulation':pip>70?'Possible Distribution':'Neutral Phase',desc:'Limited data (CoinGecko only). For full Wyckoff analysis, coin needs CryptoCompare klines.',bias:ch7>5?'bullish':ch7<-5?'bearish':'neutral'},highProbZones:{long:inBullOB?{low:+l.toFixed(8),high:+(l+(h-l)*0.28).toFixed(8),midpoint:+(l+(h-l)*0.14).toFixed(8),sources:'Discount Zone + SSL',strength:55}:null,short:inBearOB?{low:+(l+(h-l)*0.72).toFixed(8),high:+h.toFixed(8),midpoint:+(l+(h-l)*0.86).toFixed(8),sources:'Premium Zone + BSL',strength:55}:null},signal:smcEst.signal};
      const pct2=(a,b)=>b>0?+((a-b)/b*100).toFixed(2):0;
      return{ok:true,ts:Date.now(),elapsed:Date.now()-t0,version:'v19',symbol:sym+'USDT',ticker:sym,name:cg.name||sym,price,change24h:+ch24.toFixed(2),change7d:+ch7.toFixed(2),high24h:+h.toFixed(8),low24h:+l.toFixed(8),volume24h:vol,mcap:N(cg.market_cap),dataSource:'CoinGecko (Lite — no klines)',rsi:{'1H':+estRSI.toFixed(1),'4H':+estRSI.toFixed(1),'1D':+estRSI.toFixed(1)},macd:{'4H':null},bb:{'4H':null},ema:{},ict:ictLite,smc:{signal:smcEst.signal,zone,pip:+pip.toFixed(1),hasBOS,bosType,hasCHoCH},elliottWave:{'4H':ew},chartPatterns:pats,pivotPoints:{'4H':{}},probability:prob,confluence:{probability:prob,signal:biasLabel},summary:{bias:prob>55?'BULLISH':prob<45?'BEARISH':'NEUTRAL',biasLabel,probability:prob,oneLiner:biasLabel+' | '+ew.w+' | RSI ~'+estRSI.toFixed(0)+' | '+smcEst.signal},astrology:astro};
    }catch(e){return{ok:false,error:e.message,price:0,symbol:sym+'USDT',ts:Date.now(),version:'v19'};}
  };

  // ══════════════════════════════════════════════════════
  // MAIN — PARALLEL EXECUTION
  // Step 1: CC 4H + CC 1H + Bybit + CG Search  (all at once, max 5s)
  // Step 2: If CC OK → full analysis
  //         If CC fails → CG markets from search ID (3.5s more)
  // Worst case: 5s + 3.5s = 8.5s ✅ (safely under 10s limit)
  // ══════════════════════════════════════════════════════
  try{
    const sym=raw;
    const astro=getAstro();

    // Batch 1: CC klines + Bybit + CG Search ALL PARALLEL
    const[cc4R,cc1R,byR,cgSR]=await Promise.allSettled([
      sf('https://min-api.cryptocompare.com/data/v2/histohour?fsym='+sym+'&tsym=USD&limit=60&aggregate=4&e=CCCAGG',5000),
      sf('https://min-api.cryptocompare.com/data/v2/histohour?fsym='+sym+'&tsym=USD&limit=48&aggregate=1&e=CCCAGG',4500),
      sf('https://api.bybit.com/v5/market/tickers?category=linear&symbol='+sym+'USDT',3000),
      sf('https://api.coingecko.com/api/v3/search?query='+encodeURIComponent(sym),3500),
    ]);

    const parseCC=r=>{
      try{if(r.status!=='fulfilled'||r.value?.Response!=='Success')return[];return A(r.value?.Data?.Data).filter(d=>N(d.close)>0&&N(d.close)<1e10&&N(d.high)>=N(d.low)).map(d=>({t:N(d.time),o:N(d.open),h:N(d.high),l:N(d.low),c:N(d.close),v:N(d.volumeto)}));}catch{return[];}
    };

    const K4h=parseCC(cc4R);
    const K1h=parseCC(cc1R);
    const byTick=byR.status==='fulfilled'?byR.value?.result?.list?.[0]:null;
    const cgSearch=cgSR.status==='fulfilled'?cgSR.value:null;

    if(K4h.length>=16){
      // ── FULL ANALYSIS from CryptoCompare ───────────────
      const cls4=K4h.map(k=>k.c),cls1=K1h.map(k=>k.c);
      const price=byTick?.lastPrice?N(byTick.lastPrice):cls4[cls4.length-1];
      const rsi4h=rsi14(cls4)||50;
      const rsi1h=rsi14(cls1)||rsi4h;
      const rsi1d=rsi14(cls4.filter((_,i)=>i%6===0))||rsi4h;
      const ema9=emaCalc(cls4,9),ema21=emaCalc(cls4,21),ema50=emaCalc(cls4,Math.min(50,cls4.length-1)),ema200=emaCalc(cls4,Math.min(200,cls4.length-1));
      const macd4h=macdCalc(cls4),macd1h=macdCalc(cls1);
      const bb4h=bbCalc(cls4,20);
      const p6=cls4[cls4.length-7]||price,p42=cls4[cls4.length-43]||price;
      const ch24=p6>0?+(( price-p6)/p6*100).toFixed(2):0;
      const ch7d=p42>0?+((price-p42)/p42*100).toFixed(2):0;
      const h24=Math.max(...K4h.slice(-6).map(k=>k.h||0))||price*1.02;
      const l24=Math.min(...K4h.slice(-6).map(k=>k.l||1e12).filter(v=>v<1e12))||price*0.98;
      const ict=fullICT(K4h,price);
      const pats=getPatterns(K4h,price,h24,l24,ch24);
      const ew=getEW(rsi4h,ch24,ch7d,macd4h,ema200,price);
      const pv=K4h[K4h.length-2]||K4h[K4h.length-1];
      const P=(pv.h+pv.l+pv.c)/3;
      const pivot={P:+P.toFixed(8),R1:+(2*P-pv.l).toFixed(8),R2:+(P+pv.h-pv.l).toFixed(8),R3:+(2*P+(pv.h-pv.l)).toFixed(8),S1:+(2*P-pv.h).toFixed(8),S2:+(P-(pv.h-pv.l)).toFixed(8)};
      let prob=50;
      if(price>ema9)prob+=3;if(price>ema21)prob+=3;if(price>ema50)prob+=5;if(price>ema200)prob+=6;
      if(price<ema9)prob-=3;if(price<ema21)prob-=3;if(price<ema50)prob-=5;if(price<ema200)prob-=6;
      if(macd4h?.xUp)prob+=8;if(macd4h?.xDown)prob-=8;if(macd4h?.bull)prob+=3;if(macd4h?.bear)prob-=3;
      if(rsi4h<30)prob+=10;if(rsi4h>70)prob-=10;if(rsi4h>=45&&rsi4h<=60)prob+=3;
      if(ict){prob+=N(ict.bull)*1.5-N(ict.bear)*1.5;}
      if(pats.some(p=>p.signal==='bullish'&&p.winRate>=80))prob+=4;if(pats.some(p=>p.signal==='bearish'&&p.winRate>=80))prob-=4;
      prob=Math.max(2,Math.min(98,Math.round(prob)));
      const biasLabel=prob>=72?'STRONG BULLISH':prob>=60?'BULLISH':prob>=52?'MILD BULLISH':prob<=28?'STRONG BEARISH':prob<=40?'BEARISH':prob<=48?'MILD BEARISH':'NEUTRAL';
      const smcDisp=ict?.signal||'Neutral';
      return res.status(200).json({ok:true,ts:Date.now(),elapsed:Date.now()-t0,version:'v19',symbol:sym+'USDT',ticker:sym,price:+price.toFixed(8),change24h:+ch24.toFixed(2),change7d:+ch7d.toFixed(2),high24h:+h24.toFixed(8),low24h:+l24.toFixed(8),volume24h:K4h.slice(-6).reduce((s,k)=>s+N(k.v),0),dataSource:'CryptoCompare (Full Analysis)',rsi:{'1H':+rsi1h.toFixed(2),'4H':+rsi4h.toFixed(2),'1D':+rsi1d.toFixed(2)},ema:{9:+ema9.toFixed(8),21:+ema21.toFixed(8),50:+ema50.toFixed(8),200:+ema200.toFixed(8)},macd:{'4H':macd4h,'1H':macd1h},bb:{'4H':bb4h},ict,smc:{signal:smcDisp,hasBOS:ict?.structure?.hasBOS,bosType:ict?.structure?.bos?.type,hasCHoCH:ict?.structure?.hasCHoCH,inBullOB:ict?.orderBlocks?.inBullOB,inBearOB:ict?.orderBlocks?.inBearOB,zone:ict?.zones?.zone,pip:ict?.zones?.pip},elliottWave:{'4H':ew},chartPatterns:pats,pivotPoints:{'4H':pivot},timeframes:{'1H':{rsi:+rsi1h.toFixed(2),trend:rsi1h>55?'BULLISH':rsi1h<45?'BEARISH':'NEUTRAL'},'4H':{rsi:+rsi4h.toFixed(2),trend:price>ema50?'BULLISH':price<ema50?'BEARISH':'NEUTRAL',ema50:+ema50.toFixed(8),ema200:+ema200.toFixed(8)},'1D':{rsi:+rsi1d.toFixed(2),trend:price>ema200?'BULLISH':price<ema200?'BEARISH':'NEUTRAL'}},probability:prob,confluence:{probability:prob,signal:biasLabel},summary:{bias:prob>55?'BULLISH':prob<45?'BEARISH':'NEUTRAL',biasLabel,probability:prob,oneLiner:biasLabel+' | '+ew.w+' | RSI '+rsi4h.toFixed(0)+' | '+(smcDisp||'Neutral')},astrology:astro,candleCount:{'4H':K4h.length,'1H':K1h.length}});
    }

    // ── CoinGecko FALLBACK (already have search result) ──
    const cgCoins=A(cgSearch?.coins);
    const cgMatch=cgCoins.find(c=>(c.symbol||'').toUpperCase()===sym)||cgCoins.find(c=>(c.symbol||'').toLowerCase()===sym.toLowerCase())||cgCoins[0];
    if(!cgMatch)return res.status(200).json({ok:false,error:'Symbol '+sym+' tidak ditemukan di CryptoCompare dan CoinGecko.',price:0,symbol:sym+'USDT',ts:Date.now(),version:'v19'});

    // Fetch CG markets (3.5s timeout — safe)
    const cgMktR=await sf('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids='+encodeURIComponent(cgMatch.id)+'&sparkline=false&price_change_percentage=24h,7d',3500);
    const cgData=A(cgMktR)[0];
    if(!cgData||!N(cgData.current_price))return res.status(200).json({ok:false,error:'Market data tidak tersedia untuk '+sym+' ('+cgMatch.name+'). Coba koin lain.',price:0,symbol:sym+'USDT',ts:Date.now(),version:'v19'});

    return res.status(200).json(analyzeFromCG(sym,cgData,astro));

  }catch(e){
    return res.status(200).json({ok:false,error:e.message,price:0,symbol:raw+'USDT',ts:Date.now(),version:'v19'});
  }
}
