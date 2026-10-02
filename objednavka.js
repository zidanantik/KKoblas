// functions/api/objednavka.js

const REQUIRED_CONTACT = ['Jmeno', 'Email', 'Telefon', 'Ulice', 'Mesto', 'PSC', 'Zeme'];
const REQUIRED_ANALYSIS = ['Vek', 'Pohlavi', 'Vyska_cm', 'Vaha_kg'];
const OWNER_EMAIL = 'koblas.nutricni@gmail.com';

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
    const resendKey = context.env.RESEND_API_KEY;

    // Bezpečná konstrukce odesílatele bez diakritiky
    let sender = (context.env.FROM_DOMAIN || 'info@koblas-nutricni.cz').trim();
    if (!sender.includes('<')) {
      const cleanEmail = sender.includes('@') ? sender : `info@${sender}`;
      sender = `Kryštof Koblas <${cleanEmail}>`;
    }

    const fToken = await getFakturoidToken(clientId, clientSecret, userAgent);
    const subjectId = await getOrCreateSubject(slug, fToken, body, userAgent);

    // Výpočet ceny a parametrů
    const rawPrice = String(body.Cena || '').replace(/[^\d]/g, '');
    const totalPrice = parseInt(rawPrice, 10) || 0;
    const isZeroPayment = totalPrice === 0;

    const totalInstallments = isInstallment ? (parseInt(body.Mesice, 10) || 3) : 1;
    const installmentAmount = isInstallment ? Math.round(totalPrice / totalInstallments) : totalPrice;
    const sluzbaNazev = body.Sluzba_Nazev || body.Sluzba || 'Nutriční balíček';

    let lineName = sluzbaNazev;
    if (isGift) {
      lineName += ' (Dárkový poukaz)';
    } else if (isZeroPayment) {
      lineName += ' (Uplatněn dárkový poukaz – 100% sleva)';
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
        : (isZeroPayment ? 'Uplatněn dárkový poukaz – 100% sleva' : (isInstallment ? 'Splátková platba (1/' + totalInstallments + ')' : ''))
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

    // ── 1. NOTIFIKACE PRO TEBE NA GMAIL (PŘEHLED VŠECH ÚDAJŮ) ──
    if (resendKey) {
      let ownerSubject = `Nová objednávka – ${sluzbaNazev}`;
      if (isGift) {
        ownerSubject = `Nová objednávka (🎁 DÁREK) – ${sluzbaNazev}`;
      } else if (isZeroPayment) {
        ownerSubject = `Nová objednávka – ${sluzbaNazev} (Uhrazeno poukazem 0 Kč)`;
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
          <h2 style="color:#ff9900;margin-top:0;">${ownerSubject}</h2>
          <table style="border-collapse:collapse;width:100%;font-size:14px;margin-bottom:20px;">
            <tr><td colspan="2" style="background:#1a1a1a;color:#ff9900;padding:10px 14px;font-weight:bold;">Objednaná služba a platba</td></tr>
            <tr><td style="padding:8px 14px;border-bottom:1px solid #eee;color:#666;width:35%;">Služba</td><td style="padding:8px 14px;border-bottom:1px solid #eee;font-weight:bold;">${sluzbaNazev}</td></tr>
            <tr><td style="padding:8px 14px;border-bottom:1px solid #eee;color:#666;">Cena</td><td style="padding:8px 14px;border-bottom:1px solid #eee;">${body.Cena || (isZeroPayment ? '0 Kč (Poukaz)' : '—')}</td></tr>
            <tr><td style="padding:8px 14px;border-bottom:1px solid #eee;color:#666;">Typ objednávky</td><td style="padding:8px 14px;border-bottom:1px solid #eee;">${isGift ? 'Dárkový poukaz' : (isInstallment ? 'Splátky' : 'Přímý nákup')}</td></tr>
            ${body.Pouzity_kod ? `<tr><td style="padding:8px 14px;border-bottom:1px solid #eee;color:#666;">Uplatněný kód</td><td style="padding:8px 14px;border-bottom:1px solid #eee;color:#ff9900;font-weight:bold;">${body.Pouzity_kod}</td></tr>` : ''}
            
            <tr><td colspan="2" style="background:#1a1a1a;color:#fff;padding:10px 14px;font-weight:bold;">Kontaktní údaje klienta</td></tr>
            <tr><td style="padding:8px 14px;border-bottom:1px solid #eee;color:#666;">Jméno</td><td style="padding:8px 14px;border-bottom:1px solid #eee;font-weight:bold;">${body.Jmeno}</td></tr>
            <tr><td style="padding:8px 14px;border-bottom:1px solid #eee;color:#666;">E-mail</td><td style="padding:8px 14px;border-bottom:1px solid #eee;"><a href="mailto:${body.Email}">${body.Email}</a></td></tr>
            <tr><td style="padding:8px 14px;border-bottom:1px solid #eee;color:#666;">Telefon</td><td style="padding:8px 14px;border-bottom:1px solid #eee;"><a href="tel:${body.Telefon}">${body.Telefon}</a></td></tr>
            <tr><td style="padding:8px 14px;border-bottom:1px solid #eee;color:#666;">Adresa</td><td style="padding:8px 14px;border-bottom:1px solid #eee;">${body.Ulice}, ${body.Mesto}, ${body.PSC} (${body.Zeme || 'CZ'})</td></tr>

            ${diagnosticRows}
          </table>
          <p style="font-size:12px;color:#888;">Faktura ID ve Fakturoidu: ${invoiceData.id}</p>
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

    // ── 2. ZPRACOVÁNÍ PRO KLIENTA ──
    if (isZeroPayment) {
      // 0 Kč (uplatněn poukaz): Označíme ve Fakturoidu za vyřízené a pošleme uvítací e-mail
      try {
        await fetch(`https://app.fakturoid.cz/api/v3/accounts/${slug}/invoices/${invoiceData.id}/payments.json`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${fToken}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'User-Agent': userAgent
          },
          body: JSON.stringify({ paid_on: new Date().toISOString().split('T')[0] })
        });
      } catch (e) {
        console.error('Chyba při označení 0 Kč faktury jako zaplacené:', e);
      }

      if (resendKey && body.Email) {
        const welcomeEmailHtml = `
          <div style="font-family: sans-serif; max-width: 600px; color: #222; line-height: 1.6;">
            <h2 style="color: #2ecc71;">Poukaz uplatněn! Vítej na palubě 🚀</h2>
            <p>Ahoj ${body.Jmeno},</p>
            <p>tvůj dárkový poukaz na balíček <strong>${sluzbaNazev}</strong> byl úspěšně aktivován! Oficiálně tak odmáváme startovní čáru a jdeme na to.</p>
            
            <div style="background: #fff8eb; border-left: 4px solid #ff9900; padding: 15px; margin: 20px 0;">
              <h3 style="color: #d35400; margin-top: 0; margin-bottom: 8px;">📋 2 DŮLEŽITÉ ÚKOLY PŘED PRVNÍ ONLINE SCHŮZKOU:</h3>
              <p style="margin: 6px 0;"><strong>1. Zápis jídelníčku:</strong> Měj ready aspoň 3 dny zápisu v aplikaci <a href="https://www.zofapp.cz/" style="color: #ff9900; font-weight: bold;">zofapp.cz</a> (čím víc dní zvládneš zapsat, tím líp pro úvodní analýzu).</p>
              <p style="margin: 6px 0;"><strong>2. Měření InBody:</strong> Zařiď si prosím ve svém okolí měření na InBody a výsledky mi pošli na WhatsApp nebo na e-mail: <strong>koblas.nutricni@gmail.com</strong>.</p>
            </div>

            <h3 style="color: #ff9900; margin-top: 25px;">📱 JAK BUDEME V KONTAKTU?</h3>
            <ul>
              <li><strong>Prvně ti napíšu na WhatsApp:</strong> Co nejdříve se ti ozvu přímo na WhatsApp (+420 774 143 176), abychom se domluvili na termínu první online schůzky.</li>
              <li><strong>Klidně napiš sám/sama:</strong> Kdybych to náhodou nestihl hned nebo jsi chtěl/a začátek urychlit, klidně mi napiš jako první.</li>
              <li><strong>Čistě WhatsApp zprávy:</strong> Číslo používej primárně pro textové a hlasové zprávy. Každému se věnuji na maximum a jakmile mi to čas dovolí, hned odepisuju.</li>
              <li><strong>Spojení v aplikaci ZOF:</strong> Následně se propojíme i přímo v ZOFu.</li>
            </ul>

            <h3 style="color: #ff9900; margin-top: 25px;">⏱️ JAK JE TO S TVÝM ČASEM? (FÉROVÁ DOHODA)</h3>
            <ul>
              <li><strong>O svůj čas nepřijdeš:</strong> Čas balíčku ti začínám oficiálně počítat až ode dne naší první online schůzky (do té doby spolu ladíme jen podklady a diagnostiku).</li>
              <li><strong>Rušení schůzek:</strong> Když se schůzka předem vykomunikuje a přesune, nic se neděje. Pokud by se ale termíny rušily opakovaně bez omluvy, zaplacený čas začne běžet.</li>
            </ul>

            <p style="margin-top: 25px;">Všechno v klidu nastavíme tak, aby tě to bavilo a přineslo reálné výsledky.<br><br>Těším se na spolupráci!<br><strong>Kryštof Koblas</strong></p>
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
            subject: `koblas-nutricni.cz | Poukaz na ${sluzbaNazev} aktivován! Info, co bude dál 🚀`,
            html: welcomeEmailHtml
          })
        });
      }

    } else {
      // Běžná platba > 0 Kč: Fakturoid pošle proforma fakturu
      await fetch(`https://app.fakturoid.cz/api/v3/accounts/${slug}/invoices/${invoiceData.id}/message.json`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${fToken}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'User-Agent': userAgent
        },
        body: JSON.stringify({})
      });
    }

    // ── 3. ULOŽENÍ DO KV DATABÁZE (CLIENTS) ──
    const store = context.env.STATUS_STORE;
    if (store) {
      const rawClients = await store.get('CLIENTS');
      let clients = rawClients ? JSON.parse(rawClients) : [];

      const newClientRecord = {
        fakturoid_id: invoiceData.id,
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
