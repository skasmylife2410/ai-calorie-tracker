// features.test.mjs — servings multiplier, favourites, exercise entries and the 60% credit.
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
const { cleanMicros, scaleMicros, sumMicros, microTargets } = await import("../js/nutrition.js");
const { offMicros, usdaMicrosPer100g, microsFromRaw } = await import("../js/api.js");
const { trayItemFromProduct, trayToEntry, withAmount } = await import("../js/meal-builder.js");
const { searchLocalFoods } = await import("../js/foods-local.js");

test("unknown stays unknown: null is not zero, and sums only add what is known", () => {
  assert.equal(cleanMicros(null), null);
  assert.equal(cleanMicros({ sodiumMg: null }), null);
  const s = sumMicros([{ sodiumMg: 400, fiberG: 2 }, null, { sodiumMg: 100 }]);
  assert.equal(s.sodiumMg, 500);
  assert.equal(s.fiberG, 2);
  assert.equal(s.potassiumMg, null);
  assert.equal(scaleMicros({ sodiumMg: 333, fiberG: 1.25 }, 2).sodiumMg, 666);
  // added sugar is capped at total sugar
  assert.equal(cleanMicros({ sugarG: 5, addedSugarG: 9 }).addedSugarG, 5);
});

test("reference values follow the calorie target and sex", () => {
  const m = microTargets({ targetCalories: 2000, sex: "male" });
  assert.equal(m.sodiumMg.value, 2300);
  assert.equal(m.addedSugarG.value, 50);
  assert.equal(m.satFatG.value, 22);
  assert.equal(m.fiberG.value, 28);
  assert.equal(m.potassiumMg.value, 3400);
  assert.equal(microTargets({ targetCalories: 1600, sex: "female" }).potassiumMg.value, 2600);
});

test("Open Food Facts: grams become mg, and salt stands in for missing sodium", () => {
  const m = offMicros({ "sodium_100g": 0.4, "potassium_100g": 0.2, "sugars_100g": 10, "fiber_100g": 3 });
  assert.equal(m.sodiumMg, 400);
  assert.equal(m.potassiumMg, 200);
  assert.equal(offMicros({ "salt_100g": 1 }).sodiumMg, 400);
});

test("USDA and AI nutrient fields map onto the same shape", () => {
  const m = usdaMicrosPer100g([{ nutrientNumber: "307", value: 50 }, { nutrientNumber: "291", value: 2.4 }, { nutrientNumber: "269.3", value: 10 }]);
  assert.equal(m.sodiumMg, 50);
  assert.equal(m.fiberG, 2.4);
  assert.equal(m.sugarG, 10);
  const ai = microsFromRaw({ sodium_mg: 820, sugar_g: 12, added_sugar_g: 4, fiber_g: 3, sat_fat_g: 5, potassium_mg: 300 });
  assert.deepEqual(ai, { fiberG: 3, sugarG: 12, addedSugarG: 4, satFatG: 5, sodiumMg: 820, potassiumMg: 300 });
});

test("built-in foods and the plate builder carry nutrients, scaled by amount", () => {
  const [banana] = searchLocalFoods("banana");
  assert.equal(banana.micros.potassiumMg, 358);
  const item = withAmount(trayItemFromProduct(banana), 200);
  const entry = trayToEntry([item]);
  assert.equal(entry.micros.potassiumMg, 716);
  assert.equal(entry.analysisItems[0].micros.potassiumMg, 716);
});

test("a scanned meal keeps its calories when servings change (used to drop to 0)", () => {
  localStorage.clear();
  const e = store.addFoodEntry({ name: "Analyzing Image", calories: 0, isPending: true });
  const items = [{ name: "rice", calories: 200, proteinG: 4, carbsG: 44, fatG: 1, micros: { sodiumMg: 300 } }];
  store.updateFoodEntry(e.id, { ...store.fieldsFromItems(items, 1), analysisItems: items, isPending: false });
  const two = store.setServings(e.id, 2);
  assert.equal(two.calories, 400);
  assert.equal(two.micros.sodiumMg, 600);
});

test("saving item edits keeps the servings multiplier", () => {
  const items = [{ name: "rice", calories: 150, proteinG: 3, carbsG: 33, fatG: 1 }];
  const f = store.fieldsFromItems(items, 2);
  assert.equal(f.calories, 300);
  assert.equal(f.base.calories, 150);
});

test("day nutrients report meals without data instead of counting them as zero", () => {
  localStorage.clear();
  store.addFoodEntry({ name: "old meal", calories: 500 });
  store.addFoodEntry({ name: "new meal", calories: 300, micros: { sodiumMg: 900, fiberG: 5 } });
  const day = store.microsForDay(new Date());
  assert.equal(day.meals, 2);
  assert.equal(day.missing, 1);
  assert.equal(day.totals.sodiumMg, 900);
  assert.equal(day.targets.sodiumMg.value, 2300);
});

test("favourites keep nutrients and scale them when re-logged", () => {
  localStorage.clear();
  const e = store.addFoodEntry({ name: "Soup", calories: 200, micros: { sodiumMg: 700 } });
  store.toggleFavorite(e.id);
  const saved = store.allSavedFoods()[0];
  assert.equal(saved.micros.sodiumMg, 700);
  const again = store.logSavedFood(saved.id, { servings: 1.5 });
  assert.equal(again.micros.sodiumMg, 1050);
});

test("typed exercise kcal is stored as given, minutes optional", () => {
  localStorage.clear();
  const x = store.addExerciseEntry({ name: "Gym", activity: "gym", minutes: 0, caloriesBurned: 420, kcalEntered: true });
  assert.equal(x.caloriesBurned, 420);
  assert.equal(x.kcalEntered, true);
  assert.equal(x.minutes, 0);
});

test("dropping one meal on another makes one meal with both foods, and undo restores both", () => {
  localStorage.clear();
  const eggs = store.addFoodEntry({ name: "Eggs", calories: 140, proteinG: 12, amount: 100, amountUnit: "g", micros: { sodiumMg: 140 } });
  const arepa = store.addFoodEntry({ name: "Arepa", calories: 220, proteinG: 4, servings: 2, base: { calories: 110, proteinG: 2, carbsG: 22, fatG: 1 } });
  const out = store.groupEntries(eggs.id, arepa.id);
  assert.equal(store.allFoodEntries().length, 1);
  const g = out.entry;
  assert.equal(g.analysisItems.length, 2);
  assert.equal(g.calories, 360);
  assert.equal(g.servings, 1);
  assert.equal(g.micros.sodiumMg, 140);
  assert.equal(g.analysisItems.find((i) => i.name === "Eggs").gramsEstimate, 100);

  // grouped again with a third meal: items keep accumulating
  const coffee = store.addFoodEntry({ name: "Tinto", calories: 5 });
  store.groupEntries(coffee.id, g.id);
  assert.equal(store.getFoodEntry(g.id).analysisItems.length, 3);
  assert.equal(store.getFoodEntry(g.id).calories, 365);

  localStorage.clear();
  const a = store.addFoodEntry({ name: "A", calories: 100 });
  const b = store.addFoodEntry({ name: "B", calories: 200 });
  const res = store.groupEntries(a.id, b.id);
  res.undo();
  const names = store.allFoodEntries().map((e) => `${e.name}:${e.calories}`).sort();
  assert.deepEqual(names, ["A:100", "B:200"]);
  assert.equal(store.getFoodEntry(b.id).analysisItems ?? null, null);
});

test("a scanned meal's servings are baked in when it joins a group", () => {
  localStorage.clear();
  const items = [{ name: "rice", calories: 200, proteinG: 4, carbsG: 44, fatG: 1, gramsEstimate: 150 }];
  const m = store.addFoodEntry({ name: "rice", ...store.fieldsFromItems(items, 2), servings: 2, analysisItems: items });
  const s = store.addFoodEntry({ name: "Juice", calories: 100 });
  const g = store.groupEntries(s.id, m.id).entry;
  assert.equal(g.calories, 500);
  assert.equal(g.analysisItems[0].gramsEstimate, 300);
});

test("a hearted group keeps its foods and re-logs them as separate items", () => {
  localStorage.clear();
  const a = store.addFoodEntry({ name: "Eggs", calories: 140 });
  const b = store.addFoodEntry({ name: "Arepa", calories: 220 });
  const g = store.groupEntries(a.id, b.id).entry;
  store.toggleFavorite(g.id);
  const saved = store.allSavedFoods()[0];
  assert.equal(saved.items.length, 2);
  const again = store.logSavedFood(saved.id, { servings: 2 });
  assert.equal(again.analysisItems.length, 2);
  assert.equal(again.calories, 720);
  assert.equal(again.servings, 2);
});

test("pending or failed meals can't be grouped", () => {
  localStorage.clear();
  const a = store.addFoodEntry({ name: "A", calories: 100 });
  const p = store.addFoodEntry({ name: "Analyzing", isPending: true });
  assert.equal(store.groupEntries(p.id, a.id), null);
  assert.equal(store.groupEntries(a.id, a.id), null);
});

test("the drag accepts every state a finished meal row actually has", async () => {
  const { entryState } = await import("../js/queue.js");
  const { isGroupableState } = await import("../js/ui/meal-drag.js");
  assert.equal(isGroupableState(entryState({ name: "a" })), true);
  assert.equal(isGroupableState(entryState({ name: "a", analysisItems: [] })), true);
  assert.equal(isGroupableState(entryState({ isPending: true })), false);
  assert.equal(isGroupableState(entryState({ analysisFailed: true })), false);
});
