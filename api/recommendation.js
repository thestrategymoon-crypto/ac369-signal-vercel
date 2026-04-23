// api/recommendation.js - AC369 FUSION v6 (Stabil)
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  try {
    const baseUrl = `https://${req.headers.host}`;
    const analyticsRes = await fetch(`${baseUrl}/api/analytics`);
    const analytics = await analyticsRes.json();

    const btc = analytics.btc || {};
    const eth = analytics.eth || {};

    const buatRekomendasi = (aset) => {
      const harga = parseFloat(aset.hargaSekarang) || 0;
      const skor = aset.skorProbabilitas || 50;
      const sinyal = aset.sinyalKonfluensi || 'Netral';
      let aksi = 'HOLD';
      if (sinyal.includes('Buy')) aksi = 'BUY';
      else if (sinyal.includes('Sell')) aksi = 'SELL';

      return {
        harga: harga.toFixed(2),
        probabilitas: skor,
        sinyal: sinyal,
        aksi: aksi,
        levelKunci: {
          support: (harga * 0.95).toFixed(2),
          resistance: (harga * 1.05).toFixed(2)
        },
        alasan: [aset.ringkasanTeknis || 'Analisis teknikal dasar.']
      };
    };

    res.status(200).json({
      timestamp: new Date().toISOString(),
      btc: buatRekomendasi(btc),
      eth: buatRekomendasi(eth),
      rencanaTrading: { daily: [], swing: [], watchlist: [] },
      narasiPasar: analytics.narasiSmartMoney || 'Pasar sedang netral.'
    });
  } catch (e) {
    console.error('Rekomendasi error:', e);
    res.status(200).json({
      btc: { harga: '0', probabilitas: 50, sinyal: 'Netral', aksi: 'HOLD', levelKunci: {support:'0',resistance:'0'}, alasan: ['Data tidak tersedia'] },
      eth: { harga: '0', probabilitas: 50, sinyal: 'Netral', aksi: 'HOLD', levelKunci: {support:'0',resistance:'0'}, alasan: ['Data tidak tersedia'] },
      rencanaTrading: { daily: [], swing: [], watchlist: [] },
      narasiPasar: 'Data pasar offline.'
    });
  }
}
