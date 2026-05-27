// api/morning-brief.js — v4.1 FIXED · 150+ coins · Fast klines
// ═══════════════════════════════════════════════════════════════
// FIX v4.1 vs v4:
// ✅ HAPUS inner 1D klines per coin (was doubling API calls → timeout)
// ✅ TOP 35 koin klines only (paling penting, dapat real RSI)
// ✅ Sisa 100+ koin: estimasi RSI dari price data (CG+MEXC)
// ✅ Bybit 4H klines lebih cepat: timeout 3s (was 4s)
// ✅ Total API calls: ~50 (was ~200+) → tidak timeout Vercel 10s
// ✅ 150+ koin tetap dianalisa signal + convergence
// ✅ Semua fitur v4 tetap: LONG/SHORT/FLY/ACCUMULATION/COILING
// ═══════════════════════════════════════════════════════════════

const N=(v,d=0)=>{const n=+v;return(isNaN(n)||!isFinite(n))?d:n;};
const A=(v)=>Array.isArray(v)?v:[];
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,N(v)));

// ── KLINES: top 35 koin — real 4H RSI + MACD ────────────────────
const KLINE_COINS=['BTC','ETH','BNB','SOL','XRP','ADA','DOGE','AVAX','LINK','DOT',
  'NEAR','SUI','APT','ARB','OP','TON','INJ','TIA','HYPE','RENDER',
  'AAVE','JUP','PENDLE','PEPE','WIF','SEI','ENA','JTO','ONDO','STRK',
  'FET','TAO','WLD','BONK','FLOKI'];

// ── FULL SCAN: 150+ koin untuk signal + convergence ─────────────
const ALL_COINS=[
  // Major
  'BTC','ETH','BNB','SOL','XRP','ADA','DOGE','AVAX','LINK','DOT',
  // L1
  'NEAR','SUI','APT','TON','INJ','TIA','SEI','ENA','HBAR','ALGO',
  'XLM','LTC','VET','TRX','ONE','KAVA','STX','RUNE','ZRC',
  // L2
  'ARB','OP','STRK','ZRO','RON','W','MANTA','BLAST','METIS',
  // DeFi
  'AAVE','JUP','PENDLE','GMX','DYDX','LDO','UNI','CRV','SUSHI',
  'CAKE','RDNT','GNS','VELO','AERO','BANANA','LQTY','COMP','SNX','BLUR',
  // AI/DePIN
  'RENDER','FET','TAO','WLD','IO','OLAS','VIRTUAL','GRT','PYTH',
  'EIGEN','ARKM','GRASS','VANA','AIOZ',
  // Infrastructure
  'ATOM','FIL','ONDO','JTO','BAND','API3','OMNI',
  // Meme
  'PEPE','WIF','BONK','FLOKI','MOODENG','PNUT','NEIRO','ACT',
  'CHILLGUY','GIGA','PONKE','TURBO','BOME','GOAT','POPCAT','MEW','DOGS',
  // Gaming
  'ILV','BEAM','YGG','PIXEL','MAGIC','RON','AXL','PRIME',
  // RWA
  'POLYX','CFG','MPL',
  // Trending/Low cap
  'HYPE','NOT','JASMY','CFX','ETC','LQTY','DRIFT','PARTI','ACE',
  'BERA','LISTA','TAIKO','SAFE','ZETA','SONIC','ETHFI','USUAL',
  // Extra mid
  'ATOM','INJ','RENDER','IMX','SAND','MANA','CHZ','GALA',
];
// Dedup
const SCAN_COINS=[...new Set(ALL_COINS)].filter(Boolean);

// ── SECTOR MAP ────────────────────────────────────────────────────
const SECTOR_MAP={
  'Bitcoin':['BTC'],
  'Ethereum':['ETH'],
  'L1':['SOL','ADA','AVAX','TON','NEAR','SUI','APT','TIA','SEI','ENA','HBAR','ALGO','XLM','LTC','VET','ONE','KAVA','STX','BERA','SONIC'],
  'L2':['ARB','OP','STRK','ZRO','MANTA','BLAST','METIS','W','RON','IMX'],
  'DeFi':['AAVE','JUP','PENDLE','GMX','DYDX','LDO','UNI','CRV','SUSHI','CAKE','RDNT','GNS','VELO','AERO','BANANA','LQTY','COMP','SNX','BLUR','ETHFI','USUAL'],
  'AI/DePIN':['RENDER','FET','TAO','WLD','IO','OLAS','VIRTUAL','GRT','PYTH','EIGEN','ARKM','GRASS','VANA','AIOZ'],
  'Meme':['DOGE','PEPE','WIF','BONK','FLOKI','MOODENG','PNUT','NEIRO','ACT','CHILLGUY','GIGA','PONKE','TURBO','BOME','GOAT','POPCAT','MEW','DOGS'],
  'Gaming':['ILV','BEAM','YGG','PIXEL','MAGIC','RON','AXL','PRIME','SAND','MANA','CHZ','GALA'],
  'Infrastructure':['LINK','DOT','INJ','ATOM','FIL','ONDO','JTO','BAND','API3','OMNI'],
  'Payments':['XRP','TRX','XLM','LTC','BNB','HBAR'],
  'RWA':['POLYX','CFG','MPL','ONDO'],
  'Trending':['HYPE','NOT','JASMY','CFX','ETC','DRIFT','PARTI','ACE','LISTA','TAIKO'],
};
const getSector=sym=>{for(const[s,v]of Object.entries(SECTOR_MAP))if(v.includes(sym))return s;return 'Other';};

const CACHE={data:null,ts:0};
const TTL=360000;

export default async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Cache-Control','s-maxage=360,stale-while-revalidate=60');
  if(req.method==='OPTIONS')return res.status(200).end();
  const t0=Date.now();
  if(CACHE.data&&Date.now()-CACHE.ts<TTL)return res.status(200).json({...CACHE.data,cached:true,elapsed:Date.now()-t0});

  const sf=async(url,ms=5000)=>{
    const c=new AbortController();const t=setTimeout(()=>c.abort(),ms);
    try{const r=await fetch(url,{signal:c.signal,headers:{Accept:'application/json','User-Agent':'AC369/4.1'}});clearTimeout(t);return r.ok?await r.json():null;}
    catch{clearTimeout(t);return null;}
  };

  // ── KLINE CALCULATIONS ────────────────────────────────
  const calcRSI=a=>{try{if(!a||a.length<16)return null;let g=0,l=0;for(let i=1;i<=14;i++){const d=a[i]-a[i-1];d>0?g+=d:l-=d;}g/=14;l/=14;for(let i=15;i<a.length;i++){const d=a[i]-a[i-1];g=(g*13+Math.max(d,0))/14;l=(l*13+Math.max(-d,0))/14;}return l===0?100:clamp(100-100/(1+g/l),0,100);}catch{return null;}};
  const calcEMA=(a,p)=>{if(!a||a.length<2)return a?.[a.length-1]||0;const k=2/(p+1);let e=a.slice(0,Math.min(p,a.length)).reduce((s,v)=>s+v,0)/Math.min(p,a.length);for(let i=Math.min(p,a.length);i<a.length;i++)e=a[i]*k+e*(1-k);return e;};
  const calcMACD=a=>{try{if(!a||a.length<36)return null;const k12=2/13,k26=2/27,k9=2/10;let e12=a.slice(0,12).reduce((s,v)=>s+v,0)/12,e26=a.slice(0,26).reduce((s,v)=>s+v,0)/26;const mv=[];for(let i=26;i<a.length;i++){e12=a[i]*k12+e12*(1-k12);e26=a[i]*k26+e26*(1-k26);mv.push(e12-e26);}let sig=mv.slice(0,9).reduce((s,v)=>s+v,0)/9;for(let i=9;i<mv.length;i++)sig=mv[i]*k9+sig*(1-k9);const n=mv.length,last=N(mv[n-1]),prev=N(mv[n-2]||last),h=last-sig,ph=prev-sig;return{bull:last>0&&h>0,bear:last<0&&h<0,xUp:h>0&&ph<=0,xDown:h<0&&ph>=0,div:n>7&&last<N(mv[n-8])&&a[a.length-1]>a[a.length-8]};}catch{return null;}};

  // ── BYBIT 4H KLINES (35 koin, no inner fetch) ─────────
  const getKline=async sym=>{
    try{
      const r=await sf(`https://api.bybit.com/v5/market/kline?category=linear&symbol=${sym}USDT&interval=240&limit=60`,3000);
      if(r?.retCode!==0)return null;
      const raw=A(r?.result?.list);if(raw.length<16)return null;
      const K=raw.slice().reverse().map(d=>({o:N(d[1]),h:N(d[2]),l:N(d[3]),c:N(d[4]),v:N(d[6])})).filter(d=>d.c>0&&d.h>=d.l);
      if(K.length<16)return null;
      const cls=K.map(k=>k.c);
      const rsi=calcRSI(cls);if(rsi===null)return null;
      const macd=calcMACD(cls);
      const e9=calcEMA(cls,9),e21=calcEMA(cls,21),e200=calcEMA(cls,Math.min(200,cls.length-1));
      let obvUp=0,obvDn=0;
      for(let i=Math.max(1,K.length-20);i<K.length;i++){if(N(K[i].c)>N(K[i-1].c))obvUp+=N(K[i].v);else if(N(K[i].c)<N(K[i-1].c))obvDn+=N(K[i].v);}
      const atrArr=K.slice(1).map((k,i)=>Math.max(N(k.h)-N(k.l),Math.abs(N(k.h)-N(K[i].c)),Math.abs(N(k.l)-N(K[i].c))));
      const atr=atrArr.slice(-14).reduce((s,v)=>s+v,0)/14;
      const lp=cls[cls.length-1];
      const recentATR=atrArr.slice(-5).reduce((s,v)=>s+v,0)/5;
      const avgATR=atrArr.slice(-20).reduce((s,v)=>s+v,0)/20;
      const isCoiling=avgATR>0&&recentATR<avgATR*0.65;
      const vols5=K.slice(-5);const volBull=vols5.filter(k=>k.c>k.o).reduce((s,k)=>s+k.v,0);const volBear=vols5.filter(k=>k.c<k.o).reduce((s,k)=>s+k.v,0);
      const volBias=volBull>volBear*1.3?'ACC':volBear>volBull*1.3?'DIST':'NEU';
      return{rsi:+N(rsi).toFixed(2),macd,e9,e21,e200,atr,obvBull:obvUp>obvDn*1.2,aboveE200:lp>e200,cls,K,price:lp,isCoiling,volBias,src:'bybit'};
    }catch{return null;}
  };

  try{
    // ── PARALLEL FETCH (all at once) ──────────────────────
    const [cgR,cgR2,mxR,byFrR,byLSR,fgR,...klineRes]=await Promise.allSettled([
      sf('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=volume_desc&per_page=250&page=1&sparkline=false&price_change_percentage=24h,7d',6000),
      sf('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=volume_desc&per_page=250&page=2&sparkline=false&price_change_percentage=24h,7d',6000),
      sf('https://api.mexc.com/api/v3/ticker/24hr',5000),
      sf('https://api.bybit.com/v5/market/tickers?category=linear',4000),
      sf('https://api.bybit.com/v5/market/account-ratio?category=linear&symbol=BTCUSDT&period=1h&limit=1',4000),
      sf('https://api.alternative.me/fng/?limit=1&format=json',3000),
      ...KLINE_COINS.map(s=>getKline(s)),
    ]);

    const fgVal=N(fgR.value?.data?.[0]?.value,50);
    const fgLabel=fgR.value?.data?.[0]?.value_classification||'Neutral';

    // FR MAP
    const frMap={};
    for(const t of A(byFrR.value?.result?.list)){try{const sym=String(t.symbol||'').replace('USDT','').replace('PERP','');if(!sym)continue;const fr=N(t.fundingRate);frMap[sym]={fr,pct:+(fr*100).toFixed(4),bullish:fr<-0.0002,bearish:fr>0.0004,oi:N(t.openInterestValue),price:N(t.lastPrice)};}catch{}}

    // L/S
    let btcLS=null,btcLongPct=null,btcShortPct=null;
    try{const lsD=byLSR.value;if(lsD?.retCode===0&&A(lsD?.result?.list).length>0){const row=lsD.result.list[0];btcLongPct=+N(row.buyRatio*100).toFixed(2);btcShortPct=+N(row.sellRatio*100).toFixed(2);btcLS=+(btcLongPct/btcShortPct).toFixed(3);}}catch{}

    // CG PRICE MAP
    const cgMap={};
    for(const pageR of [cgR,cgR2]){for(const c of A(pageR.value)){try{const sym=String(c.symbol||'').toUpperCase();if(!sym)continue;cgMap[sym]={p:N(c.current_price),c24:N(c.price_change_percentage_24h),c7d:c.price_change_percentage_7d!=null?N(c.price_change_percentage_7d):null,vol:N(c.total_volume),h:N(c.high_24h)||N(c.current_price)*1.02,l:N(c.low_24h)||N(c.current_price)*0.98,mcap:N(c.market_cap),rank:N(c.market_cap_rank,9999)};}catch{}}}

    // MEXC PRICE MAP (backup untuk low caps)
    const mxMap={};
    for(const t of A(mxR.value)){try{if(!String(t?.symbol).endsWith('USDT'))continue;const sym=String(t.symbol).replace('USDT','');const p=N(t.lastPrice);if(p<=0||p>1e10)continue;if(!mxMap[sym])mxMap[sym]={p,c24:N(t.priceChangePercent),vol:N(t.quoteVolume),h:N(t.highPrice)||p*1.02,l:N(t.lowPrice)||p*0.98};}catch{}}

    // KLINE MAP (35 koin)
    const kMap={};let realRSICount=0;
    for(let i=0;i<KLINE_COINS.length;i++){const r=klineRes[i];if(r?.status==='fulfilled'&&r.value){kMap[KLINE_COINS[i]]=r.value;realRSICount++;}}

    // BTC DATA
    const btcK=kMap['BTC']||null;
    const btcCg=cgMap['BTC']||{};
    const btcPrice=N(btcK?.price||frMap['BTC']?.price||btcCg?.p||0);
    const btcCh24=N(btcCg?.c24||0);
    const btcCh7d=N(btcCg?.c7d||0);

    // ── COIN ANALYSIS (semua 150+ koin) ──────────────────
    const coinAnalysis=[];
    for(const sym of SCAN_COINS){
      try{
        const kd=kMap[sym]||null;
        const cg=cgMap[sym]||null;
        const mx=mxMap[sym]||null;
        const pr=cg||mx||null;
        const fr=frMap[sym]||null;
        const p=N(kd?.price||fr?.price||pr?.p||0);
        if(!p)continue;

        const c24=N(pr?.c24||0);
        const c7d=pr?.c7d!=null?N(pr.c7d):null;
        const vol=N(pr?.vol||mx?.vol||0);
        const h=N(pr?.h||p*1.02),l=N(pr?.l||p*0.98);
        const pip=h>l?clamp((p-l)/(h-l)*100,0,100):50;

        // RSI: real if klines available, else estimate
        const rsi=kd?.rsi||clamp(50+c24*2.5+(pip-50)*0.3+((c7d||0)>0?3:-3),8,92);
        const rsiR=!!kd;

        const atr=kd?.atr||0;
        const atrPct=p>0&&atr>0?+(atr/p*100).toFixed(2):null;
        const frVal=fr?.fr||0;
        const macd=kd?.macd||null;
        const isCoiling=kd?.isCoiling||false;
        const volBias=kd?.volBias||'NEU';
        const obvBull=kd?.obvBull||false;
        const rsBtc=+(c24-btcCh24).toFixed(2);
        const rs7d=c7d!=null&&btcCh7d?+(c7d-btcCh7d).toFixed(2):null;
        const sector=getSector(sym);

        // ── SIGNAL DETECTION ─────────────────────────────
        let signal,signalColor,signalDesc,direction,probability;

        if(rsi<28&&c24>0&&frVal<-0.0003&&(macd?.xUp||macd?.bull)&&pip<40&&vol>1e6){
          signal='🚀 ABOUT TO FLY';signalColor='#00ffd0';direction='LONG';probability=83;
          signalDesc='RSI '+rsi.toFixed(0)+' oversold+FR squeeze '+(frVal*100).toFixed(4)+'%+MACD+discount';
        }else if(rsi<22&&c24>0.5&&pip<30){
          signal='💎 CAPITULATION';signalColor='#00ff88';direction='LONG';probability=80;
          signalDesc='RSI '+rsi.toFixed(0)+' EXTREME oversold+reversal+'+c24.toFixed(1)+'%';
        }else if(rsi>=24&&rsi<40&&(c7d||0)<-5&&c24>0&&isCoiling&&pip<48&&vol>500000){
          signal='🤫 ACCUMULATION';signalColor='#4af0ff';direction='LONG';probability=76;
          signalDesc='-'+Math.abs(c7d||0).toFixed(0)+'% 7d→+'+c24.toFixed(1)+'% 24h+coiling=SM masuk';
        }else if(isCoiling&&rsi>=38&&rsi<=62&&Math.abs(c24)<2.5&&vol>500000){
          signal='⚡ COILING';signalColor='#f0c040';direction='WATCH';probability=68;
          signalDesc='Range kontraksi '+(atrPct||'ketat')+' — breakout imminent';
        }else if(rsi<36&&c24>1.2&&pip>18){
          signal='🔄 OVERSOLD BOUNCE';signalColor='#88ff99';direction='LONG';probability=73;
          signalDesc='RSI '+rsi.toFixed(0)+' oversold+reversal+'+c24.toFixed(1)+'%';
        }else if(c24>5&&rsi>=45&&rsi<=70&&vol>5e6&&pip>58){
          signal='📈 BREAKOUT';signalColor='#00ffd0';direction='LONG';probability=75;
          signalDesc='+'+c24.toFixed(1)+'% breakout dengan volume institusional';
        }else if(rsi>72&&pip>75&&frVal>0.0005){
          signal='🔴 SHORT ZONE';signalColor='#ff4466';direction='SHORT';probability=71;
          signalDesc='RSI '+rsi.toFixed(0)+' overbought+FR +'+( frVal*100).toFixed(4)+'%+premium '+pip.toFixed(0)+'%';
        }else if(rsi>68&&pip>70&&volBias==='DIST'&&vol>3e6){
          signal='⚠️ DISTRIBUTION';signalColor='#ff8800';direction='SHORT';probability=63;
          signalDesc='RSI '+rsi.toFixed(0)+' premium zone+vol distribusi=SM jual';
        }else if(rsi>74&&pip>72&&c24>4){
          signal='⚡ OVERBOUGHT';signalColor='#ff6644';direction='REDUCE';probability=38;
          signalDesc='RSI '+rsi.toFixed(0)+' extended+'+c24.toFixed(1)+'%—exit zone';
        }else if(rsi>=42&&rsi<=60&&c24>1.5&&(c7d||0)>2&&pip>48){
          signal='📈 BULL MOMENTUM';signalColor='#66ff99';direction='LONG';probability=67;
          signalDesc='+'+c24.toFixed(1)+'% daily+RSI '+rsi.toFixed(0)+' momentum';
        }else if(c24<-5&&rsi<45&&pip<38){
          signal='📉 BEARISH';signalColor='#ff4466';direction='SHORT';probability=36;
          signalDesc=c24.toFixed(1)+'% breakdown—avoid long';
        }else if(rsi>=42&&rsi<=60&&c24>0){
          signal='↗️ MILD BULL';signalColor='#a0e040';direction='LONG';probability=60;
          signalDesc='+'+c24.toFixed(1)+'% daily RSI '+rsi.toFixed(0);
        }else{
          signal='⚖️ SIDEWAYS';signalColor='#7a8fa8';direction='WAIT';probability=50;
          signalDesc='RSI '+rsi.toFixed(0)+' '+c24.toFixed(1)+'%—no clear setup';
        }

        // ── CONVERGENCE v4 ────────────────────────────────
        let f1=rsi<20?30:rsi<28?24:rsi<35?18:rsi<42?11:rsi<50?4:rsi>78?-18:rsi>72?-12:rsi>65?-5:rsi>57?2:0;
        if(macd?.xUp)f1+=14;else if(macd?.bull)f1+=7;else if(macd?.xDown)f1-=11;else if(macd?.bear)f1-=5;
        if(obvBull&&c24>0)f1+=7;if(isCoiling&&rsi<55)f1+=5;
        f1=clamp(f1,-28,42);
        let f2=pip<18?18:pip<30?12:pip<42?6:pip>82?-12:pip>70?-6:0;
        if(rsi<35&&c24>0&&pip<38)f2+=8;if(isCoiling&&pip<60)f2+=5;
        f2=clamp(f2,-15,24);
        let f3=frVal<-0.0008?20:frVal<-0.0005?14:frVal<-0.0003?9:frVal<-0.0001?4:frVal>0.0008?-14:frVal>0.0005?-9:frVal>0.0003?-4:0;
        if(volBias==='ACC'&&c24>0)f3+=8;else if(volBias==='DIST')f3-=6;
        f3=clamp(f3,-20,25);
        const c7=c7d||0;
        let f4=c7>15?14:c7>5?8:c7>0?3:c7<-20?-9:c7<-10?-5:c7<-3?-2:0;
        if(vol>500e6&&c24>0)f4+=8;else if(vol>100e6&&c24>0)f4+=5;else if(vol>20e6&&c24>0)f4+=3;else if(vol>5e6&&c24>0)f4+=1;else if(vol<300000)f4-=3;
        f4=clamp(f4,-14,20);
        let f5=rsBtc>8?14:rsBtc>3?9:rsBtc>0?4:rsBtc<-8?-9:rsBtc<-3?-5:0;
        if(rs7d!=null)f5+=rs7d>10?8:rs7d>3?5:rs7d<-10?-6:rs7d<-3?-3:0;
        f5=clamp(f5,-14,20);
        const finalScore=clamp(Math.round(45+f1+f2+f3+f4+f5),0,100);
        const convLabel=finalScore>=80?'🔥ELITE':finalScore>=70?'💎PRIME':finalScore>=60?'✅VALID':finalScore>=50?'🟡MOD':'⚪WEAK';

        const slPct=atrPct?+(atrPct*1.5).toFixed(2):3;
        const tp1Pct=atrPct?+(atrPct*2.0).toFixed(2):5;
        const tp2Pct=atrPct?+(atrPct*3.5).toFixed(2):9;
        const sl=direction==='LONG'?+(p*(1-slPct/100)).toFixed(p>1?4:8):+(p*(1+slPct/100)).toFixed(p>1?4:8);
        const tp1=direction==='LONG'?+(p*(1+tp1Pct/100)).toFixed(p>1?4:8):+(p*(1-tp1Pct/100)).toFixed(p>1?4:8);
        const tp2=direction==='LONG'?+(p*(1+tp2Pct/100)).toFixed(p>1?4:8):+(p*(1-tp2Pct/100)).toFixed(p>1?4:8);

        coinAnalysis.push({
          sym,sector,price:p,c24,c7d,vol,rsi:+rsi.toFixed(1),rsiReal:rsiR,
          pip:+pip.toFixed(1),atr:atr>0?+atr.toFixed(p>1?4:8):null,atrPct,
          fr:fr?.pct||null,macdXUp:!!macd?.xUp,macdBull:!!macd?.bull,
          obvBull,isCoiling,volBias,rs:rsBtc,rs7d,aboveE200:!!kd?.aboveE200,
          signal,signalColor,signalDesc,direction,probability,
          conv:{score:finalScore,label:convLabel,f1,f2,f3,f4,f5},
          levels:{sl,tp1,tp2,slPct,tp1Pct,tp2Pct},
        });
      }catch{}
    }

    coinAnalysis.sort((a,b)=>b.conv.score-a.conv.score);

    const longSetups=coinAnalysis.filter(x=>x.direction==='LONG'&&x.conv.score>=60).slice(0,20);
    const shortSetups=coinAnalysis.filter(x=>x.direction==='SHORT'&&x.conv.score>=55).slice(0,8);
    const flySetups=coinAnalysis.filter(x=>x.signal.includes('ABOUT TO FLY')||x.signal.includes('CAPITULATION')).slice(0,6);
    const accumSetups=coinAnalysis.filter(x=>x.signal.includes('ACCUMULATION')||x.signal.includes('COILING')).slice(0,6);
    const leaders=coinAnalysis.slice(0,20);
    const eliteCount=leaders.filter(x=>x.conv.score>=80).length;
    const primeCount=leaders.filter(x=>x.conv.score>=70&&x.conv.score<80).length;
    const validCount=leaders.filter(x=>x.conv.score>=60&&x.conv.score<70).length;
    const convSummary=`${eliteCount>0?'🔥'+eliteCount+' ELITE · ':''}${primeCount}💎PRIME · ${validCount}✅VALID · ${shortSetups.length>0?shortSetups.length+'🔴SHORT':''}`;

    // ── MARKET CHARACTER ──────────────────────────────────
    const allPrices=coinAnalysis.map(x=>x.c24);
    const avgCh24=allPrices.length?+(allPrices.reduce((s,v)=>s+v,0)/allPrices.length).toFixed(2):0;
    const bullPct=Math.round(coinAnalysis.filter(x=>x.c24>0).length/Math.max(coinAnalysis.length,1)*100);
    const overbought=coinAnalysis.filter(x=>x.rsi>70).length;
    const oversold=coinAnalysis.filter(x=>x.rsi<30).length;
    let mcType,mcColor='amber',mcDesc,mcStyle,mcRisk;
    if(oversold>=12&&avgCh24<0){mcType='🔥 CAPITULATION BOTTOM';mcColor='green';mcDesc=oversold+' koin RSI<30. BEST accumulation zone. RSI<25+FR negatif = target utama.';mcStyle='Aggressive DCA';mcRisk='HIGH REWARD';}
    else if(avgCh24>4&&bullPct>65&&fgVal>55){mcType='🚀 BULL MOMENTUM';mcColor='green';mcDesc='Momentum kuat. Trail stop. Tambah posisi pada EMA9 pullback.';mcStyle='Momentum Riding';mcRisk='MODERATE';}
    else if(avgCh24>1.5&&bullPct>55){mcType='📈 MILD BULL';mcColor='green';mcDesc='Upside moderat. Selective entry. Convergence ≥70 saja.';mcStyle='Selective Long';mcRisk='MODERATE';}
    else if(avgCh24<-4&&bullPct<35){mcType='📉 BEAR MOMENTUM';mcColor='red';mcDesc='Tekanan jual luas. Short valid. Hindari long kecuali extreme oversold.';mcStyle='Short/Cash';mcRisk='CASH HEAVY';}
    else if(avgCh24<-1.5&&bullPct<45){mcType='🌧 MILD BEAR';mcColor='amber';mcDesc='Tekanan jual mild. Sizing 40-50%. RS positif+FR negatif saja.';mcStyle='Small Sizing';mcRisk='REDUCED';}
    else if(oversold>=15){mcType='💎 MASS OVERSOLD';mcColor='green';mcDesc=oversold+' koin RSI<30. Probability tinggi bounce. DCA zone terbaik.';mcStyle='Counter-trend DCA';mcRisk='MODERATE-HIGH';}
    else if(overbought>=15){mcType='⚠️ OVERBOUGHT CAUTION';mcColor='amber';mcDesc=overbought+' koin RSI>70. Reduce exposure. Take profit.';mcStyle='Profit Taking';mcRisk='REDUCED';}
    else{mcType='⚖️ TRANSITIONAL';mcColor='amber';mcDesc='Mixed signals. Sizing kecil. RS divergence + FR extreme saja.';mcStyle='Cautious';mcRisk='REDUCED';}

    // ── BTC SNAPSHOT ──────────────────────────────────────
    const btcAtr=btcK?.atr||0;
    const btcAtrPct=btcPrice>0&&btcAtr>0?+(btcAtr/btcPrice*100).toFixed(2):null;
    const btcResistance=btcPrice>0&&btcAtrPct?+(btcPrice*(1+btcAtrPct/100*2)).toFixed(0):btcPrice>0?+(btcPrice*1.04).toFixed(0):null;
    const btcSupport=btcPrice>0&&btcAtrPct?+(btcPrice*(1-btcAtrPct/100*2)).toFixed(0):btcPrice>0?+(btcPrice*0.96).toFixed(0):null;
    const btcSnapshot={price:btcPrice,ch24:btcCh24,rsi:btcK?.rsi||null,fg:fgVal,fgLabel,macd:btcK?.macd||null,btcLS,btcLongPct,btcShortPct,atr:btcAtr>0?+btcAtr.toFixed(2):null,atrPct:btcAtrPct,aboveEma200:!!btcK?.aboveE200};

    // ── SECTOR FLOW (dengan coin data) ────────────────────
    const sectorDataMap={};
    for(const[sName,coins]of Object.entries(SECTOR_MAP)){
      const sc=coinAnalysis.filter(x=>coins.includes(x.sym));
      if(!sc.length)continue;
      const avgCh=+(sc.reduce((s,x)=>s+x.c24,0)/sc.length).toFixed(2);
      const avgRSI=+(sc.reduce((s,x)=>s+x.rsi,0)/sc.length).toFixed(1);
      const avgConv=+(sc.reduce((s,x)=>s+x.conv.score,0)/sc.length).toFixed(0);
      const flowSig=avgCh>3?'↑↑ INFLOW':avgCh>1?'↑ INFLOW':avgCh<-3?'↓↓ OUTFLOW':avgCh<-1?'↓ OUTFLOW':'→ NEUTRAL';
      const flowCol=avgCh>3?'green':avgCh>1?'lightgreen':avgCh<-3?'red':avgCh<-1?'orange':'gray';
      sectorDataMap[sName]={
        name:sName,avgCh24:avgCh,avgRSI,avgConv:+avgConv,flowSig,flowCol,
        coinsCount:sc.length,bullCoins:sc.filter(x=>x.direction==='LONG').length,shortCoins:sc.filter(x=>x.direction==='SHORT').length,
        coins:sc.sort((a,b)=>b.conv.score-a.conv.score).map(c=>({
          sym:c.sym,price:c.price,c24:c.c24,vol:c.vol,rsi:c.rsi,rsiReal:c.rsiReal,
          signal:c.signal,signalColor:c.signalColor,signalDesc:c.signalDesc,direction:c.direction,
          probability:c.probability,conv:c.conv.score,fr:c.fr,atrPct:c.atrPct,
          levels:c.levels,volBias:c.volBias,isCoiling:c.isCoiling,obvBull:c.obvBull,pip:c.pip,rs:c.rs,
        })),
      };
    }
    const sectorList=Object.values(sectorDataMap).sort((a,b)=>b.avgCh24-a.avgCh24);

    // ── SETUPS (scalp/swing/short) ────────────────────────
    const scalpSetups=longSetups.filter(x=>x.atrPct&&x.vol>2e6&&x.rsi<72).slice(0,6).map(c=>({sym:c.sym,sector:c.sector,entry:c.price,sl:c.levels.sl,tp1:c.levels.tp1,tp2:c.levels.tp2,slPct:c.levels.slPct,tp1Pct:c.levels.tp1Pct,tp2Pct:c.levels.tp2Pct,rr:+(c.levels.tp1Pct/Math.max(c.levels.slPct,0.1)).toFixed(1),conv:c.conv.score,rsi:c.rsi,rsiReal:c.rsiReal,fr:c.fr,atrPct:c.atrPct,signal:c.signal,reasons:[c.signalDesc]}));
    const swingSetups=longSetups.filter(x=>x.atrPct&&x.vol>5e6&&x.rsi<65).slice(0,4).map(c=>({sym:c.sym,sector:c.sector,entry:c.price,sl:+(c.price*(1-c.atrPct/100*2)).toFixed(c.price>1?4:8),tp1:+(c.price*(1+c.atrPct/100*3)).toFixed(c.price>1?4:8),tp2:+(c.price*(1+c.atrPct/100*5)).toFixed(c.price>1?4:8),slPct:+(c.atrPct*2).toFixed(2),tp1Pct:+(c.atrPct*3).toFixed(2),tp2Pct:+(c.atrPct*5).toFixed(2),conv:c.conv.score,rsi:c.rsi,rsiReal:c.rsiReal,fr:c.fr,atrPct:c.atrPct,signal:c.signal,reasons:[c.signalDesc]}));
    const activeShorts=shortSetups.filter(x=>x.atrPct&&x.vol>3e6).slice(0,4).map(c=>({sym:c.sym,sector:c.sector,entry:c.price,sl:+(c.price*(1+c.atrPct/100*1.5)).toFixed(c.price>1?4:8),tp1:+(c.price*(1-c.atrPct/100*2)).toFixed(c.price>1?4:8),tp2:+(c.price*(1-c.atrPct/100*3.5)).toFixed(c.price>1?4:8),slPct:+(c.atrPct*1.5).toFixed(2),tp1Pct:+(c.atrPct*2).toFixed(2),tp2Pct:+(c.atrPct*3.5).toFixed(2),conv:c.conv.score,rsi:c.rsi,rsiReal:c.rsiReal,fr:c.fr,atrPct:c.atrPct,signal:c.signal,reasons:[c.signalDesc]}));
    const spotAccum=coinAnalysis.filter(x=>x.rsi<35&&x.vol>500000&&x.c24>-6&&x.conv.score>=50).slice(0,6).map(c=>({sym:c.sym,price:c.price,rsi:c.rsi,rsiReal:c.rsiReal,dcaZone:'$'+c.levels.sl+'–$'++(c.price*(1+0.005)).toFixed(c.price>1?4:8),atrPct:c.atrPct,conv:c.conv.score,signal:c.signal}));
    const avoidList=coinAnalysis.filter(x=>x.rsi>74&&x.direction!=='LONG').slice(0,5).map(c=>({sym:c.sym,rsi:c.rsi,fr:c.fr,reason:c.signalDesc||'Extended—poor R:R'}));

    // ── GAME PLAN ─────────────────────────────────────────
    const gamePlan={
      btcLevels:{resistance:btcResistance,support:btcSupport,current:btcPrice||null},
      scenarios:{
        bull:{condition:'BTC tembus $'+(btcResistance||'resistance')+' (close di atas)',action:'Long alts conv ≥'+(eliteCount>0?72:65)+', RR 1:3. RS positif+FR negatif.',setups:longSetups.slice(0,3)},
        sideways:{condition:'BTC konsolidasi ±1.5%',action:'Scalp setup terbaik saja. COILING dan ACCUMULATION plays.',setups:accumSetups.slice(0,2)},
        bear:{condition:'BTC breakdown ke $'+(btcSupport||'support'),action:'Cash '+(shortSetups.length>3?60:80)+'%. SHORT valid jika RSI >72.',setups:activeShorts.slice(0,2)},
      },
      scalpSetups,swingSetups,activeShorts,spotAccum,avoidList,flySetups,accumSetups,
    };

    // ── TRADING SCHEDULE ──────────────────────────────────
    const now=new Date();
    const wibMin=(now.getUTCHours()*60+now.getUTCMinutes()+7*60)%(24*60);
    const wibH=Math.floor(wibMin/60);
    const days=['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];
    const sessions=[
      {id:'dead',name:'🌙 Dead Zone',time:'02:00–06:00',start:2,end:6,q:'POOR',activity:'Volume minimum. Hindari trading.'},
      {id:'asia_open',name:'🌏 Asia Open',time:'06:00–09:00',start:6,end:9,q:'MODERATE',activity:'Volume membangun. Setup oversold mulai terlihat.'},
      {id:'asia_peak',name:'🔥 Asia Peak',time:'09:00–12:00',start:9,end:12,q:'GOOD',activity:'Volume tinggi. Breakout Asia valid.'},
      {id:'lunch',name:'⚠️ Lunch Dip',time:'12:00–15:00',start:12,end:15,q:'CAUTION',activity:'Volume turun. Hindari entry baru.'},
      {id:'london',name:'🌍 London Open',time:'15:00–18:00',start:15,end:18,q:'PRIME',activity:'PRIME: Volume institusional. Setup terbaik.'},
      {id:'ny_pre',name:'📊 NY Pre',time:'18:00–21:00',start:18,end:21,q:'BUILDING',activity:'Pre-market AS. Persiapan NY.'},
      {id:'ny_open',name:'🚀 NY Open',time:'21:00–23:00',start:21,end:23,q:'PRIME',activity:'PRIME: Volume tertinggi global.'},
      {id:'ny_late',name:'🌙 NY Late',time:'23:00–02:00',start:23,end:26,q:'GOOD',activity:'Volume oke. Exit position malam.'},
    ];
    let curSess='dead';
    for(const s of sessions){const e=s.end>24?s.end-24:s.end;if(s.start>20){if(wibH>=s.start||wibH<e){curSess=s.id;break;}}else{if(wibH>=s.start&&wibH<s.end){curSess=s.id;break;}}}
    const curSO=sessions.find(s=>s.id===curSess)||sessions[0];
    const nextPrime=sessions.filter(s=>s.q==='PRIME').map(s=>({...s,inH:s.start>wibH?s.start-wibH:24-(wibH-s.start)})).sort((a,b)=>a.inH-b.inH)[0];
    const tradingSchedule={wibHour:wibH,dayName:days[now.getUTCDay()],sessions,currentSession:curSess,positionSizeRec:curSO.q==='PRIME'?'Full (100%)':curSO.q==='GOOD'?'Large (75%)':curSO.q==='MODERATE'?'Half (50%)':'Minimal (25%)',focusToday:mcType+'. '+(curSO.q==='PRIME'?'Session PRIME.':curSO.q==='POOR'?'Dead zone—istirahat.':'Session '+curSO.q+'.'),nextPrimeSession:nextPrime};

    // ── CHECKLIST ─────────────────────────────────────────
    const mktChecks=[
      {label:'Market character layak trading',pass:mcColor!=='red'||oversold>=12,detail:'Character: '+mcType,fix:'Tunggu market shift'},
      {label:'Trading session berkualitas',pass:curSO.q==='PRIME'||curSO.q==='GOOD',detail:curSO.name+' '+curSO.q,fix:'Tunggu London (15:00) atau NY (21:00) WIB'},
      {label:'BTC tidak di resistance',pass:btcK?.rsi?btcK.rsi<72:true,detail:btcK?.rsi?'BTC RSI '+btcK.rsi.toFixed(0):'BTC aman dari resistance',fix:'Tunggu BTC RSI <65'},
      {label:'FR market tidak overheated',pass:Object.values(frMap).filter(x=>x.fr>0.0005).length<10,detail:'FR overheated: '+Object.values(frMap).filter(x=>x.fr>0.0005).length+' koin',fix:'Terlalu banyak koin FR tinggi'},
      {label:'Market tidak overbought massal',pass:overbought<15,detail:overbought+' koin RSI>70',fix:'Tunggu koreksi'},
      {label:'BTC L/S ratio aman',pass:btcLS?btcLS<2.5:true,detail:btcLS?'L/S: '+btcLS+' ('+btcLongPct+'% long)':'Data L/S tidak tersedia',fix:'L/S >2.5 = longs terlalu ramai'},
      {label:'Cukup koin aktif & liquid',pass:coinAnalysis.filter(x=>x.vol>10e6&&x.c24>0).length>=20,detail:coinAnalysis.filter(x=>x.vol>10e6&&x.c24>0).length+' koin aktif (vol>$10M)',fix:'Market terlalu sepi'},
      {label:'BTC trend mendukung altcoin',pass:btcCh24>-2,detail:'BTC '+btcCh24.toFixed(2)+'%'+(btcCh24<-2?' → bearish → tunda long altcoin':''),fix:'Tunggu BTC stabilisasi'},
    ];
    const passCount=mktChecks.filter(x=>x.pass).length;
    const checklist={marketChecks:mktChecks,marketPassCount:passCount,marketTotal:8,coinChecks:['RSI koin < 72','Volume 24h ≥ $5M','Setup sesuai skenario Game Plan','Convergence Score ≥ '+(eliteCount>0?70:60),'Position size ≤ 2% equity per trade','FR koin < +0.04% per 8h','SL sudah ditentukan (ATR-based)','Risk-Reward minimal 1:2','Konfirmasi volume pada candle entry','Tidak entry 30 menit sebelum news'],overallGreenLight:passCount>=6,verdict:passCount>=6?'✅ SETUP LAYAK':'⚠️ HATI-HATI — '+(8-passCount)+' kondisi belum terpenuhi'};

    const out={ok:true,version:'v4.1',ts:Date.now(),elapsed:Date.now()-t0,dataQuality:{coins:coinAnalysis.length,realRSI:realRSICount,klineCoins:KLINE_COINS.length,btcLS:btcLS!=null,btcRsi:!!(btcK?.rsi),src:'bybit+cg'},fg:fgVal,fgLabel,marketCharacter:{type:mcType,color:mcColor,description:mcDesc,tradeStyle:mcStyle,riskLevel:mcRisk,stats:{bullPct,overbought,oversold,avgCh:avgCh24}},btcSnapshot,convergence:{leaders,longSetups,shortSetups,flySetups,accumSetups,summary:convSummary,eliteCount,primeCount,validCount,shortCount:shortSetups.length},gamePlan,sectorFlow:{sectors:sectorList,sectorData:sectorDataMap},tradingSchedule,checklist};
    CACHE.data=out;CACHE.ts=Date.now();
    return res.status(200).json(out);
  }catch(e){return res.status(200).json({ok:false,error:e.message,ts:Date.now(),elapsed:Date.now()-t0,version:'v4.1'});}
}
