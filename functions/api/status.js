// functions/api/status.js

const DEFAULT = {
  startup: 'volny', mentoring: 'volny', ultimate: 'volny',
  capacity: {
    mode: 'total', // 'total' (celkem) nebo 'packages' (po balíčcích)
    totalLimit: 10,
    limits: { startup: 0, mentoring: 0, ultimate: 0 }
  },
  event: { active: false, name: '', popis: '', cena: '', odkaz: '' },
  prices: {
    startup:  { jednorizove: '6 900 Kč' },
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

export async function onRequestGet(context) {
  try {
    const store = context.env.STATUS_STORE;
    const raw = store ? await store.get('status') : null;
    let data = raw ? JSON.parse(raw) : JSON.parse(JSON.stringify(DEFAULT));

    // Načteme klienty pro výpočet reálné kapacity
    const rawClients = store ? await store.get('CLIENTS') : null;
    const clients = rawClients ? JSON.parse(rawClients) : [];
    const todayStr = new Date().toISOString().split('T')[0];

    const counts = { startup: 0, mentoring: 0, ultimate: 0, total: 0 };

    clients.forEach(c => {
      // Poukaz jako dárek, který ještě nebyl uplatněn, nezabírá tréninkovou kapacitu
      if (c.is_gift && !c.is_gift_redemption) return;

      // Aktivní je klient se stavem aktivni a platným datem
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

    data.counts = counts;
    if (!data.capacity) data.capacity = DEFAULT.capacity;

    // Automatické vyhodnocení stavu balíčků podle kapacity
    const cap = data.capacity;
    if (cap.mode === 'total' && cap.totalLimit > 0) {
      if (counts.total >= cap.totalLimit) {
        data.startup = 'uzavreny';
        data.mentoring = 'uzavreny';
        data.ultimate = 'uzavreny';
        data.autoClosed = true;
      }
    } else if (cap.mode === 'packages') {
      ['startup', 'mentoring', 'ultimate'].forEach(pkg => {
        const lim = (cap.limits && cap.limits[pkg]) || 0;
        if (lim > 0 && counts[pkg] >= lim) {
          data[pkg] = 'uzavreny';
        }
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

    const allowed = ['volny', 'uzavreny'];
    const DEF_P = DEFAULT.prices;

    const status = {
      startup:   allowed.includes(body.startup)   ? body.startup   : prev.startup,
      mentoring: allowed.includes(body.mentoring) ? body.mentoring : prev.mentoring,
      ultimate:  allowed.includes(body.ultimate)  ? body.ultimate  : prev.ultimate,
      capacity: {
        mode: body.capacity?.mode || prev.capacity?.mode || 'total',
        totalLimit: Number(body.capacity?.totalLimit ?? prev.capacity?.totalLimit ?? 10),
        limits: {
          startup: Number(body.capacity?.limits?.startup ?? prev.capacity?.limits?.startup ?? 0),
          mentoring: Number(body.capacity?.limits?.mentoring ?? prev.capacity?.limits?.mentoring ?? 0),
          ultimate: Number(body.capacity?.limits?.ultimate ?? prev.capacity?.limits?.ultimate ?? 0)
        }
      },
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
