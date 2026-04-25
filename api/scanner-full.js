// api/scanner-full.js — AC369 FUSION v10.6 FINAL
// PRIMARY: Binance Spot api/v3/ticker/24hr (tidak pernah diblokir)
// FALLBACK: Binance Futures → CoinGecko markets
// SCAN: 1000+ koin, 8 faktor scoring

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const sf = async (url, ms = 12000) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
      const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } });
      clearTimeout(t); if (!r.ok) return null; return await r.json();
    } catch { clearTimeout(t); return null; }
  };

  try {
    const start = Date.now();

    // ── FETCH TICKERS ─────────────────────────────────────────────
    // 1. Binance Spot (never geo-blocked, full market data)
    let rawTickers = await sf('https://api.binance.com/api/v3/ticker/24hr');
    let dataSource = 'binance_spot';

    // 2. Binance Futures fallback
    if (!Array.isArray(rawTickers) || rawTickers.length < 50) {
      rawTickers = await sf('https://fapi.binance.com/fapi/v1/ticker/24hr');
      dataSource = 'binance_futures';
    }

    // 3. CoinGecko last resort
    if (!Array.isArray(rawTickers) || rawTickers.length < 50) {
      const cgRes = await sf('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=volume_desc&per_page=250&page=1&sparkline=false&price_change_percentage=24h');
      if (Array.isArray(cgRes) && cgRes.length > 10) {
        // Normalize to Binance-like format
        rawTickers = cgRes.map(c => ({
          symbol: (c.symbol || '').toUpperCase() + 'USDT',
          lastPrice: String(c.current_price || 0),
          priceChangePercent: String(c.price_change_percentage_24h || 0),
          quoteVolume: String(c.total_volume || 0),
          highPrice: String((c.current_price || 0) * 1.05),
          lowPrice: String((c.current_price || 0) * 0.95),
          openPrice: String((c.current_price || 0) / (1 + (c.price_change_percentage_24h || 0) / 100)),
          prevClosePrice: String((c.current_price || 0) / (1 + (c.price_change_percentage_24h || 0) / 100)),
          _cg: true,
        }));
        dataSource = 'coingecko';
      }
    }

    if (!Array.isArray(rawTickers) || rawTickers.length === 0) {
      return res.status(500).json({ error: 'All ticker sources failed', results: [], totalScanned: 0, timestamp: Date.now() });
    }

    // ── ASTRO (computed once, used for all coins) ──────────────────
    const jdNow = Date.now() / 86400000 + 2440587.5;
    const daysSinceNM = ((jdNow - 2460320.5) % 29.53058867 + 29.53058867) % 29.53058867;
    const halvingDate = new Date('2024-04-20');
    const daysSinceHalving = Math.floor((Date.now() - halvingDate.getTime()) / 86400000);
    const month = new Date().getMonth() + 1;
    const dow = new Date().getDay();

    let moonPhase, moonEmoji, moonBonus;
    if (daysSinceNM < 1.5) { moonPhase = 'New Moon'; moonEmoji = '🌑'; moonBonus = 2; }
    else if (daysSinceNM < 7.5) { moonPhase = 'Waxing Crescent'; moonEmoji = '🌒'; moonBonus = 1; }
    else if (daysSinceNM < 8.5) { moonPhase = 'First Quarter'; moonEmoji = '🌓'; moonBonus = 0; }
    else if (daysSinceNM < 14) { moonPhase = 'Waxing Gibbous'; moonEmoji = '🌔'; moonBonus = 1; }
    else if (daysSinceNM < 16) { moonPhase = 'Full Moon'; moonEmoji = '🌕'; moonBonus = -1; }
    else if (daysSinceNM < 22) { moonPhase = 'Waning'; moonEmoji = '🌖'; moonBonus = -1; }
    else { moonPhase = 'Dark Moon'; moonEmoji = '🌘'; moonBonus = 1; }

    let halvingPhase, halvingBonus;
    if (daysSinceHalving < 90) { halvingPhase = 'Post-Halving'; halvingBonus = 0; }
    else if (daysSinceHalving < 365) { halvingPhase = 'Bull Cycle Early'; halvingBonus = 2; }
    else if (daysSinceHalving < 547) { halvingPhase = 'Bull Cycle Peak'; halvingBonus = 1; }
    else if (daysSinceHalving < 730) { halvingPhase = 'Distribution'; halvingBonus = -1; }
    else { halvingPhase = 'Bear Market'; halvingBonus = -2; }

    const monthBonus = { 1: 1, 2: 1, 3: 0, 4: 1, 5: -1, 6: -1, 7: 0, 8: 0, 9: -2, 10: 2, 11: 2, 12: 1 }[month] || 0;
    const dayBonus = [0, 1, 0, 0, 1, -1, -1][dow] || 0;
    const astroTotal = moonBonus + halvingBonus + monthBonus + dayBonus;
    const astroStr = `${moonEmoji} ${moonPhase}`;

    // ── FILTER STABLECOINS / LEVERAGED TOKENS ─────────────────────
    const STABLES = new Set(['USDT', 'USDC', 'BUSD', 'TUSD', 'DAI', 'FDUSD', 'USDP', 'SUSD', 'GUSD', 'FRAX', 'LUSD', 'CRVUSD', 'USDD', 'USTC', 'PYUSD', 'HUSD']);
    const IGNORE_TOKENS = new Set(['USDTUSDT', 'BUSDUSDT', 'USDCUSDT', 'TUSDUSDT', 'FDUSDUSDT', 'BTCDOMUSDT', 'DEFIUSDT']);
    const BAD_SUFFIX = ['UP', 'DOWN', 'BEAR', 'BULL', '3L', '3S', '2L', '2S', '5L', '5S'];

    const filtered = rawTickers.filter(t => {
      if (!t || typeof t !== 'object') return false;
      const sym = String(t.symbol || '');
      if (!sym.endsWith('USDT')) return false;
      if (IGNORE_TOKENS.has(sym)) return false;
      const base = sym.replace('USDT', '');
      if (STABLES.has(base)) return false;
      if (BAD_SUFFIX.some(s => base.endsWith(s) || base.startsWith(s))) return false;
      if (+(t.quoteVolume || 0) < 500000) return false;
      if (+(t.lastPrice || 0) <= 0) return false;
      return true;
    });

    // Sort by volume desc
    filtered.sort((a, b) => +(b.quoteVolume || 0) - +(a.quoteVolume || 0));

    // ── SCORE EACH COIN ───────────────────────────────────────────
    const results = [];

    for (const t of filtered.slice(0, 1000)) {
      const base = t.symbol.replace('USDT', '');
      const price = +(t.lastPrice || 0);
      const change24h = +(t.priceChangePercent || 0);
      const vol24h = +(t.quoteVolume || 0);
      const high = +(t.highPrice || price * 1.02);
      const low = +(t.lowPrice || price * 0.98);
      const open = +(t.openPrice || t.prevClosePrice || price);
      if (price <= 0) continue;

      let score = 0;
      const signals = [];
      let pattern = 'Sideways Stabil';
      let elliottBias = '-';
      let smcBias = '-';

      // ── 1. PRICE MOMENTUM ──────────────────────────────────────
      if (change24h >= 15) { score += 7; signals.push(`🚀 +${change24h.toFixed(1)}%`); pattern = 'Breakout Bullish Kuat'; }
      else if (change24h >= 8) { score += 5; signals.push(`+${change24h.toFixed(1)}% Strong`); pattern = 'Breakout Bullish Kuat'; }
      else if (change24h >= 4) { score += 4; signals.push(`+${change24h.toFixed(1)}%`); pattern = 'Breakout Bullish Awal'; }
      else if (change24h >= 2) { score += 2; signals.push(`+${change24h.toFixed(1)}% Naik`); }
      else if (change24h >= 0.5) { score += 1; signals.push('Slight Bullish'); }
      else if (change24h <= -15) { score -= 7; signals.push(`💥 ${change24h.toFixed(1)}%`); pattern = 'Breakdown Bearish Kuat'; }
      else if (change24h <= -8) { score -= 5; signals.push(`${change24h.toFixed(1)}% Strong`); pattern = 'Breakdown Bearish Kuat'; }
      else if (change24h <= -4) { score -= 4; signals.push(`${change24h.toFixed(1)}%`); pattern = 'Breakdown Bearish'; }
      else if (change24h <= -2) { score -= 2; signals.push(`${change24h.toFixed(1)}% Turun`); pattern = 'Sideways Turun'; }
      else if (change24h <= -0.5) { score -= 1; signals.push('Slight Bearish'); }

      // ── 2. RANGE POSITION ──────────────────────────────────────
      const range = high - low;
      const rangePos = range > 0 ? (price - low) / range : 0.5;
      if (rangePos >= 0.85) { score += 2; signals.push('Near High'); }
      else if (rangePos >= 0.70) { score += 1; }
      else if (rangePos <= 0.15) { score += 1; signals.push('Near Low/Bounce'); }
      else if (rangePos <= 0.30) { score -= 1; }

      // ── 3. VOLUME ─────────────────────────────────────────────
      const volScore = vol24h >= 500e6 ? 4 : vol24h >= 100e6 ? 3 : vol24h >= 30e6 ? 2 : vol24h >= 10e6 ? 1 : 0;
      if (volScore > 0 && change24h > 0) { score += volScore; signals.push(`Vol $${(vol24h / 1e6).toFixed(0)}M`); }
      else if (volScore >= 2 && change24h < 0) { score -= 1; }

      // ── 4. CANDLE BODY ANALYSIS ────────────────────────────────
      if (open > 0 && range > 0) {
        const body = Math.abs(price - open);
        const bodyR = body / range;
        const lw = (Math.min(price, open) - low) / range;
        const uw = (high - Math.max(price, open)) / range;
        if (lw > 0.45 && bodyR < 0.25 && price >= open) { score += 2; signals.push('Bullish Pin Bar'); pattern = 'Pola Pembalikan Bullish'; }
        else if (uw > 0.45 && bodyR < 0.25 && price <= open) { score -= 2; signals.push('Bearish Pin Bar'); }
        else if (bodyR > 0.7 && price > open) { score += 1; signals.push('Strong Bull Candle'); }
        else if (bodyR > 0.7 && price < open) { score -= 1; signals.push('Strong Bear Candle'); }
        if (price > open * 1.03) { score += 1; signals.push('Gap Up'); }
        if (price < open * 0.97) { score -= 1; signals.push('Gap Down'); }
      }

      // ── 5. VOL+PRICE BREAKOUT ──────────────────────────────────
      if (vol24h > 200e6 && Math.abs(change24h) > 5) {
        score += 2; signals.push('Vol+Price Breakout');
        pattern = change24h > 0 ? 'Breakout Bullish Kuat' : 'Breakdown Bearish Kuat';
      }

      // ── 6. ELLIOTT WAVE BIAS ──────────────────────────────────
      if (change24h >= 4 && rangePos >= 0.6) { elliottBias = 'Potensi Wave 3'; smcBias = 'Bullish'; score += 1; }
      else if (change24h <= -4 && rangePos <= 0.4) { elliottBias = 'Koreksi ABC'; smcBias = 'Bearish'; score -= 1; }
      else if (Math.abs(change24h) < 1.5 && rangePos > 0.35 && rangePos < 0.65) { elliottBias = 'Wave 4/Konsolidasi'; smcBias = 'Neutral'; }
      else if (change24h >= 2 && rangePos >= 0.75) { elliottBias = 'Wave 5/Puncak'; }
      else if (change24h > 0) { elliottBias = 'Wave 1/3 Developing'; smcBias = 'Bullish'; }

      // ── 7. SMC REFINEMENT ─────────────────────────────────────
      if (change24h >= 5 && volScore >= 2) { smcBias = 'Bullish'; pattern = 'Breakout Bullish Kuat'; elliottBias = 'Potensi Wave 3'; score += 1; }
      else if (change24h <= -5 && volScore >= 2) { smcBias = 'Bearish'; pattern = 'Breakdown Bearish Kuat'; elliottBias = 'Koreksi ABC'; score -= 1; }
      else if (change24h > 2 && rangePos > 0.7) { smcBias = 'Bullish — OB potensial'; }
      else if (change24h < -2 && rangePos < 0.3) { smcBias = 'Bearish — SSL potensial'; }

      // ── 8. ASTRO ──────────────────────────────────────────────
      score += astroTotal;

      // ── PROBABILITY ───────────────────────────────────────────
      const ns = Math.max(-10, Math.min(10, score));
      const prob = ns >= 8 ? 100 : ns >= 6 ? 92 : ns >= 5 ? 85 : ns >= 4 ? 80 : ns >= 3 ? 75 : ns >= 2 ? 70 : ns >= 1 ? 63 : ns >= 0 ? 50 : ns >= -1 ? 40 : ns >= -2 ? 32 : 22;
      const probLabel = prob >= 85 ? '🔥 Sangat Tinggi' : prob >= 70 ? '📊 Tinggi' : prob >= 50 ? '🟢 Pantau' : '🔴 Rendah';

      // Chart patterns
      const chartPatterns = [];
      if (open > 0 && range > 0) {
        const body = Math.abs(price - open), bodyR = body / range;
        const lw = (Math.min(price, open) - low) / range, uw = (high - Math.max(price, open)) / range;
        if (lw > 0.45 && bodyR < 0.25 && price >= open) chartPatterns.push({ name: 'Bullish Pin Bar', signal: 'bullish', probability: 73 });
        if (uw > 0.45 && bodyR < 0.25 && price <= open) chartPatterns.push({ name: 'Bearish Pin Bar', signal: 'bearish', probability: 72 });
        if (change24h > 0 && rangePos > 0.75 && bodyR > 0.6) chartPatterns.push({ name: 'Strong Bullish Candle', signal: 'bullish', probability: 65 });
        if (change24h < 0 && rangePos < 0.25 && bodyR > 0.6) chartPatterns.push({ name: 'Strong Bearish Candle', signal: 'bearish', probability: 65 });
        if (Math.abs(bodyR - 0.1) < 0.1 && lw < 0.2 && uw < 0.2) chartPatterns.push({ name: 'Doji', signal: 'neutral', probability: 50 });
      }
      if (!chartPatterns.length) {
        chartPatterns.push({ name: change24h > 2 ? 'Momentum Naik' : change24h < -2 ? 'Momentum Turun' : 'Sideways', signal: change24h > 2 ? 'bullish' : change24h < -2 ? 'bearish' : 'neutral', probability: 55 });
      }

      results.push({
        rank: 0, symbol: base, fullSymbol: t.symbol, name: base,
        price, change24h: +change24h.toFixed(2), priceChange24h: +change24h.toFixed(2),
        volume24h: vol24h, highPrice: high, lowPrice: low, rangePos: +rangePos.toFixed(3),
        pattern, chartPatterns: chartPatterns.slice(0, 2),
        elliottWave: { wave: elliottBias, confidence: prob, description: pattern },
        smc: { signal: smcBias !== '-' ? smcBias : 'Neutral', summary: signals.slice(0, 2).join(' | ') },
        astrology: { signal: astroStr, moonPhase, illumination: Math.round(daysSinceNM / 29.53 * 100), interpretation: halvingPhase },
        breakoutProbability: { score: prob, reasons: signals.slice(0, 4), interpretation: probLabel },
        probability: prob, probLabel, score: +score.toFixed(1),
        signals: signals.slice(0, 4),
        reason: change24h >= 0 ? `+${Math.min(change24h * 1.2, 30).toFixed(1)}%` : `${Math.max(change24h * 1.2, -30).toFixed(1)}%`,
        astro: `${astroStr}\n${halvingPhase}`,
      });
    }

    results.sort((a, b) => b.score - a.score || b.probability - a.probability || b.volume24h - a.volume24h);
    results.forEach((r, i) => { r.rank = i + 1; });

    const allChg = results.map(r => r.change24h);
    const bullCnt = allChg.filter(c => c > 1).length;
    const bearCnt = allChg.filter(c => c < -1).length;
    const avgChg = allChg.length ? +(allChg.reduce((a, b) => a + b, 0) / allChg.length).toFixed(2) : 0;

    res.setHeader('Cache-Control', 's-maxage=30');
    return res.status(200).json({
      timestamp: Date.now(),
      totalScanned: results.length,
      scanDuration: ((Date.now() - start) / 1000).toFixed(1),
      dataSource,
      astroContext: { moonPhase, moonEmoji, halvingPhase, daysSinceNM: +daysSinceNM.toFixed(1), astroTotal },
      marketOverview: { bullishCount: bullCnt, bearishCount: bearCnt, neutralCount: results.length - bullCnt - bearCnt, avgChange24h: avgChg, marketMood: avgChg > 3 ? 'STRONG_BULL' : avgChg > 1 ? 'BULLISH' : avgChg < -3 ? 'STRONG_BEAR' : avgChg < -1 ? 'BEARISH' : 'NEUTRAL' },
      results,
      topSetups: {
        bullish: results.filter(r => r.score > 0).slice(0, 50),
        bearish: results.filter(r => r.score < 0).slice(0, 20),
        highProbBull: results.filter(r => r.probability >= 75 && r.score > 0).slice(0, 20),
        volumeBreakout: results.filter(r => r.volume24h > 100e6 && Math.abs(r.change24h) > 3).slice(0, 20),
      },
    });
  } catch (e) {
    return res.status(500).json({ error: e.message, results: [], totalScanned: 0, timestamp: Date.now() });
  }
}
