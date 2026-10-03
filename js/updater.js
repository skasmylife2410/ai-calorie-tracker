// updater.js — keeps an open SnapCal on the newest version without anyone doing anything.
//
// A Home Screen app can stay alive in the background for days, so "close it and open it again"
// is how people ended up on old code. Instead: remember which deployment this page started on
// (GET /api/auth?op=version), ask again whenever the app comes back to the front and every few
// minutes, and when it has changed, reload — but only at a moment that loses nothing:
//   - found on coming back to the app: straight away (it looks like the app just opened),
//   - found while someone is using it: at the next tab switch or when the app goes to the
//     background, so a screen they're reading never jumps,
//   - and never with a sheet, the camera or half-typed text open.
// After the reload a small "Updated" note shows once.

const CHECK_EVERY_MS = 10 * 60 * 1000;
const MIN_GAP_MS = 60 * 1000;      // coming back to the app checks at most once a minute
const SAFE_RETRY_MS = 5 * 1000;    // waiting for a safe moment
const UPDATED_FLAG = "snapcal.justUpdated";

let bootVersion = null;
let lastCheck = 0;
let pending = false;
let retryTimer = null;
let beforeReload = null;

async function fetchVersion() {
  try {
    const res = await fetch("/api/auth?op=version", { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json())?.version ?? null;
  } catch {
    return null; // offline: try again later
  }
}

/** True when reloading now would interrupt nothing. */
export function safeToReload(doc = globalThis.document) {
  if (!doc) return false;
  // Sharing hands a file to another app, which reads it after SnapCal goes to the background;
  // reloading then would empty the share. Wait until it's done, hidden or not.
  if ((globalThis.__snapcalBusyUntil ?? 0) > Date.now()) return false;
  if (doc.visibilityState === "hidden") return true;
  if (doc.querySelector(".sheet-panel, .fullscreen-cover, .auth-screen, .onb")) return false;
  const el = doc.activeElement;
  if (el && (el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && !["button", "checkbox", "radio"].includes(el.type)))) return false;
  if ([...doc.querySelectorAll("input[type=text], input[type=number], input:not([type]), textarea")].some((i) => i.value && i.value.trim() !== "" && i.offsetParent !== null)) return false;
  return true;
}

/**
 * The app's files come from the service worker's cache, one complete set per deploy. Before
 * reloading for an update, let the new worker finish downloading its set (up to a few seconds),
 * so the reload opens the new version instead of the old one again.
 */
async function freshFilesReady(maxMs = 10000) {
  const sw = globalThis.navigator?.serviceWorker;
  if (!sw?.getRegistration) return;
  const reg = await sw.getRegistration().catch(() => null);
  if (!reg) return;
  await reg.update().catch(() => {});
  const incoming = reg.installing || reg.waiting;
  if (!incoming) return;
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, maxMs);
    const settle = () => {
      if (incoming.state === "activated" || incoming.state === "redundant") { clearTimeout(timer); resolve(); }
    };
    incoming.addEventListener("statechange", settle);
    settle();
  });
}

let reloading = false;
function reloadWhenSafe() {
  clearTimeout(retryTimer);
  if (reloading) return;
  if (safeToReload()) {
    reloading = true;
    freshFilesReady().finally(() => {
      reloading = false;
      if (!safeToReload()) { retryTimer = setTimeout(reloadWhenSafe, SAFE_RETRY_MS); return; }
      try { sessionStorage.setItem(UPDATED_FLAG, "1"); } catch { /* private mode */ }
      try { beforeReload?.(); } catch { /* never block the update */ }
      location.reload();
    });
    return;
  }
  retryTimer = setTimeout(reloadWhenSafe, SAFE_RETRY_MS);
}

async function check({ force = false, immediate = false } = {}) {
  if (pending) return immediate ? reloadWhenSafe() : undefined;
  if (!force && Date.now() - lastCheck < MIN_GAP_MS) return;
  lastCheck = Date.now();
  navigator.serviceWorker?.getRegistration?.().then((reg) => reg?.update()).catch(() => {});
  const v = await fetchVersion();
  if (!v) return;
  if (bootVersion === null) { bootVersion = v; return; }
  if (v !== bootVersion) {
    pending = true;
    if (immediate) reloadWhenSafe();
  }
}

/** True when a newer version is waiting to be applied (for diagnostics). */
export const updatePending = () => pending;

/** A natural pause (switching tabs): apply a waiting update now if nothing would be lost. */
export function applyIfPending() {
  if (pending && safeToReload()) reloadWhenSafe();
}

/** Starts watching for new versions. Call once, after the app has drawn. */
export function startAutoUpdate({ onUpdated, onBeforeReload } = {}) {
  beforeReload = onBeforeReload ?? null;
  try {
    if (sessionStorage.getItem(UPDATED_FLAG) === "1") {
      sessionStorage.removeItem(UPDATED_FLAG);
      onUpdated?.();
    }
  } catch { /* private mode */ }
  check({ force: true });
  setInterval(() => check({ force: true }), CHECK_EVERY_MS);
  document.addEventListener("visibilitychange", () => {
    // going to the background is the perfect moment to apply a waiting update
    if (document.visibilityState === "hidden" && pending) return reloadWhenSafe();
    if (document.visibilityState === "visible") check({ immediate: true });
  });
  window.addEventListener("focus", () => check({ immediate: true }));
  window.addEventListener("online", () => check({ force: true }));
}
