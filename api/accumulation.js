// api/accumulation.js — AC369 FUSION v8.0
// ══════════════════════════════════════════════════════════════
// ADAPTIVE WEIGHT HEDGE FUND ENGINE
//
// Core: Regime-aware scoring, Pre-Impulse detection,
//       Conflict Engine, Dynamic weights, Kill Switch
//
// WEIGHTS:
//   BULL:  Momentum=30, SmartMoney=25, Structure=20, Market=15, PreImpulse=10
//   BEAR:  Market=30,   SmartMoney=25, Structure=20, Momentum=15, PreImpulse=10
//   RANGE: PreImpulse=30, SmartMoney=25, Structure=20, Momentum=15, Market=10
//
// FILTERS: Score≥80, Confidence≥85%, Conflict=LOW, RR≥3, PreImpulse≥3/5
// PRINCIPLE: Tolak sebanyak mungkin. Eksekusi sesedikit mungkin.
// ══════════════════════════════════════════════════════════════

const TRADE_STORE = new Map();
const SETUP_TS = new Map();
const MAX_ACTIVE = 3;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const sf = async (url, ms = 6000) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
      const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } });
      clearTimeout(t); if (!r.ok) return null; return await r.json();
    } catch { clearTimeout(t); return null; }
  };

  // ═══════════════════════════════════════════════════════════
  // 0. KILL SWITCH + MARKET REGIME
  // ═══════════════════════════════════════════════════════════
  function detectRegimeAndWeights(btcCh7d, btcCh24h, btcDom, fgValue, btcTrend) {
    // Kill switch: chaotic market
    const crash = btcCh24h < -10;
    const extremeVol = Math.abs(btcCh24h) > 12;
    const panicFG = fgValue <= 8 || fgValue >= 93;
    if (crash || extremeVol || (panicFG && Math.abs(btcCh7d) > 18)) {
      return {
        regime: 'CHAOTIC', killSwitch: true, weights: null,
        color: 'var(--red)', focus: 'NO TRADE — Kill Switch Active',
        description: 'Market chaotic. Nol visibility. Semua setup ditolak otomatis.',
      };
    }

    let regime, weights, color, focus;

    if (btcCh7d < -8 || (btcCh7d < -5 && btcTrend === 'BEARISH' && fgValue < 40)) {
      regime = 'BEAR';
      weights = { momentum: 15, smartMoney: 25, structure: 20, market: 30, preImpulse: 10 };
      color = 'var(--red)';
      focus = 'BEAR regime — Long hanya jika skor sangat tinggi + accumulation murni terkonfirmasi.';
    } else if (btcCh7d > 8 || (btcCh7d > 5 && btcTrend === 'BULLISH' && fgValue > 50)) {
      regime = 'BULL';
      weights = { momentum: 30, smartMoney: 25, structure: 20, market: 15, preImpulse: 10 };
      color = 'var(--g)';
      focus = 'BULL regime — Fokus breakout & continuation. Momentum setups valid.';
    } else {
      regime = 'RANGE';
      weights = { momentum: 15, smartMoney: 25, structure: 20, market: 10, preImpulse: 30 };
      color = 'var(--amber)';
      focus = 'RANGE regime — Pre-Impulse detection prioritas. Akumulasi & reversal.';
    }

    const fgBonus = fgValue <= 25 ? +6 : fgValue <= 40 ? +3 : fgValue >= 75 ? -6 : 0;
    const regimeBonus = regime === 'BEAR' ? -8 : regime === 'BULL' ? +8 : +3;

    return { regime, killSwitch: false, weights, color, focus, description: focus, regimeBonus: regimeBonus + fgBonus, fgValue, btcDom };
  }

  // ═══════════════════════════════════════════════════════════
  // 1. HARD FILTER (all must pass first)
  // ═══════════════════════════════════════════════════════════
  function hardFilter(price, entryOpt, slPrice, rr1, change24h, volTier, regime, alreadyPumped) {
    if (price <= slPrice * 0.999) return { pass: false, reason: `SL breached. Dead setup.`, tag: 'SL_HIT' };
    if (rr1 < 3) return { pass: false, reason: `R:R ${rr1}:1 < 3. Rejected.`, tag: 'POOR_RR' };
    const dist = (price - entryOpt) / price;
    if (dist > 0.03) return { pass: false, reason: `Entry ${(dist * 100).toFixed(1)}% above optimal. Chasing.`, tag: 'TOO_LATE' };
    if (change24h < -8) return { pass: false, reason: `Breakdown ${change24h.toFixed(1)}%. Structure invalid.`, tag: 'BREAKDOWN' };
    if (volTier < 2) return { pass: false, reason: `Vol tier ${volTier} insufficient for institutional setup.`, tag: 'LOW_VOLUME' };
    if (alreadyPumped) return { pass: false, reason: `Already pumped +${change24h.toFixed(1)}% — Pre-Impulse opportunity missed.`, tag: 'ALREADY_PUMPED' };
    if (regime === 'BEAR' && change24h < -5) return { pass: false, reason: `Bear regime + negative 24h = against trend.`, tag: 'TREND_CONFLICT' };
    return { pass: true };
  }

  // ═══════════════════════════════════════════════════════════
  // 2. PRE-IMPULSE DETECTION (≥3 of 5 required)
  // ═══════════════════════════════════════════════════════════
  function detectPreImpulse(price, high, low, open, change24h, change7d, vol24h, rangePos, lwRatio, bodyRatio) {
    const signals = [];
    const volTier = vol24h >= 500e6 ? 5 : vol24h >= 100e6 ? 4 : vol24h >= 30e6 ? 3 : vol24h >= 10e6 ? 2 : vol24h >= 2e6 ? 1 : 0;
    const range24h = (high - low) / Math.max(low, 0.001);

    // Already pumped = pre-impulse over
    const alreadyPumped = change24h > 10;

    // Signal 1: Volume up + price flat (absorption)
    const volAbsorption = volTier >= 3 && Math.abs(change24h) <= 3;
    if (volAbsorption) signals.push({ signal: 'VOLUME_ABSORPTION', note: `$${(vol24h / 1e6).toFixed(0)}M vol + ${change24h.toFixed(1)}% price = classic pre-impulse absorption`, score: 20 });

    // Signal 2: Liquidity sweep (stop hunt at lows)
    const sslSweep = lwRatio > 0.40 && rangePos < 0.50 && price > low * 1.003;
    if (sslSweep) signals.push({ signal: 'LIQUIDITY_SWEEP', note: `Lower wick ${(lwRatio * 100).toFixed(0)}% — stops cleared below`, score: 22 });

    // Signal 3: Compression (tight range = coiling)
    const compression = range24h < 0.06 && Math.abs(change24h) < 4 && vol24h > 5e6;
    if (compression) signals.push({ signal: 'COMPRESSION', note: `Range ${(range24h * 100).toFixed(1)}% — spring coiling before expansion`, score: 18 });

    // Signal 4: Absorption candle (high vol, small body)
    const absorptionCandle = volTier >= 2 && bodyRatio < 0.20 && lwRatio > 0.30 && rangePos < 0.55;
    if (absorptionCandle) signals.push({ signal: 'ABSORPTION_CANDLE', note: `Body ${(bodyRatio * 100).toFixed(0)}% wick ${(lwRatio * 100).toFixed(0)}% — SM absorbing at lows`, score: 18 });

    // Signal 5: Higher low (reversal building)
    const higherLow = change24h > 0.5 && change24h < 8 && (change7d || 0) > -10 && rangePos > 0.40;
    if (higherLow) signals.push({ signal: 'HIGHER_LOW', note: `+${change24h.toFixed(1)}% forming HL — structure turning`, score: 16 });

    const count = signals.length;
    const piScore = signals.reduce((a, s) => a + s.score, 0);

    // Stage classification
    let stage;
    if (alreadyPumped) stage = 'LATE — Already pumped';
    else if (count >= 4) stage = 'READY 🔥 — Pre-impulse imminent';
    else if (count === 3) stage = 'EARLY 📈 — Accumulation building';
    else if (count === 2) stage = 'FORMING 🔄 — Early signs';
    else stage = 'WEAK — Insufficient signals';

    return { signals, count, piScore, stage, alreadyPumped, valid: count >= 3 && !alreadyPumped };
  }

  // ═══════════════════════════════════════════════════════════
  // 3. SMART MONEY VALIDATION (≥2 required)
  // ═══════════════════════════════════════════════════════════
  function validateSM(price, high, low, open, change24h, change7d, vol24h, rangePos, lwRatio, bodyRatio) {
    const signals = [];
    const vt = vol24h >= 500e6 ? 5 : vol24h >= 100e6 ? 4 : vol24h >= 30e6 ? 3 : vol24h >= 10e6 ? 2 : vol24h >= 2e6 ? 1 : 0;

    if (lwRatio > 0.45 && rangePos < 0.55 && price > low * 1.003) {
      const str = lwRatio > 0.60 ? 'STRONG' : 'MODERATE';
      signals.push({ type: 'LIQUIDITY_SWEEP', strength: str, pts: str === 'STRONG' ? 22 : 14, note: `SSL swept — wick ${(lwRatio * 100).toFixed(0)}%` });
    }
    if (vt >= 3 && Math.abs(change24h) <= 3) {
      signals.push({ type: 'ACCUMULATION', strength: vt >= 4 ? 'STRONG' : 'MODERATE', pts: vt >= 4 ? 22 : 14, note: `$${(vol24h / 1e6).toFixed(0)}M + flat = SM building position` });
    } else if (vt >= 2 && Math.abs(change24h) <= 2) {
      signals.push({ type: 'VOLUME_ABSORPTION', strength: 'MODERATE', pts: 12, note: `Moderate accumulation vol` });
    }
    if (vt >= 3 && bodyRatio < 0.20 && lwRatio > 0.30) {
      signals.push({ type: 'ABSORPTION', strength: 'STRONG', pts: 20, note: `Absorption candle — SM taking supply` });
    }
    if (change24h > 2.5 && change24h < 12 && rangePos > 0.55 && lwRatio > 0.20) {
      signals.push({ type: 'STRUCTURE_RECLAIM', strength: change24h > 5 ? 'STRONG' : 'MODERATE', pts: change24h > 5 ? 18 : 11, note: `+${change24h.toFixed(1)}% reclaim — SM pushed back above structure` });
    }

    const strong = signals.filter(s => s.strength === 'STRONG').length;
    const smScore = signals.reduce((a, s) => a + s.pts, 0);
    return { signals, count: signals.length, strong, smScore, valid: signals.length >= 2 };
  }

  // ═══════════════════════════════════════════════════════════
  // 4. CONFLICT ENGINE
  // ═══════════════════════════════════════════════════════════
  function detectConflicts(change24h, change7d, change30d, rangePos, lwRatio, regime, btcCh7d, fgValue) {
    const conflicts = [];

    // Conflict 1: HTF vs LTF direction
    const htfBull = (change7d || 0) > 0 && (change30d || 0) > -40;
    const htfBear = (change7d || 0) < -8 || (change30d || 0) < -50;
    const ltfBull = change24h > 0 && rangePos > 0.45;
    const ltfBear = change24h < -5 && rangePos < 0.40;
    if (htfBear && ltfBull) conflicts.push({ type: 'HTF_LTF_CONFLICT', severity: 'HIGH', note: 'HTF bearish, LTF bullish = dead cat risk' });
    if (htfBull && ltfBear) conflicts.push({ type: 'LTF_BREAKDOWN', severity: 'MEDIUM', note: 'LTF breaking down despite HTF ok' });

    // Conflict 2: Coin vs BTC regime
    if (regime === 'BEAR' && change24h > 5) conflicts.push({ type: 'COIN_VS_BEAR_REGIME', severity: 'HIGH', note: `Coin +${change24h.toFixed(1)}% while market BEAR = suspect dead cat` });
    if (regime === 'BULL' && change24h < -5) conflicts.push({ type: 'COIN_VS_BULL_REGIME', severity: 'MEDIUM', note: 'Underperforming in bull market' });

    // Conflict 3: Volume vs Price
    const vt = 0; // Will be assessed separately
    if (change24h > 8 && lwRatio < 0.20) conflicts.push({ type: 'PUMP_NO_WICK', severity: 'HIGH', note: 'Sharp pump without wick = potential fake / manipulation' });

    // Conflict 4: F&G vs price direction
    if (fgValue >= 75 && change24h < -3) conflicts.push({ type: 'FG_PRICE_CONFLICT', severity: 'MEDIUM', note: 'Greed market but price falling' });
    if (fgValue <= 20 && change24h > 8) conflicts.push({ type: 'FEAR_PUMP', severity: 'HIGH', note: 'Extreme fear + pump = suspicious / low conviction' });

    const highConflicts = conflicts.filter(c => c.severity === 'HIGH').length;
    const medConflicts = conflicts.filter(c => c.severity === 'MEDIUM').length;

    let level, action;
    if (highConflicts >= 2 || highConflicts + medConflicts >= 3) {
      level = 'HIGH'; action = 'REJECT';
    } else if (highConflicts >= 1 || medConflicts >= 2) {
      level = 'MEDIUM'; action = 'WAIT';
    } else {
      level = 'LOW'; action = 'PROCEED';
    }

    return { conflicts, highConflicts, medConflicts, level, action };
  }

  // ═══════════════════════════════════════════════════════════
  // 5. ADAPTIVE SCORING ENGINE
  // ═══════════════════════════════════════════════════════════
  function adaptiveScore(coin, btcCh24h, btcCh7d, fgValue, weights, preImpulse, sm, mtfScore, patScore, rr1, freshBonus) {
    const { price, vol24h, change24h, high, low, open, change7d, change30d, ath } = coin;
    const range = Math.max(high - low, price * 0.01);
    const rangePos = (price - low) / range;
    const lw = Math.min(price, open) - low;
    const lwRatio = lw / range;
    const bodyRatio = Math.abs(price - open) / range;
    const fromATH = ath > 0 ? ((price - ath) / ath * 100) : 0;
    const rs7d = (change7d || 0) - btcCh7d;
    const vt = vol24h >= 500e6 ? 5 : vol24h >= 100e6 ? 4 : vol24h >= 30e6 ? 3 : vol24h >= 10e6 ? 2 : vol24h >= 2e6 ? 1 : 0;
    const flat = Math.abs(change24h) <= 3;
    const down = change24h < -3 && change24h > -10;
    const sslSweep = lwRatio > 0.40 && rangePos < 0.50;
    const choch = change24h > 3 && change24h < 12 && rangePos > 0.55;

    // RAW COMPONENT SCORES (0-100 each)
    // Momentum component
    let mom = 0;
    if (rs7d > 15 && flat) mom = 90;
    else if (rs7d > 8 && change24h >= 0) mom = 80;
    else if (rs7d > 3 && change24h >= 0) mom = 65;
    else if (rs7d > 0 && btcCh7d < 0) mom = 70;
    else if (rs7d >= -3 && change24h >= 0) mom = 55;
    else if (change24h > 3) mom = 50;
    else if (rs7d < -10) mom = 20;
    else mom = 35;
    if (fgValue <= 25) mom = Math.min(100, mom + 10);

    // Smart Money component
    const smComp = sm.valid ? Math.min(100, 50 + sm.smScore * 1.2) : Math.min(40, sm.smScore);

    // Structure component
    let struct = 0;
    if (sslSweep && choch) struct = 90;
    else if (sslSweep && change24h > 1) struct = 80;
    else if (choch) struct = 75;
    else if (change24h > 5 && rangePos > 0.65) struct = 65;
    else if (sslSweep) struct = 60;
    else if ((change7d || 0) > 3 && (change30d || 0) < -15) struct = 55;
    else if (flat && vt >= 2) struct = 50;
    else if (rangePos < 0.35) struct = 40;
    else struct = 25;
    if (rs7d > 8) struct = Math.min(100, struct + 15);
    else if (rs7d > 3) struct = Math.min(100, struct + 8);

    // Market component
    let market = 0;
    const inGolden = fromATH <= -55 && fromATH >= -80;
    const deep = fromATH <= -80 && fromATH >= -97;
    const norm = fromATH <= -30 && fromATH >= -55;
    if (inGolden && rangePos < 0.50) market = 90;
    else if (deep && rangePos < 0.45) market = 85;
    else if (inGolden) market = 75;
    else if (deep) market = 70;
    else if (norm && rangePos < 0.40) market = 65;
    else if (norm) market = 55;
    else if (rangePos < 0.30) market = 45;
    else market = 30;
    if (fgValue <= 25) market = Math.min(100, market + 10);
    // RR bonus for market score
    if (rr1 >= 8) market = Math.min(100, market + 10);
    else if (rr1 >= 5) market = Math.min(100, market + 5);

    // Pre-Impulse component
    const piComp = preImpulse.valid ? Math.min(100, 40 + preImpulse.piScore * 1.5) : Math.min(35, preImpulse.piScore);

    // Apply adaptive weights
    const totalW = weights.momentum + weights.smartMoney + weights.structure + weights.market + weights.preImpulse;
    const weighted =
      (mom * weights.momentum +
       smComp * weights.smartMoney +
       struct * weights.structure +
       market * weights.market +
       piComp * weights.preImpulse) / totalW;

    // Bonuses/Penalties
    const patAdj = patScore === 10 ? 5 : patScore > 0 ? 2 : patScore < 0 ? -8 : 0;
    const mtfAdj = mtfScore >= 8 ? 5 : mtfScore >= 3 ? 2 : mtfScore < -5 ? -10 : -2;
    const fresh = freshBonus || 0;

    const finalScore = Math.max(0, Math.min(100, Math.round(weighted + patAdj + mtfAdj + fresh)));

    // Confidence
    const smConf = sm.strong >= 2 ? 15 : sm.valid ? 8 : -15;
    const piConf = preImpulse.count >= 4 ? 15 : preImpulse.count >= 3 ? 8 : -10;
    const mtfConf = mtfScore >= 8 ? 10 : mtfScore >= 3 ? 5 : mtfScore < -5 ? -15 : -3;
    const rrConf = rr1 >= 8 ? 10 : rr1 >= 5 ? 5 : rr1 >= 3 ? 0 : -15;
    const patConf = patScore === 10 ? 8 : patScore < 0 ? -10 : 0;
    const confidence = Math.max(0, Math.min(100, Math.round((weighted * 0.8) + smConf + piConf + mtfConf + rrConf + patConf + fresh)));

    return { finalScore, confidence, components: { mom, smComp, struct, market, piComp }, fromATH };
  }

  // ═══════════════════════════════════════════════════════════
  // 6. ENTRY CONFIRMATION
  // ═══════════════════════════════════════════════════════════
  function checkConfirmation(change24h, lwRatio, bodyRatio, rangePos, vol24h) {
    const cs = [];
    const vt = vol24h >= 100e6 ? 3 : vol24h >= 30e6 ? 2 : vol24h >= 5e6 ? 1 : 0;
    if (lwRatio > 0.40 && bodyRatio < 0.25) cs.push('REJECTION (wick ' + (lwRatio * 100).toFixed(0) + '%)');
    if (vt >= 2 && (change24h > 0.3 || Math.abs(change24h) < 2)) cs.push('VOLUME_SPIKE ($' + (vol24h / 1e6).toFixed(0) + 'M)');
    if (change24h > 2.5 && change24h < 12 && rangePos > 0.55) cs.push('MICRO_BOS (+' + change24h.toFixed(1) + '%)');
    if (lwRatio > 0.30 && change24h > 0.3 && rangePos > 0.45) cs.push('SWEEP_RECOVERY');
    return { confirmations: cs, count: cs.length, valid: cs.length >= 2, needs: Math.max(0, 2 - cs.length) };
  }

  // ═══════════════════════════════════════════════════════════
  // 7. PATTERN DETECTOR
  // ═══════════════════════════════════════════════════════════
  function detectPattern(price, high, low, open, change24h, change7d, change30d, vol24h, rangePos, lwRatio, bodyRatio) {
    if (change24h < -8) return { name: 'Breakdown', status: 'CONFIRMED', patScore: -10, bullish: false, desc: `Breakdown ${change24h.toFixed(1)}%` };
    const pats = [];
    if (lwRatio > 0.45 && rangePos < 0.45 && (change7d || 0) >= -6 && (change7d || 0) <= 10)
      pats.push({ name: 'Double Bottom', status: lwRatio > 0.55 ? 'CONFIRMED' : 'FORMING', patScore: lwRatio > 0.55 ? 10 : 4, bullish: true, desc: `DB ${lwRatio > 0.55 ? 'confirmed' : 'forming'}` });
    if (lwRatio > 0.50 && change24h > 1 && (change7d || 0) > 2 && (change7d || 0) < 15)
      pats.push({ name: 'Inv H&S', status: lwRatio > 0.60 && change24h > 3 ? 'CONFIRMED' : 'FORMING', patScore: lwRatio > 0.60 && change24h > 3 ? 10 : 4, bullish: true, desc: `IH&S ${lwRatio > 0.60 ? 'confirmed' : 'forming'}` });
    if ((change7d || 0) > 5 && rangePos > 0.55 && vol24h > 10e6)
      pats.push({ name: 'Ascending Base', status: change24h > 2 && rangePos > 0.70 ? 'CONFIRMED' : 'FORMING', patScore: change24h > 2 ? 10 : 4, bullish: true, desc: `Base ${change24h > 2 ? 'breakout' : 'forming'}` });
    if ((change7d || 0) > 8 && change24h >= -3 && change24h <= 2 && rangePos > 0.40 && lwRatio > 0.25)
      pats.push({ name: 'Breakout Retest', status: lwRatio > 0.30 && change24h >= -1 ? 'CONFIRMED' : 'FORMING', patScore: lwRatio > 0.30 ? 10 : 4, bullish: true, desc: `Retest ${lwRatio > 0.30 ? 'holding' : 'forming'}` });
    if (!pats.length) return { name: 'None', status: 'NONE', patScore: 0, bullish: false, desc: 'No pattern' };
    return pats.sort((a, b) => b.patScore - a.patScore)[0];
  }

  // ═══════════════════════════════════════════════════════════
  // 8. TRADE STATE MACHINE
  // ═══════════════════════════════════════════════════════════
  function getState(sym, price, entLo, entHi, sl, tp1, tp2, tp3, score, tier, actCnt) {
    const now = Date.now();
    const ex = TRADE_STORE.get(sym);
    const EXPIRY = 72 * 3600 * 1000;

    if (ex) {
      const s = ex.state;
      if (s === 'IN_ZONE' || s === 'TRIGGERED' || s === 'ACTIVE') {
        if (price <= ex.sl * 0.999) {
          const pnl = ex.ep > 0 ? +((price - ex.ep) / ex.ep * 100).toFixed(2) : 0;
          TRADE_STORE.set(sym, { ...ex, state: 'INVALID', closed: now, pnl });
          return { state: 'INVALID', tag: 'INVALID ❌ SL HIT', active: false, pnl };
        }
        if (price >= ex.tp1 * 0.998) {
          const pnl = +((ex.tp1 - ex.ep) / ex.ep * 100).toFixed(2);
          TRADE_STORE.set(sym, { ...ex, state: 'COMPLETED', closed: now, pnl });
          return { state: 'COMPLETED', tag: `COMPLETED ✅ +${pnl}%`, active: false, pnl };
        }
        const pnl = ex.ep > 0 ? +((price - ex.ep) / ex.ep * 100).toFixed(2) : 0;
        return { state: s, tag: `${s} 🟢 PnL:${pnl >= 0 ? '+' : ''}${pnl}%`, active: true, ep: ex.ep, pnl, sl: ex.sl, tp1: ex.tp1, tp2: ex.tp2, tp3: ex.tp3, tier: ex.tier };
      }
      if (s === 'READY' && now - (ex.st || now) > EXPIRY) {
        TRADE_STORE.set(sym, { ...ex, state: 'EXPIRED' });
        return { state: 'EXPIRED', tag: 'EXPIRED ⏰', active: false };
      }
    }

    if (actCnt >= MAX_ACTIVE) return { state: 'READY', tag: 'READY — Max 3 active', active: false, blocked: true };
    if (price >= entLo * 0.999 && price <= entHi * 1.01) {
      TRADE_STORE.set(sym, { state: 'IN_ZONE', ep: price, et: now, st: now, sl, tp1, tp2, tp3, score, tier });
      return { state: 'IN_ZONE', tag: 'IN_ZONE ⚡ CONFIRM THEN ENTER', active: true, ep: price };
    }
    if (!ex || ex.state === 'EXPIRED') TRADE_STORE.set(sym, { state: 'READY', st: now, sl, tp1, tp2, tp3, score, tier });
    const d = (entLo - price) / price;
    return { state: 'READY', tag: `READY — ${d <= 0 ? 'AT ZONE ✅' : d < 0.02 ? 'NEAR 2%' : d < 0.05 ? 'NEAR 5%' : 'WAITING'}`, active: false };
  }

  // MTF checker
  function checkMTF(change24h, change7d, change30d, rangePos) {
    const htf = (change7d || 0) > 2 && (change30d || 0) > -45 ? 'BULLISH' : (change7d || 0) < -10 || (change30d || 0) < -55 ? 'BEARISH' : 'NEUTRAL';
    const ltf = change24h > 0.5 && rangePos > 0.45 ? 'BULLISH' : change24h < -5 && rangePos < 0.40 ? 'BEARISH' : 'NEUTRAL';
    if (htf === 'BULLISH' && ltf === 'BULLISH') return { htf, ltf, label: 'ALIGNED ✅', score: 10, note: 'Both TFs bullish' };
    if (htf === 'BULLISH' && ltf === 'NEUTRAL') return { htf, ltf, label: 'PARTIAL ⚠️', score: 5, note: 'HTF bull, LTF neutral' };
    if (htf === 'BEARISH' && ltf === 'BULLISH') return { htf, ltf, label: 'CONFLICT ❌', score: -15, note: 'HTF bear vs LTF bull = dead cat' };
    if (htf === 'BEARISH') return { htf, ltf, label: 'BEARISH ❌', score: -20, note: 'HTF bearish — reject long' };
    return { htf, ltf, label: 'NEUTRAL ⚖️', score: 0, note: 'Neutral alignment' };
  }

  // ═══════════════════════════════════════════════════════════
  // MAIN HANDLER
  // ═══════════════════════════════════════════════════════════
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
    const cycleBonus = dsh < 365 ? 3 : dsh < 547 ? 2 : dsh < 730 ? 0 : -2;
    const cyclePhase = dsh < 365 ? 'Bull Early ✅' : dsh < 547 ? 'Bull Peak ⚠️' : dsh < 730 ? 'Distribution ⚠️' : 'Bear/Accum';

    const regime = detectRegimeAndWeights(btcCh7, btcCh24, btcDom, fgV, btcTrend);

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

    const killed = { KILL_SWITCH: 0, HARD: 0, SM: 0, PI: 0, CONFLICT: 0, MTF: 0, SCORE: 0, STALE: 0 };
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

      // Protect active trades
      const ex = TRADE_STORE.get(sym);
      if (ex && (ex.state === 'IN_ZONE' || ex.state === 'TRIGGERED' || ex.state === 'ACTIVE')) {
        if (price <= ex.sl * 0.999) {
          TRADE_STORE.set(sym, { ...ex, state: 'INVALID', closed: Date.now() });
          continue;
        }
        const pnl = ex.ep > 0 ? +((price - ex.ep) / ex.ep * 100).toFixed(2) : 0;
        const pat = detectPattern(price, coin.high, coin.low, coin.open, change24h, change7d, change30d, vol24h, rangePos, lwRatio, bodyRatio);
        actives.push({ symbol: sym, price, status: ex.state, tag: ex.state + ' 🟢 PnL:' + (pnl >= 0 ? '+' : '') + pnl + '%', tier: ex.tier || 'A', ep: ex.ep, pnl, sl: ex.sl, tp1: ex.tp1, tp2: ex.tp2, tp3: ex.tp3, change24h: +change24h.toFixed(2), pattern: pat });
        continue;
      }

      // KILL SWITCH
      if (regime.killSwitch) { killed.KILL_SWITCH++; continue; }

      // Pre-Impulse check
      const pi = detectPreImpulse(price, coin.high, coin.low, coin.open, change24h, change7d, vol24h, rangePos, lwRatio, bodyRatio);

      // Zones
      const slP = Math.max(price * (1 - 0.09 - 0.03), coin.low * 0.96);
      let tp1, tp2, tp3;
      if (ath > 0 && fromATH < -25) {
        const d = ath - price;
        tp1 = Math.min(price + d * 0.382, price * 3);
        tp2 = Math.min(price + d * 0.618, price * 6);
        tp3 = Math.min(price + d, price * 10);
      } else {
        const sl = price - slP;
        tp1 = price + sl * 3; tp2 = price + sl * 5; tp3 = price + sl * 8;
      }
      const slDist = Math.max(price - slP, price * 0.005);
      const rr1 = +((tp1 - price) / slDist).toFixed(2);
      const rr2 = +((tp2 - price) / slDist).toFixed(2);
      const rr3 = +((tp3 - price) / slDist).toFixed(2);
      const entOpt = price * 0.999;

      // Hard filter
      const hf = hardFilter(price, entOpt, slP, rr1, change24h, vt, regime.regime, pi.alreadyPumped);
      if (!hf.pass) { killed.HARD++; continue; }

      // SM Validation
      const sm = validateSM(price, coin.high, coin.low, coin.open, change24h, change7d, vol24h, rangePos, lwRatio, bodyRatio);
      if (!sm.valid) { killed.SM++; continue; }

      // Pre-Impulse gate
      if (!pi.valid) { killed.PI++; continue; }

      // MTF
      const mtf = checkMTF(change24h, change7d, change30d, rangePos);
      if (mtf.score < -8) { killed.MTF++; continue; }

      // Conflict Engine
      const conf = detectConflicts(change24h, change7d, change30d, rangePos, lwRatio, regime.regime, btcCh7, fgV);
      if (conf.action === 'REJECT') { killed.CONFLICT++; continue; }

      // Pattern
      const pat = detectPattern(price, coin.high, coin.low, coin.open, change24h, change7d, change30d, vol24h, rangePos, lwRatio, bodyRatio);

      // Freshness
      const now = Date.now();
      const fts = SETUP_TS.get(sym);
      if (!fts) SETUP_TS.set(sym, { t: now, vol: vol24h });
      const ageH = fts ? (now - fts.t) / 3600000 : 0;
      const volFaded = fts && vol24h < fts.vol * 0.45;
      const fresh = ageH < 4 && !volFaded;
      const aging = !fresh && ageH < 48 && !volFaded;
      if (!fresh && !aging) { SETUP_TS.delete(sym); killed.STALE++; continue; }
      const freshBonus = fresh ? 3 : 0;

      // Score
      const sc = adaptiveScore(coin, btcCh24, btcCh7, fgV, regime.weights, pi, sm, mtf.score, pat.patScore, rr1, freshBonus);

      // Bear regime: require higher bar
      const bearPenalty = regime.regime === 'BEAR' ? -10 : 0;
      const finalScore = Math.max(0, Math.min(100, sc.finalScore + bearPenalty + regime.regimeBonus));
      const finalConf = Math.max(0, Math.min(100, sc.confidence + (regime.regime === 'BEAR' ? -8 : 0)));

      // THRESHOLDS
      if (finalScore < 80) { killed.SCORE++; continue; }
      if (finalConf < 85) { killed.SCORE++; continue; }

      // Entry confirmation
      const ec = checkConfirmation(change24h, lwRatio, bodyRatio, rangePos, vol24h);

      // Quality grade
      const allPerfect = sm.strong >= 2 && ec.valid && mtf.score >= 5 && rr1 >= 5 && pi.count >= 4;
      const allGood = sm.valid && mtf.score >= 0 && rr1 >= 3 && pi.valid;
      const quality = allPerfect ? { grade: 'A+', label: 'A+ SNIPER 🎯', take: true, note: 'All confluences perfect.' } :
        allGood ? { grade: 'A', label: 'A QUALITY ✅', take: true, note: 'Strong setup, proceed.' } :
        { grade: 'B', label: 'B — SKIP ⚠️', take: false, note: 'Missing key confirmations.' };
      if (!quality.take) { killed.SCORE++; continue; }

      const tier = finalScore >= 87 ? 'S' : finalScore >= 80 ? 'A' : null;
      if (!tier) { killed.SCORE++; continue; }

      // Trade state
      const entLo = Math.max(price * 0.98, coin.low * 0.99);
      const entHi = price * 1.01;
      const ts = getState(sym, price, entLo, entHi, slP, tp1, tp2, tp3, finalScore, tier, actCnt);

      // Dominant edge
      const comps = sc.components;
      const wts = regime.weights;
      const edgeScores = [
        { name: 'Pre-Impulse', score: comps.piComp * wts.preImpulse },
        { name: 'Smart Money', score: comps.smComp * wts.smartMoney },
        { name: 'Momentum', score: comps.mom * wts.momentum },
        { name: 'Market', score: comps.market * wts.market },
        { name: 'Structure', score: comps.struct * wts.structure },
      ];
      const dominantEdge = edgeScores.sort((a, b) => b.score - a.score)[0].name;

      // Pre-impulse timing
      const piTiming = pi.count >= 4 ? 'READY 🔥' : pi.count === 3 ? 'EARLY 📈' : 'FORMING';

      // Conflict level for output
      const conflictLevel = conf.level;

      // Final decision
      let decision, decColor;
      if (ts.state === 'IN_ZONE' && ec.valid && quality.take && conf.action !== 'WAIT') {
        decision = 'EXECUTE ✅'; decColor = '#ff6b35';
      } else if (conf.action === 'WAIT' || !ec.valid) {
        decision = 'WAIT ⏳ — ' + (conf.action === 'WAIT' ? 'Conflict MEDIUM' : 'Need ' + ec.needs + ' more confirmation'); decColor = 'var(--amber)';
      } else if (ts.blocked) {
        decision = 'WAIT ⏳ — Max 3 trades active'; decColor = 'var(--amber)';
      } else if (quality.take) {
        decision = 'LIMIT ORDER ✅ — Set at ' + fmtP(entLo) + '–' + fmtP(entHi); decColor = 'var(--g)';
      } else {
        decision = 'REJECT ❌'; decColor = 'var(--red)';
      }

      const reasons = [];
      sm.signals.forEach(s => reasons.push(s.type.replace(/_/g, ' ') + ' (' + s.strength + '): ' + s.note));
      pi.signals.slice(0, 2).forEach(s => reasons.push('PI → ' + s.signal.replace(/_/g, ' ') + ': ' + s.note));
      if (fromATH < -40) reasons.push(fromATH.toFixed(0) + '% from ATH — deep value');
      if (pat.status === 'CONFIRMED') reasons.push(pat.name + ' CONFIRMED: ' + pat.desc);

      outputs.push({
        rank: 0, symbol: sym, name: coin.cgName || sym,
        price, change24h: +change24h.toFixed(2), change7d: +(change7d || 0).toFixed(2),
        vol24h, fromATH: sc.fromATH !== 0 ? +sc.fromATH.toFixed(1) : null,
        tier, tierLabel: tier === 'S' ? '🔥 TIER S — SNIPER' : '✅ TIER A',
        finalScore, confidence: finalConf,
        dominantEdge, quality,
        regime: { regime: regime.regime, focus: regime.focus, color: regime.color },
        preImpulse: { ...pi, timing: piTiming },
        smDetection: { count: sm.count, valid: sm.valid, strong: sm.strong, signals: sm.signals },
        entryConfirmation: ec,
        conflict: conf,
        mtf: { htf: mtf.htf, ltf: mtf.ltf, label: mtf.label },
        pattern: pat,
        freshness: { fresh, aging, status: fresh ? 'FRESH 🟢' : 'AGING 🟡' },
        tradeState: ts, status: ts.state,
        entryZone: { lo: +entLo.toFixed(8), optimal: +entOpt.toFixed(8), hi: +entHi.toFixed(8) },
        stopLoss: { price: +slP.toFixed(8), pct: +((slP - price) / price * 100).toFixed(1) },
        targets: {
          tp1: { price: +tp1.toFixed(8), pct: +((tp1 - price) / price * 100).toFixed(1), rr: rr1, label: ath > 0 ? 'Fib 38.2%' : 'TP1' },
          tp2: { price: +tp2.toFixed(8), pct: +((tp2 - price) / price * 100).toFixed(1), rr: rr2, label: ath > 0 ? 'Fib 61.8%' : 'TP2' },
          tp3: { price: +tp3.toFixed(8), pct: +((tp3 - price) / price * 100).toFixed(1), rr: rr3, label: ath > 0 ? 'ATH area' : 'TP3' },
        },
        weightComponents: { mom: comps.mom, sm: comps.smComp, struct: comps.struct, market: comps.market, pi: comps.piComp },
        weights: regime.weights,
        conflictLevel,
        decision, decisionColor: decColor,
        reasons: reasons.slice(0, 5),
        positionSize: quality.grade === 'A+' ? '2-3% capital' : '1-2% capital',
      });
    }

    outputs.sort((a, b) => b.finalScore - a.finalScore || b.confidence - a.confidence);
    outputs.forEach((r, i) => r.rank = i + 1);
    const tierS = outputs.filter(r => r.tier === 'S').slice(0, 5);
    const tierA = outputs.filter(r => r.tier === 'A').slice(0, 8);
    const totalKilled = Object.values(killed).reduce((a, b) => a + b, 0);

    res.setHeader('Cache-Control', 's-maxage=60');
    return res.status(200).json({
      timestamp: Date.now(),
      scanTime: ((Date.now() - t0) / 1000).toFixed(1),
      totalScanned: candidates.length,
      totalQualified: outputs.length,
      totalActive: actives.length,
      totalKilled,
      killedBreakdown: killed,
      tierGroups: { S: tierS, A: tierA },
      activeTrades: actives,
      regime,
      weights: regime.weights,
      systemStatus: {
        activeTradeCount: actCnt, maxAllowed: MAX_ACTIVE, canTakeNew: actCnt < MAX_ACTIVE,
        cyclePhase, btcTrend, fgValue: fgV, btcDom, btcCh7, btcCh24,
        principle: 'Tolak sebanyak mungkin. Eksekusi sesedikit mungkin. Filter, bukan generator.',
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
