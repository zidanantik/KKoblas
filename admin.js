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
  payload
