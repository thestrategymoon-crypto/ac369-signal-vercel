// api/morning-brief.js — v10 FINAL · CLEAN REBUILD
// GUARANTEED: Never returns HTTP 500. Under 8 seconds.
// ═══════════════════════════════════════════════════════════

// ── UTILITIES ────────────────────────────────────────────
const N=(v,d=0)=>{try{const n=+v;return isNaN(n)||!isFinite(n)?d:n}catch{return d}};
const A=(v)=>{try{return Array.isArray(v)?v:[]}catch{return[]}};
const cl=(v,a,b)=>{try{return Math.max(a,Math.min(b,N(v)))}catch{return a}};
const STAB=new Set(['USDT','USDC','BUSD','DAI','TUSD','FDUSD','USDE','FRAX','GUSD','USDP','CELO']);
const BAD=['UP','DOWN','BULL','BEAR','3L','3S','2L','2S','5L','5S'];
const SECS={Bitcoin:['BTC'],Ethereum:['ETH'],L1:['SOL','ADA','AVAX','TON','NEAR','SUI','APT','SEI','INJ'],L2:['ARB','OP','MATIC','STRK','IMX','MANTA','BLAST','SCROLL','BASE'],DeFi:['UNI','AAVE','CRV','MKR','SNX','COMP','BAL','SUSHI','PENDLE','GMX','DYDX','JUP','RAY','ORCA'],Payments:['XRP','LTC','BCH','DASH','ZEC','XLM','XMR','TRX'],Gaming:['AXS','SAND','MANA','GALA','ILV','YGG','BEAM','MAGIC','IMX'],AIDePin:['RENDER','FET','TAO','WLD','IO','ARKM','VIRTUAL','OLAS','GRASS','NMR','OCEAN','CTXC'],Infrastructure:['LINK','DOT','ATOM','AR','FIL','GRT','API3','BAND','TRB'],Meme:['DOGE','SHIB','PEPE','WIF','BONK','FLOKI','BOME'],Trending:[]};
const getSec=s=>{try{for(const[n,v]of Object.entries(SECS))if(v.includes(s))return n}catch{}return'Trending'};

// ── RSI ───────────────────────────────────────────────────
const r14=a=>{try{if(!a||a.length<16)return null;let g=0,l=0;for(let i=1;i<=14;i++){const d=a[a.length-i]-a[a.length-i-1];d>0?g+=d:l-=d}const ag=g/14,al=l/14;return al===0?100:+(100-100/(1+ag/al)).toFixed(2)}catch{return null}};
const em=(a,p)=>{try{if(!a||a.length<2)return N(a?.[a.length-1]);const k=2/(p+1);return a.reduce((prev,v,i)=>i===0?v:prev*(1-k)+v*k)}catch{return 0}};
const mc14=a=>{try{if(!a||a.length<36)return null;const k12=2/13,k26=2/27,k9=2/10;let e12=a[0],e26=a[0];for(const v of a){e12=e12*(1-k12)+v*k12;e26=e26*(1-k26)+v*k26}const ml=e12-e26,sig=ml*k9;return{bull:ml>sig&&ml>0,xUp:ml>sig&&ml<0,xDown:ml<sig&&ml>0,val:+ml.toFixed(4)}}catch{return null}};

// ── SAFE FALLBACK ─────────────────────────────────────────
const SAFE_RESP={ok:false,version:'v10',ts:0,elapsed:0,dataQuality:{coins:0,realRSI:0,bybitCoins:0,mexcCoins:0,btcLS:false,btcRsi:false,src:'error'},fg:50,fgLabel:'Neutral',marketCharacter:{type:'⚖️ TRANSITIONAL',color:'amber',desc:'Data tidak tersedia',stats:{oversold:0,overbought:0,bullish:0,bearish:0,coiling:0},strategy:'Cautious',risk:'REDUCED',positionSize:'Minimal (25%)',marketPct:'50% bullish'},btcSnapshot:{price:0,ch24:0,rsi:null,fg:50,fgLabel:'Neutral'},convergence:{leaders:[],longSetups:[],shortSetups:[],flySetups:[],accumSetups:[],summary:'—',eliteCount:0,primeCount:0,validCount:0,shortCount:0},gamePlan:{btcLevels:{},scenarios:{bull:{condition:'—',action:'—',setups:[]},sideways:{condition:'—',action:'—',setups:[]},bear:{condition:'—',action:'—',setups:[]}},spotAccum:[],avoidList:[]},sectorFlow:{sectors:[],sectorData:{}},tradingSchedule:{wibHour:0,dayName:'—',sessions:[],currentSession:'—',position:'—',nextPrime:null},checklist:{checks:[],pass:0,total:8,overallGreenLight:false,verdict:'—'},whaleFingerprint:[],squeezeRadar:[],stealthVolume:[],hiddenGems:[],momentumShift:[],dailyOpportunityScore:{score:50,label:'⚖️ NORMAL',action:'—'},todaysBestTrade:null,marketRegime:{regime:'⚖️ NORMAL',regimeColor:'gray',regimeDesc:'—',sizingGuidance:'—'},retailTrapList:[],retailSqueezeList:[]};

const CACHE={d:null,t:0};

export default async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Cache-Control','no-store');
  const t0=Date.now();

  // Cache 90 seconds
  if(CACHE.d&&(t0-CACHE.t)<90000)return res.status(200).json(CACHE.d);

  try{
    // ── FETCH ALL IN PARALLEL ──────────────────────────────
    const get=(url,ms)=>fetch(url,{signal:AbortSignal.timeout?AbortSignal.timeout(ms):undefined}).then(r=>r.json()).catch(()=>null);
    const [R0,R1,R2,R3,R4,R5,R6,R7,R8,R9,R10,R11,R12]=await Promise.allSettled([
      get('https://api.bybit.com/v5/market/tickers?category=linear',2500),    // R0: Bybit all
      get('https://api.mexc.com/api/v3/ticker/24hr',2000),                    // R1: MEXC all
      get('https://api.mexc.com/api/v3/klines?symbol=BTCUSDT&interval=4h&limit=52',2500),  // R2: BTC 4H
      get('https://api.mexc.com/api/v3/klines?symbol=ETHUSDT&interval=4h&limit=52',2500),  // R3: ETH 4H
      get('https://api.mexc.com/api/v3/klines?symbol=SOLUSDT&interval=4h&limit=52',2500),  // R4: SOL 4H
      get('https://api.bybit.com/v5/market/account-ratio?category=linear&symbol=BTCUSDT&period=1h&limit=1',2000), // R5: L/S
      get('https://alternative.me/crypto/fear-and-greed-index/?format=json&limit=1',2000),  // R6: F&G
      get('https://api.mexc.com/api/v3/klines?symbol=BNBUSDT&interval=4h&limit=52',2200),  // R7: BNB 4H
      get('https://api.mexc.com/api/v3/klines?symbol=XRPUSDT&interval=4h&limit=52',2200),  // R8: XRP 4H
      get('https://api.mexc.com/api/v3/klines?symbol=LINKUSDT&interval=4h&limit=52',2200), // R9: LINK 4H
      get('https://api.mexc.com/api/v3/klines?symbol=AVAXUSDT&interval=4h&limit=52',2200), // R10: AVAX 4H
      get('https://api.mexc.com/api/v3/klines?symbol=DOTUSDT&interval=4h&limit=52',2200),  // R11: DOT 4H
      get('https://api.mexc.com/api/v3/klines?symbol=ADAUSDT&interval=4h&limit=52',2200),  // R12: ADA 4H
    ]);

    // ── BUILD COIN MAP ─────────────────────────────────────
    const cm={};// price map from Bybit
    try{for(const t of A(R0.value?.result?.list)){try{
      const s=String(t?.symbol||'').replace(/USDT|PERP/g,'');
      if(!s||s.length>12||STAB.has(s)||BAD.some(x=>s.endsWith(x)))continue;
      const p=N(t.lastPrice);if(p<=0||p>1e10)continue;
      const prev=N(t.prevPrice24h||p),c24=prev>0?+((p-prev)/prev*100).toFixed(2):N(t.price24hPcnt)*100;
      const h=N(t.highPrice24h||p*1.02),l=N(t.lowPrice24h||p*0.98),pip=h>l?cl((p-l)/(h-l)*100,0,100):50;
      const bid1=N(t.bid1Size),ask1=N(t.ask1Size);
      const bidAsk=bid1+ask1>0?+(bid1/(bid1+ask1)*100).toFixed(1):50;
      const fr=N(t.fundingRate);
      const baBias=bidAsk-50;const frBias=fr*100*160;
      const rLR=Math.max(28,Math.min(72,+(50+baBias*0.4+frBias*0.6).toFixed(1)));
      cm[s]={p,fr,oi:N(t.openInterestValue),c24,v:N(t.turnover24h),h,l,pip,
             fp:+(fr*100).toFixed(4),bidAsk,rLR,src:'by'};
    }catch{}}}catch{}

    // Add MEXC lowcaps
    try{for(const t of A(R1.value)){try{
      const s=String(t?.symbol||'').replace(/USDT/g,'');
      if(!s||s.length>12||STAB.has(s)||BAD.some(x=>s.endsWith(x)))continue;
      const p=N(t.lastPrice);if(p<=0||p>1e10||cm[s])continue;
      const c24=N(t.priceChangePercent),vol=N(t.quoteVolume);
      cm[s]={p,fr:0,oi:0,c24:+c24.toFixed(2),v:vol,h:N(t.highPrice),l:N(t.lowPrice),
             pip:50,fp:0,bidAsk:50,rLR:50,src:'mx'};
    }catch{}}}catch{}

    // ── REAL RSI FROM KLINES ───────────────────────────────
    const km={};let realRSI=0;
    for(const[sym,kR]of[['BTC',R2],['ETH',R3],['SOL',R4],['BNB',R7],['XRP',R8],['LINK',R9],['AVAX',R10],['DOT',R11],['ADA',R12]]){
      try{
        const raw=Array.isArray(kR.value)?A(kR.value):A(kR.value?.result?.list).reverse();
        if(raw.length<16)continue;
        const K=raw.map(d=>({o:N(d[1]),h:N(d[2]),l:N(d[3]),c:N(d[4]),v:N(d[5])}));
        const cls=K.map(x=>x.c).filter(v=>v>0);
        const rsi=r14(cls);if(!rsi)continue;
        const lp=cls[cls.length-1];
        const e9=em(cls.slice(-9),9),e200=em(cls,200);
        const atr=K.slice(-14).reduce((s,k)=>s+Math.max(k.h-k.l,Math.abs(k.h-cls[cls.indexOf(k.c)-1]||0),Math.abs(k.l-cls[cls.indexOf(k.c)-1]||0)),0)/14;
        const a20=cls.slice(-20).reduce((s,v)=>s+v,0)/20;
        const r5=cls.slice(-5).reduce((a,b)=>a+b,0)/5;
        const vBull=K.slice(-14).filter(k=>k.c>k.o).reduce((s,k)=>s+k.v,0);
        const vBear=K.slice(-14).filter(k=>k.c<=k.o).reduce((s,k)=>s+k.v,0);
        const macd=mc14(cls);
        // RSI slope
        const rsiPrev=r14(cls.slice(0,-1));
        const rsiSlope=rsi&&rsiPrev?(rsi-rsiPrev>1?'↑↑':rsi-rsiPrev>0.2?'↑':rsiPrev-rsi>1?'↓↓':rsiPrev-rsi>0.2?'↓':'→'):'→';
        // Volume trend
        const rv=K.slice(-4).map(k=>k.v);
        const volTrend=rv.length>=3?(rv[3]>rv[2]*1.15?'↑ naik':rv[3]<rv[2]*0.85?'↓ turun':'→ stabil'):'→';
        // Divergence
        let divergence=null,divStrength=0;
        try{
          const p4=cls[cls.length-5]||lp,p8=cls[cls.length-9]||lp;
          const r4=r14(cls.slice(0,-4)),r8=r14(cls.slice(0,-8));
          if(lp<p4&&p4<p8&&rsi>r4&&r4>r8){divergence='🟢 BULLISH DIVERGENCE';divStrength=Math.round((rsi-r4)*2+5);}
          else if(lp>p4&&p4>p8&&rsi<r4&&r4<r8){divergence='🔴 BEARISH DIVERGENCE';divStrength=Math.round((r4-rsi)*2+5);}
        }catch{}
        km[sym]={rsi:+rsi.toFixed(2),rsiSlope,macd,e9,e200,atr:+atr.toFixed(8),price:lp,
                 aboveE200:lp>e200,isCoiling:a20>0&&r5<a20*0.65,vB:vBull>vBear*1.2,
                 volTrend,divergence,divStrength,src:'mx'};
        realRSI++;
      }catch{}
    }

    // ── BTC KEY DATA ───────────────────────────────────────
    const btcK=km.BTC||null;
    const btcBy=cm.BTC||{};
    const btcP=N(btcK?.price||btcBy?.p||0);
    const btcC=N(btcBy?.c24||0);
    const btcATR=btcK?.atr&&btcP>0?+(btcK.atr/btcP*100).toFixed(3):0;

    // F&G
    let fg=50,fgLabel='Neutral';
    try{const fgD=R6.value?.data?.[0];if(fgD){fg=N(fgD.value);fgLabel=fgD.value_classification||'Neutral';}}catch{}

    // BTC L/S
    let btcLS=null,btcL=null,btcS=null;
    try{const row=A(R5.value?.result?.list)[0];if(row){btcL=+N(row.buyRatio*100).toFixed(2);btcS=+N(row.sellRatio*100).toFixed(2);btcLS=btcS>0?+(btcL/btcS).toFixed(2):null;}}catch{}

    // ── COIN SIGNAL ENGINE ─────────────────────────────────
    const coins=[];
    for(const[sym,by]of Object.entries(cm)){try{
      const p=by.p,c24=by.c24,vol=by.v,fp=by.fp;
      if(p<=0||!sym)continue;
      const sec=getSec(sym);
      const km2=km[sym]||null;
      // RSI: real from klines or estimated
      const rR=km2&&km2.rsi>0;
      const rsi=rR?km2.rsi:cl(50+(by.pip-50)*0.45+c24*2.2,5,95);
      const ap=km2?.atr&&km2.atr>0&&p>0?+(km2.atr/p*100).toFixed(2):0;
      const atr=km2?.atr||0;
      const ic=km2?.isCoiling||false;
      const vb=km2?.vB||false;
      const fr=by.fr||0;
      const rs=btcP>0?+(c24-btcC).toFixed(2):0;
      const pip=by.pip||50;
      const divergence=km2?.divergence||null;
      const divStrength=km2?.divStrength||0;
      const cv=Math.min(100,Math.round(
        (rsi<30?24:rsi<38?16:rsi<45?8:rsi<55?0:rsi<65?-4:-12)+
        (fp<-0.05?20:fp<-0.02?14:fp<-0.01?8:fp<0?4:fp>0.05?-16:fp>0.02?-8:fp>0.01?-4:0)+
        (ic?10:0)+(rs>5?8:rs>2?5:rs>0?2:rs>-2?0:rs>-5?-3:-8)+
        (vb?8:0)+60
      ));
      const lb=cv>=80?'🔥ELITE':cv>=70?'💎PRIME':cv>=60?'✅VALID':'🟡MOD';
      // Signal detection
      let sig='',sc='#4a5568',desc='',dir='WAIT',prob=50;
      if(rsi<22&&fp<-0.001&&c24<-3){sig='💎 CAPITULATION';sc='#00ffd0';desc='Extreme fear — bottom pattern';dir='LONG';prob=85;}
      else if(rsi<28&&fp<-0.0005&&ic){sig='🚀 ABOUT TO FLY';sc='#ffd700';desc='5 konfluens kuat — siap pump';dir='LONG';prob=87;}
      else if(rsi<30&&fp<-0.0002&&c24<0){sig='🔴 DEEP OVERSOLD';sc='#ff6b9d';desc='RSI ekstrem + shorts bayar';dir='LONG';prob=74;}
      else if(rsi<35&&fp<-0.0001){sig='🔄 OVERSOLD BOUNCE';sc='#00ffa3';desc='Oversold + FR negatif';dir='LONG';prob=76;}
      else if(by.oi>2e9&&fp<-0.0001&&Math.abs(c24)<1.5){sig='🐋 WHALE ACCUM';sc='#00d4ff';desc='OI besar+harga diam+FR neg';dir='LONG';prob=83;}
      else if(fp<-0.0002&&vol>2e6&&rsi>35&&rsi<55){sig='🤫 ACCUMULATION';sc='#a78bfa';desc='FR negatif+volume baik';dir='LONG';prob=80;}
      else if(ic&&ap>0&&ap<3){sig='⚡ COILING';sc='#fbbf24';desc='Volatilitas rendah pre-breakout';dir='LONG';prob=71;}
      else if(rs>4&&c24>btcC+2&&btcC<1){sig='🔮 DECOUPLING';sc='#c084fc';desc='Outperform BTC — narrative';dir='LONG';prob=78;}
      else if(rsi>58&&c24>1.5&&vb){sig='📈 BREAKOUT';sc='var(--g)';desc='Vol+momentum konfirmasi';dir='LONG';prob=79;}
      else if(rsi>52&&rs>3&&c24>2){sig='📈 MOMENTUM';sc='var(--g2)';desc='RS positif+momentum';dir='LONG';prob=70;}
      else if(rsi>72&&fp>0.002&&c24>5){sig='🪤 BULL TRAP';sc='#f87171';desc='Overbought+FR mahal';dir='SHORT';prob=65;}
      else if(rsi>68&&c24>3&&fp>0.001){sig='⚠️ DISTRIBUTION';sc='#fb923c';desc='SM mungkin jual ke retail';dir='SHORT';prob=67;}
      else if(rsi>65&&fp>0.0005){sig='🔴 SHORT ZONE';sc='#ef4444';desc='Overbought+FR tinggi';dir='SHORT';prob=75;}
      else if(rsi>=42&&rsi<=62&&c24>0.5){sig='↗️ MILD BULL';sc='#6ee7b7';desc='Mild bullish';dir='LONG';prob=65;}
      // SL/TP
      let sl=0,tp1=0,tp2=0,slP=2.5,tp1P=4.0,tp2P=7.0;
      try{if(ap>0){slP=+(ap*1.5).toFixed(2);tp1P=+(ap*2.0).toFixed(2);tp2P=+(ap*3.5).toFixed(2);}
        sl=dir==='LONG'?+(p*(1-slP/100)).toFixed(p>1?4:8):+(p*(1+slP/100)).toFixed(p>1?4:8);
        tp1=dir==='LONG'?+(p*(1+tp1P/100)).toFixed(p>1?4:8):+(p*(1-tp1P/100)).toFixed(p>1?4:8);
        tp2=dir==='LONG'?+(p*(1+tp2P/100)).toFixed(p>1?4:8):+(p*(1-tp2P/100)).toFixed(p>1?4:8);
      }catch{}
      const rr=+(tp2P/slP).toFixed(1);
      // Retail position
      const rLong=by.rLR||Math.max(28,Math.min(72,+(50+fp*160).toFixed(1)));
      const rShort=+(100-rLong).toFixed(1);
      const rBias=rLong>=65?'🚨 RETAIL TRAP':rLong>=58?'⚠️ Long Heavy':rLong<=35?'🚀 SQUEEZE':rLong<=42?'💎 Short Dom':'⚖️ OK';
      // Conviction stars
      const cStars=Math.min(5,+(
        (rsi<30?1:rsi<38?0.5:0)+(fp<-0.02?1:fp<-0.01?0.5:0)+
        (ic?0.5:0)+(rs>3?0.5:rs>0?0.25:0)+(vb&&c24>0?0.5:0)+(rR?0.5:0)
      ).toFixed(1));
      coins.push({sym,sector:sec,price:p,c24,vol,rsi:+rsi.toFixed(1),rsiReal:rR,
        fr:fp||null,isCoiling:ic,rs,atr:atr>0?+atr.toFixed(p>1?4:8):null,atrPct:ap,
        pip,signal:sig||null,signalColor:sc,signalDesc:desc,direction:dir,probability:prob,
        conv:{score:cv,label:lb},convStars:cStars,
        divergence,divStrength,
        retailLong:rLong,retailShort:rShort,retailBias:rBias,
        bidAskRatio:by.bidAsk||null,rr,
        levels:{sl,tp1,tp2,slPct:slP,tp1Pct:tp1P,tp2Pct:tp2P},src:by.src||'by'});
    }catch{}}

    coins.sort((a,b)=>(b.conv?.score||0)-(a.conv?.score||0));
    const longs=coins.filter(x=>x.direction==='LONG'&&(x.conv?.score||0)>=60).slice(0,25);
    const shorts=coins.filter(x=>x.direction==='SHORT'&&(x.conv?.score||0)>=55).slice(0,10);
    const flys=coins.filter(x=>x.signal&&x.signal.includes('ABOUT TO FLY')||x.signal&&x.signal.includes('CAPITULATION')).slice(0,8);
    const accums=coins.filter(x=>x.signal&&(x.signal.includes('ACCUMULATION')||x.signal.includes('COILING')||x.signal.includes('DECOUPLING'))).slice(0,8);
    const top25=longs.slice(0,25);
    const ec=top25.filter(x=>(x.conv?.score||0)>=80).length;
    const pc=top25.filter(x=>(x.conv?.score||0)>=70&&(x.conv?.score||0)<80).length;
    const vc=top25.filter(x=>(x.conv?.score||0)>=60&&(x.conv?.score||0)<70).length;

    // ── MARKET CHARACTER ───────────────────────────────────
    const osCount=coins.filter(x=>x.rsi<30).length;
    const obCount=coins.filter(x=>x.rsi>70).length;
    const bullPct=coins.filter(x=>x.direction==='LONG').length;
    const totC=coins.length||1;
    let mcType='⚖️ TRANSITIONAL',mcColor='amber',mcDesc='Mixed signals. Sizing kecil.',mcStrat='Cautious',mcRisk='REDUCED',mcPos='Full (100%)',mcMkt='64% bullish';
    if(osCount>totC*0.15){mcType='💎 MASS OVERSOLD';mcColor='cyan';mcDesc=osCount+' koin RSI<30 dari '+totC+'. DCA zone terbaik.';mcStrat='Counter-trend DCA';mcRisk='MODERATE-HIGH';mcPos='Minimal (25%)';}
    else if(obCount>totC*0.2){mcType='🚨 MASS OVERBOUGHT';mcColor='red';mcDesc=obCount+' koin RSI>70. Distribusi zona.';mcStrat='Cautious SHORT';mcRisk='HIGH';mcPos='Minimal (25%)';}
    else if(bullPct/totC>0.65){mcType='📈 BULLISH';mcColor='green';mcDesc='Majority koin mengarah naik.';mcStrat='Aggressive Long';mcRisk='STANDARD';mcPos='Full (100%)';}
    else if(bullPct/totC<0.35){mcType='📉 BEARISH';mcColor='red';mcDesc='Majority koin mengarah turun.';mcStrat='Cash or Short';mcRisk='HIGH';mcPos='Minimal (25%)';}

    // ── TRADING SESSIONS ──────────────────────────────────
    const now=new Date();const wibH=(now.getUTCHours()+7)%24;
    const days=['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];
    const sess=[
      {id:'dead',name:'🌙 Dead Zone',time:'02:00-06:00',start:2,end:6,q:'POOR',activity:'Volume sangat sepi. Jangan trading.'},
      {id:'asia_open',name:'🌏 Asia Open',time:'06:00-09:00',start:6,end:9,q:'MODERATE',activity:'Volume mulai masuk. Watchlist saja.'},
      {id:'asia_peak',name:'🔥 Asia Peak',time:'09:00-12:00',start:9,end:12,q:'GOOD',activity:'Volume Asia bagus. Bisa entry selektif.'},
      {id:'lunch',name:'⚠️ Lunch',time:'12:00-15:00',start:12,end:15,q:'CAUTION',activity:'Volume turun. Hindari entry baru.'},
      {id:'london',name:'🌍 London',time:'15:00-18:00',start:15,end:18,q:'PRIME',activity:'PRIME: Volume institusional tertinggi!'},
      {id:'ny_pre',name:'🏗️ NY Pre',time:'18:00-21:00',start:18,end:21,q:'BUILDING',activity:'Pre-market AS. Bangun posisi.'},
      {id:'ny_open',name:'🚀 NY Open',time:'21:00-23:00',start:21,end:23,q:'PRIME',activity:'PRIME: Volume tertinggi hari ini!'},
      {id:'ny_late',name:'🌙 NY Late',time:'23:00-02:00',start:23,end:2,q:'GOOD',activity:'Volume masih bagus. Swing entry ok.'},
    ];
    const cs=wibH>=2&&wibH<6?'dead':wibH>=6&&wibH<9?'asia_open':wibH>=9&&wibH<12?'asia_peak':wibH>=12&&wibH<15?'lunch':wibH>=15&&wibH<18?'london':wibH>=18&&wibH<21?'ny_pre':wibH>=21&&wibH<23?'ny_open':'ny_late';
    const cso=sess.find(s=>s.id===cs)||sess[0];
    const np=sess.filter(s=>s.q==='PRIME'&&s.id!==cs);
    let nxt=null;if(np.length>0){const ns=np[0];const diff=ns.start>wibH?ns.start-wibH:24-wibH+ns.start;nxt={name:ns.name,inHours:diff};}

    // ── GAME PLAN ─────────────────────────────────────────
    const res2=btcP>0?+(btcP*1.02).toFixed(0):null;
    const sup2=btcP>0?+(btcP*0.98).toFixed(0):null;
    const top3=longs.slice(0,3).map(x=>x.sym);
    const bearTgt=btcK?.e200?+(btcK.e200*0.98).toFixed(0):sup2;

    // ── BTC SNAPSHOT ─────────────────────────────────────
    const btcATRval=btcK?.atr&&btcP>0?+(btcK.atr/btcP*100).toFixed(2):1.0;
    const btcATRusd=btcK?.atr?+(btcK.atr).toFixed(2):btcP*0.01;
    const btcRes=btcK?.e9&&btcP>0?+(btcK.e9*1.005).toFixed(0):res2;
    const btcSup=btcK?.e200&&btcP>0?+(btcK.e200*0.995).toFixed(0):sup2;

    // ── SECTOR FLOW ───────────────────────────────────────
    const secMap={};
    for(const c of coins){
      const s=c.sector||'Other';
      if(!secMap[s])secMap[s]={coins:[],ch24Sum:0,frSum:0,rsSum:0,osCount:0,sigQ:0};
      secMap[s].coins.push(c);
      secMap[s].ch24Sum+=c.c24;
      secMap[s].frSum+=c.fr||0;
      secMap[s].rsSum+=c.rs||0;
      if(c.rsi<30)secMap[s].osCount++;
      if(c.signal&&(c.conv?.score||0)>=70)secMap[s].sigQ++;
    }
    const sectorData={};
    const sectors=Object.entries(secMap).map(([name,d])=>{
      const n=d.coins.length||1;
      const avgCh24=+(d.ch24Sum/n).toFixed(3);
      const frAvg=+(d.frSum/n).toFixed(6);
      const rsAvg=+(d.rsSum/n).toFixed(2);
      const smScore=Math.round(50+avgCh24*5+frAvg*(-2000)+rsAvg*3+Math.min(20,d.osCount*3)+Math.min(10,d.sigQ*3));
      const dir=avgCh24>=0.05?'↑IN':avgCh24<=-0.05?'↓OUT':'→';
      const best=d.coins.filter(x=>x.signal&&x.direction==='LONG').sort((a,b)=>(b.conv?.score||0)-(a.conv?.score||0))[0]||null;
      const sd={name,coins:d.coins,avgCh24,frAvg,rsAvg,osCount:d.osCount,smScore:Math.max(0,Math.min(100,smScore)),sigQ:d.sigQ,dir,best};
      sectorData[name]=sd;
      return sd;
    }).sort((a,b)=>b.smScore-a.smScore);

    // ── CHECKLIST ─────────────────────────────────────────
    const liqCoins=coins.filter(x=>(x.vol||0)>5e6).length;
    const frHot=coins.filter(x=>(x.fr||0)>0.0005).length;
    const pass_vol=cso.q==='PRIME'?liqCoins>=15:liqCoins>=8;
    const checks=[
      {label:'Market character layak trading',pass:!mcType.includes('OVERBOUGHT'),detail:'Character: '+mcType,fix:'Hindari masa distribusi massal'},
      {label:'Trading session berkualitas',pass:cso.q==='PRIME'||cso.q==='GOOD'||cso.q==='BUILDING',detail:cso.name+' ('+cso.q+')',fix:'Tunggu PRIME/GOOD session'},
      {label:'BTC tidak di resistance',pass:btcK?.rsi?btcK.rsi<72:true,detail:btcK?.rsi?'BTC RSI '+btcK.rsi.toFixed(0):'BTC aman',fix:'Tunggu BTC RSI <65'},
      {label:'FR market tidak overheated',pass:frHot===0,detail:frHot+' koin FR>0.05%',fix:'Hindari entry saat FR mahal massal'},
      {label:'Market tidak overbought massal',pass:obCount<totC*0.15,detail:obCount+'/'+totC+' koin RSI>70'+(obCount>=totC*0.15?' → Tunggu koreksi':''),fix:'Tunggu RSI turun'},
      {label:'BTC L/S ratio aman',pass:btcLS===null||btcLS>=0.8,detail:btcLS?'L/S: '+btcL+'%/'+btcS+'%':'Data tidak tersedia',fix:'Hindari saat retail terlalu long'},
      {label:'Cukup koin aktif & liquid',pass:pass_vol,detail:liqCoins+' koin aktif (vol>$5M)'+(pass_vol?'':' → Market sepi — tunggu London 15:00 WIB atau NY 21:00 WIB'),fix:'Tunggu London atau NY Open'},
      {label:'BTC mendukung altcoin',pass:btcC>-2,detail:'BTC '+btcC.toFixed(2)+'%',fix:'Hindari altcoin saat BTC dump >2%'},
    ];
    const pass=checks.filter(x=>x.pass).length;

    // ── DAILY OPPORTUNITY SCORE ───────────────────────────
    const dailyOpportunityScore=(()=>{try{
      let score=50;
      if(fg<20)score+=20;else if(fg<35)score+=12;else if(fg>75)score-=15;
      if(osCount>15)score+=15;else if(osCount>8)score+=10;else if(osCount>4)score+=5;
      if(cso.q==='PRIME')score+=10;else if(cso.q==='GOOD')score+=5;
      const sqC=coins.filter(x=>(x.fr||0)<-0.0005).length;
      score+=Math.min(8,sqC*2);
      score=Math.max(5,Math.min(98,Math.round(score)));
      const label=score>=80?'🔥 EXTREME':score>=65?'💎 HIGH':score>=50?'✅ NORMAL':score>=35?'⚠️ LOW':'❌ POOR';
      const action=score>=80?'Setup langka. Full sizing.':score>=65?'Setup bagus. Sizing normal.':score>=50?'Selektif. Hanya top setup.':'Tunggu kondisi lebih baik.';
      return{score,label,action,fg,session:cso.q,osCoins:osCount};
    }catch{return{score:50,label:'⚖️ NORMAL',action:'—'}}})();

    // ── MARKET REGIME ─────────────────────────────────────
    const marketRegime=(()=>{try{
      const btcE2=btcK?.e200||0,mvrvR=btcK?.price&&btcE2>0?+(btcK.price/btcE2).toFixed(2):1.3;
      let regime,regimeColor,regimeDesc,sizingGuidance;
      if(fg<30&&mvrvR<1.1&&osCount/totC>0.05){regime='💎 ACCUMULATE';regimeColor='cyan';regimeDesc='Fear + MVRV rendah = zona akumulasi.';sizingGuidance='DCA bertahap 25-50%.';}
      else if(fg>=30&&fg<=65&&obCount/totC<0.15){regime='✅ TRADE';regimeColor='green';regimeDesc='Market seimbang. Kondisi trading aktif.';sizingGuidance='Full sizing. Patuhi SL.';}
      else if(fg>65||mvrvR>1.8){regime='⚠️ CAUTION';regimeColor='amber';regimeDesc='Greedy atau MVRV tinggi.';sizingGuidance='Max 1% risk/trade.';}
      else{regime='🚫 AVOID';regimeColor='red';regimeDesc='Kondisi tidak ideal.';sizingGuidance='Jangan entry baru.';}
      return{regime,regimeColor,regimeDesc,sizingGuidance,fg,mvrv:mvrvR};
    }catch{return{regime:'⚖️ NORMAL',regimeColor:'gray',regimeDesc:'—',sizingGuidance:'Sizing normal.'}}})();

    // ── TODAY'S BEST TRADE ────────────────────────────────
    const todaysBestTrade=(()=>{try{
      const top=coins.filter(x=>x.direction==='LONG'&&(x.conv?.score||0)>=60)
        .sort((a,b)=>((b.conv?.score||0)+((b.rsi||50)<30?15:0)+((b.fr||0)<-0.0003?8:0))
                    -((a.conv?.score||0)+((a.rsi||50)<30?15:0)+((a.fr||0)<-0.0003?8:0)))[0]||null;
      if(!top)return null;
      return{sym:top.sym,price:top.price,signal:top.signal||'—',rsi:top.rsi,fr:top.fr,
        conv:top.conv?.score||0,convLabel:top.conv?.label||'',convStars:top.convStars||0,
        divergence:top.divergence||null,retailLong:top.retailLong,retailShort:top.retailShort,
        entry:top.price,sl:top.levels?.sl||0,tp1:top.levels?.tp1||0,tp2:top.levels?.tp2||0,
        slPct:top.levels?.slPct||0,tp1Pct:top.levels?.tp1Pct||0,tp2Pct:top.levels?.tp2Pct||0,
        rr:top.rr||2.3,probability:top.probability||70};
    }catch{return null}})();

    // ── RETAIL LISTS ──────────────────────────────────────
    const retailTrapList=(()=>{try{return coins.filter(c=>c.retailLong>=63&&(c.rsi||50)>55&&(c.vol||0)>2e6).sort((a,b)=>b.retailLong-a.retailLong).slice(0,6).map(c=>({sym:c.sym,price:c.price,c24:c.c24,retailLong:c.retailLong,rsi:c.rsi}));}catch{return[]}})();
    const retailSqueezeList=(()=>{try{return coins.filter(c=>c.retailLong<=40&&(c.rsi||50)<45&&(c.vol||0)>1e6).sort((a,b)=>a.retailLong-b.retailLong).slice(0,6).map(c=>({sym:c.sym,price:c.price,c24:c.c24,retailLong:c.retailLong,retailShort:c.retailShort,rsi:c.rsi}));}catch{return[]}})();

    // ── GOLDEN OPPORTUNITIES ─────────────────────────────
    const whaleFingerprint=(()=>{try{return coins.filter(c=>(c.oi||0)>2e9&&(c.fr||0)<-0.0001&&Math.abs(c.c24)<1.5&&(c.rsi||50)>=35&&(c.rsi||50)<=58&&(c.vol||0)>1e6).sort((a,b)=>(a.fr||0)-(b.fr||0)).slice(0,8).map(c=>({sym:c.sym,price:c.price,c24:c.c24,rsi:c.rsi,fr:+(c.fr*100).toFixed(4),oi:+((c.oi||0)/1e9).toFixed(2),vol:c.vol,rating:Math.abs(c.fr||0)>0.0005?'🔥STRONG':'💎GOOD'}));}catch{return[]}})();
    const squeezeRadar=(()=>{try{return coins.filter(c=>(c.fr||0)<-0.0003&&(c.vol||0)>500000&&(c.rsi||50)<55).sort((a,b)=>(a.fr||0)-(b.fr||0)).slice(0,10).map(c=>({sym:c.sym,price:c.price,c24:c.c24,rsi:c.rsi,fr:+(c.fr*100).toFixed(4),retailLong:c.retailLong,retailShort:c.retailShort,strength:(c.fr||0)<-0.001?'🚨EXTREME':(c.fr||0)<-0.0005?'🔥STRONG':'💎HIGH'}));}catch{return[]}})();
    const stealthVolume=(()=>{try{return coins.filter(c=>(c.vol||0)>10e6&&Math.abs(c.c24)<0.8&&(c.rsi||50)<65&&(c.oi||0)>500e6).sort((a,b)=>(b.vol||0)-(a.vol||0)).slice(0,8).map(c=>({sym:c.sym,price:c.price,c24:c.c24,vol:c.vol,rsi:c.rsi,oi:+((c.oi||0)/1e9).toFixed(2),urgency:(c.vol||0)>50e6?'🔥HIGH':'💎MOD'}));}catch{return[]}})();
    const hiddenGems=(()=>{try{return coins.filter(c=>(c.rsi||50)<32&&(c.fr||0)<=-0.0001&&(c.vol||0)>300000&&(c.vol||0)<50e6&&!['BTC','ETH','BNB','SOL','XRP','ADA','DOGE'].includes(c.sym)&&(c.conv?.score||0)>=60).sort((a,b)=>(a.rsi||50)-(b.rsi||50)).slice(0,12).map(c=>({sym:c.sym,price:c.price,c24:c.c24,rsi:c.rsi,fr:+(c.fr*100).toFixed(4),vol:c.vol,conv:c.conv?.score||0}));}catch{return[]}})();
    const momentumShift=(()=>{try{return coins.filter(c=>c.c24>2&&(c.c24-btcC)>3&&c.sym!=='BTC'&&(c.vol||0)>1e6&&(c.rsi||50)<75).sort((a,b)=>(b.c24-btcC)-(a.c24-btcC)).slice(0,8).map(c=>({sym:c.sym,price:c.price,c24:c.c24,rsi:c.rsi,vol:c.vol,outperformBTC:+(c.c24-btcC).toFixed(2)}));}catch{return[]}})();

    // ── BUILD RESPONSE ────────────────────────────────────
    const out={
      ok:true,version:'v10',ts:Date.now(),elapsed:Date.now()-t0,
      dataQuality:{coins:coins.length,realRSI,bybitCoins:Object.values(cm).filter(x=>x.src==='by').length,mexcCoins:Object.values(cm).filter(x=>x.src==='mx').length,btcLS:!!btcLS,btcRsi:!!btcK?.rsi,src:'bybit+mexc'},
      fg,fgLabel,
      marketCharacter:{type:mcType,color:mcColor,
        description:mcDesc,tradeStyle:mcStrat,riskLevel:mcRisk,positionSize:mcPos,
        marketPct:Math.round(bullPct/totC*100)+'% bullish',
        stats:{oversold:osCount,overbought:obCount,bullish:Math.round(bullPct/totC*100),bearish:Math.round((totC-bullPct)/totC*100),coiling:coins.filter(x=>x.isCoiling).length}},
      btcSnapshot:{price:btcP,ch24:btcC,rsi:btcK?.rsi||null,rsiSlope:btcK?.rsiSlope||'—',
        rsiDir:btcK?.rsiSlope?.includes('↑')?'up':btcK?.rsiSlope?.includes('↓')?'down':'flat',
        volTrend:btcK?.volTrend||'—',fg,fgLabel,macd:btcK?.macd||null,
        atrPct:btcATRval,atr:btcATRusd,
        d1rsi:null,d1trend:'—',
        resistance:btcRes,support:btcSup,current:btcP,aboveEma200:btcK?.aboveE200||false,btcLS:!!btcLS,btcLongPct:btcL,btcShortPct:btcS},
      convergence:{leaders:longs.slice(0,12),longSetups:longs,shortSetups:shorts,flySetups:flys,accumSetups:accums,summary:longs.length+' LONG · '+shorts.length+' SHORT',eliteCount:ec,primeCount:pc,validCount:vc,shortCount:shorts.length},
      gamePlan:{btcLevels:{resistance:btcRes,support:btcSup,current:btcP},
        scenarios:{bull:{condition:'BTC tembus $'+btcRes+' close di atas',action:'Long conv≥65 RR1:3 RS+FR filter',setups:top3},sideways:{condition:'BTC konsolidasi ±1.5%',action:'Scalp COILING+ACCUM saja.'},bear:{condition:'BTC breakdown ke $'+bearTgt,action:'Cash 80%. SHORT RSI>72.'}},
        scalpSetups:flys.slice(0,5).map(x=>({sym:x.sym,price:x.price,signal:x.signal,rsi:x.rsi,sl:x.levels?.sl,tp1:x.levels?.tp1,rr:x.rr})),
        swingSetups:longs.filter(x=>(x.conv?.score||0)>=70).slice(0,5).map(x=>({sym:x.sym,price:x.price,signal:x.signal,rsi:x.rsi,sl:x.levels?.sl,tp2:x.levels?.tp2,rr:x.rr})),
        activeShorts:shorts.slice(0,5).map(x=>({sym:x.sym,price:x.price,signal:x.signal,rsi:x.rsi})),
        spotAccum:longs.filter(x=>x.rsi<35).slice(0,8).map(x=>({sym:x.sym,price:x.price,rsi:x.rsi,signal:x.signal||'SIDEWAYS',dcaPrice:+(x.price*0.975).toFixed(x.price>1?4:8),atr:x.atrPct})),
        avoidList:coins.filter(x=>x.rsi>80).slice(0,5).map(x=>({sym:x.sym,rsi:x.rsi,pct:x.c24}))},
      sectorFlow:{sectors,sectorData},
      checklist:{marketChecks:checks,coinChecks:[
        {label:'RSI koin < 72'},{label:'Conv Score ≥ 60'},{label:'FR < +0.04%'},{label:'RR min 1:2'},
        {label:'No entry 30min sebelum news'},{label:'Vol ≥ $5M'},{label:'Size ≤ 2% equity'},
        {label:'SL ATR-based'},{label:'Volume konfirmasi'},{label:'Sesuai skenario Game Plan'}
      ],marketPassCount:pass,marketTotal:8,overallGreenLight:pass>=6,
        verdict:pass>=6?'✅ KONDISI LAYAK TRADING':'⚠️ HATI-HATI — '+(8-pass)+' kondisi belum terpenuhi'},
      tradingSchedule:{wibHour:wibH,dayName:days[now.getUTCDay()],sessions:sess,
        currentSession:cs,position:cso.q,currentSessionObj:cso,
        focusToday:cso.q==='PRIME'?'🔥 '+cso.name+' PRIME — aktif!':cso.q==='GOOD'?'✅ '+cso.name+' — kondisi bagus':cso.q==='BUILDING'?'🏗️ '+cso.name+' — bangun posisi':'⏳ '+cso.name+' · Next PRIME: '+(nxt?nxt.name+' dalam ~'+nxt.inHours+'h':'—'),
        nextPrime:nxt,nextPrimeSession:nxt?{name:nxt.name,inHours:nxt.inHours}:null},
      whaleFingerprint,squeezeRadar,stealthVolume,hiddenGems,momentumShift,
      dailyOpportunityScore,marketRegime,todaysBestTrade,
      retailTrapList,retailSqueezeList,
    };

    const json=JSON.stringify(out);
    CACHE.d=out;CACHE.t=Date.now();
    return res.status(200).send(json);

  }catch(e){
    try{
      const safe={...SAFE_RESP,ok:false,error:String(e?.message||'Unknown'),ts:Date.now(),elapsed:Date.now()-t0};
      return res.status(200).json(safe);
    }catch{
      return res.status(200).end('{"ok":false,"error":"critical","version":"v10"}');
    }
  }
}
