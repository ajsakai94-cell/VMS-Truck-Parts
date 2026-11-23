// Cloudflare Pages Function: GET /api/recent-sales   (public, feeds the "Recently sold" pop-up in app.js)
// Reads paid orders straight from Stripe and returns only the part and the Australian state it went to,
// e.g. { name: "Battery Terminal Sensor (Negative)", state: "QLD" }. No names, postcodes, prices or dates
// ever leave this function. Left out: the owner's own test orders (metadata owner_test, or a visitor ID
// the site log has tagged as the owner's device), refunded or disputed orders, and unpaid sessions.
// The answer is cached for 30 minutes so the pop-up costs Stripe almost nothing.

const DAYS = 180, MAX = 12;
const STATES = new Set(["ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA"]);
const STATE_NAMES = { "australian capital territory": "ACT", "new south wales": "NSW", "northern territory": "NT", queensland: "QLD",
  "south australia": "SA", tasmania: "TAS", victoria: "VIC", "western australia": "WA" };
const out = (body, maxAge) => new Response(JSON.stringify(body), { headers: {
  "Content-Type": "application/json", "Cache-Control": `public, max-age=${maxAge}`, "X-Robots-Tag": "noindex" } });

function stateOf(s) {
  const sh = (s.collected_information || {}).shipping_details || s.shipping_details || {};
  const raw = String(((sh.address || (s.customer_details || {}).address || {}).state) || "").trim();
  const up = raw.toUpperCase();
  return STATES.has(up) ? up : STATE_NAMES[raw.toLowerCase()] || null;
}

async function ownerVisitors(env) {
  if (!env.DB) return new Set();
  try { return new Set((await env.DB.prepare("SELECT DISTINCT vid FROM events WHERE own = 1").all()).results.map(r => r.vid)); }
  catch { return new Set(); } // no events table yet
}

export async function onRequestGet({ request, env, waitUntil }) {
  if (!env.STRIPE_SECRET_KEY) return out({ sales: [] }, 300);
  const cache = caches.default, key = new Request(new URL("/api/recent-sales", request.url).toString());
  const hit = await cache.match(key);
  if (hit) return hit;

  const origin = new URL(request.url).origin;
  let sessions = [], products;
  try {
    const u = new URL("https://api.stripe.com/v1/checkout/sessions");
    u.searchParams.set("limit", "100");
    u.searchParams.set("status", "complete");
    u.searchParams.set("created[gte]", String(Math.floor(Date.now() / 1000) - DAYS * 86400));
    for (const e of ["data.line_items", "data.payment_intent.latest_charge"]) u.searchParams.append("expand[]", e);
    const [r, p, own] = await Promise.all([
      fetch(u, { headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` } }),
      fetch(origin + "/products.json"),
      ownerVisitors(env),
    ]);
    if (!r.ok) return out({ sales: [] }, 300);
    products = (await p.json()).products;
    sessions = (await r.json()).data.filter(s => {
      if (s.payment_status !== "paid" || !s.livemode) return false;
      const m = s.metadata || {};
      if (m.owner_test === "yes" || own.has(s.client_reference_id || m.visitor)) return false;
      const ch = (s.payment_intent && s.payment_intent.latest_charge) || {};
      return !(ch.amount_refunded > 0 || ch.disputed);
    });
  } catch { return out({ sales: [] }, 300); }

  // Line items read "<part name> (<option>) to suit <truck>"; match the longest part name so the pop-up
  // can link to the part page and show its photo.
  const byName = [...products].sort((a, b) => b.name.length - a.name.length);
  const sales = [], seen = new Set();
  for (const s of sessions) { // Stripe lists newest first
    const state = stateOf(s);
    for (const l of (s.line_items || {}).data || []) {
      const p = byName.find(x => String(l.description || "").startsWith(x.name));
      if (!p || !p.fits || !p.fits.models || !p.fits.models.length) continue; // only truck parts, not workshop gear
      const k = p.id + "|" + state;
      if (seen.has(k)) continue;
      seen.add(k);
      sales.push({ name: p.name, url: `/parts/${p.slug}/`, img: p.thumb || p.image || null, state });
      if (sales.length >= MAX) break;
    }
    if (sales.length >= MAX) break;
  }
  const res = out({ sales }, 1800);
  waitUntil(cache.put(key, res.clone()));
  return res;
}
