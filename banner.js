// banner.js — Horní informační lišta se samostatným odpočtem pro každý kód

(function() {
  if (document.getElementById('kk-promo-banner')) return;

  fetch('/api/codes?banner=1')
    .then(function(r) { return r.json(); })
    .then(function(items) {
      if (!Array.isArray(items) || items.length === 0) return;

      var nowMs = Date.now();

      // Vyfiltrujeme pouze kódy, které ještě nevypršely
      var validItems = items.filter(function(item) {
        if (!item.validUntil) return true;
        var t = new Date(item.validUntil).getTime();
        return !isNaN(t) && t > nowMs;
      });

      if (validItems.length === 0) return;

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
          position: fixed !important;
          top: 0 !important;
          left: 0 !important;
          width: 100% !important;
          box-sizing: border-box !important;
          z-index: 999999 !important;
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
          gap: 16px;
          flex-wrap: wrap;
        }
        .kk-banner-item {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          transition: opacity 0.3s ease, transform 0.3s ease;
        }
        .kk-banner-item + .kk-banner-item::before {
          content: "|";
          color: #555;
          margin-right: 10px;
          margin-left: -4px;
          user-select: none;
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
        .kk-banner-countdown {
          color: #2ecc71;
          background: rgba(46, 204, 113, 0.1);
          border: 1px solid rgba(46, 204, 113, 0.28);
          padding: 2px 7px;
          border-radius: 4px;
          font-family: monospace;
          font-weight: bold;
          font-size: 12px;
          letter-spacing: 0.5px;
          display: inline-flex;
          align-items: center;
          gap: 4px;
          white-space: nowrap;
        }
        @media (max-width: 768px) {
          #kk-promo-banner {
            font-size: 12px;
            padding: 8px 12px;
          }
          .kk-banner-inner {
            gap: 10px;
          }
          .kk-banner-item + .kk-banner-item::before {
            display: none;
          }
        }
      `;
      document.head.appendChild(style);

      var banner = document.createElement('div');
      banner.id = 'kk-promo-banner';

      var itemsContainer = document.createElement('div');
      itemsContainer.className = 'kk-banner-inner';

      validItems.forEach(function(item) {
        var itemEl = document.createElement('div');
        itemEl.className = 'kk-banner-item';
        itemEl.setAttribute('data-code', item.code);

        var countdownHtml = '';
        if (item.validUntil) {
          itemEl.setAttribute('data-until', item.validUntil);
          countdownHtml = '<span class="kk-banner-countdown">⏳ <span class="kk-countdown-val">...</span></span>';
        }

        itemEl.innerHTML = '<span class="kk-banner-label">' + item.label + ':</span> '
          + '<span class="kk-banner-code">' + item.code + '</span> '
          + countdownHtml;

        itemsContainer.appendChild(itemEl);
      });

      banner.appendChild(itemsContainer);
      document.body.prepend(banner);

      var header = document.querySelector('.site-header');

      function adjustLayout() {
        var bH = banner.offsetHeight || 42;
        document.body.style.setProperty('padding-top', bH + 'px', 'important');
        if (header) {
          header.style.setProperty('top', bH + 'px', 'important');
        }
      }

      adjustLayout();
      setTimeout(adjustLayout, 50);
      setTimeout(adjustLayout, 200);
      window.addEventListener('resize', adjustLayout);

      function formatDiff(diffMs) {
        if (diffMs <= 0) return null;
        var days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        var hours = Math.floor((diffMs / (1000 * 60 * 60)) % 24);
        var minutes = Math.floor((diffMs / 1000 / 60) % 60);
        var seconds = Math.floor((diffMs / 1000) % 60);

        function pad(n) { return (n < 10 ? '0' : '') + n; }

        if (days > 0) {
          return days + 'd ' + pad(hours) + ':' + pad(minutes) + ':' + pad(seconds);
        }
        if (hours > 0) {
          return pad(hours) + ':' + pad(minutes) + ':' + pad(seconds);
        }
        return pad(minutes) + ':' + pad(seconds);
      }

      function updateAllCountdowns() {
        var currentNow = Date.now();
        var allItems = itemsContainer.querySelectorAll('.kk-banner-item');

        if (allItems.length === 0) {
          clearInterval(timerInterval);
          closeEntireBanner();
          return;
        }

        allItems.forEach(function(el) {
          var untilStr = el.getAttribute('data-until');
          if (!untilStr) return;

          var expTime = new Date(untilStr).getTime();
          var diff = expTime - currentNow;

          if (diff <= 0) {
            // Tento konkrétní kód vypršel -> plynule ho odstraníme
            el.style.opacity = '0';
            el.style.transform = 'scale(0.85)';
            setTimeout(function() {
              el.remove();
              adjustLayout();
              // Pokud v banneru už nezbyl vůbec žádný kód, zavřeme celý banner
              if (itemsContainer.querySelectorAll('.kk-banner-item').length === 0) {
                closeEntireBanner();
              }
            }, 300);
          } else {
            var valEl = el.querySelector('.kk-countdown-val');
            if (valEl) {
              valEl.textContent = formatDiff(diff);
            }
          }
        });
      }

      function closeEntireBanner() {
        clearInterval(timerInterval);
        window.removeEventListener('resize', adjustLayout);
        banner.style.opacity = '0';
        banner.style.transform = 'translateY(-100%)';
        document.body.style.removeProperty('padding-top');
        if (header) header.style.removeProperty('top');
        setTimeout(function() { banner.remove(); }, 400);
      }

      updateAllCountdowns();
      var timerInterval = setInterval(updateAllCountdowns, 1000);
    })
    .catch(function(e) {
      console.warn('Banner nelze načíst:', e);
    });
})();
