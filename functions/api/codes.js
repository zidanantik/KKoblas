// functions/api/codes.js

export async function onRequestGet(context) {
  try {
    const adminPass = context.request.headers.get('x-admin-pass');
    const storedPass = context.env.ADMIN_PASS;

    const raw = await context.env.STATUS_STORE.get('PROMO_CODES');
    const codes = raw ? JSON.parse(raw) : [];

    // Administrace: vrací všechny kódy
    if (adminPass && adminPass === storedPass) {
      return new Response(JSON.stringify(codes), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Veřejné ověření kódu
    const url = new URL(context.request.url);
    const codeParam = (url.searchParams.get('code') || '').trim().toUpperCase();
    const pkgParam = (url.searchParams.get('package') || '').trim().toLowerCase();

    if (!codeParam) {
      return new Response(JSON.stringify({ valid: false, message: 'Chybí kód.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const found = codes.find(c => c.code && c.code.toUpperCase() === codeParam);
    if (!found || found.active === false) {
      return new Response(JSON.stringify({ valid: false, message: 'Neplatný nebo neaktivní kód.' }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (found.oneTime && found.used) {
      return new Response(JSON.stringify({ valid: false, message: 'Tento kód již byl uplatněn.' }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const allowedPkgs = (found.packages || []).map(p => p.toLowerCase());

    // Pokud uživatel rovnou poslal balíček (objednávka) a nepatří tam:
    if (pkgParam && allowedPkgs.length > 0 && !allowedPkgs.includes(pkgParam)) {
      return new Response(JSON.stringify({ valid: false, message: 'Tento kód nelze uplatnit na balíček ' + pkgParam.toUpperCase() + '.' }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Vrací data včetně povolených balíčků!
    return new Response(JSON.stringify({
      valid: true,
      code: found.code,
      type: found.type,
      value: found.value,
      packages: allowedPkgs
    }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (err) {
    return new Response(JSON.stringify({ valid: false, message: 'Chyba serveru: ' + err.message }), {
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
    const raw = await context.env.STATUS_STORE.get('PROMO_CODES');
    let codes = raw ? JSON.parse(raw) : [];

    // Přepnutí stavu aktivní/neaktivní
    if (body.id && body.active !== undefined) {
      const idx = codes.findIndex(c => c.id === body.id);
      if (idx > -1) {
        codes[idx].active = body.active;
        await context.env.STATUS_STORE.put('PROMO_CODES', JSON.stringify(codes));
        return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ ok: false, error: 'Nenalezeno' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }

    // Vytvoření / aktualizace kódu
    const newCode = {
      id: crypto.randomUUID(),
      code: (body.code || '').trim().toUpperCase(),
      type: body.type || 'percent',
      value: body.type === 'gift' ? 100 : Number(body.value || 0),
      oneTime: !!body.oneTime,
      packages: (body.packages || []).map(p => p.toLowerCase()),
      active: true,
      used: false,
      createdAt: new Date().toISOString()
    };

    codes = codes.filter(c => c.code.toUpperCase() !== newCode.code);
    codes.unshift(newCode);

    await context.env.STATUS_STORE.put('PROMO_CODES', JSON.stringify(codes));
    return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });

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
    const raw = await context.env.STATUS_STORE.get('PROMO_CODES');
    let codes = raw ? JSON.parse(raw) : [];

    codes = codes.filter(c => c.id !== body.id);
    await context.env.STATUS_STORE.put('PROMO_CODES', JSON.stringify(codes));

    return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });

  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
