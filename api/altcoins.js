// api/altcoins.js — v21 CACHED · CoinGecko Rate-Limit Fix
// ═══════════════════════════════════════════════════════
// FIX: Tambah module-level cache 10 menit
// ✅ Pertama kali: CoinGecko + MEXC (bisa lambat)
// ✅ Request berikutnya: instant dari cache
// ✅ Bybit sebagai fallback jika CG gagal
// ✅ Timeout 3.5s per call (sebelumnya tidak ada batas)
// ═══════════════════════════════════════════════════════

const N=(v,d=0)=>{const n=+v;return(isNaN(n)||!isFinite(n))?d:n;};
const A=(v)=>Array.isArray(v)?v:[];
const STABLES=new Set(['USDT','USDC','BUSD','DAI','TUSD','FDUSD','USDD','FRAX','GUSD','USDP','LUSD','PYUSD','USDE','EURC']);
const BAD=['UP','DOWN','BULL','BEAR','LONG','SHORT','3L','3S'];

const CACHE={data:null,ts:0};
const TTL=600000; // 10 menit cache

const rsiCol=v=>v<=30?'green':v<=42?'lightgreen':v>=80?'red':v>=65?'orange':'gray';
const calcRSI=a=>{try{if(!a||a.length<16)return null;let g=0,l=0;for(let i=1;i<=14;i++){const d=a[i]-a[i-1];d>0?g+=d:l-=d;}g/=14;l/=14;for(let i=15;i<a.length;i++){const d=a[i]-a[i-1];g=(g*13+Math.max(d,0))/14;l=(l*13+Math.max(-d,0))/14;}return l===0?100:Math.max(0,Math.min(100,100-100/(1+g/l)));}catch{return null;}};
const fmtV=v=>v>=1e9?'$'+(v/1e9).toFixed(1)+'B':v>=1e6?'$'+(v/1e6).toFixed(0)+'M':v>=1e3?'$'+(v/1e3).toFixed(0)+'K':'$'+Math.round(v);

export default async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Cache-Control','s-maxage=600,stale-while-revalidate=120');
  if(req.method==='OPTIONS')return res.status(200).end();
  const t0=Date.now();

  // CACHE — kunci utama mencegah CoinGecko rate limit
  if(CACHE.data&&Date.now()-CACHE.ts<TTL)
    return res.status(200).json({...CACHE.data,cached:true,elapsed:Date.now()-t0});

  const sf=async(url,ms=3500)=>{
    const c=new AbortController();const t=setTimeout(()=>c.abort(),ms);
    try{const r=await fetch(url,{signal:c.signal,headers:{Accept:'application/json','User-Agent':'AC369/21.0'}});clearTimeout(t);return r.ok?await r.json():null;}
    catch{clearTimeout(t);return null;}
  };

  try{
    // PARALLEL: CG + MEXC + FG + Bybit tickers (semua sekaligus, max 3.5s)
    const [cgR,cgR2,mxR,fgR,byR]=await Promise.allSettled([
      sf('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=volume_desc&per_page=250&page=1&sparkline=false&price_change_percentage=24h,7d',3500),
      sf('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=volume_desc&per_page=250&page=2&sparkline=false&price_change_percentage=24h,7d',3500),
      sf('https://api.mexc.com/api/v3/ticker/24hr',3500),
      sf('https://api.alternative.me/fng/?limit=1&format=json',3000),
      sf('https://api.bybit.com/v5/market/tickers?category=linear',3000),
    ]);

    const fg=N(fgR.value?.data?.[0]?.value,50);

    // BUILD COIN LIST (CG primary, MEXC fill gaps, Bybit prices as backup)
    const byMap={};
    for(const t of A(byR.value?.result?.list)){try{const s=String(t.symbol||'').replace('USDT','').replace('PERP','');if(s)byMap[s]={p:N(t.lastPrice),c24:N(t.price24hPcnt)*100,vol:N(t.turnover24h)};}catch{}}

    const coins=[];const seen=new Set();
    // CoinGecko pages
    for(const pg of [cgR,cgR2]){for(const c of A(pg.value)){try{const sym=String(c.symbol||'').toUpperCase();if(!sym||seen.has(sym)||STABLES.has(sym))continue;seen.add(sym);const p=N(c.current_price);if(p<=0)continue;coins.push({symbol:sym,price:p,ch24:N(c.price_change_percentage_24h),ch7d:c.price_change_percentage_7d!=null?N(c.price_change_percentage_7d):null,vol:N(c.total_volume),h:N(c.high_24h)||p*1.02,l:N(c.low_24h)||p*0.98,mcap:N(c.market_cap),rank:N(c.market_cap_rank,9999),src:'cg'});}catch{}}}
    // MEXC fills gaps
    const mxArr=A(mxR.value);mxArr.sort((a,b)=>N(b?.quoteVolume)-N(a?.quoteVolume));
    for(const t of mxArr.slice(0,600)){try{if(!String(t?.symbol).endsWith('USDT'))continue;const sym=String(t.symbol).replace('USDT','');if(!sym||seen.has(sym)||STABLES.has(sym)||BAD.some(x=>sym.endsWith(x)||sym.startsWith(x)))continue;const p=N(t.lastPrice);if(p<=0||p>1e10)continue;if(p>=0.97&&p<=1.03&&Math.abs(N(t.priceChangePercent))<0.5)continue;const v=N(t.quoteVolume);if(v<200000)continue;seen.add(sym);coins.push({symbol:sym,price:p,ch24:N(t.priceChangePercent),ch7d:null,vol:v,h:N(t.highPrice)||p*1.02,l:N(t.lowPrice)||p*0.98,mcap:0,rank:9999,src:'mx'});}catch{}}

    // FALLBACK: jika CG dan MEXC semua gagal, gunakan Bybit
    if(coins.length<10){
      for(const[sym,d]of Object.entries(byMap)){if(!seen.has(sym)&&!STABLES.has(sym)&&d.p>0&&d.vol>1e6){seen.add(sym);coins.push({symbol:sym,price:d.p,ch24:d.c24,ch7d:null,vol:d.vol,h:d.p*1.02,l:d.p*0.98,mcap:0,rank:9999,src:'bybit'});}}
    }

    if(coins.length===0)throw new Error('No coin data available');

    // MARKET OVERVIEW
    const pos=coins.filter(c=>c.ch24>0).length,neg=coins.filter(c=>c.ch24<0).length;
    const avg24=+(coins.reduce((s,c)=>s+c.ch24,0)/coins.length).toFixed(2);
    const sig=avg24>2?'BULLISH':avg24<-2?'BEARISH':'NEUTRAL';
    const bigMove=coins.filter(c=>Math.abs(c.ch24)>10).length;
    const totalVol=coins.reduce((s,c)=>s+c.vol,0);

    // TOP GAINERS (sort by ch24)
    const gainers=coins.filter(c=>c.ch24>0&&c.vol>500000)
      .sort((a,b)=>b.ch24-a.ch24).slice(0,30)
      .map(c=>({symbol:c.symbol,price:c.price,ch24:+c.ch24.toFixed(2),vol:c.vol,sector:'ALT'}));

    // VOLUME BREAKOUTS
    const volBreakouts=coins.filter(c=>c.vol>3e6)
      .sort((a,b)=>b.vol-a.vol).slice(0,30)
      .map(c=>{
        const pip=c.h>c.l?(c.price-c.l)/(c.h-c.l)*100:50;
        const bt=c.ch24>5&&pip>60?'BREAKOUT 🚀':c.ch24>2&&pip>50?'Bull Flow':c.ch24<-5&&pip<40?'Bear Flow':c.ch24<0?'Selling Pressure':'STEALTH 👁';
        const bc=bt.includes('BREAKOUT')||bt.includes('Bull')?'green':bt.includes('Bear')||bt.includes('Selling')?'red':'amber';
        return{symbol:c.symbol,price:c.price,ch24:+c.ch24.toFixed(2),vol:c.vol,bType:bt,bColor:bc,sector:'ALT'};
      });

    // RSI LIST (estimated)
    const rsiList=coins.filter(c=>c.vol>500000).slice(0,80).map(c=>{
      const pip=c.h>c.l?(c.price-c.l)/(c.h-c.l)*100:50;
      const rsi=Math.round(Math.max(8,Math.min(92,50+c.ch24*2.5+(pip-50)*0.3+((c.ch7d||0)>0?3:-3))));
      return{symbol:c.symbol,price:c.price,ch24:+c.ch24.toFixed(2),vol:c.vol,rsi,rsiReal:false,sector:'ALT'};
    }).sort((a,b)=>a.rsi-b.rsi);

    // TOP LOSERS
    const losers=coins.filter(c=>c.ch24<-1&&c.vol>1e6)
      .sort((a,b)=>a.ch24-b.ch24).slice(0,20)
      .map(c=>({symbol:c.symbol,price:c.price,ch24:+c.ch24.toFixed(2),vol:c.vol,rsi:Math.round(30+c.ch24*-1.5),sector:'ALT'}));

    // NARASI
    const hotSectors=sig==='BULLISH'?'Momentum bullish aktif. Vol breakout terdeteksi. Entry valid dengan konfirmasi candle.':sig==='BEARISH'?'Tekanan jual dominan. Cash is king. Prioritas koin oversold RSI<30.':'Market konsolidasi. Tunggu directional breakout bervolume.';

    const out={ok:true,ts:Date.now(),elapsed:Date.now()-t0,version:'v21',
      fg,market:{signal:sig,avg24h:avg24,pos,neg,bigMove,totalVol},
      gainers:gainers.slice(0,30),
      topGainers:gainers.slice(0,30),
      volBreakouts:volBreakouts.slice(0,30),
      rsiList:rsiList.slice(0,30),
      rsiExtremes:rsiList.slice(0,30),
      losers:losers.slice(0,15),
      topLosers:losers.slice(0,15),
      narasi:hotSectors,
      realRSICount:0,
      src:cgR.value?'cg+mx':'bybit'};
    CACHE.data=out;CACHE.ts=Date.now();
    return res.status(200).json(out);
  }catch(e){
    // EMERGENCY FALLBACK: gunakan Bybit saja
    try{
      const byR2=await Promise.race([
        fetch('https://api.bybit.com/v5/market/tickers?category=linear').then(r=>r.json()),
        new Promise((_,rj)=>setTimeout(()=>rj(new Error('timeout')),3000))
      ]);
      const list=A(byR2?.result?.list).filter(t=>String(t.symbol).endsWith('USDT')&&!STABLES.has(String(t.symbol).replace('USDT','')));
      const coins2=list.slice(0,100).map(t=>({symbol:String(t.symbol).replace('USDT',''),price:N(t.lastPrice),ch24:N(t.price24hPcnt)*100,vol:N(t.turnover24h)})).filter(c=>c.price>0&&c.vol>1e6);
      const avg=+(coins2.reduce((s,c)=>s+c.ch24,0)/Math.max(coins2.length,1)).toFixed(2);
      const fallout={ok:true,ts:Date.now(),elapsed:Date.now()-t0,version:'v21-fallback',fg:50,market:{signal:avg>1?'BULLISH':avg<-1?'BEARISH':'NEUTRAL',avg24h:avg,pos:coins2.filter(c=>c.ch24>0).length,neg:coins2.filter(c=>c.ch24<0).length,totalVol:coins2.reduce((s,c)=>s+c.vol,0)},gainers:coins2.sort((a,b)=>b.ch24-a.ch24).slice(0,20).map(c=>({symbol:c.symbol,price:c.price,ch24:+c.ch24.toFixed(2),vol:c.vol})),topGainers:coins2.sort((a,b)=>b.ch24-a.ch24).slice(0,20),volBreakouts:coins2.sort((a,b)=>b.vol-a.vol).slice(0,20).map(c=>({symbol:c.symbol,price:c.price,ch24:+c.ch24.toFixed(2),vol:c.vol,bType:'Active',bColor:'amber'})),rsiList:[],rsiExtremes:[],losers:[],realRSICount:0,narasi:'Data dari Bybit (CoinGecko tidak tersedia saat ini).',src:'bybit-fallback'};
      CACHE.data=fallout;CACHE.ts=Date.now()-TTL+60000; // expire in 1 min
      return res.status(200).json(fallout);
    }catch{return res.status(200).json({ok:false,error:e.message,ts:Date.now(),elapsed:Date.now()-t0,version:'v21',fg:50,market:{signal:'NEUTRAL',avg24h:0,pos:0,neg:0,totalVol:0},gainers:[],topGainers:[],volBreakouts:[],rsiList:[],rsiExtremes:[],losers:[],realRSICount:0,narasi:'Data tidak tersedia.'});}
  }
}
