// functions/api/objednavka.js

const REQUIRED_CONTACT = ['Jmeno', 'Email', 'Telefon', 'Ulice', 'Mesto', 'PSC', 'Zeme'];
const REQUIRED_ANALYSIS = ['Vek', 'Pohlavi', 'Vyska_cm', 'Vaha_kg'];

export async function onRequestPost(context) {
  try {
    const body = await context.request.json();
    const isGift = body.Je_darek === 'ano' || body.Koupit_jako_darek === 'ano';

    // Pro nákup dárku nevyžadujeme tělesné míry
    const requiredFields = isGift
      ? REQUIRED_CONTACT
      : [...REQUIRED_CONTACT, ...REQUIRED_ANALYSIS];

    for (const field of requiredFields) {
      if (!body[field] || String(body[field]).trim() === '') {
        return new Response(JSON.stringify({ ok: false, error: `Chybí povinné pole: ${field}` }), {
          status: 400,
          headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });
      }
    }

    // Automatické přičtení použití kódu do Cloudflare KV
    const usedCode = (body.Pouzity_kod || '').trim();
    if (usedCode && context.env.STATUS_STORE) {
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
      } catch (kvErr) {
        console.error('Chyba při aktualizaci kódu v KV:', kvErr);
      }
    }

    const icoHtml = body.ICO
      ? `<tr><td style="padding:8px 16px;border-bottom:1px solid #eee;color:#666">IČO / DIČ</td><td style="padding:8px 16px;border-bottom:1px solid #eee">${body.ICO}</td></tr>`
      : '';

    const promoHtml = usedCode
      ? `<tr><td style="padding:8px 16px;border-bottom:1px solid #eee;color:#666">Slevový kód</td><td style="padding:8px 16px;border-bottom:1px solid #eee"><strong>${usedCode}</strong> (${body.Sleva_info || 'Sleva'})</td></tr>`
      : '';

    const analysisHtml = isGift
      ? '<tr><td colspan="2" style="padding:12px 16px;border-bottom:1px solid #eee;color:#888;font-style:italic">Objednáno jako dárek – míry a zdravotní údaje vyplní obdarovaný sám při uplatnění voucheru na webu.</td></tr>'
      : `
        <tr><td style="padding:8px 16px;border-bottom:1px solid #eee;color:#666">Věk</td><td style="padding:8px 16px;border-bottom:1px solid #eee">${body.Vek} let</td></tr>
        <tr><td style="padding:8px 16px;border-bottom:1px solid #eee;color:#666">Pohlaví</td><td style="padding:8px 16px;border-bottom:1px solid #eee">${body.Pohlavi}</td></tr>
        <tr><td style="padding:8px 16px;border-bottom:1px solid #eee;color:#666">Výška</td><td style="padding:8px 16px;border-bottom:1px solid #eee">${body.Vyska_cm} cm</td></tr>
        <tr><td style="padding:8px 16px;border-bottom:1px solid #eee;color:#666">Váha</td><td style="padding:8px 16px;border-bottom:1px solid #eee">${body.Vaha_kg} kg</td></tr>
        <tr><td style="padding:8px 16px;border-bottom:1px solid #eee;color:#666">Obvod boků</td><td style="padding:8px 16px;border-bottom:1px solid #eee">${body.Obvod_boku_cm || '—'} cm</td></tr>
        <tr><td style="padding:8px 16px;border-bottom:1px solid #eee;color:#666">Obvod pasu</td><td style="padding:8px 16px;border-bottom:1px solid #eee">${body.Obvod_pasu_cm || '—'} cm</td></tr>
        <tr><td style="padding:8px 16px;border-bottom:1px solid #eee;color:#666">Motivace</td><td style="padding:8px 16px;border-bottom:1px solid #eee">${body.Motivace || '—'}</td></tr>
        <tr><td style="padding:8px 16px;border-bottom:1px solid #eee;color:#666">Anonymní reference</td><td style="padding:8px 16px;border-bottom:1px solid #eee">${body.Souhlas_anonymni === 'ano' ? 'Ano' : 'Ne'}</td></tr>
      `;

    const emailHtmlAdmin = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; color: #111;">
        <h2 style="color: #ff9900; border-bottom: 2px solid #ff9900; padding-bottom: 8px;">Nová objednávka z webu</h2>
        
        <h3 style="margin-top: 20px;">Vybraný balíček</h3>
        <table style="width: 100%; border-collapse: collapse;">
          <tr><td style="padding:8px 16px;border-bottom:1px solid #eee;color:#666;width:40%;">Služba</td><td style="padding:8px 16px;border-bottom:1px solid #eee"><strong>${body.Sluzba || 'Neuvedeno'}</strong></td></tr>
          <tr><td style="padding:8px 16px;border-bottom:1px solid #eee;color:#666">Způsob platby</td><td style="padding:8px 16px;border-bottom:1px solid #eee">${body.Platba || 'Jednorázová platba'}</td></tr>
          <tr><td style="padding:8px 16px;border-bottom:1px solid #eee;color:#666">Cena</td><td style="padding:8px 16px;border-bottom:1px solid #eee"><strong>${body.Cena || 'Neuvedeno'}</strong></td></tr>
          ${promoHtml}
          <tr><td style="padding:8px 16px;border-bottom:1px solid #eee;color:#666">Dárkový režim</td><td style="padding:8px 16px;border-bottom:1px solid #eee">${isGift ? '🎁 ANO (Dárkový poukaz)' : 'Běžná objednávka pro sebe'}</td></tr>
        </table>

        <h3 style="margin-top: 24px;">Kontaktní a fakturační údaje</h3>
        <table style="width: 100%; border-collapse: collapse;">
          <tr><td style="padding:8px 16px;border-bottom:1px solid #eee;color:#666;width:40%;">Jméno</td><td style="padding:8px 16px;border-bottom:1px solid #eee">${body.Jmeno}</td></tr>
          <tr><td style="padding:8px 16px;border-bottom:1px solid #eee;color:#666">E-mail</td><td style="padding:8px 16px;border-bottom:1px solid #eee"><a href="mailto:${body.Email}">${body.Email}</a></td></tr>
          <tr><td style="padding:8px 16px;border-bottom:1px solid #eee;color:#666">Telefon</td><td style="padding:8px 16px;border-bottom:1px solid #eee"><a href="tel:${body.Telefon}">${body.Telefon}</a></td></tr>
          <tr><td style="padding:8px 16px;border-bottom:1px solid #eee;color:#666">Ulice a č.p.</td><td style="padding:8px 16px;border-bottom:1px solid #eee">${body.Ulice}</td></tr>
          <tr><td style="padding:8px 16px;border-bottom:1px solid #eee;color:#666">Město a PSČ</td><td style="padding:8px 16px;border-bottom:1px solid #eee">${body.Mesto}, ${body.PSC}</td></tr>
          <tr><td style="padding:8px 16px;border-bottom:1px solid #eee;color:#666">Země</td><td style="padding:8px 16px;border-bottom:1px solid #eee">${body.Zeme}</td></tr>
          ${icoHtml}
        </table>

        <h3 style="margin-top: 24px;">Údaje pro analýzu</h3>
        <table style="width: 100%; border-collapse: collapse;">
          ${analysisHtml}
        </table>
      </div>
    `;

    const emailHtmlClient = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; color: #222; line-height: 1.6;">
        <h2 style="color: #ff9900;">Ahoj ${body.Jmeno},</h2>
        <p>děkuji za tvou objednávku služby <strong>${body.Sluzba || 'Nutriční poradenství'}</strong>!</p>
        <p>Tvá žádost byla úspěšně přijata. Do <strong>2 pracovních dnů</strong> tě budu kontaktovat s fakturou a dalšími instrukcemi ohledně zahájení naší spolupráce.</p>
        ${isGift ? '<p>🎁 <em>Jelikož jsi balíček objednal/a jako dárkový poukaz, po úhradě ti zašlu elektronický certifikát s unikátním kódem pro obdarovaného.</em></p>' : ''}
        <br>
        <p>S pozdravem,<br><strong>Kryštof Koblas</strong><br>Nutriční poradce<br><a href="https://koblas-nutricni.cz" style="color: #ff9900;">koblas-nutricni.cz</a></p>
      </div>
    `;

    // Odeslání e-mailů přes Resend API
    const resendKey = context.env.RESEND_API_KEY;
    const fromDomain = context.env.FROM_DOMAIN || 'koblas-nutricni.cz';

    if (resendKey) {
      // 1. Notifikace poradci
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: `KKoblas Web <info@${fromDomain}>`,
          to: ['koblas.nutricni.info@gmail.com'],
          reply_to: body.Email,
          subject: body.subject || `Nová objednávka – ${body.Sluzba || 'KKoblas'}`,
          html: emailHtmlAdmin
        })
      });

      // 2. Potvrzení klientovi
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: `Kryštof Koblas <info@${fromDomain}>`,
          to: [body.Email],
          subject: `Přijetí objednávky – ${body.Sluzba || 'KKoblas'}`,
          html: emailHtmlClient
        })
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });

  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err.message || 'Server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  }
}
