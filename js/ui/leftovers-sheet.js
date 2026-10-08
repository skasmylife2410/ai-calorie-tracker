// leftovers-sheet.js — "Leftovers" in the + menu (and on a meal): pick the meal, photograph what's
// left, and the meal is scaled down to what was eaten (js/leftovers.js). Shows the result with Undo.

import { safeSrc } from "../safe-src.js";
import { t, formatNumber } from "../i18n.js";
import * as store from "../store.js";
import { openSheet, navBar, wireNavBar } from "./sheet.js";
import { resizeImage, scanPreset } from "../resize.js";
import { icon } from "./icons.js";
import { leftoverCandidates, takeLeftovers, undoLeftovers } from "../leftovers.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const time = (ts) => new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/**
 * @param {{entryId?:string, onChange?:()=>void}} [opts] entryId: skip the meal list (opened from a meal)
 */
export function openLeftoversSheet({ entryId = null, onChange } = {}) {
  let chosen = entryId;
  let state = "pick"; // pick → photo → working → done | error
  let result = null;
  let error = "";

  openSheet({
    render(panel, close) {
      const draw = () => {
        const meal = chosen ? store.getFoodEntry(chosen) : null;
        let body = "";
        if (state === "pick" && !meal) {
          const list = leftoverCandidates();
          body = list.length
            ? `<p class="left-lead">${t("left.pick")}</p>
               <div class="left-list">${list.map((e) => `
                 <button type="button" class="left-meal" data-id="${esc(e.id)}">
                   ${e.photoDataUrl ? `<img src="${safeSrc(e.photoDataUrl)}" alt="">` : `<span class="left-meal-ph">${icon("forkKnife", { size: 18 })}</span>`}
                   <span class="left-meal-text"><b>${esc(e.name)}</b><small>${time(e.timestamp)} · ${formatNumber(Math.round(e.calories))} kcal</small></span>
                   ${icon("chevronRight", { size: 16 })}
                 </button>`).join("")}</div>`
            : `<p class="left-lead">${t("left.none")}</p>`;
        } else if (meal && (state === "pick" || state === "photo" || state === "error")) {
          body = `
            <div class="ask-head">
              ${meal.photoDataUrl ? `<div class="ask-photo"><img src="${safeSrc(meal.photoDataUrl)}" alt=""></div>` : ""}
              <div class="ask-intro"><b>${esc(meal.name)}</b><span>${formatNumber(Math.round(meal.calories))} kcal · ${time(meal.timestamp)}</span></div>
            </div>
            <ol class="size-steps"><li>${t("left.step1")}</li><li>${t("left.step2")}</li></ol>
            <label class="ask-send size-take" id="left-take">${t("left.take")}
              <input type="file" accept="image/*" capture="environment" id="left-file" hidden>
            </label>
            ${state === "error" ? `<div class="size-error" role="alert">${esc(error || t("left.error"))}</div>` : ""}
            ${entryId ? "" : `<button type="button" class="ask-skip" id="left-back">${t("left.other")}</button>`}`;
        } else if (state === "working") {
          body = `<div class="left-working"><span class="left-spin" aria-hidden="true"></span>${t("left.working")}</div>`;
        } else if (state === "done" && meal) {
          const ate = Math.round(meal.calories);
          body = result.removedKcal > 0
            ? `<div class="left-done">
                 <div class="left-big">−${formatNumber(result.removedKcal)}<small> kcal</small></div>
                 <p>${t("left.done", { ate: formatNumber(ate), was: formatNumber(ate + result.removedKcal) })}</p>
                 ${result.keptMeasured > 0 ? `<p class="left-kept">${t("left.keptMeasured", { n: result.keptMeasured })}</p>` : ""}
               </div>
               <button type="button" class="ask-send" id="left-ok">${t("left.ok")}</button>
               <button type="button" class="ask-skip" id="left-undo">${t("left.undo")}</button>`
            : `<div class="left-done"><p>${t("left.allEaten")}</p>${result.keptMeasured > 0 ? `<p class="left-kept">${t("left.keptMeasured", { n: result.keptMeasured })}</p>` : ""}</div>
               <button type="button" class="ask-send" id="left-ok">${t("left.ok")}</button>`;
        }
        panel.innerHTML = `
          ${navBar({ title: t("left.title"), leading: { label: t("app.close") } })}
          <div class="sheet-panel-body ask-body">${body}</div>`;
        wireNavBar(panel, { onLeading: () => close() });

        panel.querySelectorAll(".left-meal").forEach((b) => b.addEventListener("click", () => { chosen = b.dataset.id; state = "photo"; draw(); }));
        panel.querySelector("#left-back")?.addEventListener("click", () => { chosen = null; state = "pick"; draw(); });
        panel.querySelector("#left-ok")?.addEventListener("click", close);
        panel.querySelector("#left-undo")?.addEventListener("click", () => { undoLeftovers(chosen); onChange?.(); close(); });
        const file = panel.querySelector("#left-file");
        file?.addEventListener("change", async () => {
          const f = file.files?.[0];
          if (!f) return;
          state = "working";
          draw();
          try {
            const { dataUrl } = await resizeImage(f, scanPreset(store.getProfile().scanQuality));
            const out = await takeLeftovers(chosen, dataUrl);
            if (!out.ok) { state = "error"; error = out.message; draw(); return; }
            result = out;
            state = "done";
            onChange?.();
            draw();
          } catch {
            state = "error"; error = ""; draw();
          }
        });
      };
      draw();
    },
  });
}
