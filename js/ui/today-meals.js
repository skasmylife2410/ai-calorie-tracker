// today-meals.js — the "Today" tab: what has been eaten today, and nothing older.
//
// Past days are reachable from Home's week strip; this tab is deliberately just today, so it
// reads like a running receipt of the day rather than a history log.

import * as store from "../store.js";
import { mountEntryRow } from "./entry-row.js";
import { wireMealDrag, groupWithToast } from "./meal-drag.js";
import { openAddFoodSheet } from "./addfood.js";
import { openResultsSheet } from "./results.js";
import { icon } from "./icons.js";
import { t, formatNumber, formatDate } from "../i18n.js";

let cleanups = [];
let viewedDay = 0; // 0 = today, -1 = yesterday, …

export function render(container) {
  cleanups.forEach((fn) => fn?.());
  cleanups = [];

  const today = new Date(Date.now() + viewedDay * 86400000);
  const isToday = viewedDay === 0;
  const meals = store.entriesForDay(today).sort((a, b) => b.timestamp - a.timestamp);
  const totals = store.totalsForDay(today);
  const goals = store.computeGoals();
  const energy = store.dayEnergy(today);

  container.innerHTML = `
    <div class="tm-screen">
      <div class="tm-head">
        <button type="button" class="tm-arrow" id="tm-prev" aria-label="${t("day.prevDay")}">‹</button>
        <div class="tm-head-mid">
          <h1 class="tm-title">${isToday ? t("todayTab.title") : formatDate(today, { weekday: "long" })}</h1>
          <div class="tm-date">${formatDate(today, { month: "long", day: "numeric" })}</div>
        </div>
        <button type="button" class="tm-arrow${isToday ? " is-hidden" : ""}" id="tm-next" aria-label="${t("day.nextDay")}">›</button>
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

      <div class="tm-count">${t("us.mealsCount", { n: meals.length })}${isToday ? "" : ` · <button type="button" class="tm-back" id="tm-back">${t("home.backToToday")}</button>`}</div>
      ${meals.length >= 2 ? `<div class="group-hint">${t("group.hint")}</div>` : ""}
      <div class="tm-list" id="tm-list"></div>
      <div class="bottom-safe-spacer"></div>
    </div>`;

  container.querySelector("#tm-prev")?.addEventListener("click", () => { viewedDay -= 1; render(container); });
  container.querySelector("#tm-next")?.addEventListener("click", () => { if (viewedDay < 0) { viewedDay += 1; render(container); } });
  container.querySelector("#tm-back")?.addEventListener("click", () => { viewedDay = 0; render(container); });

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
        onShare: !entry.photoDataUrl ? null : async (e) => {
          const { shareMeal } = await import("../social.js");
          const out = await shareMeal(store.getFoodEntry(e.id) ?? e);
          return out.ok === true;
        },
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

  cleanups.push(wireMealDrag(list, {
    canDrag: (id) => list.querySelector(`[data-entry-id="${id}"]`)?.dataset.state === "completed",
    onDrop: (src, dst) => groupWithToast(src, dst, () => render(container)),
  }));
}


/** The day the Today tab is showing, for anything logged from here. */
export function viewedTabTimestamp() {
  if (viewedDay === 0) return Date.now();
  const d = new Date(Date.now() + viewedDay * 86400000);
  d.setHours(12, 0, 0, 0);
  return d.getTime();
}
