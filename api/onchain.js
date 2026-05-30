// api/onchain.js - AC369 v30 CLEAN
// Pure ASCII, no backticks, no template literals
// Multi-source L/S ratio + MVRV + NUPL + SOPR + Network data
const CACHE = { d: null, t: 0 };
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=90,stale-while-revalidate=60');
  if (req.method === 'OPTIONS') return res.status(200).end();
  var t0 = Date.now();
  try {
    if (CACHE.d && Date.now() - CACHE.t < 90000) {
      return res.status(200).json(Object.assign({}, CACHE.d, { cached: true, elapsed: Date.now() - t0 }));
    }
    var g = async function(url, ms) {
      ms = ms || 2800;
      try {
        var ctrl = new AbortController();
        var tmr = setTimeout(function(){ctrl.abort();}, ms);
        var r = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json', 'User-Agent': 'AC369/30' } });
        clearTimeout(tmr);
        return r.ok ? await r.json() : null;
      } catch(e) { return null; }
    };
    var N = function(v, d) { d = d || 0; var n = +v; return isNaN(n)||!isFinite(n) ? d : n; };
    var A = function(v) { return Array.isArray(v) ? v : []; };
    var results = await Promise.allSettled([
      g('https://api.mexc.com/api/v3/ticker/24hr?symbol=BTCUSDT'),
      g('https://api.mexc.com/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=210'),
      g('https://www.okx.com/api/v5/public/funding-rate?instId=BTC-USDT-SWAP'),
      g('https://www.okx.com/api/v5/public/open-interest?instType=SWAP&instId=BTC-USDT-SWAP'),
      g('https://www.okx.com/api/v5/rubik/stat/contracts/long-short-account-ratio?ccy=BTC&period=1H'),
      g('https://www.okx.com/api/v5/rubik/stat/contracts/taker-volume?ccy=BTC&instType=CONTRACTS&period=1H'),
      g('https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=BTCUSDT&period=1h&limit=1'),
      g('https://api.alternative.me/fng/?limit=1&format=json'),
      g('https://blockchain.info/stats?format=json', 3000),
      g('https://mempool.space/api/v1/fees/recommended'),
    ]);
    var R0=results[0],R1=results[1],R2=results[2],R3=results[3],R4=results[4];
    var R5=results[5],R6=results[6],R7=results[7],R8=results[8],R9=results[9];
    var btcP=0,btcCh=0,btcH24=0,btcL24=0,vol24=0;
    try { var m0=R0.value; if(m0&&N(m0.lastPrice)>0){btcP=N(m0.lastPrice);btcCh=+N(m0.priceChangePercent).toFixed(2);btcH24=N(m0.highPrice||btcP*1.02);btcL24=N(m0.lowPrice||btcP*0.98);vol24=N(m0.quoteVolume);}} catch(e){}
    var mvrv=1.3,mvrvLabel='',mvrvInterp='',mvrvColor='amber',nuplProxy=0,nuplLabel='',nuplInterp='',soprProxy=1,soprLabel='',soprSignal='',ma200=0,ma50=0;
    try {
      var kl = A(R1.value);
      if (kl.length >= 50 && btcP > 0) {
        var cls = kl.map(function(k){return N(k[4]);}).filter(function(v){return v>0;});
        ma200 = +(cls.slice(-200).reduce(function(s,v){return s+v;},0)/Math.min(200,cls.length)).toFixed(0);
        ma50 = +(cls.slice(-50).reduce(function(s,v){return s+v;},0)/Math.min(50,cls.length)).toFixed(0);
        if (ma200 > 0) {
          mvrv = +(btcP / ma200).toFixed(3);
          if (mvrv < 0.7) { mvrvLabel='CAPITULATION'; mvrvColor='green'; mvrvInterp='BTC sangat jauh di bawah 200MA. Zona bottom historis. Akumulasi agresif!'; }
          else if (mvrv < 0.85) { mvrvLabel='UNDERVALUED'; mvrvColor='green'; mvrvInterp='BTC signifikan di bawah 200MA. Historically STRONG buy zone.'; }
          else if (mvrv < 1.0) { mvrvLabel='BELOW 200MA'; mvrvColor='green'; mvrvInterp='BTC di bawah 200MA ($' + ma200.toLocaleString() + '). Accumulation zone.'; }
          else if (mvrv < 1.1) { mvrvLabel='AT 200MA'; mvrvColor='amber'; mvrvInterp='BTC di sekitar 200MA. Fair value.'; }
          else if (mvrv < 1.4) { mvrvLabel='ABOVE 200MA'; mvrvColor='amber'; mvrvInterp='BTC di atas 200MA. Uptrend. Hindari FOMO.'; }
          else if (mvrv < 2.0) { mvrvLabel='OVERVALUED'; mvrvColor='orange'; mvrvInterp='Di atas 200MA. Profit taking bertahap.'; }
          else { mvrvLabel='EXPENSIVE'; mvrvColor='red'; mvrvInterp='Jauh di atas 200MA. Reduce exposure.'; }
          nuplProxy = +((btcP - ma200) / btcP).toFixed(4);
          if (nuplProxy < -0.15) { nuplLabel='CAPITULATION'; nuplInterp='Holder banyak rugi besar. Historically best buy zone.'; }
          else if (nuplProxy < 0) { nuplLabel='BELIEF LOSS'; nuplInterp='Holder rata-rata merugi. Zona akumulasi institusional.'; }
          else if (nuplProxy < 0.25) { nuplLabel='HOPE'; nuplInterp='Holder mulai untung. Pasar membaik.'; }
          else if (nuplProxy < 0.5) { nuplLabel='BELIEF'; nuplInterp='Holder untung. Bull cycle aktif.'; }
          else { nuplLabel='EUPHORIA'; nuplInterp='Holder untung besar. Historical top signal.'; }
          var p30 = cls[cls.length - 31] || cls[0];
          soprProxy = p30 > 0 ? +(btcP / p30).toFixed(4) : 1;
          if (soprProxy < 0.90) { soprLabel='DEEP LOSS'; soprSignal='Extreme capitulation.'; }
          else if (soprProxy < 0.97) { soprLabel='Selling at Loss'; soprSignal='Historically near-bottom signal.'; }
          else if (soprProxy < 1.03) { soprLabel='Break Even'; soprSignal='Pasar dalam tekanan.'; }
          else { soprLabel='Selling at Profit'; soprSignal='Healthy bull market.'; }
        }
      }
    } catch(e) {}
    var btcFR=0,frPct=0,frAnn=0,frSig='Neutral FR',frSrc='';
    try {
      var fr = N(R2.value && R2.value.data && R2.value.data[0] ? R2.value.data[0].fundingRate : 0);
      if (Math.abs(fr) > 0) {
        btcFR=fr; frPct=+(fr*100).toFixed(4); frAnn=+(frPct*3*365).toFixed(1); frSrc='okx';
        frSig = fr<-0.001?'EXTREME SQUEEZE':fr<-0.0005?'Short Squeeze':fr<-0.0002?'FR Negatif':fr>0.001?'OVERHEATED':fr>0.0005?'Long Heavy':fr>0.0002?'Mild Long':'Neutral FR';
      }
    } catch(e) {}
    var btcOI = 0;
    try { var oi0=R3.value&&R3.value.data&&R3.value.data[0]; if(oi0){var v0=N(oi0.oiUsd)||N(oi0.oi)*btcP;if(v0>1e6)btcOI=v0;}} catch(e){}
    var longPct=null,shortPct=null,lsRatio=null,lsSig='',lsSrc='';
    if (longPct === null) {
      try { var row4=A(R4.value&&R4.value.data)[0]; if(row4){var lr4=N(row4.longRatio)||N(row4.longAccountRatio)||0;var rawL4=lr4>1?lr4:lr4*100;if(rawL4>30&&rawL4<70){longPct=+rawL4.toFixed(2);shortPct=+(100-longPct).toFixed(2);lsSrc='okx-acct';}}} catch(e) {}
    }
    if (longPct === null) {
      try { var tv5=A(R5.value&&R5.value.data)[0]; if(tv5){var buy5=N(tv5.buyVol),sell5=N(tv5.sellVol),total5=buy5+sell5;if(total5>0){longPct=+(buy5/total5*100).toFixed(2);shortPct=+(100-longPct).toFixed(2);lsSrc='okx-taker';}}} catch(e) {}
    }
    if (longPct === null) {
      try { var row6=A(R6.value)[0]||R6.value; if(row6&&row6.longAccount!=null){var lr6=N(row6.longAccount),rawL6=lr6>1?lr6:lr6*100;if(rawL6>30&&rawL6<70){longPct=+rawL6.toFixed(2);shortPct=+(100-longPct).toFixed(2);lsSrc='binance';}}} catch(e) {}
    }
    if (longPct === null) {
      try { var est = Math.max(42, Math.min(62, 50 + (frPct||0)*400)); longPct=+est.toFixed(1); shortPct=+(100-longPct).toFixed(1); lsSrc='fr-proxy'; } catch(e) {}
    }
    if (longPct !== null) {
      lsRatio = shortPct > 0 ? +(longPct/shortPct).toFixed(3) : null;
      var srcLabel = lsSrc === 'fr-proxy' ? ' (est)' : '';
      if (lsRatio) { lsSig = lsRatio<0.8?'Shorts dominan'+srcLabel:lsRatio<1.1?'Balanced'+srcLabel:lsRatio<1.8?'Slight Long'+srcLabel:lsRatio<2.5?'Long Heavy'+srcLabel:'Extreme Long'+srcLabel; }
    }
    var fgVal = N(R7.value&&R7.value.data&&R7.value.data[0]?R7.value.data[0].value:50, 50);
    var fgLabel = R7.value&&R7.value.data&&R7.value.data[0]?R7.value.data[0].value_classification||'Neutral':'Neutral';
    var fgInterp = fgVal<=20?'Extreme Fear - akumulasi agresif':fgVal<=35?'Fear - akumulasi bertahap':fgVal<=45?'Fear Ringan - DCA valid':fgVal<=55?'Neutral - selektif':fgVal<=65?'Greed Ringan - hati-hati':fgVal<=80?'Greed - kurangi sizing':'Extreme Greed - exit plan';
    var hashRate=0,blockH=0;
    try { var bc8=R8.value; if(bc8){hashRate=+(N(bc8.hash_rate)/1e6).toFixed(1);blockH=N(bc8.n_blocks_total);}} catch(e){}
    var fastFee=2,midFee=1,slowFee=1;
    try { var f9=R9.value; if(f9){fastFee=N(f9.fastestFee);midFee=N(f9.halfHourFee||fastFee);slowFee=N(f9.hourFee||fastFee);}} catch(e){}
    var bullBias=50;
    if(fgVal<20)bullBias+=20;else if(fgVal<35)bullBias+=12;else if(fgVal>75)bullBias-=20;else if(fgVal>60)bullBias-=12;
    if(btcFR<-0.0005)bullBias+=15;else if(btcFR<-0.0002)bullBias+=8;else if(btcFR>0.0005)bullBias-=15;else if(btcFR>0.0002)bullBias-=8;
    if(mvrv<0.8)bullBias+=18;else if(mvrv<1.0)bullBias+=12;else if(mvrv<1.2)bullBias+=6;else if(mvrv>2.0)bullBias-=14;else if(mvrv>1.6)bullBias-=8;
    if(nuplProxy<-0.1)bullBias+=15;else if(nuplProxy<0)bullBias+=8;else if(nuplProxy>0.5)bullBias-=10;
    if(soprProxy<0.95)bullBias+=12;else if(soprProxy<0.99)bullBias+=6;else if(soprProxy>1.2)bullBias-=8;
    if(lsRatio!=null&&lsSrc!=='fr-proxy'){if(lsRatio<0.8)bullBias+=12;else if(lsRatio>2.5)bullBias-=12;else if(lsRatio>1.8)bullBias-=6;}
    if(btcCh>2)bullBias+=5;else if(btcCh>0)bullBias+=2;else if(btcCh<-2)bullBias-=5;else if(btcCh<0)bullBias-=2;
    bullBias = Math.max(5, Math.min(95, Math.round(bullBias/5)*5));
    var bS=0,brS=0;
    if(fgVal<35)bS++;else if(fgVal>65)brS++;
    if(btcFR<-0.0002)bS++;else if(btcFR>0.0002)brS++;
    if(mvrv<1.0)bS++;else if(mvrv>1.8)brS++;
    if(nuplProxy<0)bS++;else if(nuplProxy>0.5)brS++;
    if(soprProxy<0.99)bS++;else if(soprProxy>1.2)brS++;
    if(lsRatio!=null&&lsSrc!=='fr-proxy'){if(lsRatio<1)bS++;else if(lsRatio>2)brS++;}
    if(hashRate>900)bS++;
    var confluenceScore = Math.round((bS/(bS+brS||1))*100);
    var confluenceLabel = confluenceScore>=85?'STRONG BULL CONFLUENCE':confluenceScore>=65?'BULL CONFLUENCE':confluenceScore<=20?'BEAR CONFLUENCE':confluenceScore<=40?'MILD BEAR':'NEUTRAL';
    var signalLabel = bullBias>=80?'STRONG BULLISH':bullBias>=65?'MILD BULLISH':bullBias>=50?'NEUTRAL-BULL':bullBias<=25?'STRONG BEARISH':bullBias<=40?'MILD BEARISH':'NEUTRAL';
    var btcDomPct = 58;
    try { var cgG = await g('https://api.coingecko.com/api/v3/global', 2500); if(cgG&&cgG.data&&cgG.data.market_cap_percentage&&cgG.data.market_cap_percentage.btc)btcDomPct=+cgG.data.market_cap_percentage.btc.toFixed(1); } catch(e){}
    var keyInsight = mvrv<1.0&&nuplProxy<0 ? 'RARE SIGNAL: BTC di bawah 200MA (MVRV=' + mvrv + ') + Holder merugi (NUPL=' + nuplProxy + '). Historically zona BEST ACCUMULATION.' : mvrv<1.1 ? 'BTC dekat/bawah 200MA. Zona akumulasi institusional. Risk/reward sangat baik untuk DCA.' : 'MVRV ' + mvrv + ' - ' + mvrvInterp;
    var halvingBlock = 1050000, blocksLeft = Math.max(0, halvingBlock - (blockH||895000)), daysLeft = Math.round(blocksLeft/144);
    var ds = Math.floor((Date.now() - 1713571200000) / 86400000);
    var out = {
      ok: true, version: 'v30', ts: Date.now(), elapsed: Date.now()-t0,
      src: 'mexc+okx+' + (lsSrc||'n/a') + '+altme+bcinfo',
      btcPrice: btcP, btcChg24h: btcCh, btcHigh24: btcH24, btcLow24: btcL24, vol24hUSD: vol24,
      ma200: ma200, ma50: ma50, btcDomPct: btcDomPct,
      fgVal: fgVal, fgLabel: fgLabel, fgInterp: fgInterp,
      fgStatus: fgVal<=35?'Fear - akumulasi':fgVal>=65?'Greed - take profit':'Neutral',
      frPct: frPct, frAnn: frAnn, frSig: frSig, frSrc: frSrc,
      longPct: longPct, shortPct: shortPct, lsRatio: lsRatio, lsSig: lsSig, lsSrc: lsSrc,
      oiVal: +(btcOI/1e9).toFixed(2), oiLabel: btcOI>30e9?'HIGH':btcOI>15e9?'NORMAL':btcOI>1e9?'MODERATE':'LOW',
      mvrvProxy: mvrv, mvrvLabel: mvrvLabel, mvrvInterp: mvrvInterp, mvrvColor: mvrvColor,
      nuplProxy: nuplProxy, nuplLabel: nuplLabel, nuplInterp: nuplInterp,
      soprProxy: soprProxy, soprLabel: soprLabel, soprSignal: soprSignal,
      hashRate: hashRate, hashRateT: hashRate>900?'ATH Zone':hashRate>700?'Sangat Tinggi':'Normal',
      blockH: blockH, fastFee: fastFee, midFee: midFee, slowFee: slowFee,
      feeStatus: fastFee>50?'Mahal':fastFee>10?'Sedang':'Murah',
      halvingBlock: halvingBlock, blocksLeft: blocksLeft, daysLeft: daysLeft,
      halvingPct: blockH ? +(blockH%210000/210000*100).toFixed(1) : 0,
      bullBias: bullBias, overallSignal: signalLabel,
      confluenceScore: confluenceScore, confluenceLabel: confluenceLabel,
      bullSignals: bS, bearSignals: brS,
      keyInsight: keyInsight,
      weeklyOutlook: {
        sentimentNote: 'F&G ' + fgVal + '/100 (' + fgLabel + '). ' + fgInterp + '.',
        derivNote: 'FR ' + (frPct>=0?'+':'') + frPct + '% (Ann: ' + (frAnn>=0?'+':'') + frAnn + '%). OI: $' + (btcOI/1e9).toFixed(2) + 'B. (' + (frSrc||'okx') + ')',
        domNote: 'BTC Dom: ' + btcDomPct + '% | 200MA: $' + ma200.toLocaleString() + ' | 50MA: $' + ma50.toLocaleString() + ' | MVRV: ' + mvrv + ' ' + mvrvLabel,
        trendNote: 'BTC ' + (btcCh>=0?'+':'') + btcCh + '% 24h. Range: $' + btcL24.toLocaleString() + '-$' + btcH24.toLocaleString() + '.',
      },
      aiPrompt: 'BTC: $' + btcP.toLocaleString() + ' | ' + (btcCh>=0?'+':'') + btcCh + '% | F&G: ' + fgVal + '/100 | FR: ' + frPct + '% | MVRV: ' + mvrv + ' | L/S: ' + (longPct||'-') + '/' + (shortPct||'-') + '% | Confluence: ' + confluenceScore + '% ' + confluenceLabel,
    };
    CACHE.d = out; CACHE.t = Date.now();
    return res.status(200).json(out);
  } catch(e) {
    return res.status(200).json({ ok: false, error: String(e.message||e), version: 'v30', ts: Date.now(), elapsed: Date.now()-t0, bullBias: 50, overallSignal: 'NEUTRAL', btcPrice: 0, fgVal: 50, fgLabel: 'Neutral', mvrvProxy: 1.3, mvrvLabel: '-', nuplProxy: 0, soprProxy: 1, confluenceScore: 50, lsRatio: null });
  }
}
