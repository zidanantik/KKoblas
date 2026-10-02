var DEFAULT_PRICES = {
  startup:   { jednorizove: '6 900 Kč' },
  mentoring: { jednorizove: '14 700 Kč', splatky: '7 500 Kč (1. splátka)' },
  ultimate:  { jednorizove: '22 300 Kč', splatky: '11 900 Kč (1. splátka)' }
};

function buildServiceMap(prices, event) {
  var p = prices || {};
  var su = p.startup   || DEFAULT_PRICES.startup;
  var me = p.mentoring || DEFAULT_PRICES.mentoring;
  var ul = p.ultimate  || DEFAULT_PRICES.ultimate;
  var map = {
    startup: {
      label: 'START-UP – Profi odrazový můstek',
      jednorizove: { platba: 'Jednorázová platba', price: su.jednorizove || DEFAULT_PRICES.startup.jednorizove },
      splatky:     { platba: 'Jednorázová platba', price: su.jednorizove || DEFAULT_PRICES.startup.jednorizove }
    },
    mentoring: {
      label: 'MENTORING – Individuální vedení',
      jednorizove: { platba: 'Jednorázová platba', price: me.jednorizove || DEFAULT_PRICES.mentoring.jednorizove },
      splatky:     { platba: 'Splátkový kalendář', price: me.splatky     || DEFAULT_PRICES.mentoring.splatky }
    },
    ultimate: {
      label: 'ULTIMATE – Maximální výkon a biohacking',
      jednorizove: { platba: 'Jednorázová platba', price: ul.jednorizove || DEFAULT_PRICES.ultimate.jednorizove },
      splatky:     { platba: 'Splátkový kalendář', price: ul.splatky     || DEFAULT_PRICES.ultimate.splatky }
    }
  };
  if (event && event.active && event.name) {
    map.event = {
      label: event.name,
      jednorizove: { platba: 'Jednorázová platba', price: event.cena || '—' }
    };
  }
  return map;
}

async function initOrder(serviceMap, rawStatus) {
  var params   = new URLSearchParams(location.search);
  var sluzba   = params.get('sluzba') || 'startup';
  var platba   = params.get('platba') || 'jednorizove';
  var kodParam = (params.get('kod') || params.get('code') || '').trim().toUpperCase();

  var svc  = serviceMap[sluzba] || serviceMap.startup;
  var info = svc[platba] || svc.jednorizove;

  // ── Ověření kódu voucheru / slevy ──
  var validPromo = null;
  if (kodParam) {
    try {
      var checkUrl = '/api/codes?code=' + encodeURIComponent(kodParam) 
        + '&package=' + encodeURIComponent(sluzba)
        + (platba === 'splatky' ? '&splatky=true' : '');
      var cRes = await fetch(checkUrl);
      if (cRes.ok) {
        var cData = await cRes.json();
        if (cData && cData.valid) {
          validPromo = cData;
        }
      }
    } catch (e) {
      console.warn('Ověření kódu selhalo:', e);
    }
  }

  // ── Kontrola kapacity a uzamčení balíčku ──
  var isClosed = false;
  if (rawStatus) {
    if (rawStatus[sluzba] === 'uzavreny') isClosed = true;
    if (rawStatus.capacity && rawStatus.capacity.mode === 'total' && rawStatus.capacity.totalLimit > 0) {
      var activeCount = (rawStatus.counts && rawStatus.counts.total) || 0;
      if (activeCount >= rawStatus.capacity.totalLimit) {
        isClosed = true;
      }
    }
  }

  // Pokud je kapacita naplněná, ale klient má platný dárkový poukaz (100% sleva) -> VIP přístup povolen!
  var isGiftVoucher = validPromo && validPromo.type === 'gift';
  if (isClosed && !isGiftVoucher) {
    window.location.href = 'cekacka.html?sluzba=' + encodeURIComponent(sluzba);
    return;
  }

  // ── Úprava cen a popisků podle typu poukazu ──
  var finalPriceText = info.price;
  var finalPaymentText = info.platba;

  if (isGiftVoucher) {
    finalPriceText = '0 Kč (Uhrazeno dárkovým poukazem)';
    finalPaymentText = 'Dárkový poukaz (100% uhrazeno)';
  } else if (validPromo) {
    var rawNum = parseInt(info.price.replace(/[^\d]/g, ''), 10) || 0;
    if (validPromo.type === 'percent') {
      var disc = Math.round(rawNum * (1 - validPromo.value / 100));
      finalPriceText = disc.toLocaleString('cs-CZ') + ' Kč (' + validPromo.value + ' % sleva)';
    } else if (validPromo.type === 'fixed') {
      var disc = Math.max(0, rawNum - Number(validPromo.value));
      finalPriceText = disc.toLocaleString('cs-CZ') + ' Kč (-' + validPromo.value + ' Kč)';
    }
  }

  var nameEl   = document.getElementById('orderServiceName');
  var platbaEl = document.getElementById('orderPlatba');
  var priceEl  = document.getElementById('orderPrice');

  if (nameEl)   nameEl.textContent   = svc.label;
  if (platbaEl) platbaEl.textContent = finalPaymentText;
  if (priceEl)  priceEl.textContent  = finalPriceText;

  var hSluzba = document.getElementById('hiddenSluzba');
  var hPlatba = document.getElementById('hiddenPlatba');
  var hPrice  = document.getElementById('hiddenPrice');
  var hSubj   = document.getElementById('emailSubject');

  if (hSluzba) hSluzba.value = svc.label;
  if (hPlatba) hPlatba.value = finalPaymentText;
  if (hPrice)  hPrice.value  = finalPriceText;
  if (hSubj)   hSubj.value   = 'Nová objednávka – ' + svc.label;

  var form      = document.getElementById('orderForm');
  var submitBtn = document.getElementById('submitBtn');
  var errorEl   = document.getElementById('formError');

  if (!form) return;

  // Úprava textu na tlačítku pro obdarované
  if (isGiftVoucher && submitBtn) {
    submitBtn.textContent = 'AKTIVOVAT POUKAZ A ODESLAT DIAGNOSTIKU';
  }

  // Zajištění předání uplatněného kódu ve formuláři
  var promoInput = form.querySelector('input[name="Pouzity_kod"]') || document.getElementById('hiddenPromoCode');
  if (!promoInput && kodParam) {
    promoInput = document.createElement('input');
    promoInput.type = 'hidden';
    promoInput.name = 'Pouzity_kod';
    form.appendChild(promoInput);
  }
  if (promoInput && kodParam) {
    promoInput.value = kodParam;
  }

  form.addEventListener('submit', async function (e) {
    e.preventDefault();

    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Odesílám...';
    if (errorEl) errorEl.hidden = true;

    try {
      var formData = new FormData(form);
      var payload  = {};
      formData.forEach(function (val, key) { payload[key] = val; });

      // Garance předání kódu v payloadu
      if (kodParam && !payload.Pouzity_kod) {
        payload.Pouzity_kod = kodParam;
      }

      var response = await fetch('/api/objednavka', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload)
      });

      var result = await response.json();
      if (response.ok && result.ok) {
        // ── Záznam o uplatnění kódu v KV ──
        var codeToRedeem = payload.Pouzity_kod || kodParam;
        if (codeToRedeem) {
          try {
            await fetch('/api/codes', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'redeem', code: codeToRedeem })
            });
          } catch (e) {
            console.warn('Počítadlo kódu nebylo možné aktualizovat:', e);
          }
        }

        var name  = form.querySelector('[name="Jmeno"]').value;
        var email = form.querySelector('[name="Email"]').value;
        var dest  = 'dekujeme.html?sluzba=' + encodeURIComponent(svc.label)
                  + '&jmeno=' + encodeURIComponent(name)
                  + '&email=' + encodeURIComponent(email);
        window.location.href = dest;
      } else {
        throw new Error(result.error || 'Server error');
      }
    } catch (err) {
      submitBtn.disabled = false;
      submitBtn.textContent = isGiftVoucher ? 'AKTIVOVAT POUKAZ A ODESLAT DIAGNOSTIKU' : 'ZÁVAZNĚ ODESLAT ŽÁDOST O SLUŽBU';
      if (errorEl) { 
        errorEl.hidden = false; 
        errorEl.textContent = err.message || 'Chyba odesílání'; 
      }
    }
  });
}

(function () {
  fetch('/api/status', { cache: 'no-store' })
    .then(function (r) { return r.json(); })
    .then(function (status) { initOrder(buildServiceMap(status.prices, status.event), status); })
    .catch(function () { initOrder(buildServiceMap(null, null), null); });
})();

// ── Modals ────────────────────────────────────────
(function () {
  document.querySelectorAll('[data-modal]').forEach(function (link) {
    link.addEventListener('click', function (e) {
      e.preventDefault();
      var modal = document.getElementById(link.dataset.modal);
      if (modal) modal.hidden = false;
    });
  });

  document.querySelectorAll('.modal-overlay').forEach(function (overlay) {
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) overlay.hidden = true;
    });
    overlay.querySelector('.modal__close').addEventListener('click', function () {
      overlay.hidden = true;
    });
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal-overlay').forEach(function (o) { o.hidden = true; });
    }
  });
})();
