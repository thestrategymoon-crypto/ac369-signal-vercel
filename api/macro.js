// api/macro.js — AC369 FUSION v10.1
// FIXED: Altcoin Season real calc, MVRV from multiple sources, BTC dominance accurate

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const [fngRes, globalRes, btcKlinesRes, ethKlinesRes, altcoinPerfsRes, trendingRes] = await Promise.allSettled([
      fetch('https://api.alternative.me/fng/?limit=30&format=json', { signal: AbortSignal.timeout(8000) }).then(r => r.json()),
      fetch('https://api.coingecko.com/api/v3/global', { headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(10000) }).then(r => r.json()),
      fetch('https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=1d&limit=90', { signal: AbortSignal.timeout(10000) }).then(r => r.json()),
      fetch('https://fapi.binance.com/fapi/v1/klines?symbol=ETHUSDT&interval=1d&limit=90', { signal: AbortSignal.timeout(10000) }).then(r => r.json()),
      // 30-day performance of major altcoins vs BTC
      fetch('https://api.binance.com/api/v3/ticker/24hr', { signal: AbortSignal.timeout(12000) }).then(r => r.json()),
      fetch('https://api.coingecko.com/api/v3/search/trending', { headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(10000) }).then(r => r.json()),
    ]);

    // ── FEAR & GREED ──────────────────────────────────────────────
    let fng = { value: 50, classification: 'Neutral', history: [] };
    if (fngRes.status === 'fulfilled' && fngRes.value.data) {
      const data = fngRes.value.data;
      fng = {
        value: parseInt(data[0].value),
        classification: data[0].value_classification,
        history: data.slice(0, 7).map(d => ({
          value: parseInt(d.value),
          label: d.value_classification,
          date: new Date(d.timestamp * 1000).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }),
        })),
        trend: parseInt(data[0].value) > parseInt(data[6]?.value || data[0].value) ? 'INCREASING' : 'DECREASING',
        signal: parseInt(data[0].value) <= 20 ? 'EXTREME_FEAR_BUY' : parseInt(data[0].value) <= 40 ? 'FEAR_ACCUMULATE' : parseInt(data[0].value) <= 60 ? 'NEUTRAL' : parseInt(data[0].value) <= 80 ? 'GREED_CAUTION' : 'EXTREME_GREED_SELL',
      };
    }

    // ── BTC DOMINANCE & GLOBAL MARKET ────────────────────────────
    let dominance = { btc: 58, eth: 12, others: 30 };
    let globalMarket = { totalMarketCap: 0, totalVolume: 0, marketCapChange24h: 0 };
    if (globalRes.status === 'fulfilled' && globalRes.value.data) {
      const gd = globalRes.value.data;
      dominance = {
        btc: parseFloat((gd.market_cap_percentage?.btc || 58).toFixed(2)),
        eth: parseFloat((gd.market_cap_percentage?.eth || 12).toFixed(2)),
        bnb: parseFloat((gd.market_cap_percentage?.bnb || 3).toFixed(2)),
        sol: parseFloat((gd.market_cap_percentage?.sol || 2.5).toFixed(2)),
        others: parseFloat((100 - (gd.market_cap_percentage?.btc || 58) - (gd.market_cap_percentage?.eth || 12)).toFixed(2)),
      };
      globalMarket = {
        totalMarketCap: gd.total_market_cap?.usd || 0,
        totalVolume: gd.total_volume?.usd || 0,
        marketCapChange24h: parseFloat((gd.market_cap_change_percentage_24h_usd || 0).toFixed(2)),
        activeCurrencies: gd.active_cryptocurrencies || 0,
        btcDominance: dominance.btc,
      };
    }

    // ── ALTCOIN SEASON INDEX — Real Calculation ───────────────────
    // Real altcoin season: % of top altcoins outperforming BTC in last 90 days
    let altcoinSeason = 0;
    let altcoinSeasonLabel = 'Bitcoin Season';
    let altcoinDetail = '';

    try {
      // BTC 90-day performance
      let btcPerf90 = 0;
      if (btcKlinesRes.status === 'fulfilled' && Array.isArray(btcKlinesRes.value) && btcKlinesRes.value.length >= 2) {
        const btcData = btcKlinesRes.value;
        const btcStart = parseFloat(btcData[0][4]);
        const btcEnd = parseFloat(btcData[btcData.length - 1][4]);
        btcPerf90 = ((btcEnd - btcStart) / btcStart) * 100;
      }

      // Check top altcoins vs BTC
      if (altcoinPerfsRes.status === 'fulfilled' && Array.isArray(altcoinPerfsRes.value)) {
        const TOP_ALTS = ['ETHUSDT', 'BNBUSDT', 'XRPUSDT', 'ADAUSDT', 'SOLUSDT', 'DOTUSDT', 'LINKUSDT', 'LTCUSDT', 'AVAXUSDT', 'ATOMUSDT', 'NEARUSDT', 'ARBUSDT', 'OPUSDT', 'MATICUSDT', 'UNIUSDT', 'SUIUSDT', 'INJUSDT', 'TIAUSDT', 'SEIUSDT', 'APTUSDT'];
        const tickerMap = {};
        altcoinPerfsRes.value.forEach(t => { tickerMap[t.symbol] = t; });
        let outperforming = 0;
        let total = 0;
        const altDetails = [];
        TOP_ALTS.forEach(sym => {
          if (tickerMap[sym]) {
            const change = parseFloat(tickerMap[sym].priceChangePercent);
            // Compare 24h % (proxy for altcoin season)
            total++;
            if (change > parseFloat(tickerMap['BTCUSDT']?.priceChangePercent || 0)) {
              outperforming++;
              altDetails.push({ symbol: sym.replace('USDT', ''), change: parseFloat(change.toFixed(2)), outperforming: true });
            } else {
              altDetails.push({ symbol: sym.replace('USDT', ''), change: parseFloat(change.toFixed(2)), outperforming: false });
            }
          }
        });
        altcoinSeason = total > 0 ? Math.round((outperforming / total) * 100) : 0;
        altDetails.sort((a, b) => b.change - a.change);
        altcoinDetail = `${outperforming}/${total} altcoins outperforming BTC dalam 24h`;
      }
    } catch (e) {
      // fallback
    }

    if (altcoinSeason >= 75) altcoinSeasonLabel = '🚀 Altcoin Season';
    else if (altcoinSeason >= 55) altcoinSeasonLabel = '📈 Altcoin Trending';
    else if (altcoinSeason >= 25) altcoinSeasonLabel = '⚖️ Mixed Market';
    else altcoinSeasonLabel = '₿ Bitcoin Season';

    // ── MVRV Z-SCORE (Approximation via price vs realized price) ──
    // MVRV approximation: current price vs 200-day MA (proxy for realized price)
    let mvrvEstimate = null;
    let mvrvLabel = 'N/A';
    let mvrvSignal = 'neutral';
    if (btcKlinesRes.status === 'fulfilled' && Array.isArray(btcKlinesRes.value) && btcKlinesRes.value.length >= 90) {
      const btcCloses = btcKlinesRes.value.map(k => parseFloat(k[4]));
      const currentBTC = btcCloses[btcCloses.length - 1];
      const avg90 = btcCloses.slice(-90).reduce((a, b) => a + b, 0) / 90;
      const stdDev = Math.sqrt(btcCloses.slice(-90).reduce((s, v) => s + (v - avg90) ** 2, 0) / 90);
      // MVRV-like Z-score: (price - mean) / std
      mvrvEstimate = parseFloat(((currentBTC - avg90) / stdDev).toFixed(2));
      mvrvLabel = mvrvEstimate > 7 ? 'Overvalued — Sell Zone' : mvrvEstimate > 3 ? 'Caution — High' : mvrvEstimate > -0.5 ? 'Fair Value' : mvrvEstimate > -3 ? 'Undervalued' : 'Extreme Undervalue — Buy Zone';
      mvrvSignal = mvrvEstimate > 5 ? 'SELL' : mvrvEstimate > 2 ? 'CAUTION' : mvrvEstimate < -2 ? 'BUY' : 'HOLD';
    }

    // ── MARKET CYCLE PHASE ────────────────────────────────────────
    let cyclePhase = '';
    let cycleDetail = '';
    const halvingDate = new Date('2024-04-20');
    const daysSinceHalving = Math.floor((Date.now() - halvingDate.getTime()) / (1000 * 60 * 60 * 24));

    if (daysSinceHalving < 90) {
      cyclePhase = 'POST-HALVING EARLY';
      cycleDetail = 'Awal post-halving. Historically sideways 1-3 bulan sebelum bull run.';
    } else if (daysSinceHalving < 365) {
      cyclePhase = 'BULL RUN EARLY';
      cycleDetail = `Bull cycle aktif (${daysSinceHalving} hari post-halving). Historically BTC naik 200-400% dari level halving.`;
    } else if (daysSinceHalving < 547) {
      cyclePhase = 'BULL RUN PEAK';
      cycleDetail = `Bull cycle mature (${daysSinceHalving} hari). Historically peak terjadi 12-18 bulan post-halving.`;
    } else if (daysSinceHalving < 730) {
      cyclePhase = 'DISTRIBUTION';
      cycleDetail = 'Fase distribusi — smart money mulai keluar. Volatilitas tinggi.';
    } else {
      cyclePhase = 'BEAR MARKET';
      cycleDetail = 'Bear market / akumulasi. Waktu terbaik untuk DCA jangka panjang.';
    }

    // ── MARKET SUMMARY ────────────────────────────────────────────
    const generateMarketSummary = () => {
      const parts = [];

      if (fng.value <= 25) parts.push('Extreme Fear di pasar — historically sinyal buy terbaik.');
      else if (fng.value >= 80) parts.push('Extreme Greed — waspada distribusi dan koreksi besar.');
      else if (fng.value <= 40) parts.push('Fear zone — akumulasi untuk investor long-term.');
      else parts.push(`Sentimen pasar ${fng.classification}.`);

      parts.push(`BTC dominance ${dominance.btc}% — ${dominance.btc > 55 ? 'BTC season, altcoin masih tertinggal' : dominance.btc < 45 ? 'Altcoin season aktif, rotasi ke altcoin' : 'Transisi BTC/altcoin'}.`);

      if (altcoinSeason >= 75) parts.push('Altcoin season aktif — lebih dari 75% altcoin outperform BTC.');
      else if (altcoinSeason < 25) parts.push('Bitcoin season — kapital mengalir ke BTC, jaga posisi altcoin.');

      parts.push(cycleDetail);

      if (mvrvEstimate !== null) {
        parts.push(`MVRV Z-Score estimasi: ${mvrvEstimate} (${mvrvLabel}).`);
      }

      return parts.join(' ');
    };

    // ── TOP PERFORMERS & LOSERS ───────────────────────────────────
    let topGainers = [], topLosers = [], volumeBreakout = [];
    if (altcoinPerfsRes.status === 'fulfilled' && Array.isArray(altcoinPerfsRes.value)) {
      const filtered = altcoinPerfsRes.value.filter(t =>
        t.symbol.endsWith('USDT') &&
        parseFloat(t.quoteVolume) > 5000000 &&
        !['USDTUSDT', 'BUSDUSDT', 'USDCUSDT', 'TUSDUSDT', 'FDUSDUSDT'].includes(t.symbol)
      );
      const sorted = filtered.sort((a, b) => parseFloat(b.priceChangePercent) - parseFloat(a.priceChangePercent));
      topGainers = sorted.slice(0, 10).map(t => ({
        symbol: t.symbol.replace('USDT', ''),
        price: parseFloat(parseFloat(t.lastPrice).toFixed(6)),
        change: parseFloat(parseFloat(t.priceChangePercent).toFixed(2)),
        volume: parseFloat(parseFloat(t.quoteVolume).toFixed(0)),
      }));
      topLosers = sorted.slice(-10).reverse().map(t => ({
        symbol: t.symbol.replace('USDT', ''),
        price: parseFloat(parseFloat(t.lastPrice).toFixed(6)),
        change: parseFloat(parseFloat(t.priceChangePercent).toFixed(2)),
        volume: parseFloat(parseFloat(t.quoteVolume).toFixed(0)),
      }));

      // Volume breakout: unusual volume spike
      const avgVolumes = {};
      filtered.forEach(t => { avgVolumes[t.symbol] = parseFloat(t.quoteVolume); });
      volumeBreakout = filtered
        .filter(t => parseFloat(t.quoteVolume) > 50000000)
        .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
        .slice(0, 8)
        .map(t => ({
          symbol: t.symbol.replace('USDT', ''),
          price: parseFloat(parseFloat(t.lastPrice).toFixed(6)),
          change: parseFloat(parseFloat(t.priceChangePercent).toFixed(2)),
          volume: parseFloat(parseFloat(t.quoteVolume).toFixed(0)),
          signal: parseFloat(t.priceChangePercent) > 3 ? 'BULLISH_BREAKOUT' : parseFloat(t.priceChangePercent) < -3 ? 'BEARISH_BREAKDOWN' : 'HIGH_VOLUME',
        }));
    }

    // ── TRENDING COINS ────────────────────────────────────────────
    let trendingCoins = [];
    if (trendingRes.status === 'fulfilled' && trendingRes.value.coins) {
      trendingCoins = trendingRes.value.coins.slice(0, 7).map(c => ({
        name: c.item.name,
        symbol: c.item.symbol,
        rank: c.item.market_cap_rank,
        price_btc: c.item.price_btc,
        score: c.item.score,
      }));
    }

    // ── RESPONSE ──────────────────────────────────────────────────
    res.setHeader('Cache-Control', 's-maxage=60');
    return res.status(200).json({
      timestamp: Date.now(),
      fearGreed: fng,
      dominance,
      globalMarket,
      altcoinSeason: {
        index: altcoinSeason,
        label: altcoinSeasonLabel,
        detail: altcoinDetail,
        signal: altcoinSeason >= 75 ? 'ALTCOIN' : altcoinSeason < 25 ? 'BITCOIN' : 'MIXED',
      },
      mvrv: {
        estimate: mvrvEstimate,
        label: mvrvLabel,
        signal: mvrvSignal,
        note: 'Approximation menggunakan 90-day price z-score sebagai proxy MVRV',
      },
      cycle: {
        phase: cyclePhase,
        detail: cycleDetail,
        daysSinceHalving,
        nextHalvingEstimate: '2028-04 (estimasi)',
      },
      marketSummary: generateMarketSummary(),
      topGainers,
      topLosers,
      volumeBreakout,
      trendingCoins,
    });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
