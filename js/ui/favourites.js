// favourites.js — Favourites sheet: hearted meals (permanent, one serving each) plus a Recent
// shelf of the last 20 distinct foods. Logging applies a servings multiplier, so "arepa ×2" is
// two taps. Replaces the old saved.js recents-only sheet (SPEC-UI.md §9 superseded).

import { safeSrc } from "../safe-src.js";
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
function recentFoods({ excludeId = null } = {}) {
  const seen = new Set();
  const out = [];
  for (const e of [...store.allFoodEntries()].filter((e) => e.isPending !== true && e.analysisFailed !== true && e.id !== excludeId).sort((a, b) => b.timestamp - a.timestamp)) {
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
      // a stacked meal shows as one (stack icon, "3 foods")
      items: store.isGroupedEntry(e) && Array.isArray(e.analysisItems) ? e.analysisItems : null,
    });
    if (out.length >= MAX_RECENT) break;
  }
  return out;
}

function favouriteFoods() {
  return store.allSavedFoods().filter((f) => f.favorite !== false).sort((a, b) => b.createdAt - a.createdAt);
}

/** One serving of a food as meal items (a meal's own foods, else the food with its weight), ×n. */
function partsOf(f, n) {
  let parts = Array.isArray(f.items) && f.items.length ? f.items : null;
  if (!parts) {
    // the meal it came from still has the grams, as long as it hasn't changed since
    const src = store.getFoodEntry(f.recentEntryId ?? f.fromEntryId);
    if (src && Math.abs(store.baseMacros(src).calories - f.calories) <= 1) parts = store.oneServingItems(src);
  }
  if (!parts) parts = [{ name: f.name, calories: f.calories, proteinG: f.proteinG, carbsG: f.carbsG, fatG: f.fatG, micros: f.micros ?? null, unit: "serving", amount: 1, gramsEstimate: 0 }];
  return parts.map((i) => ({ ...store.scaleItem(i, n), id: undefined }));
}

/**
 * @param {object} [opts]
 * @param {(items:object[])=>void} [opts.onPick]  "pick" mode (adding to a meal being edited): the
 *   chosen foods are handed back as meal items instead of being logged.
 * @param {string} [opts.excludeId]  the meal being edited, left out of Recent
 */
export function openFavouritesSheet({ tab = "saved", timestamp = null, onPick = null, excludeId = null } = {}) {
  openSheet({
    render(panel, close) {
      let current = tab;
      const servings = new Map(); // id -> multiplier, reset each time the sheet opens
      const picked = new Set();   // ticked foods (either tab), logged together from the bar
      let stackThem = false;      // log the ticked foods as one stacked meal
      const pool = new Map();     // id -> food, for ticked foods from either tab

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
          ? `<img class="fav-thumb" src="${safeSrc(f.photoDataUrl)}" alt="">`
          : `<div class="fav-thumb"></div>`;
        const on = picked.has(f.id);
        return `
          <div class="fav-row${on ? " is-picked" : ""}" data-id="${f.id}">
            <button type="button" class="fav-pick" data-pick role="checkbox" aria-checked="${on}" aria-label="${escapeHtml(t("stack.pickFood", { name: f.name }))}">${on ? icon("checkmark", { size: 14 }) : ""}</button>
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
                <button type="button" class="fav-log" data-log>${onPick ? t("addTo.add") : t("app.log")}</button>
                ${current === "saved" && !onPick ? `<button type="button" class="fav-edit" data-edit>${t("group.edit")}</button>` : ""}
                ${current === "saved" && !onPick ? `<button type="button" class="fav-heart" data-unfav aria-label="Remove from favourites">♥</button>` : ""}
                ${current === "recent" && !onPick ? (() => { const on = store.isFavorited({ id: f.recentEntryId, name: f.name }); return `<button type="button" class="fav-heart${on ? " is-on" : ""}" data-fav aria-pressed="${on}" aria-label="${escapeHtml(t("stack.favourite"))}">${on ? "♥" : "♡"}</button>`; })() : ""}
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
        const foods = current === "saved" ? favouriteFoods() : recentFoods({ excludeId });

        if (foods.length === 0) {
          content.innerHTML = `
            ${current === "saved" && !onPick ? `<button type="button" class="fav-new-meal" id="fav-new-meal">＋ ${t("group.newMeal")}</button>` : ""}
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

        foods.forEach((f) => pool.set(f.id, f));
        content.innerHTML = `
          ${current === "saved" && !onPick ? `<button type="button" class="fav-new-meal" id="fav-new-meal">＋ ${t("group.newMeal")}</button>` : ""}
          <p class="fav-tip">${t(onPick ? "addTo.favTip" : "stack.favTip")}</p>
          <div class="fav-list">${foods.map(rowHtml).join("")}</div>
          ${picked.size ? pickBarHtml() : ""}`;
        wirePickBar();
        content.querySelector("#fav-new-meal")?.addEventListener("click", newMeal);

        content.querySelectorAll(".fav-row").forEach((row) => {
          const id = row.dataset.id;
          const food = foods.find((f) => f.id === id);

          row.querySelector("[data-pick]").addEventListener("click", () => {
            picked.has(id) ? picked.delete(id) : picked.add(id);
            render();
          });

          row.querySelectorAll("[data-step]").forEach((btn) => {
            btn.addEventListener("click", () => {
              const delta = Number(btn.dataset.step) * 0.5;
              const next = store.normalizeServings((servings.get(id) ?? 1) + delta);
              servings.set(id, next);
              render();
            });
          });

          row.querySelector("[data-log]")?.addEventListener("click", () => {
            if (onPick) { onPick(partsOf(food, servings.get(id) ?? 1)); close(); return; }
            logOne(food, servings.get(id) ?? 1, timestamp ?? Date.now());
            if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") navigator.vibrate(20);
            close();
          });

          row.querySelector("[data-edit]")?.addEventListener("click", () => editSaved(food));
          row.querySelector("[data-fav]")?.addEventListener("click", () => { store.toggleFavorite(food.recentEntryId); render(); });

          row.querySelector("[data-unfav]")?.addEventListener("click", () => {
            store.deleteSavedFood(id);
            render();
          });
        });
      };

      /** Logs one food as its own meal: a favourite (its foods, if a meal) or a recent food. */
      const logOne = (food, n, at) => {
        if (!food.recentEntryId) return store.logSavedFood(food.id, { servings: n, timestamp: at });
        const base = { calories: food.calories, proteinG: food.proteinG, carbsG: food.carbsG, fatG: food.fatG, micros: food.micros ?? null };
        return store.addFoodEntry({
          name: food.name,
          ...store.totalsFor(base, n),
          base,
          servings: n,
          source: food.source,
          photoDataUrl: food.photoDataUrl,
          timestamp: at,
          analysisItems: null, // never reopens the AI results screen
        });
      };

      const pickBarHtml = () => {
        const kcal = [...picked].reduce((a, id) => a + (pool.get(id)?.calories || 0) * (servings.get(id) ?? 1), 0);
        return `
          <div class="fav-pickbar">
            ${onPick ? `<button type="button" class="fav-log fav-log-many" id="fav-log-many">${t("addTo.addMany", { n: picked.size, kcal: Math.round(kcal).toLocaleString() })}</button>` : `
            <label class="fav-stack-toggle"><input type="checkbox" id="fav-stack" ${stackThem ? "checked" : ""} ${picked.size < 2 ? "disabled" : ""}> ${icon("stack", { size: 15 })} ${t("stack.asOne")}</label>
            <button type="button" class="fav-log fav-log-many" id="fav-log-many">${t("stack.logMany", { n: picked.size, kcal: Math.round(kcal).toLocaleString() })}</button>`}
          </div>`;
      };

      const wirePickBar = () => {
        content.querySelector("#fav-stack")?.addEventListener("change", (e) => { stackThem = e.target.checked; });
        content.querySelector("#fav-log-many")?.addEventListener("click", () => {
          const at = timestamp ?? Date.now();
          const chosen = [...picked].map((id) => pool.get(id)).filter(Boolean);
          if (onPick) {
            onPick(chosen.flatMap((f) => partsOf(f, servings.get(f.id) ?? 1)));
            close();
            return;
          }
          if (stackThem && chosen.length > 1) {
            // one meal holding every ticked food, each at its servings
            const items = chosen.flatMap((f) => partsOf(f, servings.get(f.id) ?? 1));
            store.addFoodEntry({
              name: chosen.map((f) => f.name).join(", ").slice(0, 90),
              ...store.fieldsFromItems(items, 1),
              servings: 1,
              grouped: true,
              source: "manual",
              photoDataUrl: chosen.find((f) => f.photoDataUrl)?.photoDataUrl ?? null,
              timestamp: at,
              analysisItems: items,
            });
          } else {
            chosen.forEach((f, i) => logOne(f, servings.get(f.id) ?? 1, at + i));
          }
          if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") navigator.vibrate(20);
          close();
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
