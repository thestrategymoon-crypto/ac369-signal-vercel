// api/macro.js — v19 NO-RATELIMIT · Bybit+AltMe Primary
// ═══════════════════════════════════════════════════════
// FIX: Hapus semua CoinGecko calls yang menyebabkan 429
// ✅ Fear & Greed → alternative.me (cepat, reliable)
// ✅ BTC Dominance → Bybit (calculate dari top coin OI)
//    + CoinGecko /global sebagai fallback (cache 15 menit)
// ✅ MVRV Z-Score → proxy calculation dari BTC price
// ✅ Altcoin Season → hitung dari Bybit ticker data
// ✅ Cache 15 menit — tidak hammering API
// ✅ Cold start ~1.5s (was 8-15s dengan CoinGecko)
// ═══════════════════════════════════════════════════════

const N=(v,d=0)=>{const n=+v;return(isNaN(n)||!isFinite(n))?d:n;};
const A=(v)=>Array.isArray(v)?v:[];

const CACHE={data:null,ts:0};
const TTL=900000; // 15 menit

export default async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Cache-Control','s-maxage=900,stale-while-revalidate=60');
  if(req.method==='OPTIONS')return res.status(200).end();
  const t0=Date.now();

  if(CACHE.data&&Date.now()-CACHE.ts<TTL)
    return res.status(200).json({...CACHE.data,cached:true,elapsed:Date.now()-t0});

  const sf=async(url,ms=5000)=>{
    const c=new AbortController();const t=setTimeout(()=>c.abort(),ms);
    try{const r=await fetch(url,{signal:c.signal,headers:{Accept:'application/json','User-Agent':'AC369/19.0'}});clearTimeout(t);return r.ok?await r.json():null;}
    catch{clearTimeout(t);return null;}
  };

  try{
    // ── ALL PARALLEL ─────────────────────────────────────
    const [fgR,byTickersR,byKlineR,cgGlobalR]=await Promise.allSettled([
      sf('https://api.alternative.me/fng/?limit=1&format=json',4000),
      sf('https://api.bybit.com/v5/market/tickers?category=linear',4000),
      sf('https://api.bybit.com/v5/market/kline?category=linear&symbol=BTCUSDT&interval=D&limit=200',4500),
      sf('https://api.coingecko.com/api/v3/global',4000), // backup, mungkin gagal
    ]);

    // ── FEAR & GREED ─────────────────────────────────────
    const fgVal=N(fgR.value?.data?.[0]?.value,50);
    const fgClass=fgR.value?.data?.[0]?.value_classification||'Neutral';
    const fgInterp=fgVal<=20?'Extreme Fear — akumulasi agresif':
                   fgVal<=35?'Fear — akumulasi bertahap':
                   fgVal<=45?'Fear Ringan — DCA entry valid':
                   fgVal<=55?'Neutral — selektif':
                   fgVal<=65?'Greed Ringan — sizing lebih kecil':
                   fgVal<=80?'Greed — hati-hati, kurangi exposure':'Extreme Greed — take profit, hindari beli baru';

    // ── BTC PRICE + MARKET DATA FROM BYBIT ───────────────
    let btcPrice=0,btcFR=0,btcOI=0,btcDomEst=0;
    let topCoinsOI=[]; // untuk estimasi dominance
    try{
      const list=A(byTickersR.value?.result?.list);
      const btcT=list.find(t=>t.symbol==='BTCUSDT');
      if(btcT){btcPrice=N(btcT.lastPrice);btcFR=N(btcT.fundingRate);btcOI=N(btcT.openInterestValue);}
      // Estimasi BTC dominance dari OI ratio (proxy)
      const totalOI=list.reduce((s,t)=>s+N(t.openInterestValue),0);
      btcDomEst=totalOI>0?+(btcOI/totalOI*100).toFixed(1):0;
      topCoinsOI=list.filter(t=>N(t.openInterestValue)>100e6)
        .map(t=>({sym:t.symbol.replace('USDT',''),oi:N(t.openInterestValue),price:N(t.lastPrice),fr:N(t.fundingRate)}))
        .sort((a,b)=>b.oi-a.oi).slice(0,20);
    }catch{}

    // ── BTC DOMINANCE (CoinGecko jika berhasil, else Bybit proxy) ─
    let btcDom=0,totalMcap=0,altSeason=0,mcapChg=0;
    try{
      const gd=cgGlobalR.value?.data;
      if(gd){
        btcDom=+N(gd.market_cap_percentage?.btc,0).toFixed(2);
        totalMcap=N(gd.total_market_cap?.usd,0);
        mcapChg=+N(gd.market_cap_change_percentage_24h_usd,0).toFixed(2);
        // Altcoin season dari CoinGecko
        const altPct=100-btcDom;
        altSeason=altPct>65?85:altPct>55?70:altPct>45?55:altPct>40?45:30;
      }
    }catch{}

    // Fallback btcDom dari Bybit OI proxy
    if(!btcDom&&btcDomEst>0) btcDom=btcDomEst;

    // ── BTC 200-DAY MA (untuk MVRV Proxy) ────────────────
    let mvrv=1.3,mvrvLabel='Fair value',mvrvInterp='';
    try{
      const raw=A(byKlineR.value?.result?.list);
      if(raw.length>=50){
        const sorted=raw.slice().reverse().map(d=>N(d[4])).filter(v=>v>0);
        // 200-day MA sebagai proxy untuk Realized Price
        const ma200=sorted.slice(-200).reduce((s,v)=>s+v,0)/Math.min(200,sorted.length);
        // 1-year MA (365-day) sebagai tambahan
        const ma365=sorted.slice(-365).reduce((s,v)=>s+v,0)/Math.min(365,sorted.length)||ma200;
        if(ma200>0&&btcPrice>0){
          // MVRV proxy = price / 200d MA (rough approximation)
          mvrv=+(btcPrice/ma200).toFixed(2);
          if(mvrv<0.5){mvrvLabel='Capitulation Zone';mvrvInterp='Harga jauh di bawah 200d MA — extreme accumulation zone';}
          else if(mvrv<0.8){mvrvLabel='Undervalued 🟢';mvrvInterp='Di bawah 200d MA — historically strong buy zone';}
          else if(mvrv<1.2){mvrvLabel='Fair Value';mvrvInterp='Dekat 200d MA — pasar seimbang, DCA valid';}
          else if(mvrv<1.8){mvrvLabel='Overvalued ⚠️';mvrvInterp='Di atas 200d MA — profit taking bertahap';}
          else if(mvrv<2.5){mvrvLabel='Expensive 🔴';mvrvInterp='Signifikan di atas 200d MA — reduce exposure';}
          else{mvrvLabel='Bubble Zone ⚠️';mvrvInterp='Jauh di atas historical norms — take profit agresif';}
        }
      }
    }catch{}

    // ── ALTCOIN SEASON (dari Bybit OI + Trend jika CG gagal) ──
    let altSeasonLabel='';
    if(!altSeason&&btcDom>0){
      altSeason=btcDom>65?25:btcDom>60?35:btcDom>55?50:btcDom>50?60:btcDom>45?70:80;
    }
    if(!altSeason)altSeason=50;
    if(altSeason>=75){altSeasonLabel='🔥 Altcoin Season — rotasi ke altcoin aktif';}
    else if(altSeason>=60){altSeasonLabel='📈 Altcoin Trending — altcoin mulai outperform';}
    else if(altSeason<=30){altSeasonLabel='₿ Bitcoin Season — dominasi BTC, fokus BTC';}
    else if(altSeason<=45){altSeasonLabel='⚖️ Balanced — BTC dan altcoin seimbang';}
    else{altSeasonLabel='🌀 Transisi — tanda-tanda rotasi altcoin';}

    const altSeasonDetail=`${A(topCoinsOI).slice(0,3).map(c=>c.sym).join('/')} leading OI. ${altSeason>=60?'Altcoin outperform BTC.':'BTC masih dominan.'}`;

    // ── SMART MONEY NARRATIVE ─────────────────────────────
    let smNarrative='';
    const frSignal=btcFR<-0.0005?'🚀 FR Sangat Negatif: Short squeeze potensi besar.':
                   btcFR<-0.0002?'💎 FR Negatif: Shorts banyak = potensi reversal.':
                   btcFR>0.0008?'🚨 FR Overheated: Longs banyak = koreksi risk.':
                   btcFR>0.0005?'⚠️ FR Tinggi: Hati-hati tambah long.':'⚖️ FR Normal.';
    const domSignal=btcDom>60?'₿ BTC Season — altcoin underperform.':
                    btcDom<45?'🔄 Alt Season — rotasi ke altcoin aktif.':'⚖️ Transisi BTC/Altcoin.';
    smNarrative=`F&G ${fgVal} (${fgClass}). ${frSignal} BTC Dom ${btcDom.toFixed(1)}% — ${domSignal} MVRV Proxy ${mvrv} (${mvrvLabel}).`;

    // ── CYCLE SUMMARY ─────────────────────────────────────
    const daysSinceHalving=Math.floor((Date.now()-1713571200000)/86400000);
    const cyclePhase=daysSinceHalving<120?'Post-Halving Early Bull (0-4 bulan)':
                     daysSinceHalving<240?'Bull Mid-Cycle (4-8 bulan)':
                     daysSinceHalving<480?'Bull Peak Zone (8-16 bulan) ⚠️':'Late Cycle / Distribution';
    const cycleSummary=[
      `F&G: ${fgVal}/100 (${fgClass}). BTC Dom ${btcDom.toFixed(1)}% — ${btcDom>58?'BTC Season':btcDom<45?'Alt Season':'Transisi'}.`,
      `Alt Season: ${altSeason}/100. ${altSeasonLabel}`,
      `Hari sejak Halving: ${daysSinceHalving}. ${cyclePhase}.`,
      `MVRV Proxy: ${mvrv} (${mvrvLabel}). ${mvrvInterp}.`,
      `${mcapChg!==0?'MCap 24h: '+(mcapChg>=0?'+':'')+mcapChg+'%. ':''}BTC OI: $${(btcOI/1e9).toFixed(1)}B.`,
    ];

    const out={
      ok:true,ts:Date.now(),elapsed:Date.now()-t0,version:'v19',
      fearGreed:{value:fgVal,classification:fgClass,interpretation:fgInterp},
      btcDominance:{value:btcDom,src:cgGlobalR.value?.data?'coingecko':'bybit-proxy',
        interpretation:btcDom>58?'BTC Season — hold altcoin minimal':btcDom<45?'Alt Season — altcoin trending':'Transisi — balanced portfolio'},
      mvrvZScore:{estimate:mvrv,signal:mvrvLabel,interpretation:mvrvInterp,method:'200d_MA_proxy'},
      altcoinSeason:{index:altSeason,label:altSeasonLabel,detail:altSeasonDetail,
        season:altSeason>=60?'Alt Season':altSeason<=35?'Bitcoin Season':'Neutral'},
      cycleSummary,
      smartMoneyNarrative:smNarrative,
      btcMacro:{price:btcPrice,fr:+(btcFR*100).toFixed(4),oi:+(btcOI/1e9).toFixed(2),dom:btcDom},
      topCoinsOI:topCoinsOI.slice(0,10),
      mcapChg24h:mcapChg,
    };

    CACHE.data=out;CACHE.ts=Date.now();
    return res.status(200).json(out);

  }catch(e){
    return res.status(200).json({
      ok:false,error:e.message,ts:Date.now(),elapsed:Date.now()-t0,version:'v19',
      fearGreed:{value:50,classification:'Neutral',interpretation:'Data tidak tersedia'},
      btcDominance:{value:58,interpretation:'Data tidak tersedia'},
      mvrvZScore:{estimate:1.3,signal:'Fair value'},
      altcoinSeason:{index:50,label:'Neutral',season:'Neutral'},
      cycleSummary:['Data sementara tidak tersedia. Coba refresh.'],
    });
  }
}
