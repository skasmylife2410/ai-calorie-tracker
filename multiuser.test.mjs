// multiuser.test.mjs — APP_USERS passcode -> owner mapping and owner-scoped Supabase calls.
import test from "node:test";
import assert from "node:assert/strict";

function mockRes() {
  return { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
}

process.env.SUPABASE_URL = "https://example.supabase.co/";
process.env.SUPABASE_SERVICE_ROLE_KEY = " sb_secret_abc ";
process.env.APP_USERS = "Aelson:1111, maria:2222, bad name:3333";

const calls = [];
globalThis.fetch = async (url, opts = {}) => {
  calls.push({ url: String(url), opts });
  const u = new URL(url);
  if ((opts.method || "GET") === "GET" && u.searchParams.get("select") === "id") {
    // id "taken" belongs to someone else
    return { ok: true, json: async () => [{ id: "taken" }] };
  }
  if ((opts.method || "GET") === "GET") return { ok: true, json: async () => [] };
  return { ok: true, text: async () => "" };
};

const { checkAuth, parseUsers } = await import("../api/_auth.js");
const { default: sync } = await import("../api/sync.js");

test("parseUsers lowercases names and skips invalid pairs", () => {
  const u = parseUsers(process.env.APP_USERS);
  assert.equal(u.get("1111"), "aelson");
  assert.equal(u.get("2222"), "maria");
  assert.equal(u.has("3333"), false);
});

test("checkAuth maps PIN to owner and rejects unknown PINs", () => {
  assert.equal(checkAuth({ headers: { "x-snapcal-token": "2222" } }, mockRes()), "maria");
  const res = mockRes();
  assert.equal(checkAuth({ headers: { "x-snapcal-token": "9999" } }, res), false);
  assert.equal(res.code, 401);
  assert.equal(checkAuth({ headers: {} }, mockRes()), false);
});

test("pull only reads the caller's rows", async () => {
  calls.length = 0;
  const res = mockRes();
  await sync({ method: "POST", headers: { "x-snapcal-token": "2222" }, body: { op: "pull" } }, res);
  // entries, water, exercise, favourites, profile — every table is owner-scoped
  assert.equal(calls.length, 6);
  for (const c of calls) assert.equal(new URL(c.url).searchParams.get("owner"), "eq.maria");
  assert.equal(calls[0].opts.headers.apikey, "sb_secret_abc");
  assert.equal(calls[0].opts.headers.Authorization, undefined);
  assert.deepEqual(res.body.entries, []);
});

test("push tags rows with the caller and skips ids owned by someone else", async () => {
  calls.length = 0;
  const res = mockRes();
  await sync({
    method: "POST",
    headers: { "x-snapcal-token": "1111" },
    body: {
      op: "push",
      entries: [
        { id: "mine", day: "2026-09-15", loggedAt: "x", updatedAt: "x" },
        { id: "taken", day: "2026-09-15", loggedAt: "x", updatedAt: "x" },
      ],
      water: [{ day: "2026-09-15", glasses: 3, updatedAt: "x" }],
      profile: { data: { goal: 1 }, updatedAt: "x" },
    },
  }, res);
  assert.deepEqual(res.body, { ok: true });
  const posts = calls.filter((c) => c.opts.method === "POST");
  const byTable = Object.fromEntries(posts.map((c) => [new URL(c.url).pathname.split("/").pop(), c]));
  const entries = JSON.parse(byTable.snapcal_food_entries.opts.body);
  assert.deepEqual(entries.map((e) => [e.id, e.owner]), [["mine", "aelson"]]);
  assert.equal(new URL(byTable.snapcal_water.url).searchParams.get("on_conflict"), "owner,day");
  assert.equal(JSON.parse(byTable.snapcal_water.opts.body)[0].owner, "aelson");
  const prof = JSON.parse(byTable.snapcal_profile.opts.body)[0];
  assert.equal(prof.owner, "aelson");
  assert.equal("id" in prof, false);
  assert.equal(new URL(byTable.snapcal_profile.url).searchParams.get("on_conflict"), "owner");
});
