// coach.test.mjs — the coach sees meals only of people who turned sharing on, and only the coach.
import test from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_x";
process.env.ALLOW_LEGACY_PASSCODES = "1";
process.env.APP_USERS = "aelson:a1,maria:m2,ana:n3";

const PHOTO = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==";
const tables = {
  snapcal_profile: [
    { owner: "aelson", data: { displayName: "Aelson" } },
    { owner: "maria", data: { displayName: "María", shareWithCoach: true, shareWithCoachAt: 1, weightKg: 60, heightCm: 165, age: 30, sex: "female" } },
    { owner: "ana", data: { displayName: "Ana", shareWithCoach: false } },
  ],
  snapcal_food_entries: [
    { owner: "maria", day: "2026-10-07", data: { id: "m1", name: "Arepa", calories: 380, proteinG: 14, carbsG: 40, fatG: 15, timestamp: 2, photoDataUrl: PHOTO, analysisItems: [{ name: "arepa", gramsEstimate: 120, calories: 300 }, { name: "queso", gramsEstimate: 30, calories: 80 }] } },
    { owner: "ana", day: "2026-10-07", data: { id: "a1", name: "Secret", calories: 999, timestamp: 1 } },
  ],
  snapcal_users: [{ username: "aelson" }, { username: "maria" }, { username: "ana" }],
};
globalThis.fetch = async (url) => {
  const u = new URL(url);
  let rows = tables[u.pathname.split("/").pop()] ?? [];
  const owner = u.searchParams.get("owner");
  if (owner?.startsWith("eq.")) rows = rows.filter((r) => r.owner === owner.slice(3));
  const user = u.searchParams.get("username");
  if (user?.startsWith("eq.")) rows = rows.filter((r) => r.username === user.slice(3));
  return { ok: true, json: async () => rows };
};

const { default: compare } = await import("../api/compare.js");
const call = async (token, body) => {
  const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  await compare({ method: "POST", headers: { "x-snapcal-token": token }, body }, res);
  return res.body;
};

test("only the coach can open the coach view", async () => {
  assert.equal((await call("m2", { op: "coach" })).errorType, "forbidden");
  assert.equal((await call("m2", { op: "coachMeals", owner: "ana", day: "2026-10-07" })).errorType, "forbidden");
});

test("the list holds only people sharing, never the coach", async () => {
  const out = await call("a1", { op: "coach" });
  assert.deepEqual(out.people.map((p) => p.owner), ["maria"]);
  assert.equal(out.people[0].name, "María");
});

test("meals of someone sharing, with photo and foods; someone not sharing is refused", async () => {
  const ok = await call("a1", { op: "coachMeals", owner: "maria", day: "2026-10-07" });
  assert.equal(ok.meals.length, 1);
  assert.equal(ok.meals[0].name, "Arepa");
  assert.equal(ok.meals[0].photo, PHOTO);
  assert.equal(ok.meals[0].items.length, 2);
  const no = await call("a1", { op: "coachMeals", owner: "ana", day: "2026-10-07" });
  assert.equal(no.errorType, "forbidden");
  assert.equal(no.meals, undefined);
});

test("the list says how many of everyone share, with each person's streak and last meal", async () => {
  const out = await call("a1", { op: "coach", today: "2026-10-07" });
  assert.equal(out.total, 2, "everyone but the coach");
  assert.equal(out.people[0].lastMealAt, null, "the mock has no timestamps column");
  assert.equal(typeof out.people[0].streak, "number");
});

test("turning sharing on tells the coach; the coach's own account doesn't", async () => {
  assert.equal((await call("m2", { op: "coachJoined", name: "María" })).ok, true);
  assert.equal((await call("a1", { op: "coachJoined" })).ok, true);
});
