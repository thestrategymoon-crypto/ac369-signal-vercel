// api/data.js — AC369 Signal System v3.0
// SMC + Supply/Demand + Multi-Timeframe + Backtest Engine
// Sources: Binance Spot + Futures, Alternative.me, CoinGecko

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { source, ...params } = req.query;

  try {
    let url, data;

    // ─── FEAR & GREED ─────────────────────────────────────────────────
    if (source === 'feargreed') {
      url = 'https://api.alternative.me/fng/?limit=30&format=json';
      const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
      data = await r.json();

    // ─── COINGECKO GLOBAL ─────────────────────────────────────────────
    } else if (source === 'coingecko_global') {
      url = 'https://api.coingecko.com/api/v3/global';
      const r = await fetch(url, { headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(10000) });
      data = await r.json();

    // ─── COINGECKO TRENDING ───────────────────────────────────────────
    } else if (source === 'coingecko_trending') {
      url = 'https://api.coingecko.com/api/v3/search/trending';
      const r = await fetch(url, { headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(10000) });
      data = await r.json();

    // ─── BINANCE TRADES (CVD legacy) ──────────────────────────────────
    } else if (source === 'binance_trades') {
      const sym = params.symbol || 'BTCUSDT';
      url = `https://api.binance.com/api/v3/trades?symbol=${sym}&limit=1000`;
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(12000) });
      data = await r.json();

    // ─── ORDER BOOK DEPTH ─────────────────────────────────────────────
    } else if (source === 'binance_depth') {
      const sym = params.symbol || 'BTCUSDT';
      url = `https://api.binance.com/api/v3/depth?symbol=${sym}&limit=50`;
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) });
      data = await r.json();

    // ─── SPOT KLINES ──────────────────────────────────────────────────
    } else if (source === 'binance_klines') {
      const sym = params.symbol || 'BTCUSDT';
      const interval = params.interval || '4h';
      const limit = params.limit || '200';
      url = `https://api.binance.com/api/v3/klines?symbol=${sym}&interval=${interval}&limit=${limit}`;
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(12000) });
      const raw = await r.json();
      data = raw.map(k => ({ t: k[0], o: parseFloat(k[1]), h: parseFloat(k[2]), l: parseFloat(k[3]), c: parseFloat(k[4]), v: parseFloat(k[5]) }));

    // ─── FUTURES KLINES ───────────────────────────────────────────────
    } else if (source === 'futures_klines') {
      const sym = params.symbol || 'BTCUSDT';
      const interval = params.interval || '4h';
      const limit = params.limit || '200';
      url = `https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=${interval}&limit=${limit}`;
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(12000) });
      const raw = await r.json();
      data = raw.map(k => ({ t: k[0], o: parseFloat(k[1]), h: parseFloat(k[2]), l: parseFloat(k[3]), c: parseFloat(k[4]), v: parseFloat(k[5]), takerBuy: parseFloat(k[9]) }));

    // ─── OI HISTORY ───────────────────────────────────────────────────
    } else if (source === 'oi_history') {
      const sym = params.symbol || 'BTCUSDT';
      const period = params.period || '4h';
      const limit = params.limit || '50';
      url = `https://fapi.binance.com/futures/data/openInterestHist?symbol=${sym}&period=${period}&limit=${limit}`;
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10000) });
      data = await r.json();

    // ─── LONG/SHORT RATIO ─────────────────────────────────────────────
    } else if (source === 'longshort') {
      const sym = params.symbol || 'BTCUSDT';
      const period = params.period || '4h';
      const limit = params.limit || '50';
      url = `https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${sym}&period=${period}&limit=${limit}`;
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10000) });
      data = await r.json();

    // ─── TAKER VOLUME ─────────────────────────────────────────────────
    } else if (source === 'taker_volume') {
      const sym = params.symbol || 'BTCUSDT';
      const period = params.period || '4h';
      const limit = params.limit || '50';
      url = `https://fapi.binance.com/futures/data/takerlongshortRatio?symbol=${sym}&period=${period}&limit=${limit}`;
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10000) });
      data = await r.json();

    // ─── FUNDING RATE HISTORY ─────────────────────────────────────────
    } else if (source === 'funding') {
      const sym = params.symbol || 'BTCUSDT';
      url = `https://fapi.binance.com/fapi/v1/fundingRate?symbol=${sym}&limit=20`;
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) });
      data = await r.json();

    // ─── FUNDING CURRENT ──────────────────────────────────────────────
    } else if (source === 'funding_current') {
      const sym = params.symbol || 'BTCUSDT';
      url = `https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${sym}`;
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) });
      data = await r.json();

    // ─── FUTURES TICKER ───────────────────────────────────────────────
    } else if (source === 'futures_ticker') {
      const sym = params.symbol || 'BTCUSDT';
      url = `https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${sym}`;
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) });
      data = await r.json();

    // ─── SPOT TICKERS ─────────────────────────────────────────────────
    } else if (source === 'spot_tickers') {
      url = `https://api.binance.com/api/v3/ticker/24hr`;
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(12000) });
      const all = await r.json();
      data = all
        .filter(t => t.symbol.endsWith('USDT') && parseFloat(t.quoteVolume) > 10000000)
        .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
        .slice(0, 50)
        .map(t => ({ symbol: t.symbol, price: parseFloat(t.lastPrice), change: parseFloat(t.priceChangePercent), volume: parseFloat(t.quoteVolume), high: parseFloat(t.highPrice), low: parseFloat(t.lowPrice) }));

    // ═══════════════════════════════════════════════════════════════════
    // ─── SMC + SUPPLY/DEMAND DETECTION ────────────────────────────────
    // ═══════════════════════════════════════════════════════════════════
    } else if (source === 'smc') {
      const sym = params.symbol || 'BTCUSDT';
      const tf = params.interval || '4h';
      const limit = Math.min(parseInt(params.limit || '200'), 200);

      url = `https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=${tf}&limit=${limit}`;
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(12000) });
      const raw = await r.json();
      const K = raw.map(k => ({ t: k[0], o: parseFloat(k[1]), h: parseFloat(k[2]), l: parseFloat(k[3]), c: parseFloat(k[4]), v: parseFloat(k[5]) }));

      const currentPrice = K[K.length - 1].c;

      // ── HELPER: Average True Range
      const calcATR = (candles, period = 14) => {
        const trs = [];
        for (let i = 1; i < candles.length; i++) {
          trs.push(Math.max(
            candles[i].h - candles[i].l,
            Math.abs(candles[i].h - candles[i - 1].c),
            Math.abs(candles[i].l - candles[i - 1].c)
          ));
        }
        return trs.slice(-period).reduce((a, b) => a + b, 0) / period;
      };

      const atr = calcATR(K);

      // ── 1. SWING HIGHS & LOWS (Structure Points)
      const swingHighs = [], swingLows = [];
      const swingLookback = 3;
      for (let i = swingLookback; i < K.length - swingLookback; i++) {
        let isHigh = true, isLow = true;
        for (let j = i - swingLookback; j <= i + swingLookback; j++) {
          if (j === i) continue;
          if (K[j].h >= K[i].h) isHigh = false;
          if (K[j].l <= K[i].l) isLow = false;
        }
        if (isHigh) swingHighs.push({ idx: i, price: K[i].h, time: K[i].t });
        if (isLow) swingLows.push({ idx: i, price: K[i].l, time: K[i].t });
      }

      // ── 2. MARKET STRUCTURE (BOS / CHoCH)
      const structure = [];
      const recentHighs = swingHighs.slice(-6);
      const recentLows = swingLows.slice(-6);

      // BOS Bullish: price breaks above previous swing high
      for (let i = 1; i < recentHighs.length; i++) {
        if (recentHighs[i].price > recentHighs[i - 1].price) {
          structure.push({ type: 'BOS_BULL', price: recentHighs[i].price, time: recentHighs[i].time, label: 'BOS ▲', detail: 'Break of Structure — Bullish' });
        }
      }
      // BOS Bearish: price breaks below previous swing low
      for (let i = 1; i < recentLows.length; i++) {
        if (recentLows[i].price < recentLows[i - 1].price) {
          structure.push({ type: 'BOS_BEAR', price: recentLows[i].price, time: recentLows[i].time, label: 'BOS ▼', detail: 'Break of Structure — Bearish' });
        }
      }

      // CHoCH: last BOS was bearish but latest swing high breaks previous high (or vice versa)
      if (recentHighs.length >= 2 && recentLows.length >= 2) {
        const lastHigh = recentHighs[recentHighs.length - 1];
        const prevHigh = recentHighs[recentHighs.length - 2];
        const lastLow = recentLows[recentLows.length - 1];
        const prevLow = recentLows[recentLows.length - 2];

        // CHoCH Bullish: was making lower highs, now breaks above
        if (prevHigh.price > (recentHighs[recentHighs.length - 3]?.price || 0) &&
          lastHigh.price > prevHigh.price && lastLow.price > prevLow.price) {
          structure.push({ type: 'CHOCH_BULL', price: lastHigh.price, time: lastHigh.time, label: 'CHoCH ▲', detail: 'Change of Character — Bullish Reversal' });
        }
        // CHoCH Bearish: was making higher lows, now breaks below
        if (prevLow.price < (recentLows[recentLows.length - 3]?.price || Infinity) &&
          lastLow.price < prevLow.price && lastHigh.price < prevHigh.price) {
          structure.push({ type: 'CHOCH_BEAR', price: lastLow.price, time: lastLow.time, label: 'CHoCH ▼', detail: 'Change of Character — Bearish Reversal' });
        }
      }

      // ── 3. ORDER BLOCKS (OB)
      const orderBlocks = [];
      for (let i = 2; i < K.length - 1; i++) {
        const curr = K[i], next = K[i + 1], prev = K[i - 1];

        // Bullish OB: bearish candle immediately before strong bullish move
        if (curr.c < curr.o && next.c > next.o) {
          const moveSize = (next.c - next.o) / next.o;
          if (moveSize > 0.005) { // min 0.5% move
            const obHigh = Math.max(curr.o, curr.c);
            const obLow = Math.min(curr.o, curr.c);
            // Only valid if current price is above OB (not violated)
            const obMidVal = (obHigh + obLow) / 2;
            if (currentPrice > obLow) {
              orderBlocks.push({
                type: 'OB_BULL',
                high: obHigh,
                low: obLow,
                mid: obMidVal,
                time: curr.t,
                label: 'Bullish OB',
                detail: `Support zone $${obLow.toFixed(2)} — $${obHigh.toFixed(2)}`,
                distPct: ((currentPrice - obMidVal) / currentPrice * 100),
                violated: currentPrice < obLow
              });
            }
          }
        }

        // Bearish OB: bullish candle immediately before strong bearish move
        if (curr.c > curr.o && next.c < next.o) {
          const moveSize = (next.o - next.c) / next.o;
          if (moveSize > 0.005) {
            const obHigh = Math.max(curr.o, curr.c);
            const obLow = Math.min(curr.o, curr.c);
            if (currentPrice < obHigh) {
              orderBlocks.push({
                type: 'OB_BEAR',
                high: obHigh,
                low: obLow,
                mid: (obHigh + obLow) / 2,
                time: curr.t,
                label: 'Bearish OB',
                detail: `Resistance zone $${obLow.toFixed(2)} — $${obHigh.toFixed(2)}`,
                violated: currentPrice > obHigh
              });
            }
          }
        }
      }

      // Keep most recent 5 OBs each side, non-violated
      const bullishOBs = orderBlocks.filter(ob => ob.type === 'OB_BULL' && !ob.violated)
        .sort((a, b) => b.time - a.time).slice(0, 5);
      const bearishOBs = orderBlocks.filter(ob => ob.type === 'OB_BEAR' && !ob.violated)
        .sort((a, b) => b.time - a.time).slice(0, 5);

      // Nearest OBs to current price
      const nearestBullOB = bullishOBs.sort((a, b) => Math.abs(currentPrice - a.mid) - Math.abs(currentPrice - b.mid))[0] || null;
      const nearestBearOB = bearishOBs.sort((a, b) => Math.abs(currentPrice - a.mid) - Math.abs(currentPrice - b.mid))[0] || null;

      // ── 4. FAIR VALUE GAPS (FVG / Imbalance)
      const fvgs = [];
      for (let i = 1; i < K.length - 1; i++) {
        const prev = K[i - 1], curr = K[i], next = K[i + 1];

        // Bullish FVG: gap between prev.high and next.low (price moved up too fast)
        if (next.l > prev.h) {
          const fvgSize = (next.l - prev.h) / currentPrice;
          if (fvgSize > 0.001) { // min 0.1% size
            fvgs.push({
              type: 'FVG_BULL',
              high: next.l,
              low: prev.h,
              mid: (next.l + prev.h) / 2,
              time: curr.t,
              label: 'Bullish FVG',
              detail: `Imbalance $${prev.h.toFixed(2)} — $${next.l.toFixed(2)}`,
              filled: currentPrice < prev.h,
              sizePct: (fvgSize * 100).toFixed(2)
            });
          }
        }

        // Bearish FVG: gap between prev.low and next.high
        if (next.h < prev.l) {
          const fvgSize = (prev.l - next.h) / currentPrice;
          if (fvgSize > 0.001) {
            fvgs.push({
              type: 'FVG_BEAR',
              high: prev.l,
              low: next.h,
              mid: (prev.l + next.h) / 2,
              time: curr.t,
              label: 'Bearish FVG',
              detail: `Imbalance $${next.h.toFixed(2)} — $${prev.l.toFixed(2)}`,
              filled: currentPrice > prev.l,
              sizePct: (fvgSize * 100).toFixed(2)
            });
          }
        }
      }

      // Keep recent unfilled FVGs
      const bullFVGs = fvgs.filter(f => f.type === 'FVG_BULL' && !f.filled)
        .sort((a, b) => b.time - a.time).slice(0, 4);
      const bearFVGs = fvgs.filter(f => f.type === 'FVG_BEAR' && !f.filled)
        .sort((a, b) => b.time - a.time).slice(0, 4);

      const nearestBullFVG = bullFVGs.sort((a, b) => Math.abs(currentPrice - a.mid) - Math.abs(currentPrice - b.mid))[0] || null;
      const nearestBearFVG = bearFVGs.sort((a, b) => Math.abs(currentPrice - a.mid) - Math.abs(currentPrice - b.mid))[0] || null;

      // ── 5. SUPPLY & DEMAND ZONES
      const sdZones = [];
      const volumeThreshold = K.slice(-50).reduce((s, k) => s + k.v, 0) / 50 * 1.5; // 1.5x avg vol

      for (let i = 3; i < K.length - 1; i++) {
        const curr = K[i];
        const isHighVol = curr.v > volumeThreshold;
        const isBullCandle = curr.c > curr.o;
        const isBearCandle = curr.c < curr.o;
        const bodySize = Math.abs(curr.c - curr.o);
        const totalRange = curr.h - curr.l;
        const bodyRatio = totalRange > 0 ? bodySize / totalRange : 0;

        // Demand Zone: high volume bullish candle with strong body
        if (isHighVol && isBullCandle && bodyRatio > 0.6) {
          const zoneHigh = Math.max(curr.o, curr.c);
          const zoneLow = Math.min(curr.o, curr.c) - (atr * 0.3);
          if (currentPrice > zoneLow) {
            sdZones.push({
              type: 'DEMAND',
              high: zoneHigh,
              low: zoneLow,
              mid: (zoneHigh + zoneLow) / 2,
              time: curr.t,
              label: 'Demand Zone',
              detail: `Strong buy zone $${zoneLow.toFixed(2)} — $${zoneHigh.toFixed(2)}`,
              strength: isHighVol ? 'STRONG' : 'WEAK',
              volMultiple: (curr.v / (volumeThreshold / 1.5)).toFixed(1)
            });
          }
        }

        // Supply Zone: high volume bearish candle
        if (isHighVol && isBearCandle && bodyRatio > 0.6) {
          const zoneHigh = Math.max(curr.o, curr.c) + (atr * 0.3);
          const zoneLow = Math.min(curr.o, curr.c);
          if (currentPrice < zoneHigh) {
            sdZones.push({
              type: 'SUPPLY',
              high: zoneHigh,
              low: zoneLow,
              mid: (zoneHigh + zoneLow) / 2,
              time: curr.t,
              label: 'Supply Zone',
              detail: `Strong sell zone $${zoneLow.toFixed(2)} — $${zoneHigh.toFixed(2)}`,
              strength: isHighVol ? 'STRONG' : 'WEAK',
              volMultiple: (curr.v / (volumeThreshold / 1.5)).toFixed(1)
            });
          }
        }
      }

      const demandZones = sdZones.filter(z => z.type === 'DEMAND').sort((a, b) => b.time - a.time).slice(0, 4);
      const supplyZones = sdZones.filter(z => z.type === 'SUPPLY').sort((a, b) => b.time - a.time).slice(0, 4);
      const nearestDemand = demandZones.sort((a, b) => Math.abs(currentPrice - a.mid) - Math.abs(currentPrice - b.mid))[0] || null;
      const nearestSupply = supplyZones.sort((a, b) => Math.abs(currentPrice - a.mid) - Math.abs(currentPrice - b.mid))[0] || null;

      // ── 6. LIQUIDITY POOLS (Equal Highs/Lows = BSL/SSL)
      const liquidityPools = [];
      const equalTolerance = atr * 0.3;

      for (let i = 0; i < swingHighs.length - 1; i++) {
        for (let j = i + 1; j < swingHighs.length; j++) {
          if (Math.abs(swingHighs[i].price - swingHighs[j].price) < equalTolerance) {
            liquidityPools.push({
              type: 'BSL', // Buyside Liquidity
              price: (swingHighs[i].price + swingHighs[j].price) / 2,
              label: 'BSL (Equal Highs)',
              detail: 'Buyside liquidity resting above'
            });
            break;
          }
        }
      }
      for (let i = 0; i < swingLows.length - 1; i++) {
        for (let j = i + 1; j < swingLows.length; j++) {
          if (Math.abs(swingLows[i].price - swingLows[j].price) < equalTolerance) {
            liquidityPools.push({
              type: 'SSL', // Sellside Liquidity
              price: (swingLows[i].price + swingLows[j].price) / 2,
              label: 'SSL (Equal Lows)',
              detail: 'Sellside liquidity resting below'
            });
            break;
          }
        }
      }

      // ── 7. SMC BIAS SCORE
      let smcBull = 0, smcBear = 0;
      const smcSignals = [];

      // Structure bias
      const lastStructure = structure[structure.length - 1];
      if (lastStructure) {
        if (lastStructure.type.includes('BULL')) { smcBull += 3; smcSignals.push({ name: lastStructure.label, detail: lastStructure.detail, side: 'bull', weight: 3 }); }
        else { smcBear += 3; smcSignals.push({ name: lastStructure.label, detail: lastStructure.detail, side: 'bear', weight: 3 }); }
      }

      // Price at OB
      if (nearestBullOB) {
        const distPct = ((currentPrice - nearestBullOB.high) / currentPrice) * 100;
        if (Math.abs(distPct) < 3) { smcBull += 2; smcSignals.push({ name: 'Bullish OB', detail: `Price near OB ${nearestBullOB.low.toFixed(2)}-${nearestBullOB.high.toFixed(2)}`, side: 'bull', weight: 2 }); }
      }
      if (nearestBearOB) {
        const distPct = ((nearestBearOB.low - currentPrice) / currentPrice) * 100;
        if (Math.abs(distPct) < 3) { smcBear += 2; smcSignals.push({ name: 'Bearish OB', detail: `Price near OB ${nearestBearOB.low.toFixed(2)}-${nearestBearOB.high.toFixed(2)}`, side: 'bear', weight: 2 }); }
      }

      // FVG magnets
      if (nearestBullFVG) {
        const distPct = ((currentPrice - nearestBullFVG.high) / currentPrice) * 100;
        if (distPct > 0 && distPct < 5) { smcBull += 2; smcSignals.push({ name: 'Bullish FVG', detail: `Imbalance above ${nearestBullFVG.low.toFixed(2)}-${nearestBullFVG.high.toFixed(2)}`, side: 'bull', weight: 2 }); }
        else if (distPct < 0 && Math.abs(distPct) < 5) { smcBull += 1; smcSignals.push({ name: 'Bullish FVG', detail: `Price in FVG zone — fill likely`, side: 'bull', weight: 1 }); }
      }
      if (nearestBearFVG) {
        const distPct = ((nearestBearFVG.low - currentPrice) / currentPrice) * 100;
        if (distPct > 0 && distPct < 5) { smcBear += 2; smcSignals.push({ name: 'Bearish FVG', detail: `Imbalance below ${nearestBearFVG.low.toFixed(2)}-${nearestBearFVG.high.toFixed(2)}`, side: 'bear', weight: 2 }); }
      }

      // S/D zones
      if (nearestDemand) {
        const distPct = ((currentPrice - nearestDemand.high) / currentPrice) * 100;
        if (Math.abs(distPct) < 4) { smcBull += 2; smcSignals.push({ name: 'Demand Zone', detail: `${nearestDemand.strength} demand ${nearestDemand.low.toFixed(2)}-${nearestDemand.high.toFixed(2)} (${nearestDemand.volMultiple}x vol)`, side: 'bull', weight: 2 }); }
      }
      if (nearestSupply) {
        const distPct = ((nearestSupply.low - currentPrice) / currentPrice) * 100;
        if (Math.abs(distPct) < 4) { smcBear += 2; smcSignals.push({ name: 'Supply Zone', detail: `${nearestSupply.strength} supply ${nearestSupply.low.toFixed(2)}-${nearestSupply.high.toFixed(2)} (${nearestSupply.volMultiple}x vol)`, side: 'bear', weight: 2 }); }
      }

      // Liquidity
      const nearBSL = liquidityPools.filter(l => l.type === 'BSL' && l.price > currentPrice && (l.price - currentPrice) / currentPrice < 0.05);
      const nearSSL = liquidityPools.filter(l => l.type === 'SSL' && l.price < currentPrice && (currentPrice - l.price) / currentPrice < 0.05);
      if (nearBSL.length > 0) { smcBull += 1; smcSignals.push({ name: 'BSL Above', detail: `Buyside liquidity at ~$${nearBSL[0].price.toFixed(2)} — price likely hunts it`, side: 'bull', weight: 1 }); }
      if (nearSSL.length > 0) { smcBear += 1; smcSignals.push({ name: 'SSL Below', detail: `Sellside liquidity at ~$${nearSSL[0].price.toFixed(2)} — price may sweep it`, side: 'bear', weight: 1 }); }

      const totalSMC = smcBull + smcBear;
      const smcBullPct = totalSMC > 0 ? Math.round(smcBull / totalSMC * 100) : 50;

      data = {
        symbol: sym,
        timeframe: tf,
        currentPrice,
        atr: atr.toFixed(4),
        structure: structure.slice(-5),
        orderBlocks: { bull: bullishOBs.slice(0, 3), bear: bearishOBs.slice(0, 3), nearestBull: nearestBullOB, nearestBear: nearestBearOB },
        fvg: { bull: bullFVGs.slice(0, 3), bear: bearFVGs.slice(0, 3), nearestBull: nearestBullFVG, nearestBear: nearestBearFVG },
        supplyDemand: { demand: demandZones.slice(0, 3), supply: supplyZones.slice(0, 3), nearestDemand, nearestSupply },
        liquidity: { bsl: liquidityPools.filter(l => l.type === 'BSL').slice(-3), ssl: liquidityPools.filter(l => l.type === 'SSL').slice(-3) },
        smcBias: { bull: smcBull, bear: smcBear, bullPct: smcBullPct, bearPct: 100 - smcBullPct, signals: smcSignals },
        swings: { highs: swingHighs.slice(-5), lows: swingLows.slice(-5) },
        timestamp: Date.now()
      };

    // ═══════════════════════════════════════════════════════════════════
    // ─── MULTI-TIMEFRAME CONFLUENCE ───────────────────────────────────
    // ═══════════════════════════════════════════════════════════════════
    } else if (source === 'mtf') {
      const sym = params.symbol || 'BTCUSDT';

      // Fetch klines for 1H, 4H, 1D simultaneously
      const [k1h, k4h, k1d] = await Promise.all([
        fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=1h&limit=200`, { headers: { 'User-Agent': 'Mozilla/5.0' } }).then(r => r.json()),
        fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=4h&limit=200`, { headers: { 'User-Agent': 'Mozilla/5.0' } }).then(r => r.json()),
        fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=1d&limit=100`, { headers: { 'User-Agent': 'Mozilla/5.0' } }).then(r => r.json()),
      ]);

      const parseK = raw => raw.map(k => ({ t: k[0], o: parseFloat(k[1]), h: parseFloat(k[2]), l: parseFloat(k[3]), c: parseFloat(k[4]), v: parseFloat(k[5]) }));
      const K1h = parseK(k1h), K4h = parseK(k4h), K1d = parseK(k1d);

      // ── Indicators per TF
      const calcEMA = (closes, period) => {
        if (closes.length < period) return closes[closes.length - 1];
        const k = 2 / (period + 1);
        let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
        for (let i = period; i < closes.length; i++) ema = closes[i] * k + ema * (1 - k);
        return ema;
      };

      const calcRSI = (closes, period = 14) => {
        if (closes.length < period + 1) return 50;
        let gains = 0, losses = 0;
        for (let i = closes.length - period; i < closes.length; i++) {
          const diff = closes[i] - closes[i - 1];
          if (diff > 0) gains += diff; else losses -= diff;
        }
        const rs = gains / (losses || 0.001);
        return 100 - (100 / (1 + rs));
      };

      const analyzeTF = (K, tfName) => {
        const closes = K.map(k => k.c);
        const highs = K.map(k => k.h);
        const lows = K.map(k => k.l);
        const currentPrice = closes[closes.length - 1];

        const ema20 = calcEMA(closes, 20);
        const ema50 = calcEMA(closes, 50);
        const ema200 = calcEMA(closes, Math.min(200, closes.length));
        const rsi = calcRSI(closes);
        const ema12 = calcEMA(closes, 12);
        const ema26 = calcEMA(closes, 26);
        const macd = ema12 - ema26;

        // Trend determination
        const priceVsEma200 = currentPrice > ema200;
        const ema20VsEma50 = ema20 > ema50;
        const ema50VsEma200 = ema50 > ema200;

        // Higher highs / higher lows (last 10 candles)
        const recent = K.slice(-10);
        const hh = recent[recent.length - 1].h > recent[0].h;
        const hl = recent[recent.length - 1].l > recent[0].l;
        const lh = recent[recent.length - 1].h < recent[0].h;
        const ll = recent[recent.length - 1].l < recent[0].l;

        let trend, trendScore, signals = [];

        // Uptrend conditions
        let bullPoints = 0, bearPoints = 0;
        if (priceVsEma200) bullPoints += 2; else bearPoints += 2;
        if (ema20VsEma50) bullPoints += 1; else bearPoints += 1;
        if (ema50VsEma200) bullPoints += 1; else bearPoints += 1;
        if (macd > 0) bullPoints += 1; else bearPoints += 1;
        if (rsi > 50) bullPoints += 1; else bearPoints += 1;
        if (hh && hl) bullPoints += 2; else if (lh && ll) bearPoints += 2;

        const total = bullPoints + bearPoints;
        const bullPct = Math.round(bullPoints / total * 100);

        if (bullPct >= 70) trend = 'UPTREND';
        else if (bullPct >= 55) trend = 'BULLISH BIAS';
        else if (bullPct <= 30) trend = 'DOWNTREND';
        else if (bullPct <= 45) trend = 'BEARISH BIAS';
        else trend = 'RANGING';

        return {
          tf: tfName,
          trend,
          bullPct,
          bearPct: 100 - bullPct,
          currentPrice,
          ema20: parseFloat(ema20.toFixed(4)),
          ema50: parseFloat(ema50.toFixed(4)),
          ema200: parseFloat(ema200.toFixed(4)),
          rsi: parseFloat(rsi.toFixed(1)),
          macd: parseFloat(macd.toFixed(4)),
          priceVsEma200,
          ema20VsEma50,
          ema50VsEma200,
          hh, hl, lh, ll
        };
      };

      const tf1h = analyzeTF(K1h, '1H');
      const tf4h = analyzeTF(K4h, '4H');
      const tf1d = analyzeTF(K1d, '1D');

      // MTF Alignment Score
      const trendScore = (tf) => {
        if (tf.trend === 'UPTREND') return 3;
        if (tf.trend === 'BULLISH BIAS') return 2;
        if (tf.trend === 'RANGING') return 0;
        if (tf.trend === 'BEARISH BIAS') return -2;
        if (tf.trend === 'DOWNTREND') return -3;
        return 0;
      };

      const totalScore = trendScore(tf1h) + trendScore(tf4h) + trendScore(tf1d);
      // Max possible: 9 (all uptrend), Min: -9 (all downtrend)
      const normalizedBull = Math.round(((totalScore + 9) / 18) * 100);

      let mtfVerdict, mtfAction, mtfStrength;
      const isAligned1h4h = Math.abs(tf1h.bullPct - tf4h.bullPct) < 25;
      const isAligned4h1d = Math.abs(tf4h.bullPct - tf1d.bullPct) < 25;
      const fullyAligned = isAligned1h4h && isAligned4h1d;

      if (totalScore >= 6) { mtfVerdict = 'STRONG BULL ALIGNMENT'; mtfStrength = 'HIGH'; mtfAction = 'ALL 3 TF BULLISH — Entry conditions favorable'; }
      else if (totalScore >= 3) { mtfVerdict = 'BULL ALIGNMENT'; mtfStrength = 'MEDIUM'; mtfAction = 'Majority TF bullish — Look for entry on pullback'; }
      else if (totalScore <= -6) { mtfVerdict = 'STRONG BEAR ALIGNMENT'; mtfStrength = 'HIGH'; mtfAction = 'ALL 3 TF BEARISH — Short conditions favorable'; }
      else if (totalScore <= -3) { mtfVerdict = 'BEAR ALIGNMENT'; mtfStrength = 'MEDIUM'; mtfAction = 'Majority TF bearish — Look for short entry'; }
      else { mtfVerdict = 'NO ALIGNMENT'; mtfStrength = 'LOW'; mtfAction = 'TF conflict — WAIT for alignment before entry'; }

      data = {
        symbol: sym,
        timestamp: Date.now(),
        mtfVerdict,
        mtfAction,
        mtfStrength,
        totalScore,
        normalizedBull,
        fullyAligned,
        timeframes: { '1H': tf1h, '4H': tf4h, '1D': tf1d }
      };

    // ═══════════════════════════════════════════════════════════════════
    // ─── CONFLUENCE v3 (includes SMC + MTF) ───────────────────────────
    // ═══════════════════════════════════════════════════════════════════
    } else if (source === 'confluence') {
      const sym = params.symbol || 'BTCUSDT';

      const [
        klines4h, klines1d, oiHist, lsRatio,
        takerVol, fundingRes, depthRes, fngRes
      ] = await Promise.allSettled([
        fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=4h&limit=200`).then(r => r.json()),
        fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=1d&limit=100`).then(r => r.json()),
        fetch(`https://fapi.binance.com/futures/data/openInterestHist?symbol=${sym}&period=4h&limit=20`).then(r => r.json()),
        fetch(`https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${sym}&period=4h&limit=10`).then(r => r.json()),
        fetch(`https://fapi.binance.com/futures/data/takerlongshortRatio?symbol=${sym}&period=4h&limit=10`).then(r => r.json()),
        fetch(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${sym}`).then(r => r.json()),
        fetch(`https://api.binance.com/api/v3/depth?symbol=${sym}&limit=50`).then(r => r.json()),
        fetch(`https://api.alternative.me/fng/?limit=1&format=json`).then(r => r.json()),
      ]);

      const calcEMA = (closes, period) => {
        if (closes.length < period) return closes[closes.length - 1];
        const k = 2 / (period + 1);
        let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
        for (let i = period; i < closes.length; i++) ema = closes[i] * k + ema * (1 - k);
        return ema;
      };
      const calcRSI = (closes, period = 14) => {
        if (closes.length < period + 1) return 50;
        let gains = 0, losses = 0;
        for (let i = closes.length - period; i < closes.length; i++) {
          const diff = closes[i] - closes[i - 1];
          if (diff > 0) gains += diff; else losses -= diff;
        }
        return 100 - (100 / (1 + gains / (losses || 0.001)));
      };

      const scores = { bull: 0, bear: 0, signals: [] };

      // SIGNAL 1+2: HTF Trend + EMA Cross
      if (klines1d.status === 'fulfilled' && Array.isArray(klines1d.value)) {
        const closes = klines1d.value.map(k => parseFloat(k[4]));
        const price = closes[closes.length - 1];
        const ema200 = calcEMA(closes, Math.min(200, closes.length));
        const ema50 = calcEMA(closes, Math.min(50, closes.length));
        if (price > ema200) { scores.bull += 2; scores.signals.push({ name: 'HTF Trend', value: 'BULLISH', detail: `Price > EMA200 ($${ema200.toFixed(0)})`, weight: 2, side: 'bull' }); }
        else { scores.bear += 2; scores.signals.push({ name: 'HTF Trend', value: 'BEARISH', detail: `Price < EMA200 ($${ema200.toFixed(0)})`, weight: 2, side: 'bear' }); }
        if (ema50 > ema200) { scores.bull += 1; scores.signals.push({ name: 'EMA Cross', value: 'GOLDEN', detail: 'EMA50 > EMA200', weight: 1, side: 'bull' }); }
        else { scores.bear += 1; scores.signals.push({ name: 'EMA Cross', value: 'DEATH', detail: 'EMA50 < EMA200', weight: 1, side: 'bear' }); }
      }

      // SIGNAL 3+4: RSI + MACD 4H
      if (klines4h.status === 'fulfilled' && Array.isArray(klines4h.value)) {
        const closes = klines4h.value.map(k => parseFloat(k[4]));
        const rsi = calcRSI(closes);
        const macd = calcEMA(closes, 12) - calcEMA(closes, 26);
        if (rsi < 35) { scores.bull += 2; scores.signals.push({ name: 'RSI 4H', value: rsi.toFixed(1), detail: 'Oversold Zone', weight: 2, side: 'bull' }); }
        else if (rsi > 70) { scores.bear += 2; scores.signals.push({ name: 'RSI 4H', value: rsi.toFixed(1), detail: 'Overbought Zone', weight: 2, side: 'bear' }); }
        else if (rsi < 50) { scores.bull += 1; scores.signals.push({ name: 'RSI 4H', value: rsi.toFixed(1), detail: 'Below Midline', weight: 1, side: 'bull' }); }
        else { scores.bear += 1; scores.signals.push({ name: 'RSI 4H', value: rsi.toFixed(1), detail: 'Above Midline', weight: 1, side: 'bear' }); }
        if (macd > 0) { scores.bull += 1; scores.signals.push({ name: 'MACD 4H', value: macd.toFixed(2), detail: 'Bullish Momentum', weight: 1, side: 'bull' }); }
        else { scores.bear += 1; scores.signals.push({ name: 'MACD 4H', value: macd.toFixed(2), detail: 'Bearish Momentum', weight: 1, side: 'bear' }); }
      }

      // SIGNAL 5: OI + Price
      if (oiHist.status === 'fulfilled' && Array.isArray(oiHist.value) && oiHist.value.length >= 5) {
        const oiVals = oiHist.value.map(o => parseFloat(o.sumOpenInterest));
        const oiChg = ((oiVals[oiVals.length - 1] - oiVals[oiVals.length - 5]) / oiVals[oiVals.length - 5]) * 100;
        const closes4h = klines4h.status === 'fulfilled' ? klines4h.value.map(k => parseFloat(k[4])) : [];
        const priceUp = closes4h.length > 5 && closes4h[closes4h.length - 1] > closes4h[closes4h.length - 5];
        if (oiChg > 2 && priceUp) { scores.bull += 2; scores.signals.push({ name: 'OI + Price', value: `OI +${oiChg.toFixed(1)}%`, detail: 'Long Buildup', weight: 2, side: 'bull' }); }
        else if (oiChg > 2 && !priceUp) { scores.bear += 2; scores.signals.push({ name: 'OI + Price', value: `OI +${oiChg.toFixed(1)}%`, detail: 'Short Buildup', weight: 2, side: 'bear' }); }
        else if (oiChg < -2 && !priceUp) { scores.bull += 1; scores.signals.push({ name: 'OI + Price', value: `OI ${oiChg.toFixed(1)}%`, detail: 'Long Squeeze Done', weight: 1, side: 'bull' }); }
        else { scores.signals.push({ name: 'OI + Price', value: `OI ${oiChg.toFixed(1)}%`, detail: 'Neutral', weight: 0, side: 'neutral' }); }
      }

      // SIGNAL 6: L/S Ratio
      if (lsRatio.status === 'fulfilled' && Array.isArray(lsRatio.value) && lsRatio.value.length > 0) {
        const ls = parseFloat(lsRatio.value[lsRatio.value.length - 1].longShortRatio);
        if (ls < 0.9) { scores.bull += 2; scores.signals.push({ name: 'L/S Ratio', value: ls.toFixed(2), detail: 'Retail Majority Short → Contrarian LONG', weight: 2, side: 'bull' }); }
        else if (ls > 1.8) { scores.bear += 2; scores.signals.push({ name: 'L/S Ratio', value: ls.toFixed(2), detail: 'Retail Majority Long → Contrarian SHORT', weight: 2, side: 'bear' }); }
        else { scores.signals.push({ name: 'L/S Ratio', value: ls.toFixed(2), detail: 'Balanced', weight: 0, side: 'neutral' }); }
      }

      // SIGNAL 7: Taker CVD
      if (takerVol.status === 'fulfilled' && Array.isArray(takerVol.value) && takerVol.value.length > 0) {
        const avgBuy = takerVol.value.slice(-5).reduce((s, v) => s + parseFloat(v.buySellRatio), 0) / 5;
        if (avgBuy > 1.1) { scores.bull += 2; scores.signals.push({ name: 'Taker CVD', value: avgBuy.toFixed(2), detail: 'Buyers Aggressive', weight: 2, side: 'bull' }); }
        else if (avgBuy < 0.9) { scores.bear += 2; scores.signals.push({ name: 'Taker CVD', value: avgBuy.toFixed(2), detail: 'Sellers Aggressive', weight: 2, side: 'bear' }); }
        else { scores.signals.push({ name: 'Taker CVD', value: avgBuy.toFixed(2), detail: 'Neutral CVD', weight: 0, side: 'neutral' }); }
      }

      // SIGNAL 8: Funding Rate
      if (fundingRes.status === 'fulfilled' && fundingRes.value.lastFundingRate) {
        const fr = parseFloat(fundingRes.value.lastFundingRate) * 100;
        if (fr < -0.05) { scores.bull += 2; scores.signals.push({ name: 'Funding Rate', value: `${fr.toFixed(4)}%`, detail: 'Extremely Negative → Long Opportunity', weight: 2, side: 'bull' }); }
        else if (fr > 0.1) { scores.bear += 2; scores.signals.push({ name: 'Funding Rate', value: `${fr.toFixed(4)}%`, detail: 'Overheated Longs → Short Risk', weight: 2, side: 'bear' }); }
        else if (fr < 0) { scores.bull += 1; scores.signals.push({ name: 'Funding Rate', value: `${fr.toFixed(4)}%`, detail: 'Negative → Slight Long Bias', weight: 1, side: 'bull' }); }
        else { scores.signals.push({ name: 'Funding Rate', value: `${fr.toFixed(4)}%`, detail: 'Neutral', weight: 0, side: 'neutral' }); }
      }

      // SIGNAL 9: Order Book Imbalance
      if (depthRes.status === 'fulfilled' && depthRes.value.bids) {
        const bidVol = depthRes.value.bids.reduce((s, b) => s + parseFloat(b[1]), 0);
        const askVol = depthRes.value.asks.reduce((s, a) => s + parseFloat(a[1]), 0);
        const imbalance = bidVol / (bidVol + askVol);
        if (imbalance > 0.6) { scores.bull += 1; scores.signals.push({ name: 'Order Book', value: `${(imbalance * 100).toFixed(0)}% Bid`, detail: 'Bid Wall Dominant', weight: 1, side: 'bull' }); }
        else if (imbalance < 0.4) { scores.bear += 1; scores.signals.push({ name: 'Order Book', value: `${((1 - imbalance) * 100).toFixed(0)}% Ask`, detail: 'Ask Wall Dominant', weight: 1, side: 'bear' }); }
        else { scores.signals.push({ name: 'Order Book', value: `${(imbalance * 100).toFixed(0)}% Bid`, detail: 'Balanced Book', weight: 0, side: 'neutral' }); }
      }

      // SIGNAL 10: Fear & Greed
      if (fngRes.status === 'fulfilled' && fngRes.value.data) {
        const fng = parseInt(fngRes.value.data[0].value);
        const fngLabel = fngRes.value.data[0].value_classification;
        if (fng <= 20) { scores.bull += 2; scores.signals.push({ name: 'Fear & Greed', value: `${fng} — ${fngLabel}`, detail: 'Extreme Fear = Buy Zone', weight: 2, side: 'bull' }); }
        else if (fng >= 80) { scores.bear += 2; scores.signals.push({ name: 'Fear & Greed', value: `${fng} — ${fngLabel}`, detail: 'Extreme Greed = Caution', weight: 2, side: 'bear' }); }
        else if (fng < 40) { scores.bull += 1; scores.signals.push({ name: 'Fear & Greed', value: `${fng} — ${fngLabel}`, detail: 'Fear Zone', weight: 1, side: 'bull' }); }
        else { scores.signals.push({ name: 'Fear & Greed', value: `${fng} — ${fngLabel}`, detail: 'Neutral Zone', weight: 0, side: 'neutral' }); }
      }

      const totalWeight = scores.bull + scores.bear;
      const bullPct = totalWeight > 0 ? Math.round((scores.bull / totalWeight) * 100) : 50;
      let verdict, strength, action;
      if (bullPct >= 70) { verdict = 'STRONG LONG'; strength = 'HIGH'; action = 'ENTRY VALID — Confluence ≥70% Bullish'; }
      else if (bullPct >= 55) { verdict = 'LONG BIAS'; strength = 'MEDIUM'; action = 'CAUTIOUS LONG — Wait for confirmation'; }
      else if (bullPct <= 30) { verdict = 'STRONG SHORT'; strength = 'HIGH'; action = 'ENTRY VALID — Confluence ≥70% Bearish'; }
      else if (bullPct <= 45) { verdict = 'SHORT BIAS'; strength = 'MEDIUM'; action = 'CAUTIOUS SHORT — Wait for confirmation'; }
      else { verdict = 'NEUTRAL'; strength = 'LOW'; action = 'NO TRADE — Market unclear, wait for setup'; }

      data = { symbol: sym, timestamp: Date.now(), verdict, strength, action, bullScore: scores.bull, bearScore: scores.bear, bullPct, bearPct: 100 - bullPct, signals: scores.signals };

    // ─── SOURCE NOT FOUND ─────────────────────────────────────────────
    } else {
      return res.status(400).json({ error: `Unknown source: ${source}` });
    }

    res.setHeader('Cache-Control', 's-maxage=15');
    return res.status(200).json(data);

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
