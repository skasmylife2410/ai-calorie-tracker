// insights.test.mjs — food kind glyphs, the Us kcal bar and week chart, and the Home nutrients card.
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
const { FOOD_CATEGORIES, categoryOfName, foodCategory, foodIconSvg } = await import("../js/ui/food-icons.js");
const { kcalBarHtml, weekChartHtml } = await import("../js/us.js");
const { nutrientsStripHtml } = await import("../js/ui/micros.js");
const { localDateString, addDays, startOfDay, microTargets } = await import("../js/nutrition.js");

test("ten food kinds, each with its own glyph and a label in both languages", () => {
  assert.equal(FOOD_CATEGORIES.length, 10);
  const svgs = new Set(FOOD_CATEGORIES.map((c) => foodIconSvg(c)));
  assert.equal(svgs.size, 10);
  for (const lang of ["en", "es"]) {
    const food = JSON.parse(readFileSync(new URL(`../i18n/${lang}.json`, import.meta.url))).food;
    for (const c of [...FOOD_CATEGORIES, "plate"]) assert.ok(food[c], `${lang} food.${c}`);
  }
});

test("a meal is sorted by the first food it names, in English or Spanish", () => {
  assert.equal(categoryOfName("Arroz con pollo"), "bowl");
  assert.equal(categoryOfName("Pollo con arroz"), "meat");
  assert.equal(categoryOfName("Arepa con queso"), "grain");
  assert.equal(categoryOfName("Greek yogurt with berries"), "dairy");
  assert.equal(categoryOfName("Salmon poke bowl"), "fish");
  assert.equal(categoryOfName("Café con leche"), "drink");
  assert.equal(categoryOfName("Scrambled eggs"), "egg");
  assert.equal(categoryOfName("Plátano"), "fruit");
  assert.equal(categoryOfName("Something unusual"), null);
});

test("no match in the name: the biggest item that matches decides; nothing at all: a plate", () => {
  const entry = { name: "Lunch", analysisItems: [{ name: "Apple", calories: 80 }, { name: "Steak", calories: 600 }] };
  assert.equal(foodCategory(entry), "meat");
  assert.equal(foodCategory({ name: "Lunch" }), "plate");
  assert.match(foodIconSvg("plate"), /food-icon/);
});

const day = (calories, parts = {}) => ({ calories, proteinG: 0, carbsG: 0, fatG: 0, meals: 1, water: 0, burned: 0, sessions: 0, morning: 0, afternoon: 0, evening: 0, ...parts });

test("kcal bar: under the goal says how many are left, with the goal drawn inside the bar", () => {
  const html = kcalBarHtml(day(1500, { morning: 500, afternoon: 1000 }), 2000);
  assert.match(html, /us-kgoal/);
  assert.doesNotMatch(html, /is-over/);
  assert.match(html, /<b>500<\/b> left/); // 2000 - 1500
  assert.equal((html.match(/class="us-kseg"/g) || []).length, 2); // morning + afternoon
});

test("kcal bar: over the goal adds a red segment past the line and says by how much", () => {
  const html = kcalBarHtml(day(2300, { evening: 2300 }), 2000);
  assert.match(html, /us-kseg is-over/);
  assert.match(html, /\+<b>300<\/b> over/);
  // however far over, the bar never runs past its track
  const huge = kcalBarHtml(day(9000), 2000);
  const w = Number(huge.match(/is-over" style="left:80%;width:([\d.]+)%/)[1]);
  assert.ok(w <= 20);
});

test("week chart: missing days are empty slots, over days stack red, near-goal days get a ring", () => {
  const today = startOfDay(Date.now());
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, -i)).map((ts) => ({ ts, key: localDateString(ts) }));
  const p = {
    owner: "sam", name: "Sam", goals: { calories: 2000 },
    days: { [days[0].key]: day(2050), [days[1].key]: day(2600), [days[2].key]: day(1200) },
  };
  const html = weekChartHtml(p, 0, days);
  assert.equal((html.match(/us-wcol is-missing/g) || []).length, 4);
  assert.equal((html.match(/class="us-wover"/g) || []).length, 2); // 2,600 and 2,050 (near, but still a little over)
  assert.equal((html.match(/us-wcol is-near/g) || []).length, 1);
  assert.match(html, /us-wgoal/);
});

test("nutrients card: limits show a tick and turn over when passed; goals just fill", () => {
  const targets = microTargets({ targetCalories: 2000 });
  const html = nutrientsStripHtml({ totals: { sodiumMg: 2900, addedSugarG: 10, satFatG: null, fiberG: 14, potassiumMg: 1000 }, targets, meals: 2, missing: 0 });
  assert.equal((html.match(/ns-item/g) || []).length, 5);
  assert.equal((html.match(/is-over/g) || []).length, 1); // sodium only
  assert.equal((html.match(/ns-tick/g) || []).length, 3); // sodium, sugar, sat fat
  assert.match(html, /<b>—<\/b>/); // unknown stays unknown
});
