// api/accumulation.js — AC369 FUSION v2.0
// ═══════════════════════════════════════════════════════════════════
// Smart Money Accumulation Detection System
// UPGRADE v2.0:
//   + Accumulation Price Zone (entry lo/hi + optimal buy price)
//   + Expected Target Prices (TP1/TP2/TP3 absolut)
//   + Stop Loss price (invalidation)
//   + Risk/Reward ratio
//   + Relative Strength vs BTC (outperformer filter)
//   + Volume Divergence detection (volume up, price down = SM buying)
//   + Better coin filter (remove stablecoins, scams, low-quality)
//   + Sensitivity tuning (more coins qualify)
//   + Market Cycle aware scoring
// ═══════════════════════════════════════════════════════════════════

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

  try {
    const start = Date.now();

    // ── FETCH ALL DATA IN PARALLEL ────────────────────────────────
    const [tickerRes, cgMarketsRes, fngRes, globalRes, btcKlRes] = await Promise.allSettled([
      // Binance 24h tickers (fastest, most coins)
      sf('https://api.binance.com/api/v3/ticker/24hr', 6000),
      // CoinGecko markets page 1 (has 7d, 30d change + ATH + market cap)
      sf('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=volume_desc&per_page=250&page=1&sparkline=false&price_change_percentage=7d,30d', 6000),
      sf('https://api.alternative.me/fng/?limit=1&format=json'),
      sf('https://api.coingecko.com/api/v3/global'),
      // BTC 7-day hourly for relative strength calc
      sf('https://min-api.cryptocompare.com/data/v2/histohour?fsym=BTC&tsym=USD&limit=168', 5000),
    ]);

    const binanceTickers = tickerRes.status === 'fulfilled' && Array.isArray(tickerRes.value) && tickerRes.value.length > 100 ? tickerRes.value : [];
    const cgMarkets = cgMarketsRes.status === 'fulfilled' && Array.isArray(cgMarketsRes.value) ? cgMarketsRes.value : [];
    const fgValue = fngRes.status === 'fulfilled' ? parseInt(fngRes.value?.data?.[0]?.value || 50) : 50;
    const globalData = globalRes.status === 'fulfilled' ? globalRes.value?.data : null;
    const btcKlines = btcKlRes.status === 'fulfilled' && btcKlRes.value?.Response === 'Success'
      ? btcKlRes.value.Data.Data.map(d => ({ c: +d.close, v: +d.volumeto })) : [];

    // ── BUILD COIN MAP from Binance (fast 24h data) ───────────────
    const binanceMap = {};
    if (binanceTickers.length > 0) {
      binanceTickers.forEach(t => { if (t?.symbol) binanceMap[t.symbol] = t; });
    }

    // ── BTC CONTEXT ───────────────────────────────────────────────
    let btcPrice = 0, btcChange24h = 0, btcChange7d = 0, btcTrend = 'NEUTRAL';
    const btcBin = binanceMap['BTCUSDT'];
    if (btcBin) { btcPrice = +(btcBin.lastPrice || 0); btcChange24h = +(btcBin.priceChangePercent || 0); }
    if (btcKlines.length >= 50) {
      const closes = btcKlines.map(k => k.c).filter(v => v > 0);
      const cur = closes[closes.length - 1];
      const w7 = closes.length >= 168 ? closes[closes.length - 168] : closes[0];
      btcChange7d = w7 > 0 ? +((cur - w7) / w7 * 100).toFixed(2) : 0;
      const ma50 = closes.slice(-50).reduce((a, b) => a + b, 0) / 50;
      btcTrend = cur > ma50 * 1.02 ? 'BULLISH' : cur < ma50 * 0.98 ? 'BEARISH' : 'NEUTRAL';
    }
    const btcCtxBonus = btcTrend === 'BULLISH' ? 3 : btcTrend === 'BEARISH' ? -2 : 0;

    // ── MARKET CYCLE ──────────────────────────────────────────────
    const halvingDate = new Date('2024-04-20');
    const daysSinceHalving = Math.floor((Date.now() - halvingDate.getTime()) / 86400000);
    const cycleBonus = daysSinceHalving < 365 ? 4 : daysSinceHalving < 547 ? 2 : daysSinceHalving < 730 ? 0 : -1;
    const cyclePhase = daysSinceHalving < 365 ? 'Bull Early ✅' : daysSinceHalving < 547 ? 'Bull Peak ⚠️' : daysSinceHalving < 730 ? 'Distribution ⚠️' : 'Bear/Accum';

    // Mercury Retrograde
    const now = new Date();
    const mrs = [
      { s: new Date('2026-03-08'), e: new Date('2026-03-31') },
      { s: new Date('2026-07-06'), e: new Date('2026-07-30') },
    ];
    const inMR = mrs.some(p => now >= p.s && now <= p.e);

    // ── ENHANCED STABLECOIN + JUNK FILTER ────────────────────────
    const STABLES = new Set([
      'USDT','USDC','BUSD','TUSD','DAI','FDUSD','USDP','FRAX','LUSD','USDS',
      'SUSD','GUSD','PYUSD','CRVUSD','USDD','CUSD','USDX','USDB','XUSD',
      'PAXG','XAUT','WBTC','WETH','WBNB','STETH','CBETH','RETH','BETH',
      'QUQ','BLEND' // Known low-quality / obscure tokens from previous scan
    ]);
    // Filter: must have proper name (not Chinese characters), min volume, not wrapped
    const CHINESE_PATTERN = /[\u4e00-\u9fff]/;
    const BAD_SUFFIX = ['UP','DOWN','BEAR','BULL','3L','3S','2L','2S','5L','5S','PERP'];

    // ── MERGE DATA: Binance speed + CoinGecko depth ───────────────
    // Build CG map for enrichment
    const cgMap = {};
    cgMarkets.forEach(c => {
      if (c?.symbol) cgMap[c.symbol.toUpperCase()] = c;
    });

    // ── BUILD CANDIDATE LIST ──────────────────────────────────────
    // Use Binance as primary (500+ valid coins), enrich with CG data
    const candidates = [];
    const usedSymbols = new Set();

    // From Binance
    if (binanceTickers.length > 0) {
      binanceTickers.forEach(t => {
        if (!t?.symbol?.endsWith('USDT')) return;
        const base = t.symbol.replace('USDT', '');
        if (STABLES.has(base)) return;
        if (CHINESE_PATTERN.test(base)) return;
        if (BAD_SUFFIX.some(s => base.endsWith(s) || base.startsWith(s))) return;
        if (base.length < 2 || base.length > 10) return;
        const vol = +(t.quoteVolume || 0);
        if (vol < 500000) return; // min $500K
        const price = +(t.lastPrice || 0);
        if (price <= 0) return;
        usedSymbols.add(base);
        const cg = cgMap[base] || null;
        candidates.push({
          base, price, vol24h: vol,
          change24h: +(t.priceChangePercent || 0),
          high: +(t.highPrice || price),
          low: +(t.lowPrice || price),
          open: +(t.openPrice || t.prevClosePrice || price),
          change7d: cg ? +(cg.price_change_percentage_7d || 0) : 0,
          change30d: cg ? +(cg.price_change_percentage_30d || 0) : 0,
          ath: cg ? +(cg.ath || 0) : 0,
          marketCap: cg ? +(cg.market_cap || 0) : 0,
          src: 'binance',
        });
      });
    }

    // Add CG-only coins (not on Binance but large enough)
    cgMarkets.forEach(c => {
      const base = (c.symbol || '').toUpperCase();
      if (usedSymbols.has(base)) return;
      if (STABLES.has(base)) return;
      if (CHINESE_PATTERN.test(c.name || '')) return;
      const vol = +(c.total_volume || 0);
      if (vol < 1000000) return;
      const price = +(c.current_price || 0);
      if (price <= 0) return;
      candidates.push({
        base, price, vol24h: vol,
        change24h: +(c.price_change_percentage_24h || 0),
        high: price * 1.02, low: price * 0.98, open: price / (1 + (+(c.price_change_percentage_24h||0))/100),
        change7d: +(c.price_change_percentage_7d || 0),
        change30d: +(c.price_change_percentage_30d || 0),
        ath: +(c.ath || 0), marketCap: +(c.market_cap || 0), src: 'coingecko',
      });
    });

    // ── ANALYZE EACH CANDIDATE ────────────────────────────────────
    const results = [];

    for (const coin of candidates.slice(0, 800)) {
      const { base: sym, price, vol24h, change24h, high, low, open, change7d, change30d, ath, marketCap } = coin;
      if (price <= 0) continue;

      const range = Math.max(high - low, price * 0.01);
      const rangePos = (price - low) / range; // 0=at low, 1=at high
      const body = Math.abs(price - open);
      const lowerWick = Math.min(price, open) - low;
      const upperWick = high - Math.max(price, open);
      const lwRatio = lowerWick / range;
      const uwRatio = upperWick / range;
      const bodyRatio = body / range;

      // ── RELATIVE STRENGTH vs BTC ──────────────────────────────
      // Positive = outperforming BTC = strong coin, smart money buying
      const relStrength7d = change7d - btcChange7d;
      const relStrength24h = change24h - btcChange24h;
      const isOutperformer = relStrength7d > 5 || (relStrength24h > 2 && change24h > 0);
      const isRelativeStrong = relStrength7d > -5 && btcChange7d < -3; // holds better than BTC

      // ── ATH ANALYSIS ──────────────────────────────────────────
      const fromATH = ath > 0 ? ((price - ath) / ath * 100) : 0;
      // Sweet spot: -30% to -80% from ATH = probable accumulation zone
      const inAccumZone = fromATH <= -25 && fromATH >= -85;
      const deepDiscount = fromATH <= -60 && fromATH >= -90;

      // ── VOLUME DIVERGENCE ─────────────────────────────────────
      // Volume high + price down or flat = SM accumulating (classic Wyckoff)
      const volTier = vol24h >= 500e6 ? 5 : vol24h >= 100e6 ? 4 : vol24h >= 30e6 ? 3 : vol24h >= 10e6 ? 2 : vol24h >= 2e6 ? 1 : 0;
      const volumeDivergence = volTier >= 2 && change24h <= 1 && change24h >= -5; // High vol, low price move
      const volumeAccumPattern = volTier >= 3 && change7d <= 5 && change7d >= -15; // 7d context

      // ══════════════════════════════════════════════════════════
      // 7-LAYER SCORING (0-100 scale, not percentages)
      // ══════════════════════════════════════════════════════════

      // ── LAYER 1: SM ACCUMULATION PATTERN (max 35pts) ──────────
      let l1 = 0;
      // Price at bottom of range (SM buying silently)
      if (rangePos <= 0.25) l1 += 12;
      else if (rangePos <= 0.40) l1 += 7;
      else if (rangePos <= 0.55) l1 += 3;

      // Absorption candle: small body at lows with large lower wick
      if (lwRatio > 0.45 && bodyRatio < 0.2 && rangePos < 0.50) l1 += 12;
      else if (lwRatio > 0.30 && rangePos < 0.55) l1 += 6;

      // Sideways/minor loss but with lower wick = SM absorbing supply
      if (change24h >= -4 && change24h <= 2 && lwRatio > 0.3) l1 += 8;

      // 7d context: recent recovery from downtrend
      if (change30d < -15 && change7d > 2) l1 += 10;
      else if (change30d < -10 && change7d > 0) l1 += 5;

      // ATH discount zone
      if (deepDiscount) l1 += 8;
      else if (inAccumZone) l1 += 5;

      // Relative strength (key signal: holds strong vs BTC)
      if (isRelativeStrong) l1 += 5;
      if (isOutperformer) l1 += 8;

      l1 = Math.min(35, l1);

      // ── LAYER 2: LIQUIDITY SWEEP (max 25pts) ─────────────────
      let l2 = 0;
      // Classic SSL sweep: price dipped low then recovered (hammer)
      if (lwRatio > 0.50 && rangePos < 0.45 && price > low * 1.005) l2 += 20;
      else if (lwRatio > 0.35 && rangePos < 0.50) l2 += 12;
      // Pin bar
      if (lwRatio > 0.60 && bodyRatio < 0.12) l2 += 10;
      // Recovery after dip: change24h positive but had big low wick
      if (change24h > 2 && lwRatio > 0.20 && rangePos > 0.55) l2 += 8;
      // False breakdown pattern: change24h small positive after period down
      if (change24h > 0.5 && change24h < 6 && change7d < -5 && rangePos > 0.45) l2 += 8;
      l2 = Math.min(25, l2);

      // ── LAYER 3: STRUCTURE SHIFT SIGNS (max 18pts) ───────────
      let l3 = 0;
      // Early CHoCH: moderate positive move after downtrend
      if (change24h > 5 && change24h < 15 && rangePos > 0.55 && change7d < 5) l3 += 15;
      else if (change24h > 2 && change24h < 6 && rangePos > 0.58) l3 += 9;
      // Recovery momentum building
      if (change7d > 5 && change30d < -10) l3 += 10; // 7d positive despite 30d down
      else if (change7d > 2 && change30d < -5) l3 += 5;
      // Consolidation at lows (accumulation box)
      if (Math.abs(change7d) < 5 && Math.abs(change24h) < 3 && vol24h > 10e6) l3 += 6;
      l3 = Math.min(18, l3);

      // ── LAYER 4: VOLUME QUALITY (max 12pts) ──────────────────
      let l4 = 0;
      if (volumeDivergence) l4 += 10; // SM absorption
      if (volumeAccumPattern) l4 += 6;
      if (volTier >= 3 && change24h > 0 && change24h < 10) l4 += 5;
      else if (volTier >= 2 && change24h >= 0) l4 += 3;
      // High volume at lows = smart money buying
      if (volTier >= 3 && rangePos < 0.45) l4 += 7;
      l4 = Math.min(12, l4);

      // ── LAYER 5: MARKET SENTIMENT (max 5pts) ─────────────────
      let l5 = 0;
      if (fgValue <= 20) l5 += 5;
      else if (fgValue <= 35) l5 += 3;
      else if (fgValue <= 45) l5 += 1;
      // Contrarian: retail maximum fear = SM maximum buy
      if (fgValue <= 25 && change24h > 0) l5 += 2;
      l5 = Math.min(5, l5);

      // ── LAYER 6: HALVING CYCLE (max 3pts) ────────────────────
      const l6 = Math.max(0, cycleBonus);

      // ── LAYER 7: BTC CONTEXT (max 2pts) ──────────────────────
      const l7 = Math.max(0, btcCtxBonus > 0 ? 2 : 0);

      // ── MERCURY RETROGRADE PENALTY ────────────────────────────
      const mrPenalty = inMR ? -3 : 0;

      // ── TOTAL SCORE ───────────────────────────────────────────
      const rawTotal = l1 + l2 + l3 + l4 + l5 + l6 + l7 + mrPenalty;
      // Normalize: max theoretical = 35+25+18+12+5+3+2 = 100
      const score = Math.max(0, Math.min(95, Math.round(rawTotal)));
      if (score < 28) continue; // Lower threshold for more results

      // ── TIER CLASSIFICATION ───────────────────────────────────
      let tier, tierLabel, timeframe;
      if (score >= 78) { tier = 'S'; tierLabel = '🔥 IMMINENT'; timeframe = '1-7 hari'; }
      else if (score >= 62) { tier = 'A'; tierLabel = '✅ READY'; timeframe = '1-2 minggu'; }
      else if (score >= 48) { tier = 'B'; tierLabel = '📈 BUILDING'; timeframe = '2-4 minggu'; }
      else { tier = 'C'; tierLabel = '👁 WATCH'; timeframe = '1-2 bulan'; }

      // ── ACCUMULATION ZONE CALCULATION ────────────────────────
      // Based on: current price, ATH distance, daily range, volume profile
      let accumLo, accumHi, optimalBuy;

      if (ath > 0 && fromATH < -20) {
        // Fibonacci retracement of the full dump
        const dumpRange = ath - price;
        const fib618 = ath - dumpRange * 0.618; // 61.8% retrace from ATH
        const fib786 = ath - dumpRange * 0.786; // 78.6% retrace

        // Accumulation zone = current price ± 8-15% based on tier
        const zoneWidth = tier === 'S' ? 0.06 : tier === 'A' ? 0.10 : tier === 'B' ? 0.14 : 0.18;
        accumLo = +(price * (1 - zoneWidth)).toFixed(8);
        accumHi = +(price * (1 + zoneWidth * 0.5)).toFixed(8); // Tighter upside
        optimalBuy = +(price * (1 - zoneWidth * 0.4)).toFixed(8); // Slight discount from current

        // Validate: accumLo should not be below 90% of day low
        accumLo = Math.max(accumLo, low * 0.92);
      } else {
        // No ATH data: use day range + momentum
        const zoneWidth = 0.08;
        accumLo = +(Math.max(low * 0.97, price * (1 - zoneWidth))).toFixed(8);
        accumHi = +(price * (1 + zoneWidth * 0.4)).toFixed(8);
        optimalBuy = +(price * 0.97).toFixed(8);
      }

      // ── TARGET PRICE CALCULATION ──────────────────────────────
      // Based on: Fibonacci extension from accumulation to breakout
      const risk = price - accumLo; // Distance to stop
      const baseMove = Math.max(risk * 2, price * 0.15); // Min 15% move

      // TP levels based on tier and market structure
      const tp1Multi = tier === 'S' ? 1.15 : tier === 'A' ? 1.25 : tier === 'B' ? 1.40 : 1.60;
      const tp2Multi = tier === 'S' ? 1.35 : tier === 'A' ? 1.55 : tier === 'B' ? 1.80 : 2.20;
      const tp3Multi = tier === 'S' ? 1.65 : tier === 'A' ? 2.00 : tier === 'B' ? 2.50 : 3.00;

      // For ATH context: targets are Fib retraces of previous ATH
      let tp1Price, tp2Price, tp3Price;
      if (ath > 0 && fromATH < -30) {
        const toATH = ath - price;
        tp1Price = +(price + toATH * 0.382).toFixed(8); // Retrace 38.2% back to ATH
        tp2Price = +(price + toATH * 0.618).toFixed(8); // Retrace 61.8% back to ATH
        tp3Price = +(price + toATH * 1.00).toFixed(8);  // Full retrace to ATH
      } else {
        tp1Price = +(price * tp1Multi).toFixed(8);
        tp2Price = +(price * tp2Multi).toFixed(8);
        tp3Price = +(price * tp3Multi).toFixed(8);
      }

      const tp1Pct = +((tp1Price - price) / price * 100).toFixed(1);
      const tp2Pct = +((tp2Price - price) / price * 100).toFixed(1);
      const tp3Pct = +((tp3Price - price) / price * 100).toFixed(1);

      // ── STOP LOSS (INVALIDATION) ──────────────────────────────
      // Below accumulation zone = SM thesis invalidated
      const slPrice = +(accumLo * 0.97).toFixed(8);
      const slPct = +((slPrice - price) / price * 100).toFixed(1);

      // ── RISK/REWARD ───────────────────────────────────────────
      const rr1 = risk > 0 ? +((tp1Price - price) / (price - slPrice)).toFixed(2) : 2;
      const rr2 = risk > 0 ? +((tp2Price - price) / (price - slPrice)).toFixed(2) : 3.5;
      const rr3 = risk > 0 ? +((tp3Price - price) / (price - slPrice)).toFixed(2) : 5;

      // ── PHASE DESCRIPTION ─────────────────────────────────────
      let accPhase, entrySignal;
      const sslDetect = l2 >= 20;
      const structureShift = l3 >= 15;
      const volumeAcc = l4 >= 8;
      const outperforming = isOutperformer || isRelativeStrong;

      if (sslDetect && structureShift) {
        accPhase = '🚀 MANIPULATION COMPLETE — Impulse incoming';
        entrySignal = 'MARKET ENTRY — CHoCH terkonfirmasi';
      } else if (sslDetect && volumeAcc) {
        accPhase = '⚡ SSL SWEPT — Momentum building';
        entrySignal = 'ENTRY BERTAHAP — SSL swept, tunggu CHoCH';
      } else if (outperforming && l1 >= 20) {
        accPhase = '💪 RELATIVE STRENGTH — SM accumulate diam-diam';
        entrySignal = 'DCA ENTRY — Outperform BTC, SM quietly buying';
      } else if (volumeAcc && l1 >= 15) {
        accPhase = '📊 VOLUME DIVERGENCE — High vol, price flat';
        entrySignal = 'LIMIT ORDER — Pasang di accumulation zone';
      } else if (l1 >= 20) {
        accPhase = '🔄 MID-ACCUMULATION — SM building position';
        entrySignal = 'WAITING — DCA bertahap di zone';
      } else {
        accPhase = '👁 EARLY ACCUMULATION — Signal emerging';
        entrySignal = 'WATCH — Konfirmasi volume diperlukan';
      }

      // ── SIGNAL SUMMARY ─────────────────────────────────────────
      const signals = [];
      if (sslDetect) signals.push('⚡ SSL sweep terdeteksi');
      if (structureShift) signals.push('✅ Structure shift (CHoCH)');
      if (volumeDivergence) signals.push('📊 Volume divergence bullish');
      if (outperforming) signals.push('💪 Outperform BTC +' + relStrength7d.toFixed(1) + '%');
      if (deepDiscount) signals.push('💎 Deep discount ' + fromATH.toFixed(0) + '% dari ATH');
      else if (inAccumZone) signals.push('📉 Di zona akumulasi ' + fromATH.toFixed(0) + '% dari ATH');
      if (lwRatio > 0.40) signals.push('🔨 Lower wick kuat (' + (lwRatio * 100).toFixed(0) + '%)');
      if (change30d < -20 && change7d > 0) signals.push('🔄 Recovery 7d setelah dump 30d');
      if (volumeAccumPattern) signals.push('💰 Volume akumulasi 7d tinggi');
      if (fgValue <= 30) signals.push('😱 Extreme Fear = zona beli SM');

      // ── CONFIDENCE LEVEL ──────────────────────────────────────
      const confidence = score >= 78 ? 'VERY HIGH' : score >= 62 ? 'HIGH' : score >= 48 ? 'MEDIUM' : 'LOW';
      const positionSize = score >= 78 ? '2-3%' : score >= 62 ? '1.5-2%' : score >= 48 ? '1%' : '0.5%';

      // ── DCA PLAN ──────────────────────────────────────────────
      const dcaZone1 = +(price * 1.005).toFixed(8); // At/near current
      const dcaZone2 = +(price * 0.95).toFixed(8);  // 5% lower
      const dcaZone3 = +(accumLo * 1.01).toFixed(8); // Near bottom of zone

      results.push({
        rank: 0, symbol: sym, price, change24h: +change24h.toFixed(2),
        change7d: +change7d.toFixed(2), change30d: +change30d.toFixed(2),
        volume24h: vol24h, volTier, marketCap, fromATH: fromATH !== 0 ? +fromATH.toFixed(1) : null,
        score, tier, tierLabel, timeframe, confidence, positionSize,

        // Accumulation Zone
        accumulationZone: {
          lo: accumLo, hi: accumHi,
          optimalBuy, currentPrice: price,
          discountFromOptimal: +((price - optimalBuy) / price * 100).toFixed(1),
          description: `$${fmtPrice(accumLo)} – $${fmtPrice(accumHi)}`,
        },

        // DCA Plan
        dcaPlan: {
          zone1: { price: dcaZone1, allocation: '30%', note: 'Entry awal — konfirmasi baru' },
          zone2: { price: dcaZone2, allocation: '40%', note: 'Core position — retrace normal' },
          zone3: { price: dcaZone3, allocation: '30%', note: 'Final akumulasi — near SSL' },
        },

        // Target Prices (absolute)
        targetPrices: {
          tp1: { price: tp1Price, pct: tp1Pct, rr: rr1, label: 'TP1 (Fib 38.2%)' },
          tp2: { price: tp2Price, pct: tp2Pct, rr: rr2, label: 'TP2 (Fib 61.8%)' },
          tp3: { price: tp3Price, pct: tp3Pct, rr: rr3, label: 'TP3 (ATH area)' },
        },

        // Stop Loss
        stopLoss: { price: slPrice, pct: slPct, note: 'Invalidasi jika tembus bawah zona akumulasi' },

        accPhase, entrySignal, signals,
        relStrength7d: +relStrength7d.toFixed(2), relStrength24h: +relStrength24h.toFixed(2),
        isOutperformer, isRelativeStrong,
        layers: { l1, l2, l3, l4, l5, l6: l6, l7: l7 },
        rangePos: +rangePos.toFixed(3), lwRatio: +lwRatio.toFixed(3),
        volumeDivergence,
      });
    }

    // Sort by score descending
    results.sort((a, b) => b.score - a.score || b.volume24h - a.volume24h);
    results.forEach((r, i) => r.rank = i + 1);

    // Group by tier
    const tierGroups = {
      S: results.filter(r => r.tier === 'S').slice(0, 15),
      A: results.filter(r => r.tier === 'A').slice(0, 20),
      B: results.filter(r => r.tier === 'B').slice(0, 25),
      C: results.filter(r => r.tier === 'C').slice(0, 20),
    };

    // Market summary for best opportunities
    const topPicks = results.filter(r => r.tier === 'S' || r.tier === 'A').slice(0, 10);

    res.setHeader('Cache-Control', 's-maxage=120');
    return res.status(200).json({
      timestamp: Date.now(),
      scanTime: ((Date.now() - start) / 1000).toFixed(1),
      totalAnalyzed: candidates.length,
      totalQualified: results.length,
      marketContext: {
        btcTrend, btcPrice, btcChange24h, btcChange7d,
        fgValue, fgLabel: fgValue <= 25 ? 'Extreme Fear 🔥' : fgValue <= 45 ? 'Fear 😨' : fgValue <= 55 ? 'Neutral ⚖️' : fgValue <= 75 ? 'Greed 😄' : 'Extreme Greed 💀',
        cyclePhase, daysSinceHalving, inMR,
        dominance: +(globalData?.market_cap_percentage?.btc || 0).toFixed(1),
        bestScanTime: fgValue <= 35 ? '✅ Fear zone = SM beli = waktu akumulasi terbaik' : fgValue >= 75 ? '⚠️ Greed zone = SM distribusi = hati-hati' : '⚖️ Netral — selektif',
      },
      tierGroups,
      topPicks,
      allResults: results.slice(0, 60),
    });

  } catch (e) {
    return res.status(500).json({ error: e.message, results: [], totalAnalyzed: 0 });
  }
}

// Helper: format price properly
function fmtPrice(p) {
  if (!p || p <= 0) return '—';
  if (p >= 1000) return p.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (p >= 1) return p.toFixed(4);
  if (p >= 0.001) return p.toFixed(6);
  return p.toFixed(8);
}
