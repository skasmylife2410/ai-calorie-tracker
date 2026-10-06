// leftovers.test.mjs — a photo of what's left takes it off the meal, and can be undone.
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
const { applyLeftovers, leftoversText, itemsOf, undoLeftovers } = await import("../js/leftovers.js");

const rice = { name: "white rice, cooked", gramsEstimate: 200, calories: 260, proteinG: 5, carbsG: 57, fatG: 0.6, micros: null };
const chicken = { name: "grilled chicken breast", gramsEstimate: 150, calories: 248, proteinG: 46, carbsG: 0, fatG: 5, micros: null };

test("each item is scaled to what was eaten; unmentioned items were eaten", () => {
  const { items, removedKcal } = applyLeftovers([rice, chicken], [{ index: 0, left_fraction: 0.5 }]);
  assert.equal(items[0].calories, 130);
  assert.equal(items[0].gramsEstimate, 100);
  assert.equal(items[0].leftFraction, 0.5);
  assert.equal(items[1].calories, 248);
  assert.equal(removedKcal, 130);
});

test("servings count: half the rice left of a double portion is a whole portion's worth", () => {
  assert.equal(applyLeftovers([rice], [{ index: 0, left_fraction: 0.5 }], 2).removedKcal, 260);
});

test("nonsense from the AI is ignored or clamped", () => {
  const { items, removedKcal } = applyLeftovers([rice, chicken], [{ index: 7, left_fraction: 0.5 }, { index: 1, left_fraction: 3 }, { index: "x", left_fraction: 0.2 }]);
  assert.equal(items[0].calories, 260);
  assert.equal(items[1].calories, 0);
  assert.equal(removedKcal, 248);
});

test("the prompt lists items with what was served", () => {
  assert.equal(leftoversText([rice, chicken], 2), "0. white rice, cooked — 400 g\n1. grilled chicken breast — 300 g");
  assert.equal(leftoversText([{ name: "arepa con queso", gramsEstimate: 0 }]), "0. arepa con queso");
});

test("a meal logged without items is one item; undo puts the meal back", () => {
  localStorage.clear();
  const e = store.addFoodEntry({ name: "Burrito", calories: 800, proteinG: 35, carbsG: 90, fatG: 30 });
  const items = itemsOf(e);
  assert.equal(items.length, 1);
  assert.equal(items[0].calories, 800);
  const { items: eaten, removedKcal } = applyLeftovers(items, [{ index: 0, left_fraction: 0.25 }]);
  store.updateFoodEntry(e.id, { analysisItems: eaten, ...store.fieldsFromItems(eaten, 1), leftovers: { removedKcal, before: { analysisItems: null, calories: 800, proteinG: 35, carbsG: 90, fatG: 30, micros: null, base: e.base ?? null } } });
  assert.equal(store.getFoodEntry(e.id).calories, 600);
  assert.equal(undoLeftovers(e.id), true);
  const back = store.getFoodEntry(e.id);
  assert.equal(back.calories, 800);
  assert.equal(back.leftovers, null);
  assert.equal(back.analysisItems, null);
});
