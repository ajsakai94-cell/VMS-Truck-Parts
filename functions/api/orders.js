// Cloudflare Pages Function: /api/orders   (used by the private /admin/orders/ page)
// GET  lists paid orders straight from Stripe (Checkout Sessions), so Stripe stays the one record of
//      what was bought and paid. Nothing about customers is copied into the site's database.
// POST { session, shipped, tracking, note, notify } saves the shop's own marks for an order (sent /
//      tracking number / a note) in the D1 table order_marks. With notify: true it also texts and emails
//      the customer the Australia Post tracking link (see notify.js for the services it uses).
// Needs the same secrets as /admin/: STATS_KEY (sent in the X-Stats-Key header) and STRIPE_SECRET_KEY,
// plus the D1 binding DB for the marks. Without STATS_KEY set, this endpoint is switched off.

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });

function same(a, b) { // constant-time compare
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

import { sendSms, sendEmail, smsReady, emailReady, trackingSms, trackingEmail } from "./notify.js";

// thanked_ts = new-order messages done and thank-you text sent, confirmed_ts = confirmation emailed (both by stripe-webhook.js); texted_ts / emailed_ts = tracking sent to the customer
const MARKS = `CREATE TABLE IF NOT EXISTS order_marks (session TEXT PRIMARY KEY, shipped_ts INTEGER, tracking TEXT, note TEXT, updated_ts INTEGER,
  thanked_ts INTEGER, confirmed_ts INTEGER, texted_ts INTEGER, emailed_ts INTEGER)`;
let ready = null;
export const ensureMarks = db => ready || (ready = db.prepare(MARKS).run().catch(e => { ready = null; throw e; }));

async function stripeOrders(env, since) {
  const out = [];
  let after = null;
  for (let page = 0; page < 5; page++) { // up to 500 orders per look
    const u = new URL("https://api.stripe.com/v1/checkout/sessions");
    u.searchParams.set("limit", "100");
    u.searchParams.set("status", "complete");
    u.searchParams.set("created[gte]", String(Math.floor(since / 1000)));
    if (after) u.searchParams.set("starting_after", after);
    for (const e of ["data.line_items", "data.payment_intent.latest_charge", "data.shipping_cost.shipping_rate"]) u.searchParams.append("expand[]", e);
    const r = await fetch(u, { headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` } });
    const j = await r.json();
    if (!r.ok) throw new Error((j.error && j.error.message) || "Stripe error");
    out.push(...j.data);
    if (!j.has_more || !j.data.length) break;
    after = j.data[j.data.length - 1].id;
  }
  return out;
}

function shape(s) {
  const c = s.customer_details || {};
  // Newer Stripe API versions put the address under collected_information
  const sh = (s.collected_information || {}).shipping_details || s.shipping_details || {};
  const a = sh.address || c.address || {};
  const pi = typeof s.payment_intent === "object" && s.payment_intent ? s.payment_intent : {};
  const ch = typeof pi.latest_charge === "object" && pi.latest_charge ? pi.latest_charge : {};
  const rate = (s.shipping_cost || {}).shipping_rate;
  const total = s.amount_total / 100, refunded = (ch.amount_refunded || 0) / 100;
  const meta = s.metadata || {};
  return {
    id: s.id,
    created: s.created * 1000,
    paid: s.payment_status === "paid",
    refunded, fullyRefunded: refunded > 0 && refunded >= total, disputed: !!ch.disputed,
    total, subtotal: s.amount_subtotal / 100,
    shipping: ((s.total_details || {}).amount_shipping || 0) / 100,
    shippingName: rate && typeof rate === "object" ? rate.display_name : null,
    items: ((s.line_items || {}).data || []).map(l => ({ qty: l.quantity, name: l.description, total: l.amount_total / 100 })),
    name: sh.name || c.name || null,
    email: c.email || s.customer_email || null,
    phone: c.phone || null,
    address: { line1: a.line1 || "", line2: a.line2 || "", city: a.city || "", state: a.state || "", postcode: a.postal_code || "" },
    quotedPostcode: meta.quoted_postcode || null,
    ownerTest: meta.owner_test === "yes",
    receipt: ch.receipt_url || null,
    dashboard: pi.id ? `https://dashboard.stripe.com/${s.livemode ? "" : "test/"}payments/${pi.id}` : null,
  };
}

export async function onRequestGet({ request, env }) {
  if (!env.STATS_KEY) return json({ error: "Orders are switched off: add the STATS_KEY secret in Cloudflare" }, 503);
  if (!same(request.headers.get("X-Stats-Key") || "", env.STATS_KEY)) return json({ error: "Wrong key" }, 401);
  if (!env.STRIPE_SECRET_KEY) return json({ error: "No Stripe key in Cloudflare" }, 503);
  const days = Math.min(1000, Math.max(1, Number(new URL(request.url).searchParams.get("days")) || 365));
  const since = Date.now() - days * 86400e3;
  let orders;
  try { orders = (await stripeOrders(env, since)).map(shape); } catch (e) { return json({ error: e.message }, 502); }
  let marks = {}, marksError = null;
  if (env.DB) {
    try {
      await ensureMarks(env.DB);
      const r = await env.DB.prepare("SELECT session, shipped_ts, tracking, note, thanked_ts, confirmed_ts, texted_ts, emailed_ts FROM order_marks").all();
      for (const m of r.results) marks[m.session] = { shipped: m.shipped_ts, tracking: m.tracking, note: m.note, thanked: m.thanked_ts, confirmed: m.confirmed_ts, texted: m.texted_ts, emailed: m.emailed_ts };
    } catch (e) { marksError = e.message; }
  } else marksError = "No database: sent marks can't be saved until the D1 binding DB is added";
  return json({ orders: orders.map(o => ({ ...o, ...(marks[o.id] || {}) })), marksError, days, sms: smsReady(env), email: emailReady(env),
    // Yes/no only (never the values), for the backend Settings page
    setup: { ownerAlerts: !!env.OWNER_MOBILE, webhook: !!env.STRIPE_WEBHOOK_SECRET, db: !!env.DB } });
}

export async function onRequestPost({ request, env }) {
  if (!env.STATS_KEY) return json({ error: "Orders are switched off" }, 503);
  if (!same(request.headers.get("X-Stats-Key") || "", env.STATS_KEY)) return json({ error: "Wrong key" }, 401);
  if (!env.DB) return json({ error: "No database: add the D1 binding DB in Cloudflare" }, 503);
  let b; try { b = await request.json(); } catch { return json({ error: "Bad request" }, 400); }
  const session = String(b.session || "");
  if (!/^cs_(live|test)_[A-Za-z0-9]{10,200}$/.test(session)) return json({ error: "Bad order id" }, 400);
  const clip = (v, n) => (v == null ? null : String(v).trim().slice(0, n) || null);
  await ensureMarks(env.DB);
  const now = Date.now();
  // Tracking numbers are copied off the sticker with spaces ("03 08006 ..."); store them without
  const tracking = clip(b.tracking == null ? null : String(b.tracking).replace(/\s+/g, ""), 60), note = clip(b.note, 1000);
  const old = await env.DB.prepare("SELECT shipped_ts, texted_ts, emailed_ts FROM order_marks WHERE session = ?").bind(session).first() || {};
  // Keep the first "sent" time if it's already marked sent
  const shipped = b.shipped ? old.shipped_ts || now : null;
  let texted = old.texted_ts || null, emailed = old.emailed_ts || null, sent = null;
  if (b.notify) {
    if (!tracking) return json({ error: "Type the tracking number first" }, 400);
    if (!/^[A-Za-z0-9 -]{6,40}$/.test(tracking)) return json({ error: "That doesn't look like a tracking number" }, 400);
    // Customer's name, phone and email come from Stripe, not from the browser
    const r = await fetch(`https://api.stripe.com/v1/checkout/sessions/${session}?expand[]=line_items`, { headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` } });
    const s = await r.json();
    if (!r.ok) return json({ error: (s.error && s.error.message) || "Stripe error" }, 502);
    const c = s.customer_details || {}, name = ((s.collected_information || {}).shipping_details || s.shipping_details || {}).name || c.name;
    const items = ((s.line_items || {}).data || []).map(l => ({ qty: l.quantity, name: l.description }));
    const em = trackingEmail(name, tracking, items);
    const [sms, mail] = await Promise.all([sendSms(env, c.phone, trackingSms(name, tracking)), sendEmail(env, c.email || s.customer_email, em.subject, em.text, em.html)]);
    if (sms.ok) texted = now;
    if (mail.ok) emailed = now;
    sent = { sms, email: mail };
  }
  // Sending tracking marks the order sent, but only if the text or the email actually went
  const shippedFinal = b.notify ? (sent.sms.ok || sent.email.ok ? old.shipped_ts || now : old.shipped_ts || null) : shipped;
  await env.DB.prepare(`INSERT INTO order_marks (session, shipped_ts, tracking, note, updated_ts, texted_ts, emailed_ts) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(session) DO UPDATE SET shipped_ts = excluded.shipped_ts, tracking = excluded.tracking, note = excluded.note, updated_ts = excluded.updated_ts,
        texted_ts = excluded.texted_ts, emailed_ts = excluded.emailed_ts`)
    .bind(session, shippedFinal, tracking, note, now, texted, emailed).run();
  return json({ ok: true, shipped: shippedFinal, tracking, note, texted, emailed, sent });
}
