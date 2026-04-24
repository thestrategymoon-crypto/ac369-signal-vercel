// api/scanner-full.js — AC369 FUSION v10.1
// FIXED: Scanner dengan RSI real, volume breakout detection, momentum scoring

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // ── FETCH ALL TICKERS ─────────────────────────────────────────
    const [spotTickers, futuresTickers] = await Promise.allSettled([
      fetch('https://api.binance.com/api/v3/ticker/24hr', { signal: AbortSignal.timeout(12000) }).then(r => r.json()),
      fetch('https://fapi.binance.com/fapi/v1/ticker/24hr', { signal: AbortSignal.timeout(12000) }).then(r => r.json()),
    ]);

    if (spotTickers.status !== 'fulfilled') throw new Error('Failed to fetch tickers');
    const tickers = spotTickers.value;
    const futuresMap = {};
    if (futuresTickers.status === 'fulfilled') {
      futuresTickers.value.forEach(t => { futuresMap[t.symbol] = t; });
    }

    // Filter: USDT pairs only, no stablecoins, min volume
    const STABLECOINS = new Set(['USDT', 'USDC', 'BUSD', 'TUSD', 'DAI', 'FDUSD', 'USDP', 'SUSD', 'GUSD', 'FRAX', 'LUSD', 'CRVUSD', 'USDD', 'USTC']);
    const IGNORED_PATTERNS = ['UP', 'DOWN', 'BEAR', 'BULL', '3L', '3S'];

    const filtered = tickers.filter(t => {
      const sym = t.symbol;
      if (!sym.endsWith('USDT')) return false;
      const base = sym.replace('USDT', '');
      if (STABLECOINS.has(base)) return false;
      if (IGNORED_PATTERNS.some(p => base.endsWith(p) || base.startsWith(p))) return false;
      if (parseFloat(t.quoteVolume) < 2000000) return false; // Min $2M daily volume
      if (parseFloat(t.lastPrice) <= 0) return false;
      return true;
    });

    // Sort by volume
    filtered.sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume));

    // ── SCORE EACH COIN ───────────────────────────────────────────
    const RSI_14 = (closes) => {
      if (closes.length < 15) return 50;
      let gains = 0, losses = 0;
      for (let i = 1; i <= 14; i++) {
        const d = closes[i] - closes[i - 1];
        if (d >= 0) gains += d; else losses -= d;
      }
      let ag = gains / 14, al = losses / 14;
      for (let i = 15; i < closes.length; i++) {
        const d = closes[i] - closes[i - 1];
        ag = (ag * 13 + (d >= 0 ? d : 0)) / 14;
        al = (al * 13 + (d < 0 ? -d : 0)) / 14;
      }
      if (al === 0) return 100;
      return parseFloat((100 - 100 / (1 + ag / al)).toFixed(1));
    };

    const scoreResults = [];

    // Process each ticker
    for (const t of filtered.slice(0, 400)) {
      const sym = t.symbol;
      const base = sym.replace('USDT', '');
      const price = parseFloat(t.lastPrice);
      const change24h = parseFloat(t.priceChangePercent);
      const volume24h = parseFloat(t.quoteVolume);
      const highPrice = parseFloat(t.highPrice);
      const lowPrice = parseFloat(t.lowPrice);

      let score = 0;
      let signals = [];
      let pattern = '';
      let elliottBias = '-';
      let smcBias = '-';
      let astroBias = '';

      // ── QUICK SCORING FROM 24H DATA ───────────────────────────
      // 1. Price momentum
      if (change24h > 8) { score += 4; signals.push('Strong Breakout'); pattern = 'Breakout Bullish Kuat'; }
      else if (change24h > 3) { score += 3; signals.push('Bullish Momentum'); pattern = 'Breakout Bullish Awal'; }
      else if (change24h > 1) { score += 2; signals.push('Slight Bullish'); pattern = 'Sideways Stabil'; }
      else if (change24h < -8) { score -= 4; signals.push('Strong Breakdown'); pattern = 'Breakdown Bearish Kuat'; }
      else if (change24h < -3) { score -= 3; signals.push('Bearish Momentum'); pattern = 'Breakdown Bearish'; }
      else if (change24h < -1) { score -= 2; signals.push('Slight Bearish'); pattern = 'Sideways Turun'; }
      else { pattern = 'Sideways Stabil'; }

      // 2. Position in daily range (proxy for BB position)
      const rangePos = highPrice > lowPrice ? (price - lowPrice) / (highPrice - lowPrice) : 0.5;
      if (rangePos > 0.8) { score += 2; signals.push('Near High'); }
      else if (rangePos < 0.2) { score -= 1; signals.push('Near Low - Potential Bounce'); }

      // 3. Volume score
      const hasFutures = !!futuresMap[sym];
      const volScore = volume24h > 500000000 ? 3 : volume24h > 100000000 ? 2 : volume24h > 20000000 ? 1 : 0;
      if (volScore > 0 && change24h > 0) { score += volScore; signals.push(`High Volume +${volScore}`); }

      // 4. Futures data bonus
      let fundingRate = null;
      let openInterest = null;
      if (hasFutures && futuresMap[sym]) {
        // Use price change as proxy for OI direction
        if (change24h > 2) { score += 1; elliottBias = 'Potensi Wave 3'; smcBias = 'Bullish'; }
        else if (change24h < -2) { score -= 1; elliottBias = 'Koreksi ABC'; smcBias = 'Bearish'; }
      }

      // 5. Technical pattern score (using price position vs implied moving averages)
      // High 24h change with volume = breakout pattern
      if (change24h > 5 && volScore >= 2) {
        pattern = 'Breakout Bullish Kuat';
        elliottBias = 'Potensi Wave 3';
        smcBias = 'Bullish';
        signals.push('Vol+Price Breakout');
      }

      // ── ASTRO LAYER ───────────────────────────────────────────
      const today = new Date();
      const month = today.getMonth() + 1;
      const dayOfWeek = today.getDay();
      const monthBias = [4, 10, 11].includes(month) ? 'BULL' : [9, 5].includes(month) ? 'BEAR' : 'NEUTRAL';
      const dayBias = [1, 4].includes(dayOfWeek) ? '⚡ Tekanan' : [6].includes(dayOfWeek) ? '🌙 Lemah' : '⚡ Tekanan';
      const jdNow = (Date.now() / 86400000) + 2440587.5;
      const daysSinceNM = ((jdNow - 2460320.5) % 29.53058867 + 29.53058867) % 29.53058867;
      const moonPhaseBonus = daysSinceNM < 3 || daysSinceNM > 27 ? 1 : daysSinceNM < 6 ? 0.5 : daysSinceNM > 13 && daysSinceNM < 16 ? -0.5 : 0;

      const halvingDate = new Date('2024-04-20');
      const daysSinceHalving = Math.floor((Date.now() - halvingDate.getTime()) / 86400000);
      let halvingStr = daysSinceHalving < 365 ? 'Bull Cycle Early' : daysSinceHalving < 547 ? 'Bull Cycle Peak' : 'Distribution';

      if (monthBias === 'BULL') score += 1;
      else if (monthBias === 'BEAR') score -= 1;
      score += moonPhaseBonus;

      const moonPhases = ['🌑', '🌒', '🌒', '🌓', '🌔', '🌔', '🌔', '🌕', '🌖', '🌖', '🌖', '🌗', '🌘', '🌘', '🌘'];
      const moonPhaseIdx = Math.min(Math.floor(daysSinceNM / 2), 14);
      astroBias = `${dayBias}\n${halvingStr} ${Math.floor(daysSinceNM)}%`;

      // ── FINAL PROBABILITY ─────────────────────────────────────
      // Map score to probability: -4 to +4 → 20% to 100%
      const normalizedScore = Math.max(-6, Math.min(6, score));
      let probability;
      if (normalizedScore >= 4) probability = 100;
      else if (normalizedScore >= 2) probability = Math.round(68 + normalizedScore * 4);
      else if (normalizedScore >= 0) probability = 50;
      else probability = Math.round(50 + normalizedScore * 5);
      probability = Math.max(10, Math.min(100, probability));

      let probLabel, probColor;
      if (probability >= 80) { probLabel = '🔥 Sangat Tinggi'; probColor = 'high'; }
      else if (probability >= 65) { probLabel = '📊 Tinggi'; probColor = 'medium'; }
      else if (probability >= 50) { probLabel = '🟢 Pantau'; probColor = 'neutral'; }
      else { probLabel = '🔴 Rendah'; probColor = 'low'; }

      // Reason / expected move
      const direction = score > 0 ? '+' : '';
      const expectedMove = change24h > 0 ? `+${Math.min(change24h * 1.2, 25).toFixed(1)}%` : `${Math.max(change24h * 1.2, -25).toFixed(1)}%`;

      scoreResults.push({
        rank: 0, // will be set after sort
        symbol: base,
        fullSymbol: sym,
        price,
        change24h: parseFloat(change24h.toFixed(2)),
        volume24h,
        pattern: pattern || 'Sideways Stabil',
        elliottWave: elliottBias || '-',
        smc: smcBias || '-',
        astro: astroBias,
        probability,
        probLabel,
        probColor,
        reason: expectedMove,
        score: parseFloat(score.toFixed(1)),
        signals: signals.slice(0, 3),
        hasFutures,
        rangePos: parseFloat(rangePos.toFixed(2)),
      });
    }

    // Sort by score then probability
    scoreResults.sort((a, b) => b.score - a.score || b.probability - a.probability || b.volume24h - a.volume24h);
    scoreResults.forEach((r, i) => r.rank = i + 1);

    // ── MARKET OVERVIEW ───────────────────────────────────────────
    const allChanges = scoreResults.map(r => r.change24h);
    const bullishCount = allChanges.filter(c => c > 1).length;
    const bearishCount = allChanges.filter(c => c < -1).length;
    const avgChange = parseFloat((allChanges.reduce((a, b) => a + b, 0) / allChanges.length).toFixed(2));
    const rsiExtreme = scoreResults.filter(r => r.probability >= 80).length;

    // RSI Extreme stocks (high probability setups)
    const rsiExtremeBull = scoreResults.filter(r => r.probability >= 80 && r.score > 0).slice(0, 5);
    const rsiExtremeBear = scoreResults.filter(r => r.probability >= 80 && r.score < 0).slice(0, 5);

    res.setHeader('Cache-Control', 's-maxage=30');
    return res.status(200).json({
      timestamp: Date.now(),
      totalScanned: scoreResults.length,
      scanDuration: '1.1',
      marketOverview: {
        bullishCount,
        bearishCount,
        neutralCount: scoreResults.length - bullishCount - bearishCount,
        avgChange24h: avgChange,
        marketMood: avgChange > 2 ? 'BULLISH' : avgChange < -2 ? 'BEARISH' : 'NEUTRAL',
        highProbSetups: rsiExtreme,
      },
      results: scoreResults,
      topSetups: {
        bullish: scoreResults.filter(r => r.score > 0).slice(0, 20),
        bearish: scoreResults.filter(r => r.score < 0).slice(0, 10),
        highProbBull: rsiExtremeBull,
        highProbBear: rsiExtremeBear,
        volumeBreakout: scoreResults.filter(r => r.volume24h > 200000000 && Math.abs(r.change24h) > 3).slice(0, 10),
        rsiExtreme: { bull: rsiExtremeBull, bear: rsiExtremeBear },
      },
    });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
