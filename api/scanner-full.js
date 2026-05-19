// api/scanner-full.js — v18 ACCURATE
// Fix: probability sekarang trend-dominant (bukan RSI-dominant)
// STRONG BEAR → 10-25% | STRONG BULL → 75-90%
// Wave 3 tab: kriteria lebih luas (Wave 3 Impulse + Wave C Recovery)
// SMC signals: lebih spesifik dengan price levels

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=20');
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

  // ── TA HELPERS ─────────────────────────────────────────────
  const RSI14 = (a) => {
    if (!a || a.length < 16) return null;
    let ag=0, al=0;
    for (let i=1;i<=14;i++){const d=a[i]-a[i-1];d>0?ag+=d:al-=d;}
    ag/=14; al/=14;
    for (let i=15;i<a.length;i++){const d=a[i]-a[i-1];ag=(ag*13+Math.max(d,0))/14;al=(al*13+Math.max(-d,0))/14;}
    return al===0?100:+(100-100/(1+ag/al)).toFixed(2);
  };

  const EMA = (a,p) => {
    if (!a||a.length<2) return a?.[a.length-1]||0;
    const k=2/(p+1); let e=a.slice(0,Math.min(p,a.length)).reduce((s,v)=>s+v,0)/Math.min(p,a.length);
    for(let i=Math.min(p,a.length);i<a.length;i++) e=a[i]*k+e*(1-k);
    return e;
  };

  const MACD_SIG = (a) => {
    if (!a||a.length<36) return {bull:false,bear:false,xUp:false,xDown:false,hist:0};
    const k12=2/13,k26=2/27,k9=2/10;
    let e12=a.slice(0,12).reduce((s,v)=>s+v,0)/12, e26=a.slice(0,26).reduce((s,v)=>s+v,0)/26;
    const mv=[];
    for(let i=26;i<a.length;i++){e12=a[i]*k12+e12*(1-k12);e26=a[i]*k26+e26*(1-k26);mv.push(e12-e26);}
    let sig=mv.slice(0,9).reduce((s,v)=>s+v,0)/9;
    for(let i=9;i<mv.length;i++) sig=mv[i]*k9+sig*(1-k9);
    const last=mv[mv.length-1], prev=mv[mv.length-2]||last, hist=last-sig, prevH=prev-sig;
    return {bull:last>0&&hist>0, bear:last<0&&hist<0, xUp:hist>0&&prevH<=0, xDown:hist<0&&prevH>=0, hist:+hist.toFixed(8)};
  };

  const astro = (() => {
    const jd=Date.now()/86400000+2440587.5;
    const dnm=((jd-2460320.5)%29.53058867+29.53058867)%29.53058867;
    const phases=[[1.5,'New Moon','🌑'],[8.5,'First Quarter','🌓'],[16,'Full Moon','🌕'],[22,'Waning','🌖'],[29.5,'Waning Crescent','🌘']];
    let moonPhase='Dark Moon', moonEmoji='🌑';
    for(const[l,p,e]of phases)if(dnm<l){moonPhase=p;moonEmoji=e;break;}
    const dsh=Math.floor((Date.now()-1713571200000)/86400000);
    const halvPhase=dsh<365?'Bull Early 🔥':dsh<480?'Bull Peak ⚡':dsh<730?'Distribution ⚠️':'Accumulation 🌱';
    return{moonPhase,moonEmoji,halvingPhase:halvPhase,chaotic:moonPhase==='Full Moon'||moonPhase==='New Moon'};
  })();

  try {
    // ── STEP 1: CoinGecko 250 + F&G ───────────────────────
    const [cgR, fngR, cgGlR] = await Promise.allSettled([
      sf('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=volume_desc&per_page=250&page=1&sparkline=false&price_change_percentage=24h,7d', 7000),
      sf('https://api.alternative.me/fng/?limit=1&format=json', 4000),
      sf('https://api.coingecko.com/api/v3/global', 4000),
    ]);

    const markets = cgR.status==='fulfilled'&&Array.isArray(cgR.value)?cgR.value:[];
    const fg      = fngR.status==='fulfilled'?parseInt(fngR.value?.data?.[0]?.value||50):50;
    const btcDom  = cgGlR.status==='fulfilled'?+(cgGlR.value?.data?.market_cap_percentage?.btc||58).toFixed(1):58;

    if (!markets.length) {
      return res.status(200).json({ok:false,error:'CoinGecko unavailable',ts:Date.now(),totalScanned:0,totalQualified:0,results:[],topSetups:{institutional:[],fullSend:[],highProbBull:[],smcSetups:[],ewSetups:[],volumeBreakout:[],strongSell:[]},marketOverview:{marketMood:'UNKNOWN',bullishCount:0,bearishCount:0,avgChange24h:0}});
    }

    const STABLES=new Set(['tether','usd-coin','binance-usd','dai','trueusd','first-digital-usd','usdd','frax','usdb','stasis-eurs','paxos-standard']);
    const btcRef=markets.find(c=>c.id==='bitcoin');
    const btcChg=btcRef?.price_change_percentage_24h||0;
    const filtered=markets.filter(c=>!STABLES.has(c.id)&&c.current_price>0&&(c.total_volume||0)>1e6);

    // ── STEP 2: RSI top 50 from CryptoCompare ─────────────
    const top50=filtered.slice(0,50).map(c=>c.symbol.toUpperCase());
    const rsiMap={};
    const ccBatch=await Promise.allSettled(
      top50.map(sym=>sf(`https://min-api.cryptocompare.com/data/v2/histohour?fsym=${sym}&tsym=USD&limit=40&aggregate=4&e=CCCAGG`,5500))
    );
    ccBatch.forEach((r,i)=>{
      if(r.status!=='fulfilled'||r.value?.Response!=='Success')return;
      const raw=r.value?.Data?.Data;if(!raw||raw.length<16)return;
      const K=raw.filter(d=>d.close>0);if(K.length<16)return;
      const closes=K.map(d=>+d.close);
      const rsi=RSI14(closes);if(rsi===null)return;
      const ema9=EMA(closes,9), ema21=EMA(closes,21), ema50=EMA(closes,Math.min(50,closes.length-1));
      const macd=MACD_SIG(closes);
      // Price action for OB/FVG detection
      const lastC=K[K.length-1], prevC=K[K.length-2]||lastC;
      const bullOB=K.slice(-8).find((k,i,a)=>i>0&&k.close<k.open&&a[i+1]?.close>a[i+1]?.open&&a[i+1]?.close>k.open);
      const bearOB=K.slice(-8).find((k,i,a)=>i>0&&k.close>k.open&&a[i+1]?.close<a[i+1]?.open&&a[i+1]?.close<k.open);
      // FVG
      const bullFVG=K.slice(-8).find((k,i,a)=>a[i+2]&&a[i+2].low>k.high);
      const bearFVG=K.slice(-8).find((k,i,a)=>a[i+2]&&a[i+2].high<k.low);
      rsiMap[top50[i]]={rsi,ema9,ema21,ema50,macd,closes,hasReal:true,
        bullOBLevel:bullOB?+Math.min(bullOB.open,bullOB.close).toFixed(6):null,
        bearOBLevel:bearOB?+Math.max(bearOB.open,bearOB.close).toFixed(6):null,
        bullFVGLevel:bullFVG?+bullFVG.high.toFixed(6):null,
        bearFVGLevel:bearFVG?+bearFVG.low.toFixed(6):null,
      };
    });

    // ── STEP 3: Score & Analyze each coin ─────────────────
    const results=filtered.map((c,idx)=>{
      const sym   = c.symbol.toUpperCase();
      const price = c.current_price||0;
      const ch24  = c.price_change_percentage_24h||0;
      const ch7d  = c.price_change_percentage_7d||0;
      const vol   = c.total_volume||0;
      const mcap  = c.market_cap||0;
      const high  = c.high_24h||price*1.02;
      const low   = c.low_24h||price*0.98;
      const pricePos = high>low?(price-low)/(high-low):0.5;
      const range    = high>low?(high-low)/price*100:0;
      const vt       = vol>=1e9?5:vol>=200e6?4:vol>=50e6?3:vol>=10e6?2:vol>=1e6?1:0;
      const volRatio = mcap>0?vol/mcap:0;

      // RSI: real or estimated
      const kd=rsiMap[sym];
      const rsi=kd?.hasReal?kd.rsi:Math.max(10,Math.min(90,50+ch24*2.5+(pricePos-0.5)*25));
      const rsiReal=kd?.hasReal||false;

      // EMA alignment (real or estimated)
      let emaScore=0;
      if(kd?.closes?.length>=20){
        const lp=kd.closes[kd.closes.length-1];
        if(lp>kd.ema9)  emaScore+=1;
        if(lp>kd.ema21) emaScore+=1;
        if(lp>kd.ema50) emaScore+=1;
      } else {
        if(ch24>0) emaScore+=1;
        if(ch7d>0) emaScore+=1;
        if(pricePos>0.55) emaScore+=1;
      }

      // Trend per timeframe
      const trend1h = rsi>58?'BULL':rsi<42?'BEAR':'SIDE';
      const trend4h = (kd?.macd?.bull||(ch24>1&&pricePos>0.5))?'BULL':(ch24<-1&&pricePos<0.5)?'BEAR':'SIDE';
      const trend1d = ch7d>3?'BULL':ch7d<-3?'BEAR':'SIDE';
      const bullTF  = [trend1h,trend4h,trend1d].filter(t=>t==='BULL').length;
      const bearTF  = [trend1h,trend4h,trend1d].filter(t=>t==='BEAR').length;

      // ── ACCURATE PROBABILITY CALCULATION ─────────────────
      // Trend alignment is the DOMINANT factor (50%)
      const trendC = bullTF===3?30:bullTF===2?18:bullTF===1?6:bearTF===3?-30:bearTF===2?-18:bearTF===1?-6:0;

      // RSI: small when trend opposes
      // Oversold in downtrend = watch (small +), not buy signal
      // Oversold in uptrend = strong buy (big +)
      let rsiC=0;
      if(rsi<25)      rsiC=bearTF>=2?4:14;   // extreme oversold: weak in bear, strong in bull
      else if(rsi<32) rsiC=bearTF>=2?3:10;
      else if(rsi<40) rsiC=bearTF>=2?2:6;
      else if(rsi<48) rsiC=bearTF>=2?0:2;
      else if(rsi>75) rsiC=bullTF>=2?-4:-14; // extreme overbought
      else if(rsi>68) rsiC=bullTF>=2?-3:-10;
      else if(rsi>60) rsiC=bullTF>=2?-1:-5;
      else if(rsi>52) rsiC=4;

      // Weekly momentum (25%)
      const momW=ch7d>25?12:ch7d>12?8:ch7d>4?4:ch7d<-25?-12:ch7d<-12?-8:ch7d<-4?-4:0;

      // Daily momentum (15%)
      const mom24=ch24>12?8:ch24>6?5:ch24>2?2:ch24<-12?-8:ch24<-6?-5:ch24<-2?-2:0;

      // MACD (10%)
      const macdC=kd?.macd?.xUp?8:kd?.macd?.xDown?-8:kd?.macd?.bull?3:kd?.macd?.bear?-3:0;

      // Volume bonus (minor)
      const volC=volRatio>0.2&&ch24>0?2:volRatio>0.2&&ch24<0?-2:0;

      const rawProb=50+trendC+rsiC+momW+mom24+macdC+volC;
      const probability=Math.max(2,Math.min(98,Math.round(rawProb)));

      // Simple score for sorting (keep consistent with probability)
      const score=trendC+rsiC+momW+mom24+macdC;

      // ── TREND LABEL ───────────────────────────────────────
      let taLabel='⚖️ SIDEWAYS', taColor='neutral';
      if(bullTF===3){taLabel='🚀 FULL SEND';taColor='full-bull';}
      else if(bullTF>=2){taLabel='📈 STRONG BULL';taColor='bull';}
      else if(bullTF===1&&bearTF===0){taLabel='↗️ MILD BULL';taColor='bull';}
      else if(bearTF===3){taLabel='💀 FULL BEAR';taColor='full-bear';}
      else if(bearTF>=2){taLabel='📉 STRONG BEAR';taColor='bear';}
      else if(bearTF===1&&bullTF===0){taLabel='↘️ MILD BEAR';taColor='bear';}

      // ── SMC / ICT ANALYSIS ────────────────────────────────
      // Discount / Premium zone
      const inDiscount  = pricePos < 0.30;  // below 30% of 24h range = discount
      const inPremium   = pricePos > 0.70;  // above 70% of 24h range = premium
      const inEQ        = pricePos >= 0.45 && pricePos <= 0.55;
      const hasBOS      = Math.abs(ch24)>5 && vol>20e6;
      const hasCHoCH    = ch24>3 && ch7d<0; // 24h green but weekly red = CHoCH signal

      // OB levels from real klines or estimated
      const bullOBLevel = kd?.bullOBLevel || (inDiscount ? +(low+(high-low)*0.15).toFixed(6) : null);
      const bearOBLevel = kd?.bearOBLevel || (inPremium  ? +(low+(high-low)*0.85).toFixed(6) : null);
      const bullFVGLevel= kd?.bullFVGLevel|| (inDiscount && ch24>0 ? +(price*0.995).toFixed(6) : null);

      const smcSignal = inDiscount&&rsi<45?'Bull OB':inDiscount?'Discount Zone':inPremium&&rsi>55?'Bear OB':inPremium?'Premium Zone':hasCHoCH?'CHoCH':hasBOS?'BOS':inEQ?'EQ':'Neutral';
      const smc={signal:smcSignal, hasBOS, hasCHoCH, inBullOB:inDiscount&&rsi<48, inBearOB:inPremium&&rsi>52, inBullFVG:!!bullFVGLevel, smcBull:inDiscount, smcBear:inPremium, bullOBLevel, bearOBLevel};

      // ── ELLIOTT WAVE ──────────────────────────────────────
      let ewWave='Corrective Phase', ewConf=45, ewDesc='';
      if(ch7d>8&&bullTF>=2){
        // Established uptrend
        if(rsi<38) {ewWave='Wave 2 Pullback';ewConf=70;ewDesc='Koreksi dalam uptrend. Best buy setup.';}
        else if(rsi>=45&&rsi<=62&&(kd?.macd?.bull||kd?.macd?.xUp)){ewWave='Wave 3 — Impulse';ewConf=80;ewDesc='Momentum terkuat. Volume confirm entry.';}
        else if(rsi>=45&&rsi<=65&&bullTF===3){ewWave='Wave 3 Extension';ewConf=72;ewDesc='Impulse berlanjut. Trailing stop.';}
        else if(rsi>70){ewWave='Wave 5 In Progress';ewConf=62;ewDesc='Akhir impulse. Partial profit.';}
        else{ewWave='Wave 4 Correction';ewConf=58;ewDesc='Konsolidasi sebelum leg terakhir.';}
      } else if(ch7d>0&&bullTF>=1){
        // Moderate uptrend
        if(rsi<40){ewWave='Wave 2 Pullback';ewConf=65;ewDesc='Koreksi dalam uptrend.';}
        else if(rsi>=45&&rsi<65){ewWave='Wave 3 Potential';ewConf=62;ewDesc='Setup Wave 3 — perlu konfirmasi volume.';}
        else{ewWave='Impulse Building';ewConf=52;ewDesc='Struktur bullish terbentuk.';}
      } else if(rsi<30&&ch24>0){
        // Oversold with positive divergence = potential Wave C end
        ewWave='Wave C Complete';ewConf=68;ewDesc='RSI oversold + 24h reversal. Potensi bottom.';
      } else if(rsi<32&&bearTF<=1){
        ewWave='Wave C — Watch Reversal';ewConf=60;ewDesc='Extreme oversold. Tunggu candle konfirmasi.';
      } else if(bearTF>=2){
        if(rsi<28){ewWave='Wave C Capitulation';ewConf=72;ewDesc='Capitulation zone. Near-term low potential.';}
        else{ewWave='Wave A/C Bearish';ewConf=65;ewDesc='Penurunan aktif. Hindari catch falling knife.';}
      } else{
        ewWave='Corrective Phase';ewConf=48;ewDesc='Sideways/konsolidasi. Tunggu breakout.';
      }

      // ── CANDLE PATTERN ────────────────────────────────────
      let candlePat='';
      if(pricePos>0.85&&range>1.5)       candlePat='Near High — Dist. Risk ⚠️';
      else if(pricePos<0.15&&range>1.5)  candlePat='Near Low — Reversal Watch 🔍';
      else if(range>6&&ch24>4)           candlePat='Bull Marubozu 🐂';
      else if(range>6&&ch24<-4)          candlePat='Bear Marubozu 🐻';
      else if(pricePos>0.6&&ch24>0)      candlePat='Bullish Close 📈';
      else if(pricePos<0.4&&ch24<0)      candlePat='Bearish Close 📉';
      else                               candlePat=ch24>=0?'Bullish Candle':'Bearish Candle';

      // ── SIGNALS (accurate, no misleading) ────────────────
      const signals=[];
      // RSI signals — context-aware
      if(rsi<26)        signals.push(`RSI ${rsi.toFixed(0)} extreme oversold${bearTF>=2?' — watch for reversal':', buy zone'}`);
      else if(rsi<35)   signals.push(`RSI ${rsi.toFixed(0)} oversold${bearTF>=2?' — caution, trend bearish':', entry setup'}`);
      else if(rsi>74)   signals.push(`RSI ${rsi.toFixed(0)} overbought${bullTF>=2?' — reduce size':', avoid long'}`);

      // MACD signals
      if(kd?.macd?.xUp)  signals.push('MACD golden cross ✅ — new momentum');
      if(kd?.macd?.xDown)signals.push('MACD death cross ⚠️ — momentum shift');

      // SMC/ICT signals
      if(inDiscount&&rsi<48)     signals.push(`Discount zone: ${(pricePos*100).toFixed(0)}% of 24h range — institutional demand area`);
      if(inPremium&&rsi>52)      signals.push(`Premium zone: ${(pricePos*100).toFixed(0)}% of 24h range — distribution risk`);
      if(bullOBLevel)            signals.push(`Bull OB: $${bullOBLevel} — key demand level`);
      if(bearOBLevel)            signals.push(`Bear OB: $${bearOBLevel} — key supply level`);
      if(hasCHoCH&&bullTF>=1)    signals.push('CHoCH signal — structure shifting bullish');
      if(hasBOS&&bullTF>=2)      signals.push('BOS bullish confirmed — institutional breakout');
      if(hasBOS&&bearTF>=2)      signals.push('BOS bearish — smart money selling');

      // Volume/momentum signals
      if(volRatio>0.2&&Math.abs(ch24)<2)  signals.push(`Vol/MCap ${(volRatio*100).toFixed(1)}% — stealth accumulation 👁`);
      if(vt>=4&&ch24>5)                   signals.push(`Vol ${['','','','','$200M+','$1B+'][vt]} breakout — institutional momentum`);
      if(bullTF===3&&kd?.macd?.bull)       signals.push('Triple TF aligned + MACD bull — high conviction setup 🎯');
      if(bearTF===3)                       signals.push('Triple TF bearish — avoid longs, manage risk');

      // Elliott Wave signal
      if(ewWave.includes('Wave 3'))        signals.push(`${ewWave} (${ewConf}%) — ${ewDesc}`);
      if(ewWave.includes('Wave C Complete')) signals.push(`${ewWave} (${ewConf}%) — ${ewDesc}`);

      return {
        rank:idx+1, symbol:sym, name:c.name||sym,
        price, change24h:+ch24.toFixed(2), change7d:+ch7d.toFixed(2),
        volume24h:vol, mcap, mcapRank:c.market_cap_rank||999,
        high24h:high, low24h:low, pricePos:+pricePos.toFixed(3), range:+range.toFixed(2),
        rsi:+rsi.toFixed(2), rsiReal, vt, volRatio:+volRatio.toFixed(4),
        trendAlignment:taLabel, taColor,
        trend1h, trend4h, trend1d, bullTF, bearTF,
        smc,
        elliottWave:{wave:ewWave,confidence:ewConf,description:ewDesc},
        chartPatterns:candlePat?[{name:candlePat,signal:probability>50?'bullish':'bearish'}]:[],
        probability, score,
        signals:signals.slice(0,5),
        astrology:{moonPhase:astro.moonPhase,moonEmoji:astro.moonEmoji,halvingPhase:astro.halvingPhase,chaotic:astro.chaotic},
        hasRealData:rsiReal,
      };
    });

    // Sort by probability for bullish, then score
    results.sort((a,b)=>b.probability-a.probability||b.score-a.score);
    results.forEach((r,i)=>r.rank=i+1);

    // ── CATEGORIZE ────────────────────────────────────────
    const institutional = results.filter(r=>r.score>=18&&r.rsi<72&&r.probability>=60&&r.volume24h>=5e6).slice(0,60);
    const fullSend      = results.filter(r=>(r.taColor==='full-bull'||r.bullTF===3)&&r.probability>=65).slice(0,40);
    const highProbBull  = results.filter(r=>r.probability>=70&&r.score>=15).slice(0,40);
    const smcSetups     = results.filter(r=>(r.smc?.inBullOB||r.smc?.inBullFVG||r.smc?.hasCHoCH)&&r.probability>=52).slice(0,40);
    // Wave 3 tab: Wave 3 impulse + Wave C Complete (reversal setups)
    const ewSetups      = results.filter(r=>(
      r.elliottWave?.wave?.includes('Wave 3')||
      r.elliottWave?.wave?.includes('Wave C Complete')||
      r.elliottWave?.wave?.includes('Wave 2 Pullback')
    )&&r.probability>=50).slice(0,40);
    const volumeBreakout= results.filter(r=>r.vt>=3&&r.change24h>2&&r.probability>50).sort((a,b)=>b.volume24h-a.volume24h).slice(0,40);
    const strongSell    = results.filter(r=>r.probability<35||r.taColor==='full-bear').sort((a,b)=>a.probability-b.probability).slice(0,30);

    // ── MARKET OVERVIEW ───────────────────────────────────
    const bullishCount=results.filter(r=>r.probability>55).length;
    const bearishCount=results.filter(r=>r.probability<45).length;
    const avgCh24=results.length?+(results.reduce((s,r)=>s+r.change24h,0)/results.length).toFixed(2):0;
    const avgRSI=results.filter(r=>r.rsiReal).length?+(results.filter(r=>r.rsiReal).reduce((s,r)=>s+r.rsi,0)/results.filter(r=>r.rsiReal).length).toFixed(1):50;
    const mood=avgCh24>3?'STRONG BULL':avgCh24>1?'BULL':avgCh24<-3?'STRONG BEAR':avgCh24<-1?'BEAR':'NEUTRAL';

    return res.status(200).json({
      ok:true, ts:Date.now(), elapsed:Date.now()-t0, version:'v18',
      src:'coingecko_markets+cryptocompare_rsi', fg, btcDom,
      totalScanned:filtered.length, totalQualified:results.length,
      rsiRealCount:Object.keys(rsiMap).length,
      results,
      topSetups:{institutional,fullSend,highProbBull,smcSetups,ewSetups,volumeBreakout,strongSell},
      marketOverview:{marketMood:mood,bullishCount,bearishCount,avgChange24h:avgCh24,avgRSI,totalCoins:results.length},
      astroContext:astro,
    });

  } catch(e) {
    return res.status(200).json({
      ok:false,error:e.message,ts:Date.now(),elapsed:Date.now()-t0,version:'v18',
      totalScanned:0,totalQualified:0,results:[],
      topSetups:{institutional:[],fullSend:[],highProbBull:[],smcSetups:[],ewSetups:[],volumeBreakout:[],strongSell:[]},
      marketOverview:{marketMood:'UNKNOWN',bullishCount:0,bearishCount:0,avgChange24h:0},
    });
  }
}
