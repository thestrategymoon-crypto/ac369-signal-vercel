// api/search.js — 369 GLOBAL CRYPTO v20.0
// FULL ANALYSIS: Real Bybit Klines + SMC + Elliott Wave + Chart Patterns + Multi-TF RSI
// Sources: Bybit Linear + Spot klines (1H/4H/1D) — semua real data
'use strict';

const N=(v,d=0)=>{const n=+v;return(isNaN(n)||!isFinite(n))?d:n;};
const A=v=>Array.isArray(v)?v:[];
const cl=(v,a,b)=>Math.max(a,Math.min(b,N(v)));
const fmt=p=>{if(!p||p<=0)return'—';return p>10000?'$'+p.toFixed(0):p>1?'$'+p.toFixed(4):p>0.001?'$'+p.toFixed(6):'$'+p.toFixed(8);};
const pct=(a,b)=>b>0?+((a-b)/b*100).toFixed(2):0;

const sf=async(url,ms=6000)=>{
  const c=new AbortController();const t=setTimeout(()=>c.abort(),ms);
  try{const r=await fetch(url,{signal:c.signal,headers:{'Accept':'application/json','User-Agent':'369Global/20.0'}});clearTimeout(t);if(!r.ok)return null;return await r.json();}
  catch{clearTimeout(t);return null;}
};

// Parse Bybit v5 klines: newest-first → oldest-first
function parseK(raw){
  if(!raw||!raw.length) return [];
  return raw.slice().reverse()
    .map(d=>({t:N(d[0]),o:N(d[1]),h:N(d[2]),l:N(d[3]),c:N(d[4]),v:N(d[5]),q:N(d[6]||d[5])}))
    .filter(d=>d.c>0&&d.h>=d.l&&d.h>0&&d.c<1e13);
}

// ─── TA FUNCTIONS ─────────────────────────────────────────────────
function rsi14(cls){
  if(!cls||cls.length<16) return null;
  let g=0,l=0;
  for(let i=1;i<=14;i++){const d=cls[i]-cls[i-1];d>0?g+=d:l-=d;}
  let ag=g/14,al=l/14;
  for(let i=15;i<cls.length;i++){const d=cls[i]-cls[i-1];ag=(ag*13+Math.max(d,0))/14;al=(al*13+Math.max(-d,0))/14;}
  if(al===0) return 100;
  return +cl(100-100/(1+ag/al),0,100).toFixed(1);
}
function ema(arr,p){
  if(!arr||arr.length<2) return N(arr?.[arr.length-1]);
  const k=2/(p+1);let e=arr.slice(0,Math.min(p,arr.length)).reduce((s,v)=>s+v,0)/Math.min(p,arr.length);
  for(let i=Math.min(p,arr.length);i<arr.length;i++) e=arr[i]*k+e*(1-k);
  return e;
}
function atr14(K){
  if(!K||K.length<15) return 0;
  const trs=K.slice(1).map((k,i)=>Math.max(k.h-k.l,Math.abs(k.h-K[i].c),Math.abs(k.l-K[i].c)));
  return trs.slice(-14).reduce((s,v)=>s+v,0)/14;
}
function macdCalc(cls){
  if(!cls||cls.length<28) return null;
  const k12=2/13,k26=2/27,k9=2/10;let e12=cls[0],e26=cls[0];const mv=[];
  for(const v of cls){e12=v*k12+e12*(1-k12);e26=v*k26+e26*(1-k26);mv.push(e12-e26);}
  let sig=mv.slice(0,9).reduce((s,v)=>s+v,0)/9;
  for(let i=9;i<mv.length;i++) sig=mv[i]*k9+sig*(1-k9);
  const n=mv.length,last=mv[n-1],prev=mv[n-2]||last,h=last-sig,ph=prev-sig;
  return{bull:last>0&&h>0,bear:last<0&&h<0,xUp:h>0&&ph<=0,xDown:h<0&&ph>=0,val:+last.toFixed(8),hist:+h.toFixed(8)};
}

// ─── SMC FUNCTIONS ────────────────────────────────────────────────
// Find swing highs and lows (ICT method)
function swings(K,lb=3){
  const hi=[],lo=[];
  for(let i=lb;i<K.length-lb;i++){
    const w=[...K.slice(i-lb,i),...K.slice(i+1,i+lb+1)];
    if(w.every(c=>c.h<=K[i].h)) hi.push({i,v:K[i].h,t:K[i].t});
    if(w.every(c=>c.l>=K[i].l)) lo.push({i,v:K[i].l,t:K[i].t});
  }
  return{hi:hi.slice(-10),lo:lo.slice(-10)};
}

// Market Structure: HH+HL=Bull, LH+LL=Bear, BOS, CHoCH
function mktStructure(K,sw){
  const{hi,lo}=sw;
  const p=K[K.length-1].c;
  if(!hi.length||!lo.length) return{trend:'UNKNOWN',bias:'NEUTRAL',bos:null,choch:null,lastHi:p,lastLo:p};
  const lH=hi[hi.length-1],pH=hi.length>=2?hi[hi.length-2]:null;
  const lL=lo[lo.length-1],pL=lo.length>=2?lo[lo.length-2]:null;
  let trend='SIDEWAYS',bias='NEUTRAL';
  if(pH&&lH.v>pH.v&&pL&&lL.v>pL.v){trend='BULLISH';bias='LONG';}
  else if(pH&&lH.v<pH.v&&pL&&lL.v<pL.v){trend='BEARISH';bias='SHORT';}
  const bos=trend==='BULLISH'&&p>lH.v?{type:'BOS ✅',dir:'bull',lvl:lH.v}:trend==='BEARISH'&&p<lL.v?{type:'BOS ✅',dir:'bear',lvl:lL.v}:null;
  const choch=trend==='BULLISH'&&p<lL.v?{type:'CHoCH ⚠️',dir:'bear',lvl:lL.v}:trend==='BEARISH'&&p>lH.v?{type:'CHoCH ⚠️',dir:'bull',lvl:lH.v}:null;
  return{trend,bias,bos,choch,lastHi:lH.v,lastLo:lL.v};
}

// Order Blocks: last opposing candle before displacement
function detectOBs(K){
  const p=K[K.length-1].c;
  const bulls=[],bears=[];
  const lb=Math.min(K.length-5,50);
  for(let i=K.length-lb;i<K.length-4;i++){
    const c=K[i];
    if(c.c<c.o){ // Bearish candle → potential Bullish OB
      const after=K.slice(i+1,i+6);
      const moveUp=(Math.max(...after.map(x=>x.h))-c.l)/c.l*100;
      if(moveUp>2){
        const mitigated=K.slice(i+1).some(x=>x.l<c.o);
        if(!mitigated) bulls.push({top:+c.o.toFixed(8),bot:+c.l.toFixed(8),mid:+((c.o+c.l)/2).toFixed(8),strength:+(moveUp.toFixed(1)),dist:+pct((c.o+c.l)/2,p).toFixed(2),fresh:true,idx:i});
      }
    }
    if(c.c>c.o){ // Bullish candle → potential Bearish OB
      const after=K.slice(i+1,i+6);
      const moveDn=(c.h-Math.min(...after.map(x=>x.l)))/c.h*100;
      if(moveDn>2){
        const mitigated=K.slice(i+1).some(x=>x.h>c.c);
        if(!mitigated) bears.push({top:+c.h.toFixed(8),bot:+c.c.toFixed(8),mid:+((c.h+c.c)/2).toFixed(8),strength:+(moveDn.toFixed(1)),dist:+pct((c.h+c.c)/2,p).toFixed(2),fresh:true,idx:i});
      }
    }
  }
  return{
    bullOBs:bulls.sort((a,b)=>b.idx-a.idx).slice(0,3),
    bearOBs:bears.sort((a,b)=>b.idx-a.idx).slice(0,3),
  };
}

// Fair Value Gaps: 3-candle pattern (ICT method)
function detectFVGs(K){
  const p=K[K.length-1].c;const fvgs=[];
  for(let i=1;i<K.length-1;i++){
    // Bullish FVG: gap up (candle i-1 high < candle i+1 low)
    if(K[i+1].l>K[i-1].h){
      const top=K[i+1].l,bot=K[i-1].h,size=(top-bot)/bot*100;
      if(size>=0.15){
        const filled=K.slice(i+2).some(c=>c.l<=top&&c.h>=bot);
        if(!filled) fvgs.push({type:'bull',top:+top.toFixed(8),bot:+bot.toFixed(8),mid:+((top+bot)/2).toFixed(8),size:+size.toFixed(2),dist:+pct(top,p).toFixed(2),idx:i});
      }
    }
    // Bearish FVG: gap down
    if(K[i+1].h<K[i-1].l){
      const top=K[i-1].l,bot=K[i+1].h,size=(top-bot)/bot*100;
      if(size>=0.15){
        const filled=K.slice(i+2).some(c=>c.h>=bot&&c.l<=top);
        if(!filled) fvgs.push({type:'bear',top:+top.toFixed(8),bot:+bot.toFixed(8),mid:+((top+bot)/2).toFixed(8),size:+size.toFixed(2),dist:+pct(bot,p).toFixed(2),idx:i});
      }
    }
  }
  return fvgs.slice(-20).sort((a,b)=>Math.abs(a.mid-p)-Math.abs(b.mid-p)).slice(0,6);
}

// Premium/Discount zones (ICT: 50% of range = equilibrium)
function pdZone(K){
  const seg=K.slice(-40);
  const hi=Math.max(...seg.map(c=>c.h)),lo=Math.min(...seg.map(c=>c.l));
  const p=K[K.length-1].c;
  const pct50=hi>lo?+(((p-lo)/(hi-lo))*100).toFixed(1):50;
  const eq=(hi+lo)/2;
  const oteLow=lo+(hi-lo)*0.618,oteHigh=lo+(hi-lo)*0.786; // OTE zone 61.8-78.6%
  const zone=pct50>62?'PREMIUM ⚠️':pct50<38?'DISCOUNT ✅':'EQUILIBRIUM';
  return{zone,pct:pct50,hi:+hi.toFixed(8),lo:+lo.toFixed(8),eq:+eq.toFixed(8),oteLow:+oteLow.toFixed(8),oteHigh:+oteHigh.toFixed(8)};
}

// Liquidity zones (where stops are clustered)
function liquidity(K,sw){
  const p=K[K.length-1].c;const{hi,lo}=sw;
  const buy=hi.slice(-5).filter(h=>h.v>p&&(h.v-p)/p<0.2).map(h=>({lvl:+h.v.toFixed(8),dist:+pct(h.v,p).toFixed(2),side:'Buy-side',desc:'Short stops clustered'})).slice(0,3);
  const sell=lo.slice(-5).filter(l=>l.v<p&&(p-l.v)/p<0.2).map(l=>({lvl:+l.v.toFixed(8),dist:+pct(p,l.v).toFixed(2),side:'Sell-side',desc:'Long stops clustered'})).slice(0,3);
  return{buy,sell};
}

// ─── CHART PATTERNS ───────────────────────────────────────────────
function detectPatterns(K){
  if(K.length<20) return [];
  const pts=[];const p=K[K.length-1].c;
  const seg=K.slice(-35);

  // Find local extremes
  const peaks=[],troughs=[];
  for(let i=2;i<seg.length-2;i++){
    if(seg[i].h>seg[i-1].h&&seg[i].h>seg[i-2].h&&seg[i].h>seg[i+1].h&&seg[i].h>seg[i+2].h) peaks.push({i,v:seg[i].h});
    if(seg[i].l<seg[i-1].l&&seg[i].l<seg[i-2].l&&seg[i].l<seg[i+1].l&&seg[i].l<seg[i+2].l) troughs.push({i,v:seg[i].l});
  }

  // Double Bottom
  if(troughs.length>=2){
    const t1=troughs[troughs.length-2],t2=troughs[troughs.length-1];
    if(t2.i>t1.i+3&&Math.abs(t1.v-t2.v)/Math.max(t1.v,t2.v)<0.05){
      const midPeaks=peaks.filter(pk=>pk.i>t1.i&&pk.i<t2.i);
      const neck=midPeaks.length?Math.max(...midPeaks.map(pk=>pk.v)):Math.max(...seg.slice(t1.i,t2.i).map(c=>c.h));
      const botLow=Math.min(t1.v,t2.v),target=neck+(neck-botLow);
      const conf=p>neck?88:p>botLow*1.02?75:65;
      pts.push({name:'Double Bottom',emoji:'🔵',type:'bull',conf,neck:+neck.toFixed(8),target:+target.toFixed(8),sl:+(botLow*0.985).toFixed(8),slPct:+pct(botLow*0.985,p).toFixed(1),tpPct:+pct(target,p).toFixed(1),confirmed:p>neck,desc:'2 bottom setara → breakout neckline = LONG signal kuat'});
    }
  }

  // Double Top
  if(peaks.length>=2){
    const p1=peaks[peaks.length-2],p2=peaks[peaks.length-1];
    if(p2.i>p1.i+3&&Math.abs(p1.v-p2.v)/Math.max(p1.v,p2.v)<0.05){
      const midTroughs=troughs.filter(tr=>tr.i>p1.i&&tr.i<p2.i);
      const neck=midTroughs.length?Math.min(...midTroughs.map(tr=>tr.v)):Math.min(...seg.slice(p1.i,p2.i).map(c=>c.l));
      const topHi=Math.max(p1.v,p2.v),target=neck-(topHi-neck);
      const conf=p<neck?88:p<topHi*0.98?72:62;
      pts.push({name:'Double Top',emoji:'🔴',type:'bear',conf,neck:+neck.toFixed(8),target:+target.toFixed(8),sl:+(topHi*1.015).toFixed(8),slPct:+pct(topHi*1.015,p).toFixed(1),tpPct:+pct(target,p).toFixed(1),confirmed:p<neck,desc:'2 top setara → breakdown neckline = SHORT signal'});
    }
  }

  // Ascending Triangle (Bullish)
  if(seg.length>=15){
    const last20=seg.slice(-20);const hH=last20.map(c=>c.h),lL=last20.map(c=>c.l);
    const maxH=Math.max(...hH),minH=Math.min(...hH),maxL=Math.max(...lL),minL=Math.min(...lL);
    if((maxH-minH)/maxH<0.025&&maxL>minL*1.02){
      pts.push({name:'Ascending Triangle',emoji:'📐',type:'bull',conf:78,breakout:+maxH.toFixed(8),target:+(maxH+(maxH-minL)).toFixed(8),sl:+(minL*0.985).toFixed(8),slPct:+pct(minL*0.985,p).toFixed(1),tpPct:+pct(maxH+(maxH-minL),p).toFixed(1),confirmed:p>maxH,desc:'Flat resistance + rising support → bullish breakout coming'});
    }
    // Descending Triangle (Bearish)
    if((maxL-minL)/maxL<0.025&&minH<maxH*0.985){
      pts.push({name:'Descending Triangle',emoji:'📐',type:'bear',conf:75,breakdown:+minL.toFixed(8),target:+(minL-(maxH-minL)).toFixed(8),sl:+(maxH*1.015).toFixed(8),slPct:+pct(maxH*1.015,p).toFixed(1),tpPct:+pct(minL-(maxH-minL),p).toFixed(1),confirmed:p<minL,desc:'Flat support + falling resistance → bearish breakdown'});
    }
  }

  // Bull Flag
  if(K.length>=25){
    const pole=K.slice(-25,-10),flag=K.slice(-10);
    const pHi=Math.max(...pole.map(c=>c.h)),pLo=Math.min(...pole.map(c=>c.l));
    const poleRise=(pHi-pLo)/pLo*100;
    const fHi=Math.max(...flag.map(c=>c.h)),fLo=Math.min(...flag.map(c=>c.l));
    const flagRng=(fHi-fLo)/fHi*100,flagDir=(flag[flag.length-1].c-flag[0].o)/flag[0].o*100;
    if(poleRise>8&&flagRng<poleRise*0.5&&flagDir<0&&flagDir>-poleRise*0.5){
      const tgt=fHi+(pHi-pLo);
      pts.push({name:'Bull Flag',emoji:'🚩',type:'bull',conf:82,target:+tgt.toFixed(8),sl:+(fLo*0.985).toFixed(8),slPct:+pct(fLo*0.985,p).toFixed(1),tpPct:+pct(tgt,p).toFixed(1),poleRise:+poleRise.toFixed(1),confirmed:p>fHi,desc:`Pole +${poleRise.toFixed(1)}% → flag koreksi → target pump setelah breakout`});
    }
    // Bear Flag
    const poleFall=(pHi-pLo)/pHi*100;
    if(K[K.length-25].c>K[K.length-10].c&&poleFall>8&&flagRng<poleFall*0.5&&flagDir>0){
      const tgt=fLo-(pHi-pLo);
      pts.push({name:'Bear Flag',emoji:'🚩',type:'bear',conf:80,target:+tgt.toFixed(8),sl:+(fHi*1.015).toFixed(8),slPct:+pct(fHi*1.015,p).toFixed(1),tpPct:+pct(tgt,p).toFixed(1),desc:`Drop ${poleFall.toFixed(1)}% → flag bounce → target dump berikutnya`});
    }
  }

  // Head & Shoulders
  if(peaks.length>=3){
    const [lS,hd,rS]=[peaks[peaks.length-3],peaks[peaks.length-2],peaks[peaks.length-1]];
    if(hd.v>lS.v&&hd.v>rS.v&&Math.abs(lS.v-rS.v)/Math.max(lS.v,rS.v)<0.07){
      const neckTroughs=troughs.filter(tr=>tr.i>lS.i&&tr.i<rS.i);
      const neck=neckTroughs.length?Math.min(...neckTroughs.map(tr=>tr.v)):p*0.95;
      const target=neck-(hd.v-neck);
      pts.push({name:'Head & Shoulders',emoji:'👤',type:'bear',conf:80,neck:+neck.toFixed(8),target:+target.toFixed(8),sl:+(hd.v*1.01).toFixed(8),slPct:+pct(hd.v*1.01,p).toFixed(1),tpPct:+pct(target,p).toFixed(1),confirmed:p<neck,desc:'Klasik reversal pattern. Breakdown neckline = SHORT signal kuat'});
    }
  }

  return pts.sort((a,b)=>b.conf-a.conf).slice(0,4);
}

// ─── ELLIOTT WAVE ─────────────────────────────────────────────────
function elliottWave(K4h,K1d){
  if(!K4h||K4h.length<30) return null;
  const p=K4h[K4h.length-1].c;
  const cls=K4h.map(c=>c.c);
  const rsiV=rsi14(cls);
  const seg=K4h.slice(-50);
  let minP=seg[0].l,maxP=seg[0].h,minI=0,maxI=0;
  seg.forEach((c,i)=>{if(c.l<minP){minP=c.l;minI=i;}if(c.h>maxP){maxP=c.h;maxI=i;}});
  const range=maxP-minP;if(range<minP*0.001) return null;

  // Daily context
  let daily='';
  if(K1d&&K1d.length>=20){
    const c1d=K1d.map(c=>c.c);const r1d=rsi14(c1d);
    const e50=ema(c1d,Math.min(50,c1d.length));
    daily=p>e50?(r1d>55?'Daily trend UP':'Daily above EMA50'):(r1d<45?'Daily trend DOWN':'Daily below EMA50');
  }

  let wave='',waveNum='',prob=0,target=null,sl=null,desc='',dir='',fibLvl='';
  const fromHi=(maxP-p)/range*100;
  const fromLo=(p-minP)/range*100;

  if(maxI>minI){ // Last major move = UP, currently correcting
    if(fromHi<18){
      wave='⑤ WAVE 5';waveNum='5';prob=65;dir='BULL';fibLvl='>0%';
      desc='Final impulse wave. RSI sering divergence di Wave 5. Hati-hati distribusi.';
      target=+(maxP*1.038).toFixed(8);sl=+(p*(1-range/minP*0.3)).toFixed(8);
    }else if(fromHi>=18&&fromHi<50){
      wave='④ WAVE 4';waveNum='4';prob=78;dir='BULL';fibLvl='23.6-38.2%';
      desc='Koreksi Wave 4. Entry optimal sebelum Wave 5. BUY di zona retracement fib.';
      target=+(maxP*1.08).toFixed(8);sl=+(minP+(range*0.236)).toFixed(8);
    }else{
      wave='Ⓑ WAVE B';waveNum='B';prob=60;dir='BEAR';fibLvl='50-61.8%';
      desc='Wave B counter-rally dalam koreksi ABC. Wave C akan turun setelah ini.';
      target=+(minP*(0.97)).toFixed(8);sl=+(maxP*1.015).toFixed(8);
    }
  }else{ // Last major move = DOWN, currently recovering
    if(fromLo>72){
      wave='③ WAVE 3';waveNum='3';prob=90;dir='BULL';fibLvl='161.8%+';
      desc='TERKUAT! Wave 3 extension aktif. 1.618-2.618x wave 1. ENTRY dengan momentum sekarang!';
      target=+(minP+(range*2.618)).toFixed(8);sl=+(minP+(range*0.5)).toFixed(8);
    }else if(fromLo>=38&&fromLo<=72){
      wave='② WAVE 2';waveNum='2';prob=84;dir='BULL';fibLvl='50-61.8%';
      desc='Wave 2 deep retracement. ENTRY OPTIMAL. Stop di bawah Wave 1 low. Wave 3 dimulai segera.';
      target=+(minP+(range*2.618)).toFixed(8);sl=+(minP*(0.988)).toFixed(8);
    }else{
      wave='① WAVE 1';waveNum='1';prob=70;dir='BULL';fibLvl='0-38.2%';
      desc='Awal impulse baru. Konfirmasi BOS sebelum entry. Target: 0.618x range sebagai Wave 1.';
      target=+(minP+(range*0.618)).toFixed(8);sl=+(minP*(0.985)).toFixed(8);
    }
  }

  // RSI divergence (Wave 5 weakness indicator)
  const prevRsi=cls.length>10?rsi14(cls.slice(0,-8)):null;
  const divBear=waveNum==='5'&&rsiV&&prevRsi&&p>maxP*0.97&&rsiV<prevRsi-5;

  return{wave,waveNum,prob,target,sl,desc,dir,daily,fibLvl,
    hasDivergence:divBear,
    priceRange:{hi:+maxP.toFixed(8),lo:+minP.toFixed(8),cur:+p.toFixed(8)},
    retracePct:+fromLo.toFixed(1),fromHighPct:+fromHi.toFixed(1)};
}

// ─── RSI DIVERGENCE ────────────────────────────────────────────────
function rsiDiv(K4h){
  if(!K4h||K4h.length<25) return null;
  const cls=K4h.map(c=>c.c);
  const seg=K4h.slice(-15);const segCls=cls.slice(-15);
  // Build RSI for each point in segment
  const rsiArr=segCls.map((_,i)=>rsi14(cls.slice(0,cls.length-15+i+1))).filter(v=>v!==null);
  if(rsiArr.length<10) return null;
  // Find swing lows in price
  const pLows=[],pHighs=[];
  for(let i=2;i<seg.length-2;i++){
    if(seg[i].l<seg[i-1].l&&seg[i].l<seg[i+1].l) pLows.push({i,pv:seg[i].l,rv:rsiArr[i]||50});
    if(seg[i].h>seg[i-1].h&&seg[i].h>seg[i+1].h) pHighs.push({i,pv:seg[i].h,rv:rsiArr[i]||50});
  }
  if(pLows.length>=2){
    const[l1,l2]=[pLows[pLows.length-2],pLows[pLows.length-1]];
    if(l2.pv<l1.pv&&l2.rv>l1.rv+2){
      return{type:'bullish',desc:`Price: lower low ($${l2.pv.toFixed(6)}) + RSI: higher low (${l2.rv.toFixed(0)}) = BULLISH DIVERGENCE`,strength:l2.rv-l1.rv>12?'STRONG':'MODERATE',prob:82};
    }
  }
  if(pHighs.length>=2){
    const[h1,h2]=[pHighs[pHighs.length-2],pHighs[pHighs.length-1]];
    if(h2.pv>h1.pv&&h2.rv<h1.rv-2){
      return{type:'bearish',desc:`Price: higher high + RSI: lower high (${h2.rv.toFixed(0)}) = BEARISH DIVERGENCE`,strength:h1.rv-h2.rv>12?'STRONG':'MODERATE',prob:80};
    }
  }
  return null;
}

// ─── VOLUME ANALYSIS ──────────────────────────────────────────────
function volAnalysis(K4h){
  if(!K4h||K4h.length<10) return null;
  const seg=K4h.slice(-20);const avgV=seg.slice(0,-5).reduce((s,c)=>s+c.q,0)/Math.max(1,seg.length-5);
  const lastV=seg.slice(-5).reduce((s,c)=>s+c.q,0)/5;
  const vR=avgV>0?+(lastV/avgV).toFixed(2):1;
  const p=K4h[K4h.length-1].c;const c7=K4h.length>=7?pct(p,K4h[K4h.length-7].c):0;
  // OBV
  let obv=0,obvUp=0,obvDn=0;
  for(let i=1;i<K4h.length;i++){
    if(K4h[i].c>K4h[i-1].c){obv+=K4h[i].q;obvUp+=K4h[i].q;}
    else if(K4h[i].c<K4h[i-1].c){obv-=K4h[i].q;obvDn+=K4h[i].q;}
  }
  const obvTrend=obvUp>obvDn*1.1?'UP 📈':obvDn>obvUp*1.1?'DOWN 📉':'FLAT';
  let sig='Normal';
  if(vR>2&&c7>0) sig='🚀 Volume Breakout Bull';
  else if(vR>2&&c7<0) sig='💀 Volume Breakdown Bear';
  else if(vR>1.5&&Math.abs(c7)<1.5) sig='🤫 Stealth Accumulation';
  else if(vR>1.3&&c7>2) sig='📈 Volume Confirms Bull';
  else if(vR<0.5) sig='⚠️ Low Volume Caution';
  return{ratio:vR,signal:sig,obvTrend,avgVol:+avgV.toFixed(0),lastVol:+lastV.toFixed(0)};
}

// ─── BIAS CALCULATOR ──────────────────────────────────────────────
function calcBias(r1h,r4h,r1d,macdV,ms,pd,ew,div,volA,fr,ema9,ema21,ema50){
  let s=0;const f=[];
  // RSI multi-TF
  if(r4h!==null){
    if(r4h<28){s+=20;f.push(`4H RSI ${r4h} OVERSOLD`);} else if(r4h<38){s+=12;f.push(`4H RSI ${r4h} bearish zone`);}
    else if(r4h>78){s-=20;f.push(`4H RSI ${r4h} OVERBOUGHT`);} else if(r4h>65){s-=10;f.push(`4H RSI ${r4h} elevated`);}
    else if(r4h>=38&&r4h<=62){s+=2;}
  }
  if(r1h!==null){if(r1h<30)s+=8;else if(r1h>72)s-=8;}
  if(r1d!==null){if(r1d<35){s+=10;f.push(`1D RSI ${r1d} oversold`);}else if(r1d>75){s-=10;f.push(`1D RSI ${r1d} overbought`);}}
  // MACD
  if(macdV){if(macdV.xUp){s+=14;f.push('4H MACD Golden Cross 🚀');}else if(macdV.xDown){s-=14;f.push('4H MACD Death Cross 💀');}else if(macdV.bull){s+=5;}else if(macdV.bear){s-=5;}}
  // EMA
  if(ema9&&ema21){if(ema9>ema21){s+=6;f.push('EMA9 > EMA21 Bull alignment');}else{s-=6;f.push('EMA9 < EMA21 Bear alignment');}}
  if(ema50){const p2=arguments[13];} // price passed as 14th arg if needed
  // Market structure
  if(ms){if(ms.trend==='BULLISH'){s+=15;f.push('Market Structure: BULLISH (HH+HL)');}else if(ms.trend==='BEARISH'){s-=15;f.push('Market Structure: BEARISH (LH+LL)');}if(ms.bos?.dir==='bull'){s+=8;f.push('Recent BOS Bullish ✅');}else if(ms.bos?.dir==='bear'){s-=8;}if(ms.choch?.dir==='bull'){s+=5;}}
  // Premium/Discount
  if(pd){if(pd.zone.includes('DISCOUNT')){s+=8;f.push(`Price in DISCOUNT zone (${pd.pct}%)`);}else if(pd.zone.includes('PREMIUM')){s-=8;f.push(`Price in PREMIUM zone (${pd.pct}%)`);}}
  // Elliott Wave
  if(ew){if(ew.dir==='BULL'){const b=ew.waveNum==='3'?22:ew.waveNum==='2'?16:ew.waveNum==='4'?10:8;s+=b;f.push(ew.wave+' ('+ew.prob+'% prob)');}else if(ew.dir==='BEAR'){s-=8;f.push(ew.wave);}}
  // RSI Divergence
  if(div){if(div.type==='bullish'){s+=16;f.push(`Bullish RSI Divergence (${div.strength})`);}else{s-=14;f.push(`Bearish RSI Divergence (${div.strength})`);}}
  // Volume
  if(volA){if(volA.signal.includes('Breakout Bull')){s+=10;f.push(volA.signal);}else if(volA.signal.includes('Breakdown')){s-=10;f.push(volA.signal);}else if(volA.signal.includes('Stealth')){s+=12;f.push(volA.signal);}}
  // FR
  const frP=(fr||0)*100;
  if(frP<-0.005){s+=14;f.push(`FR ${frP.toFixed(4)}% extreme short → squeeze`);}
  else if(frP<0){s+=7;f.push(`FR ${frP.toFixed(4)}% negatif → contrarian buy`);}
  else if(frP>0.08){s-=12;f.push(`FR +${frP.toFixed(4)}% overheated`);}
  const score=cl(s,-60,60);
  const prob=cl(Math.round(50+score*0.62),15,96);
  let bias,label;
  if(score>=35){bias='STRONG_BULLISH';label='STRONG BULLISH';}
  else if(score>=18){bias='BULLISH';label='BULLISH';}
  else if(score>=7){bias='MILD_BULLISH';label='MILD BULLISH';}
  else if(score<=-35){bias='STRONG_BEARISH';label='STRONG BEARISH';}
  else if(score<=-18){bias='BEARISH';label='BEARISH';}
  else if(score<=-7){bias='MILD_BEARISH';label='MILD BEARISH';}
  else{bias='NEUTRAL';label='NEUTRAL';}
  const color=score>=18?'#00ffd0':score>=7?'#00ff88':score<=-18?'#ff3355':score<=-7?'#ff7799':'#ffd700';
  return{bias,label,score,prob,factors:f.slice(0,7),color};
}

// ─── TRADE SETUP ──────────────────────────────────────────────────
function buildSetup(p,dir,atr4h,ob,fvg,ew,prob){
  const a=atr4h||p*0.025;
  let entry=p,sl,tp1,tp2,tp3,entryType='Market';
  if(dir==='LONG'){
    // Entry: nearest bullish OB below price, or current price
    const nearOB=ob.bullOBs.find(x=>x.top<p&&x.top>p*0.85);
    if(nearOB){entry=nearOB.mid;entryType='Bull OB Entry';}
    sl=nearOB?nearOB.bot*0.99:p-a*1.4;
    // TP: nearest bearish OB above, or FVG fill
    const aboveFVG=fvg.filter(f=>f.type==='bear'&&f.bot>p).sort((a,b)=>a.bot-b.bot)[0];
    const aboveOB=ob.bearOBs.filter(x=>x.bot>p).sort((a,b)=>a.bot-b.bot)[0];
    tp1=aboveFVG?aboveFVG.mid:p+a*2;
    tp2=aboveOB?aboveOB.mid:p+a*3.5;
    tp3=ew?.target||p+a*5.5;
  }else{
    const nearOB=ob.bearOBs.find(x=>x.bot>p&&x.bot<p*1.15);
    if(nearOB){entry=nearOB.mid;entryType='Bear OB Entry';}
    sl=nearOB?nearOB.top*1.01:p+a*1.4;
    const belowFVG=fvg.filter(f=>f.type==='bull'&&f.top<p).sort((a,b)=>b.top-a.top)[0];
    const belowOB=ob.bullOBs.filter(x=>x.top<p).sort((a,b)=>b.top-a.top)[0];
    tp1=belowFVG?belowFVG.mid:p-a*2;
    tp2=belowOB?belowOB.mid:p-a*3.5;
    tp3=ew?.target||p-a*5.5;
  }
  const rr=dir==='LONG'?(tp2-entry)/(entry-sl):(entry-tp2)/(sl-entry);
  const slP=dir==='LONG'?pct(sl,entry):pct(entry,sl);
  const tp1P=dir==='LONG'?pct(tp1,entry):pct(entry,tp1);
  const tp2P=dir==='LONG'?pct(tp2,entry):pct(entry,tp2);
  const tp3P=dir==='LONG'?pct(tp3,entry):pct(entry,tp3);
  const w=cl(prob/100,.1,.95),kelly=+(Math.max(.5,Math.min(8,(w*rr-(1-w))/rr/2*100)).toFixed(1));
  return{dir,entry:+entry.toFixed(8),sl:+sl.toFixed(8),tp1:+tp1.toFixed(8),tp2:+tp2.toFixed(8),tp3:+tp3.toFixed(8),slPct:+slP.toFixed(2),tp1Pct:+tp1P.toFixed(2),tp2Pct:+tp2P.toFixed(2),tp3Pct:+tp3P.toFixed(2),rr:+rr.toFixed(2),kelly,entryType};
}

// ─── MOON PHASE ────────────────────────────────────────────────────
function moonPhase(){
  const phases=[{p:.0625,n:'New Moon',e:'🌑'},{p:.1875,n:'Waxing Crescent',e:'🌒'},{p:.3125,n:'First Quarter',e:'🌓'},{p:.4375,n:'Waxing Gibbous',e:'🌔'},{p:.5625,n:'Full Moon',e:'🌕'},{p:.6875,n:'Waning Gibbous',e:'🌖'},{p:.8125,n:'Last Quarter',e:'🌗'},{p:.9375,n:'Waning Crescent',e:'🌘'},{p:1,n:'New Moon',e:'🌑'}];
  const pct=(Date.now()/1000-592500)%(29.53*86400)/(29.53*86400);
  const ph=phases.find(p=>pct<p.p)||phases[8];
  return{moonPhase:ph.n,moonEmoji:ph.e};
}

// ─── MAIN HANDLER ─────────────────────────────────────────────────
export default async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Cache-Control','no-store');
  if(req.method==='OPTIONS') return res.status(200).end();

  const sym=(req.query?.symbol||req.query?.s||'').toString().toUpperCase().replace(/USDT|PERP/gi,'').trim();
  if(!sym||sym.length>12) return res.status(400).json({ok:false,error:'Symbol required. Example: ?symbol=BTC'});
  const t0=Date.now();

  try{
    // ── PARALLEL FETCH: ticker + 3 TF klines ──────────────────────
    const [linR,spR,k1hR,k4hR,k1dR]=await Promise.allSettled([
      sf(`https://api.bybit.com/v5/market/tickers?category=linear&symbol=${sym}USDT`,5500),
      sf(`https://api.bybit.com/v5/market/tickers?category=spot&symbol=${sym}USDT`,4000),
      sf(`https://api.bybit.com/v5/market/kline?category=linear&symbol=${sym}USDT&interval=60&limit=120`,6000),
      sf(`https://api.bybit.com/v5/market/kline?category=linear&symbol=${sym}USDT&interval=240&limit=80`,6000),
      sf(`https://api.bybit.com/v5/market/kline?category=linear&symbol=${sym}USDT&interval=D&limit=60`,6000),
    ]);

    // ── Parse ticker ──────────────────────────────────────────────
    let price=0,fr=0,oi=0,vol=0,c24=0,src='';
    const linT=linR.value?.result?.list?.[0];
    if(linT&&N(linT.lastPrice)>0){
      price=N(linT.lastPrice);fr=N(linT.fundingRate);oi=N(linT.openInterestValue);vol=N(linT.turnover24h);
      const prev=N(linT.prevPrice24h||price);c24=prev>0?pct(price,prev):0;src='Bybit Futures';
    }else{
      const spT=spR.value?.result?.list?.[0];
      if(spT&&N(spT.lastPrice)>0){
        price=N(spT.lastPrice);vol=N(spT.turnover24h);
        const prev=N(spT.prevPrice24h||price);c24=prev>0?pct(price,prev):0;src='Bybit Spot';
      }
    }
    // ── CryptoCompare fallback — store in ccK4h (used when building K4h below) ──
    let ccK4h=[], ccVol=0;
    if(price<=0){
      try{
        const [ccPR,ccK4R]=await Promise.allSettled([
          sf('https://min-api.cryptocompare.com/data/price?fsym='+sym+'&tsyms=USD',4500),
          sf('https://min-api.cryptocompare.com/data/v2/histohour?fsym='+sym+'&tsym=USD&limit=42&aggregate=4&e=CCCAGG',5500),
        ]);
        const ccP=N(ccPR.value?.USD);
        if(ccP>0){
          price=ccP; src='CryptoCompare (Full Analysis)';
          const ccRows=A(ccK4R.value?.Data?.Data).filter(d=>N(d.close)>0&&N(d.close)<1e10);
          if(ccRows.length>=16){
            ccK4h=ccRows.map(d=>({t:N(d.time),o:N(d.open),h:N(d.high),l:N(d.low),c:N(d.close),v:N(d.volumeto),q:N(d.volumeto)}));
            ccVol=ccRows.slice(-7).reduce((s,d)=>s+N(d.volumeto),0)/7;
          }
        }
      }catch{}
    }
    if(price<=0) return res.status(200).json({ok:false,symbol:sym,error:sym+' tidak ditemukan di Bybit atau CryptoCompare. Cek ejaan.',elapsed:Date.now()-t0});

    // ── Parse klines ──────────────────────────────────────────────
    const getK=r=>{
      if(r.status!=='fulfilled'||!r.value) return [];
      const d=r.value;if(d.retCode!==undefined&&d.retCode!==0) return [];
      return parseK(A(d?.result?.list));
    };
    const K1h=getK(k1hR),K4h=ccK4h.length>=16?ccK4h:getK(k4hR),K1d=getK(k1dR);if(ccVol>0)vol=ccVol;
    const has=K4h.length>=16;

    // ── Indicators ────────────────────────────────────────────────
    const cls4h=K4h.map(c=>c.c);
    const r1h=K1h.length>=16?rsi14(K1h.map(c=>c.c)):null;
    const r4h=K4h.length>=16?rsi14(cls4h):null;
    const r1d=K1d.length>=16?rsi14(K1d.map(c=>c.c)):null;
    const macdV=K4h.length>=28?macdCalc(cls4h):null;
    const atr4h=K4h.length>=15?atr14(K4h):0;
    const atrPct=atr4h>0&&price>0?+(atr4h/price*100).toFixed(3):0;
    const e9=cls4h.length>=9?ema(cls4h,9):null;
    const e21=cls4h.length>=21?ema(cls4h,21):null;
    const e50=cls4h.length>=50?ema(cls4h,50):null;
    const e200=cls4h.length>=50?ema(cls4h,Math.min(200,cls4h.length)):null;

    // ── SMC Analysis ──────────────────────────────────────────────
    let smcData={bullOBs:[],bearOBs:[],fvgs:[],ms:null,pd:null,liq:{buy:[],sell:[]}};
    if(has){
      const sw=swings(K4h,3);
      const ms=mktStructure(K4h,sw);
      const{bullOBs,bearOBs}=detectOBs(K4h);
      const fvgs=detectFVGs(K4h);
      const pd=pdZone(K4h);
      const liq=liquidity(K4h,sw);
      smcData={bullOBs,bearOBs,fvgs,ms,pd,liq};
    }

    // ── Chart Patterns ────────────────────────────────────────────
    const patterns=has?detectPatterns(K4h):[];

    // ── Elliott Wave ──────────────────────────────────────────────
    const ew=has?elliottWave(K4h,K1d):null;

    // ── RSI Divergence ────────────────────────────────────────────
    const div=has&&K4h.length>=25?rsiDiv(K4h):null;

    // ── Volume ────────────────────────────────────────────────────
    const volA=has?volAnalysis(K4h):null;

    // ── Overall Bias ──────────────────────────────────────────────
    const biasData=calcBias(r1h,r4h,r1d,macdV,smcData.ms,smcData.pd,ew,div,volA,fr,e9,e21,e50);

    // ── Trade Setup ───────────────────────────────────────────────
    const dir=biasData.score>8?'LONG':biasData.score<-8?'SHORT':'WAIT';
    let setup=null;
    if(dir!=='WAIT'&&atr4h>0){
      setup=buildSetup(price,dir,atr4h,smcData,smcData.fvgs,ew,biasData.prob);
      // Conviction stars
      const cx=(biasData.score>35?2:biasData.score>18?1:0)+
        (smcData.bullOBs.length>0&&dir==='LONG'?0.8:smcData.bearOBs.length>0&&dir==='SHORT'?0.8:0)+
        (smcData.fvgs.length>0?0.5:0)+(ew&&((ew.dir==='BULL'&&dir==='LONG')||(ew.dir==='BEAR'&&dir==='SHORT'))?1.2:0)+
        (div&&((div.type==='bullish'&&dir==='LONG')||(div.type==='bearish'&&dir==='SHORT'))?1.2:0)+
        (patterns.length>0&&((patterns[0].type==='bull'&&dir==='LONG')||(patterns[0].type==='bear'&&dir==='SHORT'))?0.8:0)+
        (r4h!==null&&r4h<35&&dir==='LONG'?1:0)+(atr4h>0?0.5:0);
      setup.convStars=Math.min(5,+cx.toFixed(1));
    }

    // ── RSI Zone labels ───────────────────────────────────────────
    const rzone=v=>v===null?'—':v<25?'⚡ EXTREME OS':v<35?'🟢 Oversold':v<45?'↘ Bearish':v<55?'↔ Neutral':v<65?'↗ Bullish':v<75?'🟡 Overbought':'🔴 EXTREME OB';

    // ── Output ────────────────────────────────────────────────────
    return res.status(200).json({
      ok:true, symbol:sym, price:+price.toFixed(8), change24h:+c24.toFixed(3),
      volume24h:vol, fundingRate:fr, frPct:+(fr*100).toFixed(5), openInterest:oi, dataSource:src,
      klineData:{has,k1h:K1h.length,k4h:K4h.length,k1d:K1d.length},
      rsi:{
        '1H':r1h,'4H':r4h,'1D':r1d,
        '1H_zone':rzone(r1h),'4H_zone':rzone(r4h),'1D_zone':rzone(r1d),
        divergence:div,
      },
      ema:{
        e9_4h:e9?+e9.toFixed(8):null,e21_4h:e21?+e21.toFixed(8):null,
        e50_4h:e50?+e50.toFixed(8):null,e200_4h:e200?+e200.toFixed(8):null,
        aboveEma200:e200?price>e200:null,
        trend:e9&&e21?(e9>e21?'🟢 EMA Bull':'🔴 EMA Bear'):'—',
        vs200:e200?+(pct(price,e200).toFixed(2)):null,
      },
      macd:macdV?{...macdV,signal:macdV.xUp?'🚀 Golden Cross':macdV.xDown?'💀 Death Cross':macdV.bull?'🟢 Bull Hist':'🔴 Bear Hist'}:null,
      atr:{val:+atr4h.toFixed(8),pct:atrPct},
      volume:volA,
      smc:{
        hasData:has,
        marketStructure:smcData.ms,
        premiumDiscount:smcData.pd,
        bullOBs:smcData.bullOBs,
        bearOBs:smcData.bearOBs,
        fvgs:smcData.fvgs,
        liquidity:smcData.liq,
      },
      patterns,
      elliottWave:ew,
      summary:{
        bias:biasData.bias,biasLabel:biasData.label,
        score:biasData.score,prob:biasData.prob,
        factors:biasData.factors,direction:dir,
        oneLiner:biasData.factors[0]||`${sym} — ${biasData.label}`,
        biasColor:biasData.color,
      },
      tradeSetup:setup,
      confluence:{
        smcOB:smcData.bullOBs.length+smcData.bearOBs.length,
        fvg:smcData.fvgs.length,
        patterns:patterns.length,
        ew:ew?1:0,
        divergence:div?1:0,
        totalPoints:biasData.prob,
      },
      astrology:moonPhase(),
      elapsed:Date.now()-t0,
    });

  }catch(e){
    return res.status(200).json({ok:false,symbol:sym,error:String(e?.message||'Error'),price:0,change24h:0,rsi:{'1H':null,'4H':null,'1D':null,'1H_zone':'—','4H_zone':'—','1D_zone':'—'},smc:{hasData:false,bullOBs:[],bearOBs:[],fvgs:[]},patterns:[],elliottWave:null,summary:{bias:'NEUTRAL',biasLabel:'ERROR',score:0,prob:50,factors:[String(e?.message||'')],direction:'WAIT',biasColor:'#888'},tradeSetup:null,astrology:moonPhase(),elapsed:Date.now()-t0});
  }
}
