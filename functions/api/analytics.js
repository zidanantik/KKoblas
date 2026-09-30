const GQL_URL = 'https://api.cloudflare.com/client/v4/graphql';

const PAGE_PATHS = new Set([
  '/', '/sluzby.html', '/omne.html', '/jakpracuji.html',
  '/faq.html', '/kontakt.html', '/objednavka.html', '/dekujeme.html', '/cekacka.html'
]);

const DEFAULT_ZONE_ID = 'ac1443e7edeb359b7ec9201caa46378b';

function fmt(d) { return d.toISOString().split('T')[0]; }

export async function onRequestGet(context) {
  const token = context.env.CF_API_TOKEN;
  if (!token) {
    return Response.json({ ok: false, error: 'Chybí CF_API_TOKEN' }, { status: 503 });
  }

  const zoneId = context.env.CF_ZONE_ID || DEFAULT_ZONE_ID;
  const now    = new Date();
  const today  = fmt(now);
  const start7 = fmt(new Date(now.getTime() - 6 * 86400000));
  const zf     = `zoneTag:"${zoneId}"`;

  const combinedQuery = `{
    viewer {
      zones(filter: { ${zf} }) {
        r7d: httpRequests1dGroups(limit: 7, filter: { date_geq: "${start7}", date_leq: "${today}" }, orderBy: [date_ASC]) {
          dimensions { date }
          sum { requests }
        }
        rH: httpRequestsAdaptiveGroups(limit: 100, filter: { AND: [{ date_geq: "${today}" }, { date_leq: "${today}" }] }) {
          count
          avg { sampleInterval }
          dimensions { datetimeHour }
        }
        rP: httpRequestsAdaptiveGroups(limit: 200, filter: { AND: [{ date_geq: "${today}" }, { date_leq: "${today}" }] }) {
          count
          avg { sampleInterval }
          dimensions { clientRequestPath }
        }
        rDev: httpRequestsAdaptiveGroups(limit: 10, filter: { AND: [{ date_geq: "${today}" }, { date_leq: "${today}" }] }) {
          count
          dimensions { clientDeviceType }
        }
      }
    }
  }`;

  try {
    const r = await fetch(GQL_URL, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ query: combinedQuery })
    });

    if (!r.ok) {
      if (r.status === 429) {
        return Response.json({ ok: false, error: 'Limit Cloudflare API vyčerpán. Zkuste to za chvíli.' }, { status: 429 });
      }
      throw new Error('HTTP ' + r.status);
    }

    const j = await r.json();
    if (j.errors && j.errors.length) throw new Error(j.errors[0].message);

    const zoneData = (j.data && j.data.viewer && j.data.viewer.zones && j.data.viewer.zones[0]) || {};

    // ── 7 dní ────────────────────────────────────────────────
    const byDate = {};
    let total = 0;
    for (const g of (zoneData.r7d || [])) {
      const v = (g.sum && g.sum.requests) || 0;
      const dd = g.dimensions && g.dimensions.date;
      total += v;
      if (dd) byDate[dd] = (byDate[dd] || 0) + v;
    }
    const days = [];
    for (let i = 0; i <= 6; i++) {
      const s = fmt(new Date(now.getTime() - (6 - i) * 86400000));
      days.push({ date: s, count: byDate[s] || 0 });
    }

    // ── Dnes po hodinách ────────────────────────────────────
    const byHour = {};
    let todayPv = 0;
    for (const g of (zoneData.rH || [])) {
      const v = Math.round(g.count * ((g.avg && g.avg.sampleInterval) || 1));
      const raw = g.dimensions && g.dimensions.datetimeHour;
      todayPv += v;
      if (raw) {
        const h = parseInt(raw.slice(11, 13), 10);
        byHour[h] = (byHour[h] || 0) + v;
      }
    }
    const hours = [];
    for (let h = 0; h <= 23; h++) hours.push({ hour: h, count: byHour[h] || 0 });

    // ── Top stránky ─────────────────────────────────────────
    const pathMap = {};
    for (const g of (zoneData.rP || [])) {
      const p = (g.dimensions && g.dimensions.clientRequestPath) || '/';
      if (PAGE_PATHS.has(p)) {
        const v = Math.round(g.count * ((g.avg && g.avg.sampleInterval) || 1));
        pathMap[p] = (pathMap[p] || 0) + v;
      }
    }
    const topPages = Object.entries(pathMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(e => ({ path: e[0], count: e[1] }));

    // ── Zařízení ────────────────────────────────────────────
    let devTotal = 0;
    const devMap = {};
    for (const g of (zoneData.rDev || [])) {
      const type = (g.dimensions && g.dimensions.clientDeviceType) || 'Desktop';
      devMap[type] = (devMap[type] || 0) + g.count;
      devTotal += g.count;
    }
    const devices = Object.entries(devMap).map(([type, cnt]) => ({
      type,
      pct: devTotal > 0 ? Math.round((cnt / devTotal) * 100) : 0
    }));

    return Response.json({
      ok: true,
      pageviews: total,
      todayPv,
      days,
      hours,
      topPages,
      devices,
      _zone: 'koblas-nutricni.cz'
    }, {
      headers: { 'Cache-Control': 'public, max-age=60' }
    });

  } catch (e) {
    return Response.json({ ok: false, error: e.message }, { status: 500 });
  }
}
