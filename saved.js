// saved.js — Saved foods sheet (SavedFoodsView.swift), SPEC-UI.md §9.
// Per the UI spec this is a lightweight "recents" shelf — NOT a separate favorites model:
// the 20 most-recent FoodEntries deduplicated by name (case-insensitive), most recent wins.
// (store.js also exposes a distinct savedFoods model, but that contract doesn't match §9's
// recents-shelf semantics, so the dedupe is done UI-side from allFoodEntries — noted mismatch.)

import * as store from "../store.js";
import { icon } from "./icons.js";
import { openSheet, navBar, wireNavBar } from "./sheet.js";

const MAX_SAVED = 20;

function recentDedupedFoods() {
  const entries = [...store.allFoodEntries()]
    .filter((e) => e.isPending !== true && e.analysisFailed !== true)
    .sort((a, b) => b.timestamp - a.timestamp);
  const seen = new Set();
  const out = [];
  for (const e of entries) {
    const key = e.name.trim().toLowerCase();
    if (key === "" || seen.has(key)) continue;
    seen.add(key);
    out.push(e);
    if (out.length >= MAX_SAVED) break;
  }
  return out;
}

export function openSavedFoodsSheet() {
  openSheet({
    render(panel, close) {
      const foods = recentDedupedFoods();

      panel.innerHTML = `
        ${navBar({ title: "Saved foods", leading: { label: "Close" } })}
        <div class="sheet-panel-body" id="saved-content"></div>
      `;

      const content = panel.querySelector("#saved-content");

      if (foods.length === 0) {
        content.innerHTML = `
          <div class="empty-state">
            ${icon("bookmark", { size: 40 })}
            <div class="empty-state-title">No saved foods yet</div>
            <div class="empty-state-message">Foods you log will show up here so you can log them again in one tap.</div>
          </div>
        `;
      } else {
        content.innerHTML = `
          <div class="saved-list" style="background:#fff;border-radius:10px;margin:8px 16px;overflow:hidden;">
            ${foods
              .map(
                (f, i) => `
                <button class="saved-row" data-saved-idx="${i}">
                  <div class="saved-row-left">
                    <div class="saved-row-name">${escapeHtml(f.name)}</div>
                    <div class="saved-row-macros">P ${Math.round(f.proteinG)}g · C ${Math.round(f.carbsG)}g · F ${Math.round(f.fatG)}g</div>
                  </div>
                  <div class="saved-row-cal">${Math.round(f.calories)} kcal</div>
                </button>`
              )
              .join("")}
          </div>
        `;
        content.querySelectorAll("[data-saved-idx]").forEach((row) => {
          row.addEventListener("click", () => {
            const food = foods[Number(row.dataset.savedIdx)];
            // Re-log as a BRAND NEW entry timestamped now (copies name/calories/macros/source/photo,
            // never analysisItems — §9.2 + store's logSavedFood rationale).
            store.addFoodEntry({
              name: food.name,
              calories: food.calories,
              proteinG: food.proteinG,
              carbsG: food.carbsG,
              fatG: food.fatG,
              source: food.source,
              photoDataUrl: food.photoDataUrl,
              timestamp: Date.now(),
              analysisItems: null,
            });
            if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
              navigator.vibrate(20); // medium-impact haptic stand-in
            }
            close();
          });
        });
      }

      wireNavBar(panel, { onLeading: () => close() });
    },
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}
