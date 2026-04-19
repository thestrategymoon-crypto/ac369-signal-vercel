// api/data.js — AC369 Signal System | Multi-Source Data Proxy v2.0
// Sources: Binance Spot + Futures, Alternative.me, CoinGecko

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { source, ...params } = req.query;

  try {
    let url, data;

    // ─── 1. FEAR & GREED INDEX ───────────────────────────────────────
    if (source === 'feargreed') {
      url = 'https://api.alternative.me/fng/?limit=30&format=json';
      const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
      data = await r.json();

    // ─── 2. COINGECKO GLOBAL MARKET ──────────────────────────────────
    } else if (source === 'coingecko_global') {
      url = 'https://api.coingecko.com/api/v3/global';
      const r = await fetch(url, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(10000)
      });
      data = await r.json();

    // ─── 3. COINGECKO TRENDING ───────────────────────────────────────
    } else if (source === 'coingecko_trending') {
      url = 'https://api.coingecko.com/api/v3/search/trending';
      const r = await fetch(url, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(10000)
      });
      data = await r.json();

    // ─── 4. CVD — Cumulative Volume Delta (Binance Spot Trades) ──────
    } else if (source === 'binance_trades') {
      const sym = params.symbol || 'BTCUSDT';
      url = `https://api.binance.com/api/v3/trades?symbol=${sym}&limit=1000`;
      const r = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(12000)
      });
      data = await r.json();

    // ─── 5. ORDER BOOK DEPTH (Imbalance) ─────────────────────────────
    } else if (source === 'binance_depth') {
      const sym = params.symbol || 'BTCUSDT';
      url = `https://api.binance.com/api/v3/depth?symbol=${sym}&limit=50`;
      const r = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(8000)
      });
      data = await r.json();

    // ─── 6. KLINES — Multi-Timeframe OHLCV ───────────────────────────
    } else if (source === 'binance_klines') {
      const sym = params.symbol || 'BTCUSDT';
      const interval = params.interval || '4h';
      const limit = params.limit || '200';
      url = `https://api.binance.com/api/v3/klines?symbol=${sym}&interval=${interval}&limit=${limit}`;
      const r = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(12000)
      });
      const raw = await r.json();
      // Format: [time, open, high, low, close, volume, ...]
      data = raw.map(k => ({
        t: k[0], o: parseFloat(k[1]), h: parseFloat(k[2]),
        l: parseFloat(k[3]), c: parseFloat(k[4]), v: parseFloat(k[5])
      }));

    // ─── 7. FUTURES KLINES (FAPI) ────────────────────────────────────
    } else if (source === 'futures_klines') {
      const sym = params.symbol || 'BTCUSDT';
      const interval = params.interval || '4h';
      const limit = params.limit || '200';
      url = `https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=${interval}&limit=${limit}`;
      const r = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(12000)
      });
      const raw = await r.json();
      data = raw.map(k => ({
        t: k[0], o: parseFloat(k[1]), h: parseFloat(k[2]),
        l: parseFloat(k[3]), c: parseFloat(k[4]), v: parseFloat(k[5]),
        takerBuy: parseFloat(k[9]), takerSell: parseFloat(k[5]) - parseFloat(k[9])
      }));

    // ─── 8. OPEN INTEREST HISTORY ────────────────────────────────────
    } else if (source === 'oi_history') {
      const sym = params.symbol || 'BTCUSDT';
      const period = params.period || '4h';
      const limit = params.limit || '50';
      url = `https://fapi.binance.com/futures/data/openInterestHist?symbol=${sym}&period=${period}&limit=${limit}`;
      const r = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(10000)
      });
      data = await r.json();

    // ─── 9. LONG/SHORT RATIO ─────────────────────────────────────────
    } else if (source === 'longshort') {
      const sym = params.symbol || 'BTCUSDT';
      const period = params.period || '4h';
      const limit = params.limit || '50';
      url = `https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${sym}&period=${period}&limit=${limit}`;
      const r = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(10000)
      });
      data = await r.json();

    // ─── 10. TAKER BUY/SELL VOLUME (Aggressor CVD) ───────────────────
    } else if (source === 'taker_volume') {
      const sym = params.symbol || 'BTCUSDT';
      const period = params.period || '4h';
      const limit = params.limit || '50';
      url = `https://fapi.binance.com/futures/data/takerlongshortRatio?symbol=${sym}&period=${period}&limit=${limit}`;
      const r = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(10000)
      });
      data = await r.json();

    // ─── 11. FUNDING RATE HISTORY ────────────────────────────────────
    } else if (source === 'funding') {
      const sym = params.symbol || 'BTCUSDT';
      const limit = params.limit || '20';
      url = `https://fapi.binance.com/fapi/v1/fundingRate?symbol=${sym}&limit=${limit}`;
      const r = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(8000)
      });
      data = await r.json();

    // ─── 12. CURRENT FUNDING RATE ────────────────────────────────────
    } else if (source === 'funding_current') {
      const sym = params.symbol || 'BTCUSDT';
      url = `https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${sym}`;
      const r = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(8000)
      });
      data = await r.json();

    // ─── 13. FUTURES TICKER (24h) ────────────────────────────────────
    } else if (source === 'futures_ticker') {
      const sym = params.symbol || 'BTCUSDT';
      url = `https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${sym}`;
      const r = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(8000)
      });
      data = await r.json();

    // ─── 14. SPOT TICKER 24H (multi-symbol) ──────────────────────────
    } else if (source === 'spot_tickers') {
      url = `https://api.binance.com/api/v3/ticker/24hr`;
      const r = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(12000)
      });
      const allTickers = await r.json();
      // Filter only USDT pairs with significant volume
      data = allTickers
        .filter(t => t.symbol.endsWith('USDT') && parseFloat(t.quoteVolume) > 10000000)
        .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
        .slice(0, 50)
        .map(t => ({
          symbol: t.symbol,
          price: parseFloat(t.lastPrice),
          change: parseFloat(t.priceChangePercent),
          volume: parseFloat(t.quoteVolume),
          high: parseFloat(t.highPrice),
          low: parseFloat(t.lowPrice)
        }));

    // ─── 15. CONFLUENCE SIGNAL ENGINE ────────────────────────────────
    } else if (source === 'confluence') {
      const sym = params.symbol || 'BTCUSDT';

      // Fetch semua data secara paralel
      const [
        klines4h, klines1d, oiHist, lsRatio,
        takerVol, fundingRes, depthRes, fngRes
      ] = await Promise.allSettled([
        fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=4h&limit=200`).then(r => r.json()),
        fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=1d&limit=50`).then(r => r.json()),
        fetch(`https://fapi.binance.com/futures/data/openInterestHist?symbol=${sym}&period=4h&limit=20`).then(r => r.json()),
        fetch(`https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${sym}&period=4h&limit=10`).then(r => r.json()),
        fetch(`https://fapi.binance.com/futures/data/takerlongshortRatio?symbol=${sym}&period=4h&limit=10`).then(r => r.json()),
        fetch(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${sym}`).then(r => r.json()),
        fetch(`https://api.binance.com/api/v3/depth?symbol=${sym}&limit=50`).then(r => r.json()),
        fetch(`https://api.alternative.me/fng/?limit=1&format=json`).then(r => r.json()),
      ]);

      // ── Helper: EMA calculation
      const calcEMA = (closes, period) => {
        const k = 2 / (period + 1);
        let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
        for (let i = period; i < closes.length; i++) {
          ema = closes[i] * k + ema * (1 - k);
        }
        return ema;
      };

      // ── Helper: RSI calculation
      const calcRSI = (closes, period = 14) => {
        let gains = 0, losses = 0;
        for (let i = closes.length - period; i < closes.length; i++) {
          const diff = closes[i] - closes[i - 1];
          if (diff > 0) gains += diff;
          else losses -= diff;
        }
        const rs = gains / (losses || 0.001);
        return 100 - (100 / (1 + rs));
      };

      // ── Helper: MACD
      const calcMACD = (closes) => {
        const ema12 = calcEMA(closes, 12);
        const ema26 = calcEMA(closes, 26);
        return ema12 - ema26;
      };

      const scores = { bull: 0, bear: 0, signals: [] };

      // ── SIGNAL 1: HTF Trend (EMA 200 Daily)
      if (klines1d.status === 'fulfilled' && Array.isArray(klines1d.value)) {
        const closes1d = klines1d.value.map(k => parseFloat(k[4]));
        const currentPrice = closes1d[closes1d.length - 1];
        const ema200 = calcEMA(closes1d, Math.min(200, closes1d.length));
        const ema50 = calcEMA(closes1d, Math.min(50, closes1d.length));
        if (currentPrice > ema200) {
          scores.bull += 2;
          scores.signals.push({ name: 'HTF Trend', value: 'BULLISH', detail: `Price > EMA200 (${ema200.toFixed(0)})`, weight: 2, side: 'bull' });
        } else {
          scores.bear += 2;
          scores.signals.push({ name: 'HTF Trend', value: 'BEARISH', detail: `Price < EMA200 (${ema200.toFixed(0)})`, weight: 2, side: 'bear' });
        }
        if (ema50 > ema200) {
          scores.bull += 1;
          scores.signals.push({ name: 'EMA Cross', value: 'GOLDEN', detail: 'EMA50 > EMA200', weight: 1, side: 'bull' });
        } else {
          scores.bear += 1;
          scores.signals.push({ name: 'EMA Cross', value: 'DEATH', detail: 'EMA50 < EMA200', weight: 1, side: 'bear' });
        }
      }

      // ── SIGNAL 2: RSI 4H
      if (klines4h.status === 'fulfilled' && Array.isArray(klines4h.value)) {
        const closes4h = klines4h.value.map(k => parseFloat(k[4]));
        const rsi = calcRSI(closes4h);
        const macd = calcMACD(closes4h);
        if (rsi < 35) {
          scores.bull += 2;
          scores.signals.push({ name: 'RSI 4H', value: rsi.toFixed(1), detail: 'Oversold Zone', weight: 2, side: 'bull' });
        } else if (rsi > 70) {
          scores.bear += 2;
          scores.signals.push({ name: 'RSI 4H', value: rsi.toFixed(1), detail: 'Overbought Zone', weight: 2, side: 'bear' });
        } else if (rsi < 50) {
          scores.bull += 1;
          scores.signals.push({ name: 'RSI 4H', value: rsi.toFixed(1), detail: 'Below Midline', weight: 1, side: 'bull' });
        } else {
          scores.bear += 1;
          scores.signals.push({ name: 'RSI 4H', value: rsi.toFixed(1), detail: 'Above Midline', weight: 1, side: 'bear' });
        }
        if (macd > 0) {
          scores.bull += 1;
          scores.signals.push({ name: 'MACD 4H', value: macd.toFixed(2), detail: 'Bullish Momentum', weight: 1, side: 'bull' });
        } else {
          scores.bear += 1;
          scores.signals.push({ name: 'MACD 4H', value: macd.toFixed(2), detail: 'Bearish Momentum', weight: 1, side: 'bear' });
        }
      }

      // ── SIGNAL 3: Open Interest Trend
      if (oiHist.status === 'fulfilled' && Array.isArray(oiHist.value) && oiHist.value.length >= 5) {
        const oiValues = oiHist.value.map(o => parseFloat(o.sumOpenInterest));
        const oiLatest = oiValues[oiValues.length - 1];
        const oiPrev = oiValues[oiValues.length - 5];
        const oiChange = ((oiLatest - oiPrev) / oiPrev) * 100;
        const closes4h = klines4h.status === 'fulfilled' ? klines4h.value.map(k => parseFloat(k[4])) : [];
        const priceUp = closes4h.length > 5 && closes4h[closes4h.length - 1] > closes4h[closes4h.length - 5];
        if (oiChange > 2 && priceUp) {
          scores.bull += 2;
          scores.signals.push({ name: 'OI + Price', value: `OI +${oiChange.toFixed(1)}%`, detail: 'Long Buildup', weight: 2, side: 'bull' });
        } else if (oiChange > 2 && !priceUp) {
          scores.bear += 2;
          scores.signals.push({ name: 'OI + Price', value: `OI +${oiChange.toFixed(1)}%`, detail: 'Short Buildup', weight: 2, side: 'bear' });
        } else if (oiChange < -2 && !priceUp) {
          scores.bull += 1;
          scores.signals.push({ name: 'OI + Price', value: `OI ${oiChange.toFixed(1)}%`, detail: 'Long Squeeze Done', weight: 1, side: 'bull' });
        } else {
          scores.signals.push({ name: 'OI + Price', value: `OI ${oiChange.toFixed(1)}%`, detail: 'Neutral', weight: 0, side: 'neutral' });
        }
      }

      // ── SIGNAL 4: Long/Short Ratio
      if (lsRatio.status === 'fulfilled' && Array.isArray(lsRatio.value) && lsRatio.value.length > 0) {
        const latest = lsRatio.value[lsRatio.value.length - 1];
        const ls = parseFloat(latest.longShortRatio);
        if (ls < 0.9) {
          scores.bull += 2;
          scores.signals.push({ name: 'L/S Ratio', value: ls.toFixed(2), detail: 'Retail Majority Short → Contrarian LONG', weight: 2, side: 'bull' });
        } else if (ls > 1.8) {
          scores.bear += 2;
          scores.signals.push({ name: 'L/S Ratio', value: ls.toFixed(2), detail: 'Retail Majority Long → Contrarian SHORT', weight: 2, side: 'bear' });
        } else {
          scores.signals.push({ name: 'L/S Ratio', value: ls.toFixed(2), detail: 'Balanced', weight: 0, side: 'neutral' });
        }
      }

      // ── SIGNAL 5: Taker Buy/Sell Ratio (CVD aggressor)
      if (takerVol.status === 'fulfilled' && Array.isArray(takerVol.value) && takerVol.value.length > 0) {
        const recent = takerVol.value.slice(-5);
        const avgBuy = recent.reduce((s, v) => s + parseFloat(v.buySellRatio), 0) / recent.length;
        if (avgBuy > 1.1) {
          scores.bull += 2;
          scores.signals.push({ name: 'Taker CVD', value: avgBuy.toFixed(2), detail: 'Buyers Aggressive', weight: 2, side: 'bull' });
        } else if (avgBuy < 0.9) {
          scores.bear += 2;
          scores.signals.push({ name: 'Taker CVD', value: avgBuy.toFixed(2), detail: 'Sellers Aggressive', weight: 2, side: 'bear' });
        } else {
          scores.signals.push({ name: 'Taker CVD', value: avgBuy.toFixed(2), detail: 'Neutral CVD', weight: 0, side: 'neutral' });
        }
      }

      // ── SIGNAL 6: Funding Rate
      if (fundingRes.status === 'fulfilled' && fundingRes.value.lastFundingRate) {
        const fr = parseFloat(fundingRes.value.lastFundingRate) * 100;
        if (fr < -0.05) {
          scores.bull += 2;
          scores.signals.push({ name: 'Funding Rate', value: `${fr.toFixed(4)}%`, detail: 'Extremely Negative → Long Opportunity', weight: 2, side: 'bull' });
        } else if (fr > 0.1) {
          scores.bear += 2;
          scores.signals.push({ name: 'Funding Rate', value: `${fr.toFixed(4)}%`, detail: 'Overheated Longs → Short Risk', weight: 2, side: 'bear' });
        } else if (fr < 0) {
          scores.bull += 1;
          scores.signals.push({ name: 'Funding Rate', value: `${fr.toFixed(4)}%`, detail: 'Negative → Slight Long Bias', weight: 1, side: 'bull' });
        } else {
          scores.signals.push({ name: 'Funding Rate', value: `${fr.toFixed(4)}%`, detail: 'Neutral', weight: 0, side: 'neutral' });
        }
      }

      // ── SIGNAL 7: Order Book Imbalance
      if (depthRes.status === 'fulfilled' && depthRes.value.bids && depthRes.value.asks) {
        const bidVol = depthRes.value.bids.reduce((s, b) => s + parseFloat(b[1]), 0);
        const askVol = depthRes.value.asks.reduce((s, a) => s + parseFloat(a[1]), 0);
        const imbalance = bidVol / (bidVol + askVol);
        if (imbalance > 0.6) {
          scores.bull += 1;
          scores.signals.push({ name: 'Order Book', value: `${(imbalance * 100).toFixed(0)}% Bid`, detail: 'Bid Wall Dominant', weight: 1, side: 'bull' });
        } else if (imbalance < 0.4) {
          scores.bear += 1;
          scores.signals.push({ name: 'Order Book', value: `${((1 - imbalance) * 100).toFixed(0)}% Ask`, detail: 'Ask Wall Dominant', weight: 1, side: 'bear' });
        } else {
          scores.signals.push({ name: 'Order Book', value: `${(imbalance * 100).toFixed(0)}% Bid`, detail: 'Balanced Book', weight: 0, side: 'neutral' });
        }
      }

      // ── SIGNAL 8: Fear & Greed
      if (fngRes.status === 'fulfilled' && fngRes.value.data) {
        const fng = parseInt(fngRes.value.data[0].value);
        const fngLabel = fngRes.value.data[0].value_classification;
        if (fng <= 20) {
          scores.bull += 2;
          scores.signals.push({ name: 'Fear & Greed', value: `${fng} — ${fngLabel}`, detail: 'Extreme Fear = Buy Zone', weight: 2, side: 'bull' });
        } else if (fng >= 80) {
          scores.bear += 2;
          scores.signals.push({ name: 'Fear & Greed', value: `${fng} — ${fngLabel}`, detail: 'Extreme Greed = Caution', weight: 2, side: 'bear' });
        } else if (fng < 40) {
          scores.bull += 1;
          scores.signals.push({ name: 'Fear & Greed', value: `${fng} — ${fngLabel}`, detail: 'Fear Zone', weight: 1, side: 'bull' });
        } else {
          scores.signals.push({ name: 'Fear & Greed', value: `${fng} — ${fngLabel}`, detail: 'Neutral Zone', weight: 0, side: 'neutral' });
        }
      }

      // ── FINAL VERDICT
      const totalWeight = scores.bull + scores.bear;
      const bullPct = totalWeight > 0 ? Math.round((scores.bull / totalWeight) * 100) : 50;
      let verdict, strength, action;

      if (bullPct >= 70) {
        verdict = 'STRONG LONG';
        strength = 'HIGH';
        action = 'ENTRY VALID — Confluence ≥70% Bullish';
      } else if (bullPct >= 55) {
        verdict = 'LONG BIAS';
        strength = 'MEDIUM';
        action = 'CAUTIOUS LONG — Wait for confirmation';
      } else if (bullPct <= 30) {
        verdict = 'STRONG SHORT';
        strength = 'HIGH';
        action = 'ENTRY VALID — Confluence ≥70% Bearish';
      } else if (bullPct <= 45) {
        verdict = 'SHORT BIAS';
        strength = 'MEDIUM';
        action = 'CAUTIOUS SHORT — Wait for confirmation';
      } else {
        verdict = 'NEUTRAL';
        strength = 'LOW';
        action = 'NO TRADE — Market unclear, wait for setup';
      }

      data = {
        symbol: sym,
        timestamp: Date.now(),
        verdict,
        strength,
        action,
        bullScore: scores.bull,
        bearScore: scores.bear,
        bullPct,
        bearPct: 100 - bullPct,
        signals: scores.signals
      };

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
