// Builds the crawlable pages from products.json:
//   /parts/<slug>/index.html   one page per part
//   /<category>/index.html     one page per category
//   /404.html                  real "not found" page (also stops Cloudflare's send-everything-to-home fallback)
// Run:   node build.mjs          write the files
//        node build.mjs --check  fail if the committed files are out of date (used by the GitHub check)
// The generated files are committed, so Cloudflare Pages still needs no build step.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(readFileSync(join(ROOT, "products.json"), "utf8"));

// Brand and site settings live in one place, so a rename or domain change is one edit.
const SITE = {
  name: "VMS Truck Parts",
  url: "https://vmstruckparts.com.au",
  region: "Victoria, Australia",
  ...(data.site || {}),
};
const C = data.contact, SHIP = data.shipping;

const CATS = {
  Filters: { path: "filters", title: "Actros MP4 / MP5 Filters", intro: "Oil, fuel, air, cabin, AdBlue and power steering filters for the MP4 and MP5 Mercedes-Benz Actros with the OM471 and OM473 engines. Every filter lists its OE number and MAHLE, MANN and Hengst equivalents, so you can match the number on your old filter before you buy." },
  Cooling: { path: "cooling", title: "Actros MP4 / MP5 Cooling Parts", intro: "Viscous fan clutches and coolant expansion tanks for the MP4 and MP5 Mercedes-Benz Actros, with OE and cross-reference numbers." },
  Clutch: { path: "clutch", title: "Actros MP4 / MP5 Clutch Parts", intro: "Clutch kits and clutch actuators for the MP4 and MP5 Mercedes-Benz Actros. Send us your VIN and we'll confirm the right part for your gearbox before you pay." },
  Engine: { path: "engine", title: "Actros MP4 / MP5 Engine Parts", intro: "Starter motors, cylinder heads, liner kits, oil separators and sensors for the OM471 and OM473 engines in the MP4 and MP5 Mercedes-Benz Actros." },
  Brakes: { path: "brakes", title: "Actros MP4 / MP5 Brake and Air Parts", intro: "Brake hoses and air-line fittings for the MP4 and MP5 Mercedes-Benz Actros, listed by OE number." },
  Cab: { path: "cab", title: "Actros MP4 / MP5 Cab Parts", intro: "Mirror covers and other cab parts for the MP4 and MP5 Mercedes-Benz Actros." },
  Workshop: { path: "workshop-equipment", title: "Workshop Equipment", intro: "Workshop equipment for truck servicing, such as air-operated oil drum pumps. These suit any workshop, not just the Actros." },
  Tools: { path: "workshop-tools", title: "Actros MP4 / MP5 Workshop Tools", intro: "Workshop tools for servicing the OM471 and OM473 engines in the MP4 and MP5 Mercedes-Benz Actros." },
};

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = n => "$" + n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const shortMoney = n => "$" + (Number.isInteger(n) ? n.toLocaleString("en-AU") : n.toFixed(2));
const partUrl = p => `/parts/${p.slug}/`;
const catUrl = cat => `/${CATS[cat].path}/`;
const truckPart = p => p.fits.models.length > 0;
const fitsText = p => !truckPart(p) ? "Any workshop (not vehicle-specific)" : "MP4 / MP5 Mercedes-Benz Actros" + (p.fits.engines.length ? `, ${p.fits.engines.join(" / ")} engine` : "");
const products = data.products;

for (const p of products) if (!CATS[p.cat]) throw new Error(`No category page set up for "${p.cat}" (part ${p.id}). Add it to CATS in build.mjs.`);

function layout({ title, desc, path, body, part = "" }) {
  return `<!doctype html>
<html lang="en-AU">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
${path ? `<link rel="canonical" href="${SITE.url}${path}">\n` : `<meta name="robots" content="noindex">\n`}<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@500&display=swap">
<link rel="stylesheet" href="/styles.css">
</head>
<body${part ? ` data-part="${esc(part)}"` : ""}>

<header class="top">
  <div class="wrap">
    <a class="logo" href="/"><b>VMS<span>.</span></b><small>Truck Parts</small></a>
    <div class="contact">Call or text <b><a href="tel:${C.phone.replace(/\s/g, "")}">${esc(C.phone)}</a></b></div>
    <button class="cartbtn" id="openCart" type="button" aria-label="Open cart">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 4h2l2.4 11h10.8L21 7H6.2"/><circle cx="9" cy="19.5" r="1.5"/><circle cx="17" cy="19.5" r="1.5"/></svg>
      <span class="n" id="cartCount">0</span>
    </button>
  </div>
</header>

<main class="wrap page">
${body}
</main>

<footer><div class="wrap">
  <div><b>${esc(SITE.name)}</b><span>${esc(SITE.region)}</span><span>${esc(C.phone)}</span><span>${esc(C.email)}</span></div>
  <div><b>Shop</b>${Object.entries(CATS).filter(([k]) => products.some(p => p.cat === k)).map(([k, v]) => `<a href="/${v.path}/">${esc(k)}</a>`).join("")}</div>
  <div><b>Help</b><a href="/#faq">FAQ</a><a href="/policies.html#shipping">Shipping</a><a href="/policies.html#returns">Returns and refunds</a><a href="/policies.html#privacy">Privacy</a><a href="/policies.html#terms">Terms</a></div>
</div></footer>

<div class="overlay right" id="drawer" hidden>
  <div class="panel" role="dialog" aria-modal="true" aria-labelledby="cartTitle">
    <div class="ph"><h2 id="cartTitle">Your cart</h2><button class="x" type="button" data-close="drawer">Close</button></div>
    <div class="lines" id="lines"></div>
    <div class="tot">
      <div><span>Subtotal</span><span id="sub">$0.00</span></div>
      <div><span>Shipping</span><span id="ship">—</span></div>
      <div class="big"><span>Total</span><span id="total">$0.00</span></div>
    </div>
    <button class="primary" id="checkout" type="button">Checkout</button>
    <p class="note" id="checkoutNote">No account needed. Choose delivery or free pickup at checkout.</p>
  </div>
</div>

<script src="/app.js"></script>
</body>
</html>
`;
}

const crumbs = items => `<nav class="crumbs" aria-label="Breadcrumb"><ol>${items.map(([t, u], i) =>
  i === items.length - 1 ? `<li aria-current="page">${esc(t)}</li>` : `<li><a href="${u}">${esc(t)}</a></li>`).join("")}</ol></nav>`;

const pic = (p, cls = "") => p.image
  ? `<img src="${esc(p.image)}" alt="${esc(p.name)}${truckPart(p) ? " to suit Mercedes-Benz Actros MP4 / MP5" : ""}"${cls === "big" ? "" : ' loading="lazy"'}>`
  : `<span class="noimg">${esc(p.cat)}</span>`;

const priceHtml = p => p.price != null ? `<div class="price">${money(p.price)}</div>` : `<div class="price ask">Call for price</div>`;
const stockHtml = p => `<div class="stock ${p.available ? "" : "out"}">${p.available ? "In stock" : "Sold out, ask us"}</div>`;

const card = p => `<a class="card" href="${partUrl(p)}">
    <div class="pic">${pic(p)}</div>
    <div class="body"><h3>${esc(p.name)}</h3><span class="pn">${p.oem.length ? "OE " + esc(p.oem[0]) : "Part no. " + esc(p.sku)}</span>
    <div class="foot"><div>${priceHtml(p)}${stockHtml(p)}</div><span class="view">View</span></div></div></a>`;

const sortParts = list => [...list].sort((a, b) => (b.available - a.available) || a.name.localeCompare(b.name));

function partPage(p) {
  const oe = p.oem[0] ? ` ${p.oem[0]}` : "";
  const eng = p.fits.engines.length ? ` ${p.fits.engines.join("/")}` : "";
  const title = `${p.name}${oe}${truckPart(p) ? " – suits Actros MP4/MP5" + eng : ""}${p.price != null ? " | " + shortMoney(p.price) : ""} | ${SITE.name}`;
  const desc = `${p.name}${truckPart(p) ? " to suit the Mercedes-Benz Actros MP4 / MP5" + eng : ""}.${p.oem.length ? " Replaces OE " + p.oem.join(", ") + "." : ""} ${p.price != null ? shortMoney(p.price) + ", " : ""}${p.available ? "in stock" : "ask us for stock"}, shipped Australia-wide from ${SITE.region.split(",")[0]}.`;
  const canBuy = p.available && p.price != null;
  const shipNote = p.freightQuote
    ? "Freight isn't included on this part. We'll quote it after you order and call you before sending, or pick up free in Victoria."
    : `${money(SHIP.flatRate)} Australia-wide, free over ${shortMoney(SHIP.freeOver)}, or free pickup in Victoria.`;
  const related = sortParts(products.filter(x => x.cat === p.cat && x.id !== p.id)).slice(0, 4);
  const spec = [
    ["Fits", esc(fitsText(p))],
    p.oem.length && ["Replaces OE", `<span class="mono">${p.oem.map(esc).join("<br>")}</span>`],
    p.cross.length && ["Cross-reference", `<span class="mono">${p.cross.map(esc).join("<br>")}</span>`],
    ["Brand", esc(p.brand)],
    ["Our part no.", `<span class="mono">${esc(p.sku)}</span>`],
    ["Condition", "New"],
  ].filter(Boolean).map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("");
  const body = `${crumbs([["Home", "/"], [p.cat, catUrl(p.cat)], [p.name, ""]])}
<article class="pdp">
  <div class="pic big">${pic(p, "big")}</div>
  <div class="info">
    <h1>${esc(p.name)}${truckPart(p) ? " <small>to suit Mercedes-Benz Actros MP4 / MP5</small>" : ""}</h1>
    <span class="pn">${p.oem.length ? "OE " + esc(p.oem[0]) + " · " : ""}Part no. ${esc(p.sku)}</span>
    ${priceHtml(p).replace("price", "price big")}
    ${stockHtml(p)}
    <p class="desc">${esc(p.desc)}</p>
${p.options ? `    <label>Side <select id="pOpt">${p.options.map(o => `<option>${esc(o)}</option>`).join("")}</select></label>\n` : ""}    ${canBuy
      ? `<button class="primary" type="button" id="pAdd">Add to cart</button>`
      : `<p class="note">${p.available ? "Call for a price" : "This part is sold out online"}. Call or text <b><a href="tel:${C.phone.replace(/\s/g, "")}">${esc(C.phone)}</a></b> or email <b>${esc(C.email)}</b> for a price and lead time.</p>`}
    ${truckPart(p) ? `<p class="note">Not sure it fits? Text your VIN to <a href="sms:${C.phone.replace(/\s/g, "")}">${esc(C.phone)}</a> and we'll check before you pay.</p>` : ""}
    <dl>${spec}</dl>
    <details><summary>Shipping and returns</summary><p>${shipNote} Unused parts can be returned within 30 days. <a href="/policies.html#shipping">Shipping</a> · <a href="/policies.html#returns">Returns</a></p></details>
  </div>
</article>
${related.length ? `<section class="block"><h2 class="sec">More ${esc(p.cat.toLowerCase())}</h2><div class="grid">${related.map(card).join("")}</div></section>` : ""}`;
  return layout({ title, desc, path: partUrl(p), body, part: p.id });
}

function catPage(cat) {
  const c = CATS[cat];
  const list = sortParts(products.filter(p => p.cat === cat));
  const body = `${crumbs([["Home", "/"], [cat, ""]])}
<section class="block catintro">
  <h1>${esc(c.title)}</h1>
  <p>${esc(c.intro)}</p>
  <p class="note">${list.length} part${list.length === 1 ? "" : "s"} · Shipping ${money(SHIP.flatRate)}, free over ${shortMoney(SHIP.freeOver)} · Free pickup in Victoria</p>
</section>
<section class="block"><div class="grid">${list.map(card).join("")}</div></section>`;
  return layout({ title: `${c.title} | ${SITE.name}`, desc: c.intro.slice(0, 155), path: catUrl(cat), body });
}

function notFound() {
  const body = `<section class="block catintro">
  <h1>Page not found</h1>
  <p>That page isn't here. It may have moved when we updated the shop. Every part is listed below, or call or text <a href="tel:${C.phone.replace(/\s/g, "")}">${esc(C.phone)}</a> and we'll find it for you.</p>
</section>
<section class="block"><div class="grid">${sortParts(products).map(card).join("")}</div></section>`;
  return layout({ title: `Page not found | ${SITE.name}`, desc: "Page not found.", path: "", body });
}

// ---- write or check ----
const out = new Map();
for (const p of products) out.set(join("parts", p.slug, "index.html"), partPage(p));
for (const cat of Object.keys(CATS)) if (products.some(p => p.cat === cat)) out.set(join(CATS[cat].path, "index.html"), catPage(cat));
out.set("404.html", notFound());

const check = process.argv.includes("--check");
const stale = [];
for (const [rel, html] of out) {
  const file = join(ROOT, rel);
  const now = existsSync(file) ? readFileSync(file, "utf8") : null;
  if (now === html) continue;
  if (check) { stale.push(rel); continue; }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, html);
}
// Part pages for parts that were removed or renamed
const partsDir = join(ROOT, "parts");
if (existsSync(partsDir)) for (const slug of readdirSync(partsDir)) {
  if (!products.some(p => p.slug === slug)) { if (check) stale.push(`parts/${slug} (no longer in products.json)`); else rmSync(join(partsDir, slug), { recursive: true }); }
}
if (check) {
  if (stale.length) { console.error("Generated pages are out of date. Run `node build.mjs` and commit:\n  " + stale.join("\n  ")); process.exit(1); }
  console.log(`Generated pages up to date (${out.size} files).`);
} else console.log(`Wrote ${out.size} pages: ${products.length} parts, ${out.size - products.length - 1} categories, 404.`);
