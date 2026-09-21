// i18n.js — tiny translation layer. Strings live in i18n/en.json and i18n/es.json and are
// fetched once at boot; t("key", {vars}) returns the string for the active language.
//
// Language is PER PERSON and stored with the profile, so Aelson can run English on his phone
// while she runs Spanish on hers, even though both share the same deployment. Default comes from
// the phone's own language setting.
//
// Number and date formatting go through the same language, so Spanish gets 1.240 and "vie 12".

const SUPPORTED = ["en", "es"];
const STORAGE_KEY = "snapcal.lang";
const FALLBACK = "en";

let current = FALLBACK;
let bundles = { en: {}, es: {} };
const listeners = new Set();

/** The phone's language, if we support it. */
export function deviceLanguage() {
  const raw = (typeof navigator !== "undefined" && (navigator.language || navigator.languages?.[0])) || FALLBACK;
  const short = String(raw).slice(0, 2).toLowerCase();
  return SUPPORTED.includes(short) ? short : FALLBACK;
}

export function currentLanguage() {
  return current;
}

export function supportedLanguages() {
  return [...SUPPORTED];
}

export function onLanguageChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Loads both bundles and picks the stored language, else the phone's. */
export async function initI18n({ stored } = {}) {
  const chosen = SUPPORTED.includes(stored) ? stored : readStored() ?? deviceLanguage();
  await loadBundles();
  current = chosen;
  return current;
}

export async function setLanguage(lang) {
  if (!SUPPORTED.includes(lang)) return current;
  current = lang;
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, lang);
  } catch {
    /* private mode — language just won't persist */
  }
  for (const fn of listeners) {
    try { fn(lang); } catch { /* a listener must not break language switching */ }
  }
  return current;
}

function readStored() {
  try {
    const v = globalThis.localStorage?.getItem(STORAGE_KEY);
    return SUPPORTED.includes(v) ? v : null;
  } catch {
    return null;
  }
}

async function loadBundles() {
  await Promise.all(
    SUPPORTED.map(async (lang) => {
      try {
        const res = await fetch(`/i18n/${lang}.json`);
        if (res.ok) bundles[lang] = await res.json();
      } catch {
        // Offline on first run: English strings are also inlined as keys' fallbacks, so the app
        // still reads sensibly rather than showing raw keys.
      }
    })
  );
}

/** For tests and for the server: inject bundles directly. */
export function setBundles(next) {
  bundles = { ...bundles, ...next };
}

/**
 * t("home.caloriesLeft") -> "Calories left"
 * t("us.mealsCount", { n: 2 }) -> "2 meals"  (plural rules via |, see below)
 *
 * A value may contain {placeholders}. For plurals write "one form|other form" and pass {n};
 * the first form is used when n === 1.
 */
export function t(key, vars = {}) {
  const raw = lookup(current, key) ?? lookup(FALLBACK, key) ?? key;
  const chosen = pickPlural(raw, vars.n);
  return chosen.replace(/\{(\w+)\}/g, (_, name) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? formatVar(vars[name]) : `{${name}}`
  );
}

function pickPlural(raw, n) {
  if (typeof raw !== "string" || !raw.includes("|") || n === undefined) return raw;
  const [one, other] = raw.split("|");
  return Number(n) === 1 ? one : other;
}

function formatVar(v) {
  return typeof v === "number" ? formatNumber(v) : String(v);
}

function lookup(lang, key) {
  const parts = String(key).split(".");
  let node = bundles[lang];
  for (const part of parts) {
    if (node == null || typeof node !== "object") return null;
    node = node[part];
  }
  return typeof node === "string" ? node : null;
}

// --- formatting --------------------------------------------------------------

export function formatNumber(n, opts = {}) {
  return new Intl.NumberFormat(current, opts).format(Number(n) || 0);
}

export function formatDate(date, opts = { weekday: "long", month: "short", day: "numeric" }) {
  return new Intl.DateTimeFormat(current, opts).format(date instanceof Date ? date : new Date(date));
}

/** Short weekday names starting Monday, for the week strip. */
export function weekdayLabels() {
  const fmt = new Intl.DateTimeFormat(current, { weekday: "short" });
  // 2024-01-01 was a Monday
  return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(Date.UTC(2024, 0, 1 + i))));
}
