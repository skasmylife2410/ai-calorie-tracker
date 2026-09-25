// results.js — Meal Results review/edit sheet (MealResultsView.swift), SPEC-UI.md §12.
// Edits a local copy of the entry's analysisItems; "Save changes" persists onto the SAME entry.
// Grams edits rescale the other four fields proportionally against a per-item baseline snapshot;
// direct macro edits become the new baseline (§12.2). "Fix results" re-runs analysis with an
// appended correction via queue.submitCorrection.

import * as store from "../store.js";
import { t, currentLanguage } from "../i18n.js";
import * as queue from "../queue.js";
import { openFoodSearchSheet } from "./search.js";
import { icon } from "./icons.js";
import { openSheet, navBar, wireNavBar } from "./sheet.js";
import { parseNumeric, formatNumeric } from "./numeric-field.js";
import { scaleMicros, cleanMicros, sumMicros } from "../nutrition.js";
import { microsSummary, microInputsHtml, wireMicroInputs, formatMicro } from "./micros.js";
import { plateSvg, handReference, handLabel, densityOf, _KINDS_FOR_TESTS as KINDS } from "./portion-plate.js";

const FIELD_DEFS = [
  { key: "amount", label: "Amount", unit: "" },
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

/**
 * @param {object} entry  the logged meal — or, with `template`, a stand-in built from a saved meal
 * @param {{template?: {savedId:string|null, name?:string, onSaved?:()=>void}}} [opts]
 *   template: edit a saved (recurring) meal instead of a logged one — no servings, sharing or
 *   re-analysis; "Save meal" writes back to Favourites and nothing is logged.
 */
export function openResultsSheet(entry, { template = null } = {}) {
  // Local editable copy of items + per-item baselines (snapshot at open / after reanalysis).
  let items = (entry.analysisItems ?? []).map((i) => ({ ...i }));
  let baselines = items.map(snapshotBaseline);
  const openMicros = new Set(); // which items have their nutrient fields expanded

  openSheet({
    render(panel, close) {
      panel.innerHTML = `
        ${navBar({ title: t("meal.title"), leading: { label: t("app.cancel") } })}
        <div class="sheet-panel-body">
          ${thumbHtml(entry)}
          ${template ? `
          <div class="template-name-card">
            <label class="template-name-label" for="template-name">${t("group.nameLabel")}</label>
            <input type="text" id="template-name" class="template-name-input" maxlength="90"
                   value="${escapeAttr(template.name ?? "")}" placeholder="${escapeAttr(t("group.namePlaceholder"))}" />
          </div>` : `
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
            ${entry.photoDataUrl ? `<button type="button" class="servings-share" id="share-meal" aria-label="${t("social.share")}">↗︎</button>` : ""}
          </div>`}
          <div class="results-items-section-header">${t("meal.items")}</div>
          <div class="ios-section" style="margin-bottom:0;">
            <div class="ios-section-body" id="results-items"></div>
          </div>
          <div class="results-items-section-footer">Tap any number to edit it. Editing grams rescales that item's macros proportionally.</div>
          <button type="button" class="add-to-meal-btn" id="add-to-meal">＋ ${t("group.addFood")}</button>
          <button type="button" class="plate-toggle" id="plate-toggle" aria-expanded="false">🍽️ ${t("plate.open")}</button>
          <div class="plate-card hidden" id="plate-card"></div>
        </div>
        <div class="results-totals-bar" id="results-totals"></div>
        <div class="results-actions">
          ${template ? "" : `<button class="btn-bordered" id="fix-results-btn">${icon("wandAndStars", { size: 18 })}<span>${t("context.title")}</span></button>`}
          <button class="btn-prominent" id="save-changes-btn">${template ? t("group.saveMeal") : t("meal.saveChanges")}</button>
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

      if (template) servings = 1; // a saved meal is always one serving; the multiplier is chosen when logging
      const renderServings = () => {
        if (!servValue) return;
        servValue.textContent = String(servings);
        panel.querySelector("#servings-card").classList.toggle("is-multiple", servings !== 1);
      };
      const renderFav = () => {
        if (!favBtn) return;
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
      panel.querySelector("#share-meal")?.addEventListener("click", async (ev) => {
        const btn = ev.currentTarget;
        btn.disabled = true;
        const { shareMeal } = await import("../social.js");
        // share what's on screen now, including unsaved portion edits
        const current = store.getFoodEntry(entry.id) ?? entry;
        const out = await shareMeal({ ...current, analysisItems: items, ...store.fieldsFromItems(items, servings) });
        btn.textContent = out.ok ? "✓" : "!";
        btn.title = out.ok ? t("social.shareDone") : (out.message || "");
      });

      favBtn?.addEventListener("click", () => {
        store.toggleFavorite(entry.id);
        renderFav();
      });
      renderServings();
      renderFav();

      const plateEl = panel.querySelector("#plate-card");
      const plateToggle = panel.querySelector("#plate-toggle");
      let plateOpen = false;
      /** Redraws the to-scale plate and the hand-size list; called whenever a portion changes. */
      const renderPlate = () => {
        if (!plateEl || !plateOpen) return;
        // what's actually eaten: every ingredient times the servings multiplier
        const live = items
          .map((i) => ({ ...i, gramsEstimate: (Number(i.gramsEstimate) || 0) * servings }))
          .filter((i) => i.gramsEstimate > 0);
        if (live.length === 0) { plateEl.innerHTML = ""; return; }
        const lang = currentLanguage() === "es" ? "es" : "en";
        const { svg, fullness, order } = plateSvg(live, { lang });
        const verdict = fullness > 1.05 ? t("plate.overflow") : fullness < 0.25 ? t("plate.light") : "";
        plateEl.innerHTML = `
          <div class="plate-title">${t("plate.title")}</div>
          <div class="plate-sub">${t("plate.sub")}${verdict ? ` <b>${verdict}</b>` : ""}</div>
          <div class="plate-draw">${svg}</div>
          <div class="plate-hands-head">${t("plate.hands")}</div>
          <ul class="plate-hands">
            ${live.map((i) => {
              const ref = handReference(i);
              const color = (KINDS[ref.kind] ?? { color: "#D9D4CC" }).color;
              const n = order.indexOf(i.name) + 1;
              return `<li><i style="background:${color}">${n > 0 ? n : "☕"}</i><span class="plate-food">${escapeAttr(i.name)}</span><b>${handLabel(ref, lang)}</b><span class="plate-g">${Math.round(i.gramsEstimate)} g</span></li>`;
            }).join("")}
          </ul>
          <div class="plate-note">${t("plate.approx")}</div>`;
      };
      plateToggle?.addEventListener("click", () => {
        plateOpen = !plateOpen;
        plateEl.classList.toggle("hidden", !plateOpen);
        plateToggle.setAttribute("aria-expanded", String(plateOpen));
        plateToggle.innerHTML = `🍽️ ${plateOpen ? t("plate.hide") : t("plate.open")}`;
        renderPlate();
      });

      const renderTotals = () => {
        totalsEl.innerHTML = TOTAL_DEFS.map((t) => {
          const total = items.reduce((acc, i) => acc + (i[t.key] ?? 0), 0) * servings;
          return `
            <div class="total-stat">
              <div class="total-stat-value numeric-text">${formatNumeric(total)}${t.suffix}</div>
              <div class="total-stat-label">${t.label}</div>
            </div>`;
        }).join("");
        const m = scaleMicros(sumMicros(items.map((i) => i.micros)), servings);
        totalsEl.insertAdjacentHTML("beforeend", m
          ? `<div class="results-micros-line">${["sodiumMg", "sugarG", "satFatG", "fiberG", "potassiumMg"].map((k) => `${t(`nutrients.${k}`)} ${formatMicro(k, m[k])}`).join(" · ")}</div>`
          : "");
        saveBtn.disabled = items.length === 0;
        renderPlate();
      };

      /**
       * Grams for one unit of this item, so amounts in ml or servings still have a weight
       * underneath (the portion drawing, the totals and the AI all work in grams).
       */
      const gramsPerUnit = (item) => {
        const unit = item.unit ?? "g";
        if (unit === "g") return 1;
        if (unit === "ml") return densityOf(item.name);
        return item.gramsPerServing || item.gramsEstimate || 1; // one serving = what it was
      };

      /** Fills in unit/amount for items that only ever had grams. */
      const ensureUnits = () => {
        for (const item of items) {
          if (!item.unit) item.unit = "g";
          if (!Number.isFinite(item.amount)) {
            item.amount = item.unit === "g" ? (Number(item.gramsEstimate) || 0) : (Number(item.amount) || 1);
          }
        }
      };
      ensureUnits();
      baselines = items.map(snapshotBaseline); // now that every item has an amount

      const renderItems = () => {
        if (items.length === 0) {
          itemsEl.innerHTML = `<div class="results-empty-items">No items left — add one back with "Fix results" or cancel.</div>`;
          renderTotals();
          return;
        }
        itemsEl.innerHTML = items.map((item, idx) => itemRowHtml(item, idx, openMicros.has(idx))).join("");

        items.forEach((item, idx) => {
          const row = itemsEl.querySelector(`[data-item-idx="${idx}"]`);
          if (!row) return;

          const nameInput = row.querySelector(".meal-item-name-input");
          nameInput.addEventListener("input", () => {
            item.name = nameInput.value;
          });

          /**
           * Sets this ingredient's amount (in ITS unit) and rescales calories and macros in
           * proportion. Grams are recomputed from the unit, so 250 ml of milk and 2 servings
           * of rice both end up weighing something sensible.
           */
          const setAmount = (amount) => {
            const base = baselines[idx];
            const baseAmount = Number(base.amount) || Number(base.gramsEstimate) || 0;
            const next = Math.max(0.1, Math.round(amount * 10) / 10);
            if (baseAmount > 0) {
              const factor = next / baseAmount;
              item.calories = base.calories * factor;
              item.proteinG = base.proteinG * factor;
              item.carbsG = base.carbsG * factor;
              item.fatG = base.fatG * factor;
              item.micros = scaleMicros(base.micros, factor);
            }
            item.amount = next;
            item.gramsEstimate = Math.max(1, Math.round(next * gramsPerUnit(item)));
            renderItems();
          };
          const setGrams = setAmount; // the quick buttons work in the item's own unit
          row.querySelectorAll("[data-unit]").forEach((b) =>
            b.addEventListener("click", () => {
              const next = b.dataset.unit;
              if (next === (item.unit ?? "g")) return;
              const grams = Number(item.gramsEstimate) || 0;
              if (next === "serving") {
                // one serving = what's on the plate right now
                item.gramsPerServing = Math.max(1, grams);
                item.amount = 1;
              } else if (next === "ml") {
                item.amount = Math.round((grams / densityOf(item.name)) * 10) / 10;
              } else {
                item.amount = Math.max(1, Math.round(grams));
              }
              item.unit = next;
              // the baseline moves with it, so later scaling is relative to this amount
              baselines[idx] = { ...item, micros: cleanMicros(item.micros) };
              renderItems();
            })
          );

          row.querySelectorAll("[data-mult]").forEach((b) =>
            b.addEventListener("click", () => setAmount((item.amount ?? item.gramsEstimate ?? 0) * Number(b.dataset.mult)))
          );
          row.querySelectorAll("[data-step]").forEach((b) =>
            b.addEventListener("click", () => {
              // +10 g steps by 10; in servings that would be absurd, so it steps by a half
              const step = (item.unit ?? "g") === "serving" ? Math.sign(Number(b.dataset.step)) * 0.5 : Number(b.dataset.step);
              setAmount((item.amount ?? item.gramsEstimate ?? 0) + step);
            })
          );

          row.querySelector("[data-item-delete]").addEventListener("click", () => {
            items.splice(idx, 1);
            baselines.splice(idx, 1);
            openMicros.clear();
            renderItems();
          });

          const details = row.querySelector(".micro-details");
          details?.addEventListener("toggle", () => {
            if (details.open) openMicros.add(idx); else openMicros.delete(idx);
          });
          // Typing a nutrient is new ground truth for this amount, same as typing a macro.
          wireMicroInputs(row, {
            getValue: (k) => item.micros?.[k] ?? null,
            onChange: (k, v) => {
              item.micros = cleanMicros({ ...(item.micros ?? {}), [k]: v });
              baselines[idx] = snapshotBaseline(item);
              const sumEl = row.querySelector(".micro-details > summary span");
              if (sumEl) sumEl.textContent = microsSummary(item.micros);
              renderTotals();
            },
          });

          for (const f of FIELD_DEFS) {
            const input = row.querySelector(`[data-field="${f.key}"]`);
            input.addEventListener("input", () => {
              const parsed = parseNumeric(input.value);
              if (parsed === null) return; // §13: leave model + buffer untouched mid-edit
              if (f.key === "amount") {
                // Amount rescale — skip transient zero/empty; rescale against baseline snapshot.
                if (!(parsed > 0)) return;
                const base = baselines[idx];
                const baseAmount = Number(base.amount) || Number(base.gramsEstimate) || 0;
                if (baseAmount > 0) {
                  const factor = parsed / baseAmount;
                  item.amount = parsed;
                  item.gramsEstimate = Math.max(1, Math.round(parsed * gramsPerUnit(item)));
                  item.calories = base.calories * factor;
                  item.proteinG = base.proteinG * factor;
                  item.carbsG = base.carbsG * factor;
                  item.fatG = base.fatG * factor;
                  item.micros = scaleMicros(base.micros, factor);
                  const sumEl = row.querySelector(".micro-details > summary span");
                  if (sumEl) sumEl.textContent = microsSummary(item.micros);
                  row.querySelectorAll("[data-micro]").forEach((mi) => {
                    const v = item.micros?.[mi.dataset.micro];
                    mi.value = v === null || v === undefined ? "" : String(mi.dataset.micro.endsWith("Mg") ? Math.round(v) : Math.round(v * 10) / 10);
                  });
                  // Re-display the four dependent fields (they're not focused — safe to rewrite).
                  for (const dep of FIELD_DEFS) {
                    if (dep.key === "amount") continue;
                    const depInput = row.querySelector(`[data-field="${dep.key}"]`);
                    if (depInput && document.activeElement !== depInput) {
                      depInput.value = formatNumeric(item[dep.key]);
                    }
                  }
                } else {
                  item.amount = parsed;
                  item.gramsEstimate = Math.max(1, Math.round(parsed * gramsPerUnit(item)));
                }
              } else {
                // Direct macro edit = new ground truth: update value AND its baseline (§12.2).
                item[f.key] = parsed;
                baselines[idx] = snapshotBaseline(item); // rescale later from here
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

      // Add more foods to this meal from the food search; they join as extra items.
      panel.querySelector("#add-to-meal").addEventListener("click", () => {
        openFoodSearchSheet({
          pickLabel: t("group.addToMeal"),
          onPick: (newItems) => {
            for (const it of newItems) {
              items.push({ ...it, id: it.id ?? `item-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}` });
            }
            ensureUnits();
            baselines = items.map(snapshotBaseline);
            renderItems();
          },
        });
      });

      panel.querySelector("#fix-results-btn")?.addEventListener("click", () => {
        openFixResultsSheet(entry, () => {
          // Correction succeeded — queue already persisted the new items to the store.
          const fresh = store.getFoodEntry(entry.id);
          if (fresh) {
            entry = fresh;
            items = (fresh.analysisItems ?? []).map((i) => ({ ...i }));
            ensureUnits();
            baselines = items.map(snapshotBaseline);
            renderItems();
          }
        });
      });

      saveBtn.addEventListener("click", () => {
        if (items.length === 0) return;
        if (template) {
          const typed = panel.querySelector("#template-name")?.value.trim();
          store.saveMealTemplate({ id: template.savedId, name: typed || null, items, photoDataUrl: entry.photoDataUrl ?? null });
          template.onSaved?.();
          close();
          return;
        }
        const name = queue.buildJoinedName(items) || "Analyzed meal";
        // items are one serving; the totals keep the servings multiplier
        store.updateFoodEntry(entry.id, {
          name,
          ...store.fieldsFromItems(items, servings),
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
    amount: item.amount,
    micros: cleanMicros(item.micros),
  };
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

function itemRowHtml(item, idx, microsOpen = false) {
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
            <div class="meal-field-unit">${f.key === "amount" ? ((item.unit ?? "g") === "serving" ? "×" : (item.unit ?? "g")) : f.unit}</div>
          </div>`
        ).join("")}
      </div>
      <div class="meal-item-units" role="group" aria-label="Unit">
        ${["g", "ml", "serving"].map((u) => `<button type="button" data-unit="${u}" aria-pressed="${(item.unit ?? "g") === u}">${u === "serving" ? t("edit.serving") : u}</button>`).join("")}
      </div>
      <div class="meal-item-portion" role="group" aria-label="Portion">
        <button type="button" data-step="-10" aria-label="less">${(item.unit ?? "g") === "serving" ? "−½" : "−10"}</button>
        ${[0.5, 0.75, 1.25, 1.5, 2].map((m) => `<button type="button" data-mult="${m}">×${m}</button>`).join("")}
        <button type="button" data-step="10" aria-label="more">${(item.unit ?? "g") === "serving" ? "+½" : "+10"}</button>
      </div>
      <details class="micro-details"${microsOpen ? " open" : ""}>
        <summary><span>${escapeHtml(microsSummary(item.micros))}</span></summary>
        ${microInputsHtml(item.micros)}
      </details>
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
            title: t("context.title"),
            leading: { label: t("app.cancel"), disabled: submitting },
            trailing: { label: t("context.submit"), bold: true, disabled: true },
          })}
          <div class="sheet-panel-body">
            <div class="fix-results-body">
              <div class="fix-results-prompt">${t("context.prompt")}</div>
              <div class="ctx-chips">
                ${["oil", "nooil", "butter", "restaurant", "half", "double", "grams", "homemade"]
                  .map((k) => `<button type="button" class="ctx-chip" data-ctx="${k}">${t(`context.chips.${k}`)}</button>`).join("")}
              </div>
              <textarea class="describe-textarea" id="fix-input" rows="4" placeholder="${t("context.placeholder")}" ${submitting ? "disabled" : ""}></textarea>
              ${errorMessage ? `<div class="fix-results-error">${escapeHtml(errorMessage)}</div>` : ""}
              <div class="fix-results-progress ${submitting ? "" : "hidden"}" id="fix-progress"><div class="spinner"></div><span>${t("context.working")}</span></div>
            </div>
          </div>
        `;

        const textarea = panel.querySelector("#fix-input");
        const submitBtn = panel.querySelector('[data-nav="trailing"]');

        textarea.addEventListener("input", () => {
          submitBtn.disabled = textarea.value.trim() === "" || submitting;
        });

        // Tapping a chip writes the sentence for them; they can still edit or add to it.
        panel.querySelectorAll("[data-ctx]").forEach((chip) => chip.addEventListener("click", () => {
          const phrase = t(`context.chipText.${chip.dataset.ctx}`);
          const current = textarea.value.trim();
          if (current.toLowerCase().includes(phrase.toLowerCase())) return;
          textarea.value = current ? `${current}, ${phrase}` : phrase;
          chip.classList.add("is-on");
          textarea.dispatchEvent(new Event("input"));
        }));

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
