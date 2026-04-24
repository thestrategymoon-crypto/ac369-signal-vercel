// api/scanner-full.js — AC369 FUSION v10.2
// UNIFIED: Satu versi bersih dari dua versi yang conflict
// SCAN: 1000 koin dari Binance spot + futures data
// SCORING: momentum + volume + range + RSI proxy + astro + halving cycle

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const startTime = Date.now();

    // ── FETCH TICKERS ──────────────────────────────────────────────
    const [spotRes, futuresRes] = await Promise.allSettled([
      fetch('https://api.binance.com/api/v3/ticker/24hr', { signal: AbortSignal.timeout(12000) }).then(r => r.json()),
      fetch('https://fapi.binance.com/fapi/v1/ticker/24hr', { signal: AbortSignal.timeout(12000) }).then(r => r.json()),
    ]);

    if (spotRes.status !== 'fulfilled' || !Array.isArray(spotRes.value)) {
      throw new Error('Spot ticker fetch failed');
    }

    const spotTickers = spotRes.value;
    const futuresMap = {};
    if (futuresRes.status === 'fulfilled' && Array.isArray(futuresRes.value)) {
      futuresRes.value.forEach(t => { futuresMap[t.symbol] = t; });
    }

    // ── ASTRO CALCULATIONS (computed once, applied to all) ────────
    const jdNow = (Date.now() / 86400000) + 2440587.5;
    const refNM = 2460320.5;
    const syn = 29.53058867;
    const daysSinceNM = ((jdNow - refNM) % syn + syn) % syn;
    const halvingDate = new Date('2024-04-20');
    const daysSinceHalving = Math.floor((Date.now() - halvingDate.getTime()) / 86400000);
    const today = new Date();
    const month = today.getMonth() + 1;
    const dayOfWeek = today.getDay();

    // Moon phase
    let moonPhase, moonEmoji, moonBias, moonBonus;
    if (daysSinceNM < 1.5) { moonPhase = 'New Moon'; moonEmoji = '🌑'; moonBias = 'BULL'; moonBonus = 2; }
    else if (daysSinceNM < 7.5) { moonPhase = 'Waxing'; moonEmoji = '🌒'; moonBias = 'BULL'; moonBonus = 1; }
    else if (daysSinceNM < 8.5) { moonPhase = 'First Quarter'; moonEmoji = '🌓'; moonBias = 'NEUTRAL'; moonBonus = 0; }
    else if (daysSinceNM < 14) { moonPhase = 'Waxing Gibbous'; moonEmoji = '🌔'; moonBias = 'BULL'; moonBonus = 1; }
    else if (daysSinceNM < 16) { moonPhase = 'Full Moon'; moonEmoji = '🌕'; moonBias = 'NEUTRAL'; moonBonus = -1; }
    else if (daysSinceNM < 22) { moonPhase = 'Waning'; moonEmoji = '🌖'; moonBias = 'BEAR'; moonBonus = -1; }
    else { moonPhase = 'Dark Moon'; moonEmoji = '🌘'; moonBias = 'BULL'; moonBonus = 1; }

    // Halving cycle bonus
    let halvingPhase, halvingBonus;
    if (daysSinceHalving < 90) { halvingPhase = 'Post-Halving Early'; halvingBonus = 0; }
    else if (daysSinceHalving < 365) { halvingPhase = 'Bull Cycle Early'; halvingBonus = 2; }
    else if (daysSinceHalving < 547) { halvingPhase = 'Bull Cycle Peak'; halvingBonus = 1; }
    else if (daysSinceHalving < 730) { halvingPhase = 'Distribution'; halvingBonus = -1; }
    else { halvingPhase = 'Bear Market'; halvingBonus = -2; }

    // Month seasonality
    const monthBonuses = { 1: 1, 2: 1, 3: 0, 4: 1, 5: -1, 6: -1, 7: 0, 8: 0, 9: -2, 10: 2, 11: 2, 12: 1 };
    const monthBonus = monthBonuses[month] || 0;

    // Day of week
    const dayBonuses = [0, 1, 0, 0, 1, -1, -1];
    const dayBonus = dayBonuses[dayOfWeek] || 0;

    const astroTotal = moonBonus + halvingBonus + monthBonus + dayBonus;
    const astroStr = `${moonEmoji} ${moonPhase}\n${halvingPhase} ${Math.floor(daysSinceNM)}d`;

    // ── FILTER COINS ─────────────────────────────────────────────
    const STABLECOINS = new Set(['USDT', 'USDC', 'BUSD', 'TUSD', 'DAI', 'FDUSD', 'USDP', 'SUSD', 'GUSD', 'FRAX', 'LUSD', 'CRVUSD', 'USDD', 'USTC', 'PYUSD', 'HUSD']);
    const IGNORE_SUFFIX = ['UP', 'DOWN', 'BEAR', 'BULL', '3L', '3S', '2L', '2S'];
    const IGNORE_TOKENS = new Set(['USDTUSDT', 'BUSDUSDT', 'USDCUSDT', 'TUSDUSDT', 'FDUSDUSDT', 'BTCDOMUSDT', 'DEFIUSDT']);

    const filtered = spotTickers.filter(t => {
      const sym = t.symbol;
      if (!sym.endsWith('USDT')) return false;
      if (IGNORE_TOKENS.has(sym)) return false;
      const base = sym.replace('USDT', '');
      if (STABLECOINS.has(base)) return false;
      if (IGNORE_SUFFIX.some(s => base.endsWith(s))) return false;
      if (parseFloat(t.quoteVolume) < 1000000) return false; // Min $1M volume
      if (parseFloat(t.lastPrice) <= 0) return false;
      return true;
    });

    // Sort by volume (highest liquidity first)
    filtered.sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume));

    // Process up to 1000 coins
    const results = [];

    for (const t of filtered.slice(0, 1000)) {
      const sym = t.symbol;
      const base = sym.replace('USDT', '');
      const price = parseFloat(t.lastPrice);
      const change24h = parseFloat(t.priceChangePercent);
      const volume24h = parseFloat(t.quoteVolume);
      const highPrice = parseFloat(t.highPrice);
      const lowPrice = parseFloat(t.lowPrice);
      const openPrice = parseFloat(t.openPrice);
      const prevClosePrice = parseFloat(t.prevClosePrice);
      const countTrades = parseInt(t.count) || 0;

      let score = 0;
      const signals = [];
      let pattern = 'Sideways Stabil';
      let elliottBias = '-';
      let smcBias = '-';

      // ── 1. PRICE MOMENTUM SCORE ───────────────────────────────
      if (change24h >= 15) { score += 6; signals.push(`+${change24h.toFixed(1)}% Mega Breakout`); pattern = 'Breakout Bullish Kuat'; }
      else if (change24h >= 8) { score += 5; signals.push(`+${change24h.toFixed(1)}% Strong Breakout`); pattern = 'Breakout Bullish Kuat'; }
      else if (change24h >= 4) { score += 4; signals.push(`+${change24h.toFixed(1)}% Bullish`); pattern = 'Breakout Bullish Awal'; }
      else if (change24h >= 2) { score += 2; signals.push(`+${change24h.toFixed(1)}% Naik`); pattern = 'Breakout Bullish Awal'; }
      else if (change24h >= 0.5) { score += 1; signals.push('Slightly Bullish'); pattern = 'Sideways Stabil'; }
      else if (change24h <= -15) { score -= 6; signals.push(`${change24h.toFixed(1)}% Mega Crash`); pattern = 'Breakdown Bearish Kuat'; }
      else if (change24h <= -8) { score -= 5; signals.push(`${change24h.toFixed(1)}% Strong Drop`); pattern = 'Breakdown Bearish Kuat'; }
      else if (change24h <= -4) { score -= 4; signals.push(`${change24h.toFixed(1)}% Bearish`); pattern = 'Breakdown Bearish'; }
      else if (change24h <= -2) { score -= 2; signals.push(`${change24h.toFixed(1)}% Turun`); pattern = 'Sideways Turun'; }
      else if (change24h <= -0.5) { score -= 1; signals.push('Slightly Bearish'); pattern = 'Sideways Turun'; }

      // ── 2. RANGE POSITION (proxy BB position) ────────────────
      const rangePos = highPrice > lowPrice ? (price - lowPrice) / (highPrice - lowPrice) : 0.5;
      if (rangePos >= 0.85) { score += 2; signals.push('Near Day High'); }
      else if (rangePos >= 0.65) { score += 1; signals.push('Upper Range'); }
      else if (rangePos <= 0.15) { score += 1; signals.push('Near Day Low — Potential Bounce'); }
      else if (rangePos <= 0.35) score -= 1;

      // ── 3. VOLUME SCORE ───────────────────────────────────────
      const volScore = volume24h >= 500_000_000 ? 4 : volume24h >= 100_000_000 ? 3 : volume24h >= 30_000_000 ? 2 : volume24h >= 10_000_000 ? 1 : 0;
      if (volScore > 0 && change24h > 0) {
        score += volScore;
        signals.push(`Vol $${(volume24h / 1e6).toFixed(0)}M`);
      } else if (volScore > 0 && change24h < 0) {
        score -= Math.floor(volScore / 2); // Volume down = more bearish
      }

      // ── 4. FUTURES PRESENCE + FUNDING ────────────────────────
      const hasFutures = !!futuresMap[sym];
      if (hasFutures) {
        const futTicker = futuresMap[sym];
        const futChange = parseFloat(futTicker.priceChangePercent || 0);
        // Futures premium/discount
        const futPrice = parseFloat(futTicker.lastPrice || price);
        const premium = ((futPrice - price) / price) * 100;
        if (premium > 0.3 && change24h > 0) { score += 1; signals.push('Futures Premium'); }
        else if (premium < -0.3 && change24h < 0) { score -= 1; signals.push('Futures Discount'); }
        if (change24h > 2) { elliottBias = 'Potensi Wave 3'; smcBias = 'Bullish'; }
        else if (change24h < -2) { elliottBias = 'Koreksi ABC'; smcBias = 'Bearish'; }
      }

      // ── 5. CANDLE PATTERN PROXY ───────────────────────────────
      // Open vs close vs high vs low analysis
      if (openPrice > 0 && prevClosePrice > 0) {
        const gapUp = (openPrice - prevClosePrice) / prevClosePrice * 100;
        const bodyPct = Math.abs(price - openPrice) / (highPrice - lowPrice + 0.000001);
        const lowerWick = (Math.min(price, openPrice) - lowPrice) / (highPrice - lowPrice + 0.000001);
        const upperWick = (highPrice - Math.max(price, openPrice)) / (highPrice - lowPrice + 0.000001);

        if (gapUp > 2) { score += 1; signals.push('Gap Up'); }
        if (gapUp < -2) { score -= 1; signals.push('Gap Down'); }
        if (lowerWick > 0.4 && bodyPct < 0.3 && price > openPrice) { score += 1; signals.push('Bullish Pin Bar'); pattern = 'Pola Pembalikan Bullish'; }
        if (upperWick > 0.4 && bodyPct < 0.3 && price < openPrice) { score -= 1; signals.push('Bearish Pin Bar'); }
        if (bodyPct > 0.7 && price > openPrice) { score += 1; signals.push('Strong Bull Candle'); }
        if (bodyPct > 0.7 && price < openPrice) { score -= 1; signals.push('Strong Bear Candle'); }
      }

      // ── 6. ASTRO LAYER ────────────────────────────────────────
      score += astroTotal;

      // ── 7. PATTERN REFINEMENT ────────────────────────────────
      if (change24h > 5 && volScore >= 2) {
        pattern = 'Breakout Bullish Kuat';
        elliottBias = 'Potensi Wave 3';
        smcBias = 'Bullish';
      } else if (change24h < -5 && volScore >= 2) {
        pattern = 'Breakdown Bearish Kuat';
        elliottBias = 'Koreksi ABC';
        smcBias = 'Bearish';
      } else if (Math.abs(change24h) < 0.5 && rangePos > 0.4 && rangePos < 0.6) {
        pattern = 'Sideways Stabil';
        elliottBias = 'Wave 4/Konsolidasi';
      }

      // ── PROBABILITY MAPPING ───────────────────────────────────
      const normalizedScore = Math.max(-10, Math.min(10, score));
      let probability;
      if (normalizedScore >= 7) probability = 100;
      else if (normalizedScore >= 5) probability = 90;
      else if (normalizedScore >= 4) probability = 82;
      else if (normalizedScore >= 3) probability = 76;
      else if (normalizedScore >= 2) probability = 72;
      else if (normalizedScore >= 1) probability = 65;
      else if (normalizedScore >= 0) probability = 50;
      else if (normalizedScore >= -1) probability = 40;
      else if (normalizedScore >= -2) probability = 30;
      else probability = 20;

      let probLabel;
      if (probability >= 90) probLabel = '🔥 Sangat Tinggi';
      else if (probability >= 76) probLabel = '🔥 Sangat Tinggi';
      else if (probability >= 65) probLabel = '📊 Tinggi';
      else if (probability >= 50) probLabel = '🟢 Pantau';
      else probLabel = '🔴 Rendah';

      const expectedMove = change24h > 0
        ? `+${Math.min(change24h * 1.2, 30).toFixed(1)}%`
        : `${Math.max(change24h * 1.2, -30).toFixed(1)}%`;

      // ── CHART PATTERN (more detailed) ────────────────────────
      let chartPatterns = [];
      if (lowerWick > 0 || rangePos !== 0.5) {
        // Derive from intraday data
        const bodyRatio = (highPrice - lowPrice) > 0 ? Math.abs(price - openPrice) / (highPrice - lowPrice) : 0.5;
        const lw = (Math.min(price, openPrice) - lowPrice) / (highPrice - lowPrice + 0.0001);
        const uw = (highPrice - Math.max(price, openPrice)) / (highPrice - lowPrice + 0.0001);

        if (lw > 0.45 && bodyRatio < 0.25 && price >= openPrice) {
          chartPatterns.push({ name: 'Bullish Pin Bar', signal: 'bullish', probability: 72 });
        }
        if (uw > 0.45 && bodyRatio < 0.25 && price <= openPrice) {
          chartPatterns.push({ name: 'Bearish Pin Bar', signal: 'bearish', probability: 72 });
        }
        if (change24h > 0 && rangePos > 0.75 && bodyRatio > 0.6) {
          chartPatterns.push({ name: 'Strong Bullish Candle', signal: 'bullish', probability: 65 });
        }
        if (change24h < 0 && rangePos < 0.25 && bodyRatio > 0.6) {
          chartPatterns.push({ name: 'Strong Bearish Candle', signal: 'bearish', probability: 65 });
        }
        if (Math.abs(bodyRatio - 0.5) < 0.15 && lw < 0.2 && uw < 0.2) {
          chartPatterns.push({ name: 'Doji', signal: 'neutral', probability: 50 });
        }
        if (chartPatterns.length === 0) {
          if (change24h > 2) chartPatterns.push({ name: 'Momentum Naik', signal: 'bullish', probability: 60 });
          else if (change24h < -2) chartPatterns.push({ name: 'Momentum Turun', signal: 'bearish', probability: 60 });
          else chartPatterns.push({ name: 'Sideways', signal: 'neutral', probability: 45 });
        }
      }

      results.push({
        rank: 0,
        symbol: base,
        fullSymbol: sym,
        price,
        change24h: parseFloat(change24h.toFixed(2)),
        volume24h,
        openPrice,
        highPrice,
        lowPrice,
        rangePos: parseFloat(rangePos.toFixed(3)),
        countTrades,
        pattern,
        chartPatterns: chartPatterns.slice(0, 3),
        elliottWave: elliottBias || '-',
        smc: smcBias || '-',
        astro: astroStr,
        breakoutProbability: {
          score: probability,
          reasons: signals.slice(0, 4),
          interpretation: probLabel,
        },
        probability,
        probLabel,
        score: parseFloat(score.toFixed(1)),
        signals: signals.slice(0, 4),
        hasFutures,
        reason: expectedMove,
        // For backward compatibility with index.html scanner
        name: base,
        priceChange24h: change24h,
        volume24h,
        // SMC compatibility
        smc: { signal: smcBias !== '-' ? smcBias : 'Neutral', summary: signals.slice(0, 2).join(', ') },
        // Elliott compatibility
        elliottWave: { wave: elliottBias !== '-' ? elliottBias : '-', confidence: probability, description: pattern },
        // Astro compatibility
        astrology: { signal: astroStr.split('\n')[0], moonPhase, illumination: Math.round(daysSinceNM / syn * 100), interpretation: halvingPhase },
      });
    }

    // Sort by score (desc), then by probability, then by volume
    results.sort((a, b) => b.score - a.score || b.probability - a.probability || b.volume24h - a.volume24h);
    results.forEach((r, i) => { r.rank = i + 1; });

    // ── MARKET OVERVIEW ───────────────────────────────────────────
    const allChanges = results.map(r => r.change24h);
    const bullishCount = allChanges.filter(c => c > 1).length;
    const bearishCount = allChanges.filter(c => c < -1).length;
    const neutralCount = results.length - bullishCount - bearishCount;
    const avgChange = allChanges.length ? parseFloat((allChanges.reduce((a, b) => a + b, 0) / allChanges.length).toFixed(2)) : 0;
    const marketMood = avgChange > 3 ? 'STRONG_BULL' : avgChange > 1 ? 'BULLISH' : avgChange < -3 ? 'STRONG_BEAR' : avgChange < -1 ? 'BEARISH' : 'NEUTRAL';

    const top20Bull = results.filter(r => r.score > 0).slice(0, 20);
    const top10Bear = results.filter(r => r.score < 0).slice(0, 10);
    const volumeBreakouts = results.filter(r => r.volume24h > 100_000_000 && Math.abs(r.change24h) > 3).slice(0, 15);
    const rsiExtremeBull = results.filter(r => r.probability >= 76 && r.score > 0).slice(0, 10);
    const rsiExtremeBear = results.filter(r => r.probability >= 76 && r.score < 0).slice(0, 10);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    res.setHeader('Cache-Control', 's-maxage=30');
    return res.status(200).json({
      timestamp: Date.now(),
      totalScanned: results.length,
      scanDuration: elapsed,
      astroContext: {
        moonPhase, moonEmoji, moonBias, halvingPhase, halvingBonus,
        daysSinceNM: parseFloat(daysSinceNM.toFixed(1)),
        daysSinceHalving,
        astroTotal,
      },
      marketOverview: {
        bullishCount,
        bearishCount,
        neutralCount,
        avgChange24h: avgChange,
        marketMood,
        highProbSetups: rsiExtremeBull.length,
        btcDominanceProxy: null, // Filled by macro endpoint
      },
      results,
      topSetups: {
        bullish: top20Bull,
        bearish: top10Bear,
        highProbBull: rsiExtremeBull,
        highProbBear: rsiExtremeBear,
        volumeBreakout: volumeBreakouts,
        rsiExtreme: { bull: rsiExtremeBull, bear: rsiExtremeBear },
      },
    });

  } catch (e) {
    return res.status(500).json({ error: e.message, timestamp: Date.now() });
  }
}
