// functions/api/objednavka.js

const REQUIRED_CONTACT = ['Jmeno', 'Email', 'Telefon', 'Ulice', 'Mesto', 'PSC', 'Zeme'];
const REQUIRED_ANALYSIS = ['Vek', 'Pohlavi', 'Vyska_cm', 'Vaha_kg'];

async function sendEmail(key, { from, to, subject, html, reply_to }) {
  return fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to, subject, html, reply_to })
  });
}

export async function onRequestPost(context) {
  try {
    const body = await context.request.json();

    const isGift = body.Je_darek === 'ano' || body.Koupit_jako_darek === 'ano';

    // Pro nákup dárku nevyžadujeme míry obdarovaného
    const requiredFields = isGift 
      ? REQUIRED_CONTACT 
      : [...REQUIRED_CONTACT, ...REQUIRED_ANALYSIS];

    for (const field of requiredFields) {
      if (!body[field]) {
        return new Response(JSON.stringify({ ok: false, error: `Chybí pole: ${field}` }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    const RESEND_KEY   = context.env.RESEND_API_KEY;
    const FROM_DOMAIN  = context.env.FROM_DOMAIN || 'onboarding@resend.dev';
    const OWNER_EMAIL  = 'koblas.nutricni@gmail.com';
    const CLIENT_CONTACT_EMAIL = 'koblas.nutricni.info@gmail.com';

    // ── 1. Zneplatnění jednorázového kódu v KV ──────
    if (body.Pouzity_kod && context.env.STATUS_STORE) {
      try {
        const raw = await context.env.STATUS_STORE.get('PROMO_CODES');
        let codes = raw ? JSON.parse(raw) : [];
        const codeIdx = codes.findIndex(c => c.code.toUpperCase() === body.Pouzity_kod.trim().toUpperCase());

        if (codeIdx > -1 && codes[codeIdx].oneTime) {
          codes[codeIdx].used = true;
          codes[codeIdx].usedAt = new Date().toISOString();
          codes[codeIdx].usedBy = body.Email;
          await context.env.STATUS_STORE.put('PROMO_CODES', JSON.stringify(codes));
        }
      } catch (err) {
        console.error('Chyba při aktualizaci kódu v KV:', err);
      }
    }

    // ── 2. E-mail pro Kryštofa ──────────────────────
    const promoRow = body.Pouzity_kod 
      ? `<tr><td style="padding:8px 16px;border-bottom:1px solid #eee;color:#666">Uplatněný kód</td><td style="padding:8px 16px;border-bottom:1px solid #eee"><strong style="color:#ff9900">${body.Pouzity_kod}</strong> ${body.Sleva_info ? `<span style="color:#888">(${body.Sleva_info})</span>` : ''}</td></tr>` 
      : '';

    const giftRow = isGift 
      ? `<tr><td style="padding:8px 16px;border-bottom:1px solid #eee;color:#666">Režim objednávky</td><td style="padding:8px 16px;border-bottom:1px solid #eee"><span style="background:#ff9900;color:#000;padding:2px 8px;border-radius:4px;font-weight:bold;font-size:12px">🎁 DÁRKOVÝ POUKAZ</span></td></tr>` 
      : '';

    const analysisHtml = isGift 
      ? `<tr><td colspan="2" style="padding:12px 16px;border-bottom:1px solid #eee;color:#888;font-style:italic">Objednáno jako dárek – míry a zdravotní údaje vyplní obdarovaný sám při uplatnění dárkového poukazu na webu.</td></tr>`
      : `
        <tr><td style="padding:8px 16px;border-bottom:1px solid #eee;color:#666">Věk</td><td style="padding:8px 16px;border-bottom:1px solid #eee">${body.Vek} let</td></tr>
        <tr><td style="padding:8px 16px;border-bottom:1px solid #eee;color:#666">Pohlaví</td><td style="padding:8px 16px;border-bottom:1px solid #eee">${body.Pohlavi}</td></tr>
        <tr><td style="padding:8px 16px;border-bottom:1px solid #eee;color:#666">Výška</td><td style="padding:8px 16px;border-bottom:1px solid #eee">${body.Vyska_cm} cm</td></tr>
        <tr><td style="padding:8px 16px;border-bottom:1px solid #eee;color:#666">Váha</td><td style="padding:8px 16px;border-bottom:1px solid #eee">${body.Vaha_kg} kg</td></tr>
        ${body.Obvod_boku_cm ? `<tr><td style="padding:8px 16px;border-bottom:1px solid #eee;color:#666">Obvod boků</td><td style="padding:8px 16px;border-bottom:1px solid #eee">${body.Obvod_boku_cm} cm</td></tr>` : ''}
        ${body.Obvod_pasu_cm ? `<tr><td style="padding:8px 16px;border-bottom:1px solid #eee;color:#666">Obvod pasu</td><td style="padding:8px 16px;border-bottom:1px solid #eee">${body.Obvod_pasu_cm} cm</td></tr>` : ''}
        ${body.Motivace ? `<tr><td style="padding:8px 16px;border-bottom:1px solid #eee;color:#666">Motivace</td><td style="padding:8px 16px;border-bottom:1px solid #eee">${body.Motivace}</td></tr>` : ''}
      `;

    const htmlOwner = `
      <h2 style="font-family:sans-serif">Nová objednávka${isGift ? ' (🎁 DÁREK)' : ''} – ${body.Sluzba || 'KKoblas'}</h2>
      <table style="border-collapse:collapse;width:100%;font-family:sans-serif">
        <tr><td colspan="2" style="background:#1a1a1a;color:#fff;padding:12px 16px;font-weight:bold">Objednávka</td></tr>
        <tr><td style="padding:8px 16px;border-bottom:1px solid #eee;color:#666;width:40%">Služba</td><td style="padding:8px 16px;border-bottom:1px solid #eee">${body.Sluzba || '—'}</td></tr>
        <tr><td style="padding:8px 16px;border-bottom:1px solid #eee;color:#666">Platba</td><td style="padding:8px 16px;border-bottom:1px solid #eee">${body.Platba || '—'}</td></tr>
        <tr><td style="padding:8px 16px;border-bottom:1px solid #eee;color:#666">Cena</td><td style="padding:8px 16px;border-bottom:1px solid #eee"><strong>${body.Cena || '—'}</strong></td></tr>
        ${promoRow}
        ${giftRow}
        <tr><td colspan="2" style="background:#1a1a1a;color:#fff;padding:12px 16px;font-weight:bold">Fakturační údaje ${isGift ? '(Kupující)' : ''}</td></tr>
        <tr><td style="padding:8px 16px;border-bottom:1px solid #eee;color:#666">Jméno</td><td style="padding:8px 16px;border-bottom:1px solid #eee">${body.Jmeno}</td></tr>
        <tr><td style="padding:8px 16px;border-bottom:1px solid #eee;color:#666">E-mail</td><td style="padding:8px 16px;border-bottom:1px solid #eee">${body.Email}</td></tr>
        <tr><td style="padding:8px 16px;border-bottom:1px solid #eee;color:#666">Telefon</td><td style="padding:8px 16px;border-bottom:1px solid #eee">${body.Telefon}</td></tr>
        <tr><td style="padding:8px 16px;border-bottom:1px solid #eee;color:#666">Adresa</td><td style="padding:8px 16px;border-bottom:1px solid #eee">${body.Ulice}, ${body.Mesto} ${body.PSC}, ${body.Zeme}</td></tr>
        ${body.ICO ? `<tr><td style="padding:8px 16px;border-bottom:1px solid #eee;color:#666">IČO/DIČ</td><td style="padding:8px 16px;border-bottom:1px solid #eee">${body.ICO}</td></tr>` : ''}
        <tr><td colspan="2" style="background:#1a1a1a;color:#fff;padding:12px 16px;font-weight:bold">Analýza ${isGift ? '(Přeskočeno - dárek)' : ''}</td></tr>
        ${analysisHtml}
        <tr><td colspan="2" style="background:#1a1a1a;color:#fff;padding:12px 16px;font-weight:bold">Souhlasy</td></tr>
        <tr><td style="padding:8px 16px;color:#666">Anonymní použití výsledků</td><td style="padding:8px 16px">${body.Souhlas_anonymni === 'ano' ? '✅ Ano' : '❌ Ne'}</td></tr>
      </table>
    `;

    // ── 3. Potvrzovací e-mail pro klienta ────────────
    const clientIntro = isGift
      ? `<p>Děkuji za nákup dárkového poukazu na službu <strong>${body.Sluzba || 'KKoblas'}</strong>. Do <strong>2 pracovních dnů</strong> ti zašlu fakturu a dárkový certifikát s unikátním kódem pro obdarovaného.</p>`
      : `<p>Děkuji za důvěru. Přijal jsem tvoji žádost o službu <strong>${body.Sluzba || 'KKoblas'}</strong> a ozvu se ti do <strong>2 pracovních dnů</strong> s fakturou a dalšími kroky.</p>`;

    const htmlClient = `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
        <div style="background:#1a1a1a;padding:32px;text-align:center">
          <h1 style="color:#fff;margin:0;font-size:24px">Kryštof Koblas</h1>
          <p style="color:#aaa;margin:8px 0 0">Nutriční poradenství</p>
        </div>
        <div style="padding:32px;background:#fff">
          <h2 style="margin-top:0">Ahoj! Tvoje objednávka dorazila.</h2>
          ${clientIntro}
          <div style="background:#f5f5f5;border-radius:8px;padding:20px;margin:24px 0">
            <p style="margin:0 0 8px;color:#666;font-size:14px">Shrnutí objednávky ${isGift ? '(Dárkový poukaz)' : ''}</p>
            <p style="margin:0;font-size:18px;font-weight:bold">${body.Sluzba || '—'}</p>
            <p style="margin:4px 0 0;color:#666">${body.Platba || ''} — <strong>${body.Cena || ''}</strong></p>
            ${body.Pouzity_kod ? `<p style="margin:8px 0 0;font-size:13px;color:#ff9900">Uplatněný kód: <strong>${body.Pouzity_kod}</strong></p>` : ''}
          </div>
          <p>Pokud máš jakýkoli dotaz, napiš mi na <a href="mailto:${CLIENT_CONTACT_EMAIL}" style="color:#1a1a1a">${CLIENT_CONTACT_EMAIL}</a>.</p>
          <p style="margin-bottom:0">Těším se na spolupráci,<br><strong>Kryštof Koblas</strong></p>
        </div>
        <div style="background:#f5f5f5;padding:16px;text-align:center">
          <p style="margin:0;color:#999;font-size:12px">© 2026 Kryštof Koblas – Nutriční poradenství</p>
        </div>
      </div>
    `;

    // ── 4. Paralelní odeslání obou e-mailů ────────────
    const [resOwner, resClient] = await Promise.all([
      sendEmail(RESEND_KEY, {
        from: FROM_DOMAIN,
        to: [OWNER_EMAIL],
        subject: `Nová objednávka${isGift ? ' (🎁 DÁREK)' : ''} – ${body.Sluzba || 'KKoblas'}`,
        html: htmlOwner
      }),
      sendEmail(RESEND_KEY, {
        from: FROM_DOMAIN,
        to: [body.Email],
        reply_to: CLIENT_CONTACT_EMAIL,
        subject: isGift 
          ? 'Potvrzení objednávky dárkového poukazu – Kryštof Koblas' 
          : 'Přijali jsme tvoji objednávku – Kryštof Koblas',
        html: htmlClient
      })
    ]);

    if (!resOwner.ok) {
      const text = await resOwner.text();
      return new Response(JSON.stringify({ ok: false, error: text }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
