// Cloudflare Pages Function: POST /api/checkout
// Builds a Stripe Checkout session. Prices always come from products.json on the server,
// never from the browser, so nobody can change a price in their cart.
// Needs one secret in Cloudflare: STRIPE_SECRET_KEY (starts with sk_live_ or sk_test_).

export async function onRequestPost({ request, env }) {
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
  let subtotal = 0;
  let freightQuote = false; // a bulky item (e.g. cylinder head): no free shipping, freight quoted after the order
  let i = 0;
  for (const it of items) {
    const p = byId[it.id];
    const qty = Math.floor(Number(it.qty));
    if (!p || !p.available || p.price == null || !(qty >= 1 && qty <= 50)) {
      return json({ error: `${p ? p.name : "A part"} can't be ordered online right now` }, 400);
    }
    if (p.options && !p.options.includes(it.option)) return json({ error: `Pick a side for ${p.name}` }, 400);
    if (p.maxQty && qty > p.maxQty) return json({ error: `Only ${p.maxQty} ${p.name} available` }, 400);
    if (p.freightQuote) freightQuote = true;
    const name = p.name + (it.option ? ` (${it.option})` : "") + ` to suit ${data.truck}`;
    const cents = Math.round(p.price * 100);
    subtotal += cents * qty;
    form.append(`line_items[${i}][quantity]`, String(qty));
    form.append(`line_items[${i}][price_data][currency]`, data.currency);
    form.append(`line_items[${i}][price_data][unit_amount]`, String(cents));
    form.append(`line_items[${i}][price_data][product_data][name]`, name);
    const img = p.image && (p.image.startsWith("https://") ? p.image : p.image.startsWith("/") ? origin + p.image : "");
    if (img) form.append(`line_items[${i}][price_data][product_data][images][0]`, img);
    i++;
  }

  const s = data.shipping;
  const shipCents = subtotal >= Math.round(s.freeOver * 100) ? 0 : Math.round(s.flatRate * 100);
  const options = freightQuote
    ? [{ name: "Delivery: freight quoted separately (we'll call you before sending)", amount: 0 }]
    : [{ name: shipCents ? "Standard shipping, Australia-wide" : "Free standard shipping", amount: shipCents, min: 2, max: 7 }];
  if (s.pickup || freightQuote) options.push({ name: "Pickup in Victoria (we'll message you)", amount: 0 });
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
  form.append("cancel_url", origin + "/");

  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
  });
  const out = await res.json();
  if (!res.ok) return json({ error: (out.error && out.error.message) || "Stripe error" }, 502);
  return json({ url: out.url });
}
