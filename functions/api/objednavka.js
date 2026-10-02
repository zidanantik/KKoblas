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
    const resendKey = context.env.RESEND_API_KEY;

    let sender = (context.env.FROM_DOMAIN || 'info@koblas-nutricni.cz').trim();
    if (!sender.includes('<')) {
      const cleanEmail = sender.includes('@') ? sender : `info@${sender}`;
      sender = `Kryštof Koblas <${cleanEmail}>`;
    }

    const fToken = await getFakturoidToken(clientId, clientSecret, userAgent);
    const subjectId = await getOrCreateSubject(slug, fToken, body, userAgent);

    const rawPrice = String(body.Cena || '').replace(/[^\d]/g, '');
    const totalPrice = parseInt(rawPrice, 10) || 0;
    const isZeroPayment = totalPrice === 0;

    const totalInstallments = isInstallment ? (parseInt(body.Mesice, 10) || 3) : 1;
    const installmentAmount = isInstallment ? Math.round(totalPrice / totalInstallments) : totalPrice;
    const sluzbaNazev = body.Sluzba_Nazev || body.Sluzba || 'Nutriční balíček';

    let createdInvoiceId = null;

    if (!isZeroPayment) {
      let lineName = sluzbaNazev;
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
      createdInvoiceId = invoiceData.id;

      let messagePayload = {};
      if (isGift) {
        messagePayload = {
          subject: `Zálohová faktura – Dárkový poukaz (${sluzbaNazev})`,
          message: `Ahoj,\n\nděkuji za objednávku dárkového poukazu na službu ${sluzbaNazev}.\n\nVšechny platební údaje najdeš přímo pod odkazem níže.\n\nJakmile platba dorazí, obratem ti do e-mailu pošlu unikátní kód poukazu a odkaz pro obdarovaného.\n\nMěj se fajn,\nKryštof Koblas`
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

    // ── 1. NOTIFIKACE PRO TEBE ──
    if (resendKey) {
      let ownerSubject = `Nová objednávka – ${sluzbaNazev}`;
      if (isGift) {
        ownerSubject = `Nová objednávka (DÁREK) – ${sluzbaNazev}`;
      } else if (isZeroPayment) {
        ownerSubject = `Nová objednávka – ${sluzbaNazev} (Uplatněn poukaz)`;
      }

      const diagnosticRows = !isGift ? `
        <tr><td colspan="2" style="background:#1a1a1a;color:#2ecc71;padding:10px 14px;font-weight:bold;">Vstupní diagnostika</td></tr>
        <tr><td style="padding:8px 14px;border-bottom:1px solid #eee;color:#666;">Věk</td><td style="padding:8px 14px;border-bottom:1px solid #eee;font-weight:bold;">${body.Vek || '—'}</td></tr>
        <tr><td style="padding:8px 14px;border-bottom:1px solid #eee;color:#666;">Pohlaví</td><td style="padding:8px 14px;border-bottom:1px solid #eee;font-weight:bold;">${body.Pohlavi || '—'}</td></tr>
        <tr><td style="padding:8px 14px;border-bottom:1px solid #eee;color:#666;">Výška</td><td style="padding:8px 14px;border-bottom:1px solid #eee;font-weight:bold;">${body.Vyska_cm ? body.Vyska_cm + ' cm' : '—'}</td></tr>
        <tr><td style="padding:8px 14px;border-bottom:1px solid #eee;color:#666;">Váha</td><td style="padding:8px 14px;border-bottom:1px solid #eee;font-weight:bold;">${body.Vaha_kg ? body.Vaha_kg + ' kg' : '—'}</td></tr>
      ` : '';

      const ownerHtml = `
        <div style="font-family:sans-serif;max-width:640px;color:#222;">
          <h2 style="color:#222;margin-top:0;">${ownerSubject}</h2>
          <table style="border-collapse:collapse;width:100%;font-size:14px;margin-bottom:20px;">
            <tr><td colspan="2" style="background:#1a1a1a;color:#fff;padding:10px 14px;font-weight:bold;">Objednaná služba</td></tr>
            <tr><td style="padding:8px 14px;border-bottom:1px solid #eee;color:#666;width:35%;">Služba</td><td style="padding:8px 14px;border-bottom:1px solid #eee;font-weight:bold;">${sluzbaNazev}</td></tr>
            <tr><td style="padding:8px 14px;border-bottom:1px solid #eee;color:#666;">Cena</td><td style="padding:8px 14px;border-bottom:1px solid #eee;">${body.Cena || (isZeroPayment ? '0 Kč (Poukaz)' : '—')}</td></tr>
            <tr><td style="padding:8px 14px;border-bottom:1px solid #eee;color:#666;">Typ objednávky</td><td style="padding:8px 14px;border-bottom:1px solid #eee;">${isGift ? 'Dárkový poukaz' : (isInstallment ? 'Splátky' : 'Přímý nákup')}</td></tr>
            ${body.Pouzity_kod ? `<tr><td style="padding:8px 14px;border-bottom:1px solid #eee;color:#666;">Uplatněný kód</td><td style="padding:8px 14px;border-bottom:1px solid #eee;font-weight:bold;">${body.Pouzity_kod}</td></tr>` : ''}
            
            <tr><td colspan="2" style="background:#1a1a1a;color:#fff;padding:10px 14px;font-weight:bold;">Kontaktní údaje klienta</td></tr>
            <tr><td style="padding:8px 14px;border-bottom:1px solid #eee;color:#666;">Jméno</td><td style="padding:8px 14px;border-bottom:1px solid #eee;font-weight:bold;">${body.Jmeno}</td></tr>
            <tr><td style="padding:8px 14px;border-bottom:1px solid #eee;color:#666;">E-mail</td><td style="padding:8px 14px;border-bottom:1px solid #eee;"><a href="mailto:${body.Email}">${body.Email}</a></td></tr>
            <tr><td style="padding:8px 14px;border-bottom:1px solid #eee;color:#666;">Telefon</td><td style="padding:8px 14px;border-bottom:1px solid #eee;"><a href="tel:${body.Telefon}">${body.Telefon}</a></td></tr>
            <tr><td style="padding:8px 14px;border-bottom:1px solid #eee;color:#666;">Adresa</td><td style="padding:8px 14px;border-bottom:1px solid #eee;">${body.Ulice}, ${body.Mesto}, ${body.PSC} (${body.Zeme || 'CZ'})</td></tr>

            ${diagnosticRows}
          </table>
        </div>
      `;

      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 
          'Authorization': `Bearer ${resendKey}`, 
          'Content-Type': 'application/json' 
        },
        body: JSON.stringify({
          from: sender,
          to: [OWNER_EMAIL],
          reply_to: body.Email,
          subject: ownerSubject,
          html: ownerHtml
        })
      });
    }

    // ── 2. UVÍTACÍ E-MAIL PRO OBDAROVANÉHO (0 Kč) ──
    if (isZeroPayment && resendKey && body.Email) {
      await new Promise(r => setTimeout(r, 600));

      const subjectClient = `Podklady pro zahájení spolupráce – ${sluzbaNazev}`;

      const plainText = `Ahoj ${body.Jmeno},\n\ntvůj poukaz na balíček ${sluzbaNazev} byl úspěšně aktivován a pouštíme se do práce.\n\n2 DŮLEŽITÉ ÚKOLY PŘED PRVNÍ SCHŮZKOU:\n1. Zápis jídelníčku: Měj ready aspoň 3 dny zápisu v aplikaci ZOF (https://www.zofapp.cz/).\n2. Měření InBody: Zařiď si prosím ve svém okolí měření InBody a pošli mi výsledky na WhatsApp (+420 774 143 176) nebo e-mailem na koblas.nutricni@gmail.com.\n\nJAK BUDEME V KONTAKTU:\n- Co nejdříve se ti ozvu na WhatsApp, abychom domluvili termín první online konzultace. Můžeš mi samozřejmě napsat i sám/sama.\n- WhatsApp používáme primárně pro zprávy.\n\nČAS SPOLUPRÁCE:\nČas balíčku ti oficiálně počítám až ode dne naší první online schůzky, do té doby řešíme jen podklady.\n\nTěším se na výsledky!\nKryštof Koblas`;

      const htmlClient = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; color: #222; line-height: 1.6; font-size: 15px;">
          <p>Ahoj ${body.Jmeno},</p>
          <p>tvůj poukaz na balíček <strong>${sluzbaNazev}</strong> byl úspěšně aktivován. Oficiálně tak odmáváme startovní čáru a jdeme na to.</p>
          
          <p style="font-weight: bold; margin-top: 20px;">Dva důležité úkoly před naší první online schůzkou:</p>
          <ol style="padding-left: 20px;">
            <li style="margin-bottom: 8px;"><strong>Zápis jídelníčku:</strong> Měj ready aspoň 3 dny zápisu v aplikaci <a href="https://www.zofapp.cz/" style="color: #0066cc;">zofapp.cz</a> (čím víc dní zvládneš zapsat, tím lépe pro úvodní analýzu).</li>
            <li style="margin-bottom: 8px;"><strong>Měření InBody:</strong> Zařiď si prosím ve svém okolí měření na InBody a výsledky mi pošli na WhatsApp nebo na e-mail: <strong>koblas.nutricni@gmail.com</strong>.</li>
          </ol>

          <p style="font-weight: bold; margin-top: 25px;">Jak budeme v kontaktu:</p>
          <ul style="padding-left: 20px;">
            <li style="margin-bottom: 6px;"><strong>WhatsApp:</strong> Co nejdříve se ti ozvu přímo na WhatsApp (+420 774 143 176), abychom se domluvili na termínu první schůzky. Klidně mi napiš i první, pokud chceš začátek urychlit.</li>
            <li style="margin-bottom: 6px;">Číslo používej primárně pro textové a hlasové zprávy. Jakmile mám prostor mezi klienty, hned odepisuju.</li>
            <li style="margin-bottom: 6px;">Následně se propojíme přímo v aplikaci ZOF.</li>
          </ul>

          <p style="font-weight: bold; margin-top: 25px;">Férová dohoda o počítání času:</p>
          <ul style="padding-left: 20px;">
            <li style="margin-bottom: 6px;">Čas balíčku ti začínám oficiálně počítat až ode dne naší první online schůzky. Do té doby ladíme pouze diagnostiku a podklady.</li>
            <li style="margin-bottom: 6px;">Když se termín schůzky včas omluví a přesune, o nic nepřicházíš.</li>
          </ul>

          <p style="margin-top: 30px;">Těším se na spolupráci a na tvé výsledky!<br><br><strong>Kryštof Koblas</strong><br><span style="color: #666; font-size: 13px;">Nutriční poradce | koblas-nutricni.cz</span></p>
        </div>
      `;

      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 
          'Authorization': `Bearer ${resendKey}`, 
          'Content-Type': 'application/json' 
        },
        body: JSON.stringify({
          from: sender,
          to: [body.Email],
          reply_to: OWNER_EMAIL,
          subject: subjectClient,
          text: plainText,
          html: htmlClient
        })
      });
    }

    // ── 3. KV ULOŽENÍ ──
    const store = context.env.STATUS_STORE;
    if (store) {
      const rawClients = await store.get('CLIENTS');
      let clients = rawClients ? JSON.parse(rawClients) : [];

      const newClientRecord = {
        fakturoid_id: createdInvoiceId || 'POUKAZ-ZDARMA',
        status: isZeroPayment ? 'aktivni' : 'ceka_na_platbu',
        pocita_se: isZeroPayment,
        datum_platby: isZeroPayment ? new Date().toISOString() : null,
        sluzba: body.Sluzba || '',
        sluzba_nazev: sluzbaNazev,
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

    return new Response(JSON.stringify({ ok: true, invoiceId: createdInvoiceId }), {
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
