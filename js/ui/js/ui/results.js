// results.js — Meal Results review/edit sheet (MealResultsView.swift), SPEC-UI.md §12.
// Edits a local copy of the entry's analysisItems; "Save changes" persists onto the SAME entry.
// Grams edits rescale the other four fields proportionally against a per-item baseline snapshot;
// direct macro edits become the new baseline (§12.2). "Fix results" re-runs analysis with an
// appended correction via queue.submitCorrection.

import * as store from "../store.js";
import { t } from "../i18n.js";
import * as queue from "../queue.js";
import { icon } from "./icons.js";
import { openSheet, navBar, wireNavBar } from "./sheet.js";
import { parseNumeric, formatNumeric } from "./numeric-field.js";

const FIELD_DEFS = [
  { key: "gramsEstimate", label: "Grams", unit: "g" },
  { key: "calories", label: "Kcal", unit: "" },
  { key: "proteinG", label: "Protein", unit: "g" },
  { key: "carbsG", label: "Carbs", unit: "g" },
  { key: "fatG", label: "Fat", unit: "g" },
];

const TOTAL_DEFS = [
  { key: "calories", label: "Kcal", suffix: "" },
  { key: "proteinG", label: "Protein", suffix: "g" },
  { key: "carbsG", label: "Carbs", suffix: "g" },
  { key: "fatG", label: "Fat", suffix: "g" },
];

export function openResultsSheet(entry) {
  // Local editable copy of items + per-item baselines (snapshot at open / after reanalysis).
  let items = (entry.analysisItems ?? []).map((i) => ({ ...i }));
  let baselines = items.map(snapshotBaseline);

  openSheet({
    render(panel, close) {
      panel.innerHTML = `
        ${navBar({ title: t("meal.title"), leading: { label: t("app.cancel") } })}
        <div class="sheet-panel-body">
          ${thumbHtml(entry)}
          <div class="servings-card" id="servings-card">
            <div class="servings-label">
              <div class="servings-title">${t("meal.servings")}</div>
              <div class="servings-hint">${t("meal.servingsHint")}</div>
            </div>
            <div class="servings-stepper">
              <button type="button" data-serv="-1" aria-label="Fewer servings">−</button>
              <span id="servings-value">1</span>
              <button type="button" data-serv="1" aria-label="More servings">+</button>
            </div>
            <button type="button" class="servings-heart" id="fav-toggle" aria-label="Favourite">♡</button>
          </div>
          <div class="results-items-section-header">${t("meal.items")}</div>
          <div class="ios-section" style="margin-bottom:0;">
            <div class="ios-section-body" id="results-items"></div>
          </div>
          <div class="results-items-section-footer">Tap any number to edit it. Editing grams rescales that item's macros proportionally.</div>
        </div>
        <div class="results-totals-bar" id="results-totals"></div>
        <div class="results-actions">
          <button class="btn-bordered" id="fix-results-btn">${icon("wandAndStars", { size: 18 })}<span>${t("meal.fixResults")}</span></button>
          <button class="btn-prominent" id="save-changes-btn">${t("meal.saveChanges")}</button>
        </div>
      `;

      const itemsEl = panel.querySelector("#results-items");
      const totalsEl = panel.querySelector("#results-totals");
      const saveBtn = panel.querySelector("#save-changes-btn");

      // --- servings + favourite -------------------------------------------------
      // The stepper acts on the SAVED entry immediately (like the heart does); item edits below
      // still work per-serving, because items always describe one serving of the meal.
      const servValue = panel.querySelector("#servings-value");
      const favBtn = panel.querySelector("#fav-toggle");
      let servings = store.normalizeServings(entry.servings);

      const renderServings = () => {
        servValue.textContent = String(servings);
        panel.querySelector("#servings-card").classList.toggle("is-multiple", servings !== 1);
      };
      const renderFav = () => {
        const on = store.isFavorited(store.getFoodEntry(entry.id) ?? entry);
        favBtn.textContent = on ? "♥" : "♡";
        favBtn.classList.toggle("is-on", on);
      };

      panel.querySelectorAll("[data-serv]").forEach((btn) => {
        btn.addEventListener("click", () => {
          servings = store.normalizeServings(servings + Number(btn.dataset.serv) * 0.5);
          store.setServings(entry.id, servings);
          renderServings();
          renderTotals();
        });
      });
      favBtn.addEventListener("click", () => {
        store.toggleFavorite(entry.id);
        renderFav();
      });
      renderServings();
      renderFav();

      const renderTotals = () => {
        totalsEl.innerHTML = TOTAL_DEFS.map((t) => {
          const total = items.reduce((acc, i) => acc + (i[t.key] ?? 0), 0) * servings;
          return `
            <div class="total-stat">
              <div class="total-stat-value numeric-text">${formatNumeric(total)}${t.suffix}</div>
              <div class="total-stat-label">${t.label}</div>
            </div>`;
        }).join("");
        saveBtn.disabled = items.length === 0;
      };

      const renderItems = () => {
        if (items.length === 0) {
          itemsEl.innerHTML = `<div class="results-empty-items">No items left — add one back with "Fix results" or cancel.</div>`;
          renderTotals();
          return;
        }
        itemsEl.innerHTML = items.map((item, idx) => itemRowHtml(item, idx)).join("");

        items.forEach((item, idx) => {
          const row = itemsEl.querySelector(`[data-item-idx="${idx}"]`);
          if (!row) return;

          const nameInput = row.querySelector(".meal-item-name-input");
          nameInput.addEventListener("input", () => {
            item.name = nameInput.value;
          });

          row.querySelector("[data-item-delete]").addEventListener("click", () => {
            items.splice(idx, 1);
            baselines.splice(idx, 1);
            renderItems();
          });

          for (const f of FIELD_DEFS) {
            const input = row.querySelector(`[data-field="${f.key}"]`);
            input.addEventListener("input", () => {
              const parsed = parseNumeric(input.value);
              if (parsed === null) return; // §13: leave model + buffer untouched mid-edit
              if (f.key === "gramsEstimate") {
                // Grams rescale — skip transient zero/empty; rescale against baseline snapshot.
                if (!(parsed > 0)) return;
                const base = baselines[idx];
                if (base.gramsEstimate > 0) {
                  const factor = parsed / base.gramsEstimate;
                  item.gramsEstimate = parsed;
                  item.calories = base.calories * factor;
                  item.proteinG = base.proteinG * factor;
                  item.carbsG = base.carbsG * factor;
                  item.fatG = base.fatG * factor;
                  // Re-display the four dependent fields (they're not focused — safe to rewrite).
                  for (const dep of FIELD_DEFS) {
                    if (dep.key === "gramsEstimate") continue;
                    const depInput = row.querySelector(`[data-field="${dep.key}"]`);
                    if (depInput && document.activeElement !== depInput) {
                      depInput.value = formatNumeric(item[dep.key]);
                    }
                  }
                } else {
                  item.gramsEstimate = parsed;
                }
              } else {
                // Direct macro edit = new ground truth: update value AND its baseline (§12.2).
                item[f.key] = parsed;
                baselines[idx][f.key] = parsed;
                baselines[idx].gramsEstimate = item.gramsEstimate; // rescale later from here
              }
              renderTotals();
            });
            input.addEventListener("blur", () => {
              // Resync buffer from model on blur (drops unparsable leftovers).
              input.value = formatNumeric(item[f.key]);
            });
          }
        });
        renderTotals();
      };

      renderItems();

      panel.querySelector("#fix-results-btn").addEventListener("click", () => {
        openFixResultsSheet(entry, () => {
          // Correction succeeded — queue already persisted the new items to the store.
          const fresh = store.getFoodEntry(entry.id);
          if (fresh) {
            entry = fresh;
            items = (fresh.analysisItems ?? []).map((i) => ({ ...i }));
            baselines = items.map(snapshotBaseline);
            renderItems();
          }
        });
      });

      saveBtn.addEventListener("click", () => {
        if (items.length === 0) return;
        const name = queue.buildJoinedName(items) || "Analyzed meal";
        store.updateFoodEntry(entry.id, {
          name,
          calories: sum(items, "calories"),
          proteinG: sum(items, "proteinG"),
          carbsG: sum(items, "carbsG"),
          fatG: sum(items, "fatG"),
          analysisItems: items,
        });
        close();
      });

      wireNavBar(panel, { onLeading: () => close() });
    },
  });
}

function snapshotBaseline(item) {
  return {
    gramsEstimate: item.gramsEstimate,
    calories: item.calories,
    proteinG: item.proteinG,
    carbsG: item.carbsG,
    fatG: item.fatG,
  };
}

function sum(items, key) {
  return items.reduce((acc, i) => acc + (i[key] ?? 0), 0);
}

function thumbHtml(entry) {
  if (entry.photoDataUrl) {
    return `<div class="results-thumb-wrap"><img class="results-thumb" src="${entry.photoDataUrl}" alt="" /></div>`;
  }
  if (typeof entry.analysisDescription === "string" && entry.analysisDescription.trim() !== "") {
    return `
      <div class="results-desc-quote">
        ${icon("textBubbleFill", { size: 15 })}
        <div class="results-desc-quote-text">“${escapeHtml(entry.analysisDescription)}”</div>
      </div>`;
  }
  return "";
}

function itemRowHtml(item, idx) {
  const lowConfidence = typeof item.confidence === "number" && item.confidence < 0.5;
  return `
    <div class="meal-item-row" data-item-idx="${idx}">
      <div class="meal-item-top">
        <input type="text" class="meal-item-name-input" value="${escapeAttr(item.name)}" />
        ${item.grounded === true ? `<span class="meal-item-badge" role="img" aria-label="Verified against USDA nutrition database.">${icon("leafFill", { size: 16, color: "var(--sc-green)" })}</span>` : ""}
        <button class="meal-item-delete" data-item-delete aria-label="Delete item">${icon("trashFill", { size: 16, color: "var(--sc-red)" })}</button>
      </div>
      ${lowConfidence ? `<div class="meal-item-warning">${icon("exclamationTriangleFill", { size: 13, color: "var(--sc-orange)" })}<span>Double-check this one</span></div>` : ""}
      <div class="meal-item-fields">
        ${FIELD_DEFS.map(
          (f) => `
          <div class="meal-field">
            <div class="meal-field-label">${f.label}</div>
            <input type="text" class="meal-field-input" inputmode="decimal" data-field="${f.key}" value="${formatNumeric(item[f.key])}" />
            <div class="meal-field-unit">${f.unit}</div>
          </div>`
        ).join("")}
      </div>
    </div>
  `;
}

function openFixResultsSheet(entry, onSuccess) {
  let submitting = false;

  openSheet({
    render(panel, close) {
      const renderBody = (errorMessage = null) => {
        panel.innerHTML = `
          ${navBar({
            title: "Fix Results",
            leading: { label: "Cancel", disabled: submitting },
            trailing: { label: "Submit", bold: true, disabled: true },
          })}
          <div class="sheet-panel-body">
            <div class="fix-results-body">
              <div class="fix-results-prompt">Tell the AI what it got wrong — e.g. "that's lamb not beef, and no rice"</div>
              <textarea class="describe-textarea" id="fix-input" rows="4" placeholder="What should change?" ${submitting ? "disabled" : ""}></textarea>
              ${errorMessage ? `<div class="fix-results-error">${escapeHtml(errorMessage)}</div>` : ""}
              <div class="fix-results-progress ${submitting ? "" : "hidden"}" id="fix-progress"><div class="spinner"></div><span>Re-analyzing…</span></div>
            </div>
          </div>
        `;

        const textarea = panel.querySelector("#fix-input");
        const submitBtn = panel.querySelector('[data-nav="trailing"]');

        textarea.addEventListener("input", () => {
          submitBtn.disabled = textarea.value.trim() === "" || submitting;
        });

        wireNavBar(panel, {
          onLeading: () => {
            if (!submitting) close();
          },
          onTrailing: async () => {
            const text = textarea.value.trim();
            if (text === "" || submitting) return;
            submitting = true;
            textarea.disabled = true;
            submitBtn.disabled = true;
            panel.querySelector("#fix-progress").classList.remove("hidden");
            panel.querySelector('[data-nav="leading"]').disabled = true;

            const outcome = await queue.submitCorrection(entry.id, text);
            submitting = false;
            if (outcome.success) {
              onSuccess();
              close();
            } else {
              renderBody(outcome.reason);
            }
          },
        });
      };

      renderBody();
      setTimeout(() => panel.querySelector("#fix-input")?.focus(), 350);
    },
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/"/g, "&quot;");
}
