// api/analysis.js - AC369 v1 AI SMART ANALYSIS
// SMC High Prob + Elliott Wave + Chart Pattern + Candle Confirm
// Pure ASCII, 0 non-ASCII, 0 backtick. No HTTP 500.
const CACHE_MAP=new Map();
const N=(v,d=0)=>{var n=+v;return isNaN(n)||!isFinite(n)?d:n;};
const A=(v)=>Array.isArray(v)?v:[];

export default async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Cache-Control','s-maxage=300,stale-while-revalidate=120');
  if(req.method==='OPTIONS')return res.status(200).end();
  var t0=Date.now();
  var sym=((req.query&&req.query.symbol)||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,12);
  if(!sym)return res.status(200).json({ok:false,error:'Symbol required'});
  if(CACHE_MAP.has(sym)&&Date.now()-CACHE_MAP.get(sym).t<300000){
    return res.status(200).json(Object.assign({},CACHE_MAP.get(sym).d,{cached:true}));
  }
  try{
    // Fetch technical data from search endpoint
    var searchUrl='https://'+req.headers.host+'/api/search?symbol='+sym;
    var searchResp=await fetch(searchUrl,{signal:AbortSignal.timeout?AbortSignal.timeout(5000):undefined}).then(r=>r.json()).catch(()=>null);
    var d=searchResp&&searchResp.price>0?searchResp:null;
    if(!d)return res.status(200).json({ok:false,error:'Data tidak tersedia untuk '+sym,symbol:sym});
    var price=d.price,change24h=d.change24h||0;
    var rsi4h=d.rsiMap&&d.rsiMap['4H']?d.rsiMap['4H']:50;
    var rsi1h=d.rsiMap&&d.rsiMap['1H']?d.rsiMap['1H']:50;
    var rsi1d=d.rsiMap&&d.rsiMap['1D']?d.rsiMap['1D']:50;
    var tf4h=d.timeframes&&d.timeframes['4H']?d.timeframes['4H']:{rsi:50,trend:'NEUTRAL'};
    var conf=d.confluence||{probability:50,signal:'NEUTRAL',bullishFactors:[],bearishFactors:[]};
    var ict=d.ict||{};
    var bosD=ict.bosD||null;
    var chochD=ict.chochD||null;
    var obs=ict.orderBlocks||{bullish:[],bearish:[]};
    var fvgs=ict.fvg||{bullish:[],bearish:[]};
    var ew=d.elliottWave&&d.elliottWave['4H']?d.elliottWave['4H']:{wave:0,confidence:30,d:'No clear wave'};
    var fib=d.fibonacci||{};
    var piv=d.pivotPoints&&d.pivotPoints['4H']?d.pivotPoints['4H']:{};
    var macd=d.macd||{bull:false};
    var divR=d.rsiDivergence||null;
    var stoch=d.stochRSI||{k:50,d:50,zone:'NEUTRAL'};
    var adx=d.adx||{value:25,trend:'WEAK'};
    var atrPct=d.atr&&d.atr.pct?d.atr.pct:2.5;
    var vol=d.volume||{ratio:1,trend:'NORMAL'};
    var pats=A(d.chartPatterns);
    var wyckoff=ict.wyckoff||'';
    var fr=d.fr||0;
    var fp2=price>1?2:price>0.01?4:price>0.0001?6:8;
    // Determine overall market direction
    var bullishCount=0,bearishCount=0;
    if(rsi4h<38)bullishCount+=2;else if(rsi4h>68)bearishCount+=2;
    if(macd.bull)bullishCount++;else bearishCount++;
    if(bosD&&bosD.type.includes('Bullish'))bullishCount+=2;else if(bosD&&bosD.type.includes('Bearish'))bearishCount+=2;
    if(chochD&&chochD.type.includes('Bullish'))bullishCount++;else if(chochD&&chochD.type.includes('Bearish'))bearishCount++;
    if(divR&&divR.bullish)bullishCount+=2;else if(divR&&!divR.bullish&&divR.type)bearishCount+=2;
    if(fr<-0.0003)bullishCount++;else if(fr>0.0005)bearishCount++;
    if(stoch.zone==='OVERSOLD'&&stoch.crossUp)bullishCount+=2;
    if(stoch.zone==='OVERBOUGHT'&&stoch.crossDown)bearishCount+=2;
    if(obs.bullish&&obs.bullish.length&&obs.bullish[0].inZone)bullishCount+=2;
    if(tf4h.aboveE200)bullishCount++;else if(!tf4h.aboveE200)bearishCount++;
    var netBias=bullishCount-bearishCount;
    var mainBias=netBias>=4?'STRONG BULLISH':netBias>=2?'BULLISH':netBias>=1?'MILD BULLISH':netBias<=-4?'STRONG BEARISH':netBias<=-2?'BEARISH':netBias<=-1?'MILD BEARISH':'NEUTRAL';
    var isBullish=netBias>0;
    // SMC HIGH PROBABILITY SETUP IDENTIFICATION
    var smcSetup=null;
    // Setup 1: OB + BOS confluence (highest probability)
    if(bosD&&bosD.type.includes('Bullish')&&obs.bullish&&obs.bullish.length&&obs.bullish[0].dist<5){
      smcSetup={name:'OB + BOS CONFLUENCE',bias:'BULLISH',probability:85,
        description:'BOS Bullish confirmed di $'+bosD.level.toFixed(fp2)+' dengan Bullish Order Block di $'+obs.bullish[0].L+'-$'+obs.bullish[0].H+'. Harga dalam zona OB = setup highest probability.',
        confirmation:'Tunggu close 4H di atas $'+bosD.level.toFixed(fp2)+' dengan volume naik',
        entryZone:obs.bullish[0].L+'-'+obs.bullish[0].H};
    }
    // Setup 2: CHoCH + Oversold RSI (trend reversal)
    else if(chochD&&chochD.type.includes('Bullish')&&rsi4h<40){
      smcSetup={name:'CHoCH BULLISH REVERSAL',bias:'BULLISH',probability:78,
        description:'Market structure berubah ke bullish (CHoCH di $'+chochD.level.toFixed(fp2)+') dengan RSI 4H '+rsi4h.toFixed(0)+' oversold. Ini tanda awal akumulasi institusional.',
        confirmation:'Tunggu higher low formation dan volume spike',
        entryZone:'$'+(price*0.985).toFixed(fp2)+' - $'+price.toFixed(fp2)};
    }
    // Setup 3: FVG Fill (price returning to fill imbalance)
    else if(fvgs.bullish&&fvgs.bullish.length&&fvgs.bullish[0].fresh){
      var fvg0=fvgs.bullish[0];
      smcSetup={name:'BULLISH FVG FILL SETUP',bias:'BULLISH',probability:74,
        description:'Bullish Fair Value Gap di $'+fvg0.bottom+'-$'+fvg0.top+' belum terisi. Price action cenderung kembali mengisi gap sebelum lanjut naik.',
        confirmation:'Masuk saat harga menyentuh zona FVG dengan candle bullish',
        entryZone:'$'+fvg0.bottom+' - $'+fvg0.top};
    }
    // Setup 4: Bearish setups
    else if(bosD&&bosD.type.includes('Bearish')&&obs.bearish&&obs.bearish.length){
      smcSetup={name:'BEARISH OB + BOS',bias:'BEARISH',probability:82,
        description:'BOS Bearish di $'+bosD.level.toFixed(fp2)+' dengan Bearish Order Block. Market structure rusak ke bawah. Short setup valid.',
        confirmation:'Tunggu retest ke Bearish OB zone lalu entry SHORT',
        entryZone:'$'+obs.bearish[0].L+' - $'+obs.bearish[0].H};
    }
    // Setup 5: Default based on bias
    else{
      var defBias=isBullish?'BULLISH':'BEARISH';
      smcSetup={name:isBullish?'ACCUMULATION SETUP':'DISTRIBUTION SETUP',bias:defBias,probability:60,
        description:isBullish?'Market showing '+netBias+' bullish signals. Struktur mendukung. Namun belum ada konfluens kuat dari OB/BOS.':'Market showing '+(Math.abs(netBias))+' bearish signals. Caution.',
        confirmation:isBullish?'Tunggu RSI 1H naik dari <45 dengan volume spike':'Jangan long sampai struktur membaik',
        entryZone:'$'+(price*0.99).toFixed(fp2)+' - $'+price.toFixed(fp2)};
    }
    // ELLIOTT WAVE TRADE PLAN
    var elliottPlan='';
    var ewN=ew.wave||0;
    if(ewN===1)elliottPlan='Wave 1 sedang berlangsung. Ini early bull signal - entry aggressive di pullback Wave 2 (biasanya 38.2-61.8% fib dari Wave 1). Target Wave 3 = 1.618x Wave 1.';
    else if(ewN===2)elliottPlan='Wave 2 Pullback = ZONA BELI TERBAIK. Idealnya entry di 61.8% retracement (Golden Ratio) = $'+(fib.f618||price).toFixed(fp2)+'. Wave 3 biasanya move terbesar, target 1.618x Wave 1.';
    else if(ewN===3)elliottPlan='Wave 3 Extension aktif = trend terkuat! Jangan counter-trend. Ride the wave dengan trailing SL. Target Wave 5 extension.';
    else if(ewN===4)elliottPlan='Wave 4 Correction. Jangan panic sell - ini peluang beli Wave 5 terakhir. Entry ideal di 38.2% retracement = $'+(fib.f382||price).toFixed(fp2)+'.';
    else if(ewN===5)elliottPlan='Wave 5 FINAL. Hati-hati - ini akhir impulse wave. Kemungkinan reversal besar setelah Wave 5. Consider taking profits dan siapkan reverse trade.';
    else elliottPlan='Belum ada wave count jelas. Tunggu market structure lebih jelas sebelum entry. Range $'+(fib.f618||price*0.93).toFixed(fp2)+'-$'+(fib.f236||price*1.07).toFixed(fp2)+'.';
    // CANDLE CONFIRMATION required
    var candleConfirm='';
    var bestPat=pats.length>0?pats[0]:null;
    if(bestPat&&bestPat.signal==='LONG')candleConfirm='Konfirmasi entry: '+bestPat.name+' terdeteksi ('+bestPat.winRate+'% win rate). '+bestPat.desc+'. Entry setelah close candle ini.';
    else if(isBullish&&stoch.crossUp)candleConfirm='Stoch RSI cross UP dari oversold zone = konfirmasi momentum bullish. Entry saat Stoch K > D.';
    else if(isBullish&&macd.cross==='CROSS_UP')candleConfirm='MACD Cross UP terdeteksi = konfirmasi trend bullish. Volume harus naik minimal 1.5x average.';
    else if(isBullish)candleConfirm='Tunggu candle 4H bullish close (close > open) di atas zona entry dengan volume di atas rata-rata. Pin bar atau engulfing = konfirmasi terkuat.';
    else candleConfirm='Market belum konfirmasi arah. Tunggu close 4H yang jelas sebelum entry.';
    // TRADE PLAN dengan logika entry/SL/TP
    var atrVal=price*atrPct/100;
    var tp=null;
    if(isBullish){
      var entryP=price;
      var slP=+(entryP-Math.max(atrVal*1.5,entryP*0.025)).toFixed(fp2);
      var tp1P=+(entryP+atrVal*2).toFixed(fp2);
      var tp2P=+(entryP+atrVal*3.5).toFixed(fp2);
      var tp3P=+(entryP+atrVal*5.5).toFixed(fp2);
      var slPct=+((entryP-slP)/entryP*100).toFixed(2);
      var tp2Pct=+((tp2P-entryP)/entryP*100).toFixed(2);
      var rr=+(tp2Pct/slPct).toFixed(1);
      // Invalidation level
      var invLevel=slP;
      if(obs.bullish&&obs.bullish.length&&obs.bullish[0].L<entryP)invLevel=+obs.bullish[0].L;
      if(chochD&&chochD.level<entryP)invLevel=+chochD.level;
      var invalidation='Close 4H di bawah $'+invLevel.toFixed(fp2)+' = setup dibatalkan';
      tp={entry:entryP,sl:slP,slPct,tp1:tp1P,tp2:tp2P,tp3:tp3P,tp2Pct,rr,probability:conf.probability||60,invalidation,confirmation:candleConfirm.substring(0,80)};
    }else{
      var entryS=price;
      var slS=+(entryS+Math.max(atrVal*1.5,entryS*0.025)).toFixed(fp2);
      var tp2S=+(entryS-atrVal*3.5).toFixed(fp2);
      var slPctS=+((slS-entryS)/entryS*100).toFixed(2);
      var tp2PctS=+((entryS-tp2S)/entryS*100).toFixed(2);
      tp={entry:entryS,sl:slS,slPct:slPctS,tp1:+(entryS-atrVal*2).toFixed(fp2),tp2:tp2S,tp3:+(entryS-atrVal*5.5).toFixed(fp2),tp2Pct:tp2PctS,rr:+(tp2PctS/slPctS).toFixed(1),probability:conf.probability||50,invalidation:'Close 4H di atas $'+slS.toFixed(fp2)+' = short dibatalkan',confirmation:'Tunggu rejection candle di resistance zone'};
    }
    // HIGH PROBABILITY CONDITIONS (checklist)
    var highProbConditions=[];
    var avoidConditions=[];
    if(rsi4h<35)highProbConditions.push('RSI 4H '+rsi4h.toFixed(0)+' oversold (high reversal prob)');
    if(rsi1h<38&&rsi4h<45)highProbConditions.push('MTF 1H+4H keduanya oversold (institutional buy zone)');
    if(divR&&divR.bullish)highProbConditions.push('Bullish Divergence 4H (hidden strength signal)');
    if(bosD&&bosD.type.includes('Bullish'))highProbConditions.push('BOS Bullish confirmed - trend shift ke atas');
    if(obs.bullish&&obs.bullish.length&&obs.bullish[0].inZone)highProbConditions.push('Harga di dalam Bullish OB zone - whale demand area');
    if(fr<-0.0003)highProbConditions.push('FR '+( fr*100).toFixed(3)+'% shorts bayar - squeeze potential');
    if(stoch.crossUp&&stoch.zone==='OVERSOLD')highProbConditions.push('Stoch RSI cross UP dari oversold - momentum shift');
    if(macd.cross==='CROSS_UP')highProbConditions.push('MACD cross up - trend confirmation');
    if(adx.value>30&&isBullish)highProbConditions.push('ADX '+adx.value.toFixed(0)+' trending kuat ('+adx.trend+')');
    if(wyckoff.includes('Accumulation'))highProbConditions.push('Wyckoff: '+wyckoff.substring(0,50));
    if(vol.trend==='HIGH'||vol.trend==='SURGE')highProbConditions.push('Volume '+vol.trend+' ('+vol.ratio+'x avg) - institusi aktif');
    // Avoid conditions
    if(rsi4h>72)avoidConditions.push('RSI 4H '+rsi4h.toFixed(0)+' overbought - jangan beli di puncak');
    if(bosD&&bosD.type.includes('Bearish'))avoidConditions.push('BOS Bearish - trend structure rusak');
    if(!tf4h.aboveE200)avoidConditions.push('Di bawah 200 EMA 4H - bearish territory');
    if(fr>0.0005)avoidConditions.push('FR tinggi - longs membayar mahal, reversal risk');
    if(macd.cross==='CROSS_DOWN')avoidConditions.push('MACD cross down - momentum melemah');
    if(stoch.crossDown&&stoch.zone==='OVERBOUGHT')avoidConditions.push('Stoch RSI cross down dari overbought');
    // Main narrative generation
    var confBars=A(conf.bullishFactors).slice(0,4);
    var narrative=mainBias+'. '+sym+' pada $'+price.toFixed(fp2)+' ('+( change24h>=0?'+':'')+change24h.toFixed(2)+'%). ';
    if(smcSetup)narrative+=smcSetup.description+' ';
    if(confBars.length>0)narrative+='Faktor utama: '+confBars.join(', ')+'. ';
    if(highProbConditions.length>0)narrative+=highProbConditions.length+' kondisi high probability terpenuhi.';
    if(avoidConditions.length>0&&!isBullish)narrative+=' Hindari entry sebelum '+avoidConditions[0].toLowerCase()+'.';
    var out={
      ok:true,symbol:sym,price:price,ts:Date.now(),elapsed:Date.now()-t0,
      mainBias,netBias,isBullish,
      narrative,
      smcSetup,
      elliottPlan,
      candleConfirm,
      tradePlan:tp,
      highProbConditions:highProbConditions.slice(0,6),
      avoidConditions:avoidConditions.slice(0,4),
      wyckoff:wyckoff||null,
      summaryScore:{
        smcScore:smcSetup?smcSetup.probability:50,
        ewScore:ew.confidence||30,
        patternScore:bestPat?bestPat.winRate:50,
        confluenceScore:conf.probability||50,
        overallScore:Math.round(((smcSetup?smcSetup.probability:50)+(ew.confidence||30)+(bestPat?bestPat.winRate:50)+(conf.probability||50))/4)
      }
    };
    CACHE_MAP.set(sym,{d:out,t:Date.now()});
    if(CACHE_MAP.size>100)CACHE_MAP.delete(CACHE_MAP.keys().next().value);
    return res.status(200).json(out);
  }catch(e){
    return res.status(200).json({ok:false,error:String(e.message||e),symbol:sym,narrative:'Analisis tidak tersedia saat ini. Coba lagi dalam beberapa detik.',smcSetup:null,elliottPlan:'',tradePlan:null,highProbConditions:[],avoidConditions:[],ts:Date.now()});
  }
}
