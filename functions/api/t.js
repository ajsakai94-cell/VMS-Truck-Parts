// Cloudflare Pages Function: POST /api/t  { vid, sid, events: [{ n, p, path, t }] }
// Writes site activity from track.js (page views, clicks, searches, cart, checkout) to the D1 database.
// Needs a D1 binding called DB on the Pages project (Settings > Bindings). Without it, events are dropped
// quietly and the site works as normal. The table is created on first use.
// Stored per event: time, random visitor/session IDs, event name, page, details, and the city/region/country
// and device type Cloudflare works out from the request. IP addresses are not stored.
// own = 1 marks the owner's own devices (switched on at /admin/), so the stats can leave them out.

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, vid TEXT, sid TEXT, name TEXT NOT NULL, path TEXT, props TEXT, country TEXT, region TEXT, city TEXT, postcode TEXT, device TEXT, browser TEXT, ua TEXT, own INTEGER NOT NULL DEFAULT 0)`,
  `CREATE INDEX IF NOT EXISTS events_ts ON events (ts)`,
  `CREATE INDEX IF NOT EXISTS events_vid ON events (vid, ts)`,
  `CREATE INDEX IF NOT EXISTS events_name ON events (name, ts)`,
];
let ready = null;
export function ensureSchema(db) {
  if (!ready) ready = db.batch(SCHEMA.map(s => db.prepare(s))).catch(e => { ready = null; throw e; });
  return ready;
}

function device(ua) {
  if (/iPad|Tablet|PlayBook|Silk|Android(?!.*Mobile)/i.test(ua)) return "tablet";
  if (/Mobi|iPhone|iPod|Android/i.test(ua)) return "mobile";
  return "desktop";
}
function browser(ua) {
  const os = /iPhone|iPad|iPod/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "Mac" : /CrOS/.test(ua) ? "ChromeOS" : /Linux/.test(ua) ? "Linux" : "other";
  const b = /Edg\//.test(ua) ? "Edge" : /SamsungBrowser/.test(ua) ? "Samsung" : /FBAN|FBAV|Instagram/.test(ua) ? "Facebook app" : /CriOS|Chrome\//.test(ua) ? "Chrome" : /FxiOS|Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "other";
  return `${b} / ${os}`;
}
const clip = (v, n) => (v == null ? null : String(v).slice(0, n));

// Shared with checkout.js so server-side steps (Stripe session created) land in the same log.
export async function logEvents(env, request, vid, sid, events, own = 0) {
  if (!env.DB || !events.length) return 0;
  await ensureSchema(env.DB);
  const cf = request.cf || {}, ua = request.headers.get("User-Agent") || "";
  const now = Date.now();
  const stmt = env.DB.prepare(`INSERT INTO events (ts, vid, sid, name, path, props, country, region, city, postcode, device, browser, ua, own) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const rows = events.map(e => {
    // Use the browser's time when it's sane (beacons can arrive a little late), else the server's.
    const t = Number(e.t), ts = t > now - 6 * 3600e3 && t < now + 60e3 ? t : now;
    let props = "{}";
    try { props = JSON.stringify(e.p && typeof e.p === "object" ? e.p : {}).slice(0, 4000); } catch {}
    return stmt.bind(ts, clip(vid, 40), clip(sid, 40), clip(e.n, 40) || "unknown", clip(e.path, 300), props,
      clip(cf.country, 4), clip(cf.region, 60), clip(cf.city, 60), clip(cf.postalCode, 10), device(ua), browser(ua), clip(ua, 250), own ? 1 : 0);
  });
  await env.DB.batch(rows);
  return rows.length;
}

export async function onRequestPost({ request, env, waitUntil }) {
  const ok = new Response(null, { status: 204 });
  // Only accept beacons sent from our own pages
  const origin = request.headers.get("Origin");
  if (origin && new URL(origin).host !== new URL(request.url).host) return ok;
  const text = await request.text();
  if (text.length > 64000) return ok;
  let body;
  try { body = JSON.parse(text); } catch { return ok; }
  const events = Array.isArray(body.events) ? body.events.slice(0, 50) : [];
  waitUntil(logEvents(env, request, body.vid, body.sid, events, body.own).catch(e => console.log("track: " + e.message)));
  // Now and then, drop events older than about 13 months so the free database never fills up
  if (env.DB && Math.random() < 0.002) waitUntil(env.DB.prepare("DELETE FROM events WHERE ts < ?").bind(Date.now() - 400 * 86400e3).run().catch(() => {}));
  return ok;
}
