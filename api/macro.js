// api/macro.js — v15 REBUILT
// Fast: Alternative.me + CoinGecko + Binance spot tickers
// Max 6 seconds total. NO Binance fapi.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=30');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const t0 = Date.now();

  const sf = async (url, ms) => {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), ms);
    try {
      const r = await fetch(url, { signal: c.signal, headers: { Accept: 'application/json', 'User-Agent': 'AC369/1.0' } });
      clearTimeout(t);
      if (!r.ok) return null;
      return await r.json();
    } catch { clearTimeout(t); return null; }
  };

  try {
    // 3 parallel calls
    const [fngR, glR, tickersR] = await Promise.allSettled([
      sf('https://api.alternative.me/fng/?limit=14&format=json', 4000),
      sf('https://api.coingecko.com/api/v3/global', 4000),
      sf('https://api.binance.com/api/v3/ticker/24hr', 6000),
    ]);

    // ── F&G ─────────────────────────────────────────────────
    const fngData  = fngR.status === 'fulfilled' ? fngR.value?.data || [] : [];
    const fgVal    = fngData[0] ? parseInt(fngData[0].value) : 50;
    const fgCls    = fngData[0]?.value_classification || 'Neutral';
    const fgHist   = fngData.slice(0, 7).map(d => ({
      value: parseInt(d.value),
      label: d.value_classification,
      date:  new Date(d.timestamp * 1000).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }),
    }));

    const fearGreed = {
      value: fgVal, classification: fgCls,
      history: fgHist,
      signal: fgVal <= 20 ? 'EXTREME_FEAR_BUY' : fgVal <= 40 ? 'FEAR' : fgVal <= 60 ? 'NEUTRAL' : fgVal <= 80 ? 'GREED' : 'EXTREME_GREED_SELL',
      interpretation: fgVal <= 20 ? '🔥 Extreme Fear — zona akumulasi terbaik (buy sangat kuat)' : fgVal <= 40 ? '😨 Fear — akumulasi bertahap, tunggu konfirmasi' : fgVal <= 60 ? '😐 Netral — tidak ada edge kuat' : fgVal <= 80 ? '😄 Greed — waspada koreksi, kurangi leverage' : '🤑 Extreme Greed — distribusi smart money',
    };

    // ── BTC DOMINANCE ─────────────────────────────────────────
    const gld = glR.status === 'fulfilled' ? glR.value?.data : null;
    const btcDomV = gld?.market_cap_percentage?.btc ? +gld.market_cap_percentage.btc.toFixed(2) : 58;
    const ethDomV = gld?.market_cap_percentage?.eth ? +gld.market_cap_percentage.eth.toFixed(2) : 12;
    const totalMC = gld?.total_market_cap?.usd || 0;
    const mcChg24 = gld?.market_cap_change_percentage_24h_usd ? +gld.market_cap_change_percentage_24h_usd.toFixed(2) : 0;

    const btcDominance = {
      value: btcDomV, dominance: btcDomV.toFixed(2) + '%', eth: ethDomV.toFixed(2) + '%',
      totalMarketCap: totalMC, marketCapChange24h: mcChg24,
      interpretation: btcDomV > 62 ? 'BTC Dominasi Ekstrem — altcoin sangat lemah' : btcDomV > 57 ? 'BTC Season — hold altcoin minimal' : btcDomV > 50 ? 'Transisi — rotasi ke altcoin mulai' : btcDomV > 45 ? 'Altcoin Season Awal' : 'Altcoin Season Aktif 🚀',
      signal: btcDomV > 58 ? 'BTC_SEASON' : btcDomV < 45 ? 'ALT_SEASON' : 'TRANSITION',
    };

    // ── MVRV PROXY from price comparison ──────────────────────
    const allT = tickersR.status === 'fulfilled' && Array.isArray(tickersR.value) ? tickersR.value : [];
    const tMap = {};
    allT.forEach(t => { if (t?.symbol) tMap[t.symbol] = t; });
    const btcPx = +(tMap['BTCUSDT']?.lastPrice || 0);

    // MVRV proxy: current price vs estimated realized price
    const REALIZED = 56576;
    const mvProxy = btcPx > 0 ? +(btcPx / REALIZED).toFixed(2) : null;
    const mvrvZScore = {
      value: mvProxy?.toString() || 'N/A', estimate: mvProxy,
      interpretation: !mvProxy ? 'Data tidak tersedia' : mvProxy < 0.8 ? '🔥 Extreme Undervalue — Beli kuat' : mvProxy < 1.2 ? '🟢 Fair value (cheap zone)' : mvProxy < 1.8 ? '⚖️ Fair value' : mvProxy < 2.5 ? '⚠️ Mulai mahal' : mvProxy < 3.5 ? '🔴 Bubble territory' : '💀 Extreme bubble',
      signal: !mvProxy ? 'NEUTRAL' : mvProxy < 1.2 ? 'BUY' : mvProxy > 3.0 ? 'SELL' : 'HOLD',
      note: 'Proxy: harga / realized price ($' + REALIZED.toLocaleString() + ')',
    };

    // ── ALTCOIN SEASON INDEX ──────────────────────────────────
    const ALTS = ['ETHUSDT','BNBUSDT','XRPUSDT','ADAUSDT','SOLUSDT','DOTUSDT','LINKUSDT','LTCUSDT','AVAXUSDT','ATOMUSDT','NEARUSDT','ARBUSDT','OPUSDT','MATICUSDT','UNIUSDT','SUIUSDT','INJUSDT','AAVEUSDT'];
    const btcChg = +(tMap['BTCUSDT']?.priceChangePercent || 0);
    let out = 0, tot = 0;
    ALTS.forEach(s => { if (tMap[s]) { tot++; if (+(tMap[s].priceChangePercent || 0) > btcChg) out++; } });
    const altIdx = tot > 0 ? Math.round(out / tot * 100) : 50;
    const altLabel = altIdx >= 75 ? '🚀 Altcoin Season!' : altIdx >= 55 ? '📈 Altcoin Trending' : altIdx >= 25 ? '⚖️ Mixed Market' : '₿ Bitcoin Season';

    const altcoinSeason = {
      index: altIdx, label: altLabel, season: altLabel,
      detail: `${out}/${tot} altcoin outperform BTC (24h).`,
      value: altIdx,
    };

    // ── MARKET CYCLE ─────────────────────────────────────────
    const dsh = Math.floor((Date.now() - 1713571200000) / 86400000);
    let cyclePhase, cycleDetail, warning = null;
    if      (dsh < 90)  { cyclePhase = 'Post-Halving Early';      cycleDetail = `Hari ${dsh}. Historis: sideways 2-3 bulan, kemudian bull run dimulai.`; }
    else if (dsh < 365) { cyclePhase = '🔥 Bull Cycle Early';     cycleDetail = `Hari ${dsh}. Periode terbaik akumulasi dan hold. Smart money accumulating.`; }
    else if (dsh < 480) { cyclePhase = '⚡ Bull Cycle Peak Zone'; cycleDetail = `Hari ${dsh}. Zona puncak historis. Pertimbangkan profit taking bertahap.`; warning = 'BTC sering puncak 12-18 bulan post-halving. Pertimbangkan partial profit taking.'; }
    else if (dsh < 730) { cyclePhase = '⚠️ Late Bull / Distribution'; cycleDetail = `Hari ${dsh}. Smart money cenderung exit bertahap. Waspada volatilitas tinggi.`; warning = 'Fase distribusi historis. Kurangi exposure jika belum profit taking.'; }
    else                { cyclePhase = '🌱 Accumulation';          cycleDetail = `Hari ${dsh}. Fase akumulasi bottom cycle. DCA zone terbaik.`; }

    // ── TOP GAINERS / LOSERS ──────────────────────────────────
    const STABLES = new Set(['USDT','USDC','BUSD','TUSD','DAI','FDUSD','USDP']);
    const filtered = allT.filter(t => t?.symbol?.endsWith('USDT') && +(t.quoteVolume||0) > 1e6 && !STABLES.has(t.symbol.replace('USDT','')));
    const sorted = [...filtered].sort((a, b) => +b.priceChangePercent - +a.priceChangePercent);
    const mp = t => ({ symbol: t.symbol.replace('USDT',''), price: +(+t.lastPrice).toFixed(6), change: +(+t.priceChangePercent).toFixed(2), volume: Math.round(+t.quoteVolume) });
    const topGainers = sorted.slice(0, 10).map(mp);
    const topLosers  = sorted.slice(-10).reverse().map(mp);

    // Moon phase
    const jd  = Date.now() / 86400000 + 2440587.5;
    const dnm = ((jd - 2460320.5) % 29.53058867 + 29.53058867) % 29.53058867;
    const phases = [[1.5,'New Moon','🌑'],[7.5,'Waxing Crescent','🌒'],[8.5,'First Quarter','🌓'],[14,'Waxing Gibbous','🌔'],[16,'Full Moon','🌕'],[22,'Waning','🌖']];
    let moonPhase = 'Dark Moon', moonEmoji = '🌘';
    for (const [lim, ph, em] of phases) { if (dnm < lim) { moonPhase = ph; moonEmoji = em; break; } }

    // Cycle summary text
    const cycleSummary = [
      `F&G: ${fgVal}/100 (${fgCls}).`,
      `BTC Dom ${btcDomV}% — ${btcDomV > 55 ? 'BTC season' : btcDomV < 45 ? 'Alt season aktif 🚀' : 'Transisi'}.`,
      altIdx >= 75 ? '🚀 Altcoin season aktif.' : altIdx < 25 ? '₿ Bitcoin season dominasi.' : `${altLabel}.`,
      cycleDetail,
      mvProxy ? `MVRV proxy: ${mvProxy} (${mvrvZScore.signal}).` : '',
      warning ? `⚠️ ${warning}` : '',
    ].filter(Boolean).join(' ');

    return res.status(200).json({
      ok: true, ts: Date.now(), elapsed: Date.now() - t0, version: 'v15',
      fearGreed, btcDominance, mvrvZScore, altcoinSeason,
      mvrv: mvrvZScore, dominance: { btc: btcDomV, eth: ethDomV },
      cycleSummary, marketSummary: cycleSummary,
      cycle: { phase: cyclePhase, detail: cycleDetail, warning, daysSinceHalving: dsh },
      moonPhase: { phase: moonPhase, emoji: moonEmoji, daysSinceNM: +dnm.toFixed(1) },
      topGainers, topLosers,
    });

  } catch (e) {
    return res.status(200).json({
      ok: false, error: e.message, ts: Date.now(), version: 'v15',
      fearGreed: { value: 50, classification: 'Neutral', history: [] },
      btcDominance: { value: 58, dominance: '58.00%', interpretation: '₿ BTC Season' },
      mvrvZScore: { value: 'N/A', signal: 'NEUTRAL', interpretation: 'Data tidak tersedia' },
      altcoinSeason: { index: 50, label: '⚖️ Mixed Market', season: '⚖️ Mixed Market' },
      mvrv: { value: 'N/A' }, dominance: { btc: 58, eth: 12 },
      cycleSummary: 'Data sementara tidak tersedia.', topGainers: [], topLosers: [],
    });
  }
}
