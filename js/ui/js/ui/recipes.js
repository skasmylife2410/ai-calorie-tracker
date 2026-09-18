// recipes.js — "What can I eat with what's left?" Nothing here is persisted: ideas are generated
// on demand from the day's remaining calories/protein and thrown away. "Log it" creates an
// ordinary manual FoodEntry, which the user can then heart like any other meal.

import * as store from "../store.js";
import { t, formatNumber, currentLanguage } from "../i18n.js";
import { suggestRecipes } from "../api.js";
import { icon } from "./icons.js";
import { openSheet, navBar, wireNavBar } from "./sheet.js";

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function openRecipesSheet({ date = new Date() } = {}) {
  openSheet({
    render(panel, close) {
      const energy = store.dayEnergy(date);
      const goals = store.computeGoals();
      const totals = store.totalsForDay(date);
      const caloriesLeft = Math.max(0, energy.remaining);
      const proteinLeft = Math.max(0, Math.round(goals.proteinTargetG - totals.proteinG));
      const preferences = store.getProfile().recipePreferences ?? [];

      let state = { kind: "loading" };
      let expanded = new Set();

      panel.innerHTML = `
        ${navBar({ title: t("ideas.title"), leading: { label: t("app.close") } })}
        <div class="sheet-panel-body">
          <div class="rec-header">
            <div class="rec-left">
              <div class="rec-figure">${formatNumber(caloriesLeft)}</div>
              <div class="rec-figure-label">${t("ideas.kcalLeft")}</div>
            </div>
            <div class="rec-left">
              <div class="rec-figure">${formatNumber(proteinLeft)} g</div>
              <div class="rec-figure-label">${t("ideas.proteinLeft")}</div>
            </div>
            <button type="button" class="rec-refresh" id="rec-refresh">${t("ideas.refresh")}</button>
          </div>
          <div id="rec-body"></div>
        </div>
      `;

      const body = panel.querySelector("#rec-body");

      const render = () => {
        if (state.kind === "loading") {
          body.innerHTML = `<div class="rec-loading">${icon("wandAndStars", { size: 22 })}<div>${t("ideas.loading")}</div></div>`;
          return;
        }
        if (state.kind === "error") {
          body.innerHTML = `
            <div class="empty-state">
              ${icon("wifiSlash", { size: 38 })}
              <div class="empty-state-title">${t("ideas.errorTitle")}</div>
              <div class="empty-state-message">${escapeHtml(state.message)}</div>
              <button type="button" class="btn-bordered" id="rec-retry">${t("app.retry")}</button>
            </div>`;
          body.querySelector("#rec-retry")?.addEventListener("click", load);
          return;
        }
        if (state.recipes.length === 0) {
          body.innerHTML = `
            <div class="empty-state">
              ${icon("forkKnife", { size: 38 })}
              <div class="empty-state-title">${t("ideas.emptyTitle")}</div>
              <div class="empty-state-message">${t("ideas.emptyBody")}</div>
            </div>`;
          return;
        }

        body.innerHTML = state.recipes
          .map((r, i) => {
            const open = expanded.has(i);
            return `
            <div class="rec-card card" data-idx="${i}">
              <div class="rec-name">${escapeHtml(r.name)}</div>
              <div class="rec-macros">${formatNumber(r.calories)} kcal · ${r.proteinG}g · ${r.minutes} min</div>
              <div class="rec-actions">
                <button type="button" class="rec-btn" data-toggle>${open ? t("ideas.hideRecipe") : t("ideas.recipe")}</button>
                <button type="button" class="rec-btn is-primary" data-log>${t("ideas.logIt")}</button>
              </div>
              ${open ? `
                <div class="rec-detail">
                  <div class="rec-detail-head">${t("ideas.ingredients")}</div>
                  <ul>${r.ingredients.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul>
                  <div class="rec-detail-head">${t("ideas.steps")}</div>
                  <ol>${r.steps.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ol>
                </div>` : ""}
            </div>`;
          })
          .join("");

        body.querySelectorAll(".rec-card").forEach((card) => {
          const idx = Number(card.dataset.idx);
          card.querySelector("[data-toggle]")?.addEventListener("click", () => {
            if (expanded.has(idx)) expanded.delete(idx); else expanded.add(idx);
            render();
          });
          card.querySelector("[data-log]")?.addEventListener("click", () => {
            const r = state.recipes[idx];
            store.addFoodEntry({
              name: r.name,
              calories: r.calories,
              proteinG: r.proteinG,
              carbsG: r.carbsG,
              fatG: r.fatG,
              source: "manual",
              timestamp: date instanceof Date ? date.getTime() : Date.now(),
              analysisItems: null,
            });
            if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") navigator.vibrate(20);
            close();
          });
        });
      };

      async function load() {
        state = { kind: "loading" };
        expanded = new Set();
        render();
        const outcome = await suggestRecipes({ caloriesLeft, proteinLeft, preferences, lang: currentLanguage() });
        state = outcome.ok
          ? { kind: "ready", recipes: outcome.recipes }
          : { kind: "error", message: outcome.message || "Try again in a moment." };
        render();
      }

      panel.querySelector("#rec-refresh").addEventListener("click", load);
      load();
      wireNavBar(panel, { onLeading: () => close() });
    },
  });
}
