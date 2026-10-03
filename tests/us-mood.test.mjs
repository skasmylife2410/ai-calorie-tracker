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
  assert.deepEqual(rowMood(person({}), evening), { kind: "dusty", days: null });
});

test("barely eaten gets the badge, but only in the evening", () => {
  const p = person({ [day(evening, 0)]: { calories: 500, meals: 1 } });
  assert.deepEqual(rowMood(p, evening), { kind: "low", share: 25 });
  const am = person({ [day(morning, 0)]: { calories: 500, meals: 1 } });
  assert.equal(rowMood(am, morning), null);
  assert.equal(rowMood(person({ [day(evening, 0)]: { calories: 900, meals: 2 } }), evening), null);
});
