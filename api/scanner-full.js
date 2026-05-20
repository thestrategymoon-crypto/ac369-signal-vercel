// api/scanner-full.js — v24 CLEAN & POWERFUL
// 750 koin: CoinGecko(250) + MEXC(500) parallel
// Semua berjalan max 5s — aman Vercel 10s
// ICT/SMC + EW 10 skenario + 12 chart patterns ≥75%

const CC_SYMS = ['BTC','ETH','BNB','SOL','XRP','ADA','DOGE','AVAX','LINK','DOT',
                 'NEAR','SUI','APT','ARB','OP','PEPE','TON','INJ','TIA','RENDER'];

const STABLE = new Set(['USDT','USDC','BUSD','DAI','TUSD','FDUSD','USDD','FRAX',
                        'GUSD','USDP','LUSD','PYUSD','SUSD','USDB','EURC']);
const BAD_SFX = ['UP','DOWN','BULL','BEAR','LONG','SHORT','3L','3S'];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Cache-Control','s-maxage=30,stale-while-revalidate=15');
  if (req.method==='OPTIONS') return res.status(200).end();
  const t0 = Date.now();

  const sf = async (url, ms) => {
    const ctl = new AbortController();
    const tmr = setTimeout(() => ctl.abort(), ms);
    try {
      const r = await fetch(url, {signal:ctl.signal, headers:{Accept:'application/json','User-Agent':'AC369/1.0'}});
      clearTimeout(tmr);
      if (!r.ok) return null;
      return await r.json();
    } catch { clearTimeout(tmr); return null; }
  };

  // ── RSI ───────────────────────────────────────────────
  const rsi14 = a => {
    if (!a||a.length<16) return null;
    let g=0,l=0;
    for (let i=1;i<=14;i++){const d=a[i]-a[i-1];d>0?g+=d:l-=d;}
    g/=14;l/=14;
    for (let i=15;i<a.length;i++){const d=a[i]-a[i-1];g=(g*13+Math.max(d,0))/14;l=(l*13+Math.max(-d,0))/14;}
    return l===0?100:+(100-100/(1+g/l)).toFixed(2);
  };

  // ── EMA ───────────────────────────────────────────────
  const ema = (a,p) => {
    if (!a||a.length<2) return a?.[a.length-1]||0;
    const k=2/(p+1);
    let e=a.slice(0,Math.min(p,a.length)).reduce((s,v)=>s+v,0)/Math.min(p,a.length);
    for (let i=Math.min(p,a.length);i<a.length;i++) e=a[i]*k+e*(1-k);
    return e;
  };

  // ── MACD ──────────────────────────────────────────────
  const macdSig = a => {
    if (!a||a.length<36) return {bull:false,bear:false,xUp:false,xDown:false,div:false};
    const k12=2/13,k26=2/27,k9=2/10;
    let e12=a.slice(0,12).reduce((s,v)=>s+v,0)/12;
    let e26=a.slice(0,26).reduce((s,v)=>s+v,0)/26;
    const mv=[];
    for (let i=26;i<a.length;i++){e12=a[i]*k12+e12*(1-k12);e26=a[i]*k26+e26*(1-k26);mv.push(e12-e26);}
    let sig=mv.slice(0,9).reduce((s,v)=>s+v,0)/9;
    for (let i=9;i<mv.length;i++) sig=mv[i]*k9+sig*(1-k9);
    const n=mv.length,last=mv[n-1],prev=mv[n-2]||last,h=last-sig,ph=prev-sig;
    const div=n>6&&last<mv[n-7]&&a[a.length-1]>a[a.length-7];
    return {bull:last>0&&h>0,bear:last<0&&h<0,xUp:h>0&&ph<=0,xDown:h<0&&ph>=0,div};
  };

  // ── ICT/SMC FROM KLINES (full detail) ────────────────
  const smcFull = (K, p) => {
    if (!K||K.length<10) return null;
    const n=K.length;
    // Swing points
    const SH=[],SL=[];
    for (let i=2;i<n-2;i++){
      if (K[i]?.h>K[i-1]?.h&&K[i]?.h>K[i+1]?.h) SH.push({i,p:K[i].h});
      if (K[i]?.l<K[i-1]?.l&&K[i]?.l<K[i+1]?.l) SL.push({i,p:K[i].l});
    }
    const rSH=SH.slice(-3),rSL=SL.slice(-3);
    const lSH=rSH[rSH.length-1]?.p||0;
    const lSL=rSL[rSL.length-1]?.p||1e12;
    const pSH=rSH[rSH.length-2]?.p||0;
    const pSL=rSL[rSL.length-2]?.p||1e12;

    // BOS / CHoCH
    let bos=null,choch=null;
    if (p>lSH&&lSH>0&&K[n-3]?.c<lSH) bos={type:'Bullish BOS',level:+lSH.toFixed(6)};
    else if (p<lSL&&lSL<1e12&&K[n-3]?.c>lSL) bos={type:'Bearish BOS',level:+lSL.toFixed(6)};
    if (!bos&&pSH>0&&p>pSH&&K[n-5]?.c<pSH) choch={type:'Bullish CHoCH (MSS)',level:+pSH.toFixed(6)};
    if (!bos&&pSL<1e12&&p<pSL&&K[n-5]?.c>pSL) choch={type:'Bearish CHoCH (MSS)',level:+pSL.toFixed(6)};

    // Order Blocks
    let bOB=null,beOB=null;
    for (let i=Math.max(0,n-14);i<n-2;i++){
      const c=K[i],nx=K[i+1];
      if (!c||!nx) continue;
      if (c.c<c.o&&nx.c>nx.o&&nx.c>c.o*1.002){
        const H=Math.max(c.o,c.c),L=Math.min(c.o,c.c);
        if (!bOB&&p<=H*1.01&&p>=L*0.995) bOB={H:+H.toFixed(6),L:+L.toFixed(6),fresh:i>n-8};
      }
      if (c.c>c.o&&nx.c<nx.o&&nx.c<c.o*0.998){
        const H=Math.max(c.o,c.c),L=Math.min(c.o,c.c);
        if (!beOB&&p<=H*1.005&&p>=L*0.99) beOB={H:+H.toFixed(6),L:+L.toFixed(6),fresh:i>n-8};
      }
    }

    // FVG
    let bFVG=null,beFVG=null;
    for (let i=Math.max(0,n-12);i<n-2;i++){
      if (!K[i]||!K[i+2]) continue;
      const g=K[i+2].l-K[i].h;
      if (g>0&&p>=K[i].h&&p<=K[i+2].l) bFVG={pct:+(g/K[i].h*100).toFixed(2),L:+K[i].h.toFixed(6),H:+K[i+2].l.toFixed(6)};
      const g2=K[i].l-K[i+2].h;
      if (g2>0&&p>=K[i+2].h&&p<=K[i].l) beFVG={pct:+(g2/K[i].l*100).toFixed(2)};
    }

    // Liquidity Sweep
    let sweep=null;
    if (rSL.length>0&&n>=2){const s=rSL[rSL.length-1];if(K[n-2]?.l<s.p&&K[n-1]?.c>s.p) sweep={t:'Bull SSL Sweep',lv:+s.p.toFixed(6)};}
    if (rSH.length>0&&n>=2){const s=rSH[rSH.length-1];if(K[n-2]?.h>s.p&&K[n-1]?.c<s.p) sweep={t:'Bear BSL Sweep',lv:+s.p.toFixed(6)};}

    // Equal H/L (BSL/SSL pools)
    let eqH=null,eqL=null;
    if (rSH.length>=2){const d=Math.abs(rSH[rSH.length-1].p-rSH[rSH.length-2].p)/(rSH[rSH.length-1].p||1);if(d<0.006)eqH=+rSH[rSH.length-1].p.toFixed(6);}
    if (rSL.length>=2){const d=Math.abs(rSL[rSL.length-1].p-rSL[rSL.length-2].p)/(rSL[rSL.length-1].p||1);if(d<0.006)eqL=+rSL[rSL.length-1].p.toFixed(6);}

    // Zone
    const kH=Math.max(...K.slice(-20).map(k=>k.h||0));
    const kL=Math.min(...K.slice(-20).map(k=>k.l||1e12));
    const kR=kH-kL; const eq=(kH+kL)/2;
    const pip=kR>0?+((p-kL)/kR*100).toFixed(1):50;
    const zone=pip>70?'Premium Zone':pip>55?'Slight Premium':pip<30?'Discount Zone':pip<45?'Slight Discount':'Equilibrium';
    const oteH=+(eq+(kH-eq)*0.382).toFixed(6);
    const oteL=+(eq-(eq-kL)*0.382).toFixed(6);
    const inOTE=p>=oteL&&p<=oteH;

    const bS=(!!bOB?2:0)+(!!bFVG?1:0)+(bos?.type?.includes('Bull')?3:0)+(choch?.type?.includes('Bull')?2:0)+(sweep?.t?.includes('Bull')?2:0)+(inOTE&&p<eq?1:0);
    const beS=(!!beOB?2:0)+(!!beFVG?1:0)+(bos?.type?.includes('Bear')?3:0)+(choch?.type?.includes('Bear')?2:0)+(sweep?.t?.includes('Bear')?2:0)+(inOTE&&p>eq?1:0);

    return {
      hasBOS:!!bos, bosType:bos?.type||'None', bosLevel:bos?.level,
      hasCHoCH:!!choch, chochType:choch?.type||'None', chochLevel:choch?.level,
      bOB, beOB, inBullOB:!!bOB, inBearOB:!!beOB,
      bFVG, beFVG, inBullFVG:!!bFVG,
      sweep, eqH, eqL,
      zone, pip, inOTE, oteH, oteL,
      signal:bS>beS?'Bullish':beS>bS?'Bearish':'Neutral',
      bull:bS, bear:beS,
    };
  };

  // ── ICT/SMC ESTIMATED (from OHLC only) ───────────────
  const smcEst = (p, h, l, ch24, ch7d) => {
    const pip=h>l?(p-l)/(h-l)*100:50;
    const zone=pip>70?'Premium Zone':pip<30?'Discount Zone':'Equilibrium';
    const hasBOS=Math.abs(ch24)>5;
    const bosType=ch24>5?'Bullish BOS':ch24<-5?'Bearish BOS':'None';
    const hasCHoCH=ch24>3&&(ch7d||0)<0;
    const inBullOB=pip<28, inBearOB=pip>72;
    const bS=(hasBOS&&bosType.includes('Bull')?3:0)+(inBullOB?2:0)+(hasCHoCH?2:0);
    const beS=(hasBOS&&bosType.includes('Bear')?3:0)+(inBearOB?2:0);
    return {
      hasBOS, bosType, bosLevel:hasBOS&&ch24>5?+(h*0.98).toFixed(6):hasBOS?+(l*1.02).toFixed(6):null,
      hasCHoCH, chochType:hasCHoCH?'Bullish CHoCH (MSS)':'None',
      inBullOB, inBearOB,
      bOB:inBullOB?{H:+(l+(h-l)*0.28).toFixed(6),L:+l.toFixed(6)}:null,
      beOB:inBearOB?{H:+h.toFixed(6),L:+(l+(h-l)*0.72).toFixed(6)}:null,
      inBullFVG:pip<15, zone, pip:+pip.toFixed(1),
      signal:bS>beS?'Bullish':beS>bS?'Bearish':'Neutral',
      bull:bS, bear:beS,
    };
  };

  // ── CHART PATTERNS ≥75% (12 patterns) ────────────────
  const patterns = (K, p, h, l, ch24, ch7d, pPos, vol) => {
    const pats=[];
    try {
      const op = p>0&&ch24>-99 ? p/(1+ch24/100) : p;
      const rng = h-l;
      if (rng>0) {
        const bd=Math.abs(p-op)/rng;
        const lw=(Math.min(p,op)-l)/rng;
        const uw=(h-Math.max(p,op))/rng;
        if (lw>0.55&&bd<0.30&&uw<0.20&&pPos<0.45) pats.push({name:'🔨 Hammer',signal:'bullish',wr:76,desc:`Buyers rejected $${l.toFixed(4)}.`});
        if (uw>0.55&&bd<0.30&&lw<0.20&&pPos>0.55) pats.push({name:'⭐ Shooting Star',signal:'bearish',wr:75,desc:`Sellers rejected $${h.toFixed(4)}.`});
        if (bd>0.75&&ch24>3&&p>op) pats.push({name:'🐂 Bull Marubozu',signal:'bullish',wr:77,desc:`+${ch24.toFixed(1)}% strong body. Full buy control.`});
        if (bd>0.75&&ch24<-3&&p<op) pats.push({name:'🐻 Bear Marubozu',signal:'bearish',wr:77,desc:`${ch24.toFixed(1)}% strong body. Full sell control.`});
        if (uw>0.50&&bd<0.30&&lw<0.20&&pPos<0.40&&ch24>0) pats.push({name:'🔨 Inverted Hammer',signal:'bullish',wr:75,desc:`Upper wick rejection. Confirm next candle.`});
      }
      if (K&&K.length>=3) {
        const n=K.length,C=K[n-1],P=K[n-2],P2=K[n-3];
        if (C&&P&&P2) {
          const Cb=Math.abs(C.c-C.o),Pb=Math.abs(P.c-P.o),P2b=Math.abs(P2.c-P2.o);
          if (P.c<P.o&&C.c>C.o&&C.o<=P.c&&C.c>=P.o&&Cb>Pb) pats.push({name:'🐂 Bullish Engulfing',signal:'bullish',wr:78,desc:'Buyers absorbed all selling. Strong reversal signal.'});
          if (P.c>P.o&&C.c<C.o&&C.o>=P.c&&C.c<=P.o&&Cb>Pb) pats.push({name:'🐻 Bearish Engulfing',signal:'bearish',wr:78,desc:'Sellers absorbed all buying. Distribution signal.'});
          const P2r=P2.h-P2.l;
          if (P2.c<P2.o&&P2r>0&&Pb/(P2b+0.001)<0.4&&C.c>C.o&&C.c>(P2.o+P2.c)/2) pats.push({name:'🌟 Morning Star',signal:'bullish',wr:78,desc:'3-candle reversal. Selling exhaustion complete.'});
          if (P2.c>P2.o&&P2r>0&&Pb/(P2b+0.001)<0.4&&C.c<C.o&&C.c<(P2.o+P2.c)/2) pats.push({name:'🌆 Evening Star',signal:'bearish',wr:78,desc:'3-candle distribution. Buying exhaustion.'});
          if (P2.c>P2.o&&P.c>P.o&&C.c>C.o&&P.c>P2.c&&C.c>P.c&&P2b/(P2r+0.001)>0.5) pats.push({name:'⚔️ 3 White Soldiers',signal:'bullish',wr:83,desc:'3 consecutive bullish. Institutional accumulation.'});
          if (P2.c<P2.o&&P.c<P.o&&C.c<C.o&&P.c<P2.c&&C.c<P.c&&P2b/(P2r+0.001)>0.5) pats.push({name:'🐦 3 Black Crows',signal:'bearish',wr:83,desc:'3 consecutive bearish. Institutional distribution.'});
          if (P.c<P.o&&C.c>C.o&&C.o<P.l&&C.c>(P.o+P.c)/2) pats.push({name:'🌙 Piercing Pattern',signal:'bullish',wr:75,desc:'Bullish penetrates >50% of prior bearish body.'});
          if (P.c>P.o&&C.c<C.o&&C.o>P.h&&C.c<(P.o+P.c)/2) pats.push({name:'☁️ Dark Cloud Cover',signal:'bearish',wr:75,desc:'Bearish penetrates >50% of prior bullish body.'});
          if (C.h<=P.h&&C.l>=P.l) pats.push({name:'📦 Inside Bar / NR4',signal:C.c>=C.o?'bullish':'bearish',wr:76,desc:'Compression inside prior candle. Breakout imminent.'});
          if (K.length>=8) {
            const ref=K[n-7]?.c||0;
            if (ref>0) {
              const mv=(K[n-3]?.c||p-ref)/ref*100;
              const fl=Math.max(...K.slice(-4).map(k=>k.h))-Math.min(...K.slice(-4).map(k=>k.l));
              const tightCoil=C.c>0&&fl/C.c*100<5;
              if (mv>5&&tightCoil) pats.push({name:'🏴 Bull Flag',signal:'bullish',wr:85,desc:`+${mv.toFixed(1)}% impulse → tight coil. Target +${(mv*0.8).toFixed(1)}%.`});
              if (mv<-5&&tightCoil) pats.push({name:'🏴 Bear Flag',signal:'bearish',wr:85,desc:`${mv.toFixed(1)}% drop → bounce. Continuation lower.`});
            }
          }
        }
      }
      // Estimates from price data when no kline patterns
      if (pats.filter(p=>p.wr>=75).length===0) {
        const w7=ch7d||0;
        if (ch24>1&&pPos<0.18&&w7<-8) pats.push({name:'🔄 Double Bottom',signal:'bullish',wr:75,desc:`At ${w7.toFixed(0)}% weekly low + recovery signal.`});
        else if (pPos>0.87&&ch24>4&&vol>20e6) pats.push({name:'🚀 Volume Breakout',signal:'bullish',wr:82,desc:`Near high +${ch24.toFixed(1)}% + strong volume. Institutional buy.`});
        else if (w7>6&&ch24>-3&&ch24<3&&pPos>0.35) pats.push({name:'🏴 Bull Flag (est.)',signal:'bullish',wr:85,desc:`Weekly +${w7.toFixed(1)}% + daily consolidation. Continuation setup.`});
        else if (w7<-6&&ch24<3&&ch24>-3&&pPos<0.65) pats.push({name:'🏴 Bear Flag (est.)',signal:'bearish',wr:85,desc:`Weekly ${w7.toFixed(1)}% drop + bouncing. Continuation lower.`});
        else if (pPos>0.85&&w7>20) pats.push({name:'📊 Distribution Top',signal:'bearish',wr:75,desc:`Overbought after +${w7.toFixed(1)}% weekly. Smart money distributing.`});
      }
    } catch {}
    return pats.filter(x=>x.wr>=75).sort((a,b)=>b.wr-a.wr).slice(0,2).map(p=>({name:p.name,signal:p.signal,winRate:p.wr,desc:p.desc}));
  };

  // ── ELLIOTT WAVE (10 skenario) ────────────────────────
  const ewCalc = (rsi, ch24, ch7_, macd, bTF, beTF) => {
    const ch7=ch7_||0;
    const uW=ch7>3,dW=ch7<-3,uD=ch24>1.5,dD=ch24<-1.5,oS=rsi<32,oB=rsi>70;
    if ((uW||(!uW&&!dW))&&uD&&rsi>=42&&rsi<=65&&bTF>=2&&(macd?.xUp||macd?.bull))
      return {w:'🚀 Wave 3 — Impulse',c:82,d:`${uW?`W7d +${ch7.toFixed(0)}% + `:''}Daily +${ch24.toFixed(1)}%. Strongest phase. Target 1.618x. Volume entry.`};
    if (uW&&uD&&rsi>=55&&rsi<75&&macd?.bull&&!macd?.div)
      return {w:'⚡ Wave 3 Extension',c:72,d:`Continuation impulse. Trailing stop from swing low.`};
    if (uW&&dD&&oS)
      return {w:'📉 Wave 2 Pullback',c:78,d:`Correction in uptrend. RSI ${rsi.toFixed(0)} oversold — BEST ENTRY. Stop below recent low.`};
    if ((uW||(!uW&&!dW))&&rsi>=35&&rsi<48&&dD&&!oS)
      return {w:'📉 Wave 2 / OTE Entry',c:68,d:`Pullback into OTE zone. Entry before Wave 3 continuation.`};
    if (uW&&dD&&rsi>=38&&rsi<=55&&!oS)
      return {w:'⚖️ Wave 4 Correction',c:65,d:`Consolidation before final leg. Don't FOMO above.`};
    if ((uW&&ch7>15||ch24>8)&&oB&&macd?.div)
      return {w:'⚠️ Wave 5 Ending',c:68,d:`RSI divergence + extended run. LIKELY PEAK. Partial profits recommended.`};
    if (oB&&bTF>=2&&!macd?.div)
      return {w:'⚡ Wave 5 Progress',c:60,d:`Overbought, no divergence yet. Tight trailing stop.`};
    if ((dW||(!uW&&dD))&&uD&&oS)
      return {w:'🔄 Wave C Complete',c:74,d:`RSI ${rsi.toFixed(0)} oversold + daily reversal. Potential bottom. Stop below recent low.`};
    if ((dW||(!uW&&dD))&&uD&&ch24>4&&!oS)
      return {w:'🔄 Wave C → MSS',c:67,d:`Market Structure Shift: daily up in downtrend. Monitor volume for confirmation.`};
    if (oS&&beTF>=2)
      return {w:'💎 Wave C Capitulation',c:74,d:`RSI ${rsi.toFixed(0)} extreme oversold. Near-term bottom. Confirm with bullish candle.`};
    if ((dW||dD)&&beTF>=2&&!oS)
      return {w:'📉 Wave A/C Bearish',c:70,d:`${dW?`Weekly ${ch7.toFixed(0)}%`:`Daily ${ch24.toFixed(1)}%`} downtrend. Avoid catching falling knife.`};
    if (Math.abs(ch24)<2&&Math.abs(ch7)<3)
      return {w:'⚖️ Sideways / Coiling',c:55,d:`Tight compression. Breakout imminent. Watch volume spike for direction.`};
    if (uD&&!dW)
      return {w:'↗️ Impulse Building',c:55,d:`Daily positive momentum. Weekly confirmation needed.`};
    return {w:'⚖️ Corrective Phase',c:50,d:`Consolidation/correction. Wait for clear directional setup.`};
  };

  // ── ASTRO ─────────────────────────────────────────────
  const mkAstro = () => {
    try {
      const jd=Date.now()/86400000+2440587.5;
      const dm=((jd-2460320.5)%29.53058867+29.53058867)%29.53058867;
      const ph=[[1.5,'New Moon','🌑'],[8.5,'First Quarter','🌓'],[16,'Full Moon','🌕'],[22,'Waning','🌖'],[29.5,'Waning Crescent','🌘']];
      let mp='Dark Moon',me='🌑';
      for (const[lim,ph_,em]of ph) if(dm<lim){mp=ph_;me=em;break;}
      const dsh=Math.floor((Date.now()-1713571200000)/86400000);
      return {moonPhase:mp,moonEmoji:me,halvingPhase:dsh<365?'Bull Early 🔥':dsh<480?'Bull Peak ⚡':dsh<730?'Distribution ⚠️':'Accumulation 🌱',chaotic:mp==='Full Moon'||mp==='New Moon'};
    } catch { return {moonPhase:'—',moonEmoji:'🌙',halvingPhase:'Bull Cycle',chaotic:false}; }
  };
  const astro = mkAstro();

  try {
    // ══════════════════════════════════════════════════════
    // PARALLEL — max(CG,MEXC,CC,FNG) ≈ 5s total
    // If CoinGecko rate-limited → MEXC still provides 500+ coins
    // ══════════════════════════════════════════════════════
    const [cgRes, mexcRes, ccRes, fngRes] = await Promise.allSettled([
      sf('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=volume_desc&per_page=250&page=1&sparkline=false&price_change_percentage=24h,7d', 5000),
      sf('https://api.mexc.com/api/v3/ticker/24hr', 6000),
      Promise.allSettled(CC_SYMS.map(s=>sf(`https://min-api.cryptocompare.com/data/v2/histohour?fsym=${s}&tsym=USD&limit=42&aggregate=4&e=CCCAGG`,4500))),
      sf('https://api.alternative.me/fng/?limit=1&format=json', 3000),
    ]);

    const fg = fngRes.status==='fulfilled' ? parseInt(fngRes.value?.data?.[0]?.value||50) : 50;

    // ── Parse CoinGecko ───────────────────────────────────
    const cgCoins=[];
    const cgRaw=cgRes.status==='fulfilled'&&Array.isArray(cgRes.value)?cgRes.value:[];
    for (const c of cgRaw) {
      if (!c?.current_price||c.current_price<=0) continue;
      cgCoins.push({sym:(c.symbol||'').toUpperCase(),name:c.name||'',price:c.current_price,ch24:c.price_change_percentage_24h||0,ch7d:c.price_change_percentage_7d||null,vol:c.total_volume||0,h:c.high_24h||c.current_price*1.02,l:c.low_24h||c.current_price*0.98,mcap:c.market_cap||0,rank:c.market_cap_rank||9999,src:'cg'});
    }

    // ── Parse MEXC (top 500 by volume) ───────────────────
    const mexcCoins=[];
    const mexcRaw=mexcRes.status==='fulfilled'&&Array.isArray(mexcRes.value)?mexcRes.value:[];
    // Filter + sort + take top 500
    const mexcFilt=mexcRaw.filter(t=>{
      if (!t?.symbol?.endsWith('USDT')) return false;
      const s=t.symbol.replace('USDT','');
      if (STABLE.has(s)) return false;
      if (BAD_SFX.some(x=>s.endsWith(x)||s.startsWith(x))) return false;
      if (s.length>12) return false;
      const p=+(t.lastPrice||0),v=+(t.quoteVolume||0);
      if (p<=0||v<500000) return false;
      if (p>=0.97&&p<=1.03&&Math.abs(+(t.priceChangePercent||0))<0.5) return false;
      return true;
    }).sort((a,b)=>+(b.quoteVolume||0)-+(a.quoteVolume||0)).slice(0,500);
    for (const t of mexcFilt) {
      const s=t.symbol.replace('USDT','');
      const p=+(t.lastPrice||0),c=+(t.priceChangePercent||0),v=+(t.quoteVolume||0);
      mexcCoins.push({sym:s,name:s,price:p,ch24:c,ch7d:null,vol:v,h:+(t.highPrice||p*1.02),l:+(t.lowPrice||p*0.98),mcap:0,rank:9999,src:'mexc'});
    }

    // ── Merge (CoinGecko priority) ────────────────────────
    const seen=new Set();
    const pool=[];
    for (const c of cgCoins)   {if(!seen.has(c.sym)){seen.add(c.sym);pool.push(c);}}
    for (const c of mexcCoins) {if(!seen.has(c.sym)){seen.add(c.sym);pool.push(c);}}

    // ── Parse CryptoCompare klines ────────────────────────
    const kMap={};
    const ccRaw=ccRes.status==='fulfilled'?ccRes.value:[];
    ccRaw.forEach((r,i)=>{
      try {
        if (r.status!=='fulfilled'||r.value?.Response!=='Success') return;
        const rows=r.value?.Data?.Data;
        if (!rows||rows.length<16) return;
        const K=rows.filter(d=>d.close>0&&d.close<1e12).map(d=>({t:+d.time,o:+d.open,h:+d.high,l:+d.low,c:+d.close,v:+(d.volumeto||0)}));
        if (K.length<16) return;
        const cls=K.map(k=>k.c);
        const r14=rsi14(cls); if (r14===null) return;
        const e9=ema(cls,9),e21=ema(cls,21),e50=ema(cls,Math.min(50,cls.length-1));
        const macd=macdSig(cls);
        const smc=smcFull(K,cls[cls.length-1]);
        kMap[CC_SYMS[i]]={rsi:r14,e9,e21,e50,macd,K,cls,smc,ok:true};
      } catch {}
    });

    // ── Analyze ALL coins ─────────────────────────────────
    const results=[];
    for (const c of pool) {
      try {
        const {sym,name,price,ch24,ch7d,vol,h,l,mcap,rank,src}=c;
        if (!sym||price<=0||vol<100000) continue;
        const pPos=h>l?(price-l)/(h-l):0.5;
        const rng=h>l?(h-l)/price*100:0;
        const vt=vol>=1e9?5:vol>=200e6?4:vol>=50e6?3:vol>=10e6?2:vol>=1e6?1:0;

        // RSI
        const kd=kMap[sym]||null;
        const rsi=kd?.ok?kd.rsi:Math.max(10,Math.min(90,50+ch24*2.5+(pPos-0.5)*25+((ch7d||0)>0?4:-4)));
        const rsiR=!!(kd?.ok);

        // EMA alignment
        let emaS=0;
        if (kd?.ok&&kd.cls?.length>=10) {const lp=kd.cls[kd.cls.length-1];if(lp>kd.e9)emaS++;if(lp>kd.e21)emaS++;if(lp>kd.e50)emaS++;}
        else {if(ch24>0)emaS++;if((ch7d||0)>0)emaS++;if(pPos>0.55)emaS++;}

        // Trends
        const t1h=rsi>58?'BULL':rsi<42?'BEAR':'SIDE';
        const t4h=(kd?.macd?.bull||(ch24>1.5&&pPos>0.5))?'BULL':(ch24<-1.5&&pPos<0.5)?'BEAR':'SIDE';
        const t1d=(ch7d||0)>3?'BULL':(ch7d||0)<-3?'BEAR':'SIDE';
        const bTF=[t1h,t4h,t1d].filter(x=>x==='BULL').length;
        const beTF=[t1h,t4h,t1d].filter(x=>x==='BEAR').length;

        // SMC
        const smc=kd?.smc||smcEst(price,h,l,ch24,ch7d||0);

        // Chart patterns
        const pats=patterns(kd?.K||null,price,h,l,ch24,ch7d,pPos,vol);

        // Elliott Wave
        const ew=ewCalc(rsi,ch24,ch7d,kd?.macd||null,bTF,beTF);

        // Probability
        const tC=bTF===3?28:bTF===2?16:bTF===1?6:beTF===3?-28:beTF===2?-16:beTF===1?-6:0;
        const rC=rsi<25?(beTF>=2?4:14):rsi<32?(beTF>=2?3:10):rsi<40?(beTF>=2?2:5):rsi<48?1:rsi>75?(bTF>=2?-4:-14):rsi>68?(bTF>=2?-3:-10):rsi>60?(bTF>=2?-1:-5):rsi>52?4:0;
        const mW=(ch7d||0)>20?10:(ch7d||0)>8?6:(ch7d||0)>3?3:(ch7d||0)<-20?-10:(ch7d||0)<-8?-6:(ch7d||0)<-3?-3:0;
        const m24=ch24>10?6:ch24>4?3:ch24>1?1:ch24<-10?-6:ch24<-4?-3:ch24<-1?-1:0;
        const mC=kd?.macd?.xUp?8:kd?.macd?.xDown?-8:kd?.macd?.bull?3:kd?.macd?.bear?-3:0;
        const smcC=(smc.inBullOB?3:0)+(smc.hasBOS&&smc.bosType?.includes('Bull')?3:0)+(smc.hasCHoCH&&smc.chochType?.includes('Bull')?2:0)+(smc.inBullFVG?1:0)-(smc.inBearOB?3:0)-(smc.hasBOS&&smc.bosType?.includes('Bear')?3:0);
        const pC=pats.some(p=>p.signal==='bullish'&&p.winRate>=80)?3:pats.some(p=>p.signal==='bullish')?1:pats.some(p=>p.signal==='bearish'&&p.winRate>=80)?-3:pats.some(p=>p.signal==='bearish')?-1:0;
        const ewC=ew.w.includes('Wave 3')?4:ew.w.includes('Wave 2')?2:ew.w.includes('C Complete')||ew.w.includes('Capitulation')?3:ew.w.includes('Bearish')||ew.w.includes('Wave 5 End')?-2:0;
        const prob=Math.max(2,Math.min(98,Math.round(50+tC+rC+mW+m24+mC+smcC+pC+ewC)));
        const score=tC+rC+mW+m24+mC+smcC;

        // Label
        let taLabel='⚖️ SIDEWAYS',taColor='neutral';
        if(bTF===3){taLabel='🚀 FULL SEND';taColor='full-bull';}
        else if(bTF>=2){taLabel='📈 STRONG BULL';taColor='bull';}
        else if(bTF===1&&beTF===0){taLabel='↗️ MILD BULL';taColor='bull';}
        else if(beTF===3){taLabel='💀 FULL BEAR';taColor='full-bear';}
        else if(beTF>=2){taLabel='📉 STRONG BEAR';taColor='bear';}
        else if(beTF===1&&bTF===0){taLabel='↘️ MILD BEAR';taColor='bear';}

        // SMC display label
        const smcLbl=smc.hasBOS?smc.bosType:smc.hasCHoCH?'CHoCH (MSS)':smc.inBullOB?'Bull OB':smc.inBearOB?'Bear OB':smc.inBullFVG?'Bull FVG':smc.zone||'Neutral';

        // Signals (detailed, accurate)
        const sigs=[];
        if (rsi<25) sigs.push(`RSI ${rsi.toFixed(0)} EXTREME oversold — prime accumulation zone 🎯`);
        else if (rsi<32) sigs.push(`RSI ${rsi.toFixed(0)} oversold${beTF>=2?' — watch for reversal candle':' — entry zone with confirmation'}`);
        else if (rsi>74) sigs.push(`RSI ${rsi.toFixed(0)} overbought${bTF>=2?' — reduce position size':' — avoid new longs'}`);
        if (kd?.macd?.xUp)  sigs.push('MACD golden cross ✅ — new bullish momentum confirmed');
        if (kd?.macd?.xDown)sigs.push('MACD death cross ⚠️ — bearish momentum confirmed');
        if (kd?.macd?.div)  sigs.push('RSI/MACD divergence ⚠️ — trend losing momentum');
        if (smc.bOB)        sigs.push(`ICT Bull OB $${smc.bOB.L}–$${smc.bOB.H}${smc.bOB.fresh?' (fresh)':''} — institutional demand zone`);
        if (smc.beOB)       sigs.push(`ICT Bear OB $${smc.beOB.L}–$${smc.beOB.H}${smc.beOB.fresh?' (fresh)':''} — institutional supply zone`);
        if (smc.bFVG)       sigs.push(`ICT Bull FVG ${smc.bFVG.pct}% gap $${smc.bFVG.L}–$${smc.bFVG.H} — price rebalancing`);
        if (smc.sweep)      sigs.push(`${smc.sweep.t} at $${smc.sweep.lv} — liquidity grabbed`);
        if (smc.eqH)        sigs.push(`Equal Highs (BSL) at $${smc.eqH} — buy-side liquidity pool`);
        if (smc.eqL)        sigs.push(`Equal Lows (SSL) at $${smc.eqL} — sell-side liquidity pool`);
        if (smc.inOTE)      sigs.push(`In OTE zone ${smc.oteL}–${smc.oteH} (ICT 61.8–78.6% level) — optimal entry`);
        if (smc.hasCHoCH)   sigs.push(`${smc.chochType} at $${smc.chochLevel} — structure shift confirmed`);
        if (smc.hasBOS&&ch24>5) sigs.push(`${smc.bosType} at $${smc.bosLevel} — institutional breakout`);
        if (vt>=4&&ch24>3)  sigs.push(`$${['','','','','200M+','1B+'][vt]} volume + +${ch24.toFixed(1)}% — smart money move`);
        if (bTF===3)        sigs.push('All 3 timeframes aligned bullish 🎯 — highest conviction setup');
        pats.forEach(p=>sigs.push(`${p.name} (${p.winRate}%): ${p.desc}`));

        results.push({
          rank:results.length+1,symbol:sym,name,dataSource:src,
          price,change24h:+ch24.toFixed(2),change7d:ch7d!=null?+ch7d.toFixed(2):null,
          volume24h:vol,mcap,mcapRank:rank,
          high24h:h,low24h:l,pricePos:+pPos.toFixed(3),range:+rng.toFixed(2),
          rsi:+rsi.toFixed(2),rsiReal:rsiR,vt,
          trendAlignment:taLabel,taColor,trend1h:t1h,trend4h:t4h,trend1d:t1d,bullTF:bTF,bearTF:beTF,
          smc:{...smc,signal:smcLbl},
          elliottWave:{wave:ew.w,confidence:ew.c,description:ew.d},
          chartPatterns:pats.length>0?pats:[{name:ch24>=0?'Bullish Candle':'Bearish Candle',signal:ch24>=0?'bullish':'bearish',winRate:0}],
          probability:prob,score,
          signals:sigs.slice(0,5),
          astrology:{moonPhase:astro.moonPhase,moonEmoji:astro.moonEmoji,halvingPhase:astro.halvingPhase,chaotic:astro.chaotic},
          hasRealData:rsiR,
        });
      } catch { /* skip coin on error */ }
    }

    results.sort((a,b)=>b.probability-a.probability||b.score-a.score);
    results.forEach((r,i)=>r.rank=i+1);

    // Tabs (lean format for fast response)
    const mk=(arr)=>arr.map(r=>({rank:r.rank,symbol:r.symbol,name:r.name,price:r.price,change24h:r.change24h,change7d:r.change7d,volume24h:r.volume24h,trendAlignment:r.trendAlignment,taColor:r.taColor,trend1h:r.trend1h,trend4h:r.trend4h,trend1d:r.trend1d,bullTF:r.bullTF,bearTF:r.bearTF,smc:r.smc,elliottWave:r.elliottWave,chartPatterns:r.chartPatterns,probability:r.probability,score:r.score,signals:r.signals,astrology:r.astrology,rsi:r.rsi,rsiReal:r.rsiReal,vt:r.vt,pricePos:r.pricePos,mcapRank:r.mcapRank,hasRealData:r.hasRealData}));

    const institutional  = mk(results.filter(r=>r.score>=16&&r.probability>=60&&r.volume24h>=5e6).slice(0,80));
    const fullSend       = mk(results.filter(r=>(r.taColor==='full-bull'||r.bullTF===3)&&r.probability>=65).slice(0,60));
    const highProbBull   = mk(results.filter(r=>r.probability>=68&&r.score>=12).slice(0,60));
    const smcSetups      = mk(results.filter(r=>(r.smc?.inBullOB||r.smc?.inBullFVG||r.smc?.hasCHoCH)&&r.probability>=52).slice(0,60));
    const ewSetups       = mk(results.filter(r=>{const w=r.elliottWave?.wave||'';return(w.includes('Wave 3')||w.includes('Wave 2'))?r.probability>=52:(w.includes('C Complete')||w.includes('Capitulation'))?r.probability>=50:(r.rsi<38&&r.change24h>0)||false;}).sort((a,b)=>b.probability-a.probability).slice(0,60));
    const volumeBreakout = mk(results.filter(r=>r.vt>=3&&r.change24h>1.5&&r.probability>50).sort((a,b)=>b.volume24h-a.volume24h).slice(0,60));
    const strongSell     = mk(results.filter(r=>r.probability<38||r.taColor==='full-bear').sort((a,b)=>a.probability-b.probability).slice(0,40));

    const bullC=results.filter(r=>r.probability>55).length;
    const bearC=results.filter(r=>r.probability<45).length;
    const avgCh=results.length?+(results.reduce((s,r)=>s+r.change24h,0)/results.length).toFixed(2):0;
    const mood=avgCh>3?'STRONG BULL':avgCh>1?'BULL':avgCh<-3?'STRONG BEAR':avgCh<-1?'BEAR':'NEUTRAL';

    return res.status(200).json({
      ok:true,ts:Date.now(),elapsed:Date.now()-t0,version:'v24',
      dataFrom:`cg:${cgCoins.length}+mexc:${mexcCoins.length}`,
      fg,totalScanned:pool.length,totalQualified:results.length,
      rsiRealCount:Object.keys(kMap).length,
      results,
      topSetups:{institutional,fullSend,highProbBull,smcSetups,ewSetups,volumeBreakout,strongSell},
      marketOverview:{marketMood:mood,bullishCount:bullC,bearishCount:bearC,avgChange24h:avgCh,totalCoins:results.length},
      astroContext:astro,
    });

  } catch (e) {
    return res.status(200).json({
      ok:false,error:e.message,ts:Date.now(),elapsed:Date.now()-t0,version:'v24',
      totalScanned:0,totalQualified:0,results:[],
      topSetups:{institutional:[],fullSend:[],highProbBull:[],smcSetups:[],ewSetups:[],volumeBreakout:[],strongSell:[]},
      marketOverview:{marketMood:'UNKNOWN',bullishCount:0,bearishCount:0,avgChange24h:0},
    });
  }
}
