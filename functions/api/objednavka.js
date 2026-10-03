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

    // Zistenie súhlasu s referenciami (akékoľvek bežné pomenovanie poľa z formulára)
    const hasConsentReference = Boolean(
      body.Souhlas_reference === true || body.Souhlas_reference === 'ano' || body.Souhlas_reference === 'on' ||
      body.Souhlas_referencni === true || body.Souhlas_referencni === 'ano' || body.Souhlas_referencni === 'on' ||
      body.Souhlas_marketing === true || body.Souhlas_marketing === 'ano' || body.Souhlas_marketing === 'on' ||
      body.souhlas_reference === true || body.souhlas_reference === 'ano' || body.souhlas_reference === 'on'
    );

    const slug = (context.env.FAKTUROID_SLUG || 'krystofkoblas').trim();
    const clientId = (context.env.FAKTUROID_CLIENT_ID || '').trim();
    const clientSecret = (context.env.FAKTUROID_CLIENT_SECRET || '').trim();
    const userAgent = 'KKoblas Web (koblas.nutricni.info@gmail.com)';
    const resendKey = context.env.RESEND_API_KEY;

    let sender = (context.env.FROM_DOMAIN || 'info@koblas-nutricni.cz').trim();
    if (!sender.includes('<')) {
      const cleanEmail = sender.includes('@') ? sender : `info@${sender}`;
      sender = `Kryštof Koblas <${cleanEmail}>`;
    }

    const sluzbaNazev = body.Sluzba_Nazev || body.Sluzba || 'Nutriční balíček';

    // ── Zistenie, či ide o uplatnenie darčekového poukazu ──
    let isGiftRedemption = false;
    let originalBuyerInfo = null;
    let existingGiftClientIndex = -1;
    let clients = [];
    let promoCodes = [];
    let matchedPromo = null;

    if (store) {
      const rawClients = await store.get('CLIENTS');
      clients = rawClients ? JSON.parse(rawClients) : [];
    }

    if (body.Pouzity_kod && store) {
      const promoUpper = body.Pouzity_kod.trim().toUpperCase();
      const rawCodes = await store.get('PROMO_CODES');
      promoCodes = rawCodes ? JSON.parse(rawCodes) : [];
      matchedPromo = promoCodes.find(c => c.code && c.code.trim().toUpperCase() === promoUpper);

      if (matchedPromo && matchedPromo.type === 'gift') {
        isGiftRedemption = true;
        existingGiftClientIndex = clients.findIndex(c => c.kod_voucheru && c.kod_voucheru.toUpperCase() === promoUpper);
        if (existingGiftClientIndex > -1) {
          originalBuyerInfo = clients[existingGiftClientIndex].kupujici;
        } else if (matchedPromo.note) {
          originalBuyerInfo = { jmeno: matchedPromo.note };
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

    // Vystavenie proformy vo Fakturoidu (iba pre nákupy > 0 Kč)
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

    // ── ODOSIELANIE E-MAILOV ──
    if (resendKey) {
      const cleanPhone = (body.Telefon || '').replace(/[^\d+]/g, '');
      const waLink = cleanPhone.startsWith('+') ? `https://wa.me/${cleanPhone.replace('+', '')}` : `https://wa.me/420${cleanPhone}`;

      if (isZeroPayment) {
        // 1. Uvítací e-mail obdarovanému (klientovi)
        if (body.Email) {
          const subjectClient = `Podklady pro zahájení spolupráce – ${sluzbaNazev}`;
          const plainTextClient = `Ahoj ${body.Jmeno},\n\ntvůj poukaz na balíček ${sluzbaNazev} byl úspěšně aktivován a pouštíme se do práce.\n\n2 DŮLEŽITÉ ÚKOLY PŘED PRVNÍ SCHŮZKOU:\n1. Zápis jídelníčku: Měj ready aspoň 3 dny zápisu v aplikaci ZOF (https://www.zofapp.cz/).\n2. Měření InBody: Zařiď si prosím ve svém okolí měření InBody a pošli mi výsledky na WhatsApp (+420 774 143 176) nebo e-mailem na koblas.nutricni@gmail.com.\n\nJAK BUDEME V KONTAKTU:\n- Co nejdříve se ti ozvu na WhatsApp, abychom domluvili termín první online konzultace. Můžeš mi samozřejmě napsat i sám/sama.\n\nČAS SPOLUPRÁCE:\nČas balíčku ti oficiálně počítám až ode dne naší první online schůzky, do té doby řešíme jen podklady.\n\nTěším se na výsledky!\nKryštof Koblas`;

          const htmlClient = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; color: #222; line-height: 1.6; font-size: 15px;">
              <p>Ahoj ${body.Jmeno},</p>
              <p>tvůj poukaz na balíček <strong>${sluzbaNazev}</strong> byl úspěšně aktivován. Vítám tě na palubě a pouštíme se do práce!</p>
              
              <p style="font-weight: bold; margin-top: 20px;">Dva důležité úkoly před naší první online schůzkou:</p>
              <ol style="padding-left: 20px;">
                <li style="margin-bottom: 8px;"><strong>Zápis jídelníčku:</strong> Měj ready aspoň 3 dny zápisu v aplikaci <a href="https://www.zofapp.cz/" style="color: #0066cc;">zofapp.cz</a> (čím víc dní zvládneš zapsat, tím lépe pro úvodní analýzu).</li>
                <li style="margin-bottom: 8px;"><strong>Měření InBody:</strong> Zařiď si prosím ve svém okolí měření na InBody a výsledky mi pošli na WhatsApp nebo na e-mail: <strong>koblas.nutricni@gmail.com</strong>.</li>
              </ol>

              <p style="font-weight: bold; margin-top: 25px;">Jak budeme v kontaktu:</p>
              <ul style="padding-left: 20px;">
                <li style="margin-bottom: 6px;"><strong>WhatsApp:</strong> Co nejdříve se ti ozvu přímo na WhatsApp (+420 774 143 176), abychom domluvili termín první schůzky. Klidně mi napiš i první.</li>
                <li style="margin-bottom: 6px;">Následně se propojíme přímo v aplikaci ZOF.</li>
              </ul>

              <p style="font-weight: bold; margin-top: 25px;">Férová dohoda o počítání času:</p>
              <ul style="padding-left: 20px;">
                <li style="margin-bottom: 6px;">Čas balíčku ti začínám oficiálně počítat až ode dne naší první online schůzky. Do té doby ladíme pouze diagnostiku a podklady.</li>
              </ul>

              <p style="margin-top: 30px;">Těším se na spolupráci a na tvé výsledky!<br><br><strong>Kryštof Koblas</strong><br><span style="color: #666; font-size: 13px;">Nutriční poradce | koblas-nutricni.cz</span></p>
            </div>
          `;

          await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              from: sender,
              to: [body.Email],
              reply_to: OWNER_EMAIL,
              subject: subjectClient,
              text: plainTextClient,
              html: htmlClient
            })
          });
        }

        // 2. Okamžitá notifikácia majiteľovi (Kryštofovi) o uplatnení darčeka
        await new Promise(r => setTimeout(r, 600));

        let buyerHtml = '';
        if (originalBuyerInfo && originalBuyerInfo.jmeno) {
          buyerHtml = `<tr><td style="padding:8px 14px;border-bottom:1px solid #eee;color:#666;">Původní dárce</td><td style="padding:8px 14px;border-bottom:1px solid #eee;">${originalBuyerInfo.jmeno} ${originalBuyerInfo.email ? `(${originalBuyerInfo.email})` : ''}</td></tr>`;
        }

        const ownerGiftHtml = `
          <div style="font-family:sans-serif;max-width:640px;color:#222;">
            <h2 style="color:#2ecc71;margin-top:0;">🎁 DÁREK UPLATNĚN: ${sluzbaNazev} – ${body.Jmeno}</h2>
            
            <div style="background:#d4edda;color:#155724;padding:12px 15px;border-radius:4px;margin-bottom:20px;font-weight:bold;">
              Klient právě aktivoval dárkový poukaz a odeslal kompletní diagnostiku! Balíček je aktivní (0 Kč). Můžeš se mu rovnou ozvat.
            </div>

            <table style="border-collapse:collapse;width:100%;font-size:14px;margin-bottom:20px;">
              <tr><td colspan="2" style="background:#1a1a1a;color:#fff;padding:10px 14px;font-weight:bold;">Klient &amp; Rychlý kontakt</td></tr>
              <tr><td style="padding:8px 14px;border-bottom:1px solid #eee;color:#666;width:35%;">WhatsApp chat</td><td style="padding:8px 14px;border-bottom:1px solid #eee;font-weight:bold;"><a href="${waLink}" style="color:#25D366;font-size:15px;">👉 Otevřít WhatsApp konverzaci</a></td></tr>
              <tr><td style="padding:8px 14px;border-bottom:1px solid #eee;color:#666;">Telefon</td><td style="padding:8px 14px;border-bottom:1px solid #eee;">${body.Telefon}</td></tr>
              <tr><td style="padding:8px 14px;border-bottom:1px solid #eee;color:#666;">E-mail</td><td style="padding:8px 14px;border-bottom:1px solid #eee;"><a href="mailto:${body.Email}">${body.Email}</a></td></tr>
              <tr><td style="padding:8px 14px;border-bottom:1px solid #eee;color:#666;">Bydliště / Adresa</td><td style="padding:8px 14px;border-bottom:1px solid #eee;">${body.Ulice}, ${body.PSC} ${body.Mesto} (${body.Zeme})</td></tr>
              <tr><td style="padding:8px 14px;border-bottom:1px solid #eee;color:#666;">Uplatněný kód</td><td style="padding:8px 14px;border-bottom:1px solid #eee;font-family:monospace;font-weight:bold;color:#ff9900;">${body.Pouzity_kod || '—'}</td></tr>
              ${buyerHtml}

              <tr><td colspan="2" style="background:#1a1a1a;color:#2ecc71;padding:10px 14px;font-weight:bold;">Vstupní diagnostika klienta</td></tr>
              <tr><td style="padding:8px 14px;border-bottom:1px solid #eee;color:#666;">Věk</td><td style="padding:8px 14px;border-bottom:1px solid #eee;font-weight:bold;">${body.Vek || '—'} let</td></tr>
              <tr><td style="padding:8px 14px;border-bottom:1px solid #eee;color:#666;">Pohlaví</td><td style="padding:8px 14px;border-bottom:1px solid #eee;font-weight:bold;">${body.Pohlavi || '—'}</td></tr>
              <tr><td style="padding:8px 14px;border-bottom:1px solid #eee;color:#666;">Výška</td><td style="padding:8px 14px;border-bottom:1px solid #eee;font-weight:bold;">${body.Vyska_cm ? body.Vyska_cm + ' cm' : '—'}</td></tr>
              <tr><td style="padding:8px 14px;border-bottom:1px solid #eee;color:#666;">Váha</td><td style="padding:8px 14px;border-bottom:1px solid #eee;font-weight:bold;">${body.Vaha_kg ? body.Vaha_kg + ' kg' : '—'}</td></tr>
              ${body.Obvod_pasu_cm ? `<tr><td style="padding:8px 14px;border-bottom:1px solid #eee;color:#666;">Obvod pasu</td><td style="padding:8px 14px;border-bottom:1px solid #eee;font-weight:bold;">${body.Obvod_pasu_cm} cm</td></tr>` : ''}
              ${body.Obvod_boku_cm ? `<tr><td style="padding:8px 14px;border-bottom:1px solid #eee;color:#666;">Obvod boků</td><td style="padding:8px 14px;border-bottom:1px solid #eee;font-weight:bold;">${body.Obvod_boku_cm} cm</td></tr>` : ''}
              ${body.Duvod_zmeny ? `<tr><td style="padding:8px 14px;border-bottom:1px solid #eee;color:#666;">Cíl / zpráva</td><td style="padding:8px 14px;border-bottom:1px solid #eee;line-height:1.5;">${body.Duvod_zmeny}</td></tr>` : ''}
              
              <tr><td colspan="2" style="background:#1a1a1a;color:#f39c12;padding:10px 14px;font-weight:bold;">Marketingový souhlas (Reference)</td></tr>
              <tr>
                <td style="padding:8px 14px;border-bottom:1px solid #eee;color:#666;">Souhlas s referencemi</td>
                <td style="padding:8px 14px;border-bottom:1px solid #eee;font-weight:bold;color:${hasConsentReference ? '#2ecc71' : '#888'};">
                  ${hasConsentReference ? '✅ ANO (udělen – anonymní grafy/fotky)' : '❌ NE (neudělen)'}
                </td>
              </tr>
            </table>
          </div>
        `;

        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: sender,
            to: [OWNER_EMAIL],
            reply_to: body.Email,
            subject: `🎁 DÁREK UPLATNĚN: ${sluzbaNazev} – ${body.Jmeno}`,
            html: ownerGiftHtml
          })
        });

      } else {
        // Notifikácia majiteľovi o bežnej novej objednávke
        const ownerOrderHtml = `
          <div style="font-family:sans-serif;max-width:640px;color:#222;">
            <h2 style="color:#3498db;margin-top:0;">Nová objednávka: ${sluzbaNazev} – ${body.Jmeno}</h2>
            <div style="background:#eaf2f8;color:#2980b9;padding:12px 15px;border-radius:4px;margin-bottom:20px;font-weight:bold;">
              Klient odeslal objednávku. Fakturoid vystavil zálohovou fakturu a čeká se na bankovní převod.
            </div>
            <table style="border-collapse:collapse;width:100%;font-size:14px;">
              <tr><td style="padding:8px 14px;border-bottom:1px solid #eee;color:#666;width:35%;">Klient</td><td style="padding:8px 14px;border-bottom:1px solid #eee;font-weight:bold;">${body.Jmeno}</td></tr>
              <tr><td style="padding:8px 14px;border-bottom:1px solid #eee;color:#666;">Telefon</td><td style="padding:8px 14px;border-bottom:1px solid #eee;">${body.Telefon}</td></tr>
              <tr><td style="padding:8px 14px;border-bottom:1px solid #eee;color:#666;">E-mail</td><td style="padding:8px 14px;border-bottom:1px solid #eee;"><a href="mailto:${body.Email}">${body.Email}</a></td></tr>
              <tr><td style="padding:8px 14px;border-bottom:1px solid #eee;color:#666;">Částka</td><td style="padding:8px 14px;border-bottom:1px solid #eee;font-weight:bold;">${firstInstallmentAmount} Kč</td></tr>
              <tr><td style="padding:8px 14px;border-bottom:1px solid #eee;color:#666;">Souhlas s referencemi</td><td style="padding:8px 14px;border-bottom:1px solid #eee;font-weight:bold;color:${hasConsentReference ? '#2ecc71' : '#888'};">${hasConsentReference ? '✅ ANO' : '❌ NE'}</td></tr>
            </table>
          </div>
        `;

        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: sender,
            to: [OWNER_EMAIL],
            reply_to: body.Email,
            subject: `Nová objednávka: ${sluzbaNazev} – ${body.Jmeno}`,
            html: ownerOrderHtml
          })
        });
      }
    }

    // ── Zneplatnenie použitého kódu v KV databáze ──
    if (matchedPromo && store) {
      matchedPromo.used = true;
      matchedPromo.usedCount = (Number(matchedPromo.usedCount) || 0) + 1;
      await store.put('PROMO_CODES', JSON.stringify(promoCodes));
    }

    // ── Uloženie klienta do KV databázy ──
    if (store) {
      const todayStr = new Date().toISOString().split('T')[0];

      const clientData = {
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
        souhlas_reference: hasConsentReference,
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
          zprava: body.Duvod_zmeny || '',
          souhlas_reference: hasConsentReference
        },
        created_at: new Date().toISOString()
      };

      if (isGiftRedemption && existingGiftClientIndex > -1) {
        clientData.id = clients[existingGiftClientIndex].id || clientData.id;
        clientData.kod_voucheru = clients[existingGiftClientIndex].kod_voucheru;
        clients[existingGiftClientIndex] = clientData;
      } else {
        clients.unshift(clientData);
      }

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
