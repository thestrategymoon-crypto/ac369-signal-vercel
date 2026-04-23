// api/onchain.js - AC369 FUSION On-Chain Data & Whale Tracker (Fase 6)
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'max-age=0, s-maxage=120');

  try {
    const [whaleData, exchangeFlow] = await Promise.allSettled([
      fetchWhaleTransactions(),
      fetchExchangeNetflow()
    ]);

    const result = {
      timestamp: new Date().toISOString(),
      whaleTransactions: getValue(whaleData, { transactions: [], summary: 'Gagal memuat data whale.' }),
      exchangeFlow: getValue(exchangeFlow, { netFlow: 0, interpretation: 'Data tidak tersedia' }),
      onchainSummary: generateOnchainSummary(
        getValue(whaleData, {}),
        getValue(exchangeFlow, {})
      )
    };

    res.status(200).json(result);
  } catch (error) {
    console.error('Onchain API Error:', error);
    res.status(500).json({ error: error.message });
  }
}

function getValue(promise, fallback) {
  return promise.status === 'fulfilled' ? promise.value : fallback;
}

// ==================== WHALE TRANSACTIONS (Whale Alert) ====================
async function fetchWhaleTransactions() {
  const API_KEY = process.env.WHALE_ALERT_API_KEY;
  if (!API_KEY) {
    return { 
      error: 'WHALE_ALERT_API_KEY belum diatur', 
      transactions: [], 
      summary: 'Kunci API Whale Alert tidak ditemukan.' 
    };
  }

  try {
    const url = `https://api.whale-alert.io/v1/transactions?api_key=${API_KEY}&min_value=500000&limit=15`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    const data = await response.json();
    
    if (!data.transactions || data.transactions.length === 0) {
      return { 
        transactions: [], 
        summary: 'Tidak ada transaksi whale (>$500k) dalam 24 jam terakhir.' 
      };
    }

    const whales = data.transactions.map(tx => {
      const amount = tx.amount;
      const valueUSD = tx.amount_usd;
      const symbol = tx.symbol;
      
      let interpretation = '';
      if (valueUSD >= 10000000) interpretation = '🐋 Mega Whale';
      else if (valueUSD >= 5000000) interpretation = '🐳 Large Whale';
      else interpretation = '🦈 Whale';

      return {
        hash: tx.hash ? tx.hash.slice(0, 6) + '...' + tx.hash.slice(-4) : 'N/A',
        amount: `${parseFloat(amount).toFixed(2)} ${symbol}`,
        valueUSD: `$${valueUSD.toLocaleString()}`,
        from: tx.from?.owner || 'Unknown',
        to: tx.to?.owner || 'Unknown',
        timestamp: new Date(tx.timestamp * 1000).toLocaleString('id-ID'),
        interpretation,
        action: (tx.from?.owner_type === 'exchange' && tx.to?.owner_type !== 'exchange') ? 'Akumulasi' : 
                (tx.from?.owner_type !== 'exchange' && tx.to?.owner_type === 'exchange') ? 'Distribusi' : 'Transfer'
      };
    });

    const inflowCount = whales.filter(w => w.action === 'Distribusi').length;
    const outflowCount = whales.filter(w => w.action === 'Akumulasi').length;

    return {
      transactions: whales,
      summary: `${whales.length} transaksi whale. ${outflowCount} akumulasi, ${inflowCount} distribusi.`,
      lastUpdate: new Date().toISOString()
    };
  } catch (e) {
    console.error('Whale Alert Error:', e);
    return { error: e.message, transactions: [], summary: 'Gagal terhubung ke Whale Alert.' };
  }
}

// ==================== EXCHANGE NETFLOW (CoinMetrics Community - No Key) ====================
async function fetchExchangeNetflow() {
  try {
    const url = `https://community-api.coinmetrics.io/v4/timeseries/asset-metrics?assets=btc&metrics=FlowOutExchUSD,FlowInExchUSD&frequency=1d&page_size=2`;
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    const data = await response.json();
    
    if (data.data && data.data[0]) {
      const flowOut = data.data[0].FlowOutExchUSD?.values || [];
      const flowIn = data.data[0].FlowInExchUSD?.values || [];
      
      if (flowOut.length === 0 || flowIn.length === 0) {
        throw new Error('Data netflow kosong');
      }

      const lastOut = parseFloat(flowOut[flowOut.length - 1]) || 0;
      const lastIn = parseFloat(flowIn[flowIn.length - 1]) || 0;
      const netFlow = lastOut - lastIn;
      const netFlowFormatted = (netFlow / 1e6).toFixed(2) + 'M';
      
      let interpretation = '';
      let signal = '';
      
      if (netFlow > 50000000) {
        signal = 'Bullish';
        interpretation = `Arus keluar bersih $${netFlowFormatted} (Akumulasi kuat)`;
      } else if (netFlow > 10000000) {
        signal = 'Slightly Bullish';
        interpretation = `Arus keluar bersih $${netFlowFormatted} (Akumulasi)`;
      } else if (netFlow < -50000000) {
        signal = 'Bearish';
        interpretation = `Arus masuk bersih $${netFlowFormatted} (Distribusi)`;
      } else if (netFlow < -10000000) {
        signal = 'Slightly Bearish';
        interpretation = `Arus masuk bersih $${netFlowFormatted} (Potensi jual)`;
      } else {
        signal = 'Neutral';
        interpretation = 'Arus bursa seimbang';
      }
      
      return {
        netFlowUSD: netFlowFormatted,
        netFlowRaw: netFlow,
        signal,
        interpretation,
        lastOutUSD: (lastOut / 1e6).toFixed(2) + 'M',
        lastInUSD: (lastIn / 1e6).toFixed(2) + 'M'
      };
    }
    
    return { error: 'Data tidak tersedia', interpretation: 'Gagal mengambil data netflow.' };
  } catch (e) {
    console.error('CoinMetrics Error:', e);
    return { error: e.message, interpretation: 'Gagal terhubung ke CoinMetrics.' };
  }
}

// ==================== RINGKASAN ====================
function generateOnchainSummary(whale, flow) {
  const parts = [];
  
  if (whale.transactions && whale.transactions.length > 3) {
    parts.push(`🐋 ${whale.transactions.length} transaksi whale terdeteksi.`);
  }
  
  if (flow.signal === 'Bullish' || flow.signal === 'Slightly Bullish') {
    parts.push(`💰 ${flow.interpretation}.`);
  } else if (flow.signal === 'Bearish' || flow.signal === 'Slightly Bearish') {
    parts.push(`📤 ${flow.interpretation}.`);
  }
  
  return parts.length > 0 ? parts.join(' ') : 'Tidak ada sinyal on-chain signifikan.';
}
