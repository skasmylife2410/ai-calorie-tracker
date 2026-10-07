// streak.test.mjs — streaks with freezes and milestones, the evening reminder, the Us board count.
import test from "node:test";
import assert from "node:assert/strict";

const { streakFromDays, nextStreakState, addDayKey, nextMilestone, MAX_FREEZES } = await import("../js/nutrition.js");
const { streaksAtRisk } = await import("../api/weekly.js");

const run = (from, n) => Array.from({ length: n }, (_, i) => addDayKey(from, i));

test("days in a row, counting from yesterday while today is still empty", () => {
  const days = run("2026-10-01", 7); // 1st–7th
  assert.equal(streakFromDays(days, [], "2026-10-07"), 7);
  assert.equal(streakFromDays(days, [], "2026-10-08"), 7, "the morning after: not lost yet");
  assert.equal(streakFromDays(days, [], "2026-10-09"), 0, "a whole day missed");
  assert.equal(streakFromDays(days, ["2026-10-08"], "2026-10-09"), 8, "a frozen day counts");
});

test("7 days earn a freeze; a missed day uses it automatically; nothing to rebuild an old run", () => {
  let r = nextStreakState({}, run("2026-10-01", 7), "2026-10-07");
  assert.equal(r.streak, 7);
  assert.equal(r.state.freezes, 1);
  assert.equal(r.earned, 1);
  assert.equal(r.milestone, 7);
  // the 8th is missed; on the 9th the freeze covers it
  r = nextStreakState(r.state, run("2026-10-01", 7), "2026-10-09");
  assert.deepEqual(r.used, ["2026-10-08"]);
  assert.equal(r.state.freezes, 0);
  assert.equal(r.streak, 8);
  // no freeze left: missing two more days ends it
  r = nextStreakState(r.state, run("2026-10-01", 7), "2026-10-12");
  assert.equal(r.streak, 0);
  assert.deepEqual(r.used, []);
});

test("freezes are capped and the best streak is kept", () => {
  const r = nextStreakState({}, run("2026-09-01", 30), "2026-09-30");
  assert.equal(r.state.freezes, MAX_FREEZES);
  assert.equal(r.state.best, 30);
  const later = nextStreakState(r.state, run("2026-09-01", 30), "2026-10-20");
  assert.equal(later.streak, 0);
  assert.equal(later.state.best, 30);
  assert.equal(nextMilestone(30), 50);
});

test("a milestone is reported until it's been shown", () => {
  const r = nextStreakState({ celebrated: 3 }, run("2026-10-01", 7), "2026-10-07");
  assert.equal(r.milestone, 7);
  assert.equal(r.state.celebrated, 3, "the app marks it seen once shown");
  assert.equal(nextStreakState({ ...r.state, celebrated: 7 }, run("2026-10-01", 7), "2026-10-07").milestone, null);
});

test("evening reminder: only streaks of 2+ with nothing logged today", () => {
  const rows = [
    ...run("2026-10-01", 6).map((day) => ({ owner: "ana", day })),          // 6 days up to yesterday
    ...run("2026-10-01", 7).map((day) => ({ owner: "leo", day })),          // logged today already
    { owner: "mia", day: "2026-10-06" },                                     // 1 day: not a streak yet
  ];
  const profiles = [{ owner: "ana", name: "Ana", streak: { freezes: 1 } }, { owner: "leo" }, { owner: "mia" }, { owner: "sol" }];
  assert.deepEqual(streaksAtRisk({ rows, profiles, today: "2026-10-07" }), [{ owner: "ana", name: "Ana", streak: 6, freezes: 1 }]);
});
