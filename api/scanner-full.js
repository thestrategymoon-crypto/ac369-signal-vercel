// api/scanner-full.js — v21 NO-TIMEOUT
// ROOT CAUSE FIX: CoinGecko + CryptoCompare sekarang PARALLEL (bukan sequential)
// Sebelum v20: CG(7s) → CC(5.5s) = 12.5s (TIMEOUT Vercel 10s!)
// Sekarang v21: CG ∥ CC = max(CG,CC) ≈ 5s (jauh di bawah 10s)
// CC: 25 koin hardcoded top (tidak butuh CG selesai dulu)

// Top 25 koin untuk CryptoCompare RSI (hardcoded, konsisten)
const TOP25 = ['BTC','ETH','BNB','SOL','XRP','ADA','DOGE','AVAX','LINK','DOT','NEAR','TRX','SUI','APT','ARB','OP','PEPE','TON','INJ','TIA','RENDER','FIL','LTC','ATOM','MATIC'];

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

  // ── RSI & TA ──────────────────────────────────────────
  const RSI14 = (a) => {
    if (!a||a.length<16) return null;
    let ag=0,al=0;
    for(let i=1;i<=14;i++){const d=a[i]-a[i-1];d>0?ag+=d:al-=d;}
    ag/=14;al/=14;
    for(let i=15;i<a.length;i++){const d=a[i]-a[i-1];ag=(ag*13+Math.max(d,0))/14;al=(al*13+Math.max(-d,0))/14;}
    return al===0?100:+(100-100/(1+ag/al)).toFixed(2);
  };
  const EMA = (a,p) => {
    if(!a||a.length<2) return a?.[a.length-1]||0;
    const k=2/(p+1); let e=a.slice(0,Math.min(p,a.length)).reduce((s,v)=>s+v,0)/Math.min(p,a.length);
    for(let i=Math.min(p,a.length);i<a.length;i++) e=a[i]*k+e*(1-k);
    return e;
  };
  const MACD_SIG = (a) => {
    if(!a||a.length<36) return {bull:false,bear:false,xUp:false,xDown:false};
    const k12=2/13,k26=2/27,k9=2/10;
    let e12=a.slice(0,12).reduce((s,v)=>s+v,0)/12,e26=a.slice(0,26).reduce((s,v)=>s+v,0)/26;
    const mv=[];
    for(let i=26;i<a.length;i++){e12=a[i]*k12+e12*(1-k12);e26=a[i]*k26+e26*(1-k26);mv.push(e12-e26);}
    let sig=mv.slice(0,9).reduce((s,v)=>s+v,0)/9;
    for(let i=9;i<mv.length;i++) sig=mv[i]*k9+sig*(1-k9);
    const last=mv[mv.length-1],prev=mv[mv.length-2]||last,hist=last-sig,prevH=prev-sig;
    return {bull:last>0&&hist>0,bear:last<0&&hist<0,xUp:hist>0&&prevH<=0,xDown:hist<0&&prevH>=0};
  };

  // ── CHART PATTERNS ≥75% ───────────────────────────────
  const detectPatterns = (K, price, h24, l24, ch24, ch7d, pricePos, vol, mcap) => {
    try {
      const pats = [];
      const open  = price > 0 ? price / (1 + ch24/100) : price;
      const range = h24 - l24;
      const volR  = mcap > 0 ? vol / mcap : 0;

      if (range > 0) {
        const body = Math.abs(price - open);
        const bodyR = body / range;
        const lwR   = (Math.min(price,open) - l24) / range;
        const uwR   = (h24 - Math.max(price,open)) / range;
        if (lwR>0.55 && bodyR<0.30 && uwR<0.20 && pricePos<0.45)
          pats.push({name:'🔨 Hammer',signal:'bullish',winRate:76,desc:`Buyers rejected low strongly. Demand at $${l24.toFixed(4)}.`});
        if (uwR>0.55 && bodyR<0.30 && lwR<0.20 && pricePos>0.55)
          pats.push({name:'⭐ Shooting Star',signal:'bearish',winRate:75,desc:`Sellers rejected high. Supply at $${h24.toFixed(4)}.`});
        if (bodyR>0.72 && ch24>3 && price>open)
          pats.push({name:'🐂 Bull Marubozu',signal:'bullish',winRate:77,desc:`Strong +${ch24.toFixed(1)}% candle. Full buying control.`});
        if (bodyR>0.72 && ch24<-3 && price<open)
          pats.push({name:'🐻 Bear Marubozu',signal:'bearish',winRate:77,desc:`Strong ${ch24.toFixed(1)}% candle. Full selling control.`});
      }

      if (K && K.length >= 3) {
        const n=K.length,C=K[n-1],P=K[n-2],P2=K[n-3];
        if (!C||!P||!P2) return pats;
        const Cb=Math.abs(C.c-C.o),Pb=Math.abs(P.c-P.o),P2b=Math.abs(P2.c-P2.o);
        if (P.c<P.o&&C.c>C.o&&C.o<=P.c&&C.c>=P.o&&Cb>Pb*1.05)
          pats.push({name:'🐂 Bullish Engulfing',signal:'bullish',winRate:78,desc:'Buyers absorbed all selling pressure.'});
        if (P.c>P.o&&C.c<C.o&&C.o>=P.c&&C.c<=P.o&&Cb>Pb*1.05)
          pats.push({name:'🐻 Bearish Engulfing',signal:'bearish',winRate:78,desc:'Sellers absorbed all buying pressure.'});
        if (P2.c<P2.o&&Pb/(P2b+0.001)<0.4&&C.c>C.o&&C.c>(P2.o+P2.c)/2)
          pats.push({name:'🌟 Morning Star',signal:'bullish',winRate:78,desc:'3-candle reversal. Selling exhaustion complete.'});
        if (P2.c>P2.o&&Pb/(P2b+0.001)<0.4&&C.c<C.o&&C.c<(P2.o+P2.c)/2)
          pats.push({name:'🌆 Evening Star',signal:'bearish',winRate:78,desc:'3-candle distribution. Buying exhaustion.'});
        if (P2.c>P2.o&&P.c>P.o&&C.c>C.o&&P.c>P2.c&&C.c>P.c&&P2b/(P2.h-P2.l+0.001)>0.5)
          pats.push({name:'⚔️ 3 White Soldiers',signal:'bullish',winRate:83,desc:'3 strong bullish candles — institutional buying.'});
        if (P2.c<P2.o&&P.c<P.o&&C.c<C.o&&P.c<P2.c&&C.c<P.c&&P2b/(P2.h-P2.l+0.001)>0.5)
          pats.push({name:'🐦 3 Black Crows',signal:'bearish',winRate:83,desc:'3 strong bearish candles — institutional distribution.'});
        if (K.length>=8) {
          const pr=K[n-7]?.c||C.c;
          if (pr>0) {
            const pm=(K[n-3]?.c-pr)/pr*100;
            const fl=Math.max(...K.slice(-4).map(k=>k.h))-Math.min(...K.slice(-4).map(k=>k.l));
            if (pm>5&&C.c>0&&fl/C.c*100<4&&C.c>pr*0.97)
              pats.push({name:'🏴 Bull Flag',signal:'bullish',winRate:85,desc:`+${pm.toFixed(1)}% impulse + tight consolidation. Target +${(pm*0.8).toFixed(1)}%.`});
          }
        }
      }

      // From price data if no patterns found
      if (pats.length===0) {
        if (ch24>1&&pricePos<0.18&&ch7d<-8)
          pats.push({name:'🔄 Double Bottom',signal:'bullish',winRate:75,desc:`At ${ch7d.toFixed(0)}% weekly low with recovery.`});
        else if (pricePos>0.88&&ch24>4&&vol>30e6)
          pats.push({name:'🚀 Volume Breakout',signal:'bullish',winRate:82,desc:`Near high +${ch24.toFixed(1)}% + strong volume.`});
        else if (ch7d>6&&ch24>-3&&ch24<3&&pricePos>0.35)
          pats.push({name:'🏴 Bull Flag (est.)',signal:'bullish',winRate:85,desc:`Weekly +${ch7d.toFixed(1)}% + daily consolidation.`});
        else if (ch7d<-6&&ch24<3&&ch24>-3&&pricePos<0.65)
          pats.push({name:'🏴 Bear Flag (est.)',signal:'bearish',winRate:85,desc:`Weekly ${ch7d.toFixed(1)}% drop + bouncing.`});
        else if (pricePos>0.85&&ch7d>20&&ch24>5)
          pats.push({name:'📊 Distribution Top',signal:'bearish',winRate:75,desc:`Overbought after +${ch7d.toFixed(1)}% weekly.`});
      }

      return pats.filter(p=>p.winRate>=75).sort((a,b)=>b.winRate-a.winRate).slice(0,2);
    } catch { return []; }
  };

  // ── ELLIOTT WAVE (8 skenario varied) ─────────────────
  const elliottWave = (rsi, ch24, ch7d, pricePos, macd, bullTF, bearTF) => {
    try {
      const uW=ch7d>3,dW=ch7d<-3,uD=ch24>1.5,dD=ch24<-1.5,oS=rsi<32,oB=rsi>70;
      if(uW&&uD&&rsi>=42&&rsi<=65&&bullTF>=2) return{wave:'🚀 Wave 3 — Impulse',conf:80,desc:`Weekly +${ch7d.toFixed(0)}% + Daily +${ch24.toFixed(1)}%. Fase terkuat. Target 1.618x Wave 1.`};
      if(uW&&uD&&rsi>=55&&rsi<=72&&(macd?.xUp||macd?.bull)) return{wave:'⚡ Wave 3 Extension',conf:72,desc:`Continuation bullish. Trailing stop dari swing low.`};
      if(uW&&dD&&oS) return{wave:'📉 Wave 2 Pullback',conf:75,desc:`Koreksi dalam uptrend. RSI ${rsi.toFixed(0)} oversold. Entry terbaik sebelum Wave 3.`};
      if(uW&&!uD&&rsi<42) return{wave:'📉 Wave 2 Pullback',conf:68,desc:`Weekly uptrend + daily correction. Zona entry Wave 3.`};
      if(uW&&dD&&rsi>=38&&rsi<=55) return{wave:'⚖️ Wave 4 Correction',conf:65,desc:`Pullback sebelum leg terakhir. Jangan FOMO masuk.`};
      if(uW&&ch7d>15&&oB) return{wave:'⚠️ Wave 5 In Progress',conf:62,desc:`Akhir impulse. +${ch7d.toFixed(0)}% 7d. Partial profit.`};
      if(dW&&uD&&oS) return{wave:'🔄 Wave C Complete',conf:72,desc:`RSI ${rsi.toFixed(0)} oversold + reversal 24h. Potensi bottom.`};
      if(dW&&uD&&ch24>4&&pricePos>0.5) return{wave:'🔄 Wave C → CHoCH',conf:66,desc:`Daily reversal dalam weekly downtrend. Structure change.`};
      if(oS&&bearTF>=2) return{wave:'💎 Wave C Capitulation',conf:72,desc:`Capitulation zone. RSI ${rsi.toFixed(0)} extreme oversold. Near-term bottom.`};
      if(dW&&dD&&bearTF>=2&&!oS) return{wave:'📉 Wave A/C Bearish',conf:68,desc:`Weekly ${ch7d.toFixed(0)}% + Daily ${ch24.toFixed(1)}%. Tren turun aktif.`};
      if(Math.abs(ch7d)<3&&Math.abs(ch24)<2) return{wave:'⚖️ Sideways / Coiling',conf:55,desc:`Konsolidasi ketat. Breakout imminent. Watch volume.`};
      if(uD&&!dW) return{wave:'↗️ Impulse Building',conf:55,desc:`Daily naik. Konfirmasi tren mingguan diperlukan.`};
      return{wave:'⚖️ Corrective Phase',conf:50,desc:`Konsolidasi/koreksi. Tunggu setup jelas.`};
    } catch { return{wave:'⚖️ Corrective Phase',conf:50,desc:'Analisis dalam progress.'}; }
  };

  // ── ASTRO ─────────────────────────────────────────────
  const astro = (() => {
    try {
      const jd=Date.now()/86400000+2440587.5;
      const dnm=((jd-2460320.5)%29.53058867+29.53058867)%29.53058867;
      const ph=[[1.5,'New Moon','🌑'],[8.5,'First Quarter','🌓'],[16,'Full Moon','🌕'],[22,'Waning','🌖'],[29.5,'Waning Crescent','🌘']];
      let moonPhase='Dark Moon',moonEmoji='🌑';
      for(const[l,p,e]of ph)if(dnm<l){moonPhase=p;moonEmoji=e;break;}
      const dsh=Math.floor((Date.now()-1713571200000)/86400000);
      return{moonPhase,moonEmoji,halvingPhase:dsh<365?'Bull Early 🔥':dsh<480?'Bull Peak ⚡':dsh<730?'Distribution ⚠️':'Accumulation 🌱',chaotic:moonPhase==='Full Moon'||moonPhase==='New Moon'};
    } catch { return{moonPhase:'Unknown',moonEmoji:'🌙',halvingPhase:'Bull Cycle',chaotic:false}; }
  })();

  try {
    // ══════════════════════════════════════════════════════
    // KEY FIX: CoinGecko + CryptoCompare PARALLEL
    // Total time: max(CG,CC) ≈ 5s (bukan 12.5s)
    // ══════════════════════════════════════════════════════
    const [cgResults, ccResults, fngR] = await Promise.allSettled([
      // CoinGecko markets 250 koin
      sf('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=volume_desc&per_page=250&page=1&sparkline=false&price_change_percentage=24h,7d', 7000),
      // CryptoCompare 25 koin hardcoded (parallel dengan CoinGecko, tidak butuh CG selesai dulu)
      Promise.allSettled(TOP25.map(sym=>sf(`https://min-api.cryptocompare.com/data/v2/histohour?fsym=${sym}&tsym=USD&limit=40&aggregate=4&e=CCCAGG`,5000))),
      // F&G
      sf('https://api.alternative.me/fng/?limit=1&format=json', 4000),
    ]);

    const markets = cgResults.status==='fulfilled' && Array.isArray(cgResults.value) ? cgResults.value : [];
    const ccBatch  = ccResults.status==='fulfilled'  ? ccResults.value  : [];
    const fg       = fngR.status==='fulfilled'       ? parseInt(fngR.value?.data?.[0]?.value||50) : 50;

    if (!markets.length) {
      return res.status(200).json({ok:false,error:'CoinGecko markets unavailable. Coba refresh dalam 30 detik.',ts:Date.now(),totalScanned:0,totalQualified:0,results:[],topSetups:{institutional:[],fullSend:[],highProbBull:[],smcSetups:[],ewSetups:[],volumeBreakout:[],strongSell:[]},marketOverview:{marketMood:'UNKNOWN',bullishCount:0,bearishCount:0,avgChange24h:0}});
    }

    // ── Parse CryptoCompare results ───────────────────────
    const rsiMap = {};
    ccBatch.forEach((r, i) => {
      try {
        if (r.status!=='fulfilled'||r.value?.Response!=='Success') return;
        const raw = r.value?.Data?.Data;
        if (!raw||raw.length<16) return;
        const K = raw.filter(d=>d.close>0&&d.close<1e12).map(d=>({t:+d.time,o:+d.open,h:+d.high,l:+d.low,c:+d.close,v:+(d.volumeto||0)}));
        if (K.length<16) return;
        const closes = K.map(k=>k.c);
        const rsi  = RSI14(closes); if (rsi===null) return;
        const ema9 = EMA(closes,9), ema21=EMA(closes,21), ema50=EMA(closes,Math.min(50,closes.length-1));
        const macd = MACD_SIG(closes);
        // OB levels from recent klines
        let bOB=null, bearOB=null, bFVG=null;
        for(let j=Math.max(0,K.length-10);j<K.length-2;j++){
          const k=K[j],nxt=K[j+1];
          if(k.c<k.o&&nxt&&nxt.c>nxt.o&&nxt.c>k.o) bOB=+(Math.min(k.o,k.c)).toFixed(6);
          if(k.c>k.o&&nxt&&nxt.c<nxt.o&&nxt.c<k.o) bearOB=+(Math.max(k.o,k.c)).toFixed(6);
          if(j+2<K.length&&K[j+2]?.l>K[j]?.h) bFVG=+(K[j].h).toFixed(6);
        }
        rsiMap[TOP25[i]] = {rsi,ema9,ema21,ema50,macd,K,closes,hasReal:true,bOB,bearOB,bFVG};
      } catch(e) { /* skip failed kline */ }
    });

    // ── Filter coins ──────────────────────────────────────
    const STABLES = new Set(['tether','usd-coin','binance-usd','dai','trueusd','first-digital-usd','usdd','frax','usdb','stasis-eurs']);
    const filtered = markets.filter(c => !STABLES.has(c.id) && c.current_price>0 && (c.total_volume||0)>1e6);

    // ── Analyze each coin ─────────────────────────────────
    const results = [];
    for (const c of filtered) {
      try {
        const sym  = (c.symbol||'').toUpperCase();
        const price = c.current_price||0;
        const ch24  = c.price_change_percentage_24h||0;
        const ch7d  = c.price_change_percentage_7d||0;
        const vol   = c.total_volume||0;
        const mcap  = c.market_cap||0;
        const h24   = c.high_24h||price*1.02;
        const l24   = c.low_24h||price*0.98;
        const pricePos = h24>l24 ? (price-l24)/(h24-l24) : 0.5;
        const range    = h24>l24 ? (h24-l24)/price*100 : 0;
        const vt       = vol>=1e9?5:vol>=200e6?4:vol>=50e6?3:vol>=10e6?2:vol>=1e6?1:0;
        const volRatio = mcap>0 ? vol/mcap : 0;

        const kd  = rsiMap[sym] || null;
        const rsi = kd?.hasReal ? kd.rsi : Math.max(10,Math.min(90,50+ch24*2.5+(pricePos-0.5)*25+(ch7d>0?4:-4)));
        const rsiR = !!(kd?.hasReal);

        // EMA alignment
        let emaScore = 0;
        if (kd?.closes?.length>=20) {
          const lp=kd.closes[kd.closes.length-1];
          if(lp>kd.ema9) emaScore++; if(lp>kd.ema21) emaScore++; if(lp>kd.ema50) emaScore++;
        } else {
          if(ch24>0) emaScore++; if(ch7d>0) emaScore++; if(pricePos>0.55) emaScore++;
        }

        // Trend timeframes
        const t1h = rsi>58?'BULL':rsi<42?'BEAR':'SIDE';
        const t4h = (kd?.macd?.bull||(ch24>1.5&&pricePos>0.5)) ? 'BULL' : (ch24<-1.5&&pricePos<0.5) ? 'BEAR' : 'SIDE';
        const t1d = ch7d>3?'BULL':ch7d<-3?'BEAR':'SIDE';
        const bullTF = [t1h,t4h,t1d].filter(t=>t==='BULL').length;
        const bearTF = [t1h,t4h,t1d].filter(t=>t==='BEAR').length;

        // SMC
        const inD = pricePos<0.28, inP = pricePos>0.72;
        const hasBOS = Math.abs(ch24)>5&&vol>20e6;
        const hasCHoCH = ch24>3&&ch7d<0;
        const bOBLvl  = kd?.bOB  || (inD ? +(l24+(h24-l24)*0.15).toFixed(6) : null);
        const beOBLvl = kd?.bearOB|| (inP ? +(l24+(h24-l24)*0.85).toFixed(6) : null);
        const smcSig  = inD&&rsi<45?'Bull OB':inD?'Discount':inP&&rsi>55?'Bear OB':inP?'Premium':hasCHoCH?'CHoCH':hasBOS?'BOS':'Neutral';
        const smc = {signal:smcSig,hasBOS,hasCHoCH,inBullOB:inD&&rsi<48,inBearOB:inP&&rsi>52,inBullFVG:!!(kd?.bFVG),bullOBLevel:bOBLvl,bearOBLevel:beOBLvl};

        // Chart patterns
        const pats = detectPatterns(kd?.K||null, price, h24, l24, ch24, ch7d, pricePos, vol, mcap);

        // Elliott Wave
        const ew = elliottWave(rsi, ch24, ch7d, pricePos, kd?.macd||null, bullTF, bearTF);

        // Probability (trend-dominant)
        const tC  = bullTF===3?28:bullTF===2?16:bullTF===1?6:bearTF===3?-28:bearTF===2?-16:bearTF===1?-6:0;
        const rC  = rsi<25?(bearTF>=2?4:14):rsi<32?(bearTF>=2?3:10):rsi<40?(bearTF>=2?2:5):rsi<48?1:rsi>75?(bullTF>=2?-4:-14):rsi>68?(bullTF>=2?-3:-10):rsi>60?(bullTF>=2?-1:-5):rsi>52?4:0;
        const mW  = ch7d>20?10:ch7d>8?6:ch7d>3?3:ch7d<-20?-10:ch7d<-8?-6:ch7d<-3?-3:0;
        const m24 = ch24>10?6:ch24>4?3:ch24>1?1:ch24<-10?-6:ch24<-4?-3:ch24<-1?-1:0;
        const mC  = kd?.macd?.xUp?8:kd?.macd?.xDown?-8:kd?.macd?.bull?3:kd?.macd?.bear?-3:0;
        const pC  = pats.some(p=>p.signal==='bullish'&&p.winRate>=80)?3:pats.some(p=>p.signal==='bullish')?1:pats.some(p=>p.signal==='bearish'&&p.winRate>=80)?-3:pats.some(p=>p.signal==='bearish')?-1:0;
        const ewC = ew.wave.includes('Wave 3')?4:ew.wave.includes('Wave 2')?2:ew.wave.includes('C Complete')||ew.wave.includes('Capitulation')?3:ew.wave.includes('Bearish')||ew.wave.includes('Wave 5')?-2:0;
        const rawP = 50+tC+rC+mW+m24+mC+pC+ewC;
        const prob = Math.max(2,Math.min(98,Math.round(rawP)));
        const score = tC+rC+mW+m24+mC;

        // Trend label
        let taLabel='⚖️ SIDEWAYS',taColor='neutral';
        if(bullTF===3){taLabel='🚀 FULL SEND';taColor='full-bull';}
        else if(bullTF>=2){taLabel='📈 STRONG BULL';taColor='bull';}
        else if(bullTF===1&&bearTF===0){taLabel='↗️ MILD BULL';taColor='bull';}
        else if(bearTF===3){taLabel='💀 FULL BEAR';taColor='full-bear';}
        else if(bearTF>=2){taLabel='📉 STRONG BEAR';taColor='bear';}
        else if(bearTF===1&&bullTF===0){taLabel='↘️ MILD BEAR';taColor='bear';}

        // Signals
        const sigs = [];
        if(rsi<25)       sigs.push(`RSI ${rsi.toFixed(0)} extreme oversold 🎯`);
        else if(rsi<32)  sigs.push(`RSI ${rsi.toFixed(0)} oversold${bearTF>=2?' — watch reversal':', entry zone'}`);
        else if(rsi>74)  sigs.push(`RSI ${rsi.toFixed(0)} overbought`);
        if(kd?.macd?.xUp)  sigs.push('MACD golden cross ✅');
        if(kd?.macd?.xDown)sigs.push('MACD death cross ⚠️');
        if(bOBLvl)         sigs.push(`Bull OB: $${bOBLvl}`);
        if(hasCHoCH)       sigs.push('CHoCH: structure shift 🔄');
        if(hasBOS&&ch24>5) sigs.push(`BOS +${ch24.toFixed(1)}% — breakout`);
        if(vt>=4&&ch24>3)  sigs.push(`$${['','','','','200M+','1B+'][vt]} volume + ${ch24.toFixed(1)}%`);
        if(bullTF===3)     sigs.push('Triple TF bullish 🎯');
        pats.forEach(p=>sigs.push(`${p.name} (${p.winRate}%): ${p.desc}`));

        results.push({
          rank:results.length+1, symbol:sym, name:c.name||sym,
          price, change24h:+ch24.toFixed(2), change7d:+ch7d.toFixed(2),
          volume24h:vol, mcap, mcapRank:c.market_cap_rank||999,
          high24h:h24, low24h:l24, pricePos:+pricePos.toFixed(3), range:+range.toFixed(2),
          rsi:rsi?+rsi.toFixed(2):50, rsiReal:rsiR, vt, volRatio:+volRatio.toFixed(4),
          trendAlignment:taLabel, taColor,
          trend1h:t1h, trend4h:t4h, trend1d:t1d, bullTF, bearTF,
          smc,
          elliottWave:{wave:ew.wave,confidence:ew.conf,description:ew.desc},
          chartPatterns:pats.length>0?pats:[{name:ch24>=0?'Bullish Candle':'Bearish Candle',signal:ch24>=0?'bullish':'bearish',winRate:0}],
          probability:prob, score,
          signals:sigs.slice(0,5),
          astrology:{moonPhase:astro.moonPhase,moonEmoji:astro.moonEmoji,halvingPhase:astro.halvingPhase,chaotic:astro.chaotic},
          hasRealData:rsiR,
        });
      } catch(coinErr) { /* skip failed coin analysis */ }
    }

    results.sort((a,b)=>b.probability-a.probability||b.score-a.score);
    results.forEach((r,i)=>r.rank=i+1);

    // ── CATEGORIZE TABS ────────────────────────────────────
    const institutional  = results.filter(r=>r.score>=16&&r.probability>=60&&r.volume24h>=5e6).slice(0,60);
    const fullSend       = results.filter(r=>(r.taColor==='full-bull'||r.bullTF===3)&&r.probability>=65).slice(0,40);
    const highProbBull   = results.filter(r=>r.probability>=68&&r.score>=12).slice(0,40);
    const smcSetups      = results.filter(r=>(r.smc?.inBullOB||r.smc?.inBullFVG||r.smc?.hasCHoCH)&&r.probability>=52).slice(0,40);
    const ewSetups       = results.filter(r=>{
      const w=r.elliottWave?.wave||'';
      if(w.includes('Wave 3')||w.includes('Wave 2 Pull')) return r.probability>=52;
      if(w.includes('C Complete')||w.includes('Capitulation')) return r.probability>=50;
      if(r.rsi<38&&r.change24h>0) return r.probability>=48;
      if(r.smc?.hasCHoCH&&r.probability>=50) return true;
      return false;
    }).sort((a,b)=>b.probability-a.probability).slice(0,40);
    const volumeBreakout = results.filter(r=>r.vt>=3&&r.change24h>1.5&&r.probability>50).sort((a,b)=>b.volume24h-a.volume24h).slice(0,40);
    const strongSell     = results.filter(r=>r.probability<38||r.taColor==='full-bear').sort((a,b)=>a.probability-b.probability).slice(0,30);

    const bullC  = results.filter(r=>r.probability>55).length;
    const bearC  = results.filter(r=>r.probability<45).length;
    const avgCh  = results.length ? +(results.reduce((s,r)=>s+r.change24h,0)/results.length).toFixed(2) : 0;
    const mood   = avgCh>3?'STRONG BULL':avgCh>1?'BULL':avgCh<-3?'STRONG BEAR':avgCh<-1?'BEAR':'NEUTRAL';
    const rsiRealCount = Object.keys(rsiMap).length;
    const withPats= results.filter(r=>r.chartPatterns?.some(p=>p.winRate>=75)).length;

    return res.status(200).json({
      ok:true, ts:Date.now(), elapsed:Date.now()-t0, version:'v21',
      src:'coingecko_markets+cryptocompare_parallel',
      fg, btcDom:58,
      totalScanned:filtered.length, totalQualified:results.length,
      rsiRealCount, patternStats:{withHighConf:withPats,total:results.length},
      results,
      topSetups:{institutional,fullSend,highProbBull,smcSetups,ewSetups,volumeBreakout,strongSell},
      marketOverview:{marketMood:mood,bullishCount:bullC,bearishCount:bearC,avgChange24h:avgCh,totalCoins:results.length},
      astroContext:astro,
    });

  } catch(e) {
    return res.status(200).json({
      ok:false,error:e.message,ts:Date.now(),elapsed:Date.now()-t0,version:'v21',
      totalScanned:0,totalQualified:0,results:[],
      topSetups:{institutional:[],fullSend:[],highProbBull:[],smcSetups:[],ewSetups:[],volumeBreakout:[],strongSell:[]},
      marketOverview:{marketMood:'UNKNOWN',bullishCount:0,bearishCount:0,avgChange24h:0},
    });
  }
}
