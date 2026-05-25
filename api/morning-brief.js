// api/morning-brief.js v1 — AC369 Trade Intelligence System (TIS)
// Module 2: Convergence Score | Module 3: Game Plan
// Module 4: Flow Map | Module 5: Schedule | Module 6: Checklist
// Data real: CoinGecko + Bybit + CryptoCompare + Alternative.me
// Cache: 8 menit | Safe: semua parallel max ~5.5s

const N=(v,d=0)=>{const n=+v;return isNaN(n)||!isFinite(n)?d:n;};
const A=v=>Array.isArray(v)?v:[];
const clamp=(v,a,b)=>Math.max(a,Math.min(b,N(v)));
const TOP15=['BTC','ETH','BNB','SOL','XRP','ADA','DOGE','AVAX','LINK','DOT','NEAR','SUI','APT','ARB','OP'];

const SECS={
  BTC:['BTC'],ETH:['ETH'],
  L1:['SOL','ADA','AVAX','TON','NEAR','SUI','APT','TIA','SEI','INJ','HBAR','ALGO','XLM','VET'],
  L2:['ARB','OP','MATIC','POL','IMX','STRK','MNT'],
  DEFI:['UNI','AAVE','CRV','MKR','LDO','PENDLE','GMX','DYDX','JUP','CAKE','RDNT'],
  AI:['RENDER','FET','AGIX','OCEAN','TAO','WLD','ARKM','GRT','OLAS','IO','VIRTUAL'],
  MEME:['DOGE','SHIB','PEPE','BONK','WIF','FLOKI','BOME','DOGS','NEIRO','PNUT','MEW'],
  GAME:['SAND','MANA','AXS','GALA','RON','MAGIC','BEAM'],
  INFRA:['LINK','DOT','ATOM','FIL','PYTH','JTO','W','ZRO'],
  PAY:['XRP','LTC','BCH','XLM','TRX'],
};
const SNAMES={BTC:'Bitcoin',ETH:'Ethereum',L1:'Layer 1',L2:'Layer 2',DEFI:'DeFi',AI:'AI',MEME:'Meme',GAME:'Gaming',INFRA:'Infra',PAY:'Payments',ALT:'Altcoins'};
const getSec=sym=>{for(const[s,arr]of Object.entries(SECS))if(arr.includes(sym))return s;return'ALT';};
const STABS=new Set(['USDT','USDC','BUSD','DAI','TUSD','FDUSD','USDD','FRAX','USDE']);

const calcRSI=closes=>{
  if(!closes||closes.length<16)return null;
  let ag=0,al=0;
  for(let i=1;i<=14;i++){const d=closes[i]-closes[i-1];d>0?ag+=d:al-=d;}
  ag/=14;al/=14;
  for(let i=15;i<closes.length;i++){const d=closes[i]-closes[i-1];ag=(ag*13+Math.max(d,0))/14;al=(al*13+Math.max(-d,0))/14;}
  return al===0?100:+clamp(100-100/(1+ag/al),0,100).toFixed(1);
};

const calcMACD=a=>{
  if(!a||a.length<36)return null;
  const k12=2/13,k26=2/27,k9=2/10;
  let e12=a.slice(0,12).reduce((s,v)=>s+v,0)/12,e26=a.slice(0,26).reduce((s,v)=>s+v,0)/26;
  const mv=[];
  for(let i=26;i<a.length;i++){e12=a[i]*k12+e12*(1-k12);e26=a[i]*k26+e26*(1-k26);mv.push(e12-e26);}
  let sig=mv.slice(0,9).reduce((s,v)=>s+v,0)/9;
  for(let i=9;i<mv.length;i++)sig=mv[i]*k9+sig*(1-k9);
  const n=mv.length,last=N(mv[n-1]),h=last-sig,ph=N(mv[n-2]||last)-sig;
  return{bull:last>0&&h>0,bear:last<0&&h<0,xUp:h>0&&ph<=0,xDown:h<0&&ph>=0};
};

const calcEMA=(a,p)=>{
  if(!a||a.length<2)return N(a?.[a.length-1]);
  const k=2/(p+1);let e=a.slice(0,Math.min(p,a.length)).reduce((s,v)=>s+v,0)/Math.min(p,a.length);
  for(let i=Math.min(p,a.length);i<a.length;i++)e=a[i]*k+e*(1-k);
  return e;
};

export default async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Cache-Control','s-maxage=480,stale-while-revalidate=60');
  if(req.method==='OPTIONS')return res.status(200).end();
  const t0=Date.now();

  const sf=async(url,ms)=>{
    const c=new AbortController();const t=setTimeout(()=>c.abort(),ms);
    try{const r=await fetch(url,{signal:c.signal,headers:{Accept:'application/json','User-Agent':'AC369/1.0'}});clearTimeout(t);if(!r.ok)return null;return await r.json();}
    catch{clearTimeout(t);return null;}
  };

  try{
    // ── Parallel fetch ────────────────────────────────────
    const[cgR,cgGR,byR,fgR,klR]=await Promise.allSettled([
      sf('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=volume_desc&per_page=200&page=1&sparkline=false&price_change_percentage=24h,7d',6000),
      sf('https://api.coingecko.com/api/v3/global',4000),
      sf('https://api.bybit.com/v5/market/tickers?category=linear',4000),
      sf('https://api.alternative.me/fng/?limit=1&format=json',3000),
      Promise.allSettled(TOP15.map(s=>sf(`https://min-api.cryptocompare.com/data/v2/histohour?fsym=${s}&tsym=USD&limit=56&aggregate=4&e=CCCAGG`,5000))),
    ]);

    const markets=A(cgR.value);
    if(!markets.length)return res.status(200).json({ok:false,error:'CoinGecko unavailable.',ts:Date.now(),elapsed:Date.now()-t0,version:'v1'});

    const cgG=cgGR.value?.data||{};
    const btcDom=N(cgG.market_cap_percentage?.btc,58);
    const mcapCh24=N(cgG.market_cap_change_percentage_24h_usd,0);
    const totalMcap=N(cgG.total_market_cap?.usd,0);
    const fg=N(fgR.value?.data?.[0]?.value,50);
    const fgLabel=fgR.value?.data?.[0]?.value_classification||'Neutral';

    // ── Bybit FR ──────────────────────────────────────────
    const frMap={};
    try{
      for(const t of A(byR.value?.result?.list)){
        try{
          const sym=String(t.symbol||'').replace('USDT','').replace('PERP','');
          if(!sym||sym.length>10)continue;
          const fr=N(t.fundingRate);
          frMap[sym]={fr,oi:N(t.openInterestValue),pct:+(fr*100).toFixed(4),bull:fr<-0.0002,bear:fr>0.0004};
        }catch{}
      }
    }catch{}

    // ── CC klines → kMap ──────────────────────────────────
    const kMap={};
    try{
      const klArr=A(klR.value);
      for(let i=0;i<TOP15.length;i++){
        try{
          const r=klArr[i];
          if(r?.status!=='fulfilled'||r.value?.Response!=='Success')continue;
          const rows=A(r.value?.Data?.Data);
          if(rows.length<16)continue;
          const K=rows.map(d=>({h:N(d.high),l:N(d.low),c:N(d.close),o:N(d.open)})).filter(k=>k.c>0&&k.c<1e12);
          if(K.length<16)continue;
          const cls=K.map(k=>k.c);
          const rsi=calcRSI(cls);if(rsi===null)continue;
          const rsi1d=calcRSI(cls.filter((_,idx)=>idx%6===0));
          const macd=calcMACD(cls);
          const ema50=+calcEMA(cls,Math.min(50,cls.length-1)).toFixed(8);
          const ema200=+calcEMA(cls,Math.min(200,cls.length-1)).toFixed(8);
          const atr=K.slice(1).slice(-14).reduce((s,k,j)=>s+Math.max(K[j].h-K[j].l,Math.abs(K[j].h-K[j].c),Math.abs(K[j].l-K[j].c)),0)/14;
          // Swing levels
          const swH=[],swL=[];
          for(let j=3;j<K.length-3;j++){
            if(K[j].h>K[j-1].h&&K[j].h>K[j-2].h&&K[j].h>K[j+1].h&&K[j].h>K[j+2].h)swH.push(K[j].h);
            if(K[j].l<K[j-1].l&&K[j].l<K[j-2].l&&K[j].l<K[j+1].l&&K[j].l<K[j+2].l)swL.push(K[j].l);
          }
          kMap[TOP15[i]]={rsi:+N(rsi).toFixed(1),rsi1d:rsi1d!=null?+N(rsi1d).toFixed(1):null,macd,ema50,ema200,atr:+atr.toFixed(8),swH:swH.slice(-5),swL:swL.slice(-5),cls};
        }catch{}
      }
    }catch{}

    // ── Coin list ─────────────────────────────────────────
    const coins=[];
    for(const c of markets){
      try{
        const sym=(c.symbol||'').toUpperCase();
        if(STABS.has(sym))continue;
        const price=N(c.current_price);if(price<=0)continue;
        if(price>=0.97&&price<=1.03&&Math.abs(N(c.price_change_percentage_24h))<0.5)continue;
        const ch24=N(c.price_change_percentage_24h);
        const ch7d=c.price_change_percentage_7d!=null?N(c.price_change_percentage_7d):null;
        const vol=N(c.total_volume);
        const h=N(c.high_24h)||price*1.02,l=N(c.low_24h)||price*0.98;
        const pPos=h>l?clamp((price-l)/(h-l),0,1):0.5;
        const kd=kMap[sym]||null;
        const fd=frMap[sym]||null;
        const sector=getSec(sym);
        let rsi=50,rsiReal=false;
        if(kd){rsi=kd.rsi;rsiReal=true;}
        else{rsi=clamp(Math.round(50+ch24*1.8+(pPos-0.5)*22+((ch7d||0)*0.7)),15,85);}
        coins.push({sym,name:c.name||sym,price,ch24:+ch24.toFixed(2),ch7d:ch7d!=null?+ch7d.toFixed(2):null,vol,h,l,pPos:+pPos.toFixed(3),mcap:N(c.market_cap),mcapRank:N(c.market_cap_rank,999),sector,rsi,rsiReal,kd,fd});
      }catch{}
    }

    // ── RS vs BTC ─────────────────────────────────────────
    const btcC=coins.find(c=>c.sym==='BTC');
    const btcCh24=btcC?.ch24||0;
    const btcCh7d=btcC?.ch7d||0;
    for(const c of coins){
      const rs24=+(c.ch24-btcCh24).toFixed(2);
      const rs7d=c.ch7d!=null?+(c.ch7d-btcCh7d).toFixed(2):null;
      const rsScore=rs7d!=null?+(rs7d*0.6+rs24*0.4).toFixed(2):rs24;
      c.rs={score:+rsScore.toFixed(2),rs24,rs7d};
    }

    // ── Timing (WIB = UTC+7) ──────────────────────────────
    const now=new Date();
    const wibH=(now.getUTCHours()+7)%24;
    const dow=now.getUTCDay();
    let curSes,sesQ,sesScore;
    if(wibH>=21&&wibH<24){curSes='NY_OPEN';sesQ='PRIME 🔥🔥';sesScore=5;}
    else if(wibH>=15&&wibH<18){curSes='LONDON_OPEN';sesQ='PRIME 🔥🔥';sesScore=5;}
    else if(wibH>=9&&wibH<12){curSes='ASIA_PEAK';sesQ='GOOD ✅';sesScore=3;}
    else if(wibH>=23||wibH<2){curSes='NY_LATE';sesQ='GOOD ✅';sesScore=3;}
    else if(wibH>=18&&wibH<21){curSes='NY_PREMARKET';sesQ='BUILDING 📈';sesScore=2;}
    else if(wibH>=6&&wibH<9){curSes='ASIA_OPEN';sesQ='MODERATE';sesScore=2;}
    else if(wibH>=12&&wibH<15){curSes='LUNCH_DIP';sesQ='CAUTION ⚠️';sesScore=1;}
    else{curSes='DEAD_ZONE';sesQ='POOR 😴';sesScore=0;}
    const dayScore=dow>=1&&dow<=4?3:dow===5?2:dow===6?1:0;

    // ── MODULE 2: CONVERGENCE SCORE ───────────────────────
    const convCalc=coin=>{
      let tech=0,struct=0,macro=0,timing=0;
      const{rsi,ch24,ch7d,pPos,fd,rs,sector,vol,mcap,kd}=coin;
      const c7=ch7d||0;
      if(rsi<25)tech+=15;else if(rsi<32)tech+=10;else if(rsi<40)tech+=6;else if(rsi<44)tech+=3;
      else if(rsi>82)tech-=15;else if(rsi>75)tech-=10;else if(rsi>68)tech-=5;
      if(kd?.macd?.xUp)tech+=8;else if(kd?.macd?.xDown)tech-=8;
      else if(kd?.macd?.bull)tech+=4;else if(kd?.macd?.bear)tech-=4;
      if(kd?.ema200&&coin.price>kd.ema200)tech+=4;else if(kd?.ema200&&coin.price<kd.ema200)tech-=4;
      if(c7<-8&&ch24>2)tech+=5;
      if(pPos<0.20&&ch24>1)struct+=10;else if(pPos<0.30)struct+=6;
      else if(pPos>0.80&&ch24<0)struct-=8;
      if(c7<-10&&ch24>2&&pPos>0.3)struct+=8;
      if(fd?.bull)struct+=8;else if(fd?.bear)struct-=8;
      else if(fd&&fd.fr<0)struct+=2;else if(fd&&fd.fr>0.0001)struct-=2;
      if(mcap>0&&vol/mcap>0.15)struct+=5;else if(mcap>0&&vol/mcap>0.08)struct+=2;
      if(rs?.score>10)struct+=5;else if(rs?.score>3)struct+=2;
      else if(rs?.score<-10)struct-=5;else if(rs?.score<-3)struct-=2;
      if(btcCh24>4)macro+=8;else if(btcCh24>2)macro+=5;else if(btcCh24>0)macro+=2;
      else if(btcCh24<-4)macro-=8;else if(btcCh24<-2)macro-=5;else macro-=2;
      if(fg<20)macro+=8;else if(fg<35)macro+=4;else if(fg<50)macro+=1;
      else if(fg>80)macro-=8;else if(fg>65)macro-=4;
      if(btcDom<48)macro+=5;else if(btcDom>62)macro-=5;
      if(mcapCh24>2)macro+=3;else if(mcapCh24<-2)macro-=3;
      timing+=sesScore*1.5;timing+=dayScore;
      if(curSes==='DEAD_ZONE')timing-=8;else if(curSes==='LUNCH_DIP')timing-=4;
      const raw=clamp(50+tech+struct+macro+timing,5,98);
      return{score:Math.round(raw),tech:Math.round(tech),struct:Math.round(struct),macro:Math.round(macro),timing:Math.round(timing),label:raw>=85?'🔥 RARE':raw>=75?'✅ HIGH PROB':raw>=65?'📈 GOOD':raw>=55?'⚖️ MODERATE':'⚠️ WEAK'};
    };
    for(const c of coins)c.conv=convCalc(c);

    const leaders=coins.filter(c=>c.conv.score>=60&&c.vol>=1e6&&c.sym!=='BTC')
      .sort((a,b)=>b.conv.score-a.conv.score).slice(0,15);

    // ── MODULE 3: GAME PLAN ───────────────────────────────
    const btcKd=kMap['BTC'];
    const btcPrice=btcC?.price||0;
    let btcLevels={current:btcPrice,resistance:null,support:null,bullTrigger:null,bearTrigger:null,ema50:btcKd?.ema50||null,ema200:btcKd?.ema200||null};
    if(btcKd&&btcPrice){
      const swHA=btcKd.swH.filter(h=>h>btcPrice*1.001).sort((a,b)=>a-b);
      const swLB=btcKd.swL.filter(l=>l<btcPrice*0.999).sort((a,b)=>b-a);
      btcLevels.resistance=swHA[0]?+swHA[0].toFixed(2):+(btcPrice*1.04).toFixed(2);
      btcLevels.support=swLB[0]?+swLB[0].toFixed(2):+(btcPrice*0.96).toFixed(2);
      btcLevels.bullTrigger=+(btcLevels.resistance*1.002).toFixed(2);
      btcLevels.bearTrigger=+(btcLevels.support*0.998).toFixed(2);
    }

    const mkSetup=(coin,type)=>{
      try{
        const{sym,name,price,rsi,fd,rs,kd,pPos,ch24,ch7d,sector,conv}=coin;
        const atrP=price>0?(kd?.atr||((coin.h-coin.l)*0.65))/price:0.025;
        const entry=+(price*(1+(type==='scalp'?0:type==='swing'?-0.005:-0.01))).toFixed(price>10?2:price>1?4:6);
        const sl=+(entry*(1-Math.max(atrP*1.8,0.02))).toFixed(price>10?2:price>1?4:6);
        const risk=entry-sl;
        const tp1=+(entry+risk*1.5).toFixed(price>10?2:price>1?4:6);
        const tp2=+(entry+risk*2.5).toFixed(price>10?2:price>1?4:6);
        const reasons=[];
        if(rsi<32)reasons.push('RSI '+rsi+' oversold');
        if(kd?.macd?.xUp)reasons.push('MACD golden cross');
        if(pPos<0.28)reasons.push('Discount zone '+Math.round(pPos*100)+'%');
        if(fd?.bull)reasons.push('FR '+fd.pct+'% squeeze');
        if(rs?.score>5)reasons.push('RS +'+rs.score+'% vs BTC');
        if(ch7d&&ch7d<-8&&ch24>1)reasons.push('Bounce -'+Math.abs(ch7d).toFixed(0)+'% 7d');
        return{sym,name,sector,price,entry,sl,tp1,tp2,rr:'1:2.5',conv:conv.score,rsi,rsiReal:coin.rsiReal,fr:fd?.pct||null,rs:rs?.score||0,reasons:reasons.slice(0,3),slPct:+((entry-sl)/entry*100).toFixed(2),tp1Pct:+((tp1-entry)/entry*100).toFixed(2),tp2Pct:+((tp2-entry)/entry*100).toFixed(2)};
      }catch{return null;}
    };

    const scalpSetups=coins.filter(c=>c.conv.score>=60&&c.vol>=5e6&&c.rsi>=38&&c.rsi<=65&&c.sym!=='BTC').sort((a,b)=>b.conv.score-a.conv.score).slice(0,3).map(c=>mkSetup(c,'scalp')).filter(Boolean);
    const swingSetups=coins.filter(c=>c.conv.score>=58&&c.vol>=2e6&&c.rsi<47&&c.sym!=='BTC').sort((a,b)=>b.conv.score-a.conv.score).slice(0,3).map(c=>mkSetup(c,'swing')).filter(Boolean);
    const spotAccum=coins.filter(c=>c.rsi<38&&c.mcap>50e6&&c.vol>=500000&&c.sym!=='BTC').sort((a,b)=>a.rsi-b.rsi).slice(0,4).map(c=>{
      const lo=+(c.price*0.97).toFixed(c.price>10?2:c.price>1?4:6);
      const hi=+(c.price*1.01).toFixed(c.price>10?2:c.price>1?4:6);
      return{sym:c.sym,name:c.name,sector:c.sector,price:c.price,rsi:c.rsi,rsi1d:c.kd?.rsi1d||null,rsiReal:c.rsiReal,ch7d:c.ch7d,conv:c.conv.score,dcaZone:lo+' – '+hi};
    });
    const avoidList=coins.filter(c=>c.rsi>78||(c.fd&&c.fd.fr>0.0004)).sort((a,b)=>(b.fd?.fr||0)-(a.fd?.fr||0)||b.rsi-a.rsi).slice(0,5).map(c=>({sym:c.sym,price:c.price,rsi:c.rsi,fr:c.fd?.pct||null,reason:c.rsi>82?'RSI '+c.rsi+' overbought':c.fd?.fr>0.0004?'FR +'+c.fd.pct+'% overheated':'Extended'}));

    // ── MODULE 4: FLOW MAP ────────────────────────────────
    const flowMap={};
    for(const c of coins){
      if(!flowMap[c.sector])flowMap[c.sector]={count:0,vol:0,bulls:0,ch24Sum:0,ch7dSum:0,ch7dN:0,rsiSum:0,frSum:0,frN:0};
      const f=flowMap[c.sector];
      f.count++;f.vol+=c.vol;if(c.ch24>0)f.bulls++;
      f.ch24Sum+=c.ch24;if(c.ch7d!=null){f.ch7dSum+=c.ch7d;f.ch7dN++;}
      f.rsiSum+=c.rsi;if(c.fd){f.frSum+=c.fd.fr;f.frN++;}
    }
    const flowArr=Object.entries(flowMap).map(([sec,f])=>{
      const avgCh24=+(f.ch24Sum/f.count).toFixed(2);
      const avgRSI=+(f.rsiSum/f.count).toFixed(0);
      const bullPct=+(f.bulls/f.count*100).toFixed(0);
      let sig,col;
      if(avgCh24>5&&bullPct>=70){sig='🔥 HOT';col='green';}
      else if(avgCh24>2&&bullPct>=60){sig='↑↑ INFLOW';col='green';}
      else if(avgCh24>0){sig='↑ MILD';col='lightgreen';}
      else if(avgCh24<-5&&bullPct<30){sig='💀 EXIT';col='red';}
      else if(avgCh24<-2){sig='↓↓ OUTFLOW';col='red';}
      else if(avgCh24<0){sig='↓ WEAK';col='orange';}
      else{sig='→ NEUTRAL';col='gray';}
      return{sector:sec,name:SNAMES[sec]||sec,count:f.count,vol:+f.vol.toFixed(0),avgCh24,avgRSI:+avgRSI,bullPct,avgFR:f.frN>0?+(f.frSum/f.frN*100).toFixed(4):null,sig,col};
    }).sort((a,b)=>b.avgCh24-a.avgCh24);

    // ── MODULE 1: MARKET CHARACTER ────────────────────────
    const bullPctMkt=+(coins.filter(c=>c.ch24>0).length/coins.length*100).toFixed(0);
    const avgCh24Mkt=+(coins.reduce((s,c)=>s+c.ch24,0)/coins.length).toFixed(2);
    const xOBs=coins.filter(c=>c.rsi>80).length;
    const xOSs=coins.filter(c=>c.rsi<30).length;
    const allFRs=Object.values(frMap).map(f=>f.fr).filter(f=>Math.abs(f)>0.00001);
    const avgFRMkt=allFRs.length?+(allFRs.reduce((s,v)=>s+v,0)/allFRs.length*100).toFixed(4):0;
    const btcRange=btcC?btcC.h-btcC.l:0;
    const btcRR=btcKd?.atr>0?+(btcRange/btcKd.atr).toFixed(2):1;
    let charType,charDesc,riskLevel,tradeStyle,riskMult,charColor;
    if(xOBs>15&&avgFRMkt>0.025){charType='⛔ OVERHEATED';charDesc='Banyak koin overbought+FR tinggi. Risiko koreksi. Kurangi posisi.';riskLevel='DANGEROUS';tradeStyle='Take Profit';riskMult=0.25;charColor='red';}
    else if(xOSs>20&&bullPctMkt<35){charType='🔄 CAPITULATION';charDesc='Banyak extreme oversold. Potensi reversal kuat.';riskLevel='HIGH OPP';tradeStyle='Reversal Long';riskMult=1.2;charColor='green';}
    else if(avgCh24Mkt>3&&bullPctMkt>65){charType='📈 TRENDING BULL';charDesc='Market trending naik. Follow momentum.';riskLevel='NORMAL';tradeStyle='Swing & Momentum';riskMult=1.0;charColor='green';}
    else if(avgCh24Mkt<-3&&bullPctMkt<35){charType='📉 TRENDING BEAR';charDesc='Market trending turun. Cash atau short.';riskLevel='REDUCED';tradeStyle='Cash / Short';riskMult=0.5;charColor='red';}
    else if(btcRR<0.7&&Math.abs(avgCh24Mkt)<1.5){charType='⚡ CHOPPY';charDesc='Market tidak berarah. Scalp kecil saja.';riskLevel='LOW';tradeStyle='Scalp Only';riskMult=0.5;charColor='amber';}
    else if(avgCh24Mkt>1&&bullPctMkt>55){charType='🟢 MILD BULL';charDesc='Market mild bullish. Selektif dengan convergence ≥68.';riskLevel='NORMAL';tradeStyle='Selective Swing';riskMult=0.85;charColor='green';}
    else if(avgCh24Mkt<-1){charType='🟡 MILD BEAR';charDesc='Kurangi size 30-50%. Fokus koin outperform BTC.';riskLevel='REDUCED';tradeStyle='Small Size';riskMult=0.6;charColor='amber';}
    else{charType='⚖️ NEUTRAL';charDesc='Market seimbang. Akumulasi spot di discount zone.';riskLevel='LOW-MED';tradeStyle='Spot Accum';riskMult=0.7;charColor='amber';}

    // ── MODULE 5: SCHEDULE ────────────────────────────────
    const sessions=[
      {id:'DEAD_ZONE',name:'😴 Dead Zone',time:'02:00–06:00',q:'POOR',activity:'Volume minimum. Hindari trading.'},
      {id:'ASIA_OPEN',name:'🌅 Asia Open',time:'06:00–09:00',q:'MODERATE',activity:'Volume mulai naik. Scalp kecil OK.'},
      {id:'ASIA_PEAK',name:'🔥 Asia Peak',time:'09:00–12:00',q:'GOOD',activity:'Asia aktif. Good for scalp.'},
      {id:'LUNCH_DIP',name:'⚠️ Lunch Dip',time:'12:00–15:00',q:'CAUTION',activity:'Volume turun. Hindari entry baru.'},
      {id:'LONDON_OPEN',name:'💥 London Open',time:'15:00–18:00',q:'PRIME',activity:'Volume naik drastis. Best untuk breakout.'},
      {id:'NY_PREMARKET',name:'📈 NY Pre',time:'18:00–21:00',q:'BUILDING',activity:'Persiapkan entry untuk NY open.'},
      {id:'NY_OPEN',name:'🚀 NY Open',time:'21:00–23:00',q:'PRIME',activity:'Volume tertinggi. Best setups.'},
      {id:'NY_LATE',name:'🌙 NY Late',time:'23:00–02:00',q:'GOOD',activity:'Volume turun. Manage posisi.'},
    ];
    const curSesObj=sessions.find(s=>s.id===curSes)||sessions[0];
    const primeSes=sessions.filter(s=>s.q==='PRIME').map(s=>({...s,inH:(s.id==='LONDON_OPEN'?15:21)-wibH<0?(s.id==='LONDON_OPEN'?15:21)-wibH+24:(s.id==='LONDON_OPEN'?15:21)-wibH})).sort((a,b)=>a.inH-b.inH);
    const szRec=riskMult>=1?'Full size (100%)':riskMult>=0.85?'Normal (85%)':riskMult>=0.7?'Reduced (70%)':riskMult>=0.5?'Half (50%)':'Minimal (25%)';
    const focusTxt=charType.includes('BULL')?'Swing di convergence ≥68. Hold melewati London & NY session.':charType.includes('BEAR')?'Cash 70-80%. Scalp hanya di reversal extreme.':charType.includes('CHOPPY')?'Scalp kecil saja. TP 1-2%, SL ketat.':charType.includes('OVERHEATED')?'Take profit. Jangan buka posisi baru.':'Selektif. Convergence ≥65, volume di atas rata-rata.';

    // ── MODULE 6: CHECKLIST ───────────────────────────────
    const sesGood=sesScore>=2;
    const frOK=Math.abs(avgFRMkt)<0.025;
    const mktOK=!charType.includes('OVERHEATED')&&!charType.includes('DANGEROUS');
    const btcAtR=btcLevels.resistance&&btcPrice&&(btcPrice/btcLevels.resistance)>0.985;
    const mktNOB=xOBs<20&&avgFRMkt<0.03;

    // ── RESPONSE ─────────────────────────────────────────
    return res.status(200).json({
      ok:true,ts:Date.now(),elapsed:Date.now()-t0,version:'v1',
      dataQuality:{coins:coins.length,realRSI:Object.keys(kMap).length,fr:Object.keys(frMap).length},
      // Module 1: Market Character
      marketCharacter:{
        type:charType,
        description:charDesc,        // was 'desc'
        riskLevel,
        tradeStyle,
        riskMultiplier:riskMult,     // was 'riskMult'
        color:charColor,
        stats:{avgCh24:avgCh24Mkt,bullPct:bullPctMkt,xOB:xOBs,xOS:xOSs,avgFR:avgFRMkt}
      },
      // BTC Snapshot
      btcSnapshot:btcC?{
        price:btcC.price,ch24:btcC.ch24,ch7d:btcC.ch7d,
        rsi:btcKd?.rsi||null,rsi1d:btcKd?.rsi1d||null,
        macd:btcKd?.macd||null,ema50:btcKd?.ema50||null,ema200:btcKd?.ema200||null,
        aboveEma200:btcC&&btcKd?btcC.price>btcKd.ema200:null,
        fg,fgLabel,btcDom,totalMcap,mcapCh24
      }:null,
      // Module 2: Convergence
      convergence:{
        leaders:leaders.map(c=>({
          sym:c.sym,name:c.name,sector:c.sector,price:c.price,ch24:c.ch24,
          rsi:c.rsi,rsiReal:c.rsiReal,rsi1d:c.kd?.rsi1d||null,conv:c.conv,
          fr:c.fd?.pct||null,
          frSig:c.fd?.fr<-0.0005?'SQUEEZE🚀':c.fd?.fr<-0.0003?'SHORT SQ💎':c.fd?.fr>0.0005?'EXTREME🚨':c.fd?.fr>0.0003?'LONG HEAVY⚠️':'NORMAL⚖️',
          rs:c.rs?.score||0,macdXUp:c.kd?.macd?.xUp||false
        }))
      },
      // Module 3: Game Plan
      gamePlan:{
        btcLevels,
        btcSentiment:btcKd&&btcC?{
          rsi:btcKd.rsi,rsi1d:btcKd.rsi1d,macd:btcKd.macd,
          aboveEma50:btcC.price>btcKd.ema50,aboveEma200:btcC.price>btcKd.ema200,
          trend:btcC.price>btcKd.ema200?'Bullish (>EMA200)':'Bearish (<EMA200)'
        }:null,
        scalpSetups:scalpSetups.map(s=>s?{...s,convScore:s.conv}:null).filter(Boolean),
        swingSetups:swingSetups.map(s=>s?{...s,convScore:s.conv}:null).filter(Boolean),
        spotAccum,avoidList,
        scenarios:{
          bull:{condition:'BTC tembus $'+btcLevels.bullTrigger,action:'Long alts convergence ≥70',setups:scalpSetups.slice(0,2)},
          bear:{condition:'BTC breakdown ke $'+btcLevels.bearTrigger,action:'Cash 80%. Tunggu stabilisasi.'},
          sideways:{condition:'BTC konsolidasi ±2%',action:'Scalp setup terbaik saja',setups:swingSetups.slice(0,2)}
        }
      },
      // Module 4: Sector Flow
      sectorFlow:{
        sectors:flowArr.map(f=>({...f,flowSig:f.sig,flowColor:f.col})), // add aliases
        hot:flowArr.filter(f=>f.avgCh24>2).slice(0,4),
        cold:flowArr.filter(f=>f.avgCh24<-1).sort((a,b)=>a.avgCh24-b.avgCh24).slice(0,3),
        rotating:flowArr.filter(f=>f.avgRSI<48&&f.avgCh24>0).slice(0,3)
      },
      // Module 5: Schedule
      tradingSchedule:{
        currentSession:curSes,           // was 'curSes'
        sessionQuality:sesQ,             // was 'sesQ'
        currentSessionData:curSesObj,    // was 'curSesObj'
        nextPrimeSession:primeSes[0]||null, // was 'nextPrime'
        focusToday:focusTxt,             // was 'focus'
        positionSizeRec:szRec,           // was 'sizeRec'
        sessions,wibHour:wibH,           // wibHour (was wibH)
        dayName:['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'][dow]
      },
      // Module 6: Checklist
      checklist:{
        marketChecks:[                   // was 'market'
          {label:'Market character OK',pass:mktOK,detail:charType,fix:!mktOK?'Kurangi posisi':''},
          {label:'Session berkualitas',pass:sesGood,detail:curSes+' '+sesQ,fix:!sesGood?'Tunggu London/NY open':''},
          {label:'BTC tidak di resistance',pass:!btcAtR,detail:btcAtR?'Dekat resist $'+(btcLevels.resistance?.toFixed(0)||'?'):'Aman',fix:btcAtR?'Tunggu BTC breakout':''},
          {label:'FR market normal',pass:frOK,detail:'Avg FR: '+(avgFRMkt>=0?'+':'')+avgFRMkt+'%',fix:!frOK?'Market terlalu long':''},
          {label:'Market tidak overbought',pass:mktNOB,detail:xOBs+' koin RSI>80',fix:!mktNOB?'Distribusi terdeteksi':''}
        ],
        coinChecks:[                     // was 'coin'
          'RSI koin < 75',
          'FR koin < +0.04%',
          'Volume > $5M',
          'Stop Loss sudah ditentukan',
          'Setup sesuai Game Plan',
          'RR minimal 1:1.5',
          'Convergence ≥ 65'
        ],
        marketPassCount:[mktOK,sesGood,!btcAtR,frOK,mktNOB].filter(Boolean).length, // was 'passCount'
        marketTotal:5,                   // NEW - was missing
        overallGreenLight:mktOK&&sesGood&&frOK, // was 'ok'
        verdict:mktOK&&sesGood&&frOK?'🟢 Kondisi OK — cek koin individual':'🟡 Hati-hati — '+[!mktOK?charType:'',!sesGood?'Session '+sesQ:'',!frOK?'FR Overheated':''].filter(Boolean).join(', ')
      }
    });
  }catch(e){
    return res.status(200).json({ok:false,error:e.message,ts:Date.now(),elapsed:Date.now()-t0,version:'v1'});
  }
}
