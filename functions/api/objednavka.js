// functions/api/objednavka.js

const REQUIRED_CONTACT = ['Jmeno', 'Email', 'Telefon', 'Ulice', 'Mesto', 'PSC', 'Zeme'];
const REQUIRED_ANALYSIS = ['Vek', 'Pohlavi', 'Vyska_cm', 'Vaha_kg'];

async function getFakturoidToken(clientId, clientSecret, userAgent) {
  const credentials = btoa(`${clientId.trim()}:${clientSecret.trim()}`);
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
    throw new Error(`OAuth selhal (${res.status}): ${errText}`);
  }
  const data = await res.json();
  return data.access_token;
}

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
    throw new Error(`Kontakt selhal (${createRes.status}): ${errText}`);
  }

  const created = await createRes.json();
  return created.id;
}

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
    throw new Error(`Faktura selhala (${invoiceRes.status}): ${errText}`);
  }

  return await invoiceRes.json();
}

export async function onRequestPost(context) {
  try {
    const body = await context.request.json();
    const isGift = body.Je_darek === 'ano' || body.Koupit_jako_darek === 'ano';

    const requiredFields = isGift
      ? REQUIRED_CONTACT
      : [...REQUIRED_CONTACT, ...REQUIRED_ANALYSIS];

    for (const field of requiredFields) {
      if (!body[field] || String(body[field]).trim() === '') {
        return new Response(JSON.stringify({ ok: false, error: `Chybí pole: ${field}` }), {
          status: 400,
          headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });
      }
    }

    const slug = context.env.FAKTUROID_SLUG || 'krystofkoblas';
    const clientId = context.env.FAKTUROID_CLIENT_ID;
    const clientSecret = context.env.FAKTUROID_CLIENT_SECRET;
    const userAgent = 'KKoblas Web (koblas.nutricni.info@gmail.com)';

    console.log('STAV PROMENNYCH:', {
      hasSlug: !!slug,
      slugValue: slug,
      hasClientId: !!clientId,
      hasClientSecret: !!clientSecret,
      hasResendKey: !!context.env.RESEND_API_KEY
    });

    let fakturoidInvoice = null;

    if (clientId && clientSecret) {
      try {
        console.log('1. Žádám Fakturoid OAuth token...');
        const fToken = await getFakturoidToken(clientId, clientSecret, userAgent);
        console.log('2. Hledám/zakládám kontakt...');
        const subjectId = await getOrCreateSubject(slug, fToken, body, userAgent);
        console.log('3. Vystavuji proforma fakturu...');
        fakturoidInvoice = await createProformaInvoice(slug, fToken, subjectId, body, isGift, userAgent);
        console.log('ÚSPĚCH! Faktura vytvořena s ID:', fakturoidInvoice.id);
      } catch (faktErr) {
        console.error('FAKTUROID CHYBA:', faktErr.message);
      }
    } else {
      console.warn('VAROVÁNÍ: Chybí FAKTUROID_CLIENT_ID nebo FAKTUROID_CLIENT_SECRET!');
    }

    return new Response(JSON.stringify({ ok: true, invoiceId: fakturoidInvoice?.id || null }), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });

  } catch (err) {
    console.error('HLAVNÍ CHYBA:', err.message);
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  }
}
