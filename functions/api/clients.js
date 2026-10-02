// functions/api/clients.js

function computeEndDate(startDateStr, pkgName) {
  if (!startDateStr) return null;
  const d = new Date(startDateStr);
  const s = String(pkgName || '').toLowerCase();
  let months = 1;
  if (s.includes('ultimate')) months = 6;
  else if (s.includes('mentor')) months = 4;
  else months = 1;

  d.setMonth(d.getMonth() + months);
  return d.toISOString().split('T')[0];
}

export async function onRequestGet(context) {
  try {
    const adminPass = context.request.headers.get('x-admin-pass');
    const storedPass = context.env.ADMIN_PASS;

    if (!adminPass || adminPass !== storedPass) {
      return new Response(JSON.stringify({ ok: false, error: 'Neautorizováno' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const store = context.env.STATUS_STORE;
    const rawClients = store ? await store.get('CLIENTS') : null;
    let clients = rawClients ? JSON.parse(rawClients) : [];

    const todayStr = new Date().toISOString().split('T')[0];

    // Doplnění výchozích dat, pokud chybí
    let changed = false;
    clients.forEach(c => {
      if (!c.id) {
        c.id = c.fakturoid_id ? String(c.fakturoid_id) : crypto.randomUUID();
        changed = true;
      }
      if (c.status === 'aktivni' && !c.start_date) {
        c.start_date = c.datum_platby ? c.datum_platby.split('T')[0] : todayStr;
        c.end_date = computeEndDate(c.start_date, c.sluzba_nazev || c.sluzba);
        changed = true;
      }
    });

    if (changed && store) {
      await store.put('CLIENTS', JSON.stringify(clients));
    }

    return new Response(JSON.stringify(clients), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

export async function onRequestPost(context) {
  try {
    const adminPass = context.request.headers.get('x-admin-pass');
    const storedPass = context.env.ADMIN_PASS;

    if (!adminPass || adminPass !== storedPass) {
      return new Response(JSON.stringify({ ok: false, error: 'Neautorizováno' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const body = await context.request.json();
    const store = context.env.STATUS_STORE;
    const rawClients = store ? await store.get('CLIENTS') : null;
    let clients = rawClients ? JSON.parse(rawClients) : [];

    const idx = clients.findIndex(c => String(c.id || c.fakturoid_id) === String(body.id));
    if (idx === -1) {
      return new Response(JSON.stringify({ ok: false, error: 'Klient nenalezen' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Aktualizace termínů nebo stavu
    if (body.start_date !== undefined) clients[idx].start_date = body.start_date;
    if (body.end_date !== undefined) clients[idx].end_date = body.end_date;
    if (body.status !== undefined) clients[idx].status = body.status;
    if (body.note !== undefined) clients[idx].admin_note = body.note;

    await store.put('CLIENTS', JSON.stringify(clients));

    return new Response(JSON.stringify({ ok: true, client: clients[idx] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

export async function onRequestDelete(context) {
  try {
    const adminPass = context.request.headers.get('x-admin-pass');
    const storedPass = context.env.ADMIN_PASS;

    if (!adminPass || adminPass !== storedPass) {
      return new Response(JSON.stringify({ ok: false, error: 'Neautorizováno' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const body = await context.request.json();
    const store = context.env.STATUS_STORE;
    const rawClients = store ? await store.get('CLIENTS') : null;
    let clients = rawClients ? JSON.parse(rawClients) : [];

    clients = clients.filter(c => String(c.id || c.fakturoid_id) !== String(body.id));
    await store.put('CLIENTS', JSON.stringify(clients));

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
