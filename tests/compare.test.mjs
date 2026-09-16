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
      { owner: "aelson", day: "2026-09-15", calories: 500.4, protein_g: 30, carbs_g: 50, fat_g: 10 },
      { owner: "aelson", day: "2026-09-15", calories: 300, protein_g: null, carbs_g: 20, fat_g: 5 },
      { owner: "maria", day: "2026-09-14", calories: 400, protein_g: 20, carbs_g: 40, fat_g: 12 },
    ],
    snapcal_water: [{ owner: "maria", day: "2026-09-15", glasses: 4 }],
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
  assert.deepEqual(a.days["2026-09-15"], { calories: 800, proteinG: 30, carbsG: 70, fatG: 15, meals: 2, water: 0 });
  assert.equal(a.goals.calories, 2000);
  assert.ok(m.goals.calories > 1000);
  assert.equal(m.days["2026-09-15"].water, 4);
  assert.equal(m.days["2026-09-14"].meals, 1);
  const entriesCall = seen.find((u) => u.pathname.endsWith("snapcal_food_entries"));
  assert.equal(entriesCall.searchParams.get("owner"), "in.(aelson,maria)");
  assert.ok(!entriesCall.searchParams.get("select").includes("data"));
  assert.ok(!JSON.stringify(res.body).includes("weightKg"));
});
