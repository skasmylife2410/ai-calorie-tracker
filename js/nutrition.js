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
/**
 * Older/other spellings map to the right level instead of silently falling back to sedentary.
 * The onboarding used to save "active", which isn't a key here — so the most active option
 * quietly produced the LOWEST multiplier. Anyone with that saved is corrected here.
 */
const ACTIVITY_ALIASES = Object.freeze({
  active: "veryActive",
  very_active: "veryActive",
  "very active": "veryActive",
  extra_active: "extraActive",
  athlete: "extraActive",
  none: "sedentary",
});

export function normalizeActivityLevel(raw) {
  if (Object.prototype.hasOwnProperty.call(ACTIVITY_MULTIPLIERS, raw)) return raw;
  return ACTIVITY_ALIASES[raw] ?? "sedentary";
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

// Safety limits for a weight-loss target (NIH/NHLBI): a deficit of at most 25% of maintenance,
// and never under 1,200 kcal for women or 1,500 kcal for men. Someone whose maintenance is
// already below that minimum gets their maintenance (losing on less needs professional care).
export const MAX_DEFICIT_SHARE = 0.25;
/** Which method worked out a set of goals. 1: protein as 30% of calories, no calorie limits.
 *  2: protein by weight and activity, safe calorie limits (this file). Goals saved under an
 *  older method are worked out again wherever they're read. */
export const GOALS_VERSION = 2;
export const MIN_KCAL = Object.freeze({ female: 1200, male: 1500 });

/** The calorie target with the safety limits applied. Gains and maintenance pass through. */
export function safeTargetCalories(tdeeValue, deltaKcal, sex) {
  const raw = targetCalories(tdeeValue, deltaKcal);
  if (!(Number(deltaKcal) < 0)) return raw;
  const minimum = Math.min(tdeeValue, MIN_KCAL[normalizeSex(sex)] ?? MIN_KCAL.female);
  return Math.max(raw, tdeeValue * (1 - MAX_DEFICIT_SHARE), minimum);
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
// Protein per kilo, by how active someone is and whether they're losing weight (a deficit is
// when muscle needs protecting most). In line with the ISSN position stand: 1.4–2.0 g/kg for
// active adults, more in a deficit with training; ~1.2 is enough for someone sedentary.
export const PROTEIN_G_PER_KG_BY_ACTIVITY = Object.freeze({
  sedentary: { maintain: 1.2, lose: 1.5 },
  light: { maintain: 1.4, lose: 1.7 },
  moderate: { maintain: 1.6, lose: 1.9 },
  veryActive: { maintain: 1.8, lose: 2.0 },
  extraActive: { maintain: 2.0, lose: 2.2 },
});
export const PROTEIN_G_PER_KG = 1.6;           // kept for older callers: the "moderate" maintain rate
export const PROTEIN_LEAN_EXTRA = 0.5;         // per kilo of lean mass it's a bit more than per kilo of body weight
export const PROTEIN_MAX_SHARE = 0.35;         // never more than 35% of the day's calories
export const PROTEIN_MIN_G_PER_KG = 0.8;       // and never under the basic daily requirement
export const FAT_SHARE = 0.3;
export const FAT_SHARE_MIN = 0.25;   // fat gives way to here on few calories, to keep carbs up
export const CARBS_MIN_G = 130;      // the daily carbohydrate minimum (RDA)

/**
 * The weight protein is worked out from. Up to BMI 25 it's the person's weight; above that the
 * usual "adjusted" weight (the BMI-25 weight plus 40% of the rest), since fat mass needs far less
 * protein than muscle, but a heavier person still carries some extra muscle.
 */
export function proteinReferenceKg(weightKg, heightCm) {
  const w = Number(weightKg);
  const h = Number(heightCm) / 100;
  if (!(w > 0) || !(h > 0)) return w > 0 ? w : 0;
  const ideal = 25 * h * h;
  return w <= ideal ? w : ideal + 0.4 * (w - ideal);
}

/** Daily protein in grams: per kilo by activity and goal, of the reference weight (or of lean
 *  mass when that's known); capped at 35% of calories, never under 0.8 g/kg. */
export function proteinTargetG({ weightKg, heightCm, leanKg = 0, deltaKcal = 0, activityLevel = "moderate", targetKcal = 2000 }) {
  const w = Number(weightKg);
  if (!(w > 0)) return Math.round((targetKcal * 0.25) / 4);
  const rates = PROTEIN_G_PER_KG_BY_ACTIVITY[normalizeActivityLevel(activityLevel)] ?? PROTEIN_G_PER_KG_BY_ACTIVITY.moderate;
  const perKg = Number(deltaKcal) < 0 ? rates.lose : rates.maintain;
  let g = leanKg > 0 ? leanKg * (perKg + PROTEIN_LEAN_EXTRA) : proteinReferenceKg(w, heightCm) * perKg;
  g = Math.min(g, (targetKcal * PROTEIN_MAX_SHARE) / 4);
  g = Math.max(g, w * PROTEIN_MIN_G_PER_KG);
  return Math.round(g);
}

// ---------------------------------------------------------------------------
// Build → body composition
// ---------------------------------------------------------------------------
//
// Why this matters: Mifflin-St Jeor only knows height, weight, age and sex, so it reads a
// muscular person as "heavy" and over- or under-shoots their real burn. Muscle burns more at
// rest than fat, so two people at the same weight can differ by hundreds of calories.
//
// When someone tells us their build (or their body fat %), we switch to Katch-McArdle, which
// works from lean mass instead of total weight, and set protein from lean mass too.

export const BUILDS = ["slim", "average", "muscular", "larger"];

/** Rough body-fat estimate by build and sex, used only when a real measurement isn't given. */
export function estimateBodyFatPct(build, sex) {
  const female = normalizeSex(sex) === "female";
  const table = female
    ? { slim: 22, average: 29, muscular: 23, larger: 37 }
    : { slim: 13, average: 20, muscular: 15, larger: 28 };
  return table[build] ?? (female ? 29 : 20);
}

/** Katch-McArdle: 370 + 21.6 × lean body mass (kg). More accurate when composition is known. */
export function katchMcArdleBMR(leanMassKg) {
  const lbm = Number(leanMassKg);
  if (!Number.isFinite(lbm) || lbm <= 0) return 0;
  return 370 + 21.6 * lbm;
}

/** Lean mass from weight and either a measured or estimated body fat percentage. */
export function leanMassKg({ weightKg, bodyFatPct, build, sex }) {
  const w = Number(weightKg);
  if (!Number.isFinite(w) || w <= 0) return 0;
  const pct = Number.isFinite(Number(bodyFatPct)) && Number(bodyFatPct) > 0 && Number(bodyFatPct) < 70
    ? Number(bodyFatPct)
    : build ? estimateBodyFatPct(build, sex) : null;
  if (pct === null) return 0;
  return w * (1 - pct / 100);
}

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

  // Lean-mass formula when build or body fat is known, the standard one otherwise.
  const lbm = leanMassKg({ weightKg, bodyFatPct: profile.bodyFatPct, build: profile.build, sex });
  const mifflin = mifflinStJeorBMR(weightKg, heightCm, age, normalizeSex(sex));
  const bmr = Math.round(lbm > 0 ? katchMcArdleBMR(lbm) : mifflin);
  const formulaTdee = tdee(bmr, activityLevel);
  // Maintenance: learned from the person's own intake and weight trend when there's enough data,
  // otherwise the formula. The learned number already includes their exercise and habits.
  const useLearned = Number.isFinite(learnedTdee) && learnedTdee > 0;
  const tdeeValue = useLearned ? learnedTdee : formulaTdee;
  const computedTargetCalories = Math.round(safeTargetCalories(tdeeValue, targetDeltaKcal, sex)); // whole calories
  // A calorie target typed in by hand is kept, but never below the safety minimum either.
  const safeMinimum = Math.round(Math.min(tdeeValue, MIN_KCAL[normalizeSex(sex)] ?? MIN_KCAL.female));
  const effectiveTargetCalories =
    customTargetKcal !== null && customTargetKcal !== undefined ? Math.max(Number(customTargetKcal), safeMinimum) : computedTargetCalories;
  const macros = macroTargets(effectiveTargetCalories);

  // Protein by body weight and goal (see proteinTargetG), fat at 30% of calories, and carbs get
  // what's left, so the three always add up to the calorie target.
  let proteinG = macros.proteinG;
  let carbsG = macros.carbsG;
  let fatG = (effectiveTargetCalories * FAT_SHARE) / 9;
  if (weightKg > 0) {
    proteinG = customProteinG !== null && customProteinG !== undefined
      ? Number(customProteinG)
      : proteinTargetG({ weightKg, heightCm, leanKg: lbm, deltaKcal: targetDeltaKcal, activityLevel, targetKcal: effectiveTargetCalories });
    carbsG = Math.max(0, (effectiveTargetCalories - proteinG * 4 - fatG * 9) / 4);
    if (carbsG < CARBS_MIN_G && (customFatG === null || customFatG === undefined)) {
      // on few calories, fat comes down from 30% toward 25% to keep carbs near the daily minimum
      const fatFloorG = (effectiveTargetCalories * FAT_SHARE_MIN) / 9;
      fatG = Math.max(fatFloorG, fatG - ((CARBS_MIN_G - carbsG) * 4) / 9);
      carbsG = Math.max(0, (effectiveTargetCalories - proteinG * 4 - fatG * 9) / 4);
    }
  }

  return {
    bmr,
    leanMassKg: lbm > 0 ? Math.round(lbm * 10) / 10 : null,
    bmrSource: lbm > 0 ? "lean-mass" : "standard",
    tdee: tdeeValue,
    formulaTdee,
    tdeeSource: useLearned ? "learned" : "formula",
    computedTargetCalories,
    targetCalories: effectiveTargetCalories,
    // computed grams are rounded; a value the person set themselves is left exactly as they set it
    proteinTargetG: customProteinG !== null && customProteinG !== undefined ? customProteinG : Math.round(proteinG),
    carbsTargetG: customCarbsG !== null && customCarbsG !== undefined ? customCarbsG : Math.round(carbsG),
    fatTargetG: customFatG !== null && customFatG !== undefined ? customFatG : Math.round(fatG),
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

/** Weekly change each pace aims for, as a share of body weight. */
export const GOAL_RATE_PCT = Object.freeze({ slow: 0.0035, normal: 0.006, fast: 0.009 });

/** Daily calorie change for a goal and pace: a deficit to lose, a small surplus to gain. */
export function targetDelta({ goal, rate, weightKg }) {
  if (goal === "maintain") return 0;
  const pctPerWeek = GOAL_RATE_PCT[rate] ?? GOAL_RATE_PCT.normal;
  const kgPerWeek = weightKg * pctPerWeek;
  const perDay = Math.round((kgPerWeek * 7700) / 7 / 10) * 10;
  // Gaining muscle needs a much smaller surplus than a fat-loss deficit, or it's mostly fat
  return goal === "gain" ? Math.min(400, Math.round(perDay * 0.55)) : -perDay;
}

// ---------------------------------------------------------------------------
// Monthly review
// ---------------------------------------------------------------------------

export const REVIEW_EVERY_DAYS = 30;
/** Most a single review moves the daily calorie target on its own (beyond the new weight). */
export const REVIEW_MAX_STEP_KCAL = 150;
/** Within this many kg of the goal weight, a fast pace eases to normal so the last kilos stick. */
export const REVIEW_NEAR_GOAL_KG = 2;

/**
 * The 30-day check: what the scale did, compared with what the goal planned, and the new
 * targets that follow. Pure: the caller applies `patch` to the profile.
 *
 * Adjusts three things, in this order:
 *   1. Weight: the profile's weight becomes the trend weight (not one morning's reading), so
 *      maintenance, protein and the size of the deficit follow the body as it changes.
 *   2. Goal weight: reached → the goal becomes "maintain"; close → a fast pace eases to normal.
 *   3. Pace: when the scale moved slower or faster than planned and the learned maintenance
 *      isn't already correcting for it, the daily target moves by at most 150 kcal toward the
 *      plan. The learned maintenance does this job by itself once it's in use, so it isn't
 *      done twice. The safety limits in resolveUserGoals still apply to whatever comes out.
 *
 * @param {{profile:object, weights:Array<{t:number, kg:number}>, now?:number, learnedOn?:boolean}} input
 *   weights: the readings of the last 30 days
 * @returns {{status:"needWeighIns", weighIns:number} | {status:"ready", verdict:string, startKg:number,
 *   endKg:number, changeKg:number, kgPerWeek:number, plannedKgPerWeek:number, goal:string,
 *   goalKg:number|null, reached:boolean, eased:boolean, stepKcal:number, weeksToGoal:number|null,
 *   patch:object}}
 */
export function monthlyReview({ profile = {}, weights = [], now = Date.now(), learnedOn = false }) {
  const sorted = [...weights].filter((w) => Number(w?.kg) > 0).sort((a, b) => a.t - b.t);
  const spanDays = sorted.length ? (sorted[sorted.length - 1].t - sorted[0].t) / 86400000 : 0;
  if (sorted.length < 4 || spanDays < 14) return { status: "needWeighIns", weighIns: sorted.length };

  // least-squares line through the readings: one salty dinner doesn't decide the month
  const t0 = sorted[0].t;
  const xs = sorted.map((w) => (w.t - t0) / 86400000);
  const ys = sorted.map((w) => w.kg);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0, den = 0;
  for (let i = 0; i < xs.length; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
  const slope = den > 0 ? num / den : 0;
  const startKg = my + slope * (0 - mx);
  const endKg = my + slope * (xs[xs.length - 1] - mx);
  const kgPerWeek = slope * 7;

  const delta = Number(profile.targetDeltaKcal) || 0;
  const goal = ["lose", "gain", "maintain"].includes(profile.goal) ? profile.goal : delta < 0 ? "lose" : delta > 0 ? "gain" : "maintain";
  const plannedKgPerWeek = (delta * 7) / KCAL_PER_KG;
  const oldKg = Number(profile.weightKg) > 0 ? Number(profile.weightKg) : endKg;
  const newKg = Math.round(endKg * 10) / 10;

  // how far off plan, with room for normal noise (water, salt, a hard training week)
  const tol = Math.max(0.15, Math.abs(plannedKgPerWeek) * 0.35);
  const diff = kgPerWeek - plannedKgPerWeek; // + = heavier than planned
  let verdict = "onTrack";
  if (goal === "lose") {
    if (diff > tol) verdict = kgPerWeek >= 0.1 ? "gaining" : "slower";
    else if (diff < -tol) verdict = "faster";
  } else if (goal === "gain") {
    if (diff < -tol) verdict = kgPerWeek <= -0.1 ? "losing" : "slower";
    else if (diff > tol) verdict = "faster";
  } else if (Math.abs(kgPerWeek) > 0.15) {
    verdict = kgPerWeek > 0 ? "driftUp" : "driftDown";
  }

  // 2. the goal weight, when there is one that lies the way the goal points
  const goalKg = Number(profile.goalWeightKg) > 0 ? Number(profile.goalWeightKg) : null;
  const pointsRight = goalKg !== null && ((goal === "lose" && goalKg < oldKg + 0.5) || (goal === "gain" && goalKg > oldKg - 0.5));
  const reached = pointsRight && (goal === "lose" ? newKg <= goalKg + 0.3 : newKg >= goalKg - 0.3);
  const patch = { weightKg: newKg };
  let eased = false;
  let stepKcal = 0;
  if (reached) {
    patch.goal = "maintain";
    patch.targetDeltaKcal = 0;
  } else {
    let rate = profile.goalRate;
    if (pointsRight && rate === "fast" && Math.abs(goalKg - newKg) <= REVIEW_NEAR_GOAL_KG) { rate = "normal"; eased = true; patch.goalRate = rate; }
    // the deficit or surplus is a share of body weight, so it follows the new weight
    let nextDelta = rate && goal !== "maintain"
      ? targetDelta({ goal, rate, weightKg: newKg })
      : Math.round((delta * (newKg / oldKg)) / 10) * 10;
    // 3. off plan and nothing else is correcting it: a small step toward the plan
    if (!learnedOn && verdict !== "onTrack") {
      const want = -diff * (KCAL_PER_KG / 7); // eat this much less (−) or more (+) per day
      stepKcal = Math.round(Math.max(-REVIEW_MAX_STEP_KCAL, Math.min(REVIEW_MAX_STEP_KCAL, want)) / 10) * 10;
      nextDelta += stepKcal;
    }
    if (goal === "gain") nextDelta = Math.max(0, Math.min(500, nextDelta));
    if (goal === "lose") nextDelta = Math.min(0, nextDelta);
    patch.targetDeltaKcal = nextDelta;
  }

  // at the planned pace from here, roughly how long until the goal weight
  const pace = Math.abs((Number(patch.targetDeltaKcal) * 7) / KCAL_PER_KG);
  const weeksToGoal = pointsRight && !reached && pace > 0.05 ? Math.ceil(Math.abs(goalKg - newKg) / pace) : null;

  return {
    status: "ready",
    verdict,
    startKg: Math.round(startKg * 10) / 10,
    endKg: newKg,
    changeKg: Math.round((endKg - startKg) * 10) / 10,
    kgPerWeek: Math.round(kgPerWeek * 100) / 100,
    plannedKgPerWeek: Math.round(plannedKgPerWeek * 100) / 100,
    goal,
    goalKg,
    reached,
    eased,
    stepKcal,
    weeksToGoal,
    patch,
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
// How much of a workout's estimated burn is added to the day's budget. Never all of it: estimates
// (ours, apps', watches') run high, and people tend to move less for the rest of a day they
// trained. 40% at most; Profile offers none, 25% or 40%, and "Auto" (below) is the default.
export const EXERCISE_CREDIT_RATIO = 0.25;
export const EXERCISE_CREDIT_CHOICES = [0, 0.25, 0.4];
export const EXERCISE_CREDIT_MAX = 0.4;

/**
 * "Auto": how much depends on the activity level the target was built with. A sedentary target
 * (x1.2) assumes no exercise, so a workout gets the most; the active levels' multipliers already
 * include regular training, so they get less, and very active none (it would count twice).
 */
export const AUTO_CREDIT_BY_ACTIVITY = Object.freeze({ sedentary: 0.4, light: 0.3, moderate: 0.25, veryActive: 0 });
export function autoCreditRatio(activityLevel) {
  return AUTO_CREDIT_BY_ACTIVITY[normalizeActivityLevel(activityLevel)] ?? EXERCISE_CREDIT_RATIO;
}

/** The share of exercise added to the budget for a profile: its own choice, else Auto. */
export const LEARNED_AUTO_CREDIT = 0.1;
export function creditRatioFor(profile) {
  const raw = profile?.exerciseCreditPct;
  if (raw === undefined || raw === null || raw === "" || raw === "auto") {
    // A maintenance learned from real intake and weight already includes the workouts this
    // person usually does; only a little more is added for each one logged.
    const auto = autoCreditRatio(profile?.activityLevel);
    return profile?.learnedTdeeOn === true ? Math.min(auto, LEARNED_AUTO_CREDIT) : auto;
  }
  const pct = Number(raw);
  if (pct === 50 || pct === 100) return EXERCISE_CREDIT_MAX; // older choices, now capped
  const r = pct / 100;
  return EXERCISE_CREDIT_CHOICES.includes(r) ? r : 0;
}

/** Calories from exercise that count toward the day's budget (whole calories). */
export function exerciseCredit(caloriesBurned, ratio = EXERCISE_CREDIT_RATIO) {
  const n = Number(caloriesBurned);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * ratio);
}

/**
 * MET values per activity at moderate intensity (Compendium of Physical Activities, rounded).
 * Picked for an everyday session, not a hard one: a jog rather than a 6-mph run, weights with
 * rests between sets, leisure cycling and swimming. "hard" in the sheet scales them up.
 */
export const ACTIVITY_METS = Object.freeze({
  walk: 3.5, run: 8.3, soccer: 7.0, gym: 3.5, cycling: 6.8, swim: 6.0, other: 4.0,
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
/** Activities where you carry your whole body, so the cost rises in step with your weight. */
const WEIGHT_BEARING = new Set(["walk", "run", "soccer"]);

/**
 * Calories a session burns on top of what the body burns anyway, for this person.
 *
 * - Activity cost: MET x intensity x body mass (1 MET ~ 1 kcal per kg per hour). Walking, running
 *   and soccer move your whole weight, so they scale with it fully; cycling, swimming and the gym
 *   much less (the bike and the water carry you, weights load the arms), so they use a damped
 *   mass, 70 kg x (kg / 70)^0.5.
 * - Minus this person's own resting burn for that time (Mifflin-St Jeor / 24 per hour) rather
 *   than the textbook 1 kcal/kg/h, which is too high for people with more body fat and would cut
 *   their real extra burn short. The daily target already counts the resting part.
 * Falls back to 70 kg and 1 kcal/kg/h when weight, height or age aren't known.
 */
export function estimateCaloriesBurned({ activity, minutes, intensity, weightKg, heightCm, age, sex }) {
  const mins = Number(minutes);
  if (!Number.isFinite(mins) || mins <= 0) return 0;
  const kind = normalizeActivity(activity);
  const met = ACTIVITY_METS[kind] * INTENSITY_FACTORS[normalizeIntensity(intensity)];
  const kg = Number(weightKg) > 0 ? Number(weightKg) : 70;
  const mass = WEIGHT_BEARING.has(kind) ? kg : 70 * Math.sqrt(kg / 70);
  const h = Number(heightCm), a = Number(age);
  const restingPerHour = h > 0 && a > 0 ? mifflinStJeorBMR(kg, h, a, normalizeSex(sex)) / 24 : kg;
  const net = Math.max(0, met * mass - restingPerHour);
  return Math.round(net * (mins / 60));
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

// ---------------------------------------------------------------------------
// Nutrients beyond the macros: fiber, sugars, saturated fat, sodium, potassium.
//
// Stored as an optional `micros` object on products, meal items and entries. Every value is a
// number or null — null means "we don't know", which is different from zero. Old entries have no
// `micros` at all, and the Today card counts them as missing rather than treating them as 0.
// ---------------------------------------------------------------------------

export const MICRO_KEYS = ["fiberG", "sugarG", "addedSugarG", "satFatG", "sodiumMg", "potassiumMg"];

const isMg = (key) => key.endsWith("Mg");
const roundMicro = (key, v) => (isMg(key) ? Math.round(v) : Math.round(v * 10) / 10);

/** Keeps only known, non-negative numbers. Returns null when nothing is known. */
export function cleanMicros(raw) {
  if (!raw || typeof raw !== "object") return null;
  const out = {};
  let any = false;
  for (const k of MICRO_KEYS) {
    const v = raw[k];
    if (v === null || v === undefined || v === "") { out[k] = null; continue; }
    const n = Number(v);
    if (Number.isFinite(n) && n >= 0) { out[k] = n; any = true; } else out[k] = null;
  }
  // added sugar can't be more than total sugar
  if (out.addedSugarG !== null && out.sugarG !== null && out.addedSugarG > out.sugarG) out.addedSugarG = out.sugarG;
  return any ? out : null;
}

/** Multiplies every known value by `factor`; unknowns stay unknown. */
export function scaleMicros(micros, factor) {
  const m = cleanMicros(micros);
  if (!m || !Number.isFinite(factor)) return null;
  const out = {};
  for (const k of MICRO_KEYS) out[k] = m[k] === null ? null : roundMicro(k, m[k] * factor);
  return out;
}

/** Adds up a list of micros objects. A nutrient is known if ANY input knows it. */
export function sumMicros(list) {
  const out = {};
  let any = false;
  for (const k of MICRO_KEYS) out[k] = null;
  for (const raw of list ?? []) {
    const m = cleanMicros(raw);
    if (!m) continue;
    for (const k of MICRO_KEYS) {
      if (m[k] === null) continue;
      out[k] = (out[k] ?? 0) + m[k];
      any = true;
    }
  }
  if (!any) return null;
  for (const k of MICRO_KEYS) if (out[k] !== null) out[k] = roundMicro(k, out[k]);
  return out;
}

/**
 * Daily reference values, as limits (stay under) or goals (try to reach).
 * Sodium 2,300 mg and added sugar 50 g are the US Daily Values; saturated fat under 10% of
 * calories; fiber 14 g per 1,000 kcal; potassium 3,400 mg (men) / 2,600 mg (women).
 */
export function microTargets({ targetCalories = 2000, sex = "male" } = {}) {
  const kcal = Number(targetCalories) > 0 ? Number(targetCalories) : 2000;
  return {
    sodiumMg: { kind: "limit", value: 2300 },
    addedSugarG: { kind: "limit", value: 50 },
    satFatG: { kind: "limit", value: Math.round((kcal * 0.1) / 9) },
    fiberG: { kind: "goal", value: Math.round((kcal / 1000) * 14) },
    potassiumMg: { kind: "goal", value: normalizeSex(sex) === "female" ? 2600 : 3400 },
  };
}


/**
 * Days that count toward an average of what someone eats: something was logged, the day is over
 * (today isn't), and it isn't so far under the goal that meals were clearly left unlogged. Without
 * this, a day with only breakfast logged dragged a person's average down as if they'd barely eaten.
 */
export const PARTIAL_DAY_SHARE = 0.5;
export function countsForAverage(day, { goal = 0, isToday = false } = {}) {
  if (!day || !(day.meals > 0) || isToday) return false;
  return !(goal > 0 && day.calories < goal * PARTIAL_DAY_SHARE);
}

/** The days to average: the full ones, or every logged day when there are no full ones yet. */
export function daysForAverage(days, { goal = 0, todayKey = null } = {}) {
  const logged = days.filter((d) => d && d.meals > 0);
  const full = logged.filter((d) => countsForAverage(d, { goal, isToday: d.key === todayKey }));
  return { days: full.length ? full : logged, full: full.length, skipped: logged.length - full.length };
}


/**
 * The goals to show for someone on the server (the Us board, the Friday check-in): the ones their
 * phone reported when they were worked out by the current method, otherwise worked out again here
 * from their profile, so nobody is left on an older method's numbers.
 */
export function boardGoals(profileData) {
  if (!profileData || typeof profileData !== "object") return null;
  const a = profileData.appliedGoals;
  if (profileData.appliedGoalsV === GOALS_VERSION && a && typeof a === "object") {
    const picked = { calories: a.calories, proteinG: a.proteinG, carbsG: a.carbsG, fatG: a.fatG };
    if (Object.values(picked).every((n) => typeof n === "number" && Number.isFinite(n) && n > 0 && n < 20000)) {
      return Object.fromEntries(Object.entries(picked).map(([k, v]) => [k, Math.round(v)]));
    }
  }
  try {
    const g = resolveUserGoals(profileData);
    const out = { calories: Math.round(g.targetCalories), proteinG: Math.round(g.proteinTargetG), carbsG: Math.round(g.carbsTargetG), fatG: Math.round(g.fatTargetG) };
    return Object.values(out).every((n) => Number.isFinite(n) && n > 0) ? out : null;
  } catch {
    return null;
  }
}
