// api/onchain.js — v30 BEST · Multi-source L/S · 9 Parallel Calls
// ═══════════════════════════════════════════════════════════════
// UPGRADE v30: L/S dari 3 sumber berbeda + FR-based fallback
// #1 OKX rubik long-short ratio
// #2 OKX taker volume (buy/sell flow)
// #3 Binance global L/S ratio  
// #4 FR-based estimate (jika semua gagal — always shows data)
// ═══════════════════════════════════════════════════════════════
const CACHE={d:null,t:0};
export default async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Cache-Control','s-maxage=90,stale-while-revalidate=60');
  if(req.method==='OPTIONS')return res.status(200).end();
  const t0=Date.now();
  try{
    if(CACHE.d&&Date.now()-CACHE.t<90000)return res.status(200).json({...CACHE.d,cached:true,elapsed:Date.now()-t0});
    const g=async(url,ms=2800)=>{try{const c=new AbortController(),t=setTimeout(()=>c.abort(),ms);const r=await fetch(url,{signal:c.signal,headers:{Accept:'application/json','User-Agent':'AC369/30'}});clearTimeout(t);return r.ok?await r.json():null}catch{return null}};
    const N=(v,d=0)=>{const n=+v;return isNaN(n)||!isFinite(n)?d:n};
    const A=(v)=>Array.isArray(v)?v:[];

    // 9 PARALLEL CALLS
    const[R0,R1,R2,R3,R4,R5,R6,R7,R8,R9]=await Promise.allSettled([
      g('https://api.mexc.com/api/v3/ticker/24hr?symbol=BTCUSDT'),
      g('https://api.mexc.com/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=210'),
      g('https://www.okx.com/api/v5/public/funding-rate?instId=BTC-USDT-SWAP'),
      g('https://www.okx.com/api/v5/public/open-interest?instType=SWAP&instId=BTC-USDT-SWAP'),
      // L/S Source 1: OKX account ratio
      g('https://www.okx.com/api/v5/rubik/stat/contracts/long-short-account-ratio?ccy=BTC&period=1H'),
      // L/S Source 2: OKX taker volume (buy vs sell flow)
      g('https://www.okx.com/api/v5/rubik/stat/contracts/taker-volume?ccy=BTC&instType=CONTRACTS&period=1H'),
      // L/S Source 3: Binance global L/S
      g('https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=BTCUSDT&period=1h&limit=1'),
      g('https://api.alternative.me/fng/?limit=1&format=json'),
      g('https://blockchain.info/stats?format=json',3000),
      g('https://mempool.space/api/v1/fees/recommended'),
    ]);

    // BTC PRICE
    let btcP=0,btcCh=0,btcH24=0,btcL24=0,vol24=0;
    try{const m=R0.value;if(m&&N(m.lastPrice)>0){btcP=N(m.lastPrice);btcCh=+N(m.priceChangePercent).toFixed(2);btcH24=N(m.highPrice||btcP*1.02);btcL24=N(m.lowPrice||btcP*0.98);vol24=N(m.quoteVolume);}}catch{}

    // MVRV + NUPL + SOPR
    let mvrv=1.3,mvrvLabel='',mvrvInterp='',mvrvColor='amber',nuplProxy=0,nuplLabel='',nuplInterp='',soprProxy=1,soprLabel='',soprSignal='',ma200=0,ma50=0;
    try{
      const kl=A(R1.value);
      if(kl.length>=50&&btcP>0){
        const cls=kl.map(k=>N(k[4])).filter(v=>v>0);
        ma200=+(cls.slice(-200).reduce((s,v)=>s+v,0)/Math.min(200,cls.length)).toFixed(0);
        ma50=+(cls.slice(-50).reduce((s,v)=>s+v,0)/Math.min(50,cls.length)).toFixed(0);
        if(ma200>0){
          mvrv=+(btcP/ma200).toFixed(3);
          if(mvrv<0.7){mvrvLabel='🟢🟢 CAPITULATION';mvrvColor='green';mvrvInterp='BTC sangat jauh di bawah 200MA. Zona bottom historis. Akumulasi agresif!';}
          else if(mvrv<0.85){mvrvLabel='🟢🟢 UNDERVALUED';mvrvColor='green';mvrvInterp='BTC signifikan di bawah 200MA. Historically STRONG buy zone.';}
          else if(mvrv<1.0){mvrvLabel='🟢 BELOW 200MA';mvrvColor='green';mvrvInterp='BTC di bawah 200MA ($'+ma200.toLocaleString()+'). Accumulation zone.';}
          else if(mvrv<1.1){mvrvLabel='⚪ AT 200MA';mvrvColor='amber';mvrvInterp='BTC di sekitar 200MA. Fair value.';}
          else if(mvrv<1.4){mvrvLabel='🟡 ABOVE 200MA';mvrvColor='amber';mvrvInterp='BTC di atas 200MA. Uptrend. Hindari FOMO.';}
          else if(mvrv<2.0){mvrvLabel='🟠 OVERVALUED';mvrvColor='orange';mvrvInterp='Di atas 200MA. Profit taking bertahap.';}
          else{mvrvLabel='🔴 EXPENSIVE';mvrvColor='red';mvrvInterp='Jauh di atas 200MA. Reduce exposure.';}
          nuplProxy=+((btcP-ma200)/btcP).toFixed(4);
          if(nuplProxy<-0.15){nuplLabel='💎 CAPITULATION';nuplInterp='Holder banyak rugi besar. Historically best buy zone.';}
          else if(nuplProxy<0){nuplLabel='💙 BELIEF LOSS';nuplInterp='Holder rata-rata merugi. Zona akumulasi institusional.';}
          else if(nuplProxy<0.25){nuplLabel='🟡 HOPE';nuplInterp='Holder mulai untung. Pasar membaik.';}
          else if(nuplProxy<0.5){nuplLabel='🟢 BELIEF';nuplInterp='Holder untung. Bull cycle aktif.';}
          else{nuplLabel='🔴 EUPHORIA';nuplInterp='Holder untung besar. Historical top signal.';}
          const p30=cls[cls.length-31]||cls[0];
          soprProxy=p30>0?+(btcP/p30).toFixed(4):1;
          if(soprProxy<0.90){soprLabel='🔴 DEEP LOSS';soprSignal='Extreme capitulation.';}
          else if(soprProxy<0.97){soprLabel='🟡 Selling at Loss';soprSignal='Historically near-bottom signal.';}
          else if(soprProxy<1.03){soprLabel='⚪ Break Even';soprSignal='Pasar dalam tekanan.';}
          else{soprLabel='🟢 Selling at Profit';soprSignal='Healthy bull market.';}
        }
      }
    }catch{}

    // FUNDING RATE (OKX)
    let btcFR=0,frPct=0,frAnn=0,frSig='⚖️ Neutral FR',frSrc='';
    try{
      const fr=N(R2.value?.data?.[0]?.fundingRate);
      if(Math.abs(fr)>0){btcFR=fr;frPct=+(fr*100).toFixed(4);frAnn=+(frPct*3*365).toFixed(1);frSrc='okx';
        frSig=fr<-0.001?'🚀 EXTREME SQUEEZE':fr<-0.0005?'💎 Short Squeeze':fr<-0.0002?'↘️ FR Negatif':fr>0.001?'🚨 OVERHEATED':fr>0.0005?'⚠️ Long Heavy':fr>0.0002?'↗️ Mild Long':'⚖️ Neutral FR';}
    }catch{}

    // OI (OKX)
    let btcOI=0;
    try{
      const oi=R3.value?.data?.[0];
      if(oi){const v=N(oi.oiUsd)||N(oi.oi)*btcP;if(v>1e6)btcOI=v;}
    }catch{}

    // L/S RATIO — 3 sumber + FR fallback
    let longPct=null,shortPct=null,lsRatio=null,lsSig='',lsSrc='';

    // Source 1: OKX account ratio
    if(longPct===null){
      try{
        const row=A(R4.value?.data)[0];
        if(row){
          const lr=N(row.longRatio)||N(row.longAccountRatio)||0;
          const rawL=lr>1?lr:lr*100;
          if(rawL>30&&rawL<70){longPct=+rawL.toFixed(2);shortPct=+(100-longPct).toFixed(2);lsSrc='okx-acct';}
        }
      }catch{}
    }

    // Source 2: OKX taker volume (buy vs sell flow)
    if(longPct===null){
      try{
        const tv=A(R5.value?.data)[0];
        if(tv){
          const buy=N(tv.buyVol),sell=N(tv.sellVol),total=buy+sell;
          if(total>0){longPct=+(buy/total*100).toFixed(2);shortPct=+(100-longPct).toFixed(2);lsSrc='okx-taker';}
        }
      }catch{}
    }

    // Source 3: Binance global L/S
    if(longPct===null){
      try{
        const row=A(R6.value)[0]||R6.value;
        if(row&&row.longAccount!=null){
          const lr=N(row.longAccount),rawL=lr>1?lr:lr*100;
          if(rawL>30&&rawL<70){longPct=+rawL.toFixed(2);shortPct=+(100-longPct).toFixed(2);lsSrc='binance';}
        }
      }catch{}
    }

    // Source 4: FR-based proxy (ALWAYS works — never null!)
    if(longPct===null){
      try{
        // FR positive = more longs, negative = more shorts
        // Range: 48-56% based on FR magnitude
        const frNum=frPct||0;
        const est=Math.max(42,Math.min(62,50+frNum*400));
        longPct=+est.toFixed(1);
        shortPct=+(100-longPct).toFixed(1);
        lsSrc='fr-proxy';
      }catch{}
    }

    // L/S ratio calculation
    if(longPct!==null){
      lsRatio=shortPct>0?+(longPct/shortPct).toFixed(3):null;
      const srcLabel=lsSrc==='fr-proxy'?'(est)':'';
      if(lsRatio){lsSig=lsRatio<0.8?'🚀 Shorts dominan'+srcLabel:lsRatio<1.1?'⚖️ Balanced'+srcLabel:lsRatio<1.8?'↗️ Slight Long'+srcLabel:lsRatio<2.5?'⚠️ Long Heavy'+srcLabel:'🚨 Extreme Long'+srcLabel;}
    }

    // FG
    const fgVal=N(R7.value?.data?.[0]?.value,50);
    const fgLabel=R7.value?.data?.[0]?.value_classification||'Neutral';
    const fgInterp=fgVal<=20?'Extreme Fear — akumulasi agresif':fgVal<=35?'Fear — akumulasi bertahap':fgVal<=45?'Fear Ringan — DCA valid':fgVal<=55?'Neutral — selektif':fgVal<=65?'Greed Ringan — hati-hati':fgVal<=80?'Greed — kurangi sizing':'Extreme Greed — exit plan';

    // NETWORK
    let hashRate=0,blockH=0;
    try{const bc=R8.value;if(bc){hashRate=+(N(bc.hash_rate)/1e6).toFixed(1);blockH=N(bc.n_blocks_total)}}catch{}
    let fastFee=2,midFee=1,slowFee=1;
    try{const f=R9.value;if(f){fastFee=N(f.fastestFee);midFee=N(f.halfHourFee||fastFee);slowFee=N(f.hourFee||fastFee)}}catch{}

    // BULL BIAS (7 faktor)
    let bullBias=50;
    if(fgVal<20)bullBias+=20;else if(fgVal<35)bullBias+=12;else if(fgVal>75)bullBias-=20;else if(fgVal>60)bullBias-=12;
    if(btcFR<-0.0005)bullBias+=15;else if(btcFR<-0.0002)bullBias+=8;else if(btcFR>0.0005)bullBias-=15;else if(btcFR>0.0002)bullBias-=8;
    if(mvrv<0.8)bullBias+=18;else if(mvrv<1.0)bullBias+=12;else if(mvrv<1.2)bullBias+=6;else if(mvrv>2.0)bullBias-=14;else if(mvrv>1.6)bullBias-=8;
    if(nuplProxy<-0.1)bullBias+=15;else if(nuplProxy<0)bullBias+=8;else if(nuplProxy>0.5)bullBias-=10;
    if(soprProxy<0.95)bullBias+=12;else if(soprProxy<0.99)bullBias+=6;else if(soprProxy>1.2)bullBias-=8;
    if(lsRatio!=null&&lsSrc!=='fr-proxy'){if(lsRatio<0.8)bullBias+=12;else if(lsRatio>2.5)bullBias-=12;else if(lsRatio>1.8)bullBias-=6;}
    if(btcCh>2)bullBias+=5;else if(btcCh>0)bullBias+=2;else if(btcCh<-2)bullBias-=5;else if(btcCh<0)bullBias-=2;
    bullBias=Math.max(5,Math.min(95,Math.round(bullBias/5)*5));

    // CONFLUENCE
    let bS=0,brS=0;
    if(fgVal<35)bS++;else if(fgVal>65)brS++;
    if(btcFR<-0.0002)bS++;else if(btcFR>0.0002)brS++;
    if(mvrv<1.0)bS++;else if(mvrv>1.8)brS++;
    if(nuplProxy<0)bS++;else if(nuplProxy>0.5)brS++;
    if(soprProxy<0.99)bS++;else if(soprProxy>1.2)brS++;
    if(lsRatio!=null&&lsSrc!=='fr-proxy'){if(lsRatio<1)bS++;else if(lsRatio>2)brS++;}
    if(hashRate>900)bS++;
    const confluenceScore=Math.round((bS/(bS+brS||1))*100);
    const confluenceLabel=confluenceScore>=85?'🔥 STRONG BULL CONFLUENCE':confluenceScore>=65?'🟢 BULL CONFLUENCE':confluenceScore<=20?'🔴 BEAR CONFLUENCE':confluenceScore<=40?'🟠 MILD BEAR':'⚖️ NEUTRAL';

    const halvingBlock=1050000,blocksLeft=Math.max(0,halvingBlock-(blockH||895000)),daysLeft=Math.round(blocksLeft/144);
    const signalLabel=bullBias>=80?'🟢 STRONG BULLISH':bullBias>=65?'🟩 MILD BULLISH':bullBias>=50?'🔵 NEUTRAL-BULL':bullBias<=25?'🔴 STRONG BEARISH':bullBias<=40?'🟧 MILD BEARISH':'⚖️ NEUTRAL';

    // Real BTC dominance from CoinGecko (via separate call if needed, else use cached 58%)
    let btcDomPct=58;
    try{
      const cgG=await g('https://api.coingecko.com/api/v3/global',2500);
      if(cgG?.data?.market_cap_percentage?.btc)btcDomPct=+cgG.data.market_cap_percentage.btc.toFixed(1);
    }catch{}

    const keyInsight=mvrv<1.0&&nuplProxy<0?`🚨 RARE SIGNAL: BTC di bawah 200MA (MVRV=${mvrv}) + Holder merugi (NUPL=${nuplProxy}). Historically zona BEST ACCUMULATION. Terjadi di 2018 bottom, 2020 crash, 2022 bottom.`:mvrv<1.1?`💎 BTC dekat/bawah 200MA. Zona akumulasi institusional. Risk/reward sangat baik untuk DCA.`:`MVRV ${mvrv} — ${mvrvInterp}`;

    const out={ok:true,version:'v30',ts:Date.now(),elapsed:Date.now()-t0,src:`mexc+okx+${lsSrc||'n/a'}+altme+bcinfo`,
      btcPrice:btcP,btcChg24h:btcCh,btcHigh24:btcH24,btcLow24:btcL24,vol24hUSD:vol24,
      ma200,ma50,btcDomPct,
      fgVal,fgLabel,fgInterp,fgStatus:fgVal<=35?'Fear — akumulasi':fgVal>=65?'Greed — take profit':'Neutral',
      frPct,frAnn,frSig,frSrc,
      longPct,shortPct,lsRatio,lsSig,lsSrc,
      oiVal:+(btcOI/1e9).toFixed(2),oiLabel:btcOI>30e9?'HIGH':btcOI>15e9?'NORMAL':btcOI>1e9?'MODERATE':'LOW',
      mvrvProxy:mvrv,mvrvLabel,mvrvInterp,mvrvColor,
      nuplProxy,nuplLabel,nuplInterp,
      soprProxy,soprLabel,soprSignal,
      hashRate,hashRateT:hashRate>900?'ATH Zone 🔥':hashRate>700?'Sangat Tinggi':'Normal',
      blockH,fastFee,midFee,slowFee,feeStatus:fastFee>50?'Mahal':fastFee>10?'Sedang':'Murah',
      halvingBlock,blocksLeft,daysLeft,halvingPct:blockH?+(blockH%210000/210000*100).toFixed(1):0,
      bullBias,overallSignal:signalLabel,
      confluenceScore,confluenceLabel,bullSignals:bS,bearSignals:brS,
      keyInsight,
      weeklyOutlook:{
        sentimentNote:`F&G ${fgVal}/100 (${fgLabel}). ${fgInterp}.`,
        derivNote:`FR ${frPct>=0?'+':''}${frPct}% (Ann: ${frAnn>=0?'+':''}${frAnn}%). OI: $${(btcOI/1e9).toFixed(2)}B. (${frSrc||'okx'})`,
        domNote:`BTC Dom: ${btcDomPct}% | 200MA: $${ma200.toLocaleString()} | 50MA: $${ma50.toLocaleString()} | MVRV: ${mvrv} ${mvrvLabel}`,
        trendNote:`BTC ${btcCh>=0?'+':''}${btcCh}% 24h. Range: $${btcL24.toLocaleString()}–$${btcH24.toLocaleString()}.`,
      },
      aiPrompt:`BTC: $${btcP.toLocaleString()} | ${btcCh>=0?'+':''}${btcCh}% | 24H: $${btcL24.toLocaleString()}-$${btcH24.toLocaleString()} | F&G: ${fgVal}/100 (${fgLabel}) | FR: ${frPct}% | OI: $${(btcOI/1e9).toFixed(2)}B | L/S: ${longPct||'—'}/${shortPct||'—'}% (${lsSrc||'n/a'}) | MVRV: ${mvrv} (${mvrvLabel}) | NUPL: ${nuplProxy} (${nuplLabel}) | SOPR: ${soprProxy} | 200MA: $${ma200.toLocaleString()} | Hash: ${hashRate}EH/s | Confluence: ${confluenceScore}% ${confluenceLabel}`,
    };
    CACHE.d=out;CACHE.t=Date.now();
    return res.status(200).json(out);
  }catch(e){
    return res.status(200).json({ok:false,error:String(e?.message||e),version:'v30',ts:Date.now(),elapsed:Date.now()-t0,bullBias:50,overallSignal:'⚖️ NEUTRAL',btcPrice:0,fgVal:50,fgLabel:'Neutral',mvrvProxy:1.3,mvrvLabel:'—',nuplProxy:0,soprProxy:1,confluenceScore:50,lsRatio:null});
  }
}
