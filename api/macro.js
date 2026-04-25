// api/macro.js — AC369 FUSION v10.6 FINAL
// Returns: fearGreed, btcDominance, mvrvZScore, altcoinSeason, cycleSummary

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const sf = async (url, ms = 9000) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
      const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } });
      clearTimeout(t); if (!r.ok) return null;
      return await r.json();
    } catch { clearTimeout(t); return null; }
  };

  try {
    // Parallel fetch — use Promise.allSettled to never fail completely
    const [fngRes, globalRes, btcKlines, tickerRes] = await Promise.allSettled([
      sf('https://api.alternative.me/fng/?limit=30&format=json'),
      sf('https://api.coingecko.com/api/v3/global'),
      // Try Futures first, then Spot for BTC klines (limit=200 for MVRV)
      sf('https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=1d&limit=200')
        .then(d => Array.isArray(d) && d.length > 90 ? d :
          sf('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=200')),
      // Spot tickers first, then CoinGecko
      sf('https://api.binance.com/api/v3/ticker/24hr')
        .then(d => Array.isArray(d) && d.length > 100 ? d :
          sf('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&sparkline=false')),
    ]);

    // ── FEAR & GREED ──────────────────────────────────────────────
    let fearGreed = { value: 50, classification: 'Neutral', history: [], signal: 'NEUTRAL', interpretation: 'Sentimen netral' };
    if (fngRes.status === 'fulfilled' && fngRes.value?.data) {
      const d = fngRes.value.data, v = parseInt(d[0].value);
      fearGreed = {
        value: v, classification: d[0].value_classification,
        history: d.slice(0, 7).map(x => ({ value: parseInt(x.value), label: x.value_classification, date: new Date(x.timestamp * 1000).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }) })),
        trend: v > parseInt(d[6]?.value || v) ? 'INCREASING' : 'DECREASING',
        signal: v <= 20 ? 'EXTREME_FEAR_BUY' : v <= 40 ? 'FEAR_ACCUMULATE' : v <= 60 ? 'NEUTRAL' : v <= 80 ? 'GREED_CAUTION' : 'EXTREME_GREED_SELL',
        interpretation: v <= 20 ? 'Extreme Fear — zona akumulasi terbaik' : v <= 40 ? 'Fear — pertimbangkan akumulasi bertahap' : v <= 60 ? 'Netral — sentimen seimbang' : v <= 80 ? 'Greed — waspada koreksi' : 'Extreme Greed — distribusi smart money mungkin dimulai',
      };
    }

    // ── BTC DOMINANCE ─────────────────────────────────────────────
    let btcDom = 58, ethDom = 12;
    let btcDominance = { dominance: '58.00%', value: 58, interpretation: 'BTC Season — kapital di BTC, altcoin laggard' };
    if (globalRes.status === 'fulfilled' && globalRes.value?.data) {
      const gd = globalRes.value.data;
      btcDom = +((gd.market_cap_percentage?.btc || 58).toFixed(2));
      ethDom = +((gd.market_cap_percentage?.eth || 12).toFixed(2));
      btcDominance = {
        dominance: btcDom.toFixed(2) + '%', value: btcDom,
        eth: ethDom.toFixed(2) + '%',
        interpretation: btcDom > 58 ? 'BTC Season — kapital di BTC, altcoin laggard' : btcDom > 50 ? 'Transisi — rotasi ke altcoin mulai' : btcDom > 42 ? 'Altcoin Season Mulai' : 'Altcoin Season Aktif',
        totalMarketCap: gd.total_market_cap?.usd || 0,
        totalVolume: gd.total_volume?.usd || 0,
        marketCapChange24h: +((gd.market_cap_change_percentage_24h_usd || 0).toFixed(2)),
      };
    }

    // ── ALTCOIN SEASON ────────────────────────────────────────────
    let altIdx = 0, altLabel = '₿ Bitcoin Season', altDetail = '';
    const tickers = tickerRes.status === 'fulfilled' ? tickerRes.value : null;

    if (Array.isArray(tickers) && tickers.length > 0) {
      // Detect format
      const isBinance = tickers[0]?.lastPrice !== undefined;
      if (isBinance) {
        const tMap = {};
        tickers.forEach(t => { if (t.symbol) tMap[t.symbol] = t; });
        const btcChg = +(tMap['BTCUSDT']?.priceChangePercent || 0);
        const ALTS = ['ETHUSDT','BNBUSDT','XRPUSDT','ADAUSDT','SOLUSDT','DOTUSDT','LINKUSDT','LTCUSDT','AVAXUSDT','ATOMUSDT','NEARUSDT','ARBUSDT','OPUSDT','MATICUSDT','UNIUSDT','SUIUSDT','INJUSDT','AAVEUSDT'];
        let out = 0, tot = 0;
        ALTS.forEach(s => { if (tMap[s]) { tot++; if (+tMap[s].priceChangePercent > btcChg) out++; } });
        altIdx = tot > 0 ? Math.round(out / tot * 100) : 0;
        altDetail = `${out}/${tot} altcoin outperform BTC (24h)`;
      } else {
        // CoinGecko format
        const btcCoin = tickers.find(c => (c.symbol || '').toLowerCase() === 'btc');
        const btcChg = btcCoin?.price_change_percentage_24h || 0;
        const alts = tickers.filter(c => (c.symbol || '').toLowerCase() !== 'btc');
        const out = alts.filter(c => (c.price_change_percentage_24h || 0) > btcChg).length;
        altIdx = alts.length > 0 ? Math.round(out / alts.length * 100) : 0;
        altDetail = `${out}/${alts.length} altcoin outperform BTC (CoinGecko)`;
      }
    }
    if (altIdx >= 75) altLabel = '🚀 Altcoin Season';
    else if (altIdx >= 55) altLabel = '📈 Altcoin Trending';
    else if (altIdx >= 25) altLabel = '⚖️ Mixed Market';
    const altcoinSeason = { index: altIdx, season: altLabel, label: altLabel, detail: altDetail, signal: altIdx >= 75 ? 'ALTCOIN' : altIdx < 25 ? 'BITCOIN' : 'MIXED' };

    // ── MVRV Z-SCORE ──────────────────────────────────────────────
    let mvrvZScore = { value: 'N/A', interpretation: 'Data tidak tersedia', signal: 'NEUTRAL' };
    const klinesData = btcKlines.status === 'fulfilled' ? btcKlines.value : null;
    if (Array.isArray(klinesData) && klinesData.length >= 90) {
      const closes = klinesData.map(k => +k[4]).filter(v => !isNaN(v) && v > 0);
      if (closes.length >= 90) {
        const cur = closes[closes.length - 1];
        const n = Math.min(200, closes.length);
        const avg = closes.slice(-n).reduce((a, b) => a + b, 0) / n;
        const std = Math.sqrt(closes.slice(-n).reduce((s, v) => s + (v - avg) ** 2, 0) / n);
        const z = std > 0 ? +((cur - avg) / std).toFixed(2) : 0;
        mvrvZScore = {
          value: z.toString(), estimate: z,
          interpretation: z > 7 ? 'Sangat Overvalued — Jual kuat' : z > 3 ? 'Overvalued — Hati-hati' : z > -0.5 ? 'Fair Value' : z > -3 ? 'Undervalued — Akumulasi' : 'Extreme Undervalue — Beli kuat',
          signal: z > 5 ? 'SELL' : z > 2 ? 'CAUTION' : z < -2 ? 'BUY' : 'HOLD',
          note: `${n}-day price z-score proxy`,
        };
      }
    }

    // ── MARKET CYCLE ─────────────────────────────────────────────
    const halvingDate = new Date('2024-04-20');
    const daysSinceHalving = Math.floor((Date.now() - halvingDate.getTime()) / 86400000);
    let cyclePhase, cycleDetail;
    if (daysSinceHalving < 90) { cyclePhase = 'POST-HALVING EARLY'; cycleDetail = `Awal post-halving (${daysSinceHalving}h).`; }
    else if (daysSinceHalving < 365) { cyclePhase = 'BULL RUN EARLY'; cycleDetail = `Bull cycle aktif — ${daysSinceHalving} hari post-halving.`; }
    else if (daysSinceHalving < 547) { cyclePhase = 'BULL RUN PEAK'; cycleDetail = `Bull cycle mature — ${daysSinceHalving} hari.`; }
    else if (daysSinceHalving < 730) { cyclePhase = 'DISTRIBUTION'; cycleDetail = 'Fase distribusi — smart money exit.'; }
    else { cyclePhase = 'BEAR MARKET'; cycleDetail = 'Bear market/akumulasi. Waktu terbaik DCA.'; }

    // Top gainers/losers from ticker data
    let topGainers = [], topLosers = [], volumeBreakout = [];
    if (Array.isArray(tickers) && tickers.length > 0) {
      const isBinance = tickers[0]?.lastPrice !== undefined;
      if (isBinance) {
        const STABLES = new Set(['USDT', 'USDC', 'BUSD', 'TUSD', 'DAI', 'FDUSD']);
        const f = tickers.filter(t => t?.symbol?.endsWith('USDT') && +t.quoteVolume > 1000000 && !STABLES.has(t.symbol.replace('USDT', '')));
        const s = [...f].sort((a, b) => +b.priceChangePercent - +a.priceChangePercent);
        const mp = t => ({ symbol: t.symbol.replace('USDT', ''), price: +(+t.lastPrice).toFixed(6), change: +(+t.priceChangePercent).toFixed(2), volume: Math.round(+t.quoteVolume) });
        topGainers = s.slice(0, 10).map(mp);
        topLosers = s.slice(-10).reverse().map(mp);
        volumeBreakout = [...f].filter(t => +t.quoteVolume > 30000000).sort((a, b) => +b.quoteVolume - +a.quoteVolume).slice(0, 8)
          .map(t => ({ ...mp(t), signal: +t.priceChangePercent > 3 ? 'BULLISH_BREAKOUT' : +t.priceChangePercent < -3 ? 'BEARISH_BREAKDOWN' : 'HIGH_VOLUME' }));
      }
    }

    const cycleSummary = [
      `F&G: ${fearGreed.value} (${fearGreed.classification}).`,
      `BTC Dom ${btcDom}% — ${btcDom > 55 ? 'BTC season' : 'Alt season trending'}.`,
      altIdx >= 75 ? 'Altcoin season aktif.' : altIdx < 25 ? 'Bitcoin season.' : 'Market mixed.',
      cycleDetail,
    ].join(' ');

    res.setHeader('Cache-Control', 's-maxage=60');
    return res.status(200).json({
      timestamp: Date.now(),
      fearGreed, btcDominance, mvrvZScore, altcoinSeason, cycleSummary,
      dominance: { btc: btcDom, eth: ethDom },
      mvrv: mvrvZScore,
      cycle: { phase: cyclePhase, detail: cycleDetail, daysSinceHalving },
      marketSummary: cycleSummary,
      topGainers, topLosers, volumeBreakout,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
