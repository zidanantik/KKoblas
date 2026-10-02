// functions/api/check-installments.js

const OWNER_EMAIL = 'koblas.nutricni@gmail.com';
const CRON_SECRET = 'koblas2026'; // Tajné heslo pro spuštění

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

export async function onRequestGet(context) {
  try {
    const url = new URL(context.request.url);
    const secret = url.searchParams.get('secret');

    // Kontrola hesla, aby to nespouštěl cizí člověk
    if (secret !== CRON_SECRET) {
      return new Response(JSON.stringify({ ok: false, error: 'Neautorizovaný přístup' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const rawClients = await context.env.STATUS_STORE.get('CLIENTS');
    if (!rawClients) {
      return new Response(JSON.stringify({ ok: true, message: 'Žádní klienti v databázi' }), { status: 200 });
    }

    let clients = JSON.parse(rawClients);
    const todayStr = new Date().toISOString().split('T')[0];
    let processedCount = 0;
    let updated = false;

    const slug = 'krystofkoblas';
    const clientId = '4eec39db77ad7e5dc6da69e17153ffa50c8559d7';
    const clientSecret = '5cbf882f10ba944119cec3bf7d92527acb8ed990';
    const userAgent = 'KKoblas Web (koblas.nutricni.info@gmail.com)';
    const resendKey = context.env.RESEND_API_KEY;

    let sender = (context.env.FROM_DOMAIN || 'info@koblas-nutricni.cz').trim();
    if (!sender.includes('<')) {
      const cleanEmail = sender.includes('@') ? sender : `info@${sender}`;
      sender = `Kryštof Koblas <${cleanEmail}>`;
    }

    let fToken = null;

    for (let client of clients) {
      // Hledáme klienty na splátky, kteří nejsou doplacení a nastal jejich termín (30 dní)
      if (
        client.is_installment &&
        !client.fully_paid &&
        client.next_installment_date &&
        client.next_installment_date <= todayStr
      ) {
        if (!fToken) {
          fToken = await getFakturoidToken(clientId, clientSecret, userAgent);
        }

        const installmentNum = client.next_installment_num || (client.current_installment + 1);
        const amount = client.subsequent_amount || (client.total_installments === 6 ? 2000 : 2800);
        const packageName = client.sluzba_nazev || 'Nutriční program';

        const dueDate = new Date();
        dueDate.setDate(dueDate.getDate() + 7); // Splatnost 7 dní

        // Zjistíme ID kontaktu (subject_id)
        let subjectId = null;
        if (client.fakturoid_id && client.fakturoid_id !== 'POUKAZ-ZDARMA') {
          const origInvRes = await fetch(`https://app.fakturoid.cz/api/v3/accounts/${slug}/invoices/${client.fakturoid_id}.json`, {
            headers: {
              'Authorization': `Bearer ${fToken}`,
              'Accept': 'application/json',
              'User-Agent': userAgent
            }
          });
          if (origInvRes.ok) {
            const origData = await origInvRes.json();
            subjectId = origData.subject_id;
          }
        }

        if (!subjectId) continue;

        // Vystavení faktury ve Fakturoidu
        const invoicePayload = {
          subject_id: subjectId,
          document_type: 'proforma',
          due_date: dueDate.toISOString().split('T')[0],
          lines: [
            {
              name: `${packageName} – ${installmentNum}. splátka z ${client.total_installments}`,
              quantity: 1,
              unit_price: amount,
              unit_name: 'ks'
            }
          ],
          note: `Automatická splátka (${installmentNum}/${client.total_installments})`
        };

        const createRes = await fetch(`https://app.fakturoid.cz/api/v3/accounts/${slug}/invoices.json`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${fToken}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'User-Agent': userAgent
          },
          body: JSON.stringify(invoicePayload)
        });

        if (createRes.ok) {
          const newInvoiceData = await createRes.json();

          if (!Array.isArray(client.invoice_ids)) {
            client.invoice_ids = [client.fakturoid_id];
          }
          client.invoice_ids.push(newInvoiceData.id);
          client.current_installment = installmentNum;
          // Zrušíme datum, dokud klient tuto splátku nezaplatí
          client.next_installment_date = null;
          client.next_installment_num = installmentNum + 1;
          updated = true;
          processedCount++;

          // Odeslání e-mailu klientovi z Fakturoidu
          await fetch(`https://app.fakturoid.cz/api/v3/accounts/${slug}/invoices/${newInvoiceData.id}/message.json`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${fToken}`,
              'Content-Type': 'application/json',
              'Accept': 'application/json',
              'User-Agent': userAgent
            },
            body: JSON.stringify({
              subject: `Zálohová faktura – ${installmentNum}. splátka (${packageName})`,
              message: `Ahoj,\n\nv příloze a na odkazu níže posílám zálohovou fakturu na ${installmentNum}. splátku z ${client.total_installments} za balíček ${packageName}.\n\nMěj se fajn,\nKryštof Koblas`
            })
          });

          // Notifikace tobě
          if (resendKey) {
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
                subject: `Vystavena ${installmentNum}. splátka – ${packageName} – ${client.kupujici.jmeno}`,
                html: `
                  <div style="font-family:sans-serif;max-width:600px;color:#222;">
                    <p>Uběhlo 30 dní a byla automaticky vystavena a odeslána <strong>${installmentNum}. splátka z ${client.total_installments}</strong> (${amount} Kč) pro klienta <strong>${client.kupujici.jmeno}</strong>.</p>
                  </div>
                `
              })
            });
          }
        }
      }
    }

    if (updated) {
      await context.env.STATUS_STORE.put('CLIENTS', JSON.stringify(clients));
    }

    return new Response(JSON.stringify({ ok: true, processed: processedCount }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
