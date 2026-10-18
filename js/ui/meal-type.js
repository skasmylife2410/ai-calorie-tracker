// meal-type.js — breakfast, lunch, dinner or snack. Right after a meal is logged (any way: photo,
// words, search, a favourite…) a bar says what it was filed under, with the other three a tap
// away; later, the meal's label on Home does the same (js/ui/entry-row.js). Until someone picks,
// the clock guesses (nutrition.mealTypeOf).

import * as store from "../store.js";
import { t } from "../i18n.js";
import { MEAL_TYPES, mealTypeOf } from "../nutrition.js";

const SHOW_MS = 6000;
let timer = null;

/** The four choices as buttons, the current one pressed. */
export function mealTypeChoicesHtml(current) {
  return MEAL_TYPES.map((k) => `<button type="button" class="mt-choice" data-meal-type="${k}" aria-pressed="${k === current}">${t(`mealType.${k}`)}</button>`).join("");
}

/** Just after a meal is logged: "Logged as Lunch", the other three one tap away. */
export function showLoggedBar(entryId) {
  const entry = store.getFoodEntry(entryId);
  if (!entry) return;
  document.getElementById("meal-type-bar")?.remove();
  clearTimeout(timer);
  const bar = document.createElement("div");
  bar.id = "meal-type-bar";
  bar.className = "meal-type-bar";
  bar.setAttribute("role", "group");
  bar.setAttribute("aria-label", t("mealType.loggedAs"));
  const draw = (current) => {
    bar.innerHTML = `<span class="mtb-label">${t("mealType.loggedAs")}</span><div class="mt-choices">${mealTypeChoicesHtml(current)}</div>`;
  };
  draw(mealTypeOf(entry));
  bar.addEventListener("click", (e) => {
    const b = e.target.closest("[data-meal-type]");
    if (!b) return;
    store.setMealType(entryId, b.dataset.mealType);
    draw(b.dataset.mealType);
    clearTimeout(timer);
    timer = setTimeout(() => bar.remove(), 900);
  });
  document.body.appendChild(bar);
  timer = setTimeout(() => bar.remove(), SHOW_MS);
}
