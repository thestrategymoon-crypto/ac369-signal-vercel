// api/accumulation.js — AC369 FUSION v4.0
// ═══════════════════════════════════════════════════════════════
// INSTITUTIONAL VALIDATION ENGINE
// Only outputs TIER S (80+) and TIER A (70+)
// Everything else is KILLED
//
// SCORING: 6 factors × weighted max = 100pts
//   Volume Accumulation  25pts
//   Liquidity Sweep      20pts
//   Structure Strength   20pts
//   Risk/Reward          15pts
//   Entry Accuracy       10pts
//   Momentum             10pts
//
// KILL ENGINE: price<SL | distance>3% | RR<3 | structure broken
// ═══════════════════════════════════════════════════════════════

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
  // KILL ENGINE — Immediate disqualification
  // ════════════════════════════════════════════════════════════
  function killEngine(price, entryOptimal, slPrice, rr1, change24h) {
    // Kill 1: Price below stop loss → structure destroyed
    if (price <= slPrice) {
      return { killed: true, tag: 'DEAD SETUP 💀', reason: `Price $${fmtP(price)} ≤ Stop Loss $${fmtP(slPrice)}. Structure destroyed. Setup invalid.` };
    }
    // Kill 2: Too far from entry (>3%) → chasing, poor RR
    const distFromEntry = (price - entryOptimal) / price;
    if (distFromEntry > 0.03) {
      return { killed: true, tag: 'DEAD SETUP — TOO LATE 🕐', reason: `Price ${(distFromEntry * 100).toFixed(1)}% above optimal entry $${fmtP(entryOptimal)}. Chasing = poor RR. Wait for retrace.` };
    }
    // Kill 3: RR < 3
    if (rr1 < 3) {
      return { killed: true, tag: 'DEAD SETUP — POOR RR ❌', reason: `R:R ${rr1}:1 below minimum 3:1. Setup does not meet institutional standard.` };
    }
    // Kill 4: Hard breakdown (>8% drop on high volume = structure broken)
    if (change24h < -8) {
      return { killed: true, tag: 'DEAD SETUP — BREAKDOWN 📉', reason: `24h change ${change24h.toFixed(1)}% indicates active breakdown. Structure invalidated.` };
    }
    return { killed: false };
  }

  // ════════════════════════════════════════════════════════════
  // INSTITUTIONAL SCORE ENGINE — 6 factors
  // ════════════════════════════════════════════════════════════
  function scoreSetup(coin, btcChange24h, btcChange7d, fgValue) {
    const { price, vol24h, change24h, change7d, high, low, open, ath } = coin;
    const range = Math.max(high - low, price * 0.01);
    const rangePos = (price - low) / range;
    const body = Math.abs(price - open);
    const lw = Math.min(price, open) - low;
    const uw = high - Math.max(price, open);
    const lwRatio = lw / range;
    const uwRatio = uw / range;
    const bodyRatio = body / range;
    const fromATH = ath > 0 ? ((price - ath) / ath * 100) : 0;
    const rs24h = change24h - btcChange24h;
    const rs7d = (change7d || 0) - btcChange7d;

    const breakdown = {
      volAccum: 0,
      liqSweep: 0,
      structure: 0,
      riskReward: 0,
      entryAccuracy: 0,
      momentum: 0,
    };

    // ── FACTOR 1: VOLUME ACCUMULATION (25pts) ─────────────────
    // Key signal: High volume + price flat/down = SM absorbing supply
    const volTier = vol24h >= 500e6 ? 5 : vol24h >= 100e6 ? 4 : vol24h >= 30e6 ? 3 : vol24h >= 10e6 ? 2 : vol24h >= 2e6 ? 1 : 0;
    const priceFlat = change24h >= -5 && change24h <= 3;
    const priceDown = change24h < -5 && change24h > -12;
    const priceUp = change24h > 3;

    if (volTier >= 4 && priceFlat) breakdown.volAccum = 25;       // Huge vol, price flat = classic SM absorption
    else if (volTier >= 3 && priceFlat) breakdown.volAccum = 20;  // Large vol, flat = strong accumulation
    else if (volTier >= 4 && priceDown) breakdown.volAccum = 22;  // Huge vol on drop = capitulation + absorption
    else if (volTier >= 3 && priceDown) breakdown.volAccum = 18;  // Selling into SM buying
    else if (volTier >= 2 && priceFlat) breakdown.volAccum = 14;  // Moderate vol accumulation
    else if (volTier >= 2 && priceDown) breakdown.volAccum = 12;  // Some accumulation on dip
    else if (volTier >= 1 && priceFlat) breakdown.volAccum = 8;   // Low vol sideways
    else if (volTier >= 4 && priceUp) breakdown.volAccum = 5;     // High vol + price up = might be distribution
    else if (volTier >= 2 && priceUp) breakdown.volAccum = 3;
    else breakdown.volAccum = 1;

    // F&G extreme fear bonus: retail maximum fear = SM maximum opportunity
    if (fgValue <= 20 && priceFlat) breakdown.volAccum = Math.min(25, breakdown.volAccum + 3);
    else if (fgValue <= 30 && priceFlat) breakdown.volAccum = Math.min(25, breakdown.volAccum + 2);

    // ── FACTOR 2: LIQUIDITY SWEEP (20pts) ─────────────────────
    // SSL sweep: lower wick below key level, price recovers = smart money grabbed liquidity
    if (lwRatio > 0.55 && bodyRatio < 0.15 && rangePos > 0.40) breakdown.liqSweep = 20;      // Perfect hammer/pin bar = SSL swept
    else if (lwRatio > 0.50 && rangePos < 0.45 && price > low * 1.005) breakdown.liqSweep = 18; // Strong lower wick at lows with recovery
    else if (lwRatio > 0.40 && rangePos < 0.50) breakdown.liqSweep = 14;                      // Good lower wick
    else if (lwRatio > 0.30 && rangePos < 0.55 && priceFlat) breakdown.liqSweep = 10;         // Moderate wick, price holding
    else if (lwRatio > 0.20 && rangePos < 0.45) breakdown.liqSweep = 7;                       // Small wick at lows
    else if (rangePos < 0.30) breakdown.liqSweep = 4;                                          // At lows without wick (less ideal)
    else breakdown.liqSweep = 1;

    // SSL sweep bonus: if price visited low and recovered >2%
    if (lwRatio > 0.45 && change24h > 1 && rangePos > 0.55) {
      breakdown.liqSweep = Math.min(20, breakdown.liqSweep + 3);
    }

    // ── FACTOR 3: STRUCTURE STRENGTH (20pts) ──────────────────
    // Best: SSL sweep + CHoCH (structure shift after sweep = high probability)
    const sslSweep = lwRatio > 0.40 && rangePos < 0.50;
    const chochBull = change24h > 3 && change24h < 12 && rangePos > 0.55 && (change7d || 0) < 5;
    const bosBull = change24h > 5 && rangePos > 0.65;
    const consolidation = Math.abs(change24h) < 3 && Math.abs(change7d || 0) < 8 && vol24h > 5e6;
    const recovery7d = (change7d || 0) > 3 && (coin.change30d || 0) < -15;

    if (sslSweep && chochBull) breakdown.structure = 20;         // SSL + CHoCH = highest quality
    else if (sslSweep && change24h > 1) breakdown.structure = 17; // SSL + recovery
    else if (chochBull) breakdown.structure = 15;                 // CHoCH without confirmed SSL
    else if (bosBull) breakdown.structure = 13;                   // BOS in progress
    else if (sslSweep) breakdown.structure = 11;                  // SSL only, no CHoCH yet
    else if (recovery7d) breakdown.structure = 9;                 // 7d recovery after dump
    else if (consolidation) breakdown.structure = 7;              // Holding support = base forming
    else if (rangePos < 0.35) breakdown.structure = 4;            // At support, unclear structure
    else breakdown.structure = 1;

    // Relative strength vs BTC adds structure conviction
    if (rs7d > 10) breakdown.structure = Math.min(20, breakdown.structure + 3);
    else if (rs7d > 5) breakdown.structure = Math.min(20, breakdown.structure + 2);
    else if (rs7d > 0 && btcChange7d < -3) breakdown.structure = Math.min(20, breakdown.structure + 2); // Holding while BTC drops

    // ── FACTOR 4: RISK/REWARD (15pts) — calculated after zones ─
    // Will be filled in after zone calculation below
    // Placeholder — actual score calculated with TP/SL

    // ── FACTOR 5: ENTRY ACCURACY (10pts) ──────────────────────
    // How close to optimal entry are we?
    // Golden zone = Fib 0.618-0.786 of range from ATH (best RR)
    const inGoldenZone = fromATH <= -55 && fromATH >= -80; // Historically best accumulation zone
    const deepAccum = fromATH <= -80 && fromATH >= -97;    // Deep discount, higher risk/reward
    const normalAccum = fromATH <= -30 && fromATH >= -55;  // Normal bear market level

    if (inGoldenZone && rangePos < 0.50) breakdown.entryAccuracy = 10;      // Perfect zone + near lows
    else if (inGoldenZone) breakdown.entryAccuracy = 8;                      // Good zone
    else if (deepAccum && rangePos < 0.50) breakdown.entryAccuracy = 9;     // Deep discount at lows
    else if (deepAccum) breakdown.entryAccuracy = 7;
    else if (normalAccum && rangePos < 0.40) breakdown.entryAccuracy = 7;   // Decent pullback at lows
    else if (normalAccum) breakdown.entryAccuracy = 5;
    else if (rangePos < 0.30) breakdown.entryAccuracy = 4;                   // Near lows (unknown ATH)
    else breakdown.entryAccuracy = 2;

    // ── FACTOR 6: MOMENTUM (10pts) ────────────────────────────
    // Relative strength, recovery signs, volume trend
    if (rs7d > 15 && priceFlat) breakdown.momentum = 10;    // Outperforming + flat = SM accumulating
    else if (rs7d > 8 && change24h >= 0) breakdown.momentum = 9;
    else if (rs7d > 3 && change24h >= 0) breakdown.momentum = 7;
    else if (rs7d > 0 && btcChange7d < 0) breakdown.momentum = 8; // Holding while BTC falls = strong
    else if (rs7d >= -3 && change24h >= 0) breakdown.momentum = 6;
    else if (change24h > 2 && (change7d || 0) > 0) breakdown.momentum = 5;
    else if (rs7d < -8) breakdown.momentum = 2;
    else breakdown.momentum = 4;

    // Momentum bonus: recovery from extreme levels
    if (fgValue <= 25) breakdown.momentum = Math.min(10, breakdown.momentum + 2);

    return breakdown;
  }

  // ════════════════════════════════════════════════════════════
  // ZONE + TARGET CALCULATION
  // ════════════════════════════════════════════════════════════
  function calcZonesAndTargets(price, low, high, ath, score) {
    const range = Math.max(high - low, price * 0.01);
    const fromATH = ath > 0 ? ((price - ath) / ath * 100) : 0;

    // Entry zone: based on ATH Fib levels (most accurate for post-bear setups)
    // Optimal buy: current price or slight pullback (within 1%)
    // We DON'T chase — entry = current price ±1%
    const entryOptimal = price * 0.999; // ~current price
    const entryLo = Math.max(price * 0.94, low * 0.98); // 6% below or near day low
    const entryHi = price * 1.01;  // 1% above current (market order tolerance)

    // Stop loss: below accumulation zone (structure invalidation)
    // Use day low × 0.97 or price × (1 - ATH-based zone)
    const zoneWidth = score >= 80 ? 0.07 : score >= 70 ? 0.10 : 0.13;
    const slPrice = Math.max(price * (1 - zoneWidth - 0.03), low * 0.96);

    // Target prices: Fibonacci retracement of ATH dump
    let tp1, tp2, tp3;
    if (ath > 0 && fromATH < -25) {
      const toATH = ath - price;
      tp1 = Math.min(price + toATH * 0.382, price * 3.0);   // 38.2% retrace
      tp2 = Math.min(price + toATH * 0.618, price * 6.0);   // 61.8% retrace
      tp3 = Math.min(price + toATH * 1.000, price * 10.0);  // Full ATH retrace
    } else {
      // No ATH data: use momentum-based targets
      const sl = price - slPrice;
      tp1 = price + sl * 3;
      tp2 = price + sl * 5;
      tp3 = price + sl * 8;
    }

    // R:R calculation
    const slDist = Math.max(price - slPrice, price * 0.005);
    const rr1 = +((tp1 - price) / slDist).toFixed(2);
    const rr2 = +((tp2 - price) / slDist).toFixed(2);
    const rr3 = +((tp3 - price) / slDist).toFixed(2);

    return { entryOptimal, entryLo, entryHi, slPrice, tp1, tp2, tp3, rr1, rr2, rr3, zoneWidth, fromATH };
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

    // BTC context
    const binMap = {};
    binTickers.forEach(t => { if (t?.symbol) binMap[t.symbol] = t; });
    const btcT = binMap['BTCUSDT'];
    const btcPrice = +(btcT?.lastPrice || 0);
    const btcChange24h = +(btcT?.priceChangePercent || 0);
    let btcChange7d = 0, btcTrend = 'NEUTRAL';
    if (btcK.length >= 50) {
      const cur = btcK[btcK.length - 1];
      const w7 = btcK.length >= 168 ? btcK[btcK.length - 168] : btcK[0];
      btcChange7d = w7 > 0 ? +((cur - w7) / w7 * 100).toFixed(2) : 0;
      const ma50 = btcK.slice(-50).reduce((a, b) => a + b, 0) / 50;
      btcTrend = cur > ma50 * 1.02 ? 'BULLISH' : cur < ma50 * 0.98 ? 'BEARISH' : 'NEUTRAL';
    }

    const dsh = Math.floor((Date.now() - new Date('2024-04-20').getTime()) / 86400000);
    const cycleBonus = dsh < 365 ? 3 : dsh < 547 ? 2 : dsh < 730 ? 0 : -2;
    const cyclePhase = dsh < 365 ? 'Bull Early ✅' : dsh < 547 ? 'Bull Peak ⚠️' : dsh < 730 ? 'Distribution ⚠️' : 'Bear/Accum';
    const inMR = [{ s: new Date('2026-03-08'), e: new Date('2026-03-31') }, { s: new Date('2026-07-06'), e: new Date('2026-07-30') }].some(p => new Date() >= p.s && new Date() <= p.e);

    // Stablecoin filter
    const STABLES = new Set([
      'USDT','USDC','BUSD','TUSD','DAI','FDUSD','USDP','FRAX','LUSD','USDS','SUSD','GUSD',
      'PYUSD','CRVUSD','USDD','CUSD','USDX','USDB','XUSD','USDJ','AUSD','AGEUR','JEUR',
      'XSGD','EURS','EURT','CADC','GYEN','NZDS','BRLA','MXNT','BIDR','BVND','IDRT',
      'TRYB','BRLC','PAXG','XAUT','WBTC','WETH','WBNB','STETH','CBETH','RETH','BETH',
    ]);
    const BAD = ['UP','DOWN','BEAR','BULL','3L','3S','2L','2S'];
    const HAN = /[\u4e00-\u9fff\u3400-\u4dbf]/;

    // Build CG enrichment map
    const cgMap = {};
    cgMarkets.forEach(c => { if (c?.symbol) cgMap[c.symbol.toUpperCase()] = c; });

    // Build candidates
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
      // Stablecoin price check
      if (price >= 0.97 && price <= 1.03 && Math.abs(+(t.priceChangePercent || 0)) < 2) return;
      seen.add(base);
      const cg = cgMap[base];
      candidates.push({
        base, price, vol24h: vol,
        change24h: +(t.priceChangePercent || 0),
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
      if (vol < 1000000 || price <= 0) return;
      if (price >= 0.97 && price <= 1.03) return;
      candidates.push({
        base, price, vol24h: vol,
        change24h: +(c.price_change_percentage_24h || 0),
        high: price * 1.02, low: price * 0.98,
        open: price / (1 + (+(c.price_change_percentage_24h || 0)) / 100),
        change7d: +(c.price_change_percentage_7d || 0),
        change30d: +(c.price_change_percentage_30d || 0),
        ath: +(c.ath || 0), marketCap: +(c.market_cap || 0), cgName: c.name || base,
      });
    });

    // ── PROCESS: SCORE → KILL → CLASSIFY ─────────────────────
    const killed = { DEAD_SETUP: 0, POOR_RR: 0, TOO_LATE: 0, BREAKDOWN: 0, LOW_SCORE: 0, STALE: 0 };
    const validSetups = [];

    for (const coin of candidates.slice(0, 800)) {
      const { base: sym, price, ath, change24h } = coin;
      if (!price || price <= 0) continue;
      if (ath > 0 && ((price - ath) / ath * 100) < -99) { killed.STALE++; continue; } // Dead project

      // Preliminary score to get zone widths
      const breakdown = scoreSetup(coin, btcChange24h, btcChange7d, fgValue);
      const preScore = Object.values(breakdown).reduce((a, b) => a + b, 0) + cycleBonus;

      // Calculate zones
      const zones = calcZonesAndTargets(price, coin.low, coin.high, ath, preScore);

      // ── FILL RR SCORE ────────────────────────────────────────
      if (zones.rr1 >= 10) breakdown.riskReward = 15;
      else if (zones.rr1 >= 7) breakdown.riskReward = 12;
      else if (zones.rr1 >= 5) breakdown.riskReward = 10;
      else if (zones.rr1 >= 3) breakdown.riskReward = 6;
      else breakdown.riskReward = 0;

      // Final score with all factors
      const totalScore = Math.min(100, Object.values(breakdown).reduce((a, b) => a + b, 0) + cycleBonus + (inMR ? -2 : 0));

      // ── KILL ENGINE ──────────────────────────────────────────
      const killResult = killEngine(price, zones.entryOptimal, zones.slPrice, zones.rr1, change24h);
      if (killResult.killed) {
        const k = killResult.tag.includes('TOO_LATE') ? 'TOO_LATE' : killResult.tag.includes('RR') ? 'POOR_RR' : killResult.tag.includes('BREAK') ? 'BREAKDOWN' : 'DEAD_SETUP';
        killed[k]++;
        continue;
      }

      // ── SCORE THRESHOLD: Remove anything under 70 ────────────
      if (totalScore < 70) { killed.LOW_SCORE++; continue; }

      // ── CLASSIFY ──────────────────────────────────────────────
      const tier = totalScore >= 80 ? 'S' : 'A';
      const tierLabel = tier === 'S' ? '🔥 TIER S — IMMINENT' : '✅ TIER A — READY';
      const timeframe = tier === 'S' ? '1-7 hari' : '1-2 minggu';
      const fromATH = zones.fromATH;

      // Status determination
      const priceVsEntry = (price - zones.entryOptimal) / price;
      let status;
      if (priceVsEntry < -0.01) status = 'VALID ✅ — PRIME ENTRY (harga di bawah optimal)';
      else if (priceVsEntry < 0.01) status = 'VALID ✅ — AT OPTIMAL ENTRY';
      else status = 'VALID ✅ — NEAR OPTIMAL (pasang limit order)';

      // Build reason string
      const reasons = [];
      if (breakdown.volAccum >= 20) reasons.push(`Volume ${(coin.vol24h / 1e6).toFixed(0)}M + harga ${change24h >= 0 ? '+' : ''}${change24h.toFixed(1)}% = SM absorption`);
      if (breakdown.liqSweep >= 15) reasons.push(`Lower wick ${(Math.max(coin.open, price) - coin.low) / Math.max(coin.high - coin.low, 0.001) > 0.4 ? 'kuat' : 'terdeteksi'} — SSL swept`);
      if (breakdown.structure >= 15) reasons.push(`CHoCH/BOS bullish terkonfirmasi`);
      if (breakdown.riskReward >= 12) reasons.push(`R:R ${zones.rr1}:1 (TP1), ${zones.rr2}:1 (TP2) — excellent`);
      if (fromATH < -50) reasons.push(`${fromATH.toFixed(0)}% dari ATH — deep discount zone`);
      if (breakdown.momentum >= 8) reasons.push(`Relative Strength vs BTC positif`);

      const recommendation = tier === 'S'
        ? `TRADE ✅ — Entry sekarang di $${fmtP(zones.entryOptimal)}. SL: $${fmtP(zones.slPrice)}. TP1: $${fmtP(zones.tp1)} (+${(((zones.tp1 - price) / price) * 100).toFixed(1)}%, R:${zones.rr1})`
        : `LIMIT ORDER ✅ — Set limit di $${fmtP(zones.entryLo)}-$${fmtP(zones.entryOptimal)}. SL: $${fmtP(zones.slPrice)}. TP1: $${fmtP(zones.tp1)} (+${(((zones.tp1 - price) / price) * 100).toFixed(1)}%)`;

      validSetups.push({
        rank: 0, symbol: sym, name: coin.cgName || sym,
        price, change24h: +change24h.toFixed(2),
        change7d: +(coin.change7d || 0).toFixed(2),
        change30d: +(coin.change30d || 0).toFixed(2),
        volume24h: coin.vol24h, fromATH: fromATH !== 0 ? +fromATH.toFixed(1) : null,

        // Institutional Format
        tier, tierLabel, timeframe, status, totalScore,
        breakdown: {
          volumeAccumulation: { score: breakdown.volAccum, max: 25 },
          liquiditySweep: { score: breakdown.liqSweep, max: 20 },
          structureStrength: { score: breakdown.structure, max: 20 },
          riskReward: { score: breakdown.riskReward, max: 15, rr1: zones.rr1, rr2: zones.rr2, rr3: zones.rr3 },
          entryAccuracy: { score: breakdown.entryAccuracy, max: 10 },
          momentum: { score: breakdown.momentum, max: 10 },
        },
        entryZone: {
          lo: +zones.entryLo.toFixed(8),
          optimal: +zones.entryOptimal.toFixed(8),
          hi: +zones.entryHi.toFixed(8),
        },
        stopLoss: { price: +zones.slPrice.toFixed(8), pct: +((zones.slPrice - price) / price * 100).toFixed(1) },
        targets: {
          tp1: { price: +zones.tp1.toFixed(8), pct: +((zones.tp1 - price) / price * 100).toFixed(1), rr: zones.rr1, label: coin.ath > 0 ? 'Fib 38.2% dari ATH' : 'TP1 (3× risk)' },
          tp2: { price: +zones.tp2.toFixed(8), pct: +((zones.tp2 - price) / price * 100).toFixed(1), rr: zones.rr2, label: coin.ath > 0 ? 'Fib 61.8% dari ATH' : 'TP2 (5× risk)' },
          tp3: { price: +zones.tp3.toFixed(8), pct: +((zones.tp3 - price) / price * 100).toFixed(1), rr: zones.rr3, label: coin.ath > 0 ? 'ATH area' : 'TP3 Swing' },
        },
        reasons: reasons.slice(0, 4),
        recommendation,
        positionSize: tier === 'S' ? '2-3% kapital' : '1-2% kapital',
      });
    }

    validSetups.sort((a, b) => b.totalScore - a.totalScore || b.volume24h - a.volume24h);
    validSetups.forEach((r, i) => r.rank = i + 1);

    const tierS = validSetups.filter(r => r.tier === 'S').slice(0, 10);
    const tierA = validSetups.filter(r => r.tier === 'A').slice(0, 15);
    const totalKilled = Object.values(killed).reduce((a, b) => a + b, 0);

    res.setHeader('Cache-Control', 's-maxage=120');
    return res.status(200).json({
      timestamp: Date.now(),
      scanTime: ((Date.now() - start) / 1000).toFixed(1),
      totalScanned: candidates.length,
      totalQualified: validSetups.length,
      totalKilled,
      killedBreakdown: killed,
      tierGroups: { S: tierS, A: tierA, B: [], C: [] }, // Only S and A output
      allResults: validSetups.slice(0, 25),
      marketContext: {
        btcTrend, btcPrice, btcChange24h, btcChange7d,
        fgValue,
        fgLabel: fgValue <= 25 ? 'Extreme Fear 🔥' : fgValue <= 45 ? 'Fear 😨' : fgValue <= 55 ? 'Neutral ⚖️' : fgValue <= 75 ? 'Greed 😄' : 'Extreme Greed 💀',
        cyclePhase, daysSinceHalving: dsh, inMR,
        dominance: +(globalData?.market_cap_percentage?.btc || 0).toFixed(1),
        bestScanTime: fgValue <= 35 ? '✅ Fear = SM akumulasi = waktu terbaik' : fgValue >= 75 ? '⚠️ Greed = SM distribusi = hati-hati' : '⚖️ Netral — selektif',
        engineNote: 'Only TIER S (80+) and TIER A (70+) are shown. Everything else KILLED.',
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
