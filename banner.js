// banner.js — Decentní horní informační lišta s živým odpočtem

(function() {
  if (document.getElementById('kk-promo-banner')) return;

  fetch('/api/codes?banner=1')
    .then(function(r) { return r.json(); })
    .then(function(items) {
      if (!Array.isArray(items) || items.length === 0) return;

      var earliestExp = null;
      items.forEach(function(item) {
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
          border-bottom: 1px solid rgba(200, 138, 44, 0.45);
          color: #e5e5e5;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Inter", sans-serif;
          font-size: 13px;
          line-height: 1.4;
          padding: 9px 16px;
          text-align: center;
          position: relative;
          z-index: 1000;
          box-shadow: 0 4px 12px rgba(0,0,0,0.5);
          transition: all 0.4s ease;
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
          border: 1px solid rgba(255, 153, 0, 0.35);
          padding: 2px 7px;
          border-radius: 4px;
          letter-spacing: 1px;
        }
        .kk-banner-divider {
          color: #555;
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

      var itemsHtml = items.map(function(item) {
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

      if (earliestExp) {
        var timerEl = document.getElementById('kk-timer-val');

        function updateCountdown() {
          var now = Date.now();
          var diff = earliestExp - now;

          if (diff <= 0) {
            clearInterval(interval);
            banner.style.opacity = '0';
            banner.style.maxHeight = '0';
            banner.style.paddingTop = '0';
            banner.style.paddingBottom = '0';
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
