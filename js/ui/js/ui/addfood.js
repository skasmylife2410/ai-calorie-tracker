// addfood.js — manual entry/edit form (AddFoodView.swift), SPEC-UI.md §7.
// Presented as a sheet in 4 contexts: new/blank, edit existing, barcode-hit prefill, barcode-miss.

import * as store from "../store.js";
import { wireNumericInput } from "./numeric-field.js";
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
          title: isEditing ? "Edit Food" : "Add Food",
          leading: { label: "Cancel" },
          trailing: { label: "Save", bold: true, disabled: draft.name.trim() === "" },
        })}
        <div class="sheet-panel-body">
          <div class="ios-form">
            <div class="ios-section">
              <div class="ios-section-header">Food</div>
              <div class="ios-section-body">
                <div class="ios-row">
                  <input type="text" class="numeric-input name-input" id="food-name" placeholder="Name" value="${escapeAttr(draft.name)}" />
                </div>
              </div>
            </div>
            <div class="ios-section">
              <div class="ios-section-header">Nutrition</div>
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
          </div>
        </div>
      `;

      const saveBtn = panel.querySelector('[data-nav="trailing"]');
      const nameInput = panel.querySelector("#food-name");
      nameInput.addEventListener("input", () => {
        draft.name = nameInput.value;
        saveBtn.disabled = draft.name.trim() === "";
      });

      for (const f of MACRO_FIELDS) {
        const input = panel.querySelector(`#food-${f.key}`);
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
            });
          } else {
            saved = store.addFoodEntry({
              name: trimmedName,
              calories: draft.calories,
              proteinG: draft.proteinG,
              carbsG: draft.carbsG,
              fatG: draft.fatG,
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
