// functions/api/objednavka.js

const REQUIRED_CONTACT = ['Jmeno', 'Email', 'Telefon', 'Ulice', 'Mesto', 'PSC', 'Zeme'];
const REQUIRED_ANALYSIS = ['Vek', 'Pohlavi', 'Vyska_cm', 'Vaha_kg'];

// 1. Získání OAuth2 tokenu z Fakturoid API v3
async function getFakturoidToken(clientId, clientSecret, userAgent) {
  const credentials = btoa(`${clientId}:${clientSecret}`);
  const res = await fetch('https://app.fakturoid.cz/api/v3/oauth/token', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/json',
      'User-Agent': userAgent
    },
    body: JSON.stringify({ grant_type: 'client_credentials' })
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Fakturoid OAuth selhal (${res.status}): ${errText}`);
  }
  const data = await res.json();
  return data.access_token;
}

// 2. Vyhledání nebo vytvoření kontaktu ve Fakturoidu
async function getOrCreateSubject(slug, token, body, userAgent) {
  const searchRes = await fetch(
    `https://app.fakturoid.cz/api/v3/accounts/${slug}/subjects.json?query=${encodeURIComponent(body.Email)}`,
    {
      headers: {
        'Authorization': `Bearer ${token}`,
        'User-Agent': userAgent
      }
    }
  );

  if (searchRes.ok) {
    const existing = await searchRes.json();
    const match = existing.find(s => s.email && s.email.toLowerCase() === body.Email.toLowerCase());
    if (match) return match.id;
  }

  const subjectPayload = {
    name: body.Jmeno,
    email: body.Email,
    phone: body.Telefon,
    street: body.Ulice,
    city: body.Mesto,
    zip: body.PSC,
    country: body.Zeme || 'CZ'
  };
  if (body.ICO) subjectPayload.registration_no = body.ICO;

  const createRes = await fetch(`https://app.fakturoid.cz/api/v3/accounts/${slug}/subjects.json`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': userAgent
    },
    body: JSON.stringify(subjectPayload)
  });

  if (!createRes.ok) {
    const errText = await createRes.text();
    throw new Error(`Chyba vytvoření kontaktu (${createRes.status}): ${errText}`);
  }

  const created = await createRes.json();
  return created.id;
}

// 3. Vystavení proformy ve Fakturoidu
async function createProformaInvoice(slug, token, subjectId, body, isGift, userAgent) {
  const rawPrice = String(body.Cena || '').replace(/[^\d]/g, '');
  const priceAmount = parseInt(rawPrice, 10) || 0;

  const invoicePayload = {
    subject_id: subjectId,
    document_type: 'proforma',
    lines: [
      {
        name: isGift ? `${body.Sluzba || 'Nutriční balíček'} (Dárkový poukaz)` : (body.Sluzba || 'Nutriční balíček'),
        quantity: 1,
        unit_price: priceAmount,
        unit_name: 'ks'
      }
    ],
    note: isGift ? 'Objednáno jako dárkový poukaz – voucher se odešle po úhradě.' : ''
  };

  const invoiceRes = await fetch(`https://app.fakturoid.cz/api/v3/accounts/${slug}/invoices.json`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': userAgent
    },
    body: JSON.stringify(invoicePayload)
  });

  if (!invoiceRes.ok) {
    const errText = await invoiceRes.text();
    throw new Error(`Vystavení proformy selhalo (${invoiceRes.status}): ${errText}`);
  }

  return await invoiceRes.json();
}

// Hlavní obsluha požadavku
export async function onRequestPost(context) {
  try {
    const body = await context.request.json();
    const isGift = body.Je_darek === 'ano' || body.Koupit_jako_darek === 'ano';

    const requiredFields = isGift
      ? REQUIRED_CONTACT
      : [...REQUIRED_CONTACT, ...REQUIRED_ANALYSIS];

    for (const field of requiredFields) {
      if (!body[field] || String(body[field]).trim() === '') {
        return new Response(JSON.stringify({ ok: false, error: `Chybí povinné pole: ${field}` }), {
          status: 400,
          headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });
      }
    }

    // A) Fakturoid integrace
    const slug = context.env.FAKTUROID_SLUG || 'krystofkoblas';
    const clientId = context.env.FAKTUROID_CLIENT_ID;
    const clientSecret = context.env.FAKTUROID_CLIENT_SECRET;
    const userAgent = `KKoblas Web (koblas.nutricni.info@gmail.com)`;
    let fakturoidInvoice = null;

    if (clientId && clientSecret) {
      try {
        const fToken = await getFakturoidToken(clientId, clientSecret, userAgent);
        const subjectId = await getOrCreateSubject(slug, fToken, body, userAgent);
        fakturoidInvoice = await createProformaInvoice(slug, fToken, subjectId, body, isGift, userAgent);
      } catch (faktErr) {
        console.error('Chyba Fakturoid:', faktErr.message);
      }
    }

    // B) Promo kód KV evidence
    const usedCode = (body.Pouzity_kod || '').trim();
    if (usedCode && context.env.STATUS_STORE) {
      try {
        const rawCodes = await context.env.STATUS_STORE.get('PROMO_CODES');
        if (rawCodes) {
          const codes = JSON.parse(rawCodes);
          const target = codes.find(c => c.code && c.code.trim().toUpperCase() === usedCode.toUpperCase());
          if (target) {
            target.usedCount = (Number(target.usedCount) || 0) + 1;
            if (target.oneTime) target.used = true;
            await context.env.STATUS_STORE.put('PROMO_CODES', JSON.stringify(codes));
          }
        }
      } catch (kvErr) {
        console.error('Chyba při aktualizaci kódu v KV:', kvErr);
      }
    }

    // C) E-maily přes Resend
    const resendKey = context.env.RESEND_API_KEY;
    const fromDomain = context.env.FROM_DOMAIN || 'koblas-nutricni.cz';

    if (resendKey) {
      const proformaInfo = fakturoidInvoice?.html_url 
        ? `<p>Zálohovou fakturu k úhradě najdeš zde: <a href="${fakturoidInvoice.html_url}" style="color:#ff9900;">Zobrazit proforma fakturu</a></p>`
        : '';

      const emailHtmlClient = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; color: #222; line-height: 1.6;">
          <h2 style="color: #ff9900;">Ahoj ${body.Jmeno},</h2>
          <p>děkuji za tvou objednávku služby <strong>${body.Sluzba || 'Nutriční poradenství'}</strong>!</p>
          ${proformaInfo}
          <p>Po připsání platby obdržíš potvrzení a domluvíme další kroky.</p>
          ${isGift ? '<p>🎁 <em>Voucher s unikátním kódem ti dorazí automaticky po zaplacení.</em></p>' : ''}
          <br>
          <p>S pozdravem,<br><strong>Kryštof Koblas</strong><br>Nutriční poradce<br><a href="https://koblas-nutricni.cz" style="color: #ff9900;">koblas-nutricni.cz</a></p>
        </div>
      `;

      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: `Kryštof Koblas <info@${fromDomain}>`,
          to: [body.Email],
          subject: `Objednávka – ${body.Sluzba || 'KKoblas'}`,
          html: emailHtmlClient
        })
      });
    }

    return new Response(JSON.stringify({ ok: true, invoice: fakturoidInvoice ? fakturoidInvoice.id : null }), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });

  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err.message || 'Server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  }
}
