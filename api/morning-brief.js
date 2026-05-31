// api/morning-brief.js — 369 GLOBAL CRYPTO v21.0
// UPGRADE dari v20: CoinGecko + MEXC = 2000+ coins, CryptoCompare RSI = 35 real RSI
// ► 10x lebih banyak koin (180 → 2000+)
// ► RSI REAL dari CryptoCompare (bukan klines Bybit yang timeout)
// ► Semua bug v20 fixed: marketTotal, outperformBTC, coinChecks strings
'use strict';

// ─── FR CALIBRATION ──────────────────────────────────────────────
const FR_NEUTRAL  = 0.010; // 0.010% = normal Bybit rate
const FR_ELEVATED = 0.040; // 0.040% = longs heavy
const FR_HOT      = 0.080; // 0.080% = overheated
const FR_COOL     = 0.005; // 0.005% = below neutral
const FR_NEG      = 0.000; // 0.000% = negative
const FR_SQUEEZE  =-0.005; // -0.005% = squeeze setup
const FR_EXTREME  =-0.020; // -0.020% = extreme squeeze

// ─── CC35: CryptoCompare RSI coins ───────────────────────────────
const CC35 = [
  'BTC','ETH','BNB','SOL','XRP','ADA','DOGE','AVAX','LINK','DOT',
  'NEAR','SUI','APT','ARB','OP','PEPE','TON','INJ','TIA','RENDER',
  'LTC','ATOM','AAVE','CRV','FIL','ALGO','HBAR','GRT','MKR','SAND',
  'XLM','ENA','JTO','ONDO','SEI',
];

// ─── LIQUIDITY GATES ─────────────────────────────────────────────
const MIN_VOL_MAP   =  200_000;
const MIN_VOL_SIG   =  500_000;
const MIN_OI_WATCH  = 3_000_000;
const MIN_OI_WHALE  = 50_000_000;
const MIN_OI_FUT    = 20_000_000;
const MIN_OI_FLOW   = 30_000_000;

// ─── SECTORS ─────────────────────────────────────────────────────
const SECTORS = {
  Bitcoin:['BTC'],Ethereum:['ETH'],
  L1:['SOL','ADA','AVAX','TON','NEAR','SUI','APT','SEI','INJ','HBAR','ALGO','XLM','TRX','VET','ATOM','BNB','FTM','ONE','KAVA','ENA'],
  L2:['ARB','OP','MATIC','POL','STRK','IMX','ZK','SCROLL','BLAST','MANTA','METIS'],
  DeFi:['UNI','AAVE','CRV','MKR','SNX','COMP','PENDLE','GMX','JUP','DYDX','LDO','SUSHI','ONDO','CAKE','AERO','RDNT'],
  Payments:['XRP','LTC','BCH','XLM','DASH','XMR'],
  AIDePin:['RENDER','FET','AGIX','TAO','WLD','IO','ARKM','VIRTUAL','OLAS','OCEAN','GRASS','GRT'],
  Infrastructure:['LINK','DOT','FIL','BAND','PYTH','JTO','W','EIGEN','TIA','API3'],
  Meme:['DOGE','SHIB','PEPE','WIF','BONK','FLOKI','BOME','NEIRO','MOODENG','PNUT','ACT','TURBO','MEME','GOAT','NOT','HYPE'],
  Gaming:['AXS','SAND','MANA','GALA','MAGIC','BEAM','RON','YGG'],
  RWA:['ONDO','POLYX','MKR','CFG'],
};
const getSector = s => { for (const [n,v] of Object.entries(SECTORS)) if (v.includes(s)) return n; return 'Trending'; };

// ─── FILTERS ─────────────────────────────────────────────────────
const STAB = new Set(['USDT','USDC','BUSD','DAI','TUSD','FDUSD','USDE','FRAX','USDP','SUSD','LUSD','PYUSD','EURC','USDD','BIDR','IDRT','USDJ','USTC','GUSD','USDB']);
const BAD_SFX = ['UP','DOWN','BULL','BEAR','3L','3S','2L','2S','5L','5S'];
const isBad = s => {
  if (!s||s.length>14) return true;
  if (STAB.has(s)) return true;
  if (BAD_SFX.some(b=>s.endsWith(b)||s.startsWith(b))) return true;
  if (s.startsWith('1000')) return true;
  return false;
};

// ─── HELPERS ─────────────────────────────────────────────────────
const N = (v,d=0) => { const n=+v; return (isNaN(n)||!isFinite(n))?d:n; };
const A = v => Array.isArray(v)?v:[];
const cl = (v,a,b) => Math.max(a,Math.min(b,N(v)));

const sf = async (url, ms=5000) => {
  const ctrl = new AbortController();
  const tmr = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'Accept':'application/json', 'User-Agent':'369Global/21.0' },
    });
    clearTimeout(tmr);
    if (!r.ok) return null;
    return await r.json();
  } catch { clearTimeout(tmr); return null; }
};

// ─── TA FUNCTIONS ─────────────────────────────────────────────────
function rsi14(cls) {
  if (!cls||cls.length<16) return null;
  let g=0,l=0;
  for (let i=1;i<=14;i++){const d=cls[i]-cls[i-1];d>0?g+=d:l-=d;}
  let ag=g/14,al=l/14;
  for (let i=15;i<cls.length;i++){const d=cls[i]-cls[i-1];ag=(ag*13+Math.max(d,0))/14;al=(al*13+Math.max(-d,0))/14;}
  return al===0?100:cl(100-100/(1+ag/al),0,100);
}
function ema(arr,p) {
  if (!arr||arr.length<2) return N(arr?.[arr.length-1]);
  const k=2/(p+1);let e=arr.slice(0,Math.min(p,arr.length)).reduce((s,v)=>s+v,0)/Math.min(p,arr.length);
  for (let i=Math.min(p,arr.length);i<arr.length;i++) e=arr[i]*k+e*(1-k);
  return e;
}
function macdCalc(cls) {
  if (!cls||cls.length<28) return null;
  const k12=2/13,k26=2/27,k9=2/10;let e12=cls[0],e26=cls[0];const mv=[];
  for (const v of cls){e12=v*k12+e12*(1-k12);e26=v*k26+e26*(1-k26);mv.push(e12-e26);}
  let sig=mv.slice(0,9).reduce((s,v)=>s+v,0)/9;
  for (let i=9;i<mv.length;i++) sig=mv[i]*k9+sig*(1-k9);
  const n=mv.length,last=mv[n-1],prev=mv[n-2]||last,h=last-sig,ph=prev-sig;
  return {bull:last>0&&h>0,bear:last<0&&h<0,xUp:h>0&&ph<=0,xDown:h<0&&ph>=0,val:+last.toFixed(8)};
}
function atrCalc(K,p=14) {
  if (!K||K.length<p+1) return 0;
  const trs=K.slice(1).map((k,i)=>Math.max(N(k.h)-N(k.l),Math.abs(N(k.h)-N(K[i].c)),Math.abs(N(k.l)-N(K[i].c))));
  return trs.slice(-p).reduce((s,v)=>s+v,0)/p;
}

// ─── SIGNAL GENERATION ───────────────────────────────────────────
function generateSignal(coin) {
  const {rsi,frPct,oi,c24,vol,pip,obvBull,isCoiling,retailLong,oiChg,atrPct,rsiReal,rs,btcC}=coin;
  if (vol<MIN_VOL_SIG) return mk('','#4a5568','','WAIT',50,[]);

  let sig='',sc='#4a5568',desc='',dir='WAIT',prob=50,tags=[];

  if (rsiReal&&rsi<22&&frPct<FR_NEG&&c24<-5&&vol>2e6) {
    sig='CAPITULATION BUY 🆘';sc='#00ffd0';dir='LONG';prob=93;
    desc=`RSI REAL ${rsi.toFixed(0)} extreme + FR ${frPct.toFixed(4)}% = BOTTOM LANGKA`;tags=['RARE','CAPITULATION'];
  } else if (rsiReal&&rsi<28&&frPct<FR_COOL&&isCoiling&&vol>500000) {
    sig='ABOUT TO FLY 🚀';sc='#ffd700';dir='LONG';prob=90;
    desc=`RSI REAL ${rsi.toFixed(0)} + FR ${frPct.toFixed(4)}% + coiling = POMPA SEGERA`;tags=['FLY','COILING'];
  } else if (oi>200e6&&frPct<FR_NEUTRAL&&Math.abs(c24)<2&&vol>3e6) {
    sig='WHALE FINGERPRINT 🐳';sc='#00d4ff';dir='LONG';prob=88;
    desc=`OI $${(oi/1e9).toFixed(2)}B + flat + FR ${frPct.toFixed(4)}% = STEALTH ACCUM`;tags=['WHALE','STEALTH'];
  } else if (frPct<FR_SQUEEZE&&vol>1e6&&oi>MIN_OI_FUT) {
    sig='SQUEEZE INCOMING 💎';sc='#ff6b9d';dir='LONG';prob=88;
    desc=`FR ${frPct.toFixed(4)}% = shorts bayar longs tiap 8h`;tags=['SQUEEZE'];
  } else if (oiChg>5&&c24>2&&rsi<70&&vol>3e6) {
    sig='NEW LONGS ENTERING ⚡';sc='#00ff88';dir='LONG';prob=85;
    desc=`OI +${oiChg.toFixed(1)}% + harga +${c24.toFixed(1)}% = long valid`;tags=['NEW_LONGS'];
  } else if ((retailLong||50)<=35&&rsi<55&&vol>2e6&&oi>MIN_OI_FUT) {
    sig='SHORT SQUEEZE SETUP 🔥';sc='#fb7185';dir='LONG';prob=86;
    desc=`${100-(retailLong||50)}% retail SHORT = squeeze akan terjadi`;tags=['SQUEEZE','RETAIL'];
  } else if (rsiReal&&rsi<28&&frPct<FR_ELEVATED&&vol>500000) {
    sig='DEEP OVERSOLD REAL 📉';sc='#f87171';dir='LONG';prob=82;
    desc=`RSI REAL ${rsi.toFixed(0)} oversold + FR ok = mean reversion`;tags=['OVERSOLD','REAL'];
  } else if (oi>100e6&&Math.abs(c24)<2&&vol>2e6&&frPct<FR_ELEVATED) {
    sig='SMART ACCUMULATION 🤫';sc='#a78bfa';dir='LONG';prob=83;
    desc=`OI $${(oi/1e9).toFixed(2)}B + flat + FR ${frPct.toFixed(4)}% = institusi akumulasi`;tags=['ACCUM','WHALE'];
  } else if (isCoiling&&atrPct>0&&atrPct<3&&frPct<FR_ELEVATED&&vol>500000&&oi>MIN_OI_WATCH) {
    sig='PRE-BREAKOUT COIL ⚡';sc='#fbbf24';dir='LONG';prob=78;
    desc=`ATR ${atrPct.toFixed(2)}% compressed = energi terkumpul`;tags=['COIL'];
  } else if (obvBull&&c24<-0.5&&rsi<45&&vol>500000) {
    sig='OBV DIVERGENCE 📊';sc='#6ee7b7';dir='LONG';prob=79;
    desc=`Volume beli dominan saat harga turun = SM akumulasi`;tags=['OBV_DIV'];
  } else if (rs>5&&c24>(btcC||0)+4&&vol>2e6&&rsi<72) {
    sig='NARRATIVE MOMENTUM 📡';sc='#c084fc';dir='LONG';prob=81;
    desc=`RS +${rs.toFixed(1)}% vs BTC = catalyst aktif`;tags=['RS_STRONG'];
  } else if (c24>3&&rsi>=42&&rsi<=67&&vol>2e6&&frPct<FR_ELEVATED) {
    sig='MOMENTUM BREAKOUT 🚀';sc='#22c55e';dir='LONG';prob=78;
    desc=`+${c24.toFixed(1)}% + RSI ${rsi.toFixed(0)} sehat`;tags=['MOMENTUM'];
  } else if (!rsiReal&&rsi<30&&frPct<FR_NEUTRAL&&vol>1e6&&oi>MIN_OI_WATCH) {
    sig='OVERSOLD ZONE~';sc='#fb923c';dir='LONG';prob=70;
    desc=`RSI ~${rsi.toFixed(0)} oversold est + FR ${frPct.toFixed(4)}%`;tags=['OVERSOLD'];
  } else if (rsi>=38&&rsi<=63&&c24>0.2&&frPct<FR_ELEVATED&&vol>1e6) {
    sig='MILD BULL 📈';sc='#86efac';dir='LONG';prob=63;
    desc=`RSI ${rsi.toFixed(0)} + +${c24.toFixed(1)}% + FR ${frPct.toFixed(4)}% ok`;tags=['MILD'];
  } else if (rsi>80&&frPct>FR_HOT&&c24>8&&vol>3e6) {
    sig='BLOW-OFF TOP 🔴';sc='#dc2626';dir='SHORT';prob=89;
    desc=`RSI ${rsi.toFixed(0)} + FR +${frPct.toFixed(4)}% = DISTRIBUSI`;tags=['TOP'];
  } else if (rsi>73&&frPct>FR_ELEVATED&&c24>4&&vol>2e6) {
    sig='BULL TRAP ⚠️';sc='#ef4444';dir='SHORT';prob=73;
    desc=`RSI ${rsi.toFixed(0)} OB + FR +${frPct.toFixed(4)}%`;tags=['OVERBOUGHT'];
  } else if ((retailLong||50)>=67&&rsi>62&&vol>2e6) {
    sig='RETAIL TRAP 🚨';sc='#f97316';dir='SHORT';prob=75;
    desc=`${retailLong||50}% retail LONG = SM akan dump`;tags=['RETAIL_TRAP'];
  }
  return mk(sig,sc,desc,dir,prob,tags);
}
function mk(s,c,d,dir,p,t){return{signal:s,signalColor:c,signalDesc:d,direction:dir,probability:p,signalTags:t};}

// ─── CONVERGENCE SCORE ────────────────────────────────────────────
function convScore(coin) {
  const{rsi,frPct,c24,vol,oi,obvBull,isCoiling,retailLong,oiChg,rsiReal,atrPct}=coin;
  if (vol<MIN_VOL_MAP) return {score:10,label:'WEAK'};
  let raw=42;
  raw+=vol>=50e6?10:vol>=10e6?7:vol>=3e6?5:vol>=1e6?3:vol>=500000?1:-3;
  raw+=oi>=2e9?10:oi>=500e6?7:oi>=100e6?5:oi>=30e6?3:oi>=10e6?1:oi<3e6?-4:0;
  const rB=rsiReal?3:0;
  raw+=rB+(rsi<22?16:rsi<28?11:rsi<35?7:rsi<42?3:rsi<55?0:rsi>80?-18:rsi>73?-11:rsi>65?-5:0);
  raw+=frPct<FR_EXTREME?32:frPct<FR_SQUEEZE?23:frPct<FR_NEG?15:frPct<FR_COOL?9:frPct<FR_NEUTRAL?5:frPct<FR_ELEVATED?1:frPct<FR_HOT?-6:frPct>=FR_HOT?-20:0;
  raw+=oiChg>5&&c24>1?10:oiChg<-5&&c24>1?6:oiChg>5&&c24<-1?-7:0;
  const rl=retailLong||50;
  raw+=rl<=32?15:rl<=40?8:rl>=68?-15:rl>=60?-7:0;
  raw+=c24>8?5:c24>3?2:c24>0?0:c24<-8?-5:c24<-3?-2:c24<0?-1:0;
  if (obvBull&&c24<0) raw+=10; else if (obvBull) raw+=4;
  if (isCoiling) raw+=8;
  if (atrPct>0&&atrPct<2&&isCoiling) raw+=4;
  const score=cl(Math.round(raw),0,100);
  return {score,label:score>=83?'ELITE':score>=73?'PRIME':score>=63?'VALID':score>=52?'MOD':'WEAK'};
}

// ─── WHALE DETECTION ──────────────────────────────────────────────
function detectWhale(coin) {
  const{c24,vol,frPct,oi,rsi,pip,obvBull,atrPct,isCoiling}=coin;
  if (oi<MIN_OI_WHALE) return {score:0,level:null,signals:[],tags:[]};
  let score=0;const sigs=[],tags=[];
  if (oi>200e6&&frPct<FR_NEUTRAL&&Math.abs(c24)<2&&vol>2e6){score+=28;sigs.push(`OI $${(oi/1e9).toFixed(2)}B + FR flat = STEALTH ACCUM`);tags.push('STEALTH');}
  else if (oi>50e6&&frPct<FR_NEUTRAL&&Math.abs(c24)<3&&vol>1e6){score+=16;sigs.push(`OI $${(oi/1e6).toFixed(0)}M + FR ${frPct.toFixed(4)}% = SM kumpul`);tags.push('ACCUM');}
  const volOI=oi>0?vol/oi:0;
  if (vol>20e6&&Math.abs(c24)<2&&volOI>0.1&&oi>30e6){score+=20;sigs.push(`Vol/OI ABSORPTION`);tags.push('ABSORB');}
  if (obvBull&&c24<-1&&rsi<45){score+=18;sigs.push(`OBV bull saat harga turun = hidden accum`);tags.push('OBV');}
  if (frPct<FR_SQUEEZE){score+=28;sigs.push(`FR ${frPct.toFixed(4)}% EXTREME = pompa segera`);tags.push('SQUEEZE');}
  else if (frPct<FR_NEG){score+=15;sigs.push(`FR ${frPct.toFixed(4)}% negatif`);tags.push('NEG_FR');}
  else if (frPct<FR_COOL){score+=7;sigs.push(`FR ${frPct.toFixed(4)}% di bawah neutral`);}
  if (rsi<28&&oi>100e6){score+=22;sigs.push(`RSI ${rsi.toFixed(0)} oversold + OI besar = BOTTOM`);tags.push('BOTTOM');}
  else if (rsi<35&&oi>30e6){score+=12;sigs.push(`RSI ${rsi.toFixed(0)} + OI $${(oi/1e6).toFixed(0)}M`);}
  if (pip<22&&oi>100e6){score+=14;sigs.push(`Pip ${pip.toFixed(0)}% di discount zone`);tags.push('DISCOUNT');}
  if (isCoiling&&atrPct>0&&atrPct<2.5&&oi>80e6){score+=16;sigs.push(`ATR compressed = energi terkumpul`);tags.push('COIL');}
  score=cl(score,0,100);
  const level=score>=55?'🐳 MEGA WHALE':score>=38?'🐋 WHALE':score>=22?'🔍 SMART MONEY':null;
  return {score,level,signals:sigs.slice(0,4),tags};
}

// ─── FUTURES INTEL ────────────────────────────────────────────────
function analyzeFut(coin) {
  const{frPct,oi,rsi,c24,vol,retailLong,oiChg}=coin;
  if (oi<MIN_OI_FUT) return {score:0,state:'—',stateColor:'gray',signals:[],opportunity:null,frPct:0,oiB:0};
  let score=0;const sigs=[];let state='NEUTRAL',stateColor='gray',opp=null;
  if (oiChg>3&&c24>1){state='NEW LONGS';stateColor='green';score+=16;sigs.push(`OI +${oiChg.toFixed(1)}% + harga naik`);opp='LONG_ENTRY';}
  else if (oiChg>3&&c24<-1){state='NEW SHORTS';stateColor='red';score-=12;sigs.push(`OI up + harga turun`);opp='WAIT';}
  else if (oiChg<-3&&c24>1){state='SHORT SQUEEZE';stateColor='cyan';score+=14;sigs.push(`Short cover paksa`);opp='MOMENTUM';}
  else if (oiChg<-3&&c24<-1){state='LONG LIQ';stateColor='orange';score-=5;sigs.push(`Long liquidasi`);opp=rsi<30?'DCA_ZONE':'WAIT';}
  if (frPct<FR_EXTREME){score+=30;sigs.push(`FR ${frPct.toFixed(4)}% EXTREME SQUEEZE`);opp='SQUEEZE_PLAY';}
  else if (frPct<FR_SQUEEZE){score+=20;sigs.push(`FR ${frPct.toFixed(4)}% reversal segera`);}
  else if (frPct<FR_NEG){score+=12;sigs.push(`FR ${frPct.toFixed(4)}% negatif`);}
  else if (frPct<FR_COOL){score+=6;}
  else if (frPct>FR_HOT){score-=24;sigs.push(`FR +${frPct.toFixed(4)}% OVERHEATED`);opp='SHORT_SETUP';}
  else if (frPct>FR_ELEVATED){score-=13;sigs.push(`FR +${frPct.toFixed(4)}% elevated`);}
  const rl=retailLong||50;
  if (rl<=32){score+=22;sigs.push(`${100-rl}% retail SHORT = squeeze`);opp=opp||'SQUEEZE_PLAY';}
  else if (rl<=40){score+=10;}
  else if (rl>=68){score-=18;sigs.push(`${rl}% retail LONG = SM jual`);opp=opp||'SHORT_SETUP';}
  return {score:cl(score,-60,100),state,stateColor,signals:sigs.slice(0,4),opportunity:opp,frPct:+frPct.toFixed(5),oiB:+(oi/1e9).toFixed(3)};
}

// ─── ATR LEVELS ───────────────────────────────────────────────────
function buildLevels(price,dir,atrPct,prob) {
  const hasReal=atrPct>0;
  const a=hasReal?atrPct:(price>10000?2.0:price>1000?2.3:price>10?2.8:price>1?3.2:4.0);
  const slP=+(a*1.3).toFixed(2),t1P=+(a*1.9).toFixed(2),t2P=+(a*3.3).toFixed(2),t3P=+(a*5.5).toFixed(2);
  const rr=+(t2P/slP).toFixed(1);
  const w=cl(prob/100,0.1,0.95);
  const kelly=+(Math.max(0.5,Math.min(8,((w*rr-(1-w))/rr)/2*100)).toFixed(1));
  const fmt=p=>p>1000?p.toFixed(2):p>1?p.toFixed(4):p>0.001?p.toFixed(6):p.toFixed(8);
  if (dir==='LONG') return {sl:+fmt(price*(1-slP/100)),tp1:+fmt(price*(1+t1P/100)),tp2:+fmt(price*(1+t2P/100)),tp3:+fmt(price*(1+t3P/100)),slPct:slP,tp1Pct:t1P,tp2Pct:t2P,tp3Pct:t3P,rr,kellySizePct:kelly,realATR:hasReal};
  return {sl:+fmt(price*(1+slP/100)),tp1:+fmt(price*(1-t1P/100)),tp2:+fmt(price*(1-t2P/100)),tp3:+fmt(price*(1-t3P/100)),slPct:slP,tp1Pct:t1P,tp2Pct:t2P,tp3Pct:t3P,rr,kellySizePct:kelly,realATR:hasReal};
}

// ─── CACHE ────────────────────────────────────────────────────────
const CACHE = {d:null,t:0,prevOI:{}};

// ─── MAIN HANDLER ─────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Cache-Control','no-store');
  if (req.method==='OPTIONS') return res.status(200).end();
  const t0=Date.now();

  // Cache valid hanya jika ada real RSI
  if (CACHE.d&&(t0-CACHE.t)<90000&&(CACHE.d.dataQuality?.realRSI||0)>=15) {
    return res.status(200).json({...CACHE.d,cached:true,elapsed:Date.now()-t0});
  }

  try {
    // ── PHASE 1: PARALLEL MEGA-FETCH ─────────────────────────────
    // CoinGecko page 1+2 (500 coins) + MEXC + Bybit FR + CC RSI + F&G + BTC L/S
    const ccRSIFetches = CC35.map(s =>
      sf(`https://min-api.cryptocompare.com/data/v2/histohour?fsym=${s}&tsym=USD&limit=42&aggregate=4&e=CCCAGG`,4500)
    );

    const [cgR1,cgR2,mxR,byLinR,fgR,btcLSR,...ccRSIRes] = await Promise.allSettled([
      sf('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=volume_desc&per_page=250&page=1&sparkline=false&price_change_percentage=24h',5500),
      sf('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=volume_desc&per_page=250&page=2&sparkline=false&price_change_percentage=24h',5500),
      sf('https://api.mexc.com/api/v3/ticker/24hr',5000),
      sf('https://api.bybit.com/v5/market/tickers?category=linear',5000),
      sf('https://alternative.me/crypto/fear-and-greed-index/?format=json&limit=1',4000),
      sf('https://api.bybit.com/v5/market/account-ratio?category=linear&symbol=BTCUSDT&period=1h&limit=1',3500),
      ...ccRSIFetches,
    ]);

    // ── PHASE 2: BUILD COIN MAP ────────────────────────────────────
    const cm={};
    const prevOI=CACHE.prevOI||{};

    // CoinGecko data (primary: price, volume, 24h change, rank)
    for (const pgR of [cgR1,cgR2]) {
      try {
        for (const c of A(pgR.value)) {
          const sym=String(c.symbol||'').toUpperCase();
          if (!sym||isBad(sym)||!N(c.current_price)) continue;
          const p=N(c.current_price),v=N(c.total_volume);
          if (p<=0||v<MIN_VOL_MAP) continue;
          const c24=N(c.price_change_percentage_24h);
          const hi=N(c.high_24h||p*1.02),lo=N(c.low_24h||p*0.98);
          const pip=hi>lo?cl((p-lo)/(hi-lo)*100,0,100):50;
          cm[sym]={p,c24,v,h:hi,l:lo,pip,fr:FR_NEUTRAL/100,frPct:FR_NEUTRAL,oi:0,oiChg:0,rLong:50,rShort:50,mcap:N(c.market_cap),rank:N(c.market_cap_rank,9999),src:'cg'};
        }
      } catch {}
    }

    // MEXC (additional coins not in CG)
    try {
      for (const t of A(mxR.value||[])) {
        if (!String(t.symbol||'').endsWith('USDT')) continue;
        const s=String(t.symbol).replace('USDT','');
        if (isBad(s)||cm[s]) continue;
        const p=N(t.lastPrice);if(p<=0) continue;
        const v=N(t.quoteVolume);if(v<MIN_VOL_MAP) continue;
        const c24=N(t.priceChangePercent);
        const hi=N(t.highPrice||p*1.02),lo=N(t.lowPrice||p*0.98);
        const pip=hi>lo?cl((p-lo)/(hi-lo)*100,0,100):50;
        cm[s]={p,c24,v,h:hi,l:lo,pip,fr:FR_NEUTRAL/100,frPct:FR_NEUTRAL,oi:0,oiChg:0,rLong:50,rShort:50,mcap:0,rank:9999,src:'mx'};
      }
    } catch {}

    // Bybit FR+OI overlay (enhances existing entries, doesn't add new ones if volume too low)
    const currentOI={};
    try {
      for (const t of A(byLinR.value?.result?.list)) {
        if (!String(t.symbol||'').endsWith('USDT')) continue;
        const s=String(t.symbol).replace('USDT','');
        if (!cm[s]) {
          // Add from Bybit if not already in map and has sufficient volume
          const p=N(t.lastPrice);if(p<=0) continue;
          const v=N(t.turnover24h);if(v<MIN_VOL_MAP) continue;
          const c24=N(t.prevPrice24h||p);const ch24=c24>0?+(p-c24)/c24*100:0;
          const hi=N(t.highPrice24h||p*1.02),lo=N(t.lowPrice24h||p*0.98);
          const pip=hi>lo?cl((p-lo)/(hi-lo)*100,0,100):50;
          cm[s]={p,c24:ch24,v,h:hi,l:lo,pip,mcap:0,rank:9999,src:'bybit'};
        }
        // Overlay FR + OI
        const oi=N(t.openInterestValue);
        const fr=N(t.fundingRate);
        const frPct=+(fr*100).toFixed(5);
        const prevOiV=prevOI[s]||0;
        const oiChg=prevOiV>0?+((oi-prevOiV)/prevOiV*100).toFixed(2):0;
        const b1=N(t.bid1Size),a1=N(t.ask1Size);
        const baSide=b1+a1>0?b1/(b1+a1):0.5;
        const frBias=frPct<0?-15:frPct<FR_COOL?-5:frPct>FR_ELEVATED?10:0;
        const rLong=cl(Math.round(50+(baSide-0.5)*20+frBias),28,72);
        if (cm[s]) {
          cm[s].fr=fr;cm[s].frPct=frPct;cm[s].oi=oi;cm[s].oiChg=oiChg;
          cm[s].rLong=rLong;cm[s].rShort=100-rLong;cm[s].src=cm[s].src||'bybit';
        }
        currentOI[s]=oi;
      }
    } catch {}

    // ── PHASE 3: CC RSI FOR 35 COINS ────────────────────────────
    const kMap={};
    let realRSIC=0;
    for (let i=0;i<CC35.length;i++) {
      try {
        const r=ccRSIRes[i];
        if (r?.status!=='fulfilled'||r.value?.Response!=='Success') continue;
        const rows=A(r.value?.Data?.Data);if(rows.length<16) continue;
        const K=rows.filter(d=>N(d.close)>0&&N(d.close)<1e10)
          .map(d=>({t:N(d.time),o:N(d.open),h:N(d.high),l:N(d.low),c:N(d.close),v:N(d.volumeto)}));
        if (K.length<16) continue;
        const cls=K.map(k=>k.c);
        const rsiV=rsi14(cls);if(rsiV===null) continue;
        const macdV=macdCalc(cls);
        const e200=ema(cls,Math.min(200,cls.length));
        const e9=ema(cls,9),e21=ema(cls,21);
        const lp=cls[cls.length-1];
        const atrV=atrCalc(K);
        const atrPct=lp>0?+(atrV/lp*100).toFixed(3):0;
        let obvUp=0,obvDn=0;
        for (let j=Math.max(1,K.length-20);j<K.length;j++){
          if(K[j].c>K[j-1].c) obvUp+=K[j].v;else if(K[j].c<K[j-1].c) obvDn+=K[j].v;
        }
        const atr5=K.length>=7?atrCalc(K.slice(-6),5):atrV;
        const atr20=K.length>=22?atrCalc(K.slice(-21),14):atrV;
        const isCoiling=atr5>0&&atr20>0&&atr5<atr20*0.65;
        const recent=cls.slice(-20);
        kMap[CC35[i]]={
          rsi:+rsiV.toFixed(2),macd:macdV,atr:+atrV.toFixed(10),atrPct,
          obvBull:obvDn>0?obvUp>obvDn*1.1:obvUp>0,isCoiling,
          aboveE200:lp>e200,e200,e9,e21,
          highR:Math.max(...recent),lowR:Math.min(...recent),ok:true,
        };
        realRSIC++;
      } catch {}
    }

    // F&G
    let fg=50,fgLabel='Neutral';
    try {
      const fd=fgR.value?.data?.[0];
      if(fd){fg=N(fd.value,50);fgLabel=fd.value_classification||'Neutral';}
    } catch {}

    // BTC L/S
    let btcLS=null,btcLongPct=null,btcShortPct=null;
    try {
      const row=A(btcLSR.value?.result?.list)[0];
      if(row){
        btcLongPct=+(N(row.buyRatio)*100).toFixed(2);
        btcShortPct=+(N(row.sellRatio)*100).toFixed(2);
        btcLS=btcShortPct>0?+(btcLongPct/btcShortPct).toFixed(3):null;
      }
    } catch {}

    // ── PHASE 4: PROCESS ALL COINS ─────────────────────────────
    const btcRaw=cm['BTC']||{};
    const btcKd=kMap['BTC']||null;
    const btcP=N(btcRaw.p);
    const btcC24=N(btcRaw.c24);

    const coins=[];
    for (const [sym,raw] of Object.entries(cm)) {
      try {
        if (!sym||!raw.p||raw.p<=0) continue;
        const kd=kMap[sym]||null;
        const rsiReal=!!(kd?.ok);
        let rsi;
        if (rsiReal) {
          rsi=kd.rsi;
        } else {
          const frEff=(raw.frPct-FR_NEUTRAL)*(-200);
          const ch24E=raw.c24*2.8;
          const pipE=(raw.pip-50)*0.45;
          rsi=cl(Math.round(50+ch24E+pipE+frEff),10,90);
        }

        const atrPct=kd?.atrPct||0;
        const obvBull=kd?.obvBull||false;
        const isCoiling=kd?.isCoiling||false;
        const macdV=kd?.macd||null;
        const rs=+(raw.c24-btcC24).toFixed(2);

        const coinObj={
          sym,sector:getSector(sym),price:raw.p,c24:raw.c24,
          vol:raw.v,h:raw.h,l:raw.l,pip:raw.pip||50,
          fr:raw.fr||0,frPct:raw.frPct||FR_NEUTRAL,
          oi:raw.oi||0,oiChg:raw.oiChg||0,
          rsi,rsiReal,atrPct,obvBull,isCoiling,macd:macdV,
          retailLong:raw.rLong||50,retailShort:raw.rShort||50,
          rs,btcC:btcC24,src:raw.src,
        };

        const sigR=generateSignal(coinObj);
        const convR=convScore(coinObj);
        const whaleR=detectWhale(coinObj);
        const futR=analyzeFut(coinObj);
        const lvls=sigR.direction!=='WAIT'?buildLevels(raw.p,sigR.direction,atrPct,sigR.probability):null;

        const stars=[
          rsiReal&&rsi<30?1.5:rsiReal&&rsi<38?1:!rsiReal&&rsi<28?0.5:0,
          raw.frPct<FR_SQUEEZE?1.5:raw.frPct<FR_NEG?1:raw.frPct<FR_COOL?0.5:0,
          isCoiling?0.7:0,rs>4?0.5:rs>0?0.2:0,
          obvBull&&raw.c24<0?0.8:obvBull?0.3:0,
          whaleR.score>=30?1:whaleR.score>=18?0.5:0,
          convR.score>=80?0.5:0,
        ];
        const convStars=Math.min(5,+stars.reduce((s,v)=>s+v,0).toFixed(1));

        coins.push({
          sym,sector:getSector(sym),price:raw.p,c24:raw.c24,vol:raw.v,
          rsi:+rsi.toFixed(1),rsiReal,
          fr:raw.fr||0,frPct:raw.frPct||FR_NEUTRAL,
          oi:raw.oi||0,oiChg:raw.oiChg||0,pip:raw.pip||50,
          rs,atrPct,obvBull,isCoiling,macd:macdV,
          retailLong:raw.rLong||50,retailShort:raw.rShort||50,
          ...sigR,conv:convR,whale:whaleR,futures:futR,
          levels:lvls,convStars,src:raw.src,
          highR:kd?.highR||0,lowR:kd?.lowR||0,
        });
      } catch {}
    }
    coins.sort((a,b)=>b.conv.score-a.conv.score);
    const total=coins.length;

    // ── MARKET CHARACTER ─────────────────────────────────────────
    const osC=coins.filter(c=>c.rsi<30).length;
    const obC=coins.filter(c=>c.rsi>70).length;
    const longC=coins.filter(c=>c.direction==='LONG').length;
    const shortC=coins.filter(c=>c.direction==='SHORT').length;
    const bPct=total>0?longC/total:0.5;
    const whaleC=coins.filter(c=>c.whale.score>=22).length;
    const sqC=coins.filter(c=>c.frPct<FR_SQUEEZE&&c.oi>=MIN_OI_FUT).length;

    let mcType,mcColor,mcDesc,mcStrat,mcRisk,mcPos;
    const osPct=osC/Math.max(1,total),obPct=obC/Math.max(1,total);
    if (osPct>0.12){mcType='MASS OVERSOLD';mcColor='cyan';mcDesc=`${osC} koin RSI<30 = DCA historis. ${whaleC} whale aktif.`;mcStrat='DCA Agresif';mcRisk='MODERATE';mcPos='50-75%';}
    else if (obPct>0.18){mcType='MASS OVERBOUGHT';mcColor='red';mcDesc=`${obC} koin RSI>70. Distribusi massal.`;mcStrat='Cash+Short';mcRisk='HIGH';mcPos='25%';}
    else if (bPct>0.60){mcType='BULLISH';mcColor='green';mcDesc=`${Math.round(bPct*100)}% koin bullish. ${sqC} squeeze aktif.`;mcStrat='Aggressive Long';mcRisk='STANDARD';mcPos='100%';}
    else if (bPct<0.28){mcType='BEARISH';mcColor='red';mcDesc=`Majority bearish. ${longC}/${total} koin bullish.`;mcStrat='Cash or Short';mcRisk='HIGH';mcPos='25%';}
    else {mcType='TRANSITIONAL';mcColor='amber';mcDesc=`Mixed. ${Math.round(bPct*100)}% bullish. ${whaleC} whale. ${sqC} squeeze.`;mcStrat='Cautious Selective';mcRisk='REDUCED';mcPos='50%';}

    // ── CONVERGENCE ───────────────────────────────────────────────
    const longs=coins.filter(c=>c.direction==='LONG'&&c.conv.score>=52).slice(0,40);
    const shorts=coins.filter(c=>c.direction==='SHORT'&&c.conv.score>=50).slice(0,12);
    const flys=coins.filter(c=>c.signal&&(c.signal.includes('FLY')||c.signal.includes('CAPITULATION')||c.signal.includes('SQUEEZE INCOMING')||c.signal.includes('WHALE FINGERPRINT'))).slice(0,8);
    const accums=coins.filter(c=>c.signal&&(c.signal.includes('ACCUM')||c.signal.includes('PRE-BREAKOUT')||c.signal.includes('OBV DIVERGENCE'))).slice(0,8);

    // ── WHALE RADAR ───────────────────────────────────────────────
    const whaleRadar=coins.filter(c=>c.whale.score>=22&&c.oi>=MIN_OI_WHALE).sort((a,b)=>b.whale.score-a.whale.score).slice(0,15).map(c=>({sym:c.sym,price:c.price,c24:c.c24,vol:c.vol,rsi:c.rsi,rsiReal:c.rsiReal,fr:c.frPct,oi:c.oi,whaleScore:c.whale.score,whaleLevel:c.whale.level,whaleSigs:c.whale.signals,whaleTags:c.whale.tags,conv:c.conv.score,signal:c.signal,sector:c.sector}));
    const whaleFingerprint=coins.filter(c=>c.oi>=150e6&&c.frPct<FR_NEUTRAL&&Math.abs(c.c24)<3&&c.vol>2e6).sort((a,b)=>a.frPct-b.frPct).slice(0,8).map(c=>({sym:c.sym,price:c.price,c24:c.c24,rsi:c.rsi,fr:c.frPct,oi:c.oi,vol:c.vol,rating:c.frPct<FR_SQUEEZE?'STRONG':c.frPct<FR_NEG?'GOOD':'WATCH'}));
    const squeezeRadar=coins.filter(c=>c.frPct<FR_SQUEEZE&&c.vol>1e6&&c.rsi<60&&c.oi>=MIN_OI_FUT).sort((a,b)=>a.frPct-b.frPct).slice(0,10).map(c=>({sym:c.sym,price:c.price,c24:c.c24,rsi:c.rsi,fr:c.frPct,oi:c.oi,retailLong:c.retailLong,retailShort:c.retailShort,strength:c.frPct<FR_EXTREME?'EXTREME':c.frPct<FR_NEG?'STRONG':'HIGH'}));

    // ── FUTURES INTEL ─────────────────────────────────────────────
    const futSqueeze=coins.filter(c=>c.frPct<FR_SQUEEZE&&c.vol>1e6&&c.oi>=MIN_OI_FUT).sort((a,b)=>a.frPct-b.frPct).slice(0,12).map(c=>({sym:c.sym,price:c.price,c24:c.c24,frPct:c.frPct,oi:c.oi,rsi:c.rsi,retailLong:c.retailLong,retailShort:c.retailShort,futuresState:c.futures.state,futuresScore:c.futures.score,opportunity:c.futures.opportunity,conv:c.conv.score,signal:c.signal}));
    const futOB=coins.filter(c=>c.frPct>FR_ELEVATED&&c.rsi>65&&c.vol>2e6&&c.oi>=MIN_OI_FUT).sort((a,b)=>b.frPct-a.frPct).slice(0,8).map(c=>({sym:c.sym,price:c.price,c24:c.c24,frPct:c.frPct,rsi:c.rsi,retailLong:c.retailLong}));
    const retailTrap=coins.filter(c=>(c.retailLong||50)>=63&&c.rsi>58&&c.vol>2e6&&c.oi>=MIN_OI_FUT).sort((a,b)=>b.retailLong-a.retailLong).slice(0,8).map(c=>({sym:c.sym,price:c.price,c24:c.c24,retailLong:c.retailLong,rsi:c.rsi}));
    const retailSqueeze=coins.filter(c=>(c.retailLong||50)<=37&&c.rsi<52&&c.vol>2e6&&c.oi>=MIN_OI_FUT).sort((a,b)=>a.retailLong-b.retailLong).slice(0,8).map(c=>({sym:c.sym,price:c.price,c24:c.c24,retailLong:c.retailLong,retailShort:c.retailShort,rsi:c.rsi}));

    // ── GOLDEN OPPS ───────────────────────────────────────────────
    const stealthVol=coins.filter(c=>c.vol>5e6&&Math.abs(c.c24)<2&&c.oi>=MIN_OI_FUT&&c.rsi<65).sort((a,b)=>b.vol-a.vol).slice(0,8).map(c=>({sym:c.sym,price:c.price,c24:c.c24,vol:c.vol,rsi:c.rsi,oi:c.oi,fr:c.frPct}));
    const hiddenGems=coins.filter(c=>c.rsi<35&&c.frPct<FR_ELEVATED&&c.vol>300000&&c.conv.score>=50&&c.oi>=MIN_OI_WATCH&&!['BTC','ETH','BNB','SOL','XRP','ADA','DOGE'].includes(c.sym)).sort((a,b)=>a.rsi-b.rsi).slice(0,12).map(c=>({sym:c.sym,price:c.price,c24:c.c24,rsi:c.rsi,fr:c.frPct,vol:c.vol,conv:c.conv.score,rsiReal:c.rsiReal}));
    const momentumShift=coins.filter(c=>c.c24>2&&c.rs>4&&c.vol>2e6&&c.rsi<72&&c.sym!=='BTC').sort((a,b)=>b.rs-a.rs).slice(0,8).map(c=>({sym:c.sym,price:c.price,c24:c.c24,rsi:c.rsi,vol:c.vol,rs:c.rs,outperformBTC:+(c.rs).toFixed(2)}));

    // ── BTC SNAPSHOT ──────────────────────────────────────────────
    const btcSnap={
      price:btcP,ch24:btcC24,fg,fgLabel,
      rsi:btcKd?.rsi||null,rsiDir:'flat',
      atr:btcKd?.atr||0,atrPct:btcKd?.atrPct||0,
      macd:btcKd?.macd||null,aboveEma200:btcKd?.aboveE200||false,
      e200:btcKd?.e200||0,d1rsi:null,
      btcLS,btcLongPct,btcShortPct,
      resistance:btcKd?.highR?+(btcKd.highR*1.002).toFixed(0):null,
      support:btcKd?.lowR?+(btcKd.lowR*0.998).toFixed(0):null,
      current:btcP,
    };

    // ── SPOT ACCUMULATION ─────────────────────────────────────────
    const spotAccum=coins.filter(c=>c.rsi<42&&c.direction!=='SHORT'&&c.oi>=5e6&&c.vol>=500000).sort((a,b)=>{const sA=(a.rsiReal?10:0)+(a.oi>100e6?5:a.oi>30e6?3:0)+(42-a.rsi);const sB=(b.rsiReal?10:0)+(b.oi>100e6?5:b.oi>30e6?3:0)+(42-b.rsi);return sB-sA;}).slice(0,12).map(c=>{const dcaP=Math.max(c.atrPct||0,2.5);return{sym:c.sym,price:c.price,rsi:c.rsi,rsiReal:c.rsiReal,signal:c.signal||'OVERSOLD',atrPct:c.atrPct,fr:c.frPct,oi:c.oi,vol:c.vol,dcaZone:`$${+(c.price*(1-dcaP*1.5/100)).toFixed(c.price>1?2:8)} – $${+(c.price*(1-dcaP*0.3/100)).toFixed(c.price>1?2:8)}`,conv:c.conv.score,oversold:c.rsi<25?'EXTREME':c.rsi<30?'DEEP':'MODERATE'};});

    // ── GAME PLAN ─────────────────────────────────────────────────
    const gamePlan={
      btcLevels:{resistance:btcSnap.resistance,support:btcSnap.support,current:btcP},
      scenarios:{
        bull:{condition:`BTC tembus $${btcSnap.resistance||'?'} close di atas`,action:'Long conv 65+ RR 1:3',setups:longs.slice(0,3).map(c=>c.sym)},
        sideways:{condition:'BTC konsolidasi ±1.5%',action:'Scalp COILING+WHALE ACCUM'},
        bear:{condition:`BTC breakdown ke $${btcSnap.support||'?'}`,action:'Cash 80%. SHORT RSI 73+ FR overheated'},
      },
      scalpSetups:flys.slice(0,5).map(c=>({sym:c.sym,price:c.price,signal:c.signal,rsi:c.rsi,conv:c.conv.score,entry:c.price,rsiReal:c.rsiReal,...c.levels,fr:c.frPct,atrPct:c.atrPct,sector:c.sector,realATR:c.levels?.realATR||false})),
      swingSetups:longs.filter(c=>c.conv.score>=65).slice(0,5).map(c=>({sym:c.sym,price:c.price,signal:c.signal,rsi:c.rsi,conv:c.conv.score,entry:c.price,rsiReal:c.rsiReal,...c.levels,fr:c.frPct,atrPct:c.atrPct,sector:c.sector,realATR:c.levels?.realATR||false})),
      activeShorts:shorts.slice(0,5).map(c=>({sym:c.sym,price:c.price,signal:c.signal,rsi:c.rsi,fr:c.frPct,conv:c.conv.score,...c.levels})),
      spotAccum,
      avoidList:coins.filter(c=>c.rsi>78||c.frPct>FR_HOT).sort((a,b)=>b.rsi-a.rsi).slice(0,8).map(c=>({sym:c.sym,price:c.price,rsi:c.rsi,fr:c.frPct,reason:c.rsi>78?`RSI ${c.rsi.toFixed(0)} overbought`:`FR +${c.frPct}% overheated`})),
    };

    // ── SECTOR FLOW ───────────────────────────────────────────────
    const secMap={};
    for (const coin of coins) {
      if (coin.oi<MIN_OI_FLOW&&coin.vol<3e6) continue;
      const s=coin.sector||'Trending';
      if (!secMap[s]) secMap[s]={coins:[],ch24Sum:0,frSum:0,rsSum:0,osC:0,sigQ:0,totalOI:0,volSum:0};
      secMap[s].coins.push(coin);secMap[s].ch24Sum+=coin.c24;secMap[s].frSum+=coin.frPct||FR_NEUTRAL;secMap[s].rsSum+=coin.rs||0;
      if(coin.rsi<30) secMap[s].osC++;
      if(coin.signal&&coin.conv.score>=62) secMap[s].sigQ++;
      secMap[s].totalOI+=coin.oi||0;secMap[s].volSum+=coin.vol||0;
    }
    const sectorData={};
    const sectors=Object.entries(secMap).map(([name,d])=>{
      const n=Math.max(1,d.coins.length);
      const avgCh24=+(d.ch24Sum/n).toFixed(3);
      const frAvg=+(d.frSum/n).toFixed(5);
      const frDev=frAvg-FR_NEUTRAL;
      const rsAvg=+(d.rsSum/n).toFixed(2);
      const smScore=cl(Math.round(50+avgCh24*6+frDev*(-1500)+rsAvg*4+Math.min(20,d.osC*5)+Math.min(12,d.sigQ*4)),0,100);
      const flowSig=avgCh24>3?'STRONG INFLOW':avgCh24>1?'INFLOW':avgCh24<-3?'STRONG OUTFLOW':avgCh24<-1?'OUTFLOW':'NEUTRAL';
      const best=d.coins.filter(c=>c.signal&&c.direction==='LONG').sort((a,b)=>b.conv.score-a.conv.score)[0]||null;
      const sd={name,avgCh24,frAvg,rsAvg,osC:d.osC,smScore,sigQ:d.sigQ,flowSig,totalOI:d.totalOI,volSum:d.volSum,flyCoins:d.coins.filter(c=>c.signal&&(c.signal.includes('FLY')||c.signal.includes('WHALE'))).length,eliteCoins:d.coins.filter(c=>c.conv.score>=78).length,shortCoins:d.coins.filter(c=>c.direction==='SHORT').length,oversoldCoins:d.coins.filter(c=>c.rsi<30).length,best:best?{sym:best.sym,conv:best.conv.score,fr:best.frPct}:null,coins:d.coins.map(c=>({sym:c.sym,price:c.price,c24:c.c24,vol:c.vol,oi:c.oi,rsi:c.rsi,rsiReal:c.rsiReal,fr:c.frPct,signal:c.signal,signalColor:c.signalColor,direction:c.direction,probability:c.probability,conv:c.conv.score,rs:c.rs,obvBull:c.obvBull,isCoiling:c.isCoiling,levels:c.levels,retailLong:c.retailLong}))};
      sectorData[name]=sd;return sd;
    }).sort((a,b)=>b.smScore-a.smScore);

    // ── SESSIONS ──────────────────────────────────────────────────
    const now=new Date();
    const wibH=(now.getUTCHours()+7)%24;
    const days=['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];
    const sess=[
      {id:'dead',name:'Dead Zone',time:'02:00-06:00',start:2,end:6,q:'POOR',activity:'Volume sangat sepi. Skip entry.'},
      {id:'asia_open',name:'Asia Open',time:'06:00-09:00',start:6,end:9,q:'MODERATE',activity:'Volume mulai. Watch saja.'},
      {id:'asia_peak',name:'Asia Peak',time:'09:00-12:00',start:9,end:12,q:'GOOD',activity:'Volume Asia bagus. Entry selektif.'},
      {id:'lunch',name:'Lunch Break',time:'12:00-15:00',start:12,end:15,q:'CAUTION',activity:'Volume turun. Hindari entry baru.'},
      {id:'london',name:'London PRIME',time:'15:00-18:00',start:15,end:18,q:'PRIME',activity:'PRIME: Volume institusional tertinggi!'},
      {id:'ny_pre',name:'NY Pre',time:'18:00-21:00',start:18,end:21,q:'BUILDING',activity:'Build posisi sebelum NY Open.'},
      {id:'ny_open',name:'NY Open PRIME',time:'21:00-23:00',start:21,end:23,q:'PRIME',activity:'PRIME: Volatilitas terbesar!'},
      {id:'ny_late',name:'NY Late',time:'23:00-02:00',start:23,end:2,q:'GOOD',activity:'Volume masih oke. Swing ok.'},
    ];
    const csId=wibH>=2&&wibH<6?'dead':wibH>=6&&wibH<9?'asia_open':wibH>=9&&wibH<12?'asia_peak':wibH>=12&&wibH<15?'lunch':wibH>=15&&wibH<18?'london':wibH>=18&&wibH<21?'ny_pre':wibH>=21&&wibH<23?'ny_open':'ny_late';
    const cso=sess.find(s=>s.id===csId)||sess[0];
    const nxt=sess.filter(s=>s.q==='PRIME'&&s.id!==csId)[0]||null;

    // ── CHECKLIST ─────────────────────────────────────────────────
    const frHotC=coins.filter(c=>c.frPct>FR_ELEVATED&&c.oi>=MIN_OI_FUT).length;
    const liqC=coins.filter(c=>c.vol>5e6).length;
    const mkChecks=[
      {label:'Market character layak trading',pass:mcType!=='MASS OVERBOUGHT',detail:`Character: ${mcType}`,fix:'Hindari distribusi massal'},
      {label:'Trading session berkualitas',pass:cso.q==='PRIME'||cso.q==='GOOD'||cso.q==='BUILDING',detail:`${cso.name} (${cso.q})`,fix:'Tunggu PRIME/GOOD session'},
      {label:'BTC RSI tidak overbought',pass:btcKd?.rsi?btcKd.rsi<73:true,detail:btcKd?.rsi?`BTC RSI ${btcKd.rsi.toFixed(0)}`:'BTC ok',fix:'Tunggu BTC RSI <68'},
      {label:'FR market tidak overheated massal',pass:frHotC===0,detail:`${frHotC} koin FR>0.04%`,fix:'Hindari entry saat FR mahal'},
      {label:'Market tidak overbought massal',pass:obC<total*0.15,detail:`${obC}/${total} koin RSI>70`,fix:'Tunggu RSI reset'},
      {label:'BTC L/S ratio aman',pass:btcLS===null||btcLS>=0.75,detail:btcLS?`L/S: ${btcLongPct}/${btcShortPct}`:'Data tidak tersedia',fix:'Hindari retail terlalu long'},
      {label:'Liquidity cukup (vol>$5M)',pass:liqC>=8,detail:`${liqC} koin vol>$5M`,fix:'Tunggu London/NY Open'},
      {label:'BTC tidak dump tajam',pass:btcC24>-3,detail:`BTC ${btcC24.toFixed(2)}%`,fix:'Hindari altcoin saat BTC dump'},
    ];
    const passC=mkChecks.filter(x=>x.pass).length;

    // ── DAILY OPPORTUNITY ─────────────────────────────────────────
    let dos=50;
    if(fg<20)dos+=22;else if(fg<35)dos+=14;else if(fg>75)dos-=18;
    if(osC>25)dos+=20;else if(osC>15)dos+=13;else if(osC>8)dos+=7;
    if(cso.q==='PRIME')dos+=14;else if(cso.q==='GOOD')dos+=7;
    dos+=Math.min(12,sqC*2.5);dos+=Math.min(10,whaleC*2);
    dos+=Math.min(8,realRSIC>=25?8:realRSIC>=15?6:realRSIC>=8?4:2);
    dos=cl(Math.round(dos),5,98);
    const dosLabel=dos>=82?'EXTREME OPPORTUNITY':dos>=67?'HIGH OPPORTUNITY':dos>=52?'NORMAL':dos>=38?'LOW':'POOR DAY';
    const dosAction=dos>=82?'Hari langka! Full sizing PRIME/ELITE.':dos>=67?'Setup bagus. Conv 70+.':dos>=52?'Selektif. 3+ konfluens.':'Hindari entry baru.';

    // ── MARKET REGIME ─────────────────────────────────────────────
    const mvrvP=btcKd?.e200>0?+(btcP/btcKd.e200).toFixed(3):1.3;
    let regime,rCol,rDesc,rSize;
    if(fg<30&&osC/total>0.05){regime='ACCUMULATE';rCol='cyan';rDesc='Extreme Fear + oversold = akumulasi historis';rSize='DCA 25-50%';}
    else if(fg>=30&&fg<=65&&obC/total<0.12){regime='TRADE';rCol='green';rDesc='Seimbang = kondisi ideal trading';rSize='Full size, SL ketat';}
    else if(fg>65||mvrvP>1.9){regime='CAUTION';rCol='amber';rDesc='Market greedy. Kurangi size.';rSize='Max 0.5-1% risk';}
    else{regime='NORMAL';rCol='gray';rDesc='Kondisi biasa. Selektif.';rSize='Size normal';}

    // ── BEST TRADE ────────────────────────────────────────────────
    const btTrade=(()=>{
      const cands=coins.filter(c=>c.direction==='LONG'&&c.conv.score>=55&&c.oi>=MIN_OI_FUT).sort((a,b)=>{
        const sA=a.conv.score+(a.rsiReal?12:0)+(a.rsi<30?15:a.rsi<38?8:0)+(a.frPct<FR_SQUEEZE?14:a.frPct<FR_NEG?7:0)+(a.whale.score>=22?10:0)+(a.convStars||0)*2;
        const sB=b.conv.score+(b.rsiReal?12:0)+(b.rsi<30?15:b.rsi<38?8:0)+(b.frPct<FR_SQUEEZE?14:b.frPct<FR_NEG?7:0)+(b.whale.score>=22?10:0)+(b.convStars||0)*2;
        return sB-sA;
      });
      const top=cands[0]||null;if(!top)return null;
      const rsns=[];
      if(top.rsiReal&&top.rsi<38)rsns.push(`RSI REAL ${top.rsi.toFixed(1)} oversold`);
      if(top.frPct<FR_NEG)rsns.push(`FR ${top.frPct}% negatif`);
      if(top.whale.score>=22)rsns.push(top.whale.level||'Whale aktif');
      if(top.retailLong<=40)rsns.push(`${top.retailShort}% retail short = squeeze`);
      if(top.isCoiling)rsns.push('ATR compressed = coiling');
      if(top.conv.score>=78)rsns.push(`Convergence ${top.conv.label} ${top.conv.score}/100`);
      const kelly=top.levels?.kellySizePct||2; // Always a number
      return{sym:top.sym,price:top.price,signal:top.signal||'—',rsi:top.rsi,fr:top.frPct,conv:top.conv.score,convLabel:top.conv.label,convStars:top.convStars,whale:top.whale,futures:top.futures,mtfConfirmed:!!(top.rsiReal&&top.rsi<38),retailLong:top.retailLong,retailShort:top.retailShort,reasoning:rsns,...top.levels,rr:top.levels?.rr||2.3,probability:top.probability||70,kellySizing:kelly,oi:top.oi,vol:top.vol,sector:top.sector};
    })();

    // ── ASSEMBLE OUTPUT ───────────────────────────────────────────
    const out={
      ok:true,version:'v21.0',brand:'369 GLOBAL CRYPTO',ts:Date.now(),elapsed:Date.now()-t0,
      dataQuality:{coins:total,realRSI:realRSIC,bybitLinear:Object.values(cm).filter(c=>c.src==='bybit').length,cgCoins:Object.values(cm).filter(c=>c.src==='cg').length,mexcCoins:Object.values(cm).filter(c=>c.src==='mx').length,whaleSignals:whaleC,squeezeSignals:sqC,longCoins:longC,shortCoins:shortC,signalCoins:coins.filter(c=>c.signal&&c.signal.length>0).length},
      fg,fgLabel,
      marketCharacter:{type:mcType,color:mcColor,description:mcDesc,tradeStyle:mcStrat,riskLevel:mcRisk,positionSize:mcPos,marketPct:`${Math.round(bPct*100)}% bullish`,stats:{oversold:osC,overbought:obC,bullish:Math.round(bPct*100),whaleActive:whaleC,squeezeReady:sqC}},
      btcSnapshot:btcSnap,
      convergence:{leaders:longs.slice(0,12),longSetups:longs,shortSetups:shorts,flySetups:flys,accumSetups:accums,summary:`${longs.length} LONG · ${shorts.length} SHORT · ${flys.length} FLY · ${accums.length} ACCUM`,eliteCount:longs.filter(c=>c.conv.score>=83).length,primeCount:longs.filter(c=>c.conv.score>=73&&c.conv.score<83).length,validCount:longs.filter(c=>c.conv.score>=63&&c.conv.score<73).length},
      whaleRadar,whaleRadarSummary:`${whaleC} whale · ${stealthVol.length} stealth · ${whaleFingerprint.length} fingerprint`,
      futuresIntelligence:{squeezeSetups:futSqueeze,overboughtShorts:futOB,summary:`${futSqueeze.length} squeeze · ${futOB.length} short`,topSqueeze:futSqueeze[0]||null},
      gamePlan,
      sectorFlow:{sectors,sectorData},
      tradingSchedule:{wibHour:wibH,dayName:days[now.getUTCDay()],sessions:sess,currentSession:csId,currentSessionObj:cso,focusToday:cso.q==='PRIME'?`${cso.name} PRIME aktif!`:cso.q==='GOOD'?`${cso.name} kondisi bagus`:`Next PRIME: ${nxt?nxt.name+' ~'+((nxt.start>wibH?nxt.start-wibH:24-wibH+nxt.start))+'h':'-'}`,nextPrimeSession:nxt?{name:nxt.name,time:nxt.time,inH:(nxt.start>wibH?nxt.start-wibH:24-wibH+nxt.start)}:null},
      // FIXED: coinChecks as STRINGS (no more [object Object])
      // FIXED: marketTotal field added
      checklist:{
        marketChecks:mkChecks,
        coinChecks:['RSI koin <72','Conv Score 60+','FR <+0.04%','RR min 1:2.5','Volume >$2M USD','OI >$10M','Size max 2% equity','SL ATR-based real','Sesuai skenario Game Plan','No entry 30min sebelum news'],
        marketPassCount:passC,
        marketTotal:mkChecks.length, // FIXED: was missing in v20
        overallGreenLight:passC>=6,
        verdict:passC>=6?'KONDISI LAYAK TRADING':`HATI-HATI — ${8-passC} kondisi belum terpenuhi`,
      },
      stealthVolume:stealthVol,hiddenGems,momentumShift,
      retailTrapList:retailTrap,retailSqueezeList:retailSqueeze,
      dailyOpportunityScore:{score:dos,label:dosLabel,action:dosAction,fg,session:cso.q,osCoins:osC,squeezeCoins:sqC,whaleCoins:whaleC,signalCoins:coins.filter(c=>c.signal&&c.signal.length>0).length},
      marketRegime:{regime,regimeColor:rCol,regimeDesc:rDesc,sizingGuidance:rSize,fg,mvrv:mvrvP,osCoins:osC},
      todaysBestTrade:btTrade,
      whaleFingerprint,squeezeRadar,
    };

    if (realRSIC>=10) { CACHE.d=out;CACHE.t=Date.now();CACHE.prevOI=currentOI; }
    else { CACHE.prevOI=currentOI; }
    return res.status(200).json(out);

  } catch(e) {
    return res.status(200).json({ok:false,version:'v21.0',brand:'369 GLOBAL CRYPTO',error:String(e?.message||'Unknown'),ts:Date.now(),elapsed:Date.now()-t0,dataQuality:{coins:0,realRSI:0},fg:50,fgLabel:'Neutral',marketCharacter:{type:'ERROR',color:'gray',description:'Data tidak tersedia',tradeStyle:'Wait',riskLevel:'HIGH',positionSize:'0%',marketPct:'50% bullish',stats:{oversold:0,overbought:0,bullish:50,whaleActive:0,squeezeReady:0}},btcSnapshot:{price:0,ch24:0,rsi:null,fg:50,fgLabel:'Neutral',macd:null,resistance:null,support:null,current:0,aboveEma200:false,btcLS:null,btcLongPct:null,btcShortPct:null,d1rsi:null,rsiDir:'flat',atrPct:0,e200:0},convergence:{leaders:[],longSetups:[],shortSetups:[],flySetups:[],accumSetups:[],summary:'Error',eliteCount:0,primeCount:0,validCount:0},whaleRadar:[],whaleRadarSummary:'—',futuresIntelligence:{squeezeSetups:[],overboughtShorts:[],summary:'—',topSqueeze:null},gamePlan:{btcLevels:{resistance:null,support:null,current:0},scenarios:{bull:{condition:'-',action:'-'},sideways:{condition:'-',action:'-'},bear:{condition:'-',action:'-'}},scalpSetups:[],swingSetups:[],activeShorts:[],spotAccum:[],avoidList:[]},sectorFlow:{sectors:[],sectorData:{}},tradingSchedule:{wibHour:0,dayName:'-',sessions:[],currentSession:'dead',currentSessionObj:{id:'dead',name:'Dead Zone',q:'POOR',activity:'-'},focusToday:'-',nextPrimeSession:null},checklist:{marketChecks:[],coinChecks:[],marketPassCount:0,marketTotal:8,overallGreenLight:false,verdict:'Error'},stealthVolume:[],hiddenGems:[],momentumShift:[],retailTrapList:[],retailSqueezeList:[],dailyOpportunityScore:{score:50,label:'NORMAL',action:'-'},marketRegime:{regime:'NORMAL',regimeColor:'gray',regimeDesc:'-',sizingGuidance:'-'},todaysBestTrade:null,whaleFingerprint:[],squeezeRadar:[]});
  }
}
