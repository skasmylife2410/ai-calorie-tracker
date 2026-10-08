// add-to-meal.js — "+ Add food" on a meal being edited. Every way in that logging has: the camera
// (a photo of the food, a label or a barcode), describing it, saying it, Favourites & Recent, the
// food database and typing it in. Whatever comes back joins the meal as more foods instead of
// becoming a meal of its own. Photo and words are analysed here; the Edit Meal sheet shows a
// row for each one while it works (onWork) and adds the foods when they arrive.

import { t } from "../i18n.js";
import { icon } from "./icons.js";
import { openSheet, navBar, wireNavBar } from "./sheet.js";
import { analyzeMeal, foodLookup } from "../api.js";

// colour is the marker only (Mono turns it to ink); same colours as the + menu
const OPTIONS = [
  { id: "scan", icon: "cameraViewfinder", color: "#F0562D" },
  { id: "saved", icon: "bookmarkFill", color: "#D8487A" },
  { id: "describe", icon: "textBubbleFill", color: "#7B5AD9" },
  { id: "voice", icon: "mic", color: "#3BA7DB" },
  { id: "search", icon: "magnifyingglass", color: "#2F6BE8" },
  { id: "manual", icon: "listBulletRectanglePortrait", color: "#2AA66B" },
];

/** The AI's foods for a photo or words, or an Error that says what went wrong. */
export async function analyzeToItems(args) {
  const out = await analyzeMeal(args);
  if (!out.success) throw new Error(out.reason || t("addTo.failed"));
  if (!out.items?.length) throw new Error(t("addTo.noFood"));
  return out.items;
}

/** Words (with a photo of the meal for context, and the leftovers) as foods for this meal. */
async function describedItems(text, photoDataUrl, leftoversDataUrl) {
  const out = await analyzeMeal({ mode: "text", text, imageDataUrl: photoDataUrl || undefined });
  if (!out.success) throw new Error(out.reason || t("addTo.failed"));
  if (!out.items?.length) throw new Error(t("addTo.noFood"));
  if (!leftoversDataUrl) return out.items;
  const { withLeftovers } = await import("../queue.js");
  return (await withLeftovers(out, leftoversDataUrl, photoDataUrl)).items;
}

/**
 * @param {object} opts
 * @param {(items:object[])=>void} opts.onItems  foods to add now
 * @param {(label:string, work:Promise<object[]>)=>void} opts.onWork  foods that are on their way
 * @param {string} [opts.mealId]  the meal being edited (not offered as a food to add to itself)
 */
export function openAddToMealSheet({ onItems, onWork, mealId = null }) {
  openSheet({
    render(panel, close) {
      panel.innerHTML = `
        ${navBar({ title: t("addTo.title"), leading: { label: t("app.cancel") } })}
        <div class="sheet-panel-body">
          <p class="addto-lead">${t("addTo.lead")}</p>
          <div class="addto-grid">
            ${OPTIONS.map((o) => `
              <button type="button" class="addto-opt" data-add="${o.id}" style="--c:${o.color}">
                <span class="addto-ic" aria-hidden="true">${icon(o.icon, { size: 20 })}</span>
                <span class="addto-text"><b>${t(`addTo.${o.id}`)}</b><small>${t(`addTo.${o.id}Sub`)}</small></span>
              </button>`).join("")}
          </div>
        </div>`;
      wireNavBar(panel, { onLeading: () => close() });
      panel.querySelectorAll("[data-add]").forEach((b) => b.addEventListener("click", () => {
        close();
        // the next sheet slides up as this one leaves
        setTimeout(() => start(b.dataset.add, { onItems, onWork, mealId }), 120);
      }));
    },
  });
}

async function start(kind, { onItems, onWork, mealId }) {
  if (kind === "scan") {
    const { openCameraScan } = await import("./scan.js");
    openCameraScan({ onResult: (r) => fromCamera(r, { onItems, onWork }) });
  } else if (kind === "describe" || kind === "voice") {
    const { openDescribeMealSheet } = await import("./describe.js");
    openDescribeMealSheet({
      voice: kind === "voice",
      onText: (text, { photoDataUrl = null, leftoversDataUrl = null } = {}) =>
        onWork(`“${text.length > 40 ? `${text.slice(0, 40)}…` : text}”`, describedItems(text, photoDataUrl, leftoversDataUrl)),
    });
  } else if (kind === "saved") {
    const { openFavouritesSheet } = await import("./favourites.js");
    openFavouritesSheet({ onPick: onItems, excludeId: mealId });
  } else if (kind === "search") {
    const { openFoodSearchSheet } = await import("./search.js");
    openFoodSearchSheet({ pickLabel: t("group.addToMeal"), onPick: onItems });
  } else if (kind === "manual") {
    const { openAddFoodSheet } = await import("./addfood.js");
    openAddFoodSheet({ onPick: (item) => onItems([item]) });
  }
}

function fromCamera(result, { onItems, onWork }) {
  if (result.type === "foodPhoto") {
    onWork(t("addTo.photoWork"), analyzeToItems({ mode: "meal", imageDataUrl: result.dataUrl, text: result.note ?? undefined }));
  } else if (result.type === "labelPhoto") {
    onWork(t("addTo.labelWork"), analyzeToItems({ mode: "label", imageDataUrl: result.dataUrl, text: result.note ?? undefined }));
  } else if (result.type === "barcode") {
    // look it up while the meal waits; the amount is chosen on the food's own form, as when logging
    const code = result.code;
    const work = Promise.race([
      foodLookup(code).catch((err) => ({ status: "failed", message: String(err?.message ?? err) })),
      new Promise((resolve) => setTimeout(() => resolve({ status: "failed", message: t("scan.slow") }), 20000)),
    ]).then((outcome) => new Promise((resolve, reject) => {
      import("./addfood.js").then(({ openAddFoodSheet }) => {
        let picked = false;
        const opts = outcome.status === "found"
          ? { prefill: outcome.product }
          : { prefillBarcode: code, ...(outcome.status === "notFound" ? {} : { failureReason: outcome.message }) };
        openAddFoodSheet({ ...opts, onPick: (item) => { picked = true; resolve([item]); } });
        // closing the form without adding just drops the row
        watchClosed(() => { if (!picked) reject(new Error("")); });
      });
    }));
    onWork(t("addTo.barcodeWork", { code }), work);
  }
}

/** Calls back once the sheet opened last is gone. */
function watchClosed(fn) {
  const panels = document.querySelectorAll(".sheet-panel");
  const mine = panels[panels.length - 1];
  if (!mine) { fn(); return; }
  const obs = new MutationObserver(() => {
    if (!mine.isConnected) { obs.disconnect(); fn(); }
  });
  obs.observe(mine.parentNode, { childList: true });
}
