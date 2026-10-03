// sw.js — the app's offline copy. Every deploy bumps CACHE_VERSION, so the phone installs a new
// worker that downloads the whole APP_SHELL (every file the app can load) into a fresh cache, then
// takes over at once. The app's files are served from that cache first: opening the app no longer
// waits on the network for ~100 files, and all files always come from the same deploy.
// The page itself (index.html) is still network-first, so it's always current.

const CACHE_VERSION = "snapcal-v54";
const STALL_MS = 3000; // how long a page or file may wait on the network before the cached copy is used
const STALLED_FOR_MS = 30000; // after one stall, cached files are served at once for this long
let stalledUntil = 0;

const APP_SHELL = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/i18n/en.json",
  "/i18n/es.json",
  "/css/app.css",
  "/css/mono.css",
  "/css/privacy.css",
  "/css/theme.css",
  "/css/us.css",
  "/js/api.js",
  "/js/app.js",
  "/js/bodyfat.js",
  "/js/boot-guard.js",
  "/js/cooking-fat.js",
  "/js/diets.js",
  "/js/foods-local.js",
  "/js/gif.js",
  "/js/i18n.js",
  "/js/install.js",
  "/js/intro.js",
  "/js/meal-builder.js",
  "/js/mood.js",
  "/js/myths.js",
  "/js/net.js",
  "/js/nutrition.js",
  "/js/privacy.js",
  "/js/progress.js",
  "/js/push.js",
  "/js/queue.js",
  "/js/resize.js",
  "/js/safe-src.js",
  "/js/social.js",
  "/js/sounds.js",
  "/js/store.js",
  "/js/sync.js",
  "/js/theme-boot.js",
  "/js/theme.js",
  "/js/tips.js",
  "/js/updater.js",
  "/js/us.js",
  "/js/ui/action-sheet.js",
  "/js/ui/addfood.js",
  "/js/ui/crop.js",
  "/js/ui/day-meals.js",
  "/js/ui/describe.js",
  "/js/ui/doodle-messages.js",
  "/js/ui/doodle.js",
  "/js/ui/entry-row.js",
  "/js/ui/exercise.js",
  "/js/ui/favourites.js",
  "/js/ui/food-icons.js",
  "/js/ui/formfields.js",
  "/js/ui/gif-picker.js",
  "/js/ui/history.js",
  "/js/ui/home-card.js",
  "/js/ui/home-gif.js",
  "/js/ui/icons.js",
  "/js/ui/install-guide.js",
  "/js/ui/login.js",
  "/js/ui/meal-drag.js",
  "/js/ui/micros.js",
  "/js/ui/missed-you.js",
  "/js/ui/nano-doodle.js",
  "/js/ui/numeric-field.js",
  "/js/ui/onboarding.js",
  "/js/ui/passcode.js",
  "/js/ui/photo-doodle.js",
  "/js/ui/portion-plate.js",
  "/js/ui/profile.js",
  "/js/ui/push-ui.js",
  "/js/ui/questions.js",
  "/js/ui/recipes.js",
  "/js/ui/results.js",
  "/js/ui/ring.js",
  "/js/ui/scan.js",
  "/js/ui/search.js",
  "/js/ui/share-summary.js",
  "/js/ui/shared-tab.js",
  "/js/ui/sheet.js",
  "/js/ui/sky.js",
  "/js/ui/today-meals.js",
  "/js/ui/today.js",
  "/js/ui/undo-delete.js",
  "/js/ui/us-recap.js",
  "/js/ui/us-social.js",
  "/js/ui/voice.js",
  "/js/ui/weight.js",
  "/vendor/fonts/doto/doto-latin-900-normal.woff2",
  "/vendor/fluid-bg/core.js",
  "/vendor/barcode-detector-polyfill.js",
  "/vendor/zbar-wasm/main.js",
  "/vendor/zbar-wasm/zbar.wasm",
  "/icons/icon-192-v2.png",
  "/icons/icon-512-v2.png",
  "/icons/apple-touch-icon-v2.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      // straight from the server, never an older copy the browser kept
      .then((cache) => cache.addAll(APP_SHELL.map((url) => new Request(url, { cache: "reload" }))))
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

  // The app's own files: from this deploy's cache, and the network only for anything not in it.
  if (request.mode !== "navigate") {
    event.respondWith(
      caches.open(CACHE_VERSION).then((cache) =>
        cache.match(request, { ignoreSearch: true }).then((cached) => cached || fetch(request).then((response) => {
          if (response.ok) cache.put(request, response.clone());
          return response;
        }))
      )
    );
    return;
  }

  // Pages: network-first, cache-fallback. A connection that stalls instead of failing (weak
  // signal, a captive Wi-Fi page) used to hold the app on a blank screen for as long as it
  // stalled, so after STALL_MS the cached page is served instead.
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
