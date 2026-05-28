// api/onchain.js — v26 FIXED · Use Bybit ALL tickers (proven working)
// Root cause fix: symbol=BTCUSDT endpoint blocked/timeout from Vercel
// Solution: use all tickers (same as morning-brief which works) then find BTC
const CACHE={d:null,t:0};
export default async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Cache-Control','s-maxage=120,stale-while-revalidate=60');
  if(req.method==='OPTIONS')return res.status(200).end();
  const t0=Date.now();
  try{
    if(CACHE.d&&Date.now()-CACHE.t<120000)return res.status(200).json({...CACHE.d,cached:true,elapsed:Date.now()-t0});
    const g=async(url,ms=3000)=>{try{const c=new AbortController(),t=setTimeout(()=>c.abort(),ms);const r=await fetch(url,{signal:c.signal,headers:{Accept:'application/json','User-Agent':'AC369/26'}});clearTimeout(t);return r.ok?await r.json():null}catch{return null}};
    const N=(v,d=0)=>{const n=+v;return isNaN(n)||!isFinite(n)?d:n};
    const A=(v)=>Array.isArray(v)?v:[];

    const[R0,R1,R2,R3,R4,R5]=await Promise.allSettled([
      // Use ALL tickers (not filtered) — same as morning-brief, PROVEN WORKING
      g('https://api.bybit.com/v5/market/tickers?category=linear',3000),
      // L/S ratio
      g('https://api.bybit.com/v5/market/account-ratio?category=linear&symbol=BTCUSDT&period=1h&limit=1',3000),
      // BTC daily klines for MVRV proxy
      g('https://api.bybit.com/v5/market/kline?category=linear&symbol=BTCUSDT&interval=D&limit=200',3000),
      // Fear & Greed
      g('https://api.alternative.me/fng/?limit=1&format=json',3000),
      // Network stats
      g('https://blockchain.info/stats?format=json',3500),
      // Mempool fees
      g('https://mempool.space/api/v1/fees/recommended',3000),
    ]);

    // Find BTC from ALL tickers list
    let btcP=0,btcFR=0,btcOI=0,btcCh=0,vol24=0,btcH24=0,btcL24=0;
    try{
      const list=A(R0.value?.result?.list);
      const btcT=list.find(t=>t.symbol==='BTCUSDT')||list[0];
      if(btcT){
        btcP=N(btcT.lastPrice);
        btcFR=N(btcT.fundingRate);
        btcOI=N(btcT.openInterestValue);
        vol24=N(btcT.turnover24h);
        btcH24=N(btcT.highPrice24h||btcP*1.02);
        btcL24=N(btcT.lowPrice24h||btcP*0.98);
        const prev=N(btcT.prevPrice24h||btcP);
        btcCh=prev>0?+((btcP-prev)/prev*100).toFixed(2):N(btcT.price24hPcnt)*100;
      }
    }catch{}

    // ETH, BNB, SOL prices from same call (market context)
    let ethP=0,solP=0,bnbP=0,totalBybitOI=0;
    try{
      const list=A(R0.value?.result?.list);
      const eth=list.find(t=>t.symbol==='ETHUSDT');if(eth)ethP=N(eth.lastPrice);
      const sol=list.find(t=>t.symbol==='SOLUSDT');if(sol)solP=N(sol.lastPrice);
      const bnb=list.find(t=>t.symbol==='BNBUSDT');if(bnb)bnbP=N(bnb.lastPrice);
      // Total derivatives market OI
      totalBybitOI=list.reduce((s,t)=>s+N(t.openInterestValue),0);
    }catch{}

    // L/S
    let longPct=null,shortPct=null,lsRatio=null,lsSig='';
    try{
      const row=A(R1.value?.result?.list)[0];
      if(row){
        longPct=+N(row.buyRatio*100).toFixed(2);
        shortPct=+N(row.sellRatio*100).toFixed(2);
        lsRatio=shortPct>0?+(longPct/shortPct).toFixed(3):null;
        if(lsRatio)lsSig=lsRatio<0.8?'🚀 Shorts dominan — squeeze besar':lsRatio<1.1?'⚖️ Balanced':lsRatio<1.8?'↗️ Slight Long':lsRatio<2.5?'⚠️ Long Heavy':'🚨 Extreme Long — risk tinggi';
      }
    }catch{}

    // MVRV proxy dari daily klines
    let mvrv=1.3,mvrvLabel='Fair value',mvrvInterp='',nuplProxy=0.255,soprProxy=1.01,ma200=0;
    try{
      const raw=A(R2.value?.result?.list);
      if(raw.length>=50&&btcP>0){
        const cls=raw.slice().reverse().map(d=>N(d[4])).filter(v=>v>0);
        ma200=+(cls.slice(-200).reduce((s,v)=>s+v,0)/Math.min(200,cls.length)).toFixed(0);
        if(ma200>0){
          mvrv=+(btcP/ma200).toFixed(2);
          if(mvrv<0.7){mvrvLabel='Capitulation 🟢🟢';mvrvInterp='Sangat murah vs 200MA. Akumulasi agresif.';}
          else if(mvrv<0.9){mvrvLabel='Undervalued 🟢';mvrvInterp='Di bawah 200MA. Historically strong buy zone.';}
          else if(mvrv<1.15){mvrvLabel='Fair Value ⚪';mvrvInterp='Dekat 200MA. Pasar seimbang. DCA valid.';}
          else if(mvrv<1.6){mvrvLabel='Slightly High ⚠️';mvrvInterp='Di atas 200MA. Profit taking bertahap.';}
          else if(mvrv<2.2){mvrvLabel='Overvalued 🔴';mvrvInterp='Signifikan di atas 200MA. Reduce exposure.';}
          else{mvrvLabel='Bubble Zone 🔴🔴';mvrvInterp='Jauh di atas norms. Aggressive take profit.';}
          nuplProxy=+((btcP-ma200)/btcP).toFixed(3);
          const p30=cls[cls.length-31]||cls[0];
          soprProxy=p30>0?+(btcP/p30).toFixed(3):1.01;
        }
      }
    }catch{}

    // FG
    const fgVal=N(R3.value?.data?.[0]?.value,50);
    const fgLabel=R3.value?.data?.[0]?.value_classification||'Neutral';
    const fgInterp=fgVal<=20?'Extreme Fear — akumulasi agresif':fgVal<=35?'Fear — akumulasi bertahap':fgVal<=45?'Fear Ringan — DCA valid':fgVal<=55?'Neutral — selektif':fgVal<=65?'Greed Ringan — hati-hati':fgVal<=80?'Greed — kurangi sizing':'Extreme Greed — exit plan';

    // Network
    let hashRate=0,blockH=0;
    try{const bc=R4.value;if(bc){hashRate=+(N(bc.hash_rate)/1e6).toFixed(1);blockH=N(bc.n_blocks_total)}}catch{}

    // Fees
    let fastFee=2,midFee=1,slowFee=1;
    try{const f=R5.value;if(f){fastFee=N(f.fastestFee);midFee=N(f.halfHourFee||f.fastestFee);slowFee=N(f.hourFee||f.fastestFee)}}catch{}

    // Overall bull bias
    let bullBias=50;
    if(fgVal<25)bullBias+=18;else if(fgVal<40)bullBias+=10;else if(fgVal>75)bullBias-=18;else if(fgVal>60)bullBias-=10;
    if(btcFR<-0.0005)bullBias+=15;else if(btcFR<-0.0002)bullBias+=8;else if(btcFR>0.0005)bullBias-=15;else if(btcFR>0.0002)bullBias-=8;
    if(lsRatio!=null){if(lsRatio<0.8)bullBias+=12;else if(lsRatio<1.1)bullBias+=5;else if(lsRatio>2.5)bullBias-=12;else if(lsRatio>1.8)bullBias-=6;}
    if(mvrv<1)bullBias+=12;else if(mvrv<1.2)bullBias+=6;else if(mvrv>2)bullBias-=12;else if(mvrv>1.6)bullBias-=6;
    if(btcCh>0)bullBias+=5;else if(btcCh<0)bullBias-=5;
    bullBias=Math.max(5,Math.min(95,Math.round(bullBias/5)*5));

    const frPct=+(btcFR*100).toFixed(4),frAnn=+(frPct*3*365).toFixed(1);
    const halvingBlock=1050000,blocksLeft=Math.max(0,halvingBlock-(blockH||895000)),daysLeft=Math.round(blocksLeft/144);
    const btcPip=btcH24>btcL24?+((btcP-btcL24)/(btcH24-btcL24)*100).toFixed(1):50;

    const out={ok:true,version:'v26',ts:Date.now(),elapsed:Date.now()-t0,
      // BTC Price & Performance
      btcPrice:btcP,btcChg24h:btcCh,btcHigh24:btcH24,btcLow24:btcL24,btcPip,
      vol24hUSD:vol24,
      // Alt prices (market context)
      ethPrice:ethP,solPrice:solP,bnbPrice:bnbP,
      totalDerivOI:+(totalBybitOI/1e9).toFixed(1),
      // Fear & Greed
      fgVal,fgLabel,fgInterp,
      fgStatus:fgVal<=35?'Fear — akumulasi':fgVal>=65?'Greed — take profit':'Neutral',
      // Derivatives
      frPct,frAnn,
      frSig:btcFR<-0.0008?'🚀 EXTREME SQUEEZE — reversal besar':btcFR<-0.0005?'💎 Short Squeeze setup':btcFR<-0.0002?'↘️ FR Negatif — bearish bayar':btcFR>0.0008?'🚨 OVERHEATED — longs extreme':btcFR>0.0005?'⚠️ Long Heavy':btcFR>0.0002?'↗️ Mild Long':'⚖️ Neutral FR',
      longPct,shortPct,lsRatio,lsSig,
      oiVal:+(btcOI/1e9).toFixed(2),oiLabel:btcOI>30e9?'HIGH':btcOI>15e9?'NORMAL':'LOW',
      // On-chain proxies
      mvrvProxy:mvrv,mvrvLabel,mvrvInterp,ma200,
      nuplProxy,nuplLabel:nuplProxy<0?'BELIEF LOSS':nuplProxy<0.25?'HOPE':nuplProxy<0.5?'BELIEF':'EUPHORIA',
      soprProxy,soprLabel:soprProxy<0.99?'Selling at Loss — bottom signal':soprProxy<1.01?'Break Even':'Selling at Profit',
      // Network
      hashRate,hashRateT:hashRate>900?'ATH Zone 🔥':hashRate>700?'Sangat Tinggi':'Normal',
      blockH,fastFee,midFee,slowFee,feeStatus:fastFee>50?'Mahal':fastFee>10?'Sedang':'Murah',
      halvingBlock,blocksLeft,daysLeft,halvingPct:blockH?+(blockH%210000/210000*100).toFixed(1):0,
      // Signal
      bullBias,
      overallSignal:bullBias>=75?'🟢 STRONG BULLISH':bullBias>=60?'🟩 MILD BULLISH — '+bullBias+'% Bull':bullBias<=25?'🔴 STRONG BEARISH':bullBias<=40?'🟧 MILD BEARISH':'⚖️ NEUTRAL',
      btcDomPct:58,
      weeklyOutlook:{
        sentimentNote:`F&G ${fgVal}/100 (${fgLabel}). ${fgInterp}.`,
        derivNote:`FR ${frPct>=0?'+':''}${frPct}% (Ann: ${frAnn>=0?'+':''}${frAnn}%). BTC OI: $${(btcOI/1e9).toFixed(1)}B. Total Deriv OI: $${+(totalBybitOI/1e9).toFixed(0)}B.`,
        domNote:`BTC derivatives via Bybit. ${btcCh>=0?'Bullish momentum.':'Bearish pressure.'}`,
        trendNote:`BTC ${btcCh>=0?'+':''}${btcCh}% 24h. Range: $${btcL24.toLocaleString()}–$${btcH24.toLocaleString()}.`,
      },
      aiPrompt:`BTC: $${btcP.toLocaleString()} | ${btcCh>=0?'+':''}${btcCh}% | F&G: ${fgVal}/100 (${fgLabel}) | FR: ${frPct}% (Ann: ${frAnn}%) | OI: $${(btcOI/1e9).toFixed(1)}B | L/S: ${longPct}%/${shortPct}% | MVRV: ${mvrv} (${mvrvLabel}) | Hash: ${hashRate}EH/s`,
      src:'bybit_all+bcinfo+altme'};
    CACHE.d=out;CACHE.t=Date.now();
    return res.status(200).json(out);
  }catch(e){
    return res.status(200).json({ok:false,error:String(e?.message||e),version:'v26',ts:Date.now(),elapsed:Date.now()-t0,bullBias:50,overallSignal:'⚖️ NEUTRAL',btcPrice:0,fgVal:50,fgLabel:'Neutral',lsRatio:null,frPct:0,oiVal:0,mvrvProxy:1.3,mvrvLabel:'Fair value',mvrvInterp:'',hashRate:0,blockH:0});
  }
}
