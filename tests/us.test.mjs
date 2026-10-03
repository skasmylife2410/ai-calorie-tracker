// compare.test.mjs — read-only Together dashboard endpoint.
import test from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_x";
process.env.APP_USERS = "aelson:a1,maria:m2";

const seen = [];
globalThis.fetch = async (url) => {
  const u = new URL(url);
  seen.push(u);
  const table = u.pathname.split("/").pop();
  const data = {
    snapcal_food_entries: [
      // breakfast and dinner on the same day, so the morning/evening split is exercised
      { owner: "aelson", day: "2026-09-15", calories: 500.4, protein_g: 30, carbs_g: 50, fat_g: 10, ts: String(new Date("2026-09-15T08:30:00").getTime()) },
      { owner: "aelson", day: "2026-09-15", calories: 300, protein_g: null, carbs_g: 20, fat_g: 5, ts: String(new Date("2026-09-15T19:30:00").getTime()) },
      { owner: "maria", day: "2026-09-14", calories: 400, protein_g: 20, carbs_g: 40, fat_g: 12, ts: String(new Date("2026-09-14T13:00:00").getTime()) },
    ],
    snapcal_water: [{ owner: "maria", day: "2026-09-15", glasses: 4 }],
    // an old estimate (420) with no minutes is kept; with minutes it's recalculated for this person
    snapcal_exercise: [{ owner: "aelson", day: "2026-09-15", data: { caloriesBurned: 420, activity: "soccer" } }],
    snapcal_users: [{ username: "aelson" }, { username: "maria" }],
    // who appears on the dashboard now comes from group membership, not the account list
    snapcal_groups: [{ id: "home", name: "Home" }],
    snapcal_group_members: [{ group_id: "home", username: "aelson", joined_at: "1" }, { group_id: "home", username: "maria", joined_at: "2" }],
    snapcal_profile: [
      { owner: "aelson", data: { weightKg: 80, heightCm: 178, age: 35, sex: "male", activityLevel: "moderate", targetDeltaKcal: -500, customTargetKcal: 2000 } },
      { owner: "maria", data: { weightKg: 60, heightCm: 165, age: 30, sex: "female", activityLevel: "light", targetDeltaKcal: 0, customTargetKcal: null } },
    ],
  }[table];
  return { ok: true, json: async () => data };
};

const { default: compare } = await import("../api/compare.js");
const mockRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });

test("rejects unknown PIN", async () => {
  const res = mockRes();
  await compare({ method: "POST", headers: { "x-snapcal-token": "nope" }, body: {} }, res);
  assert.equal(res.code, 401);
});

test("returns daily totals and goals for both people, no private fields", async () => {
  seen.length = 0;
  const res = mockRes();
  await compare({ method: "POST", headers: { "x-snapcal-token": "m2" }, body: { from: "2026-09-09" } }, res);
  assert.equal(res.body.me, "maria");
  const [a, m] = res.body.people;
  assert.equal(a.owner, "aelson");
  // the same calories, also split by when they were eaten
  assert.deepEqual(a.days["2026-09-15"], {
    calories: 800, proteinG: 30, carbsG: 70, fatG: 15, meals: 2, water: 0, burned: 420, sessions: 1,
    morning: 500, afternoon: 0, evening: 300,
    credit: 105, // Auto for a moderately active target: a quarter of the burn raises the budget
  });
  // and a lunchtime meal lands in the afternoon
  assert.equal(m.days["2026-09-14"].afternoon, 400);
  assert.equal(a.goals.calories, 2000);
  assert.ok(m.goals.calories > 1000);
  assert.equal(m.days["2026-09-15"].water, 4);
  assert.equal(m.days["2026-09-14"].meals, 1);
  const entriesCall = seen.find((u) => u.pathname.endsWith("snapcal_food_entries"));
  assert.equal(entriesCall.searchParams.get("owner"), "in.(aelson,maria)");
  // only the timestamp is taken from the JSON blob — never the blob itself, which holds photos
  assert.ok(!/(^|,)data(,|$)/.test(entriesCall.searchParams.get("select")), "no raw data column")
  assert.ok(entriesCall.searchParams.get("select").includes("ts:data->>timestamp"));
  assert.ok(!JSON.stringify(res.body).includes("weightKg"));
});

test("the board recalculates old workout burns per person; typed watch calories stay", async () => {
  const { burnOf } = await import("../api/compare.js");
  const body = { weightKg: 80, heightCm: 178, age: 35, sex: "male" };
  assert.equal(burnOf({ caloriesBurned: 420, activity: "soccer", minutes: 45, intensity: "moderate" }, body), 366);
  assert.equal(burnOf({ caloriesBurned: 300, activity: "run", minutes: 30, kcalEntered: true }, body), 300);
  assert.equal(burnOf({ caloriesBurned: 420, activity: "soccer" }, body), 420, "no minutes: nothing to recalculate from");
});

test("the board uses the goals the person's phone reports, so Us matches their Home", async () => {
  const { goalsFrom } = await import("../api/compare.js");
  const profile = { weightKg: 80, heightCm: 178, age: 35, sex: "male", activityLevel: "lightlyActive", targetDeltaKcal: -500 };
  const fromProfile = goalsFrom(profile);
  assert.ok(fromProfile.calories > 0);
  const reported = goalsFrom({ ...profile, appliedGoals: { calories: 2049, proteinG: 160, carbsG: 200, fatG: 65 }, appliedGoalsV: 2 });
  assert.deepEqual(reported, { calories: 2049, proteinG: 160, carbsG: 200, fatG: 65 });
  // goals a phone saved under the older method are worked out again, not shown as they were
  assert.deepEqual(goalsFrom({ ...profile, appliedGoals: { calories: 2049, proteinG: 160, carbsG: 200, fatG: 65 } }), fromProfile);
  // a broken report falls back to working it out from the profile
  assert.deepEqual(goalsFrom({ ...profile, appliedGoals: { calories: "lots" } }), fromProfile);
});

test("the board shows the day totals each phone reported, and drops days the phone says were empty", async () => {
  const { reportedDays } = await import("../api/compare.js");
  const out = reportedDays({ daySummaries: {
    "2026-10-03": { calories: 2049.4, proteinG: 146, meals: 11, credit: 90, burned: 300, evening: 900, junk: 5 },
    "2026-10-02": { calories: -5 },        // nonsense is dropped field by field
    "not-a-day": { calories: 100 },
    "2026-08-01": { calories: 1500 },      // before the board's range
  } }, "2026-09-04");
  assert.deepEqual(out, { "2026-10-03": { calories: 2049, proteinG: 146, meals: 11, credit: 90, burned: 300, evening: 900 } });
});
