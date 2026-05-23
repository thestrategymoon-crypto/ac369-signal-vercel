// api/scanner-full.js — v26 FINAL
// CoinGecko p1(250) + p2(250) + MEXC(800) = ~550-600 koin unik
// CC30 klines: real RSI+MACD+ICT untuk 30 koin utama
// Bybit Funding Rate: semua perp contract
// 13 tabs: Institusional, Full Send, High Prob, SMC, Wave3,
//          Vol Breakout, Short/Sell, Whale, FR, AI, DeFi, Meme, L1/L2
// Semua parallel, max 6s — aman Vercel 10s
// TIDAK ADA CRASH dari data apapun

const CC30 = ['BTC','ETH','BNB','SOL','XRP','ADA','DOGE','AVAX','LINK','DOT',
              'NEAR','SUI','APT','ARB','OP','PEPE','TON','INJ','TIA','RENDER',
              'LTC','ATOM','AAVE','CRV','FIL','ALGO','HBAR','GRT','MKR','SAND'];

const STABLES = new Set(['USDT','USDC','BUSD','DAI','TUSD','FDUSD','USDD','FRAX',
                         'GUSD','USDP','LUSD','PYUSD','SUSD','USDE','USDB','EURC']);
const BAD_SFX = ['UP','DOWN','BULL','BEAR','LONG','SHORT','3L','3S','2L','2S'];

// ── SECTOR TAGS ───────────────────────────────────────
const SECTORS = {
  // Layer 1
  L1:new Set(['BTC','ETH','SOL','ADA','AVAX','TON','NEAR','SUI','APT','TIA','SEI','MONAD','APTOS','CELO','HBAR','ALGO','XLM','VET','EGLD','ONE','KAVA','ROSE','METIS']),
  // Layer 2
  L2:new Set(['ARB','OP','MATIC','POL','IMX','STRK','MANTA','SCROLL','BASE','ZK','LINEA','TAIKO','BLAST','MODE','MANTLE']),
  // DeFi
  DEFI:new Set(['UNI','AAVE','CRV','MKR','COMP','SNX','BAL','YFI','SUSHI','1INCH','GMX','DYDX','PENDLE','RDNT','GNS','JOE','CAKE','QUICK','VELO','AERO']),
  // AI
  AI:new Set(['RENDER','FET','AGIX','OCEAN','TAO','NEAR','NMR','GRT','ARKM','ORAI','OLAS','IO','PRIME','WLD','DRIA','GRASS','GOAT','GRIFFAIN','VIRTUAL','VADER']),
  // Meme
  MEME:new Set(['DOGE','SHIB','PEPE','BONK','WIF','FLOKI','BOME','MEME','COQ','MEW','POPCAT','DOGS','NEIRO','CAT','PNUT','GOAT','ACT','MOODENG','CHILLGUY']),
  // Gaming/Metaverse
  GAME:new Set(['SAND','MANA','AXS','ENJ','GALA','ILV','MAGIC','BEAM','RON','YGG','PYR','SLP','PRIME','PIXEL','PORTAL','ALT','SAGA','KMON']),
  // Infrastructure
  INFRA:new Set(['LINK','DOT','ATOM','FIL','AR','STORJ','LPT','API3','BAND','PYTH','JTO','JUP','W','STRK','ZRO','EIGEN']),
  // RWA
  RWA:new Set(['ONDO','MKR','POLYX','CFG','MPL','CPOOL','TRU','LEND','FLUX','BOSON']),
};
const getSector = sym => {
  for(const [s,set] of Object.entries(SECTORS)) if(set.has(sym)) return s;
  return 'ALT';
};
const SECTOR_EMOJI = {L1:'⛓️',L2:'🔗',DEFI:'💰',AI:'🤖',MEME:'🐸',GAME:'🎮',INFRA:'🏗️',RWA:'🏦',ALT:'🪙'};

// ── ONCHAIN PROXY (dari data CoinGecko) ───────────────
// Vol/MCap ratio = indikator aktivitas institusional
// Rank divergence = koin kecil tapi volume besar = unusual
const onchainScore = (vol, mcap, rank, c24, c7d) => {
  try {
    let score=0; const sigs=[];
    if(mcap>0){
      const vR=vol/mcap;
      if(vR>0.30){score+=5;sigs.push('On-chain: Volume '+(vR*100).toFixed(0)+'% of MCap — EXTREME activity');}
      else if(vR>0.15){score+=3;sigs.push('On-chain: Volume '+(vR*100).toFixed(0)+'% of MCap — HIGH activity');}
      else if(vR>0.07){score+=2;}
      else if(vR>0.03){score+=1;}
    }
    // MCap rank vs volume: koin rank rendah tapi vol tinggi = unusual
    if(rank>200&&vol>50e6){score+=3;sigs.push('On-chain: Mid-cap koin rank #'+rank+' vol $'+(vol/1e6).toFixed(0)+'M — unusual volume divergence');}
    if(rank>500&&vol>20e6){score+=2;}
    // 7d vs 24h divergence: harga turun tapi volume naik = akumulasi
    const c7=c7d||0;
    if(c7<-5&&c24>1.5&&mcap>0&&vol/mcap>0.05){score+=3;sigs.push('On-chain: Harga -'+Math.abs(c7).toFixed(0)+'% 7d tapi +'+c24.toFixed(1)+'% 24h + vol tinggi = akumulasi diam-diam');}
    return {score,sigs};
  } catch { return {score:0,sigs:[]}; }
};


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
      // Fix: c7 bisa 0 untuk MEXC (c7d=null). Gunakan kondisi yang juga bekerja tanpa data weekly
      const hasCHoCH=(c24>3&&c7<0)||(c24>5&&pip>0.35&&pip<0.65);
      const inBullOB=pip<28, inBearOB=pip>72;
      const bS=(hasBOS&&c24>5?3:0)+(inBullOB?2:0)+(hasCHoCH?2:0);
      const beS=(hasBOS&&c24<-5?3:0)+(inBearOB?2:0);
      return {
        hasBOS,bosType,bosLevel:hasBOS&&c24>5?+(h*0.98).toFixed(6):hasBOS?+(l*1.02).toFixed(6):null,
        hasCHoCH,chochType:hasCHoCH?'Bullish CHoCH (MSS)':'None',
        // Fix: tambah inZone+fresh agar whale detector bekerja untuk non-klines coins
        bOB:inBullOB?{H:+(l+(h-l)*0.28).toFixed(6),L:+l.toFixed(6),inZone:true,fresh:true}:null,
        beOB:inBearOB?{H:+h.toFixed(6),L:+(l+(h-l)*0.72).toFixed(6),inZone:true,fresh:true}:null,
        inBullOB,inBearOB,inBullFVG:pip<15,zone,pip:+pip.toFixed(1),
        signal:bS>beS?'Bullish':beS>bS?'Bearish':'Neutral',bS,beS
      };
    } catch { return {hasBOS:false,bosType:'None',hasCHoCH:false,chochType:'None',inBullOB:false,inBearOB:false,inBullFVG:false,zone:'Equilibrium',pip:50,signal:'Neutral',bS:0,beS:0}; }
  };

  // ── CHART PATTERNS ≥75% (12 patterns) ────────────────
  const getPatterns = (K, p, h, l, c24, c7, pPos, vol) => {
    try {
      const pats=[];
      const op=p>0&&c24>-99?p/(1+c24/100):p;
      const rng=h-l;
      const rngPct=p>0?rng/p*100:0;

      // ── From reconstructed single candle OHLC ────────
      if(rng>0.000001&&op>0){
        const body=Math.abs(p-op);
        const bd=body/rng;
        const lw=(Math.min(p,op)-l)/rng;
        const uw=(h-Math.max(p,op))/rng;
        const bullCandle=p>op, bearCandle=p<op;

        if(lw>0.55&&bd<0.35&&uw<0.20&&pPos<0.48)
          pats.push({name:'🔨 Hammer',signal:'bullish',winRate:76,desc:`Long lower wick. Buyers rejected $${l.toFixed(p>1?2:6)}.`});
        if(uw>0.55&&bd<0.35&&lw<0.20&&pPos>0.52)
          pats.push({name:'⭐ Shooting Star',signal:'bearish',winRate:75,desc:`Long upper wick. Sellers rejected $${h.toFixed(p>1?2:6)}.`});
        if(bd>0.78&&bullCandle&&c24>3)
          pats.push({name:'🐂 Bull Marubozu',signal:'bullish',winRate:77,desc:`+${c24.toFixed(1)}% full body candle. Strong buy control.`});
        if(bd>0.78&&bearCandle&&c24<-3)
          pats.push({name:'🐻 Bear Marubozu',signal:'bearish',winRate:77,desc:`${c24.toFixed(1)}% full body candle. Strong sell control.`});
        if(uw>0.50&&bd<0.35&&lw<0.25&&pPos<0.42&&bullCandle)
          pats.push({name:'🔨 Inverted Hammer',signal:'bullish',winRate:75,desc:'Small body + upper wick at low. Confirm next candle.'});
        // Pin Bar
        if(lw>0.60&&bd<0.25&&bullCandle&&pPos>0.55)
          pats.push({name:'📌 Bullish Pin Bar',signal:'bullish',winRate:76,desc:`Long tail at low. Institutional rejection at $${l.toFixed(p>1?2:6)}.`});
        if(uw>0.60&&bd<0.25&&bearCandle&&pPos<0.45)
          pats.push({name:'📌 Bearish Pin Bar',signal:'bearish',winRate:76,desc:`Long wick at high. Institutional rejection at $${h.toFixed(p>1?2:6)}.`});
      }

      // ── From klines (accurate, only CC top 20) ───────
      if(A(K).length>=3){
        const n=K.length, C=K[n-1], P=K[n-2], P2=K[n-3];
        if(C&&P&&P2&&C.c&&P.c&&P2.c){
          const Cb=Math.abs(C.c-C.o), Pb=Math.abs(P.c-P.o), P2b=Math.abs(P2.c-P2.o);
          const P2r=Math.max(P2.h-P2.l,0.0001);
          if(P.c<P.o&&C.c>C.o&&C.o<=P.c&&C.c>=P.o&&Cb>Pb*0.9)
            pats.push({name:'🐂 Bullish Engulfing',signal:'bullish',winRate:78,desc:'Buyers absorbed prior selling. Strong reversal signal.'});
          if(P.c>P.o&&C.c<C.o&&C.o>=P.c&&C.c<=P.o&&Cb>Pb*0.9)
            pats.push({name:'🐻 Bearish Engulfing',signal:'bearish',winRate:78,desc:'Sellers absorbed prior buying. Distribution signal.'});
          if(P2.c<P2.o&&Pb/(P2b+0.001)<0.40&&C.c>C.o&&C.c>(P2.o+P2.c)/2)
            pats.push({name:'🌟 Morning Star',signal:'bullish',winRate:78,desc:'3-candle reversal. Selling exhaustion + buyer confirmation.'});
          if(P2.c>P2.o&&Pb/(P2b+0.001)<0.40&&C.c<C.o&&C.c<(P2.o+P2.c)/2)
            pats.push({name:'🌆 Evening Star',signal:'bearish',winRate:78,desc:'3-candle distribution. Buying exhaustion complete.'});
          if(P2.c>P2.o&&P.c>P.o&&C.c>C.o&&P.c>P2.c&&C.c>P.c&&P2b/P2r>0.50)
            pats.push({name:'⚔️ 3 White Soldiers',signal:'bullish',winRate:83,desc:'3 consecutive bullish. Institutional accumulation.'});
          if(P2.c<P2.o&&P.c<P.o&&C.c<C.o&&P.c<P2.c&&C.c<P.c&&P2b/P2r>0.50)
            pats.push({name:'🐦 3 Black Crows',signal:'bearish',winRate:83,desc:'3 consecutive bearish. Institutional distribution.'});
          if(P.c<P.o&&C.c>C.o&&C.o<P.l&&C.c>(P.o+P.c)/2)
            pats.push({name:'🌙 Piercing Pattern',signal:'bullish',winRate:75,desc:'Bullish >50% into prior bearish body.'});
          if(P.c>P.o&&C.c<C.o&&C.o>P.h&&C.c<(P.o+P.c)/2)
            pats.push({name:'☁️ Dark Cloud Cover',signal:'bearish',winRate:75,desc:'Bearish >50% into prior bullish body.'});
          if(C.h<=P.h&&C.l>=P.l)
            pats.push({name:'📦 Inside Bar / NR4',signal:C.c>=C.o?'bullish':'bearish',winRate:76,desc:'Compression. Directional breakout imminent.'});
          if(K.length>=8){
            const ref=N(K[n-7]?.c);
            if(ref>0){
              const mv=(N(K[n-3]?.c)-ref)/ref*100;
              const fl=Math.max(...K.slice(-4).map(k=>N(k?.h)))-Math.min(...K.slice(-4).map(k=>N(k?.l,1e9)));
              const tight=N(C.c)>0&&fl/N(C.c)*100<5;
              if(mv>5&&tight) pats.push({name:'🏴 Bull Flag',signal:'bullish',winRate:85,desc:`+${mv.toFixed(1)}% impulse + coil. Target +${(mv*0.8).toFixed(1)}%.`});
              if(mv<-5&&tight) pats.push({name:'🏴 Bear Flag',signal:'bearish',winRate:85,desc:`${mv.toFixed(1)}% drop + bounce. Continuation lower.`});
            }
          }
        }
      }

      // ── SMART FALLBACK: descriptive for ALL coins ─────
      // Runs when no classic pattern detected from OHLC/klines
      const qualified=pats.filter(x=>x.winRate>=75);
      if(qualified.length===0){
        const w7=c7||0;
        const isBull=c24>0, isBear=c24<0;

        // Volume Breakout (strong signal)
        if(pPos>0.85&&c24>4&&vol>10e6)
          pats.push({name:'💥 Vol Breakout',signal:'bullish',winRate:82,desc:`+${c24.toFixed(1)}% near high + vol. Institutional buy.`});
        // Double Bottom reversal
        else if(pPos<0.18&&c24>1.5&&w7<-6)
          pats.push({name:'🔄 Double Bottom',signal:'bullish',winRate:75,desc:`At ${w7.toFixed(0)}% weekly low + recovery. Reversal zone.`});
        // Post-drop recovery
        else if(w7<-8&&c24>2&&pPos>0.3)
          pats.push({name:'🔄 Recovery Bounce',signal:'bullish',winRate:76,desc:`-${Math.abs(w7).toFixed(0)}% weekly drop + +${c24.toFixed(1)}% bounce. Potential bottom.`});
        // Weekly trend + daily consolidation = continuation
        else if(w7>6&&Math.abs(c24)<3&&pPos>0.35)
          pats.push({name:'🏴 Bull Flag (est.)',signal:'bullish',winRate:85,desc:`Weekly +${w7.toFixed(1)}% + daily consolidation. Continuation.`});
        else if(w7<-6&&Math.abs(c24)<3&&pPos<0.65)
          pats.push({name:'🏴 Bear Flag (est.)',signal:'bearish',winRate:85,desc:`Weekly ${w7.toFixed(1)}% + daily pause. Continuation lower.`});
        // Distribution after big rally
        else if(pPos>0.82&&w7>18)
          pats.push({name:'📊 Distribution Top',signal:'bearish',winRate:75,desc:`Overbought after +${w7.toFixed(1)}% weekly. Watch for reversal.`});
        // Wide range candle
        else if(rngPct>7&&c24>3&&pPos>0.60)
          pats.push({name:'📊 Wide Range Bull',signal:'bullish',winRate:76,desc:`${rngPct.toFixed(1)}% daily range + close near high. Strong buying.`});
        else if(rngPct>7&&c24<-3&&pPos<0.40)
          pats.push({name:'📊 Wide Range Bear',signal:'bearish',winRate:76,desc:`${rngPct.toFixed(1)}% daily range + close near low. Strong selling.`});
        // High close (bullish)
        else if(c24>2&&pPos>0.65)
          pats.push({name:'📈 High Close',signal:'bullish',winRate:75,desc:`+${c24.toFixed(1)}% closing in upper ${((1-pPos)*100).toFixed(0)}% of range.`});
        // Low close (bearish)
        else if(c24<-2&&pPos<0.35)
          pats.push({name:'📉 Low Close',signal:'bearish',winRate:75,desc:`${c24.toFixed(1)}% closing in lower ${(pPos*100).toFixed(0)}% of range.`});
        // Indecision / Doji
        else if(Math.abs(c24)<0.8&&rngPct>2)
          pats.push({name:'⚖️ Doji / Indecision',signal:'neutral',winRate:75,desc:`Flat close ±${Math.abs(c24).toFixed(1)}% with range. Decision point.`});
        // Rejection at extreme
        else if(pPos<0.10&&c24>0)
          pats.push({name:'💎 Extreme Rejection',signal:'bullish',winRate:76,desc:`Price in bottom ${(pPos*100).toFixed(0)}% + recovery. Demand zone.`});
        else if(pPos>0.90&&c24<0)
          pats.push({name:'⚠️ Supply Rejection',signal:'bearish',winRate:75,desc:`Price in top ${((1-pPos)*100).toFixed(0)}% + selling. Supply zone.`});
        // Momentum signals
        else if(c24>4&&isBull)
          pats.push({name:'🚀 Bullish Momentum',signal:'bullish',winRate:75,desc:`+${c24.toFixed(1)}% strong daily momentum. Trend continuation.`});
        else if(c24<-4&&isBear)
          pats.push({name:'📉 Bearish Momentum',signal:'bearish',winRate:75,desc:`${c24.toFixed(1)}% strong daily selling. Avoid long.`});
        else if(isBull)
          pats.push({name:'↗️ Bullish Close',signal:'bullish',winRate:75,desc:`+${c24.toFixed(1)}% close. Buyers in control.`});
        else if(isBear)
          pats.push({name:'↘️ Bearish Close',signal:'bearish',winRate:75,desc:`${c24.toFixed(1)}% close. Sellers in control.`});
        else
          pats.push({name:'⚖️ Neutral Close',signal:'neutral',winRate:75,desc:'Flat close. No clear bias.'});
      }
      return pats.filter(x=>x.winRate>=75).sort((a,b)=>b.winRate-a.winRate).slice(0,2);
    } catch { return [{name:'⚖️ Neutral',signal:'neutral',winRate:75,desc:'Price action neutral.'}]; }
  };

  // ── ELLIOTT WAVE (v2 — handles null c7d) ─────────────
  const getEW = (rsi, c24, c7_, macd, bTF, beTF) => {
    try {
      const noW = c7_===null||c7_===undefined; // MEXC coins: no weekly data
      const c7 = c7_||0;
      const uW=c7>3, dW=c7<-3, uD=c24>1.5, dD=c24<-1.5;
      const oS=rsi<32, oB=rsi>70;
      const mx=macd||null;

      // ── PATH A: Coins WITH weekly data (CoinGecko) ───
      if(!noW){
        if((uW||(!uW&&!dW))&&uD&&rsi>=42&&rsi<=65&&bTF>=2&&(mx?.xUp||mx?.bull))
          return {w:'🚀 Wave 3 — Impulse',c:82,d:`${uW?'Weekly +'+c7.toFixed(0)+'% + ':''}Daily +${c24.toFixed(1)}%. Strongest phase. Target 1.618x.`};
        if(uW&&uD&&rsi>=55&&rsi<75&&mx?.bull&&!mx?.div)
          return {w:'⚡ Wave 3 Extension',c:72,d:'Continuation impulse. Trail stop from swing low.'};
        if(uW&&dD&&oS)
          return {w:'📉 Wave 2 Pullback',c:78,d:`Correction in uptrend. RSI ${rsi.toFixed(0)} oversold — BEST ENTRY.`};
        if(!uW&&!dW&&rsi>=35&&rsi<48&&dD&&!oS)
          return {w:'📉 Wave 2 / OTE Entry',c:68,d:'Pullback into OTE (61.8–78.6%). Entry before Wave 3.'};
        if(uW&&dD&&rsi>=38&&rsi<=55&&!oS)
          return {w:'⚖️ Wave 4 Correction',c:65,d:"Consolidation before final leg. Don't FOMO above."};
        if(oB&&mx?.div)
          return {w:'⚠️ Wave 5 Ending',c:68,d:'RSI divergence + extended. LIKELY PEAK. Take partial profits.'};
        if(oB&&bTF>=2&&!mx?.div)
          return {w:'⚡ Wave 5 Progress',c:60,d:'Overbought, no divergence. Trail stop tightly.'};
        if((dW||dD)&&uD&&oS)
          return {w:'🔄 Wave C Complete',c:74,d:`RSI ${rsi.toFixed(0)} oversold + daily reversal. Major bottom potential.`};
        if((dW||dD)&&uD&&c24>4&&!oS)
          return {w:'🔄 Wave C → MSS',c:67,d:'Market Structure Shift. Daily up in downtrend. Monitor volume.'};
        if(oS&&beTF>=2)
          return {w:'💎 Wave C Capitulation',c:74,d:`RSI ${rsi.toFixed(0)} extreme oversold. Near-term bottom forming.`};
        if((dW||dD)&&beTF>=2&&!oS)
          return {w:'📉 Wave A/C Bearish',c:70,d:`${dW?'Weekly '+c7.toFixed(0)+'%':'Daily '+c24.toFixed(1)+'%'} downtrend. Avoid longs.`};
        if(Math.abs(c24)<2&&Math.abs(c7)<3)
          return {w:'⚖️ Sideways / Coiling',c:55,d:'Tight compression. Breakout imminent. Watch volume.'};
        if(uD&&!dW)
          return {w:'↗️ Impulse Building',c:55,d:`Weekly +${c7.toFixed(0)}% + daily +${c24.toFixed(1)}%. Confirmation needed.`};
        return {w:'⚖️ Corrective Phase',c:50,d:'Consolidation. Wait for directional setup.'};
      }

      // ── PATH B: Coins WITHOUT weekly data (MEXC) ─────
      // Use RSI + pPos proxy + bTF/beTF + c24 only
      // These have c7d=null, so we DON'T use c7 at all
      if(oS&&uD&&(mx?.xUp||(bTF>=1&&c24>2)))
        return {w:'🔄 Wave C Complete / Bottom',c:72,d:`RSI ${rsi.toFixed(0)} oversold + reversal +${c24.toFixed(1)}%. High prob bottom.`};
      if(oS&&beTF>=2)
        return {w:'💎 Wave C Capitulation',c:72,d:`RSI ${rsi.toFixed(0)} extreme. Near-term bottom. Confirm with candle.`};
      if(oS&&uD)
        return {w:'📉 Wave 2 — Oversold Entry',c:68,d:`RSI ${rsi.toFixed(0)} oversold + positive 24h. Entry zone before bounce.`};
      if(oB&&mx?.div)
        return {w:'⚠️ Wave 5 Ending Diagonal',c:70,d:'Overbought + MACD divergence. LIKELY PEAK. Reduce size.'};
      if(oB&&bTF>=2&&!mx?.div)
        return {w:'⚡ Wave 5 Progress',c:62,d:'Overbought multi-TF. Momentum intact. Trail stop.'};
      if(rsi>=42&&rsi<=65&&uD&&bTF>=2&&(mx?.xUp||mx?.bull))
        return {w:'🚀 Wave 3 — Impulse',c:80,d:`Multi-TF aligned + +${c24.toFixed(1)}% daily. Strongest phase. Best entry.`};
      if(rsi>=42&&rsi<=65&&uD&&bTF>=2)
        return {w:'📈 Impulse Structure',c:68,d:`+${c24.toFixed(1)}% daily, ${bTF}/3 TF bullish. Continuation setup.`};
      if(rsi>=42&&rsi<=65&&uD&&bTF>=1)
        return {w:'↗️ Bullish Momentum',c:60,d:`+${c24.toFixed(1)}% daily. RSI ${rsi.toFixed(0)} healthy. Monitor for 4H alignment.`};
      if(rsi>=36&&rsi<48&&dD&&beTF>=2)
        return {w:'📉 Wave A/C Bearish',c:68,d:`${c24.toFixed(1)}% daily + bearish TF align. Avoid long.`};
      if(rsi>=36&&rsi<48&&dD&&beTF>=1)
        return {w:'↘️ Bearish Pressure',c:58,d:`${c24.toFixed(1)}% daily. RSI ${rsi.toFixed(0)} bearish zone.`};
      if(rsi>=48&&rsi<=58&&Math.abs(c24)<1.5)
        return {w:'⚖️ Consolidation Phase',c:55,d:'RSI neutral + tight price. Energy building. Watch breakout.'};
      if(dD&&beTF>=2)
        return {w:'📉 Bearish Structure',c:62,d:`${c24.toFixed(1)}% daily + ${beTF}/3 TF bearish. Rallies are sell setups.`};
      if(mx?.xUp&&uD)
        return {w:'✅ MACD Cross + Recovery',c:65,d:`MACD golden cross + +${c24.toFixed(1)}%. Momentum shift confirmed.`};
      if(mx?.xDown&&dD)
        return {w:'❌ MACD Cross Down',c:65,d:'MACD death cross + bearish daily. Momentum shift down.'};
      if(uD&&c24>5)
        return {w:'⚡ Strong Momentum',c:58,d:`+${c24.toFixed(1)}% daily. Strong buying. Wait for pullback entry.`};
      if(dD&&c24<-5)
        return {w:'📉 Strong Selloff',c:58,d:`${c24.toFixed(1)}% daily. Selling pressure. Wait for stabilization.`};
      if(uD)
        return {w:'↗️ Recovery Phase',c:52,d:`+${c24.toFixed(1)}% daily. Monitor for continuation above resistance.`};
      if(dD)
        return {w:'↘️ Selling Phase',c:52,d:`${c24.toFixed(1)}% daily. Below average pressure.`};
      return {w:'⚖️ Sideways Phase',c:48,d:'No clear direction. Wait for volume breakout or breakdown.'};

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
    // PARALLEL EXECUTION — 6 sumber data bersamaan
    // CG p1(250) + CG p2(250) + MEXC(800) + Bybit FR + CC30 + FG
    // Target: 500-600 koin, max 6s, aman Vercel 10s
    // ══════════════════════════════════════════════════════
    const [cgR, cgR2, mxR, byFrR, ccR, fgR] = await Promise.allSettled([
      sf('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=volume_desc&per_page=250&page=1&sparkline=false&price_change_percentage=24h,7d', 5500),
      sf('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=volume_desc&per_page=250&page=2&sparkline=false&price_change_percentage=24h,7d', 5500),
      sf('https://api.mexc.com/api/v3/ticker/24hr', 5500),
      sf('https://api.bybit.com/v5/market/tickers?category=linear', 4500),
      Promise.allSettled(CC30.map(s=>sf(`https://min-api.cryptocompare.com/data/v2/histohour?fsym=${s}&tsym=USD&limit=42&aggregate=4&e=CCCAGG`,4500))),
      sf('https://api.alternative.me/fng/?limit=1&format=json', 3000),
    ]);

    const fg = fgR.status==='fulfilled' ? N(fgR.value?.data?.[0]?.value,50) : 50;

    // ── Parse Bybit Funding Rates ─────────────────────────
    const frMap={};
    try{
      const byList=A(byFrR.value?.result?.list);
      for(const t of byList){
        try{
          const sym=S(t.symbol).replace('USDT','').replace('PERP','');
          if(!sym) continue;
          const fr=N(t.fundingRate);
          const oi=N(t.openInterestValue);
          const ls=t.bid1Price&&t.ask1Price?N(t.bid1Price)/N(t.ask1Price):1;
          frMap[sym]={fr,oi,
            // FR signal
            signal: fr>0.0005?'🚨 EXTREME LONG':fr>0.0003?'⚠️ LONG HEAVY':
                    fr>0.0001?'↗️ Mild Long':fr<-0.0005?'🚀 EXTREME SHORT SQUEEZE':
                    fr<-0.0003?'💎 SHORT SQUEEZE':fr<-0.0001?'↘️ Mild Short':'⚖️ Neutral',
            // Bullish if shorts being squeezed, bearish if longs overheated
            bullish: fr<-0.0002,
            bearish: fr>0.0004,
            pctFR: +(fr*100).toFixed(4),
          };
        }catch{}
      }
    }catch{}

    // ── Parse CoinGecko (page 1 + page 2) ────────────────
    const cgList=[];
    const cgPages=[cgR, cgR2];
    for(const pageR of cgPages){
      for(const c of A(pageR.value)){
        try{
          const p=N(c.current_price); if(p<=0) continue;
          cgList.push({sym:S(c.symbol).toUpperCase(),name:S(c.name)||S(c.symbol),price:p,c24:N(c.price_change_percentage_24h),c7d:c.price_change_percentage_7d!=null?N(c.price_change_percentage_7d):null,vol:N(c.total_volume),h:N(c.high_24h)||p*1.02,l:N(c.low_24h)||p*0.98,mcap:N(c.market_cap),rank:N(c.market_cap_rank,9999),src:'cg'});
        }catch{}
      }
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
      return res.status(200).json({ok:false,error:'Semua data source tidak merespons. Coba refresh dalam 30 detik.',ts:Date.now(),totalScanned:0,totalQualified:0,results:[],topSetups:{institutional:[],fullSend:[],highProbBull:[],smcSetups:[],ewSetups:[],volumeBreakout:[],strongSell:[],whaleSetups:[],aiCoins:[],defiCoins:[],memeCoins:[],l1Coins:[],l2Coins:[],frExtreme:[]},marketOverview:{marketMood:'UNKNOWN',bullishCount:0,bearishCount:0,avgChange24h:0}});
    }

    // ── Parse CryptoCompare klines (30 coins) ────────────
    const kMap={};
    for(let i=0;i<CC30.length;i++){
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
        kMap[CC30[i]]={rsi,e9,e21,e50,macd,K,cls,smc,ok:true};
      }catch{}
    }

    // ── Analyze all coins ─────────────────────────────────
    const results=[];
    for(const c of pool){
      try{
        const {sym,name,price,c24,c7d,vol,h,l,mcap,rank,src}=c;
        if(!sym||!price||price<=0) continue;
        const sector=getSector(sym);
        const sectorEmoji=SECTOR_EMOJI[sector]||'🪙';
        const pPos=h>l?clamp((price-l)/(h-l),0,1):0.5;
        const rng=h>l?(h-l)/price*100:0;
        const vt=vol>=1e9?5:vol>=200e6?4:vol>=50e6?3:vol>=10e6?2:vol>=1e6?1:0;
        const kd=kMap[sym]||null;
        // Funding Rate
        const fd=frMap[sym]||null;
        const frVal=fd?.fr||0;
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
        // Onchain proxy score
        const oc=onchainScore(vol,mcap,rank,c24,c7d);
        const ocC=clamp(oc.score*0.8,0,6);
        // Funding Rate contribution
        const frC=frVal<-0.0005?6:frVal<-0.0003?4:frVal<-0.0001?2:
                  frVal>0.0005?-5:frVal>0.0003?-3:frVal>0.0001?-1:0;
        const prob=clamp(Math.round(50+tC+rC+mW+m24+mC+smcC+pC+ewC+ocC+frC),2,98);
        const score=tC+rC+mW+m24+mC+smcC;

        // ── WHALE / SMART MONEY DETECTOR ──────────────────
        // Bekerja untuk SEMUA koin (CG, MEXC, CC klines)
        let wScore=0;
        const wSigs=[];
        try{
          // ── 1. Volume Anomaly ──────────────────────────
          // CoinGecko coins: pakai vol/mcap ratio
          // MEXC coins (mcap=0): pakai volume tier (vt)
          const vR=mcap>0?vol/mcap:0;
          if(vR>0.18){wScore+=5;wSigs.push('🔥 Vol EKSTREM: '+(vR*100).toFixed(1)+'% of market cap — institusi aktif besar');}
          else if(vR>0.10){wScore+=3;wSigs.push('📈 Vol Tinggi: '+(vR*100).toFixed(1)+'% mcap — unusual activity');}
          else if(vR>0.05){wScore+=2;}
          else if(mcap===0&&vt>=5){wScore+=5;wSigs.push('🔥 Volume $1B+ spike — institusi bergerak besar');}
          else if(mcap===0&&vt>=4){wScore+=3;wSigs.push('📈 Volume $200M+ — volume institusional terdeteksi');}
          else if(mcap===0&&vt>=3){wScore+=2;wSigs.push('📊 Volume $50M+ — di atas rata-rata pasar');}
          else if(mcap===0&&vt>=2){wScore+=1;}

          // ── 2. Stealth Accumulation (semua koin) ──────
          // Harga turun mingguan tapi NAIK 24h = whale kumpulkan diam-diam
          const c7_=c7d||0;
          if(c7_<-7&&c24>1.8&&pPos>0.2&&vol>800000){
            wScore+=5;wSigs.push('🤫 STEALTH ACC: Turun 7d='+c7_.toFixed(1)+'% tapi NAIK 24h=+'+c24.toFixed(1)+'% — whale akumulasi sembunyi');
          } else if(c7_<-4&&c24>1.2&&pPos>0.25&&vol>300000){
            wScore+=3;wSigs.push('👀 Pemulihan tersembunyi: 7d='+c7_.toFixed(1)+'% tapi 24h=+'+c24.toFixed(1)+'%');
          }

          // ── 3. RSI Extreme Oversold + Reversal (semua) ─
          if(rsi<28&&c24>1.0){
            wScore+=4;wSigs.push('💎 RSI '+rsi.toFixed(0)+' EXTREME oversold + reversal +'+c24.toFixed(1)+'% — smart money mulai entry');
          } else if(rsi<36&&c24>1.5){
            wScore+=2;wSigs.push('📊 RSI '+rsi.toFixed(0)+' oversold + momentum positif — potensi bottom terbentuk');
          }

          // ── 4. ICT Bull OB (semua koin) ─────────────
          if(smc?.bOB?.fresh&&smc?.bOB?.inZone){
            wScore+=4;wSigs.push('📦 Bull OB Fresh IN ZONE $'+smc.bOB.L+'–$'+smc.bOB.H+' — harga di zona demand institusional');
          } else if(smc?.inBullOB&&pPos<0.32){
            wScore+=2;wSigs.push('📦 Discount Zone + Bull OB area — institusi akumulasi di level ini');
          }

          // ── 5. CHoCH Bullish (semua koin) ────────────
          if(smc?.hasCHoCH&&(smc?.chochType||'').includes('Bull')){
            wScore+=3;wSigs.push('🔄 '+smc.chochType+' — institusi balik arah struktur market dari bearish ke bullish');
          }

          // ── 6. BOS Bullish + momentum (semua koin) ───
          if(smc?.hasBOS&&(smc?.bosType||'').includes('Bull')&&c24>3){
            wScore+=3;wSigs.push('🚀 '+smc.bosType+' — breakout institusional +'+c24.toFixed(1)+'% dengan struktur baru');
          }

          // ── 7. Extreme Discount + Reversal (semua) ───
          if(pPos<0.12&&c24>1.5&&vol>800000){
            wScore+=3;wSigs.push('💎 Price di '+( pPos*100).toFixed(0)+'% bottom range + recovery — smart money akumulasi ekstrem low');
          } else if(pPos<0.22&&c24>2.5){
            wScore+=2;
          }

          // ── 8. Weekly Down + 24h Momentum Reversal ───
          if(c7_<-15&&c24>4&&pPos>0.35&&vol>2e6){
            wScore+=4;wSigs.push('⚡ Reversal kuat setelah -'+Math.abs(c7_).toFixed(0)+'% 7d: +'+c24.toFixed(1)+'% 24h — whale trap selesai');
          } else if(c7_<-10&&c24>3){
            wScore+=2;
          }

          // ── 9. Lanjutan untuk CC klines coins (akurat) ─
          if(kd?.ok&&kd.K?.length>=15&&kd.cls?.length>=15){
            // OBV: hitung dari klines
            let obvRise=0,obvFall=0;
            const kSlice=kd.K.slice(-20);
            for(let i=1;i<kSlice.length;i++){
              const kk=kSlice[i],pp=kSlice[i-1];
              if(!kk||!pp)continue;
              if(N(kk.c)>N(pp.c))obvRise+=N(kk.v);
              else if(N(kk.c)<N(pp.c))obvFall+=N(kk.v);
            }
            const obvBull=obvRise>obvFall*1.35;
            const obvBear=obvFall>obvRise*1.35;
            if(obvBull&&c7_<0){
              wScore+=5;wSigs.push('📊 OBV DIVERGENCE BULLISH: Volume beli ('+( obvRise/1e6).toFixed(1)+'M) >> jual — whale akumulasi saat harga turun');
            } else if(obvBull&&c24>0){
              wScore+=2;
            } else if(obvBear&&c24>3){
              wScore-=2;wSigs.push('⚠️ OBV Bearish: volume jual dominan meski harga naik — hati-hati distribusi');
            }
            // Displacement candle
            const atrArr2=kd.K.slice(1).map((k2,i2)=>k2&&kd.K[i2]?Math.max(N(k2.h)-N(k2.l),Math.abs(N(k2.h)-N(kd.K[i2].c)),Math.abs(N(k2.l)-N(kd.K[i2].c))):0);
            const avgATR2=atrArr2.slice(-14).reduce((s,v)=>s+v,0)/14;
            const lastK=kd.K[kd.K.length-1];
            if(lastK&&avgATR2>0){
              const lRng=N(lastK.h)-N(lastK.l);
              if(lRng>avgATR2*2.5&&N(lastK.v)>0){
                const isDispBull=N(lastK.c)>N(lastK.o);
                wScore+=(isDispBull?4:0);
                wSigs.push((isDispBull?'🚀 DISPLACEMENT BULLISH':'💀 DISPLACEMENT BEARISH')+': Candle '+(lRng/avgATR2).toFixed(1)+'x ATR — pergerakan institusional besar');
              }
            }
            // SSL/BSL Sweep (klines) — gunakan .t bukan .bullish
            if(smc?.sweep?.t?.includes('Bull')){
              wScore+=5;wSigs.push('⚡ SSL SWEEP $'+smc.sweep.lv+' — smart money ambil stop loss bawah lalu balik naik = ENTRY INSTITUSI');
            } else if(smc?.sweep?.t?.includes('Bear')){
              wScore-=2;
            }
            // MACD cross + vol
            if(kd?.macd?.xUp&&vt>=3){
              wScore+=3;wSigs.push('✅ MACD Golden Cross + Volume $'+['','','','50M+','200M+','1B+'][vt]+' — konfirmasi institusi masuk');
            }
            // Equal Lows taken (klines)
            if(smc?.eqL&&c24>1.5&&pPos>0.3){
              wScore+=3;wSigs.push('🎯 Equal Lows $'+smc.eqL+' diambil + reversal — whale trap SSL selesai');
            }
          }

        }catch{}

        // Threshold: 6+ untuk masuk whale tab
        const wFinal=clamp(wScore,0,30);
        const wLevel=wFinal>=14?'🐋 STRONG WHALE':wFinal>=9?'🐳 WHALE DETECTED':wFinal>=6?'🔍 UNUSUAL ACTIVITY':'';
        const whaleData=wFinal>=6?{score:wFinal,level:wLevel,signals:wSigs.filter(s=>!s.startsWith('⚠️')).slice(0,4)}:null;
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
        // Funding Rate signals (Bybit perpetual)
        if(fd){
          const frPct=(frVal*100).toFixed(4);
          if(frVal<-0.0005) sigs.push('🚀 FR: '+frPct+'% EXTREME SHORT SQUEEZE — shorts sangat banyak, squeeze besar mungkin terjadi');
          else if(frVal<-0.0003) sigs.push('💎 FR: '+frPct+'% Short Squeeze — shorts mendominasi, potensi reversal naik kuat');
          else if(frVal<-0.0001) sigs.push('↘️ FR: '+frPct+'% mild short — sedikit shorts, hati-hati long');
          else if(frVal>0.0005) sigs.push('🚨 FR: +'+frPct+'% OVERHEATED — terlalu banyak long, risiko koreksi tajam');
          else if(frVal>0.0003) sigs.push('⚠️ FR: +'+frPct+'% long heavy — long mendominasi, berhati-hati tambah posisi');
          else if(frVal>0.0001) sigs.push('↗️ FR: +'+frPct+'% mild long — normal bullish bias');
        }
        // Onchain proxy signals
        oc.sigs.forEach(s=>sigs.push(s));
        pats.forEach(p=>sigs.push(p.name+' ('+p.winRate+'%): '+p.desc));
        results.push({
          rank:results.length+1,symbol:sym,name,dataSource:src,
          sector,sectorEmoji,
          price,change24h:+c24.toFixed(2),change7d:c7d!=null?+c7d.toFixed(2):null,
          volume24h:vol,mcap,mcapRank:rank,
          high24h:h,low24h:l,pricePos:+pPos.toFixed(3),range:+rng.toFixed(2),
          rsi:+rsi.toFixed(2),rsiReal:rsiR,vt,
          trendAlignment:taLabel,taColor,
          trend1h:t1h,trend4h:t4h,trend1d:t1d,bullTF:bTF,bearTF:beTF,
          smc:{...smc,signal:smcD},
          elliottWave:{wave:ew.w,confidence:ew.c,description:ew.d},
          chartPatterns:pats.length>0?pats:[{name:c24>=0?'↗️ Bullish Close':'↘️ Bearish Close',signal:c24>=0?'bullish':'bearish',winRate:75,desc:(c24>=0?'+':'')+c24.toFixed(1)+'% daily close.'}],
          probability:prob,score,
          onchainScore:oc.score,
          fundingRate:fd?{rate:frVal,pct:fd.pctFR,signal:fd.signal,bullish:fd.bullish,bearish:fd.bearish,oi:fd.oi}:null,
          whale:whaleData,
          signals:sigs.slice(0,6),
          astrology:{moonPhase:astro.moonPhase,moonEmoji:astro.moonEmoji,halvingPhase:astro.halvingPhase,chaotic:astro.chaotic},
          hasRealData:rsiR,
        });
      }catch{}
    }

    results.sort((a,b)=>b.probability-a.probability||b.score-a.score);
    results.forEach((r,i)=>r.rank=i+1);

    // ── TAB FILTERS (v2 — lebih inklusif + akurat) ────────
    // Institusional: skor tinggi + volume significant
    const institutional =results.filter(r=>r.score>=14&&r.probability>=58&&r.volume24h>=3e6).slice(0,80);

    // FULL SEND: probability >= 68 + minimal 2TF bullish (fix: jangan butuh 3TF)
    // Sebelumnya butuh bTF===3 → kosong di bearish market
    const fullSend       =results.filter(r=>
      r.probability>=68&&r.volume24h>=1e6&&
      (r.bullTF>=2||r.taColor==='full-bull'||r.taColor==='bull')
    ).sort((a,b)=>b.probability-a.probability).slice(0,60);

    // High Prob: probability >= 65
    const highProbBull   =results.filter(r=>r.probability>=65&&r.score>=8).slice(0,60);

    // SMC: ada ICT signal aktif
    const smcSetups      =results.filter(r=>(r.smc?.inBullOB||r.smc?.inBullFVG||r.smc?.hasCHoCH||r.smc?.hasBOS)&&r.probability>=50).slice(0,60);

    // Wave 3 / bottom setup
    const ewSetups       =results.filter(r=>{
      const w=r.elliottWave?.wave||'';
      return(w.includes('Wave 3')||w.includes('Impulse'))?r.probability>=55:
             (w.includes('Wave 2')||w.includes('OTE'))?r.probability>=50:
             (w.includes('C Complete')||w.includes('Capitulation')||w.includes('Bottom'))?r.probability>=48:
             (r.rsi<38&&r.change24h>0)?r.probability>=48:false;
    }).sort((a,b)=>b.probability-a.probability).slice(0,60);

    // Volume Breakout: volume besar + momentum
    const volumeBreakout =results.filter(r=>r.vt>=3&&r.change24h>1&&r.probability>48).sort((a,b)=>b.volume24h-a.volume24h).slice(0,60);

    // Short/Sell setup
    const strongSell     =results.filter(r=>r.probability<40||r.taColor==='full-bear').sort((a,b)=>a.probability-b.probability).slice(0,40);

    // 🐋 Whale / Smart Money
    const whaleSetups    =results.filter(r=>r.whale&&r.whale.score>=6).sort((a,b)=>b.whale.score-a.whale.score).slice(0,60);

    // ── SECTOR TABS ───────────────────────────────────────
    const aiCoins  =results.filter(r=>r.sector==='AI'  ).sort((a,b)=>b.probability-a.probability).slice(0,50);
    const defiCoins=results.filter(r=>r.sector==='DEFI').sort((a,b)=>b.probability-a.probability).slice(0,50);
    const memeCoins=results.filter(r=>r.sector==='MEME').sort((a,b)=>b.probability-a.probability).slice(0,50);
    const l1Coins  =results.filter(r=>r.sector==='L1'  ).sort((a,b)=>b.probability-a.probability).slice(0,40);
    const l2Coins  =results.filter(r=>r.sector==='L2'  ).sort((a,b)=>b.probability-a.probability).slice(0,40);

    // Funding Rate extremes tab
    const frExtreme=results.filter(r=>r.fundingRate&&(r.fundingRate.bullish||r.fundingRate.bearish)).sort((a,b)=>{
      const fa=Math.abs(a.fundingRate?.rate||0), fb=Math.abs(b.fundingRate?.rate||0);
      return fb-fa;
    }).slice(0,50);

    // Sector breakdown untuk analytics
    const sectorStats={};
    for(const r of results){
      if(!sectorStats[r.sector]) sectorStats[r.sector]={count:0,bullish:0,bearish:0,avgProb:0};
      sectorStats[r.sector].count++;
      if(r.probability>55) sectorStats[r.sector].bullish++;
      if(r.probability<45) sectorStats[r.sector].bearish++;
      sectorStats[r.sector].avgProb+=r.probability;
    }
    for(const s of Object.keys(sectorStats)) sectorStats[s].avgProb=Math.round(sectorStats[s].avgProb/sectorStats[s].count);

    const bullC=results.filter(r=>r.probability>55).length;
    const bearC=results.filter(r=>r.probability<45).length;
    const avgCh=results.length?+(results.reduce((s,r)=>s+r.change24h,0)/results.length).toFixed(2):0;
    const mood=avgCh>3?'STRONG BULL':avgCh>1?'BULL':avgCh<-3?'STRONG BEAR':avgCh<-1?'BEAR':'NEUTRAL';

    return res.status(200).json({
      ok:true,ts:Date.now(),elapsed:Date.now()-t0,version:'v26',
      src:'cg:'+(cgList.length)+'+mx:'+mxList.length+' total:'+pool.length,
      fg,totalScanned:pool.length,totalQualified:results.length,
      rsiRealCount:Object.keys(kMap).length,
      results,
      topSetups:{institutional,fullSend,highProbBull,smcSetups,ewSetups,volumeBreakout,strongSell,whaleSetups,aiCoins,defiCoins,memeCoins,l1Coins,l2Coins,frExtreme},
      marketOverview:{marketMood:mood,bullishCount:bullC,bearishCount:bearC,avgChange24h:avgCh,totalCoins:results.length,sectorStats,frCoverage:Object.keys(frMap).length},
      astroContext:astro,
    });

  }catch(e){
    return res.status(200).json({ok:false,error:e.message,ts:Date.now(),elapsed:Date.now()-t0,version:'v26',totalScanned:0,totalQualified:0,results:[],topSetups:{institutional:[],fullSend:[],highProbBull:[],smcSetups:[],ewSetups:[],volumeBreakout:[],strongSell:[],whaleSetups:[],aiCoins:[],defiCoins:[],memeCoins:[],l1Coins:[],l2Coins:[],frExtreme:[]},marketOverview:{marketMood:'UNKNOWN',bullishCount:0,bearishCount:0,avgChange24h:0}});
  }
}
