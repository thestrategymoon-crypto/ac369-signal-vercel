// api/macro.js — AC369 FUSION v13 REBUILT
// CryptoCompare primary for klines (always accessible), Bybit for price

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const sf = async (url, ms = 6000) => {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), ms);
    try {
      const r = await fetch(url, { signal: c.signal, headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } });
      clearTimeout(t); if (!r.ok) return null; return await r.json();
    } catch { clearTimeout(t); return null; }
  };

  try {
    const [fngRes, globalRes, btcDailyRes, tickerRes] = await Promise.allSettled([
      sf('https://api.alternative.me/fng/?limit=14&format=json'),
      sf('https://api.coingecko.com/api/v3/global'),
      // CryptoCompare daily BTC (always works)
      sf('https://min-api.cryptocompare.com/data/v2/histoday?fsym=BTC&tsym=USD&limit=90'),
      sf('https://api.binance.com/api/v3/ticker/24hr')
        .then(d => Array.isArray(d) && d.length > 100 ? d
          : sf('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&sparkline=false&price_change_percentage=24h')),
    ]);

    // ── F&G ───────────────────────────────────────────────────
    let fearGreed = { value: 50, classification: 'Neutral', history: [], interpretation: 'Sentimen netral', signal: 'NEUTRAL' };
    if (fngRes.status === 'fulfilled' && fngRes.value?.data) {
      const d = fngRes.value.data, v = parseInt(d[0].value);
      fearGreed = {
        value: v, classification: d[0].value_classification,
        history: d.slice(0, 7).map(x => ({ value: parseInt(x.value), label: x.value_classification, date: new Date(x.timestamp * 1000).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }) })),
        signal: v <= 20 ? 'EXTREME_FEAR_BUY' : v <= 40 ? 'FEAR_ACCUMULATE' : v <= 60 ? 'NEUTRAL' : v <= 80 ? 'GREED_CAUTION' : 'EXTREME_GREED_SELL',
        interpretation: v <= 20 ? 'Extreme Fear — zona akumulasi terbaik' : v <= 40 ? 'Fear — akumulasi bertahap' : v <= 60 ? 'Netral' : v <= 80 ? 'Greed — waspada koreksi' : 'Extreme Greed — distribusi smart money',
      };
    }

    // ── BTC DOMINANCE ─────────────────────────────────────────
    let btcDom = 58, ethDom = 12;
    let btcDominance = { dominance: '58.00%', value: 58, interpretation: 'BTC Season' };
    if (globalRes.status === 'fulfilled' && globalRes.value?.data) {
      const gd = globalRes.value.data;
      btcDom = +((gd.market_cap_percentage?.btc || 58).toFixed(2));
      ethDom = +((gd.market_cap_percentage?.eth || 12).toFixed(2));
      btcDominance = {
        dominance: btcDom.toFixed(2) + '%', value: btcDom, eth: ethDom.toFixed(2) + '%',
        interpretation: btcDom > 60 ? 'BTC Dominasi — kapital terkonsentrasi' : btcDom > 55 ? 'BTC Season — altcoin laggard' : btcDom > 50 ? 'Transisi — rotasi ke altcoin mulai' : btcDom > 45 ? 'Altcoin Season Awal' : 'Altcoin Season Aktif',
        totalMarketCap: gd.total_market_cap?.usd || 0,
        marketCapChange24h: +((gd.market_cap_change_percentage_24h_usd || 0).toFixed(2)),
      };
    }

    // ── MVRV Z-SCORE (from CryptoCompare daily) ───────────────
    let mvrvZScore = { value: 'N/A', interpretation: 'Data tidak tersedia', signal: 'NEUTRAL' };
    const klData = btcDailyRes.status === 'fulfilled' ? btcDailyRes.value : null;
    if (klData?.Response === 'Success' && klData.Data?.Data?.length >= 60) {
      const closes = klData.Data.Data.filter(d => d.close > 0).map(d => d.close);
      const cur = closes[closes.length - 1];
      const n   = Math.min(200, closes.length);
      const avg = closes.slice(-n).reduce((a, b) => a + b, 0) / n;
      const std = Math.sqrt(closes.slice(-n).reduce((s, v) => s + (v - avg) ** 2, 0) / n);
      const z   = std > 0 ? +((cur - avg) / std).toFixed(2) : 0;
      mvrvZScore = {
        value: z.toString(), estimate: z,
        interpretation: z > 7 ? '🔴 Sangat Overvalued — Jual kuat' : z > 3 ? '⚠️ Overvalued — Hati-hati' : z > -0.5 ? '⚖️ Fair Value' : z > -3 ? '🟢 Undervalued — Zona akumulasi' : '🔥 Extreme Undervalue — Beli kuat',
        signal: z > 5 ? 'SELL' : z > 2 ? 'CAUTION' : z < -2 ? 'BUY' : 'HOLD',
        note: `${n}-day z-score (CryptoCompare)`,
      };
    }

    // ── ALTCOIN SEASON ────────────────────────────────────────
    let altIdx = 0, altLabel = '₿ Bitcoin Season', altDetail = '';
    const tickers = tickerRes.status === 'fulfilled' ? tickerRes.value : null;
    if (Array.isArray(tickers) && tickers.length > 0) {
      const isBinance = tickers[0]?.lastPrice !== undefined;
      if (isBinance) {
        const tMap = {};
        tickers.forEach(t => { if (t?.symbol) tMap[t.symbol] = t; });
        const btcChg = +(tMap['BTCUSDT']?.priceChangePercent || 0);
        const ALTS = ['ETHUSDT','BNBUSDT','XRPUSDT','ADAUSDT','SOLUSDT','DOTUSDT','LINKUSDT','LTCUSDT','AVAXUSDT','ATOMUSDT','NEARUSDT','ARBUSDT','OPUSDT','MATICUSDT','UNIUSDT','SUIUSDT','INJUSDT','AAVEUSDT'];
        let out = 0, tot = 0;
        ALTS.forEach(s => { if (tMap[s]) { tot++; if (+(tMap[s].priceChangePercent || 0) > btcChg) out++; } });
        altIdx = tot > 0 ? Math.round(out / tot * 100) : 0;
        altDetail = `${out}/${tot} altcoin outperform BTC (24h)`;
      }
    }
    if      (altIdx >= 75) altLabel = '🚀 Altcoin Season';
    else if (altIdx >= 55) altLabel = '📈 Altcoin Trending';
    else if (altIdx >= 25) altLabel = '⚖️ Mixed Market';
    const altcoinSeason = { index: altIdx, season: altLabel, label: altLabel, detail: altDetail };

    // ── MARKET CYCLE ─────────────────────────────────────────
    const halvingDate = new Date('2024-04-20');
    const daysSinceHalving = Math.floor((Date.now() - halvingDate.getTime()) / 86400000);
    let cyclePhase, cycleDetail, cycleWarning = null;
    if      (daysSinceHalving < 90)  { cyclePhase = 'Post-Halving Early';     cycleDetail = `${daysSinceHalving} hari. Historis: sideways 2-3 bulan sebelum bull run.`; }
    else if (daysSinceHalving < 365) { cyclePhase = 'Bull Cycle Early ✅';    cycleDetail = `${daysSinceHalving} hari. Periode terbaik untuk beli dan hold.`; }
    else if (daysSinceHalving < 480) { cyclePhase = 'Bull Cycle Peak Zone ⚡'; cycleDetail = `${daysSinceHalving} hari. Zona puncak historis. Waspadai distribusi.`; cycleWarning = 'BTC sering puncak 12-18 bulan post-halving. Pertimbangkan profit-taking.'; }
    else if (daysSinceHalving < 730) { cyclePhase = 'Distribution / Late Bull ⚠️'; cycleDetail = `${daysSinceHalving} hari. Smart money cenderung exit bertahap.`; cycleWarning = 'Waspadai volatilitas tinggi dan "rally-and-dump".'; }
    else                             { cyclePhase = 'Bear Market / Accumulation'; cycleDetail = `${daysSinceHalving} hari. Fase akumulasi. Waktu DCA.`; }

    // ── MOON PHASE ────────────────────────────────────────────
    const jd  = Date.now() / 86400000 + 2440587.5;
    const dnm = ((jd - 2460320.5) % 29.53058867 + 29.53058867) % 29.53058867;
    let moonPhase, moonEmoji;
    if      (dnm < 1.5)  { moonPhase = 'New Moon';        moonEmoji = '🌑'; }
    else if (dnm < 7.5)  { moonPhase = 'Waxing Crescent'; moonEmoji = '🌒'; }
    else if (dnm < 8.5)  { moonPhase = 'First Quarter';   moonEmoji = '🌓'; }
    else if (dnm < 14)   { moonPhase = 'Waxing Gibbous';  moonEmoji = '🌔'; }
    else if (dnm < 16)   { moonPhase = 'Full Moon';        moonEmoji = '🌕'; }
    else if (dnm < 22)   { moonPhase = 'Waning';           moonEmoji = '🌖'; }
    else                 { moonPhase = 'Dark Moon';         moonEmoji = '🌘'; }

    // ── TOP GAINERS / LOSERS ──────────────────────────────────
    let topGainers = [], topLosers = [], volumeBreakout = [];
    if (Array.isArray(tickers) && tickers.length > 0 && tickers[0]?.lastPrice !== undefined) {
      const STABLES = new Set(['USDT','USDC','BUSD','TUSD','DAI','FDUSD']);
      const f = tickers.filter(t => t?.symbol?.endsWith('USDT') && +(t.quoteVolume || 0) > 1000000 && !STABLES.has(t.symbol.replace('USDT', '')));
      const s = [...f].sort((a, b) => +b.priceChangePercent - +a.priceChangePercent);
      const mp = t => ({ symbol: t.symbol.replace('USDT', ''), price: +(+t.lastPrice).toFixed(6), change: +(+t.priceChangePercent).toFixed(2), volume: Math.round(+t.quoteVolume) });
      topGainers    = s.slice(0, 10).map(mp);
      topLosers     = s.slice(-10).reverse().map(mp);
      volumeBreakout = [...f].filter(t => +(t.quoteVolume || 0) > 30000000).sort((a, b) => +b.quoteVolume - +a.quoteVolume).slice(0, 8)
        .map(t => ({ ...mp(t), signal: +t.priceChangePercent > 3 ? 'BULLISH_BREAKOUT' : +t.priceChangePercent < -3 ? 'BEARISH_BREAKDOWN' : 'HIGH_VOLUME' }));
    }

    // ── CYCLE SUMMARY ─────────────────────────────────────────
    const cycleSummary = [
      `F&G: ${fearGreed.value} (${fearGreed.classification}).`,
      `BTC Dom ${btcDom}% — ${btcDom > 55 ? 'BTC season' : 'Alt season trending'}.`,
      altIdx >= 75 ? 'Altcoin season aktif 🚀.' : altIdx < 25 ? 'Bitcoin season.' : 'Market mixed.',
      cycleDetail,
      mvrvZScore.value !== 'N/A' ? `MVRV Z: ${mvrvZScore.value}.` : '',
      cycleWarning ? `⚠️ ${cycleWarning}` : '',
    ].filter(Boolean).join(' ');

    return res.status(200).json({
      timestamp: Date.now(), version: 'v13',
      fearGreed, btcDominance, mvrvZScore, altcoinSeason, cycleSummary,
      dominance: { btc: btcDom, eth: ethDom },
      mvrv: mvrvZScore,
      cycle: { phase: cyclePhase, detail: cycleDetail, warning: cycleWarning, daysSinceHalving },
      marketSummary: cycleSummary,
      moonPhase: { phase: moonPhase, emoji: moonEmoji, daysSinceNM: +dnm.toFixed(1) },
      topGainers, topLosers, volumeBreakout,
    });
  } catch (e) {
    return res.status(200).json({
      timestamp: Date.now(), error: e.message, version: 'v13',
      fearGreed: { value: 50, classification: 'Neutral' },
      btcDominance: 58, mvrvZScore: { value: 'N/A', signal: 'NEUTRAL' },
      altcoinSeason: { index: 50, label: '⚖️ Mixed Market' },
      cycleSummary: 'Data sementara tidak tersedia.',
      dominance: { btc: 58, eth: 16 }, mvrv: { value: 'N/A' },
    });
  }
}
