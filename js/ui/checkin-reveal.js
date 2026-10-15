// checkin-reveal.js — the 30-day check-in, made into a moment. Full screen: the days of the month
// light up one by one around the number of days logged, then the old budget counts to the new
// one, with what changed and why; Undo counts it back. Not enough weigh-ins yet: the same moment
// ends on what's missing instead, and "Weigh in now". (The plain record stays in
// monthly-review.js, for Progress › See it again.)

import * as store from "../store.js";
import { t, formatNumber, formatDate } from "../i18n.js";
import { sfx } from "../sounds.js";
import { REVIEW_EVERY_DAYS } from "../nutrition.js";

const NEEDED_WEIGH_INS = 4; // nutrition.monthlyReview: at least 4 readings over two weeks
const reduced = () => Boolean(globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
const easeOut = (p) => 1 - Math.pow(1 - p, 3);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const lb = () => store.weightUnit() === "lb";
const wt = (kg) => `${formatNumber(Math.round((lb() ? store.kgToLb(kg) : Number(kg)) * 10) / 10, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ${lb() ? "lb" : "kg"}`;
const pace = (kg) => `${formatNumber(Math.abs(Math.round((lb() ? store.kgToLb(kg) : Number(kg)) * 10) / 10), { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ${lb() ? "lb" : "kg"}`;

/**
 * Why the budget moved, short enough to read in one glance (the long version is the record in
 * monthly-review.js): the weight, the measured burn, and the pace against the plan.
 */
export function revealItems(r) {
  const items = [];
  if (r.reached) items.push([t("review.reachedTitle"), t("review.reachedBody")]);
  if (r.prev && Number(r.prev.weightKg) > 0 && Math.abs(r.prev.weightKg - r.endKg) >= 0.1) {
    items.push([t("reveal.weightTitle", { from: wt(r.prev.weightKg), to: wt(r.endKg) }), t("reveal.weightBody")]);
  }
  if (Number(r.maintenanceTo) > 0 && Math.abs((Number(r.maintenanceFrom) || 0) - r.maintenanceTo) >= 20) {
    const fromTo = { from: formatNumber(Math.round(r.maintenanceFrom)), to: formatNumber(Math.round(r.maintenanceTo)) };
    items.push([
      t("reveal.burnTitle", { n: formatNumber(Math.round(r.maintenanceMeasured ?? r.maintenanceTo)) }),
      r.maintenanceCapped ? t("reveal.burnCapped", fromTo) : t("reveal.burnBody", fromTo),
    ]);
  }
  if (!r.reached) {
    const sides = { actual: pace(r.kgPerWeek), planned: pace(r.plannedKgPerWeek) };
    const dir = r.kgPerWeek < -0.05 ? "Losing" : r.kgPerWeek > 0.05 ? "Gaining" : "Steady";
    if (r.verdict === "onTrack") items.push([t("reveal.onPaceTitle"), t("reveal.onPaceBody", sides)]);
    else items.push([
      t(`reveal.pace${dir}`, sides),
      r.stepKcal ? t(r.stepKcal < 0 ? "reveal.stepLess" : "reveal.stepMore", { n: formatNumber(Math.abs(r.stepKcal)) }) : t("reveal.paceFixed"),
    ]);
  }
  if (r.eased) items.push([t("review.easedTitle"), t("review.easedBody", { kg: wt(2) })]);
  return items;
}

/** Days with a meal logged in the last 30 (today included), for the ring. */
function loggedDays(now = Date.now()) {
  let n = 0;
  for (let i = 0; i < REVIEW_EVERY_DAYS; i += 1) {
    const day = new Date(now - i * 86400000);
    if (store.entriesForDay(day).some((e) => e.isPending !== true && e.analysisFailed !== true && Number(e.calories) > 0)) n += 1;
  }
  return n;
}

function ringSvg(n = REVIEW_EVERY_DAYS, size = 220, r = 92) {
  let dots = "";
  for (let i = 0; i < n; i += 1) {
    const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
    dots += `<circle class="ci-dot" cx="${(size / 2 + r * Math.cos(a)).toFixed(1)}" cy="${(size / 2 + r * Math.sin(a)).toFixed(1)}" r="5"/>`;
  }
  return `<svg class="ci-ring-svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">${dots}</svg>`;
}

/** Counts `el` from `from` to `to` over `ms`, ticking as it goes; resolves when it lands. */
function countTo(el, from, to, ms) {
  return new Promise((resolve) => {
    if (reduced() || from === to) { el.textContent = formatNumber(to); resolve(); return; }
    const t0 = performance.now();
    let last = from, lastTick = 0;
    const step = Math.max(1, Math.round(Math.abs(to - from) / 14));
    const frame = (now) => {
      const p = Math.min(1, (now - t0) / ms);
      const v = Math.round(from + (to - from) * easeOut(p));
      el.textContent = formatNumber(v);
      if (Math.abs(v - last) >= step && now - lastTick > 55) { sfx("tick"); last = v; lastTick = now; }
      if (p < 1) requestAnimationFrame(frame); else resolve();
    };
    requestAnimationFrame(frame);
  });
}

/** Lights the ring's dots one by one (the logged days), with the number counting along. */
function lightRing(root, lit) {
  const dots = [...root.querySelectorAll(".ci-dot")];
  const num = root.querySelector(".ci-days");
  if (reduced()) {
    dots.forEach((d, i) => d.classList.toggle("is-on", i < lit));
    num.textContent = formatNumber(lit);
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    let i = 0;
    const next = () => {
      if (!root.isConnected) { resolve(); return; }
      if (i >= lit) { resolve(); return; }
      dots[i].classList.add("is-on");
      i += 1;
      num.textContent = formatNumber(i);
      if (i % 2 === 1) sfx("tick");
      setTimeout(next, 42);
    };
    setTimeout(next, 350);
  });
}

function mount(html) {
  document.querySelector(".ci")?.remove();
  const root = document.createElement("div");
  root.className = "ci";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-label", t("review.title"));
  root.innerHTML = html;
  document.body.appendChild(root);
  requestAnimationFrame(() => root.classList.add("is-in"));
  return root;
}

function unmount(root) {
  root.classList.remove("is-in");
  setTimeout(() => root.remove(), reduced() ? 0 : 260);
}

/**
 * The check-in that moved the targets. `record` is what store.applyMonthlyReview returned.
 */
export function revealCheckin({ record, items = revealItems(record), onChange } = {}) {
  const lit = loggedDays();
  const from = Math.round(record.from?.calories ?? 0);
  const to = Math.round(record.to?.calories ?? 0);
  const next = store.reviewDueAt();
  const root = mount(`
    <div class="ci-k" id="ci-k">${t("reveal.kicker")}</div>
    <div class="ci-stage" id="ci-stage">
      <div class="ci-ring">${ringSvg()}<div class="ci-ring-in"><div class="ci-num ci-days">0</div><div class="ci-unit">${t("reveal.daysLogged")}</div></div></div>
      <p class="ci-lead">${t("reveal.lead")}</p>
      <p class="ci-sub">${t("reveal.sub")}</p>
    </div>
    <div class="ci-actions" id="ci-actions"><button type="button" class="ci-btn is-primary" data-ci="budget">${t("reveal.seeBudget")}</button></div>`);
  sfx("powerUp");
  lightRing(root, lit).then(() => { if (root.isConnected) sfx("streak"); });

  root.querySelector('[data-ci="budget"]').addEventListener("click", () => {
    root.querySelector("#ci-k").textContent = t("reveal.newBudget");
    root.querySelector("#ci-stage").innerHTML = `
      <div class="ci-from">${from !== to ? `<s>${formatNumber(from)}</s> →` : t("reveal.same")}</div>
      <div class="ci-num ci-budget" id="ci-budget">${formatNumber(from)}</div>
      <div class="ci-unit">${t("reveal.perDay")}</div>
      <div class="ci-rows">${items.slice(0, 3).map(([title, body]) => `<div class="ci-row"><i aria-hidden="true"></i><div><b>${title}</b><span>${body}</span></div></div>`).join("")}</div>
      ${next ? `<p class="ci-next">${t("review.next", { date: formatDate(next, { month: "long", day: "numeric" }) })}</p>` : ""}`;
    root.querySelector("#ci-actions").innerHTML = `
      <button type="button" class="ci-btn" data-ci="undo">${t("reveal.undo")}</button>
      <button type="button" class="ci-btn is-primary" data-ci="ok">${t("reveal.go")}</button>`;
    const num = root.querySelector("#ci-budget");
    countTo(num, from, to, 1300).then(() => { if (root.isConnected) sfx("log"); });
    root.querySelector('[data-ci="ok"]').addEventListener("click", () => unmount(root));
    root.querySelector('[data-ci="undo"]').addEventListener("click", () => {
      store.undoMonthlyReview();
      try { store.syncLearnedTdeeFlag(); } catch { /* never block */ }
      onChange?.();
      sfx("undo");
      root.querySelector("#ci-k").textContent = t("reveal.undone");
      root.querySelector(".ci-rows")?.remove();
      root.querySelector(".ci-from").textContent = t("reveal.undoneSub");
      countTo(num, to, from, 900);
      root.querySelector("#ci-actions").innerHTML = `<button type="button" class="ci-btn is-primary" data-ci="ok">${t("review.ok")}</button>`;
      root.querySelector('[data-ci="ok"]').addEventListener("click", () => unmount(root));
    });
  });
  return root;
}

/** The check-in found too few weigh-ins: the month is still celebrated, and what's missing said. */
export function revealNeedWeighIns({ weighIns = 0, spanDays = 0, onWeigh } = {}) {
  const lit = loggedDays();
  const have = Math.min(NEEDED_WEIGH_INS, weighIns);
  const sub = weighIns >= NEEDED_WEIGH_INS
    ? t("reveal.needSpan", { days: Math.max(1, Math.round(spanDays)) })
    : t("reveal.needSub", { n: weighIns, of: NEEDED_WEIGH_INS });
  const root = mount(`
    <div class="ci-k">${t("reveal.kicker")}</div>
    <div class="ci-stage">
      <div class="ci-ring">${ringSvg()}<div class="ci-ring-in"><div class="ci-num ci-days">0</div><div class="ci-unit">${t("reveal.daysLogged")}</div></div></div>
      <p class="ci-lead">${t("reveal.needLead")}</p>
      <div class="ci-pips" aria-label="${esc(t("reveal.needPips", { n: weighIns, of: NEEDED_WEIGH_INS }))}">${Array.from({ length: NEEDED_WEIGH_INS }, (_, i) => `<i class="${i < have ? "is-on" : ""}"></i>`).join("")}</div>
      <p class="ci-sub">${sub}</p>
    </div>
    <div class="ci-actions">
      <button type="button" class="ci-btn" data-ci="later">${t("review.later")}</button>
      <button type="button" class="ci-btn is-primary" data-ci="weigh">${t("review.weighNow")}</button>
    </div>`);
  sfx("powerUp");
  lightRing(root, lit);
  root.querySelector('[data-ci="later"]').addEventListener("click", () => unmount(root));
  root.querySelector('[data-ci="weigh"]').addEventListener("click", () => { unmount(root); onWeigh?.(); });
  return root;
}
