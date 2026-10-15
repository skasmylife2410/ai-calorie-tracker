// weigh-prompt.test.mjs — Home's weigh-in line: when it shows, and what the check-in has so far.
import test from "node:test";
import assert from "node:assert/strict";

class Mem { constructor() { this.d = new Map(); } getItem(k) { return this.d.has(k) ? this.d.get(k) : null; } setItem(k, v) { this.d.set(k, String(v)); } removeItem(k) { this.d.delete(k); } clear() { this.d.clear(); } }
globalThis.localStorage = new Mem();
const store = await import("../js/store.js");
const DAY = 86400000;
const now = Date.parse("2026-10-15T15:00:00");
const weigh = (list) => localStorage.setItem("snapcal.weightEntries", JSON.stringify(list.map(([t, kg], i) => ({ id: `w${i}`, kg, timestamp: t, day: new Date(t).toISOString().slice(0, 10) }))));

test("never weighed in: the line asks, and says why", () => {
  localStorage.clear();
  assert.deepEqual(store.weighInPrompt(now), { kind: "never" });
  assert.equal(store.checkinWeighIns(now), null);
});

test("a week before the check-in: a countdown until today's weigh-in", () => {
  localStorage.clear();
  const first = Date.parse("2026-09-21T08:00:00");
  weigh([[first, 90], [first + 8 * DAY, 89.5], [now - DAY, 88.2]]);
  assert.deepEqual(store.weighInPrompt(now), { kind: "checkin", days: 6 });
  assert.deepEqual(store.checkinWeighIns(now), { have: 2, due: first + 30 * DAY, days: 6 }, "the first week's reading doesn't count");
  weigh([[first, 90], [now - 3600000, 88.1]]);
  assert.equal(store.weighInPrompt(now), null, "weighed in this morning");
});

test("no check-in near: only after three days without the scale", () => {
  localStorage.clear();
  weigh([[now - 2 * DAY, 88]]);
  assert.equal(store.weighInPrompt(now), null);
  weigh([[now - 4 * DAY, 88]]);
  assert.deepEqual(store.weighInPrompt(now), { kind: "gap", days: 4 });
});
