const REQUIRED = ['Jmeno', 'Email', 'Telefon', 'Ulice', 'Mesto', 'PSC', 'Zeme', 'Vek', 'Pohlavi', 'Vyska_cm', 'Vaha_kg'];

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

    for (const field of REQUIRED) {
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

    // Email pro Kryštofa — přehled objednávky
    const htmlOwner = `
      <h2 style="font-family:sans-serif">Nová objednávka – ${body.Sluzba || 'KKoblas'}</h2>
      <table style="border-collapse:collapse;width:100%;font-family:sans-serif">
        <tr><td colspan="2" style="background:#1a1a1a;color:#fff;padding:12px 16px;font-weight:bold">Objednávka</td></tr>
        <tr><td style="padding:8px 16px;border-bottom:1px solid #eee;color:#666;width:40%">Služba</td><td style="padding:8px 16px;border-bottom:1px solid #eee">${body.Sluzba || '—'}</td></tr>
        <tr><td style="padding:8px 16px;border-bottom:1px solid #eee;color:#666">Platba</td><td style="padding:8px 16px;border-bottom:1px solid #eee">${body.Platba || '—'}</td></tr>
        <tr><td style="padding:8px 16px;border-bottom:1px solid #eee;color:#666">Cena</td><td style="padding:8px 16px;border-bottom:1px solid #eee"><strong>${body.Cena || '—'}</strong></td></tr>
        <tr><td colspan="2" style="background:#1a1a1a;color:#fff;padding:12px 16px;font-weight:bold">Kontakt</td></tr>
        <tr><td style="padding:8px 16px;border-bottom:1px solid #eee;color:#666">Jméno</td><td style="padding:8px 16px;border-bottom:1px solid #eee">${body.Jmeno}</td></tr>
        <tr><td style="padding:8px 16px;border-bottom:1px solid #eee;color:#666">E-mail</td><td style="padding:8px 16px;border-bottom:1px solid #eee">${body.Email}</td></tr>
        <tr><td style="padding:8px 16px;border-bottom:1px solid #eee;color:#666">Telefon</td><td style="padding:8px 16px;border-bottom:1px solid #eee">${body.Telefon}</td></tr>
        <tr><td style="padding:8px 16px;border-bottom:1px solid #eee;color:#666">Adresa</td><td style="padding:8px 16px;border-bottom:1px solid #eee">${body.Ulice}, ${body.Mesto} ${body.PSC}, ${body.Zeme}</td></tr>
        ${body.ICO ? `<tr><td style="padding:8px 16px;border-bottom:1px solid #eee;color:#666">IČO/DIČ</td><td style="padding:8px 16px;border-bottom:1px solid #eee">${body.ICO}</td></tr>` : ''}
        <tr><td colspan="2" style="background:#1a1a1a;color:#fff;padding:12px 16px;font-weight:bold">Analýza</td></tr>
        <tr><td style="padding:8px 16px;border-bottom:1px solid #eee;color:#666">Věk</td><td style="padding:8px 16px;border-bottom:1px solid #eee">${body.Vek} let</td></tr>
        <tr><td style="padding:8px 16px;border-bottom:1px solid #eee;color:#666">Pohlaví</td><td style="padding:8px 16px;border-bottom:1px solid #eee">${body.Pohlavi}</td></tr>
        <tr><td style="padding:8px 16px;border-bottom:1px solid #eee;color:#666">Výška</td><td style="padding:8px 16px;border-bottom:1px solid #eee">${body.Vyska_cm} cm</td></tr>
        <tr><td style="padding:8px 16px;border-bottom:1px solid #eee;color:#666">Váha</td><td style="padding:8px 16px;border-bottom:1px solid #eee">${body.Vaha_kg} kg</td></tr>
        ${body.Obvod_boku_cm ? `<tr><td style="padding:8px 16px;border-bottom:1px solid #eee;color:#666">Obvod boků</td><td style="padding:8px 16px;border-bottom:1px solid #eee">${body.Obvod_boku_cm} cm</td></tr>` : ''}
        ${body.Obvod_pasu_cm ? `<tr><td style="padding:8px 16px;border-bottom:1px solid #eee;color:#666">Obvod pasu</td><td style="padding:8px 16px;border-bottom:1px solid #eee">${body.Obvod_pasu_cm} cm</td></tr>` : ''}
        ${body.Motivace ? `<tr><td style="padding:8px 16px;border-bottom:1px solid #eee;color:#666">Motivace</td><td style="padding:8px 16px;border-bottom:1px solid #eee">${body.Motivace}</td></tr>` : ''}
        <tr><td colspan="2" style="background:#1a1a1a;color:#fff;padding:12px 16px;font-weight:bold">Souhlasy</td></tr>
        <tr><td style="padding:8px 16px;color:#666">Anonymní použití výsledků</td><td style="padding:8px 16px">${body.Souhlas_anonymni === 'ano' ? '✅ Ano' : '❌ Ne'}</td></tr>
      </table>
    `;

    // Potvrzovací email pro klienta
    const htmlClient = `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
        <div style="background:#1a1a1a;padding:32px;text-align:center">
          <h1 style="color:#fff;margin:0;font-size:24px">Kryštof Koblas</h1>
          <p style="color:#aaa;margin:8px 0 0">Nutriční poradenství</p>
        </div>
        <div style="padding:32px;background:#fff">
          <h2 style="margin-top:0">Ahoj! Tvoje objednávka dorazila.</h2>
          <p>Děkuji za důvěru. Přijal jsem tvoji žádost o službu <strong>${body.Sluzba || 'KKoblas'}</strong> a ozvu se ti do <strong>2 pracovních dnů</strong> s fakturou a dalšími kroky.</p>
          <div style="background:#f5f5f5;border-radius:8px;padding:20px;margin:24px 0">
            <p style="margin:0 0 8px;color:#666;font-size:14px">Shrnutí objednávky</p>
            <p style="margin:0;font-size:18px;font-weight:bold">${body.Sluzba || '—'}</p>
            <p style="margin:4px 0 0;color:#666">${body.Platba || ''} — <strong>${body.Cena || ''}</strong></p>
          </div>
          <p>Pokud máš jakýkoli dotaz, napiš mi na <a href="mailto:${CLIENT_CONTACT_EMAIL}" style="color:#1a1a1a">${CLIENT_CONTACT_EMAIL}</a>.</p>
          <p style="margin-bottom:0">Těším se na spolupráci,<br><strong>Kryštof Koblas</strong></p>
        </div>
        <div style="background:#f5f5f5;padding:16px;text-align:center">
          <p style="margin:0;color:#999;font-size:12px">© 2026 Kryštof Koblas – Nutriční poradenství</p>
        </div>
      </div>
    `;

    // Pošli oba emaily paralelně
    const [resOwner, resClient] = await Promise.all([
      sendEmail(RESEND_KEY, {
        from: FROM_DOMAIN,
        to: [OWNER_EMAIL],
        subject: `Nová objednávka – ${body.Sluzba || 'KKoblas'}`,
        html: htmlOwner
      }),
      sendEmail(RESEND_KEY, {
       from: FROM_DOMAIN,
       to: [body.Email],
       reply_to: CLIENT_CONTACT_EMAIL,
       subject: 'Přijali jsme tvoji objednávku – Kryštof Koblas',
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
