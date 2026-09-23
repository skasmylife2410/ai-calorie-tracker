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
