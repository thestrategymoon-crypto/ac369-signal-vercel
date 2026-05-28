// api/onchain.js — v25 ACCURATE · Real BTC/FR/LS/OI · Timeout Fixed
const CACHE={d:null,t:0};
export default async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Cache-Control','s-maxage=120,stale-while-revalidate=60');
  if(req.method==='OPTIONS')return res.status(200).end();
  const t0=Date.now();
  try{
    if(CACHE.d&&Date.now()-CACHE.t<120000)return res.status(200).json({...CACHE.d,cached:true,elapsed:Date.now()-t0});
    const g=async(url,ms=3000)=>{try{const c=new AbortController(),t=setTimeout(()=>c.abort(),ms);const r=await fetch(url,{signal:c.signal,headers:{Accept:'application/json','User-Agent':'AC369/25'}});clearTimeout(t);return r.ok?await r.json():null}catch{return null}};
    const[R0,R1,R2,R3,R4,R5]=await Promise.allSettled([
      g('https://api.bybit.com/v5/market/tickers?category=linear&symbol=BTCUSDT',3000),
      g('https://api.bybit.com/v5/market/account-ratio?category=linear&symbol=BTCUSDT&period=1h&limit=1',3000),
      g('https://api.bybit.com/v5/market/kline?category=linear&symbol=BTCUSDT&interval=D&limit=200',3000),
      g('https://api.alternative.me/fng/?limit=1&format=json',3000),
      g('https://blockchain.info/stats?format=json',3500),
      g('https://mempool.space/api/v1/fees/recommended',3000),
    ]);
    const N=(v,d=0)=>{const n=+v;return isNaN(n)||!isFinite(n)?d:n};
    const A=(v)=>Array.isArray(v)?v:[];

    // BTC price + FR + OI from Bybit ticker
    let btcP=0,btcFR=0,btcOI=0,btcCh=0,vol24=0;
    try{const tk=A(R0.value?.result?.list)[0];if(tk){btcP=N(tk.lastPrice);btcFR=N(tk.fundingRate);btcOI=N(tk.openInterestValue);vol24=N(tk.turnover24h);const prev=N(tk.prevPrice24h||tk.lastPrice);btcCh=prev>0?+((btcP-prev)/prev*100).toFixed(2):0}}catch{}

    // L/S ratio
    let longPct=null,shortPct=null,lsRatio=null,lsSig='';
    try{const row=A(R1.value?.result?.list)[0];if(row){longPct=+N(row.buyRatio*100).toFixed(2);shortPct=+N(row.sellRatio*100).toFixed(2);lsRatio=shortPct>0?+(longPct/shortPct).toFixed(3):null;if(lsRatio)lsSig=lsRatio<0.8?'🚀 Shorts dominan — squeeze':lsRatio<1.1?'⚖️ Balanced':lsRatio<1.8?'⚖️ Slight Long':lsRatio<2.5?'⚠️ Long Heavy':'🚨 Long Extreme'}}catch{}

    // MVRV proxy from daily klines
    let mvrv=1.3,mvrvLabel='Fair value',nuplProxy=0.255,soprProxy=1.01;
    try{const raw=A(R2.value?.result?.list);if(raw.length>=50&&btcP>0){const cls=raw.slice().reverse().map(d=>N(d[4])).filter(v=>v>0);const ma200=cls.slice(-200).reduce((s,v)=>s+v,0)/Math.min(200,cls.length);if(ma200>0){mvrv=+(btcP/ma200).toFixed(2);mvrvLabel=mvrv<0.8?'Undervalued 🟢':mvrv<1.2?'Fair Value':mvrv<2?'Overvalued ⚠️':'Expensive 🔴';nuplProxy=+((btcP-ma200)/btcP).toFixed(3);const p30=cls[cls.length-31]||cls[0];soprProxy=p30>0?+(btcP/p30).toFixed(3):1.01}}}catch{}

    // FG
    const fgVal=N(R3.value?.data?.[0]?.value,50);
    const fgLabel=R3.value?.data?.[0]?.value_classification||'Neutral';

    // Network (blockchain.info)
    let hashRate=0,blockH=0;
    try{const bc=R4.value;if(bc){hashRate=+(N(bc.hash_rate)/1e6).toFixed(1);blockH=N(bc.n_blocks_total)}}catch{}

    // Mempool fees
    let fastFee=2;
    try{const f=R5.value;if(f)fastFee=N(f.fastestFee)}catch{}

    // Overall signal
    let bullBias=50;
    if(fgVal<30)bullBias+=15;else if(fgVal>70)bullBias-=15;
    if(btcFR<-0.0003)bullBias+=15;else if(btcFR>0.0005)bullBias-=15;
    if(lsRatio!=null&&lsRatio<1)bullBias+=10;else if(lsRatio!=null&&lsRatio>2)bullBias-=10;
    if(mvrv<1.2)bullBias+=10;else if(mvrv>2)bullBias-=10;
    if(btcCh>0)bullBias+=5;else if(btcCh<0)bullBias-=5;
    bullBias=Math.max(5,Math.min(95,Math.round(bullBias/5)*5));
    const frPct=+(btcFR*100).toFixed(4),frAnn=+(frPct*3*365).toFixed(1);
    const halvingBlock=1050000,blocksLeft=Math.max(0,halvingBlock-(blockH||895000)),daysLeft=Math.round(blocksLeft/144);
    const out={ok:true,version:'v25',ts:Date.now(),elapsed:Date.now()-t0,
      btcPrice:btcP,btcChg24h:btcCh,
      fgVal,fgLabel,fgStatus:fgVal<=35?'Fear — akumulasi':fgVal>=65?'Greed — take profit':'Neutral',
      frPct,frAnn,frSig:btcFR<-0.0005?'💎 Short Squeeze setup':btcFR>0.0005?'⚠️ Long Heavy':'⚖️ Neutral FR',
      longPct,shortPct,lsRatio,lsSig,
      oiVal:+(btcOI/1e9).toFixed(2),oiLabel:btcOI>30e9?'HIGH':btcOI>15e9?'NORMAL':'LOW',
      mvrvProxy:mvrv,mvrvLabel,nuplProxy,nuplLabel:nuplProxy<0?'BELIEF LOSS':nuplProxy<0.25?'HOPE':nuplProxy<0.5?'BELIEF':'EUPHORIA',
      soprProxy,soprLabel:soprProxy<0.99?'Selling at Loss':soprProxy<1.01?'Break Even':'Selling at Profit',
      hashRate,hashRateT:hashRate>900?'ATH Zone 🔥':hashRate>600?'Sangat Tinggi':'Normal',
      blockH,mempoolTx:0,mempoolMB:0,fastFee,feeStatus:fastFee>50?'Mahal':fastFee>10?'Sedang':'Murah',
      halvingBlock,blocksLeft,daysLeft,halvingPct:blockH?+(blockH%210000/210000*100).toFixed(1):0,
      bullBias,overallSignal:bullBias>=70?'🟢 STRONG BULLISH':bullBias>=60?'🟩 MILD BULLISH':bullBias<=30?'🔴 BEARISH':bullBias<=40?'🟧 MILD BEARISH':'⚖️ NEUTRAL',
      btcDomPct:58,
      weeklyOutlook:{sentimentNote:`F&G ${fgVal} (${fgLabel}).`,derivNote:`FR ${frPct>=0?'+':''}${frPct}% (Ann: ${frAnn>=0?'+':''}${frAnn}%). OI: $${(btcOI/1e9).toFixed(1)}B.`,domNote:'BTC derivatives via Bybit.',trendNote:`BTC ${btcCh>=0?'+':''}${btcCh}% 24h.`},
      aiPrompt:`BTC: $${btcP.toLocaleString()} | ${btcCh>=0?'+':''}${btcCh}% | F&G: ${fgVal} | FR: ${frPct}% | OI: $${(btcOI/1e9).toFixed(1)}B | L/S: ${longPct}/${shortPct} | MVRV: ${mvrv}`,
      src:'bybit+bcinfo+altme'};
    CACHE.d=out;CACHE.t=Date.now();
    return res.status(200).json(out);
  }catch(e){
    return res.status(200).json({ok:false,error:String(e?.message||e),version:'v25',ts:Date.now(),elapsed:Date.now()-t0,bullBias:50,overallSignal:'⚖️ NEUTRAL',btcPrice:0,fgVal:50,fgLabel:'Neutral',lsRatio:null,frPct:0,oiVal:0,mvrvProxy:1.3,mvrvLabel:'Fair value'});
  }
}
