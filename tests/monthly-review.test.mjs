// monthly-review.test.mjs — the 30-day check-in: verdicts, self-adjusting targets, undo.
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

const store = await import("../js/store.js");
const { monthlyReview, targetDelta, REVIEW_MAX_STEP_KCAL } = await import("../js/nutrition.js");

const D = 86400000;
const NOW = Date.UTC(2026, 9, 6, 9);
/** Weigh-ins every 3 days for 30 days along a straight line (kg/week), with ±0.2 kg noise. */
const line = (startKg, kgPerWeek, { every = 3, days = 30 } = {}) => {
  const out = [];
  for (let d = days; d >= 0; d -= every) {
    const i = out.length;
    out.push({ t: NOW - d * D, kg: Math.round((startKg + ((days - d) / 7) * kgPerWeek + (i % 2 ? 0.2 : -0.2)) * 10) / 10 });
  }
  return out;
};
const LOSER = { weightKg: 90, heightCm: 178, age: 35, sex: "male", activityLevel: "moderate", goal: "lose", goalRate: "normal", targetDeltaKcal: targetDelta({ goal: "lose", rate: "normal", weightKg: 90 }) };

test("too few weigh-ins: asks for more instead of guessing", () => {
  const r = monthlyReview({ profile: LOSER, weights: line(90, -0.5).slice(0, 3), now: NOW });
  assert.equal(r.status, "needWeighIns");
  assert.equal(r.weighIns, 3);
  // four readings squeezed into one week aren't a month's trend either
  assert.equal(monthlyReview({ profile: LOSER, weights: line(90, -0.5, { every: 2, days: 6 }), now: NOW }).status, "needWeighIns");
});

test("on plan: weight follows the trend, deficit follows the weight, no extra step", () => {
  const planned = (LOSER.targetDeltaKcal * 7) / 7700; // about −0.54 kg a week
  const r = monthlyReview({ profile: LOSER, weights: line(90, planned), now: NOW });
  assert.equal(r.status, "ready");
  assert.equal(r.verdict, "onTrack");
  assert.equal(r.stepKcal, 0);
  assert.ok(r.endKg < 88 && r.endKg > 87, `trend weight ${r.endKg}`);
  assert.equal(r.patch.weightKg, r.endKg);
  // a lighter body: the same pace is a slightly smaller deficit
  assert.equal(r.patch.targetDeltaKcal, targetDelta({ goal: "lose", rate: "normal", weightKg: r.endKg }));
  assert.ok(r.patch.targetDeltaKcal > LOSER.targetDeltaKcal);
});

test("losing slower than planned: one capped step down; faster: one step up", () => {
  const slow = monthlyReview({ profile: LOSER, weights: line(90, 0), now: NOW });
  assert.equal(slow.verdict, "slower");
  assert.equal(slow.stepKcal, -REVIEW_MAX_STEP_KCAL);
  const fast = monthlyReview({ profile: LOSER, weights: line(90, -1.3), now: NOW });
  assert.equal(fast.verdict, "faster");
  assert.equal(fast.stepKcal, REVIEW_MAX_STEP_KCAL);
  const up = monthlyReview({ profile: LOSER, weights: line(90, 0.4), now: NOW });
  assert.equal(up.verdict, "gaining");
});

test("learned maintenance already corrects the pace, so the review doesn't add a second step", () => {
  const r = monthlyReview({ profile: LOSER, weights: line(90, 0), now: NOW, learnedOn: true });
  assert.equal(r.verdict, "slower");
  assert.equal(r.stepKcal, 0);
});

test("goal weight reached: the goal becomes maintain; close to it, fast eases to normal", () => {
  const reached = monthlyReview({ profile: { ...LOSER, goalWeightKg: 88 }, weights: line(90, -0.6), now: NOW });
  assert.equal(reached.reached, true);
  assert.equal(reached.patch.goal, "maintain");
  assert.equal(reached.patch.targetDeltaKcal, 0);

  const near = monthlyReview({ profile: { ...LOSER, goalRate: "fast", goalWeightKg: 86 }, weights: line(90, -0.6), now: NOW });
  assert.equal(near.reached, false);
  assert.equal(near.eased, true);
  assert.equal(near.patch.goalRate, "normal");
  assert.ok(near.weeksToGoal > 0 && near.weeksToGoal < 10, `eta ${near.weeksToGoal}`);
});

test("gaining: never turns into a deficit, surplus capped", () => {
  const gainer = { ...LOSER, goal: "gain", goalRate: "normal", targetDeltaKcal: targetDelta({ goal: "gain", rate: "normal", weightKg: 70 }), weightKg: 70 };
  const r = monthlyReview({ profile: gainer, weights: line(70, -0.3), now: NOW });
  assert.equal(r.verdict, "losing");
  assert.ok(r.patch.targetDeltaKcal > 0 && r.patch.targetDeltaKcal <= 500);
});

test("store: due a month after the first weigh-in, applies itself, can be undone", () => {
  localStorage.clear();
  store.setProfile({ ...LOSER, hasCompletedOnboarding: true });
  for (const w of line(90, 0)) store.addWeightEntry({ kg: w.kg, timestamp: w.t });
  assert.equal(store.reviewIsDue(NOW - 2 * D), false);
  assert.equal(store.reviewIsDue(NOW), true);

  const review = store.monthlyReviewNow({ now: NOW });
  const record = store.applyMonthlyReview(review, { now: NOW });
  const p = store.getProfile();
  assert.equal(p.weightKg, review.endKg);
  assert.equal(p.targetDeltaKcal, review.patch.targetDeltaKcal);
  assert.equal(p.lastReviewAt, NOW);
  assert.ok(record.to.calories < record.from.calories, "slower than planned: the target came down");
  assert.equal(store.reviewIsDue(NOW + D), false);
  assert.equal(store.reviewDueAt(), NOW + 30 * D);

  assert.equal(store.undoMonthlyReview(), true);
  const back = store.getProfile();
  assert.equal(back.weightKg, LOSER.weightKg);
  assert.equal(back.targetDeltaKcal, LOSER.targetDeltaKcal);
  assert.equal(back.lastReview.undone, true);
  assert.equal(store.undoMonthlyReview(), false, "only once");
  assert.equal(store.reviewIsDue(NOW + D), false, "undo doesn't make it due again");
});

test("store: not enough weigh-ins snoozes the check-in for a week", () => {
  localStorage.clear();
  store.setProfile({ ...LOSER, hasCompletedOnboarding: true });
  store.addWeightEntry({ kg: 90, timestamp: NOW - 31 * D });
  assert.equal(store.reviewIsDue(NOW), true);
  assert.equal(store.monthlyReviewNow({ now: NOW }).status, "needWeighIns");
  store.snoozeMonthlyReview({ now: NOW });
  assert.equal(store.reviewIsDue(NOW + 6 * D), false);
  assert.equal(store.reviewIsDue(NOW + 7 * D), true);
});
