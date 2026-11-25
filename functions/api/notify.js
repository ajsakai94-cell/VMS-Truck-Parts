// Shared helpers (not a page): texts and emails to customers, used by orders.js and stripe-webhook.js.
// Each one is optional and switches itself on when its secrets are added in Cloudflare:
//   SMS, either of:
//     - AJ's own gateway (SMS Gateway for Android API, reached through a private Cloudflare tunnel or a relay):
//       SMS_GATEWAY_URL (https; a bare host gets /message, or a full send URL such as
//       https://app.trakkhq.com/api/ext/sms) + SMS_GATEWAY_USER + SMS_GATEWAY_PASS,
//       optional CF_ACCESS_CLIENT_ID + CF_ACCESS_CLIENT_SECRET when the URL sits behind Cloudflare Access.
//       Used first when set.
//     - ClickSend (Australian):  CLICKSEND_USERNAME + CLICKSEND_API_KEY   (optional CLICKSEND_FROM, a sender number)
//   Email (Resend):                 RESEND_API_KEY, with vmstruckparts.com.au verified in Resend
// Replies always go to the shop's own phone and Gmail, never to the sending service.

export const SHOP = { name: "VMS Truck Parts", phone: "0481 309 893", email: "vmstruckparts@gmail.com", from: "VMS Truck Parts <orders@vmstruckparts.com.au>" };

const gatewayReady = env => !!(env.SMS_GATEWAY_URL && env.SMS_GATEWAY_USER && env.SMS_GATEWAY_PASS);
export const smsReady = env => gatewayReady(env) || !!(env.CLICKSEND_USERNAME && env.CLICKSEND_API_KEY);
export const emailReady = env => !!env.RESEND_API_KEY;

// Australian mobiles to +614XXXXXXXX. Anything else is sent as typed if it already starts with +.
export function mobile(p) {
  let d = String(p || "").replace(/[^\d+]/g, "");
  if (/^04\d{8}$/.test(d)) d = "+61" + d.slice(1);
  if (/^614\d{8}$/.test(d)) d = "+" + d;
  return /^\+\d{8,15}$/.test(d) ? d : null;
}

export const firstName = n => (String(n || "").trim().split(/\s+/)[0] || "there").replace(/^./, c => c.toUpperCase());
export const trackUrl = t => "https://auspost.com.au/mypost/track/details/" + encodeURIComponent(String(t).replace(/\s+/g, ""));

// Texts AJ (OWNER_MOBILE) when something stops a sale: checkout can't open, or Australia Post quoting is down.
// At most one text per problem every 30 minutes, so an outage doesn't flood his phone.
export async function alertOwner(env, key, body) {
  if (!env.OWNER_MOBILE || !smsReady(env)) return { skipped: "owner alerts not set up" };
  const c = typeof caches !== "undefined" ? caches.default : null;
  const k = new Request("https://vmstruckparts.com.au/__alert/" + encodeURIComponent(key));
  if (c && (await c.match(k))) return { skipped: "already alerted in the last 30 minutes" };
  if (c) await c.put(k, new Response("1", { headers: { "Cache-Control": "max-age=1800" } }));
  return sendSms(env, env.OWNER_MOBILE, "VMS website: " + body);
}

export async function sendSms(env, to, body) {
  if (!smsReady(env)) return { skipped: "SMS not set up" };
  const num = mobile(to);
  if (!num) return { error: "No mobile number on the order" };
  // Texts go out from the office phone's Australian plan: overseas (e.g. NZ) customers get the email only
  if (!num.startsWith("+61")) return { skipped: "Overseas number, email only" };
  if (gatewayReady(env)) return sendViaGateway(env, num, body);
  const msg = { source: "vms-site", to: num, body };
  if (env.CLICKSEND_FROM) msg.from = env.CLICKSEND_FROM;
  const r = await fetch("https://rest.clicksend.com/v3/sms/send", {
    method: "POST",
    headers: { Authorization: "Basic " + btoa(env.CLICKSEND_USERNAME + ":" + env.CLICKSEND_API_KEY), "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [msg] }),
  });
  const j = await r.json().catch(() => ({}));
  const m = ((j.data || {}).messages || [])[0] || {};
  if (!r.ok || (m.status && m.status !== "SUCCESS")) return { error: "SMS failed: " + (m.status || j.response_msg || r.status) };
  return { ok: true };
}

// SMS Gateway for Android: POST /message {textMessage:{text}, phoneNumbers:[...]} with Basic auth.
// The gateway queues the text on the phone and answers with its state (Pending / Processed / Sent / Failed).
async function sendViaGateway(env, num, body) {
  if (!/^https:\/\//.test(env.SMS_GATEWAY_URL)) return { error: "SMS_GATEWAY_URL must start with https://" };
  const headers = { Authorization: "Basic " + btoa(env.SMS_GATEWAY_USER + ":" + env.SMS_GATEWAY_PASS), "Content-Type": "application/json" };
  if (env.CF_ACCESS_CLIENT_ID && env.CF_ACCESS_CLIENT_SECRET) {
    headers["CF-Access-Client-Id"] = env.CF_ACCESS_CLIENT_ID;
    headers["CF-Access-Client-Secret"] = env.CF_ACCESS_CLIENT_SECRET;
  }
  try {
    // A bare host gets the gateway's own /message path; a full path (e.g. TrakkHQ's /api/ext/sms) is used as is
    const u = new URL(env.SMS_GATEWAY_URL);
    if (u.pathname === "/" || u.pathname === "") u.pathname = "/message";
    const r = await fetch(u.toString(), {
      method: "POST", headers,
      body: JSON.stringify({ textMessage: { text: body }, phoneNumbers: [num] }),
      signal: AbortSignal.timeout(15000),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.state === "Failed") return { error: "SMS failed: " + (j.message || j.state || r.status) };
    return { ok: true, state: j.state || null };
  } catch (e) {
    return { error: "SMS gateway unreachable: " + e.message };
  }
}

export async function sendEmail(env, to, subject, text, html) {
  if (!emailReady(env)) return { skipped: "Email not set up" };
  if (!to) return { error: "No email on the order" };
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ from: SHOP.from, to: [to], reply_to: SHOP.email, subject, text, ...(html ? { html } : {}) }),
  });
  if (!r.ok) { const j = await r.json().catch(() => ({})); return { error: "Email failed: " + (j.message || r.status) }; }
  return { ok: true };
}

export const thanksSms = name =>
  `Hi ${firstName(name)}, thank you for your order with ${SHOP.name}! We'll text you when it's shipped (or ready for pickup). Questions? Call or text ${SHOP.phone}.`;

export const trackingSms = (name, tracking) =>
  `Hi ${firstName(name)}, your ${SHOP.name} order has been shipped. Australia Post tracking: ${tracking} ${trackUrl(tracking)} Questions? Call or text ${SHOP.phone}.`;

// ---- Emails: plain text plus a simple branded HTML version (inline styles, works in Gmail/Outlook/phones)
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = n => "$" + Number(n || 0).toFixed(2);
const row = (l, r, bold) => `<tr><td style="padding:6px 0;border-bottom:1px solid #eee${bold ? ";font-weight:700" : ""}">${l}</td><td style="padding:6px 0;border-bottom:1px solid #eee;text-align:right;white-space:nowrap${bold ? ";font-weight:700" : ""}">${r}</td></tr>`;
function layout(title, inner) {
  return `<!doctype html><html><body style="margin:0;background:#f4f4f2;font-family:Arial,Helvetica,sans-serif;color:#16181b">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f2"><tr><td align="center" style="padding:20px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:10px;overflow:hidden">
<tr><td style="background:#16181b;padding:16px 22px;color:#fff;font-size:22px;font-weight:700;letter-spacing:.5px">VMS<span style="color:#c8102e">.</span> <span style="font-size:13px;font-weight:400;letter-spacing:2px;text-transform:uppercase">Truck Parts</span></td></tr>
<tr><td style="padding:22px;font-size:15px;line-height:1.5">
<h1 style="font-size:21px;margin:0 0 12px">${esc(title)}</h1>
${inner}
<p style="margin:22px 0 0;color:#555">Questions about your order? Reply to this email, or call or text <a href="tel:+61481309893" style="color:#c8102e">${SHOP.phone}</a>.</p>
</td></tr>
<tr><td style="padding:14px 22px;background:#fafaf8;color:#777;font-size:12px">${SHOP.name} &middot; Mercedes-Benz Actros MP4 parts specialists &middot; <a href="https://vmstruckparts.com.au" style="color:#777">vmstruckparts.com.au</a></td></tr>
</table></td></tr></table></body></html>`;
}

// Order confirmation, sent when an order is paid. Not a tax invoice (the shop isn't GST registered yet).
export function confirmEmail(o) {
  const lines = o.items.map(i => `  ${i.qty} x ${i.name}   ${money(i.total)}`).join("\n");
  const dest = o.pickup ? "Pickup in Victoria: we'll message you to arrange a time." : "Delivering to:\n" + o.address.join("\n");
  const text = `Hi ${firstName(o.name)},

Thank you for your order! We've received your payment and we'll get your parts packed.

Order ${o.ref}
${lines}
  ${o.shippingName}   ${money(o.shipping)}
  Total paid   ${money(o.total)}

${dest}

${o.pickup ? "We'll be in touch soon." : "We'll email and text you the Australia Post tracking number as soon as it's shipped."}

If anything isn't right, reply to this email or call or text ${SHOP.phone}.

${SHOP.name}
vmstruckparts.com.au`;
  const html = layout("Thank you for your order", `
<p style="margin:0 0 14px">Hi ${esc(firstName(o.name))}, thank you for your order! We've received your payment and we'll get your parts packed.</p>
<p style="margin:0 0 6px;color:#777;font-size:13px">Order ${esc(o.ref)}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:15px">
${o.items.map(i => row(`${esc(i.qty)} &times; ${esc(i.name)}`, money(i.total))).join("")}
${row(esc(o.shippingName), money(o.shipping))}
${row("Total paid", money(o.total), true)}
</table>
<p style="margin:16px 0 4px;font-weight:700">${o.pickup ? "Pickup" : "Delivering to"}</p>
<p style="margin:0;background:#f4f4f2;border-radius:8px;padding:10px 12px">${o.pickup ? "Pickup in Victoria. We'll message you to arrange a time." : o.address.map(esc).join("<br>")}</p>
<p style="margin:16px 0 0">${o.pickup ? "We'll be in touch soon." : "We'll email and text you the Australia Post tracking number as soon as it's shipped."}</p>`);
  return { subject: `Thank you for your order (${SHOP.name}, order ${o.ref})`, text, html };
}

// "Your order has been shipped", with the tracking number. Sent from the Send tracking button on /admin/orders/.
export function trackingEmail(name, tracking, items) {
  const text = `Hi ${firstName(name)},

Good news: your order has been shipped with Australia Post.

Tracking number: ${tracking}
Track it here: ${trackUrl(tracking)}
${items && items.length ? "\nIn the parcel:\n" + items.map(i => `  ${i.qty} x ${i.name}`).join("\n") + "\n" : ""}
Thanks for buying from us. If anything isn't right, reply to this email or call or text ${SHOP.phone}.

${SHOP.name}
vmstruckparts.com.au`;
  const html = layout("Your order has been shipped", `
<p style="margin:0 0 14px">Hi ${esc(firstName(name))}, good news: your order has been shipped with Australia Post.</p>
<p style="margin:0 0 4px;color:#777;font-size:13px">Tracking number</p>
<p style="margin:0 0 14px;font-size:19px;font-weight:700;letter-spacing:.5px">${esc(tracking)}</p>
<p style="margin:0 0 18px"><a href="${esc(trackUrl(tracking))}" style="display:inline-block;background:#c8102e;color:#fff;text-decoration:none;font-weight:700;padding:11px 18px;border-radius:8px">Track your parcel</a></p>
${items && items.length ? `<p style="margin:0 0 4px;font-weight:700">In the parcel</p><ul style="margin:0;padding-left:20px">${items.map(i => `<li>${esc(i.qty)} &times; ${esc(i.name)}</li>`).join("")}</ul>` : ""}`);
  return { subject: `Your ${SHOP.name} order has been shipped`, text, html };
}

export function onRequest() { return new Response("Not found", { status: 404 }); }
