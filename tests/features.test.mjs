// features.test.mjs — servings multiplier, favourites, exercise entries and the 60% credit.
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
const { EXERCISE_CREDIT_RATIO, exerciseCredit, estimateCaloriesBurned } = await import("../js/nutrition.js");

const PROFILE = { weightKg: 80, heightCm: 178, age: 35, sex: "male", activityLevel: "moderate", targetDeltaKcal: 0, customTargetKcal: 2000 };

// --- servings ---------------------------------------------------------------

test("servings rescale an entry from its one-serving base without drift", () => {
  localStorage.clear();
  const e = store.addFoodEntry({ name: "Bowl", calories: 572, proteinG: 52, carbsG: 44, fatG: 18 });
  assert.equal(e.servings, 1);
  assert.deepEqual(e.base, { calories: 572, proteinG: 52, carbsG: 44, fatG: 18 });

  const two = store.setServings(e.id, 2);
  assert.equal(two.calories, 1144);
  assert.equal(two.proteinG, 104);
  // back down again returns to the exact original numbers — no accumulated rounding
  const half = store.setServings(e.id, 0.5);
  assert.equal(half.calories, 286);
  const one = store.setServings(e.id, 1);
  assert.equal(one.calories, 572);
  assert.equal(one.proteinG, 52);
});

test("servings are clamped to 0.5-step values in a sane range", () => {
  assert.equal(store.normalizeServings(0), 1);
  assert.equal(store.normalizeServings(-3), 1);
  assert.equal(store.normalizeServings("2.3"), 2.5);
  assert.equal(store.normalizeServings(999), 20);
});

test("day totals count the multiplied macros, so the ring reflects ×2", () => {
  localStorage.clear();
  const e = store.addFoodEntry({ name: "Bowl", calories: 500, proteinG: 40, carbsG: 30, fatG: 10 });
  store.setServings(e.id, 2);
  assert.equal(store.totalsForDay().calories, 1000);
});

test("entries saved before servings existed still rescale correctly", () => {
  localStorage.clear();
  // simulate a legacy row: no `base`, no `servings`
  localStorage.setItem("snapcal.foodEntries", JSON.stringify([
    { id: "old", name: "Legacy", calories: 300, proteinG: 20, carbsG: 30, fatG: 10, timestamp: Date.now(), updatedAt: Date.now() },
  ]));
  const updated = store.setServings("old", 3);
  assert.equal(updated.calories, 900);
  assert.equal(updated.proteinG, 60);
});

// --- favourites -------------------------------------------------------------

test("hearting an entry saves ONE serving, and logging it applies the multiplier", () => {
  localStorage.clear();
  const e = store.addFoodEntry({ name: "Arepa con queso", calories: 310, proteinG: 11, carbsG: 30, fatG: 14 });
  store.setServings(e.id, 2); // hearted while showing ×2 — the favourite must still store 1 serving
  assert.equal(store.toggleFavorite(e.id), true);

  const fav = store.allSavedFoods()[0];
  assert.equal(fav.calories, 310);
  assert.equal(fav.name, "Arepa con queso");

  const logged = store.logSavedFood(fav.id, { servings: 2 });
  assert.equal(logged.calories, 620);
  assert.equal(logged.servings, 2);
  assert.equal(logged.analysisItems, null, "logging a favourite must not open the AI results screen");
});

test("the heart toggles off and reports its state", () => {
  localStorage.clear();
  const e = store.addFoodEntry({ name: "Café con leche", calories: 140 });
  assert.equal(store.isFavorited(e), false);
  store.toggleFavorite(e.id);
  assert.equal(store.isFavorited(e), true);
  assert.equal(store.toggleFavorite(e.id), false);
  assert.equal(store.allSavedFoods().length, 0);
});

// --- exercise ---------------------------------------------------------------

test("burn is estimated from MET, intensity, weight and duration", () => {
  // soccer MET 7.0 x hard 1.3 x 80kg x 0.75h = 546
  assert.equal(estimateCaloriesBurned({ activity: "soccer", minutes: 45, intensity: "hard", weightKg: 80 }), 546);
  // unknown activity falls back to "other" (MET 5.0); no weight falls back to 70kg
  assert.equal(estimateCaloriesBurned({ activity: "quidditch", minutes: 60, intensity: "moderate" }), 350);
  assert.equal(estimateCaloriesBurned({ activity: "run", minutes: 0 }), 0);
});

test("only 60% of burned calories are credited to the budget", () => {
  assert.equal(EXERCISE_CREDIT_RATIO, 0.6);
  assert.equal(exerciseCredit(430), 258);
  assert.equal(exerciseCredit(0), 0);
  assert.equal(exerciseCredit(-100), 0);
});

test("dayEnergy reports the full burn and the credited share separately", () => {
  localStorage.clear();
  store.setProfile(PROFILE);
  store.addFoodEntry({ name: "Lunch", calories: 800 });
  store.addExerciseEntry({ name: "Soccer", activity: "soccer", minutes: 45, intensity: "moderate" });

  const day = store.dayEnergy();
  assert.equal(day.baseTarget, 2000);
  assert.equal(day.burned, 420); // 7.0 x 1.0 x 80 x 0.75
  assert.equal(day.credit, 252); // 60%
  assert.equal(day.adjustedTarget, 2252);
  assert.equal(day.eaten, 800);
  assert.equal(day.remaining, 1452);
});

test("exercise entries are per day and can be removed", () => {
  localStorage.clear();
  store.setProfile(PROFILE);
  const yesterday = Date.now() - 24 * 60 * 60 * 1000;
  store.addExerciseEntry({ name: "Walk", activity: "walk", minutes: 30, timestamp: yesterday });
  const today = store.addExerciseEntry({ name: "Gym", activity: "gym", minutes: 60 });
  assert.equal(store.exerciseForDay().length, 1);
  assert.equal(store.exerciseForDay()[0].name, "Gym");
  assert.equal(store.deleteExerciseEntry(today.id), true);
  assert.equal(store.exerciseForDay().length, 0);
  assert.equal(store.dayEnergy().credit, 0);
});

// --- sync: the new record types round-trip ----------------------------------

test("push payload carries exercise and favourites, filtered by dirty time", async () => {
  localStorage.clear();
  const sync = await import("../js/sync.js");
  store.setProfile(PROFILE);
  const e = store.addFoodEntry({ name: "Bowl", calories: 500 });
  store.toggleFavorite(e.id);
  store.addExerciseEntry({ name: "Gym", activity: "gym", minutes: 60 });

  const payload = sync.buildPushPayload(0);
  assert.equal(payload.exercise.length, 1);
  assert.equal(payload.favorites.length, 1);
  assert.equal(payload.exercise[0].data.activity, "gym");
  assert.equal(payload.favorites[0].data.name, "Bowl");
  assert.ok(payload.exercise[0].day.match(/^\d{4}-\d{2}-\d{2}$/));

  // nothing is dirty "since now"
  const later = sync.buildPushPayload(Date.now() + 1000);
  assert.equal(later.exercise.length, 0);
  assert.equal(later.favorites.length, 0);
});

test("remote rows merge last-write-wins and never clobber newer local edits", () => {
  localStorage.clear();
  const local = store.addExerciseEntry({ name: "Local run", activity: "run", minutes: 30 });

  // older remote copy is ignored
  store.applyRemoteExercise({ ...local, name: "Stale" }, (local.updatedAt ?? Date.now()) - 5000);
  assert.equal(store.allExerciseEntries()[0].name, "Local run");

  // newer remote copy wins
  store.applyRemoteExercise({ ...local, name: "From her phone" }, Date.now() + 5000);
  assert.equal(store.allExerciseEntries()[0].name, "From her phone");

  // a brand-new remote row is added
  store.applyRemoteExercise({ id: "remote-1", name: "Her swim", activity: "swim", minutes: 40, caloriesBurned: 300, timestamp: Date.now() }, Date.now());
  assert.equal(store.allExerciseEntries().length, 2);

  // junk is ignored rather than stored
  store.applyRemoteExercise(null, Date.now());
  store.applyRemoteExercise({ noId: true }, Date.now());
  assert.equal(store.allExerciseEntries().length, 2);
});

test("remote favourites merge the same way", () => {
  localStorage.clear();
  store.applyRemoteFavorite({ id: "f1", name: "Her arepa", calories: 310, favorite: true, createdAt: Date.now() }, Date.now());
  assert.equal(store.allSavedFoods().length, 1);
  store.applyRemoteFavorite({ id: "f1", name: "Renamed", calories: 310, favorite: true }, Date.now() + 1000);
  assert.equal(store.allSavedFoods()[0].name, "Renamed");
  store.applyRemoteFavorite({ id: "f1", name: "Older", calories: 310 }, 1);
  assert.equal(store.allSavedFoods()[0].name, "Renamed");
});

// --- doodle ------------------------------------------------------------------

test("doodle reflects the day: strong, well fed, or idle after two silent days", async () => {
  const { doodleState, daysSinceLastLog, growth } = await import("../js/ui/doodle.js");
  localStorage.clear();
  store.setProfile(PROFILE); // 2000 kcal target

  // nothing at all -> idle (no logs is the same as not logging)
  assert.equal(doodleState().state, "idle");

  // a normal day inside the goal -> strong
  store.addFoodEntry({ name: "Lunch", calories: 800 });
  assert.equal(doodleState().state, "strong");
  assert.equal(daysSinceLastLog(), 0);

  // over the goal -> well fed
  store.addFoodEntry({ name: "Big dinner", calories: 1500 });
  assert.equal(doodleState().state, "wellFed");

  // exercise credit can pull a day back under, since the budget itself grew
  store.addExerciseEntry({ name: "Run", activity: "run", minutes: 60, intensity: "hard" });
  assert.equal(doodleState().state, "strong");
});

test("two days of silence flips the doodle to idle", async () => {
  const { doodleState } = await import("../js/ui/doodle.js");
  localStorage.clear();
  store.setProfile(PROFILE);
  store.addFoodEntry({ name: "Old lunch", calories: 500, timestamp: Date.now() - 3 * 24 * 60 * 60 * 1000 });
  const out = doodleState();
  assert.equal(out.state, "idle");
  assert.equal(out.daysSinceLog, 3);
});

test("growth is clamped and drives the strong pose", async () => {
  const { growth, doodleSvg } = await import("../js/ui/doodle.js");
  assert.equal(growth(0), 0);
  assert.equal(growth(7), 1);
  assert.equal(growth(99), 1);
  assert.equal(growth(-5), 0);
  assert.equal(growth("bad"), 0);

  const small = doodleSvg({ state: "strong", streak: 0 });
  const big = doodleSvg({ state: "strong", streak: 14 });
  assert.notEqual(small, big, "a long streak must look different from none");
  assert.match(doodleSvg({ state: "idle" }), /ellipse/);
  assert.match(doodleSvg({ state: "wellFed" }), /svg/);
  // unknown states fall back to the strong pose rather than rendering nothing
  assert.match(doodleSvg({ state: "nonsense" }), /<svg/);
});

// --- amount (grams / ml) -----------------------------------------------------

test("an entry keeps how much was eaten, and rejects nonsense amounts", () => {
  localStorage.clear();
  const e = store.addFoodEntry({ name: "Arepa", calories: 310, amount: 120, amountUnit: "g" });
  assert.equal(e.amount, 120);
  assert.equal(e.amountUnit, "g");
  assert.equal(store.getFoodEntry(e.id).amount, 120, "survives the round trip through storage");

  const bad = store.addFoodEntry({ name: "X", calories: 1, amount: -5, amountUnit: "cups" });
  assert.equal(bad.amount, null);
  assert.equal(bad.amountUnit, null);

  const updated = store.updateFoodEntry(e.id, { amount: 240, amountUnit: "g", calories: 620 });
  assert.equal(updated.amount, 240);
});

// --- daily myths --------------------------------------------------------------

test("100 myths, complete in both languages, and one per day rotating", async () => {
  const { MYTHS, mythForDay } = await import("../js/myths.js");
  assert.equal(MYTHS.length, 100);
  const ids = new Set(MYTHS.map((m) => m.id));
  assert.equal(ids.size, 100, "ids are unique");
  for (const m of MYTHS) {
    for (const lang of ["en", "es"]) {
      assert.ok(m[lang].myth.length > 10, `myth ${m.id} ${lang} claim`);
      assert.ok(m[lang].truth.length > 40, `myth ${m.id} ${lang} answer`);
    }
    assert.ok(["body", "nutrition", "training", "diets", "supplements"].includes(m.cat));
  }
  // same day -> same myth; next day -> a different one; wraps after 100 days
  const d = new Date(2026, 8, 21);
  assert.equal(mythForDay(d).id, mythForDay(new Date(2026, 8, 21, 23, 59)).id);
  assert.notEqual(mythForDay(d).id, mythForDay(new Date(2026, 8, 22)).id);
  assert.equal(mythForDay(d).id, mythForDay(new Date(d.getTime() + 100 * 86400000)).id);
  // a week never repeats a category three days running
  for (let i = 0; i < 98; i++) {
    const a = mythForDay(new Date(d.getTime() + i * 86400000)).cat;
    const b = mythForDay(new Date(d.getTime() + (i + 1) * 86400000)).cat;
    const c = mythForDay(new Date(d.getTime() + (i + 2) * 86400000)).cat;
    assert.ok(!(a === b && b === c), `three ${a} myths in a row starting day ${i}`);
  }
});

// --- doodle messages ------------------------------------------------------------

test("doodle messages are personal, match the doodle, and hold for 12 hours", async () => {
  const { doodleMessage, _MESSAGES_FOR_TESTS } = await import("../js/ui/doodle-messages.js");
  const base = { name: "Baby", variant: "b", state: "strong", streak: 4, eaten: 1200, target: 1650, remaining: 450,
    proteinLeft: 30, proteinHit: false, meals: 2, exerciseMin: 40, burned: 300, weightDelta30: -1, goalLeft: 2, hour: 16, daysSinceLog: 0 };
  const t0 = Date.UTC(2026, 8, 21, 0, 30);

  // every message renders in both languages without throwing or leaking a template
  for (const m of _MESSAGES_FOR_TESTS) {
    for (const lang of ["en", "es"]) {
      const text = m[lang]({ ...base, he: "she", He: "She", him: "her", el: "ella", El: "Ella", state: m.state }, lang);
      assert.ok(text.length > 10 && !text.includes("undefined") && !text.includes("${"), `${lang}: ${text}`);
    }
  }
  // same 12h window -> same message; a later window can change it
  const a = doodleMessage(base, { lang: "en", username: "baby", now: t0 });
  assert.equal(a, doodleMessage(base, { lang: "en", username: "baby", now: t0 + 11 * 3600e3 }));
  // her doodle is "she"; his is "he"
  const all = Array.from({ length: 30 }, (_, i) => doodleMessage(base, { lang: "en", username: "baby", now: t0 + i * 12 * 3600e3 })).join(" ");
  assert.ok(!/\bhe's\b|\bHe's\b|\bhim\b/.test(all), "her doodle must never be called he/him");
  const allEs = Array.from({ length: 30 }, (_, i) => doodleMessage(base, { lang: "es", username: "baby", now: t0 + i * 12 * 3600e3 })).join(" ");
  assert.ok(!/\bél\b|\bÉl\b/.test(allEs), "her doodle must never be called él");
  // the person's name appears
  assert.match(a, /Baby/);
  // different people get different messages in the same window more often than not
  const differ = Array.from({ length: 20 }, (_, i) =>
    doodleMessage(base, { username: "aelson", now: t0 + i * 12 * 3600e3 }) !==
    doodleMessage(base, { username: "baby", now: t0 + i * 12 * 3600e3 })).filter(Boolean).length;
  assert.ok(differ >= 8, `people should mostly see different messages (${differ}/20)`);
});
