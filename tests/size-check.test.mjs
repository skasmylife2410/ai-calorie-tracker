// size-check.test.mjs — rich food in a photo with nothing to show its size asks for one more photo.
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
const { richKcal, needsSizeCheck, metaFields } = await import("../js/queue.js");
const { mealMeta } = await import("../api/gemini.js");

const it = (name, gramsEstimate, calories) => ({ name, gramsEstimate, calories });
const photo = { analysisMode: "meal" };

test("rich food: 300+ kcal per 100 g, or 220+ when it's a sweet/fried/cheesy dish; cooking oil aside", () => {
  assert.equal(richKcal([it("glazed donut", 70, 300), it("black coffee", 240, 5)]), 300);
  assert.equal(richKcal([it("fried chicken", 150, 375)]), 375); // 250/100 g and fried
  assert.equal(richKcal([it("grilled chicken breast", 150, 248)]), 0);
  assert.equal(richKcal([it("cooking oil", 10, 88)]), 0);
});

test("asks only for a meal photo of rich food with no clear size reference, once", () => {
  const cake = [it("chocolate cake", 120, 470)];
  assert.equal(needsSizeCheck(photo, { sizeReference: "none" }, cake), true);
  assert.equal(needsSizeCheck(photo, { sizeReference: "weak" }, cake), true);
  assert.equal(needsSizeCheck(photo, { sizeReference: "clear" }, cake), false, "a fork or hand already in frame");
  assert.equal(needsSizeCheck({ analysisMode: "text" }, {}, cake), false, "typed meals have no photo to fix");
  assert.equal(needsSizeCheck({ ...photo, sizeChecked: true }, { sizeReference: "none" }, cake), false);
  assert.equal(needsSizeCheck(photo, { sizeReference: "none" }, [it("cookie", 15, 75)]), false, "too small to matter");
});

test("questions come first; the size photo waits for them", () => {
  const cake = [it("chocolate cake", 120, 470)];
  const unsure = metaFields(photo, { confidence: 0.4, questions: [{ question: "What filling?", options: ["Cream", "Jam"] }], sizeReference: "none" }, cake);
  assert.equal(unsure.analysisSizeCheck, null);
  const sure = metaFields(photo, { confidence: 0.7, questions: [], sizeReference: "none" }, cake);
  assert.equal(sure.analysisSizeCheck, 470);
});

test("the server passes the size reference through, and only known values", () => {
  assert.equal(mealMeta({ confidence: 0.7, questions: [], size_reference: "none" }).sizeReference, "none");
  assert.equal(mealMeta({ confidence: 0.7, questions: [], size_reference: "huge" }).sizeReference, null);
});
