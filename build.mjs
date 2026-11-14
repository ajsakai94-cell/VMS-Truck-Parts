// Builds the crawlable pages from products.json:
//   /parts/<slug>/index.html   one page per part
//   /<category>/index.html     one page per category
//   /404.html                  real "not found" page (also stops Cloudflare's send-everything-to-home fallback)
//   /guides/<slug>/index.html  guide pages (content in GUIDES below)
//   /index.html                only the <!--build:...--> regions are filled in (cards, categories, guides, head tags)
//   /sitemap.xml, /feed.xml    sitemap for Search Console, product feed for Merchant Center
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
// shipping for one unit of a part on its own: free over the threshold, else its heavy rate or the flat rate
const shipRate = p => p.price >= SHIP.freeOver ? 0 : (p.shipClass ? SHIP.heavyRates[p.shipClass] : SHIP.flatRate);

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

const abs = u => u && (u.startsWith("http") ? u : SITE.url + u);
const ld = obj => `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, "\\u003c")}</script>\n`;
const DEFAULT_IMG = "/images/og-default.png";
const ORG = { "@type": "Organization", "@id": SITE.url + "/#org", name: SITE.name, url: SITE.url + "/", telephone: "+61" + C.phone.replace(/\s/g, "").replace(/^0/, ""), email: C.email };

function layout({ title, desc, path, body, part = "", image = "", type = "website", jsonld = [] }) {
  const og = path ? `<meta property="og:type" content="${type}">
<meta property="og:site_name" content="${esc(SITE.name)}">
<meta property="og:locale" content="en_AU">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${SITE.url}${path}">
<meta property="og:image" content="${esc(abs(image || DEFAULT_IMG))}">
<meta name="twitter:card" content="summary_large_image">
` : "";
  return `<!doctype html>
<html lang="en-AU">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
${path ? `<link rel="canonical" href="${SITE.url}${path}">\n` : `<meta name="robots" content="noindex">\n`}${og}${jsonld.map(ld).join("")}<link rel="preconnect" href="https://fonts.googleapis.com">
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
  <div><b>Guides</b>${GUIDES.map(g => `<a href="${g.path}">${esc(g.short)}</a>`).join("")}</div>
  <div><b>Help</b><a href="/#faq">FAQ</a><a href="/policies.html#shipping">Shipping</a><a href="/policies.html#returns">Returns and refunds</a><a href="/policies.html#privacy">Privacy</a><a href="/policies.html#terms">Terms</a></div>
  <p class="legal">VMS Truck Parts is an independent parts supplier, not affiliated with Mercedes-Benz or Daimler Truck. Mercedes-Benz and Actros are their owners' trademarks, used only to show which trucks our parts suit. OE numbers are for reference.</p>
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

const crumbLd = items => ({ "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: items.map(([t, u], i) => ({ "@type": "ListItem", position: i + 1, name: t, ...(u ? { item: SITE.url + u } : {}) })) });

const pic = (p, cls = "") => p.image
  ? `<img src="${esc(cls === "big" ? p.image : (p.thumb || p.image))}" alt="${esc(p.name)}${truckPart(p) ? " to suit Mercedes-Benz Actros MP4 / MP5" : ""}" width="${cls === "big" ? 1000 : 400}" height="${cls === "big" ? 1000 : 400}"${cls === "big" ? "" : ' loading="lazy"'}>`
  : `<span class="noimg">${esc(p.cat)}</span>`;
const picBig = p => pic(p, "big") + (p.image && p.illustration ? `<p class="illus">Illustration – actual part may vary</p>` : "");

const priceHtml = p => p.price != null ? `<div class="price">${money(p.price)}</div>` : `<div class="price ask">Call for price</div>`;
const stockHtml = p => `<div class="stock ${p.available ? "" : "out"}">${p.available ? "In stock" : "Sold out, ask us"}</div>`;

const card = p => `<a class="card" href="${partUrl(p)}">
    <div class="pic">${pic(p)}</div>
    <div class="body"><h3>${esc(p.name)}</h3><span class="pn">${p.oem.length ? "OE " + esc(p.oem[0]) : "Part no. " + esc(p.sku)}</span>
    <div class="foot"><div>${priceHtml(p)}${stockHtml(p)}</div><span class="view">View</span></div></div></a>`;

const sortParts = list => [...list].sort((a, b) => (b.available - a.available) || a.name.localeCompare(b.name));

function partPage(p) {
  const oe = p.oem[0] ? ` ${p.oem[0]}` : "";
  const eng = p.fits.engines.length && !/OM47\d/.test(p.name) ? ` ${p.fits.engines.join("/")}` : "";
  // Google title: plain part name, then fitment, then OE number, then price
  const title = `${p.name}${truckPart(p) ? " for Mercedes Actros MP4/MP5" + eng : ""}${p.oem[0] ? " – OE " + p.oem[0] : ""}${p.price != null ? " | " + shortMoney(p.price) + (p.available ? " In Stock" : "") : ""} | ${SITE.name}`;
  const desc = `${p.available && p.price != null ? "In stock, " + shortMoney(p.price) + ". " : p.available ? "In stock. " : ""}${p.name}${truckPart(p) ? " for the Mercedes-Benz Actros MP4 / MP5" + (eng ? " (" + eng.trim() + ")" : "") : ""}.${p.oem.length ? " Replaces OE " + p.oem.slice(0, 3).join(", ") + "." : ""} ${p.freightQuote ? "Freight quoted, or free pickup in Victoria." : `Free shipping over ${shortMoney(SHIP.freeOver)}, dispatched from ${SITE.region.split(",")[0]}.`}${truckPart(p) ? " Text your VIN and we'll check it fits." : ""}`;
  const canBuy = p.available && p.price != null;
  const shipNote = p.freightQuote
    ? "Freight isn't included on this part. We'll quote it after you order and call you before sending, or pick up free in Victoria."
    : p.shipClass
      ? `Heavy item: ${money(SHIP.heavyRates[p.shipClass])} Australia-wide, free on orders over ${shortMoney(SHIP.freeOver)}, or free pickup in Victoria.`
      : `${money(SHIP.flatRate)} Australia-wide, free over ${shortMoney(SHIP.freeOver)}, or free pickup in Victoria.`;
  const related = sortParts(products.filter(x => x.cat === p.cat && x.id !== p.id)).slice(0, 4);
  const spec = [
    ["Fits", esc(fitsText(p))],
    p.oem.length && ["Replaces OE", `<span class="mono">${p.oem.map(esc).join("<br>")}</span>`],
    p.cross.length && ["Cross-reference", `<span class="mono">${p.cross.map(esc).join("<br>")}</span>`],
    ["Brand", esc(p.brand)],
    ["Our part no.", `<span class="mono">${esc(p.sku)}</span>`],
    ["Condition", "New"],
    p.tags?.length && ["Also called", esc(p.tags.join(", "))],
  ].filter(Boolean).map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("");
  const body = `${crumbs([["Home", "/"], [p.cat, catUrl(p.cat)], [p.name, ""]])}
<article class="pdp">
  <div class="pic big">${picBig(p)}</div>
  <div class="info">
    <h1>${esc(p.name)}${truckPart(p) ? " <small>to suit Mercedes-Benz Actros MP4 / MP5</small>" : ""}</h1>
    <span class="pn">${p.oem.length ? "OE " + esc(p.oem[0]) + " · " : ""}Part no. ${esc(p.sku)}</span>
    ${priceHtml(p).replace("price", "price big")}
    ${stockHtml(p)}
    <p class="desc">${esc(p.desc)}</p>
${p.bundle ? `    <p><b>In this kit:</b></p><ul class="kit">${p.bundle.map(id => products.find(x => x.id === id)).map(x => `<li><a href="${partUrl(x)}">${esc(x.name)}</a>${x.oem[0] ? ` <span class="mono">${esc(x.oem[0])}</span>` : ""}</li>`).join("")}</ul>\n` : ""}${p.options ? `    <label>Side <select id="pOpt">${p.options.map(o => `<option>${esc(o)}</option>`).join("")}</select></label>\n` : ""}    ${canBuy
      ? `<button class="primary" type="button" id="pAdd">Add to cart</button>`
      : `<p class="note">${p.available ? "Call for a price" : "This part is sold out online"}. Call or text <b><a href="tel:${C.phone.replace(/\s/g, "")}">${esc(C.phone)}</a></b> or email <b>${esc(C.email)}</b> for a price and lead time.</p>`}
    ${truckPart(p) ? `<p class="note">Not sure it fits? Text your VIN to <a href="sms:${C.phone.replace(/\s/g, "")}">${esc(C.phone)}</a> and we'll check before you pay.</p>` : ""}
    <dl>${spec}</dl>
    <details><summary>Shipping and returns</summary><p>${shipNote} Unused parts can be returned within 30 days. <a href="/policies.html#shipping">Shipping</a> · <a href="/policies.html#returns">Returns</a></p></details>
  </div>
</article>
${related.length ? `<section class="block"><h2 class="sec">More ${esc(p.cat.toLowerCase())}</h2><div class="grid">${related.map(card).join("")}</div></section>` : ""}`;
  const crumbItems = [["Home", "/"], [p.cat, catUrl(p.cat)], [p.name, partUrl(p)]];
  const product = {
    "@context": "https://schema.org", "@type": "Product",
    name: p.name + (truckPart(p) ? " to suit Mercedes-Benz Actros MP4 / MP5" : ""),
    description: p.desc, sku: p.sku, mpn: p.mpn,
    brand: { "@type": "Brand", name: p.brand },
    category: p.cat,
    ...(p.image ? { image: [abs(p.image)] } : {}),
    url: SITE.url + partUrl(p),
    ...(p.price != null ? { offers: {
      "@type": "Offer", url: SITE.url + partUrl(p), priceCurrency: "AUD", price: p.price.toFixed(2),
      availability: "https://schema.org/" + (p.available ? "InStock" : "OutOfStock"),
      itemCondition: "https://schema.org/NewCondition",
      seller: { "@id": ORG["@id"] },
      ...(p.freightQuote ? {} : { shippingDetails: {
        "@type": "OfferShippingDetails",
        shippingRate: { "@type": "MonetaryAmount", value: shipRate(p), currency: "AUD" },
        shippingDestination: { "@type": "DefinedRegion", addressCountry: "AU" },
        deliveryTime: { "@type": "ShippingDeliveryTime",
          handlingTime: { "@type": "QuantitativeValue", minValue: 1, maxValue: 2, unitCode: "DAY" },
          transitTime: { "@type": "QuantitativeValue", minValue: 1, maxValue: 7, unitCode: "DAY" } },
      } }),
      hasMerchantReturnPolicy: { "@type": "MerchantReturnPolicy", applicableCountry: "AU",
        returnPolicyCategory: "https://schema.org/MerchantReturnFiniteReturnWindow", merchantReturnDays: 30,
        returnMethod: "https://schema.org/ReturnByMail", returnFees: "https://schema.org/ReturnShippingFees" },
    } } : {}),
  };
  return layout({ title, desc, path: partUrl(p), body, part: p.id, image: p.image, type: "product", jsonld: [product, crumbLd(crumbItems)] });
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
  return layout({ title: `${c.title} | ${SITE.name}`, desc: c.intro.slice(0, 155), path: catUrl(cat), body, image: list.find(p => p.image)?.image, jsonld: [crumbLd([["Home", "/"], [cat, catUrl(cat)]])] });
}

function notFound() {
  const body = `<section class="block catintro">
  <h1>Page not found</h1>
  <p>That page isn't here. It may have moved when we updated the shop. Every part is listed below, or call or text <a href="tel:${C.phone.replace(/\s/g, "")}">${esc(C.phone)}</a> and we'll find it for you.</p>
</section>
<section class="block"><div class="grid">${sortParts(products).map(card).join("")}</div></section>`;
  return layout({ title: `Page not found | ${SITE.name}`, desc: "Page not found.", path: "", body });
}

// ---- guides ----
const byId = id => products.find(p => p.id === id);
const link = p => `<a href="${partUrl(p)}">${esc(p.name)}</a>`;
const mono = list => list.length ? `<span class="mono">${list.map(esc).join("<br>")}</span>` : "–";
const SERVICE = [
  ["oil-filter", "Every oil service, with the engine oil."],
  ["fuel-filter", "Commonly changed with the oil. Follow the maintenance display."],
  ["diesel-water-separator", "Commonly changed with the oil. Drain water from the bowl whenever the warning shows."],
  ["air-filter", "When the restriction indicator shows. Check it more often on dusty roads."],
  ["cabin-filter", "Yearly, or sooner if airflow from the vents drops."],
  ["adblue-filter", "As the maintenance system shows, or if you get an AdBlue / emissions warning."],
  ["power-steering-filter", "Whenever the power steering fluid is changed."],
];
const GUIDES = [
  { path: "/guides/actros-mp4-service-intervals/", short: "MP4 service intervals",
    title: "Actros MP4 Service Intervals and Filter Checklist",
    desc: "How service intervals work on the MP4 / MP5 Mercedes-Benz Actros with the OM471 and OM473, which filters are changed at a service, and their OE numbers.",
    blurb: "How the MP4 works out when it's due, and which filters to change.",
    body: () => `<p>The MP4 Actros doesn't run on one fixed service interval. Its maintenance system works out when each service is due from how the truck is used: the load, the kilometres, idle time, the fuel and the oil specification. It shows the result on the instrument cluster. Two MP4s doing different work can be due at very different kilometres, so always go by your truck's maintenance display and service records rather than a number from the internet.</p>
<p>What doesn't change much is <b>what</b> gets replaced. Here's the filter checklist for an OM471 or OM473 service, with the OE numbers so you can match the parts.</p>
<h2>Filter checklist</h2>
<div class="tablewrap"><table><thead><tr><th>Part</th><th>When</th><th>OE number</th><th>Price</th></tr></thead><tbody>
${SERVICE.map(([id, when]) => byId(id)).map((p, i) => `<tr><td>${link(p)}</td><td>${esc(SERVICE[i][1])}</td><td>${mono(p.oem.slice(0, 2))}</td><td>${p.price != null ? money(p.price) : "Call"}</td></tr>`).join("")}
</tbody></table></div>
${byId("service-kit") ? `<p>Doing a full service? The <a href="${partUrl(byId("service-kit"))}">service filter kit</a> has the oil, fuel, water separator, air and cabin filters in one box for ${money(byId("service-kit").price)}, with free shipping.</p>` : ""}
<h2>Tips for Australian conditions</h2>
<ul>
<li>Dust is the big one. On gravel or in dry country, check the air filter restriction indicator every few days rather than waiting for the service.</li>
<li>Water in the fuel shows up fast on the MP4's water separator. If the warning comes on, drain the bowl, and change the pre-filter if it keeps happening.</li>
<li>An AdBlue warning with power loss is often a blocked AdBlue pump filter, which is a cheap part to try first.</li>
<li>Keep the old filter until the new one is fitted, so you can compare the number printed on it.</li>
</ul>
<h2>Not sure which part suits your truck?</h2>
<p>Text your VIN to <a href="sms:${C.phone.replace(/\s/g, "")}">${esc(C.phone)}</a> and we'll confirm the right parts for your build before you pay.</p>` },
  { path: "/guides/om471-om473-filter-part-numbers/", short: "OM471 / OM473 filter numbers",
    title: "OM471 / OM473 Filter Part Numbers for the Actros MP4 / MP5",
    desc: "Mercedes-Benz OE numbers and MAHLE, MANN and Hengst cross-references for every OM471 / OM473 filter on the MP4 / MP5 Actros.",
    blurb: "OE numbers and MAHLE, MANN and Hengst equivalents in one table.",
    body: () => `<p>These are the filters for the MP4 and MP5 Mercedes-Benz Actros with the OM471 and OM473 engines. The OE number is printed on the old filter or its box, and looks like <span class="mono">A 472 184 04 25</span>. When you search this site you can type it with or without the spaces and the leading A.</p>
<p>Where one part has several OE numbers, they're superseded or alternative numbers for the same filter. Cross-references are the equivalent MAHLE, MANN, Hengst and other aftermarket numbers.</p>
<h2>Filter part numbers</h2>
<div class="tablewrap"><table><thead><tr><th>Filter</th><th>OE numbers</th><th>Cross-reference</th><th>Price</th></tr></thead><tbody>
${sortParts(products.filter(p => p.cat === "Filters" && !p.bundle)).map(p => `<tr><td>${link(p)}</td><td>${mono(p.oem)}</td><td>${mono(p.cross)}</td><td>${p.price != null ? money(p.price) : "Call"}</td></tr>`).join("")}
</tbody></table></div>
<p>Can't find your number? Call or text <a href="tel:${C.phone.replace(/\s/g, "")}">${esc(C.phone)}</a> with the number off your old filter and we'll match it.</p>` },
];
function guidePage(g) {
  const body = `${crumbs([["Home", "/"], [g.short, ""]])}
<article class="block article">
  <h1>${esc(g.title)}</h1>
${g.body()}
</article>`;
  return layout({ title: `${g.title} | ${SITE.name}`, desc: g.desc, path: g.path, body,
    jsonld: [{ "@context": "https://schema.org", "@type": "Article", headline: g.title, description: g.desc, url: SITE.url + g.path, publisher: { "@id": ORG["@id"] } }, crumbLd([["Home", "/"], [g.short, g.path]])] });
}

// ---- home page: fill the marked regions of index.html so the page works without JavaScript ----
const ICONS = Function(readFileSync(join(ROOT, "app.js"), "utf8").match(/const ICONS=(\{[\s\S]*?\n\});/)[1].replace(/^/, "return "))();
function homePage() {
  let html = readFileSync(join(ROOT, "index.html"), "utf8");
  const fill = (name, content) => {
    const re = new RegExp(`<!--build:${name}-->[\\s\\S]*?<!--/build:${name}-->`);
    if (!re.test(html)) throw new Error(`index.html is missing <!--build:${name}--> markers`);
    html = html.replace(re, () => `<!--build:${name}-->${content}<!--/build:${name}-->`);
  };
  const cats = Object.keys(CATS).filter(c => products.some(p => p.cat === c));
  fill("head", `
<link rel="canonical" href="${SITE.url}/">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(SITE.name)}">
<meta property="og:locale" content="en_AU">
<meta property="og:title" content="Actros MP4 Parts Specialists | ${esc(SITE.name)}">
<meta property="og:description" content="Parts for the MP4 and MP5 Mercedes-Benz Actros, listed by OE number and shipped Australia-wide.">
<meta property="og:url" content="${SITE.url}/">
<meta property="og:image" content="${SITE.url}${DEFAULT_IMG}">
<meta name="twitter:card" content="summary_large_image">
${ld({ "@context": "https://schema.org", "@graph": [ORG, { "@type": "WebSite", name: SITE.name, url: SITE.url + "/", publisher: { "@id": ORG["@id"] } }] })}`);
  fill("cats", cats.map(c => `<a class="cat" href="${catUrl(c)}">${ICONS[c] || ""}${esc(c)}<small>${products.filter(p => p.cat === c).length}</small></a>`).join(""));
  fill("grid", sortParts(products).map(card).join(""));
  fill("guides", GUIDES.map(g => `<a class="guide" href="${g.path}"><b>${esc(g.short)}</b><span>${esc(g.blurb)}</span></a>`).join(""));
  return html;
}

// ---- write or check ----
const out = new Map();
for (const p of products) out.set(join("parts", p.slug, "index.html"), partPage(p));
for (const cat of Object.keys(CATS)) if (products.some(p => p.cat === cat)) out.set(join(CATS[cat].path, "index.html"), catPage(cat));
out.set("404.html", notFound());
for (const g of GUIDES) out.set(join(g.path.slice(1), "index.html"), guidePage(g));
out.set("index.html", homePage());

// sitemap.xml: home, categories, parts, policies (no lastmod, so --check stays stable)
const urls = ["/", ...Object.keys(CATS).filter(cat => products.some(p => p.cat === cat)).map(catUrl), ...products.map(partUrl), ...GUIDES.map(g => g.path), "/policies.html"];
out.set("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url><loc>${SITE.url}${u}</loc></url>`).join("\n")}
</urlset>
`);

// feed.xml: Google Merchant Center product feed (free Shopping listings).
// Left out: parts with no price, no real photo, an illustration instead of a photo, or freight quoted separately.
const GCAT = { Workshop: "Hardware > Tools", Tools: "Hardware > Tools" };
const feedItems = products.filter(p => p.price != null && p.image && !p.illustration && !p.freightQuote);
const x = s => esc(s);
out.set("feed.xml", `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
<channel>
<title>${x(SITE.name)}</title>
<link>${SITE.url}/</link>
<description>Parts for the MP4 and MP5 Mercedes-Benz Actros</description>
${feedItems.map(p => `<item>
  <g:id>${x(p.id)}</g:id>
  <g:title>${x((p.name + (truckPart(p) ? " for Mercedes-Benz Actros MP4 / MP5" + (p.fits.engines.length && !/OM47\d/.test(p.name) ? " " + p.fits.engines.join("/") : "") : "") + (p.oem[0] ? " – OE " + p.oem[0] : "")).slice(0, 150))}</g:title>
  <g:description>${x(p.desc + (p.oem.length ? " Replaces OE " + p.oem.join(", ") + "." : "") + (p.cross.length ? " Cross-reference: " + p.cross.join(", ") + "." : ""))}</g:description>
  <g:link>${SITE.url}${partUrl(p)}</g:link>
  <g:image_link>${x(abs(p.image))}</g:image_link>
  <g:availability>${p.available ? "in_stock" : "out_of_stock"}</g:availability>
  <g:price>${p.price.toFixed(2)} AUD</g:price>
  <g:brand>${x(p.brand)}</g:brand>
  <g:mpn>${x(p.mpn)}</g:mpn>
  <g:identifier_exists>${p.identifierExists === false ? "no" : "yes"}</g:identifier_exists>
  <g:condition>${x(p.condition || "new")}</g:condition>
  <g:google_product_category>${x(GCAT[p.cat] || "Vehicles & Parts > Vehicle Parts & Accessories > Motor Vehicle Parts")}</g:google_product_category>
  <g:product_type>${x((truckPart(p) ? "Actros MP4 MP5 > " : "") + p.cat)}</g:product_type>
${p.bundle ? "  <g:is_bundle>yes</g:is_bundle>\n" : ""}  <g:shipping><g:country>AU</g:country><g:service>Standard</g:service><g:price>${shipRate(p).toFixed(2)} AUD</g:price></g:shipping>
</item>`).join("\n")}
</channel>
</rss>
`);

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
} else console.log(`Wrote ${out.size} files: ${products.length} parts, ${out.size - products.length - GUIDES.length - 4} categories, ${GUIDES.length} guides, home, 404, sitemap.xml, feed.xml (${feedItems.length} items).`);
