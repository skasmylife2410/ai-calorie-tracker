// sw.js — minimal service worker: network-first for everything, cache-fallback for the app
// shell, enough for PWA installability. Bump CACHE_VERSION to bust caches on deploy.

const CACHE_VERSION = "snapcal-v50";
const STALL_MS = 3000; // how long a page or file may wait on the network before the cached copy is used
const STALLED_FOR_MS = 30000; // after one stall, cached files are served at once for this long
let stalledUntil = 0;

const APP_SHELL = [
  "/i18n/en.json",
  "/i18n/es.json",
  "/",
  "/index.html",
  "/css/theme.css",
  "/css/app.css",
  "/css/mono.css",
  "/vendor/fonts/doto/doto-latin-900-normal.woff2",
  "/js/theme.js",
  "/js/sounds.js",
  "/js/mood.js",
  "/js/ui/missed-you.js",
  "/js/theme-boot.js",
  "/js/boot-guard.js",
  "/js/app.js",
  "/js/intro.js",
  "/vendor/fluid-bg/core.js",
  "/js/nutrition.js",
  "/js/store.js",
  "/js/resize.js",
  "/js/api.js",
  "/js/queue.js",
  "/js/ui/icons.js",
  "/js/ui/ring.js",
  "/js/ui/sheet.js",
  "/js/ui/action-sheet.js",
  "/js/ui/entry-row.js",
  "/js/ui/food-icons.js",
  "/js/ui/share-summary.js",
  "/js/gif.js",
  "/js/ui/undo-delete.js",
  "/js/ui/home-gif.js",
  "/js/ui/questions.js",
  "/js/ui/crop.js",
  "/js/cooking-fat.js",
  "/js/ui/gif-picker.js",
  "/js/diets.js",
  "/js/ui/install-guide.js",
  "/js/ui/numeric-field.js",
  "/js/ui/formfields.js",
  "/js/ui/today.js",
  "/js/ui/history.js",
  "/js/ui/profile.js",
  "/js/ui/onboarding.js",
  "/js/ui/addfood.js",
  "/js/ui/search.js",
  "/js/ui/saved.js",
  "/js/ui/describe.js",
  "/js/ui/scan.js",
  "/js/ui/results.js",
  "/vendor/barcode-detector-polyfill.js",
  "/vendor/zbar-wasm/main.js",
  "/vendor/zbar-wasm/zbar.wasm",
  "/manifest.webmanifest",
  "/icons/icon-192-v2.png",
  "/icons/icon-512-v2.png",
  "/icons/apple-touch-icon-v2.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return; // POST /api/gemini etc. always hit the network
  if (new URL(request.url).origin !== self.location.origin) return; // GIFs from GIPHY: the browser's own cache
  if (new URL(request.url).pathname.startsWith("/api/")) return; // live data, never the shell cache

  // Network-first, cache-fallback (fresh code wins; offline still boots the shell). A connection
  // that stalls instead of failing (weak signal, a captive Wi-Fi page) used to hold the app on a
  // blank screen for as long as it stalled, so after STALL_MS a cached copy is served instead;
  // the network answer still lands in the cache for next time.
  const network = fetch(request).then((response) => {
    if (response.ok && new URL(request.url).origin === self.location.origin) {
      const clone = response.clone();
      caches.open(CACHE_VERSION).then((cache) => cache.put(request, clone));
    }
    return response;
  });
  const fallback = () =>
    caches.match(request).then((cached) => cached || (request.mode === "navigate" ? caches.match("/index.html") : undefined));
  // The app's files load in waves (page, then scripts, then what they import); once the network
  // has stalled, each wave shouldn't wait out its own timer too.
  const wait = Date.now() < stalledUntil ? 0 : STALL_MS;
  event.respondWith(
    new Promise((resolve) => {
      let done = false;
      const finish = (r) => { if (!done && r) { done = true; resolve(r); } };
      const timer = setTimeout(() => {
        fallback().then((r) => { if (r && wait > 0) stalledUntil = Date.now() + STALLED_FOR_MS; finish(r); });
      }, wait);
      network
        .then((r) => { clearTimeout(timer); if (!done) stalledUntil = 0; finish(r); })
        .catch(() => { clearTimeout(timer); fallback().then((r) => finish(r || Response.error())); });
    })
  );
  event.waitUntil(network.catch(() => {}));
});

// ---------------------------------------------------------------------------
// Push notifications (api/_push.js sends them). iPhones require every push to show a
// notification, so this always shows one — never a silent push.
// ---------------------------------------------------------------------------

self.addEventListener("push", (event) => {
  let msg = {};
  try { msg = event.data ? event.data.json() : {}; } catch { msg = { body: event.data?.text?.() ?? "" }; }
  const title = msg.title || "SnapCal";
  const options = {
    body: msg.body || "",
    icon: "/icons/icon-192-v2.png",
    badge: "/icons/icon-192-v2.png",
    tag: msg.tag || undefined,
    renotify: Boolean(msg.tag),
    data: { url: msg.url || "/" },
  };
  event.waitUntil(Promise.all([
    self.registration.showNotification(title, options),
    // red dot on the home-screen icon until the app is opened (where supported)
    self.navigator?.setAppBadge?.(1)?.catch?.(() => {}),
  ]));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil((async () => {
    const open = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const client = open.find((c) => new URL(c.url).origin === self.location.origin);
    if (client) {
      // app already running: tell it where to go instead of reloading it
      client.postMessage({ type: "snapcal:open", url });
      return client.focus();
    }
    return self.clients.openWindow(url);
  })());
});
