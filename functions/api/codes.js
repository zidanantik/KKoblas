// functions/api/codes.js

export async function onRequestGet(context) {
  try {
    // Bezpečná ochrana: pokud binding chybí, nespadneme, ale vrátíme prázdné kódy
    const store = context.env.STATUS_STORE;
    const raw = store ? await store.get('PROMO_CODES') : null;
    const codes = raw ? JSON.parse(raw) : [];

    const adminPass = context.request.headers.get('x-admin-pass');
    const storedPass = context.env.ADMIN_PASS;

    // Administrace: vrací všechny kódy včetně počítadla
    if (adminPass && adminPass === storedPass) {
      return new Response(JSON.stringify(codes), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Veřejné ověření kódu
    const url = new URL(context.request.url);
    const codeParam = (url.searchParams.get('code') || '').trim().toUpperCase();
    const pkgParam = (url.searchParams.get('package') || '').trim().toLowerCase();
    const modeSplatky = url.searchParams.get('splatky') === 'true';
    const modeDarek = url.searchParams.get('darek') === '1' || url.searchParams.get('darek') === 'true';

    if (!codeParam) {
      return new Response(JSON.stringify({ valid: false, message: 'Chybí kód.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const found = codes.find(c => c.code && c.code.trim().toUpperCase() === codeParam);
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

    // Validace typu platby (splátky vs. jednorázově)
    if (found.splatky && url.searchParams.has('splatky') && !modeSplatky) {
      return new Response(JSON.stringify({ valid: false, message: 'Tento kód platí pouze pro platbu na splátky.' }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    if (!found.splatky && url.searchParams.has('splatky') && modeSplatky) {
      return new Response(JSON.stringify({ valid: false, message: 'Tento kód nelze uplatnit na splátky.' }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Validace dárkového kódu (pouze pro dárkový voucher)
    if (found.darekOnly && url.searchParams.has('darek') && !modeDarek) {
      return new Response(JSON.stringify({ valid: false, message: 'Tento kód lze uplatnit výhradně na nákup dárkového poukazu.' }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const allowedPkgs = (found.packages || []).map(p => p.toLowerCase());

    if (pkgParam && allowedPkgs.length > 0 && !allowedPkgs.includes(pkgParam)) {
      return new Response(JSON.stringify({ valid: false, message: 'Tento kód nelze uplatnit na balíček ' + pkgParam.toUpperCase() + '.' }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({
      valid: true,
      code: found.code,
      type: found.type,
      value: found.value,
      splatky: !!found.splatky,
      darekOnly: !!found.darekOnly,
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
    const store = context.env.STATUS_STORE;
    const body = await context.request.json();
    const raw = store ? await store.get('PROMO_CODES') : null;
    let codes = raw ? JSON.parse(raw) : [];

    // ── 1. VEŘEJNÉ PŘIČTENÍ POUŽITÍ KÓDU PO OBJEDNÁVCE (+1) ──
    if (body.action === 'redeem' && body.code) {
      const codeUpper = body.code.trim().toUpperCase();
      const target = codes.find(c => c.code && c.code.trim().toUpperCase() === codeUpper);
      if (target) {
        target.usedCount = (Number(target.usedCount) || 0) + 1;
        if (target.oneTime) {
          target.used = true;
        }
        if (store) {
          await store.put('PROMO_CODES', JSON.stringify(codes));
        }
        return new Response(JSON.stringify({ ok: true, usedCount: target.usedCount }), {
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return new Response(JSON.stringify({ ok: false, error: 'Kód nenalezen' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // ── 2. ADMINISTRACE (vyžaduje ADMIN_PASS) ──
    const adminPass = context.request.headers.get('x-admin-pass');
    const storedPass = context.env.ADMIN_PASS;

    if (!adminPass || adminPass !== storedPass) {
      return new Response(JSON.stringify({ ok: false, error: 'Neautorizováno' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Přepnutí stavu aktivní/neaktivní
    if (body.id && body.active !== undefined) {
      const idx = codes.findIndex(c => c.id === body.id);
      if (idx > -1) {
        codes[idx].active = body.active;
        if (store) {
          await store.put('PROMO_CODES', JSON.stringify(codes));
        }
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
      splatky: !!body.splatky,
      darekOnly: !!body.darekOnly,
      packages: (body.packages || []).map(p => p.toLowerCase()),
      active: true,
      used: false,
      usedCount: 0,
      createdAt: new Date().toISOString()
    };

    codes = codes.filter(c => c.code.toUpperCase() !== newCode.code);
    codes.unshift(newCode);

    if (store) {
      await store.put('PROMO_CODES', JSON.stringify(codes));
    }
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

    const store = context.env.STATUS_STORE;
    const body = await context.request.json();
    const raw = store ? await store.get('PROMO_CODES') : null;
    let codes = raw ? JSON.parse(raw) : [];

    codes = codes.filter(c => c.id !== body.id);
    if (store) {
      await store.put('PROMO_CODES', JSON.stringify(codes));
    }

    return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });

  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
