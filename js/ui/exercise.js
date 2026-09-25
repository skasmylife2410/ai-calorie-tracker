// exercise.js — Exercise logging sheet. Two ways in: describe it in words (Gemini parses it, same
// proxy as meals) or tap activity + duration + intensity. The burn is an ESTIMATE; only the
// EXERCISE_CREDIT_RATIO share of it raises the day's calorie budget, and the sheet shows both
// numbers rather than one blended figure.

import * as store from "../store.js";
import { t, formatNumber, currentLanguage } from "../i18n.js";
import { parseExerciseText } from "../api.js";
import { icon } from "./icons.js";
import { openSheet, navBar, wireNavBar } from "./sheet.js";
import { estimateCaloriesBurned, exerciseCredit, ACTIVITY_METS } from "../nutrition.js";

const ACTIVITIES = [
  { key: "soccer", emoji: "⚽" },
  { key: "walk", emoji: "🚶" },
  { key: "run", emoji: "🏃" },
  { key: "gym", emoji: "🏋️" },
  { key: "cycling", emoji: "🚴" },
  { key: "swim", emoji: "🏊" },
  { key: "other", emoji: "✨" },
];
const INTENSITIES = ["easy", "moderate", "hard"];
const activityLabel = (key) => t(`exercise.activities.${key}`);

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function openExerciseSheet({ timestamp = Date.now(), onSaved } = {}) {
  openSheet({
    render(panel, close) {
      let activity = "soccer";
      let minutes = 45;
      let intensity = "moderate";
      let parsing = false;
      let parseError = "";
      // "estimate": activity × minutes × intensity. "kcal": a number they already have (a watch,
      // a gym machine, a fitness app), with minutes optional.
      let mode = "estimate";
      let typedKcal = null;
      let typedMinutes = null;

      panel.innerHTML = `
        ${navBar({ title: t("exercise.title"), leading: { label: t("app.cancel") } })}
        <div class="sheet-panel-body">
          <div class="ex-mode" role="group" aria-label="${t("exercise.title")}">
            <button type="button" data-mode="estimate" aria-pressed="true">${t("exercise.modeEstimate")}</button>
            <button type="button" data-mode="kcal" aria-pressed="false">${t("exercise.modeKcal")}</button>
          </div>

          <div class="ex-card is-hidden" id="ex-kcal-card">
            <div class="ex-card-label">${t("exercise.kcalLabel")}</div>
            <div class="ex-kcal-row">
              <input id="ex-kcal" class="ex-kcal-input" type="text" inputmode="numeric" placeholder="350" autocomplete="off" />
              <span class="ex-kcal-unit">${t("exercise.burned")}</span>
            </div>
            <div class="ex-card-hint">${t("exercise.kcalHint")}</div>
          </div>

          <div class="ex-card" id="ex-describe-card">
            <div class="ex-card-label">${t("exercise.describeIt")}</div>
            <div class="ex-describe-row">
              <input id="ex-text" class="ex-input" type="text" placeholder="${t("exercise.placeholder")}"
                     autocomplete="off" enterkeyhint="done" />
              <button type="button" class="ex-parse" id="ex-parse">${icon("wandAndStars", { size: 17 })}</button>
            </div>
            <div class="ex-card-hint" id="ex-hint">${t("exercise.orPick")}</div>
          </div>

          <div class="ex-section-header">${t("exercise.activity")}</div>
          <div class="ex-chips" id="ex-activities"></div>

          <div class="ex-section-header">${t("exercise.duration")}</div>
          <div class="ex-card" id="ex-duration-card">
            <div class="ex-duration"><span id="ex-minutes">45</span><small>${t("exercise.minutes")}</small></div>
            <input id="ex-slider" class="ex-slider" type="range" min="5" max="180" step="5" value="45" />
          </div>
          <div class="ex-card is-hidden" id="ex-minutes-opt-card">
            <div class="ex-kcal-row">
              <input id="ex-minutes-opt" class="ex-input ex-minutes-opt" type="text" inputmode="numeric" placeholder="${t("exercise.minutesOptional")}" autocomplete="off" />
              <span class="ex-kcal-unit">${t("exercise.minutes")}</span>
            </div>
          </div>

          <div id="ex-intensity-block">
            <div class="ex-section-header">${t("exercise.intensity")}</div>
            <div class="ex-chips" id="ex-intensities"></div>
          </div>

          <div class="ex-burn" id="ex-burn"></div>
        </div>
        <div class="results-actions">
          <button class="btn-prominent" id="ex-save">${t("exercise.save")}</button>
        </div>
      `;

      const els = {
        activities: panel.querySelector("#ex-activities"),
        intensities: panel.querySelector("#ex-intensities"),
        minutes: panel.querySelector("#ex-minutes"),
        slider: panel.querySelector("#ex-slider"),
        burn: panel.querySelector("#ex-burn"),
        text: panel.querySelector("#ex-text"),
        hint: panel.querySelector("#ex-hint"),
        parse: panel.querySelector("#ex-parse"),
      };

      const weightKg = store.getProfile().weightKg;

      const renderChips = () => {
        els.activities.innerHTML = ACTIVITIES.map(
          (a) => `<button type="button" class="ex-chip${a.key === activity ? " is-on" : ""}" data-activity="${a.key}">${a.emoji} ${activityLabel(a.key)}</button>`
        ).join("");
        els.intensities.innerHTML = INTENSITIES.map(
          (key) => `<button type="button" class="ex-chip${key === intensity ? " is-on" : ""}" data-intensity="${key}">${t(`exercise.${key}`)}</button>`
        ).join("");
        els.activities.querySelectorAll("[data-activity]").forEach((b) =>
          b.addEventListener("click", () => { activity = b.dataset.activity; renderChips(); renderBurn(); })
        );
        els.intensities.querySelectorAll("[data-intensity]").forEach((b) =>
          b.addEventListener("click", () => { intensity = b.dataset.intensity; renderChips(); renderBurn(); })
        );
      };

      const saveBtn = panel.querySelector("#ex-save");
      const renderBurn = () => {
        if (mode === "kcal") {
          const burned = typedKcal ?? 0;
          const credit = exerciseCredit(burned, store.exerciseCreditRatio());
          els.burn.innerHTML = burned > 0
            ? `<div class="ex-burn-note">${credit > 0
                ? t("accuracy.exNoteOn", { credit, pct: Math.round(store.exerciseCreditRatio() * 100) })
                : t("accuracy.exNoteOff")}</div>`
            : "";
          saveBtn.disabled = !(burned > 0);
          return;
        }
        saveBtn.disabled = false;
        const burned = estimateCaloriesBurned({ activity, minutes, intensity, weightKg });
        const credit = exerciseCredit(burned, store.exerciseCreditRatio());
        els.burn.innerHTML = `
          <div class="ex-burn-top"><span class="ex-burn-num">−${formatNumber(burned)}</span><span class="ex-burn-unit">${t("exercise.burned")}</span></div>
          <div class="ex-burn-note">${credit > 0
            ? t("accuracy.exNoteOn", { credit, pct: Math.round(store.exerciseCreditRatio() * 100) })
            : t("accuracy.exNoteOff")}</div>`;
      };

      const setMinutes = (n) => {
        minutes = Math.max(0, Math.round(Number(n) || 0));
        els.minutes.textContent = String(minutes);
        els.slider.value = String(Math.min(180, Math.max(5, minutes)));
        renderBurn();
      };

      els.slider.addEventListener("input", () => setMinutes(els.slider.value));

      const runParse = async () => {
        const text = els.text.value.trim();
        if (text === "" || parsing) return;
        parsing = true;
        parseError = "";
        els.hint.textContent = t("exercise.reading");
        els.parse.disabled = true;

        const outcome = await parseExerciseText(text, { lang: currentLanguage() });
        parsing = false;
        els.parse.disabled = false;

        if (!outcome.ok) {
          parseError = outcome.message || t("exercise.notAWorkout");
          els.hint.textContent = parseError;
          els.hint.classList.add("is-error");
          return;
        }
        const first = outcome.sessions[0];
        if (!first) {
          els.hint.textContent = t("exercise.notAWorkout");
          els.hint.classList.add("is-error");
          return;
        }
        els.hint.classList.remove("is-error");
        els.hint.textContent = t("exercise.readAs", { name: first.name });
        activity = ACTIVITIES.some((a) => a.key === first.activity) ? first.activity : "other";
        intensity = INTENSITIES.includes(first.intensity) ? first.intensity : "moderate";
        setMinutes(first.minutes);
        renderChips();
      };

      els.parse.addEventListener("click", runParse);
      els.text.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); runParse(); } });

      const setMode = (next) => {
        mode = next;
        panel.querySelectorAll("[data-mode]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === mode)));
        const kcal = mode === "kcal";
        panel.querySelector("#ex-kcal-card").classList.toggle("is-hidden", !kcal);
        panel.querySelector("#ex-minutes-opt-card").classList.toggle("is-hidden", !kcal);
        panel.querySelector("#ex-describe-card").classList.toggle("is-hidden", kcal);
        panel.querySelector("#ex-duration-card").classList.toggle("is-hidden", kcal);
        panel.querySelector("#ex-intensity-block").classList.toggle("is-hidden", kcal);
        renderBurn();
        if (kcal) setTimeout(() => panel.querySelector("#ex-kcal")?.focus(), 50);
      };
      panel.querySelectorAll("[data-mode]").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));

      const wholeNumber = (raw, max) => {
        const n = Math.round(Number(String(raw).replace(/[^\d.,]/g, "").replace(",", ".")));
        return Number.isFinite(n) && n > 0 ? Math.min(n, max) : null;
      };
      panel.querySelector("#ex-kcal").addEventListener("input", (e) => { typedKcal = wholeNumber(e.target.value, 5000); renderBurn(); });
      panel.querySelector("#ex-minutes-opt").addEventListener("input", (e) => { typedMinutes = wholeNumber(e.target.value, 1440); });

      saveBtn.addEventListener("click", () => {
        const typed = els.text.value.trim();
        const label = activityLabel(activity);
        if (mode === "kcal") {
          if (!(typedKcal > 0)) return;
          store.addExerciseEntry({
            name: label,
            activity,
            minutes: typedMinutes ?? 0,
            intensity: "moderate",
            caloriesBurned: typedKcal,
            kcalEntered: true,
            timestamp,
          });
          if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") navigator.vibrate(20);
          if (typeof onSaved === "function") onSaved();
          close();
          return;
        }
        if (minutes <= 0) return;
        store.addExerciseEntry({
          name: typed !== "" ? typed.slice(0, 60) : label,
          activity,
          minutes,
          intensity,
          timestamp,
        });
        if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") navigator.vibrate(20);
        if (typeof onSaved === "function") onSaved();
        close();
      });

      renderChips();
      renderBurn();
      wireNavBar(panel, { onLeading: () => close() });
    },
  });
}

/** Rows for the day's exercise, used by the Today screen. */
export function exerciseRowsHtml(date = new Date()) {
  const rows = store.exerciseForDay(date);
  if (rows.length === 0) return "";
  return rows
    .map((e) => {
      const label = ACTIVITIES.find((a) => a.key === e.activity)?.emoji ?? "✨";
      return `
        <div class="ex-row card" data-exercise-id="${e.id}">
          <div class="ex-row-icon">${label}</div>
          <div class="ex-row-text">
            <div class="ex-row-name">${escapeHtml(e.name || activityLabel(e.activity))}</div>
            <div class="ex-row-sub">${t(e.minutes > 0 ? "exercise.rowSub" : "exercise.rowSubKcal", { minutes: e.minutes, burned: e.caloriesBurned || 0, credit: exerciseCredit(e.caloriesBurned || 0, store.exerciseCreditRatio()) })}</div>
          </div>
          <button type="button" class="ex-row-del" data-delete-exercise="${e.id}" aria-label="${t("app.delete")}">${icon("trashFill", { size: 16 })}</button>
        </div>`;
    })
    .join("");
}

export { ACTIVITIES };
