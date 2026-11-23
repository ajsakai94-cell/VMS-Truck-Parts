// Cloudflare Pages Function: GET /api/order-summary?session=cs_...
// Used only by /success.html right after payment, to offer Google Customer Reviews (Google emails the buyer
// once the parcel should have arrived and asks them to rate the shop; the ratings show as seller stars on
// Google Shopping). Returns the buyer's own email and a delivery estimate, and only for a paid order
// less than 2 hours old, so an old or guessed link gives nothing away.

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });

export async function onRequestGet({ request, env }) {
  const session = new URL(request.url).searchParams.get("session") || "";
  if (!/^cs_(live|test)_[A-Za-z0-9]{10,200}$/.test(session) || !env.STRIPE_SECRET_KEY) return json({}, 404);
  const r = await fetch(`https://api.stripe.com/v1/checkout/sessions/${session}?expand[]=shipping_cost.shipping_rate`, { headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` } });
  const s = await r.json();
  if (!r.ok || s.payment_status !== "paid" || Date.now() / 1000 - s.created > 2 * 3600) return json({}, 404);
  const email = (s.customer_details || {}).email || s.customer_email;
  const rate = (s.shipping_cost || {}).shipping_rate;
  const pickup = /pickup/i.test((rate && rate.display_name) || "");
  // Pack and post in 1-2 business days + 2-7 days in transit: ask about 10 days out (pickups 5)
  const eta = new Date(Date.now() + (pickup ? 5 : 10) * 86400e3).toLocaleDateString("en-CA", { timeZone: "Australia/Melbourne" });
  return json({ order: session.slice(-12), email, country: "AU", eta });
}
