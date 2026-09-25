// sw.js — minimal service worker: network-first for everything, cache-fallback for the app
// shell, enough for PWA installability. Bump CACHE_VERSION to bust caches on deploy.

const CACHE_VERSION = "snapcal-v3";

const APP_SHELL = [
  "/i18n/en.json",
  "/i18n/es.json",
  "/",
  "/index.html",
  "/css/theme.css",
  "/css/app.css",
  "/js/app.js",
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
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon.png",
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

  // Network-first, cache-fallback (fresh code wins; offline still boots the shell).
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok && new URL(request.url).origin === self.location.origin) {
          const clone = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(() =>
        caches.match(request).then((cached) => {
          if (cached) return cached;
          if (request.mode === "navigate") return caches.match("/index.html");
          return Response.error();
        })
      )
  );
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
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
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
