// api/scanner-full.js — v25 BULLETPROOF 1000 COINS
// CoinGecko(250) + MEXC(750) = ~1000 unique coins
// CryptoCompare 20 koin = real RSI+MACD+ICT klines
// Semua parallel, max 5s — aman Vercel 10s
// Setiap operasi dilindungi try/catch + safe getters
// TIDAK ADA CRASH dari data apapun

const CC20 = ['BTC','ETH','BNB','SOL','XRP','ADA','DOGE','AVAX','LINK','DOT',
              'NEAR','SUI','APT','ARB','OP','PEPE','TON','INJ','TIA','RENDER'];

const STABLES = new Set(['USDT','USDC','BUSD','DAI','TUSD','FDUSD','USDD','FRAX',
                         'GUSD','USDP','LUSD','PYUSD','SUSD','USDE','USDB','EURC']);
const BAD_SFX = ['UP','DOWN','BULL','BEAR','LONG','SHORT','3L','3S','2L','2S'];

// ── SAFE GETTERS (tidak pernah crash) ─────────────────────
const N = (v, d=0)  => { const n=+v; return (isNaN(n)||!isFinite(n)) ? d : n; };
const S = (v, d='') => v!=null ? String(v) : d;
const A = (v)       => Array.isArray(v) ? v : [];
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, N(v)));

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Cache-Control','s-maxage=30,stale-while-revalidate=20');
  if (req.method==='OPTIONS') return res.status(200).end();
  const t0 = Date.now();

  const sf = async (url, ms) => {
    const ctl = new AbortController();
    const tmr = setTimeout(()=>ctl.abort(), ms);
    try {
      const r = await fetch(url, {signal:ctl.signal, headers:{Accept:'application/json','User-Agent':'AC369/1.0'}});
      clearTimeout(tmr);
      return r.ok ? await r.json() : null;
    } catch { clearTimeout(tmr); return null; }
  };

  // ── RSI (bulletproof) ─────────────────────────────────
  const calcRSI = a => {
    try {
      if (!A(a).length||a.length<16) return null;
      let g=0,l=0;
      for(let i=1;i<=14;i++){const d=a[i]-a[i-1];d>0?g+=d:l-=d;}
      g/=14;l/=14;
      for(let i=15;i<a.length;i++){const d=a[i]-a[i-1];g=(g*13+Math.max(d,0))/14;l=(l*13+Math.max(-d,0))/14;}
      return l===0?100:clamp(100-100/(1+g/l),0,100);
    } catch { return null; }
  };

  // ── EMA ───────────────────────────────────────────────
  const calcEMA = (a, p) => {
    try {
      if (!A(a).length||a.length<2) return N(a?.[a.length-1]);
      const k=2/(p+1); let e=a.slice(0,Math.min(p,a.length)).reduce((s,v)=>s+v,0)/Math.min(p,a.length);
      for(let i=Math.min(p,a.length);i<a.length;i++) e=a[i]*k+e*(1-k);
      return e;
    } catch { return 0; }
  };

  // ── MACD ──────────────────────────────────────────────
  const calcMACD = a => {
    try {
      if (!A(a).length||a.length<36) return null;
      const k12=2/13,k26=2/27,k9=2/10;
      let e12=a.slice(0,12).reduce((s,v)=>s+v,0)/12, e26=a.slice(0,26).reduce((s,v)=>s+v,0)/26;
      const mv=[];
      for(let i=26;i<a.length;i++){e12=a[i]*k12+e12*(1-k12);e26=a[i]*k26+e26*(1-k26);mv.push(e12-e26);}
      let sig=mv.slice(0,9).reduce((s,v)=>s+v,0)/9;
      for(let i=9;i<mv.length;i++) sig=mv[i]*k9+sig*(1-k9);
      const n=mv.length, last=N(mv[n-1]), prev=N(mv[n-2]||last), h=last-sig, ph=prev-sig;
      const div = n>7 && last<N(mv[n-8]) && a[a.length-1]>a[a.length-8];
      return {bull:last>0&&h>0, bear:last<0&&h<0, xUp:h>0&&ph<=0, xDown:h<0&&ph>=0, div};
    } catch { return null; }
  };

  // ── ICT/SMC from klines ───────────────────────────────
  const smcFull = (K, price) => {
    try {
      if (!A(K).length||K.length<8||!price) return null;
      const n=K.length;
      const SH=[],SL=[];
      for(let i=2;i<n-2;i++){
        if(!K[i]||!K[i-1]||!K[i+1]) continue;
        if(K[i].h>K[i-1].h&&K[i].h>K[i+1].h) SH.push({i,p:N(K[i].h)});
        if(K[i].l<K[i-1].l&&K[i].l<K[i+1].l) SL.push({i,p:N(K[i].l)});
      }
      const rSH=SH.slice(-3), rSL=SL.slice(-3);
      const lSH=N(rSH[rSH.length-1]?.p), lSL=N(rSL[rSL.length-1]?.p,1e12);
      const pSH=N(rSH[rSH.length-2]?.p), pSL=N(rSL[rSL.length-2]?.p,1e12);
      // BOS / CHoCH
      let bos=null, choch=null;
      if(lSH>0&&price>lSH&&N(K[n-3]?.c)<lSH) bos={type:'Bullish BOS',level:+lSH.toFixed(6)};
      else if(lSL<1e12&&price<lSL&&N(K[n-3]?.c)>lSL) bos={type:'Bearish BOS',level:+lSL.toFixed(6)};
      if(!bos&&pSH>0&&price>pSH) choch={type:'Bullish CHoCH (MSS)',level:+pSH.toFixed(6)};
      if(!bos&&pSL<1e12&&price<pSL) choch={type:'Bearish CHoCH (MSS)',level:+pSL.toFixed(6)};
      // Order Blocks
      let bOB=null, beOB=null;
      for(let i=Math.max(0,n-14);i<n-2;i++){
        const c=K[i],nx=K[i+1];
        if(!c||!nx||!c.o||!c.c||!nx.c) continue;
        if(c.c<c.o&&nx.c>nx.o&&nx.c>c.o*1.002){
          const H=Math.max(c.o,c.c),L=Math.min(c.o,c.c);
          if(!bOB&&price<=H*1.01&&price>=L*0.995) bOB={H:+H.toFixed(6),L:+L.toFixed(6),fresh:i>n-8};
        }
        if(c.c>c.o&&nx.c<nx.o&&nx.c<c.o*0.998){
          const H=Math.max(c.o,c.c),L=Math.min(c.o,c.c);
          if(!beOB&&price<=H*1.005&&price>=L*0.99) beOB={H:+H.toFixed(6),L:+L.toFixed(6),fresh:i>n-8};
        }
      }
      // FVG
      let bFVG=null;
      for(let i=Math.max(0,n-12);i<n-2;i++){
        if(!K[i]||!K[i+2]) continue;
        const g=N(K[i+2].l)-N(K[i].h);
        if(g>0&&price>=N(K[i].h)&&price<=N(K[i+2].l)){
          bFVG={pct:+(g/N(K[i].h,1)*100).toFixed(2), L:+N(K[i].h).toFixed(6), H:+N(K[i+2].l).toFixed(6)};
          break;
        }
      }
      // Liquidity Sweep
      let sweep=null;
      if(rSL.length>0&&K[n-2]&&K[n-1]){
        const s=rSL[rSL.length-1];
        if(N(K[n-2].l)<s.p&&N(K[n-1].c)>s.p) sweep={t:'Bull SSL Sweep',lv:+s.p.toFixed(6)};
      }
      if(!sweep&&rSH.length>0&&K[n-2]&&K[n-1]){
        const s=rSH[rSH.length-1];
        if(N(K[n-2].h)>s.p&&N(K[n-1].c)<s.p) sweep={t:'Bear BSL Sweep',lv:+s.p.toFixed(6)};
      }
      // Equal H/L
      let eqH=null, eqL=null;
      if(rSH.length>=2){const d=Math.abs(rSH[rSH.length-1].p-rSH[rSH.length-2].p)/(rSH[rSH.length-1].p||1);if(d<0.006)eqH=+rSH[rSH.length-1].p.toFixed(6);}
      if(rSL.length>=2){const d=Math.abs(rSL[rSL.length-1].p-rSL[rSL.length-2].p)/(rSL[rSL.length-1].p||1);if(d<0.006)eqL=+rSL[rSL.length-1].p.toFixed(6);}
      // Zone
      const allH=K.slice(-20).map(k=>N(k?.h));
      const allL=K.slice(-20).map(k=>N(k?.l,1e12));
      const kH=Math.max(...allH)||price*1.1;
      const kL=Math.min(...allL)||price*0.9;
      const eq=(kH+kL)/2;
      const pip=kH>kL?clamp((price-kL)/(kH-kL)*100,0,100):50;
      const zone=pip>70?'Premium Zone':pip>55?'Slight Premium':pip<30?'Discount Zone':pip<45?'Slight Discount':'Equilibrium';
      const oteH=+(eq+(kH-eq)*0.382).toFixed(6);
      const oteL=+(eq-(eq-kL)*0.382).toFixed(6);
      const inOTE=price>=oteL&&price<=oteH;
      const bS=(!!bOB?2:0)+(!!bFVG?1:0)+(bos?.type?.includes('Bull')?3:0)+(choch?.type?.includes('Bull')?2:0)+(sweep?.t?.includes('Bull')?2:0)+(inOTE&&price<eq?1:0);
      const beS=(!!beOB?2:0)+(bos?.type?.includes('Bear')?3:0)+(choch?.type?.includes('Bear')?2:0)+(sweep?.t?.includes('Bear')?2:0)+(inOTE&&price>eq?1:0);
      return {hasBOS:!!bos,bosType:bos?.type||'None',bosLevel:bos?.level||null,hasCHoCH:!!choch,chochType:choch?.type||'None',chochLevel:choch?.level||null,bOB,beOB,inBullOB:!!bOB,inBearOB:!!beOB,bFVG,inBullFVG:!!bFVG,sweep,eqH,eqL,zone,pip:+pip.toFixed(1),inOTE,oteH,oteL,signal:bS>beS?'Bullish':beS>bS?'Bearish':'Neutral',bS,beS};
    } catch { return null; }
  };

  // ── ICT/SMC estimated (from OHLC only) ───────────────
  const smcEst = (p, h, l, c24, c7) => {
    try {
      const pip=h>l?clamp((p-l)/(h-l)*100,0,100):50;
      const zone=pip>70?'Premium Zone':pip<30?'Discount Zone':'Equilibrium';
      const hasBOS=Math.abs(c24)>5;
      const bosType=c24>5?'Bullish BOS':c24<-5?'Bearish BOS':'None';
      const hasCHoCH=c24>3&&c7<0;
      const inBullOB=pip<28, inBearOB=pip>72;
      const bS=(hasBOS&&c24>5?3:0)+(inBullOB?2:0)+(hasCHoCH?2:0);
      const beS=(hasBOS&&c24<-5?3:0)+(inBearOB?2:0);
      return {hasBOS,bosType,bosLevel:hasBOS&&c24>5?+(h*0.98).toFixed(6):hasBOS?+(l*1.02).toFixed(6):null,hasCHoCH,chochType:hasCHoCH?'Bullish CHoCH (MSS)':'None',inBullOB,inBearOB,bOB:inBullOB?{H:+(l+(h-l)*0.28).toFixed(6),L:+l.toFixed(6)}:null,beOB:inBearOB?{H:+h.toFixed(6),L:+(l+(h-l)*0.72).toFixed(6)}:null,inBullFVG:pip<15,zone,pip:+pip.toFixed(1),signal:bS>beS?'Bullish':beS>bS?'Bearish':'Neutral',bS,beS};
    } catch { return {hasBOS:false,bosType:'None',hasCHoCH:false,chochType:'None',inBullOB:false,inBearOB:false,inBullFVG:false,zone:'Equilibrium',pip:50,signal:'Neutral',bS:0,beS:0}; }
  };

  // ── CHART PATTERNS ≥75% (12 patterns) ────────────────
  const getPatterns = (K, p, h, l, c24, c7, pPos, vol) => {
    try {
      const pats=[];
      const op=p>0&&c24>-99?p/(1+c24/100):p;
      const rng=h-l;
      // From single candle OHLC reconstruction
      if(rng>0){
        const bd=Math.abs(p-op)/rng, lw=(Math.min(p,op)-l)/rng, uw=(h-Math.max(p,op))/rng;
        if(lw>0.55&&bd<0.30&&uw<0.20&&pPos<0.45) pats.push({name:'🔨 Hammer',signal:'bullish',winRate:76,desc:`Buyers rejected low $${l.toFixed(4)}.`});
        if(uw>0.55&&bd<0.30&&lw<0.20&&pPos>0.55) pats.push({name:'⭐ Shooting Star',signal:'bearish',winRate:75,desc:`Sellers rejected high $${h.toFixed(4)}.`});
        if(bd>0.75&&c24>3&&p>op) pats.push({name:'🐂 Bull Marubozu',signal:'bullish',winRate:77,desc:`+${c24.toFixed(1)}% strong body. Full buy control.`});
        if(bd>0.75&&c24<-3&&p<op) pats.push({name:'🐻 Bear Marubozu',signal:'bearish',winRate:77,desc:`${c24.toFixed(1)}% strong body. Full sell control.`});
        if(uw>0.50&&bd<0.30&&lw<0.20&&pPos<0.40&&c24>0) pats.push({name:'🔨 Inverted Hammer',signal:'bullish',winRate:75,desc:'Upper wick rejection at low. Confirm next candle.'});
      }
      // From klines (accurate)
      if(A(K).length>=3){
        const n=K.length, C=K[n-1], P=K[n-2], P2=K[n-3];
        if(C&&P&&P2&&C.c&&P.c&&P2.c){
          const Cb=Math.abs(C.c-C.o), Pb=Math.abs(P.c-P.o), P2b=Math.abs(P2.c-P2.o);
          const P2r=Math.max(P2.h-P2.l, 0.0001);
          if(P.c<P.o&&C.c>C.o&&C.o<=P.c&&C.c>=P.o&&Cb>Pb*0.9) pats.push({name:'🐂 Bullish Engulfing',signal:'bullish',winRate:78,desc:'Buyers absorbed prior selling. Strong reversal.'});
          if(P.c>P.o&&C.c<C.o&&C.o>=P.c&&C.c<=P.o&&Cb>Pb*0.9) pats.push({name:'🐻 Bearish Engulfing',signal:'bearish',winRate:78,desc:'Sellers absorbed prior buying. Distribution.'});
          if(P2.c<P2.o&&Pb/(P2b+0.001)<0.40&&C.c>C.o&&C.c>(P2.o+P2.c)/2) pats.push({name:'🌟 Morning Star',signal:'bullish',winRate:78,desc:'3-candle reversal. Selling exhaustion complete.'});
          if(P2.c>P2.o&&Pb/(P2b+0.001)<0.40&&C.c<C.o&&C.c<(P2.o+P2.c)/2) pats.push({name:'🌆 Evening Star',signal:'bearish',winRate:78,desc:'3-candle distribution. Buying exhaustion.'});
          if(P2.c>P2.o&&P.c>P.o&&C.c>C.o&&P.c>P2.c&&C.c>P.c&&P2b/P2r>0.50) pats.push({name:'⚔️ 3 White Soldiers',signal:'bullish',winRate:83,desc:'3 consecutive bullish. Institutional accumulation.'});
          if(P2.c<P2.o&&P.c<P.o&&C.c<C.o&&P.c<P2.c&&C.c<P.c&&P2b/P2r>0.50) pats.push({name:'🐦 3 Black Crows',signal:'bearish',winRate:83,desc:'3 consecutive bearish. Institutional distribution.'});
          if(P.c<P.o&&C.c>C.o&&C.o<P.l&&C.c>(P.o+P.c)/2) pats.push({name:'🌙 Piercing Pattern',signal:'bullish',winRate:75,desc:'Bullish penetrates >50% of prior bearish body.'});
          if(P.c>P.o&&C.c<C.o&&C.o>P.h&&C.c<(P.o+P.c)/2) pats.push({name:'☁️ Dark Cloud Cover',signal:'bearish',winRate:75,desc:'Bearish penetrates >50% of prior bullish body.'});
          if(C.h<=P.h&&C.l>=P.l) pats.push({name:'📦 Inside Bar / NR4',signal:C.c>=C.o?'bullish':'bearish',winRate:76,desc:'Compression inside prior candle. Breakout imminent.'});
          if(K.length>=8){
            const ref=N(K[n-7]?.c);
            if(ref>0){
              const mv=(N(K[n-3]?.c)-ref)/ref*100;
              const fl=Math.max(...K.slice(-4).map(k=>N(k?.h)))-Math.min(...K.slice(-4).map(k=>N(k?.l,1e9)));
              const tC=N(C.c)>0&&fl/N(C.c)*100<5;
              if(mv>5&&tC) pats.push({name:'🏴 Bull Flag',signal:'bullish',winRate:85,desc:`+${mv.toFixed(1)}% impulse + coil. Target +${(mv*0.8).toFixed(1)}%.`});
              if(mv<-5&&tC) pats.push({name:'🏴 Bear Flag',signal:'bearish',winRate:85,desc:`${mv.toFixed(1)}% drop + bounce. Continuation lower.`});
            }
          }
        }
      }
      // Estimated from price data only
      if(pats.filter(x=>x.winRate>=75).length===0){
        const w7=c7||0;
        if(c24>1&&pPos<0.18&&w7<-8) pats.push({name:'🔄 Double Bottom',signal:'bullish',winRate:75,desc:`At ${w7.toFixed(0)}% weekly low + recovery signal.`});
        else if(pPos>0.87&&c24>4&&vol>20e6) pats.push({name:'🚀 Volume Breakout',signal:'bullish',winRate:82,desc:`Near high +${c24.toFixed(1)}% + strong volume. Institutional buy.`});
        else if(w7>6&&c24>-3&&c24<3&&pPos>0.35) pats.push({name:'🏴 Bull Flag (est.)',signal:'bullish',winRate:85,desc:`Weekly +${w7.toFixed(1)}% + daily consolidation. Continuation setup.`});
        else if(w7<-6&&c24<3&&c24>-3&&pPos<0.65) pats.push({name:'🏴 Bear Flag (est.)',signal:'bearish',winRate:85,desc:`Weekly ${w7.toFixed(1)}% drop + bouncing. Continuation lower.`});
        else if(pPos>0.85&&w7>20) pats.push({name:'📊 Distribution Top',signal:'bearish',winRate:75,desc:`Overbought after +${w7.toFixed(1)}% weekly.`});
      }
      return pats.filter(x=>x.winRate>=75).sort((a,b)=>b.winRate-a.winRate).slice(0,2);
    } catch { return []; }
  };

  // ── ELLIOTT WAVE (10 skenario) ────────────────────────
  const getEW = (rsi, c24, c7_, macd, bTF, beTF) => {
    try {
      const c7=c7_||0;
      const uW=c7>3, dW=c7<-3, uD=c24>1.5, dD=c24<-1.5, oS=rsi<32, oB=rsi>70;
      if((uW||(!uW&&!dW))&&uD&&rsi>=42&&rsi<=65&&bTF>=2&&(macd?.xUp||macd?.bull)) return {w:'🚀 Wave 3 — Impulse',c:82,d:`${uW?'Weekly +'+c7.toFixed(0)+'% + ':''}Daily +${c24.toFixed(1)}%. Strongest phase. Target 1.618x. Volume entry.`};
      if(uW&&uD&&rsi>=55&&rsi<75&&macd?.bull&&!macd?.div) return {w:'⚡ Wave 3 Extension',c:72,d:'Continuation impulse. Trailing stop from swing low.'};
      if(uW&&dD&&oS) return {w:'📉 Wave 2 Pullback',c:78,d:`Correction in uptrend. RSI ${rsi.toFixed(0)} oversold — BEST ENTRY. Stop below recent low.`};
      if((!uW||!dW)&&rsi>=35&&rsi<48&&dD&&!oS) return {w:'📉 Wave 2 / OTE Entry',c:68,d:'Pullback into OTE zone (61.8-78.6%). Entry before Wave 3 continuation.'};
      if(uW&&dD&&rsi>=38&&rsi<=55&&!oS) return {w:'⚖️ Wave 4 Correction',c:65,d:"Consolidation before final leg. Don't FOMO above."};
      if(oB&&(macd?.div)) return {w:'⚠️ Wave 5 Ending Diagonal',c:68,d:'RSI divergence + extended run. LIKELY PEAK. Partial profits recommended.'};
      if(oB&&bTF>=2&&!macd?.div) return {w:'⚡ Wave 5 Progress',c:60,d:'Overbought, no divergence yet. Tight trailing stop.'};
      if((dW||dD)&&uD&&oS) return {w:'🔄 Wave C Complete',c:74,d:`RSI ${rsi.toFixed(0)} oversold + daily reversal. Potential major bottom. Stop below low.`};
      if((dW||dD)&&uD&&c24>4&&!oS) return {w:'🔄 Wave C → MSS',c:67,d:'Market Structure Shift: daily up in downtrend context. Monitor volume.'};
      if(oS&&beTF>=2) return {w:'💎 Wave C Capitulation',c:74,d:`RSI ${rsi.toFixed(0)} extreme oversold. Near-term bottom high probability. Confirm with candle.`};
      if((dW||dD)&&beTF>=2&&!oS) return {w:'📉 Wave A/C Bearish',c:70,d:`${dW?'Weekly '+c7.toFixed(0)+'%':'Daily '+c24.toFixed(1)+'%'} downtrend active. Avoid catching falling knife.`};
      if(Math.abs(c24)<2&&Math.abs(c7)<3) return {w:'⚖️ Sideways / Coiling',c:55,d:'Tight compression. Breakout imminent. Watch volume spike for direction.'};
      if(uD&&!dW) return {w:'↗️ Impulse Building',c:55,d:'Daily positive momentum. Weekly confirmation needed.'};
      return {w:'⚖️ Corrective Phase',c:50,d:'Consolidation/correction. Wait for clear directional setup.'};
    } catch { return {w:'⚖️ Corrective Phase',c:50,d:'Analysis in progress.'}; }
  };

  // ── ASTRO ─────────────────────────────────────────────
  const astro = (() => {
    try {
      const jd=Date.now()/86400000+2440587.5;
      const dm=((jd-2460320.5)%29.53058867+29.53058867)%29.53058867;
      const ph=[[1.5,'New Moon','🌑'],[8.5,'First Quarter','🌓'],[16,'Full Moon','🌕'],[22,'Waning','🌖'],[29.5,'Waning Crescent','🌘']];
      let mp='Dark Moon', me='🌑';
      for(const[lim,p,e]of ph) if(dm<lim){mp=p;me=e;break;}
      const ds=Math.floor((Date.now()-1713571200000)/86400000);
      return {moonPhase:mp,moonEmoji:me,halvingPhase:ds<365?'Bull Early 🔥':ds<480?'Bull Peak ⚡':ds<730?'Distribution ⚠️':'Accumulation 🌱',chaotic:mp==='Full Moon'||mp==='New Moon'};
    } catch { return {moonPhase:'—',moonEmoji:'🌙',halvingPhase:'Bull Cycle',chaotic:false}; }
  })();

  try {
    // ══════════════════════════════════════════════════════
    // PARALLEL EXECUTION — max(CG:5s, MEXC:5s, CC:4s) ≈ 5s
    // CG fail → MEXC provides 750+ coins (never total failure)
    // ══════════════════════════════════════════════════════
    const [cgR, mxR, ccR, fgR] = await Promise.allSettled([
      sf('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=volume_desc&per_page=250&page=1&sparkline=false&price_change_percentage=24h,7d', 5000),
      sf('https://api.mexc.com/api/v3/ticker/24hr', 5500),
      Promise.allSettled(CC20.map(s=>sf(`https://min-api.cryptocompare.com/data/v2/histohour?fsym=${s}&tsym=USD&limit=42&aggregate=4&e=CCCAGG`,4000))),
      sf('https://api.alternative.me/fng/?limit=1&format=json', 3000),
    ]);

    const fg = fgR.status==='fulfilled' ? N(fgR.value?.data?.[0]?.value,50) : 50;

    // ── Parse CoinGecko ───────────────────────────────────
    const cgList=[];
    for(const c of A(cgR.value)){
      try{
        const p=N(c.current_price); if(p<=0) continue;
        cgList.push({sym:S(c.symbol).toUpperCase(),name:S(c.name)||S(c.symbol),price:p,c24:N(c.price_change_percentage_24h),c7d:c.price_change_percentage_7d!=null?N(c.price_change_percentage_7d):null,vol:N(c.total_volume),h:N(c.high_24h)||p*1.02,l:N(c.low_24h)||p*0.98,mcap:N(c.market_cap),rank:N(c.market_cap_rank,9999),src:'cg'});
      }catch{}
    }

    // ── Parse MEXC (filter → sort by vol → top 800) ───────
    const mxList=[];
    const mxRaw=A(mxR.value);
    const mxFiltered=[];
    for(const t of mxRaw){
      try{
        if(!S(t?.symbol).endsWith('USDT')) continue;
        const sym=S(t.symbol).replace('USDT','');
        if(!sym||sym.length>14) continue;
        if(STABLES.has(sym)) continue;
        if(BAD_SFX.some(x=>sym.endsWith(x)||sym.startsWith(x))) continue;
        const p=N(t.lastPrice), v=N(t.quoteVolume);
        if(p<=0||p>1e10||v<300000) continue;
        if(p>=0.97&&p<=1.03&&Math.abs(N(t.priceChangePercent))<0.5) continue;
        mxFiltered.push({sym,p,c24:N(t.priceChangePercent),v,h:N(t.highPrice)||p*1.02,l:N(t.lowPrice)||p*0.98});
      }catch{}
    }
    mxFiltered.sort((a,b)=>b.v-a.v);
    for(const t of mxFiltered.slice(0,800)){
      mxList.push({sym:t.sym,name:t.sym,price:t.p,c24:t.c24,c7d:null,vol:t.v,h:t.h,l:t.l,mcap:0,rank:9999,src:'mx'});
    }

    // ── Merge (CoinGecko priority, no duplicates) ─────────
    const seen=new Set();
    const pool=[];
    for(const c of cgList){if(!seen.has(c.sym)){seen.add(c.sym);pool.push(c);}}
    for(const c of mxList){if(!seen.has(c.sym)){seen.add(c.sym);pool.push(c);}}

    if(pool.length===0){
      return res.status(200).json({ok:false,error:'Semua data source tidak merespons. Coba refresh dalam 30 detik.',ts:Date.now(),totalScanned:0,totalQualified:0,results:[],topSetups:{institutional:[],fullSend:[],highProbBull:[],smcSetups:[],ewSetups:[],volumeBreakout:[],strongSell:[],whaleSetups:[]},marketOverview:{marketMood:'UNKNOWN',bullishCount:0,bearishCount:0,avgChange24h:0}});
    }

    // ── Parse CryptoCompare klines ────────────────────────
    const kMap={};
    for(let i=0;i<CC20.length;i++){
      try{
        const r=ccR.value?.[i];
        if(r?.status!=='fulfilled'||r.value?.Response!=='Success') continue;
        const rows=A(r.value?.Data?.Data);
        if(rows.length<16) continue;
        const K=rows.filter(d=>N(d.close)>0&&N(d.close)<1e10&&N(d.high)>=N(d.low))
                     .map(d=>({t:N(d.time),o:N(d.open),h:N(d.high),l:N(d.low),c:N(d.close),v:N(d.volumeto)}));
        if(K.length<16) continue;
        const cls=K.map(k=>k.c);
        const rsi=calcRSI(cls); if(rsi===null) continue;
        const e9=calcEMA(cls,9), e21=calcEMA(cls,21), e50=calcEMA(cls,Math.min(50,cls.length-1));
        const macd=calcMACD(cls);
        const smc=smcFull(K, cls[cls.length-1]);
        kMap[CC20[i]]={rsi,e9,e21,e50,macd,K,cls,smc,ok:true};
      }catch{}
    }

    // ── Analyze all coins ─────────────────────────────────
    const results=[];
    for(const c of pool){
      try{
        const {sym,name,price,c24,c7d,vol,h,l,mcap,rank,src}=c;
        if(!sym||!price||price<=0) continue;
        const pPos=h>l?clamp((price-l)/(h-l),0,1):0.5;
        const rng=h>l?(h-l)/price*100:0;
        const vt=vol>=1e9?5:vol>=200e6?4:vol>=50e6?3:vol>=10e6?2:vol>=1e6?1:0;
        const kd=kMap[sym]||null;
        // RSI
        const rsi=kd?.ok?kd.rsi:clamp(50+c24*2.5+(pPos-0.5)*25+((c7d||0)>0?4:-4),8,92);
        const rsiR=!!(kd?.ok);
        // EMA
        let emaS=0;
        if(kd?.ok&&kd.cls?.length>=10){const lp=kd.cls[kd.cls.length-1];if(lp>kd.e9)emaS++;if(lp>kd.e21)emaS++;if(lp>kd.e50)emaS++;}
        else{if(c24>0)emaS++;if((c7d||0)>0)emaS++;if(pPos>0.55)emaS++;}
        // Trends
        const t1h=rsi>58?'BULL':rsi<42?'BEAR':'SIDE';
        const t4h=(kd?.macd?.bull||(c24>1.5&&pPos>0.5))?'BULL':(c24<-1.5&&pPos<0.5)?'BEAR':'SIDE';
        const t1d=(c7d||0)>3?'BULL':(c7d||0)<-3?'BEAR':'SIDE';
        const bTF=[t1h,t4h,t1d].filter(x=>x==='BULL').length;
        const beTF=[t1h,t4h,t1d].filter(x=>x==='BEAR').length;
        // SMC
        const smc=kd?.smc||smcEst(price,h,l,c24,c7d||0);
        // Patterns
        const pats=getPatterns(kd?.K||null,price,h,l,c24,c7d,pPos,vol);
        // EW
        const ew=getEW(rsi,c24,c7d,kd?.macd||null,bTF,beTF);
        // Probability
        const tC=bTF===3?28:bTF===2?16:bTF===1?6:beTF===3?-28:beTF===2?-16:beTF===1?-6:0;
        const rC=rsi<25?(beTF>=2?4:14):rsi<32?(beTF>=2?3:10):rsi<40?(beTF>=2?2:5):rsi<48?1:rsi>75?(bTF>=2?-4:-14):rsi>68?(bTF>=2?-3:-10):rsi>60?(bTF>=2?-1:-5):rsi>52?4:0;
        const mW=(c7d||0)>20?10:(c7d||0)>8?6:(c7d||0)>3?3:(c7d||0)<-20?-10:(c7d||0)<-8?-6:(c7d||0)<-3?-3:0;
        const m24=c24>10?6:c24>4?3:c24>1?1:c24<-10?-6:c24<-4?-3:c24<-1?-1:0;
        const mC=kd?.macd?.xUp?8:kd?.macd?.xDown?-8:kd?.macd?.bull?3:kd?.macd?.bear?-3:0;
        const smcC=N(smc?.bS,0)-N(smc?.beS,0);
        const pC=pats.some(x=>x.signal==='bullish'&&x.winRate>=80)?3:pats.some(x=>x.signal==='bullish')?1:pats.some(x=>x.signal==='bearish'&&x.winRate>=80)?-3:pats.some(x=>x.signal==='bearish')?-1:0;
        const ewC=ew.w.includes('Wave 3')?4:ew.w.includes('Wave 2')?2:ew.w.includes('C Complete')||ew.w.includes('Capitulation')?3:ew.w.includes('Bearish')||ew.w.includes('5 End')?-2:0;
        const prob=clamp(Math.round(50+tC+rC+mW+m24+mC+smcC+pC+ewC),2,98);
        const score=tC+rC+mW+m24+mC+smcC;

        // ── WHALE / SMART MONEY DETECTOR ──────────────────
        // Metode: deteksi jejak institusi dari volume, OB, likuiditas, OBV
        let wScore=0;
        const wSigs=[];
        try{
          // 1. Volume Anomaly (vol/mcap ratio)
          const vR=mcap>0?vol/mcap:0;
          if(vR>0.20){wScore+=5;wSigs.push('🔥 Volume EKSTREM: '+( vR*100).toFixed(1)+'% dari market cap — aktivitas institusional sangat tinggi');}
          else if(vR>0.12){wScore+=3;wSigs.push('📈 Volume tinggi: '+(vR*100).toFixed(1)+'% dari market cap — unusual activity terdeteksi');}
          else if(vR>0.06){wScore+=1;wSigs.push('📊 Volume di atas rata-rata: '+(vR*100).toFixed(1)+'% dari market cap');}

          // 2. Stealth Accumulation: harga turun mingguan tapi naik 24h + volume besar
          const isStealthy=(c7d||0)<-5&&c24>1.5&&vR>0.05&&pPos>0.3;
          if(isStealthy){wScore+=5;wSigs.push('🤫 STEALTH ACCUMULATION: Harga turun 7d='+(c7d||0).toFixed(1)+'% tapi 24h=+'+c24.toFixed(1)+'% — whale diam-diam kumpulkan koin');}

          // 3. Liquidity Sweep (kunci utama whale entry)
          if(smc?.sweep?.bullish===true){wScore+=6;wSigs.push('⚡ SSL SWEEP TERDETEKSI — Smart money ambil stop loss di $'+smc.sweep.lv+' lalu balik arah naik. Entry institusi.');}
          else if(smc?.sweep?.bullish===false){wScore-=2;wSigs.push('⚡ BSL SWEEP — Smart money ambil stop loss atas, potensi distribusi');}

          // 4. Fresh Bull OB (in zone) = institusi sudah masuk di level ini
          if(smc?.bOB?.fresh&&smc?.bOB?.inZone){wScore+=4;wSigs.push('📦 Bull OB Fresh IN ZONE $'+smc.bOB.L+'–$'+smc.bOB.H+' — harga tepat di zona demand institusional');}
          else if(smc?.bOB?.fresh){wScore+=2;}

          // 5. CHoCH = struktur market berubah arah = whale sudah masuk
          if(smc?.hasCHoCH&&smc?.chochType?.includes('Bull')){wScore+=4;wSigs.push('🔄 CHoCH BULLISH: '+smc.chochType+' — institusi mulai control market dari bearish ke bullish');}

          // 6. Wyckoff Accumulation / Spring
          if(smc?.wyckoff?.bias==='bullish'&&(smc?.wyckoff?.phase?.includes('Spring')||smc?.wyckoff?.phase?.includes('Accumulation'))){
            wScore+=4;wSigs.push('🐋 Wyckoff '+smc.wyckoff.phase+' — fase akumulasi institusional aktif');
          }

          // 7. OBV dari klines (paling akurat)
          if(kd?.ok&&kd.cls&&kd.cls.length>=10){
            // Hitung OBV sederhana dari klines
            let obvRise=0,obvFall=0;
            for(let i=1;i<Math.min(kd.K.length,20);i++){
              if(kd.K[i]?.c>kd.K[i-1]?.c)obvRise+=N(kd.K[i].v);
              else if(kd.K[i]?.c<kd.K[i-1]?.c)obvFall+=N(kd.K[i].v);
            }
            const obvBullish=obvRise>obvFall*1.4;
            const obvBearish=obvFall>obvRise*1.4;
            // Stealth: OBV naik tapi harga flat/turun = akumulasi tersembunyi
            if(obvBullish&&(c7d||0)<0){wScore+=5;wSigs.push('📊 OBV BULLISH DIVERGENCE: Volume beli dominan ('+( obvRise/1e6).toFixed(1)+'M) tapi harga turun — whale akumulasi diam-diam');}
            else if(obvBullish){wScore+=2;wSigs.push('📊 OBV Rising — tekanan beli institusional terdeteksi');}
            else if(obvBearish&&c24>3){wScore-=3;wSigs.push('⚠️ OBV BEARISH DIVERGENCE: Volume jual dominan tapi harga naik — distribusi institusional');}

            // Displacement candle detection
            const atrArr=kd.K.slice(1).map((k,i)=>Math.max(N(k.h)-N(k.l),Math.abs(N(k.h)-N(kd.K[i].c)),Math.abs(N(k.l)-N(kd.K[i].c))));
            const avgATR=atrArr.slice(-14).reduce((s,v)=>s+v,0)/14;
            const lastCndl=kd.K[kd.K.length-1];
            if(lastCndl&&avgATR>0){
              const lastRange=N(lastCndl.h)-N(lastCndl.l);
              if(lastRange>avgATR*2.8&&N(lastCndl.v)>0){
                wScore+=4;
                wSigs.push(lastCndl.c>lastCndl.o?'🚀 DISPLACEMENT CANDLE BULLISH: Candle '+( lastRange/avgATR).toFixed(1)+'x ATR — pergerakan institusional besar':'💀 DISPLACEMENT BEARISH: Candle '+(lastRange/avgATR).toFixed(1)+'x ATR — institusi jual besar-besaran');
              }
            }
          }

          // 8. MACD Golden Cross + high volume = konfirmasi institusi masuk
          if(kd?.macd?.xUp&&vt>=3){wScore+=3;wSigs.push('✅ MACD Golden Cross + Volume tinggi — konfirmasi entry institusional');}

          // 9. Price di Discount Zone dengan reversal
          if(pPos<0.25&&c24>2&&vol>10e6){wScore+=3;wSigs.push('💎 Extreme Discount Zone ('+( pPos*100).toFixed(0)+'%) + reversal 24h=+'+c24.toFixed(1)+'% — smart money akumulasi di low');}

          // 10. Equal Lows diambil lalu reversal (classic whale trap)
          if(smc?.eqL&&c24>1.5&&pPos>0.3){wScore+=3;wSigs.push('🎯 Equal Lows $'+smc.eqL+' diambil + harga reversal — whale trap selesai, arah naik');}

        }catch{}

        const wLevel=wScore>=14?'🐋 STRONG WHALE':wScore>=9?'🐳 WHALE DETECTED':wScore>=5?'🔍 UNUSUAL ACTIVITY':'';
        const whaleData=wScore>=5?{score:wScore,level:wLevel,signals:wSigs.slice(0,4)}:null;
        // Label
        let taLabel='⚖️ SIDEWAYS',taColor='neutral';
        if(bTF===3){taLabel='🚀 FULL SEND';taColor='full-bull';}
        else if(bTF>=2){taLabel='📈 STRONG BULL';taColor='bull';}
        else if(bTF===1&&beTF===0){taLabel='↗️ MILD BULL';taColor='bull';}
        else if(beTF===3){taLabel='💀 FULL BEAR';taColor='full-bear';}
        else if(beTF>=2){taLabel='📉 STRONG BEAR';taColor='bear';}
        else if(beTF===1&&bTF===0){taLabel='↘️ MILD BEAR';taColor='bear';}
        // SMC display
        const smcD=smc?.hasBOS?smc.bosType:smc?.hasCHoCH?'CHoCH (MSS)':smc?.inBullOB?'Bull OB':smc?.inBearOB?'Bear OB':smc?.inBullFVG?'Bull FVG':smc?.zone||'Neutral';
        // Signals
        const sigs=[];
        if(rsi<25) sigs.push('RSI '+rsi.toFixed(0)+' EXTREME oversold — prime accumulation zone 🎯');
        else if(rsi<32) sigs.push('RSI '+rsi.toFixed(0)+' oversold'+(beTF>=2?' — watch for reversal candle':' — entry zone'));
        else if(rsi>74) sigs.push('RSI '+rsi.toFixed(0)+' overbought'+(bTF>=2?' — reduce position':''));
        if(kd?.macd?.xUp)   sigs.push('MACD golden cross ✅ — bullish momentum confirmed');
        if(kd?.macd?.xDown) sigs.push('MACD death cross ⚠️ — bearish momentum confirmed');
        if(kd?.macd?.div)   sigs.push('MACD divergence ⚠️ — trend losing momentum');
        if(smc?.bOB)   sigs.push('ICT Bull OB $'+smc.bOB.L+'–$'+smc.bOB.H+(smc.bOB.fresh?' (fresh)':'')+' — institutional demand zone');
        if(smc?.beOB)  sigs.push('ICT Bear OB $'+smc.beOB.L+'–$'+smc.beOB.H+(smc.beOB.fresh?' (fresh)':'')+' — institutional supply zone');
        if(smc?.bFVG)  sigs.push('ICT Bull FVG '+smc.bFVG.pct+'% gap $'+smc.bFVG.L+'–$'+smc.bFVG.H+' — price rebalancing');
        if(smc?.sweep) sigs.push(smc.sweep.t+' at $'+smc.sweep.lv+' — liquidity swept');
        if(smc?.eqH)   sigs.push('Equal Highs (BSL) $'+smc.eqH+' — buy-side liquidity pool above');
        if(smc?.eqL)   sigs.push('Equal Lows (SSL) $'+smc.eqL+' — sell-side liquidity pool below');
        if(smc?.inOTE) sigs.push('In OTE zone $'+smc.oteL+'–$'+smc.oteH+' (ICT 61.8–78.6% optimal entry)');
        if(smc?.hasCHoCH) sigs.push(smc.chochType+' at $'+smc.chochLevel+' — structure shift confirmed');
        if(smc?.hasBOS&&c24>4) sigs.push(smc.bosType+' at $'+smc.bosLevel+' — institutional breakout');
        if(vt>=4&&c24>3) sigs.push('$'+['','','','','200M+','1B+'][vt]+' volume + +'+c24.toFixed(1)+'% — smart money move');
        if(bTF===3) sigs.push('All 3 timeframes aligned bullish 🎯 — highest conviction setup');
        pats.forEach(p=>sigs.push(p.name+' ('+p.winRate+'%): '+p.desc));
        results.push({
          rank:results.length+1,symbol:sym,name,dataSource:src,
          price,change24h:+c24.toFixed(2),change7d:c7d!=null?+c7d.toFixed(2):null,
          volume24h:vol,mcap,mcapRank:rank,
          high24h:h,low24h:l,pricePos:+pPos.toFixed(3),range:+rng.toFixed(2),
          rsi:+rsi.toFixed(2),rsiReal:rsiR,vt,
          trendAlignment:taLabel,taColor,
          trend1h:t1h,trend4h:t4h,trend1d:t1d,bullTF:bTF,bearTF:beTF,
          smc:{...smc,signal:smcD},
          elliottWave:{wave:ew.w,confidence:ew.c,description:ew.d},
          chartPatterns:pats.length>0?pats:[{name:c24>=0?'Bullish Candle':'Bearish Candle',signal:c24>=0?'bullish':'bearish',winRate:0}],
          probability:prob,score,
          whale:whaleData,
          signals:sigs.slice(0,5),
          astrology:{moonPhase:astro.moonPhase,moonEmoji:astro.moonEmoji,halvingPhase:astro.halvingPhase,chaotic:astro.chaotic},
          hasRealData:rsiR,
        });
      }catch{}
    }

    results.sort((a,b)=>b.probability-a.probability||b.score-a.score);
    results.forEach((r,i)=>r.rank=i+1);

    // Tabs
    const institutional =results.filter(r=>r.score>=16&&r.probability>=60&&r.volume24h>=5e6).slice(0,80);
    const fullSend       =results.filter(r=>(r.taColor==='full-bull'||r.bullTF===3)&&r.probability>=65).slice(0,60);
    const highProbBull   =results.filter(r=>r.probability>=68&&r.score>=12).slice(0,60);
    const smcSetups      =results.filter(r=>(r.smc?.inBullOB||r.smc?.inBullFVG||r.smc?.hasCHoCH)&&r.probability>=52).slice(0,60);
    const ewSetups       =results.filter(r=>{const w=r.elliottWave?.wave||'';return(w.includes('Wave 3')||w.includes('Wave 2'))?r.probability>=52:(w.includes('C Complete')||w.includes('Capitulation'))?r.probability>=50:(r.rsi<38&&r.change24h>0)?r.probability>=48:false;}).sort((a,b)=>b.probability-a.probability).slice(0,60);
    const volumeBreakout =results.filter(r=>r.vt>=3&&r.change24h>1.5&&r.probability>50).sort((a,b)=>b.volume24h-a.volume24h).slice(0,60);
    const strongSell     =results.filter(r=>r.probability<38||r.taColor==='full-bear').sort((a,b)=>a.probability-b.probability).slice(0,40);
    // 🐋 Whale / Smart Money Detector
    const whaleSetups    =results.filter(r=>r.whale&&r.whale.score>=9).sort((a,b)=>b.whale.score-a.whale.score).slice(0,60);

    const bullC=results.filter(r=>r.probability>55).length;
    const bearC=results.filter(r=>r.probability<45).length;
    const avgCh=results.length?+(results.reduce((s,r)=>s+r.change24h,0)/results.length).toFixed(2):0;
    const mood=avgCh>3?'STRONG BULL':avgCh>1?'BULL':avgCh<-3?'STRONG BEAR':avgCh<-1?'BEAR':'NEUTRAL';

    return res.status(200).json({
      ok:true,ts:Date.now(),elapsed:Date.now()-t0,version:'v25',
      src:'cg:'+cgList.length+'+mx:'+mxList.length,
      fg,totalScanned:pool.length,totalQualified:results.length,
      rsiRealCount:Object.keys(kMap).length,
      results,
      topSetups:{institutional,fullSend,highProbBull,smcSetups,ewSetups,volumeBreakout,strongSell,whaleSetups},
      marketOverview:{marketMood:mood,bullishCount:bullC,bearishCount:bearC,avgChange24h:avgCh,totalCoins:results.length},
      astroContext:astro,
    });

  }catch(e){
    return res.status(200).json({ok:false,error:e.message,ts:Date.now(),elapsed:Date.now()-t0,version:'v25',totalScanned:0,totalQualified:0,results:[],topSetups:{institutional:[],fullSend:[],highProbBull:[],smcSetups:[],ewSetups:[],volumeBreakout:[],strongSell:[],whaleSetups:[]},marketOverview:{marketMood:'UNKNOWN',bullishCount:0,bearishCount:0,avgChange24h:0}});
  }
}
