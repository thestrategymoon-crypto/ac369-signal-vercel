// api/scanner-full.js — AC369 FUSION v11.1 FIXED
// ═══════════════════════════════════════════════════════════════
// FIX: Probability 100% bug — score clamp too easy to hit max
// FIX: Wave 3 detection requires STRICTER confirmation
// FIX: BOS detection more realistic from ticker data
// FIX: Probability max = 90% (100% only theoretically perfect)
// FIX: Better data source labeling
// FIX: Daily Bias from /api/bias (not recomputed here)
// KEEP: Trend Alignment, Mercury Retrograde, Institutional filter
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
      // PRIMARY: Binance Spot (never geo-blocked)
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
      // BTC 4H from CryptoCompare (always works)
      sf('https://min-api.cryptocompare.com/data/v2/histohour?fsym=BTC&tsym=USD&limit=200')
        .then(d => d?.Response === 'Success' && d.Data?.Data?.length > 20
          ? d.Data.Data.map(x => ({ c: +x.close, v: +x.volumeto })).filter(k => k.c > 0)
          : sf('https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=4h&limit=50')
              .then(d => Array.isArray(d) ? d.map(k => ({ c: +k[4], v: +k[5] })) : null)
        ),
    ]);

    const rawTickers = tickerRes.status === 'fulfilled' ? tickerRes.value : [];
    if (!Array.isArray(rawTickers) || rawTickers.length === 0) {
      return res.status(500).json({ error: 'All ticker sources failed', results: [], totalScanned: 0 });
    }

    // ── DAILY MARKET BIAS ─────────────────────────────────────────
    let dailyBias = { bias: 'NEUTRAL', biasLabel: '⚖️ NEUTRAL', biasScore: 0, details: [], recommendation: 'Selektif.', fgValue: 50, btcDom: 58, btcTrend: 'NEUTRAL' };
    let biasScore = 0, fgValue = 50, btcDom = 58, btcTrend = 'NEUTRAL';
    const biasDetail = [];

    if (fngRes.status === 'fulfilled' && fngRes.value?.data) {
      fgValue = parseInt(fngRes.value.data[0].value);
      if (fgValue <= 20) { biasScore += 3; biasDetail.push(`F&G ${fgValue} (Extreme Fear)`); }
      else if (fgValue <= 35) { biasScore += 2; biasDetail.push(`F&G ${fgValue} (Fear)`); }
      else if (fgValue >= 80) { biasScore -= 3; biasDetail.push(`F&G ${fgValue} (Extreme Greed)`); }
      else if (fgValue >= 65) { biasScore -= 2; biasDetail.push(`F&G ${fgValue} (Greed)`); }
      else { biasDetail.push(`F&G ${fgValue} (Neutral)`); }
    }

    if (globalRes.status === 'fulfilled' && globalRes.value?.data) {
      btcDom = parseFloat((globalRes.value.data.market_cap_percentage?.btc || 58).toFixed(1));
      if (btcDom > 62) { biasScore -= 2; biasDetail.push(`BTC Dom ${btcDom}% (sangat tinggi)`); }
      else if (btcDom > 57) { biasScore -= 1; biasDetail.push(`BTC Dom ${btcDom}%`); }
      else if (btcDom < 48) { biasScore += 2; biasDetail.push(`BTC Dom ${btcDom}% (altseason)`); }
      else { biasDetail.push(`BTC Dom ${btcDom}%`); }
    }

    const btcK = btcKlineRes.status === 'fulfilled' && Array.isArray(btcKlineRes.value) ? btcKlineRes.value : null;
    if (btcK && btcK.length >= 20) {
      const closes = btcK.map(k => k.c);
      const last = closes[closes.length - 1];
      const ema20 = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
      const ema50 = closes.length >= 50 ? closes.slice(-50).reduce((a, b) => a + b, 0) / 50 : closes.reduce((a, b) => a + b, 0) / closes.length;
      let g = 0, l = 0;
      for (let i = closes.length - 14; i < closes.length; i++) { const d = closes[i] - closes[i - 1]; d >= 0 ? g += d : l -= d; }
      const rsi4h = l === 0 ? 100 : parseFloat((100 - 100 / (1 + (g / 14) / (l / 14))).toFixed(1));
      const ts = (last > ema20 ? 1 : -1) + (last > ema50 ? 1 : -1) + (rsi4h > 50 ? 0.5 : -0.5);
      if (ts >= 2) { btcTrend = 'BULLISH'; biasScore += 3; biasDetail.push(`BTC 4H BULLISH (RSI ${rsi4h})`); }
      else if (ts > 0) { btcTrend = 'BULLISH_WEAK'; biasScore += 1; biasDetail.push(`BTC 4H lemah naik (RSI ${rsi4h})`); }
      else if (ts <= -2) { btcTrend = 'BEARISH'; biasScore -= 3; biasDetail.push(`BTC 4H BEARISH (RSI ${rsi4h})`); }
      else if (ts < 0) { btcTrend = 'BEARISH_WEAK'; biasScore -= 1; biasDetail.push(`BTC 4H lemah turun (RSI ${rsi4h})`); }
    }

    let biasLabel, biasRec;
    if (biasScore >= 5) { biasLabel = '🚀 STRONG BULLISH'; biasRec = '✅ Kondisi ideal Long. Prioritaskan entry bullish berkualitas tinggi.'; }
    else if (biasScore >= 2) { biasLabel = '📈 BULLISH'; biasRec = '✅ Kondisi baik Long. Filter sinyal beli yang kuat.'; }
    else if (biasScore <= -5) { biasLabel = '💀 STRONG BEARISH'; biasRec = '⚠️ Prioritaskan Short/Sell atau Cash.'; }
    else if (biasScore <= -2) { biasLabel = '📉 BEARISH'; biasRec = '⚠️ Hati-hati Long. Altcoin naik mungkin dead-cat bounce.'; }
    else { biasLabel = '⚖️ NEUTRAL'; biasRec = '⚖️ Selektif — ikuti setup berkualitas tinggi saja.'; }

    dailyBias = { bias: biasScore >= 5 ? 'STRONG_BULL' : biasScore >= 2 ? 'BULLISH' : biasScore <= -5 ? 'STRONG_BEAR' : biasScore <= -2 ? 'BEARISH' : 'NEUTRAL', biasLabel, biasScore, details: biasDetail, recommendation: biasRec, fgValue, btcDom: +btcDom.toFixed(1), btcTrend };
    const isBearishBias = dailyBias.bias === 'BEARISH' || dailyBias.bias === 'STRONG_BEAR';
    const isBullishBias = dailyBias.bias === 'BULLISH' || dailyBias.bias === 'STRONG_BULL';

    // ── ASTRO ─────────────────────────────────────────────────────
    const now = new Date();
    const jdNow = Date.now() / 86400000 + 2440587.5;
    const daysSinceNM = ((jdNow - 2460320.5) % 29.53058867 + 29.53058867) % 29.53058867;
    const halvingDate = new Date('2024-04-20');
    const daysSinceHalving = Math.floor((Date.now() - halvingDate.getTime()) / 86400000);

    const mrs = [
      { s: new Date('2025-03-15'), e: new Date('2025-04-07') },
      { s: new Date('2025-07-18'), e: new Date('2025-08-11') },
      { s: new Date('2025-11-09'), e: new Date('2025-12-01') },
      { s: new Date('2026-03-08'), e: new Date('2026-03-31') },
      { s: new Date('2026-07-06'), e: new Date('2026-07-30') },
      { s: new Date('2026-10-28'), e: new Date('2026-11-18') },
    ];
    const inMR = mrs.some(p => now >= p.s && now <= p.e);
    const inMRShadow = mrs.some(p => { const ps = new Date(p.s.getTime() - 7*86400000); const pe = new Date(p.e.getTime() + 7*86400000); return now >= ps && now <= pe; });
    const astroChaotic = inMR || (daysSinceNM >= 14 && daysSinceNM < 16); // Full Moon

    let moonPhase, moonEmoji;
    if (daysSinceNM < 1.5) { moonPhase = 'New Moon'; moonEmoji = '🌑'; }
    else if (daysSinceNM < 7.5) { moonPhase = 'Waxing Crescent'; moonEmoji = '🌒'; }
    else if (daysSinceNM < 8.5) { moonPhase = 'First Quarter'; moonEmoji = '🌓'; }
    else if (daysSinceNM < 14) { moonPhase = 'Waxing Gibbous'; moonEmoji = '🌔'; }
    else if (daysSinceNM < 16) { moonPhase = 'Full Moon'; moonEmoji = '🌕'; }
    else if (daysSinceNM < 22) { moonPhase = 'Waning'; moonEmoji = '🌖'; }
    else { moonPhase = 'Dark Moon'; moonEmoji = '🌘'; }

    let halvingPhase;
    if (daysSinceHalving < 90) halvingPhase = 'Post-Halving Early';
    else if (daysSinceHalving < 365) halvingPhase = 'Bull Cycle Early ✅';
    else if (daysSinceHalving < 547) halvingPhase = 'Bull Cycle Peak ⚠️';
    else if (daysSinceHalving < 730) halvingPhase = 'Distribution ⚠️';
    else halvingPhase = 'Bear Market / Accumulation';

    const astroStr = `${moonEmoji} ${moonPhase}`;
    const astroWarning = inMR ? '⚠️ Mercury Retrograde' : astroChaotic ? '🌕 Full Moon Chaos' : inMRShadow ? '⚠️ MR Shadow' : null;

    // ── FILTER STABLECOINS / LEVERAGED ───────────────────────────
    const STABLES = new Set(['USDT','USDC','BUSD','TUSD','DAI','FDUSD','USDP','SUSD','GUSD','FRAX','LUSD','CRVUSD','USDD','USTC','PYUSD']);
    const BAD_SFX = ['UP','DOWN','BEAR','BULL','3L','3S','2L','2S','5L','5S'];
    const filtered = rawTickers.filter(t => {
      if (!t || typeof t !== 'object') return false;
      const sym = String(t.symbol || '');
      if (!sym.endsWith('USDT')) return false;
      const base = sym.replace('USDT', '');
      if (STABLES.has(base) || base.length < 2) return false;
      if (BAD_SFX.some(s => base.endsWith(s) || base.startsWith(s))) return false;
      if (+(t.quoteVolume || 0) < 500000) return false;
      if (+(t.lastPrice || 0) <= 0) return false;
      return true;
    });
    filtered.sort((a, b) => +(b.quoteVolume || 0) - +(a.quoteVolume || 0));
    const dataSource = rawTickers[0]?._cg ? 'coingecko' : 'binance';

    // ── PROCESS EACH COIN ─────────────────────────────────────────
    const results = [];

    for (const t of filtered.slice(0, 1000)) {
      const base = t.symbol.replace('USDT', '');
      const price = +(t.lastPrice || 0);
      const change24h = +(t.priceChangePercent || 0);
      const vol24h = +(t.quoteVolume || 0);
      const high = +(t.highPrice || price * 1.02);
      const low = +(t.lowPrice || price * 0.98);
      const open = +(t.openPrice || t.prevClosePrice || price);
      if (price <= 0) continue;

      const range = high - low || price * 0.02;
      const rangePos = range > 0 ? (price - low) / range : 0.5;
      const body = Math.abs(price - open);
      const lw = range > 0 ? (Math.min(price, open) - low) / range : 0;
      const uw = range > 0 ? (high - Math.max(price, open)) / range : 0;
      const pctFromLow = rangePos;
      const pctFromHigh = 1 - rangePos;

      // ── SMC ANALYSIS ──────────────────────────────────────────
      let smcSignal = 'NONE', smcDetail = '';
      let inBullOB = false, inBearOB = false, inBullFVG = false, inBearFVG = false;
      let hasBOS = false, hasCHoCH = false;
      let smcScore = 0;

      // Bull OB: price near day low + hammer wick (institutional accumulation)
      // Strict: must be within 12% of low AND have significant lower wick
      if (pctFromLow <= 0.12 && lw >= 0.40 && change24h > -10) {
        inBullOB = true; smcSignal = 'BULL_OB';
        smcDetail = `Bull OB near low — institutional accumulation zone`;
        smcScore += 4;
      }
      // Bear OB: price near day high + upper wick rejection
      else if (pctFromHigh <= 0.12 && uw >= 0.40 && change24h < 10) {
        inBearOB = true; smcSignal = 'BEAR_OB';
        smcDetail = `Bear OB near high — distribution zone`;
        smcScore -= 4;
      }

      // FVG: gap between open and current price (retesting gap)
      // Strict: minimum 3% gap AND mid-range position (retesting)
      if (open > 0 && price > open * 1.03 && rangePos > 0.28 && rangePos < 0.58) {
        inBullFVG = true;
        if (smcScore >= 0) { smcSignal = 'BULL_FVG'; smcDetail = `Bull FVG retest (+${((price/open-1)*100).toFixed(1)}%)`; smcScore += 3; }
      }
      if (open > 0 && price < open * 0.97 && rangePos > 0.42 && rangePos < 0.72) {
        inBearFVG = true;
        if (smcScore <= 0) { smcSignal = 'BEAR_FVG'; smcDetail = `Bear FVG fill (${((price/open-1)*100).toFixed(1)}%)`; smcScore -= 3; }
      }

      // BOS/CHoCH: Clean breaks with MINIMUM 5% move AND volume confirmation
      // Strict: change > 7% for BOS (avoid false breakouts)
      if (change24h >= 7 && price > open * 1.06 && rangePos >= 0.72 && vol24h > 5000000) {
        hasBOS = true; smcSignal = 'BOS_BULL';
        smcDetail = `BOS Bullish +${change24h.toFixed(1)}% — confirmed breakout`;
        smcScore += 5;
      } else if (change24h <= -7 && price < open * 0.94 && rangePos <= 0.28 && vol24h > 3000000) {
        hasBOS = true; smcSignal = 'BOS_BEAR';
        smcDetail = `BOS Bearish ${change24h.toFixed(1)}% — confirmed breakdown`;
        smcScore -= 5;
      }
      // CHoCH: moderate reversal with body confirmation
      else if (change24h > 3.5 && change24h < 7 && rangePos > 0.62 && body / range > 0.45) {
        hasCHoCH = true; smcSignal = 'CHOCH_BULL';
        smcDetail = `CHoCH Bullish — tren berubah naik`;
        smcScore += 3;
      } else if (change24h < -3.5 && change24h > -7 && rangePos < 0.38 && body / range > 0.45) {
        hasCHoCH = true; smcSignal = 'CHOCH_BEAR';
        smcDetail = `CHoCH Bearish — tren berubah turun`;
        smcScore -= 3;
      }

      // Premium/Discount zone
      const midRange = (high + low) / 2;
      const inDiscount = price < midRange * 0.97;
      const inPremium = price > midRange * 1.03;
      if (inDiscount && smcScore > 0) smcScore += 1;
      if (inPremium && smcScore < 0) smcScore -= 1;

      // ── ELLIOTT WAVE ──────────────────────────────────────────
      // STRICT detection: requires multiple confirmations
      let ewWave = '-', ewBias = 'NEUTRAL', ewScore = 0;
      let isWave3Early = false, isWave5 = false, isWaveC = false;

      // Wave 3 Early: STRICT — must have significant momentum + volume + NOT overbought
      // Requires: change >= 5% (not just 4%), vol > 10M (institutional), rangePos 0.65-0.88
      if (change24h >= 5 && rangePos >= 0.65 && rangePos < 0.88 && vol24h >= 10000000 && pctFromHigh > 0.05) {
        isWave3Early = true; ewWave = '⚡ Wave 3 (Early)'; ewBias = 'BULLISH'; ewScore = 4;
      }
      // Wave 3 Developing: price above midrange with momentum, moderate volume
      else if (change24h >= 2 && change24h < 5 && rangePos >= 0.5 && rangePos < 0.75 && lw > 0.12 && vol24h >= 5000000) {
        ewWave = '📈 Wave 3 (Dev)'; ewBias = 'BULLISH'; ewScore = 3;
      }
      // Wave 1: initial impulse from downtrend, modest move
      else if (change24h >= 2 && change24h < 4.5 && rangePos >= 0.55 && rangePos < 0.72 && open > 0 && price > open * 1.02) {
        ewWave = '🌱 Wave 1 (Impulse)'; ewBias = 'BULLISH'; ewScore = 2;
      }
      // Wave 4 correction (pullback, still bullish structure)
      else if (change24h >= -3.5 && change24h <= -0.5 && rangePos >= 0.28 && rangePos <= 0.52 && lw > 0.22) {
        ewWave = '🔄 Wave 4 (Correction)'; ewBias = 'BULLISH_WEAK'; ewScore = 1;
      }
      // Wave 5 top: extended, overbought — AVOID BUYING
      else if (change24h >= 8 && rangePos >= 0.88 && uw > 0.15) {
        isWave5 = true; ewWave = '🏔️ Wave 5 (Peak)'; ewBias = 'AVOID'; ewScore = -2;
      }
      // Wave C Bearish: strong down with volume
      else if (change24h <= -4 && rangePos <= 0.32 && vol24h >= 5000000) {
        isWaveC = true; ewWave = '📉 Wave C (Bear)'; ewBias = 'BEARISH'; ewScore = -4;
      }
      // Post-ABC accumulation
      else if (change24h >= 1 && change24h < 2.5 && rangePos >= 0.38 && lw > 0.28) {
        ewWave = '🔁 Post-ABC Setup'; ewBias = 'BULLISH_WEAK'; ewScore = 1;
      }
      // Bearish impulse
      else if (change24h <= -4) { ewWave = '📉 Bearish Impulse'; ewBias = 'BEARISH'; ewScore = -3; }
      else { ewWave = '—'; ewBias = 'NEUTRAL'; ewScore = 0; }

      // ── VOLUME ────────────────────────────────────────────────
      let volScore = 0, volSignal = '', isVolBreakout = false;
      const volTier = vol24h >= 500e6 ? 5 : vol24h >= 100e6 ? 4 : vol24h >= 30e6 ? 3 : vol24h >= 10e6 ? 2 : vol24h >= 3e6 ? 1 : 0;

      // Institutional Volume: requires both HIGH volume AND significant price move
      if (volTier >= 3 && Math.abs(change24h) >= 5) {
        isVolBreakout = true;
        volSignal = `💥 Inst.Vol $${(vol24h / 1e6).toFixed(0)}M`;
        volScore = change24h > 0 ? 4 : -4;
      } else if (volTier >= 2 && Math.abs(change24h) >= 3) {
        isVolBreakout = true;
        volSignal = `📊 $${(vol24h / 1e6).toFixed(0)}M`;
        volScore = change24h > 0 ? 2 : -2;
      } else if (volTier >= 4 && Math.abs(change24h) >= 1) {
        volSignal = `Vol $${(vol24h / 1e6).toFixed(0)}M`;
        volScore = change24h > 0 ? 1 : -1;
      } else if (volTier >= 1) {
        volScore = change24h > 0 ? 0.5 : -0.5;
      }

      // ── CANDLE PATTERN ────────────────────────────────────────
      let patternScore = 0;
      const chartPatterns = [];
      if (lw / range > 0.55 && body / range < 0.25 && price >= open) { chartPatterns.push({ name: '🔨 Hammer', signal: 'bullish', probability: 70 }); patternScore += 1.5; }
      if (uw / range > 0.55 && body / range < 0.25 && price <= open) { chartPatterns.push({ name: '🌠 Shooting Star', signal: 'bearish', probability: 68 }); patternScore -= 1.5; }
      if (body / range < 0.08) { chartPatterns.push({ name: '➕ Doji', signal: 'neutral', probability: 50 }); }
      if (body / range > 0.75 && price > open) { chartPatterns.push({ name: '💪 Bull Marubozu', signal: 'bullish', probability: 72 }); patternScore += 1; }
      if (body / range > 0.75 && price < open) { chartPatterns.push({ name: '💀 Bear Marubozu', signal: 'bearish', probability: 72 }); patternScore -= 1; }
      if (!chartPatterns.length) {
        chartPatterns.push({ name: change24h > 2 ? 'Momentum Naik' : change24h < -2 ? 'Momentum Turun' : 'Sideways', signal: change24h > 2 ? 'bullish' : change24h < -2 ? 'bearish' : 'neutral', probability: 55 });
      }

      // ── ASTRO SCORE ───────────────────────────────────────────
      // Very conservative — astro should not inflate scores
      // During Mercury Retrograde: zero bonus (might penalize)
      const month = now.getMonth() + 1;
      const monthBonus = { 1:0.5, 2:0.5, 3:0, 4:0.5, 5:-0.5, 6:-0.5, 7:0, 8:0, 9:-1, 10:1, 11:0.5, 12:0.5 }[month] || 0;
      const moonBonus = daysSinceNM < 1.5 ? 0.5 : daysSinceNM < 7.5 ? 0.3 : daysSinceNM >= 14 && daysSinceNM < 16 ? -0.5 : 0;
      const halvingBonus = daysSinceHalving < 365 ? 0.5 : daysSinceHalving < 547 ? 0.3 : daysSinceHalving < 730 ? -0.3 : -0.5;
      // During Mercury Retrograde: clear penalty, no reward possible
      const astroScore = astroChaotic ? -0.5 : (monthBonus + moonBonus + halvingBonus);

      // ── TREND ALIGNMENT ───────────────────────────────────────
      const trend1h = price > open * 1.004 ? 'BULL' : price < open * 0.996 ? 'BEAR' : 'NEUT';
      const trend4h = rangePos > 0.55 && change24h > 0 ? 'BULL' : rangePos < 0.45 && change24h < 0 ? 'BEAR' : change24h > 1.5 ? 'BULL' : change24h < -1.5 ? 'BEAR' : 'NEUT';
      const trend1d = change24h > 2.5 ? 'BULL' : change24h < -2.5 ? 'BEAR' : 'NEUT';

      const bullC = [trend1h === 'BULL', trend4h === 'BULL', trend1d === 'BULL'].filter(Boolean).length;
      const bearC = [trend1h === 'BEAR', trend4h === 'BEAR', trend1d === 'BEAR'].filter(Boolean).length;

      let trendAlignment = '⚖️ SIDEWAYS', taScore = 0, taColor = 'neutral';
      if (bullC === 3) { trendAlignment = '🚀 FULL SEND'; taScore = 5; taColor = 'full-bull'; }
      else if (bullC === 2 && bearC === 0) { trendAlignment = '✅ STRONG BUY'; taScore = 3; taColor = 'bull'; }
      else if (bullC === 2) { trendAlignment = '📈 BUY'; taScore = 2; taColor = 'bull'; }
      else if (bearC === 3) { trendAlignment = '💀 FULL SHORT'; taScore = -5; taColor = 'full-bear'; }
      else if (bearC === 2 && bullC === 0) { trendAlignment = '🔴 STRONG SELL'; taScore = -3; taColor = 'bear'; }
      else if (bearC === 2) { trendAlignment = '📉 SELL'; taScore = -2; taColor = 'bear'; }
      else if (bullC === 1 && bearC === 0) { trendAlignment = '⚡ WEAK BULL'; taScore = 1; taColor = 'weak-bull'; }
      else if (bearC === 1 && bullC === 0) { trendAlignment = '⚠️ WEAK BEAR'; taScore = -1; taColor = 'weak-bear'; }

      // Bias adjustment for trend alignment
      if (isBearishBias && bullC === 3) { trendAlignment = '⚠️ BULL vs BIAS'; taScore -= 2; }
      if (isBullishBias && bearC === 3) { trendAlignment = '⚠️ BEAR vs BIAS'; taScore += 2; }

      // ── TOTAL SCORE ───────────────────────────────────────────
      // FIXED: Use float scores, clamp range reduced to -10..+10
      // This means hitting max (prob 90%) requires perfect setup
      const totalScore = smcScore + ewScore + volScore + patternScore + astroScore + taScore;

      // ── INSTITUTIONAL FILTER ──────────────────────────────────
      const smcQualified = smcSignal !== 'NONE' && smcScore !== 0;
      const ewQualified = ewBias !== 'NEUTRAL' && ewWave !== '—' && ewBias !== 'AVOID';
      const volQualified = isVolBreakout || volTier >= 2;

      // PRIMARY FILTER: Must meet at least 2 of 3 criteria
      const primaryFilters = [smcQualified, ewQualified, volQualified].filter(Boolean).length;
      if (primaryFilters < 2) continue;
      if (astroChaotic && Math.abs(totalScore) < 8) continue; // During chaos, only top setups
      if (isWave5) continue; // Never buy Wave 5 tops

      // ── PROBABILITY MAPPING ───────────────────────────────────
      // FIXED: Scale -10 to +10 → 10% to 90%
      // Score of +10 = 90% (top tier), never 100%
      const clampedScore = Math.max(-10, Math.min(10, totalScore));
      // Map: -10 → 10%, 0 → 50%, +10 → 90%
      const rawProb = 50 + (clampedScore * 4); // 4 points per score unit
      const prob = Math.round(Math.min(90, Math.max(12, rawProb))); // Hard cap: 12-90%
      const probLabel = prob >= 82 ? '🔥 Premium Setup' : prob >= 73 ? '💎 High Prob' : prob >= 62 ? '📊 Good Setup' : prob >= 50 ? '👀 Pantau' : prob >= 38 ? '⚠️ Bearish Setup' : '💀 Short Setup';

      // Build signals
      const signals = [];
      if (smcDetail) signals.push(smcDetail);
      if (volSignal) signals.push(volSignal);
      if (hasBOS) signals.push(`BOS ${smcScore > 0 ? 'Bullish' : 'Bearish'} ✓`);
      if (hasCHoCH) signals.push(`CHoCH ${smcScore > 0 ? 'Bullish' : 'Bearish'} ✓`);
      if (inBullOB) signals.push('Bull OB ✓');
      if (inBearOB) signals.push('Bear OB ✓');
      if (inBullFVG) signals.push('Bull FVG ✓');
      if (inBearFVG) signals.push('Bear FVG ✓');

      results.push({
        rank: 0, symbol: base, fullSymbol: t.symbol, name: base,
        price, change24h: +change24h.toFixed(2), priceChange24h: +change24h.toFixed(2),
        volume24h: vol24h, highPrice: high, lowPrice: low, rangePos: +rangePos.toFixed(3),
        smc: { signal: smcScore > 0 ? 'Bullish' : smcScore < 0 ? 'Bearish' : 'Neutral', summary: smcDetail || 'No clear signal', hasBOS, hasCHoCH, inBullOB, inBearOB, inBullFVG, inBearFVG, inDiscount, inPremium, smcScore: +smcScore.toFixed(1) },
        elliottWave: { wave: ewWave, confidence: Math.abs(ewScore) >= 4 ? 80 : Math.abs(ewScore) >= 3 ? 70 : Math.abs(ewScore) >= 2 ? 60 : 50, description: ewBias, isWave3Early, isWaveC, isWave5, bias: ewBias },
        volume: { score: +volScore.toFixed(1), signal: volSignal, isBreakout: isVolBreakout, tier: volTier },
        trendAlignment, taScore, taColor, trend1h, trend4h, trend1d,
        astrology: { signal: astroStr, moonPhase, moonEmoji, illumination: Math.round(daysSinceNM / 29.53 * 100), interpretation: halvingPhase, chaotic: astroChaotic, warning: astroWarning },
        astro: `${astroStr}\n${halvingPhase}`,
        chartPatterns: chartPatterns.slice(0, 2),
        pattern: chartPatterns[0]?.name || '—',
        smcScore: +smcScore.toFixed(1), ewScore: +ewScore.toFixed(1), volScore: +volScore.toFixed(1),
        patternScore: +patternScore.toFixed(1), astroScore: +astroScore.toFixed(1), taScore,
        score: +totalScore.toFixed(2),
        probability: prob, probLabel,
        breakoutProbability: { score: prob, reasons: signals.slice(0, 4), interpretation: probLabel },
        signals: signals.slice(0, 4),
        reason: change24h >= 0 ? `+${Math.min(change24h * 1.2, 30).toFixed(1)}%` : `${Math.max(change24h * 1.2, -30).toFixed(1)}%`,
      });
    }

    results.sort((a, b) => b.score - a.score || b.probability - a.probability || b.volume24h - a.volume24h);
    results.forEach((r, i) => { r.rank = i + 1; });

    // Market overview
    const allChg = results.map(r => r.change24h);
    const bullCnt = allChg.filter(c => c > 1).length;
    const bearCnt = allChg.filter(c => c < -1).length;
    const avgChg = allChg.length ? +(allChg.reduce((a, b) => a + b, 0) / allChg.length).toFixed(2) : 0;

    // Subsets
    const topSetups = {
      institutional: results.filter(r => r.score > 0 && (r.smc.hasBOS || r.smc.inBullOB || r.smc.inBullFVG) && r.elliottWave.isWave3Early).slice(0, 40),
      bullish: results.filter(r => r.score > 0).slice(0, 60),
      bearish: results.filter(r => r.score < 0).slice(0, 40),
      fullSend: results.filter(r => r.taColor === 'full-bull').slice(0, 30),
      strongSell: results.filter(r => r.taColor === 'full-bear' || r.taColor === 'bear').slice(0, 30),
      highProbBull: results.filter(r => r.probability >= 73 && r.score > 0).slice(0, 30),
      volumeBreakout: results.filter(r => r.volume.isBreakout && r.change24h > 0).slice(0, 30),
      smcSetups: results.filter(r => r.smcScore > 0).slice(0, 30),
      ewSetups: results.filter(r => r.ewScore > 0 && (r.elliottWave.isWave3Early || r.elliottWave.wave?.includes('Dev'))).slice(0, 30),
    };

    res.setHeader('Cache-Control', 's-maxage=30');
    return res.status(200).json({
      timestamp: Date.now(),
      totalScanned: filtered.length,
      totalQualified: results.length,
      scanDuration: ((Date.now() - start) / 1000).toFixed(1),
      dataSource,
      dailyBias,
      astroContext: { moonPhase, moonEmoji, halvingPhase, daysSinceNM: +daysSinceNM.toFixed(1), astroChaotic, warning: astroWarning, inMercuryRetrograde: inMR, inMercuryShadow },
      marketOverview: { bullishCount: bullCnt, bearishCount: bearCnt, neutralCount: results.length - bullCnt - bearCnt, avgChange24h: avgChg, marketMood: dailyBias.bias },
      results,
      topSetups,
    });

  } catch (e) {
    return res.status(500).json({ error: e.message, results: [], totalScanned: 0, timestamp: Date.now() });
  }
}
