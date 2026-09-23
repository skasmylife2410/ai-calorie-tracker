// onboarding.js — first-run setup, one question at a time.
//
// Runs after someone creates their account (including via an invite link). It asks for what the
// numbers actually need — sex, age, height, weight, build, activity, goal and pace — shows the
// plan it worked out, and records the first weigh-in so the Weight tab starts with a point.
//
// Build matters more than people expect: Mifflin-St Jeor knows only weight, so it reads a
// muscular person as "heavy". Telling us the build switches the maths to lean mass
// (see nutrition.js), which for a muscular woman at 62 kg is worth over 100 kcal a day.

import * as store from "../store.js";
import { resolveUserGoals, estimateBodyFatPct, leanMassKg } from "../nutrition.js";
import { t, currentLanguage, setLanguage, formatNumber } from "../i18n.js";

const STEPS = ["lang", "about", "size", "build", "activity", "goal", "plan"];

const ACTIVITY = [
  { key: "sedentary", labelKey: "activity.sedentary" },
  { key: "light", labelKey: "activity.light" },
  { key: "moderate", labelKey: "activity.moderate" },
  { key: "veryActive", labelKey: "activity.active" },
  { key: "extraActive", labelKey: "activity.extra" },
];

const DEFAULTS = {
  sex: "female",
  age: 30,
  heightCm: 165,
  weightKg: 65,
  units: "metric",      // metric | imperial
  build: null,
  bodyFatPct: null,
  activityLevel: "light",
  goal: "lose",         // lose | maintain | gain
  rate: "normal",       // slow | normal | fast
};

let draft = { ...DEFAULTS };

/**
 * The starting answers when someone redoes setup: their profile, but with the weight taken
 * from their latest weigh-in (the profile's number goes stale) and units from their preference.
 * Exported so it can be tested without a browser.
 */
export function draftFromProfile(profile, latest = store.latestWeight()) {
  return {
    ...DEFAULTS,
    sex: profile.sex === "male" ? "male" : "female",
    age: Number(profile.age) > 0 ? Math.round(profile.age) : DEFAULTS.age,
    heightCm: Number(profile.heightCm) > 0 ? profile.heightCm : DEFAULTS.heightCm,
    weightKg: latest?.kg ?? (Number(profile.weightKg) > 0 ? profile.weightKg : DEFAULTS.weightKg),
    units: profile.weightUnit === "lb" ? "imperial" : "metric",
    build: profile.build ?? null,
    bodyFatPct: Number(profile.bodyFatPct) > 0 ? profile.bodyFatPct : null,
    activityLevel: profile.activityLevel ?? DEFAULTS.activityLevel,
    goal: profile.goal ?? (Number(profile.targetDeltaKcal) > 0 ? "gain" : Number(profile.targetDeltaKcal) < 0 ? "lose" : "maintain"),
    rate: profile.goalRate ?? DEFAULTS.rate,
  };
}

function prefillFrom(profile) {
  draft = draftFromProfile(profile);
}

const kgToLb = (kg) => kg * 2.2046226218;
const lbToKg = (lb) => lb / 2.2046226218;
const cmToIn = (cm) => cm / 2.54;
const inToCm = (inch) => inch * 2.54;

/** Daily calorie change for the chosen goal and pace, from % of body weight per week. */
export function targetDelta({ goal, rate, weightKg }) {
  if (goal === "maintain") return 0;
  const pctPerWeek = { slow: 0.0035, normal: 0.006, fast: 0.009 }[rate] ?? 0.006;
  const kgPerWeek = weightKg * pctPerWeek;
  const perDay = Math.round((kgPerWeek * 7700) / 7 / 10) * 10;
  // Gaining muscle needs a much smaller surplus than a fat-loss deficit, or it's mostly fat
  return goal === "gain" ? Math.min(400, Math.round(perDay * 0.55)) : -perDay;
}

/**
 * @param {HTMLElement} container
 * @param {Function} onComplete
 * @param {{redo?: boolean}} opts  redo: prefill from the existing profile and keep all data
 */
export function render(container, onComplete, { redo = false } = {}) {
  if (redo) prefillFrom(store.getProfile());
  else draft = { ...DEFAULTS };
  let step = 0;

  const goals = () => resolveUserGoals({
    weightKg: draft.weightKg, heightCm: draft.heightCm, age: draft.age, sex: draft.sex,
    activityLevel: draft.activityLevel, build: draft.build, bodyFatPct: draft.bodyFatPct,
    targetDeltaKcal: targetDelta(draft),
  });

  const finish = () => {
    const g = goals();
    store.setProfile({
      weightKg: draft.weightKg,
      heightCm: draft.heightCm,
      age: draft.age,
      sex: draft.sex,
      build: draft.build,
      bodyFatPct: draft.bodyFatPct,
      activityLevel: draft.activityLevel,
      goal: draft.goal,
      goalRate: draft.rate,
      targetDeltaKcal: targetDelta(draft),
      customTargetKcal: null,
      weightUnit: draft.units === "imperial" ? "lb" : "kg",
      doodleVariant: draft.sex === "female" ? "b" : "a",
      language: currentLanguage(),
      hasCompletedOnboarding: true,
    });
    // First point on the weight chart, so the trend can start immediately. On a redo this
    // replaces today's reading rather than adding a second one (one reading a day).
    store.addWeightEntry({ kg: draft.weightKg });
    onComplete?.();
  };

  const draw = () => {
    const name = STEPS[step];
    container.innerHTML = `
      <div class="onb">
        <div class="onb-top">
          <div class="onb-progress"><span style="width:${((step + 1) / STEPS.length) * 100}%"></span></div>
          <div class="onb-step">${t("onb.step", { n: step + 1, total: STEPS.length })}</div>
        </div>
        <div class="onb-body" id="onb-body">${bodyHtml(name)}</div>
        <div class="onb-actions">
          ${step > 0 ? `<button type="button" class="onb-back" id="onb-back">${t("onb.back")}</button>` : ""}
          <button type="button" class="onb-next" id="onb-next">${name === "plan" ? t("onb.start") : t("onb.next")}</button>
        </div>
      </div>`;
    wire(name);
    container.querySelector("#onb-back")?.addEventListener("click", () => { step--; draw(); });
    container.querySelector("#onb-next")?.addEventListener("click", () => {
      if (name === "plan") return finish();
      step++;
      draw();
    });
  };

  const choice = (value, current, label, sub = "") => `
    <button type="button" class="onb-choice${value === current ? " is-on" : ""}" data-choice="${value}">
      <span class="onb-choice-label">${label}</span>
      ${sub ? `<span class="onb-choice-sub">${sub}</span>` : ""}
    </button>`;

  function bodyHtml(name) {
    switch (name) {
      case "lang":
        return `
          <h1 class="onb-title">${t("onb.langTitle")}</h1>
          <p class="onb-sub">${t("onb.langSub")}</p>
          <div class="onb-choices">
            ${choice("en", currentLanguage(), "English")}
            ${choice("es", currentLanguage(), "Español")}
          </div>`;

      case "about":
        return `
          <h1 class="onb-title">${t("onb.aboutTitle")}</h1>
          <p class="onb-sub">${t("onb.aboutSub")}</p>
          <div class="onb-choices onb-row">
            ${choice("female", draft.sex, t("onb.woman"))}
            ${choice("male", draft.sex, t("onb.man"))}
          </div>
          <label class="onb-label">${t("onb.age")}</label>
          <div class="onb-field"><input id="onb-age" class="onb-input" type="number" inputmode="numeric" min="13" max="100" value="${draft.age}" /><span>${t("onb.years")}</span></div>`;

      case "size": {
        const imperial = draft.units === "imperial";
        const ft = Math.floor(cmToIn(draft.heightCm) / 12);
        const inch = Math.round(cmToIn(draft.heightCm) % 12);
        return `
          <h1 class="onb-title">${t("onb.sizeTitle")}</h1>
          <div class="onb-units">
            <button type="button" data-units="metric" aria-pressed="${!imperial}">kg / cm</button>
            <button type="button" data-units="imperial" aria-pressed="${imperial}">lb / ft</button>
          </div>
          <label class="onb-label">${t("onb.height")}</label>
          ${imperial
            ? `<div class="onb-field"><input id="onb-ft" class="onb-input" type="number" inputmode="numeric" min="3" max="7" value="${ft}" /><span>ft</span>
               <input id="onb-in" class="onb-input" type="number" inputmode="numeric" min="0" max="11" value="${inch}" /><span>in</span></div>`
            : `<div class="onb-field"><input id="onb-cm" class="onb-input" type="number" inputmode="numeric" min="120" max="230" value="${Math.round(draft.heightCm)}" /><span>cm</span></div>`}
          <label class="onb-label">${t("onb.weight")}</label>
          <div class="onb-field">
            <input id="onb-weight" class="onb-input" type="number" inputmode="decimal" step="0.1"
                   value="${imperial ? Math.round(kgToLb(draft.weightKg) * 10) / 10 : Math.round(draft.weightKg * 10) / 10}" />
            <span>${imperial ? "lb" : "kg"}</span>
          </div>`;
      }

      case "build":
        return `
          <h1 class="onb-title">${t("onb.buildTitle")}</h1>
          <p class="onb-sub">${t("onb.buildSub")}</p>
          <div class="onb-choices">
            ${choice("slim", draft.build, t("onb.buildSlim"), t("onb.buildSlimSub"))}
            ${choice("average", draft.build, t("onb.buildAverage"), t("onb.buildAverageSub"))}
            ${choice("muscular", draft.build, t("onb.buildMuscular"), t("onb.buildMuscularSub"))}
            ${choice("larger", draft.build, t("onb.buildLarger"), t("onb.buildLargerSub"))}
          </div>
          <label class="onb-label">${t("onb.bodyFat")}</label>
          <div class="onb-field"><input id="onb-bf" class="onb-input" type="number" inputmode="decimal" min="5" max="60" step="0.5"
            value="${draft.bodyFatPct ?? ""}" placeholder="${draft.build ? estimateBodyFatPct(draft.build, draft.sex) : ""}" /><span>%</span></div>`;

      case "activity":
        return `
          <h1 class="onb-title">${t("onb.activityTitle")}</h1>
          <p class="onb-sub">${t("onb.activitySub")}</p>
          <div class="onb-choices">
            ${ACTIVITY.map((a) => choice(a.key, draft.activityLevel, t(a.labelKey))).join("")}
          </div>`;

      case "goal": {
        const kgPerWeek = draft.goal === "maintain" ? 0
          : Math.abs(targetDelta(draft)) * 7 / 7700;
        return `
          <h1 class="onb-title">${t("onb.goalTitle")}</h1>
          <div class="onb-choices">
            ${choice("lose", draft.goal, t("onb.goalLose"))}
            ${choice("maintain", draft.goal, t("onb.goalMaintain"))}
            ${choice("gain", draft.goal, t("onb.goalGain"))}
          </div>
          ${draft.goal === "maintain" ? "" : `
            <label class="onb-label">${t("onb.rateTitle")}</label>
            <div class="onb-choices onb-row">
              ${choice("slow", draft.rate, t("onb.rateSlow"))}
              ${choice("normal", draft.rate, t("onb.rateNormal"))}
              ${choice("fast", draft.rate, t("onb.rateFast"))}
            </div>
            <p class="onb-note">${t("onb.ratePerWeek", { n: (Math.round(kgPerWeek * 100) / 100).toFixed(2) })} · ${t("onb.rateNote")}</p>`}`;
      }

      case "plan": {
        const g = goals();
        const lean = leanMassKg({ weightKg: draft.weightKg, bodyFatPct: draft.bodyFatPct, build: draft.build, sex: draft.sex });
        return `
          <h1 class="onb-title">${t("onb.planTitle")}</h1>
          <div class="onb-plan">
            <div class="onb-plan-row"><span>${t("onb.planMaintenance")}</span><b>${formatNumber(Math.round(g.formulaTdee))} kcal</b></div>
            <div class="onb-plan-big">${formatNumber(g.targetCalories)}<small>kcal</small></div>
            <div class="onb-plan-label">${t("onb.planTarget")}</div>
            <div class="onb-plan-macros">${t("onb.planMacros", { p: g.proteinTargetG, c: g.carbsTargetG, f: g.fatTargetG })}</div>
          </div>
          ${lean > 0 ? `<p class="onb-note">${t("onb.planLean", { n: Math.round(lean * 10) / 10 })}</p>` : ""}
          <p class="onb-note">${t("onb.planLearn")}</p>`;
      }
      default:
        return "";
    }
  }

  function wire(name) {
    const body = container.querySelector("#onb-body");
    body.querySelectorAll("[data-choice]").forEach((b) => b.addEventListener("click", async () => {
      const v = b.dataset.choice;
      if (name === "lang") { await setLanguage(v); draw(); return; }
      if (name === "about") draft.sex = v;
      if (name === "build") { draft.build = v; draft.bodyFatPct = null; }
      if (name === "activity") draft.activityLevel = v;
      if (name === "goal") (["slow", "normal", "fast"].includes(v) ? (draft.rate = v) : (draft.goal = v));
      draw();
    }));

    body.querySelectorAll("[data-units]").forEach((b) => b.addEventListener("click", () => { draft.units = b.dataset.units; draw(); }));

    const num = (id, apply) => {
      const el = body.querySelector(id);
      el?.addEventListener("change", () => apply(Number(el.value)));
      el?.addEventListener("blur", () => apply(Number(el.value)));
    };
    num("#onb-age", (v) => { if (v >= 13 && v <= 100) draft.age = Math.round(v); });
    num("#onb-cm", (v) => { if (v >= 120 && v <= 230) draft.heightCm = v; });
    num("#onb-bf", (v) => { draft.bodyFatPct = v >= 5 && v <= 60 ? v : null; });
    num("#onb-weight", (v) => {
      if (!(v > 0)) return;
      draft.weightKg = draft.units === "imperial" ? lbToKg(v) : v;
    });
    const ftEl = body.querySelector("#onb-ft");
    const inEl = body.querySelector("#onb-in");
    const applyFeet = () => {
      const ft = Number(ftEl?.value) || 0;
      const inch = Number(inEl?.value) || 0;
      if (ft > 0) draft.heightCm = inToCm(ft * 12 + inch);
    };
    ftEl?.addEventListener("change", applyFeet);
    inEl?.addEventListener("change", applyFeet);
  }

  draw();
}
