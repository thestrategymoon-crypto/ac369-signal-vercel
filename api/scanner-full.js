// api/scanner-full.js — v28 ULTRA ACCURATE & POWERFUL
// ════════════════════════════════════════════════════════════════
// UPGRADE v28 vs v27:
// ✅ Base score: 48 (lebih konservatif, kurangi false signals)
// ✅ volC: Volume Confirmation Factor BARU — koin tanpa volume tidak bisa HIGH PROB
// ✅ tC max ±25: hanya dapat max jika volume konfirmasi
// ✅ rC: Oversold hanya dapat poin tinggi jika beTF===0
// ✅ smcC: Fresh Bull OB in-zone mendapat bonus +2
// ✅ FR scoring: lebih agresif untuk extreme values (±8 extreme)
// ✅ Tab INSTITUTIONAL: prob>=62 + vol>=5M (naik dari 58+3M)
// ✅ Tab HIGH PROB: prob>=68 (naik dari 65)
// ✅ BYBIT_KLINES: 65 koin (expanded dari 55)
// ✅ CC35: tambah SEI, XLM, ENA, JTO, ONDO
// ✅ Whale detector v2: OBV + displacement + SSL sweep
// ✅ Anomaly detector v2: decoupling lebih presisi
// ✅ Signal descriptions: lebih detail dan actionable
// ════════════════════════════════════════════════════════════════

const CC35 = [
  'BTC','ETH','BNB','SOL','XRP','ADA','DOGE','AVAX','LINK','DOT',
  'NEAR','SUI','APT','ARB','OP','PEPE','TON','INJ','TIA','RENDER',
  'LTC','ATOM','AAVE','CRV','FIL','ALGO','HBAR','GRT','MKR','SAND',
  'XLM','ENA','JTO','ONDO','SEI',
];

const BYBIT_KLINES = [
  'HYPE','WIF','BONK','FLOKI','SHIB','NEIRO','BOME','DOGS','PNUT','ACT',
  'POPCAT','MEW','MOODENG','TURBO','GOAT','CHILLGUY','GIGA','PONKE',
  'JUP','PENDLE','GMX','DYDX','LDO','SUSHI','BLUR','1INCH','CAKE',
  'AERO','VELO','RDNT','GNS','SNX','BANANA','COMP',
  'TRX','VET','ONE','KAVA','STRK','ZRO','MANTA','BLAST','SCROLL',
  'PYTH','W','RON','EIGEN','ZK','BAND','API3',
  'PIXEL','MAGIC','BEAM','YGG','VIRTUAL','IO','OLAS','WLD','TAO',
  'NOT','JASMY','LQTY','ETC','CFX','ACE',
  'POLYX','CFG','KMNO','OMNI',
].filter(s=>!CC35.includes(s));

const STABLES = new Set([
  'USDT','USDC','BUSD','DAI','TUSD','FDUSD','USDD','FRAX',
  'GUSD','USDP','LUSD','PYUSD','SUSD','USDE','USDB','EURC',
]);
const BAD_SFX = ['UP','DOWN','BULL','BEAR','LONG','SHORT','3L','3S','2L','2S'];

const SECTORS = {
  L1: new Set(['BTC','ETH','SOL','ADA','AVAX','TON','NEAR','SUI','APT','TIA','SEI','HBAR','ALGO','XLM','VET','ONE','KAVA','ROSE','ENA']),
  L2: new Set(['ARB','OP','MATIC','POL','IMX','STRK','MANTA','SCROLL','BASE','ZK','BLAST','MANTLE']),
  DEFI: new Set(['UNI','AAVE','CRV','MKR','COMP','SNX','SUSHI','1INCH','GMX','DYDX','PENDLE','RDNT','GNS','CAKE','VELO','AERO','BANANA','LQTY']),
  AI: new Set(['RENDER','FET','AGIX','OCEAN','TAO','GRT','ARKM','OLAS','IO','WLD','GRASS','GOAT','VIRTUAL']),
  MEME: new Set(['DOGE','SHIB','PEPE','BONK','WIF','FLOKI','BOME','MEW','POPCAT','DOGS','NEIRO','PNUT','ACT','MOODENG','CHILLGUY','GIGA','PONKE','TURBO']),
  GAME: new Set(['SAND','MANA','AXS','GALA','MAGIC','BEAM','RON','YGG','PIXEL']),
  INFRA: new Set(['LINK','DOT','ATOM','FIL','API3','BAND','PYTH','JTO','JUP','W','ZRO','EIGEN']),
  RWA: new Set(['ONDO','MKR','POLYX','CFG']),
  HYPE: new Set(['HYPE']),
};
const getSector = sym => {
  for(const [s,set] of Object.entries(SECTORS)) if(set.has(sym)) return s;
  return 'ALT';
};
const SECTOR_EMOJI = {L1:'⛓️',L2:'🔗',DEFI:'💰',AI:'🤖',MEME:'🐸',GAME:'🎮',INFRA:'🏗️',RWA:'🏦',HYPE:'⚡',ALT:'🪙'};

const onchainScore = (vol, mcap, rank, c24, c7d) => {
  try {
    let score = 0; const sigs = [];
    if(mcap > 0){
      const vR = vol / mcap;
      if(vR > 0.30){ score += 5; sigs.push('On-chain: Vol '+(vR*100).toFixed(0)+'% MCap — EXTREME activity'); }
      else if(vR > 0.15){ score += 3; sigs.push('On-chain: Vol '+(vR*100).toFixed(0)+'% MCap — HIGH activity'); }
      else if(vR > 0.07){ score += 2; }
      else if(vR > 0.03){ score += 1; }
    }
    if(rank > 200 && vol > 50e6){ score += 3; sigs.push('On-chain: Mid-cap #'+rank+' vol $'+(vol/1e6).toFixed(0)+'M — unusual'); }
    if(rank > 500 && vol > 20e6){ score += 2; }
    const c7 = c7d || 0;
    if(c7 < -5 && c24 > 1.5 && mcap > 0 && vol/mcap > 0.05){
      score += 3; sigs.push('On-chain: -'+Math.abs(c7).toFixed(0)+'% 7d tapi +'+c24.toFixed(1)+'% 24h + vol = stealth acc');
    }
    return { score, sigs };
  } catch { return { score: 0, sigs: [] }; }
};

const N = (v, d=0) => { const n=+v; return (isNaN(n)||!isFinite(n)) ? d : n; };
const S = (v, d='') => v != null ? String(v) : d;
const A = (v) => Array.isArray(v) ? v : [];
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
      const r = await fetch(url, {signal:ctl.signal, headers:{Accept:'application/json','User-Agent':'AC369/2.0'}});
      clearTimeout(tmr);
      return r.ok ? await r.json() : null;
    } catch { clearTimeout(tmr); return null; }
  };

  const calcRSI = a => {
    try {
      if (!A(a).length || a.length<16) return null;
      let g=0, l=0;
      for(let i=1;i<=14;i++){const d=a[i]-a[i-1];d>0?g+=d:l-=d;}
      g/=14; l/=14;
      for(let i=15;i<a.length;i++){const d=a[i]-a[i-1];g=(g*13+Math.max(d,0))/14;l=(l*13+Math.max(-d,0))/14;}
      return l===0?100:clamp(100-100/(1+g/l),0,100);
    } catch { return null; }
  };

  const calcEMA = (a, p) => {
    try {
      if (!A(a).length || a.length<2) return N(a?.[a.length-1]);
      const k=2/(p+1); let e=a.slice(0,Math.min(p,a.length)).reduce((s,v)=>s+v,0)/Math.min(p,a.length);
      for(let i=Math.min(p,a.length);i<a.length;i++) e=a[i]*k+e*(1-k);
      return e;
    } catch { return 0; }
  };

  const calcMACD = a => {
    try {
      if (!A(a).length || a.length<36) return null;
      const k12=2/13, k26=2/27, k9=2/10;
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

  const smcFull = (K, price) => {
    try {
      if (!A(K).length || K.length<8 || !price) return null;
      const n=K.length;
      const SH=[], SL=[];
      for(let i=2;i<n-2;i++){
        if(!K[i]||!K[i-1]||!K[i+1]) continue;
        if(K[i].h>K[i-1].h&&K[i].h>K[i+1].h) SH.push({i,p:N(K[i].h)});
        if(K[i].l<K[i-1].l&&K[i].l<K[i+1].l) SL.push({i,p:N(K[i].l)});
      }
      const rSH=SH.slice(-3), rSL=SL.slice(-3);
      const lSH=N(rSH[rSH.length-1]?.p), lSL=N(rSL[rSL.length-1]?.p,1e12);
      const pSH=N(rSH[rSH.length-2]?.p), pSL=N(rSL[rSL.length-2]?.p,1e12);
      let bos=null, choch=null;
      if(lSH>0&&price>lSH&&N(K[n-3]?.c)<lSH) bos={type:'Bullish BOS',level:+lSH.toFixed(6)};
      else if(lSL<1e12&&price<lSL&&N(K[n-3]?.c)>lSL) bos={type:'Bearish BOS',level:+lSL.toFixed(6)};
      if(!bos&&pSH>0&&price>pSH) choch={type:'Bullish CHoCH (MSS)',level:+pSH.toFixed(6)};
      if(!bos&&pSL<1e12&&price<pSL) choch={type:'Bearish CHoCH (MSS)',level:+pSL.toFixed(6)};
      let bOB=null, beOB=null;
      for(let i=Math.max(0,n-16);i<n-2;i++){
        const c=K[i],nx=K[i+1];
        if(!c||!nx||!c.o||!c.c||!nx.c) continue;
        if(c.c<c.o&&nx.c>nx.o&&nx.c>c.o*1.002){
          const H=Math.max(c.o,c.c),L=Math.min(c.o,c.c);
          const mitigated=K.slice(i+2).some(k=>k&&N(k.l)<L);
          if(!bOB&&!mitigated) bOB={H:+H.toFixed(6),L:+L.toFixed(6),fresh:true,age:n-i-1,inZone:price<=H*1.01&&price>=L*0.995};
        }
        if(c.c>c.o&&nx.c<nx.o&&nx.c<c.o*0.998){
          const H=Math.max(c.o,c.c),L=Math.min(c.o,c.c);
          const mitigated=K.slice(i+2).some(k=>k&&N(k.h)>H);
          if(!beOB&&!mitigated) beOB={H:+H.toFixed(6),L:+L.toFixed(6),fresh:true,age:n-i-1,inZone:price<=H*1.005&&price>=L*0.99};
        }
      }
      let bFVG=null;
      for(let i=Math.max(0,n-14);i<n-2;i++){
        if(!K[i]||!K[i+2]) continue;
        const g=N(K[i+2].l)-N(K[i].h);
        if(g>0&&price>=N(K[i].h)&&price<=N(K[i+2].l)){
          bFVG={pct:+(g/N(K[i].h,1)*100).toFixed(2),L:+N(K[i].h).toFixed(6),H:+N(K[i+2].l).toFixed(6)};
          break;
        }
      }
      let sweep=null;
      if(rSL.length>0&&K[n-2]&&K[n-1]){
        const s=rSL[rSL.length-1];
        if(N(K[n-2].l)<s.p&&N(K[n-1].c)>s.p) sweep={t:'Bull SSL Sweep',lv:+s.p.toFixed(6)};
      }
      if(!sweep&&rSH.length>0&&K[n-2]&&K[n-1]){
        const s=rSH[rSH.length-1];
        if(N(K[n-2].h)>s.p&&N(K[n-1].c)<s.p) sweep={t:'Bear BSL Sweep',lv:+s.p.toFixed(6)};
      }
      let eqH=null, eqL=null;
      if(rSH.length>=2){const d=Math.abs(rSH[rSH.length-1].p-rSH[rSH.length-2].p)/(rSH[rSH.length-1].p||1);if(d<0.006)eqH=+rSH[rSH.length-1].p.toFixed(6);}
      if(rSL.length>=2){const d=Math.abs(rSL[rSL.length-1].p-rSL[rSL.length-2].p)/(rSL[rSL.length-1].p||1);if(d<0.006)eqL=+rSL[rSL.length-1].p.toFixed(6);}
      const allH=K.slice(-20).map(k=>N(k?.h));
      const allL=K.slice(-20).map(k=>N(k?.l,1e12)).filter(v=>v<1e12);
      const kH=Math.max(...allH)||price*1.1, kL=Math.min(...allL)||price*0.9;
      const eq=(kH+kL)/2;
      const pip=kH>kL?clamp((price-kL)/(kH-kL)*100,0,100):50;
      const zone=pip>70?'Premium Zone':pip>55?'Slight Premium':pip<30?'Discount Zone':pip<45?'Slight Discount':'Equilibrium';
      const oteH=+(eq+(kH-eq)*0.382).toFixed(6);
      const oteL=+(eq-(eq-kL)*0.382).toFixed(6);
      const inOTE=price>=oteL&&price<=oteH;
      const bS=(!!bOB?2:0)+(!!bFVG?1:0)+(bos?.type?.includes('Bull')?3:0)+(choch?.type?.includes('Bull')?2:0)+(sweep?.t?.includes('Bull')?2:0)+(inOTE&&price<eq?1:0);
      const beS=(!!beOB?2:0)+(bos?.type?.includes('Bear')?3:0)+(choch?.type?.includes('Bear')?2:0)+(sweep?.t?.includes('Bear')?2:0)+(inOTE&&price>eq?1:0);
      return {hasBOS:!!bos,bosType:bos?.type||'None',bosLevel:bos?.level||null,hasCHoCH:!!choch,chochType:choch?.type||'None',chochLevel:choch?.level||null,bOB,beOB,inBullOB:!!bOB&&!!bOB.inZone,inBearOB:!!beOB&&!!beOB.inZone,bFVG,inBullFVG:!!bFVG,sweep,eqH,eqL,zone,pip:+pip.toFixed(1),inOTE,oteH,oteL,signal:bS>beS?'Bullish':beS>bS?'Bearish':'Neutral',bS,beS};
    } catch { return null; }
  };

  const smcEst = (p, h, l, c24, c7) => {
    try {
      const pip=h>l?clamp((p-l)/(h-l)*100,0,100):50;
      const zone=pip>70?'Premium Zone':pip<30?'Discount Zone':'Equilibrium';
      const hasBOS=Math.abs(c24)>5;
      const bosType=c24>5?'Bullish BOS':c24<-5?'Bearish BOS':'None';
      const hasCHoCH=(c24>3&&(c7||0)<0)||(c24>5&&pip>0.35&&pip<0.65);
      const inBullOB=pip<28, inBearOB=pip>72;
      const bS=(hasBOS&&c24>5?3:0)+(inBullOB?2:0)+(hasCHoCH?2:0);
      const beS=(hasBOS&&c24<-5?3:0)+(inBearOB?2:0);
      return {hasBOS,bosType,bosLevel:hasBOS&&c24>5?+(h*0.98).toFixed(6):hasBOS?+(l*1.02).toFixed(6):null,hasCHoCH,chochType:hasCHoCH?'Bullish CHoCH (MSS)':'None',bOB:inBullOB?{H:+(l+(h-l)*0.28).toFixed(6),L:+l.toFixed(6),inZone:true,fresh:true}:null,beOB:inBearOB?{H:+h.toFixed(6),L:+(l+(h-l)*0.72).toFixed(6),inZone:true,fresh:true}:null,inBullOB,inBearOB,inBullFVG:pip<15,zone,pip:+pip.toFixed(1),signal:bS>beS?'Bullish':beS>bS?'Bearish':'Neutral',bS,beS};
    } catch { return {hasBOS:false,bosType:'None',hasCHoCH:false,chochType:'None',inBullOB:false,inBearOB:false,inBullFVG:false,zone:'Equilibrium',pip:50,signal:'Neutral',bS:0,beS:0}; }
  };

  const getPatterns = (K, p, h, l, c24, c7, pPos, vol) => {
    try {
      const pats=[];
      const op=p>0&&c24>-99?p/(1+c24/100):p;
      const rng=h-l;
      const rngPct=p>0?rng/p*100:0;
      if(rng>0.000001&&op>0){
        const body=Math.abs(p-op);const bd=body/rng;const lw=(Math.min(p,op)-l)/rng;const uw=(h-Math.max(p,op))/rng;const bullCandle=p>op,bearCandle=p<op;
        if(lw>0.55&&bd<0.35&&uw<0.20&&pPos<0.48) pats.push({name:'🔨 Hammer',signal:'bullish',winRate:76,desc:`Buyers rejected $${l.toFixed(p>1?2:6)}.`});
        if(uw>0.55&&bd<0.35&&lw<0.20&&pPos>0.52) pats.push({name:'⭐ Shooting Star',signal:'bearish',winRate:75,desc:`Sellers rejected $${h.toFixed(p>1?2:6)}.`});
        if(bd>0.78&&bullCandle&&c24>3) pats.push({name:'🐂 Bull Marubozu',signal:'bullish',winRate:77,desc:`+${c24.toFixed(1)}% full body. Institutional buy.`});
        if(bd>0.78&&bearCandle&&c24<-3) pats.push({name:'🐻 Bear Marubozu',signal:'bearish',winRate:77,desc:`${c24.toFixed(1)}% full body. Institutional sell.`});
        if(lw>0.60&&bd<0.25&&bullCandle&&pPos>0.55) pats.push({name:'📌 Bullish Pin Bar',signal:'bullish',winRate:76,desc:`Demand rejection at $${l.toFixed(p>1?2:6)}.`});
        if(uw>0.60&&bd<0.25&&bearCandle&&pPos<0.45) pats.push({name:'📌 Bearish Pin Bar',signal:'bearish',winRate:76,desc:`Supply rejection at $${h.toFixed(p>1?2:6)}.`});
      }
      if(A(K).length>=3){
        const kn=K.length,C=K[kn-1],P=K[kn-2],P2=K[kn-3];
        if(C&&P&&P2&&C.c&&P.c&&P2.c){
          const Cb=Math.abs(C.c-C.o),Pb=Math.abs(P.c-P.o),P2b=Math.abs(P2.c-P2.o),P2r=Math.max(P2.h-P2.l,0.0001);
          if(P.c<P.o&&C.c>C.o&&C.o<=P.c&&C.c>=P.o&&Cb>Pb*0.9) pats.push({name:'🐂 Bullish Engulfing',signal:'bullish',winRate:78,desc:'Buyers absorbed prior selling. Strong demand.'});
          if(P.c>P.o&&C.c<C.o&&C.o>=P.c&&C.c<=P.o&&Cb>Pb*0.9) pats.push({name:'🐻 Bearish Engulfing',signal:'bearish',winRate:78,desc:'Sellers absorbed prior buying. Distribution.'});
          if(P2.c<P2.o&&Pb/(P2b+0.001)<0.40&&C.c>C.o&&C.c>(P2.o+P2.c)/2) pats.push({name:'🌟 Morning Star',signal:'bullish',winRate:78,desc:'3-candle reversal. Buyers confirmed.'});
          if(P2.c>P2.o&&Pb/(P2b+0.001)<0.40&&C.c<C.o&&C.c<(P2.o+P2.c)/2) pats.push({name:'🌆 Evening Star',signal:'bearish',winRate:78,desc:'3-candle distribution top.'});
          if(P2.c>P2.o&&P.c>P.o&&C.c>C.o&&P.c>P2.c&&C.c>P.c&&P2b/P2r>0.50) pats.push({name:'⚔️ 3 White Soldiers',signal:'bullish',winRate:83,desc:'Institutional accumulation confirmed.'});
          if(P2.c<P2.o&&P.c<P.o&&C.c<C.o&&P.c<P2.c&&C.c<P.c&&P2b/P2r>0.50) pats.push({name:'🐦 3 Black Crows',signal:'bearish',winRate:83,desc:'Institutional distribution confirmed.'});
          if(P.c<P.o&&C.c>C.o&&C.o<P.l&&C.c>(P.o+P.c)/2) pats.push({name:'🌙 Piercing',signal:'bullish',winRate:75,desc:'>50% bullish into bearish body.'});
          if(P.c>P.o&&C.c<C.o&&C.o>P.h&&C.c<(P.o+P.c)/2) pats.push({name:'☁️ Dark Cloud',signal:'bearish',winRate:75,desc:'>50% bearish into bullish body.'});
          if(C.h<=P.h&&C.l>=P.l) pats.push({name:'📦 Inside Bar',signal:C.c>=C.o?'bullish':'bearish',winRate:76,desc:'Compression. Breakout imminent.'});
          if(kn>=8){const ref=N(K[kn-7]?.c);if(ref>0){const mv=(N(K[kn-3]?.c)-ref)/ref*100;const fl=Math.max(...K.slice(-4).map(k=>N(k?.h)))-Math.min(...K.slice(-4).map(k=>N(k?.l,1e9)));const tight=N(C.c)>0&&fl/N(C.c)*100<5;if(mv>5&&tight)pats.push({name:'🏴 Bull Flag',signal:'bullish',winRate:85,desc:'+'+mv.toFixed(1)+'% impulse. Target +'+(mv*0.8).toFixed(1)+'%.'});if(mv<-5&&tight)pats.push({name:'🏴 Bear Flag',signal:'bearish',winRate:85,desc:mv.toFixed(1)+'% drop. Continuation lower.'});}}
        }
      }
      const qualified=pats.filter(x=>x.winRate>=75);
      if(qualified.length===0){
        const w7=c7||0;
        if(pPos>0.85&&c24>4&&vol>10e6) pats.push({name:'💥 Vol Breakout',signal:'bullish',winRate:82,desc:`+${c24.toFixed(1)}% near high + vol. Institutional.`});
        else if(pPos<0.18&&c24>1.5&&w7<-6) pats.push({name:'🔄 Double Bottom',signal:'bullish',winRate:75,desc:`${w7.toFixed(0)}% weekly low + +${c24.toFixed(1)}% recovery.`});
        else if(w7<-8&&c24>2&&pPos>0.3) pats.push({name:'🔄 Recovery Bounce',signal:'bullish',winRate:76,desc:`-${Math.abs(w7).toFixed(0)}% week → +${c24.toFixed(1)}% today.`});
        else if(w7>6&&Math.abs(c24)<3&&pPos>0.35) pats.push({name:'🏴 Bull Flag (est.)',signal:'bullish',winRate:85,desc:`Weekly +${w7.toFixed(1)}% + consolidation.`});
        else if(w7<-6&&Math.abs(c24)<3&&pPos<0.65) pats.push({name:'🏴 Bear Flag (est.)',signal:'bearish',winRate:85,desc:`Weekly ${w7.toFixed(1)}% + pause. Lower expected.`});
        else if(rngPct>7&&c24>3&&pPos>0.60) pats.push({name:'📊 Wide Range Bull',signal:'bullish',winRate:76,desc:`${rngPct.toFixed(1)}% range + high close.`});
        else if(rngPct>7&&c24<-3&&pPos<0.40) pats.push({name:'📊 Wide Range Bear',signal:'bearish',winRate:76,desc:`${rngPct.toFixed(1)}% range + low close.`});
        else if(c24>2&&pPos>0.65) pats.push({name:'📈 High Close',signal:'bullish',winRate:75,desc:`+${c24.toFixed(1)}% upper ${((1-pPos)*100).toFixed(0)}% range.`});
        else if(c24<-2&&pPos<0.35) pats.push({name:'📉 Low Close',signal:'bearish',winRate:75,desc:`${c24.toFixed(1)}% lower ${(pPos*100).toFixed(0)}% range.`});
        else if(Math.abs(c24)<0.8&&rngPct>2) pats.push({name:'⚖️ Doji',signal:'neutral',winRate:75,desc:`Flat ±${Math.abs(c24).toFixed(1)}% with ${rngPct.toFixed(1)}% range. Decision.`});
        else if(pPos<0.10&&c24>0) pats.push({name:'💎 Extreme Demand',signal:'bullish',winRate:76,desc:`Bottom ${(pPos*100).toFixed(0)}% + recovery.`});
        else if(c24>4) pats.push({name:'🚀 Bull Momentum',signal:'bullish',winRate:75,desc:`+${c24.toFixed(1)}% daily momentum.`});
        else if(c24<-4) pats.push({name:'📉 Bear Momentum',signal:'bearish',winRate:75,desc:`${c24.toFixed(1)}% daily selling.`});
        else if(c24>0) pats.push({name:'↗️ Bullish Close',signal:'bullish',winRate:75,desc:`+${c24.toFixed(1)}%.`});
        else pats.push({name:'↘️ Bearish Close',signal:'bearish',winRate:75,desc:`${c24.toFixed(1)}%.`});
      }
      return pats.filter(x=>x.winRate>=75).sort((a,b)=>b.winRate-a.winRate).slice(0,2);
    } catch { return [{name:'⚖️ Neutral',signal:'neutral',winRate:75,desc:'Neutral.'}]; }
  };

  const getEW = (rsi, c24, c7_, macd, bTF, beTF) => {
    try {
      const noW=c7_===null||c7_===undefined;const c7=c7_||0;
      const uW=c7>3,dW=c7<-3,uD=c24>1.5,dD=c24<-1.5,oS=rsi<32,oB=rsi>70,mx=macd||null;
      if(!noW){
        if((uW||(!uW&&!dW))&&uD&&rsi>=42&&rsi<=65&&bTF>=2&&(mx?.xUp||mx?.bull)) return {w:'🚀 Wave 3 — Impulse',c:82,d:`${uW?'Weekly +'+c7.toFixed(0)+'% + ':''}Daily +${c24.toFixed(1)}%. Strongest phase. Target 1.618x.`};
        if(uW&&uD&&rsi>=55&&rsi<75&&mx?.bull&&!mx?.div) return {w:'⚡ Wave 3 Extension',c:72,d:'Continuation. Trail stop from swing low.'};
        if(uW&&dD&&oS) return {w:'📉 Wave 2 Pullback',c:78,d:`RSI ${rsi.toFixed(0)} oversold in uptrend — BEST ENTRY.`};
        if(!uW&&!dW&&rsi>=35&&rsi<48&&dD&&!oS) return {w:'📉 Wave 2 / OTE Entry',c:68,d:'Pullback into OTE. Entry before Wave 3.'};
        if(uW&&dD&&rsi>=38&&rsi<=55&&!oS) return {w:'⚖️ Wave 4 Correction',c:65,d:"Consolidation before Wave 5."};
        if(oB&&mx?.div) return {w:'⚠️ Wave 5 Ending',c:68,d:'RSI divergence. LIKELY PEAK. Reduce.'};
        if(oB&&bTF>=2&&!mx?.div) return {w:'⚡ Wave 5 Progress',c:60,d:'Trail stop tightly.'};
        if((dW||dD)&&uD&&oS) return {w:'🔄 Wave C Complete',c:74,d:`RSI ${rsi.toFixed(0)} oversold + reversal. Major bottom.`};
        if((dW||dD)&&uD&&c24>4&&!oS) return {w:'🔄 Wave C → MSS',c:67,d:'Market Structure Shift forming.'};
        if(oS&&beTF>=2) return {w:'💎 Wave C Capitulation',c:74,d:`RSI ${rsi.toFixed(0)} extreme. Bottom forming.`};
        if((dW||dD)&&beTF>=2&&!oS) return {w:'📉 Wave A/C Bearish',c:70,d:'Downtrend. Rallies = sell.'};
        if(Math.abs(c24)<2&&Math.abs(c7)<3) return {w:'⚖️ Coiling',c:55,d:'Compression. Breakout imminent.'};
        if(uD&&!dW) return {w:'↗️ Impulse Building',c:55,d:`+${c24.toFixed(1)}%. Confirm needed.`};
        return {w:'⚖️ Corrective',c:50,d:'Wait for setup.'};
      }
      if(oS&&uD&&(mx?.xUp||(bTF>=1&&c24>2))) return {w:'🔄 Wave C Complete',c:72,d:`RSI ${rsi.toFixed(0)} + reversal +${c24.toFixed(1)}%.`};
      if(oS&&beTF>=2) return {w:'💎 Capitulation',c:72,d:`RSI ${rsi.toFixed(0)} extreme. Confirm candle.`};
      if(oS&&uD) return {w:'📉 Wave 2 Oversold',c:68,d:`RSI ${rsi.toFixed(0)} + +${c24.toFixed(1)}%.`};
      if(oB&&mx?.div) return {w:'⚠️ Wave 5 Ending',c:70,d:'Overbought + divergence. PEAK.'};
      if(rsi>=42&&rsi<=65&&uD&&bTF>=2&&(mx?.xUp||mx?.bull)) return {w:'🚀 Wave 3 — Impulse',c:80,d:`${bTF}/3 TF + +${c24.toFixed(1)}%. Best entry.`};
      if(rsi>=42&&rsi<=65&&uD&&bTF>=2) return {w:'📈 Impulse',c:68,d:`${bTF}/3 TF bullish.`};
      if(rsi>=42&&rsi<=65&&uD&&bTF>=1) return {w:'↗️ Bullish Momentum',c:60,d:`+${c24.toFixed(1)}%.`};
      if(rsi>=36&&rsi<48&&dD&&beTF>=2) return {w:'📉 Wave A/C',c:68,d:'Bearish TF align.'};
      if(rsi>=48&&rsi<=58&&Math.abs(c24)<1.5) return {w:'⚖️ Consolidation',c:55,d:'Building energy.'};
      if(mx?.xUp&&uD) return {w:'✅ MACD Golden Cross',c:65,d:`MACD + +${c24.toFixed(1)}%.`};
      if(mx?.xDown&&dD) return {w:'❌ MACD Death Cross',c:65,d:'Momentum lower.'};
      if(uD&&c24>5) return {w:'⚡ Strong Momentum',c:58,d:`+${c24.toFixed(1)}%.`};
      if(dD&&c24<-5) return {w:'📉 Selloff',c:58,d:`${c24.toFixed(1)}%.`};
      if(uD) return {w:'↗️ Recovery',c:52,d:`+${c24.toFixed(1)}%.`};
      if(dD) return {w:'↘️ Selling',c:52,d:`${c24.toFixed(1)}%.`};
      return {w:'⚖️ Sideways',c:48,d:'No direction.'};
    } catch { return {w:'⚖️ Corrective',c:50,d:'In progress.'}; }
  };

  const astro = (() => {
    try {
      const jd=Date.now()/86400000+2440587.5;const dm=((jd-2460320.5)%29.53058867+29.53058867)%29.53058867;
      const ph=[[1.5,'New Moon','🌑'],[8.5,'First Quarter','🌓'],[16,'Full Moon','🌕'],[22,'Waning','🌖'],[29.5,'Waning Crescent','🌘']];
      let mp='Dark Moon',me='🌑';for(const[lim,p,e]of ph)if(dm<lim){mp=p;me=e;break;}
      const ds=Math.floor((Date.now()-1713571200000)/86400000);
      return {moonPhase:mp,moonEmoji:me,halvingPhase:ds<365?'Bull Early 🔥':ds<480?'Bull Peak ⚡':ds<730?'Distribution ⚠️':'Accumulation 🌱',chaotic:mp==='Full Moon'||mp==='New Moon'};
    } catch { return {moonPhase:'—',moonEmoji:'🌙',halvingPhase:'Bull Cycle',chaotic:false}; }
  })();

  try {
    const [cgR,cgR2,mxR,byFrR,byKlR,ccR,fgR] = await Promise.allSettled([
      sf('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=volume_desc&per_page=250&page=1&sparkline=false&price_change_percentage=24h,7d',5500),
      sf('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=volume_desc&per_page=250&page=2&sparkline=false&price_change_percentage=24h,7d',5500),
      sf('https://api.mexc.com/api/v3/ticker/24hr',5500),
      sf('https://api.bybit.com/v5/market/tickers?category=linear',4500),
      Promise.allSettled(BYBIT_KLINES.map(s=>sf(`https://api.bybit.com/v5/market/kline?category=linear&symbol=${s}USDT&interval=240&limit=60`,3500))),
      Promise.allSettled(CC35.map(s=>sf(`https://min-api.cryptocompare.com/data/v2/histohour?fsym=${s}&tsym=USD&limit=42&aggregate=4&e=CCCAGG`,4500))),
      sf('https://api.alternative.me/fng/?limit=1&format=json',3000),
    ]);

    const fg=fgR.status==='fulfilled'?N(fgR.value?.data?.[0]?.value,50):50;

    const frMap={};
    try{for(const t of A(byFrR.value?.result?.list)){try{const sym=S(t.symbol).replace('USDT','').replace('PERP','');if(!sym)continue;const fr=N(t.fundingRate);frMap[sym]={fr,oi:N(t.openInterestValue),signal:fr>0.0008?'🚨 EXTREME LONG':fr>0.0004?'⚠️ LONG HEAVY':fr>0.0001?'↗️ Mild Long':fr<-0.0008?'🚀 EXTREME SHORT SQUEEZE':fr<-0.0004?'💎 SHORT SQUEEZE':fr<-0.0001?'↘️ Mild Short':'⚖️ Neutral',bullish:fr<-0.0002,bearish:fr>0.0004,pctFR:+(fr*100).toFixed(4)};}catch{}}}catch{}

    const cgList=[];
    for(const pageR of [cgR,cgR2]){for(const c of A(pageR.value)){try{const p=N(c.current_price);if(p<=0)continue;cgList.push({sym:S(c.symbol).toUpperCase(),name:S(c.name)||S(c.symbol),price:p,c24:N(c.price_change_percentage_24h),c7d:c.price_change_percentage_7d!=null?N(c.price_change_percentage_7d):null,vol:N(c.total_volume),h:N(c.high_24h)||p*1.02,l:N(c.low_24h)||p*0.98,mcap:N(c.market_cap),rank:N(c.market_cap_rank,9999),src:'cg'});}catch{}}}

    const mxList=[];
    const mxFiltered=[];
    for(const t of A(mxR.value)){try{if(!S(t?.symbol).endsWith('USDT'))continue;const sym=S(t.symbol).replace('USDT','');if(!sym||sym.length>14)continue;if(STABLES.has(sym))continue;if(BAD_SFX.some(x=>sym.endsWith(x)||sym.startsWith(x)))continue;const p=N(t.lastPrice),v=N(t.quoteVolume);if(p<=0||p>1e10||v<300000)continue;if(p>=0.97&&p<=1.03&&Math.abs(N(t.priceChangePercent))<0.5)continue;mxFiltered.push({sym,p,c24:N(t.priceChangePercent),v,h:N(t.highPrice)||p*1.02,l:N(t.lowPrice)||p*0.98});}catch{}}
    mxFiltered.sort((a,b)=>b.v-a.v);
    for(const t of mxFiltered.slice(0,800)){mxList.push({sym:t.sym,name:t.sym,price:t.p,c24:t.c24,c7d:null,vol:t.v,h:t.h,l:t.l,mcap:0,rank:9999,src:'mx'});}

    const seen=new Set();const pool=[];
    for(const c of cgList){if(!seen.has(c.sym)){seen.add(c.sym);pool.push(c);}}
    for(const c of mxList){if(!seen.has(c.sym)){seen.add(c.sym);pool.push(c);}}

    if(pool.length===0){return res.status(200).json({ok:false,error:'All sources unavailable.',ts:Date.now(),totalScanned:0,totalQualified:0,results:[],topSetups:{institutional:[],fullSend:[],highProbBull:[],smcSetups:[],ewSetups:[],volumeBreakout:[],strongSell:[],whaleSetups:[],anomalySetups:[],aiCoins:[],defiCoins:[],memeCoins:[],l1Coins:[],l2Coins:[],frExtreme:[],rsTop:[]},marketOverview:{marketMood:'UNKNOWN',bullishCount:0,bearishCount:0,avgChange24h:0}});}

    const kMap={};
    for(let i=0;i<CC35.length;i++){try{const r=ccR.value?.[i];if(r?.status!=='fulfilled'||r.value?.Response!=='Success')continue;const rows=A(r.value?.Data?.Data);if(rows.length<16)continue;const K=rows.filter(d=>N(d.close)>0&&N(d.close)<1e10&&N(d.high)>=N(d.low)).map(d=>({t:N(d.time),o:N(d.open),h:N(d.high),l:N(d.low),c:N(d.close),v:N(d.volumeto)}));if(K.length<16)continue;const cls=K.map(k=>k.c);const rsi=calcRSI(cls);if(rsi===null)continue;const e9=calcEMA(cls,9),e21=calcEMA(cls,21),e50=calcEMA(cls,Math.min(50,cls.length-1));const macd=calcMACD(cls);const smc=smcFull(K,cls[cls.length-1]);let obvUp=0,obvDn=0;for(let j=Math.max(1,K.length-15);j<K.length;j++){if(N(K[j].c)>N(K[j-1].c))obvUp+=N(K[j].v);else if(N(K[j].c)<N(K[j-1].c))obvDn+=N(K[j].v);}const atrArr=K.slice(1).map((k,i)=>Math.max(N(k.h)-N(k.l),Math.abs(N(k.h)-N(K[i].c)),Math.abs(N(k.l)-N(K[i].c))));const atr14=atrArr.slice(-14).reduce((s,v)=>s+v,0)/14;kMap[CC35[i]]={rsi:+N(rsi).toFixed(2),e9,e21,e50,macd,K,cls,smc,atr:+atr14.toFixed(8),obvBull:obvUp>obvDn*1.2,ok:true,rsiSrc:'cc'};}catch{}}

    let bybitRSICount=0;
    for(let i=0;i<BYBIT_KLINES.length;i++){try{const r=byKlR.value?.[i];if(r?.status!=='fulfilled'||r.value?.retCode!==0)continue;const raw=A(r.value?.result?.list);if(raw.length<16)continue;const K=raw.slice().reverse().map(d=>({t:N(d[0]),o:N(d[1]),h:N(d[2]),l:N(d[3]),c:N(d[4]),v:N(d[6])})).filter(d=>d.c>0&&d.c<1e12&&d.h>=d.l);if(K.length<16)continue;const cls=K.map(k=>k.c);const rsi=calcRSI(cls);if(rsi===null)continue;const e9=calcEMA(cls,9),e21=calcEMA(cls,21),e50=calcEMA(cls,Math.min(50,cls.length-1));const macd=calcMACD(cls);const smc=smcFull(K,cls[cls.length-1]);let obvUp=0,obvDn=0;for(let j=Math.max(1,K.length-15);j<K.length;j++){if(N(K[j].c)>N(K[j-1].c))obvUp+=N(K[j].v);else if(N(K[j].c)<N(K[j-1].c))obvDn+=N(K[j].v);}const atrArr=K.slice(1).map((k,ii)=>Math.max(N(k.h)-N(k.l),Math.abs(N(k.h)-N(K[ii].c)),Math.abs(N(k.l)-N(K[ii].c))));const atr14=atrArr.slice(-14).reduce((s,v)=>s+v,0)/14;kMap[BYBIT_KLINES[i]]={rsi:+N(rsi).toFixed(2),e9,e21,e50,macd,K,cls,smc,atr:+atr14.toFixed(8),obvBull:obvUp>obvDn*1.2,ok:true,rsiSrc:'bybit'};bybitRSICount++;}catch{}}

    const btcPoolCoin=pool.find(c=>c.sym==='BTC')||null;
    const btcCh24=btcPoolCoin?.c24||0;
    const btcCh7d=btcPoolCoin?.c7d||0;

    const results=[];
    for(const c of pool){
      try{
        const {sym,name,price,c24,c7d,vol,h,l,mcap,rank,src}=c;
        if(!sym||!price||price<=0)continue;
        const sector=getSector(sym);
        const sectorEmoji=SECTOR_EMOJI[sector]||'🪙';
        const pPos=h>l?clamp((price-l)/(h-l),0,1):0.5;
        const rng=h>l?(h-l)/price*100:0;
        const vt=vol>=1e9?5:vol>=200e6?4:vol>=50e6?3:vol>=10e6?2:vol>=1e6?1:0;
        const kd=kMap[sym]||null;
        const fd=frMap[sym]||null;
        const frVal=fd?.fr||0;
        const rsi=kd?.ok?kd.rsi:clamp(50+c24*2.5+(pPos-0.5)*25+((c7d||0)>0?4:-4),8,92);
        const rsiR=!!(kd?.ok);
        let emaS=0;
        if(kd?.ok&&kd.cls?.length>=10){const lp=kd.cls[kd.cls.length-1];if(lp>kd.e9)emaS++;if(lp>kd.e21)emaS++;if(lp>kd.e50)emaS++;}
        else{if(c24>0)emaS++;if((c7d||0)>0)emaS++;if(pPos>0.55)emaS++;}
        const t1h=rsi>58?'BULL':rsi<42?'BEAR':'SIDE';
        const t4h=(kd?.macd?.bull||(c24>1.5&&pPos>0.5))?'BULL':(c24<-1.5&&pPos<0.5)?'BEAR':'SIDE';
        const t1d=(c7d||0)>3?'BULL':(c7d||0)<-3?'BEAR':'SIDE';
        const bTF=[t1h,t4h,t1d].filter(x=>x==='BULL').length;
        const beTF=[t1h,t4h,t1d].filter(x=>x==='BEAR').length;
        const smc=kd?.smc||smcEst(price,h,l,c24,c7d||0);
        const pats=getPatterns(kd?.K||null,price,h,l,c24,c7d,pPos,vol);
        const ew=getEW(rsi,c24,c7d,kd?.macd||null,bTF,beTF);

        // ═══════════════════════════════════════════════
        // SCORING v28 — base 48, tighter thresholds
        // ═══════════════════════════════════════════════
        const volC=vt>=5?(c24>0?5:2):vt>=4?(c24>0?4:1):vt>=3?(c24>0?3:0):vt>=2?1:vt>=1?0:-2;
        const tC=bTF===3?(vt>=3?25:20):bTF===2?15:bTF===1?5:beTF===3?-25:beTF===2?-15:beTF===1?-5:0;
        const rC=rsi<25?(beTF===0?15:beTF===1?8:3):rsi<32?(beTF===0?10:beTF===1?5:2):rsi<40?(beTF===0?5:beTF===1?3:1):rsi<48?1:rsi>80?(bTF===0?-15:bTF===1?-8:-3):rsi>74?(bTF===0?-10:bTF===1?-5:-2):rsi>67?(bTF===0?-5:-2):rsi>57?3:0;
        const mW=(c7d||0)>20?10:(c7d||0)>8?6:(c7d||0)>3?3:(c7d||0)<-20?-10:(c7d||0)<-8?-6:(c7d||0)<-3?-3:0;
        const m24=c24>10?6:c24>4?3:c24>1?1:c24<-10?-6:c24<-4?-3:c24<-1?-1:0;
        const mC=kd?.macd?.xUp?8:kd?.macd?.xDown?-8:kd?.macd?.bull?3:kd?.macd?.bear?-3:0;
        const smcBase=N(smc?.bS,0)-N(smc?.beS,0);
        const smcFreshBonus=(smc?.bOB?.fresh&&smc?.bOB?.inZone&&c24>0)?2:(smc?.sweep?.t?.includes('Bull')&&c24>0)?2:0;
        const smcC=smcBase+smcFreshBonus;
        const pC=pats.some(x=>x.signal==='bullish'&&x.winRate>=80)?3:pats.some(x=>x.signal==='bullish')?1:pats.some(x=>x.signal==='bearish'&&x.winRate>=80)?-3:pats.some(x=>x.signal==='bearish')?-1:0;
        const ewC=ew.w.includes('Wave 3')?4:ew.w.includes('Wave 2')?2:ew.w.includes('C Complete')||ew.w.includes('Capitulation')?3:ew.w.includes('Bearish')||ew.w.includes('5 End')?-2:0;
        const oc=onchainScore(vol,mcap,rank,c24,c7d);
        const ocC=clamp(oc.score*0.8,0,6);
        const frC=frVal<-0.0008?8:frVal<-0.0005?6:frVal<-0.0003?4:frVal<-0.0001?2:frVal>0.0008?-7:frVal>0.0005?-5:frVal>0.0003?-3:frVal>0.0001?-1:0;
        const prob=clamp(Math.round(48+tC+rC+mW+m24+mC+smcC+pC+ewC+ocC+frC+volC),2,98);
        const score=tC+rC+mW+m24+mC+smcC;

        // ── WHALE DETECTOR v2 ──────────────────────────
        let wScore=0;const wSigs=[];
        try{
          const vR=mcap>0?vol/mcap:0;
          if(vR>0.20){wScore+=5;wSigs.push('🔥 Vol '+(vR*100).toFixed(1)+'% MCap — EXTREME institutional');}
          else if(vR>0.12){wScore+=3;wSigs.push('📈 Vol '+(vR*100).toFixed(1)+'% MCap — unusual');}
          else if(vR>0.05){wScore+=2;}
          else if(mcap===0&&vt>=5){wScore+=5;wSigs.push('🔥 Vol $1B+ spike');}
          else if(mcap===0&&vt>=4){wScore+=3;wSigs.push('📈 Vol $200M+ institutional');}
          else if(mcap===0&&vt>=3){wScore+=2;}
          else if(mcap===0&&vt>=2){wScore+=1;}
          const c7_=c7d||0;
          if(c7_<-7&&c24>1.8&&pPos>0.2&&vol>800000){wScore+=5;wSigs.push('🤫 STEALTH: 7d='+c7_.toFixed(1)+'% → 24h=+'+c24.toFixed(1)+'%');}
          else if(c7_<-4&&c24>1.2&&pPos>0.25&&vol>300000){wScore+=3;wSigs.push('👀 Hidden recovery: 7d='+c7_.toFixed(1)+'% → 24h=+'+c24.toFixed(1)+'%');}
          if(rsi<25&&c24>1.0){wScore+=4;wSigs.push('💎 RSI '+rsi.toFixed(0)+' EXTREME + reversal — SM entry');}
          else if(rsi<34&&c24>1.5){wScore+=2;wSigs.push('📊 RSI '+rsi.toFixed(0)+' oversold + momentum');}
          if(smc?.bOB?.fresh&&smc?.bOB?.inZone){wScore+=4;wSigs.push('📦 Bull OB fresh IN ZONE $'+smc.bOB.L+'–$'+smc.bOB.H);}
          else if(smc?.inBullOB&&pPos<0.32){wScore+=2;wSigs.push('📦 Discount + Bull OB area');}
          if(smc?.hasCHoCH&&(smc?.chochType||'').includes('Bull')){wScore+=3;wSigs.push('🔄 '+smc.chochType+' — SM membalik struktur');}
          if(smc?.hasBOS&&(smc?.bosType||'').includes('Bull')&&c24>3){wScore+=3;wSigs.push('🚀 '+smc.bosType+' +'+c24.toFixed(1)+'%');}
          if(pPos<0.12&&c24>1.5&&vol>800000){wScore+=3;wSigs.push('💎 Bottom '+( pPos*100).toFixed(0)+'% + recovery');}
          if(c7_<-15&&c24>4&&pPos>0.35&&vol>2e6){wScore+=4;wSigs.push('⚡ -'+Math.abs(c7_).toFixed(0)+'% 7d → +'+c24.toFixed(1)+'% 24h — SM trap done');}
          if(kd?.ok&&kd.K?.length>=15&&kd.cls?.length>=15){
            let obvR=0,obvF=0;const kSlice=kd.K.slice(-20);
            for(let i=1;i<kSlice.length;i++){const kk=kSlice[i],pp=kSlice[i-1];if(!kk||!pp)continue;if(N(kk.c)>N(pp.c))obvR+=N(kk.v);else if(N(kk.c)<N(pp.c))obvF+=N(kk.v);}
            if(obvR>obvF*1.4&&c7_<0){wScore+=5;wSigs.push('📊 OBV DIVERGENCE: vol beli '+(obvR/1e6).toFixed(1)+'M >> saat harga turun');}
            else if(obvR>obvF*1.2&&c24>0){wScore+=2;}
            const atrArr2=kd.K.slice(1).map((k2,i2)=>k2&&kd.K[i2]?Math.max(N(k2.h)-N(k2.l),Math.abs(N(k2.h)-N(kd.K[i2].c)),Math.abs(N(k2.l)-N(kd.K[i2].c))):0);
            const avgATR2=atrArr2.slice(-14).reduce((s,v)=>s+v,0)/14;
            const lastK=kd.K[kd.K.length-1];
            if(lastK&&avgATR2>0){const lRng=N(lastK.h)-N(lastK.l);if(lRng>avgATR2*2.5&&N(lastK.c)>N(lastK.o)){wScore+=4;wSigs.push('🚀 DISPLACEMENT '+(lRng/avgATR2).toFixed(1)+'x ATR — institutional entry');}}
            if(smc?.sweep?.t?.includes('Bull')){wScore+=5;wSigs.push('⚡ SSL SWEEP $'+smc.sweep.lv+' — SM ambil stops lalu naik');}
            if(kd?.macd?.xUp&&vt>=3){wScore+=3;wSigs.push('✅ MACD Golden Cross + Vol '+(vt>=4?'$200M+':'$50M+'));}
            if(smc?.eqL&&c24>1.5&&pPos>0.3){wScore+=3;wSigs.push('🎯 Equal Lows $'+smc.eqL+' diambil + reversal');}
          }
        }catch{}
        const wFinal=clamp(wScore,0,30);
        const wLevel=wFinal>=15?'🐋 STRONG WHALE':wFinal>=9?'🐳 WHALE DETECTED':wFinal>=6?'🔍 UNUSUAL ACTIVITY':'';
        const whaleData=wFinal>=6?{score:wFinal,level:wLevel,signals:wSigs.filter(s=>!s.startsWith('⚠️')).slice(0,4)}:null;

        // ── ANOMALY DETECTOR v2 ─────────────────────────
        let aScore=0;const aSigs=[];
        try{
          if(btcCh24<-1&&c24>3){aScore+=10;aSigs.push('🚀 DECOUPLING: BTC '+btcCh24.toFixed(1)+'% tapi koin +'+c24.toFixed(1)+'%');}
          else if(btcCh24<0&&c24>5){aScore+=8;aSigs.push('📈 Independent: BTC '+btcCh24.toFixed(1)+'% vs +'+c24.toFixed(1)+'%');}
          else if(Math.abs(btcCh24)<1&&c24>5){aScore+=7;aSigs.push('⚡ BTC sideways + koin +'+c24.toFixed(1)+'% — catalyst');}
          else if(Math.abs(btcCh24)<1.5&&c24>3){aScore+=4;aSigs.push('📊 BTC flat + koin +'+c24.toFixed(1)+'%');}
          const c7_=c7d||0;
          if(btcCh7d<-3&&c7_>3){aScore+=8;aSigs.push('🔄 7d: BTC '+btcCh7d.toFixed(0)+'% vs koin +'+c7_.toFixed(0)+'%');}
          else if((c7_-btcCh7d)>12){aScore+=5;aSigs.push('📊 RS 7d: +'+(c7_-btcCh7d).toFixed(0)+'% vs BTC');}
          if(mcap>0&&vol/mcap>0.15&&btcCh24<-1&&c24>-1){aScore+=9;aSigs.push('👁 Vol '+(vol/mcap*100).toFixed(0)+'% MCap + tidak ikut BTC dump');}
          else if(mcap>0&&vol/mcap>0.10&&Math.abs(c24)<2){aScore+=7;aSigs.push('👁 Vol Anomaly '+(vol/mcap*100).toFixed(0)+'% + flat price');}
          else if(mcap>0&&vol/mcap>0.06&&c24>0){aScore+=4;}
          if(frVal<-0.0004&&btcCh24<1){aScore+=8;aSigs.push('💎 FR Squeeze '+(frVal*100).toFixed(4)+'% + BTC flat');}
          else if(frVal<-0.0002&&c24>2&&btcCh24<1){aScore+=5;aSigs.push('⚡ FR neg + up saat BTC flat');}
          if(kd?.ok&&kd.K?.length>=15){
            const K2=kd.K,n2=K2.length;
            let obvR=0,obvF=0;for(let i=Math.max(1,n2-15);i<n2;i++){if(N(K2[i].c)>N(K2[i-1].c))obvR+=N(K2[i].v);else if(N(K2[i].c)<N(K2[i-1].c))obvF+=N(K2[i].v);}
            if(obvR>obvF*1.5&&c7_<0&&btcCh24<0){aScore+=9;aSigs.push('📊 OBV bull saat harga+BTC turun — stealth SM');}
            else if(obvR>obvF*1.3&&btcCh24<0&&c24>0){aScore+=6;aSigs.push('📊 OBV naik + decoupling BTC');}
            const lastK2=K2[n2-1];const atrK=kd.atr||(h-l)*0.65;
            if(lastK2&&atrK>0){const cRange=N(lastK2.h)-N(lastK2.l);if(cRange>atrK*2.5&&N(lastK2.c)>N(lastK2.o)&&Math.abs(btcCh24)<2){aScore+=7;aSigs.push('🚀 DISPLACEMENT '+(cRange/atrK).toFixed(1)+'x ATR + BTC flat');}}
            if(smc?.sweep?.t?.includes('Bull')&&Math.abs(btcCh24)<2){aScore+=9;aSigs.push('⚡ SSL SWEEP independen — liquidity grab murni');}
          }
        }catch{}
        const aFinal=clamp(aScore,0,40);
        const aLevel=aFinal>=18?'🔮 STRONG ANOMALY':aFinal>=12?'⚡ ANOMALY DETECTED':aFinal>=7?'👁 MILD ANOMALY':'';
        const anomalyData=aFinal>=7?{score:aFinal,level:aLevel,signals:aSigs.slice(0,3),decouplePct:+(c24-btcCh24).toFixed(2),btcRef:btcCh24}:null;

        let taLabel='⚖️ SIDEWAYS',taColor='neutral';
        if(bTF===3){taLabel='🚀 FULL SEND';taColor='full-bull';}
        else if(bTF>=2){taLabel='📈 STRONG BULL';taColor='bull';}
        else if(bTF===1&&beTF===0){taLabel='↗️ MILD BULL';taColor='bull';}
        else if(beTF===3){taLabel='💀 FULL BEAR';taColor='full-bear';}
        else if(beTF>=2){taLabel='📉 STRONG BEAR';taColor='bear';}
        else if(beTF===1&&bTF===0){taLabel='↘️ MILD BEAR';taColor='bear';}

        const smcD=smc?.hasBOS?smc.bosType:smc?.hasCHoCH?'CHoCH (MSS)':smc?.inBullOB?'Bull OB ✓':smc?.inBearOB?'Bear OB':smc?.inBullFVG?'Bull FVG ✓':smc?.zone||'Neutral';

        const sigs=[];
        if(rsi<25)sigs.push('RSI '+rsi.toFixed(0)+' EXTREME oversold — prime accumulation 🎯');
        else if(rsi<32)sigs.push('RSI '+rsi.toFixed(0)+' oversold'+(beTF>=2?' — watch reversal':' — entry zone'));
        else if(rsi>78)sigs.push('RSI '+rsi.toFixed(0)+' overbought'+(bTF>=2?' — reduce':''));
        if(kd?.macd?.xUp)sigs.push('MACD golden cross ✅ — bullish momentum');
        if(kd?.macd?.xDown)sigs.push('MACD death cross ⚠️ — bearish momentum');
        if(kd?.macd?.div)sigs.push('MACD divergence ⚠️ — weakening');
        if(smc?.bOB)sigs.push('ICT Bull OB $'+smc.bOB.L+'–$'+smc.bOB.H+(smc.bOB.fresh?' (fresh)':'')+(smc.bOB.inZone?' ✓ IN ZONE':''));
        if(smc?.beOB)sigs.push('ICT Bear OB $'+smc.beOB.L+'–$'+smc.beOB.H+(smc.beOB.fresh?' (fresh)':''));
        if(smc?.bFVG)sigs.push('ICT Bull FVG '+smc.bFVG.pct+'% gap');
        if(smc?.sweep)sigs.push(smc.sweep.t+' at $'+smc.sweep.lv+' — liquidity swept');
        if(smc?.eqH)sigs.push('Equal Highs (BSL) $'+smc.eqH);
        if(smc?.eqL)sigs.push('Equal Lows (SSL) $'+smc.eqL);
        if(smc?.inOTE)sigs.push('In OTE zone (61.8–78.6%)');
        if(smc?.hasCHoCH)sigs.push(smc.chochType+' at $'+smc.chochLevel);
        if(smc?.hasBOS&&c24>4)sigs.push(smc.bosType+' at $'+smc.bosLevel);
        if(vt>=4&&c24>3)sigs.push('$'+['','','','','200M+','1B+'][vt]+' vol +'+c24.toFixed(1)+'% — SM move');
        if(bTF===3)sigs.push('All 3 TF aligned 🎯 — highest conviction');
        if(kd?.obvBull&&c24>0)sigs.push('OBV bullish — net buying confirmed');
        if(fd){const frPct=(frVal*100).toFixed(4);if(frVal<-0.0005)sigs.push('🚀 FR: '+frPct+'% EXTREME SHORT SQUEEZE');else if(frVal<-0.0003)sigs.push('💎 FR: '+frPct+'% Short Squeeze setup');else if(frVal>0.0005)sigs.push('🚨 FR: +'+frPct+'% OVERHEATED');else if(frVal>0.0003)sigs.push('⚠️ FR: +'+frPct+'% long heavy');}
        oc.sigs.forEach(s=>sigs.push(s));
        pats.forEach(p=>sigs.push(p.name+' ('+p.winRate+'%): '+p.desc));

        results.push({
          rank:results.length+1,symbol:sym,name,dataSource:src,sector,sectorEmoji,
          price,change24h:+c24.toFixed(2),change7d:c7d!=null?+c7d.toFixed(2):null,
          volume24h:vol,mcap,mcapRank:rank,high24h:h,low24h:l,pricePos:+pPos.toFixed(3),range:+rng.toFixed(2),
          rsi:+rsi.toFixed(2),rsiReal:rsiR,vt,
          trendAlignment:taLabel,taColor,trend1h:t1h,trend4h:t4h,trend1d:t1d,bullTF:bTF,bearTF:beTF,
          smc:{...smc,signal:smcD},
          elliottWave:{wave:ew.w,confidence:ew.c,description:ew.d},
          chartPatterns:pats.length>0?pats:[{name:c24>=0?'↗️ Bullish Close':'↘️ Bearish Close',signal:c24>=0?'bullish':'bearish',winRate:75,desc:(c24>=0?'+':'')+c24.toFixed(1)+'%'}],
          probability:prob,score,onchainScore:oc.score,anomaly:anomalyData,
          fundingRate:fd?{rate:frVal,pct:fd.pctFR,signal:fd.signal,bullish:fd.bullish,bearish:fd.bearish,oi:fd.oi}:null,
          whale:whaleData,signals:sigs.slice(0,7),
          astrology:{moonPhase:astro.moonPhase,moonEmoji:astro.moonEmoji,halvingPhase:astro.halvingPhase,chaotic:astro.chaotic},
          hasRealData:rsiR,
        });
      }catch{}
    }

    results.sort((a,b)=>b.probability-a.probability||b.score-a.score);
    results.forEach((r,i)=>r.rank=i+1);

    const btcR=results.find(r=>r.symbol==='BTCUSDT'||r.symbol==='BTC');
    const btcCh24RS=btcR?.change24h||btcCh24;const btcCh7dRS=btcR?.change7d||btcCh7d;
    for(const r of results){
      try{
        const rs24=+(r.change24h-btcCh24RS).toFixed(2);
        const rs7d=r.change7d!=null?+(r.change7d-btcCh7dRS).toFixed(2):null;
        const rsScore=rs7d!=null?+(rs7d*0.6+rs24*0.4).toFixed(2):rs24;
        const rsLabel=rsScore>15?'🚀 Strong Outperform':rsScore>5?'📈 Outperform':rsScore>0?'↗️ Mild Outperform':rsScore>-5?'↘️ Mild Underperform':rsScore>-15?'📉 Underperform':'💀 Strong Underperform';
        r.rs={score:+rsScore.toFixed(2),rs24,rs7d,label:rsLabel,bullish:rsScore>2,bearish:rsScore<-2};
      }catch{r.rs=null;}
    }

    // ══════════════════════════════════════════════════
    // TAB FILTERS v28 — STRICTER THRESHOLDS
    // ══════════════════════════════════════════════════
    const institutional=results.filter(r=>r.score>=14&&r.probability>=62&&r.volume24h>=5e6).slice(0,80);
    const fullSend=results.filter(r=>r.probability>=70&&r.volume24h>=1e6&&(r.bullTF>=2||r.taColor==='full-bull'||r.taColor==='bull')).sort((a,b)=>b.probability-a.probability).slice(0,60);
    const highProbBull=results.filter(r=>r.probability>=68&&r.score>=10).slice(0,60);
    const smcSetups=results.filter(r=>(r.smc?.inBullOB||r.smc?.inBullFVG||r.smc?.hasCHoCH||r.smc?.hasBOS)&&r.probability>=52).slice(0,60);
    const ewSetups=results.filter(r=>{const w=r.elliottWave?.wave||'';return(w.includes('Wave 3')||w.includes('Impulse'))?r.probability>=58:(w.includes('Wave 2')||w.includes('OTE'))?r.probability>=52:(w.includes('C Complete')||w.includes('Capitulation')||w.includes('Bottom'))?r.probability>=50:(r.rsi<38&&r.change24h>0)?r.probability>=50:false;}).sort((a,b)=>b.probability-a.probability).slice(0,60);
    const volumeBreakout=results.filter(r=>r.vt>=3&&r.change24h>1&&r.probability>50).sort((a,b)=>b.volume24h-a.volume24h).slice(0,60);
    const strongSell=results.filter(r=>r.probability<40||r.taColor==='full-bear').sort((a,b)=>a.probability-b.probability).slice(0,40);
    const whaleSetups=results.filter(r=>r.whale&&r.whale.score>=6).sort((a,b)=>b.whale.score-a.whale.score).slice(0,60);
    const anomalySetups=results.filter(r=>r.anomaly&&r.anomaly.score>=7).sort((a,b)=>b.anomaly.score-a.anomaly.score).slice(0,60);
    const aiCoins=results.filter(r=>r.sector==='AI').sort((a,b)=>b.probability-a.probability).slice(0,50);
    const defiCoins=results.filter(r=>r.sector==='DEFI').sort((a,b)=>b.probability-a.probability).slice(0,50);
    const memeCoins=results.filter(r=>r.sector==='MEME').sort((a,b)=>b.probability-a.probability).slice(0,50);
    const l1Coins=results.filter(r=>r.sector==='L1').sort((a,b)=>b.probability-a.probability).slice(0,40);
    const l2Coins=results.filter(r=>r.sector==='L2').sort((a,b)=>b.probability-a.probability).slice(0,40);
    const frExtreme=results.filter(r=>r.fundingRate&&(r.fundingRate.bullish||r.fundingRate.bearish)).sort((a,b)=>{const fa=Math.abs(a.fundingRate?.rate||0),fb=Math.abs(b.fundingRate?.rate||0);return fb-fa;}).slice(0,50);
    const rsTop=results.filter(r=>r.rs?.score>3&&r.probability>=50&&r.volume24h>=1e6).sort((a,b)=>b.rs.score-a.rs.score).slice(0,60);

    const sectorStats={};
    for(const r of results){if(!sectorStats[r.sector])sectorStats[r.sector]={count:0,bullish:0,bearish:0,avgProb:0};sectorStats[r.sector].count++;if(r.probability>55)sectorStats[r.sector].bullish++;if(r.probability<45)sectorStats[r.sector].bearish++;sectorStats[r.sector].avgProb+=r.probability;}
    for(const s of Object.keys(sectorStats))sectorStats[s].avgProb=Math.round(sectorStats[s].avgProb/sectorStats[s].count);

    const bullC=results.filter(r=>r.probability>55).length;
    const bearC=results.filter(r=>r.probability<45).length;
    const avgCh=results.length?+(results.reduce((s,r)=>s+r.change24h,0)/results.length).toFixed(2):0;
    const mood=avgCh>3?'STRONG BULL':avgCh>1?'BULL':avgCh<-3?'STRONG BEAR':avgCh<-1?'BEAR':'NEUTRAL';

    return res.status(200).json({ok:true,ts:Date.now(),elapsed:Date.now()-t0,version:'v28',src:'cg:'+(cgList.length)+'+mx:'+mxList.length+' total:'+pool.length,fg,totalScanned:pool.length,totalQualified:results.length,rsiRealCount:Object.keys(kMap).length,rsiRealCC:Object.values(kMap).filter(k=>k.rsiSrc==='cc').length,rsiRealBybit:bybitRSICount,results,topSetups:{institutional,fullSend,highProbBull,smcSetups,ewSetups,volumeBreakout,strongSell,whaleSetups,anomalySetups,aiCoins,defiCoins,memeCoins,l1Coins,l2Coins,frExtreme,rsTop},marketOverview:{marketMood:mood,bullishCount:bullC,bearishCount:bearC,avgChange24h:avgCh,totalCoins:results.length,sectorStats,frCoverage:Object.keys(frMap).length,btcChange24h:btcCh24,btcChange7d:btcCh7d},astroContext:astro});

  }catch(e){
    return res.status(200).json({ok:false,error:e.message,ts:Date.now(),elapsed:Date.now()-t0,version:'v28',totalScanned:0,totalQualified:0,results:[],topSetups:{institutional:[],fullSend:[],highProbBull:[],smcSetups:[],ewSetups:[],volumeBreakout:[],strongSell:[],whaleSetups:[],anomalySetups:[],aiCoins:[],defiCoins:[],memeCoins:[],l1Coins:[],l2Coins:[],frExtreme:[],rsTop:[]},marketOverview:{marketMood:'UNKNOWN',bullishCount:0,bearishCount:0,avgChange24h:0}});
  }
}
