// api/analytics.js — v16
// BINANCE KLINES DIBLOKIR dari Vercel — pakai CryptoCompare
// CryptoCompare histohour: tidak pernah diblokir dari cloud provider
// Harga realtime: CoinGecko simple price

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=15');
  if (req.method === 'OPTIONS') return res.status(200).end();
  const t0 = Date.now();

  const sf = async (url, ms) => {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), ms);
    try {
      const r = await fetch(url, { signal:c.signal, headers:{ Accept:'application/json','User-Agent':'AC369/1.0' } });
      clearTimeout(t);
      if (!r.ok) return null;
      return await r.json();
    } catch { clearTimeout(t); return null; }
  };

  const EMA = (arr, p) => {
    if (!arr||arr.length<2) return arr?.[arr.length-1]||0;
    const k=2/(p+1);
    let e=arr.slice(0,Math.min(p,arr.length)).reduce((a,b)=>a+b,0)/Math.min(p,arr.length);
    for (let i=Math.min(p,arr.length); i<arr.length; i++) e=arr[i]*k+e*(1-k);
    return +e.toFixed(6);
  };

  const RSI14 = (arr) => {
    if (!arr||arr.length<16) return 50;
    let ag=0,al=0;
    for (let i=1;i<=14;i++){const d=arr[i]-arr[i-1];d>0?ag+=d:al-=d;}
    ag/=14;al/=14;
    for (let i=15;i<arr.length;i++){const d=arr[i]-arr[i-1];ag=(ag*13+Math.max(d,0))/14;al=(al*13+Math.max(-d,0))/14;}
    return al===0?100:+(100-100/(1+ag/al)).toFixed(2);
  };

  const MACD = (arr) => {
    if (!arr||arr.length<36) return {bullish:false,bearish:false,crossUp:false,crossDown:false,histogram:0,macd:0,signal:0};
    const k12=2/13,k26=2/27,k9=2/10;
    let e12=arr.slice(0,12).reduce((a,b)=>a+b,0)/12;
    let e26=arr.slice(0,26).reduce((a,b)=>a+b,0)/26;
    const mv=[];
    for(let i=26;i<arr.length;i++){e12=arr[i]*k12+e12*(1-k12);e26=arr[i]*k26+e26*(1-k26);mv.push(e12-e26);}
    let sig=mv.slice(0,9).reduce((a,b)=>a+b,0)/9;
    for(let i=9;i<mv.length;i++)sig=mv[i]*k9+sig*(1-k9);
    const last=mv[mv.length-1],prev=mv[mv.length-2]||last,hist=last-sig,prevH=prev-sig;
    return {bullish:last>0&&hist>0,bearish:last<0&&hist<0,crossUp:hist>0&&prevH<=0,crossDown:hist<0&&prevH>=0,histogram:+hist.toFixed(8),macd:+last.toFixed(8),signal:+sig.toFixed(8)};
  };

  const BB = (arr,p=20) => {
    if (!arr||arr.length<p) return {upper:0,lower:0,mid:0,width:0,position:50,squeeze:false};
    const sl=arr.slice(-p),m=sl.reduce((a,b)=>a+b,0)/p;
    const sd=Math.sqrt(sl.reduce((s,v)=>s+(v-m)**2,0)/p);
    const up=m+2*sd,dn=m-2*sd,last=arr[arr.length-1];
    return {upper:+up.toFixed(6),lower:+dn.toFixed(6),mid:+m.toFixed(6),width:sd>0?+((4*sd/m)*100).toFixed(2):0,position:sd>0?+((last-dn)/(4*sd)*100).toFixed(1):50,squeeze:sd>0&&(4*sd/m)*100<3};
  };

  const ATR = (K,p=14) => {
    if (!K||K.length<2) return 0;
    const tr=K.slice(1).map((k,i)=>Math.max(k.h-k.l,Math.abs(k.h-K[i].c),Math.abs(k.l-K[i].c)));
    return tr.slice(-p).reduce((a,b)=>a+b,0)/Math.min(p,tr.length);
  };

  const toK4H = (h) => {
    if (!h||!h.length) return [];
    const v=h.filter(d=>d.close>0&&d.open>0),out=[];
    for(let i=0;i+3<v.length;i+=4){const ch=v.slice(i,i+4);out.push({t:ch[0].time,o:ch[0].open,h:Math.max(...ch.map(c=>c.high)),l:Math.min(...ch.map(c=>c.low)),c:ch[3].close,v:ch.reduce((s,c)=>s+(c.volumeto||0),0)});}
    return out;
  };

  const analyze = (sym,K4h,K1h,price,ch24,vol) => {
    if (!K4h||K4h.length<20) return null;
    const c4=K4h.map(k=>k.c),c1=(K1h&&K1h.length>=16?K1h:K4h.slice(-24)).map(k=>k.c||k);
    const rsi4h=RSI14(c4),rsi1h=RSI14(c1),rsi1d=RSI14(c4.filter((_,i)=>i%6===0));
    const ema9=EMA(c4,9),ema21=EMA(c4,21),ema50=EMA(c4,Math.min(50,c4.length-1)),ema200=EMA(c4,Math.min(200,c4.length-1));
    const macd=MACD(c4),bb=BB(c4,20),atr=ATR(K4h,14);
    let ts=0;
    if(price>ema9)ts+=1;if(price>ema21)ts+=1;if(price>ema50)ts+=1;if(price>ema200)ts+=2;
    if(macd.bullish)ts+=1;if(rsi4h>55)ts+=1;else if(rsi4h<45)ts-=1;
    if(macd.crossUp)ts+=2;if(macd.crossDown)ts-=2;
    const action=ts>=5?'STRONG BUY':ts>=3?'BUY':ts<=-5?'STRONG SELL':ts<=-3?'SELL':'HOLD';
    const t4h=ts>=3?'BULLISH':ts<=-3?'BEARISH':'NEUTRAL';
    const prob=Math.max(5,Math.min(95,50+ts*7));
    const sH=[...K4h.slice(-30).map(k=>k.h)].sort((a,b)=>b-a),sL=[...K4h.slice(-30).map(k=>k.l)].sort((a,b)=>a-b);
    const res2=sH.find(h=>h>price)||price*1.05,sup=sL.find(l=>l<price)||price*0.95;
    const pv=K4h[K4h.length-2]||K4h[K4h.length-1],P=(pv.h+pv.l+pv.c)/3;
    const pivot={P:+P.toFixed(4),R1:+(2*P-pv.l).toFixed(4),R2:+(P+pv.h-pv.l).toFixed(4),S1:+(2*P-pv.h).toFixed(4),S2:+(P-(pv.h-pv.l)).toFixed(4)};
    const pts=[];
    if(t4h==='BULLISH')pts.push('Tren 4H bullish — EMA aligned upward.');
    else if(t4h==='BEARISH')pts.push('Tren 4H bearish — tekanan jual dominan.');
    else pts.push('4H sideways/konsolidasi.');
    if(rsi4h<30)pts.push(`RSI ${rsi4h} oversold — potensi reversal kuat.`);
    else if(rsi4h>70)pts.push(`RSI ${rsi4h} overbought — waspada koreksi.`);
    else pts.push(`RSI ${rsi4h} zona normal.`);
    if(macd.crossUp)pts.push('MACD golden cross ✅');if(macd.crossDown)pts.push('MACD death cross ⚠️');
    if(bb.squeeze)pts.push('BB squeeze — breakout imminent!');
    pts.push(`EMA200: $${ema200.toLocaleString('en-US',{maximumFractionDigits:2})}.`);
    return {
      symbol:sym+'USDT',ticker:sym,currentPrice:+price,change24h:+ch24.toFixed(2),volume24h:+vol,
      dataSource:'cryptocompare+coingecko',candleCount:K4h.length,probabilityScore:prob,
      confluenceSignal:action.includes('BUY')?'Bullish':action.includes('SELL')?'Bearish':'Neutral',
      action,overallTrend:t4h,technicalSummary:pts.join(' '),
      rsi:{'1h':rsi1h,'4h':rsi4h,'1d':rsi1d},
      maStatus:{ema9:+ema9.toFixed(4),ema21:+ema21.toFixed(4),ema50:+ema50.toFixed(4),ema200:+ema200.toFixed(4),position:price>ema200?`Above EMA200 (+${((price-ema200)/ema200*100).toFixed(1)}%)`:`Below EMA200 (${((price-ema200)/ema200*100).toFixed(1)}%)`},
      macd:{'4h':macd},bb:{'4h':bb,squeeze:bb.squeeze},
      atr:{'4h':+atr.toFixed(6),atrPct:+(atr/price*100).toFixed(2),volatility:atr/price*100>5?'HIGH':atr/price*100>2?'MEDIUM':'LOW'},
      keyLevels:{support:+sup.toFixed(4),resistance:+res2.toFixed(4)},
      pivotPoints:{'4H':pivot},
      trends:{'1h':rsi1h>55?'BULLISH':rsi1h<45?'BEARISH':'NEUTRAL','4h':t4h,'1d':t4h,overall:t4h},
      scoreBreakdown:{tScore:ts,bullPct:Math.max(1,Math.min(99,50+ts*7))},
    };
  };

  try {
    const [btcHR,ethHR,priceR] = await Promise.allSettled([
      sf('https://min-api.cryptocompare.com/data/v2/histohour?fsym=BTC&tsym=USD&limit=800&aggregate=1&e=CCCAGG',7000),
      sf('https://min-api.cryptocompare.com/data/v2/histohour?fsym=ETH&tsym=USD&limit=800&aggregate=1&e=CCCAGG',7000),
      sf('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true',5000),
    ]);

    const btcH=btcHR.status==='fulfilled'&&btcHR.value?.Response==='Success'?btcHR.value.Data.Data:[];
    const ethH=ethHR.status==='fulfilled'&&ethHR.value?.Response==='Success'?ethHR.value.Data.Data:[];
    const btcK4=toK4H(btcH),ethK4=toK4H(ethH);
    const toK1=(h)=>h.slice(-48).filter(d=>d.close>0).map(d=>({t:d.time,o:d.open,h:d.high,l:d.low,c:d.close}));
    const btcK1=toK1(btcH),ethK1=toK1(ethH);

    const prices=priceR.status==='fulfilled'?priceR.value:null;
    const btcPx=prices?.bitcoin?.usd||(btcK4.length?btcK4[btcK4.length-1].c:0);
    const ethPx=prices?.ethereum?.usd||(ethK4.length?ethK4[ethK4.length-1].c:0);
    const btcCh=prices?.bitcoin?.usd_24h_change||0;
    const ethCh=prices?.ethereum?.usd_24h_change||0;
    const btcVol=prices?.bitcoin?.usd_24h_vol||0;
    const ethVol=prices?.ethereum?.usd_24h_vol||0;

    const btcData=btcK4.length>=20?analyze('BTC',btcK4,btcK1,btcPx,btcCh,btcVol):null;
    const ethData=ethK4.length>=20?analyze('ETH',ethK4,ethK1,ethPx,ethCh,ethVol):null;

    let narrative='';
    if(btcData){
      const bt=btcData.overallTrend,et=ethData?.overallTrend,lines=[];
      if(bt==='BULLISH'&&et==='BULLISH')lines.push('🟢 BTC & ETH keduanya bullish — kondisi risk-on aktif, altcoin berpeluang follow.');
      else if(bt==='BULLISH')lines.push('📈 BTC bullish tapi ETH laggard — rotasi ke altcoin belum penuh.');
      else if(bt==='BEARISH')lines.push('🔴 BTC bearish — smart money distribusi, risk management ketat.');
      else lines.push('⚖️ Market konsolidasi. Tunggu konfirmasi breakout bervolume.');
      const r=btcData.rsi?.['4h']||50;
      if(r<30)lines.push(`RSI BTC oversold (${r}) — zona akumulasi institusional.`);
      else if(r>70)lines.push(`RSI BTC overbought (${r}) — potensi profit taking.`);
      if(btcData.macd?.['4h']?.crossUp)lines.push('MACD BTC golden cross — momentum bullish baru dimulai.');
      if(btcData.macd?.['4h']?.crossDown)lines.push('MACD BTC death cross — waspadai penurunan lanjutan.');
      if(btcData.bb?.['4h']?.squeeze)lines.push('BB squeeze BTC — ekspansi volatilitas besar akan segera terjadi.');
      narrative=lines.join(' ');
    }

    return res.status(200).json({
      ok:true,ts:Date.now(),elapsed:Date.now()-t0,version:'v16',src:'cryptocompare+coingecko',
      btcCandleCount:btcK4.length,ethCandleCount:ethK4.length,
      btc:btcData,eth:ethData,
      smartMoneyNarrative:narrative||'Analisis teknikal sedang diproses...',
    });
  } catch(e) {
    return res.status(200).json({ok:false,error:e.message,ts:Date.now(),elapsed:Date.now()-t0,version:'v16',btc:null,eth:null,smartMoneyNarrative:'Error: '+e.message});
  }
}
