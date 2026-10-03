// banner.js — Horní informační lišta s živým odpočtem

(function() {
  if (document.getElementById('kk-promo-banner')) return;

  fetch('/api/codes?banner=1')
    .then(function(r) { return r.json(); })
    .then(function(items) {
      if (!Array.isArray(items) || items.length === 0) return;

      var nowMs = Date.now();

      // Vyfiltrujeme pouze kódy, které mají platný budoucí čas
      var validItems = items.filter(function(item) {
        if (!item.validUntil) return true;
        var t = new Date(item.validUntil).getTime();
        return !isNaN(t) && t > nowMs;
      });

      if (validItems.length === 0) return;

      var earliestExp = null;
      validItems.forEach(function(item) {
        if (item.validUntil) {
          var t = new Date(item.validUntil).getTime();
          if (!isNaN(t)) {
            if (!earliestExp || t < earliestExp) {
              earliestExp = t;
            }
          }
        }
      });

      var style = document.createElement('style');
      style.textContent = `
        #kk-promo-banner {
          background: #0d0d0d;
          background: linear-gradient(90deg, #0d0d0d 0%, #171510 50%, #0d0d0d 100%);
          border-bottom: 1px solid rgba(200, 138, 44, 0.55);
          color: #e5e5e5;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Inter", sans-serif;
          font-size: 13.5px;
          line-height: 1.4;
          padding: 10px 16px;
          text-align: center;
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          box-sizing: border-box;
          z-index: 999999;
          box-shadow: 0 4px 18px rgba(0,0,0,0.7);
          transition: transform 0.4s ease, opacity 0.4s ease;
          overflow: hidden;
        }
        .kk-banner-inner {
          max-width: 1200px;
          margin: 0 auto;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 14px;
          flex-wrap: wrap;
        }
        .kk-banner-item {
          display: inline-flex;
          align-items: center;
          gap: 6px;
        }
        .kk-banner-label {
          color: #bbb;
        }
        .kk-banner-code {
          font-family: monospace;
          font-weight: bold;
          color: #ff9900;
          background: rgba(255, 153, 0, 0.12);
          border: 1px solid rgba(255, 153, 0, 0.4);
          padding: 2px 7px;
          border-radius: 4px;
          letter-spacing: 1px;
        }
        .kk-banner-divider {
          color: #666;
          user-select: none;
        }
        .kk-banner-countdown {
          color: #2ecc71;
          font-family: monospace;
          font-weight: bold;
          letter-spacing: 0.5px;
          display: inline-flex;
          align-items: center;
          gap: 4px;
        }
        @media (max-width: 768px) {
          #kk-promo-banner {
            font-size: 12px;
            padding: 8px 12px;
          }
          .kk-banner-inner {
            gap: 8px;
          }
        }
      `;
      document.head.appendChild(style);

      var banner = document.createElement('div');
      banner.id = 'kk-promo-banner';

      var itemsHtml = validItems.map(function(item) {
        return '<span class="kk-banner-item">'
          + '<span class="kk-banner-label">' + item.label + ':</span> '
          + '<span class="kk-banner-code">' + item.code + '</span>'
          + '</span>';
      }).join(' <span class="kk-banner-divider">|</span> ');

      var timerHtml = earliestExp 
        ? ' <span class="kk-banner-divider">—</span> <span class="kk-banner-countdown">⏳ končí za <span id="kk-timer-val">...</span></span>' 
        : '';

      banner.innerHTML = '<div class="kk-banner-inner">' + itemsHtml + timerHtml + '</div>';
      document.body.prepend(banner);

      // Posun hlavičky a obsahu dolů o výšku banneru
      var bH = banner.offsetHeight || 42;
      var header = document.querySelector('.site-header');

      function adjustLayout(height) {
        document.body.style.paddingTop = height + 'px';
        if (header) {
          var pos = window.getComputedStyle(header).position;
          if (pos === 'fixed' || pos === 'absolute') {
            header.style.top = height + 'px';
          }
        }
      }

      adjustLayout(bH);
      // Přeměření po vykreslení fontů
      setTimeout(function() {
        var newH = banner.offsetHeight;
        if (newH && newH !== bH) {
          adjustLayout(newH);
        }
      }, 100);

      if (earliestExp) {
        var timerEl = document.getElementById('kk-timer-val');

        function updateCountdown() {
          var now = Date.now();
          var diff = earliestExp - now;

          if (diff <= 0) {
            clearInterval(interval);
            banner.style.opacity = '0';
            banner.style.transform = 'translateY(-100%)';
            document.body.style.paddingTop = '';
            if (header) header.style.top = '';
            setTimeout(function() { banner.remove(); }, 400);
            return;
          }

          var days = Math.floor(diff / (1000 * 60 * 60 * 24));
          var hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
          var minutes = Math.floor((diff / 1000 / 60) % 60);
          var seconds = Math.floor((diff / 1000) % 60);

          function pad(n) { return n < 10 ? '0' + n : n; }

          var timeString = '';
          if (days > 0) {
            timeString = days + 'd ' + pad(hours) + ':' + pad(minutes) + ':' + pad(seconds);
          } else {
            timeString = pad(hours) + ':' + pad(minutes) + ':' + pad(seconds);
          }

          if (timerEl) timerEl.textContent = timeString;
        }

        updateCountdown();
        var interval = setInterval(updateCountdown, 1000);
      }
    })
    .catch(function(e) {
      console.warn('Banner nelze načíst:', e);
    });
})();
