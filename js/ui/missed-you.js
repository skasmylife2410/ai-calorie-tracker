// missed-you.js — the "it's been N days" card shown on Home and Progress while the app is in gloom.
import * as store from "../store.js";
import { t } from "../i18n.js";
import { lastMealAt, moodFor, daysAway } from "../mood.js";

/** Two days without a meal: the app has gone grey and rainy; this says why and how to fix it. */
export function missedYouHtml() {
  const last = lastMealAt(store.allFoodEntries());
  if (moodFor({ remainingToday: 0, lastMeal: last }) !== "sad") return "";
  return `
    <div class="missed-you card" role="status">
      <div class="missed-you-title">${t("mood.sadTitle", { n: daysAway(last) })}</div>
      <div class="missed-you-body">${t("mood.sadBody")}</div>
    </div>`;
}
