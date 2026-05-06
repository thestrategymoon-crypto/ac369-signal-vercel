// api/memes.js — AC369 FUSION v1.0
// ══════════════════════════════════════════════════════════════════
// MEME COIN INTELLIGENCE ENGINE
// Sources: Binance (primary) → CoinGecko (fallback)
// Returns: scored meme setups with Entry/SL/TP + signals
// ══════════════════════════════════════════════════════════════════

// All known meme coins on Binance
const MEME_SYMBOLS = [
  'DOGE','SHIB','PEPE','BONK','WIF','FLOKI','BRETT','MOG','NEIRO',
  'GOAT','PNUT','ACT','TURBO','PEOPLE','MOODENG','LUNC','BOME',
  'MEME','BTT','HOT','WIN','DOGS','HMSTR','CATI','NOT',
  'BABYDOGE','ELON','SAMO','GIGA','CHEEMS','WOJAK','BOBO',
  'POPCAT','PONKE','SLERF','MYRO','BOTTO','AIDOGE',
];

// Meme narrative categories
const MEME_CATS = {
  DOGE:'OG Meme', SHIB:'OG Meme', LUNC:'OG Meme',
  PEPE:'Frog Army', BRETT:'Frog Army', MOG:'Frog Army',
  BONK:'Solana Meme', WIF:'Solana Meme', POPCAT:'Solana Meme',
  PONKE:'Solana Meme', MYRO:'Solana Meme', SLERF:'Solana Meme',
  FLOKI:'Dog Meme', BABYDOGE:'Dog Meme', ELON:'Dog Meme', SAMO:'Dog Meme',
  NEIRO:'Cat Meme', MOODENG:'Animal Meme', CATI:'Cat Meme',
  GOAT:'AI Meme', ACT:'AI Meme', TURBO:'AI Meme',
  PNUT:'Political Meme', PEOPLE:'Political Meme',
  BOME:'Book Meme', GIGA:'Chad Meme', CHEEMS:'Chad Meme',
};

const STABLES = new Set(['USDT','USDC','BUSD','DAI','FDUSD']);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 's-maxage=30');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const sf = async (url, ms = 7000) => {
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

  try {
    const t0 = Date.now();

    // Fetch all tickers + Fear & Greed in parallel
    const [binR, fngR, cgR] = await Promise.allSettled([
      // Binance Spot → Futures fallback
      sf('https://api.binance.com/api/v3/ticker/24hr', 8000)
        .then(d => Array.isArray(d) && d.length > 100 ? d :
          sf('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&category=meme-token&order=volume_desc&per_page=50&page=1&sparkline=false&price_change_percentage=24h,7d', 8000)
            .then(cg => Array.isArray(cg) ? cg.map(c => ({
              symbol: c.symbol.toUpperCase() + 'USDT',
              lastPrice: String(c.current_price || 0),
              priceChangePercent: String(c.price_change_percentage_24h || 0),
              quoteVolume: String(c.total_volume || 0),
              highPrice: String((c.current_price || 0) * 1.05),
              lowPrice: String((c.current_price || 0) * 0.95),
              openPrice: String((c.current_price || 0) / (1 + (c.price_change_percentage_24h || 0) / 100)),
              _mcap: c.market_cap || 0,
              _7d: c.price_change_percentage_7d_in_currency || 0,
            })) : null)
        ),
      sf('https://api.alternative.me/fng/?limit=1&format=json', 5000),
      // CoinGecko for 7d data on top memes
      sf('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=dogecoin,shiba-inu,pepe,bonk,dogwifcoin,floki,brett,mog-coin,neiro,goatseus-maximus,peanut-the-squirrel,act-i-the-ai-prophecy,turbo,meme,baby-doge-coin,popcat&order=volume_desc&sparkline=false&price_change_percentage=7d', 6000),
    ]);

    const allTickers = binR.status === 'fulfilled' ? binR.value : [];
    const fg = fngR.status === 'fulfilled' ? parseInt(fngR.value?.data?.[0]?.value || 50) : 50;
    const cgData = cgR.status === 'fulfilled' && Array.isArray(cgR.value) ? cgR.value : [];

    // Build CoinGecko lookup for 7d data
    const cgLookup = {};
    cgData.forEach(c => {
      const sym = (c.symbol || '').toUpperCase();
      cgLookup[sym] = {
        ch7: c.price_change_percentage_7d_in_currency || 0,
        mcap: c.market_cap || 0,
        rank: c.market_cap_rank || 999,
        ath: c.ath || 0,
        athChange: c.ath_change_percentage || -50,
      };
    });

    if (!allTickers || !allTickers.length) {
      return res.status(200).json({ error: null, memes: [], totalScanned: 0, fg, timestamp: Date.now() });
    }

    // Build ticker map
    const tickerMap = {};
    allTickers.forEach(t => { if (t?.symbol) tickerMap[t.symbol] = t; });

    // Also build from all Binance - find unknown memes by vol/change pattern
    const autoMemes = [];
    if (Array.isArray(allTickers)) {
      allTickers.forEach(t => {
        if (!t?.symbol?.endsWith('USDT')) return;
        const b = t.symbol.replace('USDT', '');
        if (STABLES.has(b) || b.length > 10) return;
        const v = +(t.quoteVolume || 0), p = +(t.lastPrice || 0);
        if (v < 5e6 || p <= 0) return;
        if (MEME_SYMBOLS.includes(b)) return; // already in list
        const ch24 = +(t.priceChangePercent || 0);
        // Heuristic: new meme coins = extreme moves + high vol/mcap ratio
        if (Math.abs(ch24) > 20 && v > 20e6) autoMemes.push(b);
      });
    }

    // Process all known + discovered memes
    const allSymbols = [...new Set([...MEME_SYMBOLS, ...autoMemes.slice(0, 10)])];
    const results = [];

    allSymbols.forEach(sym => {
      const t = tickerMap[sym + 'USDT'];
      if (!t) return;

      const price  = +(t.lastPrice || 0);
      const ch24   = +(t.priceChangePercent || 0);
      const vol    = +(t.quoteVolume || 0);
      const high   = +(t.highPrice || price * 1.05);
      const low    = +(t.lowPrice  || price * 0.95);
      const open   = +(t.openPrice || price);

      if (price <= 0 || vol < 1e6) return;

      const cgInfo  = cgLookup[sym] || {};
      const ch7     = cgInfo.ch7 || t._7d || 0;
      const mcap    = cgInfo.mcap || t._mcap || 0;
      const ath     = cgInfo.ath  || price * 3;
      const athPct  = cgInfo.athChange || (price - ath) / ath * 100;

      const range   = Math.max(high - low, price * 0.01);
      const rp      = (price - low) / range;
      const lw      = (Math.min(price, open) - low) / range;
      const body    = Math.abs(price - open) / range;
      const vt      = vol >= 500e6 ? 5 : vol >= 100e6 ? 4 : vol >= 30e6 ? 3 : vol >= 10e6 ? 2 : vol >= 2e6 ? 1 : 0;

      // ── MEME-SPECIFIC SCORING ──────────────────────────────
      let score = 0;
      const signals = [];

      // 1. Momentum (0-30) - memes need momentum
      if (ch24 > 20)       { score += 30; signals.push('🔥 PUMPING'); }
      else if (ch24 > 10)  { score += 24; signals.push('📈 STRONG'); }
      else if (ch24 > 5)   { score += 18; signals.push('✅ BULLISH'); }
      else if (ch24 > 0)   { score += 12; signals.push('🟢 POSITIVE'); }
      else if (ch24 > -5)  { score += 8;  signals.push('⚖️ FLAT'); }
      else if (ch24 > -15) { score += 4;  signals.push('⚠️ DIP'); }
      else                 { score += 2;  signals.push('📉 FALLING'); }

      // 2. Volume Quality (0-25)
      const volM = vol / 1e6;
      if (volM >= 500)     { score += 25; signals.push('🐳 WHALE VOL'); }
      else if (volM >= 100){ score += 20; signals.push('💎 HIGH VOL'); }
      else if (volM >= 30) { score += 15; signals.push('📊 MED VOL'); }
      else if (volM >= 10) { score += 10; }
      else                 { score += 5; }

      // Volume spike: high vol + controlled move
      if (volM >= 50 && Math.abs(ch24) >= 5 && Math.abs(ch24) <= 30) {
        score += 5; signals.push('⚡ VOL SPIKE');
      }

      // 3. Price Position (0-15)
      if (rp < 0.30)           { score += 15; signals.push('🟢 AT LOW'); }
      else if (rp < 0.50)      { score += 10; signals.push('💰 DISCOUNT'); }
      else if (rp < 0.70)      { score += 6; }
      else                     { score += 3; }

      // Liquidity sweep
      if (lw > 0.35 && rp < 0.50) { score += 5; signals.push('💥 LIQ SWEEP'); }

      // 4. ATH Distance (0-15)
      if (athPct >= -40)        { score += 5; signals.push('📈 NEAR ATH'); }
      else if (athPct >= -70)   { score += 10; }
      else if (athPct >= -85)   { score += 15; signals.push('💎 DEEP DIP'); }
      else                      { score += 8; }

      // 5. 7D Trend (0-10)
      if (ch7 > 20)     { score += 10; signals.push('🚀 7D BULL'); }
      else if (ch7 > 5) { score += 8; }
      else if (ch7 > 0) { score += 5; }
      else              { score += 2; }

      // 6. Fear & Greed bonus
      if (fg <= 20)      score += 5;
      else if (fg <= 35) score += 3;

      // ── TRADE LEVELS ──────────────────────────────────────
      const slPct    = Math.max(0.08, Math.min(0.20, range / price * 2)); // memes: wider SL
      const sl       = +(price * (1 - slPct)).toFixed(8);
      const slDist   = price - sl;
      const tp1      = +(price + slDist * 1.5).toFixed(8);
      const tp2      = +(price + slDist * 3.0).toFixed(8);
      const tp3      = +(price + slDist * 5.0).toFixed(8); // memes can 5x
      const tp1Pct   = +((tp1 - price) / price * 100).toFixed(1);
      const tp2Pct   = +((tp2 - price) / price * 100).toFixed(1);
      const tp3Pct   = +((tp3 - price) / price * 100).toFixed(1);
      const entryLo  = +(price * 0.995).toFixed(8);
      const entryHi  = +(price * 1.005).toFixed(8);

      // ── RISK RATING ────────────────────────────────────────
      const riskScore = vt <= 1 ? 5 : vt <= 2 ? 4 : volM > 100 ? 2 : 3;
      const riskLabel = riskScore >= 5 ? '🔴 VERY HIGH' : riskScore >= 4 ? '🟠 HIGH' : riskScore >= 3 ? '🟡 MEDIUM' : '🟢 MANAGED';

      // ── TRADE STYLE ────────────────────────────────────────
      const tradeStyle = ch24 > 10 ? 'MOMENTUM' : rp < 0.35 ? 'DIP BUY' : ch7 > 10 ? 'TREND RIDE' : 'SCALP';

      // ── TIER ───────────────────────────────────────────────
      const tier = score >= 75 ? 'S' : score >= 55 ? 'A' : score >= 35 ? 'B' : 'C';

      results.push({
        symbol: sym,
        category: MEME_CATS[sym] || (autoMemes.includes(sym) ? 'New Meme 🆕' : 'Meme'),
        price, ch24: +ch24.toFixed(2), ch7: +ch7.toFixed(2), vol,
        volM: +volM.toFixed(1), mcap,
        high, low, open, rp: +rp.toFixed(2), lw: +lw.toFixed(2), body: +body.toFixed(2),
        athPct: +athPct.toFixed(1), vt,
        score: Math.round(Math.min(100, score)),
        signals: signals.slice(0, 5),
        tier,
        risk: riskLabel, riskScore,
        tradeStyle,
        trade: {
          entry: price, entryLo, entryHi,
          sl, slPct: +(slPct * 100).toFixed(1),
          tp1, tp1Pct, tp2, tp2Pct, tp3, tp3Pct,
          rr: `1:${(1.5).toFixed(1)} / 1:3 / 1:5`,
        },
        isNew: autoMemes.includes(sym),
        isTopVol: volM >= 100,
      });
    });

    // Sort by score desc
    results.sort((a, b) => b.score - a.score || b.vol - a.vol);

    // Categories
    const trending  = results.filter(r => r.ch24 > 5).slice(0, 8);
    const dips      = results.filter(r => r.ch24 < -5 && r.score >= 40).slice(0, 6);
    const topVol    = results.filter(r => r.volM >= 50).sort((a, b) => b.vol - a.vol).slice(0, 8);
    const newMemes  = results.filter(r => r.isNew).slice(0, 5);
    const elite     = results.filter(r => r.tier === 'S').slice(0, 5);

    // Market stats
    const avg24h    = results.length ? +(results.reduce((a, r) => a + r.ch24, 0) / results.length).toFixed(2) : 0;
    const pumping   = results.filter(r => r.ch24 > 10).length;
    const dumping   = results.filter(r => r.ch24 < -10).length;
    const totalVol  = results.reduce((a, r) => a + r.vol, 0);

    return res.status(200).json({
      timestamp: Date.now(),
      scanTime: ((Date.now() - t0) / 1000).toFixed(1),
      version: 'v1.0',
      fg, fgLabel: fg <= 25 ? 'Extreme Fear' : fg <= 45 ? 'Fear' : fg >= 75 ? 'Greed' : 'Neutral',
      totalScanned: results.length,
      stats: {
        avg24h, pumping, dumping,
        totalVol, neutral: results.length - pumping - dumping,
        memeMarketSentiment: avg24h > 3 ? 'BULL' : avg24h < -3 ? 'BEAR' : 'NEUTRAL',
      },
      all: results,
      trending,
      dips,
      topVol,
      newMemes,
      elite,
    });

  } catch (e) {
    return res.status(500).json({ error: e.message, memes: [], totalScanned: 0, timestamp: Date.now() });
  }
}
