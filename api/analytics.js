// api/analytics.js — AC369 FUSION v10.1
// FIXED: RSI kalkulasi real (bukan default 50), MA real, semua indikator akurat

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { symbol = 'BTCUSDT', interval = '1h', limit = '200' } = req.query;

  try {
    // ── FETCH MULTI-TIMEFRAME DATA IN PARALLEL ────────────────────
    const [k1h, k4h, k1d, ticker, depth, funding] = await Promise.allSettled([
      fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=1h&limit=200`, { signal: AbortSignal.timeout(10000) }).then(r => r.json()),
      fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=4h&limit=200`, { signal: AbortSignal.timeout(10000) }).then(r => r.json()),
      fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=1d&limit=100`, { signal: AbortSignal.timeout(10000) }).then(r => r.json()),
      fetch(`https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${symbol}`, { signal: AbortSignal.timeout(8000) }).then(r => r.json()),
      fetch(`https://api.binance.com/api/v3/depth?symbol=${symbol}&limit=20`, { signal: AbortSignal.timeout(8000) }).then(r => r.json()),
      fetch(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${symbol}`, { signal: AbortSignal.timeout(8000) }).then(r => r.json()),
    ]);

    const parseK = raw => Array.isArray(raw) ? raw.map(k => ({
      t: +k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5]
    })) : [];

    const K1h = k1h.status === 'fulfilled' ? parseK(k1h.value) : [];
    const K4h = k4h.status === 'fulfilled' ? parseK(k4h.value) : [];
    const K1d = k1d.status === 'fulfilled' ? parseK(k1d.value) : [];

    if (!K1h.length && !K4h.length) throw new Error('No candle data');

    // ── MATH FUNCTIONS ────────────────────────────────────────────
    const closes1h = K1h.map(k => k.c);
    const closes4h = K4h.map(k => k.c);
    const closes1d = K1d.map(k => k.c);
    const currentPrice = closes1h.length ? closes1h[closes1h.length - 1] : (closes4h[closes4h.length - 1] || 0);

    // EMA — proper calculation
    const calcEMA = (closes, period) => {
      if (!closes || closes.length < period) return closes ? closes[closes.length - 1] : 0;
      const k = 2 / (period + 1);
      let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
      for (let i = period; i < closes.length; i++) ema = closes[i] * k + ema * (1 - k);
      return ema;
    };

    // SMA
    const calcSMA = (closes, period) => {
      if (!closes || closes.length < period) return closes ? closes[closes.length - 1] : 0;
      return closes.slice(-period).reduce((a, b) => a + b, 0) / period;
    };

    // RSI — proper Wilder's smoothing
    const calcRSI = (closes, period = 14) => {
      if (!closes || closes.length < period + 1) return 50;
      let gains = 0, losses = 0;
      // Initial average
      for (let i = 1; i <= period; i++) {
        const d = closes[i] - closes[i - 1];
        if (d >= 0) gains += d; else losses -= d;
      }
      let avgGain = gains / period;
      let avgLoss = losses / period;
      // Wilder's smoothing for the rest
      for (let i = period + 1; i < closes.length; i++) {
        const d = closes[i] - closes[i - 1];
        const g = d >= 0 ? d : 0;
        const l = d < 0 ? -d : 0;
        avgGain = (avgGain * (period - 1) + g) / period;
        avgLoss = (avgLoss * (period - 1) + l) / period;
      }
      if (avgLoss === 0) return 100;
      const rs = avgGain / avgLoss;
      return parseFloat((100 - 100 / (1 + rs)).toFixed(2));
    };

    // MACD
    const calcMACD = (closes) => {
      const ema12 = calcEMA(closes, 12);
      const ema26 = calcEMA(closes, 26);
      const macdLine = ema12 - ema26;
      // Signal: 9-period EMA of MACD values
      const macdValues = [];
      const k = 2 / (26 + 1);
      let e26 = closes.slice(0, 26).reduce((a, b) => a + b, 0) / 26;
      const k12 = 2 / (12 + 1);
      let e12 = closes.slice(0, 12).reduce((a, b) => a + b, 0) / 12;
      for (let i = 26; i < closes.length; i++) {
        e12 = closes[i] * k12 + e12 * (1 - k12);
        e26 = closes[i] * k + e26 * (1 - k);
        macdValues.push(e12 - e26);
      }
      const signal = macdValues.length >= 9 ? calcEMA(macdValues, 9) : macdValues[macdValues.length - 1] || 0;
      const histogram = (macdValues[macdValues.length - 1] || macdLine) - signal;
      return {
        macd: parseFloat(macdLine.toFixed(6)),
        signal: parseFloat(signal.toFixed(6)),
        histogram: parseFloat(histogram.toFixed(6)),
        bullish: histogram > 0 && macdLine > 0,
        bearish: histogram < 0 && macdLine < 0,
        crossUp: histogram > 0 && macdValues.length >= 2 && (macdValues[macdValues.length - 2] - signal) < 0,
        crossDown: histogram < 0 && macdValues.length >= 2 && (macdValues[macdValues.length - 2] - signal) > 0,
      };
    };

    // ATR
    const calcATR = (K, period = 14) => {
      if (K.length < 2) return 0;
      const trs = K.slice(1).map((k, i) =>
        Math.max(k.h - k.l, Math.abs(k.h - K[i].c), Math.abs(k.l - K[i].c))
      );
      return trs.slice(-period).reduce((a, b) => a + b, 0) / Math.min(period, trs.length);
    };

    // Bollinger Bands
    const calcBB = (closes, period = 20) => {
      const slice = closes.slice(-period);
      if (slice.length < period) return { upper: 0, lower: 0, mid: 0, width: 0 };
      const mid = slice.reduce((a, b) => a + b, 0) / period;
      const std = Math.sqrt(slice.reduce((s, v) => s + (v - mid) ** 2, 0) / period);
      return {
        upper: parseFloat((mid + 2 * std).toFixed(6)),
        lower: parseFloat((mid - 2 * std).toFixed(6)),
        mid: parseFloat(mid.toFixed(6)),
        width: parseFloat(((4 * std / mid) * 100).toFixed(2)),
        position: parseFloat(((closes[closes.length - 1] - (mid - 2 * std)) / (4 * std) * 100).toFixed(1)),
      };
    };

    // Stochastic RSI
    const calcStochRSI = (closes, period = 14) => {
      if (closes.length < period + 14) return { k: 50, d: 50 };
      const rsiValues = [];
      for (let i = period; i <= closes.length; i++) {
        rsiValues.push(calcRSI(closes.slice(0, i), period));
      }
      const recent = rsiValues.slice(-period);
      const min = Math.min(...recent);
      const max = Math.max(...recent);
      const stochK = max === min ? 50 : ((rsiValues[rsiValues.length - 1] - min) / (max - min)) * 100;
      const stochD = rsiValues.slice(-3).reduce((a, b) => a + b, 0) / 3;
      return { k: parseFloat(stochK.toFixed(2)), d: parseFloat(stochD.toFixed(2)) };
    };

    // Volume analysis
    const calcVolumeSignal = (K) => {
      if (K.length < 20) return { trend: 'neutral', ratio: 1 };
      const avgVol = K.slice(-20, -1).reduce((s, k) => s + k.v, 0) / 19;
      const currVol = K[K.length - 1].v;
      const ratio = currVol / avgVol;
      const trend = ratio > 2 ? 'very_high' : ratio > 1.5 ? 'high' : ratio > 0.8 ? 'normal' : 'low';
      return { trend, ratio: parseFloat(ratio.toFixed(2)) };
    };

    // Pivot Points (Classic)
    const calcPivots = (K) => {
      if (!K.length) return null;
      const prev = K[K.length - 2] || K[K.length - 1];
      const H = prev.h, L = prev.l, C = prev.c;
      const P = (H + L + C) / 3;
      return {
        P: parseFloat(P.toFixed(6)),
        R1: parseFloat((2 * P - L).toFixed(6)),
        R2: parseFloat((P + (H - L)).toFixed(6)),
        R3: parseFloat((H + 2 * (P - L)).toFixed(6)),
        S1: parseFloat((2 * P - H).toFixed(6)),
        S2: parseFloat((P - (H - L)).toFixed(6)),
        S3: parseFloat((L - 2 * (H - P)).toFixed(6)),
      };
    };

    // ── CALCULATE ALL INDICATORS ──────────────────────────────────
    // 1H indicators
    const rsi1h = closes1h.length >= 15 ? calcRSI(closes1h, 14) : 50;
    const ema9_1h = closes1h.length >= 9 ? calcEMA(closes1h, 9) : currentPrice;
    const ema21_1h = closes1h.length >= 21 ? calcEMA(closes1h, 21) : currentPrice;
    const ema50_1h = closes1h.length >= 50 ? calcEMA(closes1h, 50) : currentPrice;
    const macd1h = closes1h.length >= 35 ? calcMACD(closes1h) : { macd: 0, signal: 0, histogram: 0, bullish: false, bearish: false };
    const bb1h = closes1h.length >= 20 ? calcBB(closes1h) : { upper: 0, lower: 0, mid: 0, width: 0, position: 50 };
    const atr1h = K1h.length >= 15 ? calcATR(K1h) : 0;
    const vol1h = calcVolumeSignal(K1h);
    const stochRsi1h = calcStochRSI(closes1h);
    const sma200_1h = closes1h.length >= 200 ? calcSMA(closes1h, 200) : calcSMA(closes1h, closes1h.length);

    // 4H indicators
    const rsi4h = closes4h.length >= 15 ? calcRSI(closes4h, 14) : 50;
    const ema20_4h = closes4h.length >= 20 ? calcEMA(closes4h, 20) : currentPrice;
    const ema50_4h = closes4h.length >= 50 ? calcEMA(closes4h, 50) : currentPrice;
    const ema200_4h = closes4h.length >= 200 ? calcEMA(closes4h, 200) : calcEMA(closes4h, closes4h.length);
    const macd4h = closes4h.length >= 35 ? calcMACD(closes4h) : { macd: 0, signal: 0, histogram: 0, bullish: false, bearish: false };
    const bb4h = closes4h.length >= 20 ? calcBB(closes4h) : { upper: 0, lower: 0, mid: 0, width: 0, position: 50 };
    const atr4h = K4h.length >= 15 ? calcATR(K4h) : 0;
    const pivots4h = K4h.length >= 2 ? calcPivots(K4h) : null;

    // 1D indicators
    const rsi1d = closes1d.length >= 15 ? calcRSI(closes1d, 14) : 50;
    const ema50_1d = closes1d.length >= 50 ? calcEMA(closes1d, 50) : currentPrice;
    const ema200_1d = closes1d.length >= 100 ? calcEMA(closes1d, Math.min(200, closes1d.length)) : currentPrice;
    const macd1d = closes1d.length >= 35 ? calcMACD(closes1d) : { macd: 0, signal: 0, histogram: 0, bullish: false, bearish: false };
    const atr1d = K1d.length >= 15 ? calcATR(K1d) : 0;

    // ── TREND DETERMINATION ───────────────────────────────────────
    const trendScore1h = (currentPrice > ema9_1h ? 1 : -1) + (currentPrice > ema21_1h ? 1 : -1) + (currentPrice > ema50_1h ? 1 : -1) + (macd1h.bullish ? 1 : -1) + (rsi1h > 50 ? 0.5 : -0.5);
    const trendScore4h = (currentPrice > ema20_4h ? 1.5 : -1.5) + (currentPrice > ema50_4h ? 2 : -2) + (currentPrice > ema200_4h ? 2 : -2) + (macd4h.bullish ? 1 : -1) + (rsi4h > 50 ? 0.5 : -0.5);
    const trendScore1d = (currentPrice > ema50_1d ? 2 : -2) + (currentPrice > ema200_1d ? 2 : -2) + (macd1d.bullish ? 1 : -1) + (rsi1d > 50 ? 0.5 : -0.5);

    const getTrend = (score, thresholds = [2, 0]) => {
      if (score > thresholds[0]) return 'BULLISH';
      if (score > thresholds[1]) return 'BULLISH_WEAK';
      if (score < -thresholds[0]) return 'BEARISH';
      if (score < -thresholds[1]) return 'BEARISH_WEAK';
      return 'NEUTRAL';
    };

    const trend1h = getTrend(trendScore1h, [2, 0.5]);
    const trend4h = getTrend(trendScore4h, [3, 1]);
    const trend1d = getTrend(trendScore1d, [2, 0.5]);

    // Overall trend (weighted)
    const overallScore = trendScore1h * 0.2 + trendScore4h * 0.4 + trendScore1d * 0.4;
    const overallTrend = getTrend(overallScore, [2, 0.5]);

    // MA Signal (1H)
    const maSignal = {
      ema9: parseFloat(ema9_1h.toFixed(6)),
      ema21: parseFloat(ema21_1h.toFixed(6)),
      ema50: parseFloat(ema50_1h.toFixed(6)),
      sma200: parseFloat(sma200_1h.toFixed(6)),
      crossSignal: ema9_1h > ema21_1h ? (ema21_1h > ema50_1h ? 'GOLDEN CROSS BULLISH' : 'EMA9>EMA21') : 'EMA9<EMA21',
      trend: currentPrice > sma200_1h ? 'ABOVE MA200' : 'BELOW MA200',
    };

    // ── SUPPORT & RESISTANCE ──────────────────────────────────────
    const findSR = (K, lookback = 5) => {
      const highs = [], lows = [];
      for (let i = lookback; i < K.length - lookback; i++) {
        let isH = true, isL = true;
        for (let j = i - lookback; j <= i + lookback; j++) {
          if (j === i) continue;
          if (K[j].h >= K[i].h) isH = false;
          if (K[j].l <= K[i].l) isL = false;
        }
        if (isH) highs.push(K[i].h);
        if (isL) lows.push(K[i].l);
      }
      const nearR = highs.filter(h => h > currentPrice).sort((a, b) => a - b).slice(0, 3);
      const nearS = lows.filter(l => l < currentPrice).sort((a, b) => b - a).slice(0, 3);
      return { resistance: nearR, support: nearS };
    };

    const sr4h = K4h.length >= 10 ? findSR(K4h, 5) : { resistance: [], support: [] };
    const sr1d = K1d.length >= 10 ? findSR(K1d, 3) : { resistance: [], support: [] };

    const strongestSupport = sr1d.support[0] || sr4h.support[0] || currentPrice * 0.95;
    const strongestResistance = sr1d.resistance[0] || sr4h.resistance[0] || currentPrice * 1.05;

    // ── PROBABILITAS SCORE ────────────────────────────────────────
    let bullScore = 0, bearScore = 0;

    // Trend alignment (40%)
    if (trend1d === 'BULLISH') bullScore += 15; else if (trend1d === 'BEARISH') bearScore += 15;
    else if (trend1d === 'BULLISH_WEAK') bullScore += 7; else bearScore += 7;
    if (trend4h === 'BULLISH') bullScore += 12; else if (trend4h === 'BEARISH') bearScore += 12;
    else if (trend4h === 'BULLISH_WEAK') bullScore += 5; else bearScore += 5;
    if (trend1h === 'BULLISH') bullScore += 8; else if (trend1h === 'BEARISH') bearScore += 8;
    else if (trend1h === 'BULLISH_WEAK') bullScore += 3; else bearScore += 3;

    // RSI (20%)
    if (rsi4h < 30) bullScore += 12; else if (rsi4h > 75) bearScore += 12;
    else if (rsi4h < 45) bullScore += 5; else if (rsi4h > 60) bearScore += 5;

    // MACD (20%)
    if (macd4h.bullish && macd4h.histogram > 0) bullScore += 10;
    else if (macd4h.bearish && macd4h.histogram < 0) bearScore += 10;
    if (macd4h.crossUp) bullScore += 5;
    if (macd4h.crossDown) bearScore += 5;

    // BB Position (10%)
    if (bb4h.position < 15) bullScore += 8; else if (bb4h.position > 85) bearScore += 8;
    else if (bb4h.position < 35) bullScore += 3; else if (bb4h.position > 65) bearScore += 3;

    // Volume (10%)
    if (vol1h.ratio > 1.5 && trend1h === 'BULLISH') bullScore += 7;
    if (vol1h.ratio > 1.5 && trend1h === 'BEARISH') bearScore += 7;

    const totalScore = bullScore + bearScore;
    const probability = totalScore > 0 ? Math.round((Math.max(bullScore, bearScore) / totalScore) * 100) : 50;
    const signal = bullScore > bearScore ? (probability >= 65 ? 'BULLISH' : 'BULLISH_WEAK') : bearScore > bullScore ? (probability >= 65 ? 'BEARISH' : 'BEARISH_WEAK') : 'NEUTRAL';

    // ── SIGNAL NARRATIVE ──────────────────────────────────────────
    const generateNarrative = () => {
      const parts = [];
      if (overallTrend === 'BULLISH') parts.push('Tren makro bullish — semua timeframe aligned.');
      else if (overallTrend === 'BEARISH') parts.push('Tren makro bearish — semua timeframe bearish.');
      else parts.push('Tren mixed — perlu konfirmasi lebih lanjut.');

      if (rsi4h < 30) parts.push(`RSI 4H oversold (${rsi4h}) — potensi reversal atau bounce kuat.`);
      else if (rsi4h > 75) parts.push(`RSI 4H overbought (${rsi4h}) — waspada distribusi atau koreksi.`);
      else parts.push(`RSI 4H di ${rsi4h} — zona ${rsi4h > 50 ? 'momentum bullish' : 'momentum bearish'}.`);

      if (macd4h.crossUp) parts.push('MACD 4H golden cross — sinyal beli kuat.');
      else if (macd4h.crossDown) parts.push('MACD 4H death cross — sinyal jual kuat.');
      else if (macd4h.bullish) parts.push('MACD 4H positif — momentum bullish berlanjut.');
      else parts.push('MACD 4H negatif — tekanan jual dominan.');

      if (bb4h.width < 3) parts.push(`BB squeeze (width ${bb4h.width}%) — ekspansi volatilitas akan terjadi.`);
      if (bb4h.position < 10) parts.push('Harga mendekati BB lower — potensi bounce.');
      if (bb4h.position > 90) parts.push('Harga mendekati BB upper — potensi resistance.');

      return parts.join(' ');
    };

    // ── 24H CHANGE ────────────────────────────────────────────────
    let change24h = 0;
    if (ticker.status === 'fulfilled') change24h = parseFloat(ticker.value.priceChangePercent || 0);

    // ── FUNDING RATE ──────────────────────────────────────────────
    let fundingRate = 0;
    if (funding.status === 'fulfilled') fundingRate = parseFloat(funding.value.lastFundingRate || 0) * 100;

    // ── ORDER BOOK IMBALANCE ──────────────────────────────────────
    let obImbalance = 50;
    if (depth.status === 'fulfilled' && depth.value.bids) {
      const bidVol = depth.value.bids.reduce((s, b) => s + parseFloat(b[1]), 0);
      const askVol = depth.value.asks.reduce((s, a) => s + parseFloat(a[1]), 0);
      obImbalance = parseFloat((bidVol / (bidVol + askVol) * 100).toFixed(1));
    }

    // ── RESPONSE ──────────────────────────────────────────────────
    const result = {
      symbol,
      timestamp: Date.now(),
      currentPrice: parseFloat(currentPrice.toFixed(6)),
      change24h: parseFloat(change24h.toFixed(2)),

      // Core signal
      signal,
      probability,
      overallTrend,
      narrative: generateNarrative(),
      action: signal === 'BULLISH' ? 'BUY' : signal === 'BEARISH' ? 'SELL' : signal === 'BULLISH_WEAK' ? 'WATCH_BUY' : signal === 'BEARISH_WEAK' ? 'WATCH_SELL' : 'HOLD',

      // RSI — all properly calculated
      rsi: {
        '1h': rsi1h,
        '4h': rsi4h,
        '1d': rsi1d,
        signal1h: rsi1h < 30 ? 'OVERSOLD' : rsi1h > 70 ? 'OVERBOUGHT' : rsi1h > 50 ? 'BULLISH_ZONE' : 'BEARISH_ZONE',
        signal4h: rsi4h < 30 ? 'OVERSOLD' : rsi4h > 70 ? 'OVERBOUGHT' : rsi4h > 50 ? 'BULLISH_ZONE' : 'BEARISH_ZONE',
        signal1d: rsi1d < 30 ? 'OVERSOLD' : rsi1d > 70 ? 'OVERBOUGHT' : rsi1d > 50 ? 'BULLISH_ZONE' : 'BEARISH_ZONE',
        stochRsi1h,
      },

      // Moving Averages — all real values
      ma: {
        ema9_1h: parseFloat(ema9_1h.toFixed(6)),
        ema21_1h: parseFloat(ema21_1h.toFixed(6)),
        ema50_1h: parseFloat(ema50_1h.toFixed(6)),
        sma200_1h: parseFloat(sma200_1h.toFixed(6)),
        ema20_4h: parseFloat(ema20_4h.toFixed(6)),
        ema50_4h: parseFloat(ema50_4h.toFixed(6)),
        ema200_4h: parseFloat(ema200_4h.toFixed(6)),
        ema50_1d: parseFloat(ema50_1d.toFixed(6)),
        ema200_1d: parseFloat(ema200_1d.toFixed(6)),
        signal: maSignal,
        trend: currentPrice > ema200_4h ? 'ABOVE EMA200 4H (Bullish)' : 'BELOW EMA200 4H (Bearish)',
      },

      // MACD
      macd: {
        '1h': macd1h,
        '4h': macd4h,
        '1d': macd1d,
      },

      // Bollinger Bands
      bb: {
        '1h': bb1h,
        '4h': bb4h,
        squeeze: bb4h.width < 3,
        squeezeDetail: bb4h.width < 3 ? `BB squeeze aktif (width ${bb4h.width}%) — ekspansi imminent` : null,
      },

      // ATR
      atr: {
        '1h': parseFloat(atr1h.toFixed(6)),
        '4h': parseFloat(atr4h.toFixed(6)),
        '1d': parseFloat(atr1d.toFixed(6)),
        atrPct4h: parseFloat((atr4h / currentPrice * 100).toFixed(2)),
        volatility: atr4h / currentPrice * 100 > 5 ? 'HIGH' : atr4h / currentPrice * 100 > 2 ? 'MEDIUM' : 'LOW',
      },

      // Pivot Points
      pivots: pivots4h,

      // Support/Resistance
      supportResistance: {
        support: [strongestSupport, sr4h.support[1] || strongestSupport * 0.97].map(s => parseFloat(s.toFixed(6))),
        resistance: [strongestResistance, sr4h.resistance[1] || strongestResistance * 1.03].map(r => parseFloat(r.toFixed(6))),
        strongestSupport: parseFloat(strongestSupport.toFixed(6)),
        strongestResistance: parseFloat(strongestResistance.toFixed(6)),
      },

      // Volume
      volume: vol1h,

      // Derivatives
      fundingRate: parseFloat(fundingRate.toFixed(4)),
      orderBookImbalance: obImbalance,

      // Trend per TF
      trends: {
        '1h': trend1h,
        '4h': trend4h,
        '1d': trend1d,
        overall: overallTrend,
        score: {
          '1h': parseFloat(trendScore1h.toFixed(2)),
          '4h': parseFloat(trendScore4h.toFixed(2)),
          '1d': parseFloat(trendScore1d.toFixed(2)),
        },
      },

      // Score breakdown
      scoreBreakdown: {
        bull: bullScore,
        bear: bearScore,
        total: totalScore,
        bullPct: totalScore > 0 ? Math.round(bullScore / totalScore * 100) : 50,
      },
    };

    res.setHeader('Cache-Control', 's-maxage=30');
    return res.status(200).json(result);

  } catch (e) {
    return res.status(500).json({ error: e.message, symbol });
  }
}
