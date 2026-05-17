// api/altcoins.js — AC369 FUSION v13 REBUILT
// Fix: RSI parallel batch (no timeout), dynamic gainers, real volume data

const STABLES = new Set(['USDT','USDC','BUSD','DAI','TUSD','USDP','FDUSD','USDD','GUSD','FRAX','LUSD','EURC','EUR','GBP','TRY','BRL','AEUR','BIDR','IDRT','BVND']);
const IGNORE  = new Set(['BTCDOMUSDT','DEFIUSDT','BTCSTUSDT','USDCUSDT','USDTEUR','PERPUSDT']);
const BAD_SFX = ['UP','DOWN','BULL','BEAR','LONG','SHORT','3L','3S','5L','5S'];
const SECTORS = {
  'BTC':'BTC','ETH':'ETH','BNB':'BNB','SOL':'L1','ADA':'L1','AVAX':'L1',
  'DOT':'L1','NEAR':'L1','APT':'L1','SUI':'L1','SEI':'L1','INJ':'L1','TIA':'L1',
  'ATOM':'IOP','OSMO':'IOP',
  'ARB':'L2','OP':'L2','MATIC':'L2','IMX':'L2','STRK':'L2','ZK':'L2',
  'UNI':'DEF','AAVE':'DEF','CRV':'DEF','MKR':'DEF','LDO':'DEF','PENDLE':'DEF','GMX':'DEF',
  'FET':'AI','AGIX':'AI','OCEAN':'AI','RENDER':'AI','TAO':'AI','WLD':'AI','ARKM':'AI','GRT':'AI',
  'ONDO':'RWA','CFG':'RWA',
  'GALA':'GME','AXS':'GME','SAND':'GME','MANA':'GME',
  'DOGE':'MME','SHIB':'MME','PEPE':'MME','FLOKI':'MME','BONK':'MME','WIF':'MME',
  'LINK':'ORC','BAND':'ORC',
  'HYPE':'DEX','JUP':'DEX','BLUR':'DEX',
  'XMR':'PRV','ZEC':'PRV',
};

function calcRSI(closes, period = 14) {
  if (!closes || closes.length < period + 2) return null;
  let ag = 0, al = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) ag += d; else al += Math.abs(d);
  }
  ag /= period; al /= period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    ag = (ag * (period - 1) + (d > 0 ? d : 0)) / period;
    al = (al * (period - 1) + (d < 0 ? Math.abs(d) : 0)) / period;
  }
  if (al === 0) return 100;
  return +(100 - 100 / (1 + ag / al)).toFixed(2);
}

function buildCoin(t) {
  const sym   = (t.symbol || '').replace('USDT', '');
  const price = +(t.lastPrice || 0);
  const ch24  = +(t.priceChangePercent || 0);
  const vol   = +(t.quoteVolume || 0);
  const high  = +(t.highPrice  || price * 1.01);
  const low   = +(t.lowPrice   || price * 0.99);
  const open  = +(t.openPrice  || price);
  if (price <= 0 || vol < 100000) return null;
  const range = high > low ? (high - low) / price : 0.01;
  const rp    = high > low ? Math.max(0, Math.min(1, (price - low) / (high - low))) : 0.5;
  const body  = high > low ? Math.abs(price - open) / (high - low) : 0;
  const lw    = high > low ? Math.max(0, Math.min(1, (Math.min(price, open) - low) / (high - low))) : 0;
  const vt    = vol >= 1e9 ? 5 : vol >= 200e6 ? 4 : vol >= 50e6 ? 3 : vol >= 10e6 ? 2 : vol >= 1e6 ? 1 : 0;
  const dp    = Math.max(2, -Math.floor(Math.log10(Math.max(price, 1e-8))) + 3);
  return {
    symbol: sym, price: +price.toFixed(dp), ch24: +ch24.toFixed(2),
    vol: +vol.toFixed(0), high: +high.toFixed(dp), low: +low.toFixed(dp),
    range: +(range * 100).toFixed(2), rp: +rp.toFixed(3), body: +body.toFixed(3),
    lw: +lw.toFixed(3), vt, sector: SECTORS[sym] || null,
    rsi: 50, rsiReal: false,
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=20');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const sf = async (url, ms = 7000) => {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), ms);
    try {
      const r = await fetch(url, { signal: c.signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
      clearTimeout(t); if (!r.ok) return null; return await r.json();
    } catch { clearTimeout(t); return null; }
  };

  try {
    const t0 = Date.now();

    // ── STEP 1: Tickers + F&G ────────────────────────────────
    const [tickerR, fngR] = await Promise.allSettled([
      (async () => {
        const b = await sf('https://api.binance.com/api/v3/ticker/24hr', 9000);
        if (Array.isArray(b) && b.length > 100) return { data: b, src: 'Binance' };
        const by = await sf('https://api.bybit.com/v5/market/tickers?category=spot', 7000);
        if (by?.result?.list?.length > 50) return {
          data: by.result.list.map(t => ({
            symbol: t.symbol || '',
            lastPrice: t.lastPrice || '0',
            priceChangePercent: t.price24hPcnt ? +(+t.price24hPcnt * 100).toFixed(4) : '0',
            quoteVolume: t.turnover24h || '0',
            highPrice:  t.highPrice24h || t.lastPrice || '0',
            lowPrice:   t.lowPrice24h  || t.lastPrice || '0',
            openPrice:  t.prevPrice24h || t.lastPrice || '0',
          })), src: 'Bybit',
        };
        const mx = await sf('https://api.mexc.com/api/v3/ticker/24hr', 6000);
        if (Array.isArray(mx) && mx.length > 50) return { data: mx, src: 'MEXC' };
        return null;
      })(),
      sf('https://api.alternative.me/fng/?limit=1&format=json', 5000),
    ]);

    const raw        = tickerR.status === 'fulfilled' ? tickerR.value : null;
    const rawTickers = raw?.data || [];
    const src        = raw?.src  || 'unknown';
    const fg = fngR.status === 'fulfilled' ? parseInt(fngR.value?.data?.[0]?.value || 50) : 50;

    if (!rawTickers.length) {
      return res.status(200).json({
        timestamp: Date.now(), src: 'unavailable', fg, version: 'v13',
        gainers: [], losers: [], rsiList: [], volBreakouts: [],
        topGainers: [], topLosers: [], rsiExtremes: [], volumeBreakouts: [],
        market: { signal: 'UNKNOWN', avg24h: 0, total: 0, pos: 0, neg: 0, bigMove: 0, totalVol: 0 },
        realRSICount: 0,
      });
    }

    // ── STEP 2: Filter & Build ────────────────────────────────
    const all = rawTickers
      .filter(t => {
        if (!t?.symbol?.endsWith('USDT')) return false;
        if (IGNORE.has(t.symbol)) return false;
        const base = t.symbol.replace('USDT', '');
        if (STABLES.has(base)) return false;
        if (BAD_SFX.some(p => base.endsWith(p) || base.startsWith(p))) return false;
        if (base.length > 12) return false;
        const p = +(t.lastPrice || 0), v = +(t.quoteVolume || 0);
        if (p <= 0 || v < 100000) return false;
        if (p >= 0.97 && p <= 1.03 && Math.abs(+(t.priceChangePercent || 0)) < 0.5) return false;
        return true;
      })
      .map(buildCoin)
      .filter(Boolean);

    // ── STEP 3: Market Summary ────────────────────────────────
    const pos     = all.filter(c => c.ch24 > 0).length;
    const neg     = all.filter(c => c.ch24 < 0).length;
    const avg24h  = all.length ? +(all.reduce((s, c) => s + c.ch24, 0) / all.length).toFixed(2) : 0;
    const bigMove = all.filter(c => Math.abs(c.ch24) > 10).length;
    const totalV  = all.reduce((s, c) => s + c.vol, 0);
    const signal  = avg24h > 3 ? 'BULLISH' : avg24h < -3 ? 'BEARISH' : avg24h > 1 ? 'MILD BULL' : avg24h < -1 ? 'MILD BEAR' : 'NEUTRAL';

    // ── STEP 4: Top Gainers (dynamic threshold) ───────────────
    const dynThreshold = Math.max(0.5, avg24h + 1.5);
    let gainers = all
      .filter(c => c.ch24 >= dynThreshold && c.vol >= 300000)
      .sort((a, b) => (b.ch24 * Math.log10(Math.max(b.vol, 1)) * (0.5 + b.body)) - (a.ch24 * Math.log10(Math.max(a.vol, 1)) * (0.5 + a.body)));
    if (gainers.length < 8) {
      gainers = all.filter(c => c.ch24 > 0 && c.vol >= 200000).sort((a, b) => b.ch24 - a.ch24).slice(0, 30);
    }

    // ── STEP 5: Top Losers ────────────────────────────────────
    const losers = all
      .filter(c => c.ch24 <= -1.0 && c.vol >= 300000)
      .sort((a, b) => (Math.abs(b.ch24) * Math.log10(Math.max(b.vol, 1))) - (Math.abs(a.ch24) * Math.log10(Math.max(a.vol, 1))));

    // ── STEP 6: Volume Breakout ───────────────────────────────
    const volBreakouts = all
      .filter(c => c.vol >= 10e6)
      .map(c => {
        let sc = 0, type = 'ACTIVE';
        if (c.vt >= 4 && Math.abs(c.ch24) < 1.5) { sc = 85; type = 'STEALTH'; }
        else if (c.vt >= 3 && c.ch24 > 5 && c.body > 0.5) { sc = 90; type = 'BREAKOUT'; }
        else if (c.vt >= 3 && c.ch24 > 2)  { sc = 70; type = 'VOL BULL'; }
        else if (c.vt >= 3 && c.ch24 < -5) { sc = 75; type = 'VOL BEAR'; }
        else if (c.vt >= 3 && c.ch24 < -2) { sc = 60; type = 'VOL BEAR'; }
        else { sc = c.vt * 12 + Math.abs(c.ch24) * 2; type = c.ch24 > 0 ? 'VOL BULL' : 'VOL BEAR'; }
        return { ...c, bScore: Math.min(100, Math.round(sc)), bType: type };
      })
      .sort((a, b) => b.vol - a.vol);

    // ── STEP 7: Real RSI — ONE parallel batch ─────────────────
    const MAJOR = [
      'BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT',
      'ADAUSDT','AVAXUSDT','DOGEUSDT','LINKUSDT','DOTUSDT',
      'MATICUSDT','NEARUSDT','APTUSDT','INJUSDT','ARBUSDT',
      'OPUSDT','SUIUSDT','TIAUSDT','FETUSDT','HYPEDUSDT',
    ];
    const top10 = all
      .filter(c => !MAJOR.includes(c.symbol + 'USDT'))
      .sort((a, b) => b.vol - a.vol)
      .slice(0, 10)
      .map(c => c.symbol + 'USDT');
    const rsiSyms = [...new Set([...MAJOR, ...top10])];

    let realRSICount = 0;
    const klineResults = await Promise.allSettled(
      rsiSyms.map(sym =>
        sf(`https://api.binance.com/api/v3/klines?symbol=${sym}&interval=4h&limit=32`, 5500)
          .then(d => Array.isArray(d) && d.length >= 16 ? d
            : sf(`https://api.binance.com/api/v3/klines?symbol=${sym}&interval=1h&limit=64`, 4500))
      )
    );
    klineResults.forEach((r, i) => {
      if (r.status !== 'fulfilled' || !Array.isArray(r.value) || r.value.length < 15) return;
      const closes = r.value.map(k => +k[4]).filter(v => v > 0);
      if (closes.length < 15) return;
      const rsi = calcRSI(closes, 14);
      if (rsi === null) return;
      const base = rsiSyms[i].replace('USDT', '');
      const coin = all.find(c => c.symbol === base);
      if (coin) { coin.rsi = rsi; coin.rsiReal = true; realRSICount++; }
    });

    const rsiList = all.filter(c => c.rsiReal && c.vol >= 1e6).sort((a, b) => a.rsi - b.rsi);

    return res.status(200).json({
      timestamp: Date.now(), scanTime: ((Date.now() - t0) / 1000).toFixed(1),
      src, fg, realRSICount, version: 'v13',
      market: { signal, avg24h, pos, neg, bigMove, total: all.length, totalVol: +totalV.toFixed(0) },
      gainers, losers, rsiList, volBreakouts,
      topGainers: gainers.slice(0, 30), topLosers: losers.slice(0, 20),
      rsiExtremes: rsiList, volumeBreakouts: volBreakouts.slice(0, 30),
    });

  } catch (e) {
    return res.status(200).json({
      timestamp: Date.now(), src: 'error', error: e.message, fg: 50, version: 'v13',
      gainers: [], losers: [], rsiList: [], volBreakouts: [],
      topGainers: [], topLosers: [], rsiExtremes: [], volumeBreakouts: [],
      market: { signal: 'UNKNOWN', avg24h: 0, total: 0, pos: 0, neg: 0, bigMove: 0, totalVol: 0 },
      realRSICount: 0,
    });
  }
}
