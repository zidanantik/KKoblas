// functions/api/send-email.js

export async function onRequestPost(context) {
  try {
    const body = await context.request.json();
    const { email, name, packageType, isGift, giftCode, invoiceNumber, invoiceLink, isInstallment } = body;

    const resendApiKey = context.env.RESEND_API_KEY;
    const fromDomain = context.env.FROM_DOMAIN || 'noreply@koblas-nutricni.cz';

    if (!resendApiKey) {
      return new Response(JSON.stringify({ ok: false, error: 'Chybí RESEND_API_KEY v konfiguraci.' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Určení názvu balíčku pro text
    let packageName = 'nutriční program';
    if (packageType === 'startup') packageName = 'START-UP';
    if (packageType === 'mentoring') packageName = 'MENTORING';
    if (packageType === 'ultimate') packageName = 'ULTIMATE';
    if (isGift) packageName = 'dárkový poukaz';

    // Sestavení předmětu a těla e-mailu na míru
    let subject = `koblas-nutricni.cz | Platba za ${packageName} dorazila! Info, co bude dál 🚀`;
    let emailContent = `Ahoj ${name || ''},\n\ntvoje platba za balíček ${packageName} dorazila v pořádku, díky moc! Oficiálně tak odmáváme startovní čáru a jdeme na to.\n\n`;

    if (isGift) {
      emailContent += `🎁 TVŮJ DÁRKOVÝ KÓD:\n`;
      emailContent += `Jelikož jde o dárkový poukaz, tady je tvůj unikátní kód, který můžeš uplatnit při objednávce nebo ho někomu věnovat:\n`;
      emailContent += `Kód: **${giftCode || 'NELZE_GENEROVAT'}**\n`;
      emailContent += `Platnost poukazu je 1 rok. Obdarovaný si pak sám vybere termín a balíček, na který ho uplatní.\n\n`;
    } else {
      emailContent += `Abychom hned chytili správný rytmus, tady je pár rychlých a důležitých info k tomu, jak budeme fungovat:\n\n`;
      emailContent += `📱 JAK BUDEME V KONTAKTU?\n`;
      emailContent += `* Prvně ti napíšu na WhatsApp: Co nejdříve se ti ozvu přímo na WhatsApp, abychom se domluvili na termínu první online schůzky. Moje číslo je +420 774 143 176.\n`;
      emailContent += `* Klidně napiš sám/sama: Kdybych to náhodou nestihl hned nebo jsi chtěl/a začátek urychlit, klidně mi na WhatsApp napiš jako první.\n`;
      emailContent += `* Čistě WhatsApp zprávy: Tohle číslo prosím používej primárně pro textové a hlasové zprávy. Každému se věnuji na maximum a jakmile mi to čas mezi klienty dovolí, hned odepisuju.\n`;
      emailContent += `* Spojení v aplikaci ZOF: Následně se propojíme i přímo v ZOFu. Pokud bychom se tam náhodou minuli nebo ti pozvánka nedorazila, ozvi se mi.\n\n`;
      
      emailContent += `⏱️ JAK JE TO S TVÝM ČASEM? (FÉROVÁ DOHODA)\n`;
      emailContent += `* O svůj čas nepřijdeš: Kdyby došlo k jakémukoliv zpoždění z mé strany, tvůj zaplacený čas to nijak nezkrátí. Čas balíčku ti začínám oficiálně počítat až ode dne naší první online schůzky (do té doby spolu ladíme jen podklady a diagnostiku).\n`;
      emailContent += `* Rušení schůzek: Všichni jsme lidi a stát se může cokoliv. Když se schůzka normálně předem vykomunikuje a přesune, nic se neděje a jedeme dál. Pokud by se ale termíny rušily opakovaně nebo bez omluvy, zaplacený čas balíčku už začne běžet.\n\n`;

      emailContent += `📊 ANALÝZA DAT (AŤ NEPLÝTVÁME ČASEM)\n`;
      emailContent += `* Od chvíle zaplacení už pracuju na tvých podkladech.\n`;
      emailContent += `* Pokud už máš hotové InBody a schůzku máme třeba až za týden, pošli mi výsledky hned na WhatsApp nebo na e-mail: koblas.nutricni@gmail.com.\n`;
      emailContent += `* Všechno si dopředu zanalyzuji. Na schůzce se pak nebudeme zdržovat věcmi, které vyčtu z protokolu, a budeme se moct naplno věnovat konkrétnímu plánu pro tebe.\n\n`;
    }

    if (invoiceLink) {
      emailContent += `Fakturu č. ${invoiceNumber || ''} si můžeš stáhnout zde: ${invoiceLink}\n\n`;
    }

    emailContent += `Všechno v klidu nastavíme tak, aby tě to bavilo a přineslo reálné výsledky.\n\nTěším se na spolupráci!\n\nMěj se fajn,\nKryštof Koblas`;

    // Odeslání přes Resend API
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${resendApiKey}`
      },
      body: JSON.stringify({
        from: `Kryštof Koblas <noreply@${fromDomain}>`,
        to: [email],
        subject: subject,
        text: emailContent
      })
    });

    const resData = await res.json();
    if (!res.ok) {
      throw new Error(resData.message || 'Chyba při odesílání e-mailu přes Resend.');
    }

    return new Response(JSON.stringify({ ok: true, id: resData.id }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
