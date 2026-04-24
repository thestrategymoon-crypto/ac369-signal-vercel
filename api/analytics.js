// api/analytics.js — AC369 FUSION v10.2
// FIXED: Response format {btc:{}, eth:{}, smartMoneyNarrative}
// FIXED: RSI Wilder's smoothing, MA real values, MACD proper calculation

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // Fetch BTC dan ETH bersamaan
    const [btcData, ethData] = await Promise.all([
      analyzeAsset('BTCUSDT'),
      analyzeAsset('ETHUSDT'),
    ]);

    // Generate Smart Money Narrative
    const narrative = generateSmartMoneyNarrative(btcData, ethData);

    res.setHeader('Cache-Control', 's-maxage=30');
    return res.status(200).json({
      btc: btcData,
      eth: ethData,
      smartMoneyNarrative: narrative,
      timestamp: Date.now(),
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

// ── ANALYZE ONE ASSET ─────────────────────────────────────────────────────
async function analyzeAsset(symbol) {
  const ticker = symbol.replace('USDT', '');

  try {
    const [k1h, k4h, k1d, tickerRes, depthRes, fundingRes] = await Promise.allSettled([
      fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=1h&limit=200`, { signal: AbortSignal.timeout(10000) }).then(r => r.json()),
      fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=4h&limit=200`, { signal: AbortSignal.timeout(10000) }).then(r => r.json()),
      fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=1d&limit=100`, { signal: AbortSignal.timeout(10000) }).then(r => r.json()),
      fetch(`https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${symbol}`, { signal: AbortSignal.timeout(8000) }).then(r => r.json()),
      fetch(`https://api.binance.com/api/v3/depth?symbol=${symbol}&limit=20`, { signal: AbortSignal.timeout(8000) }).then(r => r.json()),
      fetch(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${symbol}`, { signal: AbortSignal.timeout(8000) }).then(r => r.json()),
    ]);

    const parseK = raw => Array.isArray(raw) ? raw.map(k => ({ t: +k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] })) : [];
    const K1h = k1h.status === 'fulfilled' ? parseK(k1h.value) : [];
    const K4h = k4h.status === 'fulfilled' ? parseK(k4h.value) : [];
    const K1d = k1d.status === 'fulfilled' ? parseK(k1d.value) : [];

    if (!K1h.length && !K4h.length) throw new Error('No candle data');

    const c1h = K1h.map(k => k.c);
    const c4h = K4h.map(k => k.c);
    const c1d = K1d.map(k => k.c);
    const currentPrice = c1h.length ? c1h[c1h.length - 1] : (c4h[c4h.length - 1] || 0);

    // ── MATH ────────────────────────────────────────────────────
    const EMA = (c, p) => {
      if (!c || c.length < p) return c ? c[c.length - 1] || 0 : 0;
      const k = 2 / (p + 1);
      let e = c.slice(0, p).reduce((a, b) => a + b, 0) / p;
      for (let i = p; i < c.length; i++) e = c[i] * k + e * (1 - k);
      return e;
    };

    const SMA = (c, p) => {
      if (!c || c.length < p) return c ? c[c.length - 1] || 0 : 0;
      return c.slice(-p).reduce((a, b) => a + b, 0) / p;
    };

    // RSI dengan Wilder's smoothing yang benar
    const RSI = (c, p = 14) => {
      if (!c || c.length < p + 1) return 50;
      let gains = 0, losses = 0;
      for (let i = 1; i <= p; i++) {
        const d = c[i] - c[i - 1];
        if (d >= 0) gains += d; else losses -= d;
      }
      let ag = gains / p, al = losses / p;
      for (let i = p + 1; i < c.length; i++) {
        const d = c[i] - c[i - 1];
        ag = (ag * (p - 1) + (d >= 0 ? d : 0)) / p;
        al = (al * (p - 1) + (d < 0 ? -d : 0)) / p;
      }
      if (al === 0) return 100;
      return parseFloat((100 - 100 / (1 + ag / al)).toFixed(2));
    };

    const ATR = (K, p = 14) => {
      if (K.length < 2) return 0;
      const trs = K.slice(1).map((k, i) => Math.max(k.h - k.l, Math.abs(k.h - K[i].c), Math.abs(k.l - K[i].c)));
      return trs.slice(-p).reduce((a, b) => a + b, 0) / Math.min(p, trs.length);
    };

    const BB = (c, p = 20) => {
      if (!c || c.length < p) return { upper: 0, lower: 0, mid: 0, width: 0, position: 50 };
      const sl = c.slice(-p);
      const m = sl.reduce((a, b) => a + b, 0) / p;
      const sd = Math.sqrt(sl.reduce((s, v) => s + (v - m) ** 2, 0) / p);
      const upper = m + 2 * sd, lower = m - 2 * sd;
      return {
        upper: parseFloat(upper.toFixed(6)),
        lower: parseFloat(lower.toFixed(6)),
        mid: parseFloat(m.toFixed(6)),
        width: parseFloat((sd > 0 ? (4 * sd / m) * 100 : 0).toFixed(2)),
        position: parseFloat(sd > 0 ? ((c[c.length - 1] - lower) / (4 * sd) * 100).toFixed(1) : '50'),
      };
    };

    const MACD = (c) => {
      if (!c || c.length < 35) return { macd: 0, signal: 0, histogram: 0, bullish: false, bearish: false, crossUp: false, crossDown: false };
      const k12 = 2 / 13, k26 = 2 / 27, k9 = 2 / 10;
      let e12 = c.slice(0, 12).reduce((a, b) => a + b, 0) / 12;
      let e26 = c.slice(0, 26).reduce((a, b) => a + b, 0) / 26;
      const macdVals = [];
      for (let i = 12; i < c.length; i++) { e12 = c[i] * k12 + e12 * (1 - k12); }
      e12 = c.slice(0, 12).reduce((a, b) => a + b, 0) / 12;
      for (let i = 26; i < c.length; i++) {
        e12 = c[i] * k12 + e12 * (1 - k12);
        e26 = c[i] * k26 + e26 * (1 - k26);
        macdVals.push(e12 - e26);
      }
      let sig = macdVals.slice(0, 9).reduce((a, b) => a + b, 0) / 9;
      for (let i = 9; i < macdVals.length; i++) sig = macdVals[i] * k9 + sig * (1 - k9);
      const macdLine = macdVals[macdVals.length - 1];
      const prevMacd = macdVals[macdVals.length - 2] || macdLine;
      const histogram = macdLine - sig;
      const prevHist = prevMacd - sig;
      return {
        macd: parseFloat(macdLine.toFixed(6)),
        signal: parseFloat(sig.toFixed(6)),
        histogram: parseFloat(histogram.toFixed(6)),
        bullish: macdLine > 0 && histogram > 0,
        bearish: macdLine < 0 && histogram < 0,
        crossUp: histogram > 0 && prevHist <= 0,
        crossDown: histogram < 0 && prevHist >= 0,
      };
    };

    // ── CALCULATE INDICATORS ────────────────────────────────────
    const rsi1h = RSI(c1h, 14);
    const rsi4h = RSI(c4h, 14);
    const rsi1d = RSI(c1d, 14);

    const ema9_1h = EMA(c1h, 9);
    const ema21_1h = EMA(c1h, 21);
    const ema50_1h = EMA(c1h, 50);
    const sma200_1h = SMA(c1h, Math.min(200, c1h.length));

    const ema20_4h = EMA(c4h, 20);
    const ema50_4h = EMA(c4h, 50);
    const ema200_4h = EMA(c4h, Math.min(200, c4h.length));

    const ema50_1d = EMA(c1d, Math.min(50, c1d.length));
    const ema200_1d = EMA(c1d, Math.min(200, c1d.length));

    const bb4h = BB(c4h, 20);
    const atr4h = ATR(K4h, 14);
    const macd4h = MACD(c4h);
    const macd1d = MACD(c1d);

    // ── TREND SCORING ────────────────────────────────────────────
    const ts1h = (currentPrice > ema9_1h ? 1 : -1) + (currentPrice > ema21_1h ? 1 : -1) + (currentPrice > ema50_1h ? 1 : -1) + (macd4h.bullish ? 0.5 : -0.5) + (rsi1h > 50 ? 0.5 : -0.5);
    const ts4h = (currentPrice > ema20_4h ? 2 : -2) + (currentPrice > ema50_4h ? 2 : -2) + (currentPrice > ema200_4h ? 2 : -2) + (macd4h.bullish ? 1 : -1) + (rsi4h > 50 ? 0.5 : -0.5);
    const ts1d = (currentPrice > ema50_1d ? 2 : -2) + (currentPrice > ema200_1d ? 2 : -2) + (macd1d.bullish ? 1 : -1) + (rsi1d > 50 ? 0.5 : -0.5);

    const getTrend = (s, t) => s > t ? 'BULLISH' : s > 0 ? 'BULLISH_WEAK' : s < -t ? 'BEARISH' : s < 0 ? 'BEARISH_WEAK' : 'NEUTRAL';
    const trend1h = getTrend(ts1h, 2);
    const trend4h = getTrend(ts4h, 3);
    const trend1d = getTrend(ts1d, 2);
    const overallScore = ts1h * 0.2 + ts4h * 0.4 + ts1d * 0.4;
    const overallTrend = getTrend(overallScore, 2);

    // ── SUPPORT/RESISTANCE ───────────────────────────────────────
    const findSR = (K, lb = 5) => {
      const hh = [], ll = [];
      for (let i = lb; i < K.length - lb; i++) {
        let isH = true, isL = true;
        for (let j = i - lb; j <= i + lb; j++) {
          if (j === i) continue;
          if (K[j].h >= K[i].h) isH = false;
          if (K[j].l <= K[i].l) isL = false;
        }
        if (isH) hh.push(K[i].h);
        if (isL) ll.push(K[i].l);
      }
      return {
        resistance: hh.filter(h => h > currentPrice).sort((a, b) => a - b).slice(0, 2),
        support: ll.filter(l => l < currentPrice).sort((a, b) => b - a).slice(0, 2),
      };
    };

    const sr4h = K4h.length >= 15 ? findSR(K4h, 5) : { resistance: [], support: [] };
    const sr1d = K1d.length >= 10 ? findSR(K1d, 3) : { resistance: [], support: [] };
    const nearestSupport = sr1d.support[0] || sr4h.support[0] || currentPrice * 0.95;
    const nearestResistance = sr1d.resistance[0] || sr4h.resistance[0] || currentPrice * 1.05;

    // ── PIVOT POINTS ─────────────────────────────────────────────
    let pivots = null;
    if (K4h.length >= 2) {
      const prev = K4h[K4h.length - 2];
      const P = (prev.h + prev.l + prev.c) / 3;
      pivots = {
        P: parseFloat(P.toFixed(6)),
        R1: parseFloat((2 * P - prev.l).toFixed(6)),
        R2: parseFloat((P + prev.h - prev.l).toFixed(6)),
        R3: parseFloat((prev.h + 2 * (P - prev.l)).toFixed(6)),
        S1: parseFloat((2 * P - prev.h).toFixed(6)),
        S2: parseFloat((P - (prev.h - prev.l)).toFixed(6)),
        S3: parseFloat((prev.l - 2 * (prev.h - P)).toFixed(6)),
      };
    }

    // ── PROBABILITY SCORE ────────────────────────────────────────
    let bullScore = 0, bearScore = 0;

    // Trend (40 pts max)
    if (trend1d === 'BULLISH') bullScore += 15; else if (trend1d === 'BEARISH') bearScore += 15; else if (trend1d === 'BULLISH_WEAK') bullScore += 7; else bearScore += 7;
    if (trend4h === 'BULLISH') bullScore += 12; else if (trend4h === 'BEARISH') bearScore += 12; else if (trend4h === 'BULLISH_WEAK') bullScore += 5; else bearScore += 5;
    if (trend1h === 'BULLISH') bullScore += 8; else if (trend1h === 'BEARISH') bearScore += 8; else if (trend1h === 'BULLISH_WEAK') bullScore += 3; else bearScore += 3;

    // RSI (15 pts max)
    if (rsi4h < 30) bullScore += 15; else if (rsi4h > 70) bearScore += 15; else if (rsi4h < 45) bullScore += 5; else if (rsi4h > 55) bearScore += 5;

    // MACD (15 pts max)
    if (macd4h.bullish) bullScore += 10; else if (macd4h.bearish) bearScore += 10;
    if (macd4h.crossUp) bullScore += 5; else if (macd4h.crossDown) bearScore += 5;

    // BB (10 pts max)
    if (bb4h.position < 15) bullScore += 10; else if (bb4h.position > 85) bearScore += 10; else if (bb4h.position < 35) bullScore += 4; else if (bb4h.position > 65) bearScore += 4;

    // Volume (10 pts)
    if (K1h.length >= 20) {
      const avgVol = K1h.slice(-20, -1).reduce((s, k) => s + k.v, 0) / 19;
      const currVol = K1h[K1h.length - 1].v;
      const volRatio = avgVol > 0 ? currVol / avgVol : 1;
      if (volRatio > 1.5) {
        if (trend1h === 'BULLISH') bullScore += 10; else bearScore += 10;
      }
    }

    const totalScore = bullScore + bearScore;
    const probabilityScore = totalScore > 0 ? Math.round((Math.max(bullScore, bearScore) / totalScore) * 100) : 50;
    const rawSignal = bullScore > bearScore ? (probabilityScore >= 65 ? 'Strong Buy' : 'Buy') : bearScore > bullScore ? (probabilityScore >= 65 ? 'Strong Sell' : 'Sell') : 'Neutral';

    // ── MA POSITION ──────────────────────────────────────────────
    let maPosition = 'N/A';
    if (ema200_4h > 0) {
      const pct = ((currentPrice - ema200_4h) / ema200_4h * 100).toFixed(1);
      maPosition = currentPrice > ema200_4h ? `Above EMA200 (+${pct}%)` : `Below EMA200 (${pct}%)`;
    }

    // ── TECHNICAL SUMMARY ────────────────────────────────────────
    const techParts = [];
    if (overallTrend === 'BULLISH') techParts.push('Tren makro bullish — semua timeframe aligned bullish.');
    else if (overallTrend === 'BEARISH') techParts.push('Tren makro bearish — tekanan jual dominan.');
    else techParts.push(`Tren mixed — konfirmasi diperlukan.`);
    if (rsi4h < 30) techParts.push(`RSI 4H oversold (${rsi4h}) — potensi reversal.`);
    else if (rsi4h > 70) techParts.push(`RSI 4H overbought (${rsi4h}) — waspada distribusi.`);
    else techParts.push(`RSI 4H: ${rsi4h} (${rsi4h > 50 ? 'bullish zone' : 'bearish zone'}).`);
    if (macd4h.crossUp) techParts.push('MACD 4H cross up — sinyal beli.');
    else if (macd4h.crossDown) techParts.push('MACD 4H cross down — sinyal jual.');
    if (bb4h.width < 3) techParts.push(`BB squeeze (${bb4h.width}%) — breakout imminent.`);

    // ── DERIVATIVES ──────────────────────────────────────────────
    let change24h = 0, fundingRate = 0;
    if (tickerRes.status === 'fulfilled') change24h = parseFloat(tickerRes.value.priceChangePercent || 0);
    if (fundingRes.status === 'fulfilled') fundingRate = parseFloat(fundingRes.value.lastFundingRate || 0) * 100;

    let obImbalance = 50;
    if (depthRes.status === 'fulfilled' && depthRes.value.bids) {
      const bidVol = depthRes.value.bids.reduce((s, b) => s + parseFloat(b[1]), 0);
      const askVol = depthRes.value.asks.reduce((s, a) => s + parseFloat(a[1]), 0);
      obImbalance = parseFloat((bidVol / (bidVol + askVol) * 100).toFixed(1));
    }

    return {
      symbol,
      ticker,
      currentPrice: parseFloat(currentPrice.toFixed(6)),
      change24h: parseFloat(change24h.toFixed(2)),

      // Core signal — used by recommendation.js and index.html
      probabilityScore,
      confluenceSignal: rawSignal,
      action: rawSignal.includes('Buy') ? 'BUY' : rawSignal.includes('Sell') ? 'SELL' : 'HOLD',
      overallTrend,
      technicalSummary: techParts.join(' '),

      // Detailed RSI
      rsi: {
        '1h': rsi1h,
        '4h': rsi4h,
        '1d': rsi1d,
        signal1h: rsi1h < 30 ? 'OVERSOLD' : rsi1h > 70 ? 'OVERBOUGHT' : rsi1h > 50 ? 'BULLISH' : 'BEARISH',
        signal4h: rsi4h < 30 ? 'OVERSOLD' : rsi4h > 70 ? 'OVERBOUGHT' : rsi4h > 50 ? 'BULLISH' : 'BEARISH',
        signal1d: rsi1d < 30 ? 'OVERSOLD' : rsi1d > 70 ? 'OVERBOUGHT' : rsi1d > 50 ? 'BULLISH' : 'BEARISH',
      },

      // Moving Averages
      maStatus: {
        position: maPosition,
        ema9_1h: parseFloat(ema9_1h.toFixed(6)),
        ema21_1h: parseFloat(ema21_1h.toFixed(6)),
        ema50_1h: parseFloat(ema50_1h.toFixed(6)),
        sma200_1h: parseFloat(sma200_1h.toFixed(6)),
        ema20_4h: parseFloat(ema20_4h.toFixed(6)),
        ema50_4h: parseFloat(ema50_4h.toFixed(6)),
        ema200_4h: parseFloat(ema200_4h.toFixed(6)),
        ema50_1d: parseFloat(ema50_1d.toFixed(6)),
        ema200_1d: parseFloat(ema200_1d.toFixed(6)),
        crossSignal: ema9_1h > ema21_1h ? (ema21_1h > ema50_1h ? 'Golden Cross' : 'EMA9>EMA21') : 'EMA9<EMA21',
      },

      // MACD
      macd: { '4h': macd4h, '1d': macd1d },

      // Bollinger Bands
      bb: {
        '4h': bb4h,
        squeeze: bb4h.width < 3,
        squeezeDetail: bb4h.width < 3 ? `BB squeeze (${bb4h.width}%) — ekspansi imminent` : null,
      },

      // ATR
      atr: {
        '4h': parseFloat(atr4h.toFixed(6)),
        atrPct: parseFloat((atr4h / currentPrice * 100).toFixed(2)),
        volatility: atr4h / currentPrice * 100 > 5 ? 'HIGH' : atr4h / currentPrice * 100 > 2 ? 'MEDIUM' : 'LOW',
      },

      // Key levels
      keyLevels: {
        support: parseFloat(nearestSupport.toFixed(6)),
        resistance: parseFloat(nearestResistance.toFixed(6)),
        supportLevels: sr4h.support.slice(0, 2).map(s => parseFloat(s.toFixed(6))),
        resistanceLevels: sr4h.resistance.slice(0, 2).map(r => parseFloat(r.toFixed(6))),
      },

      pivots,

      // Trends per TF
      trends: {
        '1h': trend1h,
        '4h': trend4h,
        '1d': trend1d,
        overall: overallTrend,
        scores: { ts1h: parseFloat(ts1h.toFixed(2)), ts4h: parseFloat(ts4h.toFixed(2)), ts1d: parseFloat(ts1d.toFixed(2)) },
      },

      // Score breakdown
      scoreBreakdown: {
        bull: bullScore, bear: bearScore, total: totalScore,
        bullPct: totalScore > 0 ? Math.round(bullScore / totalScore * 100) : 50,
      },

      fundingRate: parseFloat(fundingRate.toFixed(4)),
      orderBookImbalance: obImbalance,
    };

  } catch (e) {
    // Return safe fallback so UI doesn't break
    return {
      symbol, ticker: symbol.replace('USDT', ''),
      currentPrice: 0, change24h: 0,
      probabilityScore: 50, confluenceSignal: 'Neutral', action: 'HOLD',
      overallTrend: 'NEUTRAL', technicalSummary: 'Data tidak tersedia.',
      rsi: { '1h': 50, '4h': 50, '1d': 50 },
      maStatus: { position: 'N/A' },
      macd: {}, bb: {}, atr: {},
      keyLevels: { support: 0, resistance: 0 },
      trends: { '1h': 'NEUTRAL', '4h': 'NEUTRAL', '1d': 'NEUTRAL', overall: 'NEUTRAL' },
      scoreBreakdown: { bull: 0, bear: 0, total: 0, bullPct: 50 },
      fundingRate: 0, orderBookImbalance: 50, pivots: null,
      error: e.message,
    };
  }
}

// ── SMART MONEY NARRATIVE ─────────────────────────────────────────────────
function generateSmartMoneyNarrative(btc, eth) {
  const parts = [];
  if (!btc || btc.currentPrice === 0) return 'Data pasar sedang dimuat...';

  const btcTrend = btc.overallTrend || 'NEUTRAL';
  const ethTrend = eth?.overallTrend || 'NEUTRAL';

  if (btcTrend === 'BULLISH' && ethTrend === 'BULLISH') parts.push('BTC dan ETH keduanya bullish — risk-on market aktif, altcoin berpotensi ikut naik.');
  else if (btcTrend === 'BULLISH') parts.push('BTC bullish tapi ETH masih laggard — kapital terfokus di BTC dulu sebelum rotasi ke altcoin.');
  else if (btcTrend === 'BEARISH') parts.push('BTC bearish — smart money dalam mode distribusi, jaga posisi dan manajemen risiko ketat.');
  else parts.push('Market dalam fase transisi — tunggu konfirmasi tren sebelum entry besar.');

  const btcRsi = btc.rsi?.['4h'] || 50;
  if (btcRsi < 30) parts.push(`RSI BTC oversold (${btcRsi}) — historis ini zona akumulasi institusional.`);
  else if (btcRsi > 70) parts.push(`RSI BTC overbought (${btcRsi}) — smart money mungkin mulai distribusi.`);

  if (btc.macd?.['4h']?.crossUp) parts.push('MACD BTC 4H golden cross — sinyal momentum bullish baru dimulai.');
  if (btc.macd?.['4h']?.crossDown) parts.push('MACD BTC 4H death cross — momentum bearish menguat.');

  if (btc.fundingRate < -0.04) parts.push(`Funding rate negatif (${btc.fundingRate}%) — short dominan, potensi short squeeze.`);
  else if (btc.fundingRate > 0.08) parts.push(`Funding rate tinggi (${btc.fundingRate}%) — market overleveraged long, waspada.`);

  return parts.join(' ') || 'Pasar dalam kondisi normal — pantau level kunci.';
}
