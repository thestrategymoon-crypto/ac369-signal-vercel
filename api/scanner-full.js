// api/scanner-full.js — AC369 FUSION v11.0 INSTITUTIONAL
// ═══════════════════════════════════════════════════════════════
// PRIMARY FILTER: SMC (OB/FVG/BOS) + Elliott Wave + Volume Breakout
// FEATURES:
//   • Trend Alignment (FULL SEND / STRONG BUY / SELL / etc)
//   • Daily Market Bias (BTC Dom + F&G → pengaruhi prioritas)
//   • Astro Mercury Retrograde / chaotic phase filter
//   • SMC: OB/FVG detection dari ticker data proxy
//   • Elliott Wave: Wave 3 Early / Wave C detection
//   • Volume Breakout institutional confirmation
// ═══════════════════════════════════════════════════════════════

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const sf = async (url, ms = 12000) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
      const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } });
      clearTimeout(t); if (!r.ok) return null; return await r.json();
    } catch { clearTimeout(t); return null; }
  };

  try {
    const start = Date.now();

    // ── PARALLEL DATA FETCH ───────────────────────────────────────
    const [tickerRes, fngRes, globalRes, btcKlineRes] = await Promise.allSettled([
      // Tickers: Binance Spot → Futures → CoinGecko
      sf('https://api.binance.com/api/v3/ticker/24hr')
        .then(d => Array.isArray(d) && d.length > 100 ? d :
          sf('https://fapi.binance.com/fapi/v1/ticker/24hr')
            .then(d2 => Array.isArray(d2) && d2.length > 100 ? d2 :
              sf('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=volume_desc&per_page=250&page=1&sparkline=false&price_change_percentage=24h')
                .then(cg => Array.isArray(cg) ? cg.map(c => ({
                  symbol: (c.symbol||'').toUpperCase()+'USDT',
                  lastPrice: String(c.current_price||0),
                  priceChangePercent: String(c.price_change_percentage_24h||0),
                  quoteVolume: String(c.total_volume||0),
                  highPrice: String((c.current_price||0)*1.05),
                  lowPrice: String((c.current_price||0)*0.95),
                  openPrice: String((c.current_price||0)/(1+(c.price_change_percentage_24h||0)/100)),
                  _cg: true
                })) : [])
            )
        ),
      sf('https://api.alternative.me/fng/?limit=1&format=json'),
      sf('https://api.coingecko.com/api/v3/global'),
      // BTC 4H klines for Daily Bias
      sf('https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=4h&limit=50')
        .then(d => Array.isArray(d) && d.length > 10 ? d :
          sf('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=4h&limit=50'))
    ]);

    const rawTickers = tickerRes.status === 'fulfilled' ? tickerRes.value : [];
    if (!Array.isArray(rawTickers) || rawTickers.length === 0) {
      return res.status(500).json({ error: 'All ticker sources failed', results: [], totalScanned: 0 });
    }

    // ── DAILY MARKET BIAS ─────────────────────────────────────────
    // Combines: F&G + BTC Dominance + BTC 4H trend
    let dailyBias = 'NEUTRAL';
    let biasScore = 0;
    let biasDetail = [];
    let fgValue = 50, btcDom = 58;

    if (fngRes.status === 'fulfilled' && fngRes.value?.data) {
      fgValue = parseInt(fngRes.value.data[0].value);
      if (fgValue <= 25) { biasScore += 3; biasDetail.push(`F&G ${fgValue} (Extreme Fear — zona beli)`); }
      else if (fgValue <= 40) { biasScore += 1; biasDetail.push(`F&G ${fgValue} (Fear — beli hati-hati)`); }
      else if (fgValue >= 80) { biasScore -= 3; biasDetail.push(`F&G ${fgValue} (Extreme Greed — waspada)`); }
      else if (fgValue >= 65) { biasScore -= 1; biasDetail.push(`F&G ${fgValue} (Greed — kurangi eksposur)`); }
      else { biasDetail.push(`F&G ${fgValue} (Neutral)`); }
    }

    if (globalRes.status === 'fulfilled' && globalRes.value?.data) {
      btcDom = parseFloat(globalRes.value.data.market_cap_percentage?.btc || 58);
      if (btcDom > 60) { biasScore -= 2; biasDetail.push(`BTC Dom ${btcDom.toFixed(1)}% — BTC season, altcoin laggard`); }
      else if (btcDom > 55) { biasScore -= 1; biasDetail.push(`BTC Dom ${btcDom.toFixed(1)}% — transisi`); }
      else if (btcDom < 45) { biasScore += 2; biasDetail.push(`BTC Dom ${btcDom.toFixed(1)}% — altseason aktif`); }
      else { biasDetail.push(`BTC Dom ${btcDom.toFixed(1)}%`); }
    }

    // BTC 4H trend
    let btcTrend = 'NEUTRAL';
    if (btcKlineRes.status === 'fulfilled' && Array.isArray(btcKlineRes.value) && btcKlineRes.value.length > 20) {
      const K = btcKlineRes.value;
      const closes = K.map(k => parseFloat(k[4]));
      const last = closes[closes.length - 1];
      const ema20 = closes.slice(-20).reduce((a,b)=>a+b,0)/20;
      const ema50 = closes.slice(-50).reduce((a,b)=>a+b,0)/Math.min(50,closes.length);
      // RSI
      let g=0,l=0;
      for(let i=closes.length-14;i<closes.length;i++){const d=closes[i]-closes[i-1];d>=0?g+=d:l-=d;}
      const ag=g/14,al=l/14;
      const rsi4h=al===0?100:parseFloat((100-100/(1+ag/al)).toFixed(1));
      // Trend
      const tScore=(last>ema20?1:-1)+(last>ema50?1:-1)+(rsi4h>50?0.5:-0.5);
      if(tScore>1.5){btcTrend='BULLISH';biasScore+=2;biasDetail.push(`BTC 4H BULLISH (RSI ${rsi4h})`);}
      else if(tScore>0){btcTrend='BULLISH_WEAK';biasScore+=1;biasDetail.push(`BTC 4H Lemah Naik (RSI ${rsi4h})`);}
      else if(tScore<-1.5){btcTrend='BEARISH';biasScore-=2;biasDetail.push(`BTC 4H BEARISH (RSI ${rsi4h})`);}
      else if(tScore<0){btcTrend='BEARISH_WEAK';biasScore-=1;biasDetail.push(`BTC 4H Lemah Turun (RSI ${rsi4h})`);}
    }

    // Compute final daily bias
    if (biasScore >= 4) { dailyBias = 'STRONG_BULL'; }
    else if (biasScore >= 2) { dailyBias = 'BULLISH'; }
    else if (biasScore <= -4) { dailyBias = 'STRONG_BEAR'; }
    else if (biasScore <= -2) { dailyBias = 'BEARISH'; }
    else { dailyBias = 'NEUTRAL'; }

    const isBearishBias = dailyBias === 'BEARISH' || dailyBias === 'STRONG_BEAR';
    const isBullishBias = dailyBias === 'BULLISH' || dailyBias === 'STRONG_BULL';

    // ── ASTRO COMPUTATION ─────────────────────────────────────────
    const now = new Date();
    const jdNow = Date.now() / 86400000 + 2440587.5;
    const daysSinceNM = ((jdNow - 2460320.5) % 29.53058867 + 29.53058867) % 29.53058867;
    const halvingDate = new Date('2024-04-20');
    const daysSinceHalving = Math.floor((Date.now() - halvingDate.getTime()) / 86400000);
    const month = now.getMonth() + 1;
    const dow = now.getDay();
    const dayOfMonth = now.getDate();

    // Mercury Retrograde dates (2025-2026) — chaotic trading periods
    const mercuryRetrogrades = [
      { start: new Date('2025-03-15'), end: new Date('2025-04-07') },
      { start: new Date('2025-07-18'), end: new Date('2025-08-11') },
      { start: new Date('2025-11-09'), end: new Date('2025-12-01') },
      { start: new Date('2026-03-08'), end: new Date('2026-03-31') },
      { start: new Date('2026-07-06'), end: new Date('2026-07-30') },
      { start: new Date('2026-10-28'), end: new Date('2026-11-18') },
    ];
    const inMercuryRetrograde = mercuryRetrogrades.some(p => now >= p.start && now <= p.end);
    // Shadow period = 1 week before/after retrograde (still chaotic)
    const inMercuryShadow = mercuryRetrogrades.some(p => {
      const preStart = new Date(p.start.getTime() - 7*86400000);
      const postEnd = new Date(p.end.getTime() + 7*86400000);
      return now >= preStart && now <= postEnd;
    });

    // Moon phase
    let moonPhase, moonEmoji, moonBonus, moonChaos = false;
    if (daysSinceNM < 1.5) { moonPhase='New Moon';moonEmoji='🌑';moonBonus=2; }
    else if (daysSinceNM < 7.5) { moonPhase='Waxing Crescent';moonEmoji='🌒';moonBonus=1; }
    else if (daysSinceNM < 8.5) { moonPhase='First Quarter';moonEmoji='🌓';moonBonus=0; }
    else if (daysSinceNM < 14) { moonPhase='Waxing Gibbous';moonEmoji='🌔';moonBonus=1; }
    else if (daysSinceNM < 15.5) { moonPhase='Full Moon';moonEmoji='🌕';moonBonus=-1;moonChaos=true; } // Full moon = high volatility
    else if (daysSinceNM < 22) { moonPhase='Waning';moonEmoji='🌖';moonBonus=-1; }
    else { moonPhase='Dark Moon';moonEmoji='🌘';moonBonus=1; }

    // Halving cycle bonus
    let halvingPhase, halvingBonus;
    if (daysSinceHalving < 90) { halvingPhase='Post-Halving Early';halvingBonus=0; }
    else if (daysSinceHalving < 365) { halvingPhase='Bull Cycle Early ✅';halvingBonus=2; }
    else if (daysSinceHalving < 547) { halvingPhase='Bull Cycle Peak ⚠️';halvingBonus=1; }
    else if (daysSinceHalving < 730) { halvingPhase='Distribution ⚠️';halvingBonus=-1; }
    else { halvingPhase='Bear Market';halvingBonus=-2; }

    // Month / Day seasonality
    const monthBonus = {1:1,2:1,3:0,4:1,5:-1,6:-1,7:0,8:0,9:-2,10:2,11:2,12:1}[month]||0;
    const dayBonus = [0,1,0,0,1,-1,-1][dow]||0;
    const astroTotal = moonBonus + halvingBonus + monthBonus + dayBonus;

    // CHAOTIC ASTRO: Mercury Retrograde OR Full Moon
    const astroChaotic = inMercuryRetrograde || moonChaos;
    const astroWarning = inMercuryRetrograde
      ? '⚠️ Mercury Retrograde — sinyal palsu tinggi, kurangi leverage'
      : moonChaos
      ? '🌕 Full Moon — volatilitas ekstrem, SL ketat'
      : inMercuryShadow
      ? '⚠️ Mercury Shadow — hati-hati konfirmasi sinyal'
      : null;

    const astroStr = `${moonEmoji} ${moonPhase}`;
    const astroSub = halvingPhase;

    // ── FILTER: STABLECOINS & LEVERAGED TOKENS ────────────────────
    const STABLES = new Set(['USDT','USDC','BUSD','TUSD','DAI','FDUSD','USDP','SUSD','GUSD','FRAX','LUSD','CRVUSD','USDD','USTC','PYUSD']);
    const IGNORE = new Set(['USDTUSDT','BUSDUSDT','USDCUSDT','TUSDUSDT','FDUSDUSDT','BTCDOMUSDT','DEFIUSDT']);
    const BAD_SFX = ['UP','DOWN','BEAR','BULL','3L','3S','2L','2S','5L','5S'];

    const filtered = rawTickers.filter(t => {
      if (!t || typeof t !== 'object') return false;
      const sym = String(t.symbol||'');
      if (!sym.endsWith('USDT')) return false;
      if (IGNORE.has(sym)) return false;
      const base = sym.replace('USDT','');
      if (STABLES.has(base)) return false;
      if (BAD_SFX.some(s => base.endsWith(s)||base.startsWith(s))) return false;
      if (+(t.quoteVolume||0) < 500000) return false;
      if (+(t.lastPrice||0) <= 0) return false;
      return true;
    });

    filtered.sort((a,b) => +(b.quoteVolume||0) - +(a.quoteVolume||0));

    // ── PROCESS EACH COIN ─────────────────────────────────────────
    const results = [];

    for (const t of filtered.slice(0, 1000)) {
      const base = t.symbol.replace('USDT','');
      const price = +(t.lastPrice||0);
      const change24h = +(t.priceChangePercent||0);
      const vol24h = +(t.quoteVolume||0);
      const high = +(t.highPrice||price*1.02);
      const low = +(t.lowPrice||price*0.98);
      const open = +(t.openPrice||t.prevClosePrice||price);
      if (price <= 0) continue;

      const range = high - low || price * 0.02;
      const rangePos = (price - low) / range;
      const body = Math.abs(price - open);
      const lw = (Math.min(price, open) - low) / range;
      const uw = (high - Math.max(price, open)) / range;

      // ──────────────────────────────────────────────────────────
      // BLOCK 1: SMC ANALYSIS (Order Block + FVG + BOS detection)
      // Using ticker data proxy — intraday structure
      // ──────────────────────────────────────────────────────────

      // Order Block detection proxy:
      // Bull OB: price near day low AND strong bounce (long lower wick)
      // Bear OB: price near day high AND strong rejection (long upper wick)
      const pctFromLow = range > 0 ? (price - low) / range : 0.5;
      const pctFromHigh = range > 0 ? (high - price) / range : 0.5;

      let smcSignal = 'NONE';
      let smcDetail = '';
      let inBullOB = false, inBearOB = false;
      let inBullFVG = false, inBearFVG = false;
      let hasBOS = false, hasCHoCH = false;
      let smcScore = 0;

      // Bull Order Block: price within 5% of day low + bullish bounce structure
      if (pctFromLow <= 0.15 && lw >= 0.35 && change24h > -8) {
        inBullOB = true;
        smcSignal = 'BULL_OB';
        smcDetail = `Bull OB near low ($${price.toFixed(6)})`;
        smcScore += 4;
      }
      // Bear Order Block: price within 5% of day high + bearish rejection
      else if (pctFromHigh <= 0.15 && uw >= 0.35 && change24h < 8) {
        inBearOB = true;
        smcSignal = 'BEAR_OB';
        smcDetail = `Bear OB near high ($${price.toFixed(6)})`;
        smcScore -= 4;
      }

      // FVG (Fair Value Gap) proxy:
      // Bull FVG: price gapped up and retested (open < prev low context, price near open)
      // Approximate: big gap up (open < 97% of price) with consolidation
      if (open > 0 && price > open * 1.03 && rangePos > 0.3 && rangePos < 0.6) {
        inBullFVG = true;
        if (smcScore >= 0) {
          smcSignal = 'BULL_FVG';
          smcDetail = `Bull FVG — retesting gap (open ${open > 0 ? '+' : ''}${((price/open-1)*100).toFixed(1)}%)`;
          smcScore += 3;
        }
      }
      if (open > 0 && price < open * 0.97 && rangePos > 0.4 && rangePos < 0.7) {
        inBearFVG = true;
        if (smcScore <= 0) {
          smcSignal = 'BEAR_FVG';
          smcDetail = `Bear FVG — filling gap down (${((price/open-1)*100).toFixed(1)}%)`;
          smcScore -= 3;
        }
      }

      // BOS/CHoCH proxy via price action:
      // BOS Bullish: strong close above day open with volume → structure break
      if (change24h >= 5 && price > open * 1.05 && rangePos >= 0.7) {
        hasBOS = true;
        smcSignal = 'BOS_BULL';
        smcDetail = `BOS Bullish — breakout +${change24h.toFixed(1)}%`;
        smcScore += 5;
      }
      // BOS Bearish: strong close below day open
      else if (change24h <= -5 && price < open * 0.95 && rangePos <= 0.3) {
        hasBOS = true;
        smcSignal = 'BOS_BEAR';
        smcDetail = `BOS Bearish — breakdown ${change24h.toFixed(1)}%`;
        smcScore -= 5;
      }
      // CHoCH: previous down trend now shows bullish structure (oversold bounce with body)
      else if (change24h > 3 && rangePos > 0.6 && lw > 0.2 && body/range > 0.4) {
        hasCHoCH = true;
        smcSignal = 'CHOCH_BULL';
        smcDetail = `CHoCH Bullish — karakter berubah naik`;
        smcScore += 3;
      }
      else if (change24h < -3 && rangePos < 0.4 && uw > 0.2 && body/range > 0.4) {
        hasCHoCH = true;
        smcSignal = 'CHOCH_BEAR';
        smcDetail = `CHoCH Bearish — karakter berubah turun`;
        smcScore -= 3;
      }

      // Premium/Discount zone
      const midRange = (high + low) / 2;
      const inDiscount = price < midRange * 0.98; // below midpoint = discount (buy zone)
      const inPremium = price > midRange * 1.02;   // above midpoint = premium (sell zone)
      if (inDiscount && smcScore > 0) { smcScore += 1; smcDetail += ' | ✅ Discount Zone'; }
      if (inPremium && smcScore < 0) { smcScore -= 1; smcDetail += ' | ⚠️ Premium Zone'; }
      if (inDiscount && smcScore >= 0) smcDetail += ' | ✅ Discount Zone';
      if (inPremium && smcScore <= 0) smcDetail += ' | ⚠️ Premium Zone';

      // ──────────────────────────────────────────────────────────
      // BLOCK 2: ELLIOTT WAVE ANALYSIS
      // Based on: price position, candle structure, momentum
      // ──────────────────────────────────────────────────────────
      let ewWave = '-';
      let ewBias = 'NEUTRAL';
      let ewScore = 0;
      let isWave3Early = false;
      let isWaveC = false;
      let isWave5 = false; // avoid — near end

      // Wave 3 Early: Breakout from consolidation with momentum
      // Characteristics: strong move (4%+), not overbought (rangePos 0.6-0.85), volume expansion
      if (change24h >= 4 && rangePos >= 0.6 && rangePos < 0.88 && vol24h > 5000000) {
        isWave3Early = true;
        ewWave = '⚡ Wave 3 (Early)';
        ewBias = 'BULLISH';
        ewScore = 4;
      }
      // Wave 3 Developing: Already in strong uptrend, pullback to support
      else if (change24h >= 1.5 && change24h < 4 && rangePos >= 0.45 && rangePos < 0.7 && lw > 0.15) {
        ewWave = '📈 Wave 3 (Developing)';
        ewBias = 'BULLISH';
        ewScore = 2;
      }
      // Wave 1 Early: Small breakout from downtrend, first impulse
      else if (change24h >= 2 && change24h < 5 && rangePos >= 0.55 && rangePos < 0.75 && open > 0 && price > open * 1.02) {
        ewWave = '🌱 Wave 1 (Early Impulse)';
        ewBias = 'BULLISH';
        ewScore = 2;
      }
      // Wave 4 Correction: Pullback in overall uptrend, holding structure
      else if (change24h >= -3 && change24h <= 0 && rangePos >= 0.3 && rangePos <= 0.55 && lw > 0.25) {
        ewWave = '🔄 Wave 4 (Buy Dip)';
        ewBias = 'BULLISH_WEAK';
        ewScore = 1;
      }
      // Wave 5 Top: Extended move, overbought territory — AVOID
      else if (change24h >= 8 && rangePos >= 0.88) {
        isWave5 = true;
        ewWave = '🏔️ Wave 5 (Puncak)';
        ewBias = 'AVOID';
        ewScore = -2; // penalize — risky to buy at top
      }
      // Wave C Bearish (Corrective down): 3-wave structure correction after uptrend
      else if (change24h <= -3 && rangePos <= 0.35 && vol24h > 5000000) {
        isWaveC = true;
        ewWave = '📉 Wave C (Bearish)';
        ewBias = 'BEARISH';
        ewScore = -4;
      }
      // ABC correction completed (potential Wave 1 setup)
      else if (change24h >= 1 && change24h < 3 && rangePos >= 0.4 && lw > 0.3) {
        ewWave = '🔁 Post-ABC Setup';
        ewBias = 'BULLISH_WEAK';
        ewScore = 1;
      }
      // Consolidation
      else if (Math.abs(change24h) < 1.5 && rangePos > 0.3 && rangePos < 0.7) {
        ewWave = '⚖️ Konsolidasi';
        ewBias = 'NEUTRAL';
        ewScore = 0;
      }
      // Generic bearish
      else if (change24h < -3) {
        ewWave = '📉 Impuls Turun';
        ewBias = 'BEARISH';
        ewScore = -3;
      }
      else {
        ewWave = '—';
        ewBias = 'NEUTRAL';
        ewScore = 0;
      }

      // ──────────────────────────────────────────────────────────
      // BLOCK 3: VOLUME BREAKOUT (Institutional confirmation)
      // ──────────────────────────────────────────────────────────
      let volScore = 0;
      let volSignal = '';
      let isVolBreakout = false;

      // Volume scoring
      const volTier = vol24h >= 500e6 ? 5 : vol24h >= 100e6 ? 4 : vol24h >= 30e6 ? 3 : vol24h >= 10e6 ? 2 : vol24h >= 3e6 ? 1 : 0;

      // Institutional Volume Breakout: HIGH volume + significant price move
      if (volTier >= 3 && Math.abs(change24h) >= 5) {
        isVolBreakout = true;
        volSignal = `💥 Inst. Vol (${(vol24h/1e6).toFixed(0)}M)`;
        volScore = change24h > 0 ? 4 : -4;
      } else if (volTier >= 2 && Math.abs(change24h) >= 3) {
        isVolBreakout = true;
        volSignal = `📊 Vol Breakout (${(vol24h/1e6).toFixed(0)}M)`;
        volScore = change24h > 0 ? 2 : -2;
      } else if (volTier >= 4) {
        volSignal = `Vol $${(vol24h/1e6).toFixed(0)}M`;
        volScore = change24h > 0 ? 1 : -1;
      } else if (volTier >= 1 && change24h > 0) {
        volScore = 1;
      }

      // ──────────────────────────────────────────────────────────
      // BLOCK 4: CANDLE PATTERN
      // ──────────────────────────────────────────────────────────
      let patternScore = 0;
      const chartPatterns = [];

      if (lw / range > 0.55 && body / range < 0.25 && price >= open) {
        chartPatterns.push({ name: '🔨 Hammer', signal: 'bullish', probability: 70 });
        patternScore += 2;
      }
      if (uw / range > 0.55 && body / range < 0.25 && price <= open) {
        chartPatterns.push({ name: '🌠 Shooting Star', signal: 'bearish', probability: 68 });
        patternScore -= 2;
      }
      if (body / range < 0.08) {
        chartPatterns.push({ name: '➕ Doji', signal: 'neutral', probability: 50 });
      }
      if (body / range > 0.75 && price > open) {
        chartPatterns.push({ name: '💪 Bull Marubozu', signal: 'bullish', probability: 72 });
        patternScore += 1;
      }
      if (body / range > 0.75 && price < open) {
        chartPatterns.push({ name: '💀 Bear Marubozu', signal: 'bearish', probability: 72 });
        patternScore -= 1;
      }
      if (!chartPatterns.length) {
        chartPatterns.push({ name: change24h > 2 ? 'Momentum Naik' : change24h < -2 ? 'Momentum Turun' : 'Sideways', signal: change24h > 2 ? 'bullish' : change24h < -2 ? 'bearish' : 'neutral', probability: 55 });
      }

      // ──────────────────────────────────────────────────────────
      // BLOCK 5: ASTRO SCORE
      // ──────────────────────────────────────────────────────────
      const astroScore = astroChaotic ? 0 : astroTotal; // zero out if chaotic

      // ──────────────────────────────────────────────────────────
      // BLOCK 6: TREND ALIGNMENT (Multi-TF proxy from ticker data)
      // Using: price vs open (1H proxy), price action (4H proxy), 24h change (1D proxy)
      // ──────────────────────────────────────────────────────────
      // 1H: short-term — price vs open (last few hours)
      const trend1h = price > open * 1.005 ? 'BULL' : price < open * 0.995 ? 'BEAR' : 'NEUT';
      // 4H: medium-term — price position in day range
      const trend4h = rangePos > 0.55 && change24h > 0 ? 'BULL' : rangePos < 0.45 && change24h < 0 ? 'BEAR' : change24h > 1 ? 'BULL' : change24h < -1 ? 'BEAR' : 'NEUT';
      // 1D: daily bias — 24h change
      const trend1d = change24h > 2 ? 'BULL' : change24h < -2 ? 'BEAR' : 'NEUT';

      // Trend Alignment Label
      let trendAlignment = '', taScore = 0, taColor = 'neutral';
      const bullCount = [trend1h==='BULL', trend4h==='BULL', trend1d==='BULL'].filter(Boolean).length;
      const bearCount = [trend1h==='BEAR', trend4h==='BEAR', trend1d==='BEAR'].filter(Boolean).length;

      if (bullCount === 3) {
        trendAlignment = '🚀 FULL SEND'; taScore = 5; taColor = 'full-bull';
      } else if (bullCount === 3 && dailyBias === 'STRONG_BULL') {
        trendAlignment = '🚀 FULL SEND'; taScore = 6; taColor = 'full-bull';
      } else if (bullCount === 2 && bearCount === 0) {
        trendAlignment = '✅ STRONG BUY'; taScore = 3; taColor = 'bull';
      } else if (bullCount === 2) {
        trendAlignment = '📈 BUY'; taScore = 2; taColor = 'bull';
      } else if (bearCount === 3) {
        trendAlignment = '💀 FULL SHORT'; taScore = -5; taColor = 'full-bear';
      } else if (bearCount === 2 && bullCount === 0) {
        trendAlignment = '🔴 STRONG SELL'; taScore = -3; taColor = 'bear';
      } else if (bearCount === 2) {
        trendAlignment = '📉 SELL'; taScore = -2; taColor = 'bear';
      } else if (bullCount === 1 && bearCount === 0) {
        trendAlignment = '⚡ WEAK BULL'; taScore = 1; taColor = 'weak-bull';
      } else if (bearCount === 1 && bullCount === 0) {
        trendAlignment = '⚠️ WEAK BEAR'; taScore = -1; taColor = 'weak-bear';
      } else {
        trendAlignment = '⚖️ SIDEWAYS'; taScore = 0; taColor = 'neutral';
      }

      // Adjust trend alignment based on daily bias
      if (isBearishBias && taColor === 'full-bull') {
        trendAlignment = '⚠️ BULL vs BEAR BIAS'; taScore -= 2;
      }
      if (isBullishBias && taColor === 'full-bear') {
        trendAlignment = '⚠️ BEAR vs BULL BIAS'; taScore += 2;
      }

      // ──────────────────────────────────────────────────────────
      // BLOCK 7: TOTAL SCORE
      // ──────────────────────────────────────────────────────────
      const totalScore = smcScore + ewScore + volScore + patternScore + astroScore + taScore;

      // ──────────────────────────────────────────────────────────
      // BLOCK 8: INSTITUTIONAL FILTER
      // Only pass coins that meet quality thresholds
      // ──────────────────────────────────────────────────────────
      const smcQualified = smcSignal !== 'NONE' && smcScore !== 0;
      const ewQualified = ewBias !== 'NEUTRAL' && ewWave !== '—' && ewBias !== 'AVOID';
      const volQualified = isVolBreakout || volTier >= 2;

      // PRIMARY FILTER (strict): Must meet at least 2 of 3 primary criteria
      const primaryFilters = [smcQualified, ewQualified, volQualified].filter(Boolean).length;
      const passesFilter = primaryFilters >= 2;

      // ASTRO filter: skip if chaotic AND not a very strong setup
      const astroOK = !astroChaotic || Math.abs(totalScore) >= 8;

      // Wave 5 filter: never recommend buying at wave 5 top
      const ewOK = !isWave5 || totalScore < 0; // Wave 5 only OK for shorts

      // Skip if doesn't meet institutional quality bar
      if (!passesFilter || !astroOK || !ewOK) continue;

      // ──────────────────────────────────────────────────────────
      // BLOCK 9: PROBABILITY MAPPING
      // ──────────────────────────────────────────────────────────
      const clamped = Math.max(-12, Math.min(12, totalScore));
      const prob = clamped >= 10 ? 100 : clamped >= 8 ? 95 : clamped >= 6 ? 88 : clamped >= 5 ? 82 : clamped >= 4 ? 78 : clamped >= 3 ? 73 : clamped >= 2 ? 68 : clamped >= 1 ? 62 : clamped >= 0 ? 50 : clamped >= -1 ? 40 : clamped >= -2 ? 34 : clamped >= -3 ? 28 : 20;
      const probLabel = prob >= 88 ? '🔥 Premium Setup' : prob >= 78 ? '💎 High Prob' : prob >= 68 ? '📊 Good Setup' : prob >= 55 ? '👀 Pantau' : prob >= 40 ? '⚠️ Bearish Setup' : '💀 Short Setup';

      // Build signals array
      const signals = [];
      if (smcDetail) signals.push(smcDetail);
      if (volSignal) signals.push(volSignal);
      if (hasBOS) signals.push('BOS ✓');
      if (hasCHoCH) signals.push('CHoCH ✓');
      if (inBullOB) signals.push('Bull OB ✓');
      if (inBearOB) signals.push('Bear OB ✓');
      if (inBullFVG) signals.push('Bull FVG ✓');
      if (inBearFVG) signals.push('Bear FVG ✓');

      results.push({
        rank: 0, symbol: base, fullSymbol: t.symbol, name: base,
        price, change24h: +change24h.toFixed(2), priceChange24h: +change24h.toFixed(2),
        volume24h: vol24h, highPrice: high, lowPrice: low, rangePos: +rangePos.toFixed(3),
        // SMC data
        smc: {
          signal: smcScore > 0 ? 'Bullish' : smcScore < 0 ? 'Bearish' : 'Neutral',
          summary: smcDetail || 'No clear OB/FVG',
          hasBOS, hasCHoCH, inBullOB, inBearOB, inBullFVG, inBearFVG,
          inDiscount, inPremium, smcScore,
        },
        // Elliott Wave data
        elliottWave: {
          wave: ewWave,
          confidence: Math.abs(ewScore) > 3 ? 80 : Math.abs(ewScore) > 1 ? 65 : 50,
          description: ewBias,
          isWave3Early, isWaveC, isWave5,
          bias: ewBias,
        },
        // Volume data
        volume: { score: volScore, signal: volSignal, isBreakout: isVolBreakout, tier: volTier },
        // Trend Alignment
        trendAlignment, taScore, taColor,
        trend1h, trend4h, trend1d,
        // Astro
        astrology: {
          signal: astroStr,
          moonPhase, moonEmoji,
          illumination: Math.round(daysSinceNM / 29.53 * 100),
          interpretation: halvingPhase,
          chaotic: astroChaotic,
          warning: astroWarning,
        },
        astro: `${astroStr}\n${halvingPhase}`,
        // Chart patterns
        chartPatterns: chartPatterns.slice(0, 2),
        pattern: chartPatterns[0]?.name || '—',
        // Scores
        smcScore, ewScore, volScore, patternScore, astroScore, taScore,
        score: +totalScore.toFixed(1),
        probability: prob, probLabel,
        breakoutProbability: { score: prob, reasons: signals.slice(0, 4), interpretation: probLabel },
        signals: signals.slice(0, 4),
        reason: change24h >= 0 ? `+${Math.min(change24h*1.2,30).toFixed(1)}%` : `${Math.max(change24h*1.2,-30).toFixed(1)}%`,
      });
    }

    // Sort: by total score descending
    results.sort((a, b) => b.score - a.score || b.probability - a.probability || b.volume24h - a.volume24h);
    results.forEach((r, i) => { r.rank = i + 1; });

    // ── MARKET OVERVIEW ───────────────────────────────────────────
    const allChg = results.map(r => r.change24h);
    const bullCnt = allChg.filter(c => c > 1).length;
    const bearCnt = allChg.filter(c => c < -1).length;
    const avgChg = allChg.length ? +(allChg.reduce((a,b)=>a+b,0)/allChg.length).toFixed(2) : 0;

    // Sub-filtered sets
    const institutionalBull = results.filter(r => r.score > 0 && (r.smc.hasBOS || r.smc.inBullOB || r.smc.inBullFVG) && r.elliottWave.isWave3Early);
    const smcOnly = results.filter(r => r.smcScore > 0);
    const ewOnly = results.filter(r => r.ewScore > 0 && (r.elliottWave.isWave3Early || r.elliottWave.wave?.includes('Developing')));
    const volBreakouts = results.filter(r => r.volume.isBreakout && r.change24h > 0);
    const fullSend = results.filter(r => r.taColor === 'full-bull');
    const strongSell = results.filter(r => r.taColor === 'full-bear' || r.taColor === 'bear');

    // Data source
    const dataSource = rawTickers[0]?._cg ? 'coingecko' : 'binance';

    res.setHeader('Cache-Control', 's-maxage=30');
    return res.status(200).json({
      timestamp: Date.now(),
      totalScanned: filtered.length,
      totalQualified: results.length,
      scanDuration: ((Date.now()-start)/1000).toFixed(1),
      dataSource,
      // Daily Bias
      dailyBias: {
        bias: dailyBias, score: biasScore,
        details: biasDetail,
        btcTrend, fgValue, btcDom: +btcDom.toFixed(1),
        recommendation: isBearishBias
          ? '⚠️ Bias BEARISH — prioritaskan Short/Sell. Altcoin bullish MELAWAN ARUS.'
          : isBullishBias
          ? '✅ Bias BULLISH — kondisi bagus untuk Long. Filter sinyal beli.'
          : '⚖️ Bias NEUTRAL — selektif, ikuti setup terbaik saja.',
      },
      // Astro context
      astroContext: {
        moonPhase, moonEmoji, halvingPhase,
        daysSinceNM: +daysSinceNM.toFixed(1),
        astroTotal, astroChaotic,
        warning: astroWarning,
        inMercuryRetrograde, inMercuryShadow,
      },
      // Market overview
      marketOverview: {
        bullishCount: bullCnt, bearishCount: bearCnt,
        neutralCount: results.length - bullCnt - bearCnt,
        avgChange24h: avgChg,
        marketMood: dailyBias,
      },
      // Main results
      results,
      // Filtered subsets for tabs
      topSetups: {
        institutional: institutionalBull.slice(0, 30),   // SMC OB/FVG + Wave 3 Early
        bullish: results.filter(r => r.score > 0).slice(0, 50),
        bearish: results.filter(r => r.score < 0).slice(0, 30),
        fullSend: fullSend.slice(0, 20),                  // FULL SEND (3/3 TF bullish)
        strongSell: strongSell.slice(0, 20),
        highProbBull: results.filter(r => r.probability >= 78 && r.score > 0).slice(0, 25),
        volumeBreakout: volBreakouts.slice(0, 25),
        smcSetups: smcOnly.slice(0, 25),
        ewSetups: ewOnly.slice(0, 25),
      },
    });

  } catch (e) {
    return res.status(500).json({ error: e.message, results: [], totalScanned: 0, timestamp: Date.now() });
  }
}
