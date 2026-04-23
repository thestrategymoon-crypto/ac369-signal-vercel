const fetchWithTimeout = (url, timeout = 5000) => {
  return Promise.race([
    fetch(url).then(r => r.json()),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), timeout))
  ]);
};

try {
  const [klines1h, klines4h, klines1d] = await Promise.all([
    fetchWithTimeout(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1h&limit=100`),
    fetchWithTimeout(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=4h&limit=100`),
    fetchWithTimeout(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1d&limit=200`)
  ]);
  // ... proses data
} catch (e) {
  // Fallback ke data sederhana
}
