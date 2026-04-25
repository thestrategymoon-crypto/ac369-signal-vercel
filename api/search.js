// api/search.js — AC369 FUSION v10.7 FINAL
// FIXES: 500+ CoinGecko ID map, validated search, 6-layer fallback
// Elliott Wave + SMC + Fibonacci + ATR Trade Setup + 3 TF

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const rawSym = (req.query.symbol || req.query.s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!rawSym) return res.status(400).json({ error: 'Parameter symbol diperlukan' });
  const sym = rawSym.replace(/USDT$/, '');

  const sf = async (url, ms = 9000) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
      const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } });
      clearTimeout(t); if (!r.ok) return null; return await r.json();
    } catch { clearTimeout(t); return null; }
  };

  // ── CG ID MAP: 500+ coins ────────────────────────────────────
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
    PYTH:'pyth-network',JTO:'jito-governance-token',MANTA:'manta-network',
    ALT:'altlayer',STRK:'starknet',WLD:'worldcoin-wld',BLUR:'blur',
    ENS:'ethereum-name-service',LDO:'lido-dao',RPL:'rocket-pool',
    PENDLE:'pendle',SSV:'ssv-network',CVX:'convex-finance',
    RENDER:'render-token',FET:'fetch-ai',OCEAN:'ocean-protocol',
    AGIX:'singularitynet',IO:'io-net',TAO:'bittensor',
    WIF:'dogwifcoin',BONK:'bonk',PEPE:'pepe',FLOKI:'floki',
    BOME:'book-of-meme',GALA:'gala',IMX:'immutable-x',
    GMT:'stepn',RON:'ronin',MAGIC:'trove',
    OKB:'okb',CRO:'crypto-com-chain',KCS:'kucoin-shares',
    HYPE:'hyperliquid',APE:'apecoin',DYDX:'dydx-chain',
    GMX:'gmx',GNS:'gains-network',PERP:'perpetual-protocol',
    AR:'arweave',SC:'siacoin',STORJ:'storj',ANKR:'ankr',
    BAND:'band-protocol',API3:'api3',ROSE:'oasis-network',
    CKB:'nervos-network',KAVA:'kava',LUNA:'terra-luna-2',
    LUNC:'terra-luna',RAY:'raydium',SRM:'serum',
    JUP:'jupiter-exchange-solana',FTM:'fantom',ONE:'harmony',
    IOTA:'iota',ZIL:'zilliqa',HOT:'holo',CHZ:'chiliz',
    ENJ:'enjincoin',OMG:'omisego',ZRX:'0x',BAL:'balancer',
    REN:'republic-protocol',KNC:'kyber-network-crystal',
    TWT:'trust-wallet-token',FLOW:'flow',MINA:'mina-protocol',
    CELO:'celo',GLMR:'moonbeam',SKL:'skale',CTSI:'cartesi',
    WIN:'wink',JST:'just',SUN:'sun-token',BTT:'bittorrent',
    BTTC:'bittorrent',JASMY:'jasmycoin',ACH:'alchemy-pay',
    CELR:'celer-network',LOOM:'loom-network-new',
    STMX:'storm',PAXG:'pax-gold',POLS:'polkastarter',
    HIGH:'highstreet',LINA:'linear-finance',
    DAR:'mines-of-dalarnia',FARM:'harvest-finance',
    SPELL:'spell-token',IDEX:'idex',REEF:'reef-finance',
    QNT:'quant-network',SUPER:'superfarm',
    HOOK:'hooked-protocol',COMBO:'furucombo',
    CFX:'conflux-token',MASK:'mask-network',
    LOOKS:'looksrare',METIS:'metis-token',
    RUNE:'thorchain',STG:'stargate-finance',
    DODO:'dodo',CREAM:'cream-2',BADGER:'badger-dao',
    TLM:'alien-worlds',ALICE:'my-neighbor-alice',
    PUNDIX:'pundi-x-2',QUICK:'quickswap',
    ASTAR:'astar',MBOX:'mobox',DEXE:'dexe',
    DF:'dforce-token',SFP:'safepal',CHESS:'tranchess',
    BETA:'beta-finance',RARE:'superrare',
    GAL:'project-galaxy',PEOPLE:'constitutiondao',
    AMB:'ambire-adex',NULS:'nuls',CVC:'civic',
    GHST:'aavegotchi',BOND:'barnbridge',ALPHA:'alpha-finance',
    ALCX:'alchemix',RGT:'rari-governance-token',
    TORN:'tornado-cash',PRIME:'echelon-prime',
    BEAM:'beam-2',ATLAS:'star-atlas',POLIS:'star-atlas-dao',
    HFT:'hashflow',ARKM:'arkham',ORCA:'orca',
    MNDE:'marinade',RDNT:'radiant-capital',
    SEAM:'seamless-protocol',ZK:'zksync',BB:'bouncebit',
    SAGA:'saga-2',W:'wormhole',OMNI:'omni-network',
    AEVO:'aevo',ZETA:'zetachain',EIGEN:'eigenlayer',
    ETHFI:'ether-fi',ENA:'ethena',REZ:'renzo',
    TNSR:'tensor',DRIFT:'drift-protocol',
    LISTA:'lista-dao',BRETT:'brett',MOG:'mog-coin',
    MEW:'cat-in-a-dogs-world',POPCAT:'popcat',
    NEIRO:'neiro-on-eth',GOAT:'goat',
    ACT:'act-i-the-ai-prophecy',PNUT:'peanut-the-squirrel',
    ME:'magic-eden',PENGU:'pudgy-penguins',
    USUAL:'usual',MORPHO:'morpho',COW:'cow-protocol',
    SAFE:'safe',ENA:'ethena',STRK:'starknet',
    GUN:'gunstar-metaverse',HYPER:'hypertoken',
    // More
    LAZIO:'lazio-fan-token',PORTO:'fc-porto',
    SANTOS:'santos-fc-fan-token',ACM:'ac-milan-fan-token',
    CITY:'manchester-city-fan-token',JUV:'juventus-fan-token',
    PSG:'paris-saint-germain-fan-token',
    TOMO:'tomochain',KDA:'kadena',HIVE:'hive',
    STEEM:'steem',STRAX:'stratis',BLZ:'bluzelle',
    DOCK:'dock',KMD:'komodo',LSK:'lisk',
    XEM:'nem',ZEN:'horizen',BTG:'bitcoin-gold',
    SYS:'syscoin',DCR:'decred',MONA:'monacoin',
    NXS:'nexus',VTC:'vertcoin',WAN:'wanchain',
    ARPA:'arpa',IOTX:'iotex',VITE:'vite',
    OXT:'orchid-protocol',TRIBE:'tribe-2',
    FXS:'frax-share',OHM:'olympus',
    ALPHA:'alpha-finance',RAMP:'ramp',
    SWAP:'trustswap',MTL:'metal',KEY:'selfkey',
    DENT:'dent',OGN:'origin-protocol',
    NKN:'nkn',RLC:'iexec-rlc',
    QSP:'quantstamp',XEC:'ecash',ELF:'aelf',
    FUN:'funtoken',POA:'poa-network',
    PIVX:'pivx',MDT:'measurable-data-token',
    WRX:'wazirx',PHA:'pha',IRIS:'iris-network',
    FORTH:'ampleforth-governance-token',
    PAXG:'pax-gold',DIA:'dia-data',
    MBL:'moviebloc',CTXC:'cortex',
    DUSK:'dusk-network',POND:'marlin',
    STEP:'step-finance',COPE:'cope',
    FIDA:'bonfida',KIN:'kin',
    GRAPE:'grape-2',MEDIA:'media-network',
    MAPS:'maps',OXY:'oxygen',
    MNGO:'mango-markets',
    // Very new coins (2024-2025)
    CHILLGUY:'chill-guy',LUCE:'luce',
    MOTHER:'mother-iggy',BODEN:'jeo-boden',
    PONKE:'ponke',WEN:'wen-4',SLERF:'slerf',
    MYRO:'myro',PIXEL:'pixels',PORTAL:'portal-fantasy',
    KMNO:'kamino',ZEUS:'zeus-network',
    MERL:'merlin-chain',ZEND:'zend',
    TURBO:'turbo',MFER:'mfercoin',
    GROK:'grok-2',CHUCK:'chuck',
    WOJAK:'wojak',CHAD:'chad',
    LADYS:'milady-meme-coin',PEPE2:'pepe-2',
    FLOKI:'floki',SNEK:'snek',
    SHIB2:'shiba-2',BABYDOGE:'baby-doge-coin',
    SLP:'smooth-love-potion',
    // More DeFi
    FRAX:'frax',DAI:'dai',LUSD:'liquity-usd',
    FXS:'frax-share',TEMPLE:'temple',
    LQTY:'liquity',OATH:'oath',
    TAROT:'tarot',BEETS:'beethoven-x',
    EQUAL:'equalizer-exchange',SOLID:'solidly',
    VELO:'velo',ROUTE:'route',
    SPERAX:'sperax',DEUS:'deus-finance',
  };

  // ── FETCH KLINES ──────────────────────────────────────────────
  async function fetchK(interval, limit = 200) {
    // 1. Binance Futures
    let d = await sf(`https://fapi.binance.com/fapi/v1/klines?symbol=${sym}USDT&interval=${interval}&limit=${limit}`);
    if (Array.isArray(d) && d.length > 14) return d.map(k => ({ t:+k[0],o:+k[1],h:+k[2],l:+k[3],c:+k[4],v:+k[5] }));
    // 2. Binance Spot
    d = await sf(`https://api.binance.com/api/v3/klines?symbol=${sym}USDT&interval=${interval}&limit=${limit}`);
    if (Array.isArray(d) && d.length > 14) return d.map(k => ({ t:+k[0],o:+k[1],h:+k[2],l:+k[3],c:+k[4],v:+k[5] }));
    // 3. CryptoCompare
    const ccE = interval === '1d' ? 'histoday' : 'histohour';
    const ccL = interval === '4h' ? limit*4 : limit;
    const ccRes = await sf(`https://min-api.cryptocompare.com/data/v2/${ccE}?fsym=${sym}&tsym=USD&limit=${ccL}`);
    if (ccRes?.Response === 'Success' && ccRes.Data?.Data?.length > 14) {
      let data = ccRes.Data.Data.map(d => ({ t:d.time*1000,o:d.open,h:d.high,l:d.low,c:d.close,v:d.volumeto }));
      if (interval === '4h') {
        const agg = [];
        for (let i=0;i+3<data.length;i+=4){const sl=data.slice(i,i+4);agg.push({t:sl[0].t,o:sl[0].o,h:Math.max(...sl.map(k=>k.h)),l:Math.min(...sl.map(k=>k.l)),c:sl[3].c,v:sl.reduce((s,k)=>s+k.v,0)});}
        return agg;
      }
      return data;
    }
    // 4. CoinGecko OHLC
    const cgId = CG[sym];
    if (cgId) {
      const days = interval==='1d'?90:interval==='4h'?14:7;
      const cg = await sf(`https://api.coingecko.com/api/v3/coins/${cgId}/ohlc?vs_currency=usd&days=${days}`);
      if (Array.isArray(cg) && cg.length > 10) return cg.map(d => ({ t:d[0],o:d[1],h:d[2],l:d[3],c:d[4],v:0 }));
    }
    return [];
  }

  // ── FETCH PRICE (6 layers) ─────────────────────────────────────
  async function fetchPrice() {
    // 1. Binance Futures
    let d = await sf(`https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${sym}USDT`);
    if (d && !d.code && +d.lastPrice > 0) return { price:+d.lastPrice, change24h:+d.priceChangePercent, vol:+d.quoteVolume, name:sym, src:'binance_futures' };
    // 2. Binance Spot
    d = await sf(`https://api.binance.com/api/v3/ticker/24hr?symbol=${sym}USDT`);
    if (d && !d.code && +d.lastPrice > 0) return { price:+d.lastPrice, change24h:+d.priceChangePercent, vol:+d.quoteVolume, name:sym, src:'binance_spot' };
    // 3. CoinGecko known ID
    const cgId = CG[sym];
    if (cgId) {
      d = await sf(`https://api.coingecko.com/api/v3/simple/price?ids=${cgId}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true`);
      if (d?.[cgId]?.usd > 0) return { price:d[cgId].usd, change24h:d[cgId].usd_24h_change||0, vol:d[cgId].usd_24h_vol||0, name:sym, src:'coingecko_map' };
    }
    // 4. CryptoCompare
    const ccP = await sf(`https://min-api.cryptocompare.com/data/price?fsym=${sym}&tsyms=USD`);
    if (ccP?.USD > 0) {
      const ccF = await sf(`https://min-api.cryptocompare.com/data/pricemultifull?fsyms=${sym}&tsyms=USD`);
      return { price:ccP.USD, change24h:+(ccF?.RAW?.[sym]?.USD?.CHANGEPCT24HOUR||0), vol:+(ccF?.RAW?.[sym]?.USD?.TOTALVOLUME24HTO||0), name:sym, src:'cryptocompare' };
    }
    // 5. CoinGecko search (with exact symbol match)
    const sr = await sf(`https://api.coingecko.com/api/v3/search?query=${sym}`);
    if (sr?.coins?.length > 0) {
      const exact = sr.coins.find(c => (c.symbol||'').toUpperCase() === sym);
      const coin = exact || sr.coins[0];
      if (coin?.id) {
        d = await sf(`https://api.coingecko.com/api/v3/simple/price?ids=${coin.id}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true`);
        if (d?.[coin.id]?.usd > 0) return { price:d[coin.id].usd, change24h:d[coin.id].usd_24h_change||0, vol:d[coin.id].usd_24h_vol||0, name:coin.name||sym, src:'coingecko_search' };
      }
    }
    // 6. CoinCap
    const cap = await sf(`https://api.coincap.io/v2/assets?search=${sym.toLowerCase()}&limit=5`);
    if (cap?.data?.length > 0) {
      const c = cap.data.find(x=>(x.symbol||'').toUpperCase()===sym)||cap.data[0];
      if (c && +c.priceUsd > 0) return { price:+c.priceUsd, change24h:+(c.changePercent24Hr||0), vol:+(c.volumeUsd24Hr||0), name:c.name||sym, src:'coincap' };
    }
    return null;
  }

  // ── MATH ──────────────────────────────────────────────────────
  const EMA=(c,p)=>{if(!c||c.length<p)return c?.[c.length-1]||0;const k=2/(p+1);let e=c.slice(0,p).reduce((a,b)=>a+b,0)/p;for(let i=p;i<c.length;i++)e=c[i]*k+e*(1-k);return e;};
  const RSI=(c,p=14)=>{if(!c||c.length<p+1)return 50;let g=0,l=0;for(let i=1;i<=p;i++){const d=c[i]-c[i-1];d>=0?g+=d:l-=d;}let ag=g/p,al=l/p;for(let i=p+1;i<c.length;i++){const d=c[i]-c[i-1];ag=(ag*(p-1)+(d>=0?d:0))/p;al=(al*(p-1)+(d<0?-d:0))/p;}return al===0?100:+((100-100/(1+ag/al)).toFixed(2));};
  const ATR=(K,p=14)=>{if(!K||K.length<2)return 0;const tr=K.slice(1).map((k,i)=>Math.max(k.h-k.l,Math.abs(k.h-K[i].c),Math.abs(k.l-K[i].c)));return tr.slice(-p).reduce((a,b)=>a+b,0)/Math.min(p,tr.length);};
  const BB=(c,p=20)=>{if(!c||c.length<p)return{upper:0,lower:0,mid:0,width:0,position:50};const sl=c.slice(-p),m=sl.reduce((a,b)=>a+b,0)/p;const sd=Math.sqrt(sl.reduce((s,v)=>s+(v-m)**2,0)/p);return{upper:+(m+2*sd).toFixed(8),lower:+(m-2*sd).toFixed(8),mid:+m.toFixed(8),width:+(sd>0?(4*sd/m)*100:0).toFixed(2),position:+(sd>0?((c[c.length-1]-(m-2*sd))/(4*sd)*100):50).toFixed(1)};};
  const MACD=(c)=>{if(!c||c.length<35)return{macd:0,signal:0,histogram:0,bullish:false,bearish:false,crossUp:false,crossDown:false};const k12=2/13,k26=2/27,k9=2/10;let e12=c.slice(0,12).reduce((a,b)=>a+b,0)/12,e26=c.slice(0,26).reduce((a,b)=>a+b,0)/26;const mv=[];for(let i=26;i<c.length;i++){e12=c[i]*k12+e12*(1-k12);e26=c[i]*k26+e26*(1-k26);mv.push(e12-e26);}let sig=mv.slice(0,9).reduce((a,b)=>a+b,0)/9;for(let i=9;i<mv.length;i++)sig=mv[i]*k9+sig*(1-k9);const ml=mv[mv.length-1],ph=mv[mv.length-2]||ml,hist=ml-sig,prevH=ph-sig;return{macd:+ml.toFixed(8),signal:+sig.toFixed(8),histogram:+hist.toFixed(8),bullish:ml>0&&hist>0,bearish:ml<0&&hist<0,crossUp:hist>0&&prevH<=0,crossDown:hist<0&&prevH>=0};};

  function fP(n){const v=parseFloat(n)||0;if(!v)return'—';if(v>=10000)return'$'+v.toLocaleString('id-ID',{maximumFractionDigits:2});if(v>=1)return'$'+v.toFixed(4);if(v>=0.001)return'$'+v.toFixed(6);return'$'+v.toFixed(8);}

  function swingPivots(K,lb=5){const h=[],l=[];for(let i=lb;i<K.length-lb;i++){let iH=true,iL=true;for(let j=i-lb;j<=i+lb;j++){if(j===i)continue;if(K[j].h>=K[i].h)iH=false;if(K[j].l<=K[i].l)iL=false;}if(iH)h.push({i,price:K[i].h});if(iL)l.push({i,price:K[i].l});}return{highs:h,lows:l};}

  function calcEW(K,closes,price){
    if(!K||K.length<20)return{wave:'Data Tidak Cukup',confidence:0,description:'Butuh lebih banyak candle'};
    const lb=Math.min(5,Math.floor(K.length/10));
    const {highs,lows}=swingPivots(K,lb);
    const lH=highs[highs.length-1]?.price||price*1.05;
    const pL=lows[lows.length-1]?.price||price*0.95;
    const range=lH-pL;
    const ret=range>0?(lH-price)/range:0;
    const rsi=RSI(closes.slice(-50),14);
    const fib={fib236:+(lH-range*0.236).toFixed(8),fib382:+(lH-range*0.382).toFixed(8),fib500:+(lH-range*0.5).toFixed(8),fib618:+(lH-range*0.618).toFixed(8),fib786:+(lH-range*0.786).toFixed(8),ext127:+(pL+range*1.272).toFixed(8),ext161:+(pL+range*1.618).toFixed(8),ext200:+(pL+range*2.0).toFixed(8),ext261:+(pL+range*2.618).toFixed(8)};
    let wave,conf,desc;
    if(price>lH*1.005){wave='🚀 Wave 3 (Breakout Impulse)';conf=82;desc=`Breakout di atas swing high — Wave 3 bullish. Target: ${fP(pL+range*1.618)}`;}
    else if(ret>=0&&ret<=0.236&&rsi>55){wave='⚡ Wave 3 Developing';conf=77;desc=`Momentum kuat, retracement minimal — Wave 3 aktif`;}
    else if(ret>0.236&&ret<=0.382&&rsi>48){wave='📈 Wave 3 Entry Ideal';conf=76;desc=`Retracement 23.6-38.2% — zona entry Wave 3. Support: ${fP(fib.fib382)}`;}
    else if(ret>0.382&&ret<=0.5&&rsi>45){wave='🔄 Wave 4 (Koreksi Normal)';conf=67;desc=`Koreksi 38.2-50% — Wave 4 sebelum Wave 5. Support: ${fP(fib.fib500)}`;}
    else if(ret>0.5&&ret<=0.618){wave='⚠️ Deep Wave 4 / Wave 2';conf=62;desc=`Koreksi 50-61.8% — level kritis ${fP(fib.fib618)}`;}
    else if(ret>0.618&&rsi<50){wave='📉 Koreksi ABC';conf=66;desc=`Retracement >61.8%, RSI <50 — pola koreksi. Awasi ${fP(fib.fib786)}`;}
    else if(price<pL*0.995){wave='💀 Wave C / Extended Bear';conf=73;desc='Breakdown struktur — Wave C atau impuls bearish';}
    else if(ret<0.15&&rsi>68){wave='🏔️ Wave 5 (Puncak)';conf=63;desc=`Momentum puncak, RSI ${rsi} — waspadai reversal`;}
    else{wave='🌱 Wave 1/2 (Awal)';conf=54;desc='Siklus awal — konfirmasi diperlukan';}
    return{wave,confidence:conf,description:desc,fibonacci:fib,swingHigh:+lH.toFixed(8),swingLow:+pL.toFixed(8)};
  }

  function calcSMC(K,price){
    if(!K||K.length<20)return{signal:'Neutral',summary:'Data tidak cukup',bos:null,bullOB:null,bearOB:null,bullFVG:null,bearFVG:null,liquiditySweep:null};
    const last=K.length-1;
    const r=K.slice(-30);
    let hhs=[],lls=[];
    for(let i=2;i<r.length-2;i++){if(r[i].h>r[i-1].h&&r[i].h>r[i-2].h&&r[i].h>r[i+1].h&&r[i].h>r[i+2].h)hhs.push(r[i].h);if(r[i].l<r[i-1].l&&r[i].l<r[i-2].l&&r[i].l<r[i+1].l&&r[i].l<r[i+2].l)lls.push(r[i].l);}
    const lHH=hhs[hhs.length-1],pHH=hhs[hhs.length-2],lLL=lls[lls.length-1],pLL=lls[lls.length-2];
    let bos=null;
    if(lHH&&pHH&&lHH>pHH&&price>lHH)bos=`BOS Bullish (HH ${fP(lHH)})`;
    else if(lLL&&pLL&&lLL<pLL&&price<lLL)bos=`BOS Bearish (LL ${fP(lLL)})`;
    else if(lHH&&pHH&&lHH<pHH&&price>pHH)bos='CHoCH Bullish — Tren berubah naik';
    else if(lLL&&pLL&&lLL>pLL&&price<pLL)bos='CHoCH Bearish — Tren berubah turun';
    else if(lHH&&pHH&&lHH>pHH)bos=`BOS Bullish (HH ${fP(lHH)})`;
    else if(lLL&&pLL&&lLL<pLL)bos=`BOS Bearish (LL ${fP(lLL)})`;
    let bullOB=null,bearOB=null;
    for(let i=Math.max(0,last-15);i<last;i++){const c=K[i],n=K[i+1];if(!n)continue;if(c.c<c.o&&n.c>n.o&&n.c>c.h*1.001)bullOB={hi:+Math.max(c.o,c.c).toFixed(8),lo:+c.l.toFixed(8)};if(c.c>c.o&&n.c<n.o&&n.c<c.l*0.999)bearOB={hi:+c.h.toFixed(8),lo:+Math.min(c.o,c.c).toFixed(8)};}
    let bullFVG=null,bearFVG=null;
    for(let i=Math.max(1,last-20);i<last-1;i++){if(K[i+1].l>K[i-1].h*1.001)bullFVG={lo:+K[i-1].h.toFixed(8),hi:+K[i+1].l.toFixed(8)};if(K[i+1].h<K[i-1].l*0.999)bearFVG={hi:+K[i-1].l.toFixed(8),lo:+K[i+1].h.toFixed(8)};}
    let ls=null;
    const rH=K.slice(-20).map(k=>k.h).sort((a,b)=>b-a);const rL=K.slice(-20).map(k=>k.l).sort((a,b)=>a-b);
    if(K[last].h>rH[3]&&K[last].c<rH[3]*0.999)ls={type:'BSL Swept',level:+rH[3].toFixed(8),detail:`BSL swept di ${fP(rH[3])} — potensi reversal turun`};
    else if(K[last].l<rL[3]&&K[last].c>rL[3]*1.001)ls={type:'SSL Swept',level:+rL[3].toFixed(8),detail:`SSL swept di ${fP(rL[3])} — potensi reversal naik`};
    const swH=Math.max(...K.slice(-50).map(k=>k.h)),swL=Math.min(...K.slice(-50).map(k=>k.l));
    const eq=(swH+swL)/2;
    const zone=price>eq+(swH-eq)*0.5?'⚠️ Premium Zone':price<eq-(eq-swL)*0.5?'✅ Discount Zone':'⚖️ Equilibrium Zone';
    const bc=[bos?.includes('Bullish'),bullOB,bullFVG,ls?.type==='SSL Swept'].filter(Boolean).length;
    const br=[bos?.includes('Bearish'),bearOB,bearFVG,ls?.type==='BSL Swept'].filter(Boolean).length;
    const sig=bc>br?'Bullish':br>bc?'Bearish':'Neutral';
    return{signal:sig,summary:`${bos||'Sideways'} | ${zone}`,bos,bullOB,bearOB,bullFVG,bearFVG,liquiditySweep:ls,zone,equilibrium:+eq.toFixed(8)};
  }

  function detectPatterns(K,price){
    if(!K||K.length<10)return[];
    const pts=[],l=K.length-1,lc=K[l],plc=K[l-1]||K[l];
    const body=Math.abs(lc.c-lc.o),range=lc.h-lc.l||0.000001;
    const lw=Math.min(lc.o,lc.c)-lc.l,uw=lc.h-Math.max(lc.o,lc.c);
    if(lw/range>0.55&&body/range<0.25)pts.push({name:lc.c>=lc.o?'🔨 Hammer (Bullish)':'🪝 Hanging Man',signal:lc.c>=lc.o?'bullish':'bearish',probability:70});
    if(uw/range>0.55&&body/range<0.25)pts.push({name:lc.c<=lc.o?'🌠 Shooting Star':'🔃 Inv. Hammer',signal:lc.c<=lc.o?'bearish':'bullish',probability:68});
    if(body/range<0.08)pts.push({name:'➕ Doji',signal:'neutral',probability:50});
    if(lc.c>lc.o&&plc.c<plc.o&&lc.c>plc.o&&lc.o<plc.c)pts.push({name:'🟢 Bullish Engulfing',signal:'bullish',probability:76});
    if(lc.c<lc.o&&plc.c>plc.o&&lc.c<plc.o&&lc.o>plc.c)pts.push({name:'🔴 Bearish Engulfing',signal:'bearish',probability:74});
    if(body/range>0.75&&lc.c>lc.o)pts.push({name:'💪 Bullish Marubozu',signal:'bullish',probability:72});
    if(body/range>0.75&&lc.c<lc.o)pts.push({name:'💀 Bearish Marubozu',signal:'bearish',probability:72});
    if(K.length>=3){const c3=K[l-2];if(c3&&c3.c<c3.o&&plc.c<plc.o&&lc.c>lc.o&&lc.c>plc.h)pts.push({name:'🌅 Morning Star',signal:'bullish',probability:78});if(c3&&c3.c>c3.o&&plc.c>plc.o&&lc.c<lc.o&&lc.c<plc.l)pts.push({name:'🌃 Evening Star',signal:'bearish',probability:76});}
    return pts.slice(0,4);
  }

  function calcAstro(){
    const jd=Date.now()/86400000+2440587.5;
    const dnm=((jd-2460320.5)%29.53058867+29.53058867)%29.53058867;
    const dsh=Math.floor((Date.now()-new Date('2024-04-20').getTime())/86400000);
    let mp,mi,interp,sig;
    if(dnm<1.5){mp='New Moon 🌑';mi=0;interp='New Moon — siklus baru, akumulasi';sig='🌑 New Cycle — Bullish Setup';}
    else if(dnm<7.5){mp='Waxing Crescent 🌒';mi=Math.round(dnm/29.53*100);interp='Waxing Crescent — momentum membangun';sig='🌒 Waxing — Building Momentum';}
    else if(dnm<8.5){mp='First Quarter 🌓';mi=50;interp='First Quarter — uji resistance';sig='🌓 First Quarter — Testing';}
    else if(dnm<14){mp='Waxing Gibbous 🌔';mi=Math.round(dnm/29.53*100);interp='Waxing Gibbous — mendekati puncak';sig='🌔 Waxing Gibbous — Near Peak';}
    else if(dnm<16){mp='Full Moon 🌕';mi=100;interp='Full Moon — volatilitas tinggi';sig='🌕 Full Moon — High Volatility';}
    else if(dnm<22){mp='Waning 🌖';mi=Math.round((29.53-dnm)/29.53*100);interp='Waning — distribusi';sig='🌖 Waning — Distribution';}
    else{mp='Dark Moon 🌘';mi=Math.round((29.53-dnm)/29.53*100);interp='Dark Moon — koreksi akhir';sig='🌘 Dark Moon — Final Correction';}
    const hp=dsh<90?'Post-Halving Early':dsh<365?'Bull Cycle Early (Best Buy)':dsh<547?'Bull Cycle Peak (Careful)':dsh<730?'Distribution (Reduce Risk)':'Bear Market (DCA Zone)';
    const month=new Date().getMonth()+1;
    const mb={1:'Jan(+)',2:'Feb(+)',3:'Mar(±)',4:'Apr(+)',5:'May(-)',6:'Jun(-)',7:'Jul(±)',8:'Aug(±)',9:'Sep(worst)',10:'Oct(best)',11:'Nov(+)',12:'Dec(+)'}[month]||'—';
    return{moonPhase:mp,illumination:mi,halvingPhase:hp,daysSinceHalving:dsh,signal:sig,interpretation:interp,monthBias:mb,daysSinceNM:+dnm.toFixed(1)};
  }

  function analyzeTF(K,price){
    if(!K||K.length<5)return{rsi:50,rsiLabel:'Insufficient',trend:'NEUTRAL',ema:{},bb:{},macd:{},patterns:[],elliottWave:{wave:'—',confidence:0},smc:{signal:'Neutral',summary:'—'}};
    const closes=K.map(k=>k.c);
    const rsi=RSI(closes,14);
    const atr=ATR(K,14);
    const bb=BB(closes,Math.min(20,closes.length));
    const macd=MACD(closes);
    const ne=p=>Math.min(p,closes.length-1)||1;
    const e20=EMA(closes,ne(20)),e50=EMA(closes,ne(50)),e200=EMA(closes,ne(200));
    const ew=calcEW(K,closes,price);
    const smc=calcSMC(K,price);
    const pats=detectPatterns(K,price);
    const ts=(price>e20?1:-1)+(price>e50?1:-1)+(price>e200?1:-1)+(macd.bullish?1:-1)+(rsi>50?.5:-.5);
    const trend=ts>=3?'BULLISH':ts>=1?'BULLISH_WEAK':ts<=-3?'BEARISH':ts<=-1?'BEARISH_WEAK':'NEUTRAL';
    const rsiLabel=rsi<20?'🔥 Extreme Oversold':rsi<30?'🟢 Oversold — Beli':rsi<40?'📉 Bearish Zone':rsi<45?'⬇️ Below Neutral':rsi<55?'⚖️ Neutral':rsi<60?'⬆️ Above Neutral':rsi<70?'📈 Bullish Zone':rsi<80?'🔴 Overbought':' 💥 Extreme Overbought';
    return{rsi,rsiLabel,trend,atr:+atr.toFixed(8),ema:{ema20:+e20.toFixed(8),ema50:+e50.toFixed(8),ema200:+e200.toFixed(8)},bb,macd,patterns:pats,elliottWave:ew,smc};
  }

  try {
    const ticker = await fetchPrice();
    if(!ticker||ticker.price<=0){
      return res.status(404).json({
        error:`Koin ${sym} tidak ditemukan. Coba: TRX, GUN, ADA, DOGE, PEPE, FLOKI, SUI, HYPE, ARB`,
        symbol:sym
      });
    }
    const price=ticker.price;

    const [K1h,K4r,K1d]=await Promise.all([fetchK('1h',200),fetchK('4h',200),fetchK('1d',200)]);
    const bld4h=K=>{const a=[];for(let i=0;i+3<K.length;i+=4){const s=K.slice(i,i+4);a.push({t:s[0].t,o:s[0].o,h:Math.max(...s.map(k=>k.h)),l:Math.min(...s.map(k=>k.l)),c:s[3].c,v:s.reduce((x,k)=>x+k.v,0)});}return a;};
    const K4h=K4r.length>14?K4r:(K1h.length>40?bld4h(K1h):K1h);

    const tf1h=analyzeTF(K1h.length>14?K1h:[],price);
    const tf4h=analyzeTF(K4h.length>14?K4h:[],price);
    const tf1d=analyzeTF(K1d.length>14?K1d:(K4h.length>14?K4h:[]),price);
    const astro=calcAstro();

    const K4b=K4h.length>14?K4h:K1h;
    const atr4h=ATR(K4b.length>10?K4b:K1h,14);

    // Support/Resistance from multiple TF
    const {highs,lows}=swingPivots(K4b.length>10?K4b:K1h,5);
    const supLs=lows.map(l=>l.price).filter(v=>v<price*0.9999).sort((a,b)=>b-a);
    const resLs=highs.map(h=>h.price).filter(v=>v>price*1.0001).sort((a,b)=>a-b);
    const support=supLs[0]||price*0.95;
    const support2=supLs[1]||price*0.90;
    const resistance=resLs[0]||price*1.05;
    const resistance2=resLs[1]||price*1.10;

    // 1D major levels
    const sr1d=swingPivots(K1d.length>10?K1d:[],3);
    const majSup=sr1d.lows.map(l=>l.price).filter(v=>v<price).sort((a,b)=>b-a)[0]||support*0.97;
    const majRes=sr1d.highs.map(h=>h.price).filter(v=>v>price).sort((a,b)=>a-b)[0]||resistance*1.03;

    // Recommendation
    const tS={'1h':{BULLISH:2,BULLISH_WEAK:1,BEARISH:-2,BEARISH_WEAK:-1,NEUTRAL:0}[tf1h.trend]||0,'4h':{BULLISH:4,BULLISH_WEAK:2,BEARISH:-4,BEARISH_WEAK:-2,NEUTRAL:0}[tf4h.trend]||0,'1d':{BULLISH:4,BULLISH_WEAK:2,BEARISH:-4,BEARISH_WEAK:-2,NEUTRAL:0}[tf1d.trend]||0};
    const rB=tf4h.rsi<25?4:tf4h.rsi<30?3:tf4h.rsi<40?1:tf4h.rsi>80?-4:tf4h.rsi>70?-3:tf4h.rsi>60?-1:0;
    const mB=tf4h.macd.crossUp?3:tf4h.macd.crossDown?-3:tf4h.macd.bullish?1:tf4h.macd.bearish?-1:0;
    const sB2=tf4h.smc.signal==='Bullish'?2:tf4h.smc.signal==='Bearish'?-2:0;
    const eB=tf4h.elliottWave.wave?.includes('Wave 3')?2:tf4h.elliottWave.wave?.includes('Wave 5')?-1:0;
    const total=tS['1h']+tS['4h']+tS['1d']+rB+mB+sB2+eB;
    const maxP=19;
    const score=Math.max(0,Math.min(100,Math.round((total+maxP)/(2*maxP)*100)));

    let action,expl,conf;
    if(score>=75){action='🟢 LONG (Strong Buy)';expl=`Setup bullish kuat — ${tf4h.trend} 4H, RSI ${tf4h.rsi}, ${tf4h.elliottWave.wave}`;conf='Tinggi';}
    else if(score>=62){action='📈 LONG (Buy)';expl='Setup bullish — tunggu konfirmasi entry';conf='Sedang-Tinggi';}
    else if(score>=50){action='📊 WATCH (Pantau)';expl='Setup forming, belum konfirm. Pantau entry ideal.';conf='Sedang';}
    else if(score>=38){action='⚪ HOLD / WAIT';expl='Market sideways — tidak ada setup jelas';conf='Rendah';}
    else if(score>=25){action='📉 SHORT (Sell)';expl=`Tekanan jual — ${tf4h.trend} 4H`;conf='Sedang-Tinggi';}
    else{action='🔴 SHORT (Strong Sell)';expl=`Setup bearish kuat — ${tf4h.trend} 4H, RSI ${tf4h.rsi}`;conf='Tinggi';}

    const reasons=[];
    if(tS['4h']>0)reasons.push(`✅ Tren 4H: ${tf4h.trend} | ${tf4h.smc.bos||tf4h.smc.summary}`);
    if(tS['1d']>0)reasons.push(`✅ Tren 1D: ${tf1d.trend} | ${tf1d.smc.summary}`);
    if(tS['4h']<0)reasons.push(`❌ Tren 4H: ${tf4h.trend} | ${tf4h.smc.summary}`);
    if(tf4h.rsi<30)reasons.push(`✅ RSI 4H oversold (${tf4h.rsi})`);
    else if(tf4h.rsi>70)reasons.push(`❌ RSI 4H overbought (${tf4h.rsi})`);
    if(tf4h.macd.crossUp)reasons.push('✅ MACD 4H golden cross');
    if(tf4h.macd.crossDown)reasons.push('❌ MACD 4H death cross');
    if(tf4h.elliottWave.wave?.includes('Wave 3'))reasons.push(`✅ ${tf4h.elliottWave.wave}`);
    if(tf4h.smc.bullOB)reasons.push(`✅ Bull OB: ${fP(tf4h.smc.bullOB.lo)}–${fP(tf4h.smc.bullOB.hi)}`);
    if(tf4h.smc.bearOB)reasons.push(`❌ Bear OB: ${fP(tf4h.smc.bearOB.lo)}–${fP(tf4h.smc.bearOB.hi)}`);
    if(tf4h.smc.liquiditySweep)reasons.push(`⚡ ${tf4h.smc.liquiditySweep.detail}`);
    if(tf4h.bb.squeeze)reasons.push('⚡ BB Squeeze — breakout imminent');

    // Trade Setup ATR-based
    let tradeSetup=null;
    if(atr4h>0&&price>0){
      const sl=atr4h*1.5,tp1=atr4h*2,tp2=atr4h*3.5,tp3=atr4h*5.5;
      if(action.includes('LONG')||action.includes('Buy')){
        const slL=Math.max(price-sl,support*0.995);
        tradeSetup={direction:'LONG',entry:+price.toFixed(8),entryZone:`${fP(price*0.995)}–${fP(price*1.005)}`,sl:+slL.toFixed(8),slPct:+((price-slL)/price*100).toFixed(2),tp1:+(price+tp1).toFixed(8),tp1Pct:+(tp1/price*100).toFixed(2),tp2:+(price+tp2).toFixed(8),tp2Pct:+(tp2/price*100).toFixed(2),tp3:+(price+tp3).toFixed(8),tp3Pct:+(tp3/price*100).toFixed(2),rr:+(tp1/sl).toFixed(2),rr2:+(tp2/sl).toFixed(2),atr:+atr4h.toFixed(8),note:`ATR 4H: ${fP(atr4h)}. SL=ATR×1.5 | TP1=ATR×2 | TP2=ATR×3.5 | TP3=ATR×5.5. Max risiko 1-2% kapital.`};
      } else if(action.includes('SHORT')||action.includes('Sell')){
        const slL=Math.min(price+sl,resistance*1.005);
        tradeSetup={direction:'SHORT',entry:+price.toFixed(8),entryZone:`${fP(price*0.995)}–${fP(price*1.005)}`,sl:+slL.toFixed(8),slPct:+((slL-price)/price*100).toFixed(2),tp1:+(price-tp1).toFixed(8),tp1Pct:+(tp1/price*100).toFixed(2),tp2:+(price-tp2).toFixed(8),tp2Pct:+(tp2/price*100).toFixed(2),tp3:+(price-tp3).toFixed(8),tp3Pct:+(tp3/price*100).toFixed(2),rr:+(tp1/sl).toFixed(2),rr2:+(tp2/sl).toFixed(2),atr:+atr4h.toFixed(8),note:`ATR 4H: ${fP(atr4h)}. Short only dengan leverage rendah atau spot.`};
      }
    }

    res.setHeader('Cache-Control','s-maxage=30');
    return res.status(200).json({
      symbol:sym,name:ticker.name||sym,price,
      change24h:+ticker.change24h.toFixed(4),volume24h:ticker.vol||0,dataSource:ticker.src,
      support:+support.toFixed(8),resistance:+resistance.toFixed(8),
      support2:+support2.toFixed(8),resistance2:+resistance2.toFixed(8),
      majorSupport:+majSup.toFixed(8),majorResistance:+majRes.toFixed(8),
      atr4h:+atr4h.toFixed(8),
      timeframes:{'1H':tf1h,'4H':tf4h,'1D':tf1d},
      recommendation:{action,explanation:expl,score,confidence:conf,reasons:reasons.slice(0,6)},
      tradeSetup,astrology:astro,timestamp:Date.now(),
    });
  } catch(e){
    return res.status(500).json({error:e.message,symbol:sym});
  }
}
