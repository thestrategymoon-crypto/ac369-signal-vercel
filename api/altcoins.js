// api/altcoins.js — AC369 FUSION Altcoin Momentum v4.0
// REAL RSI (Wilder's method), quality filters, no fake data

// ── COIN LISTS ─────────────────────────────────────────────────────
const STABLES = new Set(['USDT','USDC','BUSD','DAI','TUSD','USDP','FDUSD','USDD','GUSD','FRAX','LUSD','EURC','EUR','GBP','TRY','BRL','AEUR','BIDR','IDRT','BVND']);
const IGNORE  = new Set(['BTCDOMUSDT','DEFIUSDT','BTCSTUSDT','USDCUSDT','USDTEUR','PERPUSDT']);
const BAD_SFX = ['UP','DOWN','BULL','BEAR','LONG','SHORT','3L','3S','5L','5S'];
const MEME_SET= new Set(['DOGE','SHIB','PEPE','FLOKI','BONK','WIF','MEME','NEIRO','POPCAT','MOG','BRETT','TURBO','BOME','MYRO','GIGA','DOGS','HMSTR','BARSIK','AIDOGE','SATS','RATS','ORDS','TROLL','SLERF','SUNDOG','PONKE','MANEKI','MIGGLES','BABYDOGE']);
const SECTORS = {
  // L1
  'BTC':'BTC','ETH':'ETH','BNB':'BNB','SOL':'L1','ADA':'L1','AVAX':'L1',
  'DOT':'L1','NEAR':'L1','APT':'L1','SUI':'L1','SEI':'L1','INJ':'L1',
  'TIA':'L1','ATOM':'IOP','OSMO':'IOP',
  // L2
  'ARB':'L2','OP':'L2','MATIC':'L2','IMX':'L2','STRK':'L2','ZKSYNC':'L2','ZK':'L2',
  // DeFi
  'UNI':'DEF','AAVE':'DEF','CRV':'DEF','MKR':'DEF','COMP':'DEF','LDO':'DEF','PENDLE':'DEF',
  'GMX':'DEF','JUP':'DEF','ORCA':'DEF','RAY':'DEF',
  // AI
  'FET':'AI','AGIX':'AI','OCEAN':'AI','RENDER':'AI','TAO':'AI','WLD':'AI',
  'ARKM':'AI','GRT':'AI','ALT':'AI','MYRIA':'AI',
  // RWA
  'ONDO':'RWA','CFG':'RWA','MPL':'RWA','CPOOL':'RWA',
  // GameFi  
  'GALA':'GME','AXS':'GME','SAND':'GME','MANA':'GME','IMX':'GME',
  // Meme handled by MEME_SET
  // Privacy
  'XMR':'PRV','ZEC':'PRV','DASH':'PRV','SCRT':'PRV',
};

// ── WILDER'S RSI (matches TradingView exactly) ─────────────────────
function calcRSI(closes, period = 14) {
  if (!closes || closes.length < period + 2) return null;
  // Step 1: initial average
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) avgGain += d; else avgLoss += Math.abs(d);
  }
  avgGain /= period;
  avgLoss /= period;
  // Step 2: Wilder's smoothed MA for remaining candles
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const gain = d > 0 ? d : 0;
    const loss = d < 0 ? Math.abs(d) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return +(100 - 100 / (1 + rs)).toFixed(2);
}

// ── PROXY RSI (24h ticker only — limited accuracy) ─────────────────
// Clamped 30-70 to mark as proxy (never extreme values)
function proxyRSI(price, high, low, open, wap, ch24) {
  if (!price || price <= 0 || high <= low) return 50;
  const rp    = (price - low) / (high - low);
  const vsWap = wap > 0 ? (price - wap) / wap * 100 : 0;
  let rsi = rp * 100 + ch24 * 1.2 + vsWap * 1.0;
  return Math.max(30, Math.min(70, Math.round(rsi)));
}

// ── BUILD COIN OBJECT ─────────────────────────────────────────────
function buildCoin(t) {
  const sym  = (t.symbol || '').replace('USDT', '');
  const price= +(t.lastPrice || 0);
  const ch24 = +(t.priceChangePercent || 0);
  const vol  = +(t.quoteVolume || 0);
  const high = +(t.highPrice  || price * 1.01);
  const low  = +(t.lowPrice   || price * 0.99);
  const open = +(t.openPrice  || price);
  const wap  = +(t.weightedAvgPrice || price);

  if (price <= 0 || vol < 100000) return null;

  const range = high > low ? (high - low) / price : 0.01;
  const rp    = high > low ? Math.max(0, Math.min(1, (price - low) / (high - low))) : 0.5;
  const body  = high > low ? Math.abs(price - open) / (high - low) : 0;
  const lw    = high > low ? Math.max(0, Math.min(1, (Math.min(price, open) - low) / (high - low))) : 0;
  const vt    = vol >= 1e9 ? 5 : vol >= 200e6 ? 4 : vol >= 50e6 ? 3 : vol >= 10e6 ? 2 : vol >= 1e6 ? 1 : 0;
  const sector= SECTORS[sym] || (MEME_SET.has(sym) ? 'MME' : null);
  const dp    = Math.max(2, -Math.floor(Math.log10(Math.max(price, 1e-8))) + 3);

  return {
    symbol: sym,
    price:  +price.toFixed(dp),
    ch24:   +ch24.toFixed(2),
    vol:    +vol.toFixed(0),
    high:   +high.toFixed(dp),
    low:    +low.toFixed(dp),
    range:  +(range * 100).toFixed(2),
    rp:     +rp.toFixed(3),
    body:   +body.toFixed(3),
    lw:     +lw.toFixed(3),
    vt, sector,
    rsi:    proxyRSI(price, high, low, open, wap, ch24),
    rsiReal: false,
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=20');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const sf = async (url, ms = 7000) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    try {
      const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
      clearTimeout(timer); if (!r.ok) return null; return await r.json();
    } catch { clearTimeout(timer); return null; }
  };

  try {
    const t0 = Date.now();

    // ── FETCH TICKERS + F&G in parallel ──────────────────────────
    const [tickerR, fngR] = await Promise.allSettled([
      (async () => {
        // Binance Spot ALL tickers (proven working — no ?symbol= filter)
        const b1 = await sf('https://api.binance.com/api/v3/ticker/24hr', 9000);
        if (Array.isArray(b1) && b1.length > 100) return { data: b1, src: 'Binance', count: b1.length };
        // Binance Futures fallback
        const b2 = await sf('https://fapi.binance.com/fapi/v1/ticker/24hr', 7000);
        if (Array.isArray(b2) && b2.length > 50) return { data: b2, src: 'BinanceFut', count: b2.length };
        // Bybit fallback
        const by = await sf('https://api.bybit.com/v5/market/tickers?category=spot', 7000);
        if (by?.result?.list?.length > 50) return {
          data: by.result.list.map(t => ({
            symbol: t.symbol||'', lastPrice: t.lastPrice||'0',
            priceChangePercent: t.price24hPcnt ? +(+t.price24hPcnt*100).toFixed(4) : '0',
            quoteVolume: t.turnover24h||'0',
            highPrice: t.highPrice24h||t.lastPrice||'0',
            lowPrice:  t.lowPrice24h ||t.lastPrice||'0',
            openPrice: t.prevPrice24h||t.lastPrice||'0',
            weightedAvgPrice: t.lastPrice||'0',
          })), src: 'Bybit', count: by.result.list.length,
        };
        // MEXC fallback
        const mx = await sf('https://api.mexc.com/api/v3/ticker/24hr', 6000);
        if (Array.isArray(mx) && mx.length > 50) return { data: mx, src: 'MEXC', count: mx.length };
        return null;
      })(),
      sf('https://api.alternative.me/fng/?limit=1&format=json', 5000),
    ]);

    const raw = tickerR.status === 'fulfilled' ? tickerR.value : null;
    const rawTickers = raw?.data || [];
    const src        = raw?.src  || 'unknown';
    const fg = fngR.status === 'fulfilled' ? parseInt(fngR.value?.data?.[0]?.value||50) : 50;

    if (!rawTickers.length) {
      return res.status(200).json({
        timestamp: Date.now(), src: 'unavailable', fg,
        gainers:[], losers:[], rsiList:[], volBreakouts:[],
        topGainers:[], topLosers:[], rsiExtremes:[], volumeBreakouts:[],
        market: { signal:'UNKNOWN', avg24h:0, total:0, pos:0, neg:0, bigMove:0, totalVol:0 },
        realRSICount: 0,
      });
    }

    // ── FILTER & BUILD ─────────────────────────────────────────────
    const all = rawTickers
      .filter(t => {
        if (!t?.symbol?.endsWith('USDT')) return false;
        if (IGNORE.has(t.symbol)) return false;
        const base = t.symbol.replace('USDT','');
        if (STABLES.has(base)) return false;
        if (BAD_SFX.some(p => base.endsWith(p)||base.startsWith(p))) return false;
        if (base.length > 12) return false;
        const p = +(t.lastPrice||0), v = +(t.quoteVolume||0);
        if (p <= 0 || v < 100000) return false;
        // Filter stable-like coins
        if (p >= 0.97 && p <= 1.03 && Math.abs(+(t.priceChangePercent||0)) < 0.5) return false;
        return true;
      })
      .map(t => buildCoin(t))
      .filter(Boolean);

    // ── REAL RSI: fetch klines for top 30 by volume ────────────────
    // Get top 30 coins by volume for real RSI computation
    const topSyms = all
      .filter(c => c.vol >= 5e6)
      .sort((a,b) => b.vol - a.vol)
      .slice(0, 30)
      .map(c => c.symbol + 'USDT');

    // Fetch in batches of 10 to avoid overwhelming
    let realRSICount = 0;
    for (let batch = 0; batch < topSyms.length; batch += 10) {
      const batchSyms = topSyms.slice(batch, batch + 10);
      const batchResults = await Promise.allSettled(
        batchSyms.map(sym =>
          sf(`https://api.binance.com/api/v3/klines?symbol=${sym}&interval=4h&limit=30`, 5500)
            .then(d => Array.isArray(d) && d.length >= 15 ? d :
              sf(`https://api.binance.com/api/v3/klines?symbol=${sym}&interval=1h&limit=60`, 4500)
                .then(d2 => Array.isArray(d2) && d2.length >= 15 ? d2 : null)
            )
        )
      );
      batchResults.forEach((r, i) => {
        if (r.status !== 'fulfilled' || !Array.isArray(r.value)) return;
        const closes = r.value.map(k => +k[4]).filter(v => v > 0);
        if (closes.length < 15) return;
        const rsi = calcRSI(closes, 14);
        if (rsi === null) return;
        const base = batchSyms[i].replace('USDT','');
        const coin = all.find(c => c.symbol === base);
        if (coin) { coin.rsi = rsi; coin.rsiReal = true; realRSICount++; }
      });
    }

    // ── MARKET SUMMARY ─────────────────────────────────────────────
    const pos    = all.filter(c => c.ch24 > 0).length;
    const neg    = all.filter(c => c.ch24 < 0).length;
    const avg24h = all.length ? +(all.reduce((s,c) => s+c.ch24, 0)/all.length).toFixed(2) : 0;
    const bigMove= all.filter(c => Math.abs(c.ch24) > 10).length;
    const totalV = all.reduce((s,c) => s+c.vol, 0);
    const signal = avg24h > 3 ? 'BULLISH' : avg24h < -3 ? 'BEARISH' : avg24h > 1 ? 'MILD BULL' : avg24h < -1 ? 'MILD BEAR' : 'NEUTRAL';

    // ── TOP GAINERS ─────────────────────────────────────────────────
    // Require REAL movement: min 1% AND min $500K volume
    const gainers = all
      .filter(c => c.ch24 >= 1.0 && c.vol >= 500000)
      .sort((a,b) => {
        // Quality score: ch24 × log(vol) × body strength
        const qa = a.ch24 * Math.log10(a.vol) * (0.5 + a.body);
        const qb = b.ch24 * Math.log10(b.vol) * (0.5 + b.body);
        return qb - qa;
      });

    // ── TOP LOSERS ──────────────────────────────────────────────────
    const losers = all
      .filter(c => c.ch24 <= -1.0 && c.vol >= 500000)
      .sort((a,b) => {
        const qa = Math.abs(a.ch24) * Math.log10(a.vol);
        const qb = Math.abs(b.ch24) * Math.log10(b.vol);
        return qb - qa;
      });

    // ── RSI LIST ────────────────────────────────────────────────────
    // ONLY real RSI coins for RSI EKSTREM section
    const rsiList = all
      .filter(c => c.rsiReal && c.vol >= 1e6)
      .sort((a,b) => a.rsi - b.rsi); // ascending: oversold first

    // ── VOLUME BREAKOUTS ────────────────────────────────────────────
    // Require minimum $10M volume for quality
    const volBreakouts = all
      .filter(c => c.vol >= 10e6)
      .map(c => {
        let sc = 0;
        let type = 'ACTIVE';
        // Scoring logic
        if (c.vt >= 4 && Math.abs(c.ch24) < 1.5) { sc = 85; type = 'STEALTH'; }
        else if (c.vt >= 3 && c.ch24 > 5 && c.body > 0.5) { sc = 90; type = 'BREAKOUT'; }
        else if (c.vt >= 3 && c.ch24 > 2) { sc = 70; type = 'VOL BULL'; }
        else if (c.vt >= 3 && c.ch24 < -5) { sc = 75; type = 'VOL BEAR'; }
        else if (c.vt >= 3 && c.ch24 < -2) { sc = 60; type = 'VOL BEAR'; }
        else if (Math.abs(c.ch24) > 15 && c.vt <= 1) { sc = 30; type = 'FAKE PUMP'; }
        else { sc = c.vt * 12 + Math.abs(c.ch24) * 2; type = c.ch24 > 0 ? 'VOL BULL' : 'VOL BEAR'; }
        return { ...c, bScore: Math.min(100, Math.round(sc)), bType: type };
      })
      .sort((a,b) => b.vol - a.vol); // sort by volume descending (most liquid first)

    return res.status(200).json({
      timestamp: Date.now(),
      scanTime: ((Date.now()-t0)/1000).toFixed(1),
      src, fg, realRSICount,
      market: { signal, avg24h, pos, neg, bigMove, total: all.length, totalVol: +totalV.toFixed(0) },
      gainers,   // ch24 >= 1% only
      losers,    // ch24 <= -1% only
      rsiList,   // ONLY real RSI coins
      volBreakouts,  // vol >= 10M only
      // Legacy
      topGainers: gainers.slice(0,30),
      topLosers:  losers.slice(0,20),
      rsiExtremes: rsiList,
      volumeBreakouts: volBreakouts.slice(0,25),
    });

  } catch(e) {
    return res.status(200).json({
      timestamp: Date.now(), src: 'error', error: e.message, fg: 50,
      gainers:[], losers:[], rsiList:[], volBreakouts:[],
      topGainers:[], topLosers:[], rsiExtremes:[], volumeBreakouts:[],
      market: { signal:'UNKNOWN', avg24h:0, total:0, pos:0, neg:0, bigMove:0, totalVol:0 },
      realRSICount: 0,
    });
  }
}
