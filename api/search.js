// api/search.js - AC369 v8 COIN ANALYSIS ENGINE
// Full technical analysis: ICT/SMC, Multi-TF RSI, MACD, EMA, Fibonacci
// Pure ASCII, 0 non-ASCII, 0 backtick. NO HTTP 500.
const CACHE_MAP = new Map();
const N = function(v,d){d=d===undefined?0:d;var n=+v;return isNaN(n)||!isFinite(n)?d:n;};
const A = function(v){return Array.isArray(v)?v:[];};
const cl = function(v,a,b){return Math.max(a,Math.min(b,N(v)));};
const rsi14 = function(cls){
  try{if(!cls||cls.length<16)return 50;var g=0,l=0;for(var i=1;i<=14;i++){var d=cls[cls.length-i]-cls[cls.length-i-1];if(d>0)g+=d;else l-=d;}var ag=g/14,al=l/14;if(al===0)return 100;return+(100-100/(1+ag/al)).toFixed(1);}catch(e){return 50;}
};
const ema = function(cls,p){
  try{if(!cls||cls.length<2)return cls[cls.length-1]||0;var k=2/(p+1);return cls.reduce(function(prev,v,i){return i===0?v:prev*(1-k)+v*k;});}catch(e){return 0;}
};
const atr14 = function(K){
  try{if(!K||K.length<15)return 0;var tr=0;for(var i=K.length-14;i<K.length;i++){var ph=K[i-1].c;tr+=Math.max(K[i].h-K[i].l,Math.abs(K[i].h-ph),Math.abs(K[i].l-ph));}return tr/14;}catch(e){return 0;}
};
export default async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Cache-Control','s-maxage=180,stale-while-revalidate=60');
  if(req.method==='OPTIONS')return res.status(200).end();
  var t0=Date.now();
  var sym=((req.query&&req.query.symbol)||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,12);
  if(!sym)return res.status(200).json({ok:false,error:'Symbol required',price:0});
  var cacheKey=sym;
  if(CACHE_MAP.has(cacheKey)&&Date.now()-CACHE_MAP.get(cacheKey).t<180000){
    return res.status(200).json(Object.assign({},CACHE_MAP.get(cacheKey).d,{cached:true}));
  }
  var g=async function(url,ms){
    try{var ctrl=new AbortController();var tmr=setTimeout(function(){ctrl.abort();},ms||3000);var r=await fetch(url,{signal:ctrl.signal});clearTimeout(tmr);return r.ok?await r.json():null;}catch(e){return null;}
  };
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
    if(!price)return res.status(200).json({ok:false,error:sym+' tidak ditemukan',symbol:sym,price:0,dataSource:'not found'});
    // Process klines per timeframe
    var tf=function(rawKlines){
      try{
        var raw=A(rawKlines);if(raw.length<16)return null;
        var K=raw.map(function(d){return{o:N(d[1]),h:N(d[2]),l:N(d[3]),c:N(d[4]),v:N(d[5]),t:N(d[0])};});
        var cls=K.map(function(k){return k.c;}).filter(function(v){return v>0;});
        var rsi=N(rsi14(cls));
        var e9=ema(cls.slice(-9),9),e21=ema(cls.slice(-21),21),e50=ema(cls.slice(-50),50),e200=ema(cls,200);
        var atrV=atr14(K.slice(-15));
        var atrPct=price>0?+(atrV/price*100).toFixed(2):0;
        // MACD
        var k12=2/13,k26=2/27;var em12=cls[0],em26=cls[0];
        cls.forEach(function(v){em12=em12*(1-k12)+v*k12;em26=em26*(1-k26)+v*k26;});
        var macdLine=em12-em26,signalLine=macdLine*(2/10);
        var macdHist=+(macdLine-signalLine).toFixed(6);
        var macdBull=macdLine>signalLine;
        var macdCross=macdBull&&macdLine<0?'CROSS_UP':(!macdBull&&macdLine>0?'CROSS_DOWN':null);
        // RSI slope
        var rsiPrev=rsi14(cls.slice(0,-1));
        var rsiSlope=rsi>rsiPrev+0.5?'rising':rsi<rsiPrev-0.5?'falling':'flat';
        // RSI divergence
        var divType=null,divStr=0;
        try{var p4=cls[cls.length-5]||price,p8=cls[cls.length-9]||price;var r4=rsi14(cls.slice(0,-4)),r8=rsi14(cls.slice(0,-8));
          if(r4&&r8){if(price<p4&&p4<p8&&rsi>r4&&r4>r8){divType='BULLISH';divStr=Math.round((rsi-r4)*3+10);}
          else if(price>p4&&p4>p8&&rsi<r4&&r4<r8){divType='BEARISH';divStr=Math.round((r4-rsi)*3+10);}}}catch(e){}
        // Bollinger Bands
        var last20=cls.slice(-20);var mean=last20.reduce(function(s,v){return s+v;},0)/20;
        var std=Math.sqrt(last20.reduce(function(s,v){return s+Math.pow(v-mean,2);},0)/20);
        var bbUpper=+(mean+std*2).toFixed(price>1?2:8),bbLower=+(mean-std*2).toFixed(price>1?2:8);
        var bbPct=std>0?cl((price-bbLower)/(bbUpper-bbLower),0,1):0.5;
        var bbSqueeze=(std*4/mean)<0.05;
        // Volume analysis
        var avgVol=K.slice(-20).reduce(function(s,k){return s+k.v;},0)/20;
        var curVol=K[K.length-1].v;
        var volRatio=avgVol>0?+(curVol/avgVol).toFixed(2):1;
        var volTrend=volRatio>1.5?'HIGH':volRatio>1.1?'ABOVE_AVG':volRatio<0.6?'LOW':'NORMAL';
        // Stoch RSI (simple approximation)
        var rsiSeries=[];for(var i=14;i<cls.length;i++){rsiSeries.push(N(rsi14(cls.slice(0,i+1))));}
        var rsiMin=Math.min.apply(null,rsiSeries.slice(-14));var rsiMax=Math.max.apply(null,rsiSeries.slice(-14));
        var stochRsi=rsiMax>rsiMin?cl((rsi-rsiMin)/(rsiMax-rsiMin)*100,0,100):50;
        // ADX approximation (directional movement)
        var adx=50;try{var gains=0,losses=0;for(var i2=K.length-14;i2<K.length;i2++){var dm=K[i2].h-K[i2-1>0?i2-1:0].h;var dm2=K[i2-1>0?i2-1:0].l-K[i2].l;gains+=(dm>dm2&&dm>0?dm:0);losses+=(dm2>dm&&dm2>0?dm2:0);}adx=gains+losses>0?cl((Math.abs(gains-losses)/(gains+losses))*100,0,100):50;}catch(e){}
        // Determine trend
        var trend=rsi>55&&price>e21?'BULLISH':rsi<45&&price<e21?'BEARISH':'NEUTRAL';
        var aboveE200=price>e200;var aboveE21=price>e21;
        return{rsi,rsiSlope,divType,divStr,
          e9:+e9.toFixed(price>1?2:8),e21:+e21.toFixed(price>1?2:8),e50:+e50.toFixed(price>1?2:8),e200:+e200.toFixed(price>1?2:8),
          aboveE200,aboveE21,
          atr:+atrV.toFixed(price>1?4:8),atrPct,
          macdLine:+macdLine.toFixed(6),macdHist,macdBull,macdCross,
          bbUpper,bbLower,bbPct:+bbPct.toFixed(3),bbSqueeze,
          stochRsi:+stochRsi.toFixed(1),adx:+adx.toFixed(1),
          volRatio,volTrend,
          trend,K,cls};
      }catch(e){return null;}
    };
    var t1h=tf(A(R1h.value));
    var t4h=tf(A(R4h.value));
    var t1d=tf(A(R1d.value));
    // Use 4H as primary if available, fallback to 1H or 1D
    var primary=t4h||t1h||t1d;
    if(!primary)return res.status(200).json({ok:false,error:'Tidak cukup data klines untuk '+sym,symbol:sym,price:price,dataSource:'mexc-klines'});
    // ICT/SMC: BOS and CHoCH detection from 4H klines
    var bosD=null,chochD=null,obs=[],fvgs=[];
    try{
      var K4=primary.K;
      if(K4&&K4.length>=10){
        // Find swing highs and lows
        var swingHighs=[],swingLows=[];
        for(var i=2;i<K4.length-2;i++){
          if(K4[i].h>K4[i-1].h&&K4[i].h>K4[i-2].h&&K4[i].h>K4[i+1].h&&K4[i].h>K4[i+2].h){swingHighs.push({idx:i,level:K4[i].h,t:K4[i].t});}
          if(K4[i].l<K4[i-1].l&&K4[i].l<K4[i-2].l&&K4[i].l<K4[i+1].l&&K4[i].l<K4[i+2].l){swingLows.push({idx:i,level:K4[i].l,t:K4[i].t});}
        }
        // BOS: price breaks above last swing high or below last swing low
        var lastHigh=swingHighs.length>0?swingHighs[swingHighs.length-1]:null;
        var lastLow=swingLows.length>0?swingLows[swingLows.length-1]:null;
        var recentHigh=swingHighs.length>1?swingHighs[swingHighs.length-2]:null;
        var recentLow=swingLows.length>1?swingLows[swingLows.length-2]:null;
        if(lastHigh&&price>lastHigh.level*0.999){bosD={type:'BOS Bullish',level:+lastHigh.level.toFixed(price>1?2:8),color:'var(--g)'};}
        else if(lastLow&&price<lastLow.level*1.001){bosD={type:'BOS Bearish',level:+lastLow.level.toFixed(price>1?2:8),color:'var(--red)'};}
        // CHoCH: lower high after uptrend, or higher low after downtrend
        if(!bosD&&recentHigh&&lastHigh&&lastHigh.level<recentHigh.level&&price<lastHigh.level){
          chochD={type:'CHoCH Bearish - Trend Reversal',level:+lastHigh.level.toFixed(price>1?2:8)};}
        else if(!bosD&&recentLow&&lastLow&&lastLow.level>recentLow.level&&price>lastLow.level){
          chochD={type:'CHoCH Bullish - Trend Reversal',level:+lastLow.level.toFixed(price>1?2:8)};}
        // Order Blocks: find last bearish candle before bullish move and vice versa
        for(var i=K4.length-8;i<K4.length-1;i++){
          var candle=K4[i],nextC=K4[i+1];
          // Bullish OB: bearish candle before bullish move (price came from below)
          if(candle.c<candle.o&&nextC.c>candle.h*0.995){
            obs.push({type:'Bullish OB',top:+candle.o.toFixed(price>1?2:8),bottom:+candle.c.toFixed(price>1?2:8),strength:'HIGH'});
            if(obs.length>=2)break;
          }
          // Bearish OB: bullish candle before bearish move
          if(candle.c>candle.o&&nextC.c<candle.l*1.005){
            obs.push({type:'Bearish OB',top:+candle.c.toFixed(price>1?2:8),bottom:+candle.o.toFixed(price>1?2:8),strength:'HIGH'});
            if(obs.length>=2)break;
          }
        }
        // Fair Value Gaps (FVG): gap between candle[i-1].high and candle[i+1].low (or vice versa)
        for(var i=K4.length-8;i<K4.length-1&&fvgs.length<3;i++){
          if(i>0&&i<K4.length-1){
            var gap=K4[i+1].l-K4[i-1].h;
            if(gap>0&&gap/price>0.002){fvgs.push({type:'Bullish FVG',top:+K4[i+1].l.toFixed(price>1?2:8),bottom:+K4[i-1].h.toFixed(price>1?2:8),filled:price>K4[i-1].h});}
            var gap2=K4[i-1].l-K4[i+1].h;
            if(gap2>0&&gap2/price>0.002){fvgs.push({type:'Bearish FVG',top:+K4[i-1].l.toFixed(price>1?2:8),bottom:+K4[i+1].h.toFixed(price>1?2:8),filled:price<K4[i-1].l});}
          }
        }
      }
    }catch(e){}
    // Fibonacci levels from 4H recent swing
    var fib={};
    try{
      var K4f=primary.K;var hh=K4f.reduce(function(a,k){return k.h>a?k.h:a;},0);var ll=K4f.reduce(function(a,k){return k.l<a?k.l:a;},9e99);
      var diff=hh-ll;
      fib={high:+hh.toFixed(price>1?2:8),low:+ll.toFixed(price>1?2:8),f236:+(hh-diff*0.236).toFixed(price>1?2:8),f382:+(hh-diff*0.382).toFixed(price>1?2:8),f500:+(hh-diff*0.5).toFixed(price>1?2:8),f618:+(hh-diff*0.618).toFixed(price>1?2:8),f786:+(hh-diff*0.786).toFixed(price>1?2:8)};
    }catch(e){}
    // Pivot Points (Classic)
    var pivots={};
    try{
      var K4p=primary.K;var prev=K4p[K4p.length-2]||K4p[K4p.length-1];
      var pp=(prev.h+prev.l+prev.c)/3;
      pivots={pp:+pp.toFixed(price>1?2:8),r1:+(2*pp-prev.l).toFixed(price>1?2:8),r2:+(pp+(prev.h-prev.l)).toFixed(price>1?2:8),r3:+(prev.h+2*(pp-prev.l)).toFixed(price>1?2:8),s1:+(2*pp-prev.h).toFixed(price>1?2:8),s2:+(pp-(prev.h-prev.l)).toFixed(price>1?2:8),s3:+(prev.l-2*(prev.h-pp)).toFixed(price>1?2:8)};
    }catch(e){}
    // Elliott Wave (simplified detection)
    var ew={};
    try{
      var K4e=primary.K;var rsi4=t4h?t4h.rsi:50;var tr=t4h?t4h.trend:'NEUTRAL';
      var recentSlope=K4e.length>=5?(K4e[K4e.length-1].c-K4e[K4e.length-5].c)/K4e[K4e.length-5].c*100:0;
      var emaSlope=t4h&&t4h.e9&&t4h.e21?(t4h.e9-t4h.e21)/t4h.e21*100:0;
      var wave,waveDesc,waveConf,waveColor;
      if(rsi4<30&&recentSlope<-5){wave=5;waveDesc='Wave 5 bottom - reversal zone';waveConf=72;waveColor='var(--g)';}
      else if(rsi4<35&&recentSlope<0&&price<(t4h?t4h.e21:price)*0.98){wave=4;waveDesc='Wave 4 correction';waveConf=60;waveColor='var(--amber)';}
      else if(rsi4>65&&recentSlope>3&&price>(t4h?t4h.e21:price)*1.01){wave=3;waveDesc='Wave 3 extension (strongest)';waveConf=65;waveColor='var(--g)';}
      else if(rsi4>55&&recentSlope>0&&emaSlope>0){wave=1;waveDesc='Wave 1 initiation - early bull';waveConf=55;waveColor='var(--g)';}
      else if(rsi4<50&&recentSlope<0&&price>(t4h?t4h.e200:price)*0.97){wave=2;waveDesc='Wave 2 pullback - buy zone';waveConf=58;waveColor='var(--amber)';}
      else{wave=0;waveDesc='Consolidation - no clear wave';waveConf=30;waveColor='var(--dim)';}
      ew={'4H':{wave:wave,w:wave>0?'Wave '+wave:'',c:waveColor,d:waveDesc,confidence:waveConf,description:waveDesc}};
    }catch(e){}
    // Confluence scoring
    var confScore=50,bullishFactors=[],bearishFactors=[];
    var rsi4h=t4h?t4h.rsi:50;
    if(rsi4h<30){confScore+=20;bullishFactors.push('RSI 4H oversold ('+rsi4h.toFixed(0)+')');}
    else if(rsi4h<40){confScore+=12;bullishFactors.push('RSI 4H bearish zone ('+rsi4h.toFixed(0)+')');}
    else if(rsi4h>70){confScore-=20;bearishFactors.push('RSI 4H overbought ('+rsi4h.toFixed(0)+')');}
    if(t4h&&t4h.divType==='BULLISH'){confScore+=15;bullishFactors.push('Bullish divergence 4H');}
    else if(t4h&&t4h.divType==='BEARISH'){confScore-=15;bearishFactors.push('Bearish divergence 4H');}
    if(t4h&&t4h.macdBull&&t4h.macdLine<0){confScore+=10;bullishFactors.push('MACD bullish cross');}
    if(bosD&&bosD.type.includes('Bullish')){confScore+=12;bullishFactors.push('BOS Bullish confirmed');}
    else if(bosD&&bosD.type.includes('Bearish')){confScore-=12;bearishFactors.push('BOS Bearish confirmed');}
    if(fr<-0.0003){confScore+=10;bullishFactors.push('FR negatif ('+( fr*100).toFixed(3)+'%) shorts bayar');}
    if(t4h&&t4h.aboveE200){confScore+=8;bullishFactors.push('Di atas 200 EMA 4H');}else if(t4h){confScore-=8;bearishFactors.push('Di bawah 200 EMA 4H');}
    if(t1h&&t1h.rsi<40&&rsi4h<45){confScore+=8;bullishFactors.push('MTF: 1H+4H keduanya oversold');}
    if(t1d&&t1d.rsi>50&&rsi4h<45){confScore+=6;bullishFactors.push('1D bullish, 4H pullback = buy dip');}
    confScore=Math.max(5,Math.min(95,Math.round(confScore)));
    var confSignal=confScore>=75?'STRONG BUY':confScore>=60?'BUY':confScore>=50?'MILD BUY':confScore<=30?'STRONG SELL':confScore<=40?'SELL':'NEUTRAL';
    // Overall bias
    var biasScore=0;
    if(rsi4h<35)biasScore+=3;else if(rsi4h<45)biasScore+=1;else if(rsi4h>65)biasScore-=3;else if(rsi4h>55)biasScore-=1;
    if(t4h&&t4h.macdBull)biasScore+=1;else if(t4h&&!t4h.macdBull)biasScore-=1;
    if(t4h&&t4h.aboveE200)biasScore+=1;else if(t4h)biasScore-=1;
    if(t4h&&t4h.divType==='BULLISH')biasScore+=2;else if(t4h&&t4h.divType==='BEARISH')biasScore-=2;
    if(bosD&&bosD.type.includes('Bullish'))biasScore+=2;else if(bosD&&bosD.type.includes('Bearish'))biasScore-=2;
    var biasLabel=biasScore>=4?'STRONG BULLISH':biasScore>=2?'BULLISH':biasScore===1?'MILD BULLISH':biasScore===-1?'MILD BEARISH':biasScore<=-2?'BEARISH':'NEUTRAL';
    var biasColor=biasLabel.includes('BULL')?'var(--g)':biasLabel.includes('BEAR')?'var(--red)':'var(--amber)';
    // RSI map for display
    var rsiMap={'1H':t1h?+t1h.rsi.toFixed(1):50,'4H':t4h?+t4h.rsi.toFixed(1):50,'1D':t1d?+t1d.rsi.toFixed(1):50};
    // Astrology
    var jd=Date.now()/86400000+2440587.5;var dm=((jd-2460320.5)%29.53+29.53)%29.53;
    var moonPhase='Waxing',moonEmoji='moon';
    if(dm<1.5){moonPhase='New Moon';moonEmoji='new-moon';}else if(dm<8.5){moonPhase='First Quarter';moonEmoji='first-quarter';}
    else if(dm<16){moonPhase='Full Moon';moonEmoji='full-moon';}else if(dm<22){moonPhase='Waning';moonEmoji='waning';}
    else{moonPhase='Dark Moon';moonEmoji='waning-crescent';}
    var ds=Math.floor((Date.now()-1713571200000)/86400000);
    var chaotic=moonPhase==='Full Moon'||moonPhase==='New Moon';
    // SL/TP levels based on ATR
    var atr4h=t4h?t4h.atr:price*0.02;
    var entry=price;
    var sl=+(entry-atr4h*1.5).toFixed(price>1?2:8),tp1=+(entry+atr4h*2).toFixed(price>1?2:8),tp2=+(entry+atr4h*3.5).toFixed(price>1?2:8),tp3=+(entry+atr4h*6).toFixed(price>1?2:8);
    var slPct=+((entry-sl)/entry*100).toFixed(2),tp1Pct=+((tp1-entry)/entry*100).toFixed(2),tp2Pct=+((tp2-entry)/entry*100).toFixed(2);
    var oneLiner=biasLabel+' RSI4H:'+rsiMap['4H']+(t4h&&t4h.divType?' '+t4h.divType+' DIV':'')+(bosD?' '+bosD.type:'')+' F'+Math.round(confScore)+'%';
    var out={
      ok:true,symbol:sym,price:price,change24h:change24h,vol24h:vol24,fr:fr?+(fr*100).toFixed(4):null,oi:oi,
      dataSource:'MEXC Klines (1H+4H+1D) + Bybit',ts:Date.now(),elapsed:Date.now()-t0,
      timeframes:{
        '1H':t1h?{rsi:rsiMap['1H'],trend:t1h.trend,rsiSlope:t1h.rsiSlope,macdBull:t1h.macdBull,aboveE21:t1h.aboveE21}:{rsi:50,trend:'NEUTRAL'},
        '4H':t4h?{rsi:rsiMap['4H'],trend:t4h.trend,rsiSlope:t4h.rsiSlope,macdBull:t4h.macdBull,aboveE21:t4h.aboveE21,aboveE200:t4h.aboveE200,divType:t4h.divType,divStr:t4h.divStr}:{rsi:50,trend:'NEUTRAL'},
        '1D':t1d?{rsi:rsiMap['1D'],trend:t1d.trend,rsiSlope:t1d.rsiSlope,macdBull:t1d.macdBull,aboveE21:t1d.aboveE21}:{rsi:50,trend:'NEUTRAL'},
      },
      rsiMap:rsiMap,
      ict:{bosD:bosD||null,chochD:chochD||null,obs:obs,fvgs:fvgs},
      elliottWave:ew,
      fibonacci:fib,
      pivotPoints:{'4H':pivots},
      macd:{bull:t4h?t4h.macdBull:false,hist:t4h?t4h.macdHist:0,line:t4h?t4h.macdLine:0,cross:t4h?t4h.macdCross:null},
      bb:{'4H':{upper:t4h?t4h.bbUpper:0,lower:t4h?t4h.bbLower:0,pct:t4h?t4h.bbPct:0.5,squeeze:t4h?t4h.bbSqueeze:false}},
      rsi:rsiMap['4H'],
      rsiDivergence:t4h&&t4h.divType?{type:t4h.divType,strength:t4h.divStr,timeframe:'4H'}:null,
      stochRSI:t4h?t4h.stochRsi:50,
      adx:t4h?t4h.adx:50,
      atr:{pct:t4h?t4h.atrPct:0,val:t4h?t4h.atr:0},
      volume:{ratio:t4h?t4h.volRatio:1,trend:t4h?t4h.volTrend:'NORMAL'},
      emaAnalysis:{e9:t4h?t4h.e9:0,e21:t4h?t4h.e21:0,e50:t4h?t4h.e50:0,e200:t4h?t4h.e200:0,aboveE200:t4h?t4h.aboveE200:false,aboveE21:t4h?t4h.aboveE21:false},
      chartPatterns:[],
      confluence:{probability:confScore,signal:confSignal,bullishFactors:bullishFactors,bearishFactors:bearishFactors},
      summary:{bias:biasLabel,biasLabel:biasLabel,biasColor:biasColor,probability:confScore,oneLiner:oneLiner},
      levels:{entry:entry,sl:sl,slPct:slPct,tp1:tp1,tp1Pct:tp1Pct,tp2:tp2,tp2Pct:tp2Pct,tp3:tp3},
      astrology:{moonPhase:moonPhase,moonEmoji:moonEmoji,halvingPhase:ds<240?'Bull Mid-Cycle':'Late Cycle',chaotic:chaotic,daysSinceHalving:ds},
    };
    CACHE_MAP.set(cacheKey,{d:out,t:Date.now()});
    if(CACHE_MAP.size>100){var first=CACHE_MAP.keys().next().value;CACHE_MAP.delete(first);}
    return res.status(200).json(out);
  }catch(e){
    return res.status(200).json({ok:false,error:String(e.message||e),symbol:sym,price:0,ts:Date.now(),dataSource:'error',timeframes:{'1H':{rsi:50},'4H':{rsi:50},'1D':{rsi:50}},rsiMap:{'1H':50,'4H':50,'1D':50},confluence:{probability:50,signal:'NEUTRAL'},summary:{bias:'NEUTRAL',biasLabel:'NEUTRAL',probability:50,oneLiner:'Error saat analisis'},ict:{bosD:null,chochD:null,obs:[],fvgs:[]},elliottWave:{},pivotPoints:{'4H':{}},astrology:{moonPhase:'Waxing',moonEmoji:'moon',halvingPhase:'Bull Cycle',chaotic:false}});
  }
}
