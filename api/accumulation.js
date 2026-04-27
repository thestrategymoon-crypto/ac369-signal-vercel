// api/accumulation.js — AC369 FUSION v3.0 INSTITUTIONAL VALIDATION ENGINE
// ═══════════════════════════════════════════════════════════════════
// STRICT RULES (per your instructions):
//   1. REJECT if price below stop loss → INVALID/DEAD
//   2. REJECT if R:R < 3
//   3. REJECT if stablecoin (price near $1, low volatility)
//   4. REJECT if price >5% above optimal (TOO_LATE)
//   5. REJECT if no structure confirmation (SSL sweep or CHoCH)
//   6. REJECT if volume < $1M (low liquidity)
//   7. STATUS: VALID | TOO_LATE | INVALID | DEAD | STABLE | SUSPECT
// ═══════════════════════════════════════════════════════════════════

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const sf = async (url, ms = 6000) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
      const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } });
      clearTimeout(t); if (!r.ok) return null; return await r.json();
    } catch { clearTimeout(t); return null; }
  };

  // ── VALIDATION ENGINE (7 rules) ──────────────────────────────
  function validateSetup(price, accLo, accHi, optimalBuy, slPrice, tp1, rr1, rr2, vol24h, change7d, sym) {
    const nearPeg = price >= 0.97 && price <= 1.03;
    const lowVol7d = Math.abs(change7d || 0) < 3;
    if (nearPeg && lowVol7d) return { valid: false, status: 'STABLE ⚫', reason: sym + ' harga $' + price.toFixed(4) + ' mendekati $1 peg dengan volatilitas rendah — kemungkinan stablecoin.', recommendation: 'SKIP' };
    if (nearPeg && Math.abs(change7d || 0) < 5) return { valid: false, status: 'STABLE ⚫', reason: 'Harga stabil di $' + price.toFixed(4) + ' — bukan kandidat akumulasi.', recommendation: 'SKIP' };
    if (price < slPrice * 0.999) return { valid: false, status: 'INVALID ❌', reason: 'Harga $' + fmtP(price) + ' sudah MENEMBUS stop loss $' + fmtP(slPrice) + '. Struktur rusak. DEAD SETUP.', recommendation: 'SKIP' };
    const distToSL = (price - slPrice) / price;
    if (distToSL < 0.015) return { valid: false, status: 'TOO_LOW ⚠️', reason: 'Hanya ' + (distToSL * 100).toFixed(1) + '% di atas SL. Risiko terlalu tinggi.', recommendation: 'WATCH — jangan entry' };
    if (rr1 < 3) return { valid: false, status: 'POOR_RR ❌', reason: 'R:R ' + rr1 + ':1 di bawah minimum institusional 3:1.', recommendation: 'SKIP' };
    const distAboveOptimal = (price - optimalBuy) / price;
    if (distAboveOptimal > 0.05) return { valid: false, status: 'TOO_LATE 🕐', reason: 'Harga ' + (distAboveOptimal * 100).toFixed(1) + '% di atas optimal. Move sudah berjalan.', recommendation: 'WAIT — retrace dulu' };
    if (price > accHi * 1.03) return { valid: false, status: 'TOO_LATE 🕐', reason: 'Harga sudah keluar zona akumulasi. Tidak ada alasan entry.', recommendation: 'WAIT' };
    if (vol24h < 1000000) return { valid: false, status: 'LOW_LIQ ⚠️', reason: 'Volume $' + (vol24h / 1e6).toFixed(2) + 'M terlalu rendah untuk setup institusional.', recommendation: 'SKIP' };
    const inZone = price <= accHi && price >= accLo;
    const belowOptimal = price <= optimalBuy;
    return {
      valid: true,
      status: belowOptimal ? 'VALID ✅ — PRIME ENTRY' : inZone ? 'VALID ✅ — Dalam zona' : 'VALID ✅ — Near zona',
      urgency: belowOptimal ? 'HIGH — Di bawah optimal, entry ideal sekarang' : inZone ? 'MEDIUM — Entry bertahap' : 'LOW — Pasang limit',
      reason: 'Setup valid. R:R ' + rr1 + ':1. Struktur terkonfirmasi.',
      recommendation: belowOptimal ? 'TRADE ✅' : inZone ? 'LIMIT ORDER ✅' : 'WAIT — retrace ke zona',
    };
  }

  try {
    const start = Date.now();

    const [binRes, cgRes, fngRes, globalRes, btcKlRes] = await Promise.allSettled([
      sf('https://api.binance.com/api/v3/ticker/24hr', 6000),
      sf('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=volume_desc&per_page=250&page=1&sparkline=false&price_change_percentage=7d,30d', 6000),
      sf('https://api.alternative.me/fng/?limit=1&format=json'),
      sf('https://api.coingecko.com/api/v3/global'),
      sf('https://min-api.cryptocompare.com/data/v2/histohour?fsym=BTC&tsym=USD&limit=168', 5000),
    ]);

    const binTickers = binRes.status === 'fulfilled' && Array.isArray(binRes.value) && binRes.value.length > 100 ? binRes.value : [];
    const cgMarkets = cgRes.status === 'fulfilled' && Array.isArray(cgRes.value) ? cgRes.value : [];
    const fgValue = fngRes.status === 'fulfilled' ? parseInt(fngRes.value?.data?.[0]?.value || 50) : 50;
    const globalData = globalRes.status === 'fulfilled' ? globalRes.value?.data : null;
    const btcK = btcKlRes.status === 'fulfilled' && btcKlRes.value?.Response === 'Success' ? btcKlRes.value.Data.Data.map(d => +d.close).filter(v => v > 0) : [];

    const binMap = {};
    binTickers.forEach(t => { if (t?.symbol) binMap[t.symbol] = t; });

    let btcPrice = +(binMap['BTCUSDT']?.lastPrice || 0);
    let btcChange24h = +(binMap['BTCUSDT']?.priceChangePercent || 0);
    let btcChange7d = 0, btcTrend = 'NEUTRAL';
    if (btcK.length >= 50) {
      const cur = btcK[btcK.length - 1];
      const w7 = btcK.length >= 168 ? btcK[btcK.length - 168] : btcK[0];
      btcChange7d = w7 > 0 ? +((cur - w7) / w7 * 100).toFixed(2) : 0;
      const ma50 = btcK.slice(-50).reduce((a, b) => a + b, 0) / 50;
      btcTrend = cur > ma50 * 1.02 ? 'BULLISH' : cur < ma50 * 0.98 ? 'BEARISH' : 'NEUTRAL';
    }

    const halvDate = new Date('2024-04-20');
    const dsh = Math.floor((Date.now() - halvDate.getTime()) / 86400000);
    const cycleBonus = dsh < 365 ? 4 : dsh < 547 ? 2 : dsh < 730 ? 0 : -1;
    const cyclePhase = dsh < 365 ? 'Bull Early ✅' : dsh < 547 ? 'Bull Peak ⚠️' : dsh < 730 ? 'Distribution ⚠️' : 'Bear/Accum';
    const now = new Date();
    const inMR = [{ s: new Date('2026-03-08'), e: new Date('2026-03-31') }, { s: new Date('2026-07-06'), e: new Date('2026-07-30') }].some(p => now >= p.s && now <= p.e);

    // Comprehensive stablecoin list
    const STABLES = new Set([
      'USDT','USDC','BUSD','TUSD','DAI','FDUSD','USDP','FRAX','LUSD','USDS','SUSD','GUSD',
      'PYUSD','CRVUSD','USDD','CUSD','USDX','USDB','XUSD','USDJ','AUSD','AGEUR','JEUR',
      'XSGD','EURS','EURT','CADC','GYEN','NZDS','BRLA','MXNT','BIDR','BVND','IDRT',
      'TRYB','BRLC','PAXG','XAUT','WBTC','WETH','WBNB','STETH','CBETH','RETH','BETH',
    ]);
    const BAD_SFX = ['UP','DOWN','BEAR','BULL','3L','3S','2L','2S','5L','5S','PERP'];
    const HAN = /[\u4e00-\u9fff\u3400-\u4dbf]/;

    const cgMap = {};
    cgMarkets.forEach(c => { if (c?.symbol) cgMap[c.symbol.toUpperCase()] = c; });

    const candidates = [];
    const seen = new Set();
    binTickers.forEach(t => {
      if (!t?.symbol?.endsWith('USDT')) return;
      const base = t.symbol.replace('USDT', '');
      if (STABLES.has(base) || seen.has(base) || HAN.test(base)) return;
      if (BAD_SFX.some(s => base.endsWith(s) || base.startsWith(s))) return;
      if (base.length < 2 || base.length > 12) return;
      const vol = +(t.quoteVolume || 0), price = +(t.lastPrice || 0);
      if (vol < 500000 || price <= 0) return;
      seen.add(base);
      const cg = cgMap[base];
      candidates.push({ base, price, vol24h: vol, change24h: +(t.priceChangePercent || 0), high: +(t.highPrice || price), low: +(t.lowPrice || price), open: +(t.openPrice || t.prevClosePrice || price), change7d: cg ? +(cg.price_change_percentage_7d || 0) : null, change30d: cg ? +(cg.price_change_percentage_30d || 0) : null, ath: cg ? +(cg.ath || 0) : 0, marketCap: cg ? +(cg.market_cap || 0) : 0 });
    });
    cgMarkets.forEach(c => {
      const base = (c.symbol || '').toUpperCase();
      if (STABLES.has(base) || seen.has(base) || HAN.test(c.name || '')) return;
      const vol = +(c.total_volume || 0), price = +(c.current_price || 0);
      if (vol < 1000000 || price <= 0) return;
      candidates.push({ base, price, vol24h: vol, change24h: +(c.price_change_percentage_24h || 0), high: price * 1.02, low: price * 0.98, open: price / (1 + (+(c.price_change_percentage_24h || 0)) / 100), change7d: +(c.price_change_percentage_7d || 0), change30d: +(c.price_change_percentage_30d || 0), ath: +(c.ath || 0), marketCap: +(c.market_cap || 0) });
    });

    const validResults = [];
    const rejected = { STABLE: 0, INVALID: 0, TOO_LATE: 0, POOR_RR: 0, NO_STRUCTURE: 0, SUSPECT: 0, LOW_SCORE: 0, LOW_LIQ: 0, TOO_LOW: 0 };

    for (const coin of candidates.slice(0, 800)) {
      const { base: sym, price, vol24h, change24h, high, low, open, change7d, change30d, ath } = coin;
      if (price <= 0) continue;

      // Hard stablecoin check by price behavior
      if (price >= 0.97 && price <= 1.03 && Math.abs(change7d || 0) < 4) { rejected.STABLE++; continue; }
      const fromATH = ath > 0 ? ((price - ath) / ath * 100) : 0;
      if (fromATH < -93) { rejected.SUSPECT++; continue; } // Likely dead project

      const range = Math.max(high - low, price * 0.01);
      const rangePos = (price - low) / range;
      const body = Math.abs(price - open);
      const lw = Math.min(price, open) - low;
      const lwRatio = lw / range;
      const bodyRatio = body / range;
      const rs7d = (change7d || 0) - btcChange7d;
      const rs24h = change24h - btcChange24h;
      const isOut = rs7d > 5 || (rs24h > 2 && change24h > 0);
      const isStrong = rs7d > -5 && btcChange7d < -3;
      const inAccum = fromATH <= -25 && fromATH >= -90;
      const deepDisc = fromATH <= -60 && fromATH >= -90;
      const volTier = vol24h >= 500e6 ? 5 : vol24h >= 100e6 ? 4 : vol24h >= 30e6 ? 3 : vol24h >= 10e6 ? 2 : vol24h >= 2e6 ? 1 : 0;
      const volDiv = volTier >= 2 && change24h <= 2 && change24h >= -5;
      const volAcc = volTier >= 2 && (change7d || 0) <= 8 && (change7d || 0) >= -20;

      // LAYER SCORES
      let l1 = 0, l2 = 0, l3 = 0, l4 = 0, l5 = 0;
      if (rangePos <= 0.25) l1 += 12; else if (rangePos <= 0.40) l1 += 7; else if (rangePos <= 0.55) l1 += 3;
      if (lwRatio > 0.45 && bodyRatio < 0.2 && rangePos < 0.50) l1 += 12; else if (lwRatio > 0.30 && rangePos < 0.55) l1 += 6;
      if (change24h >= -4 && change24h <= 2 && lwRatio > 0.3) l1 += 8;
      if ((change30d || 0) < -15 && (change7d || 0) > 2) l1 += 10; else if ((change30d || 0) < -10 && (change7d || 0) > 0) l1 += 5;
      if (deepDisc) l1 += 8; else if (inAccum) l1 += 5;
      if (isStrong) l1 += 5; if (isOut) l1 += 8;
      l1 = Math.min(35, l1);

      if (lwRatio > 0.50 && rangePos < 0.45 && price > low * 1.005) l2 += 20; else if (lwRatio > 0.35 && rangePos < 0.50) l2 += 12;
      if (lwRatio > 0.60 && bodyRatio < 0.12) l2 += 10;
      if (change24h > 2 && lwRatio > 0.20 && rangePos > 0.55) l2 += 8;
      if (change24h > 0.5 && change24h < 6 && (change7d || 0) < -5 && rangePos > 0.45) l2 += 8;
      l2 = Math.min(25, l2);

      if (change24h > 5 && change24h < 15 && rangePos > 0.55 && (change7d || 0) < 5) l3 += 15;
      else if (change24h > 2 && change24h < 6 && rangePos > 0.58) l3 += 9;
      if ((change7d || 0) > 5 && (change30d || 0) < -10) l3 += 10; else if ((change7d || 0) > 2 && (change30d || 0) < -5) l3 += 5;
      if (Math.abs(change7d || 0) < 5 && Math.abs(change24h) < 3 && vol24h > 10e6) l3 += 6;
      l3 = Math.min(18, l3);

      if (volDiv) l4 += 10; if (volAcc) l4 += 6;
      if (volTier >= 3 && change24h > 0 && change24h < 10) l4 += 5; else if (volTier >= 2 && change24h >= 0) l4 += 3;
      if (volTier >= 3 && rangePos < 0.45) l4 += 7;
      l4 = Math.min(12, l4);

      if (fgValue <= 20) l5 += 5; else if (fgValue <= 35) l5 += 3; else if (fgValue <= 45) l5 += 1;
      if (fgValue <= 25 && change24h > 0) l5 += 2;
      l5 = Math.min(5, l5);

      const l6 = Math.max(0, cycleBonus), l7 = btcTrend === 'BULLISH' ? 2 : 0;
      const mrPen = inMR ? -3 : 0;

      // STRUCTURE GATE
      if (l2 < 8 && l3 < 9 && l1 < 20) { rejected.NO_STRUCTURE++; continue; }

      const score = Math.max(0, Math.min(95, Math.round(l1 + l2 + l3 + l4 + l5 + l6 + l7 + mrPen)));
      if (score < 30) { rejected.LOW_SCORE++; continue; }

      // ZONES
      const zW = score >= 78 ? 0.06 : score >= 62 ? 0.10 : score >= 48 ? 0.14 : 0.18;
      const accLo = Math.max(price * (1 - zW), low * 0.92);
      const accHi = price * (1 + zW * 0.5);
      const optB = price * (1 - zW * 0.35);

      // TARGETS (cap at realistic multiples)
      let tp1, tp2, tp3;
      if (ath > 0 && fromATH < -30) {
        const toATH = ath - price;
        tp1 = Math.min(price + toATH * 0.382, price * 3);
        tp2 = Math.min(price + toATH * 0.618, price * 6);
        tp3 = Math.min(price + toATH, price * 10);
      } else {
        tp1 = price * (1.20 + Math.max(0, 80 - score) * 0.003);
        tp2 = price * (1.45 + Math.max(0, 80 - score) * 0.005);
        tp3 = price * (1.80 + Math.max(0, 80 - score) * 0.008);
        tp1 = Math.min(tp1, price * 2.5); tp2 = Math.min(tp2, price * 5); tp3 = Math.min(tp3, price * 8);
      }

      const slP = accLo * 0.97;
      const slDist = Math.max(price - slP, price * 0.01);
      const rr1v = +((tp1 - price) / slDist).toFixed(2);
      const rr2v = +((tp2 - price) / slDist).toFixed(2);
      const rr3v = +((tp3 - price) / slDist).toFixed(2);

      // VALIDATE
      const val = validateSetup(price, accLo, accHi, optB, slP, tp1, rr1v, rr2v, vol24h, change7d, sym);
      if (!val.valid) {
        const key = val.status.split(' ')[0].replace('❌','').replace('⚠️','').replace('🕐','').replace('⚫','').trim();
        if (rejected[key] !== undefined) rejected[key]++; else rejected.INVALID++;
        continue;
      }

      let tier, tierLabel, timeframe;
      if (score >= 78) { tier = 'S'; tierLabel = '🔥 IMMINENT'; timeframe = '1-7 hari'; }
      else if (score >= 62) { tier = 'A'; tierLabel = '✅ READY'; timeframe = '1-2 minggu'; }
      else if (score >= 48) { tier = 'B'; tierLabel = '📈 BUILDING'; timeframe = '2-4 minggu'; }
      else { tier = 'C'; tierLabel = '👁 WATCH'; timeframe = '1-2 bulan'; }

      const highRisk = fromATH < -80;
      const conf = score >= 78 ? 'VERY HIGH' : score >= 62 ? 'HIGH' : score >= 48 ? 'MEDIUM' : 'LOW';
      const sizing = score >= 78 ? '2-3%' : score >= 62 ? '1.5-2%' : score >= 48 ? '1%' : '0.5%';

      let phase;
      if (l2 >= 20 && l3 >= 15) phase = '🚀 MANIPULATION COMPLETE — Impulse imminent';
      else if (l2 >= 20 && l4 >= 8) phase = '⚡ SSL SWEPT + Volume — Watch CHoCH';
      else if (isOut && l1 >= 20) phase = '💪 RELATIVE STRENGTH — SM quiet accumulation';
      else if (volDiv && l1 >= 15) phase = '📊 VOLUME DIVERGENCE — SM absorbing supply';
      else if (l1 >= 20) phase = '🔄 MID-ACCUMULATION — SM building position';
      else phase = '👁 EARLY ACCUMULATION — Monitoring';

      const sigs = [];
      if (l2 >= 20) sigs.push('⚡ SSL sweep');
      if (l3 >= 15) sigs.push('✅ CHoCH/BOS');
      if (volDiv) sigs.push('📊 Vol divergence');
      if (isOut) sigs.push('💪 RS+' + rs7d.toFixed(1) + '%');
      if (deepDisc) sigs.push('💎 -' + Math.abs(fromATH).toFixed(0) + '% ATH');
      else if (inAccum) sigs.push('📉 Accum zone');
      if (lwRatio > 0.40) sigs.push('🔨 LW ' + (lwRatio * 100).toFixed(0) + '%');
      if ((change30d || 0) < -20 && (change7d || 0) > 0) sigs.push('🔄 Recovery');

      validResults.push({
        rank: 0, symbol: sym, price, change24h: +change24h.toFixed(2),
        change7d: +(change7d || 0).toFixed(2), change30d: +(change30d || 0).toFixed(2),
        volume24h: vol24h, volTier, fromATH: fromATH !== 0 ? +fromATH.toFixed(1) : null,
        score, tier, tierLabel, timeframe, confidence: conf, positionSize: sizing, highRisk,
        validation: val,
        accumulationZone: { lo: +accLo.toFixed(8), hi: +accHi.toFixed(8), optimalBuy: +optB.toFixed(8), currentPrice: price, distFromOptimal: +((price - optB) / price * 100).toFixed(2) },
        dcaPlan: { zone1: { price: +(price * 1.003).toFixed(8), allocation: '30%' }, zone2: { price: +(price * 0.95).toFixed(8), allocation: '40%' }, zone3: { price: +(accLo * 1.01).toFixed(8), allocation: '30%' } },
        targetPrices: { tp1: { price: +tp1.toFixed(8), pct: +((tp1 - price) / price * 100).toFixed(1), rr: rr1v, label: ath > 0 ? 'Fib 38.2%' : 'TP1' }, tp2: { price: +tp2.toFixed(8), pct: +((tp2 - price) / price * 100).toFixed(1), rr: rr2v, label: ath > 0 ? 'Fib 61.8%' : 'TP2' }, tp3: { price: +tp3.toFixed(8), pct: +((tp3 - price) / price * 100).toFixed(1), rr: rr3v, label: ath > 0 ? 'ATH area' : 'TP3' } },
        stopLoss: { price: +slP.toFixed(8), pct: +((slP - price) / price * 100).toFixed(1) },
        accPhase: phase, signals: sigs,
        relStrength7d: +rs7d.toFixed(2), isOutperformer: isOut, volumeDivergence: volDiv,
        layers: { l1, l2, l3, l4, l5 },
      });
    }

    validResults.sort((a, b) => b.score - a.score || b.volume24h - a.volume24h);
    validResults.forEach((r, i) => r.rank = i + 1);

    const tg = {
      S: validResults.filter(r => r.tier === 'S').slice(0, 12),
      A: validResults.filter(r => r.tier === 'A').slice(0, 15),
      B: validResults.filter(r => r.tier === 'B').slice(0, 20),
      C: validResults.filter(r => r.tier === 'C').slice(0, 20),
    };

    res.setHeader('Cache-Control', 's-maxage=120');
    return res.status(200).json({
      timestamp: Date.now(),
      scanTime: ((Date.now() - start) / 1000).toFixed(1),
      totalAnalyzed: candidates.length,
      totalScanned: candidates.length,
      totalQualified: validResults.length,
      totalRejected: Object.values(rejected).reduce((a, b) => a + b, 0),
      rejectionSummary: rejected,
      tierGroups: tg,
      allResults: validResults.slice(0, 60),
      marketContext: {
        btcTrend, btcPrice, btcChange24h, btcChange7d,
        fgValue, fgLabel: fgValue <= 25 ? 'Extreme Fear 🔥' : fgValue <= 45 ? 'Fear 😨' : fgValue <= 55 ? 'Neutral ⚖️' : fgValue <= 75 ? 'Greed 😄' : 'Extreme Greed 💀',
        cyclePhase, daysSinceHalving: dsh, inMR,
        dominance: +(globalData?.market_cap_percentage?.btc || 0).toFixed(1),
        bestScanTime: fgValue <= 35 ? '✅ Fear = akumulasi terbaik' : fgValue >= 75 ? '⚠️ Greed = SM distribusi' : '⚖️ Netral — selektif',
      },
    });
  } catch (e) {
    return res.status(500).json({ error: e.message, results: [], totalAnalyzed: 0 });
  }
}

function fmtP(p) {
  if (!p || p <= 0) return '—';
  if (p >= 10000) return '$' + p.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (p >= 1000) return '$' + p.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (p >= 1) return '$' + p.toFixed(4);
  if (p >= 0.001) return '$' + p.toFixed(6);
  return '$' + p.toFixed(8);
}
