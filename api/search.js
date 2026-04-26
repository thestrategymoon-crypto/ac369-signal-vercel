// api/search.js — AC369 FUSION v12.0 INSTITUTIONAL GRADE
// ═══════════════════════════════════════════════════════════════
// DATA SOURCES (all free, no API key):
//   Binance Futures: klines, ticker, fundingRate, OI, OI history
//   Binance Futures: long/short ratio, top trader ratio
//   Binance Spot: klines fallback
//   CryptoCompare: klines fallback
//   CoinGecko: price fallback
//   Bybit: OI + funding cross-validation
//
// ANALYSIS MODULES:
//   1. Multi-TF Klines: 1H (200c), 4H (200c), 1D (200c)
//   2. Market Structure: BOS / CHoCH / HH-HL / LH-LL
//   3. SMC: Order Block, FVG, Liquidity Sweep, Premium/Discount
//   4. Elliott Wave: Wave counting + Fibonacci projections
//   5. Technical: RSI(Wilder) + EMA + MACD + BB + ATR
//   6. Derivatives: Funding Rate + OI + OI History + L/S Ratio
//   7. Liquidation Map: Pain points, BSL/SSL clustering
//   8. Astrology: Moon phase + Halving cycle + Mercury Retrograde
//   9. Confluence Scoring: 0-100 weighted
//   10. Trade Setup: Entry zone, SL, TP1/2/3, R:R
// ═══════════════════════════════════════════════════════════════

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const rawSym = (req.query.symbol || req.query.s || '').toUpperCase().replace(/[^A-Z0-9]/g,'');
  if (!rawSym) return res.status(400).json({ error: 'Parameter symbol diperlukan. Contoh: ?symbol=BTC' });
  const sym = rawSym.replace(/USDT$/,'');

  // ── SAFE FETCH ────────────────────────────────────────────────
  const sf = async (url, ms = 9000) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
      const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } });
      clearTimeout(t); if (!r.ok) return null; return await r.json();
    } catch { clearTimeout(t); return null; }
  };

  // ── COINGECKO ID MAP ──────────────────────────────────────────
  const CG = {
    BTC:'bitcoin',ETH:'ethereum',BNB:'binancecoin',XRP:'ripple',SOL:'solana',
    ADA:'cardano',AVAX:'avalanche-2',DOGE:'dogecoin',TRX:'tron',DOT:'polkadot',
    LINK:'chainlink',MATIC:'matic-network',TON:'the-open-network',SHIB:'shiba-inu',
    LTC:'litecoin',UNI:'uniswap',ATOM:'cosmos',XLM:'stellar',BCH:'bitcoin-cash',
    ETC:'ethereum-classic',ICP:'internet-computer',APT:'aptos',FIL:'filecoin',
    NEAR:'near',ALGO:'algorand',VET:'vechain',HBAR:'hedera-hashgraph',
    GRT:'the-graph',SAND:'the-sandbox',AXS:'axie-infinity',MANA:'decentraland',
    EOS:'eos',XTZ:'tezos',THETA:'theta-token',AAVE:'aave',MKR:'maker',
    COMP:'compound-governance-token',SNX:'havven',CRV:'curve-dao-token',
    SUSHI:'sushi',YFI:'yearn-finance',BAT:'basic-attention-token',
    ZEC:'zcash',DASH:'dash',XMR:'monero',NEO:'neo',WAVES:'waves',
    KSM:'kusama',CAKE:'pancakeswap-token',ARB:'arbitrum',OP:'optimism',
    SUI:'sui',SEI:'sei-network',INJ:'injective-protocol',TIA:'celestia',
    PYTH:'pyth-network',JTO:'jito-governance-token',STRK:'starknet',
    WLD:'worldcoin-wld',BLUR:'blur',ENS:'ethereum-name-service',
    LDO:'lido-dao',RPL:'rocket-pool',PENDLE:'pendle',
    RENDER:'render-token',FET:'fetch-ai',OCEAN:'ocean-protocol',
    IO:'io-net',TAO:'bittensor',WIF:'dogwifcoin',BONK:'bonk',
    PEPE:'pepe',FLOKI:'floki',BOME:'book-of-meme',GALA:'gala',
    IMX:'immutable-x',GMT:'stepn',RON:'ronin',MAGIC:'trove',
    HYPE:'hyperliquid',APE:'apecoin',DYDX:'dydx-chain',GMX:'gmx',
    GNS:'gains-network',AR:'arweave',STORJ:'storj',ANKR:'ankr',
    API3:'api3',ROSE:'oasis-network',CKB:'nervos-network',KAVA:'kava',
    LUNA:'terra-luna-2',LUNC:'terra-luna',RAY:'raydium',
    JUP:'jupiter-exchange-solana',FTM:'fantom',ONE:'harmony',
    IOTA:'iota',ZIL:'zilliqa',HOT:'holo',CHZ:'chiliz',
    ENJ:'enjincoin',ZRX:'0x',BAL:'balancer',BAND:'band-protocol',
    TWT:'trust-wallet-token',FLOW:'flow',MINA:'mina-protocol',
    CELO:'celo',GLMR:'moonbeam',CTSI:'cartesi',WIN:'wink',
    JST:'just',SUN:'sun-token',BTT:'bittorrent',JASMY:'jasmycoin',
    ACH:'alchemy-pay',CELR:'celer-network',STMX:'storm',
    POLS:'polkastarter',HIGH:'highstreet',DAR:'mines-of-dalarnia',
    HOOK:'hooked-protocol',CFX:'conflux-token',MASK:'mask-network',
    LOOKS:'looksrare',METIS:'metis-token',RUNE:'thorchain',
    STG:'stargate-finance',DODO:'dodo',BADGER:'badger-dao',
    TLM:'alien-worlds',ALICE:'my-neighbor-alice',PUNDIX:'pundi-x-2',
    QUICK:'quickswap',ASTAR:'astar',MBOX:'mobox',RDNT:'radiant-capital',
    ZK:'zksync',BB:'bouncebit',SAGA:'saga-2',W:'wormhole',
    OMNI:'omni-network',AEVO:'aevo',ZETA:'zetachain',
    EIGEN:'eigenlayer',ETHFI:'ether-fi',ENA:'ethena',REZ:'renzo',
    TNSR:'tensor',DRIFT:'drift-protocol',LISTA:'lista-dao',
    BRETT:'brett',MOG:'mog-coin',PEPE:'pepe',NEIRO:'neiro-on-eth',
    GOAT:'goat',PNUT:'peanut-the-squirrel',ME:'magic-eden',
    PENGU:'pudgy-penguins',USUAL:'usual',MORPHO:'morpho',
    COW:'cow-protocol',GUN:'gunstar-metaverse',
    LAZIO:'lazio-fan-token',PORTO:'fc-porto',
    TOMO:'tomochain',KDA:'kadena',HIVE:'hive',KMD:'komodo',
    BLZ:'bluzelle',DOCK:'dock',LSK:'lisk',XEM:'nem',
    ZEN:'horizen',BTG:'bitcoin-gold',DCR:'decred',
    WAN:'wanchain',ARPA:'arpa',IOTX:'iotex',
    OXT:'orchid-protocol',QNT:'quant-network',
    GAL:'project-galaxy',PEOPLE:'constitutiondao',
    AMB:'ambire-adex',NULS:'nuls',CVC:'civic',
    BOND:'barnbridge',ALPHA:'alpha-finance',TRIBE:'tribe-2',
    DENT:'dent',OGN:'origin-protocol',NKN:'nkn',RLC:'iexec-rlc',
    MDT:'measurable-data-token',WRX:'wazirx',PHA:'pha',
    FORTH:'ampleforth-governance-token',PAXG:'pax-gold',
    DIA:'dia-data',MBL:'moviebloc',CTXC:'cortex',
    DUSK:'dusk-network',POND:'marlin',
    STEP:'step-finance',FIDA:'bonfida',KIN:'kin',
    CHILLGUY:'chill-guy',LUCE:'luce',PONKE:'ponke',
    TURBO:'turbo',BABYDOGE:'baby-doge-coin',SLP:'smooth-love-potion',
  };

  // ── FETCH KLINES (4-layer fallback) ───────────────────────────
  async function fetchK(interval, limit = 200) {
    let d = await sf(`https://fapi.binance.com/fapi/v1/klines?symbol=${sym}USDT&interval=${interval}&limit=${limit}`);
    if (Array.isArray(d) && d.length > 14) return d.map(k=>({t:+k[0],o:+k[1],h:+k[2],l:+k[3],c:+k[4],v:+k[5],qv:+k[7]}));
    d = await sf(`https://api.binance.com/api/v3/klines?symbol=${sym}USDT&interval=${interval}&limit=${limit}`);
    if (Array.isArray(d) && d.length > 14) return d.map(k=>({t:+k[0],o:+k[1],h:+k[2],l:+k[3],c:+k[4],v:+k[5],qv:+k[7]}));
    const ccE = interval==='1d'?'histoday':'histohour';
    const ccL = interval==='4h'?limit*4:limit;
    const cc = await sf(`https://min-api.cryptocompare.com/data/v2/${ccE}?fsym=${sym}&tsym=USD&limit=${ccL}`);
    if (cc?.Response==='Success' && cc.Data?.Data?.length>14) {
      let data = cc.Data.Data.map(d=>({t:d.time*1000,o:d.open,h:d.high,l:d.low,c:d.close,v:d.volumeto,qv:d.volumeto}));
      if (interval==='4h') {
        const agg=[];
        for(let i=0;i+3<data.length;i+=4){const sl=data.slice(i,i+4);agg.push({t:sl[0].t,o:sl[0].o,h:Math.max(...sl.map(k=>k.h)),l:Math.min(...sl.map(k=>k.l)),c:sl[3].c,v:sl.reduce((s,k)=>s+k.v,0),qv:sl.reduce((s,k)=>s+k.qv,0)});}
        return agg;
      }
      return data;
    }
    const cgId=CG[sym];
    if(cgId){
      const days=interval==='1d'?90:interval==='4h'?14:7;
      const cg=await sf(`https://api.coingecko.com/api/v3/coins/${cgId}/ohlc?vs_currency=usd&days=${days}`);
      if(Array.isArray(cg)&&cg.length>10) return cg.map(d=>({t:d[0],o:d[1],h:d[2],l:d[3],c:d[4],v:0,qv:0}));
    }
    return [];
  }

  // ── FETCH PRICE ───────────────────────────────────────────────
  async function fetchPrice() {
    let d = await sf(`https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${sym}USDT`);
    if(d&&!d.code&&+d.lastPrice>0) return {price:+d.lastPrice,change24h:+d.priceChangePercent,vol:+d.quoteVolume,name:sym,src:'binance_futures'};
    d = await sf(`https://api.binance.com/api/v3/ticker/24hr?symbol=${sym}USDT`);
    if(d&&!d.code&&+d.lastPrice>0) return {price:+d.lastPrice,change24h:+d.priceChangePercent,vol:+d.quoteVolume,name:sym,src:'binance_spot'};
    const cgId=CG[sym];
    if(cgId){d=await sf(`https://api.coingecko.com/api/v3/simple/price?ids=${cgId}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true`);if(d?.[cgId]?.usd>0)return{price:d[cgId].usd,change24h:d[cgId].usd_24h_change||0,vol:d[cgId].usd_24h_vol||0,name:sym,src:'coingecko_map'};}
    const cc=await sf(`https://min-api.cryptocompare.com/data/price?fsym=${sym}&tsyms=USD`);
    if(cc?.USD>0){const ccf=await sf(`https://min-api.cryptocompare.com/data/pricemultifull?fsyms=${sym}&tsyms=USD`);return{price:cc.USD,change24h:+(ccf?.RAW?.[sym]?.USD?.CHANGEPCT24HOUR||0),vol:+(ccf?.RAW?.[sym]?.USD?.TOTALVOLUME24HTO||0),name:sym,src:'cryptocompare'};}
    const sr=await sf(`https://api.coingecko.com/api/v3/search?query=${sym}`);
    if(sr?.coins?.length>0){const exact=sr.coins.find(c=>(c.symbol||'').toUpperCase()===sym)||sr.coins[0];if(exact?.id){d=await sf(`https://api.coingecko.com/api/v3/simple/price?ids=${exact.id}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true`);if(d?.[exact.id]?.usd>0)return{price:d[exact.id].usd,change24h:d[exact.id].usd_24h_change||0,vol:d[exact.id].usd_24h_vol||0,name:exact.name||sym,src:'coingecko_search'};}}
    const cap=await sf(`https://api.coincap.io/v2/assets?search=${sym.toLowerCase()}&limit=5`);
    if(cap?.data?.length>0){const c=cap.data.find(x=>(x.symbol||'').toUpperCase()===sym)||cap.data[0];if(c&&+c.priceUsd>0)return{price:+c.priceUsd,change24h:+(c.changePercent24Hr||0),vol:+(c.volumeUsd24Hr||0),name:c.name||sym,src:'coincap'};}
    return null;
  }

  // ── FETCH DERIVATIVES DATA ────────────────────────────────────
  async function fetchDerivatives() {
    const [fundRes, oiRes, oiHistRes, lsRatioRes, topLSRes, bybitFundRes, bybitOIRes] = await Promise.allSettled([
      sf(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=${sym}USDT&limit=8`),
      sf(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${sym}USDT`),
      sf(`https://fapi.binance.com/futures/data/openInterestHist?symbol=${sym}USDT&period=1h&limit=48`),
      sf(`https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${sym}USDT&period=1h&limit=24`),
      sf(`https://fapi.binance.com/futures/data/topLongShortPositionRatio?symbol=${sym}USDT&period=1h&limit=24`),
      sf(`https://api.bybit.com/v5/market/funding/history?category=linear&symbol=${sym}USDT&limit=5`),
      sf(`https://api.bybit.com/v5/market/open-interest?category=linear&symbol=${sym}USDT&intervalTime=1h&limit=24`),
    ]);

    const result = { fundingRate: null, oi: null, oiHistory: [], lsRatio: null, topLS: null, sentiment: 'NEUTRAL', derivScore: 0, liquidationMap: null };

    // ── FUNDING RATE ──────────────────────────────────────────
    let fr = 0;
    if(fundRes.status==='fulfilled' && Array.isArray(fundRes.value) && fundRes.value.length>0) {
      fr = parseFloat(fundRes.value[fundRes.value.length-1].fundingRate) * 100;
      const frHistory = fundRes.value.map(f=>parseFloat(f.fundingRate)*100);
      const frAvg = frHistory.reduce((a,b)=>a+b,0)/frHistory.length;
      const frTrend = fr > frAvg ? 'INCREASING' : 'DECREASING';
      result.fundingRate = {
        current: +fr.toFixed(4), avg8: +frAvg.toFixed(4), trend: frTrend,
        annualized: +(fr * 3 * 365).toFixed(2),
        history: frHistory.slice(-8).map(f=>+f.toFixed(4)),
        interpretation: fr > 0.1 ? 'Sangat Positif — long overcrowded, potensi squeeze' :
          fr > 0.05 ? 'Positif — market bullish, moderat' :
          fr > 0.01 ? 'Sedikit Positif — normal bullish' :
          fr < -0.1 ? 'Sangat Negatif — short overcrowded, potensi short squeeze' :
          fr < -0.05 ? 'Negatif — market bearish, hati-hati long' :
          fr < -0.01 ? 'Sedikit Negatif — normal bearish' : 'Netral — tidak ada dominasi',
        signal: fr > 0.1 ? 'EXTREME_LONG' : fr > 0.05 ? 'LONG_HEAVY' : fr < -0.1 ? 'EXTREME_SHORT' : fr < -0.05 ? 'SHORT_HEAVY' : 'NEUTRAL',
        reverseSignal: fr > 0.08 ? '⚠️ Potensi Short Squeeze!' : fr < -0.08 ? '⚠️ Potensi Long Squeeze!' : null,
      };
    }

    // Bybit funding cross-validation
    if(bybitFundRes.status==='fulfilled' && bybitFundRes.value?.result?.list?.length>0) {
      const bybitFR = parseFloat(bybitFundRes.value.result.list[0].fundingRate||0)*100;
      if(result.fundingRate) {
        result.fundingRate.bybit = +bybitFR.toFixed(4);
        result.fundingRate.consensus = Math.abs(fr - bybitFR) < 0.05 ? 'ALIGNED' : 'DIVERGED';
      }
    }

    // ── OPEN INTEREST ─────────────────────────────────────────
    let oiVal = 0, oiUSD = 0;
    if(oiRes.status==='fulfilled' && oiRes.value?.openInterest) {
      oiVal = parseFloat(oiRes.value.openInterest);
    }

    // OI History analysis
    let oiChangePercent = 0, oiTrend = 'STABLE', oiSpike = false;
    if(oiHistRes.status==='fulfilled' && Array.isArray(oiHistRes.value) && oiHistRes.value.length>10) {
      const oiHist = oiHistRes.value.map(d=>parseFloat(d.sumOpenInterest));
      const oiLast = oiHist[oiHist.length-1];
      const oi6hAgo = oiHist[oiHist.length-6]||oiLast;
      const oi24hAgo = oiHist[0]||oiLast;
      oiChangePercent = oi6hAgo > 0 ? ((oiLast-oi6hAgo)/oi6hAgo*100) : 0;
      const oi24hChange = oi24hAgo > 0 ? ((oiLast-oi24hAgo)/oi24hAgo*100) : 0;
      oiSpike = Math.abs(oiChangePercent) > 10;

      // OI trend vs price direction = confirm or diverge
      const priceChange6h = 0; // would need 6h price, skip
      oiTrend = oiChangePercent > 5 ? 'INCREASING_FAST' : oiChangePercent > 2 ? 'INCREASING' : oiChangePercent < -5 ? 'DECREASING_FAST' : oiChangePercent < -2 ? 'DECREASING' : 'STABLE';

      result.oi = {
        current: oiLast,
        change6h: +oiChangePercent.toFixed(2),
        change24h: +oi24hChange.toFixed(2),
        trend: oiTrend, spike: oiSpike,
        history24h: oiHist.slice(-12).map(v=>+v.toFixed(0)),
        interpretation: oiSpike && fr > 0.05 ? 'OI naik + funding positif = LONG OVERCROWDED (waspadai squeeze)' :
          oiSpike && fr < -0.05 ? 'OI naik + funding negatif = SHORT OVERCROWDED (waspadai short squeeze)' :
          oiChangePercent > 5 ? 'OI meningkat — posisi baru masuk, momentum kuat' :
          oiChangePercent < -5 ? 'OI turun — posisi ditutup, konsolidasi atau reversal' :
          'OI stabil — tidak ada perubahan besar',
        signal: (oiChangePercent > 5 && fr > 0) ? 'BULL_CONFIRM' :
          (oiChangePercent > 5 && fr < 0) ? 'SQUEEZE_RISK' :
          (oiChangePercent < -5) ? 'DELEVERAGE' : 'NEUTRAL',
      };

      // Bybit OI cross-check
      if(bybitOIRes.status==='fulfilled' && bybitOIRes.value?.result?.list?.length>0) {
        const bybitOI = bybitOIRes.value.result.list;
        const bybitOILast = parseFloat(bybitOI[0]?.openInterest||0);
        const bybitOIPrev = parseFloat(bybitOI[5]?.openInterest||bybitOILast);
        const bybitOIChg = bybitOIPrev>0?(bybitOILast-bybitOIPrev)/bybitOIPrev*100:0;
        if(result.oi) { result.oi.bybit_change6h = +bybitOIChg.toFixed(2); result.oi.bybit_aligned = Math.abs(bybitOIChg-oiChangePercent)<5; }
      }
    }

    // ── LONG/SHORT RATIO ──────────────────────────────────────
    if(lsRatioRes.status==='fulfilled' && Array.isArray(lsRatioRes.value) && lsRatioRes.value.length>0) {
      const latest = lsRatioRes.value[lsRatioRes.value.length-1];
      const prev = lsRatioRes.value[lsRatioRes.value.length-5]||latest;
      const lsVal = parseFloat(latest.longShortRatio);
      const lsPrev = parseFloat(prev.longShortRatio);
      const lsTrend = lsVal > lsPrev ? 'MORE_LONGS' : 'MORE_SHORTS';
      const history = lsRatioRes.value.slice(-12).map(d=>parseFloat(d.longShortRatio));
      const lsAvg = history.reduce((a,b)=>a+b,0)/history.length;

      result.lsRatio = {
        current: +lsVal.toFixed(3), avg: +lsAvg.toFixed(3),
        longPct: latest.longAccount ? +(parseFloat(latest.longAccount)*100).toFixed(1) : +(lsVal/(1+lsVal)*100).toFixed(1),
        shortPct: +(100-(lsVal/(1+lsVal)*100)).toFixed(1),
        trend: lsTrend,
        interpretation: lsVal > 2 ? 'Long sangat dominan (>2:1) — contrarian signal BEARISH' :
          lsVal > 1.5 ? 'Long dominan — potensi squeeze short' :
          lsVal < 0.5 ? 'Short sangat dominan (<0.5) — contrarian signal BULLISH' :
          lsVal < 0.7 ? 'Short dominan — potensi short squeeze' :
          'Seimbang — tidak ada ekstremi',
        contrarian: lsVal > 2 ? 'BEARISH' : lsVal < 0.5 ? 'BULLISH' : 'NEUTRAL',
        history: history.map(v=>+v.toFixed(3)),
      };
    }

    // ── TOP TRADER L/S RATIO (Smart Money) ───────────────────
    if(topLSRes.status==='fulfilled' && Array.isArray(topLSRes.value) && topLSRes.value.length>0) {
      const tl = topLSRes.value[topLSRes.value.length-1];
      const topLSVal = parseFloat(tl.longShortRatio||1);
      result.topLS = {
        ratio: +topLSVal.toFixed(3),
        longPct: tl.longAccount ? +(parseFloat(tl.longAccount)*100).toFixed(1) : +(topLSVal/(1+topLSVal)*100).toFixed(1),
        interpretation: topLSVal > 1.5 ? 'Smart money LONG heavy — bullish signal' :
          topLSVal < 0.67 ? 'Smart money SHORT heavy — bearish signal' :
          'Smart money balanced',
        signal: topLSVal > 1.5 ? 'SMART_BULL' : topLSVal < 0.67 ? 'SMART_BEAR' : 'NEUTRAL',
      };
    }

    // ── OVERALL DERIVATIVES SENTIMENT ────────────────────────
    let derivScore = 0;
    if(result.fundingRate) {
      const fr2 = result.fundingRate.current;
      derivScore += fr2 < -0.05 ? 3 : fr2 < -0.02 ? 1 : fr2 > 0.1 ? -3 : fr2 > 0.05 ? -1 : 0;
    }
    if(result.oi) {
      derivScore += result.oi.signal === 'BULL_CONFIRM' ? 2 : result.oi.signal === 'DELEVERAGE' ? -2 : result.oi.signal === 'SQUEEZE_RISK' ? -1 : 0;
    }
    if(result.lsRatio) {
      derivScore += result.lsRatio.contrarian === 'BULLISH' ? 2 : result.lsRatio.contrarian === 'BEARISH' ? -2 : 0;
    }
    if(result.topLS) {
      derivScore += result.topLS.signal === 'SMART_BULL' ? 2 : result.topLS.signal === 'SMART_BEAR' ? -2 : 0;
    }
    result.derivScore = derivScore;
    result.sentiment = derivScore >= 4 ? 'STRONG_BULL' : derivScore >= 2 ? 'BULL' : derivScore <= -4 ? 'STRONG_BEAR' : derivScore <= -2 ? 'BEAR' : 'NEUTRAL';

    return result;
  }

  // ── MATH ──────────────────────────────────────────────────────
  const EMA=(c,p)=>{if(!c||c.length<p)return c?.[c.length-1]||0;const k=2/(p+1);let e=c.slice(0,p).reduce((a,b)=>a+b,0)/p;for(let i=p;i<c.length;i++)e=c[i]*k+e*(1-k);return e;};
  const RSI=(c,p=14)=>{if(!c||c.length<p+1)return 50;let g=0,l=0;for(let i=1;i<=p;i++){const d=c[i]-c[i-1];d>=0?g+=d:l-=d;}let ag=g/p,al=l/p;for(let i=p+1;i<c.length;i++){const d=c[i]-c[i-1];ag=(ag*(p-1)+(d>=0?d:0))/p;al=(al*(p-1)+(d<0?-d:0))/p;}return al===0?100:+((100-100/(1+ag/al)).toFixed(2));};
  const ATR=(K,p=14)=>{if(!K||K.length<2)return 0;const tr=K.slice(1).map((k,i)=>Math.max(k.h-k.l,Math.abs(k.h-K[i].c),Math.abs(k.l-K[i].c)));return tr.slice(-p).reduce((a,b)=>a+b,0)/Math.min(p,tr.length);};
  const BB=(c,p=20)=>{if(!c||c.length<p)return{upper:0,lower:0,mid:0,width:0,position:50,squeeze:false};const sl=c.slice(-p),m=sl.reduce((a,b)=>a+b,0)/p;const sd=Math.sqrt(sl.reduce((s,v)=>s+(v-m)**2,0)/p);const up=m+2*sd,dn=m-2*sd;return{upper:+up.toFixed(8),lower:+dn.toFixed(8),mid:+m.toFixed(8),width:+(sd>0?(4*sd/m)*100:0).toFixed(2),position:+(sd>0?((c[c.length-1]-dn)/(4*sd)*100):50).toFixed(1),squeeze:sd>0&&(4*sd/m)*100<3};};
  const MACD=(c)=>{if(!c||c.length<35)return{macd:0,signal:0,histogram:0,bullish:false,bearish:false,crossUp:false,crossDown:false};const k12=2/13,k26=2/27,k9=2/10;let e12=c.slice(0,12).reduce((a,b)=>a+b,0)/12,e26=c.slice(0,26).reduce((a,b)=>a+b,0)/26;const mv=[];for(let i=26;i<c.length;i++){e12=c[i]*k12+e12*(1-k12);e26=c[i]*k26+e26*(1-k26);mv.push(e12-e26);}let sig=mv.slice(0,9).reduce((a,b)=>a+b,0)/9;for(let i=9;i<mv.length;i++)sig=mv[i]*k9+sig*(1-k9);const ml=mv[mv.length-1],ph=mv[mv.length-2]||ml,hist=ml-sig,prevH=ph-sig;return{macd:+ml.toFixed(8),signal:+sig.toFixed(8),histogram:+hist.toFixed(8),bullish:ml>0&&hist>0,bearish:ml<0&&hist<0,crossUp:hist>0&&prevH<=0,crossDown:hist<0&&prevH>=0};};

  function fP(n){const v=parseFloat(n)||0;if(!v)return'—';if(v>=100000)return'$'+v.toLocaleString('id-ID',{maximumFractionDigits:0});if(v>=1000)return'$'+v.toLocaleString('id-ID',{minimumFractionDigits:2,maximumFractionDigits:2});if(v>=1)return'$'+v.toFixed(4);if(v>=0.001)return'$'+v.toFixed(6);return'$'+v.toFixed(8);}

  // ── MARKET STRUCTURE (BOS / CHoCH) ────────────────────────────
  function analyzeMarketStructure(K, price) {
    if(!K||K.length<30) return { bos: null, choch: null, trend: 'UNKNOWN', highs: [], lows: [], structure: 'Unknown' };

    // Find significant swing highs/lows
    const lb = Math.min(5, Math.floor(K.length/15));
    const swingH = [], swingL = [];
    for(let i=lb; i<K.length-lb; i++) {
      let isH=true, isL=true;
      for(let j=i-lb; j<=i+lb; j++) {
        if(j===i) continue;
        if(K[j].h>=K[i].h) isH=false;
        if(K[j].l<=K[i].l) isL=false;
      }
      if(isH) swingH.push({i, price:K[i].h, t:K[i].t});
      if(isL) swingL.push({i, price:K[i].l, t:K[i].t});
    }

    // Get last 4 swing points
    const last4H = swingH.slice(-4);
    const last4L = swingL.slice(-4);
    const lastH = last4H[last4H.length-1];
    const prevH = last4H[last4H.length-2];
    const lastL = last4L[last4L.length-1];
    const prevL = last4L[last4L.length-2];

    // BOS detection: price breaks above last swing high (bullish) or below last swing low (bearish)
    let bos = null, choch = null, msType = 'SIDEWAYS';
    const trendSeries = [];

    // Determine if HH-HL (uptrend) or LH-LL (downtrend)
    const isHH = lastH && prevH && lastH.price > prevH.price;
    const isHL = lastL && prevL && lastL.price > prevL.price;
    const isLH = lastH && prevH && lastH.price < prevH.price;
    const isLL = lastL && prevL && lastL.price < prevL.price;

    if(isHH && isHL) { msType = 'UPTREND (HH-HL)'; }
    else if(isLH && isLL) { msType = 'DOWNTREND (LH-LL)'; }
    else if(isHH && isLL) { msType = 'EXPANDING RANGE'; }
    else if(isLH && isHL) { msType = 'CONTRACTING RANGE'; }

    // BOS: current price breaks structure
    if(lastH && price > lastH.price * 1.001) {
      bos = { type: 'BULLISH', level: +lastH.price.toFixed(8), description: `BOS Bullish — breakout di atas swing high ${fP(lastH.price)}` };
    } else if(lastL && price < lastL.price * 0.999) {
      bos = { type: 'BEARISH', level: +lastL.price.toFixed(8), description: `BOS Bearish — breakdown di bawah swing low ${fP(lastL.price)}` };
    }

    // CHoCH: trend reversal signal
    if(msType.includes('DOWNTREND') && isHL) {
      choch = { type: 'BULLISH', description: `CHoCH Bullish — downtrend membentuk HL, karakter berubah naik` };
    } else if(msType.includes('UPTREND') && isLH) {
      choch = { type: 'BEARISH', description: `CHoCH Bearish — uptrend membentuk LH, karakter berubah turun` };
    }

    // Key levels from structure
    const structureHighs = last4H.map(h=>+h.price.toFixed(8));
    const structureLows = last4L.map(l=>+l.price.toFixed(8));

    return {
      bos, choch, structure: msType,
      trend: msType.includes('UPTREND')?'BULLISH':msType.includes('DOWNTREND')?'BEARISH':'NEUTRAL',
      highs: structureHighs, lows: structureLows,
      lastSwingHigh: lastH?.price || null, lastSwingLow: lastL?.price || null,
      prevSwingHigh: prevH?.price || null, prevSwingLow: prevL?.price || null,
    };
  }

  // ── SMC: ORDER BLOCK + FVG + LIQUIDITY ────────────────────────
  function analyzeSMC(K, price, ms) {
    if(!K||K.length<20) return { signal:'Neutral', bullOB:null, bearOB:null, bullFVG:null, bearFVG:null, liquiditySweep:null, premiumDiscount:'Equilibrium', summary:'Data tidak cukup' };

    const last = K.length-1;

    // ── ORDER BLOCKS ──────────────────────────────────────────
    // Bullish OB: last bearish candle before a bullish impulse that creates BOS
    let bullOB = null, bearOB = null;
    for(let i=Math.max(0,last-20); i<last; i++) {
      const c=K[i], n=K[i+1];
      if(!n) continue;
      // Bull OB: bearish candle (c<o), followed by strong bullish move
      if(c.c<c.o && n.c>n.o && n.c>c.h) {
        const obHigh = Math.max(c.o, c.c), obLow = c.l;
        // Is price currently at/near this OB?
        const atOB = price >= obLow * 0.998 && price <= obHigh * 1.002;
        if(!bullOB || (atOB && i > (bullOB._idx||0))) bullOB = { hi:+obHigh.toFixed(8), lo:+obLow.toFixed(8), atPrice:atOB, distance:+((price-obLow)/price*100).toFixed(2), _idx:i, description:`Bull OB: ${fP(obLow)}–${fP(obHigh)}${atOB?' ✅ Harga di OB!':''}` };
      }
      // Bear OB: bullish candle followed by strong bearish move
      if(c.c>c.o && n.c<n.o && n.c<c.l) {
        const obHigh = c.h, obLow = Math.min(c.o, c.c);
        const atOB = price >= obLow * 0.998 && price <= obHigh * 1.002;
        if(!bearOB || (atOB && i > (bearOB._idx||0))) bearOB = { hi:+obHigh.toFixed(8), lo:+obLow.toFixed(8), atPrice:atOB, distance:+((obHigh-price)/price*100).toFixed(2), _idx:i, description:`Bear OB: ${fP(obLow)}–${fP(obHigh)}${atOB?' ⚠️ Harga di Bear OB!':''}` };
      }
    }

    // ── FVG (FAIR VALUE GAPS) ─────────────────────────────────
    let bullFVG = null, bearFVG = null;
    const fvgs = [];
    for(let i=Math.max(1,last-25); i<last-1; i++) {
      // Bull FVG: gap between candle[i-1].high and candle[i+1].low
      if(K[i+1].l > K[i-1].h * 1.0005) {
        const fvgHi = K[i+1].l, fvgLo = K[i-1].h;
        const midFVG = (fvgHi+fvgLo)/2;
        const priceInFVG = price >= fvgLo && price <= fvgHi;
        const priceBelowFVG = price < fvgLo;
        const size = (fvgHi-fvgLo)/fvgLo*100;
        if(!bullFVG || priceInFVG || priceBelowFVG) bullFVG = { hi:+fvgHi.toFixed(8), lo:+fvgLo.toFixed(8), mid:+midFVG.toFixed(8), priceIn:priceInFVG, size:+size.toFixed(3), description:`Bull FVG ${fP(fvgLo)}–${fP(fvgHi)}${priceInFVG?' ✅ Harga dalam FVG!':priceBelowFVG?' (target pull-back)':''}` };
      }
      // Bear FVG: gap between candle[i-1].low and candle[i+1].high
      if(K[i+1].h < K[i-1].l * 0.9995) {
        const fvgHi = K[i-1].l, fvgLo = K[i+1].h;
        const priceInFVG = price >= fvgLo && price <= fvgHi;
        const priceAboveFVG = price > fvgHi;
        const size = (fvgHi-fvgLo)/fvgLo*100;
        if(!bearFVG || priceInFVG || priceAboveFVG) bearFVG = { hi:+fvgHi.toFixed(8), lo:+fvgLo.toFixed(8), priceIn:priceInFVG, size:+size.toFixed(3), description:`Bear FVG ${fP(fvgLo)}–${fP(fvgHi)}${priceInFVG?' ⚠️ Harga dalam Bear FVG!':priceAboveFVG?' (target pull-down)':''}` };
      }
    }

    // ── LIQUIDITY SWEEP ───────────────────────────────────────
    let liquiditySweep = null;
    // Equal highs/lows = liquidity pools
    const last20H = K.slice(-20).map(k=>k.h);
    const last20L = K.slice(-20).map(k=>k.l);
    const sortedH = [...last20H].sort((a,b)=>b-a);
    const sortedL = [...last20L].sort((a,b)=>a-b);
    // BSL = above recent highs (buy-side liquidity)
    const bsl = sortedH[2]; // 3rd highest = major BSL
    // SSL = below recent lows (sell-side liquidity)
    const ssl = sortedL[2]; // 3rd lowest = major SSL

    const lastCandle = K[last];
    if(lastCandle.h > bsl && lastCandle.c < bsl * 0.999) {
      liquiditySweep = { type:'BSL', level:+bsl.toFixed(8), description:`BSL Swept di ${fP(bsl)} — wick di atas high, potensi reversal turun`, direction:'BEARISH_AFTER_SWEEP' };
    } else if(lastCandle.l < ssl && lastCandle.c > ssl * 1.001) {
      liquiditySweep = { type:'SSL', level:+ssl.toFixed(8), description:`SSL Swept di ${fP(ssl)} — wick di bawah low, potensi reversal naik`, direction:'BULLISH_AFTER_SWEEP' };
    }

    // Upcoming liquidity levels (where price will likely be pulled)
    const bslTarget = sortedH[0]; // Highest high = major BSL target
    const sslTarget = sortedL[0]; // Lowest low = major SSL target
    const nearBSL = (bslTarget - price) / price * 100;
    const nearSSL = (price - sslTarget) / price * 100;

    // ── PREMIUM/DISCOUNT ZONE ─────────────────────────────────
    const sw50H = Math.max(...K.slice(-50).map(k=>k.h));
    const sw50L = Math.min(...K.slice(-50).map(k=>k.l));
    const equilibrium = (sw50H + sw50L) / 2;
    const premiumThresh = equilibrium + (sw50H - equilibrium) * 0.5;
    const discountThresh = equilibrium - (equilibrium - sw50L) * 0.5;
    const zone = price > premiumThresh ? '⚠️ Premium Zone (Sell Zone)' : price < discountThresh ? '✅ Discount Zone (Buy Zone)' : '⚖️ Equilibrium Zone';

    // ── SMC SIGNAL ────────────────────────────────────────────
    const bullCount = [ms.bos?.type==='BULLISH', ms.choch?.type==='BULLISH', bullOB?.atPrice, bullFVG?.priceIn, liquiditySweep?.direction==='BULLISH_AFTER_SWEEP'].filter(Boolean).length;
    const bearCount = [ms.bos?.type==='BEARISH', ms.choch?.type==='BEARISH', bearOB?.atPrice, bearFVG?.priceIn, liquiditySweep?.direction==='BEARISH_AFTER_SWEEP'].filter(Boolean).length;

    const signal = bullCount > bearCount ? 'Bullish' : bearCount > bullCount ? 'Bearish' : 'Neutral';
    const summary = `${ms.bos?.description||ms.choch?.description||ms.structure} | ${zone}`;

    return {
      signal, summary, bullOB, bearOB, bullFVG, bearFVG, liquiditySweep,
      bslTarget: +bslTarget.toFixed(8), sslTarget: +sslTarget.toFixed(8),
      bslDistance: +nearBSL.toFixed(2), sslDistance: +nearSSL.toFixed(2),
      premiumDiscount: zone, equilibrium: +equilibrium.toFixed(8),
      bsl: +bsl.toFixed(8), ssl: +ssl.toFixed(8),
    };
  }

  // ── ELLIOTT WAVE (with Fibonacci projections) ─────────────────
  function analyzeElliottWave(K, closes, price) {
    if(!K||K.length<20) return { wave:'Data Tidak Cukup', confidence:0, description:'', fibonacci:{}, targets:{} };
    const lb = Math.min(5, Math.floor(K.length/10));
    const swingH=[], swingL=[];
    for(let i=lb;i<K.length-lb;i++){
      let iH=true,iL=true;
      for(let j=i-lb;j<=i+lb;j++){if(j===i)continue;if(K[j].h>=K[i].h)iH=false;if(K[j].l<=K[i].l)iL=false;}
      if(iH)swingH.push({i,price:K[i].h});if(iL)swingL.push({i,price:K[i].l});
    }
    const lH=swingH[swingH.length-1]?.price||price*1.05;
    const pL=swingL[swingL.length-1]?.price||price*0.95;
    const pL2=swingL[swingL.length-2]?.price||pL*0.97;
    const lH2=swingH[swingH.length-2]?.price||lH*0.97;
    const range = lH-pL;
    const ret = range>0 ? (lH-price)/range : 0;
    const rsi = RSI(closes.slice(-50), 14);
    const macd = MACD(closes);

    // Fibonacci retracement levels (from pL to lH)
    const fib = {
      fib0:   +lH.toFixed(8),
      fib236: +(lH-range*0.236).toFixed(8),
      fib382: +(lH-range*0.382).toFixed(8),
      fib500: +(lH-range*0.5).toFixed(8),
      fib618: +(lH-range*0.618).toFixed(8),
      fib786: +(lH-range*0.786).toFixed(8),
      fib100: +pL.toFixed(8),
    };
    // Fibonacci extension targets (from pL upward)
    const targets = {
      ext127: +(pL+range*1.272).toFixed(8),
      ext161: +(pL+range*1.618).toFixed(8),
      ext200: +(pL+range*2.0).toFixed(8),
      ext261: +(pL+range*2.618).toFixed(8),
      ext423: +(pL+range*4.236).toFixed(8),
    };

    // Wave identification with confluence
    let wave, conf, desc, nextTarget, bearTarget;
    const volTrend = K.slice(-5).reduce((a,k)=>a+k.qv,0) > K.slice(-15,-5).reduce((a,k)=>a+k.qv,0)/2*5 ? 'EXPANDING' : 'CONTRACTING';

    if(price>lH*1.003&&volTrend==='EXPANDING') {
      wave='🚀 Wave 3 — Impulsif Kuat';conf=84;
      desc=`Breakout di atas swing high ${fP(lH)} dengan volume expansion — Wave 3 terkonfirmasi. Target: ${fP(targets.ext161)}-${fP(targets.ext261)}`;
      nextTarget=targets.ext161;
    } else if(ret>=0&&ret<=0.236&&rsi>55&&macd.bullish) {
      wave='⚡ Wave 3 Developing';conf=78;
      desc=`Retracement <23.6%, RSI ${rsi}, MACD bullish — Wave 3 momentum kuat. Target: ${fP(targets.ext127)}-${fP(targets.ext161)}`;
      nextTarget=targets.ext127;
    } else if(ret>0.236&&ret<=0.382&&rsi>48) {
      wave='📈 Wave 3 Entry Ideal';conf=76;
      desc=`Pull-back 23.6-38.2% ke zona ${fP(fib.fib382)} — entry Wave 3 terbaik. Target: ${fP(targets.ext127)}`;
      nextTarget=targets.ext127;
    } else if(ret>0.382&&ret<=0.5&&rsi>45) {
      wave='🔄 Wave 4 — Koreksi Normal';conf=70;
      desc=`Retracement 38.2-50%, Wave 4 dalam progress. Support: ${fP(fib.fib500)}. Setelah selesai → Wave 5 ke ${fP(targets.ext127)}`;
      nextTarget=targets.ext127; bearTarget=fib.fib618;
    } else if(ret>0.5&&ret<=0.618) {
      wave='⚠️ Deep Wave 4 / Wave 2';conf=63;
      desc=`Retracement 50-61.8% — koreksi dalam. Level kritis: ${fP(fib.fib618)}. Jika hold → potensi naik ke ${fP(targets.ext127)}`;
      nextTarget=targets.ext127; bearTarget=fib.fib786;
    } else if(ret>0.618&&ret<=0.786&&rsi<50) {
      wave='📉 Koreksi ABC / Wave C';conf=68;
      desc=`Retracement >61.8%, RSI ${rsi} <50 — wave koreksi aktif. Waspadai breakdown ${fP(fib.fib786)}`;
      bearTarget=fib.fib786;
    } else if(price<pL*0.997) {
      wave='💀 Impuls Bearish / Wave C Extension';conf=75;
      desc=`Breakdown di bawah struktur — wave bearish aktif. Target: ${fP(pL2)}`;
      bearTarget=pL2;
    } else if(ret<0.15&&rsi>72&&volTrend==='CONTRACTING') {
      wave='🏔️ Wave 5 — Puncak / Divergensi';conf=66;
      desc=`RSI ${rsi} tinggi, volume kontraksi — potensi akhir Wave 5. Waspadai reversal!`;
      bearTarget=fib.fib382;
    } else if(ret>0.236&&rsi<40&&macd.bearish) {
      wave='🔴 Wave C Bearish';conf=70;
      desc=`RSI ${rsi}, MACD bearish, retracement >23.6% — kemungkinan Wave C bearish`;
      bearTarget=fib.fib618;
    } else {
      wave='🌱 Wave 1/2 — Early Stage';conf=55;
      desc='Pola awal — konfirmasi diperlukan sebelum entry';
      nextTarget=lH;
    }

    return {
      wave, confidence:conf, description:desc,
      fibonacci:fib, targets,
      nextBullTarget:nextTarget?+nextTarget.toFixed(8):null,
      nextBearTarget:bearTarget?+bearTarget.toFixed(8):null,
      swingHigh:+lH.toFixed(8), swingLow:+pL.toFixed(8),
      retracePercent:+(ret*100).toFixed(1),
    };
  }

  // ── LIQUIDATION MAP ───────────────────────────────────────────
  function buildLiquidationMap(price, atr, ms, smc, derivatives) {
    if(!price||!atr) return null;

    // Key structural levels where longs/shorts cluster
    const swHigh = ms.lastSwingHigh||price*1.05;
    const swLow = ms.lastSwingLow||price*0.95;
    const pSwHigh = ms.prevSwingHigh||swHigh*1.03;
    const pSwLow = ms.prevSwingLow||swLow*0.97;

    // Long liquidation clusters (stops below support)
    const longLiqClusters = [
      { level: +(price - atr*1.5).toFixed(8), desc: 'Long stops di -1.5 ATR', type: 'LONG_LIQ', probability: 65 },
      { level: +(swLow * 0.998).toFixed(8), desc: `Long stops di bawah swing low ${fP(swLow)}`, type: 'LONG_LIQ', probability: 75 },
      { level: +(pSwLow * 0.997).toFixed(8), desc: `Long stops di bawah major low ${fP(pSwLow)}`, type: 'LONG_LIQ', probability: 55 },
    ].filter(c => c.level < price).sort((a,b) => b.level - a.level);

    // Short liquidation clusters (stops above resistance)
    const shortLiqClusters = [
      { level: +(price + atr*1.5).toFixed(8), desc: 'Short stops di +1.5 ATR', type: 'SHORT_LIQ', probability: 65 },
      { level: +(swHigh * 1.002).toFixed(8), desc: `Short stops di atas swing high ${fP(swHigh)}`, type: 'SHORT_LIQ', probability: 75 },
      { level: +(pSwHigh * 1.003).toFixed(8), desc: `Short stops di atas major high ${fP(pSwHigh)}`, type: 'SHORT_LIQ', probability: 55 },
    ].filter(c => c.level > price).sort((a,b) => a.level - b.level);

    // "Pain point" analysis based on derivatives
    let likelyTarget = null;
    if(derivatives?.lsRatio?.current > 1.5) {
      // More longs than shorts → whales likely hunt long stops below
      likelyTarget = { direction:'DOWN', level:longLiqClusters[0]?.level, reason:`L/S ratio tinggi (${derivatives.lsRatio.current}) — retail over-long, whale akan sweep long stops di ${fP(longLiqClusters[0]?.level)}` };
    } else if(derivatives?.lsRatio?.current < 0.7) {
      // More shorts → whales hunt short stops above
      likelyTarget = { direction:'UP', level:shortLiqClusters[0]?.level, reason:`L/S ratio rendah (${derivatives.lsRatio.current}) — retail over-short, whale sweep short stops di ${fP(shortLiqClusters[0]?.level)}` };
    } else if(smc?.bsl && Math.abs(smc.bsl - price) < Math.abs(smc.ssl - price)) {
      likelyTarget = { direction:'UP', level:+(smc.bsl*1.001).toFixed(8), reason:`BSL terdekat di ${fP(smc.bsl)} — lebih dekat dari SSL, kemungkinan sweep ke atas dulu` };
    } else if(smc?.ssl) {
      likelyTarget = { direction:'DOWN', level:+(smc.ssl*0.999).toFixed(8), reason:`SSL terdekat di ${fP(smc.ssl)} — whale sweep liquidity bawah sebelum naik` };
    }

    return {
      longLiquidations: longLiqClusters,
      shortLiquidations: shortLiqClusters,
      likelyHuntTarget: likelyTarget,
      painPointAnalysis: `${longLiqClusters.length} cluster long stops. ${shortLiqClusters.length} cluster short stops.`,
    };
  }

  // ── CANDLE PATTERNS ───────────────────────────────────────────
  function detectPatterns(K,price){
    if(!K||K.length<10)return[];
    const pts=[],l=K.length-1,lc=K[l],plc=K[l-1]||K[l];
    const body=Math.abs(lc.c-lc.o),range=lc.h-lc.l||0.000001;
    const lw=Math.min(lc.o,lc.c)-lc.l,uw=lc.h-Math.max(lc.o,lc.c);
    if(lw/range>0.55&&body/range<0.25&&lc.c>=lc.o)pts.push({name:'🔨 Hammer (Bullish)',signal:'bullish',probability:70});
    if(lw/range>0.55&&body/range<0.25&&lc.c<lc.o)pts.push({name:'🪝 Hanging Man (Bearish)',signal:'bearish',probability:65});
    if(uw/range>0.55&&body/range<0.25&&lc.c<=lc.o)pts.push({name:'🌠 Shooting Star (Bearish)',signal:'bearish',probability:68});
    if(uw/range>0.55&&body/range<0.25&&lc.c>lc.o)pts.push({name:'🔃 Inverted Hammer',signal:'bullish',probability:62});
    if(body/range<0.08)pts.push({name:'➕ Doji (Reversal?)',signal:'neutral',probability:50});
    if(lc.c>lc.o&&plc.c<plc.o&&lc.c>plc.o&&lc.o<plc.c)pts.push({name:'🟢 Bullish Engulfing',signal:'bullish',probability:76});
    if(lc.c<lc.o&&plc.c>plc.o&&lc.c<plc.o&&lc.o>plc.c)pts.push({name:'🔴 Bearish Engulfing',signal:'bearish',probability:74});
    if(body/range>0.75&&lc.c>lc.o)pts.push({name:'💪 Bullish Marubozu',signal:'bullish',probability:72});
    if(body/range>0.75&&lc.c<lc.o)pts.push({name:'💀 Bearish Marubozu',signal:'bearish',probability:72});
    if(K.length>=3){const c3=K[l-2];if(c3&&c3.c<c3.o&&plc.c<plc.o&&lc.c>lc.o&&lc.c>plc.h)pts.push({name:'🌅 Morning Star',signal:'bullish',probability:78});if(c3&&c3.c>c3.o&&plc.c>plc.o&&lc.c<lc.o&&lc.c<plc.l)pts.push({name:'🌃 Evening Star',signal:'bearish',probability:76});}
    return pts.slice(0,4);
  }

  // ── ASTROLOGY ─────────────────────────────────────────────────
  function calcAstro(){
    const jd=Date.now()/86400000+2440587.5;
    const dnm=((jd-2460320.5)%29.53058867+29.53058867)%29.53058867;
    const dsh=Math.floor((Date.now()-new Date('2024-04-20').getTime())/86400000);
    const now=new Date();
    // Mercury Retrograde
    const mrs=[{s:new Date('2025-03-15'),e:new Date('2025-04-07')},{s:new Date('2025-07-18'),e:new Date('2025-08-11')},{s:new Date('2025-11-09'),e:new Date('2025-12-01')},{s:new Date('2026-03-08'),e:new Date('2026-03-31')},{s:new Date('2026-07-06'),e:new Date('2026-07-30')},{s:new Date('2026-10-28'),e:new Date('2026-11-18')}];
    const inMR=mrs.some(p=>now>=p.s&&now<=p.e);
    const inMRShadow=mrs.some(p=>{const ps=new Date(p.s.getTime()-7*86400000);const pe=new Date(p.e.getTime()+7*86400000);return now>=ps&&now<=pe;});
    let mp,mi,interp,sig;
    if(dnm<1.5){mp='New Moon 🌑';mi=0;interp='New Moon — siklus baru, akumulasi';sig='🌑 New Cycle — Bullish Setup';}
    else if(dnm<7.5){mp='Waxing Crescent 🌒';mi=Math.round(dnm/29.53*100);interp='Waxing Crescent — momentum membangun';sig='🌒 Bullish Momentum';}
    else if(dnm<8.5){mp='First Quarter 🌓';mi=50;interp='First Quarter — uji resistance';sig='🌓 Testing Resistance';}
    else if(dnm<14){mp='Waxing Gibbous 🌔';mi=Math.round(dnm/29.53*100);interp='Waxing Gibbous — mendekati puncak';sig='🌔 Near Peak Energy';}
    else if(dnm<15.5){mp='Full Moon 🌕';mi=100;interp='Full Moon — volatilitas tinggi, reversal potensial';sig='🌕 FULL MOON — High Volatility';}
    else if(dnm<22){mp='Waning 🌖';mi=Math.round((29.53-dnm)/29.53*100);interp='Waning — distribusi, kurangi eksposur';sig='🌖 Distribution Phase';}
    else{mp='Dark Moon 🌘';mi=Math.round((29.53-dnm)/29.53*100);interp='Dark Moon — koreksi akhir, setup baru';sig='🌘 Final Correction';}
    const hp=dsh<90?'Post-Halving Early':dsh<365?'Bull Cycle Early ✅ (Best Buy Zone)':dsh<547?'Bull Cycle Peak ⚠️':dsh<730?'Distribution Phase ⚠️':'Bear Market (DCA Zone)';
    const month=now.getMonth()+1;
    const mb={1:'Jan(+)',2:'Feb(+)',3:'Mar(±)',4:'Apr(+)',5:'May(-)',6:'Jun(-)',7:'Jul(±)',8:'Aug(±)',9:'Sep(-2/worst)',10:'Oct(+2/best)',11:'Nov(+)',12:'Dec(+)'}[month]||'—';
    return{moonPhase:mp,illumination:mi,halvingPhase:hp,daysSinceHalving:dsh,signal:sig,interpretation:interp,monthBias:mb,inMercuryRetrograde:inMR,inMercuryShadow:inMRShadow,mercuryWarning:inMR?'⚠️ Mercury Retrograde — sinyal palsu tinggi, kurangi leverage':inMRShadow?'⚠️ Mercury Shadow — konfirmasi sinyal lebih ketat':null,daysSinceNM:+dnm.toFixed(1)};
  }

  // ── TIMEFRAME ANALYSIS ────────────────────────────────────────
  function analyzeTF(K, price, tfName) {
    if(!K||K.length<5) return { rsi:50, rsiLabel:'Insufficient', trend:'NEUTRAL', ema:{}, bb:{}, macd:{}, patterns:[], elliottWave:{wave:'—',confidence:0}, smc:{signal:'Neutral',summary:'—'}, ms:{structure:'Unknown'} };
    const closes=K.map(k=>k.c);
    const rsi=RSI(closes,14);
    const atr=ATR(K,14);
    const bb=BB(closes,Math.min(20,closes.length));
    const macd=MACD(closes);
    const ne=p=>Math.min(p,closes.length-1)||1;
    const e9=EMA(closes,ne(9)),e21=EMA(closes,ne(21)),e20=EMA(closes,ne(20));
    const e50=EMA(closes,ne(50)),e200=EMA(closes,ne(200));
    const ms=analyzeMarketStructure(K,price);
    const smc=analyzeSMC(K,price,ms);
    const ew=analyzeElliottWave(K,closes,price);
    const pats=detectPatterns(K,price);
    const ts=(price>e20?1:-1)+(price>e50?1:-1)+(price>e200?1:-1)+(macd.bullish?1:-1)+(rsi>50?.5:-.5);
    const trend=ts>=3?'BULLISH':ts>=1?'BULLISH_WEAK':ts<=-3?'BEARISH':ts<=-1?'BEARISH_WEAK':'NEUTRAL';
    const rsiLabel=rsi<20?'🔥 Extreme Oversold':rsi<30?'🟢 Oversold (Beli)':rsi<40?'📉 Bearish Zone':rsi<45?'⬇️ Below Neutral':rsi<55?'⚖️ Neutral':rsi<60?'⬆️ Above Neutral':rsi<70?'📈 Bullish Zone':rsi<80?'🔴 Overbought (Hati-hati)':'💥 Extreme Overbought';
    const volAvg=K.slice(-20).reduce((s,k)=>s+k.v,0)/20;
    const volLast=K[K.length-1]?.v||0;
    const volRatio=volAvg>0?+(volLast/volAvg).toFixed(2):1;
    return{rsi,rsiLabel,trend,atr:+atr.toFixed(8),ema:{e9:+e9.toFixed(8),e21:+e21.toFixed(8),e20:+e20.toFixed(8),e50:+e50.toFixed(8),e200:+e200.toFixed(8)},bb,macd,patterns:pats,elliottWave:ew,smc,ms,volRatio,volumes:{avg:+volAvg.toFixed(0),last:+volLast.toFixed(0),ratio:volRatio,expanding:volRatio>1.5}};
  }

  // ── CONFLUENCE SCORER (0-100) ─────────────────────────────────
  function calcConfluence(tf1h, tf4h, tf1d, deriv, ms4h, ew4h, smc4h) {
    let bullScore=0, bearScore=0;
    const max=100;

    // Multi-TF Trend (30pts)
    const tfW={'1h':8,'4h':12,'1d':10};
    const tfMap={BULLISH:1,BULLISH_WEAK:0.5,BEARISH:-1,BEARISH_WEAK:-0.5,NEUTRAL:0};
    for(const[tf,w] of [['1h',8],['4h',12],['1d',10]]) {
      const s={BULLISH:w,BULLISH_WEAK:w*0.5,BEARISH:-w,BEARISH_WEAK:-w*0.5,NEUTRAL:0};
      const trendScore=s[tf==='1h'?tf1h.trend:tf==='4h'?tf4h.trend:tf1d.trend]||0;
      if(trendScore>0) bullScore+=trendScore; else bearScore+=Math.abs(trendScore);
    }

    // RSI (15pts)
    const r=tf4h.rsi;
    if(r<25){bullScore+=14;}else if(r<30){bullScore+=11;}else if(r<40){bullScore+=6;}else if(r>80){bearScore+=14;}else if(r>70){bearScore+=11;}else if(r>60){bearScore+=5;}

    // MACD 4H (10pts)
    if(tf4h.macd.crossUp){bullScore+=10;}else if(tf4h.macd.crossDown){bearScore+=10;}else if(tf4h.macd.bullish){bullScore+=6;}else if(tf4h.macd.bearish){bearScore+=6;}

    // SMC 4H (15pts)
    if(smc4h.bullOB?.atPrice){bullScore+=8;}
    if(smc4h.bearOB?.atPrice){bearScore+=8;}
    if(smc4h.bullFVG?.priceIn){bullScore+=7;}
    if(smc4h.bearFVG?.priceIn){bearScore+=7;}
    if(ms4h.bos?.type==='BULLISH'){bullScore+=8;}else if(ms4h.bos?.type==='BEARISH'){bearScore+=8;}
    if(ms4h.choch?.type==='BULLISH'){bullScore+=5;}else if(ms4h.choch?.type==='BEARISH'){bearScore+=5;}
    if(smc4h.liquiditySweep?.direction==='BULLISH_AFTER_SWEEP'){bullScore+=6;}
    if(smc4h.liquiditySweep?.direction==='BEARISH_AFTER_SWEEP'){bearScore+=6;}

    // Elliott Wave (10pts)
    if(ew4h.wave?.includes('Wave 3')){bullScore+=10;}
    else if(ew4h.wave?.includes('Entry Ideal')){bullScore+=8;}
    else if(ew4h.wave?.includes('Koreksi Normal')){bullScore+=4;}
    else if(ew4h.wave?.includes('Bearish')||ew4h.wave?.includes('Wave C')){bearScore+=9;}
    else if(ew4h.wave?.includes('Puncak')){bearScore+=6;}

    // Derivatives (10pts)
    if(deriv?.sentiment==='STRONG_BULL'){bullScore+=9;}else if(deriv?.sentiment==='BULL'){bullScore+=6;}
    else if(deriv?.sentiment==='STRONG_BEAR'){bearScore+=9;}else if(deriv?.sentiment==='BEAR'){bearScore+=6;}
    // Funding rate contrarian
    if(deriv?.fundingRate?.signal==='EXTREME_LONG'){bearScore+=5;} // too many longs = bearish contrarian
    if(deriv?.fundingRate?.signal==='EXTREME_SHORT'){bullScore+=5;}
    // OI
    if(deriv?.oi?.signal==='BULL_CONFIRM'){bullScore+=4;}
    if(deriv?.oi?.signal==='DELEVERAGE'){bearScore+=3;}

    // Volume (5pts)
    if(tf4h.volumes?.expanding && tf4h.trend==='BULLISH'){bullScore+=5;}
    if(tf4h.volumes?.expanding && tf4h.trend==='BEARISH'){bearScore+=5;}

    // BB (5pts)
    if(tf4h.bb.position<20){bullScore+=4;}else if(tf4h.bb.position>80){bearScore+=4;}

    const total = bullScore + bearScore;
    const bullPct = total>0 ? Math.round(bullScore/total*100) : 50;
    const signal = bullPct>=75?'Strong Buy':bullPct>=60?'Buy':bullPct<=25?'Strong Sell':bullPct<=40?'Sell':'Neutral';
    const bias = bullPct>=60?'BULLISH':bullPct<=40?'BEARISH':'NEUTRAL';

    return { bullScore, bearScore, total, probability:bullPct, signal, bias, max:100 };
  }

  // ── MAIN ──────────────────────────────────────────────────────
  try {
    // Fetch everything in parallel
    const [tickerData, K1h, K4h_raw, K1d, derivData] = await Promise.all([
      fetchPrice(),
      fetchK('1h', 200),
      fetchK('4h', 200),
      fetchK('1d', 200),
      fetchDerivatives(),
    ]);

    if(!tickerData||tickerData.price<=0) {
      return res.status(404).json({ error:`Koin ${sym} tidak ditemukan. Coba: BTC, ETH, SOL, TRX, ADA, DOGE, PEPE, HYPE, SUI, ARB`, symbol:sym });
    }

    const price = tickerData.price;

    // Build 4H from 1H if needed
    const bld4h=K=>{const a=[];for(let i=0;i+3<K.length;i+=4){const sl=K.slice(i,i+4);a.push({t:sl[0].t,o:sl[0].o,h:Math.max(...sl.map(k=>k.h)),l:Math.min(...sl.map(k=>k.l)),c:sl[3].c,v:sl.reduce((s,k)=>s+k.v,0),qv:sl.reduce((s,k)=>s+k.qv,0)});}return a;};
    const K4h = K4h_raw.length>14 ? K4h_raw : (K1h.length>40 ? bld4h(K1h) : K1h);
    const K4hB = K4h.length>14 ? K4h : K1h;
    const K1dB = K1d.length>14 ? K1d : K4h;

    // Analyze all timeframes
    const tf1h = analyzeTF(K1h.length>14?K1h:[], price, '1H');
    const tf4h = analyzeTF(K4hB, price, '4H');
    const tf1d = analyzeTF(K1dB, price, '1D');
    const astro = calcAstro();
    const atr4h = ATR(K4hB, 14);

    // Get 4H specific analysis for main output
    const ms4h = tf4h.ms;
    const smc4h = tf4h.smc;
    const ew4h = tf4h.elliottWave;

    // Confluence scoring
    const confluence = calcConfluence(tf1h, tf4h, tf1d, derivData, ms4h, ew4h, smc4h);

    // Support/Resistance from multiple sources
    const allSupport = [smc4h.ssl, tf4h.ms.lastSwingLow, smc4h.bullOB?.lo, tf4h.bb?.lower, ew4h.fibonacci?.fib618].filter(v=>v&&v<price).sort((a,b)=>b-a);
    const allResistance = [smc4h.bsl, tf4h.ms.lastSwingHigh, smc4h.bearOB?.hi, tf4h.bb?.upper, ew4h.targets?.ext127].filter(v=>v&&v>price).sort((a,b)=>a-b);
    const support = allSupport[0] || price*0.95;
    const support2 = allSupport[1] || price*0.92;
    const support3 = allSupport[2] || price*0.88;
    const resistance = allResistance[0] || price*1.05;
    const resistance2 = allResistance[1] || price*1.10;
    const resistance3 = allResistance[2] || price*1.15;

    // Liquidation map
    const liqMap = buildLiquidationMap(price, atr4h, ms4h, smc4h, derivData);

    // Trade Setup (ATR-based + SMC levels)
    let tradeSetup = null;
    const action = confluence.signal;
    if(atr4h>0&&price>0) {
      const slDist = atr4h * 1.5;
      if(action.includes('Buy')||action==='BULLISH') {
        const slLevel = Math.max(price-slDist, support*0.996);
        const slActual = price-slLevel;
        const tp1 = price + slActual*2;
        const tp2 = ew4h.nextBullTarget || price + slActual*3.5;
        const tp3 = ew4h.targets?.ext161 || price + slActual*5.5;
        tradeSetup={direction:'LONG',entry:+price.toFixed(8),entryZone:`${fP(price*0.997)}–${fP(price*1.003)}`,sl:+slLevel.toFixed(8),slPct:+((price-slLevel)/price*100).toFixed(2),tp1:+tp1.toFixed(8),tp1Pct:+(slActual*2/price*100).toFixed(2),tp2:+tp2.toFixed(8),tp2Pct:+((tp2-price)/price*100).toFixed(2),tp3:+tp3.toFixed(8),tp3Pct:+((tp3-price)/price*100).toFixed(2),rr:+(slActual*2/slActual).toFixed(2),rr2:+((tp2-price)/(price-slLevel)).toFixed(2),rr3:+((tp3-price)/(price-slLevel)).toFixed(2),atr:+atr4h.toFixed(8),note:`SL=ATR×1.5 atau di bawah support ${fP(slLevel)}. TP1=1:2 | TP2 EW target | TP3 EW ext. Max risiko 1-2% kapital.`};
      } else if(action.includes('Sell')||action==='BEARISH') {
        const slLevel = Math.min(price+slDist, resistance*1.004);
        const slActual = slLevel-price;
        const tp1 = price - slActual*2;
        const tp2 = ew4h.nextBearTarget || price - slActual*3.5;
        const tp3 = ew4h.fibonacci?.fib786 || price - slActual*5.5;
        tradeSetup={direction:'SHORT',entry:+price.toFixed(8),entryZone:`${fP(price*0.997)}–${fP(price*1.003)}`,sl:+slLevel.toFixed(8),slPct:+(slActual/price*100).toFixed(2),tp1:+tp1.toFixed(8),tp1Pct:+(slActual*2/price*100).toFixed(2),tp2:+tp2.toFixed(8),tp2Pct:+((price-tp2)/price*100).toFixed(2),tp3:+tp3.toFixed(8),tp3Pct:+((price-tp3)/price*100).toFixed(2),rr:2,rr2:+((price-tp2)/slActual).toFixed(2),rr3:+((price-tp3)/slActual).toFixed(2),atr:+atr4h.toFixed(8),note:`SL=ATR×1.5 atau di atas resistance ${fP(slLevel)}. Short only dengan leverage rendah.`};
      }
    }

    // Build final reasons
    const reasons=[];
    if(ms4h.bos) reasons.push(`${ms4h.bos.description}`);
    if(ms4h.choch) reasons.push(`${ms4h.choch.description}`);
    if(smc4h.bullOB?.atPrice) reasons.push(`✅ Harga di Bull Order Block (${fP(smc4h.bullOB.lo)}–${fP(smc4h.bullOB.hi)})`);
    if(smc4h.bearOB?.atPrice) reasons.push(`⚠️ Harga di Bear Order Block (${fP(smc4h.bearOB.lo)}–${fP(smc4h.bearOB.hi)})`);
    if(smc4h.bullFVG?.priceIn) reasons.push(`✅ Harga dalam Bull FVG (${fP(smc4h.bullFVG.lo)}–${fP(smc4h.bullFVG.hi)})`);
    if(smc4h.liquiditySweep) reasons.push(`⚡ ${smc4h.liquiditySweep.description}`);
    if(ew4h.wave) reasons.push(`🌊 Elliott: ${ew4h.wave} — ${ew4h.description}`);
    if(tf4h.macd.crossUp) reasons.push('✅ MACD 4H Golden Cross terkonfirmasi');
    if(tf4h.macd.crossDown) reasons.push('❌ MACD 4H Death Cross terkonfirmasi');
    if(tf4h.rsi<30) reasons.push(`✅ RSI 4H oversold (${tf4h.rsi}) — zona beli institusional`);
    if(tf4h.rsi>70) reasons.push(`⚠️ RSI 4H overbought (${tf4h.rsi}) — risiko koreksi`);
    if(derivData?.fundingRate?.reverseSignal) reasons.push(derivData.fundingRate.reverseSignal);
    if(liqMap?.likelyHuntTarget) reasons.push(`🐋 ${liqMap.likelyHuntTarget.reason}`);
    if(astro.mercuryWarning) reasons.push(astro.mercuryWarning);

    res.setHeader('Cache-Control','s-maxage=30');
    return res.status(200).json({
      // Basic info
      symbol:sym, name:tickerData.name||sym,
      price, change24h:+tickerData.change24h.toFixed(4),
      volume24h:tickerData.vol||0, dataSource:tickerData.src,

      // Summary
      bias:confluence.bias,
      summary:{
        bias:confluence.bias,
        signal:confluence.signal,
        probability:confluence.probability,
        structure:ms4h.structure,
        bos:ms4h.bos?.description||null,
        choch:ms4h.choch?.description||null,
        elliottWave:ew4h.wave,
        derivativesSentiment:derivData?.sentiment||'NEUTRAL',
        oneLiner:`${confluence.bias}: ${confluence.signal} (${confluence.probability}%) — ${ew4h.wave||'Wave unclear'} | ${ms4h.bos?.type||ms4h.choch?.type||'No BOS'} | Deriv: ${derivData?.sentiment||'N/A'}`,
      },

      // Multi-TF analysis
      timeframes:{'1H':tf1h,'4H':tf4h,'1D':tf1d},

      // Market structure
      marketStructure:{
        '4H':ms4h, '1D':tf1d.ms,
        summary:ms4h.structure,
      },

      // SMC detailed
      smc:{'4H':smc4h, '1H':tf1h.smc, '1D':tf1d.smc},

      // Elliott Wave
      elliottWave:{'4H':ew4h,'1H':tf1h.elliottWave,'1D':tf1d.elliottWave},

      // Derivatives (REAL-TIME)
      derivatives:derivData,

      // Liquidation Map
      liquidationMap:liqMap,

      // Key levels (multi-source)
      keyLevels:{
        support:+support.toFixed(8), support2:+support2.toFixed(8), support3:+support3.toFixed(8),
        resistance:+resistance.toFixed(8), resistance2:+resistance2.toFixed(8), resistance3:+resistance3.toFixed(8),
        // Aliases for index.html
        sup:+support.toFixed(8), res:+resistance.toFixed(8),
      },

      // Confluence score
      confluence,

      // Recommendation
      recommendation:{
        action:confluence.signal.includes('Buy')?`🟢 ${confluence.signal}`:confluence.signal.includes('Sell')?`🔴 ${confluence.signal}`:`⚪ ${confluence.signal}`,
        explanation:`${confluence.bias} bias — ${confluence.probability}% confidence. ${ms4h.structure}. ${ew4h.wave}.`,
        score:confluence.probability,
        confidence:confluence.probability>=75?'Tinggi':confluence.probability>=60?'Sedang-Tinggi':confluence.probability>=50?'Sedang':'Rendah',
        reasons:reasons.slice(0,8),
      },

      // Trade Setup
      tradeSetup, atr4h:+atr4h.toFixed(8),

      // Astrology
      astrology:astro,

      // Support/Resistance aliases (for index.html compatibility)
      support:+support.toFixed(8), support2:+support2.toFixed(8),
      resistance:+resistance.toFixed(8), resistance2:+resistance2.toFixed(8),

      timestamp:Date.now(),
    });
  } catch(e) {
    return res.status(500).json({ error:e.message, symbol:sym });
  }
}
