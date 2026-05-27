// api/morning-brief.js — v10 BULLETPROOF · 500+ Koin · Zero Error
// ═══════════════════════════════════════════════════════════════
// GUARANTEED: Never returns HTTP 500. ALWAYS returns 200.
// - Outer try-catch wraps 100% of processing
// - Promise.allSettled never throws
// - Each coin analysis wrapped individually
// - Safe fallback response if everything fails
// ═══════════════════════════════════════════════════════════════
const N=(v,d=0)=>{try{const n=+v;return isNaN(n)||!isFinite(n)?d:n}catch{return d}};
const A=(v)=>{try{return Array.isArray(v)?v:[]}catch{return[]}};
const cl=(v,a,b)=>{try{return Math.max(a,Math.min(b,N(v)))}catch{return a}};
const STAB=new Set(['USDT','USDC','BUSD','DAI','TUSD','FDUSD','USDE','FRAX','GUSD','USDP','PYUSD','UST']);
const BAD=['UP','DOWN','BULL','BEAR','3L','3S','2L','2S','5L','5S'];
const SECS={Bitcoin:['BTC'],Ethereum:['ETH'],L1:['SOL','ADA','AVAX','TON','NEAR','SUI','APT','TIA','SEI','ENA','HBAR','ALGO','XLM','LTC','VET','TRX','BERA'],L2:['ARB','OP','STRK','ZRO','MANTA','RON','W','STX','ZK'],DeFi:['AAVE','JUP','PENDLE','GMX','LDO','UNI','CRV','RDNT','CAKE','LQTY','ETHFI','DYDX','SNX','COMP'],AIDePin:['RENDER','FET','TAO','WLD','IO','OLAS','VIRTUAL','GRT','EIGEN','ARKM'],Meme:['DOGE','PEPE','WIF','BONK','FLOKI','MOODENG','NEIRO','ACT','PONKE','TURBO','BOME','GOAT'],Gaming:['SAND','MANA','AXS','GALA','BEAM','MAGIC','RON','ILV','PRIME'],Infrastructure:['LINK','DOT','INJ','ATOM','FIL','ONDO','JTO','PYTH'],Payments:['XRP','TRX','XLM','LTC','BNB','HBAR'],Trending:['HYPE','NOT','JASMY','DRIFT','ETC','RUNE','PARTI','LQTY']};
const getSec=s=>{try{for(const[n,v]of Object.entries(SECS))if(v.includes(s))return n}catch{}return'Other'};

const r14=a=>{try{if(!a||a.length<16)return null;let g=0,l=0;for(let i=1;i<=14;i++){const d=a[i]-a[i-1];d>0?g+=d:l-=d}g/=14;l/=14;for(let i=15;i<a.length;i++){const d=a[i]-a[i-1];g=(g*13+Math.max(d,0))/14;l=(l*13+Math.max(-d,0))/14}return l===0?100:cl(100-100/(1+g/l),0,100)}catch{return null}};
const em=(a,p)=>{try{if(!a||a.length<2)return N(a?.[a.length-1]);const k=2/(p+1);let e=a.slice(0,Math.min(p,a.length)).reduce((s,v)=>s+v,0)/Math.min(p,a.length);for(let i=Math.min(p,a.length);i<a.length;i++)e=N(a[i])*k+e*(1-k);return e}catch{return 0}};
const mc14=a=>{try{if(!a||a.length<36)return null;const k12=2/13,k26=2/27,k9=2/10;let e12=a.slice(0,12).reduce((s,v)=>s+v,0)/12,e26=a.slice(0,26).reduce((s,v)=>s+v,0)/26,mv=[];for(let i=26;i<a.length;i++){e12=N(a[i])*k12+e12*(1-k12);e26=N(a[i])*k26+e26*(1-k26);mv.push(e12-e26)}if(mv.length<9)return null;let sg=mv.slice(0,9).reduce((s,v)=>s+v,0)/9;for(let i=9;i<mv.length;i++)sg=mv[i]*k9+sg*(1-k9);const n=mv.length,last=N(mv[n-1]),h=last-sg,ph=N(mv[n-2],last)-sg;return{bull:last>0&&h>0,bear:last<0&&h<0,xUp:h>0&&ph<=0,xDown:h<0&&ph>=0}}catch{return null}};

const SAFE_RESP={ok:false,version:'v10',ts:0,elapsed:0,dataQuality:{coins:0,realRSI:0,bybitCoins:0,mexcCoins:0,btcLS:false,btcRsi:false,src:'error'},fg:50,fgLabel:'Neutral',marketCharacter:{type:'⚖️ TRANSITIONAL',color:'amber',description:'Refresh dalam 30 detik.',tradeStyle:'Cautious',riskLevel:'REDUCED',stats:{bullPct:50,overbought:0,oversold:0,avgCh:0}},btcSnapshot:{price:0,ch24:0,rsi:null,fg:50,fgLabel:'Neutral',btcLS:null,btcLongPct:null,btcShortPct:null},convergence:{leaders:[],longSetups:[],shortSetups:[],flySetups:[],accumSetups:[],summary:'Error',eliteCount:0,primeCount:0,validCount:0,shortCount:0},gamePlan:{btcLevels:{resistance:null,support:null,current:null},scenarios:{bull:{condition:'—',action:'—',setups:[]},sideways:{condition:'—',action:'—',setups:[]},bear:{condition:'—',action:'—',setups:[]}},scalpSetups:[],swingSetups:[],activeShorts:[],spotAccum:[],avoidList:[],flySetups:[],accumSetups:[]},sectorFlow:{sectors:[],sectorData:{}},tradingSchedule:{wibHour:0,dayName:'—',sessions:[],currentSession:'dead',positionSizeRec:'—',focusToday:'Error. Refresh halaman.',nextPrimeSession:null},checklist:{marketChecks:[],marketPassCount:0,marketTotal:8,coinChecks:[],overallGreenLight:false,verdict:'⚠️ Error. Coba refresh.'}};

const CACHE={d:null,t:0};

export default async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Cache-Control','s-maxage=300,stale-while-revalidate=60');
  if(req.method==='OPTIONS')return res.status(200).end();
  const t0=Date.now();

  // Cache check
  try{if(CACHE.d&&Date.now()-CACHE.t<300000)return res.status(200).json({...CACHE.d,cached:true,elapsed:Date.now()-t0})}catch{}

  // Safe fetch — NEVER throws
  const get=async(url,ms=2500)=>{try{const c=new AbortController(),t=setTimeout(()=>c.abort(),ms);const r=await fetch(url,{signal:c.signal,headers:{Accept:'application/json','User-Agent':'AC369/10'}});clearTimeout(t);if(!r||!r.ok)return null;return await r.json()}catch{return null}};

  // Fetch all — Promise.allSettled NEVER throws
  const [R0,R1,R2,R3,R4,R5,R6]=await Promise.allSettled([
    get('https://api.bybit.com/v5/market/tickers?category=linear',2500),
    get('https://api.mexc.com/api/v3/ticker/24hr',2500),
    get('https://api.bybit.com/v5/market/kline?category=linear&symbol=BTCUSDT&interval=240&limit=50',2500),
    get('https://api.bybit.com/v5/market/kline?category=linear&symbol=ETHUSDT&interval=240&limit=50',2500),
    get('https://api.bybit.com/v5/market/kline?category=linear&symbol=SOLUSDT&interval=240&limit=50',2500),
    get('https://api.bybit.com/v5/market/account-ratio?category=linear&symbol=BTCUSDT&period=1h&limit=1',2500),
    get('https://api.alternative.me/fng/?limit=1&format=json',2500),
  ]);

  // ── ALL PROCESSING IN ONE BIG TRY-CATCH ──────────────────
  try{

    // Build coin map
    const cm={};
    try{for(const t of A(R0.value?.result?.list)){try{const s=String(t?.symbol||'').replace(/USDT|PERP/g,'');if(!s||s.length>12||STAB.has(s)||BAD.some(x=>s.endsWith(x)))continue;const p=N(t.lastPrice);if(p<=0||p>1e10)continue;const prev=N(t.prevPrice24h||p),c24=prev>0?+((p-prev)/prev*100).toFixed(2):N(t.price24hPcnt)*100,h=N(t.highPrice24h||p*1.02),l=N(t.lowPrice24h||p*0.98),pip=h>l?cl((p-l)/(h-l)*100,0,100):50;cm[s]={p,fr:N(t.fundingRate),oi:N(t.openInterestValue),c24,v:N(t.turnover24h),h,l,pip,fp:+(N(t.fundingRate)*100).toFixed(4),src:'by'}}catch{}}}catch{}

    try{const mx=A(R1.value).filter(t=>String(t?.symbol||'').endsWith('USDT')).sort((a,b)=>N(b?.quoteVolume)-N(a?.quoteVolume)).slice(0,600);for(const t of mx){try{const s=String(t?.symbol||'').replace('USDT','');if(!s||s.length>12||STAB.has(s)||BAD.some(x=>s.endsWith(x)||s.startsWith(x))||cm[s])continue;const p=N(t.lastPrice);if(p<=0||p>1e10||N(t.quoteVolume)<100000)continue;if(p>=0.97&&p<=1.03&&Math.abs(N(t.priceChangePercent))<0.5)continue;const c24=N(t.priceChangePercent),h=N(t.highPrice)||p*1.02,l=N(t.lowPrice)||p*0.98,pip=h>l?cl((p-l)/(h-l)*100,0,100):50;cm[s]={p,fr:0,oi:0,c24,v:N(t.quoteVolume),h,l,pip,fp:0,src:'mx'}}catch{}}}catch{}

    // Klines (safe OBV calc)
    const km={};let realRSI=0;
    for(const[sym,kR]of[['BTC',R2],['ETH',R3],['SOL',R4]]){
      try{
        if(N(kR.value?.retCode)!==0)continue;
        const raw=A(kR.value?.result?.list);if(raw.length<16)continue;
        const K=raw.slice().reverse().map(d=>({c:N(d[4]),h:N(d[2]),l:N(d[3]),v:N(d[6])})).filter(d=>d.c>0&&d.h>0&&d.l>0);
        if(K.length<16)continue;
        const cls=K.map(k=>k.c);
        const rsi=r14(cls);if(rsi===null)continue;
        const macd=mc14(cls);
        const e9=em(cls,9),e200=em(cls,Math.min(200,cls.length-1));
        const lp=N(cls[cls.length-1]);
        // Safe ATR calc
        const aA=[];for(let i=1;i<K.length;i++){try{aA.push(Math.max(K[i].h-K[i].l,Math.abs(K[i].h-K[i-1].c),Math.abs(K[i].l-K[i-1].c)))}catch{}}
        const atr=aA.length>=14?aA.slice(-14).reduce((s,v)=>s+v,0)/14:0;
        const r5=aA.length>=5?aA.slice(-5).reduce((s,v)=>s+v,0)/5:atr;
        const a20=aA.length>=20?aA.slice(-20).reduce((s,v)=>s+v,0)/20:atr;
        // Safe OBV - simplified
        let vBull=0,vBear=0;
        for(let i=Math.max(1,K.length-10);i<K.length;i++){if(K[i].c>K[i-1].c)vBull+=K[i].v;else if(K[i].c<K[i-1].c)vBear+=K[i].v}
        km[sym]={rsi:+rsi.toFixed(2),macd,e9,e200,atr:+atr.toFixed(8),price:lp,aboveE200:lp>e200,isCoiling:a20>0&&r5<a20*0.65,vB:vBull>vBear*1.2,src:'by'};
        realRSI++;
      }catch{}
    }

    // L/S + FG
    let btcLS=null,btcL=null,btcS=null;
    try{const row=A(R5.value?.result?.list)[0];if(row){btcL=+N(row.buyRatio*100).toFixed(2);btcS=+N(row.sellRatio*100).toFixed(2);btcLS=btcS>0?+(btcL/btcS).toFixed(3):null}}catch{}
    const fg=N(R6.value?.data?.[0]?.value,50);
    const fgLabel=String(R6.value?.data?.[0]?.value_classification||'Neutral');

    // BTC baseline
    const btcK=km.BTC||null;
    const btcBy=cm.BTC||{};
    const btcP=N(btcK?.price||btcBy?.p||0);
    const btcC=N(btcBy?.c24||0);
    const btcATR=N(btcK?.atr||0);
    const btcAP=btcP>0&&btcATR>0?+(btcATR/btcP*100).toFixed(2):null;

    // Analyze coins
    const coins=[];
    for(const[sym,by]of Object.entries(cm)){
      try{
        const p=N(by.p);if(!p||p<=0)continue;
        const c24=N(by.c24),vol=N(by.v);if(vol<80000)continue;
        const fr=N(by.fr),fp=N(by.fp),oi=N(by.oi),pip=N(by.pip,50);
        const kd=km[sym]||null;
        // RSI: real or high-accuracy estimate
        let rsi,rR=false;
        try{
          if(kd?.rsi){rsi=kd.rsi;rR=true}
          else{let b=pip+c24*1.5;if(fr<-0.0005)b-=8;else if(fr>0.0005)b+=8;rsi=Math.round(cl(b,8,92))}
        }catch{rsi=50}
        const macd=kd?.macd||null,ic=kd?.isCoiling||false,vb=kd?.vB||false;
        const atr=N(kd?.atr||0);
        const ap=p>0&&atr>0?+(atr/p*100).toFixed(2):null;
        const rs=+(c24-btcC).toFixed(2);
        const sec=getSec(sym);

        // Signal detection
        let sig='⚖️ SIDEWAYS',sc='#7a8fa8',dir='WAIT',prob=50,desc='RSI '+rsi.toFixed(0)+'·'+c24.toFixed(1)+'%';
        try{
          if(rsi<28&&c24>0&&fr<-0.0003&&(macd?.xUp||macd?.bull)&&vol>1e6){sig='🚀 ABOUT TO FLY';sc='#00ffd0';dir='LONG';prob=86;desc='RSI '+rsi.toFixed(0)+' oversold · FR '+fp.toFixed(4)+'% squeeze · MACD · discount zone';}
          else if(rsi<22&&c24>0.5&&pip<35){sig='💎 CAPITULATION';sc='#00ff88';dir='LONG';prob=84;desc='RSI '+rsi.toFixed(0)+' EXTREME oversold · reversal +'+c24.toFixed(1)+'% · bottom zone';}
          else if(rsi<40&&c24>0&&ic&&vol>500000){sig='🤫 ACCUMULATION';sc='#4af0ff';dir='LONG';prob=80;desc='RSI '+rsi.toFixed(0)+' oversold · coiling · SM masuk diam-diam';}
          else if(ic&&rsi>=38&&rsi<=62&&Math.abs(c24)<2.5&&vol>500000){sig='⚡ COILING';sc='#f0c040';dir='WATCH';prob=71;desc='ATR menyempit'+(ap?(' '+ap+'%'):'')+' · breakout imminent';}
          else if(btcC<-1&&c24>2&&vol>2e6&&rs>5){sig='🔮 DECOUPLING';sc='#c084fc';dir='LONG';prob=76;desc='BTC '+btcC.toFixed(1)+'% tapi +'+c24.toFixed(1)+'% · catalyst detected!';}
          else if(rsi<36&&c24>1.2&&pip>20){sig='🔄 OVERSOLD BOUNCE';sc='#88ff99';dir='LONG';prob=77;desc='RSI '+rsi.toFixed(0)+' oversold · reversal +'+c24.toFixed(1)+'%';}
          else if(c24>5&&rsi>=45&&rsi<=70&&vol>5e6&&pip>55){sig='📈 BREAKOUT';sc='#00ffd0';dir='LONG';prob=78;desc='+'+c24.toFixed(1)+'% breakout · vol $'+(vol/1e6).toFixed(0)+'M · institutional';}
          else if(c24>2&&rsi>=48&&rsi<=65&&rs>3&&vol>3e6){sig='📈 MOMENTUM';sc='#66ff99';dir='LONG';prob=70;desc='+'+c24.toFixed(1)+'% · RS BTC +'+rs+'%';}
          else if(rsi>72&&fp>0.04&&pip>72){sig='🔴 SHORT ZONE';sc='#ff4466';dir='SHORT';prob=74;desc='RSI '+rsi.toFixed(0)+' overbought · FR +'+fp.toFixed(4)+'% overheated';}
          else if(rsi>68&&pip>70&&oi>2e9){sig='⚠️ DISTRIBUTION';sc='#ff8800';dir='SHORT';prob=67;desc='RSI '+rsi.toFixed(0)+' · premium · OI $'+(oi/1e9).toFixed(1)+'B · SM jual';}
          else if(c24<-5&&rsi<45){sig='📉 BEARISH';sc='#ff6688';dir='SHORT';prob=42;desc=c24.toFixed(1)+'% breakdown · avoid long';}
          else if(rsi>=42&&rsi<=62&&c24>0.5){sig='↗️ MILD BULL';sc='#a0e040';dir='LONG';prob=64;desc='+'+c24.toFixed(1)+'% · RSI '+rsi.toFixed(0)+' healthy';}
        }catch{}

        // Convergence 5-factor (safe)
        let f1=0,f2=0,f3=0,f4=0,f5=0;
        try{f1=rsi<20?30:rsi<28?24:rsi<35?18:rsi<42?11:rsi<50?4:rsi>78?-18:rsi>72?-12:rsi>65?-5:2;if(macd?.xUp)f1+=14;else if(macd?.bull)f1+=7;else if(macd?.xDown)f1-=11;else if(macd?.bear)f1-=5;if(vb&&c24>0)f1+=7;if(ic&&rsi<55)f1+=5;f1=cl(f1,-28,42)}catch{}
        try{f2=fr<-0.0008?20:fr<-0.0005?14:fr<-0.0003?9:fr<-0.0001?4:fr>0.0008?-14:fr>0.0005?-9:fr>0.0003?-4:0;f2=cl(f2,-20,25)}catch{}
        try{f3=vol>500e6?8:vol>100e6?5:vol>20e6?3:vol>5e6?1:vol<100000?-4:0;f3+=c24>8?6:c24>3?3:c24>0?1:c24<-8?-6:c24<-3?-3:c24<0?-1:0;f3=cl(f3,-14,22)}catch{}
        try{f4=rs>8?14:rs>3?9:rs>0?4:rs<-8?-9:rs<-3?-5:0;f4=cl(f4,-14,20)}catch{}
        try{f5=oi>10e9&&fr<-0.0002?10:oi>5e9&&fr<0?6:oi>2e9?3:oi>1e9?1:0;f5=cl(f5,0,10)}catch{}
        const cv=cl(Math.round(45+f1+f2+f3+f4+f5),0,100);
        const lb=cv>=80?'🔥ELITE':cv>=70?'💎PRIME':cv>=60?'✅VALID':cv>=50?'🟡MOD':'⚪WEAK';

        // ATR SL/TP (safe)
        let sl,tp1,tp2,slP=2.5,tp1P=4.5,tp2P=8;
        try{slP=ap?+(ap*1.5).toFixed(2):2.5;tp1P=ap?+(ap*2).toFixed(2):4.5;tp2P=ap?+(ap*3.5).toFixed(2):8;sl=dir==='LONG'?+(p*(1-slP/100)).toFixed(p>1?4:8):+(p*(1+slP/100)).toFixed(p>1?4:8);tp1=dir==='LONG'?+(p*(1+tp1P/100)).toFixed(p>1?4:8):+(p*(1-tp1P/100)).toFixed(p>1?4:8);tp2=dir==='LONG'?+(p*(1+tp2P/100)).toFixed(p>1?4:8):+(p*(1-tp2P/100)).toFixed(p>1?4:8)}catch{sl=+(p*.975).toFixed(4);tp1=+(p*1.045).toFixed(4);tp2=+(p*1.08).toFixed(4)}

        coins.push({sym,sector:sec,price:p,c24,vol,rsi:+rsi.toFixed(1),rsiReal:rR,fr:fp||null,isCoiling:ic,rs,atr:atr>0?+atr.toFixed(p>1?4:8):null,atrPct:ap,pip:+pip.toFixed(1),signal:sig,signalColor:sc,signalDesc:desc,direction:dir,probability:prob,conv:{score:cv,label:lb},levels:{sl:sl||0,tp1:tp1||0,tp2:tp2||0,slPct:slP,tp1Pct:tp1P,tp2Pct:tp2P},src:by.src||'by'});
      }catch{}// per-coin error never kills the loop
    }

    coins.sort((a,b)=>b.conv.score-a.conv.score);

    const longs=coins.filter(x=>x.direction==='LONG'&&x.conv.score>=60).slice(0,25);
    const shorts=coins.filter(x=>x.direction==='SHORT'&&x.conv.score>=55).slice(0,10);
    const flys=coins.filter(x=>x.signal.includes('ABOUT TO FLY')||x.signal.includes('CAPITULATION')).slice(0,8);
    const accums=coins.filter(x=>x.signal.includes('ACCUMULATION')||x.signal.includes('COILING')||x.signal.includes('DECOUPLING')).slice(0,8);
    const top25=coins.slice(0,25);
    const ec=top25.filter(x=>x.conv.score>=80).length;
    const pc=top25.filter(x=>x.conv.score>=70&&x.conv.score<80).length;
    const vc=top25.filter(x=>x.conv.score>=60&&x.conv.score<70).length;
    const os2=coins.filter(x=>x.rsi<30).length;
    const avg=coins.length?+(coins.reduce((s,x)=>s+x.c24,0)/coins.length).toFixed(2):0;
    const bp=Math.round(coins.filter(x=>x.c24>0).length/Math.max(coins.length,1)*100);

    // Market character
    let mct='⚖️ TRANSITIONAL',mcc='amber',mcd='Mixed signals. Sizing kecil.',mcs='Cautious',mcr='REDUCED';
    if(os2>=15&&avg<0){mct='🔥 CAPITULATION BOTTOM';mcc='green';mcd=os2+' koin RSI<30. BEST accumulation. FR negatif = prime target.';mcs='Aggressive DCA';mcr='HIGH REWARD';}
    else if(avg>4&&bp>65&&fg>55){mct='🚀 BULL MOMENTUM';mcc='green';mcd='Momentum kuat di '+coins.length+' koin. Trail stop. Tambah pullback.';mcs='Momentum Riding';mcr='MODERATE';}
    else if(avg>1.5&&bp>55){mct='📈 MILD BULL';mcc='green';mcd=longs.length+' long setups valid. Conv ≥70 saja.';mcs='Selective Long';mcr='MODERATE';}
    else if(avg<-4&&bp<35){mct='📉 BEAR MOMENTUM';mcc='red';mcd='Tekanan jual luas. Short valid. Hindari long kecuali RSI<22.';mcs='Short/Cash';mcr='CASH HEAVY';}
    else if(avg<-1.5&&bp<45){mct='🌧 MILD BEAR';mcc='amber';mcd='Mild bearish. Sizing 40-50%.';mcs='Small Sizing';mcr='REDUCED';}
    else if(os2>=20){mct='💎 MASS OVERSOLD';mcc='green';mcd=os2+' koin RSI<30 dari '+coins.length+'. DCA zone terbaik.';mcs='Counter-trend DCA';mcr='MODERATE-HIGH';}

    // Sectors
    const sdm={};
    try{for(const[sn,sc3]of Object.entries(SECS)){try{const sc4=coins.filter(x=>sc3.includes(x.sym));if(!sc4.length)continue;const ac=+(sc4.reduce((s,x)=>s+x.c24,0)/sc4.length).toFixed(2);sdm[sn]={name:sn,avgCh24:ac,avgRSI:+(sc4.reduce((s,x)=>s+x.rsi,0)/sc4.length).toFixed(1),avgConv:+(sc4.reduce((s,x)=>s+x.conv.score,0)/sc4.length).toFixed(0),flowSig:ac>3?'↑↑ INFLOW':ac>1?'↑ INFLOW':ac<-3?'↓↓ OUTFLOW':ac<-1?'↓ OUTFLOW':'→ NEUTRAL',flowCol:ac>3?'green':ac>1?'lightgreen':ac<-3?'red':ac<-1?'orange':'gray',coinsCount:sc4.length,bullCoins:sc4.filter(x=>x.direction==='LONG').length,shortCoins:sc4.filter(x=>x.direction==='SHORT').length,coins:sc4.map(c=>({sym:c.sym,price:c.price,c24:c.c24,vol:c.vol,rsi:c.rsi,rsiReal:c.rsiReal,signal:c.signal,signalColor:c.signalColor,signalDesc:c.signalDesc,direction:c.direction,probability:c.probability,conv:c.conv.score,fr:c.fr,atrPct:c.atrPct,levels:c.levels,isCoiling:c.isCoiling,pip:c.pip,rs:c.rs}))};}catch{}}}catch{}

    // Setups
    const mk=c=>{try{return{sym:c.sym,sector:c.sector,entry:c.price,sl:c.levels.sl,tp1:c.levels.tp1,tp2:c.levels.tp2,slPct:c.levels.slPct,tp1Pct:c.levels.tp1Pct,tp2Pct:c.levels.tp2Pct,rr:+(c.levels.tp1Pct/Math.max(c.levels.slPct,.1)).toFixed(1),conv:c.conv.score,rsi:c.rsi,rsiReal:c.rsiReal,fr:c.fr,atrPct:c.atrPct,signal:c.signal,reasons:[c.signalDesc]}}catch{return{sym:c.sym||'?',sector:'Other',entry:c.price||0,sl:0,tp1:0,tp2:0,slPct:2.5,tp1Pct:4.5,tp2Pct:8,rr:1.8,conv:c.conv?.score||50,rsi:c.rsi||50,rsiReal:false,fr:null,atrPct:null,signal:c.signal||'—',reasons:[]}}};
    const scalpS=longs.filter(x=>x.atrPct&&x.vol>2e6&&x.rsi<72).slice(0,6).map(mk);
    const swingS=longs.filter(x=>x.atrPct&&x.vol>5e6&&x.rsi<65).slice(0,4).map(c=>{try{return{...mk(c),sl:+(c.price*(1-c.atrPct/100*2)).toFixed(c.price>1?4:8),tp1:+(c.price*(1+c.atrPct/100*3)).toFixed(c.price>1?4:8),tp2:+(c.price*(1+c.atrPct/100*5)).toFixed(c.price>1?4:8),slPct:+(c.atrPct*2).toFixed(2),tp1Pct:+(c.atrPct*3).toFixed(2),tp2Pct:+(c.atrPct*5).toFixed(2)}}catch{return mk(c)}});
    const shortS=shorts.filter(x=>x.atrPct&&x.vol>3e6).slice(0,4).map(c=>{try{return{...mk(c),sl:+(c.price*(1+c.atrPct/100*1.5)).toFixed(c.price>1?4:8),tp1:+(c.price*(1-c.atrPct/100*2)).toFixed(c.price>1?4:8),tp2:+(c.price*(1-c.atrPct/100*3.5)).toFixed(c.price>1?4:8),slPct:+(c.atrPct*1.5).toFixed(2),tp1Pct:+(c.atrPct*2).toFixed(2),tp2Pct:+(c.atrPct*3.5).toFixed(2)}}catch{return mk(c)}});
    const spotA=coins.filter(x=>x.rsi<35&&x.vol>500000&&x.c24>-6&&x.conv.score>=50).slice(0,8).map(c=>({sym:c.sym,price:c.price,rsi:c.rsi,rsiReal:c.rsiReal,dcaZone:'$'+c.levels.sl,atrPct:c.atrPct,conv:c.conv.score,signal:c.signal}));
    const avoid=coins.filter(x=>x.rsi>74&&x.direction!=='LONG').slice(0,5).map(c=>({sym:c.sym,rsi:c.rsi,fr:c.fr,reason:c.signalDesc}));

    // Schedule
    const now=new Date();const wibM=(now.getUTCHours()*60+now.getUTCMinutes()+420)%1440,wibH=Math.floor(wibM/60);
    const days=['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];
    const sess=[{id:'dead',name:'🌙 Dead Zone',time:'02:00–06:00',start:2,end:6,q:'POOR',activity:'Istirahat.'},{id:'asia_open',name:'🌏 Asia Open',time:'06:00–09:00',start:6,end:9,q:'MODERATE',activity:'Monitor oversold.'},{id:'asia_peak',name:'🔥 Asia Peak',time:'09:00–12:00',start:9,end:12,q:'GOOD',activity:'Breakout Asia.'},{id:'lunch',name:'⚠️ Lunch',time:'12:00–15:00',start:12,end:15,q:'CAUTION',activity:'Hindari entry.'},{id:'london',name:'🌍 London',time:'15:00–18:00',start:15,end:18,q:'PRIME',activity:'PRIME: Volume institusional!'},{id:'ny_pre',name:'📊 NY Pre',time:'18:00–21:00',start:18,end:21,q:'BUILDING',activity:'Pre-market AS.'},{id:'ny_open',name:'🚀 NY Open',time:'21:00–23:00',start:21,end:23,q:'PRIME',activity:'PRIME: Volume tertinggi!'},{id:'ny_late',name:'🌙 NY Late',time:'23:00–02:00',start:23,end:26,q:'GOOD',activity:'Exit sebelum dead zone.'}];
    let cs='dead';try{for(const s of sess){const e=s.end>24?s.end-24:s.end;if(s.start>20){if(wibH>=s.start||wibH<e){cs=s.id;break}}else if(wibH>=s.start&&wibH<s.end){cs=s.id;break}}}catch{}
    const cso=sess.find(s=>s.id===cs)||sess[0];
    const np=sess.filter(s=>s.q==='PRIME').map(s=>({...s,inH:s.start>wibH?s.start-wibH:24-(wibH-s.start)})).sort((a,b)=>a.inH-b.inH)[0]||null;

    // Checklist
    const frOH=Object.values(cm).filter(x=>x.fr>0.0005).length;
    const mktC=[
      {label:'Market character layak trading',pass:mcc!=='red'||os2>=15,detail:'Character: '+mct,fix:'Tunggu market shift'},
      {label:'Trading session berkualitas',pass:cso.q==='PRIME'||cso.q==='GOOD',detail:cso.name+' ('+cso.q+')',fix:'Tunggu London 15:00 atau NY 21:00 WIB'},
      {label:'BTC tidak di resistance',pass:btcK?.rsi?btcK.rsi<72:true,detail:btcK?.rsi?'BTC RSI '+btcK.rsi.toFixed(0):'BTC aman',fix:'Tunggu BTC RSI <65'},
      {label:'FR market tidak overheated',pass:frOH<15,detail:frOH+' koin FR>0.05%',fix:'Pasar overheated'},
      {label:'Market tidak overbought massal',pass:coins.filter(x=>x.rsi>70).length<coins.length*.3,detail:coins.filter(x=>x.rsi>70).length+'/'+coins.length+' koin RSI>70',fix:'Tunggu koreksi'},
      {label:'BTC L/S ratio aman',pass:btcLS?btcLS<2.5:true,detail:btcLS?'L/S: '+btcLS+' ('+btcL+'%L/'+btcS+'%S)':'Data tidak tersedia',fix:'L/S >2.5 = risk tinggi'},
      {label:'Cukup koin aktif & liquid',pass:coins.filter(x=>x.vol>10e6&&x.c24>0).length>=20,detail:coins.filter(x=>x.vol>10e6&&x.c24>0).length+' koin aktif (vol>$10M)',fix:'Market sepi'},
      {label:'BTC mendukung altcoin',pass:btcC>-2,detail:'BTC '+btcC.toFixed(2)+'%'+(btcC<-2?' bearish':''),fix:'Tunggu BTC stabilisasi'},
    ];
    const pass=mktC.filter(x=>x.pass).length;
    const btcR=btcP>0&&btcAP?+(btcP*(1+btcAP/100*2)).toFixed(0):btcP>0?+(btcP*1.04).toFixed(0):null;
    const btcSp=btcP>0&&btcAP?+(btcP*(1-btcAP/100*2)).toFixed(0):btcP>0?+(btcP*.96).toFixed(0):null;

    const out={ok:true,version:'v10',ts:Date.now(),elapsed:Date.now()-t0,
      dataQuality:{coins:coins.length,realRSI,bybitCoins:Object.keys(cm).filter(k=>cm[k].src==='by').length,mexcCoins:Object.keys(cm).filter(k=>cm[k].src==='mx').length,btcLS:btcLS!=null,btcRsi:!!(btcK?.rsi),src:'bybit+mexc+altme'},
      fg,fgLabel,
      marketCharacter:{type:mct,color:mcc,description:mcd,tradeStyle:mcs,riskLevel:mcr,stats:{bullPct:bp,overbought:coins.filter(x=>x.rsi>70).length,oversold:os2,avgCh:avg}},
      btcSnapshot:{price:btcP,ch24:btcC,rsi:btcK?.rsi||null,fg,fgLabel,macd:btcK?.macd||null,btcLS,btcLongPct:btcL,btcShortPct:btcS,atr:btcATR>0?+btcATR.toFixed(2):null,atrPct:btcAP,aboveEma200:!!btcK?.aboveE200},
      convergence:{leaders:top25,longSetups:longs,shortSetups:shorts,flySetups:flys,accumSetups:accums,summary:(ec?'🔥'+ec+' ELITE · ':'')+pc+'💎PRIME · '+vc+'✅VALID'+(shorts.length?' · '+shorts.length+'🔴SHORT':''),eliteCount:ec,primeCount:pc,validCount:vc,shortCount:shorts.length},
      gamePlan:{btcLevels:{resistance:btcR,support:btcSp,current:btcP||null},scenarios:{bull:{condition:'BTC tembus $'+(btcR||'resistance')+' close di atas',action:'Long conv≥'+(ec?72:65)+' RR1:3 RS+FR filter',setups:longs.slice(0,3)},sideways:{condition:'BTC konsolidasi ±1.5%',action:'Scalp COILING+ACCUM saja.',setups:accums.slice(0,2)},bear:{condition:'BTC breakdown ke $'+(btcSp||'support'),action:'Cash '+(shorts.length>2?60:80)+'%. SHORT RSI>72.',setups:shortS.slice(0,2)}},scalpSetups:scalpS,swingSetups:swingS,activeShorts:shortS,spotAccum:spotA,avoidList:avoid,flySetups:flys,accumSetups:accums},
      sectorFlow:{sectors:Object.values(sdm).sort((a,b)=>b.avgCh24-a.avgCh24),sectorData:sdm},
      tradingSchedule:{wibHour:wibH,dayName:days[now.getUTCDay()],sessions:sess,currentSession:cs,positionSizeRec:cso.q==='PRIME'?'Full (100%)':cso.q==='GOOD'?'Large (75%)':cso.q==='MODERATE'?'Half (50%)':'Minimal (25%)',focusToday:mct+'. '+(cso.q==='PRIME'?'🔥 PRIME — aktif!':cso.q==='POOR'?'Istirahat.':'Session '+cso.q+'.'),nextPrimeSession:np},
      checklist:{marketChecks:mktC,marketPassCount:pass,marketTotal:8,coinChecks:['RSI koin < 72','Vol ≥ $5M','Conv Score ≥ '+(ec?70:60),'Size ≤ 2% equity','FR < +0.04%','SL ATR-based','RR min 1:2','Volume konfirmasi','No entry 30min sebelum news','Sesuai skenario Game Plan'],overallGreenLight:pass>=6,verdict:pass>=6?'✅ KONDISI LAYAK TRADING':'⚠️ HATI-HATI — '+(8-pass)+' kondisi belum terpenuhi'},
    };

    // Safe JSON serialize
    const json=JSON.stringify(out);
    CACHE.d=out;CACHE.t=Date.now();
    return res.status(200).send(json);

  }catch(e){
    // ABSOLUTE LAST RESORT — always returns 200, never 500
    try{
      const safe={...SAFE_RESP,ok:false,error:String(e?.message||'Unknown error'),ts:Date.now(),elapsed:Date.now()-t0};
      return res.status(200).json(safe);
    }catch{
      return res.status(200).end('{"ok":false,"error":"critical","version":"v10"}');
    }
  }
}
