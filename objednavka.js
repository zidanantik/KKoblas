// functions/api/objednavka.js

const REQUIRED_CONTACT = ['Jmeno', 'Email', 'Telefon', 'Ulice', 'Mesto', 'PSC', 'Zeme'];
const REQUIRED_ANALYSIS = ['Vek', 'Pohlavi', 'Vyska_cm', 'Vaha_kg'];

// Pomocná funkce pro vytažení čísla z textu ceny (např. "14 700 Kč" -> 14700)
function parsePrice(str) {
  if (!str) return 0;
  const num = String(str).replace(/[^\d]/g, '');
  return num ? parseInt(num, 10) : 0;
}

// ── FAKTUROID V3 OAUTH & API ─────────────────────────────────────────────
async function getFakturoidToken(env) {
  const res = await fetch('https://app.fakturoid.cz/api/v3/oauth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': `KoblasNutricni (${env.FAKTUROID_EMAIL})`
    },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: env.FAKTUROID_CLIENT_ID,
      client_secret: env.FAKTUROID_CLIENT_SECRET
    })
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Fakturoid auth selhalo (${res.status}): ${err}`);
  }

  const data = await res.json();
  return data.access_token;
}

async function getOrCreateSubject(token, env, body) {
  const userAgent = `KoblasNutricni (${env.FAKTUROID_EMAIL})`;
  const slug = env.FAKTUROID_SLUG;

  // 1. Zkusíme kontakt vyhledat podle e-mailu
  try {
    const searchRes = await fetch(
      `https://app.fakturoid.cz/api/v3/accounts/${slug}/subjects/search.json?query=${encodeURIComponent(body.Email)}`,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'User-Agent': userAgent
        }
      }
    );
    if (searchRes.ok) {
      const found = await searchRes.json();
      if (Array.isArray(found) && found.length > 0) {
        return found[0].id;
      }
    }
  } catch (e) {
    console.warn('Vyhledání kontaktu selhalo, vytvoříme nový:', e);
  }

  // 2. Vytvoření nového kontaktu
  const createRes = await fetch(
    `https://app.fakturoid.cz/api/v3/accounts/${slug}/subjects.json`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'User-Agent': userAgent,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: body.Jmeno,
        email: body.Email,
        phone: body.Telefon,
        street: body.Ulice,
        city: body.Mesto,
        zip: body.PSC,
        country: body.Zeme || 'CZ',
        registration_no: body.ICO || null
      })
    }
  );

  if (!createRes.ok) {
    const err = await createRes.text();
    throw new Error(`Vytvoření kontaktu ve Fakturoidu selhalo: ${err}`);
  }

  const newSub = await createRes.json();
  return newSub.id;
}

async function createProforma(token, env, subjectId, body) {
  const slug = env.FAKTUROID_SLUG;
  const userAgent = `KoblasNutricni (${env.FAKTUROID_EMAIL})`;
  const price = parsePrice(body.Cena);
  const itemName = `${body.Sluzba || 'Nutriční spolupráce'} (${body.Platba || 'Platba'})`;

  const invoiceData = {
    subject_id: subjectId,
    document_type: 'proforma',
    proforma_followup_document: 'final_invoice_paid', // Po úhradě Fakturoid sám vystaví daňový doklad
    lines: [
      {
        name: itemName,
        quantity: 1,
        unit_price: price,
        vat_rate: 0
      }
    ]
  };

  const res = await fetch(`https://app.fakturoid.cz/api/v3/accounts/${slug}/invoices.json`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'User-Agent': userAgent,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(invoiceData)
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Vytvoření proformy selhalo: ${err}`);
  }

  return await res.json();
}

// ── HLAVNÍ POST HANDLER ──────────────────────────────────────────────────
export async function onRequestPost(context) {
  try {
    const body = await context.request.json();
    const isGift = body.Je_darek === 'ano' || body.Koupit_jako_darek === 'ano';
    const usedCode = (body.Pouzity_kod || '').trim();
    const priceNum = parsePrice(body.Cena);

    // Kontrola povinných polí (pro dárkový nákup se míry nevyžadují)
    const requiredFields = isGift ? REQUIRED_CONTACT : [...REQUIRED_CONTACT, ...REQUIRED_ANALYSIS];
    for (const field of requiredFields) {
      if (!body[field] || String(body[field]).trim() === '') {
        return new Response(JSON.stringify({ ok: false, error: `Chybí povinné pole: ${field}` }), {
          status: 400,
          headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });
      }
    }

    const resendKey = context.env.RESEND_API_KEY;
    const fromDomain = context.env.FROM_DOMAIN || 'koblas-nutricni.cz';

    // Načteme klienty z KV
    let clients = [];
    try {
      const rawClients = await context.env.STATUS_STORE.get('CLIENTS');
      if (rawClients) clients = JSON.parse(rawClients);
    } catch (e) {
      console.error('Chyba při čtení CLIENTS z KV:', e);
    }

    // ───────────────────────────────────────────────────────────────────────
    // SCÉNÁŘ A: UPLATNĚNÍ 100% DÁRKOVÉHO VOUCHERU (Cena = 0 Kč)
    // ───────────────────────────────────────────────────────────────────────
    if (priceNum === 0 && usedCode) {
      // 1. Označíme kód v PROMO_CODES jako použitý
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
      } catch (err) {
        console.error('Chyba při uplatnění voucheru v PROMO_CODES:', err);
      }

      // 2. Najdeme existující záznam v CLIENTS podle kódu voucheru
      const voucherClientIndex = clients.findIndex(c => c.kod_voucheru && c.kod_voucheru.toUpperCase() === usedCode.toUpperCase());

      if (voucherClientIndex > -1) {
        // Doplníme obdarovaného do existujícího záznamu (KAPACITA SE ZNOVU NEZVYŠUJE!)
        clients[voucherClientIndex].obdarovany = {
          jmeno: body.Jmeno,
          email: body.Email,
          telefon: body.Telefon,
          ulice: body.Ulice,
          mesto: body.Mesto,
          psc: body.PSC,
          zeme: body.Zeme,
          miry: {
            vek: body.Vek,
            pohlavi: body.Pohlavi,
            vyska_cm: body.Vyska_cm,
            vaha_kg: body.Vaha_kg,
            obvod_boku_cm: body.Obvod_boku_cm || null,
            obvod_pasu_cm: body.Obvod_pasu_cm || null,
            motivace: body.Motivace || null,
            souhlas_anonymni: body.Souhlas_anonymni === 'ano'
          }
        };
        clients[voucherClientIndex].datum_aktivace = new Date().toISOString();
        // Pokud byl záznam pozastavený, uplatněním se znovu aktivuje
        clients[voucherClientIndex].status = 'aktivni';
        clients[voucherClientIndex].pocita_se = true;
      } else {
        // Fallback pro případ, že kód nebyl vygenerován automatem, ale ručně v adminu
        clients.unshift({
          id: crypto.randomUUID(),
          fakturoid_id: null,
          fakturoid_number: null,
          sluzba: (body.Sluzba || '').toLowerCase(),
          sluzba_nazev: body.Sluzba || '',
          platba: body.Platba || 'Dárkový poukaz',
          cena: '0 Kč',
          is_gift: true,
          status: 'aktivni',
          pocita_se: true,
          kod_voucheru: usedCode,
          kupujici: null,
          obdarovany: {
            jmeno: body.Jmeno,
            email: body.Email,
            telefon: body.Telefon,
            ulice: body.Ulice,
            mesto: body.Mesto,
            psc: body.PSC,
            zeme: body.Zeme,
            miry: {
              vek: body.Vek,
              pohlavi: body.Pohlavi,
              vyska_cm: body.Vyska_cm,
              vaha_kg: body.Vaha_kg,
              obvod_boku_cm: body.Obvod_boku_cm || null,
              obvod_pasu_cm: body.Obvod_pasu_cm || null,
              motivace: body.Motivace || null,
              souhlas_anonymni: body.Souhlas_anonymni === 'ano'
            }
          },
          datum_nakupu: null,
          datum_platby: null,
          datum_aktivace: new Date().toISOString()
        });
      }

      await context.env.STATUS_STORE.put('CLIENTS', JSON.stringify(clients));

      // 3. E-maily pro aktivaci voucheru
      if (resendKey) {
        // Poradci
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: `KKoblas Web <info@${fromDomain}>`,
            to: ['koblas.nutricni.info@gmail.com'],
            subject: `🎁 Uplatněn dárkový poukaz (${usedCode}) – ${body.Jmeno}`,
            html: `<h2>Obdarovaný právě aktivoval dárkový poukaz!</h2>
                   <p><strong>Kód:</strong> ${usedCode}</p>
                   <p><strong>Jméno klienta:</strong> ${body.Jmeno} (<a href="mailto:${body.Email}">${body.Email}</a>, ${body.Telefon})</p>
                   <p><strong>Služba:</strong> ${body.Sluzba}</p>
                   <p>V administraci byl záznam automaticky spárován.</p>`
          })
        });

        // Klientovi (obdarovanému)
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: `Kryštof Koblas <info@${fromDomain}>`,
            to: [body.Email],
            subject: `Aktivace dárkového poukazu – ${body.Sluzba || 'KKoblas'}`,
            html: `<div style="font-family: sans-serif; max-width: 600px; color: #222;">
                     <h2 style="color: #ff9900;">Ahoj ${body.Jmeno},</h2>
                     <p>tvůj dárkový poukaz na program <strong>${body.Sluzba || 'Nutriční poradenství'}</strong> byl úspěšně aktivován!</p>
                     <p>Všechny potřebné údaje mám u sebe. Do <strong>2 pracovních dnů</strong> tě budu kontaktovat s detailním plánem a instrukcemi k zahájení spolupráce.</p>
                     <br><p>Moc se těším na naši spolupráci!<br><strong>Kryštof Koblas</strong></p>
                   </div>`
          })
        });
      }

      return new Response(JSON.stringify({ ok: true, voucherActivated: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      });
    }

    // ───────────────────────────────────────────────────────────────────────
    // SCÉNÁŘ B: BĚŽNÝ NÁKUP NEBO NÁKUP DÁRKU (Fakturace přes Fakturoid)
    // ───────────────────────────────────────────────────────────────────────
    let proformaData = null;

    if (context.env.FAKTUROID_CLIENT_ID && context.env.FAKTUROID_CLIENT_SECRET) {
      try {
        const token = await getFakturoidToken(context.env);
        const subjectId = await getOrCreateSubject(token, context.env, body);
        proformaData = await createProforma(token, context.env, subjectId, body);
      } catch (faktErr) {
        console.error('Chyba při komunikaci s Fakturoidem:', faktErr);
      }
    }

    // Založení záznamu do KV (zatím ve stavu čeká na platbu, NEZAPOČÍTÁVÁ SE DO KAPACITY)
    const newClientId = crypto.randomUUID();
    const newClientRecord = {
      id: newClientId,
      fakturoid_id: proformaData ? proformaData.id : null,
      fakturoid_number: proformaData ? proformaData.number : null,
      variable_symbol: proformaData ? proformaData.variable_symbol : null,
      public_html_url: proformaData ? proformaData.public_html_url : null,
      sluzba: (body.Sluzba || '').toLowerCase(),
      sluzba_nazev: body.Sluzba || '',
      platba: body.Platba || 'Jednorázová platba',
      cena: body.Cena || '',
      is_gift: isGift,
      status: 'ceka_na_platbu', // aktivuje se až přes webhook po zaplacení!
      pocita_se: false,
      kod_voucheru: null,
      kupujici: {
        jmeno: body.Jmeno,
        email: body.Email,
        telefon: body.Telefon,
        ulice: body.Ulice,
        mesto: body.Mesto,
        psc: body.PSC,
        zeme: body.Zeme,
        ico: body.ICO || null
      },
      obdarovany: null,
      miry: isGift ? null : {
        vek: body.Vek,
        pohlavi: body.Pohlavi,
        vyska_cm: body.Vyska_cm,
        vaha_kg: body.Vaha_kg,
        obvod_boku_cm: body.Obvod_boku_cm || null,
        obvod_pasu_cm: body.Obvod_pasu_cm || null,
        motivace: body.Motivace || null,
        souhlas_anonymni: body.Souhlas_anonymni === 'ano'
      },
      datum_nakupu: new Date().toISOString(),
      datum_platby: null,
      datum_aktivace: null
    };

    clients.unshift(newClientRecord);
    await context.env.STATUS_STORE.put('CLIENTS', JSON.stringify(clients));

    // Odeslání e-mailů s platebními údaji
    if (resendKey) {
      const payLink = proformaData ? proformaData.public_html_url : null;
      const vs = proformaData ? proformaData.variable_symbol : '—';
      const num = proformaData ? proformaData.number : '';

      const payHtml = payLink
        ? `<div style="background: #f8f8f8; border: 1px solid #e0e0e0; border-radius: 6px; padding: 18px; margin: 20px 0;">
             <p style="margin: 0 0 10px 0; font-size: 15px; font-weight: bold; color: #111;">Platební údaje k zálohové faktuře č. ${num}:</p>
             <p style="margin: 4px 0; font-size: 14px;"><strong>Částka:</strong> ${body.Cena}</p>
             <p style="margin: 4px 0; font-size: 14px;"><strong>Variabilní symbol:</strong> ${vs}</p>
             <p style="margin: 15px 0 0 0;">
               <a href="${payLink}" style="background: #ff9900; color: #000; font-weight: bold; text-decoration: none; padding: 10px 18px; border-radius: 4px; display: inline-block;">ZOBRAZIT FAKTURU &amp; ZAPLATIT (QR KÓD) →</a>
             </p>
           </div>`
        : '';

      // 1. Notifikace poradci
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: `KKoblas Web <info@${fromDomain}>`,
          to: ['koblas.nutricni.info@gmail.com'],
          reply_to: body.Email,
          subject: `Nová objednávka (${body.Sluzba || 'KKoblas'}) – Čeká na platbu`,
          html: `<h2>Nová objednávka z webu</h2>
                 <p><strong>Klient:</strong> ${body.Jmeno} (<a href="mailto:${body.Email}">${body.Email}</a>)</p>
                 <p><strong>Služba:</strong> ${body.Sluzba} | <strong>Cena:</strong> ${body.Cena}</p>
                 <p><strong>Typ:</strong> ${isGift ? '🎁 DÁRKOVÝ POUKAZ' : 'Běžný nákup'}</p>
                 ${payLink ? `<p><strong>Proforma ve Fakturoidu:</strong> <a href="${payLink}">${num}</a> (VS:${vs})</p>` : '<p><em>Faktura ve Fakturoidu nebyla vystavena (zkontrolujte API nastavení).</em></p>'}`
        })
      });

      // 2. Potvrzení klientovi s odkazem na platbu
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: `Kryštof Koblas <info@${fromDomain}>`,
          to: [body.Email],
          subject: `Potvrzení objednávky a platební údaje – ${body.Sluzba || 'KKoblas'}`,
          html: `<div style="font-family: sans-serif; max-width: 600px; color: #222; line-height: 1.6;">
                   <h2 style="color: #ff9900;">Ahoj ${body.Jmeno},</h2>
                   <p>děkuji za tvou objednávku služby <strong>${body.Sluzba || 'Nutriční poradenství'}</strong>!</p>
                   ${payHtml}
                   ${isGift 
                     ? '<p>🎁 <em>Ihned po přijetí platby ti obratem e-mailem zašlu elektronický dárkový voucher s unikátním kódem pro obdarovaného.</em></p>' 
                     : '<p>Jakmile dorazí úhrada, ozvu se ti s termínem a instrukcemi pro úvodní konzultaci a analýzu.</p>'}
                   <br>
                   <p>S pozdravem,<br><strong>Kryštof Koblas</strong><br>Nutriční poradce</p>
                 </div>`
        })
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });

  } catch (err) {
    console.error('Chyba serveru v objednavka.js:', err);
    return new Response(JSON.stringify({ ok: false, error: err.message || 'Server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  }
}
