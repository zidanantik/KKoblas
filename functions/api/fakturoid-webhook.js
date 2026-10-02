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

    const clientIndex = clients.findIndex(c => 
      String(c.fakturoid_id) === String(invoiceId) ||
      (Array.isArray(c.invoice_ids) && c.invoice_ids.map(String).includes(String(invoiceId)))
    );

    if (clientIndex === -1) {
      return new Response(JSON.stringify({ ok: true, message: 'Klient nenalezen v KV' }), { status: 200 });
    }

    const client = clients[clientIndex];

    // Ochrana proti duplicitním webhookům
    if (!Array.isArray(client.paid_invoice_ids)) {
      client.paid_invoice_ids = [];
    }
    if (client.paid_invoice_ids.map(String).includes(String(invoiceId))) {
      return new Response(JSON.stringify({ ok: true, message: 'Tato faktura již byla dříve zpracována' }), { status: 200 });
    }
    client.paid_invoice_ids.push(String(invoiceId));

    const resendKey = context.env.RESEND_API_KEY;

    let sender = (context.env.FROM_DOMAIN || 'info@koblas-nutricni.cz').trim();
    if (!sender.includes('<')) {
      const cleanEmail = sender.includes('@') ? sender : `info@${sender}`;
      sender = `Kryštof Koblas <${cleanEmail}>`;
    }

    const pkgSlug = normalizePkg(client.sluzba || client.sluzba_nazev);
    const packageName = client.sluzba_nazev || 'nutriční program';

    // ── SCÉNÁŘ A: DÁRKOVÝ POUKAZ ──
    if (client.is_gift) {
      client.status = 'aktivni';
      client.pocita_se = true;
      client.datum_platby = new Date().toISOString();

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

        const plainTextGift = `Ahoj ${client.kupujici.jmeno},\n\nděkuji za úhradu dárkového poukazu na službu ${packageName}.\n\nKód dárkového poukazu:\n${giftCode}\n\nObdarovaný poukaz aktivuje na adrese:\n${redeemUrl}\n\nTento kód stačí obdarovanému předat. Všechny další kroky a diagnostiku už vyřeším přímo s ním.\n\nS pozdravem,\nKryštof Koblas`;

        const htmlGift = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; color: #222; line-height: 1.6; font-size: 15px;">
            <p>Ahoj ${client.kupujici.jmeno},</p>
            <p>děkuji za úhradu dárkového poukazu na službu <strong>${packageName}</strong>.</p>
            
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
            subject: `DÁREK ZAPLACEN: ${packageName} – Kód: ${giftCode}`,
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

      await context.env.STATUS_STORE.put('CLIENTS', JSON.stringify(clients));
      return new Response(JSON.stringify({ ok: true, giftActivated: true }), { status: 200 });
    }

    // ── SCÉNÁŘ B: NÁSLEDNÁ SPLÁTKA (2., 3., 4., 5., 6.) ──
    if (client.is_installment && client.status === 'aktivni') {
      const paidInstallmentNum = client.current_installment;
      const isFinal = paidInstallmentNum >= client.total_installments;

      if (isFinal) {
        client.fully_paid = true;
        client.next_installment_date = null;

        if (resendKey && client.kupujici && client.kupujici.email) {
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
              subject: `Potvrzení úhrady poslední splátky – ${packageName}`,
              text: `Ahoj ${client.kupujici.jmeno},\n\ntvoje poslední (${paidInstallmentNum}.) splátka za balíček ${packageName} v pořádku dorazila. Tím máš celý program kompletně doplacen!\n\nDíky moc a makáme dál!\nKryštof Koblas`,
              html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; color: #222; line-height: 1.6; font-size: 15px;">
                  <p>Ahoj ${client.kupujici.jmeno},</p>
                  <p>tvoje <strong>poslední (${paidInstallmentNum}. z ${client.total_installments})</strong> splátka za balíček <strong>${packageName}</strong> v pořádku dorazila.</p>
                  <p style="color: #2ecc71; font-weight: bold; font-size: 16px;">Tím máš celý nutriční program kompletně doplacen!</p>
                  <p>Díky moc za skvělou spolupráci a pokračujeme v plnění tvých cílů.</p>
                  <p style="margin-top: 25px;">Kryštof Koblas<br><span style="color: #666; font-size: 13px;">koblas-nutricni.cz</span></p>
                </div>
              `
            })
          });
        }

        if (resendKey) {
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
              subject: `✅ KOMPLETNĚ DOPLACENO (${paidInstallmentNum}/${client.total_installments}): ${packageName} – ${client.kupujici.jmeno}`,
              html: `
                <div style="font-family:sans-serif;max-width:640px;color:#222;">
                  <h3 style="color:#2ecc71;">Klient doplatil celou částku programu!</h3>
                  <p>Klient <strong>${client.kupujici.jmeno}</strong> právě uhradil finální ${paidInstallmentNum}. splátku balíčku <strong>${packageName}</strong>.</p>
                  <p>Všechny splátky (${client.total_installments} z ${client.total_installments}) jsou řádně uzavřeny.</p>
                </div>
              `
            })
          });
        }

      } else {
        // Mezi-splátka byla uhrazena -> Naplánujeme termín té další na +30 dní odteď
        const nextDate = new Date();
        nextDate.setDate(nextDate.getDate() + 30);
        client.next_installment_date = nextDate.toISOString().split('T')[0];

        // Potvrzení klientovi o přijetí mezisplátky
        if (resendKey && client.kupujici && client.kupujici.email) {
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
              subject: `Potvrzení úhrady ${paidInstallmentNum}. splátky – ${packageName}`,
              text: `Ahoj ${client.kupujici.jmeno},\n\ntvoje ${paidInstallmentNum}. splátka z ${client.total_installments} za balíček ${packageName} v pořádku dorazila. Díky moc a makáme dál!\n\nKryštof Koblas`,
              html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; color: #222; line-height: 1.6; font-size: 15px;">
                  <p>Ahoj ${client.kupujici.jmeno},</p>
                  <p>tvoje <strong>${paidInstallmentNum}. splátka z ${client.total_installments}</strong> za balíček <strong>${packageName}</strong> dorazila v pořádku.</p>
                  <p>Díky moc a pokračujeme dál v nastaveném režimu!</p>
                  <p style="margin-top: 25px;">Kryštof Koblas<br><span style="color: #666; font-size: 13px;">koblas-nutricni.cz</span></p>
                </div>
              `
            })
          });
        }

        // Notifikace tobě
        if (resendKey) {
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
              subject: `✅ ZAPLACENO: ${paidInstallmentNum}. splátka (${paidInstallmentNum}/${client.total_installments}) – ${packageName} – ${client.kupujici.jmeno}`,
              html: `
                <div style="font-family:sans-serif;max-width:640px;color:#222;">
                  <h3 style="color:#2ecc71;">Přijata další splátka (${paidInstallmentNum}/${client.total_installments})!</h3>
                  <p>Klient <strong>${client.kupujici.jmeno}</strong> uhradil ${paidInstallmentNum}. splátku na <strong>${packageName}</strong>.</p>
                  <p>Další splátka bude vystavena automaticky až v termínu: <strong>${client.next_installment_date}</strong>.</p>
                </div>
              `
            })
          });
        }
      }

      await context.env.STATUS_STORE.put('CLIENTS', JSON.stringify(clients));
      return new Response(JSON.stringify({ ok: true, installmentPaid: paidInstallmentNum }), { status: 200 });
    }

    // ── SCÉNÁŘ C: PRVNÍ PLATBA (PŘÍMÝ NÁKUP NEBO 1. SPLÁTKA) ──
    client.status = 'aktivni';
    client.pocita_se = true;
    client.datum_platby = new Date().toISOString();

    // Automatický výpočet termínů začátku a ukončení
    const todayYMD = new Date().toISOString().split('T')[0];
    client.start_date = todayYMD;
    client.end_date = computeEndDate(todayYMD, client.sluzba_nazev || client.sluzba);

    // Pokud jde o splátky, naplánujeme 2. splátku na +30 dní
    if (client.is_installment && client.total_installments > 1) {
      const nextDate = new Date();
      nextDate.setDate(nextDate.getDate() + 30);
      client.next_installment_date = nextDate.toISOString().split('T')[0];
      client.next_installment_num = 2;
    }

    // 1. Uvítací e-mail klientovi (se ZOFem a InBody)
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

    // 2. Notifikace tobě na Gmail
    if (resendKey) {
      await new Promise(r => setTimeout(r, 600));

      const diag = client.diagnostika || {};
      const cleanPhone = (client.kupujici.telefon || '').replace(/[^\d+]/g, '');
      const waLink = cleanPhone.startsWith('+') ? `https://wa.me/${cleanPhone.replace('+', '')}` : `https://wa.me/420${cleanPhone}`;

      let paidTitle = client.is_installment 
        ? `✅ ZAPLACENO: 1. splátka (1/${client.total_installments}) – ${packageName} – ${client.kupujici.jmeno}`
        : `✅ ZAPLACENO: ${packageName} – ${client.kupujici.jmeno}`;

      let statusMsg = client.is_installment 
        ? `1. splátka dorazila na účet! Klientovi byl odeslán uvítací e-mail se ZOFem a InBody. 2. splátka je naplánována k vystavení až na termín: ${client.next_installment_date}.`
        : `Platba dorazila na účet! Klientovi byl odeslán uvítací e-mail se ZOFem a InBody. Můžeš se mu ozvat.`;

      const ownerPaidHtml = `
        <div style="font-family:sans-serif;max-width:640px;color:#222;">
          <h2 style="color:#2ecc71;margin-top:0;">${paidTitle}</h2>
          
          <div style="background:#d4edda;color:#155724;padding:12px 15px;border-radius:4px;margin-bottom:20px;font-weight:bold;">
            ${statusMsg}
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
          subject: paidTitle,
          html: ownerPaidHtml
        })
      });
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
