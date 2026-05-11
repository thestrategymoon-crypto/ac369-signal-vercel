// api/altcoins.js — AC369 FUSION v12.0
// Source: Binance Spot → CoinGecko → CoinCap
// FIXED: isArray check before every .filter()

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60');

  const sf = async (url, ms = 6000) => {
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
    // MULTI-SOURCE FALLBACK (5 sources)
    let tickers = null, source = 'unknown';
    const b1 = await sf('https://api.binance.com/api/v3/ticker/24hr');
    if (Array.isArray(b1) && b1.length > 100) { tickers = b1; source = 'binance_spot'; }
    if (!tickers) {
      const b2 = await sf('https://fapi.binance.com/fapi/v1/ticker/24hr');
      if (Array.isArray(b2) && b2.length > 50) { tickers = b2; source = 'binance_futures'; }
    }
    if (!tickers) {
      const by = await sf('https://api.bybit.com/v5/market/tickers?category=spot');
      if (by?.result?.list?.length > 50) {
        tickers = by.result.list.map(t => ({
          symbol: t.symbol || '', lastPrice: t.lastPrice || '0',
          priceChangePercent: t.price24hPcnt ? (parseFloat(t.price24hPcnt)*100).toFixed(4) : '0',
          quoteVolume: t.turnover24h || '0',
          highPrice: t.highPrice24h || t.lastPrice || '0',
          lowPrice: t.lowPrice24h || t.lastPrice || '0',
        }));
        source = 'bybit';
      }
    }
    if (!tickers) {
      const mx = await sf('https://api.mexc.com/api/v3/ticker/24hr');
      if (Array.isArray(mx) && mx.length > 50) { tickers = mx; source = 'mexc'; }
    }
    if (!tickers) {
      // SOURCE: CoinGecko (always works as last resort)
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
    if (!Array.isArray(tickers) || tickers.length === 0) return res.status(200).json({ timestamp: Date.now(), dataSource: 'unavailable', topGainers: [], topLosers: [], volumeSpike: [], rsiExtremes: [], narratives: [], smc: [] });

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
      if (!filtered.length) return res.status(200).json({ timestamp: Date.now(), dataSource: source, topGainers: [], topLosers: [], volumeSpike: [], rsiExtremes: [], narratives: [], smc: [] });

      const sorted = [...filtered].sort((a, b) => +b.priceChangePercent - +a.priceChangePercent);

      const topGainers = sorted.slice(0, 15).map(t => ({
        symbol: t.symbol.replace('USDT', ''),
        price: +(+t.lastPrice).toFixed(6),
        change24h: +(+t.priceChangePercent).toFixed(2),
        volume: Math.round(+t.quoteVolume),
      }));
      const topLosers = sorted.slice(-10).reverse().map(t => ({
        symbol: t.symbol.replace('USDT', ''),
        price: +(+t.lastPrice).toFixed(6),
        change24h: +(+t.priceChangePercent).toFixed(2),
        volume: Math.round(+t.quoteVolume),
      }));
      // ── VOLUME BREAKOUT ENGINE ─────────────────────────────────────
      // Score every coin by volume quality, not just raw $ amount
      const volScored = filtered
        .filter(t => +(t.quoteVolume || 0) > 2000000) // min $2M
        .map(t => {
          const price   = +(t.lastPrice || 0);
          const vol     = +(t.quoteVolume || 0);
          const ch24    = +(t.priceChangePercent || 0);
          const high    = +(t.highPrice || price);
          const low     = +(t.lowPrice  || price);
          const open    = +(t.openPrice || price);
          const count   = +(t.count     || 0); // number of trades
          const sym     = t.symbol.replace('USDT', '');

          if (price <= 0) return null;

          const range    = high > low ? (high - low) / price : 0.01;
          const body     = Math.abs(price - open) / Math.max(high - low, price * 0.001);
          const rp       = high > low ? (price - low) / (high - low) : 0.5; // 0=low, 1=high
          const lw       = high > low ? (Math.min(price, open) - low) / (high - low) : 0; // lower wick

          // Volume tiers (absolute)
          const volTier  = vol >= 1e9 ? 5 : vol >= 200e6 ? 4 : vol >= 50e6 ? 3 : vol >= 10e6 ? 2 : 1;

          // Trade intensity: count/vol = activity per dollar
          const tradeIntensity = count > 0 && vol > 0 ? count / (vol / 1e6) : 0;

          // Breakout scoring (0-100)
          let bScore = 0;
          const signals = [];

          // 1. Volume magnitude
          bScore += volTier * 8;

          // 2. Price action quality
          if (body > 0.6 && ch24 > 0)   { bScore += 20; signals.push('STRONG BULL CANDLE'); }
          else if (body > 0.6 && ch24 < 0){ bScore += 12; signals.push('STRONG BEAR CANDLE'); }
          else if (body < 0.25 && lw > 0.35) { bScore += 18; signals.push('REJECTION WICK'); }

          // 3. Price position (where did it close?)
          if (rp > 0.80 && ch24 > 0)   { bScore += 15; signals.push('CLOSED AT HIGH'); }
          else if (rp < 0.20 && ch24 < 0) { bScore += 10; signals.push('SOLD TO LOW'); }

          // 4. Volatility expansion
          if (range > 0.08)  { bScore += 12; signals.push('RANGE EXPANSION +' + (range*100).toFixed(0) + '%'); }
          else if (range > 0.04) { bScore += 6; }

          // 5. Momentum
          if (Math.abs(ch24) > 15) { bScore += 15; signals.push((ch24>0?'+':'') + ch24.toFixed(1) + '% EXPLOSIVE'); }
          else if (Math.abs(ch24) > 8) { bScore += 10; signals.push((ch24>0?'+':'') + ch24.toFixed(1) + '% STRONG'); }
          else if (Math.abs(ch24) > 3) { bScore += 6; }

          // 6. Stealth accumulation (high vol, flat price)
          if (volTier >= 3 && Math.abs(ch24) < 2) {
            bScore += 18;
            signals.push('STEALTH ACCUMULATION');
          }

          // 7. Liquidity sweep signal
          if (lw > 0.45 && rp > 0.50)  { bScore += 12; signals.push('LIQUIDITY SWEEP'); }

          // Breakout type classification
          let breakoutType, breakoutColor;
          if (volTier >= 3 && Math.abs(ch24) < 2) {
            breakoutType = '🕵️ STEALTH ACCUM';
            breakoutColor = 'amber';
          } else if (volTier >= 3 && ch24 > 5 && body > 0.5) {
            breakoutType = '🚀 REAL BREAKOUT';
            breakoutColor = 'bull';
          } else if (ch24 > 15 && volTier <= 2) {
            breakoutType = '⚠️ FAKE PUMP';
            breakoutColor = 'warn';
          } else if (ch24 > 3 && volTier >= 2) {
            breakoutType = '📈 VOL SURGE BULL';
            breakoutColor = 'bull';
          } else if (ch24 < -5 && volTier >= 2) {
            breakoutType = '📉 VOL SURGE BEAR';
            breakoutColor = 'bear';
          } else if (Math.abs(ch24) < 3 && volTier >= 3) {
            breakoutType = '🏗️ ACCUMULATION';
            breakoutColor = 'neutral';
          } else {
            breakoutType = '📊 VOL ACTIVE';
            breakoutColor = 'neutral';
          }

          // Entry/SL from 24h structure
          const slPct  = Math.max(3, Math.min(10, range * 100 * 1.2));
          const sl     = +(price * (1 - slPct / 100)).toFixed(8);
          const tp1Pct = slPct * 1.5;
          const tp2Pct = slPct * 3;
          const tp1    = +(price * (1 + tp1Pct / 100)).toFixed(8);
          const tp2    = +(price * (1 + tp2Pct / 100)).toFixed(8);

          // Why it's notable
          const reason = signals.length > 0
            ? signals.slice(0, 2).join(' + ')
            : (volTier >= 3 ? 'High volume activity' : 'Volume spike detected');

          return {
            symbol: sym,
            price: +(price).toFixed(8),
            change24h: +ch24.toFixed(2),
            high24h: +high.toFixed(8),
            low24h: +low.toFixed(8),
            open24h: +open.toFixed(8),
            volumeUSD: +vol.toFixed(0),
            volTier,
            tradeCount: count,
            range24h: +(range * 100).toFixed(2),
            body: +body.toFixed(2),
            rp: +rp.toFixed(2),
            lw: +lw.toFixed(2),
            breakoutScore: Math.min(100, bScore),
            breakoutType,
            breakoutColor,
            signals: signals.slice(0, 4),
            reason,
            direction: ch24 >= 0 ? 'LONG' : 'SHORT',
            trade: { sl, slPct: +slPct.toFixed(1), tp1, tp1Pct: +tp1Pct.toFixed(1), tp2, tp2Pct: +tp2Pct.toFixed(1) },
          };
        })
        .filter(Boolean)
        .sort((a, b) => b.breakoutScore - a.breakoutScore);

      const volumeBreakouts = volScored.slice(0, 15);

      // RSI from klines for majors
      const MAJORS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'BNBUSDT']; // Reduced to 5 for faster response
      const klineResults = await Promise.allSettled(
        MAJORS.map(s => sf(`https://fapi.binance.com/fapi/v1/klines?symbol=${s}&interval=1h&limit=50`, 3000)
          .then(d => Array.isArray(d) && d.length > 14 ? d :
            sf(`https://api.binance.com/api/v3/klines?symbol=${s}&interval=1h&limit=50`, 3000)))
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
        rsiExtremes.push({ symbol: sym.replace('USDT', ''), price: +(+tk.lastPrice).toFixed(6), change24h: +(+tk.priceChangePercent).toFixed(2), rsi: rsi.toFixed(2), condition, condDetail, dataSource: dsrc });
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
      const mp = c => ({ symbol: (c.symbol || '').toUpperCase(), price: +(c.current_price || 0).toFixed(6), change24h: +(c.price_change_percentage_24h || 0), volume: Math.round(c.total_volume || 0) });
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
        return { symbol: sym, price: +(c.current_price || 0).toFixed(6), change24h: +chg.toFixed(2), rsi: rsi.toFixed(2), condition, condDetail: 'Estimasi dari price change', dataSource: 'cg_estimate' };
      }).filter(Boolean);
      const topG = topGainers[0];
      return res.status(200).json({ timestamp: Date.now(), dataSource: 'coingecko', topGainers, topLosers, volumeBreakouts, rsiExtremes, narrative: (topG ? `🔥 Top gainer: ${topG.symbol} (${topG.change24h}). ` : '') + '[Data CoinGecko]' });
    }

    return res.status(200).json({ timestamp: Date.now(), dataSource: 'error', topGainers: [], topLosers: [], volumeSpike: [], rsiExtremes: [], narratives: [], smc: [] });
  } catch (e) {
    return res.status(200).json({ timestamp: Date.now(), dataSource: 'error', topGainers: [], topLosers: [], volumeBreakouts: [], rsiExtremes: [], narrative: 'Error: ' + e.message });
  }
}
