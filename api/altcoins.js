// api/altcoins.js — AC369 FUSION v10.3
// CRITICAL FIX: tickers.filter is not a function — ensure array check
// FIXED: RSI Wilder's smoothing dari klines 1H real

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60');

  try {
    // ── FETCH DATA ─────────────────────────────────────────────────
    const [tickerRes, klinesRes] = await Promise.allSettled([
      fetch('https://api.binance.com/api/v3/ticker/24hr', {signal:AbortSignal.timeout(12000)}).then(r=>r.json()),
      Promise.allSettled([
        fetch('https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=1h&limit=100').then(r=>r.json()),
        fetch('https://fapi.binance.com/fapi/v1/klines?symbol=ETHUSDT&interval=1h&limit=100').then(r=>r.json()),
        fetch('https://fapi.binance.com/fapi/v1/klines?symbol=BNBUSDT&interval=1h&limit=100').then(r=>r.json()),
        fetch('https://fapi.binance.com/fapi/v1/klines?symbol=SOLUSDT&interval=1h&limit=100').then(r=>r.json()),
        fetch('https://fapi.binance.com/fapi/v1/klines?symbol=XRPUSDT&interval=1h&limit=100').then(r=>r.json()),
        fetch('https://fapi.binance.com/fapi/v1/klines?symbol=ADAUSDT&interval=1h&limit=100').then(r=>r.json()),
        fetch('https://fapi.binance.com/fapi/v1/klines?symbol=AVAXUSDT&interval=1h&limit=100').then(r=>r.json()),
        fetch('https://fapi.binance.com/fapi/v1/klines?symbol=DOGEUSDT&interval=1h&limit=100').then(r=>r.json()),
        fetch('https://fapi.binance.com/fapi/v1/klines?symbol=LINKUSDT&interval=1h&limit=100').then(r=>r.json()),
        fetch('https://fapi.binance.com/fapi/v1/klines?symbol=DOTUSDT&interval=1h&limit=100').then(r=>r.json()),
      ])
    ]);

    // ── CRITICAL: Ensure tickers is ARRAY ─────────────────────────
    // Binance sometimes returns error object instead of array
    const rawTickers = tickerRes.status === 'fulfilled' ? tickerRes.value : null;
    if (!rawTickers || !Array.isArray(rawTickers)) {
      throw new Error('Ticker response bukan array: ' + JSON.stringify(rawTickers)?.slice(0,100));
    }
    const tickers = rawTickers;

    // ── STABLECOINS FILTER ────────────────────────────────────────
    const STABLES = new Set(['USDT','USDC','BUSD','TUSD','DAI','FDUSD','USDP','SUSD','GUSD','FRAX','LUSD']);
    const IGNORE = new Set(['USDTUSDT','BUSDUSDT','USDCUSDT','TUSDUSDT','FDUSDUSDT']);

    const filtered = tickers.filter(t => {
      if (!t || typeof t !== 'object') return false;
      const sym = String(t.symbol || '');
      if (!sym.endsWith('USDT')) return false;
      if (IGNORE.has(sym)) return false;
      const base = sym.replace('USDT','');
      if (STABLES.has(base)) return false;
      if (['UP','DOWN','BEAR','BULL','3L','3S'].some(p=>base.endsWith(p)||base.startsWith(p))) return false;
      if (parseFloat(t.quoteVolume||0) < 1000000) return false;
      if (parseFloat(t.lastPrice||0) <= 0) return false;
      return true;
    });

    if (!filtered.length) throw new Error('No valid tickers after filter');

    // ── RSI CALCULATION ───────────────────────────────────────────
    const RSI = (closes, p=14) => {
      if (!closes||closes.length<p+1) return 50;
      let g=0,l=0;
      for(let i=1;i<=p;i++){const d=closes[i]-closes[i-1];d>=0?g+=d:l-=d;}
      let ag=g/p,al=l/p;
      for(let i=p+1;i<closes.length;i++){
        const d=closes[i]-closes[i-1];
        ag=(ag*(p-1)+(d>=0?d:0))/p;al=(al*(p-1)+(d<0?-d:0))/p;
      }
      return al===0?100:parseFloat((100-100/(1+ag/al)).toFixed(2));
    };

    // ── TOP GAINERS / LOSERS ─────────────────────────────────────
    const byChange = [...filtered].sort((a,b)=>parseFloat(b.priceChangePercent)-parseFloat(a.priceChangePercent));

    const topGainers = byChange.slice(0,15).map(t=>({
      symbol: t.symbol.replace('USDT',''),
      price: parseFloat(parseFloat(t.lastPrice).toFixed(6)),
      change24h: parseFloat(parseFloat(t.priceChangePercent).toFixed(2))+'%',
      volume: Math.round(parseFloat(t.quoteVolume)),
    }));

    const topLosers = byChange.slice(-10).reverse().map(t=>({
      symbol: t.symbol.replace('USDT',''),
      price: parseFloat(parseFloat(t.lastPrice).toFixed(6)),
      change24h: parseFloat(parseFloat(t.priceChangePercent).toFixed(2))+'%',
      volume: Math.round(parseFloat(t.quoteVolume)),
    }));

    // ── VOLUME BREAKOUTS ──────────────────────────────────────────
    const volumeBreakouts = filtered
      .filter(t => parseFloat(t.quoteVolume)>30000000 && Math.abs(parseFloat(t.priceChangePercent))>3)
      .sort((a,b) => {
        const sA = parseFloat(a.quoteVolume)*Math.abs(parseFloat(a.priceChangePercent));
        const sB = parseFloat(b.quoteVolume)*Math.abs(parseFloat(b.priceChangePercent));
        return sB-sA;
      })
      .slice(0,10)
      .map(t=>({
        symbol: t.symbol.replace('USDT',''),
        price: parseFloat(parseFloat(t.lastPrice).toFixed(6)),
        change24h: parseFloat(parseFloat(t.priceChangePercent).toFixed(2))+'%',
        volumeUSD: Math.round(parseFloat(t.quoteVolume)),
        volumeRatio: (parseFloat(t.quoteVolume)/50000000).toFixed(1)+'x',
        signal: parseFloat(t.priceChangePercent)>0?'Bullish Breakout':'Bearish Breakdown',
      }));

    // ── RSI EXTREMES ──────────────────────────────────────────────
    const MAJORS = ['BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT','ADAUSDT','AVAXUSDT','DOGEUSDT','LINKUSDT','DOTUSDT'];
    const klinesData = klinesRes.status==='fulfilled' ? klinesRes.value : [];
    const rsiExtremes = [];

    for (let i=0; i<MAJORS.length; i++) {
      const sym = MAJORS[i];
      const tickerInfo = tickers.find(t=>t.symbol===sym);
      if (!tickerInfo) continue;
      let rsi = 50, dataSource = 'default';
      try {
        const kr = klinesData[i];
        if (kr?.status==='fulfilled' && Array.isArray(kr.value)) {
          const closes = kr.value.map(k=>parseFloat(k[4])).filter(v=>!isNaN(v)&&v>0);
          if (closes.length>=15) { rsi=RSI(closes,14); dataSource='real'; }
        }
      } catch{}

      let condition='Neutral', condDetail='';
      if(rsi<25){condition='Extreme Oversold';condDetail='Peluang beli kuat';}
      else if(rsi<35){condition='Oversold (Peluang Beli)';condDetail='Potensi reversal naik';}
      else if(rsi>75){condition='Extreme Overbought';condDetail='Waspada distribusi';}
      else if(rsi>65){condition='Overbought (Hati-hati)';condDetail='Potensi koreksi';}
      else if(rsi>50){condition='Bullish Zone';condDetail='Momentum positif';}
      else{condition='Bearish Zone';condDetail='Momentum negatif';}

      rsiExtremes.push({
        symbol:sym.replace('USDT',''),
        price:parseFloat(parseFloat(tickerInfo.lastPrice).toFixed(6)),
        change24h:parseFloat(tickerInfo.priceChangePercent).toFixed(2)+'%',
        rsi:rsi.toFixed(2),condition,condDetail,dataSource
      });
    }

    rsiExtremes.sort((a,b)=>Math.abs(parseFloat(b.rsi)-50)-Math.abs(parseFloat(a.rsi)-50));

    // ── NARRATIVE ─────────────────────────────────────────────────
    const topG = topGainers[0];
    const oversold = rsiExtremes.filter(r=>r.condition.includes('Oversold'));
    const overbought = rsiExtremes.filter(r=>r.condition.includes('Overbought'));
    const volLeads = volumeBreakouts.slice(0,3).map(v=>v.symbol);
    const np=[];
    if(topG) np.push(`🔥 Top gainer: ${topG.symbol} (${topG.change24h}).`);
    if(oversold.length) np.push(`📉 Oversold: ${oversold.map(r=>`${r.symbol} RSI${r.rsi}`).join(', ')} — peluang reversal.`);
    if(overbought.length) np.push(`📈 Overbought: ${overbought.map(r=>r.symbol).join(', ')} — waspada koreksi.`);
    if(volLeads.length) np.push(`📊 Volume breakout: ${volLeads.join(', ')}.`);

    return res.status(200).json({
      timestamp: Date.now(),
      topGainers, topLosers, volumeBreakouts, rsiExtremes,
      narrative: np.join(' ')||'Pasar dalam kondisi normal.',
    });

  } catch(e) {
    return res.status(200).json({
      topGainers:[],topLosers:[],volumeBreakouts:[],rsiExtremes:[],
      narrative:'Data altcoin gagal dimuat: '+e.message
    });
  }
}
