// functions/api/codes.js

// 1. GET: Načítanie všetkých kódov (pre admin) ALEBO overenie jedného kódu (pre objednávku)
export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const adminPass = request.headers.get("x-admin-pass");

  // A) Volanie z Admin panelu (overené heslom ADMIN_PASS)
  if (adminPass && adminPass === env.ADMIN_PASS) {
    const raw = await env.STATUS_STORE.get("PROMO_CODES");
    const codes = raw ? JSON.parse(raw) : [];
    return new Response(JSON.stringify(codes), {
      headers: { "Content-Type": "application/json" }
    });
  }

  // B) Verejné volanie z objednávky (overenie jedného zadaného kódu)
  const codeQuery = url.searchParams.get("code");
  const packageQuery = url.searchParams.get("package"); // napr. "startup", "mentoring", "ultimate"

  if (!codeQuery) {
    return new Response(JSON.stringify({ error: "Chýba kód." }), { status: 400 });
  }

  const raw = await env.STATUS_STORE.get("PROMO_CODES");
  const codes = raw ? JSON.parse(raw) : [];
  const found = codes.find(c => c.code.toUpperCase() === codeQuery.trim().toUpperCase());

  if (!found || !found.active) {
    return new Response(JSON.stringify({ valid: false, message: "Kód neexistuje alebo už nie je aktívny." }), {
      headers: { "Content-Type": "application/json" }
    });
  }

  if (found.oneTime && found.used) {
    return new Response(JSON.stringify({ valid: false, message: "Tento jednorazový kód už bol uplatnený." }), {
      headers: { "Content-Type": "application/json" }
    });
  }

  if (packageQuery && found.packages && found.packages.length > 0) {
    const isApplicable = found.packages.includes(packageQuery.toLowerCase());
    if (!isApplicable) {
      return new Response(JSON.stringify({ valid: false, message: "Tento kód nie je možné uplatniť na vybraný balíček." }), {
        headers: { "Content-Type": "application/json" }
      });
    }
  }

  return new Response(JSON.stringify({
    valid: true,
    code: found.code,
    type: found.type, // "percent" | "fixed" | "gift"
    value: found.value,
    isGift: found.type === "gift"
  }), {
    headers: { "Content-Type": "application/json" }
  });
}

// 2. POST: Uloženie alebo aktualizácia kódu z adminu
export async function onRequestPost(context) {
  const { request, env } = context;
  const adminPass = request.headers.get("x-admin-pass");

  if (!adminPass || adminPass !== env.ADMIN_PASS) {
    return new Response(JSON.stringify({ error: "Neautorizovaný prístup." }), { status: 401 });
  }

  const payload = await request.json();
  const raw = await env.STATUS_STORE.get("PROMO_CODES");
  let codes = raw ? JSON.parse(raw) : [];

  const existingIndex = codes.findIndex(c => c.id === payload.id || c.code.toUpperCase() === payload.code.trim().toUpperCase());

  if (existingIndex > -1) {
    codes[existingIndex] = { ...codes[existingIndex], ...payload };
  } else {
    codes.push({
      id: Date.now().toString(),
      code: payload.code.trim().toUpperCase(),
      type: payload.type || "percent",
      value: payload.type === "gift" ? 100 : Number(payload.value) || 0,
      packages: payload.packages || ["startup", "mentoring", "ultimate"],
      oneTime: Boolean(payload.oneTime),
      used: false,
      active: true,
      createdAt: new Date().toISOString()
    });
  }

  await env.STATUS_STORE.put("PROMO_CODES", JSON.stringify(codes));

  return new Response(JSON.stringify({ success: true, codes }), {
    headers: { "Content-Type": "application/json" }
  });
}

// 3. DELETE: Zmazanie kódu z databázy
export async function onRequestDelete(context) {
  const { request, env } = context;
  const adminPass = request.headers.get("x-admin-pass");

  if (!adminPass || adminPass !== env.ADMIN_PASS) {
    return new Response(JSON.stringify({ error: "Neautorizovaný prístup." }), { status: 401 });
  }

  const { id } = await request.json();
  const raw = await env.STATUS_STORE.get("PROMO_CODES");
  let codes = raw ? JSON.parse(raw) : [];

  codes = codes.filter(c => c.id !== id);
  await env.STATUS_STORE.put("PROMO_CODES", JSON.stringify(codes));

  return new Response(JSON.stringify({ success: true, codes }), {
    headers: { "Content-Type": "application/json" }
  });
}
