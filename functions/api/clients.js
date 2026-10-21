// functions/api/clients.js

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

function formatPackageTitle(pkgSlugOrName) {
  const s = String(pkgSlugOrName || '').toUpperCase();
  if (s.includes('ULTIMATE')) return 'ULTIMATE';
  if (s.includes('MENTOR')) return 'MENTORING';
  if (s.includes('START')) return 'START-UP';
  return pkgSlugOrName || 'START-UP';
}

export async function onRequestGet(context) {
  try {
    const adminPass = context.request.headers.get('x-admin-pass');
    const storedPass = context.env.ADMIN_PASS;

    if (!adminPass || adminPass !== storedPass) {
      return new Response(JSON.stringify({ ok: false, error: 'Neautorizováno' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const store = context.env.STATUS_STORE;
    const rawClients = store ? await store.get('CLIENTS') : null;
    let clients = rawClients ? JSON.parse(rawClients) : [];

    const todayStr = new Date().toISOString().split('T')[0];

    let changed = false;
    clients.forEach(c => {
      if (!c.id) {
        c.id = c.fakturoid_id ? String(c.fakturoid_id) : crypto.randomUUID();
        changed = true;
      }
      if (c.status === 'aktivni' && !c.start_date) {
        c.start_date = c.datum_platby ? c.datum_platby.split('T')[0] : todayStr;
        c.end_date = computeEndDate(c.start_date, c.sluzba_nazev || c.sluzba);
        changed = true;
      }
    });

    if (changed && store) {
      await store.put('CLIENTS', JSON.stringify(clients));
    }

    return new Response(JSON.stringify(clients), {
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

export async function onRequestPost(context) {
  try {
    const adminPass = context.request.headers.get('x-admin-pass');
    const storedPass = context.env.ADMIN_PASS;

    if (!adminPass || adminPass !== storedPass) {
      return new Response(JSON.stringify({ ok: false, error: 'Neautorizováno' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const body = await context.request.json();
    const store = context.env.STATUS_STORE;
    const rawClients = store ? await store.get('CLIENTS') : null;
    let clients = rawClients ? JSON.parse(rawClients) : [];

    // ── SPECIÁLNÍ AKCE: NAVÁZÁNÍ NA STÁVAJÍCÍ KARTU KLIENTA (MERGE) ──
    if (body.action === 'merge_client') {
      const newOrderIdx = clients.findIndex(c => String(c.id) === String(body.newClientId));
      const oldClientIdx = clients.findIndex(c => String(c.id) === String(body.targetClientId));

      if (newOrderIdx === -1 || oldClientIdx === -1) {
        return new Response(JSON.stringify({ ok: false, error: 'Záznamy pro navázání nebyly nalezeny.' }), { status: 404 });
      }

      const newOrder = clients[newOrderIdx];
      const masterClient = clients[oldClientIdx];

      // 1. Uložíme předchozí balíček do historie klienta
      if (!Array.isArray(masterClient.history)) {
        masterClient.history = [];
      }
      masterClient.history.push({
        sluzba: formatPackageTitle(masterClient.sluzba_nazev || masterClient.sluzba),
        start_date: masterClient.start_date || '',
        end_date: masterClient.end_date || '',
        archived_at: new Date().toISOString().split('T')[0]
      });

      // 2. Aktualizujeme hlavní záznam klienta novým balíčkem a termíny
      const newPkgName = formatPackageTitle(newOrder.sluzba_nazev || newOrder.sluzba);
      const startD = newOrder.start_date || new Date().toISOString().split('T')[0];
      const endD = computeEndDate(startD, newPkgName);

      masterClient.sluzba = newPkgName.toLowerCase();
      masterClient.sluzba_nazev = newPkgName;
      masterClient.start_date = startD;
      masterClient.end_date = endD;
      masterClient.status = 'aktivni';
      masterClient.pocita_se = true;
      masterClient.is_installment = newOrder.is_installment;
      masterClient.total_installments = newOrder.total_installments;
      masterClient.current_installment = newOrder.current_installment;
      masterClient.next_installment_date = newOrder.next_installment_date || null;

      if (newOrder.fakturoid_id) {
        masterClient.fakturoid_id = newOrder.fakturoid_id;
        if (!Array.isArray(masterClient.invoice_ids)) masterClient.invoice_ids = [];
        masterClient.invoice_ids.push(newOrder.fakturoid_id);
      }

      // Aktualizujeme diagnostiku aktuálními hodnotami z nového formuláře
      const newDiag = newOrder.diagnostika || {};
      if (newDiag.vaha || newDiag.vyska) {
        masterClient.diagnostika = newDiag;
      }

      // 3. Pošleme do Notionu aktualizaci karty + připíšeme nové měření "Vstupní dotazník (web)"
      if (masterClient.notion_client_id) {
        try {
          const vekNum = Number(newDiag.vek) || 0;
          const isChild = vekNum > 0 && vekNum < 18;
          const rawHeight = parseFloat(newDiag.vyska) || 0;
          const vyskaM = rawHeight > 3 ? Number((rawHeight / 100).toFixed(2)) : rawHeight;

          let pohlaviValue = newDiag.pohlavi;
          if (isChild) {
            if (pohlaviValue === 'Muž' || pohlaviValue === 'Muz' || pohlaviValue === 'Kluk') pohlaviValue = 'Kluk';
            if (pohlaviValue === 'Žena' || pohlaviValue === 'Zena' || pohlaviValue === 'Holka') pohlaviValue = 'Holka';
          }

          const notionPayload = {
            action: 'update_client',
            clientPageId: masterClient.notion_client_id,
            sluzba: newPkgName,
            startDate: startD,
            endDate: endD,
            status: 'aktivni',
            appendMeasurement: true,
            isChild: isChild,
            datum: startD,
            vaha: parseFloat(newDiag.vaha) || 0,
            vyska: vyskaM,
            vek: vekNum,
            pas: parseFloat(newDiag.obvod_pasu || newDiag.pas) || 0,
            boky: parseFloat(newDiag.obvod_boku || newDiag.boky) || 0,
            pohlavi: pohlaviValue || 'Muž'
          };

          const patchRes = await fetch('https://nutri-api.koblas-nutricni.workers.dev/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(notionPayload)
          });

          if (!patchRes.ok) {
            const errText = await patchRes.text();
            console.error('Chyba při volání nutri-api během merge:', errText);
          }
        } catch (err) {
          console.error('Chyba při navázání karty v Notionu:', err);
        }
      }

      // 4. Odstraníme dočasný duplicitní řádek nové objednávky
      clients.splice(newOrderIdx, 1);
      await store.put('CLIENTS', JSON.stringify(clients));

      return new Response(JSON.stringify({ ok: true, merged: true, client: masterClient }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // ── SPECIÁLNÍ AKCE: SCHVÁLENÍ PLATBY PO EXPIRACI ──
    if (body.action === 'approve_expired') {
      const targetId = body.id ? String(body.id).trim() : '';
      const idx = clients.findIndex(c => String(c.id) === targetId || String(c.fakturoid_id) === targetId);

      if (idx === -1) {
        return new Response(JSON.stringify({ ok: false, error: 'Klient nenalezen' }), { status: 404 });
      }

      const client = clients[idx];
      const resendKey = context.env.RESEND_API_KEY;
      const pdfshiftKey = context.env.PDFSHIFT_API_KEY;
      const OWNER_EMAIL = 'koblas.nutricni@gmail.com';

      let sender = (context.env.FROM_DOMAIN || 'info@koblas-nutricni.cz').trim();
      if (!sender.includes('<')) {
        const cleanEmail = sender.includes('@') ? sender : `info@${sender}`;
        sender = `Kryštof Koblas <${cleanEmail}>`;
      }

      const pkgSlug = formatPackageTitle(client.sluzba_nazev || client.sluzba).toLowerCase().replace(/[^a-z]/g, '');
      const packageName = client.sluzba_nazev || 'nutriční program';
      const todayYMD = new Date().toISOString().split('T')[0];

      // A) DÁRKOVÝ POUKAZ
      if (client.is_gift && !client.is_gift_redemption) {
        client.status = 'aktivni';
        client.pocita_se = true;
        delete client.expired_payment_info;

        if (!client.kod_voucheru) {
          const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
          let gCode = '';
          for (let i = 0; i < 6; i++) gCode += chars.charAt(Math.floor(Math.random() * chars.length));
          client.kod_voucheru = 'DAR-' + gCode;
        }

        const giftCode = client.kod_voucheru;
        const rawCodes = await store.get('PROMO_CODES');
        let codes = rawCodes ? JSON.parse(rawCodes) : [];

        const buyerName = (client.kupujici && client.kupujici.jmeno) ? client.kupujici.jmeno : 'Dárkový nákup';
        const purchaseDate = new Date().toLocaleDateString('cs-CZ');

        if (!codes.some(c => c.code === giftCode)) {
          codes.unshift({
            id: crypto.randomUUID(),
            code: giftCode,
            type: 'gift',
            value: 100,
            oneTime: true,
            splatky: false,
            darekOnly: false,
            packages: [pkgSlug || 'startup'],
            active: true,
            used: false,
            usedCount: 0,
            createdAt: new Date().toISOString(),
            note: `${buyerName} (${purchaseDate})`
          });
          await store.put('PROMO_CODES', JSON.stringify(codes));
        }

        if (resendKey && client.kupujici && client.kupujici.email) {
          const redeemUrl = `https://koblas-nutricni.cz/objednavka.html?sluzba=${encodeURIComponent(pkgSlug)}&kod=${encodeURIComponent(giftCode)}`;
          const voucherWebUrl = `https://koblas-nutricni.cz/voucher.html?kod=${encodeURIComponent(giftCode)}`;

          await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              from: sender,
              to: [client.kupujici.email],
              reply_to: OWNER_EMAIL,
              subject: `Dárkový poukaz – ${packageName} (Kód: ${giftCode})`,
              html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; color: #222; line-height: 1.6; font-size: 15px;">
                  <p>Ahoj ${client.kupujici.jmeno},</p>
                  <p>děkuji za úhradu dárkového poukazu na službu <strong>${packageName}</strong>.</p>
                  <div style="background: #141414; border: 2px solid #c88a2c; padding: 25px; border-radius: 8px; margin: 25px 0; text-align: center; color: #fff;">
                    <div style="font-size: 12px; color: #aaa; text-transform: uppercase; letter-spacing: 2px;">Kód dárkového poukazu</div>
                    <div style="font-family: monospace; font-size: 28px; font-weight: bold; color: #ff9900; letter-spacing: 4px; margin: 10px 0;">${giftCode}</div>
                    <div style="margin-top: 18px;">
                      <a href="${voucherWebUrl}" target="_blank" style="display: inline-block; background: #ff9900; color: #000; font-weight: bold; font-family: monospace; font-size: 13px; padding: 10px 20px; border-radius: 4px; text-decoration: none;">
                        🖨 OTEVŘÍT / VYTISKNOUT POUKAZ ON-LINE →
                      </a>
                    </div>
                  </div>
                  <p style="font-size: 14px; color: #555;">Obdarovaný si může balíček aktivovat na adrese: <a href="${redeemUrl}">${redeemUrl}</a></p>
                  <p>S pozdravem,<br><strong>Kryštof Koblas</strong><br>koblas-nutricni.cz</p>
                </div>
              `
            })
          });
        }

      } else {
        // B) BĚŽNÝ PROGRAM
        client.status = 'aktivni';
        client.pocita_se = true;
        client.start_date = todayYMD;
        client.end_date = computeEndDate(todayYMD, client.sluzba_nazev || client.sluzba);
        delete client.expired_payment_info;

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
              startDate: client.start_date,
              endDate: client.end_date,
              isChild: isChild,
              zapis: 'Vstupní dotazník (web)',
              datum: client.start_date,
              vaha: parseFloat(diag.vaha) || 0,
              vyska: vyskaM,
              vek: vekNum,
              pas: parseFloat(diag.obvod_pasu || diag.pas) || 0,
              boky: parseFloat(diag.obvod_boku || diag.boky) || 0,
              pohlavi: pohlaviValue || 'Muž'
            })
          });

          if (syncRes.ok) {
            const syncData = await syncRes.json();
            if (syncData.clientPageId) client.notion_client_id = syncData.clientPageId;
          }
        } catch (notionErr) {
          console.error('Chyba při dodatečném zápisu do Notionu:', notionErr);
        }

        if (resendKey && client.kupujici && client.kupujici.email) {
          await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              from: sender,
              to: [client.kupujici.email],
              reply_to: OWNER_EMAIL,
              subject: `Podklady pro zahájení spolupráce – ${packageName}`,
              html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; color: #222; line-height: 1.6; font-size: 15px;">
                  <p>Ahoj ${client.kupujici.jmeno},</p>
                  <p>tvoje platba za balíček <strong>${packageName}</strong> byla schválena a oficiálně odmáváme startovní čáru!</p>
                  <p style="font-weight: bold; margin-top: 20px;">Dva důležité úkoly před naší první online schůzkou:</p>
                  <ol style="padding-left: 20px;">
                    <li style="margin-bottom: 8px;"><strong>Zápis jídelníčku:</strong> Měj ready aspoň 3 dny zápisu v aplikaci <a href="https://www.zofapp.cz/" style="color: #0066cc;">zofapp.cz</a>.</li>
                    <li style="margin-bottom: 8px;"><strong>Měření InBody:</strong> Zařiď si prosím ve svém okolí měření na InBody a výsledky mi pošli na WhatsApp nebo na e-mail: <strong>koblas.nutricni@gmail.com</strong>.</li>
                  </ol>
                  <p>Co nejdříve se ti ozvu na WhatsApp, abychom domluvili termín úvodní konzultace.</p>
                  <p style="margin-top: 25px;">Kryštof Koblas<br><span style="color: #666; font-size: 13px;">Nutriční poradce | koblas-nutricni.cz</span></p>
                </div>
              `
            })
          });
        }
      }

      await store.put('CLIENTS', JSON.stringify(clients));
      return new Response(JSON.stringify({ ok: true, approved: true, client: client }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // ── BĚŽNÁ ÚPRAVA ŘÁDKU V ADMINU (ULOŽENÍ TERMÍNŮ, STAVU NEBO BALÍČKU) ──
    const targetId = body.id ? String(body.id).trim() : '';

    const idx = clients.findIndex(c => {
      const cId = c.id ? String(c.id).trim() : '';
      const cFakId = c.fakturoid_id ? String(c.fakturoid_id).trim() : '';
      return targetId && targetId !== 'undefined' && (cId === targetId || cFakId === targetId);
    });

    if (idx === -1) {
      return new Response(JSON.stringify({ ok: false, error: 'Klient nenalezen' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const client = clients[idx];

    // Pokud admin změnil typ balíčku, uložíme předchozí do historie
    if (body.sluzba !== undefined) {
      const oldPkg = formatPackageTitle(client.sluzba_nazev || client.sluzba);
      const newPkg = formatPackageTitle(body.sluzba);
      if (oldPkg !== newPkg && client.start_date) {
        if (!Array.isArray(client.history)) client.history = [];
        client.history.push({
          sluzba: oldPkg,
          start_date: client.start_date,
          end_date: client.end_date || '',
          archived_at: new Date().toISOString().split('T')[0]
        });
      }
      client.sluzba = newPkg.toLowerCase();
      client.sluzba_nazev = newPkg;
    }

    if (body.start_date !== undefined) client.start_date = body.start_date;
    if (body.end_date !== undefined) client.end_date = body.end_date;
    if (body.status !== undefined) client.status = body.status;
    if (body.note !== undefined) client.admin_note = body.note;

    if (body.forceNewCard) {
      delete client.pending_merge_target_id;
      delete client.pending_merge_notion_id;
    }

    const isGiftBuyer = client.is_gift && !client.is_gift_redemption;

    // ── SYNCHRONIZACE S NOTIONEM ──
    if (!isGiftBuyer) {
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

        // 1. Klient už v Notionu existuje -> aktualizujeme termíny a balíček
        if (client.notion_client_id) {
          await fetch('https://nutri-api.koblas-nutricni.workers.dev/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'update_client',
              clientPageId: client.notion_client_id,
              startDate: client.start_date || null,
              endDate: client.end_date || null,
              sluzba: client.sluzba_nazev || client.sluzba || '',
              status: client.status
            })
          });
        } 
        // 2. Klient je aktivní, ale v Notionu ještě není -> vytvoříme kartu i vstupní měření
        else if (client.status === 'aktivni') {
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
              datum: client.start_date || new Date().toISOString().split('T')[0],
              vaha: parseFloat(diag.vaha) || 0,
              vyska: vyskaM,
              vek: vekNum,
              pas: parseFloat(diag.obvod_pasu || diag.pas) || 0,
              boky: parseFloat(diag.obvod_boku || diag.boky) || 0,
              pohlavi: pohlaviValue
            })
          });

          if (syncRes.ok) {
            const syncData = await syncRes.json();
            if (syncData.clientPageId) {
              client.notion_client_id = syncData.clientPageId;
            }
          }
        }
      } catch (notionErr) {
        console.error('Chyba synchronizace s Notionem z adminu:', notionErr);
      }
    }

    await store.put('CLIENTS', JSON.stringify(clients));

    return new Response(JSON.stringify({ ok: true, client: clients[idx] }), {
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

// ── MAZÁNÍ KLIENTA: MAŽE POUZE KONKRÉTNÍ ŘÁDEK PODLE ID ──
export async function onRequestDelete(context) {
  try {
    const adminPass = context.request.headers.get('x-admin-pass');
    const storedPass = context.env.ADMIN_PASS;

    if (!adminPass || adminPass !== storedPass) {
      return new Response(JSON.stringify({ ok: false, error: 'Neautorizováno' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const body = await context.request.json();
    const store = context.env.STATUS_STORE;
    const rawClients = store ? await store.get('CLIENTS') : null;
    let clients = rawClients ? JSON.parse(rawClients) : [];

    const targetId = body.id ? String(body.id).trim() : '';

    // Maže POUZE záznam se shodným ID, ostatní objednávky stejného klienta zůstanou zachovány
    clients = clients.filter(c => {
      const cId = c.id ? String(c.id).trim() : '';
      const cFakId = c.fakturoid_id ? String(c.fakturoid_id).trim() : '';
      if (targetId && targetId !== 'undefined' && targetId !== 'null' && (cId === targetId || cFakId === targetId)) {
        return false;
      }
      return true;
    });

    await store.put('CLIENTS', JSON.stringify(clients));

    return new Response(JSON.stringify({ ok: true }), {
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
