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
  capacity: { mode: 'total', totalLimit: 10, limits: { startup: 0, mentoring: 0, ultimate: 0 } },
  event: { active: false, name: '', popis: '', cena: '', odkaz: '' },
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
  loadClients();
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
    updateCapacityDisplay(data);
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
  var su = p.startup    || {};
  var me = p.mentoring || {};
  var ul = p.ultimate  || {};
  var el;
  el = document.getElementById('priceStartupJed');   if (el) el.value = su.jednorizove || '6 900 Kč';
  el = document.getElementById('priceMentoringJed'); if (el) el.value = me.jednorizove || '14 700 Kč';
  el = document.getElementById('priceMentoringSpl'); if (el) el.value = me.splatky     || '7 500 Kč (1. splátka)';
  el = document.getElementById('priceUltimateJed');  if (el) el.value = ul.jednorizove || '22 300 Kč';
  el = document.getElementById('priceUltimateSpl');  if (el) el.value = ul.splatky     || '11 900 Kč (1. splátka)';
}

function renderEvent() {
  var ev       = currentStatus.event || {};
  var isActive = ev.active === true;
  var led      = document.getElementById('led-event');
  var txt      = document.getElementById('statusText-event');
  var lbl      = document.getElementById('btnLabel-event');
  var panel    = document.getElementById('eventPanel');
  if (led)   led.className   = 'status-led ' + (isActive ? 'volny' : '');
  if (txt)   txt.textContent = isActive ? 'AKTIVNÍ' : 'NEAKTIVNÍ';
  if (lbl)   lbl.textContent = isActive ? 'DEAKTIVOVAT' : 'AKTIVOVAT';
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

// ── Toggle služeb ────────────────────────────────
async function toggle(sluzba) {
  var prev = currentStatus[sluzba] || 'volny';
  var next = prev === 'volny' ? 'uzavreny' : 'volny';
  var action = next === 'uzavreny' ? 'UZAVŘÍT' : 'OTEVŘÍT';
  if (!confirm(action + ' službu ' + sluzba.toUpperCase() + '?')) return;

  var pass = ENTERED_PASS || sessionStorage.getItem(SESSION_KEY + '_pass') || '';
  var payload = Object.assign({ password: pass }, currentStatus);
  payload[sluzba] = next;
  payload.singleToggle = sluzba;

  setDeploy('⚡ Ukládám...', 'loading');
  try {
    var res = await fetch('/api/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    var data = await res.json();
    if (!res.ok) throw new Error(res.status);

    currentStatus = data.status;
    renderAll();
    updateCapacityDisplay(data.status);
    setDeploy('✓ Uloženo', 'ok');
    setTimeout(function () { deployBar.hidden = true; }, 3000);
  } catch (e) {
    setDeploy('✗ Chyba: ' + e.message, 'error');
  }
}

SERVICES.forEach(function (sluzba) {
  var btn = document.getElementById('btn-' + sluzba);
  if (btn) btn.addEventListener('click', function () { toggle(sluzba); });
});

// ── Master controls ──────────────────────────────
async function setAll(val) {
  var action = val === 'uzavreny' ? 'Uzavřít VŠECHNY?' : 'Otevřít VŠECHNY?';
  if (!confirm(action)) return;

  var isClosed = val === 'uzavreny';
  var pass = ENTERED_PASS || sessionStorage.getItem(SESSION_KEY + '_pass') || '';
  var payload = Object.assign({ password: pass }, currentStatus);
  payload.manualOverride = {
    startup: isClosed,
    mentoring: isClosed,
    ultimate: isClosed
  };
  SERVICES.forEach(function (s) { payload[s] = val; });

  setDeploy('⚡ Ukládám...', 'loading');
  try {
    var res = await fetch('/api/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    var data = await res.json();
    if (!res.ok) throw new Error(res.status);

    currentStatus = data.status;
    renderAll();
    updateCapacityDisplay(data.status);
    setDeploy('✓ Vše uloženo', 'ok');
    setTimeout(function () { deployBar.hidden = true; }, 3000);
  } catch (e) {
    setDeploy('✗ Chyba: ' + e.message, 'error');
  }
}

document.getElementById('masterClose').addEventListener('click', function () { setAll('uzavreny'); });
document.getElementById('masterOpen').addEventListener('click',  function () { setAll('volny'); });

// ── Event toggle & save ──────────────────────────
document.getElementById('btn-event').addEventListener('click', async function () {
  var ev = currentStatus.event || {};
  currentStatus.event = Object.assign({}, ev, { active: !ev.active });
  renderEvent();
  await saveStatus();
});

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

// ── Price save ───────────────────────────────────
document.getElementById('priceSave').addEventListener('click', async function () {
  currentStatus.prices = {
    startup:  { jednorizove: document.getElementById('priceStartupJed').value.trim()  || '6 900 Kč' },
    mentoring: {
      jednorizove: document.getElementById('priceMentoringJed').value.trim()  || '14 700 Kč',
      splatky:     document.getElementById('priceMentoringSpl').value.trim()  || '7 500 Kč (1. splátka)'
    },
    ultimate: {
      jednorizove: document.getElementById('priceUltimateJed').value.trim()  || '22 300 Kč',
      splatky:     document.getElementById('priceUltimateSpl').value.trim()  || '11 900 Kč (1. splátka)'
    }
  };
  await saveStatus();
});

// ── Správa kapacity ──────────────────────────────
function handleCapacityModeChange() {
  var mode = document.getElementById('capacityMode').value;
  var wrap = document.getElementById('capTotalWrapper');
  if (wrap) wrap.style.display = mode === 'total' ? 'flex' : 'none';
}

async function saveCapacitySettings() {
  var mode = document.getElementById('capacityMode').value;
  var limit = parseInt(document.getElementById('capTotalLimit').value, 10) || 10;

  if (!currentStatus.capacity) currentStatus.capacity = {};
  currentStatus.capacity.mode = mode;
  currentStatus.capacity.totalLimit = limit;

  var pass = ENTERED_PASS || sessionStorage.getItem(SESSION_KEY + '_pass') || '';
  setDeploy('⚡ Ukládám kapacitu...', 'loading');

  try {
    var payload = {
      password: pass,
      capacity: currentStatus.capacity,
      event: currentStatus.event,
      prices: currentStatus.prices,
      resetOverride: true
    };

    var res = await fetch('/api/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    var data = await res.json();
    if (!res.ok) throw new Error(res.status);

    currentStatus = data.status;
    renderAll();
    updateCapacityDisplay(data.status);

    setDeploy('✓ Kapacita uložena — balíčky se automaticky přizpůsobily', 'ok');
    setTimeout(function () { deployBar.hidden = true; }, 3000);
  } catch (e) {
    setDeploy('✗ Chyba: ' + e.message, 'error');
  }
}

function updateCapacityDisplay(data) {
  var cap = data.capacity || { mode: 'total', totalLimit: 10 };
  var counts = data.counts || { startup: 0, mentoring: 0, ultimate: 0, total: 0 };

  var modeSelect = document.getElementById('capacityMode');
  if (modeSelect) modeSelect.value = cap.mode || 'total';

  var limitInput = document.getElementById('capTotalLimit');
  if (limitInput) limitInput.value = cap.totalLimit || 10;

  handleCapacityModeChange();

  var countStartup = document.getElementById('count-startup');
  if (countStartup) countStartup.textContent = counts.startup;

  var countMentoring = document.getElementById('count-mentoring');
  if (countMentoring) countMentoring.textContent = counts.mentoring;

  var countUltimate = document.getElementById('count-ultimate');
  if (countUltimate) countUltimate.textContent = counts.ultimate;

  var badge = document.getElementById('capacityBadge');
  var display = document.getElementById('capCountDisplay');
  if (display) {
    if (cap.mode === 'total') {
      display.textContent = counts.total + ' / ' + cap.totalLimit;
      var isFull = counts.total >= cap.totalLimit;
      if (badge) {
        badge.style.background = isFull ? 'rgba(255,34,34,0.15)' : 'rgba(0,255,100,0.1)';
        badge.style.borderColor = isFull ? '#ff2222' : '#00ff66';
        badge.style.color = isFull ? '#ff2222' : '#00ff66';
      }
    } else {
      display.textContent = counts.total + ' (celkem)';
    }
  }
}

// ── Tabulka klientů ───────────────────────────────
var loadedClientsCache = [];

async function loadClients() {
  var tbody = document.getElementById('clientsTableBody');
  if (!tbody) return;

  var pass = getAdminAuthPass();
  if (!pass) return;

  tbody.innerHTML = '<tr><td colspan="6" style="padding: 15px; text-align: center; color: #888;">Načítám klienty...</td></tr>';

  try {
    var res = await fetch('/api/clients', {
      headers: { 'x-admin-pass': pass }
    });
    if (!res.ok) throw new Error('Chyba autorizace');
    var clients = await res.json();
    loadedClientsCache = clients || [];
    renderClientsTable();
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="6" style="padding: 15px; text-align: center; color: #ff5555;">Chyba při načítání: ' + err.message + '</td></tr>';
  }
}

function filterClientsTable() {
  renderClientsTable();
}

function renderClientsTable() {
  var tbody = document.getElementById('clientsTableBody');
  if (!tbody) return;

  var filter = document.getElementById('clientFilter') ? document.getElementById('clientFilter').value : 'active';
  var todayStr = new Date().toISOString().split('T')[0];

  var redeemedCodes = new Set();
  loadedClientsCache.forEach(function(c) {
    if (c.pouzity_kod) {
      redeemedCodes.add(String(c.pouzity_kod).trim().toUpperCase());
    }
  });

  var filtered = loadedClientsCache.filter(function(c) {
    if (filter === 'all') return true;

    var isGiftAlreadyRedeemed = c.is_gift && c.kod_voucheru && redeemedCodes.has(String(c.kod_voucheru).trim().toUpperCase());

    var isActive = c.status === 'aktivni' && (!c.end_date || c.end_date >= todayStr) && !isGiftAlreadyRedeemed;
    var isWaiting = c.status === 'ceka_na_platbu';
    var isEnded = c.status === 'ukonceno' || (c.end_date && c.end_date < todayStr) || isGiftAlreadyRedeemed;

    if (filter === 'active') return isActive || isWaiting;
    if (filter === 'only_active') return isActive;
    if (filter === 'waiting') return isWaiting;
    if (filter === 'ended') return isEnded;
    return true;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="padding: 15px; text-align: center; color: #666;">Žádní klienti pro vybraný filtr.</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map(function(c) {
    var kup = c.kupujici || {};
    var platce = c.platce || kup;
    var isGiftRedeemed = c.is_gift_redemption === true;
    var isGiftDonorAlreadyClaimed = c.is_gift && c.kod_voucheru && redeemedCodes.has(String(c.kod_voucheru).trim().toUpperCase());

    var cleanPhone = (kup.telefon || '').replace(/[^\d+]/g, '');
    var waUrl = cleanPhone.startsWith('+') ? 'https://wa.me/' + cleanPhone.replace('+', '') : 'https://wa.me/420' + cleanPhone;

    var clientHtml = '';

    if (isGiftDonorAlreadyClaimed) {
      clientHtml = '<div style="font-weight: bold; color: #888;">DÁRKOVÝ POUKAZ (Uplatněn obdarovaným)</div>'
        + '<div style="font-size: 11px; color: #666;">Koupil: ' + (kup.jmeno || '') + ' (' + (kup.email || '') + ')</div>'
        + '<div style="font-size: 10px; color: #555;">Kód: ' + (c.kod_voucheru || '—') + '</div>';
    } else if (c.is_gift && !isGiftRedeemed) {
      clientHtml = '<div style="font-weight: bold; color: #ff9900;">DÁRKOVÝ POUKAZ (Čeká na obdarovaného)</div>'
        + '<div style="font-size: 11px; color: #aaa;">Koupil: ' + (kup.jmeno || '') + ' (' + (kup.email || '') + ')</div>'
        + '<div style="font-size: 10px; color: #777;">Kód: ' + (c.kod_voucheru || '—') + '</div>';
    } else {
      clientHtml = '<div style="font-weight: bold; color: #fff; font-size: 13px;">' + (kup.jmeno || 'Neznámé jméno') + '</div>'
        + '<div style="font-size: 11px; color: #aaa; margin-top: 2px;">'
        +   '<a href="' + waUrl + '" target="_blank" style="color: #25D366; text-decoration: none; margin-right: 8px;">💬 WA: ' + (kup.telefon || '—') + '</a> '
        +   '<a href="mailto:' + (kup.email || '') + '" style="color: #66b3ff; text-decoration: none;">' + (kup.email || '—') + '</a>'
        + '</div>';

      if (isGiftRedeemed && platce && platce.jmeno !== kup.jmeno) {
        clientHtml += '<div style="font-size: 10px; color: #ff9900; margin-top: 4px; background: rgba(255,153,0,0.1); padding: 3px 6px; border-radius: 3px; display: inline-block;">'
          + '🎁 Zaplatil dárce: <strong>' + platce.jmeno + '</strong> (' + (platce.email || '') + ')'
          + '</div>';
      }
    }

    var diag = c.diagnostika || {};
    var diagText = (!isGiftDonorAlreadyClaimed && diag.vek) ? (diag.vek + ' let · ' + diag.vyska + ' cm · ' + diag.vaha + ' kg' + (diag.zprava ? ' | Cíl: ' + diag.zprava : '')) : '';

    var startDateVal = c.start_date || (c.datum_platby ? c.datum_platby.split('T')[0] : '');
    var endDateVal = c.end_date || '';

    var daysLeft = '';
    if (endDateVal && c.status === 'aktivni' && !isGiftDonorAlreadyClaimed) {
      var diffDays = Math.ceil((new Date(endDateVal) - new Date()) / (1000 * 60 * 60 * 24));
      if (diffDays > 0) daysLeft = ' <span style="color:#00ff66;font-size:10px;">(zbývá ' + diffDays + ' dní)</span>';
      else daysLeft = ' <span style="color:#ff5555;font-size:10px;">(vypršelo)</span>';
    }

    var idKey = c.id || c.fakturoid_id;

    var statusSelectHtml = '';
    if (isGiftDonorAlreadyClaimed) {
      statusSelectHtml = '<span style="color: #888; font-size: 11px;">✔ Uplatněno (Obdarovaný převzal)</span>';
    } else {
      statusSelectHtml = '<select id="status-' + idKey + '" class="event-input" style="padding: 4px 6px; font-size: 11px; margin: 0;">'
        + '<option value="aktivni"' + (c.status === 'aktivni' ? ' selected' : '') + '>● Aktivní</option>'
        + '<option value="ceka_na_platbu"' + (c.status === 'ceka_na_platbu' ? ' selected' : '') + '>○ Čeká na platbu</option>'
        + '<option value="ukonceno"' + (c.status === 'ukonceno' ? ' selected' : '') + '>× Ukončeno</option>'
        + '</select>';
    }

    var dateStartHtml = isGiftDonorAlreadyClaimed 
      ? '<span style="color:#666;font-size:11px;">—</span>'
      : '<input type="date" id="start-' + idKey + '" value="' + startDateVal + '" onchange="handleStartDateChange(\'' + idKey + '\', \'' + (c.sluzba || '') + '\')" class="event-input" style="padding: 4px 6px; font-size: 11px; margin: 0; width: 125px;">';

    var dateEndHtml = isGiftDonorAlreadyClaimed 
      ? '<span style="color:#666;font-size:11px;">—</span>'
      : '<input type="date" id="end-' + idKey + '" value="' + endDateVal + '" class="event-input" style="padding: 4px 6px; font-size: 11px; margin: 0; width: 125px;">' + daysLeft;

    var saveBtnHtml = isGiftDonorAlreadyClaimed
      ? ''
      : '<button onclick="saveClientRow(\'' + idKey + '\')" class="event-save-btn" style="margin: 0 4px; padding: 4px 10px; font-size: 11px;">💾 Uložit</button>';

    return '<tr style="border-bottom: 1px solid rgba(255,255,255,0.06);' + (isGiftDonorAlreadyClaimed ? 'opacity: 0.6;' : '') + '">'
      + '<td style="padding: 12px 10px;">' + clientHtml + (diagText ? '<div style="font-size: 10px; color: #777; margin-top: 4px;">' + diagText + '</div>' : '') + '</td>'
      + '<td style="padding: 12px 10px; color: #ff9900; font-weight: bold;">' + (c.sluzba_nazev || c.sluzba) + '<br><span style="font-size:10px;color:#888;">' + (c.is_installment ? 'Splátky (' + (c.current_installment || 1) + '/' + (c.total_installments || 1) + ')' : 'Jednorázově') + '</span></td>'
      + '<td style="padding: 12px 10px;">' + dateStartHtml + '</td>'
      + '<td style="padding: 12px 10px;">' + dateEndHtml + '</td>'
      + '<td style="padding: 12px 10px;">' + statusSelectHtml + '</td>'
      + '<td style="padding: 12px 10px; text-align: right; white-space: nowrap;">'
      +   saveBtnHtml
      +   '<button onclick="deleteClientRow(\'' + idKey + '\')" style="background: rgba(255,0,0,0.1); border: 1px solid #ff2222; color: #ff2222; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 11px;">Smazat</button>'
      + '</td>'
      + '</tr>';
  }).join('');
}

function handleStartDateChange(idKey, sluzba) {
  var startInput = document.getElementById('start-' + idKey);
  var endInput = document.getElementById('end-' + idKey);
  if (!startInput || !endInput || !startInput.value) return;

  var d = new Date(startInput.value);
  var s = String(sluzba || '').toLowerCase();
  var months = 1;
  if (s.includes('ultimate')) months = 6;
  else if (s.includes('mentor')) months = 4;

  d.setMonth(d.getMonth() + months);
  endInput.value = d.toISOString().split('T')[0];
}

async function saveClientRow(idKey) {
  var startVal = document.getElementById('start-' + idKey).value;
  var endVal = document.getElementById('end-' + idKey).value;
  var statusVal = document.getElementById('status-' + idKey).value;

  try {
    var res = await fetch('/api/clients', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-pass': getAdminAuthPass()
      },
      body: JSON.stringify({
        id: idKey,
        start_date: startVal,
        end_date: endVal,
        status: statusVal
      })
    });
    if (!res.ok) throw new Error('Chyba při ukládání');
    await loadClients();
    await loadStatus();
  } catch (err) {
    alert(err.message);
  }
}

async function deleteClientRow(idKey) {
  if (!confirm('Opravdu trvale smazat tohoto klienta?')) return;
  try {
    var res = await fetch('/api/clients', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-pass': getAdminAuthPass()
      },
      body: JSON.stringify({ id: idKey })
    });
    if (!res.ok) throw new Error('Chyba při mazání');
    await loadClients();
    await loadStatus();
  } catch (err) {
    alert(err.message);
  }
}

// ── Slevové a dárkové kódy ───────────────────────
var loadedCodesCache = [];

// Pomocná funkce pro rychlé testování (přidá k aktuálnímu času daný počet vteřin)
function setQuickTestSeconds(sec) {
  var d = new Date(Date.now() + sec * 1000);
  var pad = function(n) { return (n < 10 ? '0' : '') + n; };
  var val = d.getFullYear() + '-' 
    + pad(d.getMonth() + 1) + '-' 
    + pad(d.getDate()) + 'T' 
    + pad(d.getHours()) + ':' 
    + pad(d.getMinutes()) + ':' 
    + pad(d.getSeconds());
  var input = document.getElementById('newPromoValidUntil');
  if (input) input.value = val;
}

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

var promoSplatkyCheckbox = document.getElementById('newPromoSplatky');
var promoDarekOnlyCheckbox = document.getElementById('newPromoDarekOnly');

if (promoSplatkyCheckbox) {
  promoSplatkyCheckbox.addEventListener('change', function () {
    var suCb = document.querySelector('.promo-pkg-cb[value="startup"]');
    if (this.checked) {
      if (promoDarekOnlyCheckbox) promoDarekOnlyCheckbox.checked = false;
      if (suCb) {
        suCb.checked = false;
        suCb.disabled = true;
        if (suCb.parentElement) {
          suCb.parentElement.style.opacity = '0.35';
          suCb.parentElement.style.pointerEvents = 'none';
        }
      }
    } else {
      if (suCb) {
        suCb.disabled = false;
        if (suCb.parentElement) {
          suCb.parentElement.style.opacity = '1';
          suCb.parentElement.style.pointerEvents = 'auto';
        }
      }
    }
  });
}

if (promoDarekOnlyCheckbox) {
  promoDarekOnlyCheckbox.addEventListener('change', function () {
    if (this.checked && promoSplatkyCheckbox) {
      promoSplatkyCheckbox.checked = false;
      var suCb = document.querySelector('.promo-pkg-cb[value="startup"]');
      if (suCb) {
        suCb.disabled = false;
        if (suCb.parentElement) {
          suCb.parentElement.style.opacity = '1';
          suCb.parentElement.style.pointerEvents = 'auto';
        }
      }
    }
  });
}

function getAdminAuthPass() {
  return ENTERED_PASS || sessionStorage.getItem(SESSION_KEY + '_pass') || '';
}

function copyCodeToClipboard(code, btn) {
  navigator.clipboard.writeText(code).then(function() {
    var origText = btn.innerHTML;
    btn.innerHTML = '✓';
    btn.style.color = '#2ecc71';
    btn.style.borderColor = '#2ecc71';
    setTimeout(function() {
      btn.innerHTML = origText;
      btn.style.color = '#ff9900';
      btn.style.borderColor = '#444';
    }, 1500);
  }).catch(function() {
    alert('Kód: ' + code);
  });
}

// ── Tisk a výběr šablon voucherů ─────────────────
function printVoucherModal(id) {
  var c = loadedCodesCache.find(function(item) { return item.id === id; });
  if (!c) return;

  var typeTitle = c.type === 'gift' 
    ? 'DÁRKOVÝ POUKAZ' 
    : (c.splatky ? 'SLEVOVÝ VOUCHER – SPLÁTKY' : (c.darekOnly ? 'SLEVA NA DÁRKOVÝ POUKAZ' : 'SLEVOVÝ VOUCHER'));

  var suffix = c.splatky ? ' na 1. splátku' : (c.darekOnly ? ' na dárkový poukaz' : '');
  var valueDisplay = c.type === 'gift' 
    ? '100% Uhrazeno' 
    : (c.type === 'percent' ? 'Sleva ' + c.value + ' %' + suffix : 'Sleva ' + c.value + ' Kč' + suffix);
  
  var pkgTitlesMap = { startup: 'START-UP', mentoring: 'MENTORING', ultimate: 'ULTIMATE' };
  var pkgsDisplay = '';
  if (!c.packages || c.packages.length === 0 || c.packages.length === 3) {
    pkgsDisplay = c.splatky ? 'MENTORING a ULTIMATE (SPLÁTKY)' : 'VŠECHNY SLUŽBY';
  } else {
    pkgsDisplay = c.packages.map(function(p) { return pkgTitlesMap[p] || p.toUpperCase(); }).join(', ');
    if (c.splatky) pkgsDisplay += ' – NA SPLÁTKY';
    if (c.darekOnly) pkgsDisplay += ' – JAKO DÁREK';
  }

  var redeemUrl = 'https://koblas-nutricni.cz/objednavka.html?kod=' + encodeURIComponent(c.code);
  if (c.splatky) redeemUrl += '&platba=splatky';
  if (c.darekOnly) redeemUrl += '&platba=jednorizove&darek=1';
  if (c.packages && c.packages.length === 1) redeemUrl += '&sluzba=' + encodeURIComponent(c.packages[0]);

  var printWin = window.open('', '_blank', 'width=900,height=750');
  printWin.document.write(`
    <!DOCTYPE html>
    <html lang="cs">
    <head>
      <meta charset="UTF-8">
      <title>Voucher - ${c.code}</title>
      <style>
        @page { size: A4 landscape; margin: 12mm; }
        * { box-sizing: border-box; }
        body {
          margin: 0;
          padding: 20px;
          background: #0d0d0d;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          min-height: 95vh;
        }

        .toolbar {
          margin-bottom: 25px;
          display: flex;
          gap: 15px;
          align-items: center;
          background: #181818;
          border: 1px solid #333;
          padding: 10px 20px;
          border-radius: 8px;
          flex-wrap: wrap;
        }
        .toolbar label {
          color: #bbb;
          font-family: monospace;
          font-size: 12px;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .toolbar select {
          background: #090909;
          color: #ff9900;
          border: 1px solid #c88a2c;
          padding: 7px 12px;
          font-family: monospace;
          font-size: 12px;
          border-radius: 4px;
          cursor: pointer;
        }
        .btn-print {
          background: #ff9900;
          color: #000;
          border: none;
          font-weight: bold;
          font-size: 13px;
          padding: 8px 18px;
          border-radius: 4px;
          cursor: pointer;
          font-family: monospace;
        }
        .btn-close {
          background: #252525;
          color: #aaa;
          border: 1px solid #444;
          font-size: 12px;
          padding: 7px 14px;
          border-radius: 4px;
          cursor: pointer;
          font-family: monospace;
        }

        .tpl-dark-gold {
          width: 740px;
          background: #141414;
          color: #eee;
          border: 2px solid #c88a2c;
          border-radius: 12px;
          padding: 40px;
          box-shadow: 0 10px 40px rgba(0,0,0,0.8);
          background-image: radial-gradient(circle at 100% 0%, rgba(200,138,44,0.12) 0%, transparent 60%);
        }
        .tpl-dark-gold .brand-title { font-family: Georgia, serif; font-size: 26px; color: #ff9900; margin: 0; }
        .tpl-dark-gold .brand-sub { font-family: monospace; font-size: 11px; color: #888; letter-spacing: 2px; margin-top: 4px; }
        .tpl-dark-gold .badge-type { background: rgba(200,138,44,0.15); border: 1px solid #c88a2c; color: #ff9900; font-family: monospace; font-size: 12px; padding: 5px 12px; border-radius: 4px; }
        .tpl-dark-gold .service-name { font-size: 20px; letter-spacing: 2px; color: #fff; text-transform: uppercase; font-weight: bold; margin-bottom: 6px; }
        .tpl-dark-gold .service-desc { color: #aaa; font-size: 15px; }
        .tpl-dark-gold .code-box { margin: 25px auto; padding: 16px 28px; background: #080808; border: 1px dashed #ff9900; border-radius: 8px; display: inline-block; }
        .tpl-dark-gold .code-text { font-family: monospace; font-size: 32px; font-weight: bold; color: #ff9900; letter-spacing: 6px; }
        .tpl-dark-gold .instructions { margin-top: 20px; font-size: 12px; color: #888; border-top: 1px solid rgba(255,255,255,0.06); padding-top: 18px; line-height: 1.6; }
        .tpl-dark-gold a { color: #ff9900; }

        .tpl-clean-white {
          width: 740px;
          background: #ffffff;
          color: #111111;
          border: 3px solid #111111;
          border-radius: 4px;
          padding: 40px;
          box-shadow: 0 10px 40px rgba(0,0,0,0.4);
        }
        .tpl-clean-white .brand-title { font-family: Georgia, serif; font-size: 28px; color: #111; margin: 0; font-weight: bold; }
        .tpl-clean-white .brand-sub { font-family: monospace; font-size: 11px; color: #555; letter-spacing: 2px; margin-top: 4px; }
        .tpl-clean-white .badge-type { background: #111; border: 1px solid #111; color: #fff; font-family: monospace; font-size: 12px; padding: 5px 12px; border-radius: 2px; }
        .tpl-clean-white .service-name { font-size: 20px; letter-spacing: 2px; color: #000; text-transform: uppercase; font-weight: bold; margin-bottom: 6px; }
        .tpl-clean-white .service-desc { color: #444; font-size: 15px; }
        .tpl-clean-white .code-box { margin: 25px auto; padding: 16px 28px; background: #f4f4f4; border: 2px solid #111; border-radius: 4px; display: inline-block; }
        .tpl-clean-white .code-text { font-family: monospace; font-size: 32px; font-weight: bold; color: #000; letter-spacing: 6px; }
        .tpl-clean-white .instructions { margin-top: 20px; font-size: 12px; color: #555; border-top: 1px solid #ddd; padding-top: 18px; line-height: 1.6; }
        .tpl-clean-white a { color: #111; font-weight: bold; }

        .tpl-sport-energy {
          width: 740px;
          background: linear-gradient(135deg, #0f0f0f 0%, #1b1b1b 100%);
          color: #fff;
          border-left: 8px solid #ff5500;
          border-top: 1px solid #333;
          border-right: 1px solid #333;
          border-bottom: 1px solid #333;
          border-radius: 6px;
          padding: 40px;
          box-shadow: 0 10px 40px rgba(0,0,0,0.8);
        }
        .tpl-sport-energy .brand-title { font-family: "Impact", "Arial Black", sans-serif; font-size: 30px; color: #ff5500; margin: 0; letter-spacing: 1px; }
        .tpl-sport-energy .brand-sub { font-family: monospace; font-size: 11px; color: #999; letter-spacing: 2px; margin-top: 4px; }
        .tpl-sport-energy .badge-type { background: #ff5500; color: #fff; font-family: monospace; font-size: 12px; padding: 5px 12px; border-radius: 3px; font-weight: bold; }
        .tpl-sport-energy .service-name { font-size: 20px; letter-spacing: 2px; color: #fff; text-transform: uppercase; font-weight: bold; margin-bottom: 6px; }
        .tpl-sport-energy .service-desc { color: #ccc; font-size: 15px; }
        .tpl-sport-energy .code-box { margin: 25px auto; padding: 16px 28px; background: #000; border: 2px solid #ff5500; border-radius: 4px; display: inline-block; }
        .tpl-sport-energy .code-text { font-family: monospace; font-size: 32px; font-weight: bold; color: #ff5500; letter-spacing: 6px; }
        .tpl-sport-energy .instructions { margin-top: 20px; font-size: 12px; color: #888; border-top: 1px solid #2a2a2a; padding-top: 18px; line-height: 1.6; }
        .tpl-sport-energy a { color: #ff5500; }

        @media print {
          body { background: #fff !important; padding: 0 !important; }
          .toolbar { display: none !important; }
          .voucher-card { box-shadow: none !important; width: 100% !important; margin: 0 !important; }
        }
      </style>
    </head>
    <body>
      <div class="toolbar">
        <label>ŠABLONA VOUCHERU:
          <select id="templateSelector" onchange="changeTemplate(this.value)">
            <option value="tpl-dark-gold">Dark Gold (Prémiová tmavá)</option>
            <option value="tpl-clean-white">Clean Minimal (Světlý tisk / Úsporná)</option>
            <option value="tpl-sport-energy">Sport &amp; Energy (Fitness styl)</option>
          </select>
        </label>
        <button class="btn-print" onclick="window.print()">🖨 TISK / ULOŽIT DO PDF</button>
        <button class="btn-close" onclick="window.close()">ZAVŘÍT</button>
      </div>

      <div id="voucherContainer" class="voucher-card tpl-dark-gold">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 20px; border-bottom: 1px solid rgba(125,125,125,0.2); margin-bottom: 25px;">
          <div>
            <h1 class="brand-title">KRYŠTOF KOBLAS</h1>
            <div class="brand-sub">NUTRIČNÍ ANALÝZA &amp; PORADENSTVÍ</div>
          </div>
          <div class="badge-type">${typeTitle}</div>
        </div>

        <div style="text-align: center; margin: 25px 0;">
          <div class="service-name">${pkgsDisplay}</div>
          <div class="service-desc">${valueDisplay}</div>

          <div class="code-box">
            <div class="code-text">${c.code}</div>
          </div>

          <div class="instructions">
            Pro aktivaci poukazu navštivte <strong>koblas-nutricni.cz</strong>, zvolte odpovídající balíček ${c.splatky ? 'a platbu na splátky' : (c.darekOnly ? 'a možnost Koupit jako dárkový poukaz' : '')} a v objednávkovém formuláři zadejte tento kód.<br>
            Přímý odkaz: <a href="${redeemUrl}">${redeemUrl}</a>
          </div>
        </div>
      </div>

      <script>
        function changeTemplate(tplClass) {
          var container = document.getElementById('voucherContainer');
          container.className = 'voucher-card ' + tplClass;
        }
      <\/script>
    </body>
    </html>
  `);
  printWin.document.close();
}

async function loadPromoCodes() {
  var tbody = document.getElementById('promoCodesTableBody');
  if (!tbody) return;

  var pass = getAdminAuthPass();
  if (!pass) {
    tbody.innerHTML = '<tr><td colspan="7" style="padding: 15px; text-align: center; color: #ff9900;">Pro zobrazení kódů zadejte heslo v přihlašovacím okně.</td></tr>';
    return;
  }

  tbody.innerHTML = '<tr><td colspan="7" style="padding: 15px; text-align: center; color: #888;">Načítám kódy z Cloudflare KV...</td></tr>';

  try {
    var res = await fetch('/api/codes', {
      headers: { 'x-admin-pass': pass }
    });
    if (!res.ok) throw new Error('Chyba autorizace (' + res.status + ')');
    var codes = await res.json();
    loadedCodesCache = codes || [];
    renderPromoCodesList(loadedCodesCache);
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="7" style="padding: 15px; text-align: center; color: #ff5555;">Chyba při načítání kódů: ' + err.message + '</td></tr>';
  }
}

function renderPromoCodesList(codes) {
  var tbody = document.getElementById('promoCodesTableBody');
  if (!codes || codes.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="padding: 15px; text-align: center; color: #777;">Zatím nejsou vytvořeny žádné slevové ani dárkové kódy.</td></tr>';
    return;
  }

  var now = new Date();

  tbody.innerHTML = codes.map(function(c) {
    var typeLabel = '';
    if (c.type === 'percent') typeLabel = c.value + ' %';
    else if (c.type === 'fixed') typeLabel = c.value + ' Kč';
    else if (c.type === 'gift') typeLabel = '<span style="color: #ff9900; font-weight: bold;">DÁRKOVÝ (100 %)</span>';

    if (c.splatky) {
      typeLabel += ' <span style="background: rgba(52,152,219,0.15); color: #3498db; padding: 2px 6px; border-radius: 3px; font-size: 10px; font-weight: bold; margin-left: 6px;">[SPLÁTKY]</span>';
    } else if (c.darekOnly) {
      typeLabel += ' <span style="background: rgba(230,126,34,0.15); color: #e67e22; padding: 2px 6px; border-radius: 3px; font-size: 10px; font-weight: bold; margin-left: 6px;">[JEN DÁREK]</span>';
    }

    var pkgs = (c.packages || []).map(function(p) { return p.toUpperCase(); }).join(', ');
    if (!pkgs) pkgs = 'VŠECHNY';

    var count = Number(c.usedCount || 0);
    if (!c.usedCount && c.used) count = 1;

    var usage = '';
    if (c.oneTime) {
      usage = c.used 
        ? '<span style="color: #e74c3c; font-weight: bold;">Uplatněn (' + count + '×)</span>' 
        : '<span style="color: #2ecc71;">Jednorázový (0×)</span>';
    } else {
      usage = '<span style="color: #3498db;">Neomezený</span> <strong style="color: #ff9900; margin-left: 4px;">(' + count + '× využito)</strong>';
    }

    // Stav expirace a banneru
    var isExpired = c.validUntil && new Date(c.validUntil) <= now;
    var bannerStatus = '';

    if (c.showInBanner) {
      bannerStatus += '<span style="color: #ff9900; font-weight: bold;">📢 V banneru</span>';
      if (c.bannerLabel) {
        bannerStatus += '<div style="font-size: 10px; color: #bbb;">„' + c.bannerLabel + '“</div>';
      }
    } else {
      bannerStatus += '<span style="color: #666;">○ Bez banneru</span>';
    }

    var expiryHtml = '';
    if (c.validUntil) {
      var expD = new Date(c.validUntil);
      var expStr = expD.toLocaleDateString('cs-CZ') + ' ' + expD.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' });
      if (isExpired) {
        expiryHtml = '<div style="color: #e74c3c; font-size: 10px; margin-top: 3px;">⚠ Vypršel: ' + expStr + '</div>';
      } else {
        expiryHtml = '<div style="color: #2ecc71; font-size: 10px; margin-top: 3px;">⏳ Do: ' + expStr + '</div>';
      }
    } else {
      expiryHtml = '<div style="color: #666; font-size: 10px; margin-top: 3px;">Bez časového limitu</div>';
    }

    var statusHtml = '';
    if (isExpired) {
      statusHtml = '<span style="color: #e74c3c; font-weight: bold;">✕ Expirován</span>';
    } else if (c.active) {
      statusHtml = '<span style="color: #2ecc71;">● Aktivní</span>';
    } else {
      statusHtml = '<span style="color: #666;">○ Vypnut</span>';
    }

    var toggleBtn = c.active 
      ? '<button onclick="togglePromoCodeActive(\'' + c.id + '\', false)" style="background: transparent; border: 1px solid #444; color: #bbb; padding: 4px 8px; border-radius: 3px; cursor: pointer; font-family: monospace; font-size: 11px;">Vypnout</button>'
      : '<button onclick="togglePromoCodeActive(\'' + c.id + '\', true)" style="background: rgba(46,204,113,0.15); border: 1px solid #2ecc71; color: #2ecc71; padding: 4px 8px; border-radius: 3px; cursor: pointer; font-family: monospace; font-size: 11px;">Aktivovat</button>';

    var bannerToggleBtn = c.showInBanner
      ? '<button onclick="togglePromoBanner(\'' + c.id + '\', false)" title="Vypnout z banneru" style="background: rgba(255,153,0,0.15); border: 1px solid #ff9900; color: #ff9900; padding: 4px 6px; border-radius: 3px; cursor: pointer; font-family: monospace; font-size: 11px;">📢 Vypnout banner</button>'
      : '<button onclick="togglePromoBanner(\'' + c.id + '\', true)" title="Zapnout do banneru" style="background: transparent; border: 1px solid #555; color: #aaa; padding: 4px 6px; border-radius: 3px; cursor: pointer; font-family: monospace; font-size: 11px;">📢 Do banneru</button>';

    var printBtn = '<button onclick="printVoucherModal(\'' + c.id + '\')" title="Tisk / PDF voucher" style="background: #151515; border: 1px solid #c88a2c; color: #ff9900; padding: 4px 8px; border-radius: 3px; cursor: pointer; font-family: monospace; font-size: 11px;">🖨 TISK</button>';

    var extraInfo = '';
    if (c.note) {
      extraInfo += '<div style="font-size: 10px; color: #ff9900; margin-top: 3px;">Koupil: <strong>' + c.note + '</strong></div>';
    }

    return '<tr style="border-bottom: 1px solid rgba(255,255,255,0.05);' + (isExpired ? 'opacity: 0.7;' : '') + '">'
      + '<td style="padding: 10px;">'
      +   '<div style="display: flex; align-items: center; gap: 8px;">'
      +     '<span style="font-weight: bold; color: #ff9900;">' + c.code + '</span>'
      +     '<button onclick="copyCodeToClipboard(\'' + c.code + '\', this)" title="Kopírovat do schránky" style="background: transparent; border: 1px solid #444; color: #ff9900; padding: 2px 6px; border-radius: 3px; cursor: pointer; font-family: monospace; font-size: 10px;">📋</button>'
      +   '</div>'
      +   extraInfo
      + '</td>'
      + '<td style="padding: 10px;">' + typeLabel + '</td>'
      + '<td style="padding: 10px; color: #aaa;">' + pkgs + '</td>'
      + '<td style="padding: 10px;">' + bannerStatus + expiryHtml + '</td>'
      + '<td style="padding: 10px;">' + usage + '</td>'
      + '<td style="padding: 10px;">' + statusHtml + '</td>'
      + '<td style="padding: 10px; text-align: right; display: flex; gap: 6px; justify-content: flex-end; align-items: center;">'
      +   bannerToggleBtn
      +   printBtn
      +   toggleBtn
      +   '<button onclick="deletePromoCode(\'' + c.id + '\')" style="background: rgba(231,76,60,0.15); border: 1px solid #e74c3c; color: #e74c3c; padding: 4px 8px; border-radius: 3px; cursor: pointer; font-family: monospace; font-size: 11px;">Smazat</button>'
      + '</td>'
      + '</tr>';
  }).join('');
}

async function createNewPromoCode() {
  var code = document.getElementById('newPromoCode').value.trim();
  var type = document.getElementById('newPromoType').value;
  var value = document.getElementById('newPromoValue').value;
  var oneTime = document.getElementById('newPromoOneTime').checked;
  var splatky = document.getElementById('newPromoSplatky') ? document.getElementById('newPromoSplatky').checked : false;
  var darekOnly = document.getElementById('newPromoDarekOnly') ? document.getElementById('newPromoDarekOnly').checked : false;
  var showInBanner = document.getElementById('newPromoShowInBanner') ? document.getElementById('newPromoShowInBanner').checked : false;
  var validUntil = document.getElementById('newPromoValidUntil') ? document.getElementById('newPromoValidUntil').value : '';
  var bannerLabel = document.getElementById('newPromoBannerLabel') ? document.getElementById('newPromoBannerLabel').value.trim() : '';

  var pkgCheckboxes = document.querySelectorAll('.promo-pkg-cb:checked');
  var packages = Array.from(pkgCheckboxes).map(function(cb) { return cb.value; });

  if (!code) {
    alert('Zadej text kódu nebo klikni na NÁHODNÝ.');
    return;
  }

  if (packages.length === 0) {
    alert('Musíš vybrat alespoň jeden balíček, pro který má kód platit.');
    return;
  }

  if (type !== 'gift' && (!value || Number(value) <= 0)) {
    alert('Zadej platnou číselnou hodnotu slevy.');
    return;
  }

  var payload = { 
    code: code, 
    type: type, 
    value: value, 
    oneTime: oneTime, 
    splatky: splatky, 
    darekOnly: darekOnly, 
    packages: packages,
    showInBanner: showInBanner,
    validUntil: validUntil || null,
    bannerLabel: bannerLabel,
    usedCount: 0
  };

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
    if (document.getElementById('newPromoValidUntil')) document.getElementById('newPromoValidUntil').value = '';
    if (document.getElementById('newPromoBannerLabel')) document.getElementById('newPromoBannerLabel').value = '';
    if (document.getElementById('newPromoShowInBanner')) document.getElementById('newPromoShowInBanner').checked = false;
    
    var splatkyEl = document.getElementById('newPromoSplatky');
    if (splatkyEl) splatkyEl.checked = false;

    var darekEl = document.getElementById('newPromoDarekOnly');
    if (darekEl) darekEl.checked = false;

    var suCb = document.querySelector('.promo-pkg-cb[value="startup"]');
    if (suCb) {
      suCb.disabled = false;
      if (suCb.parentElement) {
        suCb.parentElement.style.opacity = '1';
        suCb.parentElement.style.pointerEvents = 'auto';
      }
    }

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

async function togglePromoBanner(id, bannerState) {
  try {
    await fetch('/api/codes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-pass': getAdminAuthPass()
      },
      body: JSON.stringify({ id: id, showInBanner: bannerState })
    });
    loadPromoCodes();
  } catch (err) {
    alert('Chyba při změně banneru: ' + err.message);
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
