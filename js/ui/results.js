// results.js — Meal Results review/edit sheet (MealResultsView.swift), SPEC-UI.md §12.
// Edits a local copy of the entry's analysisItems; "Save changes" persists onto the SAME entry.
// Grams edits rescale the other four fields proportionally against a per-item baseline snapshot;
// direct macro edits become the new baseline (§12.2). "Fix results" re-runs analysis with an
// appended correction via queue.submitCorrection.

import { safeSrc } from "../safe-src.js";
import * as store from "../store.js";
import { t, currentLanguage } from "../i18n.js";
import * as queue from "../queue.js";
import { openAddToMealSheet } from "./add-to-meal.js";
import { icon } from "./icons.js";
import { openSheet, navBar, wireNavBar } from "./sheet.js";
import { parseNumeric, formatNumeric } from "./numeric-field.js";
import { scaleMicros, cleanMicros, sumMicros } from "../nutrition.js";
import { microsSummary, microInputsHtml, wireMicroInputs, formatMicro } from "./micros.js";
import { sureBadgeHtml } from "./questions.js";
import { applyCookingFat, fatGrams } from "../cooking-fat.js";
import { plateSvg, handReference, handLabel, densityOf, _KINDS_FOR_TESTS as KINDS } from "./portion-plate.js";

const FIELD_DEFS = [
  { key: "amount", get label() { return t("ui.amount"); }, unit: "" },
  { key: "calories", get label() { return t("ui.kcal"); }, unit: "" },
  { key: "proteinG", get label() { return t("ui.protein"); }, unit: "g" },
  { key: "carbsG", get label() { return t("ui.carbs"); }, unit: "g" },
  { key: "fatG", get label() { return t("ui.fat"); }, unit: "g" },
];

const TOTAL_DEFS = [
  { key: "calories", get label() { return t("ui.kcal"); }, suffix: "" },
  { key: "proteinG", get label() { return t("ui.protein"); }, suffix: "g" },
  { key: "carbsG", get label() { return t("ui.carbs"); }, suffix: "g" },
  { key: "fatG", get label() { return t("ui.fat"); }, suffix: "g" },
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
  let addedFoods = false; // foods added with "+ Add food" turn the meal into a group
  let pending = []; // foods on their way from "+ Add food" (a photo or words being analysed)
  const askWeight = new Map(); // item idx -> the unit asked for, while "1 serving weighs … g" shows
  let sheetClosed = false;

  openSheet({
    onClosed: () => { sheetClosed = true; },
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
          ${!template && (entry.cookingFat === "assumed" || entry.cookingFatChoice) ? `<div class="fat-card" id="fat-card"></div>` : ""}
          <div class="results-items-section-header" id="items-header">${t("meal.items")}</div>
          <div class="ios-section" style="margin-bottom:0;">
            <div class="ios-section-body" id="results-items"></div>
          </div>
          <div class="results-items-section-footer">${t("meal.itemsHint")}</div>
          <button type="button" class="add-to-meal-btn" id="add-to-meal">＋ ${t("group.addFood")}</button>
          ${template ? "" : entry.leftovers?.removedKcal > 0
            ? `<div class="left-note">${icon("plateHalf", { size: 15 })}<span>${t("left.mealNote", { n: Math.round(entry.leftovers.removedKcal) })}</span><button type="button" id="left-undo-meal">${t("left.undo")}</button></div>`
            : `<button type="button" class="add-to-meal-btn" id="left-meal">${icon("plateHalf", { size: 15 })} ${t("left.mealCta")}</button>`}
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
      // Servings are part of the draft like every other number here: the totals show the result
      // straight away, and nothing is written until "Save changes" (Cancel leaves the meal as it
      // was). Items always describe one serving of the meal.
      const servValue = panel.querySelector("#servings-value");
      const favBtn = panel.querySelector("#fav-toggle");
      let servings = store.normalizeServings(entry.servings);

      if (template) servings = 1; // a saved meal is always one serving; the multiplier is chosen when logging
      const renderServings = () => {
        if (!servValue) return;
        servValue.textContent = String(servings);
        panel.querySelector("#servings-card").classList.toggle("is-multiple", servings !== 1);
        panel.querySelector("#items-header").textContent = servings !== 1 ? t("meal.itemsPerServing") : t("meal.items");
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

      // what the meal counted for when the sheet opened, so every change shows its effect
      const savedKcal = template ? null : Number(entry.calories);
      const renderTotals = () => {
        const kcal = Math.round(items.reduce((acc, i) => acc + (Number(i.calories) || 0), 0) * servings);
        const notes = [];
        if (servings !== 1) notes.push(t("meal.totalFor", { n: servings }));
        if (Number.isFinite(savedKcal) && Math.round(savedKcal) !== kcal) notes.push(t("meal.wasKcal", { kcal: Math.round(savedKcal) }));
        totalsEl.innerHTML = (notes.length ? `<div class="totals-note">${notes.join(" · ")}</div>` : "") + TOTAL_DEFS.map((d) => {
          const total = items.reduce((acc, i) => acc + (Number(i[d.key]) || 0), 0) * servings;
          return `
            <div class="total-stat">
              <div class="total-stat-value numeric-text">${Math.round(total)}${d.suffix}</div>
              <div class="total-stat-label">${d.label}</div>
            </div>`;
        }).join("");
        // just the four totals, rounded: each food lists its own nutrients above
        saveBtn.disabled = items.length === 0 || pending.some((p) => !p.error);
        renderPlate();
      };

      /**
       * Grams for one unit of this item, so amounts in ml or servings still have a weight
       * underneath (the portion drawing, the totals and the AI all work in grams). Null when a
       * serving's weight isn't known — never "1 g".
       */
      const gramsPerUnit = (item) => {
        const unit = item.unit ?? "g";
        if (unit === "g") return 1;
        if (unit === "ml") return densityOf(item.name);
        return Number(item.gramsPerServing) > 0 ? Number(item.gramsPerServing) : null;
      };

      /** Fills in unit/amount for items that only ever had grams, and the weight of a serving. */
      const ensureUnits = () => {
        for (const item of items) {
          const grams = Number(item.gramsEstimate) || 0;
          // no unit and no weight: it was one portion of something (a manual food, a favourite)
          if (!item.unit) item.unit = grams > 0 || Number(item.amount) > 0 ? "g" : "serving";
          if (!(Number(item.amount) > 0)) {
            item.amount = item.unit === "g" ? grams : item.unit === "ml" && grams > 0 ? Math.round((grams / densityOf(item.name)) * 10) / 10 : 1;
          }
          if (item.unit === "serving" && !(Number(item.gramsPerServing) > 0) && grams > 0) {
            item.gramsPerServing = Math.round(grams / item.amount); // 2 servings, 300 g -> 150 g each
          }
          if (grams <= 0 && item.unit !== "g") {
            const gpu = gramsPerUnit(item);
            if (gpu) item.gramsEstimate = Math.round(item.amount * gpu);
          }
        }
      };
      ensureUnits();
      baselines = items.map(snapshotBaseline); // now that every item has an amount

      /** Bakes the servings multiplier into the foods: added foods then count once, not ×servings. */
      const foldServings = () => {
        if (template || servings === 1) return;
        items = items.map((i) => store.scaleItem(i, servings));
        servings = 1;
        renderServings();
      };

      const newId = () => `item-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      /** Foods from "+ Add food" join the meal. */
      const addItems = (newItems) => {
        if (!Array.isArray(newItems) || newItems.length === 0) return;
        foldServings();
        addedFoods = true;
        for (const it of newItems) items.push({ ...it, id: it.id ?? newId() });
        ensureUnits();
        baselines = items.map(snapshotBaseline);
        askWeight.clear();
        renderItems();
      };
      /** A photo or words being analysed: a row says so until the foods arrive (or it fails). */
      const addWork = (label, work) => {
        const job = { id: newId(), label, error: null };
        pending.push(job);
        renderItems();
        work.then((newItems) => {
          if (sheetClosed) return;
          pending = pending.filter((p) => p !== job);
          addItems(newItems);
          if (!newItems?.length) renderItems();
        }).catch((err) => {
          if (sheetClosed) return;
          const message = String(err?.message ?? "");
          if (!message) pending = pending.filter((p) => p !== job); // closed without adding
          else job.error = message;
          renderItems();
        });
      };
      const pendingHtml = () => pending.map((p) => p.error
        ? `<div class="meal-item-pending is-error" role="alert"><span><b>${escapeHtml(p.label)}</b> ${escapeHtml(p.error)}</span><button type="button" data-pending-x="${p.id}" aria-label="${escapeAttr(t("app.close"))}">${icon("xmark", { size: 14 })}</button></div>`
        : `<div class="meal-item-pending" role="status"><span class="spinner" aria-hidden="true"></span><span>${escapeHtml(p.label)} · ${t("addTo.working")}</span></div>`).join("");
      const wirePending = () => itemsEl.querySelectorAll("[data-pending-x]").forEach((b) => b.addEventListener("click", () => {
        pending = pending.filter((p) => p.id !== b.dataset.pendingX);
        renderItems();
      }));

      const renderItems = () => {
        if (items.length === 0) {
          itemsEl.innerHTML = (pending.length ? "" : `<div class="results-empty-items">${t("meal.noItems")}</div>`) + pendingHtml();
          wirePending();
          renderTotals();
          return;
        }
        itemsEl.innerHTML = items.map((item, idx) => itemRowHtml(item, idx, openMicros.has(idx), { gpu: gramsPerUnit(item), asking: askWeight.get(idx) })).join("") + pendingHtml();
        wirePending();

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
            const gpu = gramsPerUnit(item);
            item.gramsEstimate = gpu ? Math.max(1, Math.round(next * gpu)) : 0;
            renderItems();
          };
          const setGrams = setAmount; // the quick buttons work in the item's own unit
          /** Same food, measured another way: 200 g of milk is 194 ml, what's there is 1 serving. */
          const switchUnit = (next) => {
            const grams = Number(item.gramsEstimate) || 0;
            if (next === "serving") {
              // one serving = what's on the plate right now (its weight unknown if that is)
              if (grams > 0) item.gramsPerServing = grams;
              else delete item.gramsPerServing;
              item.amount = 1;
            } else if (next === "ml") {
              item.amount = Math.max(1, Math.round((grams / densityOf(item.name)) * 10) / 10);
            } else {
              item.amount = Math.max(1, Math.round(grams));
            }
            item.unit = next;
            askWeight.delete(idx);
            // the baseline moves with it, so later scaling is relative to this amount
            baselines[idx] = snapshotBaseline(item);
            renderItems();
          };
          row.querySelectorAll("[data-unit]").forEach((b) =>
            b.addEventListener("click", () => {
              const next = b.dataset.unit;
              if (next === (item.unit ?? "g")) { askWeight.delete(idx); renderItems(); return; }
              // servings of unknown weight: ask what one weighs instead of guessing "1 g"
              if (next !== "serving" && !(Number(item.gramsEstimate) > 0)) {
                askWeight.set(idx, next);
                renderItems();
                setTimeout(() => itemsEl.querySelector(`[data-item-idx="${idx}"] [data-weigh-input]`)?.focus(), 30);
                return;
              }
              switchUnit(next);
            })
          );
          const weighInput = row.querySelector("[data-weigh-input]");
          const applyWeight = () => {
            const g = parseNumeric(weighInput?.value ?? "");
            if (!(g > 0) || g > 5000) { weighInput?.focus(); return; }
            item.gramsPerServing = Math.round(g);
            item.gramsEstimate = Math.max(1, Math.round(item.amount * g));
            const next = askWeight.get(idx);
            if (next) switchUnit(next); else renderItems();
          };
          weighInput?.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); applyWeight(); } });
          row.querySelector("[data-weigh-ok]")?.addEventListener("click", applyWeight);
          row.querySelector("[data-weigh-x]")?.addEventListener("click", () => { askWeight.delete(idx); renderItems(); });
          row.querySelector("[data-weigh-open]")?.addEventListener("click", () => { askWeight.set(idx, null); renderItems(); setTimeout(() => itemsEl.querySelector(`[data-item-idx="${idx}"] [data-weigh-input]`)?.focus(), 30); });

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
            askWeight.clear();
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
                  item.gramsEstimate = gramsPerUnit(item) ? Math.max(1, Math.round(parsed * gramsPerUnit(item))) : 0;
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
                  item.gramsEstimate = gramsPerUnit(item) ? Math.max(1, Math.round(parsed * gramsPerUnit(item))) : 0;
                }
                const gEl = row.querySelector(".meal-item-grams");
                if (gEl && gramsPerUnit(item) && (item.unit ?? "g") !== "g") gEl.textContent = `≈ ${Math.round(item.gramsEstimate)} g`;
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

      // leftovers: photograph what wasn't eaten (js/ui/leftovers-sheet.js); the meal reopens updated
      panel.querySelector("#left-meal")?.addEventListener("click", () => {
        close();
        import("./leftovers-sheet.js").then((m) => m.openLeftoversSheet({ entryId: entry.id }));
      });
      panel.querySelector("#left-undo-meal")?.addEventListener("click", async () => {
        const { undoLeftovers } = await import("../leftovers.js");
        undoLeftovers(entry.id);
        close();
      });
      // "+ Add food": every way in that logging has (camera, words, voice, favourites, database,
      // by hand); the foods join this meal (js/ui/add-to-meal.js)
      panel.querySelector("#add-to-meal").addEventListener("click", () => {
        openAddToMealSheet({ onItems: addItems, onWork: addWork, mealId: entry.id });
      });

      panel.querySelector("#fix-results-btn")?.addEventListener("click", () => {
        openFixResultsSheet(entry, () => {
          // Correction succeeded — queue already persisted the new items to the store.
          const fresh = store.getFoodEntry(entry.id);
          if (fresh) {
            entry = fresh;
            items = (fresh.analysisItems ?? []).map((i) => ({ ...i }));
            askWeight.clear();
            ensureUnits();
            baselines = items.map(snapshotBaseline);
            renderItems();
          }
        });
      });

      // --- cooking fat: None / A little / A lot, replacing the analysis's assumption ---------
      const fatCard = panel.querySelector("#fat-card");
      let fatChoice = entry.cookingFatChoice ?? null;
      const renderFat = () => {
        if (!fatCard) return;
        const level = fatChoice ?? null;
        const g = Math.round(fatGrams(items));
        fatCard.innerHTML = `
          <div class="fat-q">${t("fat.question")}</div>
          <div class="fat-opts" role="group" aria-label="${escapeAttr(t("fat.question"))}">
            ${["none", "little", "lot"].map((k) => `<button type="button" data-fat="${k}" aria-pressed="${level === k}">${t(`fat.${k}`)}</button>`).join("")}
          </div>
          <div class="fat-note">${level ? t(`fat.note_${level}`) : t("fat.assumed", { g })}</div>`;
        fatCard.querySelectorAll("[data-fat]").forEach((b) => b.addEventListener("click", () => {
          fatChoice = b.dataset.fat;
          items = applyCookingFat(items, fatChoice, { name: t("fat.itemName") });
          baselines = items.map(snapshotBaseline);
          openMicros.clear();
          renderItems();
          renderFat();
        }));
      };
      renderFat();

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
          servings,
          ...store.fieldsFromItems(items, servings),
          analysisItems: items,
          ...(addedFoods && items.length > 1 ? { grouped: true } : {}),
          ...(fatChoice ? { cookingFatChoice: fatChoice } : {}),
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
    return `<div class="results-thumb-wrap"><img class="results-thumb" src="${safeSrc(entry.photoDataUrl)}" alt="" />${sureBadgeHtml(entry, "sure-badge is-big")}</div>`;
  }
  if (typeof entry.analysisDescription === "string" && entry.analysisDescription.trim() !== "") {
    return `
      <div class="results-desc-quote">
        ${icon("textBubbleFill", { size: 15 })}
        <div class="results-desc-quote-text">“${escapeHtml(entry.analysisDescription)}”</div>
        ${sureBadgeHtml(entry, "sure-badge is-inline")}
      </div>`;
  }
  return "";
}

function itemRowHtml(item, idx, microsOpen = false, { gpu = null, asking } = {}) {
  const lowConfidence = typeof item.confidence === "number" && item.confidence < 0.5;
  const unit = item.unit ?? "g";
  const grams = Number(item.gramsEstimate) || 0;
  // under servings and ml, what it weighs; a serving of unknown weight says so and offers to set it
  const weightLine = unit === "g" ? ""
    : grams > 0 ? `<span class="meal-item-grams">≈ ${Math.round(grams)} g</span>`
    : `<button type="button" class="meal-item-grams is-unknown" data-weigh-open>${t("meal.weightUnknown")}</button>`;
  return `
    <div class="meal-item-row" data-item-idx="${idx}">
      <div class="meal-item-top">
        <input type="text" class="meal-item-name-input" value="${escapeAttr(item.name)}" />
        ${item.grounded === true ? `<span class="meal-item-badge" role="img" aria-label="Verified against USDA nutrition database.">${icon("leafFill", { size: 16, color: "var(--sc-green)" })}</span>` : ""}
        <button class="meal-item-delete" data-item-delete aria-label="Delete item">${icon("trashFill", { size: 16, color: "var(--sc-red)" })}</button>
      </div>
      ${lowConfidence ? `<div class="meal-item-warning">${icon("exclamationTriangleFill", { size: 13, color: "var(--sc-orange)" })}<span>${t("meal.doubleCheck")}</span></div>` : ""}
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
      <div class="meal-item-units" role="group" aria-label="${escapeAttr(t("meal.unit"))}">
        ${["g", "ml", "serving"].map((u) => `<button type="button" data-unit="${u}" aria-pressed="${unit === u}">${u === "serving" ? t("edit.serving") : u}</button>`).join("")}
      </div>
      ${weightLine && asking === undefined ? `<div class="meal-item-weight">${weightLine}</div>` : ""}
      ${asking !== undefined ? `
      <div class="meal-item-weigh">
        <label for="weigh-${idx}">${t("meal.oneServingWeighs")}</label>
        <input type="text" id="weigh-${idx}" inputmode="decimal" data-weigh-input placeholder="150" value="${gpu && unit === "serving" ? Math.round(gpu) : ""}">
        <span>g</span>
        <button type="button" class="is-ok" data-weigh-ok>${t("meal.setWeight")}</button>
        <button type="button" data-weigh-x aria-label="${escapeAttr(t("app.cancel"))}">${icon("xmark", { size: 13 })}</button>
      </div>` : ""}
      <div class="meal-item-portion" role="group" aria-label="${escapeAttr(t("meal.portion"))}">
        <button type="button" data-step="-10" aria-label="${escapeAttr(t("meal.less"))}">${unit === "serving" ? "−½" : "−10"}</button>
        ${[0.5, 0.75, 1.25, 1.5, 2].map((m) => `<button type="button" data-mult="${m}">×${m}</button>`).join("")}
        <button type="button" data-step="10" aria-label="${escapeAttr(t("meal.more"))}">${unit === "serving" ? "+½" : "+10"}</button>
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
