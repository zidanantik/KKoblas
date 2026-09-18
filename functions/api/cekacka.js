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

    if (!body.Jmeno || !body.Email) {
      return new Response(JSON.stringify({ ok: false, error: 'Chybí jméno nebo e-mail' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const RESEND_KEY  = context.env.RESEND_API_KEY;
    const FROM_DOMAIN = context.env.FROM_DOMAIN || 'onboarding@resend.dev';
    const OWNER_EMAIL = 'koblas.nutricni@gmail.com';

    const zajem = Array.isArray(body.Zajem)
      ? body.Zajem.join(', ')
      : (body.Zajem || '—');

    const htmlOwner = `
      <h2 style="font-family:sans-serif">Nový zájemce z čekací listiny – KKoblas</h2>
      <table style="border-collapse:collapse;width:100%;font-family:sans-serif">
        <tr><td colspan="2" style="background:#1a1a1a;color:#fff;padding:12px 16px;font-weight:bold">Kontakt</td></tr>
        <tr><td style="padding:8px 16px;border-bottom:1px solid #eee;color:#666;width:40%">Jméno</td><td style="padding:8px 16px;border-bottom:1px solid #eee">${body.Jmeno}</td></tr>
        <tr><td style="padding:8px 16px;border-bottom:1px solid #eee;color:#666">E-mail</td><td style="padding:8px 16px;border-bottom:1px solid #eee">${body.Email}</td></tr>
        <tr><td style="padding:8px 16px;border-bottom:1px solid #eee;color:#666">Telefon</td><td style="padding:8px 16px;border-bottom:1px solid #eee">${body.Telefon || '—'}</td></tr>
        <tr><td style="padding:8px 16px;color:#666">Zájem o</td><td style="padding:8px 16px">${zajem}</td></tr>
      </table>
    `;

    const htmlClient = `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
        <div style="background:#1a1a1a;padding:32px;text-align:center">
          <h1 style="color:#fff;margin:0;font-size:24px">Kryštof Koblas</h1>
          <p style="color:#aaa;margin:8px 0 0">Nutriční poradenství</p>
        </div>
        <div style="padding:32px;background:#fff">
          <h2 style="margin-top:0">Ahoj ${body.Jmeno.split(' ')[0]}!</h2>
          <p>Zapsal jsem tě na čekací listinu. Jakmile se uvolní místo a budu nabírat nové klienty, ozvu se ti jako jednomu z prvních.</p>
          <p>Žádný spam — napíšu ti jen jednou.</p>
          <p style="margin-bottom:0">Kryštof Koblas</p>
        </div>
        <div style="background:#f5f5f5;padding:16px;text-align:center">
          <p style="margin:0;color:#999;font-size:12px">© 2026 Kryštof Koblas – Nutriční poradenství</p>
        </div>
      </div>
    `;

    const [resOwner, resClient] = await Promise.all([
      sendEmail(RESEND_KEY, {
        from: FROM_DOMAIN,
        to: [OWNER_EMAIL],
        subject: `Čekací listina – ${body.Jmeno}`,
        html: htmlOwner
      }),
      sendEmail(RESEND_KEY, {
        from: FROM_DOMAIN,
        to: [body.Email],
        reply_to: 'koblas.nutricni.info@gmail.com',
        subject: 'Zapsali jsme tě na čekací listinu – Kryštof Koblas',
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
