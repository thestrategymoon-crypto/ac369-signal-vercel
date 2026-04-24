// api/macro.js — AC369 FUSION v10.2
// FIXED: Response fields sesuai index.html:
//   data.fearGreed.value, data.fearGreed.classification
//   data.btcDominance.dominance, data.btcDominance.interpretation
//   data.mvrvZScore.value, data.mvrvZScore.interpretation
//   data.altcoinSeason.index, data.altcoinSeason.season
//   data.cycleSummary

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const [fngRes, globalRes, btcKlinesRes, altcoinPerfsRes, trendingRes] = await Promise.allSettled([
      fetch('https://api.alternative.me/fng/?limit=30&format=json', { signal: AbortSignal.timeout(8000) }).then(r => r.json()),
      fetch('https://api.coingecko.com/api/v3/global', { headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(10000) }).then(r => r.json()),
      fetch('https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=1d&limit=200', { signal: AbortSignal.timeout(10000) }).then(r => r.json()),
      fetch('https://api.binance.com/api/v3/ticker/24hr', { signal: AbortSignal.timeout(12000) }).then(r => r.json()),
      fetch('https://api.coingecko.com/api/v3/search/trending', { headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(10000) }).then(r => r.json()),
    ]);

    // ── FEAR & GREED ─────────────────────────────────────────────
    let fearGreed = { value: 50, classification: 'Neutral', history: [], trend: 'STABLE', signal: 'NEUTRAL' };
    if (fngRes.status === 'fulfilled' && fngRes.value.data) {
      const data = fngRes.value.data;
      const val = parseInt(data[0].value);
      fearGreed = {
        value: val,
        classification: data[0].value_classification,
        history: data.slice(0, 7).map(d => ({
          value: parseInt(d.value),
          label: d.value_classification,
          date: new Date(d.timestamp * 1000).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }),
        })),
        trend: parseInt(data[0].value) > parseInt(data[6]?.value || data[0].value) ? 'INCREASING' : 'DECREASING',
        signal: val <= 20 ? 'EXTREME_FEAR_BUY' : val <= 40 ? 'FEAR_ACCUMULATE' : val <= 60 ? 'NEUTRAL' : val <= 80 ? 'GREED_CAUTION' : 'EXTREME_GREED_SELL',
        interpretation: val <= 20 ? 'Extreme Fear — zona akumulasi terbaik historis' : val <= 40 ? 'Fear — pertimbangkan akumulasi bertahap' : val <= 60 ? 'Netral — sentimen seimbang' : val <= 80 ? 'Greed — waspada koreksi' : 'Extreme Greed — distribusi mungkin dimulai',
      };
    }

    // ── BTC DOMINANCE ────────────────────────────────────────────
    let btcDom = 58, ethDom = 12, btcGlobalData = null;
    let btcDominanceObj = { dominance: '58.00%', interpretation: 'BTC Season', value: 58 };

    if (globalRes.status === 'fulfilled' && globalRes.value.data) {
      const gd = globalRes.value.data;
      btcDom = parseFloat((gd.market_cap_percentage?.btc || 58).toFixed(2));
      ethDom = parseFloat((gd.market_cap_percentage?.eth || 12).toFixed(2));
      btcGlobalData = gd;

      const domInterp = btcDom > 58 ? 'BTC Season — kapital di BTC, altcoin laggard' : btcDom > 50 ? 'BTC Dominan — transisi menuju altcoin season' : btcDom > 42 ? 'Altcoin Season Mulai — rotasi ke altcoin' : 'Altcoin Season — altcoin outperform BTC';
      btcDominanceObj = {
        dominance: btcDom.toFixed(2) + '%',
        value: btcDom,
        eth: ethDom.toFixed(2) + '%',
        interpretation: domInterp,
        totalMarketCap: gd.total_market_cap?.usd || 0,
        totalVolume: gd.total_volume?.usd || 0,
        marketCapChange24h: parseFloat((gd.market_cap_change_percentage_24h_usd || 0).toFixed(2)),
      };
    }

    // ── ALTCOIN SEASON INDEX ──────────────────────────────────────
    let altSeasonIndex = 0;
    let altSeasonLabel = '₿ Bitcoin Season';
    let altSeasonDetail = '';

    if (altcoinPerfsRes.status === 'fulfilled' && Array.isArray(altcoinPerfsRes.value)) {
      const tickerMap = {};
      altcoinPerfsRes.value.forEach(t => { tickerMap[t.symbol] = t; });

      const btcChange = parseFloat(tickerMap['BTCUSDT']?.priceChangePercent || 0);
      const TOP_ALTS = ['ETHUSDT', 'BNBUSDT', 'XRPUSDT', 'ADAUSDT', 'SOLUSDT', 'DOTUSDT', 'LINKUSDT', 'LTCUSDT', 'AVAXUSDT', 'ATOMUSDT', 'NEARUSDT', 'ARBUSDT', 'OPUSDT', 'MATICUSDT', 'UNIUSDT', 'SUIUSDT', 'INJUSDT', 'AAVEUSDT', 'MKRUSDT', 'APTUSDT'];

      let outperforming = 0, total = 0;
      TOP_ALTS.forEach(sym => {
        if (tickerMap[sym]) {
          total++;
          if (parseFloat(tickerMap[sym].priceChangePercent) > btcChange) outperforming++;
        }
      });

      altSeasonIndex = total > 0 ? Math.round((outperforming / total) * 100) : 0;
      altSeasonDetail = `${outperforming}/${total} altcoin outperform BTC dalam 24h`;
    }

    if (altSeasonIndex >= 75) altSeasonLabel = '🚀 Altcoin Season';
    else if (altSeasonIndex >= 55) altSeasonLabel = '📈 Altcoin Trending';
    else if (altSeasonIndex >= 25) altSeasonLabel = '⚖️ Mixed Market';
    else altSeasonLabel = '₿ Bitcoin Season';

    const altcoinSeasonObj = {
      index: altSeasonIndex,
      season: altSeasonLabel,
      label: altSeasonLabel,
      detail: altSeasonDetail,
      signal: altSeasonIndex >= 75 ? 'ALTCOIN' : altSeasonIndex < 25 ? 'BITCOIN' : 'MIXED',
    };

    // ── MVRV Z-SCORE (price z-score proxy) ───────────────────────
    let mvrvObj = { value: 'N/A', interpretation: 'Data tidak tersedia', signal: 'NEUTRAL' };

    if (btcKlinesRes.status === 'fulfilled' && Array.isArray(btcKlinesRes.value) && btcKlinesRes.value.length >= 90) {
      const closes = btcKlinesRes.value.map(k => parseFloat(k[4]));
      const current = closes[closes.length - 1];
      const avg = closes.slice(-90).reduce((a, b) => a + b, 0) / 90;
      const std = Math.sqrt(closes.slice(-90).reduce((s, v) => s + (v - avg) ** 2, 0) / 90);
      const zScore = std > 0 ? parseFloat(((current - avg) / std).toFixed(2)) : 0;

      const interp = zScore > 7 ? 'Sangat Overvalued — Zona jual kuat' : zScore > 3 ? 'Overvalued — Hati-hati distribusi' : zScore > -0.5 ? 'Fair Value — Harga wajar' : zScore > -3 ? 'Undervalued — Zona akumulasi' : 'Extreme Undervalue — Beli kuat';
      const sig = zScore > 5 ? 'SELL' : zScore > 2 ? 'CAUTION' : zScore < -2 ? 'BUY' : 'HOLD';

      mvrvObj = {
        value: zScore.toString(),
        estimate: zScore,
        interpretation: interp,
        signal: sig,
        note: 'Proxy via 90-day price z-score',
      };
    }

    // ── MARKET CYCLE PHASE ────────────────────────────────────────
    const halvingDate = new Date('2024-04-20');
    const daysSinceHalving = Math.floor((Date.now() - halvingDate.getTime()) / (1000 * 60 * 60 * 24));
    let cyclePhase, cycleDetail;

    if (daysSinceHalving < 90) { cyclePhase = 'POST-HALVING EARLY'; cycleDetail = `Awal post-halving (${daysSinceHalving}h). Historically sideways sebelum bull run.`; }
    else if (daysSinceHalving < 365) { cyclePhase = 'BULL RUN EARLY'; cycleDetail = `Bull cycle aktif (${daysSinceHalving} hari post-halving). BTC historis naik 200-400%.`; }
    else if (daysSinceHalving < 547) { cyclePhase = 'BULL RUN PEAK'; cycleDetail = `Bull cycle mature (${daysSinceHalving} hari). Peak biasanya 12-18 bulan post-halving.`; }
    else if (daysSinceHalving < 730) { cyclePhase = 'DISTRIBUTION'; cycleDetail = 'Fase distribusi — smart money mulai exit. Waspada volatilitas.'; }
    else { cyclePhase = 'BEAR MARKET'; cycleDetail = 'Bear market/akumulasi. Waktu terbaik untuk DCA jangka panjang.'; }

    // ── TOP GAINERS / LOSERS / VOLUME BREAKOUT ────────────────────
    let topGainers = [], topLosers = [], volumeBreakout = [];

    if (altcoinPerfsRes.status === 'fulfilled' && Array.isArray(altcoinPerfsRes.value)) {
      const STABLES = new Set(['USDT', 'USDC', 'BUSD', 'TUSD', 'DAI', 'FDUSD']);
      const filtered = altcoinPerfsRes.value.filter(t =>
        t.symbol.endsWith('USDT') &&
        parseFloat(t.quoteVolume) > 5000000 &&
        !STABLES.has(t.symbol.replace('USDT', '')) &&
        !['USDTUSDT', 'BUSDUSDT', 'USDCUSDT', 'TUSDUSDT'].includes(t.symbol)
      );

      const sorted = [...filtered].sort((a, b) => parseFloat(b.priceChangePercent) - parseFloat(a.priceChangePercent));

      topGainers = sorted.slice(0, 10).map(t => ({
        symbol: t.symbol.replace('USDT', ''),
        price: parseFloat(parseFloat(t.lastPrice).toFixed(6)),
        change: parseFloat(parseFloat(t.priceChangePercent).toFixed(2)),
        volume: Math.round(parseFloat(t.quoteVolume)),
      }));

      topLosers = sorted.slice(-10).reverse().map(t => ({
        symbol: t.symbol.replace('USDT', ''),
        price: parseFloat(parseFloat(t.lastPrice).toFixed(6)),
        change: parseFloat(parseFloat(t.priceChangePercent).toFixed(2)),
        volume: Math.round(parseFloat(t.quoteVolume)),
      }));

      volumeBreakout = [...filtered]
        .filter(t => parseFloat(t.quoteVolume) > 50000000)
        .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
        .slice(0, 8)
        .map(t => ({
          symbol: t.symbol.replace('USDT', ''),
          price: parseFloat(parseFloat(t.lastPrice).toFixed(6)),
          change: parseFloat(parseFloat(t.priceChangePercent).toFixed(2)),
          volume: Math.round(parseFloat(t.quoteVolume)),
          signal: parseFloat(t.priceChangePercent) > 3 ? 'BULLISH_BREAKOUT' : parseFloat(t.priceChangePercent) < -3 ? 'BEARISH_BREAKDOWN' : 'HIGH_VOLUME',
        }));
    }

    // ── TRENDING ─────────────────────────────────────────────────
    let trendingCoins = [];
    if (trendingRes.status === 'fulfilled' && trendingRes.value.coins) {
      trendingCoins = trendingRes.value.coins.slice(0, 7).map(c => ({
        name: c.item.name,
        symbol: c.item.symbol,
        rank: c.item.market_cap_rank,
        score: c.item.score,
      }));
    }

    // ── CYCLE SUMMARY ────────────────────────────────────────────
    const cycleSummary = [
      `F&G: ${fearGreed.value} (${fearGreed.classification}).`,
      `BTC Dominance ${btcDom}% — ${btcDom > 55 ? 'BTC season' : 'Menuju altcoin season'}.`,
      altSeasonIndex >= 75 ? 'Altcoin season aktif.' : altSeasonIndex < 25 ? 'Bitcoin season.' : 'Market mixed.',
      cycleDetail,
    ].join(' ');

    // ── RESPONSE ─────────────────────────────────────────────────
    res.setHeader('Cache-Control', 's-maxage=60');
    return res.status(200).json({
      timestamp: Date.now(),

      // Fields sesuai index.html
      fearGreed,
      btcDominance: btcDominanceObj,
      mvrvZScore: mvrvObj,
      altcoinSeason: altcoinSeasonObj,
      cycleSummary,

      // Extra fields
      dominance: {
        btc: btcDom,
        eth: ethDom,
      },
      mvrv: mvrvObj,
      cycle: { phase: cyclePhase, detail: cycleDetail, daysSinceHalving },
      marketSummary: cycleSummary,
      topGainers,
      topLosers,
      volumeBreakout,
      trendingCoins,
    });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
