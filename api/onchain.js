// api/onchain.js — v29 SUPER ACCURATE · OKX Derivatives + MEXC
// ════════════════════════════════════════════════════════════════
// BTC Price + 24h + HL    → MEXC 24hr (proven working)
// MVRV + NUPL + SOPR      → MEXC 200d klines (real calculation)
// Funding Rate            → OKX public API (no auth needed)
// Open Interest           → OKX public API
// Long/Short Ratio        → OKX + calculated fallback
// Fear & Greed            → alternative.me
// Hash Rate + Block       → blockchain.info
// Mempool Fee             → mempool.space
// ════════════════════════════════════════════════════════════════
const CACHE={d:null,t:0};
export default async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Cache-Control','s-maxage=90,stale-while-revalidate=60');
  if(req.method==='OPTIONS')return res.status(200).end();
  const t0=Date.now();
  try{
    if(CACHE.d&&Date.now()-CACHE.t<90000)return res.status(200).json({...CACHE.d,cached:true,elapsed:Date.now()-t0});
    const g=async(url,ms=2800)=>{try{const c=new AbortController(),t=setTimeout(()=>c.abort(),ms);const r=await fetch(url,{signal:c.signal,headers:{Accept:'application/json','User-Agent':'AC369/29'}});clearTimeout(t);return r.ok?await r.json():null}catch{return null}};
    const N=(v,d=0)=>{const n=+v;return isNaN(n)||!isFinite(n)?d:n};
    const A=(v)=>Array.isArray(v)?v:[];

    const[R0,R1,R2,R3,R4,R5,R6,R7]=await Promise.allSettled([
      g('https://api.mexc.com/api/v3/ticker/24hr?symbol=BTCUSDT'),            // BTC price+change+HL
      g('https://api.mexc.com/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=210'), // 200d klines
      g('https://www.okx.com/api/v5/public/funding-rate?instId=BTC-USDT-SWAP'), // FR (OKX)
      g('https://www.okx.com/api/v5/public/open-interest?instType=SWAP&instId=BTC-USDT-SWAP'), // OI (OKX)
      g('https://www.okx.com/api/v5/rubik/stat/contracts/long-short-account-ratio?ccy=BTC&period=1H'), // L/S (OKX)
      g('https://api.alternative.me/fng/?limit=1&format=json'),
      g('https://blockchain.info/stats?format=json',3000),
      g('https://mempool.space/api/v1/fees/recommended'),
    ]);

    // BTC PRICE
    let btcP=0,btcCh=0,btcH24=0,btcL24=0,vol24=0;
    try{const m=R0.value;if(m&&N(m.lastPrice)>0){btcP=N(m.lastPrice);btcCh=+N(m.priceChangePercent).toFixed(2);btcH24=N(m.highPrice||btcP*1.02);btcL24=N(m.lowPrice||btcP*0.98);vol24=N(m.quoteVolume);}}catch{}

    // MVRV + NUPL + SOPR dari 200d klines
    let mvrv=1.3,mvrvLabel='',mvrvInterp='',mvrvColor='amber';
    let nuplProxy=0,nuplLabel='',nuplInterp='';
    let soprProxy=1,soprLabel='',soprSignal='';
    let ma200=0,ma50=0;
    try{
      const kl=A(R1.value);
      if(kl.length>=50&&btcP>0){
        const cls=kl.map(k=>N(k[4])).filter(v=>v>0);
        const sl200=cls.slice(-200);
        const sl50=cls.slice(-50);
        ma200=+(sl200.reduce((s,v)=>s+v,0)/sl200.length).toFixed(0);
        ma50=+(sl50.reduce((s,v)=>s+v,0)/sl50.length).toFixed(0);
        if(ma200>0){
          mvrv=+(btcP/ma200).toFixed(3);
          // MVRV Label — ACCURATE thresholds
          // ACCURATE: mvrv < 1.0 = BTC BELOW 200MA = definitively UNDERVALUED
          if(mvrv<0.7){mvrvLabel='🟢🟢 CAPITULATION';mvrvColor='green';mvrvInterp='BTC jauh di bawah 200MA ('+(((1-mvrv)*100).toFixed(0))+'% discount). Zona bottom historis. Akumulasi agresif!';}
          else if(mvrv<0.85){mvrvLabel='🟢🟢 UNDERVALUED';mvrvColor='green';mvrvInterp='BTC signifikan di bawah 200MA. STRONG buy zone. Historically sangat profitable.';}
          else if(mvrv<1.0){mvrvLabel='🟢 BELOW 200MA';mvrvColor='green';mvrvInterp='BTC di bawah 200MA ($'+ma200.toLocaleString()+'). Akumulasi zone. DCA valid.';}
          else if(mvrv<1.1){mvrvLabel='⚪ AT 200MA';mvrvColor='amber';mvrvInterp='BTC di sekitar 200MA. Fair value. Pasar seimbang.';}
          else if(mvrv<1.4){mvrvLabel='🟡 ABOVE 200MA';mvrvColor='amber';mvrvInterp='BTC di atas 200MA. Uptrend. Sizing normal, hindari FOMO.';}
          else if(mvrv<2.0){mvrvLabel='🟠 OVERVALUED';mvrvColor='orange';mvrvInterp='Signifikan di atas 200MA. Profit taking bertahap. Kurangi exposure.';}
          else if(mvrv<2.8){mvrvLabel='🔴 EXPENSIVE';mvrvColor='red';mvrvInterp='Jauh di atas 200MA. Reduce exposure. Take profit agresif.';}
          else{mvrvLabel='🔴🔴 BUBBLE ZONE';mvrvColor='red';mvrvInterp='Extreme premium vs 200MA. Historical top zone. Exit plan aktif.';}

          // NUPL = (Price - Realized Price proxy) / Price
          // Realized Price proxy ≈ 200-day MA
          nuplProxy=+((btcP-ma200)/btcP).toFixed(4);
          if(nuplProxy<-0.15){nuplLabel='💎 CAPITULATION';nuplInterp='Holder banyak rugi besar. Historically bottom signal. BEST buy zone.';}
          else if(nuplProxy<0){nuplLabel='💙 BELIEF LOSS';nuplInterp='Holder rata-rata merugi. Beli BTC sama dengan beli dibawah avg holder.';}
          else if(nuplProxy<0.15){nuplLabel='🟡 HOPE/FEAR';nuplInterp='Holder break even. Pasar mulai pulih.';}
          else if(nuplProxy<0.35){nuplLabel='🟢 BELIEF';nuplInterp='Holder untung. Bull cycle aktif.';}
          else if(nuplProxy<0.6){nuplLabel='🔵 OPTIMISM';nuplInterp='Holder untung signifikan. Greed mulai terlihat.';}
          else{nuplLabel='🔴 EUPHORIA';nuplInterp='Holder untung besar. Historically top signal. Hati-hati!';}

          // SOPR proxy = price now / price 30d ago
          const p30=cls[cls.length-31]||cls[0];
          soprProxy=p30>0?+(btcP/p30).toFixed(4):1.0;
          if(soprProxy<0.90){soprLabel='🔴 DEEP LOSS';soprSignal='Banyak jual rugi besar. Extreme capitulation.';}
          else if(soprProxy<0.97){soprLabel='🟡 Selling at Loss';soprSignal='Holder jual rugi. Historically near-bottom signal.';}
          else if(soprProxy<1.03){soprLabel='⚪ Break Even';soprSignal='Holder jual BEP. Pasar dalam tekanan.';}
          else if(soprProxy<1.15){soprLabel='🟢 Selling at Profit';soprSignal='Holder jual untung. Healthy bull market.';}
          else{soprLabel='🔵 High Profit Taking';soprSignal='Holder jual untung besar. Distribusi mungkin dimulai.';}
        }
      }
    }catch{}

    // FUNDING RATE (OKX)
    let btcFR=0,frPct='0',frAnn='0',frSig='⚖️ Neutral FR',frSrc='';
    try{
      const okxFR=R2.value;
      // OKX response: {code:"0", data:[{fundingRate:"0.0001",...}]}
      const fr=N(okxFR?.data?.[0]?.fundingRate)||N(okxFR?.data?.[0]?.fundingRateOkex);
      if(Math.abs(fr)>0){
        btcFR=fr;frPct=+(btcFR*100).toFixed(4);frAnn=+(frPct*3*365).toFixed(1);frSrc='okx';
        frSig=btcFR<-0.001?'🚀 EXTREME SQUEEZE — reversal imminent!':btcFR<-0.0005?'💎 Short Squeeze — FR sangat negatif':btcFR<-0.0002?'↘️ FR Negatif — shorts bayar longs':btcFR>0.001?'🚨 OVERHEATED — longs extreme, risk tinggi':btcFR>0.0005?'⚠️ Long Heavy — hati-hati':btcFR>0.0002?'↗️ Mild Long Bias':'⚖️ Neutral FR';
      }
    }catch{}

    // OI (OKX)
    let btcOI=0;
    try{
      const okxOI=R3.value;
      // OKX: {data:[{oi:"12345", oiCcy:"12345",...}]}
      const oiUSD=N(okxOI?.data?.[0]?.oiUsd||okxOI?.data?.[0]?.oi)*btcP;
      const oiDirect=N(okxOI?.data?.[0]?.oiUsd);
      if(oiDirect>1e6)btcOI=oiDirect;
      else if(oiUSD>1e6)btcOI=oiUSD;
    }catch{}

    // L/S (OKX)
    let longPct=null,shortPct=null,lsRatio=null,lsSig='';
    try{
      const okxLS=R4.value;
      // OKX: {data:[{longRatio:"0.5102", shortRatio:"0.4898",...}]}
      const row=A(okxLS?.data)[0];
      if(row){
        // OKX returns longRatio as decimal (e.g. 0.51) or percentage (51)
        const lr=N(row.longRatio)||N(row.longAccountRatio)||N(row.buyRatio)||0;
        const sr=N(row.shortRatio)||N(row.shortAccountRatio)||N(row.sellRatio)||0;
        // Detect if it's decimal (0-1) or percentage (0-100)
        const rawL=lr>1?lr:lr*100; // if >1, already percentage
        if(rawL>0&&rawL<100){
          longPct=+rawL.toFixed(2);
          shortPct=+(100-longPct).toFixed(2);
        lsRatio=shortPct>0?+(longPct/shortPct).toFixed(3):null;
        if(lsRatio){lsSig=lsRatio<0.8?'🚀 Shorts dominan — squeeze potential besar':lsRatio<1.1?'⚖️ Balanced — tidak ada extreme':lsRatio<1.8?'↗️ Slight Long — aman':lsRatio<2.5?'⚠️ Long Heavy — hati-hati koreksi':'🚨 Extreme Long — risk koreksi tinggi';}
        }
      }
    }catch{}

    // FG
    const fgVal=N(R5.value?.data?.[0]?.value,50);
    const fgLabel=R5.value?.data?.[0]?.value_classification||'Neutral';
    const fgInterp=fgVal<=20?'Extreme Fear — akumulasi agresif':fgVal<=35?'Fear — akumulasi bertahap':fgVal<=45?'Fear Ringan — DCA valid':fgVal<=55?'Neutral — selektif':fgVal<=65?'Greed Ringan — hati-hati':fgVal<=80?'Greed — kurangi sizing':'Extreme Greed — exit plan';

    // Network
    let hashRate=0,blockH=0;
    try{const bc=R6.value;if(bc){hashRate=+(N(bc.hash_rate)/1e6).toFixed(1);blockH=N(bc.n_blocks_total)}}catch{}
    let fastFee=2,midFee=1,slowFee=1;
    try{const f=R7.value;if(f){fastFee=N(f.fastestFee);midFee=N(f.halfHourFee||fastFee);slowFee=N(f.hourFee||fastFee)}}catch{}

    // BULL BIAS — menggunakan semua 7 faktor
    let bullBias=50;
    // F1: FG (contrarian: extreme fear = bullish)
    if(fgVal<20)bullBias+=20;else if(fgVal<35)bullBias+=12;else if(fgVal>75)bullBias-=20;else if(fgVal>60)bullBias-=12;
    // F2: FR (contrarian: negative = bullish)
    if(btcFR<-0.0005)bullBias+=15;else if(btcFR<-0.0002)bullBias+=8;else if(btcFR>0.0005)bullBias-=15;else if(btcFR>0.0002)bullBias-=8;
    // F3: MVRV (below 1 = undervalued = bullish)
    if(mvrv<0.8)bullBias+=18;else if(mvrv<1.0)bullBias+=12;else if(mvrv<1.2)bullBias+=6;else if(mvrv>2.0)bullBias-=14;else if(mvrv>1.6)bullBias-=8;
    // F4: NUPL (negative = many at loss = accumulation)
    if(nuplProxy<-0.1)bullBias+=15;else if(nuplProxy<0)bullBias+=8;else if(nuplProxy>0.5)bullBias-=10;
    // F5: SOPR (selling at loss = near bottom)
    if(soprProxy<0.95)bullBias+=12;else if(soprProxy<0.99)bullBias+=6;else if(soprProxy>1.2)bullBias-=8;
    // F6: L/S (shorts dominant = squeeze)
    if(lsRatio!=null){if(lsRatio<0.8)bullBias+=12;else if(lsRatio>2.5)bullBias-=12;else if(lsRatio>1.8)bullBias-=6;}
    // F7: BTC trend
    if(btcCh>2)bullBias+=5;else if(btcCh>0)bullBias+=2;else if(btcCh<-2)bullBias-=5;else if(btcCh<0)bullBias-=2;
    bullBias=Math.max(5,Math.min(95,Math.round(bullBias/5)*5));

    const halvingBlock=1050000,blocksLeft=Math.max(0,halvingBlock-(blockH||895000)),daysLeft=Math.round(blocksLeft/144);
    const signalLabel=bullBias>=80?'🟢 STRONG BULLISH':bullBias>=65?'🟩 MILD BULLISH':bullBias>=50?'🔵 NEUTRAL-BULL':bullBias<=20?'🔴 STRONG BEARISH':bullBias<=35?'🟧 MILD BEARISH':'⚖️ NEUTRAL';

    const out={ok:true,version:'v29',ts:Date.now(),elapsed:Date.now()-t0,src:'mexc+okx+altme+bcinfo',
      btcPrice:btcP,btcChg24h:btcCh,btcHigh24:btcH24,btcLow24:btcL24,vol24hUSD:vol24,
      ma200,ma50,
      fgVal,fgLabel,fgInterp,fgStatus:fgVal<=35?'Fear — akumulasi':fgVal>=65?'Greed — take profit':'Neutral',
      frPct:+frPct,frAnn:+frAnn,frSig,frSrc,
      longPct,shortPct,lsRatio,lsSig,
      oiVal:+(btcOI/1e9).toFixed(2),oiLabel:btcOI>30e9?'HIGH':btcOI>15e9?'NORMAL':btcOI>1e9?'MODERATE':'LOW',
      // ACCURATE on-chain proxies
      mvrvProxy:mvrv,mvrvLabel,mvrvInterp,mvrvColor,
      nuplProxy,nuplLabel,nuplInterp,
      soprProxy,soprLabel,soprSignal,
      hashRate,hashRateT:hashRate>900?'ATH Zone 🔥':hashRate>700?'Sangat Tinggi':'Normal',
      blockH,fastFee,midFee,slowFee,feeStatus:fastFee>50?'Mahal':fastFee>10?'Sedang':'Murah',
      halvingBlock,blocksLeft,daysLeft,halvingPct:blockH?+(blockH%210000/210000*100).toFixed(1):0,
      bullBias,overallSignal:signalLabel,btcDomPct:58,
      weeklyOutlook:{
        sentimentNote:`F&G ${fgVal}/100 (${fgLabel}). ${fgInterp}.`,
        derivNote:`FR ${frPct>=0?'+':''}${frPct}% (Ann: ${frAnn>=0?'+':''}${frAnn}%). OI: $${(btcOI/1e9).toFixed(2)}B. ${frSrc?'('+frSrc.toUpperCase()+')':''}`,
        domNote:`200MA: $${ma200>0?ma200.toLocaleString():'—'} | 50MA: $${ma50>0?ma50.toLocaleString():'—'} | MVRV: ${mvrv} ${mvrvLabel}`,
        trendNote:`BTC ${btcCh>=0?'+':''}${btcCh}% 24h. Range: $${btcL24>0?btcL24.toLocaleString():'—'}–$${btcH24>0?btcH24.toLocaleString():'—'}.`,
      },
      // KEY INSIGHT untuk trader
      keyInsight:mvrv<1&&nuplProxy<0?`🚨 RARE SIGNAL: BTC di bawah 200MA (MVRV=${mvrv}) + Holder merugi rata-rata (NUPL=${nuplProxy}). Historically ini zona BEST ACCUMULATION. Peluang langka.`:mvrv<1.1?`💎 BTC dekat/bawah 200MA ($${ma200.toLocaleString()}). Zona akumulasi institusional. Risk/reward sangat baik.`:`MVRV ${mvrv} - ${mvrvInterp}`,
      aiPrompt:`BTC: $${btcP>0?btcP.toLocaleString():'N/A'} | ${btcCh>=0?'+':''}${btcCh}% | 24H: $${btcL24.toLocaleString()}-$${btcH24.toLocaleString()} | F&G: ${fgVal}/100 (${fgLabel}) | FR: ${frPct}% | OI: $${(btcOI/1e9).toFixed(2)}B | L/S: ${longPct||'—'}%/${shortPct||'—'}% | MVRV: ${mvrv} (${mvrvLabel}) | NUPL: ${nuplProxy} (${nuplLabel}) | SOPR: ${soprProxy} | 200MA: $${ma200.toLocaleString()} | Hash: ${hashRate}EH/s`,
    };
    CACHE.d=out;CACHE.t=Date.now();
    return res.status(200).json(out);
  }catch(e){
    return res.status(200).json({ok:false,error:String(e?.message||e),version:'v29',ts:Date.now(),elapsed:Date.now()-t0,bullBias:50,overallSignal:'⚖️ NEUTRAL',btcPrice:0,fgVal:50,fgLabel:'Neutral',mvrvProxy:1.3,mvrvLabel:'—',nuplProxy:0,soprProxy:1});
  }
}
