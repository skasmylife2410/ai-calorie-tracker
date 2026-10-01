// confidence.test.mjs — how sure a meal analysis is, asking only under 50%, and cooking fat.
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

const { mealMeta } = await import("../api/gemini.js");
const { cleanMeta } = await import("../js/api.js");
const { metaFields, averageConfidence, answersText } = await import("../js/queue.js");
const { applyCookingFat, fatGrams, isFatItem } = await import("../js/cooking-fat.js");

const q = [{ question: "What's inside the wrap?", options: ["Chicken", "Beans and cheese", "Eggs"] }];

test("the server only passes questions on when the analysis is under 50% sure", () => {
  assert.equal(mealMeta({ confidence: 0.42, questions: q, cooking_fat: "assumed" }).questions.length, 1);
  assert.equal(mealMeta({ confidence: 0.8, questions: q, cooking_fat: "visible" }).questions.length, 0);
  assert.equal(mealMeta({ confidence: 1.7, questions: [] }).confidence, 1);
  assert.equal(mealMeta({ items: [] }), null, "label photos and old answers have no overall confidence");
  const many = mealMeta({ confidence: 0.3, questions: [...q, ...q, ...q] });
  assert.equal(many.questions.length, 2, "never more than two questions");
  assert.equal(mealMeta({ confidence: 0.3, questions: [{ question: "x?", options: ["only one"] }] }).questions.length, 0, "a question needs answers to tap");
});

test("the app keeps questions only when unsure, and asks once", () => {
  const meta = cleanMeta({ confidence: 0.38, questions: q, cookingFat: "assumed" });
  assert.equal(metaFields({}, meta).analysisQuestions.length, 1);
  assert.equal(metaFields({ questionsAnswered: true }, meta).analysisQuestions, null, "after answering, never again");
  assert.equal(metaFields({}, cleanMeta({ confidence: 0.7, questions: q })).analysisQuestions, null);
  assert.equal(metaFields({}, meta).cookingFat, "assumed");
});

test("without an overall number, item confidence weighted by calories stands in", () => {
  assert.equal(averageConfidence([{ confidence: 0.9, calories: 100 }, { confidence: 0.3, calories: 300 }]), 0.45);
  assert.equal(averageConfidence([]), null);
});

test("answers go back to the AI as authoritative text", () => {
  const text = answersText(q, ["Beans and cheese"]);
  assert.match(text, /authoritative/);
  assert.match(text, /What's inside the wrap\? Beans and cheese/);
  assert.equal(answersText(q, [""]), "");
});

test("cooking fat: none removes the assumed oil, a little / a lot set a known amount", () => {
  const items = [{ name: "fried eggs", gramsEstimate: 100, calories: 196 }, { name: "cooking oil", gramsEstimate: 10, calories: 88 }];
  assert.equal(fatGrams(items), 10);
  assert.deepEqual(applyCookingFat(items, "none").map((i) => i.name), ["fried eggs"]);
  const lot = applyCookingFat(items, "lot");
  assert.equal(fatGrams(lot), 20);
  assert.equal(lot.find(isFatItem).calories, 177);
  assert.equal(applyCookingFat([{ name: "mantequilla", gramsEstimate: 8 }], "little").length, 1, "Spanish names count too");
});
