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

let stripeMode = "ok", lastForm = null;
globalThis.fetch = async (url, opts = {}) => {
  url = String(url);
  const res = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  if (url.endsWith("/products.json")) return res(data);
  if (url.startsWith("https://digitalapi.auspost.com.au/")) return res({ postage_result: { total_cost: "31.50" } });
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
const call = async (fn, body, e = env) => {
  const request = new Request("https://vmstruckparts.com.au/api/x", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const r = await fn({ request, env: e, waitUntil: () => {} });
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
stripeMode = "ok";
check((await call(checkout.onRequestPost, { items: [{ id: one.id, qty: 1 }] }, {})).status === 500, "missing Stripe key not reported");

// 5. The cart's postage quote and the checkout postage are the same number
for (const p of buyable.filter(p => !p.freightQuote)) {
  const item = { id: p.id, qty: 1, option: p.options ? p.options[0] : undefined };
  const q = await call(shipping.onRequestPost, { items: [item], postcode: "3000" });
  await call(checkout.onRequestPost, { items: [item], postcode: "3000" });
  check(q.status === 200 && q.j.cents === shipOptions(lastForm)[0].cents, `${p.id}: cart postage ${q.j.cents} != checkout postage ${shipOptions(lastForm)[0].cents}`);
}

console.log(`Checkout test: ${passes} checks passed, ${fails} failed (${buyable.length} buyable parts)`);
process.exit(fails ? 1 : 0);
