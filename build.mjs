// Builds the crawlable pages from products.json:
//   /parts/<slug>/index.html   one page per part
//   /<category>/index.html     one page per category
//   /404.html                  real "not found" page (also stops Cloudflare's send-everything-to-home fallback)
//   /guides/<slug>/index.html  guide pages (content in GUIDES below)
//   /index.html                only the <!--build:...--> regions are filled in (cards, categories, guides, head tags)
//   /policies.html, /success.html  hand-written; only the ?v= on their styles.css / app.js links is updated
//   /sitemap.xml, /feed.xml    sitemap for Search Console, product feed for Merchant Center
// Run:   node build.mjs          write the files
//        node build.mjs --check  fail if the committed files are out of date (used by the GitHub check)
// The generated files are committed, so Cloudflare Pages still needs no build step.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
// Every page links styles.css and app.js with ?v=<hash of the file>, so when either changes the URL changes
// and browsers fetch the new copy instead of mixing new pages with an old cached stylesheet.
const ver = f => createHash("sha1").update(readFileSync(join(ROOT, f))).digest("hex").slice(0, 8);
const CSS = `/styles.css?v=${ver("styles.css")}`, JS = `/app.js?v=${ver("app.js")}`;
const versionAssets = html => html.replace(/(href=")\/?styles\.css(\?v=[0-9a-f]+)?"/g, `$1${CSS}"`).replace(/(src=")\/?app\.js(\?v=[0-9a-f]+)?"/g, `$1${JS}"`);
const data = JSON.parse(readFileSync(join(ROOT, "products.json"), "utf8"));

// Brand and site settings live in one place, so a rename or domain change is one edit.
const SITE = {
  name: "VMS Truck Parts",
  url: "https://vmstruckparts.com.au",
  region: "Victoria, Australia",
  ...(data.site || {}),
};
const C = data.contact, SHIP = data.shipping;
// shipping for a part on its own (no free shipping): its Australia Post satchel price(s), else its
// size-class rate (heavy / extra heavy, the fallback when Australia Post can't be priced), else the flat rate
const shipRate = p => p.satchel ? [].concat(p.satchel).reduce((t, z) => t + SHIP.satchels[z].price, 0)
  : p.shipClass ? SHIP.rates[p.shipClass] : SHIP.flatRate;

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
${path ? `<link rel="canonical" href="${SITE.url}${path}">\n` : `<meta name="robots" content="noindex">\n`}${og}${jsonld.map(ld).join("")}<link rel="preload" href="/fonts/ibm-plex-sans.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/barlow-condensed-700.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="${CSS}">
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
      <label class="pc" id="pcRow" hidden>Delivery postcode <input id="postcode" inputmode="numeric" autocomplete="postal-code" maxlength="4" placeholder="e.g. 4655"></label>
      <div class="big"><span>Total</span><span id="total">$0.00</span></div>
    </div>
    <button class="primary" id="checkout" type="button">Checkout</button>
    <p class="note" id="checkoutNote">Shipped by Australia Post. No account needed, and you can choose free pickup at checkout instead.</p>
  </div>
</div>

<script src="${JS}"></script>
</body>
</html>
`;
}

const crumbs = items => `<nav class="crumbs" aria-label="Breadcrumb"><ol>${items.map(([t, u], i) =>
  i === items.length - 1 ? `<li aria-current="page">${esc(t)}</li>` : `<li><a href="${u}">${esc(t)}</a></li>`).join("")}</ol></nav>`;

const crumbLd = items => ({ "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: items.map(([t, u], i) => ({ "@type": "ListItem", position: i + 1, name: t, ...(u ? { item: SITE.url + u } : {}) })) });

const pic = (p, cls = "") => p.image
  ? `<img src="${esc(cls === "big" ? p.image : (p.thumb || p.image))}" alt="${esc(p.name)}${truckPart(p) ? " to suit Mercedes-Benz Actros MP4 / MP5" : ""}" width="${cls === "big" ? 1000 : 400}" height="${cls === "big" ? 1000 : 400}"${cls === "big" ? ' fetchpriority="high"' : ' loading="lazy"'}>`
  : `<span class="noimg">${esc(p.cat)}</span>`;
const picBig = p => pic(p, "big") + (p.image && p.illustration ? `<p class="illus">Illustration – actual part may vary</p>` : "");

const priceHtml = p => p.price != null ? `<div class="price">${money(p.price)}</div>` : `<div class="price ask">Call for price</div>`;
const stockHtml = p => `<div class="stock ${p.available ? "" : "out"}">${p.available ? "In stock" : "Sold out, ask us"}</div>`;

const card = p => `<a class="card" href="${partUrl(p)}">
    <div class="pic">${pic(p)}</div>
    <div class="body"><h3>${esc(p.name)}</h3><span class="pn">${p.oem.length ? "OE " + esc(p.oem[0]) : "Part no. " + esc(p.sku)}</span>
    <div class="foot"><div>${priceHtml(p)}${stockHtml(p)}</div><span class="view">View</span></div></div></a>`;

const sortParts = list => [...list].sort((a, b) => (b.available - a.available) || a.name.localeCompare(b.name));

// ---- part numbers in the forms mechanics type into Google ----
// OE "A 472 184 04 25" is also searched as "A4721840425", "4721840425" and "472 184 04 25".
// Aftermarket "MANN HU 12 001 z" is also searched as "HU12001z" (with or without the brand).
const oeForms = n => { const sp = n.replace(/^A\s*/i, ""); const c = sp.replace(/\s+/g, ""); return [n, "A" + c, c, sp]; };
const BRANDS = ["DT Spare Parts", "Luber-finer", "MAHLE", "MANN", "Hengst", "Bosch", "Febi", "Fleetguard", "Donaldson", "Wix", "Baldwin", "Sakura", "Trucktec", "NRF", "Nissens", "Prestolite", "WVA", "Knorr"];
const crossSplit = s => { const b = BRANDS.find(b => s.startsWith(b + " ")); return b ? [b, s.slice(b.length + 1)] : ["", s]; };
const crossForms = s => { const [b, n] = crossSplit(s.replace(/[()]/g, "")); const c = n.replace(/\s+/g, ""); return c === n ? [s] : [s, (b ? b + " " : "") + c, c]; };
// every distinct form after the one already shown, for the "Also written as" line
const altNumbers = p => [...new Set([...p.oem.flatMap(n => oeForms(n).slice(1)), ...p.cross.flatMap(n => crossForms(n).slice(1))])];
const compactOe = n => oeForms(n)[1];

function partPage(p) {
  const oe = p.oem[0] ? ` ${p.oem[0]}` : "";
  const eng = p.fits.engines.length && !/OM47\d/.test(p.name) ? ` ${p.fits.engines.join("/")}` : "";
  // Google title: plain part name, then fitment, then OE number, then price
  const title = `${p.name}${truckPart(p) ? " for Mercedes Actros MP4/MP5" + eng : ""}${p.oem[0] ? " – OE " + p.oem[0] : ""}${p.price != null ? " | " + shortMoney(p.price) + (p.available ? " In Stock" : "") : ""} | ${SITE.name}`;
  const desc = `${p.available && p.price != null ? "In stock, " + shortMoney(p.price) + ". " : p.available ? "In stock. " : ""}${p.name}${truckPart(p) ? " for the Mercedes-Benz Actros MP4 / MP5" + (eng ? " (" + eng.trim() + ")" : "") : ""}.${p.oem.length ? " Replaces OE " + p.oem.slice(0, 3).join(", ") + "." : ""} ${p.freightQuote ? "Freight quoted, or free pickup in Victoria." : `Shipped Australia-wide from ${SITE.region.split(",")[0]}.`}${truckPart(p) ? " Text your VIN and we'll check it fits." : ""}`;
  const canBuy = p.available && p.price != null;
  const shipNote = p.freightQuote
    ? "Freight isn't included on this part. We'll quote it after you order and call you before sending, or pick up free in Victoria."
      : p.satchel
        ? `${money(shipRate(p))} Australia-wide by Australia Post satchel${Array.isArray(p.satchel) ? "s" : ""}, or free pickup in Victoria.`
      : Array.isArray(p.pack)
        ? "Australia Post to your postcode: enter it in the cart to see the cost. Or free pickup in Victoria."
        : `${money(shipRate(p))} Australia-wide, or free pickup in Victoria.`;
  const related = sortParts(products.filter(x => x.cat === p.cat && x.id !== p.id)).slice(0, 4);
  const spec = [
    ["Fits", esc(fitsText(p))],
    p.oem.length && ["Replaces OE", `<span class="mono">${p.oem.map(esc).join("<br>")}</span>`],
    p.cross.length && ["Cross-reference", `<span class="mono">${p.cross.map(esc).join("<br>")}</span>`],
    altNumbers(p).length && ["Also written as", `<span class="mono">${altNumbers(p).map(esc).join(" · ")}</span>`],
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
${p.specs ? `    <p><b>At a glance:</b></p><ul class="kit">${p.specs.map(([k, v]) => `<li><b>${esc(k)}:</b> ${esc(v)}</li>`).join("")}</ul>\n` : ""}${p.bundle ? `    <p><b>In this kit:</b></p><ul class="kit">${p.bundle.map(id => products.find(x => x.id === id)).map(x => `<li><a href="${partUrl(x)}">${esc(x.name)}</a>${x.oem[0] ? ` <span class="mono">${esc(x.oem[0])}</span>` : ""}</li>`).join("")}</ul>\n` : ""}${p.options ? `    <label>Side <select id="pOpt">${p.options.map(o => `<option>${esc(o)}</option>`).join("")}</select></label>\n` : ""}    ${canBuy
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
  // Part numbers up front: unspaced OE in the title, OE + top cross-refs at the start of the description,
  // and every number as a PropertyValue in the Product schema. sku/mpn stay our own numbers (these aren't
  // genuine Mercedes parts, and the Merchant Center feed uses the same mpn).
  const numTitle = p.oem[0] ? title.replace(" – OE " + p.oem[0], ` – OE ${p.oem[0]} (${compactOe(p.oem[0])})`) : title;
  const numLead = p.oem.length || p.cross.length ? [p.oem[0] && `OE ${p.oem[0]} (${compactOe(p.oem[0])})`, ...p.cross.slice(0, 2)].filter(Boolean).join(", ") + ". " : "";
  product.alternateName = [...new Set([...p.oem.flatMap(oeForms), ...p.cross.flatMap(crossForms)])].slice(0, 40);
  if (!product.alternateName.length) delete product.alternateName;
  const props = [...p.oem.map(n => ({ "@type": "PropertyValue", name: "Replaces OE number", value: n })),
    ...p.cross.map(n => { const [b, num] = crossSplit(n); return { "@type": "PropertyValue", name: (b ? b + " " : "") + "cross-reference", value: num }; })];
  if (props.length) product.additionalProperty = props;
  return layout({ title: numTitle, desc: numLead + desc, path: partUrl(p), body, part: p.id, image: p.image, type: "product", jsonld: [product, crumbLd(crumbItems)] });
}

function catPage(cat) {
  const c = CATS[cat];
  const list = sortParts(products.filter(p => p.cat === cat));
  const body = `${crumbs([["Home", "/"], [cat, ""]])}
<section class="block catintro">
  <h1>${esc(c.title)}</h1>
  <p>${esc(c.intro)}</p>
  <p class="note">${list.length} part${list.length === 1 ? "" : "s"} · Australia Post to your postcode · Free pickup in Victoria</p>
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

// ---- "find my part" help: engine picker (home page) and the text/email request form (home page + guide) ----
const PHONE = C.phone.replace(/\s/g, "");
const ASK = `<form class="ask" id="askForm" data-phone="${esc(PHONE)}" data-email="${esc(C.email)}">
  <label>What part do you need?<input name="part" required placeholder="e.g. fuel filter, starter motor"></label>
  <label>Rego and state, or VIN<input name="truck" placeholder="e.g. XC12AB VIC, or your 17-character VIN"></label>
  <label>Your name<input name="name" autocomplete="name"></label>
  <div class="askbtns"><button class="primary" type="submit" name="how" value="sms">Text us</button><button class="primary alt" type="submit" name="how" value="email">Email us</button></div>
  <p class="note">This opens your phone's messages or email with the details filled in. Add a photo of the old part or its label and send it. We reply with the right part number and a price.</p>
  <noscript><p class="note">Or text ${esc(C.phone)} / email ${esc(C.email)} with your rego or VIN and a photo of the old part.</p></noscript>
</form>`;

const FINDGUIDE = `<p>The quickest way to get the right part is the number printed on the old one. If you can't read it, your rego or VIN lets us look the truck up for you. Here's where to find each.</p>
<h2>1. The number on the old part</h2>
<p>Mercedes-Benz part numbers (OE numbers) start with an A and look like <span class="mono">A 472 184 04 25</span>. They're printed or stamped on the part, on a sticker, or on the box. Aftermarket parts carry their own brand's number, such as MAHLE <span class="mono">OX 832D</span> or MANN <span class="mono">HU 12 001 z</span>.</p>
<p>Type either kind into the <a href="/#q">search box</a>. Spaces and dashes don't matter, and you can leave off the A.</p>
<h2>2. Which engine you have</h2>
<p>Every truck part on this site suits the MP4 and MP5 Actros. A few engine parts depend on the engine. The model number on the cab, such as 2653, gives you the power: the last two digits are the horsepower divided by ten.</p>
<div class="tablewrap"><table><thead><tr><th>Model on the cab</th><th>Power</th><th>Engine (usually)</th></tr></thead><tbody>
<tr><td>2643, 2646</td><td>430 to 460 hp</td><td>OM471 (12.8 litre)</td></tr>
<tr><td>2653</td><td>530 hp</td><td>OM471 (12.8 litre)</td></tr>
<tr><td>2658, 2663</td><td>580 to 630 hp</td><td>OM473 (15.6 litre)</td></tr>
</tbody></table></div>
<p>The engine type is also on the plate on the engine block and on your service records. Pick your engine on the <a href="/#finder">home page</a> and we'll only show parts that suit it.</p>
<h2>3. Your VIN or rego</h2>
<p>The VIN (Mercedes calls it the FIN) is 17 characters and starts with W. It's on your registration papers and on the vehicle data plate in the door frame. Your rego and state are usually enough for us to look it up.</p>
<h2>Send it to us and we'll check</h2>
<p>Fill this in, add a photo of the old part, and send. We'll reply with the right part number and a price.</p>
${ASK}`;
const GUIDES = [
  { path: "/guides/find-actros-part-number/", short: "How to find your part number",
    title: "How to Find the Right Part Number for Your Actros MP4 / MP5",
    desc: "Where to find the OE part number, VIN and engine type on a Mercedes-Benz Actros MP4 / MP5, and how to get us to check the right part for your truck.",
    blurb: "Where the numbers are on the part and the truck, and how we check it for you.",
    body: () => FINDGUIDE },
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
${byId("service-kit") ? `<p>Doing a full service? The <a href="${partUrl(byId("service-kit"))}">service filter kit</a> has the oil, fuel, water separator, air and cabin filters in one box for ${money(byId("service-kit").price)}.</p>` : ""}
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
${sortParts(products.filter(p => p.cat === "Filters" && !p.bundle)).map(p => `<tr><td>${link(p)}</td><td>${mono(p.oem.flatMap(n => [n, compactOe(n)]))}</td><td>${mono(p.cross)}</td><td>${p.price != null ? money(p.price) : "Call"}</td></tr>`).join("")}
</tbody></table></div>
<p>Can't find your number? Call or text <a href="tel:${C.phone.replace(/\s/g, "")}">${esc(C.phone)}</a> with the number off your old filter and we'll match it.</p>` },
  { path: "/guides/actros-mp4-filter-kit-part-numbers/", short: "MP4 filter kit part numbers",
    title: "Actros MP4 Service Filter Kit Part Numbers (OM471 / OM473)",
    desc: "The 5 filters in an Actros MP4 / MP5 service kit with every OE number written the ways mechanics search it, plus MAHLE, MANN and Hengst equivalents.",
    blurb: "The 5 service filters, their OE numbers in every format, and the kit price.",
    body: () => { const kit = byId("service-kit"); const parts = kit.bundle.map(byId);
      return `<p>A standard oil service on the MP4 or MP5 Mercedes-Benz Actros (OM471 or OM473) uses five filters: engine oil, the main fuel filter, the fuel pre-filter / water separator, the engine air filter and the cabin filter. Per the MAHLE MP4 / MP5 catalogue, the oil, fuel, pre-filter and air filters are the same parts on the OM471 and the OM473.</p>
<p>Mercedes numbers are printed with spaces, like <span class="mono">A 472 184 04 25</span>, but invoices and parts systems often run them together as <span class="mono">A4721840425</span> or drop the A. All of those are the same part, and they're all listed below.</p>
<h2>What's in the kit</h2>
<div class="tablewrap"><table><thead><tr><th>Filter</th><th>OE number</th><th>Also written as</th><th>Cross-reference</th></tr></thead><tbody>
${parts.map(p => `<tr><td>${link(p)}</td><td>${mono(p.oem)}</td><td>${mono(p.oem.slice(0, 2).flatMap(n => oeForms(n).slice(1, 3)))}</td><td>${mono(p.cross.slice(0, 3))}</td></tr>`).join("")}
</tbody></table></div>
<p>The <a href="${partUrl(kit)}">service filter kit</a> is all five in one box for ${money(kit.price)}, ${money(parts.reduce((t, p) => t + p.price, 0) - kit.price)} less than buying them one by one.</p>
<h2>Numbers to double-check</h2>
<ul>
<li><b>Air filter:</b> MAHLE also lists LX 5438 (OE A 004 094 97 04) for the same trucks, which looks like a different housing size. Match the number on your old element.</li>
<li><b>Fuel filter:</b> some catalogues list A 471 090 24 55 or 08 55 instead of 27 55. Check the number on your old filter or its box.</li>
<li><b>Cabin filter:</b> MP4 / MP5 cabs use more than one cabin filter, including a carbon version (A 960 830 01 18, MAHLE LAK 863). Ours is the pollen filter, A 960 830 02 18.</li>
</ul>
<p>Not sure? Text your VIN or a photo of the old filter to <a href="sms:${PHONE}">${esc(C.phone)}</a> and we'll check before you pay.</p>`; } },
  { path: "/guides/actros-mp4-brake-pad-part-numbers/", short: "MP4 brake pad part numbers",
    title: "Actros MP4 / MP5 Brake Pad Part Numbers: Front and Rear",
    desc: "Front and rear brake pad numbers for the Mercedes-Benz Actros MP4 / MP5: OE A 006 420 14 20 (A0064201420) and A 006 420 53 20 (A0064205320), WVA numbers and calipers.",
    blurb: "Front and rear pads are different. OE, WVA and caliper numbers for each.",
    body: () => `<p>The front and rear brake pads on the MP4 and MP5 Mercedes-Benz Actros are different sizes, so you need the right number for each axle. Most MP4s run Knorr-Bremse disc brakes: an SM7 caliper on the front and an SL7 on the rear.</p>
<h2>Brake pad numbers</h2>
<div class="tablewrap"><table><thead><tr><th>Axle</th><th>Mercedes OE</th><th>Also written as</th><th>WVA</th><th>Caliper</th><th>Pad size (approx.)</th></tr></thead><tbody>
<tr><td>Front</td><td>${mono(["A 006 420 14 20"])}</td><td>${mono(oeForms("A 006 420 14 20").slice(1, 3))}</td><td>${mono(["29246", "29247"])}</td><td>Knorr SM7</td><td>245 x 113.5 x 30 mm</td></tr>
<tr><td>Rear</td><td>${mono(["A 006 420 53 20"])}</td><td>${mono(oeForms("A 006 420 53 20").slice(1, 3))}</td><td>${mono(["29244", "29245"])}</td><td>Knorr SL7</td><td>208 x 115 x 30 mm</td></tr>
</tbody></table></div>
<p>Other numbers that turn up for the same pads: front <span class="mono">A 006 420 52 20</span> and <span class="mono">A 000 421 72 10</span>; rear <span class="mono">A 006 420 15 20</span>. Treat these as "check the old pad" rather than a sure match.</p>
<h2>Check your caliper first</h2>
<p>Some MP4s run a Wabco MAXX22L caliper instead of Knorr. Those use a different pad (WVA <span class="mono">29315</span>, front and rear). The WVA number is stamped on the backing plate of the old pad, so match it before you order.</p>
<h2>Need pads?</h2>
<p>We don't list brake pads online yet. Text the WVA or OE number off your old pads, or your VIN, to <a href="sms:${PHONE}">${esc(C.phone)}</a> or email <a href="mailto:${esc(C.email)}">${esc(C.email)}</a> and we'll quote a front or rear axle set.</p>
<p>Doing the brakes? We also stock the <a href="${partUrl(byId("brake-hose"))}">brake hose set with M22 connectors</a>.</p>` },
  { path: "/guides/actros-mp4-engine-cooling-part-numbers/", short: "MP4 engine and cooling numbers",
    title: "Actros MP4 Engine and Cooling Part Numbers (OM471 / OM473)",
    desc: "OE numbers and aftermarket equivalents for the Actros MP4 / MP5 fan clutch, expansion tank, starter motor, oil spinner, cylinder head and battery sensor.",
    blurb: "Fan clutch, expansion tank, starter, oil spinner and more, by OE number.",
    body: () => { const list = sortParts(products.filter(p => (p.cat === "Engine" || p.cat === "Cooling") && p.oem.length));
      return `<p>These are the engine and cooling parts we stock for the MP4 and MP5 Mercedes-Benz Actros, listed by Mercedes OE number and the aftermarket numbers that match. Type any of them into the <a href="/#q">search box</a>, with or without the spaces and the leading A.</p>
<h2>Part numbers</h2>
<div class="tablewrap"><table><thead><tr><th>Part</th><th>OE number</th><th>Also written as</th><th>Cross-reference</th><th>Price</th></tr></thead><tbody>
${list.map(p => `<tr><td>${link(p)}</td><td>${mono(p.oem)}</td><td>${mono(p.oem.flatMap(n => oeForms(n).slice(1, 2)))}</td><td>${mono(p.cross)}</td><td>${p.price != null ? money(p.price) : "Call"}${p.available ? "" : " (sold out)"}</td></tr>`).join("")}
</tbody></table></div>
<h2>Which engine?</h2>
<p>Some of these differ between the OM471 (12.8 litre) and the OM473 (15.6 litre). Each part page says which engine it suits. If you're not sure, the <a href="/guides/find-actros-part-number/">part number guide</a> shows where to find the engine type, or text your VIN to <a href="sms:${PHONE}">${esc(C.phone)}</a> and we'll check.</p>`; } },
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
  fill("ask", ASK);
  fill("guides", GUIDES.map(g => `<a class="guide" href="${g.path}"><b>${esc(g.short)}</b><span>${esc(g.blurb)}</span></a>`).join(""));
  return versionAssets(html);
}

// ---- write or check ----
const out = new Map();
for (const p of products) out.set(join("parts", p.slug, "index.html"), partPage(p));
for (const cat of Object.keys(CATS)) if (products.some(p => p.cat === cat)) out.set(join(CATS[cat].path, "index.html"), catPage(cat));
out.set("404.html", notFound());
for (const g of GUIDES) out.set(join(g.path.slice(1), "index.html"), guidePage(g));
out.set("index.html", homePage());
// hand-written pages: only their stylesheet/script links are updated
for (const f of ["policies.html", "success.html"]) out.set(f, versionAssets(readFileSync(join(ROOT, f), "utf8")));

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
} else console.log(`Wrote ${out.size} files: ${products.length} parts, ${out.size - products.length - GUIDES.length - 6} categories, ${GUIDES.length} guides, home, 404, policies, success, sitemap.xml, feed.xml (${feedItems.length} items).`);
