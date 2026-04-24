// api/macro.js — AC369 FUSION v10.4
// MULTI-SOURCE: alternative.me + CoinGecko + Binance + CoinCap fallback

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const ft = async (url, ms = 9000) => {
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
    const [fngRes, globalRes, btcKlinesRes, tickerRes, trendingRes] = await Promise.allSettled([
      ft('https://api.alternative.me/fng/?limit=30&format=json'),
      ft('https://api.coingecko.com/api/v3/global'),
      // Try futures first, then spot
      ft('https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=1d&limit=200')
        .then(d => Array.isArray(d) && d.length > 90 ? d : ft('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=200')),
      ft('https://api.binance.com/api/v3/ticker/24hr')
        .then(d => Array.isArray(d) && d.length > 100 ? d : ft('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&sparkline=false&price_change_percentage=24h')),
      ft('https://api.coingecko.com/api/v3/search/trending'),
    ]);

    // ── FEAR & GREED ─────────────────────────────────────────────
    let fearGreed = { value: 50, classification: 'Neutral', history: [], signal: 'NEUTRAL', interpretation: 'Sentimen netral' };
    if (fngRes.status === 'fulfilled' && fngRes.value?.data) {
      const d = fngRes.value.data, v = parseInt(d[0].value);
      fearGreed = {
        value: v, classification: d[0].value_classification,
        history: d.slice(0, 7).map(x => ({
          value: parseInt(x.value), label: x.value_classification,
          date: new Date(x.timestamp * 1000).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })
        })),
        trend: v > parseInt(d[6]?.value || d[0].value) ? 'INCREASING' : 'DECREASING',
        signal: v <= 20 ? 'EXTREME_FEAR_BUY' : v <= 40 ? 'FEAR_ACCUMULATE' : v <= 60 ? 'NEUTRAL' : v <= 80 ? 'GREED_CAUTION' : 'EXTREME_GREED_SELL',
        interpretation: v <= 20 ? 'Extreme Fear — zona akumulasi terbaik' : v <= 40 ? 'Fear — pertimbangkan akumulasi' : v <= 60 ? 'Netral — sentimen seimbang' : v <= 80 ? 'Greed — waspada koreksi' : 'Extreme Greed — distribusi mungkin dimulai',
      };
    }

    // ── BTC DOMINANCE ─────────────────────────────────────────────
    let btcDom = 58, ethDom = 12;
    let btcDominance = { dominance: '58.00%', value: 58, interpretation: 'BTC Season — kapital di BTC, altcoin laggard' };
    if (globalRes.status === 'fulfilled' && globalRes.value?.data) {
      const gd = globalRes.value.data;
      btcDom = parseFloat((gd.market_cap_percentage?.btc || 58).toFixed(2));
      ethDom = parseFloat((gd.market_cap_percentage?.eth || 12).toFixed(2));
      const interp = btcDom > 58 ? 'BTC Season — kapital di BTC, altcoin laggard' : btcDom > 50 ? 'Transisi BTC/altcoin — rotasi mulai' : btcDom > 42 ? 'Altcoin Season Mulai — altcoin outperform' : 'Altcoin Season Aktif — rotasi besar ke altcoin';
      btcDominance = {
        dominance: btcDom.toFixed(2) + '%', value: btcDom,
        eth: ethDom.toFixed(2) + '%', interpretation: interp,
        totalMarketCap: gd.total_market_cap?.usd || 0,
        totalVolume: gd.total_volume?.usd || 0,
        marketCapChange24h: parseFloat((gd.market_cap_change_percentage_24h_usd || 0).toFixed(2)),
      };
    }

    // ── ALTCOIN SEASON INDEX ──────────────────────────────────────
    let altIdx = 0, altLabel = '₿ Bitcoin Season', altDetail = '';
    const tickersData = tickerRes.status === 'fulfilled' ? tickerRes.value : null;

    if (Array.isArray(tickersData) && tickersData.length > 50) {
      // Binance format
      const tMap = {};
      tickersData.forEach(t => { if (t.symbol) tMap[t.symbol] = t; });
      const btcChg = parseFloat(tMap['BTCUSDT']?.priceChangePercent || 0);
      const ALTS = ['ETHUSDT', 'BNBUSDT', 'XRPUSDT', 'ADAUSDT', 'SOLUSDT', 'DOTUSDT', 'LINKUSDT', 'LTCUSDT', 'AVAXUSDT', 'ATOMUSDT', 'NEARUSDT', 'ARBUSDT', 'OPUSDT', 'MATICUSDT', 'UNIUSDT', 'SUIUSDT', 'INJUSDT', 'AAVEUSDT', 'MKRUSDT', 'APTUSDT'];
      let out = 0, tot = 0;
      ALTS.forEach(sym => { if (tMap[sym]) { tot++; if (parseFloat(tMap[sym].priceChangePercent) > btcChg) out++; } });
      altIdx = tot > 0 ? Math.round((out / tot) * 100) : 0;
      altDetail = `${out}/${tot} altcoin outperform BTC dalam 24h`;
    } else if (Array.isArray(tickersData) && tickersData.length > 0 && tickersData[0].price_change_percentage_24h !== undefined) {
      // CoinGecko format
      const btcCoin = tickersData.find(c => (c.symbol || '').toLowerCase() === 'btc');
      const btcChg = btcCoin?.price_change_percentage_24h || 0;
      const alts = tickersData.filter(c => (c.symbol || '').toLowerCase() !== 'btc' && (c.symbol || '').toLowerCase() !== 'usdt');
      const outperforming = alts.filter(c => (c.price_change_percentage_24h || 0) > btcChg).length;
      altIdx = alts.length > 0 ? Math.round((outperforming / alts.length) * 100) : 0;
      altDetail = `${outperforming}/${alts.length} altcoin outperform BTC (CoinGecko)`;
    }

    if (altIdx >= 75) altLabel = '🚀 Altcoin Season';
    else if (altIdx >= 55) altLabel = '📈 Altcoin Trending';
    else if (altIdx >= 25) altLabel = '⚖️ Mixed Market';

    const altcoinSeason = {
      index: altIdx, season: altLabel, label: altLabel, detail: altDetail,
      signal: altIdx >= 75 ? 'ALTCOIN' : altIdx < 25 ? 'BITCOIN' : 'MIXED',
    };

    // ── MVRV Z-SCORE ──────────────────────────────────────────────
    let mvrvZScore = { value: 'N/A', interpretation: 'Data tidak tersedia', signal: 'NEUTRAL' };
    const klinesData = btcKlinesRes.status === 'fulfilled' ? btcKlinesRes.value : null;
    if (Array.isArray(klinesData) && klinesData.length >= 90) {
      const closes = klinesData.map(k => parseFloat(k[4])).filter(v => !isNaN(v) && v > 0);
      if (closes.length >= 90) {
        const cur = closes[closes.length - 1];
        const n = Math.min(200, closes.length);
        const avg = closes.slice(-n).reduce((a, b) => a + b, 0) / n;
        const std = Math.sqrt(closes.slice(-n).reduce((s, v) => s + (v - avg) ** 2, 0) / n);
        const z = std > 0 ? parseFloat(((cur - avg) / std).toFixed(2)) : 0;
        const interp = z > 7 ? 'Sangat Overvalued — Zona jual kuat' : z > 3 ? 'Overvalued — Hati-hati distribusi' : z > -0.5 ? 'Fair Value — Harga wajar' : z > -3 ? 'Undervalued — Zona akumulasi' : 'Extreme Undervalue — Sinyal beli kuat';
        mvrvZScore = {
          value: z.toString(), estimate: z, interpretation: interp,
          signal: z > 5 ? 'SELL' : z > 2 ? 'CAUTION' : z < -2 ? 'BUY' : 'HOLD',
          note: `Proxy via ${n}-day price z-score`
        };
      }
    }

    // ── MARKET CYCLE ──────────────────────────────────────────────
    const halvingDate = new Date('2024-04-20');
    const daysSinceHalving = Math.floor((Date.now() - halvingDate.getTime()) / (1000 * 60 * 60 * 24));
    let cyclePhase, cycleDetail;
    if (daysSinceHalving < 90) { cyclePhase = 'POST-HALVING EARLY'; cycleDetail = `Awal post-halving (${daysSinceHalving}h). Historically sideways sebelum bull run.`; }
    else if (daysSinceHalving < 365) { cyclePhase = 'BULL RUN EARLY'; cycleDetail = `Bull cycle aktif (${daysSinceHalving} hari post-halving). BTC historis naik 200-400%.`; }
    else if (daysSinceHalving < 547) { cyclePhase = 'BULL RUN PEAK'; cycleDetail = `Bull cycle mature (${daysSinceHalving} hari). Peak biasanya 12-18 bulan post-halving.`; }
    else if (daysSinceHalving < 730) { cyclePhase = 'DISTRIBUTION'; cycleDetail = 'Fase distribusi — smart money mulai exit. Waspada volatilitas.'; }
    else { cyclePhase = 'BEAR MARKET'; cycleDetail = 'Bear market/akumulasi. Waktu terbaik untuk DCA jangka panjang.'; }

    // ── TOP GAINERS / LOSERS / VOLUME ─────────────────────────────
    let topGainers = [], topLosers = [], volumeBreakout = [];

    if (Array.isArray(tickersData) && tickersData.length > 0) {
      if (tickersData[0].lastPrice !== undefined) {
        // Binance format
        const STABLES = new Set(['USDT', 'USDC', 'BUSD', 'TUSD', 'DAI', 'FDUSD']);
        const f = tickersData.filter(t => t && t.symbol && t.symbol.endsWith('USDT') && parseFloat(t.quoteVolume || 0) > 1000000 && !STABLES.has(t.symbol.replace('USDT', '')));
        const s = [...f].sort((a, b) => parseFloat(b.priceChangePercent) - parseFloat(a.priceChangePercent));
        const mp = t => ({ symbol: t.symbol.replace('USDT', ''), price: parseFloat(parseFloat(t.lastPrice).toFixed(6)), change: parseFloat(parseFloat(t.priceChangePercent).toFixed(2)), volume: Math.round(parseFloat(t.quoteVolume)) });
        topGainers = s.slice(0, 10).map(mp);
        topLosers = s.slice(-10).reverse().map(mp);
        volumeBreakout = [...f].filter(t => parseFloat(t.quoteVolume) > 30000000).sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume)).slice(0, 8)
          .map(t => ({ ...mp(t), signal: parseFloat(t.priceChangePercent) > 3 ? 'BULLISH_BREAKOUT' : parseFloat(t.priceChangePercent) < -3 ? 'BEARISH_BREAKDOWN' : 'HIGH_VOLUME' }));
      } else if (tickersData[0].current_price !== undefined) {
        // CoinGecko format
        const s = [...tickersData].sort((a, b) => (b.price_change_percentage_24h || 0) - (a.price_change_percentage_24h || 0));
        const mp = c => ({ symbol: (c.symbol || '').toUpperCase(), price: parseFloat((c.current_price || 0).toFixed(6)), change: parseFloat((c.price_change_percentage_24h || 0).toFixed(2)), volume: Math.round(c.total_volume || 0) });
        topGainers = s.filter(c => (c.price_change_percentage_24h || 0) > 0).slice(0, 10).map(mp);
        topLosers = s.reverse().filter(c => (c.price_change_percentage_24h || 0) < 0).slice(0, 10).map(mp);
        volumeBreakout = tickersData.filter(c => (c.total_volume || 0) > 10000000).sort((a, b) => (b.total_volume || 0) - (a.total_volume || 0)).slice(0, 8)
          .map(c => ({ ...mp(c), signal: (c.price_change_percentage_24h || 0) > 3 ? 'BULLISH_BREAKOUT' : (c.price_change_percentage_24h || 0) < -3 ? 'BEARISH_BREAKDOWN' : 'HIGH_VOLUME' }));
      }
    }

    // ── TRENDING COINS ─────────────────────────────────────────────
    let trendingCoins = [];
    if (trendingRes.status === 'fulfilled' && trendingRes.value?.coins) {
      trendingCoins = trendingRes.value.coins.slice(0, 7).map(c => ({
        name: c.item.name, symbol: c.item.symbol,
        rank: c.item.market_cap_rank, score: c.item.score,
      }));
    }

    // ── CYCLE SUMMARY ─────────────────────────────────────────────
    const cycleSummary = [
      `F&G: ${fearGreed.value} (${fearGreed.classification}).`,
      `BTC Dominance ${btcDom}% — ${btcDom > 55 ? 'BTC season' : 'Menuju altcoin season'}.`,
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
      topGainers, topLosers, volumeBreakout, trendingCoins,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
