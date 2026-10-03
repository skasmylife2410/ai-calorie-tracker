// goals-update.js — the one-time message about the new way targets are worked out (GOALS_VERSION 2):
// this person's own calories and macros before and after, why they changed, and that the new
// ones are right for them. Shown once per phone after the update (store.syncLearnedTdeeFlag
// records the change on the profile), and again from the notification (?goals=1).

import * as store from "../store.js";
import { t, formatNumber } from "../i18n.js";
import { openSheet } from "./sheet.js";

const SEEN_KEY = "snapcal.goalsUpdateSeen";

export function goalsUpdateHtml(change) {
  const rows = [["calories", "kcal"], ["proteinG", "g"], ["carbsG", "g"], ["fatG", "g"]];
  const same = rows.every(([k]) => Math.abs((change.from?.[k] ?? 0) - (change.to?.[k] ?? 0)) <= 2);
  const row = ([k, unit]) => {
    const a = Math.round(change.from?.[k] ?? 0), b = Math.round(change.to?.[k] ?? 0);
    const same = Math.abs(a - b) <= 2;
    return `<tr${same ? ' class="gu-same"' : ""}><th>${t(`goalsUpdate.${k}`)}</th><td class="gu-old">${a ? formatNumber(a) : "–"}</td><td class="gu-arrow" aria-hidden="true">${same ? "=" : "→"}</td><td class="gu-new">${formatNumber(b)} <small>${unit}</small></td></tr>`;
  };
  return `
    <div class="whatsnew goals-update">
      <h2 class="whatsnew-title">${t("goalsUpdate.title")}</h2>
      <p class="gu-lead">${same ? t("goalsUpdate.leadSame") : t("goalsUpdate.lead")}</p>
      <table class="gu-table">
        <thead><tr><th></th><td>${t("goalsUpdate.before")}</td><td></td><td>${t("goalsUpdate.now")}</td></tr></thead>
        <tbody>${rows.map(row).join("")}</tbody>
      </table>
      ${["why1", "why2", "why3", "why4"].map((k) => `
        <div class="whatsnew-item">
          <div class="whatsnew-item-title">${t(`goalsUpdate.${k}Title`)}</div>
          <p class="whatsnew-item-body">${t(`goalsUpdate.${k}Body`)}</p>
        </div>`).join("")}
      <p class="whatsnew-note">${t("goalsUpdate.trust")}</p>
      <div class="push-actions"><button type="button" class="acct-btn is-primary" data-gu="ok">${t("goalsUpdate.ok")}</button></div>
    </div>`;
}

/** Shows the message once per phone, or again on demand (the notification). True if shown. */
export function maybeShowGoalsUpdate({ force = false } = {}) {
  const change = store.getProfile().goalsChange;
  if (!change || !change.to) return false;
  let seen = null;
  try { seen = localStorage.getItem(SEEN_KEY); } catch { /* private mode */ }
  if (!force && seen === String(change.v)) return false;
  try { localStorage.setItem(SEEN_KEY, String(change.v)); } catch { /* private mode */ }
  openSheet({
    render(panel, close) {
      panel.innerHTML = goalsUpdateHtml(change);
      panel.querySelector('[data-gu="ok"]').addEventListener("click", close);
    },
  });
  return true;
}
