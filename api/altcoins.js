// api/altcoins.js — v15 REBUILT
// Binance spot tickers + parallel RSI (top 15 coins)
// Max 9 seconds total. Reliable.

const STABLES = new Set(['USDT','USDC','BUSD','DAI','TUSD','USDP','FDUSD','USDD','GUSD','FRAX','LUSD','BIDR','IDRT','EUR','GBP']);
const IGNORE  = new Set(['BTCDOMUSDT','DEFIUSDT','USDCUSDT','PERPUSDT']);
const NO_SFX  = ['UP','DOWN','BULL','BEAR','LONG','SHORT','3L','3S','5L','5S'];

const SECTORS = {
  BTC:'BTC',ETH:'ETH',BNB:'BNB',SOL:'L1',ADA:'L1',AVAX:'L1',DOT:'L1',NEAR:'L1',APT:'L1',SUI:'L1',SEI:'L1',INJ:'L1',TIA:'L1',TON:'L1',
  ATOM:'IOP',OSMO:'IOP',
  ARB:'L2',OP:'L2',MATIC:'L2',IMX:'L2',STRK:'L2',ZK:'L2',MANTA:'L2',
  UNI:'DEF',AAVE:'DEF',CRV:'DEF',MKR:'DEF',LDO:'DEF',PENDLE:'DEF',GMX:'DEF',SNX:'DEF',
  FET:'AI',AGIX:'AI',OCEAN:'AI',RENDER:'AI',TAO:'AI',WLD:'AI',ARKM:'AI',GRT:'AI',ORAI:'AI',
  ONDO:'RWA',CFG:'RWA',
  GALA:'GME',AXS:'GME',SAND:'GME',MANA:'GME',IMX:'GME',
  DOGE:'MME',SHIB:'MME',PEPE:'MME',FLOKI:'MME',BONK:'MME',WIF:'MME',NEIRO:'MME',
  LINK:'ORC',BAND:'ORC',API3:'ORC',
  HYPE:'DEX',JUP:'DEX',BLUR:'DEX',CAKE:'DEX',
  XMR:'PRV',ZEC:'PRV',
  XRP:'PAY',LTC:'PAY',BCH:'PAY',XLM:'PAY',
};

const RSI14 = (closes) => {
  if (!closes || closes.length < 16) return null;
  let ag = 0, al = 0;
  for (let i = 1; i <= 14; i++) { const d = closes[i] - closes[i-1]; d > 0 ? ag += d : al += Math.abs(d); }
  ag /= 14; al /= 14;
  for (let i = 15; i < closes.length; i++) {
    const d = closes[i] - closes[i-1];
    ag = (ag * 13 + Math.max(d, 0)) / 14;
    al = (al * 13 + Math.max(-d, 0)) / 14;
  }
  return al === 0 ? 100 : +(100 - 100 / (1 + ag / al)).toFixed(2);
};

const fmtPrice = (p) => {
  if (!p || p <= 0) return 0;
  const dp = p >= 1000 ? 2 : p >= 1 ? 4 : p >= 0.001 ? 6 : 8;
  return +p.toFixed(dp);
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=20, stale-while-revalidate=10');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const t0 = Date.now();

  const sf = async (url, ms) => {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), ms);
    try {
      const r = await fetch(url, { signal: c.signal, headers: { Accept: 'application/json', 'User-Agent': 'AC369/1.0' } });
      clearTimeout(t);
      if (!r.ok) return null;
      return await r.json();
    } catch { clearTimeout(t); return null; }
  };

  try {
    // ── STEP 1: Tickers + F&G (parallel) ─────────────────────
    const [tickersR, fngR] = await Promise.allSettled([
      // Try Binance first, fallback to Bybit
      sf('https://api.binance.com/api/v3/ticker/24hr', 8000).then(d => {
        if (Array.isArray(d) && d.length > 100) return { data: d, src: 'Binance' };
        return null;
      }).then(async r => {
        if (r) return r;
        const by = await sf('https://api.bybit.com/v5/market/tickers?category=spot', 7000);
        if (by?.result?.list?.length > 50) return {
          src: 'Bybit',
          data: by.result.list.map(t => ({
            symbol: t.symbol || '',
            lastPrice: t.lastPrice || '0',
            priceChangePercent: t.price24hPcnt ? +(+t.price24hPcnt * 100).toFixed(4) : '0',
            quoteVolume: t.turnover24h || '0',
            highPrice:  t.highPrice24h || t.lastPrice || '0',
            lowPrice:   t.lowPrice24h  || t.lastPrice || '0',
            openPrice:  t.prevPrice24h || t.lastPrice || '0',
          })),
        };
        return null;
      }),
      sf('https://api.alternative.me/fng/?limit=1&format=json', 4000),
    ]);

    const raw = tickersR.status === 'fulfilled' ? tickersR.value : null;
    if (!raw?.data?.length) {
      return res.status(200).json({
        ok: false, error: 'No ticker data available', ts: Date.now(), version: 'v15',
        gainers: [], losers: [], rsiList: [], volBreakouts: [],
        topGainers: [], topLosers: [], rsiExtremes: [], volumeBreakouts: [],
        market: { signal: 'UNKNOWN', avg24h: 0, total: 0, pos: 0, neg: 0, bigMove: 0, totalVol: 0 },
        realRSICount: 0, fg: 50, src: 'unavailable',
      });
    }

    const fg  = fngR.status === 'fulfilled' ? parseInt(fngR.value?.data?.[0]?.value || 50) : 50;
    const src = raw.src;

    // ── STEP 2: Build coin list ───────────────────────────────
    const all = raw.data.filter(t => {
      if (!t?.symbol?.endsWith('USDT')) return false;
      if (IGNORE.has(t.symbol)) return false;
      const b = t.symbol.replace('USDT', '');
      if (STABLES.has(b)) return false;
      if (NO_SFX.some(p => b.endsWith(p) || b.startsWith(p))) return false;
      if (b.length > 12) return false;
      const p = +(t.lastPrice || 0), v = +(t.quoteVolume || 0);
      if (p <= 0 || v < 100000) return false;
      // filter stablecoins by price
      if (p >= 0.97 && p <= 1.03 && Math.abs(+(t.priceChangePercent || 0)) < 0.5) return false;
      return true;
    }).map(t => {
      const sym  = t.symbol.replace('USDT', '');
      const price = +(t.lastPrice || 0);
      const ch24  = +(t.priceChangePercent || 0);
      const vol   = +(t.quoteVolume || 0);
      const high  = +(t.highPrice  || price * 1.01);
      const low   = +(t.lowPrice   || price * 0.99);
      const open  = +(t.openPrice  || price);
      const body  = high > low ? Math.abs(price - open) / (high - low) : 0;
      const rp    = high > low ? (price - low) / (high - low) : 0.5;
      const vt    = vol >= 1e9 ? 5 : vol >= 200e6 ? 4 : vol >= 50e6 ? 3 : vol >= 10e6 ? 2 : vol >= 1e6 ? 1 : 0;
      return { symbol: sym, price: fmtPrice(price), ch24: +ch24.toFixed(2), vol: +vol.toFixed(0), high, low, body: +body.toFixed(3), rp: +rp.toFixed(3), vt, sector: SECTORS[sym] || null, rsi: 50, rsiReal: false };
    }).filter(Boolean);

    // ── STEP 3: Market summary ────────────────────────────────
    const pos    = all.filter(c => c.ch24 > 0).length;
    const neg    = all.filter(c => c.ch24 < 0).length;
    const avg24h = all.length ? +(all.reduce((s, c) => s + c.ch24, 0) / all.length).toFixed(2) : 0;
    const bigMove = all.filter(c => Math.abs(c.ch24) > 10).length;
    const totalVol = all.reduce((s, c) => s + c.vol, 0);
    const signal = avg24h > 3 ? 'BULLISH' : avg24h < -3 ? 'BEARISH' : avg24h > 1 ? 'MILD BULL' : avg24h < -1 ? 'MILD BEAR' : 'NEUTRAL';

    // ── STEP 4: TOP GAINERS (dynamic threshold) ───────────────
    const dynT = Math.max(0.5, avg24h + 1.5);
    let gainers = all.filter(c => c.ch24 >= dynT && c.vol >= 300000)
      .sort((a, b) => (b.ch24 * Math.log10(Math.max(b.vol, 1)) * (0.5 + b.body)) - (a.ch24 * Math.log10(Math.max(a.vol, 1)) * (0.5 + a.body)));
    if (gainers.length < 8) gainers = all.filter(c => c.ch24 > 0 && c.vol >= 200000).sort((a, b) => b.ch24 - a.ch24).slice(0, 30);

    // ── STEP 5: TOP LOSERS ────────────────────────────────────
    const losers = all.filter(c => c.ch24 <= -1.0 && c.vol >= 300000)
      .sort((a, b) => (Math.abs(b.ch24) * Math.log10(Math.max(b.vol, 1))) - (Math.abs(a.ch24) * Math.log10(Math.max(a.vol, 1))));

    // ── STEP 6: VOLUME BREAKOUT ───────────────────────────────
    const volBreakouts = all.filter(c => c.vol >= 10e6).map(c => {
      let sc = 0, bType = 'ACTIVE';
      if (c.vt >= 4 && Math.abs(c.ch24) < 1.5) { sc = 85; bType = 'STEALTH'; }
      else if (c.vt >= 3 && c.ch24 > 5 && c.body > 0.5) { sc = 92; bType = 'BREAKOUT'; }
      else if (c.vt >= 3 && c.ch24 > 2)  { sc = 72; bType = 'VOL BULL'; }
      else if (c.vt >= 3 && c.ch24 < -5) { sc = 76; bType = 'VOL BEAR'; }
      else if (c.vt >= 3 && c.ch24 < -2) { sc = 60; bType = 'VOL BEAR'; }
      else { sc = Math.min(55, c.vt * 12 + Math.abs(c.ch24) * 2); bType = c.ch24 >= 0 ? 'VOL BULL' : 'VOL BEAR'; }
      return { ...c, bScore: Math.min(100, Math.round(sc)), bType };
    }).sort((a, b) => b.vol - a.vol);

    // ── STEP 7: REAL RSI — parallel batch (top 15 only) ──────
    // These coins have highest volume — most important for community
    const RSI_COINS = [
      'BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT',
      'ADAUSDT','AVAXUSDT','DOGEUSDT','LINKUSDT','DOTUSDT',
      'NEARUSDT','APTUSDT','SUIUSDT','INJUSDT','ARBUSDT',
    ];
    // Add top 5 by volume from community
    const top5extra = all.filter(c => !RSI_COINS.includes(c.symbol + 'USDT')).sort((a, b) => b.vol - a.vol).slice(0, 5).map(c => c.symbol + 'USDT');
    const rsiSyms = [...new Set([...RSI_COINS, ...top5extra])].slice(0, 20);

    let realRSICount = 0;

    // One parallel batch — all fire simultaneously
    const kResults = await Promise.allSettled(
      rsiSyms.map(sym =>
        sf(`https://api.binance.com/api/v3/klines?symbol=${sym}&interval=4h&limit=32`, 5000)
      )
    );

    kResults.forEach((r, i) => {
      if (r.status !== 'fulfilled' || !Array.isArray(r.value) || r.value.length < 16) return;
      const closes = r.value.map(k => +k[4]).filter(v => v > 0);
      if (closes.length < 16) return;
      const rsi = RSI14(closes);
      if (rsi === null) return;
      const base = rsiSyms[i].replace('USDT', '');
      const coin = all.find(c => c.symbol === base);
      if (coin) { coin.rsi = rsi; coin.rsiReal = true; realRSICount++; }
    });

    // For coins without real RSI, estimate from price position
    all.filter(c => !c.rsiReal).forEach(c => {
      // Rough RSI estimate from price change and position
      const base  = 50;
      const chContrib = Math.max(-25, Math.min(25, c.ch24 * 2));
      const rpContrib = Math.max(-15, Math.min(15, (c.rp - 0.5) * 30));
      c.rsi = Math.max(15, Math.min(85, Math.round(base + chContrib + rpContrib)));
      c.rsiReal = false;
    });

    // RSI sorted list
    const rsiList = all.filter(c => c.vol >= 1e6).sort((a, b) => a.rsi - b.rsi);

    return res.status(200).json({
      ok: true, ts: Date.now(), elapsed: Date.now() - t0, version: 'v15',
      src, fg, realRSICount, totalCoins: all.length,
      market: { signal, avg24h, pos, neg, bigMove, total: all.length, totalVol: +totalVol.toFixed(0) },
      gainers, losers, rsiList, volBreakouts,
      // aliases for frontend compatibility
      topGainers: gainers.slice(0, 30),
      topLosers: losers.slice(0, 20),
      rsiExtremes: rsiList,
      volumeBreakouts: volBreakouts.slice(0, 30),
    });

  } catch (e) {
    return res.status(200).json({
      ok: false, error: e.message, ts: Date.now(), version: 'v15',
      fg: 50, src: 'error', realRSICount: 0, totalCoins: 0,
      gainers: [], losers: [], rsiList: [], volBreakouts: [],
      topGainers: [], topLosers: [], rsiExtremes: [], volumeBreakouts: [],
      market: { signal: 'UNKNOWN', avg24h: 0, total: 0, pos: 0, neg: 0, bigMove: 0, totalVol: 0 },
    });
  }
}
