import test from "node:test";
import assert from "node:assert/strict";
import { summarizeWeek, candidateMeals, cleanRecap, weekWindow, localWeekday, buildPrompt } from "../api/_week.js";
import { trayItemFromProduct, withAmount, trayTotals, trayToEntry, mealName, baseOf } from "../js/meal-builder.js";

const meal = (id, day, hourUtc, name, calories, protein_g) => ({ id, day, logged_at: `${day}T${String(hourUtc).padStart(2, "0")}:00:00Z`, name, calories, protein_g });

test("week window is the 7 days ending yesterday, in Chicago time", () => {
  // Friday 2026-09-25 09:00 Chicago = 14:00 UTC
  const now = new Date("2026-09-25T14:00:00Z");
  assert.equal(localWeekday(now), 5);
  assert.deepEqual(weekWindow(now), { start: "2026-09-18", end: "2026-09-24", today: "2026-09-25" });
  // 03:00 UTC Saturday is still Friday evening in Chicago
  assert.equal(localWeekday(new Date("2026-09-26T03:00:00Z")), 5);
});

test("summary: averages, days over target, evening share, weight change", () => {
  const meals = [
    meal("a", "2026-09-18", 13, "Arepa", 500, 20), meal("b", "2026-09-18", 1, "Pizza", 1600, 40), // 1:00 UTC = 8pm Chicago
    meal("c", "2026-09-19", 18, "Salad", 600, 30),
    meal("d", "2026-09-20", 18, "Bowl", 1800, 90),
  ];
  const s = summarizeWeek({
    meals, goals: { calories: 1900, proteinG: 120 }, profile: { targetDeltaKcal: -400 },
    weights: [{ day: "2026-09-24", data: { kg: 80.2 } }, { day: "2026-09-18", data: { kg: 81 } }],
    exercise: [{ day: "2026-09-19", data: { minutes: 30, caloriesBurned: 200 } }],
  });
  assert.equal(s.daysLogged, 3);
  assert.equal(s.enough, true);
  assert.equal(s.avgCalories, Math.round((2100 + 600 + 1800) / 3));
  assert.deepEqual(s.daysOver, ["2026-09-18"]); // 1800 is within the 10% allowance
  assert.equal(s.eveningShare, Math.round(1600 / 4500 * 100));
  assert.equal(s.weightChangeKg, -0.8);
  assert.equal(s.goal, "lose");
  assert.equal(s.exerciseMin, 30);
  assert.equal(s.daysUnderProtein, 3);
});

test("fewer than 3 logged days is not enough to advise on", () => {
  const s = summarizeWeek({ meals: [meal("a", "2026-09-18", 13, "x", 500, 20)] });
  assert.equal(s.enough, false);
});

test("the model only sees names and numbers, and can only point at real meals", () => {
  const meals = [meal("id-1", "2026-09-18", 13, "Arepa", 500, 20), meal("id-2", "2026-09-19", 13, "Pizza", 1600, 40)];
  const c = candidateMeals(meals);
  assert.equal(c[0].ref, "m1");
  assert.equal(c[0].id, "id-2"); // biggest first
  const prompt = buildPrompt({ name: "Aelson", language: "es", stats: summarizeWeek({ meals }), candidates: c });
  assert.ok(!prompt.includes("id-1") && !prompt.includes("data:image"));
  assert.match(prompt, /Spanish/);
  const out = cleanRecap({ headline: "Good week", tips: [
    { title: "Halve the pizza", body: "Two slices, not four.", mealRefs: ["m1", "m99", "<script>"] },
    { title: "", body: "dropped" },
    { title: "a", body: "b", mealRefs: [] }, { title: "c", body: "d" }, { title: "e", body: "f" },
  ] }, c);
  assert.equal(out.tips.length, 2); // max 3 considered, the empty one dropped
  assert.deepEqual(out.tips[0].meals.map((m) => m.id), ["id-2"]);
});

test("plate: per-100 g foods start at 100 g and scale", () => {
  const rice = trayItemFromProduct({ name: "Arroz blanco cocido", calories: 130, proteinG: 2.7, carbsG: 28, fatG: 0.3, servingDescription: "per 100 g" });
  const egg = trayItemFromProduct({ name: "Huevo entero", calories: 143, proteinG: 13, carbsG: 0.7, fatG: 9.5, servingDescription: "per 100 g" });
  const more = withAmount(rice, 150);
  assert.equal(trayTotals([more, egg]).calories, 195 + 143);
  const entry = trayToEntry([more, egg], 123);
  assert.equal(entry.name, "Arroz blanco cocido & Huevo entero");
  assert.equal(entry.analysisItems.length, 2);
  assert.equal(entry.analysisItems[0].gramsEstimate, 150);
  assert.equal(entry.timestamp, 123);
  assert.equal(entry.calories, 338);
});

test("plate: servings, bounds and names", () => {
  assert.deepEqual(baseOf({ servingDescription: "per serving (30 g)" }), { amount: 30, unit: "g" });
  assert.deepEqual(baseOf({ servingDescription: "1 bar" }), { amount: 1, unit: "serving" });
  const bar = trayItemFromProduct({ name: "Bar", calories: 200, servingDescription: "1 bar" });
  assert.equal(withAmount(bar, 0).amount, 0.5); // never below one step
  assert.equal(mealName([{ name: "A" }, { name: "B" }, { name: "C" }, { name: "D" }]), "A, B +2");
});
