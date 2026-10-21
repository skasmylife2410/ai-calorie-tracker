// formfields.js — shared `ProfileFormFields` (Body stats / Activity level / Goal) and
// `CalculatorEstimateRows`, used identically by onboarding.js and profile.js (SPEC-UI.md §3.3, §4.3).
//
// Adaptation note: the native app uses `.pickerStyle(.navigationLink)` (tap pushes a new screen
// with a selection list) for Sex/Activity/Goal. The web clone uses a row styled identically
// (value + chevron) with an invisible native <select> overlaid on top, so tapping still opens the
// platform's native picker UI in one tap without a page push — visually and behaviorally
// equivalent for a single-level choice, without building a second navigation stack.

import { wireNumericInput } from "./numeric-field.js";
import { ACTIVITY_LABELS, SEX_LABELS, roundDisplay, buildsMuscle, goalOf, targetDelta } from "../nutrition.js";
import { icon } from "./icons.js";
import { t } from "../i18n.js";

// The goal, as setup asks it (onboarding.js): what for and how fast. Building muscle is a switch
// next to it for losing fat or keeping weight (nutrition.buildsMuscle); the "Build muscle" goal
// always does.
export const GOAL_CHOICES = [
  { key: "lose:slow", goal: "lose", rate: "slow" },
  { key: "lose:normal", goal: "lose", rate: "normal" },
  { key: "lose:fast", goal: "lose", rate: "fast" },
  { key: "maintain", goal: "maintain", rate: null },
  { key: "gain:slow", goal: "gain", rate: "slow" },
  { key: "gain:normal", goal: "gain", rate: "normal" },
  { key: "gain:fast", goal: "gain", rate: "fast" },
];
const RATE_KEYS = { slow: "onb.rateSlow", normal: "onb.rateNormal", fast: "onb.rateFast" };

/** Which of GOAL_CHOICES a profile is on (older profiles have only a calorie change). */
export function goalChoiceOf(profile) {
  const goal = goalOf(profile);
  return goal === "maintain" ? "maintain" : `${goal}:${RATE_KEYS[profile.goalRate] ? profile.goalRate : "normal"}`;
}

const patchFor = (goal, rate, buildMuscle, profile) => ({
  goal, goalRate: rate, buildMuscle,
  targetDeltaKcal: targetDelta({ goal, rate, weightKg: Number(profile.weightKg) || 0, buildMuscle }),
});

/** The profile fields a goal choice sets; the calorie change follows from the trend weight.
 *  Building muscle stays on for a steady fat loss or keeping weight; a faster fat loss turns it
 *  off (that deficit holds muscle back), and "Build muscle" turns it on. */
export function goalPatch(key, profile) {
  const c = GOAL_CHOICES.find((x) => x.key === key);
  if (!c) return null;
  const keeps = c.goal === "maintain" || c.rate === "slow";
  const buildMuscle = c.goal === "gain" || (keeps && profile.buildMuscle === true);
  return patchFor(c.goal, c.rate ?? profile.goalRate ?? null, buildMuscle, profile);
}

/** The "Build muscle too" switch: on while losing fat also sets the steady pace. */
export function musclePatch(on, profile) {
  const goal = goalOf(profile);
  return patchFor(goal, goal === "lose" && on ? "slow" : profile.goalRate ?? null, on === true, profile);
}

const goalLabel = (c) => (c.goal === "maintain" ? t("onb.goalMaintain")
  : `${t(c.goal === "lose" ? "onb.goalLose" : "onb.goalGain")} · ${t(RATE_KEYS[c.rate])}`);

function pickerRow({ id, label, currentLabel, options }) {
  return `
    <div class="ios-row linklike" style="position:relative;">
      <div class="ios-row-label">${label}</div>
      <div class="ios-row-spacer"></div>
      <div class="ios-row-value">${currentLabel}</div>
      <div class="icon chevron">${icon("chevronRight", { size: 14, color: "var(--sc-secondary)" })}</div>
      <select id="${id}" style="position:absolute;inset:0;opacity:0;width:100%;height:100%;">
        ${options.map((o) => `<option value="${o.value}"${o.selected ? " selected" : ""}>${o.label}</option>`).join("")}
      </select>
    </div>
  `;
}

export function bodyStatsSectionHtml(profile) {
  return `
    <div class="ios-section">
      <div class="ios-section-header">${t("profileScreen.bodyStats")}</div>
      <div class="ios-section-body">
        <div class="ios-row">
          <div class="ios-row-label">${t("ui.weight")}</div>
          <div class="ios-row-spacer"></div>
          <input type="text" class="numeric-input" id="field-weight" placeholder="kg" />
          <div class="ios-row-unit">kg</div>
        </div>
        <div class="ios-row">
          <div class="ios-row-label">${t("ui.height")}</div>
          <div class="ios-row-spacer"></div>
          <input type="text" class="numeric-input" id="field-height" placeholder="cm" />
          <div class="ios-row-unit">cm</div>
        </div>
        <div class="ios-row">
          <div class="ios-row-label">${t("ui.age")}</div>
          <div class="ios-row-spacer"></div>
          <input type="text" class="numeric-input" id="field-age" placeholder="years" />
          <div class="ios-row-unit">yrs</div>
        </div>
        ${pickerRow({
          id: "field-sex",
          label: t("ui.sex"),
          currentLabel: SEX_LABELS[profile.sex],
          options: Object.keys(SEX_LABELS).map((value) => ({ value, label: t(`ui.sex_${value}`), selected: value === profile.sex })),
        })}
      </div>
    </div>
  `;
}

export function activityLevelSectionHtml(profile) {
  return `
    <div class="ios-section">
      <div class="ios-section-header">${t("profileScreen.activityLevel")}</div>
      <div class="ios-section-body">
        ${pickerRow({
          id: "field-activity",
          label: t("profileScreen.activityLevel"),
          currentLabel: t(`ui.act_${profile.activityLevel}`),
          options: Object.keys(ACTIVITY_LABELS).map((value) => ({ value, label: t(`ui.act_${value}`), selected: value === profile.activityLevel })),
        })}
      </div>
    </div>
  `;
}

export function goalSectionHtml(profile) {
  const current = goalChoiceOf(profile);
  return `
    <div class="ios-section">
      <div class="ios-section-header">${t("profileScreen.goal")}</div>
      <div class="ios-section-body">
        ${pickerRow({
          id: "field-goal",
          label: t("profileScreen.goal"),
          currentLabel: goalLabel(GOAL_CHOICES.find((c) => c.key === current)),
          options: GOAL_CHOICES.map((c) => ({ value: c.key, label: goalLabel(c), selected: c.key === current })),
        })}
        ${goalOf(profile) === "gain" ? "" : `
        <label class="ios-row theme-markers">
          <span class="theme-text"><b>${t("muscle.switch")}</b><small>${t(goalOf(profile) === "lose" ? "muscle.switchSubLose" : "muscle.switchSubKeep")}</small></span>
          <input type="checkbox" role="switch" class="ios-switch" id="field-muscle" ${buildsMuscle(profile) ? "checked" : ""} />
        </label>`}
      </div>
    </div>
  `;
}

/** Wires Weight/Height/Age numeric fields + Sex/Activity/Goal selects. `onPatch(partialProfile)` persists. */
export function wireProfileFormFields(container, profile, onPatch) {
  const weightInput = container.querySelector("#field-weight");
  const heightInput = container.querySelector("#field-height");
  const ageInput = container.querySelector("#field-age");
  const sexSelect = container.querySelector("#field-sex");
  const activitySelect = container.querySelector("#field-activity");
  const goalSelect = container.querySelector("#field-goal");

  if (weightInput) {
    wireNumericInput(weightInput, {
      getValue: () => profile.weightKg,
      decimal: true,
      min: 0,
      max: 500,
      onCommit: (v) => onPatch({ weightKg: v }),
    });
  }
  if (heightInput) {
    wireNumericInput(heightInput, {
      getValue: () => profile.heightCm,
      decimal: true,
      min: 0,
      max: 300,
      onCommit: (v) => onPatch({ heightCm: v }),
    });
  }
  if (ageInput) {
    wireNumericInput(ageInput, {
      getValue: () => profile.age,
      decimal: false,
      min: 0,
      max: 130,
      onCommit: (v) => onPatch({ age: v }),
    });
  }
  if (sexSelect) sexSelect.addEventListener("change", () => onPatch({ sex: sexSelect.value }));
  if (activitySelect) activitySelect.addEventListener("change", () => onPatch({ activityLevel: activitySelect.value }));
  if (goalSelect) goalSelect.addEventListener("change", () => { const patch = goalPatch(goalSelect.value, profile); if (patch) onPatch(patch); });
  const muscle = container.querySelector("#field-muscle");
  if (muscle) muscle.addEventListener("change", () => onPatch(musclePatch(muscle.checked, profile)));
}

/** CalculatorEstimateRows (§3.4): BMR / TDEE / Estimated target. */
export function calculatorEstimateRowsHtml(goals) {
  return `
    <div class="calc-estimate-row">
      <div class="calc-estimate-label">Estimated BMR</div>
      <div class="calc-estimate-value">${roundDisplay(goals.bmr)} kcal</div>
    </div>
    <div class="calc-estimate-row">
      <div class="calc-estimate-label">${t("ui.tdee")}</div>
      <div class="calc-estimate-value">${roundDisplay(goals.tdee)} kcal</div>
    </div>
    <div class="calc-estimate-row">
      <div class="calc-estimate-label">${t("ui.target")}</div>
      <div class="calc-estimate-value target">${roundDisplay(goals.computedTargetCalories)} kcal</div>
    </div>
  `;
}
