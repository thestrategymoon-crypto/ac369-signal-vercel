// api/altcoins.js — AC369 FUSION v10.4
// MULTI-SOURCE: Binance Spot → CoinGecko → CoinCap
// FIXED: Array.isArray check sebelum .filter()

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60');

  const ft = async (url, ms = 10000) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
      const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' } });
      clearTimeout(t);
      if (!r.ok) return null;
      return await r.json();
    } catch { clearTimeout(t); return null; }
  };

  try {
    // ── SOURCE 1: Binance Spot 24hr ────────────────────────────────
    let tickers = null;
    const binanceRes = await ft('https://api.binance.com/api/v3/ticker/24hr');
    if (Array.isArray(binanceRes) && binanceRes.length > 100) {
      tickers = binanceRes;
    }

    // ── SOURCE 2: CoinGecko markets (fallback) ─────────────────────
    let cgCoins = null;
    if (!tickers) {
      const cgRes = await ft('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=1&sparkline=false&price_change_percentage=24h');
      if (Array.isArray(cgRes) && cgRes.length > 10) {
        cgCoins = cgRes;
      }
    }

    // ── SOURCE 3: CoinCap (last resort) ───────────────────────────
    if (!tickers && !cgCoins) {
      const capRes = await ft('https://api.coincap.io/v2/assets?limit=200');
      if (capRes?.data && Array.isArray(capRes.data)) {
        cgCoins = capRes.data.map(c => ({
          symbol: c.symbol?.toUpperCase(),
          id: c.id,
          current_price: parseFloat(c.priceUsd) || 0,
          price_change_percentage_24h: parseFloat(c.changePercent24Hr) || 0,
          total_volume: parseFloat(c.volumeUsd24Hr) || 0,
          market_cap: parseFloat(c.marketCapUsd) || 0,
        }));
      }
    }

    // ── RSI CALCULATION ────────────────────────────────────────────
    const RSI = (closes, p = 14) => {
      if (!closes || closes.length < p + 1) return 50;
      let g = 0, l = 0;
      for (let i = 1; i <= p; i++) { const d = closes[i] - closes[i - 1]; d >= 0 ? g += d : l -= d; }
      let ag = g / p, al = l / p;
      for (let i = p + 1; i < closes.length; i++) {
        const d = closes[i] - closes[i - 1];
        ag = (ag * (p - 1) + (d >= 0 ? d : 0)) / p;
        al = (al * (p - 1) + (d < 0 ? -d : 0)) / p;
      }
      return al === 0 ? 100 : parseFloat((100 - 100 / (1 + ag / al)).toFixed(2));
    };

    // ── FROM BINANCE TICKERS ────────────────────────────────────────
    if (tickers) {
      const STABLES = new Set(['USDT', 'USDC', 'BUSD', 'TUSD', 'DAI', 'FDUSD', 'USDP', 'SUSD', 'GUSD', 'FRAX', 'LUSD']);
      const IGNORE = new Set(['USDTUSDT', 'BUSDUSDT', 'USDCUSDT', 'TUSDUSDT', 'FDUSDUSDT']);

      const filtered = tickers.filter(t => {
        if (!t || typeof t !== 'object') return false;
        const sym = String(t.symbol || '');
        if (!sym.endsWith('USDT')) return false;
        if (IGNORE.has(sym)) return false;
        const base = sym.replace('USDT', '');
        if (STABLES.has(base)) return false;
        if (['UP', 'DOWN', 'BEAR', 'BULL', '3L', '3S'].some(p => base.endsWith(p) || base.startsWith(p))) return false;
        if (parseFloat(t.quoteVolume || 0) < 500000) return false;
        if (parseFloat(t.lastPrice || 0) <= 0) return false;
        return true;
      });

      if (!filtered.length) throw new Error('No valid tickers after filtering');

      const byChange = [...filtered].sort((a, b) => parseFloat(b.priceChangePercent) - parseFloat(a.priceChangePercent));

      const topGainers = byChange.slice(0, 15).map(t => ({
        symbol: t.symbol.replace('USDT', ''),
        price: parseFloat(parseFloat(t.lastPrice).toFixed(6)),
        change24h: parseFloat(parseFloat(t.priceChangePercent).toFixed(2)) + '%',
        volume: Math.round(parseFloat(t.quoteVolume)),
      }));

      const topLosers = byChange.slice(-10).reverse().map(t => ({
        symbol: t.symbol.replace('USDT', ''),
        price: parseFloat(parseFloat(t.lastPrice).toFixed(6)),
        change24h: parseFloat(parseFloat(t.priceChangePercent).toFixed(2)) + '%',
        volume: Math.round(parseFloat(t.quoteVolume)),
      }));

      const volumeBreakouts = filtered
        .filter(t => parseFloat(t.quoteVolume) > 20000000 && Math.abs(parseFloat(t.priceChangePercent)) > 3)
        .sort((a, b) => {
          const sA = parseFloat(a.quoteVolume) * Math.abs(parseFloat(a.priceChangePercent));
          const sB = parseFloat(b.quoteVolume) * Math.abs(parseFloat(b.priceChangePercent));
          return sB - sA;
        })
        .slice(0, 10)
        .map(t => ({
          symbol: t.symbol.replace('USDT', ''),
          price: parseFloat(parseFloat(t.lastPrice).toFixed(6)),
          change24h: parseFloat(parseFloat(t.priceChangePercent).toFixed(2)) + '%',
          volumeUSD: Math.round(parseFloat(t.quoteVolume)),
          volumeRatio: (parseFloat(t.quoteVolume) / 20000000).toFixed(1) + 'x',
          signal: parseFloat(t.priceChangePercent) > 0 ? 'Bullish Breakout' : 'Bearish Breakdown',
        }));

      // RSI for major coins using 1h klines
      const MAJORS = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'ADAUSDT', 'AVAXUSDT', 'DOGEUSDT', 'LINKUSDT', 'DOTUSDT'];
      const rsiPromises = MAJORS.map(sym =>
        ft(`https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=1h&limit=100`)
          .then(d => ({ sym, data: d }))
          .catch(() => ({ sym, data: null }))
      );
      const rsiRaw = await Promise.allSettled(rsiPromises);
      const rsiExtremes = [];

      for (let i = 0; i < MAJORS.length; i++) {
        const sym = MAJORS[i];
        const tickerInfo = tickers.find(t => t.symbol === sym);
        if (!tickerInfo) continue;

        let rsi = 50, dataSource = 'default';
        try {
          const rawResult = rsiRaw[i];
          if (rawResult.status === 'fulfilled' && rawResult.value?.data) {
            const kd = rawResult.value.data;
            if (Array.isArray(kd) && kd.length >= 15) {
              const closes = kd.map(k => parseFloat(k[4])).filter(v => !isNaN(v) && v > 0);
              if (closes.length >= 15) { rsi = RSI(closes, 14); dataSource = 'binance_futures'; }
            }
          }
          // Fallback: estimate RSI from 24h change
          if (dataSource === 'default') {
            const chg = parseFloat(tickerInfo.priceChangePercent || 0);
            rsi = Math.min(95, Math.max(5, 50 + chg * 2.5));
            dataSource = 'estimated';
          }
        } catch {}

        let condition = 'Neutral', condDetail = '';
        if (rsi < 25) { condition = 'Extreme Oversold'; condDetail = 'Peluang beli kuat'; }
        else if (rsi < 35) { condition = 'Oversold (Peluang Beli)'; condDetail = 'Potensi reversal naik'; }
        else if (rsi > 75) { condition = 'Extreme Overbought'; condDetail = 'Waspada distribusi'; }
        else if (rsi > 65) { condition = 'Overbought (Hati-hati)'; condDetail = 'Potensi koreksi'; }
        else if (rsi > 50) { condition = 'Bullish Zone'; condDetail = 'Momentum positif'; }
        else { condition = 'Bearish Zone'; condDetail = 'Momentum negatif'; }

        rsiExtremes.push({
          symbol: sym.replace('USDT', ''),
          price: parseFloat(parseFloat(tickerInfo.lastPrice).toFixed(6)),
          change24h: parseFloat(tickerInfo.priceChangePercent || 0).toFixed(2) + '%',
          rsi: rsi.toFixed(2), condition, condDetail, dataSource,
        });
      }
      rsiExtremes.sort((a, b) => Math.abs(parseFloat(b.rsi) - 50) - Math.abs(parseFloat(a.rsi) - 50));

      // Narrative
      const topG = topGainers[0];
      const oversold = rsiExtremes.filter(r => r.condition.includes('Oversold'));
      const overbought = rsiExtremes.filter(r => r.condition.includes('Overbought'));
      const np = [];
      if (topG) np.push(`🔥 Top gainer: ${topG.symbol} (${topG.change24h}).`);
      if (oversold.length) np.push(`📉 Oversold: ${oversold.map(r => `${r.symbol} RSI${r.rsi}`).join(', ')}.`);
      if (overbought.length) np.push(`📈 Overbought: ${overbought.map(r => r.symbol).join(', ')}.`);
      if (volumeBreakouts.length) np.push(`📊 Volume breakout: ${volumeBreakouts.slice(0, 3).map(v => v.symbol).join(', ')}.`);

      return res.status(200).json({
        timestamp: Date.now(),
        dataSource: 'binance_spot',
        topGainers, topLosers, volumeBreakouts, rsiExtremes,
        narrative: np.join(' ') || 'Pasar dalam kondisi normal.',
      });
    }

    // ── FROM COINGECKO / COINCAP ────────────────────────────────────
    if (cgCoins && cgCoins.length) {
      const sorted = [...cgCoins].sort((a, b) => (b.price_change_percentage_24h || 0) - (a.price_change_percentage_24h || 0));

      const mapCoin = c => ({
        symbol: (c.symbol || '').toUpperCase(),
        price: parseFloat((c.current_price || 0).toFixed(6)),
        change24h: parseFloat((c.price_change_percentage_24h || 0).toFixed(2)) + '%',
        volume: Math.round(c.total_volume || 0),
      });

      const topGainers = sorted.filter(c => (c.price_change_percentage_24h || 0) > 0).slice(0, 15).map(mapCoin);
      const topLosers = sorted.reverse().filter(c => (c.price_change_percentage_24h || 0) < 0).slice(0, 10).map(mapCoin);

      const volumeBreakouts = cgCoins
        .filter(c => (c.total_volume || 0) > 10000000 && Math.abs(c.price_change_percentage_24h || 0) > 3)
        .sort((a, b) => (b.total_volume || 0) - (a.total_volume || 0))
        .slice(0, 10)
        .map(c => ({
          symbol: (c.symbol || '').toUpperCase(),
          price: parseFloat((c.current_price || 0).toFixed(6)),
          change24h: parseFloat((c.price_change_percentage_24h || 0).toFixed(2)) + '%',
          volumeUSD: Math.round(c.total_volume || 0),
          volumeRatio: ((c.total_volume || 0) / 10000000).toFixed(1) + 'x',
          signal: (c.price_change_percentage_24h || 0) > 0 ? 'Bullish Breakout' : 'Bearish Breakdown',
        }));

      // RSI estimated from price change
      const MAJORS_CG = ['BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'ADA', 'AVAX', 'DOGE', 'LINK', 'DOT'];
      const rsiExtremes = MAJORS_CG.map(sym => {
        const coin = cgCoins.find(c => (c.symbol || '').toUpperCase() === sym);
        if (!coin) return null;
        const chg = parseFloat(coin.price_change_percentage_24h || 0);
        const rsi = Math.min(95, Math.max(5, 50 + chg * 2.5));
        let condition = 'Neutral', condDetail = 'Estimasi dari perubahan 24h';
        if (rsi < 35) { condition = 'Oversold (Est.)'; condDetail = 'Estimasi berdasarkan price change'; }
        else if (rsi > 65) { condition = 'Overbought (Est.)'; condDetail = 'Estimasi berdasarkan price change'; }
        else if (rsi > 50) { condition = 'Bullish Zone'; condDetail = 'Momentum positif'; }
        else { condition = 'Bearish Zone'; condDetail = 'Momentum negatif'; }
        return {
          symbol: sym, price: parseFloat((coin.current_price || 0).toFixed(6)),
          change24h: chg.toFixed(2) + '%', rsi: rsi.toFixed(2),
          condition, condDetail, dataSource: 'coingecko_estimate',
        };
      }).filter(Boolean);

      const topG = topGainers[0];
      const oversold = rsiExtremes.filter(r => r.condition.includes('Oversold'));
      const np = [];
      if (topG) np.push(`🔥 Top gainer: ${topG.symbol} (${topG.change24h}).`);
      if (oversold.length) np.push(`📉 Oversold est.: ${oversold.map(r => r.symbol).join(', ')}.`);
      np.push('[Data dari CoinGecko — RSI estimasi]');

      return res.status(200).json({
        timestamp: Date.now(), dataSource: 'coingecko',
        topGainers, topLosers, volumeBreakouts, rsiExtremes,
        narrative: np.join(' '),
      });
    }

    throw new Error('All data sources failed');
  } catch (e) {
    return res.status(200).json({
      timestamp: Date.now(), dataSource: 'error',
      topGainers: [], topLosers: [], volumeBreakouts: [], rsiExtremes: [],
      narrative: 'Data altcoin gagal dimuat: ' + e.message + '. Cek koneksi server.',
    });
  }
}
