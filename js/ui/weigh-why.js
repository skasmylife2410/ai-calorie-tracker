// weigh-why.js — why weighing in matters, in four lines: the budget is a formula's guess until
// the scale says otherwise; weigh the same way each morning; day-to-day swings are water; and
// what the next check-in has to work with. Opened from Home's weigh-in line (the first time),
// and from the "why your weight matters" notification (/?weighin=1).

import * as store from "../store.js";
import { t } from "../i18n.js";
import { openSheet } from "./sheet.js";

const SEEN = "snapcal.weighWhySeen";
const NEEDED = 4; // nutrition.monthlyReview: at least 4 readings over two weeks

export function weighWhySeen() {
  try { return localStorage.getItem(SEEN) === "1"; } catch { return true; }
}

/** The last line: how close the check-in is and what it still needs. */
function checkinRow() {
  const next = store.checkinWeighIns();
  if (!next) return [t("weighWhy.firstTitle"), t("weighWhy.firstBody")];
  const title = next.days === 0 ? t("weighWhy.dueToday") : t("weighWhy.dueIn", { n: next.days });
  return [title, next.have >= NEEDED ? t("weighWhy.enough", { n: next.have }) : t("weighWhy.need", { n: next.have, of: NEEDED })];
}

export function openWeighWhySheet({ onSaved } = {}) {
  try { localStorage.setItem(SEEN, "1"); } catch { /* private mode */ }
  const rows = [
    [t("weighWhy.burnTitle"), t("weighWhy.burnBody")],
    [t("weighWhy.howTitle"), t("weighWhy.howBody")],
    [t("weighWhy.waterTitle"), t("weighWhy.waterBody")],
    checkinRow(),
  ];
  openSheet({
    render(panel, close) {
      panel.innerHTML = `
        <div class="whatsnew weigh-why">
          <div class="ci-k weigh-why-k">${t("weighWhy.kicker")}</div>
          <h2 class="whatsnew-title">${t("weighWhy.title")}</h2>
          <div class="ci-rows">${rows.map(([title, body]) => `<div class="ci-row"><i aria-hidden="true"></i><div><b>${title}</b><span>${body}</span></div></div>`).join("")}</div>
          <div class="push-actions">
            <button type="button" class="acct-btn" data-ww="later">${t("weighWhy.later")}</button>
            <button type="button" class="acct-btn is-primary" data-ww="weigh">${t("review.weighNow")}</button>
          </div>
        </div>`;
      panel.querySelector('[data-ww="later"]').addEventListener("click", close);
      panel.querySelector('[data-ww="weigh"]').addEventListener("click", async () => {
        close();
        const { openWeightSheet } = await import("./weight.js");
        openWeightSheet({ onSaved });
      });
    },
  });
}
