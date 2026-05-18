// api/macro.js — v16 FIX
// ROOT CAUSE FIX: Use specific 30-symbol list, not all 2000 tickers
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60');
  if (req.method === 'OPTIONS') return res.status(200).end();
  const t0 = Date.now();
  const sf = async (url, ms) => {
    const c = new AbortController(); const t = setTimeout(() => c.abort(), ms);
    try { const r = await fetch(url, { signal: c.signal, headers: { Accept: 'application/json', 'User-Agent': 'AC369/1.0' } }); clearTimeout(t); if (!r.ok) return null; return await r.json(); }
    catch { clearTimeout(t); return null; }
  };
  const ALT_SYMS = ['ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT','ADAUSDT','AVAXUSDT','DOGEUSDT','LINKUSDT','DOTUSDT','MATICUSDT','NEARUSDT','ATOMUSDT','LTCUSDT','UNIUSDT','ARBUSDT','OPUSDT','APTUSDT','INJUSDT','SUIUSDT','TIAUSDT','FETUSDT','RENDERUSDT','LDOUSDT','GRTUSDT','WLDUSDT','TONUSDT','SEIUSDT','PEPEUSDT','SHIBUSDT','JUPUSDT'];
  const symParam = encodeURIComponent(JSON.stringify(ALT_SYMS));
  try {
    const [fngR, glR, altsR, btcR] = await Promise.allSettled([
      sf('https://api.alternative.me/fng/?limit=14&format=json', 4000),
      sf('https://api.coingecko.com/api/v3/global', 4000),
      sf('https://api.binance.com/api/v3/ticker/24hr?symbols=' + symParam, 6000),
      sf('https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT', 3000),
    ]);
    const fngData = fngR.status === 'fulfilled' ? fngR.value?.data || [] : [];
    const fgVal   = fngData[0] ? parseInt(fngData[0].value) : 50;
    const fgCls   = fngData[0]?.value_classification || 'Neutral';
    const fgHist  = fngData.slice(0,7).map(d => ({ value: parseInt(d.value), label: d.value_classification, date: new Date(d.timestamp*1000).toLocaleDateString('id-ID',{day:'numeric',month:'short'}) }));
    const fearGreed = { value: fgVal, classification: fgCls, history: fgHist, signal: fgVal<=20?'EXTREME_FEAR_BUY':fgVal<=40?'FEAR':fgVal<=60?'NEUTRAL':fgVal<=80?'GREED':'EXTREME_GREED_SELL', interpretation: fgVal<=20?'🔥 Extreme Fear — zona akumulasi terbaik':fgVal<=40?'😨 Fear — akumulasi bertahap':fgVal<=60?'😐 Netral':fgVal<=80?'😄 Greed — waspada':'🤑 Extreme Greed — distribusi' };
    const gld = glR.status === 'fulfilled' ? glR.value?.data : null;
    const btcDomV = gld?.market_cap_percentage?.btc ? +gld.market_cap_percentage.btc.toFixed(2) : 58;
    const ethDomV = gld?.market_cap_percentage?.eth ? +gld.market_cap_percentage.eth.toFixed(2) : 12;
    const btcDominance = { value: btcDomV, dominance: btcDomV.toFixed(2)+'%', eth: ethDomV.toFixed(2)+'%', totalMarketCap: gld?.total_market_cap?.usd||0, marketCapChange24h: gld?.market_cap_change_percentage_24h_usd?+gld.market_cap_change_percentage_24h_usd.toFixed(2):0, interpretation: btcDomV>62?'BTC Dominasi Ekstrem — altcoin sangat lemah':btcDomV>57?'BTC Season — hold altcoin minimal':btcDomV>50?'Transisi — rotasi ke altcoin mulai':btcDomV>45?'Altcoin Season Awal':'Altcoin Season Aktif 🚀', signal: btcDomV>58?'BTC_SEASON':btcDomV<45?'ALT_SEASON':'TRANSITION' };
    const btcTick = btcR.status === 'fulfilled' ? btcR.value : null;
    const btcPx   = btcTick?.lastPrice ? +btcTick.lastPrice : 0;
    const REALIZED = 56576;
    const mvProxy  = btcPx > 0 ? +(btcPx / REALIZED).toFixed(2) : null;
    const mvrvZScore = { value: mvProxy?.toString()||'N/A', estimate: mvProxy, interpretation: !mvProxy?'Data tidak tersedia':mvProxy<0.8?'🔥 Extreme Undervalue':mvProxy<1.2?'🟢 Fair value (cheap)':mvProxy<1.8?'⚖️ Fair value':mvProxy<2.5?'⚠️ Mulai mahal':mvProxy<3.5?'🔴 Bubble':'💀 Extreme bubble', signal: !mvProxy?'NEUTRAL':mvProxy<1.2?'BUY':mvProxy>3.0?'SELL':'HOLD' };
    const altsData = altsR.status === 'fulfilled' && Array.isArray(altsR.value) ? altsR.value : [];
    const btcChg   = btcTick?.priceChangePercent ? +btcTick.priceChangePercent : 0;
    const tMap = {}; altsData.forEach(t => { if (t?.symbol) tMap[t.symbol] = +t.priceChangePercent; });
    let out = 0, tot = 0;
    ALT_SYMS.forEach(s => { if (tMap[s] !== undefined) { tot++; if (tMap[s] > btcChg) out++; } });
    const altIdx = tot > 0 ? Math.round(out/tot*100) : 50;
    const altLabel = altIdx>=75?'🚀 Altcoin Season!':altIdx>=55?'📈 Altcoin Trending':altIdx>=25?'⚖️ Mixed Market':'₿ Bitcoin Season';
    const altcoinSeason = { index: altIdx, label: altLabel, season: altLabel, detail: tot>0?`${out}/${tot} altcoin outperform BTC (24h).`:'Data tidak tersedia.', value: altIdx };
    const dsh = Math.floor((Date.now()-1713571200000)/86400000);
    let cyclePhase, cycleDetail, warning = null;
    if (dsh<90){cyclePhase='Post-Halving Early';cycleDetail=`Hari ${dsh}. Historis: sideways dulu, lalu bull run.`;}
    else if (dsh<365){cyclePhase='🔥 Bull Cycle Early';cycleDetail=`Hari ${dsh}. Periode terbaik akumulasi.`;}
    else if (dsh<480){cyclePhase='⚡ Bull Cycle Peak Zone';cycleDetail=`Hari ${dsh}. Zona puncak historis.`;warning='Pertimbangkan partial profit taking.';}
    else if (dsh<730){cyclePhase='⚠️ Late Bull / Distribution';cycleDetail=`Hari ${dsh}. Smart money exit bertahap.`;warning='Kurangi exposure.';}
    else{cyclePhase='🌱 Accumulation';cycleDetail=`Hari ${dsh}. DCA zone terbaik.`;}
    const jd=Date.now()/86400000+2440587.5; const dnm=((jd-2460320.5)%29.53058867+29.53058867)%29.53058867;
    const phases=[[1.5,'New Moon','🌑'],[7.5,'Waxing Crescent','🌒'],[8.5,'First Quarter','🌓'],[14,'Waxing Gibbous','🌔'],[16,'Full Moon','🌕'],[22,'Waning','🌖']];
    let moonPhase='Dark Moon',moonEmoji='🌘';
    for(const[lim,ph,em]of phases){if(dnm<lim){moonPhase=ph;moonEmoji=em;break;}}
    const cycleSummary = [`F&G: ${fgVal}/100 (${fgCls}).`,`BTC Dom ${btcDomV}% — ${btcDomV>55?'BTC season':btcDomV<45?'Alt season aktif 🚀':'Transisi'}.`,altIdx>=75?'🚀 Altcoin season aktif.':altIdx<25?'₿ Bitcoin season.':altLabel+'.',cycleDetail,mvProxy?`MVRV proxy: ${mvProxy} (${mvrvZScore.signal}).`:'',warning?`⚠️ ${warning}`:''].filter(Boolean).join(' ');
    return res.status(200).json({ ok:true, ts:Date.now(), elapsed:Date.now()-t0, version:'v16', fearGreed, btcDominance, mvrvZScore, altcoinSeason, mvrv:mvrvZScore, dominance:{btc:btcDomV,eth:ethDomV}, cycleSummary, marketSummary:cycleSummary, cycle:{phase:cyclePhase,detail:cycleDetail,warning,daysSinceHalving:dsh}, moonPhase:{phase:moonPhase,emoji:moonEmoji,daysSinceNM:+dnm.toFixed(1)} });
  } catch(e) {
    return res.status(200).json({ ok:false, error:e.message, ts:Date.now(), elapsed:Date.now()-t0, version:'v16', fearGreed:{value:50,classification:'Neutral',history:[]}, btcDominance:{value:58,dominance:'58.00%',interpretation:'₿ BTC Season'}, mvrvZScore:{value:'N/A',signal:'NEUTRAL'}, altcoinSeason:{index:50,label:'⚖️ Mixed Market',season:'⚖️ Mixed Market'}, mvrv:{value:'N/A'}, dominance:{btc:58,eth:12}, cycleSummary:'Data tidak tersedia.' });
  }
}
