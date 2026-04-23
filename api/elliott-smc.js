// api/elliott-smc.js - Elliott Wave & SMC Detector untuk AC369 FUSION

/**
 * Mendeteksi swing high dan swing low dari data OHLCV
 */
export function findSwingPoints(ohlcv, lookback = 5) {
  const swings = [];
  
  for (let i = lookback; i < ohlcv.length - lookback; i++) {
    const currentHigh = ohlcv[i].high;
    const currentLow = ohlcv[i].low;
    
    let isSwingHigh = true;
    let isSwingLow = true;
    
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      if (ohlcv[j].high >= currentHigh) isSwingHigh = false;
      if (ohlcv[j].low <= currentLow) isSwingLow = false;
    }
    
    if (isSwingHigh) {
      swings.push({ index: i, price: currentHigh, type: 'high' });
    }
    if (isSwingLow) {
      swings.push({ index: i, price: currentLow, type: 'low' });
    }
  }
  
  return swings;
}

/**
 * Mendeteksi struktur Elliott Wave (5-wave impulse)
 */
export function detectElliottWave(ohlcv) {
  if (ohlcv.length < 50) {
    return { wave: 'Data tidak cukup', confidence: 0, description: '' };
  }
  
  const swings = findSwingPoints(ohlcv, 5);
  if (swings.length < 5) {
    return { wave: 'Tidak terdeteksi', confidence: 0, description: 'Swing point tidak cukup' };
  }
  
  // Ambil 5 swing terakhir untuk analisis
  const recentSwings = swings.slice(-7);
  
  // Hitung rasio Fibonacci antar swing
  const fibLevels = [];
  for (let i = 1; i < recentSwings.length; i++) {
    const prev = recentSwings[i-1];
    const curr = recentSwings[i];
    const diff = Math.abs(curr.price - prev.price);
    const retrace = diff / prev.price;
    fibLevels.push(retrace);
  }
  
  // Cek pola impulsif sederhana: Higher High, Higher Low
  const highs = recentSwings.filter(s => s.type === 'high');
  const lows = recentSwings.filter(s => s.type === 'low');
  
  let waveCount = 0;
  let confidence = 0;
  let description = '';
  
  if (highs.length >= 3 && lows.length >= 2) {
    const lastHigh = highs[highs.length - 1].price;
    const prevHigh = highs[highs.length - 2].price;
    const lastLow = lows[lows.length - 1].price;
    const prevLow = lows[lows.length - 2].price;
    
    if (lastHigh > prevHigh && lastLow > prevLow) {
      waveCount = 3;
      confidence = 55;
      description = 'Potensi Wave 3 (Impulsif)';
      
      // Cek apakah mendekati extension 1.618
      const wave1 = Math.abs(highs[1].price - lows[0].price);
      const wave3 = Math.abs(lastHigh - lastLow);
      const ratio = wave3 / wave1;
      
      if (ratio > 1.5 && ratio < 1.7) {
        confidence = 70;
        description = 'Wave 3 dengan extension 1.618';
      }
    } else if (lastHigh < prevHigh && lastLow < prevLow) {
      waveCount = 4;
      confidence = 50;
      description = 'Potensi Wave 4 (Korektif)';
    }
  }
  
  // Deteksi Wave 5 (jika sudah ada 4 wave)
  if (highs.length >= 4) {
    const wave1High = highs[0].price;
    const wave3High = highs[2].price;
    const wave5Potential = wave3High + (wave3High - wave1High) * 0.618;
    const currentPrice = ohlcv[ohlcv.length - 1].close;
    
    if (currentPrice > wave3High) {
      waveCount = 5;
      confidence = 60;
      description = `Potensi Wave 5, target ~$${wave5Potential.toFixed(2)}`;
    }
  }
  
  return {
    wave: waveCount > 0 ? `Wave ${waveCount}` : 'Tidak terdeteksi',
    confidence,
    description
  };
}

/**
 * Mendeteksi Order Block (SMC)
 */
export function detectOrderBlock(ohlcv) {
  if (ohlcv.length < 20) {
    return { detected: false, type: null, price: null, description: '' };
  }
  
  const lastIdx = ohlcv.length - 1;
  const candles = ohlcv.slice(-10);
  
  // Cari candle dengan volume tinggi dan range besar
  let maxVolumeIdx = 0;
  let maxVolume = 0;
  
  for (let i = 0; i < candles.length - 2; i++) {
    if (candles[i].volume > maxVolume) {
      maxVolume = candles[i].volume;
      maxVolumeIdx = i;
    }
  }
  
  const obCandidate = candles[maxVolumeIdx];
  const avgVolume = candles.reduce((sum, c) => sum + c.volume, 0) / candles.length;
  const volumeRatio = obCandidate.volume / avgVolume;
  
  // Order block valid jika volume > 1.5x rata-rata
  if (volumeRatio < 1.5) {
    return { detected: false, type: null, price: null, description: 'Tidak ada order block signifikan' };
  }
  
  const isBullish = obCandidate.close > obCandidate.open;
  const blockHigh = obCandidate.high;
  const blockLow = obCandidate.low;
  const currentPrice = ohlcv[lastIdx].close;
  
  let type = '';
  let description = '';
  
  // Tentukan apakah harga saat ini berada di area order block
  if (isBullish && currentPrice > blockLow && currentPrice < blockHigh) {
    type = 'Bullish OB';
    description = `Harga di area demand zone ($${blockLow.toFixed(4)} - $${blockHigh.toFixed(4)})`;
  } else if (!isBullish && currentPrice > blockLow && currentPrice < blockHigh) {
    type = 'Bearish OB';
    description = `Harga di area supply zone ($${blockLow.toFixed(4)} - $${blockHigh.toFixed(4)})`;
  } else if (isBullish && currentPrice < blockLow) {
    type = 'Bullish OB (Below)';
    description = `Harga di bawah demand zone, potensi support di $${blockLow.toFixed(4)}`;
  } else if (!isBullish && currentPrice > blockHigh) {
    type = 'Bearish OB (Above)';
    description = `Harga di atas supply zone, potensi resistance di $${blockHigh.toFixed(4)}`;
  }
  
  return {
    detected: true,
    type,
    price: isBullish ? blockLow : blockHigh,
    description,
    volumeRatio: volumeRatio.toFixed(1) + 'x'
  };
}

/**
 * Mendeteksi Liquidity Sweep
 */
export function detectLiquiditySweep(ohlcv) {
  if (ohlcv.length < 20) {
    return { detected: false, direction: null, description: '' };
  }
  
  const lastIdx = ohlcv.length - 1;
  const recentHigh = Math.max(...ohlcv.slice(-20, -1).map(c => c.high));
  const recentLow = Math.min(...ohlcv.slice(-20, -1).map(c => c.low));
  
  const lastCandle = ohlcv[lastIdx];
  const prevCandle = ohlcv[lastIdx - 1];
  
  // Liquidity sweep ke atas (stop hunt di atas resistance)
  if (lastCandle.high > recentHigh && lastCandle.close < recentHigh) {
    return {
      detected: true,
      direction: 'Bearish',
      description: `Sweep di atas $${recentHigh.toFixed(4)} lalu ditolak (Stop Hunt)`
    };
  }
  
  // Liquidity sweep ke bawah (stop hunt di bawah support)
  if (lastCandle.low < recentLow && lastCandle.close > recentLow) {
    return {
      detected: true,
      direction: 'Bullish',
      description: `Sweep di bawah $${recentLow.toFixed(4)} lalu reversal (Liquidity Grab)`
    };
  }
  
  return { detected: false, direction: null, description: '' };
}

/**
 * Analisis SMC lengkap
 */
export function analyzeSMC(ohlcv) {
  const orderBlock = detectOrderBlock(ohlcv);
  const liquiditySweep = detectLiquiditySweep(ohlcv);
  
  let signal = 'Neutral';
  let description = '';
  
  if (liquiditySweep.detected && liquiditySweep.direction === 'Bullish') {
    signal = 'Bullish';
    description = liquiditySweep.description;
  } else if (liquiditySweep.detected && liquiditySweep.direction === 'Bearish') {
    signal = 'Bearish';
    description = liquiditySweep.description;
  } else if (orderBlock.detected) {
    signal = orderBlock.type?.includes('Bullish') ? 'Bullish' : 'Bearish';
    description = orderBlock.description;
  }
  
  return {
    signal,
    orderBlock,
    liquiditySweep,
    summary: description || 'Tidak ada sinyal SMC signifikan'
  };
}
