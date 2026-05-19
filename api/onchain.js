// api/onchain.js — v20
// BTC Price: CoinGecko markets (WORKING ✅)
// FR: Bybit /funding/history (dedicated endpoint)
// OI: Bybit /open-interest (dedicated endpoint)
// L/S: Bybit /account-ratio (dedicated endpoint)
// Network: mempool.space (WORKING ✅)

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=10');
  if (req.method === 'OPTIONS') return res.status(200).end();
  const t0 = Date.now();

  const sf = async (url, ms) => {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), ms);
    try {
      const r = await fetch(url, { signal: c.signal, headers: { Accept: 'application/json', 'User-Agent': 'AC369/1.0' } });
      clearTimeout(t); if (!r.ok) return null; return await r.json();
    } catch { clearTimeout(t); return null; }
  };

  try {
    // ── WAVE 1: All parallel (9 calls) ────────────────────
    const [
      cgPriceR,   // CoinGecko: BTC + ETH price (WORKING)
      fngR,       // Alternative.me: F&G (WORKING)
      cgGlobalR,  // CoinGecko: global (WORKING)
      byFRR,      // Bybit: Funding Rate via /funding/history
      byOIR,      // Bybit: Open Interest via /open-interest
      byLSR,      // Bybit: Long/Short via /account-ratio
      byTickR,    // Bybit: ticker (backup for price + ETH FR)
      memR,       // mempool.space: mempool
      feesR,      // mempool.space: fees
    ] = await Promise.allSettled([
      sf('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=bitcoin,ethereum&sparkline=false&price_change_percentage=24h', 5000),
      sf('https://api.alternative.me/fng/?limit=1&format=json', 4000),
      sf('https://api.coingecko.com/api/v3/global', 4000),
      // Dedicated Bybit funding rate endpoint (different from ticker)
      sf('https://api.bybit.com/v5/market/funding/history?category=linear&symbol=BTCUSDT&limit=1', 5000),
      // Dedicated Bybit open interest endpoint
      sf('https://api.bybit.com/v5/market/open-interest?category=linear&symbol=BTCUSDT&intervalTime=1h&limit=1', 5000),
      // Long/Short ratio
      sf('https://api.bybit.com/v5/market/account-ratio?category=linear&symbol=BTCUSDT&period=1h&limit=1', 4000),
      // Ticker (backup — for ETH FR + OI backup)
      sf('https://api.bybit.com/v5/market/tickers?category=linear&symbol=BTCUSDT', 5000),
      sf('https://mempool.space/api/mempool', 5000),
      sf('https://mempool.space/api/v1/fees/recommended', 4000),
    ]);

    // Wave 2: hashrate + block height
    const [hashR, blockHR] = await Promise.allSettled([
      sf('https://mempool.space/api/v1/mining/hashrate/3d', 5000),
      sf('https://mempool.space/api/blocks/tip/height', 4000),
    ]);

    // ── BTC/ETH PRICE dari CoinGecko ──────────────────────
    const cgCoins = cgPriceR.status==='fulfilled' && Array.isArray(cgPriceR.value) ? cgPriceR.value : [];
    const btcCG   = cgCoins.find(c => c.id==='bitcoin');
    const ethCG   = cgCoins.find(c => c.id==='ethereum');
    const byTick  = byTickR.status==='fulfilled' ? byTickR.value?.result?.list?.[0] : null;

    const btcPrice = btcCG?.current_price  || (byTick?.lastPrice ? +byTick.lastPrice : 0);
    const ethPrice = ethCG?.current_price  || 0;
    const btcChg24 = btcCG?.price_change_percentage_24h
      ? +btcCG.price_change_percentage_24h.toFixed(2)
      : (byTick?.price24hPcnt ? +(parseFloat(byTick.price24hPcnt)*100).toFixed(2) : 0);
    const ethChg24 = ethCG?.price_change_percentage_24h
      ? +ethCG.price_change_percentage_24h.toFixed(2) : 0;
    const btcVol   = btcCG?.total_volume   || (byTick?.turnover24h ? +byTick.turnover24h : 0);
    const btcMCap  = btcCG?.market_cap     || 0;
    const btcH24   = btcCG?.high_24h       || btcPrice*1.02;
    const btcL24   = btcCG?.low_24h        || btcPrice*0.98;
    const vol24hPct = btcPrice>0 && btcH24>btcL24 ? +((btcH24-btcL24)/btcPrice*100).toFixed(2) : 0;

    // ── FUNDING RATE dari /funding/history ─────────────────
    // Response: { result: { list: [{ fundingRate: "0.0001", fundingRateTimestamp: "..." }] } }
    const frHistList = byFRR.status==='fulfilled' ? byFRR.value?.result?.list : null;
    const frHistItem = Array.isArray(frHistList) ? frHistList[0] : null;

    // Also check ticker as backup
    const frFromTicker = byTick?.fundingRate ? parseFloat(byTick.fundingRate) : null;
    const frRaw = frHistItem?.fundingRate
      ? parseFloat(frHistItem.fundingRate)
      : frFromTicker;

    const frPct = frRaw !== null ? +(frRaw*100).toFixed(4) : null;
    const frAnn = frRaw !== null ? +(frRaw*100*3*365).toFixed(1) : null;
    const frSig = frPct===null   ? '—'
                : frPct<-0.01   ? '⚡ Short Squeeze Setup!'
                : frPct<-0.003  ? '🟢 Negative FR — squeeze potential'
                : frPct<0.003   ? '⚖️ Netral'
                : frPct<0.02    ? '⚠️ Long Bias'
                : frPct<0.05    ? '⚠️ Overleveraged Longs'
                :                 '🔴 EXTREME — long liquidation risk';

    // ── OPEN INTEREST dari /open-interest ──────────────────
    // Response: { result: { list: [{ openInterest: "123456789", timestamp: "..." }] } }
    let oiVal=null, oiLabel='—';
    const oiList = byOIR.status==='fulfilled' ? byOIR.value?.result?.list : null;
    const oiItem = Array.isArray(oiList) ? oiList[0] : null;
    if (oiItem?.openInterest && btcPrice>0) {
      // openInterest is in contracts (BTC). Convert to USD
      const oiBTC = parseFloat(oiItem.openInterest);
      const oiUSD = oiBTC * btcPrice;
      oiVal   = +(oiUSD/1e9).toFixed(2);
      oiLabel = oiVal>30?'VERY HIGH — crowded':oiVal>20?'HIGH — leverage aktif':oiVal>10?'NORMAL — healthy':'LOW';
    } else if (byTick?.openInterestValue) {
      // Fallback: dari ticker
      const oiRaw = parseFloat(byTick.openInterestValue);
      if (oiRaw>0){oiVal=+(oiRaw/1e9).toFixed(2);oiLabel=oiVal>30?'VERY HIGH':oiVal>20?'HIGH':oiVal>10?'NORMAL':'LOW';}
    }

    // ETH FR dari ticker (backup)
    const ethFrRaw = byTick?.fundingRate ? parseFloat(byTick.fundingRate) : null;
    const ethFrPct = null; // separate ETH call not done in this batch

    // ── LONG / SHORT dari /account-ratio ──────────────────
    let lsRatio=null, longPct=null, shortPct=null, lsSig='—';
    const byLS = byLSR.status==='fulfilled' ? byLSR.value?.result?.list?.[0] : null;
    if (byLS?.buyRatio) {
      const b=parseFloat(byLS.buyRatio), s=1-b;
      lsRatio=+(b/s).toFixed(3); longPct=+(b*100).toFixed(1); shortPct=+(s*100).toFixed(1);
      lsSig=lsRatio<0.65?'⚡ Short overloaded — squeeze pending':lsRatio<0.9?'🟢 Slight short bias':lsRatio>2.2?'🔴 Long overloaded — dump risk':lsRatio>1.5?'⚠️ Slight long bias':'⚖️ Balanced';
    } else if (frRaw!==null) {
      longPct=+Math.max(35,Math.min(72,52+frRaw*300)).toFixed(1);
      shortPct=+(100-longPct).toFixed(1);
      lsRatio=+(longPct/shortPct).toFixed(3);
      lsSig='~Estimated from FR';
    }

    // ── F&G ────────────────────────────────────────────────
    const fng=fngR.status==='fulfilled'?fngR.value:null;
    const fgVal=fng?.data?.[0]?parseInt(fng.data[0].value):50;
    const fgLabel=fng?.data?.[0]?.value_classification||'Neutral';
    const fgStatus=fgVal<=20?'🔥 Extreme Fear — zona beli terkuat':fgVal<=45?'😨 Fear — akumulasi bertahap':fgVal>=80?'🤑 Extreme Greed — distribusi':fgVal>=65?'😄 Greed — waspada':'😐 Neutral';

    // ── BTC DOM ────────────────────────────────────────────
    const cgG=cgGlobalR.status==='fulfilled'?cgGlobalR.value?.data:null;
    const btcDomPct=cgG?.market_cap_percentage?.btc?+cgG.market_cap_percentage.btc.toFixed(1):58;
    const totalMC=cgG?.total_market_cap?.usd||0;

    // ── ONCHAIN PROXIES ────────────────────────────────────
    const REALIZED=56576;
    const mvrvProxy=btcPrice>0?+(btcPrice/REALIZED).toFixed(2):null;
    const mvrvLabel=!mvrvProxy?'—':mvrvProxy<0.8?'🔥 Extreme Undervalue':mvrvProxy<1.2?'🟢 Fair value — cheap zone':mvrvProxy<1.8?'⚖️ Fair value zone':mvrvProxy<2.5?'⚠️ Extended':mvrvProxy<3.5?'🔴 Bubble territory':'💀 Extreme bubble';
    const nupl=btcPrice>0?+Math.min(0.95,Math.max(-0.5,(btcPrice-REALIZED)/btcPrice)).toFixed(3):null;
    const nuplLabel=nupl===null?'—':nupl<-0.25?'💎 CAPITULATION':nupl<0?'🌱 HOPE':nupl<0.25?'📈 OPTIMISM':nupl<0.5?'🔥 BELIEF':nupl<0.75?'⚠️ THRILL':'🔴 EUPHORIA';
    const sopr=btcChg24!==0?+(1+btcChg24/100).toFixed(3):1.000;
    const soprLabel=sopr>=1.015?'📤 PROFIT TAKING':sopr>=1.003?'↑ MILD PROFIT':sopr>=0.990?'↔️ BREAKEVEN':sopr>=0.970?'↓ MILD LOSS':'📉 LOSS SELLING';

    // ── NETWORK ────────────────────────────────────────────
    const mem=memR.status==='fulfilled'?memR.value:null;
    const fees=feesR.status==='fulfilled'?feesR.value:null;
    const hash=hashR.status==='fulfilled'?hashR.value:null;
    const blockH=typeof blockHR.value==='number'?blockHR.value:typeof blockHR.value==='string'?parseInt(blockHR.value):849671;
    const hashRate=hash?.currentHashrate?+(hash.currentHashrate/1e18).toFixed(1):null;
    const hashRateT=hashRate?(hashRate>700?'ATH Zone 🔥':hashRate>550?'Very High':hashRate>400?'High':'Normal'):'—';
    const mempoolTx=mem?.count||null;
    const mempoolMB=mem?.vsize?+(mem.vsize/1e6).toFixed(1):null;
    const fastFee=fees?.fastestFee||null;
    const feeStatus=fastFee?(fastFee>100?'🔴 Sangat Mahal':fastFee>40?'⚠️ Mahal':fastFee>15?'🟡 Sedang':'🟢 Murah'):'—';
    const HALVING_NEXT=1050000;
    const bLeft=Math.max(0,HALVING_NEXT-blockH);
    const dLeft=Math.round(bLeft*10/60/24);
    const halvPct=+Math.min(100,Math.max(0,(blockH-840000)/(HALVING_NEXT-840000)*100)).toFixed(1);

    // ── BULL/BEAR ──────────────────────────────────────────
    let bull=40,bear=40;
    if(fgVal<=20)bull+=20;else if(fgVal<=35)bull+=10;else if(fgVal<=45)bull+=5;
    else if(fgVal>=80)bear+=20;else if(fgVal>=65)bear+=10;else if(fgVal>=55)bear+=5;
    if(frPct!==null){if(frPct<-0.01)bull+=20;else if(frPct<-0.003)bull+=10;else if(frPct<0)bull+=5;else if(frPct>0.08)bear+=20;else if(frPct>0.04)bear+=10;else if(frPct>0.02)bear+=5;}
    if(lsRatio!==null){if(lsRatio<0.65)bull+=15;else if(lsRatio<0.9)bull+=8;else if(lsRatio>2.0)bear+=15;else if(lsRatio>1.5)bear+=8;}
    if(btcChg24>5)bull+=10;else if(btcChg24>2)bull+=5;else if(btcChg24<-5)bear+=10;else if(btcChg24<-2)bear+=5;
    if(mvrvProxy){if(mvrvProxy<0.8)bull+=15;else if(mvrvProxy<1.2)bull+=8;else if(mvrvProxy>4.0)bear+=15;else if(mvrvProxy>2.5)bear+=8;}
    const total=bull+bear;
    const bullBias=total>0?Math.round(bull/total*100):50;
    const overallSignal=bullBias>=72?'📈 STRONG BULLISH':bullBias>=60?'🟢 BULLISH':bullBias<=28?'📉 STRONG BEARISH':bullBias<=40?'🔴 BEARISH':'⚖️ NEUTRAL';

    // ── WEEKLY OUTLOOK ─────────────────────────────────────
    const wkSentiment=`F&G ${fgVal}/100 (${fgLabel}).\n${fgStatus}`;
    const wkDeriv=frPct!==null
      ? `Funding ${frPct}% per 8h.\nL/S: ${longPct||'?'}% / ${shortPct||'?'}%.\n${lsSig}.`
      : oiVal!==null
        ? `OI: $${oiVal}B — ${oiLabel}.`
        : `Derivatives: menunggu data Bybit.`;
    const wkDom=`BTC Dom ${btcDomPct}%.\n${btcDomPct>57?'BTC season.':btcDomPct<45?'Altseason aktif.':'Transisi.'}`;
    const wkTrend=`BTC ${btcChg24>=0?'+':''}${btcChg24}% (24h). Vol $${(btcVol/1e9).toFixed(1)}B.\n${vol24hPct>5?'Volatilitas tinggi.':Math.abs(btcChg24)<0.5?'Sideways — compression.':btcChg24>2?'Momentum bullish.':btcChg24<-2?'Tekanan jual.':'Mild.'}`;

    const aiPrompt=[
      'Analisa BTC onchain/derivatives seperti hedge fund analyst.',
      `BTC: $${btcPrice.toLocaleString('en-US',{maximumFractionDigits:0})} | ${btcChg24>=0?'+':''}${btcChg24}% | Vol $${(btcVol/1e9).toFixed(1)}B`,
      `F&G: ${fgVal}/100 (${fgLabel}) | BTC Dom: ${btcDomPct}%`,
      `FR: ${frPct??'N/A'}% per 8h (Ann ${frAnn??'N/A'}%) | ${frSig}`,
      `L/S: ${lsRatio??'N/A'} | ${longPct??'—'}% Long / ${shortPct??'—'}% Short`,
      `OI: ${oiVal!=null?'$'+oiVal+'B':'N/A'} | MVRV: ${mvrvProxy??'N/A'} | NUPL: ${nupl??'N/A'} | SOPR: ${sopr}`,
      `Hash: ${hashRate??'—'} EH/s | Block: #${blockH.toLocaleString()} | Fee: ${fastFee??'—'} sat/vB`,
      `Bull: ${bull} Bear: ${bear} | ${bullBias}% Bull | ${overallSignal}`,
      '','Berikan analisis singkat: kondisi pasar, key risk, posisi optimal. Bahasa Indonesia.',
    ].join('\n');

    return res.status(200).json({
      ok:true, ts:Date.now(), elapsed:Date.now()-t0, version:'v20',
      dataOk:btcPrice>0,
      sources:['CoinGecko Markets','Bybit Dedicated Endpoints','Alternative.me','mempool.space'],
      btcPrice,btcChg24h:btcChg24,btcVol,btcMCap,btcH24,btcL24,vol24hPct,
      ethPrice,ethChg24h:ethChg24,ethFrPct,
      fgVal,fgLabel,fgStatus,
      frPct,frAnn,frSig,frSrc:'Bybit /funding/history',
      oiVal,oiLabel,
      lsRatio,longPct,shortPct,lsSig,
      mvrvProxy,mvrvLabel,nuplProxy:nupl,nuplLabel,soprProxy:sopr,soprLabel,
      btcDomPct,totalMC,
      blockH,hashRate,hashRateT,mempoolTx,mempoolMB,fastFee,feeStatus,
      blocksLeft:bLeft,daysLeft:dLeft,halvingPct:halvPct,
      bullPts:bull,bearPts:bear,bullBias,overallSignal,
      weeklyOutlook:{sentimentNote:wkSentiment,derivNote:wkDeriv,domNote:wkDom,trendNote:wkTrend},
      aiPrompt,
    });

  } catch(e) {
    return res.status(200).json({
      ok:false,error:e.message,ts:Date.now(),elapsed:Date.now()-t0,version:'v20',
      dataOk:false,btcPrice:0,ethPrice:0,fgVal:50,fgLabel:'Neutral',fgStatus:'—',
      frPct:null,frSig:'—',oiVal:null,oiLabel:'—',lsRatio:null,longPct:null,shortPct:null,lsSig:'—',
      mvrvProxy:null,mvrvLabel:'—',nuplProxy:null,nuplLabel:'—',soprProxy:null,soprLabel:'—',
      btcDomPct:58,blockH:849671,hashRate:null,mempoolTx:null,fastFee:null,
      blocksLeft:200329,daysLeft:1391,halvingPct:10,bullBias:50,overallSignal:'⚖️ NEUTRAL',
      weeklyOutlook:{},aiPrompt:'',
    });
  }
}
