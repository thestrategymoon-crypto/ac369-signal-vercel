// api/altcoins.js - AC369 FUSION v6 (Super Detail)
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'max-age=0, s-maxage=60');

  try {
    console.log('Memulai pemindaian altcoin...');
    // 1. Ambil data ticker
    const resp = await fetch('https://api.binance.com/api/v3/ticker/24hr');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const semua = await resp.json();

    // Filter pair USDT yang valid
    const pairUSDT = semua.filter(t => 
      t.symbol.endsWith('USDT') && 
      !t.symbol.includes('BUSD') && 
      !t.symbol.includes('TUSD') &&
      !t.symbol.includes('USDC')
    );

    // 2. Top Gainers
    const topGainers = pairUSDT
      .sort((a, b) => parseFloat(b.priceChangePercent) - parseFloat(a.priceChangePercent))
      .slice(0, 10)
      .map(t => ({
        simbol: t.symbol.replace('USDT', ''),
        harga: parseFloat(t.lastPrice).toFixed(4),
        perubahan24j: parseFloat(t.priceChangePercent).toFixed(2) + '%'
      }));

    // 3. RSI untuk koin utama
    const koinUtama = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'ADAUSDT', 'XRPUSDT', 'DOGEUSDT'];
    const daftarRSI = [];

    for (const simbol of koinUtama) {
      try {
        const klinesRes = await fetch(`https://api.binance.com/api/v3/klines?symbol=${simbol}&interval=1h&limit=100`);
        if (!klinesRes.ok) continue;
        const klines = await klinesRes.json();
        const hargaTutup = [];
        for (let i = 0; i < klines.length; i++) {
          const tutup = parseFloat(klines[i][4]);
          if (!isNaN(tutup) && tutup > 0) hargaTutup.push(tutup);
        }
        
        if (hargaTutup.length >= 14) {
          const rsi = hitungRSI(hargaTutup);
          const ticker = pairUSDT.find(t => t.symbol === simbol);
          let harga = 'N/A';
          if (ticker) {
            const h = parseFloat(ticker.lastPrice);
            if (!isNaN(h)) harga = h.toFixed(4);
          }
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
        console.error(`Gagal RSI ${simbol}:`, e.message);
      }
    }

    // 4. Volume Breakout sederhana (dari ticker 24h)
    const volumeRata = pairUSDT.reduce((sum, t) => sum + parseFloat(t.quoteVolume), 0) / pairUSDT.length;
    const breakout = pairUSDT
      .filter(t => parseFloat(t.quoteVolume) > volumeRata * 3)
      .slice(0, 5)
      .map(t => ({
        simbol: t.symbol.replace('USDT', ''),
        harga: parseFloat(t.lastPrice).toFixed(4),
        rasioVolume: (parseFloat(t.quoteVolume) / volumeRata).toFixed(1) + 'x'
      }));

    const narasi = topGainers.length > 0
      ? `🔥 Top gainer: ${topGainers[0].simbol} (+${topGainers[0].perubahan24j}). `
      : 'Belum ada data gainer. ';
    
    const teksRSI = daftarRSI.filter(r => r.kondisi === 'Jenuh Jual').map(r => r.simbol).join(', ');
    if (teksRSI) narasi += `RSI jenuh jual pada: ${teksRSI}.`;

    res.status(200).json({
      timestamp: new Date().toISOString(),
      topGainers: topGainers,
      volumeBreakouts: breakout,
      rsiEkstrem: daftarRSI,
      narasi: narasi
    });
  } catch (e) {
    console.error('Error altcoins:', e);
    res.status(200).json({
      timestamp: new Date().toISOString(),
      topGainers: [],
      volumeBreakouts: [],
      rsiEkstrem: [],
      narasi: 'Gagal mengambil data altcoin. Coba lagi nanti.'
    });
  }
}

function hitungRSI(harga, periode = 14) {
  if (harga.length < periode) return 50;
  let naik = 0, turun = 0;
  for (let i = harga.length - periode; i < harga.length; i++) {
    const selisih = harga[i] - harga[i - 1];
    if (selisih > 0) naik += selisih;
    else turun -= selisih;
  }
  const rataNaik = naik / periode;
  const rataTurun = turun / periode;
  if (rataTurun === 0) return 100;
  return 100 - (100 / (1 + rataNaik / rataTurun));
}
