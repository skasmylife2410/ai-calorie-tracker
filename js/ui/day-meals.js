// day-meals.js — the meals logged on one day, as a sheet.
//
// This list used to sit on the Home tab, which meant the dashboard was mostly a scroll of past
// meals rather than today's numbers. It now opens on demand: from the calorie card, or after
// logging something.

import * as store from "../store.js";
import { mountEntryRow } from "./entry-row.js";
import { wireMealDrag, groupWithToast } from "./meal-drag.js";
import { openAddFoodSheet } from "./addfood.js";
import { openResultsSheet } from "./results.js";
import { openSheet, navBar, wireNavBar } from "./sheet.js";
import { icon } from "./icons.js";
import { t, formatDate } from "../i18n.js";

export function openDayMealsSheet({ date = new Date(), onChange } = {}) {
  openSheet({
    render(panel, close) {
      const cleanups = [];
      const isToday = store.localDateString?.(date) === undefined; // (store has no helper; label below handles it)

      const draw = () => {
        cleanups.splice(0).forEach((fn) => fn?.());
        const meals = store.entriesForDay(date).sort((a, b) => b.timestamp - a.timestamp);

        panel.innerHTML = `
          ${navBar({ title: t("day.meals"), leading: { label: t("app.close") } })}
          <div class="sheet-panel-body">
            <div class="day-meals-head">${formatDate(date, { weekday: "long", month: "short", day: "numeric" })}</div>
            ${meals.length >= 2 ? `<div class="group-hint">${t("group.hint")}</div>` : ""}
            <div class="day-meals-list" id="day-meals-list"></div>
          </div>`;

        const list = panel.querySelector("#day-meals-list");
        if (meals.length === 0) {
          list.innerHTML = `
            <div class="empty-state">
              ${icon("forkKnife", { size: 36 })}
              <div class="empty-state-title">${t("day.noMeals")}</div>
            </div>`;
        } else {
          for (const entry of meals) {
            cleanups.push(
              mountEntryRow(list, entry, {
                onTap: (e) => {
                  const fresh = store.getFoodEntry(e.id);
                  // Meals analysed from a photo, text or voice keep each ingredient: edit them one by one.
                  if (Array.isArray(fresh?.analysisItems) && fresh.analysisItems.length > 0) openResultsSheet(fresh);
                  else openAddFoodSheet({ entry: fresh, onSaved: () => { draw(); onChange?.(); } });
                },
                onDelete: (e) => {
                  store.deleteFoodEntry(e.id);
                  draw();
                  onChange?.();
                },
              })
            );
          }
        }
        cleanups.push(wireMealDrag(list, {
          canDrag: (id) => list.querySelector(`[data-entry-id="${id}"]`)?.dataset.state === "completed",
          onDrop: (src, dst) => groupWithToast(src, dst, () => { draw(); onChange?.(); }),
        }));
        wireNavBar(panel, { onLeading: () => { cleanups.splice(0).forEach((fn) => fn?.()); close(); } });
      };

      draw();
    },
  });
}
