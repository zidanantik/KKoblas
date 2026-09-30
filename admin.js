var SESSION_KEY  = 'kkoblas_admin_session';
var ENTERED_PASS = '';
var SERVICES     = ['startup', 'mentoring', 'ultimate'];

var lockScreen = document.getElementById('lockScreen');
var consolEl   = document.getElementById('consolEl');
var lockForm   = document.getElementById('lockForm');
var lockInput  = document.getElementById('lockInput');
var lockError  = document.getElementById('lockError');
var deployBar  = document.getElementById('deployBar');
var deployMsg  = document.getElementById('deployMsg');

var currentStatus = {
  startup: 'volny', mentoring: 'volny', ultimate: 'volny',
  event: { active: false, name: '', popis: '', odkaz: '' },
  prices: {
    startup:   { jednorizove: '6 900 Kč' },
    mentoring: { jednorizove: '14 700 Kč', splatky: '7 500 Kč (1. splátka)' },
    ultimate:  { jednorizove: '22 300 Kč', splatky: '11 900 Kč (1. splátka)' }
  }
};

// ── Auth ─────────────────────────────────────────
function unlock() {
  lockScreen.style.display = 'none';
  consolEl.hidden = false;
  sessionStorage.setItem(SESSION_KEY, '1');
  ENTERED_PASS = sessionStorage.getItem(SESSION_KEY + '_pass') || ENTERED_PASS;
  loadStatus();
  loadAnalytics();
  loadPromoCodes();
}

if (sessionStorage.getItem(SESSION_KEY) === '1') {
  ENTERED_PASS = sessionStorage.getItem(SESSION_KEY + '_pass') || '';
  unlock();
}

lockForm.addEventListener('submit', async function (e) {
  e.preventDefault();
  var typed = lockInput.value;
  try {
    var getRes  = await fetch('/api/status');
    var current = await getRes.json();
    var postRes = await fetch('/api/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ password: typed }, current))
    });
    var data = await postRes.json();
    if (postRes.ok && data.ok) {
      ENTERED_PASS = typed;
      sessionStorage.setItem(SESSION_KEY + '_pass', typed);
      currentStatus = data.status;
      unlock();
    } else {
      lockInput.value = '';
      lockError.hidden = false;
      lockError.style.animation = 'none';
      void lockError.offsetWidth;
      lockError.style.animation = 'shake .3s ease';
    }
  } catch {
    lockInput.value = '';
    lockError.hidden = false;
  }
});

// ── API ───────────────────────────────────────────
async function loadStatus() {
  setDeploy('Načítám stav...', 'loading');
  try {
    var res  = await fetch('/api/status');
    var data = await res.json();
    currentStatus = data;
    renderAll();
    deployBar.hidden = true;
  } catch {
    setDeploy('Chyba načítání — funguje jen na živém webu', 'error');
    renderAll();
  }
}

async function saveStatus() {
  var pass = ENTERED_PASS || sessionStorage.getItem(SESSION_KEY + '_pass') || '';
  setDeploy('⚡ Ukládám...', 'loading');
  try {
    var res = await fetch('/api/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ password: pass }, currentStatus))
    });
    if (!res.ok) throw new Error(res.status);
    setDeploy('✓ Uloženo — změna je okamžitě živá', 'ok');
    setTimeout(function () { deployBar.hidden = true; }, 4000);
  } catch (e) {
    setDeploy('✗ Chyba: ' + e.message, 'error');
  }
}

// ── Deploy bar ────────────────────────────────────
function setDeploy(msg, state) {
  deployBar.hidden = false;
  deployMsg.textContent = msg;
  deployBar.className = 'deploy-bar deploy-bar--' + state;
}

// ── Render ───────────────────────────────────────
function renderStation(sluzba) {
  var isOpen    = (currentStatus[sluzba] || 'volny') === 'volny';
  var station   = document.getElementById('station-' + sluzba);
  var statusTxt = document.getElementById('statusText-' + sluzba);
  var btnLabel  = document.getElementById('btnLabel-' + sluzba);
  if (!station) return;
  station.classList.toggle('volny',    isOpen);
  station.classList.toggle('uzavreny', !isOpen);
  if (statusTxt) statusTxt.textContent = isOpen ? 'VOLNÝ' : 'UZAVŘENÝ';
  if (btnLabel)  btnLabel.textContent  = isOpen ? 'UZAVŘÍT' : 'OTEVŘÍT';
}

function renderAll() {
  SERVICES.forEach(renderStation);
  renderEvent();
  renderPrices();
}

function renderPrices() {
  var p  = currentStatus.prices || {};
  var su = p.startup   || {};
  var me = p.mentoring || {};
  var ul = p.ultimate  || {};
  var el;
  el = document.getElementById('priceStartupJed');   if (el) el.value = su.jednorizove || '6 900 Kč';
  el = document.getElementById('priceMentoringJed'); if (el) el.value = me.jednorizove || '14 700 Kč';
  el = document.getElementById('priceMentoringSpl'); if (el) el.value = me.splatky     || '7 500 Kč (1. splátka)';
  el = document.getElementById('priceMentoringNote');if (el) el.value = me.splatkyNote || '';
  el = document.getElementById('priceUltimateJed');  if (el) el.value = ul.jednorizove || '22 300 Kč';
  el = document.getElementById('priceUltimateSpl');  if (el) el.value = ul.splatky     || '11 900 Kč (1. splátka)';
  el = document.getElementById('priceUltimateNote'); if (el) el.value = ul.splatkyNote || '';
}

function renderEvent() {
  var ev      = currentStatus.event || {};
  var isActive = ev.active === true;
  var led     = document.getElementById('led-event');
  var txt     = document.getElementById('statusText-event');
  var lbl     = document.getElementById('btnLabel-event');
  var panel   = document.getElementById('eventPanel');
  if (led)    led.className   = 'status-led ' + (isActive ? 'volny' : '');
  if (txt)    txt.textContent = isActive ? 'AKTIVNÍ' : 'NEAKTIVNÍ';
  if (lbl)    lbl.textContent = isActive ? 'DEAKTIVOVAT' : 'AKTIVOVAT';
  if (panel) panel.classList.toggle('event-panel--active', isActive);
  var nameEl  = document.getElementById('eventName');
  var opisEl  = document.getElementById('eventPopis');
  var cenaEl  = document.getElementById('eventCena');
  var odkazEl = document.getElementById('eventOdkaz');
  if (nameEl)  nameEl.value  = ev.name  || '';
  if (opisEl)  opisEl.value  = ev.popis || '';
  if (cenaEl)  cenaEl.value  = ev.cena  || '';
  if (odkazEl) odkazEl.value = ev.odkaz || '';
}

// ── Toggle ───────────────────────────────────────
async function toggle(sluzba) {
  var prev   = currentStatus[sluzba] || 'volny';
  var next   = prev === 'volny' ? 'uzavreny' : 'volny';
  var action = next === 'uzavreny' ? 'UZAVŘÍT' : 'OTEVŘÍT';
  if (!confirm(action + ' službu ' + sluzba.toUpperCase() + '?')) return;
  currentStatus[sluzba] = next;
  renderStation(sluzba);
  await saveStatus();
}

SERVICES.forEach(function (sluzba) {
  var btn = document.getElementById('btn-' + sluzba);
  if (btn) btn.addEventListener('click', function () { toggle(sluzba); });
});

// ── Master controls ──────────────────────────────
async function setAll(val) {
  var action = val === 'uzavreny' ? 'Uzavřít VŠECHNY?' : 'Otevřít VŠECHNY?';
  if (!confirm(action)) return;
  SERVICES.forEach(function (s) { currentStatus[s] = val; });
  renderAll();
  await saveStatus();
}

document.getElementById('masterClose').addEventListener('click', function () { setAll('uzavreny'); });
document.getElementById('masterOpen').addEventListener('click',  function () { setAll('volny'); });

// ── Event toggle ─────────────────────────────────
document.getElementById('btn-event').addEventListener('click', async function () {
  var ev = currentStatus.event || {};
  currentStatus.event = Object.assign({}, ev, { active: !ev.active });
  renderEvent();
  await saveStatus();
});

// ── Analytics ────────────────────────────────────
async function loadAnalytics() {
  var body = document.getElementById('anBody');
  if (!body) return;
  body.innerHTML = '<span class="an-loading">Načítám...</span>';
  var btn = document.getElementById('anRefresh');
  if (btn) { btn.disabled = true; btn.textContent = '↻ ...'; }
  try {
    var r = await fetch('/api/analytics?t=' + Date.now(), { cache: 'no-store' });
    var d = await r.json();
    if (!d.ok) {
      body.innerHTML = '<div class="an-err-box">'
        + '<span class="an-err-icon">⚠</span>'
        + '<span class="an-err-msg">' + (d.error || 'Neznámá chyba') + '</span>'
        + '</div>';
      return;
    }
    body.innerHTML = buildAnHTML(d);
    if (d.warning) {
      body.innerHTML += '<div class="an-warn-box">'
        + '<span class="an-err-icon">ℹ</span>'
        + '<span class="an-err-msg">' + d.warning + '</span>'
        + '</div>';
    }
  } catch (e) {
    body.innerHTML = '<div class="an-err-box">'
      + '<span class="an-err-icon">⚠</span>'
      + '<span class="an-err-msg">Chyba: ' + e.message + ' — analytics funguje jen na živém webu (Cloudflare Pages)</span>'
      + '</div>';
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '↻ OBNOVIT'; }
  }
}

document.getElementById('anRefresh').addEventListener('click', loadAnalytics);

function buildAnHTML(d) {
  function bars(data, lblFn) {
    var max = 1;
    for (var i = 0; i < data.length; i++) if (data[i].count > max) max = data[i].count;
    return data.map(function(x) {
      var h = Math.max(2, Math.round(x.count / max * 100));
      return '<div class="an-bar"><div class="an-bar__fill" style="height:' + h + '%"></div>'
           + '<span class="an-bar__lbl">' + lblFn(x) + '</span></div>';
    }).join('');
  }

  var pageNames = {'/':'Úvod','/sluzby.html':'Služby','/omne.html':'O mně',
    '/jakpracuji.html':'Jak pracuji','/faq.html':'FAQ','/kontakt.html':'Kontakt',
    '/objednavka.html':'Objednávka','/dekujeme.html':'Děkujeme'};
  var deviceNames = {'Desktop':'Desktop','Mobile':'Mobil','Tablet':'Tablet','Bot':'Bot'};

  var pagesHTML = (d.topPages || []).map(function(p) {
    return '<li class="an-page-row"><span class="an-page-name">' + (pageNames[p.path] || p.path) + '</span>'
         + '<span class="an-page-count">' + p.count + '</span></li>';
  }).join('') || '<li class="an-page-row"><span style="color:var(--sub);font-size:.7rem">žádná data</span></li>';

  var devicesHTML = (d.devices || []).map(function(x) {
    return '<li class="an-dev-row"><span class="an-dev-name">' + (deviceNames[x.type] || x.type) + '</span>'
         + '<span class="an-dev-bar"><span class="an-dev-fill" style="width:' + x.pct + '%"></span></span>'
         + '<span class="an-dev-pct">' + x.pct + '%</span></li>';
  }).join('') || '<li class="an-dev-row"><span style="color:var(--sub);font-size:.7rem">žádná data</span></li>';

  return '<div class="an-charts">'
    + '<div class="an-chart">'
    +   '<div class="an-chart__title">DNES &mdash; <b>' + (d.todayPv || 0) + '</b> zobrazení</div>'
    +   '<div class="an-bars">' + bars(d.hours || [], function(x) { return x.hour % 6 === 0 ? x.hour + 'h' : ''; }) + '</div>'
    + '</div>'
    + '<div class="an-chart">'
    +   '<div class="an-chart__title">7 DNÍ &mdash; <b>' + (d.pageviews || 0) + '</b> zobrazení</div>'
    +   '<div class="an-bars">' + bars(d.days || [], function(x) { return x.date.slice(5).replace('-', '/'); }) + '</div>'
    + '</div>'
    + '</div>'
    + '<div class="an-details">'
    +   '<div class="an-block"><div class="an-block__title">TOP STRÁNKY</div><ul class="an-pages">' + pagesHTML + '</ul></div>'
    +   '<div class="an-block"><div class="an-block__title">ZAŘÍZENÍ</div><ul class="an-devs">' + devicesHTML + '</ul></div>'
    + '</div>';
}

// ── Price save ───────────────────────────────────
document.getElementById('priceSave').addEventListener('click', async function () {
  currentStatus.prices = {
    startup:  { jednorizove: document.getElementById('priceStartupJed').value.trim()  || '6 900 Kč' },
    mentoring: {
      jednorizove: document.getElementById('priceMentoringJed').value.trim()  || '14 700 Kč',
      splatky:     document.getElementById('priceMentoringSpl').value.trim()  || '7 500 Kč (1. splátka)',
      splatkyNote: document.getElementById('priceMentoringNote').value.trim() || ''
    },
    ultimate: {
      jednorizove: document.getElementById('priceUltimateJed').value.trim()  || '22 300 Kč',
      splatky:     document.getElementById('priceUltimateSpl').value.trim()  || '11 900 Kč (1. splátka)',
      splatkyNote: document.getElementById('priceUltimateNote').value.trim() || ''
    }
  };
  await saveStatus();
});

// ── Event save ───────────────────────────────────
document.getElementById('eventSave').addEventListener('click', async function () {
  currentStatus.event = {
    active: (currentStatus.event || {}).active === true,
    name:   document.getElementById('eventName').value.trim(),
    popis:  document.getElementById('eventPopis').value.trim(),
    cena:   document.getElementById('eventCena').value.trim(),
    odkaz:  document.getElementById('eventOdkaz').value.trim()
  };
  await saveStatus();
});

// ── Slevové a dárkové kódy ───────────────────────
function handlePromoTypeChange() {
  var type = document.getElementById('newPromoType').value;
  var wrapper = document.getElementById('promoValueWrapper');
  if (wrapper) wrapper.style.display = type === 'gift' ? 'none' : 'block';
}

function generateRandomCode() {
  var type = document.getElementById('newPromoType').value;
  var prefix = type === 'gift' ? 'DAR-' : 'KK-';
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var res = '';
  for (var i = 0; i < 6; i++) {
    res += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  var input = document.getElementById('newPromoCode');
  if (input) input.value = prefix + res;
}

function getAdminAuthPass() {
  return ENTERED_PASS || sessionStorage.getItem(SESSION_KEY + '_pass') || '';
}

async function loadPromoCodes() {
  var tbody = document.getElementById('promoCodesTableBody');
  if (!tbody) return;

  var pass = getAdminAuthPass();
  if (!pass) {
    tbody.innerHTML = '<tr><td colspan="6" style="padding: 15px; text-align: center; color: #ff9900;">Pro zobrazení kódů zadejte heslo v přihlašovacím okně (případně obnovte stránku s odhlášením).</td></tr>';
    return;
  }

  tbody.innerHTML = '<tr><td colspan="6" style="padding: 15px; text-align: center; color: #888;">Načítám kódy z Cloudflare KV...</td></tr>';

  try {
    var res = await fetch('/api/codes', {
      headers: { 'x-admin-pass': pass }
    });
    if (!res.ok) throw new Error('Chyba autorizace (' + res.status + ')');
    var codes = await res.json();
    renderPromoCodesList(codes);
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="6" style="padding: 15px; text-align: center; color: #ff5555;">Chyba při načítání kódů: ' + err.message + '</td></tr>';
  }
}

function renderPromoCodesList(codes) {
  var tbody = document.getElementById('promoCodesTableBody');
  if (!codes || codes.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="padding: 15px; text-align: center; color: #777;">Zatím nejsou vytvořeny žádné slevové ani dárkové kódy.</td></tr>';
    return;
  }

  tbody.innerHTML = codes.map(function(c) {
    var typeLabel = '';
    if (c.type === 'percent') typeLabel = c.value + ' %';
    else if (c.type === 'fixed') typeLabel = c.value + ' Kč';
    else if (c.type === 'gift') typeLabel = '<span style="color: #ff9900; font-weight: bold;">DÁRKOVÝ (100 %)</span>';

    var pkgs = (c.packages || []).map(function(p) { return p.toUpperCase(); }).join(', ') || 'VŠECHNY';

    var usage = '';
    if (c.oneTime) {
      usage = c.used 
        ? '<span style="color: #e74c3c;">Uplatněn</span>' 
        : '<span style="color: #2ecc71;">Jednorázový</span>';
    } else {
      usage = '<span style="color: #3498db;">Neomezený</span>';
    }

    var toggleBtn = c.active 
      ? '<button onclick="togglePromoCodeActive(\'' + c.id + '\', false)" style="background: transparent; border: 1px solid #444; color: #bbb; padding: 4px 8px; border-radius: 3px; cursor: pointer; font-family: monospace; font-size: 11px;">Vypnout</button>'
      : '<button onclick="togglePromoCodeActive(\'' + c.id + '\', true)" style="background: rgba(46,204,113,0.15); border: 1px solid #2ecc71; color: #2ecc71; padding: 4px 8px; border-radius: 3px; cursor: pointer; font-family: monospace; font-size: 11px;">Aktivovat</button>';

    return '<tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">'
      + '<td style="padding: 10px; font-weight: bold; color: #ff9900;">' + c.code + '</td>'
      + '<td style="padding: 10px;">' + typeLabel + '</td>'
      + '<td style="padding: 10px; color: #aaa;">' + pkgs + '</td>'
      + '<td style="padding: 10px;">' + usage + '</td>'
      + '<td style="padding: 10px;">' + (c.active ? '<span style="color: #2ecc71;">● Aktivní</span>' : '<span style="color: #666;">○ Vypnut</span>') + '</td>'
      + '<td style="padding: 10px; text-align: right; display: flex; gap: 6px; justify-content: flex-end;">'
      + toggleBtn
      + '<button onclick="deletePromoCode(\'' + c.id + '\')" style="background: rgba(231,76,60,0.15); border: 1px solid #e74c3c; color: #e74c3c; padding: 4px 8px; border-radius: 3px; cursor: pointer; font-family: monospace; font-size: 11px;">Smazat</button>'
      + '</td>'
      + '</tr>';
  }).join('');
}

async function createNewPromoCode() {
  var code = document.getElementById('newPromoCode').value.trim();
  var type = document.getElementById('newPromoType').value;
  var value = document.getElementById('newPromoValue').value;
  var oneTime = document.getElementById('newPromoOneTime').checked;

  var pkgCheckboxes = document.querySelectorAll('.promo-pkg-cb:checked');
  var packages = Array.from(pkgCheckboxes).map(function(cb) { return cb.value; });

  if (!code) {
    alert('Zadej text kódu nebo klikni na NÁHODNÝ.');
    return;
  }
  if (type !== 'gift' && (!value || Number(value) <= 0)) {
    alert('Zadej platnou číselnou hodnotu slevy.');
    return;
  }

  var payload = { code: code, type: type, value: value, oneTime: oneTime, packages: packages };

  try {
    var res = await fetch('/api/codes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-pass': getAdminAuthPass()
      },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error('Chyba při ukládání kódu.');

    document.getElementById('newPromoCode').value = '';
    document.getElementById('newPromoValue').value = '';
    loadPromoCodes();
  } catch (err) {
    alert(err.message);
  }
}

async function togglePromoCodeActive(id, activeState) {
  try {
    await fetch('/api/codes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-pass': getAdminAuthPass()
      },
      body: JSON.stringify({ id: id, active: activeState })
    });
    loadPromoCodes();
  } catch (err) {
    alert('Chyba při změně stavu: ' + err.message);
  }
}

async function deletePromoCode(id) {
  if (!confirm('Opravdu trvale smazat tento kód?')) return;
  try {
    await fetch('/api/codes', {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-pass': getAdminAuthPass()
      },
      body: JSON.stringify({ id: id })
    });
    loadPromoCodes();
  } catch (err) {
    alert('Chyba při mazání: ' + err.message);
  }
}
