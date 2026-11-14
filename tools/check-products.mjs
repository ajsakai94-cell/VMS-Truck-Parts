// Checks products.json before it ships: run `node tools/check-products.mjs`.
// Fails (exit 1) on anything that would break checkout, the cart or Google Merchant Center.
import { readFileSync, existsSync } from "node:fs";

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
  for (const k of ["id", "slug", "name", "cat", "sku", "brand", "mpn", "condition", "desc"])
    if (typeof p[k] !== "string" || !p[k].trim()) err(id, `missing ${k}`);
  if (typeof p.image !== "string") err(id, "image must be a string (empty = icon until a photo is added)");
  if (p.image && !/^\/images\/[a-z0-9-]+\.webp$/.test(p.image)) err(id, `image "${p.image}" must be a local /images/*.webp file`);
  if (p.thumb !== undefined && !/^\/images\/[a-z0-9-]+\.webp$/.test(p.thumb)) err(id, `thumb "${p.thumb}" must be a local /images/*.webp file`);
  for (const f of [p.image, p.thumb]) if (f && !existsSync(new URL(".." + f, import.meta.url))) err(id, `${f} is missing from the repo`);
  if (p.freightQuote !== undefined && typeof p.freightQuote !== "boolean") err(id, "freightQuote must be true or false");
  if (p.maxQty !== undefined && !(Number.isInteger(p.maxQty) && p.maxQty >= 1)) err(id, "maxQty must be a whole number of at least 1");
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
  if (!Array.isArray(f.models) || (!f.models.length && p.cat !== "Workshop")) err(id, "fits.models must list at least one model (only Workshop equipment may leave it empty)");
  if (!Array.isArray(f.engines)) err(id, "fits.engines must be a list (can be empty)");
  for (const e of f.engines || []) if (!/^OM47[0-3]$/.test(e)) err(id, `unknown engine "${e}"`);
  if (p.tags !== undefined && (!Array.isArray(p.tags) || p.tags.some(t => typeof t !== "string" || !t.trim()))) err(id, "tags must be a list of words or phrases");
  if (p.illustration !== undefined && typeof p.illustration !== "boolean") err(id, "illustration must be true or false");
  if (p.options && (!Array.isArray(p.options) || !p.options.length)) err(id, "options must be a non-empty list");
}

if (errors.length) {
  console.error(`products.json: ${errors.length} problem(s)\n  ` + errors.join("\n  "));
  process.exit(1);
}
const n = data.products.length, oe = data.products.filter(p => p.oem.length).length;
console.log(`products.json OK: ${n} products, ${oe} with an OE number, ${data.products.filter(p => p.available).length} in stock`);
