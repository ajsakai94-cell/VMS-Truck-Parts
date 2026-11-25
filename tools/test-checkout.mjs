// Checkout safety test: runs /api/checkout and /api/shipping against every part in products.json with
// Stripe and Australia Post faked, so no money moves and no keys are needed. Runs on every PR (check.yml).
// It proves: every buyable part opens checkout at its products.json price, postage is added, the browser
// can't change a price, sold-out parts are refused, and a Stripe outage gives the customer a clear message.
//   node tools/test-checkout.mjs
import { readFileSync, mkdtempSync, cpSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const data = JSON.parse(readFileSync(join(ROOT, "products.json"), "utf8"));

// The functions are ES modules named .js; copy them next to a package.json that says so
const dir = mkdtempSync(join(tmpdir(), "vms-fn-"));
cpSync(join(ROOT, "functions/api"), dir, { recursive: true });
writeFileSync(join(dir, "package.json"), '{"type":"module"}');
const checkout = await import(pathToFileURL(join(dir, "checkout.js")));
const shipping = await import(pathToFileURL(join(dir, "shipping.js")));

let stripeMode = "ok", lastForm = null, texts = [], intlCalls = [];
globalThis.fetch = async (url, opts = {}) => {
  url = String(url);
  const res = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  if (url.endsWith("/products.json")) return res(data);
  if (url.startsWith("https://digitalapi.auspost.com.au/postage/parcel/international/")) {
    intlCalls.push(new URL(url).searchParams);
    if (stripeMode === "auspost-down") return res({ error: "bad key" }, 403);
    if (url.includes("/service.json")) return res({ services: { service: [{ code: "INT_PARCEL_COR_OWN_PACKAGING", name: "Courier", price: "90.00" }, { code: "INT_PARCEL_STD_OWN_PACKAGING", name: "Standard", price: "28.75" }] } });
    return stripeMode === "intl-code-gone" ? res({ error: { errorMessage: "Please enter a valid Service code." } }, 404) : res({ postage_result: { total_cost: "28.75" } });
  }
  if (url.startsWith("https://digitalapi.auspost.com.au/")) return stripeMode === "auspost-down" ? res({ error: "bad key" }, 403) : res({ postage_result: { total_cost: "31.50" } });
  if (url.startsWith("https://sms.example/")) { texts.push(JSON.parse(opts.body)); return res({ state: "Pending" }); }
  if (url === "https://api.stripe.com/v1/checkout/sessions") {
    if (stripeMode === "down") throw new Error("network connection lost");
    if (stripeMode === "error") return res({ error: { message: "Invalid API Key provided" } }, 401);
    lastForm = new URLSearchParams(opts.body);
    let total = 0;
    for (let i = 0; lastForm.has(`line_items[${i}][quantity]`); i++)
      total += Number(lastForm.get(`line_items[${i}][quantity]`)) * Number(lastForm.get(`line_items[${i}][price_data][unit_amount]`));
    return res({ id: "cs_test_fake", url: "https://checkout.stripe.com/c/pay/cs_test_fake", amount_total: total });
  }
  throw new Error("Unexpected fetch in test: " + url);
};

const env = { STRIPE_SECRET_KEY: "sk_test_fake", AUSPOST_API_KEY: "fake" };
const alertEnv = { ...env, OWNER_MOBILE: "0400000000", SMS_GATEWAY_URL: "https://sms.example/", SMS_GATEWAY_USER: "u", SMS_GATEWAY_PASS: "p" };
const call = async (fn, body, e = env) => {
  const waits = [];
  const request = new Request("https://vmstruckparts.com.au/api/x", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const r = await fn({ request, env: e, waitUntil: p => waits.push(p) });
  await Promise.all(waits);
  let j; try { j = await r.json(); } catch { j = { notJson: true }; }
  return { status: r.status, j };
};

let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log("FAIL: " + msg); } };
const shipOptions = f => { const o = []; for (let n = 0; f.has(`shipping_options[${n}][shipping_rate_data][display_name]`); n++) o.push({ name: f.get(`shipping_options[${n}][shipping_rate_data][display_name]`), cents: Number(f.get(`shipping_options[${n}][shipping_rate_data][fixed_amount][amount]`)) }); return o; };

// 1. Every buyable part, on its own, to a Melbourne postcode
const buyable = data.products.filter(p => p.available && p.price != null);
for (const p of buyable) {
  lastForm = null;
  const item = { id: p.id, qty: 1, price: 0.01 }; // the price sent by the browser must be ignored
  if (p.options) item.option = p.options[0];
  const { status, j } = await call(checkout.onRequestPost, { items: [item], postcode: "3000" });
  check(status === 200 && /^https:\/\/checkout\.stripe\.com\//.test(j.url || ""), `${p.id}: checkout didn't open (${status} ${JSON.stringify(j)})`);
  if (!lastForm) continue;
  check(lastForm.get("line_items[0][price_data][unit_amount]") === String(Math.round(p.price * 100)), `${p.id}: Stripe price ${lastForm.get("line_items[0][price_data][unit_amount]")} != products.json ${p.price}`);
  check(lastForm.get("line_items[0][price_data][currency]") === data.currency, `${p.id}: wrong currency`);
  check(lastForm.get("shipping_address_collection[allowed_countries][0]") === "AU", `${p.id}: address collection missing`);
  const opts = shipOptions(lastForm);
  check(opts.length >= 1, `${p.id}: no postage option`);
  if (!p.freightQuote) check(opts[0].cents > 0, `${p.id}: postage is $0 but the part isn't freight quoted (${opts[0].name})`);
  if (data.shipping.pickup) check(opts.some(o => /pickup/i.test(o.name) && o.cents === 0), `${p.id}: free pickup option missing`);
}

// 2. A mixed cart: total = sum of products.json prices x qty
const mix = buyable.filter(p => !p.freightQuote).slice(0, 3);
if (mix.length) {
  const items = mix.map((p, i) => ({ id: p.id, qty: i + 1, option: p.options ? p.options[0] : undefined }));
  const { status } = await call(checkout.onRequestPost, { items, postcode: "4655" });
  check(status === 200, "mixed cart: checkout didn't open");
  let cents = 0; for (let i = 0; lastForm.has(`line_items[${i}][quantity]`); i++) cents += Number(lastForm.get(`line_items[${i}][quantity]`)) * Number(lastForm.get(`line_items[${i}][price_data][unit_amount]`));
  check(cents === mix.reduce((t, p, i) => t + Math.round(p.price * 100) * (i + 1), 0), "mixed cart: goods total doesn't match products.json");
}

// 3. Things that must be refused
const sold = data.products.find(p => !p.available);
if (sold) check((await call(checkout.onRequestPost, { items: [{ id: sold.id, qty: 1 }] })).status === 400, "sold-out part was let through");
check((await call(checkout.onRequestPost, { items: [{ id: "no-such-part", qty: 1 }] })).status === 400, "unknown part was let through");
check((await call(checkout.onRequestPost, { items: [] })).status === 400, "empty cart was let through");
const one = buyable.find(p => !p.options && !p.maxQty) || buyable[0];
check((await call(checkout.onRequestPost, { items: [{ id: one.id, qty: 0 }] })).status === 400, "qty 0 was let through");
check((await call(checkout.onRequestPost, { items: [{ id: one.id, qty: 51 }] })).status === 400, "qty 51 was let through");
const opt = buyable.find(p => p.options);
if (opt) check((await call(checkout.onRequestPost, { items: [{ id: opt.id, qty: 1, option: "made up" }] })).status === 400, "bad side/option was let through");

// 4. When Stripe has a problem, the customer gets a readable message (the cart shows it with our phone number)
stripeMode = "error";
let r = await call(checkout.onRequestPost, { items: [{ id: one.id, qty: 1 }], postcode: "3000" });
check(r.status === 502 && typeof r.j.error === "string", `Stripe error: no clear message (${r.status} ${JSON.stringify(r.j)})`);
stripeMode = "down";
r = await call(checkout.onRequestPost, { items: [{ id: one.id, qty: 1 }], postcode: "3000" });
check(r.status >= 500 && typeof r.j.error === "string", `Stripe unreachable: no clear message (${r.status} ${JSON.stringify(r.j)})`);
texts = [];
await call(checkout.onRequestPost, { items: [{ id: one.id, qty: 1 }], postcode: "3000" }, alertEnv);
check(texts.length === 1 && texts[0].phoneNumbers[0] === "+61400000000" && /Stripe/.test(texts[0].textMessage.text), "owner wasn't texted when Stripe was unreachable");
stripeMode = "ok";
check((await call(checkout.onRequestPost, { items: [{ id: one.id, qty: 1 }] }, {})).status === 500, "missing Stripe key not reported");

// 4b. Australia Post down: the cart still gets a (flat) price, and the owner is texted
const boxed = buyable.find(p => p.pack && !p.satchel && !p.freightQuote);
if (boxed) {
  stripeMode = "auspost-down"; texts = [];
  const q = await call(shipping.onRequestPost, { items: [{ id: boxed.id, qty: 1 }], postcode: "3000" }, alertEnv);
  check(q.status === 200 && q.j.cents > 0 && q.j.source === "flat", `Aus Post down: no flat-rate fallback (${JSON.stringify(q.j)})`);
  check(texts.length === 1 && /Australia Post/.test(texts[0].textMessage.text), "owner wasn't texted when Australia Post quoting failed");
  stripeMode = "ok";
}

// 5. The cart's postage quote and the checkout postage are the same number
for (const p of buyable.filter(p => !p.freightQuote)) {
  const item = { id: p.id, qty: 1, option: p.options ? p.options[0] : undefined };
  const q = await call(shipping.onRequestPost, { items: [item], postcode: "3000" });
  await call(checkout.onRequestPost, { items: [item], postcode: "3000" });
  check(q.status === 200 && q.j.cents === shipOptions(lastForm)[0].cents, `${p.id}: cart postage ${q.j.cents} != checkout postage ${shipOptions(lastForm)[0].cents}`);
}


// 6. New Zealand: satchel parts only, NZ addresses only, no pickup, live international price
const nzPart = buyable.find(p => p.satchel && !p.pack && !p.freightQuote && !p.options);
const notNz = buyable.find(p => p.pack || !p.satchel || p.freightQuote);
if (nzPart) {
  intlCalls = [];
  const q = await call(shipping.onRequestPost, { items: [{ id: nzPart.id, qty: 2 }], country: "NZ" });
  check(q.status === 200 && q.j.cents === 2875 && !q.j.unavailable, `NZ: ${nzPart.id} not priced (${JSON.stringify(q.j)})`);
  check(intlCalls.length === 1 && intlCalls[0].get("country_code") === "NZ" && Number(intlCalls[0].get("weight")) > 0, "NZ: wrong Australia Post international request");
  const r = await call(checkout.onRequestPost, { items: [{ id: nzPart.id, qty: 2 }], country: "NZ", postcode: "3000" });
  check(r.status === 200, `NZ: checkout didn't open (${JSON.stringify(r.j)})`);
  check(lastForm.get("shipping_address_collection[allowed_countries][0]") === "NZ" && !lastForm.has("shipping_address_collection[allowed_countries][1]"), "NZ: checkout must accept NZ addresses only");
  const o = shipOptions(lastForm);
  check(o.length === 1 && o[0].cents === 2875 && !o.some(x => /pickup/i.test(x.name)), `NZ: wrong postage options ${JSON.stringify(o)}`);
  check(!lastForm.has("metadata[quoted_postcode]") && lastForm.get("metadata[ship_country]") === "NZ", "NZ: metadata wrong");
  // the normal Australian checkout still only takes Australian addresses
  await call(checkout.onRequestPost, { items: [{ id: nzPart.id, qty: 1 }], postcode: "3000" });
  check(lastForm.get("shipping_address_collection[allowed_countries][0]") === "AU", "AU checkout lost its AU-only address rule");
  stripeMode = "intl-code-gone";
  const g = await call(shipping.onRequestPost, { items: [{ id: nzPart.id, qty: 1 }], country: "NZ" });
  check(g.j.cents === 2875 && !g.j.unavailable, `NZ: service-list fallback didn't price it (${JSON.stringify(g.j)})`);
  stripeMode = "auspost-down"; texts = [];
  const d = await call(shipping.onRequestPost, { items: [{ id: nzPart.id, qty: 1 }], country: "NZ" }, alertEnv);
  check(d.j.unavailable && texts.length === 1, "NZ: Australia Post down should block NZ checkout and text the owner");
  check((await call(checkout.onRequestPost, { items: [{ id: nzPart.id, qty: 1 }], country: "NZ" })).status === 400, "NZ: checkout opened without a real postage price");
  stripeMode = "ok";
}
if (notNz) {
  const q = await call(shipping.onRequestPost, { items: [{ id: notNz.id, qty: 1, option: notNz.options ? notNz.options[0] : undefined }], country: "NZ" });
  check(q.j.unavailable && /Australia only/.test(q.j.label), `NZ: ${notNz.id} should be Australia-only (${JSON.stringify(q.j)})`);
  const r = await call(checkout.onRequestPost, { items: [{ id: notNz.id, qty: 1, option: notNz.options ? notNz.options[0] : undefined }], country: "NZ" });
  check(r.status === 400 && /Australia only/.test(r.j.error), `NZ: checkout let ${notNz.id} through`);
}

console.log(`Checkout test: ${passes} checks passed, ${fails} failed (${buyable.length} buyable parts)`);
process.exit(fails ? 1 : 0);
