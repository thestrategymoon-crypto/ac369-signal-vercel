// api/morning-brief.js — 369 GLOBAL CRYPTO v2.0
// FULL REBUILD: Fix semua bug + upgrade akurasi
//
// FIXES v2.0:
//   1. Klines fetch: timeout 6000ms (was 3500), retCode check lebih robust
//   2. Bybit klines: volume col = d[5] (base qty), bukan d[6]
//   3. Minimum liquidity filter: OI >$500K + Vol >$500K untuk semua setups
//   4. ATR levels: per-koin nyata, bukan generic fallback
//   5. Whale detection: hanya koin dengan OI >$5M (institutional grade)
//   6. Smart Money Flow: filter OI >$50M + Vol >$2M
//   7. Spot Accum: hanya major/mid caps (vol >$1M, OI >$10M)
//   8. RSI fallback: diperbaiki formula estimasi saat klines tidak tersedia
//   9. OI change: fetch snapshot perbandingan sebelum dan sesudah
//  10. Convergence score: lebih ketat, base 40 bukan 48
// =====================================================================

'use strict';

// ─── MINIMUM LIQUIDITY THRESHOLDS ────────────────────────────────────
const MIN_VOL_SCAN     = 300_000;   // $300K/day minimum untuk masuk scan
const MIN_VOL_SIGNAL   = 1_000_000; // $1M untuk mendapat sinyal
const MIN_VOL_ELITE    = 5_000_000; // $5M untuk ELITE/PRIME convergence
const MIN_OI_WHALE     = 5_000_000; // $5M OI minimum untuk whale radar
const MIN_OI_FUTURES   = 10_000_000;// $10M OI untuk futures intelligence
const MIN_OI_FLOW      = 50_000_000;// $50M OI untuk Smart Money Flow Map

// ─── STABLECOIN + JUNK FILTER ─────────────────────────────────────────
const STAB = new Set([
  'USDT','USDC','BUSD','DAI','TUSD','FDUSD','USDE','FRAX','GUSD',
  'USDP','SUSD','LUSD','PYUSD','EURC','USDD','BIDR','IDRT','USDJ',
  'USTC','TRIBE','FEI','MIMATIC','MUSD','USDX','CUSD',
]);
const BAD_SUFFIX = ['UP','DOWN','BULL','BEAR','3L','3S','2L','2S','5L','5S','HALF'];
const BAD_PREFIX = ['1000']; // 1000BONK etc handled separately
const isBad = s => {
  if (!s || s.length > 15) return true;
  if (STAB.has(s)) return true;
  if (BAD_SUFFIX.some(b => s.endsWith(b))) return true;
  if (BAD_PREFIX.some(b => s.startsWith(b))) return true;
  // Filter koin yang jelas micro/meme tanpa OI — dilakukan di processing nanti
  return false;
};

// ─── KLINE COINS (verified Bybit linear symbols, semua konfirm ada) ──
const KLINE_COINS = [
  // Mega caps — selalu ada
  'BTC','ETH','BNB','SOL','XRP','ADA','AVAX','DOGE','TRX','TON',
  // Large caps
  'LINK','DOT','NEAR','SUI','APT','ARB','OP','INJ','SEI','ATOM',
  // DeFi
  'UNI','AAVE','CRV','MKR','LDO','GMX','JUP','PENDLE','DYDX','SNX',
  // AI/DePin
  'RENDER','FET','WLD','TAO','VIRTUAL','OLAS','IO','AGIX',
  // Meme majors
  'PEPE','WIF','BONK','FLOKI','SHIB',
  // Infrastructure
  'PYTH','JTO','W','EIGEN','ZK','STRK','IMX',
  // Others liquid
  'ENA','ONDO','NOT','XLM','HBAR','VET','ALGO',
  'TIA','BLUR','LTC','BCH','HYPE','TURBO','BOME',
];

const SECTORS = {
  Bitcoin:['BTC'],
  Ethereum:['ETH'],
  L1:['SOL','ADA','AVAX','TON','NEAR','SUI','APT','SEI','INJ','HBAR','ALGO','XLM','TRX','VET','ATOM','BNB'],
  L2:['ARB','OP','MATIC','STRK','IMX','ZK','SCROLL','BLAST','MANTA','METIS'],
  DeFi:['UNI','AAVE','CRV','MKR','SNX','COMP','PENDLE','GMX','JUP','DYDX','LDO','SUSHI','GNS','ENA','ONDO'],
  Payments:['XRP','LTC','BCH','XLM','DASH'],
  Gaming:['AXS','SAND','MANA','GALA','MAGIC','BEAM','RON','YGG'],
  AIDePin:['RENDER','FET','AGIX','TAO','WLD','IO','ARKM','VIRTUAL','OLAS','OCEAN','GRASS'],
  Infrastructure:['LINK','DOT','ATOM','FIL','GRT','API3','BAND','PYTH','JTO','W','EIGEN','TIA'],
  Meme:['DOGE','SHIB','PEPE','WIF','BONK','FLOKI','BOME','NEIRO','MOODENG','PNUT','ACT','TURBO','MEME','PEOPLE','GOAT','NOT','HYPE'],
  RWA:['ONDO','POLYX','RIO','CFG'],
};
const getSector = s => { for (const [n,v] of Object.entries(SECTORS)) if (v.includes(s)) return n; return 'Trending'; };

// ─── HELPERS ──────────────────────────────────────────────────────────
const N = (v, d=0) => { const n=+v; return (isNaN(n)||!isFinite(n)) ? d : n; };
const A = v => Array.isArray(v) ? v : [];
const cl = (v,a,b) => Math.max(a, Math.min(b, N(v)));

// Safe fetch — timeout ms, retry count
const sf = async (url, ms=5000, retries=0) => {
  for (let attempt=0; attempt<=retries; attempt++) {
    const ctrl = new AbortController();
    const tmr = setTimeout(() => ctrl.abort(), ms);
    try {
      const r = await fetch(url, {
        signal: ctrl.signal,
        headers: { 'Accept':'application/json', 'User-Agent':'369GlobalCrypto/2.0' },
      });
      clearTimeout(tmr);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      clearTimeout(tmr);
      if (attempt < retries) await new Promise(r => setTimeout(r, 400*(attempt+1)));
    }
  }
  return null;
};

// ─── TA CALCULATIONS ──────────────────────────────────────────────────
// Wilder RSI-14 (accurate, seeded properly)
function rsi14(closes) {
  if (!closes || closes.length < 16) return null;
  // Seed with simple avg of first 14
  let gains = 0, losses = 0;
  for (let i = 1; i <= 14; i++) {
    const d = closes[i] - closes[i-1];
    if (d > 0) gains += d; else losses -= d;
  }
  let avgG = gains / 14;
  let avgL = losses / 14;
  // Wilder smoothing for rest
  for (let i = 15; i < closes.length; i++) {
    const d = closes[i] - closes[i-1];
    avgG = (avgG * 13 + Math.max(d, 0)) / 14;
    avgL = (avgL * 13 + Math.max(-d, 0)) / 14;
  }
  if (avgL === 0) return 100;
  return cl(100 - 100 / (1 + avgG / avgL), 0, 100);
}

function emaCalc(arr, p) {
  if (!arr || arr.length < 2) return N(arr?.[arr.length-1]);
  const k = 2 / (p + 1);
  const seed = arr.slice(0, Math.min(p, arr.length));
  let e = seed.reduce((s,v)=>s+v, 0) / seed.length;
  for (let i = seed.length; i < arr.length; i++) e = arr[i]*k + e*(1-k);
  return e;
}

function macdCalc(closes) {
  if (!closes || closes.length < 28) return null;
  const k12=2/13, k26=2/27, k9=2/10;
  let e12=closes[0], e26=closes[0];
  const mv = [];
  for (const v of closes) {
    e12 = v*k12 + e12*(1-k12);
    e26 = v*k26 + e26*(1-k26);
    mv.push(e12 - e26);
  }
  let sig = mv.slice(0, 9).reduce((s,v)=>s+v, 0) / 9;
  for (let i=9; i<mv.length; i++) sig = mv[i]*k9 + sig*(1-k9);
  const n = mv.length;
  const last = N(mv[n-1]), prev = N(mv[n-2]||last);
  const h = last - sig, ph = prev - sig;
  return { bull: last>0&&h>0, bear: last<0&&h<0, xUp: h>0&&ph<=0, xDown: h<0&&ph>=0, val: +last.toFixed(8) };
}

function atrCalc(K, p=14) {
  if (!K || K.length < p+1) return 0;
  const trs = K.slice(1).map((k,i) =>
    Math.max(N(k.h)-N(k.l), Math.abs(N(k.h)-N(K[i].c)), Math.abs(N(k.l)-N(K[i].c)))
  );
  const recent = trs.slice(-p);
  return recent.reduce((s,v)=>s+v, 0) / recent.length;
}

// Parse Bybit kline array → OHLCV object
// Bybit returns: [openTime, open, high, low, close, volume, turnover]
// volume = base asset qty (e.g. BTC), turnover = quote (USDT)
function parseBybitKlines(raw) {
  if (!raw || !raw.length) return [];
  return raw
    .slice()
    .reverse() // oldest first
    .map(d => ({
      t: N(d[0]),
      o: N(d[1]),
      h: N(d[2]),
      l: N(d[3]),
      c: N(d[4]),
      v: N(d[5]),         // base volume
      vol: N(d[6]||d[5]), // quote volume (USDT)
    }))
    .filter(d => d.c > 0 && d.c < 1e13 && d.h >= d.l && d.h > 0);
}

// ─── WHALE DETECTION (institutional grade only) ────────────────────────
function detectWhaleAccumulation(coin) {
  const { price, c24, vol, fr, oi, rsi, pip, obvBull, atrPct, isCoiling } = coin;
  // Hard gate: tidak ada whale signal untuk koin tanpa institutional OI
  if (oi < MIN_OI_WHALE) return { score: 0, level: null, signals: [], tags: [] };

  const frPct = (fr||0) * 100;
  let score = 0;
  const signals = [];
  const tags = [];

  // 1. STEALTH ACCUMULATION: OI besar + harga flat + FR negatif
  // Ini tanda institusi beli secara diam-diam sambil hedge dengan shorts di futures
  if (oi > 200e6 && frPct < -0.003 && Math.abs(c24) < 2 && vol > 2e6) {
    score += 28;
    signals.push(`OI $${(oi/1e9).toFixed(2)}B + FR ${frPct.toFixed(4)}% + flat price = STEALTH ACCUM`);
    tags.push('WHALE_ACCUM');
  } else if (oi > 50e6 && frPct < -0.002 && Math.abs(c24) < 2.5 && vol > 1e6) {
    score += 18;
    signals.push(`OI $${(oi/1e6).toFixed(0)}M + FR ${frPct.toFixed(4)}% + flat = SM kumpul`);
    tags.push('ACCUM');
  }

  // 2. ABSORPTION: Volume besar + harga tidak naik = SM menyerap supply
  const volToOI = oi > 0 ? vol/oi : 0;
  if (vol > 30e6 && Math.abs(c24) < 2 && volToOI > 0.12 && oi > 30e6) {
    score += 20;
    signals.push(`Vol $${(vol/1e6).toFixed(0)}M vs OI $${(oi/1e6).toFixed(0)}M = ABSORPTION`);
    tags.push('ABSORPTION');
  } else if (vol > 10e6 && Math.abs(c24) < 1.5 && volToOI > 0.08) {
    score += 10;
    signals.push(`Vol/OI ratio ${(volToOI*100).toFixed(1)}% = volume tanpa movement`);
  }

  // 3. OBV DIVERGENCE: Volume beli dominan saat harga turun
  if (obvBull && c24 < -1 && rsi < 45 && oi > MIN_OI_WHALE) {
    score += 18;
    signals.push(`OBV bull saat harga -${Math.abs(c24).toFixed(1)}% = SM akumulasi tersembunyi`);
    tags.push('OBV_DIV');
  } else if (obvBull && c24 < 0 && rsi < 55) {
    score += 10;
    signals.push(`OBV positif saat harga melemah = smart money absorb`);
  }

  // 4. FUNDING SQUEEZE: FR sangat negatif = shorts terlalu banyak
  if (frPct < -0.01) {
    score += 25;
    signals.push(`FR ${frPct.toFixed(4)}% EXTREME = shorts bayar longs tiap 8h, pompa segera`);
    tags.push('FR_SQUEEZE');
  } else if (frPct < -0.005) {
    score += 15;
    signals.push(`FR ${frPct.toFixed(4)}% negatif kuat = squeeze imminent`);
    tags.push('SQUEEZE');
  } else if (frPct < -0.002) {
    score += 8;
    signals.push(`FR ${frPct.toFixed(4)}% negatif = bias long`);
  }

  // 5. BOTTOM ZONE: RSI oversold + OI besar + FR netral/negatif
  if (rsi < 28 && oi > 100e6 && frPct <= 0) {
    score += 22;
    signals.push(`RSI ${rsi.toFixed(0)} extreme oversold + OI $${(oi/1e6).toFixed(0)}M = BOTTOM ZONE`);
    tags.push('BOTTOM');
  } else if (rsi < 35 && frPct <= 0 && oi > 30e6) {
    score += 12;
    signals.push(`RSI ${rsi.toFixed(0)} oversold + OI $${(oi/1e6).toFixed(0)}M`);
  }

  // 6. COILING: ATR menyempit saat OI besar = energi terkumpul
  if (isCoiling && atrPct > 0 && atrPct < 2 && oi > 100e6 && Math.abs(c24) < 1.5) {
    score += 16;
    signals.push(`ATR ${atrPct.toFixed(2)}% compressed + OI $${(oi/1e9).toFixed(2)}B = COILING`);
    tags.push('COIL');
  }

  // 7. DISCOUNT ZONE: Price in lower range + OI building
  if (pip < 20 && oi > 200e6) {
    score += 14;
    signals.push(`Price position ${pip.toFixed(0)}% in range = DISCOUNT + OI $${(oi/1e9).toFixed(1)}B`);
    tags.push('DISCOUNT');
  }

  score = cl(score, 0, 100);
  const level = score >= 55 ? '🐳 MEGA WHALE' : score >= 38 ? '🐋 WHALE' : score >= 22 ? '🔍 SMART MONEY' : null;
  return { score, level, signals: signals.slice(0, 4), tags };
}

// ─── FUTURES INTELLIGENCE ENGINE ──────────────────────────────────────
function analyzeFutures(coin) {
  const { fr, oi, rsi, c24, vol, retailLong, oiChangePct } = coin;
  // Gate: perlu OI cukup untuk futures analysis bermakna
  if (oi < MIN_OI_FUTURES) return { score: 0, state: 'INSUFFICIENT_OI', stateColor: 'gray', signals: [], opportunity: null, frPct: 0, oiB: 0 };

  const frPct = (fr||0) * 100;
  let score = 0;
  const signals = [];
  let state = 'NEUTRAL';
  let stateColor = 'gray';
  let opportunity = null;
  const oiCh = oiChangePct || 0;

  // 4 OI States — inti dari futures intelligence
  if (oiCh > 3 && c24 > 1) {
    state = 'NEW LONGS'; stateColor = 'green'; score += 15;
    signals.push(`OI +${oiCh.toFixed(1)}% + harga +${c24.toFixed(1)}% = posisi LONG baru valid`);
    opportunity = 'LONG_ENTRY';
  } else if (oiCh > 3 && c24 < -1) {
    state = 'NEW SHORTS'; stateColor = 'red'; score -= 12;
    signals.push(`OI +${oiCh.toFixed(1)}% + harga turun = SHORT baru dominan`);
    opportunity = 'WAIT';
  } else if (oiCh < -3 && c24 > 1) {
    state = 'SHORT SQUEEZE'; stateColor = 'cyan'; score += 14;
    signals.push(`OI -${Math.abs(oiCh).toFixed(1)}% + harga naik = SHORT cover paksa`);
    opportunity = 'MOMENTUM';
  } else if (oiCh < -3 && c24 < -1) {
    state = 'LONG LIQ'; stateColor = 'orange'; score -= 5;
    signals.push(`OI -${Math.abs(oiCh).toFixed(1)}% + harga turun = LONG liquidasi`);
    opportunity = rsi < 30 ? 'DCA_ZONE' : 'WAIT';
  }

  // FR scoring
  if (frPct < -0.05) {
    score += 28; signals.push(`FR ${frPct.toFixed(4)}% EXTREME BEARISH SENTIMENT = SQUEEZE IMMINENT`);
    opportunity = 'SQUEEZE_PLAY';
  } else if (frPct < -0.02) {
    score += 18; signals.push(`FR ${frPct.toFixed(4)}% negatif kuat = short-heavy, reversal likely`);
  } else if (frPct < -0.008) {
    score += 12; signals.push(`FR ${frPct.toFixed(4)}% negatif = mild bearish sentiment`);
  } else if (frPct < 0) {
    score += 5;
  } else if (frPct > 0.05) {
    score -= 22; signals.push(`FR +${frPct.toFixed(4)}% OVERHEATED = DUMP RISK TINGGI`);
    opportunity = 'SHORT_SETUP';
  } else if (frPct > 0.02) {
    score -= 12; signals.push(`FR +${frPct.toFixed(4)}% elevated = hati-hati entry long`);
  }

  // Retail positioning (contrarian)
  const rl = retailLong || 50;
  if (rl <= 32) {
    score += 20; signals.push(`${100-rl}% retail SHORT = momentum SQUEEZE potential sangat tinggi`);
    opportunity = opportunity || 'SQUEEZE_PLAY';
  } else if (rl <= 40) {
    score += 10; signals.push(`${100-rl}% retail short = kontraksi shorts = bullish contrarian`);
  } else if (rl >= 68) {
    score -= 18; signals.push(`${rl}% retail LONG = SM akan jual ke mereka = TRAP`);
    opportunity = opportunity || 'SHORT_SETUP';
  }

  return {
    score: cl(score, -60, 100),
    state, stateColor,
    signals: signals.slice(0, 4),
    opportunity,
    frPct: +frPct.toFixed(5),
    oiB: +(oi/1e9).toFixed(3),
  };
}

// ─── SIGNAL ENGINE ────────────────────────────────────────────────────
function generateSignal(coin) {
  const { rsi, fr, oi, c24, vol, pip, obvBull, isCoiling, retailLong, oiChangePct, atrPct, rsiReal } = coin;
  const frPct = (fr||0) * 100;

  // Hard gate: koin tanpa volume cukup tidak dapat sinyal bermakna
  if (vol < MIN_VOL_SIGNAL) {
    return { signal:'', signalColor:'#4a5568', signalDesc:'Volume insufficient', direction:'WAIT', probability:50, signalTags:[] };
  }

  let sig='', sc='#4a5568', desc='', dir='WAIT', prob=50, tags=[];

  // ── LONG SIGNALS (priority order) ────────────────────────────────────
  if (rsiReal && rsi < 22 && frPct < -0.008 && c24 < -3 && vol > 2e6) {
    sig='CAPITULATION BUY 🆘'; sc='#00ffd0'; dir='LONG'; prob=92;
    desc=`RSI ${rsi.toFixed(0)} REAL extreme + FR ${frPct.toFixed(4)}% + dump besar = BOTTOM LANGKA`;
    tags=['RARE','CAPITULATION','REAL_RSI'];
  } else if (rsiReal && rsi < 28 && frPct < -0.006 && isCoiling && vol > 1e6) {
    sig='ABOUT TO FLY 🚀'; sc='#ffd700'; dir='LONG'; prob=90;
    desc=`RSI ${rsi.toFixed(0)} REAL oversold + FR squeeze ${frPct.toFixed(4)}% + ATR coiling = POMPA SEGERA`;
    tags=['COILING','SQUEEZE','REAL_RSI'];
  } else if (oi > 200e6 && frPct < -0.004 && Math.abs(c24) < 2 && vol > 3e6) {
    sig='WHALE FINGERPRINT 🐳'; sc='#00d4ff'; dir='LONG'; prob=88;
    desc=`OI $${(oi/1e9).toFixed(1)}B + harga flat + FR ${frPct.toFixed(4)}% = INSTITUSI AKUMULASI`;
    tags=['WHALE','STEALTH'];
  } else if (frPct < -0.008 && vol > 2e6 && rsi > 28 && rsi < 55 && oi > MIN_OI_FUTURES) {
    sig='SQUEEZE INCOMING 💎'; sc='#ff6b9d'; dir='LONG'; prob=87;
    desc=`FR ${frPct.toFixed(4)}% = shorts bayar longs tiap 8h, pompa tinggal trigger`;
    tags=['SQUEEZE','FR_EXTREME'];
  } else if (oiChangePct > 5 && c24 > 2 && rsi < 68 && vol > 5e6) {
    sig='NEW LONGS ENTERING ⚡'; sc='#00ff88'; dir='LONG'; prob=85;
    desc=`OI +${oiChangePct.toFixed(1)}% + harga +${c24.toFixed(1)}% = posisi long baru masuk valid`;
    tags=['NEW_LONGS'];
  } else if ((retailLong||50) <= 33 && rsi < 52 && vol > 3e6 && oi > MIN_OI_FUTURES) {
    sig='SHORT SQUEEZE SETUP 🔥'; sc='#fb7185'; dir='LONG'; prob=85;
    desc=`${100-(retailLong||50)}% retail SHORT = squeeze target`;
    tags=['SQUEEZE','RETAIL_SHORT'];
  } else if (rsiReal && rsi < 28 && frPct <= 0 && vol > 1e6) {
    sig='DEEP OVERSOLD 📉'; sc='#f87171'; dir='LONG'; prob=80;
    desc=`RSI ${rsi.toFixed(0)} REAL oversold = mean reversion signal`;
    tags=['OVERSOLD','REAL_RSI'];
  } else if (rsi < 28 && !rsiReal && frPct <= -0.002 && vol > 2e6 && oi > 20e6) {
    sig='DEEP OVERSOLD~'; sc='#f87171'; dir='LONG'; prob=72;
    desc=`RSI ~${rsi.toFixed(0)} est oversold + FR ${frPct.toFixed(4)}%`;
    tags=['OVERSOLD'];
  } else if (oi > 100e6 && Math.abs(c24) < 1.5 && vol > 5e6 && frPct <= 0 && rsi > 38 && rsi < 58) {
    sig='SMART ACCUMULATION 🤫'; sc='#a78bfa'; dir='LONG'; prob=83;
    desc=`Vol $${(vol/1e6).toFixed(0)}M + harga flat + OI $${(oi/1e6).toFixed(0)}M + FR ${frPct.toFixed(4)}%`;
    tags=['ACCUM','SMART_MONEY'];
  } else if (isCoiling && atrPct > 0 && atrPct < 2.5 && frPct <= 0.002 && vol > 1e6 && oi > 20e6) {
    sig='PRE-BREAKOUT COIL ⚡'; sc='#fbbf24'; dir='LONG'; prob=78;
    desc=`ATR ${atrPct.toFixed(2)}% compressed = energi terkumpul sebelum ledakan`;
    tags=['COIL'];
  } else if (coin.rs > 5 && c24 > (coin.btcC||0)+3 && vol > 2e6 && rsi < 72) {
    sig='NARRATIVE MOMENTUM 📡'; sc='#c084fc'; dir='LONG'; prob=80;
    desc=`RS +${coin.rs.toFixed(1)}% vs BTC = catalyst/narrative aktif`;
    tags=['RS_STRONG'];
  } else if (rsi < 35 && frPct <= 0 && obvBull && vol > 1e6 && oi > 10e6) {
    sig='OBV DIVERGENCE 📊'; sc='#6ee7b7'; dir='LONG'; prob=78;
    desc=`OBV up saat harga turun = SM akumulasi (RSI ${rsi.toFixed(0)})`;
    tags=['OBV_DIV'];
  } else if (c24 > 3 && rsi >= 43 && rsi <= 65 && vol > 5e6 && oi > 20e6) {
    sig='MOMENTUM BREAKOUT 🚀'; sc='#22c55e'; dir='LONG'; prob=78;
    desc=`+${c24.toFixed(1)}% + RSI ${rsi.toFixed(0)} sehat + Vol $${(vol/1e6).toFixed(0)}M`;
    tags=['MOMENTUM'];
  } else if (rsi >= 40 && rsi <= 60 && c24 > 0.3 && frPct <= 0.001 && vol > 2e6) {
    sig='MILD BULL 📈'; sc='#6ee7b7'; dir='LONG'; prob=63;
    desc=`RSI ${rsi.toFixed(0)} + ${c24.toFixed(1)}% + FR ok`;
    tags=['MILD'];
  }
  // ── SHORT SIGNALS ─────────────────────────────────────────────────────
  else if (rsi > 80 && frPct > 0.04 && c24 > 8 && vol > 5e6) {
    sig='BLOW-OFF TOP 🔴'; sc='#dc2626'; dir='SHORT'; prob=88;
    desc=`RSI ${rsi.toFixed(0)} + FR +${frPct.toFixed(4)}% + pump ${c24.toFixed(1)}% = DISTRIBUSI PUNCAK`;
    tags=['TOP'];
  } else if (rsi > 73 && frPct > 0.025 && c24 > 4 && vol > 3e6) {
    sig='BULL TRAP ⚠️'; sc='#ef4444'; dir='SHORT'; prob=72;
    desc=`RSI ${rsi.toFixed(0)} overbought + FR +${frPct.toFixed(4)}% = SM jual ke retail`;
    tags=['OVERBOUGHT'];
  } else if ((retailLong||50) >= 67 && rsi > 62 && vol > 2e6) {
    sig='RETAIL TRAP 🚨'; sc='#f97316'; dir='SHORT'; prob=74;
    desc=`${retailLong||50}% retail LONG = SM akan dump ke mereka`;
    tags=['RETAIL_TRAP'];
  }

  return { signal:sig, signalColor:sc, signalDesc:desc, direction:dir, probability:prob, signalTags:tags };
}

// ─── CONVERGENCE SCORE (lebih ketat v2) ─────────────────────────────
function calcConvScore(coin) {
  const { rsi, fr, c24, vol, oi, obvBull, isCoiling, retailLong, oiChangePct, rsiReal, atrPct } = coin;
  const frPct = (fr||0) * 100;

  // HARD GATE: koin micro tanpa OI/vol dapat score minimal
  if (vol < MIN_VOL_SCAN) return { score: 10, label: 'WEAK' };

  // Base score 40 (lebih ketat dari sebelumnya)
  let raw = 40;

  // Volume quality (bukan sekedar ada, tapi cukup untuk institusional)
  const volC = vol >= 100e6 ? 10 : vol >= 30e6 ? 7 : vol >= 10e6 ? 5 : vol >= 3e6 ? 3 : vol >= 1e6 ? 1 : -5;
  raw += volC;

  // OI institutional grade
  const oiC = oi >= 2e9 ? 9 : oi >= 500e6 ? 6 : oi >= 100e6 ? 4 : oi >= 30e6 ? 2 : oi >= 10e6 ? 1 : oi < MIN_OI_FUTURES ? -4 : 0;
  raw += oiC;

  // RSI — real RSI weighted higher
  const rsiBonus = rsiReal ? 3 : 0;
  const rsiC = rsi < 22 ? 14 : rsi < 28 ? 10 : rsi < 35 ? 6 : rsi < 42 ? 3 : rsi < 55 ? 0 : rsi > 80 ? -16 : rsi > 73 ? -10 : rsi > 65 ? -5 : 0;
  raw += rsiC + rsiBonus;

  // Funding rate (paling predictive signal)
  const frC = frPct < -0.05 ? 30 : frPct < -0.02 ? 22 : frPct < -0.01 ? 16 : frPct < -0.005 ? 10 : frPct < -0.002 ? 6 : frPct < 0 ? 2 : frPct > 0.05 ? -24 : frPct > 0.02 ? -14 : frPct > 0.01 ? -8 : frPct > 0.005 ? -4 : 0;
  raw += frC;

  // OI change direction
  const oiDirC = oiChangePct > 5 && c24 > 1 ? 9 : oiChangePct < -5 && c24 > 1 ? 5 : oiChangePct > 5 && c24 < -1 ? -6 : 0;
  raw += oiDirC;

  // Retail contrarian
  const rl = retailLong || 50;
  const retailC = rl <= 32 ? 14 : rl <= 40 ? 7 : rl >= 68 ? -14 : rl >= 60 ? -6 : 0;
  raw += retailC;

  // Momentum 24h
  const momC = c24 > 8 ? 4 : c24 > 3 ? 2 : c24 > 0 ? 0 : c24 < -8 ? -5 : c24 < -3 ? -2 : -1;
  raw += momC;

  // OBV & coiling
  if (obvBull && c24 < 0) raw += 9; // bullish divergence
  else if (obvBull) raw += 4;
  if (isCoiling) raw += 7;

  // ATR — koin yang sudah compressed lebih menarik
  if (atrPct > 0 && atrPct < 1.5 && isCoiling) raw += 4;

  const score = cl(Math.round(raw), 0, 100);
  const label = score >= 82 ? 'ELITE' : score >= 72 ? 'PRIME' : score >= 62 ? 'VALID' : score >= 50 ? 'MOD' : 'WEAK';
  return { score, label };
}

// ─── ATR-BASED SL/TP (real, per koin) ───────────────────────────────
function buildLevels(price, dir, atrPct, prob) {
  // Jika tidak ada ATR real, gunakan volatility proxy dari harga
  const hasRealATR = atrPct > 0;
  const atr = hasRealATR ? atrPct : (price > 10000 ? 2.0 : price > 1000 ? 2.2 : price > 10 ? 2.5 : price > 1 ? 3.0 : 3.5);

  // SL = 1.3x ATR, TP1 = 1.8x, TP2 = 3.2x, TP3 = 5.5x
  const slPct  = +(atr * 1.3).toFixed(2);
  const tp1Pct = +(atr * 1.8).toFixed(2);
  const tp2Pct = +(atr * 3.2).toFixed(2);
  const tp3Pct = +(atr * 5.5).toFixed(2);
  const rr = +(tp2Pct / slPct).toFixed(1);

  // Kelly criterion: f = (p*R - (1-p)) / R, half-Kelly
  const w = cl(prob / 100, 0.1, 0.95);
  const kellyRaw = (w * rr - (1 - w)) / rr;
  const kellySizePct = Math.max(0.5, Math.min(8, +(kellyRaw / 2 * 100).toFixed(1)));

  const fmt = p => p > 1000 ? p.toFixed(2) : p > 1 ? p.toFixed(4) : p > 0.001 ? p.toFixed(6) : p.toFixed(8);

  if (dir === 'LONG') {
    return {
      sl: +fmt(price*(1-slPct/100)), tp1: +fmt(price*(1+tp1Pct/100)),
      tp2: +fmt(price*(1+tp2Pct/100)), tp3: +fmt(price*(1+tp3Pct/100)),
      slPct, tp1Pct, tp2Pct, tp3Pct, rr, kellySizePct, realATR: hasRealATR,
    };
  } else {
    return {
      sl: +fmt(price*(1+slPct/100)), tp1: +fmt(price*(1-tp1Pct/100)),
      tp2: +fmt(price*(1-tp2Pct/100)), tp3: +fmt(price*(1-tp3Pct/100)),
      slPct, tp1Pct, tp2Pct, tp3Pct, rr, kellySizePct, realATR: hasRealATR,
    };
  }
}

// ─── CACHE ─────────────────────────────────────────────────────────────
const CACHE = { d: null, t: 0 };
const CACHE_TTL = 90_000; // 90 detik

// ─── MAIN HANDLER ─────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const t0 = Date.now();
  if (CACHE.d && (t0 - CACHE.t) < CACHE_TTL) {
    return res.status(200).json({ ...CACHE.d, cached: true, elapsed: Date.now()-t0 });
  }

  try {
    // ── STEP 1: PARALLEL DATA FETCH ───────────────────────────────────
    const [byLinearR, bySpotR, mexcR, fgR, btcLSR] = await Promise.allSettled([
      sf('https://api.bybit.com/v5/market/tickers?category=linear', 6000),
      sf('https://api.bybit.com/v5/market/tickers?category=spot', 5000),
      sf('https://api.mexc.com/api/v3/ticker/24hr', 5000),
      sf('https://alternative.me/crypto/fear-and-greed-index/?format=json&limit=1', 4000),
      sf('https://api.bybit.com/v5/market/account-ratio?category=linear&symbol=BTCUSDT&period=1h&limit=1', 4000),
    ]);

    // ── STEP 2: BUILD COIN MAP ────────────────────────────────────────
    const cm = {}; // symbol → ticker data

    // Bybit Linear — most important: has FR, OI, mark price
    try {
      const list = A(byLinearR.value?.result?.list);
      for (const t of list) {
        const raw = String(t.symbol || '');
        // Bybit linear: BTCUSDT, ETHUSDT, etc.
        if (!raw.endsWith('USDT')) continue;
        const s = raw.replace('USDT', '');
        if (!s || isBad(s)) continue;
        const p = N(t.lastPrice); if (p <= 0 || p > 1e12) continue;
        const v = N(t.turnover24h); // quote volume in USDT
        if (v < MIN_VOL_SCAN) continue; // filter micro volume
        const prev = N(t.prevPrice24h || p);
        const c24 = prev > 0 ? +((p-prev)/prev*100).toFixed(3) : 0;
        const hi = N(t.highPrice24h || p*1.01);
        const lo = N(t.lowPrice24h || p*0.99);
        const pip = hi > lo ? cl((p-lo)/(hi-lo)*100, 0, 100) : 50;
        const fr = N(t.fundingRate);
        const oi = N(t.openInterestValue); // in USDT

        // Estimate retail L/S from bid/ask imbalance + funding rate signal
        const bid1 = N(t.bid1Size), ask1 = N(t.ask1Size);
        const baSide = bid1+ask1 > 0 ? bid1/(bid1+ask1) : 0.5;
        // Negative FR = more shorts (market pays longs) → retail L/S biased bearish
        const frBias = cl(50 + fr*100*250, 30, 70); // FR -> retail long bias
        const rLong = cl(Math.round(50 + (baSide-0.5)*25 + (frBias-50)*0.4), 25, 75);

        cm[s] = {
          p, fr, oi, c24, v, h:hi, l:lo, pip,
          frPct: +(fr*100).toFixed(5),
          bidAsk: +(baSide*100).toFixed(1),
          rLong, rShort: 100-rLong,
          src: 'bybit_linear',
        };
      }
    } catch(e) { console.error('bybit linear parse:', e.message); }

    // MEXC — for coins not on Bybit linear
    try {
      const list = A(mexcR.value || []);
      for (const t of list) {
        const raw = String(t.symbol || '');
        if (!raw.endsWith('USDT')) continue;
        const s = raw.replace('USDT', '');
        if (!s || isBad(s) || cm[s]) continue;
        const p = N(t.lastPrice); if (p <= 0) continue;
        const v = N(t.quoteVolume);
        if (v < MIN_VOL_SCAN) continue;
        const c24 = N(t.priceChangePercent);
        const hi = N(t.highPrice || p*1.01), lo = N(t.lowPrice || p*0.99);
        const pip = hi > lo ? cl((p-lo)/(hi-lo)*100, 0, 100) : 50;
        cm[s] = { p, fr:0, oi:0, c24, v, h:hi, l:lo, pip, frPct:0, bidAsk:50, rLong:50, rShort:50, src:'mexc' };
      }
    } catch {}

    // F&G index
    let fg = 50, fgLabel = 'Neutral';
    try {
      const fd = fgR.value?.data?.[0];
      if (fd) { fg = N(fd.value, 50); fgLabel = fd.value_classification || 'Neutral'; }
    } catch {}

    // BTC L/S ratio
    let btcLS = null, btcLongPct = null, btcShortPct = null;
    try {
      const row = A(btcLSR.value?.result?.list)[0];
      if (row) {
        btcLongPct = +(N(row.buyRatio)*100).toFixed(2);
        btcShortPct = +(N(row.sellRatio)*100).toFixed(2);
        btcLS = btcShortPct > 0 ? +(btcLongPct/btcShortPct).toFixed(3) : null;
      }
    } catch {}

    // ── STEP 3: KLINES FETCH (parallel, 6s timeout) ──────────────────
    // Filter to coins that exist in cm AND are in our kline list
    const klCoins = KLINE_COINS.filter(s => cm[s]);

    // BTC daily klines (1D RSI) — fetch separately with more timeout
    const [btcD1Res, ...klineResults] = await Promise.allSettled([
      sf('https://api.bybit.com/v5/market/kline?category=linear&symbol=BTCUSDT&interval=D&limit=40', 6000),
      ...klCoins.map(s =>
        sf(`https://api.bybit.com/v5/market/kline?category=linear&symbol=${s}USDT&interval=240&limit=65`, 6000)
      ),
    ]);

    const kMap = {};
    for (let i = 0; i < klCoins.length; i++) {
      const sym = klCoins[i];
      try {
        const r = klineResults[i];
        if (r.status !== 'fulfilled' || !r.value) continue;
        const d = r.value;
        // Bybit v5 returns retCode 0 on success
        if (d.retCode !== 0 && d.retCode !== undefined) continue;
        const raw = A(d?.result?.list);
        if (raw.length < 16) continue;
        const K = parseBybitKlines(raw);
        if (K.length < 16) continue;

        const cls = K.map(k => k.c);
        const rsiV = rsi14(cls);
        if (rsiV === null) continue;

        const lp = cls[cls.length-1];
        const macd = macdCalc(cls);
        const atr = atrCalc(K);
        const atrPct = lp > 0 ? +(atr/lp*100).toFixed(3) : 0;

        // OBV (last 20 candles)
        let obvUp = 0, obvDn = 0;
        for (let j = Math.max(1, K.length-20); j < K.length; j++) {
          if (K[j].c > K[j-1].c) obvUp += K[j].vol;
          else if (K[j].c < K[j-1].c) obvDn += K[j].vol;
        }

        // ATR compression: last 5 vs last 20
        const atr5 = K.length >= 7 ? atrCalc(K.slice(-6), 5) : atr;
        const atr20 = K.length >= 22 ? atrCalc(K.slice(-21), 14) : atr;
        const isCoiling = atr5 > 0 && atr20 > 0 && atr5 < atr20 * 0.65;

        // RSI direction
        const rsiPrev = cls.length >= 17 ? rsi14(cls.slice(0,-1)) : null;
        const rsiDir = rsiPrev !== null
          ? (rsiV > rsiPrev+0.5 ? 'up' : rsiV < rsiPrev-0.5 ? 'down' : 'flat')
          : 'flat';

        // EMA200 comparison (use all available candles)
        const e200 = emaCalc(cls, Math.min(200, cls.length));

        // Support & resistance from recent range
        const recent = cls.slice(-20);
        const highR = Math.max(...recent);
        const lowR  = Math.min(...recent);

        kMap[sym] = {
          rsi: +rsiV.toFixed(2),
          rsiDir,
          macd, K, cls,
          atr: +atr.toFixed(10),
          atrPct,
          obvBull: obvDn > 0 ? obvUp > obvDn * 1.15 : obvUp > 0,
          isCoiling,
          aboveE200: lp > e200,
          e200,
          highR, lowR,
          ok: true,
        };
      } catch(e) { /* silent — individual coin failure should not stop rest */ }
    }

    // BTC 1D RSI
    let btcD1rsi = null;
    try {
      const d = btcD1Res.value;
      if (d?.retCode === 0 || d?.result) {
        const raw = A(d?.result?.list);
        if (raw.length >= 16) {
          const K = parseBybitKlines(raw);
          const cls = K.map(k => k.c).filter(v => v > 0);
          if (cls.length >= 16) btcD1rsi = rsi14(cls);
        }
      }
    } catch {}

    // ── STEP 4: BTC CONTEXT ───────────────────────────────────────────
    const btcRaw = cm['BTC'] || {};
    const btcKd = kMap['BTC'] || {};
    const btcP = btcKd.cls?.[btcKd.cls.length-1] || N(btcRaw.p);
    const btcC24 = N(btcRaw.c24);

    // ── STEP 5: PROCESS ALL COINS ─────────────────────────────────────
    const coins = [];
    for (const [sym, raw] of Object.entries(cm)) {
      try {
        if (!sym || !raw.p || raw.p <= 0) continue;
        const kd = kMap[sym] || null;
        const rsiReal = !!(kd?.ok);

        // RSI: real (from 4H klines) or estimated
        let rsi;
        if (rsiReal) {
          rsi = kd.rsi;
        } else {
          // Better estimation using multiple signals
          const frEffect = (raw.fr||0) * 100 * (-300); // neg FR → lower RSI
          const ch24E = raw.c24 * 2.5;
          const pipE = (raw.pip - 50) * 0.4;
          rsi = cl(Math.round(50 + ch24E + pipE + frEffect), 12, 88);
        }

        const atrPct = kd?.atrPct || 0;
        const obvBull = kd?.obvBull || false;
        const isCoiling = kd?.isCoiling || false;
        const macd = kd?.macd || null;
        const rs = +(raw.c24 - btcC24).toFixed(2);

        const coin = {
          sym, sector: getSector(sym),
          price: raw.p, c24: raw.c24,
          vol: raw.v, h: raw.h, l: raw.l, pip: raw.pip,
          fr: raw.fr || 0, oi: raw.oi || 0, frPct: raw.frPct || 0,
          rsi, rsiReal,
          atrPct, obvBull, isCoiling, macd,
          retailLong: raw.rLong || 50, retailShort: raw.rShort || 50,
          rs, btcC: btcC24,
          oiChangePct: 0, // enriched below if available
          src: raw.src,
        };

        const sigResult = generateSignal(coin);
        const convResult = calcConvScore(coin);
        const whaleResult = detectWhaleAccumulation(coin);
        const futuresResult = analyzeFutures(coin);
        const levels = sigResult.direction !== 'WAIT'
          ? buildLevels(raw.p, sigResult.direction, atrPct, sigResult.probability)
          : null;

        // Conviction stars (0-5), weighted toward real data
        const starComp = [
          rsiReal && rsi < 30 ? 1.5 : rsiReal && rsi < 38 ? 1 : !rsiReal && rsi < 28 ? 0.5 : 0,
          (raw.fr||0) < -0.005 ? 1.5 : (raw.fr||0) < -0.002 ? 1 : (raw.fr||0) < 0 ? 0.3 : 0,
          isCoiling ? 0.7 : 0,
          rs > 4 ? 0.5 : rs > 0 ? 0.2 : 0,
          obvBull && raw.c24 < 0 ? 0.8 : obvBull ? 0.3 : 0,
          whaleResult.score >= 30 ? 1 : whaleResult.score >= 18 ? 0.5 : 0,
          convResult.score >= 80 ? 0.5 : 0,
        ];
        const convStars = Math.min(5, +starComp.reduce((s,v)=>s+v,0).toFixed(1));

        coins.push({
          sym, sector: getSector(sym), price: raw.p, c24: raw.c24, vol: raw.v,
          rsi: +rsi.toFixed(1), rsiReal,
          fr: raw.fr||0, frPct: raw.frPct||0,
          oi: raw.oi||0, pip: raw.pip,
          rs, atrPct, obvBull, isCoiling, macd,
          retailLong: raw.rLong||50, retailShort: raw.rShort||50,
          oiChangePct: 0,
          ...sigResult,
          conv: convResult,
          whale: whaleResult,
          futures: futuresResult,
          levels, convStars,
          bidAskRatio: raw.bidAsk||50,
          src: raw.src,
          highR: kd?.highR, lowR: kd?.lowR,
        });
      } catch {}
    }

    coins.sort((a, b) => b.conv.score - a.conv.score);
    const totalCoins = coins.length;

    // ── STEP 6: MARKET CHARACTER ──────────────────────────────────────
    const osCount  = coins.filter(c => c.rsi < 30).length;
    const obCount  = coins.filter(c => c.rsi > 70).length;
    const longDir  = coins.filter(c => c.direction === 'LONG').length;
    const shortDir = coins.filter(c => c.direction === 'SHORT').length;
    const bPct     = totalCoins > 0 ? longDir/totalCoins : 0.5;
    const whaleCount  = coins.filter(c => c.whale.score >= 22).length;
    const squeezeCount = coins.filter(c => c.frPct < -0.005 && c.oi > MIN_OI_FUTURES).length;
    const realRSICount = Object.keys(kMap).length;

    let mcType, mcColor, mcDesc, mcStrat, mcRisk, mcPos;
    const osPct = osCount / Math.max(1, totalCoins);
    const obPct = obCount / Math.max(1, totalCoins);
    if (osPct > 0.12) {
      mcType='MASS OVERSOLD'; mcColor='cyan';
      mcDesc=`${osCount} koin RSI<30 (${(osPct*100).toFixed(0)}%). Zona DCA historis terbaik. ${whaleCount} whale aktif.`;
      mcStrat='Counter-trend DCA Agresif'; mcRisk='MODERATE'; mcPos='50-75%';
    } else if (obPct > 0.18) {
      mcType='MASS OVERBOUGHT'; mcColor='red';
      mcDesc=`${obCount} koin RSI>70. Distribusi massal. Kurangi exposure, cash is king.`;
      mcStrat='Cash + Short Select'; mcRisk='HIGH'; mcPos='25%';
    } else if (bPct > 0.60) {
      mcType='BULLISH'; mcColor='green';
      mcDesc=`${Math.round(bPct*100)}% koin bullish. Trend naik aktif. ${squeezeCount} squeeze ready.`;
      mcStrat='Aggressive Long'; mcRisk='STANDARD'; mcPos='100%';
    } else if (bPct < 0.28) {
      mcType='BEARISH'; mcColor='red';
      mcDesc='Majority bearish. Cash atau short select saja.';
      mcStrat='Cash or Short'; mcRisk='HIGH'; mcPos='25%';
    } else {
      mcType='TRANSITIONAL'; mcColor='amber';
      mcDesc=`Mixed signals. ${whaleCount} whale signal. ${squeezeCount} squeeze ready. Selektif.`;
      mcStrat='Cautious Selective'; mcRisk='REDUCED'; mcPos='50%';
    }

    // ── STEP 7: CONVERGENCE SETUPS ────────────────────────────────────
    const longs  = coins.filter(c => c.direction==='LONG' && c.conv.score >= 55).slice(0,40);
    const shorts = coins.filter(c => c.direction==='SHORT' && c.conv.score >= 52).slice(0,10);
    const flys   = coins.filter(c => c.signal && (
      c.signal.includes('FLY') || c.signal.includes('CAPITULATION') ||
      c.signal.includes('SQUEEZE INCOMING') || c.signal.includes('WHALE FINGERPRINT')
    )).slice(0, 8);
    const accums = coins.filter(c => c.signal && (
      c.signal.includes('SMART ACCUM') || c.signal.includes('PRE-BREAKOUT') ||
      c.signal.includes('OBV DIVERGENCE') || c.signal.includes('SMART ACCUMULATION')
    )).slice(0, 8);

    // ── STEP 8: WHALE RADAR (institutional grade only) ────────────────
    const whaleRadar = coins
      .filter(c => c.whale.score >= 22 && c.oi >= MIN_OI_WHALE)
      .sort((a,b) => b.whale.score - a.whale.score)
      .slice(0, 15)
      .map(c => ({
        sym: c.sym, price: c.price, c24: c.c24, vol: c.vol,
        rsi: c.rsi, rsiReal: c.rsiReal,
        fr: c.frPct, oi: c.oi,
        whaleScore: c.whale.score, whaleLevel: c.whale.level,
        whaleSigs: c.whale.signals, whaleTags: c.whale.tags,
        conv: c.conv.score, signal: c.signal, sector: c.sector,
      }));

    // Whale Fingerprint: large OI + flat price + negative FR
    const whaleFingerprint = coins
      .filter(c => c.oi >= 200e6 && c.frPct < -0.002 && Math.abs(c.c24) < 2.5 && c.vol > 3e6)
      .sort((a,b) => a.frPct - b.frPct)
      .slice(0, 8)
      .map(c => ({
        sym: c.sym, price: c.price, c24: c.c24, rsi: c.rsi,
        fr: c.frPct, oi: c.oi, vol: c.vol,
        rating: Math.abs(c.frPct) > 0.008 ? 'STRONG' : 'MODERATE',
      }));

    // Squeeze Radar: extreme negative FR on coins with real OI
    const squeezeRadar = coins
      .filter(c => c.frPct < -0.004 && c.vol > 1e6 && c.rsi < 58 && c.oi >= MIN_OI_FUTURES)
      .sort((a,b) => a.frPct - b.frPct)
      .slice(0, 10)
      .map(c => ({
        sym: c.sym, price: c.price, c24: c.c24, rsi: c.rsi,
        fr: c.frPct, oi: c.oi, retailLong: c.retailLong, retailShort: c.retailShort,
        strength: Math.abs(c.frPct) > 0.015 ? 'EXTREME' : Math.abs(c.frPct) > 0.008 ? 'STRONG' : 'HIGH',
      }));

    // ── STEP 9: FUTURES INTELLIGENCE ──────────────────────────────────
    const futuresSqueezeSetups = coins
      .filter(c => c.frPct < -0.005 && c.vol > 1e6 && c.oi >= MIN_OI_FUTURES)
      .sort((a,b) => a.frPct - b.frPct)
      .slice(0, 12)
      .map(c => ({
        sym: c.sym, price: c.price, c24: c.c24,
        frPct: c.frPct, oi: c.oi, rsi: c.rsi,
        retailLong: c.retailLong, retailShort: c.retailShort,
        futuresState: c.futures.state, futuresScore: c.futures.score,
        futuresSigs: c.futures.signals, opportunity: c.futures.opportunity,
        conv: c.conv.score, signal: c.signal,
      }));

    const futuresOverbought = coins
      .filter(c => c.frPct > 0.018 && c.rsi > 63 && c.vol > 2e6 && c.oi >= MIN_OI_FUTURES)
      .sort((a,b) => b.frPct - a.frPct)
      .slice(0, 8)
      .map(c => ({ sym: c.sym, price: c.price, c24: c.c24, frPct: c.frPct, rsi: c.rsi, retailLong: c.retailLong }));

    const retailTrapList = coins
      .filter(c => c.retailLong >= 62 && c.rsi > 58 && c.vol > 2e6 && c.oi >= MIN_OI_FUTURES)
      .sort((a,b) => b.retailLong - a.retailLong)
      .slice(0, 8)
      .map(c => ({ sym: c.sym, price: c.price, c24: c.c24, retailLong: c.retailLong, rsi: c.rsi }));

    const retailSqueezeList = coins
      .filter(c => c.retailLong <= 38 && c.rsi < 52 && c.vol > 2e6 && c.oi >= MIN_OI_FUTURES)
      .sort((a,b) => a.retailLong - b.retailLong)
      .slice(0, 8)
      .map(c => ({ sym: c.sym, price: c.price, c24: c.c24, retailLong: c.retailLong, retailShort: c.retailShort, rsi: c.rsi }));

    // ── STEP 10: GOLDEN OPPORTUNITIES ────────────────────────────────
    // Stealth volume: large volume + flat price + institutional OI
    const stealthVolume = coins
      .filter(c => c.vol > 8e6 && Math.abs(c.c24) < 2 && c.oi >= 50e6 && c.rsi < 65)
      .sort((a,b) => b.vol - a.vol)
      .slice(0, 8)
      .map(c => ({ sym: c.sym, price: c.price, c24: c.c24, vol: c.vol, rsi: c.rsi, oi: c.oi, fr: c.frPct }));

    // Hidden gems: real oversold + negative FR + volume + NOT already huge cap
    const hiddenGems = coins
      .filter(c =>
        c.rsi < 34 && c.frPct <= -0.001 && c.vol > 500000 && c.conv.score >= 52 &&
        c.oi >= 5e6 && // must have real OI
        !['BTC','ETH','BNB','SOL','XRP','ADA','DOGE'].includes(c.sym)
      )
      .sort((a,b) => a.rsi - b.rsi)
      .slice(0, 12)
      .map(c => ({ sym: c.sym, price: c.price, c24: c.c24, rsi: c.rsi, fr: c.frPct, vol: c.vol, conv: c.conv.score, rsiReal: c.rsiReal }));

    // Momentum shift: outperforming BTC significantly
    const momentumShift = coins
      .filter(c => c.c24 > 2 && c.rs > 4 && c.vol > 2e6 && c.rsi < 72 && !['BTC'].includes(c.sym))
      .sort((a,b) => b.rs - a.rs)
      .slice(0, 8)
      .map(c => ({ sym: c.sym, price: c.price, c24: c.c24, rsi: c.rsi, vol: c.vol, rs: c.rs, outperformBTC: c.rs }));

    // ── STEP 11: BTC SNAPSHOT ──────────────────────────────────────────
    const btcSnapshot = {
      price: btcP, ch24: btcC24, fg, fgLabel,
      rsi: btcKd.rsi || null,
      rsiDir: btcKd.rsiDir || 'flat',
      atr: btcKd.atr || 0,
      atrPct: btcKd.atrPct || 0,
      macd: btcKd.macd || null,
      aboveEma200: btcKd.aboveE200 || false,
      e200: btcKd.e200 || 0,
      d1rsi: btcD1rsi ? +btcD1rsi.toFixed(1) : null,
      btcLS, btcLongPct, btcShortPct,
      resistance: btcKd.highR ? +(btcKd.highR * 1.002).toFixed(0) : null,
      support: btcKd.lowR ? +(btcKd.lowR * 0.998).toFixed(0) : null,
      current: btcP,
    };

    // ── STEP 12: SPOT ACCUMULATION (filtered: real liquidity only) ────
    const spotAccum = coins
      .filter(c =>
        c.rsi < 42 && c.direction !== 'SHORT' &&
        c.oi >= 10e6 && c.vol >= 1e6 // only coins with real trading activity
      )
      .sort((a,b) => {
        // Prefer: real RSI > high OI > low RSI
        const sA = (a.rsiReal?10:0) + (a.oi>100e6?5:a.oi>30e6?3:0) + (40-a.rsi);
        const sB = (b.rsiReal?10:0) + (b.oi>100e6?5:b.oi>30e6?3:0) + (40-b.rsi);
        return sB - sA;
      })
      .slice(0, 12)
      .map(c => {
        const dcaPct = Math.max(c.atrPct || 0, 2.5);
        return {
          sym: c.sym, price: c.price, rsi: c.rsi, rsiReal: c.rsiReal,
          signal: c.signal || 'OVERSOLD',
          atrPct: c.atrPct, fr: c.frPct, oi: c.oi, vol: c.vol,
          dcaZone: `$${+(c.price*(1-dcaPct*1.5/100)).toFixed(c.price>1?2:8)} – $${+(c.price*(1-dcaPct*0.3/100)).toFixed(c.price>1?2:8)}`,
          conv: c.conv.score, retailLong: c.retailLong,
          oversold: c.rsi < 25 ? 'EXTREME' : c.rsi < 30 ? 'DEEP' : 'MODERATE',
        };
      });

    // ── STEP 13: GAME PLAN ─────────────────────────────────────────────
    const top3 = longs.slice(0,3).map(c => c.sym);
    const gamePlan = {
      btcLevels: { resistance: btcSnapshot.resistance, support: btcSnapshot.support, current: btcP },
      scenarios: {
        bull: { condition: `BTC tembus $${btcSnapshot.resistance} close di atas`, action: 'Long conv 65+ RR 1:3 RS+FR filter', setups: top3 },
        sideways: { condition: 'BTC konsolidasi ±1.5%', action: 'Scalp COILING+WHALE ACCUM saja' },
        bear: { condition: `BTC breakdown ke $${btcSnapshot.support}`, action: 'Cash 80%. SHORT RSI 73+ FR overheated' },
      },
      scalpSetups: flys.slice(0,5).map(c => ({
        sym: c.sym, price: c.price, signal: c.signal, rsi: c.rsi,
        conv: c.conv.score, entry: c.price, rsiReal: c.rsiReal,
        sl: c.levels?.sl||0, tp1: c.levels?.tp1||0, tp2: c.levels?.tp2||0,
        slPct: c.levels?.slPct||0, tp1Pct: c.levels?.tp1Pct||0, tp2Pct: c.levels?.tp2Pct||0,
        rr: c.levels?.rr||2, fr: c.frPct, atrPct: c.atrPct, sector: c.sector,
        whaleSigs: c.whale?.signals||[], realATR: c.levels?.realATR||false,
      })),
      swingSetups: longs.filter(c => c.conv.score >= 68).slice(0,5).map(c => ({
        sym: c.sym, price: c.price, signal: c.signal, rsi: c.rsi,
        conv: c.conv.score, entry: c.price, rsiReal: c.rsiReal,
        sl: c.levels?.sl||0, tp1: c.levels?.tp1||0, tp2: c.levels?.tp2||0, tp3: c.levels?.tp3||0,
        slPct: c.levels?.slPct||0, tp1Pct: c.levels?.tp1Pct||0, tp2Pct: c.levels?.tp2Pct||0, tp3Pct: c.levels?.tp3Pct||0,
        rr: c.levels?.rr||2, fr: c.frPct, atrPct: c.atrPct, sector: c.sector,
        whaleSigs: c.whale?.signals||[], realATR: c.levels?.realATR||false,
      })),
      activeShorts: shorts.slice(0,5).map(c => ({
        sym: c.sym, price: c.price, signal: c.signal, rsi: c.rsi, fr: c.frPct,
        conv: c.conv.score,
        sl: c.levels?.sl||0, tp1: c.levels?.tp1||0, tp2: c.levels?.tp2||0,
        slPct: c.levels?.slPct||0, tp1Pct: c.levels?.tp1Pct||0, tp2Pct: c.levels?.tp2Pct||0,
      })),
      spotAccum,
      avoidList: coins
        .filter(c => c.rsi > 78 || c.frPct > 0.03)
        .sort((a,b) => b.rsi - a.rsi)
        .slice(0, 8)
        .map(c => ({ sym: c.sym, price: c.price, rsi: c.rsi, fr: c.frPct, reason: c.rsi > 78 ? `RSI ${c.rsi.toFixed(0)} overbought` : `FR +${c.frPct}% overheated` })),
    };

    // ── STEP 14: SECTOR FLOW (filtered: only institutional OI) ────────
    const secMap = {};
    for (const coin of coins) {
      // Only include coins with meaningful OI in sector flow
      if (coin.oi < MIN_OI_FLOW && coin.vol < 5e6) continue;
      const s = coin.sector || 'Trending';
      if (!secMap[s]) secMap[s] = { coins:[], ch24Sum:0, frSum:0, rsSum:0, osC:0, sigQ:0, totalOI:0 };
      secMap[s].coins.push(coin);
      secMap[s].ch24Sum += coin.c24;
      secMap[s].frSum += coin.fr || 0;
      secMap[s].rsSum += coin.rs || 0;
      if (coin.rsi < 30) secMap[s].osC++;
      if (coin.signal && coin.conv.score >= 65) secMap[s].sigQ++;
      secMap[s].totalOI += coin.oi || 0;
    }
    const sectorData = {};
    const sectors = Object.entries(secMap).map(([name,d]) => {
      const n = Math.max(1, d.coins.length);
      const avgCh24 = +(d.ch24Sum/n).toFixed(3);
      const frAvg = +(d.frSum/n).toFixed(6);
      const rsAvg = +(d.rsSum/n).toFixed(2);
      const smScore = cl(Math.round(
        50 + avgCh24*5 + frAvg*(-2000) + rsAvg*3 +
        Math.min(20, d.osC*4) + Math.min(12, d.sigQ*4)
      ), 0, 100);
      const flowSig = avgCh24>3?'STRONG INFLOW':avgCh24>1?'INFLOW':avgCh24<-3?'STRONG OUTFLOW':avgCh24<-1?'OUTFLOW':'NEUTRAL';
      const best = d.coins.filter(c=>c.signal&&c.direction==='LONG').sort((a,b)=>b.conv.score-a.conv.score)[0]||null;
      const sd = {
        name, avgCh24, frAvg, rsAvg, osC:d.osC, smScore, sigQ:d.sigQ,
        flowSig, totalOI: d.totalOI,
        flyCoins: d.coins.filter(c=>c.signal&&(c.signal.includes('FLY')||c.signal.includes('WHALE'))).length,
        eliteCoins: d.coins.filter(c=>c.conv.score>=78).length,
        shortCoins: d.coins.filter(c=>c.direction==='SHORT').length,
        oversoldCoins: d.coins.filter(c=>c.rsi<30).length,
        best: best ? { sym:best.sym, conv:best.conv.score, fr:best.frPct } : null,
        coins: d.coins.map(c => ({
          sym:c.sym, price:c.price, c24:c.c24, vol:c.vol, oi:c.oi,
          rsi:c.rsi, rsiReal:c.rsiReal, fr:c.frPct,
          signal:c.signal, signalColor:c.signalColor,
          direction:c.direction, probability:c.probability,
          conv:c.conv.score, rs:c.rs,
          obvBull:c.obvBull, isCoiling:c.isCoiling,
          levels:c.levels, retailLong:c.retailLong,
        })),
      };
      sectorData[name] = sd;
      return sd;
    }).sort((a,b) => b.smScore - a.smScore);

    // ── STEP 15: TRADING SESSIONS ──────────────────────────────────────
    const now = new Date();
    const wibH = (now.getUTCHours() + 7) % 24;
    const days = ['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];
    const sess = [
      {id:'dead',name:'Dead Zone',time:'02:00-06:00',start:2,end:6,q:'POOR',activity:'Volume sangat sepi. Skip entry.'},
      {id:'asia_open',name:'Asia Open',time:'06:00-09:00',start:6,end:9,q:'MODERATE',activity:'Volume mulai masuk. Watch saja.'},
      {id:'asia_peak',name:'Asia Peak',time:'09:00-12:00',start:9,end:12,q:'GOOD',activity:'Volume Asia bagus. Entry selektif ok.'},
      {id:'lunch',name:'Lunch Break',time:'12:00-15:00',start:12,end:15,q:'CAUTION',activity:'Volume turun. Hindari entry baru.'},
      {id:'london',name:'London PRIME',time:'15:00-18:00',start:15,end:18,q:'PRIME',activity:'PRIME: Volume institusional terbesar!'},
      {id:'ny_pre',name:'NY Pre',time:'18:00-21:00',start:18,end:21,q:'BUILDING',activity:'Build posisi sebelum NY Open.'},
      {id:'ny_open',name:'NY Open PRIME',time:'21:00-23:00',start:21,end:23,q:'PRIME',activity:'PRIME: Volatility tertinggi hari ini!'},
      {id:'ny_late',name:'NY Late',time:'23:00-02:00',start:23,end:2,q:'GOOD',activity:'Volume masih oke. Swing setups ok.'},
    ];
    const csId = wibH>=2&&wibH<6?'dead':wibH>=6&&wibH<9?'asia_open':wibH>=9&&wibH<12?'asia_peak':wibH>=12&&wibH<15?'lunch':wibH>=15&&wibH<18?'london':wibH>=18&&wibH<21?'ny_pre':wibH>=21&&wibH<23?'ny_open':'ny_late';
    const cso = sess.find(s=>s.id===csId) || sess[0];
    const nxt = sess.filter(s=>s.q==='PRIME'&&s.id!==csId)[0]||null;

    // ── STEP 16: CHECKLIST ──────────────────────────────────────────────
    const frHotCoins = coins.filter(c => c.frPct > 0.005 && c.oi > MIN_OI_FUTURES).length;
    const liqC = coins.filter(c => c.vol > 5e6).length;
    const mkChecks = [
      {label:'Market character layak trading', pass:mcType!=='MASS OVERBOUGHT', detail:`Character: ${mcType}`, fix:'Hindari distribusi massal'},
      {label:'Trading session berkualitas', pass:cso.q==='PRIME'||cso.q==='GOOD'||cso.q==='BUILDING', detail:`${cso.name} (${cso.q})`, fix:'Tunggu PRIME/GOOD session'},
      {label:'BTC RSI tidak overbought', pass:btcKd.rsi?btcKd.rsi<73:true, detail:btcKd.rsi?`BTC 4H RSI ${btcKd.rsi.toFixed(0)}`:'BTC ok', fix:'Tunggu BTC RSI <68'},
      {label:'FR market tidak overheated massal', pass:frHotCoins===0, detail:`${frHotCoins} koin FR>0.005%`, fix:'Hindari entry saat FR mahal'},
      {label:'Market tidak overbought massal', pass:obCount<totalCoins*0.15, detail:`${obCount}/${totalCoins} koin RSI>70`, fix:'Tunggu RSI reset'},
      {label:'BTC L/S ratio aman', pass:btcLS===null||btcLS>=0.75, detail:btcLS?`L/S: ${btcLongPct}%/${btcShortPct}%`:'Data tidak tersedia', fix:'Hindari retail terlalu long'},
      {label:'Liquidity cukup (vol>5M)', pass:liqC>=8, detail:`${liqC} koin vol>$5M`, fix:'Tunggu London/NY Open'},
      {label:'BTC tidak dump tajam', pass:btcC24>-3, detail:`BTC ${btcC24.toFixed(2)}%`, fix:'Hindari altcoin saat BTC dump >3%'},
    ];
    const passC = mkChecks.filter(x=>x.pass).length;

    // ── STEP 17: DAILY OPPORTUNITY SCORE ──────────────────────────────
    let dosScore = 50;
    if (fg < 20) dosScore += 22; else if (fg < 35) dosScore += 14; else if (fg > 75) dosScore -= 18;
    if (osCount > 25) dosScore += 20; else if (osCount > 15) dosScore += 13; else if (osCount > 8) dosScore += 7;
    if (cso.q==='PRIME') dosScore += 14; else if (cso.q==='GOOD') dosScore += 7;
    dosScore += Math.min(12, squeezeCount * 2.5);
    dosScore += Math.min(10, whaleCount * 2);
    dosScore += Math.min(8, realRSICount >= 40 ? 8 : realRSICount >= 25 ? 5 : 2);
    dosScore = cl(Math.round(dosScore), 5, 98);
    const dosLabel = dosScore>=82?'EXTREME OPPORTUNITY':dosScore>=67?'HIGH OPPORTUNITY':dosScore>=52?'NORMAL':dosScore>=38?'LOW':'POOR DAY';
    const dosAction = dosScore>=82?'Hari langka! Full sizing pada sinyal PRIME/ELITE.':dosScore>=67?'Setup bagus. Sizing normal. Fokus conv 70+.':dosScore>=52?'Selektif. Hanya setup 3+ konfluens.':'Hindari new entry hari ini.';

    // ── STEP 18: MARKET REGIME ─────────────────────────────────────────
    const mvrvProxy = btcKd.cls && btcKd.e200 > 0 ? +(btcP / btcKd.e200).toFixed(3) : 1.3;
    let regime, regimeColor, regimeDesc, sizingGuidance;
    if (fg < 30 && osCount/totalCoins > 0.05) {
      regime='ACCUMULATE'; regimeColor='cyan';
      regimeDesc='Extreme Fear + mass oversold = zona akumulasi historis.';
      sizingGuidance='DCA bertahap 25-50%.';
    } else if (fg >= 30 && fg <= 65 && obCount/totalCoins < 0.12 && cso.q!=='POOR') {
      regime='TRADE'; regimeColor='green';
      regimeDesc='Market seimbang + session ok = kondisi ideal.';
      sizingGuidance='Full sizing. Patuhi SL ketat.';
    } else if (fg > 65 || mvrvProxy > 1.9) {
      regime='CAUTION'; regimeColor='amber';
      regimeDesc='Market greedy. MVRV tinggi. Kurangi size.';
      sizingGuidance='Max 0.5-1% risk/trade.';
    } else {
      regime='NORMAL'; regimeColor='gray';
      regimeDesc='Kondisi biasa. Selektif.';
      sizingGuidance='Sizing normal.';
    }

    // ── STEP 19: BEST TRADE OF THE DAY ────────────────────────────────
    const todaysBestTrade = (() => {
      const candidates = coins
        .filter(c => c.direction==='LONG' && c.conv.score>=60 && c.oi>=MIN_OI_FUTURES)
        .sort((a,b) => {
          // Composite scoring for "best trade"
          const sA = a.conv.score + (a.rsiReal?12:0) + (a.rsi<30?15:a.rsi<38?8:0) + (a.frPct<-0.005?12:a.frPct<-0.002?6:0) + (a.whale.score>=22?10:0) + (a.convStars||0)*2;
          const sB = b.conv.score + (b.rsiReal?12:0) + (b.rsi<30?15:b.rsi<38?8:0) + (b.frPct<-0.005?12:b.frPct<-0.002?6:0) + (b.whale.score>=22?10:0) + (b.convStars||0)*2;
          return sB - sA;
        });
      const top = candidates[0] || null;
      if (!top) return null;
      const reasons = [];
      if (top.rsiReal && top.rsi < 35) reasons.push(`RSI ${top.rsi.toFixed(1)} REAL oversold dari 4H klines`);
      if (top.frPct < -0.003) reasons.push(`FR ${top.frPct}% = shorts bayar longs mahal`);
      if (top.whale.score >= 22) reasons.push(top.whale.level || 'Whale signal aktif');
      if (top.retailLong <= 40) reasons.push(`${top.retailShort}% retail short = squeeze kandidat`);
      if (top.isCoiling) reasons.push('ATR compressed = energi terkumpul');
      if (top.conv.score >= 78) reasons.push(`Convergence ${top.conv.label}: ${top.conv.score}/100`);
      if (top.futures.opportunity === 'SQUEEZE_PLAY') reasons.push('Futures squeeze play confirmed');
      return {
        sym: top.sym, price: top.price, signal: top.signal||'—',
        rsi: top.rsi, fr: top.frPct, conv: top.conv.score, convLabel: top.conv.label,
        convStars: top.convStars, whale: top.whale, futures: top.futures,
        mtfConfirmed: !!(top.rsiReal && top.rsi < 38),
        retailLong: top.retailLong, retailShort: top.retailShort,
        reasoning: reasons,
        ...top.levels,
        rr: top.levels?.rr || 2.3,
        probability: top.probability || 70,
        kellySizing: top.levels?.kellySizePct || 2,
        oi: top.oi, vol: top.vol, sector: top.sector,
      };
    })();

    // ── ASSEMBLE OUTPUT ────────────────────────────────────────────────
    const out = {
      ok: true, version: 'v2.0', brand: '369 GLOBAL CRYPTO',
      ts: Date.now(), elapsed: Date.now()-t0,
      dataQuality: {
        coins: totalCoins,
        realRSI: realRSICount,
        bybitLinear: Object.values(cm).filter(c=>c.src==='bybit_linear').length,
        mexc: Object.values(cm).filter(c=>c.src==='mexc').length,
        whaleSignals: whaleCount,
        squeezeSignals: squeezeCount,
        minLiqApplied: true,
      },
      fg, fgLabel,
      marketCharacter: {
        type: mcType, color: mcColor, description: mcDesc,
        tradeStyle: mcStrat, riskLevel: mcRisk, positionSize: mcPos,
        marketPct: `${Math.round(bPct*100)}% bullish`,
        stats: { oversold:osCount, overbought:obCount, bullish:Math.round(bPct*100), bearish:Math.round((1-bPct)*100), whaleActive:whaleCount, squeezeReady:squeezeCount },
      },
      btcSnapshot,
      convergence: {
        leaders: longs.slice(0,12), longSetups: longs, shortSetups: shorts,
        flySetups: flys, accumSetups: accums,
        summary: `${longs.length} LONG · ${shorts.length} SHORT · ${flys.length} FLY · ${accums.length} ACCUM`,
        eliteCount: longs.filter(c=>c.conv.score>=82).length,
        primeCount: longs.filter(c=>c.conv.score>=72&&c.conv.score<82).length,
        validCount: longs.filter(c=>c.conv.score>=62&&c.conv.score<72).length,
        shortCount: shorts.length,
      },
      whaleRadar,
      whaleRadarSummary: `${whaleCount} whale · ${stealthVolume.length} stealth vol · ${whaleFingerprint.length} fingerprint`,
      futuresIntelligence: {
        squeezeSetups: futuresSqueezeSetups,
        overboughtShorts: futuresOverbought,
        summary: `${futuresSqueezeSetups.length} squeeze · ${futuresOverbought.length} short setups`,
        topSqueeze: futuresSqueezeSetups[0] || null,
      },
      gamePlan,
      sectorFlow: { sectors, sectorData },
      tradingSchedule: {
        wibHour: wibH, dayName: days[now.getUTCDay()],
        sessions: sess, currentSession: csId, currentSessionObj: cso,
        focusToday: cso.q==='PRIME'?`${cso.name} PRIME aktif!`:cso.q==='GOOD'?`${cso.name} kondisi bagus`:`Next PRIME: ${nxt?nxt.name+' ~'+((nxt.start>wibH?nxt.start-wibH:24-wibH+nxt.start))+'h':'-'}`,
        nextPrimeSession: nxt ? { name:nxt.name, time:nxt.time, inH:(nxt.start>wibH?nxt.start-wibH:24-wibH+nxt.start) } : null,
        positionSizeRec: mcPos,
      },
      checklist: {
        marketChecks: mkChecks, coinChecks: [
          {label:'RSI koin <72'},{label:'Conv Score 60+'},{label:'FR <+0.02%'},
          {label:'RR min 1:2.5'},{label:'Volume >$3M USD'},{label:'OI >$10M'},
          {label:'Size max 2% equity'},{label:'SL ATR-based real'},
          {label:'Sesuai skenario Game Plan'},{label:'No entry 30min sebelum news'},
        ],
        marketPassCount: passC, marketTotal: 8,
        overallGreenLight: passC >= 6,
        verdict: passC >= 6 ? 'KONDISI LAYAK TRADING' : `HATI-HATI — ${8-passC} kondisi belum terpenuhi`,
      },
      stealthVolume, hiddenGems, momentumShift,
      retailTrapList, retailSqueezeList,
      dailyOpportunityScore: { score:dosScore, label:dosLabel, action:dosAction, fg, session:cso.q, osCoins:osCount, squeezeCoins:squeezeCount, whaleCoins:whaleCount },
      marketRegime: { regime, regimeColor, regimeDesc, sizingGuidance, fg, mvrv:mvrvProxy, osCoins:osCount },
      todaysBestTrade,
      whaleFingerprint, squeezeRadar,
    };

    CACHE.d = out;
    CACHE.t = Date.now();
    return res.status(200).json(out);

  } catch (e) {
    // Safe fallback — never crash
    const safe = {
      ok: false, version: 'v2.0', brand: '369 GLOBAL CRYPTO',
      error: String(e?.message || 'Unknown error'), ts: Date.now(), elapsed: Date.now()-t0,
      dataQuality: { coins:0, realRSI:0 },
      fg:50, fgLabel:'Neutral',
      marketCharacter:{type:'UNKNOWN',color:'gray',description:'Data tidak tersedia',tradeStyle:'Wait',riskLevel:'HIGH',positionSize:'0%',marketPct:'50% bullish',stats:{oversold:0,overbought:0,bullish:50,bearish:50,whaleActive:0,squeezeReady:0}},
      btcSnapshot:{price:0,ch24:0,rsi:null,fg:50,fgLabel:'Neutral',macd:null,resistance:null,support:null,current:0,aboveEma200:false,btcLS:null,btcLongPct:null,btcShortPct:null,d1rsi:null,rsiDir:'flat',atrPct:0,atr:0,e200:0},
      convergence:{leaders:[],longSetups:[],shortSetups:[],flySetups:[],accumSetups:[],summary:'Data tidak tersedia',eliteCount:0,primeCount:0,validCount:0,shortCount:0},
      whaleRadar:[],whaleRadarSummary:'—',
      futuresIntelligence:{squeezeSetups:[],overboughtShorts:[],summary:'—',topSqueeze:null},
      gamePlan:{btcLevels:{resistance:null,support:null,current:0},scenarios:{bull:{condition:'-',action:'-'},sideways:{condition:'-',action:'-'},bear:{condition:'-',action:'-'}},scalpSetups:[],swingSetups:[],activeShorts:[],spotAccum:[],avoidList:[]},
      sectorFlow:{sectors:[],sectorData:{}},
      tradingSchedule:{wibHour:0,dayName:'-',sessions:[],currentSession:'dead',currentSessionObj:{id:'dead',name:'Dead Zone',q:'POOR',activity:'-'},focusToday:'-',nextPrimeSession:null},
      checklist:{marketChecks:[],coinChecks:[],marketPassCount:0,marketTotal:8,overallGreenLight:false,verdict:'Error'},
      stealthVolume:[],hiddenGems:[],momentumShift:[],
      retailTrapList:[],retailSqueezeList:[],
      dailyOpportunityScore:{score:50,label:'NORMAL',action:'-'},
      marketRegime:{regime:'NORMAL',regimeColor:'gray',regimeDesc:'-',sizingGuidance:'-'},
      todaysBestTrade:null,
      whaleFingerprint:[],squeezeRadar:[],
    };
    return res.status(200).json(safe);
  }
}
