// api/accumulation.js — AC369 FUSION v12.0
// UPGRADE v11→v12: Halving Cycle, Moon Phase, 7-Layer PI,
// ELITE auto-execute, ATH golden zone, adaptive position sizing
const TRADE_STORE   = new Map();
const SETUP_LOCK    = new Map();
const SETUP_TS      = new Map();
const DECISION_HIST = new Map();
const STATS_STORE   = { wins: 0, losses: 0 };
const MAX_MAJOR = 3, MAX_MEME = 2, MAX_WATCHLIST = 10;
const MAJORS = new Set(['BTC','ETH','BNB','SOL','XRP','ADA','AVAX','DOT','LINK','MATIC','ATOM','NEAR','UNI','LTC','BCH','TRX','FIL','ALGO','VET','HBAR','ICP','FTM','SAND','MANA','AXS','THETA','EOS','ZEC','DASH','XLM','APT','ARB','OP','SUI','SEI','TIA','INJ','KAVA','ROSE','ONE']);
const MEMES  = new Set(['DOGE','SHIB','PEPE','BONK','WIF','FLOKI','BRETT','MOG','SPX','POPCAT','MEW','BOME','SLERF','MYRO','PONKE','TURBO','NEIRO','PNUT','GOAT','ACT','MOODENG','LUNC','PEOPLE','BANANA','GIGA','CHEEMS','WOJAK','BOBO','TOSHI','BABYDOGE','ELON','SAMO']);
function classifyAsset(sym,mcap,vol){if(MAJORS.has(sym))return'MAJOR';if(MEMES.has(sym))return'MEME';if(mcap>0&&mcap<100e6&&vol/Math.max(mcap,1)>0.5)return'MEME';if(mcap>0&&mcap<200e6)return'MID';return'ALT';}
const TG_TOKEN=(typeof process!=='undefined'&&process.env?.TG_BOT_TOKEN)||'';
const TG_CHAT=(typeof process!=='undefined'&&process.env?.TG_CHAT_ID)||'';
async function tg(msg){if(!TG_TOKEN||!TG_CHAT)return;try{await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:TG_CHAT,text:msg,parse_mode:'HTML'})});}catch(_){}}

export default async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if(req.method==='OPTIONS')return res.status(200).end();

  if(req.method==='POST'){
    try{
      const body=req.body||{};
      if(body.action==='syncWatchlist'){
        let r=0;
        for(const w of(body.watchlist||[])){if(w.symbol&&!SETUP_LOCK.has(w.symbol)&&!['COMPLETED','INVALID'].includes(w.status)){SETUP_LOCK.set(w.symbol,w);r++;}}
        return res.status(200).json({ok:true,restored:r,total:SETUP_LOCK.size});
      }
      for(const t of(body.trades||[])){if(t.symbol&&!TRADE_STORE.has(t.symbol)){TRADE_STORE.set(t.symbol,{state:t.status||'ACTIVE',ep:t.entry,sl:t.sl,tp1:t.tp1,tp2:t.tp2,tier:t.tier||'A',score:t.score||75,assetType:t.type||'ALT',exitStrategy:t.exitStrategy||'TP2',trailActive:false});}}
      return res.status(200).json({ok:true,synced:body.trades?.length||0});
    }catch(e){return res.status(400).json({error:e.message});}
  }

  const sf=async(url,ms=6000)=>{const c=new AbortController();const t=setTimeout(()=>c.abort(),ms);try{const r=await fetch(url,{signal:c.signal,headers:{'User-Agent':'Mozilla/5.0',Accept:'application/json'}});clearTimeout(t);if(!r.ok)return null;return await r.json();}catch{clearTimeout(t);return null;}};

  // ── HALVING CYCLE (v12) ─────────────────────────────────────
  function halvingCycle(){
    const H4=new Date('2024-04-19').getTime();
    const d=(Date.now()-H4)/86400000;
    if(d<0)   return{phase:'PRE_HALVING',   bonus:+5, emoji:'⏳',desc:'Pre-halving accumulation'};
    if(d<60)  return{phase:'HALVING_SHOCK', bonus:+2, emoji:'💥',desc:'Post-halving volatile'};
    if(d<180) return{phase:'EARLY_BULL',    bonus:+8, emoji:'🌱',desc:'Early bull — accumulate'};
    if(d<365) return{phase:'BULL_RUN',      bonus:+10,emoji:'🚀',desc:'Bull run — ride momentum'};
    if(d<540) return{phase:'PEAK_EUPHORIA', bonus:-5, emoji:'🎯',desc:'Peak — take profits'};
    if(d<730) return{phase:'BEAR_PHASE',    bonus:-12,emoji:'🐻',desc:'Bear market — strict'};
    if(d<900) return{phase:'ACCUMULATION',  bonus:+6, emoji:'💎',desc:'Deep accumulation'};
    return{phase:'PRE_HALVING',bonus:+5,emoji:'⏳',desc:'Pre-halving'};
  }

  // ── MOON PHASE (v12) ────────────────────────────────────────
  function moonPhase(){
    const NM=new Date('2024-01-11').getTime();
    const CY=29.53*86400000;
    const p=((Date.now()-NM)%CY+CY)%CY/CY;
    if(p<0.05||p>0.95)return{phase:'NEW_MOON',  bonus:+3,emoji:'🌑',label:'New Moon — setup window'};
    if(p<0.30)         return{phase:'WAXING',    bonus:+1,emoji:'🌒',label:'Waxing'};
    if(p<0.55)         return{phase:'FULL_MOON', bonus:+2,emoji:'🌕',label:'Full Moon — high energy'};
    if(p<0.75)         return{phase:'WANING_G',  bonus:-1,emoji:'🌖',label:'Waning Gibbous'};
    return               {phase:'WANING_C',  bonus:-1,emoji:'🌘',label:'Waning Crescent'};
  }

  // ── MARKET REGIME ───────────────────────────────────────────
  function regime(btcCh7,btcCh24,btcDom,fg,trend,hv,moon){
    const cb=hv.bonus+moon.bonus;
    if(Math.abs(btcCh24)>12||fg<=8||fg>=93)return{r:'CHAOTIC',kill:true,color:'#ff4466',piMin:5,sMin:99,cMin:99,bonus:-999,focus:'NO TRADE',hv,moon};
    if(btcCh7<-8||(btcCh7<-5&&trend==='BEARISH'))return{r:'BEAR',kill:false,color:'#ff4466',piMin:4,sMin:82,cMin:85,bonus:-10+cb,focus:`Bear strict. ${hv.emoji} ${hv.phase}`,hv,moon};
    if(btcCh7>8||(btcCh7>5&&trend==='BULLISH'&&fg>50))return{r:'BULL',kill:false,color:'#00ffd0',piMin:3,sMin:75,cMin:80,bonus:+8+cb,focus:`Bull optimal. ${hv.emoji} ${hv.desc}`,hv,moon};
    return{r:'RANGE',kill:false,color:'#FFB300',piMin:2,sMin:72,cMin:78,bonus:+3+cb,focus:`Range accumulation. ${moon.emoji} ${moon.label}`,hv,moon};
  }

  // ── INDEPENDENT WATCHLIST UPDATER (★ KEY FIX) ───────────────
  function updateWatchlistPrices(bmap){
    const now=Date.now(),events=[];
    SETUP_LOCK.forEach((w,sym)=>{
      if(['COMPLETED','INVALID'].includes(w.status))return;
      const tk=bmap[sym+'USDT'];if(!tk)return;
      const price=+(tk.lastPrice||0);if(!price)return;
      let sl=w.sl;
      if(w.trailActive&&w.entryPrice>0){const trail=+(price*(w.isMeme?0.90:0.93)).toFixed(8);sl=Math.max(w.sl,trail);if(sl>w.sl)SETUP_LOCK.set(sym,{...w,sl});}
      if(price<=sl*0.999){const pnl=w.entryPrice>0?+((price-w.entryPrice)/w.entryPrice*100).toFixed(2):0;SETUP_LOCK.set(sym,{...w,status:'INVALID',currentPrice:price,pnl,closedAt:now});STATS_STORE.losses++;events.push({sym,type:'SL_HIT',price,pnl});tg(`❌ <b>SL HIT — ${sym}</b>\n📉 Loss: ${pnl}%\nSL: $${fmtP(sl)}\nEntry: $${fmtP(w.entryPrice)}\n${w.assetType}`);return;}
      if(price>=w.tp2*0.998){const pnl=w.entryPrice>0?+((w.tp2-w.entryPrice)/w.entryPrice*100).toFixed(2):0;SETUP_LOCK.set(sym,{...w,status:'COMPLETED',currentPrice:price,pnl,closedAt:now});STATS_STORE.wins++;events.push({sym,type:'TP2_HIT',price,pnl});tg(`✅ <b>TP2 HIT — ${sym}</b>\n💰 Profit: +${pnl}%\nTP2: $${fmtP(w.tp2)}\nEntry: $${fmtP(w.entryPrice)}`);return;}
      if(price>=w.tp1*0.998&&w.status!=='TP1_HIT'&&w.status!=='COMPLETED'){const pnl=w.entryPrice>0?+((w.tp1-w.entryPrice)/w.entryPrice*100).toFixed(2):0;SETUP_LOCK.set(sym,{...w,status:'TP1_HIT',currentPrice:price,pnl,trailActive:true,sl:Math.max(w.sl,w.entryPrice||w.sl)});events.push({sym,type:'TP1_HIT',price,pnl});tg(`🎯 <b>TP1 HIT — ${sym}</b>\n+${pnl}%\n🔄 SL → breakeven: $${fmtP(w.entryPrice)}\nTP2: $${fmtP(w.tp2)} (+${w.tp2Pct}%)`);return;}
      if(price>=w.entryLo&&price<=w.entryHi&&w.status==='WATCHING'){SETUP_LOCK.set(sym,{...w,status:'TRIGGERED',entryPrice:price,triggeredAt:now,currentPrice:price});events.push({sym,type:'TRIGGERED',price});tg(`⚡ <b>TRIGGERED — ${sym}</b>\n$${fmtP(price)} in zone\n🎯 ${fmtP(w.entryLo)}–${fmtP(w.entryHi)}\n🛑 SL: $${fmtP(w.sl)} | TP1: $${fmtP(w.tp1)} (+${w.tp1Pct}%)\nScore: ${w.score}`);return;}
      const pnl=w.entryPrice>0?+((price-w.entryPrice)/w.entryPrice*100).toFixed(2):0;
      SETUP_LOCK.set(sym,{...w,currentPrice:price,pnl});
    });
    return events;
  }

  // ── 7-LAYER PRE-IMPULSE (v12: was 5-layer) ─────────────────
  function preImpulse(price,high,low,open,ch24,ch7,vol,rp,lw,body,isMeme,hv){
    if(ch24>(isMeme?15:9))return{valid:false,count:0,score:0,stage:'LATE',sigs:[],pumped:true};
    const vt=vol>=500e6?5:vol>=100e6?4:vol>=30e6?3:vol>=10e6?2:vol>=2e6?1:0;
    const range24=high>low?(high-low)/low:0;
    const sigs=[];
    if(vt>=(isMeme?2:3)&&Math.abs(ch24)<=4)sigs.push({s:'VOLUME_ACCUM',pts:20,note:`$${(vol/1e6).toFixed(0)}M + flat = SM absorbing`});
    else if(vt>=1&&Math.abs(ch24)<=2)sigs.push({s:'VOLUME_ACCUM',pts:10,note:`$${(vol/1e6).toFixed(0)}M vol + flat`});
    if(lw>0.38&&rp<0.52&&price>low*1.002)sigs.push({s:'LIQUIDITY_SWEEP',pts:22,note:`Wick ${(lw*100).toFixed(0)}% — stops cleared`});
    if(range24<(isMeme?0.08:0.055)&&Math.abs(ch24)<4&&vol>3e6)sigs.push({s:'COMPRESSION',pts:18,note:`Range ${(range24*100).toFixed(1)}% — coiling`});
    if(vt>=1&&body<0.25&&lw>0.25&&rp<0.58)sigs.push({s:'ABSORPTION',pts:18,note:`Body ${(body*100).toFixed(0)}%/wick ${(lw*100).toFixed(0)}% — SM taking supply`});
    if(ch24>0.3&&ch24<(isMeme?15:8)&&(ch7||0)>-15&&rp>0.38)sigs.push({s:'HIGHER_LOW',pts:15,note:`+${ch24.toFixed(1)}% HL forming`});
    if((ch7||0)>8&&Math.abs(ch24)<6)sigs.push({s:'REL_STRENGTH',pts:14,note:`7d +${(ch7||0).toFixed(1)}% outperforming`});
    if(hv&&['EARLY_BULL','BULL_RUN','ACCUMULATION'].includes(hv.phase)&&vt>=1)sigs.push({s:'CYCLE_ALIGN',pts:10,note:`${hv.emoji} ${hv.phase} — historically optimal`});
    const count=sigs.length;
    const score=Math.min(25,Math.round(sigs.reduce((a,s)=>a+s.pts,0)*25/90));
    const stage=count>=5?'READY 🔥':count>=4?'STRONG 💪':count===3?'EARLY 📈':count===2?'FORMING 🔄':'WEAK';
    return{valid:count>=2,count,score,stage,sigs,pumped:false};
  }

  // ── SMART MONEY (25pts) ─────────────────────────────────────
  function smartMoney(price,high,low,open,ch24,ch7,vol,rp,lw,body){
    const vt=vol>=500e6?5:vol>=100e6?4:vol>=30e6?3:vol>=10e6?2:vol>=2e6?1:0;
    const sigs=[];
    if(lw>0.38&&rp<0.55&&price>low*1.002){const str=lw>0.55?'STRONG':'MODERATE';sigs.push({type:'LIQUIDITY_SWEEP',strength:str,pts:str==='STRONG'?22:14});}
    if(vt>=2&&Math.abs(ch24)<=4)sigs.push({type:'ACCUMULATION',strength:vt>=4?'STRONG':'MODERATE',pts:vt>=4?22:13});
    else if(vt>=1&&Math.abs(ch24)<=2)sigs.push({type:'ACCUMULATION',strength:'MODERATE',pts:10});
    if(vt>=1&&body<0.25&&lw>0.25)sigs.push({type:'ABSORPTION',strength:'STRONG',pts:20});
    if(ch24>2.5&&ch24<12&&rp>0.52&&lw>0.18)sigs.push({type:'STRUCTURE_RECLAIM',strength:ch24>5?'STRONG':'MODERATE',pts:ch24>5?18:11});
    const strong=sigs.filter(s=>s.strength==='STRONG').length;
    const smScore=Math.min(25,Math.round(sigs.reduce((a,s)=>a+s.pts,0)*25/66));
    return{sigs,count:sigs.length,strong,smScore,valid:sigs.length>=2};
  }

  // ── RR ENGINE v12 (cycle-aware) ─────────────────────────────
  function calcRR(price,low,high,ath,isMeme,hv){
    const dr=high>low?(high-low)/price:0.05;
    const slPct=isMeme?Math.max(0.06,Math.min(0.15,dr*2+0.03)):Math.max(0.05,Math.min(0.12,dr*1.5+0.02));
    const slPrice=+(price*(1-slPct)).toFixed(8);
    const slDist=price-slPrice;
    const minRR=isMeme?2:3;
    const tpMult=hv&&['BULL_RUN','EARLY_BULL'].includes(hv.phase)?1.15:1.0;
    const maxTP=price*2.0;
    const tp1=Math.min(price+slDist*minRR*tpMult,maxTP);
    const tp2=Math.min(price+slDist*(minRR+1.5)*tpMult,maxTP);
    const rr1=+((tp1-price)/slDist).toFixed(2);
    const rr2=+((tp2-price)/slDist).toFixed(2);
    return{slPrice,slPct:+(slPct*100).toFixed(1),slDist,tp1:+tp1.toFixed(8),tp2:+tp2.toFixed(8),tp1Pct:+((tp1-price)/price*100).toFixed(1),tp2Pct:+((tp2-price)/price*100).toFixed(1),rr1,rr2,rrLabel:`1:${rr1.toFixed(1)} / 1:${rr2.toFixed(1)}`,unrealistic:((tp1-price)/price*100)>100};
  }

  // ── SCORING ENGINE v12 ──────────────────────────────────────
  function scoreSetup(coin,btcCh24,btcCh7,fg,pi,sm,rr1,regBonus,isMeme,hv,moon){
    const{price,vol,ch24,high,low,open,ch7,ch30,ath}=coin;
    const range=Math.max(high-low,price*0.01);
    const rp=(price-low)/range;
    const fromATH=ath>0?((price-ath)/ath*100):0;
    const rs7=(ch7||0)-btcCh7;
    const vt=vol>=500e6?5:vol>=100e6?4:vol>=30e6?3:vol>=10e6?2:vol>=2e6?1:0;
    let mom=rs7>12?20:rs7>8?18:rs7>5?16:rs7>2?14:rs7>0&&btcCh7<0?16:rs7>=-3&&ch24>=0?11:ch24>2?9:rs7<-10?4:7;
    if(fg<=25)mom=Math.min(20,mom+3);
    if(isMeme&&ch24>3&&vt>=2)mom=Math.min(20,mom+3);
    const ssl=lw>0.38&&rp<0.52,choch=ch24>3&&ch24<12&&rp>0.55;
    const lw2=(Math.min(price,open)-low)/range;
    let str=ssl&&choch?15:ssl&&ch24>1?13:choch?12:ssl?9:(ch7||0)>3&&(ch30||0)<-15?8:Math.abs(ch24)<3&&vt>=1?7:rp<0.35?5:3;
    if(rs7>8)str=Math.min(15,str+3);else if(rs7>3)str=Math.min(15,str+2);
    const golden=fromATH<=-55&&fromATH>=-80,deepVal=fromATH<=-80&&fromATH>=-97,early=fromATH<=-30&&fromATH>=-55;
    let mkt=golden&&rp<0.50?15:golden?12:deepVal&&rp<0.45?13:early&&rp<0.40?10:early?8:rp<0.35?7:4;
    if(fg<=25)mkt=Math.min(15,mkt+3);
    if(rr1>=4)mkt=Math.min(15,mkt+2);
    if(golden&&hv&&['EARLY_BULL','BULL_RUN'].includes(hv.phase))mkt=Math.min(15,mkt+2);
    const cosmicBonus=hv?Math.max(-5,Math.min(8,(hv.bonus+moon.bonus)*0.3)):0;
    const raw=pi.score+sm.smScore+mom+str+mkt+regBonus+cosmicBonus;
    const totalScore=Math.max(0,Math.min(100,Math.round(raw)));
    const smAdj=sm.strong>=2?15:sm.valid?8:-15;
    const piAdj=pi.count>=5?20:pi.count>=4?15:pi.count>=3?10:pi.count>=2?5:-10;
    const rrAdj=rr1>=4.5?10:rr1>=4?8:rr1>=3?4:rr1>=2?2:-15;
    const athAdj=golden?5:deepVal?3:early?0:-2;
    const conf=Math.max(0,Math.min(100,Math.round((raw/100)*100+smAdj+piAdj+rrAdj+athAdj)));
    return{totalScore,conf,comps:{pi:pi.score,sm:sm.smScore,mom,str,mkt},fromATH,cosmicBonus};
  }

  // ── ENTRY CONFIRMATION ──────────────────────────────────────
  function entryConf(ch24,lw,body,rp,vol){
    const cs=[],vt=vol>=100e6?3:vol>=30e6?2:vol>=5e6?1:0;
    if(lw>0.35&&body<0.28)cs.push('REJECTION');
    if(vt>=1&&(ch24>0.3||Math.abs(ch24)<2))cs.push('VOLUME_SPIKE');
    if(ch24>2.5&&ch24<12&&rp>0.55)cs.push('MICRO_BOS');
    if(lw>0.28&&ch24>0.3&&rp>0.42)cs.push('SWEEP_RECOVERY');
    return{list:cs,count:cs.length,valid:cs.length>=2,needs:Math.max(0,2-cs.length)};
  }

  // ── CONFLICT ENGINE v12 ─────────────────────────────────────
  function conflicts(ch24,ch7,ch30,rp,reg,btcCh7,fg,hv){
    const cs=[];
    if((ch7||0)<-10&&ch24>0&&rp>0.45)cs.push({sev:'HIGH',note:'HTF bear + LTF pump = dead cat'});
    if(reg==='BEAR'&&ch24>6)cs.push({sev:'HIGH',note:`Bear regime + +${ch24.toFixed(1)}%`});
    if(ch24>9&&btcCh7<-3)cs.push({sev:'HIGH',note:'Pump while BTC weekly red'});
    if(fg<=15&&ch24>7)cs.push({sev:'HIGH',note:'Extreme fear + pump'});
    if(hv&&hv.phase==='PEAK_EUPHORIA'&&rp>0.7)cs.push({sev:'MEDIUM',note:'Peak euphoria + extended'});
    if((ch30||0)>150&&rp>0.65)cs.push({sev:'MEDIUM',note:'30d parabolic — risky'});
    const hi=cs.filter(c=>c.sev==='HIGH').length,med=cs.filter(c=>c.sev==='MEDIUM').length;
    const level=hi>=1||hi+med>=2?'HIGH':med>=1?'MEDIUM':'LOW';
    return{cs,level,action:level==='HIGH'?'REJECT':level==='MEDIUM'?'WAIT':'PROCEED'};
  }

  // ── SETUP LOCK ──────────────────────────────────────────────
  function lockSetup(sym,price,entLo,entHi,rr,score,conf,tier,assetType,isMeme,hv,moon){
    if(SETUP_LOCK.has(sym))return;
    const activeWL=[...SETUP_LOCK.values()].filter(w=>!['COMPLETED','INVALID'].includes(w.status));
    if(activeWL.length>=MAX_WATCHLIST)return;
    const now=Date.now();
    const entry={symbol:sym,status:'WATCHING',entryLo:+entLo.toFixed(8),entryHi:+entHi.toFixed(8),entryPrice:+(price*0.999).toFixed(8),sl:rr.slPrice,slPct:rr.slPct,tp1:rr.tp1,tp1Pct:rr.tp1Pct,rr1:rr.rr1,tp2:rr.tp2,tp2Pct:rr.tp2Pct,rr2:rr.rr2,rr:rr.rrLabel,score,confidence:conf,tier,assetType,isMeme,halvingPhase:hv?.phase,moonPhase:moon?.phase,lockedAt:now,lockedAtStr:new Date(now).toLocaleString('id-ID',{timeZone:'Asia/Jakarta',hour12:false}),currentPrice:price,pnl:0,trailActive:false,triggeredAt:null,closedAt:null};
    SETUP_LOCK.set(sym,entry);
    tg(`🔒 <b>LOCKED — ${sym}</b>\n📊 ${score} | ${conf}% | ${tier}\n📍 $${fmtP(entLo)}–$${fmtP(entHi)}\n🛑 $${fmtP(rr.slPrice)} (-${rr.slPct}%)\n🎯 TP1 $${fmtP(rr.tp1)} (+${rr.tp1Pct}%)\n🎯 TP2 $${fmtP(rr.tp2)} (+${rr.tp2Pct}%)\n${hv.emoji} ${hv.phase} · ${moon.emoji} ${moon.label}`);
  }

  // ── TRADE STATE ─────────────────────────────────────────────
  function tradeState(sym,price,entLo,entHi,rr,tier,score,assetType,isMeme,majorCnt,memeCnt){
    const now=Date.now();
    const ex=TRADE_STORE.get(sym);
    if(ex&&['IN_ZONE','TRIGGERED','ACTIVE'].includes(ex.state)){
      if(price<=ex.sl*0.999){TRADE_STORE.set(sym,{...ex,state:'INVALID',closed:now});return{state:'INVALID',tag:'SL HIT',active:false};}
      if(price>=ex.tp1*0.998){TRADE_STORE.set(sym,{...ex,state:'COMPLETED',closed:now});return{state:'COMPLETED',tag:'TP1 DONE',active:false};}
      const pnl=ex.ep>0?+((price-ex.ep)/ex.ep*100).toFixed(2):0;
      return{state:ex.state,tag:`${ex.state} PnL:${pnl>=0?'+':''}${pnl}%`,active:true,ep:ex.ep,pnl,sl:ex.sl,tp1:ex.tp1,tp2:ex.tp2,rr:ex.rr,locked:true,exitStrategy:ex.exitStrategy||'TP2',trailActive:ex.trailActive||false};
    }
    const isM=assetType==='MEME';
    if(isM&&memeCnt>=MAX_MEME)return{state:'READY',tag:`MEME LIMIT (${memeCnt}/${MAX_MEME})`,active:false,blocked:true};
    if(!isM&&majorCnt>=MAX_MAJOR)return{state:'READY',tag:`MAX TRADES (${majorCnt}/${MAX_MAJOR})`,active:false,blocked:true};
    if(price>=entLo*0.999&&price<=entHi*1.01){TRADE_STORE.set(sym,{state:'IN_ZONE',ep:price,et:now,sl:rr.slPrice,tp1:rr.tp1,tp2:rr.tp2,rr:rr.rrLabel,tier,score,assetType,exitStrategy:'TP2',trailActive:false});return{state:'IN_ZONE',tag:'IN_ZONE',active:true,ep:price};}
    if(!ex)TRADE_STORE.set(sym,{state:'READY',sl:rr.slPrice,tp1:rr.tp1,tp2:rr.tp2,rr:rr.rrLabel});
    const d=(entLo-price)/price;
    return{state:'READY',tag:`READY — ${d<=0?'AT ZONE':d<0.02?'NEAR 2%':d<0.05?'NEAR 5%':'WAITING'}`,active:false};
  }

  // ── MAIN ────────────────────────────────────────────────────
  try{
    const t0=Date.now();
    const hv=halvingCycle();
    const moon=moonPhase();
    const[binR,cgR,fngR,glbR,btcKR]=await Promise.allSettled([
      sf('https://api.binance.com/api/v3/ticker/24hr',6000),
      sf('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=volume_desc&per_page=250&page=1&sparkline=false&price_change_percentage=7d,30d',6000),
      sf('https://api.alternative.me/fng/?limit=1&format=json'),
      sf('https://api.coingecko.com/api/v3/global'),
      sf('https://min-api.cryptocompare.com/data/v2/histohour?fsym=BTC&tsym=USD&limit=168',5000),
    ]);
    const bins=binR.status==='fulfilled'&&Array.isArray(binR.value)&&binR.value.length>100?binR.value:[];
    const cgs=cgR.status==='fulfilled'&&Array.isArray(cgR.value)?cgR.value:[];
    const fg=fngR.status==='fulfilled'?parseInt(fngR.value?.data?.[0]?.value||50):50;
    const glb=glbR.status==='fulfilled'?glbR.value?.data:null;
    const btcK=btcKR.status==='fulfilled'&&btcKR.value?.Response==='Success'?btcKR.value.Data.Data.map(d=>+d.close).filter(v=>v>0):[];
    const bmap={};bins.forEach(t=>{if(t?.symbol)bmap[t.symbol]=t;});
    const btcT=bmap['BTCUSDT'];
    const btcPx=+(btcT?.lastPrice||0),btcCh24=+(btcT?.priceChangePercent||0);
    let btcCh7=0,btcTrend='NEUTRAL';
    if(btcK.length>=50){const c=btcK[btcK.length-1],w7=btcK.length>=168?btcK[btcK.length-168]:btcK[0];btcCh7=w7>0?+((c-w7)/w7*100).toFixed(2):0;const ma50=btcK.slice(-50).reduce((a,b)=>a+b,0)/50;btcTrend=c>ma50*1.02?'BULLISH':c<ma50*0.98?'BEARISH':'NEUTRAL';}
    const btcDom=+(glb?.market_cap_percentage?.btc||58).toFixed(1);
    const reg=regime(btcCh7,btcCh24,btcDom,fg,btcTrend,hv,moon);
    const wlEvents=updateWatchlistPrices(bmap);
    const STABLES=new Set(['USDT','USDC','BUSD','TUSD','DAI','FDUSD','USDP','FRAX','LUSD','USDS','SUSD','GUSD','PYUSD','CRVUSD','USDD','PAXG','XAUT','WBTC','WETH','WBNB','STETH','CBETH','RETH','AUSD','IDRT','BIDR','BVND','TRYB']);
    const BAD=['UP','DOWN','BEAR','BULL','3L','3S','2L','2S'];
    const HAN=/[\u4e00-\u9fff]/;
    const cgm={};cgs.forEach(c=>{if(c?.symbol)cgm[c.symbol.toUpperCase()]=c;});
    const candidates=[],seen=new Set();
    bins.forEach(t=>{
      if(!t?.symbol?.endsWith('USDT'))return;
      const b=t.symbol.replace('USDT','');
      if(STABLES.has(b)||seen.has(b)||HAN.test(b)||BAD.some(s=>b.startsWith(s)||b.endsWith(s))||b.length<2||b.length>12)return;
      const v=+(t.quoteVolume||0),p=+(t.lastPrice||0);
      if(v<200000||p<=0||(p>=0.97&&p<=1.03&&Math.abs(+(t.priceChangePercent||0))<2))return;
      seen.add(b);const cg=cgm[b];
      candidates.push({base:b,price:p,vol:v,ch24:+(t.priceChangePercent||0),high:+(t.highPrice||p),low:+(t.lowPrice||p),open:+(t.openPrice||p),ch7:cg?+(cg.price_change_percentage_7d||0):null,ch30:cg?+(cg.price_change_percentage_30d||0):null,ath:cg?+(cg.ath||0):0,mcap:cg?+(cg.market_cap||0):0,name:cg?.name||b});
    });
    cgs.forEach(c=>{
      const b=(c.symbol||'').toUpperCase();
      if(STABLES.has(b)||seen.has(b)||HAN.test(c.name||''))return;
      const v=+(c.total_volume||0),p=+(c.current_price||0);
      if(v<500000||p<=0||(p>=0.97&&p<=1.03))return;
      candidates.push({base:b,price:p,vol:v,ch24:+(c.price_change_percentage_24h||0),high:p*1.02,low:p*0.98,open:p/(1+(+(c.price_change_percentage_24h||0))/100),ch7:+(c.price_change_percentage_7d||0),ch30:+(c.price_change_percentage_30d||0),ath:+(c.ath||0),mcap:+(c.market_cap||0),name:c.name||b});
    });
    let majorCnt=0,memeCnt=0;
    TRADE_STORE.forEach((v,k)=>{if(['IN_ZONE','TRIGGERED','ACTIVE'].includes(v.state)){if(v.assetType==='MEME')memeCnt++;else majorCnt++;}});
    const killed={KILL:0,PI:0,SM:0,RR:0,CONFLICT:0,SCORE:0,STALE:0};
    const outputs=[],activeSetups=[];

    for(const coin of candidates.slice(0,800)){
      const{base:sym,price,ath,ch24,vol,ch7,ch30,mcap}=coin;
      if(!price||price<=0)continue;
      if(ath>0&&((price-ath)/ath*100)<-99){killed.STALE++;continue;}
      const assetType=classifyAsset(sym,mcap,vol),isMeme=assetType==='MEME';
      const range=Math.max(coin.high-coin.low,price*0.01);
      const rp=(price-coin.low)/range,lw=(Math.min(price,coin.open)-coin.low)/range,body=Math.abs(price-coin.open)/range;
      const vt=vol>=500e6?5:vol>=100e6?4:vol>=30e6?3:vol>=10e6?2:vol>=2e6?1:0;
      const exT=TRADE_STORE.get(sym);
      if(exT&&['IN_ZONE','TRIGGERED','ACTIVE'].includes(exT.state)){
        if(price<=exT.sl*0.999){TRADE_STORE.set(sym,{...exT,state:'INVALID',closed:Date.now()});continue;}
        const pnl=exT.ep>0?+((price-exT.ep)/exT.ep*100).toFixed(2):0;
        activeSetups.push({symbol:sym,assetType,isMeme,price,status:exT.state,tag:`${exT.state} PnL:${pnl>=0?'+':''}${pnl}%`,ep:exT.ep,pnl,sl:exT.sl,tp1:exT.tp1,tp2:exT.tp2,rr:exT.rr,ch24:+ch24.toFixed(2),exitStrategy:exT.exitStrategy||'TP2',trailActive:exT.trailActive||false,locked:true});
        continue;
      }
      if(reg.kill){killed.KILL++;continue;}
      const pi=preImpulse(price,coin.high,coin.low,coin.open,ch24,ch7,vol,rp,lw,body,isMeme,hv);
      if(pi.pumped||pi.count<reg.piMin){killed.PI++;continue;}
      if(vt<1&&!isMeme){killed.PI++;continue;}
      if(ch24<-10){killed.PI++;continue;}
      const sm=smartMoney(price,coin.high,coin.low,coin.open,ch24,ch7,vol,rp,lw,body);
      if(!sm.valid){killed.SM++;continue;}
      const rr=calcRR(price,coin.low,coin.high,ath,isMeme,hv);
      if(rr.unrealistic||(isMeme?rr.rr1<2:rr.rr1<3)){killed.RR++;continue;}
      const conf=conflicts(ch24,ch7,ch30,rp,reg.r,btcCh7,fg,hv);
      if(conf.action==='REJECT'){killed.CONFLICT++;continue;}
      const sc=scoreSetup({...coin,vol,ch24,ch7,ch30,high:coin.high,low:coin.low,open:coin.open,ath},btcCh24,btcCh7,fg,pi,sm,rr.rr1,reg.bonus||0,isMeme,hv,moon);
      const bearPen=reg.r==='BEAR'?-10:0;
      const finalScore=Math.max(0,Math.min(100,sc.totalScore+bearPen));
      const finalConf=Math.max(0,Math.min(100,sc.conf+(reg.r==='BEAR'?-8:0)));
      const sMin=isMeme?Math.max(70,reg.sMin-5):reg.sMin,cMin=isMeme?Math.max(75,reg.cMin-5):reg.cMin;
      if(finalScore<sMin||finalConf<cMin){killed.SCORE++;continue;}
      const now=Date.now();const fts=SETUP_TS.get(sym);
      if(!fts)SETUP_TS.set(sym,{t:now,vol});
      const ageH=fts?(now-fts.t)/3600000:0,volFaded=fts&&vol<fts.vol*0.45;
      const fresh=ageH<(isMeme?2:6)&&!volFaded,valid2=!fresh&&ageH<(isMeme?4:24)&&!volFaded,weak=!fresh&&!valid2&&ageH<(isMeme?6:48)&&!volFaded;
      if(!fresh&&!valid2&&!weak){killed.STALE++;continue;}
      const tsStatus=fresh?'FRESH ⚡':valid2?'VALID ✓':'WEAK ⚠️';
      const ec=entryConf(ch24,lw,body,rp,vol);
      const entLo=Math.max(price*0.97,coin.low*0.99),entHi=price*1.01;
      const tier=finalScore>=87?'S':finalScore>=75?'A':null;
      if(!tier){killed.SCORE++;continue;}
      const ts=tradeState(sym,price,entLo,entHi,rr,tier,finalScore,assetType,isMeme,majorCnt,memeCnt);
      lockSetup(sym,price,entLo,entHi,rr,finalScore,finalConf,tier,assetType,isMeme,hv,moon);
      const prevDec=DECISION_HIST.get(sym);
      let decision,decColor;
      const isElite=finalScore>=87&&finalConf>=82&&sm.strong>=2;
      const execOK=ts.state==='IN_ZONE'&&ec.valid&&conf.action==='PROCEED'&&!ts.blocked;
      if(execOK&&isElite){decision='EXECUTE ELITE';decColor='#ff6b35';DECISION_HIST.set(sym,'EXECUTE');if(prevDec!=='EXECUTE')tg(`🏆 <b>ELITE — ${sym}</b>\nScore: ${finalScore} | Conf: ${finalConf}%\nIN ZONE — Entry SEKARANG!\n${hv.emoji} ${hv.phase}`);}
      else if(execOK){decision='EXECUTE';decColor='#ff6b35';DECISION_HIST.set(sym,'EXECUTE');}
      else if(prevDec==='EXECUTE'&&ts.state!=='INVALID'){decision='EXECUTE (locked)';decColor='#ff6b35';}
      else if(ts.blocked){decision=`WAIT — ${ts.tag}`;decColor='#FFB300';}
      else if(!ec.valid){decision=`WAIT — Need ${ec.needs} signal`;decColor='#FFB300';}
      else if(conf.action==='WAIT'){decision='WAIT — Conflict';decColor='#FFB300';}
      else{decision=`LIMIT — ${fmtP(entLo)}–${fmtP(entHi)}`;decColor='#00ffd0';}
      const posPct=isElite?'3%':tier==='S'?'2-3%':reg.r==='BULL'?'1.5-2%':'1-2%';
      outputs.push({rank:0,symbol:sym,name:coin.name||sym,assetType,isMeme,price,ch24:+ch24.toFixed(2),ch7:+(ch7||0).toFixed(2),vol,fromATH:sc.fromATH!==0?+sc.fromATH.toFixed(1):null,tier,tierLabel:tier==='S'?'TIER S':'TIER A',finalScore,confidence:finalConf,positionRank:'',freshness:{status:tsStatus,fresh,valid:valid2,weak},preImpulse:{count:pi.count,stage:pi.stage,valid:pi.valid,sigs:pi.sigs},smDetection:{count:sm.count,valid:sm.valid,strong:sm.strong,sigs:sm.sigs},entryConf:ec,conflict:conf,tradeState:ts,status:ts.state,rr:{tp1:rr.tp1,tp2:rr.tp2,tp1Pct:rr.tp1Pct,tp2Pct:rr.tp2Pct,rr1:rr.rr1,rr2:rr.rr2,label:rr.rrLabel,slPrice:rr.slPrice,slPct:rr.slPct},entryZone:{lo:+entLo.toFixed(8),hi:+entHi.toFixed(8),optimal:+(price*0.999).toFixed(8)},scoreBreakdown:sc.comps,cosmicBonus:sc.cosmicBonus,halvingPhase:hv.phase,halvingEmoji:hv.emoji,moonPhase:moon.phase,moonEmoji:moon.emoji,moonLabel:moon.label,decision,decisionColor:decColor,positionSize:posPct,isElite,rrMode:isMeme?'HIGH RISK (1:2-1:4)':'NORMAL (1:3-1:5)',tradeData:{coin:sym,type:assetType,entry:+(price*0.999).toFixed(8),sl:rr.slPrice,tp1:rr.tp1,tp2:rr.tp2,rr:rr.rrLabel,status:['IN_ZONE','TRIGGERED'].includes(ts.state)?'ACTIVE':ts.state,confidence:finalConf,score:finalScore,timestamp:new Date().toISOString().split('T')[0],result:'RUNNING',positionRank:'',tier,exitStrategy:'TP2',pnl:0}});
    }
    outputs.sort((a,b)=>(b.finalScore+b.confidence)-(a.finalScore+a.confidence)||b.vol-a.vol);
    outputs.forEach((r,i)=>{r.rank=i+1;r.positionRank=i<2?'ELITE':i<5?'HIGH':'NORMAL';r.tradeData.positionRank=r.positionRank;if(r.positionRank==='NORMAL'&&r.decision.includes('EXECUTE')&&!r.decision.includes('locked'))r.decision=`LIMIT — ${fmtP(r.entryZone.lo)}-${fmtP(r.entryZone.hi)}`;});
    const wlAll=[...SETUP_LOCK.values()];
    const wlActive=wlAll.filter(w=>!['COMPLETED','INVALID'].includes(w.status));
    const wlCompleted=wlAll.filter(w=>w.status==='COMPLETED'),wlInvalid=wlAll.filter(w=>w.status==='INVALID');
    const winRate=wlCompleted.length+wlInvalid.length>0?+((wlCompleted.length/(wlCompleted.length+wlInvalid.length))*100).toFixed(1):null;
    const watchlist=wlAll.sort((a,b)=>{const o={TRIGGERED:0,TP1_HIT:1,ACTIVE:2,WATCHING:3,COMPLETED:4,INVALID:5};return(o[a.status]??9)-(o[b.status]??9)||b.score-a.score;});
    const activeTrades=[];TRADE_STORE.forEach((v,k)=>{if(['IN_ZONE','TRIGGERED','ACTIVE','COMPLETED','INVALID'].includes(v.state))activeTrades.push({symbol:k,state:v.state,entryPrice:v.ep,sl:v.sl,tp1:v.tp1,tp2:v.tp2,rr:v.rr,tier:v.tier,score:v.score,pnl:v.pnl||0,exitStrategy:v.exitStrategy||'TP2',trailActive:v.trailActive||false});});
    res.setHeader('Cache-Control','s-maxage=60');
    return res.status(200).json({timestamp:Date.now(),scanTime:((Date.now()-t0)/1000).toFixed(1),totalScanned:candidates.length,totalQualified:outputs.length,totalKilled:Object.values(killed).reduce((a,b)=>a+b,0),killedBreakdown:killed,regularSetups:outputs.filter(r=>!r.isMeme).slice(0,13),memeSetups:outputs.filter(r=>r.isMeme).slice(0,10),eliteCount:outputs.filter(r=>r.isElite).length,activeSetups,activeTrades,watchlist,wlActive:wlActive.length,wlCompleted:wlCompleted.length,wlInvalid:wlInvalid.length,wlEvents,stats:{winRate,totalCompleted:wlCompleted.length,totalInvalid:wlInvalid.length,majorActive:majorCnt,memeActive:memeCnt,majorMax:MAX_MAJOR,memeMax:MAX_MEME},cosmic:{halving:hv,moon,btcCh7},regime:reg,systemStatus:{majorActive:majorCnt,majorMax:MAX_MAJOR,memeActive:memeCnt,memeMax:MAX_MEME,btcTrend,fgValue:fg,btcDom,btcCh7,btcPx}});
  }catch(e){return res.status(500).json({error:e.message,totalScanned:0});}
}
function fmtP(p){if(!p||p<=0)return'—';if(p>=10000)return p.toLocaleString('en-US',{maximumFractionDigits:0});if(p>=1000)return p.toLocaleString('en-US',{maximumFractionDigits:2});if(p>=1)return p.toFixed(4);if(p>=0.001)return p.toFixed(6);return p.toFixed(8);}
