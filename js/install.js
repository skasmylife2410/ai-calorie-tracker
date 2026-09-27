// install.js — "add SnapCal to your Home Screen": which phone this is, whether the app is already
// installed, and Android Chrome's own install prompt when the browser offers one.
//
// Chrome fires `beforeinstallprompt` once, early, and only if the page catches it can a button
// show the real "Install app" dialog later. This module is imported at startup (app.js) so the
// event is never missed; onboarding then offers the button. iPhones have no such prompt: Safari
// only installs through Share → Add to Home Screen, so there the step shows how.

let deferredPrompt = null;
const listeners = new Set();

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // keep Chrome's own mini-bar away; onboarding offers the button instead
    deferredPrompt = e;
    listeners.forEach((fn) => fn());
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    listeners.forEach((fn) => fn());
  });
}

/** Opened from the Home Screen icon (or installed as an app) rather than in a browser tab. */
export function isStandalone() {
  return Boolean(globalThis.matchMedia?.("(display-mode: standalone)")?.matches || globalThis.navigator?.standalone === true);
}

/** "ios" | "android" | "other" */
export function platform(ua = globalThis.navigator?.userAgent ?? "", touch = globalThis.navigator?.maxTouchPoints ?? 0, plat = globalThis.navigator?.platform ?? "") {
  if (/android/i.test(ua)) return "android";
  if (/iphone|ipad|ipod/i.test(ua)) return "ios";
  if (/macintosh/i.test(ua) && plat === "MacIntel" && touch > 1) return "ios"; // iPadOS reports as a Mac
  return "other";
}

/** Which browser on the phone, for the right wording: "safari" | "chrome" | "samsung" | "other". */
export function browser(ua = globalThis.navigator?.userAgent ?? "") {
  if (/SamsungBrowser/i.test(ua)) return "samsung";
  if (/CriOS|Chrome/i.test(ua) && !/Edg/i.test(ua)) return "chrome";
  if (/Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS/i.test(ua)) return "safari";
  return "other";
}

export const canPromptInstall = () => deferredPrompt !== null;

/** Shows Chrome's install dialog. Resolves true if the person installed. */
export async function promptInstall() {
  if (!deferredPrompt) return false;
  const e = deferredPrompt;
  deferredPrompt = null;
  e.prompt();
  const choice = await e.userChoice.catch(() => null);
  listeners.forEach((fn) => fn());
  return choice?.outcome === "accepted";
}

/** Called when the install offer appears or goes away; returns an unsubscribe function. */
export function onInstallChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Small pictures of the buttons people need to find, drawn to match what the phone shows.
export const SHARE_ICON = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12"/><path d="M8 7l4-4 4 4"/><path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1"/></svg>`;
export const ADD_ICON = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M12 8v8M8 12h8"/></svg>`;
export const MENU_ICON = `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>`;
export const PHONE_ICON = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><rect x="6" y="2.5" width="12" height="19" rx="3"/><path d="M11 18.5h2"/></svg>`;
