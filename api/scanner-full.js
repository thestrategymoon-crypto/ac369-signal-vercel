// api/scanner-full.js - AC369 FUSION Full Altcoin Scanner (Fase 3 - Elliott Wave & SMC)
import { detectElliottWave, analyzeSMC } from './elliott-smc.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'max-age=0, s-maxage=300');

  try {
    const allCoins = [];
    const pages = 3;
    
    for (let page = 1; page <= pages; page++) {
      const response = await fetch(
        `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=${page}&sparkline=false&price_change_percentage=24h`
      );
      const data = await response.json();
      
      for (let i = 0; i < data.length; i++) {
        allCoins.push(data[i]);
      }
      
      if (page < pages) await new Promise(r => setTimeout(r, 1000));
    }

    const filteredCoins = [];
    for (let i = 0; i < allCoins.length; i++) {
      const c = allCoins[i];
      if (c.total_volume > 1000000 && c.market_cap > 10000000) {
        filteredCoins.push(c);
      }
    }

    const results = [];
    const batchSize = 5;
    
    for (let i = 0; i < filteredCoins.length; i += batchSize) {
      const batch = [];
      for (let j = i; j < Math.min(i + batchSize, filteredCoins.length); j++) {
        batch.push(analyzeCoin(filteredCoins[j]));
      }
      
      const batchResults = await Promise.allSettled(batch);
      
      for (let k = 0; k < batchResults.length; k++) {
        const result = batchResults[k];
        if (result.status === 'fulfilled' && result.value) {
          results.push(result.value);
        }
      }
      
      await new Promise(r => setTimeout(r, 500));
    }

    results.sort((a, b) => b.breakoutProbability.score - a.breakoutProbability.score);

    res.status(200).json({
      timestamp: new Date().toISOString(),
      totalScanned: filteredCoins.length,
      results: results.slice(0, 50)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function analyzeCoin(coin) {
  const symbol = coin.symbol.toUpperCase();
  
  let ohlcv = null;
  let chartPatterns = [];
  let elliottWave = { wave: 'Tidak terdeteksi', confidence: 0, description: '' };
  let smcAnalysis = { signal: 'Neutral', summary: 'Tidak ada sinyal SMC' };
  
  try {
    const binanceRes = await fetch(
      `https://api.binance.com/api/v3/klines?symbol=${symbol}USDT&interval=1d&limit=100`
    );
    if (binanceRes.ok) {
      const data = await binanceRes.json();
      ohlcv = [];
      for (let i = 0; i < data.length; i++) {
        ohlcv.push({
          open: parseFloat(data[i][1]),
          high: parseFloat(data[i][2]),
          low: parseFloat(data[i][3]),
          close: parseFloat(data[i][4]),
          volume: parseFloat(data[i][5])
        });
      }
      
      if (ohlcv.length >= 3) {
        chartPatterns = detectChartPatterns(ohlcv);
      }
      
      if (ohlcv.length >= 50) {
        elliottWave = detectElliottWave(ohlcv);
        smcAnalysis = analyzeSMC(ohlcv);
      }
    }
  } catch (e) {
    // Lanjut tanpa data OHLCV
  }

  const breakoutProb = calculateBreakoutProbability(coin, ohlcv, chartPatterns, elliottWave, smcAnalysis);

  return {
    symbol: symbol,
    name: coin.name,
    price: coin.current_price,
    marketCap: coin.market_cap,
    volume24h: coin.total_volume,
    priceChange24h: coin.price_change_percentage_24h,
    breakoutProbability: breakoutProb,
    chartPatterns: chartPatterns.slice(0, 3),
    elliottWave,
    smc: smcAnalysis,
    hasOHLCV: ohlcv !== null
  };
}

function detectChartPatterns(ohlcv) {
  const patterns = [];
  const lastIdx = ohlcv.length - 1;
  const prevIdx = lastIdx - 1;
  const prev2Idx = lastIdx - 2;
  
  const last = ohlcv[lastIdx];
  const prev = ohlcv[prevIdx];
  const prev2 = ohlcv[prev2Idx];
  
  // 1. Bullish Engulfing
  if (prev.close < prev.open && 
      last.close > last.open && 
      last.open < prev.close &&
      last.close > prev.open) {
    patterns.push({ name: 'Bullish Engulfing', signal: 'bullish', probability: 70 });
  }
  
  // 2. Bearish Engulfing
  if (prev.close > prev.open && 
      last.close < last.open && 
      last.open > prev.close &&
      last.close < prev.open) {
    patterns.push({ name: 'Bearish Engulfing', signal: 'bearish', probability: 70 });
  }
  
  // 3. Hammer
  const body = Math.abs(last.close - last.open);
  const lowerWick = Math.min(last.open, last.close) - last.low;
  const upperWick = last.high - Math.max(last.open, last.close);
  if (lowerWick > body * 2 && upperWick < body * 0.5) {
    patterns.push({ name: 'Hammer', signal: 'bullish', probability: 65 });
  }
  
  // 4. Shooting Star
  if (upperWick > body * 2 && lowerWick < body * 0.5) {
    patterns.push({ name: 'Shooting Star', signal: 'bearish', probability: 65 });
  }
  
  // 5. Doji
  if (body < (last.high - last.low) * 0.1) {
    patterns.push({ name: 'Doji', signal: 'neutral', probability: 50 });
  }
  
  // 6. Morning Star
  if (ohlcv.length >= 3) {
    const first = prev2;
    const second = prev;
    const third = last;
    
    if (first.close < first.open) {
      const secondBody = Math.abs(second.close - second.open);
      const secondRange = second.high - second.low;
      if (secondBody < secondRange * 0.3) {
        if (third.close > third.open && third.close > (first.open + first.close) / 2) {
          patterns.push({ name: 'Morning Star', signal: 'bullish', probability: 80 });
        }
      }
    }
  }
  
  return patterns;
}

function calculateBreakoutProbability(coin, ohlcv, chartPatterns, elliottWave, smcAnalysis) {
  let score = 0;
  const reasons = [];

  const change = coin.price_change_percentage_24h || 0;
  if (change > 10) {
    score += 25;
    reasons.push(`Momentum sangat kuat (+${change.toFixed(1)}%)`);
  } else if (change > 5) {
    score += 15;
    reasons.push(`Momentum positif (+${change.toFixed(1)}%)`);
  } else if (change < -5) {
    score -= 10;
    reasons.push(`Momentum negatif (${change.toFixed(1)}%)`);
  }

  if (ohlcv && ohlcv.length >= 20) {
    const last = ohlcv[ohlcv.length - 1];
    const prevVolumes = [];
    for (let i = ohlcv.length - 20; i < ohlcv.length - 1; i++) {
      prevVolumes.push(ohlcv[i].volume);
    }
    const avgVolume = prevVolumes.reduce((a, b) => a + b, 0) / prevVolumes.length;
    
    const volumeRatio = last.volume / avgVolume;
    if (volumeRatio > 2.5) {
      score += 30;
      reasons.push(`Volume melonjak ${volumeRatio.toFixed(1)}x rata-rata`);
    } else if (volumeRatio > 1.5) {
      score += 15;
      reasons.push(`Volume meningkat ${volumeRatio.toFixed(1)}x`);
    }

    const highest20 = Math.max(...ohlcv.slice(-20, -1).map(c => c.high));
    const distanceToResistance = ((highest20 - last.close) / last.close) * 100;
    if (distanceToResistance < 2 && distanceToResistance > 0) {
      score += 20;
      reasons.push(`Harga dekat resistance (${distanceToResistance.toFixed(1)}% lagi)`);
    }

    const ma20 = ohlcv.slice(-20).reduce((sum, c) => sum + c.close, 0) / 20;
    if (last.close > ma20) {
      score += 10;
      reasons.push('Harga di atas MA20');
    }
  }
  
  // Skor dari Elliott Wave
  if (elliottWave && elliottWave.confidence > 50) {
    if (elliottWave.wave.includes('3') || elliottWave.wave.includes('5')) {
      score += 15;
      reasons.push(`Elliott: ${elliottWave.wave} (${elliottWave.confidence}%)`);
    }
  }

  // Skor dari SMC
  if (smcAnalysis && smcAnalysis.signal === 'Bullish') {
    score += 20;
    reasons.push(`SMC: ${smcAnalysis.orderBlock?.type || 'Liquidity Sweep'}`);
  } else if (smcAnalysis && smcAnalysis.signal === 'Bearish') {
    score -= 15;
    reasons.push(`SMC: ${smcAnalysis.orderBlock?.type || 'Liquidity Sweep'}`);
  }
  
  let patternBonus = 0;
  const bullishPatterns = chartPatterns.filter(p => p.signal === 'bullish');
  const bearishPatterns = chartPatterns.filter(p => p.signal === 'bearish');
  
  if (bullishPatterns.length > 0) {
    patternBonus += bullishPatterns.reduce((sum, p) => sum + p.probability / 10, 0);
    reasons.push(`Pola bullish: ${bullishPatterns.map(p => p.name).join(', ')}`);
  }
  if (bearishPatterns.length > 0) {
    patternBonus -= bearishPatterns.reduce((sum, p) => sum + p.probability / 10, 0);
    reasons.push(`Pola bearish: ${bearishPatterns.map(p => p.name).join(', ')}`);
  }
  
  score += patternBonus;

  const normalizedScore = Math.max(0, Math.min(100, score + 50));
  
  return {
    score: Math.round(normalizedScore),
    reasons: reasons.slice(0, 5),
    interpretation: normalizedScore >= 70 ? '🔥 Probabilitas Tinggi' : 
                     normalizedScore >= 50 ? '📈 Perlu Dipantau' : 
                     '💤 Probabilitas Rendah'
  };
}
