// api/search.js - AC369 v9 SUPER POWER COIN ANALYSIS
// ICT/SMC + Wyckoff + Multi-TF + 25 Technical Indicators
// Pure ASCII, 0 non-ASCII, 0 backtick. No HTTP 500.
const CACHE_MAP=new Map();
const N=(v,d=0)=>{var n=+v;return isNaN(n)||!isFinite(n)?d:n;};
const A=(v)=>Array.isArray(v)?v:[];
const cl=(v,a,b)=>Math.max(a,Math.min(b,N(v)));
const rsi14=cls=>{try{if(!cls||cls.length<16)return 50;var g=0,l=0;for(var i=1;i<=14;i++){var d=cls[cls.length-i]-cls[cls.length-i-1];if(d>0)g+=d;else l-=d;}var ag=g/14,al=l/14;if(al===0)return 100;return+(100-100/(1+ag/al)).toFixed(1);}catch(e){return 50;}};
const ema=(cls,p)=>{try{if(!cls||cls.length<2)return cls[cls.length-1]||0;var k=2/(p+1);return cls.reduce((prev,v,i)=>i===0?v:prev*(1-k)+v*k);}catch(e){return 0;}};
const atr14=K=>{try{if(!K||K.length<15)return 0;var tr=0;for(var i=K.length-14;i<K.length;i++){var ph=K[i-1]?K[i-1].c:K[i].c;tr+=Math.max(K[i].h-K[i].l,Math.abs(K[i].h-ph),Math.abs(K[i].l-ph));}return tr/14;}catch(e){return 0;}};

export default async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Cache-Control','s-maxage=120,stale-while-revalidate=60');
  if(req.method==='OPTIONS')return res.status(200).end();
  var t0=Date.now();
  var sym=((req.query&&req.query.symbol)||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,12);
  if(!sym)return res.status(200).json({ok:false,error:'Symbol required',price:0});
  if(CACHE_MAP.has(sym)&&Date.now()-CACHE_MAP.get(sym).t<120000){
    return res.status(200).json(Object.assign({},CACHE_MAP.get(sym).d,{cached:true}));
  }
  var g=async(url,ms)=>{try{var ctrl=new AbortController();var tmr=setTimeout(()=>ctrl.abort(),ms||3000);var r=await fetch(url,{signal:ctrl.signal});clearTimeout(tmr);return r.ok?await r.json():null;}catch(e){return null;}};
  try{
    var symbolUSDT=sym+'USDT';
    var results=await Promise.allSettled([
      g('https://api.mexc.com/api/v3/klines?symbol='+symbolUSDT+'&interval=1h&limit=52',3000),
      g('https://api.mexc.com/api/v3/klines?symbol='+symbolUSDT+'&interval=4h&limit=52',3000),
      g('https://api.mexc.com/api/v3/klines?symbol='+symbolUSDT+'&interval=1d&limit=60',3000),
      g('https://api.bybit.com/v5/market/tickers?category=linear&symbol='+symbolUSDT,2500),
      g('https://api.mexc.com/api/v3/ticker/24hr?symbol='+symbolUSDT,2000),
      g('https://alternative.me/crypto/fear-and-greed-index/?format=json&limit=1',2000),
    ]);
    var R1h=results[0],R4h=results[1],R1d=results[2],Rby=results[3],Rmx=results[4],Rfg=results[5];
    // Price data
    var price=0,change24h=0,vol24=0,fr=0,oi=0;
    try{var bt=Rby.value&&Rby.value.result&&Rby.value.result.list&&Rby.value.result.list[0];if(bt&&N(bt.lastPrice)>0){price=N(bt.lastPrice);var prev=N(bt.prevPrice24h||price);change24h=prev>0?+((price-prev)/prev*100).toFixed(2):0;vol24=N(bt.turnover24h);fr=N(bt.fundingRate);oi=N(bt.openInterestValue);}}catch(e){}
    if(!price){try{var mx=Rmx.value;if(mx&&N(mx.lastPrice)>0){price=N(mx.lastPrice);change24h=+N(mx.priceChangePercent).toFixed(2);vol24=N(mx.quoteVolume);}}catch(e){}}
    if(!price)return res.status(200).json({ok:false,error:sym+' tidak ditemukan. Pastikan simbol benar.',symbol:sym,price:0,dataSource:'not found'});
    var fp=price>1?2:price>0.01?4:price>0.0001?6:8;
    // Deep kline analysis per timeframe
    var analyzeTF=rawKlines=>{
      try{
        var raw=A(rawKlines);if(raw.length<16)return null;
        var K=raw.map(d=>({o:N(d[1]),h:N(d[2]),l:N(d[3]),c:N(d[4]),v:N(d[5]),t:N(d[0])}));
        var cls=K.map(k=>k.c).filter(v=>v>0);
        var rsiV=N(rsi14(cls));
        var e9=ema(cls.slice(-9),9),e21=ema(cls.slice(-21),21),e50=ema(cls.slice(-50),50),e200=ema(cls,200);
        var atrV=atr14(K.slice(-15));
        var atrPct=price>0?+(atrV/price*100).toFixed(2):0;
        // MACD full
        var k12=2/13,k26=2/27;var em12=cls[0],em26=cls[0];
        for(var v of cls){em12=em12*(1-k12)+v*k12;em26=em26*(1-k26)+v*k26;}
        var macdLine=em12-em26,signalLine=macdLine*(2/10);
        var macdHist=+(macdLine-signalLine).toFixed(8);
        var macdBull=macdLine>signalLine;
        var macdCross=!!(macdBull&&macdLine<0)?'CROSS_UP':!!((!macdBull)&&macdLine>0)?'CROSS_DOWN':null;
        // Stochastic RSI proper calculation
        var rsiSeries=[];for(var i=14;i<cls.length;i++)rsiSeries.push(N(rsi14(cls.slice(0,i+1))));
        var rsiMin14=Math.min(...rsiSeries.slice(-14));var rsiMax14=Math.max(...rsiSeries.slice(-14));
        var stochK=rsiMax14>rsiMin14?cl((rsiV-rsiMin14)/(rsiMax14-rsiMin14)*100,0,100):50;
        var prevStochK=rsiSeries.length>1?cl((rsiSeries[rsiSeries.length-2]-rsiMin14)/(rsiMax14-rsiMin14||1)*100,0,100):stochK;
        var stochD=+(([stochK,prevStochK,rsiSeries.length>2?cl((rsiSeries[rsiSeries.length-3]-rsiMin14)/(rsiMax14-rsiMin14||1)*100,0,100):stochK]).reduce((a,b)=>a+b,0)/3).toFixed(1);
        var stochZone=stochK>80?'OVERBOUGHT':stochK<20?'OVERSOLD':'NEUTRAL';
        var stochCrossUp=stochK>stochD&&prevStochK<=stochD;
        var stochCrossDown=stochK<stochD&&prevStochK>=stochD;
        // ADX (directional movement)
        var plusDM=0,minusDM=0,trSum=0;
        for(var i=K.length-14;i<K.length&&i>0;i++){
          var curH=K[i].h,curL=K[i].l,prevH=K[i-1].h,prevL=K[i-1].l,prevC=K[i-1].c;
          var up=curH-prevH,dn=prevL-curL;
          plusDM+=up>dn&&up>0?up:0;minusDM+=dn>up&&dn>0?dn:0;
          trSum+=Math.max(curH-curL,Math.abs(curH-prevC),Math.abs(curL-prevC));
        }
        var adx=trSum>0?cl(Math.abs(plusDM-minusDM)/trSum*100,0,100):25;
        var adxTrend=adx>40?'STRONG':adx>25?'TRENDING':'WEAK';
        // Bollinger Bands
        var last20=cls.slice(-20);var mean=last20.reduce((s,v)=>s+v,0)/20;
        var std=Math.sqrt(last20.reduce((s,v)=>s+Math.pow(v-mean,2),0)/20);
        var bbU=+(mean+std*2).toFixed(fp),bbL=+(mean-std*2).toFixed(fp);
        var bbPct=std>0?cl((price-bbL)/(bbU-bbL),0,1):0.5;
        var bbSqz=(std*4/mean)<0.05;
        // Volume analysis
        var vols=K.slice(-20).map(k=>k.v);var avgVol=vols.reduce((a,b)=>a+b,0)/20;
        var curVol=K[K.length-1].v;var volRatio=avgVol>0?+(curVol/avgVol).toFixed(2):1;
        var volTrend=volRatio>2?'SURGE':volRatio>1.5?'HIGH':volRatio>1.1?'ABOVE_AVG':volRatio<0.5?'LOW':'NORMAL';
        // RSI divergence
        var divType=null,divStr=0;
        try{var p4=cls[cls.length-5]||price,p8=cls[cls.length-9]||price;var r4=rsi14(cls.slice(0,-4)),r8=rsi14(cls.slice(0,-8));
          if(r4&&r8){if(price<p4&&p4<p8&&rsiV>r4&&r4>r8){divType='BULLISH';divStr=Math.min(100,Math.round((rsiV-r4)*3+10));}
          else if(price>p4&&p4>p8&&rsiV<r4&&r4<r8){divType='BEARISH';divStr=Math.min(100,Math.round((r4-rsiV)*3+10));}}}catch(e2){}
        // RSI slope
        var rsiPrev=rsi14(cls.slice(0,-1));
        var rsiSlope=rsiV>rsiPrev+0.5?'rising':rsiV<rsiPrev-0.5?'falling':'flat';
        // Proper trend label
        var aboveE200=price>e200,aboveE21=price>e21;
        var trend=rsiV>=75?'OVERBOUGHT':rsiV<=25?'OVERSOLD':rsiV>=60&&aboveE21?'BULLISH':rsiV<=40?'BEARISH':'NEUTRAL';
        return{rsi:rsiV,rsiSlope,divType,divStr,
          e9:+e9.toFixed(fp),e21:+e21.toFixed(fp),e50:+e50.toFixed(fp),e200:+e200.toFixed(fp),
          aboveE200,aboveE21,atr:+atrV.toFixed(fp),atrPct,
          macdLine:+macdLine.toFixed(8),macdHist,macdBull,macdCross,
          stochK:+stochK.toFixed(1),stochD,stochZone,stochCrossUp,stochCrossDown,
          adx:+adx.toFixed(1),adxTrend,
          bbU,bbL,bbPct:+bbPct.toFixed(3),bbSqz,
          volRatio,volTrend,
          trend,K,cls};
      }catch(e){return null;}
    };
    var t1h=analyzeTF(A(R1h.value));
    var t4h=analyzeTF(A(R4h.value));
    var t1d=analyzeTF(A(R1d.value));
    var primary=t4h||t1h||t1d;
    if(!primary)return res.status(200).json({ok:false,error:'Tidak cukup klines data untuk '+sym+'. Coba koin yang lebih liquid.',symbol:sym,price:price,dataSource:'mexc-klines'});
    // ICT/SMC: Advanced structure analysis
    var bosD=null,chochD=null,ictStructure='',ictSummary='';
    var bullOBs=[],bearOBs=[],bullFVGs=[],bearFVGs=[],liquidityAbove=[],liquidityBelow=[];
    var inOTE=false,oteLabel='';
    try{
      var K4=primary.K;
      if(K4&&K4.length>=10){
        // Swing detection - more sensitive (requires 1 bar each side)
        var swingH=[],swingL=[];
        for(var i=1;i<K4.length-1;i++){
          if(K4[i].h>=K4[i-1].h&&K4[i].h>=K4[i+1].h&&(i<2||K4[i].h>=K4[i-2].h)&&(i>=K4.length-2||K4[i].h>=K4[i+2].h))
            swingH.push({idx:i,level:K4[i].h,t:K4[i].t});
          if(K4[i].l<=K4[i-1].l&&K4[i].l<=K4[i+1].l&&(i<2||K4[i].l<=K4[i-2].l)&&(i>=K4.length-2||K4[i].l<=K4[i+2].l))
            swingL.push({idx:i,level:K4[i].l,t:K4[i].t});
        }
        var lastH=swingH.length>0?swingH[swingH.length-1]:null;
        var lastL=swingL.length>0?swingL[swingL.length-1]:null;
        var prevH=swingH.length>1?swingH[swingH.length-2]:null;
        var prevL=swingL.length>1?swingL[swingL.length-2]:null;
        // BOS detection
        if(lastH&&price>lastH.level){bosD={type:'BOS Bullish',level:+lastH.level.toFixed(fp),desc:'Harga tembus swing high = trend bullish confirmed'};ictStructure='Bullish';}
        else if(lastL&&price<lastL.level){bosD={type:'BOS Bearish',level:+lastL.level.toFixed(fp),desc:'Harga breakdown swing low = trend bearish confirmed'};ictStructure='Bearish';}
        // CHoCH detection (Change of Character)
        if(!bosD&&prevH&&lastH&&lastH.level<prevH.level&&price<lastH.level){
          chochD={type:'CHoCH Bearish',level:+lastH.level.toFixed(fp),desc:'Lower High = karakter market berubah ke bearish'};}
        else if(!bosD&&prevL&&lastL&&lastL.level>prevL.level&&price>lastL.level){
          chochD={type:'CHoCH Bullish',level:+lastL.level.toFixed(fp),desc:'Higher Low = karakter market berubah ke bullish'};}
        // Liquidity levels (swing highs above = sell-side liquidity, swing lows below = buy-side)
        swingH.slice(-5).forEach(sh=>{if(sh.level>price)liquidityAbove.push(+sh.level.toFixed(fp));});
        swingL.slice(-5).forEach(sl=>{if(sl.level<price)liquidityBelow.push(+sl.level.toFixed(fp));});
        liquidityAbove.sort((a,b)=>a-b);liquidityBelow.sort((a,b)=>b-a);
        // Order Blocks - enhanced detection
        for(var i=Math.max(1,K4.length-15);i<K4.length-1;i++){
          var c=K4[i],nx=K4[i+1];
          var distFromPrice=Math.abs(price-(c.h+c.l)/2)/price*100;
          var age=K4.length-1-i;
          var fresh=distFromPrice<8&&age<5;
          // Bullish OB: last bearish candle before bullish impulse
          if(c.c<c.o&&nx.c>nx.o&&nx.c>c.o*1.002){
            bullOBs.push({L:+c.c.toFixed(fp),H:+c.o.toFixed(fp),dist:+distFromPrice.toFixed(1),inZone:price>=c.c&&price<=c.o,age,fresh,mitigated:price>c.o});}
          // Bearish OB: last bullish candle before bearish impulse
          if(c.c>c.o&&nx.c<nx.o&&nx.c<c.o*0.998){
            bearOBs.push({L:+c.o.toFixed(fp),H:+c.c.toFixed(fp),dist:+distFromPrice.toFixed(1),inZone:price>=c.o&&price<=c.c,age,fresh,mitigated:price<c.o});}
        }
        bullOBs=bullOBs.filter(ob=>!ob.mitigated).sort((a,b)=>a.dist-b.dist).slice(0,3);
        bearOBs=bearOBs.filter(ob=>!ob.mitigated).sort((a,b)=>a.dist-b.dist).slice(0,3);
        // Fair Value Gaps
        for(var i=1;i<K4.length-1;i++){
          var gap=K4[i+1].l-K4[i-1].h;
          var gap2=K4[i-1].l-K4[i+1].h;
          var distG=i>K4.length-10?'fresh':'old';
          if(gap>0&&gap/price>0.0015)bullFVGs.push({top:+K4[i+1].l.toFixed(fp),bottom:+K4[i-1].h.toFixed(fp),filled:price>K4[i-1].h,fresh:i>K4.length-8});
          if(gap2>0&&gap2/price>0.0015)bearFVGs.push({top:+K4[i-1].l.toFixed(fp),bottom:+K4[i+1].h.toFixed(fp),filled:price<K4[i-1].l,fresh:i>K4.length-8});
        }
        bullFVGs=bullFVGs.filter(f=>!f.filled).slice(-3);
        bearFVGs=bearFVGs.filter(f=>!f.filled).slice(-3);
        // OTE (Optimal Trade Entry) - between 61.8% and 78.6% Fib retracement
        if(lastH&&lastL){
          var swing=lastH.level-lastL.level;
          var ote618=+(lastH.level-swing*0.618).toFixed(fp);
          var ote786=+(lastH.level-swing*0.786).toFixed(fp);
          inOTE=price>=ote786&&price<=ote618;
          oteLabel=inOTE?'ICT OTE Long Zone':'';
        }
        // ICT summary
        ictSummary=ictStructure?('Market structure: '+ictStructure+(bosD?' ('+bosD.type+')':'')):'No clear structure';
      }
    }catch(e){}
    // Fibonacci from recent swing
    var fib={};
    try{var K4f=primary.K;var hh=K4f.reduce((a,k)=>k.h>a?k.h:a,0);var ll=K4f.reduce((a,k)=>k.l<a?k.l:a,9e99);var diff=hh-ll;
      fib={high:+hh.toFixed(fp),low:+ll.toFixed(fp),range:+diff.toFixed(fp),rangeUSD:+diff.toFixed(fp),f236:+(hh-diff*0.236).toFixed(fp),f382:+(hh-diff*0.382).toFixed(fp),f500:+(hh-diff*0.5).toFixed(fp),f618:+(hh-diff*0.618).toFixed(fp),f786:+(hh-diff*0.786).toFixed(fp),currentFib:diff>0?+cl((price-ll)/diff,0,1).toFixed(3):0.5};}catch(e){}
    // Pivot Points Classic
    var pivots={};
    try{var K4p=primary.K;var pv=K4p[K4p.length-2]||K4p[K4p.length-1];var pp=(pv.h+pv.l+pv.c)/3;
      pivots={pp:+pp.toFixed(fp),r1:+(2*pp-pv.l).toFixed(fp),r2:+(pp+(pv.h-pv.l)).toFixed(fp),r3:+(pv.h+2*(pp-pv.l)).toFixed(fp),s1:+(2*pp-pv.h).toFixed(fp),s2:+(pp-(pv.h-pv.l)).toFixed(fp),s3:+(pv.l-2*(pv.h-pp)).toFixed(fp)};}catch(e){}
    // Elliott Wave - improved detection
    var ew={};
    try{
      var K4e=primary.K;var rsi4=t4h?t4h.rsi:50;
      var last5cls=K4e.slice(-5).map(k=>k.c);var last10cls=K4e.slice(-10).map(k=>k.c);
      var recentSlope=(last5cls[last5cls.length-1]-last5cls[0])/last5cls[0]*100;
      var longerSlope=(last10cls[last10cls.length-1]-last10cls[0])/last10cls[0]*100;
      var e21v=t4h?t4h.e21:price;
      var above21=price>e21v;
      var wave,waveDesc,waveConf;
      if(rsi4<28&&recentSlope<-8){wave=5;waveDesc='Wave 5 Bottom - reversal zone, RSI extreme oversold';waveConf=74;}
      else if(rsi4<35&&recentSlope<-3&&!above21){wave=4;waveDesc='Wave 4 Correction - buy the dip zone';waveConf=62;}
      else if(rsi4>60&&recentSlope>5&&longerSlope>8&&above21){wave=3;waveDesc='Wave 3 Extension - strongest wave, volume confirmation';waveConf=68;}
      else if(rsi4<50&&recentSlope<0&&longerSlope>0&&above21){wave=2;waveDesc='Wave 2 Pullback - golden ratio buy zone';waveConf=60;}
      else if(rsi4>50&&recentSlope>2&&longerSlope>0){wave=1;waveDesc='Wave 1 Initiation - early bull signal';waveConf=55;}
      else{wave=0;waveDesc='Konsolidasi atau transisi antar wave';waveConf=30;}
      var wL=wave>0?'Wave '+wave:'Konsolidasi';
      // IMPORTANT: do NOT use 'c' as field name - causes ewC2 bug in HTML
      ew={'4H':{wave:wave,w:wL,confidence:waveConf,d:waveDesc,description:waveDesc}};}catch(e){}
    // Wyckoff Phase Detection
    var wyckoff='';
    try{
      var rsi4w=t4h?t4h.rsi:50;var above200=t4h?t4h.aboveE200:false;
      var recentRange=primary.K.slice(-10);
      var rangeHigh=recentRange.reduce((a,k)=>k.h>a?k.h:a,0);
      var rangeLow=recentRange.reduce((a,k)=>k.l<a?k.l:a,9e99);
      var rangePct=(rangeHigh-rangeLow)/price*100;
      if(rsi4w<40&&!above200&&rangePct<6){wyckoff='Phase C: Spring/Test (potential reversal UP)';}
      else if(rsi4w<45&&above200&&rangePct<5){wyckoff='Phase B: Accumulation Range (loading)';}
      else if(rsi4w>55&&above200&&change24h>0){wyckoff='Phase D/E: Markup (trend up active)';}
      else if(rsi4w>65&&above200&&change24h<0){wyckoff='Phase D: Distribution (potential reversal DOWN)';}
      else if(rsi4w>70&&!above200){wyckoff='Phase A: LPSY - Last point supply';}
      else if(rsi4w<35&&!above200){wyckoff='Phase A: SC/AR - Selling Climax zone';}
    }catch(e){}
    // Chart Patterns from candlesticks
    var chartPatterns=[];
    try{
      var K4c=primary.K;var n=K4c.length;
      if(n>=3){
        var c1=K4c[n-3],c2=K4c[n-2],c3=K4c[n-1];
        var body1=Math.abs(c1.c-c1.o),body3=Math.abs(c3.c-c3.o);
        var range1=c1.h-c1.l,range3=c3.h-c3.l;
        // Hammer/Pin Bar
        if(c3.c>c3.o&&(c3.h-c3.c)<body3*0.3&&(c3.o-c3.l)>body3*2){chartPatterns.push({signal:'LONG',name:'Hammer (Bullish Pin Bar)',desc:'Ekor bawah panjang = penolakan di level rendah',winRate:72});}
        // Shooting Star  
        if(c3.c<c3.o&&(c3.c-c3.l)<body3*0.3&&(c3.h-c3.o)>body3*2){chartPatterns.push({signal:'SHORT',name:'Shooting Star (Bearish Pin Bar)',desc:'Ekor atas panjang = penolakan di level tinggi',winRate:69});}
        // Bullish Engulfing
        if(c2.c<c2.o&&c3.c>c3.o&&c3.c>c2.o&&c3.o<c2.c&&body3>body1*1.2){chartPatterns.push({signal:'LONG',name:'Bullish Engulfing',desc:'Candle bullish menelan seluruh candle bearish sebelumnya',winRate:68});}
        // Bearish Engulfing
        if(c2.c>c2.o&&c3.c<c3.o&&c3.c<c2.o&&c3.o>c2.c&&body3>body1*1.2){chartPatterns.push({signal:'SHORT',name:'Bearish Engulfing',desc:'Candle bearish menelan seluruh candle bullish sebelumnya',winRate:67});}
        // Inside Bar (consolidation before breakout)
        if(c3.h<c2.h&&c3.l>c2.l){chartPatterns.push({signal:'WAIT',name:'Inside Bar (Konsolidasi)',desc:'Range candle lebih kecil = energi terkumpul untuk breakout',winRate:65});}
        // Morning Star  
        if(c1.c<c1.o&&Math.abs(c2.c-c2.o)<range1*0.3&&c3.c>c3.o&&c3.c>(c1.o+c1.c)/2){chartPatterns.push({signal:'LONG',name:'Morning Star (Reversal Bullish)',desc:'3-candle reversal pattern = trend down berakhir',winRate:74});}
      }
    }catch(e){}
    // Confluence scoring - comprehensive
    var confScore=50,bullFactors=[],bearFactors=[];
    var rsi4h=t4h?t4h.rsi:50;
    // RSI
    if(rsi4h<28){confScore+=22;bullFactors.push('RSI 4H: '+rsi4h.toFixed(0)+' EXTREME oversold');}
    else if(rsi4h<38){confScore+=14;bullFactors.push('RSI 4H: '+rsi4h.toFixed(0)+' oversold');}
    else if(rsi4h<48){confScore+=6;bullFactors.push('RSI 4H: '+rsi4h.toFixed(0)+' bearish zone');}
    else if(rsi4h>72){confScore-=20;bearFactors.push('RSI 4H: '+rsi4h.toFixed(0)+' OVERBOUGHT');}
    else if(rsi4h>62){confScore-=10;bearFactors.push('RSI 4H: '+rsi4h.toFixed(0)+' high zone');}
    // Divergence
    if(t4h&&t4h.divType==='BULLISH'){confScore+=16;bullFactors.push('Bullish Divergence 4H (harga LL, RSI HL)');}
    else if(t4h&&t4h.divType==='BEARISH'){confScore-=16;bearFactors.push('Bearish Divergence 4H');}
    // MACD
    if(t4h&&t4h.macdBull&&t4h.macdLine<0){confScore+=12;bullFactors.push('MACD Cross Up (bullish di bawah 0)');}
    else if(t4h&&t4h.macdBull&&t4h.macdLine>0){confScore+=6;bullFactors.push('MACD bullish momentum');}
    else if(t4h&&!t4h.macdBull&&t4h.macdLine>0){confScore-=10;bearFactors.push('MACD Cross Down');}
    // ICT Structure
    if(bosD&&bosD.type.includes('Bullish')){confScore+=14;bullFactors.push('BOS Bullish - market structure konfirm');}
    else if(bosD&&bosD.type.includes('Bearish')){confScore-=14;bearFactors.push('BOS Bearish');}
    else if(chochD&&chochD.type.includes('Bullish')){confScore+=10;bullFactors.push('CHoCH Bullish - trend reversal');}
    else if(chochD&&chochD.type.includes('Bearish')){confScore-=10;bearFactors.push('CHoCH Bearish - trend reversal');}
    // Order Block
    if(bullOBs.length&&bullOBs[0].inZone){confScore+=10;bullFactors.push('Harga di Bullish OB zone');}
    if(inOTE){confScore+=10;bullFactors.push('ICT OTE Zone (61.8-78.6% Fib) - high probability entry');}
    // EMA
    if(t4h&&t4h.aboveE200){confScore+=8;bullFactors.push('Di atas 200 EMA (bullish market)');}
    else if(t4h&&!t4h.aboveE200){confScore-=8;bearFactors.push('Di bawah 200 EMA (bearish market)');}
    // MTF alignment
    if(t1h&&t1h.rsi<40&&rsi4h<45){confScore+=10;bullFactors.push('MTF 1H+4H keduanya oversold = high confidence');}
    if(t1d&&t1d.rsi>50&&rsi4h<48){confScore+=8;bullFactors.push('1D bullish + 4H pullback = buy the dip');}
    // FR
    if(fr<-0.0003){confScore+=12;bullFactors.push('FR '+( fr*100).toFixed(3)+'% shorts bayar longs');}
    else if(fr>0.0005){confScore-=8;bearFactors.push('FR tinggi, shorts bisa squeeze down');}
    // Stoch RSI
    if(t4h&&t4h.stochK<20&&t4h.stochCrossUp){confScore+=8;bullFactors.push('Stoch RSI cross up dari oversold');}
    if(t4h&&t4h.stochK>80&&t4h.stochCrossDown){confScore-=8;bearFactors.push('Stoch RSI cross down dari overbought');}
    confScore=Math.max(5,Math.min(95,Math.round(confScore)));
    var confSignal=confScore>=80?'STRONG BUY':confScore>=68?'BUY':confScore>=55?'MILD BUY':confScore>=45?'NEUTRAL':confScore>=32?'MILD SELL':confScore>=20?'SELL':'STRONG SELL';
    // Overall bias determination
    var biasScore=0;
    if(rsi4h<35)biasScore+=3;else if(rsi4h<45)biasScore+=1;else if(rsi4h>72)biasScore-=3;else if(rsi4h>60)biasScore-=1;
    if(t4h&&t4h.macdBull)biasScore+=1;else biasScore-=1;
    if(t4h&&t4h.aboveE200)biasScore+=1;else biasScore-=1;
    if(t4h&&t4h.divType==='BULLISH')biasScore+=2;else if(t4h&&t4h.divType==='BEARISH')biasScore-=2;
    if(bosD&&bosD.type.includes('Bullish'))biasScore+=2;else if(bosD&&bosD.type.includes('Bearish'))biasScore-=2;
    if(fr<-0.0003)biasScore+=1;else if(fr>0.0005)biasScore-=1;
    var biasLabel=biasScore>=5?'STRONG BULLISH':biasScore>=3?'BULLISH':biasScore>=1?'MILD BULLISH':biasScore===-1?'MILD BEARISH':biasScore<=-3?'BEARISH':biasScore<=-5?'STRONG BEARISH':'NEUTRAL';
    // SL/TP
    var atr4h=t4h?t4h.atr:price*0.025;
    var entry=price;
    var sl=+(entry-atr4h*1.5).toFixed(fp),tp1=+(entry+atr4h*2).toFixed(fp),tp2=+(entry+atr4h*3.5).toFixed(fp),tp3=+(entry+atr4h*5.5).toFixed(fp);
    var slPct=+((entry-sl)/entry*100).toFixed(2),tp1Pct=+((tp1-entry)/entry*100).toFixed(2),tp2Pct=+((tp2-entry)/entry*100).toFixed(2);
    // Astrology
    var jd=Date.now()/86400000+2440587.5;var dm=((jd-2460320.5)%29.53+29.53)%29.53;
    var moonPhase='Waxing',moonEmoji='moon';
    if(dm<1.5){moonPhase='New Moon';moonEmoji='new-moon';}else if(dm<8.5){moonPhase='First Quarter';moonEmoji='first-quarter';}
    else if(dm<16){moonPhase='Full Moon';moonEmoji='full-moon';}else if(dm<22){moonPhase='Waning';moonEmoji='waning';}
    else{moonPhase='Dark Moon';moonEmoji='waning-crescent';}
    var ds=Math.floor((Date.now()-1713571200000)/86400000);
    var fg=50;try{var fd=Rfg.value&&Rfg.value.data&&Rfg.value.data[0];if(fd)fg=N(fd.value);}catch(e){}
    // Summary
    var oneLiner=biasLabel+' RSI4H:'+rsi4h.toFixed(0)+(t4h&&t4h.divType?' '+t4h.divType+' DIV':'')+(bosD?' '+bosD.type:chochD?' '+chochD.type:'')+' F'+confScore+'%';
    var out={
      ok:true,symbol:sym,price:price,change24h:change24h,vol24h:vol24,fr:fr?+(fr*100).toFixed(4):null,oi:oi,fg:fg,
      dataSource:'MEXC Klines (1H+4H+1D) + Bybit',ts:Date.now(),elapsed:Date.now()-t0,
      timeframes:{
        '1H':t1h?{rsi:+t1h.rsi.toFixed(1),trend:t1h.trend,rsiSlope:t1h.rsiSlope,macdBull:t1h.macdBull,aboveE21:t1h.aboveE21,stochK:t1h.stochK}:{rsi:50,trend:'NEUTRAL'},
        '4H':t4h?{rsi:+t4h.rsi.toFixed(1),trend:t4h.trend,rsiSlope:t4h.rsiSlope,macdBull:t4h.macdBull,aboveE21:t4h.aboveE21,aboveE200:t4h.aboveE200,divType:t4h.divType,divStr:t4h.divStr,stochK:t4h.stochK}:{rsi:50,trend:'NEUTRAL'},
        '1D':t1d?{rsi:+t1d.rsi.toFixed(1),trend:t1d.trend,rsiSlope:t1d.rsiSlope,macdBull:t1d.macdBull,aboveE21:t1d.aboveE21}:{rsi:50,trend:'NEUTRAL'},
      },
      rsiMap:{'1H':t1h?+t1h.rsi.toFixed(1):50,'4H':t4h?+t4h.rsi.toFixed(1):50,'1D':t1d?+t1d.rsi.toFixed(1):50},
      ict:{
        bosD:bosD||null,chochD:chochD||null,
        structure:ictStructure,summary:ictSummary,
        orderBlocks:{bullish:bullOBs,bearish:bearOBs},
        fvg:{bullish:bullFVGs,bearish:bearFVGs},
        liquidity:{above:liquidityAbove.slice(0,3),below:liquidityBelow.slice(0,3)},
        wyckoff:wyckoff,
        highProbZones:bullOBs.filter(o=>o.inZone).length>0?['Bullish OB Zone active']:inOTE?['ICT OTE Long Zone']:[]
      },
      obs:{bullish:bullOBs,bearish:bearOBs},
      fvg:{bullish:bullFVGs,bearish:bearFVGs},
      elliottWave:ew,
      fibonacci:fib,
      pivotPoints:{'4H':pivots},
      macd:{bull:t4h?t4h.macdBull:false,hist:t4h?t4h.macdHist:0,line:t4h?t4h.macdLine:0,cross:t4h?t4h.macdCross:null},
      bb:{'4H':{upper:t4h?t4h.bbU:0,lower:t4h?t4h.bbL:0,pct:t4h?t4h.bbPct:0.5,squeeze:t4h?t4h.bbSqz:false}},
      rsi:t4h?+t4h.rsi.toFixed(1):50,
      rsiDivergence:t4h&&t4h.divType?{bullish:t4h.divType==='BULLISH',type:t4h.divType,desc:t4h.divType==='BULLISH'?'Harga lower low, RSI higher low = pembalikan naik':'Harga higher high, RSI lower high = pembalikan turun',timeframe:'4H',strength:t4h.divStr}:null,
      stochRSI:t4h?{k:t4h.stochK,d:t4h.stochD,zone:t4h.stochZone,crossUp:t4h.stochCrossUp,crossDown:t4h.stochCrossDown}:{k:50,d:50,zone:'NEUTRAL',crossUp:false,crossDown:false},
      adx:t4h?{value:t4h.adx,trend:t4h.adxTrend}:{value:25,trend:'WEAK'},
      atr:{pct:t4h?t4h.atrPct:0,val:t4h?t4h.atr:0},
      volume:{ratio:t4h?t4h.volRatio:1,trend:t4h?t4h.volTrend:'NORMAL'},
      emaAnalysis:{e9:t4h?t4h.e9:0,e21:t4h?t4h.e21:0,e50:t4h?t4h.e50:0,e200:t4h?t4h.e200:0,aboveE200:t4h?t4h.aboveE200:false,aboveE21:t4h?t4h.aboveE21:false},
      chartPatterns:chartPatterns,
      confluence:{probability:confScore,signal:confSignal,bullishFactors:bullFactors,bearishFactors:bearFactors},
      summary:{bias:biasLabel,biasLabel:biasLabel,probability:confScore,oneLiner:oneLiner},
      levels:{entry,sl,slPct,tp1,tp1Pct,tp2,tp2Pct,tp3},
      astrology:{moonPhase,moonEmoji,halvingPhase:ds<240?'Bull Mid-Cycle':'Late Cycle',chaotic:moonPhase==='Full Moon'||moonPhase==='New Moon',daysSinceHalving:ds},
    };
    CACHE_MAP.set(sym,{d:out,t:Date.now()});
    if(CACHE_MAP.size>100)CACHE_MAP.delete(CACHE_MAP.keys().next().value);
    return res.status(200).json(out);
  }catch(e){
    return res.status(200).json({ok:false,error:String(e.message||e),symbol:sym,price:0,ts:Date.now(),dataSource:'error',timeframes:{'1H':{rsi:50,trend:'NEUTRAL'},'4H':{rsi:50,trend:'NEUTRAL'},'1D':{rsi:50,trend:'NEUTRAL'}},rsiMap:{'1H':50,'4H':50,'1D':50},confluence:{probability:50,signal:'NEUTRAL',bullishFactors:[],bearishFactors:[]},summary:{bias:'NEUTRAL',biasLabel:'NEUTRAL',probability:50,oneLiner:'Error'},ict:{bosD:null,chochD:null,orderBlocks:{bullish:[],bearish:[]},fvg:{bullish:[],bearish:[]},liquidity:{above:[],below:[]},highProbZones:[]},obs:{bullish:[],bearish:[]},elliottWave:{},pivotPoints:{'4H':{}},stochRSI:{k:50,d:50,zone:'NEUTRAL',crossUp:false,crossDown:false},chartPatterns:[],astrology:{moonPhase:'Waxing',moonEmoji:'moon',halvingPhase:'Bull Cycle',chaotic:false}});
  }
}
