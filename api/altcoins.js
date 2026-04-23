// api/altcoins.js - AC369 FUSION (Versi Pamungkas)
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'max-age=0, s-maxage=60');

  try {
    const response = await fetch('https://api.binance.com/api/v3/ticker/24hr');
    const semua = await response.json();

    // Filter hanya pair USDT (menghindari stablecoin)
    const pairUSDT = semua.filter(t => t.symbol.endsWith('USDT') && !t.symbol.includes('BUSD') && !t.symbol.includes('TUSD') && !t.symbol.includes('USDC'));

    // 1. Top Gainers (10 koin dengan kenaikan tertinggi)
    const topGainers = pairUSDT
      .sort((a, b) => parseFloat(b.priceChangePercent) - parseFloat(a.priceChangePercent))
      .slice(0, 10)
      .map(t => ({
        simbol: t.symbol.replace('USDT', ''),
        harga: parseFloat(t.lastPrice).toFixed(4),
        perubahan24j: parseFloat(t.priceChangePercent).toFixed(2) + '%'
      }));

    // 2. RSI untuk 7 koin utama
    const koinUtama = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'ADAUSDT', 'XRPUSDT', 'DOGEUSDT'];
    const daftarRSI = [];
    
    for (const simbol of koinUtama) {
      try {
        const klinesRes = await fetch(`https://api.binance.com/api/v3/klines?symbol=${simbol}&interval=1h&limit=100`);
        const klines = await klinesRes.json();
        const hargaTutup = klines.map(k => parseFloat(k[4])).filter(v => !isNaN(v));
        
        if (hargaTutup.length > 14) {
          const rsi = hitungRSI(hargaTutup);
          const ticker = pairUSDT.find(t => t.symbol === simbol);
          const harga = ticker ? parseFloat(ticker.lastPrice).toFixed(4) : 'N/A';
          
          let kondisi = 'Netral';
          if (rsi < 30) kondisi = 'Jenuh Jual';
          else if (rsi > 70) kondisi = 'Jenuh Beli';
          
          daftarRSI.push({
            simbol: simbol.replace('USDT', ''),
            harga: harga,
            rsi: rsi.toFixed(2),
            kondisi: kondisi
          });
        }
      } catch (e) {
        // Abaikan jika satu koin gagal, lanjutkan ke koin berikutnya
      }
    }

    // Bangun narasi
    const narasi = topGainers.length > 0
      ? `Top gainer: ${topGainers[0].simbol} (+${topGainers[0].perubahan24j})`
      : 'Data gainer tidak tersedia.';

    res.status(200).json({
      timestamp: new Date().toISOString(),
      topGainers: topGainers,
      volumeBreakouts: [],
      rsiEkstrem: daftarRSI,
      narasi: narasi
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// Fungsi hitung RSI (sama seperti di analytics)
function hitungRSI(harga, periode = 14) {
  if (harga.length < periode) return 50;
  let naik = 0, turun = 0;
  for (let i = harga.length - periode; i < harga.length; i++) {
    const selisih = harga[i] - harga[i-1];
    if (selisih > 0) naik += selisih;
    else turun -= selisih;
  }
  const rataNaik = naik/periode;
  const rataTurun = turun/periode;
  if (rataTurun === 0) return 100;
  return 100 - (100/(1 + rataNaik/rataTurun));
}
