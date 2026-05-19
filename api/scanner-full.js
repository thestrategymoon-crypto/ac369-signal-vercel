// api/scanner-full.js — v23 ULTRA
// ~1000 KOIN: CoinGecko(250) + MEXC(500+) + Bybit Spot(200+)
// Tidak pernah gagal total: jika CoinGecko rate-limited, MEXC+Bybit tetap berjalan
// Semua sumber dijalankan PARALLEL — total ~6-7s

const TOP30_CC = ['BTC','ETH','BNB','SOL','XRP','ADA','DOGE','AVAX','LINK','DOT','NEAR','TRX','SUI','APT','ARB','OP','PEPE','TON','INJ','TIA','RENDER','FIL','LTC','ATOM','MATIC','HYPE','FLOKI','WIF','BONK','JUP'];
const STABLES = new Set(['USDT','USDC','BUSD','DAI','TUSD','FDUSD','USDD','FRAX','GUSD','USDP','LUSD','BIDR','EURC','EURS','PYUSD','CRVUSD','SUSD','ALUSD','USDE','USDB']);
const IGNORE  = new Set(['BTCDOMUSDT','DEFIUSDT','USDCUSDT','PERPUSDT']);
const NO_SFX  = ['UP','DOWN','BULL','BEAR','LONG','SHORT','3L','3S','2L','2S'];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=20');
  if (req.method === 'OPTIONS') return res.status(200).end();
  const t0 = Date.now();

  const sf = async (url, ms) => {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), ms);
    try {
      const r = await fetch(url, { signal: c.signal, headers: { Accept: 'application/json', 'User-Agent': 'AC369/1.0' } });
      clearTimeout(t); if (!r.ok) return null; return await r.json();
    } catch { clearTimeout(t); return null; }
  };

  // ── TA ────────────────────────────────────────────────
  const RSI14 = (a) => {
    if (!a||a.length<16) return null;
    let ag=0,al=0;
    for(let i=1;i<=14;i++){const d=a[i]-a[i-1];d>0?ag+=d:al-=d;}
    ag/=14;al/=14;
    for(let i=15;i<a.length;i++){const d=a[i]-a[i-1];ag=(ag*13+Math.max(d,0))/14;al=(al*13+Math.max(-d,0))/14;}
    return al===0?100:+(100-100/(1+ag/al)).toFixed(2);
  };
  const EMA = (a,p) => {
    if(!a||a.length<2) return a?.[a.length-1]||0;
    const k=2/(p+1); let e=a.slice(0,Math.min(p,a.length)).reduce((s,v)=>s+v,0)/Math.min(p,a.length);
    for(let i=Math.min(p,a.length);i<a.length;i++) e=a[i]*k+e*(1-k);
    return e;
  };
  const MACD_SIG = (a) => {
    if(!a||a.length<36) return {bull:false,bear:false,xUp:false,xDown:false,divergence:false};
    const k12=2/13,k26=2/27,k9=2/10;
    let e12=a.slice(0,12).reduce((s,v)=>s+v,0)/12,e26=a.slice(0,26).reduce((s,v)=>s+v,0)/26;
    const mv=[];
    for(let i=26;i<a.length;i++){e12=a[i]*k12+e12*(1-k12);e26=a[i]*k26+e26*(1-k26);mv.push(e12-e26);}
    let sig=mv.slice(0,9).reduce((s,v)=>s+v,0)/9;
    for(let i=9;i<mv.length;i++) sig=mv[i]*k9+sig*(1-k9);
    const last=mv[mv.length-1],prev=mv[mv.length-2]||last,hist=last-sig,prevH=prev-sig;
    const div=mv.length>6&&last<mv[mv.length-7]&&a[a.length-1]>a[a.length-7];
    return {bull:last>0&&hist>0,bear:last<0&&hist<0,xUp:hist>0&&prevH<=0,xDown:hist<0&&prevH>=0,divergence:div};
  };

  // ── ICT / SMC from klines ─────────────────────────────
  const smcKlines = (K, price) => {
    if (!K||K.length<10) return null;
    const n=K.length;
    const swH=[],swL=[];
    for(let i=2;i<n-2;i++){
      if(K[i]?.h>K[i-1]?.h&&K[i]?.h>K[i+1]?.h) swH.push({i,p:K[i].h});
      if(K[i]?.l<K[i-1]?.l&&K[i]?.l<K[i+1]?.l) swL.push({i,p:K[i].l});
    }
    const rSH=swH.slice(-3),rSL=swL.slice(-3);
    const lSH=rSH[rSH.length-1]?.p||0,lSL=rSL[rSL.length-1]?.p||1e12;
    const pSH=rSH[rSH.length-2]?.p||0,pSL=rSL[rSL.length-2]?.p||1e12;
    let bos=null,choch=null;
    if(price>lSH&&lSH>0&&K[n-3]?.c<lSH) bos={type:'Bullish BOS',level:+lSH.toFixed(6)};
    else if(price<lSL&&lSL<1e12&&K[n-3]?.c>lSL) bos={type:'Bearish BOS',level:+lSL.toFixed(6)};
    if(!bos&&pSH>0&&price>pSH) choch={type:'Bullish CHoCH (MSS)',level:+pSH.toFixed(6)};
    if(!bos&&pSL<1e12&&price<pSL) choch={type:'Bearish CHoCH (MSS)',level:+pSL.toFixed(6)};
    let bullOB=null,bearOB=null,bullFVG=null;
    for(let i=Math.max(0,n-15);i<n-2;i++){
      const k=K[i],nx=K[i+1];if(!k||!nx)continue;
      if(k.c<k.o&&nx.c>nx.o&&nx.c>k.o*1.003){const H=Math.max(k.o,k.c),L=Math.min(k.o,k.c);if(!bullOB&&price<=H*1.01&&price>=L*0.995)bullOB={high:+H.toFixed(6),low:+L.toFixed(6),mid:+((H+L)/2).toFixed(6),fresh:i>n-8};}
      if(k.c>k.o&&nx.c<nx.o&&nx.c<k.o*0.997){const H=Math.max(k.o,k.c),L=Math.min(k.o,k.c);if(!bearOB&&price<=H*1.005&&price>=L*0.99)bearOB={high:+H.toFixed(6),low:+L.toFixed(6),mid:+((H+L)/2).toFixed(6),fresh:i>n-8};}
      if(i+2<n&&K[i+2]?.l&&K[i]?.h&&K[i+2].l>K[i].h&&price>=K[i].h&&price<=K[i+2].l)bullFVG={high:+K[i+2].l.toFixed(6),low:+K[i].h.toFixed(6),gapPct:+(+(K[i+2].l-K[i].h)/K[i].h*100).toFixed(2)};
    }
    let liqSweep=null;
    if(rSL.length>0&&K[n-2]&&K[n-1]){const sl=rSL[rSL.length-1];if(K[n-2].l<sl.p&&K[n-1].c>sl.p)liqSweep={type:'Bullish SSL Sweep',level:+sl.p.toFixed(6)};}
    if(rSH.length>0&&K[n-2]&&K[n-1]){const sh=rSH[rSH.length-1];if(K[n-2].h>sh.p&&K[n-1].c<sh.p)liqSweep={type:'Bearish BSL Sweep',level:+sh.p.toFixed(6)};}
    const rangeH=Math.max(...K.slice(-20).map(k=>k.h)||[price*1.1]);
    const rangeL=Math.min(...K.slice(-20).map(k=>k.l)||[price*0.9]);
    const equil=(rangeH+rangeL)/2;
    const pip=rangeH>rangeL?+((price-rangeL)/(rangeH-rangeL)*100).toFixed(1):50;
    const zone=pip>70?'Premium Zone':pip>55?'Slight Premium':pip<30?'Discount Zone':pip<45?'Slight Discount':'Equilibrium';
    const oteH=+(equil+(rangeH-equil)*0.382).toFixed(6);
    const oteL=+(equil-(equil-rangeL)*0.382).toFixed(6);
    const inOTE=price>=oteL&&price<=oteH;
    let eqH=null,eqL=null;
    if(rSH.length>=2){const d=Math.abs(rSH[rSH.length-1].p-rSH[rSH.length-2].p)/rSH[rSH.length-1].p;if(d<0.006)eqH={level:+rSH[rSH.length-1].p.toFixed(6),desc:'Equal Highs (BSL) — buy-side liquidity above'};}
    if(rSL.length>=2){const d=Math.abs(rSL[rSL.length-1].p-rSL[rSL.length-2].p)/rSL[rSL.length-1].p;if(d<0.006)eqL={level:+rSL[rSL.length-1].p.toFixed(6),desc:'Equal Lows (SSL) — sell-side liquidity below'};}
    const bullSc=(!!bullOB?2:0)+(!!bullFVG?1:0)+(bos?.type?.includes('Bull')?3:0)+(choch?.type?.includes('Bull')?2:0)+(!!liqSweep?.type?.includes('Bull')?2:0)+(inOTE&&price<equil?1:0);
    const bearSc=(!!bearOB?2:0)+(bos?.type?.includes('Bear')?3:0)+(choch?.type?.includes('Bear')?2:0)+(!!liqSweep?.type?.includes('Bear')?2:0)+(inOTE&&price>equil?1:0);
    return{hasBOS:!!bos,bosType:bos?.type||'None',bosLevel:bos?.level||null,hasCHoCH:!!choch,chochType:choch?.type||'None',bullOB,bearOB,inBullOB:!!bullOB,inBearOB:!!bearOB,bullFVG,inBullFVG:!!bullFVG,liqSweep,eqH,eqL,zone,priceInRange:pip,equil:+equil.toFixed(6),oteH,oteL,inOTE,signal:bullSc>bearSc?'Bullish':bearSc>bullSc?'Bearish':'Neutral',score:{bull:bullSc,bear:bearSc}};
  };

  // ── SMC from basic data ───────────────────────────────
  const smcBasic = (price, h24, l24, ch24, ch7d) => {
    const pip=h24>l24?(price-l24)/(h24-l24)*100:50;
    const zone=pip>70?'Premium Zone':pip<30?'Discount Zone':'Equilibrium';
    const hasBOS=Math.abs(ch24)>5;
    const bosType=ch24>5?'Bullish BOS':ch24<-5?'Bearish BOS':'None';
    const hasCHoCH=ch24>3&&(ch7d||0)<0;
    const inBullOB=pip<28,inBearOB=pip>72;
    const bullSc=(hasBOS&&bosType.includes('Bull')?3:0)+(inBullOB?2:0)+(hasCHoCH?2:0);
    const bearSc=(hasBOS&&bosType.includes('Bear')?3:0)+(inBearOB?2:0);
    return{hasBOS,bosType,bosLevel:hasBOS&&ch24>5?+(h24*0.98).toFixed(6):hasBOS?+(l24*1.02).toFixed(6):null,hasCHoCH,chochType:hasCHoCH?'Bullish CHoCH (MSS)':'None',inBullOB,inBearOB,bullOB:inBullOB?{low:+l24.toFixed(6),high:+(l24+(h24-l24)*0.28).toFixed(6)}:null,bearOB:inBearOB?{low:+(l24+(h24-l24)*0.72).toFixed(6),high:+h24.toFixed(6)}:null,inBullFVG:pip<15,zone,priceInRange:+pip.toFixed(1),signal:bullSc>bearSc?'Bullish':bearSc>bullSc?'Bearish':'Neutral',score:{bull:bullSc,bear:bearSc}};
  };

  // ── CHART PATTERNS ≥75% ───────────────────────────────
  const chartPat = (K, price, h24, l24, ch24, ch7d, pricePos, vol) => {
    try {
      const pats=[];
      const open=price>0&&ch24>-99?price/(1+ch24/100):price;
      const range=h24-l24;
      if(range>0){
        const body=Math.abs(price-open),bodyR=body/range;
        const lwR=(Math.min(price,open)-l24)/range,uwR=(h24-Math.max(price,open))/range;
        if(lwR>0.55&&bodyR<0.30&&uwR<0.20&&pricePos<0.45) pats.push({name:'🔨 Hammer',signal:'bullish',winRate:76,desc:`Rejected low $${l24.toFixed(4)}`});
        if(uwR>0.55&&bodyR<0.30&&lwR<0.20&&pricePos>0.55) pats.push({name:'⭐ Shooting Star',signal:'bearish',winRate:75,desc:`Rejected high $${h24.toFixed(4)}`});
        if(bodyR>0.75&&ch24>3&&price>open) pats.push({name:'🐂 Bull Marubozu',signal:'bullish',winRate:77,desc:`+${ch24.toFixed(1)}% full-body. Full buy control.`});
        if(bodyR>0.75&&ch24<-3&&price<open) pats.push({name:'🐻 Bear Marubozu',signal:'bearish',winRate:77,desc:`${ch24.toFixed(1)}% full-body. Full sell control.`});
        if(uwR>0.50&&bodyR<0.30&&lwR<0.20&&pricePos<0.40&&ch24>0) pats.push({name:'🔨 Inverted Hammer',signal:'bullish',winRate:75,desc:`Upper wick rejection. Confirm next candle.`});
      }
      if(K&&K.length>=3){
        const n=K.length,C=K[n-1],P=K[n-2],P2=K[n-3];
        if(!C||!P||!P2) return pats;
        const Cb=Math.abs(C.c-C.o),Pb=Math.abs(P.c-P.o),P2b=Math.abs(P2.c-P2.o);
        if(P.c<P.o&&C.c>C.o&&C.o<=P.c&&C.c>=P.o&&Cb>Pb*1.05) pats.push({name:'🐂 Bullish Engulfing',signal:'bullish',winRate:78,desc:'Absorbed all prior selling. Strong reversal.'});
        if(P.c>P.o&&C.c<C.o&&C.o>=P.c&&C.c<=P.o&&Cb>Pb*1.05) pats.push({name:'🐻 Bearish Engulfing',signal:'bearish',winRate:78,desc:'Absorbed all prior buying. Distribution.'});
        if(P2.c<P2.o&&Pb/(P2b+0.001)<0.40&&C.c>C.o&&C.c>(P2.o+P2.c)/2) pats.push({name:'🌟 Morning Star',signal:'bullish',winRate:78,desc:'3-candle reversal. Selling exhaustion.'});
        if(P2.c>P2.o&&Pb/(P2b+0.001)<0.40&&C.c<C.o&&C.c<(P2.o+P2.c)/2) pats.push({name:'🌆 Evening Star',signal:'bearish',winRate:78,desc:'3-candle distribution. Buying exhaustion.'});
        if(P2.c>P2.o&&P.c>P.o&&C.c>C.o&&P.c>P2.c&&C.c>P.c&&P2b/(P2.h-P2.l+0.001)>0.50) pats.push({name:'⚔️ 3 White Soldiers',signal:'bullish',winRate:83,desc:'3 consecutive bullish. Institutional buying.'});
        if(P2.c<P2.o&&P.c<P.o&&C.c<C.o&&P.c<P2.c&&C.c<P.c&&P2b/(P2.h-P2.l+0.001)>0.50) pats.push({name:'🐦 3 Black Crows',signal:'bearish',winRate:83,desc:'3 consecutive bearish. Institutional distribution.'});
        if(P.c<P.o&&C.c>C.o&&C.o<P.l&&C.c>(P.o+P.c)/2&&C.c<P.o) pats.push({name:'🌙 Piercing Pattern',signal:'bullish',winRate:75,desc:'Bullish penetrates >50% of prior bearish.'});
        if(P.c>P.o&&C.c<C.o&&C.o>P.h&&C.c<(P.o+P.c)/2&&C.c>P.o) pats.push({name:'☁️ Dark Cloud Cover',signal:'bearish',winRate:75,desc:'Bearish penetrates >50% of prior bullish.'});
        if(C.h<=P.h&&C.l>=P.l) pats.push({name:'📦 Inside Bar',signal:C.c>C.o?'bullish':'bearish',winRate:76,desc:`Compression inside prior. Breakout ${C.c>C.o?'up':'down'} likely.`});
        if(K.length>=8){const pr=K[n-7]?.c||C.c;if(pr>0){const pm=(K[n-3]?.c-pr)/pr*100;const fl=Math.max(...K.slice(-4).map(k=>k.h))-Math.min(...K.slice(-4).map(k=>k.l));if(pm>5&&C.c>0&&fl/C.c*100<4) pats.push({name:'🏴 Bull Flag',signal:'bullish',winRate:85,desc:`+${pm.toFixed(1)}% impulse + coil. Target +${(pm*0.8).toFixed(1)}%.`});if(pm<-5&&fl/C.c*100<4) pats.push({name:'🏴 Bear Flag',signal:'bearish',winRate:85,desc:`${pm.toFixed(1)}% drop + bounce. Continuation lower.`});}}
      }
      if(pats.filter(p=>p.winRate>=75).length===0){
        if(ch24>1&&pricePos<0.18&&(ch7d||0)<-8) pats.push({name:'🔄 Double Bottom',signal:'bullish',winRate:75,desc:`At ${(ch7d||0).toFixed(0)}% weekly low with recovery.`});
        else if(pricePos>0.88&&ch24>4&&vol>30e6) pats.push({name:'🚀 Volume Breakout',signal:'bullish',winRate:82,desc:`Near high +${ch24.toFixed(1)}% + strong volume.`});
        else if((ch7d||0)>6&&ch24>-3&&ch24<3&&pricePos>0.35) pats.push({name:'🏴 Bull Flag (est.)',signal:'bullish',winRate:85,desc:`Weekly +${(ch7d||0).toFixed(1)}% + daily consolidation.`});
        else if((ch7d||0)<-6&&ch24<3&&ch24>-3&&pricePos<0.65) pats.push({name:'🏴 Bear Flag (est.)',signal:'bearish',winRate:85,desc:`Weekly ${(ch7d||0).toFixed(1)}% drop + bouncing.`});
      }
      return pats.filter(p=>p.winRate>=75).sort((a,b)=>b.winRate-a.winRate).slice(0,2);
    } catch { return []; }
  };

  // ── ELLIOTT WAVE (10 skenario) ─────────────────────────
  const ew = (rsi, ch24, ch7d_, macd, bullTF, bearTF) => {
    try {
      const ch7d=ch7d_||0;
      const uW=ch7d>3,dW=ch7d<-3,uD=ch24>1.5,dD=ch24<-1.5,oS=rsi<32,oB=rsi>70;
      const noW=!uW&&!dW; // no 7d data
      if((uW||noW)&&uD&&rsi>=42&&rsi<=65&&bullTF>=2&&(macd?.xUp||macd?.bull)) return{wave:'🚀 Wave 3 — Impulse',conf:80,desc:`${uW?`W7d +${ch7d.toFixed(0)}% + `:''}Daily +${ch24.toFixed(1)}%. Strongest phase. Target 1.618x.`};
      if((uW||noW)&&uD&&rsi>=55&&rsi<75&&macd?.bull&&!macd?.divergence) return{wave:'⚡ Wave 3 Extension',conf:72,desc:`Continuation impulse. Trailing stop from swing low.`};
      if(uW&&dD&&oS) return{wave:'📉 Wave 2 Pullback',conf:78,desc:`Correction in uptrend. RSI ${rsi.toFixed(0)} oversold — BEST ENTRY. Tight stop below recent low.`};
      if((uW||noW)&&rsi>=35&&rsi<48&&dD&&!oS) return{wave:'📉 Wave 2 / OTE Entry',conf:68,desc:`Pullback into OTE (61.8-78.6%). Entry before Wave 3 continuation.`};
      if(uW&&dD&&rsi>=38&&rsi<=55&&!oS) return{wave:'⚖️ Wave 4 Correction',conf:65,desc:`Consolidation before final leg. Don't FOMO above.`};
      if((uW&&ch7d>15||(!uW&&!dW&&ch24>8))&&oB&&macd?.divergence) return{wave:'⚠️ Wave 5 Ending',conf:68,desc:`RSI divergence + extended. LIKELY PEAK. Partial profits now.`};
      if((uW&&oB||(!uW&&!dW&&rsi>68))&&!macd?.divergence) return{wave:'⚡ Wave 5 Progress',conf:60,desc:`Overbought, no divergence yet. Tight trailing stop.`};
      if((dW||noW&&dD)&&uD&&oS) return{wave:'🔄 Wave C Complete',conf:74,desc:`RSI ${rsi.toFixed(0)} oversold + daily reversal. Potential bottom. Confirm with candle.`};
      if((dW||noW&&dD)&&uD&&ch24>4&&!oS) return{wave:'🔄 Wave C → MSS',conf:67,desc:`Market Structure Shift: daily up in downtrend context. Monitor volume.`};
      if(oS&&bearTF>=2) return{wave:'💎 Wave C Capitulation',conf:74,desc:`Capitulation zone. RSI ${rsi.toFixed(0)} extreme. Near-term bottom high probability.`};
      if((dW||dD)&&bearTF>=2&&rsi<45&&!oS) return{wave:'📉 Wave A/C Bearish',conf:70,desc:`${dW?`Weekly ${ch7d.toFixed(0)}%`:`Daily ${ch24.toFixed(1)}%`} downtrend active. Avoid catch falling knife.`};
      if(noW&&!uD&&!dD&&Math.abs(ch24)<2) return{wave:'⚖️ Sideways / Coiling',conf:56,desc:`Compression. Breakout imminent. Watch volume spike.`};
      if(uD&&!dW) return{wave:'↗️ Impulse Building',conf:55,desc:`Positive daily. Weekly confirmation needed.`};
      return{wave:'⚖️ Corrective Phase',conf:50,desc:`Consolidation. Wait for clear setup.`};
    } catch { return{wave:'⚖️ Corrective Phase',conf:50,desc:'Analysis in progress.'}; }
  };

  // ── ASTRO ─────────────────────────────────────────────
  const astro = (() => {
    try {
      const jd=Date.now()/86400000+2440587.5,dnm=((jd-2460320.5)%29.53058867+29.53058867)%29.53058867;
      const ph=[[1.5,'New Moon','🌑'],[8.5,'First Quarter','🌓'],[16,'Full Moon','🌕'],[22,'Waning','🌖'],[29.5,'Waning Crescent','🌘']];
      let moonPhase='Dark Moon',moonEmoji='🌑';
      for(const[l,p,e]of ph)if(dnm<l){moonPhase=p;moonEmoji=e;break;}
      const dsh=Math.floor((Date.now()-1713571200000)/86400000);
      return{moonPhase,moonEmoji,halvingPhase:dsh<365?'Bull Early 🔥':dsh<480?'Bull Peak ⚡':dsh<730?'Distribution ⚠️':'Accumulation 🌱',chaotic:moonPhase==='Full Moon'||moonPhase==='New Moon'};
    } catch { return{moonPhase:'—',moonEmoji:'🌙',halvingPhase:'Bull Cycle',chaotic:false}; }
  })();

  // ── PARSE TICKERS ─────────────────────────────────────
  const parseCG = (arr) => (arr||[]).filter(c=>c&&c.current_price>0).map(c=>({
    sym:(c.symbol||'').toUpperCase(),name:c.name||c.symbol||'',
    price:c.current_price,ch24:c.price_change_percentage_24h||0,ch7d:c.price_change_percentage_7d||null,
    vol:c.total_volume||0,h24:c.high_24h||c.current_price*1.02,l24:c.low_24h||c.current_price*0.98,
    mcap:c.market_cap||0,mcapRank:c.market_cap_rank||9999,src:'coingecko',
  }));

  const parseMEXC = (arr) => (arr||[]).filter(t=>t?.symbol?.endsWith('USDT')).map(t=>{
    const sym=t.symbol.replace('USDT','');
    const price=+(t.lastPrice||0),ch24=+(t.priceChangePercent||0),vol=+(t.quoteVolume||0);
    const h24=+(t.highPrice||price*1.02),l24=+(t.lowPrice||price*0.98);
    if(!sym||price<=0||vol<200000) return null;
    if(STABLES.has(sym)) return null;
    if(IGNORE.has(t.symbol)) return null;
    if(NO_SFX.some(p=>sym.endsWith(p)||sym.startsWith(p))) return null;
    if(sym.length>14) return null;
    if(price>=0.97&&price<=1.03&&Math.abs(ch24)<0.5) return null;
    return{sym,name:sym,price,ch24,ch7d:null,vol,h24,l24,mcap:0,mcapRank:9999,src:'mexc'};
  }).filter(Boolean);

  const parseBybit = (arr) => (arr||[]).filter(t=>t?.symbol?.endsWith('USDT')).map(t=>{
    const sym=t.symbol.replace('USDT','');
    const price=+(t.lastPrice||0),ch24=t.price24hPcnt?+(+t.price24hPcnt*100).toFixed(3):0,vol=+(t.turnover24h||0);
    const h24=+(t.highPrice24h||price*1.02),l24=+(t.lowPrice24h||price*0.98);
    if(!sym||price<=0||vol<200000) return null;
    if(STABLES.has(sym)) return null;
    return{sym,name:sym,price,ch24,ch7d:null,vol,h24,l24,mcap:0,mcapRank:9999,src:'bybit'};
  }).filter(Boolean);

  try {
    // ══════════════════════════════════════════════════════
    // ALL PARALLEL: CoinGecko + MEXC + Bybit Spot + CC + F&G
    // CoinGecko fails → MEXC+Bybit still provide 500-800 coins
    // Total time: max(all) ≈ 6-7s ✅
    // ══════════════════════════════════════════════════════
    const [cgR, mexcR, bybitR, ccBatchR, fngR] = await Promise.allSettled([
      sf('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=volume_desc&per_page=250&page=1&sparkline=false&price_change_percentage=24h,7d', 6000),
      sf('https://api.mexc.com/api/v3/ticker/24hr', 8000),
      sf('https://api.bybit.com/v5/market/tickers?category=spot', 6000),
      Promise.allSettled(TOP30_CC.map(sym=>sf(`https://min-api.cryptocompare.com/data/v2/histohour?fsym=${sym}&tsym=USD&limit=42&aggregate=4&e=CCCAGG`,5000))),
      sf('https://api.alternative.me/fng/?limit=1&format=json', 4000),
    ]);

    const fg = fngR.status==='fulfilled'?parseInt(fngR.value?.data?.[0]?.value||50):50;

    // Parse all sources
    const cgCoins  = cgR.status==='fulfilled'&&Array.isArray(cgR.value)?parseCG(cgR.value):[];
    const mexcCoins= mexcR.status==='fulfilled'&&Array.isArray(mexcR.value)?parseMEXC(mexcR.value):[];
    const bybitCoins=bybitR.status==='fulfilled'&&Array.isArray(bybitR.value?.result?.list)?parseBybit(bybitR.value.result.list):[];

    // Check if we have ANY data
    if (!cgCoins.length && !mexcCoins.length && !bybitCoins.length) {
      return res.status(200).json({ok:false,error:'Semua sumber data tidak merespons. Coba lagi dalam 30 detik.',ts:Date.now(),totalScanned:0,totalQualified:0,results:[],topSetups:{institutional:[],fullSend:[],highProbBull:[],smcSetups:[],ewSetups:[],volumeBreakout:[],strongSell:[]},marketOverview:{marketMood:'UNKNOWN',bullishCount:0,bearishCount:0,avgChange24h:0}});
    }

    // Merge: CoinGecko (priority) + MEXC + Bybit (no duplicates)
    const seen = new Set();
    const allCoins = [];
    // 1. CoinGecko first (best data)
    for(const c of cgCoins){if(!seen.has(c.sym)){seen.add(c.sym);allCoins.push(c);}}
    // 2. MEXC next (sort by volume, take top 700)
    const mexcSorted=mexcCoins.sort((a,b)=>b.vol-a.vol).slice(0,700);
    for(const c of mexcSorted){if(!seen.has(c.sym)){seen.add(c.sym);allCoins.push(c);}}
    // 3. Bybit spot as supplement
    const bybitSorted=bybitCoins.sort((a,b)=>b.vol-a.vol).slice(0,400);
    for(const c of bybitSorted){if(!seen.has(c.sym)){seen.add(c.sym);allCoins.push(c);}}

    // Parse CryptoCompare klines
    const rsiMap = {};
    const ccBatch = ccBatchR.status==='fulfilled'?ccBatchR.value:[];
    ccBatch.forEach((r,i)=>{
      try{
        if(r.status!=='fulfilled'||r.value?.Response!=='Success') return;
        const raw=r.value?.Data?.Data;if(!raw||raw.length<16) return;
        const K=raw.filter(d=>d.close>0&&d.close<1e12).map(d=>({t:+d.time,o:+d.open,h:+d.high,l:+d.low,c:+d.close,v:+(d.volumeto||0)}));
        if(K.length<16) return;
        const closes=K.map(k=>k.c);
        const rsi=RSI14(closes);if(rsi===null) return;
        const ema9=EMA(closes,9),ema21=EMA(closes,21),ema50=EMA(closes,Math.min(50,closes.length-1));
        const macd=MACD_SIG(closes);
        const smc=smcKlines(K,closes[closes.length-1]);
        rsiMap[TOP30_CC[i]]={rsi,ema9,ema21,ema50,macd,K,closes,hasReal:true,smc};
      } catch{}
    });

    // Analyze
    const results=[];
    for(const c of allCoins){
      try{
        const {sym,name,price,ch24,ch7d,vol,h24,l24,mcap,mcapRank,src}=c;
        if(!sym||price<=0||vol<100000) continue;
        const pricePos=h24>l24?(price-l24)/(h24-l24):0.5;
        const range=h24>l24?(h24-l24)/price*100:0;
        const vt=vol>=1e9?5:vol>=200e6?4:vol>=50e6?3:vol>=10e6?2:vol>=1e6?1:0;
        const volRatio=mcap>0?vol/mcap:0;
        const kd=rsiMap[sym]||null;
        const rsi=kd?.hasReal?kd.rsi:Math.max(10,Math.min(90,50+ch24*2.5+(pricePos-0.5)*25+((ch7d||0)>0?4:-4)));
        const rsiR=!!(kd?.hasReal);
        let emaS=0;
        if(kd?.closes?.length>=20){const lp=kd.closes[kd.closes.length-1];if(lp>kd.ema9)emaS++;if(lp>kd.ema21)emaS++;if(lp>kd.ema50)emaS++;}
        else{if(ch24>0)emaS++;if((ch7d||0)>0)emaS++;if(pricePos>0.55)emaS++;}
        const t1h=rsi>58?'BULL':rsi<42?'BEAR':'SIDE';
        const t4h=(kd?.macd?.bull||(ch24>1.5&&pricePos>0.5))?'BULL':(ch24<-1.5&&pricePos<0.5)?'BEAR':'SIDE';
        const t1d=(ch7d||0)>3?'BULL':(ch7d||0)<-3?'BEAR':'SIDE';
        const bullTF=[t1h,t4h,t1d].filter(t=>t==='BULL').length;
        const bearTF=[t1h,t4h,t1d].filter(t=>t==='BEAR').length;
        const smcR=kd?.smc||smcBasic(price,h24,l24,ch24,ch7d||0);
        const pats=chartPat(kd?.K||null,price,h24,l24,ch24,ch7d,pricePos,vol);
        const ewR=ew(rsi,ch24,ch7d,kd?.macd||null,bullTF,bearTF);
        const tC=bullTF===3?28:bullTF===2?16:bullTF===1?6:bearTF===3?-28:bearTF===2?-16:bearTF===1?-6:0;
        const rC=rsi<25?(bearTF>=2?4:14):rsi<32?(bearTF>=2?3:10):rsi<40?(bearTF>=2?2:5):rsi<48?1:rsi>75?(bullTF>=2?-4:-14):rsi>68?(bullTF>=2?-3:-10):rsi>60?(bullTF>=2?-1:-5):rsi>52?4:0;
        const mW=(ch7d||0)>20?10:(ch7d||0)>8?6:(ch7d||0)>3?3:(ch7d||0)<-20?-10:(ch7d||0)<-8?-6:(ch7d||0)<-3?-3:0;
        const m24=ch24>10?6:ch24>4?3:ch24>1?1:ch24<-10?-6:ch24<-4?-3:ch24<-1?-1:0;
        const mC=kd?.macd?.xUp?8:kd?.macd?.xDown?-8:kd?.macd?.bull?3:kd?.macd?.bear?-3:0;
        const smcC=(smcR?.inBullOB?3:0)+(smcR?.hasBOS&&smcR?.bosType?.includes('Bull')?3:0)+(smcR?.hasCHoCH&&smcR?.chochType?.includes('Bull')?2:0)+(smcR?.inBullFVG?1:0)-(smcR?.inBearOB?3:0)-(smcR?.hasBOS&&smcR?.bosType?.includes('Bear')?3:0);
        const pC=pats.some(p=>p.signal==='bullish'&&p.winRate>=80)?3:pats.some(p=>p.signal==='bullish')?1:pats.some(p=>p.signal==='bearish'&&p.winRate>=80)?-3:pats.some(p=>p.signal==='bearish')?-1:0;
        const ewC=ewR.wave.includes('Wave 3')?4:ewR.wave.includes('Wave 2')?2:ewR.wave.includes('C Complete')||ewR.wave.includes('Capitulation')?3:ewR.wave.includes('Bearish')||ewR.wave.includes('Wave 5 End')?-2:0;
        const rawP=50+tC+rC+mW+m24+mC+smcC+pC+ewC;
        const prob=Math.max(2,Math.min(98,Math.round(rawP)));
        const score=tC+rC+mW+m24+mC+smcC;
        let taLabel='⚖️ SIDEWAYS',taColor='neutral';
        if(bullTF===3){taLabel='🚀 FULL SEND';taColor='full-bull';}
        else if(bullTF>=2){taLabel='📈 STRONG BULL';taColor='bull';}
        else if(bullTF===1&&bearTF===0){taLabel='↗️ MILD BULL';taColor='bull';}
        else if(bearTF===3){taLabel='💀 FULL BEAR';taColor='full-bear';}
        else if(bearTF>=2){taLabel='📉 STRONG BEAR';taColor='bear';}
        else if(bearTF===1&&bullTF===0){taLabel='↘️ MILD BEAR';taColor='bear';}
        const smcDisp=kd?.smc?.hasBOS?kd.smc.bosType:kd?.smc?.hasCHoCH?'CHoCH':kd?.smc?.inBullOB?'Bull OB':kd?.smc?.inBearOB?'Bear OB':kd?.smc?.inBullFVG?'Bull FVG':smcR?.signal||'Neutral';
        const sigs=[];
        if(rsi<25)  sigs.push(`RSI ${rsi.toFixed(0)} extreme oversold 🎯`);
        else if(rsi<32) sigs.push(`RSI ${rsi.toFixed(0)} oversold${bearTF>=2?' — reversal watch':', entry zone'}`);
        else if(rsi>74) sigs.push(`RSI ${rsi.toFixed(0)} overbought${bullTF>=2?' — reduce size',''}`);
        if(kd?.macd?.xUp)    sigs.push('MACD golden cross ✅');
        if(kd?.macd?.xDown)  sigs.push('MACD death cross ⚠️');
        if(kd?.macd?.divergence) sigs.push('MACD divergence — trend weakening ⚠️');
        if(smcR?.bullOB)     sigs.push(`Bull OB $${smcR.bullOB.low}-${smcR.bullOB.high}`);
        if(smcR?.bearOB)     sigs.push(`Bear OB $${smcR.bearOB.low}-${smcR.bearOB.high}`);
        if(smcR?.bullFVG)    sigs.push(`Bull FVG ${smcR.bullFVG.gapPct}% gap`);
        if(smcR?.liqSweep)   sigs.push(`${smcR.liqSweep.type} $${smcR.liqSweep.level}`);
        if(smcR?.hasCHoCH)   sigs.push(`${smcR.chochType}`);
        if(smcR?.hasBOS&&ch24>5)  sigs.push(`${smcR.bosType} $${smcR.bosLevel}`);
        if(smcR?.inOTE)      sigs.push(`In OTE zone (ICT 61.8-78.6%)`);
        if(vt>=4&&ch24>3)    sigs.push(`$${['','','','','200M+','1B+'][vt]} vol +${ch24.toFixed(1)}%`);
        if(bullTF===3)       sigs.push('All TF aligned 🎯');
        pats.forEach(p=>sigs.push(`${p.name} (${p.winRate}%): ${p.desc}`));
        results.push({
          rank:results.length+1,symbol:sym,name,
          price,change24h:+ch24.toFixed(2),change7d:ch7d!==null?+ch7d.toFixed(2):null,
          volume24h:vol,mcap,mcapRank,
          high24h:h24,low24h:l24,pricePos:+pricePos.toFixed(3),range:+range.toFixed(2),
          rsi:+rsi.toFixed(2),rsiReal:rsiR,vt,volRatio:+volRatio.toFixed(4),
          dataSource:src,
          trendAlignment:taLabel,taColor,trend1h:t1h,trend4h:t4h,trend1d:t1d,bullTF,bearTF,
          smc:{...smcR,signal:smcDisp},
          elliottWave:{wave:ewR.wave,confidence:ewR.conf,description:ewR.desc},
          chartPatterns:pats.length>0?pats:[{name:ch24>=0?'Bullish Candle':'Bearish Candle',signal:ch24>=0?'bullish':'bearish',winRate:0}],
          probability:prob,score,
          signals:sigs.slice(0,5),
          astrology:{moonPhase:astro.moonPhase,moonEmoji:astro.moonEmoji,halvingPhase:astro.halvingPhase,chaotic:astro.chaotic},
          hasRealData:rsiR,
        });
      } catch {}
    }

    results.sort((a,b)=>b.probability-a.probability||b.score-a.score);
    results.forEach((r,i)=>r.rank=i+1);

    const institutional  =results.filter(r=>r.score>=16&&r.probability>=60&&r.volume24h>=5e6).slice(0,100);
    const fullSend       =results.filter(r=>(r.taColor==='full-bull'||r.bullTF===3)&&r.probability>=65).slice(0,80);
    const highProbBull   =results.filter(r=>r.probability>=68&&r.score>=12).slice(0,80);
    const smcSetups      =results.filter(r=>(r.smc?.inBullOB||r.smc?.inBullFVG||r.smc?.hasCHoCH)&&r.probability>=52).slice(0,80);
    const ewSetups       =results.filter(r=>{const w=r.elliottWave?.wave||'';return(w.includes('Wave 3')||w.includes('Wave 2'))?r.probability>=52:(w.includes('C Complete')||w.includes('Capitulation'))?r.probability>=50:(r.rsi<38&&r.change24h>0)?r.probability>=48:false;}).sort((a,b)=>b.probability-a.probability).slice(0,80);
    const volumeBreakout =results.filter(r=>r.vt>=3&&r.change24h>1.5&&r.probability>50).sort((a,b)=>b.volume24h-a.volume24h).slice(0,80);
    const strongSell     =results.filter(r=>r.probability<38||r.taColor==='full-bear').sort((a,b)=>a.probability-b.probability).slice(0,50);
    const bullC=results.filter(r=>r.probability>55).length,bearC=results.filter(r=>r.probability<45).length;
    const avgCh=results.length?+(results.reduce((s,r)=>s+r.change24h,0)/results.length).toFixed(2):0;
    const mood=avgCh>3?'STRONG BULL':avgCh>1?'BULL':avgCh<-3?'STRONG BEAR':avgCh<-1?'BEAR':'NEUTRAL';

    return res.status(200).json({
      ok:true,ts:Date.now(),elapsed:Date.now()-t0,version:'v23',
      src:`cg:${cgCoins.length}+mexc:${mexcCoins.length}+bybit:${bybitCoins.length}`,
      fg,totalScanned:allCoins.length,totalQualified:results.length,
      rsiRealCount:Object.keys(rsiMap).length,
      results,
      topSetups:{institutional,fullSend,highProbBull,smcSetups,ewSetups,volumeBreakout,strongSell},
      marketOverview:{marketMood:mood,bullishCount:bullC,bearishCount:bearC,avgChange24h:avgCh,totalCoins:results.length},
      astroContext:astro,
    });
  } catch(e) {
    return res.status(200).json({ok:false,error:e.message,ts:Date.now(),elapsed:Date.now()-t0,version:'v23',totalScanned:0,totalQualified:0,results:[],topSetups:{institutional:[],fullSend:[],highProbBull:[],smcSetups:[],ewSetups:[],volumeBreakout:[],strongSell:[]},marketOverview:{marketMood:'UNKNOWN',bullishCount:0,bearishCount:0,avgChange24h:0}});
  }
}
