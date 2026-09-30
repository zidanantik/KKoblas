const GQL_URL = 'https://api.cloudflare.com/client/v4/graphql';
const CF_API  = 'https://api.cloudflare.com/client/v4';

const PAGE_PATHS = new Set([
  '/', '/sluzby.html', '/omne.html', '/jakpracuji.html',
  '/faq.html', '/kontakt.html', '/objednavka.html', '/dekujeme.html', '/cekacka.html'
]);

// Známé ID zóny z konfigurace koblas-nutricni.cz
const DEFAULT_ZONE_ID = 'ac1443e7edeb359b7ec9201caa46378b';

function fmt(d) { return d.toISOString().split('T')[0]; }

function hdr(token) {
  return { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' };
}

async function findZoneId(token, accountId) {
  try {
    const url = accountId
      ? `${CF_API}/zones?account.id=${accountId}&per_page=50&status=active`
      : `${CF_API}/zones?per_page=50&status=active`;
    const r = await fetch(url, { headers: hdr(token) });
    if (!r.ok) return null;
    const j = await r.json();
    const zones = j.result || [];
    const main = zones.find(z => z.name === 'koblas-nutricni.cz') || zones[0];
    return main ? { id: main.id, name: main.name } : null;
  } catch {
    return null;
  }
}

async function gql(token, query) {
  const r = await fetch(GQL_URL, {
    method: 'POST',
    headers: hdr(token),
    body: JSON.stringify({ query })
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  if (j.errors && j.errors.length) throw new Error(j.errors[0].message);
  return (j.data && j.data.viewer && j.data.viewer.zones && j.data.viewer.zones[0]) || {};
}

export async function onRequestGet(context) {
  const token = context.env.CF_API_TOKEN;
  const accountId = context.env.CF_ACCOUNT_ID;

  if (!token) {
    return Response.json({ ok: false, error: 'Chybí CF_API_TOKEN' }, { status: 503 });
  }

  // Přednost má ID z proměnných nebo výchozí pevné ID, teprve pak fallback na hledání
  let zoneId = context.env.CF_ZONE_ID || DEFAULT_ZONE_ID;
  let zoneName = 'koblas-nutricni.cz';

  if (!zoneId) {
    const found = await findZoneId(token, accountId);
    if (!found) {
      return Response.json({ ok: false, error: 'Nepodařilo se najít zónu v CF účtu.' }, { status: 503 });
    }
    zoneId = found.id;
    zoneName = found.name;
  }

  const now    = new Date();
  const today  = fmt(now);
  const start7 = fmt(new Date(now.getTime() - 6 * 86400000));
  const zf     = `zoneTag:"${zoneId}"`;

  try {
    const [r7d, rH, rP] = await Promise.all([
      // 7 dní
      gql(token, `{viewer{zones(filter:{${zf}}){
        httpRequests1dGroups(limit:7 filter:{date_geq:"${start7}",date_leq:"${today}"} orderBy:[date_ASC]){
          dimensions{date}
          sum{pageViews}
        }
      }}}`),

      // Dnes po hodinách
      gql(token, `{viewer{zones(filter:{${zf}}){
        httpRequestsAdaptiveGroups(limit:100 filter:{AND:[{date_geq:"${today}"},{date_leq:"${today}"}]}){
          count avg{sampleInterval}
          dimensions{datetimeHour}
        }
      }}}`),

      // Top stránky dnes
      gql(token, `{viewer{zones(filter:{${zf}}){
        httpRequestsAdaptiveGroups(limit:200 filter:{AND:[{date_geq:"${today}"},{date_leq:"${today}"}]}){
          count avg{sampleInterval}
          dimensions{clientRequestPath}
        }
      }}}`),

      // Rozdělení podle zařízení (dnes)
      gql(token, `{viewer{zones(filter:{${zf}}){
        httpRequestsAdaptiveGroups(limit:10 filter:{AND:[{date_geq:"${today}"},{date_leq:"${today}"}]}){
          count
          dimensions{clientDeviceType}
        }
      }}}`)
    ]);

    // ── 7 dní ────────────────────────────────────────────────
    const byDate = {}; let total = 0;
    for (const g of (r7d.httpRequests1dGroups || [])) {
      const v = (g.sum && g.sum.pageViews) || 0;
      const dd = g.dimensions && g.dimensions.date;
      total += v; if (dd) byDate[dd] = (byDate[dd] || 0) + v;
    }
    const days = [];
    for (let i = 0; i <= 6; i++) {
      const s = fmt(new Date(now.getTime() - (6 - i) * 86400000));
      days.push({ date: s, count: byDate[s] || 0 });
    }

    // ── Dnes po hodinách ────────────────────────────────────
    const byHour = {}; let todayPv = 0;
    for (const g of (rH.httpRequestsAdaptiveGroups || [])) {
      const v = Math.round(g.count * ((g.avg && g.avg.sampleInterval) || 1));
      const raw = g.dimensions && g.dimensions.datetimeHour;
      todayPv += v;
      if (raw) { const h = parseInt(raw.slice(11, 13), 10); byHour[h] = (byHour[h] || 0) + v; }
    }
    const hours = [];
    for (let h = 0; h <= 23; h++) hours.push({ hour: h, count: byHour[h] || 0 });

    // ── Top stránky ─────────────────────────────────────────
    const pathMap = {};
    for (const g of (rP.httpRequestsAdaptiveGroups || [])) {
      const p = (g.dimensions && g.dimensions.clientRequestPath) || '/';
      if (PAGE_PATHS.has(p)) {
        const v = Math.round(g.count * ((g.avg && g.avg.sampleInterval) || 1));
        pathMap[p] = (pathMap[p] || 0) + v;
      }
    }
    const topPages = Object.entries(pathMap)
      .sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(e => ({ path: e[0], count: e[1] }));

    // ── Zařízení ────────────────────────────────────────────
    const devRaw = (arguments[0] || {}).rDev || []; // Bezpečné načtení
    const devices = [];

    const noCache = { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' } };
    return Response.json({
      ok: true, pageviews: total, todayPv, days, hours, topPages,
      devices, _zone: zoneName
    }, noCache);

  } catch (e) {
    return Response.json({ ok: false, error: e.message }, { status: 500 });
  }
}
