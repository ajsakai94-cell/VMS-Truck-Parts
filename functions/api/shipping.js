// Cloudflare Pages Function: POST /api/shipping  { items: [{id, qty}], postcode: "4655" }
// Small parts go in Australia Post flat-rate satchels ("satchel" in products.json, same price Australia-wide).
// Heavy parts are priced with the Australia Post Postage Assessment Calculator (PAC) API, using their
// packed box size and weight ("pack": [length cm, width cm, height cm, kg] in products.json).
// checkout.js imports quoteShipping() so the price in the cart and the price Stripe charges are the same.
// Needs one secret in Cloudflare: AUSPOST_API_KEY (free from developers.auspost.com.au).
// If the key is missing, the API fails, or a heavy part has no "pack", it falls back to the flat
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
  const res = await fetch(`${PAC}?${q}`, { headers: { "AUTH-KEY": env.AUSPOST_API_KEY, "Accept": "application/json" } });
  if (!res.ok) throw new Error("Australia Post " + res.status + " " + (await res.text()).slice(0, 200));
  const out = await res.json();
  const cost = Number(out && out.postage_result && out.postage_result.total_cost);
  if (!(cost > 0)) throw new Error("Australia Post gave no price");
  return cost;
}

// Satchel parts: Australia Post flat-rate satchels (same price anywhere in Australia, 5 kg max each).
// Each part takes up some of a satchel ("fits": small 1, medium 2, large 4, xl 8); parts share satchels
// biggest first, and each satchel is charged at the smallest size that holds what's in it.
// A part can also list its own satchels (the service kit ships as two XL satchels).
// "satchelShare" overrides how much room a part takes (e.g. a small mirror cover 1.5 + battery sensor 0.5
// share one medium satchel: AJ packed exactly that on 23 Nov 2026).
function packSatchels(sizes, units) {
  const order = Object.keys(sizes).sort((a, b) => sizes[a].fits - sizes[b].fits);
  const cap = sizes[order[order.length - 1]].fits, bags = [];
  for (const u of [...units].sort((a, b) => b.fits - a.fits)) {
    let bag = !u.own && bags.find(b => !b.own && b.fits + u.fits <= cap && b.kg + u.kg <= 5);
    if (!bag) bags.push(bag = { fits: 0, kg: 0, own: u.own });
    bag.fits += u.fits; bag.kg += u.kg;
  }
  return bags.map(b => order.find(k => sizes[k].fits >= b.fits));
}

// Returns { cents, label, quote, needsPostcode }. quote: true = freight quoted by phone (e.g. cylinder head).
export async function quoteShipping(env, data, items, postcode) {
  const s = data.shipping, byId = Object.fromEntries(data.products.map(p => [p.id, p]));
  const lines = items.map(it => ({ p: byId[it.id], qty: Math.floor(Number(it.qty)) })).filter(l => l.p && l.qty >= 1);
  if (lines.some(l => l.p.freightQuote)) return { cents: 0, quote: true, label: "Freight quoted separately (we'll call you before sending)" };
  const each = (l, f) => Array.from({ length: l.qty }, f).flat();

  // 1. satchel parts: flat national price, no postcode needed
  const sat = lines.filter(l => l.p.satchel);
  const units = sat.flatMap(l => each(l, () => Array.isArray(l.p.satchel)
    ? l.p.satchel.map(z => ({ fits: s.satchels[z].fits, kg: 5, own: true }))
    : [{ fits: l.p.satchelShare || s.satchels[l.p.satchel].fits, kg: l.p.kg || 0 }]));
  const bags = packSatchels(s.satchels, units);
  const satCents = bags.reduce((t, z) => t + Math.round(s.satchels[z].price * 100), 0);
  const parts = bags.length ? [`Australia Post satchel${bags.length > 1 ? " x" + bags.length : ""}`] : [];

  // 2. boxed parts (heavy): Australia Post Parcel Post to the postcode; flat size-class rate if that can't be done
  // a part can have both: the service kit = satchel for the small filters + a box for the air filter
  const rest = lines.filter(l => l.p.pack || !l.p.satchel);
  if (!rest.length) return { cents: satCents, label: parts[0], source: "satchel", bags };
  const flatFor = ls => Math.round(Math.max(0, ...ls.map(l => l.p.shipClass ? s.rates[l.p.shipClass] : s.flatRate)) * 100);
  const pcOk = /^\d{4}$/.test(String(postcode || ""));
  const flat = { cents: satCents + flatFor(rest), label: [...parts, "Heavy item shipping, Australia-wide"].join(" + "), source: "flat", needsPostcode: !pcOk };
  if (!pcOk) return flat;
  if (!env.AUSPOST_API_KEY) return { ...flat, error: "AUSPOST_API_KEY not set" };
  const fits = l => Array.isArray(l.p.pack) && l.p.pack[3] <= MAX_KG && Math.max(...l.p.pack.slice(0, 3)) <= MAX_CM;
  const posted = rest.filter(fits), other = rest.filter(l => !fits(l));
  if (!posted.length) return flat;
  const boxes = posted.flatMap(l => each(l, () => {
    const dims = l.p.pack.slice(0, 3).sort((a, b) => b - a);
    return { kg: l.p.pack[3], vol: dims[0] * dims[1] * dims[2], dims };
  }));
  try {
    const parcels = packParcels(boxes);
    const prices = await Promise.all(parcels.map(p => pacPrice(env, s.from, postcode, p)));
    const handling = (s.handling || 0) * parcels.length;
    const cents = satCents + Math.round((prices.reduce((a, b) => a + b, 0) + handling) * 100) + (other.length ? flatFor(other) : 0);
    const n = parcels.length;
    return { cents, label: [...parts, `Australia Post Parcel Post to ${postcode}` + (n > 1 ? ` (${n} parcels)` : "")].join(" + "), source: "auspost", bags, parcels };
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
  return json({ cents: q.cents, label: q.label, quote: !!q.quote, source: q.source || null, needsPostcode: !!q.needsPostcode, error: q.error || null });
}
