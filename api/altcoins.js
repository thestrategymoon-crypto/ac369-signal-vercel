// api/altcoins.js - AC369 v23 CLEAN
// Pure ASCII, no backticks. Bybit + MEXC + CoinGecko parallel
const CACHE = { d: null, t: 0 };
const STAB = new Set(['USDT','USDC','BUSD','DAI','TUSD','FDUSD','USDE','USDP','GUSD','FRAX','LUSD','SUSD']);
const BAD = ['UP','DOWN','BULL','BEAR','3L','3S','2L','2S','5L','5S','HALF','1000'];
const isBad = function(s) { return BAD.some(function(b){return s.endsWith(b);})||STAB.has(s); };
const cl = function(v,mn,mx){return Math.max(mn,Math.min(mx,v));};
const N = function(v,d){d=d||0;var n=+v;return isNaN(n)||!isFinite(n)?d:n;};
const A = function(v){return Array.isArray(v)?v:[];};
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300,stale-while-revalidate=120');
  if (req.method === 'OPTIONS') return res.status(200).end();
  var t0 = Date.now();
  try {
    if (CACHE.d && Date.now() - CACHE.t < 300000) {
      return res.status(200).json(Object.assign({}, CACHE.d, { cached: true, elapsed: Date.now() - t0 }));
    }
    var g = async function(url, ms) {
      ms = ms || 3500;
      try {
        var ctrl = new AbortController();
        var tmr = setTimeout(function(){ctrl.abort();}, ms);
        var r = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json', 'User-Agent': 'AC369/23' } });
        clearTimeout(tmr);
        return r.ok ? await r.json() : null;
      } catch(e) { return null; }
    };
    var results = await Promise.allSettled([
      g('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=volume_desc&per_page=200&page=1&sparkline=false&price_change_percentage=24h', 3500),
      g('https://api.bybit.com/v5/market/tickers?category=linear', 3000),
      g('https://api.mexc.com/api/v3/ticker/24hr', 3000),
      g('https://api.alternative.me/fng/?limit=1&format=json', 2500),
    ]);
    var Rcg = results[0], Rby = results[1], Rmx = results[2], Rfg = results[3];
    var map = new Map();
    var bybitCount = 0, cgCount = 0, mexcCount = 0;
    try {
      A(Rby.value && Rby.value.result ? Rby.value.result.list : []).forEach(function(t) {
        try {
          var sym = (t.symbol || '').replace('USDT','').replace('PERP','').toUpperCase();
          if (!sym || isBad(sym)) return;
          var p = N(t.lastPrice), v = N(t.turnover24h), fr = N(t.fundingRate), oi = N(t.openInterestValue);
          if (p <= 0 || v < 500000) return;
          var prev = N(t.prevPrice24h || p);
          var ch24 = prev > 0 ? +((p - prev) / prev * 100).toFixed(3) : N(t.price24hPcnt) * 100;
          var h = N(t.highPrice24h || p*1.01), l = N(t.lowPrice24h || p*0.99);
          var pip = h > l ? cl((p-l)/(h-l)*100, 0, 100) : 50;
          map.set(sym, { sym: sym, price: p, ch24: ch24, vol: v, h: h, l: l, pip: pip, fr: fr, oi: oi, src: 'by', rsiReal: false });
          bybitCount++;
        } catch(e) {}
      });
    } catch(e) {}
    try {
      A(Rcg.value || []).forEach(function(coin) {
        try {
          var sym = (coin.symbol || '').toUpperCase();
          if (!sym || isBad(sym) || N(coin.current_price) <= 0) return;
          var p = N(coin.current_price), v = N(coin.total_volume), ch24 = N(coin.price_change_percentage_24h);
          var existing = map.get(sym);
          if (existing) {
            existing.mcap = N(coin.market_cap);
            existing.rank = N(coin.market_cap_rank);
            existing.name = coin.name;
          } else {
            var h = N(coin.high_24h || p*1.01), l = N(coin.low_24h || p*0.99);
            var pip = h > l ? cl((p-l)/(h-l)*100, 0, 100) : 50;
            if (v > 100000) {
              map.set(sym, { sym: sym, price: p, ch24: ch24, vol: v, h: h, l: l, pip: pip, fr: 0, oi: 0, src: 'cg', mcap: N(coin.market_cap), rank: N(coin.market_cap_rank), name: coin.name, rsiReal: false });
              cgCount++;
            }
          }
        } catch(e) {}
      });
    } catch(e) {}
    try {
      A(Rmx.value || []).forEach(function(t) {
        try {
          var sym = (t.symbol || '').replace('USDT','').toUpperCase();
          if (!sym || isBad(sym) || map.has(sym)) return;
          var p = N(t.lastPrice), v = N(t.quoteVolume);
          if (p <= 0 || v < 50000) return;
          var ch24 = N(t.priceChangePercent);
          var h = N(t.highPrice || p*1.01), l = N(t.lowPrice || p*0.99);
          var pip = h > l ? cl((p-l)/(h-l)*100, 0, 100) : 50;
          map.set(sym, { sym: sym, price: p, ch24: ch24, vol: v, h: h, l: l, pip: pip, fr: 0, oi: 0, src: 'mx', rsiReal: false });
          mexcCount++;
        } catch(e) {}
      });
    } catch(e) {}
    var fg = 50, fgLabel = 'Neutral';
    try {
      var fd = Rfg.value && Rfg.value.data && Rfg.value.data[0];
      if (fd) { fg = N(fd.value, 50); fgLabel = fd.value_classification || 'Neutral'; }
    } catch(e) {}
    var coins = [];
    map.forEach(function(coin) {
      var rsi = Math.round(cl(50 + (coin.pip-50)*0.45 + coin.ch24*2.2 + (coin.fr < -0.0005 ? -6 : coin.fr > 0.0005 ? 6 : 0), 12, 88));
      coin.rsi = rsi;
      var sig = 'SIDEWAYS', sigColor = '#7a8fa8', dir = 'WAIT', prob = 50, sigDesc = '';
      var fp = +(coin.fr * 100).toFixed(4);
      var ic = rsi >= 40 && rsi <= 60 && Math.abs(coin.ch24) < 2;
      if (rsi < 22 && coin.pip < 28 && coin.vol > 300000) { sig = 'CAPITULATION BUY'; sigColor = '#00ff88'; dir = 'LONG'; prob = 85; sigDesc = 'RSI ' + rsi + ' extreme oversold - bottom zone'; }
      else if (rsi < 28 && coin.ch24 > 0 && coin.fr < -0.0003 && coin.vol > 1e6 && coin.pip < 40) { sig = 'ABOUT TO FLY'; sigColor = '#00ffd0'; dir = 'LONG'; prob = 86; sigDesc = 'RSI ' + rsi + ' oversold + FR ' + fp + '% squeeze + momentum positif'; }
      else if (rsi < 30 && coin.vol > 200000 && coin.pip < 45) { sig = 'DEEP OVERSOLD'; sigColor = '#ff6b9d'; dir = 'LONG'; prob = 74; sigDesc = 'RSI ' + rsi + ' deep oversold - DCA zone'; }
      else if (coin.oi > 3e9 && coin.fr < -0.0004 && Math.abs(coin.ch24) < 1.5 && rsi >= 35 && rsi <= 55) { sig = 'WHALE ACCUM'; sigColor = '#00d4ff'; dir = 'LONG'; prob = 83; sigDesc = 'OI $' + (coin.oi/1e9).toFixed(1) + 'B + FR negatif + harga konsolidasi'; }
      else if (rsi < 40 && coin.vol > 500000 && coin.pip < 48 && (ic || coin.fr < -0.0001 || coin.ch24 > 0.3)) { sig = 'SMART ACCUMULATION'; sigColor = '#4af0ff'; dir = 'LONG'; prob = 80; sigDesc = 'RSI ' + rsi + ' - SM masuk diam-diam'; }
      else if (ic && rsi >= 40 && rsi <= 60 && Math.abs(coin.ch24) < 2) { sig = 'COILING'; sigColor = '#f0c040'; dir = 'WATCH'; prob = 71; sigDesc = 'ATR menyempit - energy terkumpul'; }
      else if (coin.ch24 > 5 && rsi >= 45 && rsi <= 70 && coin.vol > 5e6 && coin.pip > 58) { sig = 'BREAKOUT'; sigColor = '#00ffd0'; dir = 'LONG'; prob = 79; sigDesc = '+' + coin.ch24.toFixed(1) + '% breakout + vol $' + (coin.vol/1e6).toFixed(0) + 'M'; }
      else if (coin.ch24 > 2.5 && rsi >= 50 && rsi <= 68 && coin.vol > 3e6) { sig = 'MOMENTUM'; sigColor = '#66ff99'; dir = 'LONG'; prob = 70; sigDesc = '+' + coin.ch24.toFixed(1) + '% momentum + RSI ' + rsi; }
      else if (rsi < 36 && coin.ch24 > 0.5 && coin.pip > 18) { sig = 'OVERSOLD BOUNCE'; sigColor = '#88ff99'; dir = 'LONG'; prob = 76; sigDesc = 'RSI ' + rsi + ' oversold + reversal +' + coin.ch24.toFixed(1) + '%'; }
      else if (rsi > 72 && fp > 0.04 && coin.pip > 73) { sig = 'SHORT ZONE'; sigColor = '#ff4466'; dir = 'SHORT'; prob = 75; sigDesc = 'RSI ' + rsi + ' overbought + FR +' + fp + '% overheated'; }
      else if (rsi > 68 && coin.pip > 70 && coin.oi > 3e9) { sig = 'DISTRIBUTION'; sigColor = '#ff8800'; dir = 'SHORT'; prob = 67; sigDesc = 'RSI ' + rsi + ' premium + OI tinggi + SM distribusi'; }
      else if (coin.pip > 80 && coin.ch24 < -1.5 && rsi > 60 && coin.vol > 3e6) { sig = 'BULL TRAP'; sigColor = '#ff6644'; dir = 'SHORT'; prob = 65; sigDesc = 'Spike ke ' + coin.pip.toFixed(0) + '% lalu balik'; }
      else if (rsi >= 42 && rsi <= 62 && coin.ch24 > 0.5) { sig = 'MILD BULL'; sigColor = '#a0e040'; dir = 'LONG'; prob = 64; sigDesc = '+' + coin.ch24.toFixed(1) + '% + RSI ' + rsi; }
      coin.sig = sig; coin.sigColor = sigColor; coin.dir = dir; coin.prob = prob; coin.sigDesc = sigDesc;
      var f1 = rsi < 20 ? 30 : rsi < 28 ? 24 : rsi < 35 ? 18 : rsi < 42 ? 10 : rsi < 50 ? 3 : rsi > 78 ? -18 : rsi > 72 ? -12 : rsi > 65 ? -5 : 0;
      var f2 = coin.fr < -0.0008 ? 22 : coin.fr < -0.0005 ? 16 : coin.fr < -0.0002 ? 9 : coin.fr < 0 ? 4 : coin.fr > 0.0008 ? -17 : coin.fr > 0.0005 ? -11 : coin.fr > 0.0002 ? -5 : 0;
      var f3 = coin.vol > 500e6 ? 8 : coin.vol > 100e6 ? 5 : coin.vol > 20e6 ? 3 : coin.vol > 5e6 ? 1 : coin.vol < 100000 ? -4 : 0;
      f3 += coin.ch24 > 8 ? 6 : coin.ch24 > 3 ? 3 : coin.ch24 > 0 ? 1 : coin.ch24 < -8 ? -6 : coin.ch24 < -3 ? -3 : coin.ch24 < 0 ? -1 : 0;
      var f5 = coin.oi > 10e9 && coin.fr < -0.0002 ? 10 : coin.oi > 5e9 ? 5 : coin.oi > 2e9 ? 2 : 0;
      coin.conv = Math.max(0, Math.min(100, Math.round(45 + f1 + f2 + f3 + f5)));
      coin.convLabel = coin.conv >= 82 ? 'ELITE' : coin.conv >= 72 ? 'PRIME' : coin.conv >= 62 ? 'VALID' : coin.conv >= 52 ? 'MOD' : 'WEAK';
      coins.push(coin);
    });
    coins.sort(function(a, b) { return b.vol - a.vol; });
    var pos = coins.filter(function(c){return c.ch24 > 0;}).length;
    var neg = coins.filter(function(c){return c.ch24 < 0;}).length;
    var avg24 = coins.length ? +(coins.reduce(function(s,c){return s+c.ch24;}, 0) / coins.length).toFixed(2) : 0;
    var sig2 = avg24 > 3 ? 'BULLISH' : avg24 > 1 ? 'MILD BULL' : avg24 < -3 ? 'BEARISH' : avg24 < -1 ? 'MILD BEAR' : 'NEUTRAL';
    var osCoins = coins.filter(function(c){return c.rsi < 30;}).length;
    var obCoins = coins.filter(function(c){return c.rsi > 70;}).length;
    var gainers = coins.filter(function(c){return c.ch24 > 0 && c.vol > 500000;}).sort(function(a,b){return b.ch24-a.ch24;}).slice(0,30).map(function(c){return {sym:c.sym,symbol:c.sym,price:c.price,ch24:+c.ch24.toFixed(2),vol:c.vol,rsi:c.rsi,sig:c.sig,conv:c.conv};});
    var losers = coins.filter(function(c){return c.ch24 < -1 && c.vol > 1e6;}).sort(function(a,b){return a.ch24-b.ch24;}).slice(0,20).map(function(c){return {sym:c.sym,symbol:c.sym,price:c.price,ch24:+c.ch24.toFixed(2),vol:c.vol,rsi:c.rsi,sig:c.sig};});
    var vols = coins.filter(function(c){return c.vol > 2e6;}).sort(function(a,b){return b.vol-a.vol;}).slice(0,30).map(function(c){
      var bt = c.ch24 > 8 && c.pip > 65 ? 'BREAKOUT' : c.ch24 > 3 ? 'Strong Bull' : c.ch24 < -8 && c.pip < 35 ? 'Bear Dump' : c.ch24 < -3 ? 'Selling' : c.oi > 5e9 ? 'Whale Zone' : 'STEALTH';
      var btColor = bt === 'BREAKOUT' || bt === 'Strong Bull' ? 'green' : bt === 'Bear Dump' || bt === 'Selling' ? 'red' : bt === 'Whale Zone' ? 'cyan' : 'amber';
      return {sym:c.sym,symbol:c.sym,price:c.price,ch24:+c.ch24.toFixed(2),vol:c.vol,bType:bt,bColor:btColor,rsi:c.rsi,fr:c.fr,oi:c.oi,sig:c.sig};
    });
    var rsiList = coins.filter(function(c){return c.vol > 200000;}).sort(function(a,b){return a.rsi-b.rsi;}).slice(0,50).map(function(c){return {sym:c.sym,symbol:c.sym,price:c.price,ch24:+c.ch24.toFixed(2),vol:c.vol,rsi:c.rsi,rsiReal:false,sig:c.sig,conv:c.conv,fr:c.fr};});
    var topSetups = coins.filter(function(c){return c.dir === 'LONG' && c.conv >= 60;}).sort(function(a,b){return b.conv-a.conv;}).slice(0,20).map(function(c){return {sym:c.sym,price:c.price,ch24:+c.ch24.toFixed(2),vol:c.vol,rsi:c.rsi,sig:c.sig,sigColor:c.sigColor,conv:c.conv,convLabel:c.convLabel,dir:c.dir,prob:c.prob,fr:c.fr,oi:c.oi};});
    var shortSetups = coins.filter(function(c){return c.dir === 'SHORT' && c.conv >= 60;}).sort(function(a,b){return b.conv-a.conv;}).slice(0,10).map(function(c){return {sym:c.sym,price:c.price,ch24:+c.ch24.toFixed(2),vol:c.vol,rsi:c.rsi,sig:c.sig,conv:c.conv,dir:c.dir,prob:c.prob};});
    var sigBreakdown = {};
    coins.forEach(function(c){sigBreakdown[c.sig] = (sigBreakdown[c.sig] || 0) + 1;});
    var eliteCoins = coins.filter(function(c){return c.conv >= 82;}).length;
    var primeCoins = coins.filter(function(c){return c.conv >= 72 && c.conv < 82;}).length;
    var topBullSym = gainers.slice(0,3).map(function(c){return c.sym;}).join(', ');
    var marketMood = osCoins > coins.length * 0.15 ? 'MASS OVERSOLD - akumulasi agresif' : osCoins > coins.length * 0.08 ? 'BANYAK OVERSOLD - DCA bertahap' : sig2 === 'BULLISH' ? 'BULLISH MOMENTUM - momentum positif' : sig2 === 'BEARISH' ? 'BEARISH PRESSURE - hati-hati' : obCoins > coins.length * 0.15 ? 'MASS OVERBOUGHT - kurangi exposure' : 'KONSOLIDASI - selektif';
    var narasi = marketMood + '. F&G ' + fg + '/100 (' + fgLabel + '). ' + osCoins + ' koin oversold dari ' + coins.length + ' total. Elite: ' + eliteCoins + '. Prime: ' + primeCoins + '.' + (topBullSym ? ' Best movers: ' + topBullSym + '.' : '');
    var btcEntry = map.get('BTC') || {};
    var ethEntry = map.get('ETH') || {};
    var bpx = btcEntry.price || 0, epx = ethEntry.price || 0;
    var bch = btcEntry.ch24 || 0, ech = ethEntry.ch24 || 0;
    var out = {
      ok: true, version: 'v23', ts: Date.now(), elapsed: Date.now() - t0,
      src: 'by(' + bybitCount + ')+cg(' + cgCount + ')+mx(' + mexcCount + ')',
      fg: fg, fgLabel: fgLabel,
      market: { signal: sig2, avg24h: avg24, pos: pos, neg: neg, osCoins: osCoins, obCoins: obCoins, eliteCoins: eliteCoins, primeCoins: primeCoins, totalCoins: coins.length, totalVol: coins.reduce(function(s,c){return s+c.vol;}, 0), bigMove: coins.filter(function(c){return Math.abs(c.ch24) > 10;}).length },
      gainers: gainers, topGainers: gainers,
      losers: losers, topLosers: losers,
      volBreakouts: vols, volumeBreakouts: vols,
      rsiList: rsiList, rsiExtremes: rsiList,
      topSetups: topSetups, shortSetups: shortSetups,
      sigBreakdown: sigBreakdown,
      narasi: narasi,
      smartMoneyNarrative: narasi,
      btcData: { price: bpx, ch24: bch, rsi: btcEntry.rsi || null, fr: btcEntry.fr || null, sig: btcEntry.sig || null },
      ethData: { price: epx, ch24: ech, rsi: ethEntry.rsi || null, fr: ethEntry.fr || null, sig: ethEntry.sig || null },
      realRSICount: 0,
    };
    CACHE.d = out; CACHE.t = Date.now();
    return res.status(200).json(out);
  } catch(e) {
    return res.status(200).json({ ok: false, error: String(e.message || e), version: 'v23', ts: Date.now(), elapsed: Date.now()-t0, fg: 50, market: { signal: 'NEUTRAL', avg24h: 0, pos: 0, neg: 0 }, gainers: [], topGainers: [], volBreakouts: [], rsiList: [], topSetups: [], narasi: 'Data tidak tersedia sementara.', smartMoneyNarrative: 'Data tidak tersedia sementara.' });
  }
}
