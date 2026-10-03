// pieces.test.mjs — counted foods ("two eggs") open in servings, not grams.
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

const { mapRawItemToAnalyzedItem, pieceCount } = await import("../js/api.js");

const raw = (extra) => ({ name: "egg", grams_estimate: 100, calories: 143, protein_g: 12.6, carbs_g: 0.7, fat_g: 9.5, confidence: 0.9, ...extra });

test("two eggs become 2 servings of one egg each", () => {
  const item = mapRawItemToAnalyzedItem(raw({ count: 2 }));
  assert.equal(item.unit, "serving");
  assert.equal(item.amount, 2);
  assert.equal(item.gramsPerServing, 50);
  assert.equal(item.gramsEstimate, 100);
  assert.equal(item.calories, 143); // nutrients still cover both eggs
});

test("uncounted foods stay in grams", () => {
  for (const count of [0, undefined, -1, "x", 500]) {
    const item = mapRawItemToAnalyzedItem(raw({ name: "white rice, cooked", count }));
    assert.equal(item.unit, undefined);
    assert.equal(item.amount, undefined);
  }
});

test("piece counts round to halves", () => {
  assert.equal(pieceCount({ count: 1.4 }), 1.5);
  assert.equal(pieceCount({ count: 3 }), 3);
  assert.equal(pieceCount({ count: 0.3 }), 0);
});
