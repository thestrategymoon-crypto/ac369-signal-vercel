// api/analytics.js - AC369 v5 CLEAN
// BTC + ETH technical analysis for Analisis BTC/ETH tab
// Pure ASCII, no backticks, no template literals
const CACHE = { d: null, t: 0 };
const N = function(v, d) { d = d||0; var n = +v; return isNaN(n)||!isFinite(n) ? d : n; };
const A = function(v) { return Array.isArray(v) ? v : []; };
var rsi14 = function(cls) {
  try {
    if (!cls || cls.length < 16) return null;
    var g = 0, l = 0;
    for (var i = 1; i <= 14; i++) {
      var d = cls[cls.length - i] - cls[cls.length - i - 1];
      if (d > 0) g += d; else l -= d;
    }
    var ag = g/14, al = l/14;
    if (al === 0) return 100;
    return +(100 - 100/(1 + ag/al)).toFixed(2);
  } catch(e) { return null; }
};
var ema = function(cls, p) {
  try {
    if (!cls || cls.length < 2) return N(cls && cls[cls.length-1]);
    var k = 2/(p+1);
    return cls.reduce(function(prev, v, i) { return i === 0 ? v : prev*(1-k) + v*k; });
  } catch(e) { return 0; }
};
var macdCalc = function(cls) {
  try {
    if (!cls || cls.length < 36) return null;
    var k12 = 2/13, k26 = 2/27;
    var e12 = cls[0], e26 = cls[0];
    cls.forEach(function(v) { e12 = e12*(1-k12) + v*k12; e26 = e26*(1-k26) + v*k26; });
    var ml = e12 - e26, sig = ml * (2/10);
    return { bull: ml > sig && ml > 0, crossUp: ml > sig && ml < 0, crossDown: ml < sig && ml > 0, val: +ml.toFixed(6) };
  } catch(e) { return null; }
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300,stale-while-revalidate=120');
  if (req.method === 'OPTIONS') return res.status(200).end();
  var t0 = Date.now();
  var SAFE_RESP = {
    ok: false, version: 'v5', ts: Date.now(), elapsed: 0,
    btc: { currentPrice: 0, change24h: 0, action: 'HOLD', probabilityScore: 50, technicalSummary: 'Data tidak tersedia', rsi: { '4h': 50 }, macd: { '4h': {} }, bb: { '4h': { squeeze: false } } },
    eth: { currentPrice: 0, change24h: 0, action: 'HOLD', probabilityScore: 50, technicalSummary: 'Data tidak tersedia', rsi: { '4h': 50 }, macd: { '4h': {} }, bb: { '4h': { squeeze: false } } },
    smartMoneyNarrative: 'Mengambil data pasar...'
  };
  try {
    if (CACHE.d && Date.now() - CACHE.t < 300000) {
      return res.status(200).json(Object.assign({}, CACHE.d, { cached: true, elapsed: Date.now() - t0 }));
    }
    var g = async function(url, ms) {
      ms = ms || 3000;
      try {
        var ctrl = new AbortController();
        var tmr = setTimeout(function(){ctrl.abort();}, ms);
        var r = await fetch(url, { signal: ctrl.signal });
        clearTimeout(tmr);
        return r.ok ? await r.json() : null;
      } catch(e) { return null; }
    };
    var results = await Promise.allSettled([
      g('https://api.mexc.com/api/v3/klines?symbol=BTCUSDT&interval=4h&limit=52', 2500),
      g('https://api.mexc.com/api/v3/klines?symbol=ETHUSDT&interval=4h&limit=52', 2500),
      g('https://api.bybit.com/v5/market/tickers?category=linear', 2500),
      g('https://api.alternative.me/fng/?limit=1&format=json', 2000),
      g('https://api.mexc.com/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=30', 2000),
      g('https://api.mexc.com/api/v3/klines?symbol=ETHUSDT&interval=1d&limit=30', 2000),
    ]);
    var Rbtc4h = results[0], Reth4h = results[1], Rby = results[2], Rfg = results[3];
    var Rbtc1d = results[4], Reth1d = results[5];

    // Fear & Greed
    var fg = 50, fgLabel = 'Neutral';
    try {
      var fd = Rfg.value && Rfg.value.data && Rfg.value.data[0];
      if (fd) { fg = N(fd.value, 50); fgLabel = fd.value_classification || 'Neutral'; }
    } catch(e) {}

    // BTC prices from Bybit
    var btcP = 0, btcCh = 0, ethP = 0, ethCh = 0;
    try {
      A(Rby.value && Rby.value.result ? Rby.value.result.list : []).forEach(function(t) {
        var sym = (t.symbol||'').replace('USDT','').replace('PERP','');
        var p = N(t.lastPrice), prev = N(t.prevPrice24h || p);
        var ch = prev > 0 ? +((p-prev)/prev*100).toFixed(2) : 0;
        if (sym === 'BTC') { btcP = p; btcCh = ch; }
        if (sym === 'ETH') { ethP = p; ethCh = ch; }
      });
    } catch(e) {}

    // Process coin klines into technical analysis
    var analyzeCoin = function(klineRaw, kline1dRaw, price, change24h, name) {
      var result = {
        currentPrice: price, change24h: change24h,
        action: 'HOLD', probabilityScore: 50,
        technicalSummary: '',
        rsi: { '4h': 50, '1d': null },
        macd: { '4h': {} },
        bb: { '4h': { squeeze: false } }
      };
      try {
        var raw4h = Array.isArray(klineRaw) ? klineRaw : [];
        if (raw4h.length < 16) return result;
        var K = raw4h.map(function(d){return {o:N(d[1]),h:N(d[2]),l:N(d[3]),c:N(d[4]),v:N(d[5])};});
        var cls = K.map(function(k){return k.c;}).filter(function(v){return v>0;});
        if (cls.length < 16) return result;
        // RSI 4H
        var rsi4h = rsi14(cls);
        result.rsi['4h'] = rsi4h ? +rsi4h.toFixed(1) : 50;
        // RSI 1D
        try {
          var raw1d = Array.isArray(kline1dRaw) ? kline1dRaw : [];
          if (raw1d.length >= 16) {
            var cls1d = raw1d.map(function(d){return N(d[4]);}).filter(function(v){return v>0;});
            var rsi1d = rsi14(cls1d);
            result.rsi['1d'] = rsi1d ? +rsi1d.toFixed(1) : null;
          }
        } catch(e2) {}
        // MACD 4H
        var macd4h = macdCalc(cls);
        if (macd4h) { result.macd['4h'] = { bull: macd4h.bull, crossUp: macd4h.crossUp, crossDown: macd4h.crossDown, val: macd4h.val }; }
        // EMA
        var e9 = ema(cls.slice(-9), 9);
        var e21 = ema(cls.slice(-21), 21);
        var e200 = ema(cls, 200);
        var aboveE200 = price > 0 && e200 > 0 ? price > e200 : false;
        var aboveE21 = price > 0 && e21 > 0 ? price > e21 : false;
        // Bollinger Bands squeeze (simplified)
        var last20 = cls.slice(-20);
        var mean20 = last20.reduce(function(s,v){return s+v;},0)/20;
        var std20 = Math.sqrt(last20.reduce(function(s,v){return s+Math.pow(v-mean20,2);},0)/20);
        var bbWidth = (std20*4)/mean20;
        result.bb['4h'] = { squeeze: bbWidth < 0.06, width: +bbWidth.toFixed(4), upper: +(mean20+std20*2).toFixed(2), lower: +(mean20-std20*2).toFixed(2) };
        // RSI slope
        var rsiPrev = rsi14(cls.slice(0,-1));
        var rsiSlope = rsi4h && rsiPrev ? (rsi4h > rsiPrev + 0.5 ? 'rising' : rsi4h < rsiPrev - 0.5 ? 'falling' : 'flat') : 'flat';
        // Divergence
        var div = null;
        try {
          var p4 = cls[cls.length-5]||price, p8 = cls[cls.length-9]||price;
          var r4 = rsi14(cls.slice(0,-4)), r8 = rsi14(cls.slice(0,-8));
          if (r4 && r8) {
            if (price < p4 && p4 < p8 && rsi4h > r4 && r4 > r8) div = 'BULLISH DIVERGENCE';
            else if (price > p4 && p4 > p8 && rsi4h < r4 && r4 < r8) div = 'BEARISH DIVERGENCE';
          }
        } catch(e2) {}
        // Volume trend
        var vols = K.slice(-5).map(function(k){return k.v;});
        var volTrend = vols.length >= 3 ? (vols[vols.length-1] > vols[vols.length-2]*1.2 ? 'naik' : vols[vols.length-1] < vols[vols.length-2]*0.8 ? 'turun' : 'stabil') : 'stabil';
        // Determine ACTION and PROBABILITY
        var score = 0;
        if (rsi4h < 30) score += 3;
        else if (rsi4h < 40) score += 2;
        else if (rsi4h > 70) score -= 3;
        else if (rsi4h > 60) score -= 1;
        if (macd4h && macd4h.crossUp) score += 2;
        else if (macd4h && macd4h.bull) score += 1;
        else if (macd4h && macd4h.crossDown) score -= 2;
        if (aboveE200) score += 1; else score -= 1;
        if (aboveE21) score += 1; else score -= 1;
        if (div === 'BULLISH DIVERGENCE') score += 2;
        else if (div === 'BEARISH DIVERGENCE') score -= 2;
        if (rsiSlope === 'rising') score += 1;
        else if (rsiSlope === 'falling') score -= 1;
        if (fg < 30) score += 1; else if (fg > 70) score -= 1;
        var action, prob;
        if (score >= 5) { action = 'STRONG BUY'; prob = 82; }
        else if (score >= 3) { action = 'BUY'; prob = 73; }
        else if (score >= 1) { action = 'MILD BUY'; prob = 65; }
        else if (score <= -5) { action = 'STRONG SELL'; prob = 78; }
        else if (score <= -3) { action = 'SELL'; prob = 70; }
        else if (score <= -1) { action = 'MILD SELL'; prob = 62; }
        else { action = 'HOLD'; prob = 55; }
        result.action = action;
        result.probabilityScore = prob;
        // Technical summary
        var parts = [];
        parts.push('RSI 4H: ' + result.rsi['4h'] + ' (' + rsiSlope + ')');
        if (result.rsi['1d']) parts.push('RSI 1D: ' + result.rsi['1d']);
        parts.push('Harga ' + (aboveE200 ? 'di atas' : 'di bawah') + ' 200 EMA');
        if (macd4h && macd4h.crossUp) parts.push('MACD cross UP (bullish)');
        else if (macd4h && macd4h.crossDown) parts.push('MACD cross DOWN (bearish)');
        else if (macd4h && macd4h.bull) parts.push('MACD bullish momentum');
        if (div) parts.push(div + ' terdeteksi');
        if (result.bb['4h'].squeeze) parts.push('Bollinger Bands squeeze - breakout segera');
        parts.push('Volume ' + volTrend);
        result.technicalSummary = parts.join('. ') + '.';
        // Extra fields for display
        result.rsiSlope = rsiSlope;
        result.divergence = div;
        result.aboveEma200 = aboveE200;
        result.e200 = e200 > 0 ? +e200.toFixed(2) : null;
        result.e21 = e21 > 0 ? +e21.toFixed(2) : null;
        result.volTrend = volTrend;
        result.score = score;
      } catch(e) {}
      return result;
    };

    var btcData = analyzeCoin(
      Array.isArray(Rbtc4h.value) ? Rbtc4h.value : [],
      Array.isArray(Rbtc1d.value) ? Rbtc1d.value : [],
      btcP, btcCh, 'BTC'
    );
    var ethData = analyzeCoin(
      Array.isArray(Reth4h.value) ? Reth4h.value : [],
      Array.isArray(Reth1d.value) ? Reth1d.value : [],
      ethP, ethCh, 'ETH'
    );

    // Smart Money Narrative
    var btcRsi = btcData.rsi['4h'];
    var ethRsi = ethData.rsi['4h'];
    var fgNote = fg < 25 ? 'Extreme Fear (' + fg + ') = zona akumulasi historis terbaik.' : fg < 40 ? 'Fear (' + fg + ') = akumulasi bertahap.' : fg > 75 ? 'Extreme Greed (' + fg + ') = kurangi posisi.' : fg > 60 ? 'Greed (' + fg + ') = sizing kecil.' : 'F&G Neutral (' + fg + ') = selektif.';
    var btcNote = btcRsi < 30 ? 'BTC RSI ' + btcRsi + ' (OVERSOLD) - zona DCA.' : btcRsi > 70 ? 'BTC RSI ' + btcRsi + ' (OVERBOUGHT) - take profit.' : 'BTC RSI ' + btcRsi + ' - neutral range.';
    var ethNote = ethRsi < 30 ? 'ETH RSI ' + ethRsi + ' (OVERSOLD) - akumulasi.' : ethRsi > 70 ? 'ETH RSI ' + ethRsi + ' (OVERBOUGHT) - hati-hati.' : 'ETH RSI ' + ethRsi + ' - stabil.';
    var divNote = '';
    if (btcData.divergence) divNote += ' BTC: ' + btcData.divergence + '.';
    if (ethData.divergence) divNote += ' ETH: ' + ethData.divergence + '.';
    var actionNote = 'BTC: ' + btcData.action + ' (' + btcData.probabilityScore + '%). ETH: ' + ethData.action + ' (' + ethData.probabilityScore + '%).';
    var smartMoneyNarrative = fgNote + ' ' + btcNote + ' ' + ethNote + divNote + ' ' + actionNote;

    var out = {
      ok: true, version: 'v5', ts: Date.now(), elapsed: Date.now() - t0,
      btc: btcData,
      eth: ethData,
      fg: fg, fgLabel: fgLabel,
      smartMoneyNarrative: smartMoneyNarrative,
    };
    CACHE.d = out; CACHE.t = Date.now();
    return res.status(200).json(out);
  } catch(e) {
    return res.status(200).json(Object.assign({}, SAFE_RESP, { ok: false, error: String(e.message||e), elapsed: Date.now()-t0 }));
  }
}
