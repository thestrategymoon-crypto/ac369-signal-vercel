// api/analytics.js - AC369 FUSION v6 (Super Detail & Akurat)
export default async function handler(req, res) {
  // Izin CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'max-age=0, s-maxage=60');

  try {
    console.log('Memulai analisis BTC & ETH...');
    const btc = await analisisAset('BTCUSDT');
    const eth = await analisisAset('ETHUSDT');

    const response = {
      timestamp: new Date().toISOString(),
      btc: btc,
      eth: eth,
      narasiSmartMoney: buatNarasi(btc, eth)
    };

    console.log('Analisis berhasil:', JSON.stringify(response).slice(0, 200));
    res.status(200).json(response);
  } catch (error) {
    console.error('Error Kritis Analytics:', error.message);
    // Tetap kirim data fallback agar frontend tidak error total
    res.status(200).json({
      timestamp: new Date().toISOString(),
      btc: dataFallback('BTC'),
      eth: dataFallback('ETH'),
      narasiSmartMoney: 'Data pasar sedang tidak tersedia. Silakan coba beberapa saat lagi.'
    });
  }
}

// Data cadangan jika semua gagal
function dataFallback(simbol) {
  const harga = simbol === 'BTC' ? '77500' : '2300';
  return {
    simbol: simbol,
    hargaSekarang: harga,
    skorProbabilitas: 50,
    sinyalKonfluensi: 'Netral',
    kekuatanKonfluensi: 'Rendah',
    sinyalUtama: [{ nama: 'Data pasar offline', bullish: true, aktif: true, bobot: 0 }],
    ringkasanTeknis: 'Menunggu data real-time...',
    statusMA: { ma50: 'N/A', ma200: 'N/A', posisi: 'Tidak tersedia' }
  };
}

async function analisisAset(simbol) {
  console.log(`Mengambil data untuk ${simbol}...`);
  let hargaSekarang = 0;
  let perubahan24Jam = 0;
  let rsi = 50;
  let dataMA = { ma50: 'N/A', ma200: 'N/A', posisi: 'Data terbatas' };

  // === 1. AMBIL HARGA TERKINI ===
  try {
    const urlTicker = `https://api.binance.com/api/v3/ticker/24hr?symbol=${simbol}`;
    console.log(`Fetch: ${urlTicker}`);
    const resp = await fetch(urlTicker);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const ticker = await resp.json();
    
    hargaSekarang = parseFloat(ticker.lastPrice);
    perubahan24Jam = parseFloat(ticker.priceChangePercent);
    
    if (isNaN(hargaSekarang) || hargaSekarang <= 0) {
      // Coba fallback ke weightedAvgPrice
      hargaSekarang = parseFloat(ticker.weightedAvgPrice);
    }
    if (isNaN(hargaSekarang) || hargaSekarang <= 0) {
      throw new Error('Harga tidak valid');
    }
    console.log(`${simbol} harga: ${hargaSekarang}, perubahan: ${perubahan24Jam}%`);
  } catch (e) {
    console.error(`Gagal ambil ticker ${simbol}:`, e.message);
    // Jika gagal, gunakan nilai default dan lanjutkan ke RSI
  }

  // === 2. AMBIL DATA HISTORIS UNTUK RSI ===
  try {
    const urlKlines = `https://api.binance.com/api/v3/klines?symbol=${simbol}&interval=1h&limit=100`;
    console.log(`Fetch: ${urlKlines}`);
    const resp = await fetch(urlKlines);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const klines = await resp.json();
    
    if (Array.isArray(klines) && klines.length >= 14) {
      const hargaTutup = [];
      for (let i = 0; i < klines.length; i++) {
        const tutup = parseFloat(klines[i][4]);
        if (!isNaN(tutup) && tutup > 0) {
          hargaTutup.push(tutup);
        }
      }
      
      // Hitung MA sederhana dari data 1 jam (100 candle = ~4 hari)
      if (hargaTutup.length >= 50) {
        const ma50 = hargaTutup.slice(-50).reduce((a, b) => a + b, 0) / 50;
        const ma200 = hargaTutup.length >= 200 ? 
          hargaTutup.slice(-200).reduce((a, b) => a + b, 0) / 200 : ma50;
        dataMA = {
          ma50: ma50.toFixed(2),
          ma200: ma200.toFixed(2),
          posisi: hargaSekarang > ma200 ? 'Di atas 200MA (Bullish)' : 'Di bawah 200MA (Bearish)'
        };
      }
      
      if (hargaTutup.length >= 14) {
        rsi = hitungRSI(hargaTutup, 14);
      }
    }
    console.log(`${simbol} RSI: ${rsi.toFixed(1)}`);
  } catch (e) {
    console.error(`Gagal ambil klines ${simbol}:`, e.message);
  }

  // Jika harga masih 0 dan tidak ada fallback dari ticker, lemparkan error
  if (hargaSekarang === 0) {
    throw new Error(`Tidak bisa mendapatkan harga untuk ${simbol}`);
  }

  // === 3. HITUNG SKOR PROBABILITAS ===
  let skor = 50;
  const sinyalAktif = [];

  // RSI
  if (rsi < 30) {
    skor += 20;
    sinyalAktif.push({ nama: 'RSI Jenuh Jual (Oversold)', bullish: true, aktif: true, bobot: 20 });
  } else if (rsi > 70) {
    skor -= 20;
    sinyalAktif.push({ nama: 'RSI Jenuh Beli (Overbought)', bullish: false, aktif: true, bobot: 20 });
  }

  // Momentum 24 jam
  if (perubahan24Jam > 5) {
    skor += 15;
    sinyalAktif.push({ nama: 'Momentum 24 Jam Positif', bullish: true, aktif: true, bobot: 15 });
  } else if (perubahan24Jam < -5) {
    skor -= 15;
    sinyalAktif.push({ nama: 'Momentum 24 Jam Negatif', bullish: false, aktif: true, bobot: 15 });
  }

  // Harga vs MA200
  if (dataMA.posisi.includes('Di atas')) {
    skor += 10;
    sinyalAktif.push({ nama: 'Harga di atas MA200', bullish: true, aktif: true, bobot: 10 });
  } else if (dataMA.posisi.includes('Di bawah')) {
    skor -= 10;
    sinyalAktif.push({ nama: 'Harga di bawah MA200', bullish: false, aktif: true, bobot: 10 });
  }

  skor = Math.max(0, Math.min(100, Math.round(skor)));

  let sinyalFinal = 'Netral';
  let kekuatan = 'Rendah';
  if (skor >= 70) { sinyalFinal = 'Strong Buy'; kekuatan = 'Tinggi'; }
  else if (skor >= 60) { sinyalFinal = 'Buy'; kekuatan = 'Sedang'; }
  else if (skor <= 30) { sinyalFinal = 'Strong Sell'; kekuatan = 'Tinggi'; }
  else if (skor <= 40) { sinyalFinal = 'Sell'; kekuatan = 'Sedang'; }

  return {
    simbol: simbol.replace('USDT', ''),
    hargaSekarang: hargaSekarang.toFixed(2),
    skorProbabilitas: skor,
    sinyalKonfluensi: sinyalFinal,
    kekuatanKonfluensi: kekuatan,
    sinyalUtama: sinyalAktif,
    ringkasanTeknis: `RSI 1J: ${rsi.toFixed(1)} | 24J: ${perubahan24Jam.toFixed(1)}%`,
    statusMA: dataMA
  };
}

function hitungRSI(harga, periode = 14) {
  if (harga.length < periode + 1) return 50;
  let naik = 0, turun = 0;
  for (let i = harga.length - periode; i < harga.length; i++) {
    const selisih = harga[i] - harga[i - 1];
    if (selisih > 0) naik += selisih;
    else turun -= selisih;
  }
  const rataNaik = naik / periode;
  const rataTurun = turun / periode;
  if (rataTurun === 0) return 100;
  const rs = rataNaik / rataTurun;
  const rsi = 100 - (100 / (1 + rs));
  return isNaN(rsi) ? 50 : rsi;
}

function buatNarasi(btc, eth) {
  if (btc.skorProbabilitas > 60 && eth.skorProbabilitas > 60) return '💰 BTC & ETH menunjukkan momentum positif. Sinyal beli terkonfirmasi.';
  if (btc.skorProbabilitas > 60) return '📈 Bitcoin memimpin dengan sinyal beli. Fokus pada BTC.';
  if (eth.skorProbabilitas > 60) return '💎 Ethereum unggul. Altcoin mungkin menyusul.';
  return '📊 Pasar dalam fase netral. Tunggu konfirmasi sinyal.';
}
