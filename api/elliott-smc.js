// api/elliott-smc.js — AC369 FUSION v10.1
// FIXED: Elliott Wave dengan proper wave counting, SMC dengan multi-level analysis

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { symbol = 'BTCUSDT' } = req.query;

  try {
    const [k4h, k1d, k1w] = await Promise.allSettled([
      fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=4h&limit=200`, { signal: AbortSignal.timeout(12000) }).then(r => r.json()),
      fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=1d&limit=200`, { signal: AbortSignal.timeout(12000) }).then(r => r.json()),
      fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=1w&limit=100`, { signal: AbortSignal.timeout(10000) }).then(r => r.json()),
    ]);

    const parseK = raw => Array.isArray(raw) ? raw.map(k => ({ t: +k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] })) : [];
    const K4h = k4h.status === 'fulfilled' ? parseK(k4h.value) : [];
    const K1d = k1d.status === 'fulfilled' ? parseK(k1d.value) : [];
    const K1w = k1w.status === 'fulfilled' ? parseK(k1w.value) : [];

    if (!K4h.length) throw new Error('No data');
    const currentPrice = K4h[K4h.length - 1].c;

    // ── HELPERS ───────────────────────────────────────────────────
    const EMA = (c, p) => {
      if (c.length < p) return c[c.length - 1];
      const k = 2 / (p + 1); let e = c.slice(0, p).reduce((a, b) => a + b, 0) / p;
      for (let i = p; i < c.length; i++) e = c[i] * k + e * (1 - k);
      return e;
    };
    const ATR = (K, p = 14) => {
      const t = K.slice(1).map((k, i) => Math.max(k.h - k.l, Math.abs(k.h - K[i].c), Math.abs(k.l - K[i].c)));
      return t.slice(-p).reduce((a, b) => a + b, 0) / Math.min(p, t.length);
    };

    // ── SWING FINDER ──────────────────────────────────────────────
    const findPivots = (K, lb) => {
      const h = [], l = [];
      for (let i = lb; i < K.length - lb; i++) {
        let iH = true, iL = true;
        for (let j = i - lb; j <= i + lb; j++) {
          if (j === i) continue;
          if (K[j].h >= K[i].h) iH = false;
          if (K[j].l <= K[i].l) iL = false;
        }
        if (iH) h.push({ i, price: K[i].h, t: K[i].t, type: 'HIGH' });
        if (iL) l.push({ i, price: K[i].l, t: K[i].t, type: 'LOW' });
      }
      return { highs: h, lows: l };
    };

    const pivots4h = findPivots(K4h, 5);
    const pivots1d = findPivots(K1d, 4);
    const pivots1w = K1w.length >= 10 ? findPivots(K1w, 2) : { highs: [], lows: [] };

    const atr4h = ATR(K4h);
    const atr1d = ATR(K1d.length ? K1d : K4h);
    const closes4h = K4h.map(k => k.c);

    // ── ORDER BLOCKS ──────────────────────────────────────────────
    const avgVol4h = K4h.slice(-50).reduce((s, k) => s + k.v, 0) / 50;
    const orderBlocks = [];
    for (let i = 2; i < K4h.length - 1; i++) {
      const c = K4h[i], n = K4h[i + 1], prev = K4h[i - 1];
      const bodySize = Math.abs(c.c - c.o);
      const rangeSize = c.h - c.l;
      // Bullish OB: bearish candle followed by strong bullish move
      if (c.c < c.o && n.c > n.o) {
        const impulseStrength = (n.c - n.o) / (n.h - n.l + 0.0001);
        if (impulseStrength > 0.5 && (n.c - n.o) > atr4h * 0.5) {
          const hi = Math.max(c.o, c.c), lo = Math.min(c.o, c.c);
          const dist = Math.abs(currentPrice - (hi + lo) / 2) / currentPrice * 100;
          if (dist < 20) { // Only relevant OBs
            orderBlocks.push({
              type: 'BULL', hi, lo, mid: (hi + lo) / 2,
              t: c.t, dist: parseFloat(dist.toFixed(2)),
              strength: impulseStrength > 0.7 ? 'STRONG' : 'NORMAL',
              tested: K4h.slice(i + 1).some(k => k.l <= hi && k.h >= lo),
              volumeRatio: parseFloat((c.v / avgVol4h).toFixed(1)),
            });
          }
        }
      }
      // Bearish OB: bullish candle followed by strong bearish move
      if (c.c > c.o && n.c < n.o) {
        const impulseStrength = (n.o - n.c) / (n.h - n.l + 0.0001);
        if (impulseStrength > 0.5 && (n.o - n.c) > atr4h * 0.5) {
          const hi = Math.max(c.o, c.c), lo = Math.min(c.o, c.c);
          const dist = Math.abs(currentPrice - (hi + lo) / 2) / currentPrice * 100;
          if (dist < 20) {
            orderBlocks.push({
              type: 'BEAR', hi, lo, mid: (hi + lo) / 2,
              t: c.t, dist: parseFloat(dist.toFixed(2)),
              strength: impulseStrength > 0.7 ? 'STRONG' : 'NORMAL',
              tested: K4h.slice(i + 1).some(k => k.h >= lo && k.l <= hi),
              volumeRatio: parseFloat((c.v / avgVol4h).toFixed(1)),
            });
          }
        }
      }
    }
    const bullOBs = orderBlocks.filter(o => o.type === 'BULL').sort((a, b) => a.dist - b.dist).slice(0, 4);
    const bearOBs = orderBlocks.filter(o => o.type === 'BEAR').sort((a, b) => a.dist - b.dist).slice(0, 4);

    // ── FAIR VALUE GAPS ───────────────────────────────────────────
    const fvgs = [];
    for (let i = 1; i < K4h.length - 1; i++) {
      const p = K4h[i - 1], n = K4h[i + 1];
      const gapSize = n.l > p.h ? (n.l - p.h) : (p.l > n.h ? p.l - n.h : 0);
      if (gapSize / currentPrice > 0.0005) { // minimum 0.05% gap
        if (n.l > p.h) {
          fvgs.push({ type: 'BULL', hi: n.l, lo: p.h, mid: (n.l + p.h) / 2, t: K4h[i].t, gapPct: parseFloat((gapSize / currentPrice * 100).toFixed(3)), filled: currentPrice < p.h });
        } else if (p.l > n.h) {
          fvgs.push({ type: 'BEAR', hi: p.l, lo: n.h, mid: (p.l + n.h) / 2, t: K4h[i].t, gapPct: parseFloat((gapSize / currentPrice * 100).toFixed(3)), filled: currentPrice > p.l });
        }
      }
    }
    const bullFVGs = fvgs.filter(f => f.type === 'BULL' && !f.filled).sort((a, b) => Math.abs(currentPrice - a.mid) - Math.abs(currentPrice - b.mid)).slice(0, 4);
    const bearFVGs = fvgs.filter(f => f.type === 'BEAR' && !f.filled).sort((a, b) => Math.abs(currentPrice - a.mid) - Math.abs(currentPrice - b.mid)).slice(0, 4);

    // ── SUPPLY & DEMAND ZONES ─────────────────────────────────────
    const sdZones = [];
    for (let i = 3; i < K4h.length - 1; i++) {
      const k = K4h[i], body = Math.abs(k.c - k.o), rng = k.h - k.l;
      if (k.v > avgVol4h * 1.8 && rng > 0 && body / rng > 0.6) {
        const dist = Math.abs(currentPrice - (k.o + k.c) / 2) / currentPrice * 100;
        if (dist < 25) {
          sdZones.push({
            type: k.c > k.o ? 'DEMAND' : 'SUPPLY',
            hi: Math.max(k.o, k.c) + atr4h * 0.2,
            lo: Math.min(k.o, k.c) - atr4h * 0.2,
            mid: (k.o + k.c) / 2,
            volX: parseFloat((k.v / avgVol4h).toFixed(1)),
            t: k.t,
            dist: parseFloat(dist.toFixed(2)),
          });
        }
      }
    }
    const demandZones = sdZones.filter(z => z.type === 'DEMAND').sort((a, b) => a.dist - b.dist).slice(0, 3);
    const supplyZones = sdZones.filter(z => z.type === 'SUPPLY').sort((a, b) => a.dist - b.dist).slice(0, 3);

    // ── BOS & CHoCH ───────────────────────────────────────────────
    const rH = pivots4h.highs.slice(-6), rL = pivots4h.lows.slice(-6);
    let marketStructure = 'NEUTRAL', bos = null, choch = null;
    let structureDetail = '';

    if (rH.length >= 2 && rL.length >= 2) {
      const hhPat = rH[rH.length - 1].price > rH[rH.length - 2].price;
      const hlPat = rL[rL.length - 1].price > rL[rL.length - 2].price;
      const lhPat = rH[rH.length - 1].price < rH[rH.length - 2].price;
      const llPat = rL[rL.length - 1].price < rL[rL.length - 2].price;

      if (hhPat && hlPat) {
        marketStructure = 'BULLISH';
        bos = { type: 'BULL', level: rH[rH.length - 1].price, detail: `BOS Bullish — HH di $${rH[rH.length - 1].price.toFixed(4)} + HL pattern` };
        structureDetail = `Struktur bullish terkonfirmasi: Higher High ($${rH[rH.length - 1].price.toFixed(4)}) + Higher Low ($${rL[rL.length - 1].price.toFixed(4)})`;
      } else if (lhPat && llPat) {
        marketStructure = 'BEARISH';
        bos = { type: 'BEAR', level: rL[rL.length - 1].price, detail: `BOS Bearish — LH di $${rH[rH.length - 1].price.toFixed(4)} + LL pattern` };
        structureDetail = `Struktur bearish terkonfirmasi: Lower High ($${rH[rH.length - 1].price.toFixed(4)}) + Lower Low ($${rL[rL.length - 1].price.toFixed(4)})`;
      } else if (hhPat && !hlPat) {
        // Higher High but Lower Low = potential CHoCH bearish
        choch = { type: 'POTENTIAL_BEAR', level: rL[rL.length - 1].price, detail: `Potential CHoCH Bearish — HH tapi LL terbentuk` };
        marketStructure = 'BULLISH_WEAK';
        structureDetail = 'Higher High tapi Lower Low — potensi perubahan struktur ke bearish (CHoCH)';
      } else if (lhPat && !llPat) {
        choch = { type: 'POTENTIAL_BULL', level: rH[rH.length - 1].price, detail: `Potential CHoCH Bullish — LH tapi HL terbentuk` };
        marketStructure = 'BEARISH_WEAK';
        structureDetail = 'Lower High tapi Higher Low — potensi perubahan struktur ke bullish (CHoCH)';
      } else {
        marketStructure = 'RANGING';
        structureDetail = 'Struktur ranging — belum ada trend jelas';
      }
    }

    // ── LIQUIDITY LEVELS ──────────────────────────────────────────
    const tol = atr4h * 0.5;
    const liqLevels = [];
    // Find equal highs (BSL) and equal lows (SSL)
    for (let i = 0; i < rH.length - 1; i++) {
      for (let j = i + 1; j < rH.length; j++) {
        if (Math.abs(rH[i].price - rH[j].price) < tol) {
          const liqPrice = (rH[i].price + rH[j].price) / 2;
          if (!liqLevels.find(l => Math.abs(l.price - liqPrice) < tol)) {
            liqLevels.push({
              type: 'BSL',
              price: parseFloat(liqPrice.toFixed(6)),
              dist: parseFloat(((liqPrice - currentPrice) / currentPrice * 100).toFixed(2)),
              detail: `Buy Side Liquidity — Equal Highs at $${liqPrice.toFixed(4)}`,
            });
          }
          break;
        }
      }
    }
    for (let i = 0; i < rL.length - 1; i++) {
      for (let j = i + 1; j < rL.length; j++) {
        if (Math.abs(rL[i].price - rL[j].price) < tol) {
          const liqPrice = (rL[i].price + rL[j].price) / 2;
          if (!liqLevels.find(l => Math.abs(l.price - liqPrice) < tol)) {
            liqLevels.push({
              type: 'SSL',
              price: parseFloat(liqPrice.toFixed(6)),
              dist: parseFloat(((currentPrice - liqPrice) / currentPrice * 100).toFixed(2)),
              detail: `Sell Side Liquidity — Equal Lows at $${liqPrice.toFixed(4)}`,
            });
          }
          break;
        }
      }
    }
    const bslLevels = liqLevels.filter(l => l.type === 'BSL' && l.dist > 0).sort((a, b) => a.dist - b.dist);
    const sslLevels = liqLevels.filter(l => l.type === 'SSL' && l.dist > 0).sort((a, b) => a.dist - b.dist);

    // ── PREMIUM/DISCOUNT ZONES ────────────────────────────────────
    const swing50H = pivots4h.highs.slice(-5);
    const swing50L = pivots4h.lows.slice(-5);
    let premiumDiscount = null;
    if (swing50H.length && swing50L.length) {
      const swingHigh = Math.max(...swing50H.map(h => h.price));
      const swingLow = Math.min(...swing50L.map(l => l.price));
      const range = swingHigh - swingLow;
      const equilibrium = swingLow + range / 2;
      const position = (currentPrice - swingLow) / range;
      premiumDiscount = {
        swingHigh: parseFloat(swingHigh.toFixed(6)),
        swingLow: parseFloat(swingLow.toFixed(6)),
        equilibrium: parseFloat(equilibrium.toFixed(6)),
        position: parseFloat((position * 100).toFixed(1)),
        zone: position > 0.75 ? 'PREMIUM — Price di zona mahal, smart money mungkin akan short/sell' : position < 0.25 ? 'DISCOUNT — Price di zona murah, smart money mungkin akan long/buy' : position > 0.5 ? 'ABOVE EQUILIBRIUM' : 'BELOW EQUILIBRIUM',
        recommendation: position > 0.7 ? 'Look for SHORT opportunities in Premium zone' : position < 0.3 ? 'Look for LONG opportunities in Discount zone' : 'Price at equilibrium — wait for clearer setup',
      };
    }

    // ── ELLIOTT WAVE ANALYSIS ─────────────────────────────────────
    // Proper Elliott Wave using pivot highs/lows
    const analyzeElliottWave = (pivots, K, tf) => {
      const { highs, lows } = pivots;
      if (highs.length < 3 || lows.length < 3) {
        return {
          currentWave: 'Unknown',
          waveCount: 'Insufficient data',
          bias: 'NEUTRAL',
          confidence: 'LOW',
          detail: 'Data tidak cukup untuk analisis Elliott Wave',
          targets: null,
        };
      }

      // Get last significant pivots
      const recentHighs = highs.slice(-5);
      const recentLows = lows.slice(-5);
      const price = K[K.length - 1].c;

      // Determine wave position using price action
      const lastHigh = recentHighs[recentHighs.length - 1];
      const prevHigh = recentHighs[recentHighs.length - 2];
      const lastLow = recentLows[recentLows.length - 1];
      const prevLow = recentLows[recentLows.length - 2];

      // Check wave characteristics
      const higherHighs = recentHighs.length >= 2 && recentHighs[recentHighs.length - 1].price > recentHighs[recentHighs.length - 2].price;
      const higherLows = recentLows.length >= 2 && recentLows[recentLows.length - 1].price > recentLows[recentLows.length - 2].price;
      const lowerHighs = recentHighs.length >= 2 && recentHighs[recentHighs.length - 1].price < recentHighs[recentHighs.length - 2].price;
      const lowerLows = recentLows.length >= 2 && recentLows[recentLows.length - 1].price < recentLows[recentLows.length - 2].price;

      // Fibonacci levels for wave targets
      const fibs = (from, to, type = 'ext') => {
        const diff = to - from;
        if (type === 'ext') {
          return {
            fib100: from + diff * 1.0,
            fib127: from + diff * 1.272,
            fib161: from + diff * 1.618,
            fib200: from + diff * 2.0,
            fib261: from + diff * 2.618,
          };
        }
        return {
          fib236: to - diff * 0.236,
          fib382: to - diff * 0.382,
          fib500: to - diff * 0.5,
          fib618: to - diff * 0.618,
          fib786: to - diff * 0.786,
        };
      };

      let result = {
        currentWave: 'Unknown',
        waveCount: '?',
        bias: 'NEUTRAL',
        confidence: 'MEDIUM',
        detail: '',
        impulse: null,
        correction: null,
        targets: null,
        fibLevels: null,
      };

      // Wave detection logic
      if (higherHighs && higherLows) {
        // Bullish impulse waves
        const waveBase = Math.min(...recentLows.map(l => l.price));
        const wavePeak = Math.max(...recentHighs.map(h => h.price));

        // Determine if in wave 3, 5, or corrective
        const priceFromBase = ((price - waveBase) / waveBase) * 100;
        const fromPeak = ((wavePeak - price) / wavePeak) * 100;

        if (fromPeak < 5 && higherHighs) {
          // Near the top of a wave
          result.currentWave = 'Wave 5 / Wave 3 Akhir';
          result.waveCount = 'Motive Wave — mendekati puncak';
          result.bias = 'BULLISH_CAUTION';
          result.detail = `Harga mendekati puncak wave impulse. Fibonacci extension: target ${(wavePeak * 1.272).toFixed(4)} (127.2%) hingga ${(wavePeak * 1.618).toFixed(4)} (161.8%). Waspada reversal setelah wave 5 selesai.`;
          result.fibLevels = {
            retracement: fibs(waveBase, wavePeak, 'ret'),
            extension: fibs(waveBase, wavePeak, 'ext'),
          };
        } else if (priceFromBase > 20 && higherHighs) {
          result.currentWave = 'Wave 3 (Terkuat)';
          result.waveCount = 'Motive Wave 3 — momentum tertinggi';
          result.bias = 'BULLISH';
          result.confidence = 'HIGH';
          result.detail = `Wave 3 aktif — wave paling kuat dan panjang. Target wave 3 biasanya 161.8% dari wave 1. Level target: $${(waveBase + (wavePeak - waveBase) * 1.618).toFixed(4)}. Momentum naik masih kuat.`;
          result.targets = {
            wave3target: parseFloat((waveBase + (wavePeak - waveBase) * 1.618).toFixed(6)),
            wave5target: parseFloat((waveBase + (wavePeak - waveBase) * 2.618).toFixed(6)),
          };
        } else {
          result.currentWave = 'Wave 1/3 (Developing)';
          result.waveCount = 'Early Motive Wave';
          result.bias = 'BULLISH';
          result.detail = `Impulse wave sedang berkembang. HH+HL pattern terkonfirmasi. Konfirmasi wave 3 jika break above $${(recentHighs[recentHighs.length - 1].price * 1.01).toFixed(4)}.`;
        }
      } else if (lowerHighs && lowerLows) {
        // Bearish impulse
        const waveTop = Math.max(...recentHighs.map(h => h.price));
        const waveBottom = Math.min(...recentLows.map(l => l.price));
        const fromBottom = ((price - waveBottom) / waveBottom) * 100;

        if (fromBottom < 5) {
          result.currentWave = 'Wave 5 Bearish / Wave C';
          result.waveCount = 'Bearish Motive — mendekati bottom';
          result.bias = 'BEARISH_CAUTION';
          result.detail = `Harga mendekati bottom bearish wave. Potensi reversal atau bottoming setelah wave 5 selesai. Support kunci: $${waveBottom.toFixed(4)}.`;
        } else {
          result.currentWave = 'Wave 3 Bearish';
          result.waveCount = 'Bearish Motive Wave 3';
          result.bias = 'BEARISH';
          result.confidence = 'HIGH';
          result.detail = `Wave 3 bearish aktif — tekanan jual terkuat. LH+LL pattern terkonfirmasi. Target: $${(waveTop - (waveTop - waveBottom) * 1.618).toFixed(4)}.`;
          result.targets = {
            bearTarget: parseFloat((waveTop - (waveTop - waveBottom) * 1.618).toFixed(6)),
          };
        }
      } else if (higherHighs && !higherLows) {
        // Corrective ABC or complex correction
        const waveTop = recentHighs[recentHighs.length - 1].price;
        const recentBottom = recentLows[recentLows.length - 1].price;
        result.currentWave = 'Wave A atau Wave 4 (Koreksi)';
        result.waveCount = 'Corrective ABC';
        result.bias = 'NEUTRAL_BEARISH';
        result.detail = `Pola koreksi terdeteksi. Wave A/B/C sedang terbentuk. Fib retracement dari swing high $${waveTop.toFixed(4)}: support di $${(waveTop - (waveTop - recentBottom) * 0.618).toFixed(4)} (61.8%) hingga $${(waveTop - (waveTop - recentBottom) * 0.786).toFixed(4)} (78.6%).`;
        result.fibLevels = { retracement: fibs(recentBottom, waveTop, 'ret') };
      } else if (lowerHighs && !lowerLows) {
        result.currentWave = 'Wave B atau Koreksi Bullish';
        result.waveCount = 'Corrective Wave B';
        result.bias = 'NEUTRAL_BULLISH';
        result.detail = 'Wave B koreksi — kemungkinan akan dilanjutkan bearish setelah koreksi selesai. Monitor untuk konfirmasi wave C.';
      } else {
        // Ranging/sideways — potentially Wave 4 or end of cycle
        result.currentWave = 'Wave 4 / Konsolidasi';
        result.waveCount = 'Consolidation';
        result.bias = 'NEUTRAL';
        result.detail = `Pasar dalam konsolidasi. Wave 4 biasanya koreksi 38.2-61.8% dari wave 3. Tunggu breakout untuk konfirmasi arah selanjutnya.`;
      }

      // Add Fibonacci levels always
      if (recentLows.length >= 1 && recentHighs.length >= 1) {
        const swingLow = Math.min(...recentLows.slice(-3).map(l => l.price));
        const swingHigh = Math.max(...recentHighs.slice(-3).map(h => h.price));
        result.fibonacci = {
          swingLow: parseFloat(swingLow.toFixed(6)),
          swingHigh: parseFloat(swingHigh.toFixed(6)),
          fib236: parseFloat((swingHigh - (swingHigh - swingLow) * 0.236).toFixed(6)),
          fib382: parseFloat((swingHigh - (swingHigh - swingLow) * 0.382).toFixed(6)),
          fib500: parseFloat((swingHigh - (swingHigh - swingLow) * 0.5).toFixed(6)),
          fib618: parseFloat((swingHigh - (swingHigh - swingLow) * 0.618).toFixed(6)),
          fib786: parseFloat((swingHigh - (swingHigh - swingLow) * 0.786).toFixed(6)),
          ext127: parseFloat((swingLow + (swingHigh - swingLow) * 1.272).toFixed(6)),
          ext161: parseFloat((swingLow + (swingHigh - swingLow) * 1.618).toFixed(6)),
          ext200: parseFloat((swingLow + (swingHigh - swingLow) * 2.0).toFixed(6)),
          ext261: parseFloat((swingLow + (swingHigh - swingLow) * 2.618).toFixed(6)),
          currentPositionPct: parseFloat(((price - swingLow) / (swingHigh - swingLow) * 100).toFixed(1)),
        };
      }

      result.pivotHighs = recentHighs.map(h => ({ price: parseFloat(h.price.toFixed(6)), t: h.t }));
      result.pivotLows = recentLows.map(l => ({ price: parseFloat(l.price.toFixed(6)), t: l.t }));
      return result;
    };

    const wave4h = analyzeElliottWave(pivots4h, K4h, '4H');
    const wave1d = analyzeElliottWave(pivots1d, K1d, '1D');
    const wave1w = K1w.length >= 20 ? analyzeElliottWave(pivots1w, K1w, '1W') : null;

    // ── SMC OVERALL BIAS ──────────────────────────────────────────
    const smcBullScore = (marketStructure === 'BULLISH' ? 3 : marketStructure === 'BULLISH_WEAK' ? 1 : 0) + (bullOBs.length > 0 && bullOBs[0].dist < 3 ? 3 : bullOBs.length > 0 ? 1 : 0) + (bslLevels.length > 0 ? 1 : 0) + (bullFVGs.length > 0 ? 1 : 0);
    const smcBearScore = (marketStructure === 'BEARISH' ? 3 : marketStructure === 'BEARISH_WEAK' ? 1 : 0) + (bearOBs.length > 0 && bearOBs[0].dist < 3 ? 3 : bearOBs.length > 0 ? 1 : 0) + (sslLevels.length > 0 ? 1 : 0) + (bearFVGs.length > 0 ? 1 : 0);
    const smcBias = smcBullScore > smcBearScore ? 'BULLISH' : smcBearScore > smcBullScore ? 'BEARISH' : 'NEUTRAL';
    const smcProbability = Math.round((Math.max(smcBullScore, smcBearScore) / (smcBullScore + smcBearScore + 0.001)) * 100);

    // ── SMC NARRATIVE ─────────────────────────────────────────────
    const generateSmcNarrative = () => {
      const parts = [];
      parts.push(`Market Structure: ${structureDetail || 'Belum jelas'}.`);
      if (bullOBs[0]) parts.push(`Bullish OB terdekat di $${bullOBs[0].lo.toFixed(4)}-$${bullOBs[0].hi.toFixed(4)} (${bullOBs[0].dist.toFixed(1)}% dari harga saat ini) — level entry potensial.`);
      if (bearOBs[0]) parts.push(`Bearish OB terdekat di $${bearOBs[0].lo.toFixed(4)}-$${bearOBs[0].hi.toFixed(4)} (${bearOBs[0].dist.toFixed(1)}% dari harga saat ini) — level resistance potensial.`);
      if (bullFVGs[0]) parts.push(`FVG Bullish unfilled di $${bullFVGs[0].lo.toFixed(4)}-$${bullFVGs[0].hi.toFixed(4)} — price magnet ke bawah.`);
      if (bslLevels[0]) parts.push(`Buy Side Liquidity (BSL) di $${bslLevels[0].price.toFixed(4)} — smart money target untuk push harga ke atas.`);
      if (sslLevels[0]) parts.push(`Sell Side Liquidity (SSL) di $${sslLevels[0].price.toFixed(4)} — potential sweep sebelum reversal.`);
      if (premiumDiscount) parts.push(premiumDiscount.recommendation);
      return parts.join(' ');
    };

    // ── RESPONSE ──────────────────────────────────────────────────
    res.setHeader('Cache-Control', 's-maxage=30');
    return res.status(200).json({
      symbol,
      timestamp: Date.now(),
      currentPrice: parseFloat(currentPrice.toFixed(6)),
      atr: { '4h': parseFloat(atr4h.toFixed(6)), '1d': parseFloat(atr1d.toFixed(6)) },

      // SMC Analysis
      smc: {
        bias: smcBias,
        probability: smcProbability,
        narrative: generateSmcNarrative(),
        marketStructure,
        structureDetail,
        bos,
        choch,
        orderBlocks: { bull: bullOBs, bear: bearOBs },
        fvg: { bull: bullFVGs, bear: bearFVGs },
        supplyDemand: { demand: demandZones, supply: supplyZones },
        liquidity: { bsl: bslLevels, ssl: sslLevels },
        premiumDiscount,
      },

      // Elliott Wave
      elliottWave: {
        '4h': wave4h,
        '1d': wave1d,
        '1w': wave1w,
        summary: `4H: ${wave4h.currentWave} (${wave4h.bias}) | 1D: ${wave1d.currentWave} (${wave1d.bias})${wave1w ? ` | 1W: ${wave1w.currentWave}` : ''}`,
        overallBias: wave1d.bias.startsWith('BULL') ? 'BULLISH' : wave1d.bias.startsWith('BEAR') ? 'BEARISH' : 'NEUTRAL',
        confidence: wave4h.confidence,
      },

      // Key levels for entry
      keyLevels: {
        nearestBullOB: bullOBs[0] || null,
        nearestBearOB: bearOBs[0] || null,
        nearestBSL: bslLevels[0] || null,
        nearestSSL: sslLevels[0] || null,
        nearestBullFVG: bullFVGs[0] || null,
        nearestBearFVG: bearFVGs[0] || null,
        nearestDemand: demandZones[0] || null,
        nearestSupply: supplyZones[0] || null,
      },
    });

  } catch (e) {
    return res.status(500).json({ error: e.message, symbol });
  }
}
