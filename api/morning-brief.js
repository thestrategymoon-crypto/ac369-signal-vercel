// api/morning-brief.js - AC369 FUSION v15.0 POWER UPGRADE
// OI Delta + Multi-TF RSI + 23 signals + Convergence 9-factor
// Pure ASCII, 0 non-ASCII, 0 backtick. GUARANTEED no HTTP 500.

const N=(v,d=0)=>{try{const n=+v;return isNaN(n)||!isFinite(n)?d:n}catch{return d}};
const A=(v)=>{try{return Array.isArray(v)?v:[]}catch{return[]}};
const cl=(v,a,b)=>Math.max(a,Math.min(b,N(v)));
const STAB=new Set(['USDT','USDC','BUSD','DAI','TUSD','FDUSD','USDE','FRAX','GUSD','USDP']);
const BAD=['UP','DOWN','BULL','BEAR','3L','3S','2L','2S','5L','5S'];
const SECS={Bitcoin:['BTC'],Ethereum:['ETH'],L1:['SOL','ADA','AVAX','TON','NEAR','SUI','APT','SEI','INJ','HBAR'],L2:['ARB','OP','MATIC','STRK','IMX','MANTA','ZK','SCROLL'],DeFi:['UNI','AAVE','CRV','MKR','SNX','COMP','PENDLE','GMX','JUP','RAY','DYDX','ORCA'],Payments:['XRP','LTC','BCH','DASH','XLM','XMR','TRX'],Gaming:['AXS','SAND','MANA','GALA','ILV','BEAM','MAGIC'],AIDePin:['RENDER','FET','TAO','WLD','IO','ARKM','VIRTUAL','OLAS','GRASS','OCEAN'],Infrastructure:['LINK','DOT','ATOM','AR','FIL','GRT','API3','BAND'],Meme:['DOGE','SHIB','PEPE','WIF','BONK','FLOKI','BOME','NEIRO'],Trending:[]};
const getSec=s=>{try{for(const[n,v]of Object.entries(SECS))if(v.includes(s))return n}catch{}return'Trending'};
const rsi14=a=>{try{if(!a||a.length<16)return null;let g=0,l=0;for(let i=1;i<=14;i++){const d=a[a.length-i]-a[a.length-i-1];d>0?g+=d:l-=d}const ag=g/14,al=l/14;if(al===0)return 100;return+(100-100/(1+ag/al)).toFixed(2)}catch{return null}};
const ema=(a,p)=>{try{if(!a||a.length<2)return N(a&&a[a.length-1]);const k=2/(p+1);return a.reduce((prev,v,i)=>i===0?v:prev*(1-k)+v*k)}catch{return 0}};
const macd14=a=>{try{if(!a||a.length<36)return null;const k12=2/13,k26=2/27;let e12=a[0],e26=a[0];for(const v of a){e12=e12*(1-k12)+v*k12;e26=e26*(1-k26)+v*k26}const ml=e12-e26,sig=ml*(2/10);return{bull:ml>sig&&ml>0,xUp:ml>sig&&ml<0,xDown:ml<sig&&ml>0,val:+ml.toFixed(4)}}catch{return null}};

// OI Delta cache - persists between requests (module-level)
const OI_CACHE={prev:{},prevTs:0};

const SAFE={ok:false,version:'v15',ts:0,elapsed:0,dataQuality:{coins:0,realRSI:0},fg:50,fgLabel:'Neutral',marketCharacter:{type:'TRANSITIONAL',color:'amber',description:'Data tidak tersedia',tradeStyle:'Cautious',riskLevel:'REDUCED',positionSize:'Minimal (25%)',marketPct:'50% bullish',stats:{oversold:0,overbought:0,bullish:0,bearish:0,coiling:0}},btcSnapshot:{price:0,ch24:0,rsi:null,rsiSlope:'-',rsiDir:'flat',rsi1h:null,rsi1d:null,volTrend:'-',atrPct:0,atr:0,fg:50,fgLabel:'Neutral',macd:null,resistance:null,support:null,current:0,aboveEma200:false,btcLS:false,btcLongPct:null,btcShortPct:null,d1rsi:null,d1trend:'-'},convergence:{leaders:[],longSetups:[],shortSetups:[],flySetups:[],accumSetups:[],summary:'-',eliteCount:0,primeCount:0,validCount:0,shortCount:0},gamePlan:{btcLevels:{},scenarios:{bull:{condition:'-',action:'-',setups:[]},sideways:{condition:'-',action:'-'},bear:{condition:'-',action:'-'}},scalpSetups:[],swingSetups:[],activeShorts:[],spotAccum:[],avoidList:[]},sectorFlow:{sectors:[],sectorData:{}},tradingSchedule:{wibHour:0,dayName:'-',sessions:[],currentSession:'-',currentSessionObj:{id:'dead',name:'Dead Zone',time:'02:00-06:00',q:'POOR',activity:'-'},focusToday:'-',nextPrimeSession:null},checklist:{marketChecks:[],coinChecks:[],marketPassCount:0,marketTotal:8,overallGreenLight:false,verdict:'Data tidak tersedia'},whaleFingerprint:[],squeezeRadar:[],stealthVolume:[],hiddenGems:[],momentumShift:[],oiDeltaLeaders:[],retailTrapList:[],retailSqueezeList:[],dailyOpportunityScore:{score:50,label:'NORMAL',action:'-'},marketRegime:{regime:'NORMAL',regimeColor:'gray',regimeDesc:'-',sizingGuidance:'-'},todaysBestTrade:null};
const CACHE={d:null,t:0};

export default async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Cache-Control','no-store');
  const t0=Date.now();
  if(CACHE.d&&(t0-CACHE.t)<90000)return res.status(200).json(CACHE.d);
  try{
    const get=(url,ms)=>fetch(url,{signal:AbortSignal.timeout?AbortSignal.timeout(ms):undefined}).then(r=>r.json()).catch(()=>null);
    // 18 parallel calls: 13 original + 5 new 1H klines
    const [R0,R1,R2,R3,R4,R5,R6,R7,R8,R9,R10,R11,R12,R13,R14,R15,R16,R17]=await Promise.allSettled([
      get('https://api.bybit.com/v5/market/tickers?category=linear',2500),          // R0: Bybit all futures
      get('https://api.mexc.com/api/v3/ticker/24hr',2200),                          // R1: MEXC all spot
      get('https://api.bybit.com/v5/market/kline?category=linear&symbol=BTCUSDT&interval=240&limit=52',2500),  // R2: BTC 4H Bybit
      get('https://api.bybit.com/v5/market/kline?category=linear&symbol=ETHUSDT&interval=240&limit=52',2500),  // R3: ETH 4H Bybit
      get('https://api.bybit.com/v5/market/kline?category=linear&symbol=SOLUSDT&interval=240&limit=52',2500),  // R4: SOL 4H Bybit
      get('https://api.bybit.com/v5/market/account-ratio?category=linear&symbol=BTCUSDT&period=1h&limit=1',4500), // R5: BTC L/S
      get('https://alternative.me/crypto/fear-and-greed-index/?format=json&limit=1',2000),  // R6: F&G
      get('https://api.bybit.com/v5/market/kline?category=linear&symbol=BNBUSDT&interval=240&limit=52',2500),  // R7: BNB 4H Bybit
      get('https://api.bybit.com/v5/market/kline?category=linear&symbol=XRPUSDT&interval=240&limit=52',2500),  // R8: XRP 4H Bybit
      get('https://api.bybit.com/v5/market/kline?category=linear&symbol=LINKUSDT&interval=240&limit=52',2500), // R9: LINK 4H Bybit
      get('https://api.bybit.com/v5/market/kline?category=linear&symbol=AVAXUSDT&interval=240&limit=52',2500), // R10: AVAX 4H Bybit
      get('https://api.bybit.com/v5/market/kline?category=linear&symbol=SOLUSDT&interval=D&limit=20',2000),  // R11: SOL 1D Bybit
      get('https://api.bybit.com/v5/market/kline?category=linear&symbol=BTCUSDT&interval=D&limit=20',2000),  // R12: BTC 1D Bybit
      get('https://api.bybit.com/v5/market/kline?category=linear&symbol=BTCUSDT&interval=60&limit=20',2000),  // R13: BTC 1H Bybit
      get('https://api.bybit.com/v5/market/kline?category=linear&symbol=ETHUSDT&interval=60&limit=20',2000),  // R14: ETH 1H Bybit
      get('https://api.bybit.com/v5/market/kline?category=linear&symbol=SOLUSDT&interval=60&limit=20',2000),  // R15: SOL 1H Bybit
      get('https://api.bybit.com/v5/market/kline?category=linear&symbol=BNBUSDT&interval=60&limit=20',2000),  // R16: BNB 1H Bybit
      get('https://api.bybit.com/v5/market/kline?category=linear&symbol=XRPUSDT&interval=60&limit=20',2000),  // R17: XRP 1H Bybit
    ]);

    // Build coin map from Bybit
    const cm={};
    try{for(const t of A(R0.value&&R0.value.result?R0.value.result.list:[])){try{
      const s=String(t.symbol||'').replace(/USDT|PERP/g,'');
      if(!s||s.length>12||STAB.has(s)||BAD.some(x=>s.endsWith(x)))continue;
      const p=N(t.lastPrice);if(p<=0||p>1e10)continue;
      const prev=N(t.prevPrice24h||p),c24=prev>0?+((p-prev)/prev*100).toFixed(2):0;
      const h=N(t.highPrice24h||p*1.01),l=N(t.lowPrice24h||p*0.99);
      const pip=h>l?cl((p-l)/(h-l)*100,0,100):50;
      const fr=N(t.fundingRate);
      const bid1=N(t.bid1Size),ask1=N(t.ask1Size);
      const bidAsk=bid1+ask1>0?+(bid1/(bid1+ask1)*100).toFixed(1):50;
      const rLong=Math.max(28,Math.min(72,+(50+(bidAsk-50)*0.6+fr*100*160*0.4).toFixed(1)));
      const curOI=N(t.openInterestValue);
      // OI Delta: compare current OI vs cached previous OI
      const prevOI=OI_CACHE.prev[s]||curOI;
      const oiDelta=prevOI>0?+((curOI-prevOI)/prevOI*100).toFixed(3):0;
      // OI Pattern: combine OI delta with price change
      let oiPattern='NEUTRAL';
      if(oiDelta>2&&c24>0.5)oiPattern='WHALE_LONG';// OI up + price up = new longs
      else if(oiDelta>2&&c24<-0.5)oiPattern='WHALE_SHORT';// OI up + price down = new shorts
      else if(oiDelta<-2&&c24>0.5)oiPattern='SHORT_SQUEEZE';// OI down + price up = shorts covering
      else if(oiDelta<-2&&c24<-0.5)oiPattern='LONG_LIQ';// OI down + price down = longs liquidated
      else if(oiDelta>1)oiPattern='OI_RISING';
      else if(oiDelta<-1)oiPattern='OI_FALLING';
      cm[s]={p,fr,oi:curOI,oiDelta,oiPattern,c24,v:N(t.turnover24h),h,l,pip,fp:+(fr*100).toFixed(5),bidAsk,rLong,rShort:+(100-rLong).toFixed(1),src:'by'};
    }catch(e){}}}catch(e){}
    // Save OI snapshot for next request
    const now=Date.now();
    if(now-OI_CACHE.prevTs>60000){// Update every 60s
      OI_CACHE.prev={};
      for(const[s,by]of Object.entries(cm))OI_CACHE.prev[s]=by.oi||0;
      OI_CACHE.prevTs=now;
    }
    // MEXC lowcaps
    try{for(const t of A(R1.value||[])){try{
      const s=String(t.symbol||'').replace(/USDT/g,'');
      if(!s||s.length>12||STAB.has(s)||BAD.some(x=>s.endsWith(x)))continue;
      const p=N(t.lastPrice);if(p<=0||p>1e10||cm[s])continue;
      const c24=+N(t.priceChangePercent).toFixed(2);
      const h=N(t.highPrice),l=N(t.lowPrice),pip=h>l?cl((p-l)/(h-l)*100,0,100):50;
      cm[s]={p,fr:0,oi:0,oiDelta:0,oiPattern:'NEUTRAL',c24,v:N(t.quoteVolume),h,l,pip,fp:0,bidAsk:50,rLong:50,rShort:50,src:'mx'};
    }catch(e){}}}catch(e){}

    // 1H RSI map
    const km1h={};
    for(const[sym,kR]of[['BTC',R13],['ETH',R14],['SOL',R15],['BNB',R16],['XRP',R17]]){
      try{
        // Handle both MEXC (direct array) and Bybit (result.list) format
        let raw=[];
        const kv=kR.value;
        if(Array.isArray(kv))raw=kv;
        else if(kv&&kv.result&&Array.isArray(kv.result.list))raw=[...kv.result.list].reverse();
        if(raw.length<16)continue;
        const cls=raw.map(d=>N(d[4])).filter(v=>v>0);
        const r=rsi14(cls);
        if(r)km1h[sym]=+r.toFixed(2);
      }catch(e){}
    }

    // 4H + 1D kline processing
    const km={};let realRSI=0;
    for(const[sym,kR,kR1d]of[['BTC',R2,R12],['ETH',R3,null],['SOL',R4,R11],['BNB',R7,null],['XRP',R8,null],['LINK',R9,null],['AVAX',R10,null]]){
      try{
        // Handle both MEXC (direct array) and Bybit (result.list) format
        let raw=[];
        const kv=kR.value;
        if(Array.isArray(kv))raw=kv;
        else if(kv&&kv.result&&Array.isArray(kv.result.list))raw=[...kv.result.list].reverse();
        if(raw.length<16)continue;
        const K=raw.map(d=>({o:N(d[1]),h:N(d[2]),l:N(d[3]),c:N(d[4]),v:N(d[5])}));
        const cls=K.map(x=>x.c).filter(v=>v>0);if(cls.length<16)continue;
        const rsiV=rsi14(cls);if(!rsiV)continue;
        const lp=cls[cls.length-1];
        const e9=ema(cls.slice(-9),9),e200=ema(cls,200);
        let atrV=0;try{atrV=K.slice(-14).reduce((s,k,i)=>{const ph=i>0?K.slice(-14)[i-1].c:k.c;return s+Math.max(k.h-k.l,Math.abs(k.h-ph),Math.abs(k.l-ph))},0)/14;}catch(e){}
        const a20=cls.slice(-20).reduce((s,v)=>s+v,0)/20,r5=cls.slice(-5).reduce((a,b)=>a+b,0)/5;
        const vBull=K.slice(-14).filter(k=>k.c>k.o).reduce((s,k)=>s+k.v,0);
        const vBear=K.slice(-14).filter(k=>k.c<=k.o).reduce((s,k)=>s+k.v,0);
        const macdV=macd14(cls);
        const rp1=rsi14(cls.slice(0,-1))||rsiV;
        const slopeDir=rsiV>rp1+0.3?'up':rsiV<rp1-0.3?'down':'flat';
        const slopeTxt=slopeDir==='up'?'rising':slopeDir==='down'?'falling':'flat';
        const rv=K.slice(-5).map(k=>k.v);
        const volTr=rv.length>=3?(rv[rv.length-1]>rv[rv.length-2]*1.2?'up':rv[rv.length-1]<rv[rv.length-2]*0.8?'down':'stable'):'stable';
        let div=null,divStr=0;
        try{const p4=cls[cls.length-5]||lp,p8=cls[cls.length-9]||lp,r4=rsi14(cls.slice(0,-4)),r8=rsi14(cls.slice(0,-8));
          if(r4&&r8){if(lp<p4&&p4<p8&&rsiV>r4&&r4>r8){div='BULLISH';divStr=Math.min(100,Math.round((rsiV-r4)*3+10));}
          else if(lp>p4&&p4>p8&&rsiV<r4&&r4<r8){div='BEARISH';divStr=Math.min(100,Math.round((r4-rsiV)*3+10));}}}catch(e){}
        // 1D RSI
        let rsi1d=null;
        try{if(kR1d){const raw1d=Array.isArray(kR1d.value)?kR1d.value:[];if(raw1d.length>=16){const cls1d=raw1d.map(d=>N(d[4])).filter(v=>v>0);rsi1d=rsi14(cls1d)?+rsi14(cls1d).toFixed(1):null;}}}catch(e){}
        km[sym]={rsi:+rsiV.toFixed(2),slopeDir,slopeTxt,macd:macdV,e9,e200,atr:+atrV.toFixed(8),price:lp,aboveE200:lp>e200,isCoiling:a20>0&&r5<a20*0.62,vB:vBull>vBear*1.2,volTrend:volTr,div,divStr,rsi1h:km1h[sym]||null,rsi1d,src:'mx'};
        realRSI++;
      }catch(e){}
    }
    let btcD1rsi=null;
    try{
    let raw_d1=[];const kd1=R12.value;
    if(Array.isArray(kd1))raw_d1=kd1;
    else if(kd1&&kd1.result&&Array.isArray(kd1.result.list))raw_d1=[...kd1.result.list].reverse();
    const raw=raw_d1;if(raw.length>=16){const cls=raw.map(d=>N(d[4])).filter(v=>v>0);btcD1rsi=rsi14(cls)?+rsi14(cls).toFixed(1):null;}}catch(e){}


    // ---------------------------------------
    // OI DELTA: Fetch real 1H OI history for top 20 Bybit coins
    // This gives accurate OI delta without relying on module cache
    try{
      const oiTopCoins=Object.entries(cm)
        .filter(([s,v])=>v.src==='by'&&(v.oi||0)>100e6&&!/^[0-9]/.test(s)&&!s.endsWith('USDC'))
        .sort((a,b)=>(b[1].oi||0)-(a[1].oi||0)).slice(0,20).map(([s])=>s);
      const oiHist=await Promise.allSettled(
        oiTopCoins.map(s=>get('https://api.bybit.com/v5/market/open-interest?category=linear&symbol='+s+'USDT&intervalTime=1h&limit=2',2500))
      );
      oiHist.forEach((res,i)=>{
        try{
          const sym=oiTopCoins[i];
          const list=res&&res.value&&res.value.result&&res.value.result.list;
          if(!list||list.length<2)return;
          const c2=+(list[0].openInterest||0),p2=+(list[1].openInterest||0);
          if(p2>0&&c2>0)OI_CACHE.prev[sym]=p2;
        }catch(e2){}
      });
    }catch(e){}

    // PHASE 2: DYNAMIC REAL KLINES TOP 50 ALTCOINS
    // Filter Bybit by OI > $100M, pick top 50
    // Fetch 4H klines in parallel - real RSI/EMA/MACD
    // ---------------------------------------
    const TOP7=new Set(['BTC','ETH','SOL','BNB','XRP','LINK','AVAX']);
    const phase2Coins=[];
    try{
      Object.entries(cm).forEach(([s,by])=>{
        if(TOP7.has(s))return;
        if(by.src!=='by')return;
        // Skip non-standard symbols (number prefix, USDC pairs, etc)
        if(/^[0-9]/.test(s))return;// 1000PEPE, 10000LADYS etc
        if(s.endsWith('USDC')||s.endsWith('USD')||s.endsWith('EUR'))return;
        if(s.length>10)return;// skip very long symbols
        if((by.oi||0)<30e6)return;// lower threshold $30M
        if((by.v||0)<500000)return;// lower vol threshold $500K
        phase2Coins.push({sym:s,oi:by.oi||0});
      });
      phase2Coins.sort((a,b)=>b.oi-a.oi);
      phase2Coins.splice(50);
    }catch(e){}

    if(phase2Coins.length>0){
      try{
        const p2Results=await Promise.allSettled(
          phase2Coins.map(c=>get('https://api.bybit.com/v5/market/kline?category=linear&symbol='+c.sym+'USDT&interval=240&limit=52',3000))
        );
        p2Results.forEach((res,i)=>{
          try{
            const sym=phase2Coins[i].sym;
            let raw=[];
            const pv=res.value;
            if(Array.isArray(pv))raw=pv;
            else if(pv&&pv.result&&Array.isArray(pv.result.list))raw=[...pv.result.list].reverse();
            if(raw.length<16)return;
            const K=raw.map(d=>({o:N(d[1]),h:N(d[2]),l:N(d[3]),c:N(d[4]),v:N(d[5])}));
            const cls=K.map(x=>x.c).filter(v=>v>0);
            if(cls.length<16)return;
            const rsiV=rsi14(cls);if(!rsiV)return;
            const lp=cls[cls.length-1];
            const e9=ema(cls.slice(-9),9),e200=ema(cls,200),e21=ema(cls.slice(-21),21);
            let atrV=0;try{atrV=K.slice(-14).reduce((s,k,i)=>{const ph=i>0?K.slice(-14)[i-1].c:k.c;return s+Math.max(k.h-k.l,Math.abs(k.h-ph),Math.abs(k.l-ph));},0)/14;}catch(e2){}
            const vBull=K.slice(-14).filter(k=>k.c>k.o).reduce((s,k)=>s+k.v,0);
            const vBear=K.slice(-14).filter(k=>k.c<=k.o).reduce((s,k)=>s+k.v,0);
            const k12=2/13,k26=2/27;let em12=cls[0],em26=cls[0];
            cls.forEach(v=>{em12=em12*(1-k12)+v*k12;em26=em26*(1-k26)+v*k26;});
            const macdLine=em12-em26,sigLine=macdLine*(2/10);
            const rp1=rsi14(cls.slice(0,-1))||rsiV;
            const sDir=rsiV>rp1+0.3?'up':rsiV<rp1-0.3?'down':'flat';
            const sTxt=sDir==='up'?'rising':sDir==='down'?'falling':'flat';
            const rv=K.slice(-5).map(k=>k.v);
            const volTr=rv.length>=3?(rv[rv.length-1]>rv[rv.length-2]*1.2?'up':rv[rv.length-1]<rv[rv.length-2]*0.8?'down':'stable'):'stable';
            // 5-day price range for coiling detection
            const last5cls=cls.slice(-30);
            const hi5=Math.max(...last5cls),lo5=Math.min(...last5cls);
            const rangeW5=lp>0?(hi5-lo5)/lp*100:10;
            let div=null,divStr=0;
            try{const p4=cls[cls.length-5]||lp,p8=cls[cls.length-9]||lp;const r4=rsi14(cls.slice(0,-4)),r8=rsi14(cls.slice(0,-8));
              if(r4&&r8){if(lp<p4&&p4<p8&&rsiV>r4&&r4>r8){div='BULLISH';divStr=Math.min(100,Math.round((rsiV-r4)*3+10));}
              else if(lp>p4&&p4>p8&&rsiV<r4&&r4<r8){div='BEARISH';divStr=Math.min(100,Math.round((r4-rsiV)*3+10));}}
            }catch(e2){}
            km[sym]={rsi:+rsiV.toFixed(2),slopeDir:sDir,slopeTxt:sTxt,macd:{bull:macdLine>sigLine,xUp:macdLine>sigLine&&macdLine<0,xDown:macdLine<sigLine&&macdLine>0,val:+macdLine.toFixed(6)},e9,e21,e200,atr:+atrV.toFixed(8),price:lp,aboveE200:lp>e200,isCoiling:rangeW5<8,vB:vBull>vBear*1.2,volTrend:volTr,div,divStr,rsi1h:null,rsi1d:null,rangeW5:+rangeW5.toFixed(2),src:'p2'};
            realRSI++;
          }catch(e2){}
        });
      }catch(e){}
    }

    // BTC snapshot
    const btcK=km.BTC||null,btcBy=cm.BTC||{};
    const btcP=N(btcK&&btcK.price?btcK.price:btcBy.p||0),btcC=N(btcBy.c24||0);
    const btcATRpct=btcK&&btcK.atr&&btcP>0?+(btcK.atr/btcP*100).toFixed(2):1.0;
    const btcATRusd=btcK&&btcK.atr?+btcK.atr.toFixed(2):btcP*0.01;
    let fg=50,fgLabel='Neutral';
    try{const fd=R6.value&&R6.value.data&&R6.value.data[0];if(fd){fg=N(fd.value);fgLabel=fd.value_classification||'Neutral';}}catch(e){}
    let btcLS=null,btcL=null,btcS=null;
    try{const row=A(R5.value&&R5.value.result?R5.value.result.list:[])[0];if(row){btcL=+N(row.buyRatio*100).toFixed(2);btcS=+N(row.sellRatio*100).toFixed(2);btcLS=btcS>0?+(btcL/btcS).toFixed(2):null;}}catch(e){}

    // Pre-compute bear regime estimate (BEFORE coin loop)
    // mcType not yet available - use BTC data as proxy
    const btcRsiPre=btcK&&btcK.rsi?btcK.rsi:50;
    const preBearEst=btcRsiPre<45&&btcC<-0.5;// BTC oversold + falling = bear regime
    // We'll use this as regime estimate inside the loop
    // True bear = BTC RSI < 35 OR (BTC RSI < 45 + BTC 24h negative + FG < 35)
    const bearEstimate=btcRsiPre<35||(btcRsiPre<45&&btcC<-0.5&&fg<40);

    // Signal engine v3 - 23 signals
    const coins=[];
    for(const[sym,by]of Object.entries(cm)){try{
      const p=by.p,c24=by.c24,vol=by.v,fp=by.fp;
      if(!p||p<=0||!sym)continue;
      const sec=getSec(sym);
      const km2=km[sym]||null;
      const rR=!!(km2&&km2.rsi>0);
      const hasPip=by.src==='by'&&by.h>by.l&&by.h!==by.l;
      const frEff=(by.fr||0)*(-5000);
      const rsi=rR?km2.rsi:cl(50+(hasPip?(by.pip-50)*0.48:0)+c24*(hasPip?2.0:3.5)+frEff,8,92);
      const rsi1h=km2?km2.rsi1h||null:null;
      const rsi1d=km2?km2.rsi1d||null:null;
      const ap=km2&&km2.atr&&km2.atr>0&&p>0?+(km2.atr/p*100).toFixed(2):0;
      const ic=!!(km2&&km2.isCoiling);
      const vb=!!(km2&&km2.vB);
      const div=km2?km2.div||null:null;
      const divStr=km2?km2.divStr||0:0;
      const fr=by.fr||0;
      const oi=by.oi||0;
      const oiDelta=by.oiDelta||0;
      const oiPattern=by.oiPattern||'NEUTRAL';
      const rs=btcP>0?+(c24-btcC).toFixed(2):0;
      const pip=by.pip||50;
      const volScore=vol>50e6?5:vol>20e6?4:vol>5e6?3:vol>1e6?2:vol>100000?1:0;


      // WHALE LOADING SCORE - 7 factor detection
      // Factor A: Volume Anomaly (25pts) - high vol relative to OI/position size
      const volOI=oi>0?vol/oi:0;// vol/OI ratio = turnover relative to position
      const fA_vol=volOI>0.5?25:volOI>0.3?18:volOI>0.15?12:vol>20e6?10:vol>5e6?5:0;
      // Factor B: OI Rising + Price Flat (25pts) - KEY WHALE SIGNAL
      const fB_oiFlat=oiDelta>3&&Math.abs(c24)<1.5?25:oiDelta>1.5&&Math.abs(c24)<2?18:oiDelta>0.5&&Math.abs(c24)<1?10:0;
      // Factor C: RSI Accumulation Zone (20pts) - 33-57 sweet spot
      const rsiZone=rsi>=33&&rsi<=57;
      const fC_rsi=rsi>=38&&rsi<=52?20:rsi>=33&&rsi<=57?14:rsi>=28&&rsi<=62?6:0;
      // Factor D: FR Neutral/Negative (15pts) - no retail FOMO
      const fD_fr=fr<-0.0003?15:fr<-0.0001?12:fr<0?8:fr===0?5:fr<0.0001?2:0;
      // Factor E: Price Range Tight (10pts) - (H-L)/price < 3%
      const rangeWidth=by.h>by.l&&by.p>0?(by.h-by.l)/by.p*100:5;
      const fE_range=rangeWidth<1.5?10:rangeWidth<2.5?7:rangeWidth<4?3:0;
      // Factor F: Bid/Ask balanced (3pts) - whale not showing hand
      const fF_ba=by.bidAsk&&by.bidAsk>=45&&by.bidAsk<=58?3:1;
      // Factor G: RS vs BTC in loading range (2pts) - not extreme move
      const fG_rs=Math.abs(rs)<3?2:Math.abs(rs)<5?1:0;
      // Total Whale Loading Score
      const whaleLoadScore=Math.min(100,fA_vol+fB_oiFlat+fC_rsi+fD_fr+fE_range+fF_ba+fG_rs);
      const isWhaleLoading=whaleLoadScore>=65&&by.src==='by'&&oi>100e6;
      const whaleLoadLabel=whaleLoadScore>=80?'CONFIRMED':whaleLoadScore>=65?'LIKELY':whaleLoadScore>=50?'WATCH':'';


      // PRE-PUMP SCORE - 6 factor pump hunter
      // Requires real klines (km2) for accuracy
      const km2rng=km2?km2.rangeW5||10:((by.h>0&&by.l>0&&by.p>0)?(by.h-by.l)/by.p*100:10);
      // Factor P1: Price Coiling (5d range) - tight = energy stored
      const fP1=km2rng<5?25:km2rng<8?18:km2rng<12?10:km2rng<18?4:0;
      // Factor P2: OI Accumulation + price flat
      const fP2=oiDelta>2&&Math.abs(c24)<1.5?25:oiDelta>1&&Math.abs(c24)<2?18:oiDelta>0.3&&Math.abs(c24)<1.5?10:oiDelta>0?5:0;
      // Factor P3: RSI sweet spot - real data gets full points, estimated partial
      const rsiReal2=!!(km2&&km2.rsi>0);
      const rsiForPump=rsiReal2?km2.rsi:rsi;
      const fP3=rsiReal2?(rsiForPump>=38&&rsiForPump<=52?20:rsiForPump>=28&&rsiForPump<=58?13:rsiForPump>=22&&rsiForPump<=65?6:0):(rsiForPump>=38&&rsiForPump<=52?8:rsiForPump>=28&&rsiForPump<=58?5:0);
      // Factor P4: FR setup (negative = retail short = squeeze fuel)
      const fP4=fp<-0.02?15:fp<-0.005?12:fp<0?8:fp===0?5:fp<0.005?2:0;
      // Factor P5: Volume building (ratio vs average)
      const volAvgEst=by.v||0;
      const fP5=rsiReal2&&km2.volTrend==='up'?10:rsiReal2&&km2.volTrend==='stable'?6:volScore>=3?7:volScore>=2?4:2;
      // Factor P6: RS vs BTC positive or improving
      const fP6=rs>2?5:rs>0?3:rs>-1?1:0;
      // Bonus: MACD bullish crossup = momentum starting
      const pumpBonus=km2&&km2.macd&&km2.macd.xUp?8:km2&&km2.macd&&km2.macd.bull&&km2.macd.val<0?4:0;
      const prePumpScore=Math.min(100,fP1+fP2+fP3+fP4+fP5+fP6+pumpBonus);
      const prePumpLabel=prePumpScore>=75?'READY':prePumpScore>=60?'BUILDING':prePumpScore>=45?'WATCH':'';
      const isPumpCandidate=prePumpScore>=60&&by.src==='by'&&(by.oi||0)>50e6;

      // Market regime quality for signal filtering (use pre-computed estimate)
      const isBearRegime=bearEstimate;
      // Spot-only: only for Bybit futures in strong bear (RSI < 35)
      const spotOnlyMode=btcRsiPre<35&&by.src==='by'&&rsi<35;

      // MTF RSI alignment check
      const mtfOversold=rsi1h&&rsi1h<40&&rsi<42&&(rsi1d?rsi1d<52:true);
      const mtfOverbought=rsi1h&&rsi1h>65&&rsi>62&&(rsi1d?rsi1d>60:true);
      const mtfAligned=mtfOversold?'BULL':mtfOverbought?'BEAR':'NEUTRAL';

      // 24 SIGNALS (WHALE LOADING added)
      let sig='',sc='#4a5568',desc='',dir='WAIT',prob=50,tags=[];
      // DECOUPLING DETECTION - highest signal quality
      // Coin goes UP while BTC goes DOWN = independent catalyst = smartest money
      const isDecoupling=btcC<-1&&c24>3&&rs>5;
      const isStrongDecoupling=btcC<-2&&c24>5&&rs>10;
      const isConfirmedDecoupling=btcC<-2&&c24>8&&rs>15&&vol>5e6;
      let decouplingScore=0;
      if(isDecoupling){
        decouplingScore=60+(rs>30?35:rs>20?30:rs>15?25:rs>10?18:rs>5?10:0);
        // Vol backing
        const vmcPct=by.mc>0?vol/by.mc*100:0;
        if(vmcPct>50)decouplingScore+=10;else if(vmcPct>20)decouplingScore+=6;else if(vmcPct>10)decouplingScore+=3;
        // BTC dump severity
        if(btcC<-3)decouplingScore+=8;else if(btcC<-2)decouplingScore+=5;else if(btcC<-1)decouplingScore+=2;
        // FR not overheated
        if(fp<0.0003)decouplingScore+=5;
        // Not overbought
        if(rsi<70)decouplingScore+=3;
        decouplingScore=Math.min(100,decouplingScore);
      }
      if(isConfirmedDecoupling&&decouplingScore>=80){
        sig='CONFIRMED BREAKOUT';sc='#00ff88';dir='LONG';prob=88;
        desc='DECOUPLING TERKONFIRMASI: BTC '+(btcC).toFixed(1)+'% tapi koin +'+(c24).toFixed(1)+'% (RS +'+(rs).toFixed(1)+'%). Catalyst nyata. HIGH PROBABILITY.';
        tags=['DECOUPLING','BREAKOUT','CATALYST','HIGH_PROB'];
      }else if(isStrongDecoupling&&decouplingScore>=75){
        sig='DECOUPLING STRONG';sc='#00ffaa';dir='LONG';prob=82;
        desc='BTC dump '+(btcC).toFixed(1)+'% tapi koin +'+(c24).toFixed(1)+'% (RS +'+(rs).toFixed(1)+'%). SM beli saat semua panik. Entry selektif.';
        tags=['DECOUPLING','STRONG_RS','SM_BUY'];
      }else if(isDecoupling&&decouplingScore>=65){
        sig='DECOUPLING';sc='#88ffcc';dir='LONG';prob=76;
        desc='Koin +'+(c24).toFixed(1)+'% vs BTC '+(btcC).toFixed(1)+'% (RS +'+(rs).toFixed(1)+'%). Pergerakan independen = ada buyer kuat.';
        tags=['DECOUPLING','RS_POSITIVE'];
      }else if(isWhaleLoading&&whaleLoadScore>=80&&rsiZone){
        sig='WHALE LOADING';sc='#00ffcc';dir='LONG';prob=87;
        desc='OI +'+oiDelta.toFixed(1)+'% + harga flat + vol/OI '+volOI.toFixed(2)+' = WHALE AKUMULASI DIAM-DIAM (score '+whaleLoadScore+'/100)';
        tags=['WHALE_LOAD','STEALTH','OI_DELTA','HIGH_PROB'];
      }else if(isWhaleLoading&&whaleLoadScore>=65&&rsiZone){
        sig='STEALTH ACCUM';sc='#00e5b0';dir='LONG';prob=79;
        desc='Volume anomali + OI naik + harga stabil = kemungkinan whale loading (score '+whaleLoadScore+'/100)';
        tags=['STEALTH','OI_RISING','WATCH'];
      }else if(mtfOversold&&rR&&(fr<-0.0002||(fr===0&&c24<-1))&&vol>300000){
        sig='MTF CONFLUENCE BUY';sc='#00ff88';dir='LONG';prob=90;
        desc='1H RSI '+rsi1h+' + 4H RSI '+rsi.toFixed(0)+(rsi1d?' + 1D RSI '+rsi1d:'')+' SEMUA oversold = setup terkuat';
        tags=['MTF','CONFLUENCE','RARE'];
      }else if(rsi<22&&fr<-0.001&&c24<-5&&vol>500000){
        sig='CAPITULATION BUY';sc='#00ffd0';dir='LONG';prob=oiPattern==='WHALE_LONG'?92:88;
        desc='RSI ekstrem + FR sangat negatif + dump besar'+(oiPattern==='WHALE_LONG'?' + OI naik = WHALE MASUK':'');
        tags=['RARE','EXTREME',oiPattern==='WHALE_LONG'?'WHALE_IN':''];
      }else if(oiPattern==='SHORT_SQUEEZE'&&fr<-0.0003&&rsi<58&&vol>1e6){
        sig='OI SQUEEZE LIVE';sc='#ff00ff';dir='LONG';prob=88;
        desc='OI turun ' + Math.abs(oiDelta).toFixed(1) + '% + harga naik + FR negatif = SHORT COVER AKTIF';
        tags=['OI_DELTA','SQUEEZE','LIVE'];
      }else if(rsi<28&&(fr<-0.0004||(fr===0&&c24<-3))&&ic&&vol>200000){
        sig='ABOUT TO FLY';sc='#ffd700';dir='LONG';prob=86;
        desc='5 konfluens: RSI oversold + FR neg + coiling + RS + volume';
        tags=['COILING','OVERSOLD'];
      }else if(oiPattern==='WHALE_LONG'&&oi>500e6&&fr<-0.0001&&Math.abs(c24)<2&&rsi>30&&rsi<65&&vol>2e6){
        sig='OI WHALE ENTRY';sc='#00d4ff';dir='LONG';prob=87;
        desc='OI naik '+oiDelta.toFixed(1)+'% + harga diam + FR negatif = WHALE MASUK DIAM-DIAM';
        tags=['OI_DELTA','WHALE','FRESH'];
      }else if(oi>500e6&&fr<-0.0001&&Math.abs(c24)<2&&vol>1e6&&rsi>30&&rsi<65){
        sig='WHALE FINGERPRINT';sc='#00d4ff';dir='LONG';prob=84;
        desc='OI besar + harga diam + FR negatif = institusi akumulasi';
        tags=['WHALE','OI_HIGH'];
      }else if(fr<-0.0005&&vol>500000&&rsi>30&&rsi<52){
        sig='SQUEEZE INCOMING';sc='#ff6b9d';dir='LONG';prob=83;
        desc='FR sangat negatif = shorts bayar mahal, squeeze akan terjadi';
        tags=['SQUEEZE','FR_EXTREME'];
      }else if(div==='BULLISH'&&divStr>30&&rsi<45&&fr<=0){
        sig='REVERSAL DIVERGENCE';sc='#a3e635';dir='LONG';prob=82;
        desc='Harga lower low tapi RSI higher low = pembalikan terdeteksi';
        tags=['DIVERGENCE','REVERSAL'];
      }else if((by.src==='by'&&fr<-0.0001&&rsi>33&&rsi<56&&vol>500000&&Math.abs(c24)<2)||(by.src==='mx'&&vol>1e6&&Math.abs(c24)<1.5&&rsi>33&&rsi<56)){
        if(isBearRegime&&by.src==='by'){
          sig='STEALTH LOAD';sc='#7c6bff';dir='WAIT';prob=70;
          desc='FR negatif + harga stabil di BEAR market = SM akumulasi diam-diam. Entry hanya bila market regime berubah ke TRADE.';
          tags=['ACCUM','STEALTH','WAIT_CONFIRM'];
        }else{
          sig='SMART ACCUMULATION';sc='#a78bfa';dir='LONG';prob=80;
          desc=by.src==='by'?'FR negatif + RSI ideal + harga stabil = SM masuk diam-diam':'Volume besar + harga stabil + RSI ideal = akumulasi terdeteksi';
          tags=['ACCUM',by.src==='by'?'NEG_FR':'VOL_ACCUM'];
        }
      }else if(Math.abs(c24)<1&&rsi>40&&rsi<60&&vol>2e6&&fr<=0&&(oi>100e6||(by.src==='mx'&&vol>5e6))){
        sig='COIL ACCUMULATION';sc='#818cf8';dir='LONG';prob=77;
        desc='Harga flat + volume diam naik = SM kumpul sebelum breakout';
        tags=['ACCUM','COIL'];
      }else if(by.src==='by'&&fr<-0.0002&&(by.rLong||50)<42&&rsi<42&&vol>500000){
        sig='RETAIL SHORT TRAP';sc='#fb7185';dir='LONG';prob=79;
        desc='Retail banyak short + FR negatif = mereka akan di-squeeze';
        tags=['CONTRARIAN'];
      }else if(rsi<30&&(fr<-0.0001||fr===0)&&c24<0&&vol>100000){
        // In bear regime, deep oversold = DCA spot only, not futures entry
        if(spotOnlyMode){
          sig='DCA ZONE';sc='#ffaa44';dir='ACCUM';prob=65;
          desc='RSI '+rsi.toFixed(0)+' oversold di BEAR market = DCA spot bertahap. BUKAN entry futures. Tunggu konfirmasi reversal.';
          tags=['OVERSOLD','SPOT_ONLY','BEAR_CAUTION'];
        }else{
          sig='DEEP OVERSOLD';sc='#f87171';dir='LONG';prob=76;
          desc='RSI sangat rendah = tekanan jual berlebihan, mean reversion';
          tags=['OVERSOLD'];
        }
      }else if((div==='BULLISH'&&rsi<55&&fr<=0)||(rsi<38&&pip<35&&c24>-0.5&&fr<=0&&vol>200000)){
        // Only show REVERSAL FORMING if RSI slope confirms (not falling further)
        const hasRsiConfirm=km2&&km2.slopeDir!=='down';// RSI must be flat or rising
        if(hasRsiConfirm||div==='BULLISH'){
          sig='REVERSAL FORMING';sc='#86efac';dir='LONG';prob=div==='BULLISH'?80:72;
          desc=div==='BULLISH'?'Bullish divergence + stabilisasi = reversal kuat':'RSI '+rsi.toFixed(0)+' stabil di support = reversal awal';
          tags=div==='BULLISH'?['REVERSAL','DIVERGENCE']:['REVERSAL'];
        }else{
          sig='OVERSOLD WATCH';sc='#888888';dir='WAIT';prob=50;
          desc='RSI oversold tapi masih falling. Tunggu RSI slope UP sebelum entry.';
          tags=['WATCH','OVERSOLD'];
        }
      }else if(ic&&ap>0&&ap<2.5&&fr<0.0002&&vol>200000){
        sig='PRE-BREAKOUT COIL';sc='#fbbf24';dir='LONG';prob=74;
        desc='ATR menyempit + konsolidasi = energi terkumpul untuk breakout';
        tags=['COILING'];
      }else if(rs>5&&c24>btcC+3&&btcC<0.5&&vol>1e6){
        sig='NARRATIVE PLAY';sc='#c084fc';dir='LONG';prob=78;
        desc='Naik saat BTC flat = narrative/catalyst tersembunyi aktif';
        tags=['NARRATIVE'];
      }else if(rsi<35&&fr<=0&&vb&&vol>200000){
        sig='OVERSOLD + VOLUME';sc='#6ee7b7';dir='LONG';prob=75;
        desc='Oversold + volume naik + bulls aktif = bounce signal';
        tags=['OVERSOLD','VOLUME'];
      }else if(rsi>55&&c24>2&&vb&&rs>3&&vol>2e6){
        sig='MOMENTUM BREAKOUT';sc='#22c55e';dir='LONG';prob=78;
        desc='Momentum kuat + volume besar + RS positif = trend aktif';
        tags=['MOMENTUM'];
      }else if(rsi>52&&rs>4&&c24>1.5&&fr<0.0005){
        sig='RELATIVE STRENGTH';sc='#4ade80';dir='LONG';prob=71;
        desc='Outperform BTC signifikan = relative strength tinggi';
        tags=['RS_STRONG'];
      }else if(rsi>=42&&rsi<=62&&c24>0.5&&fr<0.001){
        sig='MILD BULL';sc='#6ee7b7';dir='LONG';prob=65;
        desc='Mild bullish dengan risiko terukur';tags=['MILD'];
      }else if(oiPattern==='WHALE_SHORT'&&oi>500e6&&rsi>58&&c24>2){
        sig='SMART SHORT SETUP';sc='#ff4466';dir='SHORT';prob=78;
        desc='OI naik '+oiDelta.toFixed(1)+'% + harga naik = institusi SHORT = distribusi';
        tags=['OI_DELTA','SMART_SHORT'];
      }else if(rsi>80&&fr>0.003&&c24>8&&vol>3e6){
        sig='BLOW-OFF TOP';sc='#dc2626';dir='SHORT';prob=82;
        desc='RSI ekstrem + FR sangat mahal + pump besar = distribusi puncak';
        tags=['TOP','DISTRIBUTION'];
      }else if(div==='BEARISH'&&rsi>60&&fr>0.001){
        sig='BEARISH DIVERGENCE';sc='#f87171';dir='SHORT';prob=76;
        desc='Harga higher high tapi RSI lower high = momentum melemah';
        tags=['DIVERGENCE','BEARISH'];
      }else if(rsi>72&&fr>0.002&&c24>5){
        sig='BULL TRAP';sc='#ef4444';dir='SHORT';prob=67;
        desc='Overbought + FR mahal + pump besar = SM jual ke retail';
        tags=['OVERBOUGHT'];
      }else if(rsi>68&&c24>3&&fr>0.001){
        sig='DISTRIBUTION';sc='#fb923c';dir='SHORT';prob=69;
        desc='Kemungkinan distribusi aktif';tags=['DIST'];
      }else if(rsi>65&&fr>0.0005&&(by.rLong||50)>65){
        sig='SHORT ZONE';sc='#dc2626';dir='SHORT';prob=74;
        desc='Overbought + FR mahal + retail terlalu long';tags=['SHORT'];
      }

      // Convergence v2 - 9 factors
      // Factor 1: RSI (max 30)
      const f_rsi=rsi<22?30:rsi<28?26:rsi<33?22:rsi<38?16:rsi<43?10:rsi<50?4:rsi<60?0:rsi<68?-6:rsi<75?-12:-20;
      // Factor 2: FR (max 25)
      const f_fr=fp<-0.05?25:fp<-0.02?20:fp<-0.01?14:fp<-0.005?9:fp<0?5:fp>0.05?-20:fp>0.02?-12:fp>0.01?-6:fp>0.005?-3:0;
      // Factor 3: Coiling (max 10)
      const f_coil=ic?10:0;
      // Factor 4: Relative Strength (max 10)
      const f_rs=rs>8?10:rs>5?8:rs>2?5:rs>0?2:rs>-2?0:rs>-5?-3:-8;
      // Factor 5: Volume (max 8)
      const f_vol=volScore>=4?8:volScore===3?5:volScore===2?2:volScore===1?0:-3;
      // Factor 6: Divergence (max 7)
      const f_div=div==='BULLISH'?7:div==='BEARISH'?-5:0;
      // Factor 7: Real RSI from klines (max 5)
      const f_real=rR?5:0;
      // Factor 8 NEW: OI Delta (max 15)
      const f_oi=oiPattern==='WHALE_LONG'?15:oiPattern==='SHORT_SQUEEZE'?10:oiPattern==='OI_RISING'?5:oiPattern==='WHALE_SHORT'?-12:oiPattern==='LONG_LIQ'?-10:oiPattern==='OI_FALLING'?-5:0;
      // Factor 9 NEW: MTF RSI alignment (max 10)
      const f_mtf=mtfAligned==='BULL'?10:mtfAligned==='BEAR'?-10:0;
      const cv=Math.min(100,Math.round(60+f_rsi+f_fr+f_coil+f_rs+f_vol+f_div+f_real+f_oi+f_mtf));
      const lb=cv>=80?'ELITE':cv>=70?'PRIME':cv>=60?'VALID':'MOD';

      // ATR-based SL/TP - wider in bear market to avoid premature stop out
      let sl=0,tp1=0,tp2=0,tp3=0,slP=2.5,tp1P=4.0,tp2P=7.0,tp3P=12.0;
      // Bear market = wider SL (2.5x ATR) to survive volatility
      const slMult=bearEstimate?2.0:btcRsiPre>55?1.5:1.8;// Bear=wider SL
      try{if(ap>0){slP=+(ap*slMult).toFixed(2);tp1P=+(ap*(slMult+0.5)).toFixed(2);tp2P=+(ap*(slMult*2)).toFixed(2);tp3P=+(ap*(slMult*3.5)).toFixed(2);}
        if(dir==='LONG'){sl=+(p*(1-slP/100)).toFixed(p>1?4:8);tp1=+(p*(1+tp1P/100)).toFixed(p>1?4:8);tp2=+(p*(1+tp2P/100)).toFixed(p>1?4:8);tp3=+(p*(1+tp3P/100)).toFixed(p>1?4:8);}
        else if(dir==='SHORT'){sl=+(p*(1+slP/100)).toFixed(p>1?4:8);tp1=+(p*(1-tp1P/100)).toFixed(p>1?4:8);tp2=+(p*(1-tp2P/100)).toFixed(p>1?4:8);tp3=+(p*(1-tp3P/100)).toFixed(p>1?4:8);}}catch(e){}

      const rr=+(tp2P/slP).toFixed(1);
      let kellySz=2;try{const pk=(prob/100*rr-(1-prob/100))/rr;kellySz=Math.max(0.5,Math.min(10,+(pk/2*100).toFixed(1)));}catch(e){}
      // CONVICTION SCORING v2 - Tier-based on actual data quality
      // TIER 1: RSI Quality (0-2 stars) - most important factor
      const t1=rR?(rsi<15?2:rsi<20?1.8:rsi<25?1.6:rsi<30?1.3:rsi<38?1.0:rsi<45?0.6:0.3):(rsi<25?0.6:rsi<30?0.4:rsi<38?0.2:0);
      // TIER 2: MTF Alignment (0-1.5 stars) - is signal confirmed across timeframes?
      const t2=mtfAligned==='BULL'?1.5:km2&&km2.rsi&&km2.rsi<35?0.8:km2&&km2.rsi&&km2.rsi<45?0.5:0;
      // TIER 3: Divergence (0-1 star) - price/RSI divergence = reversal confirmed
      const t3=div==='BULLISH'?1:km2&&km2.div==='BULLISH'?0.8:0;
      // TIER 4: Market Context (0-0.8 stars)
      const t4=(fr<-0.0002?0.5:fr<0?0.3:0)+(oiDelta>3?0.3:oiDelta>1?0.2:0)+(decouplingScore>=80?0.5:decouplingScore>=65?0.3:0)+(rs>10?0.3:rs>5?0.2:rs>2?0.1:0);
      // TIER 5: Signal type bonus
      const t5=sig==='CONFIRMED BREAKOUT'?0.5:sig==='WHALE LOADING'?0.5:sig==='MTF CONFLUENCE BUY'?0.5:sig==='DECOUPLING STRONG'?0.3:0;
      const cStars=Math.min(5,+(t1+t2+t3+t4+t5).toFixed(1));
      const rLong=by.rLong||50,rShort=by.rShort||50;
      const rBias=rLong>=65?'RETAIL TRAP':rLong>=58?'Long Heavy':rLong<=35?'SQUEEZE':rLong<=42?'Short Dom':'Balanced';
      let fRisk=50;if(fp>0.05)fRisk+=20;else if(fp>0.02)fRisk+=10;else if(fp<-0.05)fRisk-=10;if(dir==='LONG'){if(rsi>70)fRisk+=20;else if(rsi<30)fRisk-=15;}if(div==='BULLISH'&&dir==='LONG')fRisk-=10;if(oiPattern==='WHALE_LONG')fRisk-=8;
      fRisk=Math.max(5,Math.min(95,Math.round(fRisk)));
      const fRiskLabel=fRisk<30?'LOW':fRisk<50?'MODERATE':fRisk<70?'HIGH':'DANGER';
      const liqLong10=p>0?+(p*0.9).toFixed(p>1?2:6):0;
      const liqShort10=p>0?+(p*1.1).toFixed(p>1?2:6):0;
      // MTF RSI badge
      let mtfBadge='';
      if(rR&&rsi1h&&rsi1h<35&&rsi<38)mtfBadge='1H+4H OVERSOLD';
      else if(rR&&rsi<35)mtfBadge='4H REAL OVERSOLD';
      else if(rsi1h&&rsi1h<35)mtfBadge='1H OVERSOLD';

      coins.push({
        sym,sector:sec,price:p,c24,vol,rsi:+rsi.toFixed(1),rsiReal:rR,
        rsi1h,rsi1d,mtfAligned,
        fr:fp||null,isCoiling:ic,rs,atr:km2?km2.atr||null:null,atrPct:ap,pip,oi,
        oiDelta:+oiDelta.toFixed(2),oiPattern,
        signal:sig||null,signalColor:sc,signalDesc:desc,signalTags:tags,
        direction:dir,probability:prob,
        conv:{score:cv,label:lb},convStars:cStars,
        divergence:div||null,divStrength:divStr,
        retailLong:rLong,retailShort:rShort,retailBias:rBias,
        bidAskRatio:by.bidAsk||null,
        rr,rrDisplay:rr+'R',mtfBadge,
        oiDirection:oiPattern,
        liquidationZones:{longLiq10x:liqLong10,shortLiq10x:liqShort10},
        kellySizing:kellySz,
        futuresRisk:{score:fRisk,label:fRiskLabel},
        levels:{sl,tp1,tp2,tp3,slPct:slP,tp1Pct:tp1P,tp2Pct:tp2P,tp3Pct:tp3P},
        src:by.src||'by',
        whaleLoadScore,whaleLoadLabel,volOI:+volOI.toFixed(3),rangeWidth:+rangeWidth.toFixed(2),isWhaleLoading,
        prePumpScore,prePumpLabel,isPumpCandidate,
        // oiDirection as object (HTML expects .state/.stateColor/.oiChangePct)
        oiDirection:{
          state:oiPattern==='WHALE_LONG'?'NEW LONGS':oiPattern==='WHALE_SHORT'?'NEW SHORTS':oiPattern==='SHORT_SQUEEZE'?'SHORT SQUEEZE':oiPattern==='LONG_LIQ'?'LONG LIQ':oiPattern==='OI_RISING'?'OI RISING':oiPattern==='OI_FALLING'?'OI FALLING':'NEUTRAL',
          stateColor:oiPattern==='WHALE_LONG'||oiPattern==='OI_RISING'?'green':oiPattern==='WHALE_SHORT'?'red':oiPattern==='SHORT_SQUEEZE'?'cyan':oiPattern==='LONG_LIQ'?'amber':'gray',
          oiChangePct:+oiDelta.toFixed(2)
        },
        // liquidationZones with distTo fields (HTML expects .distToLongLiq/.distToShortLiq)
        liquidationZones:{
          longLiq10x:liqLong10,shortLiq10x:liqShort10,
          distToLongLiq:10,distToShortLiq:10
        },
        // kellySizing as object (HTML expects .suggestedSizePct)
        kellySizing:{suggestedSizePct:kellySz},
        // futuresRisk keeps label
        futuresRisk:{score:fRisk,label:fRiskLabel},
        mc:by.mc||0,
        decouplingScore:Math.round(decouplingScore||0)
      });
    }catch(e){}}
    coins.sort((a,b)=>((b.conv&&b.conv.score)||0)-((a.conv&&a.conv.score)||0));

    // In bear market: only show LONG if it has REAL RSI or DECOUPLING
    const longs=coins.filter(x=>{
      if(x.direction!=='LONG')return false;
      const cv2=(x.conv&&x.conv.score)||0;if(cv2<60)return false;
      // Bear market filter: require real RSI or high conviction
      if(bearEstimate){
        // Allow if: real RSI + actual oversold, OR decoupling breakout, OR whale loading
        const isQual=x.rsiReal||(x.decouplingScore||0)>=65||x.signal==='WHALE LOADING'||x.signal==='CONFIRMED BREAKOUT'||x.signal==='DECOUPLING STRONG';
        return isQual;
      }
      return true;
    }).slice(0,30);
    const shorts=coins.filter(x=>x.direction==='SHORT'&&((x.conv&&x.conv.score)||0)>=55).slice(0,10);
    const decoupSet=new Set(['CONFIRMED BREAKOUT','DECOUPLING STRONG','DECOUPLING']);
    const decoupCoins=coins.filter(x=>x.decouplingScore>=65&&x.rs>5&&x.c24>3).sort((a,b)=>(b.decouplingScore||0)-(a.decouplingScore||0)).slice(0,15);
    const flys=coins.filter(x=>x.signal&&(x.signal==='MTF CONFLUENCE BUY'||x.signal==='ABOUT TO FLY'||x.signal==='CAPITULATION BUY'||x.signal==='OI SQUEEZE LIVE'||x.signal==='OI WHALE ENTRY'||x.signal==='WHALE LOADING'||decoupSet.has(x.signal||''))).sort((a,b)=>(b.conv&&b.conv.score||0)-(a.conv&&a.conv.score||0)).slice(0,12);
    const accums=coins.filter(x=>x.signal&&(x.signal==='DCA ZONE'||x.signal==='STEALTH LOAD'||x.signal==='SMART ACCUMULATION'||x.signal==='COIL ACCUMULATION'||x.signal==='WHALE FINGERPRINT'||x.signal==='PRE-BREAKOUT COIL'||x.signal==='NARRATIVE PLAY'||x.signal==='REVERSAL FORMING')).slice(0,8);
    const top25=longs.slice(0,25);
    const ec=top25.filter(x=>((x.conv&&x.conv.score)||0)>=80).length;
    const pc=top25.filter(x=>((x.conv&&x.conv.score)||0)>=70&&((x.conv&&x.conv.score)||0)<80).length;
    const vc=top25.filter(x=>((x.conv&&x.conv.score)||0)>=60&&((x.conv&&x.conv.score)||0)<70).length;

    // OI Delta Leaders
    const oiDeltaLeaders=(()=>{try{
      const accum=coins.filter(c=>c.src==='by'&&c.oiDelta>1.5&&c.vol>1e6).sort((a,b)=>b.oiDelta-a.oiDelta).slice(0,10).map(c=>({sym:c.sym,price:c.price,c24:c.c24,rsi:c.rsi,oiDelta:c.oiDelta,oiPattern:c.oiPattern,fr:c.fr,vol:c.vol,signal:c.signal}));
      const distrib=coins.filter(c=>c.src==='by'&&c.oiDelta<-1.5&&c.vol>1e6).sort((a,b)=>a.oiDelta-b.oiDelta).slice(0,5).map(c=>({sym:c.sym,price:c.price,c24:c.c24,rsi:c.rsi,oiDelta:c.oiDelta,oiPattern:c.oiPattern}));
      return{accumulating:accum,distributing:distrib};
    }catch(e){return{accumulating:[],distributing:[]}}})();

    // Market character
    const osCount=coins.filter(x=>x.rsi<30).length;
    const obCount=coins.filter(x=>x.rsi>70).length;
    const bullPct=coins.filter(x=>x.direction==='LONG').length;
    const totC=coins.length||1;const bPct=bullPct/totC;
    let mcType,mcColor,mcDesc,mcStrat,mcRisk,mcPos;
    if(osCount/totC>0.12){mcType='MASS OVERSOLD';mcColor='cyan';mcDesc=osCount+' koin RSI<30. Zona DCA historis terbaik.';mcStrat='Counter-trend DCA';mcRisk='MODERATE';mcPos='Minimal (25%)';}
    else if(obCount/totC>0.18){mcType='MASS OVERBOUGHT';mcColor='red';mcDesc=obCount+' koin RSI>70. Distribusi massal.';mcStrat='Cash + Short Select';mcRisk='HIGH';mcPos='Minimal (25%)';}
    else if(bPct>0.65){mcType='BULLISH';mcColor='green';mcDesc='Majority bullish. Trend naik aktif.';mcStrat='Aggressive Long';mcRisk='STANDARD';mcPos='Full (100%)';}
    else if(bPct<0.30){mcType='BEARISH';mcColor='red';mcDesc='Majority bearish. Hati-hati.';mcStrat='Cash or Short';mcRisk='HIGH';mcPos='Minimal (25%)';}
    else{mcType='TRANSITIONAL';mcColor='amber';mcDesc='Mixed signals. Selektif dan hati-hati.';mcStrat='Cautious';mcRisk='REDUCED';mcPos='Full (100%)';}

    // Sessions
    const now2=new Date();const wibH=(now2.getUTCHours()+7)%24;
    const days=['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];
    const sess=[
      {id:'dead',name:'Dead Zone',time:'02:00-06:00',start:2,end:6,q:'POOR',activity:'Volume sangat sepi. Skip trading.'},
      {id:'asia_open',name:'Asia Open',time:'06:00-09:00',start:6,end:9,q:'MODERATE',activity:'Volume mulai masuk. Watchlist saja.'},
      {id:'asia_peak',name:'Asia Peak',time:'09:00-12:00',start:9,end:12,q:'GOOD',activity:'Volume Asia bagus. Entry selektif.'},
      {id:'lunch',name:'Lunch Break',time:'12:00-15:00',start:12,end:15,q:'CAUTION',activity:'Volume turun. Hindari entry baru.'},
      {id:'london',name:'London',time:'15:00-18:00',start:15,end:18,q:'PRIME',activity:'PRIME: Volume institusional tertinggi!'},
      {id:'ny_pre',name:'NY Pre',time:'18:00-21:00',start:18,end:21,q:'BUILDING',activity:'Build posisi sebelum NY Open.'},
      {id:'ny_open',name:'NY Open',time:'21:00-23:00',start:21,end:23,q:'PRIME',activity:'PRIME: Volume tertinggi hari ini!'},
      {id:'ny_late',name:'NY Late',time:'23:00-02:00',start:23,end:2,q:'GOOD',activity:'Volume masih bagus. Swing ok.'},
    ];
    const cs=wibH>=2&&wibH<6?'dead':wibH>=6&&wibH<9?'asia_open':wibH>=9&&wibH<12?'asia_peak':wibH>=12&&wibH<15?'lunch':wibH>=15&&wibH<18?'london':wibH>=18&&wibH<21?'ny_pre':wibH>=21&&wibH<23?'ny_open':'ny_late';
    const cso=sess.find(s=>s.id===cs)||sess[0];
    const np=sess.filter(s=>s.q==='PRIME'&&s.id!==cs);
    let nxt=null;if(np.length>0){const ns=np[0];var inH=ns.start>wibH?ns.start-wibH:24-wibH+ns.start;nxt={name:ns.name,time:ns.time,inH:inH,inHours:inH};}
    const focusToday=cso.q==='PRIME'?cso.name+' PRIME aktif!':cso.q==='GOOD'?cso.name+' kondisi bagus':cso.q==='BUILDING'?cso.name+' bangun posisi':'Next PRIME: '+(nxt?nxt.name+' ~'+nxt.inHours+'h':'-');

    // Resistance: nearest level ABOVE btcP
    const e9v=btcK&&btcK.e9?btcK.e9:0;
    const e200v=btcK&&btcK.e200?btcK.e200:0;
    // Use EMA levels properly: if EMA > btcP = resistance, if EMA < btcP = support
    let btcRes,btcSup;
    if(e9v>btcP){btcRes=+(e9v*1.002).toFixed(0);}// e9 above = nearest resistance
    else if(e200v>btcP){btcRes=+(e200v*1.002).toFixed(0);}// e200 above = resistance
    else{btcRes=btcP?+(btcP*1.025).toFixed(0):null;}// fallback: +2.5% from current
    if(e200v>0&&e200v<btcP){btcSup=+(e200v*0.995).toFixed(0);}// e200 below = support
    else if(e9v>0&&e9v<btcP){btcSup=+(e9v*0.995).toFixed(0);}// e9 below = support
    else{btcSup=btcP?+(btcP*0.97).toFixed(0):null;}// fallback: -3% from current
    // Safety check: ensure resistance > current > support
    if(btcRes&&btcP&&btcRes<=btcP)btcRes=+(btcP*1.02).toFixed(0);
    if(btcSup&&btcP&&btcSup>=btcP)btcSup=+(btcP*0.97).toFixed(0);
    const top3=longs.slice(0,3).map(x=>({sym:x.sym,price:x.price}));

    // Spot accumulation
    const spotAccum=coins.filter(x=>x.rsi<42&&x.direction!=='SHORT').sort((a,b)=>a.rsi-b.rsi).slice(0,10).map(x=>{
      const dcaPct=x.atrPct>0?x.atrPct:2.5;
      const dcaLow=+(x.price*(1-dcaPct*1.5/100)).toFixed(x.price>1?2:8);
      const dcaHigh=+(x.price*(1-dcaPct*0.3/100)).toFixed(x.price>1?2:8);
      return{sym:x.sym,price:x.price,rsi:x.rsi,rsiReal:x.rsiReal,rsi1h:x.rsi1h||null,signal:x.signal||'DEEP OVERSOLD',atrPct:x.atrPct||0,dcaZone:'$'+dcaLow+' - $'+dcaHigh,dcaLow,dcaHigh,fr:x.fr?+(x.fr*100).toFixed(3):null,conv:(x.conv&&x.conv.score)||0,retailLong:x.retailLong,divergence:x.divergence||null,sector:x.sector,oiPattern:x.oiPattern,momentum:x.rs>0?'RS+'+(x.rs):'RS'+x.rs,oversold:x.rsi<25?'EXTREME':x.rsi<30?'DEEP':'MODERATE'};
    });

    const avoidList=coins.filter(x=>x.rsi>78||((x.fr||0)>0.003&&x.rsi>65)).sort((a,b)=>b.rsi-a.rsi).slice(0,8).map(x=>({sym:x.sym,price:x.price,rsi:x.rsi,pct:x.c24,fr:x.fr?+(x.fr*100).toFixed(3):null,reason:x.rsi>80?'RSI '+x.rsi.toFixed(0)+' overbought distribusi':((x.fr||0)>0.003?'FR '+(x.fr*100).toFixed(2)+'% mahal SM jual':'RSI tinggi FR mahal'),signal:x.signal||'OVERBOUGHT'}));

    // Checklist
    const liqC=coins.filter(x=>(x.vol||0)>5e6).length;
    const frHot=coins.filter(x=>(x.fr||0)>0.0005).length;
    const passVol=cso.q==='PRIME'?liqC>=15:liqC>=8;
    const mkChecks=[
      {label:'Market character layak trading',pass:mcType!=='MASS OVERBOUGHT',detail:'Character: '+mcType,fix:'Hindari masa distribusi massal'},
      {label:'Trading session berkualitas',pass:cso.q==='PRIME'||cso.q==='GOOD'||cso.q==='BUILDING',detail:cso.name+' ('+cso.q+')',fix:'Tunggu PRIME/GOOD session'},
      {label:'BTC tidak di resistance',pass:btcK&&btcK.rsi?btcK.rsi<72:true,detail:btcK&&btcK.rsi?'BTC RSI '+btcK.rsi.toFixed(0):'BTC aman',fix:'Tunggu BTC RSI <65'},
      {label:'FR market tidak overheated',pass:frHot===0,detail:frHot+' koin FR>0.05%',fix:'Hindari entry saat FR massal mahal'},
      {label:'Market tidak overbought massal',pass:obCount<totC*0.15,detail:obCount+'/'+totC+' koin RSI>70',fix:'Tunggu RSI turun'},
      {label:'BTC L/S ratio aman',pass:btcLS===null||btcLS>=0.8,detail:btcLS?'L/S: '+btcL+'%/'+btcS+'%':'Data tidak tersedia',fix:'Hindari saat retail terlalu long'},
      {label:'Cukup koin aktif & liquid',pass:passVol,detail:liqC+' koin aktif (vol>$5M)'+(passVol?'':' Market sepi'),fix:'Tunggu London atau NY Open'},
      {label:'BTC mendukung altcoin',pass:btcC>-2,detail:'BTC '+btcC.toFixed(2)+'%',fix:'Hindari altcoin saat BTC dump >2%'},
    ];
    const pass=mkChecks.filter(x=>x.pass).length;

    // Sector flow
    const secMap={};
    for(const co of coins){const s=co.sector||'Other';if(!secMap[s])secMap[s]={coins:[],ch24Sum:0,frSum:0,rsSum:0,osC:0,sigQ:0,oiAccum:0};secMap[s].coins.push(co);secMap[s].ch24Sum+=co.c24;secMap[s].frSum+=(co.fr||0);secMap[s].rsSum+=(co.rs||0);if(co.rsi<30)secMap[s].osC++;if(co.signal&&((co.conv&&co.conv.score)||0)>=70)secMap[s].sigQ++;if(co.oiPattern==='WHALE_LONG')secMap[s].oiAccum++;}
    const sectorData={};
    const sectors=Object.entries(secMap).map(([name,d])=>{
      const n=d.coins.length||1,avgCh24=+(d.ch24Sum/n).toFixed(3),frAvg=+(d.frSum/n).toFixed(6),rsAvg=+(d.rsSum/n).toFixed(2);
      const smScore=Math.max(0,Math.min(100,Math.round(50+avgCh24*5+frAvg*(-2000)+rsAvg*3+Math.min(20,d.osC*3)+Math.min(10,d.sigQ*3)+Math.min(10,d.oiAccum*5))));
      const dir2=avgCh24>=0.05?'up':avgCh24<=-0.05?'down':'flat';
      const best=d.coins.filter(x=>x.signal&&x.direction==='LONG').sort((a,b)=>((b.conv&&b.conv.score)||0)-((a.conv&&a.conv.score)||0))[0]||null;
      const sd={name,coins:d.coins,avgCh24,frAvg,rsAvg,osCount:d.osC,smScore,sigQ:d.sigQ,dir:dir2,best,oiAccum:d.oiAccum};
      sectorData[name]=sd;return sd;
    }).sort((a,b)=>b.smScore-a.smScore);

    // Golden opportunities
    // PUMP HUNTER RADAR - pre-pump signature detection
    const pumpHunter=(()=>{try{
      return coins
        .filter(c=>c.isPumpCandidate&&(c.oi||0)>50e6)
        .sort((a,b)=>(b.prePumpScore||0)-(a.prePumpScore||0))
        .slice(0,10)
        .map(c=>{
          var reasons=[];
          var km3=km[c.sym]||null;
          if(km3&&km3.rangeW5<8)reasons.push('Coiling '+km3.rangeW5.toFixed(1)+'% (5d range sempit)');
          if(c.oiDelta>1)reasons.push('OI +'+c.oiDelta.toFixed(1)+'% (fresh position)');
          if(c.rsiReal&&c.rsi<52)reasons.push('RSI REAL '+c.rsi.toFixed(0)+' sweet spot');
          if((c.fr||0)<-0.0001)reasons.push('FR '+((c.fr||0)*100).toFixed(3)+'% shorts bayar');
          if(km3&&km3.macd&&km3.macd.xUp)reasons.push('MACD cross up (momentum start)');
          if(km3&&km3.div==='BULLISH')reasons.push('Bullish divergence terdeteksi');
          if(c.rs>0)reasons.push('RS vs BTC positif (+'+c.rs.toFixed(2)+'%)');
          var atrV=km3?km3.atr||0:c.price*0.025;
          var atrPct2=c.price>0&&atrV>0?+(atrV/c.price*100).toFixed(2):2.5;
          return{
            sym:c.sym,sector:c.sector,price:c.price,c24:c.c24,
            rsi:c.rsi,rsiReal:c.rsiReal,
            oiDelta:c.oiDelta,oiPattern:c.oiPattern,
            fr:c.fr||null,oi:+((c.oi||0)/1e9).toFixed(2),
            vol:c.vol,
            rangeW5:km3?km3.rangeW5||10:10,
            prePumpScore:c.prePumpScore||0,prePumpLabel:c.prePumpLabel||'',
            signal:c.signal||null,
            whaleLoadScore:c.whaleLoadScore||0,
            // Entry zone: current price
            entry:c.price,
            sl:+(c.price*(1-Math.max(atrPct2*1.5,2)/100)).toFixed(c.price>1?2:6),
            tp1:+(c.price*(1+atrPct2*2/100)).toFixed(c.price>1?2:6),
            tp2:+(c.price*(1+atrPct2*3.5/100)).toFixed(c.price>1?2:6),
            slPct:Math.max(atrPct2*1.5,2).toFixed(2),
            tp2Pct:(atrPct2*3.5).toFixed(2),
            rr:+(atrPct2*3.5/Math.max(atrPct2*1.5,2)).toFixed(1),
            reasons:reasons,
            windowHours:prePumpScore>=75?'1-12h':prePumpScore>=60?'12-48h':'48-72h'
          };
        });
    }catch(e){return[]}})();


    // ALTCOIN SMART MONEY RADAR
    // 3-Layer: Bybit OI/FR + MEXC Volume + Cross-confirm
    const TOP7S=new Set(['BTC','ETH','SOL','BNB','XRP','LINK','AVAX','BTCUSDC','ETHUSDC']);
    const smRadar=(()=>{try{
      const candidates=[];
      const bybitSet=new Set();
      // LAYER 1: Bybit futures - OI/FR based SM
      Object.entries(cm).forEach(([s,by])=>{
        if(TOP7S.has(s)||by.src!=='by')return;
        if(/^[0-9]/.test(s)||s.endsWith('USDC')||s.length>10)return;
        const oi=by.oi||0,vol=by.v||0,fp=by.fr||0;
        const p=by.p||0,h=by.h||p,l=by.l||p,c24=by.c24||0;
        if(oi<5e6||vol<500000||p<=0)return;
        const range24=p>0&&h>l?(h-l)/p*100:10;
        const volOIr=oi>0?vol/oi:0;
        let smS=0,smR=[];
        // FR: negative = shorts paying = SM long
        if(fp<-0.0003){smS+=30;smR.push('FR '+(fp*100).toFixed(3)+'%');}
        else if(fp<-0.0001){smS+=20;smR.push('FR '+(fp*100).toFixed(3)+'%');}
        else if(fp<0){smS+=10;}else if(fp===0){smS+=5;}
        // OI delta: rising = fresh money
        const prevO=OI_CACHE.prev[s]||oi;
        const oiD=prevO>0?(oi-prevO)/prevO*100:0;
        if(oiD>3){smS+=25;smR.push('OI +'+oiD.toFixed(1)+'%');}
        else if(oiD>1){smS+=15;smR.push('OI +'+oiD.toFixed(1)+'%');}
        else if(oiD>0){smS+=8;}
        // Price stability: tight range = SM absorb supply
        if(range24<2){smS+=25;smR.push('Range '+range24.toFixed(1)+'% tight');}
        else if(range24<4){smS+=15;smR.push('Konsolidasi '+range24.toFixed(1)+'%');}
        else if(range24<6){smS+=8;}
        // Vol/OI activity ratio
        if(volOIr>0.3){smS+=20;smR.push('Vol/OI '+volOIr.toFixed(2)+'x');}
        else if(volOIr>0.15){smS+=12;}else if(volOIr>0.05){smS+=6;}
        if(vol>10e6)smS+=5;
        if(smS>=35){
          bybitSet.add(s);
          const slPct=Math.max(range24*0.6,2);
          candidates.push({sym:s,price:p,c24:+c24.toFixed(2),vol:vol,oi:+oi,fr:+(fp*100).toFixed(4),oiDelta:+oiD.toFixed(2),range24:+range24.toFixed(2),smScore:Math.min(100,smS),reasons:smR,layer:'bybit',rsi:by.rsi||50,sl:+(p*(1-slPct/100)).toFixed(p>1?2:8),tp1:+(p*(1+range24*0.8/100)).toFixed(p>1?2:8),tp2:+(p*(1+range24*1.5/100)).toFixed(p>1?2:8),slPct:+slPct.toFixed(2),tp2Pct:+(range24*1.5).toFixed(2),sector:by.sec||'ALT',confirmed:false});
        }
      });
      // LAYER 2: MEXC spot - volume-based
      const bybitSyms=new Set(Object.entries(cm).filter(([,v])=>v.src==='by').map(([k])=>k));
      Object.entries(cm).forEach(([s,mx])=>{
        if(TOP7S.has(s)||mx.src!=='mx')return;
        if(/^[0-9]/.test(s)||s.length>12)return;
        const vol=mx.v||0,p=mx.p||0,c24=mx.c24||0;
        const h=mx.h||p,l=mx.l||p;
        if(vol<1e6||p<=0)return;
        const range24=p>0&&h>l?(h-l)/p*100:10;
        const volMC=mx.mc>0?vol/mx.mc*100:0;
        let mxS=0,mxR=[];
        if(vol>20e6){mxS+=35;mxR.push('Vol $'+(vol/1e6).toFixed(0)+'M institusional');}
        else if(vol>5e6){mxS+=25;mxR.push('Vol $'+(vol/1e6).toFixed(0)+'M');}
        else if(vol>2e6){mxS+=15;}
        if(volMC>30){mxS+=35;mxR.push('V/MC '+volMC.toFixed(0)+'% EXTREME');}
        else if(volMC>15){mxS+=25;mxR.push('V/MC '+volMC.toFixed(0)+'% tinggi');}
        else if(volMC>5){mxS+=15;mxR.push('V/MC '+volMC.toFixed(0)+'%');}
        if(range24<2&&vol>2e6){mxS+=30;mxR.push('Vol+harga stabil=akumulasi');}
        else if(range24<4){mxS+=15;}
        if(Math.abs(c24)>15)mxS=Math.max(0,mxS-20);
        if(mxS>=40){
          const ex=candidates.find(c2=>c2.sym===s);
          if(ex){ex.smScore=Math.min(100,ex.smScore+15);ex.confirmed=true;ex.reasons=[...ex.reasons,...mxR.slice(0,2)];}
          else{
            const slPct2=Math.max(range24*0.6,2.5);
            candidates.push({sym:s,price:p,c24:+c24.toFixed(2),vol:vol,oi:0,fr:null,oiDelta:0,range24:+range24.toFixed(2),smScore:Math.min(100,mxS),reasons:mxR,layer:'mexc',rsi:mx.rsi||50,sl:+(p*(1-slPct2/100)).toFixed(p>1?2:8),tp1:+(p*(1+range24*0.8/100)).toFixed(p>1?2:8),tp2:+(p*(1+range24*2/100)).toFixed(p>1?2:8),slPct:+slPct2.toFixed(2),tp2Pct:+(range24*2).toFixed(2),sector:mx.sec||'ALT',volMCpct:+volMC.toFixed(1),confirmed:false});
          }
        }
      });
      return candidates.filter(c=>c.smScore>=40).sort((a,b)=>{if(a.confirmed&&!b.confirmed)return -1;if(!a.confirmed&&b.confirmed)return 1;return b.smScore-a.smScore;}).slice(0,20);
    }catch(e){return[]}})();

            // WHALE LOADING RADAR - dedicated section
    const whaleLoadingRadar=(()=>{try{
      return coins
        .filter(c=>c.src==='by'&&c.isWhaleLoading&&(c.oi||0)>100e6)
        .sort((a,b)=>(b.whaleLoadScore||0)-(a.whaleLoadScore||0))
        .slice(0,12)
        .map(c=>({
          sym:c.sym,price:c.price,c24:c.c24,rsi:c.rsi,sector:c.sector,
          oiDelta:c.oiDelta,oiPattern:c.oiPattern,
          vol:c.vol,volOI:c.volOI||0,rangeWidth:c.rangeWidth||0,
          fr:c.fr||null,oi:+((c.oi||0)/1e9).toFixed(2),
          whaleLoadScore:c.whaleLoadScore||0,whaleLoadLabel:c.whaleLoadLabel||'',
          signal:c.signal||null,
          // Entry zone: current price to -1.5% (within loading range)
          entryZone:'$'+c.price.toFixed(c.price>1?2:6)+' - $'+(c.price*0.985).toFixed(c.price>1?2:6),
          // Invalidation: below range low
          invalidation:'$'+(c.price*(1-Math.max(2.5,c.rangeWidth||3)/100)).toFixed(c.price>1?2:6),
          reasoning:[
            c.oiDelta>1.5?'OI naik +'+c.oiDelta.toFixed(1)+'% (fresh position)':'',
            Math.abs(c.c24)<1.5?'Harga flat '+c.c24.toFixed(2)+'% (price contained)':'',
            c.rsi>=33&&c.rsi<=57?'RSI '+c.rsi.toFixed(0)+' zona akumulasi':'',
            (c.fr||0)<0?'FR '+((c.fr||0)*100).toFixed(3)+'% (shorts bayar)':'',
            c.volOI>0.15?'Vol/OI ratio tinggi (whale turnover)':'',
          ].filter(Boolean)
        }));
    }catch(e){return[]}})();

        const whaleFingerprint=(()=>{try{return coins.filter(c=>c.oi>500e6&&(c.fr||0)<-0.0001&&Math.abs(c.c24)<2&&(c.vol||0)>1e6&&c.rsi>30&&c.rsi<65).sort((a,b)=>(a.fr||0)-(b.fr||0)).slice(0,8).map(c=>({sym:c.sym,price:c.price,c24:c.c24,rsi:c.rsi,fr:+((c.fr||0)*100).toFixed(4),oi:+((c.oi||0)/1e9).toFixed(2),oiDelta:c.oiDelta,vol:c.vol,rating:Math.abs(c.fr||0)>0.0005?'STRONG':'GOOD'}));}catch(e){return[]}})();
    const squeezeRadar=(()=>{try{return coins.filter(c=>(c.fr||0)<-0.0003&&(c.vol||0)>500000&&c.rsi<55).sort((a,b)=>(a.fr||0)-(b.fr||0)).slice(0,10).map(c=>({sym:c.sym,price:c.price,c24:c.c24,rsi:c.rsi,fr:+((c.fr||0)*100).toFixed(4),retailLong:c.retailLong,retailShort:c.retailShort,oiPattern:c.oiPattern,strength:Math.abs(c.fr||0)>0.001?'EXTREME':Math.abs(c.fr||0)>0.0005?'STRONG':'HIGH'}));}catch(e){return[]}})();
    const stealthVolume=(()=>{try{return coins.filter(c=>(c.vol||0)>10e6&&Math.abs(c.c24)<0.8&&c.rsi<65&&(c.oi||0)>500e6).sort((a,b)=>(b.vol||0)-(a.vol||0)).slice(0,8).map(c=>({sym:c.sym,price:c.price,c24:c.c24,vol:c.vol,rsi:c.rsi,oi:+((c.oi||0)/1e9).toFixed(2),oiDelta:c.oiDelta}));}catch(e){return[]}})();
    const hiddenGems=(()=>{try{return coins.filter(c=>c.rsi<32&&(c.fr||0)<=-0.0001&&(c.vol||0)>300000&&(c.vol||0)<50e6&&!['BTC','ETH','BNB','SOL','XRP','ADA','DOGE'].includes(c.sym)&&((c.conv&&c.conv.score)||0)>=60).sort((a,b)=>a.rsi-b.rsi).slice(0,12).map(c=>({sym:c.sym,price:c.price,c24:c.c24,rsi:c.rsi,fr:+((c.fr||0)*100).toFixed(4),vol:c.vol,conv:(c.conv&&c.conv.score)||0,oiPattern:c.oiPattern}));}catch(e){return[]}})();
    const momentumShift=(()=>{try{return coins.filter(c=>c.c24>2&&(c.c24-btcC)>3&&c.sym!=='BTC'&&(c.vol||0)>1e6&&c.rsi<75).sort((a,b)=>(b.c24-btcC)-(a.c24-btcC)).slice(0,8).map(c=>({sym:c.sym,price:c.price,c24:c.c24,rsi:c.rsi,vol:c.vol,outperformBTC:+(c.c24-btcC).toFixed(2),oiPattern:c.oiPattern}));}catch(e){return[]}})();
    const retailTrapList=(()=>{try{return coins.filter(c=>c.retailLong>=63&&c.rsi>55&&(c.vol||0)>2e6).sort((a,b)=>b.retailLong-a.retailLong).slice(0,6).map(c=>({sym:c.sym,price:c.price,c24:c.c24,retailLong:c.retailLong,rsi:c.rsi}));}catch(e){return[]}})();
    const retailSqueezeList=(()=>{try{return coins.filter(c=>c.retailLong<=40&&c.rsi<45&&(c.vol||0)>1e6).sort((a,b)=>a.retailLong-b.retailLong).slice(0,6).map(c=>({sym:c.sym,price:c.price,c24:c.c24,retailLong:c.retailLong,retailShort:c.retailShort,rsi:c.rsi}));}catch(e){return[]}})();

    // Daily tools
    const dailyOpportunityScore=(()=>{try{
      let score=50;
      if(fg<20)score+=20;else if(fg<35)score+=12;else if(fg>75)score-=15;
      if(osCount>20)score+=18;else if(osCount>12)score+=12;else if(osCount>6)score+=6;
      if(cso.q==='PRIME')score+=12;else if(cso.q==='GOOD')score+=6;
      const sqC=coins.filter(x=>(x.fr||0)<-0.0005).length;score+=Math.min(10,sqC*2);
      const mtfC=coins.filter(x=>x.mtfAligned==='BULL').length;score+=Math.min(8,mtfC);
      const whaleLong=coins.filter(x=>x.oiPattern==='WHALE_LONG').length;score+=Math.min(8,whaleLong*2);
      score=Math.max(5,Math.min(98,Math.round(score)));
      const label=score>=80?'EXTREME OPPORTUNITY':score>=65?'HIGH OPPORTUNITY':score>=50?'NORMAL':score>=35?'LOW':'POOR DAY';
      const action=score>=80?'Hari langka! Full sizing pada sinyal PRIME/ELITE.':score>=65?'Setup bagus. Sizing normal. Fokus conv 70+.':score>=50?'Selektif. Hanya setup 3+ konfluens.':'Hindari new entry hari ini.';
      return{score,label,action,fg,session:cso.q,osCoins:osCount,squeezeCoins:sqC,mtfBullCoins:mtfC,whaleLongCoins:whaleLong};
    }catch(e){return{score:50,label:'NORMAL',action:'-'}}})();

    const marketRegime=(()=>{try{
      const btcE2=btcK&&btcK.e200?btcK.e200:0,mvrvR=btcK&&btcK.price&&btcE2>0?+(btcK.price/btcE2).toFixed(2):1.3;
      let regime,regimeColor,regimeDesc,sizingGuidance;
      const btcRsiNow=btcK&&btcK.rsi?btcK.rsi:50;
      const isExtremeBear=btcRsiNow<20||(btcRsiNow<30&&fg<30);
      const isCapitulation=btcRsiNow<15&&fg<25;
      if(isCapitulation){regime='ACCUMULATE';regimeColor='cyan';regimeDesc='CAPITULATION: RSI 4H '+btcRsiNow.toFixed(0)+' + F&G '+fg+'. Zona akumulasi historis terbaik. Beli spot bertahap.';sizingGuidance='Spot DCA 10-20% per entry. NO LEVERAGE.';}
      else if(isExtremeBear){regime='ACCUMULATE';regimeColor='cyan';regimeDesc='Extreme oversold: RSI '+btcRsiNow.toFixed(0)+' + Fear '+fg+'. DCA spot, hindari futures leverage.';sizingGuidance='DCA bertahap 25-50%. Spot only.';}
      else if(fg<35&&mvrvR<1.1&&osCount/totC>0.04){regime='ACCUMULATE';regimeColor='cyan';regimeDesc='Extreme Fear + MVRV rendah = zona akumulasi historis terbaik.';sizingGuidance='DCA bertahap 25-50%.';}
      else if(fg>=35&&fg<=65&&btcRsiNow>40&&obCount/totC<0.15&&(cso.q==='PRIME'||cso.q==='GOOD')){regime='TRADE';regimeColor='green';regimeDesc='Market seimbang + session bagus = kondisi ideal trading.';sizingGuidance='Full sizing. Patuhi SL.';}
      else if(fg>=35&&fg<=65&&btcRsiNow>40&&obCount/totC<0.15){regime='TRADE';regimeColor='green';regimeDesc='Market dalam range. Entry selektif, tunggu PRIME session.';sizingGuidance='50-75% sizing. Ketat SL.';}
      else if(fg>65||mvrvR>1.8){regime='CAUTION';regimeColor='amber';regimeDesc='Market greedy atau MVRV tinggi.';sizingGuidance='Max 0.5-1% risk/trade.';}
      else{regime='AVOID';regimeColor='red';regimeDesc='Kondisi tidak ideal untuk trading aktif.';sizingGuidance='Jangan entry baru.';}
      return{regime,regimeColor,regimeDesc,sizingGuidance,fg,mvrv:mvrvR,osCoins:osCount};
    }catch(e){return{regime:'NORMAL',regimeColor:'gray',regimeDesc:'-',sizingGuidance:'Sizing normal.'}}})();

    const todaysBestTrade=(()=>{try{
      const top=coins.filter(x=>x.direction==='LONG'&&((x.conv&&x.conv.score)||0)>=60).sort((a,b)=>{
        const sA=((b.conv&&b.conv.score)||0)+(b.rsi<30?15:0)+((b.fr||0)<-0.0003?10:0)+(b.divergence==='BULLISH'?8:0)+((b.convStars||0)*2)+(b.mtfAligned==='BULL'?10:0)+(b.oiPattern==='WHALE_LONG'?8:0);
        const sB=((a.conv&&a.conv.score)||0)+(a.rsi<30?15:0)+((a.fr||0)<-0.0003?10:0)+(a.divergence==='BULLISH'?8:0)+((a.convStars||0)*2)+(a.mtfAligned==='BULL'?10:0)+(a.oiPattern==='WHALE_LONG'?8:0);
        return sA-sB;
      })[0]||null;
      if(!top)return null;
      const reasons=[];
      if(top.rsiReal&&top.rsi<35)reasons.push('RSI '+top.rsi.toFixed(1)+' REAL oversold (klines data)');
      if(top.rsi1h&&top.rsi1h<40)reasons.push('RSI 1H: '+top.rsi1h+' oversold (multi-timeframe)');
      if(top.rsi1d&&top.rsi1d<50)reasons.push('RSI 1D: '+top.rsi1d+' bearish zone');
      if((top.fr||0)<-0.0003)reasons.push('FR '+((top.fr||0)*100).toFixed(3)+'% shorts bayar longs');
      if(top.divergence==='BULLISH')reasons.push('Bullish Divergence terdeteksi dari klines');
      if(top.retailLong<=42)reasons.push('Retail '+(100-top.retailLong)+'% short = squeeze potential');
      if(top.isCoiling)reasons.push('ATR menyempit = energi terkumpul untuk breakout');
      if(top.oiPattern==='WHALE_LONG')reasons.push('OI naik +'+top.oiDelta+'% + harga stabil = WHALE MASUK');
      if(top.oiPattern==='SHORT_SQUEEZE')reasons.push('OI turun + harga naik = SHORT COVER sedang berlangsung');
      if(((top.conv&&top.conv.score)||0)>=80)reasons.push('Convergence ELITE '+((top.conv&&top.conv.score)||0)+'/100 (9 faktor)');
      return{sym:top.sym,price:top.price,signal:top.signal||'-',rsi:top.rsi,rsi1h:top.rsi1h,rsi1d:top.rsi1d,fr:top.fr,conv:(top.conv&&top.conv.score)||0,convLabel:(top.conv&&top.conv.label)||'',convStars:top.convStars||0,divergence:top.divergence||null,mtfConfirmed:!!(top.rsiReal&&top.rsi<35),mtfAligned:top.mtfAligned,oiPattern:top.oiPattern,oiDelta:top.oiDelta,retailLong:top.retailLong,retailShort:top.retailShort,retailBias:top.retailBias,futuresRisk:top.futuresRisk||null,reasoning:reasons,entry:top.price,sl:top.levels?top.levels.sl:0,tp1:top.levels?top.levels.tp1:0,tp2:top.levels?top.levels.tp2:0,tp3:top.levels?top.levels.tp3:0,slPct:top.levels?top.levels.slPct:0,tp1Pct:top.levels?top.levels.tp1Pct:0,tp2Pct:top.levels?top.levels.tp2Pct:0,tp3Pct:top.levels?top.levels.tp3Pct:0,rr:top.rr||2.3,probability:top.probability||70,kellySizing:{suggestedSizePct:top.kellySizing&&top.kellySizing.suggestedSizePct?top.kellySizing.suggestedSizePct:typeof top.kellySizing==='number'?top.kellySizing:2},
        regimeWarning:bearEstimate?'BEAR MARKET: Sizing 25-50%. Konfirmasi candle dulu. Prioritas spot/DCA.':null};
    }catch(e){return null}})();


    // DECOUPLING LEADERS - coins moving opposite to BTC dump
    const decouplingLeaders=(()=>{try{
      return coins
        .filter(c=>(c.decouplingScore||0)>=65&&(c.rs||0)>5&&(c.c24||0)>3)
        .sort((a,b)=>(b.decouplingScore||0)-(a.decouplingScore||0))
        .slice(0,15)
        .map(c=>{
          const km3=km[c.sym]||null;
          const atrP=km3&&km3.atr&&c.price>0?+(km3.atr/c.price*100).toFixed(2):+(Math.max(Math.abs(c.c24||0)*0.5,2.5)).toFixed(2);
          const slP=+(Math.max(atrP*2,3)).toFixed(2);
          const volMC=c.mc>0?+(c.vol/c.mc*100).toFixed(1):0;
          return{sym:c.sym,sector:c.sector,price:c.price,c24:c.c24,rs:c.rs,btcC:btcC,vol:c.vol,
            decouplingScore:c.decouplingScore||0,signal:c.signal,rsi:c.rsi,rsiReal:c.rsiReal,
            fr:c.fr||null,oi:c.oi||0,volMCpct:volMC,
            sl:+(c.price*(1-slP/100)).toFixed(c.price>1?2:8),
            tp1:+(c.price*(1+atrP*2/100)).toFixed(c.price>1?2:8),
            tp2:+(c.price*(1+atrP*4/100)).toFixed(c.price>1?2:8),
            slPct:slP,tp2Pct:+(atrP*4).toFixed(2),
            isConfirmed:(c.decouplingScore||0)>=85,
            rr:+(atrP*4/slP).toFixed(1)};
        });
    }catch(e){return[]}})();

    const out={
      ok:true,version:'v15',ts:Date.now(),elapsed:Date.now()-t0,
      dataQuality:{coins:coins.length,realRSI,bybitCoins:Object.values(cm).filter(x=>x.src==='by').length,mexcCoins:Object.values(cm).filter(x=>x.src==='mx').length,btcLS:!!btcLS,btcRsi:!!(btcK&&btcK.rsi),src:'bybit+mexc+phase2',mtf1hCoins:Object.keys(km1h).length,oiDeltaTracked:Object.keys(OI_CACHE.prev).length,phase2Coins:phase2Coins.length,pumpCandidates:coins.filter(x=>x.isPumpCandidate).length},
      fg,fgLabel,
      marketCharacter:{type:mcType,color:mcColor,description:mcDesc,tradeStyle:mcStrat,riskLevel:mcRisk,positionSize:mcPos,marketPct:Math.round(bPct*100)+'% bullish',stats:{oversold:osCount,overbought:obCount,bullish:Math.round(bPct*100),bullPct:Math.round(bPct*100),bearish:Math.round((1-bPct)*100),coiling:coins.filter(x=>x.isCoiling).length,mtfBull:coins.filter(x=>x.mtfAligned==='BULL').length,whaleLong:coins.filter(x=>x.oiPattern==='WHALE_LONG').length}},
      btcSnapshot:{price:btcP,ch24:btcC,rsi:btcK?btcK.rsi||null:null,rsiSlope:btcK?btcK.slopeTxt||'-':'-',rsiDir:btcK?btcK.slopeDir||'flat':'flat',rsi1h:km1h.BTC||null,rsi1d:btcD1rsi,volTrend:btcK?btcK.volTrend||'-':'-',atrPct:btcATRpct,atr:btcATRusd,d1rsi:btcD1rsi,d1trend:btcD1rsi&&btcK&&btcK.rsi?(btcD1rsi<btcK.rsi?'DOWN':'UP'):'-',fg,fgLabel,macd:btcK?btcK.macd||null:null,resistance:btcRes,support:btcSup,current:btcP,aboveEma200:!!(btcK&&btcK.aboveE200),btcLS:btcLS||null,btcLongPct:btcL||null,btcShortPct:btcS||null,oiPattern:cm.BTC?cm.BTC.oiPattern:'NEUTRAL',oiDelta:cm.BTC?cm.BTC.oiDelta:0},
      convergence:{leaders:longs.slice(0,12),longSetups:longs,shortSetups:shorts,flySetups:flys,decouplingCoins:decoupCoins,accumSetups:accums,summary:longs.length+' LONG - '+shorts.length+' SHORT - '+flys.length+' FLY',eliteCount:ec,primeCount:pc,validCount:vc,shortCount:shorts.length},
      gamePlan:{btcLevels:{resistance:btcRes,support:btcSup,current:btcP},scenarios:{bull:{condition:'BTC tembus $'+btcRes+' close di atas',action:'Long conv 65+ RR 1:3 RS+FR+OI filter',setups:top3},sideways:{condition:'BTC konsolidasi +-1.5%',action:'Scalp COILING+ACCUM saja.'},bear:{condition:'BTC breakdown ke $'+btcSup,action:'Cash 80%. SHORT RSI 72+.'}},scalpSetups:flys.slice(0,5).map(x=>({
          sym:x.sym,sector:x.sector||'',price:x.price,signal:x.signal,
          rsi:x.rsi,rsiReal:x.rsiReal||false,fr:x.fr||null,atrPct:x.atrPct||0,
          conv:(x.conv&&x.conv.score)||0,
          entry:x.price,
          sl:x.levels?x.levels.sl:0,slPct:x.levels?x.levels.slPct:2.5,
          tp1:x.levels?x.levels.tp1:0,tp1Pct:x.levels?x.levels.tp1Pct:4.0,
          tp2:x.levels?x.levels.tp2:0,tp2Pct:x.levels?x.levels.tp2Pct:7.0,
          rr:x.rr,reasons:[x.signal||'',x.signalDesc||''].filter(Boolean)
        })),swingSetups:longs.filter(x=>((x.conv&&x.conv.score)||0)>=70).slice(0,5).map(x=>{
          const reasons=[];
          if(x.rsiReal&&x.rsi<40)reasons.push('RSI '+x.rsi+' real oversold');
          if((x.fr||0)<-0.0003)reasons.push('FR '+((x.fr||0)*100).toFixed(3)+'%');
          if(x.divergence==='BULLISH')reasons.push('Bullish divergence');
          if(x.oiPattern==='WHALE_LONG')reasons.push('OI whale entry');
          if(x.mtfAligned==='BULL')reasons.push('MTF confluence');
          return{
            sym:x.sym,sector:x.sector||'',price:x.price,signal:x.signal,
            rsi:x.rsi,rsiReal:x.rsiReal||false,fr:x.fr||null,
            atrPct:x.atrPct||0,
            conv:(x.conv&&x.conv.score)||0,
            entry:x.price,
            sl:x.levels?x.levels.sl:0,
            slPct:x.levels?x.levels.slPct:2.5,
            tp1:x.levels?x.levels.tp1:0,
            tp1Pct:x.levels?x.levels.tp1Pct:4.0,
            tp2:x.levels?x.levels.tp2:0,
            tp2Pct:x.levels?x.levels.tp2Pct:7.0,
            tp3:x.levels?x.levels.tp3:0,
            rr:x.rr,
            reasons:reasons
          };
        }),activeShorts:shorts.slice(0,5).map(x=>({sym:x.sym,price:x.price,signal:x.signal,rsi:x.rsi})),spotAccum,avoidList},
      sectorFlow:{sectors,sectorData},
      checklist:{marketChecks:mkChecks,coinChecks:['RSI koin < 72','Conv Score 60+','FR < +0.04%','RR min 1:2','No entry 30min sebelum news','Vol 5M+ USD','Size 2% equity max','SL ATR-based','Volume konfirmasi','Sesuai skenario Game Plan'],marketPassCount:pass,marketTotal:8,overallGreenLight:pass>=6,verdict:pass>=6?'KONDISI LAYAK TRADING':'HATI-HATI - '+(8-pass)+' kondisi belum terpenuhi'},
      tradingSchedule:{wibHour:wibH,dayName:days[now2.getUTCDay()],sessions:sess,currentSession:cs,currentSessionObj:cso,focusToday,nextPrimeSession:nxt,nextPrime:nxt},
      decouplingLeaders,smRadar,pumpHunter,whaleLoadingRadar,whaleFingerprint,squeezeRadar,stealthVolume,hiddenGems,momentumShift,oiDeltaLeaders,retailTrapList,retailSqueezeList,
      dailyOpportunityScore,marketRegime,todaysBestTrade
    };
    const json=JSON.stringify(out);
    CACHE.d=out;CACHE.t=Date.now();
    return res.status(200).send(json);
  }catch(e){
    try{return res.status(200).json(Object.assign({},SAFE,{ok:false,error:String(e&&e.message?e.message:'Unknown'),elapsed:Date.now()-t0,ts:Date.now()}));}
    catch(e2){return res.status(200).end('{"ok":false,"error":"critical","version":"v15"}');}
  }
}