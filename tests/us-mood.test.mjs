// us-mood.test.mjs — each person's row on Us: meltdown, cobwebs, or the "seriously?" badge.
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

const { rowMood } = await import("../js/us.js");
const { localDateString, addDays, startOfDay } = await import("../js/nutrition.js");

const evening = new Date(2026, 9, 3, 19, 30).getTime();
const morning = new Date(2026, 9, 3, 9, 0).getTime();
const day = (now, n) => localDateString(addDays(startOfDay(now), -n));
const person = (days) => ({ goals: { calories: 2000 }, days });

test("past the budget melts down; exercise credit raises the line", () => {
  assert.equal(rowMood(person({ [day(evening, 0)]: { calories: 2100, meals: 3 } }), evening)?.kind, "over");
  assert.equal(rowMood(person({ [day(evening, 0)]: { calories: 2100, meals: 3, credit: 200 } }), evening), null);
});

test("two days without a meal gathers cobwebs; yesterday doesn't", () => {
  assert.deepEqual(rowMood(person({ [day(evening, 2)]: { calories: 1500, meals: 2 } }), evening), { kind: "dusty", days: 2 });
  assert.equal(rowMood(person({ [day(evening, 1)]: { calories: 1500, meals: 2 } }), evening), null);
  assert.equal(rowMood(person({}), evening), null); // never logged: no cobwebs
});

test("barely eaten gets the badge, but only in the evening", () => {
  const p = person({ [day(evening, 0)]: { calories: 500, meals: 1 } });
  assert.deepEqual(rowMood(p, evening), { kind: "low", share: 25 });
  const am = person({ [day(morning, 0)]: { calories: 500, meals: 1 } });
  assert.equal(rowMood(am, morning), null);
  assert.equal(rowMood(person({ [day(evening, 0)]: { calories: 900, meals: 2 } }), evening), null);
});

test("averages skip today and half-logged days, unless there's nothing else yet", async () => {
  const { daysForAverage } = await import("../js/nutrition.js");
  const days = [
    { key: "2026-10-01", meals: 4, calories: 2000 },
    { key: "2026-10-02", meals: 1, calories: 400 },   // only breakfast logged
    { key: "2026-10-03", meals: 2, calories: 900 },   // today, not over yet
    { key: "2026-09-30", meals: 0, calories: 0 },
  ];
  const out = daysForAverage(days, { goal: 2000, todayKey: "2026-10-03" });
  assert.deepEqual(out.days.map((d) => d.key), ["2026-10-01"]);
  assert.equal(out.full, 1);
  assert.equal(out.skipped, 2);
  // a brand-new person with only today logged still gets a number
  assert.equal(daysForAverage([days[2]], { goal: 2000, todayKey: "2026-10-03" }).days.length, 1);
});

test("protein thread: the protein target lands on the calorie goal line", async () => {
  const { proteinThread } = await import("../js/us.js");
  assert.deepEqual(proteinThread(150, 150, 80), { at: 80, met: true });
  assert.deepEqual(proteinThread(75, 150, 80), { at: 40, met: false });
  assert.equal(proteinThread(300, 150, 80).at, 100, "runs past the line, never off the track");
  assert.equal(proteinThread(0, 150, 80), null);
  assert.equal(proteinThread(90, 0, 80), null, "no protein target: no thread");
  assert.equal(proteinThread(90, 150, null), null, "no calorie goal line to measure against");
});
