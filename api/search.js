// api/search.js - AC369 FUSION Search & Deep Analysis
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'max-age=0, s-maxage=120');

  const symbol = (req.query.symbol || '').toUpperCase().trim();
  if (!symbol) {
    return res.status(400).json({ error: 'Parameter ?symbol= diperlukan. Contoh: /api/search?symbol=ADA' });
  }

  try {
    // 1. Ambil data harga dari CoinGecko
    const searchSymbol = symbol.toLowerCase();
    const cgRes = await fetch(
      `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${searchSymbol}&order=market_cap_desc&sparkline=false&price_change_percentage=24h`
    );
    if (!cgRes.ok) throw new Error('CoinGecko tidak merespons');
    const cgData = await cgRes.json();
    if (!cgData || cgData.length === 0) {
      return res.status(404).json({ error: `Koin "${symbol}" tidak ditemukan di CoinGecko.` });
    }
    const coinInfo = cgData[0];

    // 2. Ambil OHLCV dari Binance
    let ohlcv = [];
    try {
      const binanceRes = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}USDT&interval=1d&limit=100`);
      if (binanceRes.ok) {
        const data = await binanceRes.json();
        ohlcv = data.map(c => ({
          open: parseFloat(c[1]), high: parseFloat(c[2]), low: parseFloat(c[3]),
          close: parseFloat(c[4]), volume: parseFloat(c[5])
        }));
      }
    } catch (e) {
      console.warn('Binance fetch gagal, lanjut tanpa OHLCV:', e.message);
    }

    // 3. Jalankan semua analisis
    const change24h = coinInfo.price_change_percentage_24h || 0;
    const patterns = detectAllPatterns(ohlcv, change24h);
    const elliottWave = detectElliottWave(ohlcv, change24h);
    const smc = analyzeSMC(ohlcv, change24h);
    const astrology = getAstrologySignal(new Date());

    // 4. Hitung level support & resistance
    let support = (coinInfo.current_price * 0.95).toFixed(4);
    let resistance = (coinInfo.current_price * 1.05).toFixed(4);
    if (ohlcv.length >= 20) {
      const recentLows = ohlcv.slice(-20).map(c => c.low);
      const recentHighs = ohlcv.slice(-20).map(c => c.high);
      support = Math.min(...recentLows).toFixed(4);
      resistance = Math.max(...recentHighs).toFixed(4);
    }

    // 5. Hitung RSI jika memungkinkan
    let rsi = 'N/A';
    if (ohlcv.length >= 14) {
      const closes = ohlcv.map(c => c.close);
      rsi = calculateRSI(closes, 14).toFixed(1);
    }

    // 6. Volume breakout
    let volumeNote = 'Normal';
    if (ohlcv.length >= 20) {
      const avgVol = ohlcv.slice(-20, -1).reduce((s, c) => s + c.volume, 0) / 20;
      const lastVol = ohlcv[ohlcv.length - 1].volume;
      if (lastVol > avgVol * 2.5) volumeNote = `🔥 Breakout ${((lastVol / avgVol).toFixed(1))}x rata-rata`;
      else if (lastVol > avgVol * 1.5) volumeNote = `📈 Di atas rata-rata (${(lastVol / avgVol).toFixed(1)}x)`;
    }

    // 7. Bangun respons
    const result = {
      symbol: symbol,
      name: coinInfo.name,
      price: coinInfo.current_price,
      change24h: change24h,
      marketCap: coinInfo.market_cap,
      volume24h: coinInfo.total_volume,
      rsi: rsi,
      support: support,
      resistance: resistance,
      volumeNote: volumeNote,
      chartPatterns: patterns.slice(0, 5),
      elliottWave: elliottWave,
      smc: smc,
      astrology: astrology,
      timestamp: new Date().toISOString()
    };

    res.status(200).json(result);
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: error.message });
  }
}

// ==================== POLA GRAFIK ====================
function detectAllPatterns(ohlcv, change24h) {
  const patterns = [];
  if (!ohlcv || ohlcv.length < 2) {
    if (change24h > 5) patterns.push({ name: 'Momentum Bullish', signal: 'bullish', probability: 60 });
    else if (change24h < -5) patterns.push({ name: 'Momentum Bearish', signal: 'bearish', probability: 60 });
    else patterns.push({ name: 'Sideways', signal: 'neutral', probability: 40 });
    return patterns;
  }

  const last = ohlcv[ohlcv.length - 1];
  const prev = ohlcv[ohlcv.length - 2];
  const body = Math.abs(last.close - last.open);
  const lowerWick = Math.min(last.open, last.close) - last.low;
  const upperWick = last.high - Math.max(last.open, last.close);
  const range = last.high - last.low;

  if (prev.close < prev.open && last.close > last.open && last.open <= prev.close && last.close >= prev.open)
    patterns.push({ name: 'Bullish Engulfing', signal: 'bullish', probability: 80 });
  else if (prev.close > prev.open && last.close < last.open && last.open >= prev.close && last.close <= prev.open)
    patterns.push({ name: 'Bearish Engulfing', signal: 'bearish', probability: 80 });
  else if (lowerWick > body * 2 && upperWick < body * 0.6)
    patterns.push({ name: 'Hammer (Bullish Reversal)', signal: 'bullish', probability: 75 });
  else if (upperWick > body * 2 && lowerWick < body * 0.6)
    patterns.push({ name: 'Shooting Star (Bearish Reversal)', signal: 'bearish', probability: 75 });
  else if (body < range * 0.15) {
    if (lowerWick > upperWick * 1.5) patterns.push({ name: 'Dragonfly Doji (Bullish)', signal: 'bullish', probability: 65 });
    else if (upperWick > lowerWick * 1.5) patterns.push({ name: 'Gravestone Doji (Bearish)', signal: 'bearish', probability: 65 });
    else patterns.push({ name: 'Doji (Indecision)', signal: 'neutral', probability: 50 });
  }

  if (ohlcv.length >= 3) {
    const c1 = ohlcv[ohlcv.length - 3], c2 = ohlcv[ohlcv.length - 2], c3 = ohlcv[ohlcv.length - 1];
    if (c1.close > c1.open && c2.close > c2.open && c3.close > c3.open && c2.close > c1.close && c3.close > c2.close)
      patterns.push({ name: 'Three White Soldiers (Strong Bullish)', signal: 'bullish', probability: 85 });
    if (c1.close < c1.open && c2.close < c2.open && c3.close < c3.open && c2.close < c1.close && c3.close < c2.close)
      patterns.push({ name: 'Three Black Crows (Strong Bearish)', signal: 'bearish', probability: 85 });
  }

  if (patterns.length === 0) {
    if (change24h > 5) patterns.push({ name: 'Breakout Bullish', signal: 'bullish', probability: 65 });
    else if (change24h < -5) patterns.push({ name: 'Breakdown Bearish', signal: 'bearish', probability: 65 });
    else patterns.push({ name: 'Sideways Stabil', signal: 'neutral', probability: 40 });
  }
  return patterns;
}

// ==================== ELLIOTT WAVE ====================
function detectElliottWave(ohlcv, change24h) {
  if (!ohlcv || ohlcv.length < 20) return { wave: 'Data OHLCV terbatas', confidence: 20, description: 'Gunakan data harga terbaru' };
  const swings = findSwingPoints(ohlcv, 3);
  if (swings.length < 3) return { wave: 'Struktur belum jelas', confidence: 25, description: 'Swing point tidak cukup' };

  const recent = swings.slice(-5);
  const highs = recent.filter(s => s.type === 'high');
  const lows = recent.filter(s => s.type === 'low');
  if (highs.length < 2 || lows.length < 2) return { wave: 'Menunggu formasi', confidence: 30, description: 'Pola belum terbentuk' };

  const lastHigh = highs[highs.length - 1], prevHigh = highs[highs.length - 2];
  const lastLow = lows[lows.length - 1], prevLow = lows[lows.length - 2];
  const currentPrice = ohlcv[ohlcv.length - 1].close;

  if (lastHigh.price > prevHigh.price && lastLow.price > prevLow.price)
    return { wave: 'Wave 3 (Impulsif)', confidence: 55, description: 'Tren naik terkonfirmasi' };
  if (lastHigh.price < prevHigh.price && lastLow.price < prevLow.price)
    return { wave: 'Wave Korektif (ABC)', confidence: 50, description: 'Fase koreksi sehat' };
  if (change24h > 5) return { wave: 'Potensi Wave 3', confidence: 40, description: 'Momentum naik' };
  if (change24h < -5) return { wave: 'Potensi Korektif', confidence: 40, description: 'Momentum turun' };
  return { wave: 'Konsolidasi', confidence: 30, description: 'Sideways' };
}

function findSwingPoints(ohlcv, lookback) {
  const swings = [];
  for (let i = lookback; i < ohlcv.length - lookback; i++) {
    let isSwingHigh = true, isSwingLow = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      if (ohlcv[j].high >= ohlcv[i].high) isSwingHigh = false;
      if (ohlcv[j].low <= ohlcv[i].low) isSwingLow = false;
    }
    if (isSwingHigh) swings.push({ index: i, price: ohlcv[i].high, type: 'high' });
    if (isSwingLow) swings.push({ index: i, price: ohlcv[i].low, type: 'low' });
  }
  return swings;
}

// ==================== SMC ====================
function analyzeSMC(ohlcv, change24h) {
  if (!ohlcv || ohlcv.length < 10) return { signal: 'Neutral', summary: 'Data OHLCV tidak cukup' };

  const ls = findLiquiditySweep(ohlcv);
  if (ls.detected) return { signal: ls.direction, summary: ls.description };

  const ob = findOrderBlock(ohlcv);
  if (ob.detected) return { signal: ob.type.includes('Demand') ? 'Bullish' : 'Bearish', summary: ob.description };

  const recent = ohlcv.slice(-5);
  const closes = recent.map(c => c.close);
  if (closes.length >= 2) {
    const trend = closes[closes.length - 1] > closes[0] ? 'Bullish' : 'Bearish';
    return { signal: trend, summary: trend === 'Bullish' ? 'Tren pendek naik' : 'Tren pendek turun' };
  }
  return { signal: 'Neutral', summary: 'Tidak ada sinyal signifikan' };
}

function findOrderBlock(ohlcv) {
  const recent = ohlcv.slice(-10);
  let maxVol = 0, obCandle = recent[0];
  for (let i = 0; i < recent.length; i++) {
    if (recent[i].volume > maxVol) { maxVol = recent[i].volume; obCandle = recent[i]; }
  }
  const avgVol = recent.reduce((a, b) => a + b.volume, 0) / recent.length;
  if (obCandle.volume < avgVol * 1.1) return { detected: false };
  const isBullish = obCandle.close > obCandle.open;
  const currentPrice = ohlcv[ohlcv.length - 1].close;
  const blockHigh = obCandle.high, blockLow = obCandle.low;
  if (isBullish && currentPrice >= blockLow * 0.995 && currentPrice <= blockHigh * 1.005)
    return { detected: true, type: 'Demand Zone', description: `Support di $${blockLow.toFixed(4)}` };
  if (!isBullish && currentPrice >= blockLow * 0.995 && currentPrice <= blockHigh * 1.005)
    return { detected: true, type: 'Supply Zone', description: `Resistance di $${blockHigh.toFixed(4)}` };
  return { detected: false };
}

function findLiquiditySweep(ohlcv) {
  const range = ohlcv.slice(-20, -1);
  const recentHigh = Math.max(...range.map(c => c.high));
  const recentLow = Math.min(...range.map(c => c.low));
  const last = ohlcv[ohlcv.length - 1];
  if (last.high > recentHigh && last.close < recentHigh)
    return { detected: true, direction: 'Bearish', description: `Sweep resistance $${recentHigh.toFixed(4)}` };
  if (last.low < recentLow && last.close > recentLow)
    return { detected: true, direction: 'Bullish', description: `Sweep support $${recentLow.toFixed(4)}` };
  return { detected: false };
}

// ==================== ASTROLOGI ====================
function getAstrologySignal(date) {
  const phase = getMoonPhase(date);
  const signals = {
    'New Moon': { signal: '🔄 Awal Siklus', interpretation: 'Potensi tren baru, volatilitas tinggi' },
    'Waxing Crescent': { signal: '🌱 Kenaikan', interpretation: 'Momentum bullish mulai terbentuk' },
    'First Quarter': { signal: '⚡ Tekanan', interpretation: 'Keputusan besar, volatilitas' },
    'Waxing Gibbous': { signal: '📈 Optimis', interpretation: 'Tren bullish dominan' },
    'Full Moon': { signal: '🌕 Puncak', interpretation: 'Potensi reversal, volatilitas ekstrem' },
    'Waning Gibbous': { signal: '📉 Koreksi', interpretation: 'Mulai jenuh, potensi turun' },
    'Last Quarter': { signal: '🔻 Pelepasan', interpretation: 'Distribusi, tekanan jual' },
    'Waning Crescent': { signal: '💤 Akhir', interpretation: 'Konsolidasi, volume rendah' }
  };
  return {
    moonPhase: phase.name,
    illumination: phase.illumination,
    signal: signals[phase.name]?.signal || 'Neutral',
    interpretation: signals[phase.name]?.interpretation || ''
  };
}

function getMoonPhase(date) {
  const LUNAR_MONTH = 29.53058867;
  const KNOWN_NEW_MOON = new Date('2000-01-06T18:14:00Z').getTime();
  const diff = date.getTime() - KNOWN_NEW_MOON;
  const days = diff / (1000 * 60 * 60 * 24);
  const age = ((days % LUNAR_MONTH) + LUNAR_MONTH) % LUNAR_MONTH;
  const illumination = Math.round(Math.sin((age / LUNAR_MONTH) * Math.PI * 2) * 50 + 50);
  let name;
  if (age < 1.84566) name = 'New Moon';
  else if (age < 5.53699) name = 'Waxing Crescent';
  else if (age < 9.22831) name = 'First Quarter';
  else if (age < 12.91963) name = 'Waxing Gibbous';
  else if (age < 16.61096) name = 'Full Moon';
  else if (age < 20.30228) name = 'Waning Gibbous';
  else if (age < 23.99361) name = 'Last Quarter';
  else if (age < 27.68493) name = 'Waning Crescent';
  else name = 'New Moon';
  return { name, illumination };
}

// ==================== RSI ====================
function calculateRSI(prices, period = 14) {
  if (prices.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = prices.length - period; i < prices.length; i++) {
    const diff = prices[i] - prices[i - 1];
    if (diff > 0) gains += diff;
    else losses -= diff;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  return 100 - (100 / (1 + avgGain / avgLoss));
}
