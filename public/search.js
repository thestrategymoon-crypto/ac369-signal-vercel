// public/search.js - AC369 FUSION Search Module (Isolated)
(function() {
  // Pastikan tidak ada konflik dengan MercuryShadow
  if (typeof MercuryShadow !== 'undefined') {
    console.warn('MercuryShadow terdeteksi, menonaktifkan...');
    MercuryShadow = undefined;
  }

  window.searchCoin = async function() {
    var input = document.getElementById('search-input');
    var resultDiv = document.getElementById('search-result');
    var symbol = input.value.trim().toUpperCase();
    
    if (!symbol) {
      resultDiv.innerHTML = '<div class="error">Masukkan simbol koin.</div>';
      return;
    }
    
    resultDiv.innerHTML = '<div class="loading">Menganalisis ' + symbol + '...</div>';
    
    try {
      var res = await fetch('/api/search?symbol=' + encodeURIComponent(symbol));
      var data = await res.json();
      
      if (data.error) {
        resultDiv.innerHTML = '<div class="error">' + data.error + '</div>';
        return;
      }
      
      var tfHtml = '';
      if (data.timeframes) {
        ['1H','4H','1D'].forEach(function(tf) {
          var d = data.timeframes[tf] || {};
          var patHtml = '';
          (d.patterns||[]).forEach(function(p) {
            patHtml += '<span style="color:'+(p.signal==='bullish'?'#00ff88':p.signal==='bearish'?'#ff4444':'#ccc')+';display:inline-block;margin:2px 3px;padding:2px 6px;background:#1a1a3a;border-radius:8px;">'+p.name+'</span>';
          });
          tfHtml += '<div style="background:#0d0d22;border-radius:10px;padding:12px;margin:8px 0;border-left:3px solid #4a4aff;">'+
            '<b style="color:#a0a0ff;">Timeframe '+tf+'</b>'+
            '<div class="signal-row"><span>RSI:</span> <span>'+(d.rsi||'N/A')+'</span></div>'+
            '<div><b>Pola:</b> '+(patHtml||'<span style="color:#888;">-</span>')+'</div>'+
            '<div><b>Elliott Wave:</b> '+((d.elliottWave||{}).wave||'N/A')+' ('+((d.elliottWave||{}).confidence||0)+'%)<br><small>'+((d.elliottWave||{}).description||'')+'</small></div>'+
            '<div><b>SMC:</b> <span style="color:'+((d.smc||{}).signal==='Bullish'?'#00ff88':(d.smc||{}).signal==='Bearish'?'#ff4444':'#ccc')+';">'+((d.smc||{}).signal||'Neutral')+'</span><br><small>'+((d.smc||{}).summary||'')+'</small></div>'+
            '</div>';
        });
      }
      
      var rec = data.recommendation || {};
      var recColor = (rec.action||'').includes('LONG')?'#00ff88':(rec.action||'').includes('SHORT')?'#ff4444':'#ffaa00';
      var recBg = (rec.action||'').includes('LONG')?'#1a2a1a':(rec.action||'').includes('SHORT')?'#2a1a1a':'#1a1a2a';
      var astro = data.astrology || {};
      
      resultDiv.innerHTML = '<div class="card" style="border:2px solid #4a4aff;">'+
        '<h3>'+data.symbol+' — '+(data.name||'')+'</h3>'+
        '<div class="signal-row"><span><b>Harga:</b></span> <strong>$'+(data.price||0).toLocaleString()+'</strong></div>'+
        '<div class="signal-row"><span><b>24h:</b></span> <span style="color:'+((data.change24h||0)>=0?'#00ff88':'#ff4444')+';">'+(data.change24h||0).toFixed(2)+'%</span></div>'+
        '<div class="signal-row"><span><b>Support:</b></span> <span style="color:#00ff88;">$'+(data.support||'—')+'</span></div>'+
        '<div class="signal-row"><span><b>Resistance:</b></span> <span style="color:#ff4444;">$'+(data.resistance||'—')+'</span></div>'+
        '<div style="margin-top:15px;padding:14px;background:'+recBg+';border-radius:12px;text-align:center;">'+
          '<b style="font-size:1.3rem;color:'+recColor+';">REKOMENDASI: '+(rec.action||'HOLD')+'</b>'+
          '<div style="margin-top:4px;">Keyakinan: '+(rec.confidence||'Netral')+' | Skor: '+(rec.score||50)+'/100</div>'+
          '<div style="margin-top:8px;">'+(rec.summary||rec.explanation||'')+'</div>'+
        '</div>'+
        '<div style="margin-top:15px;">'+tfHtml+'</div>'+
        '<div style="margin-top:12px;padding:10px;background:#1a1a2a;border-radius:8px;"><b>Astrologi:</b> '+(astro.signal||'N/A')+' ('+(astro.moonPhase||'')+' '+(astro.illumination||'')+'%)<br><small>'+(astro.interpretation||'')+'</small></div>'+
        '</div>';
    } catch(e) {
      resultDiv.innerHTML = '<div class="error">Gagal terhubung ke server.</div>';
    }
  };
})();
