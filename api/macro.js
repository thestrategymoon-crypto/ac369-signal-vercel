// ============================================================
// api/macro.js — v17 FINAL
// ⚠️  TIDAK ADA api.binance.com SAMA SEKALI DI FILE INI
// F&G          : Alternative.me fng   ← SELALU BEKERJA
// BTC Dom      : CoinGecko global     ← SELALU BEKERJA
// BTC/ETH Harga: CoinGecko simple     ← SELALU BEKERJA
// Altcoin Season: CoinGecko markets top100 ← BEKERJA
// ============================================================

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=30');
  if (req.method === 'OPTIONS') return res.status(200).end();
  const t0 = Date.now();

  const sf = async (url, ms) => {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), ms);
    try {
      const r = await fetch(url, {
        signal: c.signal,
        headers: { Accept: 'application/json', 'User-Agent': 'AC369/1.0' }
      });
      clearTimeout(t);
      if (!r.ok) return null;
      return await r.json();
    } catch { clearTimeout(t); return null; }
  };

  try {
    // ── 4 SUMBER PARALLEL — 0 Binance ─────────────────────
    const [fngR, cgGlobalR, cgPriceR, cgMarketsR] = await Promise.allSettled([

      // 1. Fear & Greed 14 hari — Alternative.me
      sf('https://api.alternative.me/fng/?limit=14&format=json', 4000),

      // 2. Global market stats — CoinGecko
      sf('https://api.coingecko.com/api/v3/global', 5000),

      // 3. BTC + ETH harga realtime — CoinGecko simple
      sf('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,bnb,solana&vs_currencies=usd&include_24hr_change=true&include_market_cap=true&include_24hr_vol=true', 5000),

      // 4. Top 100 coins untuk altcoin season — CoinGecko markets
      sf('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&sparkline=false&price_change_percentage=24h', 6000),
    ]);

    // ── F&G ────────────────────────────────────────────────
    const fngData  = fngR.status === 'fulfilled' ? (fngR.value?.data || []) : [];
    const fgVal    = fngData[0] ? parseInt(fngData[0].value) : 50;
    const fgCls    = fngData[0]?.value_classification || 'Neutral';
    const fgHist   = fngData.slice(0, 7).map(d => ({
      value: parseInt(d.value),
      label: d.value_classification,
      date:  new Date(d.timestamp * 1000).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }),
    }));
    const fearGreed = {
      value:          fgVal,
      classification: fgCls,
      history:        fgHist,
      signal:         fgVal <= 20 ? 'EXTREME_FEAR' : fgVal <= 40 ? 'FEAR' : fgVal <= 60 ? 'NEUTRAL' : fgVal <= 80 ? 'GREED' : 'EXTREME_GREED',
      interpretation: fgVal <= 20 ? '🔥 Extreme Fear — zona akumulasi terbaik (buy kuat)'
                    : fgVal <= 40 ? '😨 Fear — akumulasi bertahap, tunggu konfirmasi'
                    : fgVal <= 60 ? '😐 Netral — tidak ada edge kuat'
                    : fgVal <= 80 ? '😄 Greed — waspada koreksi, kurangi leverage'
                    :               '🤑 Extreme Greed — distribusi smart money',
    };

    // ── GLOBAL / BTC DOM ───────────────────────────────────
    const cgGlobal  = cgGlobalR.status === 'fulfilled' ? cgGlobalR.value?.data : null;
    const btcDomV   = cgGlobal?.market_cap_percentage?.btc
      ? +cgGlobal.market_cap_percentage.btc.toFixed(2) : 58.0;
    const ethDomV   = cgGlobal?.market_cap_percentage?.eth
      ? +cgGlobal.market_cap_percentage.eth.toFixed(2) : 12.0;
    const totalMC   = cgGlobal?.total_market_cap?.usd || 0;
    const mcChg24   = cgGlobal?.market_cap_change_percentage_24h_usd
      ? +cgGlobal.market_cap_change_percentage_24h_usd.toFixed(2) : 0;
    const defiPct   = cgGlobal?.defi_market_cap && totalMC
      ? +(cgGlobal.defi_market_cap / totalMC * 100).toFixed(2) : null;

    const btcDominance = {
      value:          btcDomV,
      dominance:      btcDomV.toFixed(2) + '%',
      eth:            ethDomV.toFixed(2) + '%',
      totalMarketCap: totalMC,
      marketCapChange24h: mcChg24,
      defiPct,
      interpretation: btcDomV > 62 ? 'BTC Dominasi Ekstrem — altcoin sangat lemah'
                    : btcDomV > 57 ? 'BTC Season — hold altcoin minimal'
                    : btcDomV > 50 ? 'Transisi — rotasi ke altcoin mulai'
                    : btcDomV > 45 ? 'Altcoin Season Awal'
                    :                'Altcoin Season Aktif 🚀',
      signal: btcDomV > 58 ? 'BTC_SEASON' : btcDomV < 45 ? 'ALT_SEASON' : 'TRANSITION',
    };

    // ── HARGA BTC / ETH ────────────────────────────────────
    const cgPrices = cgPriceR.status === 'fulfilled' ? cgPriceR.value : null;
    const btcPx    = cgPrices?.bitcoin?.usd             || 0;
    const ethPx    = cgPrices?.ethereum?.usd            || 0;
    const bnbPx    = cgPrices?.bnb?.usd                 || 0;
    const solPx    = cgPrices?.solana?.usd              || 0;
    const btcCh    = cgPrices?.bitcoin?.usd_24h_change   ? +cgPrices.bitcoin.usd_24h_change.toFixed(2)   : 0;
    const ethCh    = cgPrices?.ethereum?.usd_24h_change  ? +cgPrices.ethereum.usd_24h_change.toFixed(2)  : 0;
    const btcMCap  = cgPrices?.bitcoin?.usd_market_cap  || 0;

    // ── MVRV PROXY ─────────────────────────────────────────
    const REALIZED  = 56576;
    const mvProxy   = btcPx > 0 ? +(btcPx / REALIZED).toFixed(2) : null;
    const mvrvZScore = {
      value:          mvProxy?.toString() || 'N/A',
      estimate:       mvProxy,
      signal:         !mvProxy ? 'NEUTRAL' : mvProxy < 1.2 ? 'BUY' : mvProxy > 3.0 ? 'SELL' : 'HOLD',
      interpretation: !mvProxy           ? 'Data tidak tersedia'
                    : mvProxy < 0.8  ? '🔥 Extreme Undervalue — beli kuat'
                    : mvProxy < 1.2  ? '🟢 Fair value — cheap zone'
                    : mvProxy < 1.8  ? '⚖️ Fair value zone'
                    : mvProxy < 2.5  ? '⚠️ Mulai mahal — caution'
                    : mvProxy < 3.5  ? '🔴 Bubble territory'
                    :                  '💀 Extreme bubble',
      note: 'Proxy: price / realized_price ($' + REALIZED.toLocaleString() + ')',
    };

    // ── ALTCOIN SEASON dari CoinGecko markets top 100 ─────
    const markets  = cgMarketsR.status === 'fulfilled' && Array.isArray(cgMarketsR.value)
      ? cgMarketsR.value : [];
    let altOut = 0, altTotal = 0;

    if (markets.length > 0) {
      const btcRow = markets.find(c => c.id === 'bitcoin');
      const btcPerf = btcRow?.price_change_percentage_24h ?? btcCh ?? 0;
      markets.forEach(c => {
        if (c.id === 'bitcoin') return;
        const perf = c.price_change_percentage_24h ?? 0;
        altTotal++;
        if (perf > btcPerf) altOut++;
      });
    }

    const altIdx   = altTotal > 0 ? Math.round(altOut / altTotal * 100) : 50;
    const altLabel = altIdx >= 75 ? '🚀 Altcoin Season!'
                   : altIdx >= 55 ? '📈 Altcoin Trending'
                   : altIdx >= 25 ? '⚖️ Mixed Market'
                   :                '₿ Bitcoin Season';

    const altcoinSeason = {
      index:  altIdx, label: altLabel, season: altLabel, value: altIdx,
      detail: `${altOut}/${altTotal} altcoin outperform BTC (24h, top 100 by MCap).`,
    };

    // ── TOP GAINERS / LOSERS ───────────────────────────────
    const sortable = markets.filter(c => c.id !== 'bitcoin' && (c.total_volume || 0) > 500000);
    const mkCoin   = c => ({
      symbol:  (c.symbol || '').toUpperCase(),
      price:   c.current_price,
      change:  +(c.price_change_percentage_24h || 0).toFixed(2),
      volume:  Math.round(c.total_volume || 0),
      mcap:    Math.round(c.market_cap  || 0),
    });
    const topGainers = [...sortable].sort((a, b) => (b.price_change_percentage_24h||0) - (a.price_change_percentage_24h||0)).slice(0, 10).map(mkCoin);
    const topLosers  = [...sortable].sort((a, b) => (a.price_change_percentage_24h||0) - (b.price_change_percentage_24h||0)).slice(0, 10).map(mkCoin);

    // ── MARKET CYCLE ───────────────────────────────────────
    const dsh = Math.floor((Date.now() - 1713571200000) / 86400000); // days since BTC halving Apr 2024
    let cyclePhase, cycleDetail, warning = null;
    if      (dsh < 90)  { cyclePhase = 'Post-Halving Early';          cycleDetail = `Hari ${dsh}. Historis: sideways 2-3 bulan, lalu bull run dimulai.`; }
    else if (dsh < 365) { cyclePhase = '🔥 Bull Cycle Early';         cycleDetail = `Hari ${dsh}. Periode terbaik akumulasi. Smart money accumulating.`; }
    else if (dsh < 480) { cyclePhase = '⚡ Bull Cycle Peak Zone';     cycleDetail = `Hari ${dsh}. Zona puncak historis. Pertimbangkan profit taking bertahap.`; warning = 'BTC historis puncak 12-18 bulan post-halving. Pertimbangkan partial exit.'; }
    else if (dsh < 730) { cyclePhase = '⚠️ Late Bull / Distribution'; cycleDetail = `Hari ${dsh}. Smart money exit bertahap. Waspada volatilitas tinggi.`; warning = 'Fase distribusi historis. Kurangi exposure jika belum profit taking.'; }
    else                { cyclePhase = '🌱 Accumulation';              cycleDetail = `Hari ${dsh}. Bear market bottom zone. DCA zone terbaik.`; }

    // Moon Phase
    const jd  = Date.now() / 86400000 + 2440587.5;
    const dnm = ((jd - 2460320.5) % 29.53058867 + 29.53058867) % 29.53058867;
    const phases = [[1.5,'New Moon','🌑'],[7.5,'Waxing Crescent','🌒'],[8.5,'First Quarter','🌓'],[14,'Waxing Gibbous','🌔'],[16,'Full Moon','🌕'],[22,'Waning Gibbous','🌖'],[25,'Last Quarter','🌗'],[29.5,'Waning Crescent','🌘']];
    let moonPhase = 'Dark Moon', moonEmoji = '🌑';
    for (const [lim, ph, em] of phases) { if (dnm < lim) { moonPhase = ph; moonEmoji = em; break; } }

    // Cycle summary text
    const totalMCStr = totalMC > 0 ? `Total MCap: $${(totalMC / 1e12).toFixed(2)}T (${mcChg24 >= 0 ? '+' : ''}${mcChg24}%).` : '';
    const cycleSummary = [
      `F&G: ${fgVal}/100 (${fgCls}).`,
      `BTC Dom ${btcDomV}% — ${btcDomV > 57 ? 'BTC season aktif.' : btcDomV < 45 ? 'Altcoin season 🚀' : 'Transisi BTC/Alt.'}`,
      altIdx >= 75 ? '🚀 Altcoin season aktif.' : altIdx < 25 ? '₿ Bitcoin season dominasi.' : altLabel + '.',
      cycleDetail,
      mvProxy ? `MVRV proxy: ${mvProxy} (${mvrvZScore.signal}).` : '',
      totalMCStr,
      warning ? `⚠️ ${warning}` : '',
    ].filter(Boolean).join(' ');

    return res.status(200).json({
      ok:    true,
      ts:    Date.now(),
      elapsed: Date.now() - t0,
      version: 'v17',
      src:   'coingecko+alternative.me',

      // F&G
      fearGreed,

      // Dominance
      btcDominance,
      dominance: { btc: btcDomV, eth: ethDomV },

      // Prices
      btcPrice: btcPx, ethPrice: ethPx, bnbPrice: bnbPx, solPrice: solPx,
      btcChange: btcCh, ethChange: ethCh, btcMCap,
      totalMarketCap: totalMC, marketCapChange: mcChg24,
      defiPct,

      // MVRV
      mvrvZScore, mvrv: mvrvZScore,

      // Altcoin Season
      altcoinSeason,

      // Market data
      topGainers, topLosers,

      // Cycle
      cycleSummary, marketSummary: cycleSummary,
      cycle: { phase: cyclePhase, detail: cycleDetail, warning, daysSinceHalving: dsh },
      moonPhase: { phase: moonPhase, emoji: moonEmoji, daysSinceNM: +dnm.toFixed(1) },
    });

  } catch (e) {
    return res.status(200).json({
      ok: false, error: e.message, ts: Date.now(), elapsed: Date.now() - t0, version: 'v17',
      fearGreed:    { value: 50, classification: 'Neutral', history: [] },
      btcDominance: { value: 58, dominance: '58.00%', interpretation: '₿ BTC Season', signal: 'BTC_SEASON' },
      mvrvZScore:   { value: 'N/A', signal: 'NEUTRAL', interpretation: 'Data tidak tersedia' },
      altcoinSeason:{ index: 50, label: '⚖️ Mixed Market', season: '⚖️ Mixed Market', detail: '' },
      mvrv:         { value: 'N/A' },
      dominance:    { btc: 58, eth: 12 },
      btcPrice: 0, ethPrice: 0, btcChange: 0, ethChange: 0,
      cycleSummary: 'Data sementara tidak tersedia.',
      topGainers: [], topLosers: [],
    });
  }
}
