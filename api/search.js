// api/search.js — AC369 FUSION v10.2
// FIXED: RSI dengan Wilder's smoothing benar
// FIXED: Elliott Wave dengan Fibonacci levels real
// FIXED: SMC dengan OB/FVG/liquidity detection real
// SUPPORT: 1000+ koin via Binance + CoinGecko fallback

const TIMEOUT = 8000;

async function fetchWithTimeout(url, ms = TIMEOUT) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' } });
    clearTimeout(timer);
    return r?.ok ? r : null;
  } catch {
    clearTimeout(timer);
    return null;
  }
}

// ── RSI PROPER (Wilder's Smoothing) ─────────────────────────────────────────
function calcRSI(closes, period = 14) {
  if (!closes || closes.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gains += d; else losses -= d;
  }
  let ag = gains / period, al = losses / period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    ag = (ag * (period - 1) + (d >= 0 ? d : 0)) / period;
    al = (al * (period - 1) + (d < 0 ? -d : 0)) / period;
  }
  if (al === 0) return 100;
  return parseFloat((100 - 100 / (1 + ag / al)).toFixed(2));
}

// ── EMA ──────────────────────────────────────────────────────────────────────
function calcEMA(closes, period) {
  if (!closes || closes.length < period) return closes?.[closes.length - 1] || 0;
  const k = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < closes.length; i++) ema = closes[i] * k + ema * (1 - k);
  return ema;
}

// ── ATR ───────────────────────────────────────────────────────────────────────
function calcATR(K, period = 14) {
  if (!K || K.length < 2) return 0;
  const trs = K.slice(1).map((k, i) => Math.max(k.h - k.l, Math.abs(k.h - K[i].c), Math.abs(k.l - K[i].c)));
  return trs.slice(-period).reduce((a, b) => a + b, 0) / Math.min(period, trs.length);
}

// ── SWING FINDER ─────────────────────────────────────────────────────────────
function findSwings(K, lb = 3) {
  const highs = [], lows = [];
  for (let i = lb; i < K.length - lb; i++) {
    let iH = true, iL = true;
    for (let j = i - lb; j <= i + lb; j++) {
      if (j === i) continue;
      if (K[j].h >= K[i].h) iH = false;
      if (K[j].l <= K[i].l) iL = false;
    }
    if (iH) highs.push({ price: K[i].h, i });
    if (iL) lows.push({ price: K[i].l, i });
  }
  return { highs, lows };
}

// ── CANDLE PATTERNS ───────────────────────────────────────────────────────────
function detectPatterns(K) {
  const patterns = [];
  if (!K || K.length < 3) return patterns;
  const last = K[K.length - 1];
  const prev = K[K.length - 2];
  const prev2 = K[K.length - 3];

  const body = Math.abs(last.c - last.o);
  const range = last.h - last.l || 0.0001;
  const lw = Math.min(last.c, last.o) - last.l;
  const uw = last.h - Math.max(last.c, last.o);

  // Bullish Engulfing
  if (prev.c < prev.o && last.c > last.o && last.o <= prev.c && last.c >= prev.o) {
    patterns.push({ name: 'Bullish Engulfing', signal: 'bullish', probability: 78 });
  }
  // Bearish Engulfing
  if (prev.c > prev.o && last.c < last.o && last.o >= prev.c && last.c <= prev.o) {
    patterns.push({ name: 'Bearish Engulfing', signal: 'bearish', probability: 78 });
  }
  // Hammer (long lower wick)
  if (lw > body * 2 && uw < body * 0.5 && range > 0) {
    patterns.push({ name: 'Hammer / Pin Bar Bullish', signal: 'bullish', probability: 74 });
  }
  // Shooting Star
  if (uw > body * 2 && lw < body * 0.5 && range > 0) {
    patterns.push({ name: 'Shooting Star', signal: 'bearish', probability: 73 });
  }
  // Morning Star
  if (prev2.c < prev2.o && Math.abs(prev.c - prev.o) < range * 0.3 && last.c > last.o && last.c > (prev2.c + prev2.o) / 2) {
    patterns.push({ name: 'Morning Star', signal: 'bullish', probability: 80 });
  }
  // Evening Star
  if (prev2.c > prev2.o && Math.abs(prev.c - prev.o) < range * 0.3 && last.c < last.o && last.c < (prev2.c + prev2.o) / 2) {
    patterns.push({ name: 'Evening Star', signal: 'bearish', probability: 79 });
  }
  // Three White Soldiers
  if (prev2.c > prev2.o && prev.c > prev.o && last.c > last.o && prev.c > prev2.c && last.c > prev.c) {
    patterns.push({ name: 'Three White Soldiers', signal: 'bullish', probability: 83 });
  }
  // Three Black Crows
  if (prev2.c < prev2.o && prev.c < prev.o && last.c < last.o && prev.c < prev2.c && last.c < prev.c) {
    patterns.push({ name: 'Three Black Crows', signal: 'bearish', probability: 82 });
  }
  // Inside Bar
  if (last.h < prev.h && last.l > prev.l) {
    patterns.push({ name: 'Inside Bar (Konsolidasi)', signal: 'neutral', probability: 58 });
  }
  // Doji
  if (body / range < 0.08 && range > 0) {
    patterns.push({ name: 'Doji', signal: 'neutral', probability: 52 });
  }

  if (patterns.length === 0) {
    const change = last.c > 0 && prev.c > 0 ? ((last.c - prev.c) / prev.c) * 100 : 0;
    if (change > 2) patterns.push({ name: 'Momentum Naik', signal: 'bullish', probability: 58 });
    else if (change < -2) patterns.push({ name: 'Momentum Turun', signal: 'bearish', probability: 58 });
    else patterns.push({ name: 'Sideways', signal: 'neutral', probability: 45 });
  }

  return patterns.slice(0, 4);
}

// ── ELLIOTT WAVE ──────────────────────────────────────────────────────────────
function analyzeElliott(K) {
  if (!K || K.length < 20) return { wave: 'Data kurang', confidence: 15, description: 'Butuh minimal 20 candle', fibonacci: null };

  const swings = findSwings(K, 3);
  const { highs, lows } = swings;
  const price = K[K.length - 1].c;

  if (highs.length < 2 || lows.length < 2) {
    return { wave: 'Formasi menunggu', confidence: 20, description: 'Pivot belum terbentuk', fibonacci: null };
  }

  const rH = highs.slice(-4);
  const rL = lows.slice(-4);
  const swingHigh = Math.max(...rH.map(h => h.price));
  const swingLow = Math.min(...rL.map(l => l.price));
  const range = swingHigh - swingLow;

  const hhPat = rH.length >= 2 && rH[rH.length - 1].price > rH[rH.length - 2].price;
  const hlPat = rL.length >= 2 && rL[rL.length - 1].price > rL[rL.length - 2].price;
  const lhPat = rH.length >= 2 && rH[rH.length - 1].price < rH[rH.length - 2].price;
  const llPat = rL.length >= 2 && rL[rL.length - 1].price < rL[rL.length - 2].price;

  const positionPct = range > 0 ? ((price - swingLow) / range) * 100 : 50;

  // Fibonacci levels
  const fib = {
    swingHigh: parseFloat(swingHigh.toFixed(6)),
    swingLow: parseFloat(swingLow.toFixed(6)),
    fib236: parseFloat((swingHigh - range * 0.236).toFixed(6)),
    fib382: parseFloat((swingHigh - range * 0.382).toFixed(6)),
    fib500: parseFloat((swingHigh - range * 0.5).toFixed(6)),
    fib618: parseFloat((swingHigh - range * 0.618).toFixed(6)),
    fib786: parseFloat((swingHigh - range * 0.786).toFixed(6)),
    ext127: parseFloat((swingLow + range * 1.272).toFixed(6)),
    ext161: parseFloat((swingLow + range * 1.618).toFixed(6)),
    ext200: parseFloat((swingLow + range * 2.0).toFixed(6)),
    ext261: parseFloat((swingLow + range * 2.618).toFixed(6)),
    positionPct: parseFloat(positionPct.toFixed(1)),
  };

  let wave, confidence, description;

  if (hhPat && hlPat) {
    if (positionPct > 75) {
      wave = 'Wave 5 / Akhir Impulse';
      confidence = 70;
      description = `Mendekati puncak impulse (${positionPct.toFixed(0)}% dari range). Waspada reversal. Target: $${fib.ext127}`;
    } else if (positionPct > 40) {
      wave = 'Wave 3 (Terkuat)';
      confidence = 75;
      description = `Wave 3 aktif — HH+HL pattern. Target 161.8%: $${fib.ext161}. Momentum terkuat.`;
    } else {
      wave = 'Wave 1/3 Developing';
      confidence = 55;
      description = `Impulse awal terkonfirmasi. Konfirmasi wave 3 jika break $${rH[rH.length - 1].price.toFixed(4)}`;
    }
  } else if (lhPat && llPat) {
    if (positionPct < 25) {
      wave = 'Wave 5 Bearish / Bottom';
      confidence = 70;
      description = `Mendekati dasar bearish (${positionPct.toFixed(0)}%). Potensi reversal bullish.`;
    } else {
      wave = 'Wave 3 Bearish';
      confidence = 72;
      description = `Wave 3 bearish — LH+LL confirmed. Target: $${(swingHigh - range * 1.618).toFixed(4)}`;
    }
  } else if (hhPat && !hlPat) {
    wave = 'Wave A/4 (Koreksi)';
    confidence = 52;
    description = `Koreksi ABC. Support di Fib 61.8%: $${fib.fib618} dan 78.6%: $${fib.fib786}`;
  } else if (lhPat && !llPat) {
    wave = 'Wave B (Koreksi Bullish)';
    confidence = 48;
    description = 'Wave B — kemungkinan lanjut turun setelah koreksi selesai.';
  } else {
    wave = 'Wave 4/Konsolidasi';
    confidence = 40;
    description = `Konsolidasi. Breakout menentukan arah. Range: $${swingLow.toFixed(4)} - $${swingHigh.toFixed(4)}`;
  }

  return { wave, confidence, description, fibonacci: fib };
}

// ── SMC ANALYSIS ──────────────────────────────────────────────────────────────
function analyzeSMC(K) {
  if (!K || K.length < 15) return { signal: 'Neutral', summary: 'Data tidak cukup', orderBlock: null, fvg: null, liquidity: null };

  const price = K[K.length - 1].c;
  const atr = calcATR(K);
  const avgVol = K.slice(-20).reduce((s, k) => s + k.v, 0) / 20 || 1;
  const swings = findSwings(K, 3);

  // Order Blocks
  let nearestBullOB = null, nearestBearOB = null;
  for (let i = 2; i < K.length - 1; i++) {
    const c = K[i], n = K[i + 1];
    if (c.c < c.o && n.c > n.o && (n.c - n.o) > atr * 0.4) {
      const hi = Math.max(c.o, c.c), lo = Math.min(c.o, c.c);
      const dist = Math.abs(price - (hi + lo) / 2) / price * 100;
      if (dist < 15 && (!nearestBullOB || dist < nearestBullOB.dist)) {
        nearestBullOB = { hi: parseFloat(hi.toFixed(6)), lo: parseFloat(lo.toFixed(6)), mid: parseFloat(((hi + lo) / 2).toFixed(6)), dist: parseFloat(dist.toFixed(2)) };
      }
    }
    if (c.c > c.o && n.c < n.o && (n.o - n.c) > atr * 0.4) {
      const hi = Math.max(c.o, c.c), lo = Math.min(c.o, c.c);
      const dist = Math.abs(price - (hi + lo) / 2) / price * 100;
      if (dist < 15 && (!nearestBearOB || dist < nearestBearOB.dist)) {
        nearestBearOB = { hi: parseFloat(hi.toFixed(6)), lo: parseFloat(lo.toFixed(6)), mid: parseFloat(((hi + lo) / 2).toFixed(6)), dist: parseFloat(dist.toFixed(2)) };
      }
    }
  }

  // FVGs
  let bullFVG = null, bearFVG = null;
  for (let i = 1; i < K.length - 1; i++) {
    const p = K[i - 1], n = K[i + 1];
    if (n.l > p.h && !bullFVG) {
      const mid = (n.l + p.h) / 2;
      if (Math.abs(price - mid) / price * 100 < 10) {
        bullFVG = { hi: parseFloat(n.l.toFixed(6)), lo: parseFloat(p.h.toFixed(6)), mid: parseFloat(mid.toFixed(6)) };
      }
    }
    if (p.l > n.h && !bearFVG) {
      const mid = (p.l + n.h) / 2;
      if (Math.abs(price - mid) / price * 100 < 10) {
        bearFVG = { hi: parseFloat(p.l.toFixed(6)), lo: parseFloat(n.h.toFixed(6)), mid: parseFloat(mid.toFixed(6)) };
      }
    }
  }

  // Market Structure
  const rH = swings.highs.slice(-4), rL = swings.lows.slice(-4);
  let structure = 'RANGING', structureDetail = '';
  if (rH.length >= 2 && rL.length >= 2) {
    const hhPat = rH[rH.length - 1].price > rH[rH.length - 2].price;
    const hlPat = rL[rL.length - 1].price > rL[rL.length - 2].price;
    const lhPat = rH[rH.length - 1].price < rH[rH.length - 2].price;
    const llPat = rL[rL.length - 1].price < rL[rL.length - 2].price;
    if (hhPat && hlPat) { structure = 'BULLISH'; structureDetail = `HH $${rH[rH.length - 1].price.toFixed(4)} + HL $${rL[rL.length - 1].price.toFixed(4)}`; }
    else if (lhPat && llPat) { structure = 'BEARISH'; structureDetail = `LH $${rH[rH.length - 1].price.toFixed(4)} + LL $${rL[rL.length - 1].price.toFixed(4)}`; }
    else if (hhPat && !hlPat) { structure = 'CHoCH_BEAR'; structureDetail = 'HH tapi LL — potensi CHoCH bearish'; }
    else if (lhPat && !llPat) { structure = 'CHoCH_BULL'; structureDetail = 'LH tapi HL — potensi CHoCH bullish'; }
  }

  // Liquidity Sweep
  let liquiditySweep = null;
  if (K.length >= 20) {
    const range20H = Math.max(...K.slice(-20, -1).map(k => k.h));
    const range20L = Math.min(...K.slice(-20, -1).map(k => k.l));
    const last = K[K.length - 1];
    if (last.h > range20H && last.c < range20H) {
      liquiditySweep = { direction: 'Bearish', detail: `Sweep resistance $${range20H.toFixed(4)} — potential reversal down` };
    } else if (last.l < range20L && last.c > range20L) {
      liquiditySweep = { direction: 'Bullish', detail: `Sweep support $${range20L.toFixed(4)} — potential reversal up` };
    }
  }

  // Overall SMC signal
  let signal = 'Neutral';
  const summaryParts = [];

  if (structure === 'BULLISH') { signal = 'Bullish'; summaryParts.push(`BOS Bullish (${structureDetail})`); }
  else if (structure === 'BEARISH') { signal = 'Bearish'; summaryParts.push(`BOS Bearish (${structureDetail})`); }
  else if (structure.startsWith('CHoCH')) { signal = structure === 'CHoCH_BULL' ? 'Bullish' : 'Bearish'; summaryParts.push(structureDetail); }

  if (liquiditySweep) { signal = liquiditySweep.direction; summaryParts.push(liquiditySweep.detail); }
  if (nearestBullOB && nearestBullOB.dist < 3) summaryParts.push(`Bull OB $${nearestBullOB.lo}-$${nearestBullOB.hi} (${nearestBullOB.dist}% away)`);
  if (nearestBearOB && nearestBearOB.dist < 3) summaryParts.push(`Bear OB $${nearestBearOB.lo}-$${nearestBearOB.hi} (${nearestBearOB.dist}% away)`);
  if (bullFVG) summaryParts.push(`Bull FVG $${bullFVG.lo}-$${bullFVG.hi}`);
  if (bearFVG) summaryParts.push(`Bear FVG $${bearFVG.lo}-$${bearFVG.hi}`);

  return {
    signal,
    summary: summaryParts.join(' | ') || 'Tidak ada sinyal SMC kuat',
    structure,
    structureDetail,
    orderBlock: nearestBullOB ? { type: 'Demand Zone', ...nearestBullOB } : nearestBearOB ? { type: 'Supply Zone', ...nearestBearOB } : null,
    bullOB: nearestBullOB,
    bearOB: nearestBearOB,
    fvg: bullFVG || bearFVG,
    bullFVG,
    bearFVG,
    liquiditySweep,
  };
}

// ── ANALYZE TIMEFRAME ─────────────────────────────────────────────────────────
function analyzeTimeframe(K) {
  if (!K || K.length < 5) {
    return { rsi: 50, rsiLabel: 'N/A', patterns: [], elliottWave: { wave: 'Data tidak cukup', confidence: 10, description: '' }, smc: { signal: 'Neutral', summary: 'Data tidak cukup', orderBlock: null, fvg: null } };
  }
  const closes = K.map(k => k.c);
  const rsi = calcRSI(closes, 14);
  const rsiLabel = rsi < 25 ? 'Extreme Oversold' : rsi < 35 ? 'Oversold' : rsi > 75 ? 'Extreme Overbought' : rsi > 65 ? 'Overbought' : rsi > 50 ? 'Bullish Zone' : 'Bearish Zone';
  const patterns = detectPatterns(K);
  const elliottWave = analyzeElliott(K);
  const smc = analyzeSMC(K);
  const ema20 = calcEMA(closes, Math.min(20, closes.length));
  const ema50 = calcEMA(closes, Math.min(50, closes.length));
  const ema200 = calcEMA(closes, Math.min(200, closes.length));
  const price = closes[closes.length - 1];
  return { rsi, rsiLabel, patterns, elliottWave, smc, ema20, ema50, ema200, priceVsEMA: { above200: price > ema200, above50: price > ema50, above20: price > ema20 } };
}

// ── TRADE RECOMMENDATION ──────────────────────────────────────────────────────
function generateRecommendation(tf1h, tf4h, tf1d, price, change24h) {
  let score = 50;
  const reasons = [];

  for (const [label, tf, weight] of [['1H', tf1h, 0.2], ['4H', tf4h, 0.5], ['1D', tf1d, 0.3]]) {
    let tfScore = 0;

    // SMC
    if (tf.smc.signal === 'Bullish') { tfScore += 15; reasons.push(`✅ SMC ${label}: ${tf.smc.summary}`); }
    else if (tf.smc.signal === 'Bearish') { tfScore -= 15; reasons.push(`❌ SMC ${label}: ${tf.smc.summary}`); }

    // Patterns
    const bullP = tf.patterns.filter(p => p.signal === 'bullish').length;
    const bearP = tf.patterns.filter(p => p.signal === 'bearish').length;
    if (bullP > bearP) { tfScore += 8 * bullP; reasons.push(`📈 Pattern ${label}: ${tf.patterns.filter(p => p.signal === 'bullish').map(p => p.name).join(', ')}`); }
    else if (bearP > bullP) { tfScore -= 8 * bearP; reasons.push(`📉 Pattern ${label}: ${tf.patterns.filter(p => p.signal === 'bearish').map(p => p.name).join(', ')}`); }

    // Elliott Wave
    if (tf.elliottWave.wave.includes('Wave 3') && !tf.elliottWave.wave.includes('Bearish')) { tfScore += 12; reasons.push(`⚡ Elliott ${label}: ${tf.elliottWave.wave}`); }
    else if (tf.elliottWave.wave.includes('Wave 3 Bearish')) { tfScore -= 12; }
    else if (tf.elliottWave.wave.includes('Korektif') || tf.elliottWave.wave.includes('ABC')) { tfScore -= 8; }
    else if (tf.elliottWave.wave.includes('Wave 5')) { tfScore += 3; } // Caution near top

    // RSI
    const rsi = tf.rsi;
    if (rsi < 25) { tfScore += 14; reasons.push(`🟢 RSI ${label}: ${rsi} Extreme Oversold`); }
    else if (rsi < 35) { tfScore += 8; reasons.push(`🟢 RSI ${label}: ${rsi} Oversold`); }
    else if (rsi > 75) { tfScore -= 14; reasons.push(`🔴 RSI ${label}: ${rsi} Extreme Overbought`); }
    else if (rsi > 65) { tfScore -= 8; reasons.push(`🔴 RSI ${label}: ${rsi} Overbought`); }

    // EMA position
    if (tf.priceVsEMA?.above200) { tfScore += 5; }
    else { tfScore -= 5; }

    score += tfScore * weight * 0.8;
  }

  // 24h momentum
  if (change24h > 10) { score += 18; reasons.push(`🚀 24h: +${change24h.toFixed(1)}% momentum kuat`); }
  else if (change24h > 4) { score += 9; reasons.push(`📈 24h: +${change24h.toFixed(1)}%`); }
  else if (change24h < -10) { score -= 18; reasons.push(`💥 24h: ${change24h.toFixed(1)}% drop besar`); }
  else if (change24h < -4) { score -= 9; reasons.push(`📉 24h: ${change24h.toFixed(1)}%`); }

  score = Math.max(0, Math.min(100, score));

  let action, confidence, explanation;
  if (score >= 78) { action = '🟢 LONG (Beli Kuat)'; confidence = 'Sangat Tinggi'; explanation = 'Konfluensi bullish kuat: SMC + Elliott + RSI + Pola aligned.'; }
  else if (score >= 63) { action = '🟢 LONG (Beli)'; confidence = 'Tinggi'; explanation = 'Beberapa sinyal bullish terkonfirmasi.'; }
  else if (score >= 52) { action = '⚪ WATCH (Pantau)'; confidence = 'Sedang'; explanation = 'Setup forming, belum konfirm. Tunggu entry yang lebih baik.'; }
  else if (score >= 40) { action = '⚪ HOLD (Tahan)'; confidence = 'Rendah'; explanation = 'Sinyal campuran. Tidak ada arah jelas.'; }
  else if (score <= 22) { action = '🔴 SHORT (Jual Kuat)'; confidence = 'Sangat Tinggi'; explanation = 'Konfluensi bearish kuat di semua timeframe.'; }
  else if (score <= 37) { action = '🔴 SHORT (Jual)'; confidence = 'Tinggi'; explanation = 'Beberapa sinyal bearish terkonfirmasi.'; }
  else { action = '⚪ HOLD (Tahan)'; confidence = 'Netral'; explanation = 'Pasar sideways. Tunggu breakout.'; }

  return { action, confidence, score: Math.round(score), explanation, reasons: reasons.slice(0, 7), summary: `Skor ${Math.round(score)}/100 → ${action} (${confidence}). ${explanation}` };
}

// ── ASTROLOGY ─────────────────────────────────────────────────────────────────
function getAstrology() {
  const jdNow = (Date.now() / 86400000) + 2440587.5;
  const refNM = 2460320.5;
  const syn = 29.53058867;
  const age = ((jdNow - refNM) % syn + syn) % syn;
  const illum = Math.round(Math.sin((age / syn) * Math.PI * 2) * 50 + 50);

  let moonPhase, moonSignal, moonInterp;
  if (age < 1.5) { moonPhase = 'New Moon'; moonSignal = '🔄 Awal Siklus'; moonInterp = 'Tren baru, volatilitas tinggi'; }
  else if (age < 7.5) { moonPhase = 'Waxing Crescent'; moonSignal = '🌱 Kenaikan'; moonInterp = 'Momentum bullish mulai'; }
  else if (age < 9) { moonPhase = 'First Quarter'; moonSignal = '⚡ Tekanan'; moonInterp = 'Keputusan besar, volatilitas'; }
  else if (age < 14) { moonPhase = 'Waxing Gibbous'; moonSignal = '📈 Optimis'; moonInterp = 'Bullish dominan'; }
  else if (age < 16) { moonPhase = 'Full Moon'; moonSignal = '🌕 Puncak'; moonInterp = 'Potensi reversal, volatilitas ekstrem'; }
  else if (age < 22) { moonPhase = 'Waning Gibbous'; moonSignal = '📉 Koreksi'; moonInterp = 'Potensi distribusi'; }
  else if (age < 24) { moonPhase = 'Last Quarter'; moonSignal = '🔻 Pelepasan'; moonInterp = 'Distribusi, tekanan jual'; }
  else { moonPhase = 'Waning Crescent'; moonSignal = '💤 Akhir'; moonInterp = 'Konsolidasi, volume rendah'; }

  const halvingDate = new Date('2024-04-20');
  const daysSinceHalving = Math.floor((Date.now() - halvingDate.getTime()) / 86400000);
  const halvingPhase = daysSinceHalving < 365 ? 'Bull Cycle Early' : daysSinceHalving < 547 ? 'Bull Cycle Peak' : daysSinceHalving < 730 ? 'Distribution' : 'Bear Market';

  return { moonPhase, illumination: illum, signal: moonSignal, interpretation: moonInterp, halvingPhase, daysSinceHalving };
}

// ── FETCH KLINES (Binance first, CryptoCompare fallback) ─────────────────────
async function fetchKlines(symbol, interval, limit = 100) {
  // Try Binance Futures first
  try {
    const r = await fetchWithTimeout(`https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}USDT&interval=${interval}&limit=${limit}`);
    if (r) {
      const data = await r.json();
      if (Array.isArray(data) && data.length > 5) {
        return data.map(k => ({ t: +k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] }));
      }
    }
  } catch {}

  // Try Binance Spot
  try {
    const r = await fetchWithTimeout(`https://api.binance.com/api/v3/klines?symbol=${symbol}USDT&interval=${interval}&limit=${limit}`);
    if (r) {
      const data = await r.json();
      if (Array.isArray(data) && data.length > 5) {
        return data.map(k => ({ t: +k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] }));
      }
    }
  } catch {}

  // CryptoCompare fallback
  try {
    const ccInterval = interval === '1h' ? 'histohour' : interval === '4h' ? 'histohour' : 'histoday';
    const ccLimit = interval === '4h' ? limit * 4 : limit;
    const r = await fetchWithTimeout(`https://min-api.cryptocompare.com/data/v2/${ccInterval}?fsym=${symbol}&tsym=USDT&limit=${ccLimit}`);
    if (r) {
      const json = await r.json();
      if (json.Response === 'Success' && json.Data?.Data?.length > 5) {
        let data = json.Data.Data.map(d => ({ t: d.time * 1000, o: d.open, h: d.high, l: d.low, c: d.close, v: d.volumeto }));
        // Aggregate to 4H if needed
        if (interval === '4h') {
          const agg = [];
          for (let i = 0; i + 3 < data.length; i += 4) {
            const slice = data.slice(i, i + 4);
            agg.push({ t: slice[0].t, o: slice[0].o, h: Math.max(...slice.map(k => k.h)), l: Math.min(...slice.map(k => k.l)), c: slice[3].c, v: slice.reduce((s, k) => s + k.v, 0) });
          }
          return agg;
        }
        return data;
      }
    }
  } catch {}

  return [];
}

// ── MAIN HANDLER ──────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const inputSymbol = (req.query.symbol || '').toUpperCase().replace('USDT', '').trim();
  if (!inputSymbol) return res.status(400).json({ error: 'Parameter ?symbol= diperlukan.' });

  let currentPrice = 0, change24h = 0, coinName = inputSymbol;
  let marketCap = 0, totalVolume = 0, coinId = '';
  let found = false;

  try {
    // ── 1. GET PRICE ────────────────────────────────────────────
    // Try Binance Futures first (most reliable for trading coins)
    try {
      const r = await fetchWithTimeout(`https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${inputSymbol}USDT`);
      if (r) {
        const data = await r.json();
        if (data.lastPrice && parseFloat(data.lastPrice) > 0) {
          currentPrice = parseFloat(data.lastPrice);
          change24h = parseFloat(data.priceChangePercent || 0);
          totalVolume = parseFloat(data.quoteVolume || 0);
          found = true;
        }
      }
    } catch {}

    // Try Binance Spot
    if (!found) {
      try {
        const r = await fetchWithTimeout(`https://api.binance.com/api/v3/ticker/24hr?symbol=${inputSymbol}USDT`);
        if (r) {
          const data = await r.json();
          if (data.lastPrice && parseFloat(data.lastPrice) > 0) {
            currentPrice = parseFloat(data.lastPrice);
            change24h = parseFloat(data.priceChangePercent || 0);
            totalVolume = parseFloat(data.quoteVolume || 0);
            found = true;
          }
        }
      } catch {}
    }

    // Try CoinGecko as final fallback
    if (!found) {
      try {
        const searchR = await fetchWithTimeout(`https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(inputSymbol)}`);
        if (searchR) {
          const searchData = await searchR.json();
          const match = searchData.coins?.find(c => c.symbol.toUpperCase() === inputSymbol);
          if (match) {
            coinId = match.id;
            coinName = match.name || inputSymbol;
            const mktR = await fetchWithTimeout(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${coinId}&sparkline=false`);
            if (mktR) {
              const mktData = await mktR.json();
              if (mktData[0]?.current_price > 0) {
                currentPrice = mktData[0].current_price;
                change24h = mktData[0].price_change_percentage_24h || 0;
                marketCap = mktData[0].market_cap || 0;
                totalVolume = mktData[0].total_volume || 0;
                found = true;
              }
            }
          }
        }
      } catch {}
    }

    if (!found || currentPrice === 0) {
      return res.status(404).json({ error: `Koin "${inputSymbol}" tidak ditemukan. Coba BTC, ETH, SOL, AVAX, ARB, dll.` });
    }

    // ── 2. FETCH OHLCV ─────────────────────────────────────────
    const [K1h, K4h, K1d] = await Promise.all([
      fetchKlines(inputSymbol, '1h', 100),
      fetchKlines(inputSymbol, '4h', 100),
      fetchKlines(inputSymbol, '1d', 100),
    ]);

    // ── 3. ANALYZE ─────────────────────────────────────────────
    const tf1h = analyzeTimeframe(K1h);
    const tf4h = analyzeTimeframe(K4h);
    const tf1d = analyzeTimeframe(K1d);

    // ── 4. SUPPORT/RESISTANCE ──────────────────────────────────
    const allK = K1d.length >= 10 ? K1d : (K4h.length >= 10 ? K4h : K1h);
    let support = parseFloat((currentPrice * 0.95).toFixed(6));
    let resistance = parseFloat((currentPrice * 1.05).toFixed(6));
    if (allK.length >= 10) {
      const lows = allK.slice(-20).map(k => k.l).filter(v => v > 0);
      const highs = allK.slice(-20).map(k => k.h).filter(v => v > 0);
      if (lows.length) support = parseFloat(Math.min(...lows).toFixed(6));
      if (highs.length) resistance = parseFloat(Math.max(...highs).toFixed(6));
    }

    // ── 5. RECOMMENDATION ─────────────────────────────────────
    const recommendation = generateRecommendation(tf1h, tf4h, tf1d, currentPrice, change24h);

    // ── 6. ATR-BASED SL/TP ────────────────────────────────────
    const atr4h = K4h.length >= 15 ? calcATR(K4h) : currentPrice * 0.02;
    let tradeSetup = null;
    if (recommendation.score >= 63) {
      tradeSetup = {
        direction: 'LONG',
        entry: parseFloat(currentPrice.toFixed(6)),
        sl: parseFloat((currentPrice - atr4h * 1.5).toFixed(6)),
        tp1: parseFloat((currentPrice + atr4h * 2.0).toFixed(6)),
        tp2: parseFloat((currentPrice + atr4h * 3.5).toFixed(6)),
        tp3: parseFloat((currentPrice + atr4h * 5.5).toFixed(6)),
        rr: parseFloat(((atr4h * 2.0) / (atr4h * 1.5)).toFixed(2)),
        slPct: parseFloat((atr4h * 1.5 / currentPrice * 100).toFixed(2)),
        tp1Pct: parseFloat((atr4h * 2.0 / currentPrice * 100).toFixed(2)),
        note: 'SL di 1.5x ATR. TP bertahap: TP1 close 40%, TP2 close 40%, TP3 ride sisa.',
      };
    } else if (recommendation.score <= 37) {
      tradeSetup = {
        direction: 'SHORT',
        entry: parseFloat(currentPrice.toFixed(6)),
        sl: parseFloat((currentPrice + atr4h * 1.5).toFixed(6)),
        tp1: parseFloat((currentPrice - atr4h * 2.0).toFixed(6)),
        tp2: parseFloat((currentPrice - atr4h * 3.5).toFixed(6)),
        rr: parseFloat(((atr4h * 2.0) / (atr4h * 1.5)).toFixed(2)),
        slPct: parseFloat((atr4h * 1.5 / currentPrice * 100).toFixed(2)),
        tp1Pct: parseFloat((atr4h * 2.0 / currentPrice * 100).toFixed(2)),
        note: 'SL di 1.5x ATR atas entry.',
      };
    }

    // ── 7. ASTROLOGY ──────────────────────────────────────────
    const astrology = getAstrology();

    // ── RESPONSE ──────────────────────────────────────────────
    res.setHeader('Cache-Control', 's-maxage=60');
    return res.status(200).json({
      symbol: inputSymbol,
      name: coinName,
      price: currentPrice,
      change24h: parseFloat(change24h.toFixed(2)),
      marketCap,
      volume24h: totalVolume,
      support,
      resistance,

      timeframes: {
        '1H': {
          rsi: tf1h.rsi,
          rsiLabel: tf1h.rsiLabel,
          patterns: tf1h.patterns,
          elliottWave: tf1h.elliottWave,
          smc: tf1h.smc,
          ema: { ema20: parseFloat((tf1h.ema20 || 0).toFixed(6)), ema50: parseFloat((tf1h.ema50 || 0).toFixed(6)) },
        },
        '4H': {
          rsi: tf4h.rsi,
          rsiLabel: tf4h.rsiLabel,
          patterns: tf4h.patterns,
          elliottWave: tf4h.elliottWave,
          smc: tf4h.smc,
          ema: { ema20: parseFloat((tf4h.ema20 || 0).toFixed(6)), ema50: parseFloat((tf4h.ema50 || 0).toFixed(6)), ema200: parseFloat((tf4h.ema200 || 0).toFixed(6)) },
        },
        '1D': {
          rsi: tf1d.rsi,
          rsiLabel: tf1d.rsiLabel,
          patterns: tf1d.patterns,
          elliottWave: tf1d.elliottWave,
          smc: tf1d.smc,
          ema: { ema50: parseFloat((tf1d.ema50 || 0).toFixed(6)), ema200: parseFloat((tf1d.ema200 || 0).toFixed(6)) },
        },
      },

      recommendation,
      tradeSetup,
      astrology,
      atr4h: parseFloat((atr4h || 0).toFixed(6)),
      timestamp: new Date().toISOString(),
    });

  } catch (e) {
    return res.status(500).json({ error: 'Kesalahan internal: ' + e.message });
  }
}
