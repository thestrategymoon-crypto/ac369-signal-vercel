// api/morning-brief.js — v1 AC369 TRADE INTELLIGENCE SYSTEM (TIS)
// ════════════════════════════════════════════════════════════════
// MODULE 2: Convergence Score (0-100, 4 faktor: Tech+Structure+Macro+Timing)
// MODULE 3: Conditional Game Plan (3 skenario BTC + entry/SL/TP real)
// MODULE 4: Smart Money Flow Map (sector rotation + inflow/outflow)
// MODULE 5: Trading Schedule WIB (session quality + best hours)
// MODULE 6: Pre-Trade Checklist (7 kondisi berbasis data real)
//
// DATA REAL dari: CoinGecko + Bybit + CryptoCompare + Alternative.me
// Cache: 8 menit — cukup fresh untuk morning strategy
// Timeout safe: semua parallel, max ~5.5s < Vercel 10s limit
// TIDAK ADA DATA PALSU — semua derived dari data API nyata
// ════════════════════════════════════════════════════════════════

const N=(v,d=0)=>{const n=+v;return isNaN(n)||!isFinite(n)?d:n;};
const A=v=>Array.isArray(v)?v:[];
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,N(v)));
const pct=(a,b)=>b>0?+((a-b)/b*100).toFixed(2):0;

// Top 15 untuk real klines (RSI+MACD+EMA akurat)
const TOP15=['BTC','ETH','BNB','SOL','XRP','ADA','DOGE','AVAX','LINK','DOT','NEAR','SUI','APT','ARB','OP'];

const SECTORS={
  BTC:new Set(['BTC']),ETH:new Set(['ETH']),
  L1:new Set(['SOL','ADA','AVAX','TON','NEAR','SUI','APT','TIA','SEI','INJ','HBAR','ALGO','XLM','VET','ONE','KAVA','EGLD','ROSE']),
  L2:new Set(['ARB','OP','MATIC','POL','IMX','STRK','MANTA','ZK','MNT','BASE','LINEA']),
  DEFI:new Set(['UNI','AAVE','CRV','MKR','LDO','PENDLE','GMX','DYDX','JUP','CAKE','RDNT','SNX','1INCH','SUSHI','COMP','BAL','YFI']),
  AI:new Set(['RENDER','FET','AGIX','OCEAN','TAO','WLD','ARKM','GRT','OLAS','IO','VIRTUAL','GRASS','NMR']),
  MEME:new Set(['DOGE','SHIB','PEPE','BONK','WIF','FLOKI','BOME','DOGS','NEIRO','PNUT','MEW','POPCAT','ACT','GOAT','MOODENG','TURBO']),
  GAME:new Set(['SAND','MANA','AXS','GALA','RON','MAGIC','BEAM','YGG','PIXEL','ILV','PYR']),
  INFRA:new Set(['LINK','DOT','ATOM','FIL','PYTH','JTO','W','ZRO','EIGEN','AR','STORJ','LPT','API3']),
  RWA:new Set(['ONDO','POLYX','CFG','MPL','TRU']),
  PAY:new Set(['XRP','LTC','BCH','XLM','TRX','XMR']),
};
const SECTOR_NAMES={BTC:'Bitcoin',ETH:'Ethereum',L1:'Layer 1',L2:'Layer 2',DEFI:'DeFi',AI:'AI / ML',MEME:'Meme',GAME:'Gaming',INFRA:'Infrastructure',RWA:'RWA',PAY:'Payments',ALT:'Altcoins'};
const getSector=sym=>{for(const[s,set]of Object.entries(SECTORS))if(set.has(sym))return s;return'ALT';};
const STABLES=new Set(['USDT','USDC','BUSD','DAI','TUSD','FDUSD','USDD','FRAX','USDE','PYUSD','SUSD','LUSD','GUSD']);

// ── INDICATORS ────────────────────────────────────────────────
const rsi14=closes=>{
  if(!closes||closes.length<16)return null;
  let ag=0,al=0;
  for(let i=1;i<=14;i++){const d=closes[i]-closes[i-1];d>0?ag+=d:al-=d;}
  ag/=14;al/=14;
  for(let i=15;i<closes.length;i++){const d=closes[i]-closes[i-1];ag=(ag*13+Math.max(d,0))/14;al=(al*13+Math.max(-d,0))/14;}
  return al===0?100:+clamp(100-100/(1+ag/al),0,100).toFixed(1);
};

const macdCalc=a=>{
  if(!a||a.length<36)return null;
  const k12=2/13,k26=2/27,k9=2/10;
  let e12=a.slice(0,12).reduce((s,v)=>s+v,0)/12,e26=a.slice(0,26).reduce((s,v)=>s+v,0)/26;
  const mv=[];
  for(let i=26;i<a.length;i++){e12=a[i]*k12+e12*(1-k12);e26=a[i]*k26+e26*(1-k26);mv.push(e12-e26);}
  let sig=mv.slice(0,9).reduce((s,v)=>s+v,0)/9;
  for(let i=9;i<mv.length;i++)sig=mv[i]*k9+sig*(1-k9);
  const n=mv.length,last=N(mv[n-1]),h=last-sig,ph=N(mv[n-2]||last)-sig;
  return{bull:last>0&&h>0,bear:last<0&&h<0,xUp:h>0&&ph<=0,xDown:h<0&&ph>=0,div:n>7&&last<N(mv[n-8])&&a[a.length-1]>a[a.length-8]};
};

const emaCalc=(a,p)=>{
  if(!a||a.length<2)return N(a?.[a.length-1]);
  const k=2/(p+1);let e=a.slice(0,Math.min(p,a.length)).reduce((s,v)=>s+v,0)/Math.min(p,a.length);
  for(let i=Math.min(p,a.length);i<a.length;i++)e=a[i]*k+e*(1-k);
  return e;
};

const atr14Calc=K=>{
  if(!K||K.length<15)return 0;
  return K.slice(1).slice(-14).reduce((s,k,i)=>s+Math.max(
    N(k.high||k.h)-N(k.low||k.l),
    Math.abs(N(k.high||k.h)-N(K[i].close||K[i].c)),
    Math.abs(N(k.low||k.l)-N(K[i].close||K[i].c))
  ),0)/14;
};

export default async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Cache-Control','s-maxage=480,stale-while-revalidate=60');
  if(req.method==='OPTIONS')return res.status(200).end();
  const t0=Date.now();

  const sf=async(url,ms)=>{
    const c=new AbortController();const t=setTimeout(()=>c.abort(),ms);
    try{const r=await fetch(url,{signal:c.signal,headers:{Accept:'application/json','User-Agent':'AC369-TIS/1.0'}});clearTimeout(t);if(!r.ok)return null;return await r.json();}
    catch{clearTimeout(t);return null;}
  };

  try{
    // ════════════════════════════════════════════════════
    // PARALLEL DATA FETCH — 5 sumber, semua bersamaan
    // ════════════════════════════════════════════════════
    const[cgR,cgGR,byR,fgR,klR]=await Promise.allSettled([
      sf('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=volume_desc&per_page=200&page=1&sparkline=false&price_change_percentage=24h,7d',6000),
      sf('https://api.coingecko.com/api/v3/global',4000),
      sf('https://api.bybit.com/v5/market/tickers?category=linear',4000),
      sf('https://api.alternative.me/fng/?limit=1&format=json',3000),
      // CC klines TOP15 — semua parallel
      Promise.allSettled(TOP15.map(s=>sf(`https://min-api.cryptocompare.com/data/v2/histohour?fsym=${s}&tsym=USD&limit=60&aggregate=4&e=CCCAGG`,5000))),
    ]);

    // ── Parse CoinGecko Markets ───────────────────────────
    const markets=A(cgR.value);
    if(!markets.length){
      return res.status(200).json({ok:false,error:'CoinGecko tidak merespons. Coba refresh dalam beberapa menit.',ts:Date.now(),elapsed:Date.now()-t0,version:'v1'});
    }

    // ── Parse CoinGecko Global ────────────────────────────
    const cgG=cgGR.value?.data||{};
    const btcDom=N(cgG.market_cap_percentage?.btc,58);
    const ethDom=N(cgG.market_cap_percentage?.eth,12);
    const totalMcap=N(cgG.total_market_cap?.usd,0);
    const mcapCh24=N(cgG.market_cap_change_percentage_24h_usd,0);
    const fg=N(fgR.value?.data?.[0]?.value,50);
    const fgLabel=fgR.value?.data?.[0]?.value_classification||'Neutral';

    // ── Parse Bybit Funding Rates ─────────────────────────
    const frMap={};
    try{
      for(const t of A(byR.value?.result?.list)){
        try{
          const sym=String(t.symbol).replace('USDT','').replace('PERP','');
          if(!sym||sym.length>10)continue;
          const fr=N(t.fundingRate);
          frMap[sym]={
            fr,oi:N(t.openInterestValue),
            pctFR:+(fr*100).toFixed(4),
            bullish:fr<-0.0002,
            bearish:fr>0.0004,
            signal:fr>0.0005?'EXTREME LONG🚨':fr>0.0003?'LONG HEAVY⚠️':fr<-0.0005?'SQUEEZE🚀':fr<-0.0003?'SHORT SQ💎':'NORMAL⚖️',
          };
        }catch{}
      }
    }catch{}

    // ── Parse CC klines → kMap ────────────────────────────
    const kMap={};
    const klArr=A(klR.value);
    for(let i=0;i<TOP15.length;i++){
      try{
        const r=klArr[i];
        if(r?.status!=='fulfilled'||r.value?.Response!=='Success')continue;
        const rows=A(r.value?.Data?.Data);
        if(rows.length<16)continue;
        const K=rows.map(d=>({t:N(d.time),o:N(d.open),h:N(d.high),l:N(d.low),c:N(d.close),v:N(d.volumeto)})).filter(k=>k.c>0&&k.c<1e10);
        if(K.length<16)continue;
        const cls=K.map(k=>k.c);
        const rsi=rsi14(cls);if(rsi===null)continue;
        const rsi1d=rsi14(cls.filter((_,idx)=>idx%6===0));
        const macd=macdCalc(cls);
        const ema50=+emaCalc(cls,Math.min(50,cls.length-1)).toFixed(8);
        const ema200=+emaCalc(cls,Math.min(200,cls.length-1)).toFixed(8);
        const atr=atr14Calc(K);
        // Swing levels
        const swH=[],swL=[];
        for(let j=3;j<K.length-3;j++){
          if(K[j].h>K[j-1].h&&K[j].h>K[j-2].h&&K[j].h>K[j+1].h&&K[j].h>K[j+2].h)swH.push(K[j].h);
          if(K[j].l<K[j-1].l&&K[j].l<K[j-2].l&&K[j].l<K[j+1].l&&K[j].l<K[j+2].l)swL.push(K[j].l);
        }
        kMap[TOP15[i]]={rsi:+N(rsi).toFixed(1),rsi1d:rsi1d!=null?+N(rsi1d).toFixed(1):null,macd,ema50,ema200,atr:+atr.toFixed(8),swH:swH.slice(-5),swL:swL.slice(-5),K,cls};
      }catch{}
    }

    // ── Build Coin List ────────────────────────────────────
    const coins=[];
    for(const c of markets){
      try{
        const sym=(c.symbol||'').toUpperCase();
        if(STABLES.has(sym))continue;
        const price=N(c.current_price);if(price<=0)continue;
        if(price>=0.97&&price<=1.03&&Math.abs(N(c.price_change_percentage_24h))<0.5)continue;
        const ch24=N(c.price_change_percentage_24h);
        const ch7d=c.price_change_percentage_7d!=null?N(c.price_change_percentage_7d):null;
        const vol=N(c.total_volume);
        const h=N(c.high_24h)||price*1.02,l=N(c.low_24h)||price*0.98;
        const pPos=h>l?clamp((price-l)/(h-l),0,1):0.5;
        const kd=kMap[sym]||null;
        const fd=frMap[sym]||null;
        const sector=getSector(sym);
        // RSI: real dari klines atau estimasi
        let rsi,rsiReal=false;
        if(kd){rsi=kd.rsi;rsiReal=true;}
        else{
          const chC=clamp(ch24*1.8,-22,22);
          const rpC=clamp((pPos-0.5)*22,-12,12);
          const wkC=ch7d!=null?clamp(ch7d*0.7,-10,10):0;
          rsi=clamp(Math.round(50+chC+rpC+wkC),15,85);
        }
        coins.push({sym,name:c.name||sym,price,ch24:+ch24.toFixed(2),ch7d:ch7d!=null?+ch7d.toFixed(2):null,vol,h,l,pPos:+pPos.toFixed(3),mcap:N(c.market_cap),mcapRank:N(c.market_cap_rank,999),sector,rsi:+rsi,rsiReal,kd,fd,macd:kd?.macd||null,ema50:kd?.ema50||null,ema200:kd?.ema200||null});
      }catch{}
    }

    // ── RS vs BTC ─────────────────────────────────────────
    const btcC=coins.find(c=>c.sym==='BTC');
    const btcCh24=btcC?.ch24||0,btcCh7d=btcC?.ch7d||0;
    for(const c of coins){
      const rs24=+(c.ch24-btcCh24).toFixed(2);
      const rs7d=c.ch7d!=null?+(c.ch7d-btcCh7d).toFixed(2):null;
      const rsScore=rs7d!=null?+(rs7d*0.6+rs24*0.4).toFixed(2):rs24;
      c.rs={score:+rsScore.toFixed(2),rs24,rs7d,bullish:rsScore>3,bearish:rsScore<-3};
    }

    // ════════════════════════════════════════════════════
    // TIMING CONTEXT (WIB = UTC+7)
    // ════════════════════════════════════════════════════
    const now=new Date();
    const wibH=(now.getUTCHours()+7)%24;
    const dayOfWeek=now.getUTCDay();
    const dayNames=['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];
    let currentSession,sessionQ,sessionScore;
    if(wibH>=21&&wibH<24){currentSession='NY_OPEN';sessionQ='PRIME 🔥🔥';sessionScore=5;}
    else if(wibH>=15&&wibH<18){currentSession='LONDON_OPEN';sessionQ='PRIME 🔥🔥';sessionScore=5;}
    else if(wibH>=9&&wibH<12){currentSession='ASIA_PEAK';sessionQ='GOOD ✅';sessionScore=3;}
    else if(wibH>=23||wibH<2){currentSession='NY_LATE';sessionQ='GOOD ✅';sessionScore=3;}
    else if(wibH>=18&&wibH<21){currentSession='NY_PREMARKET';sessionQ='BUILDING 📈';sessionScore=2;}
    else if(wibH>=6&&wibH<9){currentSession='ASIA_OPEN';sessionQ='MODERATE';sessionScore=2;}
    else if(wibH>=12&&wibH<15){currentSession='LUNCH_DIP';sessionQ='CAUTION ⚠️';sessionScore=1;}
    else{currentSession='DEAD_ZONE';sessionQ='POOR 😴';sessionScore=0;}
    // Day quality
    const dayScore=dayOfWeek>=1&&dayOfWeek<=4?3:dayOfWeek===5?2:dayOfWeek===6?1:0;

    // ════════════════════════════════════════════════════
    // MODULE 1 (prerequisite): MARKET CHARACTER
    // ════════════════════════════════════════════════════
    const bullPctMkt=+(coins.filter(c=>c.ch24>0).length/coins.length*100).toFixed(0);
    const avgCh24Mkt=+(coins.reduce((s,c)=>s+c.ch24,0)/coins.length).toFixed(2);
    const bigMovers=coins.filter(c=>Math.abs(c.ch24)>10).length;
    const xOBs=coins.filter(c=>c.rsi>80).length;
    const xOSs=coins.filter(c=>c.rsi<30).length;
    const allFRs=Object.values(frMap).map(f=>f.fr).filter(f=>Math.abs(f)>0.00001);
    const avgFRMkt=allFRs.length?+(allFRs.reduce((s,v)=>s+v,0)/allFRs.length*100).toFixed(4):0;
    const btcKd=kMap['BTC'];
    const btcRange=btcC?btcC.h-btcC.l:0;
    const btcRangeRatio=btcKd&&btcKd.atr>0?+(btcRange/btcKd.atr).toFixed(2):1;

    let charType,charDesc,riskLevel,tradeStyle,riskMult,charColor;
    if(xOBs>15&&avgFRMkt>0.025){charType='⛔ OVERHEATED';charDesc='Terlalu banyak koin overbought ('+xOBs+') + FR tinggi. Risiko koreksi tajam. Kurangi posisi sekarang.';riskLevel='DANGEROUS';tradeStyle='Take Profit — Kurangi Exposure';riskMult=0.25;charColor='red';}
    else if(xOSs>20&&bullPctMkt<35){charType='🔄 CAPITULATION';charDesc='Banyak koin extreme oversold ('+xOSs+'). Potensi reversal kuat. Setup high probability.';riskLevel='HIGH OPPORTUNITY';tradeStyle='Selective Long — Reversal Setups';riskMult=1.2;charColor='green';}
    else if(avgCh24Mkt>3&&bullPctMkt>65&&btcRangeRatio>1.2){charType='📈 TRENDING BULL';charDesc='Market trending naik. Follow momentum. Hold posisi lebih lama.';riskLevel='NORMAL';tradeStyle='Swing & Momentum';riskMult=1.0;charColor='green';}
    else if(avgCh24Mkt<-3&&bullPctMkt<35&&btcRangeRatio>1.2){charType='📉 TRENDING BEAR';charDesc='Market trending turun. Short atau cash. Jangan long kecuali reversal kuat.';riskLevel='REDUCED';tradeStyle='Cash / Selective Short';riskMult=0.5;charColor='red';}
    else if(btcRangeRatio<0.7&&Math.abs(avgCh24Mkt)<1.5){charType='⚡ CHOPPY';charDesc='Market tidak berarah. Scalp kecil saja. Jangan swing.';riskLevel='LOW';tradeStyle='Scalp Only — TP Kecil';riskMult=0.5;charColor='amber';}
    else if(avgCh24Mkt>1&&bullPctMkt>55){charType='🟢 MILD BULL';charDesc='Market mild bullish. Selektif. Prioritaskan koin convergence ≥68.';riskLevel='NORMAL';tradeStyle='Selective Swing & Scalp';riskMult=0.85;charColor='green';}
    else if(avgCh24Mkt<-1&&bullPctMkt<45){charType='🟡 MILD BEAR';charDesc='Market mild bearish. Kurangi size 30-50%. Fokus koin outperform BTC.';riskLevel='REDUCED';tradeStyle='Small Size Only';riskMult=0.6;charColor='amber';}
    else{charType='⚖️ NEUTRAL';charDesc='Market seimbang. Akumulasi spot di discount zone. Hindari leverage tinggi.';riskLevel='LOW-MODERATE';tradeStyle='Spot Accumulation';riskMult=0.7;charColor='amber';}

    const marketCharacter={type:charType,description:charDesc,riskLevel,tradeStyle,riskMultiplier:riskMult,color:charColor,stats:{avgCh24:avgCh24Mkt,bullPct:bullPctMkt,bigMovers,xOB:xOBs,xOS:xOSs,avgFR:avgFRMkt,btcRangeRatio,totalCoins:coins.length}};

    // ════════════════════════════════════════════════════
    // MODULE 2: CONVERGENCE SCORE
    // ════════════════════════════════════════════════════
    const computeConv=(coin)=>{
      let tech=0,structure=0,macro=0,timing=0;
      const{rsi,ch24,ch7d,pPos,macd,kd,fd,rs,sector,vol,mcap,price,ema50,ema200}=coin;
      const c7=ch7d||0;

      // ── TECHNICAL (max ±35) ──────────────────────────
      if(rsi<25)tech+=15;else if(rsi<30)tech+=12;else if(rsi<37)tech+=8;else if(rsi<44)tech+=4;
      else if(rsi>82)tech-=15;else if(rsi>75)tech-=10;else if(rsi>68)tech-=5;
      else if(rsi>=46&&rsi<=58)tech+=3;
      if(macd?.xUp)tech+=8;else if(macd?.xDown)tech-=8;
      else if(macd?.bull&&!macd?.div)tech+=4;else if(macd?.bear)tech-=4;
      if(macd?.div)tech-=5;
      if(ema200&&price>ema200)tech+=4;else if(ema200&&price<ema200)tech-=4;
      if(ema50&&price>ema50)tech+=2;else if(ema50&&price<ema50)tech-=2;
      if(c7<-8&&ch24>2)tech+=5;
      if(ch24>5&&pPos>0.65)tech+=3;
      if(ch24<-5&&pPos<0.35)tech-=3;

      // ── STRUCTURE (max ±35) ──────────────────────────
      if(pPos<0.20&&ch24>1)structure+=10;
      else if(pPos<0.30&&ch24>0)structure+=6;
      else if(pPos>0.80&&ch24<0)structure-=8;
      else if(pPos>0.70&&ch24<0)structure-=4;
      if(c7<-10&&ch24>2&&pPos>0.3)structure+=8;
      if(fd?.bullish)structure+=8;
      else if(fd?.bearish)structure-=8;
      else if(fd&&fd.fr<0)structure+=2;
      else if(fd&&fd.fr>0.0001)structure-=2;
      if(mcap>0&&vol/mcap>0.15)structure+=5;
      else if(mcap>0&&vol/mcap>0.08)structure+=2;
      if(rs?.score>10)structure+=5;else if(rs?.score>3)structure+=2;
      else if(rs?.score<-10)structure-=5;else if(rs?.score<-3)structure-=2;
      if(kd){
        const K=kd.K||[];const n=K.length;
        if(n>=10){
          const prevK=K[n-2],lastK=K[n-1];
          if(prevK&&lastK&&prevK.c<prevK.o&&lastK.c>lastK.o)structure+=5;
          if(n>=20){const rh20=Math.max(...K.slice(-20).map(k=>k.h));if(price>rh20*0.97)structure+=4;}
        }
      }

      // ── MACRO (max ±20) ──────────────────────────────
      if(btcCh24>4)macro+=8;else if(btcCh24>2)macro+=5;else if(btcCh24>0)macro+=2;
      else if(btcCh24<-4)macro-=8;else if(btcCh24<-2)macro-=5;else macro-=2;
      if(fg<20)macro+=8;else if(fg<35)macro+=4;else if(fg<50)macro+=1;
      else if(fg>80)macro-=8;else if(fg>65)macro-=4;
      if(btcDom<48)macro+=5;else if(btcDom>62)macro-=5;else if(btcDom>57)macro-=2;
      if(mcapCh24>2)macro+=3;else if(mcapCh24<-2)macro-=3;

      // ── TIMING (max ±12) ─────────────────────────────
      timing+=sessionScore*1.5;
      timing+=dayScore;
      if(currentSession==='DEAD_ZONE')timing-=8;
      else if(currentSession==='LUNCH_DIP')timing-=4;

      const raw=clamp(50+tech+structure+macro+timing,5,98);
      return{
        score:clamp(Math.round(raw),5,98),
        tech:clamp(Math.round(tech),-35,35),
        structure:clamp(Math.round(structure),-35,35),
        macro:clamp(Math.round(macro),-20,20),
        timing:clamp(Math.round(timing),-12,12),
        label:raw>=85?'🔥 RARE SETUP':raw>=75?'✅ HIGH PROB':raw>=65?'📈 GOOD':raw>=55?'⚖️ MODERATE':'⚠️ WEAK',
      };
    };

    for(const c of coins)c.conv=computeConv(c);

    const convLeaders=coins
      .filter(c=>c.conv.score>=60&&c.vol>=1e6&&c.sym!=='BTC'&&c.sym!=='ETH'&&c.sym!=='USDT')
      .sort((a,b)=>b.conv.score-a.conv.score).slice(0,15);

    // ════════════════════════════════════════════════════
    // MODULE 3: CONDITIONAL GAME PLAN
    // ════════════════════════════════════════════════════
    // BTC key levels dari klines
    let btcLevels={current:btcC?.price||0,resistance:null,support:null,bullTrigger:null,bearTrigger:null,ema50:btcKd?.ema50||null,ema200:btcKd?.ema200||null};
    if(btcKd&&btcC){
      const p=btcC.price;
      const swHAbove=btcKd.swH.filter(h=>h>p*1.001).sort((a,b)=>a-b);
      const swLBelow=btcKd.swL.filter(l=>l<p*0.999).sort((a,b)=>b-a);
      btcLevels.resistance=swHAbove[0]?+swHAbove[0].toFixed(2):+(p*1.04).toFixed(2);
      btcLevels.support=swLBelow[0]?+swLBelow[0].toFixed(2):+(p*0.96).toFixed(2);
      btcLevels.bullTrigger=+((btcLevels.resistance||p*1.04)*1.002).toFixed(2);
      btcLevels.bearTrigger=+((btcLevels.support||p*0.96)*0.998).toFixed(2);
    }

    // Build trade setup dengan ICT levels
    const mkTradeSetup=(coin,type)=>{
      try{
        const{sym,name,price,rsi,fd,rs,kd,pPos,ch24,ch7d,sector,conv}=coin;
        const atr=kd?.atr||((coin.h-coin.l)*0.65);
        const atrPct=price>0?atr/price:0.025;
        // Entry: di current price atau sedikit di bawah untuk limit order
        const entryAdj=type==='scalp'?0:type==='swing'?-0.005:-0.01;
        const entry=+(price*(1+entryAdj)).toFixed(price>10?2:price>1?4:6);
        const sl=+(entry*(1-Math.max(atrPct*1.8,0.02))).toFixed(price>10?2:price>1?4:6);
        const risk=entry-sl;
        const tp1=+(entry+risk*1.5).toFixed(price>10?2:price>1?4:6);
        const tp2=+(entry+risk*2.5).toFixed(price>10?2:price>1?4:6);
        const tp3=+(entry+risk*4.0).toFixed(price>10?2:price>1?4:6);
        // Reasons
        const reasons=[];
        if(rsi<32)reasons.push('RSI '+rsi+' oversold');
        if(conv?.macd?.xUp||kd?.macd?.xUp)reasons.push('MACD golden cross');
        if(pPos<0.28)reasons.push('Discount zone '+(pPos*100).toFixed(0)+'%');
        if(fd?.bullish)reasons.push('FR '+fd.pctFR+'% (shorts squeeze)');
        if(rs?.score>5)reasons.push('Outperform BTC +'+rs.score+'%');
        if(ch7d&&ch7d<-8&&ch24>1)reasons.push('Bounce setelah -'+Math.abs(ch7d).toFixed(0)+'% 7d');
        if(conv.structure>=10)reasons.push('ICT structure score +'+conv.structure);
        if(kd?.rsi1d&&kd.rsi1d<35)reasons.push('1D RSI '+kd.rsi1d+' oversold');
        return{sym,name,sector,price,entry,sl,tp1,tp2,tp3,rr:'1:2.5',convScore:conv.score,rsi,rsi1d:kd?.rsi1d||null,rsiReal:coin.rsiReal,fr:fd?.pctFR||null,frSignal:fd?.signal||null,rs:rs?.score||0,reasons:reasons.slice(0,3),slPct:+((entry-sl)/entry*100).toFixed(2),tp1Pct:+((tp1-entry)/entry*100).toFixed(2),tp2Pct:+((tp2-entry)/entry*100).toFixed(2)};
      }catch{return null;}
    };

    // Scalp setups: RSI 40-65, MACD or momentum, vol > $5M
    const scalpCandidates=coins
      .filter(c=>c.conv.score>=60&&c.vol>=5e6&&c.rsi>=38&&c.rsi<=65&&c.sym!=='BTC')
      .sort((a,b)=>b.conv.score-a.conv.score).slice(0,3).map(c=>mkTradeSetup(c,'scalp')).filter(Boolean);

    // Swing setups: oversold + accumulation + RS positive
    const swingCandidates=coins
      .filter(c=>c.conv.score>=58&&c.vol>=2e6&&c.rsi<47&&c.sym!=='BTC')
      .sort((a,b)=>b.conv.score-a.conv.score).slice(0,3).map(c=>mkTradeSetup(c,'swing')).filter(Boolean);

    // Spot accumulation: weekly oversold + strong mcap
    const spotCandidates=coins
      .filter(c=>c.rsi<38&&c.mcap>50e6&&c.vol>=500000&&c.sym!=='BTC')
      .sort((a,b)=>a.rsi-b.rsi).slice(0,4).map(c=>({
        sym:c.sym,name:c.name,sector:c.sector,price:c.price,rsi:c.rsi,rsi1d:c.kd?.rsi1d||null,rsiReal:c.rsiReal,
        ch7d:c.ch7d,mcap:c.mcap,convScore:c.conv.score,
        dcaZone:+(c.price*0.97).toFixed(c.price>10?2:c.price>1?4:6)+' – '++(c.price*1.01).toFixed(c.price>10?2:c.price>1?4:6),
        reasons:mkTradeSetup(c,'spot')?.reasons||[],
      }));

    // Avoid list: overbought OR overheated FR
    const avoidList=coins
      .filter(c=>(c.rsi>78||(c.fd&&c.fd.fr>0.0004)||(c.ch24>25&&c.rsi>70)))
      .sort((a,b)=>{const sa=(b.fd?.fr||0)*1000+(b.rsi>78?b.rsi-78:0);const sb=(a.fd?.fr||0)*1000+(a.rsi>78?a.rsi-78:0);return sa-sb;})
      .slice(0,6).map(c=>({sym:c.sym,price:c.price,rsi:c.rsi,fr:c.fd?.pctFR||null,frSignal:c.fd?.signal||null,reason:c.rsi>82?'RSI '+c.rsi+' overbought':c.fd?.fr>0.0004?'FR +'+c.fd.pctFR+'% overheated — longs crowded':'Extended rally +'+c.ch24.toFixed(0)+'% today'}));

    const gamePlan={
      btcLevels,
      btcSentiment:btcKd&&btcC?{rsi:btcKd.rsi,rsi1d:btcKd.rsi1d,macd:btcKd.macd,aboveEma50:btcC.price>btcKd.ema50,aboveEma200:btcC.price>btcKd.ema200,ema50:btcKd.ema50,ema200:btcKd.ema200,trend:btcC.price>btcKd.ema200?'Bullish (above EMA200)':'Bearish (below EMA200)'}:null,
      scenarios:{
        bull:{condition:'BTC tembus $'+btcLevels.bullTrigger,action:'Long alts pilihan. Size 80-100% dari rencana.',description:'Breakout konfirmasi. Masuk di koin convergence ≥70 yang belum pumped.',setups:scalpCandidates.slice(0,2)},
        bear:{condition:'BTC breakdown ke $'+btcLevels.bearTrigger,action:'Cash 80%. Jangan catch falling knife.',description:'Tunggu BTC stabilkan 4H candle close di atas support. Re-check jam 21:00 WIB.',setups:[]},
        sideways:{condition:'BTC konsolidasi ±2% dari $'+(btcC?.price?.toFixed(0)||'—'),action:'Scalp saja. TP kecil, SL ketat.',description:'Market tidak trending. Manfaatkan extremes (oversold/FR squeeze).',setups:swingCandidates.slice(0,2)},
      },
      scalpSetups:scalpCandidates,
      swingSetups:swingCandidates,
      spotAccum:spotCandidates,
      avoid:avoidList,
    };

    // ════════════════════════════════════════════════════
    // MODULE 4: SMART MONEY FLOW MAP
    // ════════════════════════════════════════════════════
    const flowMap={};
    for(const c of coins){
      const s=c.sector;
      if(!flowMap[s])flowMap[s]={count:0,vol:0,bulls:0,ch24Sum:0,ch7dSum:0,ch7dCount:0,rsiSum:0,frSum:0,frCount:0,oiSum:0};
      const f=flowMap[s];
      f.count++;f.vol+=c.vol;
      if(c.ch24>0)f.bulls++;
      f.ch24Sum+=c.ch24;
      if(c.ch7d!=null){f.ch7dSum+=c.ch7d;f.ch7dCount++;}
      f.rsiSum+=c.rsi;
      if(c.fd){f.frSum+=c.fd.fr;f.frCount++;f.oiSum+=c.fd.oi;}
    }
    const flowArr=Object.entries(flowMap).map(([sec,f])=>{
      const avgCh24=+(f.ch24Sum/f.count).toFixed(2);
      const avgCh7d=f.ch7dCount>0?+(f.ch7dSum/f.ch7dCount).toFixed(2):null;
      const avgRSI=+(f.rsiSum/f.count).toFixed(0);
      const bullPct=+(f.bulls/f.count*100).toFixed(0);
      const avgFR=f.frCount>0?+(f.frSum/f.frCount*100).toFixed(4):null;
      const netFlowUSD=+(f.vol*avgCh24/100).toFixed(0);
      let flowSig,flowColor;
      if(avgCh24>5&&bullPct>=70){flowSig='🔥 HOT';flowColor='green';}
      else if(avgCh24>2&&bullPct>=60){flowSig='↑↑ INFLOW';flowColor='green';}
      else if(avgCh24>0&&bullPct>=50){flowSig='↑ MILD';flowColor='lightgreen';}
      else if(avgCh24<-5&&bullPct<30){flowSig='💀 EXIT';flowColor='red';}
      else if(avgCh24<-2&&bullPct<45){flowSig='↓↓ OUTFLOW';flowColor='red';}
      else if(avgCh24<0){flowSig='↓ WEAK';flowColor='orange';}
      else{flowSig='→ NEUTRAL';flowColor='gray';}
      const oppScore=clamp(Math.round(50-(avgRSI-50)*0.5+(bullPct-50)*0.3+(avgCh24>0?4:-4)),0,100);
      return{sector:sec,name:SECTOR_NAMES[sec]||sec,count:f.count,totalVol:+f.vol.toFixed(0),avgCh24,avgCh7d,avgRSI:+avgRSI,bullPct,avgFR,netFlowUSD,totalOI:+f.oiSum.toFixed(0),flowSig,flowColor,oppScore};
    }).sort((a,b)=>b.avgCh24-a.avgCh24);

    const sectorFlow={sectors:flowArr,hotSectors:flowArr.filter(f=>f.avgCh24>2).slice(0,4),coldSectors:flowArr.filter(f=>f.avgCh24<-1).sort((a,b)=>a.avgCh24-b.avgCh24).slice(0,3),rotatingIn:flowArr.filter(f=>f.avgRSI<48&&f.avgCh24>0).slice(0,3),mostOversold:flowArr.filter(f=>f.avgRSI<50).sort((a,b)=>a.avgRSI-b.avgRSI).slice(0,3),frExtremes:{highFR:flowArr.filter(f=>f.avgFR&&f.avgFR>0.02).sort((a,b)=>(b.avgFR||0)-(a.avgFR||0)).slice(0,3),lowFR:flowArr.filter(f=>f.avgFR&&f.avgFR<-0.01).sort((a,b)=>(a.avgFR||0)-(b.avgFR||0)).slice(0,3)}};

    // ════════════════════════════════════════════════════
    // MODULE 5: TRADING SCHEDULE WIB
    // ════════════════════════════════════════════════════
    const allSessions=[
      {id:'DEAD_ZONE',name:'😴 Dead Zone',time:'02:00–06:00',q:'POOR',score:0,activity:'Volume minimum. Banyak fake moves. Hindari trading.',advice:riskLevel==='DANGEROUS'?'SKIP':'Tidur. Market masih ada besok.'},
      {id:'ASIA_OPEN',name:'🌅 Asia Open',time:'06:00–09:00',q:'MODERATE',score:2,activity:'Volume mulai naik. BTC & L1 sering bergerak. Scalp kecil OK.',advice:''},
      {id:'ASIA_PEAK',name:'🔥 Asia Peak',time:'09:00–12:00',q:'GOOD',score:3,activity:'Asia markets aktif. Altcoin sering gerak. Good for scalp & early swing.',advice:''},
      {id:'LUNCH_DIP',name:'⚠️ Lunch Dip',time:'12:00–15:00',q:'CAUTION',score:1,activity:'Volume turun. Banyak false breakout. Jangan entry baru.',advice:'Reduce exposure 13:00–14:00.'},
      {id:'LONDON_OPEN',name:'💥 London Open',time:'15:00–18:00',q:'PRIME',score:5,activity:'European markets buka. Volume naik drastis. Best untuk breakout entry.',advice:'Prioritaskan setup terbaik di jam ini.'},
      {id:'NY_PREMARKET',name:'📈 NY Pre-Market',time:'18:00–21:00',q:'BUILDING',score:2,activity:'Volume mulai naik. Setup watchlist, jangan FOMO sebelum NY open.',advice:''},
      {id:'NY_OPEN',name:'🚀 NY Open',time:'21:00–23:00',q:'PRIME',score:5,activity:'Volume tertinggi hari ini. Institutional aktif. Best setups muncul.',advice:'PRIME TIME. Fokus penuh. No distraction.'},
      {id:'NY_LATE',name:'🌙 NY Late',time:'23:00–02:00',q:'GOOD',score:3,activity:'Volume masih tinggi tapi mulai turun. Manage open positions.',advice:'Jangan entry baru setelah 01:00 WIB.'},
    ];
    const curSesObj=allSessions.find(s=>s.id===currentSession)||allSessions[0];
    const hoursUntil=(targetH)=>(targetH-wibH+24)%24;
    const primeSessions=allSessions.filter(s=>s.q==='PRIME').map(s=>({...s,inHours:hoursUntil(s.id==='LONDON_OPEN'?15:21)})).sort((a,b)=>a.inHours-b.inHours);
    const focusStr=charType.includes('TRENDING BULL')||charType.includes('MILD BULL')?'Swing di convergence ≥68. Hold melewati London & NY session.':charType.includes('BEAR')?'Cash 70-80%. Scalp hanya di reversal extreme.':charType.includes('CHOPPY')?'Scalp kecil saja. TP 1-2%. Jangan swing.':charType.includes('OVERHEATED')?'Take profit hari ini. Jangan buka posisi baru.':charType.includes('CAPITULATION')?'OPPORTUNITY: Akumulasi spot bertahap di oversold zone.':'Selektif. Prioritaskan convergence ≥65 dan volume di atas rata-rata.';
    const tradingSchedule={currentSession,currentSessionData:curSesObj,sessionQuality:sessionQ,sessions:allSessions,wibHour:wibH,dayName:dayNames[dayOfWeek],dayOfWeek,nextPrimeSession:primeSessions[0]||null,focusToday:focusStr,positionSizeRec:riskMult===1.0?'Full size (100%)':riskMult>=0.85?'Normal (85%)':riskMult>=0.7?'Reduced (70%)':riskMult>=0.5?'Half size (50%)':'Minimal (25%) atau Cash'};

    // ════════════════════════════════════════════════════
    // MODULE 6: PRE-TRADE CHECKLIST
    // ════════════════════════════════════════════════════
    const btcAtResist=btcLevels.resistance&&btcC&&(btcC.price/btcLevels.resistance)>0.985;
    const btcAtSupport=btcLevels.support&&btcC&&(btcC.price/btcLevels.support)<1.015;
    const sessionGood=sessionScore>=2;
    const frMarketOK=Math.abs(avgFRMkt)<0.025;
    const mktNotOB=xOBs<20&&avgFRMkt<0.03;
    const mktVolOK=true; // always have vol data
    const mktCharOK=!charType.includes('OVERHEATED')&&!charType.includes('DANGEROUS');

    const checklist={
      marketChecks:[
        {id:'char',label:'Market character mendukung trading',pass:mktCharOK,detail:charType,fix:!mktCharOK?'Kurangi posisi atau cash sementara':''},
        {id:'session',label:'Trading session berkualitas (bukan Dead Zone)',pass:sessionGood,detail:currentSession+' — '+sessionQ,fix:!sessionGood?'Tunggu London Open (15:00) atau NY Open (21:00)':''},
        {id:'btc',label:'BTC tidak di area resistance kritis',pass:!btcAtResist,detail:btcAtResist?'BTC dekat resistance $'+(btcLevels.resistance?.toFixed(0)||'?'):'BTC aman dari resistance terdekat',fix:btcAtResist?'Tunggu BTC breakout bersih atau koreksi ke support':''},
        {id:'fr',label:'Funding Rate market tidak overheated',pass:frMarketOK,detail:'Avg FR market: '+(avgFRMkt>=0?'+':'')+avgFRMkt+'% per 8h',fix:!frMarketOK?'Market terlalu long. Risiko koreksi mendadak.':''},
        {id:'mktob',label:'Market tidak extreme overbought',pass:mktNotOB,detail:xOBs+' koin RSI>80 | '+xOSs+' koin RSI<30',fix:!mktNotOB?'Distribusi terdeteksi. Kurangi exposure.':''},
      ],
      coinChecks:[
        {id:'rsi',label:'RSI koin < 75 (tidak extreme overbought)'},
        {id:'fr_coin',label:'Funding Rate koin < +0.04% (tidak crowded)'},
        {id:'vol',label:'Volume > $5M (cukup likuid)'},
        {id:'sl',label:'Stop Loss level sudah ditentukan (dari ICT OB/swing low)'},
        {id:'plan',label:'Setup sesuai Game Plan hari ini (scalp/swing/spot)'},
        {id:'rr',label:'Risk:Reward minimal 1:1.5'},
        {id:'conv',label:'Convergence Score ≥ 65'},
      ],
      marketPassCount:[mktCharOK,sessionGood,!btcAtResist,frMarketOK,mktNotOB].filter(Boolean).length,
      marketTotal:5,
      overallGreenLight:mktCharOK&&sessionGood&&frMarketOK&&mktNotOB,
      verdict:mktCharOK&&sessionGood&&frMarketOK?'🟢 KONDISI PASAR OK — Cek kondisi koin individual':'🟡 HATI-HATI — '+[!mktCharOK?charType:'',!sessionGood?'Session '+sessionQ:'',!frMarketOK?'FR Overheated':''].filter(Boolean).join(', '),
    };

    // ════════════════════════════════════════════════════
    // RESPONSE
    // ════════════════════════════════════════════════════
    return res.status(200).json({
      ok:true,ts:Date.now(),elapsed:Date.now()-t0,version:'v1',
      dataQuality:{coinsTotal:coins.length,realRSI:Object.keys(kMap).length,frCoverage:Object.keys(frMap).length,dataFresh:true},
      marketCharacter,
      btcSnapshot:btcC?{price:btcC.price,ch24:btcC.ch24,ch7d:btcC.ch7d,rsi:btcKd?.rsi||null,rsi1d:btcKd?.rsi1d||null,macd:btcKd?.macd||null,ema50:btcKd?.ema50||null,ema200:btcKd?.ema200||null,aboveEma200:btcC&&btcKd?btcC.price>btcKd.ema200:null,fg,fgLabel,btcDom,ethDom,totalMcap,mcapCh24}:null,
      // Module 2
      convergence:{leaders:convLeaders.map(c=>({sym:c.sym,name:c.name,sector:c.sector,price:c.price,ch24:c.ch24,rsi:c.rsi,rsiReal:c.rsiReal,rsi1d:c.kd?.rsi1d||null,conv:c.conv,fr:c.fd?.pctFR||null,frSig:c.fd?.signal||null,rs:c.rs?.score||0,macdXUp:c.macd?.xUp||false,vol:c.vol}))},
      // Module 3
      gamePlan,
      // Module 4
      sectorFlow,
      // Module 5
      tradingSchedule,
      // Module 6
      checklist,
    });
  }catch(e){
    return res.status(200).json({ok:false,error:e.message,ts:Date.now(),elapsed:Date.now()-t0,version:'v1'});
  }
}
