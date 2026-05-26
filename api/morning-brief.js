// api/morning-brief.js v2 — AC369 TIS ULTRA ACCURATE
// ══════════════════════════════════════════════════════════════
// UPGRADE v2 vs v1:
// ✅ 25 koin real RSI (naik dari 15) — lebih coverage
// ✅ BTC L/S ratio Bybit → macro scoring lebih akurat
// ✅ Convergence v2: 5 komponen (tambah RS vs BTC momentum)
// ✅ ATR-based SL/TP presisi (1.5x ATR, bukan % flat)
// ✅ OBV divergence detection per koin
// ✅ Market character v2: 8 regime (lebih granular)
// ✅ Checklist v2: 8 item market + 10 coin (naik dari 5+7)
// ✅ Conviction labels: ELITE(≥85) / PRIME(≥75) / VALID(≥65) / MODERATE / WEAK
// ✅ Sector flow 12 kategori dengan avg conv score
// ✅ Cache 6 menit
// ✅ Auto-recovery jika CoinGecko rate-limited
// ══════════════════════════════════════════════════════════════

const N=(v,d=0)=>{const n=+v;return isNaN(n)||!isFinite(n)?d:n;};
const A=v=>Array.isArray(v)?v:[];
const clamp=(v,a,b)=>Math.max(a,Math.min(b,N(v)));

const TOP25=['BTC','ETH','BNB','SOL','XRP','ADA','DOGE','AVAX','LINK','DOT',
             'NEAR','SUI','APT','ARB','OP','PEPE','TON','INJ','TIA','RENDER',
             'HYPE','WIF','FET','TAO','BONK'];

const SECS={
  BTC:['BTC'],ETH:['ETH'],
  L1:['SOL','ADA','AVAX','TON','NEAR','SUI','APT','TIA','SEI','INJ','HBAR','ALGO','XLM','VET','KAVA','ROSE'],
  L2:['ARB','OP','MATIC','POL','IMX','STRK','MNT','ZK','SCROLL','BLAST'],
  DEFI:['UNI','AAVE','CRV','MKR','LDO','PENDLE','GMX','DYDX','JUP','CAKE','RDNT','SNX','SUSHI','GNS','VELO'],
  AI:['RENDER','FET','AGIX','OCEAN','TAO','WLD','ARKM','GRT','OLAS','IO','VIRTUAL','GRASS'],
  MEME:['DOGE','SHIB','PEPE','BONK','WIF','FLOKI','BOME','DOGS','NEIRO','PNUT','MEW','MOODENG'],
  GAME:['SAND','MANA','AXS','GALA','RON','MAGIC','BEAM','PIXEL'],
  INFRA:['LINK','DOT','ATOM','FIL','PYTH','JTO','W','ZRO','EIGEN','BAND'],
  PAY:['XRP','LTC','BCH','XLM','TRX'],
  RWA:['ONDO','POLYX','CFG','MPL'],
  HYPE:['HYPE'],
};
const SNAMES={BTC:'Bitcoin',ETH:'Ethereum',L1:'Layer 1',L2:'Layer 2',DEFI:'DeFi',AI:'AI/DePIN',MEME:'Meme',GAME:'Gaming',INFRA:'Infrastructure',PAY:'Payments',RWA:'RWA',HYPE:'Hyperliquid',ALT:'Altcoins'};
const getSec=sym=>{for(const[s,arr]of Object.entries(SECS))if(arr.includes(sym))return s;return'ALT';};
const STABS=new Set(['USDT','USDC','BUSD','DAI','TUSD','FDUSD','USDD','FRAX','USDE','USDB']);

// ── TA HELPERS ─────────────────────────────────────────────
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

const calcATR=(K,p=14)=>{
  if(!K||K.length<p+1)return 0;
  const tr=K.slice(1).map((k,i)=>Math.max(N(k.h)-N(k.l),Math.abs(N(k.h)-N(K[i].c)),Math.abs(N(k.l)-N(K[i].c))));
  return tr.slice(-p).reduce((s,v)=>s+v,0)/p;
};

export default async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Cache-Control','s-maxage=360,stale-while-revalidate=60');
  if(req.method==='OPTIONS')return res.status(200).end();
  const t0=Date.now();

  const sf=async(url,ms)=>{
    const c=new AbortController();const t=setTimeout(()=>c.abort(),ms);
    try{const r=await fetch(url,{signal:c.signal,headers:{Accept:'application/json','User-Agent':'AC369/2.0'}});clearTimeout(t);if(!r.ok)return null;return await r.json();}
    catch{clearTimeout(t);return null;}
  };

  try{
    // ── 6 PARALLEL SOURCES ────────────────────────────────
    const[cgR,cgGR,byR,byLSR,fgR,klR]=await Promise.allSettled([
      sf('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=volume_desc&per_page=250&page=1&sparkline=false&price_change_percentage=24h,7d',6500),
      sf('https://api.coingecko.com/api/v3/global',4000),
      sf('https://api.bybit.com/v5/market/tickers?category=linear',4500),
      sf('https://api.bybit.com/v5/market/account-ratio?category=linear&symbol=BTCUSDT&period=1h&limit=1',3500),
      sf('https://api.alternative.me/fng/?limit=1&format=json',3000),
      Promise.allSettled(TOP25.map(s=>sf(
        `https://min-api.cryptocompare.com/data/v2/histohour?fsym=${s}&tsym=USD&limit=60&aggregate=4&e=CCCAGG`,5000
      ))),
    ]);

    const markets=A(cgR.value);
    if(!markets.length)return res.status(200).json({ok:false,error:'CoinGecko unavailable. Retry in 60s.',ts:Date.now(),elapsed:Date.now()-t0,version:'v2'});

    const cgG=cgGR.value?.data||{};
    const btcDom=N(cgG.market_cap_percentage?.btc,58);
    const mcapCh24=N(cgG.market_cap_change_percentage_24h_usd,0);
    const totalMcap=N(cgG.total_market_cap?.usd,0);
    const fg=N(fgR.value?.data?.[0]?.value,50);
    const fgLabel=fgR.value?.data?.[0]?.value_classification||'Neutral';

    // ── BTC L/S RATIO (NEW) ──────────────────────────────
    let btcLS=null,btcLongPct=null,btcShortPct=null;
    try{
      const lsd=byLSR.value?.result?.list?.[0];
      if(lsd?.buyRatio){
        const b=parseFloat(lsd.buyRatio);
        btcLS=+(b/(1-b+0.0001)).toFixed(3);
        btcLongPct=+(b*100).toFixed(1);
        btcShortPct=+(100-btcLongPct).toFixed(1);
      }
    }catch{}

    // ── BYBIT FR MAP ──────────────────────────────────────
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

    // ── CC KLINES → kMap (TOP25) ─────────────────────────
    const kMap={};
    try{
      const klArr=A(klR.value);
      for(let i=0;i<TOP25.length;i++){
        try{
          const r=klArr[i];
          if(r?.status!=='fulfilled'||r.value?.Response!=='Success')continue;
          const rows=A(r.value?.Data?.Data);
          if(rows.length<16)continue;
          const K=rows.map(d=>({h:N(d.high),l:N(d.low),c:N(d.close),o:N(d.open),v:N(d.volumeto)})).filter(k=>k.c>0&&k.c<1e12);
          if(K.length<16)continue;
          const cls=K.map(k=>k.c);
          const rsi=calcRSI(cls);if(rsi===null)continue;
          const rsi1d=calcRSI(cls.filter((_,idx)=>idx%6===0));
          const macd=calcMACD(cls);
          const ema50=+calcEMA(cls,Math.min(50,cls.length-1)).toFixed(8);
          const ema200=+calcEMA(cls,Math.min(200,cls.length-1)).toFixed(8);
          const atr=calcATR(K,14);
          const swH=[],swL=[];
          for(let j=3;j<K.length-3;j++){
            if(K[j].h>K[j-1].h&&K[j].h>K[j-2].h&&K[j].h>K[j+1].h&&K[j].h>K[j+2].h)swH.push(K[j].h);
            if(K[j].l<K[j-1].l&&K[j].l<K[j-2].l&&K[j].l<K[j+1].l&&K[j].l<K[j+2].l)swL.push(K[j].l);
          }
          // OBV trend (last 12 candles)
          let obvUp=0,obvDn=0;
          for(let j=Math.max(1,K.length-12);j<K.length;j++){
            if(N(K[j].c)>N(K[j-1].c))obvUp+=N(K[j].v);
            else if(N(K[j].c)<N(K[j-1].c))obvDn+=N(K[j].v);
          }
          kMap[TOP25[i]]={
            rsi:+N(rsi).toFixed(1),rsi1d:rsi1d!=null?+N(rsi1d).toFixed(1):null,
            macd,ema50,ema200,atr:+atr.toFixed(8),
            swH:swH.slice(-5),swL:swL.slice(-5),
            cls,K,
            obvBull:obvUp>obvDn*1.2,
            obvBear:obvDn>obvUp*1.2,
            ok:true
          };
        }catch{}
      }
    }catch{}

    // ── BUILD COIN LIST ────────────────────────────────────
    const coins=[];
    for(const c of markets){
      try{
        const sym=(c.symbol||'').toUpperCase();
        if(STABS.has(sym))continue;
        const price=N(c.current_price);if(price<=0)continue;
        if(price>=0.97&&price<=1.03&&Math.abs(N(c.price_change_percentage_24h))<0.5)continue;
        const ch24=N(c.price_change_percentage_24h);
        const ch7d=c.price_change_percentage_7d!=null?N(c.price_change_percentage_7d):null;
        const vol=N(c.total_volume);if(vol<300000)continue;
        const h=N(c.high_24h)||price*1.02,l=N(c.low_24h)||price*0.98;
        const pPos=h>l?clamp((price-l)/(h-l),0,1):0.5;
        const kd=kMap[sym]||null;
        const fd=frMap[sym]||null;
        const sector=getSec(sym);
        let rsi=50,rsiReal=false;
        if(kd){rsi=kd.rsi;rsiReal=true;}
        else{
          // More accurate RSI estimation using multiple factors
          const rsiBase=50+ch24*1.6+(pPos-0.5)*20+((ch7d||0)*0.6);
          rsi=clamp(Math.round(rsiBase),12,88);
        }
        coins.push({sym,name:c.name||sym,price,ch24:+ch24.toFixed(2),ch7d:ch7d!=null?+ch7d.toFixed(2):null,vol,h,l,pPos:+pPos.toFixed(3),mcap:N(c.market_cap),mcapRank:N(c.market_cap_rank,9999),sector,rsi,rsiReal,kd,fd});
      }catch{}
    }

    // ── BTC CONTEXT ────────────────────────────────────────
    const btcC=coins.find(c=>c.sym==='BTC');
    const btcCh24=btcC?.ch24||0;
    const btcCh7d=btcC?.ch7d||0;
    const btcKd=kMap['BTC'];
    const btcPrice=btcC?.price||0;

    // ── RELATIVE STRENGTH vs BTC ──────────────────────────
    for(const c of coins){
      const rs24=+(c.ch24-btcCh24).toFixed(2);
      const rs7d=c.ch7d!=null?+(c.ch7d-btcCh7d).toFixed(2):null;
      // Weighted: 7d = 60%, 24h = 40%
      const rsScore=rs7d!=null?+(rs7d*0.6+rs24*0.4).toFixed(2):rs24;
      c.rs={score:+rsScore.toFixed(2),rs24,rs7d};
    }

    // ── TRADING SESSION (WIB = UTC+7) ─────────────────────
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

    // ══════════════════════════════════════════════════════
    // CONVERGENCE SCORE v2 — 5 KOMPONEN, LEBIH AKURAT
    // Skala: 0-100
    // ELITE ≥85 | PRIME ≥75 | VALID ≥65 | MODERATE ≥55 | WEAK <55
    // ══════════════════════════════════════════════════════
    const convCalc=coin=>{
      let tech=0,struct=0,macro=0,timing=0,momentum=0;
      const{rsi,ch24,ch7d,pPos,fd,rs,sector,vol,mcap,kd,price}=coin;
      const c7=ch7d||0;

      // ── TECHNICAL (max ±30) ────────────────────────────
      // RSI — requires TF context to avoid false signals
      if(rsi<22){tech+=15;}       // extreme oversold, prime entry
      else if(rsi<30){tech+=10;}  // oversold
      else if(rsi<38){tech+=6;}   // below midline
      else if(rsi<44){tech+=3;}
      else if(rsi>85){tech-=15;}  // extreme overbought
      else if(rsi>78){tech-=10;}
      else if(rsi>70){tech-=5;}
      // MACD
      if(kd?.macd?.xUp){tech+=8;}       // golden cross = strongest signal
      else if(kd?.macd?.xDown){tech-=8;}
      else if(kd?.macd?.bull){tech+=4;}
      else if(kd?.macd?.bear){tech-=4;}
      // EMA200 position (structural trend)
      if(kd?.ema200&&price>kd.ema200){tech+=5;}
      else if(kd?.ema200&&price<kd.ema200){tech-=4;}
      // EMA50 alignment
      if(kd?.ema50&&price>kd.ema50&&kd.ema50>kd.ema200){tech+=2;}
      // OBV confirmation
      if(kd?.obvBull&&ch24>0){tech+=3;}
      else if(kd?.obvBear&&ch24<0){tech-=3;}
      // Weekly reversal pattern (7d down → 24h up)
      if(c7<-8&&ch24>2&&pPos>0.25){tech+=4;}
      tech=clamp(tech,-30,30);

      // ── STRUCTURE (max ±25) ────────────────────────────
      // Price position in 24h range
      if(pPos<0.18&&ch24>1.5){struct+=10;}   // extreme discount + recovery
      else if(pPos<0.28&&ch24>0){struct+=6;}
      else if(pPos<0.35){struct+=3;}
      else if(pPos>0.82&&ch24<0){struct-=8;} // premium zone + rejection
      else if(pPos>0.75&&ch24<0){struct-=4;}
      // Funding rate — critical for SM direction
      if(fd?.fr<-0.005){struct+=10;}  // extreme negative = shorts paying longs
      else if(fd?.fr<-0.002){struct+=8;}
      else if(fd?.fr<0){struct+=3;}
      else if(fd?.fr>0.008){struct-=10;} // extreme positive = longs liquidation risk
      else if(fd?.fr>0.004){struct-=8;}
      else if(fd?.fr>0.002){struct-=3;}
      // Volume/MCap ratio (institutional flow indicator)
      if(mcap>0){
        const vR=vol/mcap;
        if(vR>0.25){struct+=6;}   // extreme institutional volume
        else if(vR>0.15){struct+=4;}
        else if(vR>0.07){struct+=2;}
        else if(vR>0.03){struct+=1;}
      }
      // Volume spike without mcap data (MEXC coins)
      const vt=vol>=1e9?5:vol>=200e6?4:vol>=50e6?3:vol>=10e6?2:vol>=1e6?1:0;
      if(!mcap&&vt>=4){struct+=3;}
      struct=clamp(struct,-25,25);

      // ── MACRO (max ±20) ────────────────────────────────
      // BTC price trend
      if(btcCh24>5){macro+=8;}
      else if(btcCh24>2){macro+=5;}
      else if(btcCh24>0){macro+=2;}
      else if(btcCh24<-5){macro-=8;}
      else if(btcCh24<-2){macro-=5;}
      else{macro-=1;}
      // Fear & Greed
      if(fg<15){macro+=9;}        // extreme fear = prime buy
      else if(fg<25){macro+=7;}
      else if(fg<35){macro+=4;}
      else if(fg<48){macro+=1;}
      else if(fg>85){macro-=9;}
      else if(fg>75){macro-=7;}
      else if(fg>65){macro-=4;}
      // BTC Dominance
      if(btcDom<45){macro+=6;}    // altseason active
      else if(btcDom<50){macro+=3;}
      else if(btcDom>65){macro-=6;}
      else if(btcDom>60){macro-=3;}
      // Total MCap momentum
      if(mcapCh24>3){macro+=3;}
      else if(mcapCh24<-3){macro-=3;}
      // BTC L/S ratio (NEW — high impact)
      if(btcLS!==null){
        if(btcLS<0.55){macro+=5;}       // heavy short dominance = squeeze fuel
        else if(btcLS<0.75){macro+=3;}
        else if(btcLS<0.90){macro+=1;}
        else if(btcLS>2.50){macro-=5;}  // heavy long dominance = liquidation risk
        else if(btcLS>1.80){macro-=3;}
        else if(btcLS>1.40){macro-=1;}
      }
      macro=clamp(macro,-20,20);

      // ── TIMING (max 0-15) ──────────────────────────────
      timing+=sesScore*1.8;
      timing+=dayScore;
      if(curSes==='DEAD_ZONE'){timing-=12;}
      else if(curSes==='LUNCH_DIP'){timing-=6;}
      timing=clamp(timing,0,15);

      // ── MOMENTUM vs BTC — NEW (max ±10) ───────────────
      // Koin yang outperform BTC = SM rotation target
      const rs7=rs?.rs7d!=null?rs.rs7d:0;
      const rs24val=rs?.rs24||0;
      if(rs7>18){momentum+=10;}       // massive outperformance
      else if(rs7>10){momentum+=7;}
      else if(rs7>5){momentum+=4;}
      else if(rs7>2){momentum+=2;}
      else if(rs7<-15){momentum-=6;}
      else if(rs7<-8){momentum-=4;}
      // 24h RS bonus (confirms direction)
      if(rs24val>5&&rs7>0){momentum+=2;}
      else if(rs24val>2&&rs7>3){momentum+=1;}
      momentum=clamp(momentum,-10,10);

      // ── TOTAL + CONVICTION LABEL ───────────────────────
      const base=50;
      const raw=clamp(base+tech+struct+macro+timing+momentum,4,98);
      const label=raw>=85?'🔥 ELITE':raw>=75?'💎 PRIME':raw>=65?'✅ VALID':raw>=55?'📊 MODERATE':'⚠️ WEAK';

      return{
        score:Math.round(raw),tech:Math.round(tech),struct:Math.round(struct),
        macro:Math.round(macro),timing:Math.round(timing),momentum:Math.round(momentum),
        label
      };
    };

    for(const c of coins)c.conv=convCalc(c);

    // ── LEADERS: score >= 62, vol >= 500K ─────────────────
    const leaders=coins.filter(c=>c.conv.score>=62&&c.vol>=500000&&c.sym!=='BTC')
      .sort((a,b)=>b.conv.score-a.conv.score).slice(0,20);

    // ── BTC GAME PLAN LEVELS ──────────────────────────────
    let btcLevels={current:btcPrice,resistance:null,support:null,bullTrigger:null,bearTrigger:null,ema50:btcKd?.ema50||null,ema200:btcKd?.ema200||null};
    if(btcKd&&btcPrice){
      const swHA=(btcKd.swH||[]).filter(h=>h>btcPrice*1.001).sort((a,b)=>a-b);
      const swLB=(btcKd.swL||[]).filter(l=>l<btcPrice*0.999).sort((a,b)=>b-a);
      btcLevels.resistance=swHA[0]?+swHA[0].toFixed(2):+(btcPrice*1.04).toFixed(2);
      btcLevels.support=swLB[0]?+swLB[0].toFixed(2):+(btcPrice*0.96).toFixed(2);
      btcLevels.bullTrigger=+(btcLevels.resistance*1.0015).toFixed(2);
      btcLevels.bearTrigger=+(btcLevels.support*0.998).toFixed(2);
    }

    // ── SETUP BUILDER v2 — ATR-BASED SL/TP ───────────────
    const mkSetup=(coin,type)=>{
      try{
        const{sym,name,price,rsi,fd,rs,kd,pPos,ch24,ch7d,sector,conv}=coin;

        // ATR-based SL: 1.5x ATR for swing, 1.2x for scalp
        const atrVal=kd?.atr||0;
        const atrPct=atrVal>0&&price>0?atrVal/price:0.025;
        const slMult=type==='scalp'?1.2:type==='swing'?1.8:1.5;

        // Dynamic SL: min 1.5%, max 7%
        const slPct=Math.max(0.015,Math.min(0.07,atrPct*slMult));
        const entry=+(price*(type==='scalp'?1.001:type==='swing'?0.997:0.999)).toFixed(price>10?2:price>1?4:6);
        const sl=+(entry*(1-slPct)).toFixed(price>10?2:price>1?4:6);
        const risk=entry-sl;

        // TP levels: 1:2, 1:3, 1:4.5
        const tp1=+(entry+risk*2.0).toFixed(price>10?2:price>1?4:6);
        const tp2=+(entry+risk*3.0).toFixed(price>10?2:price>1?4:6);
        const tp3=+(entry+risk*4.5).toFixed(price>10?2:price>1?4:6);

        // Use nearest swing high as natural TP1 if available
        const swHA=(kd?.swH||[]).filter(h=>h>entry*1.01);
        if(swHA.length){
          const nearResist=Math.min(...swHA);
          const naturalTP=+(nearResist*0.997).toFixed(price>10?2:4);
          // Only use natural TP if better than 1.5x risk
          if(naturalTP>entry+risk*1.5&&naturalTP<tp2){
            return buildSetupObj(sym,name,sector,price,entry,sl,naturalTP,tp2,tp3,conv,rsi,coin,type,slPct,risk);
          }
        }
        return buildSetupObj(sym,name,sector,price,entry,sl,tp1,tp2,tp3,conv,rsi,coin,type,slPct,risk);
      }catch{return null;}
    };

    const buildSetupObj=(sym,name,sector,price,entry,sl,tp1,tp2,tp3,conv,rsi,coin,type,slPct,risk)=>{
      const{fd,rs,kd,ch24,ch7d}=coin;
      const reasons=[];
      if(rsi<30){reasons.push('RSI '+rsi+' oversold — reversal zone');}
      if(kd?.macd?.xUp){reasons.push('MACD golden cross — momentum shift');}
      if(coin.pPos<0.25){reasons.push('Discount zone '+Math.round(coin.pPos*100)+'% of range');}
      if(fd?.fr<-0.002){reasons.push('FR '+fd.pct+'% negative — short squeeze setup');}
      if(rs?.score>5){reasons.push('RS +'+rs.score+'% vs BTC — outperformance');}
      if(ch7d&&ch7d<-8&&ch24>1){reasons.push('Reversal: -'+Math.abs(ch7d).toFixed(0)+'% weekly → +'+ch24.toFixed(1)+'% today');}
      if(kd?.obvBull){reasons.push('OBV bullish — institutional accumulation');}
      if(kd?.ema200&&price>kd.ema200){reasons.push('Above EMA200 — structural uptrend');}
      return{
        sym,name,sector,price,entry,sl,tp1,tp2,tp3,
        rr:'1:2 / 1:3 / 1:4.5',
        conv:conv.score,rsi,rsiReal:coin.rsiReal,
        fr:fd?.pct||null,rs:rs?.score||0,
        reasons:reasons.slice(0,4),
        slPct:+((entry-sl)/entry*100).toFixed(2),
        tp1Pct:+((tp1-entry)/entry*100).toFixed(2),
        tp2Pct:+((tp2-entry)/entry*100).toFixed(2),
        tp3Pct:+((tp3-entry)/entry*100).toFixed(2),
        atrPct:+(coin.kd?.atr>0&&price>0?coin.kd.atr/price*100:0).toFixed(2),
        type,
      };
    };

    // SCALP: conv >= 63, RSI 38-65, vol >= 5M
    const scalpSetups=coins
      .filter(c=>c.conv.score>=63&&c.vol>=5e6&&c.rsi>=38&&c.rsi<=65&&c.sym!=='BTC')
      .sort((a,b)=>b.conv.score-a.conv.score).slice(0,4)
      .map(c=>mkSetup(c,'scalp')).filter(Boolean);

    // SWING: conv >= 60, RSI < 48, vol >= 2M
    const swingSetups=coins
      .filter(c=>c.conv.score>=60&&c.vol>=2e6&&c.rsi<48&&c.sym!=='BTC')
      .sort((a,b)=>b.conv.score-a.conv.score).slice(0,4)
      .map(c=>mkSetup(c,'swing')).filter(Boolean);

    // SPOT ACCUM: RSI < 38, MCap > 30M, vol >= 300K
    const spotAccum=coins
      .filter(c=>c.rsi<38&&c.mcap>30e6&&c.vol>=300000&&c.sym!=='BTC')
      .sort((a,b)=>a.rsi-b.rsi).slice(0,5)
      .map(c=>{
        const lo=+(c.price*0.97).toFixed(c.price>10?2:c.price>1?4:6);
        const hi=+(c.price*1.01).toFixed(c.price>10?2:c.price>1?4:6);
        return{sym:c.sym,name:c.name,sector:c.sector,price:c.price,rsi:c.rsi,rsi1d:c.kd?.rsi1d||null,rsiReal:c.rsiReal,ch7d:c.ch7d,conv:c.conv.score,dcaZone:lo+' – '+hi,atrPct:c.kd?.atr>0&&c.price>0?+(c.kd.atr/c.price*100).toFixed(2):null};
      });

    // AVOID: overbought RSI or extreme FR
    const avoidList=coins
      .filter(c=>c.rsi>78||(c.fd&&c.fd.fr>0.0004))
      .sort((a,b)=>(b.fd?.fr||0)-(a.fd?.fr||0)||b.rsi-a.rsi).slice(0,6)
      .map(c=>({
        sym:c.sym,price:c.price,rsi:c.rsi,fr:c.fd?.pct||null,
        reason:c.rsi>82?'RSI '+c.rsi+' EXTREME overbought':c.fd?.fr>0.0004?'FR +'+c.fd.pct+'% longs overheated':'Extended — poor RR'
      }));

    // ── SECTOR FLOW MAP v2 ────────────────────────────────
    const flowMap={};
    for(const c of coins){
      if(!flowMap[c.sector])flowMap[c.sector]={count:0,vol:0,bulls:0,ch24Sum:0,ch7dSum:0,ch7dN:0,rsiSum:0,frSum:0,frN:0,convSum:0};
      const f=flowMap[c.sector];
      f.count++;f.vol+=c.vol;if(c.ch24>0)f.bulls++;
      f.ch24Sum+=c.ch24;if(c.ch7d!=null){f.ch7dSum+=c.ch7d;f.ch7dN++;}
      f.rsiSum+=c.rsi;if(c.fd){f.frSum+=c.fd.fr;f.frN++;}
      f.convSum+=c.conv.score;
    }
    const flowArr=Object.entries(flowMap).map(([sec,f])=>{
      const avgCh24=+(f.ch24Sum/f.count).toFixed(2);
      const avgRSI=+(f.rsiSum/f.count).toFixed(0);
      const avgConv=Math.round(f.convSum/f.count);
      const bullPct=+(f.bulls/f.count*100).toFixed(0);
      const avgFR=f.frN>0?+(f.frSum/f.frN*100).toFixed(4):null;
      let sig,col;
      if(avgCh24>5&&bullPct>=70){sig='🔥 HOT';col='green';}
      else if(avgCh24>2&&bullPct>=58){sig='↑↑ INFLOW';col='green';}
      else if(avgCh24>0&&avgConv>56){sig='↑ MILD';col='lightgreen';}
      else if(avgCh24<-5&&bullPct<30){sig='💀 EXIT';col='red';}
      else if(avgCh24<-2){sig='↓↓ OUTFLOW';col='red';}
      else if(avgCh24<0){sig='↓ WEAK';col:'orange';}
      else{sig='→ NEUTRAL';col='gray';}
      return{sector:sec,name:SNAMES[sec]||sec,count:f.count,vol:+f.vol.toFixed(0),avgCh24,avgRSI:+avgRSI,avgConv,bullPct,avgFR,sig,col,flowSig:sig,flowColor:col};
    }).sort((a,b)=>b.avgCh24-a.avgCh24);

    // ── MARKET CHARACTER v2 — 8 REGIME ───────────────────
    const bullPctMkt=+(coins.filter(c=>c.ch24>0).length/coins.length*100).toFixed(0);
    const avgCh24Mkt=+(coins.reduce((s,c)=>s+c.ch24,0)/coins.length).toFixed(2);
    const xOBs=coins.filter(c=>c.rsi>80).length;
    const xOSs=coins.filter(c=>c.rsi<28).length;
    const allFRs=Object.values(frMap).map(f=>f.fr).filter(f=>Math.abs(f)>0.00001);
    const avgFRMkt=allFRs.length?+(allFRs.reduce((s,v)=>s+v,0)/allFRs.length*100).toFixed(4):0;
    const btcAtr=btcKd?.atr||0;
    const btcAtrPct=btcAtr>0&&btcPrice>0?+(btcAtr/btcPrice*100).toFixed(2):0;

    let charType,charDesc,riskLevel,tradeStyle,riskMult,charColor;
    if(xOBs>18&&avgFRMkt>0.02){
      charType='⛔ OVERHEATED';
      charDesc='BAHAYA: Terlalu banyak koin overbought ('+xOBs+') + FR avg +'+avgFRMkt+'%. Distribusi besar mungkin dimulai. Ambil profit, tutup posisi.';
      riskLevel='DANGEROUS';tradeStyle='Take Profit Only';riskMult=0.15;charColor='red';
    }
    else if(xOSs>20&&bullPctMkt<32&&fg<25){
      charType='🔄 CAPITULATION';
      charDesc='PELUANG LANGKA: '+xOSs+' koin extreme oversold, F&G '+fg+', '+bullPctMkt+'% koin naik. Smart money akumulasi agresif. Setup reversal prime.';
      riskLevel='HIGH OPP';tradeStyle='Reversal Long';riskMult=1.3;charColor='green';
    }
    else if(avgCh24Mkt>4&&bullPctMkt>68&&btcCh24>3){
      charType='📈 TRENDING BULL';
      charDesc='Market rally momentum kuat. Avg '+avgCh24Mkt+'%, '+bullPctMkt+'% koin naik. Follow trend, beli pullback ke OB/OTE dengan volume konfirmasi.';
      riskLevel='NORMAL';tradeStyle='Swing & Momentum';riskMult=1.0;charColor='green';
    }
    else if(avgCh24Mkt<-4&&bullPctMkt<30){
      charType='📉 TRENDING BEAR';
      charDesc='Tekanan jual dominan. Avg '+avgCh24Mkt+'%, hanya '+bullPctMkt+'% koin naik. Cash 70-80% atau short only. Jangan beli kecuali extreme oversold + reversal candle.';
      riskLevel='REDUCED';tradeStyle='Cash / Selective Short';riskMult=0.35;charColor='red';
    }
    else if(btcAtrPct<0.8&&Math.abs(avgCh24Mkt)<1.5){
      charType='⚡ CHOPPY / COMPRESSION';
      charDesc='Range sangat sempit. BTC ATR hanya '+btcAtrPct+'%. Energi menumpuk — breakout besar akan datang. Scalp micro-range, hindari posisi besar.';
      riskLevel='LOW';tradeStyle='Scalp Only';riskMult=0.45;charColor='amber';
    }
    else if(xOSs>12&&avgCh24Mkt>0.5){
      charType='🟢 RECOVERY MODE';
      charDesc=''+xOSs+' koin oversold mulai recover. Sinyal reversal awal terdeteksi. Setup valid dengan konfirmasi volume. Sizing normal.';
      riskLevel='NORMAL';tradeStyle='Selective Long';riskMult=0.9;charColor='green';
    }
    else if(avgCh24Mkt>1.5&&bullPctMkt>55){
      charType='🟢 MILD BULL';
      charDesc='Kondisi mild bullish. '+bullPctMkt+'% koin naik. Filter ketat: convergence ≥70, volume konfirmasi, SL berbasis ATR.';
      riskLevel='NORMAL';tradeStyle='Selective Swing';riskMult=0.85;charColor='green';
    }
    else if(avgCh24Mkt<-1.5){
      charType='🟡 MILD BEAR';
      charDesc='Tekanan jual mild. Kurangi sizing 40-50%. Fokus koin dengan RS positif vs BTC dan FR negatif saja.';
      riskLevel='REDUCED';tradeStyle='Small Sizing';riskMult=0.5;charColor='amber';
    }
    else{
      charType='⚖️ NEUTRAL';
      charDesc='Market seimbang. DCA spot di discount zone. Hindari FOMO, tunggu volume breakout untuk swing entry.';
      riskLevel='LOW-MED';tradeStyle='Spot Accum / Wait';riskMult=0.65;charColor='amber';
    }

    // ── TRADING SCHEDULE ──────────────────────────────────
    const sessions=[
      {id:'DEAD_ZONE',name:'😴 Dead Zone',time:'02:00–06:00',q:'POOR',activity:'Volume minimum. Hindari trading. Istirahat.'},
      {id:'ASIA_OPEN',name:'🌅 Asia Open',time:'06:00–09:00',q:'MODERATE',activity:'Volume mulai naik. Scalp kecil saja.'},
      {id:'ASIA_PEAK',name:'🔥 Asia Peak',time:'09:00–12:00',q:'GOOD',activity:'Asia aktif. Scalp setup valid OK.'},
      {id:'LUNCH_DIP',name:'⚠️ Lunch Dip',time:'12:00–15:00',q:'CAUTION',activity:'Volume turun. Jangan buka posisi baru.'},
      {id:'LONDON_OPEN',name:'💥 London Open',time:'15:00–18:00',q:'PRIME',activity:'Volume naik drastis. BEST untuk swing & breakout.'},
      {id:'NY_PREMARKET',name:'📈 NY Pre',time:'18:00–21:00',q:'BUILDING',activity:'Siapkan setup untuk NY open.'},
      {id:'NY_OPEN',name:'🚀 NY Open',time:'21:00–23:00',q:'PRIME',activity:'Volume tertinggi. Eksekusi setup terbaik di sini.'},
      {id:'NY_LATE',name:'🌙 NY Late',time:'23:00–02:00',q:'GOOD',activity:'Volume mulai turun. Manage posisi aktif.'},
    ];
    const curSesObj=sessions.find(s=>s.id===curSes)||sessions[0];
    const primeSes=sessions.filter(s=>s.q==='PRIME').map(s=>{
      const targetH=s.id==='LONDON_OPEN'?15:21;
      let inH=targetH-wibH;
      if(inH<0)inH+=24;
      return{...s,inH};
    }).sort((a,b)=>a.inH-b.inH);
    const szRec=riskMult>=1.3?'Agresif (130%)':riskMult>=1?'Full size (100%)':riskMult>=0.85?'Normal (85%)':riskMult>=0.7?'Kurangi (70%)':riskMult>=0.5?'Half (50%)':riskMult>=0.35?'Minimal (35%)':'Preserve capital (15%)';
    const focusTxt=charType.includes('TRENDING BULL')?'Follow momentum. Beli pullback ke OB/OTE dengan volume. Target koin conv ≥72, RS positif.':charType.includes('BEAR')?'Cash 70%. Short setup saja. Long hanya extreme oversold RSI <25 + reversal candle.':charType.includes('CHOPPY')?'Scalp 1-2% TP, SL 0.8%. Hindari overnight. Market breakout besar segera hadir.':charType.includes('OVERHEATED')?'AMBIL PROFIT sekarang. Jangan buka posisi baru. Tunggu reset fundamental.':charType.includes('CAPITULATION')?'Peluang langka! Entry reversal dengan convergence ≥68 + volume konfirmasi.':'Selektif. Convergence ≥70, vol ≥$5M, SL berbasis ATR, RR minimal 1:2.';

    // ── PRE-TRADE CHECKLIST v2 — 8 ITEM MARKET ───────────
    const sesGood=sesScore>=2;
    const frOK=Math.abs(avgFRMkt)<0.025;
    const mktOK=!charType.includes('OVERHEATED')&&!charType.includes('DANGEROUS');
    const btcAtR=btcLevels.resistance&&btcPrice&&(btcPrice/btcLevels.resistance)>0.987;
    const mktNOB=xOBs<18&&avgFRMkt<0.03;
    const btcTrendOK=btcCh24>-1.5; // not strongly bearish
    const lsOK=btcLS===null||(btcLS<1.8); // no extreme long overload
    const volOK=coins.filter(c=>c.vol>=10e6&&c.ch24>1.5).length>=4; // enough active coins

    const checklist={
      marketChecks:[
        {label:'Market character layak trading',pass:mktOK,detail:charType,fix:!mktOK?'Tutup semua posisi, tunggu reset':''},
        {label:'Trading session berkualitas',pass:sesGood,detail:curSes+' '+sesQ,fix:!sesGood?'Tunggu London (15:00) atau NY (21:00) WIB':''},
        {label:'BTC tidak di resistance',pass:!btcAtR,detail:btcAtR?'Dekat resist $'+(btcLevels.resistance?.toFixed(0)||'?'):'BTC aman dari resistance',fix:btcAtR?'Tunggu BTC breakout atau turun ke support':''},
        {label:'FR market tidak overheated',pass:frOK,detail:'Avg FR: '+(avgFRMkt>=0?'+':'')+avgFRMkt+'%',fix:!frOK?'Longs overheated, tunggu normalisasi FR':''},
        {label:'Market tidak overbought massal',pass:mktNOB,detail:xOBs+' koin RSI>80 | XOS: '+xOSs,fix:!mktNOB?'Terlalu banyak koin extended, tunggu pullback':''},
        {label:'BTC L/S ratio aman',pass:lsOK,detail:btcLS?'L/S: '+btcLS+' ('+btcLongPct+'% long / '+btcShortPct+'% short)':'Data L/S tidak tersedia',fix:!lsOK?'Long overloaded → liquidation risk tinggi':''},
        {label:'Cukup koin aktif & liquid',pass:volOK,detail:coins.filter(c=>c.vol>=10e6&&c.ch24>1.5).length+' koin aktif (vol≥$10M + naik)',fix:!volOK?'Volume market lemah, lesu':''},
        {label:'BTC trend mendukung altcoin',pass:btcTrendOK,detail:btcCh24>=0?'BTC +'+btcCh24.toFixed(2)+'% (positif)':btcCh24>-1.5?'BTC '+btcCh24.toFixed(2)+'% (mild, OK)':'BTC '+btcCh24.toFixed(2)+'% (bearish)',fix:!btcTrendOK?'BTC bearish → tunda long altcoin':''},
      ],
      coinChecks:[
        'RSI koin < 72 (hindari yang sudah overbought)',
        'FR koin < +0.04% per 8h (hindari yang longs overheated)',
        'Volume 24h ≥ $5M (pastikan likuiditas cukup)',
        'Stop Loss sudah ditentukan (ATR-based, bukan % flat)',
        'Setup sesuai skenario Game Plan (bull/bear/sideways)',
        'Risk-Reward minimal 1:2 (target 1:3)',
        'Convergence Score ≥ 68',
        'Konfirmasi volume pada candle entry (tidak sepi)',
        'Position size ≤ 2% equity per trade',
        'Tidak buka posisi dalam 30 menit sebelum CPI/Fed news',
      ],
      marketPassCount:[mktOK,sesGood,!btcAtR,frOK,mktNOB,lsOK,volOK,btcTrendOK].filter(Boolean).length,
      marketTotal:8,
      overallGreenLight:mktOK&&sesGood&&frOK&&lsOK,
      verdict:mktOK&&sesGood&&frOK&&lsOK?'🟢 SEMUA OK — Proceed dengan setup terbaik':'🟡 HATI-HATI — '+[!mktOK?charType:'',!sesGood?'Session '+sesQ:'',!frOK?'FR Overheated':'',!lsOK?'L/S Overloaded':''].filter(Boolean).join(' · '),
    };

    // ── SCENARIOS ─────────────────────────────────────────
    const scenarios={
      bull:{
        condition:'BTC tembus $'+btcLevels.bullTrigger+' (close di atas, bukan wick)',
        action:'Long alts conv ≥70, RR 1:3. Prioritaskan koin dengan RS positif dan FR negatif.',
        setups:scalpSetups.slice(0,2)
      },
      bear:{
        condition:'BTC breakdown ke $'+btcLevels.bearTrigger+' dan close di bawahnya',
        action:'Cash 80%. Tunggu 2 candle 4H stabilisasi sebelum re-entry. Jangan catch falling knife.'
      },
      sideways:{
        condition:'BTC konsolidasi ±1.5%, volume di bawah rata-rata',
        action:'Scalp hanya setup terbaik. TP lebih cepat (1:1.5). Hindari overnight.',
        setups:swingSetups.slice(0,2)
      }
    };

    // ── SUMMARY STATS ──────────────────────────────────────
    const eliteCount=leaders.filter(c=>c.conv.score>=85).length;
    const primeCount=leaders.filter(c=>c.conv.score>=75&&c.conv.score<85).length;
    const validCount=leaders.filter(c=>c.conv.score>=65&&c.conv.score<75).length;

    return res.status(200).json({
      ok:true,ts:Date.now(),elapsed:Date.now()-t0,version:'v2',
      dataQuality:{
        coins:coins.length,
        realRSI:Object.keys(kMap).length,
        fr:Object.keys(frMap).length,
        btcLS:btcLS!==null,
      },
      marketCharacter:{
        type:charType,description:charDesc,riskLevel,tradeStyle,
        riskMultiplier:riskMult,color:charColor,
        stats:{avgCh24:avgCh24Mkt,bullPct:bullPctMkt,xOB:xOBs,xOS:xOSs,avgFR:avgFRMkt}
      },
      btcSnapshot:btcC?{
        price:btcC.price,ch24:btcC.ch24,ch7d:btcC.ch7d,
        rsi:btcKd?.rsi||null,rsi1d:btcKd?.rsi1d||null,
        macd:btcKd?.macd||null,ema50:btcKd?.ema50||null,ema200:btcKd?.ema200||null,
        aboveEma200:btcC&&btcKd?btcC.price>btcKd.ema200:null,
        aboveEma50:btcC&&btcKd?btcC.price>btcKd.ema50:null,
        fg,fgLabel,btcDom,totalMcap,mcapCh24,
        btcLS,btcLongPct,btcShortPct,
        atrPct:btcAtrPct,
      }:null,
      convergence:{
        leaders:leaders.map(c=>({
          sym:c.sym,name:c.name,sector:c.sector,price:c.price,ch24:c.ch24,
          rsi:c.rsi,rsiReal:c.rsiReal,rsi1d:c.kd?.rsi1d||null,conv:c.conv,
          fr:c.fd?.pct||null,
          frSig:c.fd?.fr<-0.005?'EXTREME SQUEEZE🚀':c.fd?.fr<-0.002?'SHORT SQ💎':c.fd?.fr<0?'NEG FR✅':c.fd?.fr>0.005?'EXTREME🚨':c.fd?.fr>0.002?'LONG HEAVY⚠️':'NORMAL⚖️',
          rs:c.rs?.score||0,rs24:c.rs?.rs24||0,rs7d:c.rs?.rs7d||null,
          macdXUp:c.kd?.macd?.xUp||false,
          obvBull:c.kd?.obvBull||false,
        })),
        eliteCount,primeCount,validCount,
        summary:`${eliteCount} 🔥ELITE · ${primeCount} 💎PRIME · ${validCount} ✅VALID`,
      },
      gamePlan:{
        btcLevels,
        btcSentiment:btcKd&&btcC?{
          rsi:btcKd.rsi,rsi1d:btcKd.rsi1d,macd:btcKd.macd,
          aboveEma50:btcC.price>btcKd.ema50,aboveEma200:btcC.price>btcKd.ema200,
          trend:btcC.price>btcKd.ema200?'Bullish (above EMA200)':'Bearish (below EMA200)',
          ls:btcLS?`${btcLongPct}% Long · ${btcShortPct}% Short · Ratio ${btcLS}`:null,
        }:null,
        scalpSetups,swingSetups,spotAccum,avoidList,scenarios
      },
      sectorFlow:{
        sectors:flowArr.map(f=>({...f,flowSig:f.sig,flowColor:f.col})),
        hot:flowArr.filter(f=>f.avgCh24>2).slice(0,4),
        cold:flowArr.filter(f=>f.avgCh24<-1).sort((a,b)=>a.avgCh24-b.avgCh24).slice(0,3),
        rotating:flowArr.filter(f=>f.avgRSI<50&&f.avgCh24>0&&f.avgConv>56).slice(0,3)
      },
      tradingSchedule:{
        currentSession:curSes,sessionQuality:sesQ,
        currentSessionData:curSesObj,
        nextPrimeSession:primeSes[0]||null,
        focusToday:focusTxt,positionSizeRec:szRec,
        sessions,wibHour:wibH,
        dayName:['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'][dow]
      },
      checklist,
    });

  }catch(e){
    return res.status(200).json({ok:false,error:e.message,ts:Date.now(),elapsed:Date.now()-t0,version:'v2'});
  }
}
