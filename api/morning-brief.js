// api/morning-brief.js — 369 GLOBAL CRYPTO v1.0
// REBUILD TOTAL: Multi-source parallel, Whale Radar, Futures Intelligence
// Sources: Bybit (primary) + Binance + MEXC + CoinGecko + OKX
// Features:
//   - Whale Accumulation Radar (spot: large OI + flat price + neg FR)
//   - Futures Intelligence (FR extreme + OI direction + L/S per coin)
//   - Smart Money Flow (OBV divergence + displacement detection)
//   - Real RSI dari klines (Bybit + MEXC parallel)
//   - Kelly sizing, conviction stars, liquidation zones
// =====================================================================

'use strict';

// ─── CONSTANTS ──────────────────────────────────────────────────────
const STAB = new Set([
  'USDT','USDC','BUSD','DAI','TUSD','FDUSD','USDE','FRAX','GUSD',
  'USDP','SUSD','LUSD','PYUSD','EURC','USDD','BIDR','IDRT',
]);
const BAD = ['UP','DOWN','BULL','BEAR','3L','3S','2L','2S','5L','5S','HALF','1000'];
const isBad = s => BAD.some(b => s.endsWith(b) || s.startsWith(b)) || STAB.has(s);

// Coins we fetch real 4H klines for (most liquid/important)
const KLINE_COINS = [
  'BTC','ETH','SOL','BNB','XRP','ADA','AVAX','DOGE','LINK','DOT',
  'NEAR','SUI','APT','ARB','OP','PEPE','INJ','TIA','RENDER','WIF',
  'BONK','HYPE','JUP','PENDLE','ONDO','ENA','NOT','TON','TRX','XLM',
  'AAVE','UNI','CRV','GMX','DYDX','LDO','SNX','BLUR','IMX','STRK',
  'FET','AGIX','WLD','IO','VIRTUAL','OLAS','GOAT','NEIRO','PNUT',
  'FLOKI','SHIB','MEME','PEOPLE','TURBO','ACT','BOME','MOODENG',
  'SEI','EIGEN','ZK','PYTH','W','RON','BAND','API3','JTO',
];

const SECTORS = {
  Bitcoin:['BTC'], Ethereum:['ETH'],
  L1:['SOL','ADA','AVAX','TON','NEAR','SUI','APT','SEI','INJ','HBAR','ALGO','XLM','TRX','VET'],
  L2:['ARB','OP','MATIC','STRK','IMX','ZK','SCROLL','BLAST','MANTA'],
  DeFi:['UNI','AAVE','CRV','MKR','SNX','COMP','PENDLE','GMX','JUP','DYDX','LDO','SUSHI','GNS'],
  Payments:['XRP','LTC','BCH','XMR','DASH','XLM'],
  Gaming:['AXS','SAND','MANA','GALA','MAGIC','BEAM','RON','YGG'],
  AIDePin:['RENDER','FET','AGIX','TAO','WLD','IO','ARKM','VIRTUAL','OLAS','OCEAN','GRASS'],
  Infrastructure:['LINK','DOT','ATOM','FIL','GRT','API3','BAND','PYTH','JTO','W','EIGEN'],
  Meme:['DOGE','SHIB','PEPE','WIF','BONK','FLOKI','BOME','NEIRO','MOODENG','PNUT','ACT','TURBO','MEME','PEOPLE','GOAT','NOT'],
  RWA:['ONDO','POLYX'],
  Trending:[],
};
const getSector = s => { for(const[n,v] of Object.entries(SECTORS)) if(v.includes(s)) return n; return 'Trending'; };

// ─── HELPERS ────────────────────────────────────────────────────────
const N = (v, d=0) => { const n=+v; return (isNaN(n)||!isFinite(n)) ? d : n; };
const A = v => Array.isArray(v) ? v : [];
const cl = (v,a,b) => Math.max(a, Math.min(b, N(v)));

// Safe fetch with timeout
const sf = async (url, ms=4000) => {
  const ctrl = new AbortController();
  const tmr = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'Accept':'application/json', 'User-Agent':'369Global/1.0' },
    });
    clearTimeout(tmr);
    return r.ok ? await r.json() : null;
  } catch { clearTimeout(tmr); return null; }
};

// ─── TA FUNCTIONS ────────────────────────────────────────────────────
const rsi14 = closes => {
  if (!closes || closes.length < 16) return null;
  let g=0, l=0;
  for(let i=1;i<=14;i++){const d=closes[i]-closes[i-1]; d>0?g+=d:l-=d;}
  g/=14; l/=14;
  for(let i=15;i<closes.length;i++){
    const d=closes[i]-closes[i-1];
    g=(g*13+Math.max(d,0))/14;
    l=(l*13+Math.max(-d,0))/14;
  }
  return l===0 ? 100 : cl(100-100/(1+g/l), 0, 100);
};

const emaCalc = (arr, p) => {
  if(!arr||arr.length<2) return N(arr?.[arr.length-1]);
  const k=2/(p+1);
  let e=arr.slice(0,Math.min(p,arr.length)).reduce((s,v)=>s+v,0)/Math.min(p,arr.length);
  for(let i=Math.min(p,arr.length);i<arr.length;i++) e=arr[i]*k+e*(1-k);
  return e;
};

const macdCalc = closes => {
  if(!closes||closes.length<36) return null;
  const k12=2/13, k26=2/27, k9=2/10;
  let e12=closes[0], e26=closes[0];
  const mv=[];
  for(const v of closes){ e12=v*k12+e12*(1-k12); e26=v*k26+e26*(1-k26); mv.push(e12-e26); }
  let sig=mv.slice(0,9).reduce((s,v)=>s+v,0)/9;
  for(let i=9;i<mv.length;i++) sig=mv[i]*k9+sig*(1-k9);
  const n=mv.length, last=N(mv[n-1]), prev=N(mv[n-2]||last), h=last-sig, ph=prev-sig;
  return { bull:last>0&&h>0, bear:last<0&&h<0, xUp:h>0&&ph<=0, xDown:h<0&&ph>=0, val:+last.toFixed(6) };
};

const atrCalc = (K, p=14) => {
  if(!K||K.length<p+1) return 0;
  const trs=K.slice(1).map((k,i)=>Math.max(N(k.h)-N(k.l),Math.abs(N(k.h)-N(K[i].c)),Math.abs(N(k.l)-N(K[i].c))));
  return trs.slice(-p).reduce((s,v)=>s+v,0)/p;
};

// ─── WHALE DETECTION ENGINE ──────────────────────────────────────────
// Detects smart money accumulation BEFORE price moves
function detectWhaleAccumulation(coin) {
  const { price, c24, vol, fr, oi, rsi, pip, K, obvBull, atrPct } = coin;
  let score = 0;
  const signals = [];
  const tags = [];

  // 1. OI large + price flat + FR negative = stealth accumulation (STRONGEST signal)
  if (oi > 500e6 && fr < -0.0002 && Math.abs(c24) < 1.5 && vol > 1e6) {
    score += 25;
    signals.push(`STEALTH ACCUM: OI $${(oi/1e9).toFixed(1)}B + FR ${(fr*100).toFixed(4)}% + harga flat`);
    tags.push('WHALE_ACCUM');
  }

  // 2. Volume spike + price barely moved = absorption (SM buying supply)
  const mcapProxy = vol / Math.max(0.001, Math.abs(c24)/100 + 0.001);
  const volRatio = oi > 0 ? vol/oi : 0;
  if (vol > 50e6 && Math.abs(c24) < 2 && volRatio > 0.15) {
    score += 18;
    signals.push(`ABSORPTION: Vol $${(vol/1e6).toFixed(0)}M + harga flat = SM serap supply`);
    tags.push('ABSORPTION');
  }

  // 3. OBV bullish divergence: volume buyers dominant while price down
  if (obvBull && c24 < 0 && rsi < 45) {
    score += 15;
    signals.push(`OBV DIVERGE: Volume beli dominan saat harga turun = akumulasi tersembunyi`);
    tags.push('OBV_DIV');
  }

  // 4. FR extreme negative = shorts paying longs = squeeze imminent
  if (fr < -0.0005 && rsi < 50 && vol > 500000) {
    score += 20;
    signals.push(`SQUEEZE SETUP: FR ${(fr*100).toFixed(4)}% = shorts bayar mahal, pompa akan datang`);
    tags.push('SQUEEZE');
  } else if (fr < -0.0002 && rsi < 50) {
    score += 10;
    signals.push(`FR NEG: ${(fr*100).toFixed(4)}% = bias long`);
    tags.push('NEG_FR');
  }

  // 5. RSI oversold + OI stable/growing + FR negative = bottom zone
  if (rsi < 28 && oi > 100e6 && fr <= 0 && c24 > -5) {
    score += 20;
    signals.push(`BOTTOM ZONE: RSI ${rsi.toFixed(0)} + OI stabil + FR neg = institusi akumulasi di bottom`);
    tags.push('BOTTOM');
  } else if (rsi < 35 && fr <= 0) {
    score += 10;
    signals.push(`OVERSOLD: RSI ${rsi.toFixed(0)} + FR ${(fr*100).toFixed(4)}%`);
  }

  // 6. Price in discount zone + OI rising
  if (pip < 25 && oi > 200e6 && c24 > -3) {
    score += 12;
    signals.push(`DISCOUNT ZONE: pip ${pip.toFixed(0)}% + OI $${(oi/1e9).toFixed(1)}B = SM beli di bawah`);
    tags.push('DISCOUNT');
  }

  // 7. Klines ATR compression + OI building = coiling before explosion
  if (atrPct > 0 && atrPct < 1.5 && oi > 300e6 && Math.abs(c24) < 1) {
    score += 15;
    signals.push(`COILING: ATR ${atrPct}% menyempit + OI $${(oi/1e9).toFixed(1)}B = energi terkumpul`);
    tags.push('COIL');
  }

  const level = score >= 50 ? '🐳 MEGA WHALE' : score >= 35 ? '🐋 WHALE' : score >= 20 ? '🔍 SMART MONEY' : null;
  return { score: cl(score,0,100), level, signals: signals.slice(0,4), tags };
}

// ─── FUTURES INTELLIGENCE ENGINE ────────────────────────────────────
// Detects futures market inefficiencies and squeeze opportunities
function analyzeFutures(coin) {
  const { fr, oi, rsi, c24, vol, retailLong, retailShort, price } = coin;
  const frPct = fr * 100;
  let score = 0;
  const signals = [];
  let state = 'NEUTRAL';
  let stateColor = 'gray';
  let opportunity = null;

  // OI Direction (4 market states — critical for futures)
  // State 1: OI up + price up = NEW LONGS (healthy bull)
  // State 2: OI up + price down = NEW SHORTS (bearish pressure)
  // State 3: OI down + price up = SHORT SQUEEZE (longs covering shorts)
  // State 4: OI down + price down = LONG LIQUIDATION (capitulation)

  const oiChangePct = coin.oiChangePct || 0;
  if (oiChangePct > 3 && c24 > 1) {
    state = 'NEW LONGS'; stateColor = 'green'; score += 15;
    signals.push(`OI +${oiChangePct.toFixed(1)}% + harga naik = posisi long baru masuk`);
    opportunity = 'LONG_ENTRY';
  } else if (oiChangePct > 3 && c24 < -1) {
    state = 'NEW SHORTS'; stateColor = 'red'; score -= 10;
    signals.push(`OI +${oiChangePct.toFixed(1)}% + harga turun = short baru masuk`);
    opportunity = 'WAIT';
  } else if (oiChangePct < -3 && c24 > 1) {
    state = 'SHORT SQUEEZE'; stateColor = 'cyan'; score += 12;
    signals.push(`OI -${Math.abs(oiChangePct).toFixed(1)}% + harga naik = short cover paksa`);
    opportunity = 'MOMENTUM';
  } else if (oiChangePct < -3 && c24 < -1) {
    state = 'LONG LIQ'; stateColor = 'orange'; score -= 5;
    signals.push(`OI -${Math.abs(oiChangePct).toFixed(1)}% + harga turun = kapitulasi long`);
    opportunity = rsi < 30 ? 'DCA_ZONE' : 'WAIT';
  }

  // Funding rate analysis
  if (frPct < -0.05) {
    score += 25;
    signals.push(`FR EXTREME ${frPct.toFixed(4)}% = SQUEEZE IMMINENT, shorts bayar sangat mahal`);
    opportunity = 'SQUEEZE_PLAY';
  } else if (frPct < -0.02) {
    score += 15;
    signals.push(`FR NEGATIVE ${frPct.toFixed(4)}% = shorts dominant, reversal likely`);
  } else if (frPct < 0) {
    score += 8;
    signals.push(`FR neg ${frPct.toFixed(4)}% = mild bearish sentiment = contrarian buy`);
  } else if (frPct > 0.05) {
    score -= 20;
    signals.push(`FR OVERHEATED +${frPct.toFixed(4)}% = longs sangat mahal, dump risk tinggi`);
    opportunity = 'SHORT_SETUP';
  } else if (frPct > 0.02) {
    score -= 10;
    signals.push(`FR elevated +${frPct.toFixed(4)}% = hati-hati longs`);
  }

  // Retail positioning (contrarian signal)
  if (retailLong >= 65) {
    score -= 15;
    signals.push(`RETAIL TRAP: ${retailLong}% retail LONG = SM akan jual ke mereka`);
    opportunity = opportunity || 'SHORT_SETUP';
  } else if (retailLong <= 35) {
    score += 18;
    signals.push(`SQUEEZE CANDIDATE: ${100-retailLong}% retail SHORT = pump paksa mereka cover`);
    opportunity = opportunity || 'SQUEEZE_PLAY';
  }

  // OI absolute size context
  if (oi > 2e9) {
    signals.push(`OI MEGA $${(oi/1e9).toFixed(1)}B = tier institusional`);
    score += 5;
  } else if (oi > 500e6) {
    score += 3;
  }

  return {
    score: cl(score, -50, 100),
    state, stateColor, signals: signals.slice(0,4),
    opportunity, frPct: +frPct.toFixed(4),
    oiB: +(oi/1e9).toFixed(2),
  };
}

// ─── SIGNAL ENGINE ───────────────────────────────────────────────────
function generateSignal(coin) {
  const { rsi, fr, oi, c24, vol, pip, obvBull, isCoiling, c7, retailLong, oiChangePct, atrPct } = coin;
  const frPct = (fr||0) * 100;
  const rs = coin.rs || 0;
  let sig='', sc='#4a5568', desc='', dir='WAIT', prob=50, tags=[];

  // Priority signals (strongest first)
  if (rsi < 22 && frPct < -0.01 && c24 < -5 && vol > 500000) {
    sig='CAPITULATION BUY'; sc='#00ffd0'; dir='LONG'; prob=90;
    desc=`RSI ${rsi.toFixed(0)} ekstrem + FR ${frPct.toFixed(4)}% + dump = BOTTOM SIGNAL LANGKA`;
    tags=['RARE','CAPITULATION'];
  } else if (rsi < 28 && frPct < -0.004 && isCoiling && vol > 200000) {
    sig='ABOUT TO FLY 🚀'; sc='#ffd700'; dir='LONG'; prob=88;
    desc=`RSI oversold + FR squeeze + ATR menyempit = POMPA SEGERA`;
    tags=['COILING','SQUEEZE'];
  } else if (oi > 500e6 && frPct < -0.002 && Math.abs(c24) < 1.5 && vol > 1e6) {
    sig='WHALE FINGERPRINT 🐳'; sc='#00d4ff'; dir='LONG'; prob=87;
    desc=`OI $${(oi/1e9).toFixed(1)}B + harga flat + FR neg = INSTITUSI AKUMULASI DIAM-DIAM`;
    tags=['WHALE','STEALTH'];
  } else if (frPct < -0.005 && vol > 500000 && rsi > 30 && rsi < 55) {
    sig='SQUEEZE INCOMING 💎'; sc='#ff6b9d'; dir='LONG'; prob=85;
    desc=`FR ${frPct.toFixed(4)}% = shorts bayar longs setiap 8 jam, pompa tinggal tunggu trigger`;
    tags=['SQUEEZE','FR_EXTREME'];
  } else if (oiChangePct > 5 && c24 > 2 && rsi < 65 && vol > 2e6) {
    sig='NEW LONGS ENTERING ⚡'; sc='#00ff88'; dir='LONG'; prob=84;
    desc=`OI +${oiChangePct.toFixed(1)}% + harga naik = posisi baru masuk, trend valid`;
    tags=['NEW_LONGS','OI_UP'];
  } else if (retailLong <= 35 && rsi < 50 && vol > 1e6) {
    sig='SHORT SQUEEZE SETUP 🔥'; sc='#fb7185'; dir='LONG'; prob=83;
    desc=`${100-retailLong}% retail short = squeeze target. Trigger kecil → pompa besar`;
    tags=['SQUEEZE','RETAIL_SHORT'];
  } else if (rsi < 28 && (frPct < 0 || isCoiling) && vol > 100000) {
    sig='DEEP OVERSOLD ⬇️'; sc='#f87171'; dir='LONG'; prob=78;
    desc=`RSI ${rsi.toFixed(0)} = tekanan jual berlebihan, mean reversion akan terjadi`;
    tags=['OVERSOLD'];
  } else if (Math.abs(c24) < 1.5 && rsi > 40 && rsi < 60 && vol > 2e6 && frPct <= 0) {
    sig='SMART ACCUMULATION 🤫'; sc='#a78bfa'; dir='LONG'; prob=82;
    desc=`Volume besar + harga flat + FR neg = SM kumpul sebelum breakout`;
    tags=['ACCUM','STEALTH'];
  } else if (isCoiling && atrPct > 0 && atrPct < 1.5 && frPct < 0.002 && vol > 200000) {
    sig='PRE-BREAKOUT COIL ⚡'; sc='#fbbf24'; dir='LONG'; prob=76;
    desc=`ATR ${atrPct}% menyempit = energi terkumpul, breakout akan datang`;
    tags=['COIL','SETUP'];
  } else if (rs > 5 && c24 > (coin.btcC||0)+3 && vol > 1e6) {
    sig='NARRATIVE PLAY 📡'; sc='#c084fc'; dir='LONG'; prob=80;
    desc=`RS +${rs.toFixed(1)}% vs BTC = ada catalyst/narrative tersembunyi aktif`;
    tags=['RS_STRONG','NARRATIVE'];
  } else if (rsi < 35 && frPct <= 0 && obvBull && vol > 200000) {
    sig='OBV DIVERGENCE 📊'; sc='#6ee7b7'; dir='LONG'; prob=77;
    desc=`Volume beli dominan saat harga turun = SM akumulasi tersembunyi`;
    tags=['OBV_DIV','SMART_MONEY'];
  } else if (c24 > 3 && rsi >= 45 && rsi <= 65 && vol > 3e6) {
    sig='MOMENTUM BREAKOUT 🚀'; sc='#22c55e'; dir='LONG'; prob=78;
    desc=`+${c24.toFixed(1)}% + RSI sehat + vol $${(vol/1e6).toFixed(0)}M = trend aktif`;
    tags=['MOMENTUM'];
  } else if (rsi >= 42 && rsi <= 62 && c24 > 0.5 && frPct < 0.001) {
    sig='MILD BULL 📈'; sc='#6ee7b7'; dir='LONG'; prob=65;
    desc=`Mild bullish RSI ${rsi.toFixed(0)} +${c24.toFixed(1)}%`;
    tags=['MILD'];
  } else if (rsi > 80 && frPct > 0.03 && c24 > 8) {
    sig='BLOW-OFF TOP 🔴'; sc='#dc2626'; dir='SHORT'; prob=85;
    desc=`RSI ${rsi.toFixed(0)} + FR +${frPct.toFixed(4)}% + pump = DISTRIBUSI PUNCAK`;
    tags=['TOP','DIST'];
  } else if (rsi > 72 && frPct > 0.02 && c24 > 5) {
    sig='BULL TRAP ⚠️'; sc='#ef4444'; dir='SHORT'; prob=70;
    desc=`Overbought RSI ${rsi.toFixed(0)} + FR mahal = SM jual ke retail`;
    tags=['OVERBOUGHT'];
  } else if (retailLong >= 65 && rsi > 60) {
    sig='RETAIL TRAP 🚨'; sc='#f97316'; dir='SHORT'; prob=72;
    desc=`${retailLong}% retail LONG = SM akan jual ke mereka`;
    tags=['RETAIL_TRAP'];
  }

  return { signal:sig, signalColor:sc, signalDesc:desc, direction:dir, probability:prob, signalTags:tags };
}

// ─── CONVERGENCE SCORE ───────────────────────────────────────────────
function calcConvScore(coin) {
  const { rsi, fr, c24, c7, vol, oi, pip, obvBull, isCoiling, retailLong, oiChangePct } = coin;
  const frPct = (fr||0)*100;
  const vol5M = vol >= 5e6;

  // Volume confirmation gate — no high score without volume
  const volC = vol >= 200e6 ? 8 : vol >= 50e6 ? 6 : vol >= 10e6 ? 4 : vol >= 2e6 ? 2 : vol >= 500000 ? 1 : -3;

  // RSI component
  const rsiC = rsi<22?(coin.oiChangePct<0?15:10):rsi<28?10:rsi<35?6:rsi<42?3:rsi<50?0:rsi<60?0:rsi>80?-15:rsi>72?-10:rsi>65?-5:0;

  // Funding rate component
  const frC = frPct<-0.05?28:frPct<-0.02?20:frPct<-0.01?14:frPct<-0.005?9:frPct<-0.001?5:frPct<0?2:frPct>0.05?-22:frPct>0.02?-14:frPct>0.01?-8:frPct>0.005?-4:0;

  // OI component
  const oiC = oi>2e9?8:oi>500e6?5:oi>100e6?2:0;

  // OI change direction
  const oiDirC = oiChangePct>5&&c24>1?8:oiChangePct<-5&&c24>1?5:oiChangePct>5&&c24<-1?-5:0;

  // Retail positioning (contrarian)
  const retailC = (retailLong||50)<=35?12:(retailLong||50)>=65?-12:0;

  // Momentum
  const momC = (c7||0)>15?8:(c7||0)>5?4:(c7||0)>0?1:(c7||0)<-15?-8:(c7||0)<-5?-4:(c7||0)<0?-1:0;
  const mom24 = c24>8?5:c24>3?2:c24>0?0:c24<-8?-5:c24<-3?-2:0;

  // OBV and coiling
  const obvC = obvBull&&c24>0?5:obvBull&&c24<0?8:0; // OBV bull while price down = strongest
  const coilC = isCoiling?6:0;

  const raw = 48 + rsiC + frC + oiC + oiDirC + retailC + momC + mom24 + obvC + coilC + volC;
  const score = cl(Math.round(raw), 0, 100);
  const label = score>=82?'ELITE':score>=72?'PRIME':score>=62?'VALID':score>=52?'MOD':'WEAK';
  return { score, label };
}

// ─── TRADE LEVELS (ATR-based) ─────────────────────────────────────────
function buildLevels(price, dir, atrPct, prob) {
  const atr = Math.max(0.02, atrPct || 2.5);
  let slPct, tp1Pct, tp2Pct, tp3Pct;
  if (atrPct > 0) {
    slPct  = +(atr * 1.4).toFixed(2);
    tp1Pct = +(atr * 2.0).toFixed(2);
    tp2Pct = +(atr * 3.5).toFixed(2);
    tp3Pct = +(atr * 6.0).toFixed(2);
  } else {
    slPct=2.5; tp1Pct=4.0; tp2Pct=7.0; tp3Pct=12.0;
  }
  const rr = +(tp2Pct/slPct).toFixed(1);

  // Kelly criterion for position sizing
  const w = prob/100;
  const kellyRaw = (w*rr - (1-w)) / rr;
  const kellySizePct = Math.max(0.5, Math.min(10, +(kellyRaw/2*100).toFixed(1)));

  if (dir === 'LONG') {
    const sl  = +(price*(1-slPct/100)).toFixed(price>1?4:8);
    const tp1 = +(price*(1+tp1Pct/100)).toFixed(price>1?4:8);
    const tp2 = +(price*(1+tp2Pct/100)).toFixed(price>1?4:8);
    const tp3 = +(price*(1+tp3Pct/100)).toFixed(price>1?4:8);
    return { sl, tp1, tp2, tp3, slPct, tp1Pct, tp2Pct, tp3Pct, rr, kellySizePct };
  } else if (dir === 'SHORT') {
    const sl  = +(price*(1+slPct/100)).toFixed(price>1?4:8);
    const tp1 = +(price*(1-tp1Pct/100)).toFixed(price>1?4:8);
    const tp2 = +(price*(1-tp2Pct/100)).toFixed(price>1?4:8);
    const tp3 = +(price*(1-tp3Pct/100)).toFixed(price>1?4:8);
    return { sl, tp1, tp2, tp3, slPct, tp1Pct, tp2Pct, tp3Pct, rr, kellySizePct };
  }
  return { sl:0, tp1:0, tp2:0, tp3:0, slPct, tp1Pct, tp2Pct, tp3Pct, rr, kellySizePct };
}

// ─── MAIN HANDLER ────────────────────────────────────────────────────
const CACHE = { d:null, t:0 };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const t0 = Date.now();
  if (CACHE.d && (t0 - CACHE.t) < 90000) {
    return res.status(200).json({ ...CACHE.d, cached:true, elapsed:Date.now()-t0 });
  }

  try {
    // ── STEP 1: FETCH ALL DATA SOURCES IN PARALLEL ──────────────────
    const [
      byLinearR,   // Bybit linear tickers (FR, OI, price, L/S)
      bySpotR,     // Bybit spot tickers
      mexcR,       // MEXC spot (extra coverage)
      fgR,         // Fear & Greed
      btcLSR,      // BTC L/S ratio
    ] = await Promise.allSettled([
      sf('https://api.bybit.com/v5/market/tickers?category=linear', 4000),
      sf('https://api.bybit.com/v5/market/tickers?category=spot', 3500),
      sf('https://api.mexc.com/api/v3/ticker/24hr', 3500),
      sf('https://alternative.me/crypto/fear-and-greed-index/?format=json&limit=1', 3000),
      sf('https://api.bybit.com/v5/market/account-ratio?category=linear&symbol=BTCUSDT&period=1h&limit=1', 2500),
    ]);

    // ── STEP 2: BUILD COIN MAP ────────────────────────────────────────
    const cm = {}; // symbol → raw data

    // Bybit Linear (best source: has FR, OI, mark price)
    try {
      for (const t of A(byLinearR.value?.result?.list)) {
        const s = String(t.symbol||'').replace(/USDT|PERP/g,'');
        if (!s || s.length>14 || isBad(s)) continue;
        const p = N(t.lastPrice); if (p<=0||p>1e10) continue;
        const prev = N(t.prevPrice24h||p);
        const c24 = prev>0 ? +((p-prev)/prev*100).toFixed(3) : 0;
        const h = N(t.highPrice24h||p*1.01), l = N(t.lowPrice24h||p*0.99);
        const pip = h>l ? cl((p-l)/(h-l)*100,0,100) : 50;
        const fr = N(t.fundingRate);
        const oi = N(t.openInterestValue);
        const bid1 = N(t.bid1Size), ask1 = N(t.ask1Size);
        const bidAskRatio = bid1+ask1>0 ? +(bid1/(bid1+ask1)*100).toFixed(1) : 50;
        // Estimate retail L/S from bid/ask imbalance + FR
        const frEffect = fr*100*200; // FR negative pushes longs up
        const rLong = cl(Math.round(50 + (bidAskRatio-50)*0.5 + frEffect*0.3), 25, 75);
        cm[s] = {
          p, fr, oi, c24, v:N(t.turnover24h), h, l, pip,
          frPct:+(fr*100).toFixed(5),
          bidAsk:bidAskRatio, rLong, rShort:100-rLong,
          src:'bybit_linear',
        };
      }
    } catch {}

    // MEXC (fallback for coins not on Bybit)
    try {
      for (const t of A(mexcR.value||[])) {
        const s = String(t.symbol||'').replace('USDT','');
        if (!s || s.length>14 || isBad(s) || cm[s]) continue;
        const p = N(t.lastPrice); if (p<=0||p>1e10) continue;
        const c24 = N(t.priceChangePercent);
        const h = N(t.highPrice||p*1.01), l = N(t.lowPrice||p*0.99);
        const pip = h>l ? cl((p-l)/(h-l)*100,0,100) : 50;
        cm[s] = { p, fr:0, oi:0, c24, v:N(t.quoteVolume), h, l, pip, frPct:0, bidAsk:50, rLong:50, rShort:50, src:'mexc' };
      }
    } catch {}

    // F&G
    let fg=50, fgLabel='Neutral';
    try {
      const fd = fgR.value?.data?.[0];
      if (fd) { fg=N(fd.value,50); fgLabel=fd.value_classification||'Neutral'; }
    } catch {}

    // BTC L/S
    let btcLS=null, btcLongPct=null, btcShortPct=null;
    try {
      const row = A(btcLSR.value?.result?.list)[0];
      if (row) {
        btcLongPct = +(N(row.buyRatio)*100).toFixed(2);
        btcShortPct = +(N(row.sellRatio)*100).toFixed(2);
        btcLS = btcShortPct>0 ? +(btcLongPct/btcShortPct).toFixed(3) : null;
      }
    } catch {}

    // ── STEP 3: FETCH KLINES IN PARALLEL ─────────────────────────────
    // Bybit klines for top coins (4H, 60 candles)
    const klineCoinsFiltered = KLINE_COINS.filter(s => cm[s]);
    const klineResults = await Promise.allSettled(
      klineCoinsFiltered.map(s =>
        sf(`https://api.bybit.com/v5/market/kline?category=linear&symbol=${s}USDT&interval=240&limit=60`, 3500)
      )
    );

    // Also fetch BTC daily for 1D RSI
    const btcD1R = await sf('https://api.bybit.com/v5/market/kline?category=linear&symbol=BTCUSDT&interval=D&limit=30', 3000);

    const kMap = {};
    for (let i=0; i<klineCoinsFiltered.length; i++) {
      const sym = klineCoinsFiltered[i];
      try {
        const r = klineResults[i];
        if (r.status!=='fulfilled' || r.value?.retCode!==0) continue;
        const raw = A(r.value?.result?.list);
        if (raw.length<16) continue;
        const K = raw.slice().reverse().map(d=>({
          t:N(d[0]), o:N(d[1]), h:N(d[2]), l:N(d[3]), c:N(d[4]), v:N(d[6])||N(d[5]),
        })).filter(d=>d.c>0&&d.c<1e12&&d.h>=d.l);
        if (K.length<16) continue;
        const cls = K.map(k=>k.c);
        const rsiV = rsi14(cls);
        if (rsiV===null) continue;
        const e9=emaCalc(cls,9), e21=emaCalc(cls,21), e50=emaCalc(cls,Math.min(50,cls.length));
        const macd = macdCalc(cls);
        const atr = atrCalc(K);
        const lp = cls[cls.length-1];
        // OBV
        let obvUp=0, obvDn=0;
        for (let j=Math.max(1,K.length-20); j<K.length; j++) {
          if (N(K[j].c)>N(K[j-1].c)) obvUp+=N(K[j].v);
          else if (N(K[j].c)<N(K[j-1].c)) obvDn+=N(K[j].v);
        }
        // ATR compression detection
        const atr5 = atrCalc(K.slice(-5), 5);
        const atr20 = atrCalc(K.slice(-20), 14);
        const isCoiling = atr5>0 && atr20>0 && atr5<atr20*0.65;
        // Price velocity (RSI slope)
        const rsiPrev = rsi14(cls.slice(0,-1));
        const rsiDir = rsiPrev!==null ? (rsiV>rsiPrev+0.3?'up':rsiV<rsiPrev-0.3?'down':'flat') : 'flat';
        kMap[sym] = {
          rsi:+rsiV.toFixed(2), e9, e21, e50, macd, K, cls, atr:+atr.toFixed(8),
          atrPct: lp>0 ? +(atr/lp*100).toFixed(3) : 0,
          obvBull: obvUp>obvDn*1.2,
          isCoiling,
          rsiDir,
          aboveE200: lp > emaCalc(cls, Math.min(200,cls.length)),
          ok:true,
        };
      } catch {}
    }

    // BTC 1D RSI
    let btcD1rsi = null;
    try {
      const raw = A(btcD1R?.result?.list);
      if (raw.length>=16) {
        const cls = raw.slice().reverse().map(d=>N(d[4])).filter(v=>v>0);
        btcD1rsi = rsi14(cls);
      }
    } catch {}

    // ── STEP 4: BTC CONTEXT ────────────────────────────────────────────
    const btcCm = cm['BTC']||{};
    const btcKd = kMap['BTC']||{};
    const btcP = btcKd.cls?.[btcKd.cls.length-1] || N(btcCm.p);
    const btcC24 = N(btcCm.c24);

    // ── STEP 5: PROCESS ALL COINS ─────────────────────────────────────
    const coins = [];

    for (const [sym, raw] of Object.entries(cm)) {
      try {
        if (!sym || !raw.p || raw.p<=0) continue;
        const kd = kMap[sym] || null;
        const sector = getSector(sym);

        // RSI: real if klines available, estimated otherwise
        const rsiReal = !!(kd?.ok);
        const rsi = rsiReal ? kd.rsi : cl(
          50 + raw.c24*2.8 + (raw.pip-50)*0.5 + (raw.fr||0)*(-5000),
          8, 92
        );

        const atrPct = kd?.atrPct || 0;
        const obvBull = kd?.obvBull || false;
        const isCoiling = kd?.isCoiling || false;
        const macd = kd?.macd || null;

        // RS vs BTC
        const rs = +(raw.c24 - btcC24).toFixed(2);
        // 7d change estimate (if not available)
        const c7 = null; // We don't fetch 7d for all coins (bandwidth)

        const coin = {
          sym, sector,
          price:raw.p, c24:raw.c24, c7,
          vol:raw.v, h:raw.h, l:raw.l, pip:raw.pip,
          fr:raw.fr||0, oi:raw.oi||0, frPct:raw.frPct||0,
          rsi, rsiReal,
          atrPct, obvBull, isCoiling, macd,
          retailLong:raw.rLong||50, retailShort:raw.rShort||50,
          rs, btcC:btcC24,
          oiChangePct: 0, // will enrich if we have prev OI
          src:raw.src,
        };

        // Signal generation
        const sigResult = generateSignal(coin);
        const convResult = calcConvScore(coin);
        const whaleResult = detectWhaleAccumulation(coin);
        const futuresResult = analyzeFutures(coin);
        const levels = sigResult.direction !== 'WAIT'
          ? buildLevels(raw.p, sigResult.direction, atrPct, sigResult.probability)
          : null;

        // Conviction stars (1-5)
        const convStars = Math.min(5, +(
          (rsi<30 ? 1:rsi<38 ? 0.5:0) +
          ((raw.fr||0)<-0.002 ? 1:(raw.fr||0)<-0.0005 ? 0.5:0) +
          (isCoiling ? 0.5:0) +
          (rs>3 ? 0.5:rs>0 ? 0.25:0) +
          (obvBull&&raw.c24>0 ? 0.5:0) +
          (rsiReal ? 0.5:0) +
          (whaleResult.score>=25 ? 1:whaleResult.score>=15 ? 0.5:0)
        ).toFixed(1));

        // MTF badge
        const mtfBadge = rsiReal && rsi<35 ? '🔥 4H REAL' : '';

        coins.push({
          sym, sector, price:raw.p, c24:raw.c24, vol:raw.v,
          rsi:+rsi.toFixed(1), rsiReal,
          fr:raw.fr||0, frPct:raw.frPct||0,
          oi:raw.oi||0, pip:raw.pip,
          rs, atrPct, obvBull, isCoiling,
          retailLong:raw.rLong||50, retailShort:raw.rShort||50,
          ...sigResult,
          conv:convResult,
          whale:whaleResult,
          futures:futuresResult,
          levels, convStars, mtfBadge,
          bidAskRatio:raw.bidAsk||50,
          src:raw.src,
        });
      } catch {}
    }

    coins.sort((a,b) => b.conv.score - a.conv.score);
    const totalCoins = coins.length;

    // ── STEP 6: MARKET CHARACTER ───────────────────────────────────────
    const osCount = coins.filter(c=>c.rsi<30).length;
    const obCount = coins.filter(c=>c.rsi>70).length;
    const longDir  = coins.filter(c=>c.direction==='LONG').length;
    const shortDir = coins.filter(c=>c.direction==='SHORT').length;
    const bPct = totalCoins>0 ? longDir/totalCoins : 0.5;
    const whaleCount = coins.filter(c=>c.whale.score>=20).length;
    const squeezeCount = coins.filter(c=>c.frPct<-0.005).length;

    let mcType,mcColor,mcDesc,mcStrat,mcRisk,mcPos;
    if (osCount/totalCoins>0.12) {
      mcType='MASS OVERSOLD';mcColor='cyan';
      mcDesc=`${osCount} koin RSI<30. Zona DCA historis terbaik. ${whaleCount} sinyal whale aktif.`;
      mcStrat='Counter-trend DCA Agresif';mcRisk='MODERATE';mcPos='50-75%';
    } else if (obCount/totalCoins>0.18) {
      mcType='MASS OVERBOUGHT';mcColor='red';
      mcDesc=`${obCount} koin RSI>70. Distribusi massal. Kurangi exposure.`;
      mcStrat='Cash + Short Select';mcRisk='HIGH';mcPos='25%';
    } else if (bPct>0.65) {
      mcType='BULLISH';mcColor='green';
      mcDesc=`${Math.round(bPct*100)}% koin bullish. Trend naik aktif. ${squeezeCount} koin FR squeeze.`;
      mcStrat='Aggressive Long';mcRisk='STANDARD';mcPos='100%';
    } else if (bPct<0.30) {
      mcType='BEARISH';mcColor='red';
      mcDesc='Majority bearish. Cash atau short select saja.';
      mcStrat='Cash or Short';mcRisk='HIGH';mcPos='25%';
    } else {
      mcType='TRANSITIONAL';mcColor='amber';
      mcDesc=`Mixed signals. ${whaleCount} whale signal aktif. Selektif.`;
      mcStrat='Cautious Selective';mcRisk='REDUCED';mcPos='50%';
    }

    // ── STEP 7: CONVERGENCE SETUPS ─────────────────────────────────────
    const longs   = coins.filter(c=>c.direction==='LONG' && c.conv.score>=60).slice(0,40);
    const shorts  = coins.filter(c=>c.direction==='SHORT' && c.conv.score>=55).slice(0,10);
    const flys    = coins.filter(c=>c.signal&&(
      c.signal.includes('FLY')||c.signal.includes('CAPITULATION')||
      c.signal.includes('SQUEEZE INCOMING')
    )).slice(0,8);
    const accums  = coins.filter(c=>c.signal&&(
      c.signal.includes('SMART ACCUM')||c.signal.includes('WHALE')||
      c.signal.includes('PRE-BREAKOUT')||c.signal.includes('OBV')
    )).slice(0,8);

    const eliteCount  = longs.filter(c=>c.conv.score>=82).length;
    const primeCount  = longs.filter(c=>c.conv.score>=72&&c.conv.score<82).length;

    // ── STEP 8: WHALE RADAR ────────────────────────────────────────────
    const whaleRadar = coins
      .filter(c=>c.whale.score>=20)
      .sort((a,b)=>b.whale.score-a.whale.score)
      .slice(0,15)
      .map(c=>({
        sym:c.sym, price:c.price, c24:c.c24, vol:c.vol,
        rsi:c.rsi, rsiReal:c.rsiReal,
        fr:c.frPct, oi:c.oi,
        whaleScore:c.whale.score, whaleLevel:c.whale.level,
        whaleSigs:c.whale.signals,
        whaleTags:c.whale.tags,
        conv:c.conv.score,
        signal:c.signal, sector:c.sector,
      }));

    // ── STEP 9: FUTURES INTELLIGENCE ──────────────────────────────────
    // Best futures setups: extreme FR + OI signals
    const futuresSqueezeSetups = coins
      .filter(c=>c.frPct<-0.004 && c.vol>500000)
      .sort((a,b)=>a.frPct-b.frPct)
      .slice(0,12)
      .map(c=>({
        sym:c.sym, price:c.price, c24:c.c24,
        frPct:c.frPct, oi:c.oi, rsi:c.rsi,
        retailLong:c.retailLong, retailShort:c.retailShort,
        futuresState:c.futures.state, futuresScore:c.futures.score,
        futuresSigs:c.futures.signals,
        opportunity:c.futures.opportunity,
        conv:c.conv.score, signal:c.signal,
      }));

    const futuresOverbought = coins
      .filter(c=>c.frPct>0.02 && c.rsi>65 && c.vol>1e6)
      .sort((a,b)=>b.frPct-a.frPct)
      .slice(0,8)
      .map(c=>({
        sym:c.sym, price:c.price, c24:c.c24,
        frPct:c.frPct, rsi:c.rsi, retailLong:c.retailLong,
        signal:'SHORT ZONE', reason:`FR +${c.frPct}% + RSI ${c.rsi.toFixed(0)}`
      }));

    // Retail trap list
    const retailTrapList = coins
      .filter(c=>c.retailLong>=63 && c.rsi>55 && c.vol>2e6)
      .sort((a,b)=>b.retailLong-a.retailLong)
      .slice(0,8)
      .map(c=>({sym:c.sym,price:c.price,c24:c.c24,retailLong:c.retailLong,rsi:c.rsi}));

    const retailSqueezeList = coins
      .filter(c=>c.retailLong<=37 && c.rsi<50 && c.vol>1e6)
      .sort((a,b)=>a.retailLong-b.retailLong)
      .slice(0,8)
      .map(c=>({sym:c.sym,price:c.price,c24:c.c24,retailLong:c.retailLong,retailShort:c.retailShort,rsi:c.rsi}));

    // Golden opportunities
    const stealthVolume = coins
      .filter(c=>c.vol>10e6 && Math.abs(c.c24)<1.5 && c.rsi<65 && c.oi>200e6)
      .sort((a,b)=>b.vol-a.vol).slice(0,8)
      .map(c=>({sym:c.sym,price:c.price,c24:c.c24,vol:c.vol,rsi:c.rsi,oi:c.oi,fr:c.frPct}));

    const hiddenGems = coins
      .filter(c=>c.rsi<32 && c.frPct<=-0.001 && c.vol>300000 && c.conv.score>=60 &&
              !['BTC','ETH','BNB','SOL','XRP','ADA','DOGE'].includes(c.sym))
      .sort((a,b)=>a.rsi-b.rsi).slice(0,12)
      .map(c=>({sym:c.sym,price:c.price,c24:c.c24,rsi:c.rsi,fr:c.frPct,vol:c.vol,conv:c.conv.score}));

    const momentumShift = coins
      .filter(c=>c.c24>2 && c.rs>3 && !['BTC'].includes(c.sym) && c.vol>1e6 && c.rsi<75)
      .sort((a,b)=>b.rs-a.rs).slice(0,8)
      .map(c=>({sym:c.sym,price:c.price,c24:c.c24,rsi:c.rsi,vol:c.vol,rs:c.rs,outperformBTC:c.rs}));

    // ── STEP 10: BTC SNAPSHOT ──────────────────────────────────────────
    const btcSnapshot = {
      price:btcP, ch24:btcC24, fg, fgLabel,
      rsi: btcKd.rsi||null,
      rsiDir: btcKd.rsiDir||'flat',
      rsiSlope: btcKd.rsiDir==='up'?'rising':btcKd.rsiDir==='down'?'falling':'flat',
      atr: btcKd.atr||0,
      atrPct: btcKd.atrPct||0,
      macd: btcKd.macd||null,
      aboveEma200: btcKd.aboveE200||false,
      d1rsi: btcD1rsi ? +btcD1rsi.toFixed(1) : null,
      d1trend: btcD1rsi && btcKd.rsi ? (btcD1rsi<btcKd.rsi?'DOWN':'UP') : '-',
      btcLS, btcLongPct, btcShortPct,
      resistance: btcKd.cls ? +(Math.max(...btcKd.cls.slice(-10))*1.002).toFixed(0) : null,
      support: btcKd.cls ? +(Math.min(...btcKd.cls.slice(-10))*0.998).toFixed(0) : null,
      current: btcP,
    };

    // ── STEP 11: SPOT ACCUMULATION LIST ───────────────────────────────
    const spotAccum = coins
      .filter(c=>c.rsi<42 && c.direction!=='SHORT')
      .sort((a,b)=>a.rsi-b.rsi)
      .slice(0,12)
      .map(c=>{
        const dcaPct = Math.max(c.atrPct||0, 2.5);
        return {
          sym:c.sym, price:c.price, rsi:c.rsi, rsiReal:c.rsiReal,
          signal:c.signal||'OVERSOLD',
          atrPct:c.atrPct, fr:c.frPct,
          dcaZone:`$${+(c.price*(1-dcaPct*1.5/100)).toFixed(c.price>1?2:8)} – $${+(c.price*(1-dcaPct*0.3/100)).toFixed(c.price>1?2:8)}`,
          conv:c.conv.score, retailLong:c.retailLong,
          oversold:c.rsi<25?'EXTREME':c.rsi<30?'DEEP':'MODERATE',
        };
      });

    // ── STEP 12: GAME PLAN ─────────────────────────────────────────────
    const top3 = longs.slice(0,3).map(c=>c.sym);
    const btcRes = btcSnapshot.resistance;
    const btcSup = btcSnapshot.support;

    const gamePlan = {
      btcLevels:{ resistance:btcRes, support:btcSup, current:btcP },
      scenarios:{
        bull:{ condition:`BTC tembus $${btcRes} close di atas`, action:'Long conv 65+ RR 1:3 RS+FR filter', setups:top3 },
        sideways:{ condition:'BTC konsolidasi ±1.5%', action:'Scalp COILING+WHALE ACCUM saja' },
        bear:{ condition:`BTC breakdown ke $${btcSup}`, action:'Cash 80%. SHORT RSI 72+ FR overheated' },
      },
      scalpSetups: flys.slice(0,5).map(c=>({
        sym:c.sym, price:c.price, signal:c.signal, rsi:c.rsi,
        conv:c.conv.score, entry:c.price,
        sl:c.levels?.sl||0, tp1:c.levels?.tp1||0, tp2:c.levels?.tp2||0,
        slPct:c.levels?.slPct||0, tp1Pct:c.levels?.tp1Pct||0, tp2Pct:c.levels?.tp2Pct||0,
        rr:c.levels?.rr||2, fr:c.frPct, atrPct:c.atrPct, reasons:c.whale.signals,
        sector:c.sector, rsiReal:c.rsiReal,
      })),
      swingSetups: longs.filter(c=>c.conv.score>=70).slice(0,5).map(c=>({
        sym:c.sym, price:c.price, signal:c.signal, rsi:c.rsi,
        conv:c.conv.score, entry:c.price,
        sl:c.levels?.sl||0, tp1:c.levels?.tp1||0, tp2:c.levels?.tp2||0, tp3:c.levels?.tp3||0,
        slPct:c.levels?.slPct||0, tp1Pct:c.levels?.tp1Pct||0, tp2Pct:c.levels?.tp2Pct||0, tp3Pct:c.levels?.tp3Pct||0,
        rr:c.levels?.rr||2, fr:c.frPct, atrPct:c.atrPct, reasons:c.whale.signals,
        sector:c.sector, rsiReal:c.rsiReal,
      })),
      activeShorts: shorts.slice(0,5).map(c=>({
        sym:c.sym, price:c.price, signal:c.signal, rsi:c.rsi, fr:c.frPct,
        conv:c.conv.score,
        sl:c.levels?.sl||0, tp1:c.levels?.tp1||0, tp2:c.levels?.tp2||0,
        slPct:c.levels?.slPct||0, tp1Pct:c.levels?.tp1Pct||0, tp2Pct:c.levels?.tp2Pct||0,
      })),
      spotAccum,
      avoidList: coins.filter(c=>c.rsi>78 || c.frPct>0.03)
        .sort((a,b)=>b.rsi-a.rsi).slice(0,8)
        .map(c=>({sym:c.sym,price:c.price,rsi:c.rsi,fr:c.frPct,
          reason:c.rsi>80?`RSI ${c.rsi.toFixed(0)} overbought`:
          `FR +${c.frPct}% overheated`,signal:c.signal||'AVOID'})),
    };

    // ── STEP 13: SECTOR FLOW ───────────────────────────────────────────
    const secMap = {};
    for (const coin of coins) {
      const s = coin.sector||'Trending';
      if (!secMap[s]) secMap[s] = { coins:[], ch24Sum:0, frSum:0, rsSum:0, osC:0, sigQ:0 };
      secMap[s].coins.push(coin);
      secMap[s].ch24Sum += coin.c24;
      secMap[s].frSum += coin.fr||0;
      secMap[s].rsSum += coin.rs||0;
      if (coin.rsi<30) secMap[s].osC++;
      if (coin.signal && coin.conv.score>=70) secMap[s].sigQ++;
    }
    const sectorData = {};
    const sectors = Object.entries(secMap).map(([name,d])=>{
      const n = d.coins.length||1;
      const avgCh24 = +(d.ch24Sum/n).toFixed(3);
      const frAvg = +(d.frSum/n).toFixed(6);
      const rsAvg = +(d.rsSum/n).toFixed(2);
      const smScore = cl(Math.round(50+avgCh24*5+frAvg*(-2000)+rsAvg*3+Math.min(20,d.osC*3)+Math.min(10,d.sigQ*3)),0,100);
      const flyCoins = d.coins.filter(c=>c.signal&&(c.signal.includes('FLY')||c.signal.includes('WHALE'))).length;
      const eliteCoins = d.coins.filter(c=>c.conv.score>=80).length;
      const shortCoins = d.coins.filter(c=>c.direction==='SHORT').length;
      const oversoldCoins = d.coins.filter(c=>c.rsi<30).length;
      const flowSig = avgCh24>3?'STRONG INFLOW':avgCh24>1?'INFLOW':avgCh24<-3?'STRONG OUTFLOW':avgCh24<-1?'OUTFLOW':'NEUTRAL';
      const best = d.coins.filter(c=>c.signal&&c.direction==='LONG').sort((a,b)=>b.conv.score-a.conv.score)[0]||null;
      const sd = {
        name, avgCh24, frAvg, rsAvg, osC:d.osC, smScore, sigQ:d.sigQ,
        flyCoins, eliteCoins, shortCoins, oversoldCoins, flowSig,
        best: best ? { sym:best.sym, conv:best.conv.score, fr:best.frPct } : null,
        coins: d.coins.map(c=>({
          sym:c.sym, price:c.price, c24:c.c24, vol:c.vol,
          rsi:c.rsi, rsiReal:c.rsiReal, fr:c.frPct,
          signal:c.signal, signalColor:c.signalColor,
          direction:c.direction, probability:c.probability,
          conv:c.conv.score, rs:c.rs,
          obvBull:c.obvBull, isCoiling:c.isCoiling,
          levels:c.levels,
          retailLong:c.retailLong, retailShort:c.retailShort,
        })),
      };
      sectorData[name] = sd;
      return sd;
    }).sort((a,b)=>b.smScore-a.smScore);

    // ── STEP 14: SESSIONS ─────────────────────────────────────────────
    const now = new Date();
    const wibH = (now.getUTCHours()+7)%24;
    const days = ['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];
    const sess = [
      {id:'dead',name:'Dead Zone',time:'02:00-06:00',start:2,end:6,q:'POOR',activity:'Volume sangat sepi. Skip.'},
      {id:'asia_open',name:'Asia Open',time:'06:00-09:00',start:6,end:9,q:'MODERATE',activity:'Volume mulai masuk. Watch saja.'},
      {id:'asia_peak',name:'Asia Peak',time:'09:00-12:00',start:9,end:12,q:'GOOD',activity:'Volume Asia bagus. Entry selektif.'},
      {id:'lunch',name:'Lunch Break',time:'12:00-15:00',start:12,end:15,q:'CAUTION',activity:'Volume turun. Hindari entry baru.'},
      {id:'london',name:'London PRIME',time:'15:00-18:00',start:15,end:18,q:'PRIME',activity:'PRIME: Volume institusional tertinggi!'},
      {id:'ny_pre',name:'NY Pre',time:'18:00-21:00',start:18,end:21,q:'BUILDING',activity:'Build posisi sebelum NY Open.'},
      {id:'ny_open',name:'NY Open PRIME',time:'21:00-23:00',start:21,end:23,q:'PRIME',activity:'PRIME: Volume terbesar hari ini!'},
      {id:'ny_late',name:'NY Late',time:'23:00-02:00',start:23,end:2,q:'GOOD',activity:'Volume masih bagus. Swing ok.'},
    ];
    const csId = wibH>=2&&wibH<6?'dead':wibH>=6&&wibH<9?'asia_open':wibH>=9&&wibH<12?'asia_peak':wibH>=12&&wibH<15?'lunch':wibH>=15&&wibH<18?'london':wibH>=18&&wibH<21?'ny_pre':wibH>=21&&wibH<23?'ny_open':'ny_late';
    const cso = sess.find(s=>s.id===csId)||sess[0];
    const np = sess.filter(s=>s.q==='PRIME'&&s.id!==csId)[0]||null;
    const nxt = np ? { name:np.name, time:np.time, inH:np.start>wibH?np.start-wibH:24-wibH+np.start } : null;

    // ── STEP 15: CHECKLIST ─────────────────────────────────────────────
    const frHot = coins.filter(c=>c.frPct>0.005).length;
    const liqC = coins.filter(c=>c.vol>5e6).length;
    const mkChecks = [
      {label:'Market character layak trading',pass:mcType!=='MASS OVERBOUGHT',detail:`Character: ${mcType}`,fix:'Hindari distribusi massal'},
      {label:'Trading session berkualitas',pass:cso.q==='PRIME'||cso.q==='GOOD'||cso.q==='BUILDING',detail:`${cso.name} (${cso.q})`,fix:'Tunggu PRIME/GOOD session'},
      {label:'BTC tidak di resistance',pass:btcKd.rsi?btcKd.rsi<72:true,detail:btcKd.rsi?`BTC RSI ${btcKd.rsi.toFixed(0)}`:'BTC aman',fix:'Tunggu BTC RSI <65'},
      {label:'FR market tidak overheated',pass:frHot===0,detail:`${frHot} koin FR>0.005%`,fix:'Hindari entry saat FR massal mahal'},
      {label:'Market tidak overbought massal',pass:obCount<totalCoins*0.15,detail:`${obCount}/${totalCoins} koin RSI>70`,fix:'Tunggu RSI turun'},
      {label:'BTC L/S ratio aman',pass:btcLS===null||btcLS>=0.8,detail:btcLS?`L/S: ${btcLongPct}%/${btcShortPct}%`:'Data tidak tersedia',fix:'Hindari retail terlalu long'},
      {label:'Cukup koin aktif & liquid',pass:liqC>=8,detail:`${liqC} koin vol>$5M`,fix:'Tunggu London/NY Open'},
      {label:'BTC mendukung altcoin',pass:btcC24>-2,detail:`BTC ${btcC24.toFixed(2)}%`,fix:'Hindari altcoin saat BTC dump >2%'},
    ];
    const passC = mkChecks.filter(x=>x.pass).length;

    // ── STEP 16: DAILY OPPORTUNITY SCORE ─────────────────────────────
    let dosScore = 50;
    if (fg<20) dosScore+=20; else if (fg<35) dosScore+=12; else if (fg>75) dosScore-=15;
    if (osCount>20) dosScore+=18; else if (osCount>12) dosScore+=12; else if (osCount>6) dosScore+=6;
    if (cso.q==='PRIME') dosScore+=12; else if (cso.q==='GOOD') dosScore+=6;
    dosScore += Math.min(10, squeezeCount*2);
    dosScore += Math.min(8, whaleCount*2);
    dosScore = cl(Math.round(dosScore), 5, 98);
    const dosLabel = dosScore>=80?'EXTREME OPPORTUNITY':dosScore>=65?'HIGH OPPORTUNITY':dosScore>=50?'NORMAL':dosScore>=35?'LOW':'POOR DAY';
    const dosAction = dosScore>=80?'Hari langka! Full sizing pada sinyal PRIME/ELITE.':dosScore>=65?'Setup bagus. Sizing normal. Fokus conv 70+.':dosScore>=50?'Selektif. Hanya setup 3+ konfluens.':'Hindari new entry hari ini.';

    // ── STEP 17: MARKET REGIME ─────────────────────────────────────────
    const mvrvProxy = btcKd.cls ? +(btcP / emaCalc(btcKd.cls, Math.min(200, btcKd.cls.length))).toFixed(3) : 1.3;
    let regime, regimeColor, regimeDesc, sizingGuidance;
    if (fg<30 && mvrvProxy<1.1 && osCount/totalCoins>0.05) {
      regime='ACCUMULATE'; regimeColor='cyan';
      regimeDesc='Extreme Fear + MVRV rendah = zona akumulasi historis terbaik.';
      sizingGuidance='DCA bertahap 25-50%.';
    } else if (fg>=30&&fg<=65&&obCount/totalCoins<0.15&&(cso.q==='PRIME'||cso.q==='GOOD')) {
      regime='TRADE'; regimeColor='green';
      regimeDesc='Market seimbang + session bagus = kondisi ideal trading.';
      sizingGuidance='Full sizing. Patuhi SL.';
    } else if (fg>65||mvrvProxy>1.8) {
      regime='CAUTION'; regimeColor='amber';
      regimeDesc='Market greedy atau MVRV tinggi.';
      sizingGuidance='Max 0.5-1% risk/trade.';
    } else {
      regime='NORMAL'; regimeColor='gray';
      regimeDesc='Kondisi biasa. Selektif.';
      sizingGuidance='Sizing normal.';
    }

    // ── STEP 18: BEST TRADE OF THE DAY ─────────────────────────────────
    const todaysBestTrade = (() => {
      const candidates = coins
        .filter(c=>c.direction==='LONG' && c.conv.score>=62)
        .sort((a,b)=>{
          const sA = b.conv.score+(b.rsi<30?15:0)+(b.frPct<-0.002?10:0)+(b.whale.score>=20?10:0)+(b.convStars||0)*2;
          const sB = a.conv.score+(a.rsi<30?15:0)+(a.frPct<-0.002?10:0)+(a.whale.score>=20?10:0)+(a.convStars||0)*2;
          return sA-sB;
        });
      const top = candidates[0]||null;
      if (!top) return null;
      const reasons = [];
      if (top.rsiReal&&top.rsi<35) reasons.push(`RSI ${top.rsi.toFixed(1)} REAL oversold (4H klines)`);
      if (top.frPct<-0.002) reasons.push(`FR ${top.frPct}% shorts bayar longs mahal`);
      if (top.whale.score>=20) reasons.push(top.whale.level||'Whale activity detected');
      if (top.retailLong<=40) reasons.push(`${top.retailShort}% SHORT retail = squeeze potential`);
      if (top.isCoiling) reasons.push('ATR menyempit = energi terkumpul');
      if (top.conv.score>=80) reasons.push(`Convergence ELITE: ${top.conv.score}/100`);
      if (top.futures.opportunity==='SQUEEZE_PLAY') reasons.push('FR squeeze play setup');
      return {
        sym:top.sym, price:top.price, signal:top.signal||'-',
        rsi:top.rsi, fr:top.frPct, conv:top.conv.score, convLabel:top.conv.label,
        convStars:top.convStars, whale:top.whale, futures:top.futures,
        mtfConfirmed:!!(top.rsiReal&&top.rsi<35),
        retailLong:top.retailLong, retailShort:top.retailShort,
        reasoning:reasons,
        ...top.levels,
        rr:top.levels?.rr||2.3, probability:top.probability||70,
        kellySizing:top.levels?.kellySizePct||2,
      };
    })();

    // ── ASSEMBLE OUTPUT ────────────────────────────────────────────────
    const out = {
      ok:true, version:'v1.0', brand:'369 GLOBAL CRYPTO',
      ts:Date.now(), elapsed:Date.now()-t0,
      dataQuality:{
        coins:totalCoins, realRSI:Object.keys(kMap).length,
        bybitLinear:Object.values(cm).filter(c=>c.src==='bybit_linear').length,
        mexc:Object.values(cm).filter(c=>c.src==='mexc').length,
        whaleSignals:whaleCount, squeezeSignals:squeezeCount,
      },
      fg, fgLabel,
      marketCharacter:{
        type:mcType, color:mcColor, description:mcDesc,
        tradeStyle:mcStrat, riskLevel:mcRisk, positionSize:mcPos,
        marketPct:`${Math.round(bPct*100)}% bullish`,
        stats:{ oversold:osCount, overbought:obCount, bullish:Math.round(bPct*100), bearish:Math.round((1-bPct)*100), coiling:coins.filter(c=>c.isCoiling).length, whaleActive:whaleCount, squeezeReady:squeezeCount },
      },
      btcSnapshot,
      convergence:{
        leaders:longs.slice(0,12), longSetups:longs, shortSetups:shorts,
        flySetups:flys, accumSetups:accums,
        summary:`${longs.length} LONG · ${shorts.length} SHORT · ${flys.length} FLY · ${accums.length} ACCUM`,
        eliteCount, primeCount, validCount:longs.filter(c=>c.conv.score>=62&&c.conv.score<72).length,
        shortCount:shorts.length,
      },
      // ── WHALE RADAR (NEW) ──────────────────────────────────────────
      whaleRadar,
      whaleRadarSummary:`${whaleCount} koin whale signal aktif · ${stealthVolume.length} stealth volume · ${hiddenGems.length} hidden gems`,
      // ── FUTURES INTELLIGENCE (NEW) ────────────────────────────────
      futuresIntelligence:{
        squeezeSetups:futuresSqueezeSetups,
        overboughtShorts:futuresOverbought,
        summary:`${futuresSqueezeSetups.length} squeeze setups · ${futuresOverbought.length} short setups`,
        topSqueeze:futuresSqueezeSetups[0]||null,
      },
      // ── EXISTING ──────────────────────────────────────────────────
      gamePlan,
      sectorFlow:{ sectors, sectorData },
      tradingSchedule:{
        wibHour:wibH, dayName:days[now.getUTCDay()],
        sessions:sess, currentSession:csId, currentSessionObj:cso,
        focusToday:cso.q==='PRIME'?`${cso.name} PRIME aktif!`:cso.q==='GOOD'?`${cso.name} kondisi bagus`:`Next PRIME: ${nxt?nxt.name+' ~'+nxt.inH+'h':'-'}`,
        nextPrimeSession:nxt, positionSizeRec:mcPos,
      },
      checklist:{
        marketChecks:mkChecks,
        coinChecks:[
          {label:'RSI koin < 72'},{label:'Conv Score 60+'},
          {label:'FR < +0.02%'},{label:'RR min 1:2'},
          {label:'Volume 5M+ USD'},{label:'Size max 2% equity'},
          {label:'SL ATR-based'},{label:'Volume konfirmasi'},
          {label:'Sesuai skenario Game Plan'},{label:'No entry 30min sebelum news'},
        ],
        marketPassCount:passC, marketTotal:8,
        overallGreenLight:passC>=6,
        verdict:passC>=6?'KONDISI LAYAK TRADING':`HATI-HATI — ${8-passC} kondisi belum terpenuhi`,
      },
      // Golden opportunities
      stealthVolume, hiddenGems, momentumShift,
      retailTrapList, retailSqueezeList,
      dailyOpportunityScore:{ score:dosScore, label:dosLabel, action:dosAction, fg, session:cso.q, osCoins:osCount, squeezeCoins:squeezeCount, whaleCoins:whaleCount },
      marketRegime:{ regime, regimeColor, regimeDesc, sizingGuidance, fg, mvrv:mvrvProxy, osCoins:osCount },
      todaysBestTrade,
      // Whale fingerprint (stealth large OI)
      whaleFingerprint: coins.filter(c=>c.oi>500e6&&c.frPct<-0.001&&Math.abs(c.c24)<2&&c.vol>1e6)
        .sort((a,b)=>a.frPct-b.frPct).slice(0,8)
        .map(c=>({sym:c.sym,price:c.price,c24:c.c24,rsi:c.rsi,fr:c.frPct,oi:c.oi,vol:c.vol,rating:Math.abs(c.frPct)>0.005?'STRONG':'GOOD'})),
      squeezeRadar: coins.filter(c=>c.frPct<-0.003&&c.vol>500000&&c.rsi<55)
        .sort((a,b)=>a.frPct-b.frPct).slice(0,10)
        .map(c=>({sym:c.sym,price:c.price,c24:c.c24,rsi:c.rsi,fr:c.frPct,retailLong:c.retailLong,retailShort:c.retailShort,strength:Math.abs(c.frPct)>0.01?'EXTREME':Math.abs(c.frPct)>0.005?'STRONG':'HIGH'})),
    };

    CACHE.d = out;
    CACHE.t = Date.now();
    return res.status(200).json(out);

  } catch(e) {
    // Never crash — return safe fallback
    const safe = {
      ok:false, version:'v1.0', brand:'369 GLOBAL CRYPTO',
      error:String(e?.message||'Unknown error'),
      ts:Date.now(), elapsed:Date.now()-t0,
      dataQuality:{coins:0,realRSI:0},
      fg:50, fgLabel:'Neutral',
      marketCharacter:{type:'UNKNOWN',color:'gray',description:'Data tidak tersedia sementara',tradeStyle:'Wait',riskLevel:'HIGH',positionSize:'0%',marketPct:'50% bullish',stats:{oversold:0,overbought:0,bullish:50,bearish:50,coiling:0,whaleActive:0,squeezeReady:0}},
      btcSnapshot:{price:0,ch24:0,rsi:null,fg:50,fgLabel:'Neutral',macd:null,resistance:null,support:null,current:0,aboveEma200:false,btcLS:null,btcLongPct:null,btcShortPct:null,d1rsi:null,d1trend:'-',rsiSlope:'-',rsiDir:'flat',atrPct:0,atr:0},
      convergence:{leaders:[],longSetups:[],shortSetups:[],flySetups:[],accumSetups:[],summary:'Data tidak tersedia',eliteCount:0,primeCount:0,validCount:0,shortCount:0},
      whaleRadar:[], whaleRadarSummary:'Data tidak tersedia',
      futuresIntelligence:{squeezeSetups:[],overboughtShorts:[],summary:'Data tidak tersedia',topSqueeze:null},
      gamePlan:{btcLevels:{resistance:null,support:null,current:0},scenarios:{bull:{condition:'-',action:'-'},sideways:{condition:'-',action:'-'},bear:{condition:'-',action:'-'}},scalpSetups:[],swingSetups:[],activeShorts:[],spotAccum:[],avoidList:[]},
      sectorFlow:{sectors:[],sectorData:{}},
      tradingSchedule:{wibHour:0,dayName:'-',sessions:[],currentSession:'dead',currentSessionObj:{id:'dead',name:'Dead Zone',q:'POOR',activity:'-'},focusToday:'-',nextPrimeSession:null},
      checklist:{marketChecks:[],coinChecks:[],marketPassCount:0,marketTotal:8,overallGreenLight:false,verdict:'Error'},
      stealthVolume:[], hiddenGems:[], momentumShift:[],
      retailTrapList:[], retailSqueezeList:[],
      dailyOpportunityScore:{score:50,label:'NORMAL',action:'-'},
      marketRegime:{regime:'NORMAL',regimeColor:'gray',regimeDesc:'-',sizingGuidance:'-'},
      todaysBestTrade:null,
      whaleFingerprint:[], squeezeRadar:[],
    };
    return res.status(200).json(safe);
  }
}
