// functions/api/fakturoid-webhook.js

function generateGiftCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let res = '';
  for (let i = 0; i < 6; i++) {
    res += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return 'DAR-' + res;
}

// Pomocná funkce pro získání Fakturoid OAuth tokenu
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

    // 1. Načtení klientů z KV
    const rawClients = await context.env.STATUS_STORE.get('CLIENTS');
    let clients = rawClients ? JSON.parse(rawClients) : [];

    // Bezpečné porovnání ID bez ohledu na datový typ (číslo vs string)
    const clientIndex = clients.findIndex(c => String(c.fakturoid_id) === String(invoiceId));
    if (clientIndex === -1) {
      return new Response(JSON.stringify({ ok: true, message: 'Klient nenalezen v KV' }), { status: 200 });
    }

    const client = clients[clientIndex];

    if (client.status === 'aktivni' && !client.is_installment_pending) {
      return new Response(JSON.stringify({ ok: true, message: 'Klient již je aktivní' }), { status: 200 });
    }

    // 2. Aktivace klienta a uložení data platby
    client.status = 'aktivni';
    client.pocita_se = true;
    client.datum_platby = new Date().toISOString();

    const resendKey = context.env.RESEND_API_KEY;
    const fromDomain = context.env.FROM_DOMAIN || 'koblas-nutricni.cz';

    // 3. Pokud jde o dárkový poukaz -> vygenerovat kód a zapsat do PROMO_CODES
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
        packages: client.sluzba ? [client.sluzba.toLowerCase()] : [],
        active: true,
        used: false,
        usedCount: 0,
        createdAt: new Date().toISOString(),
        note: `${buyerName} (${purchaseDate})`
      };

      codes.unshift(newPromo);
      await context.env.STATUS_STORE.put('PROMO_CODES', JSON.stringify(codes));

      if (resendKey && client.kupujici && client.kupujici.email) {
        const redeemUrl = `https://${fromDomain}/objednavka.html?sluzba=${encodeURIComponent(client.sluzba)}&kod=${encodeURIComponent(giftCode)}`;

        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: `Kryštof Koblas <info@${fromDomain}>`,
            to: [client.kupujici.email],
            subject: `🎁 Tvůj dárkový poukaz je připraven! – Kód: ${giftCode}`,
            html: `
              <div style="font-family: sans-serif; max-width: 600px; color: #222; line-height: 1.6;">
                <h2 style="color: #ff9900;">Platba byla úspěšně přijata!</h2>
                <p>Ahoj ${client.kupujici.jmeno},</p>
                <p>děkuji za úhradu dárkového poukazu na službu <strong>${client.sluzba_nazev || 'Nutriční spolupráce'}</strong>.</p>
                
                <div style="background: #111; color: #fff; padding: 25px; border-radius: 8px; text-align: center; margin: 25px 0; border: 1px dashed #ff9900;">
                  <span style="font-size: 13px; letter-spacing: 2px; color: #aaa; text-transform: uppercase;">Unikátní kód poukazu</span>
                  <div style="font-family: monospace; font-size: 32px; font-weight: bold; color: #ff9900; letter-spacing: 6px; margin: 10px 0;">${giftCode}</div>
                  <p style="font-size: 13px; color: #ccc; margin-top: 15px;">
                    Obdarovaný poukaz aktivuje zadáním tohoto kódu na webu nebo přes přímý odkaz:<br>
                    <a href="${redeemUrl}" style="color: #ff9900; word-break: break-all;">${redeemUrl}</a>
                  </p>
                </div>

                <p>Tento poukaz můžeš obdarovanému poslat e-mailem nebo mu kód opsat do přáníčka.</p>
                <br>
                <p>S pozdravem,<br><strong>Kryštof Koblas</strong></p>
              </div>
            `
          })
        });
      }

    } else {
      // 4. Běžný přímý nákup -> uvítací e-mail
      if (resendKey && client.kupujici && client.kupujici.email) {
        const packageName = client.sluzba_nazev || 'nutriční program';

        const emailHtml = `
          <div style="font-family: sans-serif; max-width: 600px; color: #222; line-height: 1.6;">
            <h2 style="color: #2ecc71;">Platba dorazila! Info, co bude dál 🚀</h2>
            <p>Ahoj ${client.kupujici.jmeno},</p>
            <p>tvoje platba za balíček <strong>${packageName}</strong> dorazila v pořádku, díky moc! Oficiálně tak odmáváme startovní čáru a jdeme na to.</p>
            
            <p>Abychom hned chytili správný rytmus, tady je pár rychlých a důležitých info k tomu, jak budeme fungovat:</p>

            <h3 style="color: #ff9900; margin-top: 20px;">📱 JAK BUDEME V KONTAKTU?</h3>
            <ul>
              <li><strong>Prvně ti napíšu na WhatsApp:</strong> Co nejdříve se ti ozvu přímo na WhatsApp (+420 774 143 176), abychom se domluvili na termínu první online schůzky.</li>
              <li><strong>Klidně napiš sám/sama:</strong> Kdybych to náhodou nestihl hned nebo jsi chtěl/a začátek urychlit, klidně mi napiš jako první.</li>
              <li><strong>Čistě WhatsApp zprávy:</strong> Číslo používej primárně pro textové a hlasové zprávy. Každému se věnuji na maximum a jakmile mi to čas dovolí, hned odepisuju.</li>
              <li><strong>Spojení v aplikaci ZOF:</strong> Následně se propojíme i přímo v ZOFu.</li>
            </ul>

            <h3 style="color: #ff9900; margin-top: 20px;">⏱️ JAK JE TO S TVÝM ČASEM? (FÉROVÁ DOHODA)</h3>
            <ul>
              <li><strong>O svůj čas nepřijdeš:</strong> Čas balíčku ti začínám oficiálně počítat až ode dne naší první online schůzky (do té doby spolu ladíme jen podklady a diagnostiku).</li>
              <li><strong>Rušení schůzek:</strong> Když se schůzka předem vykomunikuje a přesune, nic se neděje. Pokud by se ale termíny rušily opakovaně bez omluvy, zaplacený čas začne běžet.</li>
            </ul>

            <h3 style="color: #ff9900; margin-top: 20px;">📊 ANALÝZA DAT (AŤ NEPLÝTVÁME ČASEM)</h3>
            <p>Od chvíle zaplacení už pracuju na tvých podkladech. Pokud už máš hotové InBody, pošli mi výsledky hned na WhatsApp nebo na e-mail: <strong>koblas.nutricni@gmail.com</strong>.</p>

            <p style="margin-top: 25px;">Všechno v klidu nastavíme tak, aby tě to bavilo a přineslo reálné výsledky.<br><br>Těším se na spolupráci!<br><strong>Kryštof Koblas</strong></p>
          </div>
        `;

        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: `Kryštof Koblas <info@${fromDomain}>`,
            to: [client.kupujici.email],
            subject: `koblas-nutricni.cz | Platba za ${packageName} dorazila! Info, co bude dál 🚀`,
            html: emailHtml
          })
        });
      }
    }

    // 5. Automatické vystavení další splátky ve Fakturoidu
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

    // Uložení aktualizovaného stavu klientů do KV
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
