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
  santaHat: true,
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
    var data = await res.json();
    if (data.status) {
      currentStatus = data.status;
      renderAll();
      updateCapacityDisplay(data.status);
    }
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

function renderSantaHat() {
  var isHat = currentStatus.santaHat !== false;
  var led   = document.getElementById('led-santa');
  var txt   = document.getElementById('statusText-santa');
  var lbl   = document.getElementById('btnLabel-santa');
  var panel = document.getElementById('seasonPanel');
  if (led)   led.className   = 'status-led ' + (isHat ? 'volny' : '');
  if (txt)   txt.textContent = isHat ? 'ZAPNUTO' : 'VYPNUTO';
  if (lbl)   lbl.textContent = isHat ? 'VYPNOUT' : 'ZAPNOUT';
  if (panel) panel.classList.toggle('event-panel--active', isHat);
}

function renderAll() {
  SERVICES.forEach(renderStation);
  renderSantaHat();
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

// ── Toggle čepičky ──────────────────────────────
var btnSanta = document.getElementById('btn-santa');
if (btnSanta) {
  btnSanta.addEventListener('click', async function () {
    currentStatus.santaHat = !(currentStatus.santaHat !== false);
    renderSantaHat();
    await saveStatus();
  });
}

// ── Toggle služeb ────────────────────────────────
async function toggle(sluzba) {
  var prev = currentStatus[sluzba] || 'volny';
  var next = prev === 'volny' ? 'uzavreny' : 'volny';
  var action = next === 'uzavreny' ? 'UZAVŘÍT' : 'OTEVŘÍT';
  if (!confirm(action + ' službu ' + sluzba.toUpperCase() + '?')) return;

  var pass = ENTERED_PASS || sessionStorage.getItem(SESSION_KEY + '_pass') || '';
  var payload = Object.assign({}, currentStatus, { password: pass });
  payload[sluzba] = next;

  var currentOverride = currentStatus.manualOverride || {
    startup: currentStatus.startup === 'uzavreny',
    mentoring: currentStatus.mentoring === 'uzavreny',
    ultimate: currentStatus.ultimate === 'uzavreny'
  };
  payload.manualOverride = Object.assign({}, currentOverride);
  payload.manualOverride[sluzba] = (next === 'uzavreny');

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
  payload.manualOverride = { startup: isClosed, mentoring: isClosed, ultimate: isClosed };
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

// ── Event & Price save ───────────────────────────
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
  var totalWrap = document.getElementById('capTotalWrapper');
  var pkgsWrap  = document.getElementById('capPackagesWrapper');

  if (totalWrap) totalWrap.style.display = (mode === 'total') ? 'flex' : 'none';
  if (pkgsWrap)  pkgsWrap.style.display  = (mode === 'packages') ? 'flex' : 'none';
}

async function saveCapacitySettings() {
  var mode = document.getElementById('capacityMode').value;
  var totalLimit = parseInt(document.getElementById('capTotalLimit').value, 10) || 10;

  var suLimit = parseInt((document.getElementById('capLimitStartup') || {}).value, 10) || 0;
  var meLimit = parseInt((document.getElementById('capLimitMentoring') || {}).value, 10) || 0;
  var ulLimit = parseInt((document.getElementById('capLimitUltimate') || {}).value, 10) || 0;

  if (!currentStatus.capacity) currentStatus.capacity = {};
  currentStatus.capacity.mode = mode;
  currentStatus.capacity.totalLimit = totalLimit;
  currentStatus.capacity.limits = { startup: suLimit, mentoring: meLimit, ultimate: ulLimit };

  var pass = ENTERED_PASS || sessionStorage.getItem(SESSION_KEY + '_pass') || '';
  setDeploy('⚡ Ukládám kapacitu...', 'loading');

  try {
    var payload = {
      password: pass,
      capacity: currentStatus.capacity,
      event: currentStatus.event,
      prices: currentStatus.prices,
      santaHat: currentStatus.santaHat,
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
  var cap = data.capacity || { mode: 'total', totalLimit: 10, limits: { startup: 0, mentoring: 0, ultimate: 0 } };
  var counts = data.counts || { startup: 0, mentoring: 0, ultimate: 0, total: 0 };
  var limits = cap.limits || { startup: 0, mentoring: 0, ultimate: 0 };

  var modeSelect = document.getElementById('capacityMode');
  if (modeSelect) modeSelect.value = cap.mode || 'total';

  var limitInput = document.getElementById('capTotalLimit');
  if (limitInput) limitInput.value = cap.totalLimit || 10;

  var suInput = document.getElementById('capLimitStartup');
  if (suInput) suInput.value = limits.startup || 0;

  var meInput = document.getElementById('capLimitMentoring');
  if (meInput) meInput.value = limits.mentoring || 0;

  var ulInput = document.getElementById('capLimitUltimate');
  if (ulInput) ulInput.value = limits.ultimate || 0;

  handleCapacityModeChange();

  var countStartup = document.getElementById('count-startup');
  if (countStartup) countStartup.textContent = (cap.mode === 'packages' && limits.startup > 0) ? (counts.startup + ' / ' + limits.startup) : counts.startup;

  var countMentoring = document.getElementById('count-mentoring');
  if (countMentoring) countMentoring.textContent = (cap.mode === 'packages' && limits.mentoring > 0) ? (counts.mentoring + ' / ' + limits.mentoring) : counts.mentoring;

  var countUltimate = document.getElementById('count-ultimate');
  if (countUltimate) countUltimate.textContent = (cap.mode === 'packages' && limits.ultimate > 0) ? (counts.ultimate + ' / ' + limits.ultimate) : counts.ultimate;

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
      if (badge) {
        badge.style.background = 'rgba(52,152,219,0.15)';
        badge.style.borderColor = '#3498db';
        badge.style.color = '#3498db';
      }
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
    var res = await fetch('/api/clients', { headers: { 'x-admin-pass': pass } });
    if (!res.ok) throw new Error('Chyba autorizace');
    var clients = await res.json();
    loadedClientsCache = clients || [];
    renderClientsTable();
    if (loadedCodesCache && loadedCodesCache.length > 0) {
      renderPromoCodesList(loadedCodesCache);
    }
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="6" style="padding: 15px; text-align: center; color: #ff5555;">Chyba při načítání: ' + err.message + '</td></tr>';
  }
}

function filterClientsTable() {
  renderClientsTable();
}

function computeDaysLeftHtml(endDateVal, isActive) {
  if (!endDateVal || !isActive) return '';
  var today = new Date();
  today.setHours(0, 0, 0, 0);
  var endD = new Date(endDateVal + 'T00:00:00');
  var diffDays = Math.ceil((endD - today) / (1000 * 60 * 60 * 24));
  if (diffDays > 0) return ' <span style="color:#00ff66;font-size:10px;">(zbývá ' + diffDays + ' dní)</span>';
  if (diffDays === 0) return ' <span style="color:#ffaa00;font-size:10px;">(končí dnes)</span>';
  return ' <span style="color:#ff5555;font-size:10px;">(vypršelo)</span>';
}

function normalizePkgKey(str) {
  var s = String(str || '').toLowerCase();
  if (s.includes('ultimate')) return 'Ultimate';
  if (s.includes('mentor')) return 'Mentoring';
  return 'Start-up';
}

function renderClientsTable() {
  var tbody = document.getElementById('clientsTableBody');
  if (!tbody) return;

  var filter = document.getElementById('clientFilter') ? document.getElementById('clientFilter').value : 'active';
  var todayStr = new Date().toISOString().split('T')[0];

  var redeemedCodes = new Set();
  loadedClientsCache.forEach(function(c) {
    if (c.pouzity_kod) redeemedCodes.add(String(c.pouzity_kod).trim().toUpperCase());
  });

  var filtered = loadedClientsCache.filter(function(c) {
    if (filter === 'all') return true;
    var isGiftAlreadyRedeemed = c.is_gift && c.kod_voucheru && redeemedCodes.has(String(c.kod_voucheru).trim().toUpperCase());
    var isActive = c.status === 'aktivni' && (!c.end_date || c.end_date >= todayStr) && !isGiftAlreadyRedeemed;
var isWaiting = c.status === 'ceka_na_platbu';
    var isExpiredPayment = c.status === 'expirovana_platba';
    var isEnded = c.status === 'ukonceno' || c.status === 'zamitnuto' || (c.end_date && c.end_date < todayStr) || isGiftAlreadyRedeemed;

    if (filter === 'active') return isActive || isWaiting || isExpiredPayment;
    if (filter === 'only_active') return isActive;
    if (filter === 'waiting') return isWaiting || isExpiredPayment;
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

    var idKey = c.id || c.fakturoid_id || '';
    var clientEmail = (kup.email || '').replace(/'/g, "\\'");

  var matchTargetId = c.pending_merge_target_id || null;
    if (!matchTargetId && !c.is_gift && !c.notion_client_id && (kup.email || kup.jmeno)) {
      var olderMatch = loadedClientsCache.find(function(other) {
        if (String(other.id) === String(idKey)) return false;
        if (other.is_gift && !other.is_gift_redemption) return false;
        if (!other.notion_client_id) return false;
        var oEmail = (other.kupujici && other.kupujici.email) ? other.kupujici.email.toLowerCase().trim() : '';
        var oName  = (other.kupujici && other.kupujici.jmeno) ? other.kupujici.jmeno.toLowerCase().trim() : '';
        var curEmail = (kup.email || '').toLowerCase().trim();
        var curName  = (kup.jmeno || '').toLowerCase().trim();
        return (curEmail && oEmail === curEmail) || (curName && oName === curName);
      });
      if (olderMatch) matchTargetId = olderMatch.id;
    }

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

      if (Array.isArray(c.history) && c.history.length > 0) {
        var histText = c.history.map(function(h) {
          return h.sluzba + ' (' + (h.start_date || '?') + ' → ' + (h.end_date || '?') + ')';
        }).join(', ');
        clientHtml += '<div style="font-size: 10px; color: #3498db; margin-top: 4px; background: rgba(52,152,219,0.1); padding: 3px 6px; border-radius: 3px;">'
          + '📜 Historie: ' + histText
          + '</div>';
      }

      if (matchTargetId) {
        clientHtml += '<div style="margin-top: 6px; padding: 6px 8px; background: rgba(255,153,0,0.15); border: 1px solid #ff9900; border-radius: 4px;">'
          + '<div style="font-size: 10px; color: #ffaa22; font-weight: bold; margin-bottom: 4px;">🔄 Tento klient už má v Notionu kartu!</div>'
          + '<button type="button" onclick="mergeClientCards(\'' + idKey + '\', \'' + matchTargetId + '\')" style="background: #ff9900; color: #000; border: none; padding: 3px 8px; border-radius: 3px; font-weight: bold; font-size: 10px; cursor: pointer; margin-right: 6px;">🔗 Navázat na stávající kartu (+ připsat měření)</button>'
          + '<button type="button" onclick="forceCreateNewCard(\'' + idKey + '\')" style="background: #222; color: #ccc; border: 1px solid #555; padding: 3px 8px; border-radius: 3px; font-size: 10px; cursor: pointer;">➕ Založit novou kartu</button>'
          + '</div>';
      }
      if (c.status === 'expirovana_platba') {
        var expInfo = c.expired_payment_info || {};
        var daysText = expInfo.days_overdue ? ('o ' + expInfo.days_overdue + ' dní po splatnosti') : 'po expiraci faktury';
        clientHtml += '<div style="margin-top: 8px; padding: 8px 10px; background: rgba(231,76,60,0.12); border: 1.5px solid #e74c3c; border-radius: 4px;">'
          + '<div style="font-size: 11px; color: #ff6b6b; font-weight: bold; margin-bottom: 4px;">⚠️ PLATBA PŘIJATA PO SPLATNOSTI (' + daysText + ')</div>'
          + '<div style="font-size: 10px; color: #ccc; margin-bottom: 6px;">Automatická aktivace byla pozastavena. Zkontroluj kapacitu a rozhodni:</div>'
          + '<button type="button" onclick="approveExpiredPayment(\'' + idKey + '\')" style="background: #2ecc71; color: #000; border: none; padding: 4px 8px; border-radius: 3px; font-weight: bold; font-size: 10.5px; cursor: pointer; margin-right: 6px;">✅ Schválit a aktivovat</button>'
          + '<button type="button" onclick="rejectExpiredPayment(\'' + idKey + '\')" style="background: rgba(231,76,60,0.2); color: #ff6b6b; border: 1px solid #e74c3c; padding: 4px 8px; border-radius: 3px; font-size: 10.5px; cursor: pointer;">❌ Zamítnout / Vráceno</button>'
          + '</div>';
      }
    }

    var diag = c.diagnostika || {};
    var diagText = (!isGiftDonorAlreadyClaimed && diag.vek) ? (diag.vek + ' let · ' + diag.vyska + ' cm · ' + diag.vaha + ' kg' + (diag.zprava ? ' | Cíl: ' + diag.zprava : '')) : '';

    var startDateVal = c.start_date || (c.datum_platby ? c.datum_platby.split('T')[0] : '');
    var endDateVal = c.end_date || '';

    var daysLeftHtml = '<span id="daysleft-' + idKey + '">' + computeDaysLeftHtml(endDateVal, c.status === 'aktivni' && !isGiftDonorAlreadyClaimed) + '</span>';

    var currentPkgKey = normalizePkgKey(c.sluzba_nazev || c.sluzba);
    var pkgSelectHtml = isGiftDonorAlreadyClaimed
      ? '<span style="color:#888;">' + currentPkgKey + '</span>'
      : '<select id="pkg-' + idKey + '" onchange="handlePkgOrDateChange(\'' + idKey + '\')" class="event-input" style="padding: 4px 6px; font-size: 11px; margin: 0; color: #ff9900; font-weight: bold;">'
        + '<option value="Start-up"' + (currentPkgKey === 'Start-up' ? ' selected' : '') + '>Start-up (1m)</option>'
        + '<option value="Mentoring"' + (currentPkgKey === 'Mentoring' ? ' selected' : '') + '>Mentoring (4m)</option>'
        + '<option value="Ultimate"' + (currentPkgKey === 'Ultimate' ? ' selected' : '') + '>Ultimate (6m)</option>'
        + '</select>';

var statusSelectHtml = isGiftDonorAlreadyClaimed
      ? '<span style="color: #888; font-size: 11px;">✔ Uplatněno (Obdarovaný převzal)</span>'
      : '<select id="status-' + idKey + '" onchange="handleEndDateManualChange(\'' + idKey + '\')" class="event-input" style="padding: 4px 6px; font-size: 11px; margin: 0;">'
        + '<option value="aktivni"' + (c.status === 'aktivni' ? ' selected' : '') + '>● Aktivní</option>'
        + '<option value="ceka_na_platbu"' + (c.status === 'ceka_na_platbu' ? ' selected' : '') + '>○ Čeká na platbu</option>'
        + '<option value="expirovana_platba"' + (c.status === 'expirovana_platba' ? ' selected' : '') + '>⚠️ Expirovaná platba</option>'
        + '<option value="zamitnuto"' + (c.status === 'zamitnuto' ? ' selected' : '') + '>⛔ Zamítnuto / Vráceno</option>'
        + '<option value="ukonceno"' + (c.status === 'ukonceno' ? ' selected' : '') + '>× Ukončeno</option>'
        + '</select>';

    var dateStartHtml = isGiftDonorAlreadyClaimed 
      ? '<span style="color:#666;font-size:11px;">—</span>'
      : '<input type="date" id="start-' + idKey + '" value="' + startDateVal + '" onchange="handlePkgOrDateChange(\'' + idKey + '\')" class="event-input" style="padding: 4px 6px; font-size: 11px; margin: 0; width: 125px;">';

    var dateEndHtml = isGiftDonorAlreadyClaimed 
      ? '<span style="color:#666;font-size:11px;">—</span>'
      : '<input type="date" id="end-' + idKey + '" value="' + endDateVal + '" onchange="handleEndDateManualChange(\'' + idKey + '\')" class="event-input" style="padding: 4px 6px; font-size: 11px; margin: 0; width: 125px;">' + daysLeftHtml;

    var saveBtnHtml = isGiftDonorAlreadyClaimed
      ? ''
      : '<button onclick="saveClientRow(\'' + idKey + '\')" class="event-save-btn" style="margin: 0 4px; padding: 4px 10px; font-size: 11px;">💾 Uložit</button>';

    return '<tr style="border-bottom: 1px solid rgba(255,255,255,0.06);' + (isGiftDonorAlreadyClaimed ? 'opacity: 0.6;' : '') + '">'
      + '<td style="padding: 12px 10px;">' + clientHtml + (diagText ? '<div style="font-size: 10px; color: #777; margin-top: 4px;">' + diagText + '</div>' : '') + '</td>'
      + '<td style="padding: 12px 10px;">' + pkgSelectHtml + '<br><span style="font-size:10px;color:#888;display:inline-block;margin-top:3px;">' + (c.is_installment ? 'Splátky (' + (c.current_installment || 1) + '/' + (c.total_installments || 1) + ')' : 'Jednorázově') + '</span></td>'
      + '<td style="padding: 12px 10px;">' + dateStartHtml + '</td>'
      + '<td style="padding: 12px 10px;">' + dateEndHtml + '</td>'
      + '<td style="padding: 12px 10px;">' + statusSelectHtml + '</td>'
      + '<td style="padding: 12px 10px; text-align: right; white-space: nowrap;">'
      +   saveBtnHtml
      +   '<button onclick="deleteClientRow(\'' + idKey + '\', \'' + clientEmail + '\')" style="background: rgba(255,0,0,0.1); border: 1px solid #ff2222; color: #ff2222; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 11px;">Smazat</button>'
      + '</td>'
      + '</tr>';
  }).join('');
}

function handlePkgOrDateChange(idKey) {
  var startInput = document.getElementById('start-' + idKey);
  var endInput   = document.getElementById('end-' + idKey);
  var pkgSelect  = document.getElementById('pkg-' + idKey);
  if (!startInput || !endInput || !startInput.value) return;

  var d = new Date(startInput.value + 'T00:00:00');
  var s = pkgSelect ? String(pkgSelect.value).toLowerCase() : '';
  var months = 1;
  if (s.includes('ultimate')) months = 6;
  else if (s.includes('mentor')) months = 4;

  d.setMonth(d.getMonth() + months);
  var pad = function(n) { return (n < 10 ? '0' : '') + n; };
  endInput.value = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  handleEndDateManualChange(idKey);
}

function handleEndDateManualChange(idKey) {
  var endInput   = document.getElementById('end-' + idKey);
  var statusEl   = document.getElementById('status-' + idKey);
  var daysSpan   = document.getElementById('daysleft-' + idKey);
  if (!endInput || !daysSpan) return;
  var isActive = !statusEl || statusEl.value === 'aktivni';
  daysSpan.innerHTML = computeDaysLeftHtml(endInput.value, isActive);
}

async function mergeClientCards(newClientId, targetClientId) {
  if (!confirm('Navázat tuto objednávku na stávající kartu klienta v Notionu?\n\n• V Notionu se přepíše typ balíčku a nové termíny.\n• Ke stávající kartě se připíše nové měření "Vstupní dotazník (web)".\n• Původní balíček se uloží do historie.')) return;

  try {
    var res = await fetch('/api/clients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-pass': getAdminAuthPass() },
      body: JSON.stringify({ action: 'merge_client', newClientId: newClientId, targetClientId: targetClientId })
    });
    if (!res.ok) throw new Error('Chyba při slučování karet');
    await loadClients();
    await loadStatus();
  } catch (err) {
    alert(err.message);
  }
}

async function forceCreateNewCard(idKey) {
  if (!confirm('Opravdu založit v Notionu zcela novou samostatnou kartu pro tohoto klienta?')) return;
  try {
    var res = await fetch('/api/clients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-pass': getAdminAuthPass() },
      body: JSON.stringify({ id: idKey, status: 'aktivni', forceNewCard: true })
    });
    if (!res.ok) throw new Error('Chyba při zakládání nové karty');
    await loadClients();
    await loadStatus();
  } catch (err) {
    alert(err.message);
  }
}
async function approveExpiredPayment(idKey) {
  if (!confirm('Opravdu chceš tuto opožděnou platbu schválit a klienta aktivovat?\n\n• Založí se karta v Notionu (nebo aktivuje dárkový poukaz).\n• Klientovi odejde uvítací e-mail se ZOFem a InBody.\n• Začne se počítat do aktivní kapacity.')) return;

  try {
    var res = await fetch('/api/clients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-pass': getAdminAuthPass() },
      body: JSON.stringify({ action: 'approve_expired', id: idKey })
    });
    if (!res.ok) throw new Error('Chyba při schvalování platby');
    await loadClients();
    await loadStatus();
  } catch (err) {
    alert(err.message);
  }
}

async function rejectExpiredPayment(idKey) {
  if (!confirm('Označit tuto platbu jako Zamítnutou?\n\nKlient zůstane v historii se statusem "Zamítnuto / Vráceno", neovlivní kapacitu a budeš moci platbu vrátit na bankovní účet.')) return;

  try {
    var res = await fetch('/api/clients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-pass': getAdminAuthPass() },
      body: JSON.stringify({ id: idKey, status: 'zamitnuto' })
    });
    if (!res.ok) throw new Error('Chyba při změně statusu');
    await loadClients();
    await loadStatus();
  } catch (err) {
    alert(err.message);
  }
}

async function saveClientRow(idKey) {
  var btn = window.event ? (window.event.target || window.event.srcElement) : null;
  if (btn) { btn.disabled = true; btn.textContent = '⏳ ...'; }

  var startVal  = document.getElementById('start-' + idKey).value;
  var endVal    = document.getElementById('end-' + idKey).value;
  var statusVal = document.getElementById('status-' + idKey).value;
  var pkgVal    = document.getElementById('pkg-' + idKey) ? document.getElementById('pkg-' + idKey).value : undefined;

  try {
    var res = await fetch('/api/clients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-pass': getAdminAuthPass() },
      body: JSON.stringify({ id: idKey, sluzba: pkgVal, start_date: startVal, end_date: endVal, status: statusVal })
    });
    if (!res.ok) throw new Error('Chyba při ukládání');
    await loadClients();
    await loadStatus();
  } catch (err) {
    alert(err.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '💾 Uložit'; }
  }
}

async function deleteClientRow(idKey, email) {
  if (!confirm('Opravdu trvale smazat tohoto klienta?')) return;
  try {
    var res = await fetch('/api/clients', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', 'x-admin-pass': getAdminAuthPass() },
      body: JSON.stringify({ id: idKey, email: email || '' })
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

function addQuickTime(minutes) {
  var input = document.getElementById('newPromoValidUntil');
  var base = new Date();
  if (input && input.value) {
    var existing = new Date(input.value);
    if (!isNaN(existing.getTime()) && existing.getTime() > Date.now()) base = existing;
  }
  var target = new Date(base.getTime() + minutes * 60 * 1000);
  var pad = function(n) { return (n < 10 ? '0' : '') + n; };
  var val = target.getFullYear() + '-' + pad(target.getMonth() + 1) + '-' + pad(target.getDate()) + 'T' + pad(target.getHours()) + ':' + pad(target.getMinutes()) + ':' + pad(target.getSeconds());
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
  for (var i = 0; i < 6; i++) res += chars.charAt(Math.floor(Math.random() * chars.length));
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
        if (suCb.parentElement) { suCb.parentElement.style.opacity = '0.35'; suCb.parentElement.style.pointerEvents = 'none'; }
      }
    } else if (suCb) {
      suCb.disabled = false;
      if (suCb.parentElement) { suCb.parentElement.style.opacity = '1'; suCb.parentElement.style.pointerEvents = 'auto'; }
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
        if (suCb.parentElement) { suCb.parentElement.style.opacity = '1'; suCb.parentElement.style.pointerEvents = 'auto'; }
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
  }).catch(function() { alert('Kód: ' + code); });
}

function printVoucherModal(id) {
  var c = loadedCodesCache.find(function(item) { return item.id === id; });
  if (!c) return;
  window.open('voucher.html?kod=' + encodeURIComponent(c.code), '_blank');
}

async function loadPromoCodes() {
  var tbody = document.getElementById('promoCodesTableBody');
  if (!tbody) return;
  var pass = getAdminAuthPass();
  if (!pass) return;

  tbody.innerHTML = '<tr><td colspan="7" style="padding: 15px; text-align: center; color: #888;">Načítám kódy z Cloudflare KV...</td></tr>';

  try {
    var res = await fetch('/api/codes', { headers: { 'x-admin-pass': pass } });
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
    var typeLabel = c.type === 'percent' ? (c.value + ' %') : (c.type === 'fixed' ? (c.value + ' Kč') : '<span style="color: #ff9900; font-weight: bold;">DÁRKOVÝ (100 %)</span>');
    if (c.splatky) typeLabel += ' <span style="background: rgba(52,152,219,0.15); color: #3498db; padding: 2px 6px; border-radius: 3px; font-size: 10px; font-weight: bold; margin-left: 6px;">[SPLÁTKY]</span>';
    else if (c.darekOnly) typeLabel += ' <span style="background: rgba(230,126,34,0.15); color: #e67e22; padding: 2px 6px; border-radius: 3px; font-size: 10px; font-weight: bold; margin-left: 6px;">[JEN DÁREK]</span>';

    var pkgs = (c.packages || []).map(function(p) { return p.toUpperCase(); }).join(', ') || 'VŠECHNY';
    var count = Number(c.usedCount || 0) || (c.used ? 1 : 0);
    var usage = c.oneTime
      ? (c.used ? '<span style="color: #e74c3c; font-weight: bold;">Uplatněn (' + count + '×)</span>' : '<span style="color: #2ecc71;">Jednorázový (0×)</span>')
      : '<span style="color: #3498db;">Neomezený</span> <strong style="color: #ff9900; margin-left: 4px;">(' + count + '× využito)</strong>';

    var isExpired = c.validUntil && new Date(c.validUntil) <= now;
    var bannerStatus = c.showInBanner
      ? '<span style="color: #ff9900; font-weight: bold;">📢 V banneru</span>' + (c.bannerLabel ? '<div style="font-size: 10px; color: #bbb;">„' + c.bannerLabel + '“</div>' : '')
      : '<span style="color: #666;">○ Bez banneru</span>';

    var expiryHtml = '<div style="color: #666; font-size: 10px; margin-top: 3px;">Bez časového limitu</div>';
    if (c.validUntil) {
      var expD = new Date(c.validUntil);
      var expStr = expD.toLocaleDateString('cs-CZ') + ' ' + expD.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' });
      expiryHtml = isExpired
        ? '<div style="color: #e74c3c; font-size: 10px; margin-top: 3px;">⚠ Vypršel: ' + expStr + '</div>'
        : '<div style="color: #2ecc71; font-size: 10px; margin-top: 3px;">⏳ Do: ' + expStr + '</div>';
    }

    var statusHtml = isExpired ? '<span style="color: #e74c3c; font-weight: bold;">✕ Expirován</span>' : (c.active ? '<span style="color: #2ecc71;">● Aktivní</span>' : '<span style="color: #666;">○ Vypnut</span>');
    var toggleBtn = c.active 
      ? '<button onclick="togglePromoCodeActive(\'' + c.id + '\', false)" style="background: transparent; border: 1px solid #444; color: #bbb; padding: 4px 8px; border-radius: 3px; cursor: pointer; font-family: monospace; font-size: 11px;">Vypnout</button>'
      : '<button onclick="togglePromoCodeActive(\'' + c.id + '\', true)" style="background: rgba(46,204,113,0.15); border: 1px solid #2ecc71; color: #2ecc71; padding: 4px 8px; border-radius: 3px; cursor: pointer; font-family: monospace; font-size: 11px;">Aktivovat</button>';

    var bannerToggleBtn = c.showInBanner
      ? '<button onclick="togglePromoBanner(\'' + c.id + '\', false)" style="background: rgba(255,153,0,0.15); border: 1px solid #ff9900; color: #ff9900; padding: 4px 6px; border-radius: 3px; cursor: pointer; font-family: monospace; font-size: 11px;">📢 Vypnout banner</button>'
      : '<button onclick="togglePromoBanner(\'' + c.id + '\', true)" style="background: transparent; border: 1px solid #555; color: #aaa; padding: 4px 6px; border-radius: 3px; cursor: pointer; font-family: monospace; font-size: 11px;">📢 Do banneru</button>';

    var printBtn = '<button onclick="printVoucherModal(\'' + c.id + '\')" style="background: #151515; border: 1px solid #c88a2c; color: #ff9900; padding: 4px 8px; border-radius: 3px; cursor: pointer; font-family: monospace; font-size: 11px;">🖨 TISK</button>';
    var extraInfo = c.note ? '<div style="font-size: 10px; color: #ff9900; margin-top: 3px;">Koupil: <strong>' + c.note + '</strong></div>' : '';

    return '<tr style="border-bottom: 1px solid rgba(255,255,255,0.05);' + (isExpired ? 'opacity: 0.7;' : '') + '">'
      + '<td style="padding: 10px;"><div style="display: flex; align-items: center; gap: 8px;"><span style="font-weight: bold; color: #ff9900;">' + c.code + '</span>'
      + '<button onclick="copyCodeToClipboard(\'' + c.code + '\', this)" style="background: transparent; border: 1px solid #444; color: #ff9900; padding: 2px 6px; border-radius: 3px; cursor: pointer; font-family: monospace; font-size: 10px;">📋</button></div>' + extraInfo + '</td>'
      + '<td style="padding: 10px;">' + typeLabel + '</td>'
      + '<td style="padding: 10px; color: #aaa;">' + pkgs + '</td>'
      + '<td style="padding: 10px;">' + bannerStatus + expiryHtml + '</td>'
      + '<td style="padding: 10px;">' + usage + '</td>'
      + '<td style="padding: 10px;">' + statusHtml + '</td>'
      + '<td style="padding: 10px; text-align: right; display: flex; gap: 6px; justify-content: flex-end; align-items: center;">'
      + bannerToggleBtn + printBtn + toggleBtn
      + '<button onclick="deletePromoCode(\'' + c.id + '\')" style="background: rgba(231,76,60,0.15); border: 1px solid #e74c3c; color: #e74c3c; padding: 4px 8px; border-radius: 3px; cursor: pointer; font-family: monospace; font-size: 11px;">Smazat</button></td></tr>';
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
  var validUntilInput = document.getElementById('newPromoValidUntil') ? document.getElementById('newPromoValidUntil').value : '';
  var bannerLabel = document.getElementById('newPromoBannerLabel') ? document.getElementById('newPromoBannerLabel').value.trim() : '';

  var pkgCheckboxes = document.querySelectorAll('.promo-pkg-cb:checked');
  var packages = Array.from(pkgCheckboxes).map(function(cb) { return cb.value; });

  if (!code) { alert('Zadej text kódu nebo klikni na NÁHODNÝ.'); return; }
  if (packages.length === 0) { alert('Musíš vybrat alespoň jeden balíček.'); return; }
  if (type !== 'gift' && (!value || Number(value) <= 0)) { alert('Zadej platnou hodnotu slevy.'); return; }

  var validUntil = null;
  if (validUntilInput) {
    var parsedD = new Date(validUntilInput);
    if (!isNaN(parsedD.getTime())) validUntil = parsedD.toISOString();
  }

  var payload = { code: code, type: type, value: value, oneTime: oneTime, splatky: splatky, darekOnly: darekOnly, packages: packages, showInBanner: showInBanner, validUntil: validUntil, bannerLabel: bannerLabel, usedCount: 0 };

  try {
    var res = await fetch('/api/codes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-pass': getAdminAuthPass() },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error('Chyba při ukládání kódu.');

    document.getElementById('newPromoCode').value = '';
    document.getElementById('newPromoValue').value = '';
    if (document.getElementById('newPromoValidUntil')) document.getElementById('newPromoValidUntil').value = '';
    if (document.getElementById('newPromoBannerLabel')) document.getElementById('newPromoBannerLabel').value = '';
    if (document.getElementById('newPromoShowInBanner')) document.getElementById('newPromoShowInBanner').checked = false;
    loadPromoCodes();
  } catch (err) {
    alert(err.message);
  }
}

async function togglePromoCodeActive(id, activeState) {
  try {
    await fetch('/api/codes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-pass': getAdminAuthPass() },
      body: JSON.stringify({ id: id, active: activeState })
    });
    loadPromoCodes();
  } catch (err) { alert('Chyba: ' + err.message); }
}

async function togglePromoBanner(id, bannerState) {
  try {
    await fetch('/api/codes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-pass': getAdminAuthPass() },
      body: JSON.stringify({ id: id, showInBanner: bannerState })
    });
    loadPromoCodes();
  } catch (err) { alert('Chyba: ' + err.message); }
}

async function deletePromoCode(id) {
  if (!confirm('Opravdu trvale smazat tento kód?')) return;
  try {
    await fetch('/api/codes', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', 'x-admin-pass': getAdminAuthPass() },
      body: JSON.stringify({ id: id })
    });
    loadPromoCodes();
  } catch (err) { alert('Chyba: ' + err.message); }
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
      body.innerHTML = '<div class="an-err-box"><span class="an-err-icon">⚠</span><span class="an-err-msg">' + (d.error || 'Neznámá chyba') + '</span></div>';
      return;
    }
    body.innerHTML = buildAnHTML(d);
  } catch (e) {
    body.innerHTML = '<div class="an-err-box"><span class="an-err-icon">⚠</span><span class="an-err-msg">Chyba: ' + e.message + '</span></div>';
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
      return '<div class="an-bar"><div class="an-bar__fill" style="height:' + h + '%"></div><span class="an-bar__lbl">' + lblFn(x) + '</span></div>';
    }).join('');
  }

  var pageNames = {'/':'Úvod','/sluzby.html':'Služby','/omne.html':'O mně','/jakpracuji.html':'Jak pracuji','/faq.html':'FAQ','/kontakt.html':'Kontakt','/objednavka.html':'Objednávka','/dekujeme.html':'Děkujeme'};
  var deviceNames = {'Desktop':'Desktop','Mobile':'Mobil','Tablet':'Tablet','Bot':'Bot'};

  var pagesHTML = (d.topPages || []).map(function(p) {
    return '<li class="an-page-row"><span class="an-page-name">' + (pageNames[p.path] || p.path) + '</span><span class="an-page-count">' + p.count + '</span></li>';
  }).join('') || '<li class="an-page-row"><span style="color:var(--sub);font-size:.7rem">žádná data</span></li>';

  var devicesHTML = (d.devices || []).map(function(x) {
    return '<li class="an-dev-row"><span class="an-dev-name">' + (deviceNames[x.type] || x.type) + '</span><span class="an-dev-bar"><span class="an-dev-fill" style="width:' + x.pct + '%"></span></span><span class="an-dev-pct">' + x.pct + '%</span></li>';
  }).join('') || '<li class="an-dev-row"><span style="color:var(--sub);font-size:.7rem">žádná data</span></li>';

  return '<div class="an-charts">'
    + '<div class="an-chart"><div class="an-chart__title">DNES &mdash; <b>' + (d.todayPv || 0) + '</b> zobrazení</div><div class="an-bars">' + bars(d.hours || [], function(x) { return x.hour % 6 === 0 ? x.hour + 'h' : ''; }) + '</div></div>'
    + '<div class="an-chart"><div class="an-chart__title">7 DNÍ &mdash; <b>' + (d.pageviews || 0) + '</b> zobrazení</div><div class="an-bars">' + bars(d.days || [], function(x) { return x.date.slice(5).replace('-', '/'); }) + '</div></div>'
    + '</div>'
    + '<div class="an-details">'
    + '<div class="an-block"><div class="an-block__title">TOP STRÁNKY</div><ul class="an-pages">' + pagesHTML + '</ul></div>'
    + '<div class="an-block"><div class="an-block__title">ZAŘÍZENÍ</div><ul class="an-devs">' + devicesHTML + '</ul></div>'
    + '</div>';
}
// === KONEC SOUBORU ADMIN.JS ===
