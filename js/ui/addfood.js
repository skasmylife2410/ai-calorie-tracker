// addfood.js — manual entry/edit form (AddFoodView.swift), SPEC-UI.md §7.
// Presented as a sheet in 4 contexts: new/blank, edit existing, barcode-hit prefill, barcode-miss.

import * as store from "../store.js";
import { wireNumericInput, formatNumeric, parseNumeric } from "./numeric-field.js";
import { densityOf } from "./portion-plate.js";
import { t } from "../i18n.js";
import { openSheet, navBar, wireNavBar } from "./sheet.js";
import { cleanMicros, scaleMicros } from "../nutrition.js";
import { microInputsHtml, wireMicroInputs, refreshMicroInputs } from "./micros.js";

const MACRO_FIELDS = [
  { key: "calories", get label() { return t("ui.calories"); }, unit: "kcal", decimal: false },
  { key: "proteinG", get label() { return t("ui.protein"); }, unit: "g", decimal: true },
  { key: "carbsG", get label() { return t("ui.carbs"); }, unit: "g", decimal: true },
  { key: "fatG", get label() { return t("ui.fat"); }, unit: "g", decimal: true },
];

/**
 * @param {{entry?:object, prefill?:object, prefillBarcode?:string, failureReason?:string, onSaved?:(entry)=>void}} opts
 */
export function openAddFoodSheet({ entry = null, prefill = null, prefillBarcode = null, failureReason = null, timestamp = null, onSaved } = {}) {
  const isEditing = entry != null;
  const draft = {
    name: entry?.name ?? prefill?.name ?? "",
    calories: entry?.calories ?? prefill?.calories ?? 0,
    proteinG: entry?.proteinG ?? prefill?.proteinG ?? 0,
    carbsG: entry?.carbsG ?? prefill?.carbsG ?? 0,
    fatG: entry?.fatG ?? prefill?.fatG ?? 0,
    micros: cleanMicros(entry ? entry.micros : prefill?.micros),
    // How much was eaten. Known for search results ("per 100 g" -> 100 g); for manual entries it
    // starts unknown, and the first number typed becomes the baseline rather than rescaling.
    amount: entry?.amount ?? prefillAmount(prefill),
    amountUnit: entry?.amountUnit ?? (prefill?.servingDescription?.includes("ml") ? "ml" : "g"),
    servingGrams: entry?.servingGrams ?? null, // grams in one serving, once known
  };
  const source = entry?.source ?? (prefill || prefillBarcode ? "barcode" : "manual");

  let footnote = null;
  if (prefill) {
    footnote = `${prefill.servingDescription} — adjust to what you actually ate`;
    if (prefill.source === "usda") footnote += `. ${t("edit.fromUsda")}`;
    else if (prefill.source === "off") footnote += `. ${t("edit.fromOff")}`;
  } else if (prefillBarcode && failureReason) {
    footnote = `Barcode ${prefillBarcode} not found — ${failureReason}. Enter manually`;
  } else if (prefillBarcode) {
    footnote = `Barcode ${prefillBarcode} not found — enter manually`;
  }

  openSheet({
    render(panel, close) {
      panel.innerHTML = `
        ${navBar({
          title: isEditing ? t("edit.titleEdit") : t("edit.titleAdd"),
          leading: { label: t("app.cancel") },
          trailing: { label: t("app.save"), bold: true, disabled: draft.name.trim() === "" },
        })}
        <div class="sheet-panel-body">
          <div class="ios-form">
            <div class="ios-section">
              <div class="ios-section-header">${t("edit.food")}</div>
              <div class="ios-section-body">
                <div class="ios-row">
                  <input type="text" class="numeric-input name-input" id="food-name" placeholder="${t("edit.name")}" value="${escapeAttr(draft.name)}" />
                </div>
              </div>
            </div>
            <div class="ios-section">
              <div class="ios-section-header">${t("edit.amount")}</div>
              <div class="ios-section-body">
                <div class="amount-row">
                  <input type="text" class="amount-input" id="food-amount" placeholder="150" />
                  <div class="amount-units" role="group">
                    ${["g", "ml", "serving"].map((u) => `<button type="button" data-unit="${u}" aria-pressed="${u === draft.amountUnit}">${t(`edit.${u}`)}</button>`).join("")}
                  </div>
                </div>
                <div class="amount-quick">
                  ${[0.5, 0.75, 1.25, 1.5, 2].map((m) => `<button type="button" data-mult="${m}">×${m}</button>`).join("")}
                </div>
              </div>
              <div class="ios-section-footer" id="amount-hint">${draft.amount ? t("edit.amountHint") : t("edit.amountHintFirst")}</div>
            </div>
            <div class="ios-section">
              <div class="ios-section-header">${t("edit.nutrition")}</div>
              <div class="ios-section-body">
                ${MACRO_FIELDS.map(
                  (f) => `
                  <div class="ios-row">
                    <div class="ios-row-label">${f.label}</div>
                    <div class="ios-row-spacer"></div>
                    <input type="text" class="numeric-input" id="food-${f.key}" placeholder="0" />
                    <div class="ios-row-unit">${f.unit}</div>
                  </div>`
                ).join("")}
              </div>
              ${footnote ? `<div class="ios-section-footer">${escapeAttr(footnote)}</div>` : ""}
              ${prefill?.suspect ? `<div class="ios-section-footer food-suspect" id="food-suspect"><i class="food-suspect-mark" aria-hidden="true"></i>${escapeAttr(t("edit.suspect"))}</div>` : ""}
            </div>
            <div class="ios-section">
              <details class="micro-section" id="micro-section"${draft.micros ? " open" : ""}>
                <summary>${t("nutrients.more")}</summary>
                ${microInputsHtml(draft.micros)}
              </details>
              <div class="ios-section-footer">${t("nutrients.moreHint")}</div>
            </div>
            ${isEditing && entry?.photoDataUrl ? `<button type="button" class="share-row" id="share-food">↗︎ ${t("social.share")}</button>` : ""}
          </div>
        </div>
      `;

      const saveBtn = panel.querySelector('[data-nav="trailing"]');
      const nameInput = panel.querySelector("#food-name");
      nameInput.addEventListener("input", () => {
        draft.name = nameInput.value;
        saveBtn.disabled = draft.name.trim() === "";
      });

      const macroInputs = {};
      const refreshMacros = () => {
        for (const f of MACRO_FIELDS) {
          if (macroInputs[f.key] && document.activeElement !== macroInputs[f.key]) {
            macroInputs[f.key].value = formatNumeric(draft[f.key], { decimal: f.decimal });
          }
        }
      };

      /** Scales calories and all macros by `factor`, keeping one decimal. */
      const scaleBy = (factor) => {
        if (!Number.isFinite(factor) || factor <= 0) return;
        draft.calories = Math.round(draft.calories * factor);
        for (const k of ["proteinG", "carbsG", "fatG"]) draft[k] = Math.round(draft[k] * factor * 10) / 10;
        draft.micros = scaleMicros(draft.micros, factor);
        refreshMacros();
        refreshMicroInputs(panel, draft.micros);
      };

      const amountInput = panel.querySelector("#food-amount");
      const amountHint = panel.querySelector("#amount-hint");

      // The numbers as they were when the amount started changing. Typing rescales from here on
      // every keystroke, so the result shows before leaving the field (and before saving), and
      // going 150 → 15 → 150 lands exactly where it started.
      let snap = null;
      const takeSnap = () => {
        snap = { amount: draft.amount, calories: draft.calories, proteinG: draft.proteinG, carbsG: draft.carbsG, fatG: draft.fatG, micros: draft.micros };
      };
      const fromSnap = (amount) => {
        if (!snap) takeSnap();
        if (snap.amount && amount && amount !== snap.amount) {
          const f = amount / snap.amount;
          draft.calories = Math.round(snap.calories * f);
          for (const k of ["proteinG", "carbsG", "fatG"]) draft[k] = Math.round(snap[k] * f * 10) / 10;
          draft.micros = scaleMicros(snap.micros, f);
        } else {
          Object.assign(draft, { calories: snap.calories, proteinG: snap.proteinG, carbsG: snap.carbsG, fatG: snap.fatG, micros: snap.micros });
        }
        // no amount yet: the first number typed just records what this entry already is
        draft.amount = amount ?? snap.amount;
        refreshMacros();
        refreshMicroInputs(panel, draft.micros);
      };
      amountInput.addEventListener("focus", takeSnap);
      amountInput.addEventListener("input", () => {
        const v = parseNumeric(amountInput.value);
        // half-typed or cleared: show the numbers as they were until there's an amount again
        fromSnap(v !== null && v > 0 && v <= 10000 ? v : null);
      });
      wireNumericInput(amountInput, {
        getValue: () => draft.amount,
        decimal: true,
        min: 0,
        max: 10000,
        onCommit: (v) => {
          if (v > 0) fromSnap(v);
          else fromSnap(null);
          snap = null;
          if (draft.amount) amountHint.textContent = t("edit.amountHint");
        },
      });

      /** The amount in grams, or null when it can't be known (servings of unknown size). */
      const gramsOf = (amount, unit) => {
        if (!(amount > 0)) return null;
        if (unit === "ml") return amount * densityOf(draft.name);
        if (unit === "serving") return draft.servingGrams ? amount * draft.servingGrams : null;
        return amount;
      };
      const round1 = (n) => Math.round(n * 10) / 10;

      // Switching unit keeps the same food: 200 g of milk shows as 194 ml, and whatever is on
      // the plate becomes "1 serving". The numbers below don't change, only how it's measured.
      panel.querySelectorAll("[data-unit]").forEach((b) =>
        b.addEventListener("click", () => {
          const next = b.dataset.unit;
          const prev = draft.amountUnit;
          if (next === prev) return;
          const grams = gramsOf(draft.amount, prev);
          if (next === "serving") {
            if (prev !== "serving" && grams) draft.servingGrams = Math.round(grams);
            draft.amount = 1;
          } else if (grams === null) {
            draft.amount = null; // a serving of unknown weight: ask for the amount once
          } else {
            draft.amount = next === "ml" ? round1(grams / densityOf(draft.name)) : Math.round(grams);
          }
          draft.amountUnit = next;
          snap = null;
          amountInput.value = formatNumeric(draft.amount, { decimal: true });
          panel.querySelectorAll("[data-unit]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
          amountHint.textContent = draft.amount ? t("edit.amountHint") : t("edit.amountHintFirst");
        })
      );

      // quick multipliers: half a portion, one and a half, double
      panel.querySelectorAll("[data-mult]").forEach((b) =>
        b.addEventListener("click", () => {
          const m = Number(b.dataset.mult);
          scaleBy(m);
          if (draft.amount) {
            draft.amount = Math.round(draft.amount * m * 10) / 10;
            amountInput.value = formatNumeric(draft.amount, { decimal: true });
          }
        })
      );

      for (const f of MACRO_FIELDS) {
        const input = panel.querySelector(`#food-${f.key}`);
        macroInputs[f.key] = input;
        wireNumericInput(input, {
          getValue: () => draft[f.key],
          decimal: f.decimal,
          min: 0,
          max: f.key === "calories" ? 20000 : 2000,
          onCommit: (v) => {
            draft[f.key] = v;
          },
        });
      }

      wireMicroInputs(panel, {
        getValue: (k) => draft.micros?.[k] ?? null,
        onChange: (k, v) => { draft.micros = cleanMicros({ ...(draft.micros ?? {}), [k]: v }); },
      });

      panel.querySelector("#share-food")?.addEventListener("click", async (ev) => {
        const btn = ev.currentTarget;
        btn.disabled = true;
        const { shareMeal } = await import("../social.js");
        const out = await shareMeal({ ...entry, name: draft.name, calories: draft.calories, proteinG: draft.proteinG, carbsG: draft.carbsG, fatG: draft.fatG, micros: draft.micros });
        btn.textContent = out.ok ? `✓ ${t("social.shareDone")}` : (out.message || t("errors.generic"));
      });

      wireNavBar(panel, {
        onLeading: () => close(),
        onTrailing: () => {
          const trimmedName = draft.name.trim();
          if (trimmedName === "") return;
          let saved;
          if (isEditing) {
            saved = store.updateFoodEntry(entry.id, {
              name: trimmedName,
              calories: draft.calories,
              proteinG: draft.proteinG,
              carbsG: draft.carbsG,
              fatG: draft.fatG,
              micros: draft.micros,
              amount: draft.amount,
              amountUnit: draft.amountUnit,
              servingGrams: draft.servingGrams,
              // editing by hand resets the servings multiplier; the numbers ARE the meal now
              servings: 1,
              base: { calories: draft.calories, proteinG: draft.proteinG, carbsG: draft.carbsG, fatG: draft.fatG, micros: draft.micros },
            });
          } else {
            saved = store.addFoodEntry({
              name: trimmedName,
              calories: draft.calories,
              proteinG: draft.proteinG,
              carbsG: draft.carbsG,
              fatG: draft.fatG,
              micros: draft.micros,
              amount: draft.amount,
              amountUnit: draft.amountUnit,
              servingGrams: draft.servingGrams,
              source,
              timestamp: timestamp ?? Date.now(),
            });
          }
          if (typeof onSaved === "function") onSaved(saved);
          close();
        },
      });
    },
  });
}

function escapeAttr(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}


/** "per 100 g" -> 100, "per serving (30 g)" -> 30, anything else -> null (unknown). */
function prefillAmount(prefill) {
  const desc = String(prefill?.servingDescription ?? "");
  const hundred = desc.match(/per\s+100\s*(g|ml)/i);
  if (hundred) return 100;
  const inner = desc.match(/\((\d+(?:[.,]\d+)?)\s*(g|ml)\)/i);
  if (inner) return Number(inner[1].replace(",", "."));
  return null;
}
