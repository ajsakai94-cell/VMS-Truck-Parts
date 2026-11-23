// Cloudflare Pages Function: POST /api/checkout
// Builds a Stripe Checkout session. Prices always come from products.json on the server,
// never from the browser, so nobody can change a price in their cart.
// Needs one secret in Cloudflare: STRIPE_SECRET_KEY (starts with sk_live_ or sk_test_).
// Shipping is priced by shipping.js (Australia Post to the postcode typed in the cart, or flat rates).

import { quoteShipping } from "./shipping.js";
import { logEvents } from "./t.js";
import { alertOwner } from "./notify.js";

export async function onRequestPost({ request, env, waitUntil }) {
  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  if (!env.STRIPE_SECRET_KEY) return json({ error: "Payments are not set up yet" }, 500);

  let body;
  try { body = await request.json(); } catch { return json({ error: "Bad request" }, 400); }
  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) return json({ error: "Your cart is empty" }, 400);

  const origin = new URL(request.url).origin;
  const data = await (await fetch(origin + "/products.json")).json();
  const byId = Object.fromEntries(data.products.map(p => [p.id, p]));

  const form = new URLSearchParams();
  let i = 0;
  for (const it of items) {
    const p = byId[it.id];
    const qty = Math.floor(Number(it.qty));
    if (!p || !p.available || p.price == null || !(qty >= 1 && qty <= 50)) {
      return json({ error: `${p ? p.name : "A part"} can't be ordered online right now` }, 400);
    }
    if (p.options && !p.options.includes(it.option)) return json({ error: `Pick a ${(p.optionLabel || "side").toLowerCase()} for ${p.name}` }, 400);
    if (p.maxQty && qty > p.maxQty) return json({ error: `Only ${p.maxQty} ${p.name} available` }, 400);
    const name = p.name + (it.option ? ` (${it.option})` : "") + ` to suit ${data.truck}`;
    const cents = Math.round(p.price * 100);
    form.append(`line_items[${i}][quantity]`, String(qty));
    form.append(`line_items[${i}][price_data][currency]`, data.currency);
    form.append(`line_items[${i}][price_data][unit_amount]`, String(cents));
    form.append(`line_items[${i}][price_data][product_data][name]`, name);
    const img = p.image && (p.image.startsWith("https://") ? p.image : p.image.startsWith("/") ? origin + p.image : "");
    if (img) form.append(`line_items[${i}][price_data][product_data][images][0]`, img);
    i++;
  }

  // No free shipping. Priced to the postcode from the cart; Stripe's own address form can't change it,
  // so the postcode is in the option name and the session metadata for checking at dispatch.
  const postcode = /^\d{4}$/.test(String(body.postcode || "")) ? String(body.postcode) : "";
  const ship = await quoteShipping(env, data, items, postcode);
  const options = ship.quote
    ? [{ name: "Delivery: " + ship.label.charAt(0).toLowerCase() + ship.label.slice(1), amount: 0 }]
    : [{ name: ship.label, amount: ship.cents, min: 2, max: 7 }];
  if (postcode) form.append("metadata[quoted_postcode]", postcode);
  form.append("metadata[shipping_source]", ship.source || "quote");
  // Links the Stripe session to the visitor in the site activity log (see /admin/)
  const vid = String(body.vid || "").replace(/[^a-z0-9]/gi, "").slice(0, 40), sid = String(body.sid || "").replace(/[^a-z0-9]/gi, "").slice(0, 40);
  if (vid) { form.append("client_reference_id", vid); form.append("metadata[visitor]", vid); }
  const own = body.own ? 1 : 0;
  if (own) form.append("metadata[owner_test]", "yes"); // the owner's own device: a test, not a customer
  if (data.shipping.pickup || ship.quote) options.push({ name: "Pickup in Victoria (we'll message you)", amount: 0 });
  options.forEach((o, n) => {
    const k = `shipping_options[${n}][shipping_rate_data]`;
    form.append(`${k}[type]`, "fixed_amount");
    form.append(`${k}[display_name]`, o.name);
    form.append(`${k}[fixed_amount][amount]`, String(o.amount));
    form.append(`${k}[fixed_amount][currency]`, data.currency);
    if (o.min) {
      form.append(`${k}[delivery_estimate][minimum][unit]`, "business_day");
      form.append(`${k}[delivery_estimate][minimum][value]`, String(o.min));
      form.append(`${k}[delivery_estimate][maximum][unit]`, "business_day");
      form.append(`${k}[delivery_estimate][maximum][value]`, String(o.max));
    }
  });

  form.append("mode", "payment");
  form.append("shipping_address_collection[allowed_countries][0]", "AU");
  form.append("phone_number_collection[enabled]", "true");
  form.append("billing_address_collection", "auto");
  form.append("success_url", origin + "/success.html?session={CHECKOUT_SESSION_ID}");
  form.append("cancel_url", origin + "/#cart"); // back from Stripe = the cart open again, still filled

  const log = ev => waitUntil(logEvents(env, request, vid, sid, [{ ...ev, path: "/api/checkout" }], own).catch(() => {}));
  // If Stripe can't be reached at all, still answer with a message the cart can show (it adds our phone number)
  let res, out;
  try {
    res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
    });
    out = await res.json();
  } catch (e) {
    log({ n: "checkout_failed", p: { error: "Stripe unreachable: " + String(e.message || e).slice(0, 150), items } });
    waitUntil(alertOwner(env, "stripe-down", "checkout couldn't reach Stripe, so a customer couldn't pay. Check Stripe status; they may call you.").catch(() => {}));
    return json({ error: "The payment page is not responding" }, 503);
  }
  if (!res.ok) {
    const error = (out.error && out.error.message) || "Stripe error";
    log({ n: "checkout_failed", p: { error, items } });
    waitUntil(alertOwner(env, "stripe-error", `checkout failed for a customer: ${error.slice(0, 120)}`).catch(() => {}));
    return json({ error }, 502);
  }
  log({ n: "checkout_session", p: { session: out.id, total: out.amount_total / 100, shipping: ship.cents / 100, shippingSource: ship.source || "quote", postcode: postcode || undefined, items } });
  return json({ url: out.url });
}
