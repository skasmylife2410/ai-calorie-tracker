// ate-same.js — "Add to my day" on someone's shared meal, or their whole breakfast, lunch, dinner
// or snack: before it goes into your day you can leave out what you didn't have, change how much
// of each food, file it under another mealtime, and say when you ate it. A whole mealtime lands as
// one meal per food; a single shared meal lands as one meal, its foods inside.
//
// When: a post from today goes in at the time they shared it (you ate together); one from an
// earlier day goes in today, now (you're having the same again). Either can be switched.

import { t, formatNumber, formatDate } from "../i18n.js";
import { openSheet, navBar, wireNavBar } from "./sheet.js";
import { icon } from "./icons.js";
import { mealTypeChoicesHtml } from "./meal-type.js";
import { chosenFoods, logMealtimeFoods, totalsOf, PORTIONS } from "../mealtime.js";
import { MEAL_TYPES, mealTypeOf, localDateString } from "../nutrition.js";
import * as store from "../store.js";
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

/** "together" (when they shared it) for a post from today, "now" for one from an earlier day. */
export function ateWhenDefault(share, now = Date.now()) {
  const at = Date.parse(share?.created_at);
  return Number.isFinite(at) && at <= now && localDateString(at) === localDateString(now) ? "together" : "now";
}

/** The timestamp for a "when" choice. */
export const ateAt = (share, when, now = Date.now()) => (when === "together" ? ateTogetherAt(share, now) : now);

/** What the sheet lists: a mealtime's foods, or a single shared meal as one food. */
export function foodsOfShare(share) {
  const d = share?.data ?? {};
  if (isMealtimePost(share)) return d.items;
  return [{
    name: d.name, calories: Number(d.calories) || 0, proteinG: Number(d.proteinG) || 0, carbsG: Number(d.carbsG) || 0, fatG: Number(d.fatG) || 0,
    micros: d.micros ?? null,
    gramsEstimate: (Array.isArray(d.items) ? d.items : []).reduce((a, i) => a + (Number(i?.gramsEstimate) || 0), 0),
  }];
}

/** A single shared meal into your log as one meal, scaled by the portion picked, its foods inside. */
export function logSharedMeal(share, { factor = 1, mealType, timestamp }) {
  const d = share.data ?? {};
  const items = Array.isArray(d.items) && d.items.length ? d.items.map((i) => store.scaleItem(i, factor)) : null;
  const whole = store.scaleItem(foodsOfShare(share)[0], factor);
  return store.addFoodEntry({
    name: d.name, calories: Math.round(whole.calories), proteinG: whole.proteinG, carbsG: whole.carbsG, fatG: whole.fatG,
    micros: whole.micros ?? null, source: "manual", photoDataUrl: d.photo ?? null, analysisItems: items,
    ...(MEAL_TYPES.includes(mealType) ? { mealType } : {}), timestamp,
  }, { quiet: true });
}

/**
 * Opens the sheet for a shared meal or mealtime. Resolves with how many foods were added (0 if it
 * was cancelled) and the mealtime they went under. `who` is the name of the person who shared it.
 */
export function openAteSameSheet(share, { who = "", now = Date.now() } = {}) {
  const whole = isMealtimePost(share);
  const foods = foodsOfShare(share);
  return new Promise((resolve) => {
    let added = 0;
    let when = ateWhenDefault(share, now);
    let type = whole ? share.data.mealType : mealTypeOf({ timestamp: ateAt(share, when, now) });
    let typePicked = whole; // a single meal's mealtime follows "when" until it's picked by hand
    const picks = foods.map(() => ({ on: true, f: 1 }));
    // the choice only matters when "with them" and "now" are more than half an hour apart
    const sharedAt = ateTogetherAt(share, now);
    const askWhen = now - sharedAt > 30 * 60000;
    const sharedLabel = localDateString(sharedAt) === localDateString(now)
      ? formatDate(sharedAt, { hour: "numeric", minute: "2-digit" })
      : formatDate(sharedAt, { weekday: "short", hour: "numeric", minute: "2-digit" });
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
              <div class="as-head"><b>${whole ? t("ateSame.whose", { name: esc(who), meal: t(`mealType.lower.${share.data.mealType}`) }) : t("ateSame.whoseMeal", { name: esc(who) })}</b><small>${t(whole ? "ateSame.hint" : "ateSame.hintOne")}</small></div>
              ${askWhen ? `
              <div class="shm-label">${t("ateSame.when")}</div>
              <div class="mt-choices as-when" role="group" aria-label="${t("ateSame.when")}">
                <button type="button" class="mt-choice" data-when="now" aria-pressed="${when === "now"}">${t("ateSame.now")}</button>
                <button type="button" class="mt-choice" data-when="together" aria-pressed="${when === "together"}">${t("ateSame.together", { when: esc(sharedLabel) })}</button>
              </div>` : ""}
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
              <div class="as-total"><b>${formatNumber(total.calories)}</b> kcal${whole ? ` · ${t("ateSame.count", { n: chosen.length, of: foods.length })}` : ""}</div>
              <button type="button" class="acct-btn is-primary as-go" ${chosen.length ? "" : "disabled"}>${chosen.length ? t("ateSame.add", { meal }) : t("ateSame.pickOne")}</button>
            </div>`;
          wireNavBar(panel, { onLeading: close });
          panel.querySelectorAll(".as-when [data-when]").forEach((b) => b.addEventListener("click", () => {
            when = b.dataset.when;
            if (!typePicked) type = mealTypeOf({ timestamp: ateAt(share, when, now) });
            draw();
          }));
          panel.querySelectorAll(".as-types [data-meal-type]").forEach((b) => b.addEventListener("click", () => { type = b.dataset.mealType; typePicked = true; draw(); }));
          panel.querySelectorAll(".as-food").forEach((li) => {
            const i = Number(li.dataset.i);
            li.querySelector(".as-check").addEventListener("click", () => { picks[i].on = !picks[i].on; draw(); });
            li.querySelectorAll("[data-f]").forEach((b) => b.addEventListener("click", () => { picks[i].f = Number(b.dataset.f); draw(); }));
          });
          panel.querySelector(".as-go").addEventListener("click", () => {
            const timestamp = ateAt(share, when, now);
            added = whole
              ? logMealtimeFoods(chosen, { mealType: type, timestamp }).length
              : (logSharedMeal(share, { factor: picks[0].f, mealType: type, timestamp }) ? 1 : 0);
            close();
          });
        };
        draw();
      },
    });
  });
}
