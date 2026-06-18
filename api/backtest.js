// ============================================================
// BACKTEST ENGINE - Whale Footprint Score Validation
// Methodology: walk-forward, NO lookahead bias.
// At each historical point, score uses ONLY data up to that point.
// Then measures actual forward returns 24h/48h later.
// ============================================================

const N=v=>{const n=+v;return isNaN(n)?0:n;};
const avg=arr=>arr.length?arr.reduce((a,b)=>a+b,0)/arr.length:0;

// Fixed basket of liquid Bybit perpetuals - consistent, not cherry-picked
const TEST_COINS=['ARB','OP','NEAR','SUI','APT','INJ','SEI','RENDER','FET','ADA',
  'DOT','ATOM','TRX','AVAX','UNI','AAVE','LTC','FIL','ICP','SAND',
  'GALA','DYDX','XLM','HBAR','LINK'];

function get(url,ms){
  return fetch(url,{signal:AbortSignal.timeout?AbortSignal.timeout(ms):undefined})
    .then(r=>r.json()).catch(()=>null);
}

// Compute Whale Footprint Score at a specific historical index, using
// ONLY candles up to and including that index (window = last 52 candles ending at idx)
function wfScoreAt(K,idx){
  const start=Math.max(0,idx-51);
  const window=K.slice(start,idx+1);
  if(window.length<24)return null;
  const cls=window.map(k=>k.c);
  let score=0;

  // 1. OBV trend (40pt max)
  let obv=0;const obvSeries=[0];
  for(let i=1;i<window.length;i++){
    if(window[i].c>window[i-1].c)obv+=window[i].v;
    else if(window[i].c<window[i-1].c)obv-=window[i].v;
    obvSeries.push(obv);
  }
  if(obvSeries.length>=20){
    const obvRecent=obvSeries.slice(-10),obvPrior=obvSeries.slice(-20,-10);
    const obvDelta=avg(obvRecent)-avg(obvPrior);
    const obvRange=Math.max(...obvSeries)-Math.min(...obvSeries)||1;
    const obvDeltaPct=obvDelta/obvRange*100;
    const priceChgPct=cls.length>=20?((cls[cls.length-1]-cls[cls.length-20])/cls[cls.length-20]*100):0;
    if(obvDeltaPct>8&&Math.abs(priceChgPct)<3)score+=40;
    else if(obvDeltaPct>3&&Math.abs(priceChgPct)<5)score+=25;
    else if(obvDeltaPct>0&&priceChgPct<2)score+=12;
  }

  // 2. BB Squeeze percentile (25pt max) - rank vs PAST windows only, no lookahead
  if(cls.length>=20){
    const bbPeriod=20;
    const bbWidthOf=arr=>{const m=avg(arr);const v=avg(arr.map(x=>(x-m)*(x-m)));return m>0?(4*Math.sqrt(v))/m*100:10;};
    const curWidth=bbWidthOf(cls.slice(-bbPeriod));
    const hist=[];
    for(let i=bbPeriod;i<cls.length;i++)hist.push(bbWidthOf(cls.slice(i-bbPeriod,i)));
    if(hist.length>=5){
      const sorted=hist.slice().sort((a,b)=>a-b);
      const rank=sorted.findIndex(w=>w>=curWidth);
      const pct=Math.round((rank>=0?rank:sorted.length)/sorted.length*100);
      if(pct<=15)score+=25;else if(pct<=30)score+=15;else if(pct<=45)score+=6;
    }
  }

  // 3. Absorption candles (20pt max)
  const last10=window.slice(-10);
  if(last10.length>=10){
    const avgVol=avg(last10.map(k=>k.v));
    const avgRange=avg(last10.map(k=>Math.abs(k.h-k.l)));
    const absCount=last10.filter(k=>k.v>avgVol*1.4&&Math.abs(k.h-k.l)<avgRange*0.7).length;
    if(absCount>=4)score+=20;else if(absCount>=2)score+=12;else if(absCount>=1)score+=5;
  }

  // 4. Volume acceleration (15pt max)
  if(window.length>=13){
    const vol3=avg(window.slice(-3).map(k=>k.v));
    const vol10p=avg(window.slice(-13,-3).map(k=>k.v));
    const ratio=vol10p>0?vol3/vol10p:1;
    if(ratio>=1.5)score+=15;else if(ratio>=1.2)score+=8;
  }

  return Math.min(100,score);
}

function fwdReturn(K,idx,fwdCandles){
  if(idx+fwdCandles>=K.length)return null;
  const p0=K[idx].c;
  const p1=K[idx+fwdCandles].c;
  let maxHigh=p0,minLow=p0;
  for(let i=idx+1;i<=idx+fwdCandles;i++){
    if(K[i].h>maxHigh)maxHigh=K[i].h;
    if(K[i].l<minLow)minLow=K[i].l;
  }
  return{
    pct:p0>0?+((p1-p0)/p0*100).toFixed(2):0,
    maxUpPct:p0>0?+((maxHigh-p0)/p0*100).toFixed(2):0,
    maxDownPct:p0>0?+((minLow-p0)/p0*100).toFixed(2):0
  };
}

function pearson(xs,ys){
  const n=xs.length;if(n<5)return 0;
  const mx=avg(xs),my=avg(ys);
  let num=0,dx2=0,dy2=0;
  for(let i=0;i<n;i++){const dx=xs[i]-mx,dy=ys[i]-my;num+=dx*dy;dx2+=dx*dx;dy2+=dy*dy;}
  const den=Math.sqrt(dx2*dy2);
  return den>0?+(num/den).toFixed(3):0;
}

export default async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Cache-Control','no-store');
  const t0=Date.now();
  try{
    const limit=Math.min(500,Math.max(200,N(req.query?.candles)||360));// ~60 days of 4H candles
    const sampleEvery=Math.max(1,N(req.query?.sample)||6);// daily sampling default

    const klineResults=await Promise.allSettled(
      TEST_COINS.map(sym=>get('https://api.bybit.com/v5/market/kline?category=linear&symbol='+sym+'USDT&interval=240&limit='+limit,4000))
    );

    const records=[];// {sym, idx, wfScore, fwd24, fwd48}
    const testedSyms=[];
    let totalCandles=0;

    klineResults.forEach((res2,i)=>{
      try{
        const sym=TEST_COINS[i];
        const v=res2.value;
        let raw=[];
        if(v&&v.result&&Array.isArray(v.result.list))raw=[...v.result.list].reverse();
        if(raw.length<60)return;
        const K=raw.map(d=>({o:N(d[1]),h:N(d[2]),l:N(d[3]),c:N(d[4]),v:N(d[5])})).filter(k=>k.c>0);
        if(K.length<60)return;
        testedSyms.push(sym);totalCandles+=K.length;

        // Walk forward: sample every N candles, need 52 lookback + 12 forward (48h)
        for(let idx=52;idx<K.length-12;idx+=sampleEvery){
          const score=wfScoreAt(K,idx);
          if(score==null)continue;
          const f24=fwdReturn(K,idx,6);
          const f48=fwdReturn(K,idx,12);
          if(!f24||!f48)continue;
          records.push({sym,wfScore:score,fwd24Pct:f24.pct,fwd48Pct:f48.pct,fwd48MaxUp:f48.maxUpPct,fwd48MaxDown:f48.maxDownPct});
        }
      }catch(e){}
    });

    if(records.length<20){
      return res.status(200).json({ok:false,error:'Data tidak cukup untuk backtest valid',recordCount:records.length,testedSyms});
    }

    // Bucket by score range
    const ranges=[[0,19,'0-19 (No Signal)'],[20,39,'20-39 (Lemah)'],[40,54,'40-54 (Watch)'],
      [55,69,'55-69 (Probable)'],[70,84,'70-84 (Strong)'],[85,100,'85-100 (Extreme)']];
    const buckets=ranges.map(([lo,hi,label])=>{
      const grp=records.filter(r=>r.wfScore>=lo&&r.wfScore<=hi);
      if(!grp.length)return{range:label,count:0,avgFwd24:null,avgFwd48:null,avgMaxUp48:null,winRate48:null,winRateBig48:null};
      const winRate=+(grp.filter(r=>r.fwd48Pct>5).length/grp.length*100).toFixed(1);
      const winRateBig=+(grp.filter(r=>r.fwd48MaxUp>10).length/grp.length*100).toFixed(1);
      return{
        range:label,count:grp.length,
        avgFwd24:+avg(grp.map(r=>r.fwd24Pct)).toFixed(2),
        avgFwd48:+avg(grp.map(r=>r.fwd48Pct)).toFixed(2),
        avgMaxUp48:+avg(grp.map(r=>r.fwd48MaxUp)).toFixed(2),
        avgMaxDown48:+avg(grp.map(r=>r.fwd48MaxDown)).toFixed(2),
        winRate48,winRateBig48
      };
    });

    const corr48=pearson(records.map(r=>r.wfScore),records.map(r=>r.fwd48Pct));
    const corrMaxUp48=pearson(records.map(r=>r.wfScore),records.map(r=>r.fwd48MaxUp));

    // Honest auto-interpretation - no overselling
    const validBuckets=buckets.filter(b=>b.count>=10);
    let monotonic=true;
    for(let i=1;i<validBuckets.length;i++){
      if(validBuckets[i].avgFwd48<validBuckets[i-1].avgFwd48-1)monotonic=false;
    }
    let interpretation;
    if(Math.abs(corr48)<0.05){
      interpretation='Korelasi sangat lemah ('+corr48+'). Whale Footprint Score TIDAK menunjukkan hubungan jelas dengan return 48 jam pada basket koin ini. Kemungkinan ini bukan edge yang konsisten - perlu dipertimbangkan ulang atau diperbaiki.';
    }else if(Math.abs(corr48)<0.12){
      interpretation='Korelasi lemah ('+corr48+'). Ada sedikit hubungan tapi terlalu kecil untuk diandalkan sendirian. Bisa dipakai sebagai SALAH SATU faktor pendukung, bukan sinyal utama.';
    }else if(Math.abs(corr48)<0.25){
      interpretation='Korelasi moderat ('+corr48+'). '+(monotonic?'Bucket skor tinggi cenderung menunjukkan return lebih baik secara konsisten.':'Tapi pola antar-bucket tidak sepenuhnya konsisten - hati-hati overfitting.')+' Ini level korelasi yang realistis untuk sinyal teknikal di crypto, bukan jaminan profit.';
    }else{
      interpretation='Korelasi cukup kuat ('+corr48+') untuk data finansial. Tetap bukan garansi - sample size dan periode terbatas ('+limit+' candle, '+TEST_COINS.length+' koin). Disarankan terus dimonitor dengan data baru.';
    }

    return res.status(200).json({
      ok:true,
      methodology:'Walk-forward backtest, no lookahead bias. Score dihitung ulang di setiap titik historis menggunakan HANYA data sebelum titik tersebut.',
      testedCoins:testedSyms,
      coinsRequested:TEST_COINS.length,
      coinsWithData:testedSyms.length,
      candlesPerCoinAvg:Math.round(totalCandles/Math.max(1,testedSyms.length)),
      approxDaysCovered:Math.round(limit*4/24),
      sampleIntervalCandles:sampleEvery,
      totalEvaluationPoints:records.length,
      buckets,
      correlation:{wfScore_vs_fwd48hReturn:corr48,wfScore_vs_fwd48hMaxUp:corrMaxUp48},
      interpretation,
      caveat:'Backtest ini HANYA menguji Whale Footprint Score (OBV+BBSqueeze+Absorption+VolAccel) karena murni berbasis data kline historis. Funding Rate Persistence dan OI/Volume Divergence di Persistent Accumulation Score TIDAK tercakup di sini - itu butuh backtest terpisah dengan data funding/OI historis.',
      elapsed:Date.now()-t0
    });
  }catch(e){
    return res.status(200).json({ok:false,error:String(e&&e.message||e),elapsed:Date.now()-t0});
  }
}