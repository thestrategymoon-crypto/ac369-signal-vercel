// api/onchain.js — v28 · MEXC + Binance Futures + AltMe + BCInfo
// ════════════════════════════════════════════════════════════════
// BTC Price + 24h + High/Low  → MEXC 24hr ticker
// MVRV 200-day MA             → MEXC 200d klines
// Funding Rate                → Binance Futures premiumIndex
// Open Interest               → Binance Futures openInterest
// Long/Short Ratio            → Binance Futures globalLSRatio
// Fear & Greed                → alternative.me
// Hash Rate + Block           → blockchain.info
// Mempool Fee                 → mempool.space
// ════════════════════════════════════════════════════════════════
const CACHE={d:null,t:0};
export default async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Cache-Control','s-maxage=90,stale-while-revalidate=60');
  if(req.method==='OPTIONS')return res.status(200).end();
  const t0=Date.now();
  try{
    if(CACHE.d&&Date.now()-CACHE.t<90000)return res.status(200).json({...CACHE.d,cached:true,elapsed:Date.now()-t0});
    const g=async(url,ms=2800)=>{try{const c=new AbortController(),t=setTimeout(()=>c.abort(),ms);const r=await fetch(url,{signal:c.signal,headers:{Accept:'application/json','User-Agent':'AC369/28'}});clearTimeout(t);return r.ok?await r.json():null}catch{return null}};
    const N=(v,d=0)=>{const n=+v;return isNaN(n)||!isFinite(n)?d:n};
    const A=(v)=>Array.isArray(v)?v:[];

    // ALL PARALLEL — 8 calls, berbeda exchange, max 2.8s
    const[R0,R1,R2,R3,R4,R5,R6,R7]=await Promise.allSettled([
      // BTC price + 24h change + high/low (MEXC 24hr — proven working)
      g('https://api.mexc.com/api/v3/ticker/24hr?symbol=BTCUSDT'),
      // MVRV: 200d daily klines (MEXC)
      g('https://api.mexc.com/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=210'),
      // Funding Rate (Binance Futures)
      g('https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT'),
      // Open Interest (Binance Futures)
      g('https://fapi.binance.com/fapi/v1/openInterest?symbol=BTCUSDT'),
      // Long/Short Ratio (Binance Futures)
      g('https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=BTCUSDT&period=1h&limit=1'),
      // Fear & Greed
      g('https://api.alternative.me/fng/?limit=1&format=json'),
      // Hash Rate + Block Height
      g('https://blockchain.info/stats?format=json',3000),
      // Mempool fee
      g('https://mempool.space/api/v1/fees/recommended'),
    ]);

    // ── BTC PRICE (MEXC 24hr) ────────────────────────────────
    let btcP=0,btcCh=0,btcH24=0,btcL24=0,vol24=0;
    try{
      const m=R0.value;
      if(m&&N(m.lastPrice)>0){
        btcP=N(m.lastPrice);btcCh=+N(m.priceChangePercent).toFixed(2);
        btcH24=N(m.highPrice||btcP*1.02);btcL24=N(m.lowPrice||btcP*0.98);
        vol24=N(m.quoteVolume);
      }
    }catch{}

    // ── MVRV PROXY dari MEXC klines ──────────────────────────
    let mvrv=1.3,mvrvLabel='Fair value',mvrvInterp='',nuplProxy=0.255,soprProxy=1.01,ma200=0;
    try{
      const kl=A(R1.value);
      if(kl.length>=50&&btcP>0){
        // MEXC klines: [openTime, open, high, low, close, vol, closeTime, ...]
        const cls=kl.map(k=>N(k[4])).filter(v=>v>0); // close prices
        const slice=cls.slice(-200);
        ma200=+(slice.reduce((s,v)=>s+v,0)/slice.length).toFixed(0);
        if(ma200>0){
          mvrv=+(btcP/ma200).toFixed(2);
          mvrvInterp=mvrv<0.8?'Di bawah 200MA — strong buy zone':mvrv<1.15?'Dekat 200MA — fair value':mvrv<1.8?'Di atas 200MA — hati-hati':mvrv<2.5?'Signifikan di atas 200MA':'Bubble zone';
          if(mvrv<0.8)mvrvLabel='Undervalued 🟢';
          else if(mvrv<1.15)mvrvLabel='Fair Value ⚪';
          else if(mvrv<1.8)mvrvLabel='Slightly High ⚠️';
          else if(mvrv<2.5)mvrvLabel='Overvalued 🔴';
          else mvrvLabel='Bubble Zone 🔴';
          nuplProxy=+((btcP-ma200)/btcP).toFixed(3);
          const p30d=cls[cls.length-31]||cls[0];
          soprProxy=p30d>0?+(btcP/p30d).toFixed(3):1.01;
        }
      }
    }catch{}

    // ── FUNDING RATE (Binance Futures) ───────────────────────
    let btcFR=0,frPct=0,frAnn=0,frSig='⚖️ Neutral FR';
    try{
      const bf=R2.value;
      if(bf&&bf.lastFundingRate!=null){
        btcFR=N(bf.lastFundingRate);
        frPct=+(btcFR*100).toFixed(4);frAnn=+(frPct*3*365).toFixed(1);
        frSig=btcFR<-0.0008?'🚀 EXTREME SQUEEZE — reversal besar':btcFR<-0.0005?'💎 Short Squeeze setup':btcFR<-0.0002?'↘️ FR Negatif — bearish bayar':btcFR>0.0008?'🚨 OVERHEATED — longs extreme':btcFR>0.0005?'⚠️ Long Heavy':btcFR>0.0002?'↗️ Mild Long':'⚖️ Neutral FR';
      }
    }catch{}

    // ── OPEN INTEREST (Binance Futures) ──────────────────────
    let btcOI=0;
    try{const bo=R3.value;if(bo&&N(bo.openInterest)>0){btcOI=N(bo.openInterest)*btcP;}}catch{}

    // ── LONG/SHORT RATIO (Binance Futures) ───────────────────
    let longPct=null,shortPct=null,lsRatio=null,lsSig='';
    try{
      const ls=A(R4.value)[0]||R4.value;
      if(ls&&ls.longAccount!=null){
        longPct=+(N(ls.longAccount)*100).toFixed(2);
        shortPct=+(100-longPct).toFixed(2);
        lsRatio=shortPct>0?+(longPct/shortPct).toFixed(3):null;
        if(lsRatio)lsSig=lsRatio<0.8?'🚀 Shorts dominan — squeeze':lsRatio<1.1?'⚖️ Balanced':lsRatio<1.8?'↗️ Slight Long':lsRatio<2.5?'⚠️ Long Heavy':'🚨 Extreme Long';
      }
    }catch{}

    // ── FEAR & GREED ──────────────────────────────────────────
    const fgVal=N(R5.value?.data?.[0]?.value,50);
    const fgLabel=R5.value?.data?.[0]?.value_classification||'Neutral';
    const fgInterp=fgVal<=20?'Extreme Fear — akumulasi agresif':fgVal<=35?'Fear — akumulasi bertahap':fgVal<=45?'Fear Ringan — DCA valid':fgVal<=55?'Neutral — selektif':fgVal<=65?'Greed Ringan — hati-hati':fgVal<=80?'Greed — kurangi sizing':'Extreme Greed — exit plan';

    // ── NETWORK ───────────────────────────────────────────────
    let hashRate=0,blockH=0;
    try{const bc=R6.value;if(bc){hashRate=+(N(bc.hash_rate)/1e6).toFixed(1);blockH=N(bc.n_blocks_total)}}catch{}
    let fastFee=2,midFee=1,slowFee=1;
    try{const f=R7.value;if(f){fastFee=N(f.fastestFee);midFee=N(f.halfHourFee||fastFee);slowFee=N(f.hourFee||fastFee)}}catch{}

    // ── BULL BIAS ─────────────────────────────────────────────
    let bullBias=50;
    if(fgVal<25)bullBias+=18;else if(fgVal<40)bullBias+=10;else if(fgVal>75)bullBias-=18;else if(fgVal>60)bullBias-=10;
    if(btcFR<-0.0005)bullBias+=15;else if(btcFR<-0.0002)bullBias+=8;else if(btcFR>0.0005)bullBias-=15;else if(btcFR>0.0002)bullBias-=8;
    if(lsRatio!=null){if(lsRatio<0.8)bullBias+=12;else if(lsRatio>2.5)bullBias-=12;else if(lsRatio>1.8)bullBias-=6;}
    if(mvrv<1)bullBias+=12;else if(mvrv<1.2)bullBias+=6;else if(mvrv>2)bullBias-=12;else if(mvrv>1.6)bullBias-=6;
    if(btcCh>0)bullBias+=5;else if(btcCh<0)bullBias-=5;
    bullBias=Math.max(5,Math.min(95,Math.round(bullBias/5)*5));
    const halvingBlock=1050000,blocksLeft=Math.max(0,halvingBlock-(blockH||895000)),daysLeft=Math.round(blocksLeft/144);
    const signalLabel=bullBias>=75?'🟢 STRONG BULLISH':bullBias>=65?'🟩 MILD BULLISH':bullBias>=50?'🔵 NEUTRAL-BULL':bullBias<=25?'🔴 STRONG BEARISH':bullBias<=40?'🟧 MILD BEARISH':'⚖️ NEUTRAL';
    const srcUsed='mexc+binance+altme+bcinfo';

    const out={ok:true,version:'v28',ts:Date.now(),elapsed:Date.now()-t0,src:srcUsed,
      btcPrice:btcP,btcChg24h:btcCh,btcHigh24:btcH24,btcLow24:btcL24,vol24hUSD:vol24,
      fgVal,fgLabel,fgInterp,fgStatus:fgVal<=35?'Fear — akumulasi':fgVal>=65?'Greed — take profit':'Neutral',
      frPct,frAnn,frSig,
      longPct,shortPct,lsRatio,lsSig,
      oiVal:+(btcOI/1e9).toFixed(2),oiLabel:btcOI>30e9?'HIGH':btcOI>15e9?'NORMAL':'LOW',
      mvrvProxy:mvrv,mvrvLabel,mvrvInterp,ma200,
      nuplProxy,nuplLabel:nuplProxy<0?'BELIEF LOSS':nuplProxy<0.25?'HOPE':nuplProxy<0.5?'BELIEF':'EUPHORIA',
      soprProxy,soprLabel:soprProxy<0.99?'Selling at Loss — bottom signal':soprProxy<1.01?'Break Even':'Selling at Profit',
      hashRate,hashRateT:hashRate>900?'ATH Zone 🔥':hashRate>700?'Sangat Tinggi':'Normal',
      blockH,fastFee,midFee,slowFee,feeStatus:fastFee>50?'Mahal':fastFee>10?'Sedang':'Murah',
      halvingBlock,blocksLeft,daysLeft,halvingPct:blockH?+(blockH%210000/210000*100).toFixed(1):0,
      bullBias,overallSignal:signalLabel,btcDomPct:58,
      weeklyOutlook:{
        sentimentNote:`F&G ${fgVal}/100 (${fgLabel}). ${fgInterp}.`,
        derivNote:`FR ${frPct>=0?'+':''}${frPct}% (Ann: ${frAnn>=0?'+':''}${frAnn}%). BTC OI: $${(btcOI/1e9).toFixed(2)}B. (Binance Futures)`,
        domNote:`BTC 200-day MA: $${ma200>0?ma200.toLocaleString():'calculating'}. MVRV: ${mvrv} (${mvrvLabel}).`,
        trendNote:`BTC ${btcCh>=0?'+':''}${btcCh}% 24h. Range: $${btcL24>0?btcL24.toLocaleString():'—'}–$${btcH24>0?btcH24.toLocaleString():'—'}.`,
      },
      aiPrompt:`BTC: $${btcP>0?btcP.toLocaleString():'N/A'} | ${btcCh>=0?'+':''}${btcCh}% | 24H: $${btcL24>0?btcL24.toLocaleString():'—'}-$${btcH24>0?btcH24.toLocaleString():'—'} | F&G: ${fgVal}/100 (${fgLabel}) | FR: ${frPct}% (${frSig}) | OI: $${(btcOI/1e9).toFixed(2)}B | L/S: ${longPct||'—'}%/${shortPct||'—'}% | MVRV: ${mvrv} (${mvrvLabel}) | 200MA: $${ma200>0?ma200.toLocaleString():'—'} | Hash: ${hashRate}EH/s`,
    };
    CACHE.d=out;CACHE.t=Date.now();
    return res.status(200).json(out);
  }catch(e){
    return res.status(200).json({ok:false,error:String(e?.message||e),version:'v28',ts:Date.now(),elapsed:Date.now()-t0,bullBias:50,overallSignal:'⚖️ NEUTRAL',btcPrice:0,fgVal:50,fgLabel:'Neutral',lsRatio:null,frPct:0,oiVal:0,mvrvProxy:1.3,mvrvLabel:'Fair value'});
  }
}
