// api/scanner-full.js — v16 INSTITUTIONAL SCANNER
// Sumber: MEXC tickers (tidak diblokir) + CryptoCompare RSI top coins
// Filter: SMC OB/FVG + Volume Breakout + Elliott Wave + Multi-TF

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=45, stale-while-revalidate=20');
  if (req.method === 'OPTIONS') return res.status(200).end();
  const t0 = Date.now();

  const sf = async (url, ms) => {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), ms);
    try {
      const r = await fetch(url, { signal:c.signal, headers:{ Accept:'application/json','User-Agent':'AC369/1.0' } });
      clearTimeout(t); if(!r.ok) return null; return await r.json();
    } catch { clearTimeout(t); return null; }
  };

  // ── TA HELPERS ────────────────────────────────────────────
  const EMA = (a,p) => {
    if(!a||a.length<2) return a?.[a.length-1]||0;
    const k=2/(p+1); let e=a.slice(0,Math.min(p,a.length)).reduce((s,v)=>s+v,0)/Math.min(p,a.length);
    for(let i=Math.min(p,a.length);i<a.length;i++)e=a[i]*k+e*(1-k);
    return +e.toFixed(8);
  };

  const RSI14 = (a) => {
    if(!a||a.length<16) return null;
    let ag=0,al=0;
    for(let i=1;i<=14;i++){const d=a[i]-a[i-1];d>0?ag+=d:al-=d;}
    ag/=14;al/=14;
    for(let i=15;i<a.length;i++){const d=a[i]-a[i-1];ag=(ag*13+Math.max(d,0))/14;al=(al*13+Math.max(-d,0))/14;}
    return al===0?100:+(100-100/(1+ag/al)).toFixed(2);
  };

  const MACD_SIG = (a) => {
    if(!a||a.length<36) return {bull:false,bear:false,xUp:false,xDown:false};
    const k12=2/13,k26=2/27,k9=2/10;
    let e12=a.slice(0,12).reduce((s,v)=>s+v,0)/12, e26=a.slice(0,26).reduce((s,v)=>s+v,0)/26;
    const mv=[];
    for(let i=26;i<a.length;i++){e12=a[i]*k12+e12*(1-k12);e26=a[i]*k26+e26*(1-k26);mv.push(e12-e26);}
    let sig=mv.slice(0,9).reduce((s,v)=>s+v,0)/9;
    for(let i=9;i<mv.length;i++)sig=mv[i]*k9+sig*(1-k9);
    const last=mv[mv.length-1],prev=mv[mv.length-2]||last,hist=last-sig,prevH=prev-sig;
    return{bull:last>0&&hist>0,bear:last<0&&hist<0,xUp:hist>0&&prevH<=0,xDown:hist<0&&prevH>=0};
  };

  const ATR14 = (K) => {
    if(!K||K.length<3) return 0;
    const tr=K.slice(1).map((k,i)=>Math.max(k.h-k.l,Math.abs(k.h-K[i].c),Math.abs(k.l-K[i].c)));
    return tr.slice(-14).reduce((s,v)=>s+v,0)/Math.min(14,tr.length);
  };

  // Quick SMC from klines
  const quickSMC = (K,price) => {
    if(!K||K.length<10) return {signal:'Neutral',hasBOS:false,hasCHoCH:false,inBullOB:false,inBearOB:false,inBullFVG:false,score:0};
    const n=K.length;
    // BOS
    const recentH=Math.max(...K.slice(-15).map(k=>k.h));
    const recentL=Math.min(...K.slice(-15).map(k=>k.l));
    const prevH=Math.max(...K.slice(-30,-15).map(k=>k.h));
    const prevL=Math.min(...K.slice(-30,-15).map(k=>k.l));
    const hasBOS=(price>recentH&&recentH>prevH)||(price<recentL&&recentL<prevL);
    const bosType=price>recentH?'Bull':'Bear';
    // OB
    let inBullOB=false,inBearOB=false;
    for(let i=n-12;i<n-3;i++){if(i<0)continue;
      const k=K[i],nxt=K[i+1];
      if(k.c<k.o&&nxt.c>nxt.o&&nxt.c>k.o){const obH=Math.max(k.o,k.c),obL=Math.min(k.o,k.c);if(price>=obL*0.998&&price<=obH*1.005)inBullOB=true;}
      if(k.c>k.o&&nxt.c<nxt.o&&nxt.c<k.o){const obH=Math.max(k.o,k.c),obL=Math.min(k.o,k.c);if(price>=obL*0.997&&price<=obH*1.002)inBearOB=true;}
    }
    // FVG
    let inBullFVG=false,inBearFVG=false;
    for(let i=n-10;i<n-2;i++){if(i<0)continue;
      if(K[i+2].l-K[i].h>0&&price>=K[i].h&&price<=K[i+2].l) inBullFVG=true;
      if(K[i].l-K[i+2].h>0&&price>=K[i+2].h&&price<=K[i].l) inBearFVG=true;
    }
    const bs=(hasBOS&&bosType==='Bull'?2:0)+(inBullOB?2:0)+(inBullFVG?1:0);
    const be=(hasBOS&&bosType==='Bear'?2:0)+(inBearOB?2:0)+(inBearFVG?1:0);
    return{signal:bs>be?'Bullish':be>bs?'Bearish':'Neutral',hasBOS,hasCHoCH:false,bosType:hasBOS?bosType:'None',inBullOB,inBearOB,inBullFVG,inBearFVG,score:bs-be};
  };

  // Quick Elliott Wave from RSI+trend
  const quickEW = (closes,rsi,price,ema200) => {
    if(!closes||closes.length<20||rsi===null) return {wave:'Unknown',confidence:0};
    const trend=price>ema200?'UP':'DOWN';
    if(trend==='UP'){
      if(rsi<35) return{wave:'Wave 2 Pullback',confidence:68};
      if(rsi>=45&&rsi<=62) return{wave:'Wave 3 — Impulse',confidence:75};
      if(rsi>70){
        const recent20=closes.slice(-20),max20=Math.max(...recent20);
        const prevMaxRsi=RSI14(closes.slice(-30,-10));
        if(price>=max20*0.995&&prevMaxRsi&&rsi<prevMaxRsi-5) return{wave:'Wave 5 Ending — Divergence',confidence:72};
        return{wave:'Wave 5 In Progress',confidence:58};
      }
      return{wave:'Wave 4 Correction',confidence:55};
    } else {
      if(rsi<30) return{wave:'Wave C Capitulation',confidence:70};
      if(rsi<45) return{wave:'Wave A/C Bearish',confidence:62};
      return{wave:'Corrective Phase',confidence:48};
    }
  };

  // Candle pattern signal
  const candleSignal = (K) => {
    if(!K||K.length<2) return 'Neutral';
    const last=K[K.length-1],prev=K[K.length-2];
    const b=Math.abs(last.c-last.o),r=last.h-last.l;
    if(r===0) return 'Neutral';
    const lw=Math.min(last.c,last.o)-last.l,uw=last.h-Math.max(last.c,last.o);
    if(lw/r>0.6&&b/r<0.3) return 'Hammer 🔨';
    if(uw/r>0.6&&b/r<0.3) return 'Shooting Star ⭐';
    if(b/r>0.8) return last.c>last.o?'Bull Marubozu 🐂':'Bear Marubozu 🐻';
    if(prev.c<prev.o&&last.c>last.o&&last.o<prev.c&&last.c>prev.o) return 'Bull Engulfing 🐂';
    if(prev.c>prev.o&&last.c<last.o&&last.o>prev.c&&last.c<prev.o) return 'Bear Engulfing 🐻';
    if(b/r<0.1) return 'Doji ⚖️';
    return last.c>last.o?'Bullish Candle':'Bearish Candle';
  };

  // Trend alignment string
  const trendAlign = (t1h,t4h,t1d) => {
    const bs=[t1h,t4h,t1d].filter(t=>t==='BULLISH').length;
    const be=[t1h,t4h,t1d].filter(t=>t==='BEARISH').length;
    if(bs===3) return{label:'🚀 FULL SEND',color:'full-bull'};
    if(bs>=2) return{label:'📈 STRONG BULL',color:'bull'};
    if(be===3) return{label:'💀 FULL BEAR',color:'full-bear'};
    if(be>=2) return{label:'📉 STRONG BEAR',color:'bear'};
    return{label:'⚖️ SIDEWAYS',color:'neutral'};
  };

  // ── ASTRO CONTEXT ─────────────────────────────────────────
  const getAstro = () => {
    const jd=Date.now()/86400000+2440587.5;
    const dnm=((jd-2460320.5)%29.53058867+29.53058867)%29.53058867;
    const phases=[[1.5,'New Moon','🌑'],[8.5,'First Quarter','🌓'],[16,'Full Moon','🌕'],[22,'Waning','🌖'],[29.5,'Waning Crescent','🌘']];
    let moonPhase='Dark Moon',moonEmoji='🌑';
    for(const[lim,ph,em]of phases)if(dnm<lim){moonPhase=ph;moonEmoji=em;break;}
    const dsh=Math.floor((Date.now()-1713571200000)/86400000);
    const halvPhase=dsh<365?'Bull Early 🔥':dsh<480?'Bull Peak ⚡':dsh<730?'Distribution ⚠️':'Accumulation 🌱';
    return{moonPhase,moonEmoji,halvingPhase:halvPhase,daysSinceHalving:dsh,chaotic:moonPhase==='Full Moon'||moonPhase==='New Moon'};
  };

  // ── FILTER CONSTANTS ──────────────────────────────────────
  const STABLES=new Set(['USDT','USDC','BUSD','DAI','TUSD','USDP','FDUSD','USDD','GUSD','FRAX','BIDR','EUR','GBP']);
  const IGNORE=new Set(['BTCDOMUSDT','DEFIUSDT','USDCUSDT','PERPUSDT']);
  const NO_SFX=['UP','DOWN','BULL','BEAR','LONG','SHORT','3L','3S','5L','5S'];

  // ── FETCH TICKERS ─────────────────────────────────────────
  const [tickR,fngR] = await Promise.allSettled([
    (async()=>{
      const mx=await sf('https://api.mexc.com/api/v3/ticker/24hr',9000);
      if(Array.isArray(mx)&&mx.length>100)return{data:mx.filter(t=>t?.symbol?.endsWith('USDT')),src:'MEXC'};
      const by=await sf('https://api.bybit.com/v5/market/tickers?category=spot',8000);
      if(by?.result?.list?.length>50)return{data:by.result.list.filter(t=>t?.symbol?.endsWith('USDT')).map(t=>({symbol:t.symbol,lastPrice:t.lastPrice,priceChangePercent:t.price24hPcnt?+(+t.price24hPcnt*100).toFixed(4):0,quoteVolume:t.turnover24h||'0',highPrice:t.highPrice24h||t.lastPrice,lowPrice:t.lowPrice24h||t.lastPrice,openPrice:t.prevPrice24h||t.lastPrice})),src:'Bybit'};
      return null;
    })(),
    sf('https://api.alternative.me/fng/?limit=1&format=json',4000),
  ]);

  const rawTickers=tickR.status==='fulfilled'?tickR.value?.data:[];
  const srcName=tickR.status==='fulfilled'?tickR.value?.src||'unknown':'unknown';
  const fg=fngR.status==='fulfilled'?parseInt(fngR.value?.data?.[0]?.value||50):50;

  if(!rawTickers?.length){
    return res.status(200).json({ok:false,error:'Ticker data tidak tersedia',ts:Date.now(),totalScanned:0,totalQualified:0,results:[],topSetups:{institutional:[],fullSend:[],highProbBull:[],smcSetups:[],ewSetups:[],volumeBreakout:[],strongSell:[]},marketOverview:{marketMood:'UNKNOWN',bullishCount:0,bearishCount:0,avgChange24h:0},astroContext:getAstro()});
  }

  // ── FILTER QUALIFYING TICKERS ─────────────────────────────
  const qualify = rawTickers.filter(t=>{
    if(!t?.symbol?.endsWith('USDT')) return false;
    if(IGNORE.has(t.symbol)) return false;
    const b=t.symbol.replace('USDT','');
    if(STABLES.has(b)) return false;
    if(NO_SFX.some(p=>b.endsWith(p)||b.startsWith(p))) return false;
    if(b.length>12) return false;
    const p=+(t.lastPrice||0),v=+(t.quoteVolume||0);
    if(p<=0||v<2e6) return false; // min $2M volume
    if(p>=0.97&&p<=1.03&&Math.abs(+(t.priceChangePercent||0))<0.5) return false;
    return true;
  });

  const totalScanned=qualify.length;

  // Sort by volume, take top 235 for deep analysis
  const topByVol=qualify.sort((a,b)=>+(b.quoteVolume||0)-+(a.quoteVolume||0)).slice(0,235);

  // ── RSI BATCH from CryptoCompare (top 40 coins) ───────────
  const rsiMap={};
  const rsiTop=topByVol.slice(0,40).map(t=>t.symbol.replace('USDT',''));

  const ccKlines = await Promise.allSettled(
    rsiTop.map(sym=>sf(`https://min-api.cryptocompare.com/data/v2/histohour?fsym=${sym}&tsym=USD&limit=56&aggregate=4&e=CCCAGG`,5500))
  );

  ccKlines.forEach((r,i)=>{
    if(r.status!=='fulfilled'||r.value?.Response!=='Success') return;
    const raw4h=r.value.Data?.Data; if(!raw4h||raw4h.length<16) return;
    const K=raw4h.filter(d=>d.close>0).map(d=>({t:d.time,o:+d.open,h:+d.high,l:+d.low,c:+d.close,v:+(d.volumeto||0)}));
    if(K.length<16) return;
    const closes=K.map(k=>k.c);
    const rsi=RSI14(closes);
    if(rsi===null) return;
    const ema9=EMA(closes,9),ema21=EMA(closes,21),ema50=EMA(closes,Math.min(50,closes.length-1)),ema200=EMA(closes,Math.min(200,closes.length-1));
    const macd=MACD_SIG(closes);
    const atr=ATR14(K);
    const smc=quickSMC(K,closes[closes.length-1]);
    const ewv=quickEW(closes,rsi,closes[closes.length-1],ema200);
    const candle=candleSignal(K);
    rsiMap[rsiTop[i]]={rsi,rsi4h:rsi,K,closes,ema9,ema21,ema50,ema200,macd,atr,smc,ew:ewv,candle,hasFullData:true};
  });

  // ── SCORE EACH COIN ────────────────────────────────────────
  const astro=getAstro();
  const results=[];

  topByVol.forEach((t,idx)=>{
    const sym=t.symbol.replace('USDT','');
    const price=+(t.lastPrice||0);
    const ch24=+(t.priceChangePercent||0);
    const vol=+(t.quoteVolume||0);
    const high=+(t.highPrice||price*1.01);
    const low=+(t.lowPrice||price*0.99);
    const open=+(t.openPrice||price);
    if(price<=0) return;

    const body=high>low?Math.abs(price-open)/(high-low):0;
    const vt=vol>=1e9?5:vol>=200e6?4:vol>=50e6?3:vol>=10e6?2:vol>=1e6?1:0;

    // Use full kline data if available
    const kd=rsiMap[sym];
    const rsi=kd?.rsi??Math.max(15,Math.min(85,50+(ch24>0?ch24*2:-ch24*2)));
    const ema200=kd?.ema200||price;
    const ema50=kd?.ema50||price;
    const ema9=kd?.ema9||price;
    const macd=kd?.macd||{bull:ch24>0,bear:ch24<0,xUp:false,xDown:false};
    const atr=kd?.atr||price*0.02;
    const smc4H=kd?.smc||{signal:'Neutral',hasBOS:false,inBullOB:false,inBearOB:false,inBullFVG:false,score:0};
    const ewv=kd?.ew||{wave:'Unknown',confidence:0};
    const candlePat=kd?.candle||candleSignal([{o:open,h:high,l:low,c:price},{o:price*0.99,h:price*1.01,l:price*0.98,c:price}]);

    // Trend per TF
    const t4h=price>ema50&&rsi>50?'BULLISH':price<ema50&&rsi<50?'BEARISH':'NEUTRAL';
    const t1h=rsi>55?'BULLISH':rsi<45?'BEARISH':'NEUTRAL';
    const t1d=price>ema200?'BULLISH':price<ema200*0.97?'BEARISH':'NEUTRAL';
    const ta=trendAlign(t1h,t4h,t1d);

    // Confluence Score
    let score=0;
    if(price>ema9)    score+=1;
    if(price>ema50)   score+=1;
    if(price>ema200)  score+=2;
    if(macd.bull)     score+=1;
    if(macd.xUp)      score+=2;
    if(macd.xDown)    score-=2;
    if(rsi<35)        score+=2;
    else if(rsi<50)   score+=1;
    else if(rsi>65)   score-=1;
    else if(rsi>75)   score-=2;
    if(vt>=3&&ch24>2) score+=1; // Volume + price
    if(smc4H.hasBOS&&smc4H.bosType==='Bull') score+=2;
    if(smc4H.hasBOS&&smc4H.bosType==='Bear') score-=2;
    if(smc4H.inBullOB) score+=2; if(smc4H.inBearOB) score-=2;
    if(smc4H.inBullFVG) score+=1;
    if(ewv.wave?.includes('Wave 3')) score+=2;
    if(ewv.wave?.includes('Wave 2')) score+=1;
    if(ewv.wave?.includes('Wave 5 End')||ewv.wave?.includes('Divergence')) score-=2;

    const probability=Math.max(1,Math.min(99,50+score*5));
    const pcts={signal:ch24,vol24h:vol};

    // Candle pattern
    const patterns=candlePat?[{name:candlePat,signal:ch24>0?'bullish':ch24<0?'bearish':'neutral'}]:[];

    // Build signals text
    const signals=[];
    if(smc4H.inBullOB) signals.push('Bull OB — zona demand aktif');
    if(smc4H.hasBOS&&smc4H.bosType==='Bull') signals.push('BOS Bullish konfirmasi');
    if(smc4H.inBullFVG) signals.push('Bull FVG — gap rebalance');
    if(macd.xUp) signals.push('MACD golden cross ✅');
    if(rsi<32) signals.push(`RSI ${rsi} oversold`);
    if(vt>=4&&Math.abs(ch24)<2) signals.push('Stealth vol — akumulasi diam-diam 👁');
    if(vt>=3&&ch24>5) signals.push(`+${ch24.toFixed(1)}% vol ${['','','','$10M','$50M','$200M'][vt]}+ breakout`);
    if(ewv.wave?.includes('Wave 3')) signals.push(`${ewv.wave} (${ewv.confidence}%)`);
    if(smc4H.inBearOB) signals.push('Bear OB — zona supply aktif ⚠️');
    if(macd.xDown) signals.push('MACD death cross ⚠️');

    results.push({
      rank:idx+1, symbol:sym, price, change24h:+ch24.toFixed(2), volume24h:vol,
      trendAlignment:ta.label, taColor:ta.color,
      trend1h:t1h.slice(0,4), trend4h:t4h.slice(0,4), trend1d:t1d.slice(0,4),
      rsi:rsi, rsi4h:rsi, rsiReal:!!kd?.hasFullData,
      smc:smc4H, elliottWave:ewv,
      chartPatterns:patterns,
      probability, score,
      signals:signals.slice(0,4),
      astrology:{moonPhase:astro.moonPhase,moonEmoji:astro.moonEmoji,halvingPhase:astro.halvingPhase,chaotic:astro.chaotic},
      hasFullData:!!kd?.hasFullData,
      pcts, body:+body.toFixed(3), vt,
    });
  });

  // Sort results by score desc
  results.sort((a,b)=>b.score-a.score||(b.probability-a.probability));
  results.forEach((r,i)=>r.rank=i+1);

  // ── CATEGORIZE TOP SETUPS ──────────────────────────────────
  const institutional = results.filter(r=>r.score>=3&&r.rsi<65&&r.probability>=55&&r.volume24h>=10e6).slice(0,60);
  const fullSend      = results.filter(r=>r.taColor==='full-bull'&&r.probability>=60).slice(0,40);
  const highProbBull  = results.filter(r=>r.probability>=70&&r.score>=3).slice(0,40);
  const smcSetups     = results.filter(r=>(r.smc?.inBullOB||r.smc?.inBullFVG||r.smc?.hasBOS)&&r.score>=2).slice(0,40);
  const ewSetups      = results.filter(r=>r.elliottWave?.wave?.includes('Wave 3')&&r.probability>=55).slice(0,30);
  const volumeBreakout= results.filter(r=>r.vt>=3&&r.change24h>2&&r.body>0.4).sort((a,b)=>b.volume24h-a.volume24h).slice(0,40);
  const strongSell    = results.filter(r=>r.score<=-3||r.taColor==='full-bear').sort((a,b)=>a.score-b.score).slice(0,30);

  // ── MARKET OVERVIEW ───────────────────────────────────────
  const bullish=results.filter(r=>r.score>0).length;
  const bearish=results.filter(r=>r.score<0).length;
  const avgCh=results.length?+(results.reduce((s,r)=>s+r.change24h,0)/results.length).toFixed(2):0;
  const mood=avgCh>3?'STRONG BULL':avgCh>1?'BULL':avgCh<-3?'STRONG BEAR':avgCh<-1?'BEAR':'NEUTRAL';

  return res.status(200).json({
    ok:true, ts:Date.now(), elapsed:Date.now()-t0, version:'v16',
    src:srcName, fg,
    totalScanned, totalQualified:results.length,
    rsiDataCount:Object.keys(rsiMap).length,
    results,
    topSetups:{institutional,fullSend,highProbBull,smcSetups,ewSetups,volumeBreakout,strongSell},
    marketOverview:{marketMood:mood,bullishCount:bullish,bearishCount:bearish,avgChange24h:avgCh,totalCoins:results.length},
    astroContext:astro,
  });
}
