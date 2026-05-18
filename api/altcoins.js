// api/altcoins.js — v16
// MEXC primary (Binance-compatible, tidak diblokir dari Vercel)
// RSI: CryptoCompare 4H aggregate (tidak diblokir)

const STABLES=new Set(['USDT','USDC','BUSD','DAI','TUSD','USDP','FDUSD','USDD','GUSD','FRAX','LUSD','BIDR','IDRT','EUR','GBP','BRL','TRY']);
const IGNORE=new Set(['BTCDOMUSDT','DEFIUSDT','USDCUSDT','PERPUSDT']);
const NO_SFX=['UP','DOWN','BULL','BEAR','LONG','SHORT','3L','3S','5L','5S'];
const SECTORS={BTC:'BTC',ETH:'ETH',BNB:'BNB',SOL:'L1',ADA:'L1',AVAX:'L1',DOT:'L1',NEAR:'L1',APT:'L1',SUI:'L1',SEI:'L1',INJ:'L1',TIA:'L1',TON:'L1',ATOM:'IOP',ARB:'L2',OP:'L2',MATIC:'L2',IMX:'L2',STRK:'L2',ZK:'L2',UNI:'DEF',AAVE:'DEF',CRV:'DEF',MKR:'DEF',LDO:'DEF',PENDLE:'DEF',GMX:'DEF',FET:'AI',AGIX:'AI',OCEAN:'AI',RENDER:'AI',TAO:'AI',WLD:'AI',ARKM:'AI',GRT:'AI',ONDO:'RWA',GALA:'GME',AXS:'GME',SAND:'GME',MANA:'GME',DOGE:'MME',SHIB:'MME',PEPE:'MME',FLOKI:'MME',BONK:'MME',WIF:'MME',NEIRO:'MME',LINK:'ORC',BAND:'ORC',HYPE:'DEX',JUP:'DEX',BLUR:'DEX',CAKE:'DEX',RAY:'DEX',XRP:'PAY',LTC:'PAY',BCH:'PAY',XLM:'PAY'};

const RSI14=(c)=>{if(!c||c.length<16)return null;let ag=0,al=0;for(let i=1;i<=14;i++){const d=c[i]-c[i-1];d>0?ag+=d:al+=Math.abs(d);}ag/=14;al/=14;for(let i=15;i<c.length;i++){const d=c[i]-c[i-1];ag=(ag*13+Math.max(d,0))/14;al=(al*13+Math.max(-d,0))/14;}return al===0?100:+(100-100/(1+ag/al)).toFixed(2);};

const fmtP=(p)=>{if(!p||p<=0)return 0;return +p.toFixed(p>=1000?2:p>=1?4:p>=0.001?6:8);};

const parseTicker=(t,src)=>{
  let sym,price,ch24,vol,high,low,open2;
  if(src==='MEXC'||src==='Binance'){sym=(t.symbol||'').replace('USDT','');price=+(t.lastPrice||0);ch24=+(t.priceChangePercent||0);vol=+(t.quoteVolume||0);high=+(t.highPrice||price*1.01);low=+(t.lowPrice||price*0.99);open2=+(t.openPrice||price);}
  else if(src==='Bybit'){sym=(t.symbol||'').replace('USDT','');price=+(t.lastPrice||0);ch24=t.price24hPcnt?+(+t.price24hPcnt*100).toFixed(4):0;vol=+(t.turnover24h||0);high=+(t.highPrice24h||price*1.01);low=+(t.lowPrice24h||price*0.99);open2=+(t.prevPrice24h||price);}
  else if(src==='CoinGecko'){sym=(t.symbol||'').toUpperCase();price=+(t.current_price||0);ch24=+(t.price_change_percentage_24h||0);vol=+(t.total_volume||0);high=+(t.high_24h||price*1.01);low=+(t.low_24h||price*0.99);open2=price/(1+ch24/100)||price;}
  else return null;
  if(!sym||price<=0||vol<100000)return null;
  if(STABLES.has(sym))return null;
  if(IGNORE.has(sym+'USDT'))return null;
  if(NO_SFX.some(p=>sym.endsWith(p)||sym.startsWith(p)))return null;
  if(sym.length>12)return null;
  if(price>=0.97&&price<=1.03&&Math.abs(ch24)<0.5)return null;
  const body=high>low?Math.abs(price-open2)/(high-low):0;
  const rp=high>low?(price-low)/(high-low):0.5;
  const vt=vol>=1e9?5:vol>=200e6?4:vol>=50e6?3:vol>=10e6?2:vol>=1e6?1:0;
  return{symbol:sym,price:fmtP(price),ch24:+ch24.toFixed(2),vol:+vol.toFixed(0),high,low,body:+body.toFixed(3),rp:+rp.toFixed(3),vt,sector:SECTORS[sym]||null,rsi:50,rsiReal:false};
};

export default async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Cache-Control','s-maxage=25, stale-while-revalidate=10');
  if(req.method==='OPTIONS')return res.status(200).end();
  const t0=Date.now();
  const sf=async(url,ms)=>{const c=new AbortController();const t=setTimeout(()=>c.abort(),ms);try{const r=await fetch(url,{signal:c.signal,headers:{Accept:'application/json','User-Agent':'AC369/1.0'}});clearTimeout(t);if(!r.ok)return null;return await r.json();}catch{clearTimeout(t);return null;}};

  try{
    // STEP 1: MEXC primary, Bybit spot fallback, CoinGecko last resort
    const[tickersR,fngR]=await Promise.allSettled([
      (async()=>{
        const mx=await sf('https://api.mexc.com/api/v3/ticker/24hr',9000);
        if(Array.isArray(mx)&&mx.length>100){const v=mx.filter(t=>t?.symbol?.endsWith('USDT'));if(v.length>50)return{data:v,src:'MEXC'};}
        const by=await sf('https://api.bybit.com/v5/market/tickers?category=spot',8000);
        if(by?.result?.list?.length>50)return{data:by.result.list.filter(t=>t?.symbol?.endsWith('USDT')),src:'Bybit'};
        const cg=await sf('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=volume_desc&per_page=250&page=1&sparkline=false&price_change_percentage=24h',7000);
        if(Array.isArray(cg)&&cg.length>20)return{data:cg,src:'CoinGecko'};
        return null;
      })(),
      sf('https://api.alternative.me/fng/?limit=1&format=json',4000),
    ]);

    const raw=tickersR.status==='fulfilled'?tickersR.value:null;
    const fg=fngR.status==='fulfilled'?parseInt(fngR.value?.data?.[0]?.value||50):50;

    if(!raw?.data?.length){return res.status(200).json({ok:false,error:'No ticker data',ts:Date.now(),elapsed:Date.now()-t0,version:'v16',fg:50,src:'unavailable',realRSICount:0,totalCoins:0,gainers:[],losers:[],rsiList:[],volBreakouts:[],topGainers:[],topLosers:[],rsiExtremes:[],volumeBreakouts:[],market:{signal:'UNKNOWN',avg24h:0,total:0,pos:0,neg:0,bigMove:0,totalVol:0}});}

    const src=raw.src;
    const all=raw.data.map(t=>parseTicker(t,src)).filter(Boolean);

    // Market summary
    const pos=all.filter(c=>c.ch24>0).length,neg=all.filter(c=>c.ch24<0).length;
    const avg24h=all.length?+(all.reduce((s,c)=>s+c.ch24,0)/all.length).toFixed(2):0;
    const bigMove=all.filter(c=>Math.abs(c.ch24)>10).length,totalVol=all.reduce((s,c)=>s+c.vol,0);
    const signal=avg24h>3?'BULLISH':avg24h<-3?'BEARISH':avg24h>1?'MILD BULL':avg24h<-1?'MILD BEAR':'NEUTRAL';

    // Gainers
    const dynT=Math.max(0.5,avg24h+1.5);
    let gainers=all.filter(c=>c.ch24>=dynT&&c.vol>=300000).sort((a,b)=>(b.ch24*Math.log10(Math.max(b.vol,1))*(0.5+b.body))-(a.ch24*Math.log10(Math.max(a.vol,1))*(0.5+a.body)));
    if(gainers.length<8)gainers=all.filter(c=>c.ch24>0&&c.vol>=200000).sort((a,b)=>b.ch24-a.ch24).slice(0,30);

    // Losers
    const losers=all.filter(c=>c.ch24<=-1.0&&c.vol>=300000).sort((a,b)=>(Math.abs(b.ch24)*Math.log10(Math.max(b.vol,1)))-(Math.abs(a.ch24)*Math.log10(Math.max(a.vol,1))));

    // Volume breakout
    const volBreakouts=all.filter(c=>c.vol>=8e6).map(c=>{
      let sc=0,bType='ACTIVE';
      if(c.vt>=4&&Math.abs(c.ch24)<1.5){sc=86;bType='STEALTH 👁';}
      else if(c.vt>=3&&c.ch24>5&&c.body>0.5){sc=93;bType='BREAKOUT 🚀';}
      else if(c.vt>=3&&c.ch24>2){sc=73;bType='VOL BULL';}
      else if(c.vt>=3&&c.ch24<-5){sc=77;bType='VOL BEAR';}
      else if(c.vt>=3&&c.ch24<-2){sc=61;bType='VOL BEAR';}
      else{sc=Math.min(55,c.vt*12+Math.abs(c.ch24)*2);bType=c.ch24>=0?'VOL BULL':'VOL BEAR';}
      return{...c,bScore:Math.min(100,Math.round(sc)),bType};
    }).sort((a,b)=>b.vol-a.vol);

    // STEP 2: RSI via CryptoCompare 4H (aggregate=4, tidak diblokir)
    const RSI_LIST=['BTC','ETH','BNB','SOL','XRP','ADA','AVAX','DOGE','LINK','DOT','NEAR','APT','SUI','INJ','ARB','OP','PEPE','TON','TIA','RENDER'];
    const top5=all.filter(c=>!RSI_LIST.includes(c.symbol)&&c.vol>=5e6).sort((a,b)=>b.vol-a.vol).slice(0,5).map(c=>c.symbol);
    const rsiSyms=[...new Set([...RSI_LIST,...top5])].slice(0,22);
    let realRSICount=0;

    const ccR=await Promise.allSettled(
      rsiSyms.map(sym=>sf(`https://min-api.cryptocompare.com/data/v2/histohour?fsym=${sym}&tsym=USD&limit=56&aggregate=4&e=CCCAGG`,5500))
    );
    ccR.forEach((r,i)=>{
      if(r.status!=='fulfilled'||r.value?.Response!=='Success')return;
      const raw4h=r.value.Data?.Data;if(!raw4h||raw4h.length<16)return;
      const closes=raw4h.map(k=>+k.close).filter(v=>v>0);if(closes.length<16)return;
      const rsi=RSI14(closes);if(rsi===null)return;
      const coin=all.find(c=>c.symbol===rsiSyms[i]);
      if(coin){coin.rsi=rsi;coin.rsiReal=true;realRSICount++;}
    });

    // Estimate RSI untuk yang tidak ada data real
    all.filter(c=>!c.rsiReal).forEach(c=>{
      const base=50,chC=Math.max(-25,Math.min(25,c.ch24*2)),rpC=Math.max(-15,Math.min(15,(c.rp-0.5)*30));
      c.rsi=Math.max(10,Math.min(90,Math.round(base+chC+rpC)));c.rsiReal=false;
    });

    const rsiList=all.filter(c=>c.vol>=500000).sort((a,b)=>a.rsi-b.rsi);

    return res.status(200).json({
      ok:true,ts:Date.now(),elapsed:Date.now()-t0,version:'v16',
      src,fg,realRSICount,totalCoins:all.length,
      market:{signal,avg24h,pos,neg,bigMove,total:all.length,totalVol:+totalVol.toFixed(0)},
      gainers,losers,rsiList,volBreakouts,
      topGainers:gainers.slice(0,30),topLosers:losers.slice(0,20),
      rsiExtremes:rsiList,volumeBreakouts:volBreakouts.slice(0,30),
    });
  }catch(e){
    return res.status(200).json({ok:false,error:e.message,ts:Date.now(),elapsed:Date.now()-t0,version:'v16',fg:50,src:'error',realRSICount:0,totalCoins:0,gainers:[],losers:[],rsiList:[],volBreakouts:[],topGainers:[],topLosers:[],rsiExtremes:[],volumeBreakouts:[],market:{signal:'UNKNOWN',avg24h:0,total:0,pos:0,neg:0,bigMove:0,totalVol:0}});
  }
}
