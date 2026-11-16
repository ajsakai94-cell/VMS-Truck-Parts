// Cloudflare Pages Function: POST /api/shipping  { items: [{id, qty}], postcode: "4655" }
// Prices delivery with the Australia Post Postage Assessment Calculator (PAC) API, using each part's
// packed box size and weight ("pack": [length cm, width cm, height cm, kg] in products.json).
// checkout.js imports quoteShipping() so the price in the cart and the price Stripe charges are the same.
// Needs one secret in Cloudflare: AUSPOST_API_KEY (free from developers.auspost.com.au).
// If the key is missing, the API fails, or a part has no "pack", that part falls back to the flat
// size-class rates in products.json (shipping.flatRate / shipping.rates), so checkout never breaks.

const PAC = "https://digitalapi.auspost.com.au/postage/parcel/domestic/calculate.json";
const MAX_KG = 22, MAX_CM = 105, MAX_M3 = 0.25; // Australia Post domestic parcel limits
const SLACK = 1.1; // combined parcels need a bit more room than the parts' boxes add up to

// Group the units into as few Australia Post-sized parcels as possible (biggest first).
// One part on its own ships in its own box; several parts share a box at least as long as the
// longest part, with a little slack, so the cubic weight isn't understated.
function packParcels(units) {
  const parcels = [];
  for (const u of [...units].sort((a, b) => b.vol - a.vol)) {
    let box = parcels.find(b => b.kg + u.kg <= MAX_KG && (b.vol + u.vol) * SLACK <= MAX_M3 * 1e6);
    if (!box) parcels.push(box = { kg: 0, vol: 0, parts: [] });
    box.kg += u.kg; box.vol += u.vol; box.parts.push(u);
  }
  return parcels.map(b => {
    const kg = Math.round(b.kg * 100) / 100;
    if (b.parts.length === 1) { const [l, w, h] = b.parts[0].dims; return { length: l, width: w, height: h, weight: kg }; }
    const vol = b.vol * SLACK;
    const long = Math.max(...b.parts.map(u => u.dims[0])), mid = Math.max(...b.parts.map(u => u.dims[1]));
    const side = Math.max(mid, Math.sqrt(vol / long));
    return { length: Math.ceil(long), width: Math.ceil(side), height: Math.ceil(vol / (long * side)), weight: kg };
  });
}

async function pacPrice(env, from, to, p) {
  const q = new URLSearchParams({ from_postcode: from, to_postcode: to, length: p.length, width: p.width, height: p.height, weight: p.weight, service_code: "AUS_PARCEL_REGULAR" });
  const res = await fetch(`${PAC}?${q}`, { headers: { "AUTH-KEY": env.AUSPOST_API_KEY } });
  if (!res.ok) throw new Error("Australia Post " + res.status);
  const out = await res.json();
  const cost = Number(out && out.postage_result && out.postage_result.total_cost);
  if (!(cost > 0)) throw new Error("Australia Post gave no price");
  return cost;
}

// Returns { cents, label, quote } — quote: true means freight is quoted by phone (e.g. cylinder head).
export async function quoteShipping(env, data, items, postcode) {
  const s = data.shipping, byId = Object.fromEntries(data.products.map(p => [p.id, p]));
  const lines = items.map(it => ({ p: byId[it.id], qty: Math.floor(Number(it.qty)) })).filter(l => l.p && l.qty >= 1);
  if (lines.some(l => l.p.freightQuote)) return { cents: 0, quote: true, label: "Freight quoted separately (we'll call you before sending)" };

  const flatFor = ls => Math.round(Math.max(0, ...ls.map(l => l.p.shipClass ? s.rates[l.p.shipClass] : s.flatRate)) * 100);
  const flat = { cents: flatFor(lines), label: "Standard shipping, Australia-wide", source: "flat" };
  if (!env.AUSPOST_API_KEY || !/^\d{4}$/.test(String(postcode || ""))) return flat;

  // parts with a box size go by Australia Post; anything without one (or too big for Aus Post) uses its flat rate
  const fits = l => Array.isArray(l.p.pack) && l.p.pack[3] <= MAX_KG && Math.max(...l.p.pack.slice(0, 3)) <= MAX_CM;
  const posted = lines.filter(fits), other = lines.filter(l => !fits(l));
  const units = posted.flatMap(l => Array.from({ length: l.qty }, () => {
    const dims = l.p.pack.slice(0, 3).sort((a, b) => b - a);
    return { kg: l.p.pack[3], vol: dims[0] * dims[1] * dims[2], dims };
  }));
  if (!units.length) return flat;
  try {
    const parcels = packParcels(units);
    const prices = await Promise.all(parcels.map(p => pacPrice(env, s.from, postcode, p)));
    const handling = (s.handling || 0) * parcels.length;
    const cents = Math.round((prices.reduce((a, b) => a + b, 0) + handling) * 100) + (other.length ? flatFor(other) : 0);
    const n = parcels.length;
    return { cents, label: `Australia Post Parcel Post to ${postcode}` + (n > 1 ? ` (${n} parcels)` : ""), source: "auspost", parcels };
  } catch (e) {
    return { ...flat, error: String(e.message || e) };
  }
}

export async function onRequestPost({ request, env }) {
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  let body;
  try { body = await request.json(); } catch { return json({ error: "Bad request" }, 400); }
  const items = Array.isArray(body.items) ? body.items.slice(0, 50) : [];
  if (!items.length) return json({ error: "Your cart is empty" }, 400);
  const origin = new URL(request.url).origin;
  const data = await (await fetch(origin + "/products.json")).json();
  const q = await quoteShipping(env, data, items, body.postcode);
  return json({ cents: q.cents, label: q.label, quote: !!q.quote, source: q.source || null });
}
