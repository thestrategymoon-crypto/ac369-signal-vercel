// api/onchain.js — v21
// FR + OI  : OKX public API (Bybit terbukti diblokir dari Vercel)
// L/S      : Bybit /account-ratio (try) + FR estimation fallback
// Price    : CoinGecko markets ✅
// Network  : mempool.space ✅

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=10');
  if (req.method === 'OPTIONS') return res.status(200).end();
  const t0 = Date.now();

  const sf = async (url, ms) => {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), ms);
    try {
      const r = await fetch(url, { signal: c.signal, headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 AC369/1.0' } });
      clearTimeout(t); if (!r.ok) return null; return await r.json();
    } catch { clearTimeout(t); return null; }
  };

  try {
    const [cgPriceR, fngR, cgGlobalR, okxFRR, okxFRETHR, okxOIR, byLSR, byTickR, memR, feesR] = await Promise.allSettled([
      sf('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=bitcoin,ethereum&sparkline=false&price_change_percentage=24h', 5000),
      sf('https://api.alternative.me/fng/?limit=1&format=json', 4000),
      sf('https://api.coingecko.com/api/v3/global', 4000),
      sf('https://www.okx.com/api/v5/public/funding-rate?instId=BTC-USDT-SWAP', 5000),
      sf('https://www.okx.com/api/v5/public/funding-rate?instId=ETH-USDT-SWAP', 4000),
      sf('https://www.okx.com/api/v5/public/open-interest?instType=SWAP&instId=BTC-USDT-SWAP', 5000),
      sf('https://api.bybit.com/v5/market/account-ratio?category=linear&symbol=BTCUSDT&period=1h&limit=1', 5000),
      sf('https://api.bybit.com/v5/market/tickers?category=linear&symbol=BTCUSDT', 4000),
      sf('https://mempool.space/api/mempool', 5000),
      sf('https://mempool.space/api/v1/fees/recommended', 4000),
    ]);

    const [hashR, blockHR] = await Promise.allSettled([
      sf('https://mempool.space/api/v1/mining/hashrate/3d', 5000),
      sf('https://mempool.space/api/blocks/tip/height', 4000),
    ]);

    // Price
    const cgCoins = cgPriceR.status==='fulfilled'&&Array.isArray(cgPriceR.value)?cgPriceR.value:[];
    const btcCG   = cgCoins.find(c=>c.id==='bitcoin');
    const ethCG   = cgCoins.find(c=>c.id==='ethereum');
    const byTick  = byTickR.status==='fulfilled'?byTickR.value?.result?.list?.[0]:null;
    const btcPrice  = btcCG?.current_price||(byTick?.lastPrice?+byTick.lastPrice:0);
    const ethPrice  = ethCG?.current_price||0;
    const btcChg24  = btcCG?.price_change_percentage_24h?+btcCG.price_change_percentage_24h.toFixed(2):0;
    const ethChg24  = ethCG?.price_change_percentage_24h?+ethCG.price_change_percentage_24h.toFixed(2):0;
    const btcVol    = btcCG?.total_volume||0;
    const btcMCap   = btcCG?.market_cap||0;
    const btcH24    = btcCG?.high_24h||btcPrice*1.02;
    const btcL24    = btcCG?.low_24h||btcPrice*0.98;
    const vol24hPct = btcPrice>0&&btcH24>btcL24?+((btcH24-btcL24)/btcPrice*100).toFixed(2):0;

    // OKX Funding Rate: { data: [{ fundingRate, nextFundingRate, fundingTime, nextFundingTime }] }
    const okxFR    = okxFRR.status==='fulfilled'?okxFRR.value?.data?.[0]:null;
    const okxFRETH = okxFRETHR.status==='fulfilled'?okxFRETHR.value?.data?.[0]:null;
    const frRaw    = okxFR?.fundingRate?parseFloat(okxFR.fundingRate):null;
    const frNext   = okxFR?.nextFundingRate?parseFloat(okxFR.nextFundingRate):null;
    const ethFrRaw = okxFRETH?.fundingRate?parseFloat(okxFRETH.fundingRate):null;
    const frPct    = frRaw!==null?+(frRaw*100).toFixed(4):null;
    const frNextPct= frNext!==null?+(frNext*100).toFixed(4):null;
    const frAnn    = frRaw!==null?+(frRaw*100*3*365).toFixed(1):null;
    const ethFrPct = ethFrRaw!==null?+(ethFrRaw*100).toFixed(4):null;
    let frNextTimeStr='—';
    if(okxFR?.nextFundingTime){const ms=parseInt(okxFR.nextFundingTime)-Date.now();if(ms>0){const h=Math.floor(ms/3600000);const m=Math.floor((ms%3600000)/60000);frNextTimeStr=`${h}h ${m}m`;}}
    const frSig = frPct===null?'—':frPct<-0.02?'🔥 EXTREME NEGATIVE — short squeeze sangat mungkin':frPct<-0.01?'⚡ Negative FR — long setup terbaik':frPct<-0.003?'🟢 Mild Negative — slight bullish':frPct<0.003?'⚖️ Netral':frPct<0.02?'⚠️ Positive — long mulai dominan':frPct<0.05?'⚠️ Elevated Longs — hati-hati':'🔴 Overloaded Longs — liquidation risk';
    const frTrend = frPct!==null&&frNextPct!==null?(frNextPct>frPct?'↗️ FR naik (longs increasing)':frNextPct<frPct?'↘️ FR turun (longs decreasing)':'→ FR stabil'):'—';

    // OKX OI: { data: [{ oi, oiCcy (in BTC), ts }] }
    const okxOI = okxOIR.status==='fulfilled'?okxOIR.value?.data?.[0]:null;
    let oiVal=null,oiLabel='—',oiDetail='—';
    if(okxOI?.oiCcy&&btcPrice>0){
      const oiBTC=parseFloat(okxOI.oiCcy);
      const oiUSD=oiBTC*btcPrice;
      oiVal=+(oiUSD/1e9).toFixed(2);
      oiLabel=oiVal>30?'VERY HIGH — market overleveraged':oiVal>20?'HIGH — leverage aktif':oiVal>10?'NORMAL — sehat':'LOW';
      const oiMcap=btcMCap>0?+(oiUSD/btcMCap*100).toFixed(1):0;
      oiDetail=`$${oiVal}B | ~${oiBTC.toFixed(0)} BTC | OI/MCap: ${oiMcap}%`;
    } else if(byTick?.openInterestValue){
      const oiRaw=parseFloat(byTick.openInterestValue);
      if(oiRaw>0){oiVal=+(oiRaw/1e9).toFixed(2);oiLabel=oiVal>30?'VERY HIGH':oiVal>20?'HIGH':oiVal>10?'NORMAL':'LOW';}
    }

    // L/S
    let lsRatio=null,longPct=null,shortPct=null,lsSig='—',lsDetail='—';
    const byLS=byLSR.status==='fulfilled'?byLSR.value?.result?.list?.[0]:null;
    if(byLS?.buyRatio){
      const b=parseFloat(byLS.buyRatio),s=1-b;
      lsRatio=+(b/s).toFixed(3);longPct=+(b*100).toFixed(1);shortPct=+(s*100).toFixed(1);
      lsSig=lsRatio<0.5?'⚡ Shorts sangat dominan — squeeze imminent':lsRatio<0.75?'🟢 Short bias — bullish lean':lsRatio<0.9?'🟢 Slight short bias':lsRatio<1.1?'⚖️ Balanced':lsRatio<1.5?'⚠️ Slight long bias':lsRatio<2?'⚠️ Long dominan':'🔴 Long overloaded';
      lsDetail=`${longPct}% Long / ${shortPct}% Short | Ratio: ${lsRatio}`;
    } else if(frRaw!==null){
      longPct=+Math.max(30,Math.min(75,50+frRaw*600)).toFixed(1);
      shortPct=+(100-longPct).toFixed(1);
      lsRatio=+(longPct/shortPct).toFixed(3);
      lsSig=longPct<45?'🟢 Short bias (~est from FR)':longPct>60?'⚠️ Long bias (~est from FR)':'⚖️ Balanced (~est from FR)';
      lsDetail=`~${longPct}% Long / ~${shortPct}% Short (estimated from FR)`;
    }

    // Derivatives signal composite
    let derivScore=0;
    if(frPct!==null){if(frPct<-0.02)derivScore+=3;else if(frPct<-0.01)derivScore+=2;else if(frPct<0)derivScore+=1;else if(frPct>0.05)derivScore-=3;else if(frPct>0.02)derivScore-=2;else if(frPct>0.01)derivScore-=1;}
    if(lsRatio!==null){if(lsRatio<0.7)derivScore+=2;else if(lsRatio<0.9)derivScore+=1;else if(lsRatio>2)derivScore-=2;else if(lsRatio>1.5)derivScore-=1;}
    const derivSignal=derivScore>=3?'🔥 Extreme bullish setup':derivScore>=2?'🟢 Bullish derivatives':derivScore>=1?'🟢 Mild bullish':derivScore<=-3?'🔴 Extreme bearish':derivScore<=-2?'🔴 Bearish':derivScore<=-1?'⚠️ Mild bearish':'⚖️ Neutral';

    // F&G
    const fng=fngR.status==='fulfilled'?fngR.value:null;
    const fgVal=fng?.data?.[0]?parseInt(fng.data[0].value):50;
    const fgLabel=fng?.data?.[0]?.value_classification||'Neutral';
    const fgStatus=fgVal<=20?'🔥 Extreme Fear — zona akumulasi terbaik':fgVal<=40?'😨 Fear — akumulasi bertahap':fgVal<=60?'😐 Netral':fgVal<=80?'😄 Greed — waspada':'🤑 Extreme Greed — distribusi';

    // Dom
    const cgG=cgGlobalR.status==='fulfilled'?cgGlobalR.value?.data:null;
    const btcDomPct=cgG?.market_cap_percentage?.btc?+cgG.market_cap_percentage.btc.toFixed(2):58;
    const ethDomPct=cgG?.market_cap_percentage?.eth?+cgG.market_cap_percentage.eth.toFixed(2):12;
    const totalMC=cgG?.total_market_cap?.usd||0;

    // Onchain
    const REALIZED=56576;
    const mvrvProxy=btcPrice>0?+(btcPrice/REALIZED).toFixed(2):null;
    const mvrvLabel=!mvrvProxy?'—':mvrvProxy<0.8?'🔥 Strong undervalue':mvrvProxy<1.2?'🟢 Fair value (cheap)':mvrvProxy<2?'⚖️ Fair value':mvrvProxy<3?'⚠️ Extended':mvrvProxy<4?'🔴 Expensive':'💀 Bubble';
    const nupl=btcPrice>0?+Math.min(0.95,Math.max(-0.5,(btcPrice-REALIZED)/btcPrice)).toFixed(3):null;
    const nuplLabel=nupl===null?'—':nupl<-0.25?'💎 CAPITULATION':nupl<0?'🌱 HOPE':nupl<0.25?'📈 OPTIMISM':nupl<0.5?'🔥 BELIEF':nupl<0.75?'⚠️ THRILL':'🔴 EUPHORIA';
    const sopr=btcChg24!==0?+(1+btcChg24/100).toFixed(3):1.000;
    const soprLabel=sopr>=1.015?'📤 PROFIT TAKING':sopr>=1.003?'↑ Mild Profit':sopr>=0.990?'↔️ BREAKEVEN':sopr>=0.970?'↓ Mild Loss':'📉 LOSS SELLING';

    // Network
    const mem=memR.status==='fulfilled'?memR.value:null;
    const fees=feesR.status==='fulfilled'?feesR.value:null;
    const hash=hashR.status==='fulfilled'?hashR.value:null;
    const blockH=typeof blockHR.value==='number'?blockHR.value:typeof blockHR.value==='string'?parseInt(blockHR.value):849671;
    const hashRate=hash?.currentHashrate?+(hash.currentHashrate/1e18).toFixed(1):null;
    const hashRateT=hashRate?(hashRate>700?'ATH Zone 🔥':hashRate>550?'Very High':hashRate>400?'High':'Normal'):'—';
    const fastFee=fees?.fastestFee||null;
    const feeStatus=fastFee?(fastFee>100?'🔴 Mahal':fastFee>40?'⚠️ Sedang':fastFee>10?'🟡 Reasonable':'🟢 Murah'):'—';
    const HALVING_NEXT=1050000;
    const bLeft=Math.max(0,HALVING_NEXT-blockH);
    const dLeft=Math.round(bLeft*10/60/24);
    const halvPct=+Math.min(100,Math.max(0,(blockH-840000)/(HALVING_NEXT-840000)*100)).toFixed(1);
    const halvLabel=halvPct<25?'Post-Halving Early':halvPct<50?'Bull Cycle Early 🔥':halvPct<65?'Bull Peak Zone ⚡':halvPct<85?'Late Bull / Distribution ⚠️':'Pre-Halving';

    // Bull/Bear
    let bull=40,bear=40;
    if(fgVal<=20)bull+=20;else if(fgVal<=35)bull+=12;else if(fgVal<=45)bull+=6;
    else if(fgVal>=80)bear+=20;else if(fgVal>=65)bear+=12;else if(fgVal>=55)bear+=6;
    if(frPct!==null){if(frPct<-0.02)bull+=20;else if(frPct<-0.01)bull+=14;else if(frPct<0)bull+=7;else if(frPct>0.08)bear+=20;else if(frPct>0.04)bear+=14;else if(frPct>0.02)bear+=7;}
    if(lsRatio!==null){if(lsRatio<0.65)bull+=15;else if(lsRatio<0.9)bull+=8;else if(lsRatio>2.0)bear+=15;else if(lsRatio>1.5)bear+=8;}
    if(btcChg24>8)bull+=12;else if(btcChg24>3)bull+=7;else if(btcChg24>0)bull+=3;
    else if(btcChg24<-8)bear+=12;else if(btcChg24<-3)bear+=7;else if(btcChg24<0)bear+=3;
    if(mvrvProxy){if(mvrvProxy<0.8)bull+=18;else if(mvrvProxy<1.2)bull+=10;else if(mvrvProxy>4)bear+=18;else if(mvrvProxy>2.5)bear+=10;}
    const total=bull+bear;
    const bullBias=total>0?Math.round(bull/total*100):50;
    const overallSignal=bullBias>=75?'🔥 STRONG BULLISH':bullBias>=62?'📈 BULLISH':bullBias>=55?'🟢 MILD BULLISH':bullBias<=25?'💀 STRONG BEARISH':bullBias<=38?'📉 BEARISH':bullBias<=45?'🔴 MILD BEARISH':'⚖️ NEUTRAL';

    const wkSentiment=`F&G ${fgVal}/100 (${fgLabel}). ${fgStatus}`;
    const wkDeriv=frPct!==null?`FR (OKX): ${frPct}% per 8h (ann ${frAnn}%). Next FR: ${frNextPct??'—'}% in ${frNextTimeStr}. ${frTrend}. OI: ${oiDetail}. L/S: ${lsDetail}. ${derivSignal}.`:`Derivatives: koneksi OKX/Bybit timeout. Mencoba ulang otomatis.`;
    const wkDom=`BTC Dom ${btcDomPct}% | ETH Dom ${ethDomPct}% | MCap ${totalMC>0?'$'+(totalMC/1e12).toFixed(2)+'T':'N/A'}. ${btcDomPct>58?'BTC season.':btcDomPct<45?'Altcoin season 🚀':'Transisi.'}`;
    const wkTrend=`BTC ${btcChg24>=0?'+':''}${btcChg24}% | Vol $${(btcVol/1e9).toFixed(1)}B | Volatility ${vol24hPct}%. ${Math.abs(btcChg24)<0.3?'Compression — breakout imminent.':btcChg24>3?'Momentum bullish aktif.':btcChg24<-3?'Tekanan jual aktif.':'Low volatility.'}`;

    const aiPrompt=[
      'Analisa BTC market berikut seperti hedge fund analyst institusional:',
      `BTC: $${btcPrice.toLocaleString('en-US',{maximumFractionDigits:0})} | ${btcChg24>=0?'+':''}${btcChg24}% | Vol $${(btcVol/1e9).toFixed(1)}B`,
      `F&G: ${fgVal}/100 (${fgLabel}) | BTC Dom: ${btcDomPct}%`,
      `FR (OKX): ${frPct??'N/A'}% per 8h | Ann: ${frAnn??'N/A'}% | ${frSig}`,
      `Next FR: ${frNextPct??'N/A'}% in ${frNextTimeStr} | Trend: ${frTrend}`,
      `L/S: ${lsDetail} | ${lsSig}`,
      `OI: ${oiDetail} | ${oiLabel}`,
      `Derivatives signal: ${derivSignal} (score: ${derivScore})`,
      `MVRV: ${mvrvProxy??'N/A'} (${mvrvLabel}) | NUPL: ${nupl??'N/A'} (${nuplLabel}) | SOPR: ${sopr} (${soprLabel})`,
      `Hash: ${hashRate??'—'} EH/s | Block: #${blockH.toLocaleString()} | Fee: ${fastFee??'—'} sat/vB | ${halvLabel}`,
      `Bull/Bear: ${bull}/${bear} | ${bullBias}% Bull | ${overallSignal}`,
      '','Format: 1.Kondisi sekarang 2.Key risk 3.Posisi optimal 4.Level kunci. Bahasa Indonesia.',
    ].join('\n');

    return res.status(200).json({
      ok:true,ts:Date.now(),elapsed:Date.now()-t0,version:'v21',dataOk:btcPrice>0,
      sources:['CoinGecko','OKX (FR+OI)','Bybit (L/S)','Alternative.me','mempool.space'],
      frSource:frPct!==null?'OKX':'unavailable',oiSource:oiVal!==null?'OKX':'unavailable',
      btcPrice,btcChg24h:btcChg24,btcVol,btcMCap,btcH24,btcL24,vol24hPct,
      ethPrice,ethChg24h:ethChg24,ethFrPct,
      frPct,frNextPct,frNextTime:frNextTimeStr,frAnn,frSig,frTrend,
      oiVal,oiLabel,oiDetail,
      lsRatio,longPct,shortPct,lsSig,lsDetail,derivScore,derivSignal,
      fgVal,fgLabel,fgStatus,btcDomPct,ethDomPct,totalMC,
      mvrvProxy,mvrvLabel,nuplProxy:nupl,nuplLabel,soprProxy:sopr,soprLabel,
      blockH,hashRate,hashRateT,halvPct,halvLabel,
      mempoolTx:mem?.count||null,mempoolMB:mem?.vsize?+(mem.vsize/1e6).toFixed(1):null,
      fastFee,feeStatus,blocksLeft:bLeft,daysLeft:dLeft,
      bullPts:bull,bearPts:bear,bullBias,overallSignal,
      weeklyOutlook:{sentimentNote:wkSentiment,derivNote:wkDeriv,domNote:wkDom,trendNote:wkTrend},
      aiPrompt,
    });

  } catch(e) {
    return res.status(200).json({ok:false,error:e.message,ts:Date.now(),elapsed:Date.now()-t0,version:'v21',dataOk:false,btcPrice:0,ethPrice:0,fgVal:50,fgLabel:'Neutral',fgStatus:'—',frPct:null,frSig:'—',oiVal:null,oiLabel:'—',lsRatio:null,longPct:null,shortPct:null,lsSig:'—',mvrvProxy:null,mvrvLabel:'—',nuplProxy:null,nuplLabel:'—',soprProxy:null,soprLabel:'—',btcDomPct:58,blockH:849671,hashRate:null,mempoolTx:null,fastFee:null,blocksLeft:200329,daysLeft:1391,halvingPct:10,bullBias:50,overallSignal:'⚖️ NEUTRAL',weeklyOutlook:{},aiPrompt:'',derivScore:0,derivSignal:'—'});
  }
}
