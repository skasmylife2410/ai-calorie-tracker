// core.test.mjs — self-check covering nutrition math (against SPEC-LOGIC.md's verified test
// values), GTIN normalization, and store date filtering (with a mock localStorage).
// Run with: node --test web/tests/

import test from "node:test";
import assert from "node:assert/strict";

import {
  mifflinStJeorBMR,
  tdee,
  targetCalories,
  macroTargets,
  resolveUserGoals,
  computeStreak,
  startOfDay,
  addDays,
} from "../js/nutrition.js";

import { normalizedDigits, parseBasis } from "../js/api.js";
import { computeTargetSize } from "../js/resize.js";

function closeTo(actual, expected, epsilon = 0.001, message) {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    message ?? `expected ${actual} to be within ${epsilon} of ${expected}`
  );
}

// ---------------------------------------------------------------------------
// NutritionMath
// ---------------------------------------------------------------------------

test("mifflinStJeorBMR — male 80kg/180cm/30y -> 1780", () => {
  assert.equal(mifflinStJeorBMR(80, 180, 30, "male"), 1780);
});

test("mifflinStJeorBMR — female 65kg/165cm/28y -> 1380.25", () => {
  assert.equal(mifflinStJeorBMR(65, 165, 28, "female"), 1380.25);
});

test("tdee — BMR=1500 across all activity levels", () => {
  assert.equal(tdee(1500, "sedentary"), 1800);
  assert.equal(tdee(1500, "light"), 2062.5);
  assert.equal(tdee(1500, "moderate"), 2325);
  assert.equal(tdee(1500, "veryActive"), 2587.5);
  assert.equal(tdee(1500, "extraActive"), 2850);
});

test("targetCalories — TDEE 2500 across deltas", () => {
  assert.equal(targetCalories(2500, -500), 2000);
  assert.equal(targetCalories(2500, -250), 2250);
  assert.equal(targetCalories(2500, 0), 2500);
  assert.equal(targetCalories(2500, 250), 2750);
  assert.equal(targetCalories(2500, 500), 3000);
});

test("end-to-end — male 80/180/30, moderate, -500 -> BMR 1780, TDEE 2759, target 2259", () => {
  const bmr = mifflinStJeorBMR(80, 180, 30, "male");
  assert.equal(bmr, 1780);
  const t = tdee(bmr, "moderate");
  assert.equal(t, 2759);
  assert.equal(targetCalories(t, -500), 2259);
});

test("macroTargets(2000) -> protein 150, carbs 200, fat ~66.6667", () => {
  const m = macroTargets(2000);
  assert.equal(m.proteinG, 150);
  assert.equal(m.carbsG, 200);
  closeTo(m.fatG, 66.6667, 0.0001);
});

test("macroTargets(2500) -> protein 187.5, carbs 250, fat ~83.3333", () => {
  const m = macroTargets(2500);
  assert.equal(m.proteinG, 187.5);
  assert.equal(m.carbsG, 250);
  closeTo(m.fatG, 83.3333, 0.0001);
});

test("macro grams reconstruct calories within 0.0001", () => {
  for (const target of [2000, 2259, 2500, 3100]) {
    const m = macroTargets(target);
    const reconstructed = m.proteinG * 4 + m.carbsG * 4 + m.fatG * 9;
    closeTo(reconstructed, target, 0.0001);
  }
});

test("resolveUserGoals — custom-first resolution", () => {
  const base = {
    weightKg: 80,
    heightCm: 180,
    age: 30,
    sex: "male",
    activityLevel: "moderate",
    targetDeltaKcal: -500,
  };

  const noOverride = resolveUserGoals(base);
  assert.equal(noOverride.computedTargetCalories, 2259);
  assert.equal(noOverride.targetCalories, 2259);
  assert.equal(noOverride.hasValidStats, true);

  const withOverride = resolveUserGoals({ ...base, customTargetKcal: 1800 });
  assert.equal(withOverride.computedTargetCalories, 2259); // unaffected by override
  assert.equal(withOverride.targetCalories, 1800); // effective target wins

  // computed macro targets are whole grams (nobody weighs 225.9 g of protein)
  const macrosFromOverride = macroTargets(1800);
  assert.equal(withOverride.proteinTargetG, Math.round(macrosFromOverride.proteinG));

  const clearedOverride = resolveUserGoals({ ...base, customTargetKcal: null });
  assert.equal(clearedOverride.targetCalories, 2259); // reverts to computed

  const perMacroOverride = resolveUserGoals({ ...base, customProteinG: 220 });
  assert.equal(perMacroOverride.proteinTargetG, 220); // overridden macro
  const expectedCarbs = Math.round(macroTargets(2259).carbsG);
  closeTo(perMacroOverride.carbsTargetG, expectedCarbs, 0.0001); // non-overridden macro still derives from effective kcal (whole grams)

  assert.equal(resolveUserGoals({ ...base, weightKg: 0 }).hasValidStats, false);
  assert.equal(resolveUserGoals({ ...base, heightCm: 0 }).hasValidStats, false);
  assert.equal(resolveUserGoals({ ...base, age: 0 }).hasValidStats, false);
});

// ---------------------------------------------------------------------------
// Streak edge cases
// ---------------------------------------------------------------------------

test("streak — edge cases", () => {
  const today = new Date(2026, 0, 15); // Jan 15 2026 (arbitrary fixed reference)
  const day = (offset) => startOfDay(addDays(startOfDay(today), offset));

  assert.equal(computeStreak([], today), 0, "empty logs -> 0");
  assert.equal(computeStreak([day(0)], today), 1, "only-today -> 1");
  assert.equal(computeStreak([day(0), day(-1)], today), 2, "today+yesterday -> 2");
  assert.equal(computeStreak([day(0), day(-2)], today), 1, "gap (today + 2-days-ago) -> 1");
  assert.equal(computeStreak([day(-1), day(-2)], today), 2, "no-log-today, yesterday+day-before -> 2");
  assert.equal(computeStreak([day(-2)], today), 0, "no-log-today-or-yesterday -> 0");

  const sevenDayRun = Array.from({ length: 7 }, (_, i) => day(-i));
  assert.equal(computeStreak(sevenDayRun, today), 7, "unbroken 7-day run -> 7");
});

// ---------------------------------------------------------------------------
// GTIN normalization + OFF basis-selection (parseBasis)
// ---------------------------------------------------------------------------

test("normalizedDigits — leading-zero-tolerant GTIN comparison", () => {
  assert.equal(normalizedDigits("016000275287"), normalizedDigits("00016000275287"));
  assert.equal(normalizedDigits("016000275287"), "16000275287");
  assert.equal(normalizedDigits("00016000275287"), "16000275287");
  assert.equal(normalizedDigits(""), "");
  assert.equal(normalizedDigits("0000"), "");
  assert.equal(normalizedDigits("abc-123-def"), "123");
});

test("parseBasis — kJ to kcal conversion divisor is exactly 4.184", () => {
  const basis = parseBasis(
    { "energy-kj_100g": 1046, proteins_100g: 10, carbohydrates_100g: 20, fat_100g: 5 },
    null
  );
  assert.equal(basis.calories, 250);
  assert.equal(basis.servingDescription, "per 100 g");
});

test("parseBasis — missing any of the 4 core per-100g macros -> null (incomplete)", () => {
  const basis = parseBasis({ "energy-kcal_100g": 250, proteins_100g: 10, fat_100g: 5 }, null);
  assert.equal(basis, null);
});

test("parseBasis — partial per-serving data falls back to per-100g", () => {
  const basis = parseBasis(
    {
      "energy-kcal_100g": 250,
      proteins_100g: 10,
      carbohydrates_100g: 20,
      fat_100g: 5,
      "energy-kcal_serving": 125, // only ONE of the 4 serving fields present
    },
    "50 g"
  );
  assert.equal(basis.servingDescription, "per 100 g");
  assert.equal(basis.calories, 250);
});

test("parseBasis — complete per-serving data wins over per-100g", () => {
  const basis = parseBasis(
    {
      "energy-kcal_100g": 250,
      proteins_100g: 10,
      carbohydrates_100g: 20,
      fat_100g: 5,
      "energy-kcal_serving": 125,
      proteins_serving: 5,
      carbohydrates_serving: 10,
      fat_serving: 2.5,
    },
    "50 g"
  );
  assert.equal(basis.servingDescription, "per serving (50 g)");
  assert.equal(basis.calories, 125);
});

// ---------------------------------------------------------------------------
// resize.js — pure target-size math (verified spec cases)
// ---------------------------------------------------------------------------

test("computeTargetSize — verified cases, never upscales", () => {
  assert.deepEqual(computeTargetSize(1500, 1000), { width: 768, height: 512 });
  assert.deepEqual(computeTargetSize(1000, 1500), { width: 512, height: 768 });
  assert.deepEqual(computeTargetSize(2000, 2000), { width: 768, height: 768 });
  assert.deepEqual(computeTargetSize(400, 300), { width: 400, height: 300 });
  assert.deepEqual(computeTargetSize(768, 768), { width: 768, height: 768 });
  const iphone = computeTargetSize(4032, 3024);
  assert.equal(iphone.width, 768);
  closeTo(iphone.height, 576, 0.001);
});

// ---------------------------------------------------------------------------
// store.js — localStorage data layer with a mock localStorage
// ---------------------------------------------------------------------------

class MemoryStorage {
  constructor() {
    this._data = new Map();
  }
  getItem(key) {
    return this._data.has(key) ? this._data.get(key) : null;
  }
  setItem(key, value) {
    this._data.set(key, String(value));
  }
  removeItem(key) {
    this._data.delete(key);
  }
  clear() {
    this._data.clear();
  }
}

globalThis.localStorage = new MemoryStorage();
const store = await import("../js/store.js");

test("store — entriesForDay / totalsForDay filter by device-local calendar day", () => {
  globalThis.localStorage.clear();

  const day1 = new Date(2026, 5, 10, 9, 0, 0); // Jun 10 2026, 09:00 local
  const day1Late = new Date(2026, 5, 10, 23, 58, 0); // same day, 23:58
  const day2Early = new Date(2026, 5, 11, 0, 2, 0); // next day, 00:02

  store.addFoodEntry({ name: "Breakfast", calories: 300, timestamp: day1.getTime() });
  store.addFoodEntry({ name: "Late snack", calories: 100, timestamp: day1Late.getTime() });
  store.addFoodEntry({ name: "Midnight snack", calories: 50, timestamp: day2Early.getTime() });

  const day1Entries = store.entriesForDay(day1);
  assert.equal(day1Entries.length, 2);
  assert.deepEqual(
    day1Entries.map((e) => e.name).sort(),
    ["Breakfast", "Late snack"]
  );

  const day2Entries = store.entriesForDay(day2Early);
  assert.equal(day2Entries.length, 1);
  assert.equal(day2Entries[0].name, "Midnight snack");

  const totals = store.totalsForDay(day1);
  assert.equal(totals.calories, 400);
});

test("store — loggedDaySet/streak and recentlyUploaded/historyGroupedByDay", () => {
  globalThis.localStorage.clear();

  const today = new Date(2026, 5, 15, 12, 0, 0);
  const yesterday = addDays(startOfDay(today), -1);

  store.addFoodEntry({ name: "A", calories: 100, timestamp: today.getTime() });
  store.addFoodEntry({ name: "B", calories: 200, timestamp: yesterday });

  assert.equal(store.loggedDaySet().size, 2);
  assert.equal(store.streak(today), 2);

  const recent = store.recentlyUploaded(10);
  assert.equal(recent[0].name, "A"); // newest first

  const history = store.historyGroupedByDay();
  assert.equal(history.length, 2);
  assert.equal(history[0].entries[0].name, "A"); // newest bucket first
});

test("store — water entries are created lazily and never auto-created by decrement", () => {
  globalThis.localStorage.clear();

  const day = new Date(2026, 5, 20);
  assert.equal(store.getWaterEntryForDay(day).glasses, 0);

  // Decrementing a day with no row yet must NOT create one.
  store.decrementWater(day);
  const rawItem = globalThis.localStorage.getItem(store.STORAGE_KEYS.waterEntries);
  const raw = rawItem == null ? [] : JSON.parse(rawItem);
  assert.equal(raw.length, 0);

  store.incrementWater(day);
  store.incrementWater(day);
  assert.equal(store.getWaterEntryForDay(day).glasses, 2);

  store.decrementWater(day);
  assert.equal(store.getWaterEntryForDay(day).glasses, 1);

  store.decrementWater(day);
  store.decrementWater(day); // clamp at 0, never negative
  assert.equal(store.getWaterEntryForDay(day).glasses, 0);
});

test("store — weekStrip is Monday-start (7 columns Mon->Sun)", () => {
  globalThis.localStorage.clear();
  // 2026-06-17 is a Wednesday.
  const wednesday = new Date(2026, 5, 17);
  const strip = store.weekStrip(wednesday);
  assert.equal(strip.length, 7);
  const monday = new Date(strip[0].dayStart);
  assert.equal(monday.getDay(), 1); // Monday
  const sunday = new Date(strip[6].dayStart);
  assert.equal(sunday.getDay(), 0); // Sunday
});

test("store — notify banner flag persists as a simple boolean", () => {
  globalThis.localStorage.clear();
  assert.equal(store.isNotifyBannerDismissed(), false);
  store.setNotifyBannerDismissed(true);
  assert.equal(store.isNotifyBannerDismissed(), true);
});
