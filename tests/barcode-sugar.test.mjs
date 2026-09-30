// barcode-sugar.test.mjs — scanned foods keep their sugars, barcode answers are checked and the
// better source wins, Home shows total sugar, and part-known meals count as missing data.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

class MemoryStorage {
  constructor() { this._d = new Map(); }
  getItem(k) { return this._d.has(k) ? this._d.get(k) : null; }
  setItem(k, v) { this._d.set(k, String(v)); }
  removeItem(k) { this._d.delete(k); }
  clear() { this._d.clear(); }
}
globalThis.localStorage = new MemoryStorage();

const i18n = await import("../js/i18n.js");
i18n.setBundles({
  en: JSON.parse(readFileSync(new URL("../i18n/en.json", import.meta.url), "utf8")),
  es: JSON.parse(readFileSync(new URL("../i18n/es.json", import.meta.url), "utf8")),
});
await i18n.setLanguage("en");
const { parseBasis, servingGrams, macrosConsistent, isNorthAmericanCode, pickBarcodeResult } = await import("../js/api.js");
const { nutrientsStripHtml } = await import("../js/ui/micros.js");
const { microTargets } = await import("../js/nutrition.js");
const { microsComplete } = await import("../js/store.js");

test("serving grams come from serving_quantity, else the number in serving_size", () => {
  assert.equal(servingGrams("1 cup (240 ml)", 240), 240);
  assert.equal(servingGrams("1 cup (240 ml)"), 240);
  assert.equal(servingGrams("30 g"), 30);
  assert.equal(servingGrams("1 tortilla (45g)"), 45);
  assert.equal(servingGrams("1 tortilla"), null);
});

test("per-serving products keep sugars and sodium worked out from per 100 g", () => {
  const basis = parseBasis({
    "energy-kcal_100g": 62.5, proteins_100g: 5.4, carbohydrates_100g: 2.5, fat_100g: 3.3, sugars_100g: 2.5, sodium_100g: 0.05,
    "energy-kcal_serving": 150, proteins_serving: 13, carbohydrates_serving: 6, fat_serving: 8,
  }, "1 cup (240 ml)", 240);
  assert.equal(basis.calories, 150);
  assert.equal(basis.micros.sugarG, 6);
  assert.equal(basis.micros.sodiumMg, 120);
  // a value the label gives per serving wins over the worked-out one
  const own = parseBasis({
    "energy-kcal_100g": 62.5, proteins_100g: 5.4, carbohydrates_100g: 2.5, fat_100g: 3.3, sugars_100g: 2.5,
    "energy-kcal_serving": 150, proteins_serving: 13, carbohydrates_serving: 6, fat_serving: 8, sugars_serving: 7,
  }, "1 cup (240 ml)");
  assert.equal(own.micros.sugarG, 7);
});

test("calories must roughly match 4·protein + 4·carbs + 9·fat", () => {
  assert.equal(macrosConsistent({ calories: 150, proteinG: 13, carbsG: 6, fatG: 8 }), true);
  assert.equal(macrosConsistent({ calories: 400, proteinG: 13, carbsG: 6, fatG: 8 }), false);
  assert.equal(macrosConsistent({ calories: 0, proteinG: 0, carbsG: 0, fatG: 0 }), true);
  assert.equal(macrosConsistent({ calories: 10, proteinG: 0, carbsG: 0, fatG: 0 }), true); // tiny amounts pass
});

test("UPC codes are North American; European EANs are not", () => {
  assert.equal(isNorthAmericanCode("041303001189"), true);
  assert.equal(isNorthAmericanCode("0041303001189"), true);
  assert.equal(isNorthAmericanCode("8410076472885"), false);
});

const offProduct = { name: "Milk", servingDescription: "per 100 g", calories: 104, proteinG: 9.2, carbsG: 4.6, fatG: 5.5 };
const usdaProduct = { name: "Milk", servingDescription: "per serving (240 ml)", calories: 150, proteinG: 13, carbsG: 6, fatG: 8 };

test("North American codes prefer the maker's label from USDA", () => {
  const out = pickBarcodeResult("041303001189", { status: "complete", product: offProduct }, { status: "found", product: usdaProduct });
  assert.equal(out.product.source, "usda");
  assert.equal(out.product.suspect, false);
});

test("other codes prefer Open Food Facts, but not when its numbers don't add up", () => {
  const eu = "8410076472885";
  assert.equal(pickBarcodeResult(eu, { status: "complete", product: offProduct }, { status: "found", product: usdaProduct }).product.source, "off");
  const bad = { ...offProduct, calories: 400 };
  assert.equal(pickBarcodeResult(eu, { status: "complete", product: bad }, { status: "found", product: usdaProduct }).product.source, "usda");
  const only = pickBarcodeResult(eu, { status: "complete", product: bad }, { status: "notFound" });
  assert.equal(only.product.suspect, true);
});

test("nothing found, or both sources down", () => {
  assert.equal(pickBarcodeResult("041303001189", { status: "notFound" }, { status: "notFound" }).status, "notFound");
  assert.equal(pickBarcodeResult("041303001189", { status: "failed", message: "a" }, { status: "failed", message: "b" }).status, "failed");
  assert.equal(pickBarcodeResult("8410076472885", { status: "failed", message: "a" }, { status: "notFound" }).status, "failed");
});

test("Home strip shows total sugar, with the added part underneath and driving 'over'", () => {
  const targets = microTargets({ targetCalories: 2000 });
  const html = nutrientsStripHtml({ totals: { sugarG: 38, addedSugarG: 0 }, targets, meals: 3, missing: 0 });
  assert.match(html, /<b>38<\/b>/);
  assert.match(html, /0 added/);
  assert.doesNotMatch(html, /is-over/);
  const over = nutrientsStripHtml({ totals: { sugarG: 80, addedSugarG: 60 }, targets, meals: 3, missing: 0 });
  assert.match(over, /is-over/);
  const partial = nutrientsStripHtml({ totals: { sugarG: 10 }, targets, meals: 3, missing: 2 });
  assert.match(partial, /2 meals missing data/);
});

test("a meal with a food that has no nutrient data counts as missing", () => {
  const egg = { calories: 72, micros: { sugarG: 0.2 } };
  const tortilla = { calories: 60, micros: null };
  const water = { calories: 0, micros: null };
  assert.equal(microsComplete({ micros: { sugarG: 0.2 }, analysisItems: [egg, tortilla] }), false);
  assert.equal(microsComplete({ micros: { sugarG: 0.2 }, analysisItems: [egg, water] }), true);
  assert.equal(microsComplete({ micros: null }), false);
  assert.equal(microsComplete({ micros: { fiberG: 1 } }), true);
});
