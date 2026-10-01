// functions/api/objednavka.js

const REQUIRED_CONTACT = ['Jmeno', 'Email', 'Telefon', 'Ulice', 'Mesto', 'PSC', 'Zeme'];
const REQUIRED_ANALYSIS = ['Vek', 'Pohlavi', 'Vyska_cm', 'Vaha_kg'];

async function getFakturoidToken(clientId, clientSecret, userAgent) {
  const credentials = btoa(`${clientId.trim()}:${clientSecret.trim()}`);
  const res = await fetch('https://app.fakturoid.cz/api/v3/oauth/token.json', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
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
        'Accept': 'application/json',
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
      'Accept': 'application/json',
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

export async function onRequestPost(context) {
  try {
    const body = await context.request.json();
    const isGift = body.Je_darek === 'ano' || body.Koupit_jako_darek === 'ano';
    const isInstallment = body.Splatky === true || body.Splatky === 'true';

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

    const slug = 'krystofkoblas';
    const clientId = '4eec39db77ad7e5dc6da69e17153ffa50c8559d7';
    const clientSecret = '5cbf882f10ba944119cec3bf7d92527acb8ed990';
    const userAgent = 'KKoblas Web (koblas.nutricni.info@gmail.com)';

    console.log('--- FAKTUROID OBJEDNÁVKA START ---');

    const fToken = await getFakturoidToken(clientId, clientSecret, userAgent);
    const subjectId = await getOrCreateSubject(slug, fToken, body, userAgent);

    // Zpracování ceny a splátek
    const rawPrice = String(body.Cena || '').replace(/[^\d]/g, '');
    const totalPrice = parseInt(rawPrice, 10) || 0;
    const totalInstallments = isInstallment ? (parseInt(body.Mesice, 10) || 3) : 1;
    const installmentAmount = isInstallment ? Math.round(totalPrice / totalInstallments) : totalPrice;

    let lineName = body.Sluzba_Nazev || body.Sluzba || 'Nutriční balíček';
    if (isGift) {
      lineName += ' (Dárkový poukaz)';
    } else if (isInstallment) {
      lineName += ' – 1. splátka z ' + totalInstallments;
    }

    const invoicePayload = {
      subject_id: subjectId,
      document_type: 'proforma',
      lines: [
        {
          name: lineName,
          quantity: 1,
          unit_price: installmentAmount,
          unit_name: 'ks'
        }
      ],
      note: isGift 
        ? 'Objednáno jako dárkový poukaz – voucher se odešle po úhradě.' 
        : (isInstallment ? 'Splátková platba (1/' + totalInstallments + ')' : '')
    };

    const invoiceRes = await fetch(`https://app.fakturoid.cz/api/v3/accounts/${slug}/invoices.json`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${fToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': userAgent
      },
      body: JSON.stringify(invoicePayload)
    });

    if (!invoiceRes.ok) {
      const errText = await invoiceRes.text();
      throw new Error(`Faktura selhala (${invoiceRes.status}): ${errText}`);
    }

    const invoiceData = await invoiceRes.json();
    console.log('ÚSPĚCH! Proforma faktura vytvořena, ID:', invoiceData.id);

    // Uložení klienta do KV úložiště (`CLIENTS`), aby webhook věděl, co spárovat
    const store = context.env.STATUS_STORE;
    if (store) {
      const rawClients = await store.get('CLIENTS');
      let clients = rawClients ? JSON.parse(rawClients) : [];

      const newClientRecord = {
        fakturoid_id: invoiceData.id,
        status: 'ceka_na_platbu',
        sluzba: body.Sluzba || '',
        sluzba_nazev: body.Sluzba_Nazev || body.Sluzba || 'Nutriční program',
        is_gift: isGift,
        is_installment: isInstallment,
        total_installments: totalInstallments,
        current_installment: 1,
        installment_amount: installmentAmount,
        kupujici: {
          jmeno: body.Jmeno,
          email: body.Email,
          telefon: body.Telefon
        },
        created_at: new Date().toISOString()
      };

      clients.unshift(newClientRecord);
      await store.put('CLIENTS', JSON.stringify(clients));
    }

    return new Response(JSON.stringify({ ok: true, invoiceId: invoiceData.id }), {
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
