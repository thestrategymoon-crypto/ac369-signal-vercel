// api/bias.js — v16 ENHANCED
// ══════════════════════════════════════════════════════════════
// UPGRADE v16 vs v15:
// ✅ BTC L/S ratio dari Bybit (faktor scoring baru, high impact)
// ✅ Total MCap momentum sebagai faktor
// ✅ Scoring lebih granular: 6 faktor (naik dari 4)
// ✅ Threshold bias lebih ketat: STRONG BULL butuh ≥8 (naik dari 6)
// ✅ Recommendation lebih actionable dan spesifik
// ✅ FR scoring: 3 tier negatif + 3 tier positif (sebelumnya 2+2)
// ✅ F&G scoring: 5 tier (sebelumnya 3 tier)
// ✅ Tambah btcOI, btcLS, mcapCh24 di response
// ══════════════════════════════════════════════════════════════

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  res.setHeader('Cache-Control', 's-maxage=90, stale-while-revalidate=30');
  const t0 = Date.now();

  const sf = async (url, ms) => {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), ms);
    try {
      const r = await fetch(url, { signal: c.signal, headers: { Accept: 'application/json', 'User-Agent': 'AC369/2.0' } });
      clearTimeout(t);
      if (!r.ok) return null;
      return await r.json();
    } catch { clearTimeout(t); return null; }
  };

  try {
    // 4 parallel calls — max 4.5s total
    const [fngR, byR, glR, byLSR] = await Promise.allSettled([
      sf('https://api.alternative.me/fng/?limit=1&format=json', 4000),
      sf('https://api.bybit.com/v5/market/tickers?category=linear&symbol=BTCUSDT', 4000),
      sf('https://api.coingecko.com/api/v3/global', 4000),
      // NEW: BTC L/S ratio dari Bybit (1h period, most current)
      sf('https://api.bybit.com/v5/market/account-ratio?category=linear&symbol=BTCUSDT&period=1h&limit=1', 3500),
    ]);

    // ── F&G ────────────────────────────────────────────────
    const fgVal = fngR.status === 'fulfilled' && fngR.value?.data?.[0]
      ? parseInt(fngR.value.data[0].value) : 50;
    const fgCls = fngR.status === 'fulfilled' && fngR.value?.data?.[0]
      ? fngR.value.data[0].value_classification : 'Neutral';

    // ── BYBIT BTC ──────────────────────────────────────────
    const byT = byR.status === 'fulfilled' ? byR.value?.result?.list?.[0] : null;
    const btcPx  = byT ? +byT.lastPrice : 0;
    const btcChg = byT?.price24hPcnt ? +(+byT.price24hPcnt * 100).toFixed(2) : 0;
    const frRaw  = byT?.fundingRate ? parseFloat(byT.fundingRate) : null;
    const frPct  = frRaw !== null ? +(frRaw * 100).toFixed(4) : null;
    const btcOI  = byT?.openInterestValue ? +(parseFloat(byT.openInterestValue)/1e9).toFixed(2) : null;

    // ── GLOBAL MARKET ──────────────────────────────────────
    const glData = glR.status === 'fulfilled' ? glR.value?.data : null;
    const btcDom = glData?.market_cap_percentage?.btc
      ? +glData.market_cap_percentage.btc.toFixed(1) : 58.0;
    const totalMC = glData?.total_market_cap?.usd || 0;
    const mcapCh24 = glData?.market_cap_change_percentage_24h_usd
      ? +glData.market_cap_change_percentage_24h_usd.toFixed(2) : 0;

    // ── BTC L/S RATIO (NEW) ────────────────────────────────
    let btcLS = null, btcLongPct = null, btcShortPct = null;
    try {
      const lsd = byLSR.value?.result?.list?.[0];
      if (lsd?.buyRatio) {
        const b = parseFloat(lsd.buyRatio);
        btcLS = +(b / (1 - b + 0.0001)).toFixed(3);
        btcLongPct = +(b * 100).toFixed(1);
        btcShortPct = +(100 - btcLongPct).toFixed(1);
      }
    } catch {}

    // ══════════════════════════════════════════════════════
    // BIAS SCORING v2 — 6 FAKTOR, LEBIH GRANULAR
    // Max range: -17 to +17
    // STRONG BULL ≥ 8 | BULL ≥ 5 | MILD BULL ≥ 2
    // MILD BEAR ≤ -2 | BEAR ≤ -5 | STRONG BEAR ≤ -8
    // ══════════════════════════════════════════════════════
    let score = 0;
    const details = [];

    // ── FAKTOR 1: Fear & Greed (max ±3) ───────────────────
    if      (fgVal <= 10) { score += 3; details.push(`😱 F&G ${fgVal} (EXTREME Fear — zona akumulasi prime)`); }
    else if (fgVal <= 25) { score += 3; details.push(`😱 F&G ${fgVal} (Extreme Fear — beli kuat)`); }
    else if (fgVal <= 35) { score += 2; details.push(`😨 F&G ${fgVal} (Fear — akumulasi bertahap)`); }
    else if (fgVal <= 45) { score += 1; details.push(`😟 F&G ${fgVal} (Mild Fear)`); }
    else if (fgVal >= 85) { score -= 3; details.push(`🤑 F&G ${fgVal} (EXTREME Greed — distribusi SM)`); }
    else if (fgVal >= 75) { score -= 3; details.push(`🤑 F&G ${fgVal} (Extreme Greed — keluar bertahap)`); }
    else if (fgVal >= 65) { score -= 2; details.push(`😄 F&G ${fgVal} (Greed — waspada koreksi)`); }
    else if (fgVal >= 55) { score -= 1; details.push(`🙂 F&G ${fgVal} (Mild Greed)`); }
    else                  { details.push(`😐 F&G ${fgVal} (Neutral)`); }

    // ── FAKTOR 2: BTC Price Change (max ±2) ───────────────
    if      (btcChg > 6)  { score += 2; details.push(`🚀 BTC +${btcChg}% strong bullish momentum`); }
    else if (btcChg > 2)  { score += 2; details.push(`📈 BTC +${btcChg}% bullish`); }
    else if (btcChg > 0.5){ score += 1; details.push(`📈 BTC +${btcChg}% mild bullish`); }
    else if (btcChg < -6) { score -= 2; details.push(`📉 BTC ${btcChg}% strong downtrend aktif`); }
    else if (btcChg < -2) { score -= 2; details.push(`📉 BTC ${btcChg}% downtrend`); }
    else if (btcChg < -0.5){ score -= 1; details.push(`🔻 BTC ${btcChg}% mild bearish`); }
    else                  { details.push(`↔️ BTC ${btcChg >= 0 ? '+' : ''}${btcChg}% sideways`); }

    // ── FAKTOR 3: BTC Dominance (max ±2) ──────────────────
    if      (btcDom > 65) { score -= 2; details.push(`₿ Dom ${btcDom}% — BTC dominasi ekstrem, altcoin sangat lemah`); }
    else if (btcDom > 58) { score -= 1; details.push(`₿ Dom ${btcDom}% — BTC season, altcoin relatif lemah`); }
    else if (btcDom < 44) { score += 2; details.push(`🔄 Dom ${btcDom}% — ALTCOIN SEASON aktif! 🚀`); }
    else if (btcDom < 50) { score += 1; details.push(`🔄 Dom ${btcDom}% — Rotasi ke altcoin dimulai`); }
    else                  { details.push(`₿ Dom ${btcDom}% — Netral`); }

    // ── FAKTOR 4: Funding Rate (max ±3) ───────────────────
    if (frPct !== null) {
      if      (frPct < -0.02) { score += 3; details.push(`⚡ FR ${frPct}% EXTREME negative — short squeeze IMMINENT`); }
      else if (frPct < -0.01) { score += 2; details.push(`💎 FR ${frPct}% negative — strong squeeze potential`); }
      else if (frPct < -0.003){ score += 1; details.push(`💚 FR ${frPct}% slightly negative — mild bullish`); }
      else if (frPct > 0.07)  { score -= 3; details.push(`🚨 FR ${frPct}% EXTREME — longs sangat overheated, crash risk`); }
      else if (frPct > 0.03)  { score -= 2; details.push(`⚠️ FR ${frPct}% elevated — longs dominan, hati-hati`); }
      else if (frPct > 0.01)  { score -= 1; details.push(`⚠️ FR ${frPct}% mildly positive — monitor`); }
      else                    { details.push(`⚖️ FR ${frPct}% normal (neutral zone)`); }
    } else {
      details.push('⚖️ FR: data Bybit tidak tersedia');
    }

    // ── FAKTOR 5: BTC L/S Ratio (max ±3) — NEW ────────────
    if (btcLS !== null) {
      if      (btcLS < 0.50) { score += 3; details.push(`🐻 L/S ${btcLS} (${btcShortPct}% short) — EXTREME short dominance, squeeze prime setup`); }
      else if (btcLS < 0.70) { score += 2; details.push(`🐻 L/S ${btcLS} (${btcShortPct}% short) — shorts heavy, bullish lean`); }
      else if (btcLS < 0.88) { score += 1; details.push(`🐻 L/S ${btcLS} — slight short bias, mild bullish`); }
      else if (btcLS > 3.00) { score -= 3; details.push(`⚠️ L/S ${btcLS} (${btcLongPct}% long) — EXTREME long overload, liquidation risk besar`); }
      else if (btcLS > 2.00) { score -= 2; details.push(`⚠️ L/S ${btcLS} (${btcLongPct}% long) — longs sangat dominan`); }
      else if (btcLS > 1.50) { score -= 1; details.push(`⚠️ L/S ${btcLS} — longs dominan, waspada`); }
      else                   { details.push(`⚖️ L/S ${btcLS} — balanced position`); }
    } else {
      details.push('⚖️ L/S ratio: data Bybit tidak tersedia');
    }

    // ── FAKTOR 6: Total MCap Trend (max ±2) — NEW ─────────
    if (mcapCh24 > 4)       { score += 2; details.push(`💹 MCap +${mcapCh24}% — inflow kapital besar ke crypto`); }
    else if (mcapCh24 > 1.5){ score += 1; details.push(`💹 MCap +${mcapCh24}% — inflow positif`); }
    else if (mcapCh24 < -4) { score -= 2; details.push(`💸 MCap ${mcapCh24}% — outflow besar terdeteksi`); }
    else if (mcapCh24 < -1.5){ score -= 1; details.push(`💸 MCap ${mcapCh24}% — outflow mild`); }
    // No detail push if near-neutral to keep details clean

    // ══════════════════════════════════════════════════════
    // FINAL BIAS — Thresholds lebih ketat dari v15
    // ══════════════════════════════════════════════════════
    let bias, biasLabel, recommendation;

    if      (score >= 10) {
      bias = 'STRONG_BULL'; biasLabel = '🚀 STRONG BULLISH';
      recommendation = '✅ PRIME BULL SETUP — Semua faktor aligned. Full size dengan SL ketat. Target RR 1:3+. Prioritaskan koin FR negatif + convergence ≥72.';
    }
    else if (score >= 7) {
      bias = 'STRONG_BULL'; biasLabel = '🚀 STRONG BULLISH';
      recommendation = '✅ STRONG BULL — Kondisi excellent untuk long. Sizing penuh, target RR 1:2.5+.';
    }
    else if (score >= 4) {
      bias = 'BULLISH'; biasLabel = '📈 BULLISH';
      recommendation = '✅ BULLISH — Kondisi bagus untuk long. Filter setup dengan convergence ≥70 dan volume konfirmasi.';
    }
    else if (score >= 2) {
      bias = 'MILD_BULL'; biasLabel = '🟢 MILD BULLISH';
      recommendation = '🟢 MILD BULL — Entry hanya setup berkualitas tinggi (conv ≥72). Sizing 70-80%. SL wajib ATR-based.';
    }
    else if (score <= -10) {
      bias = 'STRONG_BEAR'; biasLabel = '💀 STRONG BEARISH';
      recommendation = '🔴 DANGER ZONE — Cash atau short only. JANGAN beli altcoin apapun. Preserve capital adalah prioritas.';
    }
    else if (score <= -7) {
      bias = 'STRONG_BEAR'; biasLabel = '💀 STRONG BEARISH';
      recommendation = '🔴 STRONG BEAR — Cash 80%+. Short hanya koin overbought dengan konfirmasi. Avoid long.';
    }
    else if (score <= -4) {
      bias = 'BEARISH'; biasLabel = '📉 BEARISH';
      recommendation = '⚠️ BEARISH — Defensive mode. Altcoin naik = dead-cat bounce saja. Kurangi exposure.';
    }
    else if (score <= -2) {
      bias = 'MILD_BEAR'; biasLabel = '🔴 MILD BEARISH';
      recommendation = '⚠️ MILD BEAR — Sizing 40-50%. BTC/ETH > altcoin. SL lebih ketat. Hindari FOMO entry.';
    }
    else {
      bias = 'NEUTRAL'; biasLabel = '⚖️ NEUTRAL';
      recommendation = '⚖️ NEUTRAL — Market transisi. DCA spot di discount zone. Setup swing: convergence ≥70, sizing 60%.';
    }

    // ── ASTRO ──────────────────────────────────────────────
    const jd  = Date.now() / 86400000 + 2440587.5;
    const dnm = ((jd - 2460320.5) % 29.53058867 + 29.53058867) % 29.53058867;
    const phases = [
      [1.5,'New Moon','🌑'],[7.5,'Waxing Crescent','🌒'],[8.5,'First Quarter','🌓'],
      [14,'Waxing Gibbous','🌔'],[16,'Full Moon','🌕'],[22,'Waning Gibbous','🌖'],
      [25,'Last Quarter','🌗'],[29.5,'Waning Crescent','🌘']
    ];
    let moonPhase = 'Dark Moon', moonEmoji = '🌑';
    for (const [lim, ph, em] of phases) { if (dnm < lim) { moonPhase = ph; moonEmoji = em; break; } }
    const dsh = Math.floor((Date.now() - 1713571200000) / 86400000);
    const halvingPhase = dsh < 60  ? 'Post-Halving Shock'
                       : dsh < 180 ? '🌱 Early Bull'
                       : dsh < 365 ? '🔥 Bull Cycle Early'
                       : dsh < 480 ? '⚡ Bull Peak Zone'
                       : dsh < 547 ? '⚡ Bull Cycle Peak'
                       : dsh < 730 ? '⚠️ Distribution Zone'
                       : '🌱 Accumulation';

    return res.status(200).json({
      ok: true, ts: Date.now(), elapsed: Date.now() - t0, version: 'v16',
      bias, biasLabel, biasScore: score,
      // F&G
      fgValue: fgVal, fgClass: fgCls,
      // BTC
      btcPrice: btcPx, btcChg24h: btcChg,
      btcDom, frPct, btcOI,
      // NEW: L/S ratio
      btcLS, btcLongPct, btcShortPct,
      // Market
      totalMC: totalMC > 0 ? +(totalMC/1e12).toFixed(2) : null,
      mcapCh24,
      btcTrend: btcChg > 2 ? 'BULLISH' : btcChg < -2 ? 'BEARISH' : 'NEUTRAL',
      details,
      recommendation,
      astro: {
        moonPhase, moonEmoji, halvingPhase,
        daysSinceHalving: dsh,
        daysSinceNM: +dnm.toFixed(1)
      },
    });

  } catch (e) {
    return res.status(200).json({
      ok: false, error: e.message, ts: Date.now(), version: 'v16',
      bias: 'NEUTRAL', biasLabel: '⚖️ NEUTRAL', biasScore: 0,
      fgValue: 50, fgClass: 'Neutral',
      btcPrice: 0, btcChg24h: 0, btcDom: 58, frPct: null,
      btcLS: null, btcLongPct: null, btcShortPct: null,
      mcapCh24: 0,
      btcTrend: 'NEUTRAL',
      details: ['Error: ' + e.message],
      recommendation: '⚖️ Data tidak tersedia — coba refresh.',
      astro: { moonPhase: 'Unknown', moonEmoji: '🌙', halvingPhase: 'Bull Cycle', daysSinceHalving: 400 },
    });
  }
}
