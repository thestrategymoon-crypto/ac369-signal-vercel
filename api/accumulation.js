// api/accumulation.js — AC369 FUSION v5.0 INSTITUTIONAL ENGINE
// ══════════════════════════════════════════════════════════════
// COMPLETE TRADE LIFECYCLE + CHART PATTERN DETECTION
//
// LAYERS:
//   1. Smart Money Detection
//   2. Strict Validation (7 gates)
//   3. 6-Factor Scoring + Pattern Bonus
//   4. Chart Pattern Engine (DB/IHS/Triangle/Breakout)
//   5. Trade State Machine (READY→TRIGGERED→ACTIVE→COMPLETED)
//   6. Kill Engine
//
// OUTPUT: Only TIER S (80+) and TIER A (70+)
//         All ACTIVE trades regardless of score
//
// PRINCIPLE: Hedge fund discipline. No trade > bad trade.
// ══════════════════════════════════════════════════════════════

// Trade state store (in-memory, resets on cold start)
// For persistence across requests, we use a module-level object
const TRADE_STORE = new Map();
// Format: TRADE_STORE.set(symbol, {
//   state: 'READY'|'TRIGGERED'|'ACTIVE'|'COMPLETED'|'INVALID'|'EXPIRED'|'DEAD',
//   entryPrice: number, entryTime: timestamp, setupTime: timestamp,
//   sl: number, tp1: number, tp2: number, tp3: number, score: number, tier: string
// })

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

  // ════════════════════════════════════════════════════════════
  // CHART PATTERN ENGINE
  // Detects: Double Bottom, Inv H&S, Ascending Triangle, Breakout+Retest
  // ════════════════════════════════════════════════════════════
  function detectChartPattern(price, high, low, open, change24h, change7d, vol24h, rangePos, lwRatio, bodyRatio) {
    const patterns = [];

    // ── DOUBLE BOTTOM PROXY ────────────────────────────────────
    // Proxy: price near 24h low + strong lower wick + 7d had similar dip
    // True Double Bottom needs klines, but we approximate from ticker
    if (lwRatio > 0.45 && rangePos < 0.45 && change7d !== null && change7d >= -5 && change7d <= 8) {
      // Price bounced from similar level within 7 days
      const confidence = lwRatio > 0.55 ? 'CONFIRMED' : 'FORMING';
      const patScore = confidence === 'CONFIRMED' ? 10 : 4;
      patterns.push({
        name: 'Double Bottom',
        type: 'BULLISH_REVERSAL',
        status: confidence,
        description: confidence === 'CONFIRMED'
          ? `Strong double bottom proxy — lower wick ${(lwRatio * 100).toFixed(0)}% + 7d stability. Neckline: ${fmtP(high)}`
          : `Double bottom forming — price testing lows again with wick. Watch for neckline break at ${fmtP(high)}`,
        neckline: +high.toFixed(8),
        support: +low.toFixed(8),
        patternScore: patScore,
      });
    }

    // ── INVERSE HEAD & SHOULDERS PROXY ────────────────────────
    // Proxy: large lower wick (head) + smaller wicks (shoulders) + recovery
    // Approx: lwRatio very high + price recovering + 30d down, 7d up
    if (lwRatio > 0.50 && change24h > 1 && (change7d || 0) > 2 && (change7d || 0) < 15) {
      const confidence = lwRatio > 0.60 && change24h > 3 ? 'CONFIRMED' : 'FORMING';
      const patScore = confidence === 'CONFIRMED' ? 10 : 4;
      patterns.push({
        name: 'Inverse H&S',
        type: 'BULLISH_REVERSAL',
        status: confidence,
        description: confidence === 'CONFIRMED'
          ? `Inverse H&S pattern — deep wick (head) with recovery. Breakout target: ${fmtP(high * 1.15)}`
          : `Possible Inverse H&S forming — head at ${fmtP(low)}, price recovering`,
        neckline: +high.toFixed(8),
        target: +(high * 1.15).toFixed(8),
        patternScore: patScore,
      });
    }

    // ── ASCENDING TRIANGLE / BASE BREAKOUT ────────────────────
    // Higher lows + flat/tested resistance = energy building
    // Proxy: 7d positive + 30d down + price above midrange + volume building
    if ((change7d || 0) > 5 && (change7d || 0) < 20 && rangePos > 0.55 && rangePos < 0.85 && vol24h > 10e6) {
      const breakoutLevel = high;
      const confirmed = change24h > 2 && rangePos > 0.70;
      const failed = change24h < -5 && rangePos < 0.45;
      const status = failed ? 'FAILED' : confirmed ? 'CONFIRMED' : 'FORMING';
      const patScore = status === 'CONFIRMED' ? 10 : status === 'FAILED' ? -10 : 4;
      if (!failed) {
        patterns.push({
          name: 'Ascending Triangle / Base',
          type: 'BULLISH_CONTINUATION',
          status,
          description: status === 'CONFIRMED'
            ? `Breakout above base confirmed at ${fmtP(breakoutLevel)}. Continuation target active.`
            : `Base forming — higher lows + resistance at ${fmtP(breakoutLevel)}. Watch breakout.`,
          breakoutLevel: +breakoutLevel.toFixed(8),
          patternScore: patScore,
        });
      }
    }

    // ── BREAKOUT + RETEST ─────────────────────────────────────
    // BOS + price pulling back to test the broken level
    // Proxy: recent strong move up (7d), now slight pullback (24h slight negative), at old resistance
    if ((change7d || 0) > 8 && change24h >= -4 && change24h <= 2 && rangePos > 0.40 && rangePos < 0.70 && lwRatio > 0.25) {
      const retestLevel = +(price * 0.97).toFixed(8);
      const confirmed = change24h >= -2 && lwRatio > 0.30; // Holding on retest
      const failed = change24h < -5 || rangePos < 0.30; // Breaking below retest
      const status = failed ? 'FAILED' : confirmed ? 'CONFIRMED' : 'FORMING';
      const patScore = status === 'CONFIRMED' ? 10 : status === 'FAILED' ? -10 : 4;
      if (!failed) {
        patterns.push({
          name: 'Breakout Retest',
          type: 'BULLISH_CONTINUATION',
          status,
          description: status === 'CONFIRMED'
            ? `Price retesting breakout level ${fmtP(retestLevel)} and holding. Entry confirmed.`
            : `BOS occurred (7d +${(change7d || 0).toFixed(1)}%). Now retesting support — watch for hold.`,
          retestLevel,
          patternScore: patScore,
        });
      }
    }

    // ── DEAD CAT / FAILED PATTERN ─────────────────────────────
    // Price broke down significantly
    if (change24h < -8 || (change7d || 0) < -20) {
      patterns.push({
        name: 'Breakdown',
        type: 'BEARISH',
        status: 'CONFIRMED',
        description: `Bearish breakdown confirmed. 24h: ${change24h.toFixed(1)}%. Structure invalidated.`,
        patternScore: -10,
      });
    }

    // Return best pattern (highest abs score)
    if (patterns.length === 0) return { name: 'No Pattern', type: 'NEUTRAL', status: 'NONE', description: 'No clear chart pattern detected', patternScore: 0 };
    return patterns.sort((a, b) => Math.abs(b.patternScore) - Math.abs(a.patternScore))[0];
  }

  // ════════════════════════════════════════════════════════════
  // KILL ENGINE
  // ════════════════════════════════════════════════════════════
  function killEngine(price, entryOptimal, slPrice, rr1, change24h) {
    if (price <= slPrice * 0.999)
      return { killed: true, tag: 'DEAD SETUP 💀 — SL HIT', reason: `Price $${fmtP(price)} breached stop loss $${fmtP(slPrice)}. Structure destroyed. Setup terminated.` };
    const dist = (price - entryOptimal) / price;
    if (dist > 0.03)
      return { killed: true, tag: 'DEAD SETUP 🕐 — TOO LATE', reason: `Price ${(dist * 100).toFixed(1)}% above optimal entry. Chasing trade = unacceptable RR. Wait for new setup.` };
    if (rr1 < 3)
      return { killed: true, tag: 'DEAD SETUP ❌ — POOR RR', reason: `R:R ${rr1}:1 below institutional minimum 3:1. Setup rejected.` };
    if (change24h < -8)
      return { killed: true, tag: 'DEAD SETUP 📉 — BREAKDOWN', reason: `24h breakdown ${change24h.toFixed(1)}%. Market structure invalidated before entry.` };
    return { killed: false };
  }

  // ════════════════════════════════════════════════════════════
  // TRADE STATE ENGINE
  // Manages lifecycle: READY → TRIGGERED → ACTIVE → COMPLETED
  // ════════════════════════════════════════════════════════════
  function updateTradeState(symbol, currentPrice, entryZoneLo, entryZoneHi, slPrice, tp1, tp2, tp3, score, tier) {
    const now = Date.now();
    const existing = TRADE_STORE.get(symbol);
    const EXPIRY_MS = 72 * 60 * 60 * 1000; // 72 hours to trigger

    if (existing) {
      const { state, entryPrice, setupTime } = existing;

      // ENTRY LOCK: If TRIGGERED or ACTIVE, never re-evaluate
      if (state === 'TRIGGERED' || state === 'ACTIVE') {
        // Only update to INVALID if SL hit
        if (currentPrice <= existing.sl * 0.999) {
          TRADE_STORE.set(symbol, { ...existing, state: 'INVALID', closedTime: now });
          return { state: 'INVALID', tag: 'INVALID ❌ — SL HIT', isActive: false };
        }
        // Check if TP1 hit
        if (currentPrice >= existing.tp1 * 0.999) {
          TRADE_STORE.set(symbol, { ...existing, state: 'COMPLETED', closedTime: now });
          return { state: 'COMPLETED', tag: 'COMPLETED ✅ — TP1 HIT', isActive: false, pnl: +((existing.tp1 - existing.entryPrice) / existing.entryPrice * 100).toFixed(2) };
        }
        // Still active
        const pnlPct = entryPrice > 0 ? +((currentPrice - entryPrice) / entryPrice * 100).toFixed(2) : 0;
        return {
          state, tag: state === 'ACTIVE' ? `ACTIVE 🟢 — PnL: ${pnlPct >= 0 ? '+' : ''}${pnlPct}%` : 'TRIGGERED ⚡ — In Entry Zone',
          isActive: true, entryPrice: existing.entryPrice, pnlPct,
          timeInTrade: Math.round((now - existing.entryTime) / 3600000) + 'h',
        };
      }

      // READY state: check if expired
      if (state === 'READY') {
        if (now - setupTime > EXPIRY_MS) {
          TRADE_STORE.set(symbol, { ...existing, state: 'EXPIRED' });
          return { state: 'EXPIRED', tag: 'EXPIRED ⏰ — No trigger in 72h', isActive: false };
        }
      }
    }

    // New setup or re-evaluation
    // Check if price is in entry zone → TRIGGERED
    if (currentPrice >= entryZoneLo && currentPrice <= entryZoneHi) {
      const newState = { state: 'TRIGGERED', entryPrice: currentPrice, entryTime: now, setupTime: now, sl: slPrice, tp1, tp2, tp3, score, tier };
      TRADE_STORE.set(symbol, newState);
      return { state: 'TRIGGERED', tag: 'TRIGGERED ⚡ — ENTER NOW', isActive: true, entryPrice: currentPrice };
    }

    // Price approaching zone
    const distToZone = (entryZoneHi - currentPrice) / currentPrice;
    const proximity = distToZone <= 0.02 ? 'IMMINENT (within 2%)' : distToZone <= 0.05 ? 'NEAR (within 5%)' : 'READY';
    TRADE_STORE.set(symbol, { state: 'READY', setupTime: now, sl: slPrice, tp1, tp2, tp3, score, tier });
    return { state: 'READY', tag: `READY 📋 — ${proximity}`, isActive: false, distToEntry: +(distToZone * 100).toFixed(1) };
  }

  // ════════════════════════════════════════════════════════════
  // SCORING ENGINE (6 factors + pattern)
  // ════════════════════════════════════════════════════════════
  function scoreSetup(coin, btcChange24h, btcChange7d, fgValue, pattern) {
    const { price, vol24h, change24h, high, low, open } = coin;
    const change7d = coin.change7d || 0;
    const change30d = coin.change30d || 0;
    const ath = coin.ath || 0;
    const range = Math.max(high - low, price * 0.01);
    const rangePos = (price - low) / range;
    const body = Math.abs(price - open);
    const lw = Math.min(price, open) - low;
    const lwRatio = lw / range;
    const bodyRatio = body / range;
    const fromATH = ath > 0 ? ((price - ath) / ath * 100) : 0;
    const rs24h = change24h - btcChange24h;
    const rs7d = change7d - btcChange7d;
    const volTier = vol24h >= 500e6 ? 5 : vol24h >= 100e6 ? 4 : vol24h >= 30e6 ? 3 : vol24h >= 10e6 ? 2 : vol24h >= 2e6 ? 1 : 0;
    const priceFlat = change24h >= -5 && change24h <= 3;
    const priceDown = change24h < -5 && change24h > -12;

    // ── S1: VOLUME ACCUMULATION (25pts) ───────────────────────
    let s1 = 0;
    if (volTier >= 4 && priceFlat) s1 = 25;
    else if (volTier >= 3 && priceFlat) s1 = 20;
    else if (volTier >= 4 && priceDown) s1 = 22;
    else if (volTier >= 3 && priceDown) s1 = 18;
    else if (volTier >= 2 && priceFlat) s1 = 14;
    else if (volTier >= 2 && priceDown) s1 = 12;
    else if (volTier >= 1 && priceFlat) s1 = 8;
    else if (volTier >= 2) s1 = 5;
    else s1 = 2;
    if (fgValue <= 20 && priceFlat) s1 = Math.min(25, s1 + 3);
    else if (fgValue <= 30 && priceFlat) s1 = Math.min(25, s1 + 2);

    // ── S2: LIQUIDITY SWEEP (20pts) ───────────────────────────
    let s2 = 0;
    if (lwRatio > 0.55 && bodyRatio < 0.15 && rangePos > 0.40) s2 = 20;
    else if (lwRatio > 0.50 && rangePos < 0.45 && price > low * 1.005) s2 = 18;
    else if (lwRatio > 0.40 && rangePos < 0.50) s2 = 14;
    else if (lwRatio > 0.30 && rangePos < 0.55 && priceFlat) s2 = 10;
    else if (lwRatio > 0.20 && rangePos < 0.45) s2 = 7;
    else if (rangePos < 0.30) s2 = 4;
    else s2 = 1;
    if (lwRatio > 0.45 && change24h > 1 && rangePos > 0.55) s2 = Math.min(20, s2 + 3);

    // ── S3: STRUCTURE STRENGTH (20pts) ───────────────────────
    let s3 = 0;
    const sslSweep = lwRatio > 0.40 && rangePos < 0.50;
    const chochBull = change24h > 3 && change24h < 12 && rangePos > 0.55 && change7d < 5;
    const recovery7d = change7d > 3 && change30d < -15;
    const consolidation = Math.abs(change24h) < 3 && Math.abs(change7d) < 8 && vol24h > 5e6;
    if (sslSweep && chochBull) s3 = 20;
    else if (sslSweep && change24h > 1) s3 = 17;
    else if (chochBull) s3 = 15;
    else if (change24h > 5 && rangePos > 0.65) s3 = 13;
    else if (sslSweep) s3 = 11;
    else if (recovery7d) s3 = 9;
    else if (consolidation) s3 = 7;
    else if (rangePos < 0.35) s3 = 4;
    else s3 = 1;
    if (rs7d > 10) s3 = Math.min(20, s3 + 3);
    else if (rs7d > 5) s3 = Math.min(20, s3 + 2);
    else if (rs7d > 0 && btcChange7d < -3) s3 = Math.min(20, s3 + 2);

    // ── S4: RISK/REWARD (15pts) — filled after zone calc ──────
    // Placeholder — computed after TP/SL calculated

    // ── S5: ENTRY PRECISION (10pts) ──────────────────────────
    let s5 = 0;
    const inGolden = fromATH <= -55 && fromATH >= -80;
    const deepDisc = fromATH <= -80 && fromATH >= -97;
    const normalDisc = fromATH <= -30 && fromATH >= -55;
    if (inGolden && rangePos < 0.50) s5 = 10;
    else if (inGolden) s5 = 8;
    else if (deepDisc && rangePos < 0.50) s5 = 9;
    else if (deepDisc) s5 = 7;
    else if (normalDisc && rangePos < 0.40) s5 = 7;
    else if (normalDisc) s5 = 5;
    else if (rangePos < 0.30) s5 = 4;
    else s5 = 2;

    // ── S6: MOMENTUM (10pts) ─────────────────────────────────
    let s6 = 0;
    if (rs7d > 15 && priceFlat) s6 = 10;
    else if (rs7d > 8 && change24h >= 0) s6 = 9;
    else if (rs7d > 3 && change24h >= 0) s6 = 7;
    else if (rs7d > 0 && btcChange7d < 0) s6 = 8;
    else if (rs7d >= -3 && change24h >= 0) s6 = 6;
    else if (change24h > 2 && change7d > 0) s6 = 5;
    else if (rs7d < -8) s6 = 2;
    else s6 = 4;
    if (fgValue <= 25) s6 = Math.min(10, s6 + 2);

    // Pattern bonus
    const patternBonus = Math.max(-10, Math.min(10, pattern?.patternScore || 0));

    return { s1, s2, s3, s4: 0, s5, s6, patternBonus, rs7d, sslSweep, chochBull, rangePos, lwRatio, fromATH };
  }

  // ════════════════════════════════════════════════════════════
  // ZONE CALCULATOR
  // ════════════════════════════════════════════════════════════
  function calcZones(price, low, high, ath, scores) {
    const fromATH = ath > 0 ? ((price - ath) / ath * 100) : 0;
    const zW = 0.08; // Fixed 8% zone width for institutional

    // Entry zone: tight (institutional doesn't chase)
    const entryLo = Math.max(price * 0.98, low * 0.99);
    const entryOptimal = price * 0.999;
    const entryHi = price * 1.01;

    // SL: structure-based
    const slPrice = Math.max(price * (1 - zW - 0.03), low * 0.96);

    // Targets: ATH Fibonacci if available
    let tp1, tp2, tp3;
    if (ath > 0 && fromATH < -25) {
      const toATH = ath - price;
      tp1 = Math.min(price + toATH * 0.382, price * 3);
      tp2 = Math.min(price + toATH * 0.618, price * 6);
      tp3 = Math.min(price + toATH, price * 10);
    } else {
      const sl = price - slPrice;
      tp1 = price + sl * 3; tp2 = price + sl * 5; tp3 = price + sl * 8;
    }

    const slDist = Math.max(price - slPrice, price * 0.005);
    const rr1 = +((tp1 - price) / slDist).toFixed(2);
    const rr2 = +((tp2 - price) / slDist).toFixed(2);
    const rr3 = +((tp3 - price) / slDist).toFixed(2);

    // RR score
    let s4 = 0;
    if (rr1 >= 10) s4 = 15; else if (rr1 >= 7) s4 = 12; else if (rr1 >= 5) s4 = 10; else if (rr1 >= 3) s4 = 6; else s4 = 0;

    return { entryLo, entryOptimal, entryHi, slPrice, tp1, tp2, tp3, rr1, rr2, rr3, s4, fromATH };
  }

  // ════════════════════════════════════════════════════════════
  // MAIN HANDLER
  // ════════════════════════════════════════════════════════════
  try {
    const start = Date.now();

    const [binRes, cgRes, fngRes, globalRes, btcKlRes] = await Promise.allSettled([
      sf('https://api.binance.com/api/v3/ticker/24hr', 6000),
      sf('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=volume_desc&per_page=250&page=1&sparkline=false&price_change_percentage=7d,30d', 6000),
      sf('https://api.alternative.me/fng/?limit=1&format=json'),
      sf('https://api.coingecko.com/api/v3/global'),
      sf('https://min-api.cryptocompare.com/data/v2/histohour?fsym=BTC&tsym=USD&limit=168', 5000),
    ]);

    const binTickers = binRes.status === 'fulfilled' && Array.isArray(binRes.value) && binRes.value.length > 100 ? binRes.value : [];
    const cgMarkets = cgRes.status === 'fulfilled' && Array.isArray(cgRes.value) ? cgRes.value : [];
    const fgValue = fngRes.status === 'fulfilled' ? parseInt(fngRes.value?.data?.[0]?.value || 50) : 50;
    const globalData = globalRes.status === 'fulfilled' ? globalRes.value?.data : null;
    const btcK = btcKlRes.status === 'fulfilled' && btcKlRes.value?.Response === 'Success' ? btcKlRes.value.Data.Data.map(d => +d.close).filter(v => v > 0) : [];

    const binMap = {};
    binTickers.forEach(t => { if (t?.symbol) binMap[t.symbol] = t; });
    const btcT = binMap['BTCUSDT'];
    const btcPrice = +(btcT?.lastPrice || 0);
    const btcChange24h = +(btcT?.priceChangePercent || 0);
    let btcChange7d = 0, btcTrend = 'NEUTRAL';
    if (btcK.length >= 50) {
      const c = btcK[btcK.length - 1], w7 = btcK.length >= 168 ? btcK[btcK.length - 168] : btcK[0];
      btcChange7d = w7 > 0 ? +((c - w7) / w7 * 100).toFixed(2) : 0;
      const ma50 = btcK.slice(-50).reduce((a, b) => a + b, 0) / 50;
      btcTrend = c > ma50 * 1.02 ? 'BULLISH' : c < ma50 * 0.98 ? 'BEARISH' : 'NEUTRAL';
    }

    const dsh = Math.floor((Date.now() - new Date('2024-04-20').getTime()) / 86400000);
    const cycleBonus = dsh < 365 ? 3 : dsh < 547 ? 2 : dsh < 730 ? 0 : -2;
    const cyclePhase = dsh < 365 ? 'Bull Early ✅' : dsh < 547 ? 'Bull Peak ⚠️' : dsh < 730 ? 'Distribution ⚠️' : 'Bear/Accum';
    const inMR = [{ s: new Date('2026-03-08'), e: new Date('2026-03-31') }, { s: new Date('2026-07-06'), e: new Date('2026-07-30') }].some(p => new Date() >= p.s && new Date() <= p.e);

    const STABLES = new Set([
      'USDT','USDC','BUSD','TUSD','DAI','FDUSD','USDP','FRAX','LUSD','USDS','SUSD','GUSD',
      'PYUSD','CRVUSD','USDD','CUSD','USDX','USDB','XUSD','USDJ','AUSD','AGEUR','JEUR',
      'XSGD','EURS','EURT','CADC','GYEN','NZDS','BRLA','MXNT','BIDR','BVND','IDRT',
      'TRYB','BRLC','PAXG','XAUT','WBTC','WETH','WBNB','STETH','CBETH','RETH','BETH',
    ]);
    const BAD = ['UP','DOWN','BEAR','BULL','3L','3S','2L','2S'];
    const HAN = /[\u4e00-\u9fff\u3400-\u4dbf]/;

    const cgMap = {};
    cgMarkets.forEach(c => { if (c?.symbol) cgMap[c.symbol.toUpperCase()] = c; });

    const candidates = [];
    const seen = new Set();
    binTickers.forEach(t => {
      if (!t?.symbol?.endsWith('USDT')) return;
      const base = t.symbol.replace('USDT', '');
      if (STABLES.has(base) || seen.has(base) || HAN.test(base)) return;
      if (BAD.some(s => base.endsWith(s) || base.startsWith(s))) return;
      if (base.length < 2 || base.length > 12) return;
      const vol = +(t.quoteVolume || 0), price = +(t.lastPrice || 0);
      if (vol < 500000 || price <= 0) return;
      if (price >= 0.97 && price <= 1.03 && Math.abs(+(t.priceChangePercent || 0)) < 2) return;
      seen.add(base);
      const cg = cgMap[base];
      candidates.push({
        base, price, vol24h: vol, change24h: +(t.priceChangePercent || 0),
        high: +(t.highPrice || price), low: +(t.lowPrice || price),
        open: +(t.openPrice || t.prevClosePrice || price),
        change7d: cg ? +(cg.price_change_percentage_7d || 0) : null,
        change30d: cg ? +(cg.price_change_percentage_30d || 0) : null,
        ath: cg ? +(cg.ath || 0) : 0,
        marketCap: cg ? +(cg.market_cap || 0) : 0,
        cgName: cg?.name || base,
      });
    });
    cgMarkets.forEach(c => {
      const base = (c.symbol || '').toUpperCase();
      if (STABLES.has(base) || seen.has(base) || HAN.test(c.name || '')) return;
      const vol = +(c.total_volume || 0), price = +(c.current_price || 0);
      if (vol < 1000000 || price <= 0 || (price >= 0.97 && price <= 1.03)) return;
      candidates.push({ base, price, vol24h: vol, change24h: +(c.price_change_percentage_24h || 0), high: price * 1.02, low: price * 0.98, open: price / (1 + (+(c.price_change_percentage_24h || 0)) / 100), change7d: +(c.price_change_percentage_7d || 0), change30d: +(c.price_change_percentage_30d || 0), ath: +(c.ath || 0), marketCap: +(c.market_cap || 0), cgName: c.name || base });
    });

    // ── PROCESS EACH CANDIDATE ────────────────────────────────
    const killed = { DEAD: 0, POOR_RR: 0, TOO_LATE: 0, BREAKDOWN: 0, LOW_SCORE: 0, STALE: 0 };
    const validSetups = [];
    const activeSetups = []; // Always show active trades

    for (const coin of candidates.slice(0, 800)) {
      const { base: sym, price, ath, change24h, vol24h } = coin;
      if (!price || price <= 0) continue;
      if (ath > 0 && ((price - ath) / ath * 100) < -99) { killed.STALE++; continue; }

      // Check if this is an active trade — show regardless
      const existing = TRADE_STORE.get(sym);
      if (existing && (existing.state === 'TRIGGERED' || existing.state === 'ACTIVE')) {
        // Process the active trade
        const zones = calcZones(price, coin.low, coin.high, ath, {});
        const tradeState = updateTradeState(sym, price, zones.entryLo, zones.entryHi, zones.slPrice, zones.tp1, zones.tp2, zones.tp3, existing.score || 75, existing.tier || 'A');
        const pnl = existing.entryPrice > 0 ? +((price - existing.entryPrice) / existing.entryPrice * 100).toFixed(2) : 0;
        const pattern = detectChartPattern(price, coin.high, coin.low, coin.open, change24h, coin.change7d, vol24h, (price - coin.low) / Math.max(coin.high - coin.low, price * 0.01), Math.min(coin.open, price) - coin.low / Math.max(coin.high - coin.low, price * 0.01), 0);
        activeSetups.push({ symbol: sym, price, status: existing.state, tag: tradeState.tag, tier: existing.tier || 'A', score: existing.score || 75, entryPrice: existing.entryPrice || price, pnl, pnlPct: pnl, stopLoss: { price: existing.sl, pct: +((existing.sl - price) / price * 100).toFixed(1) }, targets: { tp1: { price: existing.tp1, pct: +((existing.tp1 - price) / price * 100).toFixed(1) }, tp2: { price: existing.tp2, pct: +((existing.tp2 - price) / price * 100).toFixed(1) }, tp3: { price: existing.tp3, pct: +((existing.tp3 - price) / price * 100).toFixed(1) } }, change24h: +change24h.toFixed(2), pattern, isActive: true });
        continue;
      }

      // Pattern detection
      const range = Math.max(coin.high - coin.low, price * 0.01);
      const rangePos = (price - coin.low) / range;
      const lw = Math.min(price, coin.open) - coin.low;
      const lwRatio = lw / range;
      const bodyRatio = Math.abs(price - coin.open) / range;
      const pattern = detectChartPattern(price, coin.high, coin.low, coin.open, change24h, coin.change7d, vol24h, rangePos, lwRatio, bodyRatio);

      // Score
      const scores = scoreSetup(coin, btcChange24h, btcChange7d, fgValue, pattern);
      const zones = calcZones(price, coin.low, coin.high, ath, scores);

      // Fill RR score
      scores.s4 = zones.s4;

      const rawScore = scores.s1 + scores.s2 + scores.s3 + scores.s4 + scores.s5 + scores.s6 + scores.patternBonus + cycleBonus + (inMR ? -2 : 0);
      const totalScore = Math.max(0, Math.min(100, rawScore));

      // Kill engine
      const killResult = killEngine(price, zones.entryOptimal, zones.slPrice, zones.rr1, change24h);
      if (killResult.killed) {
        const k = killResult.tag.includes('SL') ? 'DEAD' : killResult.tag.includes('LATE') ? 'TOO_LATE' : killResult.tag.includes('RR') ? 'POOR_RR' : 'BREAKDOWN';
        killed[k]++;
        continue;
      }

      // Score threshold: only Tier B+ shown, S and A in output
      const tier = totalScore >= 80 ? 'S' : totalScore >= 70 ? 'A' : totalScore >= 60 ? 'B' : null;
      if (!tier) { killed.LOW_SCORE++; continue; }

      // Trade state
      const tradeState = updateTradeState(sym, price, zones.entryLo, zones.entryHi, zones.slPrice, zones.tp1, zones.tp2, zones.tp3, totalScore, tier);

      // Build reasons
      const reasons = [];
      if (scores.s1 >= 18) reasons.push(`Vol ${(vol24h / 1e6).toFixed(0)}M + price ${change24h >= 0 ? '+' : ''}${change24h.toFixed(1)}% = confirmed SM absorption`);
      if (scores.s2 >= 15) reasons.push(`SSL swept — lower wick ${(lwRatio * 100).toFixed(0)}% with recovery`);
      if (scores.s3 >= 15) reasons.push(`${scores.sslSweep && scores.chochBull ? 'SSL + CHoCH confirmed' : scores.chochBull ? 'CHoCH bullish terkonfirmasi' : 'Structure holding support'}`);
      if (zones.rr1 >= 5) reasons.push(`R:R excellent: TP1=${zones.rr1}:1, TP2=${zones.rr2}:1`);
      if (zones.fromATH < -50) reasons.push(`${zones.fromATH.toFixed(0)}% dari ATH — deep value zone`);
      if (pattern.status === 'CONFIRMED') reasons.push(`${pattern.name} CONFIRMED — ${pattern.description}`);
      if (scores.rs7d > 5) reasons.push(`Relative Strength vs BTC: +${scores.rs7d.toFixed(1)}% (7d)`);

      const recommendation = tradeState.state === 'TRIGGERED' ? `ENTER NOW ✅ — Harga dalam zona. Entry: ${fmtP(zones.entryOptimal)}, SL: ${fmtP(zones.slPrice)}, TP1: ${fmtP(zones.tp1)} (+${(((zones.tp1 - price) / price) * 100).toFixed(1)}%)` : tier === 'S' ? `TRADE ✅ — Set limit ${fmtP(zones.entryLo)}–${fmtP(zones.entryHi)}. SL: ${fmtP(zones.slPrice)}. TP1: +${(((zones.tp1 - price) / price) * 100).toFixed(1)}% (R:${zones.rr1})` : `LIMIT ORDER ✅ — ${fmtP(zones.entryLo)}–${fmtP(zones.entryHi)}. SL: ${fmtP(zones.slPrice)}. TP1: +${(((zones.tp1 - price) / price) * 100).toFixed(1)}%`;

      // Entry validity assessment
      const distFromEntry = (price - zones.entryOptimal) / price;
      const entryValidity = tradeState.state === 'TRIGGERED' ? 'WITHIN ZONE ✅' : distFromEntry < 0 ? 'BELOW OPTIMAL — Prime entry' : distFromEntry < 0.02 ? 'AT OPTIMAL ✅' : 'APPROACHING';
      const slStatus = (price - zones.slPrice) / price > 0.08 ? 'SAFE ✅' : (price - zones.slPrice) / price > 0.03 ? 'NEAR ⚠️' : 'CRITICAL ❗';

      if (tier === 'S' || tier === 'A') {
        validSetups.push({
          rank: 0, symbol: sym, name: coin.cgName || sym,
          price, change24h: +change24h.toFixed(2),
          change7d: +(coin.change7d || 0).toFixed(2),
          change30d: +(coin.change30d || 0).toFixed(2),
          volume24h: vol24h, fromATH: zones.fromATH !== 0 ? +zones.fromATH.toFixed(1) : null,
          tier, tierLabel: tier === 'S' ? '🔥 TIER S — SNIPER' : '✅ TIER A — READY',
          timeframe: tier === 'S' ? '1-7 hari' : '1-2 minggu',
          totalScore,
          tradeState, status: tradeState.state,
          entryValidity, slStatus,
          breakdown: {
            volumeAccumulation: { score: scores.s1, max: 25, label: 'Volume Accumulation' },
            liquiditySweep: { score: scores.s2, max: 20, label: 'Liquidity Sweep' },
            structureStrength: { score: scores.s3, max: 20, label: 'Structure Strength' },
            riskReward: { score: scores.s4, max: 15, label: 'Risk/Reward', rr1: zones.rr1, rr2: zones.rr2, rr3: zones.rr3 },
            entryPrecision: { score: scores.s5, max: 10, label: 'Entry Precision' },
            momentum: { score: scores.s6, max: 10, label: 'Momentum' },
            pattern: { score: scores.patternBonus, max: 10, label: 'Chart Pattern' },
          },
          pattern,
          entryZone: { lo: +zones.entryLo.toFixed(8), optimal: +zones.entryOptimal.toFixed(8), hi: +zones.entryHi.toFixed(8) },
          stopLoss: { price: +zones.slPrice.toFixed(8), pct: +((zones.slPrice - price) / price * 100).toFixed(1) },
          targets: {
            tp1: { price: +zones.tp1.toFixed(8), pct: +((zones.tp1 - price) / price * 100).toFixed(1), rr: zones.rr1, label: ath > 0 ? 'Fib 38.2%' : 'TP1' },
            tp2: { price: +zones.tp2.toFixed(8), pct: +((zones.tp2 - price) / price * 100).toFixed(1), rr: zones.rr2, label: ath > 0 ? 'Fib 61.8%' : 'TP2' },
            tp3: { price: +zones.tp3.toFixed(8), pct: +((zones.tp3 - price) / price * 100).toFixed(1), rr: zones.rr3, label: ath > 0 ? 'ATH area' : 'TP3' },
          },
          reasons: reasons.slice(0, 5),
          recommendation,
          positionSize: tier === 'S' ? '2-3% capital' : '1-2% capital',
        });
      }
    }

    validSetups.sort((a, b) => b.totalScore - a.totalScore || b.volume24h - a.volume24h);
    validSetups.forEach((r, i) => r.rank = i + 1);
    const tierS = validSetups.filter(r => r.tier === 'S').slice(0, 8);
    const tierA = validSetups.filter(r => r.tier === 'A').slice(0, 12);
    const totalKilled = Object.values(killed).reduce((a, b) => a + b, 0);

    res.setHeader('Cache-Control', 's-maxage=60');
    return res.status(200).json({
      timestamp: Date.now(),
      scanTime: ((Date.now() - start) / 1000).toFixed(1),
      totalScanned: candidates.length,
      totalQualified: validSetups.length,
      totalActive: activeSetups.length,
      totalKilled,
      killedBreakdown: killed,
      tierGroups: { S: tierS, A: tierA, B: [], C: [] },
      activeTrades: activeSetups,
      allResults: validSetups.slice(0, 20),
      marketContext: {
        btcTrend, btcPrice, btcChange24h, btcChange7d,
        fgValue, fgLabel: fgValue <= 25 ? 'Extreme Fear 🔥' : fgValue <= 45 ? 'Fear 😨' : fgValue <= 55 ? 'Neutral ⚖️' : fgValue <= 75 ? 'Greed 😄' : 'Extreme Greed 💀',
        cyclePhase, daysSinceHalving: dsh, inMR,
        dominance: +(globalData?.market_cap_percentage?.btc || 0).toFixed(1),
        principle: 'Consistency > Quantity. Accuracy > Frequency. No trade > Bad trade.',
      },
    });

  } catch (e) {
    return res.status(500).json({ error: e.message, results: [], totalScanned: 0 });
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
