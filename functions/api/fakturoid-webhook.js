// functions/api/fakturoid-webhook.js

function generateGiftCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let res = '';
  for (let i = 0; i < 6; i++) {
    res += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return 'DAR-' + res;
}

export async function onRequestPost(context) {
  try {
    const payload = await context.request.json();
    const eventName = payload.event_name || payload.event;
    const invoice = (payload.body && payload.body.invoice) || payload.invoice || payload;

    // Zajímá nás událost zaplacení faktury / proformy
    if (eventName !== 'invoice_paid') {
      return new Response(JSON.stringify({ ignored: true, event: eventName }), { status: 200 });
    }

    const invoiceId = invoice.id;
    if (!invoiceId) {
      return new Response(JSON.stringify({ ok: false, error: 'Chybí invoice ID' }), { status: 400 });
    }

    // 1. Načteme klienty z KV
    const rawClients = await context.env.STATUS_STORE.get('CLIENTS');
    let clients = rawClients ? JSON.parse(rawClients) : [];

    // Najdeme klienta podle Fakturoid ID
    const clientIndex = clients.findIndex(c => c.fakturoid_id === invoiceId);
    if (clientIndex === -1) {
      return new Response(JSON.stringify({ ok: true, message: 'Klient nenalezen (není z webu)' }), { status: 200 });
    }

    const client = clients[clientIndex];

    // Pokud už byl dříve aktivován, nic znovu neprovádíme (idempotence)
    if (client.status === 'aktivni') {
      return new Response(JSON.stringify({ ok: true, message: 'Klient již je aktivní' }), { status: 200 });
    }

    // 2. AKTIVACE KLIENTA (+1 do kapacity)
    client.status = 'aktivni';
    client.pocita_se = true;
    client.datum_platby = new Date().toISOString();

    const resendKey = context.env.RESEND_API_KEY;
    const fromDomain = context.env.FROM_DOMAIN || 'koblas-nutricni.cz';

    // 3. POKUD JDE O DÁREK -> VYGENEROVAT KÓD A POSLAT KUPUJÍCÍMU
    if (client.is_gift) {
      const giftCode = generateGiftCode();
      client.kod_voucheru = giftCode;

      // Uložíme nový kód do PROMO_CODES
      const rawCodes = await context.env.STATUS_STORE.get('PROMO_CODES');
      let codes = rawCodes ? JSON.parse(rawCodes) : [];

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
        createdAt: new Date().toISOString()
      };

      codes.unshift(newPromo);
      await context.env.STATUS_STORE.put('PROMO_CODES', JSON.stringify(codes));

      // Odešleme dárkový e-mail kupujícímu
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
      // 4. BĚŽNÝ NÁKUP -> UVÍTACÍ E-MAIL KLIENTOVI
      if (resendKey && client.kupujici && client.kupujici.email) {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: `Kryštof Koblas <info@${fromDomain}>`,
            to: [client.kupujici.email],
            subject: `Platba přijata – Vítej v programu ${client.sluzba_nazev || ''}!`,
            html: `
              <div style="font-family: sans-serif; max-width: 600px; color: #222; line-height: 1.6;">
                <h2 style="color: #2ecc71;">Platba byla v pořádku připsána!</h2>
                <p>Ahoj ${client.kupujici.jmeno},</p>
                <p>tvoje úhrada za program <strong>${client.sluzba_nazev || 'Nutriční spolupráce'}</strong> dorazila. Tímto je tvé místo oficiálně rezervováno.</p>
                <p>Během zítřka tě budu osobně kontaktovat ohledně domluvy úvodního termínu a dalších kroků.</p>
                <br>
                <p>Těším se na společné výsledky!<br><strong>Kryštof Koblas</strong></p>
              </div>
            `
          })
        });
      }
    }

    // Uložíme aktualizovaný seznam klientů do KV
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
