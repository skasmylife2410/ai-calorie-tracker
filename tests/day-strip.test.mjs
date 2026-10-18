// day-strip.test.mjs — Home's day strip: every day from the first meal to today (a week at least,
// 90 days at most), and which days went over budget by Home's own count.
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
const { startOfDay, addDays } = await import("../js/nutrition.js");

const today = new Date(2026, 9, 18, 15, 0);
const day = (back) => addDays(startOfDay(today), -back);
const meal = (back, calories) => store.addFoodEntry({ name: "Meal", calories, proteinG: 20, carbsG: 50, fatG: 10, source: "manual", timestamp: day(back) + 13 * 3600000 });

test("from the first meal to today, oldest first, with the days over budget", () => {
  store.setProfile({ sex: "female", age: 30, heightCm: 165, weightKg: 70, activityLevel: "light", targetDeltaKcal: -400, hasCompletedOnboarding: true, customTargetKcal: 1500 });
  const budget = store.dayEnergy(new Date(day(0))).adjustedTarget;
  meal(12, budget + 400); // over
  meal(6, 377);           // a light day: never red
  meal(1, budget);        // exactly the budget: not over
  const strip = store.dayStrip(90, today);
  assert.equal(strip.length, 13, "12 days back through today");
  assert.equal(strip[0].dayStart, day(12));
  assert.equal(strip[strip.length - 1].dayStart, day(0));
  assert.deepEqual(strip.filter((d) => d.over).map((d) => d.dayStart), [day(12)]);
  assert.equal(strip.find((d) => d.dayStart === day(6)).hasLog, true);
  assert.equal(strip.find((d) => d.dayStart === day(5)).hasLog, false);
});

test("a week at least, and no further back than the limit", () => {
  localStorage.clear();
  assert.equal(store.dayStrip(90, today).length, 7, "nothing logged yet: this week");
  meal(200, 1000);
  const strip = store.dayStrip(90, today);
  assert.equal(strip.length, 90);
  assert.equal(strip[0].dayStart, day(89));
});
