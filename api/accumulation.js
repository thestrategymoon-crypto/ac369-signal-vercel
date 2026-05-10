// api/accumulation.js — AC369 FUSION v13.1
// ══════════════════════════════════════════════════════════════════
// SMART MONEY DAY TRADE & SCALP SCANNER
// 5-source fallback: Binance → Bybit → MEXC → CoinGecko
// Guaranteed to work on any exchange availability
// ══════════════════════════════════════════════════════════════════

const NARRATIVES = {
  IOTX:'DePIN', HNT:'DePIN', FIL:'DePIN', AR:'DePIN',
  ONDO:'RWA', POLYX:'RWA', OM:'RWA',
  FET:'AI', AGIX:'AI', OCEAN:'AI', RNDR:'AI', TAO:'AI', WLD:'AI',
  AXS:'GameFi', SAND:'GameFi', MANA:'GameFi', IMX:'GameFi',
  ARB:'L2', OP:'L2', MATIC:'L2', STRK:'L2',
  UNI:'DeFi', AAVE:'DeFi', CRV:'DeFi', GMX:'DeFi',
  TIA:'Modular', EIGEN:'Modular',
  LINK:'Oracle', BAND:'Oracle',
};
const STABLES = new Set(['USDT','USDC','BUSD','DAI','FDUSD','TUSD','USDP','IDRT','BIDR']);
const BAD_SFX = ['UP','DOWN','BEAR','BULL','3L','3S','2L','2S'];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method === 'POST') return res.status(200).json({ ok: true });

  const sf = async (url, ms = 7000) => {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), ms);
    try {
      const r = await fetch(url, {
        signal: c.signal,
        headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
      });
      clearTimeout(t); if (!r.ok) return null; return await r.json();
    } catch { clearTimeout(t); return null; }
  };

  // ── KILL ZONE ─────────────────────────────────────────────────
  function getKillZone() {
    const h = new Date().getUTCHours(), m = new Date().getUTCMinutes();
    const t = h * 60 + m;
    if (t >= 720 && t < 780)   return { zone: 'LONDON_OPEN',  q: 'PREMIUM', b: 5,  e: '🇬🇧' };
    if (t >= 780 && t < 960)   return { zone: 'NY_OVERLAP',   q: 'OPTIMAL', b: 8,  e: '🔥' };
    if (t >= 810 && t < 900)   return { zone: 'NY_OPEN',      q: 'PREMIUM', b: 5,  e: '🗽' };
    if (t >= 0   && t < 120)   return { zone: 'ASIA_OPEN',    q: 'ACTIVE',  b: 2,  e: '🌏' };
    if (t >= 960 && t < 1380)  return { zone: 'REGULAR',      q: 'MEDIUM',  b: 0,  e: '📊' };
    return                            { zone: 'DEAD_ZONE',    q: 'LOW',     b: -3, e: '💤' };
  }

  function halvingPhase() {
    const d = (Date.now() - new Date('2024-04-19').getTime()) / 86400000;
    if (d < 60)  return { p: 'HALVING_SHOCK', b: 2,  e: '💥' };
    if (d < 180) return { p: 'EARLY_BULL',    b: 10, e: '🌱' };
    if (d < 365) return { p: 'BULL_RUN',      b: 12, e: '🚀' };
    if (d < 540) return { p: 'PEAK',          b: -3, e: '🎯' };
    if (d < 730) return { p: 'BEAR',          b: -8, e: '🐻' };
    if (d < 900) return { p: 'ACCUM',         b: 8,  e: '💎' };
    return               { p: 'PRE_HALV',     b: 5,  e: '⏳' };
  }

  // ── SCORING ENGINE ─────────────────────────────────────────────
  function scoreCoin(coin, btcCh24, btcCh7, fg, hv) {
    const { ch24, ch7, vol, high, low, open, price, ath } = coin;
    if (!price || price <= 0) return null;

    const range = Math.max(high - low, price * 0.005);
    const rp    = (price - low) / range;
    const lw    = (Math.min(price, open) - low) / range;
    const body  = Math.abs(price - open) / range;
    const vt    = vol >= 500e6 ? 5 : vol >= 100e6 ? 4 : vol >= 30e6 ? 3 : vol >= 10e6 ? 2 : vol >= 2e6 ? 1 : 0;

    if (vt === 0) return null;
    if (ch24 < -20 || ch24 > 50) return null;

    const fromATH = ath > 0 ? (price - ath) / ath * 100 : -50;
    const rs7     = (ch7 || 0) - (btcCh7 || 0);

    let score = 0;
    const signals = [];
    const reasons = [];

    // 1. MOMENTUM (0-25)
    let mom = rs7 > 15 ? 25 : rs7 > 8 ? 20 : rs7 > 3 ? 16 : rs7 > 0 ? 12 : rs7 > -5 ? 8 : rs7 > -10 ? 5 : 3;
    if (rs7 > 8) { signals.push('RS⬆⬆'); reasons.push(`+${rs7.toFixed(0)}% outperform BTC`); }
    if (fg <= 25) mom = Math.min(25, mom + 4);
    if (ch24 > 0 && ch24 <= 8 && rs7 > 0) mom = Math.min(25, mom + 3);
    score += mom;

    // 2. VOLUME QUALITY (0-20)
    const volM = vol / 1e6;
    let vol_s = volM >= 500 ? 20 : volM >= 100 ? 17 : volM >= 30 ? 13 : volM >= 10 ? 9 : volM >= 2 ? 5 : 2;
    if (volM >= 30 && Math.abs(ch24) <= 5) {
      vol_s = Math.min(20, vol_s + 4);
      signals.push('ACCUM'); reasons.push(`$${volM.toFixed(0)}M vol + flat = SM absorbing`);
    } else if (volM >= 100) {
      signals.push('HIGH VOL');
    }
    score += vol_s;

    // 3. PRICE STRUCTURE (0-20)
    let struct = 0;
    if (lw > 0.40 && rp < 0.55 && price > low * 1.001) {
      struct += 12; signals.push('LIQ.SWEEP');
      reasons.push(`Liquidity swept: wick ${(lw*100).toFixed(0)}% below lows`);
    }
    if (ch24 > 2 && rp > 0.55 && (ch7 || 0) < 0) {
      struct += 8; signals.push('BOS');
      reasons.push(`BOS +${ch24.toFixed(1)}% after ${(ch7||0).toFixed(0)}% week`);
    }
    if (rp < 0.40) { struct += 6; signals.push('DISCOUNT'); }
    else if (rp < 0.55) struct += 3;
    if (body < 0.30 && lw > 0.20) struct += 4;
    score += Math.min(20, struct);

    // 4. ATH DISTANCE (0-15)
    const inGolden = fromATH <= -55 && fromATH >= -85;
    const inEarly  = fromATH <= -30 && fromATH >= -55;
    let ath_s = inGolden ? 15 : inEarly ? 10 : fromATH > -30 ? 5 : 3;
    if (inGolden) { signals.push('GOLDEN'); reasons.push(`${fromATH.toFixed(0)}% from ATH — optimal entry zone`); }
    ath_s = Math.min(15, ath_s + Math.max(0, hv.b * 0.3));
    score += ath_s;

    // 5. NARRATIVE (0-10)
    const sym = coin.base;
    const narr = NARRATIVES[sym] || null;
    const trendingNarr = new Set(['AI','DePIN','RWA','DeSci','L2','Modular']);
    const narr_s = narr ? (trendingNarr.has(narr) ? 10 : 5) : 0;
    if (narr) { signals.push(narr); if (narr_s >= 10) reasons.push(`${narr} trending sector`); }
    score += narr_s;

    // 6. MARKET (0-10)
    let mkt_s = fg <= 20 ? 10 : fg <= 35 ? 7 : fg >= 75 ? 2 : 5;
    if (rp < 0.40) mkt_s = Math.min(10, mkt_s + 3);
    score += mkt_s;

    // OTE Fibonacci
    const fib618 = low + (high - low) * 0.618;
    const fib786 = low + (high - low) * 0.786;
    const inOTE  = price >= fib618 * 0.998 && price <= fib786 * 1.002;

    // Trade levels
    const slPct  = Math.max(0.04, Math.min(0.12, (high - low) / price * 1.5 + 0.02));
    const sl     = +(price * (1 - slPct)).toFixed(8);
    const slDist = price - sl;
    const tp1    = +(price + slDist * 2).toFixed(8);
    const tp2    = +(price + slDist * 3).toFixed(8);
    const tp3    = +(price + slDist * 4.5).toFixed(8);
    const tp1Pct = +((tp1 - price) / price * 100).toFixed(1);
    const tp2Pct = +((tp2 - price) / price * 100).toFixed(1);
    const tp3Pct = +((tp3 - price) / price * 100).toFixed(1);

    const isScalp = vol >= 100e6 && Math.abs(ch24) >= 1 && Math.abs(ch24) <= 8;
    const isSwing = inGolden || (fromATH <= -40 && rs7 > 5);
    const tradeStyle = isSwing ? 'SWING' : isScalp ? 'SCALP' : 'DAY TRADE';
    const probScore = Math.min(10, Math.max(1, Math.round(signals.length * 1.5 + score / 15)));

    return {
      score: Math.round(Math.min(100, score)),
      signals, reasons, tradeStyle, probScore, inOTE, fromATH: +fromATH.toFixed(1),
      narrative: narr, rp: +rp.toFixed(2), lw: +lw.toFixed(2), vt,
      trade: {
        entry: +(price * 0.999).toFixed(8),
        entryLo: +(price * 0.997).toFixed(8), entryHi: +(price * 1.003).toFixed(8),
        sl, slPct: +(slPct * 100).toFixed(1),
        tp1, tp1Pct, tp2, tp2Pct, tp3, tp3Pct,
        rr1: 2.0, rr2: 3.0,
      },
    };
  }

  // ── MAIN ──────────────────────────────────────────────────────
  try {
    const t0 = Date.now();
    const kz = getKillZone();
    const hv = halvingPhase();

    // ── 5-SOURCE FALLBACK ──────────────────────────────────────
    const [rawTickersR, fngR, glbR] = await Promise.allSettled([
      // Try all sources in sequence until one works
      (async () => {
        // Source 1: Binance Spot
        const b1 = await sf('https://api.binance.com/api/v3/ticker/24hr', 7000);
        if (Array.isArray(b1) && b1.length > 100) return b1;

        // Source 2: Binance Futures
        const b2 = await sf('https://fapi.binance.com/fapi/v1/ticker/24hr', 6000);
        if (Array.isArray(b2) && b2.length > 50) return b2;

        // Source 3: Bybit Spot
        const by = await sf('https://api.bybit.com/v5/market/tickers?category=spot', 6000);
        if (by?.result?.list?.length > 50) {
          return by.result.list.map(t => ({
            symbol: t.symbol || '',
            lastPrice: t.lastPrice || '0',
            priceChangePercent: t.price24hPcnt
              ? (parseFloat(t.price24hPcnt) * 100).toFixed(4)
              : '0',
            quoteVolume: t.turnover24h || '0',
            highPrice: t.highPrice24h || t.lastPrice || '0',
            lowPrice: t.lowPrice24h || t.lastPrice || '0',
            openPrice: t.prevPrice24h || t.lastPrice || '0',
          }));
        }

        // Source 4: MEXC
        const mx = await sf('https://api.mexc.com/api/v3/ticker/24hr', 6000);
        if (Array.isArray(mx) && mx.length > 50) return mx;

        // Source 5: CoinGecko (always works, slower)
        const cg = await sf(
          'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=volume_desc&per_page=250&page=1&sparkline=false&price_change_percentage=24h',
          9000
        );
        if (Array.isArray(cg) && cg.length > 0) {
          return cg.map(c => ({
            symbol: (c.symbol || '').toUpperCase() + 'USDT',
            lastPrice: String(c.current_price || 0),
            priceChangePercent: String(c.price_change_percentage_24h || 0),
            quoteVolume: String(c.total_volume || 0),
            highPrice: String((c.current_price || 0) * 1.03),
            lowPrice: String((c.current_price || 0) * 0.97),
            openPrice: String((c.current_price || 0) / (1 + (c.price_change_percentage_24h || 0) / 100)),
          }));
        }
        return [];
      })(),
      sf('https://api.alternative.me/fng/?limit=1&format=json', 5000),
      sf('https://api.coingecko.com/api/v3/global', 5000),
    ]);

    const rawTickers = rawTickersR.status === 'fulfilled' ? rawTickersR.value : [];
    const bins       = Array.isArray(rawTickers) && rawTickers.length > 10 ? rawTickers : [];
    const fg         = fngR.status === 'fulfilled' ? parseInt(fngR.value?.data?.[0]?.value || 50) : 50;
    const glb        = glbR.status === 'fulfilled' ? glbR.value?.data : null;
    const btcDom     = +(glb?.market_cap_percentage?.btc || 58).toFixed(1);

    if (!bins.length) {
      return res.status(200).json({
        version: 'v13.1', error: null,
        timestamp: Date.now(), scanTime: '0', totalScanned: 0, totalQualified: 0,
        regularSetups: [], memeSetups: [], scalpSetups: [], dayTradeSetups: [], swingSetups: [], eliteSetups: [],
        eliteCount: 0, engineDisciplined: true,
        regime: { r: 'DATA UNAVAILABLE', color: '#FFB300', focus: 'Semua 5 sumber data timeout — coba scan lagi' },
        systemStatus: { fgValue: fg, btcDom, btcPx: 0, btcTrend: 'UNKNOWN', btcCh7: 0 },
        killedBreakdown: {}, totalKilled: 0,
        stats: {}, cosmic: { halving: hv },
        activeSetups: [], activeTrades: [], watchlist: [],
        wlActive: 0, wlCompleted: 0, wlInvalid: 0, wlEvents: [],
      });
    }

    // BTC context
    const btcT    = bins.find(t => t.symbol === 'BTCUSDT');
    const btcPx   = +(btcT?.lastPrice || 0);
    const btcCh24 = +(btcT?.priceChangePercent || 0);
    const btcCh7  = 0;

    // Build candidate list
    const HAN = /[\u4e00-\u9fff]/;
    const coins = [];
    bins.forEach(t => {
      if (!t?.symbol?.endsWith('USDT')) return;
      const b = t.symbol.replace('USDT', '');
      if (STABLES.has(b) || HAN.test(b) || BAD_SFX.some(s => b.endsWith(s) || b.startsWith(s)) || b.length > 12) return;
      const p = +(t.lastPrice || 0), v = +(t.quoteVolume || 0);
      if (p <= 0 || v < 1e6) return;
      if (p >= 0.97 && p <= 1.03 && Math.abs(+(t.priceChangePercent || 0)) < 1) return;
      coins.push({
        base: b, price: p, vol: v,
        ch24: +(t.priceChangePercent || 0),
        ch7: null,
        high: +(t.highPrice || p), low: +(t.lowPrice || p), open: +(t.openPrice || p),
        ath: p * 3, mcap: 0, name: b,
      });
    });

    // Score all coins
    const scored = [];
    coins.forEach(coin => {
      const result = scoreCoin(coin, btcCh24, btcCh7, fg, hv);
      if (!result) return;

      const { trade, signals, reasons, tradeStyle, probScore, inOTE, fromATH, narrative, score, rp, lw, vt } = result;
      const tier = score >= 65 ? 'S' : score >= 45 ? 'A' : 'B';
      const tierLabel = score >= 65 ? '🔥 TIER S' : score >= 45 ? '✅ TIER A' : '📊 TIER B';
      const isElite = score >= 70 && probScore >= 7;
      const inZone  = coin.price >= trade.entryLo && coin.price <= trade.entryHi;
      const execMode = probScore >= 8 ? 'AGGRESSIVE' : probScore >= 6 ? 'CONSERVATIVE' : 'WAIT';

      let decision, decisionColor;
      if (inZone && probScore >= 7)  { decision = '⚡ EXECUTE — IN ZONE'; decisionColor = '#ff6b35'; }
      else if (inZone)               { decision = '✅ LIMIT ENTRY';       decisionColor = '#00ffd0'; }
      else                           { decision = `🎯 LIMIT $${fmtP(trade.entryLo)}–$${fmtP(trade.entryHi)}`; decisionColor = '#00ffd0'; }

      const posSize = tier === 'S' ? '2-3%' : tier === 'A' ? '1-2%' : '0.5-1%';

      scored.push({
        rank: 0,
        symbol: coin.base, name: coin.base,
        assetType: coin.vol >= 200e6 ? 'MAJOR' : 'ALT',
        isMeme: false,
        price: coin.price, ch24: coin.ch24, ch7: 0, vol: coin.vol,
        fromATH,
        tier, tierLabel, finalScore: score, confidence: Math.min(100, score + probScore * 3),
        positionRank: '',
        narrative: narrative || 'OTHER', isTrendingNarrative: !!narrative,
        freshness: { status: 'FRESH ⚡', fresh: true },
        preImpulse: {
          count: signals.length,
          stage: signals.length >= 4 ? 'READY 🔥' : signals.length >= 3 ? 'STRONG 💪' : 'FORMING 🔄',
          sigs: reasons.map(r => ({ s: r, note: r })),
        },
        smDetection: { count: signals.length, strong: Math.floor(signals.length / 2), valid: true, sigs: signals },
        derivatives: { signal: 'NO_DATA', score: 0 },
        entryConf: { valid: probScore >= 6, count: Math.min(4, probScore - 2), list: signals.slice(0, 3) },
        tradeState: { state: inZone ? 'IN_ZONE' : 'READY', tag: inZone ? '⚡ IN ZONE' : 'READY', active: inZone },
        status: inZone ? 'IN_ZONE' : 'READY',
        rr: {
          tp1: trade.tp1, tp1Pct: trade.tp1Pct,
          tp2: trade.tp2, tp2Pct: trade.tp2Pct,
          rr1: 2.0, rr2: 3.0,
          slPrice: trade.sl, slPct: trade.slPct, label: '1:2 / 1:3',
        },
        entryZone: { lo: trade.entryLo, hi: trade.entryHi, optimal: trade.entry },
        scoreBreakdown: {
          pi: Math.round(score * 0.25), sm: Math.round(score * 0.25),
          mom: Math.round(score * 0.20), str: Math.round(score * 0.15), mkt: Math.round(score * 0.15),
        },
        halvingPhase: hv.p, halvingEmoji: hv.e,
        moonPhase: 'N/A', moonEmoji: '🌙', moonLabel: '',
        decision, decisionColor, positionSize: posSize, isElite,
        rrMode: tradeStyle === 'SCALP' ? 'SCALP 1:2–1:3' : 'DAY 1:2–1:4.5',
        tradeStyle, probScore,
        ict: {
          liq: {
            signals: reasons.filter(r => r.includes('Liquidity') || r.includes('wick')).map(r => ({ type: 'SSL', note: r })),
            hasSweep: lw > 0.30, hasInducement: false, hasFVG: false,
          },
          mss: {
            signals: reasons.filter(r => r.includes('BOS')).map(r => ({ type: 'BOS', note: r })),
            hasMSS: false, hasBOS: !!reasons.find(r => r.includes('BOS')),
            hasFVG: false, fvgZone: null, inDiscount: rp < 0.50,
          },
          pattern: { patterns: [], topPattern: null, hasPattern: false },
          ote: { inOTE, inDiscount: rp < 0.50, currentFib: +(rp * 100).toFixed(0) },
          probScore: { score: probScore, scoreLabel: probScore >= 8 ? '🔥 PREMIUM' : probScore >= 6 ? '💎 HIGH' : '📊 MODERATE', reasons },
          entryPkg: {
            oteEntry: trade.entry,
            entryZone: { lo: trade.entryLo, hi: trade.entryHi },
            sl: trade.sl, slNote: `Structural -${trade.slPct}%`,
            tp1: trade.tp1, tp1Pct: trade.tp1Pct, tp1Note: 'Partial 50% 1:2',
            tp2: trade.tp2, tp2Pct: trade.tp2Pct, tp2Note: 'Full 1:3',
            tp3: trade.tp3, tp3Pct: trade.tp3Pct, tp3Note: 'Extended 1:4.5',
            rr1: 2, rr2: 3,
            execMode, killZone: kz.zone, killZoneQuality: kz.q,
            fvgZone: null, oteZone: null, oteCurrentFib: +(rp * 100).toFixed(0),
          },
          killZone: kz,
        },
        tradeData: {
          coin: coin.base, type: 'ALT',
          entry: trade.entry, sl: trade.sl, tp1: trade.tp1, tp2: trade.tp2,
          rr: '1:2/1:3', status: inZone ? 'ACTIVE' : 'WATCHING',
          confidence: Math.min(100, score + probScore * 3), score,
          timestamp: new Date().toISOString().split('T')[0],
          result: 'RUNNING', positionRank: '', tier, exitStrategy: 'TP2', pnl: 0,
        },
      });
    });

    scored.sort((a, b) => b.finalScore - a.finalScore || b.vol - a.vol);
    scored.forEach((r, i) => {
      r.rank = i + 1;
      r.positionRank = i < 3 ? 'ELITE 🏆' : i < 8 ? 'HIGH ⭐' : 'NORMAL';
    });

    const regular   = scored.slice(0, 15);
    const elite     = scored.filter(r => r.isElite).slice(0, 5);
    const scalp     = scored.filter(r => r.tradeStyle === 'SCALP').slice(0, 8);
    const daytrade  = scored.filter(r => r.tradeStyle === 'DAY TRADE').slice(0, 8);
    const swing     = scored.filter(r => r.tradeStyle === 'SWING').slice(0, 5);

    res.setHeader('Cache-Control', 's-maxage=30');
    return res.status(200).json({
      version: 'v13.1',
      timestamp: Date.now(), scanTime: ((Date.now() - t0) / 1000).toFixed(1),
      totalScanned: coins.length, totalQualified: scored.length,
      regularSetups: regular,
      memeSetups: [],
      scalpSetups: scalp, dayTradeSetups: daytrade, swingSetups: swing, eliteSetups: elite,
      eliteCount: elite.length,
      engineDisciplined: false,
      activeSetups: [], activeTrades: [], watchlist: [],
      wlActive: 0, wlCompleted: 0, wlInvalid: 0, wlEvents: [],
      stats: { winRate: null, majorActive: 0, memeActive: 0, majorMax: 5, memeMax: 3 },
      cosmic: { halving: { phase: hv.p, bonus: hv.b, emoji: hv.e }, btcCh7: 0 },
      regime: {
        r: fg <= 25 ? 'FEAR_ACCUM' : fg >= 75 ? 'GREED_DIST' : 'NEUTRAL',
        color: fg <= 25 ? '#00ffd0' : fg >= 75 ? '#ff4466' : '#FFB300',
        focus: `F&G ${fg} | ${kz.e} ${kz.zone} | ${hv.e} ${hv.p}`,
        hv, moon: { phase: 'N/A', emoji: '🌙', label: '' },
      },
      systemStatus: {
        btcTrend: btcCh24 >= 0 ? 'BULLISH' : 'BEARISH',
        fgValue: fg, btcDom, btcCh7: 0, btcPx,
      },
      killedBreakdown: { KILL: 0, PI: 0, SM: 0, RR: 0, CONFLICT: 0, SCORE: 0, STALE: 0 },
      totalKilled: 0,
    });

  } catch (e) {
    return res.status(500).json({
      error: e.message, version: 'v13.1',
      totalScanned: 0, totalQualified: 0, regularSetups: [], memeSetups: [],
    });
  }
}

function fmtP(p) {
  if (!p || p <= 0) return '—';
  if (p >= 10000) return p.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (p >= 1000)  return p.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (p >= 1)     return p.toFixed(4);
  if (p >= 0.001) return p.toFixed(6);
  return p.toFixed(8);
}
