// grounding.test.mjs — USDA only replaces the AI's numbers when it clearly describes the same food.
// The cases are real ones from the app: desserts were coming out ~40% low from mismatched entries.
import test from "node:test";
import assert from "node:assert/strict";

const { sameFood, groundWith, GROUNDING_MIN_RATIO, GROUNDING_MAX_RATIO } = await import("../js/api.js");

const hit = (description, calories, protein = 5, carbs = 50, fat = 20) => ({ description, per100: { calories, protein, carbs, fat }, microsPer100: null });
const item = (name, gramsEstimate, calories) => ({ name, gramsEstimate, calories, proteinG: 5, carbsG: 40, fatG: 15, micros: null });

test("names: every main word of the food has to be in USDA's name", () => {
  assert.equal(sameFood("white rice", "Rice, white, long-grain, regular, enriched, cooked"), true);
  assert.equal(sameFood("rice cake", "Snacks, rice cakes, brown rice, plain"), true);
  assert.equal(sameFood("glazed donut", "Doughnuts, yeast-leavened, glazed, enriched"), true);
  assert.equal(sameFood("brownie", "Brownies, commercially prepared"), true);
  assert.equal(sameFood("glass of milk", "Milk, whole, 3.25% milkfat"), true);
  // a qualifier USDA doesn't have means it's a different thing
  assert.equal(sameFood("chocolate croissant", "Croissants, butter"), false);
  assert.equal(sameFood("chocolate frosted cake donut", "Doughnuts, cake-type, chocolate, sugared or glazed"), false);
});

test("a USDA number far from the AI's is a wrong match, not a correction", () => {
  // egg 15 g: the AI said ~21 kcal, "Egg, white" says 8 — the right word, the wrong part
  assert.equal(groundWith(item("egg", 15, 21), hit("Egg, white, raw, fresh", 52)), null);
  // donut 65 g at ~440 kcal/100 g, a mismatched entry at 264
  assert.equal(groundWith(item("glazed donut", 65, 286), hit("Doughnuts, yeast-leavened, glazed", 264)), null);
  // close enough: USDA refines it
  const g = groundWith(item("glazed donut", 65, 270), hit("Doughnuts, yeast-leavened, glazed", 403));
  assert.ok(g?.grounded);
  assert.equal(Math.round(g.calories), 262);
  assert.ok(GROUNDING_MIN_RATIO >= 0.75 && GROUNDING_MAX_RATIO <= 1.34);
});

test("special versions keep the AI's estimate: sugar-free, keto, protein, brands", () => {
  assert.equal(groundWith(item("sugar free dulce de leche", 20, 40), hit("Dulce de Leche", 315)), null);
  assert.equal(groundWith(item("keto chocolate cake", 30, 125), hit("Cake, chocolate, commercially prepared", 389)), null);
  assert.equal(groundWith(item("Fairlife chocolate milk", 240, 140), hit("Milk, chocolate, fluid, commercial", 83)), null);
  assert.equal(groundWith(item("protein pancake", 120, 300), hit("Pancakes, plain", 227)), null);
});
