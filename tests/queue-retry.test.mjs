// queue-retry.test.mjs — a lost connection during analysis retries instead of failing, and a
// meal cut off by the app closing is analysed again on the next open.
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

let geminiCalls = 0;
let failFirst = 0;
globalThis.fetch = async (url) => {
  if (String(url).includes("/api/gemini")) {
    geminiCalls += 1;
    if (geminiCalls <= failFirst) throw new TypeError("Failed to fetch");
    return { ok: true, status: 200, json: async () => ({ items: [{ name: "eggs", calories: 280, proteinG: 24, carbsG: 2, fatG: 20, confidence: 0.8 }] }) };
  }
  throw new TypeError("offline"); // grounding lookups: fail quietly, items stay as analysed
};

const store = await import("../js/store.js");
const queue = await import("../js/queue.js");

const settle = (entryId, ms = 12000) => new Promise((resolve, reject) => {
  const stop = queue.onComplete((p) => { if (p.entryId === entryId) { stop(); resolve(p); } });
  setTimeout(() => reject(new Error("no completion")), ms);
});

test("a dropped connection is retried and the meal still gets analysed", async () => {
  geminiCalls = 0; failFirst = 1;
  const entry = queue.enqueueText("4 eggs");
  const done = await settle(entry.id);
  assert.equal(done.success, true);
  assert.equal(geminiCalls, 2);
  const saved = store.getFoodEntry(entry.id);
  assert.equal(saved.isPending, false);
  assert.equal(saved.analysisFailed, false);
  assert.equal(saved.calories, 280);
});

test("reopening the app retries a meal that failed only on the connection, then stops", async () => {
  geminiCalls = 0; failFirst = 0;
  const failed = store.addFoodEntry({
    name: "Analysis failed — tap to retry", calories: 0, proteinG: 0, carbsG: 0, fatG: 0, source: "text",
    isPending: false, analysisFailed: true, analysisMode: "text", analysisDescription: "half a tortilla and 4 eggs",
    analysisFailureReason: "Gemini network error: Failed to fetch",
  });
  const otherFailure = store.addFoodEntry({
    name: "Analysis failed — tap to retry", calories: 0, proteinG: 0, carbsG: 0, fatG: 0, source: "text",
    isPending: false, analysisFailed: true, analysisMode: "text", analysisDescription: "asdf",
    analysisFailureReason: "Couldn't find any food in that description — try adding more detail.",
  });
  const done = settle(failed.id);
  queue.sweepIfNeeded();
  assert.equal((await done).success, true);
  assert.equal(store.getFoodEntry(failed.id).calories, 280);
  assert.equal(store.getFoodEntry(failed.id).autoRetries, 1);
  assert.equal(store.getFoodEntry(otherFailure.id).analysisFailed, true, "a real failure is left for the person");
  assert.equal(geminiCalls, 1);
});
