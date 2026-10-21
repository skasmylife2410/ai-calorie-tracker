// ate-same.js — "I ate the same" on someone's shared breakfast, lunch, dinner or snack: before it
// goes into your day you can leave out what you didn't have, change how much of each food, and
// file it under another mealtime. Each food then lands in your log as its own meal, at the time
// they shared it (you ate together), under the mealtime you picked.

import { t, formatNumber } from "../i18n.js";
import { openSheet, navBar, wireNavBar } from "./sheet.js";
import { icon } from "./icons.js";
import { mealTypeChoicesHtml } from "./meal-type.js";
import { chosenFoods, logMealtimeFoods, totalsOf, PORTIONS } from "../mealtime.js";
import { MEAL_TYPES } from "../nutrition.js";
import { foodIconSvg, categoryOfName } from "./food-icons.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const PORTION_LABEL = { 0.5: "½", 1: "1×", 2: "2×" };

/** Whether a post is a whole mealtime someone can copy (and so gets this sheet). */
export const isMealtimePost = (s) => s?.kind === "meal" && MEAL_TYPES.includes(s.data?.mealType) && Array.isArray(s.data?.items) && s.data.items.length > 0;

/** When it goes in your log: the time they shared it, or now if their clock was ahead. */
export function ateTogetherAt(share, now = Date.now()) {
  const at = Date.parse(share.created_at);
  return Number.isFinite(at) && at <= now ? at : now;
}

/**
 * Opens the sheet for a shared mealtime. Resolves with how many foods were added (0 if it was
 * cancelled) and the mealtime they went under. `who` is the name of the person who shared it.
 */
export function openAteSameSheet(share, { who = "", now = Date.now() } = {}) {
  const foods = share.data.items;
  return new Promise((resolve) => {
    let added = 0;
    let type = share.data.mealType;
    const picks = foods.map(() => ({ on: true, f: 1 }));
    openSheet({
      onClosed: () => resolve({ added, mealType: type }),
      render(panel, close) {
        const draw = () => {
          const chosen = chosenFoods(foods, picks);
          const total = totalsOf(chosen);
          const meal = t(`mealType.lower.${type}`);
          panel.innerHTML = `
            ${navBar({ title: t("social.logThis"), leading: { label: t("app.cancel") } })}
            <div class="sheet-panel-body as-body">
              <div class="as-head"><b>${t("ateSame.whose", { name: esc(who), meal: t(`mealType.lower.${share.data.mealType}`) })}</b><small>${t("ateSame.hint")}</small></div>
              <div class="shm-label">${t("ateSame.fileUnder")}</div>
              <div class="mt-choices as-types" role="group" aria-label="${t("ateSame.fileUnder")}">${mealTypeChoicesHtml(type)}</div>
              <ul class="as-foods">
                ${foods.map((f, i) => {
                  const p = picks[i];
                  const kcal = Math.round(f.calories * p.f);
                  const grams = Math.round((Number(f.gramsEstimate) || 0) * p.f);
                  return `
                  <li class="as-food${p.on ? "" : " is-off"}" data-i="${i}">
                    <button type="button" class="as-check" role="checkbox" aria-checked="${p.on}" aria-label="${esc(f.name)}">${p.on ? icon("checkmark", { size: 14 }) : ""}</button>
                    <span class="as-glyph" aria-hidden="true">${foodIconSvg(categoryOfName(f.name) ?? "plate", { size: 20 })}</span>
                    <span class="as-name"><b>${esc(f.name)}</b><small>${grams > 0 ? `${formatNumber(grams)} g · ` : ""}${formatNumber(kcal)} kcal</small></span>
                    <span class="mt-choices as-portions" role="group" aria-label="${t("ateSame.portion")}">${PORTIONS.map((q) => `<button type="button" class="mt-choice" data-f="${q}" aria-pressed="${q === p.f}">${PORTION_LABEL[q]}</button>`).join("")}</span>
                  </li>`;
                }).join("")}
              </ul>
              <div class="as-total"><b>${formatNumber(total.calories)}</b> kcal · ${t("ateSame.count", { n: chosen.length, of: foods.length })}</div>
              <button type="button" class="acct-btn is-primary as-go" ${chosen.length ? "" : "disabled"}>${chosen.length ? t("ateSame.add", { meal }) : t("ateSame.pickOne")}</button>
            </div>`;
          wireNavBar(panel, { onLeading: close });
          panel.querySelectorAll(".as-types [data-meal-type]").forEach((b) => b.addEventListener("click", () => { type = b.dataset.mealType; draw(); }));
          panel.querySelectorAll(".as-food").forEach((li) => {
            const i = Number(li.dataset.i);
            li.querySelector(".as-check").addEventListener("click", () => { picks[i].on = !picks[i].on; draw(); });
            li.querySelectorAll("[data-f]").forEach((b) => b.addEventListener("click", () => { picks[i].f = Number(b.dataset.f); draw(); }));
          });
          panel.querySelector(".as-go").addEventListener("click", () => {
            added = logMealtimeFoods(chosen, { mealType: type, timestamp: ateTogetherAt(share, now) }).length;
            close();
          });
        };
        draw();
      },
    });
  });
}
