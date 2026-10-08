// add-to-meal.test.mjs — adding foods to a meal being edited, and the grams under servings:
// a serving of unknown weight stays unknown (never "1 g"), and known weights travel with foods
// through stacking, Favourites › Recent, the food search and the manual form.
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
const { trayItemFromProduct, trayToEntry, withAmount } = await import("../js/meal-builder.js");
const { itemFromDraft } = await import("../js/ui/addfood.js");

test("scaleItem scales numbers, grams and amount together", () => {
  const out = store.scaleItem({ name: "Rice", calories: 200, proteinG: 4, carbsG: 44, fatG: 0.4, gramsEstimate: 150, amount: 150, unit: "g" }, 2);
  assert.equal(out.calories, 400);
  assert.equal(out.proteinG, 8);
  assert.equal(out.gramsEstimate, 300);
  assert.equal(out.amount, 300);
  const noAmount = store.scaleItem({ name: "X", calories: 10, amount: null }, 2);
  assert.equal(noAmount.amount, null, "an unknown amount stays unknown, not 0");
});

test("a meal in servings stacks with what one serving weighs, not 0 g or 1 g", () => {
  localStorage.clear();
  const e = store.addFoodEntry({ name: "Empanada", calories: 300, proteinG: 10, carbsG: 30, fatG: 15, amount: 2, amountUnit: "serving", servingGrams: 90 });
  const [item] = store.itemsOfEntry(e);
  assert.equal(item.unit, "serving");
  assert.equal(item.amount, 2, "two servings typed on the form stay two");
  assert.equal(item.gramsPerServing, 90);
  assert.equal(item.gramsEstimate, 180);
});

test("a meal of unknown weight stacks as servings with no invented grams", () => {
  localStorage.clear();
  const e = store.addFoodEntry({ name: "Cake slice", calories: 420, proteinG: 5, carbsG: 50, fatG: 22, servings: 2, base: { calories: 210, proteinG: 2.5, carbsG: 25, fatG: 11 } });
  const [item] = store.itemsOfEntry(e);
  assert.equal(item.unit, "serving");
  assert.equal(item.amount, 2);
  assert.equal(item.gramsEstimate, 0);
  assert.equal(item.gramsPerServing, undefined);
});

test("one serving of a logged meal: its foods divided by its servings", () => {
  localStorage.clear();
  const e = store.addFoodEntry({
    name: "Rice & Chicken", calories: 1000, proteinG: 80, carbsG: 100, fatG: 20, servings: 2,
    analysisItems: [
      { name: "Rice", calories: 300, proteinG: 6, carbsG: 66, fatG: 1, gramsEstimate: 230, unit: "g", amount: 230 },
      { name: "Chicken", calories: 200, proteinG: 34, carbsG: 0, fatG: 9, gramsEstimate: 120, unit: "g", amount: 120 },
    ],
  });
  const one = store.oneServingItems(e);
  assert.deepEqual(one.map((i) => [i.name, i.calories, i.gramsEstimate, i.amount]), [["Rice", 300, 230, 230], ["Chicken", 200, 120, 120]]);
  assert.equal(store.servingGramsOf(e), 350);
  const plain = store.addFoodEntry({ name: "Mystery", calories: 100 });
  assert.equal(store.servingGramsOf(plain), null);
});

test("recent foods in the search carry what a serving weighs, and the tray keeps it", () => {
  localStorage.clear();
  store.addFoodEntry({
    name: "Bowl", calories: 500, proteinG: 30, carbsG: 50, fatG: 15,
    analysisItems: [{ name: "Bowl", calories: 500, proteinG: 30, carbsG: 50, fatG: 15, gramsEstimate: 400, unit: "g", amount: 400 }],
  });
  const [recent] = store.quickFoods(5);
  assert.equal(recent.servingGrams, 400);
  const tray = withAmount(trayItemFromProduct(recent), 1.5);
  const [item] = trayToEntry([tray]).analysisItems;
  assert.equal(item.unit, "serving");
  assert.equal(item.amount, 1.5);
  assert.equal(item.gramsPerServing, 400);
  assert.equal(item.gramsEstimate, 600);
  assert.equal(item.calories, 750);
});

test("a database serving of unknown weight stays 0 g in the meal", () => {
  const tray = trayItemFromProduct({ name: "Cookie", servingDescription: "1 serving", calories: 150 });
  const [item] = trayToEntry([tray]).analysisItems;
  assert.equal(item.gramsEstimate, 0);
  assert.equal(item.gramsPerServing, undefined);
});

test("the manual form hands back an item in its own unit, with grams underneath", () => {
  const grams = itemFromDraft({ name: "Yogurt", calories: 120, proteinG: 10, carbsG: 8, fatG: 4, amount: 170, amountUnit: "g" });
  assert.deepEqual([grams.unit, grams.amount, grams.gramsEstimate], ["g", 170, 170]);
  const noAmount = itemFromDraft({ name: "Snack", calories: 200, amount: null, amountUnit: "g" });
  assert.deepEqual([noAmount.unit, noAmount.amount, noAmount.gramsEstimate], ["serving", 1, 0]);
  const servings = itemFromDraft({ name: "Taco", calories: 340, amount: 2, amountUnit: "serving", servingGrams: 110 }, (a, u) => (u === "serving" ? a * 110 : a));
  assert.deepEqual([servings.unit, servings.amount, servings.gramsEstimate, servings.gramsPerServing], ["serving", 2, 220, 110]);
});

test("ml to grams: English drinks named head-noun-last are drinks", async () => {
  const { kindOf, densityOf } = await import("../js/ui/portion-plate.js");
  assert.equal(kindOf("Orange juice"), "drink");
  assert.equal(kindOf("Almond milk"), "drink");
  assert.equal(densityOf("Orange juice"), 1.0);
  assert.equal(kindOf("Jugo de naranja"), "drink");
  assert.equal(kindOf("Arepa con queso"), "bread");
  assert.equal(kindOf("Peanut butter"), "fat");
});
