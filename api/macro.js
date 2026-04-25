// api/macro.js — AC369 FUSION v10.7 FINAL
// FIXES: CryptoCompare fallback for MVRV BTC klines (was N/A)
// All field names match index.html exactly

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const sf = async (url, ms = 9000) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
      const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } });
      clearTimeout(t); if (!r.ok) return null; return await r.json();
    } catch { clearTimeout(t); return null; }
  };

  // ── FETCH BTC DAILY KLINES (3-layer fallback for MVRV) ─────────
  async function fetchBTCKlines() {
    // 1. Binance Futures (limit=200)
    const f1 = await sf('https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=1d&limit=200');
    if (Array.isArray(f1) && f1.length >= 90) return { data: f1.map(k => +k[4]), src: 'futures' };

    // 2. Binance Spot (limit=200)
    const f2 = await sf('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=200');
    if (Array.isArray(f2) && f2.length >= 90) return { data: f2.map(k => +k[4]), src: 'spot' };

    // 3. CryptoCompare (always accessible, gives 200 days)
    const f3 = await sf('https://min-api.cryptocompare.com/data/v2/histoday?fsym=BTC&tsym=USD&limit=200');
    if (f3?.Response === 'Success' && f3.Data?.Data?.length >= 90) {
      return { data: f3.Data.Data.map(d => d.close).filter(v => v > 0), src: 'cryptocompare' };
    }

    // 4. CoinGecko market chart (30 days at least)
    const f4 = await sf('https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=90&interval=daily');
    if (f4?.prices?.length >= 30) {
      return { data: f4.prices.map(p => p[1]).filter(v => v > 0), src: 'coingecko' };
    }

    return null;
  }

  try {
    // Parallel fetch
    const [fngRes, globalRes, btcKlinesRes, tickerRes] = await Promise.allSettled([
      sf('https://api.alternative.me/fng/?limit=30&format=json'),
      sf('https://api.coingecko.com/api/v3/global'),
      fetchBTCKlines(),
      // Binance Spot tickers → CoinGecko fallback
      sf('https://api.binance.com/api/v3/ticker/24hr')
        .then(d => Array.isArray(d) && d.length > 100 ? d :
          sf('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&sparkline=false&price_change_percentage=24h')),
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
        interpretation: v <= 20 ? 'Extreme Fear — zona akumulasi terbaik' : v <= 40 ? 'Fear — pertimbangkan akumulasi bertahap' : v <= 60 ? 'Netral — sentimen seimbang' : v <= 80 ? 'Greed — waspada koreksi' : 'Extreme Greed — distribusi smart money',
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

    // ── MVRV Z-SCORE (with CryptoCompare fallback) ────────────────
    let mvrvZScore = { value: 'N/A', interpretation: 'Data tidak tersedia', signal: 'NEUTRAL' };
    const klinesResult = btcKlinesRes.status === 'fulfilled' ? btcKlinesRes.value : null;
    if (klinesResult?.data && klinesResult.data.length >= 60) {
      const closes = klinesResult.data.filter(v => !isNaN(v) && v > 0);
      if (closes.length >= 60) {
        const cur = closes[closes.length - 1];
        const n = Math.min(200, closes.length);
        const avg = closes.slice(-n).reduce((a, b) => a + b, 0) / n;
        const std = Math.sqrt(closes.slice(-n).reduce((s, v) => s + (v - avg) ** 2, 0) / n);
        const z = std > 0 ? +((cur - avg) / std).toFixed(2) : 0;
        mvrvZScore = {
          value: z.toString(), estimate: z,
          interpretation: z > 7 ? '🔴 Sangat Overvalued — Zona jual kuat' : z > 3 ? '⚠️ Overvalued — Hati-hati distribusi' : z > -0.5 ? '⚖️ Fair Value — Harga wajar' : z > -3 ? '🟢 Undervalued — Zona akumulasi' : '🔥 Extreme Undervalue — Beli kuat',
          signal: z > 5 ? 'SELL' : z > 2 ? 'CAUTION' : z < -2 ? 'BUY' : 'HOLD',
          note: `Proxy via ${n}-day BTC price z-score (source: ${klinesResult.src})`,
          dataPoints: closes.length,
        };
      }
    }

    // ── ALTCOIN SEASON ─────────────────────────────────────────────
    let altIdx = 0, altLabel = '₿ Bitcoin Season', altDetail = '';
    const tickers = tickerRes.status === 'fulfilled' ? tickerRes.value : null;

    if (Array.isArray(tickers) && tickers.length > 0) {
      const isBinance = tickers[0]?.lastPrice !== undefined;
      if (isBinance) {
        const tMap = {};
        tickers.forEach(t => { if (t.symbol) tMap[t.symbol] = t; });
        const btcChg = +(tMap['BTCUSDT']?.priceChangePercent || 0);
        const ALTS = ['ETHUSDT','BNBUSDT','XRPUSDT','ADAUSDT','SOLUSDT','DOTUSDT','LINKUSDT','LTCUSDT','AVAXUSDT','ATOMUSDT','NEARUSDT','ARBUSDT','OPUSDT','MATICUSDT','UNIUSDT','SUIUSDT','INJUSDT','AAVEUSDT','MKRUSDT','APTUSDT'];
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

    // ── MARKET CYCLE ─────────────────────────────────────────────
    const halvingDate = new Date('2024-04-20');
    const daysSinceHalving = Math.floor((Date.now() - halvingDate.getTime()) / 86400000);
    let cyclePhase, cycleDetail;
    if (daysSinceHalving < 90) { cyclePhase = 'POST-HALVING EARLY'; cycleDetail = `Awal post-halving (${daysSinceHalving} hari). Historis sideways sebelum bull run.`; }
    else if (daysSinceHalving < 365) { cyclePhase = 'BULL RUN EARLY'; cycleDetail = `Bull cycle aktif — ${daysSinceHalving} hari post-halving. BTC historis +200-400%.`; }
    else if (daysSinceHalving < 547) { cyclePhase = 'BULL RUN PEAK'; cycleDetail = `Bull cycle mature — ${daysSinceHalving} hari. Peak biasanya bulan 12-18.`; }
    else if (daysSinceHalving < 730) { cyclePhase = 'DISTRIBUTION'; cycleDetail = 'Fase distribusi — smart money mulai exit. Kurangi leverage.'; }
    else { cyclePhase = 'BEAR MARKET'; cycleDetail = 'Bear market/akumulasi. Waktu terbaik untuk DCA BTC.'; }

    // ── TOP GAINERS / VOLUME ──────────────────────────────────────
    let topGainers = [], topLosers = [], volumeBreakout = [];
    if (Array.isArray(tickers) && tickers.length > 0) {
      const isBinance = tickers[0]?.lastPrice !== undefined;
      if (isBinance) {
        const STABLES = new Set(['USDT','USDC','BUSD','TUSD','DAI','FDUSD']);
        const f = tickers.filter(t => t?.symbol?.endsWith('USDT') && +(t.quoteVolume||0) > 1000000 && !STABLES.has(t.symbol.replace('USDT','')));
        const s = [...f].sort((a,b)=>+b.priceChangePercent - +a.priceChangePercent);
        const mp = t => ({ symbol:t.symbol.replace('USDT',''), price:+(+t.lastPrice).toFixed(6), change:+(+t.priceChangePercent).toFixed(2), volume:Math.round(+t.quoteVolume) });
        topGainers = s.slice(0,10).map(mp);
        topLosers = s.slice(-10).reverse().map(mp);
        volumeBreakout = [...f].filter(t=>+(t.quoteVolume||0)>30000000).sort((a,b)=>+b.quoteVolume - +a.quoteVolume).slice(0,8)
          .map(t=>({...mp(t),signal:+t.priceChangePercent>3?'BULLISH_BREAKOUT':+t.priceChangePercent<-3?'BEARISH_BREAKDOWN':'HIGH_VOLUME'}));
      } else {
        const s = [...tickers].sort((a,b)=>(b.price_change_percentage_24h||0)-(a.price_change_percentage_24h||0));
        const mp = c => ({ symbol:(c.symbol||'').toUpperCase(), price:+(c.current_price||0).toFixed(6), change:+(c.price_change_percentage_24h||0).toFixed(2), volume:Math.round(c.total_volume||0) });
        topGainers = s.filter(c=>(c.price_change_percentage_24h||0)>0).slice(0,10).map(mp);
        topLosers = [...tickers].sort((a,b)=>(a.price_change_percentage_24h||0)-(b.price_change_percentage_24h||0)).slice(0,10).map(mp);
      }
    }

    const cycleSummary = [
      `F&G: ${fearGreed.value} (${fearGreed.classification}).`,
      `BTC Dom ${btcDom}% — ${btcDom > 55 ? 'BTC season' : 'Alt season trending'}.`,
      altIdx >= 75 ? 'Altcoin season aktif 🚀.' : altIdx < 25 ? '₿ Bitcoin season.' : 'Market mixed ⚖️.',
      cycleDetail,
      mvrvZScore.value !== 'N/A' ? `MVRV Z: ${mvrvZScore.value} (${mvrvZScore.interpretation.replace(/[🔴⚠️⚖️🟢🔥]/g,'').trim()}).` : '',
    ].filter(Boolean).join(' ');

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
