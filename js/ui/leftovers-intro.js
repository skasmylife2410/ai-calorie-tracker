// leftovers-intro.js — the one-time tutorial for Leftovers, shown the next time someone opens the
// app (once per phone): three small pictures (the meal logged, a photo of what's left, the
// number going down) and "Try it", which opens the Leftovers sheet.

import { t } from "../i18n.js";
import { openSheet } from "./sheet.js";

export const LEFTOVERS_INTRO_KEY = "snapcal.leftoversIntroSeen";

const plate = (fill) => `
  <svg viewBox="0 0 64 64" class="lt-plate" aria-hidden="true">
    <circle cx="32" cy="32" r="27" class="lt-rim"/><circle cx="32" cy="32" r="19" class="lt-well"/>
    ${fill === "full" ? '<path d="M18 34c2-8 9-12 15-11 7 1 12 6 13 12-3 5-9 8-15 8s-11-3-13-9Z" class="lt-food"/>'
      : '<path d="M36 35c1-4 4-6 7-5 3 1 4 4 3 7-2 2-5 3-7 2-2 0-3-2-3-4Z" class="lt-food"/>'}
  </svg>`;

export function leftoversIntroHtml() {
  return `
    <div class="whatsnew left-intro">
      <h2 class="whatsnew-title">${t("leftIntro.title")}</h2>
      <p class="gu-lead">${t("leftIntro.lead")}</p>
      <div class="lt-strip" aria-hidden="true">
        <div class="lt-step">${plate("full")}<span>700 kcal</span></div>
        <div class="lt-arrow">→</div>
        <div class="lt-step lt-cam">${plate("left")}<i class="lt-frame"></i><span>${t("leftIntro.photo")}</span></div>
        <div class="lt-arrow">→</div>
        <div class="lt-step"><b class="lt-minus">−180</b><span>520 kcal</span></div>
      </div>
      <div class="whatsnew-item"><div class="whatsnew-item-title">${t("leftIntro.how1Title")}</div><p class="whatsnew-item-body">${t("leftIntro.how1Body")}</p></div>
      <div class="whatsnew-item"><div class="whatsnew-item-title">${t("leftIntro.how2Title")}</div><p class="whatsnew-item-body">${t("leftIntro.how2Body")}</p></div>
      <div class="whatsnew-item"><div class="whatsnew-item-title">${t("leftIntro.how3Title")}</div><p class="whatsnew-item-body">${t("leftIntro.how3Body")}</p></div>
      <div class="push-actions">
        <button type="button" class="acct-btn" data-li="close">${t("leftIntro.later")}</button>
        <button type="button" class="acct-btn is-primary" data-li="try">${t("leftIntro.try")}</button>
      </div>
    </div>`;
}

/** Shows the tutorial once per phone. True if it showed. */
export function maybeShowLeftoversIntro({ force = false, onTry } = {}) {
  let seen = null;
  try { seen = localStorage.getItem(LEFTOVERS_INTRO_KEY); } catch { /* private mode */ }
  if (seen && !force) return false;
  try { localStorage.setItem(LEFTOVERS_INTRO_KEY, "1"); } catch { /* private mode */ }
  openSheet({
    render(panel, close) {
      panel.innerHTML = leftoversIntroHtml();
      panel.querySelector('[data-li="close"]').addEventListener("click", close);
      panel.querySelector('[data-li="try"]').addEventListener("click", () => { close(); setTimeout(() => onTry?.(), 350); });
    },
  });
  return true;
}
