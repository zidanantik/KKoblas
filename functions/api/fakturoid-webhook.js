// functions/api/fakturoid-webhook.js

const OWNER_EMAIL = 'koblas.nutricni@gmail.com';

// ── VÝBER PREDVOLENEJ ŠABLÓNY (tpl-dark-gold | tpl-xmas-gold | tpl-clean-white | tpl-sport-energy) ──
const DEFAULT_VOUCHER_TEMPLATE = 'tpl-dark-gold';

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

// ── ŠABLÓNA PRE PDF PREVODNÍK ──
function buildVoucherHtml(giftCode, packageName, pkgSlug, templateClass) {
  const redeemUrl = `https://koblas-nutricni.cz/objednavka.html?sluzba=${encodeURIComponent(pkgSlug)}&kod=${encodeURIComponent(giftCode)}`;

  return `
    <!DOCTYPE html>
    <html lang="cs">
    <head>
      <meta charset="UTF-8">
      <style>
        @page { size: A4 landscape; margin: 10mm; }
        * { box-sizing: border-box; }
        body {
          margin: 0; padding: 20px; background: #0d0d0d;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          display: flex; align-items: center; justify-content: center; min-height: 95vh;
        }

        .voucher-brand-badge { position: relative; display: inline-flex; align-items: center; }
        .voucher-logo-img { height: 46px; width: auto; object-fit: contain; display: block; border-radius: 4px; }
        .xmas-cap {
          position: absolute; top: -16px; left: -14px; width: 34px; height: 34px;
          transform: rotate(-15deg); pointer-events: none;
          filter: drop-shadow(0 2px 4px rgba(0,0,0,0.6));
          display: none;
        }

        /* ── Šablona: Dark Gold ── */
        .tpl-dark-gold {
          width: 740px; background: #141414; color: #eee; border: 2px solid #c88a2c;
          border-radius: 12px; padding: 38px 40px; box-shadow: 0 10px 40px rgba(0,0,0,0.8);
          background-image: radial-gradient(circle at 100% 0%, rgba(200,138,44,0.12) 0%, transparent 60%);
        }
        .tpl-dark-gold .brand-title { font-family: Georgia, serif; font-size: 24px; color: #ff9900; margin: 0; }
        .tpl-dark-gold .brand-sub { font-family: monospace; font-size: 11px; color: #888; letter-spacing: 2px; margin-top: 3px; }
        .tpl-dark-gold .badge-type { background: rgba(200,138,44,0.15); border: 1px solid #c88a2c; color: #ff9900; font-family: monospace; font-size: 12px; padding: 5px 12px; border-radius: 4px; }
        .tpl-dark-gold .service-name { font-size: 20px; letter-spacing: 2px; color: #fff; text-transform: uppercase; font-weight: bold; margin-bottom: 6px; }
        .tpl-dark-gold .service-desc { color: #aaa; font-size: 15px; }
        .tpl-dark-gold .code-box { margin: 24px auto; padding: 16px 28px; background: #080808; border: 1px dashed #ff9900; border-radius: 8px; display: inline-block; }
        .tpl-dark-gold .code-text { font-family: monospace; font-size: 32px; font-weight: bold; color: #ff9900; letter-spacing: 6px; }
        .tpl-dark-gold .instructions { margin-top: 20px; font-size: 12px; color: #888; border-top: 1px solid rgba(255,255,255,0.06); padding-top: 18px; line-height: 1.6; }
        .tpl-dark-gold a { color: #ff9900; }

        /* ── Šablona: Vánoční Dark Gold ── */
        .tpl-xmas-gold {
          width: 740px; background: #141414; color: #eee; border: 2px solid #e74c3c;
          border-radius: 12px; padding: 38px 40px; box-shadow: 0 10px 40px rgba(0,0,0,0.8), 0 0 25px rgba(231,76,60,0.15);
          background-image: radial-gradient(circle at 100% 0%, rgba(231,76,60,0.15) 0%, transparent 60%);
        }
        .tpl-xmas-gold .xmas-cap { display: block !important; }
        .tpl-xmas-gold .brand-title { font-family: Georgia, serif; font-size: 24px; color: #ffaa22; margin: 0; }
        .tpl-xmas-gold .brand-sub { font-family: monospace; font-size: 11px; color: #aaa; letter-spacing: 2px; margin-top: 3px; }
        .tpl-xmas-gold .badge-type { background: rgba(231,76,60,0.2); border: 1px solid #e74c3c; color: #ff7875; font-family: monospace; font-size: 12px; padding: 5px 12px; border-radius: 4px; font-weight: bold; }
        .tpl-xmas-gold .service-name { font-size: 20px; letter-spacing: 2px; color: #fff; text-transform: uppercase; font-weight: bold; margin-bottom: 6px; }
        .tpl-xmas-gold .service-desc { color: #bbb; font-size: 15px; }
        .tpl-xmas-gold .code-box { margin: 24px auto; padding: 16px 28px; background: #080808; border: 1px dashed #e74c3c; border-radius: 8px; display: inline-block; }
        .tpl-xmas-gold .code-text { font-family: monospace; font-size: 32px; font-weight: bold; color: #ffaa22; letter-spacing: 6px; }
        .tpl-xmas-gold .instructions { margin-top: 20px; font-size: 12px; color: #888; border-top: 1px solid rgba(255,255,255,0.06); padding-top: 18px; line-height: 1.6; }
        .tpl-xmas-gold a { color: #ffaa22; }

        /* ── Šablona: Clean Minimal ── */
        .tpl-clean-white {
          width: 740px; background: #ffffff; color: #111111; border: 3px solid #111111;
          border-radius: 4px; padding: 38px 40px; box-shadow: 0 10px 40px rgba(0,0,0,0.4);
        }
        .tpl-clean-white .brand-title { font-family: Georgia, serif; font-size: 26px; color: #111; margin: 0; font-weight: bold; }
        .tpl-clean-white .brand-sub { font-family: monospace; font-size: 11px; color: #555; letter-spacing: 2px; margin-top: 3px; }
        .tpl-clean-white .badge-type { background: #111; border: 1px solid #111; color: #fff; font-family: monospace; font-size: 12px; padding: 5px 12px; border-radius: 2px; }
        .tpl-clean-white .service-name { font-size: 20px; letter-spacing: 2px; color: #000; text-transform: uppercase; font-weight: bold; margin-bottom: 6px; }
        .tpl-clean-white .service-desc { color: #444; font-size: 15px; }
        .tpl-clean-white .code-box { margin: 24px auto; padding: 16px 28px; background: #f4f4f4; border: 2px solid #111; border-radius: 4px; display: inline-block; }
        .tpl-clean-white .code-text { font-family: monospace; font-size: 32px; font-weight: bold; color: #000; letter-spacing: 6px; }
        .tpl-clean-white .instructions { margin-top: 20px; font-size: 12px; color: #555; border-top: 1px solid #ddd; padding-top: 18px; line-height: 1.6; }

        /* ── Šablona: Sport & Energy ── */
        .tpl-sport-energy {
          width: 740px; background: linear-gradient(135deg, #0f0f0f 0%, #1b1b1b 100%);
          color: #fff; border-left: 8px solid #ff5500; border-top: 1px solid #333; border-right: 1px solid #333; border-bottom: 1px solid #333;
          border-radius: 6px; padding: 38px 40px; box-shadow: 0 10px 40px rgba(0,0,0,0.8);
        }
        .tpl-sport-energy .brand-title { font-family: "Impact", "Arial Black", sans-serif; font-size: 28px; color: #ff5500; margin: 0; }
        .tpl-sport-energy .brand-sub { font-family: monospace; font-size: 11px; color: #999; letter-spacing: 2px; margin-top: 3px; }
        .tpl-sport-energy .badge-type { background: #ff5500; color: #fff; font-family: monospace; font-size: 12px; padding: 5px 12px; border-radius: 3px; font-weight: bold; }
        .tpl-sport-energy .service-name { font-size: 20px; letter-spacing: 2px; color: #fff; text-transform: uppercase; font-weight: bold; margin-bottom: 6px; }
        .tpl-sport-energy .service-desc { color: #ccc; font-size: 15px; }
        .tpl-sport-energy .code-box { margin: 24px auto; padding: 16px 28px; background: #000; border: 2px solid #ff5500; border-radius: 4px; display: inline-block; }
        .tpl-sport-energy .code-text { font-family: monospace; font-size: 32px; font-weight: bold; color: #ff5500; letter-spacing: 6px; }
        .tpl-sport-energy .instructions { margin-top: 20px; font-size: 12px; color: #888; border-top: 1px solid #2a2a2a; padding-top: 18px; line-height: 1.6; }
      </style>
    </head>
    <body>
      <div class="voucher-card ${templateClass}">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 20px; border-bottom: 1px solid rgba(125,125,125,0.2); margin-bottom: 25px;">
          <div style="display: flex; align-items: center; gap: 16px;">
            <div class="voucher-brand-badge">
              <img src="https://koblas-nutricni.cz/LOGO%20nov%C3%A9.webp" alt="KKoblas logo" class="voucher-logo-img">
              <svg class="xmas-cap" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 44 C 18 20, 38 12, 52 18 C 50 26, 44 38, 48 44 Z" fill="#e74c3c" stroke="#c0392b" stroke-width="1.5"/>
                <path d="M52 18 C 56 20, 58 26, 56 30" fill="none" stroke="#e74c3c" stroke-width="5" stroke-linecap="round"/>
                <circle cx="56" cy="31" r="5" fill="#ffffff" stroke="#ddd" stroke-width="1"/>
                <rect x="8" y="40" width="44" height="10" rx="5" fill="#ffffff" stroke="#eee" stroke-width="1"/>
              </svg>
            </div>
            <div>
              <h1 class="brand-title">KRYŠTOF KOBLAS</h1>
              <div class="brand-sub">NUTRIČNÍ ANALÝZA &amp; PORADENSTVÍ</div>
            </div>
          </div>
          <div class="badge-type">DÁRKOVÝ POUKAZ</div>
        </div>

        <div style="text-align: center; margin: 25px 0;">
          <div class="service-name">${packageName.toUpperCase()}</div>
          <div class="service-desc">100% Uhrazeno dárkovým certifikátem</div>

          <div class="code-box">
            <div class="code-text">${giftCode}</div>
          </div>

          <div class="instructions">
            Pro aktivaci poukazu navštivte <strong>koblas-nutricni.cz</strong> a v objednávce zadejte tento kód.<br>
            Přímý odkaz: <a href="${redeemUrl}">${redeemUrl}</a>
          </div>
        </div>
      </div>
    </body>
    </html>
  `;
}

// ── PREVOD HTML NA PDF CEZ PDFSHIFT API ──
async function convertHtmlToPdfBase64(htmlString, apiKey) {
  if (!apiKey) return null;
  const auth = btoa(`api:${apiKey.trim()}`);
  const res = await fetch('https://api.pdfshift.com/v3/convert/pdf', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      source: htmlString,
      landscape: true,
      use_print: true
    })
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`PDFShift chyba (${res.status}): ${errText}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(arrayBuffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
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

    // Ochrana proti duplicitným webhookom
    if (!Array.isArray(client.paid_invoice_ids)) {
      client.paid_invoice_ids = [];
    }
    if (client.paid_invoice_ids.map(String).includes(String(invoiceId))) {
      return new Response(JSON.stringify({ ok: true, message: 'Tato faktura již byla dříve zpracována' }), { status: 200 });
    }
    client.paid_invoice_ids.push(String(invoiceId));

    const resendKey = context.env.RESEND_API_KEY;
    const pdfshiftKey = context.env.PDFSHIFT_API_KEY;

    let sender = (context.env.FROM_DOMAIN || 'info@koblas-nutricni.cz').trim();
    if (!sender.includes('<')) {
      const cleanEmail = sender.includes('@') ? sender : `info@${sender}`;
      sender = `Kryštof Koblas <${cleanEmail}>`;
    }

    const pkgSlug = normalizePkg(client.sluzba || client.sluzba_nazev);
    const packageName = client.sluzba_nazev || 'nutriční program';

    // ── SCÉNÁR A: DARČEKOVÝ POUKAZ ──
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
        const voucherWebUrl = `https://koblas-nutricni.cz/voucher.html?kod=${encodeURIComponent(giftCode)}`;

        // Pokus o prevod do PDF
        let pdfBase64 = null;
        let pdfGenerationFailed = false;

        try {
          const voucherHtml = buildVoucherHtml(giftCode, packageName, pkgSlug, DEFAULT_VOUCHER_TEMPLATE);
          pdfBase64 = await convertHtmlToPdfBase64(voucherHtml, pdfshiftKey);
        } catch (pdfErr) {
          console.error('PDF generovanie zlyhalo, prepínam na fallback:', pdfErr);
          pdfGenerationFailed = true;
        }

        const attachments = [];
        if (pdfBase64) {
          attachments.push({
            filename: `Darkovy_poukaz_${giftCode}.pdf`,
            content: pdfBase64
          });
        }

        const plainTextGift = `Ahoj ${client.kupujici.jmeno},\n\nděkuji za úhradu dárkového poukazu na službu ${packageName}.\n\n`
          + (pdfBase64 ? `Dárkový poukaz ve formátu PDF najdeš přímo v příloze tohoto e-mailu.\n\n` : `Dárkový poukaz si můžeš otevřít a stáhnout zde:\n${voucherWebUrl}\n\n`)
          + `Kód dárkového poukazu: ${giftCode}\n`
          + `Obdarovaný poukaz aktivuje na adrese:\n${redeemUrl}\n\n`
          + `S pozdravem,\nKryštof Koblas`;

        const htmlGift = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; color: #222; line-height: 1.6; font-size: 15px;">
            <p>Ahoj ${client.kupujici.jmeno},</p>
            <p>děkuji za úhradu dárkového poukazu na službu <strong>${packageName}</strong>.</p>
            
            ${pdfBase64 ? `
              <div style="background: rgba(46,204,113,0.1); border-left: 4px solid #2ecc71; padding: 14px 18px; border-radius: 4px; margin: 20px 0;">
                📎 <strong>Dárkový certifikát byl vygenerován a přiložen v PDF k tomuto e-mailu.</strong>
              </div>
            ` : ''}

            <div style="background: #141414; border: 2px solid #c88a2c; padding: 25px; border-radius: 8px; margin: 25px 0; text-align: center; color: #fff;">
              <div style="font-size: 12px; color: #aaa; text-transform: uppercase; letter-spacing: 2px;">Kód dárkového poukazu</div>
              <div style="font-family: monospace; font-size: 28px; font-weight: bold; color: #ff9900; letter-spacing: 4px; margin: 10px 0;">${giftCode}</div>
              
              <div style="margin-top: 18px;">
                <a href="${voucherWebUrl}" target="_blank" style="display: inline-block; background: #ff9900; color: #000; font-weight: bold; font-family: monospace; font-size: 13px; padding: 10px 20px; border-radius: 4px; text-decoration: none;">
                  🖨 OTEVŘÍT / VYTISKNOUT POUKAZ ON-LINE →
                </a>
              </div>
            </div>

            <p style="font-size: 14px; color: #555;">
              Obdarovaný si může balíček aktivovat na adrese:<br>
              <a href="${redeemUrl}" style="color: #0066cc; word-break: break-all;">${redeemUrl}</a>
            </p>

            <p>Poukaz stačí obdarovanému předat (vytisknout nebo poslat PDF). Jakmile formulář odešle, převezmu si ho a diagnostiku i konzultace už vyřeším přímo s ním.</p>
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
            subject: `Dárkový poukaz – ${packageName} (Kód: ${giftCode})`,
            text: plainTextGift,
            html: htmlGift,
            attachments: attachments
          })
        });

        // Notifikácia na Gmail
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
                <p>Byl vygenerován kód: <strong>${giftCode}</strong></p>
                <p>Stav PDF přílohy: <strong>${pdfBase64 ? 'Vygenerována a odeslána v příloze' : 'Záložní režim (bez PDF, odeslán odkaz)'}</strong></p>
                ${pdfGenerationFailed ? '<p style="color:#e74c3c;">⚠️ PDF generátor vrátil chybu nebo chybí platný klíč PDFSHIFT_API_KEY.</p>' : ''}
              </div>
            `
          })
        });
      }

      await context.env.STATUS_STORE.put('CLIENTS', JSON.stringify(clients));
      return new Response(JSON.stringify({ ok: true, giftActivated: true }), { status: 200 });
    }

    // ── SCÉNÁR B: NÁSLEDNÁ SPLÁTKA (2., 3., 4., 5., 6.) ──
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
        const nextDate = new Date();
        nextDate.setDate(nextDate.getDate() + 30);
        client.next_installment_date = nextDate.toISOString().split('T')[0];

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

    // ── SCÉNÁR C: PRVÁ PLATBA (PRIAMY NÁKUP ALEBO 1. SPLÁTKA) ──
    client.status = 'aktivni';
    client.pocita_se = true;
    client.datum_platby = new Date().toISOString();

    const todayYMD = new Date().toISOString().split('T')[0];
    client.start_date = todayYMD;
    client.end_date = computeEndDate(todayYMD, client.sluzba_nazev || client.sluzba);

    if (client.is_installment && client.total_installments > 1) {
      const nextDate = new Date();
      nextDate.setDate(nextDate.getDate() + 30);
      client.next_installment_date = nextDate.toISOString().split('T')[0];
      client.next_installment_num = 2;
    }

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
