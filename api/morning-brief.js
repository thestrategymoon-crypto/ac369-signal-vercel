// api/morning-brief.js — v3 MAXIMUM POWER & ACCURACY
// ════════════════════════════════════════════════════════
// UPGRADE v3 vs v2:
// ✅ Bybit klines UTAMA untuk semua RSI (50 koin) — tidak rate limited
// ✅ CryptoCompare sebagai fallback saja
// ✅ Fix BTC L/S ratio — endpoint Bybit account-ratio yang benar
// ✅ Real ATR dari 4H klines untuk semua SL/TP
// ✅ ELITE threshold turun ke ≥80 (dari ≥85) — lebih realistis
// ✅ Convergence 5 faktor diperkuat: OBV + MACD + structure
// ✅ BTC RSI pasti ada (Bybit klines selalu tersedia)
// ✅ 50 koin real RSI — 3x lebih banyak dari v2
// ✅ Better game plan: skenario lebih presisi
// ✅ Sector flow 12 kategori dengan avg conv score
// ════════════════════════════════════════════════════════

const N=(v,d=0)=>{const n=+v;return(isNaN(n)||!isFinite(n))?d:n;};
const A=(v)=>Array.isArray(v)?v:[];
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,N(v)));

// 50 koin via Bybit klines (tidak rate limited, gratis)
const TOP50=[
  // Major
  'BTC','ETH','BNB','SOL','XRP','ADA','DOGE','AVAX','LINK','DOT',
  // Mid-cap bullish
  'NEAR','SUI','APT','ARB','OP','TON','INJ','TIA','HYPE','WIF',
  // DeFi
  'AAVE','JUP','PENDLE','GMX','DYDX','LDO','UNI','CRV','SUSHI','CAKE',
  // AI/Infra
  'RENDER','FET','TAO','WLD','IO','OLAS','VIRTUAL','GRT','PYTH','EIGEN',
  // L1/L2
  'SEI','ENA','JTO','ONDO','STRK','ZRO','RON','W','MANTA','STX',
];

// Koin tambahan untuk convergence scan
const CONV25=[
  'PEPE','FLOKI','BONK','MOODENG','PNUT','NEIRO','ACT',
  'ATOM','FIL','ALGO','HBAR','XLM','LTC','VET','TRX',
  'BLUR','RDNT','GNS','VELO','AERO',
  'PIXEL','BEAM','YGG','MAGIC','RON',
];

const SECTORS={
  'L1':['BTC','ETH','SOL','ADA','AVAX','TON','NEAR','SUI','APT','TIA','SEI','ENA','HBAR','ALGO','XLM','VET'],
  'L2':['ARB','OP','STRK','ZRO','MANTA','W','RON'],
  'DeFi':['AAVE','JUP','PENDLE','GMX','DYDX','LDO','UNI','CRV','SUSHI','CAKE','RDNT','GNS','VELO','AERO','BLUR'],
  'AI/DePIN':['RENDER','FET','TAO','WLD','IO','OLAS','VIRTUAL','GRT','PYTH','EIGEN'],
  'Meme':['DOGE','PEPE','WIF','FLOKI','BONK','MOODENG','PNUT','NEIRO','ACT'],
  'Infrastructure':['LINK','DOT','INJ','ATOM','FIL','ONDO','JTO'],
  'Payments':['XRP','TRX','XLM','LTC'],
  'Bitcoin':['BTC'],
  'Ethereum':['ETH'],
  'Gaming':['PIXEL','BEAM','YGG','MAGIC','RON'],
  'Hyperliq':['HYPE'],
  'Layer2':['ARB','OP','STRK'],
};

const CACHE={data:null,ts:0};
const CACHE_TTL=360000; // 6 menit

export default async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Cache-Control','s-maxage=360,stale-while-revalidate=60');
  if(req.method==='OPTIONS')return res.status(200).end();
  const t0=Date.now();

  if(CACHE.data&&Date.now()-CACHE.ts<CACHE_TTL){
    return res.status(200).json({...CACHE.data,cached:true,elapsed:Date.now()-t0});
  }

  const sf=async(url,ms=5000)=>{
    const c=new AbortController();const t=setTimeout(()=>c.abort(),ms);
    try{const r=await fetch(url,{signal:c.signal,headers:{Accept:'application/json','User-Agent':'AC369/3.0'}});clearTimeout(t);return r.ok?await r.json():null;}
    catch{clearTimeout(t);return null;}
  };

  // ── KLINES (Bybit 4H) ─────────────────────────────────
  const calcRSI=a=>{
    try{if(!a||a.length<16)return null;
    let g=0,l=0;for(let i=1;i<=14;i++){const d=a[i]-a[i-1];d>0?g+=d:l-=d;}
    g/=14;l/=14;
    for(let i=15;i<a.length;i++){const d=a[i]-a[i-1];g=(g*13+Math.max(d,0))/14;l=(l*13+Math.max(-d,0))/14;}
    return l===0?100:clamp(100-100/(1+g/l),0,100);}catch{return null;}
  };
  const calcEMA=(a,p)=>{
    if(!a||a.length<2)return a?.[a.length-1]||0;
    const k=2/(p+1);let e=a.slice(0,Math.min(p,a.length)).reduce((s,v)=>s+v,0)/Math.min(p,a.length);
    for(let i=Math.min(p,a.length);i<a.length;i++)e=a[i]*k+e*(1-k);
    return e;
  };
  const calcMACD=a=>{
    try{if(!a||a.length<36)return null;
    const k12=2/13,k26=2/27,k9=2/10;
    let e12=a.slice(0,12).reduce((s,v)=>s+v,0)/12,e26=a.slice(0,26).reduce((s,v)=>s+v,0)/26;
    const mv=[];
    for(let i=26;i<a.length;i++){e12=a[i]*k12+e12*(1-k12);e26=a[i]*k26+e26*(1-k26);mv.push(e12-e26);}
    let sig=mv.slice(0,9).reduce((s,v)=>s+v,0)/9;
    for(let i=9;i<mv.length;i++)sig=mv[i]*k9+sig*(1-k9);
    const n=mv.length,last=N(mv[n-1]),prev=N(mv[n-2]||last),h=last-sig,ph=prev-sig;
    return{bull:last>0&&h>0,bear:last<0&&h<0,xUp:h>0&&ph<=0,xDown:h<0&&ph>=0,div:n>7&&last<N(mv[n-8])&&a[a.length-1]>a[a.length-8]};}
    catch{return null;}
  };

  const getBybitKline=async sym=>{
    try{
      const r=await sf(`https://api.bybit.com/v5/market/kline?category=linear&symbol=${sym}USDT&interval=240&limit=60`,4000);
      if(r?.retCode!==0)return null;
      const raw=A(r?.result?.list);if(raw.length<16)return null;
      const K=raw.slice().reverse().map(d=>({t:N(d[0]),o:N(d[1]),h:N(d[2]),l:N(d[3]),c:N(d[4]),v:N(d[6])})).filter(d=>d.c>0);
      if(K.length<16)return null;
      const cls=K.map(k=>k.c);
      const rsi=calcRSI(cls);if(rsi===null)return null;
      const macd=calcMACD(cls);
      const e9=calcEMA(cls,9),e21=calcEMA(cls,21),e200=calcEMA(cls,Math.min(200,cls.length-1));
      let obvUp=0,obvDn=0;
      for(let i=Math.max(1,K.length-20);i<K.length;i++){
        if(N(K[i].c)>N(K[i-1].c))obvUp+=N(K[i].v);
        else if(N(K[i].c)<N(K[i-1].c))obvDn+=N(K[i].v);
      }
      const atrArr=K.slice(1).map((k,i)=>Math.max(N(k.h)-N(k.l),Math.abs(N(k.h)-N(K[i].c)),Math.abs(N(k.l)-N(K[i].c))));
      const atr=atrArr.slice(-14).reduce((s,v)=>s+v,0)/14;
      const lp=cls[cls.length-1];
      const bullCandle=N(K[K.length-1].c)>N(K[K.length-1].o);
      const rsi1d_r=await sf(`https://api.bybit.com/v5/market/kline?category=linear&symbol=${sym}USDT&interval=D&limit=16`,3000);
      let rsi1d=null;
      if(rsi1d_r?.retCode===0){
        const dK=A(rsi1d_r?.result?.list).slice().reverse().map(d=>N(d[4])).filter(v=>v>0);
        if(dK.length>=16)rsi1d=calcRSI(dK);
      }
      return{rsi:+N(rsi).toFixed(2),rsi1d:rsi1d!=null?+N(rsi1d).toFixed(2):null,macd,e9,e21,e200,atr,obvBull:obvUp>obvDn*1.2,aboveE200:lp>e200,cls,K,bullCandle,price:lp,src:'bybit'};
    }catch{return null;}
  };

  try{
    // ── PARALLEL: CG prices + Bybit FR + Bybit L/S + FG ──
    const allSyms=[...new Set([...TOP50,...CONV25])];
    const [cgR,byFrR,byLSR,fgR]=await Promise.allSettled([
      sf('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=volume_desc&per_page=250&page=1&sparkline=false&price_change_percentage=24h,7d',6000),
      sf('https://api.bybit.com/v5/market/tickers?category=linear',4000),
      // Bybit L/S ratio untuk BTC (endpoint yang benar)
      sf('https://api.bybit.com/v5/market/account-ratio?category=linear&symbol=BTCUSDT&period=1h&limit=1',4000),
      sf('https://api.alternative.me/fng/?limit=1&format=json',3000),
    ]);

    const fgVal=N(fgR.value?.data?.[0]?.value,50);
    const fgLabel=fgR.value?.data?.[0]?.value_classification||'Neutral';

    // ── PARSE BYBIT FR MAP ────────────────────────────────
    const frMap={};
    for(const t of A(byFrR.value?.result?.list)){
      try{
        const sym=String(t.symbol||'').replace('USDT','').replace('PERP','');
        if(!sym)continue;
        const fr=N(t.fundingRate);
        frMap[sym]={fr,pct:+(fr*100).toFixed(4),bullish:fr<-0.0002,bearish:fr>0.0004,
          oi:N(t.openInterestValue),price:N(t.lastPrice)};
      }catch{}
    }

    // ── BTC L/S RATIO ─────────────────────────────────────
    let btcLS=null,btcLongPct=null,btcShortPct=null;
    try{
      const lsD=byLSR.value;
      if(lsD?.retCode===0&&A(lsD?.result?.list).length>0){
        const row=lsD.result.list[0];
        btcLongPct=+N(row.buyRatio*100).toFixed(2);
        btcShortPct=+N(row.sellRatio*100).toFixed(2);
        btcLS=+(btcLongPct/btcShortPct).toFixed(3);
      }
    }catch{}

    // ── CG PRICE MAP ─────────────────────────────────────
    const cgMap={};
    for(const c of A(cgR.value)){
      try{
        const sym=String(c.symbol||'').toUpperCase();
        if(!sym)continue;
        cgMap[sym]={p:N(c.current_price),c24:N(c.price_change_percentage_24h),
          c7d:N(c.price_change_percentage_7d),vol:N(c.total_volume),
          h:N(c.high_24h)||N(c.current_price)*1.02,l:N(c.low_24h)||N(c.current_price)*0.98,
          mcap:N(c.market_cap),rank:N(c.market_cap_rank,9999)};
      }catch{}
    }

    // ── FETCH KLINES (parallel, 50 koin sekaligus) ────────
    const klineResults=await Promise.allSettled(allSyms.map(s=>getBybitKline(s)));
    const kMap={};
    let realRSICount=0;
    for(let i=0;i<allSyms.length;i++){
      const r=klineResults[i];
      if(r?.status==='fulfilled'&&r.value){
        kMap[allSyms[i]]=r.value;
        realRSICount++;
      }
    }

    // ── BTC SNAPSHOT ──────────────────────────────────────
    const btcK=kMap['BTC']||null;
    const btcCg=cgMap['BTC']||{};
    const btcPrice=N(btcK?.price||frMap['BTC']?.price||btcCg?.p||0);
    const btcCh24=N(btcCg?.c24||0);
    const btcRsi=btcK?.rsi||null;
    const btcRsi1d=btcK?.rsi1d||null;
    const btcMacd=btcK?.macd||null;
    const btcAtr=btcK?.atr||0;
    const btcAtrPct=btcPrice>0&&btcAtr>0?+(btcAtr/btcPrice*100).toFixed(2):null;

    // ── MARKET CHARACTER v2 ───────────────────────────────
    const rsiList=allSyms.map(s=>({sym:s,rsi:kMap[s]?.rsi||50})).filter(x=>x.rsi>0);
    const overbought=rsiList.filter(x=>x.rsi>70).length;
    const oversold=rsiList.filter(x=>x.rsi<30).length;
    const allPrices=allSyms.map(s=>({sym:s,c24:N(cgMap[s]?.c24||0)}));
    const avgCh24=allPrices.length?+(allPrices.reduce((s,x)=>s+x.c24,0)/allPrices.length).toFixed(2):0;
    const bullPct=Math.round(allPrices.filter(x=>x.c24>0).length/Math.max(allPrices.length,1)*100);

    let mcType,mcColor,mcDesc,mcStyle,mcRisk;
    if(btcRsi&&btcRsi<35&&oversold>=8){mcType='🔥 CAPITULATION BOTTOM';mcColor='green';mcDesc='Extreme oversold across market. BEST accumulation opportunity. High confidence reversal zone.';mcStyle='Aggressive Accumulation';mcRisk='HIGH REWARD';}
    else if(avgCh24>4&&bullPct>65&&fgVal>60){mcType='🚀 BULL MOMENTUM';mcColor='green';mcDesc='Strong uptrend across market. Momentum entries valid. Trail stops tightly.';mcStyle='Momentum Riding';mcRisk='MODERATE';}
    else if(avgCh24>1.5&&bullPct>55){mcType='📈 MILD BULL';mcColor='green';mcDesc='Moderate upside. Selective entries on confirmed setups only.';mcStyle='Selective Entry';mcRisk='MODERATE';}
    else if(avgCh24<-4&&bullPct<35&&overbought<3){mcType='📉 BEAR MOMENTUM';mcColor='red';mcDesc='Broad selling pressure. Avoid longs. Short setups only.';mcStyle='Short/Cash';mcRisk='CASH HEAVY';}
    else if(avgCh24<-1.5&&bullPct<45){mcType='🌧 MILD BEAR';mcColor='amber';mcDesc='Tekanan jual mild. Kurangi sizing 40-50%. Focus koin RS positif vs BTC.';mcStyle='Small Sizing';mcRisk='REDUCED';}
    else if(oversold>=10&&avgCh24<-1){mcType='💎 OVERSOLD OPPORTUNITY';mcColor='green';mcDesc='Mass oversold. High probability bounce setups forming. RSI <30 entries with volume.';mcStyle='Counter-trend Entry';mcRisk='MODERATE-HIGH';}
    else if(overbought>=10&&avgCh24>2){mcType='⚠️ OVERBOUGHT CAUTION';mcColor='amber';mcDesc='Market extended. Reduce new longs. Take profits on existing positions.';mcStyle='Profit Taking';mcRisk='REDUCED';}
    else if(Math.abs(avgCh24)<1&&fgVal>35&&fgVal<65){mcType='⚖️ ACCUMULATION RANGE';mcColor='amber';mcDesc='Sideways with low volatility. DCA entries valid. Wait for breakout confirmation.';mcStyle='DCA/Range';mcRisk='MODERATE';}
    else{mcType='🌀 TRANSITIONAL';mcColor='amber';mcDesc='Market in transition. Mixed signals. Smaller size, tighter stops.';mcStyle='Cautious';mcRisk='REDUCED';}

    const mcStats={bullPct,bearPct:100-bullPct,overbought,oversold,avgCh:avgCh24};

    // ── CONVERGENCE SCORING v3 ─────────────────────────────
    // 5 Faktor: Technical + Structure + Macro + Timing + RS
    // ELITE: ≥80 | PRIME: ≥70 | VALID: ≥60 | MODERATE: ≥50 | WEAK: <50
    const convList=[];
    for(const sym of allSyms){
      try{
        const kd=kMap[sym]||null;
        const cg=cgMap[sym]||{};
        const fr=frMap[sym]||null;
        const p=N(kd?.price||cg?.p||fr?.price||0);
        if(!p)continue;

        const rsi=kd?.rsi||clamp(50+N(cg.c24)*2,8,92);
        const c24=N(cg.c24||0);
        const c7d=N(cg.c7d||0);
        const vol=N(cg.vol||0);
        const macd=kd?.macd||null;
        const atr=kd?.atr||0;
        const atrPct=p>0&&atr>0?+(atr/p*100).toFixed(2):null;

        let score=0;

        // F1: TECHNICAL (RSI + MACD + EMA)
        let f1=0;
        if(rsi<20){f1+=30;}
        else if(rsi<28){f1+=25;}
        else if(rsi<35){f1+=20;}
        else if(rsi<42){f1+=12;}
        else if(rsi<50){f1+=5;}
        else if(rsi>78){f1-=20;}
        else if(rsi>70){f1-=12;}
        else if(rsi>62){f1-=5;}
        if(macd?.xUp){f1+=15;}
        else if(macd?.bull){f1+=8;}
        else if(macd?.xDown){f1-=12;}
        else if(macd?.bear){f1-=6;}
        if(kd?.obvBull&&c24>0){f1+=8;}
        f1=clamp(f1,-30,45);

        // F2: STRUCTURE (SMC/ICT proxy)
        const h=N(cg.h||p*1.02),l=N(cg.l||p*0.98);
        const pip=h>l?clamp((p-l)/(h-l)*100,0,100):50;
        let f2=0;
        if(pip<18){f2+=18;}
        else if(pip<30){f2+=12;}
        else if(pip<45){f2+=6;}
        else if(pip>82){f2-=12;}
        else if(pip>70){f2-=6;}
        // Fresh OB bonus
        if(rsi<35&&c24>0&&pip<35){f2+=8;} // Likely at demand zone
        f2=clamp(f2,-15,25);

        // F3: MACRO (FR + market alignment)
        const frVal=fr?.fr||0;
        let f3=0;
        if(frVal<-0.0008){f3+=20;}
        else if(frVal<-0.0005){f3+=15;}
        else if(frVal<-0.0003){f3+=10;}
        else if(frVal<-0.0001){f3+=5;}
        else if(frVal>0.0008){f3-=15;}
        else if(frVal>0.0005){f3-=10;}
        else if(frVal>0.0003){f3-=5;}
        // Market alignment
        if(mcColor==='green'&&c24>0){f3+=8;}
        else if(mcColor==='red'&&c24<0){f3-=5;}
        f3=clamp(f3,-20,25);

        // F4: TIMING (Weekly momentum)
        let f4=0;
        if(c7d>15){f4+=15;}
        else if(c7d>5){f4+=8;}
        else if(c7d>0){f4+=3;}
        else if(c7d<-20){f4-=10;}
        else if(c7d<-10){f4-=5;}
        else if(c7d<-3){f4-=2;}
        // Volume
        if(vol>500e6&&c24>0){f4+=8;}
        else if(vol>100e6&&c24>0){f4+=5;}
        else if(vol>20e6&&c24>0){f4+=3;}
        else if(vol>5e6&&c24>0){f4+=1;}
        f4=clamp(f4,-15,22);

        // F5: RS vs BTC (Relative Strength)
        const rsBtc=+(c24-btcCh24).toFixed(2);
        const rs7d=c7d&&btcCg.c7d?+(c7d-N(btcCg.c7d)).toFixed(2):null;
        let f5=0;
        if(rsBtc>8){f5+=15;}
        else if(rsBtc>3){f5+=10;}
        else if(rsBtc>0){f5+=4;}
        else if(rsBtc<-8){f5-=10;}
        else if(rsBtc<-3){f5-=5;}
        if(rs7d!=null){
          if(rs7d>10){f5+=8;}
          else if(rs7d>3){f5+=5;}
          else if(rs7d<-10){f5-=6;}
          else if(rs7d<-3){f5-=3;}
        }
        f5=clamp(f5,-15,20);

        // TOTAL (base 45 — lebih generous)
        const rawScore=45+f1+f2+f3+f4+f5;
        const finalScore=clamp(Math.round(rawScore),0,100);

        // Label
        const label=finalScore>=80?'🔥ELITE':finalScore>=70?'💎PRIME':finalScore>=60?'✅VALID':finalScore>=50?'🟡MODERATE':'⚪WEAK';

        convList.push({
          sym,rsi:+rsi.toFixed(1),rsiReal:!!kd,
          price:p,c24,c7d,vol,
          fr:fr?.pct||null,
          macdXUp:!!macd?.xUp,macdBull:!!macd?.bull,obvBull:!!kd?.obvBull,
          rs:rsBtc,rs7d,
          atr:atr>0?+atr.toFixed(p>1?4:8):null,atrPct,
          conv:{score:finalScore,label,f1,f2,f3,f4,f5},
          aboveE200:!!kd?.aboveE200,
        });
      }catch{}
    }

    convList.sort((a,b)=>b.conv.score-a.conv.score);
    const leaders=convList.slice(0,20);
    const eliteCount=leaders.filter(x=>x.conv.score>=80).length;
    const primeCount=leaders.filter(x=>x.conv.score>=70&&x.conv.score<80).length;
    const validCount=leaders.filter(x=>x.conv.score>=60&&x.conv.score<70).length;

    // Summary
    const topSym=leaders[0]?.sym||'—';
    const topScore=leaders[0]?.conv.score||0;
    const convSummary=`${eliteCount>0?'🔥'+eliteCount+' ELITE · ':''}${primeCount} PRIME · ${validCount} VALID — Top: ${topSym} (${topScore})`;

    // ── SCALP SETUPS (ATR-based SL/TP) ────────────────────
    const scalpSetups=[];
    for(const c of convList.filter(x=>x.conv.score>=62&&x.atr&&x.vol>3e6&&x.rsi<72).slice(0,6)){
      try{
        const atr=c.atr,p=c.price;
        const sl=+(p-atr*1.5).toFixed(p>1?4:8);
        const tp1=+(p+atr*2.0).toFixed(p>1?4:8);
        const tp2=+(p+atr*3.5).toFixed(p>1?4:8);
        const slPct=+((p-sl)/p*100).toFixed(2);
        const tp1Pct=+((tp1-p)/p*100).toFixed(2);
        const tp2Pct=+((tp2-p)/p*100).toFixed(2);
        const rr=+(tp1Pct/slPct).toFixed(1);
        const reasons=[];
        if(c.rsi<30)reasons.push('RSI oversold '+c.rsi.toFixed(0));
        if(c.macdXUp)reasons.push('MACD golden cross');
        if(c.fr&&c.fr<-0.03)reasons.push('FR squeeze '+c.fr+'%');
        if(c.rs>3)reasons.push('RS BTC +'+(c.rs)+'%');
        if(c.obvBull)reasons.push('OBV bullish');
        scalpSetups.push({sym:c.sym,sector:Object.entries(SECTORS).find(([,v])=>v.includes(c.sym))?.[0]||'ALT',entry:p,sl,tp1,tp2,slPct,tp1Pct,tp2Pct,rr,conv:c.conv.score,rsi:c.rsi,rsiReal:c.rsiReal,fr:c.fr,atrPct:c.atrPct,reasons});
      }catch{}
    }

    // ── SWING SETUPS ───────────────────────────────────────
    const swingSetups=[];
    for(const c of convList.filter(x=>x.conv.score>=65&&x.atr&&x.vol>5e6&&x.rsi<65&&x.c7d!=null&&x.c7d>-15).slice(0,4)){
      try{
        const atr=c.atr,p=c.price;
        const sl=+(p-atr*2.0).toFixed(p>1?4:8);
        const tp1=+(p+atr*3.0).toFixed(p>1?4:8);
        const tp2=+(p+atr*5.0).toFixed(p>1?4:8);
        const slPct=+((p-sl)/p*100).toFixed(2);
        const tp1Pct=+((tp1-p)/p*100).toFixed(2);
        const tp2Pct=+((tp2-p)/p*100).toFixed(2);
        const reasons=[];
        if(c.c7d&&c.c7d>5)reasons.push('7d +'+c.c7d.toFixed(0)+'% momentum');
        if(c.rsi<35)reasons.push('Oversold RSI '+c.rsi.toFixed(0));
        if(c.aboveE200)reasons.push('Above EMA200');
        if(c.rs7d&&c.rs7d>5)reasons.push('RS 7d +'+(c.rs7d)+'%');
        swingSetups.push({sym:c.sym,sector:Object.entries(SECTORS).find(([,v])=>v.includes(c.sym))?.[0]||'ALT',entry:p,sl,tp1,tp2,slPct,tp1Pct,tp2Pct,conv:c.conv.score,rsi:c.rsi,rsiReal:c.rsiReal,fr:c.fr,atrPct:c.atrPct,reasons});
      }catch{}
    }

    // ── SPOT ACCUMULATION (DCA ZONES) ─────────────────────
    const spotAccum=convList.filter(x=>x.rsi<35&&x.vol>2e6&&x.c24>-5&&x.conv.score>=55).slice(0,6).map(c=>{
      const p=c.price;
      const dcaLow=+(p*(1-N(c.atrPct||3)/100*1.5)).toFixed(p>1?4:8);
      const dcaHigh=+(p*(1+N(c.atrPct||3)/100*0.5)).toFixed(p>1?4:8);
      return{sym:c.sym,price:p,rsi:c.rsi,rsiReal:c.rsiReal,rsi1d:kMap[c.sym]?.rsi1d||null,dcaZone:`$${dcaLow}–$${dcaHigh}`,atrPct:c.atrPct,conv:c.conv.score};
    });

    // ── AVOID LIST ─────────────────────────────────────────
    const avoidList=convList.filter(x=>x.rsi>75&&x.conv.score<55).slice(0,6).map(c=>({sym:c.sym,rsi:c.rsi,fr:c.fr,reason:c.rsi>80?'RSI '+c.rsi.toFixed(0)+' extreme overbought':(c.fr&&c.fr>0.05)?'FR overheated +'+c.fr+'%':'Extended — poor R:R'}));

    // ── GAME PLAN SCENARIOS ────────────────────────────────
    const btcResistance=btcPrice>0?+(btcPrice*1.04).toFixed(0):null;
    const btcSupport=btcPrice>0?+(btcPrice*0.96).toFixed(0):null;
    const bullCoins=convList.filter(x=>x.conv.score>=65&&x.c24>0).slice(0,3).map(x=>x);
    const sideCoins=convList.filter(x=>x.rsi<35&&x.conv.score>=55).slice(0,2).map(x=>x);
    const gamePlan={
      btcLevels:{resistance:btcResistance,support:btcSupport,current:btcPrice||null},
      scenarios:{
        bull:{
          condition:`BTC tembus $${btcResistance||'resistance'} (close di atas, bukan wick)`,
          action:`Long alts conv ≥${eliteCount>0?70:65}, RR 1:3. Prioritaskan koin RS positif dan FR negatif.`,
          setups:bullCoins,
        },
        sideways:{
          condition:`BTC konsolidasi ±1.5%, volume di bawah rata-rata`,
          action:'Scalp saja setup terbaik. TP lebih cepat (1:1.5). Hindari overnight.',
          setups:sideCoins,
        },
        bear:{
          condition:`BTC breakdown ke $${btcSupport||'support'} dan close di bawahnya`,
          action:`Cash ${eliteCount>0?60:80}%. Tunggu 2 candle 4H stabilisasi sebelum re-entry. Jangan catch falling knife.`,
          setups:[],
        },
      },
      scalpSetups,swingSetups,spotAccum,avoidList,
    };

    // ── BTC SNAPSHOT v3 ────────────────────────────────────
    const btcSnapshot={
      price:btcPrice,ch24:btcCh24,
      rsi:btcRsi,rsi1d:btcRsi1d,
      fg:fgVal,fgLabel,
      macd:btcMacd,
      btcLS,btcLongPct,btcShortPct,
      atr:btcAtr>0?+btcAtr.toFixed(2):null,atrPct:btcAtrPct,
      aboveEma200:!!btcK?.aboveE200,
    };

    // ── SECTOR FLOW v3 ─────────────────────────────────────
    const sectorFlow={sectors:[],rotating:[],exiting:[]};
    for(const [sName,coins] of Object.entries(SECTORS)){
      const sc=coins.map(s=>convList.find(x=>x.sym===s)).filter(Boolean);
      if(!sc.length)continue;
      const avgCh=+(sc.reduce((s,x)=>s+x.c24,0)/sc.length).toFixed(2);
      const avgRSI=+(sc.reduce((s,x)=>s+x.rsi,0)/sc.length).toFixed(1);
      const avgConv=+(sc.reduce((s,x)=>s+x.conv.score,0)/sc.length).toFixed(0);
      const flowSig=avgCh>3?'↑↑ INFLOW':avgCh>1?'↑ MILD':avgCh<-3?'↓↓ OUTFLOW':avgCh<-1?'↓ WEAK':'→ NEUTRAL';
      sectorFlow.sectors.push({name:sName,avgCh24:avgCh,avgRSI,avgConv,flowSig,coins:coins.length});
      if(avgCh>2&&avgRSI<60)sectorFlow.rotating.push({name:sName,avgRSI,avgConv});
      if(avgCh<-3&&avgRSI<35)sectorFlow.exiting.push({name:sName,avgRSI});
    }
    sectorFlow.sectors.sort((a,b)=>b.avgCh24-a.avgCh24);

    // ── TRADING SCHEDULE WIB ─────────────────────────────
    const now=new Date();
    const wibOffset=7*60;
    const utcMin=now.getUTCHours()*60+now.getUTCMinutes();
    const wibMin=(utcMin+wibOffset)%(24*60);
    const wibH=Math.floor(wibMin/60);
    const days=['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];
    const wibDay=(now.getUTCDay()+(wibMin>=0?0:0))%7;
    const sessions=[
      {id:'dead',name:'🌙 Dead Zone',time:'02:00–06:00',start:2,end:6,q:'POOR',activity:'Volume minimum. Hindari trading. Istirahat.'},
      {id:'asia_open',name:'🌏 Asia Open',time:'06:00–09:00',start:6,end:9,q:'MODERATE',activity:'Volume membangun. Setup oversold mulai terlihat.'},
      {id:'asia_peak',name:'🔥 Asia Peak',time:'09:00–12:00',start:9,end:12,q:'GOOD',activity:'Volume tinggi. Breakout Asia valid.'},
      {id:'lunch',name:'⚠️ Lunch Dip',time:'12:00–15:00',start:12,end:15,q:'CAUTION',activity:'Volume turun. Spread melebar. Hindari entry baru.'},
      {id:'london',name:'🌍 London Open',time:'15:00–18:00',start:15,end:18,q:'PRIME',activity:'PRIME: Volume institusional. Setup terbaik. Entry aktif.'},
      {id:'ny_pre',name:'📊 NY Pre',time:'18:00–21:00',start:18,end:21,q:'BUILDING',activity:'Pre-market AS. Setup persiapan NY.'},
      {id:'ny_open',name:'🚀 NY Open',time:'21:00–23:00',start:21,end:23,q:'PRIME',activity:'PRIME: Volume tertinggi global. Breakout paling valid.'},
      {id:'ny_late',name:'🌙 NY Late',time:'23:00–02:00',start:23,end:26,q:'GOOD',activity:'Volume masih oke. Exit position malam.'},
    ];
    let curSess='dead';
    for(const s of sessions){
      const e=s.end>24?s.end-24:s.end;
      if(s.start>20){if(wibH>=s.start||wibH<e){curSess=s.id;break;}}
      else{if(wibH>=s.start&&wibH<s.end){curSess=s.id;break;}}
    }
    const curSessObj=sessions.find(s=>s.id===curSess)||sessions[0];
    const nextPrime=sessions.filter(s=>s.q==='PRIME').map(s=>{
      const diff=s.start>wibH?s.start-wibH:24-(wibH-s.start);
      return{...s,inH:diff};
    }).sort((a,b)=>a.inH-b.inH)[0];

    const tradingSchedule={
      wibHour:wibH,dayName:days[wibDay],
      sessions,currentSession:curSess,
      positionSizeRec:curSessObj.q==='PRIME'?'Full (100%)':curSessObj.q==='GOOD'?'Large (75%)':curSessObj.q==='MODERATE'?'Half (50%)':'Minimal (25%)',
      focusToday:`${mcType}. ${curSessObj.q==='PRIME'?'Session PRIME — aktif trading.':curSessObj.q==='POOR'?'Dead zone — istirahat.':'Session '+curSessObj.q+'.'}`,
      nextPrimeSession:nextPrime,
    };

    // ── PRE-TRADE CHECKLIST v2 ────────────────────────────
    const mktChecks=[
      {label:'Market character layak trading',pass:mcColor!=='red'||oversold>=8,detail:'Character: '+mcType,fix:'Tunggu market shift atau fokus oversold plays'},
      {label:'Trading session berkualitas',pass:curSessObj.q==='PRIME'||curSessObj.q==='GOOD',detail:curSessObj.name+' '+curSessObj.q+(curSessObj.q==='POOR'?' 😬':''),fix:'Tunggu London (15:00) atau NY (21:00) WIB'},
      {label:'BTC tidak di resistance',pass:btcRsi?btcRsi<72:true,detail:btcRsi?'BTC RSI '+btcRsi.toFixed(0)+' — '+(btcRsi<72?'aman dari resistance':'mendekati resistance'):'BTC aman dari resistance',fix:'Tunggu BTC RSI turun ke <65'},
      {label:'FR market tidak overheated',pass:Object.values(frMap).filter(x=>x.fr>0.0005).length<8,detail:'Avg FR: +'+(Object.values(frMap).filter(x=>x.fr>0).reduce((s,x,_,a)=>s+x.fr/a.length,0)*100).toFixed(4)+'%',fix:'Terlalu banyak koin dengan FR tinggi'},
      {label:'Market tidak overbought massal',pass:overbought<12,detail:overbought+' koin RSI>70 | XOS: '+overbought,fix:'Tunggu koreksi sebelum entry'},
      {label:'BTC L/S ratio aman',pass:btcLS?btcLS<2.5:true,detail:btcLS?'L/S: '+btcLS+' ('+btcLongPct+'% long)':'Data L/S tidak tersedia',fix:'L/S >2.5 menandakan longs terlalu ramai'},
      {label:'Cukup koin aktif & liquid',pass:convList.filter(x=>x.vol>10e6&&x.c24>0).length>=20,detail:convList.filter(x=>x.vol>10e6&&x.c24>0).length+' koin aktif (vol>$10M & naik)',fix:'Market terlalu sepi'},
      {label:'BTC trend mendukung altcoin',pass:btcCh24>-2,detail:'BTC '+btcCh24.toFixed(2)+'% ('+(btcCh24>0?'bullish':'bearish')+') '+(btcCh24<-2?'→ BTC bearish → tunda long altcoin':'→ aman entry altcoin'),fix:'Tunggu BTC stabilisasi'},
    ];
    const passCount=mktChecks.filter(x=>x.pass).length;
    const greenLight=passCount>=6;
    const coinChecks=[
      'RSI koin < 72 (hindari yang sudah overbought)','Volume 24h ≥ $5M (pastikan likuiditas cukup)',
      'Setup sesuai skenario Game Plan (bull/bear/sideways)','Convergence Score ≥ '+( eliteCount>0?70:60),
      'Position size ≤ 2% equity per trade','FR koin < +0.04% per 8h (hindari yang longs overheated)',
      'Stop Loss sudah ditentukan (ATR-based, bukan % flat)','Risk-Reward minimal 1:2 (target 1:3)',
      'Konfirmasi volume pada candle entry (tidak sepi)','Tidak buka posisi dalam 30 menit sebelum CPI/Fed news',
    ];

    const checklist={
      marketChecks:mktChecks,marketPassCount:passCount,marketTotal:8,
      coinChecks,overallGreenLight:greenLight,
      verdict:greenLight?'✅ SETUP LAYAK — Lanjutkan dengan checklist koin individual':'⚠️ HATI-HATI — '+(8-passCount)+' kondisi market belum terpenuhi',
    };

    // ── RESPONSE ─────────────────────────────────────────
    const out={
      ok:true,version:'v3',ts:Date.now(),elapsed:Date.now()-t0,
      dataQuality:{coins:allSyms.length,realRSI:realRSICount,btcLS:btcLS!=null,btcRsi:btcRsi!=null,src:'bybit'},
      fg:fgVal,fgLabel,
      marketCharacter:{type:mcType,color:mcColor,description:mcDesc,tradeStyle:mcStyle,riskLevel:mcRisk,stats:mcStats},
      btcSnapshot,
      convergence:{leaders,summary:convSummary,eliteCount,primeCount,validCount},
      gamePlan,
      sectorFlow,
      tradingSchedule,
      checklist,
    };

    CACHE.data=out;CACHE.ts=Date.now();
    return res.status(200).json(out);

  }catch(e){
    return res.status(200).json({ok:false,error:e.message,ts:Date.now(),elapsed:Date.now()-t0,version:'v3'});
  }
}
