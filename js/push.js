// push.js — turning notifications on and off on this phone (server side: api/_push.js,
// ops in api/notes.js).
//
// iPhones only allow web push for apps opened from the home-screen icon (iOS 16.4+), and only
// ask for permission right after a tap — so enable() must be called from a click handler.

import { apiFetch } from "./net.js";
import { currentLanguage } from "./i18n.js";

const DISMISS_KEY = "snapcal.pushCardDismissed";

async function post(body) {
  try {
    const res = await apiFetch("/api/notes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return await res.json();
  } catch {
    return { ok: false, errorType: "network" };
  }
}

const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isStandalone = () => window.matchMedia?.("(display-mode: standalone)")?.matches || navigator.standalone === true;

/**
 * "on" | "off" | "denied" | "needsInstall" (iPhone in a Safari tab) | "unsupported"
 */
export async function pushState() {
  if (!("serviceWorker" in navigator)) return "unsupported";
  if (!("PushManager" in window) || !("Notification" in window)) return isIos() && !isStandalone() ? "needsInstall" : "unsupported";
  if (Notification.permission === "denied") return "denied";
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    return sub && Notification.permission === "granted" ? "on" : "off";
  } catch {
    return "off";
  }
}

function keyBytes(b64url) {
  const pad = "=".repeat((4 - (b64url.length % 4)) % 4);
  const raw = atob((b64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

let keyPromise = null;
/** VAPID public key from the server (null until VAPID keys are set in Vercel). Cached per launch. */
export function serverKey() {
  keyPromise ??= post({ op: "pushKey" }).then((o) => (o.ok ? o.key || null : null)).catch(() => null);
  return keyPromise;
}

/** Asks permission and subscribes. Resolves to a pushState() value (or "notReady"). */
export async function enablePush() {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "denied" : "off";
  const key = await serverKey();
  if (!key) return "notReady"; // server keys not set yet
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
  const saved = await post({ op: "pushSubscribe", sub: sub.toJSON(), lang: currentLanguage() === "es" ? "es" : "en" });
  return saved.ok ? "on" : "off";
}

export async function disablePush() {
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await post({ op: "pushUnsubscribe", endpoint: sub.endpoint });
      await sub.unsubscribe();
    }
  } catch {
    // best effort
  }
  return "off";
}

/**
 * On app start: if this phone is subscribed, re-send it so the server has the current
 * language and account (a phone that switched accounts moves to the new one).
 */
export async function refreshPush() {
  if ((await pushState()) !== "on") return;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) await post({ op: "pushSubscribe", sub: sub.toJSON(), lang: currentLanguage() === "es" ? "es" : "en" });
}

export function clearBadge() {
  try { navigator.clearAppBadge?.()?.catch?.(() => {}); } catch {}
}

export function pushCardDismissed() {
  try { return localStorage.getItem(DISMISS_KEY) === "1"; } catch { return false; }
}

export function dismissPushCard() {
  try { localStorage.setItem(DISMISS_KEY, "1"); } catch {}
}

/** Admin only: send a "what's new" notification to everyone (test:true = only to yourself). */
export const announce = (title, body, test = false) => post({ op: "announce", title, body, test });
