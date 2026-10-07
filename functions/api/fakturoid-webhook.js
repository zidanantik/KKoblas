// functions/api/fakturoid-webhook.js

const OWNER_EMAIL = 'koblas.nutricni@gmail.com';

// ── VÝBĚR PŘEDVOLENÉ ŠABLONY PRO PDF ──
// Možnosti: 'tpl-nordic-snow' | 'tpl-easter' | 'tpl-summer-shape' | 'tpl-new-year' | 'tpl-birthday' | 'tpl-sport-energy' | 'tpl-dark-gold'
const DEFAULT_VOUCHER_TEMPLATE = 'tpl-nordic-snow';

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

// ── ŠABLONA PRO PDF PŘEVODNÍK (ROZMĚRY OPTIMALIZOVANÉ PRO 1 ROVNÝ STŘIH DO DL OBÁLKY) ──
function buildVoucherHtml(giftCode, packageName, pkgSlug, templateClass) {
  const redeemUrl = `https://koblas-nutricni.cz/objednavka.html?sluzba=${encodeURIComponent(pkgSlug)}&kod=${encodeURIComponent(giftCode)}`;

  return `
    <!DOCTYPE html>
    <html lang="cs">
    <head>
      <meta charset="UTF-8">
      <style>
        @page { 
          size: A4 portrait; 
          margin: 3mm 5mm 0 5mm; 
        }
        * { box-sizing: border-box; }
        body {
          margin: 0;
          padding: 0;
          background: #ffffff;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }

        .print-wrapper {
          width: 200mm;
          margin: 2mm auto 0 auto;
          position: relative;
          display: flex;
          flex-direction: column;
          align-items: center;
        }

        .voucher-card {
          width: 200mm;
          height: 86mm;
          position: relative;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          box-sizing: border-box;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }

        /* Rohové ořezové značky */
        .crop-mark {
          position: absolute;
          width: 12px;
          height: 12px;
          pointer-events: none;
          opacity: 0.75;
        }
        .crop-tl { top: -4px; left: -4px; border-top: 2px solid #777; border-left: 2px solid #777; }
        .crop-tr { top: -4px; right: -4px; border-top: 2px solid #777; border-right: 2px solid #777; }
        .crop-bl { bottom: -4px; left: -4px; border-bottom: 2px solid #777; border-left: 2px solid #777; }
        .crop-br { bottom: -4px; right: -4px; border-bottom: 2px solid #777; border-right: 2px solid #777; }

        /* Střižná čára s nůžkami – celková výška proužku po odstřižení je cca 95 mm */
        .cut-line-banner {
          width: 200mm;
          margin-top: 4mm;
          position: relative;
          border-top: 1.5px dashed #666;
          height: 1px;
        }
        .cut-line-banner::before {
          content: "✂";
          position: absolute;
          top: -11px;
          left: 0;
          font-size: 14px;
          color: #444;
          background: transparent;
          padding-right: 6px;
        }

        .voucher-brand-badge {
          position: relative;
          display: inline-flex;
          align-items: center;
        }
        .voucher-logo-img {
          height: 38px;
          width: auto;
          object-fit: contain;
          display: block;
          border-radius: 4px;
        }

        .season-icon { display: none; }
        
        .xmas-cap {
          position: absolute;
          top: -14px;
          left: -12px;
          width: 28px;
          height: 28px;
          transform: rotate(-15deg);
          pointer-events: none;
          filter: drop-shadow(0 2px 4px rgba(0,0,0,0.4));
        }

        .xmas-tree-bg {
          position: absolute;
          right: -20px;
          bottom: -12px;
          width: 60px;
          height: 70px;
          pointer-events: none;
          z-index: 1;
          opacity: 0.85;
          filter: drop-shadow(0 2px 4px rgba(0,0,0,0.1));
        }

        .easter-whip {
          position: absolute;
          right: -14px;
          bottom: -10px;
          width: 55px;
          height: 65px;
          pointer-events: none;
          z-index: 1;
          filter: drop-shadow(0 2px 4px rgba(0,0,0,0.12));
        }

        .summer-shape {
          position: absolute;
          right: -12px;
          bottom: -8px;
          width: 65px;
          height: 65px;
          pointer-events: none;
          z-index: 1;
          opacity: 0.9;
          filter: drop-shadow(0 2px 5px rgba(0,0,0,0.2));
        }

        .code-wrapper {
          position: relative;
          display: inline-block;
          margin: 6px auto;
        }

        /* ── NORDIC SNOW ── */
        .tpl-nordic-snow {
          background: #ffffff;
          color: #1a1a1a;
          border: 2px solid #d4af37;
          border-radius: 6px;
          padding: 16px 24px;
        }
        .tpl-nordic-snow .xmas-cap, .tpl-nordic-snow .xmas-tree-bg { display: block !important; }
        .tpl-nordic-snow .brand-title { font-family: Georgia, serif; font-size: 19px; color: #111; margin: 0; font-weight: bold; }
        .tpl-nordic-snow .brand-sub { font-family: monospace; font-size: 9.5px; color: #666; letter-spacing: 2px; margin-top: 1px; }
        .tpl-nordic-snow .badge-type { background: #f0f7ff; border: 1.5px solid #74c0fc; color: #1c7ed6; font-family: monospace; font-size: 10.5px; padding: 3px 8px; border-radius: 4px; font-weight: bold; }
        .tpl-nordic-snow .service-name { font-size: 16.5px; letter-spacing: 2px; color: #111; text-transform: uppercase; font-weight: bold; margin-bottom: 1px; }
        .tpl-nordic-snow .service-desc { color: #555; font-size: 12.5px; }
        .tpl-nordic-snow .code-box { position: relative; z-index: 2; padding: 6px 18px; background: rgba(255, 255, 255, 0.94); border: 2px dashed #d4af37; border-radius: 6px; display: inline-block; }
        .tpl-nordic-snow .code-text { font-family: monospace; font-size: 24px; font-weight: bold; color: #111; letter-spacing: 4px; }
        .tpl-nordic-snow .instructions { font-size: 10.5px; color: #666; border-top: 1px solid #eee; padding-top: 6px; line-height: 1.35; }
        .tpl-nordic-snow a { color: #1c7ed6; font-weight: 600; text-decoration: none; }

        /* ── DARK GOLD ── */
        .tpl-dark-gold {
          background: #141414; color: #eee; border: 2px solid #c88a2c; border-radius: 6px; padding: 16px 24px;
        }
        .tpl-dark-gold .brand-title { font-family: Georgia, serif; font-size: 19px; color: #ff9900; margin: 0; }
        .tpl-dark-gold .brand-sub { font-family: monospace; font-size: 9.5px; color: #888; letter-spacing: 2px; margin-top: 1px; }
        .tpl-dark-gold .badge-type { background: rgba(200,138,44,0.15); border: 1px solid #c88a2c; color: #ff9900; font-family: monospace; font-size: 10.5px; padding: 3px 8px; border-radius: 4px; }
        .tpl-dark-gold .service-name { font-size: 16.5px; letter-spacing: 2px; color: #fff; text-transform: uppercase; font-weight: bold; margin-bottom: 1px; }
        .tpl-dark-gold .service-desc { color: #aaa; font-size: 12.5px; }
        .tpl-dark-gold .code-box { padding: 6px 18px; background: #080808; border: 1px dashed #ff9900; border-radius: 6px; display: inline-block; }
        .tpl-dark-gold .code-text { font-family: monospace; font-size: 24px; font-weight: bold; color: #ff9900; letter-spacing: 4px; }
        .tpl-dark-gold .instructions { font-size: 10.5px; color: #888; border-top: 1px solid rgba(255,255,255,0.06); padding-top: 6px; line-height: 1.35; }
        .tpl-dark-gold a { color: #ff9900; font-weight: bold; }
      </style>
    </head>
    <body>
      <div class="print-wrapper">
        <div class="voucher-card ${templateClass}">
          <div class="crop-mark crop-tl"></div>
          <div class="crop-mark crop-tr"></div>
          <div class="crop-mark crop-bl"></div>
          <div class="crop-mark crop-br"></div>

          <!-- Horní část -->
          <div style="display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 8px; border-bottom: 1px solid rgba(125,125,125,0.2);">
            <div style="display: flex; align-items: center; gap: 12px;">
              <div class="voucher-brand-badge">
                <img src="https://koblas-nutricni.cz/LOGO%20nov%C3%A9.webp" alt="KKoblas logo" class="voucher-logo-img">
                <svg class="season-icon xmas-cap" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M12 44 C 18 20, 38 12, 52 18 C 50 26, 44 38, 48 44 Z" fill="#e03131" stroke="#c92a2a" stroke-width="1.5"/>
                  <path d="M52 18 C 56 20, 58 26, 56 30" fill="none" stroke="#e03131" stroke-width="4.5" stroke-linecap="round"/>
                  <circle cx="56" cy="31" r="5.5" fill="#a5d8ff" stroke="#74c0fc" stroke-width="1.2"/>
                  <rect x="8" y="40" width="44" height="9" rx="4.5" fill="#d0ebff" stroke="#a5d8ff" stroke-width="1.2"/>
                </svg>
              </div>

              <div>
                <h1 class="brand-title">KRYŠTOF KOBLAS</h1>
                <div class="brand-sub">NUTRIČNÍ ANALÝZA &amp; PORADENSTVÍ</div>
              </div>
            </div>

            <div class="badge-type">
              <span>DÁRKOVÝ POUKAZ</span>
            </div>
          </div>

          <!-- Střední část -->
          <div style="text-align: center; margin: 4px 0;">
            <div class="service-name">${packageName.toUpperCase()}</div>
            <div class="service-desc">100% Uhrazeno dárkovým certifikátem</div>

            <div class="code-wrapper">
              <div class="code-box">
                <div class="code-text">${giftCode}</div>
              </div>

              <svg class="season-icon xmas-tree-bg" viewBox="0 0 100 120" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="44" y="98" width="12" height="18" rx="2" fill="#795548" />
                <polygon points="50,15 20,52 35,52 12,80 30,80 5,102 95,102 70,80 88,80 65,52 80,52" fill="#2b8a3e" />
                <polygon points="50,15 28,48 40,48 20,74 38,74 15,98 85,98 62,74 80,74 60,48 72,48" fill="#2f9e44" />
                <polygon points="50,4 53,13 62,13 55,18 57,27 50,22 43,27 45,18 38,13 47,13" fill="#fcc419" />
                <circle cx="34" cy="90" r="3.5" fill="#e03131" />
                <circle cx="66" cy="88" r="3.5" fill="#74c0fc" />
                <circle cx="48" cy="72" r="3.5" fill="#fcc419" />
                <circle cx="38" cy="62" r="3" fill="#e03131" />
                <circle cx="62" cy="60" r="3" fill="#ffffff" />
                <circle cx="50" cy="40" r="2.5" fill="#74c0fc" />
              </svg>
            </div>
          </div>

          <!-- Spodní část -->
          <div class="instructions" style="text-align: center;">
            Pro aktivaci navštivte <strong>koblas-nutricni.cz</strong> a zadejte kód.<br>
            Přímý odkaz: <a href="${redeemUrl}">${redeemUrl}</a>
          </div>
        </div>

        <!-- Střižná linka přesně v úrovni pro obálku DL -->
        <div class="cut-line-banner"></div>
      </div>
    </body>
    </html>
  `;
}

// ── PŘEVOD HTML NA PDF PŘES PDFSHIFT API (A4 PORTRAIT) ──
async function convertHtmlToPdfBase64(htmlString, apiKey) {
  if (!apiKey) {
    throw new Error('Chybí proměnná prostředí PDFSHIFT_API_KEY v Cloudflare.');
  }

  const cleanKey = apiKey.trim();
  const res = await fetch('https://api.pdfshift.io/v3/convert/pdf', {
    method: 'POST',
    headers: {
      'X-API-Key': cleanKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      source: htmlString,
      format: 'A4',
      landscape: false,
      margin: '0px'
    })
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`PDFShift HTTP ${res.status}: ${errText}`);
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

    // Ochrana proti duplicitním webhookům
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
        const voucherWebUrl = `https://koblas-nutricni.cz/voucher.html?kod=${encodeURIComponent(giftCode)}`;

        // Pokus o převod do PDF přes PDFShift (DL formát s linkou)
        let pdfBase64 = null;
        let pdfGenerationFailed = false;
        let pdfErrorDetail = '';

        try {
          const voucherHtml = buildVoucherHtml(giftCode, packageName, pkgSlug, DEFAULT_VOUCHER_TEMPLATE);
          pdfBase64 = await convertHtmlToPdfBase64(voucherHtml, pdfshiftKey);
        } catch (pdfErr) {
          console.error('PDF generování selhalo, přepínám na fallback:', pdfErr);
          pdfGenerationFailed = true;
          pdfErrorDetail = pdfErr.message || String(pdfErr);
        }

        const attachments = [];
        if (pdfBase64) {
          attachments.push({
            filename: `Darkovy_poukaz_${giftCode}.pdf`,
            content: pdfBase64
          });
        }

        const plainTextGift = `Ahoj ${client.kupujici.jmeno},\n\nděkuji za úhradu dárkového poukazu na službu ${packageName}.\n\n`
          + (pdfBase64 
              ? `Dárkový certifikát v PDF (formát DL do obálky) najdeš přímo v příloze tohoto e-mailu.\n\nPokud bys chtěl jiný vzhled poukazu, na odkazu níže si můžeš vybrat z dalších předpřipravených stylů podle příležitosti:\n${voucherWebUrl}\n\n` 
              : `Dárkový poukaz si můžeš otevřít, vybrat si z několika předpřipravených stylů podle příležitosti a stáhnout nebo vytisknout zde:\n${voucherWebUrl}\n\n`
            )
          + `Kód dárkového poukazu: ${giftCode}\n`
          + `Obdarovaný poukaz aktivuje na adrese:\n${redeemUrl}\n\n`
          + `Poukaz stačí obdarovanému předat (vytisknout nebo poslat PDF). Jakmile formulář odešle, převezmu si ho a diagnostiku i konzultace už vyřeším přímo s ním.\n\n`
          + `S pozdravem,\nKryštof Koblas\nkoblas-nutricni.cz`;

        const htmlGift = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; color: #222; line-height: 1.6; font-size: 15px;">
            <p>Ahoj ${client.kupujici.jmeno},</p>
            <p>děkuji za úhradu dárkového poukazu na službu <strong>${packageName}</strong>.</p>
            
            ${pdfBase64 ? `
              <div style="background: rgba(46,204,113,0.1); border-left: 4px solid #2ecc71; padding: 14px 18px; border-radius: 4px; margin: 20px 0;">
                📎 <strong>Dárkový certifikát máš přiložený v PDF přímo k tomuto e-mailu.</strong><br>
                <span style="color: #444; font-size: 13.5px;">Je připravený k tisku na A4 a jednoduchému odstřižení podél vyznačené linky přesně do podlouhlé DL obálky.</span>
              </div>

              <p style="font-size: 14px; color: #555; margin-bottom: 20px;">
                💡 <strong>Chceš jiný vzhled?</strong> I když máš hotové PDF v příloze, na odkazu níže si můžeš v horní nabídce vybrat z několika dalších připravených stylů podle příležitosti a poukaz si stáhnout nebo vytisknout v jiném provedení.
              </p>
            ` : `
              <div style="background: rgba(200,138,44,0.1); border-left: 4px solid #c88a2c; padding: 14px 18px; border-radius: 4px; margin: 20px 0;">
                📄 <strong>Dárkový certifikát je připraven on-line.</strong><br>
                <span style="color: #444; font-size: 13.5px;">Klikni na tlačítko níže, kde si můžeš vybrat z několika předpřipravených stylů podle příležitosti a poukaz rovnou vytisknout nebo uložit do PDF.</span>
              </div>
            `}

            <div style="background: #141414; border: 2px solid #c88a2c; padding: 25px; border-radius: 8px; margin: 25px 0; text-align: center; color: #fff;">
              <div style="font-size: 12px; color: #aaa; text-transform: uppercase; letter-spacing: 2px;">Kód dárkového poukazu</div>
              <div style="font-family: monospace; font-size: 28px; font-weight: bold; color: #ff9900; letter-spacing: 4px; margin: 10px 0;">${giftCode}</div>
              
              <div style="margin-top: 18px;">
                <a href="${voucherWebUrl}" target="_blank" style="display: inline-block; background: #ff9900; color: #000; font-weight: bold; font-family: monospace; font-size: 13px; padding: 10px 20px; border-radius: 4px; text-decoration: none;">
                  🖨 OTEVŘÍT / VYBRAT JINÝ VZHLED ON-LINE →
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

        // Notifikace na Gmail majitele
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
                <p>Stav PDF přílohy: <strong>${pdfBase64 ? 'Vygenerována v DL formátu s ořezem a odeslána v příloze' : 'Záložní režim (bez PDF, odeslán odkaz)'}</strong></p>
                ${pdfGenerationFailed ? `<p style="color:#e74c3c;">⚠️ PDF generátor selhal.<br><small style="color:#666;">Důvod: ${pdfErrorDetail}</small></p>` : ''}
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

// ── SCÉNÁŘ C: PRVNÍ PLATBA (PŘÍMÝ NÁKUP NEBO 1. SPLÁTKA) ──
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

    // 👉 AUTOMATICKÉ ZALOŽENÍ V NOTIONU PŘI PŘIJETÍ PLATBY
    try {
      const diag = client.diagnostika || {};
      const vekNum = Number(diag.vek) || 0;
      const isChild = vekNum > 0 && vekNum < 18;

      const rawHeight = parseFloat(diag.vyska) || 0;
      const vyskaM = rawHeight > 3 ? Number((rawHeight / 100).toFixed(2)) : rawHeight;

      let pohlaviValue = diag.pohlavi;
      if (isChild) {
        if (pohlaviValue === 'Muž' || pohlaviValue === 'Muz' || pohlaviValue === 'Kluk') pohlaviValue = 'Kluk';
        if (pohlaviValue === 'Žena' || pohlaviValue === 'Zena' || pohlaviValue === 'Holka') pohlaviValue = 'Holka';
      }

      const syncRes = await fetch('https://nutri-api.koblas-nutricni.workers.dev/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          createClient: true,
          jmeno: (client.kupujici && client.kupujici.jmeno) || 'Nový klient',
          sluzba: client.sluzba_nazev || client.sluzba || '',
          startDate: client.start_date || null,
          endDate: client.end_date || null,
          isChild: isChild,
          zapis: 'Vstupní dotazník (web)',
          datum: client.start_date || todayYMD,
          vaha: parseFloat(diag.vaha) || 0,
          vyska: vyskaM,
          vek: vekNum,
          pas: parseFloat(diag.obvod_pasu) || 0,
          boky: parseFloat(diag.obvod_boku) || 0,
          pohlavi: pohlaviValue
        })
      });

      if (syncRes.ok) {
        const syncData = await syncRes.json();
        if (syncData.clientPageId) {
          client.notion_client_id = syncData.clientPageId;
        }
      }
    } catch (notionErr) {
      console.error('Chyba při automatickém zápisu do Notionu po platbě:', notionErr);
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

      // Zjištění souhlasu z profilu klienta
      const hasConsent = Boolean(client.souhlas_reference === true || diag.souhlas_reference === true);

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
            ${diag.obvod_pasu ? `<tr><td style="padding:8px 14px;border-bottom:1px solid #eee;color:#666;">Obvod pasu</td><td style="padding:8px 14px;border-bottom:1px solid #eee;font-weight:bold;">${diag.obvod_pasu} cm</td></tr>` : ''}
            ${diag.obvod_boku ? `<tr><td style="padding:8px 14px;border-bottom:1px solid #eee;color:#666;">Obvod boků</td><td style="padding:8px 14px;border-bottom:1px solid #eee;font-weight:bold;">${diag.obvod_boku} cm</td></tr>` : ''}
            ${diag.zprava ? `<tr><td style="padding:8px 14px;border-bottom:1px solid #eee;color:#666;">Cíl / zpráva</td><td style="padding:8px 14px;border-bottom:1px solid #eee;">${diag.zprava}</td></tr>` : ''}
            
            <tr><td colspan="2" style="background:#1a1a1a;color:#f39c12;padding:10px 14px;font-weight:bold;">Marketingový souhlas (Reference)</td></tr>
            <tr>
              <td style="padding:8px 14px;border-bottom:1px solid #eee;color:#666;">Souhlas s referencemi</td>
              <td style="padding:8px 14px;border-bottom:1px solid #eee;font-weight:bold;color:${hasConsent ? '#2ecc71' : '#e74c3c'};">
                ${hasConsent ? '✅ ANO (udělen – anonymní grafy/fotky)' : '❌ NE (neudělen)'}
              </td>
            </tr>
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
