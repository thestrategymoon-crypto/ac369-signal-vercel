// api/analytics.js - AC369 FUSION (Versi Pamungkas - Zero Error)
export default async function handler(req, res) {
  // Mengizinkan akses dari mana saja dan mengatur cache 60 detik
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'max-age=0, s-maxage=60');

  try {
    // Memproses BTC dan ETH secara paralel
    const [btc, eth] = await Promise.all([
      analisisAset('BTCUSDT'),
      analisisAset('ETHUSDT')
    ]);

    // Mengirimkan respons sukses dengan data yang sudah dianalisis
    res.status(200).json({
      timestamp: new Date().toISOString(),
      btc: btc,
      eth: eth,
      narasiSmartMoney: buatNarasi(btc, eth)
    });
  } catch (error) {
    // Jika terjadi error di level atas, log dan kirim status 500
    console.error('Error Kritis Analytics:', error);
    res.status(500).json({ error: 'Gagal mengambil data analitik.' });
  }
}

// Fungsi utama untuk menganalisis satu aset (BTC atau ETH)
async function analisisAset(simbol) {
  // Nilai default jika semua upaya gagal
  let hargaSekarang = 0;
  let perubahan24Jam = 0;
  let rsi = 50;

  try {
    // 1. Ambil data ticker 24 jam dari Binance
    const responTicker = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${simbol}`);
    const ticker = await responTicker.json();

    // Parsing data dengan pengecekan ketat agar tidak NaN
    hargaSekarang = parseFloat(ticker.lastPrice) || parseFloat(ticker.weightedAvgPrice) || 0;
    perubahan24Jam = parseFloat(ticker.priceChangePercent) || 0;

    // 2. Ambil data historis 1 jam untuk menghitung RSI
    const responKlines = await fetch(`https://api.binance.com/api/v3/klines?symbol=${simbol}&interval=1h&limit=100`);
    const klines = await responKlines.json();

    // Pastikan data klines valid dan berbentuk array
    if (Array.isArray(klines) && klines.length > 14) {
      // Ambil harga penutupan, abaikan nilai yang bukan angka
      const hargaTutup = klines.map(k => {
        const tutup = parseFloat(k[4]);
        return isNaN(tutup) ? 0 : tutup;
      }).filter(nilai => nilai > 0);

      // Hitung RSI jika data mencukupi
      if (hargaTutup.length >= 14) {
        rsi = hitungRSI(hargaTutup, 14);
        if (isNaN(rsi)) rsi = 50; // Fallback jika perhitungan error
      }
    }
  } catch (e) {
    console.error(`Gagal mengambil data untuk ${simbol}:`, e.message);
    // Melanjutkan dengan nilai default, tidak membuat error total
  }

  // Jika harga masih 0, lemparkan error agar frontend tahu ada masalah
  if (hargaSekarang === 0) {
    throw new Error(`Tidak bisa mendapatkan harga untuk ${simbol}`);
  }

  // 3. Menghitung skor probabilitas berdasarkan RSI dan perubahan harga
  let skor = 50;
  const sinyal = [];

  // Analisis RSI
  if (rsi < 30) {
    skor += 20;
    sinyal.push({ nama: 'RSI Jenuh Jual (Oversold)', bullish: true, aktif: true, bobot: 20 });
  } else if (rsi > 70) {
    skor -= 20;
    sinyal.push({ nama: 'RSI Jenuh Beli (Overbought)', bullish: false, aktif: true, bobot: 20 });
  }

  // Analisis Momentum 24 Jam
  if (perubahan24Jam > 5) {
    skor += 15;
    sinyal.push({ nama: 'Momentum 24 Jam Positif', bullish: true, aktif: true, bobot: 15 });
  } else if (perubahan24Jam < -5) {
    skor -= 15;
    sinyal.push({ nama: 'Momentum 24 Jam Negatif', bullish: false, aktif: true, bobot: 15 });
  }

  // Batasi skor antara 0 dan 100
  skor = Math.max(0, Math.min(100, Math.round(skor)));

  // Tentukan sinyal dan kekuatan berdasarkan skor
  let sinyalFinal = 'Netral';
  let kekuatan = 'Rendah';
  if (skor >= 70) { sinyalFinal = 'Strong Buy'; kekuatan = 'Tinggi'; }
  else if (skor >= 60) { sinyalFinal = 'Buy'; kekuatan = 'Sedang'; }
  else if (skor <= 30) { sinyalFinal = 'Strong Sell'; kekuatan = 'Tinggi'; }
  else if (skor <= 40) { sinyalFinal = 'Sell'; kekuatan = 'Sedang'; }

  // Kembalikan objek data yang sudah bersih
  return {
    simbol: simbol.replace('USDT', ''),
    hargaSekarang: hargaSekarang.toFixed(2),
    skorProbabilitas: skor,
    sinyalKonfluensi: sinyalFinal,
    kekuatanKonfluensi: kekuatan,
    sinyalUtama: sinyal,
    ringkasanTeknis: `RSI 1J: ${rsi.toFixed(1)} | 24J: ${perubahan24Jam.toFixed(1)}%`,
    statusMA: { ma50: 'N/A', ma200: 'N/A', posisi: 'Data terbatas' }
  };
}

// Fungsi untuk menghitung RSI (Relative Strength Index)
function hitungRSI(harga, periode = 14) {
  if (!harga || harga.length < periode + 1) return 50;
  let naik = 0, turun = 0;
  for (let i = harga.length - periode; i < harga.length; i++) {
    const selisih = harga[i] - harga[i - 1];
    if (isNaN(selisih)) continue;
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

// Fungsi untuk membuat narasi berdasarkan kondisi BTC dan ETH
function buatNarasi(btc, eth) {
  if (btc.skorProbabilitas > 60 && eth.skorProbabilitas > 60) return '💰 BTC & ETH dalam momentum positif.';
  if (btc.skorProbabilitas > 60) return '📈 Bitcoin menunjukkan kekuatan.';
  if (eth.skorProbabilitas > 60) return '💎 Ethereum unggul.';
  return '📊 Pasar dalam fase netral.';
}
