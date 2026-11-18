// Cloudflare Pages Function: GET /api/stats?days=30   (or ?vid=<visitor id> for one visitor's full timeline)
// Private numbers for the /admin/ page, read from the D1 activity log written by t.js, plus recent
// Stripe Checkout sessions (opened, paid or abandoned).
// Needs: the D1 binding DB, and a secret STATS_KEY (any long random string). The admin page sends it
// in the X-Stats-Key header. Without STATS_KEY set, this endpoint is switched off.
// POST /api/stats { owner: "<visitor id>" } tags everything that visitor ever did as the owner's own (tests),
// sent by the "This is my device" switch on /admin/.

import { ensureSchema } from "./t.js";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });

function same(a, b) { // constant-time compare
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

async function stripeSessions(env, since) {
  if (!env.STRIPE_SECRET_KEY) return { error: "No Stripe key" };
  const u = new URL("https://api.stripe.com/v1/checkout/sessions");
  u.searchParams.set("limit", "50");
  u.searchParams.set("created[gte]", String(Math.floor(since / 1000)));
  u.searchParams.append("expand[]", "data.line_items");
  const r = await fetch(u, { headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` } });
  const j = await r.json();
  if (!r.ok) return { error: (j.error && j.error.message) || "Stripe error" };
  return j.data.map(s => ({
    id: s.id, created: s.created * 1000, status: s.status, paid: s.payment_status === "paid",
    total: s.amount_total / 100, shipping: ((s.total_details || {}).amount_shipping || 0) / 100,
    items: ((s.line_items || {}).data || []).map(l => `${l.quantity} × ${l.description}`),
    email: (s.customer_details || {}).email || s.customer_email || null,
    name: (s.customer_details || {}).name || null,
    postcode: (s.metadata || {}).quoted_postcode || ((s.customer_details || {}).address || {}).postal_code || null,
    visitor: s.client_reference_id || (s.metadata || {}).visitor || null,
    ownerTest: (s.metadata || {}).owner_test === "yes",
  }));
}

export async function onRequestGet({ request, env }) {
  if (!env.STATS_KEY) return json({ error: "Stats are switched off: add the STATS_KEY secret in Cloudflare" }, 503);
  if (!same(request.headers.get("X-Stats-Key") || "", env.STATS_KEY)) return json({ error: "Wrong key" }, 401);
  const url = new URL(request.url);
  const days = Math.min(400, Math.max(1, Number(url.searchParams.get("days")) || 30));
  const since = Date.now() - days * 86400e3;
  const db = env.DB;
  const stripe = stripeSessions(env, since).catch(e => ({ error: e.message }));
  if (!db) return json({ error: "No database: add the D1 binding DB in Cloudflare", stripe: await stripe });
  await ensureSchema(db);

  const vid = url.searchParams.get("vid");
  if (vid) {
    const r = await db.prepare("SELECT ts, sid, name, path, props, city, region, country, device, browser FROM events WHERE vid = ? ORDER BY ts LIMIT 5000").bind(vid).all();
    return json({ vid, events: r.results });
  }

  // Leave out the owner's own devices unless ?own=1
  const withOwn = url.searchParams.get("own") === "1";
  const F = sql => withOwn ? sql : sql.replaceAll("ts >= ?", "ts >= ? AND own = 0");
  const q = (sql, ...args) => db.prepare(F(sql)).bind(since, ...args);
  // Days are counted in Melbourne time (AEST/AEDT)
  const off = (new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", timeZoneName: "shortOffset" }).formatToParts(new Date()).find(p => p.type === "timeZoneName") || {}).value || "GMT+10";
  const tzShift = (Number((off.match(/[+-]\d+/) || ["+10"])[0]) >= 0 ? "+" : "") + Number((off.match(/[+-]\d+/) || ["+10"])[0]) + " hours";
  const ownVids = new Set((await db.prepare("SELECT DISTINCT vid FROM events WHERE own = 1").all()).results.map(r => r.vid));
  const [totals, daily, pages, parts, adds, searches, refs, places, devices, carts, sessions, contacts, errors] = await db.batch([
    q(`SELECT COUNT(DISTINCT vid) visitors, COUNT(DISTINCT sid) sessions,
        SUM(name='page_view') pageViews, COUNT(DISTINCT CASE WHEN name='view_item' THEN vid END) viewedPart,
        COUNT(DISTINCT CASE WHEN name='add_to_cart' THEN vid END) addedToCart,
        COUNT(DISTINCT CASE WHEN name='cart_open' THEN vid END) openedCart,
        COUNT(DISTINCT CASE WHEN name='begin_checkout' THEN vid END) beganCheckout,
        COUNT(DISTINCT CASE WHEN name='purchase' THEN vid END) purchased,
        COUNT(DISTINCT CASE WHEN name IN ('call_click','sms_click','email_click','ask_form') THEN vid END) contacted
       FROM events WHERE ts >= ?`),
    db.prepare(F(`SELECT date(ts/1000,'unixepoch',?) day, COUNT(DISTINCT vid) visitors, SUM(name='page_view') views,
        COUNT(DISTINCT CASE WHEN name='add_to_cart' THEN vid END) carts, COUNT(DISTINCT CASE WHEN name='begin_checkout' THEN vid END) checkouts
       FROM events WHERE ts >= ? GROUP BY day ORDER BY day DESC`)).bind(tzShift, since),
    q(`SELECT path, SUM(name='page_view') views, COUNT(DISTINCT vid) visitors, ROUND(AVG(CASE WHEN name='page_leave' THEN json_extract(props,'$.seconds') END)) avgSec
       FROM events WHERE ts >= ? AND name IN ('page_view','page_leave') GROUP BY path ORDER BY SUM(name='page_view') DESC LIMIT 40`),
    q(`SELECT json_extract(props,'$.name') part, COUNT(*) views, COUNT(DISTINCT vid) visitors FROM events WHERE ts >= ? AND name='view_item' GROUP BY part ORDER BY views DESC LIMIT 40`),
    q(`SELECT json_extract(props,'$.name') part, COUNT(*) adds, COUNT(DISTINCT vid) visitors FROM events WHERE ts >= ? AND name='add_to_cart' GROUP BY part ORDER BY adds DESC LIMIT 40`),
    q(`SELECT lower(json_extract(props,'$.q')) q, COUNT(*) times, COUNT(DISTINCT vid) visitors, MIN(json_extract(props,'$.results')) minResults
       FROM events WHERE ts >= ? AND name='search' GROUP BY 1 ORDER BY times DESC LIMIT 60`),
    q(`SELECT vid, json_extract(props,'$.ref') ref, json_extract(props,'$.utm.utm_source') utm, json_extract(props,'$.utm.gclid') gclid
       FROM events WHERE ts >= ? AND name='page_view' LIMIT 50000`),
    q(`SELECT COALESCE(city,'?') city, COALESCE(region,'') region, COALESCE(country,'') country, COUNT(DISTINCT vid) visitors FROM events WHERE ts >= ? GROUP BY 1,2,3 ORDER BY visitors DESC LIMIT 40`),
    q(`SELECT device, browser, COUNT(DISTINCT vid) visitors FROM events WHERE ts >= ? GROUP BY 1,2 ORDER BY visitors DESC LIMIT 20`),
    // Everyone who put something in a cart: what was in it, how far they got
    q(`SELECT vid, MIN(ts) firstTs, MAX(ts) lastTs, MAX(city) city, MAX(region) region, MAX(device) device,
         (SELECT props FROM events e2 WHERE e2.vid = e.vid AND e2.name IN ('add_to_cart','cart_qty','remove_from_cart','cart_open','begin_checkout','cart_restored','cart_close') AND e2.ts >= ? ORDER BY ts DESC LIMIT 1) lastCart,
         SUM(name='add_to_cart') adds, SUM(name='cart_open') cartOpens, MAX(name='postcode') gavePostcode, MAX(name='begin_checkout') beganCheckout,
         MAX(name='checkout_session') reachedStripe, MAX(name IN ('checkout_error','checkout_failed')) checkoutError, MAX(name='purchase') purchased
       FROM events e WHERE ts >= ? AND vid IN (SELECT vid FROM events WHERE ts >= ? AND name IN ('add_to_cart','cart_restored'))
       GROUP BY vid ORDER BY lastTs DESC LIMIT 100`, since, since),
    // Recent visits, newest first
    q(`SELECT sid, vid, MIN(ts) startTs, MAX(ts) endTs, MAX(city) city, MAX(region) region, MAX(device) device, MAX(browser) browser,
         SUM(name='page_view') pages, (SELECT path FROM events e2 WHERE e2.sid = e.sid ORDER BY ts LIMIT 1) landing,
         (SELECT json_extract(props,'$.ref') FROM events e2 WHERE e2.sid = e.sid AND name='page_view' ORDER BY ts LIMIT 1) ref,
         SUM(name='view_item') partViews, SUM(name='search') searches, SUM(name='add_to_cart') adds, MAX(name='begin_checkout') checkout, MAX(name='purchase') purchased,
         SUM(name IN ('call_click','sms_click','email_click','ask_form')) contacts
       FROM events e WHERE ts >= ? GROUP BY sid ORDER BY startTs DESC LIMIT 150`),
    q(`SELECT ts, vid, name, path, props, city FROM events WHERE ts >= ? AND name IN ('call_click','sms_click','email_click','ask_form','copy') ORDER BY ts DESC LIMIT 60`),
    q(`SELECT ts, name, path, props FROM events WHERE ts >= ? AND name IN ('js_error','checkout_error','checkout_failed','shipping_quote_failed') ORDER BY ts DESC LIMIT 30`),
  ]);
  // Where visitors came from: the referring site's name, an ad tag, or direct
  const own = /vmstruckparts\.com\.au|vms-truck-parts\.pages\.dev/;
  const src = {};
  for (const r of refs.results) {
    if (r.ref && own.test(r.ref)) continue; // moving between our own pages
    let name = r.gclid ? "Google Ads" : r.utm ? r.utm : "(direct, typed, or an app)";
    if (!r.gclid && !r.utm && r.ref) try { name = new URL(r.ref).host.replace(/^www\./, ""); } catch { name = r.ref.slice(0, 60); }
    const o = src[name] || (src[name] = { source: name, visitors: new Set(), landings: 0 });
    o.visitors.add(r.vid); o.landings++;
  }
  const sources = Object.values(src).map(o => ({ source: o.source, visitors: o.visitors.size, landings: o.landings })).sort((a, b) => b.visitors - a.visitors);
  return json({
    days, since, totals: totals.results[0], daily: daily.results, pages: pages.results, parts: parts.results, adds: adds.results,
    searches: searches.results, sources, places: places.results, devices: devices.results,
    carts: carts.results, sessions: sessions.results, contacts: contacts.results, errors: errors.results,
    stripe: (r => Array.isArray(r) ? r.map(x => ({ ...x, ownerTest: x.ownerTest || ownVids.has(x.visitor) })) : r)(await stripe),
    withOwn,
  });
}

export async function onRequestPost({ request, env }) {
  if (!env.STATS_KEY) return json({ error: "Stats are switched off" }, 503);
  if (!same(request.headers.get("X-Stats-Key") || "", env.STATS_KEY)) return json({ error: "Wrong key" }, 401);
  if (!env.DB) return json({ error: "No database" }, 503);
  let body; try { body = await request.json(); } catch { return json({ error: "Bad request" }, 400); }
  const vid = String(body.owner || "").replace(/[^a-z0-9]/gi, "").slice(0, 40);
  if (!vid) return json({ error: "No visitor id" }, 400);
  await ensureSchema(env.DB);
  const r = await env.DB.prepare("UPDATE events SET own = ? WHERE vid = ?").bind(body.undo ? 0 : 1, vid).run();
  return json({ ok: true, tagged: r.meta.changes });
}
