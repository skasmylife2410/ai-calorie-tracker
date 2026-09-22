// today.js — Home tab (TodayView.swift), SPEC-UI.md §5.

import * as store from "../store.js";
import { t, weekdayLabels, formatDate } from "../i18n.js";
import * as queue from "../queue.js";
import { roundDisplay, startOfDay } from "../nutrition.js";
import { icon } from "./icons.js";
import { ringGauge } from "./ring.js";
import { openActionSheet } from "./action-sheet.js";
import { openResultsSheet } from "./results.js";
import { openAddFoodSheet } from "./addfood.js";
import { exerciseRowsHtml, openExerciseSheet } from "./exercise.js";
import { openRecipesSheet } from "./recipes.js";
import { openDayMealsSheet } from "./day-meals.js";
import { mythForDay } from "../myths.js";
import { inbox, noteToShow, markNoteSeen } from "../social.js";
import { currentLanguage } from "../i18n.js";
import { doodleSvg, doodleState, daysSinceLastLog } from "./doodle.js";
import { doodleMessage } from "./doodle-messages.js";
import { cachedFaceDoodle, makeFaceDoodle } from "./photo-doodle.js";
import { cachedNanoDoodle, ensureNanoDoodle } from "./nano-doodle.js";

const MACRO_DEFS = [
  { key: "proteinG", targetKey: "proteinTargetG", nameKey: "protein", color: "var(--sc-protein)", track: "rgba(232,93,93,0.18)", icon: "fishFill" },
  { key: "carbsG", targetKey: "carbsTargetG", nameKey: "carbs", color: "var(--sc-carbs)", track: "rgba(229,160,84,0.18)", icon: "leafFill" },
  { key: "fatG", targetKey: "fatTargetG", nameKey: "fat", color: "var(--sc-fat)", track: "rgba(107,141,227,0.18)", icon: "dropFill" },
];

// Week strip labels follow the active language (Mon/lun…).

let swiperPage = 0;
let rowCleanups = [];
// The day the Home tab is showing. null = today (and it snaps back to today on a fresh launch).
let selectedDayStart = null;
// Which week the strip is showing: 0 = this week, -1 = last week, and so on. Without this the
// strip could only ever reach back to Monday, so "edit a prior day" stopped at the week boundary.
let weekOffset = 0;
// The meal list gets long fast, so it shows a few and hides the rest behind "Show all".

function viewedDate() {
  return selectedDayStart === null ? new Date() : new Date(selectedDayStart);
}

function isViewingToday() {
  return selectedDayStart === null || selectedDayStart === startOfDay(new Date());
}

/** Timestamp to stamp new entries with: now for today, else midday on the selected day. */
export function viewedTimestamp() {
  if (isViewingToday()) return Date.now();
  return selectedDayStart + 12 * 60 * 60 * 1000;
}

export function render(container) {
  rowCleanups.forEach((fn) => fn());
  rowCleanups = [];

  const date = viewedDate();
  const viewingToday = isViewingToday();
  const totals = store.totalsForDay(date);
  const goals = store.computeGoals();
  const week = store.weekStrip(new Date(startOfDay(new Date()) + weekOffset * 7 * 86400000));
  const streakCount = store.streak();
  const water = store.getWaterEntryForDay(date);
  const recent = viewingToday
    ? store.recentlyUploaded(10)
    : store.entriesForDay(date).sort((a, b) => b.timestamp - a.timestamp);
  const anyPending = recent.some((e) => e.isPending === true);
  const showNotifyBanner = anyPending && !queue.isNotificationAuthorized() && !store.isNotifyBannerDismissed();

  // dayEnergy folds in the credited share of exercise (see nutrition.EXERCISE_CREDIT_RATIO).
  const energy = store.dayEnergy(date);
  const mealCount = store.entriesForDay(date).filter((e) => e.isPending !== true).length;
  const remaining = energy.remaining;
  const overBudget = remaining < 0;

  container.innerHTML = `
    <div class="today-content">
      <div class="today-header">
        <div class="wordmark">${icon("forkKnife", { size: 24 })}<span class="wordmark-text">SnapCal</span></div>
        <div class="today-header-right">
          <div class="streak-pill">${icon("flameFill", { size: 18, color: "var(--sc-streak-flame)" })}<span class="streak-count">${streakCount}</span></div>
          <button type="button" class="home-avatar" id="home-avatar" aria-label="${t("tabs.profile")}">
            ${store.getProfile().avatar ? `<img src="${store.getProfile().avatar}" alt="" />` : icon("personFill", { size: 18 })}
          </button>
        </div>
      </div>

      ${weekStripHtml(week)}
      ${viewingToday ? "" : `
        <div class="viewing-day">
          <span>${t("home.viewingDay", { day: formatViewedDay(date) })}</span>
          <button type="button" id="back-to-today">${t("home.backToToday")}</button>
        </div>`}

      <div data-own-swipe class="swiper">
        <div class="swiper-track" id="swiper-track" style="transform:translateX(${-swiperPage * 100}%)">
          <div class="swiper-page">${caloriesPageHtml(totals, goals, remaining, overBudget, energy, mealCount)}</div>
          <div class="swiper-page">${waterPageHtml(water)}</div>
        </div>
      </div>
      <div class="swiper-dots">
        <span class="swiper-dot${swiperPage === 0 ? " active" : ""}" data-dot="0"></span>
        <span class="swiper-dot${swiperPage === 1 ? " active" : ""}" data-dot="1"></span>
      </div>

      ${viewingToday ? doodleCardHtml() : ""}

      <div class="home-chips">
        <button type="button" class="home-chip chip-ex" id="chip-exercise">
          ${icon("boltFill", { size: 16 })}<span>${exerciseMinutes(date) > 0 ? t("homeChips.exerciseMin", { n: exerciseMinutes(date) }) : t("homeChips.exercise")}</span>
        </button>
        ${viewingToday ? `<button type="button" class="home-chip chip-ideas" id="chip-ideas">${icon("wandAndStars", { size: 16 })}<span>${t("homeChips.ideas")}</span></button>` : ""}
        ${viewingToday ? `<button type="button" class="home-chip chip-myth" id="chip-myth"><b>?</b><span>${t("homeChips.myth")}</span></button>` : ""}
      </div>
      <div class="bottom-safe-spacer"></div>
    </div>
  `;

  wireSwiper(container);
  wireWaterButtons(container);
  container.querySelector("#chip-exercise")?.addEventListener("click", () => openExerciseDaySheet(date, () => render(container)));
  container.querySelector("#chip-ideas")?.addEventListener("click", () => openRecipesSheet());
  container.querySelector("#chip-myth")?.addEventListener("click", () => openMythSheet());
  wireDaySelection(container);
  if (viewingToday) showNoteIfAny(container);

  container.querySelector("#home-avatar")?.addEventListener("click", () => globalThis.snapcalGoTo?.("profile"));
  container.querySelector("#see-meals")?.addEventListener("click", () =>
    openDayMealsSheet({ date: viewedDate(), onChange: () => render(container) })
  );

  wireNotifyBanner(container);

}


/**
 * Swipe removes the meal straight away — no dialog, no edit mode. A toast offers Undo for a few
 * seconds, which is friendlier than a confirm box and much faster when clearing several rows.
 */
let undoTimer = null;
function removeWithUndo(entry, container) {
  const snapshot = { ...entry };
  store.deleteFoodEntry(entry.id);
  render(container);
  showUndoToast(snapshot, container);
}

function showUndoToast(snapshot, container) {
  document.getElementById("undo-toast")?.remove();
  clearTimeout(undoTimer);

  const toast = document.createElement("div");
  toast.id = "undo-toast";
  toast.className = "undo-toast";
  toast.innerHTML = `
    <span class="undo-text">${t("undo.removed", { name: snapshot.name ?? "" })}</span>
    <button type="button" class="undo-btn">${t("undo.action")}</button>`;
  document.body.appendChild(toast);

  toast.querySelector(".undo-btn").addEventListener("click", () => {
    // Re-add with the original timestamp so it lands back on the same day, not today.
    store.addFoodEntry({ ...snapshot, id: undefined });
    toast.remove();
    clearTimeout(undoTimer);
    render(container);
  });

  undoTimer = setTimeout(() => toast.remove(), 5000);
}

function weekStripHtml(week) {
  const todayStart = startOfDay(new Date());
  const canGoForward = week.some((d) => d.dayStart < todayStart - 6 * 86400000) || weekOffset < 0;
  return `
    <div class="week-row">
      <button type="button" class="week-arrow" id="week-prev" aria-label="${t("day.prevWeek")} (${weekRangeLabel(week)})">‹</button>
    <div class="week-strip">
      ${week
        .map((day, i) => {
          const isToday = day.dayStart === todayStart;
          const isFuture = day.dayStart > todayStart;
          const isPastNoLog = !isToday && !isFuture && !day.hasLog;
          const dayNum = new Date(day.dayStart).getDate();
          const circleClasses = ["week-day-circle"];
          if (isToday) circleClasses.push("today");
          else if (day.hasLog) circleClasses.push("logged");
          else circleClasses.push("nolog");
          const numClasses = ["week-day-number"];
          if (isToday) numClasses.push("bold");
          if (isFuture) numClasses.push("future");
          const isSelected = day.dayStart === (selectedDayStart ?? todayStart);
          const colClasses = ["week-day-col"];
          if (isSelected && !isToday) colClasses.push("selected");
          if (isFuture) colClasses.push("future");
          else if (isPastNoLog) colClasses.push("past-nolog");
          return `
            <div class="${colClasses.join(" ")}" data-day-start="${day.dayStart}">
              <div class="week-day-label">${weekdayLabels()[i]}</div>
              <div class="week-day-badge-wrap">
                ${isToday ? '<div class="week-day-today-backdrop"></div>' : ""}
                <div class="${circleClasses.join(" ")}">
                  <div class="${numClasses.join(" ")}">${dayNum}</div>
                </div>
              </div>
            </div>
          `;
        })
        .join("")}
    </div>
      <button type="button" class="week-arrow${canGoForward ? "" : " is-hidden"}" id="week-next" aria-label="${t("day.nextWeek")}">›</button>
    </div>
  `;
}

function caloriesPageHtml(totals, goals, remaining, overBudget, energy, mealCount) {
  const ringProgress = energy.adjustedTarget > 0 ? totals.calories / energy.adjustedTarget : 0;
  const ring = ringGauge({
    size: 78,
    strokeWidth: 12,
    progress: ringProgress,
    color: overBudget ? "var(--sc-red)" : "var(--sc-primary-text)",
    trackColor: "var(--sc-secondary-15)",
    centerHtml: icon("flameFill", { size: 26, color: overBudget ? "var(--sc-red)" : "var(--sc-primary-text)" }),
  });

  const macroTiles = MACRO_DEFS.map((m) => {
    const consumed = totals[m.key] ?? 0;
    const target = goals[m.targetKey] ?? 0;
    const macroRemaining = target - consumed;
    const macroOver = macroRemaining < 0;
    const progress = target > 0 ? consumed / target : 0;
    const miniRing = ringGauge({
      size: 30,
      strokeWidth: 5,
      progress,
      color: macroOver ? "var(--sc-red)" : m.color,
      trackColor: m.track,
      centerHtml: icon(m.icon, { size: 14, color: macroOver ? "var(--sc-red)" : m.color }),
    });
    return `
      <div class="macro-tile card">
        <div class="macro-text">
          <div class="macro-value${macroOver ? " over" : ""}">${roundDisplay(Math.abs(macroRemaining))}g</div>
          <div class="macro-caption">${macroOver ? t("home.overShort", { name: t(`home.${m.nameKey}Short`) }) : t(`home.${m.nameKey}Short`)}</div>
        </div>
        ${miniRing}
      </div>
    `;
  }).join("");

  return `
    <div class="calories-page">
      <div class="calorie-card card">
        <div class="calorie-left">
          <div class="calorie-remaining${overBudget ? " over" : ""}">${roundDisplay(Math.abs(remaining))}</div>
          <div class="calorie-caption">${overBudget ? t("home.caloriesOver") : t("home.caloriesLeft")}</div>
          <button type="button" class="calorie-meals" id="see-meals">${t("us.mealsCount", { n: mealCount })} · ${t("day.tapToSee")} ›</button>
          ${energy.credit > 0 ? `<div class="calorie-exercise">${t("home.exerciseNote", { goal: energy.baseTarget, credit: energy.credit, burned: energy.burned })}</div>` : ""}
        </div>
        ${ring}
      </div>
      <div class="macro-row">${macroTiles}</div>
    </div>
  `;
}

function waterPageHtml(water) {
  const glasses = water.glasses ?? 0;
  const progress = Math.min(glasses / 8, 1);
  const ring = ringGauge({
    size: 130,
    strokeWidth: 14,
    progress,
    color: "var(--sc-water)",
    trackColor: "rgba(79,157,241,0.15)",
    centerHtml: icon("dropFill", { size: 30, color: "var(--sc-water)" }),
  });
  return `
    <div class="water-page">
      <div class="water-card card">
        ${ring}
        <div>
          <div class="water-glasses-label">${glasses} glasses</div>
          <div class="water-sub-label">(250 ml each)</div>
        </div>
        <div class="water-buttons">
          <button class="water-round-btn" data-water="minus">${icon("minus", { size: 22, color: "#fff" })}</button>
          <button class="water-round-btn" data-water="plus">${icon("plus", { size: 22, color: "#fff" })}</button>
        </div>
      </div>
    </div>
  `;
}

function notifyBannerHtml() {
  return `
    <div class="notify-banner card">
      ${icon("bell", { size: 16 })}
      <div class="notify-banner-body">
        <div class="notify-banner-text">Get notified when the analysis is done. No need to wait.</div>
        <button class="notify-banner-btn" data-notify-request>Notify Me</button>
      </div>
      <button class="notify-banner-close" data-notify-close>${icon("xmark", { size: 14 })}</button>
    </div>
  `;
}

function wireSwiper(container) {
  const track = container.querySelector("#swiper-track");
  const dots = container.querySelectorAll(".swiper-dot");
  const fitHeight = () => {
    const page = track?.children[swiperPage];
    if (page && track.parentElement) track.parentElement.style.height = `${page.offsetHeight}px`;
  };
  requestAnimationFrame(fitHeight);
  track?.addEventListener("transitionend", fitHeight);
  dots.forEach((dot) => {
    dot.addEventListener("click", () => {
      swiperPage = Number(dot.dataset.dot);
      track.style.transform = `translateX(${-swiperPage * 100}%)`;
      fitHeight();
      dots.forEach((d) => d.classList.toggle("active", Number(d.dataset.dot) === swiperPage));
    });
  });

  let startX = null;
  let dx = 0;
  let dragging = false;
  const wrapper = track.parentElement;

  const start = (e) => {
    startX = (e.touches ? e.touches[0] : e).clientX;
    dragging = true;
    track.style.transition = "none";
  };
  const move = (e) => {
    if (!dragging) return;
    dx = (e.touches ? e.touches[0] : e).clientX - startX;
    const pct = (dx / wrapper.offsetWidth) * 100;
    track.style.transform = `translateX(${-swiperPage * 100 + pct}%)`;
  };
  const end = () => {
    if (!dragging) return;
    dragging = false;
    track.style.transition = "";
    const pct = (dx / wrapper.offsetWidth) * 100;
    if (pct < -20 && swiperPage < 1) swiperPage = 1;
    else if (pct > 20 && swiperPage > 0) swiperPage = 0;
    track.style.transform = `translateX(${-swiperPage * 100}%)`;
    fitHeight();
    dots.forEach((d) => d.classList.toggle("active", Number(d.dataset.dot) === swiperPage));
    dx = 0;
  };

  wrapper.addEventListener("touchstart", start, { passive: true });
  wrapper.addEventListener("touchmove", move, { passive: true });
  wrapper.addEventListener("touchend", end);
  wrapper.addEventListener("mousedown", start);
  window.addEventListener("mousemove", (e) => dragging && move(e));
  window.addEventListener("mouseup", () => dragging && end());
}

function wireWaterButtons(container) {
  const minus = container.querySelector('[data-water="minus"]');
  const plus = container.querySelector('[data-water="plus"]');
  if (minus) minus.addEventListener("click", () => store.decrementWater(viewedDate()));
  if (plus) plus.addEventListener("click", () => store.incrementWater(viewedDate()));
}

function wireNotifyBanner(container) {
  const requestBtn = container.querySelector("[data-notify-request]");
  const closeBtn = container.querySelector("[data-notify-close]");
  if (requestBtn) {
    requestBtn.addEventListener("click", async () => {
      await queue.requestNotificationPermission();
      render(container);
    });
  }
  if (closeBtn) {
    closeBtn.addEventListener("click", () => store.setNotifyBannerDismissed(true));
  }
}

/** Row tap routing, shared by Today and History (§5.4.4). */
export function handleRowTap(entry, container) {
  const state = queue.entryState(entry);
  if (state === "pending") return;
  if (state === "failed") {
    openActionSheet({
      title: "Analysis failed",
      message: entry.analysisFailureReason || "Something went wrong during analysis.",
      actions: [
        { label: "Retry", onSelect: () => queue.retry(entry.id) },
        {
          label: "Edit manually",
          onSelect: () => {
            store.updateFoodEntry(entry.id, { analysisFailed: false });
            openAddFoodSheet({ entry: store.getFoodEntry(entry.id) });
          },
        },
        { label: "Delete", destructive: true, onSelect: () => store.deleteFoodEntry(entry.id) },
        { label: "Cancel", cancel: true },
      ],
    });
    return;
  }
  if (entry.analysisItems != null) {
    openResultsSheet(entry);
    return;
  }
  openAddFoodSheet({ entry });
}


function exerciseSectionHtml(date = new Date()) {
  const rows = exerciseRowsHtml(date);
  return `
    <div class="exercise-section">
      <div class="section-head-row">
        <h2 class="section-title">${t("home.exercise")}</h2>
        <button type="button" class="section-action" id="add-exercise-btn">${t("app.add")}</button>
      </div>
      ${rows || `<div class="exercise-empty">${t("home.noExercise")}</div>`}
    </div>`;
}

function wireExercise(container, date = new Date()) {
  container.querySelector("#add-exercise-btn")?.addEventListener("click", () =>
    openExerciseSheet({ timestamp: viewedTimestamp(), onSaved: () => render(container) })
  );
  container.querySelectorAll("[data-delete-exercise]").forEach((btn) => {
    btn.addEventListener("click", () => {
      store.deleteExerciseEntry(btn.dataset.deleteExercise);
      render(container);
    });
  });
}


/** Tapping a day in the week strip opens it; future days are ignored. */
function wireDaySelection(container) {
  container.querySelectorAll("[data-day-start]").forEach((el) => {
    el.addEventListener("click", () => {
      const dayStart = Number(el.dataset.dayStart);
      if (!Number.isFinite(dayStart) || dayStart > startOfDay(new Date())) return;
      selectedDayStart = dayStart === startOfDay(new Date()) ? null : dayStart;
      render(container);
    });
  });
  container.querySelector("#back-to-today")?.addEventListener("click", () => {
    selectedDayStart = null;
    weekOffset = 0;
    render(container);
  });
  container.querySelector("#week-prev")?.addEventListener("click", () => {
    weekOffset -= 1;
    render(container);
  });
  container.querySelector("#week-next")?.addEventListener("click", () => {
    if (weekOffset < 0) weekOffset += 1;
    render(container);
  });
}

function formatViewedDay(date) {
  return formatDate(date, { weekday: "long", month: "short", day: "numeric" });
}


/** The doodle card: the character, drawn with your face if you've set a photo, and a message
 *  written for you from your own numbers. A new message every 12 hours. */
function doodleCardHtml() {
  const { state, streak } = doodleState();
  const profile = store.getProfile();
  const variant = profile.doodleVariant === "b" ? "b" : "a";

  // Nano Banana's drawing when there is one; otherwise the app's own doodle while it's made.
  const nano = cachedNanoDoodle(state, variant, profile.avatar ?? null);
  if (!nano) {
    ensureNanoDoodle(state, variant, profile.avatar ?? null).then((url) => {
      const holder = document.getElementById("doodle-figure");
      if (url && holder) holder.innerHTML = `<img class="nano-doodle" src="${url}" alt="" />`;
    });
  }

  const face = profile.avatar ? cachedFaceDoodle(profile.avatar) : null;
  if (profile.avatar && !face && !nano) {
    // first time with this photo: sketch it in the background, then redraw just the doodle
    makeFaceDoodle(profile.avatar).then((sketchUrl) => {
      const holder = document.getElementById("doodle-figure");
      if (sketchUrl && holder) holder.innerHTML = doodleSvg({ state, streak, variant, size: 100, face: sketchUrl });
    });
  }

  const totals = store.totalsForDay();
  const goals = store.computeGoals();
  const energy = store.dayEnergy();
  const exercise = store.exerciseForDay();
  const change = store.weightChange(30);
  const latest = store.weightSeries(14).slice(-1)[0];
  const goalKg = Number(profile.goalWeightKg) || null;
  const username = (typeof localStorage !== "undefined" && localStorage.getItem("snapcal.username")) || "";
  const name = username ? username.replace(/[-_]\d*$/, "").replace(/^./, (c) => c.toUpperCase()).replace(/\d+$/, "") : "";

  const text = doodleMessage({
    name: name || (currentLanguage() === "es" ? "tú" : "you"),
    variant,
    state,
    streak,
    eaten: Math.round(totals.calories),
    target: energy.adjustedTarget,
    remaining: energy.remaining,
    proteinLeft: Math.max(0, Math.round(goals.proteinTargetG - totals.proteinG)),
    proteinHit: totals.proteinG >= goals.proteinTargetG * 0.95,
    meals: store.entriesForDay(new Date()).filter((e) => e.isPending !== true).length,
    exerciseMin: exercise.reduce((n, e) => n + (e.minutes || 0), 0),
    burned: energy.burned,
    weightDelta30: change ? change.delta : null,
    goalLeft: goalKg && latest ? Math.round(Math.abs(latest.avg - goalKg) * 10) / 10 : null,
    hour: new Date().getHours(),
    daysSinceLog: Number.isFinite(daysSinceLastLog()) ? daysSinceLastLog() : 2,
  }, { lang: currentLanguage() === "es" ? "es" : "en", username });

  return `
    <div class="doodle-card">
      <div id="doodle-figure">${nano ? `<img class="nano-doodle" src="${nano}" alt="" />` : doodleSvg({ state, streak, variant, size: face ? 100 : 86, face })}</div>
      <div class="doodle-text" id="doodle-text">
        <div class="doodle-title">${t(`doodle.${state}Title`)}</div>
        <div class="doodle-sub">${text}</div>
      </div>
    </div>`;
}


function weekRangeLabel(week) {
  const first = new Date(week[0].dayStart);
  const last = new Date(week[week.length - 1].dayStart);
  const sameMonth = first.getMonth() === last.getMonth();
  const f = (d, withMonth) => formatDate(d, withMonth ? { month: "short", day: "numeric" } : { day: "numeric" });
  return `${f(first, true)} – ${f(last, !sameMonth)}`;
}


/** Daily myth: the claim first, the evidence behind a tap — so it reads like a quiz, not a lecture. */
let mythRevealed = false;
let mythDay = "";

function mythCardHtml() {
  const today = new Date().toDateString();
  if (mythDay !== today) { mythDay = today; mythRevealed = false; }
  const m = mythForDay(new Date());
  const lang = currentLanguage() === "es" ? "es" : "en";
  const text = m[lang];
  return `
    <button type="button" class="myth-card${mythRevealed ? " is-open" : ""}" id="myth-card" aria-expanded="${mythRevealed}">
      <div class="myth-top">
        <span class="myth-q">?</span>
        <span class="myth-label">${t("myth.label")}</span>
        <span class="myth-cat">${t(`myth.cats.${m.cat}`)}</span>
      </div>
      <div class="myth-claim">“${text.myth}”</div>
      ${mythRevealed
        ? `<div class="myth-answer">
             <span class="myth-verdict">${t("myth.verdict")}</span>
             <p>${text.truth}</p>
             <span class="myth-again">${t("myth.again")}</span>
           </div>`
        : `<div class="myth-hint">${t("myth.tapToReveal")} ›</div>`}
    </button>`;
}

function wireMythCard(container) {
  container.querySelector("#myth-card")?.addEventListener("click", () => {
    mythRevealed = !mythRevealed;
    render(container);
    container.querySelector("#myth-card")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  });
}


function exerciseMinutes(date) {
  return store.exerciseForDay(date).reduce((n, e) => n + (e.minutes || 0), 0);
}

/** The day's exercise, in a sheet: the list, delete, and Add. */
async function openExerciseDaySheet(date, onChange) {
  const { openSheet, navBar, wireNavBar } = await import("./sheet.js");
  openSheet({
    render(panel, close) {
      const draw = () => {
        const rows = exerciseRowsHtml(date);
        panel.innerHTML = `
          ${navBar({ title: t("home.exercise"), leading: { label: t("app.close") }, trailing: { label: t("app.add"), bold: true } })}
          <div class="sheet-panel-body"><div class="ex-day-list">${rows || `<div class="exercise-empty">${t("home.noExercise")}</div>`}</div></div>`;
        panel.querySelectorAll("[data-delete-exercise]").forEach((b) => b.addEventListener("click", () => {
          store.deleteExerciseEntry(b.dataset.deleteExercise);
          draw();
          onChange?.();
        }));
        wireNavBar(panel, {
          onLeading: () => close(),
          onTrailing: () => { close(); openExerciseSheet({ timestamp: viewedTimestamp(), onSaved: onChange }); },
        });
      };
      draw();
    },
  });
}

/** Today's myth in a sheet: the claim, then the evidence behind a tap. */
async function openMythSheet() {
  const { openSheet, navBar, wireNavBar } = await import("./sheet.js");
  openSheet({
    render(panel, close) {
      mythRevealed = false;
      const draw = () => {
        panel.innerHTML = `${navBar({ title: t("myth.label"), leading: { label: t("app.close") } })}
          <div class="sheet-panel-body">${mythCardHtml()}</div>`;
        panel.querySelector("#myth-card")?.addEventListener("click", () => { mythRevealed = !mythRevealed; draw(); });
        wireNavBar(panel, { onLeading: () => close() });
      };
      draw();
    },
  });
}


/**
 * A note from another member replaces the automatic message on the doodle card until it's
 * dismissed (or two days pass). Checked on each Home render, at most once a minute.
 */
async function showNoteIfAny(container) {
  const notes = await inbox();
  const note = noteToShow(notes);
  const host = container.querySelector("#doodle-text");
  if (!note || !host) return;
  const who = String(note.from_user).replace(/[-_]\d*$/, "").replace(/\d+$/, "").replace(/^./, (c) => c.toUpperCase());
  const esc = (x) => String(x).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  host.innerHTML = `
    <div class="note-from">✉︎ ${t("social.fromName", { name: esc(who) })}</div>
    <div class="note-body">${esc(note.body)}</div>
    <button type="button" class="note-dismiss" id="note-dismiss">${t("social.dismiss")}</button>`;
  host.closest(".doodle-card")?.classList.add("has-note");
  host.querySelector("#note-dismiss")?.addEventListener("click", async () => {
    await markNoteSeen(note.id);
    render(container);
  });
}
