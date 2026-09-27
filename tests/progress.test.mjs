// progress.test.mjs — the Progress tab's measurements: per-day records, summaries, insights and
// the milestones it finds on its own.
import test from "node:test";
import assert from "node:assert/strict";

const P = await import("../js/progress.js");
const { startOfDay, addDays } = await import("../js/nutrition.js");

const NOW = new Date(2026, 8, 27, 18).getTime(); // Sunday evening, local time
const day = (n, h = 12) => addDays(startOfDay(NOW), -n) + h * 3600e3; // n days ago, at noon
const meal = (n, calories, proteinG = 0) => ({ timestamp: day(n), calories, proteinG });

test("each day knows if calories were on target (±10%), over or under, and if protein was hit", () => {
  const foods = [meal(0, 2000, 150), meal(1, 2400, 90), meal(2, 1500, 160), meal(2, 0, 0)];
  const days = P.buildDays({ days: 4, now: NOW, foods, calorieTarget: 2000, proteinTarget: 150 });
  assert.deepEqual(days.map((d) => d.calStatus), [null, "under", "over", "on"], "oldest first; day 3 had nothing logged");
  assert.deepEqual(days.map((d) => d.proteinHit), [null, true, false, true]);
  assert.equal(days[3].meals, 1);
  assert.equal(days.filter((d) => d.weekend).length, 2, "Saturday and Sunday are marked");
});

test("pending and failed photo analyses don't count", () => {
  const foods = [meal(0, 900), { ...meal(0, 5000), isPending: true }, { ...meal(0, 5000), analysisFailed: true }];
  const [d] = P.buildDays({ days: 1, now: NOW, foods, calorieTarget: 1000 });
  assert.equal(d.calories, 900);
  assert.equal(d.calStatus, "on");
});

test("summaries count on-target days, workouts and the weight change on the 7-day average", () => {
  const foods = [meal(0, 2000, 150), meal(1, 2000, 150), meal(2, 3000, 40)];
  const exercise = [{ timestamp: day(1), minutes: 30, caloriesBurned: 250 }, { timestamp: day(2), minutes: 45, caloriesBurned: 400 }];
  const weights = [0, 1, 2, 3].map((n) => ({ timestamp: day(n, 8), kg: 80 + n })); // 83 → 80 kg
  const s = P.summarize(P.buildDays({ days: 5, now: NOW, foods, exercise, weights, calorieTarget: 2000, proteinTarget: 150 }));
  assert.equal(s.daysLogged, 3);
  assert.equal(s.onTarget, 2);
  assert.equal(s.proteinHit, 2);
  assert.equal(s.workouts, 2);
  assert.equal(s.minutes, 75);
  assert.equal(s.weightDelta < 0, true, "the average went down");
});

test("weight direction depends on the goal", () => {
  assert.equal(P.weightDirection(-1.5, "lose"), 1);
  assert.equal(P.weightDirection(-1.5, "gain"), -1);
  assert.equal(P.weightDirection(0.1, "lose"), 0, "tiny moves are neutral");
  assert.equal(P.weightDirection(0.6, "maintain"), 1);
  assert.equal(P.weightDirection(2, "maintain"), -1);
});

test("insights put the biggest change first and only mention what moved", () => {
  const cur = { total: 30, daysLogged: 28, onTarget: 20, proteinHit: 10, workouts: 6, weightDelta: -2.1, weighIns: 12 };
  const prev = { total: 30, daysLogged: 27, onTarget: 9, proteinHit: 10, workouts: 6 };
  const out = P.insights({ cur, prev, goal: "lose", days: 30, weekendGap: { gap: 480 } });
  assert.equal(out.length, 3);
  assert.equal(out[0].key, "prog.in.weightDown", "a 2 kg drop while losing is the headline");
  assert.equal(out[0].tone, "good");
  assert.equal(out[1].key, "prog.in.onTargetUp");
  assert.equal(out[2].key, "prog.in.weekendMore");
  assert.equal(out[2].tone, "bad");
  assert.ok(!out.some((i) => i.key.startsWith("prog.in.protein")), "protein didn't change, so it isn't mentioned");
  assert.ok(!out.some((i) => i.key.startsWith("prog.in.workouts")));
});

test("milestones: streaks, meal and workout counts, a protein week", () => {
  const foods = [];
  for (let n = 14; n >= 0; n--) foods.push(meal(n, 500, 160), meal(n, 500, 0), meal(n, 500, 0), meal(n, 500, 0));
  const exercise = [{ timestamp: day(3), minutes: 20 }];
  const ms = P.milestones({ foods, exercise, proteinTarget: 150, now: NOW });
  const kinds = ms.map((m) => `${m.kind}:${m.vars.n ?? ""}`);
  assert.ok(kinds.includes("streak:7") && kinds.includes("streak:14"));
  assert.ok(kinds.includes("meals:50"));
  assert.ok(kinds.includes("workouts:1"));
  assert.ok(kinds.includes("proteinWeek:"));
  assert.ok(ms.every((m, i) => i === 0 || ms[i - 1].ts >= m.ts), "newest first");
});

test("milestones: each whole kg toward the goal, halfway and the goal itself, only in the right direction", () => {
  const kgs = [84.6, 84.2, 83.8, 83.1, 82.7, 82.0, 81.4, 80.9, 80.2, 79.6, 79.1, 78.8, 78.5, 78.2, 78.0, 77.9];
  const weights = kgs.map((kg, i) => ({ timestamp: day(kgs.length - i, 8), kg }));
  const ms = P.milestones({ weights, goal: "lose", goalKg: 81, now: NOW });
  const steps = ms.filter((m) => m.kind === "weightStep").map((m) => m.vars.kg).sort((a, b) => b - a);
  assert.deepEqual(steps, [84, 83, 82, 81], "whole kgs passed on the way down, not past the goal");
  assert.ok(ms.some((m) => m.kind === "halfway"));
  assert.ok(ms.some((m) => m.kind === "goal"));
  assert.deepEqual(P.milestones({ weights, goal: "gain", goalKg: 90, now: NOW }).filter((m) => m.kind === "weightStep"), [], "going down is no win when gaining");
});

test("the weekly rate uses the time the weigh-ins actually cover, not the whole range", () => {
  const weights = Array.from({ length: 9 }, (_, i) => ({ timestamp: day(56 - i * 7, 8), kg: 86 - i * 0.5 })); // 8 weeks, -4 kg
  const cur = P.summarize(P.buildDays({ days: 365, now: NOW, weights, calorieTarget: 2000 }));
  assert.equal(cur.weightDays, 56);
  const [w] = P.insights({ cur, prev: { daysLogged: 0 }, goal: "lose", days: 365 });
  assert.equal(w.key, "prog.in.weightDown");
  assert.equal(w.vars.days, 56, "says 56 days, not 365");
  assert.ok(w.vars.perWeek >= 0.3 && w.vars.perWeek <= 0.5, `about 0.4 kg a week, got ${w.vars.perWeek}`);
});
