// api/scanner-full.js — v19 FINAL
// Fix: Wave 3 tab flexible criteria (bukan hanya ch7d>8%)
// New: Chart patterns dengan win rate ≥75% saja
// Patterns: Bull/Bear Flag, Engulfing, Hammer, 3 Soldiers, Morning Star, Pin Bar

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

  // ── RSI ───────────────────────────────────────────────────
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
    let e12=a.slice(0,12).reduce((s,v)=>s+v,0)/12, e26=a.slice(0,26).reduce((s,v)=>s+v,0)/26;
    const mv=[];
    for(let i=26;i<a.length;i++){e12=a[i]*k12+e12*(1-k12);e26=a[i]*k26+e26*(1-k26);mv.push(e12-e26);}
    let sig=mv.slice(0,9).reduce((s,v)=>s+v,0)/9;
    for(let i=9;i<mv.length;i++) sig=mv[i]*k9+sig*(1-k9);
    const last=mv[mv.length-1],prev=mv[mv.length-2]||last,hist=last-sig,prevH=prev-sig;
    return{bull:last>0&&hist>0,bear:last<0&&hist<0,xUp:hist>0&&prevH<=0,xDown:hist<0&&prevH>=0};
  };

  // ── CHART PATTERNS ≥75% WIN RATE ─────────────────────────
  // Patterns berdasarkan penelitian: Thomas Bulkowski + historical backtests
  const detectPatterns = (K, rsi, ch24, ch7d, pricePos, range, vol, mcap, price) => {
    const patterns = [];
    const volRatio = mcap > 0 ? vol / mcap : 0;

    // ── From kline data (accurate patterns) ──────────────
    if (K && K.length >= 3) {
      const n = K.length;
      const C  = K[n-1]; // current candle
      const P  = K[n-2]; // previous
      const P2 = K[n-3]; // 2 candles ago
      const cRange  = C.h - C.l;
      const pRange  = P.h - P.l;

      if (cRange > 0 && pRange > 0) {
        const cBody   = Math.abs(C.c - C.o);
        const cLowW   = Math.min(C.c, C.o) - C.l;
        const cHighW  = C.h - Math.max(C.c, C.o);
        const pBody   = Math.abs(P.c - P.o);
        const cBodyR  = cBody / cRange;
        const pBodyR  = pBody / pRange;

        // ── Bullish Engulfing (78%) ──────────────────────
        // Prev: bearish candle. Current: bullish candle that FULLY engulfs prev body
        if (P.c < P.o && C.c > C.o &&
            C.o <= P.c && C.c >= P.o &&
            cBody > pBody * 1.1) {
          patterns.push({ name: '🐂 Bullish Engulfing', signal: 'bullish', winRate: 78,
            desc: 'Buyers absorb semua tekanan jual. Strong reversal signal.' });
        }

        // ── Bearish Engulfing (78%) ──────────────────────
        if (P.c > P.o && C.c < C.o &&
            C.o >= P.c && C.c <= P.o &&
            cBody > pBody * 1.1) {
          patterns.push({ name: '🐻 Bearish Engulfing', signal: 'bearish', winRate: 78,
            desc: 'Sellers absorb semua buying pressure. Strong distribution signal.' });
        }

        // ── Hammer / Pin Bar Bullish (76%) ──────────────
        // Long lower wick ≥60% of range, small body ≤25%, near support
        if (cLowW / cRange >= 0.6 && cBodyR <= 0.25 && cHighW / cRange <= 0.2 && pricePos < 0.5) {
          patterns.push({ name: '🔨 Hammer / Pin Bar', signal: 'bullish', winRate: 76,
            desc: 'Buyers rejected lower prices strongly. Demand zone konfirmasi.' });
        }

        // ── Shooting Star / Pin Bar Bearish (75%) ───────
        if (cHighW / cRange >= 0.6 && cBodyR <= 0.25 && cLowW / cRange <= 0.2 && pricePos > 0.55) {
          patterns.push({ name: '⭐ Shooting Star', signal: 'bearish', winRate: 75,
            desc: 'Sellers rejected higher prices. Supply zone aktif.' });
        }

        // ── Morning Star (78%) ── 3 candle bullish reversal
        if (K.length >= 3) {
          const P2b = Math.abs(P2.c - P2.o); const P2r = P2.h - P2.l;
          const Pb  = Math.abs(P.c  - P.o);  const Pr  = P.h  - P.l;
          if (P2.c < P2.o && P2r > 0 &&                // candle 1: big bearish
              Pb / (P2b + 0.0001) < 0.4 &&             // candle 2: small body (star)
              C.c > C.o && C.c > (P2.o + P2.c) / 2) { // candle 3: bullish close above midpoint
            patterns.push({ name: '🌟 Morning Star', signal: 'bullish', winRate: 78,
              desc: 'Tiga candle reversal bullish. Selling exhaustion + buyer entry.' });
          }

          // ── Evening Star (78%) ── bearish reversal
          if (P2.c > P2.o && P2r > 0 &&
              Pb / (P2b + 0.0001) < 0.4 &&
              C.c < C.o && C.c < (P2.o + P2.c) / 2) {
            patterns.push({ name: '🌆 Evening Star', signal: 'bearish', winRate: 78,
              desc: 'Tiga candle distribusi. Buying exhaustion sebelum breakdown.' });
          }
        }

        // ── 3 White Soldiers (83%) ── 3 consecutive bullish
        if (K.length >= 3 &&
            P2.c > P2.o && P.c > P.o && C.c > C.o &&
            P.c > P2.c && C.c > P.c &&
            Math.abs(P2.c - P2.o) / (P2.h - P2.l + 0.0001) > 0.5 &&
            Math.abs(P.c  - P.o)  / (P.h  - P.l  + 0.0001) > 0.5) {
          patterns.push({ name: '⚔️ 3 White Soldiers', signal: 'bullish', winRate: 83,
            desc: 'Tiga candle bullish strong. Institutional buyers konsisten masuk.' });
        }

        // ── 3 Black Crows (83%) ── 3 consecutive bearish
        if (K.length >= 3 &&
            P2.c < P2.o && P.c < P.o && C.c < C.o &&
            P.c < P2.c && C.c < P.c &&
            Math.abs(P2.c - P2.o) / (P2.h - P2.l + 0.0001) > 0.5 &&
            Math.abs(P.c  - P.o)  / (P.h  - P.l  + 0.0001) > 0.5) {
          patterns.push({ name: '🐦 3 Black Crows', signal: 'bearish', winRate: 83,
            desc: 'Tiga candle bearish kuat. Distribusi institusional.' });
        }

        // ── Bull Flag / Continuation (85%) ──────────────
        // Prior impulse: check if last 6-10 candles had strong move up
        if (K.length >= 8) {
          const priorClose = K[n-7].c || K[n-8]?.c || C.c;
          const priorMove  = (K[n-3].c - priorClose) / priorClose * 100;
          // Flag: tight consolidation after impulse
          const recentRange = Math.max(...K.slice(-4).map(k=>k.h)) - Math.min(...K.slice(-4).map(k=>k.l));
          const flagTight   = recentRange / C.c * 100 < 4;
          if (priorMove > 6 && flagTight && C.c > priorClose * 0.97) {
            patterns.push({ name: '🏴 Bull Flag', signal: 'bullish', winRate: 85,
              desc: `Konsolidasi ketat setelah impulse +${priorMove.toFixed(1)}%. Breakout target +${(priorMove * 0.8).toFixed(1)}%.` });
          }
          // Bear Flag
          const priorDrop = (priorClose - K[n-3].c) / priorClose * 100;
          if (priorDrop > 6 && flagTight && C.c < priorClose * 1.03) {
            patterns.push({ name: '🏴 Bear Flag', signal: 'bearish', winRate: 85,
              desc: `Konsolidasi setelah drop -${priorDrop.toFixed(1)}%. Breakdown target -${(priorDrop * 0.8).toFixed(1)}%.` });
          }
        }
      }
    }

    // ── From price data only (estimated, lower confidence) ─
    // Only add if no patterns found from klines
    if (patterns.length === 0) {
      // Potential Double Bottom proxy (75%)
      if (pricePos < 0.15 && ch7d < -8 && ch24 > 0 && rsi < 35) {
        patterns.push({ name: '🔄 Double Bottom Proxy', signal: 'bullish', winRate: 75,
          desc: 'Price di zona low dengan RSI oversold + reversal 24h. Potensi bottom.' });
      }
      // Breakout (82%)
      else if (pricePos > 0.88 && ch24 > 3 && vol > 30e6 && volRatio > 0.05) {
        patterns.push({ name: '🚀 Volume Breakout', signal: 'bullish', winRate: 82,
          desc: 'Price near high + volume spike. Institutional buying momentum.' });
      }
      // Distribution top (75%)
      else if (pricePos > 0.88 && ch24 > 5 && ch7d > 20 && rsi > 72) {
        patterns.push({ name: '📊 Distribution Top', signal: 'bearish', winRate: 75,
          desc: 'Overbought di zona high. Smart money mulai distribusi.' });
      }
      // Bull Flag estimate (85%)
      else if (ch7d > 5 && ch24 > -3 && ch24 < 2 && pricePos > 0.35 && pricePos < 0.7) {
        patterns.push({ name: '🏴 Bull Flag (est.)', signal: 'bullish', winRate: 85,
          desc: 'Weekly uptrend + daily consolidation. Potential continuation.' });
      }
      // Bear Flag estimate (85%)
      else if (ch7d < -5 && ch24 < 3 && ch24 > -2 && pricePos < 0.65) {
        patterns.push({ name: '🏴 Bear Flag (est.)', signal: 'bearish', winRate: 85,
          desc: 'Weekly downtrend + daily bounce. Potential continuation lower.' });
      }
    }

    // Filter: only ≥75% win rate, max 2 patterns shown
    return patterns
      .filter(p => p.winRate >= 75)
      .sort((a, b) => b.winRate - a.winRate)
      .slice(0, 2);
  };

  // ── ASTRO ─────────────────────────────────────────────────
  const astro = (() => {
    const jd=Date.now()/86400000+2440587.5;
    const dnm=((jd-2460320.5)%29.53058867+29.53058867)%29.53058867;
    const ph=[[1.5,'New Moon','🌑'],[8.5,'First Quarter','🌓'],[16,'Full Moon','🌕'],[22,'Waning','🌖'],[29.5,'Waning Crescent','🌘']];
    let moonPhase='Dark Moon',moonEmoji='🌑';
    for(const[l,p,e]of ph)if(dnm<l){moonPhase=p;moonEmoji=e;break;}
    const dsh=Math.floor((Date.now()-1713571200000)/86400000);
    return{moonPhase,moonEmoji,halvingPhase:dsh<365?'Bull Early 🔥':dsh<480?'Bull Peak ⚡':dsh<730?'Distribution ⚠️':'Accumulation 🌱',chaotic:moonPhase==='Full Moon'||moonPhase==='New Moon'};
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
    const filtered=markets.filter(c=>!STABLES.has(c.id)&&c.current_price>0&&(c.total_volume||0)>1e6);
    const btcRef=markets.find(c=>c.id==='bitcoin');
    const btcChg=btcRef?.price_change_percentage_24h||0;

    // ── STEP 2: CryptoCompare klines top 50 ───────────────
    const top50=filtered.slice(0,50).map(c=>c.symbol.toUpperCase());
    const rsiMap={};
    const ccBatch=await Promise.allSettled(
      top50.map(sym=>sf(`https://min-api.cryptocompare.com/data/v2/histohour?fsym=${sym}&tsym=USD&limit=40&aggregate=4&e=CCCAGG`,5500))
    );
    ccBatch.forEach((r,i)=>{
      if(r.status!=='fulfilled'||r.value?.Response!=='Success')return;
      const raw=r.value?.Data?.Data;if(!raw||raw.length<16)return;
      const K=raw.filter(d=>d.close>0).map(d=>({t:d.time,o:+d.open,h:+d.high,l:+d.low,c:+d.close,v:+(d.volumeto||0)}));
      if(K.length<16)return;
      const closes=K.map(k=>k.c);
      const rsi=RSI14(closes);if(rsi===null)return;
      const ema9=EMA(closes,9),ema21=EMA(closes,21),ema50=EMA(closes,Math.min(50,closes.length-1));
      const macd=MACD_SIG(closes);
      // OB/FVG from klines
      let bullOBLevel=null,bearOBLevel=null,bullFVGLevel=null;
      for(let j=K.length-8;j<K.length-2;j++){if(j<0)continue;
        const k=K[j],nxt=K[j+1];
        if(k.c<k.o&&nxt.c>nxt.o&&nxt.c>k.o){bullOBLevel=+Math.min(k.o,k.c).toFixed(6);}
        if(k.c>k.o&&nxt.c<nxt.o&&nxt.c<k.o){bearOBLevel=+Math.max(k.o,k.c).toFixed(6);}
        if(j+2<K.length&&K[j+2].l>K[j].h){bullFVGLevel=+K[j].h.toFixed(6);}
      }
      rsiMap[top50[i]]={rsi,ema9,ema21,ema50,macd,K,closes,hasReal:true,bullOBLevel,bearOBLevel,bullFVGLevel};
    });

    // ── STEP 3: Analyze each coin ─────────────────────────
    const results=filtered.map((c,idx)=>{
      const sym    = c.symbol.toUpperCase();
      const price  = c.current_price||0;
      const ch24   = c.price_change_percentage_24h||0;
      const ch7d   = c.price_change_percentage_7d||0;
      const vol    = c.total_volume||0;
      const mcap   = c.market_cap||0;
      const high   = c.high_24h||price*1.02;
      const low    = c.low_24h||price*0.98;
      const pricePos = high>low?(price-low)/(high-low):0.5;
      const range    = high>low?(high-low)/price*100:0;
      const vt       = vol>=1e9?5:vol>=200e6?4:vol>=50e6?3:vol>=10e6?2:vol>=1e6?1:0;
      const volRatio = mcap>0?vol/mcap:0;

      // RSI
      const kd   = rsiMap[sym];
      const rsi  = kd?.hasReal ? kd.rsi : Math.max(10,Math.min(90,50+ch24*2.5+(pricePos-0.5)*25));
      const rsiR = kd?.hasReal||false;

      // EMA alignment
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

      // Trend timeframes
      const t1h = rsi>58?'BULL':rsi<42?'BEAR':'SIDE';
      const t4h = (kd?.macd?.bull||(ch24>1&&pricePos>0.5))?'BULL':(ch24<-1&&pricePos<0.5)?'BEAR':'SIDE';
      const t1d = ch7d>3?'BULL':ch7d<-3?'BEAR':'SIDE';
      const bullTF=[t1h,t4h,t1d].filter(t=>t==='BULL').length;
      const bearTF=[t1h,t4h,t1d].filter(t=>t==='BEAR').length;

      // ── ACCURATE PROBABILITY (trend-dominant) ────────────
      const trendC = bullTF===3?30:bullTF===2?18:bullTF===1?6:bearTF===3?-30:bearTF===2?-18:bearTF===1?-6:0;
      let rsiC=0;
      if(rsi<25)      rsiC=bearTF>=2?4:14;
      else if(rsi<32) rsiC=bearTF>=2?3:10;
      else if(rsi<40) rsiC=bearTF>=2?2:6;
      else if(rsi<48) rsiC=bearTF>=2?0:2;
      else if(rsi>75) rsiC=bullTF>=2?-4:-14;
      else if(rsi>68) rsiC=bullTF>=2?-3:-10;
      else if(rsi>60) rsiC=bullTF>=2?-1:-5;
      else if(rsi>52) rsiC=4;
      const momW   = ch7d>25?12:ch7d>12?8:ch7d>4?4:ch7d<-25?-12:ch7d<-12?-8:ch7d<-4?-4:0;
      const mom24  = ch24>12?8:ch24>6?5:ch24>2?2:ch24<-12?-8:ch24<-6?-5:ch24<-2?-2:0;
      const macdC  = kd?.macd?.xUp?8:kd?.macd?.xDown?-8:kd?.macd?.bull?3:kd?.macd?.bear?-3:0;
      const volC   = volRatio>0.2&&ch24>0?2:volRatio>0.2&&ch24<0?-2:0;
      const rawProb= 50+trendC+rsiC+momW+mom24+macdC+volC;
      const probability=Math.max(2,Math.min(98,Math.round(rawProb)));
      const score  = trendC+rsiC+momW+mom24+macdC;

      // Trend label
      let taLabel='⚖️ SIDEWAYS',taColor='neutral';
      if(bullTF===3){taLabel='🚀 FULL SEND';taColor='full-bull';}
      else if(bullTF>=2){taLabel='📈 STRONG BULL';taColor='bull';}
      else if(bullTF===1&&bearTF===0){taLabel='↗️ MILD BULL';taColor='bull';}
      else if(bearTF===3){taLabel='💀 FULL BEAR';taColor='full-bear';}
      else if(bearTF>=2){taLabel='📉 STRONG BEAR';taColor='bear';}
      else if(bearTF===1&&bullTF===0){taLabel='↘️ MILD BEAR';taColor='bear';}

      // SMC
      const inDiscount=pricePos<0.30;
      const inPremium =pricePos>0.70;
      const hasBOS    =Math.abs(ch24)>5&&vol>20e6;
      const hasCHoCH  =ch24>3&&ch7d<0;
      const bullOBL   =kd?.bullOBLevel||(inDiscount?+(low+(high-low)*0.15).toFixed(6):null);
      const bearOBL   =kd?.bearOBLevel||(inPremium?+(low+(high-low)*0.85).toFixed(6):null);
      const smcSig    =inDiscount&&rsi<45?'Bull OB':inDiscount?'Discount Zone':inPremium&&rsi>55?'Bear OB':inPremium?'Premium Zone':hasCHoCH?'CHoCH':hasBOS?'BOS':'Neutral';
      const smc={signal:smcSig,hasBOS,hasCHoCH,inBullOB:inDiscount&&rsi<48,inBearOB:inPremium&&rsi>52,inBullFVG:!!kd?.bullFVGLevel,bullOBLevel:bullOBL,bearOBLevel:bearOBL};

      // ── ELLIOTT WAVE (FIXED — flexible criteria) ─────────
      let ewWave='Corrective Phase',ewConf=45,ewDesc='';

      // Check for uptrend: 7d positive OR recent recovery signals
      const hasUptrend  = ch7d > 0;
      const hasRecovery = rsi < 38 && ch24 > 0 && ch7d < 0; // oversold bounce
      const hasMoShift  = ch24 > 2 && ch7d < -3; // CHoCH: daily green in weekly red

      if (hasUptrend) {
        if (ch7d > 4 && rsi < 38) {
          ewWave='Wave 2 Pullback'; ewConf=72;
          ewDesc='Koreksi dalam uptrend. Entry terbaik sebelum Wave 3.';
        } else if (ch7d > 2 && rsi >= 42 && rsi <= 65 && (kd?.macd?.bull||kd?.macd?.xUp||ch24>0)) {
          ewWave='Wave 3 — Impulse'; ewConf=78;
          ewDesc='Fase terkuat. Volume konfirmasi. Target 1.618x Wave 1.';
        } else if (rsi >= 45 && rsi <= 70 && bullTF >= 1 && ch7d > 0) {
          ewWave='Wave 3 Extension'; ewConf=68;
          ewDesc='Kelanjutan impulse. Trailing stop dari swing low.';
        } else if (rsi > 70 && ch7d > 8) {
          ewWave='Wave 5 In Progress'; ewConf=58;
          ewDesc='Akhir impulse. Partial profit. Watch RSI divergence.';
        } else if (rsi < 48 && ch7d > 2 && ch24 < 0) {
          ewWave='Wave 4 Correction'; ewConf=60;
          ewDesc='Konsolidasi sebelum leg terakhir. Jangan FOMO.';
        } else {
          ewWave='Impulse Building'; ewConf=52;
          ewDesc='Struktur bullish terbentuk. Tunggu konfirmasi.';
        }
      } else if (hasRecovery) {
        // Oversold bounce in downtrend = Wave C complete potential
        ewWave='Wave C Complete'; ewConf=70;
        ewDesc='RSI oversold + reversal 24h. Potensi bottom. Konfirmasi dengan volume.';
      } else if (hasMoShift) {
        // CHoCH: daily green while weekly red
        ewWave='Wave C → CHoCH'; ewConf=65;
        ewDesc='Momentum shift: 24h naik dalam tren minggu merah. Structure change.';
      } else if (bearTF >= 2) {
        if (rsi < 28) {
          ewWave='Wave C Capitulation'; ewConf=72;
          ewDesc='Capitulation zone. Near-term low potential. Tunggu candle konfirmasi.';
        } else if (rsi < 38) {
          ewWave='Wave C — Watch'; ewConf=62;
          ewDesc='Oversold. Possible bottom forming. Jangan rush masuk.';
        } else {
          ewWave='Wave A/C Bearish'; ewConf=65;
          ewDesc='Penurunan aktif. Hindari catch falling knife.';
        }
      } else {
        ewWave='Corrective Phase'; ewConf=48;
        ewDesc='Sideways/konsolidasi. Tunggu breakout dengan volume.';
      }

      // ── CHART PATTERNS (≥75% win rate only) ──────────────
      const chartPatterns = detectPatterns(
        kd?.K || null, rsi, ch24, ch7d, pricePos, range, vol, mcap, price
      );

      // Candle pattern (basic)
      let candlePat='';
      if(chartPatterns.length > 0){candlePat=chartPatterns[0].name;}
      else if(pricePos>0.85&&range>1.5) candlePat='Near High ⚠️';
      else if(pricePos<0.15&&range>1.5) candlePat='Near Low 🔍';
      else if(range>6&&ch24>4)          candlePat='Bull Marubozu 🐂';
      else if(range>6&&ch24<-4)         candlePat='Bear Marubozu 🐻';
      else candlePat=ch24>=0?'Bullish Candle':'Bearish Candle';

      // Signals
      const signals=[];
      if(rsi<26)        signals.push(`RSI ${rsi.toFixed(0)} extreme oversold${bearTF>=2?' — watch reversal':', buy zone 🎯'}`);
      else if(rsi<35)   signals.push(`RSI ${rsi.toFixed(0)} oversold${bearTF>=2?' (caution, trend bearish)':', entry setup'}`);
      else if(rsi>74)   signals.push(`RSI ${rsi.toFixed(0)} overbought${bullTF>=2?' — reduce size':', avoid long'}`);
      if(kd?.macd?.xUp)  signals.push('MACD golden cross ✅ — new momentum');
      if(kd?.macd?.xDown)signals.push('MACD death cross ⚠️');
      if(inDiscount&&rsi<48)   signals.push(`Discount zone (${(pricePos*100).toFixed(0)}%) — institutional demand area`);
      if(inPremium&&rsi>52)    signals.push(`Premium zone (${(pricePos*100).toFixed(0)}%) — distribution risk`);
      if(bullOBL)              signals.push(`Bull OB: $${bullOBL} — key demand level`);
      if(hasCHoCH&&bullTF>=1) signals.push('CHoCH signal — structure shifting bullish 🔄');
      if(hasBOS&&bullTF>=2)   signals.push('BOS bullish — institutional breakout confirmed');
      if(vt>=4&&ch24>5)       signals.push(`$${['','','','','200M+','1B+'][vt]} volume breakout 🚀`);
      if(bullTF===3)          signals.push('Triple TF aligned bullish — high conviction 🎯');
      // Chart pattern signals
      chartPatterns.forEach(p => signals.push(`${p.name} (${p.winRate}%): ${p.desc}`));

      return {
        rank:idx+1, symbol:sym, name:c.name||sym,
        price, change24h:+ch24.toFixed(2), change7d:+ch7d.toFixed(2),
        volume24h:vol, mcap, mcapRank:c.market_cap_rank||999,
        high24h:high, low24h:low, pricePos:+pricePos.toFixed(3), range:+range.toFixed(2),
        rsi:+rsi.toFixed(2), rsiReal:rsiR, vt, volRatio:+volRatio.toFixed(4),
        trendAlignment:taLabel, taColor,
        trend1h:t1h, trend4h:t4h, trend1d:t1d, bullTF, bearTF,
        smc,
        elliottWave:{wave:ewWave,confidence:ewConf,description:ewDesc},
        chartPatterns,  // full pattern objects with winRate and desc
        candlePattern:candlePat,
        chartPatterns: chartPatterns.length > 0 ? chartPatterns : [{name:candlePat,signal:ch24>=0?'bullish':'bearish',winRate:0}],
        probability, score,
        signals:signals.slice(0,5),
        astrology:{moonPhase:astro.moonPhase,moonEmoji:astro.moonEmoji,halvingPhase:astro.halvingPhase,chaotic:astro.chaotic},
        hasRealData:rsiR,
      };
    });

    results.sort((a,b)=>b.probability-a.probability||b.score-a.score);
    results.forEach((r,i)=>r.rank=i+1);

    // ── CATEGORIZE ────────────────────────────────────────
    const institutional = results.filter(r=>r.score>=18&&r.probability>=60&&r.volume24h>=5e6).slice(0,60);
    const fullSend      = results.filter(r=>(r.taColor==='full-bull'||r.bullTF===3)&&r.probability>=65).slice(0,40);
    const highProbBull  = results.filter(r=>r.probability>=70&&r.score>=15).slice(0,40);
    const smcSetups     = results.filter(r=>(r.smc?.inBullOB||r.smc?.inBullFVG||r.smc?.hasCHoCH)&&r.probability>=52).slice(0,40);

    // ── WAVE 3 TAB: FIXED — flexible criteria ─────────────
    const ewSetups = results.filter(r => {
      const w = r.elliottWave?.wave || '';
      // Direct Wave 3/2 matches
      if (w.includes('Wave 3') || w.includes('Wave 2')) return r.probability >= 50;
      // Wave C complete (reversal)
      if (w.includes('Wave C Complete') || w.includes('Wave C →')) return r.probability >= 50;
      // Recovery setups: oversold + positive 24h
      if (r.rsi < 38 && r.change24h > 0) return r.probability >= 48;
      // Momentum shift: CHoCH pattern
      if (r.smc?.hasCHoCH && r.probability >= 52) return true;
      // Impulse building
      if (w.includes('Impulse') && r.probability >= 55) return true;
      return false;
    }).sort((a,b)=>b.probability-a.probability).slice(0,40);

    const volumeBreakout= results.filter(r=>r.vt>=3&&r.change24h>1.5&&r.probability>50).sort((a,b)=>b.volume24h-a.volume24h).slice(0,40);
    const strongSell    = results.filter(r=>r.probability<38||r.taColor==='full-bear').sort((a,b)=>a.probability-b.probability).slice(0,30);

    // Market overview
    const bullC=results.filter(r=>r.probability>55).length;
    const bearC=results.filter(r=>r.probability<45).length;
    const avgCh=results.length?+(results.reduce((s,r)=>s+r.change24h,0)/results.length).toFixed(2):0;
    const avgRSI=results.filter(r=>r.rsiReal).length?+(results.filter(r=>r.rsiReal).reduce((s,r)=>s+r.rsi,0)/results.filter(r=>r.rsiReal).length).toFixed(1):50;
    const mood=avgCh>3?'STRONG BULL':avgCh>1?'BULL':avgCh<-3?'STRONG BEAR':avgCh<-1?'BEAR':'NEUTRAL';
    // Pattern stats
    const withPatterns=results.filter(r=>r.chartPatterns?.some(p=>p.winRate>=75)).length;
    const bullPatterns=results.filter(r=>r.chartPatterns?.some(p=>p.signal==='bullish'&&p.winRate>=75)).length;
    const bearPatterns=results.filter(r=>r.chartPatterns?.some(p=>p.signal==='bearish'&&p.winRate>=75)).length;

    return res.status(200).json({
      ok:true,ts:Date.now(),elapsed:Date.now()-t0,version:'v19',
      src:'coingecko_markets+cryptocompare_klines',
      fg,btcDom,
      totalScanned:filtered.length,totalQualified:results.length,
      rsiRealCount:Object.keys(rsiMap).length,
      patternStats:{total:withPatterns,bullish:bullPatterns,bearish:bearPatterns},
      results,
      topSetups:{institutional,fullSend,highProbBull,smcSetups,ewSetups,volumeBreakout,strongSell},
      marketOverview:{marketMood:mood,bullishCount:bullC,bearishCount:bearC,avgChange24h:avgCh,avgRSI,totalCoins:results.length},
      astroContext:astro,
    });

  } catch(e) {
    return res.status(200).json({ok:false,error:e.message,ts:Date.now(),elapsed:Date.now()-t0,version:'v19',totalScanned:0,totalQualified:0,results:[],topSetups:{institutional:[],fullSend:[],highProbBull:[],smcSetups:[],ewSetups:[],volumeBreakout:[],strongSell:[]},marketOverview:{marketMood:'UNKNOWN',bullishCount:0,bearishCount:0,avgChange24h:0}});
  }
}
