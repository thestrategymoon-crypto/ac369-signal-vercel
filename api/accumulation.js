// api/accumulation.js — AC369 FUSION v10.0
// ══════════════════════════════════════════════════════════════════
// COMPLETE INSTITUTIONAL DECISION ENGINE
//
// NEW v10.0:
//   Asset Classification: MAJOR / ALT / MID / MEME
//   Meme Coin HIGH RISK MODE (faster time decay, lower thresholds)
//   Adaptive thresholds per regime (RANGE looser, BEAR tighter)
//   Time Decay: Fresh/Valid/Weak/Expired (different for meme vs regular)
//   Position Rank: ELITE(top2) / HIGH(3-5) / NORMAL → only ELITE executes
//   Execution Consistency: no flip-flop on decisions
//   Full Trade Dashboard: ACTIVE + HISTORY persistent
//
// RR: Normal 1:3–1:5 | Meme 1:2–1:4 | NO ATH targets | MAX +100%
// SCORING: PI=25, SM=25, Mom=20, Struct=15, Market=15
// ══════════════════════════════════════════════════════════════════

const TRADE_STORE = new Map();
const SETUP_TIMESTAMPS = new Map();
const DECISION_HISTORY = new Map(); // for execution consistency
const MAX_ACTIVE = 3;
const MAX_WATCHLIST = 10; // max setups in lock watchlist

// ── SETUP LOCK STORE ─────────────────────────────────────────────
// Stores setups that were EVER valid — persists until TP2/SL hit
// Key: symbol, Value: { entry/SL/TP locked, status, lockedAt, ... }
const SETUP_LOCK = new Map();

// ── TELEGRAM NOTIFIER ────────────────────────────────────────────
const TG_TOKEN = typeof process !== 'undefined' ? (process.env.TG_BOT_TOKEN || '') : '';
const TG_CHAT  = typeof process !== 'undefined' ? (process.env.TG_CHAT_ID || '') : '';
async function sendTelegram(msg) {
  if (!TG_TOKEN || !TG_CHAT) return;
  try {
    await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TG_CHAT, text: msg, parse_mode: 'HTML' }),
    });
  } catch (_) {}
}

// ── ASSET CLASSIFICATION ──────────────────────────────────────────
const MAJOR_COINS = new Set(['BTC','ETH','BNB','SOL','XRP','ADA','AVAX','DOT','LINK','MATIC','ATOM','NEAR','UNI','LTC','BCH','TRX','DOGE_NOT_MEME','FIL','ALGO','VET']);
const MEME_COINS = new Set([
  'DOGE','SHIB','PEPE','BONK','WIF','FLOKI','BRETT','MOG','SPX','POPCAT',
  'MEW','BOME','SLERF','MYRO','PONKE','BOOK','TURBO','LADYS','MOCHI',
  'NEIRO','PNUT','GOAT','ACT','MOODENG','HMSTR','DOGS','CATI','BLUM',
  'LUNC','LUNA','ICP_NO','PEOPLE','BANANA','COQ','WOJAK','CHAD',
  'GIGA','CHEEMS','KISHU','SAMO','VOLT','DINO','HOGE','LEASH',
  'SQUID','ELON','BOBO','TOSHI','MFERS','SNEK','APED','HARAMBE',
]);

function classifyAsset(symbol, marketCap, vol24h) {
  if (MAJOR_COINS.has(symbol)) return 'MAJOR';
  if (MEME_COINS.has(symbol)) return 'MEME';
  // Volume-based meme detection (very high vol, very low price typical)
  if (marketCap > 0 && marketCap < 100e6 && vol24h / Math.max(marketCap, 1) > 0.5) return 'MEME';
  if (marketCap > 0 && marketCap < 200e6) return 'MID';
  if (marketCap > 0 && marketCap < 2e9) return 'ALT';
  return 'ALT';
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // POST: sync trades from browser localStorage
  if (req.method === 'POST') {
    try {
      const body = req.body || {};
      const trades = body.trades || [];
      let synced = 0;
      for (const t of trades) {
        if (t.symbol && !TRADE_STORE.has(t.symbol)) {
          TRADE_STORE.set(t.symbol, { state: t.status || 'ACTIVE', ep: t.entry, sl: t.sl, tp1: t.tp1, tp2: t.tp2, tier: t.tier || 'A', score: t.score, rr: t.rr, assetType: t.type, confidence: t.confidence, st: t.setupTime || Date.now(), et: t.entryTime || Date.now() });
          synced++;
        }
      }
      return res.status(200).json({ ok: true, synced, total: TRADE_STORE.size });
    } catch (e) { return res.status(400).json({ error: e.message }); }
  }

  // POST action=syncWatchlist — restore locked setups from client localStorage
  if (req.method === 'POST' && req.body?.action === 'syncWatchlist') {
    try {
      const clientWatchlist = req.body?.watchlist || [];
      let restored = 0;
      for (const w of clientWatchlist) {
        if (w.symbol && !SETUP_LOCK.has(w.symbol) && !['COMPLETED','INVALID'].includes(w.status)) {
          SETUP_LOCK.set(w.symbol, w);
          restored++;
        }
      }
      return res.status(200).json({ ok: true, restored, total: SETUP_LOCK.size });
    } catch (e) { return res.status(400).json({ error: e.message }); }
  }

  const sf = async (url, ms = 6000) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
      const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } });
      clearTimeout(t); if (!r.ok) return null; return await r.json();
    } catch { clearTimeout(t); return null; }
  };

  // ── MARKET REGIME ────────────────────────────────────────────────
  function detectRegime(btcCh7, btcCh24, btcDom, fgV, btcTrend) {
    if (Math.abs(btcCh24) > 12 || fgV <= 8 || fgV >= 93)
      return { regime: 'CHAOTIC', kill: true, color: 'var(--red)', piMin: 5, scoreMin: 99, confMin: 99, bonus: -999, focus: 'NO TRADE' };
    if (btcCh7 < -8 || (btcCh7 < -5 && btcTrend === 'BEARISH'))
      return { regime: 'BEAR', kill: false, color: 'var(--red)', piMin: 4, scoreMin: 82, confMin: 85, bonus: -10, focus: 'Bear: very strict. Long only if exceptional.' };
    if (btcCh7 > 8 || (btcCh7 > 5 && btcTrend === 'BULLISH' && fgV > 50))
      return { regime: 'BULL', kill: false, color: 'var(--g)', piMin: 3, scoreMin: 75, confMin: 80, bonus: +8, focus: 'Bull: momentum & breakout optimal.' };
    return { regime: 'RANGE', kill: false, color: 'var(--amber)', piMin: 2, scoreMin: 72, confMin: 78, bonus: +3, focus: 'Range: accumulation & pre-impulse optimal.' };
  }

  // ── TIME DECAY ENGINE ────────────────────────────────────────────
  function getTimestamp(symbol, isMeme) {
    const now = Date.now();
    const existing = SETUP_TIMESTAMPS.get(symbol);
    if (!existing) { SETUP_TIMESTAMPS.set(symbol, { t: now, vol: 0 }); return { ageH: 0, status: 'FRESH', fresh: true, valid: true, expired: false }; }
    const ageH = (now - existing.t) / 3600000;
    let status, fresh, valid, expired;
    if (isMeme) {
      // Meme: much faster decay
      if (ageH < 2)       { status = 'FRESH ⚡'; fresh = true; valid = true; expired = false; }
      else if (ageH < 4)  { status = 'VALID ✓'; fresh = false; valid = true; expired = false; }
      else if (ageH < 6)  { status = 'WEAK ⚠️'; fresh = false; valid = false; expired = false; }
      else                { status = 'EXPIRED ⏰'; fresh = false; valid = false; expired = true; }
    } else {
      if (ageH < 6)       { status = 'FRESH ⚡'; fresh = true; valid = true; expired = false; }
      else if (ageH < 24) { status = 'VALID ✓'; fresh = false; valid = true; expired = false; }
      else if (ageH < 48) { status = 'WEAK ⚠️'; fresh = false; valid = false; expired = false; }
      else                { status = 'EXPIRED ⏰'; fresh = false; valid = false; expired = true; }
    }
    return { ageH, status, fresh, valid, expired };
  }

  // ── PRE-IMPULSE DETECTION (25pts) ───────────────────────────────
  function detectPreImpulse(price, high, low, open, change24h, change7d, vol24h, rangePos, lwRatio, bodyRatio, isMeme) {
    const pumpLimit = isMeme ? 12 : 8; // meme can pump more before we care
    if (change24h > pumpLimit) return { valid: false, count: 0, score: 0, stage: 'LATE', signals: [], alreadyPumped: true };
    const vt = vol24h >= 500e6 ? 5 : vol24h >= 100e6 ? 4 : vol24h >= 30e6 ? 3 : vol24h >= 10e6 ? 2 : vol24h >= 2e6 ? 1 : 0;
    const range24h = high > low ? (high - low) / low : 0;
    const signals = [];
    // 1. Volume accumulation
    const volThresh = isMeme ? 2 : 3; // meme needs less volume tier
    if (vt >= volThresh && Math.abs(change24h) <= 4) signals.push({ s: 'VOLUME_ACCUM', pts: 20, note: `$${(vol24h/1e6).toFixed(0)}M + flat = SM absorbing` });
    else if (vt >= 1 && Math.abs(change24h) <= 2) signals.push({ s: 'VOLUME_ACCUM', pts: 10, note: `Volume + flat` });
    // 2. Liquidity sweep
    if (lwRatio > 0.38 && rangePos < 0.52 && price > low * 1.002) signals.push({ s: 'LIQUIDITY_SWEEP', pts: 22, note: `Wick ${(lwRatio*100).toFixed(0)}% — stops cleared` });
    // 3. Compression
    const compRange = isMeme ? 0.08 : 0.055;
    if (range24h < compRange && Math.abs(change24h) < 4 && vol24h > 3e6) signals.push({ s: 'COMPRESSION', pts: 18, note: `Range ${(range24h*100).toFixed(1)}% — coiling` });
    // 4. Absorption
    if (vt >= 1 && bodyRatio < 0.25 && lwRatio > 0.25 && rangePos < 0.58) signals.push({ s: 'ABSORPTION', pts: 18, note: `Body ${(bodyRatio*100).toFixed(0)}%/wick ${(lwRatio*100).toFixed(0)}% — SM taking supply` });
    // 5. Higher low
    if (change24h > 0.3 && change24h < (isMeme ? 12 : 7) && (change7d||0) > -15 && rangePos > 0.38) signals.push({ s: 'HIGHER_LOW', pts: 15, note: `+${change24h.toFixed(1)}% HL forming` });
    const count = signals.length;
    const piScore = Math.min(25, Math.round(signals.reduce((a,s) => a+s.pts,0) * 25/75));
    const stage = count >= 4 ? 'READY 🔥' : count === 3 ? 'EARLY 📈' : count === 2 ? 'FORMING 🔄' : 'WEAK';
    return { valid: count >= 2, count, score: piScore, stage, signals, alreadyPumped: false };
  }

  // ── SMART MONEY VALIDATION (25pts) ───────────────────────────────
  function validateSM(price, high, low, open, change24h, change7d, vol24h, rangePos, lwRatio, bodyRatio) {
    const vt = vol24h >= 500e6 ? 5 : vol24h >= 100e6 ? 4 : vol24h >= 30e6 ? 3 : vol24h >= 10e6 ? 2 : vol24h >= 2e6 ? 1 : 0;
    const signals = [];
    if (lwRatio > 0.38 && rangePos < 0.55 && price > low * 1.002) {
      const str = lwRatio > 0.55 ? 'STRONG' : 'MODERATE';
      signals.push({ type: 'LIQUIDITY_SWEEP', strength: str, pts: str==='STRONG'?22:14 });
    }
    if (vt >= 2 && Math.abs(change24h) <= 4) signals.push({ type: 'ACCUMULATION', strength: vt>=4?'STRONG':'MODERATE', pts: vt>=4?22:13 });
    else if (vt >= 1 && Math.abs(change24h) <= 2) signals.push({ type: 'ACCUMULATION', strength: 'MODERATE', pts: 10 });
    if (vt >= 1 && bodyRatio < 0.25 && lwRatio > 0.25) signals.push({ type: 'ABSORPTION', strength: 'STRONG', pts: 20 });
    if (change24h > 2.5 && change24h < 12 && rangePos > 0.52 && lwRatio > 0.18) signals.push({ type: 'STRUCTURE_RECLAIM', strength: change24h>5?'STRONG':'MODERATE', pts: change24h>5?18:11 });
    const strong = signals.filter(s=>s.strength==='STRONG').length;
    const raw = signals.reduce((a,s)=>a+s.pts,0);
    return { signals, count: signals.length, strong, smScore: Math.min(25, Math.round(raw*25/66)), valid: signals.length>=2 };
  }

  // ── REALISTIC RR ENGINE ──────────────────────────────────────────
  // Normal: 1:3–1:5 | Meme: 1:2–1:4 | MAX +100%
  function calcRR(price, low, high, ath, isMeme) {
    const dailyRange = high > low ? (high-low)/price : 0.05;
    const slPct = isMeme
      ? Math.max(0.06, Math.min(0.15, dailyRange * 2 + 0.03))   // meme wider SL
      : Math.max(0.05, Math.min(0.12, dailyRange * 1.5 + 0.02));
    const slPrice = +(price * (1-slPct)).toFixed(8);
    const slDist = price - slPrice;
    const minRR = isMeme ? 2 : 3;
    const maxTP = price * 2.0; // MAX +100%
    // TP1: minRR × SL distance
    const tp1 = Math.min(price + slDist * minRR, maxTP);
    // TP2: (minRR + 1.5) × SL distance
    const tp2 = Math.min(price + slDist * (minRR + 1.5), maxTP);
    const tp1Pct = +((tp1-price)/price*100).toFixed(1);
    const tp2Pct = +((tp2-price)/price*100).toFixed(1);
    const rr1 = +((tp1-price)/slDist).toFixed(2);
    const rr2 = +((tp2-price)/slDist).toFixed(2);
    const unrealistic = tp1Pct > 100;
    return { slPrice, slPct: +(slPct*100).toFixed(1), slDist, tp1:+tp1.toFixed(8), tp2:+tp2.toFixed(8), tp1Pct, tp2Pct, rr1, rr2, rrLabel:`1:${rr1.toFixed(1)} / 1:${rr2.toFixed(1)}`, unrealistic };
  }

  // ── SCORING ENGINE ────────────────────────────────────────────────
  function calcScore(coin, btcCh24, btcCh7, fgV, pi, sm, rr1, regimeBonus, isMeme) {
    const { price, vol24h, change24h, high, low, open, change7d, change30d, ath } = coin;
    const range = Math.max(high-low, price*0.01);
    const rangePos = (price-low)/range;
    const lw = Math.min(price,open)-low;
    const lwRatio = lw/range;
    const fromATH = ath>0 ? ((price-ath)/ath*100) : 0;
    const rs7d = (change7d||0) - btcCh7;
    const vt = vol24h>=500e6?5:vol24h>=100e6?4:vol24h>=30e6?3:vol24h>=10e6?2:vol24h>=2e6?1:0;
    const flat = Math.abs(change24h) <= (isMeme ? 5 : 3);

    // Momentum (20)
    let mom = rs7d>12&&flat?20:rs7d>6&&change24h>=0?17:rs7d>2&&change24h>=0?14:rs7d>0&&btcCh7<0?16:rs7d>=-3&&change24h>=0?11:change24h>2?9:rs7d<-10?4:7;
    if (fgV<=25) mom=Math.min(20,mom+3);
    // Meme momentum bonus: high volume surge is good signal
    if (isMeme && change24h > 3 && vt >= 2) mom = Math.min(20, mom + 3);

    // Structure (15)
    const ssl = lwRatio>0.38&&rangePos<0.52;
    const choch = change24h>3&&change24h<12&&rangePos>0.55;
    let struct = ssl&&choch?15:ssl&&change24h>1?13:choch?12:ssl?9:(change7d||0)>3&&(change30d||0)<-15?8:flat&&vt>=1?7:rangePos<0.35?5:3;
    if (rs7d>8) struct=Math.min(15,struct+3);

    // Market context (15)
    const inGolden = fromATH<=-55&&fromATH>=-80;
    let mkt = inGolden&&rangePos<0.50?15:inGolden?12:fromATH<=-80&&fromATH>=-97&&rangePos<0.45?13:fromATH<=-30&&fromATH>=-55&&rangePos<0.40?10:fromATH<=-30?8:rangePos<0.35?7:4;
    if (fgV<=25) mkt=Math.min(15,mkt+3);
    if (rr1>=4) mkt=Math.min(15,mkt+2);

    const raw = pi.score + sm.smScore + mom + struct + mkt + regimeBonus;
    const totalScore = Math.max(0,Math.min(100,Math.round(raw)));

    // Confidence
    const smAdj = sm.strong>=2?15:sm.valid?8:-15;
    const piAdj = pi.count>=4?15:pi.count>=3?10:pi.count>=2?5:-10;
    const rrAdj = rr1>=4?8:rr1>=3?4:rr1>=2?2:-15;
    const rsAdj = rs7d>5?8:rs7d>0?4:rs7d<-8?-8:0;
    const confidence = Math.max(0,Math.min(100,Math.round((raw/100)*100+smAdj+piAdj+rrAdj+rsAdj)));

    return { totalScore, confidence, components: { pi:pi.score, sm:sm.smScore, mom, struct, mkt }, fromATH };
  }

  // ── ENTRY CONFIRMATION ────────────────────────────────────────────
  function checkConfirmation(change24h, lwRatio, bodyRatio, rangePos, vol24h) {
    const cs = [];
    const vt = vol24h>=100e6?3:vol24h>=30e6?2:vol24h>=5e6?1:0;
    if (lwRatio>0.35&&bodyRatio<0.28) cs.push('REJECTION');
    if (vt>=1&&(change24h>0.3||Math.abs(change24h)<2)) cs.push('VOLUME_SPIKE');
    if (change24h>2.5&&change24h<12&&rangePos>0.55) cs.push('MICRO_BOS');
    if (lwRatio>0.28&&change24h>0.3&&rangePos>0.42) cs.push('SWEEP_RECOVERY');
    return { confirmations: cs, count: cs.length, valid: cs.length>=2, needs: Math.max(0,2-cs.length) };
  }

  // ── CONFLICT ENGINE ───────────────────────────────────────────────
  function checkConflicts(change24h, change7d, change30d, rangePos, regime, btcCh7, fgV) {
    const conflicts = [];
    const htfBear = (change7d||0)<-10||(change30d||0)<-55;
    const ltfBull = change24h>0&&rangePos>0.45;
    if (htfBear&&ltfBull) conflicts.push({ sev:'HIGH', note:'HTF bear + LTF bull = dead cat' });
    if (regime.includes('BEAR')&&change24h>6) conflicts.push({ sev:'HIGH', note:`Bear regime + +${change24h.toFixed(1)}%` });
    if (change24h>9&&btcCh7<0) conflicts.push({ sev:'HIGH', note:'Pump while BTC falls' });
    const hi = conflicts.filter(c=>c.sev==='HIGH').length;
    const med = conflicts.filter(c=>c.sev==='MEDIUM').length;
    const level = hi>=1||hi+med>=2?'HIGH':med>=1?'MEDIUM':'LOW';
    return { conflicts, level, action: level==='HIGH'?'REJECT':level==='MEDIUM'?'WAIT':'PROCEED' };
  }

  // ── TRADE STATE MACHINE ───────────────────────────────────────────
  function getTradeState(sym, price, entLo, entHi, rr, tier, score) {
    const now = Date.now();
    const ex = TRADE_STORE.get(sym);
    const EXPIRY = 72*3600*1000;
    if (ex) {
      const s = ex.state;
      if (['IN_ZONE','TRIGGERED','ACTIVE'].includes(s)) {
        if (price <= ex.sl*0.999) {
          const pnl = ex.ep>0 ? +((price-ex.ep)/ex.ep*100).toFixed(2) : 0;
          TRADE_STORE.set(sym, {...ex, state:'INVALID', closed:now, pnl});
          return { state:'INVALID', tag:'❌ INVALID SL', active:false, pnl };
        }
        if (price >= ex.tp1*0.998) {
          const pnl = +((ex.tp1-ex.ep)/ex.ep*100).toFixed(2);
          TRADE_STORE.set(sym, {...ex, state:'COMPLETED', closed:now, pnl});
          return { state:'COMPLETED', tag:`✅ COMPLETED +${pnl}%`, active:false, pnl };
        }
        const pnl = ex.ep>0 ? +((price-ex.ep)/ex.ep*100).toFixed(2) : 0;
        return { state:s, tag:`${s} PnL:${pnl>=0?'+':''}${pnl}%`, active:true, ep:ex.ep, pnl, sl:ex.sl, tp1:ex.tp1, tp2:ex.tp2, rr:ex.rr, tier:ex.tier, locked:true };
      }
      if (s==='READY'&&now-(ex.st||now)>EXPIRY) {
        TRADE_STORE.set(sym, {...ex, state:'EXPIRED'});
        return { state:'EXPIRED', tag:'⏰ EXPIRED', active:false };
      }
    }
    let actCnt=0;
    TRADE_STORE.forEach(v=>{if(['IN_ZONE','TRIGGERED','ACTIVE'].includes(v.state))actCnt++;});
    if (actCnt>=MAX_ACTIVE) return { state:'READY', tag:'MAX TRADES REACHED', active:false, blocked:true };
    if (price>=entLo*0.999&&price<=entHi*1.01) {
      TRADE_STORE.set(sym, { state:'IN_ZONE', ep:price, et:now, st:ex?.st||now, sl:rr.slPrice, tp1:rr.tp1, tp2:rr.tp2, rr:rr.rrLabel, tier, score });
      return { state:'IN_ZONE', tag:'⚡ IN_ZONE', active:true, ep:price };
    }
    if (!ex||ex.state==='EXPIRED') TRADE_STORE.set(sym, { state:'READY', st:now, sl:rr.slPrice, tp1:rr.tp1, tp2:rr.tp2, rr:rr.rrLabel, tier, score });
    const d = (entLo-price)/price;
    return { state:'READY', tag:`READY — ${d<=0?'AT ZONE':d<0.02?'NEAR 2%':d<0.05?'NEAR 5%':'WAITING'}`, active:false };
  }

  // ── SETUP LOCK ENGINE ─────────────────────────────────────────────
  // Called when a setup is valid for the first time
  // Returns locked data (immutable entry/SL/TP)
  function lockSetup(sym, price, entLo, entHi, rr, score, confidence, tier, assetType, isMeme) {
    const now = Date.now();
    const existing = SETUP_LOCK.get(sym);

    // Already locked — update current price but NEVER change entry/SL/TP
    if (existing && !['COMPLETED','INVALID','CANCELLED'].includes(existing.status)) {
      const currentPnl = existing.entryPrice > 0
        ? +((price - existing.entryPrice) / existing.entryPrice * 100).toFixed(2) : 0;

      // Check TP2 hit (use locked TP2)
      if (price >= existing.tp2 * 0.998) {
        const pnl = +((existing.tp2 - existing.entryPrice) / existing.entryPrice * 100).toFixed(2);
        SETUP_LOCK.set(sym, { ...existing, status: 'COMPLETED', currentPrice: price, pnl, closedAt: now });
        sendTelegram(`✅ <b>TP2 HIT — ${sym}</b>\n💰 Profit: +${pnl}%\nTP2: ${fmtP(existing.tp2)}\nEntry was: ${fmtP(existing.entryPrice)}\n🏷️ Score: ${existing.score} | ${existing.tier}`);
        return { ...SETUP_LOCK.get(sym), isLocked: true };
      }

      // Check TP1 hit → still active
      if (price >= existing.tp1 * 0.998 && existing.status !== 'TP1_HIT' && existing.status !== 'ACTIVE') {
        SETUP_LOCK.set(sym, { ...existing, status: 'TP1_HIT', currentPrice: price, pnl: currentPnl });
        sendTelegram(`🎯 <b>TP1 HIT — ${sym}</b>\n💰 Floating: +${currentPnl}%\nTP1: ${fmtP(existing.tp1)} (+${existing.tp1Pct}%)\nTP2 target: ${fmtP(existing.tp2)}\n📊 Score: ${existing.score}`);
        return { ...SETUP_LOCK.get(sym), isLocked: true };
      }

      // Check SL hit (use locked SL)
      if (price <= existing.sl * 0.999) {
        const pnl = +((price - existing.entryPrice) / existing.entryPrice * 100).toFixed(2);
        SETUP_LOCK.set(sym, { ...existing, status: 'INVALID', currentPrice: price, pnl, closedAt: now });
        sendTelegram(`❌ <b>SL HIT — ${sym}</b>\n📉 Loss: ${pnl}%\nSL: ${fmtP(existing.sl)}\nEntry was: ${fmtP(existing.entryPrice)}\n⚠️ Setup removed from watchlist`);
        return { ...SETUP_LOCK.get(sym), isLocked: true };
      }

      // Check TRIGGERED (price enters locked entry zone)
      if (price >= existing.entryLo && price <= existing.entryHi && existing.status === 'WATCHING') {
        SETUP_LOCK.set(sym, { ...existing, status: 'TRIGGERED', entryPrice: price, triggeredAt: now, currentPrice: price, pnl: 0 });
        sendTelegram(`⚡ <b>TRIGGERED — ${sym}</b>\n📍 Price entered entry zone: ${fmtP(price)}\n🎯 Entry: ${fmtP(existing.entryLo)} – ${fmtP(existing.entryHi)}\n🛑 SL: ${fmtP(existing.sl)} | TP1: ${fmtP(existing.tp1)} (+${existing.tp1Pct}%)\n📊 Score: ${existing.score} | Conf: ${existing.confidence}%\n⚡ Konfirmasi entry sekarang!`);
        return { ...SETUP_LOCK.get(sym), isLocked: true };
      }

      // Still WATCHING or ACTIVE — update price only
      SETUP_LOCK.set(sym, { ...existing, currentPrice: price, pnl: currentPnl });
      return { ...SETUP_LOCK.get(sym), isLocked: true };
    }

    // New setup — lock it (max 10 watchlist)
    const activeWatchlist = [...SETUP_LOCK.values()].filter(s => !['COMPLETED','INVALID','CANCELLED'].includes(s.status));
    if (activeWatchlist.length >= MAX_WATCHLIST) return null; // watchlist full

    const locked = {
      symbol: sym, status: 'WATCHING',
      // LOCKED VALUES — never change after this point
      entryLo: +entLo.toFixed(8), entryHi: +entHi.toFixed(8),
      entryPrice: +(price * 0.999).toFixed(8), // optimal entry price
      sl: rr.slPrice, slPct: rr.slPct,
      tp1: rr.tp1, tp1Pct: rr.tp1Pct,
      tp2: rr.tp2, tp2Pct: rr.tp2Pct,
      rr: rr.rrLabel,
      // Metadata
      score, confidence, tier, assetType, isMeme,
      lockedAt: now, lockedAtStr: new Date(now).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }),
      currentPrice: price, pnl: 0,
      triggeredAt: null, entryTime: null, closedAt: null,
    };
    SETUP_LOCK.set(sym, locked);

    // Telegram: new setup locked
    sendTelegram(`🔒 <b>SETUP LOCKED — ${sym}</b>\n📊 Score: ${score} | Conf: ${confidence}% | ${tier}\n💰 Asset: ${assetType}${isMeme ? ' 🎭 MEME' : ''}\n📍 Entry Zone: ${fmtP(entLo)} – ${fmtP(entHi)}\n🛑 SL: ${fmtP(rr.slPrice)} (-${rr.slPct}%)\n🎯 TP1: ${fmtP(rr.tp1)} (+${rr.tp1Pct}%) R:${rr.rr1}\n🎯 TP2: ${fmtP(rr.tp2)} (+${rr.tp2Pct}%) R:${rr.rr2}\n⏰ Locked: ${locked.lockedAtStr} WIB`);

    return { ...locked, isLocked: true };
  }

    // ══════════════════════════════════════════════════════════════════
  // MAIN
  // ══════════════════════════════════════════════════════════════════
  try {
    const t0 = Date.now();
    const [binR, cgR, fngR, glbR, btcKR] = await Promise.allSettled([
      sf('https://api.binance.com/api/v3/ticker/24hr', 6000),
      sf('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=volume_desc&per_page=250&page=1&sparkline=false&price_change_percentage=7d,30d', 6000),
      sf('https://api.alternative.me/fng/?limit=1&format=json'),
      sf('https://api.coingecko.com/api/v3/global'),
      sf('https://min-api.cryptocompare.com/data/v2/histohour?fsym=BTC&tsym=USD&limit=168', 5000),
    ]);

    const bins = binR.status==='fulfilled'&&Array.isArray(binR.value)&&binR.value.length>100?binR.value:[];
    const cgs = cgR.status==='fulfilled'&&Array.isArray(cgR.value)?cgR.value:[];
    const fgV = fngR.status==='fulfilled'?parseInt(fngR.value?.data?.[0]?.value||50):50;
    const glb = glbR.status==='fulfilled'?glbR.value?.data:null;
    const btcK = btcKR.status==='fulfilled'&&btcKR.value?.Response==='Success'?btcKR.value.Data.Data.map(d=>+d.close).filter(v=>v>0):[];

    const bmap={};
    bins.forEach(t=>{if(t?.symbol)bmap[t.symbol]=t;});
    const btcT=bmap['BTCUSDT'];
    const btcPx=+(btcT?.lastPrice||0);
    const btcCh24=+(btcT?.priceChangePercent||0);
    let btcCh7=0, btcTrend='NEUTRAL';
    if(btcK.length>=50){
      const c=btcK[btcK.length-1], w7=btcK.length>=168?btcK[btcK.length-168]:btcK[0];
      btcCh7=w7>0?+((c-w7)/w7*100).toFixed(2):0;
      const ma50=btcK.slice(-50).reduce((a,b)=>a+b,0)/50;
      btcTrend=c>ma50*1.02?'BULLISH':c<ma50*0.98?'BEARISH':'NEUTRAL';
    }
    const btcDom=+(glb?.market_cap_percentage?.btc||58).toFixed(1);
    const dsh=Math.floor((Date.now()-new Date('2024-04-20').getTime())/86400000);
    const regime=detectRegime(btcCh7,btcCh24,btcDom,fgV,btcTrend);

    const STABLES=new Set(['USDT','USDC','BUSD','TUSD','DAI','FDUSD','USDP','FRAX','LUSD','USDS','SUSD','GUSD','PYUSD','CRVUSD','USDD','CUSD','USDX','USDB','XUSD','USDJ','AUSD','AGEUR','JEUR','XSGD','EURS','EURT','CADC','GYEN','NZDS','BRLA','MXNT','BIDR','BVND','IDRT','TRYB','BRLC','PAXG','XAUT','WBTC','WETH','WBNB','STETH','CBETH','RETH','BETH']);
    const BAD=['UP','DOWN','BEAR','BULL','3L','3S','2L','2S'];
    const HAN=/[\u4e00-\u9fff]/;
    const cgm={};
    cgs.forEach(c=>{if(c?.symbol)cgm[c.symbol.toUpperCase()]=c;});

    const candidates=[];
    const seen=new Set();
    bins.forEach(t=>{
      if(!t?.symbol?.endsWith('USDT'))return;
      const b=t.symbol.replace('USDT','');
      if(STABLES.has(b)||seen.has(b)||HAN.test(b)||BAD.some(s=>b.startsWith(s)||b.endsWith(s))||b.length<2||b.length>12)return;
      const v=+(t.quoteVolume||0), p=+(t.lastPrice||0);
      if(v<200000||p<=0||(p>=0.97&&p<=1.03&&Math.abs(+(t.priceChangePercent||0))<2))return;
      seen.add(b);
      const cg=cgm[b];
      candidates.push({ base:b, price:p, vol24h:v, change24h:+(t.priceChangePercent||0), high:+(t.highPrice||p), low:+(t.lowPrice||p), open:+(t.openPrice||p), change7d:cg?+(cg.price_change_percentage_7d||0):null, change30d:cg?+(cg.price_change_percentage_30d||0):null, ath:cg?+(cg.ath||0):0, marketCap:cg?+(cg.market_cap||0):0, cgName:cg?.name||b });
    });
    cgs.forEach(c=>{
      const b=(c.symbol||'').toUpperCase();
      if(STABLES.has(b)||seen.has(b)||HAN.test(c.name||''))return;
      const v=+(c.total_volume||0), p=+(c.current_price||0);
      if(v<500000||p<=0||(p>=0.97&&p<=1.03))return;
      candidates.push({ base:b, price:p, vol24h:v, change24h:+(c.price_change_percentage_24h||0), high:p*1.02, low:p*0.98, open:p/(1+(+(c.price_change_percentage_24h||0))/100), change7d:+(c.price_change_percentage_7d||0), change30d:+(c.price_change_percentage_30d||0), ath:+(c.ath||0), marketCap:+(c.market_cap||0), cgName:c.name||b });
    });

    const killed={KILL:0,PI:0,SM:0,RR:0,CONFLICT:0,SCORE:0,STALE:0,EXPIRED:0};
    const allOutputs=[];
    const activeSetups=[];
    let actCnt=0;
    TRADE_STORE.forEach(v=>{if(['IN_ZONE','TRIGGERED','ACTIVE'].includes(v.state))actCnt++;});

    for (const coin of candidates.slice(0,800)) {
      const {base:sym, price, ath, change24h, vol24h, change7d, change30d, marketCap} = coin;
      if(!price||price<=0)continue;
      if(ath>0&&((price-ath)/ath*100)<-99){killed.STALE++;continue;}

      const assetType = classifyAsset(sym, marketCap, vol24h);
      const isMeme = assetType === 'MEME';

      const range=Math.max(coin.high-coin.low,price*0.01);
      const rangePos=(price-coin.low)/range;
      const lw=Math.min(price,coin.open)-coin.low;
      const lwRatio=lw/range;
      const bodyRatio=Math.abs(price-coin.open)/range;
      const vt=vol24h>=500e6?5:vol24h>=100e6?4:vol24h>=30e6?3:vol24h>=10e6?2:vol24h>=2e6?1:0;

      // Protect active trades
      const ex=TRADE_STORE.get(sym);
      if(ex&&['IN_ZONE','TRIGGERED','ACTIVE'].includes(ex.state)){
        if(price<=ex.sl*0.999){TRADE_STORE.set(sym,{...ex,state:'INVALID',closed:Date.now()});continue;}
        const pnl=ex.ep>0?+((price-ex.ep)/ex.ep*100).toFixed(2):0;
        activeSetups.push({ symbol:sym, assetType, price, status:ex.state, tag:ex.state+' PnL:'+(pnl>=0?'+':'')+pnl+'%', tier:ex.tier||'A', ep:ex.ep, pnl, sl:ex.sl, tp1:ex.tp1, tp2:ex.tp2, rr:ex.rr, change24h:+change24h.toFixed(2), locked:true });
        continue;
      }

      if(regime.kill){killed.KILL++;continue;}

      // Time decay
      const timeStatus = getTimestamp(sym, isMeme);
      if(timeStatus.expired){killed.EXPIRED++;continue;}
      // Downgrade weak setups
      const timeBonus = timeStatus.fresh ? 3 : timeStatus.valid ? 0 : -5;

      // Pre-Impulse (adaptive piMin per regime)
      const pi = detectPreImpulse(price,coin.high,coin.low,coin.open,change24h,change7d,vol24h,rangePos,lwRatio,bodyRatio,isMeme);
      if(pi.alreadyPumped){killed.PI++;continue;}
      if(pi.count < regime.piMin){killed.PI++;continue;}

      // Hard filter
      if(vt<1&&!isMeme){killed.PI++;continue;}
      if(change24h<-10){killed.PI++;continue;}

      // SM
      const sm=validateSM(price,coin.high,coin.low,coin.open,change24h,change7d,vol24h,rangePos,lwRatio,bodyRatio);
      if(!sm.valid){killed.SM++;continue;}

      // RR
      const rr=calcRR(price,coin.low,coin.high,ath,isMeme);
      if(rr.unrealistic||(isMeme?rr.rr1<2:rr.rr1<3)){killed.RR++;continue;}

      // Conflict
      const conf=checkConflicts(change24h,change7d,change30d,rangePos,regime.regime,btcCh7,fgV);
      if(conf.action==='REJECT'){killed.CONFLICT++;continue;}

      // Score
      const sc=calcScore(coin,btcCh24,btcCh7,fgV,pi,sm,rr.rr1,regime.bonus||0,isMeme);
      const bearPen=regime.regime.includes('BEAR')?-10:0;
      const finalScore=Math.max(0,Math.min(100,sc.totalScore+bearPen+timeBonus));
      const finalConf=Math.max(0,Math.min(100,sc.confidence+(regime.regime.includes('BEAR')?-8:0)));

      const scoreMin = isMeme ? Math.max(70, regime.scoreMin-5) : regime.scoreMin;
      const confMin = isMeme ? Math.max(75, regime.confMin-5) : regime.confMin;
      if(finalScore<scoreMin||finalConf<confMin){killed.SCORE++;continue;}

      // Entry confirmation
      const ec=checkConfirmation(change24h,lwRatio,bodyRatio,rangePos,vol24h);

      // Trade state
      const tier=finalScore>=87?'S':finalScore>=75?'A':'B';
      const entLo=Math.max(price*0.97,coin.low*0.99);
      const entHi=price*1.01;
      const ts=getTradeState(sym,price,entLo,entHi,rr,tier,finalScore);

      // Execution consistency check
      const prevDecision=DECISION_HISTORY.get(sym);
      let executionConsistent=true;
      if(prevDecision==='EXECUTE'&&ts.state==='IN_ZONE'){
        // Was EXECUTE before — keep as EXECUTE (don't downgrade)
        executionConsistent=true;
      }

      // Final decision
      let decision, decColor;
      const execAllowed = ts.state==='IN_ZONE'&&ec.valid&&conf.action==='PROCEED'&&!ts.blocked&&timeStatus.valid;
      if(execAllowed){
        decision='EXECUTE ✅'; decColor='#ff6b35';
        DECISION_HISTORY.set(sym,'EXECUTE');
      } else if(ts.state==='IN_ZONE'&&!ec.valid){
        decision='WAIT ⏳ — Need confirmation'; decColor='var(--amber)';
      } else if(conf.action==='WAIT'||!timeStatus.valid){
        decision='WAIT ⏳ — Conflict/timing'; decColor='var(--amber)';
      } else if(ts.blocked){
        decision='WAIT ⏳ — Max active'; decColor='var(--amber)';
      } else {
        decision='READY ✅ — Limit at '+fmtP(entLo)+'–'+fmtP(entHi); decColor='var(--g)';
      }

      allOutputs.push({
        rank:0, symbol:sym, name:coin.cgName||sym, assetType,
        price, change24h:+change24h.toFixed(2), change7d:+(change7d||0).toFixed(2),
        vol24h, fromATH:sc.fromATH!==0?+sc.fromATH.toFixed(1):null,
        tier, tierLabel:tier==='S'?'🔥 TIER S':tier==='A'?'✅ TIER A':'⬜ TIER B',
        finalScore, confidence:finalConf, positionRank:'', // set after ranking
        timeStatus, freshness:{status:timeStatus.status, fresh:timeStatus.fresh, valid:timeStatus.valid},
        preImpulse:{count:pi.count,stage:pi.stage,valid:pi.valid,signals:pi.signals},
        smDetection:{count:sm.count,valid:sm.valid,strong:sm.strong,signals:sm.signals},
        entryConfirmation:{valid:ec.valid,count:ec.count,needs:ec.needs,list:ec.confirmations},
        conflict:{level:conf.level,action:conf.action},
        tradeState:ts, status:ts.state,
        rr:{tp1:rr.tp1,tp2:rr.tp2,tp1Pct:rr.tp1Pct,tp2Pct:rr.tp2Pct,rr1:rr.rr1,rr2:rr.rr2,label:rr.rrLabel,slPrice:rr.slPrice,slPct:rr.slPct},
        entryZone:{lo:+entLo.toFixed(8),hi:+entHi.toFixed(8),optimal:+(price*0.999).toFixed(8)},
        scoreBreakdown:sc.components,
        decision, decisionColor:decColor,
        positionSize:tier==='S'?'2-3%':'1-2%',
        isMeme, rrMode:isMeme?'HIGH RISK MODE (1:2–1:4)':'NORMAL (1:3–1:5)',
        tradeData:{ coin:sym, type:assetType, entry:+(price*0.999).toFixed(8), sl:rr.slPrice, tp1:rr.tp1, tp2:rr.tp2, rr:rr.rrLabel, status:['IN_ZONE','TRIGGERED'].includes(ts.state)?'ACTIVE':ts.state, confidence:finalConf, score:finalScore, timestamp:new Date().toISOString().split('T')[0], result:'RUNNING', positionRank:'', tier, setupTime:Date.now(), pnl:0, closedAt:null },
      });
    }

    // Position Ranking: ELITE (top 2), HIGH (3-5), NORMAL (rest)
    allOutputs.sort((a,b)=>(b.finalScore+b.confidence)-(a.finalScore+a.confidence)||b.vol24h-a.vol24h);
    allOutputs.forEach((r,i)=>{
      r.rank=i+1;
      r.positionRank=i<2?'ELITE 🏆':i<5?'HIGH ⭐':'NORMAL';
      // Only ELITE can EXECUTE
      if(r.positionRank==='NORMAL'&&r.decision.includes('EXECUTE'))r.decision='READY ✅ — Limit at '+fmtP(r.entryZone.lo)+'–'+fmtP(r.entryZone.hi);
    });

    // Lock valid setups to watchlist (persistent until TP2/SL)
    allOutputs.forEach(function(output) {
      const rrData = output.rr;
      const ez = output.entryZone;
      if (rrData && ez && output.finalScore >= 72) {
        lockSetup(
          output.symbol, output.price,
          ez.lo, ez.hi, rrData,
          output.finalScore, output.confidence,
          output.tier, output.assetType, output.isMeme
        );
      }
    });

    // Export SETUP_LOCK watchlist
    const watchlist = [];
    SETUP_LOCK.forEach((v, k) => { watchlist.push({ ...v, symbol: k }); });
    watchlist.sort((a, b) => {
      const order = { TRIGGERED: 0, TP1_HIT: 1, ACTIVE: 2, WATCHING: 3, COMPLETED: 4, INVALID: 5 };
      return (order[a.status] ?? 9) - (order[b.status] ?? 9) || b.score - a.score;
    });

    // Separate meme from regular
    const memeOutputs = allOutputs.filter(r=>r.isMeme);
    const regularOutputs = allOutputs.filter(r=>!r.isMeme);

    // Export active trades for client storage
    const activeTrades=[];
    TRADE_STORE.forEach((v,k)=>{
      if(['IN_ZONE','TRIGGERED','ACTIVE','COMPLETED','INVALID'].includes(v.state)){
        activeTrades.push({ symbol:k, state:v.state, entryPrice:v.ep, setupTime:v.st, entryTime:v.et, sl:v.sl, tp1:v.tp1, tp2:v.tp2, rr:v.rr, tier:v.tier, score:v.score, pnl:v.pnl||0 });
      }
    });

    res.setHeader('Cache-Control','s-maxage=60');
    return res.status(200).json({
      timestamp:Date.now(),
      scanTime:((Date.now()-t0)/1000).toFixed(1),
      totalScanned:candidates.length,
      totalQualified:allOutputs.length,
      totalKilled:Object.values(killed).reduce((a,b)=>a+b,0),
      killedBreakdown:killed,
      regularSetups:regularOutputs.slice(0,13),
      memeSetups:memeOutputs.slice(0,10),
      allSetups:allOutputs.slice(0,20),
      activeSetups,
      activeTrades,
      eliteCount:allOutputs.filter(r=>r.positionRank.includes('ELITE')).length,
      watchlist, watchlistActive: watchlist.filter(w=>!['COMPLETED','INVALID'].includes(w.status)).length,
      regime, systemStatus:{ activeCount:actCnt, maxAllowed:MAX_ACTIVE, canTake:actCnt<MAX_ACTIVE, btcTrend, fgValue:fgV, btcDom, btcCh7, btcPx },
    });
  } catch(e) { return res.status(500).json({ error:e.message, totalScanned:0 }); }
}

function fmtP(p){
  if(!p||p<=0)return'—';
  if(p>=10000)return p.toLocaleString('en-US',{maximumFractionDigits:0});
  if(p>=1000)return p.toLocaleString('en-US',{maximumFractionDigits:2});
  if(p>=1)return p.toFixed(4);
  if(p>=0.001)return p.toFixed(6);
  return p.toFixed(8);
}
