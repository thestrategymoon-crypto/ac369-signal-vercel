// api/macro.js — AC369 FUSION v12.1
// FIX: CryptoCompare primary for MVRV BTC klines
// FIX: Halving cycle labels more accurate and helpful
// FIX: Moon phase included in response for index strip
// FIX: Clean narrative — no [Sumber: xxx] tags

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const sf = async (url, ms = 5000) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
      const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } });
      clearTimeout(t); if (!r.ok) return null; return await r.json();
    } catch { clearTimeout(t); return null; }
  };

  // ── BTC DAILY KLINES (for MVRV) ──────────────────────────────
  async function fetchBTCDaily() {
    const [ccR, fapiR, spotR, cgR] = await Promise.allSettled([
      sf('https://min-api.cryptocompare.com/data/v2/histoday?fsym=BTC&tsym=USD&limit=200', 5000),
      sf('https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=1d&limit=200', 5000),
      sf('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=200', 5000),
      sf('https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=90&interval=daily', 5000),
    ]);
    const cc=ccR.value, fapi=fapiR.value, spot=spotR.value, cg=cgR.value;
    if (cc?.Response === 'Success' && cc.Data?.Data?.length >= 60) return { data: cc.Data.Data.map(d => d.close).filter(v => v > 0), src: 'cryptocompare' };
    if (Array.isArray(fapi) && fapi.length >= 60) return { data: fapi.map(k => +k[4]).filter(v => v > 0), src: 'futures' };
    if (Array.isArray(spot) && spot.length >= 60) return { data: spot.map(k => +k[4]).filter(v => v > 0), src: 'spot' };
    if (cg?.prices?.length >= 30) return { data: cg.prices.map(p => p[1]).filter(v => v > 0), src: 'coingecko' };
    return null;
  }

  try {
    const [fngRes, globalRes, btcKlinesRes, tickerRes] = await Promise.allSettled([
      sf('https://api.alternative.me/fng/?limit=30&format=json'),
      sf('https://api.coingecko.com/api/v3/global'),
      fetchBTCDaily(),
      sf('https://api.binance.com/api/v3/ticker/24hr')
        .then(d => Array.isArray(d) && d.length > 100 ? d :
          sf('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&sparkline=false&price_change_percentage=24h')),
    ]);

    // ── FEAR & GREED ──────────────────────────────────────────
    let fearGreed = { value: 50, classification: 'Neutral', history: [], interpretation: 'Sentimen netral' };
    if (fngRes.status === 'fulfilled' && fngRes.value?.data) {
      const d = fngRes.value.data, v = parseInt(d[0].value);
      fearGreed = {
        value: v, classification: d[0].value_classification,
        history: d.slice(0, 7).map(x => ({ value: parseInt(x.value), label: x.value_classification, date: new Date(x.timestamp * 1000).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }) })),
        signal: v <= 20 ? 'EXTREME_FEAR_BUY' : v <= 40 ? 'FEAR_ACCUMULATE' : v <= 60 ? 'NEUTRAL' : v <= 80 ? 'GREED_CAUTION' : 'EXTREME_GREED_SELL',
        interpretation: v <= 20 ? 'Extreme Fear — zona akumulasi terbaik' : v <= 40 ? 'Fear — pertimbangkan akumulasi bertahap' : v <= 60 ? 'Netral — sentimen seimbang' : v <= 80 ? 'Greed — waspada koreksi' : 'Extreme Greed — distribusi smart money',
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
        dominance: btcDom.toFixed(2) + '%', value: btcDom,
        eth: ethDom.toFixed(2) + '%',
        interpretation: btcDom > 60 ? 'BTC Dominasi — kapital terkonsentrasi di BTC' : btcDom > 55 ? 'BTC Season — altcoin masih laggard' : btcDom > 50 ? 'Transisi — rotasi ke altcoin mulai' : btcDom > 45 ? 'Altcoin Season Awal' : 'Altcoin Season Aktif',
        totalMarketCap: gd.total_market_cap?.usd || 0,
        marketCapChange24h: +((gd.market_cap_change_percentage_24h_usd || 0).toFixed(2)),
      };
    }

    // ── MVRV Z-SCORE ──────────────────────────────────────────
    let mvrvZScore = { value: 'N/A', interpretation: 'Data tidak tersedia', signal: 'NEUTRAL' };
    const klData = btcKlinesRes.status === 'fulfilled' ? btcKlinesRes.value : null;
    if (klData?.data && klData.data.length >= 60) {
      const closes = klData.data;
      const cur = closes[closes.length - 1];
      const n = Math.min(200, closes.length);
      const avg = closes.slice(-n).reduce((a, b) => a + b, 0) / n;
      const std = Math.sqrt(closes.slice(-n).reduce((s, v) => s + (v - avg) ** 2, 0) / n);
      const z = std > 0 ? +((cur - avg) / std).toFixed(2) : 0;
      mvrvZScore = {
        value: z.toString(), estimate: z,
        interpretation: z > 7 ? '🔴 Sangat Overvalued — Jual kuat' : z > 3 ? '⚠️ Overvalued — Hati-hati distribusi' : z > -0.5 ? '⚖️ Fair Value — Harga wajar' : z > -3 ? '🟢 Undervalued — Zona akumulasi' : '🔥 Extreme Undervalue — Beli kuat',
        signal: z > 5 ? 'SELL' : z > 2 ? 'CAUTION' : z < -2 ? 'BUY' : 'HOLD',
        note: `${n}-day z-score (source: ${klData.src})`,
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
      } else {
        const btc = tickers.find(c => (c.symbol || '').toLowerCase() === 'btc');
        const btcChg = btc?.price_change_percentage_24h || 0;
        const alts = tickers.filter(c => (c.symbol || '').toLowerCase() !== 'btc');
        const out = alts.filter(c => (c.price_change_percentage_24h || 0) > btcChg).length;
        altIdx = alts.length > 0 ? Math.round(out / alts.length * 100) : 0;
        altDetail = `${out}/${alts.length} altcoin outperform BTC`;
      }
    }
    if (altIdx >= 75) altLabel = '🚀 Altcoin Season';
    else if (altIdx >= 55) altLabel = '📈 Altcoin Trending';
    else if (altIdx >= 25) altLabel = '⚖️ Mixed Market';
    const altcoinSeason = { index: altIdx, season: altLabel, label: altLabel, detail: altDetail };

    // ── MARKET CYCLE ──────────────────────────────────────────
    const halvingDate = new Date('2024-04-20');
    const now = new Date();
    const daysSinceHalving = Math.floor((now - halvingDate.getTime()) / 86400000);

    // More nuanced cycle labels based on actual market behavior
    let cyclePhase, cycleDetail, cycleWarning = null;
    if (daysSinceHalving < 90) {
      cyclePhase = 'Post-Halving Early';
      cycleDetail = `${daysSinceHalving} hari post-halving. Historis: sideways 2-3 bulan sebelum bull run dimulai.`;
    } else if (daysSinceHalving < 365) {
      cyclePhase = 'Bull Cycle Early ✅';
      cycleDetail = `${daysSinceHalving} hari. Bull cycle awal — historis periode terbaik untuk beli dan hold.`;
    } else if (daysSinceHalving < 480) {
      cyclePhase = 'Bull Cycle Peak Zone ⚡';
      cycleDetail = `${daysSinceHalving} hari. Zona puncak historis (12-16 bulan post-halving). Waspadai distribusi.`;
      cycleWarning = 'Historis: BTC sering puncak di 12-18 bulan post-halving. Pertimbangkan profit-taking.';
    } else if (daysSinceHalving < 730) {
      cyclePhase = 'Distribution / Late Bull ⚠️';
      cycleDetail = `${daysSinceHalving} hari. Fase distribusi historis. Smart money cenderung exit secara bertahap.`;
      cycleWarning = 'Waspadai volatilitas tinggi dan "rally-and-dump". Risiko manajemen penting.';
    } else {
      cyclePhase = 'Bear Market / Accumulation';
      cycleDetail = `${daysSinceHalving} hari. Fase akumulasi jangka panjang. Waktu DCA, bukan FOMO.`;
    }

    // ── MOON PHASE ────────────────────────────────────────────
    const jd = Date.now() / 86400000 + 2440587.5;
    const dnm = ((jd - 2460320.5) % 29.53058867 + 29.53058867) % 29.53058867;
    let moonPhase, moonEmoji;
    if (dnm < 1.5) { moonPhase = 'New Moon'; moonEmoji = '🌑'; }
    else if (dnm < 7.5) { moonPhase = 'Waxing Crescent'; moonEmoji = '🌒'; }
    else if (dnm < 8.5) { moonPhase = 'First Quarter'; moonEmoji = '🌓'; }
    else if (dnm < 14) { moonPhase = 'Waxing Gibbous'; moonEmoji = '🌔'; }
    else if (dnm < 16) { moonPhase = 'Full Moon'; moonEmoji = '🌕'; }
    else if (dnm < 22) { moonPhase = 'Waning'; moonEmoji = '🌖'; }
    else { moonPhase = 'Dark Moon'; moonEmoji = '🌘'; }

    // Mercury Retrograde
    const mrs = [
      { s: new Date('2025-03-15'), e: new Date('2025-04-07') },
      { s: new Date('2025-07-18'), e: new Date('2025-08-11') },
      { s: new Date('2025-11-09'), e: new Date('2025-12-01') },
      { s: new Date('2026-03-08'), e: new Date('2026-03-31') },
      { s: new Date('2026-07-06'), e: new Date('2026-07-30') },
      { s: new Date('2026-10-28'), e: new Date('2026-11-18') },
    ];
    const inMR = mrs.some(p => now >= p.s && now <= p.e);

    // ── TOP GAINERS / VOLUME ──────────────────────────────────
    let topGainers = [], topLosers = [], volumeBreakout = [];
    if (Array.isArray(tickers) && tickers.length > 0) {
      const isBinance = tickers[0]?.lastPrice !== undefined;
      if (isBinance) {
        const STABLES = new Set(['USDT', 'USDC', 'BUSD', 'TUSD', 'DAI', 'FDUSD']);
        const f = tickers.filter(t => t?.symbol?.endsWith('USDT') && +(t.quoteVolume || 0) > 1000000 && !STABLES.has(t.symbol.replace('USDT', '')));
        const s = [...f].sort((a, b) => +b.priceChangePercent - +a.priceChangePercent);
        const mp = t => ({ symbol: t.symbol.replace('USDT', ''), price: +(+t.lastPrice).toFixed(6), change: +(+t.priceChangePercent).toFixed(2), volume: Math.round(+t.quoteVolume) });
        topGainers = s.slice(0, 10).map(mp);
        topLosers = s.slice(-10).reverse().map(mp);
        volumeBreakout = [...f].filter(t => +(t.quoteVolume || 0) > 30000000).sort((a, b) => +b.quoteVolume - +a.quoteVolume).slice(0, 8)
          .map(t => ({ ...mp(t), signal: +t.priceChangePercent > 3 ? 'BULLISH_BREAKOUT' : +t.priceChangePercent < -3 ? 'BEARISH_BREAKDOWN' : 'HIGH_VOLUME' }));
      }
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

    res.setHeader('Cache-Control', 's-maxage=60');
    return res.status(200).json({
      timestamp: Date.now(),
      fearGreed, btcDominance, mvrvZScore, altcoinSeason, cycleSummary,
      dominance: { btc: btcDom, eth: ethDom },
      mvrv: mvrvZScore,
      cycle: { phase: cyclePhase, detail: cycleDetail, warning: cycleWarning, daysSinceHalving },
      marketSummary: cycleSummary,
      moonPhase: { phase: moonPhase, emoji: moonEmoji, daysSinceNM: +dnm.toFixed(1) },
      inMercuryRetrograde: inMR,
      topGainers, topLosers, volumeBreakout,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
