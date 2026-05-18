// api/macro.js — v18
// Reduce CoinGecko calls: 2 only (global + markets)
// Remove /simple/price — use Bybit for BTC price instead
// This fixes CoinGecko rate limit issues

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
      clearTimeout(t); if (!r.ok) return null; return await r.json();
    } catch { clearTimeout(t); return null; }
  };

  try {
    // ── 3 calls only — 2 CoinGecko + 1 Alternative.me ────
    // Removed /simple/price to reduce CoinGecko rate limit pressure
    const [fngR, cgGlobalR, cgMarketsR] = await Promise.allSettled([
      sf('https://api.alternative.me/fng/?limit=14&format=json', 4000),
      sf('https://api.coingecko.com/api/v3/global', 5000),
      // Top 50 only (faster, less likely to timeout than top 100)
      sf('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=50&page=1&sparkline=false&price_change_percentage=24h', 6000),
    ]);

    // ── F&G ────────────────────────────────────────────────
    const fngData  = fngR.status === 'fulfilled' ? (fngR.value?.data || []) : [];
    const fgVal    = fngData[0] ? parseInt(fngData[0].value) : 50;
    const fgCls    = fngData[0]?.value_classification || 'Neutral';
    const fgHist   = fngData.slice(0, 7).map(d => ({
      value: parseInt(d.value), label: d.value_classification,
      date: new Date(d.timestamp * 1000).toLocaleDateString('id-ID', {day:'numeric',month:'short'}),
    }));
    const fearGreed = {
      value: fgVal, classification: fgCls, history: fgHist,
      signal: fgVal<=20?'EXTREME_FEAR':fgVal<=40?'FEAR':fgVal<=60?'NEUTRAL':fgVal<=80?'GREED':'EXTREME_GREED',
      interpretation: fgVal<=20?'🔥 Extreme Fear — zona akumulasi terbaik'
                    : fgVal<=40?'😨 Fear — akumulasi bertahap'
                    : fgVal<=60?'😐 Netral'
                    : fgVal<=80?'😄 Greed — waspada koreksi'
                    : '🤑 Extreme Greed — distribusi smart money',
    };

    // ── GLOBAL / BTC DOM ───────────────────────────────────
    const cgG     = cgGlobalR.status === 'fulfilled' ? cgGlobalR.value?.data : null;
    const btcDomV = cgG?.market_cap_percentage?.btc ? +cgG.market_cap_percentage.btc.toFixed(2) : 58;
    const ethDomV = cgG?.market_cap_percentage?.eth ? +cgG.market_cap_percentage.eth.toFixed(2) : 12;
    const totalMC = cgG?.total_market_cap?.usd || 0;
    const mcChg24 = cgG?.market_cap_change_percentage_24h_usd
      ? +cgG.market_cap_change_percentage_24h_usd.toFixed(2) : 0;
    const defiPct = cgG?.defi_market_cap && totalMC
      ? +(cgG.defi_market_cap / totalMC * 100).toFixed(2) : null;

    const btcDominance = {
      value: btcDomV, dominance: btcDomV.toFixed(2)+'%', eth: ethDomV.toFixed(2)+'%',
      totalMarketCap: totalMC, marketCapChange24h: mcChg24, defiPct,
      interpretation: btcDomV>62?'BTC Dominasi Ekstrem — altcoin sangat lemah'
                    : btcDomV>57?'BTC Season — hold altcoin minimal'
                    : btcDomV>50?'Transisi — rotasi ke altcoin mulai'
                    : btcDomV>45?'Altcoin Season Awal'
                    : 'Altcoin Season Aktif 🚀',
      signal: btcDomV>58?'BTC_SEASON':btcDomV<45?'ALT_SEASON':'TRANSITION',
    };

    // ── PRICES dari CoinGecko markets top 50 ──────────────
    const markets  = cgMarketsR.status === 'fulfilled' && Array.isArray(cgMarketsR.value)
      ? cgMarketsR.value : [];

    // BTC price from markets list
    const btcRow  = markets.find(c => c.id === 'bitcoin');
    const ethRow  = markets.find(c => c.id === 'ethereum');
    const btcPx   = btcRow?.current_price  || 0;
    const ethPx   = ethRow?.current_price  || 0;
    const btcCh   = btcRow?.price_change_percentage_24h ? +btcRow.price_change_percentage_24h.toFixed(2) : 0;
    const ethCh   = ethRow?.price_change_percentage_24h ? +ethRow.price_change_percentage_24h.toFixed(2) : 0;
    const btcMCap = btcRow?.market_cap || 0;

    // ── MVRV PROXY ─────────────────────────────────────────
    const REALIZED  = 56576;
    const mvProxy   = btcPx > 0 ? +(btcPx / REALIZED).toFixed(2) : null;
    const mvrvZScore = {
      value: mvProxy?.toString() || 'N/A', estimate: mvProxy,
      signal: !mvProxy?'NEUTRAL':mvProxy<1.2?'BUY':mvProxy>3.0?'SELL':'HOLD',
      interpretation: !mvProxy?'Data tidak tersedia'
                    : mvProxy<0.8?'🔥 Extreme Undervalue — beli kuat'
                    : mvProxy<1.2?'🟢 Fair value — cheap zone'
                    : mvProxy<1.8?'⚖️ Fair value zone'
                    : mvProxy<2.5?'⚠️ Mulai mahal'
                    : mvProxy<3.5?'🔴 Bubble territory'
                    : '💀 Extreme bubble',
      note: 'Proxy: price / realized_price ($'+REALIZED.toLocaleString()+')',
    };

    // ── ALTCOIN SEASON dari CoinGecko markets ─────────────
    let altOut = 0, altTotal = 0;
    if (markets.length > 0) {
      const btcPerf = btcRow?.price_change_percentage_24h ?? btcCh;
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
      index: altIdx, label: altLabel, season: altLabel, value: altIdx,
      detail: `${altOut}/${altTotal} altcoin outperform BTC (24h, top ${altTotal} by MCap).`,
    };

    // ── TOP GAINERS / LOSERS ───────────────────────────────
    const sortable = markets.filter(c => c.id !== 'bitcoin' && (c.total_volume||0) > 500000);
    const mkC = c => ({symbol:(c.symbol||'').toUpperCase(), price:c.current_price, change:+(c.price_change_percentage_24h||0).toFixed(2), volume:Math.round(c.total_volume||0), mcap:Math.round(c.market_cap||0)});
    const topGainers = [...sortable].sort((a,b)=>(b.price_change_percentage_24h||0)-(a.price_change_percentage_24h||0)).slice(0,10).map(mkC);
    const topLosers  = [...sortable].sort((a,b)=>(a.price_change_percentage_24h||0)-(b.price_change_percentage_24h||0)).slice(0,10).map(mkC);

    // ── MARKET CYCLE ───────────────────────────────────────
    const dsh = Math.floor((Date.now() - 1713571200000) / 86400000);
    let cyclePhase, cycleDetail, warning = null;
    if      (dsh < 90)  { cyclePhase = 'Post-Halving Early';          cycleDetail = `Hari ${dsh}. Historis: sideways 2-3 bulan, lalu bull run.`; }
    else if (dsh < 365) { cyclePhase = '🔥 Bull Cycle Early';         cycleDetail = `Hari ${dsh}. Periode terbaik akumulasi. Smart money accumulating.`; }
    else if (dsh < 480) { cyclePhase = '⚡ Bull Cycle Peak Zone';     cycleDetail = `Hari ${dsh}. Zona puncak historis. Pertimbangkan profit taking.`; warning = 'BTC historis puncak 12-18 bulan post-halving.'; }
    else if (dsh < 730) { cyclePhase = '⚠️ Late Bull / Distribution'; cycleDetail = `Hari ${dsh}. Smart money exit bertahap.`; warning = 'Kurangi exposure jika belum profit taking.'; }
    else                { cyclePhase = '🌱 Accumulation';              cycleDetail = `Hari ${dsh}. Bear market bottom. DCA zone terbaik.`; }

    // Moon phase
    const jd  = Date.now() / 86400000 + 2440587.5;
    const dnm = ((jd - 2460320.5) % 29.53058867 + 29.53058867) % 29.53058867;
    const phases = [[1.5,'New Moon','🌑'],[7.5,'Waxing Crescent','🌒'],[8.5,'First Quarter','🌓'],[14,'Waxing Gibbous','🌔'],[16,'Full Moon','🌕'],[22,'Waning Gibbous','🌖'],[25,'Last Quarter','🌗'],[29.5,'Waning Crescent','🌘']];
    let moonPhase = 'Dark Moon', moonEmoji = '🌑';
    for (const [lim,ph,em] of phases) { if (dnm < lim) { moonPhase = ph; moonEmoji = em; break; } }

    // Cycle summary
    const cycleSummary = [
      `F&G: ${fgVal}/100 (${fgCls}).`,
      `BTC Dom ${btcDomV}% — ${btcDomV>57?'BTC season.':btcDomV<45?'Altcoin season 🚀':'Transisi.'}`,
      altIdx >= 75 ? '🚀 Altcoin season aktif.' : altIdx < 25 ? '₿ Bitcoin season.' : altLabel+'.',
      cycleDetail,
      mvProxy ? `MVRV proxy: ${mvProxy} (${mvrvZScore.signal}).` : '',
      warning ? `⚠️ ${warning}` : '',
    ].filter(Boolean).join(' ');

    return res.status(200).json({
      ok: true, ts: Date.now(), elapsed: Date.now()-t0, version: 'v18',
      src: 'coingecko+alternative.me',
      fearGreed, btcDominance, mvrvZScore, altcoinSeason,
      mvrv: mvrvZScore, dominance: {btc:btcDomV,eth:ethDomV},
      btcPrice: btcPx, ethPrice: ethPx, btcChange: btcCh, ethChange: ethCh, btcMCap,
      totalMarketCap: totalMC, marketCapChange: mcChg24, defiPct,
      cycleSummary, marketSummary: cycleSummary,
      cycle: {phase:cyclePhase,detail:cycleDetail,warning,daysSinceHalving:dsh},
      moonPhase: {phase:moonPhase,emoji:moonEmoji,daysSinceNM:+dnm.toFixed(1)},
      topGainers, topLosers,
    });

  } catch (e) {
    return res.status(200).json({
      ok: false, error: e.message, ts: Date.now(), elapsed: Date.now()-t0, version: 'v18',
      fearGreed: {value:50,classification:'Neutral',history:[]},
      btcDominance: {value:58,dominance:'58.00%',interpretation:'₿ BTC Season',signal:'BTC_SEASON'},
      mvrvZScore: {value:'N/A',signal:'NEUTRAL',interpretation:'Data tidak tersedia'},
      altcoinSeason: {index:50,label:'⚖️ Mixed Market',season:'⚖️ Mixed Market',detail:''},
      mvrv: {value:'N/A'}, dominance: {btc:58,eth:12},
      btcPrice:0, ethPrice:0, btcChange:0, ethChange:0,
      cycleSummary: 'Data sementara tidak tersedia.', topGainers:[], topLosers:[],
    });
  }
}
