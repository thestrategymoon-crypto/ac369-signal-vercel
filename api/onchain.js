// api/onchain.js — v24 MINIMAL RELIABLE · Bybit only
const CACHE = {data:null, ts:0};
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=120,stale-while-revalidate=60');
  if (req.method === 'OPTIONS') return res.status(200).end();
  const t0 = Date.now();
  if (CACHE.data && Date.now()-CACHE.ts < 120000) return res.status(200).json({...CACHE.data, cached:true, elapsed:Date.now()-t0});

  let btcPrice=0, btcFR=0, btcOI=0, longPct=null, shortPct=null, lsRatio=null, btcCh24=0;
  let fgVal=50, fgLabel='Neutral';
  let hashRate=0, blockH=0, mempoolTx=0, fastFee=2;

  try {
    const [t1,t2,t3] = await Promise.all([
      fetch('https://api.bybit.com/v5/market/tickers?category=linear&symbol=BTCUSDT').then(r=>r.ok?r.json():null).catch(()=>null),
      fetch('https://api.bybit.com/v5/market/account-ratio?category=linear&symbol=BTCUSDT&period=1h&limit=1').then(r=>r.ok?r.json():null).catch(()=>null),
      fetch('https://api.alternative.me/fng/?limit=1&format=json').then(r=>r.ok?r.json():null).catch(()=>null),
    ]);
    const tk = t1?.result?.list?.[0];
    if (tk) { btcPrice=parseFloat(tk.lastPrice)||0; btcFR=parseFloat(tk.fundingRate)||0; btcOI=parseFloat(tk.openInterestValue)||0; const prev=parseFloat(tk.prevPrice24h||tk.lastPrice); btcCh24=prev>0?parseFloat(((btcPrice-prev)/prev*100).toFixed(2)):0; }
    const lsRow = t2?.result?.list?.[0];
    if (lsRow) { longPct=parseFloat((lsRow.buyRatio*100).toFixed(2)); shortPct=parseFloat((lsRow.sellRatio*100).toFixed(2)); lsRatio=shortPct>0?parseFloat((longPct/shortPct).toFixed(3)):null; }
    if (t3) { fgVal=parseInt(t3?.data?.[0]?.value)||50; fgLabel=t3?.data?.[0]?.value_classification||'Neutral'; }
  } catch(e) {}

  // Try blockchain.info for network data
  try {
    const bc = await fetch('https://blockchain.info/stats?format=json').then(r=>r.ok?r.json():null).catch(()=>null);
    if (bc) { hashRate=parseFloat((bc.hash_rate/1e6).toFixed(1)); blockH=bc.n_blocks_total||0; }
  } catch(e) {}

  let bullBias = 50;
  if (fgVal<30) bullBias+=15; else if (fgVal>70) bullBias-=15;
  if (btcFR<-0.0003) bullBias+=15; else if (btcFR>0.0005) bullBias-=15;
  if (lsRatio!=null && lsRatio<1) bullBias+=10; else if (lsRatio!=null && lsRatio>2) bullBias-=10;
  if (btcCh24>0) bullBias+=5; else if (btcCh24<0) bullBias-=5;
  bullBias = Math.max(5, Math.min(95, Math.round(bullBias/5)*5));
  const overallSignal = bullBias>=70?'🟢 STRONG BULLISH':bullBias>=60?'🟩 MILD BULLISH':bullBias<=30?'🔴 BEARISH':bullBias<=40?'🟧 MILD BEARISH':'⚖️ NEUTRAL';
  const frPct = parseFloat((btcFR*100).toFixed(4));
  const halvingBlock=1050000, blocksLeft=Math.max(0,halvingBlock-(blockH||895000)), daysLeft=Math.round(blocksLeft/144);

  const out = {
    ok:true, version:'v24-minimal', ts:Date.now(), elapsed:Date.now()-t0,
    btcPrice, btcChg24h:btcCh24, vol24hPct:Math.abs(btcCh24),
    fgVal, fgLabel, fgStatus:fgVal<=35?'Fear — akumulasi':fgVal>=65?'Greed — take profit':'Neutral',
    frPct, frAnn:parseFloat((frPct*3*365).toFixed(1)),
    frSig:btcFR<-0.0005?'💎 Short Squeeze setup':btcFR>0.0005?'⚠️ Long Heavy':'⚖️ Neutral FR',
    longPct, shortPct, lsRatio,
    lsSig:lsRatio!=null?(lsRatio<0.8?'🚀 Shorts dominan':lsRatio<1.8?'⚖️ Balanced':lsRatio<2.5?'⚠️ Long Heavy':'🚨 Long Extreme'):'',
    oiVal:parseFloat((btcOI/1e9).toFixed(2)), oiLabel:btcOI>30e9?'HIGH':btcOI>15e9?'NORMAL':'LOW',
    mvrvProxy:1.3, mvrvLabel:'Fair value',
    nuplProxy:0.255, nuplLabel:'BELIEF',
    soprProxy:1.01, soprLabel:'Selling at Profit',
    hashRate, hashRateT:hashRate>900?'ATH Zone 🔥':hashRate>600?'Sangat Tinggi':'Normal',
    blockH, mempoolTx:0, mempoolMB:0, fastFee:2, feeStatus:'Murah',
    halvingBlock, blocksLeft, daysLeft, halvingPct:blockH?parseFloat((blockH%210000/210000*100).toFixed(1)):0,
    bullBias, overallSignal, btcDomPct:58,
    weeklyOutlook:{
      sentimentNote:`F&G ${fgVal} (${fgLabel}).`,
      derivNote:`FR ${frPct>=0?'+':''}${frPct}%. OI: $${(btcOI/1e9).toFixed(1)}B.`,
      domNote:'BTC derivatives data dari Bybit.',
      trendNote:`BTC ${btcCh24>=0?'+':''}${btcCh24}% 24h.`,
    },
    aiPrompt:`BTC: $${btcPrice.toLocaleString()} | ${btcCh24>=0?'+':''}${btcCh24}% | F&G: ${fgVal} | FR: ${frPct}% | OI: $${(btcOI/1e9).toFixed(1)}B | L/S: ${longPct}/${shortPct}`,
    src:'bybit+altme',
  };
  CACHE.data=out; CACHE.ts=Date.now();
  return res.status(200).json(out);
}
