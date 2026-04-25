// api/altcoins.js — AC369 FUSION v10.6 FINAL
// Source: Binance Spot → CoinGecko → CoinCap
// FIXED: isArray check before every .filter()

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60');

  const sf = async (url, ms = 10000) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
      const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } });
      clearTimeout(t); if (!r.ok) return null;
      return await r.json();
    } catch { clearTimeout(t); return null; }
  };

  const RSI = (c, p = 14) => {
    if (!c || c.length < p + 1) return 50;
    let g = 0, l = 0;
    for (let i = 1; i <= p; i++) { const d = c[i] - c[i - 1]; d >= 0 ? g += d : l -= d; }
    let ag = g / p, al = l / p;
    for (let i = p + 1; i < c.length; i++) { const d = c[i] - c[i - 1]; ag = (ag * (p - 1) + (d >= 0 ? d : 0)) / p; al = (al * (p - 1) + (d < 0 ? -d : 0)) / p; }
    return al === 0 ? 100 : +((100 - 100 / (1 + ag / al)).toFixed(2));
  };

  const STABLES = new Set(['USDT', 'USDC', 'BUSD', 'TUSD', 'DAI', 'FDUSD', 'USDP', 'SUSD', 'GUSD', 'FRAX', 'LUSD']);
  const IGNORE = new Set(['USDTUSDT', 'BUSDUSDT', 'USDCUSDT', 'TUSDUSDT', 'FDUSDUSDT']);
  const BAD_SUFFIX = ['UP', 'DOWN', 'BEAR', 'BULL', '3L', '3S', '2L', '2S'];

  try {
    // SOURCE 1: Binance Spot (most reliable)
    let tickers = await sf('https://api.binance.com/api/v3/ticker/24hr');
    let source = 'binance_spot';

    if (!Array.isArray(tickers) || tickers.length < 50) {
      // SOURCE 2: CoinGecko
      const cgRes = await sf('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=1&sparkline=false&price_change_percentage=24h');
      if (Array.isArray(cgRes) && cgRes.length > 10) { tickers = cgRes; source = 'coingecko'; }
    }
    if (!Array.isArray(tickers) || tickers.length < 10) {
      // SOURCE 3: CoinCap
      const capRes = await sf('https://api.coincap.io/v2/assets?limit=200');
      if (Array.isArray(capRes?.data)) {
        tickers = capRes.data.map(c => ({ symbol: c.symbol?.toUpperCase() + 'USDT', lastPrice: c.priceUsd, priceChangePercent: c.changePercent24Hr, quoteVolume: c.volumeUsd24Hr }));
        source = 'coincap';
      }
    }
    if (!Array.isArray(tickers) || tickers.length === 0) throw new Error('All sources failed');

    // Detect format
    const isBinance = tickers[0]?.lastPrice !== undefined || tickers[0]?.symbol?.endsWith('USDT');
    const isCG = tickers[0]?.current_price !== undefined;

    if (isBinance) {
      // ── BINANCE FORMAT ─────────────────────────────────────────
      const filtered = tickers.filter(t => {
        if (!t || typeof t !== 'object') return false;
        const sym = String(t.symbol || '');
        if (!sym.endsWith('USDT')) return false;
        if (IGNORE.has(sym)) return false;
        const base = sym.replace('USDT', '');
        if (STABLES.has(base)) return false;
        if (BAD_SUFFIX.some(p => base.endsWith(p) || base.startsWith(p))) return false;
        if (+(t.quoteVolume || 0) < 500000) return false;
        if (+(t.lastPrice || 0) <= 0) return false;
        return true;
      });
      if (!filtered.length) throw new Error('No valid tickers after filter');

      const sorted = [...filtered].sort((a, b) => +b.priceChangePercent - +a.priceChangePercent);

      const topGainers = sorted.slice(0, 15).map(t => ({
        symbol: t.symbol.replace('USDT', ''),
        price: +(+t.lastPrice).toFixed(6),
        change24h: +(+t.priceChangePercent).toFixed(2) + '%',
        volume: Math.round(+t.quoteVolume),
      }));
      const topLosers = sorted.slice(-10).reverse().map(t => ({
        symbol: t.symbol.replace('USDT', ''),
        price: +(+t.lastPrice).toFixed(6),
        change24h: +(+t.priceChangePercent).toFixed(2) + '%',
        volume: Math.round(+t.quoteVolume),
      }));
      const volumeBreakouts = filtered
        .filter(t => +(t.quoteVolume || 0) > 20000000 && Math.abs(+(t.priceChangePercent || 0)) > 3)
        .sort((a, b) => +b.quoteVolume * Math.abs(+b.priceChangePercent) - +a.quoteVolume * Math.abs(+a.priceChangePercent))
        .slice(0, 10).map(t => ({
          symbol: t.symbol.replace('USDT', ''),
          price: +(+t.lastPrice).toFixed(6),
          change24h: +(+t.priceChangePercent).toFixed(2) + '%',
          volumeUSD: Math.round(+t.quoteVolume),
          signal: +(t.priceChangePercent) > 0 ? 'Bullish Breakout' : 'Bearish Breakdown',
        }));

      // RSI from klines for majors
      const MAJORS = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'ADAUSDT', 'AVAXUSDT', 'DOGEUSDT', 'LINKUSDT', 'DOTUSDT'];
      const klineResults = await Promise.allSettled(
        MAJORS.map(s => sf(`https://fapi.binance.com/fapi/v1/klines?symbol=${s}&interval=1h&limit=100`)
          .then(d => Array.isArray(d) && d.length > 14 ? d :
            sf(`https://api.binance.com/api/v3/klines?symbol=${s}&interval=1h&limit=100`)))
      );

      const rsiExtremes = [];
      for (let i = 0; i < MAJORS.length; i++) {
        const sym = MAJORS[i];
        const tk = tickers.find(t => t.symbol === sym);
        if (!tk) continue;
        let rsi = 50, dsrc = 'default';
        const kr = klineResults[i];
        if (kr.status === 'fulfilled' && Array.isArray(kr.value) && kr.value.length > 14) {
          const closes = kr.value.map(k => +k[4]).filter(v => !isNaN(v) && v > 0);
          if (closes.length > 14) { rsi = RSI(closes, 14); dsrc = 'klines'; }
        }
        if (dsrc === 'default') { const chg = +(tk.priceChangePercent || 0); rsi = Math.min(95, Math.max(5, 50 + chg * 2.5)); }
        let condition = 'Neutral', condDetail = '';
        if (rsi < 25) { condition = 'Extreme Oversold'; condDetail = 'Peluang beli sangat kuat'; }
        else if (rsi < 35) { condition = 'Oversold (Peluang Beli)'; condDetail = 'Potensi reversal naik'; }
        else if (rsi > 75) { condition = 'Extreme Overbought'; condDetail = 'Waspada distribusi'; }
        else if (rsi > 65) { condition = 'Overbought'; condDetail = 'Potensi koreksi'; }
        else if (rsi > 50) { condition = 'Bullish Zone'; condDetail = 'Momentum positif'; }
        else { condition = 'Bearish Zone'; condDetail = 'Momentum negatif'; }
        rsiExtremes.push({ symbol: sym.replace('USDT', ''), price: +(+tk.lastPrice).toFixed(6), change24h: +(+tk.priceChangePercent).toFixed(2) + '%', rsi: rsi.toFixed(2), condition, condDetail, dataSource: dsrc });
      }
      rsiExtremes.sort((a, b) => Math.abs(+b.rsi - 50) - Math.abs(+a.rsi - 50));

      const topG = topGainers[0];
      const os = rsiExtremes.filter(r => r.condition.includes('Oversold'));
      const ob = rsiExtremes.filter(r => r.condition.includes('Overbought'));
      const vb = volumeBreakouts.slice(0, 3).map(v => v.symbol);
      const np = [];
      if (topG) np.push(`🔥 Top gainer: ${topG.symbol} (${topG.change24h}).`);
      if (os.length) np.push(`📉 Oversold: ${os.map(r => `${r.symbol} RSI${r.rsi}`).join(', ')}.`);
      if (ob.length) np.push(`📈 Overbought: ${ob.map(r => r.symbol).join(', ')}.`);
      if (vb.length) np.push(`📊 Vol breakout: ${vb.join(', ')}.`);

      return res.status(200).json({ timestamp: Date.now(), dataSource: source, topGainers, topLosers, volumeBreakouts, rsiExtremes, narrative: np.join(' ') || 'Pasar normal.' });
    }

    if (isCG) {
      // ── COINGECKO FORMAT ───────────────────────────────────────
      const sorted = [...tickers].sort((a, b) => (b.price_change_percentage_24h || 0) - (a.price_change_percentage_24h || 0));
      const mp = c => ({ symbol: (c.symbol || '').toUpperCase(), price: +(c.current_price || 0).toFixed(6), change24h: +(c.price_change_percentage_24h || 0).toFixed(2) + '%', volume: Math.round(c.total_volume || 0) });
      const topGainers = sorted.filter(c => (c.price_change_percentage_24h || 0) > 0).slice(0, 15).map(mp);
      const topLosers = [...tickers].sort((a, b) => (a.price_change_percentage_24h || 0) - (b.price_change_percentage_24h || 0)).slice(0, 10).map(mp);
      const volumeBreakouts = tickers.filter(c => (c.total_volume || 0) > 10000000 && Math.abs(c.price_change_percentage_24h || 0) > 3)
        .sort((a, b) => (b.total_volume || 0) - (a.total_volume || 0)).slice(0, 10)
        .map(c => ({ ...mp(c), volumeUSD: Math.round(c.total_volume || 0), signal: (c.price_change_percentage_24h || 0) > 0 ? 'Bullish Breakout' : 'Bearish Breakdown' }));
      const MAJORS_CG = ['BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'ADA', 'AVAX', 'DOGE', 'LINK', 'DOT'];
      const rsiExtremes = MAJORS_CG.map(sym => {
        const c = tickers.find(t => (t.symbol || '').toUpperCase() === sym);
        if (!c) return null;
        const chg = c.price_change_percentage_24h || 0;
        const rsi = Math.min(95, Math.max(5, 50 + chg * 2.5));
        const condition = rsi < 35 ? 'Oversold (Est.)' : rsi > 65 ? 'Overbought (Est.)' : rsi > 50 ? 'Bullish Zone' : 'Bearish Zone';
        return { symbol: sym, price: +(c.current_price || 0).toFixed(6), change24h: chg.toFixed(2) + '%', rsi: rsi.toFixed(2), condition, condDetail: 'Estimasi dari price change', dataSource: 'cg_estimate' };
      }).filter(Boolean);
      const topG = topGainers[0];
      return res.status(200).json({ timestamp: Date.now(), dataSource: 'coingecko', topGainers, topLosers, volumeBreakouts, rsiExtremes, narrative: (topG ? `🔥 Top gainer: ${topG.symbol} (${topG.change24h}). ` : '') + '[Data CoinGecko]' });
    }

    throw new Error('Unknown data format');
  } catch (e) {
    return res.status(200).json({ timestamp: Date.now(), dataSource: 'error', topGainers: [], topLosers: [], volumeBreakouts: [], rsiExtremes: [], narrative: 'Error: ' + e.message });
  }
}
