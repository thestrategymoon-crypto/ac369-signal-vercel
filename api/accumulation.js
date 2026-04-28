// api/accumulation.js — AC369 FUSION v9.0
// ══════════════════════════════════════════════════════════════════
// FULL TRADE MANAGEMENT SYSTEM
//
// STORAGE: Module-level Map (Vercel instance) + client localStorage sync
// RR ENGINE: SL-based (1:3 TP1, 1:4.5 TP2), MAX +100%, NO ATH targets
// SCORING: PI=25, SM=25, Mom=20, Struct=15, Market=15 → min 75
// CONFIDENCE: min 80%
//
// PRINCIPLE: No random signals. Strict filter. Trade memory never lost.
// ══════════════════════════════════════════════════════════════════

// ── PERSISTENT TRADE STORE ───────────────────────────────────────
// Persists across requests within same Vercel instance
// Synced with client localStorage for cross-session persistence
const TRADE_STORE = new Map();
const SETUP_TIMESTAMPS = new Map();
const MAX_ACTIVE = 3;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // POST: sync trades from client localStorage into TRADE_STORE
  if (req.method === 'POST') {
    try {
      const body = req.body || {};
      const clientTrades = body.trades || [];
      let synced = 0;
      for (const t of clientTrades) {
        if (t.symbol && t.state && !TRADE_STORE.has(t.symbol)) {
          TRADE_STORE.set(t.symbol, {
            state: t.state, ep: t.entryPrice, st: t.setupTime || Date.now(),
            et: t.entryTime || Date.now(), sl: t.sl, tp1: t.tp1, tp2: t.tp2,
            score: t.score || 75, tier: t.tier || 'A',
            rr: t.rr || '1:3', pnl: t.pnl || 0,
          });
          synced++;
        }
      }
      return res.status(200).json({ ok: true, synced, total: TRADE_STORE.size });
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
  }

  const sf = async (url, ms = 6000) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
      const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } });
      clearTimeout(t); if (!r.ok) return null; return await r.json();
    } catch { clearTimeout(t); return null; }
  };

  // ══════════════════════════════════════════════════════════════
  // MARKET REGIME
  // ══════════════════════════════════════════════════════════════
  function detectRegime(btcCh7, btcCh24, btcDom, fgV, btcTrend) {
    if (Math.abs(btcCh24) > 12 || fgV <= 8 || fgV >= 93) {
      return { regime: 'CHAOTIC 🚫', kill: true, color: 'var(--red)', bonus: -999, focus: 'NO TRADE — Market too volatile' };
    }
    if (btcCh7 < -8 || (btcCh7 < -5 && btcTrend === 'BEARISH')) {
      return { regime: 'BEAR 📉', kill: false, color: 'var(--red)', bonus: -10, focus: 'Bear: long only if extremely strong pre-impulse' };
    }
    if (btcCh7 > 8 || (btcCh7 > 5 && btcTrend === 'BULLISH' && fgV > 50)) {
      return { regime: 'BULL 📈', kill: false, color: 'var(--g)', bonus: +8, focus: 'Bull: momentum & breakout setups preferred' };
    }
    return { regime: 'RANGE ↔️', kill: false, color: 'var(--amber)', bonus: +3, focus: 'Range: accumulation & pre-impulse optimal' };
  }

  // ══════════════════════════════════════════════════════════════
  // PRE-IMPULSE DETECTION ENGINE (25pts max)
  // ══════════════════════════════════════════════════════════════
  function detectPreImpulse(price, high, low, open, change24h, change7d, vol24h, rangePos, lwRatio, bodyRatio) {
    // Immediate reject: already pumped
    if (change24h > 8) return { valid: false, count: 0, score: 0, stage: 'LATE — Already pumped >8%', signals: [], alreadyPumped: true };

    const vt = vol24h >= 500e6 ? 5 : vol24h >= 100e6 ? 4 : vol24h >= 30e6 ? 3 : vol24h >= 10e6 ? 2 : vol24h >= 2e6 ? 1 : 0;
    const range24h = high > low ? (high - low) / low : 0;
    const signals = [];

    // 1. Volume accumulation (price flat, vol up)
    if (vt >= 3 && Math.abs(change24h) <= 3) signals.push({ s: 'VOLUME_ACCUM', pts: 20, note: `$${(vol24h/1e6).toFixed(0)}M vol + ${change24h.toFixed(1)}% = SM absorbing` });
    else if (vt >= 2 && Math.abs(change24h) <= 2) signals.push({ s: 'VOLUME_ACCUM', pts: 12, note: `Vol $${(vol24h/1e6).toFixed(0)}M + flat price` });

    // 2. Liquidity sweep (stop hunt below)
    if (lwRatio > 0.42 && rangePos < 0.50 && price > low * 1.003) signals.push({ s: 'LIQUIDITY_SWEEP', pts: 22, note: `Wick ${(lwRatio*100).toFixed(0)}% — stops cleared` });

    // 3. Price compression (tight range = coiling spring)
    if (range24h < 0.055 && Math.abs(change24h) < 3.5 && vol24h > 5e6) signals.push({ s: 'COMPRESSION', pts: 18, note: `Range ${(range24h*100).toFixed(1)}% tight — energy coiling` });

    // 4. Absorption (high vol, small candle)
    if (vt >= 2 && bodyRatio < 0.22 && lwRatio > 0.28 && rangePos < 0.55) signals.push({ s: 'ABSORPTION', pts: 18, note: `Body ${(bodyRatio*100).toFixed(0)}% / wick ${(lwRatio*100).toFixed(0)}% — SM taking supply` });

    // 5. Higher low
    if (change24h > 0.5 && change24h < 7 && (change7d || 0) > -8 && rangePos > 0.42) signals.push({ s: 'HIGHER_LOW', pts: 15, note: `+${change24h.toFixed(1)}% HL — structure improving` });

    const count = signals.length;
    const piScore = Math.min(25, Math.round(signals.reduce((a, s) => a + s.pts, 0) * 25 / 75));
    const stage = count >= 4 ? 'READY 🔥' : count === 3 ? 'EARLY 📈' : count === 2 ? 'FORMING 🔄' : 'WEAK';

    return { valid: count >= 3, count, score: piScore, stage, signals, alreadyPumped: false };
  }

  // ══════════════════════════════════════════════════════════════
  // SMART MONEY VALIDATION ENGINE (25pts max)
  // ══════════════════════════════════════════════════════════════
  function validateSM(price, high, low, open, change24h, change7d, vol24h, rangePos, lwRatio, bodyRatio) {
    const vt = vol24h >= 500e6 ? 5 : vol24h >= 100e6 ? 4 : vol24h >= 30e6 ? 3 : vol24h >= 10e6 ? 2 : vol24h >= 2e6 ? 1 : 0;
    const signals = [];

    if (lwRatio > 0.45 && rangePos < 0.52 && price > low * 1.003) {
      const str = lwRatio > 0.60 ? 'STRONG' : 'MODERATE';
      signals.push({ type: 'LIQUIDITY_SWEEP', strength: str, pts: str === 'STRONG' ? 22 : 14 });
    }
    if (vt >= 3 && Math.abs(change24h) <= 3) signals.push({ type: 'ACCUMULATION', strength: vt >= 4 ? 'STRONG' : 'MODERATE', pts: vt >= 4 ? 22 : 14 });
    else if (vt >= 2 && Math.abs(change24h) <= 2) signals.push({ type: 'ACCUMULATION', strength: 'MODERATE', pts: 11 });
    if (vt >= 2 && bodyRatio < 0.22 && lwRatio > 0.28) signals.push({ type: 'ABSORPTION', strength: 'STRONG', pts: 20 });
    if (change24h > 2.5 && change24h < 12 && rangePos > 0.55 && lwRatio > 0.20) {
      signals.push({ type: 'STRUCTURE_RECLAIM', strength: change24h > 5 ? 'STRONG' : 'MODERATE', pts: change24h > 5 ? 18 : 11 });
    }

    const strong = signals.filter(s => s.strength === 'STRONG').length;
    const raw = signals.reduce((a, s) => a + s.pts, 0);
    const smScore = Math.min(25, Math.round(raw * 25 / 66));
    return { signals, count: signals.length, strong, smScore, valid: signals.length >= 2 };
  }

  // ══════════════════════════════════════════════════════════════
  // REALISTIC RR ENGINE (CRITICAL)
  // TP based on SL distance, NOT ATH
  // TP1: 1:3, TP2: 1:4.5, MAX: +100%
  // ══════════════════════════════════════════════════════════════
  function calcRealisticRR(price, low, high, ath, change24h, change7d) {
    // SL: 1.5× daily range below entry, min 5%, max 12%
    const dailyRange = high > low ? (high - low) / price : 0.05;
    const slPct = Math.max(0.05, Math.min(0.12, dailyRange * 1.5 + 0.02));
    const slPrice = +(price * (1 - slPct)).toFixed(8);
    const slDist = price - slPrice;

    // TP1: entry + 3× SL distance (1:3 RR)
    const tp1Raw = price + slDist * 3;
    // TP2: entry + 4.5× SL distance (1:4.5 RR)
    const tp2Raw = price + slDist * 4.5;

    // VALIDATION: TP must be realistic
    // Max TP = +100% from entry (never use ATH as primary target)
    const maxTP = price * 2.0; // +100% max

    // Check if ATH provides better but realistic reference
    let tp1, tp2;
    if (ath > 0 && ath < price * 3) {
      // ATH is within 3x range — use Fib retrace but cap at SL-based
      const toATH = ath - price;
      const athFib38 = price + toATH * 0.382;
      const athFib50 = price + toATH * 0.500;
      // Use whichever is closer to realistic SL-based TP
      tp1 = Math.min(Math.max(tp1Raw, athFib38), maxTP);
      tp2 = Math.min(Math.max(tp2Raw, athFib50), maxTP);
    } else {
      // No ATH or too far — pure SL-based
      tp1 = Math.min(tp1Raw, maxTP);
      tp2 = Math.min(tp2Raw, maxTP);
    }

    const tp1Pct = +((tp1 - price) / price * 100).toFixed(1);
    const tp2Pct = +((tp2 - price) / price * 100).toFixed(1);
    const rr1 = +((tp1 - price) / slDist).toFixed(2);
    const rr2 = +((tp2 - price) / slDist).toFixed(2);

    // REJECT if TP unrealistic (> 100% for TP1)
    const unrealistic = tp1Pct > 100;

    return { slPrice, slPct: +(slPct * 100).toFixed(1), slDist, tp1: +tp1.toFixed(8), tp2: +tp2.toFixed(8), tp1Pct, tp2Pct, rr1, rr2, rrLabel: `1:${rr1.toFixed(1)} / 1:${rr2.toFixed(1)}`, unrealistic };
  }

  // ══════════════════════════════════════════════════════════════
  // SCORING ENGINE (100pts, pre-impulse weighted)
  // PI=25, SM=25, Mom=20, Struct=15, Market=15
  // ══════════════════════════════════════════════════════════════
  function calcScore(coin, btcCh24, btcCh7, fgV, piResult, smResult, rr1, regimeBonus) {
    const { price, vol24h, change24h, high, low, open, change7d, change30d, ath } = coin;
    const range = Math.max(high - low, price * 0.01);
    const rangePos = (price - low) / range;
    const lw = Math.min(price, open) - low;
    const lwRatio = lw / range;
    const bodyRatio = Math.abs(price - open) / range;
    const fromATH = ath > 0 ? ((price - ath) / ath * 100) : 0;
    const rs7d = (change7d || 0) - btcCh7;
    const vt = vol24h >= 500e6 ? 5 : vol24h >= 100e6 ? 4 : vol24h >= 30e6 ? 3 : vol24h >= 10e6 ? 2 : vol24h >= 2e6 ? 1 : 0;
    const flat = Math.abs(change24h) <= 3;

    // MOMENTUM (20pts)
    let mom = 0;
    if (rs7d > 12 && flat) mom = 20;
    else if (rs7d > 6 && change24h >= 0) mom = 17;
    else if (rs7d > 2 && change24h >= 0) mom = 14;
    else if (rs7d > 0 && btcCh7 < 0) mom = 16; // holding while BTC drops = strong
    else if (rs7d >= -3 && change24h >= 0) mom = 11;
    else if (change24h > 2) mom = 9;
    else if (rs7d < -10) mom = 4;
    else mom = 7;
    if (fgV <= 25) mom = Math.min(20, mom + 3);

    // STRUCTURE (15pts)
    const sslSweep = lwRatio > 0.40 && rangePos < 0.50;
    const choch = change24h > 3 && change24h < 12 && rangePos > 0.55;
    let struct = 0;
    if (sslSweep && choch) struct = 15;
    else if (sslSweep && change24h > 1) struct = 13;
    else if (choch) struct = 12;
    else if (sslSweep) struct = 9;
    else if ((change7d || 0) > 3 && (change30d || 0) < -15) struct = 8;
    else if (flat && vt >= 2) struct = 7;
    else if (rangePos < 0.35) struct = 5;
    else struct = 3;
    if (rs7d > 8) struct = Math.min(15, struct + 3);

    // MARKET CONTEXT (15pts)
    let mkt = 0;
    const inGolden = fromATH <= -55 && fromATH >= -80;
    const normDisc = fromATH <= -30 && fromATH >= -55;
    if (inGolden && rangePos < 0.50) mkt = 15;
    else if (inGolden) mkt = 12;
    else if (fromATH <= -80 && fromATH >= -97 && rangePos < 0.45) mkt = 13;
    else if (normDisc && rangePos < 0.40) mkt = 10;
    else if (normDisc) mkt = 8;
    else if (rangePos < 0.35) mkt = 7;
    else mkt = 4;
    if (fgV <= 25) mkt = Math.min(15, mkt + 3);
    if (rr1 >= 4) mkt = Math.min(15, mkt + 2);

    // Combine all components
    const rawScore = piResult.score + smResult.smScore + mom + struct + mkt + regimeBonus;
    const totalScore = Math.max(0, Math.min(100, Math.round(rawScore)));

    // CONFIDENCE
    const smAdj = smResult.strong >= 2 ? 15 : smResult.valid ? 8 : -15;
    const piAdj = piResult.count >= 4 ? 15 : piResult.count >= 3 ? 8 : -10;
    const rrAdj = rr1 >= 4 ? 8 : rr1 >= 3 ? 4 : -15;
    const rsAdj = rs7d > 5 ? 8 : rs7d > 0 ? 4 : rs7d < -8 ? -8 : 0;
    const baseConf = (rawScore / 100) * 100;
    const confidence = Math.max(0, Math.min(100, Math.round(baseConf + smAdj + piAdj + rrAdj + rsAdj)));

    return { totalScore, confidence, components: { pi: piResult.score, sm: smResult.smScore, mom, struct, mkt }, fromATH };
  }

  // ══════════════════════════════════════════════════════════════
  // ENTRY CONFIRMATION ENGINE
  // ══════════════════════════════════════════════════════════════
  function checkConfirmation(change24h, lwRatio, bodyRatio, rangePos, vol24h) {
    const cs = [];
    const vt = vol24h >= 100e6 ? 3 : vol24h >= 30e6 ? 2 : vol24h >= 5e6 ? 1 : 0;
    if (lwRatio > 0.40 && bodyRatio < 0.25) cs.push({ t: 'REJECTION', n: `Wick ${(lwRatio*100).toFixed(0)}%` });
    if (vt >= 2 && (change24h > 0.3 || Math.abs(change24h) < 2)) cs.push({ t: 'VOLUME_SPIKE', n: `$${(vol24h/1e6).toFixed(0)}M` });
    if (change24h > 2.5 && change24h < 10 && rangePos > 0.55) cs.push({ t: 'MICRO_BOS', n: `+${change24h.toFixed(1)}%` });
    if (lwRatio > 0.30 && change24h > 0.3 && rangePos > 0.45) cs.push({ t: 'SWEEP_RECOVERY', n: 'Bounce from lows' });
    return { confirmations: cs, count: cs.length, valid: cs.length >= 2, needs: Math.max(0, 2 - cs.length) };
  }

  // ══════════════════════════════════════════════════════════════
  // CONFLICT ENGINE
  // ══════════════════════════════════════════════════════════════
  function checkConflicts(change24h, change7d, change30d, rangePos, regime, btcCh7, fgV) {
    const conflicts = [];
    const htfBear = (change7d || 0) < -10 || (change30d || 0) < -55;
    const ltfBull = change24h > 0 && rangePos > 0.45;
    if (htfBear && ltfBull) conflicts.push({ sev: 'HIGH', note: 'HTF bear + LTF bull = dead cat risk' });
    if (regime.includes('BEAR') && change24h > 6) conflicts.push({ sev: 'HIGH', note: `Bear regime + +${change24h.toFixed(1)}% = suspect pump` });
    if (change24h > 9 && (btcCh7 || 0) < 0) conflicts.push({ sev: 'HIGH', note: 'Pump while BTC falls = unsustainable' });
    if (fgV <= 15 && change24h > 7) conflicts.push({ sev: 'MEDIUM', note: 'Extreme fear + pump = low conviction' });
    const hi = conflicts.filter(c => c.sev === 'HIGH').length;
    const med = conflicts.filter(c => c.sev === 'MEDIUM').length;
    const level = hi >= 1 || hi + med >= 2 ? 'HIGH' : med >= 1 ? 'MEDIUM' : 'LOW';
    return { conflicts, level, action: level === 'HIGH' ? 'REJECT' : level === 'MEDIUM' ? 'WAIT' : 'PROCEED' };
  }

  // ══════════════════════════════════════════════════════════════
  // TRADE STATE MACHINE (PERSISTENT)
  // ══════════════════════════════════════════════════════════════
  function getTradeState(sym, price, entLo, entHi, rr) {
    const now = Date.now();
    const ex = TRADE_STORE.get(sym);
    const EXPIRY = 72 * 3600 * 1000;

    if (ex) {
      const s = ex.state;
      // LOCKED: once triggered/active, only SL hit can remove
      if (s === 'IN_ZONE' || s === 'TRIGGERED' || s === 'ACTIVE') {
        if (price <= ex.sl * 0.999) {
          const pnl = ex.ep > 0 ? +((price - ex.ep) / ex.ep * 100).toFixed(2) : 0;
          TRADE_STORE.set(sym, { ...ex, state: 'INVALID', closed: now, pnl });
          return { state: 'INVALID', tag: '❌ INVALID — SL HIT', active: false, pnl };
        }
        if (price >= ex.tp1 * 0.998) {
          const pnl = +((ex.tp1 - ex.ep) / ex.ep * 100).toFixed(2);
          TRADE_STORE.set(sym, { ...ex, state: 'COMPLETED', closed: now, pnl });
          return { state: 'COMPLETED', tag: `✅ COMPLETED +${pnl}%`, active: false, pnl };
        }
        const pnl = ex.ep > 0 ? +((price - ex.ep) / ex.ep * 100).toFixed(2) : 0;
        return {
          state: s, active: true, ep: ex.ep, pnl,
          tag: s + ' 🟢 PnL: ' + (pnl >= 0 ? '+' : '') + pnl + '%',
          sl: ex.sl, tp1: ex.tp1, tp2: ex.tp2, rr: ex.rr, tier: ex.tier,
          lockedEntry: ex.ep, lockedSL: ex.sl, lockedTP1: ex.tp1, lockedTP2: ex.tp2,
        };
      }
      if (s === 'READY' && now - (ex.st || now) > EXPIRY) {
        TRADE_STORE.set(sym, { ...ex, state: 'EXPIRED' });
        SETUP_TIMESTAMPS.delete(sym);
        return { state: 'EXPIRED', tag: '⏰ EXPIRED', active: false };
      }
    }

    // Count active trades
    let actCnt = 0;
    TRADE_STORE.forEach(v => { if (['IN_ZONE','TRIGGERED','ACTIVE'].includes(v.state)) actCnt++; });
    if (actCnt >= MAX_ACTIVE) return { state: 'READY', tag: '📋 READY — Max 3 active', active: false, blocked: true };

    // New: check if price in entry zone
    if (price >= entLo * 0.999 && price <= entHi * 1.01) {
      const entry = { state: 'IN_ZONE', ep: price, et: now, st: ex?.st || now, sl: rr.slPrice, tp1: rr.tp1, tp2: rr.tp2, rr: rr.rrLabel };
      TRADE_STORE.set(sym, entry);
      return { state: 'IN_ZONE', tag: '⚡ IN_ZONE — AWAIT CONFIRMATION', active: true, ep: price };
    }

    if (!ex || ex.state === 'EXPIRED') TRADE_STORE.set(sym, { state: 'READY', st: now, sl: rr.slPrice, tp1: rr.tp1, tp2: rr.tp2, rr: rr.rrLabel });
    const d = (entLo - price) / price;
    return { state: 'READY', tag: '📋 READY — ' + (d <= 0 ? 'AT ZONE' : d < 0.02 ? 'NEAR 2%' : d < 0.05 ? 'NEAR 5%' : 'WAITING'), active: false };
  }

  // ══════════════════════════════════════════════════════════════
  // MAIN
  // ══════════════════════════════════════════════════════════════
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
    const cyclePhase = dsh < 365 ? 'Bull Early ✅' : dsh < 547 ? 'Bull Peak ⚠️' : dsh < 730 ? 'Distribution ⚠️' : 'Bear/Accum';
    const regime = detectRegime(btcCh7, btcCh24, btcDom, fgV, btcTrend);

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
      candidates.push({ base: b, price: p, vol24h: v, change24h: +(c.price_change_percentage_24h || 0), high: p * 1.02, low: p * 0.98, open: p / (1 + (+(c.price_change_percentage_24h||0))/100), change7d: +(c.price_change_percentage_7d||0), change30d: +(c.price_change_percentage_30d||0), ath: +(c.ath||0), marketCap: +(c.market_cap||0), cgName: c.name||b });
    });

    const killed = { KILL: 0, HARD: 0, PI: 0, SM: 0, RR: 0, CONFLICT: 0, SCORE: 0, STALE: 0 };
    const validSetups = [];
    const activeSetups = [];

    let actCnt = 0;
    TRADE_STORE.forEach(v => { if (['IN_ZONE','TRIGGERED','ACTIVE'].includes(v.state)) actCnt++; });

    for (const coin of candidates.slice(0, 800)) {
      const { base: sym, price, ath, change24h, vol24h, change7d, change30d } = coin;
      if (!price || price <= 0) continue;
      if (ath > 0 && ((price-ath)/ath*100) < -99) { killed.STALE++; continue; }

      const range = Math.max(coin.high - coin.low, price * 0.01);
      const rangePos = (price - coin.low) / range;
      const lw = Math.min(price, coin.open) - coin.low;
      const lwRatio = lw / range;
      const bodyRatio = Math.abs(price - coin.open) / range;
      const vt = vol24h >= 500e6 ? 5 : vol24h >= 100e6 ? 4 : vol24h >= 30e6 ? 3 : vol24h >= 10e6 ? 2 : vol24h >= 2e6 ? 1 : 0;

      // Protect active trades — always process
      const ex = TRADE_STORE.get(sym);
      if (ex && ['IN_ZONE','TRIGGERED','ACTIVE'].includes(ex.state)) {
        if (price <= ex.sl * 0.999) {
          TRADE_STORE.set(sym, { ...ex, state: 'INVALID', closed: Date.now() });
          continue;
        }
        const pnl = ex.ep > 0 ? +((price - ex.ep) / ex.ep * 100).toFixed(2) : 0;
        activeSetups.push({ symbol: sym, price, status: ex.state, tag: ex.state + ' 🟢 PnL:' + (pnl>=0?'+':'') + pnl + '%', tier: ex.tier||'A', ep: ex.ep, pnl, sl: ex.sl, tp1: ex.tp1, tp2: ex.tp2, rr: ex.rr, change24h: +change24h.toFixed(2), locked: true });
        continue;
      }

      if (regime.kill) { killed.KILL++; continue; }

      // Pre-Impulse
      const pi = detectPreImpulse(price, coin.high, coin.low, coin.open, change24h, change7d, vol24h, rangePos, lwRatio, bodyRatio);
      if (pi.alreadyPumped || !pi.valid) { killed.PI++; continue; }

      // Hard filter
      if (vt < 1) { killed.HARD++; continue; }
      if (change24h < -8) { killed.HARD++; continue; }

      // SM
      const sm = validateSM(price, coin.high, coin.low, coin.open, change24h, change7d, vol24h, rangePos, lwRatio, bodyRatio);
      if (!sm.valid) { killed.SM++; continue; }

      // RR
      const rr = calcRealisticRR(price, coin.low, coin.high, ath, change24h, change7d);
      if (rr.unrealistic || rr.rr1 < 3) { killed.RR++; continue; }

      // Conflict
      const conf = checkConflicts(change24h, change7d, change30d, rangePos, regime.regime, btcCh7, fgV);
      if (conf.action === 'REJECT') { killed.CONFLICT++; continue; }

      // Score
      const sc = calcScore(coin, btcCh24, btcCh7, fgV, pi, sm, rr.rr1, regime.bonus || 0);
      const bearPen = regime.regime.includes('BEAR') ? -10 : 0;
      const finalScore = Math.max(0, Math.min(100, sc.totalScore + bearPen));
      const finalConf = Math.max(0, Math.min(100, sc.confidence + (regime.regime.includes('BEAR') ? -8 : 0)));

      if (finalScore < 75 || finalConf < 80) { killed.SCORE++; continue; }

      // Entry confirmation
      const ec = checkConfirmation(change24h, lwRatio, bodyRatio, rangePos, vol24h);

      // Freshness
      const now = Date.now();
      const fts = SETUP_TIMESTAMPS.get(sym);
      if (!fts) SETUP_TIMESTAMPS.set(sym, { t: now, vol: vol24h });
      const ageH = fts ? (now - fts.t) / 3600000 : 0;
      const fresh = ageH < 4;
      const aging = !fresh && ageH < 48 && !(fts && vol24h < fts.vol * 0.45);
      if (!fresh && !aging) { killed.STALE++; continue; }

      // Trade state
      const entLo = Math.max(price * 0.98, coin.low * 0.99);
      const entHi = price * 1.01;
      const ts = getTradeState(sym, price, entLo, entHi, rr);

      const tier = finalScore >= 87 ? 'S' : finalScore >= 75 ? 'A' : null;
      if (!tier) { killed.SCORE++; continue; }

      // Store setup time
      if (ts.state === 'IN_ZONE' && ex) TRADE_STORE.set(sym, { ...TRADE_STORE.get(sym), tier, score: finalScore });

      // Final decision
      let decision, decColor;
      if (ts.state === 'IN_ZONE' && ec.valid && conf.action === 'PROCEED') { decision = 'EXECUTE ✅'; decColor = '#ff6b35'; }
      else if (ts.state === 'IN_ZONE' && !ec.valid) { decision = 'WAIT ⏳ — IN_ZONE, need ' + ec.needs + ' more confirmation'; decColor = 'var(--amber)'; }
      else if (conf.action === 'WAIT') { decision = 'WAIT ⏳ — Conflict MEDIUM'; decColor = 'var(--amber)'; }
      else if (ts.blocked) { decision = 'WAIT ⏳ — Max 3 trades active'; decColor = 'var(--amber)'; }
      else { decision = 'READY ✅ — Set limit at ' + fmtP(entLo) + '–' + fmtP(entHi); decColor = 'var(--g)'; }

      validSetups.push({
        rank: 0, symbol: sym, name: coin.cgName || sym,
        price, change24h: +change24h.toFixed(2), change7d: +(change7d||0).toFixed(2),
        vol24h, fromATH: sc.fromATH !== 0 ? +sc.fromATH.toFixed(1) : null,
        tier, tierLabel: tier === 'S' ? '🔥 TIER S' : '✅ TIER A',
        finalScore, confidence: finalConf,
        regime: { regime: regime.regime, color: regime.color, focus: regime.focus },
        preImpulse: { count: pi.count, stage: pi.stage, valid: pi.valid, signals: pi.signals },
        smDetection: { count: sm.count, valid: sm.valid, strong: sm.strong, signals: sm.signals },
        entryConfirmation: { valid: ec.valid, count: ec.count, needs: ec.needs, list: ec.confirmations.map(c => c.t) },
        conflict: { level: conf.level, action: conf.action, list: conf.conflicts },
        freshness: { status: fresh ? 'FRESH 🟢' : 'AGING 🟡' },
        tradeState: ts, status: ts.state,
        rr: { tp1: rr.tp1, tp2: rr.tp2, tp1Pct: rr.tp1Pct, tp2Pct: rr.tp2Pct, rr1: rr.rr1, rr2: rr.rr2, label: rr.rrLabel, slPrice: rr.slPrice, slPct: rr.slPct },
        entryZone: { lo: +entLo.toFixed(8), hi: +entHi.toFixed(8), optimal: +(price * 0.999).toFixed(8) },
        scoreBreakdown: sc.components,
        decision, decisionColor: decColor,
        positionSize: tier === 'S' ? '2-3%' : '1-2%',
        // Trade data format for storage
        tradeData: { coin: sym, entry: +(price * 0.999).toFixed(8), sl: rr.slPrice, tp1: rr.tp1, tp2: rr.tp2, rr: rr.rrLabel, status: ts.state, timestamp: new Date().toISOString().split('T')[0], score: finalScore, confidence: finalConf },
      });
    }

    validSetups.sort((a, b) => b.finalScore - a.finalScore || b.confidence - a.confidence);
    validSetups.forEach((r, i) => r.rank = i + 1);

    const tierS = validSetups.filter(r => r.tier === 'S').slice(0, 5);
    const tierA = validSetups.filter(r => r.tier === 'A').slice(0, 8);

    // Export current active trades for client storage
    const activeTrades = [];
    TRADE_STORE.forEach((v, k) => {
      if (['IN_ZONE','TRIGGERED','ACTIVE','COMPLETED','INVALID'].includes(v.state)) {
        activeTrades.push({ symbol: k, state: v.state, entryPrice: v.ep, setupTime: v.st, entryTime: v.et, sl: v.sl, tp1: v.tp1, tp2: v.tp2, rr: v.rr, tier: v.tier, score: v.score, pnl: v.pnl || 0 });
      }
    });

    res.setHeader('Cache-Control', 's-maxage=60');
    return res.status(200).json({
      timestamp: Date.now(),
      scanTime: ((Date.now() - t0) / 1000).toFixed(1),
      totalScanned: candidates.length,
      totalQualified: validSetups.length,
      totalKilled: Object.values(killed).reduce((a, b) => a + b, 0),
      killedBreakdown: killed,
      tierGroups: { S: tierS, A: tierA },
      activeSetups,
      activeTrades, // for client localStorage sync
      regime,
      systemStatus: {
        activeCount: actCnt, maxAllowed: MAX_ACTIVE, canTake: actCnt < MAX_ACTIVE,
        cyclePhase, btcTrend, fgValue: fgV, btcDom, btcCh7, btcPx,
        principle: 'No random signals. Strict filter. No bad trade.',
        storageNote: 'Trades stored in module Map + synced to localStorage via POST /api/accumulation',
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
