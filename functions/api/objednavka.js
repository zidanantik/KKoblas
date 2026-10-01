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

function initOrder(serviceMap) {
  var params  = new URLSearchParams(location.search);
  var sluzba  = params.get('sluzba') || 'startup';
  var platba  = params.get('platba') || 'jednorizove';

  var svc  = serviceMap[sluzba] || serviceMap.startup;
  var info = svc[platba] || svc.jednorizove;

  var nameEl   = document.getElementById('orderServiceName');
  var platbaEl = document.getElementById('orderPlatba');
  var priceEl  = document.getElementById('orderPrice');

  if (nameEl)   nameEl.textContent   = svc.label;
  if (platbaEl) platbaEl.textContent = info.platba;
  if (priceEl)  priceEl.textContent  = info.price;

  var hSluzba = document.getElementById('hiddenSluzba');
  var hPlatba = document.getElementById('hiddenPlatba');
  var hPrice  = document.getElementById('hiddenPrice');
  var hSubj   = document.getElementById('emailSubject');

  if (hSluzba) hSluzba.value = svc.label;
  if (hPlatba) hPlatba.value = info.platba;
  if (hPrice)  hPrice.value  = info.price;
  if (hSubj)   hSubj.value   = 'Nová objednávka – ' + svc.label;

  var form      = document.getElementById('orderForm');
  var submitBtn = document.getElementById('submitBtn');
  var errorEl   = document.getElementById('formError');

  if (!form) return;

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

      var response = await fetch('/api/objednavka', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload)
      });

      var result = await response.json();
      if (response.ok && result.ok) {
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
      submitBtn.textContent = 'ZÁVAZNĚ ODESLAT ŽÁDOST O SLUŽBU';
      if (errorEl) { errorEl.hidden = false; errorEl.textContent = err.message || 'Chyba odesílání'; }
    }
  });
}

(function () {
  fetch('/api/status', { cache: 'no-store' })
    .then(function (r) { return r.json(); })
    .then(function (status) { initOrder(buildServiceMap(status.prices, status.event)); })
    .catch(function () { initOrder(buildServiceMap(null, null)); });
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
