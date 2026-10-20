// meal-type.test.mjs — breakfast, lunch, dinner or snack: the clock's guess, a pick that sticks
// (and syncs), and which logs ask "which meal was this?".
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
const { guessMealType, mealTypeOf, MEAL_TYPES } = await import("../js/nutrition.js");

const at = (h, m = 0) => new Date(2026, 9, 18, h, m).getTime();

test("the clock's guess: breakfast to 11, lunch to 4 pm, dinner 6–11 pm, a snack otherwise", () => {
  assert.deepEqual(MEAL_TYPES, ["breakfast", "lunch", "dinner", "snack"]);
  const cases = [[7, "breakfast"], [10, "breakfast"], [11, "lunch"], [15, "lunch"], [16, "snack"], [17, "snack"],
    [18, "dinner"], [22, "dinner"], [23, "snack"], [2, "snack"], [4, "breakfast"]];
  for (const [h, want] of cases) assert.equal(guessMealType(at(h, 30)), want, `${h}:30`);
});

test("a pick sticks: on the meal, through sync, and never anything but the four", () => {
  localStorage.clear();
  const e = store.addFoodEntry({ name: "Arepa", calories: 300, timestamp: at(20) });
  assert.equal(e.mealType, undefined, "nothing picked yet");
  assert.equal(mealTypeOf(e), "dinner", "so the clock's guess is shown");
  store.setMealType(e.id, "lunch");
  assert.equal(mealTypeOf(store.getFoodEntry(e.id)), "lunch");
  assert.equal(store.setMealType(e.id, "brunch"), null);
  assert.equal(store.getFoodEntry(e.id).mealType, "lunch");
  // the same meal coming back from another phone keeps it
  const remote = store.makeFoodEntry({ ...store.getFoodEntry(e.id) });
  assert.equal(remote.mealType, "lunch");
  assert.equal(store.makeFoodEntry({ name: "x", mealType: "elevenses" }).mealType, undefined);
});

test("logging asks which meal it was; an undo or a copy's mealtime doesn't carry over", () => {
  localStorage.clear();
  const seen = [];
  const off = store.onMealLogged((entry) => seen.push(entry.name));
  const a = store.addFoodEntry({ name: "Eggs", calories: 200, timestamp: at(8) });
  const b = store.addFoodEntry({ name: "Toast", calories: 150, timestamp: at(8, 5) });
  assert.deepEqual(seen, ["Eggs", "Toast"]);
  const out = store.groupMany([a.id, b.id]);
  out.undo();
  assert.deepEqual(seen, ["Eggs", "Toast"], "putting a meal back isn't a new log");

  store.setMealType(a.id, "snack");
  store.updateFoodEntry(a.id, { sharedAt: 123 });
  const copy = store.copyEntryTo(a.id, at(13));
  assert.equal(seen.at(-1), "Eggs", "a copy is a new log, so it asks");
  assert.equal(copy.mealType, undefined, "and its mealtime is asked again");
  assert.equal(mealTypeOf(copy), "lunch");
  assert.equal(copy.sharedAt, undefined, "the copy isn't shared yet");
  off();
});

test("a food detached from a stack is its own meal again, same time and meal of the day; Undo puts it back", () => {
  localStorage.clear();
  const eggs = store.addFoodEntry({ name: "Fried eggs", calories: 180, proteinG: 12, carbsG: 1, fatG: 14, timestamp: at(7, 30) });
  const toast = store.addFoodEntry({ name: "Toast", calories: 240, proteinG: 8, carbsG: 44, fatG: 3, timestamp: at(7, 40) });
  store.setMealType(eggs.id, "breakfast");
  const { entry: stack } = store.groupEntries(toast.id, eggs.id);
  assert.equal(stack.calories, 420);
  const before = JSON.parse(JSON.stringify(store.getFoodEntry(stack.id)));

  const index = store.itemsOfEntry(stack).findIndex((i) => i.name === "Toast");
  const out = store.detachItem(stack.id, index);
  assert.equal(out.entry.calories, 180, "the stack keeps the rest");
  assert.equal(out.entry.name, "Fried eggs");
  assert.equal(out.entry.grouped, false, "one food left: not a stack any more");
  assert.deepEqual([out.detached.name, out.detached.calories, out.detached.timestamp], ["Toast", 240, stack.timestamp]);
  assert.equal(mealTypeOf(out.detached), "breakfast", "same meal of the day");
  assert.equal(store.allFoodEntries().length, 2);

  out.undo();
  assert.equal(store.allFoodEntries().length, 1);
  const back = store.getFoodEntry(stack.id);
  assert.deepEqual([back.calories, back.analysisItems.length, back.grouped], [before.calories, 2, true]);

  assert.equal(store.detachItem(out.detached.id, 0), null, "a single meal has nothing to detach");
  assert.equal(store.detachItem(stack.id, 9), null);
});
