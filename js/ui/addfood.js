// addfood.js — manual entry/edit form (AddFoodView.swift), SPEC-UI.md §7.
// Presented as a sheet in 4 contexts: new/blank, edit existing, barcode-hit prefill, barcode-miss.

import * as store from "../store.js";
import { wireNumericInput, formatNumeric } from "./numeric-field.js";
import { t } from "../i18n.js";
import { openSheet, navBar, wireNavBar } from "./sheet.js";

const MACRO_FIELDS = [
  { key: "calories", label: "Calories", unit: "kcal", decimal: false },
  { key: "proteinG", label: "Protein", unit: "g", decimal: true },
  { key: "carbsG", label: "Carbs", unit: "g", decimal: true },
  { key: "fatG", label: "Fat", unit: "g", decimal: true },
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
    // How much was eaten. Known for search results ("per 100 g" -> 100 g); for manual entries it
    // starts unknown, and the first number typed becomes the baseline rather than rescaling.
    amount: entry?.amount ?? prefillAmount(prefill),
    amountUnit: entry?.amountUnit ?? (prefill?.servingDescription?.includes("ml") ? "ml" : "g"),
  };
  const source = entry?.source ?? (prefill || prefillBarcode ? "barcode" : "manual");

  let footnote = null;
  if (prefill) {
    footnote = `${prefill.servingDescription} — adjust to what you actually ate`;
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
            </div>
            ${isEditing ? `<button type="button" class="share-row" id="share-food">↗︎ ${t("social.share")}</button>` : ""}
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
        refreshMacros();
      };

      const amountInput = panel.querySelector("#food-amount");
      const amountHint = panel.querySelector("#amount-hint");
      wireNumericInput(amountInput, {
        getValue: () => draft.amount,
        decimal: true,
        min: 0,
        max: 10000,
        onCommit: (v) => {
          if (v <= 0) return;
          // No baseline yet: this number just records what the entry already is.
          if (draft.amount) scaleBy(v / draft.amount);
          draft.amount = v;
          amountHint.textContent = t("edit.amountHint");
        },
      });

      panel.querySelectorAll("[data-unit]").forEach((b) =>
        b.addEventListener("click", () => {
          draft.amountUnit = b.dataset.unit;
          panel.querySelectorAll("[data-unit]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
          if (draft.amountUnit === "serving" && !draft.amount) {
            draft.amount = 1;
            amountInput.value = "1";
            amountHint.textContent = t("edit.amountHint");
          }
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

      panel.querySelector("#share-food")?.addEventListener("click", async (ev) => {
        const btn = ev.currentTarget;
        btn.disabled = true;
        const { shareMeal } = await import("../social.js");
        const out = await shareMeal({ ...entry, name: draft.name, calories: draft.calories, proteinG: draft.proteinG, carbsG: draft.carbsG, fatG: draft.fatG });
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
              amount: draft.amount,
              amountUnit: draft.amountUnit,
              // editing by hand resets the servings multiplier; the numbers ARE the meal now
              servings: 1,
              base: { calories: draft.calories, proteinG: draft.proteinG, carbsG: draft.carbsG, fatG: draft.fatG },
            });
          } else {
            saved = store.addFoodEntry({
              name: trimmedName,
              calories: draft.calories,
              proteinG: draft.proteinG,
              carbsG: draft.carbsG,
              fatG: draft.fatG,
              amount: draft.amount,
              amountUnit: draft.amountUnit,
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
