// api/altcoins.js - AC369 FUSION (CoinGecko + RSI)
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 'max-age=0, s-maxage=60');

  try {
    console.log('[Altcoins] Fetch dari CoinGecko...');
    
    // 1. Ambil 100 koin teratas dari CoinGecko
    const cgRes = await fetch(
      'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&sparkline=false&price_change_percentage=24h'
    );
    if (!cgRes.ok) throw new Error(`CoinGecko HTTP ${cgRes.status}`);
    const coins = await cgRes.json();

    // 2. Top Gainers (15 teratas)
    const gainers = [...coins]
      .sort((a, b) => (b.price_change_percentage_24h || 0) - (a.price_change_percentage_24h || 0))
      .slice(0, 15)
      .map(c => ({
        symbol: c.symbol.toUpperCase(),
        price: (c.current_price || 0).toFixed(4),
        change24h: (c.price_change_percentage_24h || 0).toFixed(2) + '%'
      }));

    // 3. Volume Breakouts (volume > 3x median)
    const volumes = coins.map(c => c.total_volume || 0).filter(v => v > 0);
    volumes.sort((a, b) => a - b);
    const medianVol = volumes[Math.floor(volumes.length / 2)] || 1000000;
    const breakouts = coins
      .filter(c => (c.total_volume || 0) > medianVol * 3)
      .slice(0, 10)
      .map(c => ({
        symbol: c.symbol.toUpperCase(),
        price: (c.current_price || 0).toFixed(4),
        volumeRatio: ((c.total_volume || 0) / medianVol).toFixed(1) + 'x'
      }));

    // 4. RSI untuk 7 koin utama (dari Binance)
    const majors = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'ADAUSDT', 'XRPUSDT', 'DOGEUSDT'];
    const rsiExtremes = [];
    for (const sym of majors) {
      try {
        const klinesRes = await fetch(`https://api.binance.com/api/v3/klines?symbol=${sym}&interval=1h&limit=100`);
        if (!klinesRes.ok) continue;
        const klines = await klinesRes.json();
        const closes = klines.map(k => parseFloat(k[4])).filter(v => !isNaN(v) && v > 0);
        if (closes.length < 14) continue;
        const rsi = calculateRSI(closes);
        const info = coins.find(c => c.symbol === sym.replace('USDT', '').toLowerCase());
        let price = 'N/A';
        if (info) price = (info.current_price || 0).toFixed(4);
        let condition = 'Netral';
        if (rsi < 30) condition = 'Jenuh Jual';
        else if (rsi > 70) condition = 'Jenuh Beli';
        rsiExtremes.push({
          symbol: sym.replace('USDT', ''),
          price,
          rsi: rsi.toFixed(2),
          condition
        });
      } catch (e) {
        // abaikan
      }
    }

    const narrative = gainers.length > 0
      ? `🔥 Top gainer: ${gainers[0].symbol} (+${gainers[0].change24h}). ` +
        (rsiExtremes.filter(r => r.condition === 'Jenuh Jual').map(r => r.symbol).join(', ') || 'Tidak ada RSI jenuh jual.')
      : 'Belum ada data gainer.';

    res.status(200).json({
      timestamp: new Date().toISOString(),
      topGainers: gainers,
      volumeBreakouts: breakouts,
      rsiExtremes,
      narrative
    });
  } catch (e) {
    console.error('[Altcoins] Error:', e.message);
    res.status(200).json({
      timestamp: new Date().toISOString(),
      topGainers: [],
      volumeBreakouts: [],
      rsiExtremes: [],
      narrative: 'Data altcoin sementara tidak tersedia.'
    });
  }
}

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
