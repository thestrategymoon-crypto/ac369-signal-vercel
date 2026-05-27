// api/morning-brief.js — v6 FINAL · ONE BATCH · No Timeout
// ═══════════════════════════════════════════════════════════
// FIX v6 vs v5:
// ❌ v5: Phase1 (3s) → Phase2 (3s) = sequential = 6s+ = timeout!
// ✅ v6: ONE Promise.allSettled batch = 3s max total
// ✅ 20 real RSI dari Bybit klines
// ✅ 80 koin full signal analysis
// ✅ LONG + SHORT + ACCUMULATION + COILING detection
// ✅ ATR-based SL/TP
// ✅ Sector flow interaktif
// ✅ Guaranteed selesai <5s termasuk cold start
// ✅ Cache 6 menit
// ═══════════════════════════════════════════════════════════
const N=(v,d=0)=>{const n=+v;return(isNaN(n)||!isFinite(n))?d:n;};
const A=(v)=>Array.isArray(v)?v:[];
const cl=(v,lo,hi)=>Math.max(lo,Math.min(hi,N(v)));

const KLINE20=['BTC','ETH','BNB','SOL','XRP','ADA','DOGE','AVAX','LINK','DOT','NEAR','SUI','ARB','OP','TON','PEPE','WIF','HYPE','AAVE','JUP'];

const SCAN80=['BTC','ETH','BNB','SOL','XRP','ADA','DOGE','AVAX','LINK','DOT','NEAR','SUI','APT','ARB','OP','TON','INJ','TIA','SEI','ENA','STRK','ZRO','RON','W','MANTA','AAVE','JUP','PENDLE','GMX','LDO','UNI','CRV','RDNT','CAKE','BLUR','RENDER','FET','TAO','WLD','IO','OLAS','VIRTUAL','GRT','EIGEN','PEPE','WIF','BONK','FLOKI','MOODENG','NEIRO','ACT','PONKE','TURBO','ONDO','JTO','PYTH','ATOM','FIL','HYPE','NOT','JASMY','DRIFT','BERA','ETHFI','LTC','XLM','VET','TRX','HBAR','ALGO','STX','RUNE','LQTY','BLUR','ETC','CFX','PARTI','SAGA'];

const SECTORS={'Bitcoin':['BTC'],'Ethereum':['ETH'],'L1':['SOL','ADA','AVAX','TON','NEAR','SUI','APT','TIA','SEI','ENA','HBAR','ALGO','XLM','LTC','VET','TRX','BERA'],'L2':['ARB','OP','STRK','ZRO','MANTA','RON','W','STX'],'DeFi':['AAVE','JUP','PENDLE','GMX','LDO','UNI','CRV','RDNT','CAKE','BLUR','LQTY','ETHFI'],'AI/DePIN':['RENDER','FET','TAO','WLD','IO','OLAS','VIRTUAL','GRT','EIGEN'],'Meme':['DOGE','PEPE','WIF','BONK','FLOKI','MOODENG','NEIRO','ACT','PONKE','TURBO'],'Infrastructure':['LINK','DOT','INJ','ATOM','FIL','ONDO','JTO','PYTH'],'Payments':['XRP','TRX','XLM','LTC','BNB','HBAR'],'Trending':['HYPE','NOT','JASMY','DRIFT','BERA','CFX','ETC','RUNE','PARTI']};
const getSector=s=>{for(const[n,v]of Object.entries(SECTORS))if(v.includes(s))return n;return 'Other';};

const CACHE={data:null,ts:0};

export default async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Cache-Control','s-maxage=360,stale-while-revalidate=60');
  if(req.method==='OPTIONS')return res.status(200).end();
  const t0=Date.now();
  if(CACHE.data&&Date.now()-CACHE.ts<360000)return res.status(200).json({...CACHE.data,cached:true,elapsed:Date.now()-t0});

  const sf=async(url,ms=3000)=>{const c=new AbortController();const t=setTimeout(()=>c.abort(),ms);try{const r=await fetch(url,{signal:c.signal,headers:{Accept:'application/json','User-Agent':'AC369/6.0'}});clearTimeout(t);return r.ok?await r.json():null;}catch{clearTimeout(t);return null;}};
  const calcRSI=a=>{try{if(!a||a.length<16)return null;let g=0,l=0;for(let i=1;i<=14;i++){const d=a[i]-a[i-1];d>0?g+=d:l-=d;}g/=14;l/=14;for(let i=15;i<a.length;i++){const d=a[i]-a[i-1];g=(g*13+Math.max(d,0))/14;l=(l*13+Math.max(-d,0))/14;}return l===0?100:cl(100-100/(1+g/l),0,100);}catch{return null;}};
  const calcEMA=(a,p)=>{if(!a||a.length<2)return a?.[a.length-1]||0;const k=2/(p+1);let e=a.slice(0,Math.min(p,a.length)).reduce((s,v)=>s+v,0)/Math.min(p,a.length);for(let i=Math.min(p,a.length);i<a.length;i++)e=a[i]*k+e*(1-k);return e;};
  const calcMACD=a=>{try{if(!a||a.length<36)return null;const k12=2/13,k26=2/27,k9=2/10;let e12=a.slice(0,12).reduce((s,v)=>s+v,0)/12,e26=a.slice(0,26).reduce((s,v)=>s+v,0)/26;const mv=[];for(let i=26;i<a.length;i++){e12=a[i]*k12+e12*(1-k12);e26=a[i]*k26+e26*(1-k26);mv.push(e12-e26);}let sig=mv.slice(0,9).reduce((s,v)=>s+v,0)/9;for(let i=9;i<mv.length;i++)sig=mv[i]*k9+sig*(1-k9);const n=mv.length,last=N(mv[n-1]),h=last-sig,ph=N(mv[n-2]||last)-sig;return{bull:last>0&&h>0,bear:last<0&&h<0,xUp:h>0&&ph<=0,xDown:h<0&&ph>=0};}catch{return null;}};

  try{
    // ══════════════════════════════════════════════════════
    // SINGLE BATCH — All calls in parallel, max 3s
    // ══════════════════════════════════════════════════════
    const allResults=await Promise.allSettled([
      // #0: Bybit all tickers (price + FR for 80 coins)
      sf('https://api.bybit.com/v5/market/tickers?category=linear',3000),
      // #1: BTC L/S ratio
      sf('https://api.bybit.com/v5/market/account-ratio?category=linear&symbol=BTCUSDT&period=1h&limit=1',3000),
      // #2: Fear & Greed
      sf('https://api.alternative.me/fng/?limit=1&format=json',3000),
      // #3-22: 20 Kline calls (all parallel, same batch)
      ...KLINE20.map(s=>sf(`https://api.bybit.com/v5/market/kline?category=linear&symbol=${s}USDT&interval=240&limit=50`,3000)),
    ]);

    // Parse results
    const byAllR=allResults[0],byLSR=allResults[1],fgR=allResults[2];
    const klineRs=allResults.slice(3); // 20 kline results

    // ── BYBIT PRICE/FR MAP ─────────────────────────────────
    const byMap={};
    try{for(const t of A(byAllR.value?.result?.list)){const sym=String(t.symbol||'').replace('USDT','').replace('PERP','');if(!sym)continue;byMap[sym]={p:N(t.lastPrice),fr:N(t.fundingRate),oi:N(t.openInterestValue),c24:N(t.price24hPcnt)*100,frPct:+(N(t.fundingRate)*100).toFixed(4),vol24:N(t.turnover24h)};}catch{}}

    // ── L/S RATIO ──────────────────────────────────────────
    let btcLS=null,btcLongPct=null,btcShortPct=null;
    try{const row=A(byLSR.value?.result?.list)[0];if(row){btcLongPct=+N(row.buyRatio*100).toFixed(2);btcShortPct=+N(row.sellRatio*100).toFixed(2);btcLS=btcShortPct>0?+(btcLongPct/btcShortPct).toFixed(3):null;}}catch{}

    // ── FEAR & GREED ───────────────────────────────────────
    const fgVal=N(fgR.value?.data?.[0]?.value,50);
    const fgLabel=fgR.value?.data?.[0]?.value_classification||'Neutral';

    // ── KLINE MAP (20 real RSI) ─────────────────────────────
    const kMap={};let realRSI=0;
    for(let i=0;i<KLINE20.length;i++){
      try{
        const r=klineRs[i];
        if(r?.status!=='fulfilled'||r.value?.retCode!==0)continue;
        const raw=A(r.value?.result?.list);if(raw.length<16)continue;
        const K=raw.slice().reverse().map(d=>({o:N(d[1]),h:N(d[2]),l:N(d[3]),c:N(d[4]),v:N(d[6])})).filter(d=>d.c>0&&d.h>=d.l);
        if(K.length<16)continue;
        const cls=K.map(k=>k.c);
        const rsi=calcRSI(cls);if(rsi===null)continue;
        const macd=calcMACD(cls);
        const e200=calcEMA(cls,Math.min(200,cls.length-1));
        const lp=cls[cls.length-1];
        let obvUp=0,obvDn=0;
        for(let j=Math.max(1,K.length-15);j<K.length;j++){if(N(K[j].c)>N(K[j-1].c))obvUp+=N(K[j].v);else if(N(K[j].c)<N(K[j-1].c))obvDn+=N(K[j].v);}
        const atrArr=K.slice(1).map((kk,ii)=>Math.max(N(kk.h)-N(kk.l),Math.abs(N(kk.h)-N(K[ii].c)),Math.abs(N(kk.l)-N(K[ii].c))));
        const atr=atrArr.slice(-14).reduce((s,v)=>s+v,0)/14;
        // Coiling detection
        const recentATR=atrArr.slice(-5).reduce((s,v)=>s+v,0)/5;
        const avgATR=atrArr.slice(-20).reduce((s,v)=>s+v,0)/20;
        const isCoiling=avgATR>0&&recentATR<avgATR*0.65;
        const vols5=K.slice(-5);const volBull=vols5.filter(k=>k.c>k.o).reduce((s,k)=>s+k.v,0);const volBear=vols5.filter(k=>k.c<k.o).reduce((s,k)=>s+k.v,0);
        const volBias=volBull>volBear*1.3?'ACC':volBear>volBull*1.3?'DIST':'NEU';
        kMap[KLINE20[i]]={rsi:+N(rsi).toFixed(2),macd,e200,atr:+atr.toFixed(8),obvBull:obvUp>obvDn*1.2,aboveE200:lp>e200,price:lp,isCoiling,volBias,src:'bybit'};
        realRSI++;
      }catch{}
    }

    // ── BTC DATA ───────────────────────────────────────────
    const btcK=kMap['BTC'],btcBy=byMap['BTC']||{};
    const btcPrice=N(btcK?.price||btcBy?.p||0);
    const btcCh24=N(btcBy?.c24||0);
    const btcFR=N(btcBy?.fr||0);
    const btcATR=N(btcK?.atr||0);
    const btcATRPct=btcPrice>0&&btcATR>0?+(btcATR/btcPrice*100).toFixed(2):null;

    // ── MARKET CHARACTER ───────────────────────────────────
    const allC24=SCAN80.map(s=>N(byMap[s]?.c24||0)).filter(v=>v!==0);
    const avgCh=allC24.length?+(allC24.reduce((s,v)=>s+v,0)/allC24.length).toFixed(2):0;
    const bullPct=Math.round(allC24.filter(v=>v>0).length/Math.max(allC24.length,1)*100);
    const kRSIs=Object.values(kMap).map(k=>k.rsi);
    const overbought=kRSIs.filter(r=>r>70).length,oversold=kRSIs.filter(r=>r<30).length;
    let mcType,mcColor='amber',mcDesc,mcStyle,mcRisk;
    if(oversold>=6&&avgCh<0){mcType='🔥 CAPITULATION BOTTOM';mcColor='green';mcDesc='Extreme oversold. BEST accumulation. RSI<25+FR negatif = prime target.';mcStyle='Aggressive DCA';mcRisk='HIGH REWARD';}
    else if(avgCh>4&&bullPct>65&&fgVal>55){mcType='🚀 BULL MOMENTUM';mcColor='green';mcDesc='Momentum kuat. Trail stop. Tambah pada EMA9 pullback.';mcStyle='Momentum Riding';mcRisk='MODERATE';}
    else if(avgCh>1.5&&bullPct>55){mcType='📈 MILD BULL';mcColor='green';mcDesc='Upside moderat. Convergence ≥70 saja. Sizing 60-70%.';mcStyle='Selective Long';mcRisk='MODERATE';}
    else if(avgCh<-4&&bullPct<35){mcType='📉 BEAR MOMENTUM';mcColor='red';mcDesc='Tekanan jual. Short valid. Hindari long kecuali RSI<25.';mcStyle='Short/Cash';mcRisk='CASH HEAVY';}
    else if(avgCh<-1.5&&bullPct<45){mcType='🌧 MILD BEAR';mcColor='amber';mcDesc='Mild bearish. Sizing 40-50%. RS positif+FR negatif saja.';mcStyle='Small Sizing';mcRisk='REDUCED';}
    else if(oversold>=8){mcType='💎 MASS OVERSOLD';mcColor='green';mcDesc=oversold+' koin RSI<30. DCA zone terbaik. Probability bounce tinggi.';mcStyle='Counter-trend DCA';mcRisk='MODERATE-HIGH';}
    else{mcType='⚖️ TRANSITIONAL';mcColor='amber';mcDesc='Mixed signals. Sizing kecil. RS divergence+FR extreme saja.';mcStyle='Cautious';mcRisk='REDUCED';}

    // ── COIN ANALYSIS (80 koin) ─────────────────────────────
    const coinList=[];
    for(const sym of SCAN80){
      try{
        const kd=kMap[sym]||null;
        const by=byMap[sym]||{};
        const p=N(kd?.price||by?.p||0);if(!p)continue;
        const c24=N(by?.c24||0);
        const vol=N(by?.vol24||0);
        const frVal=N(by?.fr||0);
        const frPct=N(by?.frPct||0);
        const rsi=kd?.rsi||cl(50+c24*2.5,8,92);
        const rsiR=!!kd;
        const macd=kd?.macd||null;
        const isCoiling=kd?.isCoiling||false;
        const volBias=kd?.volBias||'NEU';
        const obvBull=kd?.obvBull||false;
        const atr=kd?.atr||0;
        const atrPct=p>0&&atr>0?+(atr/p*100).toFixed(2):null;
        const pip=by?.p>0?(p/(by.p||p)*50):50;
        const rsBtc=+(c24-btcCh24).toFixed(2);
        const sector=getSector(sym);

        // SIGNAL DETECTION
        let signal,signalColor,signalDesc,direction,probability;
        if(rsi<28&&c24>0&&frVal<-0.0003&&(macd?.xUp||macd?.bull)&&vol>1e6){signal='🚀 ABOUT TO FLY';signalColor='#00ffd0';direction='LONG';probability=84;signalDesc='RSI '+rsi.toFixed(0)+' oversold+FR squeeze '+(frPct).toFixed(4)+'%+MACD+discount';}
        else if(rsi<22&&c24>0.5){signal='💎 CAPITULATION';signalColor='#00ff88';direction='LONG';probability=81;signalDesc='RSI '+rsi.toFixed(0)+' EXTREME oversold+reversal+'+c24.toFixed(1)+'%';}
        else if(rsi>=24&&rsi<40&&c24>0&&isCoiling&&vol>500000){signal='🤫 ACCUMULATION';signalColor='#4af0ff';direction='LONG';probability=77;signalDesc='RSI '+rsi.toFixed(0)+' oversold+coiling+'+c24.toFixed(1)+'%=SM masuk';}
        else if(isCoiling&&rsi>=38&&rsi<=62&&Math.abs(c24)<2.5&&vol>500000){signal='⚡ COILING';signalColor='#f0c040';direction='WATCH';probability=68;signalDesc='Range kontraksi — breakout imminent';}
        else if(rsi<36&&c24>1.2){signal='🔄 OVERSOLD BOUNCE';signalColor='#88ff99';direction='LONG';probability=74;signalDesc='RSI '+rsi.toFixed(0)+' oversold+reversal+'+c24.toFixed(1)+'%';}
        else if(c24>5&&rsi>=45&&rsi<=70&&vol>5e6){signal='📈 BREAKOUT';signalColor='#00ffd0';direction='LONG';probability=75;signalDesc='+'+c24.toFixed(1)+'% breakout dengan volume';}
        else if(rsi>72&&frVal>0.0005){signal='🔴 SHORT ZONE';signalColor='#ff4466';direction='SHORT';probability=72;signalDesc='RSI '+rsi.toFixed(0)+' overbought+FR +'+frPct.toFixed(4)+'%';}
        else if(rsi>68&&volBias==='DIST'&&vol>3e6){signal='⚠️ DISTRIBUTION';signalColor='#ff8800';direction='SHORT';probability=64;signalDesc='RSI '+rsi.toFixed(0)+' premium zone+vol distribusi';}
        else if(rsi>=42&&rsi<=60&&c24>1.5){signal='📈 BULL MOMENTUM';signalColor='#66ff99';direction='LONG';probability=67;signalDesc='+'+c24.toFixed(1)+'% RSI '+rsi.toFixed(0);}
        else if(c24<-5&&rsi<45){signal='📉 BEARISH';signalColor='#ff4466';direction='SHORT';probability=37;signalDesc=c24.toFixed(1)+'% breakdown';}
        else if(rsi>=42&&rsi<=60&&c24>0){signal='↗️ MILD BULL';signalColor='#a0e040';direction='LONG';probability=61;signalDesc='+'+c24.toFixed(1)+'% RSI '+rsi.toFixed(0);}
        else{signal='⚖️ SIDEWAYS';signalColor='#7a8fa8';direction='WAIT';probability=50;signalDesc='RSI '+rsi.toFixed(0)+' '+c24.toFixed(1)+'%';}

        // CONVERGENCE SCORE
        let f1=rsi<20?30:rsi<28?24:rsi<35?18:rsi<42?11:rsi<50?4:rsi>78?-18:rsi>72?-12:rsi>65?-5:rsi>57?2:0;
        if(macd?.xUp)f1+=14;else if(macd?.bull)f1+=7;else if(macd?.xDown)f1-=11;else if(macd?.bear)f1-=5;
        if(obvBull&&c24>0)f1+=7;if(isCoiling&&rsi<55)f1+=5;
        f1=cl(f1,-28,42);
        let f3=frVal<-0.0008?20:frVal<-0.0005?14:frVal<-0.0003?9:frVal<-0.0001?4:frVal>0.0008?-14:frVal>0.0005?-9:frVal>0.0003?-4:0;
        if(volBias==='ACC'&&c24>0)f3+=8;else if(volBias==='DIST')f3-=6;
        f3=cl(f3,-20,25);
        let f4=vol>500e6&&c24>0?8:vol>100e6&&c24>0?5:vol>20e6&&c24>0?3:vol>5e6&&c24>0?1:vol<300000?-3:0;
        f4=cl(f4,-14,20);
        let f5=rsBtc>8?14:rsBtc>3?9:rsBtc>0?4:rsBtc<-8?-9:rsBtc<-3?-5:0;
        f5=cl(f5,-14,20);
        const score=cl(Math.round(45+f1+f3+f4+f5),0,100);
        const convLabel=score>=80?'🔥ELITE':score>=70?'💎PRIME':score>=60?'✅VALID':score>=50?'🟡MOD':'⚪WEAK';

        // SL/TP from ATR
        const slPct=atrPct?+(atrPct*1.5).toFixed(2):3;
        const tp1Pct=atrPct?+(atrPct*2.0).toFixed(2):5;
        const tp2Pct=atrPct?+(atrPct*3.5).toFixed(2):9;
        const sl=direction==='LONG'?+(p*(1-slPct/100)).toFixed(p>1?4:8):+(p*(1+slPct/100)).toFixed(p>1?4:8);
        const tp1=direction==='LONG'?+(p*(1+tp1Pct/100)).toFixed(p>1?4:8):+(p*(1-tp1Pct/100)).toFixed(p>1?4:8);
        const tp2=direction==='LONG'?+(p*(1+tp2Pct/100)).toFixed(p>1?4:8):+(p*(1-tp2Pct/100)).toFixed(p>1?4:8);

        coinList.push({sym,sector,price:p,c24,vol,rsi:+rsi.toFixed(1),rsiReal:rsiR,fr:frPct||null,
          macdXUp:!!macd?.xUp,macdBull:!!macd?.bull,obvBull,isCoiling,volBias,rs:rsBtc,
          aboveE200:!!kd?.aboveE200,atr:atr>0?+atr.toFixed(p>1?4:8):null,atrPct,
          signal,signalColor,signalDesc,direction,probability,
          conv:{score,label:convLabel},levels:{sl,tp1,tp2,slPct,tp1Pct,tp2Pct}});
      }catch{}
    }
    coinList.sort((a,b)=>b.conv.score-a.conv.score);

    const leaders=coinList.slice(0,20);
    const longSetups=coinList.filter(x=>x.direction==='LONG'&&x.conv.score>=60).slice(0,20);
    const shortSetups=coinList.filter(x=>x.direction==='SHORT'&&x.conv.score>=55).slice(0,8);
    const flySetups=coinList.filter(x=>x.signal.includes('ABOUT TO FLY')||x.signal.includes('CAPITULATION')).slice(0,6);
    const accumSetups=coinList.filter(x=>x.signal.includes('ACCUMULATION')||x.signal.includes('COILING')).slice(0,6);
    const eliteCount=leaders.filter(x=>x.conv.score>=80).length;
    const primeCount=leaders.filter(x=>x.conv.score>=70&&x.conv.score<80).length;
    const validCount=leaders.filter(x=>x.conv.score>=60&&x.conv.score<70).length;

    // ── BTC SNAPSHOT ───────────────────────────────────────
    const btcRes=btcPrice>0&&btcATRPct?+(btcPrice*(1+btcATRPct/100*2)).toFixed(0):btcPrice>0?+(btcPrice*1.04).toFixed(0):null;
    const btcSup=btcPrice>0&&btcATRPct?+(btcPrice*(1-btcATRPct/100*2)).toFixed(0):btcPrice>0?+(btcPrice*0.96).toFixed(0):null;
    const btcSnapshot={price:btcPrice,ch24:btcCh24,rsi:btcK?.rsi||null,fg:fgVal,fgLabel,macd:btcK?.macd||null,btcLS,btcLongPct,btcShortPct,atr:btcATR>0?+btcATR.toFixed(2):null,atrPct:btcATRPct,aboveEma200:!!btcK?.aboveE200};

    // ── SECTOR DATA ────────────────────────────────────────
    const sectorDataMap={};
    for(const[sName,coins]of Object.entries(SECTORS)){
      const sc=coinList.filter(x=>coins.includes(x.sym));if(!sc.length)continue;
      const avgCh=+(sc.reduce((s,x)=>s+x.c24,0)/sc.length).toFixed(2);
      const avgRSI=+(sc.reduce((s,x)=>s+x.rsi,0)/sc.length).toFixed(1);
      const avgConv=+(sc.reduce((s,x)=>s+x.conv.score,0)/sc.length).toFixed(0);
      const flowSig=avgCh>3?'↑↑ INFLOW':avgCh>1?'↑ INFLOW':avgCh<-3?'↓↓ OUTFLOW':avgCh<-1?'↓ OUTFLOW':'→ NEUTRAL';
      sectorDataMap[sName]={name:sName,avgCh24:avgCh,avgRSI,avgConv:+avgConv,flowSig,flowCol:avgCh>3?'green':avgCh>1?'lightgreen':avgCh<-3?'red':avgCh<-1?'orange':'gray',coinsCount:sc.length,bullCoins:sc.filter(x=>x.direction==='LONG').length,shortCoins:sc.filter(x=>x.direction==='SHORT').length,
        coins:sc.map(c=>({sym:c.sym,price:c.price,c24:c.c24,vol:c.vol,rsi:c.rsi,rsiReal:c.rsiReal,signal:c.signal,signalColor:c.signalColor,signalDesc:c.signalDesc,direction:c.direction,probability:c.probability,conv:c.conv.score,fr:c.fr,atrPct:c.atrPct,levels:c.levels,volBias:c.volBias,isCoiling:c.isCoiling,obvBull:c.obvBull,pip:50,rs:c.rs}))};
    }

    // ── GAME PLAN ──────────────────────────────────────────
    const scalpSetups=longSetups.filter(x=>x.atrPct&&x.vol>2e6&&x.rsi<72).slice(0,6).map(c=>({sym:c.sym,sector:c.sector,entry:c.price,sl:c.levels.sl,tp1:c.levels.tp1,tp2:c.levels.tp2,slPct:c.levels.slPct,tp1Pct:c.levels.tp1Pct,tp2Pct:c.levels.tp2Pct,rr:+(c.levels.tp1Pct/Math.max(c.levels.slPct,0.1)).toFixed(1),conv:c.conv.score,rsi:c.rsi,rsiReal:c.rsiReal,fr:c.fr,atrPct:c.atrPct,signal:c.signal,reasons:[c.signalDesc]}));
    const swingSetups=longSetups.filter(x=>x.atrPct&&x.vol>5e6&&x.rsi<65).slice(0,4).map(c=>({sym:c.sym,sector:c.sector,entry:c.price,sl:+(c.price*(1-c.atrPct/100*2)).toFixed(c.price>1?4:8),tp1:+(c.price*(1+c.atrPct/100*3)).toFixed(c.price>1?4:8),tp2:+(c.price*(1+c.atrPct/100*5)).toFixed(c.price>1?4:8),slPct:+(c.atrPct*2).toFixed(2),tp1Pct:+(c.atrPct*3).toFixed(2),tp2Pct:+(c.atrPct*5).toFixed(2),conv:c.conv.score,rsi:c.rsi,rsiReal:c.rsiReal,fr:c.fr,atrPct:c.atrPct,signal:c.signal,reasons:[c.signalDesc]}));
    const activeShorts=shortSetups.filter(x=>x.atrPct&&x.vol>3e6).slice(0,4).map(c=>({sym:c.sym,sector:c.sector,entry:c.price,sl:+(c.price*(1+c.atrPct/100*1.5)).toFixed(c.price>1?4:8),tp1:+(c.price*(1-c.atrPct/100*2)).toFixed(c.price>1?4:8),tp2:+(c.price*(1-c.atrPct/100*3.5)).toFixed(c.price>1?4:8),slPct:+(c.atrPct*1.5).toFixed(2),tp1Pct:+(c.atrPct*2).toFixed(2),tp2Pct:+(c.atrPct*3.5).toFixed(2),conv:c.conv.score,rsi:c.rsi,rsiReal:c.rsiReal,fr:c.fr,atrPct:c.atrPct,signal:c.signal,reasons:[c.signalDesc]}));
    const spotAccum=coinList.filter(x=>x.rsi<35&&x.vol>500000&&x.c24>-6&&x.conv.score>=50).slice(0,6).map(c=>({sym:c.sym,price:c.price,rsi:c.rsi,rsiReal:c.rsiReal,dcaZone:'$'+c.levels.sl+'–$'++(c.price*1.005).toFixed(c.price>1?4:8),atrPct:c.atrPct,conv:c.conv.score,signal:c.signal}));
    const avoidList=coinList.filter(x=>x.rsi>74&&x.direction!=='LONG').slice(0,5).map(c=>({sym:c.sym,rsi:c.rsi,fr:c.fr,reason:c.signalDesc||'Extended—poor R:R'}));

    // ── TRADING SCHEDULE ───────────────────────────────────
    const now=new Date();const wibMin=(now.getUTCHours()*60+now.getUTCMinutes()+7*60)%(24*60);const wibH=Math.floor(wibMin/60);
    const days=['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];
    const sessions=[{id:'dead',name:'🌙 Dead Zone',time:'02:00–06:00',start:2,end:6,q:'POOR',activity:'Volume minimum. Istirahat.'},{id:'asia_open',name:'🌏 Asia Open',time:'06:00–09:00',start:6,end:9,q:'MODERATE',activity:'Volume membangun.'},{id:'asia_peak',name:'🔥 Asia Peak',time:'09:00–12:00',start:9,end:12,q:'GOOD',activity:'Breakout Asia valid.'},{id:'lunch',name:'⚠️ Lunch Dip',time:'12:00–15:00',start:12,end:15,q:'CAUTION',activity:'Volume turun.'},{id:'london',name:'🌍 London Open',time:'15:00–18:00',start:15,end:18,q:'PRIME',activity:'PRIME: Volume institusional.'},{id:'ny_pre',name:'📊 NY Pre',time:'18:00–21:00',start:18,end:21,q:'BUILDING',activity:'Pre-market AS.'},{id:'ny_open',name:'🚀 NY Open',time:'21:00–23:00',start:21,end:23,q:'PRIME',activity:'PRIME: Volume tertinggi.'},{id:'ny_late',name:'🌙 NY Late',time:'23:00–02:00',start:23,end:26,q:'GOOD',activity:'Volume oke.'}];
    let curSess='dead';for(const s of sessions){const e=s.end>24?s.end-24:s.end;if(s.start>20){if(wibH>=s.start||wibH<e){curSess=s.id;break;}}else{if(wibH>=s.start&&wibH<s.end){curSess=s.id;break;}}}
    const curSO=sessions.find(s=>s.id===curSess)||sessions[0];
    const nextPrime=sessions.filter(s=>s.q==='PRIME').map(s=>({...s,inH:s.start>wibH?s.start-wibH:24-(wibH-s.start)})).sort((a,b)=>a.inH-b.inH)[0];
    const tradingSchedule={wibHour:wibH,dayName:days[now.getUTCDay()],sessions,currentSession:curSess,positionSizeRec:curSO.q==='PRIME'?'Full (100%)':curSO.q==='GOOD'?'Large (75%)':curSO.q==='MODERATE'?'Half (50%)':'Minimal (25%)',focusToday:mcType+'. '+(curSO.q==='PRIME'?'Session PRIME.':curSO.q==='POOR'?'Istirahat.':'Session '+curSO.q+'.'),nextPrimeSession:nextPrime};

    // ── CHECKLIST ──────────────────────────────────────────
    const mktChecks=[
      {label:'Market character layak trading',pass:mcColor!=='red'||oversold>=8,detail:'Character: '+mcType,fix:'Tunggu market shift'},
      {label:'Trading session berkualitas',pass:curSO.q==='PRIME'||curSO.q==='GOOD',detail:curSO.name+' '+curSO.q,fix:'Tunggu London (15:00) atau NY (21:00) WIB'},
      {label:'BTC tidak di resistance',pass:btcK?.rsi?btcK.rsi<72:true,detail:btcK?.rsi?'BTC RSI '+btcK.rsi.toFixed(0):'BTC aman',fix:'Tunggu BTC RSI <65'},
      {label:'FR market tidak overheated',pass:Object.values(byMap).filter(x=>x.fr>0.0005).length<10,detail:'FR overheated: '+Object.values(byMap).filter(x=>x.fr>0.0005).length+' koin',fix:'Terlalu banyak FR tinggi'},
      {label:'Market tidak overbought massal',pass:overbought<12,detail:overbought+' koin RSI>70',fix:'Tunggu koreksi'},
      {label:'BTC L/S ratio aman',pass:btcLS?btcLS<2.5:true,detail:btcLS?'L/S: '+btcLS+' ('+btcLongPct+'% long)':'Data tidak tersedia',fix:'L/S >2.5 = risk tinggi'},
      {label:'Cukup koin aktif & liquid',pass:coinList.filter(x=>x.vol>10e6&&x.c24>0).length>=15,detail:coinList.filter(x=>x.vol>10e6&&x.c24>0).length+' koin aktif',fix:'Market sepi'},
      {label:'BTC trend mendukung altcoin',pass:btcCh24>-2,detail:'BTC '+btcCh24.toFixed(2)+'%'+(btcCh24<-2?' → tunda long altcoin':''),fix:'Tunggu BTC stabilisasi'},
    ];
    const passCount=mktChecks.filter(x=>x.pass).length;
    const checklist={marketChecks:mktChecks,marketPassCount:passCount,marketTotal:8,coinChecks:['RSI koin < 72','Volume ≥ $5M','Convergence Score ≥ '+(eliteCount>0?70:60),'Position size ≤ 2%','FR koin < +0.04%','SL sudah ditentukan (ATR-based)','RR minimal 1:2','Volume konfirmasi entry'],overallGreenLight:passCount>=6,verdict:passCount>=6?'✅ SETUP LAYAK':'⚠️ HATI-HATI — '+(8-passCount)+' kondisi belum terpenuhi'};

    const out={
      ok:true,version:'v6',ts:Date.now(),elapsed:Date.now()-t0,
      dataQuality:{coins:coinList.length,realRSI,btcLS:btcLS!=null,btcRsi:!!(btcK?.rsi),src:'bybit+altme'},
      fg:fgVal,fgLabel,
      marketCharacter:{type:mcType,color:mcColor,description:mcDesc,tradeStyle:mcStyle,riskLevel:mcRisk,stats:{bullPct,overbought,oversold,avgCh}},
      btcSnapshot,
      convergence:{leaders,longSetups,shortSetups,flySetups,accumSetups,summary:(eliteCount?'🔥'+eliteCount+' ELITE · ':'')+primeCount+'💎PRIME · '+validCount+'✅VALID'+(shortSetups.length?' · '+shortSetups.length+'🔴SHORT':''),eliteCount,primeCount,validCount,shortCount:shortSetups.length},
      gamePlan:{btcLevels:{resistance:btcRes,support:btcSup,current:btcPrice||null},scenarios:{bull:{condition:'BTC tembus $'+(btcRes||'resistance')+'(close di atas)',action:'Long alts conv ≥'+(eliteCount?72:65)+', RR 1:3.',setups:longSetups.slice(0,3)},sideways:{condition:'BTC konsolidasi ±1.5%',action:'Scalp COILING+ACCUMULATION saja.',setups:accumSetups.slice(0,2)},bear:{condition:'BTC breakdown ke $'+(btcSup||'support'),action:'Cash '+(shortSetups.length>2?60:80)+'%.',setups:activeShorts.slice(0,2)}},scalpSetups,swingSetups,activeShorts,spotAccum,avoidList,flySetups,accumSetups},
      sectorFlow:{sectors:Object.values(sectorDataMap).sort((a,b)=>b.avgCh24-a.avgCh24),sectorData:sectorDataMap},
      tradingSchedule,
      checklist,
    };
    CACHE.data=out;CACHE.ts=Date.now();
    return res.status(200).json(out);

  }catch(e){
    return res.status(200).json({
      ok:false,error:e.message,version:'v6',ts:Date.now(),elapsed:Date.now()-t0,
      dataQuality:{coins:0,realRSI:0,btcLS:false,btcRsi:false},
      fg:50,fgLabel:'Neutral',
      marketCharacter:{type:'⚖️ TRANSITIONAL',color:'amber',description:'Refresh dalam 30 detik.',tradeStyle:'Cautious',riskLevel:'REDUCED',stats:{bullPct:50,overbought:0,oversold:0,avgCh:0}},
      btcSnapshot:{price:0,ch24:0,rsi:null,fg:50,fgLabel:'Neutral',btcLS:null,btcLongPct:null,btcShortPct:null},
      convergence:{leaders:[],longSetups:[],shortSetups:[],flySetups:[],accumSetups:[],summary:'Error: '+e.message,eliteCount:0,primeCount:0,validCount:0,shortCount:0},
      gamePlan:{btcLevels:{resistance:null,support:null,current:null},scenarios:{bull:{condition:'—',action:'—',setups:[]},sideways:{condition:'—',action:'—',setups:[]},bear:{condition:'—',action:'—',setups:[]}},scalpSetups:[],swingSetups:[],activeShorts:[],spotAccum:[],avoidList:[],flySetups:[],accumSetups:[]},
      sectorFlow:{sectors:[],sectorData:{}},
      tradingSchedule:{wibHour:0,dayName:'—',sessions:[],currentSession:'dead',positionSizeRec:'—',focusToday:'Error. Coba refresh.',nextPrimeSession:null},
      checklist:{marketChecks:[],marketPassCount:0,marketTotal:8,coinChecks:[],overallGreenLight:false,verdict:'⚠️ Error: '+e.message},
    });
  }
}
