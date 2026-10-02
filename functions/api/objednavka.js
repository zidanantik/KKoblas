// functions/api/objednavka.js

const REQUIRED_CONTACT = ['Jmeno', 'Email', 'Telefon', 'Ulice', 'Mesto', 'PSC', 'Zeme'];
const REQUIRED_ANALYSIS = ['Vek', 'Pohlavi', 'Vyska_cm', 'Vaha_kg'];
const OWNER_EMAIL = 'koblas.nutricni@gmail.com';

function normalizeCountry(country) {
  if (!country) return 'CZ';
  const c = String(country).trim().toLowerCase();
  if (c === 'cz' || c.includes('česk') || c.includes('czech')) return 'CZ';
  if (c === 'sk' || c.includes('sloven')) return 'SK';
  return country.length === 2 ? country.toUpperCase() : 'CZ';
}

function computeEndDate(startDateStr, pkgName) {
  if (!startDateStr) return null;
  const d = new Date(startDateStr);
  const s = String(pkgName || '').toLowerCase();
  let months = 1;
  if (s.includes('ultimate')) months = 6;
  else if (s.includes('mentor')) months = 4;
  else months = 1;

  d.setMonth(d.getMonth() + months);
  return d.toISOString().split('T')[0];
}

function getInstallmentConfig(pkgName, firstPrice) {
  const s = String(pkgName || '').toLowerCase();
  if (s.includes('ultimate')) {
    return { totalInstallments: 6, firstAmount: firstPrice || 11900, subsequentAmount: 2000 };
  }
  if (s.includes('mentor')) {
    return { totalInstallments: 4, firstAmount: firstPrice || 7500, subsequentAmount: 2800 };
  }
  return { totalInstallments: 2, firstAmount: firstPrice || 0, subsequentAmount: firstPrice || 0 };
}

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
    country: normalizeCountry(body.Zeme)
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
    const store = context.env.STATUS_STORE;
    const isGift = body.Je_darek === 'ano' || body.Koupit_jako_darek === 'ano';

    const isInstallment = 
      body.Splatky === true || 
      body.Splatky === 'true' || 
      String(body.Platba || '').toLowerCase().includes('splátk') ||
      String(body.platba || '').toLowerCase().includes('splat');

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
    const resendKey = context.env.RESEND_API_KEY;

    let sender = (context.env.FROM_DOMAIN || 'info@koblas-nutricni.cz').trim();
    if (!sender.includes('<')) {
      const cleanEmail = sender.includes('@') ? sender : `info@${sender}`;
      sender = `Kryštof Koblas <${cleanEmail}>`;
    }

    const sluzbaNazev = body.Sluzba_Nazev || body.Sluzba || 'Nutriční balíček';

    // Zjištění, zda jde o uplatnění dárkového poukazu
    let isGiftRedemption = false;
    let originalBuyerInfo = null;

    if (body.Pouzity_kod) {
      const promoUpper = body.Pouzity_kod.trim().toUpperCase();
      if (store) {
        const rawCodes = await store.get('PROMO_CODES');
        const codes = rawCodes ? JSON.parse(rawCodes) : [];
        const foundPromo = codes.find(c => c.code && c.code.trim().toUpperCase() === promoUpper);
        if (foundPromo && foundPromo.type === 'gift') {
          isGiftRedemption = true;
          // Zjistíme kupujícího z databáze klientů
          const rawClients = await store.get('CLIENTS');
          const existingClients = rawClients ? JSON.parse(rawClients) : [];
          const buyerRecord = existingClients.find(c => c.kod_voucheru && c.kod_voucheru.toUpperCase() === promoUpper);
          if (buyerRecord && buyerRecord.kupujici) {
            originalBuyerInfo = buyerRecord.kupujici;
          } else if (foundPromo.note) {
            originalBuyerInfo = { jmeno: foundPromo.note };
          }
        }
      }
    }

    let parsedPrice = 0;
    const priceMatch = String(body.Cena || '').match(/([\d\s]+)\s*Kč/);
    if (priceMatch) {
      parsedPrice = parseInt(priceMatch[1].replace(/\s/g, ''), 10) || 0;
    } else {
      parsedPrice = parseInt(String(body.Cena || '').replace(/[^\d]/g, ''), 10) || 0;
    }

    const isZeroPayment = isGiftRedemption || parsedPrice === 0;

    const instConfig = getInstallmentConfig(sluzbaNazev, parsedPrice);
    const totalInstallments = isInstallment ? instConfig.totalInstallments : 1;
    const firstInstallmentAmount = isInstallment ? instConfig.firstAmount : parsedPrice;
    const subsequentAmount = isInstallment ? instConfig.subsequentAmount : 0;

    let createdInvoiceId = null;

    // Vystavení proformy ve Fakturoidu (jen pokud se platí > 0 Kč)
    if (!isZeroPayment) {
      const fToken = await getFakturoidToken(clientId, clientSecret, userAgent);
      const subjectId = await getOrCreateSubject(slug, fToken, body, userAgent);

      let lineName = sluzbaNazev;
      if (isGift) {
        lineName += ' (Dárkový poukaz)';
      } else if (isInstallment) {
        lineName += ` – 1. splátka z ${totalInstallments}`;
      }

      const invoicePayload = {
        subject_id: subjectId,
        document_type: 'proforma',
        lines: [
          {
            name: lineName,
            quantity: 1,
            unit_price: firstInstallmentAmount,
            unit_name: 'ks'
          }
        ],
        note: isGift 
          ? 'Objednáno jako dárkový poukaz – voucher se odešle po úhradě.' 
          : (isInstallment ? `Splátkový kalendář (1/${totalInstallments})` : '')
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
      createdInvoiceId = invoiceData.id;

      let messagePayload = {};
      if (isGift) {
        messagePayload = {
          subject: `Zálohová faktura – Dárkový poukaz (${sluzbaNazev})`,
          message: `Ahoj,\n\nděkuji za objednávku dárkového poukazu na službu ${sluzbaNazev}.\n\nVšechny platební údaje najdeš přímo pod odkazem níže.\n\nJakmile platba dorazí, obratem ti do e-mailu pošlu unikátní kód poukazu a odkaz pro obdarovaného.\n\nMěj se fajn,\nKryštof Koblas`
        };
      } else if (isInstallment) {
        messagePayload = {
          subject: `Zálohová faktura – 1. splátka (${sluzbaNazev})`,
          message: `Ahoj,\n\nv příloze a na odkazu níže posílám zálohovou fakturu na 1. splátku z ${totalInstallments} za balíček ${sluzbaNazev}.\n\nJakmile platba dorazí, pošlu ti podklady a domluvíme termín úvodní online konzultace.\n\nMěj se fajn,\nKryštof Koblas`
        };
      }

      await fetch(`https://app.fakturoid.cz/api/v3/accounts/${slug}/invoices/${createdInvoiceId}/message.json`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${fToken}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'User-Agent': userAgent
        },
        body: JSON.stringify(messagePayload)
      });
    }

    // Uvítací e-mail obdarovanému (0 Kč poukaz)
    if (isZeroPayment && resendKey && body.Email) {
      const subjectClient = `Podklady pro zahájení spolupráce – ${sluzbaNazev}`;
      const plainText = `Ahoj ${body.Jmeno},\n\ntvůj poukaz na balíček ${sluzbaNazev} byl úspěšně aktivován a pouštíme se do práce.\n\n2 DŮLEŽITÉ ÚKOLY PŘED PRVNÍ SCHŮZKOU:\n1. Zápis jídelníčku: Měj ready aspoň 3 dny zápisu v aplikaci ZOF (https://www.zofapp.cz/).\n2. Měření InBody: Zařiď si prosím ve svém okolí měření InBody a pošli mi výsledky na WhatsApp (+420 774 143 176) nebo e-mailem na koblas.nutricni@gmail.com.\n\nJAK BUDEME V KONTAKTU:\n- Co nejdříve se ti ozvu na WhatsApp, abychom domluvili termín první online konzultace.\n\nČAS SPOLUPRÁCE:\nČas balíčku ti oficiálně počítám až ode dne naší první online schůzky, do té doby řešíme jen podklady.\n\nTěším se na výsledky!\nKryštof Koblas`;

      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: sender,
          to: [body.Email],
          reply_to: OWNER_EMAIL,
          subject: subjectClient,
          text: plainText
        })
      });
    }

    // Uložení do KV
    if (store) {
      const rawClients = await store.get('CLIENTS');
      let clients = rawClients ? JSON.parse(rawClients) : [];
      const todayStr = new Date().toISOString().split('T')[0];

      const newClientRecord = {
        id: crypto.randomUUID(),
        fakturoid_id: createdInvoiceId || (isGiftRedemption ? `POUKAZ-${body.Pouzity_kod}` : 'POUKAZ-ZDARMA'),
        invoice_ids: createdInvoiceId ? [createdInvoiceId] : [],
        paid_invoice_ids: [],
        status: isZeroPayment ? 'aktivni' : 'ceka_na_platbu',
        pocita_se: isZeroPayment,
        datum_platby: isZeroPayment ? new Date().toISOString() : null,
        start_date: isZeroPayment ? todayStr : null,
        end_date: isZeroPayment ? computeEndDate(todayStr, sluzbaNazev) : null,
        sluzba: body.Sluzba || '',
        sluzba_nazev: sluzbaNazev,
        is_gift: isGift,
        is_gift_redemption: isGiftRedemption,
        pouzity_kod: body.Pouzity_kod || null,
        platce: isGiftRedemption && originalBuyerInfo ? originalBuyerInfo : {
          jmeno: body.Jmeno,
          email: body.Email,
          telefon: body.Telefon
        },
        is_installment: isInstallment,
        total_installments: totalInstallments,
        current_installment: 1,
        installment_amount: firstInstallmentAmount,
        subsequent_amount: subsequentAmount,
        kupujici: {
          jmeno: body.Jmeno,
          email: body.Email,
          telefon: body.Telefon,
          ulice: body.Ulice,
          mesto: body.Mesto,
          psc: body.PSC,
          zeme: body.Zeme
        },
        diagnostika: {
          vek: body.Vek || '',
          pohlavi: body.Pohlavi || '',
          vyska: body.Vyska_cm || '',
          vaha: body.Vaha_kg || '',
          obvod_boku: body.Obvod_boku_cm || '',
          obvod_pasu: body.Obvod_pasu_cm || '',
          zprava: body.Duvod_zmeny || ''
        },
        created_at: new Date().toISOString()
      };

      clients.unshift(newClientRecord);
      await store.put('CLIENTS', JSON.stringify(clients));
    }

    return new Response(JSON.stringify({ ok: true, invoiceId: createdInvoiceId }), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });

  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  }
}
