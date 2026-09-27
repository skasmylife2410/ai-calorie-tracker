// privacy.js — language switch for privacy.html (no inline scripts: the site's CSP forbids them).
// Starts in the app's language (snapcal.lang), else ?lang=, else the phone's.
const blocks = document.querySelectorAll("[data-lang-block]");
const buttons = document.querySelectorAll("[data-lang]");

function show(lang) {
  blocks.forEach((b) => { b.hidden = b.dataset.langBlock !== lang; });
  buttons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.lang === lang)));
  document.documentElement.lang = lang;
  document.title = lang === "es" ? "Privacidad y términos · SnapCal" : "Privacy & Terms · SnapCal";
}

let saved = "";
try { saved = localStorage.getItem("snapcal.lang") || ""; } catch { /* private mode */ }
const asked = new URLSearchParams(location.search).get("lang") || saved || navigator.language || "en";
show(asked.toLowerCase().startsWith("es") ? "es" : "en");
buttons.forEach((b) => b.addEventListener("click", () => show(b.dataset.lang)));
