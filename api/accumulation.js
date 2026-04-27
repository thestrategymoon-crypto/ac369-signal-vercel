// api/accumulation.js — AC369 FUSION v1.0
// Smart Money Accumulation Detection System
// Detects altcoins BEFORE big impulse moves
// 7-Layer analysis: SM Pattern + Liquidity + Structure + Volume + Derivatives + Cycle + Context

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

    // ── FETCH MARKET DATA ─────────────────────────────────────────
    const [tickerRes, globalRes, fngRes, btcKlRes] = await Promise.allSettled([
      sf('https://api.binance.com/api/v3/ticker/24hr')
        .then(d => Array.isArray(d) && d.length > 100 ? d :
          sf('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=volume_desc&per_page=250&page=1&sparkline=false&price_change_percentage=7d,30d')
        ),
      sf('https://api.coingecko.com/api/v3/global'),
      sf('https://api.alternative.me/fng/?limit=1&format=json'),
      sf('https://min-api.cryptocompare.com/data/v2/histohour?fsym=BTC&tsym=USD&limit=168'), // 7d BTC
    ]);

    const tickers = tickerRes.status === 'fulfilled' ? tickerRes.value : [];
    const globalData = globalRes.status === 'fulfilled' ? globalRes.value?.data : null;
    const fgValue = fngRes.status === 'fulfilled' ? parseInt(fngRes.value?.data?.[0]?.value || 50) : 50;
    const btcKlines = btcKlRes.status === 'fulfilled' && btcKlRes.value?.Response === 'Success'
      ? btcKlRes.value.Data.Data.map(d => ({ c: +d.close, v: +d.volumeto }))
      : null;

    if (!Array.isArray(tickers) || tickers.length < 50) {
      return res.status(500).json({ error: 'Market data unavailable', results: [] });
    }

    // ── BTC CONTEXT ───────────────────────────────────────────────
    const isBinance = tickers[0]?.lastPrice !== undefined;
    let btcPrice = 0, btcChange7d = 0, btcTrend = 'NEUTRAL';
    if (isBinance) {
      const btcT = tickers.find(t => t.symbol === 'BTCUSDT');
      btcPrice = +(btcT?.lastPrice || 0);
      btcChange7d = +(btcT?.priceChangePercent || 0); // 24h proxy
    }
    if (btcKlines && btcKlines.length >= 50) {
      const closes = btcKlines.map(k => k.c);
      const cur = closes[closes.length - 1];
      const ma50 = closes.slice(-50).reduce((a, b) => a + b, 0) / 50;
      const ma7d = closes.slice(-7*24).reduce((a, b) => a + b, 0) / Math.min(7*24, closes.length);
      btcTrend = cur > ma50 && cur > ma7d ? 'BULLISH' : cur < ma50 && cur < ma7d ? 'BEARISH' : 'NEUTRAL';
    }
    const btcContextScore = btcTrend === 'BULLISH' ? 2 : btcTrend === 'BEARISH' ? -3 : 0;

    // ── MARKET CYCLE ──────────────────────────────────────────────
    const halvingDate = new Date('2024-04-20');
    const daysSinceHalving = Math.floor((Date.now() - halvingDate.getTime()) / 86400000);
    const cycleScore = daysSinceHalving < 365 ? 3 : daysSinceHalving < 547 ? 2 : daysSinceHalving < 730 ? 0 : -1;

    // Mercury Retrograde
    const now = new Date();
    const mrs = [
      { s: new Date('2026-03-08'), e: new Date('2026-03-31') },
      { s: new Date('2026-07-06'), e: new Date('2026-07-30') },
    ];
    const inMR = mrs.some(p => now >= p.s && now <= p.e);

    // ── STABLECOIN FILTER ─────────────────────────────────────────
    const STABLES = new Set(['USDT','USDC','BUSD','TUSD','DAI','FDUSD','USDP','FRAX','LUSD']);
    const BAD = ['UP','DOWN','BEAR','BULL','3L','3S'];

    // ── ANALYZE EACH COIN ─────────────────────────────────────────
    const results = [];
    const coinsToAnalyze = tickers
      .filter(t => {
        if (!t) return false;
        const sym = isBinance ? (t.symbol || '') : ((t.symbol || '') + 'USDT');
        if (!sym.endsWith('USDT')) return false;
        const base = sym.replace('USDT', '');
        if (STABLES.has(base) || base.length < 2) return false;
        if (BAD.some(b => base.endsWith(b))) return false;
        const vol = isBinance ? +(t.quoteVolume || 0) : +(t.total_volume || 0);
        return vol > 2000000; // min $2M volume
      })
      .slice(0, 500);

    for (const t of coinsToAnalyze) {
      try {
        const base = isBinance ? t.symbol.replace('USDT', '') : (t.symbol || '').toUpperCase();
        const price = isBinance ? +(t.lastPrice || 0) : +(t.current_price || 0);
        const change24h = isBinance ? +(t.priceChangePercent || 0) : +(t.price_change_percentage_24h || 0);
        const vol24h = isBinance ? +(t.quoteVolume || 0) : +(t.total_volume || 0);
        const high = isBinance ? +(t.highPrice || price) : price * 1.03;
        const low = isBinance ? +(t.lowPrice || price) : price * 0.97;
        const open = isBinance ? +(t.openPrice || t.prevClosePrice || price) : price / (1 + change24h / 100);

        if (price <= 0) continue;

        // ── ATH ANALYSIS ──────────────────────────────────────────
        // Estimate ATH distance from 52w high (Binance doesn't give ATH directly)
        // Use the 52w high or derive from history
        // For now: use priceChangePercent vs price to estimate cycle position
        const weekHigh52 = isBinance ? 0 : +(t.ath || price * 3);
        const fromATH = weekHigh52 > 0 ? ((price - weekHigh52) / weekHigh52 * 100) : 0;
        // Key: accumulation zone = -30% to -75% from ATH
        const inAccumZone = weekHigh52 > 0 && fromATH >= -75 && fromATH <= -25;

        // ── LAYER 1: ACCUMULATION PATTERN ─────────────────────────
        let l1Score = 0, l1Signals = [];

        // Price at/near lows (Binance: rangePos)
        const range = high - low || price * 0.02;
        const rangePos = range > 0 ? (price - low) / range : 0.5;

        // Near low of 24h range = potential accumulation
        if (rangePos <= 0.35) { l1Score += 8; l1Signals.push('Harga di lower 35% range'); }
        else if (rangePos <= 0.50) { l1Score += 4; l1Signals.push('Harga di tengah-bawah range'); }

        // Small body candle at lows = absorption
        const body = Math.abs(price - open);
        const lw = Math.min(price, open) - low;
        if (body / range < 0.2 && lw / range > 0.4 && rangePos < 0.5) {
          l1Score += 12; l1Signals.push('Absorption candle — supply exhaustion');
        }

        // Volume > 150% average for large cap = unusual activity
        // We estimate by comparing to median
        // Skip detailed volume trend (no history in ticker)

        // Change -2% to +3% but has big lower wick = SM buying
        if (change24h >= -5 && change24h <= 3 && lw / range > 0.35) {
          l1Score += 10; l1Signals.push('Sideways/recovery dengan lower wick besar');
        }

        // If in CG data, use 7d and 30d context
        if (!isBinance) {
          const chg7d = +(t.price_change_percentage_7d || 0);
          const chg30d = +(t.price_change_percentage_30d || 0);
          // Recovery pattern: down 30d but up 7d = potential reversal
          if (chg30d < -15 && chg7d > 0) {
            l1Score += 15; l1Signals.push(`30d: ${chg30d.toFixed(1)}% → 7d: +${chg7d.toFixed(1)}% (recovery signal)`);
          }
          if (inAccumZone) {
            l1Score += 10; l1Signals.push(`${fromATH.toFixed(0)}% dari ATH — dalam zona akumulasi`);
          }
        }

        // ── LAYER 2: LIQUIDITY SWEEP ──────────────────────────────
        let l2Score = 0, l2Signals = [];

        // SSL sweep: price went below and recovered (long lower wick at lows)
        if (lw / range > 0.45 && rangePos < 0.45 && price > low * 1.01) {
          l2Score += 20; l2Signals.push('⚡ SSL Sweep terdeteksi — false breakdown + recovery');
        }
        // Pin bar / hammer
        if (lw / range > 0.6 && body / range < 0.15) {
          l2Score += 12; l2Signals.push('🔨 Hammer/Pin Bar — strong rejection dari low');
        }
        // Recovery from major low
        if (change24h > 3 && rangePos > 0.6 && lw / range > 0.25) {
          l2Score += 8; l2Signals.push(`Recovery +${change24h.toFixed(1)}% dari low dengan wick`);
        }

        // ── LAYER 3: STRUCTURE SHIFT ──────────────────────────────
        let l3Score = 0, l3Signals = [];

        // CHoCH proxy: significant positive change after being in downtrend
        // We use change24h as proxy for recent structure shift
        if (change24h >= 5 && change24h < 15 && rangePos > 0.55) {
          l3Score += 15; l3Signals.push(`CHoCH proxy: +${change24h.toFixed(1)}% dengan close tinggi`);
        }
        // Internal BOS: moderate recovery
        if (change24h >= 2 && change24h < 5 && rangePos > 0.60) {
          l3Score += 8; l3Signals.push('Internal BOS forming');
        }

        // ── LAYER 4: VOLUME ANALYSIS ──────────────────────────────
        let l4Score = 0, l4Signals = [];
        const volTier = vol24h >= 500e6 ? 5 : vol24h >= 100e6 ? 4 : vol24h >= 30e6 ? 3 : vol24h >= 10e6 ? 2 : vol24h >= 3e6 ? 1 : 0;

        // Volume spike with price recovery = accumulation confirmation
        if (volTier >= 3 && change24h > 0 && change24h < 8) {
          l4Score += 12; l4Signals.push(`Volume $${(vol24h/1e6).toFixed(0)}M dengan recovery harga`);
        } else if (volTier >= 2 && change24h > 0) {
          l4Score += 6; l4Signals.push(`Volume $${(vol24h/1e6).toFixed(0)}M (medium)`);
        }

        // High volume at lows = absorption
        if (volTier >= 3 && rangePos < 0.5) {
          l4Score += 8; l4Signals.push('High volume di lower range = SM absorption');
        }

        // ── LAYER 5: DERIVATIVES (Bybit) ─────────────────────────
        let l5Score = 0, l5Signals = [];
        // We can't fetch per-coin derivatives here (too slow for 500 coins)
        // Use market-level signals instead
        if (fgValue <= 25) { l5Score += 10; l5Signals.push(`F&G Extreme Fear (${fgValue}) — contrarian bullish`); }
        else if (fgValue <= 35) { l5Score += 6; l5Signals.push(`F&G Fear (${fgValue}) — accumulation zone`); }

        // ── LAYER 6: CYCLE ────────────────────────────────────────
        const l6Score = Math.max(0, cycleScore) + (inMR ? -2 : 0);
        const l6Signals = cycleScore > 0 ? [`${daysSinceHalving}d post-halving (${cycleScore > 2 ? 'Early Bull' : 'Mid Cycle'})`] : [];

        // ── LAYER 7: MARKET CONTEXT ───────────────────────────────
        const l7Score = Math.max(0, btcContextScore);
        const l7Signals = btcTrend !== 'BEARISH' ? [`BTC ${btcTrend}`] : [];

        // ── COMPOSITE SCORE ───────────────────────────────────────
        // Weighted: L1(35) + L2(25) + L3(18) + L4(12) + L5(5) + L6(3) + L7(2)
        const maxPossible = 35 + 25 + 18 + 12 + 5 + 3 + 2;
        const rawScore = (l1Score * 0.35) + (l2Score * 0.25) + (l3Score * 0.18) + (l4Score * 0.12) + (l5Score * 0.05) + (l6Score * 0.03) + (l7Score * 0.02);
        const totalRaw = l1Score + l2Score + l3Score + l4Score + l5Score + l6Score + l7Score;

        // Normalize to 0-100
        const score = Math.min(95, Math.round(rawScore * 3.5));
        if (score < 30) continue; // Filter out low scores

        // ── TIER CLASSIFICATION ───────────────────────────────────
        let tier, tierLabel, timeframe, color;
        if (score >= 82) { tier = 'S'; tierLabel = '🔥 IMMINENT'; timeframe = '1-7 hari'; color = '#ff6b35'; }
        else if (score >= 68) { tier = 'A'; tierLabel = '✅ READY'; timeframe = '1-2 minggu'; color = '#00ffd0'; }
        else if (score >= 55) { tier = 'B'; tierLabel = '📈 BUILDING'; timeframe = '2-4 minggu'; color = '#FFB300'; }
        else { tier = 'C'; tierLabel = '👁 WATCH'; timeframe = '1-2 bulan'; color = '#7a8fa8'; }

        // ── SIGNAL SUMMARY ────────────────────────────────────────
        const allSignals = [...l1Signals, ...l2Signals, ...l3Signals, ...l4Signals, ...l5Signals].slice(0, 5);

        // Phase detection
        let accPhase;
        const sslDetected = l2Score >= 20;
        const structureShift = l3Score >= 15;
        if (sslDetected && structureShift) accPhase = 'MANIPULATION COMPLETE — Impulse incoming';
        else if (sslDetected) accPhase = 'MANIPULATION PHASE — SSL swept, watching CHoCH';
        else if (l1Score >= 20) accPhase = 'MID-ACCUMULATION — SM building position';
        else if (l1Score >= 10) accPhase = 'EARLY ACCUMULATION — Signs emerging';
        else accPhase = 'WATCHING — Minor signals';

        // Entry suggestion
        let entryType;
        if (sslDetected && structureShift) entryType = 'MARKET — Entry sekarang, konfirmasi CHoCH';
        else if (rangePos < 0.35) entryType = 'DCA/LIMIT — Di area sekarang (bawah range)';
        else entryType = 'WAIT — Tunggu retrace ke lower range';

        // Target estimate (% upside)
        const baseTarget = tier === 'S' ? 25 : tier === 'A' ? 40 : tier === 'B' ? 60 : 80;
        const tp1Pct = tier === 'S' ? '+15%' : tier === 'A' ? '+25%' : '+40%';
        const tp2Pct = tier === 'S' ? '+30%' : tier === 'A' ? '+50%' : '+80%';
        const tp3Pct = tier === 'S' ? '+50%+' : tier === 'A' ? '+80%+' : '+120%+';

        results.push({
          rank: 0, symbol: base, price, change24h: +change24h.toFixed(2),
          volume24h: vol24h, volTier,
          score, tier, tierLabel, timeframe, color,
          accPhase, entryType,
          signals: allSignals,
          targets: { tp1: tp1Pct, tp2: tp2Pct, tp3: tp3Pct },
          layers: {
            l1: { score: l1Score, max: 35, label: 'SM Accumulation', signals: l1Signals },
            l2: { score: l2Score, max: 25, label: 'Liquidity Sweep', signals: l2Signals },
            l3: { score: l3Score, max: 18, label: 'Structure Shift', signals: l3Signals },
            l4: { score: l4Score, max: 12, label: 'Volume Profile', signals: l4Signals },
            l5: { score: l5Score, max: 5, label: 'Derivatives', signals: l5Signals },
          },
          rangePos: +rangePos.toFixed(3),
          lowerWick: +(lw / range).toFixed(3),
          fromATH: fromATH !== 0 ? +fromATH.toFixed(1) : null,
        });
      } catch (e) { /* skip individual coin errors */ }
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

    const scanTime = ((Date.now() - start) / 1000).toFixed(1);

    res.setHeader('Cache-Control', 's-maxage=120'); // Cache 2 minutes
    return res.status(200).json({
      timestamp: Date.now(),
      scanTime,
      totalAnalyzed: coinsToAnalyze.length,
      totalQualified: results.length,
      marketContext: {
        btcTrend, btcPrice, fgValue,
        cyclePhase: daysSinceHalving < 365 ? 'Bull Early ✅' : daysSinceHalving < 547 ? 'Bull Peak ⚠️' : 'Distribution/Bear',
        daysSinceHalving, inMR,
        bestScanTime: fgValue <= 35 ? '✅ Fear = akumulasi terbaik' : fgValue >= 75 ? '⚠️ Greed = hati-hati' : 'Netral',
        dominance: +(globalData?.market_cap_percentage?.btc || 0).toFixed(1),
      },
      tierGroups,
      allResults: results.slice(0, 80),
    });

  } catch (e) {
    return res.status(500).json({ error: e.message, results: [], totalAnalyzed: 0 });
  }
}
