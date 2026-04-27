// api/accumulation.js — AC369 FUSION v7.0
// ═══════════════════════════════════════════════════════════════
// HEDGE FUND DECISION ENGINE
// MODE: DEFENSIVE (Score≥85, Conf≥85%) | AGGRESSIVE (Score≥75, Conf≥80%)
// PRINCIPLE: Reject > Wait > Execute. Filter, not generator.
// ═══════════════════════════════════════════════════════════════

const TRADE_STORE = new Map();
const SETUP_TS = new Map();
const MAX_ACTIVE = 3;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Mode from query param: ?mode=aggressive (default=defensive)
  const mode = (req.query?.mode || 'defensive').toLowerCase();
  const SCORE_MIN = mode === 'aggressive' ? 75 : 85;
  const CONF_MIN = mode === 'aggressive' ? 80 : 85;

  const sf = async (url, ms = 6000) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
      const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } });
      clearTimeout(t); if (!r.ok) return null; return await r.json();
    } catch { clearTimeout(t); return null; }
  };

  // ════════════════════════════════════════════════════════════
  // 1. MARKET REGIME ENGINE
  // ════════════════════════════════════════════════════════════
  function detectRegime(btcChange7d, btcChange30d, btcDom, fgValue, btcTrend, btcChange24h) {
    let regime, regimeScore, focus, chaotic = false;

    // CHAOTIC: extreme conditions, no reliable direction
    const btcCrash = btcChange24h < -10;
    const fgExtreme = fgValue <= 10 || fgValue >= 92;
    const wildSwing = Math.abs(btcChange24h) > 12;
    if (btcCrash || wildSwing || (fgExtreme && Math.abs(btcChange7d) > 15)) {
      chaotic = true;
      return { regime: 'CHAOTIC 🚫', regimeScore: -999, focus: 'NO TRADE — terlalu volatile', chaotic: true, regimeColor: 'var(--red)', description: 'Market chaotic. Zero visibility. All setups auto-REJECTED.', btcDom };
    }

    // TRENDING BEAR
    if (btcChange7d < -8 || (btcChange7d < -5 && btcChange30d < -20)) {
      regime = 'TRENDING BEAR 📉';
      regimeScore = -20;
      focus = 'Hindari long agresif. Short only atau tunggu reversal konfirmasi.';
    }
    // TRENDING BULL
    else if (btcChange7d > 8 || (btcChange7d > 5 && btcTrend === 'BULLISH' && fgValue > 50)) {
      regime = 'TRENDING BULL 📈';
      regimeScore = +10;
      focus = 'Fokus breakout & continuation. Momentum setups valid.';
    }
    // RANGING
    else {
      regime = 'RANGING ↔️';
      regimeScore = +5;
      focus = 'Fokus accumulation zone & reversal. SM detection optimal.';
    }

    const fgBonus = fgValue <= 25 ? +8 : fgValue <= 40 ? +4 : fgValue >= 75 ? -6 : fgValue >= 60 ? -2 : 0;
    const color = regime.includes('BEAR') ? 'var(--red)' : regime.includes('BULL') ? 'var(--g)' : 'var(--amber)';

    return { regime, regimeScore: regimeScore + fgBonus, focus, chaotic: false, regimeColor: color, description: focus, btcDom };
  }

  // ════════════════════════════════════════════════════════════
  // 2. HARD FILTER (all must pass)
  // ════════════════════════════════════════════════════════════
  function hardFilter(price, entryOptimal, slPrice, rr1, change24h, volTier, regime) {
    const reasons = [];
    if (price <= slPrice * 0.999) return { pass: false, reason: `SL breached. Price ${fmtP(price)} ≤ SL ${fmtP(slPrice)}.`, tag: 'SL_HIT' };
    if (rr1 < 3) return { pass: false, reason: `R:R ${rr1}:1 < minimum 3:1.`, tag: 'POOR_RR' };
    const dist = (price - entryOptimal) / price;
    if (dist > 0.03) return { pass: false, reason: `Price ${(dist * 100).toFixed(1)}% above entry. Chasing.`, tag: 'TOO_LATE' };
    if (change24h < -8) return { pass: false, reason: `24h breakdown ${change24h.toFixed(1)}%. Structure invalid.`, tag: 'BREAKDOWN' };
    if (volTier < 1) return { pass: false, reason: 'Volume insufficient for institutional trade.', tag: 'LOW_VOLUME' };
    if (regime.includes('CHAOTIC')) return { pass: false, reason: 'Chaotic market. All setups auto-REJECTED.', tag: 'CHAOTIC' };
    // Bear regime: long setups penalized but not hard rejected (unless extreme)
    if (regime.includes('BEAR') && change24h < -5) return { pass: false, reason: 'Bear regime + negative 24h = against trend.', tag: 'TREND_CONFLICT' };
    return { pass: true };
  }

  // ════════════════════════════════════════════════════════════
  // 3. SMART MONEY VALIDATION (min 2 required)
  // ════════════════════════════════════════════════════════════
  function validateSM(price, high, low, open, change24h, change7d, vol24h, rangePos, lwRatio, bodyRatio) {
    const signals = [];
    const volTier = vol24h >= 500e6 ? 5 : vol24h >= 100e6 ? 4 : vol24h >= 30e6 ? 3 : vol24h >= 10e6 ? 2 : vol24h >= 2e6 ? 1 : 0;

    // Liquidity Sweep (most important SM signal)
    if (lwRatio > 0.45 && rangePos < 0.55 && price > low * 1.003) {
      const str = lwRatio > 0.60 ? 'STRONG' : 'MODERATE';
      signals.push({ type: 'LIQUIDITY_SWEEP', strength: str, pts: str === 'STRONG' ? 22 : 15, note: `Lower wick ${(lwRatio * 100).toFixed(0)}% — SSL taken + recovery` });
    }
    // Volume Absorption
    if (volTier >= 3 && Math.abs(change24h) <= 3) {
      const str = volTier >= 4 && Math.abs(change24h) < 1.5 ? 'STRONG' : 'MODERATE';
      signals.push({ type: 'VOLUME_ABSORPTION', strength: str, pts: str === 'STRONG' ? 22 : 15, note: `$${(vol24h / 1e6).toFixed(0)}M vol + ${change24h.toFixed(1)}% price = SM absorbing supply` });
    } else if (volTier >= 2 && Math.abs(change24h) <= 2) {
      signals.push({ type: 'VOLUME_ABSORPTION', strength: 'MODERATE', pts: 12, note: `Moderate absorption: $${(vol24h / 1e6).toFixed(0)}M vol + flat price` });
    }
    // Accumulation (Wyckoff)
    if (Math.abs(change24h) < 3 && volTier >= 2 && (change7d || 0) <= 5 && rangePos > 0.25 && rangePos < 0.65) {
      signals.push({ type: 'ACCUMULATION', strength: volTier >= 3 ? 'STRONG' : 'MODERATE', pts: volTier >= 3 ? 18 : 11, note: `Wyckoff accumulation: price flat + volume building` });
    }
    // Structure Reclaim
    if (change24h > 2.5 && change24h < 12 && rangePos > 0.55 && lwRatio > 0.20) {
      signals.push({ type: 'STRUCTURE_RECLAIM', strength: change24h > 5 ? 'STRONG' : 'MODERATE', pts: change24h > 5 ? 18 : 11, note: `+${change24h.toFixed(1)}% reclaim with wick — SM pushed price back above structure` });
    }
    // Capitulation (final flush)
    if (change24h < -5 && change24h > -12 && volTier >= 3 && rangePos < 0.30) {
      signals.push({ type: 'CAPITULATION', strength: 'MODERATE', pts: 13, note: `Capitulation flush ${change24h.toFixed(1)}% — possible final low` });
    }

    const strongCount = signals.filter(s => s.strength === 'STRONG').length;
    const smScore = signals.reduce((a, s) => a + s.pts, 0);
    return { signals, count: signals.length, strongCount, smScore, valid: signals.length >= 2, topSignals: signals.slice(0, 3) };
  }

  // ════════════════════════════════════════════════════════════
  // 4. ENTRY CONFIRMATION
  // ════════════════════════════════════════════════════════════
  function checkConfirmation(change24h, lwRatio, bodyRatio, rangePos, vol24h, change7d) {
    const confirmations = [];
    const vt = vol24h >= 100e6 ? 3 : vol24h >= 30e6 ? 2 : vol24h >= 5e6 ? 1 : 0;

    if (lwRatio > 0.40 && bodyRatio < 0.25) confirmations.push({ type: 'REJECTION', note: `Strong wick ${(lwRatio * 100).toFixed(0)}% — clear rejection` });
    if (vt >= 2 && (change24h > 0.5 || Math.abs(change24h) < 2)) confirmations.push({ type: 'VOLUME_SURGE', note: `$${(vol24h / 1e6).toFixed(0)}M vol confirms SM activity` });
    if (change24h > 2.5 && change24h < 12 && rangePos > 0.55) confirmations.push({ type: 'MICRO_BOS_HL', note: `+${change24h.toFixed(1)}% above mid = micro BOS / HL forming` });
    if (lwRatio > 0.30 && change24h > 0.3 && rangePos > 0.45) confirmations.push({ type: 'SWEEP_RECOVERY', note: `Price bounced from lows after sweep` });

    return { confirmations, count: confirmations.length, valid: confirmations.length >= 2, needs: Math.max(0, 2 - confirmations.length) };
  }

  // ════════════════════════════════════════════════════════════
  // 5. MTF ALIGNMENT
  // ════════════════════════════════════════════════════════════
  function checkMTF(change24h, change7d, change30d, rangePos, lwRatio) {
    const htf = (change7d || 0) > 2 && (change30d || 0) > -45 ? 'BULLISH' : (change7d || 0) < -10 || (change30d || 0) < -55 ? 'BEARISH' : 'NEUTRAL';
    const ltf = change24h > 0.5 && rangePos > 0.45 ? 'BULLISH' : change24h < -5 && rangePos < 0.40 ? 'BEARISH' : 'NEUTRAL';

    if (htf === 'BULLISH' && ltf === 'BULLISH') return { htf, ltf, aligned: true, score: +10, label: 'ALIGNED ✅', note: 'Both TFs bullish — max conviction' };
    if (htf === 'BULLISH' && ltf === 'NEUTRAL') return { htf, ltf, aligned: true, score: +5, label: 'PARTIAL ⚠️', note: 'HTF bullish, LTF neutral — valid but lower confidence' };
    if (htf === 'NEUTRAL' && ltf === 'BULLISH') return { htf, ltf, aligned: true, score: +3, label: 'LTF ONLY ⚠️', note: 'LTF bullish but HTF unclear' };
    if (htf === 'BEARISH' && ltf === 'BULLISH') return { htf, ltf, aligned: false, score: -15, label: 'CONFLICT ❌', note: 'HTF BEAR vs LTF BULL = dead cat risk. REJECT.' };
    if (htf === 'BEARISH') return { htf, ltf, aligned: false, score: -20, label: 'BEARISH ❌', note: 'HTF bearish — reject long setup.' };
    return { htf, ltf, aligned: true, score: 0, label: 'NEUTRAL ⚖️', note: 'Neutral — proceed with caution' };
  }

  // ════════════════════════════════════════════════════════════
  // 6. PATTERN ENGINE
  // ════════════════════════════════════════════════════════════
  function detectPattern(price, high, low, open, change24h, change7d, change30d, vol24h, rangePos, lwRatio, bodyRatio) {
    if (change24h < -8) return { name: 'Breakdown', status: 'CONFIRMED', patScore: -10, desc: `Bearish breakdown ${change24h.toFixed(1)}%`, bullish: false };
    const pats = [];
    if (lwRatio > 0.45 && rangePos < 0.45 && (change7d || 0) >= -6 && (change7d || 0) <= 10)
      pats.push({ name: 'Double Bottom', status: lwRatio > 0.55 ? 'CONFIRMED' : 'FORMING', patScore: lwRatio > 0.55 ? 10 : 4, desc: `DB ${lwRatio > 0.55 ? 'confirmed' : 'forming'} — neckline ${fmtP(high)}`, bullish: true });
    if (lwRatio > 0.50 && change24h > 1 && (change7d || 0) > 2 && (change7d || 0) < 15)
      pats.push({ name: 'Inverse H&S', status: lwRatio > 0.60 && change24h > 3 ? 'CONFIRMED' : 'FORMING', patScore: lwRatio > 0.60 && change24h > 3 ? 10 : 4, desc: `IH&S ${lwRatio > 0.60 ? 'confirmed' : 'forming'}`, bullish: true });
    if ((change7d || 0) > 5 && rangePos > 0.55 && vol24h > 10e6)
      pats.push({ name: 'Ascending Base', status: change24h > 2 && rangePos > 0.70 ? 'CONFIRMED' : 'FORMING', patScore: change24h > 2 && rangePos > 0.70 ? 10 : 4, desc: `Base ${change24h > 2 ? 'breakout confirmed' : 'forming'}`, bullish: true });
    if ((change7d || 0) > 8 && change24h >= -3 && change24h <= 2 && rangePos > 0.40 && lwRatio > 0.25)
      pats.push({ name: 'Breakout Retest', status: lwRatio > 0.30 && change24h >= -1 ? 'CONFIRMED' : 'FORMING', patScore: lwRatio > 0.30 && change24h >= -1 ? 10 : 4, desc: `Retest ${lwRatio > 0.30 ? 'holding' : 'forming'}`, bullish: true });
    if (!pats.length) return { name: 'None', status: 'NONE', patScore: 0, desc: 'No clear pattern', bullish: false };
    return pats.sort((a, b) => b.patScore - a.patScore)[0];
  }

  // ════════════════════════════════════════════════════════════
  // 7. FULL SCORE + CONFIDENCE
  // ════════════════════════════════════════════════════════════
  function calcScore(coin, btcCh24h, btcCh7d, fgValue, regimeScore, mtf, sm, conf, pattern, rr1, freshness) {
    const { price, vol24h, change24h, high, low, open, change7d, change30d, ath } = coin;
    const range = Math.max(high - low, price * 0.01);
    const rangePos = (price - low) / range;
    const lwRatio = (Math.min(price, open) - low) / range;
    const bodyRatio = Math.abs(price - open) / range;
    const fromATH = ath > 0 ? ((price - ath) / ath * 100) : 0;
    const rs7d = (change7d || 0) - btcCh7d;
    const vt = vol24h >= 500e6 ? 5 : vol24h >= 100e6 ? 4 : vol24h >= 30e6 ? 3 : vol24h >= 10e6 ? 2 : vol24h >= 2e6 ? 1 : 0;
    const flat = change24h >= -5 && change24h <= 3;
    const down = change24h < -5 && change24h > -12;

    // S1: Volume Accumulation (25)
    let s1 = flat && vt >= 4 ? 25 : flat && vt >= 3 ? 20 : down && vt >= 4 ? 22 : down && vt >= 3 ? 18 : flat && vt >= 2 ? 14 : down && vt >= 2 ? 12 : flat && vt >= 1 ? 8 : 3;
    if (fgValue <= 25 && flat) s1 = Math.min(25, s1 + 3);

    // S2: Liquidity Sweep (20)
    let s2 = lwRatio > 0.55 && bodyRatio < 0.15 && rangePos > 0.40 ? 20 : lwRatio > 0.50 && rangePos < 0.45 && price > low * 1.003 ? 18 : lwRatio > 0.40 && rangePos < 0.50 ? 14 : lwRatio > 0.30 && rangePos < 0.55 && flat ? 10 : lwRatio > 0.20 && rangePos < 0.45 ? 7 : rangePos < 0.30 ? 4 : 1;
    if (lwRatio > 0.45 && change24h > 1 && rangePos > 0.55) s2 = Math.min(20, s2 + 3);

    // S3: Structure (20)
    const ssl = lwRatio > 0.40 && rangePos < 0.50;
    const choch = change24h > 3 && change24h < 12 && rangePos > 0.55 && (change7d || 0) < 5;
    let s3 = ssl && choch ? 20 : ssl && change24h > 1 ? 17 : choch ? 15 : change24h > 5 && rangePos > 0.65 ? 13 : ssl ? 11 : (change7d || 0) > 3 && (change30d || 0) < -15 ? 9 : Math.abs(change24h) < 3 && vol24h > 5e6 ? 7 : rangePos < 0.35 ? 4 : 1;
    if (rs7d > 10) s3 = Math.min(20, s3 + 3); else if (rs7d > 5) s3 = Math.min(20, s3 + 2);

    // S4: RR (15)
    const s4 = rr1 >= 10 ? 15 : rr1 >= 7 ? 12 : rr1 >= 5 ? 10 : rr1 >= 3 ? 6 : 0;

    // S5: Entry Precision (10)
    const inGolden = fromATH <= -55 && fromATH >= -80;
    const deep = fromATH <= -80 && fromATH >= -97;
    const norm = fromATH <= -30 && fromATH >= -55;
    const s5 = inGolden && rangePos < 0.50 ? 10 : inGolden ? 8 : deep && rangePos < 0.50 ? 9 : deep ? 7 : norm && rangePos < 0.40 ? 7 : norm ? 5 : rangePos < 0.30 ? 4 : 2;

    // S6: Momentum (10)
    let s6 = rs7d > 15 && flat ? 10 : rs7d > 8 && change24h >= 0 ? 9 : rs7d > 3 && change24h >= 0 ? 7 : rs7d > 0 && btcCh7d < 0 ? 8 : rs7d >= -3 && change24h >= 0 ? 6 : change24h > 2 ? 5 : 3;
    if (fgValue <= 25) s6 = Math.min(10, s6 + 2);

    const patBonus = Math.max(-10, Math.min(10, pattern.patScore || 0));
    const rawScore = s1 + s2 + s3 + s4 + s5 + s6 + patBonus + regimeScore * 0.3 + mtf.score * 0.5 + freshness.bonus;
    const totalScore = Math.max(0, Math.min(100, Math.round(rawScore)));

    // Confidence: weighted average with adjustments
    const baseConf = (rawScore / 100) * 100;
    const smAdj = sm.strongCount >= 2 ? +12 : sm.valid ? +6 : -20;
    const confAdj = conf.valid ? +10 : conf.count >= 1 ? +4 : -8;
    const mtfAdj = mtf.score >= 8 ? +10 : mtf.score >= 3 ? +5 : mtf.score < -5 ? -15 : -3;
    const rrAdj = rr1 >= 8 ? +8 : rr1 >= 5 ? +4 : rr1 >= 3 ? 0 : -15;
    const patAdj = pattern.status === 'CONFIRMED' && pattern.bullish ? +8 : pattern.status === 'FAILED' ? -10 : 0;
    const freshAdj = freshness.fresh ? +5 : freshness.aging ? 0 : -8;
    const confidence = Math.max(0, Math.min(100, Math.round(baseConf + smAdj + confAdj + mtfAdj + rrAdj + patAdj + freshAdj)));

    return { totalScore, confidence, s1, s2, s3, s4, s5, s6, patBonus, fromATH };
  }

  // ════════════════════════════════════════════════════════════
  // Entry Quality Grade
  // ════════════════════════════════════════════════════════════
  function gradeQuality(score, confidence, sm, conf, mtf, rr1, scoreMin, confMin) {
    const allMet = score >= scoreMin && confidence >= confMin && sm.valid && mtf.aligned && rr1 >= 3;
    const strongAll = sm.strongCount >= 2 && conf.valid && mtf.score >= 5 && rr1 >= 5;

    if (allMet && strongAll && score >= scoreMin + 5 && confidence >= confMin + 5)
      return { grade: 'A+', label: 'A+ SNIPER 🎯', take: true, note: 'All confluences perfect. Maximum conviction.' };
    if (allMet)
      return { grade: 'A', label: 'A QUALITY ✅', take: true, note: 'Strong institutional setup. Take with standard sizing.' };
    if (score >= scoreMin - 8 && confidence >= confMin - 8 && sm.valid)
      return { grade: 'B', label: 'B MARGINAL — SKIP ⚠️', take: false, note: 'Missing key confirmations. Not meeting hedge fund standard.' };
    return { grade: 'C', label: 'C REJECT ❌', take: false, note: 'Insufficient quality. Hard reject.' };
  }

  // ════════════════════════════════════════════════════════════
  // Trade State Machine
  // ════════════════════════════════════════════════════════════
  function getState(sym, price, entLo, entHi, sl, tp1, tp2, tp3, score, tier, activeCount) {
    const now = Date.now();
    const ex = TRADE_STORE.get(sym);
    const EXPIRY = 72 * 3600 * 1000;

    if (ex) {
      const { state } = ex;
      if (state === 'TRIGGERED' || state === 'ACTIVE' || state === 'IN_ZONE') {
        if (price <= ex.sl * 0.999) {
          const pnl = ex.ep > 0 ? +((price - ex.ep) / ex.ep * 100).toFixed(2) : 0;
          TRADE_STORE.set(sym, { ...ex, state: 'INVALID', closed: now, pnl });
          return { state: 'INVALID', tag: 'INVALID ❌ — SL HIT', isActive: false, pnl };
        }
        if (price >= ex.tp1 * 0.998) {
          const pnl = ex.ep > 0 ? +((ex.tp1 - ex.ep) / ex.ep * 100).toFixed(2) : 0;
          TRADE_STORE.set(sym, { ...ex, state: 'COMPLETED', closed: now, pnl });
          return { state: 'COMPLETED', tag: `COMPLETED ✅ TP1 +${pnl}%`, isActive: false, pnl };
        }
        const pnl = ex.ep > 0 ? +((price - ex.ep) / ex.ep * 100).toFixed(2) : 0;
        return { state, tag: `${state} 🟢 PnL: ${pnl >= 0 ? '+' : ''}${pnl}%`, isActive: true, ep: ex.ep, pnl, sl: ex.sl, tp1: ex.tp1, tp2: ex.tp2, tp3: ex.tp3, tier: ex.tier };
      }
      if (state === 'READY' && now - (ex.st || now) > EXPIRY) {
        TRADE_STORE.set(sym, { ...ex, state: 'EXPIRED' });
        return { state: 'EXPIRED', tag: 'EXPIRED ⏰', isActive: false };
      }
    }

    if (activeCount >= MAX_ACTIVE) return { state: 'READY', tag: 'READY — Max 3 trades active', isActive: false, blocked: true };

    if (price >= entLo * 0.999 && price <= entHi * 1.01) {
      TRADE_STORE.set(sym, { state: 'IN_ZONE', ep: price, et: now, st: now, sl, tp1, tp2, tp3, score, tier });
      return { state: 'IN_ZONE', tag: 'IN_ZONE ⚡ — CONFIRM THEN ENTER', isActive: true, ep: price };
    }

    if (!ex || ex.state === 'EXPIRED') TRADE_STORE.set(sym, { state: 'READY', st: now, sl, tp1, tp2, tp3, score, tier });
    const d = (entLo - price) / price;
    const prox = d <= 0 ? 'AT ZONE ✅' : d < 0.02 ? 'NEAR (<2%)' : d < 0.05 ? 'APPROACHING (<5%)' : `WAITING (${(d * 100).toFixed(1)}%)`;
    return { state: 'READY', tag: `READY — ${prox}`, isActive: false };
  }

  // ════════════════════════════════════════════════════════════
  // MAIN
  // ════════════════════════════════════════════════════════════
  try {
    const t0 = Date.now();

    const [binR, cgR, fngR, glbR, btcKR] = await Promise.allSettled([
      sf('https://api.binance.com/api/v3/ticker/24hr', 6000),
      sf('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=volume_desc&per_page=250&page=1&sparkline=false&price_change_percentage=7d,30d', 6000),
      sf('https://api.alternative.me/fng/?limit=1&format=json'),
      sf('https://api.coingecko.com/api/v3/global'),
      sf('https://min-api.cryptocompare.com/data/v2/histohour?fsym=BTC&tsym=USD&limit=168', 5000),
    ]);

    const bins = binR.status === 'fulfilled' && Array.isArray(binR.value) && binR.value.length > 100 ? binR.value : [];
    const cgs = cgR.status === 'fulfilled' && Array.isArray(cgR.value) ? cgR.value : [];
    const fgV = fngR.status === 'fulfilled' ? parseInt(fngR.value?.data?.[0]?.value || 50) : 50;
    const glb = glbR.status === 'fulfilled' ? glbR.value?.data : null;
    const btcK = btcKR.status === 'fulfilled' && btcKR.value?.Response === 'Success' ? btcKR.value.Data.Data.map(d => +d.close).filter(v => v > 0) : [];

    const bmap = {};
    bins.forEach(t => { if (t?.symbol) bmap[t.symbol] = t; });
    const btcT = bmap['BTCUSDT'];
    const btcPx = +(btcT?.lastPrice || 0);
    const btcCh24 = +(btcT?.priceChangePercent || 0);
    let btcCh7 = 0, btcTrend = 'NEUTRAL';
    if (btcK.length >= 50) {
      const c = btcK[btcK.length - 1], w7 = btcK.length >= 168 ? btcK[btcK.length - 168] : btcK[0];
      btcCh7 = w7 > 0 ? +((c - w7) / w7 * 100).toFixed(2) : 0;
      const ma50 = btcK.slice(-50).reduce((a, b) => a + b, 0) / 50;
      btcTrend = c > ma50 * 1.02 ? 'BULLISH' : c < ma50 * 0.98 ? 'BEARISH' : 'NEUTRAL';
    }

    const btcDom = +(glb?.market_cap_percentage?.btc || 58).toFixed(1);
    const dsh = Math.floor((Date.now() - new Date('2024-04-20').getTime()) / 86400000);
    const cyc = dsh < 365 ? 3 : dsh < 547 ? 2 : dsh < 730 ? 0 : -2;
    const cyclePhase = dsh < 365 ? 'Bull Early ✅' : dsh < 547 ? 'Bull Peak ⚠️' : dsh < 730 ? 'Distribution ⚠️' : 'Bear/Accum';

    // Global regime
    const regime = detectRegime(btcCh7, 0, btcDom, fgV, btcTrend, btcCh24);

    const STABLES = new Set(['USDT','USDC','BUSD','TUSD','DAI','FDUSD','USDP','FRAX','LUSD','USDS','SUSD','GUSD','PYUSD','CRVUSD','USDD','CUSD','USDX','USDB','XUSD','USDJ','AUSD','AGEUR','JEUR','XSGD','EURS','EURT','CADC','GYEN','NZDS','BRLA','MXNT','BIDR','BVND','IDRT','TRYB','BRLC','PAXG','XAUT','WBTC','WETH','WBNB','STETH','CBETH','RETH','BETH']);
    const BAD = ['UP','DOWN','BEAR','BULL','3L','3S','2L','2S'];
    const HAN = /[\u4e00-\u9fff]/;

    const cgm = {};
    cgs.forEach(c => { if (c?.symbol) cgm[c.symbol.toUpperCase()] = c; });

    const candidates = [];
    const seen = new Set();
    bins.forEach(t => {
      if (!t?.symbol?.endsWith('USDT')) return;
      const b = t.symbol.replace('USDT', '');
      if (STABLES.has(b) || seen.has(b) || HAN.test(b) || BAD.some(s => b.startsWith(s) || b.endsWith(s)) || b.length < 2 || b.length > 12) return;
      const v = +(t.quoteVolume || 0), p = +(t.lastPrice || 0);
      if (v < 500000 || p <= 0 || (p >= 0.97 && p <= 1.03 && Math.abs(+(t.priceChangePercent || 0)) < 2)) return;
      seen.add(b);
      const cg = cgm[b];
      candidates.push({ base: b, price: p, vol24h: v, change24h: +(t.priceChangePercent || 0), high: +(t.highPrice || p), low: +(t.lowPrice || p), open: +(t.openPrice || p), change7d: cg ? +(cg.price_change_percentage_7d || 0) : null, change30d: cg ? +(cg.price_change_percentage_30d || 0) : null, ath: cg ? +(cg.ath || 0) : 0, marketCap: cg ? +(cg.market_cap || 0) : 0, cgName: cg?.name || b });
    });
    cgs.forEach(c => {
      const b = (c.symbol || '').toUpperCase();
      if (STABLES.has(b) || seen.has(b) || HAN.test(c.name || '')) return;
      const v = +(c.total_volume || 0), p = +(c.current_price || 0);
      if (v < 1e6 || p <= 0 || (p >= 0.97 && p <= 1.03)) return;
      candidates.push({ base: b, price: p, vol24h: v, change24h: +(c.price_change_percentage_24h || 0), high: p * 1.02, low: p * 0.98, open: p / (1 + (+(c.price_change_percentage_24h || 0)) / 100), change7d: +(c.price_change_percentage_7d || 0), change30d: +(c.price_change_percentage_30d || 0), ath: +(c.ath || 0), marketCap: +(c.market_cap || 0), cgName: c.name || b });
    });

    let actCnt = 0;
    TRADE_STORE.forEach(v => { if (v.state === 'IN_ZONE' || v.state === 'TRIGGERED' || v.state === 'ACTIVE') actCnt++; });

    const killed = { CHAOTIC: 0, HARD_FILTER: 0, SM: 0, MTF: 0, QUALITY: 0, SCORE: 0, STALE: 0 };
    const outputs = [];
    const actives = [];

    for (const coin of candidates.slice(0, 800)) {
      const { base: sym, price, ath, change24h, vol24h, change7d, change30d } = coin;
      if (!price || price <= 0) continue;
      if (ath > 0 && ((price - ath) / ath * 100) < -99) { killed.STALE++; continue; }

      const range = Math.max(coin.high - coin.low, price * 0.01);
      const rangePos = (price - coin.low) / range;
      const lw = Math.min(price, coin.open) - coin.low;
      const lwRatio = lw / range;
      const bodyRatio = Math.abs(price - coin.open) / range;
      const fromATH = ath > 0 ? ((price - ath) / ath * 100) : 0;
      const vt = vol24h >= 500e6 ? 5 : vol24h >= 100e6 ? 4 : vol24h >= 30e6 ? 3 : vol24h >= 10e6 ? 2 : vol24h >= 2e6 ? 1 : 0;

      // Protect existing active trades
      const ex = TRADE_STORE.get(sym);
      if (ex && (ex.state === 'IN_ZONE' || ex.state === 'TRIGGERED' || ex.state === 'ACTIVE')) {
        const pnl = ex.ep > 0 ? +((price - ex.ep) / ex.ep * 100).toFixed(2) : 0;
        if (price <= ex.sl * 0.999) {
          TRADE_STORE.set(sym, { ...ex, state: 'INVALID', closed: Date.now(), pnl });
          continue;
        }
        const pat = detectPattern(price, coin.high, coin.low, coin.open, change24h, change7d, change30d, vol24h, rangePos, lwRatio, bodyRatio);
        actives.push({ symbol: sym, price, status: ex.state, tag: `${ex.state} 🟢 PnL: ${pnl >= 0 ? '+' : ''}${pnl}%`, tier: ex.tier || 'A', ep: ex.ep, pnl, sl: ex.sl, tp1: ex.tp1, tp2: ex.tp2, tp3: ex.tp3, change24h: +change24h.toFixed(2), pattern: pat });
        continue;
      }

      // CHAOTIC: all reject
      if (regime.chaotic) { killed.CHAOTIC++; continue; }

      // Hard filter
      const entryOpt = price * 0.999;
      const slPrice = Math.max(price * (1 - 0.08 - 0.03), coin.low * 0.96);
      let tp1, tp2, tp3;
      if (ath > 0 && fromATH < -25) {
        const d = ath - price;
        tp1 = Math.min(price + d * 0.382, price * 3);
        tp2 = Math.min(price + d * 0.618, price * 6);
        tp3 = Math.min(price + d, price * 10);
      } else {
        const sl = price - slPrice;
        tp1 = price + sl * 3; tp2 = price + sl * 5; tp3 = price + sl * 8;
      }
      const slDist = Math.max(price - slPrice, price * 0.005);
      const rr1 = +((tp1 - price) / slDist).toFixed(2);
      const rr2 = +((tp2 - price) / slDist).toFixed(2);
      const rr3 = +((tp3 - price) / slDist).toFixed(2);

      const hf = hardFilter(price, entryOpt, slPrice, rr1, change24h, vt, regime.regime);
      if (!hf.pass) { killed.HARD_FILTER++; continue; }

      // SM Validation
      const sm = validateSM(price, coin.high, coin.low, coin.open, change24h, change7d, vol24h, rangePos, lwRatio, bodyRatio);
      if (!sm.valid) { killed.SM++; continue; }

      // MTF
      const mtf = checkMTF(change24h, change7d, change30d, rangePos, lwRatio);
      if (!mtf.aligned) { killed.MTF++; continue; }

      // Pattern
      const pattern = detectPattern(price, coin.high, coin.low, coin.open, change24h, change7d, change30d, vol24h, rangePos, lwRatio, bodyRatio);

      // Entry confirmation
      const ec = checkConfirmation(change24h, lwRatio, bodyRatio, rangePos, vol24h, change7d);

      // Freshness
      const now = Date.now();
      const fts = SETUP_TS.get(sym);
      if (!fts) SETUP_TS.set(sym, { t: now, vol: vol24h });
      const ageH = fts ? (now - fts.t) / 3600000 : 0;
      const volFaded = fts && vol24h < fts.vol * 0.45;
      const fresh = ageH < 4 && !volFaded;
      const aging = !fresh && ageH < 48 && !volFaded;
      if (!fresh && !aging) { SETUP_TS.delete(sym); killed.STALE++; continue; }
      const freshness = { fresh, aging, bonus: fresh ? 3 : aging ? 0 : -5, status: fresh ? 'FRESH 🟢' : aging ? 'AGING 🟡' : 'EXPIRED ⏰', note: fresh ? `Fresh setup (<${ageH.toFixed(1)}h)` : `Aging setup (${ageH.toFixed(0)}h old)` };

      // Score + Confidence
      const sc = calcScore(coin, btcCh24, btcCh7, fgV, regime.regimeScore, { score: mtf.score }, sm, ec, pattern, rr1, freshness);

      // Quality grade
      const qual = gradeQuality(sc.totalScore, sc.confidence, sm, ec, mtf, rr1, SCORE_MIN, CONF_MIN);
      if (!qual.take) { killed.QUALITY++; continue; }
      if (sc.totalScore < SCORE_MIN || sc.confidence < CONF_MIN) { killed.SCORE++; continue; }

      const tier = sc.totalScore >= 85 ? 'S' : sc.totalScore >= 75 ? 'A' : null;
      if (!tier) { killed.SCORE++; continue; }

      // State
      const entLo = Math.max(price * 0.98, coin.low * 0.99);
      const entHi = price * 1.01;
      const ts = getState(sym, price, entLo, entHi, slPrice, tp1, tp2, tp3, sc.totalScore, tier, actCnt);

      // Final decision
      let decision, decisionColor;
      if (regime.chaotic) { decision = 'REJECT — CHAOTIC MARKET'; decisionColor = 'var(--red)'; }
      else if (ts.state === 'IN_ZONE' && ec.valid && qual.take) { decision = 'EXECUTE ✅'; decisionColor = '#ff6b35'; }
      else if (!ec.valid) { decision = 'WAIT ⏳ — Need confirmation'; decisionColor = 'var(--amber)'; }
      else if (ts.blocked) { decision = 'WAIT ⏳ — Max active trades'; decisionColor = 'var(--amber)'; }
      else if (qual.grade === 'A+' || qual.grade === 'A') { decision = 'LIMIT ORDER ✅'; decisionColor = 'var(--g)'; }
      else { decision = 'REJECT — Quality insufficient'; decisionColor = 'var(--red)'; }

      const reasons = [];
      sm.topSignals.forEach(s => reasons.push(`${s.type.replace(/_/g, ' ')} (${s.strength}): ${s.note}`));
      if (ec.valid) reasons.push(`Entry confirmed: ${ec.confirmations.map(c => c.type.replace(/_/g, ' ')).join(' + ')}`);
      if (sc.fromATH < -40) reasons.push(`${sc.fromATH.toFixed(0)}% from ATH — deep value`);
      if (pattern.status === 'CONFIRMED' && pattern.bullish) reasons.push(`${pattern.name} CONFIRMED — ${pattern.desc}`);

      outputs.push({
        rank: 0, symbol: sym, name: coin.cgName || sym,
        price, change24h: +change24h.toFixed(2), change7d: +(change7d || 0).toFixed(2),
        vol24h, fromATH: sc.fromATH !== 0 ? +sc.fromATH.toFixed(1) : null,
        tier, tierLabel: tier === 'S' ? '🔥 TIER S — SNIPER' : '✅ TIER A — READY',
        totalScore: sc.totalScore, confidence: sc.confidence,
        entryQuality: qual, mode,
        regime: { regime: regime.regime, focus: regime.focus, color: regime.regimeColor },
        mtf: { htf: mtf.htf, ltf: mtf.ltf, label: mtf.label, note: mtf.note },
        smDetection: { count: sm.count, valid: sm.valid, strongCount: sm.strongCount, topSignals: sm.topSignals },
        entryConfirmation: { valid: ec.valid, count: ec.count, needs: ec.needs, confirmations: ec.confirmations },
        pattern: { name: pattern.name, status: pattern.status, patScore: pattern.patScore, desc: pattern.desc, bullish: pattern.bullish || false },
        freshness,
        tradeState: ts, status: ts.state,
        entryZone: { lo: +entLo.toFixed(8), optimal: +entryOpt.toFixed(8), hi: +entHi.toFixed(8) },
        stopLoss: { price: +slPrice.toFixed(8), pct: +((slPrice - price) / price * 100).toFixed(1) },
        targets: {
          tp1: { price: +tp1.toFixed(8), pct: +((tp1 - price) / price * 100).toFixed(1), rr: rr1, label: ath > 0 ? 'Fib 38.2%' : 'TP1' },
          tp2: { price: +tp2.toFixed(8), pct: +((tp2 - price) / price * 100).toFixed(1), rr: rr2, label: ath > 0 ? 'Fib 61.8%' : 'TP2' },
          tp3: { price: +tp3.toFixed(8), pct: +((tp3 - price) / price * 100).toFixed(1), rr: rr3, label: ath > 0 ? 'ATH area' : 'TP3' },
        },
        scoreBreakdown: { volAccum: sc.s1, liqSweep: sc.s2, structure: sc.s3, riskReward: sc.s4, entryPrecision: sc.s5, momentum: sc.s6, patternBonus: sc.patBonus },
        decision, decisionColor,
        reasons: reasons.slice(0, 4),
        recommendation: decision,
        positionSize: qual.grade === 'A+' ? '2-3% capital' : '1-2% capital',
      });
    }

    outputs.sort((a, b) => b.confidence - a.confidence || b.totalScore - a.totalScore);
    outputs.forEach((r, i) => r.rank = i + 1);
    const tierS = outputs.filter(r => r.tier === 'S').slice(0, 5);
    const tierA = outputs.filter(r => r.tier === 'A').slice(0, 8);
    const totalKilled = Object.values(killed).reduce((a, b) => a + b, 0);

    res.setHeader('Cache-Control', 's-maxage=60');
    return res.status(200).json({
      timestamp: Date.now(),
      scanTime: ((Date.now() - t0) / 1000).toFixed(1),
      mode, scoreMin: SCORE_MIN, confMin: CONF_MIN,
      totalScanned: candidates.length,
      totalQualified: outputs.length,
      totalActive: actives.length,
      totalKilled,
      killedBreakdown: killed,
      tierGroups: { S: tierS, A: tierA },
      activeTrades: actives,
      marketRegime: regime,
      systemStatus: {
        activeTradeCount: actCnt, maxAllowed: MAX_ACTIVE, canTakeNew: actCnt < MAX_ACTIVE,
        cyclePhase, inMR: false, btcTrend, fgValue: fgV, btcDom,
        principle: 'Reject > Wait > Execute. Filter, not generator.',
      },
    });

  } catch (e) {
    return res.status(500).json({ error: e.message, totalScanned: 0 });
  }
}

function fmtP(p) {
  if (!p || p <= 0) return '—';
  if (p >= 10000) return p.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (p >= 1000) return p.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (p >= 1) return p.toFixed(4);
  if (p >= 0.001) return p.toFixed(6);
  return p.toFixed(8);
}
