// ai-repair.test.mjs — while the AI is under repair (Google answers 402), a logged meal is kept,
// photo and all, as "waiting", and analysed by itself once the AI is back.
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

let repaired = false;
let calls = 0;
let refuseOnce = false;
globalThis.fetch = async (url) => {
  if (String(url).includes("/api/gemini")) {
    calls += 1;
    const ok = repaired && !refuseOnce;
    refuseOnce = false;
    return ok
      ? { ok: true, status: 200, json: async () => ({ items: [{ name: "eggs", calories: 280, proteinG: 24, carbsG: 2, fatG: 20, confidence: 0.8 }] }) }
      : { ok: true, status: 200, json: async () => ({ errorType: "paused", message: "AI analysis is under repair. Try again a little later, or add the meal manually." }) };
  }
  throw new TypeError("offline");
};

const store = await import("../js/store.js");
const queue = await import("../js/queue.js");
const settle = (entryId) => new Promise((resolve) => { const stop = queue.onComplete((p) => { if (p.entryId === entryId) { stop(); resolve(p); } }); });

test("a meal logged during the repair waits, and goes through once the AI is back", async () => {
  const first = queue.enqueuePhoto("data:image/jpeg;base64,AAAA", "meal");
  await settle(first.id);
  const second = queue.enqueueText("4 eggs");
  await settle(second.id);
  for (const id of [first.id, second.id]) {
    const e = store.getFoodEntry(id);
    assert.equal(e.analysisWaiting, true, "kept, waiting for the AI");
    assert.equal(e.analysisFailed, true);
  }
  assert.equal(store.getFoodEntry(first.id).photoDataUrl, "data:image/jpeg;base64,AAAA", "the photo is kept");
  assert.equal(queue.waitingEntries().length, 2);

  // still under repair: the oldest is tried (with its one quiet second try), then it stops until
  // the next time
  calls = 0;
  await queue.retryWaiting();
  assert.equal(calls, 2);
  assert.equal(queue.waitingEntries().length, 2);

  repaired = true;
  await queue.retryWaiting();
  assert.equal(queue.waitingEntries().length, 0, "both analysed");
  const done = store.getFoodEntry(second.id);
  assert.equal(done.analysisFailed, false);
  assert.equal(done.calories, 280);
  assert.equal(done.analysisWaiting ?? null, null);
});

test("meals that failed on the payment refusal before the app knew to keep them count as waiting too", async () => {
  const { isWaitingForAi } = queue;
  const failed = (reason, extra = {}) => ({ analysisFailed: true, analysisFailureReason: reason, ...extra });
  assert.equal(isWaitingForAi(failed("Gemini HTTP 402")), true, "an older 402");
  assert.equal(isWaitingForAi(failed("AI analysis is under repair. Try again a little later.")), true);
  assert.equal(isWaitingForAi(failed("x", { analysisWaiting: true })), true);
  assert.equal(isWaitingForAi(failed("Couldn't find any food in that description — try adding more detail.")), false, "a real mistake is not waiting");
  assert.equal(isWaitingForAi({ analysisFailed: false, analysisFailureReason: "Gemini HTTP 402" }), false, "a meal that was since analysed");

  localStorage.clear();
  repaired = true;
  const old = store.addFoodEntry({
    name: "Analysis failed — tap to retry", calories: 0, proteinG: 0, carbsG: 0, fatG: 0, source: "text",
    isPending: false, analysisFailed: true, analysisMode: "text", analysisDescription: "4 eggs", analysisFailureReason: "Gemini HTTP 402",
  });
  assert.equal(queue.waitingEntries().length, 1);
  await queue.retryWaiting();
  const done = store.getFoodEntry(old.id);
  assert.equal(done.analysisFailed, false);
  assert.equal(done.calories, 280);
});

test("a single refusal is tried again quietly, and the meal is analysed instead of saved", async () => {
  localStorage.clear();
  repaired = true;
  refuseOnce = true;
  calls = 0;
  const entry = queue.enqueueText("4 eggs");
  const done = await settle(entry.id);
  assert.equal(done.success, true);
  assert.equal(calls, 2);
  const saved = store.getFoodEntry(entry.id);
  assert.equal(saved.analysisFailed, false);
  assert.equal(saved.analysisWaiting ?? null, null);
  assert.equal(queue.waitingEntries().length, 0);
});

test("once the oldest goes through, every other saved meal is analysed together", async () => {
  localStorage.clear();
  repaired = true;
  const saved = (d, at) => store.addFoodEntry({
    name: "Analysis failed — tap to retry", calories: 0, proteinG: 0, carbsG: 0, fatG: 0, source: "text", timestamp: at,
    isPending: false, analysisFailed: true, analysisWaiting: true, analysisMode: "text", analysisDescription: d,
    analysisFailureReason: "AI analysis is under repair. Try again a little later, or add the meal manually.",
  });
  const now = Date.now();
  const ids = [saved("4 eggs", now - 5000), saved("a banana", now - 4000), saved("rice", now - 3000), saved("beans", now - 2000)].map((e) => e.id);
  let inFlight = 0, most = 0;
  const off = store.subscribe(() => {
    inFlight = ids.filter((id) => store.getFoodEntry(id)?.isPending === true).length;
    most = Math.max(most, inFlight);
  });
  await queue.retryWaiting();
  off?.();
  assert.equal(queue.waitingEntries().length, 0);
  for (const id of ids) assert.equal(store.getFoodEntry(id).calories, 280);
  assert.equal(most, 3, "the three after the oldest ran at the same time");
});
