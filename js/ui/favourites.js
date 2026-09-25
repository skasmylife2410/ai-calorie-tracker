// favourites.js — Favourites sheet: hearted meals (permanent, one serving each) plus a Recent
// shelf of the last 20 distinct foods. Logging applies a servings multiplier, so "arepa ×2" is
// two taps. Replaces the old saved.js recents-only sheet (SPEC-UI.md §9 superseded).

import * as store from "../store.js";
import { openResultsSheet } from "./results.js";
import { groupThumbHtml } from "./entry-row.js";
import { openFoodSearchSheet } from "./search.js";
import { t } from "../i18n.js";
import { icon } from "./icons.js";
import { openSheet, navBar, wireNavBar } from "./sheet.js";

const MAX_RECENT = 20;

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/** Last 20 distinct foods by name, newest first — the "Recent" tab. */
function recentFoods() {
  const seen = new Set();
  const out = [];
  for (const e of [...store.allFoodEntries()].filter((e) => e.isPending !== true && e.analysisFailed !== true).sort((a, b) => b.timestamp - a.timestamp)) {
    const key = String(e.name ?? "").trim().toLowerCase();
    if (key === "" || seen.has(key)) continue;
    seen.add(key);
    const b = store.baseMacros(e); // one-serving numbers, so ×N below is honest
    out.push({
      id: e.id,
      name: e.name,
      calories: Math.round(b.calories),
      proteinG: Math.round(b.proteinG),
      carbsG: Math.round(b.carbsG),
      fatG: Math.round(b.fatG),
      micros: b.micros ?? null,
      photoDataUrl: e.photoDataUrl ?? null,
      source: e.source,
      recentEntryId: e.id,
    });
    if (out.length >= MAX_RECENT) break;
  }
  return out;
}

function favouriteFoods() {
  return store.allSavedFoods().filter((f) => f.favorite !== false).sort((a, b) => b.createdAt - a.createdAt);
}

export function openFavouritesSheet({ tab = "saved", timestamp = null } = {}) {
  openSheet({
    render(panel, close) {
      let current = tab;
      const servings = new Map(); // id -> multiplier, reset each time the sheet opens

      panel.innerHTML = `
        ${navBar({ title: t("favourites.title"), leading: { label: t("app.close") } })}
        <div class="fav-tabs" role="group">
          <button type="button" data-tab="saved">${t("favourites.saved")}</button>
          <button type="button" data-tab="recent">${t("favourites.recent")}</button>
        </div>
        <div class="sheet-panel-body" id="fav-content"></div>
      `;

      const content = panel.querySelector("#fav-content");

      const rowHtml = (f) => {
        const n = servings.get(f.id) ?? 1;
        const thumb = Array.isArray(f.items) && f.items.length > 1
          ? groupThumbHtml(f, { className: "fav-thumb" })
          : f.photoDataUrl
          ? `<img class="fav-thumb" src="${f.photoDataUrl}" alt="">`
          : `<div class="fav-thumb"></div>`;
        return `
          <div class="fav-row" data-id="${f.id}">
            ${thumb}
            <div class="fav-text">
              <div class="fav-name">${escapeHtml(f.name)}</div>
              ${Array.isArray(f.items) && f.items.length > 1 ? `<div class="fav-foods">${t("group.foodsCount", { n: f.items.length })}</div>` : ""}
              <div class="fav-macros">${t("favourites.macros", { calories: Math.round(f.calories * n), protein: Math.round(f.proteinG * n) })}${n !== 1 ? t("favourites.servingsSuffix", { n }) : ""}</div>
              <div class="fav-ctrl">
                <div class="fav-stepper">
                  <button type="button" data-step="-1" aria-label="Fewer servings">−</button>
                  <span class="fav-count">${n}</span>
                  <button type="button" data-step="1" aria-label="More servings">+</button>
                </div>
                <button type="button" class="fav-log" data-log>${t("app.log")}</button>
                ${current === "saved" ? `<button type="button" class="fav-edit" data-edit>${t("group.edit")}</button>` : ""}
                ${current === "saved" ? `<button type="button" class="fav-heart" data-unfav aria-label="Remove from favourites">♥</button>` : ""}
              </div>
            </div>
          </div>`;
      };

      /** Opens a saved meal's foods for editing (add/remove foods, amounts, name). Nothing is logged. */
      const editSaved = (food) => {
        const items = Array.isArray(food.items) && food.items.length > 0
          ? food.items.map((i) => ({ ...i }))
          : [{ name: food.name, calories: food.calories, proteinG: food.proteinG, carbsG: food.carbsG, fatG: food.fatG, micros: food.micros ?? null, unit: "serving", amount: 1, gramsEstimate: 0 }];
        openResultsSheet(
          { id: `saved-${food.id}`, name: food.name, analysisItems: items, servings: 1, photoDataUrl: food.photoDataUrl ?? null },
          { template: { savedId: food.id, name: food.name, onSaved: render } }
        );
      };

      /** Build a recurring meal from scratch: pick its foods, then name it. */
      const newMeal = () => {
        openFoodSearchSheet({
          pickLabel: t("group.next"),
          onPick: (items) => openResultsSheet(
            { id: "saved-new", name: "", analysisItems: items, servings: 1, photoDataUrl: null },
            { template: { savedId: null, name: "", onSaved: render } }
          ),
        });
      };

      const render = () => {
        panel.querySelectorAll("[data-tab]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.tab === current)));
        const foods = current === "saved" ? favouriteFoods() : recentFoods();

        if (foods.length === 0) {
          content.innerHTML = `
            ${current === "saved" ? `<button type="button" class="fav-new-meal" id="fav-new-meal">＋ ${t("group.newMeal")}</button>` : ""}
            <div class="empty-state">
              ${icon(current === "saved" ? "bookmark" : "listBulletRectanglePortrait", { size: 40 })}
              <div class="empty-state-title">${current === "saved" ? t("favourites.emptySavedTitle") : t("favourites.emptyRecentTitle")}</div>
              <div class="empty-state-message">${
                current === "saved" ? t("favourites.emptySavedBody") : t("favourites.emptyRecentBody")
              }</div>
            </div>`;
          content.querySelector("#fav-new-meal")?.addEventListener("click", newMeal);
          return;
        }

        content.innerHTML = `
          ${current === "saved" ? `<button type="button" class="fav-new-meal" id="fav-new-meal">＋ ${t("group.newMeal")}</button>` : ""}
          <div class="fav-list">${foods.map(rowHtml).join("")}</div>`;
        content.querySelector("#fav-new-meal")?.addEventListener("click", newMeal);

        content.querySelectorAll(".fav-row").forEach((row) => {
          const id = row.dataset.id;
          const food = foods.find((f) => f.id === id);

          row.querySelectorAll("[data-step]").forEach((btn) => {
            btn.addEventListener("click", () => {
              const delta = Number(btn.dataset.step) * 0.5;
              const next = store.normalizeServings((servings.get(id) ?? 1) + delta);
              servings.set(id, next);
              render();
            });
          });

          row.querySelector("[data-log]")?.addEventListener("click", () => {
            const n = servings.get(id) ?? 1;
            if (current === "saved") {
              store.logSavedFood(id, { servings: n, timestamp: timestamp ?? Date.now() });
            } else {
              const base = { calories: food.calories, proteinG: food.proteinG, carbsG: food.carbsG, fatG: food.fatG, micros: food.micros ?? null };
              store.addFoodEntry({
                name: food.name,
                ...store.totalsFor(base, n),
                base,
                servings: n,
                source: food.source,
                photoDataUrl: food.photoDataUrl,
                timestamp: timestamp ?? Date.now(),
                analysisItems: null, // never reopens the AI results screen
              });
            }
            if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") navigator.vibrate(20);
            close();
          });

          row.querySelector("[data-edit]")?.addEventListener("click", () => editSaved(food));

          row.querySelector("[data-unfav]")?.addEventListener("click", () => {
            store.deleteSavedFood(id);
            render();
          });
        });
      };

      panel.querySelectorAll("[data-tab]").forEach((btn) => {
        btn.addEventListener("click", () => { current = btn.dataset.tab; render(); });
      });

      render();
      wireNavBar(panel, { onLeading: () => close() });
    },
  });
}

// Back-compat: app.js and the old + menu still import openSavedFoodsSheet.
export const openSavedFoodsSheet = () => openFavouritesSheet({ tab: "recent" });
