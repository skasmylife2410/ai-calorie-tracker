// nutrition.js — pure math port of NutritionMath.swift + UserProfile computed properties.
// No I/O, no DOM, no localStorage. Every function here is deterministic and side-effect free
// so it can be unit tested directly (see web/tests/core.test.mjs).

/** @typedef {"male"|"female"} Sex */
/** @typedef {"sedentary"|"light"|"moderate"|"veryActive"|"extraActive"} ActivityLevel */

/** Activity multipliers, verbatim from ActivityLevel.multiplier (Models.swift). */
export const ACTIVITY_MULTIPLIERS = Object.freeze({
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  veryActive: 1.725,
  extraActive: 1.9,
});

/** Display labels, verbatim from ActivityLevel.label. */
export const ACTIVITY_LABELS = Object.freeze({
  sedentary: "Sedentary — desk job",
  light: "Light — 1-3 workouts/week",
  moderate: "Moderate — 3-5 workouts/week",
  veryActive: "Very active — 6-7 workouts/week",
  extraActive: "Extra active — physical job or 2x/day training",
});

export const SEX_LABELS = Object.freeze({ male: "Male", female: "Female" });

/** Decode fallback: unknown raw string -> "sedentary" (Models.swift ActivityLevel decode rule). */
export function normalizeActivityLevel(raw) {
  return Object.prototype.hasOwnProperty.call(ACTIVITY_MULTIPLIERS, raw) ? raw : "sedentary";
}

/** Decode fallback: unknown raw string -> "male" (Models.swift Sex decode rule). */
export function normalizeSex(raw) {
  return raw === "female" ? "female" : "male";
}

/** Decode fallback: unknown raw string -> "manual" (Models.swift EntrySource decode rule). */
export function normalizeEntrySource(raw) {
  return ["manual", "barcode", "photo", "text"].includes(raw) ? raw : "manual";
}

/**
 * Mifflin-St Jeor BMR.
 * @param {number} weightKg
 * @param {number} heightCm
 * @param {number} age
 * @param {Sex} sex
 * @returns {number}
 */
export function mifflinStJeorBMR(weightKg, heightCm, age, sex) {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  return sex === "female" ? base - 161 : base + 5;
}

/**
 * @param {number} bmr
 * @param {ActivityLevel} activityLevel
 * @returns {number}
 */
export function tdee(bmr, activityLevel) {
  const multiplier = ACTIVITY_MULTIPLIERS[normalizeActivityLevel(activityLevel)];
  return bmr * multiplier;
}

/**
 * @param {number} tdeeValue
 * @param {number} deltaKcal negative=deficit, 0=maintain, positive=surplus
 * @returns {number}
 */
export function targetCalories(tdeeValue, deltaKcal) {
  return tdeeValue + deltaKcal;
}

/**
 * 30/40/30 protein/carbs/fat calorie split, 4/4/9 kcal-per-gram conversion.
 * @param {number} targetCals
 * @returns {{proteinG: number, carbsG: number, fatG: number}}
 */
export function macroTargets(targetCals) {
  return {
    proteinG: (targetCals * 0.3) / 4,
    carbsG: (targetCals * 0.4) / 4,
    fatG: (targetCals * 0.3) / 9,
  };
}

/**
 * Custom-first goal resolution, mirrors UserProfile's computed properties exactly
 * (bmr/tdee/computedTargetCalories/targetCalories/proteinTargetG/carbsTargetG/fatTargetG/hasValidStats).
 * @param {{weightKg:number, heightCm:number, age:number, sex:Sex, activityLevel:ActivityLevel,
 *          targetDeltaKcal:number, customTargetKcal?:number|null, customProteinG?:number|null,
 *          customCarbsG?:number|null, customFatG?:number|null}} profile
 */
/** Protein floor for fat loss: 1.6 g per kg of body weight (the lower end of the 1.6–2.2 range
 *  that preserves muscle in a deficit). Only applied when weight is known. */
export const PROTEIN_G_PER_KG = 1.6;

export function resolveUserGoals(profile, { learnedTdee = null } = {}) {
  const {
    weightKg,
    heightCm,
    age,
    sex,
    activityLevel,
    targetDeltaKcal,
    customTargetKcal = null,
    customProteinG = null,
    customCarbsG = null,
    customFatG = null,
  } = profile;

  const bmr = mifflinStJeorBMR(weightKg, heightCm, age, normalizeSex(sex));
  const formulaTdee = tdee(bmr, activityLevel);
  // Maintenance: learned from the person's own intake and weight trend when there's enough data,
  // otherwise the formula. The learned number already includes their exercise and habits.
  const useLearned = Number.isFinite(learnedTdee) && learnedTdee > 0;
  const tdeeValue = useLearned ? learnedTdee : formulaTdee;
  const computedTargetCalories = targetCalories(tdeeValue, targetDeltaKcal);
  const effectiveTargetCalories =
    customTargetKcal !== null && customTargetKcal !== undefined ? customTargetKcal : computedTargetCalories;
  const macros = macroTargets(effectiveTargetCalories);

  // Protein by body weight, not as a share of calories: in a deficit a share of fewer calories
  // means less protein exactly when it matters most. Carbs give way to make room.
  let proteinG = macros.proteinG;
  let carbsG = macros.carbsG;
  if (weightKg > 0 && (customProteinG === null || customProteinG === undefined)) {
    const floor = Math.round(weightKg * PROTEIN_G_PER_KG);
    if (floor > proteinG) {
      carbsG = Math.max(0, Math.round(carbsG - ((floor - proteinG) * 4) / 4));
      proteinG = floor;
    }
  }

  return {
    bmr,
    tdee: tdeeValue,
    formulaTdee,
    tdeeSource: useLearned ? "learned" : "formula",
    computedTargetCalories,
    targetCalories: effectiveTargetCalories,
    proteinTargetG: customProteinG !== null && customProteinG !== undefined ? customProteinG : proteinG,
    carbsTargetG: customCarbsG !== null && customCarbsG !== undefined ? customCarbsG : carbsG,
    fatTargetG: customFatG !== null && customFatG !== undefined ? customFatG : macros.fatG,
    hasValidStats: weightKg > 0 && heightCm > 0 && age > 0,
  };
}

// ---------------------------------------------------------------------------
// Learned maintenance
// ---------------------------------------------------------------------------

/** Roughly how many kcal a kilo of body-weight change represents. A rule of thumb (the real
 *  figure varies with how much is fat vs water vs muscle), which is why this works on a
 *  multi-week trend rather than day to day. */
export const KCAL_PER_KG = 7700;

/**
 * What someone's maintenance really is, measured from their own data:
 *   maintenance ≈ average daily intake − (weight trend in kg/day × 7700)
 * If you averaged 1,800 kcal and lost 0.3 kg a week, you burned about 1,800 + 330 = 2,130.
 *
 * It absorbs everything the formula can't know — exercise, daily movement, individual
 * metabolism, and consistent logging habits (always forgetting the cooking oil shows up as a
 * lower maintenance, so targets stay honest).
 *
 * @param {{days:Array<{calories:number}>, weights:Array<{t:number, kg:number}>, formulaTdee:number}} input
 *   days: complete logged days in the window (already filtered); weights: one reading per day
 * @returns {null|{tdee:number, raw:number, confidence:"low"|"medium"|"high", loggedDays:number,
 *   weighIns:number, spanDays:number, kgPerWeek:number, avgIntake:number}}
 */
export function learnedMaintenance({ days = [], weights = [], formulaTdee = 0 }) {
  if (days.length < 7 || weights.length < 4) return null;
  const sorted = [...weights].sort((a, b) => a.t - b.t);
  const t0 = sorted[0].t;
  const xs = sorted.map((w) => (w.t - t0) / 86400000);
  const ys = sorted.map((w) => w.kg);
  const spanDays = xs[xs.length - 1];
  if (spanDays < 7) return null;

  // least-squares slope: robust to one odd morning, unlike first-vs-last
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0, den = 0;
  for (let i = 0; i < xs.length; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
  const slopePerDay = den > 0 ? num / den : 0;

  const avgIntake = days.reduce((a, d) => a + d.calories, 0) / days.length;
  const raw = avgIntake - slopePerDay * KCAL_PER_KG;

  const loggedDays = days.length;
  const weighIns = sorted.length;
  let confidence = "low";
  if (loggedDays >= 14 && weighIns >= 8 && spanDays >= 13) confidence = "medium";
  if (loggedDays >= 21 && weighIns >= 14 && spanDays >= 20) confidence = "high";
  // a result wildly different from the formula usually means incomplete logging, not a unicorn
  // metabolism — say so rather than act on it
  if (formulaTdee > 0 && (raw < formulaTdee * 0.6 || raw > formulaTdee * 1.5)) confidence = "low";

  // lean on the formula while data is thin, fully on the measurement once there's plenty
  const w = Math.min(1, loggedDays / 21) * Math.min(1, weighIns / 12);
  const blended = formulaTdee > 0 ? w * raw + (1 - w) * formulaTdee : raw;
  return {
    tdee: Math.round(blended / 10) * 10,
    raw: Math.round(raw),
    confidence,
    loggedDays,
    weighIns,
    spanDays: Math.round(spanDays),
    kgPerWeek: Math.round(slopePerDay * 7 * 100) / 100,
    avgIntake: Math.round(avgIntake),
  };
}

/** Device-local start-of-day timestamp (ms since epoch), matching Calendar.current.startOfDay semantics. */
// ---------------------------------------------------------------------------
// Exercise
// ---------------------------------------------------------------------------

/**
 * Share of burned calories added back to the day's budget. Deliberately below 1.0: wearable and
 * formula burn estimates run high, and TDEE already includes some daily activity, so crediting
 * every burned calorie double-counts. The UI always shows the full burn AND the credited part.
 */
export const EXERCISE_CREDIT_RATIO = 0; // default: exercise is logged and shown, not eaten back
export const EXERCISE_CREDIT_CHOICES = [0, 0.25, 0.5];

/** Calories from exercise that count toward the day's budget (whole calories). */
export function exerciseCredit(caloriesBurned, ratio = EXERCISE_CREDIT_RATIO) {
  const n = Number(caloriesBurned);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * ratio);
}

/** MET values per activity at moderate intensity (compendium of physical activities, rounded). */
export const ACTIVITY_METS = Object.freeze({
  walk: 3.5, run: 9.8, soccer: 7.0, gym: 5.0, cycling: 7.5, swim: 7.0, other: 5.0,
});

export const INTENSITY_FACTORS = Object.freeze({ easy: 0.75, moderate: 1.0, hard: 1.3 });

export function normalizeActivity(raw) {
  const key = String(raw ?? "").toLowerCase();
  return Object.prototype.hasOwnProperty.call(ACTIVITY_METS, key) ? key : "other";
}

export function normalizeIntensity(raw) {
  const key = String(raw ?? "").toLowerCase();
  return Object.prototype.hasOwnProperty.call(INTENSITY_FACTORS, key) ? key : "moderate";
}

/**
 * kcal = MET x intensity x weightKg x hours. Falls back to 70 kg when the profile has no weight,
 * so the number is still roughly right rather than zero.
 */
export function estimateCaloriesBurned({ activity, minutes, intensity, weightKg }) {
  const mins = Number(minutes);
  if (!Number.isFinite(mins) || mins <= 0) return 0;
  const met = ACTIVITY_METS[normalizeActivity(activity)];
  const factor = INTENSITY_FACTORS[normalizeIntensity(intensity)];
  const kg = Number.isFinite(Number(weightKg)) && Number(weightKg) > 0 ? Number(weightKg) : 70;
  return Math.round(met * factor * kg * (mins / 60));
}

export function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Add (or subtract, if delta is negative) whole calendar days to a timestamp, DST-safe. */
export function addDays(timestamp, delta) {
  const d = new Date(timestamp);
  d.setDate(d.getDate() + delta);
  return d.getTime();
}

/**
 * "YYYY-MM-DD" for the device-local calendar day containing `timestamp` — for the sync layer's
 * `day` columns. Deliberately NOT `Date#toISOString().slice(0,10)`, which reads the UTC calendar
 * date and silently shifts by a day for any timezone offset outside UTC.
 */
export function localDateString(timestamp) {
  const d = new Date(timestamp);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Streak counter — verbatim port of NutritionMath.streak.
 * If today has no log yet, that does NOT zero the streak; counting simply starts from yesterday.
 * @param {Iterable<number>} loggedDayTimestamps start-of-day timestamps (ms) of every day with >=1 entry
 * @param {Date|number} today
 * @returns {number}
 */
export function computeStreak(loggedDayTimestamps, today = new Date()) {
  const logged = new Set(loggedDayTimestamps);
  const startOfToday = startOfDay(today);
  let cursor = logged.has(startOfToday) ? startOfToday : addDays(startOfToday, -1);
  let count = 0;
  while (logged.has(cursor)) {
    count += 1;
    cursor = addDays(cursor, -1);
  }
  return count;
}

/** Standard round-half-away-from-zero to the nearest whole number (display rule, §11 of spec). */
export function roundDisplay(value) {
  return value >= 0 ? Math.floor(value + 0.5) : -Math.floor(-value + 0.5);
}
