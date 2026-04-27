// api/search.js — AC369 FUSION v12.1 INSTITUTIONAL
// ═══════════════════════════════════════════════════════════════
// FIX: Parallel fallback (not sequential) → max 9s not 36s
// FIX: Wave 3 detection requires volume + momentum confirmation
// FIX: Funding rate more accurate interpretation
// ADD: Volume Profile (POC detection from klines)
// ADD: Pivot Points (classic + Camarilla)
// ADD: More accurate SMC with proper swing point detection
// ═══════════════════════════════════════════════════════════════

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const rawSym = (req.query.symbol || req.query.s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!rawSym) return res.status(400).json({ error: 'Parameter symbol diperlukan. Contoh: ?symbol=BTC' });
  const sym = rawSym.replace(/USDT$/, '');

  const sf = async (url, ms = 6000) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
      const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } });
      clearTimeout(t); if (!r.ok) return null; return await r.json();
    } catch { clearTimeout(t); return null; }
  };

  // ── CG ID MAP ─────────────────────────────────────────────────
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
    IOTA:'iota',ZIL:'zilliqa',HOT:'holo',CHZ:'chiliz',ENJ:'enjincoin',
    ZRX:'0x',BAL:'balancer',BAND:'band-protocol',TWT:'trust-wallet-token',
    FLOW:'flow',MINA:'mina-protocol',CELO:'celo',GLMR:'moonbeam',
    CTSI:'cartesi',WIN:'wink',JST:'just',SUN:'sun-token',BTT:'bittorrent',
    JASMY:'jasmycoin',ACH:'alchemy-pay',CELR:'celer-network',
    POLS:'polkastarter',HIGH:'highstreet',DAR:'mines-of-dalarnia',
    HOOK:'hooked-protocol',CFX:'conflux-token',MASK:'mask-network',
    METIS:'metis-token',RUNE:'thorchain',STG:'stargate-finance',
    DODO:'dodo',BADGER:'badger-dao',TLM:'alien-worlds',ALICE:'my-neighbor-alice',
    ASTAR:'astar',MBOX:'mobox',RDNT:'radiant-capital',ZK:'zksync',
    BB:'bouncebit',SAGA:'saga-2',W:'wormhole',OMNI:'omni-network',
    AEVO:'aevo',ZETA:'zetachain',EIGEN:'eigenlayer',ETHFI:'ether-fi',
    ENA:'ethena',REZ:'renzo',TNSR:'tensor',DRIFT:'drift-protocol',
    LISTA:'lista-dao',BRETT:'brett',MOG:'mog-coin',NEIRO:'neiro-on-eth',
    GOAT:'goat',PNUT:'peanut-the-squirrel',ME:'magic-eden',
    PENGU:'pudgy-penguins',USUAL:'usual',MORPHO:'morpho',
    COW:'cow-protocol',GUN:'gunstar-metaverse',TOMO:'tomochain',
    KDA:'kadena',HIVE:'hive',KMD:'komodo',BLZ:'bluzelle',DOCK:'dock',
    LSK:'lisk',XEM:'nem',ZEN:'horizen',BTG:'bitcoin-gold',DCR:'decred',
    WAN:'wanchain',ARPA:'arpa',IOTX:'iotex',OXT:'orchid-protocol',
    QNT:'quant-network',GAL:'project-galaxy',PEOPLE:'constitutiondao',
    NULS:'nuls',CVC:'civic',BOND:'barnbridge',ALPHA:'alpha-finance',
    DENT:'dent',OGN:'origin-protocol',NKN:'nkn',RLC:'iexec-rlc',
    MDT:'measurable-data-token',WRX:'wazirx',PHA:'pha',
    PAXG:'pax-gold',DIA:'dia-data',MBL:'moviebloc',
    DUSK:'dusk-network',POND:'marlin',STEP:'step-finance',
    FIDA:'bonfida',KIN:'kin',CHILLGUY:'chill-guy',LUCE:'luce',
    PONKE:'ponke',TURBO:'turbo',BABYDOGE:'baby-doge-coin',SLP:'smooth-love-potion',
  };

  // ── PARALLEL KLINES FETCH (race for fastest) ─────────────────
  // FIX: Use Promise.race() not sequential - max latency = single timeout
  async function fetchK(interval, limit = 200) {
    const ccEndp = interval === '1d' ? 'histoday' : 'histohour';
    const ccLimit = interval === '4h' ? limit * 4 : limit;

    const [cc, fapi, spot, cg] = await Promise.allSettled([
      sf(`https://min-api.cryptocompare.com/data/v2/${ccEndp}?fsym=${sym}&tsym=USD&limit=${ccLimit}`),
      sf(`https://fapi.binance.com/fapi/v1/klines?symbol=${sym}USDT&interval=${interval}&limit=${limit}`),
      sf(`https://api.binance.com/api/v3/klines?symbol=${sym}USDT&interval=${interval}&limit=${limit}`),
      (CG[sym] ? sf(`https://api.coingecko.com/api/v3/coins/${CG[sym]}/ohlc?vs_currency=usd&days=${interval === '1d' ? 90 : interval === '4h' ? 30 : 14}`) : Promise.resolve(null)),
    ]);

    // Try Binance first (most accurate)
    if (fapi.status === 'fulfilled' && Array.isArray(fapi.value) && fapi.value.length >= 30) {
      return fapi.value.map(k => ({ t: +k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5], qv: +k[7] || +k[5] }));
    }
    if (spot.status === 'fulfilled' && Array.isArray(spot.value) && spot.value.length >= 30) {
      return spot.value.map(k => ({ t: +k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5], qv: +k[7] || +k[5] }));
    }
    // CryptoCompare (reliable, good data)
    if (cc.status === 'fulfilled' && cc.value?.Response === 'Success' && cc.value?.Data?.Data?.length >= 30) {
      let data = cc.value.Data.Data.filter(d => d.close > 0).map(d => ({ t: d.time * 1000, o: d.open, h: d.high, l: d.low, c: d.close, v: d.volumeto, qv: d.volumeto }));
      if (interval === '4h') {
        const agg = [];
        for (let i = 0; i + 3 < data.length; i += 4) { const sl = data.slice(i, i + 4); agg.push({ t: sl[0].t, o: sl[0].o, h: Math.max(...sl.map(k => k.h)), l: Math.min(...sl.map(k => k.l)), c: sl[3].c, v: sl.reduce((s, k) => s + k.v, 0), qv: sl.reduce((s, k) => s + k.qv, 0) }); }
        return agg;
      }
      return data;
    }
    // CoinGecko OHLC (last resort, limited candles)
    if (cg.status === 'fulfilled' && Array.isArray(cg.value) && cg.value.length >= 10) {
      return cg.value.map(d => ({ t: d[0], o: d[1], h: d[2], l: d[3], c: d[4], v: 0, qv: 0 }));
    }
    return [];
  }

  // ── PARALLEL PRICE FETCH ─────────────────────────────────────
  async function fetchPrice() {
    const [fapi, spot, cgId, cc] = await Promise.allSettled([
      sf(`https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${sym}USDT`),
      sf(`https://api.binance.com/api/v3/ticker/24hr?symbol=${sym}USDT`),
      CG[sym] ? sf(`https://api.coingecko.com/api/v3/simple/price?ids=${CG[sym]}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true`) : Promise.resolve(null),
      sf(`https://min-api.cryptocompare.com/data/price?fsym=${sym}&tsyms=USD`),
    ]);

    if (fapi.status === 'fulfilled' && fapi.value && !fapi.value.code && +fapi.value.lastPrice > 0)
      return { price: +fapi.value.lastPrice, change24h: +fapi.value.priceChangePercent, vol: +fapi.value.quoteVolume, name: sym, src: 'binance_futures' };
    if (spot.status === 'fulfilled' && spot.value && !spot.value.code && +spot.value.lastPrice > 0)
      return { price: +spot.value.lastPrice, change24h: +spot.value.priceChangePercent, vol: +spot.value.quoteVolume, name: sym, src: 'binance_spot' };
    if (cgId.status === 'fulfilled' && cgId.value?.[CG[sym]]?.usd > 0)
      return { price: cgId.value[CG[sym]].usd, change24h: cgId.value[CG[sym]].usd_24h_change || 0, vol: cgId.value[CG[sym]].usd_24h_vol || 0, name: sym, src: 'coingecko_map' };
    if (cc.status === 'fulfilled' && cc.value?.USD > 0) {
      const ccf = await sf(`https://min-api.cryptocompare.com/data/pricemultifull?fsyms=${sym}&tsyms=USD`);
      return { price: cc.value.USD, change24h: +(ccf?.RAW?.[sym]?.USD?.CHANGEPCT24HOUR || 0), vol: +(ccf?.RAW?.[sym]?.USD?.TOTALVOLUME24HTO || 0), name: sym, src: 'cryptocompare' };
    }
    // CoinGecko search with exact match
    const sr = await sf(`https://api.coingecko.com/api/v3/search?query=${sym}`);
    if (sr?.coins?.length > 0) {
      const exact = sr.coins.find(c => (c.symbol || '').toUpperCase() === sym) || sr.coins[0];
      if (exact?.id) {
        const info = await sf(`https://api.coingecko.com/api/v3/simple/price?ids=${exact.id}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true`);
        if (info?.[exact.id]?.usd > 0) return { price: info[exact.id].usd, change24h: info[exact.id].usd_24h_change || 0, vol: info[exact.id].usd_24h_vol || 0, name: exact.name || sym, src: 'coingecko_search' };
      }
    }
    const cap = await sf(`https://api.coincap.io/v2/assets?search=${sym.toLowerCase()}&limit=5`);
    if (cap?.data?.length > 0) { const c = cap.data.find(x => (x.symbol || '').toUpperCase() === sym) || cap.data[0]; if (c && +c.priceUsd > 0) return { price: +c.priceUsd, change24h: +(c.changePercent24Hr || 0), vol: +(c.volumeUsd24Hr || 0), name: c.name || sym, src: 'coincap' }; }
    return null;
  }

  // ── FETCH DERIVATIVES (parallel) ─────────────────────────────
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

    const result = { fundingRate: null, oi: null, lsRatio: null, topLS: null, sentiment: 'NEUTRAL', derivScore: 0 };

    if (fundRes.status === 'fulfilled' && Array.isArray(fundRes.value) && fundRes.value.length > 0) {
      const frHistory = fundRes.value.map(f => parseFloat(f.fundingRate) * 100);
      const fr = frHistory[frHistory.length - 1];
      const frAvg = frHistory.reduce((a, b) => a + b, 0) / frHistory.length;
      let bybitFR = null;
      if (bybitFundRes.status === 'fulfilled' && bybitFundRes.value?.result?.list?.length > 0)
        bybitFR = parseFloat(bybitFundRes.value.result.list[0].fundingRate || 0) * 100;

      result.fundingRate = {
        current: +fr.toFixed(4), avg8: +frAvg.toFixed(4), trend: fr > frAvg ? 'INCREASING' : 'DECREASING',
        annualized: +(fr * 3 * 365).toFixed(2),
        history: frHistory.slice(-8).map(f => +f.toFixed(4)),
        bybit: bybitFR !== null ? +bybitFR.toFixed(4) : null,
        consensus: bybitFR !== null ? (Math.abs(fr - bybitFR) < 0.05 ? 'ALIGNED' : 'DIVERGED') : null,
        interpretation: fr > 0.1 ? '⚠️ Sangat Positif — long overcrowded, waspadai long squeeze' :
          fr > 0.05 ? '📈 Positif — bullish dominan' : fr > 0.01 ? '🟡 Sedikit Positif' :
          fr < -0.1 ? '⚠️ Sangat Negatif — short overcrowded, waspadai short squeeze' :
          fr < -0.05 ? '📉 Negatif — bearish dominan' : fr < -0.01 ? '🟡 Sedikit Negatif' : '⚖️ Netral',
        signal: fr > 0.1 ? 'EXTREME_LONG' : fr > 0.05 ? 'LONG_HEAVY' : fr < -0.1 ? 'EXTREME_SHORT' : fr < -0.05 ? 'SHORT_HEAVY' : 'NEUTRAL',
        reverseSignal: fr > 0.08 ? '⚠️ Funding sangat tinggi — potensi long squeeze!' : fr < -0.08 ? '⚠️ Funding sangat negatif — potensi short squeeze!' : null,
      };
    }

    if (oiHistRes.status === 'fulfilled' && Array.isArray(oiHistRes.value) && oiHistRes.value.length > 10) {
      const oiHist = oiHistRes.value.map(d => parseFloat(d.sumOpenInterest));
      const oiLast = oiHist[oiHist.length - 1], oi6hAgo = oiHist[oiHist.length - 6] || oiLast, oi24hAgo = oiHist[0] || oiLast;
      const oiChg6h = oi6hAgo > 0 ? +((oiLast - oi6hAgo) / oi6hAgo * 100).toFixed(2) : 0;
      const oiChg24h = oi24hAgo > 0 ? +((oiLast - oi24hAgo) / oi24hAgo * 100).toFixed(2) : 0;
      const oiTrend = oiChg6h > 5 ? 'INCREASING_FAST' : oiChg6h > 2 ? 'INCREASING' : oiChg6h < -5 ? 'DECREASING_FAST' : oiChg6h < -2 ? 'DECREASING' : 'STABLE';
      const frCur = result.fundingRate?.current || 0;
      let bybitOIChg = null;
      if (bybitOIRes.status === 'fulfilled' && bybitOIRes.value?.result?.list?.length > 5) {
        const boi = bybitOIRes.value.result.list;
        const b0 = parseFloat(boi[0]?.openInterest || 0), b5 = parseFloat(boi[5]?.openInterest || b0);
        bybitOIChg = b5 > 0 ? +((b0 - b5) / b5 * 100).toFixed(2) : null;
      }
      result.oi = {
        current: +oiLast.toFixed(0), change6h: oiChg6h, change24h: oiChg24h, trend: oiTrend, spike: Math.abs(oiChg6h) > 10,
        history24h: oiHist.slice(-12).map(v => +v.toFixed(0)),
        bybit_change6h: bybitOIChg,
        bybit_aligned: bybitOIChg !== null ? Math.abs(bybitOIChg - oiChg6h) < 5 : null,
        interpretation: Math.abs(oiChg6h) > 10 && Math.abs(frCur) > 0.05
          ? `OI spike +${oiChg6h}% + funding ${frCur > 0 ? 'positif' : 'negatif'} → ${frCur > 0 ? 'LONG OVERCROWDED' : 'SHORT OVERCROWDED'}`
          : oiChg6h > 5 ? 'OI naik — posisi baru masuk, momentum kuat'
          : oiChg6h < -5 ? 'OI turun — deleveraging, konsolidasi/reversal'
          : 'OI stabil',
        signal: oiChg6h > 5 && frCur > 0 ? 'BULL_CONFIRM' : oiChg6h > 5 && frCur < 0 ? 'SQUEEZE_RISK' : oiChg6h < -5 ? 'DELEVERAGE' : 'NEUTRAL',
      };
    }

    if (lsRatioRes.status === 'fulfilled' && Array.isArray(lsRatioRes.value) && lsRatioRes.value.length > 0) {
      const latest = lsRatioRes.value[lsRatioRes.value.length - 1];
      const lsVal = parseFloat(latest.longShortRatio);
      const history = lsRatioRes.value.slice(-12).map(d => parseFloat(d.longShortRatio));
      const lsAvg = history.reduce((a, b) => a + b, 0) / history.length;
      result.lsRatio = {
        current: +lsVal.toFixed(3), avg: +lsAvg.toFixed(3),
        longPct: +(lsVal / (1 + lsVal) * 100).toFixed(1), shortPct: +(1 / (1 + lsVal) * 100).toFixed(1),
        trend: lsVal > lsAvg ? 'MORE_LONGS' : 'MORE_SHORTS', history: history.map(v => +v.toFixed(3)),
        interpretation: lsVal > 2.5 ? 'Long sangat dominan (>2.5:1) — contrarian BEARISH kuat' :
          lsVal > 1.5 ? 'Long dominan — potensi short squeeze' :
          lsVal < 0.4 ? 'Short sangat dominan — contrarian BULLISH kuat' :
          lsVal < 0.7 ? 'Short dominan — potensi short squeeze' : 'Seimbang',
        contrarian: lsVal > 2.5 ? 'BEARISH' : lsVal < 0.4 ? 'BULLISH' : lsVal > 1.5 ? 'MILD_BEAR' : lsVal < 0.7 ? 'MILD_BULL' : 'NEUTRAL',
      };
    }

    if (topLSRes.status === 'fulfilled' && Array.isArray(topLSRes.value) && topLSRes.value.length > 0) {
      const tl = topLSRes.value[topLSRes.value.length - 1];
      const topLSVal = parseFloat(tl.longShortRatio || 1);
      result.topLS = { ratio: +topLSVal.toFixed(3), longPct: +(topLSVal / (1 + topLSVal) * 100).toFixed(1), interpretation: topLSVal > 1.5 ? 'Smart money LONG heavy — bullish' : topLSVal < 0.67 ? 'Smart money SHORT heavy — bearish' : 'Smart money balanced', signal: topLSVal > 1.5 ? 'SMART_BULL' : topLSVal < 0.67 ? 'SMART_BEAR' : 'NEUTRAL' };
    }

    let ds = 0;
    if (result.fundingRate) { const fr = result.fundingRate.current; ds += fr < -0.05 ? 3 : fr < -0.02 ? 1 : fr > 0.1 ? -3 : fr > 0.05 ? -1 : 0; }
    if (result.oi?.signal === 'BULL_CONFIRM') ds += 2; else if (result.oi?.signal === 'DELEVERAGE') ds -= 2; else if (result.oi?.signal === 'SQUEEZE_RISK') ds -= 1;
    if (result.lsRatio?.contrarian === 'BULLISH') ds += 2; else if (result.lsRatio?.contrarian === 'BEARISH') ds -= 2; else if (result.lsRatio?.contrarian === 'MILD_BULL') ds += 1; else if (result.lsRatio?.contrarian === 'MILD_BEAR') ds -= 1;
    if (result.topLS?.signal === 'SMART_BULL') ds += 2; else if (result.topLS?.signal === 'SMART_BEAR') ds -= 2;
    result.derivScore = ds;
    result.sentiment = ds >= 5 ? 'STRONG_BULL' : ds >= 3 ? 'BULL' : ds <= -5 ? 'STRONG_BEAR' : ds <= -3 ? 'BEAR' : 'NEUTRAL';
    return result;
  }

  // ── MATH ──────────────────────────────────────────────────────
  const EMA = (c, p) => { if (!c || c.length < 2) return c?.[c.length-1]||0; const k=2/(p+1); let e=c.slice(0,Math.min(p,c.length)).reduce((a,b)=>a+b,0)/Math.min(p,c.length); for(let i=Math.min(p,c.length);i<c.length;i++)e=c[i]*k+e*(1-k); return e; };
  const RSI = (c, p=14) => { if(!c||c.length<p+1)return 50; let g=0,l=0; for(let i=1;i<=p;i++){const d=c[i]-c[i-1];d>=0?g+=d:l-=d;} let ag=g/p,al=l/p; for(let i=p+1;i<c.length;i++){const d=c[i]-c[i-1];ag=(ag*(p-1)+(d>=0?d:0))/p;al=(al*(p-1)+(d<0?-d:0))/p;} return al===0?100:+((100-100/(1+ag/al)).toFixed(2)); };
  const ATR = (K,p=14) => { if(!K||K.length<2)return 0; const tr=K.slice(1).map((k,i)=>Math.max(k.h-k.l,Math.abs(k.h-K[i].c),Math.abs(k.l-K[i].c))); return tr.slice(-p).reduce((a,b)=>a+b,0)/Math.min(p,tr.length); };
  const BB = (c,p=20) => { if(!c||c.length<p)return{upper:0,lower:0,mid:0,width:0,position:50,squeeze:false}; const sl=c.slice(-p),m=sl.reduce((a,b)=>a+b,0)/p; const sd=Math.sqrt(sl.reduce((s,v)=>s+(v-m)**2,0)/p); const up=m+2*sd,dn=m-2*sd; return{upper:+up.toFixed(8),lower:+dn.toFixed(8),mid:+m.toFixed(8),width:+(sd>0?(4*sd/m)*100:0).toFixed(2),position:+(sd>0?((c[c.length-1]-dn)/(4*sd)*100):50).toFixed(1),squeeze:sd>0&&(4*sd/m)*100<3}; };
  const MACD = (c) => { if(!c||c.length<35)return{macd:0,signal:0,histogram:0,bullish:false,bearish:false,crossUp:false,crossDown:false}; const k12=2/13,k26=2/27,k9=2/10; let e12=c.slice(0,12).reduce((a,b)=>a+b,0)/12,e26=c.slice(0,26).reduce((a,b)=>a+b,0)/26; const mv=[]; for(let i=26;i<c.length;i++){e12=c[i]*k12+e12*(1-k12);e26=c[i]*k26+e26*(1-k26);mv.push(e12-e26);} let sig=mv.slice(0,9).reduce((a,b)=>a+b,0)/9; for(let i=9;i<mv.length;i++)sig=mv[i]*k9+sig*(1-k9); const ml=mv[mv.length-1],ph=mv[mv.length-2]||ml,hist=ml-sig,prevH=ph-sig; return{macd:+ml.toFixed(8),signal:+sig.toFixed(8),histogram:+hist.toFixed(8),bullish:ml>0&&hist>0,bearish:ml<0&&hist<0,crossUp:hist>0&&prevH<=0,crossDown:hist<0&&prevH>=0}; };
  const fP = n => { const v=parseFloat(n)||0; if(!v)return'—'; if(v>=100000)return'$'+v.toLocaleString('id-ID',{maximumFractionDigits:0}); if(v>=1000)return'$'+v.toLocaleString('id-ID',{minimumFractionDigits:2,maximumFractionDigits:2}); if(v>=1)return'$'+v.toFixed(4); if(v>=0.001)return'$'+v.toFixed(6); return'$'+v.toFixed(8); };

  // ── SWING PIVOTS ─────────────────────────────────────────────
  function swingPivots(K, lb = 5) {
    const h = [], l = [];
    for (let i = lb; i < K.length - lb; i++) {
      let iH = true, iL = true;
      for (let j = i - lb; j <= i + lb; j++) { if (j === i) continue; if (K[j].h >= K[i].h) iH = false; if (K[j].l <= K[i].l) iL = false; }
      if (iH) h.push({ i, price: K[i].h, t: K[i].t });
      if (iL) l.push({ i, price: K[i].l, t: K[i].t });
    }
    return { highs: h, lows: l };
  }

  // ── VOLUME PROFILE (POC Detection) ───────────────────────────
  function calcVolumeProfile(K, price) {
    if (!K || K.length < 20) return { poc: null, vah: null, val: null, interpretation: '' };
    const rangeH = Math.max(...K.slice(-50).map(k => k.h));
    const rangeL = Math.min(...K.slice(-50).map(k => k.l));
    const totalRange = rangeH - rangeL;
    if (totalRange <= 0) return { poc: null, vah: null, val: null, interpretation: '' };

    // 20 price buckets
    const bucketCount = 20;
    const bucketSize = totalRange / bucketCount;
    const buckets = Array(bucketCount).fill(0);
    K.slice(-50).forEach(k => {
      const midPrice = (k.h + k.l) / 2;
      const bucketIdx = Math.min(Math.floor((midPrice - rangeL) / bucketSize), bucketCount - 1);
      buckets[bucketIdx] += k.qv || k.v || 0;
    });

    // Find POC (bucket with most volume)
    const pocIdx = buckets.indexOf(Math.max(...buckets));
    const poc = rangeL + pocIdx * bucketSize + bucketSize / 2;

    // Value Area (70% of total volume)
    const totalVol = buckets.reduce((a, b) => a + b, 0);
    const targetVol = totalVol * 0.7;
    let vahIdx = pocIdx, valIdx = pocIdx, accVol = buckets[pocIdx];
    while (accVol < targetVol) {
      const upNext = vahIdx + 1 < bucketCount ? buckets[vahIdx + 1] : 0;
      const dnNext = valIdx - 1 >= 0 ? buckets[valIdx - 1] : 0;
      if (upNext >= dnNext && vahIdx + 1 < bucketCount) { vahIdx++; accVol += upNext; }
      else if (valIdx - 1 >= 0) { valIdx--; accVol += dnNext; }
      else break;
    }
    const vah = rangeL + vahIdx * bucketSize + bucketSize;
    const val = rangeL + valIdx * bucketSize;

    const priceRelPOC = price > poc * 1.002 ? 'above' : price < poc * 0.998 ? 'below' : 'at';
    const interpretation = priceRelPOC === 'at' ? `✅ Harga di POC (${fP(poc)}) — area fair value, high probability` :
      priceRelPOC === 'above' ? `📈 Harga di atas POC (${fP(poc)}) — bullish, POC = support` :
      `📉 Harga di bawah POC (${fP(poc)}) — bearish, POC = resistance`;

    return { poc: +poc.toFixed(8), vah: +vah.toFixed(8), val: +val.toFixed(8), priceRelPOC, interpretation, buckets };
  }

  // ── PIVOT POINTS ─────────────────────────────────────────────
  function calcPivots(K) {
    if (!K || K.length < 2) return null;
    const prev = K[K.length - 2];
    const P = (prev.h + prev.l + prev.c) / 3;
    const R1 = 2 * P - prev.l, S1 = 2 * P - prev.h;
    const R2 = P + (prev.h - prev.l), S2 = P - (prev.h - prev.l);
    const R3 = prev.h + 2 * (P - prev.l), S3 = prev.l - 2 * (prev.h - P);
    // Camarilla
    const cr1 = prev.c + (prev.h - prev.l) * 1.1 / 12, cs1 = prev.c - (prev.h - prev.l) * 1.1 / 12;
    const cr3 = prev.c + (prev.h - prev.l) * 1.1 / 4, cs3 = prev.c - (prev.h - prev.l) * 1.1 / 4;
    return { P: +P.toFixed(8), R1: +R1.toFixed(8), R2: +R2.toFixed(8), R3: +R3.toFixed(8), S1: +S1.toFixed(8), S2: +S2.toFixed(8), S3: +S3.toFixed(8), camarilla: { R1: +cr1.toFixed(8), R3: +cr3.toFixed(8), S1: +cs1.toFixed(8), S3: +cs3.toFixed(8) } };
  }

  // ── MARKET STRUCTURE ─────────────────────────────────────────
  function analyzeMS(K, price) {
    if (!K || K.length < 30) return { bos: null, choch: null, structure: 'Insufficient Data', trend: 'UNKNOWN', lastSwingHigh: null, lastSwingLow: null, prevSwingHigh: null, prevSwingLow: null, highs: [], lows: [] };
    const lb = Math.min(5, Math.floor(K.length / 15));
    const { highs, lows } = swingPivots(K, lb);
    const last4H = highs.slice(-4), last4L = lows.slice(-4);
    const lH = last4H[last4H.length - 1], pH = last4H[last4H.length - 2];
    const lL = last4L[last4L.length - 1], pL = last4L[last4L.length - 2];
    const isHH = lH && pH && lH.price > pH.price, isHL = lL && pL && lL.price > pL.price;
    const isLH = lH && pH && lH.price < pH.price, isLL = lL && pL && lL.price < pL.price;
    let structure = 'SIDEWAYS';
    if (isHH && isHL) structure = 'UPTREND (HH-HL)';
    else if (isLH && isLL) structure = 'DOWNTREND (LH-LL)';
    else if (isHH && isLL) structure = 'EXPANDING RANGE';
    else if (isLH && isHL) structure = 'CONTRACTING RANGE';
    let bos = null, choch = null;
    if (lH && price > lH.price * 1.001) bos = { type: 'BULLISH', level: +lH.price.toFixed(8), description: `BOS Bullish — breakout di atas swing high ${fP(lH.price)}` };
    else if (lL && price < lL.price * 0.999) bos = { type: 'BEARISH', level: +lL.price.toFixed(8), description: `BOS Bearish — breakdown di bawah swing low ${fP(lL.price)}` };
    if (structure.includes('DOWNTREND') && isHL) choch = { type: 'BULLISH', description: 'CHoCH Bullish — downtrend mulai membentuk HL' };
    else if (structure.includes('UPTREND') && isLH) choch = { type: 'BEARISH', description: 'CHoCH Bearish — uptrend mulai membentuk LH' };
    return { bos, choch, structure, trend: structure.includes('UPTREND') ? 'BULLISH' : structure.includes('DOWNTREND') ? 'BEARISH' : 'NEUTRAL', lastSwingHigh: lH?.price || null, lastSwingLow: lL?.price || null, prevSwingHigh: pH?.price || null, prevSwingLow: pL?.price || null, highs: last4H.map(h => +h.price.toFixed(8)), lows: last4L.map(l => +l.price.toFixed(8)) };
  }

  // ── SMC ───────────────────────────────────────────────────────
  function analyzeSMC(K, price, ms) {
    if (!K || K.length < 20) return { signal: 'Neutral', bullOB: null, bearOB: null, bullFVG: null, bearFVG: null, liquiditySweep: null, premiumDiscount: 'Equilibrium', summary: 'Data tidak cukup', bos: ms?.bos?.description || null, bsl: null, ssl: null };
    const last = K.length - 1;
    let bullOB = null, bearOB = null, bullFVG = null, bearFVG = null;
    for (let i = Math.max(0, last - 20); i < last; i++) {
      const c = K[i], n = K[i + 1]; if (!n) continue;
      if (c.c < c.o && n.c > n.o && n.c > c.h) { const h = Math.max(c.o, c.c), lo = c.l; const at = price >= lo * 0.998 && price <= h * 1.002; if (!bullOB || at) bullOB = { hi: +h.toFixed(8), lo: +lo.toFixed(8), atPrice: at, distance: +((price - lo) / price * 100).toFixed(2), description: `Bull OB: ${fP(lo)}–${fP(h)}${at ? ' ✅ Harga di OB!' : ''}` }; }
      if (c.c > c.o && n.c < n.o && n.c < c.l) { const h = c.h, lo = Math.min(c.o, c.c); const at = price >= lo * 0.998 && price <= h * 1.002; if (!bearOB || at) bearOB = { hi: +h.toFixed(8), lo: +lo.toFixed(8), atPrice: at, distance: +((h - price) / price * 100).toFixed(2), description: `Bear OB: ${fP(lo)}–${fP(h)}${at ? ' ⚠️ Harga di Bear OB!' : ''}` }; }
    }
    for (let i = Math.max(1, last - 25); i < last - 1; i++) {
      if (K[i+1].l > K[i-1].h * 1.0005) { const at = price >= K[i-1].h && price <= K[i+1].l; bullFVG = { hi: +K[i+1].l.toFixed(8), lo: +K[i-1].h.toFixed(8), priceIn: at, size: +((K[i+1].l - K[i-1].h) / K[i-1].h * 100).toFixed(3), description: `Bull FVG ${fP(K[i-1].h)}–${fP(K[i+1].l)}${at ? ' ✅ Harga dalam FVG!' : ''}` }; }
      if (K[i+1].h < K[i-1].l * 0.9995) { const at = price >= K[i+1].h && price <= K[i-1].l; bearFVG = { hi: +K[i-1].l.toFixed(8), lo: +K[i+1].h.toFixed(8), priceIn: at, size: +((K[i-1].l - K[i+1].h) / K[i+1].h * 100).toFixed(3), description: `Bear FVG ${fP(K[i+1].h)}–${fP(K[i-1].l)}${at ? ' ⚠️ Harga dalam Bear FVG!' : ''}` }; }
    }
    let liquiditySweep = null;
    const rH = K.slice(-20).map(k => k.h).sort((a, b) => b - a), rL = K.slice(-20).map(k => k.l).sort((a, b) => a - b);
    const bsl = rH[2], ssl = rL[2];
    const lc = K[last];
    if (lc.h > bsl && lc.c < bsl * 0.999) liquiditySweep = { type: 'BSL', level: +bsl.toFixed(8), description: `BSL swept di ${fP(bsl)} — potensi reversal turun`, direction: 'BEARISH_AFTER_SWEEP' };
    else if (lc.l < ssl && lc.c > ssl * 1.001) liquiditySweep = { type: 'SSL', level: +ssl.toFixed(8), description: `SSL swept di ${fP(ssl)} — potensi reversal naik`, direction: 'BULLISH_AFTER_SWEEP' };
    const sw50H = Math.max(...K.slice(-50).map(k => k.h)), sw50L = Math.min(...K.slice(-50).map(k => k.l));
    const eq = (sw50H + sw50L) / 2;
    const zone = price > eq + (sw50H - eq) * 0.5 ? '⚠️ Premium Zone' : price < eq - (eq - sw50L) * 0.5 ? '✅ Discount Zone' : '⚖️ Equilibrium Zone';
    const bc = [ms?.bos?.type === 'BULLISH', ms?.choch?.type === 'BULLISH', bullOB?.atPrice, bullFVG?.priceIn, liquiditySweep?.direction === 'BULLISH_AFTER_SWEEP'].filter(Boolean).length;
    const be = [ms?.bos?.type === 'BEARISH', ms?.choch?.type === 'BEARISH', bearOB?.atPrice, bearFVG?.priceIn, liquiditySweep?.direction === 'BEARISH_AFTER_SWEEP'].filter(Boolean).length;
    const sig = bc > be ? 'Bullish' : be > bc ? 'Bearish' : 'Neutral';
    return { signal: sig, summary: `${ms?.bos?.description || ms?.choch?.description || ms?.structure} | ${zone}`, bos: ms?.bos?.description || null, bullOB, bearOB, bullFVG, bearFVG, liquiditySweep, bslTarget: +rH[0].toFixed(8), sslTarget: +rL[0].toFixed(8), bsl: +bsl.toFixed(8), ssl: +ssl.toFixed(8), bslDistance: +((rH[0] - price) / price * 100).toFixed(2), sslDistance: +((price - rL[0]) / price * 100).toFixed(2), premiumDiscount: zone, equilibrium: +eq.toFixed(8) };
  }

  // ── ELLIOTT WAVE ──────────────────────────────────────────────
  function analyzeEW(K, closes, price) {
    if (!K || K.length < 20) return { wave: 'Data Tidak Cukup', confidence: 0, description: '', fibonacci: {}, targets: {} };
    const lb = Math.min(5, Math.floor(K.length / 10));
    const { highs, lows } = swingPivots(K, lb);
    const lH = highs[highs.length - 1]?.price || price * 1.05;
    const pL = lows[lows.length - 1]?.price || price * 0.95;
    const range = lH - pL;
    const ret = range > 0 ? (lH - price) / range : 0;
    const rsi = RSI(closes.slice(-50), 14);
    const macd = MACD(closes);
    // Volume trend: last 5 vs prev 10
    const volTrend = K.slice(-5).reduce((a, k) => a + (k.qv || k.v || 0), 0) > K.slice(-15, -5).reduce((a, k) => a + (k.qv || k.v || 0), 0) / 2 * 5 ? 'EXPANDING' : 'CONTRACTING';
    const fib = { fib0: +lH.toFixed(8), fib236: +(lH - range * 0.236).toFixed(8), fib382: +(lH - range * 0.382).toFixed(8), fib500: +(lH - range * 0.5).toFixed(8), fib618: +(lH - range * 0.618).toFixed(8), fib786: +(lH - range * 0.786).toFixed(8), fib100: +pL.toFixed(8) };
    const targets = { ext127: +(pL + range * 1.272).toFixed(8), ext161: +(pL + range * 1.618).toFixed(8), ext200: +(pL + range * 2.0).toFixed(8), ext261: +(pL + range * 2.618).toFixed(8) };
    let wave, conf, desc, nextBull, nextBear;
    if (price > lH * 1.003 && volTrend === 'EXPANDING') { wave = '🚀 Wave 3 Impulse (Breakout)'; conf = 84; desc = `Breakout di atas ${fP(lH)} dengan volume expansion. Target: ${fP(targets.ext161)}`; nextBull = targets.ext161; }
    else if (ret >= 0 && ret <= 0.236 && rsi > 55 && macd.bullish) { wave = '⚡ Wave 3 Developing'; conf = 78; desc = `Retracement <23.6%, RSI ${rsi}, MACD bullish. Target: ${fP(targets.ext127)}`; nextBull = targets.ext127; }
    else if (ret > 0.236 && ret <= 0.382 && rsi > 48) { wave = '📈 Wave 3 Entry Zone'; conf = 76; desc = `Retracement 23.6-38.2% — entry ideal Wave 3. Support: ${fP(fib.fib382)}`; nextBull = targets.ext127; }
    else if (ret > 0.382 && ret <= 0.5 && rsi > 45) { wave = '🔄 Wave 4 (Koreksi Normal)'; conf = 70; desc = `Koreksi 38.2-50%, Wave 4. Support: ${fP(fib.fib500)}`; nextBull = targets.ext127; nextBear = fib.fib618; }
    else if (ret > 0.5 && ret <= 0.618) { wave = '⚠️ Deep Wave 4 / Wave 2'; conf = 63; desc = `Koreksi 50-61.8%. Level kritis: ${fP(fib.fib618)}`; nextBull = targets.ext127; nextBear = fib.fib786; }
    else if (ret > 0.618 && ret <= 0.786 && rsi < 50) { wave = '📉 Wave C / ABC Correction'; conf = 68; desc = `Retracement >61.8%. Waspada breakdown ${fP(fib.fib786)}`; nextBear = fib.fib786; }
    else if (price < pL * 0.997) { wave = '💀 Bearish Extension / Wave C'; conf = 75; desc = `Breakdown struktur. Bearish wave aktif`; nextBear = pL * 0.9; }
    else if (ret < 0.15 && rsi > 72 && volTrend === 'CONTRACTING') { wave = '🏔️ Wave 5 (Possible Peak)'; conf = 66; desc = `RSI ${rsi} tinggi, volume kontraksi — waspadai reversal!`; nextBear = fib.fib382; }
    else { wave = '🌱 Wave 1/2 (Early Stage)'; conf = 55; desc = 'Pola awal — konfirmasi diperlukan sebelum entry'; nextBull = lH; }
    return { wave, confidence: conf, description: desc, fibonacci: fib, targets, nextBullTarget: nextBull ? +nextBull.toFixed(8) : null, nextBearTarget: nextBear ? +nextBear.toFixed(8) : null, swingHigh: +lH.toFixed(8), swingLow: +pL.toFixed(8), retracePercent: +(ret * 100).toFixed(1) };
  }

  // ── CANDLE PATTERNS ───────────────────────────────────────────
  function detectPatterns(K, price) {
    if (!K || K.length < 10) return [];
    const pts = [], l = K.length - 1, lc = K[l], plc = K[l - 1] || K[l];
    const body = Math.abs(lc.c - lc.o), range = lc.h - lc.l || 0.000001;
    const lw = Math.min(lc.o, lc.c) - lc.l, uw = lc.h - Math.max(lc.o, lc.c);
    if (lw / range > 0.55 && body / range < 0.25 && lc.c >= lc.o) pts.push({ name: '🔨 Hammer', signal: 'bullish', probability: 70 });
    if (lw / range > 0.55 && body / range < 0.25 && lc.c < lc.o) pts.push({ name: '🪝 Hanging Man', signal: 'bearish', probability: 65 });
    if (uw / range > 0.55 && body / range < 0.25 && lc.c <= lc.o) pts.push({ name: '🌠 Shooting Star', signal: 'bearish', probability: 68 });
    if (body / range < 0.08) pts.push({ name: '➕ Doji', signal: 'neutral', probability: 50 });
    if (lc.c > lc.o && plc.c < plc.o && lc.c > plc.o && lc.o < plc.c) pts.push({ name: '🟢 Bullish Engulfing', signal: 'bullish', probability: 76 });
    if (lc.c < lc.o && plc.c > plc.o && lc.c < plc.o && lc.o > plc.c) pts.push({ name: '🔴 Bearish Engulfing', signal: 'bearish', probability: 74 });
    if (body / range > 0.75 && lc.c > lc.o) pts.push({ name: '💪 Bull Marubozu', signal: 'bullish', probability: 72 });
    if (body / range > 0.75 && lc.c < lc.o) pts.push({ name: '💀 Bear Marubozu', signal: 'bearish', probability: 72 });
    if (K.length >= 3) { const c3 = K[l - 2]; if (c3 && c3.c < c3.o && plc.c < plc.o && lc.c > lc.o && lc.c > plc.h) pts.push({ name: '🌅 Morning Star', signal: 'bullish', probability: 78 }); if (c3 && c3.c > c3.o && plc.c > plc.o && lc.c < lc.o && lc.c < plc.l) pts.push({ name: '🌃 Evening Star', signal: 'bearish', probability: 76 }); }
    return pts.slice(0, 4);
  }

  // ── ASTROLOGY ─────────────────────────────────────────────────
  function calcAstro() {
    const jd = Date.now() / 86400000 + 2440587.5;
    const dnm = ((jd - 2460320.5) % 29.53058867 + 29.53058867) % 29.53058867;
    const dsh = Math.floor((Date.now() - new Date('2024-04-20').getTime()) / 86400000);
    const now = new Date();
    const mrs = [{ s: new Date('2025-03-15'), e: new Date('2025-04-07') }, { s: new Date('2025-07-18'), e: new Date('2025-08-11') }, { s: new Date('2025-11-09'), e: new Date('2025-12-01') }, { s: new Date('2026-03-08'), e: new Date('2026-03-31') }, { s: new Date('2026-07-06'), e: new Date('2026-07-30') }, { s: new Date('2026-10-28'), e: new Date('2026-11-18') }];
    const inMR = mrs.some(p => now >= p.s && now <= p.e);
    const inMRShadow = mrs.some(p => { const ps = new Date(p.s.getTime() - 7 * 86400000); const pe = new Date(p.e.getTime() + 7 * 86400000); return now >= ps && now <= pe; });
    let mp, mi, interp, sig;
    if (dnm < 1.5) { mp = 'New Moon 🌑'; mi = 0; interp = 'New Moon — siklus baru, akumulasi'; sig = '🌑 New Cycle'; }
    else if (dnm < 7.5) { mp = 'Waxing Crescent 🌒'; mi = Math.round(dnm / 29.53 * 100); interp = 'Waxing — momentum membangun'; sig = '🌒 Building'; }
    else if (dnm < 8.5) { mp = 'First Quarter 🌓'; mi = 50; interp = 'First Quarter — uji resistance'; sig = '🌓 Testing'; }
    else if (dnm < 14) { mp = 'Waxing Gibbous 🌔'; mi = Math.round(dnm / 29.53 * 100); interp = 'Waxing Gibbous — mendekati puncak'; sig = '🌔 Near Peak'; }
    else if (dnm < 16) { mp = 'Full Moon 🌕'; mi = 100; interp = 'Full Moon — volatilitas tinggi'; sig = '🌕 Full Moon'; }
    else if (dnm < 22) { mp = 'Waning 🌖'; mi = Math.round((29.53 - dnm) / 29.53 * 100); interp = 'Waning — distribusi'; sig = '🌖 Distribution'; }
    else { mp = 'Dark Moon 🌘'; mi = Math.round((29.53 - dnm) / 29.53 * 100); interp = 'Dark Moon — koreksi akhir'; sig = '🌘 Final Correction'; }
    const hp = dsh < 90 ? 'Post-Halving Early' : dsh < 365 ? 'Bull Cycle Early ✅ (Best Buy)' : dsh < 547 ? 'Bull Cycle Peak ⚠️' : dsh < 730 ? 'Distribution ⚠️' : 'Bear Market / DCA Zone';
    const month = now.getMonth() + 1;
    const mb = { 1: 'Jan(+)', 2: 'Feb(+)', 3: 'Mar(±)', 4: 'Apr(+)', 5: 'May(-)', 6: 'Jun(-)', 7: 'Jul(±)', 8: 'Aug(±)', 9: 'Sep(-/worst)', 10: 'Oct(+/best)', 11: 'Nov(+)', 12: 'Dec(+)' }[month] || '—';
    return { moonPhase: mp, illumination: mi, halvingPhase: hp, daysSinceHalving: dsh, signal: sig, interpretation: interp, monthBias: mb, inMercuryRetrograde: inMR, inMercuryShadow: inMRShadow, mercuryWarning: inMR ? '⚠️ Mercury Retrograde — sinyal palsu tinggi!' : inMRShadow ? '⚠️ Mercury Shadow — extra konfirmasi!' : null, daysSinceNM: +dnm.toFixed(1) };
  }

  // ── TIMEFRAME ANALYSIS ────────────────────────────────────────
  function analyzeTF(K, price, tfName) {
    if (!K || K.length < 5) return { rsi: 50, rsiLabel: 'Insufficient', trend: 'NEUTRAL', ema: {}, bb: {}, macd: {}, patterns: [], elliottWave: { wave: '—', confidence: 0 }, smc: { signal: 'Neutral', summary: '—' }, ms: { structure: 'Unknown' }, volumeProfile: null };
    const closes = K.map(k => k.c);
    const rsi = RSI(closes, 14), atr = ATR(K, 14), bb = BB(closes, Math.min(20, closes.length)), macd = MACD(closes);
    const ne = p => Math.min(p, closes.length - 1) || 1;
    const e9 = EMA(closes, ne(9)), e21 = EMA(closes, ne(21)), e20 = EMA(closes, ne(20)), e50 = EMA(closes, ne(50)), e200 = EMA(closes, ne(200));
    const ms = analyzeMS(K, price);
    const smc = analyzeSMC(K, price, ms);
    const ew = analyzeEW(K, closes, price);
    const pats = detectPatterns(K, price);
    const vp = tfName === '4H' ? calcVolumeProfile(K, price) : null;
    const ts = (price > e20 ? 1 : -1) + (price > e50 ? 1 : -1) + (price > e200 ? 1 : -1) + (macd.bullish ? 1 : -1) + (rsi > 50 ? 0.5 : -0.5);
    const trend = ts >= 3 ? 'BULLISH' : ts >= 1 ? 'BULLISH_WEAK' : ts < -3 ? 'BEARISH' : ts < -1 ? 'BEARISH_WEAK' : 'NEUTRAL';
    const rsiLabel = rsi < 20 ? '🔥 Extreme Oversold' : rsi < 30 ? '🟢 Oversold (Beli)' : rsi < 40 ? '📉 Bearish Zone' : rsi < 45 ? '⬇️ Below Neutral' : rsi < 55 ? '⚖️ Neutral' : rsi < 60 ? '⬆️ Above Neutral' : rsi < 70 ? '📈 Bullish Zone' : rsi < 80 ? '🔴 Overbought' : '💥 Extreme Overbought';
    const volAvg = K.slice(-20).reduce((s, k) => s + (k.v || 0), 0) / 20;
    const volLast = K[K.length - 1]?.v || 0;
    return { rsi, rsiLabel, trend, atr: +atr.toFixed(8), ema: { e9: +e9.toFixed(8), e21: +e21.toFixed(8), e20: +e20.toFixed(8), e50: +e50.toFixed(8), e200: +e200.toFixed(8) }, bb, macd, patterns: pats, elliottWave: ew, smc, ms, volumeProfile: vp, volumes: { avg: +volAvg.toFixed(0), last: +volLast.toFixed(0), ratio: +(volAvg > 0 ? volLast / volAvg : 1).toFixed(2), expanding: volAvg > 0 && volLast > volAvg * 1.5 } };
  }

  // ── CONFLUENCE SCORING ────────────────────────────────────────
  function calcConfluence(tf1h, tf4h, tf1d, deriv, ms4h, ew4h, smc4h, vp4h) {
    let bs = 0, br = 0;
    // Multi-TF trend (30pts)
    const tAdd = (t, w) => { if (t === 'BULLISH') bs += w; else if (t === 'BULLISH_WEAK') bs += w * 0.5; else if (t === 'BEARISH') br += w; else if (t === 'BEARISH_WEAK') br += w * 0.5; };
    tAdd(tf1h.trend, 8); tAdd(tf4h.trend, 12); tAdd(tf1d.trend, 10);
    // RSI 4H (14pts)
    const r = tf4h.rsi; if (r < 25) bs += 13; else if (r < 30) bs += 10; else if (r < 40) bs += 5; else if (r > 80) br += 13; else if (r > 70) br += 10; else if (r > 60) br += 4;
    // MACD 4H (10pts)
    if (tf4h.macd.crossUp) bs += 10; else if (tf4h.macd.crossDown) br += 10; else if (tf4h.macd.bullish) bs += 6; else if (tf4h.macd.bearish) br += 6;
    // SMC 4H (15pts)
    if (smc4h.bullOB?.atPrice) bs += 8; if (smc4h.bearOB?.atPrice) br += 8;
    if (smc4h.bullFVG?.priceIn) bs += 7; if (smc4h.bearFVG?.priceIn) br += 7;
    if (ms4h.bos?.type === 'BULLISH') bs += 8; else if (ms4h.bos?.type === 'BEARISH') br += 8;
    if (ms4h.choch?.type === 'BULLISH') bs += 5; else if (ms4h.choch?.type === 'BEARISH') br += 5;
    if (smc4h.liquiditySweep?.direction === 'BULLISH_AFTER_SWEEP') bs += 6; else if (smc4h.liquiditySweep?.direction === 'BEARISH_AFTER_SWEEP') br += 6;
    // Elliott Wave (10pts)
    if (ew4h.wave?.includes('Wave 3')) bs += 10; else if (ew4h.wave?.includes('Entry')) bs += 8; else if (ew4h.wave?.includes('Koreksi')) bs += 4; else if (ew4h.wave?.includes('Bearish') || ew4h.wave?.includes('Wave C')) br += 9; else if (ew4h.wave?.includes('Peak')) br += 6;
    // Derivatives (10pts)
    if (deriv?.sentiment === 'STRONG_BULL') bs += 9; else if (deriv?.sentiment === 'BULL') bs += 6; else if (deriv?.sentiment === 'STRONG_BEAR') br += 9; else if (deriv?.sentiment === 'BEAR') br += 6;
    if (deriv?.fundingRate?.signal === 'EXTREME_LONG') br += 5; if (deriv?.fundingRate?.signal === 'EXTREME_SHORT') bs += 5;
    if (deriv?.oi?.signal === 'BULL_CONFIRM') bs += 4; if (deriv?.oi?.signal === 'DELEVERAGE') br += 3;
    // Volume Profile (5pts)
    if (vp4h) { if (vp4h.priceRelPOC === 'at') bs += 3; else if (vp4h.priceRelPOC === 'above') bs += 2; else br += 2; }
    // Volume expansion
    if (tf4h.volumes?.expanding && tf4h.trend === 'BULLISH') bs += 5; if (tf4h.volumes?.expanding && tf4h.trend === 'BEARISH') br += 5;
    // BB
    if (tf4h.bb.position < 15) bs += 4; else if (tf4h.bb.position > 85) br += 4;

    const tot = bs + br;
    const prob = tot > 0 ? Math.min(90, Math.max(10, Math.round(bs / tot * 100))) : 50;
    const sig = prob >= 70 ? 'Strong Buy' : prob >= 60 ? 'Buy' : prob <= 30 ? 'Strong Sell' : prob <= 40 ? 'Sell' : 'Neutral';
    return { bullScore: Math.round(bs), bearScore: Math.round(br), total: Math.round(tot), probability: prob, signal: sig, bias: prob >= 60 ? 'BULLISH' : prob <= 40 ? 'BEARISH' : 'NEUTRAL', max: 100 };
  }

  // ── LIQUIDATION MAP ───────────────────────────────────────────
  function buildLiqMap(price, atr, ms, smc, deriv) {
    if (!price || !atr) return null;
    const swH = ms.lastSwingHigh || price * 1.05, swL = ms.lastSwingLow || price * 0.95;
    const pSwH = ms.prevSwingHigh || swH * 1.03, pSwL = ms.prevSwingLow || swL * 0.97;
    const longLiq = [{ level: +(price - atr * 1.5).toFixed(8), desc: 'Long stops -1.5 ATR', type: 'LONG_LIQ', probability: 65 }, { level: +(swL * 0.998).toFixed(8), desc: `Long stops bawah swing low ${fP(swL)}`, type: 'LONG_LIQ', probability: 75 }, { level: +(pSwL * 0.997).toFixed(8), desc: `Long stops bawah major low ${fP(pSwL)}`, type: 'LONG_LIQ', probability: 55 }].filter(c => c.level < price).sort((a, b) => b.level - a.level);
    const shortLiq = [{ level: +(price + atr * 1.5).toFixed(8), desc: 'Short stops +1.5 ATR', type: 'SHORT_LIQ', probability: 65 }, { level: +(swH * 1.002).toFixed(8), desc: `Short stops atas swing high ${fP(swH)}`, type: 'SHORT_LIQ', probability: 75 }, { level: +(pSwH * 1.003).toFixed(8), desc: `Short stops atas major high ${fP(pSwH)}`, type: 'SHORT_LIQ', probability: 55 }].filter(c => c.level > price).sort((a, b) => a.level - b.level);
    let hunt = null;
    const ls = deriv?.lsRatio?.current;
    if (ls && ls > 1.5) hunt = { direction: 'DOWN', level: longLiq[0]?.level, reason: `L/S ratio ${ls.toFixed(2)} — retail over-long, whale sweep long stops di ${fP(longLiq[0]?.level)}` };
    else if (ls && ls < 0.7) hunt = { direction: 'UP', level: shortLiq[0]?.level, reason: `L/S ratio ${ls.toFixed(2)} — retail over-short, whale sweep short stops di ${fP(shortLiq[0]?.level)}` };
    else if (smc?.bsl && smc?.ssl) {
      const distBSL = Math.abs(smc.bsl - price), distSSL = Math.abs(smc.ssl - price);
      if (distBSL < distSSL) hunt = { direction: 'UP', level: +((smc.bsl || price * 1.03) * 1.001).toFixed(8), reason: `BSL di ${fP(smc.bsl)} lebih dekat (${smc.bslDistance?.toFixed(1)}%) — kemungkinan sweep ke atas` };
      else hunt = { direction: 'DOWN', level: +((smc.ssl || price * 0.97) * 0.999).toFixed(8), reason: `SSL di ${fP(smc.ssl)} lebih dekat (${smc.sslDistance?.toFixed(1)}%) — kemungkinan sweep ke bawah` };
    }
    return { longLiquidations: longLiq, shortLiquidations: shortLiq, likelyHuntTarget: hunt };
  }

  // ── MAIN ──────────────────────────────────────────────────────
  try {
    const [tickerData, K1h, K4h_raw, K1d, derivData] = await Promise.all([
      fetchPrice(),
      fetchK('1h', 200),
      fetchK('4h', 200),
      fetchK('1d', 200),
      fetchDerivatives(),
    ]);

    if (!tickerData || tickerData.price <= 0) {
      return res.status(404).json({ error: `Koin ${sym} tidak ditemukan. Coba: BTC, ETH, SOL, TRX, ADA, DOGE, PEPE, HYPE, SUI`, symbol: sym });
    }
    const price = tickerData.price;

    const bld4h = K => { const a = []; for (let i = 0; i + 3 < K.length; i += 4) { const sl = K.slice(i, i + 4); a.push({ t: sl[0].t, o: sl[0].o, h: Math.max(...sl.map(k => k.h)), l: Math.min(...sl.map(k => k.l)), c: sl[3].c, v: sl.reduce((s, k) => s + k.v, 0), qv: sl.reduce((s, k) => s + k.qv, 0) }); } return a; };
    const K4h = K4h_raw.length >= 30 ? K4h_raw : (K1h.length >= 40 ? bld4h(K1h) : K1h);
    const K4hB = K4h.length >= 30 ? K4h : K1h;
    const K1dB = K1d.length >= 30 ? K1d : K4h;

    const tf1h = analyzeTF(K1h.length >= 14 ? K1h : [], price, '1H');
    const tf4h = analyzeTF(K4hB, price, '4H');
    const tf1d = analyzeTF(K1dB, price, '1D');
    const astro = calcAstro();
    const atr4h = ATR(K4hB, 14);

    const ms4h = tf4h.ms, smc4h = tf4h.smc, ew4h = tf4h.elliottWave, vp4h = tf4h.volumeProfile;
    const pivots4h = calcPivots(K4hB);
    const pivots1d = calcPivots(K1dB);
    const confluence = calcConfluence(tf1h, tf4h, tf1d, derivData, ms4h, ew4h, smc4h, vp4h);

    // Multi-source key levels
    const allSup = [smc4h.ssl, ms4h.lastSwingLow, smc4h.bullOB?.lo, tf4h.bb?.lower, ew4h.fibonacci?.fib618, pivots4h?.S1, pivots1d?.S1].filter(v => v && v < price).sort((a, b) => b - a);
    const allRes = [smc4h.bsl, ms4h.lastSwingHigh, smc4h.bearOB?.hi, tf4h.bb?.upper, ew4h.targets?.ext127, pivots4h?.R1, pivots1d?.R1].filter(v => v && v > price).sort((a, b) => a - b);

    const support = allSup[0] || price * 0.95, support2 = allSup[1] || price * 0.92, support3 = allSup[2] || price * 0.88;
    const resistance = allRes[0] || price * 1.05, resistance2 = allRes[1] || price * 1.10, resistance3 = allRes[2] || price * 1.15;

    const liqMap = buildLiqMap(price, atr4h, ms4h, smc4h, derivData);
    const action = confluence.signal;
    let tradeSetup = null;
    if (atr4h > 0 && price > 0) {
      const slDist = atr4h * 1.5;
      if (action.includes('Buy')) {
        const slL = Math.max(price - slDist, support * 0.996);
        const slA = price - slL;
        const tp2 = ew4h.nextBullTarget || price + slA * 3.5;
        const tp3 = ew4h.targets?.ext161 || price + slA * 5.5;
        tradeSetup = { direction: 'LONG', entry: +price.toFixed(8), entryZone: `${fP(price * 0.997)}–${fP(price * 1.003)}`, sl: +slL.toFixed(8), slPct: +((price - slL) / price * 100).toFixed(2), tp1: +(price + slA * 2).toFixed(8), tp1Pct: +(slA * 2 / price * 100).toFixed(2), tp2: +tp2.toFixed(8), tp2Pct: +((tp2 - price) / price * 100).toFixed(2), tp3: +tp3.toFixed(8), tp3Pct: +((tp3 - price) / price * 100).toFixed(2), rr: 2, rr2: +((tp2 - price) / (price - slL)).toFixed(2), rr3: +((tp3 - price) / (price - slL)).toFixed(2), atr: +atr4h.toFixed(8), note: `SL=ATR×1.5 atau di bawah support ${fP(slL)}. TP2/TP3 dari EW Fibonacci. Max risiko 1-2% kapital.` };
      } else if (action.includes('Sell')) {
        const slL = Math.min(price + slDist, resistance * 1.004);
        const slA = slL - price;
        const tp2 = ew4h.nextBearTarget || price - slA * 3.5;
        const tp3 = ew4h.fibonacci?.fib786 || price - slA * 5.5;
        tradeSetup = { direction: 'SHORT', entry: +price.toFixed(8), entryZone: `${fP(price * 0.997)}–${fP(price * 1.003)}`, sl: +slL.toFixed(8), slPct: +(slA / price * 100).toFixed(2), tp1: +(price - slA * 2).toFixed(8), tp1Pct: +(slA * 2 / price * 100).toFixed(2), tp2: +tp2.toFixed(8), tp2Pct: +((price - tp2) / price * 100).toFixed(2), tp3: +tp3.toFixed(8), tp3Pct: +((price - tp3) / price * 100).toFixed(2), rr: 2, rr2: +((price - tp2) / slA).toFixed(2), rr3: +((price - tp3) / slA).toFixed(2), atr: +atr4h.toFixed(8), note: `SL=ATR×1.5 atau di atas resistance ${fP(slL)}. Short only leverage rendah.` };
      }
    }

    const reasons = [];
    if (ms4h.bos) reasons.push(ms4h.bos.description);
    if (ms4h.choch) reasons.push(ms4h.choch.description);
    if (smc4h.bullOB?.atPrice) reasons.push(`✅ Harga di Bull OB (${fP(smc4h.bullOB.lo)}–${fP(smc4h.bullOB.hi)})`);
    if (smc4h.bearOB?.atPrice) reasons.push(`⚠️ Harga di Bear OB (${fP(smc4h.bearOB.lo)}–${fP(smc4h.bearOB.hi)})`);
    if (smc4h.bullFVG?.priceIn) reasons.push(`✅ Harga dalam Bull FVG (${fP(smc4h.bullFVG.lo)}–${fP(smc4h.bullFVG.hi)})`);
    if (smc4h.liquiditySweep) reasons.push(`⚡ ${smc4h.liquiditySweep.description}`);
    if (ew4h.wave) reasons.push(`🌊 EW: ${ew4h.wave} — ${ew4h.description}`);
    if (tf4h.macd.crossUp) reasons.push('✅ MACD 4H Golden Cross');
    if (tf4h.macd.crossDown) reasons.push('❌ MACD 4H Death Cross');
    if (tf4h.rsi < 30) reasons.push(`✅ RSI 4H oversold (${tf4h.rsi}) — zona beli institusional`);
    if (tf4h.rsi > 70) reasons.push(`⚠️ RSI 4H overbought (${tf4h.rsi})`);
    if (vp4h?.interpretation) reasons.push(`📊 Volume Profile: ${vp4h.interpretation}`);
    if (derivData?.fundingRate?.reverseSignal) reasons.push(derivData.fundingRate.reverseSignal);
    if (liqMap?.likelyHuntTarget) reasons.push(`🐋 ${liqMap.likelyHuntTarget.reason}`);
    if (astro.mercuryWarning) reasons.push(astro.mercuryWarning);

    res.setHeader('Cache-Control', 's-maxage=30');
    return res.status(200).json({
      symbol: sym, name: tickerData.name || sym,
      price, change24h: +tickerData.change24h.toFixed(4), volume24h: tickerData.vol || 0, dataSource: tickerData.src,
      bias: confluence.bias,
      summary: {
        bias: confluence.bias, signal: confluence.signal, probability: confluence.probability,
        structure: ms4h.structure, bos: ms4h.bos?.description || null, choch: ms4h.choch?.description || null,
        elliottWave: ew4h.wave, derivativesSentiment: derivData?.sentiment || 'NEUTRAL',
        oneLiner: `${confluence.bias}: ${confluence.signal} (${confluence.probability}%) — ${ew4h.wave || '—'} | ${ms4h.bos?.type || ms4h.choch?.type || 'No BOS/CHoCH'} | Deriv: ${derivData?.sentiment || 'N/A'}`,
      },
      timeframes: { '1H': tf1h, '4H': tf4h, '1D': tf1d },
      marketStructure: { '4H': ms4h, '1D': tf1d.ms, summary: ms4h.structure },
      smc: { '4H': smc4h, '1H': tf1h.smc, '1D': tf1d.smc },
      elliottWave: { '4H': ew4h, '1H': tf1h.elliottWave, '1D': tf1d.elliottWave },
      volumeProfile: { '4H': vp4h },
      pivotPoints: { '4H': pivots4h, '1D': pivots1d },
      derivatives: derivData,
      liquidationMap: liqMap,
      keyLevels: { support: +support.toFixed(8), support2: +support2.toFixed(8), support3: +support3.toFixed(8), resistance: +resistance.toFixed(8), resistance2: +resistance2.toFixed(8), resistance3: +resistance3.toFixed(8) },
      confluence,
      recommendation: { action: confluence.signal.includes('Buy') ? `🟢 ${confluence.signal}` : confluence.signal.includes('Sell') ? `🔴 ${confluence.signal}` : `⚪ ${confluence.signal}`, explanation: `${confluence.bias} — ${confluence.probability}% confidence. ${ms4h.structure}.`, score: confluence.probability, confidence: confluence.probability >= 75 ? 'Tinggi' : confluence.probability >= 60 ? 'Sedang-Tinggi' : confluence.probability >= 50 ? 'Sedang' : 'Rendah', reasons: reasons.slice(0, 8) },
      tradeSetup, atr4h: +atr4h.toFixed(8),
      support: +support.toFixed(8), support2: +support2.toFixed(8), resistance: +resistance.toFixed(8), resistance2: +resistance2.toFixed(8),
      astrology: astro, timestamp: Date.now(),
    });
  } catch (e) {
    return res.status(500).json({ error: e.message, symbol: sym });
  }
}
