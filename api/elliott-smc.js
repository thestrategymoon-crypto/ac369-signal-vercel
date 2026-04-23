// api/elliott-smc.js - AC369 FUSION (Lebih Sensitif)
export function findSwingPoints(ohlcv, lookback = 3) {
  const swings = [];
  for (let i = lookback; i < ohlcv.length - lookback; i++) {
    let isSwingHigh = true;
    let isSwingLow = true;
    const currentHigh = ohlcv[i].high;
    const currentLow = ohlcv[i].low;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      if (ohlcv[j].high >= currentHigh) isSwingHigh = false;
      if (ohlcv[j].low <= currentLow) isSwingLow = false;
    }
    if (isSwingHigh) swings.push({ index: i, price: currentHigh, type: 'high' });
    if (isSwingLow) swings.push({ index: i, price: currentLow, type: 'low' });
  }
  return swings;
}

export function detectElliottWave(ohlcv) {
  if (ohlcv.length < 30) return { wave: '-', confidence: 0, description: '' };
  const swings = findSwingPoints(ohlcv, 3);
  if (swings.length < 3) return { wave: '-', confidence: 0, description: '' };
  const recent = swings.slice(-5);
  const highs = recent.filter(s => s.type === 'high');
  const lows = recent.filter(s => s.type === 'low');
  if (highs.length < 2 || lows.length < 2) return { wave: '-', confidence: 0, description: '' };
  const lastHigh = highs[highs.length - 1];
  const prevHigh = highs[highs.length - 2];
  const lastLow = lows[lows.length - 1];
  const prevLow = lows[lows.length - 2];
  const currentPrice = ohlcv[ohlcv.length - 1].close;

  // Wave 3 impulsif naik
  if (lastHigh.price > prevHigh.price && lastLow.price > prevLow.price && currentPrice > lastLow.price) {
    return { wave: 'Wave 3 (Impulsif)', confidence: 55, description: 'Tren naik terdeteksi' };
  }
  // Wave C korektif turun
  if (lastHigh.price < prevHigh.price && lastLow.price < prevLow.price && currentPrice < lastHigh.price) {
    return { wave: 'Wave Korektif', confidence: 50, description: 'Fase koreksi' };
  }
  return { wave: 'Konsolidasi', confidence: 30, description: 'Struktur belum jelas' };
}

export function detectOrderBlock(ohlcv) {
  if (ohlcv.length < 15) return { detected: false, type: null, price: null, description: '' };
  const recent = ohlcv.slice(-10);
  let maxVol = 0;
  let obCandle = recent[0];
  for (let i = 0; i < recent.length; i++) {
    if (recent[i].volume > maxVol) { maxVol = recent[i].volume; obCandle = recent[i]; }
  }
  const avgVol = recent.reduce((s, c) => s + c.volume, 0) / recent.length;
  if (obCandle.volume < avgVol * 1.2) return { detected: false, type: null, price: null, description: '' };
  
  const isBullish = obCandle.close > obCandle.open;
  const currentPrice = ohlcv[ohlcv.length - 1].close;
  const blockHigh = obCandle.high;
  const blockLow = obCandle.low;

  if (isBullish && currentPrice >= blockLow && currentPrice <= blockHigh) {
    return { detected: true, type: 'Demand Zone', price: blockLow, description: 'Area akumulasi' };
  }
  if (!isBullish && currentPrice >= blockLow && currentPrice <= blockHigh) {
    return { detected: true, type: 'Supply Zone', price: blockHigh, description: 'Area distribusi' };
  }
  return { detected: false, type: null, price: null, description: '' };
}

export function detectLiquiditySweep(ohlcv) {
  if (ohlcv.length < 15) return { detected: false, direction: null, description: '' };
  const recentHigh = Math.max(...ohlcv.slice(-15, -1).map(c => c.high));
  const recentLow = Math.min(...ohlcv.slice(-15, -1).map(c => c.low));
  const last = ohlcv[ohlcv.length - 1];
  if (last.high > recentHigh && last.close < recentHigh) {
    return { detected: true, direction: 'Bearish', description: 'Sweep resistance' };
  }
  if (last.low < recentLow && last.close > recentLow) {
    return { detected: true, direction: 'Bullish', description: 'Sweep support' };
  }
  return { detected: false, direction: null, description: '' };
}

export function analyzeSMC(ohlcv) {
  const ob = detectOrderBlock(ohlcv);
  const ls = detectLiquiditySweep(ohlcv);
  if (ls.detected) {
    return { signal: ls.direction, summary: ls.description, orderBlock: ob.detected ? ob.type : null, liquiditySweep: ls.direction };
  }
  if (ob.detected) {
    return { signal: ob.type === 'Demand Zone' ? 'Bullish' : 'Bearish', summary: ob.description, orderBlock: ob.type, liquiditySweep: null };
  }
  return { signal: 'Neutral', summary: '', orderBlock: null, liquiditySweep: null };
}
