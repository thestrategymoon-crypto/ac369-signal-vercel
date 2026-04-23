// api/scanner-full.js - AC369 FUSION v6.0 (Fase 6.1 - @liquid/ta)
import { calculateRSI, calculateMACD, isBullishEngulfing, isBearishEngulfing, isHammer, isDoji } from "@liquid/ta";

export default async function handler(req, res) {
  // ... (kode untuk fetch dari CoinGecko dan Binance sama seperti sebelumnya) ...

  // Di dalam fungsi analyzeCoinSimple, kita akan menggunakan fungsi dari @liquid/ta
  async function analyzeCoinSimple(coin) {
    const symbol = coin.symbol.toUpperCase();
    
    let ohlcv = null;
    let chartPatterns = [];
    
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);
      const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}USDT&interval=1d&limit=30`, { signal: controller.signal });
      clearTimeout(timeoutId);
      
      if (res.ok) {
        const data = await res.json();
        ohlcv = data.map(c => ({
          open: parseFloat(c[1]), high: parseFloat(c[2]), low: parseFloat(c[3]), close: parseFloat(c[4]), volume: parseFloat(c[5])
        }));
        
        // ----- DETEKSI POLA GRAFIK dengan @liquid/ta -----
        if (ohlcv.length > 3) {
          const open = ohlcv.map(c => c.open);
          const high = ohlcv.map(c => c.high);
          const low = ohlcv.map(c => c.low);
          const close = ohlcv.map(c => c.close);
          
          const lastIdx = ohlcv.length - 1;
          
          // Deteksi berbagai pola candlestick
          if (isBullishEngulfing(open, high, low, close, lastIdx)) chartPatterns.push({ name: 'Bullish Engulfing', signal: 'bullish', probability: 70 });
          if (isBearishEngulfing(open, high, low, close, lastIdx)) chartPatterns.push({ name: 'Bearish Engulfing', signal: 'bearish', probability: 70 });
          if (isHammer(high, low, close, lastIdx)) chartPatterns.push({ name: 'Hammer', signal: 'bullish', probability: 65 });
          if (isDoji(high, low, close, lastIdx)) chartPatterns.push({ name: 'Doji', signal: 'neutral', probability: 50 });
          // Banyak lagi pola lain yang bisa ditambahkan sesuai dokumentasi @liquid/ta
        }
      }
    } catch (e) {
      console.error(`Gagal fetch OHLCV untuk ${symbol}:`, e.message);
    }

    const breakoutProb = calculateBreakoutScore(coin, ohlcv, chartPatterns);

    return {
      symbol,
      name: coin.name,
      price: coin.current_price,
      volume24h: coin.total_volume,
      priceChange24h: coin.price_change_percentage_24h,
      breakoutProbability: breakoutProb,
      chartPatterns: chartPatterns.slice(0, 3), // Kirim maksimal 3 pola
      elliottWave: { wave: '-', confidence: 0, description: '' },
      smc: { signal: 'Neutral', summary: '' }
    };
  }

  function calculateBreakoutScore(coin, ohlcv, patterns) {
    // ... (logika perhitungan skor yang sudah ada) ...
    let score = 50;
    // ... (logika perhitungan skor lainnya) ...
    return {
      score: Math.round(score),
      reasons: [/*...*/],
      interpretation: score >= 70 ? '🔥 Tinggi' : score >= 50 ? '📈 Pantau' : '💤 Rendah'
    };
  }

  // ... (sisa kode sebelumnya) ...
}
