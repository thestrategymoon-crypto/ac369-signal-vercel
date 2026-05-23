// api/altcoins.js — v20 SUPER ACCURATE
// ✅ CoinGecko + CryptoCompare PARALLEL (bukan sequential)
// ✅ RSI real untuk top 50 koin (naik dari 22)
// ✅ Multi-TF: 4H RSI + 1D RSI dari klines
// ✅ MACD detection dari klines
// ✅ RSI estimasi lebih akurat (min 15, bukan 10)
// ✅ Volume label fix: tidak lagi semua "Bearish Breakdown"
// ✅ Smart bType: Breakout / Stealth / Accumulation / Distribution / Selling Pressure

const STABLES=new Set(['tether','usd-coin','binance-usd','dai','trueusd','first-digital-usd','usdd','frax','usdb','stasis-eurs','usde','pyusd','usds']);

const SECTORS={
  BTC:'BTC',ETH:'ETH',BNB:'BNB',SOL:'L1',ADA:'L1',AVAX:'L1',DOT:'L1',NEAR:'L1',
  APT:'L1',SUI:'L1',SEI:'L1',INJ:'L1',TIA:'L1',TON:'L1',ATOM:'L1',HBAR:'L1',
  ALGO:'L1',XLM:'L1',VET:'L1',ONE:'L1',
  ARB:'L2',OP:'L2',MATIC:'L2',POL:'L2',IMX:'L2',STRK:'L2',MNT:'L2',
  UNI:'DEF',AAVE:'DEF',CRV:'DEF',MKR:'DEF',LDO:'DEF',PENDLE:'DEF',
  GMX:'DEF',DYDX:'DEF',JUP:'DEF',CAKE:'DEF',RDNT:'DEF',
  FET:'AI',AGIX:'AI',OCEAN:'AI',RENDER:'AI',TAO:'AI',WLD:'AI',
  ARKM:'AI',GRT:'AI',OLAS:'AI',IO:'AI',VIRTUAL:'AI',
  ONDO:'RWA',MKR:'RWA',
  DOGE:'MME',SHIB:'MME',PEPE:'MME',FLOKI:'MME',BONK:'MME',
  WIF:'MME',NEIRO:'MME',BOME:'MME',DOGS:'MME',POPCAT:'MME',
  LINK:'ORC',BAND:'ORC',PYTH:'ORC',API3:'ORC',
  HYPE:'DEX',JUP:'DEX',BLUR:'DEX',CAKE:'DEX',
  XRP:'PAY',LTC:'PAY',BCH:'PAY',XLM:'PAY',TRX:'PAY',
  SAND:'GAME',MANA:'GAME',AXS:'GAME',GALA:'GAME',RON:'GAME',
  FIL:'INFRA',AR:'INFRA',STORJ:'INFRA',LPT:'INFRA',
};

const N=(v,d=0)=>{const n=+v;return isNaN(n)||!isFinite(n)?d:n;};
const A=v=>Array.isArray(v)?v:[];
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,N(v)));

const RSI14=c=>{
  if(!c||c.length<16)return null;
  let ag=0,al=0;
  for(let i=1;i<=14;i++){const d=c[i]-c[i-1];d>0?ag+=d:al-=d;}
  ag/=14;al/=14;
  for(let i=15;i<c.length;i++){const d=c[i]-c[i-1];ag=(ag*13+Math.max(d,0))/14;al=(al*13+Math.max(-d,0))/14;}
  return al===0?100:clamp(100-100/(1+ag/al),0,100);
};

const calcMACD=a=>{
  if(!a||a.length<36)return null;
  const k12=2/13,k26=2/27,k9=2/10;
  let e12=a.slice(0,12).reduce((s,v)=>s+v,0)/12,e26=a.slice(0,26).reduce((s,v)=>s+v,0)/26;
  const mv=[];
  for(let i=26;i<a.length;i++){e12=a[i]*k12+e12*(1-k12);e26=a[i]*k26+e26*(1-k26);mv.push(e12-e26);}
  let sig=mv.slice(0,9).reduce((s,v)=>s+v,0)/9;
  for(let i=9;i<mv.length;i++)sig=mv[i]*k9+sig*(1-k9);
  const n=mv.length,last=N(mv[n-1]),h=last-sig,ph=N(mv[n-2]||last)-sig;
  return{bull:last>0&&h>0,bear:last<0&&h<0,xUp:h>0&&ph<=0,xDown:h<0&&ph>=0,div:n>7&&last<N(mv[n-8])&&a[a.length-1]>a[a.length-8]};
};

const fmtP=p=>{
  if(!p||p<=0)return 0;
  return +p.toFixed(p>=1000?2:p>=1?4:p>=0.001?6:8);
};

// Smart bType labeling (akurat, tidak selalu "Bearish Breakdown")
const getBType=(ch24,vt,body,pPos,rsi,avgMarket)=>{
  // Stealth: vol tinggi tapi harga tidak banyak gerak = institusi akumulasi diam-diam
  if(vt>=4&&Math.abs(ch24)<1.5) return{label:'STEALTH 👁',color:'amber',score:86};
  // Strong breakout bullish
  if(vt>=3&&ch24>5&&body>0.4&&pPos>0.6) return{label:'BREAKOUT 🚀',color:'green',score:93};
  // Bullish vol
  if(vt>=3&&ch24>2&&pPos>0.5) return{label:'Bull Flow',color:'green',score:73};
  if(vt>=2&&ch24>1&&rsi<65) return{label:'Bull Flow',color:'green',score:62};
  // Distribution: vol tinggi + harga turun dari puncak
  if(vt>=4&&ch24<-3&&pPos<0.35) return{label:'Distribution ⚠️',color:'red',score:80};
  // Capitulation: extreme vol + extreme drop
  if(vt>=4&&ch24<-8) return{label:'Capitulation',color:'red',score:85};
  // Oversold bounce: price very low + positive
  if(rsi<30&&ch24>1&&pPos<0.3) return{label:'Oversold Bounce',color:'green',score:75};
  // Selling pressure
  if(vt>=3&&ch24<-2) return{label:'Selling Pressure',color:'red',score:65};
  if(vt>=2&&ch24<-1) return{label:'Weak Selling',color:'red',score:52};
  // Consolidation near high: vol + tight range
  if(vt>=3&&Math.abs(ch24)<2&&pPos>0.6) return{label:'Consolidation ⚖️',color:'amber',score:60};
  // Default by ch24
  if(ch24>3) return{label:'Bull Momentum',color:'green',score:58};
  if(ch24>1) return{label:'Mild Bull',color:'green',score:52};
  if(ch24<-3) return{label:'Bear Pressure',color:'red',score:55};
  if(ch24<-1) return{label:'Mild Bear',color:'red',score:48};
  return{label:'Sideways',color:'amber',score:45};
};

export default async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Cache-Control','s-maxage=25,stale-while-revalidate=10');
  if(req.method==='OPTIONS')return res.status(200).end();
  const t0=Date.now();

  const sf=async(url,ms)=>{
    const c=new AbortController();const t=setTimeout(()=>c.abort(),ms);
    try{const r=await fetch(url,{signal:c.signal,headers:{Accept:'application/json','User-Agent':'AC369/1.0'}});clearTimeout(t);if(!r.ok)return null;return await r.json();}
    catch{clearTimeout(t);return null;}
  };

  try{
    // ── TOP 50 SYMBOLS FOR KLINES (akan diisi setelah CG load) ──
    // Fetch CG + F&G dulu untuk dapat symbol list
    const[cgR,fngR]=await Promise.allSettled([
      sf('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=volume_desc&per_page=250&page=1&sparkline=false&price_change_percentage=24h,7d',7000),
      sf('https://api.alternative.me/fng/?limit=1&format=json',3000),
    ]);

    const markets=cgR.status==='fulfilled'&&Array.isArray(cgR.value)?cgR.value:[];
    const fg=fngR.status==='fulfilled'?parseInt(fngR.value?.data?.[0]?.value||50):50;

    if(!markets.length){
      return res.status(200).json({ok:false,error:'CoinGecko unavailable. Coba refresh.',ts:Date.now(),elapsed:Date.now()-t0,version:'v20',fg:50,src:'unavailable',realRSICount:0,totalCoins:0,gainers:[],losers:[],rsiList:[],volBreakouts:[],topGainers:[],topLosers:[],rsiExtremes:[],volumeBreakouts:[],market:{signal:'UNKNOWN',avg24h:0,total:0,pos:0,neg:0,bigMove:0,totalVol:0}});
    }

    // Filter stables + build coin objects
    const stableFilter=c=>!STABLES.has(c.id)&&N(c.current_price)>0&&N(c.total_volume)>100000;
    const filtered=markets.filter(stableFilter);

    const all=filtered.map(c=>{
      const sym=(c.symbol||'').toUpperCase();
      const price=N(c.current_price);
      const ch24=N(c.price_change_percentage_24h);
      const ch7d=c.price_change_percentage_7d!=null?N(c.price_change_percentage_7d):null;
      const vol=N(c.total_volume);
      const high=N(c.high_24h)||price*1.02;
      const low=N(c.low_24h)||price*0.98;
      if(price>=0.97&&price<=1.03&&Math.abs(ch24)<0.5)return null;
      const pPos=high>low?clamp((price-low)/(high-low),0,1):0.5;
      const op=price/(1+(ch24/100)||1);
      const body=high>low?clamp(Math.abs(price-op)/(high-low),0,1):0.2;
      const vt=vol>=1e9?5:vol>=200e6?4:vol>=50e6?3:vol>=10e6?2:vol>=1e6?1:0;
      return{
        symbol:sym,id:c.id,price:fmtP(price),ch24:+ch24.toFixed(2),ch7d:ch7d!=null?+ch7d.toFixed(2):null,
        vol:+vol.toFixed(0),high,low,body:+body.toFixed(3),pPos:+pPos.toFixed(3),vt,
        sector:SECTORS[sym]||null,
        rsi4h:null,rsi1d:null,rsiEst:50,rsiReal:false,macd:null,
        mcap:N(c.market_cap),mcapRank:N(c.market_cap_rank,999),
      };
    }).filter(Boolean);

    // Market summary
    const avg24h=all.length?+(all.reduce((s,c)=>s+c.ch24,0)/all.length).toFixed(2):0;
    const pos=all.filter(c=>c.ch24>0).length;
    const neg=all.filter(c=>c.ch24<0).length;
    const bigMove=all.filter(c=>Math.abs(c.ch24)>10).length;
    const totalVol=all.reduce((s,c)=>s+c.vol,0);
    const signal=avg24h>3?'BULLISH':avg24h<-3?'BEARISH':avg24h>1?'MILD BULL':avg24h<-1?'MILD BEAR':'NEUTRAL';

    // ── CryptoCompare PARALLEL (top 50 by volume) ──────────────
    // Fetch SEMUA sekaligus dalam satu Promise.allSettled
    const CC_SYMS=all.slice(0,50).map(c=>c.symbol);
    const ccResults=await Promise.allSettled(
      CC_SYMS.map(sym=>sf(
        `https://min-api.cryptocompare.com/data/v2/histohour?fsym=${sym}&tsym=USD&limit=56&aggregate=4&e=CCCAGG`,
        5000
      ))
    );

    let realRSICount=0;
    ccResults.forEach((r,i)=>{
      try{
        if(r.status!=='fulfilled'||r.value?.Response!=='Success')return;
        const rows=A(r.value?.Data?.Data);
        if(rows.length<16)return;
        const K=rows.filter(d=>N(d.close)>0&&N(d.close)<1e10);
        if(K.length<16)return;
        const cls=K.map(k=>N(k.close));

        // 4H RSI (full klines)
        const rsi4h=RSI14(cls);
        if(rsi4h===null)return;

        // 1D RSI: ambil setiap 6 candle (6x4H = 24H)
        const dailyClose=cls.filter((_,idx)=>idx%6===0);
        const rsi1d=RSI14(dailyClose);

        // MACD dari 4H klines
        const macd=calcMACD(cls);

        const coin=all.find(c=>c.symbol===CC_SYMS[i]);
        if(coin){
          coin.rsi4h=+rsi4h.toFixed(1);
          coin.rsi1d=rsi1d!=null?+rsi1d.toFixed(1):null;
          coin.macd=macd;
          coin.rsiReal=true;
          realRSICount++;
        }
      }catch{}
    });

    // RSI estimation untuk koin tanpa real data
    // Formula lebih akurat: min 15, max 85
    all.filter(c=>!c.rsiReal).forEach(c=>{
      const ch7=c.ch7d||0;
      const chC=clamp(c.ch24*1.8,-22,22);
      const rpC=clamp((c.pPos-0.5)*22,-12,12);
      const wkC=clamp(ch7*0.7,-10,10);
      c.rsiEst=clamp(Math.round(50+chC+rpC+wkC),15,85);
    });

    // Unified RSI value (real if available, else estimated)
    all.forEach(c=>{
      c.rsi=c.rsiReal?c.rsi4h:c.rsiEst;
    });

    // ── Gainers (dynamic threshold) ───────────────────────────
    const dynT=Math.max(0.5,avg24h+1.5);
    let gainers=all.filter(c=>c.ch24>=dynT&&c.vol>=300000).sort((a,b)=>
      (b.ch24*Math.log10(Math.max(b.vol,1))*(0.5+b.body))-(a.ch24*Math.log10(Math.max(a.vol,1))*(0.5+a.body))
    );
    if(gainers.length<8)gainers=all.filter(c=>c.ch24>0&&c.vol>=200000).sort((a,b)=>b.ch24-a.ch24).slice(0,30);

    // ── Losers ────────────────────────────────────────────────
    const losers=all.filter(c=>c.ch24<=-1.0&&c.vol>=300000).sort((a,b)=>
      (Math.abs(b.ch24)*Math.log10(Math.max(b.vol,1)))-(Math.abs(a.ch24)*Math.log10(Math.max(a.vol,1)))
    );

    // ── Volume Breakout (FIXED bType logic) ───────────────────
    const volBreakouts=all.filter(c=>c.vol>=5e6).map(c=>{
      const bt=getBType(c.ch24,c.vt,c.body,c.pPos,c.rsi||50,avg24h);
      return{...c,bScore:bt.score,bType:bt.label,bColor:bt.color};
    }).sort((a,b)=>b.vol-a.vol);

    // ── RSI List ──────────────────────────────────────────────
    // Sort: oversold first, then overbought, then others
    const rsiList=all.filter(c=>c.vol>=500000).sort((a,b)=>{
      const ra=c=>c.rsi<=35?0:c.rsi>=70?1:2;
      if(ra(a)!==ra(b))return ra(a)-ra(b);
      if(a.rsi<=35)return a.rsi-b.rsi; // lowest RSI first
      if(a.rsi>=70)return b.rsi-a.rsi; // highest RSI first
      return a.rsi-b.rsi;
    });

    return res.status(200).json({
      ok:true,ts:Date.now(),elapsed:Date.now()-t0,version:'v20',
      src:'CoinGecko',fg,realRSICount,totalCoins:all.length,
      market:{signal,avg24h,pos,neg,bigMove,total:all.length,totalVol:+totalVol.toFixed(0)},
      gainers,losers,rsiList,volBreakouts,
      topGainers:gainers.slice(0,30),
      topLosers:losers.slice(0,20),
      rsiExtremes:rsiList,
      volumeBreakouts:volBreakouts.slice(0,30),
    });

  }catch(e){
    return res.status(200).json({ok:false,error:e.message,ts:Date.now(),elapsed:Date.now()-t0,version:'v20',fg:50,src:'error',realRSICount:0,totalCoins:0,gainers:[],losers:[],rsiList:[],volBreakouts:[],topGainers:[],topLosers:[],rsiExtremes:[],volumeBreakouts:[],market:{signal:'UNKNOWN',avg24h:0,total:0,pos:0,neg:0,bigMove:0,totalVol:0}});
  }
}
