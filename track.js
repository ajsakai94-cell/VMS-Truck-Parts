// Site activity log: records page views, clicks, searches, cart and checkout steps to /api/t
// (a Cloudflare Pages Function that writes them to the D1 database). See /admin/ for the stats.
// No cookies: a random visitor ID lives in this browser's localStorage, a session ID in sessionStorage.
// app.js and the hand-written pages call window.vmsTrack(name, props) for shop events.
(function () {
  var Q = [], timer = null, own = false;
  function rand() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }
  function stored(store, k) {
    try { var v = store.getItem(k); if (!v) { v = rand(); store.setItem(k, v); } return v; } catch (e) { return rand(); }
  }
  // The owner's own phone/PC is tagged (switch on /admin/) so it can be left out of the numbers.
  try { own = localStorage.getItem("vms-owner") === "1"; } catch (e) {}
  // Skip automated browsers and crawlers.
  if (navigator.webdriver || /bot|crawl|spider|slurp|lighthouse|headless|preview|facebookexternalhit/i.test(navigator.userAgent)) {
    window.vmsTrack = function () {};
    return;
  }
  // Google Ads tag. Fill in the two values from Google Ads (Goals > Conversions > Purchase > Tag setup):
  // id looks like "AW-123456789", purchase is the conversion label. While id is empty nothing loads.
  // The owner's own devices never load it, so AJ's test orders don't count as ad sales.
  var ADS = { id: "AW-18592844464", purchase: "pp3XCNGqtL4dELCV4aFF" };
  window.vmsAds = ADS;
  if (ADS.id && !own) {
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag("js", new Date());
    window.gtag("config", ADS.id);
    var g = document.createElement("script");
    g.async = true; g.src = "https://www.googletagmanager.com/gtag/js?id=" + ADS.id;
    document.head.appendChild(g);
  }

  var vid = stored(localStorage, "vms-vid"), sid = stored(sessionStorage, "vms-sid");
  var isNew = false;
  try { isNew = !localStorage.getItem("vms-seen"); localStorage.setItem("vms-seen", "1"); } catch (e) {}

  function flush() {
    clearTimeout(timer); timer = null;
    if (!Q.length) return;
    var body = JSON.stringify({ vid: vid, sid: sid, own: own ? 1 : 0, events: Q.splice(0, 50) });
    var sent = false;
    try { sent = navigator.sendBeacon && navigator.sendBeacon("/api/t", new Blob([body], { type: "text/plain" })); } catch (e) {}
    if (!sent) try { fetch("/api/t", { method: "POST", body: body, keepalive: true }); } catch (e) {}
    if (Q.length) flush();
  }
  function track(name, props) {
    Q.push({ n: String(name).slice(0, 40), p: props || {}, path: location.pathname + location.search, t: Date.now() });
    if (Q.length >= 20) flush(); else if (!timer) timer = setTimeout(flush, 1500);
  }
  window.vmsTrack = track;

  // Page view, with where they came from
  var q = new URLSearchParams(location.search), utm = {};
  ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gclid", "fbclid", "msclkid"].forEach(function (k) { if (q.get(k)) utm[k] = q.get(k).slice(0, 100); });
  track("page_view", {
    title: document.title.slice(0, 120), ref: document.referrer.slice(0, 300), newVisitor: isNew,
    w: window.innerWidth, h: window.innerHeight, lang: navigator.language, utm: utm
  });

  // Time on page and how far down they scrolled
  var start = Date.now(), visible = 0, shownAt = document.visibilityState === "visible" ? start : 0, maxScroll = 0;
  function scrolled() {
    var d = document.documentElement, h = d.scrollHeight - window.innerHeight;
    maxScroll = Math.max(maxScroll, h > 0 ? Math.round(100 * window.scrollY / h) : 100);
  }
  window.addEventListener("scroll", scrolled, { passive: true });
  var left = false;
  function leave() {
    if (left) return; left = true;
    if (shownAt) visible += Date.now() - shownAt;
    scrolled();
    track("page_leave", { seconds: Math.round(visible / 1000), scroll: maxScroll });
    flush();
  }
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") { if (shownAt) { visible += Date.now() - shownAt; shownAt = 0; } flush(); }
    else shownAt = Date.now();
  });
  window.addEventListener("pagehide", leave);

  // Every link and button click
  document.addEventListener("click", function (e) {
    var el = e.target.closest && e.target.closest("a,button,summary,[role=button]");
    if (!el) return;
    var text = (el.getAttribute("aria-label") || el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 60);
    var href = el.getAttribute("href") || "";
    var kind = /^tel:/.test(href) ? "call_click" : /^sms:/.test(href) ? "sms_click" : /^mailto:/.test(href) ? "email_click"
      : (el.tagName === "A" && el.host && el.host !== location.host) ? "outbound_click" : "click";
    track(kind, { text: text, href: href.slice(0, 200), tag: el.tagName.toLowerCase(), id: el.id || undefined });
  }, true);

  // Text copied from the page (often a part number)
  document.addEventListener("copy", function () {
    var s = String(window.getSelection ? window.getSelection() : "").trim();
    if (s) track("copy", { text: s.slice(0, 80) });
  });

  // Broken things
  // A file that didn't load (photo, font, script) is logged with its address. Only our own photos and
  // scripts count as problems ("load_error"); blocked add-ons like Cloudflare's analytics beacon (ad
  // blockers) and preloaded fonts (iPhone Lockdown Mode, data saver) are harmless ("blocked_load").
  window.addEventListener("error", function (e) {
    var el = e.target;
    if (el && el !== window && el.tagName) {
      var url = String(el.currentSrc || el.src || el.href || ""), tag = el.tagName.toLowerCase();
      var ours = url.indexOf(location.origin) === 0 || url.charAt(0) === "/";
      var harmless = !ours || (tag === "link" && el.rel === "preload");
      track(harmless ? "blocked_load" : "load_error", { tag: tag, url: url.slice(0, 200) });
      return;
    }
    track("js_error", { msg: String(e.message || "error").slice(0, 200), src: String(e.filename || "").slice(0, 120), line: e.lineno, col: e.colno });
  }, true);
})();
