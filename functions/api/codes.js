// functions/api/codes.js

function normalizePkg(str) {
  if (!str) return '';
  const s = String(str).toLowerCase();
  if (s.includes('ultimate')) return 'ultimate';
  if (s.includes('mentor')) return 'mentoring';
  if (s.includes('start')) return 'startup';
  return s.trim();
}

export async function onRequestGet(context) {
  try {
    const store = context.env.STATUS_STORE;
    const raw = store ? await store.get('PROMO_CODES') : null;
    const codes = raw ? JSON.parse(raw) : [];

    const adminPass = context.request.headers.get('x-admin-pass');
    const storedPass = context.env.ADMIN_PASS;

    // Administrace: vrací všechny kódy včetně expirací a stavu banneru
    if (adminPass && adminPass === storedPass) {
      return new Response(JSON.stringify(codes), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const url = new URL(context.request.url);

    // ── Veřejné načtení aktivních kódů pro horní banner ──
    if (url.searchParams.get('banner') === '1') {
      const nowMs = Date.now();
      const bannerCodes = codes.filter(c => {
        if (!c.active || !c.showInBanner) return false;
        if (c.oneTime && c.used) return false;
        if (c.validUntil) {
          const expMs = new Date(c.validUntil).getTime();
          if (!isNaN(expMs) && expMs <= nowMs) return false;
        }
        return true;
      }).map(c => {
        let label = c.bannerLabel ? c.bannerLabel.trim() : '';
        if (!label) {
          const pkgs = (c.packages || []).map(p => normalizePkg(p)).filter(Boolean);
          const pkgMap = { startup: 'START-UP', mentoring: 'MENTORING', ultimate: 'ULTIMATE' };
          let scope = 'Všechny programy';
          if (pkgs.length === 1) {
            scope = pkgMap[pkgs[0]] || pkgs[0].toUpperCase();
          } else if (pkgs.length > 0 && pkgs.length < 3) {
            scope = pkgs.map(p => pkgMap[p] || p.toUpperCase()).join(' & ');
          }

          if (c.darekOnly) {
            label = (pkgs.length === 3 || pkgs.length === 0) ? 'Dárkové poukazy' : `Dárkový poukaz (${scope})`;
          } else if (c.splatky) {
            label = `${scope} (splátky)`;
          } else {
            label = `${scope} (jednorázově)`;
          }
        }

        return {
          code: c.code,
          label: label,
          validUntil: c.validUntil || null
        };
      });

      return new Response(JSON.stringify(bannerCodes), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
      });
    }

    // ── Veřejné ověření kódu v objednávkovém formuláři ──
    const codeParam = (url.searchParams.get('code') || '').trim().toUpperCase();
    const pkgParam = normalizePkg(url.searchParams.get('package') || url.searchParams.get('sluzba') || '');
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

    // Kontrola vypršení platnosti podle času
    if (found.validUntil) {
      const expMs = new Date(found.validUntil).getTime();
      if (!isNaN(expMs) && expMs <= Date.now()) {
        return new Response(JSON.stringify({ valid: false, message: 'Platnost tohoto slevového kódu již vypršela.' }), {
          headers: { 'Content-Type': 'application/json' }
        });
      }
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

    // Normalizace povolených balíčků
    const allowedPkgs = (found.packages || []).map(p => normalizePkg(p)).filter(Boolean);

    if (pkgParam && allowedPkgs.length > 0 && !allowedPkgs.includes(pkgParam)) {
      return new Response(JSON.stringify({ valid: false, message: 'Tento kód platí pouze pro balíček ' + allowedPkgs.join(', ').toUpperCase() + '.' }), {
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

    // Uplatnění kódu po dokončení objednávky
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

    // Administrace
    const adminPass = context.request.headers.get('x-admin-pass');
    const storedPass = context.env.ADMIN_PASS;

    if (!adminPass || adminPass !== storedPass) {
      return new Response(JSON.stringify({ ok: false, error: 'Neautorizováno' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Přepnutí stavu (aktivní / zobrazení v banneru)
    if (body.id && (body.active !== undefined || body.showInBanner !== undefined)) {
      const idx = codes.findIndex(c => c.id === body.id);
      if (idx > -1) {
        if (body.active !== undefined) codes[idx].active = body.active;
        if (body.showInBanner !== undefined) codes[idx].showInBanner = body.showInBanner;
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
      packages: (body.packages || []).map(p => normalizePkg(p)).filter(Boolean),
      showInBanner: !!body.showInBanner,
      validUntil: body.validUntil ? String(body.validUntil).trim() : null,
      bannerLabel: body.bannerLabel ? String(body.bannerLabel).trim() : '',
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
