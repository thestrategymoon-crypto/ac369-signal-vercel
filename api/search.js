// api/search.js — v17 UNIVERSAL
// PRIMARY : CryptoCompare klines (full TA jika ada)
// FALLBACK: CoinGecko search → markets (bekerja untuk SEMUA koin)
// RON, HYPE, dan semua koin bisa dianalisis

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=20, stale-while-revalidate=10');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const raw = (req.query.symbol || req.query.s || '').toUpperCase()
    .replace(/USDT$/,'').replace(/[^A-Z0-9]/g,'');
  if (!raw) return res.status(200).json({ error: 'Symbol diperlukan. Contoh: ?symbol=BTC', price: 0 });

  const t0 = Date.now();
  const sf = async (url, ms) => {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), ms);
    try {
      const r = await fetch(url, { signal: c.signal, headers: { Accept: 'application/json', 'User-Agent': 'AC369/1.0' } });
      clearTimeout(t); if (!r.ok) return null; return await r.json();
    } catch { clearTimeout(t); return null; }
  };

  // ── TA LIBRARY ─────────────────────────────────────────
  const EMA = (a, p) => {
    if (!a||a.length<2) return a?.[a.length-1]||0;
    const k=2/(p+1); let e=a.slice(0,Math.min(p,a.length)).reduce((s,v)=>s+v,0)/Math.min(p,a.length);
    for(let i=Math.min(p,a.length);i<a.length;i++) e=a[i]*k+e*(1-k);
    return +e.toFixed(8);
  };
  const RSI14 = (a) => {
    if (!a||a.length<16) return 50;
    let ag=0,al=0;
    for(let i=1;i<=14;i++){const d=a[i]-a[i-1];d>0?ag+=d:al-=d;}
    ag/=14;al/=14;
    for(let i=15;i<a.length;i++){const d=a[i]-a[i-1];ag=(ag*13+Math.max(d,0))/14;al=(al*13+Math.max(-d,0))/14;}
    return al===0?100:+(100-100/(1+ag/al)).toFixed(2);
  };
  const MACD = (a) => {
    if (!a||a.length<36) return {bullish:false,bearish:false,crossUp:false,crossDown:false,histogram:0};
    const k12=2/13,k26=2/27,k9=2/10;
    let e12=a.slice(0,12).reduce((s,v)=>s+v,0)/12, e26=a.slice(0,26).reduce((s,v)=>s+v,0)/26;
    const mv=[];
    for(let i=26;i<a.length;i++){e12=a[i]*k12+e12*(1-k12);e26=a[i]*k26+e26*(1-k26);mv.push(e12-e26);}
    let sig=mv.slice(0,9).reduce((s,v)=>s+v,0)/9;
    for(let i=9;i<mv.length;i++) sig=mv[i]*k9+sig*(1-k9);
    const last=mv[mv.length-1],prev=mv[mv.length-2]||last,hist=last-sig,prevH=prev-sig;
    return{bullish:last>0&&hist>0,bearish:last<0&&hist<0,crossUp:hist>0&&prevH<=0,crossDown:hist<0&&prevH>=0,histogram:+hist.toFixed(8),macd:+last.toFixed(8),signal:+sig.toFixed(8)};
  };
  const BB = (a,p=20) => {
    if (!a||a.length<p) return{upper:0,lower:0,mid:0,width:0,position:50,squeeze:false};
    const sl=a.slice(-p),m=sl.reduce((s,v)=>s+v,0)/p;
    const sd=Math.sqrt(sl.reduce((s,v)=>s+(v-m)**2,0)/p);
    const up=m+2*sd,dn=m-2*sd,last=a[a.length-1];
    return{upper:+up.toFixed(6),lower:+dn.toFixed(6),mid:+m.toFixed(6),width:sd>0?+((4*sd/m)*100).toFixed(2):0,position:sd>0?+((last-dn)/(4*sd)*100).toFixed(1):50,squeeze:sd>0&&(4*sd/m)*100<3};
  };
  const ATR = (K,p=14) => {
    if (!K||K.length<2) return{atr:0,atrPct:0,volatility:'LOW'};
    const tr=K.slice(1).map((k,i)=>Math.max(k.h-k.l,Math.abs(k.h-K[i].c),Math.abs(k.l-K[i].c)));
    const atr=tr.slice(-p).reduce((s,v)=>s+v,0)/Math.min(p,tr.length);
    const pct=+(atr/(K[K.length-1].c||1)*100).toFixed(3);
    return{atr:+atr.toFixed(6),atrPct:pct,volatility:pct>5?'HIGH':pct>2?'MEDIUM':'LOW'};
  };

  // ── SMC Analysis ──────────────────────────────────────
  const smcFromKlines = (K, price) => {
    if (!K||K.length<10) return{signal:'Insufficient data',hasBOS:false,inBullOB:false};
    const n=K.length;
    const swH=[],swL=[];
    for(let i=2;i<n-2;i++){
      if(K[i].h>K[i-1].h&&K[i].h>K[i-2].h&&K[i].h>K[i+1].h) swH.push({i,price:K[i].h});
      if(K[i].l<K[i-1].l&&K[i].l<K[i-2].l&&K[i].l<K[i+1].l) swL.push({i,price:K[i].l});
    }
    const rH=swH.slice(-2),rL=swL.slice(-2);
    const lastSH=rH[rH.length-1]?.price||0;
    const lastSL=rL[rL.length-1]?.price||Infinity;
    const hasBOS=(price>lastSH&&lastSH>0)||(price<lastSL&&lastSL<Infinity);
    const bosType=price>lastSH?'Bullish BOS':'Bearish BOS';
    let inBullOB=false,bullOBLevel=null,inBearOB=false,bearOBLevel=null,inBullFVG=false;
    for(let i=n-12;i<n-3;i++){if(i<0)continue;
      const k=K[i],nxt=K[i+1];
      if(k.c<k.o&&nxt.c>nxt.o&&nxt.c>k.o){const obH=Math.max(k.o,k.c),obL=Math.min(k.o,k.c);if(price>=obL*0.998&&price<=obH*1.005){inBullOB=true;bullOBLevel=+obL.toFixed(6);}}
      if(k.c>k.o&&nxt.c<nxt.o&&nxt.c<k.o){const obH=Math.max(k.o,k.c),obL=Math.min(k.o,k.c);if(price>=obL*0.997&&price<=obH*1.002){inBearOB=true;bearOBLevel=+obH.toFixed(6);}}
      if(i+2<n&&K[i+2].l-K[i].h>0&&price>=K[i].h&&price<=K[i+2].l) inBullFVG=true;
    }
    const equil=(Math.max(...K.slice(-50).map(k=>k.h))+Math.min(...K.slice(-50).map(k=>k.l)))/2;
    const zone=price>equil?'Premium':'Discount';
    const bScore=(hasBOS&&bosType.includes('Bull')?2:0)+(inBullOB?2:0)+(inBullFVG?1:0);
    const beScore=(hasBOS&&bosType.includes('Bear')?2:0)+(inBearOB?2:0);
    return{signal:bScore>beScore?'Bullish':beScore>bScore?'Bearish':'Neutral',hasBOS,bosType:hasBOS?bosType:'None',inBullOB,bullOBLevel,inBearOB,bearOBLevel,inBullFVG,zone,swingHighs:rH.map(h=>+h.price.toFixed(4)),swingLows:rL.map(l=>+l.price.toFixed(4))};
  };

  // ── SMC from basic price data (no klines) ────────────
  const smcFromBasic = (price, high, low, ch24, ch7d, vol) => {
    const equil=(high+low)/2;
    const pricePos=high>low?(price-low)/(high-low):0.5;
    const zone=price>equil?'Premium Zone':'Discount Zone';
    const hasBOS=Math.abs(ch24)>5&&vol>10e6;
    const bosType=ch24>5?'Bullish BOS':ch24<-5?'Bearish BOS':'None';
    const hasCHoCH=ch24>3&&ch7d<0;
    const inDiscount=pricePos<0.25;
    const inPremium=pricePos>0.75;
    return{signal:inDiscount?'Bullish (Discount)':inPremium?'Bearish (Premium)':hasCHoCH?'CHoCH Bullish':'Neutral',hasBOS,bosType,inBullOB:inDiscount,inBearOB:inPremium,inBullFVG:pricePos<0.2,hasCHoCH,zone,premiumDiscount:zone,pricePos:+pricePos.toFixed(3)};
  };

  // ── Elliott Wave ──────────────────────────────────────
  const elliottWave = (rsi, macd, ch24, ch7d, pricePos, price, ema200, hasKlines) => {
    const trend=price>ema200?'UP':'DOWN';
    let wave,conf,desc,nextBull=null,nextBear=null;
    if (trend==='UP') {
      if(rsi<35&&(ch7d>3||ch24>0)){wave='Wave 2 Pullback';conf=70;desc='Koreksi dalam uptrend — entry terbaik sebelum Wave 3. RSI oversold.';nextBull=+(price*1.08).toFixed(4);}
      else if(rsi>=42&&rsi<=62&&(macd?.bullish||macd?.crossUp||ch24>0)){wave='Wave 3 — Impulse';conf=78;desc='Fase terkuat. Target 1.618x Wave 1. Volume konfirmasi entry.';nextBull=+(price*1.10).toFixed(4);}
      else if(rsi>65&&ch7d>15&&!(macd?.divergence)){wave='Wave 5 In Progress';conf=60;desc='Akhir impulse. Partial profit. Watch RSI divergence.';nextBull=+(price*1.04).toFixed(4);}
      else if(rsi>70&&hasKlines){wave='Wave 5 Ending';conf=68;desc='Divergence RSI — kemungkinan akhir impuls. Kurangi posisi.';nextBear=+(price*0.92).toFixed(4);}
      else if(ch24<-2&&rsi<55&&ch7d>0){wave='Wave 4 Correction';conf=65;desc='Koreksi sebelum leg terakhir. Support di EMA. Jangan FOMO.';nextBull=+(price*1.06).toFixed(4);}
      else{wave='Impulse Building';conf=55;desc='Struktur bullish dalam progress. Wait konfirmasi.';nextBull=+(price*1.05).toFixed(4);}
    } else {
      if(rsi<28){wave='Wave C Capitulation';conf=72;desc='Oversold ekstrem. Near-term bottom potential. Tunggu candle reversal.';nextBull=+(price*1.12).toFixed(4);}
      else if(rsi<38&&ch24>0){wave='Wave C Complete';conf=68;desc='Oversold + reversal 24h. Potensi bottom. Entry dengan stop.';nextBull=+(price*1.08).toFixed(4);}
      else if(ch24>3&&ch7d<0){wave='Wave C → CHoCH';conf=65;desc='Daily naik dalam tren mingguan turun. Structure shift awal.';nextBull=+(price*1.06).toFixed(4);}
      else if(rsi<45&&ch7d<-8){wave='Wave A/C Bearish';conf=68;desc='Penurunan aktif. Hindari catch falling knife.';nextBear=+(price*0.90).toFixed(4);}
      else{wave='Corrective Phase';conf=50;desc='Koreksi/sideways. Tunggu breakout volume.';nextBull=null;}
    }
    return{wave,confidence:conf,description:desc,nextBullTarget:nextBull,nextBearTarget:nextBear};
  };

  // ── Chart Patterns ────────────────────────────────────
  const detectPatterns = (K, price, high, low, ch24, pricePos) => {
    const patterns=[];
    const open=price/(1+ch24/100)||price;
    const range=high-low;
    if(range>0){
      const body=Math.abs(price-open);
      const lw=Math.min(price,open)-low;
      const uw=high-Math.max(price,open);
      const bodyR=body/range,lwR=lw/range,uwR=uw/range;
      if(lwR>0.58&&bodyR<0.28&&pricePos<0.5) patterns.push({name:'🔨 Hammer / Pin Bar',signal:'bullish',winRate:76,desc:'Buyers rejected low. Demand zone active.'});
      if(uwR>0.58&&bodyR<0.28&&pricePos>0.5) patterns.push({name:'⭐ Shooting Star',signal:'bearish',winRate:75,desc:'Sellers rejected high. Supply zone active.'});
      if(bodyR>0.72&&ch24>3) patterns.push({name:'🐂 Bull Marubozu',signal:'bullish',winRate:77,desc:'Strong momentum candle — no wicks, full buying.'});
      if(bodyR>0.72&&ch24<-3) patterns.push({name:'🐻 Bear Marubozu',signal:'bearish',winRate:77,desc:'Strong selling momentum — institutional distribution.'});
      if(bodyR<0.08) patterns.push({name:'⚖️ Doji — Indecision',signal:'neutral',winRate:0,desc:'Market uncertain. Watch next candle for direction.'});
    }
    if(K&&K.length>=3){
      const n=K.length,C=K[n-1],P=K[n-2],P2=K[n-3];
      if(P.c<P.o&&C.c>C.o&&C.o<=P.c&&C.c>=P.o&&Math.abs(C.c-C.o)>Math.abs(P.c-P.o)*1.1) patterns.push({name:'🐂 Bullish Engulfing',signal:'bullish',winRate:78,desc:'Buyers absorbed all selling. Strong reversal signal.'});
      if(P.c>P.o&&C.c<C.o&&C.o>=P.c&&C.c<=P.o&&Math.abs(C.c-C.o)>Math.abs(P.c-P.o)*1.1) patterns.push({name:'🐻 Bearish Engulfing',signal:'bearish',winRate:78,desc:'Sellers absorbed all buying. Distribution signal.'});
      if(P2.c<P2.o&&Math.abs(P.c-P.o)<Math.abs(P2.c-P2.o)*0.35&&C.c>C.o&&C.c>(P2.o+P2.c)/2) patterns.push({name:'🌟 Morning Star',signal:'bullish',winRate:78,desc:'3-candle bullish reversal — selling exhaustion.'});
      if(P2.c>P2.o&&Math.abs(P.c-P.o)<Math.abs(P2.c-P2.o)*0.35&&C.c<C.o&&C.c<(P2.o+P2.c)/2) patterns.push({name:'🌆 Evening Star',signal:'bearish',winRate:78,desc:'3-candle bearish reversal — buying exhaustion.'});
      if(P2.c>P2.o&&P.c>P.o&&C.c>C.o&&P.c>P2.c&&C.c>P.c) patterns.push({name:'⚔️ 3 White Soldiers',signal:'bullish',winRate:83,desc:'3 consecutive bullish — institutional momentum.'});
      if(P2.c<P2.o&&P.c<P.o&&C.c<C.o&&P.c<P2.c&&C.c<P.c) patterns.push({name:'🐦 3 Black Crows',signal:'bearish',winRate:83,desc:'3 consecutive bearish — institutional distribution.'});
      if(K.length>=8){const pr=K[n-7]?.c||K[n-1].c;const pm=(K[n-3].c-pr)/pr*100;const fl=Math.max(...K.slice(-4).map(k=>k.h))-Math.min(...K.slice(-4).map(k=>k.l));if(pm>6&&fl/C.c*100<4&&C.c>pr*0.97) patterns.push({name:'🏴 Bull Flag',signal:'bullish',winRate:85,desc:`Tight consolidation after +${pm.toFixed(1)}% impulse. Breakout target +${(pm*0.8).toFixed(1)}%.`});}
    }
    // Estimate from ch7d
    if(patterns.length===0){
      if(ch24>0&&pricePos<0.2) patterns.push({name:'🔄 Double Bottom Proxy',signal:'bullish',winRate:75,desc:'Price at low with reversal. Potential accumulation.'});
      else if(ch24>3&&pricePos>0.85) patterns.push({name:'🚀 Breakout',signal:'bullish',winRate:80,desc:'Near high with positive momentum.'});
    }
    return patterns.filter(p=>p.winRate>=75).sort((a,b)=>b.winRate-a.winRate).slice(0,3);
  };

  // ── Recommendation ────────────────────────────────────
  const makeRec = (score, rsi, macd, smc, ew, bb, atr) => {
    const prob=Math.max(1,Math.min(99,50+score*5));
    let action;
    if(score>=5)action='🟢 STRONG BUY';else if(score>=3)action='🟢 BUY';else if(score>=1)action='🟡 MILD BUY';
    else if(score<=-5)action='🔴 STRONG SELL';else if(score<=-3)action='🔴 SELL';else if(score<=-1)action='🔴 MILD SELL';else action='⚖️ NEUTRAL/WAIT';
    const reasons=[],warnings=[];
    if(rsi<30)reasons.push(`RSI ${rsi} oversold — reversal zone kuat`);else if(rsi>70)warnings.push(`RSI ${rsi} overbought`);
    if(macd?.crossUp)reasons.push('MACD golden cross — new momentum');
    if(macd?.crossDown)warnings.push('MACD death cross ⚠️');
    if(smc?.hasBOS&&smc?.bosType?.includes('Bull'))reasons.push(`${smc.bosType} — institutional breakout`);
    if(smc?.inBullOB)reasons.push(`Bull OB ${smc.bullOBLevel?'$'+smc.bullOBLevel:''} — demand zone`);
    if(smc?.inBearOB)warnings.push(`Bear OB ${smc.bearOBLevel?'$'+smc.bearOBLevel:''} — supply zone`);
    if(bb?.squeeze)reasons.push('BB squeeze — volatility breakout imminent');
    if(ew?.wave?.includes('Wave 3'))reasons.push(`${ew.wave} — strongest phase`);
    if(macd?.divergence)warnings.push('MACD divergence');
    return{action,explanation:`${action}. Probability: ${prob}%.`,probability:prob,score,reasons:reasons.slice(0,5),warnings:warnings.slice(0,3)};
  };

  // ── ASTRO ─────────────────────────────────────────────
  const getAstro = () => {
    const jd=Date.now()/86400000+2440587.5;
    const dnm=((jd-2460320.5)%29.53058867+29.53058867)%29.53058867;
    const ph=[[1.5,'New Moon','🌑'],[8.5,'First Quarter','🌓'],[16,'Full Moon','🌕'],[22,'Waning','🌖'],[29.5,'Waning Crescent','🌘']];
    let moonPhase='Dark Moon',moonEmoji='🌑';
    for(const[l,p,e]of ph)if(dnm<l){moonPhase=p;moonEmoji=e;break;}
    const dsh=Math.floor((Date.now()-1713571200000)/86400000);
    return{moonPhase,moonEmoji,halvingPhase:dsh<365?'Bull Early 🔥':dsh<480?'Bull Peak ⚡':dsh<730?'Distribution ⚠️':'Accumulation 🌱',daysSinceHalving:dsh};
  };

  // ── FULL ANALYSIS (from klines) ───────────────────────
  const analyzeFromKlines = (sym, K4h, K1h, price, ch24, vol, astro) => {
    if (!K4h||K4h.length<16) return null;
    const n=K4h.length;
    const closes=K4h.map(k=>k.c);
    const p24=K1h?.length>=6?K1h[K1h.length-6].c:K4h[n-6]?.c||price;
    const ch24calc=p24>0?+((price-p24)/p24*100).toFixed(2):ch24;
    const rsi4h=RSI14(closes);
    const rsi1h=K1h?.length>=16?RSI14(K1h.map(k=>k.c)):rsi4h;
    const macd4h=MACD(closes);
    const bb4h=BB(closes,20);
    const atr4h=ATR(K4h,14);
    const ema9=EMA(closes,9),ema21=EMA(closes,21),ema50=EMA(closes,Math.min(50,n-1)),ema200=EMA(closes,Math.min(200,n-1));
    const high24=Math.max(...K4h.slice(-6).map(k=>k.h));
    const low24=Math.min(...K4h.slice(-6).map(k=>k.l));
    const pricePos=high24>low24?(price-low24)/(high24-low24):0.5;
    const smc=smcFromKlines(K4h,price);
    const ew=elliottWave(rsi4h,macd4h,ch24calc,0,pricePos,price,ema200,true);
    const pats=detectPatterns(K4h,price,high24,low24,ch24calc,pricePos);
    const trend4h=price>ema50?'BULLISH':price<ema50?'BEARISH':'NEUTRAL';
    const trend1h=rsi1h>55?'BULLISH':rsi1h<45?'BEARISH':'NEUTRAL';
    let score=0;
    if(price>ema9)score++;if(price>ema21)score++;if(price>ema50)score++;if(price>ema200)score+=2;
    if(macd4h.bullish)score++;if(macd4h.crossUp)score+=2;if(macd4h.crossDown)score-=2;
    if(rsi4h<30)score+=2;else if(rsi4h>70)score-=2;else if(rsi4h>55)score++;
    if(smc.inBullOB)score+=2;if(smc.inBearOB)score-=2;if(smc.hasBOS&&smc.bosType?.includes('Bull'))score+=2;
    const rec=makeRec(score,rsi4h,macd4h,smc,ew,bb4h,atr4h);
    const pv=K4h[n-2]||K4h[n-1];const P=(pv.h+pv.l+pv.c)/3;
    const pivot={P:+P.toFixed(4),R1:+(2*P-pv.l).toFixed(4),R2:+(P+pv.h-pv.l).toFixed(4),S1:+(2*P-pv.h).toFixed(4),S2:+(P-(pv.h-pv.l)).toFixed(4)};
    const hs=K4h.slice(-30).map(k=>k.h).sort((a,b)=>b-a);
    const ls=K4h.slice(-30).map(k=>k.l).sort((a,b)=>a-b);
    const res=hs.find(h=>h>price)||price*1.05;
    const sup=ls.find(l=>l<price)||price*0.95;
    const atrVal=atr4h.atr||price*0.02;
    const isLong=score>0;
    const slRef=isLong?Math.min(...(smc.swingLows||[price*0.97]),price-atrVal*1.5):Math.max(...(smc.swingHighs||[price*1.03]),price+atrVal*1.5);
    const risk=Math.abs(price-slRef);
    const setup={direction:isLong?'LONG':'SHORT',entry:+price.toFixed(6),sl:+slRef.toFixed(6),tp1:+(price+(isLong?1:-1)*risk*2).toFixed(6),tp2:+(price+(isLong?1:-1)*risk*3.5).toFixed(6),tp3:+(price+(isLong?1:-1)*risk*5).toFixed(6),riskPct:+Math.abs((price-slRef)/price*100).toFixed(2),rrRatio:2};
    return{symbol:sym+'USDT',ticker:sym,price:+price.toFixed(8),change24h:ch24calc,volume24h:+vol.toFixed(0),dataSource:'CryptoCompare (Full Analysis)',rsi:{'1h':rsi1h,'4h':rsi4h},macd:{'4h':macd4h},bb:{'4h':bb4h},atr:{'4h':atr4h},ema:{9:+ema9.toFixed(4),21:+ema21.toFixed(4),50:+ema50.toFixed(4),200:+ema200.toFixed(4)},smc:{'4H':smc},elliottWave:{'4H':ew},chartPatterns:pats,pivotPoints:{'4H':pivot},keyLevels:{support:+sup.toFixed(4),resistance:+res.toFixed(4)},timeframes:{'1H':{rsi:rsi1h,trend:trend1h},'4H':{rsi:rsi4h,trend:trend4h,ema50:+ema50.toFixed(4),ema200:+ema200.toFixed(4)}},tradeSetup:setup,recommendation:rec,confluence:{probability:rec.probability,signal:rec.action},summary:{bias:score>0?'BULLISH':score<0?'BEARISH':'NEUTRAL',oneLiner:`${rec.action} | ${ew.wave} | RSI ${rsi4h} | ${smc.signal}`},astrology:astro,candleCount:{'4H':K4h.length,'1H':K1h?.length||0}};
  };

  // ── LITE ANALYSIS (from CoinGecko basic data) ────────
  const analyzeFromBasic = (sym, cgData, astro) => {
    const price=cgData.current_price||0;
    const ch24=cgData.price_change_percentage_24h||0;
    const ch7d=cgData.price_change_percentage_7d||0;
    const vol=cgData.total_volume||0;
    const high=cgData.high_24h||price*1.02;
    const low=cgData.low_24h||price*0.98;
    const mcap=cgData.market_cap||0;
    const pricePos=high>low?(price-low)/(high-low):0.5;
    const range=high>low?(high-low)/price*100:0;
    const estRSI=Math.max(10,Math.min(90,50+ch24*2.5+(pricePos-0.5)*25));
    const smc=smcFromBasic(price,high,low,ch24,ch7d,vol);
    const fakeEMA200=price/(1+(ch7d/100)*0.3);
    const ew=elliottWave(estRSI,null,ch24,ch7d,pricePos,price,fakeEMA200,false);
    const pats=detectPatterns(null,price,high,low,ch24,pricePos);
    let score=0;
    if(ch24>5)score+=2;else if(ch24>2)score++;else if(ch24<-5)score-=2;else if(ch24<-2)score--;
    if(ch7d>10)score+=2;else if(ch7d>4)score++;else if(ch7d<-10)score-=2;else if(ch7d<-4)score--;
    if(estRSI<30)score+=2;else if(estRSI>70)score-=2;else if(estRSI>55)score++;
    if(smc.inBullOB)score++;if(smc.inBearOB)score--;
    if(pats.some(p=>p.signal==='bullish'))score++;if(pats.some(p=>p.signal==='bearish'))score--;
    const prob=Math.max(5,Math.min(95,50+score*7));
    const action=score>=4?'🟢 STRONG BUY':score>=2?'🟢 BUY':score>=1?'🟡 MILD BUY':score<=-4?'🔴 STRONG SELL':score<=-2?'🔴 SELL':score<=-1?'🔴 MILD SELL':'⚖️ NEUTRAL/WAIT';
    const reasons=[];
    if(estRSI<30) reasons.push(`RSI ~${estRSI.toFixed(0)} oversold — reversal zone`);
    if(ch24>5)    reasons.push(`+${ch24.toFixed(1)}% 24h momentum`);
    if(ch7d>10)   reasons.push(`+${ch7d.toFixed(1)}% 7d trend`);
    if(smc.inBullOB) reasons.push('Discount zone — potential demand area');
    pats.forEach(p=>reasons.push(`${p.name} (${p.winRate}%): ${p.desc}`));
    const sl=smc.inBullOB?+(low*0.97).toFixed(6):+(low*0.98).toFixed(6);
    const risk=Math.abs(price-sl);
    const setup={direction:score>0?'LONG':'SHORT',entry:+price.toFixed(6),sl,tp1:+(price+risk*2).toFixed(6),tp2:+(price+risk*3.5).toFixed(6),tp3:+(price+risk*5).toFixed(6),riskPct:+Math.abs((price-sl)/price*100).toFixed(2),rrRatio:2,note:'TP/SL estimated (no klines data)'};
    return{symbol:sym+'USDT',ticker:sym,name:cgData.name||sym,price,change24h:+ch24.toFixed(2),change7d:+ch7d.toFixed(2),volume24h:vol,mcap,dataSource:`CoinGecko (Lite Analysis — no klines)`,rsi:{'4h':+estRSI.toFixed(1),'1h':+estRSI.toFixed(1),'1d':+estRSI.toFixed(1)},macd:{'4h':{bullish:ch24>0&&ch7d>0,bearish:ch24<0,crossUp:ch24>3&&ch7d<0,crossDown:ch24<-3&&ch7d>0}},smc:{'4H':smc},elliottWave:{'4H':ew},chartPatterns:pats,keyLevels:{support:+low.toFixed(6),resistance:+high.toFixed(6)},tradeSetup:setup,recommendation:{action,probability:prob,score,reasons:reasons.slice(0,5),warnings:estRSI>70?['RSI overbought — avoid FOMO']:[]},confluence:{probability:prob,signal:action},summary:{bias:score>0?'BULLISH':score<0?'BEARISH':'NEUTRAL',oneLiner:`${action} | ${ew.wave} | RSI ~${estRSI.toFixed(0)}`},astrology:astro,note:'Analisis berbasis CoinGecko data. Untuk full TA, gunakan koin yang ada di CryptoCompare.'};
  };

  // ── MAIN EXECUTION ────────────────────────────────────
  try {
    const sym = raw;
    const astro = getAstro();

    // Step 1: Try CryptoCompare (full klines)
    const [cc4hR, cc1hR, byTickR] = await Promise.allSettled([
      sf(`https://min-api.cryptocompare.com/data/v2/histohour?fsym=${sym}&tsym=USD&limit=60&aggregate=4&e=CCCAGG`, 6000),
      sf(`https://min-api.cryptocompare.com/data/v2/histohour?fsym=${sym}&tsym=USD&limit=48&aggregate=1&e=CCCAGG`, 5000),
      sf(`https://api.bybit.com/v5/market/tickers?category=linear&symbol=${sym}USDT`, 4000),
    ]);

    const parseCC = (r) => {
      if (!r||r?.Response!=='Success') return [];
      return (r?.Data?.Data||[]).filter(d=>d.close>0).map(d=>({t:d.time,o:+d.open,h:+d.high,l:+d.low,c:+d.close,v:+(d.volumeto||0)}));
    };

    const K4h = cc4hR.status==='fulfilled' ? parseCC(cc4hR.value) : [];
    const K1h = cc1hR.status==='fulfilled' ? parseCC(cc1hR.value) : [];
    const byTick = byTickR.status==='fulfilled' ? byTickR.value?.result?.list?.[0] : null;

    if (K4h.length >= 16) {
      // Full analysis available
      const price = byTick?.lastPrice ? +byTick.lastPrice : K4h[K4h.length-1].c;
      const vol   = K1h.length>=24 ? K1h.slice(-24).reduce((s,k)=>s+k.v,0) : 0;
      const result = analyzeFromKlines(sym, K4h, K1h, price, 0, vol, astro);
      if (result) return res.status(200).json({ok:true,ts:Date.now(),elapsed:Date.now()-t0,version:'v17',...result});
    }

    // Step 2: Fallback to CoinGecko search
    const cgSearchR = await sf(`https://api.coingecko.com/api/v3/search?query=${sym}`, 4000);
    const cgCoins = cgSearchR?.coins || [];
    // Find best match (exact symbol or first result)
    const cgMatch = cgCoins.find(c=>c.symbol?.toUpperCase()===sym) || cgCoins.find(c=>c.symbol?.toUpperCase()===sym.slice(0,3)) || cgCoins[0];

    if (!cgMatch) {
      return res.status(200).json({ok:false,error:`Symbol ${sym} tidak ditemukan di CryptoCompare maupun CoinGecko. Coba: BTC, ETH, SOL, RON, HYPE`,price:0,symbol:sym+'USDT',ts:Date.now(),version:'v17'});
    }

    // Fetch market data for this coin
    const cgDataR = await sf(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${cgMatch.id}&sparkline=false&price_change_percentage=24h,7d`, 5000);
    const cgData  = Array.isArray(cgDataR) ? cgDataR[0] : null;

    if (!cgData||!cgData.current_price) {
      return res.status(200).json({ok:false,error:`Data market untuk ${sym} (${cgMatch.name}) tidak tersedia.`,price:0,symbol:sym+'USDT',ts:Date.now(),version:'v17'});
    }

    // Lite analysis from CoinGecko
    const result = analyzeFromBasic(sym, cgData, astro);
    return res.status(200).json({ok:true,ts:Date.now(),elapsed:Date.now()-t0,version:'v17',...result});

  } catch(e) {
    return res.status(200).json({ok:false,error:e.message,price:0,symbol:raw+'USDT',ts:Date.now(),version:'v17'});
  }
}
