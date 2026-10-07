// stack.test.mjs — stacking several meals, copying a meal to today, favouriting a selection.
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

const D = 86400000;
const meal = (name, calories, timestamp) => store.addFoodEntry({ name, calories, proteinG: 10, carbsG: 20, fatG: 5, timestamp });

test("stacking three meals makes one with all their foods; undo brings all three back", () => {
  localStorage.clear();
  const a = meal("Oats", 400, 1000), b = meal("Coffee", 60, 2000), c = meal("Banana", 105, 3000);
  const out = store.groupMany([a.id, b.id, c.id]);
  assert.equal(out.entry.calories, 565);
  assert.equal(out.entry.analysisItems.length, 3);
  assert.equal(out.entry.grouped, true);
  assert.equal(store.allFoodEntries().length, 1);
  out.undo();
  assert.deepEqual(store.allFoodEntries().map((e) => e.calories).sort((x, y) => x - y), [60, 105, 400]);
  assert.equal(store.groupMany([a.id]), null, "one meal can't be stacked");
});

test("an earlier day's meal is logged again today as a new meal", () => {
  localStorage.clear();
  const y = store.addFoodEntry({ name: "Arepa", calories: 380, proteinG: 14, carbsG: 40, fatG: 15, timestamp: Date.now() - D, servings: 2, analysisSizeCheck: 300, leftovers: { removedKcal: 50 } });
  const now = Date.now();
  const copy = store.copyEntryTo(y.id, now);
  assert.notEqual(copy.id, y.id);
  assert.equal(copy.timestamp, now);
  assert.equal(copy.calories, 380);
  assert.equal(copy.servings, 2);
  assert.equal(copy.analysisSizeCheck, undefined, "no size check carried over");
  assert.equal(copy.leftovers, undefined);
  assert.equal(store.allFoodEntries().length, 2);
});

test("favouriting one meal hearts it; several become one favourite meal of all their foods", () => {
  localStorage.clear();
  const a = meal("Eggs", 180, 1000), b = meal("Toast", 160, 2000);
  store.favouriteMany([a.id]);
  assert.equal(store.isFavorited(a), true);
  const saved = store.favouriteMany([a.id, b.id]);
  assert.equal(saved.calories, 340);
  assert.equal(saved.items.length, 2);
});
