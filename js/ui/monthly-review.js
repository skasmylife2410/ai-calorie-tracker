// monthly-review.js — the 30-day check-in. When it's due, the targets adjust themselves
// (store.applyMonthlyReview) and this sheet shows what the scale did against the goal, what
// changed and why, the targets before and after, and an Undo. Too few weigh-ins: it says what
// it needs and looks again in a week. Progress has a card to see the last one again.

import * as store from "../store.js";
import { t, formatNumber, formatDate } from "../i18n.js";
import { openSheet } from "./sheet.js";
import { REVIEW_EVERY_DAYS, REVIEW_NEAR_GOAL_KG } from "../nutrition.js";

const lb = () => store.weightUnit() === "lb";
const kg = (n) => {
  const v = lb() ? store.kgToLb(n) : Number(n);
  return `${formatNumber(Math.round(v * 10) / 10, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ${lb() ? "lb" : "kg"}`;
};
const perWeek = (n) => {
  const v = lb() ? store.kgToLb(n) : Number(n);
  const r = Math.round(v * 100) / 100;
  return `${r > 0 ? "+" : r < 0 ? "−" : ""}${formatNumber(Math.abs(r), { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${lb() ? "lb" : "kg"}`;
};

function tableHtml(r) {
  const rows = [["calories", "kcal"], ["proteinG", "g"], ["carbsG", "g"], ["fatG", "g"]];
  return `
    <table class="gu-table">
      <thead><tr><th></th><td>${t("review.before")}</td><td></td><td>${t("review.now")}</td></tr></thead>
      <tbody>${rows.map(([k, u]) => {
        const a = r.from?.[k] ?? 0, b = r.to?.[k] ?? 0;
        const same = Math.abs(a - b) <= 2;
        return `<tr${same ? ' class="gu-same"' : ""}><th>${t(`goalsUpdate.${k}`)}</th><td class="gu-old">${formatNumber(a)}</td><td class="gu-arrow" aria-hidden="true">${same ? "=" : "→"}</td><td class="gu-new">${formatNumber(b)} <small>${u}</small></td></tr>`;
      }).join("")}</tbody>
    </table>`;
}

/** What changed and why, one item each. */
function changesHtml(r) {
  const items = [];
  if (r.prev && Number(r.prev.weightKg) > 0 && Math.abs(r.prev.weightKg - r.endKg) >= 0.1) {
    items.push([t("review.weightTitle", { kg: kg(r.endKg) }), t("review.weightBody", { kg: kg(r.prev.weightKg) })]);
  }
  if (Number(r.maintenanceTo) > 0 && Math.abs((Number(r.maintenanceFrom) || 0) - r.maintenanceTo) >= 20) {
    items.push([
      t("review.maintTitle", { from: formatNumber(Math.round(r.maintenanceFrom)), to: formatNumber(Math.round(r.maintenanceTo)) }),
      r.maintenanceCapped ? `${t("review.maintBody")} ${t("review.maintCapped", { measured: formatNumber(Math.round(r.maintenanceMeasured)) })}` : t("review.maintBody"),
    ]);
  }
  if (r.reached) items.push([t("review.reachedTitle"), t("review.reachedBody")]);
  if (r.eased) items.push([t("review.easedTitle"), t("review.easedBody", { kg: kg(REVIEW_NEAR_GOAL_KG) })]);
  if (r.stepKcal) {
    items.push([
      t(r.stepKcal < 0 ? "review.lessTitle" : "review.moreTitle", { n: formatNumber(Math.abs(r.stepKcal)) }),
      t("review.stepBody", { actual: perWeek(r.kgPerWeek), planned: perWeek(r.plannedKgPerWeek) }),
    ]);
  } else if (r.learnedOn && r.verdict !== "onTrack") {
    items.push([t("review.learnedTitle"), t("review.learnedBody")]);
  }
  if (items.length === 0) items.push([t("review.keepTitle"), t("review.keepBody")]);
  return items.map(([title, body]) => `
    <div class="whatsnew-item">
      <div class="whatsnew-item-title">${title}</div>
      <p class="whatsnew-item-body">${body}</p>
    </div>`).join("");
}

export function reviewHtml(r, { canUndo = true } = {}) {
  const goalLine = r.weeksToGoal ? `<p class="whatsnew-note">${t("review.eta", { weeks: r.weeksToGoal, kg: kg(r.goalKg) })}</p>` : "";
  const next = store.reviewDueAt();
  return `
    <div class="whatsnew review">
      <h2 class="whatsnew-title">${t("review.title")}</h2>
      <div class="review-weights">
        <span>${kg(r.startKg)}</span><span class="review-arrow" aria-hidden="true">→</span><b>${kg(r.endKg)}</b>
      </div>
      <p class="gu-lead">${t(`review.verdict.${r.verdict}`, { actual: perWeek(r.kgPerWeek), planned: perWeek(r.plannedKgPerWeek) })}</p>
      ${r.undone ? "" : `${changesHtml(r)}${tableHtml(r)}${goalLine}`}
      ${r.undone ? `<p class="whatsnew-note">${t("review.undone")}</p>` : ""}
      ${next ? `<p class="whatsnew-note">${t("review.next", { date: formatDate(next, { month: "long", day: "numeric" }) })}</p>` : ""}
      <div class="push-actions">
        ${canUndo && !r.undone ? `<button type="button" class="acct-btn" data-rv="undo">${t("review.undo")}</button>` : ""}
        <button type="button" class="acct-btn is-primary" data-rv="ok">${t("review.ok")}</button>
      </div>
    </div>`;
}

function needHtml(n) {
  return `
    <div class="whatsnew review">
      <h2 class="whatsnew-title">${t("review.title")}</h2>
      <p class="gu-lead">${t("review.needLead", { n })}</p>
      <div class="whatsnew-item">
        <div class="whatsnew-item-title">${t("review.needTitle")}</div>
        <p class="whatsnew-item-body">${t("review.needBody")}</p>
      </div>
      <div class="push-actions">
        <button type="button" class="acct-btn" data-rv="later">${t("review.later")}</button>
        <button type="button" class="acct-btn is-primary" data-rv="weigh">${t("review.weighNow")}</button>
      </div>
    </div>`;
}

function showRecord(record, { onChange } = {}) {
  openSheet({
    render(panel, close) {
      const draw = () => {
        panel.innerHTML = reviewHtml(store.getProfile().lastReview ?? record);
        panel.querySelector('[data-rv="ok"]').addEventListener("click", close);
        panel.querySelector('[data-rv="undo"]')?.addEventListener("click", () => {
          store.undoMonthlyReview();
          try { store.syncLearnedTdeeFlag(); } catch { /* never block */ }
          onChange?.();
          draw();
        });
      };
      draw();
    },
  });
}

/** Runs the check-in when it's due. True if a sheet was shown. */
export function maybeRunMonthlyReview({ onChange } = {}) {
  if (!store.reviewIsDue()) return false;
  const review = store.monthlyReviewNow();
  if (review.status === "needWeighIns") {
    store.snoozeMonthlyReview();
    openSheet({
      render(panel, close) {
        panel.innerHTML = needHtml(review.weighIns);
        panel.querySelector('[data-rv="later"]').addEventListener("click", close);
        panel.querySelector('[data-rv="weigh"]').addEventListener("click", async () => {
          close();
          const { openWeightSheet } = await import("./weight.js");
          openWeightSheet({ onSaved: onChange });
        });
      },
    });
    return true;
  }
  const record = store.applyMonthlyReview({ ...review });
  if (!record) return false;
  try { store.syncLearnedTdeeFlag(); } catch { /* never block */ }
  onChange?.();
  showRecord(record, { onChange });
  return true;
}

/** Progress card: when the next check-in is, and the last one to look at again. */
export function reviewCardHtml() {
  const p = store.getProfile();
  const due = store.reviewDueAt(p);
  if (!due && !p.lastReview) return "";
  const days = due ? Math.max(0, Math.ceil((due - Date.now()) / 86400000)) : null;
  return `
    <div class="wt-card mt-card review-card">
      <div class="mt-row">
        <div class="mt-title">${t("review.cardTitle")}</div>
        ${p.lastReview ? `<button type="button" class="review-card-open" id="review-open">${t("review.cardOpen")}</button>` : ""}
      </div>
      <div class="mt-sub">${days === null ? "" : days === 0 ? t("review.cardToday") : t("review.cardIn", { n: days })} · ${t("review.cardEvery", { n: REVIEW_EVERY_DAYS })}</div>
    </div>`;
}

export function wireReviewCard(container, { onChange } = {}) {
  container.querySelector("#review-open")?.addEventListener("click", () => {
    const r = store.getProfile().lastReview;
    if (r) showRecord(r, { onChange });
  });
}
