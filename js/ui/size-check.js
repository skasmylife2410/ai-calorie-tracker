// size-check.js — rich food (sweets, pastries, fried, cheesy) photographed with nothing to show
// its size: asks for one more photo with a hand, a fork or a card beside it, and re-analyses the
// meal with both photos (queue.addSizePhoto). "Keep the estimate" stops asking.

import { safeSrc } from "../safe-src.js";
import { t, formatNumber } from "../i18n.js";
import * as queue from "../queue.js";
import * as store from "../store.js";
import { openSheet, navBar, wireNavBar } from "./sheet.js";
import { resizeImage, scanPreset } from "../resize.js";

let openFor = null;

export function openSizeCheckSheet(entry, { onDone } = {}) {
  const rich = Number(entry?.analysisSizeCheck) || 0;
  if (!rich || openFor === entry.id) return;
  openFor = entry.id;
  let finished = false;
  // a portion misjudged by a third: what that does to the day
  const swing = Math.round((rich / 3) / 10) * 10;

  openSheet({
    render(panel, close) {
      panel.innerHTML = `
        ${navBar({ title: t("size.title"), leading: { label: t("app.close") } })}
        <div class="sheet-panel-body ask-body">
          <div class="ask-head">
            ${entry.photoDataUrl ? `<div class="ask-photo"><img src="${safeSrc(entry.photoDataUrl)}" alt=""></div>` : ""}
            <div class="ask-intro">
              <b>${t("size.lead", { kcal: formatNumber(rich) })}</b>
              <span>${t("size.why", { n: formatNumber(swing) })}</span>
            </div>
          </div>
          <ol class="size-steps">
            <li>${t("size.step1")}</li>
            <li>${t("size.step2")}</li>
          </ol>
          <label class="ask-send size-take" id="size-take">
            ${t("size.take")}
            <input type="file" accept="image/*" capture="environment" id="size-file" hidden>
          </label>
          <div class="size-error" id="size-error" role="alert" hidden></div>
          <button type="button" class="ask-skip" id="size-skip">${t("ask.keep")}</button>
        </div>`;
      wireNavBar(panel, { onLeading: () => close() });
      const file = panel.querySelector("#size-file");
      file.addEventListener("change", async () => {
        const f = file.files?.[0];
        if (!f) return;
        const take = panel.querySelector("#size-take");
        take.classList.add("is-busy");
        try {
          const { dataUrl } = await resizeImage(f, scanPreset(store.getProfile().scanQuality));
          finished = true;
          queue.addSizePhoto(entry.id, dataUrl);
          close();
        } catch {
          take.classList.remove("is-busy");
          const err = panel.querySelector("#size-error");
          err.textContent = t("size.error");
          err.hidden = false;
        }
      });
      panel.querySelector("#size-skip").addEventListener("click", () => { finished = true; queue.skipSizeCheck(entry.id); close(); });
    },
    onClosed() {
      openFor = null;
      onDone?.(finished);
    },
  });
}
