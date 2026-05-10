// api/daytrade.js — AC369 FUSION DAY TRADE INTELLIGENCE v1.0
// ══════════════════════════════════════════════════════════════════
// REAL-TIME DAY TRADE ENGINE
//
// Engine 1: ORDER BOOK ANALYSIS
//   - Bid/ask walls = where SM has real orders
//   - Imbalance ratio = buy vs sell pressure NOW
//   - Biggest wall = institutional level
//   - Entry/SL derived from actual order flow
//
// Engine 2: WHALE TRADE DETECTOR
//   - Aggregate trades filtered by size ($50k+)
//   - Net whale direction: accumulating or distributing?
//   - Velocity: how fast are whales acting?
//
// Engine 3: KLINES STRUCTURE (daily)
//   - Real support/resistance from daily swings
//   - EMA 20/50 for trend direction
//   - SL placed below real structural level
//
// Output: STRONG BUY / BUY / NEUTRAL / SELL / STRONG SELL
// with exact Entry, SL (structural), TP1/TP2/TP3
// ══════════════════════════════════════════════════════════════════

const SCAN_SYMBOLS = [
  // Majors — always liquid enough for day trade
  'BTC','ETH','BNB','SOL','XRP','ADA','AVAX','DOGE','LINK','DOT',
  'MATIC','ATOM','UNI','ARB','OP','APT','SUI','TIA','INJ','SEI',
  // High-beta alts good for day trade
  'PEPE','WIF','TAO','FET','RNDR','AGIX','IMX','BLUR','STX','GALA',
];

const WHALE_THRESHOLD_USD = 80000; // trades > $80k = whale
const ORDERBOOK_LEVELS = 20;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 's-maxage=20'); // shorter cache — data is live
  if (req.method === 'OPTIONS') return res.status(200).end();

  const sf = async (url, ms = 6000) => {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), ms);
    try {
      const r = await fetch(url, {
        signal: c.signal,
        headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
      });
      clearTimeout(t);
      if (!r.ok) return null;
      return await r.json();
    } catch { clearTimeout(t); return null; }
  };

  // ════════════════════════════════════════════════════════════════
  // ENGINE 1: ORDER BOOK ANALYSIS
  // ════════════════════════════════════════════════════════════════
  function analyzeOrderBook(bids, asks, price) {
    if (!bids?.length || !asks?.length) return null;

    // Calculate total $ value at each level
    const bidLevels = bids.slice(0, ORDERBOOK_LEVELS).map(([p, q]) => ({
      price: +p, qty: +q, usd: +p * +q,
    }));
    const askLevels = asks.slice(0, ORDERBOOK_LEVELS).map(([p, q]) => ({
      price: +p, qty: +q, usd: +p * +q,
    }));

    const totalBidUSD = bidLevels.reduce((a, b) => a + b.usd, 0);
    const totalAskUSD = askLevels.reduce((a, b) => a + b.usd, 0);

    // Find the biggest single wall (most USD at one level)
    const biggestBid = bidLevels.reduce((a, b) => b.usd > a.usd ? b : a, bidLevels[0]);
    const biggestAsk = askLevels.reduce((a, b) => b.usd > a.usd ? b : a, askLevels[0]);

    // Find whale walls (any single level > 5% of total side)
    const bidWalls = bidLevels.filter(l => l.usd > totalBidUSD * 0.12).sort((a, b) => b.price - a.price);
    const askWalls = askLevels.filter(l => l.usd > totalAskUSD * 0.12).sort((a, b) => a.price - b.price);

    // Imbalance ratio: > 1.5 = strong buy pressure
    const imbalance = totalAskUSD > 0 ? totalBidUSD / totalAskUSD : 1;

    // Spread
    const bestBid = bidLevels[0]?.price || price * 0.999;
    const bestAsk = askLevels[0]?.price || price * 1.001;
    const spread  = ((bestAsk - bestBid) / price * 100);

    // Support: strongest bid wall below price
    const supportLevel = bidWalls[0]?.price || biggestBid.price;
    // Resistance: strongest ask wall above price
    const resistLevel  = askWalls[0]?.price || biggestAsk.price;

    // OB Signal
    let obSignal = 'NEUTRAL', obScore = 0;
    if (imbalance > 2.5)      { obSignal = 'STRONG BUY';  obScore = 25; }
    else if (imbalance > 1.5) { obSignal = 'BUY PRESSURE'; obScore = 18; }
    else if (imbalance > 1.2) { obSignal = 'MILD BUY';     obScore = 10; }
    else if (imbalance < 0.5) { obSignal = 'STRONG SELL';  obScore = -20; }
    else if (imbalance < 0.7) { obSignal = 'SELL PRESSURE';obScore = -12; }
    else                      { obSignal = 'BALANCED';      obScore = 3; }

    // If biggest bid wall is MUCH bigger than biggest ask = institutional buy
    const wallRatio = biggestAsk.usd > 0 ? biggestBid.usd / biggestAsk.usd : 1;
    if (wallRatio > 3)       { obScore += 10; obSignal = 'WHALE BID WALL'; }
    else if (wallRatio < 0.3){ obScore -= 10; obSignal = 'WHALE ASK WALL'; }

    // Entry: just above best bid (market is there)
    // SL: below biggest bid wall (SM won't let it break without removing their order)
    const entry = +(bestAsk * 1.0005).toFixed(8);
    const sl    = +(supportLevel * 0.9985).toFixed(8); // 0.15% below support wall
    const slPct = +((price - sl) / price * 100).toFixed(2);

    // TP: use ask walls as targets
    const tp1 = askWalls[0]?.price || +(price * 1.015).toFixed(8);
    const tp2 = askWalls[1]?.price || +(price * 1.030).toFixed(8);
    const tp3 = +(price * 1.05).toFixed(8);

    return {
      totalBidUSD: +totalBidUSD.toFixed(0),
      totalAskUSD: +totalAskUSD.toFixed(0),
      imbalance: +imbalance.toFixed(3),
      biggestBid: { price: biggestBid.price, usd: +biggestBid.usd.toFixed(0) },
      biggestAsk: { price: biggestAsk.price, usd: +biggestAsk.usd.toFixed(0) },
      bidWalls: bidWalls.slice(0, 3).map(w => ({ price: w.price, usd: +w.usd.toFixed(0) })),
      askWalls: askWalls.slice(0, 3).map(w => ({ price: w.price, usd: +w.usd.toFixed(0) })),
      supportLevel: +supportLevel.toFixed(8),
      resistLevel: +resistLevel.toFixed(8),
      spread: +spread.toFixed(4),
      obSignal, obScore,
      wallRatio: +wallRatio.toFixed(2),
      trade: {
        entry: +entry.toFixed(8),
        sl: +sl.toFixed(8), slPct,
        tp1: +tp1.toFixed(8), tp1Pct: +((tp1 - price) / price * 100).toFixed(2),
        tp2: +tp2.toFixed(8), tp2Pct: +((tp2 - price) / price * 100).toFixed(2),
        tp3: +tp3.toFixed(8), tp3Pct: +((tp3 - price) / price * 100).toFixed(2),
        rr1: slPct > 0 ? +((tp1 - price) / (price - sl)).toFixed(1) : '—',
        rr2: slPct > 0 ? +((tp2 - price) / (price - sl)).toFixed(1) : '—',
        slNote: 'Below biggest bid wall (SM support level)',
      },
    };
  }

  // ════════════════════════════════════════════════════════════════
  // ENGINE 2: WHALE TRADE DETECTOR
  // ════════════════════════════════════════════════════════════════
  function analyzeWhaleTrades(trades, price) {
    if (!trades?.length) return null;

    const whaleTrades = [];
    let buyVolUSD = 0, sellVolUSD = 0;
    let buyCount = 0, sellCount = 0;
    let totalVolUSD = 0;

    trades.forEach(t => {
      // Binance aggTrades: { a: aggId, p: price, q: qty, f: firstId, l: lastId, T: time, m: isBuyerMaker }
      const tradePrice = +t.p;
      const tradeQty   = +t.q;
      const tradeUSD   = tradePrice * tradeQty;
      const isSell     = t.m; // m=true means buyer is maker = seller hit the market

      totalVolUSD += tradeUSD;

      if (isSell) {
        sellVolUSD += tradeUSD;
        sellCount++;
      } else {
        buyVolUSD += tradeUSD;
        buyCount++;
      }

      // Whale filter
      if (tradeUSD >= WHALE_THRESHOLD_USD) {
        whaleTrades.push({
          price: tradePrice,
          qty: tradeQty,
          usd: +tradeUSD.toFixed(0),
          side: isSell ? 'SELL' : 'BUY',
          time: t.T,
          timeAgo: Math.round((Date.now() - t.T) / 60000), // minutes ago
        });
      }
    });

    // Net whale direction
    const whaleBuyUSD  = whaleTrades.filter(t => t.side === 'BUY').reduce((a, t) => a + t.usd, 0);
    const whaleSellUSD = whaleTrades.filter(t => t.side === 'SELL').reduce((a, t) => a + t.usd, 0);
    const netWhaleUSD  = whaleBuyUSD - whaleSellUSD;
    const whaleRatio   = (whaleBuyUSD + whaleSellUSD) > 0
      ? whaleBuyUSD / (whaleBuyUSD + whaleSellUSD)
      : 0.5;

    // Buy pressure ratio (all trades, not just whales)
    const buyRatio = totalVolUSD > 0 ? buyVolUSD / totalVolUSD : 0.5;

    // Whale signal
    let whaleSignal = 'NEUTRAL', whaleScore = 0;
    if (whaleTrades.length === 0) {
      whaleSignal = 'NO WHALE ACTIVITY'; whaleScore = 0;
    } else if (whaleRatio > 0.80) {
      whaleSignal = 'WHALE ACCUMULATING'; whaleScore = 25;
    } else if (whaleRatio > 0.65) {
      whaleSignal = 'NET WHALE BUY';     whaleScore = 18;
    } else if (whaleRatio > 0.55) {
      whaleSignal = 'MILD WHALE BUY';   whaleScore = 10;
    } else if (whaleRatio < 0.20) {
      whaleSignal = 'WHALE DUMPING';    whaleScore = -25;
    } else if (whaleRatio < 0.35) {
      whaleSignal = 'NET WHALE SELL';   whaleScore = -18;
    } else {
      whaleSignal = 'MIXED WHALE';       whaleScore = 2;
    }

    // Velocity: how many whale trades in last 10 min?
    const recent10min = whaleTrades.filter(t => t.timeAgo <= 10).length;
    if (recent10min >= 5 && whaleScore > 0) {
      whaleScore += 8; whaleSignal += ' 🔥';
    }

    return {
      totalTrades: trades.length,
      whaleTrades: whaleTrades.slice(0, 8).sort((a, b) => b.usd - a.usd), // top 8 by size
      whaleCount: whaleTrades.length,
      whaleBuyUSD: +whaleBuyUSD.toFixed(0),
      whaleSellUSD: +whaleSellUSD.toFixed(0),
      netWhaleUSD: +netWhaleUSD.toFixed(0),
      whaleRatio: +whaleRatio.toFixed(3),
      buyRatio: +buyRatio.toFixed(3),
      buyVolUSD: +buyVolUSD.toFixed(0),
      sellVolUSD: +sellVolUSD.toFixed(0),
      totalVolUSD: +totalVolUSD.toFixed(0),
      recentActivity: recent10min,
      whaleSignal, whaleScore,
    };
  }

  // ════════════════════════════════════════════════════════════════
  // ENGINE 3: KLINES STRUCTURE (daily)
  // Real SL from structural swing lows
  // ════════════════════════════════════════════════════════════════
  function analyzeStructure(klines, price) {
    if (!klines?.length || klines.length < 10) return null;

    const closes = klines.map(k => +k[4]);
    const highs  = klines.map(k => +k[2]);
    const lows   = klines.map(k => +k[3]);
    const vols   = klines.map(k => +k[5]);
    const n = closes.length;

    // EMA calculation
    const ema = (arr, period) => {
      const k = 2 / (period + 1);
      let e = arr[0];
      for (let i = 1; i < arr.length; i++) e = arr[i] * k + e * (1 - k);
      return e;
    };
    const ema20  = ema(closes, 20);
    const ema50  = ema(closes, Math.min(50, n));
    const ema200 = ema(closes, Math.min(200, n));

    // Recent swing lows (last 14 candles)
    const swingLows = [];
    for (let i = 2; i < Math.min(n - 2, 14); i++) {
      if (lows[n-i] < lows[n-i-1] && lows[n-i] < lows[n-i-2] &&
          lows[n-i] < lows[n-i+1] && lows[n-i] < lows[n-i+2]) {
        swingLows.push(lows[n - i]);
      }
    }

    // Structural support = highest swing low below current price
    const supports = swingLows.filter(l => l < price).sort((a, b) => b - a);
    const structuralSupport = supports[0] || lows.slice(-20).sort((a, b) => a - b)[3] || price * 0.93;
    const structuralSupport2 = supports[1] || price * 0.90;

    // Recent swing highs = resistance
    const swingHighs = [];
    for (let i = 2; i < Math.min(n - 2, 14); i++) {
      if (highs[n-i] > highs[n-i-1] && highs[n-i] > highs[n-i-2] &&
          highs[n-i] > highs[n-i+1] && highs[n-i] > highs[n-i+2]) {
        swingHighs.push(highs[n - i]);
      }
    }
    const resistances = swingHighs.filter(h => h > price).sort((a, b) => a - b);
    const structuralResist = resistances[0] || highs.slice(-20).sort((a, b) => b - a)[2] || price * 1.08;

    // Volume average
    const avgVol = vols.slice(-20).reduce((a, b) => a + b, 0) / 20;
    const latestVol = vols[n - 1];
    const volRatio = avgVol > 0 ? latestVol / avgVol : 1;

    // Trend
    const trend = price > ema50 * 1.01 ? 'UPTREND' :
                  price < ema50 * 0.99 ? 'DOWNTREND' : 'RANGING';
    const trendStrong = price > ema200 ? 'ABOVE 200 EMA' : 'BELOW 200 EMA';

    // Structural SL: 0.5% below structural support (not 24h low!)
    const structuralSL = +(structuralSupport * 0.995).toFixed(8);
    const structSLPct  = +((price - structuralSL) / price * 100).toFixed(2);

    let structScore = 0;
    if (trend === 'UPTREND') structScore += 12;
    if (trendStrong === 'ABOVE 200 EMA') structScore += 8;
    if (volRatio > 1.5) structScore += 8;
    if (price > ema20) structScore += 5;
    if (trend === 'DOWNTREND') structScore -= 10;

    return {
      ema20: +ema20.toFixed(4), ema50: +ema50.toFixed(4), ema200: +ema200.toFixed(4),
      trend, trendStrong,
      structuralSupport: +structuralSupport.toFixed(8),
      structuralSupport2: +structuralSupport2.toFixed(8),
      structuralResist: +structuralResist.toFixed(8),
      structuralSL, structSLPct,
      volRatio: +volRatio.toFixed(2),
      avgVol: +avgVol.toFixed(2),
      swingLowCount: swingLows.length,
      structScore,
    };
  }

  // ════════════════════════════════════════════════════════════════
  // FINAL SIGNAL COMBINER
  // ════════════════════════════════════════════════════════════════
  function combineSignals(ob, whale, struct, ch24, price) {
    let totalScore = 0;
    const reasons = [];
    const warnings = [];

    if (ob) {
      totalScore += ob.obScore;
      if (ob.obScore >= 18) reasons.push(`📊 ${ob.obSignal}: $${(ob.totalBidUSD/1e6).toFixed(1)}M bids vs $${(ob.totalAskUSD/1e6).toFixed(1)}M asks (${ob.imbalance.toFixed(1)}x)`);
      else if (ob.obScore < 0) warnings.push(`📊 ${ob.obSignal}`);
      if (ob.wallRatio > 3) reasons.push(`🏛️ Whale bid wall $${(ob.biggestBid.usd/1e3).toFixed(0)}k at $${fmtP(ob.biggestBid.price)}`);
    }

    if (whale) {
      totalScore += whale.whaleScore;
      if (whale.whaleScore >= 15) reasons.push(`🐳 ${whale.whaleSignal}: $${(whale.whaleBuyUSD/1e3).toFixed(0)}k whale buys`);
      else if (whale.whaleScore < 0) warnings.push(`🐳 ${whale.whaleSignal}: $${(whale.whaleSellUSD/1e3).toFixed(0)}k whale sells`);
      if (whale.recentActivity >= 3) reasons.push(`⚡ ${whale.recentActivity} whale trades in last 10 min`);
    }

    if (struct) {
      totalScore += struct.structScore;
      if (struct.trend === 'UPTREND') reasons.push(`📈 ${struct.trend} — price above EMA50`);
      if (struct.trendStrong === 'ABOVE 200 EMA') reasons.push(`💪 ${struct.trendStrong} — macro bullish`);
      if (struct.volRatio > 1.5) reasons.push(`🔊 Vol ${struct.volRatio.toFixed(1)}x above average`);
      if (struct.trend === 'DOWNTREND') warnings.push(`📉 ${struct.trend} — price below EMA50`);
    }

    // 24h momentum
    if (ch24 > 3) { totalScore += 8; reasons.push(`✅ +${ch24.toFixed(1)}% momentum today`); }
    else if (ch24 < -5) { totalScore -= 8; warnings.push(`⚠️ ${ch24.toFixed(1)}% pullback today`); }

    // Overall signal
    const signal =
      totalScore >= 50 ? { s: '🔥 STRONG BUY',  c: '#00ff88', action: 'EXECUTE',   confidence: 'HIGH'   } :
      totalScore >= 25 ? { s: '✅ BUY',          c: '#00ffd0', action: 'LIMIT BUY', confidence: 'MEDIUM' } :
      totalScore >= 5  ? { s: '⚖️ MILD BUY',    c: '#88ff88', action: 'WATCH',     confidence: 'LOW'    } :
      totalScore >= -15? { s: '😐 NEUTRAL',      c: '#FFB300', action: 'WAIT',      confidence: 'LOW'    } :
      totalScore >= -30? { s: '⚠️ MILD SELL',   c: '#ffaa44', action: 'AVOID',     confidence: 'MEDIUM' } :
                         { s: '🔴 SELL PRESSURE',c: '#ff4466', action: 'STAY OUT',  confidence: 'HIGH'   };

    // Best entry and SL from all engines
    // Priority: structural SL > OB wall SL > simple % SL
    const sl = struct?.structuralSL || ob?.trade.sl || +(price * 0.95).toFixed(8);
    const slPct = +((price - sl) / price * 100).toFixed(2);
    const slNote = struct ? `Below daily swing low $${fmtP(struct.structuralSupport)} (structural)` :
                   ob ? `Below bid wall $${fmtP(ob.supportLevel)} (order book)` :
                   'Below 5% from entry';

    // TPs: use resistance levels
    const tp1 = struct?.structuralResist || ob?.trade.tp1 || +(price * 1.03).toFixed(8);
    const tp2 = ob?.trade.tp2 || +(price * 1.06).toFixed(8);
    const tp3 = +(price * 1.10).toFixed(8);
    const slDist = price - sl;

    return {
      totalScore,
      signal,
      reasons: reasons.slice(0, 5),
      warnings: warnings.slice(0, 3),
      trade: {
        entry: +(price * 1.001).toFixed(8),
        sl, slPct, slNote,
        tp1: +tp1.toFixed(8), tp1Pct: +((tp1 - price) / price * 100).toFixed(2),
        tp2: +tp2.toFixed(8), tp2Pct: +((tp2 - price) / price * 100).toFixed(2),
        tp3: +tp3.toFixed(8), tp3Pct: +((tp3 - price) / price * 100).toFixed(2),
        rr1: slDist > 0 ? +((tp1 - price) / slDist).toFixed(1) : '—',
        rr2: slDist > 0 ? +((tp2 - price) / slDist).toFixed(1) : '—',
      },
    };
  }

  // ════════════════════════════════════════════════════════════════
  // MAIN HANDLER
  // ════════════════════════════════════════════════════════════════
  try {
    const t0 = Date.now();

    // Get symbol from query param, or scan top coins
    const sym = (req.query?.symbol || '').toUpperCase() || null;

    // Fetch 24hr ticker first to get price + top volume coins
    // Multi-source ticker fallback (same as scanner-full which always works)
    // ── 5-SOURCE FALLBACK (Binance → Bybit → MEXC → CoinGecko) ──
    const [tickerR, fngR] = await Promise.allSettled([
      (async () => {
        const b1 = await sf('https://api.binance.com/api/v3/ticker/24hr', 7000);
        if (Array.isArray(b1) && b1.length > 100) return b1;
        const b2 = await sf('https://fapi.binance.com/fapi/v1/ticker/24hr', 6000);
        if (Array.isArray(b2) && b2.length > 50) return b2;
        const by = await sf('https://api.bybit.com/v5/market/tickers?category=spot', 6000);
        if (by?.result?.list?.length > 50) {
          return by.result.list.map(t => ({
            symbol: t.symbol || '',
            lastPrice: t.lastPrice || '0',
            priceChangePercent: t.price24hPcnt ? (parseFloat(t.price24hPcnt) * 100).toFixed(4) : '0',
            quoteVolume: t.turnover24h || '0',
            highPrice: t.highPrice24h || t.lastPrice || '0',
            lowPrice: t.lowPrice24h || t.lastPrice || '0',
            openPrice: t.prevPrice24h || t.lastPrice || '0',
          }));
        }
        const mx = await sf('https://api.mexc.com/api/v3/ticker/24hr', 6000);
        if (Array.isArray(mx) && mx.length > 50) return mx;
        const cg = await sf('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=volume_desc&per_page=250&page=1&sparkline=false&price_change_percentage=24h', 9000);
        if (Array.isArray(cg) && cg.length > 0) {
          return cg.map(c => ({
            symbol: (c.symbol || '').toUpperCase() + 'USDT',
            lastPrice: String(c.current_price || 0),
            priceChangePercent: String(c.price_change_percentage_24h || 0),
            quoteVolume: String(c.total_volume || 0),
            highPrice: String((c.current_price || 0) * 1.03),
            lowPrice: String((c.current_price || 0) * 0.97),
            openPrice: String((c.current_price || 0) / (1 + (c.price_change_percentage_24h || 0) / 100)),
          }));
        }
        return [];
      })(),
      sf('https://api.alternative.me/fng/?limit=1&format=json', 4000),
    ]);

    const tickers = tickerR.status === 'fulfilled' && Array.isArray(tickerR.value) ? tickerR.value : [];
    const fg = fngR.status === 'fulfilled' ? parseInt(fngR.value?.data?.[0]?.value || 50) : 50;

    if (!tickers.length) {
      // All sources failed - return empty but friendly response
      return res.status(200).json({
        version: 'v1.0', error: null,
        timestamp: Date.now(), scanTime: '0',
        totalScanned: 0, fg,
        summary: { strongBuy: 0, buy: 0, neutral: 0, sell: 0 },
        results: [], topBuy: [], topSell: [],
        message: 'Data sumber tidak tersedia — coba scan lagi dalam 30 detik',
      });
    }

    const tickerMap = {};
    tickers.forEach(t => { if (t?.symbol) tickerMap[t.symbol] = t; });

    // Determine which symbols to scan
    const targetSymbols = sym
      ? [sym]
      : SCAN_SYMBOLS.filter(s => tickerMap[s + 'USDT']);

    // Limit parallel requests to avoid timeout (max 8 coins deep-scanned)
    const deepScanSymbols = targetSymbols.slice(0, 8);

    // For each symbol: fetch orderbook + aggTrades + daily klines in parallel
    const deepData = await Promise.allSettled(
      deepScanSymbols.map(s =>
        Promise.allSettled([
          sf(`https://api.binance.com/api/v3/depth?symbol=${s}USDT&limit=${ORDERBOOK_LEVELS}`, 4000),
          sf(`https://api.binance.com/api/v3/aggTrades?symbol=${s}USDT&limit=500`, 4000),
          sf(`https://api.binance.com/api/v3/klines?symbol=${s}USDT&interval=1d&limit=60`, 4000),
        ])
      )
    );

    // Process results
    const results = [];

    deepScanSymbols.forEach((sym, i) => {
      const ticker = tickerMap[sym + 'USDT'];
      if (!ticker) return;

      const price  = +(ticker.lastPrice || 0);
      const ch24   = +(ticker.priceChangePercent || 0);
      const vol24  = +(ticker.quoteVolume || 0);

      if (price <= 0) return;

      const symData = deepData[i];
      const [obR, tradesR, klinesR] = symData.status === 'fulfilled'
        ? symData.value
        : [{ status: 'rejected' }, { status: 'rejected' }, { status: 'rejected' }];

      const obRaw     = obR.status === 'fulfilled' ? obR.value : null;
      const tradesRaw = tradesR.status === 'fulfilled' ? tradesR.value : null;
      const klinesRaw = klinesR.status === 'fulfilled' ? klinesR.value : null;

      // Run engines
      const ob     = obRaw?.bids && obRaw?.asks ? analyzeOrderBook(obRaw.bids, obRaw.asks, price) : null;
      const whale  = tradesRaw?.length ? analyzeWhaleTrades(tradesRaw, price) : null;
      const struct = klinesRaw?.length >= 10 ? analyzeStructure(klinesRaw, price) : null;

      // Combine
      const combined = combineSignals(ob, whale, struct, ch24, price);

      results.push({
        symbol: sym,
        price, ch24: +ch24.toFixed(2), vol24,
        volB: +(vol24 / 1e9).toFixed(2),
        // Engine outputs
        orderBook: ob,
        whale: whale ? {
          ...whale,
          whaleTrades: whale.whaleTrades.slice(0, 5), // limit response size
        } : null,
        structure: struct,
        // Combined signal
        signal: combined.signal,
        totalScore: combined.totalScore,
        reasons: combined.reasons,
        warnings: combined.warnings,
        trade: combined.trade,
        dataQuality: [ob ? 'OB' : null, whale ? 'WHALE' : null, struct ? 'STRUCT' : null].filter(Boolean),
      });
    });

    // Sort by signal strength
    results.sort((a, b) => b.totalScore - a.totalScore);

    // Summary stats
    const strongBuy = results.filter(r => r.totalScore >= 50).length;
    const buy       = results.filter(r => r.totalScore >= 25 && r.totalScore < 50).length;
    const sell      = results.filter(r => r.totalScore < -15).length;

    return res.status(200).json({
      version: 'v1.0',
      timestamp: Date.now(),
      scanTime: ((Date.now() - t0) / 1000).toFixed(1),
      fg, fgLabel: fg <= 25 ? 'Extreme Fear' : fg <= 45 ? 'Fear' : fg >= 75 ? 'Greed' : 'Neutral',
      totalScanned: results.length,
      summary: { strongBuy, buy, neutral: results.length - strongBuy - buy - sell, sell },
      results,
      topBuy: results.filter(r => r.totalScore >= 25).slice(0, 3),
      topSell: results.filter(r => r.totalScore < -15).slice(0, 2),
    });

  } catch (e) {
    return res.status(500).json({
      error: e.message, version: 'v1.0',
      results: [], timestamp: Date.now(),
    });
  }
}

function fmtP(p) {
  if (!p || p <= 0) return '—';
  if (p >= 10000) return p.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (p >= 1000)  return p.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (p >= 1)     return p.toFixed(4);
  if (p >= 0.001) return p.toFixed(6);
  return p.toFixed(8);
}
