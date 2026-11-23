// Cloudflare Pages Function: POST /api/stripe-webhook   (called by Stripe, not by people)
// When an order is paid (checkout.session.completed), once per order even if Stripe retries:
//   - emails the customer an order confirmation ("Thank you for your order")
//   - texts the customer a thank-you
//   - texts the owner what was ordered (secret OWNER_MOBILE, so the number isn't in this public repo)
//   - emails the shop a new-order alert with a link to /admin/orders/
// Needs the secret STRIPE_WEBHOOK_SECRET (whsec_..., from the webhook in Stripe), the SMS / email
// secrets described in notify.js, and the D1 binding DB. Anything not set up is skipped quietly.

import { sendSms, sendEmail, thanksSms, confirmEmail, SHOP } from "./notify.js";
import { ensureMarks, logMessage } from "./orders.js";

const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");

// Stripe-Signature: t=<time>,v1=<HMAC-SHA256 of "<time>.<body>" with the webhook secret>
export async function verify(secret, header, body) {
  const bits = String(header || "").split(",");
  const t = Number((bits.find(p => p.startsWith("t=")) || "").slice(2));
  const sigs = bits.filter(p => p.startsWith("v1=")).map(p => p.slice(3));
  if (!t || !sigs.length || Math.abs(Date.now() / 1000 - t) > 600) return false;
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const want = hex(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${t}.${body}`)));
  return sigs.some(s => s.length === want.length && [...s].reduce((d, c, i) => d | (c.charCodeAt(0) ^ want.charCodeAt(i)), 0) === 0);
}

async function newOrder(env, id) {
  if (env.DB) {
    // Claim the order first so a Stripe retry never messages anyone twice
    await ensureMarks(env.DB);
    await env.DB.prepare("INSERT OR IGNORE INTO order_marks (session, updated_ts) VALUES (?, ?)").bind(id, Date.now()).run();
    const r = await env.DB.prepare("UPDATE order_marks SET thanked_ts = ? WHERE session = ? AND thanked_ts IS NULL").bind(Date.now(), id).run();
    if (!r.meta.changes) return;
  }
  // The full order (items and postage option aren't in the webhook itself)
  const r = await fetch(`https://api.stripe.com/v1/checkout/sessions/${id}?expand[]=line_items&expand[]=shipping_cost.shipping_rate`,
    { headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` } });
  const s = await r.json();
  if (!r.ok) throw new Error((s.error && s.error.message) || "Stripe error");

  const c = s.customer_details || {}, sh = (s.collected_information || {}).shipping_details || s.shipping_details || {};
  const a = sh.address || {}, name = sh.name || c.name, email = c.email || s.customer_email;
  const rate = (s.shipping_cost || {}).shipping_rate;
  const order = {
    ref: id.slice(-8).toUpperCase(),
    name, email,
    items: ((s.line_items || {}).data || []).map(l => ({ qty: l.quantity, name: String(l.description), total: l.amount_total / 100 })),
    shippingName: rate && typeof rate === "object" ? rate.display_name : "Postage",
    shipping: ((s.total_details || {}).amount_shipping || 0) / 100,
    total: s.amount_total / 100,
    address: [sh.name, a.line1, a.line2, [a.city, a.state, a.postal_code].filter(Boolean).join(" ")].filter(Boolean),
  };
  order.pickup = /pickup/i.test(order.shippingName || "");
  const money = n => "$" + n.toFixed(2);
  const short = order.items.map(i => `${i.qty} x ${i.name.replace(/ to suit .*$/, "")}`);
  const where = [a.city, a.state].filter(Boolean).join(" ");

  const conf = confirmEmail(order), thanks = thanksSms(name);
  const [mail, sms] = await Promise.all([
    sendEmail(env, email, conf.subject, conf.text, conf.html),
    sendSms(env, c.phone, thanks),
  ]);
  await Promise.all([
    logMessage(env.DB, id, { who: "customer", channel: "email", to: email, subject: conf.subject, body: conf.text, result: mail }),
    logMessage(env.DB, id, { who: "customer", channel: "text", to: c.phone, body: thanks, result: sms }),
  ]);
  if (env.DB) await env.DB.prepare("UPDATE order_marks SET confirmed_ts = ? WHERE session = ?").bind(mail.ok ? Date.now() : null, id).run();
  if (env.DB && !sms.ok) await env.DB.prepare("UPDATE order_marks SET thanked_ts = NULL WHERE session = ?").bind(id).run();

  const alert = `New VMS order ${money(order.total)}: ${short.join(", ") || "see orders page"}. ${name || email || "Customer"}${order.pickup ? " (pickup)" : where ? ", " + where : ""}${c.phone ? ", " + c.phone : ""}. vmstruckparts.com.au/admin/orders/`;
  const shopSubject = `New order: ${money(order.total)} from ${name || email || "a customer"}`;
  const shopText = `New paid order on the website.

${order.pickup ? "PICKUP: message them to arrange\n" + (name || "") : order.address.join("\n")}
${c.phone || ""}  ${email || ""}

${short.join("\n")}
${order.shippingName}: ${money(order.shipping)}
Total: ${money(order.total)}

Order confirmation email: ${mail.ok ? "sent" : mail.skipped || mail.error}
Thank-you text: ${sms.ok ? "sent" : sms.skipped || sms.error}

See the order and send tracking: https://vmstruckparts.com.au/admin/orders/`;
  const [own, shop] = await Promise.all([
    env.OWNER_MOBILE ? sendSms(env, env.OWNER_MOBILE, alert) : null,
    sendEmail(env, SHOP.email, shopSubject, shopText),
  ]);
  await Promise.all([
    logMessage(env.DB, id, { who: "owner", channel: "text", to: env.OWNER_MOBILE, body: alert, result: own }),
    logMessage(env.DB, id, { who: "shop", channel: "email", to: SHOP.email, subject: shopSubject, body: shopText, result: shop }),
  ]);
}

export async function onRequestPost({ request, env, waitUntil }) {
  if (!env.STRIPE_WEBHOOK_SECRET) return new Response("Webhook not set up", { status: 503 });
  const body = await request.text();
  if (!(await verify(env.STRIPE_WEBHOOK_SECRET, request.headers.get("Stripe-Signature"), body))) return new Response("Bad signature", { status: 400 });
  let ev; try { ev = JSON.parse(body); } catch { return new Response("Bad body", { status: 400 }); }
  if (ev.type !== "checkout.session.completed" && ev.type !== "checkout.session.async_payment_succeeded") return new Response("ignored");
  const s = ev.data.object;
  if (s.payment_status !== "paid") return new Response("not paid yet");
  waitUntil(newOrder(env, s.id).catch(e => console.log("new order messages failed", e.message)));
  return new Response("ok");
}
