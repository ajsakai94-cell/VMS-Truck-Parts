// Checks products.json before it ships: run `node tools/check-products.mjs`.
// Fails (exit 1) on anything that would break checkout, the cart or Google Merchant Center.
import { readFileSync } from "node:fs";

const file = new URL("../products.json", import.meta.url);
const data = JSON.parse(readFileSync(file, "utf8"));
const errors = [];
const err = (id, msg) => errors.push(`${id}: ${msg}`);

for (const k of ["truck", "currency", "shipping", "contact", "products"]) if (!(k in data)) err("top", `missing ${k}`);
const s = data.shipping || {};
if (!(s.flatRate > 0) || !(s.freeOver > 0)) err("shipping", "flatRate and freeOver must be positive numbers");

const ids = new Set(), slugs = new Set();
for (const p of data.products || []) {
  const id = p.id || "(no id)";
  for (const k of ["id", "slug", "name", "cat", "sku", "image", "brand", "mpn", "condition", "desc"])
    if (typeof p[k] !== "string" || !p[k].trim()) err(id, `missing ${k}`);
  if (ids.has(p.id)) err(id, "duplicate id"); ids.add(p.id);
  if (slugs.has(p.slug)) err(id, "duplicate slug"); slugs.add(p.slug);
  if (p.slug && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(p.slug)) err(id, `slug "${p.slug}" must be lowercase words joined by -`);
  if (typeof p.available !== "boolean") err(id, "available must be true or false");
  if (p.price !== null && !(typeof p.price === "number" && p.price > 0)) err(id, "price must be a positive number or null");
  // available + price null is allowed: shows "In stock, call for price" and checkout refuses it.
  if (/mercedes|benz|daimler/i.test(p.brand || "")) err(id, "brand must not be Mercedes-Benz/Daimler (Merchant Center rejects aftermarket parts branded as OE)");
  if (typeof p.identifierExists !== "boolean") err(id, "identifierExists must be true or false");
  if (p.identifierExists && !p.gtin) err(id, "identifierExists is true but there is no gtin");
  if (p.condition && p.condition !== "new") err(id, "condition must be new");
  for (const k of ["oem", "cross"]) if (!Array.isArray(p[k])) err(id, `${k} must be a list`);
  for (const n of p.oem || []) if (!/^A \d{3} \d{3} \d{2} \d{2}$/.test(n)) err(id, `OE number "${n}" should look like "A 473 180 00 09"`);
  const f = p.fits || {};
  if (!Array.isArray(f.models) || !f.models.length) err(id, "fits.models must list at least one model");
  if (!Array.isArray(f.engines)) err(id, "fits.engines must be a list (can be empty)");
  for (const e of f.engines || []) if (!/^OM47[013]$/.test(e)) err(id, `unknown engine "${e}"`);
  if (p.options && (!Array.isArray(p.options) || !p.options.length)) err(id, "options must be a non-empty list");
}

if (errors.length) {
  console.error(`products.json: ${errors.length} problem(s)\n  ` + errors.join("\n  "));
  process.exit(1);
}
const n = data.products.length, oe = data.products.filter(p => p.oem.length).length;
console.log(`products.json OK: ${n} products, ${oe} with an OE number, ${data.products.filter(p => p.available).length} in stock`);
