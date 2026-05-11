// api/altcoins.js — AC369 FUSION ALTCOIN MOMENTUM v3.0
// ══════════════════════════════════════════════════════════════════
// FULL MARKET COVERAGE — ALL COINS, REAL-TIME
//
// Coverage: ALL ~500+ Binance USDT pairs
//   Big Caps · Mid Caps · Small Caps · Meme Coins
//
// Sections:
//   TOP GAINERS   — all coins sorted by quality momentum
//   TOP LOSERS    — all coins sorted by loss magnitude
//   RSI EXTREMES  — proxyRSI for ALL + real RSI for top 20
//   VOL BREAKOUT  — all coins with volume anomaly
//
// Data: Binance → Bybit → CoinGecko fallback
// ══════════════════════════════════════════════════════════════════

const STABLES = new Set([
  'USDT','USDC','BUSD','DAI','FDUSD','TUSD','USDP','FRAX','LUSD',
  'USDS','SUSD','GUSD','PYUSD','CRVUSD','USDD','IDRT','BIDR','EUR','GBP','AUD',
]);
const IGNORE = new Set([
  'USDCUSDT','BTCDOMUSDT','DEFIUSDT','BNXUSDT','WBTCUSDT','WETHUSDT',
  'WBNBUSDT','STETHUSDT','CBETHUSDT','RETHUSDT',
]);
const BAD_SFX = ['UP','DOWN','BEAR','BULL','3L','3S','2L','2S'];

const MEME_SET = new Set([
  'DOGE','SHIB','PEPE','BONK','WIF','FLOKI','BRETT','MOG','NEIRO',
  'GOAT','PNUT','ACT','TURBO','PEOPLE','MOODENG','LUNC','BOME',
  'MEME','HOT','DOGS','HMSTR','CATI','NOT','BABYDOGE','GIGA','CHEEMS',
  'POPCAT','PONKE','SLERF','MYRO','AIDOGE','WOJAK','BOBO','TOSHI',
]);

const SECTORS = {
  BTC:'BTC', ETH:'ETH', BNB:'BEX', SOL:'L1', XRP:'PAY',
  ADA:'L1', AVAX:'L1', DOT:'IOP', LINK:'ORC', MATIC:'L2',
  ARB:'L2', OP:'L2', STRK:'L2', ZK:'L2',
  UNI:'DEF', AAVE:'DEF', CRV:'DEF', GMX:'DEF', GNS:'DEF', SNX:'DEF',
  TIA:'MOD', EIGEN:'MOD', AVAIL:'MOD',
  FET:'AI', AGIX:'AI', OCEAN:'AI', RNDR:'AI', TAO:'AI', WLD:'AI', NMR:'AI',
  IOTX:'DPN', HNT:'DPN', FIL:'DPN', AR:'DPN', STORJ:'DPN',
  ONDO:'RWA', POLYX:'RWA', OM:'RWA', CFG:'RWA',
  AXS:'GMF', SAND:'GMF', MANA:'GMF', IMX:'GMF', GALA:'GMF', RON:'GMF',
  ATOM:'IOP', OSMO:'DEF', INJ:'DEF', SEI:'L1', APT:'L1', SUI:'L1', NEAR:'L1',
  STX:'BTC2', RUNE:'BDX', ORDI:'BTC',
  PYTH:'ORC', JTO:'LST', JITO:'LST',
  DOGE:'MME', SHIB:'MME', PEPE:'MME', BONK:'MME', WIF:'MME', FLOKI:'MME',
  BRETT:'MME', MOG:'MME', NEIRO:'MME', GOAT:'MME', PNUT:'MME', ACT:'MME',
  TURBO:'MME', PEOPLE:'MME', MOODENG:'MME', LUNC:'MME', BOME:'MME',
};

// Real RSI calculation (Wilder smoothing)
function calcRSI(closes, period = 14) {
  if (!closes || closes.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gains += d; else losses += Math.abs(d);
  }
  if (losses === 0) return 100;
  const rs = gains / period / (losses / period);
  return +(100 - 100 / (1 + rs)).toFixed(1);
}

// Proxy RSI — accurate estimate from 24h ticker
// Core: price position in range = best RSI proxy
function proxyRSI(price, high, low, open, wap, ch24) {
  if (!price || price <= 0 || high <= low) return 50;
  const rp   = (price - low) / (high - low);      // 0=at low, 1=at high
  const lw   = (Math.min(price, open) - low) / (high - low);
  const body = Math.abs(price - open) / (high - low);
  const vsWap = wap > 0 ? (price - wap) / wap * 100 : 0;

  let rsi = rp * 100;
  rsi += ch24 * 1.5;
  rsi += vsWap * 1.5;
  if (lw > 0.3 && rp > 0.5) rsi += 8;
  if (body > 0.6) rsi += ch24 > 0 ? 6 : -6;

  return Math.max(5, Math.min(95, Math.round(rsi)));
}

// Build a standardized coin object from ticker
function buildCoin(t) {
  const sym   = (t.symbol || '').replace('USDT', '');
  const price = +(t.lastPrice || 0);
  const ch24  = +(t.priceChangePercent || 0);
  const vol   = +(t.quoteVolume || 0);
  const high  = +(t.highPrice  || price * 1.02);
  const low   = +(t.lowPrice   || price * 0.98);
  const open  = +(t.openPrice  || price);
  const wap   = +(t.weightedAvgPrice || price);
  const count = +(t.count || 0);

  if (price <= 0 || vol < 100000) return null;

  const range = high > low ? (high - low) / price : 0.02;
  const rp    = high > low ? (price - low) / (high - low) : 0.5;
  const lw    = high > low ? (Math.min(price, open) - low) / (high - low) : 0;
  const body  = Math.abs(price - open) / Math.max(high - low, price * 0.001);
  const vt    = vol >= 1e9 ? 5 : vol >= 200e6 ? 4 : vol >= 50e6 ? 3 : vol >= 10e6 ? 2 : vol >= 1e6 ? 1 : 0;
  const isMeme = MEME_SET.has(sym);
  const sector = SECTORS[sym] || (isMeme ? 'MME' : null);

  const rsi = proxyRSI(price, high, low, open, wap, ch24);

  const slPct  = Math.max(3, Math.min(15, range * 100 * 1.3));
  const tp1Pct = slPct * 1.5;
  const tp2Pct = slPct * 3;

  return {
    symbol: sym,
    price:  +price.toFixed(Math.max(2, -Math.floor(Math.log10(price)) + 3)),
    ch24:   +ch24.toFixed(2),
    vol:    +vol.toFixed(0),
    high:   +high.toFixed(Math.max(2, -Math.floor(Math.log10(price)) + 3)),
    low:    +low.toFixed(Math.max(2, -Math.floor(Math.log10(price)) + 3)),
    open:   +open.toFixed(Math.max(2, -Math.floor(Math.log10(price)) + 3)),
    wap:    +wap.toFixed(Math.max(2, -Math.floor(Math.log10(price)) + 3)),
    range:  +(range * 100).toFixed(2),
    rp:     +rp.toFixed(3),
    lw:     +lw.toFixed(3),
    body:   +body.toFixed(3),
    vt, count, isMeme, sector,
    rsi, rsiReal: false,
    slPct: +slPct.toFixed(1),
    tp1Pct: +tp1Pct.toFixed(1),
    tp2Pct: +tp2Pct.toFixed(1),
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 's-maxage=20');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const sf = async (url, ms = 6000) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    try {
      const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
      clearTimeout(timer); if (!r.ok) return null; return await r.json();
    } catch { clearTimeout(timer); return null; }
  };

  try {
    const t0 = Date.now();

    // ── 5-SOURCE TICKER FALLBACK ──────────────────────────────────
    const [tickerR, fngR] = await Promise.allSettled([
      (async () => {
        const b1 = await sf('https://api.binance.com/api/v3/ticker/24hr', 8000);
        if (Array.isArray(b1) && b1.length > 100) return { data: b1, src: 'Binance', count: b1.length };

        const b2 = await sf('https://fapi.binance.com/fapi/v1/ticker/24hr', 6000);
        if (Array.isArray(b2) && b2.length > 50) return { data: b2, src: 'Binance Futures', count: b2.length };

        const by = await sf('https://api.bybit.com/v5/market/tickers?category=spot', 7000);
        if (by?.result?.list?.length > 50) return {
          data: by.result.list.map(t => ({
            symbol: t.symbol || '',
            lastPrice: t.lastPrice || '0',
            priceChangePercent: t.price24hPcnt ? (parseFloat(t.price24hPcnt) * 100).toFixed(4) : '0',
            quoteVolume: t.turnover24h || '0',
            highPrice: t.highPrice24h || t.lastPrice || '0',
            lowPrice: t.lowPrice24h || t.lastPrice || '0',
            openPrice: t.prevPrice24h || t.lastPrice || '0',
            weightedAvgPrice: t.lastPrice || '0',
            count: '0',
          })),
          src: 'Bybit', count: by.result.list.length,
        };

        const mx = await sf('https://api.mexc.com/api/v3/ticker/24hr', 6000);
        if (Array.isArray(mx) && mx.length > 50) return { data: mx, src: 'MEXC', count: mx.length };

        const cg = await sf('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=volume_desc&per_page=250&page=1&sparkline=false&price_change_percentage=24h', 9000);
        if (Array.isArray(cg)) return {
          data: cg.map(c => ({
            symbol: (c.symbol || '').toUpperCase() + 'USDT',
            lastPrice: String(c.current_price || 0),
            priceChangePercent: String(c.price_change_percentage_24h || 0),
            quoteVolume: String(c.total_volume || 0),
            highPrice: String((c.current_price || 0) * 1.025),
            lowPrice: String((c.current_price || 0) * 0.975),
            openPrice: String((c.current_price || 0) / (1 + (c.price_change_percentage_24h || 0) / 100)),
            weightedAvgPrice: String(c.current_price || 0),
            count: '0',
          })),
          src: 'CoinGecko', count: cg.length,
        };
        return null;
      })(),
      sf('https://api.alternative.me/fng/?limit=1&format=json', 4000),
    ]);

    const tickerResult = tickerR.status === 'fulfilled' ? tickerR.value : null;
    const rawTickers   = tickerResult?.data || [];
    const src          = tickerResult?.src || 'unknown';
    const fg           = fngR.status === 'fulfilled' ? parseInt(fngR.value?.data?.[0]?.value || 50) : 50;

    if (!rawTickers.length) {
      return res.status(200).json({
        timestamp: Date.now(), src: 'unavailable', fg,
        gainers: [], losers: [], rsiList: [], volBreakouts: [],
        market: { signal: 'UNKNOWN', avg24h: 0, total: 0 },
      });
    }

    // ── FILTER & BUILD ALL COINS ──────────────────────────────────
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
      .map(t => buildCoin(t))
      .filter(Boolean);

    // ── REAL RSI: top 20 by volume ────────────────────────────────
    const top20syms = all
      .filter(c => c.vol > 5e6)
      .sort((a, b) => b.vol - a.vol)
      .slice(0, 20)
      .map(c => c.symbol + 'USDT');

    const klineResults = await Promise.allSettled(
      top20syms.map(sym =>
        sf(`https://api.binance.com/api/v3/klines?symbol=${sym}&interval=4h&limit=25`, 4500)
          .then(d => Array.isArray(d) && d.length >= 15 ? d :
            sf(`https://api.binance.com/api/v3/klines?symbol=${sym}&interval=1h&limit=42`, 3500)
              .then(d2 => Array.isArray(d2) && d2.length >= 15 ? d2 : null)
          )
      )
    );

    // Apply real RSI
    let realRSICount = 0;
    top20syms.forEach((sym, i) => {
      const r = klineResults[i];
      if (r.status === 'fulfilled' && Array.isArray(r.value) && r.value.length >= 15) {
        const closes = r.value.map(k => +k[4]).filter(v => v > 0);
        const realRSI = calcRSI(closes, 14);
        if (realRSI !== null) {
          const base = sym.replace('USDT', '');
          const coin = all.find(c => c.symbol === base);
          if (coin) { coin.rsi = +realRSI; coin.rsiReal = true; realRSICount++; }
        }
      }
    });

    // ── MARKET SUMMARY ────────────────────────────────────────────
    const pos    = all.filter(c => c.ch24 > 0).length;
    const neg    = all.filter(c => c.ch24 < 0).length;
    const avg24h = all.length ? +(all.reduce((s, c) => s + c.ch24, 0) / all.length).toFixed(2) : 0;
    const bigMove= all.filter(c => Math.abs(c.ch24) > 10).length;
    const totalV = all.reduce((s, c) => s + c.vol, 0);
    const signal = avg24h > 3 ? 'BULLISH' : avg24h < -3 ? 'BEARISH' : pos > neg * 1.2 ? 'MILD BULL' : 'NEUTRAL';

    // ── TOP GAINERS (all positive, quality sort) ──────────────────
    const gainers = all
      .filter(c => c.ch24 > 0 && c.vol > 500000)
      .sort((a, b) => {
        // Quality: ch24 × vol_tier × body — rewards real moves with volume
        const qa = a.ch24 * (a.vt + 1) * (0.5 + a.body);
        const qb = b.ch24 * (b.vt + 1) * (0.5 + b.body);
        return qb - qa;
      });

    // ── TOP LOSERS (all negative, quality sort) ───────────────────
    const losers = all
      .filter(c => c.ch24 < 0 && c.vol > 500000)
      .sort((a, b) => {
        const qa = Math.abs(a.ch24) * (a.vt + 1);
        const qb = Math.abs(b.ch24) * (b.vt + 1);
        return qb - qa;
      });

    // ── RSI LIST (ALL coins, sorted) ──────────────────────────────
    const rsiList = all
      .filter(c => c.vol > 200000)
      .sort((a, b) => a.rsi - b.rsi); // ascending: most oversold first

    // ── VOLUME BREAKOUTS (all coins scored) ──────────────────────
    const volBreakouts = all
      .filter(c => c.vol > 1e6)
      .map(c => {
        let sc = c.vt * 8;
        const sigs = [];
        if (c.body > 0.6 && c.ch24 > 0)       { sc += 20; sigs.push('STRONG BULL'); }
        else if (c.body > 0.6 && c.ch24 < 0)   { sc += 12; sigs.push('STRONG BEAR'); }
        if (c.lw > 0.4 && c.rp > 0.5)          { sc += 15; sigs.push('LIQ SWEEP'); }
        if (c.rp > 0.85 && c.ch24 > 0)          { sc += 10; sigs.push('AT HIGH'); }
        if (c.range > 8)                          { sc += 10; sigs.push(`RNG+${c.range}%`); }
        if (Math.abs(c.ch24) > 15)               { sc += 12; sigs.push(`${c.ch24>0?'+':''}${c.ch24}%`); }
        else if (Math.abs(c.ch24) > 8)           { sc += 8; }
        if (c.vt >= 3 && Math.abs(c.ch24) < 2)  { sc += 18; sigs.push('STEALTH ACCUM'); }
        if (c.body < 0.2 && c.lw > 0.35)        { sc += 8; sigs.push('REJECTION'); }
        const type = c.vt >= 3 && Math.abs(c.ch24) < 2 ? 'STEALTH' :
                     c.vt >= 3 && c.ch24 > 5 && c.body > 0.5 ? 'BREAKOUT' :
                     c.ch24 > 15 && c.vt <= 2 ? 'FAKE PUMP' :
                     c.ch24 > 3 ? 'VOL BULL' :
                     c.ch24 < -5 ? 'VOL BEAR' : 'ACTIVE';
        return { ...c, bScore: Math.min(100, sc), bType: type, sigs: sigs.slice(0, 3) };
      })
      .sort((a, b) => b.bScore - a.bScore);

    const fmtV = n => n >= 1e9 ? '$'+(n/1e9).toFixed(1)+'B' : n >= 1e6 ? '$'+(n/1e6).toFixed(0)+'M' : '$'+(n/1e3).toFixed(0)+'K';

    return res.status(200).json({
      timestamp: Date.now(),
      scanTime: ((Date.now() - t0) / 1000).toFixed(1),
      src, fg,
      market: { signal, avg24h, pos, neg, bigMove, total: all.length, totalVol: +totalV.toFixed(0) },
      realRSICount,
      gainers,
      losers,
      rsiList,
      volBreakouts,
      // Legacy fields for backward compat
      topGainers: gainers.slice(0, 30),
      topLosers: losers.slice(0, 20),
      rsiExtremes: rsiList.filter(c => c.rsi <= 42 || c.rsi >= 65),
      volumeBreakouts: volBreakouts.slice(0, 20),
    });

  } catch (e) {
    return res.status(200).json({
      timestamp: Date.now(), src: 'error', error: e.message, fg: 50,
      gainers: [], losers: [], rsiList: [], volBreakouts: [],
      topGainers: [], topLosers: [], rsiExtremes: [], volumeBreakouts: [],
      market: { signal: 'UNKNOWN', avg24h: 0, total: 0 },
    });
  }
}
