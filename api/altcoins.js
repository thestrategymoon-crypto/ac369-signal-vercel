// api/altcoins.js — 369 GLOBAL CRYPTO v5.0
// Altcoin Momentum: Top Gainers, Volume Breakout, RSI Extreme
// Sources: MEXC + CoinGecko + Bybit (RSI estimation)
'use strict';
const CACHE={d:null,t:0};
const STAB=new Set(['USDT','USDC','BUSD','DAI','TUSD','FDUSD','USDE','FRAX','USDP','SUSD','LUSD','EURC','USDD','BIDR']);

export default async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Cache-Control','s-maxage=30,stale-while-revalidate=20');
  if(req.method==='OPTIONS') return res.status(200).end();
  const t0=Date.now();
  if(CACHE.d&&Date.now()-CACHE.t<45000) return res.status(200).json({...CACHE.d,cached:true,elapsed:Date.now()-t0});
  const sf=async(url,ms)=>{const c=new AbortController();const t=setTimeout(()=>c.abort(),ms);try{const r=await fetch(url,{signal:c.signal,headers:{'Accept':'application/json','User-Agent':'369Global/5.0'}});clearTimeout(t);return r.ok?await r.json():null;}catch{clearTimeout(t);return null;}};
  const N=(v,d=0)=>{const n=+v;return(isNaN(n)||!isFinite(n))?d:n;};
  const A=v=>Array.isArray(v)?v:[];
  const cl=(v,a,b)=>Math.max(a,Math.min(b,N(v)));
  try{
    const[mxR,cgR,byR,fgR]=await Promise.allSettled([
      sf('https://api.mexc.com/api/v3/ticker/24hr',5500),
      sf('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=volume_desc&per_page=250&page=1&sparkline=false',5500),
      sf('https://api.bybit.com/v5/market/tickers?category=linear',4500),
      sf('https://alternative.me/crypto/fear-and-greed-index/?format=json&limit=1',3500),
    ]);
    const fg=N(fgR.value?.data?.[0]?.value,50);
    // Build price map from CoinGecko (most accurate)
    const cgMap={};
    for(const c of A(cgR.value)){
      const sym=String(c.symbol||'').toUpperCase();
      if(!sym||STAB.has(sym)) continue;
      cgMap[sym]={price:N(c.current_price),ch24:N(c.price_change_percentage_24h),vol:N(c.total_volume),name:c.name||sym};
    }
    // Bybit FR map
    const frMap={};
    for(const t of A(byR.value?.result?.list)){
      const s=String(t.symbol||'').replace('USDT','');
      if(s) frMap[s]={fr:N(t.fundingRate),oi:N(t.openInterestValue)};
    }
    // Process MEXC coins
    const coins=[];
    for(const t of A(mxR.value||[])){
      try{
        if(!String(t.symbol||'').endsWith('USDT')) continue;
        const sym=String(t.symbol).replace('USDT','');
        if(!sym||sym.length>14||STAB.has(sym)) continue;
        if(['UP','DOWN','BULL','BEAR'].some(x=>sym.endsWith(x))) continue;
        const p=cgMap[sym]?.price||N(t.lastPrice);
        if(p<=0||p>1e10) continue;
        const v=N(t.quoteVolume)||cgMap[sym]?.vol||0;
        if(v<50000) continue;
        const ch24=cgMap[sym]?.ch24||N(t.priceChangePercent);
        const hi=N(t.highPrice||p*1.02),lo=N(t.lowPrice||p*0.98);
        const pip=hi>lo?cl((p-lo)/(hi-lo)*100,0,100):50;
        // Estimate RSI
        const fr=frMap[sym];const frPct=(fr?.fr||0)*100;
        const frEff=(frPct-0.010)*(-200);
        const rsi=cl(Math.round(50+ch24*2.8+(pip-50)*0.45+frEff),10,90);
        const bType=v>500e6&&ch24>3?'BREAKOUT 🚀':v>200e6&&ch24>5?'Strong Bull':v>100e6&&ch24<-5?'Bear Dump':v>100e6&&Math.abs(ch24)<1.5?'STEALTH':v>50e6&&ch24>2?'Bull Flow':v>50e6&&ch24<-2?'Bear Flow':'STEALTH';
        coins.push({symbol:sym,name:cgMap[sym]?.name||sym,price:p,ch24,vol:v,hi,lo,pip,rsi,bType,frPct,oi:fr?.oi||0,priceUsd:p});
      }catch{}
    }
    // Market overview
    const pos=coins.filter(c=>c.ch24>0).length;
    const neg=coins.filter(c=>c.ch24<=0).length;
    const totalVol=coins.reduce((s,c)=>s+c.vol,0);
    const avgCh24=coins.length?+(coins.reduce((s,c)=>s+c.ch24,0)/coins.length).toFixed(2):0;
    const signal=avgCh24>3?'BULLISH':avgCh24>1?'MILD BULL':avgCh24<-3?'BEARISH':avgCh24<-1?'MILD BEAR':'NEUTRAL';
    // Lists
    const gainers=[...coins].filter(c=>c.ch24>0).sort((a,b)=>b.ch24-a.ch24).slice(0,25).map(c=>({symbol:c.symbol,price:c.price,priceUsd:c.price,ch24:c.ch24,vol:c.vol}));
    const volBreakouts=[...coins].filter(c=>c.vol>5e6).sort((a,b)=>b.vol-a.vol).slice(0,20).map(c=>({symbol:c.symbol,price:c.price,ch24:c.ch24,vol:c.vol,bType:c.bType}));
    const rsiList=[...coins].filter(c=>c.rsi<38||c.rsi>68).sort((a,b)=>a.rsi-b.rsi).slice(0,25).map(c=>({sym:c.symbol,symbol:c.symbol,price:c.price,ch24:c.ch24,rsi:+c.rsi.toFixed(1),vol:c.vol,zone:c.rsi<25?'EXTREME OVERSOLD 🎯':c.rsi<35?'Oversold 🟢':c.rsi>78?'EXTREME OVERBOUGHT':c.rsi>68?'Overbought 🔴':'Bearish zone'}));
    const out={ok:true,version:'v5',ts:Date.now(),elapsed:Date.now()-t0,fg,totalCoins:coins.length,realRSICount:0,market:{signal,avg24h:avgCh24,pos,neg,totalVol,bullPct:Math.round(pos/Math.max(1,coins.length)*100)},gainers,volBreakouts,volumeBreakouts:volBreakouts,rsiList,rsiExtremes:rsiList};
    CACHE.d=out;CACHE.t=Date.now();
    return res.status(200).json(out);
  }catch(e){
    return res.status(200).json({ok:false,version:'v5',error:String(e.message),ts:Date.now(),elapsed:Date.now()-t0,fg:50,totalCoins:0,realRSICount:0,market:{signal:'NEUTRAL',avg24h:0,pos:0,neg:0,totalVol:0,bullPct:50},gainers:[],volBreakouts:[],volumeBreakouts:[],rsiList:[],rsiExtremes:[]});
  }
}
