// Cloudflare Pages Function: GET /api/order-summary?session=cs_...
// Used only by /success.html right after payment, to record the sale value for Google Ads.
// Returns only the order value, and only for a paid order less than 2 hours old.

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });

export async function onRequestGet({ request, env }) {
  const session = new URL(request.url).searchParams.get("session") || "";
  if (!/^cs_(live|test)_[A-Za-z0-9]{10,200}$/.test(session) || !env.STRIPE_SECRET_KEY) return json({}, 404);
  const r = await fetch(`https://api.stripe.com/v1/checkout/sessions/${session}`, { headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` } });
  const s = await r.json();
  if (!r.ok || s.payment_status !== "paid" || Date.now() / 1000 - s.created > 2 * 3600) return json({}, 404);
  // value = what the customer paid in AUD (for the Google Ads sale record)
  return json({ value: (s.amount_total || 0) / 100 });
}
