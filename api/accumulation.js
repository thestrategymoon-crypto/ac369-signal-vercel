// api/accumulation.js — AC369 FUSION v12.1
// ══════════════════════════════════════════════════════════════════
// COMPLETE 7-LAYER ICT/SMC DETECTION ENGINE
//
// Layer 1: SM Pattern   — Wyckoff Spring + Order Blocks
// Layer 2: Liq Sweep    — SSL/BSL Stop Hunt + ICT Inducement
// Layer 3: Structure    — MSS + BOS + CHoCH + FVG confirmation
// Layer 4: Volume       — Institutional anomaly (OI-weighted)
// Layer 5: Derivatives  — OI divergence + Funding Rate signal
// Layer 6: Halving      — Bitcoin 4-year cycle alignment
// Layer 7: Narrative    — DePIN/RWA/DeSci/AI/GameFi context
//
// SETUP LOCK RULES:
//   • Once valid → Entry/SL/TP LOCKED (immutable)
//   • Removed ONLY: TP2 hit OR SL hit
//   • Never disappears on rescan
//   • "Engine Disciplined" if zero qualify
// ══════════════════════════════════════════════════════════════════

const TRADE_STORE   = new Map();
const SETUP_LOCK    = new Map();
const SETUP_TS      = new Map();
const DECISION_HIST = new Map();
const DERIV_CACHE   = new Map();
const STATS         = { wins: 0, losses: 0 };

const MAX_MAJOR     = 3;
const MAX_MEME      = 2;
const MAX_WATCHLIST = 10;
const DERIV_TTL     = 5 * 60 * 1000;

// ── ASSET SETS ───────────────────────────────────────────────────
const MAJORS = new Set([
  'BTC','ETH','BNB','SOL','XRP','ADA','AVAX','DOT','LINK','MATIC',
  'ATOM','NEAR','UNI','LTC','BCH','TRX','FIL','ALGO','VET','HBAR',
  'ICP','FTM','SAND','MANA','AXS','THETA','EOS','ZEC','DASH','XLM',
  'APT','ARB','OP','SUI','SEI','TIA','INJ','KAVA','ROSE','ONE','STX',
  'IMX','BLUR','CFX','MASK','AGIX','FET','OCEAN','RNDR','GRT',
]);
const MEMES = new Set([
  'DOGE','SHIB','PEPE','BONK','WIF','FLOKI','BRETT','MOG','SPX',
  'POPCAT','MEW','BOME','SLERF','MYRO','PONKE','TURBO','NEIRO',
  'PNUT','GOAT','ACT','MOODENG','LUNC','PEOPLE','BANANA','GIGA',
  'CHEEMS','WOJAK','BOBO','TOSHI','BABYDOGE','ELON','SAMO',
]);

// ── LAYER 7: NARRATIVE MAP ────────────────────────────────────────
const NARRATIVES = {
  IOTX:'DePIN',HNT:'DePIN',FIL:'DePIN',AR:'DePIN',STORJ:'DePIN',ANKR:'DePIN',
  ONDO:'RWA',POLYX:'RWA',CFG:'RWA',MANTRA:'RWA',OM:'RWA',PAXG:'RWA',
  VITA:'DeSci',BIO:'DeSci',HAIR:'DeSci',RSC:'DeSci',
  FET:'AI',AGIX:'AI',OCEAN:'AI',RNDR:'AI',TAO:'AI',WLD:'AI',NMR:'AI',
  AXS:'GameFi',SAND:'GameFi',MANA:'GameFi',IMX:'GameFi',GALA:'GameFi',RON:'GameFi',
  ARB:'L2',OP:'L2',MATIC:'L2',STRK:'L2',ZK:'L2',METIS:'L2',
  UNI:'DeFi',AAVE:'DeFi',CRV:'DeFi',GMX:'DeFi',GNS:'DeFi',
  TIA:'Modular',AVAIL:'Modular',EIGEN:'Modular',
  LINK:'Oracle',BAND:'Oracle',API3:'Oracle',
  ZEC:'Privacy',SCRT:'Privacy',ROSE:'Privacy',
};
const TRENDING_NARRATIVES = new Set(['AI','DePIN','RWA','DeSci','Modular','L2']);

function classifyAsset(sym, mcap, vol) {
  if (MAJORS.has(sym)) return 'MAJOR';
  if (MEMES.has(sym))  return 'MEME';
  if (mcap > 0 && mcap < 100e6 && vol / Math.max(mcap, 1) > 0.5) return 'MEME';
  if (mcap > 0 && mcap < 200e6) return 'MID';
  return 'ALT';
}

const TG_TOKEN = (typeof process !== 'undefined' && process.env?.TG_BOT_TOKEN) || '';
const TG_CHAT  = (typeof process !== 'undefined' && process.env?.TG_CHAT_ID)   || '';
async function tg(msg) {
  if (!TG_TOKEN || !TG_CHAT) return;
  try {
    await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TG_CHAT, text: msg, parse_mode: 'HTML' }),
    });
  } catch (_) {}
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'POST') {
    try {
      const body = req.body || {};
      if (body.action === 'syncWatchlist') {
        let r = 0;
        for (const w of (body.watchlist || [])) {
          if (w.symbol && !SETUP_LOCK.has(w.symbol) && !['COMPLETED','INVALID'].includes(w.status)) {
            SETUP_LOCK.set(w.symbol, w); r++;
          }
        }
        return res.status(200).json({ ok: true, restored: r, total: SETUP_LOCK.size });
      }
      for (const t of (body.trades || [])) {
        if (t.symbol && !TRADE_STORE.has(t.symbol)) {
          TRADE_STORE.set(t.symbol, { state: t.status || 'ACTIVE', ep: t.entry, sl: t.sl, tp1: t.tp1, tp2: t.tp2, tier: t.tier || 'A', score: t.score || 75, assetType: t.type || 'ALT', exitStrategy: 'TP2', trailActive: false });
        }
      }
      return res.status(200).json({ ok: true, synced: body.trades?.length || 0 });
    } catch (e) { return res.status(400).json({ error: e.message }); }
  }

  const sf = async (url, ms = 6000) => {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), ms);
    try {
      const r = await fetch(url, { signal: c.signal, headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } });
      clearTimeout(t); if (!r.ok) return null; return await r.json();
    } catch { clearTimeout(t); return null; }
  };

  // ════════════════════════════════════════════════════════════════
  // LAYER 5: DERIVATIVES ENGINE
  // Bull: OI rising + funding negative → squeeze incoming
  // ════════════════════════════════════════════════════════════════
  async function fetchDerivatives(symbols) {
    const now = Date.now();
    const result = {};
    const FUTURES = new Set(['BTC','ETH','BNB','SOL','XRP','ADA','AVAX','DOGE','LINK','DOT','MATIC','ATOM','UNI','ARB','OP','APT','SUI','SEI','TIA','INJ','PEPE','WIF','BONK','SHIB','TRX','FTM','AXS','SAND','FET','AGIX','RNDR','TAO']);
    const targets = symbols.filter(s => FUTURES.has(s)).slice(0, 30);
    if (!targets.length) return result;
    const fundingAll = await sf('https://fapi.binance.com/fapi/v1/premiumIndex', 4000);
    const fundingMap = {};
    if (Array.isArray(fundingAll)) {
      fundingAll.forEach(f => {
        const sym = (f.symbol || '').replace('USDT', '');
        if (sym) fundingMap[sym] = { fundingRate: parseFloat(f.lastFundingRate || 0) };
      });
    }
    const OI_TOP = targets.slice(0, 15);
    const oiResults = await Promise.allSettled(OI_TOP.map(sym => sf(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${sym}USDT`, 3000)));
    OI_TOP.forEach((sym, i) => {
      const fr = fundingMap[sym] || {};
      const oiR = oiResults[i];
      const oi = oiR.status === 'fulfilled' && oiR.value ? parseFloat(oiR.value.openInterest || 0) : 0;
      const cached = DERIV_CACHE.get(sym);
      let oiChange = 0;
      if (cached && now - cached.time < DERIV_TTL) oiChange = cached.oi > 0 ? (oi - cached.oi) / cached.oi * 100 : 0;
      DERIV_CACHE.set(sym, { oi, time: now });
      const funding = fr.fundingRate || 0;
      let derivSignal = 'NEUTRAL', derivScore = 0;
      if (oi > 0) {
        if (oiChange > 5 && funding < -0.0001) { derivSignal = 'BULLISH_SQUEEZE'; derivScore = 15; }
        else if (oiChange > 3 && funding < 0)  { derivSignal = 'BULLISH_ACCUM';   derivScore = 12; }
        else if (oiChange > 2 && funding < 0.0002) { derivSignal = 'MILD_BULL';   derivScore = 8; }
        else if (oiChange < -5 && funding > 0.001) { derivSignal = 'BEARISH_UNWIND'; derivScore = -10; }
        else if (funding > 0.003)  { derivSignal = 'OVERLEVERAGED';   derivScore = -8; }
        else if (funding < -0.003) { derivSignal = 'OVERSOLD_SHORTS'; derivScore = 10; }
      }
      result[sym] = { oi, oiChange: +oiChange.toFixed(2), fundingRate: +funding.toFixed(6), fundingPct: +(funding * 100).toFixed(4), signal: derivSignal, score: derivScore, note: `OI ${oiChange > 0 ? '+' : ''}${oiChange.toFixed(1)}% | FR ${(funding * 100).toFixed(4)}%` };
    });
    targets.forEach(sym => {
      if (result[sym]) return;
      const fr = fundingMap[sym];
      if (!fr) return;
      const funding = fr.fundingRate;
      let signal = 'NEUTRAL', score = 0;
      if (funding < -0.001) { signal = 'OVERSOLD_SHORTS'; score = 8; }
      else if (funding > 0.003) { signal = 'OVERLEVERAGED'; score = -6; }
      result[sym] = { oi: 0, oiChange: 0, fundingRate: +funding.toFixed(6), fundingPct: +(funding * 100).toFixed(4), signal, score, note: `FR ${(funding * 100).toFixed(4)}%` };
    });
    return result;
  }

  // ════════════════════════════════════════════════════════════════
  // LAYER 6: HALVING CYCLE + MOON PHASE
  // ════════════════════════════════════════════════════════════════
  function halvingCycle() {
    const d = (Date.now() - new Date('2024-04-19').getTime()) / 86400000;
    if (d < 0)   return { phase: 'PRE_HALVING',   bonus: 5,  emoji: '⏳', desc: 'Pre-halving accumulation' };
    if (d < 60)  return { phase: 'HALVING_SHOCK', bonus: 2,  emoji: '💥', desc: 'Post-halving volatile' };
    if (d < 180) return { phase: 'EARLY_BULL',    bonus: 8,  emoji: '🌱', desc: 'Early bull — best accum window' };
    if (d < 365) return { phase: 'BULL_RUN',      bonus: 10, emoji: '🚀', desc: 'Bull run — ride momentum' };
    if (d < 540) return { phase: 'PEAK_EUPHORIA', bonus: -5, emoji: '🎯', desc: 'Peak — take profits' };
    if (d < 730) return { phase: 'BEAR_PHASE',    bonus: -12,emoji: '🐻', desc: 'Bear — strict filter' };
    if (d < 900) return { phase: 'ACCUMULATION',  bonus: 6,  emoji: '💎', desc: 'Deep accumulation' };
    return             { phase: 'PRE_HALVING',    bonus: 5,  emoji: '⏳', desc: 'Pre-halving' };
  }
  function moonPhase() {
    const p = ((Date.now() - new Date('2024-01-11').getTime()) % (29.53 * 86400000) + (29.53 * 86400000)) % (29.53 * 86400000) / (29.53 * 86400000);
    if (p < 0.05 || p > 0.95) return { phase: 'NEW_MOON',  bonus: 3,  emoji: '🌑', label: 'New Moon' };
    if (p < 0.30)               return { phase: 'WAXING',    bonus: 1,  emoji: '🌒', label: 'Waxing' };
    if (p < 0.55)               return { phase: 'FULL_MOON', bonus: 2,  emoji: '🌕', label: 'Full Moon' };
    return                             { phase: 'WANING',    bonus: -1, emoji: '🌘', label: 'Waning' };
  }

  // ════════════════════════════════════════════════════════════════
  // MARKET REGIME
  // ════════════════════════════════════════════════════════════════
  function regime(btcCh7, btcCh24, btcDom, fg, trend, hv, moon) {
    const cb = hv.bonus + moon.bonus;
    if (Math.abs(btcCh24) > 12 || fg <= 8 || fg >= 93) return { r: 'CHAOTIC', kill: true, color: '#ff4466', piMin: 5, sMin: 99, cMin: 99, bonus: -999, focus: 'NO TRADE', hv, moon };
    if (btcCh7 < -8 || (btcCh7 < -5 && trend === 'BEARISH')) return { r: 'BEAR', kill: false, color: '#ff4466', piMin: 4, sMin: 82, cMin: 85, bonus: -10 + cb, focus: `Bear strict. ${hv.emoji} ${hv.phase}`, hv, moon };
    if (btcCh7 > 8 || (btcCh7 > 5 && trend === 'BULLISH' && fg > 50)) return { r: 'BULL', kill: false, color: '#00ffd0', piMin: 3, sMin: 75, cMin: 80, bonus: 8 + cb, focus: `Bull optimal. ${hv.emoji} ${hv.desc}`, hv, moon };
    return { r: 'RANGE', kill: false, color: '#FFB300', piMin: 2, sMin: 72, cMin: 78, bonus: 3 + cb, focus: `Range accumulation. ${moon.emoji} ${moon.label}`, hv, moon };
  }

  // ════════════════════════════════════════════════════════════════
  // ★ INDEPENDENT WATCHLIST UPDATER
  // Runs FIRST before any scan — watchlist never disappears
  // ════════════════════════════════════════════════════════════════
  function updateWatchlistPrices(bmap) {
    const now = Date.now(), events = [];
    SETUP_LOCK.forEach((w, sym) => {
      if (['COMPLETED','INVALID'].includes(w.status)) return;
      const ticker = bmap[sym + 'USDT'];
      if (!ticker) return;
      const price = +(ticker.lastPrice || 0);
      if (!price) return;
      let sl = w.sl;
      if (w.trailActive && w.entryPrice > 0) {
        const trail = +(price * (w.isMeme ? 0.90 : 0.93)).toFixed(8);
        sl = Math.max(w.sl, trail);
        if (sl > w.sl) SETUP_LOCK.set(sym, { ...w, sl });
      }
      if (price <= sl * 0.999) {
        const pnl = w.entryPrice > 0 ? +((price - w.entryPrice) / w.entryPrice * 100).toFixed(2) : 0;
        SETUP_LOCK.set(sym, { ...w, status: 'INVALID', currentPrice: price, pnl, closedAt: now });
        STATS.losses++;
        events.push({ sym, type: 'SL_HIT', price, pnl });
        tg(`❌ <b>SL HIT — ${sym}</b>\n📉 ${pnl}%\nSL: $${fmtP(sl)} | Entry: $${fmtP(w.entryPrice)}`);
        return;
      }
      if (price >= w.tp2 * 0.998) {
        const pnl = w.entryPrice > 0 ? +((w.tp2 - w.entryPrice) / w.entryPrice * 100).toFixed(2) : 0;
        SETUP_LOCK.set(sym, { ...w, status: 'COMPLETED', currentPrice: price, pnl, closedAt: now });
        STATS.wins++;
        events.push({ sym, type: 'TP2_HIT', price, pnl });
        tg(`✅ <b>TP2 HIT — ${sym}</b>\n💰 +${pnl}% | R:${w.rr2}`);
        return;
      }
      if (price >= w.tp1 * 0.998 && w.status !== 'TP1_HIT' && w.status !== 'COMPLETED') {
        const pnl = w.entryPrice > 0 ? +((w.tp1 - w.entryPrice) / w.entryPrice * 100).toFixed(2) : 0;
        SETUP_LOCK.set(sym, { ...w, status: 'TP1_HIT', currentPrice: price, pnl, trailActive: true, sl: Math.max(w.sl, w.entryPrice || w.sl) });
        events.push({ sym, type: 'TP1_HIT', price, pnl });
        tg(`🎯 <b>TP1 HIT — ${sym}</b>\n+${pnl}% | SL → BE: $${fmtP(w.entryPrice)}`);
        return;
      }
      if (price >= w.entryLo && price <= w.entryHi && w.status === 'WATCHING') {
        SETUP_LOCK.set(sym, { ...w, status: 'TRIGGERED', entryPrice: price, triggeredAt: now, currentPrice: price });
        events.push({ sym, type: 'TRIGGERED', price });
        tg(`⚡ <b>TRIGGERED — ${sym}</b>\n$${fmtP(price)} in zone\n🎯 ${fmtP(w.entryLo)}–${fmtP(w.entryHi)}\nSL: $${fmtP(w.sl)} | TP1: $${fmtP(w.tp1)}`);
        return;
      }
      const pnl = w.entryPrice > 0 ? +((price - w.entryPrice) / w.entryPrice * 100).toFixed(2) : 0;
      SETUP_LOCK.set(sym, { ...w, currentPrice: price, pnl });
    });
    return events;
  }

  // ════════════════════════════════════════════════════════════════
  // ICT KILL ZONE — Trading session timing
  // Best entries: London Open + NY Open + NY/London Overlap
  // ════════════════════════════════════════════════════════════════
  function getKillZone() {
    const now = new Date();
    const utcH = now.getUTCHours();
    const utcM = now.getUTCMinutes();
    const totalMin = utcH * 60 + utcM;
    // London Open: 08:00–10:00 UTC
    if (totalMin >= 480 && totalMin < 600)  return { zone: 'LONDON_OPEN',  quality: 'HIGH',   bonus: 5,  emoji: '🇬🇧', desc: 'London Open — institutional flow begins' };
    // NY/London Overlap: 13:00–16:00 UTC (highest volume)
    if (totalMin >= 780 && totalMin < 960)  return { zone: 'NY_OVERLAP',   quality: 'HIGH',   bonus: 8,  emoji: '🔥', desc: 'NY/London Overlap — peak liquidity' };
    // NY Open: 13:30–15:00 UTC
    if (totalMin >= 810 && totalMin < 900)  return { zone: 'NY_OPEN',      quality: 'HIGH',   bonus: 5,  emoji: '🗽', desc: 'NY Open — institutional participation' };
    // Asia Open: 00:00–02:00 UTC
    if (totalMin >= 0 && totalMin < 120)    return { zone: 'ASIA_OPEN',    quality: 'MEDIUM', bonus: 2,  emoji: '🌏', desc: 'Asia Open — lower volume' };
    // Pre-London: 06:00–08:00 UTC
    if (totalMin >= 360 && totalMin < 480)  return { zone: 'PRE_LONDON',   quality: 'MEDIUM', bonus: 2,  emoji: '⏰', desc: 'Pre-London — positioning window' };
    // Dead Zone: 17:00–23:00 UTC
    if (totalMin >= 1020 || totalMin < 0)   return { zone: 'DEAD_ZONE',    quality: 'LOW',    bonus: -3, emoji: '💤', desc: 'Dead Zone — avoid new entries' };
    return { zone: 'REGULAR', quality: 'MEDIUM', bonus: 0, emoji: '📊', desc: 'Regular session' };
  }

  // ════════════════════════════════════════════════════════════════
  // LAYER 2: ICT LIQUIDITY HUNT
  // SSL sweep, BSL sweep, Inducement, Stop Hunt, FVG, Equal Lows
  // ════════════════════════════════════════════════════════════════
  function detectICTLiquidity(price, high, low, open, ch24, ch7, lw, rp, body, vol) {
    const signals = [];
    let liqScore = 0;
    const range = high - low || price * 0.01;
    const vt = vol >= 100e6 ? 3 : vol >= 30e6 ? 2 : vol >= 5e6 ? 1 : 0;

    // SSL Sweep: wick below swing lows + recovery = bullish
    const sslSweep = lw > 0.40 && rp < 0.45 && price > low * 1.002 && ch24 > -3;
    if (sslSweep) {
      const strength = lw > 0.65 ? 'STRONG' : lw > 0.50 ? 'MODERATE' : 'WEAK';
      const pts = strength === 'STRONG' ? 22 : strength === 'MODERATE' ? 14 : 8;
      signals.push({ type: 'SSL_SWEEP', strength, pts, note: `SSL: wick ${(lw*100).toFixed(0)}% below lows — retail stops cleared` });
      liqScore += pts;
    }

    // BSL Sweep: price spikes above highs then reverses
    const bslSweep = rp > 0.85 && body < 0.25 && ch24 < 0 && !sslSweep;
    if (bslSweep) {
      signals.push({ type: 'BSL_SWEEP', strength: 'MODERATE', pts: 10, note: 'BSL grabbed above swing high — distribution warning' });
      liqScore += 10;
    }

    // ICT Inducement: fake bearish drop lures retail short → SM reverses
    const hasInducement = (ch7 || 0) < -8 && lw > 0.30 && ch24 > 1 && vt >= 1;
    if (hasInducement) {
      signals.push({ type: 'INDUCEMENT', strength: 'STRONG', pts: 16, note: `ICT Inducement: ${(ch7||0).toFixed(1)}% drop lured retail short → reversal` });
      liqScore += 16;
    }

    // Stop Hunt: aggressive spike + fast recovery
    const stopHunt = lw > 0.55 && rp < 0.35 && price > low * 1.005 && Math.abs(ch24) < 6;
    if (stopHunt) {
      signals.push({ type: 'STOP_HUNT', strength: 'STRONG', pts: 20, note: `Stop Hunt: ${(lw*100).toFixed(0)}% wick — SM engineering liquidity` });
      liqScore += 20;
    }

    // Bull FVG (Fair Value Gap)
    const hasBullFVG = ch24 > 3 && body > 0.35 && rp > 0.55 && vt >= 1;
    const fvgZone = hasBullFVG ? { lo: +(price - range * 0.35).toFixed(8), hi: +(price - range * 0.15).toFixed(8), note: 'Bull FVG — imbalance pullback zone' } : null;
    if (hasBullFVG) {
      signals.push({ type: 'BULL_FVG', strength: 'MODERATE', pts: 12, note: `Bull FVG: $${fvgZone?.lo}–$${fvgZone?.hi}` });
      liqScore += 12;
    }

    // Equal Lows (SSL target)
    const hasEQL = Math.abs(ch24) < 1.5 && lw > 0.20 && rp < 0.40 && !sslSweep;
    if (hasEQL) {
      signals.push({ type: 'EQUAL_LOWS', strength: 'MODERATE', pts: 8, note: 'Equal Lows — double SSL target, sweep likely' });
      liqScore += 8;
    }

    return { signals, liqScore, hasSweep: sslSweep || stopHunt, hasInducement, hasFVG: hasBullFVG, fvgZone, stopHunt, hasEQL };
  }

  // ════════════════════════════════════════════════════════════════
  // LAYER 3: SMC STRUCTURAL SHIFT
  // MSS + BOS + CHoCH + FVG confirmation
  // ════════════════════════════════════════════════════════════════
  function detectMSS_FVG(price, high, low, open, ch24, ch7, ch30, rp, lw, body, vol) {
    let mssScore = 0;
    const signals = [];
    const range = high - low || price * 0.01;
    const vt = vol >= 100e6 ? 3 : vol >= 30e6 ? 2 : vol >= 5e6 ? 1 : 0;

    // MSS: downtrend → first bullish structure break with volume
    const wasBearish = (ch7 || 0) < -5 || (ch30 || 0) < -15;
    const nowBullish = ch24 > 2 && rp > 0.55;
    const hasMSS = wasBearish && nowBullish && vol > 5e6 && body > 0.25;
    if (hasMSS) {
      const str = (ch7||0) < -10 && ch24 > 4 ? 'STRONG' : 'MODERATE';
      signals.push({ type: 'MSS', strength: str, pts: str === 'STRONG' ? 25 : 16, note: `MSS: 7d ${(ch7||0).toFixed(1)}% → +${ch24.toFixed(1)}% structure shift` });
      mssScore += str === 'STRONG' ? 25 : 16;
    }

    // BOS: breaks above previous swing high
    const hasBOS = ch24 > 3 && ch24 < 15 && rp > 0.62 && lw > 0.10 && !hasMSS;
    if (hasBOS) {
      const str = ch24 > 6 && vt >= 2 ? 'STRONG' : 'MODERATE';
      signals.push({ type: 'BOS', strength: str, pts: str === 'STRONG' ? 18 : 12, note: `BOS: +${ch24.toFixed(1)}% breaks structure` });
      mssScore += str === 'STRONG' ? 18 : 12;
    }

    // CHoCH: first higher high after bearish run
    const hasCHoCH = (ch7||0) < -5 && ch24 > 1.5 && lw > 0.20 && !hasMSS && !hasBOS;
    if (hasCHoCH) {
      signals.push({ type: 'CHOCH', strength: 'MODERATE', pts: 10, note: `CHoCH: first bullish after ${(ch7||0).toFixed(1)}% downswing` });
      mssScore += 10;
    }

    // FVG after structure break
    const hasFVG = ch24 > 2.5 && body > 0.30 && rp > 0.50;
    const fvgLo = hasFVG ? +(price - range * 0.40).toFixed(8) : null;
    const fvgHi = hasFVG ? +(price - range * 0.18).toFixed(8) : null;
    const fvgZone = hasFVG ? { lo: fvgLo, hi: fvgHi, note: 'FVG — institutional imbalance pullback entry' } : null;
    if (hasFVG) {
      signals.push({ type: 'FVG_CONFIRM', strength: 'MODERATE', pts: 12, note: `FVG: $${fvgLo}–$${fvgHi}` });
      mssScore += 12;
    }

    // Premium/Discount filter (ICT: only enter discount for longs)
    const inDiscount = rp < 0.50;
    const inPremium = rp > 0.70;
    if (inPremium && !hasMSS) mssScore = Math.max(0, mssScore - 5);

    return { signals, mssScore, hasMSS, hasBOS: hasBOS || hasMSS, hasCHoCH, hasFVG, fvgZone, inDiscount, inPremium };
  }

  // ════════════════════════════════════════════════════════════════
  // CHART PATTERN DETECTION (9 patterns)
  // ════════════════════════════════════════════════════════════════
  function detectChartPattern(price, high, low, open, ch24, ch7, ch30, rp, lw, body, vol) {
    const patterns = [];
    let patternScore = 0;
    const range = (high - low) / price;
    const vt = vol >= 30e6 ? 2 : vol >= 5e6 ? 1 : 0;

    if ((ch7||0) > 8 && Math.abs(ch24) < 3 && range < 0.04)
      { patterns.push({ name: 'Bullish Flag 🚩', signal: 'bullish', pts: 15, note: 'Consolidation after impulse — continuation' }); patternScore += 15; }
    if ((ch30||0) < -20 && ch24 > 2 && lw > 0.20 && rp > 0.45)
      { patterns.push({ name: 'Inv. H&S 🙃', signal: 'bullish', pts: 20, note: 'Neckline breakout — reversal' }); patternScore += 20; }
    if ((ch7||0) < -5 && Math.abs(ch24) < 5 && lw > 0.15 && rp < 0.60)
      { patterns.push({ name: 'Falling Wedge 📐', signal: 'bullish', pts: 12, note: 'Wedge compression — upside breakout' }); patternScore += 12; }
    if ((ch30||0) > 15 && ch24 < 0 && ch24 > -6 && rp < 0.50)
      { patterns.push({ name: 'Cup & Handle ☕', signal: 'bullish', pts: 18, note: 'Handle dip — breakout expected' }); patternScore += 18; }
    if ((ch30||0) < -15 && (ch7||0) < -5 && ch24 > 2 && lw > 0.25)
      { patterns.push({ name: 'Double Bottom W 📊', signal: 'bullish', pts: 14, note: 'W-shape support — high probability reversal' }); patternScore += 14; }
    if ((ch7||0) > 3 && ch24 > 0 && ch24 < 5 && rp > 0.70)
      { patterns.push({ name: 'Ascending Triangle △', signal: 'bullish', pts: 13, note: 'Higher lows + flat resistance' }); patternScore += 13; }
    if (Math.abs(ch24) < 2 && Math.abs((ch7||0)) < 5 && range < 0.06 && vt >= 1)
      { patterns.push({ name: 'Accum. Base 🏗️', signal: 'bullish', pts: 11, note: 'Tight range + volume = institutional base' }); patternScore += 11; }
    if (ch24 > 3 && body > 0.60 && rp > 0.65 && open < price)
      { patterns.push({ name: 'Bullish Engulfing 🕯️', signal: 'bullish', pts: 10, note: 'Large bullish candle = institutional demand' }); patternScore += 10; }
    if (lw > 0.50 && rp < 0.35 && ch24 > 0)
      { patterns.push({ name: 'Wyckoff Spring 🌊', signal: 'bullish', pts: 16, note: 'Wick below support + recovery = Phase C' }); patternScore += 16; }

    const topPattern = patterns.sort((a, b) => b.pts - a.pts)[0] || null;
    return { patterns, topPattern, patternScore, hasPattern: patterns.length > 0, patternCount: patterns.length };
  }

  // ════════════════════════════════════════════════════════════════
  // OTE — Optimal Trade Entry (Fibonacci 62%-79%)
  // ICT: best long entry is in discount zone 62-79% retracement
  // ════════════════════════════════════════════════════════════════
  function calcOTE(price, high, low, rp) {
    const range = high - low || price * 0.01;
    const fib236 = low + range * 0.236;
    const fib382 = low + range * 0.382;
    const fib500 = low + range * 0.500;
    const fib618 = low + range * 0.618;
    const fib705 = low + range * 0.705;
    const fib786 = low + range * 0.786;
    const fib886 = low + range * 0.886;
    const inOTE = price >= fib618 * 0.999 && price <= fib786 * 1.001;
    const inDiscount = price < fib500;
    const oteZone = { lo: +fib618.toFixed(8), hi: +fib786.toFixed(8) };
    let currentFib = 50;
    if (price >= fib886) currentFib = 88.6;
    else if (price >= fib786) currentFib = 78.6;
    else if (price >= fib705) currentFib = 70.5;
    else if (price >= fib618) currentFib = 61.8;
    else if (price >= fib500) currentFib = 50;
    else if (price >= fib382) currentFib = 38.2;
    else if (price >= fib236) currentFib = 23.6;
    else currentFib = 0;
    return { inOTE, inDiscount, oteZone, currentFib, fibs: { fib236: +fib236.toFixed(8), fib382: +fib382.toFixed(8), fib500: +fib500.toFixed(8), fib618: +fib618.toFixed(8), fib705: +fib705.toFixed(8), fib786: +fib786.toFixed(8), fib886: +fib886.toFixed(8) } };
  }

  // ════════════════════════════════════════════════════════════════
  // PROBABILITY SCORE 1-10
  // Counts confluence confirmations across all 7 layers
  // ════════════════════════════════════════════════════════════════
  function calcProbScore(pi, sm, liq, mss, pat, ote, deriv, narr, tier) {
    let conf = 0;
    const reasons = [];
    if (liq.hasSweep)      { conf += 2; reasons.push('Liquidity sweep confirmed (SSL/Stop Hunt)'); }
    if (liq.hasInducement) { conf += 1; reasons.push('ICT Inducement detected'); }
    if (mss.hasMSS)        { conf += 2; reasons.push('MSS confirmed — structural trend reversal'); }
    else if (mss.hasBOS)   { conf += 1; reasons.push('BOS confirmed — structure break bullish'); }
    if (mss.hasFVG)        { conf += 1; reasons.push('FVG confirmed — institutional imbalance'); }
    if (ote.inOTE)         { conf += 2; reasons.push(`OTE ${ote.currentFib}% Fibonacci — premium entry zone`); }
    else if (ote.inDiscount) { conf += 1; reasons.push('Price in discount zone (below 50%)'); }
    if (pat.hasPattern && pat.topPattern) { conf += 1; reasons.push(`${pat.topPattern.name} chart pattern`); }
    if (sm.strong >= 2)    { conf += 1; reasons.push('Smart money 2+ strong signals'); }
    if (pi.count >= 4)     { conf += 1; reasons.push(`Pre-impulse ${pi.count}/7 layers active`); }
    if (deriv && (deriv.signal === 'BULLISH_SQUEEZE' || deriv.signal === 'OVERSOLD_SHORTS')) { conf += 1; reasons.push(`Derivatives: ${deriv.signal}`); }
    if (narr && narr.isTrending) { conf += 0.5; reasons.push(`${narr.narrative} trending narrative`); }
    if (tier === 'S') conf += 0.5;
    const score = Math.min(10, Math.max(1, Math.round(conf)));
    const scoreLabel = score >= 8 ? '🔥 PREMIUM' : score >= 6 ? '💎 HIGH' : score >= 4 ? '📊 MODERATE' : '⚠️ LOW';
    return { score, scoreLabel, confirmations: Math.round(conf * 2) / 2, reasons };
  }

  // ════════════════════════════════════════════════════════════════
  // ENTRY PACKAGE — Complete trade plan
  // Entry at OTE, SL below structural swing, TP1 1:2, TP2 1:3
  // ════════════════════════════════════════════════════════════════
  function buildEntryPackage(price, high, low, ote, liq, mss, rr, tier, probScore, killZone) {
    const oteEntry = ote.inOTE ? +(price * 0.999).toFixed(8) : +(ote.oteZone?.lo || price * 0.99).toFixed(8);
    const entryLo = Math.max(price * 0.97, low * 0.99, ote.oteZone?.lo || price * 0.97);
    const entryHi = Math.min(price * 1.01, ote.oteZone?.hi || price * 1.01);
    const sl = rr.slPrice;
    const slDist = oteEntry - sl;
    const tp1 = +(oteEntry + slDist * 2).toFixed(8);   // 1:2 partial 50%
    const tp2 = +(oteEntry + slDist * 3).toFixed(8);   // 1:3 full
    const tp3 = rr.tp2;                                 // 1:4.5 extended
    const tp1Pct = +((tp1 - oteEntry) / oteEntry * 100).toFixed(1);
    const tp2Pct = +((tp2 - oteEntry) / oteEntry * 100).toFixed(1);
    const tp3Pct = +((tp3 - oteEntry) / oteEntry * 100).toFixed(1);
    const rr1 = +((tp1 - oteEntry) / Math.max(slDist, 0.001)).toFixed(1);
    const rr2 = +((tp2 - oteEntry) / Math.max(slDist, 0.001)).toFixed(1);
    const execMode = probScore.score >= 8 && killZone.quality !== 'LOW' ? 'AGGRESSIVE' : probScore.score >= 6 ? 'CONSERVATIVE' : 'WAIT';
    return { direction: 'LONG', oteEntry: +oteEntry.toFixed(8), entryZone: { lo: +entryLo.toFixed(8), hi: +entryHi.toFixed(8) }, sl: +sl.toFixed(8), slNote: 'Below swing low structural zone', tp1: +tp1.toFixed(8), tp1Pct, tp1Note: 'Partial 50% at 1:2', tp2: +tp2.toFixed(8), tp2Pct, tp2Note: 'Full exit 1:3', tp3: +tp3.toFixed(8), tp3Pct, tp3Note: 'Extended 1:4.5', rr1, rr2, execMode, killZone: killZone.zone, killZoneQuality: killZone.quality, fvgZone: mss.fvgZone || liq.fvgZone || null, oteZone: ote.oteZone, oteCurrentFib: ote.currentFib };
  }

  // ════════════════════════════════════════════════════════════════
  // LAYER 1: SM PATTERN (Wyckoff + OB)
  // ════════════════════════════════════════════════════════════════
  function layer1_SMPattern(price, high, low, open, ch24, ch7, vol, rp, lw, body, isMeme, hv) {
    if (ch24 > (isMeme ? 15 : 9)) return { valid: false, count: 0, score: 0, stage: 'LATE 🔴', sigs: [], pumped: true };
    const vt = vol >= 500e6 ? 5 : vol >= 100e6 ? 4 : vol >= 30e6 ? 3 : vol >= 10e6 ? 2 : vol >= 2e6 ? 1 : 0;
    const range24 = high > low ? (high - low) / low : 0;
    const sigs = [];
    const isSpring = lw > 0.45 && rp < 0.40 && price > low * 1.003 && vt >= 1;
    if (isSpring) sigs.push({ s: 'WYCKOFF_SPRING', pts: 25, note: `Spring Phase C: wick ${(lw*100).toFixed(0)}% below support` });
    if (vt >= (isMeme ? 2 : 3) && Math.abs(ch24) <= 4 && rp < 0.50) sigs.push({ s: 'ORDER_BLOCK_ACCUM', pts: 20, note: `$${(vol/1e6).toFixed(0)}M absorbed at lows — institutional OB` });
    else if (vt >= 1 && Math.abs(ch24) <= 2) sigs.push({ s: 'VOLUME_ACCUM', pts: 10, note: `$${(vol/1e6).toFixed(0)}M + flat` });
    if (range24 < (isMeme ? 0.08 : 0.055) && Math.abs(ch24) < 4 && vol > 3e6) sigs.push({ s: 'COMPRESSION', pts: 18, note: `Range ${(range24*100).toFixed(1)}% — Phase B coiling` });
    if (vt >= 1 && body < 0.25 && lw > 0.25 && rp < 0.58) sigs.push({ s: 'ABSORPTION', pts: 18, note: `Body ${(body*100).toFixed(0)}%/wick ${(lw*100).toFixed(0)}% — SM absorbing supply` });
    if (ch24 > 0.3 && ch24 < (isMeme ? 15 : 8) && (ch7||0) > -15 && rp > 0.38) sigs.push({ s: 'HIGHER_LOW', pts: 15, note: `+${ch24.toFixed(1)}% HL Phase D SOS` });
    if (hv && ['EARLY_BULL','BULL_RUN','ACCUMULATION'].includes(hv.phase) && vt >= 1) sigs.push({ s: 'CYCLE_ALIGN', pts: 10, note: `${hv.emoji} ${hv.phase}` });
    if ((ch7||0) > 8 && Math.abs(ch24) < 6) sigs.push({ s: 'REL_STRENGTH', pts: 14, note: `7d +${(ch7||0).toFixed(1)}% outperforming` });
    const count = sigs.length;
    const score = Math.min(25, Math.round(sigs.reduce((a, s) => a + s.pts, 0) * 25 / 100));
    const stage = count >= 5 ? 'READY 🔥' : count >= 4 ? 'STRONG 💪' : count === 3 ? 'EARLY 📈' : count === 2 ? 'FORMING 🔄' : 'WEAK ⚠️';
    return { valid: count >= 2, count, score, stage, sigs, pumped: false };
  }

  // LAYER 2+3 SM VALIDATION
  function layer23_SMValidation(price, high, low, open, ch24, ch7, vol, rp, lw, body) {
    const vt = vol >= 500e6 ? 5 : vol >= 100e6 ? 4 : vol >= 30e6 ? 3 : vol >= 10e6 ? 2 : vol >= 2e6 ? 1 : 0;
    const sigs = [];
    if (lw > 0.38 && rp < 0.55 && price > low * 1.002) {
      const str = lw > 0.55 ? 'STRONG' : 'MODERATE';
      sigs.push({ type: 'BSL_SWEEP', strength: str, pts: str === 'STRONG' ? 22 : 14 });
    }
    if (ch24 > 2.5 && ch24 < 12 && rp > 0.52 && lw > 0.18) sigs.push({ type: 'BOS', strength: ch24 > 5 ? 'STRONG' : 'MODERATE', pts: ch24 > 5 ? 18 : 11 });
    if ((ch7||0) < -5 && ch24 > 3 && lw > 0.20 && rp > 0.45) sigs.push({ type: 'CHOCH', strength: 'STRONG', pts: 20 });
    if (vt >= 2 && Math.abs(ch24) <= 4) sigs.push({ type: 'SSL_ACCUM', strength: vt >= 4 ? 'STRONG' : 'MODERATE', pts: vt >= 4 ? 22 : 13 });
    else if (vt >= 1 && Math.abs(ch24) <= 2) sigs.push({ type: 'SSL_ACCUM', strength: 'MODERATE', pts: 10 });
    if (vt >= 1 && body < 0.25 && lw > 0.25) sigs.push({ type: 'DEMAND_ZONE', strength: 'STRONG', pts: 20 });
    const strong = sigs.filter(s => s.strength === 'STRONG').length;
    const smScore = Math.min(25, Math.round(sigs.reduce((a, s) => a + s.pts, 0) * 25 / 66));
    return { sigs, count: sigs.length, strong, smScore, valid: sigs.length >= 2 };
  }

  // LAYER 5 DERIV SCORE
  function layer5_DerivScore(sym, derivData) {
    const d = derivData[sym];
    if (!d) return { score: 0, signal: 'NO_DATA', note: 'No futures data' };
    return { score: d.score, signal: d.signal, note: d.note, fundingRate: d.fundingRate, oi: d.oi };
  }

  // LAYER 7 NARRATIVE
  function layer7_Narrative(sym, btcDom, fg, btcCh7) {
    const narrative = NARRATIVES[sym] || null;
    const isTrending = narrative && TRENDING_NARRATIVES.has(narrative);
    let bonus = isTrending ? (narrative === 'AI' ? 8 : narrative === 'DePIN' ? 7 : narrative === 'RWA' ? 6 : 5) : narrative ? 2 : 0;
    let note = isTrending ? `${narrative} trending narrative` : narrative ? `${narrative} sector` : '';
    if (btcDom < 48 && fg > 40) { bonus += 3; note += ' | Alt season'; }
    if (btcDom > 62) { bonus -= 2; note += ' | BTC dom high'; }
    return { narrative: narrative || 'OTHER', bonus, note, isTrending };
  }

  // RR ENGINE
  function calcRR(price, low, high, ath, isMeme, hv) {
    const dr = high > low ? (high - low) / price : 0.05;
    const slPct = isMeme ? Math.max(0.06, Math.min(0.15, dr*2+0.03)) : Math.max(0.05, Math.min(0.12, dr*1.5+0.02));
    const slPrice = +(price * (1 - slPct)).toFixed(8);
    const slDist = price - slPrice;
    const minRR = isMeme ? 2 : 3;
    const tpMult = hv && ['BULL_RUN','EARLY_BULL'].includes(hv.phase) ? 1.15 : 1.0;
    const maxTP = price * 2.0;
    const tp1 = Math.min(price + slDist * minRR * tpMult, maxTP);
    const tp2 = Math.min(price + slDist * (minRR + 1.5) * tpMult, maxTP);
    const rr1 = +((tp1-price)/slDist).toFixed(2);
    const rr2 = +((tp2-price)/slDist).toFixed(2);
    return { slPrice, slPct: +(slPct*100).toFixed(1), slDist, tp1: +tp1.toFixed(8), tp2: +tp2.toFixed(8), tp1Pct: +((tp1-price)/price*100).toFixed(1), tp2Pct: +((tp2-price)/price*100).toFixed(1), rr1, rr2, rrLabel: `1:${rr1.toFixed(1)} / 1:${rr2.toFixed(1)}`, unrealistic: ((tp1-price)/price*100)>100 };
  }

  // SCORING ENGINE
  function scoreSetup(coin, btcCh24, btcCh7, fg, pi, sm, rr1, regBonus, isMeme, hv, moon, derivScore, narrativeBonus) {
    const { price, vol, ch24, high, low, open, ch7, ch30, ath } = coin;
    const range = Math.max(high - low, price * 0.01);
    const rp = (price - low) / range;
    const fromATH = ath > 0 ? ((price - ath) / ath * 100) : 0;
    const rs7 = (ch7||0) - btcCh7;
    const vt = vol >= 500e6 ? 5 : vol >= 100e6 ? 4 : vol >= 30e6 ? 3 : vol >= 10e6 ? 2 : vol >= 2e6 ? 1 : 0;
    let mom = rs7 > 12 ? 20 : rs7 > 8 ? 18 : rs7 > 5 ? 16 : rs7 > 2 ? 14 : rs7 > 0 && btcCh7 < 0 ? 16 : rs7 >= -3 && ch24 >= 0 ? 11 : ch24 > 2 ? 9 : rs7 < -10 ? 4 : 7;
    if (fg <= 25) mom = Math.min(20, mom + 3);
    if (isMeme && ch24 > 3 && vt >= 2) mom = Math.min(20, mom + 3);
    const ssl = (Math.min(price,open)-low)/range > 0.38 && rp < 0.52;
    const choch = ch24 > 3 && ch24 < 12 && rp > 0.55;
    const hasCHoCH = (ch7||0) < -5 && ch24 > 3;
    let str = hasCHoCH ? 15 : ssl && choch ? 15 : ssl && ch24 > 1 ? 13 : choch ? 12 : ssl ? 9 : (ch7||0) > 3 && (ch30||0) < -15 ? 8 : Math.abs(ch24) < 3 && vt >= 1 ? 7 : rp < 0.35 ? 5 : 3;
    if (rs7 > 8) str = Math.min(15, str + 3); else if (rs7 > 3) str = Math.min(15, str + 2);
    const golden = fromATH <= -55 && fromATH >= -80;
    const deepVal = fromATH <= -80 && fromATH >= -97;
    const early = fromATH <= -30 && fromATH >= -55;
    let mkt = golden && rp < 0.50 ? 15 : golden ? 12 : deepVal && rp < 0.45 ? 13 : early && rp < 0.40 ? 10 : early ? 8 : rp < 0.35 ? 7 : 4;
    if (fg <= 25) mkt = Math.min(15, mkt + 3);
    if (rr1 >= 4) mkt = Math.min(15, mkt + 2);
    if (golden && hv && ['EARLY_BULL','BULL_RUN'].includes(hv.phase)) mkt = Math.min(15, mkt + 2);
    const cosmicBonus = Math.max(-5, Math.min(8, (hv.bonus + moon.bonus) * 0.3));
    const derivBonus = Math.max(-10, Math.min(10, derivScore || 0));
    const narrativeB = Math.max(0, Math.min(8, narrativeBonus || 0));
    const raw = pi.score + sm.smScore + mom + str + mkt + regBonus + cosmicBonus + derivBonus + narrativeB;
    const totalScore = Math.max(0, Math.min(100, Math.round(raw)));
    const smAdj = sm.strong >= 2 ? 15 : sm.valid ? 8 : -15;
    const piAdj = pi.count >= 5 ? 20 : pi.count >= 4 ? 15 : pi.count >= 3 ? 10 : pi.count >= 2 ? 5 : -10;
    const rrAdj = rr1 >= 4.5 ? 10 : rr1 >= 4 ? 8 : rr1 >= 3 ? 4 : rr1 >= 2 ? 2 : -15;
    const athAdj = golden ? 5 : deepVal ? 3 : early ? 0 : -2;
    const conf = Math.max(0, Math.min(100, Math.round((raw/100)*100 + smAdj + piAdj + rrAdj + athAdj)));
    return { totalScore, conf, comps: { pi: pi.score, sm: sm.smScore, mom, str, mkt }, fromATH, cosmicBonus, derivBonus, narrativeB };
  }

  function entryConf(ch24, lw, body, rp, vol) {
    const cs = [], vt = vol >= 100e6 ? 3 : vol >= 30e6 ? 2 : vol >= 5e6 ? 1 : 0;
    if (lw > 0.35 && body < 0.28) cs.push('REJECTION');
    if (vt >= 1 && (ch24 > 0.3 || Math.abs(ch24) < 2)) cs.push('VOLUME_SPIKE');
    if (ch24 > 2.5 && ch24 < 12 && rp > 0.55) cs.push('MICRO_BOS');
    if (lw > 0.28 && ch24 > 0.3 && rp > 0.42) cs.push('SWEEP_RECOVERY');
    return { list: cs, count: cs.length, valid: cs.length >= 2, needs: Math.max(0, 2 - cs.length) };
  }

  function conflicts(ch24, ch7, ch30, rp, reg, btcCh7, fg, hv) {
    const cs = [];
    if ((ch7||0) < -10 && ch24 > 0 && rp > 0.45) cs.push({ sev: 'HIGH', note: 'HTF bear + LTF pump = dead cat' });
    if (reg === 'BEAR' && ch24 > 6) cs.push({ sev: 'HIGH', note: `Bear regime + pump` });
    if (ch24 > 9 && btcCh7 < -3) cs.push({ sev: 'HIGH', note: 'Pump while BTC weekly red' });
    if (fg <= 15 && ch24 > 7) cs.push({ sev: 'HIGH', note: 'Extreme fear + pump' });
    if (hv && hv.phase === 'PEAK_EUPHORIA' && rp > 0.7) cs.push({ sev: 'MEDIUM', note: 'Peak euphoria + extended' });
    if ((ch30||0) > 150 && rp > 0.65) cs.push({ sev: 'MEDIUM', note: '30d parabolic' });
    const hi = cs.filter(c => c.sev === 'HIGH').length, med = cs.filter(c => c.sev === 'MEDIUM').length;
    const level = hi >= 1 || hi + med >= 2 ? 'HIGH' : med >= 1 ? 'MEDIUM' : 'LOW';
    return { cs, level, action: level === 'HIGH' ? 'REJECT' : level === 'MEDIUM' ? 'WAIT' : 'PROCEED' };
  }

  function lockSetup(sym, price, entLo, entHi, rr, score, conf, tier, assetType, isMeme, hv, moon, narrative) {
    if (SETUP_LOCK.has(sym)) return;
    const activeWL = [...SETUP_LOCK.values()].filter(w => !['COMPLETED','INVALID'].includes(w.status));
    if (activeWL.length >= MAX_WATCHLIST) return;
    const now = Date.now();
    const entry = { symbol: sym, status: 'WATCHING', entryLo: +entLo.toFixed(8), entryHi: +entHi.toFixed(8), entryPrice: +(price*0.999).toFixed(8), sl: rr.slPrice, slPct: rr.slPct, tp1: rr.tp1, tp1Pct: rr.tp1Pct, rr1: rr.rr1, tp2: rr.tp2, tp2Pct: rr.tp2Pct, rr2: rr.rr2, rr: rr.rrLabel, score, confidence: conf, tier, assetType, isMeme, narrative, halvingPhase: hv?.phase, moonPhase: moon?.phase, lockedAt: now, lockedAtStr: new Date(now).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', hour12: false }), currentPrice: price, pnl: 0, trailActive: false, triggeredAt: null, closedAt: null };
    SETUP_LOCK.set(sym, entry);
    const nt = narrative && narrative !== 'OTHER' ? ` | ${narrative}` : '';
    tg(`🔒 <b>LOCKED — ${sym}</b>${nt}\n📊 ${score} | ${conf}% | ${tier}\n📍 $${fmtP(entLo)}–$${fmtP(entHi)}\n🛑 $${fmtP(rr.slPrice)} (-${rr.slPct}%)\n🎯 TP1 $${fmtP(rr.tp1)} (+${rr.tp1Pct}%) | TP2 $${fmtP(rr.tp2)} (+${rr.tp2Pct}%)\n${hv.emoji} ${hv.phase} · ${moon.emoji} ${moon.label}`);
  }

  function tradeState(sym, price, entLo, entHi, rr, tier, score, assetType, isMeme, majorCnt, memeCnt) {
    const now = Date.now(), ex = TRADE_STORE.get(sym);
    if (ex && ['IN_ZONE','TRIGGERED','ACTIVE'].includes(ex.state)) {
      if (price <= ex.sl * 0.999) { TRADE_STORE.set(sym, { ...ex, state: 'INVALID', closed: now }); return { state: 'INVALID', tag: 'SL HIT', active: false }; }
      if (price >= ex.tp1 * 0.998) { TRADE_STORE.set(sym, { ...ex, state: 'COMPLETED', closed: now }); return { state: 'COMPLETED', tag: 'TP1 DONE', active: false }; }
      const pnl = ex.ep > 0 ? +((price-ex.ep)/ex.ep*100).toFixed(2) : 0;
      return { state: ex.state, tag: `${ex.state} PnL:${pnl>=0?'+':''}${pnl}%`, active: true, ep: ex.ep, pnl, sl: ex.sl, tp1: ex.tp1, tp2: ex.tp2, rr: ex.rr, locked: true, exitStrategy: ex.exitStrategy||'TP2', trailActive: ex.trailActive||false };
    }
    const isM = assetType === 'MEME';
    if (isM && memeCnt >= MAX_MEME) return { state: 'READY', tag: `MEME LIMIT`, active: false, blocked: true };
    if (!isM && majorCnt >= MAX_MAJOR) return { state: 'READY', tag: `MAX TRADES`, active: false, blocked: true };
    if (price >= entLo * 0.999 && price <= entHi * 1.01) {
      TRADE_STORE.set(sym, { state: 'IN_ZONE', ep: price, et: now, sl: rr.slPrice, tp1: rr.tp1, tp2: rr.tp2, rr: rr.rrLabel, tier, score, assetType, exitStrategy: 'TP2', trailActive: false });
      return { state: 'IN_ZONE', tag: '⚡ IN ZONE', active: true, ep: price };
    }
    if (!ex) TRADE_STORE.set(sym, { state: 'READY', sl: rr.slPrice, tp1: rr.tp1, tp2: rr.tp2, rr: rr.rrLabel });
    const d = (entLo - price) / price;
    return { state: 'READY', tag: `READY — ${d <= 0 ? 'AT ZONE' : d < 0.02 ? 'NEAR 2%' : d < 0.05 ? 'NEAR 5%' : 'WAITING'}`, active: false };
  }

  // ════════════════════════════════════════════════════════════════
  // MAIN SCAN
  // ════════════════════════════════════════════════════════════════
  try {
    const t0 = Date.now();
    const hv = halvingCycle(), moon = moonPhase();

    const [binR, cgR, fngR, glbR, btcKR] = await Promise.allSettled([
      sf('https://api.binance.com/api/v3/ticker/24hr', 6000),
      sf('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=volume_desc&per_page=250&page=1&sparkline=false&price_change_percentage=7d,30d', 6000),
      sf('https://api.alternative.me/fng/?limit=1&format=json'),
      sf('https://api.coingecko.com/api/v3/global'),
      sf('https://min-api.cryptocompare.com/data/v2/histohour?fsym=BTC&tsym=USD&limit=168', 5000),
    ]);
    const bins = binR.status === 'fulfilled' && Array.isArray(binR.value) && binR.value.length > 100 ? binR.value : [];
    const cgs  = cgR.status === 'fulfilled' && Array.isArray(cgR.value) ? cgR.value : [];
    const fg   = fngR.status === 'fulfilled' ? parseInt(fngR.value?.data?.[0]?.value || 50) : 50;
    const glb  = glbR.status === 'fulfilled' ? glbR.value?.data : null;
    const btcK = btcKR.status === 'fulfilled' && btcKR.value?.Response === 'Success' ? btcKR.value.Data.Data.map(d => +d.close).filter(v => v > 0) : [];

    const bmap = {};
    bins.forEach(t => { if (t?.symbol) bmap[t.symbol] = t; });
    const btcT = bmap['BTCUSDT'];
    const btcPx = +(btcT?.lastPrice || 0), btcCh24 = +(btcT?.priceChangePercent || 0);
    let btcCh7 = 0, btcTrend = 'NEUTRAL';
    if (btcK.length >= 50) {
      const c = btcK[btcK.length-1], w7 = btcK.length >= 168 ? btcK[btcK.length-168] : btcK[0];
      btcCh7 = w7 > 0 ? +((c-w7)/w7*100).toFixed(2) : 0;
      const ma50 = btcK.slice(-50).reduce((a,b)=>a+b,0)/50;
      btcTrend = c > ma50*1.02 ? 'BULLISH' : c < ma50*0.98 ? 'BEARISH' : 'NEUTRAL';
    }
    const btcDom = +(glb?.market_cap_percentage?.btc || 58).toFixed(1);
    const reg = regime(btcCh7, btcCh24, btcDom, fg, btcTrend, hv, moon);

    if (btcDom < 48) { TRENDING_NARRATIVES.add('GameFi'); TRENDING_NARRATIVES.add('DeFi'); }
    if (fg < 30) { TRENDING_NARRATIVES.add('RWA'); }

    const wlEvents = updateWatchlistPrices(bmap);

    const STABLES = new Set(['USDT','USDC','BUSD','TUSD','DAI','FDUSD','USDP','FRAX','LUSD','USDS','SUSD','GUSD','PYUSD','CRVUSD','USDD','PAXG','XAUT','WBTC','WETH','WBNB','STETH','CBETH','RETH']);
    const BAD = ['UP','DOWN','BEAR','BULL','3L','3S','2L','2S'];
    const HAN = /[\u4e00-\u9fff]/;
    const cgm = {};
    cgs.forEach(c => { if (c?.symbol) cgm[c.symbol.toUpperCase()] = c; });
    const candidates = [], seen = new Set();
    bins.forEach(t => {
      if (!t?.symbol?.endsWith('USDT')) return;
      const b = t.symbol.replace('USDT', '');
      if (STABLES.has(b) || seen.has(b) || HAN.test(b) || BAD.some(s => b.startsWith(s)||b.endsWith(s)) || b.length < 2 || b.length > 12) return;
      const v = +(t.quoteVolume||0), p = +(t.lastPrice||0);
      if (v < 200000 || p <= 0 || (p >= 0.97 && p <= 1.03 && Math.abs(+(t.priceChangePercent||0)) < 2)) return;
      seen.add(b);
      const cg = cgm[b];
      candidates.push({ base: b, price: p, vol: v, ch24: +(t.priceChangePercent||0), high: +(t.highPrice||p), low: +(t.lowPrice||p), open: +(t.openPrice||p), ch7: cg ? +(cg.price_change_percentage_7d||0) : null, ch30: cg ? +(cg.price_change_percentage_30d||0) : null, ath: cg ? +(cg.ath||0) : 0, mcap: cg ? +(cg.market_cap||0) : 0, name: cg?.name||b });
    });
    cgs.forEach(c => {
      const b = (c.symbol||'').toUpperCase();
      if (STABLES.has(b) || seen.has(b) || HAN.test(c.name||'')) return;
      const v = +(c.total_volume||0), p = +(c.current_price||0);
      if (v < 500000 || p <= 0 || (p >= 0.97 && p <= 1.03)) return;
      candidates.push({ base: b, price: p, vol: v, ch24: +(c.price_change_percentage_24h||0), high: p*1.02, low: p*0.98, open: p/(1+(+(c.price_change_percentage_24h||0))/100), ch7: +(c.price_change_percentage_7d||0), ch30: +(c.price_change_percentage_30d||0), ath: +(c.ath||0), mcap: +(c.market_cap||0), name: c.name||b });
    });

    const derivData = await fetchDerivatives(candidates.map(c => c.base));

    let majorCnt = 0, memeCnt = 0;
    TRADE_STORE.forEach(v => { if (['IN_ZONE','TRIGGERED','ACTIVE'].includes(v.state)) { if (v.assetType==='MEME') memeCnt++; else majorCnt++; } });

    const killed = { KILL: 0, PI: 0, SM: 0, RR: 0, CONFLICT: 0, SCORE: 0, STALE: 0 };
    const outputs = [], activeSetups = [];

    for (const coin of candidates.slice(0, 800)) {
      const { base: sym, price, ath, ch24, vol, ch7, ch30, mcap } = coin;
      if (!price || price <= 0) continue;
      if (ath > 0 && ((price-ath)/ath*100) < -99) { killed.STALE++; continue; }
      const assetType = classifyAsset(sym, mcap, vol), isMeme = assetType === 'MEME';
      const range = Math.max(coin.high-coin.low, price*0.01);
      const rp = (price-coin.low)/range, lw = (Math.min(price,coin.open)-coin.low)/range, body = Math.abs(price-coin.open)/range;
      const vt = vol >= 500e6 ? 5 : vol >= 100e6 ? 4 : vol >= 30e6 ? 3 : vol >= 10e6 ? 2 : vol >= 2e6 ? 1 : 0;
      const exT = TRADE_STORE.get(sym);
      if (exT && ['IN_ZONE','TRIGGERED','ACTIVE'].includes(exT.state)) {
        if (price <= exT.sl*0.999) { TRADE_STORE.set(sym, { ...exT, state: 'INVALID', closed: Date.now() }); continue; }
        const pnl = exT.ep > 0 ? +((price-exT.ep)/exT.ep*100).toFixed(2) : 0;
        activeSetups.push({ symbol: sym, assetType, isMeme, price, status: exT.state, tag: `${exT.state} PnL:${pnl>=0?'+':''}${pnl}%`, ep: exT.ep, pnl, sl: exT.sl, tp1: exT.tp1, tp2: exT.tp2, rr: exT.rr, ch24: +ch24.toFixed(2), exitStrategy: exT.exitStrategy||'TP2', trailActive: exT.trailActive||false, locked: true });
        continue;
      }
      if (reg.kill) { killed.KILL++; continue; }
      const pi = layer1_SMPattern(price, coin.high, coin.low, coin.open, ch24, ch7, vol, rp, lw, body, isMeme, hv);
      if (pi.pumped || pi.count < reg.piMin) { killed.PI++; continue; }
      if (vt < 1 && !isMeme) { killed.PI++; continue; }
      if (ch24 < -10) { killed.PI++; continue; }
      const sm = layer23_SMValidation(price, coin.high, coin.low, coin.open, ch24, ch7, vol, rp, lw, body);
      if (!sm.valid) { killed.SM++; continue; }
      const rr = calcRR(price, coin.low, coin.high, ath, isMeme, hv);
      if (rr.unrealistic || (isMeme ? rr.rr1 < 2 : rr.rr1 < 3)) { killed.RR++; continue; }
      const conf = conflicts(ch24, ch7, ch30, rp, reg.r, btcCh7, fg, hv);
      if (conf.action === 'REJECT') { killed.CONFLICT++; continue; }
      const deriv = layer5_DerivScore(sym, derivData);
      if (deriv.score <= -8) { killed.CONFLICT++; continue; }
      const narr = layer7_Narrative(sym, btcDom, fg, btcCh7);

      // ── ICT/SMC LAYER 1-4: Kill Zone + Liq + Structure + Pattern ──
      const kz             = getKillZone();
      const liqAnalysis    = detectICTLiquidity(price, coin.high, coin.low, coin.open, ch24, ch7, lw, rp, body, vol);
      const mssAnalysis    = detectMSS_FVG(price, coin.high, coin.low, coin.open, ch24, ch7, ch30, rp, lw, body, vol);
      const patternAnalysis = detectChartPattern(price, coin.high, coin.low, coin.open, ch24, ch7, ch30, rp, lw, body, vol);
      const oteAnalysis    = calcOTE(price, coin.high, coin.low, rp);

      const sc = scoreSetup({ ...coin, vol, ch24, ch7, ch30, high: coin.high, low: coin.low, open: coin.open, ath }, btcCh24, btcCh7, fg, pi, sm, rr.rr1, reg.bonus||0, isMeme, hv, moon, deriv.score, narr.bonus);
      const bearPen = reg.r === 'BEAR' ? -10 : 0;
      const finalScore = Math.max(0, Math.min(100, sc.totalScore + bearPen));
      const finalConf  = Math.max(0, Math.min(100, sc.conf + (reg.r === 'BEAR' ? -8 : 0) + ictConfBoost));

      const sMin = isMeme ? Math.max(70, reg.sMin-5) : reg.sMin;
      const cMin = isMeme ? Math.max(75, reg.cMin-5) : reg.cMin;
      if (finalScore < sMin || finalConf < cMin) { killed.SCORE++; continue; }

      const now = Date.now();
      const fts = SETUP_TS.get(sym);
      if (!fts) SETUP_TS.set(sym, { t: now, vol });
      const ageH = fts ? (now-fts.t)/3600000 : 0, volFaded = fts && vol < fts.vol*0.45;
      const fresh = ageH < (isMeme?2:6) && !volFaded, valid2 = !fresh && ageH < (isMeme?4:24) && !volFaded, weak = !fresh && !valid2 && ageH < (isMeme?6:48) && !volFaded;
      if (!fresh && !valid2 && !weak) { killed.STALE++; continue; }
      const tsStatus = fresh ? 'FRESH ⚡' : valid2 ? 'VALID ✓' : 'WEAK ⚠️';
      const ec = entryConf(ch24, lw, body, rp, vol);
      const entLo = Math.max(price*0.97, coin.low*0.99);
      const entHi = price*1.01;
      const tier = finalScore >= 87 ? 'S' : finalScore >= 75 ? 'A' : null;
      if (!tier) { killed.SCORE++; continue; }

      // ── ICT Prob Score + Entry Package (needs tier) ──────────────
      const probScore      = calcProbScore(pi, sm, liqAnalysis, mssAnalysis, patternAnalysis, oteAnalysis, deriv, narr, tier);
      const entryPkg       = buildEntryPackage(price, coin.high, coin.low, oteAnalysis, liqAnalysis, mssAnalysis, rr, tier, probScore, kz);
      const ictConfBoost   = Math.min(10,
        (liqAnalysis.hasSweep ? 3 : 0) + (mssAnalysis.hasBOS ? 2 : 0) +
        (mssAnalysis.hasMSS ? 3 : 0) + (mssAnalysis.hasFVG ? 2 : 0) +
        (oteAnalysis.inOTE ? 4 : 0) + (patternAnalysis.hasPattern ? 2 : 0) +
        (kz.quality === 'HIGH' ? 3 : kz.quality === 'MEDIUM' ? 1 : 0) +
        (probScore.score >= 8 ? 3 : probScore.score >= 6 ? 1 : 0)
      );

      const ts = tradeState(sym, price, entLo, entHi, rr, tier, finalScore, assetType, isMeme, majorCnt, memeCnt);
      lockSetup(sym, price, entLo, entHi, rr, finalScore, finalConf, tier, assetType, isMeme, hv, moon, narr.narrative);

      const prevDec = DECISION_HIST.get(sym);
      let decision, decColor;
      const isElite = finalScore >= 87 && finalConf >= 82 && sm.strong >= 2;
      const execOK = ts.state === 'IN_ZONE' && ec.valid && conf.action === 'PROCEED' && !ts.blocked;

      if (execOK && isElite) {
        decision = '✅ EXECUTE — ELITE'; decColor = '#ff6b35';
        DECISION_HIST.set(sym, 'EXECUTE');
        if (prevDec !== 'EXECUTE') tg(`🏆 <b>ELITE — ${sym}</b>\nProb: ${probScore.score}/10 | ${probScore.scoreLabel}\n${kz.emoji} ${kz.zone}\n${narr.narrative !== 'OTHER' ? narr.narrative : ''}`);
      } else if (execOK) {
        decision = '✅ EXECUTE'; decColor = '#ff6b35';
        DECISION_HIST.set(sym, 'EXECUTE');
      } else if (prevDec === 'EXECUTE' && ts.state !== 'INVALID') {
        decision = '✅ EXECUTE (locked)'; decColor = '#ff6b35';
      } else if (ts.blocked) { decision = `⏳ WAIT — ${ts.tag}`; decColor = '#FFB300'; }
      else if (!ec.valid) { decision = `⏳ WAIT — ${ec.needs} more confirmation`; decColor = '#FFB300'; }
      else if (conf.action === 'WAIT') { decision = '⏳ WAIT — Conflict'; decColor = '#FFB300'; }
      else { decision = `🎯 LIMIT — $${fmtP(entLo)}–$${fmtP(entHi)}`; decColor = '#00ffd0'; }

      const posPct = isElite ? '3%' : tier === 'S' ? '2-3%' : reg.r === 'BULL' ? '1.5-2%' : '1-2%';

      outputs.push({
        rank: 0, symbol: sym, name: coin.name||sym, assetType, isMeme,
        price, ch24: +ch24.toFixed(2), ch7: +(ch7||0).toFixed(2), vol,
        fromATH: sc.fromATH !== 0 ? +sc.fromATH.toFixed(1) : null,
        tier, tierLabel: tier==='S' ? '🔥 TIER S' : '✅ TIER A',
        finalScore, confidence: finalConf, positionRank: '',
        narrative: narr.narrative, narrativeBonus: narr.bonus, isTrendingNarrative: narr.isTrending,
        freshness: { status: tsStatus, fresh, valid: valid2, weak },
        preImpulse: { count: pi.count, stage: pi.stage, valid: pi.valid, sigs: pi.sigs },
        smDetection: { count: sm.count, valid: sm.valid, strong: sm.strong, sigs: sm.sigs },
        derivatives: { signal: deriv.signal, score: deriv.score, note: deriv.note, fundingRate: deriv.fundingRate },
        entryConf: ec, conflict: conf, tradeState: ts, status: ts.state,
        rr: { tp1: rr.tp1, tp2: rr.tp2, tp1Pct: rr.tp1Pct, tp2Pct: rr.tp2Pct, rr1: rr.rr1, rr2: rr.rr2, label: rr.rrLabel, slPrice: rr.slPrice, slPct: rr.slPct },
        entryZone: { lo: +entLo.toFixed(8), hi: +entHi.toFixed(8), optimal: +(price*0.999).toFixed(8) },
        scoreBreakdown: sc.comps, cosmicBonus: sc.cosmicBonus, derivBonus: sc.derivBonus, narrativeB: sc.narrativeB,
        halvingPhase: hv.phase, halvingEmoji: hv.emoji,
        moonPhase: moon.phase, moonEmoji: moon.emoji, moonLabel: moon.label,
        decision, decisionColor: decColor, positionSize: posPct, isElite,
        rrMode: isMeme ? 'HIGH RISK (1:2–1:4)' : 'NORMAL (1:3–1:5)',
        // ★ FULL ICT/SMC PACKAGE
        ict: {
          liq: liqAnalysis,
          mss: mssAnalysis,
          pattern: patternAnalysis,
          ote: oteAnalysis,
          probScore,
          entryPkg,
          killZone: kz,
          ictConfBoost,
        },
        tradeData: { coin: sym, type: assetType, entry: +(price*0.999).toFixed(8), sl: rr.slPrice, tp1: rr.tp1, tp2: rr.tp2, rr: rr.rrLabel, status: ['IN_ZONE','TRIGGERED'].includes(ts.state)?'ACTIVE':ts.state, confidence: finalConf, score: finalScore, timestamp: new Date().toISOString().split('T')[0], result: 'RUNNING', positionRank: '', tier, exitStrategy: 'TP2', pnl: 0 },
      });
    }

    outputs.sort((a, b) => (b.finalScore+b.confidence)-(a.finalScore+a.confidence) || b.vol-a.vol);
    outputs.forEach((r, i) => {
      r.rank = i+1;
      r.positionRank = i < 2 ? 'ELITE 🏆' : i < 5 ? 'HIGH ⭐' : 'NORMAL';
      r.tradeData.positionRank = r.positionRank;
      if (r.positionRank === 'NORMAL' && r.decision.includes('EXECUTE') && !r.decision.includes('locked'))
        r.decision = `🎯 LIMIT — $${fmtP(r.entryZone.lo)}–$${fmtP(r.entryZone.hi)}`;
    });

    const wlAll = [...SETUP_LOCK.values()];
    const wlActive = wlAll.filter(w => !['COMPLETED','INVALID'].includes(w.status));
    const wlCompleted = wlAll.filter(w => w.status==='COMPLETED'), wlInvalid = wlAll.filter(w => w.status==='INVALID');
    const winRate = wlCompleted.length+wlInvalid.length > 0 ? +((wlCompleted.length/(wlCompleted.length+wlInvalid.length))*100).toFixed(1) : null;
    const watchlist = wlAll.sort((a, b) => { const o={TRIGGERED:0,TP1_HIT:1,ACTIVE:2,WATCHING:3,COMPLETED:4,INVALID:5}; return (o[a.status]??9)-(o[b.status]??9)||b.score-a.score; });
    const activeTrades = [];
    TRADE_STORE.forEach((v, k) => { if (['IN_ZONE','TRIGGERED','ACTIVE','COMPLETED','INVALID'].includes(v.state)) activeTrades.push({ symbol: k, state: v.state, entryPrice: v.ep, sl: v.sl, tp1: v.tp1, tp2: v.tp2, rr: v.rr, tier: v.tier, score: v.score, pnl: v.pnl||0 }); });

    res.setHeader('Cache-Control', 's-maxage=60');
    return res.status(200).json({
      timestamp: Date.now(), scanTime: ((Date.now()-t0)/1000).toFixed(1),
      totalScanned: candidates.length, totalQualified: outputs.length,
      totalKilled: Object.values(killed).reduce((a,b)=>a+b,0), killedBreakdown: killed,
      regularSetups: outputs.filter(r => !r.isMeme).slice(0, 13),
      memeSetups: outputs.filter(r => r.isMeme).slice(0, 10),
      eliteCount: outputs.filter(r => r.isElite).length,
      engineDisciplined: outputs.length === 0 && !reg.kill,
      activeSetups, activeTrades, watchlist,
      wlActive: wlActive.length, wlCompleted: wlCompleted.length, wlInvalid: wlInvalid.length,
      wlEvents,
      stats: { winRate, totalCompleted: wlCompleted.length, totalInvalid: wlInvalid.length, majorActive: majorCnt, memeActive: memeCnt, majorMax: MAX_MAJOR, memeMax: MAX_MEME },
      cosmic: { halving: hv, moon, btcCh7 },
      regime: reg,
      systemStatus: { majorActive: majorCnt, majorMax: MAX_MAJOR, memeActive: memeCnt, memeMax: MAX_MEME, btcTrend, fgValue: fg, btcDom, btcCh7, btcPx },
    });
  } catch (e) { return res.status(500).json({ error: e.message, totalScanned: 0 }); }
}

function fmtP(p) {
  if (!p || p <= 0) return '—';
  if (p >= 10000) return p.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (p >= 1000)  return p.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (p >= 1)     return p.toFixed(4);
  if (p >= 0.001) return p.toFixed(6);
  return p.toFixed(8);
}
