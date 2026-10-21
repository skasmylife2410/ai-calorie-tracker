// recomp.test.mjs — losing fat and building muscle at once: more protein, a small deficit, a
// check-in that allows for the muscle on the scale; and a check-in that counts a weigh-in made
// later the same day.
import test from "node:test";
import assert from "node:assert/strict";

class MemoryStorage {
  constructor() { this._d = new Map(); }
  getItem(k) { return this._d.has(k) ? this._d.get(k) : null; }
  setItem(k, v) { this._d.set(k, String(v)); }
  removeItem(k) { this._d.delete(k); }
  clear() { this._d.clear(); }
}
globalThis.localStorage = new MemoryStorage();

const store = await import("../js/store.js");
const {
  resolveUserGoals, targetDelta, monthlyReview, buildsMuscle, RECOMP_MAX_DEFICIT_KCAL, RECOMP_LEAN_KG_PER_WEEK,
} = await import("../js/nutrition.js");
const { goalChoiceOf, goalPatch, musclePatch } = await import("../js/ui/formfields.js");

const D = 86400000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// 31, 184 cm, 88 kg at 22% body fat, lifting most days
const LIFTER = { age: 31, sex: "male", heightCm: 184, weightKg: 88, bodyFatPct: 22, build: "muscular", activityLevel: "light", goal: "lose", goalRate: "slow", targetDeltaKcal: -340 };
const RECOMP = { ...LIFTER, buildMuscle: true };

test("building muscle too: protein 2.6 g per kg of lean mass (2.1 per kg without one), within 35% of calories", () => {
  const plain = resolveUserGoals(LIFTER, { learnedTdee: 2453 });
  const recomp = resolveUserGoals(RECOMP, { learnedTdee: 2453 });
  assert.equal(recomp.targetCalories, plain.targetCalories, "same calories");
  assert.equal(recomp.proteinTargetG, Math.round(88 * 0.78 * 2.6));
  assert.ok(recomp.proteinTargetG > plain.proteinTargetG + 20, `${plain.proteinTargetG} → ${recomp.proteinTargetG}`);
  assert.ok(recomp.proteinTargetG * 4 <= recomp.targetCalories * 0.35 + 2);
  assert.equal(recomp.fatTargetG, plain.fatTargetG, "carbs make room, fat stays");
  const noLean = resolveUserGoals({ ...RECOMP, bodyFatPct: null, build: null }, { learnedTdee: 2453 });
  assert.ok(noLean.proteinTargetG >= 170 && noLean.proteinTargetG <= 186, `by body weight: ${noLean.proteinTargetG}`);
});

test("building muscle too: the steady pace, never more than 500 kcal under", () => {
  assert.equal(targetDelta({ goal: "lose", rate: "fast", weightKg: 88, buildMuscle: true }), targetDelta({ goal: "lose", rate: "slow", weightKg: 88 }));
  assert.equal(targetDelta({ goal: "lose", rate: "slow", weightKg: 160, buildMuscle: true }), -RECOMP_MAX_DEFICIT_KCAL);
  assert.equal(targetDelta({ goal: "gain", rate: "normal", weightKg: 88, buildMuscle: true }), targetDelta({ goal: "gain", rate: "normal", weightKg: 88 }));
});

/** Weigh-ins every 2 days for 30 days along a line (kg/week), ±0.2 kg noise. */
const line = (now, startKg, kgPerWeek) => {
  const out = [];
  for (let d = 30; d >= 0; d -= 2) out.push({ t: now - d * D, kg: Math.round((startKg + ((30 - d) / 7) * kgPerWeek + (out.length % 2 ? 0.2 : -0.2)) * 10) / 10 });
  return out;
};

test("check-in: the scale may drop slower by the muscle gained, and steps never deepen the deficit past 500", () => {
  const now = Date.UTC(2026, 9, 21, 9);
  const weights = line(now, 88.6, -0.1);
  const plain = monthlyReview({ profile: LIFTER, weights, now });
  const recomp = monthlyReview({ profile: RECOMP, weights, now });
  assert.equal(plain.verdict, "slower");
  assert.equal(recomp.verdict, "onTrack", "−0.1 kg a week on the scale is on plan once up to 0.1 kg of muscle a week is allowed for");
  assert.equal(recomp.recomp, true);
  assert.equal(recomp.plannedKgPerWeek, Math.round(((-340 * 7) / 7700 + RECOMP_LEAN_KG_PER_WEEK) * 100) / 100);
  assert.equal(recomp.stepKcal, 0);

  const flat = monthlyReview({ profile: { ...RECOMP, targetDeltaKcal: -450 }, weights: line(now, 88, 0), now });
  assert.equal(flat.verdict, "slower", "a flat scale for a month is still slower, said plainly");
  assert.ok(flat.patch.targetDeltaKcal >= -RECOMP_MAX_DEFICIT_KCAL, `${flat.patch.targetDeltaKcal}`);
});

test("everyone can build muscle: the Build muscle goal always (unless they said no), losing fat or keeping weight when switched on", () => {
  assert.equal(buildsMuscle({ goal: "gain" }), true);
  assert.equal(buildsMuscle({ targetDeltaKcal: 300 }), true, "older profiles: a surplus is the Build muscle goal");
  assert.equal(buildsMuscle({ goal: "gain", buildMuscle: false }), false);
  assert.equal(buildsMuscle({ goal: "lose" }), false, "not unless they say so");
  assert.equal(buildsMuscle({ goal: "maintain", buildMuscle: true }), true);
  assert.equal(buildsMuscle({ targetDeltaKcal: -500, buildMuscle: true }), true);

  // in a surplus 2.3 g per kg of lean mass; keeping weight 2.6, like losing fat
  const gainer = { age: 25, sex: "male", heightCm: 178, weightKg: 75, build: "muscular", activityLevel: "moderate", goal: "gain", goalRate: "normal", targetDeltaKcal: 275 };
  assert.equal(resolveUserGoals(gainer).proteinTargetG, Math.round(75 * 0.85 * 2.3));
  assert.equal(resolveUserGoals({ ...gainer, buildMuscle: false }).proteinTargetG, Math.round(75 * 0.85 * 2.1), "just gaining weight: as before");
  const keeper = { ...LIFTER, goal: "maintain", targetDeltaKcal: 0 };
  assert.equal(resolveUserGoals({ ...keeper, buildMuscle: true }).proteinTargetG, Math.round(88 * 0.78 * 2.6));
  assert.equal(resolveUserGoals({ ...keeper, buildMuscle: true }).targetCalories, resolveUserGoals(keeper).targetCalories, "same calories");
});

test("keeping weight while building muscle: the check-in allows the scale to creep up by the muscle, not down", () => {
  const now = Date.UTC(2026, 9, 21, 9);
  const keeper = { ...LIFTER, goal: "maintain", goalRate: null, targetDeltaKcal: 0 };
  const creeping = line(now, 88, 0.22);
  assert.equal(monthlyReview({ profile: keeper, weights: creeping, now }).verdict, "driftUp");
  const r = monthlyReview({ profile: { ...keeper, buildMuscle: true }, weights: creeping, now });
  assert.equal(r.verdict, "onTrack");
  assert.equal(r.recomp, true);
  assert.equal(r.patch.targetDeltaKcal, 0);
  assert.equal(monthlyReview({ profile: { ...keeper, buildMuscle: true }, weights: line(now, 88, -0.25), now }).verdict, "driftDown");
  assert.equal(monthlyReview({ profile: { goal: "gain", goalRate: "normal", targetDeltaKcal: 275, weightKg: 75 }, weights: line(now, 75, 0.25), now }).recomp, false, "a surplus isn't a recomposition");
});

test("Profile's goal picker and switch: setup's goals and paces; building muscle while losing fat is the steady pace", () => {
  assert.equal(goalChoiceOf(RECOMP), "lose:slow");
  assert.equal(goalChoiceOf({ targetDeltaKcal: -500 }), "lose:normal", "older profiles: a calorie change only");
  assert.equal(goalChoiceOf({ targetDeltaKcal: 0 }), "maintain");
  assert.deepEqual(musclePatch(true, { ...LIFTER, goalRate: "fast" }), { goal: "lose", goalRate: "slow", buildMuscle: true, targetDeltaKcal: -340 });
  assert.deepEqual(musclePatch(true, { weightKg: 70, targetDeltaKcal: 0 }), { goal: "maintain", goalRate: null, buildMuscle: true, targetDeltaKcal: 0 });
  assert.equal(goalPatch("lose:fast", RECOMP).buildMuscle, false, "a faster pace turns it off");
  assert.equal(goalPatch("maintain", RECOMP).buildMuscle, true, "keeping weight keeps it");
  assert.equal(goalPatch("gain:normal", LIFTER).buildMuscle, true, "Build muscle always does");
  assert.equal(goalPatch("brunch", {}), null);
});

test("asked once: until there's an answer on the profile", async () => {
  const { needsMuscleAnswer } = await import("../js/ui/muscle-ask.js");
  assert.equal(needsMuscleAnswer(LIFTER), true);
  assert.equal(needsMuscleAnswer({ ...LIFTER, buildMuscle: false }), false);
  assert.equal(needsMuscleAnswer({ ...LIFTER, buildMuscle: true }), false);
  assert.equal(needsMuscleAnswer({ age: 30 }), false, "no numbers to show yet");
});

test("a weigh-in saved after the day's check-in is counted; once, that day only, and Undo still goes back to before", async () => {
  localStorage.clear();
  const t0 = Date.now();
  store.setProfile({ ...RECOMP, weightKg: 90.4, hasCompletedOnboarding: true });
  for (const w of line(t0 - 60000, 88.5, 0.05).slice(0, -1)) store.addWeightEntry({ kg: w.kg, timestamp: w.t });
  await sleep(5);

  const at = Date.now();
  const first = store.applyMonthlyReview(store.monthlyReviewNow({ now: at }), { now: at });
  assert.equal(store.recountMonthlyReview(Date.now()), null, "no new weigh-in, nothing to count");

  await sleep(5);
  store.addWeightEntry({ kg: 86.4, timestamp: Date.now() });
  const again = store.recountMonthlyReview(Date.now());
  assert.ok(again, "counted");
  assert.equal(again.at, at, "the check-in keeps its date");
  assert.ok(again.endKg < first.endKg, `${first.endKg} → ${again.endKg}`);
  assert.equal(store.getProfile().weightKg, again.endKg);
  assert.equal(store.getProfile().lastReviewAt, at, "the next one is still 30 days from the first");
  assert.deepEqual(again.from, first.from, "before is still before the check-in");
  assert.equal(again.recomp, true);
  assert.equal(store.recountMonthlyReview(Date.now()), null, "only once per weigh-in");

  assert.equal(store.undoMonthlyReview(), true);
  assert.equal(store.getProfile().weightKg, 90.4, "Undo goes back to before the check-in");
  assert.equal(store.recountMonthlyReview(Date.now()), null, "an undone check-in stays undone");

  store.setProfile({ lastReview: { ...again, undone: false, countedTo: at } });
  assert.equal(store.recountMonthlyReview(Date.now() + 2 * D), null, "a later day's weigh-in is the next check-in's");
});
