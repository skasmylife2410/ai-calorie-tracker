// maintenance-steady.test.mjs — measured maintenance only moves at the 30-day check-in, and when
// it does it's steady: weekly averages instead of single mornings, the first week of a diet
// (water) left out, and at most 150 kcal per check-in. Uses the readings that once sent one
// person's maintenance to 2,900 kcal.
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
const { learnedMaintenance } = await import("../js/nutrition.js");

const DAY = 86400000;

test("one odd morning moves the weekly-average trend far less than it used to", () => {
  const t0 = Date.UTC(2026, 0, 1, 11);
  const days = Array.from({ length: 28 }, () => ({ calories: 2000 }));
  const weights = Array.from({ length: 28 }, (_, i) => ({ t: t0 + i * DAY, kg: 85 - (0.4 / 7) * i }));
  const steady = learnedMaintenance({ days, weights, formulaTdee: 2400 });
  const salty = learnedMaintenance({ days, weights: [...weights.slice(0, -1), { ...weights[27], kg: weights[27].kg + 1.2 }], formulaTdee: 2400 });
  assert.ok(Math.abs(steady.raw - 2440) < 30, `0.4 kg/week at 2,000 ≈ 2,440 (got ${steady.raw})`);
  assert.ok(Math.abs(salty.raw - steady.raw) < 120, `a +1.2 kg morning moved it ${salty.raw - steady.raw}`);
});

test("two and a half weeks of weigh-ins aren't trusted for the targets", () => {
  const t0 = Date.UTC(2026, 0, 1, 11);
  const days = Array.from({ length: 21 }, () => ({ calories: 2100 }));
  const weights = Array.from({ length: 9 }, (_, i) => ({ t: t0 + i * 2 * DAY, kg: 90 - 0.1 * i }));
  assert.equal(learnedMaintenance({ days, weights, formulaTdee: 2600 }).confidence, "low");
});

// the real case: first weigh-in Sep 21, 2,100 kcal a day, 89.7 → 88.3 → 89.2
const READINGS = [["09-21", 89.7], ["09-22", 90.4], ["09-23", 89.9], ["09-24", 88.5], ["09-25", 88.8], ["09-28", 87.9], ["09-29", 88.3], ["09-30", 88.2], ["10-02", 88.5], ["10-05", 88.9], ["10-06", 88.3], ["10-08", 89.2]];
const INTAKE = [2836, 1470, 3255, 2371, 2262, 1854, 1942, 2157, 2014, 2188, 2292, 1582, 1802, 2097, 1848, 2049, 1851, 1856, 2038, 2161, 2163];
const PROFILE = { age: 31, sex: "male", goal: "lose", goalRate: "slow", heightCm: 184, weightKg: 90.4, bodyFatPct: 22, build: "muscular", activityLevel: "light", targetDeltaKcal: -350, hasCompletedOnboarding: true, customTargetKcal: null };
const at = (md, h = 11) => new Date(`2026-${md}T${String(h).padStart(2, "0")}:00:00`).getTime();

function seed() {
  localStorage.clear();
  store.setProfile({ ...PROFILE });
  READINGS.forEach(([md, kg]) => store.addWeightEntry({ kg, timestamp: at(md, 6) }));
  INTAKE.forEach((kcal, i) => store.addFoodEntry({ name: "Day", calories: kcal, timestamp: at("09-17") + i * DAY }));
}

test("that person's logs on Oct 8: not enough after the water week, so the formula stays (2,253)", () => {
  seed();
  const m = store.learnedMaintenanceNow({ now: at("10-08", 15) });
  assert.ok(!m || m.confidence === "low", "first week left out: too little to trust");
  assert.equal(store.lockMaintenanceNow({ now: at("10-08", 15) }), null);
  assert.equal(Math.round(store.computeGoals().targetCalories), 2253);
});

test("the water week is left out of the check-in, and the maintenance step is capped", () => {
  seed();
  // three more weeks at about the same intake, weight easing down slowly
  for (let i = 0; i < 13; i++) store.addFoodEntry({ name: "Day", calories: 2100, timestamp: at("10-08") + i * DAY });
  [["10-10", 88.9], ["10-12", 88.7], ["10-14", 88.8], ["10-16", 88.5], ["10-18", 88.4], ["10-20", 88.3]].forEach(([md, kg]) => store.addWeightEntry({ kg, timestamp: at(md, 6) }));
  const review = store.monthlyReviewNow({ now: at("10-21", 9) });
  assert.equal(review.status, "ready");
  assert.ok(review.startKg < 89.5, `the trend starts after the water week (got ${review.startKg})`);
  if (review.maintenanceTo) {
    assert.ok(Math.abs(review.maintenanceTo - review.maintenanceFrom) <= 150, `moved ${review.maintenanceTo - review.maintenanceFrom}`);
    assert.equal(review.maintenanceFrom, 2603, "from the formula");
  }
});
