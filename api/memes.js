// api/memes.js — AC369 FUSION MEME INTELLIGENCE v2.0
// ══════════════════════════════════════════════════════════════════
// MEME COIN TECHNICAL + ANOMALY ENGINE
//
// Engines:
//   1. ANOMALY DETECTOR  — vol/mcap ratio, vol spike, coiling
//   2. ELLIOTT WAVE      — Wave 1/3/5/A/B/C from 4H klines
//   3. CHART PATTERNS    — Flag, Triangle, Cup, Double Bottom, Spring
//   4. CONFLUENCE SCORE  — 0-100 combined signal strength
//   5. SMART SETUP       — Entry/SL/TP1/TP2/TP3/TP4 with R:R
// ══════════════════════════════════════════════════════════════════

const MEME_SYMBOLS = [
  'DOGE','SHIB','PEPE','BONK','WIF','FLOKI','BRETT','MOG','NEIRO',
  'GOAT','PNUT','ACT','TURBO','PEOPLE','MOODENG','LUNC','BOME',
  'MEME','HOT','DOGS','HMSTR','CATI','NOT','BABYDOGE','ELON',
  'GIGA','CHEEMS','POPCAT','PONKE','SLERF','MYRO','AIDOGE',
];

const MEME_META = {
  DOGE:  { cat:'OG Meme',     chain:'Multi',    gen: 1 },
  SHIB:  { cat:'OG Meme',     chain:'ETH',      gen: 1 },
  LUNC:  { cat:'OG Meme',     chain:'Terra',    gen: 1 },
  PEPE:  { cat:'Frog Army',   chain:'ETH',      gen: 2 },
  BRETT: { cat:'Frog Army',   chain:'Base',     gen: 2 },
  MOG:   { cat:'Frog Army',   chain:'ETH',      gen: 2 },
  BONK:  { cat:'SOL Meme',    chain:'Solana',   gen: 2 },
  WIF:   { cat:'SOL Meme',    chain:'Solana',   gen: 2 },
  POPCAT:{ cat:'SOL Meme',    chain:'Solana',   gen: 2 },
  PONKE: { cat:'SOL Meme',    chain:'Solana',   gen: 2 },
  SLERF: { cat:'SOL Meme',    chain:'Solana',   gen: 2 },
  MYRO:  { cat:'SOL Meme',    chain:'Solana',   gen: 2 },
  FLOKI: { cat:'Dog Meme',    chain:'Multi',    gen: 2 },
  BABYDOGE:{ cat:'Dog Meme',  chain:'BSC',      gen: 2 },
  ELON:  { cat:'Dog Meme',    chain:'BSC',      gen: 2 },
  NEIRO: { cat:'Cat Meme',    chain:'ETH',      gen: 3 },
  MOODENG:{ cat:'Animal Meme',chain:'ETH',      gen: 3 },
  CATI:  { cat:'Cat Meme',    chain:'TON',      gen: 3 },
  GOAT:  { cat:'AI Meme',     chain:'Solana',   gen: 3 },
  ACT:   { cat:'AI Meme',     chain:'Solana',   gen: 3 },
  TURBO: { cat:'AI Meme',     chain:'ETH',      gen: 3 },
  PNUT:  { cat:'Political',   chain:'Solana',   gen: 3 },
  PEOPLE:{ cat:'Political',   chain:'ETH',      gen: 2 },
  BOME:  { cat:'Inscription', chain:'Solana',   gen: 3 },
  GIGA:  { cat:'Chad Meme',   chain:'Solana',   gen: 3 },
  CHEEMS:{ cat:'Chad Meme',   chain:'BSC',      gen: 2 },
  MEME:  { cat:'Meta Meme',   chain:'ETH',      gen: 2 },
  HOT:   { cat:'Utility Meme',chain:'NEAR',     gen: 1 },
  DOGS:  { cat:'TON Meme',    chain:'TON',      gen: 3 },
  HMSTR: { cat:'TON Meme',    chain:'TON',      gen: 3 },
  CATI:  { cat:'TON Meme',    chain:'TON',      gen: 3 },
  NOT:   { cat:'TON Meme',    chain:'TON',      gen: 3 },
  AIDOGE:{ cat:'AI Meme',     chain:'ARB',      gen: 3 },
};

// Memes with Binance Futures (can get funding rate)
const MEME_FUTURES = new Set([
  'DOGE','SHIB','PEPE','BONK','WIF','FLOKI','PEOPLE','LUNC','MEME',
  'TURBO','NOT','DOGS','HMSTR','NEIRO','ACT','GOAT',
]);

const STABLES = new Set(['USDT','USDC','BUSD','DAI','FDUSD','TUSD','USDP']);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 's-maxage=30');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const sf = async (url, ms = 7000) => {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), ms);
    try {
      const r = await fetch(url, {
        signal: c.signal,
        headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
      });
      clearTimeout(t);
      if (!r.ok) return null;
      return await r.json();
    } catch { clearTimeout(t); return null; }
  };

  // ════════════════════════════════════════════════════════════════
  // ENGINE 1: ANOMALY DETECTOR
  // Meme coins behave anomalously before big moves
  // ════════════════════════════════════════════════════════════════
  function detectAnomaly(price, high, low, open, ch24, vol, mcap, vt) {
    const anomalies = [];
    let anomalyScore = 0;

    const range = high > low ? (high - low) / low : 0;
    const volMcapRatio = mcap > 0 ? vol / mcap : 0;
    const body = Math.abs(price - open) / Math.max(high - low, price * 0.01);
    const lw   = (Math.min(price, open) - low) / Math.max(high - low, price * 0.01);

    // ANOMALY 1: Abnormal Volume vs Market Cap
    // Vol/MCap > 0.5 = trading more than half its market cap in 24h = extreme interest
    if (volMcapRatio > 2.0) {
      anomalies.push({ type: 'MEGA_VOL_ANOMALY', pts: 25, note: `Vol/MCap ${volMcapRatio.toFixed(1)}x — viral trading event` });
      anomalyScore += 25;
    } else if (volMcapRatio > 0.8) {
      anomalies.push({ type: 'HIGH_VOL_ANOMALY', pts: 18, note: `Vol/MCap ${volMcapRatio.toFixed(1)}x — unusual accumulation` });
      anomalyScore += 18;
    } else if (volMcapRatio > 0.3) {
      anomalies.push({ type: 'VOL_ANOMALY', pts: 10, note: `Vol/MCap ${volMcapRatio.toFixed(1)}x — elevated interest` });
      anomalyScore += 10;
    }

    // ANOMALY 2: Price Compression (coiling before explosion)
    // Tight range after a pump = energy building
    if (range < 0.025 && vt >= 2 && Math.abs(ch24) < 3) {
      anomalies.push({ type: 'COILING', pts: 20, note: `Range ${(range*100).toFixed(1)}% — compressed = explosive move imminent` });
      anomalyScore += 20;
    } else if (range < 0.05 && vt >= 1 && Math.abs(ch24) < 5) {
      anomalies.push({ type: 'COMPRESSION', pts: 12, note: `Range ${(range*100).toFixed(1)}% — tightening` });
      anomalyScore += 12;
    }

    // ANOMALY 3: Liquidity Sweep (stop hunt before reversal)
    if (lw > 0.45 && body < 0.30 && price > low * 1.003) {
      anomalies.push({ type: 'STOP_HUNT', pts: 18, note: `Wick ${(lw*100).toFixed(0)}% — SM cleared stops, reversal signal` });
      anomalyScore += 18;
    }

    // ANOMALY 4: Stealth Accumulation (flat price + rising volume)
    if (Math.abs(ch24) < 2 && vt >= 3 && volMcapRatio > 0.2) {
      anomalies.push({ type: 'STEALTH_ACCUM', pts: 15, note: `Flat price + $${(vol/1e6).toFixed(0)}M vol = SM accumulating quietly` });
      anomalyScore += 15;
    }

    // ANOMALY 5: Breakout Candle (strong body + volume)
    if (ch24 > 8 && body > 0.55 && vt >= 2) {
      anomalies.push({ type: 'BREAKOUT_CANDLE', pts: 15, note: `+${ch24.toFixed(1)}% strong body = institutional breakout` });
      anomalyScore += 15;
    }

    // ANOMALY 6: Dead Cat Bounce Risk
    if (ch24 > 15 && vt <= 1) {
      anomalies.push({ type: 'DCB_WARNING', pts: -10, note: `+${ch24.toFixed(1)}% on low volume = potential dead cat bounce` });
      anomalyScore -= 10;
    }

    return {
      anomalies,
      anomalyScore: Math.max(-15, Math.min(25, anomalyScore)),
      volMcapRatio: +volMcapRatio.toFixed(3),
      rangeCompression: +(range * 100).toFixed(2),
      isCoiling: range < 0.025 && vt >= 2,
      hasStopHunt: lw > 0.45 && body < 0.30,
      isStealthAccum: Math.abs(ch24) < 2 && vt >= 3,
      topAnomaly: anomalies.sort((a, b) => b.pts - a.pts)[0] || null,
    };
  }

  // ════════════════════════════════════════════════════════════════
  // ENGINE 2: ELLIOTT WAVE DETECTOR
  // Uses 4H klines to identify wave position
  // For memes: Wave 3 early = BEST entry, Wave 5 = exit
  // ════════════════════════════════════════════════════════════════
  function detectElliottWave(klines, currentPrice) {
    if (!klines || klines.length < 10) {
      // Fallback: estimate from price action if no klines
      return { wave: 'UNKNOWN', phase: 'UNKNOWN', ewScore: 0, confidence: 'LOW', note: 'Insufficient data' };
    }

    const closes  = klines.map(k => +k[4]);
    const highs   = klines.map(k => +k[2]);
    const lows    = klines.map(k => +k[3]);
    const volumes = klines.map(k => +k[5]);

    const n = closes.length;
    const last = closes[n - 1];

    // Find significant pivot points (simplified EW detection)
    // Look at last 20 candles
    const recent = closes.slice(-20);
    const recentH = highs.slice(-20);
    const recentL = lows.slice(-20);
    const recentV = volumes.slice(-20);

    const localMax = Math.max(...recent);
    const localMin = Math.min(...recent);
    const localMaxIdx = recent.indexOf(localMax);
    const localMinIdx = recent.indexOf(localMin);

    const range = localMax - localMin;
    const posInRange = range > 0 ? (last - localMin) / range : 0.5;

    // Volume trend (is volume increasing with price = impulse?)
    const avgVolRecent = recentV.slice(-5).reduce((a, b) => a + b, 0) / 5;
    const avgVolEarly  = recentV.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
    const volTrend = avgVolEarly > 0 ? avgVolRecent / avgVolEarly : 1;

    // Price momentum (smoothed)
    const ma5  = recent.slice(-5).reduce((a, b) => a + b, 0) / 5;
    const ma10 = recent.slice(-10).reduce((a, b) => a + b, 0) / 10;
    const ma20 = recent.reduce((a, b) => a + b, 0) / 20;
    const momentum = (ma5 / ma20 - 1) * 100;

    // Rate of change
    const roc5  = recent.length >= 5  ? (last - recent[recent.length - 5])  / recent[recent.length - 5]  * 100 : 0;
    const roc10 = recent.length >= 10 ? (last - recent[recent.length - 10]) / recent[recent.length - 10] * 100 : 0;
    const roc20 = recent.length >= 20 ? (last - recent[0]) / recent[0] * 100 : 0;

    // Determine wave phase using EW principles
    let wave = '', phase = '', ewScore = 0, note = '', confidence = 'MEDIUM';
    let target1 = 0, target2 = 0, target3 = 0;
    let ewSL = 0;

    // === MEME ELLIOTT WAVE HEURISTICS ===
    // Wave 1 Early: Price just started moving from base, small initial pump
    // Wave 1 Late: First impulse mostly done
    // Wave 2: Correction after Wave 1 (ideal buy zone)
    // Wave 3 Early: ★ BEST ENTRY — Strongest wave just starting
    // Wave 3 Mid: Momentum continuing
    // Wave 5: Final push, caution
    // Wave A-C: Correction

    if (roc20 < -30 && posInRange < 0.20 && momentum < -2) {
      // Deep correction - possible Wave C ending / Wave 2 bottom
      wave = 'Wave 2/C';
      phase = 'REVERSAL SETUP';
      ewScore = 22;
      note = `${roc20.toFixed(0)}% correction → reversal zone. Wave 2/C bottom forming`;
      confidence = 'HIGH';
      target1 = +(last * 1.618).toFixed(8);
      target2 = +(last * 2.618).toFixed(8);
      target3 = +(last * 4.236).toFixed(8);
      ewSL = +(localMin * 0.95).toFixed(8);

    } else if (roc20 > 5 && roc10 > roc20 * 0.3 && posInRange < 0.45 && momentum > 0 && volTrend > 1.2) {
      // Price starting to accelerate from bottom — Wave 3 beginning
      wave = 'Wave 3 Early ⭐';
      phase = 'IMPULSE START';
      ewScore = 25; // MAX — best meme entry
      note = `+${roc20.toFixed(0)}% base + vol ${volTrend.toFixed(1)}x → Wave 3 ignition. BEST ENTRY`;
      confidence = 'HIGH';
      target1 = +(last * 1.618).toFixed(8);
      target2 = +(last * 2.618).toFixed(8);
      target3 = +(last * 4.236).toFixed(8);
      ewSL = +(localMin * 0.92).toFixed(8);

    } else if (roc20 > 20 && posInRange > 0.45 && posInRange < 0.75 && volTrend >= 1.0) {
      // Strong ongoing move — Wave 3 middle
      wave = 'Wave 3 Mid';
      phase = 'STRONG IMPULSE';
      ewScore = 18;
      note = `+${roc20.toFixed(0)}% Wave 3 extending. Ride or wait pullback`;
      confidence = 'MEDIUM';
      target1 = +(last * 1.382).toFixed(8);
      target2 = +(last * 2.0).toFixed(8);
      target3 = +(last * 3.0).toFixed(8);
      ewSL = +(localMin * 0.90).toFixed(8);

    } else if (roc10 < -10 && roc20 > 15 && posInRange > 0.35 && posInRange < 0.65) {
      // Pulled back from high, still above midpoint — Wave 4 / ideal entry
      wave = 'Wave 4';
      phase = 'PULLBACK ENTRY';
      ewScore = 20;
      note = `Wave 4 pullback after pump. Entry for Wave 5 continuation`;
      confidence = 'MEDIUM';
      target1 = +(localMax * 1.05).toFixed(8);
      target2 = +(localMax * 1.236).toFixed(8);
      target3 = +(localMax * 1.618).toFixed(8);
      ewSL = +(last * 0.88).toFixed(8);

    } else if (posInRange > 0.75 && roc5 > 5 && roc20 > 40) {
      // High in range, late pump — Wave 5 / caution zone
      wave = 'Wave 5';
      phase = 'LATE STAGE ⚠️';
      ewScore = 8;
      note = `Wave 5 — final push. Reduce position size, tight SL`;
      confidence = 'MEDIUM';
      target1 = +(last * 1.1).toFixed(8);
      target2 = +(last * 1.2).toFixed(8);
      target3 = +(last * 1.382).toFixed(8);
      ewSL = +(last * 0.92).toFixed(8);

    } else if (posInRange > 0.80 && roc5 < -5) {
      // Already at top and declining — Wave A distribution
      wave = 'Wave A';
      phase = 'DISTRIBUTION ❌';
      ewScore = 2;
      note = `Wave A starting. Avoid new longs, consider exit`;
      confidence = 'MEDIUM';
      target1 = 0; target2 = 0; target3 = 0;
      ewSL = 0;

    } else if (roc10 < -15 && roc5 > 2 && posInRange > 0.30 && posInRange < 0.60) {
      // Bouncing after first drop — Wave B (trap)
      wave = 'Wave B';
      phase = 'DEAD CAT BOUNCE';
      ewScore = 5;
      note = `Wave B bounce — likely trap. Wait for Wave C completion`;
      confidence = 'MEDIUM';
      target1 = 0; target2 = 0; target3 = 0;
      ewSL = 0;

    } else if (roc20 > 0 && posInRange >= 0.35 && posInRange < 0.60 && momentum > -1) {
      // Moderate uptrend, mid-range — Wave 1 or Wave 3 early
      wave = 'Wave 1';
      phase = 'EARLY IMPULSE';
      ewScore = 15;
      note = `Wave 1 building. Watch for Wave 2 pullback to enter`;
      confidence = 'MEDIUM';
      target1 = +(last * 1.5).toFixed(8);
      target2 = +(last * 2.5).toFixed(8);
      target3 = +(last * 4.0).toFixed(8);
      ewSL = +(localMin * 0.94).toFixed(8);

    } else {
      wave = 'CONSOLIDATION';
      phase = 'RANGE / WAIT';
      ewScore = 8;
      note = `No clear wave. Vol=${volTrend.toFixed(1)}x, pos=${(posInRange*100).toFixed(0)}% of range`;
      confidence = 'LOW';
      target1 = +(last * 1.5).toFixed(8);
      target2 = +(last * 2.0).toFixed(8);
      target3 = +(last * 3.0).toFixed(8);
      ewSL = +(localMin * 0.92).toFixed(8);
    }

    return {
      wave, phase, ewScore, note, confidence,
      targets: { t1: target1, t2: target2, t3: target3 },
      ewSL,
      momentum: +momentum.toFixed(2),
      roc5: +roc5.toFixed(2), roc10: +roc10.toFixed(2), roc20: +roc20.toFixed(2),
      posInRange: +posInRange.toFixed(3),
      volTrend: +volTrend.toFixed(2),
      localMin: +localMin.toFixed(8), localMax: +localMax.toFixed(8),
    };
  }

  // ════════════════════════════════════════════════════════════════
  // ENGINE 3: CHART PATTERN DETECTOR
  // ════════════════════════════════════════════════════════════════
  function detectChartPattern(price, high, low, open, ch24, ch7, ch30, lw, body, rp, vt) {
    const patterns = [];
    let patternScore = 0;

    const range = (high - low) / price;

    // 1. BULL FLAG — Impulse + tight consolidation → continuation
    if ((ch7 || 0) > 10 && range < 0.04 && Math.abs(ch24) < 4 && vt >= 2) {
      patterns.push({ name: 'Bull Flag 🚩', type: 'CONTINUATION', pts: 20, note: 'Tight consolidation after impulse. Breakout imminent' });
      patternScore += 20;
    }

    // 2. FALLING WEDGE — Bearish then bullish breakout
    if ((ch7 || 0) < -5 && Math.abs(ch24) < 6 && lw > 0.15 && rp < 0.60 && vt >= 1) {
      patterns.push({ name: 'Falling Wedge 📐', type: 'REVERSAL', pts: 18, note: 'Bearish compression → expect upside breakout' });
      patternScore += 18;
    }

    // 3. DOUBLE BOTTOM — W pattern recovery
    if ((ch7 || 0) < -8 && ch24 > 3 && lw > 0.25 && rp > 0.35 && vt >= 1) {
      patterns.push({ name: 'Double Bottom W 📊', type: 'REVERSAL', pts: 22, note: 'W-pattern support test complete. High prob reversal' });
      patternScore += 22;
    }

    // 4. WYCKOFF SPRING — Wick below support + recovery
    if (lw > 0.45 && rp < 0.40 && price > low * 1.002 && vt >= 1) {
      patterns.push({ name: 'Wyckoff Spring 🌊', type: 'REVERSAL', pts: 22, note: 'Spring: wick below support = SM engineering reversal' });
      patternScore += 22;
    }

    // 5. ASCENDING TRIANGLE — Higher lows + flat resistance
    if (ch24 > 0 && ch24 < 6 && (ch7 || 0) > 3 && rp > 0.65 && vt >= 1) {
      patterns.push({ name: 'Ascending Triangle △', type: 'CONTINUATION', pts: 16, note: 'Higher lows building. Breakout above resistance target' });
      patternScore += 16;
    }

    // 6. CUP & HANDLE — Rounded base + handle dip
    if ((ch7 || 0) > 5 && ch24 < 0 && ch24 > -8 && rp < 0.50 && vt >= 1) {
      patterns.push({ name: 'Cup & Handle ☕', type: 'CONTINUATION', pts: 18, note: 'Handle dip after cup formation. Breakout above rim' });
      patternScore += 18;
    }

    // 7. HAMMER / BULLISH REVERSAL CANDLE
    if (lw > 0.35 && body < 0.25 && rp > 0.60) {
      patterns.push({ name: 'Hammer Candle 🔨', type: 'REVERSAL', pts: 12, note: 'Long lower wick + close near high = buyers won the battle' });
      patternScore += 12;
    }

    // 8. COMPRESSION BASE (before explosive move)
    if (range < 0.03 && vt >= 2 && Math.abs(ch24) < 3) {
      patterns.push({ name: 'Compression Base 💥', type: 'ACCUMULATION', pts: 15, note: `${(range*100).toFixed(1)}% range = extreme compression. Explosive move loading` });
      patternScore += 15;
    }

    // 9. BREAKOUT WITH VOLUME
    if (ch24 > 10 && body > 0.55 && vt >= 3 && rp > 0.60) {
      patterns.push({ name: 'Vol Breakout ⚡', type: 'BREAKOUT', pts: 18, note: `+${ch24.toFixed(1)}% with ${vt >= 4 ? 'extreme' : 'strong'} volume = institutional breakout` });
      patternScore += 18;
    }

    // 10. BEAR FLAG (warning)
    if (ch24 < -3 && ch24 > -12 && body > 0.40 && rp > 0.50 && (ch7 || 0) < -10) {
      patterns.push({ name: 'Bear Flag ⛳', type: 'WARNING', pts: -10, note: 'Possible bear flag — wait for confirmation before entry' });
      patternScore -= 10;
    }

    const sorted  = [...patterns].sort((a, b) => b.pts - a.pts);
    const bullish = sorted.filter(p => p.type !== 'WARNING');
    const top     = bullish[0] || sorted[0] || null;

    return {
      patterns: sorted,
      topPattern: top,
      patternScore: Math.max(-15, Math.min(25, patternScore)),
      hasReversal: sorted.some(p => p.type === 'REVERSAL'),
      hasContinuation: sorted.some(p => p.type === 'CONTINUATION'),
      hasBreakout: sorted.some(p => p.type === 'BREAKOUT'),
      patternCount: bullish.length,
    };
  }

  // ════════════════════════════════════════════════════════════════
  // MASTER SCORE + SETUP BUILDER
  // ════════════════════════════════════════════════════════════════
  function buildSetup(coin, ew, pat, anom, fundingRate, fg) {
    const { price, high, low, open, ch24, ch7, vol, mcap, vt } = coin;
    const range = Math.max(high - low, price * 0.01);
    const rp    = (price - low) / range;
    const lw    = (Math.min(price, open) - low) / range;

    let score = 0;
    const reasons = [];

    // 1. MOMENTUM (0-20)
    let mom = 0;
    if (ch24 > 20)        { mom = 20; reasons.push(`🔥 +${ch24.toFixed(1)}% pumping`); }
    else if (ch24 > 10)   { mom = 16; reasons.push(`📈 +${ch24.toFixed(1)}% strong move`); }
    else if (ch24 > 5)    { mom = 13; reasons.push(`✅ +${ch24.toFixed(1)}% bullish`); }
    else if (ch24 > 0)    { mom = 9;  }
    else if (ch24 > -5)   { mom = 6;  }
    else if (ch24 > -15)  { mom = 4;  }
    else                  { mom = 2;  }
    if ((ch7 || 0) > 15 && ch24 > 0) { mom = Math.min(20, mom + 4); reasons.push(`📈 7D +${(ch7||0).toFixed(0)}%`); }
    if (fg <= 20) mom = Math.min(20, mom + 4);
    score += mom;

    // 2. VOLUME QUALITY (0-20)
    const volM = vol / 1e6;
    let vol_s = volM >= 500 ? 20 : volM >= 100 ? 17 : volM >= 30 ? 13 : volM >= 10 ? 9 : volM >= 2 ? 5 : 2;
    if (volM >= 30 && Math.abs(ch24) <= 6) { vol_s = Math.min(20, vol_s + 4); reasons.push(`🐳 $${volM.toFixed(0)}M vol + flat = SM accum`); }
    score += vol_s;

    // 3. ANOMALY (0-25)
    score += Math.max(0, anom.anomalyScore);
    if (anom.isCoiling)       reasons.push(`💥 COILING — explosive move imminent`);
    if (anom.hasStopHunt)     reasons.push(`🎯 Stop hunt complete — reversal signal`);
    if (anom.isStealthAccum)  reasons.push(`🕵️ Stealth accumulation detected`);
    if (anom.volMcapRatio > 0.5) reasons.push(`📊 Vol/MCap ${anom.volMcapRatio.toFixed(1)}x anomaly`);

    // 4. ELLIOTT WAVE (0-25)
    score += Math.max(0, ew.ewScore);
    if (ew.ewScore > 15) reasons.push(`🌊 ${ew.wave} — ${ew.note}`);

    // 5. CHART PATTERN (0-25)
    score += Math.max(0, pat.patternScore);
    if (pat.topPattern) reasons.push(`📐 ${pat.topPattern.name} — ${pat.topPattern.note}`);

    // 6. DERIVATIVES (0-10)
    let deriv_s = 0;
    if (fundingRate !== null) {
      const fr = fundingRate * 100;
      if (fr < -0.01)      { deriv_s = 10; reasons.push(`💥 Funding ${fr.toFixed(4)}% — short squeeze setup`); }
      else if (fr < 0)     { deriv_s = 7;  }
      else if (fr > 0.05)  { deriv_s = -5; reasons.push(`⚠️ Funding ${fr.toFixed(4)}% — overleveraged longs`); }
      else                 { deriv_s = 3;  }
    }
    score += deriv_s;

    // 7. MARKET CONTEXT (0-10)
    let mkt_s = fg <= 20 ? 10 : fg <= 35 ? 7 : fg >= 75 ? 2 : 5;
    if (rp < 0.35) { mkt_s = Math.min(10, mkt_s + 3); reasons.push(`📉 At lows — discount entry`); }
    score += mkt_s;

    // PENALTY: Late stage / warnings
    if (ew.phase.includes('DISTRIBUTION')) score -= 15;
    if (ew.phase.includes('DEAD CAT'))     score -= 10;
    if (pat.patterns.some(p => p.type === 'WARNING')) score -= 5;

    const finalScore = Math.max(0, Math.min(100, Math.round(score)));

    // ── TIER ──────────────────────────────────────────────────────
    const tier = finalScore >= 80 ? 'S★' : finalScore >= 65 ? 'S' : finalScore >= 50 ? 'A' : finalScore >= 35 ? 'B' : 'C';

    // ── TRADE SETUP ───────────────────────────────────────────────
    // SL: below pattern invalidation OR local minimum
    const slBase = ew.ewSL > 0 && ew.ewSL < price ? ew.ewSL : price * (1 - Math.max(0.08, Math.min(0.25, (high - low) / price * 1.8)));
    const sl     = +Math.min(slBase, price * 0.80).toFixed(8);
    const slDist = price - sl;
    const slPct  = +((slDist / price) * 100).toFixed(1);

    // Entry zone (current or slight pullback)
    const entryLo = +Math.max(price * 0.97, sl * 1.01).toFixed(8);
    const entryHi = +(price * 1.01).toFixed(8);

    // TPs: use EW targets if available, else multipliers
    const ewT1 = ew.targets?.t1 > price ? ew.targets.t1 : 0;
    const ewT2 = ew.targets?.t2 > price ? ew.targets.t2 : 0;
    const ewT3 = ew.targets?.t3 > price ? ew.targets.t3 : 0;

    const tp1 = +(ewT1 || price + slDist * 1.5).toFixed(8);
    const tp2 = +(ewT2 || price + slDist * 3.0).toFixed(8);
    const tp3 = +(ewT3 || price + slDist * 6.0).toFixed(8);
    const tp4 = +(price + slDist * 10.0).toFixed(8); // moon shot

    const tp1Pct = +((tp1 - price) / price * 100).toFixed(1);
    const tp2Pct = +((tp2 - price) / price * 100).toFixed(1);
    const tp3Pct = +((tp3 - price) / price * 100).toFixed(1);
    const tp4Pct = +((tp4 - price) / price * 100).toFixed(1);

    // RR
    const rr1 = slDist > 0 ? +((tp1 - price) / slDist).toFixed(1) : 1.5;
    const rr2 = slDist > 0 ? +((tp2 - price) / slDist).toFixed(1) : 3.0;

    // Risk rating
    const riskScore = vt <= 1 ? 5 : finalScore < 40 ? 5 : finalScore < 60 ? 4 : volM < 10 ? 4 : 3;
    const riskLabel = riskScore >= 5 ? '🔴 VERY HIGH' : riskScore >= 4 ? '🟠 HIGH' : '🟡 MEDIUM';

    // Trade style recommendation
    let tradeStyle = 'SCALP';
    if (ew.phase === 'REVERSAL SETUP' || ew.phase === 'IMPULSE START') tradeStyle = 'SWING';
    else if (ew.phase === 'PULLBACK ENTRY') tradeStyle = 'DAY TRADE';
    else if (anom.isCoiling) tradeStyle = 'BREAKOUT PLAY';
    else if (ch24 > 15) tradeStyle = 'MOMENTUM';

    // Position size recommendation (based on risk + tier)
    const posSize = tier === 'S★' || tier === 'S' ? '1-2%' : tier === 'A' ? '0.5-1%' : '0.25-0.5%';

    return {
      score: finalScore, tier, reasons: reasons.slice(0, 6),
      riskLabel, riskScore, tradeStyle, posSize,
      trade: {
        entry: price, entryLo, entryHi,
        sl: +sl.toFixed(8), slPct,
        tp1, tp1Pct, rr1: rr1.toString(),
        tp2, tp2Pct, rr2: rr2.toString(),
        tp3, tp3Pct,
        tp4, tp4Pct,
        tp1Tag: 'Quick Flip (1:' + rr1 + ')',
        tp2Tag: 'Main Target (1:' + rr2 + ')',
        tp3Tag: 'Meme Pump Target',
        tp4Tag: '🌙 Moon Shot',
      },
    };
  }

  // ════════════════════════════════════════════════════════════════
  // MAIN HANDLER
  // ════════════════════════════════════════════════════════════════
  try {
    const t0 = Date.now();

    // Fetch all base data in parallel
    const [binR, fngR, cgR] = await Promise.allSettled([
      sf('https://api.binance.com/api/v3/ticker/24hr', 8000)
        .then(d => Array.isArray(d) && d.length > 100 ? d :
          sf('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&category=meme-token&order=volume_desc&per_page=50&page=1&sparkline=false&price_change_percentage=24h,7d', 8000)
            .then(cg => Array.isArray(cg) ? cg.map(c => ({
              symbol: c.symbol.toUpperCase() + 'USDT',
              lastPrice: String(c.current_price || 0),
              priceChangePercent: String(c.price_change_percentage_24h || 0),
              quoteVolume: String(c.total_volume || 0),
              highPrice: String((c.current_price || 0) * 1.04),
              lowPrice:  String((c.current_price || 0) * 0.96),
              openPrice: String((c.current_price || 0) / (1 + (c.price_change_percentage_24h || 0) / 100)),
              _mcap: c.market_cap || 0,
              _7d: c.price_change_percentage_7d_in_currency || 0,
            })) : null)
        ),
      sf('https://api.alternative.me/fng/?limit=1&format=json', 5000),
      sf('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=dogecoin,shiba-inu,pepe,bonk,dogwifcoin,floki,brett,mog-coin,neiro,goatseus-maximus,peanut-the-squirrel,act-i-the-ai-prophecy,turbo,meme,popcat,not-coin&order=volume_desc&sparkline=false&price_change_percentage=7d', 6000),
    ]);

    const allTickers = binR.status === 'fulfilled' && Array.isArray(binR.value) ? binR.value : [];
    const fg = fngR.status === 'fulfilled' ? parseInt(fngR.value?.data?.[0]?.value || 50) : 50;
    const cgCoins = cgR.status === 'fulfilled' && Array.isArray(cgR.value) ? cgR.value : [];

    if (!allTickers.length) {
      return res.status(200).json({ error: null, version: 'v2.0', memes: [], all: [], totalScanned: 0, fg, timestamp: Date.now() });
    }

    // Build lookups
    const tickerMap = {};
    allTickers.forEach(t => { if (t?.symbol) tickerMap[t.symbol] = t; });

    const cgLookup = {};
    cgCoins.forEach(c => {
      const sym = (c.symbol || '').toUpperCase();
      cgLookup[sym] = {
        ch7: c.price_change_percentage_7d_in_currency || 0,
        mcap: c.market_cap || 0,
        ath: c.ath || 0,
        athPct: c.ath_change_percentage || -50,
      };
    });

    // Fetch klines + funding for top memes in parallel (max 10 to stay fast)
    const TOP_KLINES = ['DOGE','SHIB','PEPE','BONK','WIF','FLOKI','BRETT','NEIRO','GOAT','PNUT'];
    const TOP_FUTURES = [...MEME_FUTURES].slice(0, 8);

    const [klinesResults, fundingResult] = await Promise.allSettled([
      Promise.allSettled(
        TOP_KLINES.map(sym =>
          sf(`https://api.binance.com/api/v3/klines?symbol=${sym}USDT&interval=4h&limit=24`, 4000)
        )
      ),
      sf('https://fapi.binance.com/fapi/v1/premiumIndex', 4000),
    ]);

    // Build klines map
    const klinesMap = {};
    if (klinesResults.status === 'fulfilled') {
      TOP_KLINES.forEach((sym, i) => {
        const r = klinesResults.value[i];
        if (r.status === 'fulfilled' && Array.isArray(r.value) && r.value.length >= 10) {
          klinesMap[sym] = r.value;
        }
      });
    }

    // Build funding map
    const fundingMap = {};
    if (fundingResult.status === 'fulfilled' && Array.isArray(fundingResult.value)) {
      fundingResult.value.forEach(f => {
        const sym = (f.symbol || '').replace('USDT', '');
        if (sym) fundingMap[sym] = parseFloat(f.lastFundingRate || 0);
      });
    }

    // Also scan all tickers for unknown meme anomalies
    const autoDiscovered = [];
    if (Array.isArray(allTickers)) {
      allTickers.forEach(t => {
        if (!t?.symbol?.endsWith('USDT')) return;
        const b = t.symbol.replace('USDT', '');
        if (STABLES.has(b) || MEME_SYMBOLS.includes(b) || b.length > 10) return;
        const v = +(t.quoteVolume || 0);
        const ch = +(t.priceChangePercent || 0);
        const p = +(t.lastPrice || 0);
        if (p <= 0 || v < 10e6) return;
        // Auto-detect: extreme vol + extreme move = likely new meme
        if (Math.abs(ch) > 25 && v > 30e6) autoDiscovered.push(b);
        else if (v > 100e6 && Math.abs(ch) > 15) autoDiscovered.push(b);
      });
    }

    // Process all symbols
    const allSymbols = [...MEME_SYMBOLS, ...autoDiscovered.slice(0, 8)];
    const results = [];

    for (const sym of allSymbols) {
      const t = tickerMap[sym + 'USDT'];
      if (!t) continue;

      const price = +(t.lastPrice || 0);
      const ch24  = +(t.priceChangePercent || 0);
      const vol   = +(t.quoteVolume || 0);
      const high  = +(t.highPrice || price * 1.04);
      const low   = +(t.lowPrice  || price * 0.96);
      const open  = +(t.openPrice || price);

      if (price <= 0 || vol < 500000) continue;

      const cgInfo = cgLookup[sym] || {};
      const ch7    = cgInfo.ch7 || t._7d || 0;
      const mcap   = cgInfo.mcap || t._mcap || 0;
      const athPct = cgInfo.athPct || -60;

      const range  = Math.max(high - low, price * 0.005);
      const rp     = (price - low) / range;
      const lw     = (Math.min(price, open) - low) / range;
      const body   = Math.abs(price - open) / range;
      const vt     = vol >= 500e6 ? 5 : vol >= 100e6 ? 4 : vol >= 30e6 ? 3 : vol >= 10e6 ? 2 : vol >= 2e6 ? 1 : 0;

      const klines      = klinesMap[sym] || null;
      const fundingRate = fundingMap[sym] !== undefined ? fundingMap[sym] : null;

      // Run all 3 engines
      const anom = detectAnomaly(price, high, low, open, ch24, vol, mcap, vt);
      const ew   = detectElliottWave(klines, price);
      const pat  = detectChartPattern(price, high, low, open, ch24, ch7, null, lw, body, rp, vt);

      // Build master score + setup
      const coin = { price, high, low, open, ch24, ch7, vol, mcap, vt };
      const setup = buildSetup(coin, ew, pat, anom, fundingRate, fg);

      const meta = MEME_META[sym] || { cat: autoDiscovered.includes(sym) ? '🆕 New Discovery' : 'Meme', chain: '?', gen: 3 };

      results.push({
        symbol: sym,
        category: meta.cat,
        chain: meta.chain,
        gen: meta.gen,
        isNew: autoDiscovered.includes(sym),
        price, ch24: +ch24.toFixed(2), ch7: +ch7.toFixed(2),
        vol, volM: +(vol / 1e6).toFixed(1), mcap,
        high, low, open, rp: +rp.toFixed(2), lw: +lw.toFixed(2),
        athPct: +athPct.toFixed(1), vt,
        fundingRate: fundingRate !== null ? +(fundingRate * 100).toFixed(4) : null,
        hasKlines: !!klines,
        // Engine results
        anomaly: {
          score: anom.anomalyScore,
          topAnomaly: anom.topAnomaly,
          isCoiling: anom.isCoiling,
          hasStopHunt: anom.hasStopHunt,
          isStealthAccum: anom.isStealthAccum,
          volMcapRatio: anom.volMcapRatio,
          rangeCompression: anom.rangeCompression,
          list: anom.anomalies.slice(0, 3),
        },
        elliottWave: {
          wave: ew.wave,
          phase: ew.phase,
          score: ew.ewScore,
          note: ew.note,
          confidence: ew.confidence,
          targets: ew.targets,
          roc20: ew.roc20,
          posInRange: ew.posInRange,
          momentum: ew.momentum,
        },
        patterns: {
          topPattern: pat.topPattern,
          list: pat.patterns.slice(0, 3),
          score: pat.patternScore,
          hasReversal: pat.hasReversal,
          hasContinuation: pat.hasContinuation,
          count: pat.patternCount,
        },
        // Master
        score: setup.score,
        tier: setup.tier,
        reasons: setup.reasons,
        riskLabel: setup.riskLabel,
        riskScore: setup.riskScore,
        tradeStyle: setup.tradeStyle,
        posSize: setup.posSize,
        trade: setup.trade,
      });
    }

    // Sort by score
    results.sort((a, b) => b.score - a.score || b.vol - a.vol);

    // Build tabs
    const elite     = results.filter(r => r.tier === 'S★' || r.tier === 'S').slice(0, 6);
    const trending  = results.filter(r => r.ch24 > 5).sort((a, b) => b.ch24 - a.ch24).slice(0, 8);
    const anomalies = results.filter(r => r.anomaly.score >= 12 || r.anomaly.isCoiling || r.anomaly.hasStopHunt).sort((a, b) => b.anomaly.score - a.anomaly.score).slice(0, 8);
    const wave3     = results.filter(r => r.elliottWave.wave.includes('Wave 3') || r.elliottWave.wave.includes('Wave 2')).sort((a, b) => b.elliottWave.score - a.elliottWave.score).slice(0, 6);
    const patterns  = results.filter(r => r.patterns.count >= 1).sort((a, b) => b.patterns.score - a.patterns.score).slice(0, 8);
    const dips      = results.filter(r => r.ch24 < -5 && r.score >= 35).sort((a, b) => b.score - a.score).slice(0, 6);
    const newCoins  = results.filter(r => r.isNew).slice(0, 5);

    // Market stats
    const avg24h   = results.length ? +(results.reduce((a, r) => a + r.ch24, 0) / results.length).toFixed(2) : 0;
    const pumping  = results.filter(r => r.ch24 > 8).length;
    const dumping  = results.filter(r => r.ch24 < -8).length;
    const coiling  = results.filter(r => r.anomaly.isCoiling).length;
    const totalVol = results.reduce((a, r) => a + r.vol, 0);
    const memeSignal = avg24h > 5 ? 'BULL' : avg24h < -5 ? 'BEAR' : coiling >= 3 ? 'COILING' : 'NEUTRAL';

    return res.status(200).json({
      version: 'v2.0',
      timestamp: Date.now(),
      scanTime: ((Date.now() - t0) / 1000).toFixed(1),
      fg,
      fgLabel: fg <= 25 ? 'Extreme Fear' : fg <= 45 ? 'Fear' : fg >= 75 ? 'Greed' : 'Neutral',
      totalScanned: results.length,
      stats: { avg24h, pumping, dumping, coiling, totalVol, memeSignal },
      all: results,
      elite,
      trending,
      anomalies,
      wave3,
      patterns,
      dips,
      newCoins,
    });

  } catch (e) {
    return res.status(500).json({ error: e.message, version: 'v2.0', all: [], totalScanned: 0, timestamp: Date.now() });
  }
}
