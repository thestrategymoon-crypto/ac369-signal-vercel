// api/onchain.js — v23 FIXED · All Parallel · Under 10s
// ═══════════════════════════════════════════════════════
// BUG FIX v23 vs v22:
// ❌ v22: Sequential fee call AFTER parallel batch → 7.5s+coldstart > 10s!
// ✅ v23: ALL calls truly parallel → max 4s total
// ✅ Cache 5 menit
// ✅ Semua timeout max 3.5s (leave room for cold start)
// ═══════════════════════════════════════════════════════

const N=(v,d=0)=>{const n=+v;return(isNaN(n)||!isFinite(n))?d:n;};
const A=(v)=>Array.isArray(v)?v:[];
const CACHE={data:null,ts:0};
const TTL=300000;

export default async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Cache-Control','s-maxage=300,stale-while-revalidate=60');
  if(req.method==='OPTIONS')return res.status(200).end();
  const t0=Date.now();
  if(CACHE.data&&Date.now()-CACHE.ts<TTL)
    return res.status(200).json({...CACHE.data,cached:true,elapsed:Date.now()-t0});

  const sf=async(url,ms=3500)=>{
    const c=new AbortController();const t=setTimeout(()=>c.abort(),ms);
    try{const r=await fetch(url,{signal:c.signal,headers:{Accept:'application/json','User-Agent':'AC369/23.0'}});clearTimeout(t);return r.ok?await r.json():null;}
    catch{clearTimeout(t);return null;}
  };

  try{
    // ALL TRULY PARALLEL — max 3.5s (tidak ada sequential!)
    const [byTR,byLSR,byKlR,bcR,mpR,feeR,fgR]=await Promise.allSettled([
      sf('https://api.bybit.com/v5/market/tickers?category=linear&symbol=BTCUSDT',3000),
      sf('https://api.bybit.com/v5/market/account-ratio?category=linear&symbol=BTCUSDT&period=1h&limit=1',3000),
      sf('https://api.bybit.com/v5/market/kline?category=linear&symbol=BTCUSDT&interval=D&limit=200',3500),
      sf('https://blockchain.info/stats?format=json',3500),
      sf('https://mempool.space/api/mempool',3000),
      sf('https://mempool.space/api/v1/fees/recommended',3000), // PARALLEL sekarang!
      sf('https://api.alternative.me/fng/?limit=1&format=json',3000),
    ]);

    // BTC PRICE + FR + OI
    let btcPrice=0,btcFR=0,btcOI=0,btcCh24=0,vol24=0;
    try{const t=byTR.value?.result?.list?.[0];if(t){btcPrice=N(t.lastPrice);btcFR=N(t.fundingRate);btcOI=N(t.openInterestValue);vol24=N(t.turnover24h);const prev=N(t.prevPrice24h||t.lastPrice);btcCh24=prev>0?+((btcPrice-prev)/prev*100).toFixed(2):0;}}catch{}

    // L/S
    let longPct=null,shortPct=null,lsRatio=null,lsSig='';
    try{const row=A(byLSR.value?.result?.list)[0];if(row){longPct=+N(row.buyRatio*100).toFixed(2);shortPct=+N(row.sellRatio*100).toFixed(2);lsRatio=shortPct>0?+(longPct/shortPct).toFixed(3):null;if(lsRatio!=null)lsSig=lsRatio<0.8?'🚀 Shorts dominan — squeeze potensi besar':lsRatio<1.1?'⚖️ Balanced':lsRatio<1.8?'⚖️ Slight Long':lsRatio<2.5?'⚠️ Long Heavy':'🚨 Long Extreme';}}catch{}

    // MVRV PROXY
    let mvrvProxy=1.3,mvrvLabel='Fair value',nuplProxy=0.255,soprProxy=1.01;
    try{const raw=A(byKlR.value?.result?.list);if(raw.length>=50&&btcPrice>0){const cls=raw.slice().reverse().map(d=>N(d[4])).filter(v=>v>0);const ma200=cls.slice(-200).reduce((s,v)=>s+v,0)/Math.min(200,cls.length);if(ma200>0){mvrvProxy=+(btcPrice/ma200).toFixed(2);mvrvLabel=mvrvProxy<0.8?'Undervalued 🟢':mvrvProxy<1.2?'Fair Value':mvrvProxy<2?'Overvalued ⚠️':'Expensive 🔴';nuplProxy=+((btcPrice-ma200)/btcPrice).toFixed(3);const p30=cls[cls.length-31]||cls[0];soprProxy=p30>0?+(btcPrice/p30).toFixed(3):1.01;}}}catch{}

    // BLOCKCHAIN.INFO
    let hashRate=0,blockH=0;
    try{const bc=bcR.value;if(bc){hashRate=+(N(bc.hash_rate)/1e6).toFixed(1);blockH=N(bc.n_blocks_total);}}catch{}

    // MEMPOOL
    let mempoolTx=0,mempoolMB=0;
    try{const m=mpR.value;if(m){mempoolTx=N(m.count);mempoolMB=+((N(m.vsize)||0)/1e6).toFixed(1);}}catch{}

    // FEE (dari parallel call)
    let fastFee=0;
    try{const f=feeR.value;if(f)fastFee=N(f.fastestFee);}catch{}

    // FEAR & GREED
    const fgVal=N(fgR.value?.data?.[0]?.value,50);
    const fgLabel=fgR.value?.data?.[0]?.value_classification||'Neutral';
    const fgStatus=fgVal<=25?'Fear — akumulasi bertahap':fgVal>=75?'Greed — take profit bertahap':'Neutral — selektif';

    // FR SIGNAL
    const frPct=+(btcFR*100).toFixed(4);
    const frAnn=+(frPct*3*365).toFixed(1);
    const frSig=btcFR<-0.0008?'🚀 EXTREME SQUEEZE — potensi reversal besar':btcFR<-0.0005?'💎 Short Squeeze setup':btcFR<-0.0002?'↘️ FR Negatif — shorts bayar':btcFR>0.0008?'🚨 OVERHEATED — longs extreme':btcFR>0.0005?'⚠️ Long Heavy':btcFR>0.0002?'↗️ Mild Long':'⚖️ Neutral FR';

    // HALVING
    const halvingBlock=1050000;const blocksLeft=Math.max(0,halvingBlock-(blockH||895000));
    const daysLeft=Math.round(blocksLeft/144);const halvingPct=blockH?+(blockH%210000/210000*100).toFixed(1):0;

    // OVERALL SIGNAL
    let bullBias=50;
    if(fgVal<30)bullBias+=15;else if(fgVal>70)bullBias-=15;
    if(btcFR<-0.0003)bullBias+=15;else if(btcFR>0.0005)bullBias-=15;
    if(lsRatio!=null&&lsRatio<1)bullBias+=10;else if(lsRatio!=null&&lsRatio>2)bullBias-=10;
    if(mvrvProxy<1.2)bullBias+=10;else if(mvrvProxy>2)bullBias-=10;
    if(btcCh24>0)bullBias+=5;else if(btcCh24<0)bullBias-=5;
    bullBias=Math.max(5,Math.min(95,Math.round(bullBias/5)*5));
    const overallSignal=bullBias>=70?'🟢 STRONG BULLISH':bullBias>=60?'🟩 MILD BULLISH — '+bullBias+'% Bull':bullBias<=30?'🔴 BEARISH':bullBias<=40?'🟧 MILD BEARISH':'⚖️ NEUTRAL';

    const aiPrompt=`Analisa BTC market: BTC: $${btcPrice.toLocaleString()} | ${btcCh24>=0?'+':''}${btcCh24}% | F&G: ${fgVal}/100 (${fgLabel}) | FR: ${frPct}% (Ann: ${frAnn}%) | OI: $${(btcOI/1e9).toFixed(1)}B | L/S: ${longPct}/${shortPct} | MVRV Proxy: ${mvrvProxy} | Hash: ${hashRate} EH/s`;

    const out={ok:true,ts:Date.now(),elapsed:Date.now()-t0,version:'v23',
      btcPrice,btcChg24h:btcCh24,vol24hPct:Math.abs(btcCh24),
      fgVal,fgLabel,fgStatus,frPct,frAnn,frSig,
      longPct,shortPct,lsRatio,lsSig,
      oiVal:+(btcOI/1e9).toFixed(2),oiLabel:btcOI>30e9?'HIGH':btcOI>15e9?'NORMAL':'LOW',
      mvrvProxy,mvrvLabel,nuplProxy,nuplLabel:nuplProxy<0?'BELIEF LOSS':nuplProxy<0.25?'HOPE':nuplProxy<0.5?'BELIEF':'EUPHORIA',
      soprProxy,soprLabel:soprProxy<0.99?'Selling at Loss':soprProxy<1.01?'Break Even':'Selling at Profit',
      hashRate,hashRateT:hashRate>900?'ATH Zone 🔥':hashRate>700?'Sangat Tinggi':'Normal',
      blockH,mempoolTx,mempoolMB,fastFee,feeStatus:fastFee>50?'Mahal':fastFee>10?'Sedang':'Murah',
      halvingBlock,blocksLeft,daysLeft,halvingPct,
      bullBias,overallSignal,btcDomPct:58,
      weeklyOutlook:{sentimentNote:`F&G ${fgVal} (${fgLabel}). ${fgStatus}.`,derivNote:`FR ${frPct>=0?'+':''}${frPct}% (Ann: ${frAnn>=0?'+':''}${frAnn}%). OI: $${(btcOI/1e9).toFixed(2)}B. ${frSig}.`,domNote:`BTC OI/derivatives data. ${btcCh24>=0?'Bullish momentum.':'Bearish pressure.'}`,trendNote:`BTC ${btcCh24>=0?'+':''}${btcCh24}% 24h. Volatilitas ${Math.abs(btcCh24)<2?'rendah':Math.abs(btcCh24)<5?'sedang':'tinggi'}.`},
      aiPrompt,src:'bybit+bcinfo+altme'};
    CACHE.data=out;CACHE.ts=Date.now();
    return res.status(200).json(out);
  }catch(e){
    return res.status(200).json({ok:false,error:e.message,ts:Date.now(),elapsed:Date.now()-t0,version:'v23',bullBias:50,overallSignal:'⚖️ NEUTRAL'});
  }
}
