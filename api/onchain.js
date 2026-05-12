// api/onchain.js — AC369 FUSION BTC ONCHAIN v1.0
// ══════════════════════════════════════════════════════════════════
// Server-side fetch of BTC onchain data (bypasses CORS restrictions)
// Sources: mempool.space (primary) + blockchain.info (fallback)
// ══════════════════════════════════════════════════════════════════

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 's-maxage=30'); // cache 30s
  if (req.method === 'OPTIONS') return res.status(200).end();

  const sf = async (url, ms = 6000, txt = false) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    try {
      const r = await fetch(url, {
        signal: ctrl.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; AC369Bot/1.0)',
          'Accept': 'application/json, text/plain, */*',
        },
      });
      clearTimeout(timer);
      if (!r.ok) return null;
      return txt ? await r.text() : await r.json();
    } catch { clearTimeout(timer); return null; }
  };

  try {
    const t0 = Date.now();

    // Fetch all in parallel
    const [heightR, mempoolR, diffR, hashR, feesR, btcPxR, statsR] = await Promise.allSettled([
      sf('https://mempool.space/api/blocks/tip/height', 6000, true),
      sf('https://mempool.space/api/mempool', 6000),
      sf('https://mempool.space/api/v1/difficulty-adjustment', 6000),
      sf('https://mempool.space/api/v1/mining/hashrate/3d', 7000),
      sf('https://mempool.space/api/v1/fees/recommended', 5000),
      sf('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT', 5000),
      sf('https://api.blockchain.info/stats', 6000), // fallback
    ]);

    const height  = heightR.status === 'fulfilled' ? parseInt(heightR.value) || null : null;
    const mempool = mempoolR.status === 'fulfilled' ? mempoolR.value : null;
    const diff    = diffR.status === 'fulfilled'   ? diffR.value   : null;
    const hash    = hashR.status === 'fulfilled'   ? hashR.value   : null;
    const fees    = feesR.status === 'fulfilled'   ? feesR.value   : null;
    const btcPx   = btcPxR.status === 'fulfilled'  ? +(btcPxR.value?.price || 0) : 0;
    const stats   = statsR.status === 'fulfilled'  ? statsR.value  : null;

    // Block height: mempool.space first, blockchain.info fallback
    const blockH = height || stats?.n_blocks_total || 896000;

    // Hash rate: mempool.space hash/3d or blockchain.info
    const hashRateRaw = hash?.currentHashrate || (stats?.hash_rate || null);
    const hashRate = hashRateRaw ? (hashRateRaw / 1e18).toFixed(1) : null;

    // Difficulty
    const diffRaw = diff?.difficulty || stats?.difficulty || null;
    const diffTxt = diffRaw ? (diffRaw / 1e12).toFixed(1) : null;

    // Epoch progress
    const epochPct   = diff?.progressPercent ? diff.progressPercent.toFixed(1) : null;
    const blkRemain  = diff?.remainingBlocks  ? diff.remainingBlocks  : null;

    // Mempool
    const mempoolTx = mempool?.count || stats?.mempool_size || null;
    const mempoolMB = mempool?.vsize  ? (mempool.vsize / 1e6).toFixed(1) : null;

    // Fees
    const fastFee    = fees?.fastestFee || null;
    const hourFee    = fees?.hourFee    || null;

    // Halving countdown
    const HALVING_BLOCK = 1050000;
    const blocksLeft    = Math.max(0, HALVING_BLOCK - blockH);
    const daysLeft      = Math.round(blocksLeft * 10 / 60 / 24);
    const halvingPct    = Math.min(100, ((blockH - 840000) / (1050000 - 840000)) * 100);

    // Market cap
    const mktCap = btcPx > 0 ? (btcPx * 19900000 / 1e12).toFixed(2) : null;

    // Transaction count
    const txn24h = stats?.n_tx || null;

    const dataOk = !!(height || mempool || diff || hash);

    return res.status(200).json({
      timestamp: Date.now(),
      scanTime: ((Date.now() - t0) / 1000).toFixed(1),
      source: height ? 'mempool.space' : stats ? 'blockchain.info' : 'unavailable',
      dataOk,
      blockH,
      hashRate,
      diffTxt,
      epochPct,
      blkRemain,
      mempoolTx,
      mempoolMB,
      fastFee,
      hourFee,
      txn24h,
      mktCap,
      btcPx,
      blocksLeft,
      daysLeft,
      halvingPct: +halvingPct.toFixed(1),
      halvingBlock: HALVING_BLOCK,
    });

  } catch (e) {
    return res.status(200).json({
      timestamp: Date.now(),
      dataOk: false,
      error: e.message,
      blockH: 896000,
      blocksLeft: 154000,
      daysLeft: 1069,
      halvingPct: 26.7,
      halvingBlock: 1050000,
    });
  }
}
