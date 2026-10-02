// functions/api/fakturoid-webhook.js

const OWNER_EMAIL = 'koblas.nutricni@gmail.com';

function generateGiftCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let res = '';
  for (let i = 0; i < 6; i++) {
    res += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return 'DAR-' + res;
}

function normalizePkg(str) {
  if (!str) return '';
  const s = String(str).toLowerCase();
  if (s.includes('ultimate')) return 'ultimate';
  if (s.includes('mentor')) return 'mentoring';
  if (s.includes('start')) return 'startup';
  return s.trim();
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

export async function onRequestPost(context) {
  try {
    const payload = await context.request.json();
    const eventName = payload.event_name || payload.event;
    const invoice = (payload.body && payload.body.invoice) || payload.invoice || payload;

    if (eventName !== 'invoice_paid') {
      return new Response(JSON.stringify({ ignored: true, event: eventName }), { status: 200 });
    }

    const invoiceId = invoice.id || payload.invoice_id;
    if (!invoiceId) {
      return new Response(JSON.stringify({ ok: false, error: 'Chybí invoice ID' }), { status: 400 });
    }

    const rawClients = await context.env.STATUS_STORE.get('CLIENTS');
    let clients = rawClients ? JSON.parse(rawClients) : [];

    const clientIndex = clients.findIndex(c => String(c.fakturoid_id) === String(invoiceId));
    if (clientIndex === -1) {
      return new Response(JSON.stringify({ ok: true, message: 'Klient nenalezen v KV' }), { status: 200 });
    }

    const client = clients[clientIndex];

    if (client.status === 'aktivni' && !client.is_installment_pending) {
      return new Response(JSON.stringify({ ok: true, message: 'Klient již je aktivní' }), { status: 200 });
    }

    client.status = 'aktivni';
    client.pocita_se = true;
    client.datum_platby = new Date().toISOString();

    const resendKey = context.env.RESEND_API_KEY;

    let sender = (context.env.FROM_DOMAIN || 'info@koblas-nutricni.cz').trim();
    if (!sender.includes('<')) {
      const cleanEmail = sender.includes('@') ? sender : `info@${sender}`;
      sender = `Kryštof Koblas <${cleanEmail}>`;
    }

    const pkgSlug = normalizePkg(client.sluzba || client.sluzba_nazev);

    // ── 1. ZPRACOVÁNÍ DÁRKOVÉHO POUKAZU ──
    if (client.is_gift) {
      const giftCode = generateGiftCode();
      client.kod_voucheru = giftCode;

      const rawCodes = await context.env.STATUS_STORE.get('PROMO_CODES');
      let codes = rawCodes ? JSON.parse(rawCodes) : [];

      const buyerName = (client.kupujici && client.kupujici.jmeno) ? client.kupujici.jmeno : 'Dárkový nákup';
      const purchaseDate = new Date().toLocaleDateString('cs-CZ');

      const newPromo = {
        id: crypto.randomUUID(),
        code: giftCode,
        type: 'gift',
        value: 100,
        oneTime: true,
        splatky: false,
        darekOnly: false,
        packages: pkgSlug ? [pkgSlug] : [],
        active: true,
        used: false,
        usedCount: 0,
        createdAt: new Date().toISOString(),
        note: `${buyerName} (${purchaseDate})`
      };

      codes.unshift(newPromo);
      await context.env.STATUS_STORE.put('PROMO_CODES', JSON.stringify(codes));

      if (resendKey && client.kupujici && client.kupujici.email) {
        const redeemUrl = `https://koblas-nutricni.cz/objednavka.html?sluzba=${encodeURIComponent(pkgSlug)}&kod=${encodeURIComponent(giftCode)}`;

        const plainTextGift = `Ahoj ${client.kupujici.jmeno},\n\nděkuji za úhradu dárkového poukazu na službu ${client.sluzba_nazev || 'Nutriční spolupráce'}.\n\nKód dárkového poukazu:\n${giftCode}\n\nObdarovaný poukaz aktivuje na adrese:\n${redeemUrl}\n\nTento kód stačí obdarovanému předat. Všechny další kroky a diagnostiku už vyřeším přímo s ním.\n\nS pozdravem,\nKryštof Koblas`;

        const htmlGift = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; color: #222; line-height: 1.6; font-size: 15px;">
            <p>Ahoj ${client.kupujici.jmeno},</p>
            <p>děkuji za úhradu dárkového poukazu na službu <strong>${client.sluzba_nazev || 'Nutriční spolupráce'}</strong>.</p>
            
            <div style="background: #f7f7f7; border: 1px solid #ddd; padding: 20px; border-radius: 6px; margin: 25px 0;">
              <div style="font-size: 13px; color: #666; text-transform: uppercase; letter-spacing: 1px;">Kód dárkového poukazu:</div>
              <div style="font-family: monospace; font-size: 26px; font-weight: bold; color: #111; margin: 8px 0;">${giftCode}</div>
              <p style="margin: 10px 0 0 0; font-size: 14px;">
                Přímý odkaz pro aktivaci:<br>
                <a href="${redeemUrl}" style="color: #0066cc; word-break: break-all;">${redeemUrl}</a>
              </p>
            </div>

            <p>Tento kód a odkaz stačí předat obdarovanému. Jakmile formulář vyplní, převezmu si ho a celou spolupráci už povedu přímo s ním.</p>
            <p style="margin-top: 30px;">S pozdravem,<br><strong>Kryštof Koblas</strong><br><span style="color: #666; font-size: 13px;">koblas-nutricni.cz</span></p>
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
            to: [client.kupujici.email],
            reply_to: OWNER_EMAIL,
            subject: `Dárkový poukaz – kód: ${giftCode}`,
            text: plainTextGift,
            html: htmlGift
          })
        });

        // Notifikace tobě o zaplacení dárku
        await new Promise(r => setTimeout(r, 600));
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 
            'Authorization': `Bearer ${resendKey}`, 
            'Content-Type': 'application/json' 
          },
          body: JSON.stringify({
            from: sender,
            to: [OWNER_EMAIL],
            reply_to: client.kupujici.email,
            subject: `DÁREK ZAPLACEN: ${client.sluzba_nazev} – Kód: ${giftCode}`,
            html: `
              <div style="font-family:sans-serif;max-width:600px;color:#222;">
                <h3 style="color:#2ecc71;">Platba za dárkový poukaz byla přijata!</h3>
                <p>Kupující <strong>${client.kupujici.jmeno}</strong> (${client.kupujici.email}) uhradil fakturu za dárkový poukaz.</p>
                <p>Byl vygenerován a odeslán kód: <strong>${giftCode}</strong></p>
              </div>
            `
          })
        });
      }

    } else {
      // ── 2. PŘÍMÝ NÁKUP PO ZAPLACENÍ ──
      const packageName = client.sluzba_nazev || 'nutriční program';

      // 1. Uvítací e-mail klientovi
      if (resendKey && client.kupujici && client.kupujici.email) {
        const plainTextClient = `Ahoj ${client.kupujici.jmeno},\n\ntvoje platba za balíček ${packageName} v pořádku dorazila. Oficiálně odmáváme startovní čáru a jdeme na to.\n\n2 DŮLEŽITÉ ÚKOLY PŘED PRVNÍ SCHŮZKOU:\n1. Zápis jídelníčku: Měj ready aspoň 3 dny zápisu v aplikaci ZOF (https://www.zofapp.cz/).\n2. Měření InBody: Zařiď si prosím ve svém okolí měření InBody a pošli mi výsledky na WhatsApp (+420 774 143 176) nebo e-mailem na koblas.nutricni@gmail.com.\n\nJAK BUDEME V KONTAKTU:\n- Co nejdříve se ti ozvu na WhatsApp, abychom domluvili termín první online konzultace. Můžeš mi samozřejmě napsat i sám/sama.\n- WhatsApp používáme primárně pro zprávy.\n\nČAS SPOLUPRÁCE:\nČas balíčku ti oficiálně počítám až ode dne naší první online schůzky, do té doby řešíme jen podklady.\n\nTěším se na výsledky!\nKryštof Koblas`;

        const htmlClient = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; color: #222; line-height: 1.6; font-size: 15px;">
            <p>Ahoj ${client.kupujici.jmeno},</p>
            <p>tvoje platba za balíček <strong>${packageName}</strong> dorazila v pořádku, díky moc! Oficiálně odmáváme startovní čáru a jdeme na to.</p>
            
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
            to: [client.kupujici.email],
            reply_to: OWNER_EMAIL,
            subject: `Podklady pro zahájení spolupráce – ${packageName}`,
            text: plainTextClient,
            html: htmlClient
          })
        });
      }

      // 2. Potvrzení o zaplacení tobě na Gmail (ZAPLACENO!)
      if (resendKey) {
        await new Promise(r => setTimeout(r, 600));

        const diag = client.diagnostika || {};
        const cleanPhone = (client.kupujici.telefon || '').replace(/[^\d+]/g, '');
        const waLink = cleanPhone.startsWith('+') ? `https://wa.me/${cleanPhone.replace('+', '')}` : `https://wa.me/420${cleanPhone}`;

        const ownerPaidHtml = `
          <div style="font-family:sans-serif;max-width:640px;color:#222;">
            <h2 style="color:#2ecc71;margin-top:0;">✅ ZAPLACENO: ${packageName} – ${client.kupujici.jmeno}</h2>
            
            <div style="background:#d4edda;color:#155724;padding:12px 15px;border-radius:4px;margin-bottom:20px;font-weight:bold;">
              Platba dorazila na účet! Klientovi byl odeslán uvítací e-mail se ZOFem a InBody. Můžeš se mu ozvat.
            </div>

            <table style="border-collapse:collapse;width:100%;font-size:14px;margin-bottom:20px;">
              <tr><td colspan="2" style="background:#1a1a1a;color:#fff;padding:10px 14px;font-weight:bold;">Rychlý kontakt</td></tr>
              <tr><td style="padding:8px 14px;border-bottom:1px solid #eee;color:#666;width:35%;">WhatsApp chat</td><td style="padding:8px 14px;border-bottom:1px solid #eee;font-weight:bold;"><a href="${waLink}" style="color:#25D366;font-size:15px;">👉 Otevřít WhatsApp konverzaci</a></td></tr>
              <tr><td style="padding:8px 14px;border-bottom:1px solid #eee;color:#666;">Telefon</td><td style="padding:8px 14px;border-bottom:1px solid #eee;">${client.kupujici.telefon}</td></tr>
              <tr><td style="padding:8px 14px;border-bottom:1px solid #eee;color:#666;">E-mail</td><td style="padding:8px 14px;border-bottom:1px solid #eee;"><a href="mailto:${client.kupujici.email}">${client.kupujici.email}</a></td></tr>

              <tr><td colspan="2" style="background:#1a1a1a;color:#2ecc71;padding:10px 14px;font-weight:bold;">Vstupní diagnostika klienta</td></tr>
              <tr><td style="padding:8px 14px;border-bottom:1px solid #eee;color:#666;">Věk</td><td style="padding:8px 14px;border-bottom:1px solid #eee;font-weight:bold;">${diag.vek || '—'}</td></tr>
              <tr><td style="padding:8px 14px;border-bottom:1px solid #eee;color:#666;">Pohlaví</td><td style="padding:8px 14px;border-bottom:1px solid #eee;font-weight:bold;">${diag.pohlavi || '—'}</td></tr>
              <tr><td style="padding:8px 14px;border-bottom:1px solid #eee;color:#666;">Výška</td><td style="padding:8px 14px;border-bottom:1px solid #eee;font-weight:bold;">${diag.vyska ? diag.vyska + ' cm' : '—'}</td></tr>
              <tr><td style="padding:8px 14px;border-bottom:1px solid #eee;color:#666;">Váha</td><td style="padding:8px 14px;border-bottom:1px solid #eee;font-weight:bold;">${diag.vaha ? diag.vaha + ' kg' : '—'}</td></tr>
              ${diag.zprava ? `<tr><td style="padding:8px 14px;border-bottom:1px solid #eee;color:#666;">Cíl / zpráva</td><td style="padding:8px 14px;border-bottom:1px solid #eee;">${diag.zprava}</td></tr>` : ''}
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
            reply_to: client.kupujici.email,
            subject: `✅ ZAPLACENO: ${packageName} – ${client.kupujici.jmeno}`,
            html: ownerPaidHtml
          })
        });
      }
    }

    // ── 3. AUTOMATICKÉ VYSTAVENÍ DALŠÍ SPLÁTKY ──
    if (client.is_installment && client.current_installment < client.total_installments) {
      try {
        const slug = 'krystofkoblas';
        const clientId = '4eec39db77ad7e5dc6da69e17153ffa50c8559d7';
        const clientSecret = '5cbf882f10ba944119cec3bf7d92527acb8ed990';
        const userAgent = 'KKoblas Web (koblas.nutricni.info@gmail.com)';

        const fToken = await getFakturoidToken(clientId, clientSecret, userAgent);
        
        const nextInstallmentNum = client.current_installment + 1;
        const dueDate = new Date();
        dueDate.setMonth(dueDate.getMonth() + 1);

        const invoicePayload = {
          subject_id: invoice.subject_id,
          document_type: 'proforma',
          due_date: dueDate.toISOString().split('T')[0],
          lines: [
            {
              name: `${client.sluzba_nazev || 'Nutriční balíček'} – ${nextInstallmentNum}. splátka z ${client.total_installments}`,
              quantity: 1,
              unit_price: client.installment_amount || 0,
              unit_name: 'ks'
            }
          ],
          note: `Automatická splátka (${nextInstallmentNum}/${client.total_installments})`
        };

        await fetch(`https://app.fakturoid.cz/api/v3/accounts/${slug}/invoices.json`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${fToken}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'User-Agent': userAgent
          },
          body: JSON.stringify(invoicePayload)
        });

        client.current_installment = nextInstallmentNum;
      } catch (splatkaErr) {
        console.error('Chyba při generování další splátky:', splatkaErr);
      }
    }

    await context.env.STATUS_STORE.put('CLIENTS', JSON.stringify(clients));

    return new Response(JSON.stringify({ ok: true, activated: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (err) {
    console.error('Chyba ve webhooku:', err);
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
