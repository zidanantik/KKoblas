// functions/api/status.js

const DEFAULT = {
  startup: 'volny', mentoring: 'volny', ultimate: 'volny',
  capacity: {
    mode: 'total', // 'total' (celkem) nebo 'packages' (po balíčcích)
    totalLimit: 10,
    limits: { startup: 0, mentoring: 0, ultimate: 0 }
  },
  manualOverride: { startup: false, mentoring: false, ultimate: false },
  event: { active: false, name: '', popis: '', cena: '', odkaz: '' },
  prices: {
    startup:   { jednorizove: '6 900 Kč' },
    mentoring: { jednorizove: '14 700 Kč', splatky: '7 500 Kč (1. splátka)' },
    ultimate:  { jednorizove: '22 300 Kč', splatky: '11 900 Kč (1. splátka)' }
  }
};

function normalizePkg(str) {
  if (!str) return '';
  const s = String(str).toLowerCase();
  if (s.includes('ultimate')) return 'ultimate';
  if (s.includes('mentor')) return 'mentoring';
  if (s.includes('start')) return 'startup';
  return '';
}

async function getActiveCounts(store) {
  const rawClients = store ? await store.get('CLIENTS') : null;
  const clients = rawClients ? JSON.parse(rawClients) : [];
  const todayStr = new Date().toISOString().split('T')[0];

  // 1. Zjistíme všechny kódy, které už obdarovaný klient uplatnil
  const redeemedCodes = new Set();
  clients.forEach(c => {
    if (c.pouzity_kod) {
      redeemedCodes.add(String(c.pouzity_kod).trim().toUpperCase());
    }
  });

  const counts = { startup: 0, mentoring: 0, ultimate: 0, total: 0 };

  clients.forEach(c => {
    // Pokud je to původní dárkový nákup a jeho kód už někdo uplatnil, nepočítáme ho (místo už drží obdarovaný)
    if (c.is_gift && c.kod_voucheru && redeemedCodes.has(String(c.kod_voucheru).trim().toUpperCase())) {
      return;
    }

    if (c.status === 'aktivni') {
      const isWithinDates = !c.end_date || c.end_date >= todayStr;
      if (isWithinDates) {
        const pkg = normalizePkg(c.sluzba || c.sluzba_nazev);
        if (pkg && counts[pkg] !== undefined) {
          counts[pkg]++;
        }
        counts.total++;
      }
    }
  });

  return counts;
}

export async function onRequestGet(context) {
  try {
    const store = context.env.STATUS_STORE;
    const raw = store ? await store.get('status') : null;
    let data = raw ? JSON.parse(raw) : JSON.parse(JSON.stringify(DEFAULT));

    const counts = await getActiveCounts(store);
    data.counts = counts;

    if (!data.capacity) data.capacity = DEFAULT.capacity;
    if (!data.manualOverride) data.manualOverride = { startup: false, mentoring: false, ultimate: false };

    const cap = data.capacity;

    // ── AUTOMATICKÉ VYHODNOCENÍ KAPACITY ──
    if (cap.mode === 'total' && cap.totalLimit > 0) {
      const isFull = counts.total >= cap.totalLimit;
      data.autoClosed = isFull;
      ['startup', 'mentoring', 'ultimate'].forEach(pkg => {
        if (isFull) {
          data[pkg] = 'uzavreny';
        } else {
          // Pokud je kapacita volná, odemkneme, pokud jsi balíček nezavřel ručně velkým tlačítkem
          data[pkg] = data.manualOverride[pkg] ? 'uzavreny' : 'volny';
        }
      });
    } else if (cap.mode === 'packages') {
      ['startup', 'mentoring', 'ultimate'].forEach(pkg => {
        const lim = (cap.limits && cap.limits[pkg]) || 0;
        if (lim > 0 && counts[pkg] >= lim) {
          data[pkg] = 'uzavreny';
        } else {
          data[pkg] = data.manualOverride[pkg] ? 'uzavreny' : 'volny';
        }
      });
    } else {
      // Režim manual
      ['startup', 'mentoring', 'ultimate'].forEach(pkg => {
        data[pkg] = data.manualOverride[pkg] ? 'uzavreny' : 'volny';
      });
    }

    return new Response(JSON.stringify(data), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
    });
  } catch (e) {
    return new Response(JSON.stringify(DEFAULT), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
    });
  }
}

export async function onRequestPost(context) {
  try {
    const body = await context.request.json();
    const PASS = context.env.ADMIN_PASS || 'koblas123';
    if (body.password !== PASS) {
      return new Response('Unauthorized', { status: 401 });
    }

    const store = context.env.STATUS_STORE;
    const raw = store ? await store.get('status') : null;
    let prev = raw ? JSON.parse(raw) : JSON.parse(JSON.stringify(DEFAULT));

    const counts = await getActiveCounts(store);
    const DEF_P = DEFAULT.prices;

    const newCap = {
      mode: body.capacity?.mode || prev.capacity?.mode || 'total',
      totalLimit: Number(body.capacity?.totalLimit ?? prev.capacity?.totalLimit ?? 10),
      limits: {
        startup: Number(body.capacity?.limits?.startup ?? prev.capacity?.limits?.startup ?? 0),
        mentoring: Number(body.capacity?.limits?.mentoring ?? prev.capacity?.limits?.mentoring ?? 0),
        ultimate: Number(body.capacity?.limits?.ultimate ?? prev.capacity?.limits?.ultimate ?? 0)
      }
    };

    // Zjistíme, zda je celková kapacita plná
    const isFull = newCap.mode === 'total' && newCap.totalLimit > 0 && counts.total >= newCap.totalLimit;

    // Manuální override bereme jen tehdy, pokud je poslán explicitně (např. kliknutí na tlačítko UZAVŘÍT)
    let manualOverride = prev.manualOverride || { startup: false, mentoring: false, ultimate: false };
    if (body.manualOverride) {
      manualOverride = {
        startup: !!body.manualOverride.startup,
        mentoring: !!body.manualOverride.mentoring,
        ultimate: !!body.manualOverride.ultimate
      };
    } else if (body.singleToggle) {
      // Přepnutí konkrétní služby
      manualOverride[body.singleToggle] = body[body.singleToggle] === 'uzavreny';
    }

    // Výsledný stav balíčků
    const computedStatus = {};
    ['startup', 'mentoring', 'ultimate'].forEach(pkg => {
      if (isFull) {
        computedStatus[pkg] = 'uzavreny';
      } else if (newCap.mode === 'packages' && (newCap.limits[pkg] || 0) > 0 && counts[pkg] >= newCap.limits[pkg]) {
        computedStatus[pkg] = 'uzavreny';
      } else {
        // Kapacita je volná -> rozhoduje ruční zámek
        computedStatus[pkg] = manualOverride[pkg] ? 'uzavreny' : 'volny';
      }
    });

    const status = {
      startup: computedStatus.startup,
      mentoring: computedStatus.mentoring,
      ultimate: computedStatus.ultimate,
      manualOverride: manualOverride,
      capacity: newCap,
      counts: counts,
      autoClosed: isFull,
      event: {
        active: body.event?.active === true,
        name:   (body.event?.name  || '').slice(0, 120),
        popis:  (body.event?.popis || '').slice(0, 500),
        cena:   (body.event?.cena  || '').slice(0, 80),
        odkaz:  (body.event?.odkaz || '').slice(0, 300)
      },
      prices: {
        startup:  { jednorizove: String(body.prices?.startup?.jednorizove  || DEF_P.startup.jednorizove).slice(0, 80) },
        mentoring: {
          jednorizove: String(body.prices?.mentoring?.jednorizove || DEF_P.mentoring.jednorizove).slice(0, 80),
          splatky:     String(body.prices?.mentoring?.splatky     || DEF_P.mentoring.splatky).slice(0, 120)
        },
        ultimate: {
          jednorizove: String(body.prices?.ultimate?.jednorizove  || DEF_P.ultimate.jednorizove).slice(0, 80),
          splatky:     String(body.prices?.ultimate?.splatky      || DEF_P.ultimate.splatky).slice(0, 120)
        }
      }
    };

    await store.put('status', JSON.stringify(status));
    return new Response(JSON.stringify({ ok: true, status }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
}
