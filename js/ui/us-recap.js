// us-recap.js — your Friday recommendation at the top of Us. Private: it's fetched for the
// signed-in person only, and the meal photos come from this phone's own log, never the server.

import { myRecap } from "../social.js";
import * as store from "../store.js";
import { t, formatNumber } from "../i18n.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Hiding is per-phone and per-week: the key carries the week, so next Friday's
// check-in comes back on its own without anything to un-hide.
const HIDE_PREFIX = "snapcal.recapHidden.";

/** True when this phone has hidden the check-in for the week starting `weekStart`. */
export function recapHidden(weekStart) {
  if (!weekStart) return false;
  try {
    return localStorage.getItem(HIDE_PREFIX + weekStart) === "1";
  } catch {
    return false; // private mode, storage blocked: show the card rather than lose it
  }
}

/** Hide this week's check-in on this phone, and sweep away older weeks' keys. */
export function hideRecap(weekStart) {
  if (!weekStart) return;
  try {
    localStorage.setItem(HIDE_PREFIX + weekStart, "1");
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k?.startsWith(HIDE_PREFIX) && k !== HIDE_PREFIX + weekStart) localStorage.removeItem(k);
    }
  } catch {
    /* nothing to do: hiding is a convenience, never load-bearing */
  }
}

/** "Sat, Sep 19" / "sáb, 19 sept" for a YYYY-MM-DD day, in the app language. */
export function shortDay(day, lang = "en", withMonth = false) {
  const d = new Date(`${day}T12:00:00Z`);
  const opts = { weekday: "short", day: "numeric", timeZone: "UTC", ...(withMonth ? { month: "short" } : {}) };
  return new Intl.DateTimeFormat(lang === "es" ? "es-CO" : "en-US", opts).format(d);
}

/** One line per stat that has something to say; missing targets are left out rather than guessed. */
export function statLines(stats) {
  const lines = [];
  if (stats.targetCalories) lines.push(t("recap.statKcal", { avg: formatNumber(stats.avgCalories), target: formatNumber(stats.targetCalories) }));
  else lines.push(t("recap.statKcalNoTarget", { avg: formatNumber(stats.avgCalories) }));
  if (stats.targetProteinG) lines.push(t("recap.statProtein", { avg: formatNumber(stats.avgProteinG), target: formatNumber(stats.targetProteinG) }));
  lines.push(t("recap.statDays", { n: stats.daysLogged }));
  if (stats.weightChangeKg != null) lines.push(t("recap.statWeight", { kg: formatNumber(stats.weightChangeKg, { signDisplay: "exceptZero", maximumFractionDigits: 1 }) }));
  return lines;
}

function mealHtml(meal, lang) {
  const entry = store.getFoodEntry?.(meal.id);
  const photo = entry?.photoDataUrl;
  const day = esc(shortDay(meal.day, lang));
  const kcal = `${formatNumber(meal.calories)} kcal`;
  return photo
    ? `<figure class="rc-meal"><img src="${photo}" alt="${esc(meal.name)}" loading="lazy"><figcaption>${day}<br>${kcal}</figcaption></figure>`
    : `<div class="rc-chip"><span class="rc-chip-name">${esc(meal.name)}</span><span class="rc-chip-meta">${day}, ${kcal}</span></div>`;
}

export async function renderRecap(host, { lang = "en" } = {}) {
  host.innerHTML = "";
  const out = await myRecap(lang);
  if (!out?.ok) return; // stays out of the way when offline or unconfigured
  const r = out.recap;
  if (!r) {
    host.innerHTML = `<div class="rc-card rc-quiet"><h2 class="rc-title">${t("recap.title")}</h2><p class="rc-body">${t("recap.none")}</p></div>`;
    return;
  }
  const stats = r.stats ?? {};
  if (!stats.enough || !r.tips?.length) {
    host.innerHTML = `<div class="rc-card rc-quiet"><h2 class="rc-title">${t("recap.title")}</h2><p class="rc-body">${t("recap.notEnough", { n: stats.daysLogged ?? 0 })}</p></div>`;
    return;
  }
  if (recapHidden(r.weekStart)) return; // hidden on this phone for this week
  host.innerHTML = `
    <div class="rc-card">
      <button type="button" class="rc-hide" aria-label="${esc(t("recap.hide"))}" title="${esc(t("recap.hide"))}">&times;</button>
      <h2 class="rc-title">${t("recap.title")}</h2>
      <p class="rc-range">${t("recap.range", { from: esc(shortDay(r.weekStart, lang, true)), to: esc(shortDay(r.weekEnd, lang, true)) })} <span class="rc-private">🔒 ${t("recap.private")}</span></p>
      <p class="rc-headline">${esc(r.headline)}</p>
      <ul class="rc-stats">${statLines(stats).map((l) => `<li>${esc(l)}</li>`).join("")}</ul>
      <ol class="rc-tips">
        ${r.tips.map((tip) => `
          <li class="rc-tip">
            <div class="rc-tip-title">${esc(tip.title)}</div>
            <p class="rc-body">${esc(tip.body)}</p>
            ${tip.meals?.length ? `<div class="rc-meals">${tip.meals.map((m) => mealHtml(m, lang)).join("")}</div>` : ""}
          </li>`).join("")}
      </ol>
    </div>`;
  host.querySelector(".rc-hide")?.addEventListener("click", () => {
    hideRecap(r.weekStart);
    host.innerHTML = `<p class="rc-hidden-note">${esc(t("recap.hiddenNote"))}</p>`;
    setTimeout(() => { if (host.querySelector(".rc-hidden-note")) host.innerHTML = ""; }, 4000);
  });
}
