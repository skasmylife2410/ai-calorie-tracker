// week-average.test.mjs — Home's 7-day average shows only for a fully logged week.
import test from "node:test";
import assert from "node:assert/strict";
import { weekAverage } from "../js/nutrition.js";

const day = (calories, meals = 3) => ({ calories, meals });

test("seven logged days: their average", () => {
  assert.equal(weekAverage([2300, 1980, 2240, 2050, 2420, 1890, 2090].map((c) => day(c)), 2263), 2139);
});

test("a day with nothing logged, or only half logged, hides it", () => {
  const week = [2300, 1980, 2240, 2050, 2420, 1890, 2090].map((c) => day(c));
  assert.equal(weekAverage([...week.slice(0, 6), day(0, 0)], 2263), null, "a day missed");
  assert.equal(weekAverage([...week.slice(0, 6), day(600, 1)], 2263), null, "breakfast only: under half the budget");
  assert.equal(weekAverage(week.slice(0, 6), 2263), null, "fewer than seven days");
});

test("protein average: every logged day counts, today only when it's the only one", async () => {
  const { proteinAverage } = await import("../js/nutrition.js");
  const days = [
    { key: "2026-10-11", meals: 2, calories: 494, proteinG: 25 }, // a short day still counts
    { key: "2026-10-12", meals: 3, calories: 1500, proteinG: 115 },
    null,
    { key: "2026-10-13", meals: 0, calories: 0, proteinG: 0 }, // nothing logged
    { key: "2026-10-14", meals: 1, calories: 300, proteinG: 10 }, // today, not over
  ];
  assert.equal(proteinAverage(days, { todayKey: "2026-10-14" }), 70);
  assert.equal(proteinAverage([days[4]], { todayKey: "2026-10-14" }), 10);
  assert.equal(proteinAverage([], {}), 0);
});
