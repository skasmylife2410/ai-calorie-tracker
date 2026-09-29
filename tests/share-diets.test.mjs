// share-diets.test.mjs — diet choices, and the day / week summaries behind "Share".
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
const { DIETS, cleanDiets, toggleDiet, recipePreferences } = await import("../js/diets.js");
const store = await import("../js/store.js");
const { daySummary, weekSummary, summaryText } = await import("../js/ui/share-summary.js");

test("diets: known keys only, vegan replaces vegetarian, and every one has a label in both languages", () => {
  assert.deepEqual(cleanDiets(["vegan", "nonsense", "vegan", "glutenfree"]), ["vegan", "glutenfree"]);
  assert.deepEqual(toggleDiet(["vegetarian", "glutenfree"], "vegan"), ["vegan", "glutenfree"]);
  assert.deepEqual(toggleDiet(["vegan"], "vegan"), []);
  assert.deepEqual(toggleDiet(["vegetarian"], "pescatarian"), ["pescatarian"]);
  for (const lang of ["en", "es"]) {
    const d = JSON.parse(readFileSync(new URL(`../i18n/${lang}.json`, import.meta.url), "utf8")).diet;
    for (const k of [...DIETS, "none"]) assert.ok(d[k], `${lang} diet.${k}`);
  }
});

test("diets reach 'What should I eat?' as plain rules the model can follow", () => {
  const prefs = recipePreferences({ diets: ["vegan", "glutenfree"], recipePreferences: ["no mushrooms"] });
  assert.equal(prefs.length, 3);
  assert.match(prefs[0], /no meat, fish, eggs, dairy or honey/);
  assert.equal(prefs[2], "no mushrooms");
  assert.deepEqual(recipePreferences({}), []);
});

test("day summary: eaten, left, meals in order; text lists them and respects the switches", () => {
  store.setProfile({ customTargetKcal: 2000, weightKg: 70, heightCm: 170, age: 30, sex: "female" });
  const day = new Date(); day.setHours(0, 0, 0, 0);
  store.addFoodEntry({ name: "Oats & berries", calories: 420, proteinG: 18, carbsG: 62, fatG: 9, timestamp: day.getTime() + 8 * 36e5, source: "manual" });
  store.addFoodEntry({ name: "Chicken rice bowl", calories: 690, proteinG: 52, carbsG: 70, fatG: 18, timestamp: day.getTime() + 13 * 36e5, source: "manual" });
  store.addFoodEntry({ name: "pending", calories: 0, proteinG: 0, carbsG: 0, fatG: 0, isPending: true, timestamp: day.getTime() + 14 * 36e5, source: "text" });
  const s = daySummary(day);
  assert.equal(s.eaten, 1110);
  assert.equal(s.goal, 2000);
  assert.equal(s.remaining, 890);
  assert.deepEqual(s.meals.map((m) => m.name), ["Oats & berries", "Chicken rice bowl"]);
  assert.equal(s.meals[1].kind, "meat");
  const text = summaryText(s, { meals: true, streak: true });
  assert.match(text, /1,110 \/ 2,000 kcal \(890 left\)/);
  assert.match(text, /• Chicken rice bowl — 690/);
  assert.doesNotMatch(summaryText(s, { meals: false }), /Chicken/);
});

test("week summary: seven days ending on the day, averages over logged days only", () => {
  const day = new Date(); day.setHours(0, 0, 0, 0);
  const w = weekSummary(day);
  assert.equal(w.days.length, 7);
  assert.equal(w.loggedDays, 1);
  assert.equal(w.avgCalories, 1110);
  assert.match(summaryText(w), /Average 1,110 kcal a day/);
});
