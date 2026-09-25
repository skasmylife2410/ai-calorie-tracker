// history.js — Progress tab (HistoryView.swift), SPEC-UI.md §6.

import * as store from "../store.js";
import { t } from "../i18n.js";
import { roundDisplay } from "../nutrition.js";
import { icon } from "./icons.js";
import { mountEntryRow } from "./entry-row.js";
import { handleRowTap } from "./today.js";

let rowCleanups = [];

function formatDayHeader(dayStart) {
  return new Date(dayStart).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function render(container) {
  rowCleanups.forEach((fn) => fn());
  rowCleanups = [];

  const groups = store.historyGroupedByDay();

  container.innerHTML = `
    <div class="navbar" style="position:sticky;">
      <span class="navbar-spacer"></span>
      <div class="navbar-title">${t("progress.title")}</div>
      <a class="navbar-btn" href="/us.html" style="text-decoration:none;">${t("progress.together")}</a>
    </div>
    <div class="history-content" id="history-content"></div>
  `;

  const content = container.querySelector("#history-content");

  if (groups.length === 0) {
    content.innerHTML = `
      <div class="empty-state">
        ${icon("forkKnife", { size: 40 })}
        <div class="empty-state-title">${t("ui.noHistory")}</div>
        <div class="empty-state-message">${t("ui.noHistoryBody")}</div>
      </div>
    `;
    return;
  }

  for (const group of groups) {
    const groupEl = document.createElement("div");
    groupEl.className = "history-day-group";
    groupEl.innerHTML = `
      <div class="history-day-header">
        <div class="history-day-date">${formatDayHeader(group.dayStart)}</div>
        <div class="history-day-total">${roundDisplay(group.total.calories)} kcal</div>
      </div>
      <div class="history-day-rows"></div>
    `;
    content.appendChild(groupEl);
    const rowsEl = groupEl.querySelector(".history-day-rows");
    for (const entry of group.entries) {
      const cleanup = mountEntryRow(rowsEl, entry, {
        onTap: (e) => handleRowTap(e, container),
        onDelete: (e) => store.deleteFoodEntry(e.id),
      });
      rowCleanups.push(cleanup);
    }
  }

  const spacer = document.createElement("div");
  spacer.className = "bottom-safe-spacer";
  content.appendChild(spacer);
}
