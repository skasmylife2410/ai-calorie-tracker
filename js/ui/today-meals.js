// today-meals.js — the "Today" tab: what has been eaten today, and nothing older.
//
// Past days are reachable from Home's week strip; this tab is deliberately just today, so it
// reads like a running receipt of the day rather than a history log.

import * as store from "../store.js";
import { mountEntryRow } from "./entry-row.js";
import { openAddFoodSheet } from "./addfood.js";
import { openResultsSheet } from "./results.js";
import { icon } from "./icons.js";
import { t, formatNumber, formatDate } from "../i18n.js";

let cleanups = [];

export function render(container) {
  cleanups.forEach((fn) => fn?.());
  cleanups = [];

  const today = new Date();
  const meals = store.entriesForDay(today).sort((a, b) => b.timestamp - a.timestamp);
  const totals = store.totalsForDay(today);
  const goals = store.computeGoals();
  const energy = store.dayEnergy(today);

  container.innerHTML = `
    <div class="tm-screen">
      <div class="tm-head">
        <div>
          <h1 class="tm-title">${t("todayTab.title")}</h1>
          <div class="tm-date">${formatDate(today, { weekday: "long", month: "long", day: "numeric" })}</div>
        </div>
      </div>

      <div class="tm-summary">
        <div class="tm-sum-main">
          <div class="tm-sum-num">${formatNumber(Math.round(totals.calories))}</div>
          <div class="tm-sum-label">${t("todayTab.eatenOf", { goal: formatNumber(energy.adjustedTarget) })}</div>
        </div>
        <div class="tm-sum-macros">
          ${[
            ["proteinG", "proteinTargetG", "var(--sc-protein)", "todayTab.protein"],
            ["carbsG", "carbsTargetG", "var(--sc-carbs)", "todayTab.carbs"],
            ["fatG", "fatTargetG", "var(--sc-fat)", "todayTab.fat"],
          ].map(([k, g, c, label]) => {
            const pct = goals[g] > 0 ? Math.min(100, (totals[k] / goals[g]) * 100) : 0;
            return `
              <div class="tm-macro">
                <div class="tm-macro-top"><span>${t(label)}</span><b>${Math.round(totals[k])}g</b></div>
                <div class="tm-macro-bar"><span style="width:${pct}%;background:${c}"></span></div>
              </div>`;
          }).join("")}
        </div>
      </div>

      <div class="tm-count">${t("us.mealsCount", { n: meals.length })}</div>
      <div class="tm-list" id="tm-list"></div>
      <div class="bottom-safe-spacer"></div>
    </div>`;

  const list = container.querySelector("#tm-list");

  if (meals.length === 0) {
    list.innerHTML = `
      <div class="tm-empty">
        ${icon("forkKnife", { size: 38 })}
        <div class="tm-empty-title">${t("todayTab.emptyTitle")}</div>
        <div class="tm-empty-body">${t("todayTab.emptyBody")}</div>
      </div>`;
    return;
  }

  for (const entry of meals) {
    cleanups.push(
      mountEntryRow(list, entry, {
        onTap: (e) => {
          const fresh = store.getFoodEntry(e.id);
          // Photo meals open the item-by-item editor (grams per item); everything else opens
          // the single-food editor, which now edits grams/ml too.
          if (Array.isArray(fresh?.analysisItems) && fresh.analysisItems.length > 0) {
            openResultsSheet(fresh);
          } else {
            openAddFoodSheet({ entry: fresh, onSaved: () => render(container) });
          }
        },
        onDelete: (e) => {
          store.deleteFoodEntry(e.id);
          render(container);
        },
      })
    );
  }
}
