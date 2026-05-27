// api/altcoins.js — v22 MINIMAL CACHED · Bybit primary
const CACHE = {data:null, ts:0};
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300,stale-while-revalidate=120');
  if (req.method === 'OPTIONS') return res.status(200).end();
  const t0 = Date.now();
  if (CACHE.data && Date.now()-CACHE.ts < 300000) return res.status(200).json({...CACHE.data, cached:true, elapsed:Date.now()-t0});

  const STABLES = new Set(['USDT','USDC','BUSD','DAI','TUSD','FDUSD','USDE']);
  let coins = [], fg = 50;

  // Try CoinGecko first (best data), but with strict 4s timeout
  try {
    const ctrl = new AbortController(); const t = setTimeout(()=>ctrl.abort(), 4000);
    const r = await fetch('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=volume_desc&per_page=150&page=1&sparkline=false&price_change_percentage=24h', {signal:ctrl.signal});
    clearTimeout(t);
    if (r.ok) {
      const d = await r.json();
      for (const c of d) {
        const p=parseFloat(c.current_price); if(p<=0||STABLES.has(c.symbol?.toUpperCase())) continue;
        coins.push({symbol:c.symbol?.toUpperCase(),price:p,ch24:parseFloat(c.price_change_percentage_24h)||0,vol:parseFloat(c.total_volume)||0,h:parseFloat(c.high_24h)||p*1.02,l:parseFloat(c.low_24h)||p*0.98,src:'cg'});
      }
    }
  } catch(e) {}

  // Fallback to Bybit if CG failed
  if (coins.length < 10) {
    try {
      const r = await fetch('https://api.bybit.com/v5/market/tickers?category=linear');
      if (r.ok) {
        const d = await r.json();
        for (const t of (d?.result?.list||[])) {
          const sym = t.symbol?.replace('USDT','')?.replace('PERP','');
          const p = parseFloat(t.lastPrice);
          const v = parseFloat(t.turnover24h);
          if (!sym || STABLES.has(sym) || p<=0 || v<1e6) continue;
          const ch24 = parseFloat(t.price24hPcnt)*100||0;
          coins.push({symbol:sym, price:p, ch24, vol:v, h:p*1.02, l:p*0.98, src:'bybit'});
        }
      }
    } catch(e) {}
  }

  // FG
  try {
    const r = await fetch('https://api.alternative.me/fng/?limit=1&format=json');
    if (r.ok) { const d = await r.json(); fg = parseInt(d?.data?.[0]?.value)||50; }
  } catch(e) {}

  coins.sort((a,b)=>b.vol-a.vol);
  const pos=coins.filter(c=>c.ch24>0).length, neg=coins.filter(c=>c.ch24<0).length;
  const avg24=coins.length?parseFloat((coins.reduce((s,c)=>s+c.ch24,0)/coins.length).toFixed(2)):0;
  const sig=avg24>2?'BULLISH':avg24<-2?'BEARISH':'NEUTRAL';

  const gainers=coins.filter(c=>c.ch24>0&&c.vol>500000).sort((a,b)=>b.ch24-a.ch24).slice(0,25).map(c=>({symbol:c.symbol,price:c.price,ch24:parseFloat(c.ch24.toFixed(2)),vol:c.vol}));
  const vols=coins.filter(c=>c.vol>2e6).sort((a,b)=>b.vol-a.vol).slice(0,25).map(c=>{
    const pip=c.h>c.l?(c.price-c.l)/(c.h-c.l)*100:50;
    const bt=c.ch24>5&&pip>60?'BREAKOUT 🚀':c.ch24>2?'Bull Flow':c.ch24<-5&&pip<40?'Bear Flow':'STEALTH 👁';
    return{symbol:c.symbol,price:c.price,ch24:parseFloat(c.ch24.toFixed(2)),vol:c.vol,bType:bt,bColor:bt.includes('BREAKOUT')||bt.includes('Bull')?'green':bt.includes('Bear')?'red':'amber'};
  });
  const rsiList=coins.slice(0,60).map(c=>{const pip=c.h>c.l?(c.price-c.l)/(c.h-c.l)*100:50;const rsi=Math.round(Math.max(8,Math.min(92,50+c.ch24*2.5+(pip-50)*0.3)));return{symbol:c.symbol,price:c.price,ch24:parseFloat(c.ch24.toFixed(2)),vol:c.vol,rsi,rsiReal:false};}).sort((a,b)=>a.rsi-b.rsi);
  const losers=coins.filter(c=>c.ch24<-1&&c.vol>1e6).sort((a,b)=>a.ch24-b.ch24).slice(0,15).map(c=>({symbol:c.symbol,price:c.price,ch24:parseFloat(c.ch24.toFixed(2)),vol:c.vol,rsi:Math.round(30+c.ch24*-1.5)}));

  const out = {
    ok:true, version:'v22-minimal', ts:Date.now(), elapsed:Date.now()-t0, fg,
    market:{signal:sig,avg24h:avg24,pos,neg,totalVol:coins.reduce((s,c)=>s+c.vol,0),bigMove:coins.filter(c=>Math.abs(c.ch24)>10).length},
    gainers, topGainers:gainers, volBreakouts:vols, volumeBreakouts:vols,
    rsiList, rsiExtremes:rsiList, losers, topLosers:losers, realRSICount:0,
    narasi:sig==='BULLISH'?'Momentum bullish aktif.':sig==='BEARISH'?'Tekanan jual dominan.':'Konsolidasi.',
    src:coins[0]?.src||'bybit',
  };
  CACHE.data=out; CACHE.ts=Date.now();
  return res.status(200).json(out);
}
