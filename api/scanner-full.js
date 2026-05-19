// api/scanner-full.js — v24 STABLE + POWERFUL
// 500 koin: CoinGecko(250) + MEXC top 250 — PARALLEL
// Fix v23: CPU timeout dari 1000+ koin + bug ternary
// Processing time: ~5-6s (aman di bawah limit 10s)
// ICT/SMC full + 12 chart patterns + 10 EW scenarios

const CC30 = ['BTC','ETH','BNB','SOL','XRP','ADA','DOGE','AVAX','LINK','DOT',
              'NEAR','TRX','SUI','APT','ARB','OP','PEPE','TON','INJ','TIA',
              'RENDER','FIL','LTC','ATOM','MATIC','HYPE','FLOKI','WIF','BONK','JUP'];

const STABLES = new Set(['USDT','USDC','BUSD','DAI','TUSD','FDUSD','USDD','FRAX','GUSD','USDP','LUSD','BIDR','EURC','EURS','PYUSD','USDE','USDB','CRVUSD']);
const BAD_SFX = ['UP','DOWN','BULL','BEAR','LONG','SHORT','3L','3S','2L','2S'];

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

  // ── RSI, EMA, MACD ───────────────────────────────────
  const rsi14 = (a) => {
    if (!a || a.length < 16) return null;
    let ag = 0, al = 0;
    for (let i = 1; i <= 14; i++) { const d = a[i]-a[i-1]; d > 0 ? ag += d : al -= d; }
    ag /= 14; al /= 14;
    for (let i = 15; i < a.length; i++) { const d = a[i]-a[i-1]; ag = (ag*13+Math.max(d,0))/14; al = (al*13+Math.max(-d,0))/14; }
    return al === 0 ? 100 : +(100 - 100/(1+ag/al)).toFixed(2);
  };

  const ema = (a, p) => {
    if (!a || a.length < 2) return a?.[a.length-1] || 0;
    const k = 2/(p+1);
    let e = a.slice(0, Math.min(p, a.length)).reduce((s,v)=>s+v, 0) / Math.min(p, a.length);
    for (let i = Math.min(p, a.length); i < a.length; i++) e = a[i]*k + e*(1-k);
    return e;
  };

  const macdSig = (a) => {
    if (!a || a.length < 36) return { bull: false, bear: false, xUp: false, xDown: false, div: false };
    const k12=2/13, k26=2/27, k9=2/10;
    let e12 = a.slice(0,12).reduce((s,v)=>s+v,0)/12, e26 = a.slice(0,26).reduce((s,v)=>s+v,0)/26;
    const mv = [];
    for (let i = 26; i < a.length; i++) { e12 = a[i]*k12+e12*(1-k12); e26 = a[i]*k26+e26*(1-k26); mv.push(e12-e26); }
    let sig = mv.slice(0,9).reduce((s,v)=>s+v,0)/9;
    for (let i = 9; i < mv.length; i++) sig = mv[i]*k9 + sig*(1-k9);
    const last = mv[mv.length-1], prev = mv[mv.length-2]||last;
    const hist = last - sig, prevH = prev - sig;
    const div = mv.length > 6 && last < mv[mv.length-7] && a[a.length-1] > a[a.length-7];
    return { bull: last>0&&hist>0, bear: last<0&&hist<0, xUp: hist>0&&prevH<=0, xDown: hist<0&&prevH>=0, div };
  };

  // ── ICT/SMC from klines ───────────────────────────────
  const smcFull = (K, px) => {
    if (!K || K.length < 10) return null;
    const n = K.length;
    const swH = [], swL = [];
    for (let i = 2; i < n-2; i++) {
      if (K[i]?.h > K[i-1]?.h && K[i]?.h > K[i+1]?.h) swH.push(K[i].h);
      if (K[i]?.l < K[i-1]?.l && K[i]?.l < K[i+1]?.l) swL.push(K[i].l);
    }
    const rSH = swH.slice(-3), rSL = swL.slice(-3);
    const lSH = rSH[rSH.length-1]||0, lSL = rSL[rSL.length-1]||1e12;

    // BOS / CHoCH
    let bos = null, choch = null;
    if (px > lSH && lSH > 0 && K[n-3]?.c < lSH) bos = { type: 'Bullish BOS', level: +lSH.toFixed(6) };
    else if (px < lSL && lSL < 1e12 && K[n-3]?.c > lSL) bos = { type: 'Bearish BOS', level: +lSL.toFixed(6) };
    const pSH = rSH[rSH.length-2]||0, pSL = rSL[rSL.length-2]||1e12;
    if (!bos && pSH > 0 && px > pSH) choch = { type: 'Bullish CHoCH (MSS)', level: +pSH.toFixed(6) };
    if (!bos && pSL < 1e12 && px < pSL) choch = { type: 'Bearish CHoCH (MSS)', level: +pSL.toFixed(6) };

    // Order Blocks
    let bullOB = null, bearOB = null, bullFVG = null;
    for (let i = Math.max(0, n-16); i < n-2; i++) {
      const k = K[i], nx = K[i+1];
      if (!k || !nx) continue;
      if (k.c < k.o && nx.c > nx.o && nx.c > k.o*1.003) {
        const H = Math.max(k.o,k.c), L = Math.min(k.o,k.c);
        if (!bullOB && px <= H*1.01 && px >= L*0.994) bullOB = { high:+H.toFixed(6), low:+L.toFixed(6), mid:+((H+L)/2).toFixed(6), fresh: i>n-9 };
      }
      if (k.c > k.o && nx.c < nx.o && nx.c < k.o*0.997) {
        const H = Math.max(k.o,k.c), L = Math.min(k.o,k.c);
        if (!bearOB && px <= H*1.006 && px >= L*0.99) bearOB = { high:+H.toFixed(6), low:+L.toFixed(6), mid:+((H+L)/2).toFixed(6), fresh: i>n-9 };
      }
      if (i+2 < n && K[i+2]?.l && K[i]?.h && K[i+2].l > K[i].h && px >= K[i].h && px <= K[i+2].l)
        bullFVG = { high: +K[i+2].l.toFixed(6), low: +K[i].h.toFixed(6), gapPct: +((K[i+2].l-K[i].h)/K[i].h*100).toFixed(2) };
    }

    // Liquidity sweep
    let liqSweep = null;
    if (rSL.length > 0 && K[n-2] && K[n-1] && K[n-2].l < rSL[rSL.length-1] && K[n-1].c > rSL[rSL.length-1])
      liqSweep = { type: 'Bullish SSL Sweep', level: +rSL[rSL.length-1].toFixed(6) };
    if (rSH.length > 0 && K[n-2] && K[n-1] && K[n-2].h > rSH[rSH.length-1] && K[n-1].c < rSH[rSH.length-1])
      liqSweep = { type: 'Bearish BSL Sweep', level: +rSH[rSH.length-1].toFixed(6) };

    // Premium / Discount / OTE
    const rH = Math.max(...K.slice(-20).map(k=>k.h||0)), rL = Math.min(...K.slice(-20).map(k=>k.l||px));
    const equil = (rH+rL)/2;
    const pip = rH>rL ? +((px-rL)/(rH-rL)*100).toFixed(1) : 50;
    const zone = pip>70?'Premium Zone':pip<30?'Discount Zone':'Equilibrium';
    const oteH = +(equil+(rH-equil)*0.382).toFixed(6), oteL = +(equil-(equil-rL)*0.382).toFixed(6);
    const inOTE = px >= oteL && px <= oteH;

    // Equal highs/lows
    let eqH = null, eqL = null;
    if (rSH.length >= 2 && Math.abs(rSH[rSH.length-1]-rSH[rSH.length-2])/rSH[rSH.length-1] < 0.006)
      eqH = { level: +rSH[rSH.length-1].toFixed(6), desc: 'Equal Highs (BSL) — buy-side liquidity above' };
    if (rSL.length >= 2 && Math.abs(rSL[rSL.length-1]-rSL[rSL.length-2])/rSL[rSL.length-1] < 0.006)
      eqL = { level: +rSL[rSL.length-1].toFixed(6), desc: 'Equal Lows (SSL) — sell-side liquidity below' };

    const bScore = (bullOB?2:0)+(bullFVG?1:0)+(bos?.type?.includes('Bull')?3:0)+(choch?.type?.includes('Bull')?2:0)+(liqSweep?.type?.includes('Bull')?2:0)+(inOTE&&px<equil?1:0);
    const beScore = (bearOB?2:0)+(bos?.type?.includes('Bear')?3:0)+(choch?.type?.includes('Bear')?2:0)+(liqSweep?.type?.includes('Bear')?2:0)+(inOTE&&px>equil?1:0);
    return { hasBOS:!!bos, bosType:bos?.type||'None', bosLevel:bos?.level||null, hasCHoCH:!!choch, chochType:choch?.type||'None', chochLevel:choch?.level||null, bullOB, bearOB, inBullOB:!!bullOB, inBearOB:!!bearOB, bullFVG, inBullFVG:!!bullFVG, liqSweep, eqH, eqL, zone, priceInRange:pip, equil:+equil.toFixed(6), oteH, oteL, inOTE, signal:bScore>beScore?'Bullish':beScore>bScore?'Bearish':'Neutral', score:{bull:bScore,bear:beScore} };
  };

  // ── SMC from price only (fast) ────────────────────────
  const smcEst = (px, h24, l24, ch24, ch7d) => {
    const c7 = ch7d || 0;
    const pip = h24>l24 ? (px-l24)/(h24-l24)*100 : 50;
    const zone = pip>70?'Premium Zone':pip<30?'Discount Zone':'Equilibrium';
    const inBullOB = pip < 28, inBearOB = pip > 72;
    const hasBOS = Math.abs(ch24) > 5;
    const bosType = ch24>5?'Bullish BOS':ch24<-5?'Bearish BOS':'None';
    const hasCHoCH = ch24 > 3 && c7 < 0;
    const bScore = (hasBOS&&bosType.includes('Bull')?3:0)+(inBullOB?2:0)+(hasCHoCH?2:0);
    const beScore = (hasBOS&&bosType.includes('Bear')?3:0)+(inBearOB?2:0);
    return { hasBOS, bosType, bosLevel: hasBOS&&ch24>5?+(h24*0.98).toFixed(6):hasBOS?+(l24*1.02).toFixed(6):null, hasCHoCH, chochType: hasCHoCH?'Bullish CHoCH (MSS)':'None', inBullOB, inBearOB, bullOB: inBullOB?{low:+l24.toFixed(6),high:+(l24+(h24-l24)*0.28).toFixed(6)}:null, bearOB: inBearOB?{low:+(l24+(h24-l24)*0.72).toFixed(6),high:+h24.toFixed(6)}:null, inBullFVG: pip<14, zone, priceInRange:+pip.toFixed(1), signal:bScore>beScore?'Bullish':beScore>bScore?'Bearish':'Neutral', score:{bull:bScore,bear:beScore} };
  };

  // ── CHART PATTERNS (12 patterns ≥75%) ─────────────────
  const patterns = (K, px, h24, l24, ch24, ch7d, ppx, vol) => {
    try {
      const c7 = ch7d || 0;
      const pats = [];
      const open = px > 0 && ch24 > -99 ? px / (1 + ch24/100) : px;
      const rng = h24 - l24;

      // From reconstructed OHLC
      if (rng > 0) {
        const body = Math.abs(px-open), bR = body/rng;
        const lwR = (Math.min(px,open)-l24)/rng, uwR = (h24-Math.max(px,open))/rng;
        if (lwR>0.55 && bR<0.30 && uwR<0.20 && ppx<0.45)
          pats.push({ name:'🔨 Hammer', signal:'bullish', winRate:76, desc:`Buyers rejected low $${l24.toFixed(4)} strongly.` });
        if (uwR>0.55 && bR<0.30 && lwR<0.20 && ppx>0.55)
          pats.push({ name:'⭐ Shooting Star', signal:'bearish', winRate:75, desc:`Sellers rejected high $${h24.toFixed(4)} strongly.` });
        if (bR>0.75 && ch24>3 && px>open)
          pats.push({ name:'🐂 Bull Marubozu', signal:'bullish', winRate:77, desc:`+${ch24.toFixed(1)}% full-body candle. Full buyer control.` });
        if (bR>0.75 && ch24<-3 && px<open)
          pats.push({ name:'🐻 Bear Marubozu', signal:'bearish', winRate:77, desc:`${ch24.toFixed(1)}% full-body candle. Full seller control.` });
        if (uwR>0.50 && bR<0.30 && lwR<0.20 && ppx<0.40 && ch24>0)
          pats.push({ name:'🔨 Inverted Hammer', signal:'bullish', winRate:75, desc:`Upper wick rejection. Confirm with next candle.` });
      }

      // From klines (30 top coins)
      if (K && K.length >= 3) {
        const n=K.length, C=K[n-1], P=K[n-2], P2=K[n-3];
        if (C && P && P2) {
          const Cb=Math.abs(C.c-C.o), Pb=Math.abs(P.c-P.o), P2b=Math.abs(P2.c-P2.o);
          if (P.c<P.o && C.c>C.o && C.o<=P.c && C.c>=P.o && Cb>Pb*1.05)
            pats.push({ name:'🐂 Bullish Engulfing', signal:'bullish', winRate:78, desc:'Buyers absorbed all prior selling. Strong reversal.' });
          if (P.c>P.o && C.c<C.o && C.o>=P.c && C.c<=P.o && Cb>Pb*1.05)
            pats.push({ name:'🐻 Bearish Engulfing', signal:'bearish', winRate:78, desc:'Sellers absorbed all prior buying. Distribution.' });
          if (P2.c<P2.o && Pb/(P2b+0.001)<0.40 && C.c>C.o && C.c>(P2.o+P2.c)/2)
            pats.push({ name:'🌟 Morning Star', signal:'bullish', winRate:78, desc:'3-candle selling exhaustion. Buyers taking control.' });
          if (P2.c>P2.o && Pb/(P2b+0.001)<0.40 && C.c<C.o && C.c<(P2.o+P2.c)/2)
            pats.push({ name:'🌆 Evening Star', signal:'bearish', winRate:78, desc:'3-candle buying exhaustion. Sellers taking control.' });
          if (P2.c>P2.o && P.c>P.o && C.c>C.o && P.c>P2.c && C.c>P.c && P2b/(P2.h-P2.l+0.001)>0.50)
            pats.push({ name:'⚔️ 3 White Soldiers', signal:'bullish', winRate:83, desc:'3 strong bullish candles. Institutional accumulation.' });
          if (P2.c<P2.o && P.c<P.o && C.c<C.o && P.c<P2.c && C.c<P.c && P2b/(P2.h-P2.l+0.001)>0.50)
            pats.push({ name:'🐦 3 Black Crows', signal:'bearish', winRate:83, desc:'3 strong bearish candles. Institutional distribution.' });
          if (P.c<P.o && C.c>C.o && C.o<P.l && C.c>(P.o+P.c)/2 && C.c<P.o)
            pats.push({ name:'🌙 Piercing Pattern', signal:'bullish', winRate:75, desc:'Bullish penetrates >50% of prior bearish body.' });
          if (P.c>P.o && C.c<C.o && C.o>P.h && C.c<(P.o+P.c)/2 && C.c>P.o)
            pats.push({ name:'☁️ Dark Cloud Cover', signal:'bearish', winRate:75, desc:'Bearish penetrates >50% of prior bullish body.' });
          if (C.h<=P.h && C.l>=P.l)
            pats.push({ name:'📦 Inside Bar', signal:C.c>C.o?'bullish':'bearish', winRate:76, desc:`Compression inside prior candle. Breakout ${C.c>C.o?'upward':'downward'} likely.` });
          if (K.length >= 8) {
            const pr = K[n-7]?.c || C.c;
            if (pr > 0) {
              const pm = (K[n-3]?.c||C.c - pr) / pr * 100;
              const fl = Math.max(...K.slice(-4).map(k=>k.h||0)) - Math.min(...K.slice(-4).map(k=>k.l||0));
              if (pm > 5 && C.c > 0 && fl/C.c*100 < 4)
                pats.push({ name:'🏴 Bull Flag', signal:'bullish', winRate:85, desc:`+${pm.toFixed(1)}% impulse + tight coil. Target +${(pm*0.8).toFixed(1)}%.` });
              else if (pm < -5 && fl/C.c*100 < 4)
                pats.push({ name:'🏴 Bear Flag', signal:'bearish', winRate:85, desc:`${pm.toFixed(1)}% drop + bounce. Continuation lower.` });
            }
          }
        }
      }

      // Fallback patterns from price data
      const good = pats.filter(p=>p.winRate>=75);
      if (good.length === 0) {
        if (ch24 > 1 && ppx < 0.18 && c7 < -8)
          pats.push({ name:'🔄 Double Bottom', signal:'bullish', winRate:75, desc:`At ${c7.toFixed(0)}% weekly low with recovery.` });
        else if (ppx > 0.88 && ch24 > 4 && vol > 30e6)
          pats.push({ name:'🚀 Volume Breakout', signal:'bullish', winRate:82, desc:`Near high +${ch24.toFixed(1)}% + strong volume.` });
        else if (c7 > 6 && ch24 > -3 && ch24 < 3 && ppx > 0.35)
          pats.push({ name:'🏴 Bull Flag (est.)', signal:'bullish', winRate:85, desc:`Weekly +${c7.toFixed(1)}% impulse + daily consolidation.` });
        else if (c7 < -6 && ch24 < 3 && ch24 > -3 && ppx < 0.65)
          pats.push({ name:'🏴 Bear Flag (est.)', signal:'bearish', winRate:85, desc:`Weekly ${c7.toFixed(1)}% drop + bouncing. Continuation lower.` });
        else if (ppx > 0.85 && c7 > 20 && ch24 > 5)
          pats.push({ name:'📊 Distribution Top', signal:'bearish', winRate:75, desc:`Overbought after +${c7.toFixed(1)}% weekly. Distributing.` });
      }

      return pats.filter(p=>p.winRate>=75).sort((a,b)=>b.winRate-a.winRate).slice(0,2);
    } catch { return []; }
  };

  // ── ELLIOTT WAVE (10 skenario) ─────────────────────────
  const ewWave = (rsi, ch24, ch7d, mc, bTF, beTF) => {
    try {
      const c7 = ch7d || 0;
      const uW=c7>3, dW=c7<-3, uD=ch24>1.5, dD=ch24<-1.5, oS=rsi<32, oB=rsi>70;
      if ((uW||(!uW&&!dW&&uD)) && uD && rsi>=42&&rsi<=65 && bTF>=2 && (mc?.xUp||mc?.bull))
        return { wave:'🚀 Wave 3 — Impulse', conf:82, desc:`${uW?`W7d +${c7.toFixed(0)}% + `:''}Daily +${ch24.toFixed(1)}%. STRONGEST phase. Target 1.618x. Volume entry.` };
      if ((uW||uD) && rsi>=55&&rsi<75 && mc?.bull && !mc?.div)
        return { wave:'⚡ Wave 3 Extension', conf:72, desc:`Continuation impulse. Volume sustaining. Trail stop from swing low.` };
      if (uW && dD && oS)
        return { wave:'📉 Wave 2 Pullback', conf:78, desc:`Correction in uptrend. RSI ${rsi.toFixed(0)} oversold — BEST ENTRY before Wave 3. Stop below recent low.` };
      if ((uW||(!uW&&!dW)) && rsi>=35&&rsi<48 && dD && !oS)
        return { wave:'📉 Wave 2 / OTE Entry', conf:68, desc:`Pullback into OTE (61.8-78.6% retracement). Entry before Wave 3 continuation.` };
      if (uW && dD && rsi>=38&&rsi<=55 && !oS)
        return { wave:'⚖️ Wave 4 Correction', conf:65, desc:`Consolidation before final leg. Support zona entry. Don't FOMO above.` };
      if ((uW&&c7>15||rsi>70) && oB && mc?.div)
        return { wave:'⚠️ Wave 5 Ending', conf:68, desc:`RSI divergence + extended. PROBABLE PEAK. Take partial profits now.` };
      if (oB && !mc?.div)
        return { wave:'⚡ Wave 5 Progress', conf:60, desc:`Overbought, no divergence yet. Tight trailing stop.` };
      if ((dW||dD) && uD && oS)
        return { wave:'🔄 Wave C Complete', conf:74, desc:`RSI ${rsi.toFixed(0)} oversold + daily reversal. Potential bottom. Confirm with bullish candle.` };
      if ((dW||dD) && uD && ch24>4 && !oS)
        return { wave:'🔄 Wave C → MSS', conf:67, desc:`Market Structure Shift: daily up in downtrend. Monitor for volume confirmation.` };
      if (oS && beTF >= 2)
        return { wave:'💎 Wave C Capitulation', conf:74, desc:`RSI ${rsi.toFixed(0)} extreme oversold. Capitulation zone. Near-term bottom high probability.` };
      if ((dW||dD) && beTF>=2 && rsi<45 && !oS)
        return { wave:'📉 Wave A/C Bearish', conf:70, desc:`${dW?`Weekly ${c7.toFixed(0)}%`:`Daily ${ch24.toFixed(1)}%`} downtrend active. Avoid catch falling knife.` };
      if (Math.abs(ch24) < 2 && Math.abs(c7) < 3)
        return { wave:'⚖️ Sideways / Coiling', conf:56, desc:`Compression. Breakout imminent. Watch volume spike for direction.` };
      if (uD && !dW)
        return { wave:'↗️ Impulse Building', conf:56, desc:`Daily momentum building. Weekly confirmation needed.` };
      return { wave:'⚖️ Corrective Phase', conf:50, desc:`Consolidation. Wait for clear setup with volume.` };
    } catch { return { wave:'⚖️ Corrective Phase', conf:50, desc:'Analysis in progress.' }; }
  };

  // ── ASTRO ─────────────────────────────────────────────
  const astro = (() => {
    try {
      const jd = Date.now()/86400000+2440587.5;
      const dnm = ((jd-2460320.5)%29.53058867+29.53058867)%29.53058867;
      const ph = [[1.5,'New Moon','🌑'],[8.5,'First Quarter','🌓'],[16,'Full Moon','🌕'],[22,'Waning','🌖'],[29.5,'Waning Crescent','🌘']];
      let moonPhase='Dark Moon', moonEmoji='🌑';
      for (const [l,p,e] of ph) if (dnm < l) { moonPhase=p; moonEmoji=e; break; }
      const dsh = Math.floor((Date.now()-1713571200000)/86400000);
      return { moonPhase, moonEmoji, halvingPhase:dsh<365?'Bull Early 🔥':dsh<480?'Bull Peak ⚡':dsh<730?'Distribution ⚠️':'Accumulation 🌱', chaotic:moonPhase==='Full Moon'||moonPhase==='New Moon' };
    } catch { return { moonPhase:'—', moonEmoji:'🌙', halvingPhase:'Bull Cycle', chaotic:false }; }
  })();

  try {
    // ══════════════════════════════════════════════════════
    // PARALLEL FETCH: CoinGecko + MEXC + CryptoCompare + F&G
    // Max time: max(CG:6s, MEXC:7s, CC:5s) + processing 1.5s ≈ 8.5s ✅
    // ══════════════════════════════════════════════════════
    const [cgR, mexcR, ccR, fngR] = await Promise.allSettled([
      sf('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=volume_desc&per_page=250&page=1&sparkline=false&price_change_percentage=24h,7d', 6000),
      sf('https://api.mexc.com/api/v3/ticker/24hr', 7000),
      Promise.allSettled(CC30.map(sym => sf(`https://min-api.cryptocompare.com/data/v2/histohour?fsym=${sym}&tsym=USD&limit=42&aggregate=4&e=CCCAGG`, 5000))),
      sf('https://api.alternative.me/fng/?limit=1&format=json', 4000),
    ]);

    const fg = fngR.status==='fulfilled' ? parseInt(fngR.value?.data?.[0]?.value||50) : 50;

    // Parse CG
    const cgArr = cgR.status==='fulfilled' && Array.isArray(cgR.value) ? cgR.value : [];
    const cgCoins = cgArr.filter(c=>c&&c.current_price>0).map(c=>({
      sym:(c.symbol||'').toUpperCase(), name:c.name||c.symbol||'',
      px:c.current_price, ch24:c.price_change_percentage_24h||0,
      ch7d:c.price_change_percentage_7d||null,
      vol:c.total_volume||0, h24:c.high_24h||c.current_price*1.02, l24:c.low_24h||c.current_price*0.98,
      mcap:c.market_cap||0, rank:c.market_cap_rank||9999, src:'cg',
    }));

    // Parse MEXC — filter & sort, take top 250 by vol after dedup
    const mexcRaw = mexcR.status==='fulfilled' && Array.isArray(mexcR.value) ? mexcR.value : [];
    const cgSyms = new Set(cgCoins.map(c=>c.sym));
    const mexcCoins = mexcRaw
      .filter(t => {
        if (!t?.symbol?.endsWith('USDT')) return false;
        const sym = t.symbol.replace('USDT','');
        if (cgSyms.has(sym)) return false; // skip CG duplicates
        if (STABLES.has(sym)) return false;
        if (BAD_SFX.some(p=>sym.endsWith(p)||sym.startsWith(p))) return false;
        if (sym.length > 13) return false;
        const px = +(t.lastPrice||0), vol = +(t.quoteVolume||0);
        if (px <= 0 || vol < 300000) return false;
        if (px >= 0.97 && px <= 1.03 && Math.abs(+(t.priceChangePercent||0)) < 0.5) return false;
        return true;
      })
      .sort((a,b) => +(b.quoteVolume||0) - +(a.quoteVolume||0))
      .slice(0, 250) // top 250 by volume from MEXC
      .map(t => ({
        sym: t.symbol.replace('USDT',''),
        name: t.symbol.replace('USDT',''),
        px: +(t.lastPrice||0),
        ch24: +(t.priceChangePercent||0),
        ch7d: null,
        vol: +(t.quoteVolume||0),
        h24: +(t.highPrice||+(t.lastPrice||0)*1.02),
        l24: +(t.lowPrice||+(t.lastPrice||0)*0.98),
        mcap: 0, rank: 9999, src: 'mexc',
      }));

    // Merge: CG first, then MEXC unique
    const allCoins = [...cgCoins, ...mexcCoins];

    if (!allCoins.length) {
      return res.status(200).json({ ok:false, error:'Semua sumber data tidak merespons. Coba refresh dalam 30 detik.', ts:Date.now(), totalScanned:0, totalQualified:0, results:[], topSetups:{institutional:[],fullSend:[],highProbBull:[],smcSetups:[],ewSetups:[],volumeBreakout:[],strongSell:[]}, marketOverview:{marketMood:'UNKNOWN',bullishCount:0,bearishCount:0,avgChange24h:0} });
    }

    // Parse CC klines
    const klineMap = {};
    const ccBatch = ccR.status==='fulfilled' ? ccR.value : [];
    ccBatch.forEach((r, i) => {
      try {
        if (r.status!=='fulfilled'||r.value?.Response!=='Success') return;
        const raw = r.value?.Data?.Data;
        if (!raw||raw.length<16) return;
        const K = raw.filter(d=>d.close>0&&d.close<1e12).map(d=>({t:+d.time,o:+d.open,h:+d.high,l:+d.low,c:+d.close,v:+(d.volumeto||0)}));
        if (K.length < 16) return;
        const closes = K.map(k=>k.c);
        const r14 = rsi14(closes); if (r14===null) return;
        const e9=ema(closes,9), e21=ema(closes,21), e50=ema(closes,Math.min(50,closes.length-1));
        const mc = macdSig(closes);
        const px = closes[closes.length-1];
        const smc = smcFull(K, px);
        klineMap[CC30[i]] = { rsi:r14, e9, e21, e50, macd:mc, K, closes, hasReal:true, smc };
      } catch {}
    });

    // ── ANALYZE all coins ─────────────────────────────────
    const results = [];
    for (const c of allCoins) {
      try {
        const { sym, name, px, ch24, ch7d, vol, h24, l24, mcap, rank, src } = c;
        if (!sym || px<=0) continue;
        const ppx  = h24>l24 ? (px-l24)/(h24-l24) : 0.5;
        const rng  = h24>l24 ? (h24-l24)/px*100 : 0;
        const vt   = vol>=1e9?5:vol>=200e6?4:vol>=50e6?3:vol>=10e6?2:vol>=1e6?1:0;
        const volR = mcap>0 ? vol/mcap : 0;

        const kd   = klineMap[sym] || null;
        const c7   = ch7d || 0;
        const rsi  = kd?.hasReal ? kd.rsi : Math.max(10, Math.min(90, 50+ch24*2.5+(ppx-0.5)*25+(c7>0?4:-4)));
        const rsiR = !!(kd?.hasReal);

        // EMA alignment (fast)
        let emaS = 0;
        if (kd?.closes?.length >= 20) {
          const lp = kd.closes[kd.closes.length-1];
          if (lp>kd.e9) emaS++; if (lp>kd.e21) emaS++; if (lp>kd.e50) emaS++;
        } else {
          if (ch24>0) emaS++; if (c7>0) emaS++; if (ppx>0.55) emaS++;
        }

        // Trends
        const t1h = rsi>58?'BULL':rsi<42?'BEAR':'SIDE';
        const t4h = (kd?.macd?.bull||(ch24>1.5&&ppx>0.5)) ? 'BULL' : (ch24<-1.5&&ppx<0.5) ? 'BEAR' : 'SIDE';
        const t1d = c7>3?'BULL':c7<-3?'BEAR':'SIDE';
        const bTF = [t1h,t4h,t1d].filter(t=>t==='BULL').length;
        const beTF= [t1h,t4h,t1d].filter(t=>t==='BEAR').length;

        // SMC (full for CC coins, estimated for rest)
        const smc = kd?.smc || smcEst(px, h24, l24, ch24, c7);

        // Chart patterns
        const pats = patterns(kd?.K||null, px, h24, l24, ch24, ch7d, ppx, vol);

        // Elliott Wave
        const ew = ewWave(rsi, ch24, ch7d, kd?.macd||null, bTF, beTF);

        // Probability (all factors)
        const tC   = bTF===3?28:bTF===2?16:bTF===1?6:beTF===3?-28:beTF===2?-16:beTF===1?-6:0;
        const rC   = rsi<25?(beTF>=2?4:14):rsi<32?(beTF>=2?3:10):rsi<40?(beTF>=2?2:5):rsi<48?1:rsi>75?(bTF>=2?-4:-14):rsi>68?(bTF>=2?-3:-10):rsi>60?(bTF>=2?-1:-5):rsi>52?4:0;
        const mW   = c7>20?10:c7>8?6:c7>3?3:c7<-20?-10:c7<-8?-6:c7<-3?-3:0;
        const m24  = ch24>10?6:ch24>4?3:ch24>1?1:ch24<-10?-6:ch24<-4?-3:ch24<-1?-1:0;
        const mC   = kd?.macd?.xUp?8:kd?.macd?.xDown?-8:kd?.macd?.bull?3:kd?.macd?.bear?-3:0;
        const smcC = (smc?.inBullOB?3:0)+(smc?.hasBOS&&smc?.bosType?.includes('Bull')?3:0)+(smc?.hasCHoCH&&smc?.chochType?.includes('Bull')?2:0)+(smc?.inBullFVG?1:0)-(smc?.inBearOB?3:0)-(smc?.hasBOS&&smc?.bosType?.includes('Bear')?3:0);
        const pC   = pats.some(p=>p.signal==='bullish'&&p.winRate>=80)?3:pats.some(p=>p.signal==='bullish')?1:pats.some(p=>p.signal==='bearish'&&p.winRate>=80)?-3:pats.some(p=>p.signal==='bearish')?-1:0;
        const ewC  = ew.wave.includes('Wave 3')?4:ew.wave.includes('Wave 2')?2:ew.wave.includes('C Complete')||ew.wave.includes('Capitulation')?3:ew.wave.includes('Bearish')||ew.wave.includes('Wave 5 End')?-2:0;
        const rawP = 50+tC+rC+mW+m24+mC+smcC+pC+ewC;
        const prob = Math.max(2, Math.min(98, Math.round(rawP)));
        const score= tC+rC+mW+m24+mC+smcC;

        // Trend label
        let taLabel='⚖️ SIDEWAYS', taColor='neutral';
        if (bTF===3) { taLabel='🚀 FULL SEND'; taColor='full-bull'; }
        else if (bTF>=2) { taLabel='📈 STRONG BULL'; taColor='bull'; }
        else if (bTF===1&&beTF===0) { taLabel='↗️ MILD BULL'; taColor='bull'; }
        else if (beTF===3) { taLabel='💀 FULL BEAR'; taColor='full-bear'; }
        else if (beTF>=2) { taLabel='📉 STRONG BEAR'; taColor='bear'; }
        else if (beTF===1&&bTF===0) { taLabel='↘️ MILD BEAR'; taColor='bear'; }

        // SMC display label
        const smcLabel = kd?.smc?.hasBOS ? kd.smc.bosType : kd?.smc?.hasCHoCH ? 'CHoCH' : smc?.inBullOB ? 'Bull OB' : smc?.inBearOB ? 'Bear OB' : smc?.inBullFVG ? 'Bull FVG' : smc?.signal || 'Neutral';

        // Signals
        const sigs = [];
        if (rsi < 25)       sigs.push(`RSI ${rsi.toFixed(0)} extreme oversold — prime entry 🎯`);
        else if (rsi < 32)  sigs.push(`RSI ${rsi.toFixed(0)} oversold — ${beTF>=2?'reversal watch':'entry zone'}`);
        else if (rsi > 74)  sigs.push(`RSI ${rsi.toFixed(0)} overbought — ${bTF>=2?'reduce size':'caution'}`);
        if (kd?.macd?.xUp)  sigs.push('MACD golden cross ✅ — new momentum');
        if (kd?.macd?.xDown)sigs.push('MACD death cross ⚠️');
        if (kd?.macd?.div)  sigs.push('MACD divergence — trend weakening ⚠️');
        if (smc?.bullOB)    sigs.push(`Bull OB $${smc.bullOB.low}–$${smc.bullOB.high} — ICT demand zone`);
        if (smc?.bearOB)    sigs.push(`Bear OB $${smc.bearOB.low}–$${smc.bearOB.high} — ICT supply zone`);
        if (smc?.bullFVG)   sigs.push(`Bull FVG ${smc.bullFVG.gapPct}% gap — price imbalance`);
        if (smc?.liqSweep)  sigs.push(`${smc.liqSweep.type} $${smc.liqSweep.level}`);
        if (smc?.hasCHoCH)  sigs.push(`${smc.chochType}`);
        if (smc?.hasBOS && ch24>5)  sigs.push(`${smc.bosType} $${smc.bosLevel}`);
        if (smc?.inOTE)     sigs.push('In OTE zone (ICT 61.8–78.6%) — optimal entry');
        if (smc?.eqH)       sigs.push(smc.eqH.desc);
        if (smc?.eqL)       sigs.push(smc.eqL.desc);
        if (vt>=4&&ch24>3)  sigs.push(`$${['','','','','200M+','1B+'][vt]} vol +${ch24.toFixed(1)}%`);
        if (bTF===3)        sigs.push('All 3 TF aligned bullish 🎯 — highest conviction');
        pats.forEach(p => sigs.push(`${p.name} (${p.winRate}%): ${p.desc}`));

        results.push({
          rank: results.length+1, symbol: sym, name,
          price: px, change24h: +ch24.toFixed(2), change7d: ch7d!==null?+ch7d.toFixed(2):null,
          volume24h: vol, mcap, mcapRank: rank,
          high24h: h24, low24h: l24, pricePos: +ppx.toFixed(3), range: +rng.toFixed(2),
          rsi: +rsi.toFixed(2), rsiReal: rsiR, vt, volRatio: +volR.toFixed(4),
          dataSource: src,
          trendAlignment: taLabel, taColor,
          trend1h: t1h, trend4h: t4h, trend1d: t1d, bullTF: bTF, bearTF: beTF,
          smc: { ...smc, signal: smcLabel },
          elliottWave: { wave: ew.wave, confidence: ew.conf, description: ew.desc },
          chartPatterns: pats.length > 0 ? pats : [{ name: ch24>=0?'Bullish Candle':'Bearish Candle', signal: ch24>=0?'bullish':'bearish', winRate:0 }],
          probability: prob, score,
          signals: sigs.slice(0, 5),
          astrology: { moonPhase: astro.moonPhase, moonEmoji: astro.moonEmoji, halvingPhase: astro.halvingPhase, chaotic: astro.chaotic },
          hasRealData: rsiR,
        });
      } catch { /* skip failed coin */ }
    }

    results.sort((a,b) => b.probability-a.probability || b.score-a.score);
    results.forEach((r,i) => r.rank = i+1);

    // Tabs
    const institutional  = results.filter(r=>r.score>=16&&r.probability>=60&&r.volume24h>=5e6).slice(0,80);
    const fullSend       = results.filter(r=>(r.taColor==='full-bull'||r.bullTF===3)&&r.probability>=65).slice(0,60);
    const highProbBull   = results.filter(r=>r.probability>=68&&r.score>=12).slice(0,60);
    const smcSetups      = results.filter(r=>(r.smc?.inBullOB||r.smc?.inBullFVG||r.smc?.hasCHoCH)&&r.probability>=52).slice(0,60);
    const ewSetups       = results.filter(r=>{const w=r.elliottWave?.wave||'';return(w.includes('Wave 3')||w.includes('Wave 2'))?r.probability>=52:(w.includes('C Complete')||w.includes('Capitulation'))?r.probability>=50:(r.rsi<38&&r.change24h>0)?r.probability>=48:false;}).sort((a,b)=>b.probability-a.probability).slice(0,60);
    const volumeBreakout = results.filter(r=>r.vt>=3&&r.change24h>1.5&&r.probability>50).sort((a,b)=>b.volume24h-a.volume24h).slice(0,60);
    const strongSell     = results.filter(r=>r.probability<38||r.taColor==='full-bear').sort((a,b)=>a.probability-b.probability).slice(0,40);

    const bullC = results.filter(r=>r.probability>55).length;
    const bearC = results.filter(r=>r.probability<45).length;
    const avgCh = results.length ? +(results.reduce((s,r)=>s+r.change24h,0)/results.length).toFixed(2) : 0;
    const mood  = avgCh>3?'STRONG BULL':avgCh>1?'BULL':avgCh<-3?'STRONG BEAR':avgCh<-1?'BEAR':'NEUTRAL';

    return res.status(200).json({
      ok: true, ts: Date.now(), elapsed: Date.now()-t0, version: 'v24',
      src: `cg:${cgCoins.length}+mexc:${mexcCoins.length}`,
      fg, totalScanned: allCoins.length, totalQualified: results.length,
      rsiRealCount: Object.keys(klineMap).length,
      results,
      topSetups: { institutional, fullSend, highProbBull, smcSetups, ewSetups, volumeBreakout, strongSell },
      marketOverview: { marketMood: mood, bullishCount: bullC, bearishCount: bearC, avgChange24h: avgCh, totalCoins: results.length },
      astroContext: astro,
    });

  } catch (e) {
    return res.status(200).json({ ok:false, error:e.message, ts:Date.now(), elapsed:Date.now()-t0, version:'v24', totalScanned:0, totalQualified:0, results:[], topSetups:{institutional:[],fullSend:[],highProbBull:[],smcSetups:[],ewSetups:[],volumeBreakout:[],strongSell:[]}, marketOverview:{marketMood:'UNKNOWN',bullishCount:0,bearishCount:0,avgChange24h:0} });
  }
}
