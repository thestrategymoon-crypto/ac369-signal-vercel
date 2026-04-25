// api/scanner-full.js — AC369 FUSION v10.6
// SOURCE: Binance Spot (primary) → Futures → CoinGecko
// 1000+ coins, 8-factor scoring, Elliott+SMC+Astro labels

import { ft, getAstro } from './_lib.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  res.setHeader('Cache-Control', 's-maxage=30');

  const startTime = Date.now();

  try {
    // ── FETCH ALL TICKERS ──────────────────────────────────────────────────
    let rawTickers = null;
    let dataSource = 'binance_spot';

    // 1. Binance Spot (never blocked by Vercel)
    const binance = await ft('https://api.binance.com/api/v3/ticker/24hr');
    if (Array.isArray(binance) && binance.length > 100) {
      rawTickers = binance;
    }

    // 2. Binance Futures fallback
    if (!rawTickers) {
      const fut = await ft('https://fapi.binance.com/fapi/v1/ticker/24hr');
      if (Array.isArray(fut) && fut.length > 50) {
        rawTickers = fut;
        dataSource = 'binance_futures';
      }
    }

    // 3. CoinGecko last resort
    if (!rawTickers) {
      const cg = await ft('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=volume_desc&per_page=250&page=1&sparkline=false&price_change_percentage=24h');
      if (Array.isArray(cg) && cg.length > 10) {
        rawTickers = cg.map(c => ({
          symbol: (c.symbol || '').toUpperCase() + 'USDT',
          lastPrice: String(c.current_price || 0),
          priceChangePercent: String(c.price_change_percentage_24h || 0),
          quoteVolume: String(c.total_volume || 0),
          highPrice: String(c.high_24h || c.current_price || 0),
          lowPrice: String(c.low_24h || c.current_price || 0),
          openPrice: String((c.current_price || 0) / (1 + (c.price_change_percentage_24h || 0) / 100)),
        }));
        dataSource = 'coingecko';
      }
    }

    if (!Array.isArray(rawTickers) || rawTickers.length === 0) {
      return res.status(500).json({ error: 'All ticker sources failed', results: [], totalScanned: 0 });
    }

    // ── ASTRO (computed once) ──────────────────────────────────────────────
    const astro = getAstro();

    // ── FILTER ────────────────────────────────────────────────────────────
    const STABLES = new Set(['USDT','USDC','BUSD','TUSD','DAI','FDUSD','USDP','SUSD','GUSD','FRAX','LUSD','CRVUSD','USDD','PYUSD','HUSD']);
    const IGNORE = new Set(['USDTUSDT','BUSDUSDT','USDCUSDT','TUSDUSDT','FDUSDUSDT','BTCDOMUSDT','DEFIUSDT']);
    const BAD_SUFFIX = ['UP','DOWN','BEAR','BULL','3L','3S','2L','2S','5L','5S'];

    const filtered = rawTickers.filter(t => {
      if (!t || typeof t !== 'object') return false;
      const sym = String(t.symbol || '');
      if (!sym.endsWith('USDT')) return false;
      if (IGNORE.has(sym)) return false;
      const base = sym.replace('USDT', '');
      if (STABLES.has(base)) return false;
      if (BAD_SUFFIX.some(s => base.endsWith(s) || base.startsWith(s))) return false;
      if (parseFloat(t.quoteVolume || 0) < 200000) return false;
      if (parseFloat(t.lastPrice || 0) <= 0) return false;
      return true;
    });

    // Sort by volume desc (most relevant first)
    filtered.sort((a, b) => parseFloat(b.quoteVolume || 0) - parseFloat(a.quoteVolume || 0));

    // ── SCORE EACH COIN ────────────────────────────────────────────────────
    const results = [];

    for (const t of filtered.slice(0, 1000)) {
      const base = t.symbol.replace('USDT', '');
      const price = parseFloat(t.lastPrice || 0);
      const change24h = parseFloat(t.priceChangePercent || 0);
      const vol24h = parseFloat(t.quoteVolume || 0);
      const high = parseFloat(t.highPrice || price * 1.02);
      const low = parseFloat(t.lowPrice || price * 0.98);
      const open = parseFloat(t.openPrice || t.prevClosePrice || price);
      if (price <= 0) continue;

      let score = 0;
      const signals = [];
      let pattern = 'Sideways';
      let elliottWave = '-';
      let smcSignal = '-';

      // 1. PRICE MOMENTUM
      if (change24h >= 15)      { score += 8; signals.push(`🚀 +${change24h.toFixed(1)}%`); pattern = 'Breakout Bullish Kuat'; }
      else if (change24h >= 8)  { score += 6; signals.push(`+${change24h.toFixed(1)}% Strong`); pattern = 'Breakout Bullish'; }
      else if (change24h >= 4)  { score += 4; signals.push(`+${change24h.toFixed(1)}%`); pattern = 'Breakout Bullish Awal'; }
      else if (change24h >= 2)  { score += 2; signals.push(`+${change24h.toFixed(1)}%`); }
      else if (change24h >= 0.5){ score += 1; }
      else if (change24h <= -15){ score -= 8; signals.push(`💥 ${change24h.toFixed(1)}%`); pattern = 'Breakdown Bearish Kuat'; }
      else if (change24h <= -8) { score -= 6; signals.push(`${change24h.toFixed(1)}% Strong`); pattern = 'Breakdown Bearish'; }
      else if (change24h <= -4) { score -= 4; signals.push(`${change24h.toFixed(1)}%`); pattern = 'Penurunan Tajam'; }
      else if (change24h <= -2) { score -= 2; signals.push(`${change24h.toFixed(1)}%`); }
      else if (change24h <= -0.5){ score -= 1; }

      // 2. RANGE POSITION (candle position dalam range hari ini)
      const range = high - low;
      const rangePos = range > 0 ? (price - low) / range : 0.5;
      if (rangePos >= 0.85)      { score += 2; signals.push('Near High'); }
      else if (rangePos >= 0.70) { score += 1; }
      else if (rangePos <= 0.15) { score += 1; signals.push('Near Low/Bounce'); } // potential reversal
      else if (rangePos <= 0.30) { score -= 1; }

      // 3. VOLUME MAGNITUDE
      const volScore = vol24h >= 500_000_000 ? 4 : vol24h >= 100_000_000 ? 3 : vol24h >= 30_000_000 ? 2 : vol24h >= 10_000_000 ? 1 : 0;
      if (volScore > 0 && change24h > 0) { score += volScore; signals.push(`Vol $${(vol24h/1e6).toFixed(0)}M`); }
      else if (volScore >= 2 && change24h < 0) { score -= 1; }

      // 4. CANDLE PATTERN (intraday)
      if (open > 0 && range > 0) {
        const body = Math.abs(price - open);
        const bodyR = body / range;
        const lowerWick = (Math.min(price, open) - low) / range;
        const upperWick = (high - Math.max(price, open)) / range;

        if (lowerWick > 0.45 && bodyR < 0.25 && price >= open) {
          score += 3; signals.push('Bullish Pin Bar'); pattern = 'Pola Pembalikan Bullish';
        } else if (upperWick > 0.45 && bodyR < 0.25 && price <= open) {
          score -= 3; signals.push('Bearish Pin Bar'); pattern = 'Pola Pembalikan Bearish';
        } else if (bodyR > 0.7 && price > open) {
          score += 1; signals.push('Strong Bull Candle');
        } else if (bodyR > 0.7 && price < open) {
          score -= 1; signals.push('Strong Bear Candle');
        }
        if (price > open * 1.04) { score += 1; signals.push('Gap Up'); }
        if (price < open * 0.96) { score -= 1; signals.push('Gap Down'); }
      }

      // 5. VOLUME BREAKOUT COMBO
      if (vol24h > 150_000_000 && Math.abs(change24h) > 5) {
        score += 3; signals.push('Vol+Price Breakout');
        pattern = change24h > 0 ? 'Volume Breakout Bullish' : 'Volume Breakdown Bearish';
      }

      // 6. ELLIOTT WAVE (structural proxy)
      if (change24h >= 5 && rangePos >= 0.65) {
        elliottWave = 'Potensi Wave 3 🔥'; smcSignal = 'Bullish'; score += 2;
      } else if (change24h <= -5 && rangePos <= 0.35) {
        elliottWave = 'Koreksi ABC / Wave C'; smcSignal = 'Bearish'; score -= 2;
      } else if (Math.abs(change24h) < 1.5 && rangePos > 0.35 && rangePos < 0.65) {
        elliottWave = 'Wave 4 Konsolidasi'; smcSignal = 'Neutral';
      } else if (change24h >= 2 && rangePos >= 0.75) {
        elliottWave = 'Wave 5 / Potensi Puncak'; smcSignal = 'Bullish (waspada)';
      } else if (change24h > 0) {
        elliottWave = 'Wave 1/3 Developing'; smcSignal = 'Bullish';
      } else if (change24h < 0) {
        elliottWave = 'Koreksi / Wave A-B'; smcSignal = 'Bearish';
      }

      // 7. SMC REFINEMENT
      if (change24h >= 6 && volScore >= 2) {
        smcSignal = 'Bullish — OB/Breakout'; elliottWave = 'Potensi Wave 3 🔥';
      } else if (change24h <= -6 && volScore >= 2) {
        smcSignal = 'Bearish — BOS Breakdown'; elliottWave = 'Wave C / Distribution';
      }

      // 8. ASTRO BONUS
      score += astro.totalBonus;

      // ── PROBABILITY MAPPING ──────────────────────────────────────────────
      const ns = Math.max(-10, Math.min(10, score));
      const prob = ns >= 8 ? 100 : ns >= 6 ? 92 : ns >= 5 ? 85 : ns >= 4 ? 80 : ns >= 3 ? 75 : ns >= 2 ? 70 : ns >= 1 ? 63 : ns >= 0 ? 55 : ns >= -1 ? 42 : ns >= -2 ? 33 : 22;
      const probLabel = prob >= 85 ? '🔥 Sangat Tinggi' : prob >= 70 ? '📊 Tinggi' : prob >= 55 ? '🟢 Pantau' : '🔴 Rendah';

      // Chart patterns
      const chartPatterns = [];
      if (open > 0 && range > 0) {
        const body = Math.abs(price - open);
        const lw = (Math.min(price, open) - low) / range;
        const uw = (high - Math.max(price, open)) / range;
        if (lw > 0.45 && body / range < 0.25 && price >= open) chartPatterns.push({ name: 'Bullish Pin Bar', signal: 'bullish', probability: 73 });
        if (uw > 0.45 && body / range < 0.25 && price <= open) chartPatterns.push({ name: 'Bearish Pin Bar', signal: 'bearish', probability: 72 });
        if (change24h > 0 && body / range > 0.65) chartPatterns.push({ name: 'Strong Bull Candle', signal: 'bullish', probability: 65 });
        if (change24h < 0 && body / range > 0.65) chartPatterns.push({ name: 'Strong Bear Candle', signal: 'bearish', probability: 65 });
      }
      if (!chartPatterns.length) {
        chartPatterns.push({ name: change24h > 2 ? 'Momentum Naik' : change24h < -2 ? 'Momentum Turun' : 'Sideways', signal: change24h > 2 ? 'bullish' : change24h < -2 ? 'bearish' : 'neutral', probability: 55 });
      }

      results.push({
        rank: 0,
        symbol: base, fullSymbol: t.symbol, name: base,
        price, change24h: parseFloat(change24h.toFixed(2)),
        priceChange24h: parseFloat(change24h.toFixed(2)),
        volume24h: vol24h, highPrice: high, lowPrice: low,
        rangePos: parseFloat(rangePos.toFixed(3)),
        pattern, chartPatterns: chartPatterns.slice(0, 2),
        elliottWave: { wave: elliottWave, confidence: prob },
        smc: { signal: smcSignal, summary: signals.slice(0, 2).join(' | ') },
        astrology: { signal: `${astro.moonEmoji} ${astro.moonPhase}`, moonPhase: astro.moonPhase, halvingPhase: astro.halvingPhase, illumination: astro.illumination },
        astro: `${astro.moonEmoji} ${astro.moonPhase}\n${astro.halvingPhase}`,
        breakoutProbability: { score: prob, reasons: signals.slice(0, 4), interpretation: probLabel },
        probability: prob, probLabel,
        score: parseFloat(score.toFixed(1)),
        signals: signals.slice(0, 4),
        reason: change24h > 0 ? `+${Math.min(change24h * 1.2, 30).toFixed(1)}%` : `${Math.max(change24h * 1.2, -30).toFixed(1)}%`,
      });
    }

    // Sort by score → probability → volume
    results.sort((a, b) => b.score - a.score || b.probability - a.probability || b.volume24h - a.volume24h);
    results.forEach((r, i) => { r.rank = i + 1; });

    // Market overview
    const allChg = results.map(r => r.change24h);
    const bullCnt = allChg.filter(c => c > 1).length;
    const bearCnt = allChg.filter(c => c < -1).length;
    const avgChg = allChg.length ? parseFloat((allChg.reduce((a, b) => a + b, 0) / allChg.length).toFixed(2)) : 0;

    return res.status(200).json({
      timestamp: Date.now(),
      totalScanned: results.length,
      scanDuration: ((Date.now() - startTime) / 1000).toFixed(1),
      dataSource,
      astroContext: { moonPhase: astro.moonPhase, moonEmoji: astro.moonEmoji, halvingPhase: astro.halvingPhase, totalBonus: astro.totalBonus },
      marketOverview: {
        bullishCount: bullCnt, bearishCount: bearCnt,
        neutralCount: results.length - bullCnt - bearCnt,
        avgChange24h: avgChg,
        marketMood: avgChg > 3 ? 'STRONG_BULL' : avgChg > 1 ? 'BULLISH' : avgChg < -3 ? 'STRONG_BEAR' : avgChg < -1 ? 'BEARISH' : 'NEUTRAL',
      },
      results,
      topSetups: {
        bullish: results.filter(r => r.score > 0).slice(0, 50),
        bearish: results.filter(r => r.score < 0).slice(0, 20),
        highProbBull: results.filter(r => r.probability >= 75 && r.score > 0).slice(0, 30),
        volumeBreakout: results.filter(r => r.volume24h > 50_000_000 && Math.abs(r.change24h) > 3).slice(0, 20),
      },
    });

  } catch (e) {
    return res.status(500).json({ error: e.message, results: [], totalScanned: 0 });
  }
}
