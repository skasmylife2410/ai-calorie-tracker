// social.test.mjs — notes between members and the shared feed. Mostly the ways they can be misused.
import test from "node:test";
import assert from "node:assert/strict";

process.env.APP_SECRET = "test-secret";
process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_x";
delete process.env.ALLOW_ANONYMOUS;

const { createSession } = await import("../api/_accounts.js");
const { default: notes } = await import("../api/notes.js");
const { default: shares, cleanItem } = await import("../api/shares.js");

const mockRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
const as = (user, body) => ({ method: "POST", headers: { "x-snapcal-token": createSession(user) }, body });

// in-memory Supabase: users, notes, shares, with the filters these endpoints actually use
let DB;
const reset = () => { installDb(); DB = {
  snapcal_users: [{ username: "aelson" }, { username: "baby" }, { username: "thayra23" }, { username: "jasmine" }],
  snapcal_notes: [], snapcal_shares: [], snapcal_food_entries: [], snapcal_water: [], snapcal_exercise: [], snapcal_profile: [],
  snapcal_groups: [{ id: "family", name: "Family" }, { id: "work", name: "Work" }],
  snapcal_group_members: [
    { group_id: "family", username: "aelson", joined_at: "1" }, { group_id: "family", username: "baby", joined_at: "2" },
    { group_id: "family", username: "thayra23", joined_at: "3" },
    { group_id: "work", username: "aelson", joined_at: "4" }, { group_id: "work", username: "jasmine", joined_at: "5" },
  ],
}; };
const matches = (row, params) => [...params.entries()].every(([k, v]) => {
  if (["select", "order", "limit"].includes(k)) return true;
  const [op, ...rest] = v.split("."); const val = rest.join(".");
  if (op === "eq") return String(row[k]) === val;
  if (op === "gte") return String(row[k] ?? "") >= val;
  if (op === "in") return val.replace(/[()]/g, "").split(",").includes(String(row[k]));
  return true;
});
const installDb = () => { globalThis.fetch = async (url, opts = {}) => {
  const u = new URL(url); const table = u.pathname.split("/").pop(); const method = opts.method ?? "GET";
  const rows = DB[table];
  if (method === "GET") return { ok: true, json: async () => rows.filter((r) => matches(r, u.searchParams)) };
  if (method === "POST") { for (const r of JSON.parse(opts.body)) rows.push({ created_at: new Date().toISOString(), ...r }); return { ok: true, text: async () => "" }; }
  if (method === "PATCH") { const f = JSON.parse(opts.body); rows.forEach((r) => { if (matches(r, u.searchParams)) Object.assign(r, f); }); return { ok: true, text: async () => "" }; }
  if (method === "DELETE") { DB[table] = rows.filter((r) => !matches(r, u.searchParams)); return { ok: true, text: async () => "" }; }
}; };
installDb();

test("a note reaches only the person it's addressed to", async () => {
  reset();
  let res = mockRes();
  await notes(as("aelson", { op: "send", to: "baby", body: "  Proud of you,   great week!  " }), res);
  assert.equal(res.body.ok, true);
  assert.equal(DB.snapcal_notes[0].body, "Proud of you, great week!", "whitespace is tidied");

  res = mockRes(); await notes(as("baby", { op: "inbox" }), res);
  assert.equal(res.body.notes.length, 1);
  assert.equal(res.body.notes[0].from_user, "aelson");

  res = mockRes(); await notes(as("thayra23", { op: "inbox" }), res);
  assert.equal(res.body.notes.length, 0, "someone else can't read it");
});

test("notes refuse yourself, strangers, empty and overlong text, and spam", async () => {
  reset();
  const send = async (from, to, body) => { const r = mockRes(); await notes(as(from, { op: "send", to, body }), r); return r.body; };
  assert.equal((await send("aelson", "aelson", "hi")).errorType, "self");
  assert.equal((await send("aelson", "nobody", "hi")).errorType, "noSuchUser");
  assert.equal((await send("aelson", "baby", "   ")).errorType, "empty");
  assert.equal((await send("aelson", "baby", "x".repeat(201))).errorType, "tooLong");
  for (let i = 0; i < 20; i++) assert.equal((await send("aelson", "baby", `note ${i}`)).ok, true);
  assert.equal((await send("aelson", "baby", "one too many")).errorType, "limit");
});

test("only the recipient can mark a note seen", async () => {
  reset();
  await notes(as("aelson", { op: "send", to: "baby", body: "hi" }), mockRes());
  const id = DB.snapcal_notes[0].id;
  await notes(as("thayra23", { op: "seen", id }), mockRes());
  assert.equal(DB.snapcal_notes[0].seen_at, undefined, "a third person can't touch it");
  await notes(as("baby", { op: "seen", id }), mockRes());
  assert.ok(DB.snapcal_notes[0].seen_at);
});

test("people lists your groups' members only", async () => {
  reset();
  let res = mockRes(); await notes(as("baby", { op: "people" }), res);
  assert.deepEqual(res.body.people, ["aelson", "thayra23"], "Family only — jasmine is in Work");

  res = mockRes(); await notes(as("aelson", { op: "people" }), res);
  assert.deepEqual(res.body.people.sort(), ["baby", "jasmine", "thayra23"], "aelson is in both groups");
});

test("a note can't cross groups, and a stranger's name gives nothing away", async () => {
  reset();
  let res = mockRes();
  await notes(as("jasmine", { op: "send", to: "baby", body: "hola" }), res);
  assert.equal(res.body.errorType, "noSuchUser", "Work can't write to Family");
  assert.equal(DB.snapcal_notes.length, 0);

  // the refusal reads the same as for a name that doesn't exist at all
  const invented = mockRes();
  await notes(as("jasmine", { op: "send", to: "nobody-at-all", body: "hola" }), invented);
  assert.deepEqual(res.body, invented.body, "no way to discover who's in another group");

  // within a group it works
  const okRes = mockRes();
  await notes(as("aelson", { op: "send", to: "jasmine", body: "nice work today" }), okRes);
  assert.equal(okRes.body.ok, true);
});

test("shares stay inside the group they were posted in", async () => {
  reset();
  await shares(as("baby", { op: "share", kind: "meal", item: { name: "Arepa" }, group: "family" }), mockRes());
  await shares(as("jasmine", { op: "share", kind: "meal", item: { name: "Work salad" }, group: "work" }), mockRes());

  let res = mockRes(); await shares(as("thayra23", { op: "list" }), res);
  assert.deepEqual(res.body.shares.map((s) => s.data.name), ["Arepa"], "Family sees only Family");

  res = mockRes(); await shares(as("jasmine", { op: "list" }), res);
  assert.deepEqual(res.body.shares.map((s) => s.data.name), ["Work salad"]);

  // aelson is in both and sees one group at a time
  res = mockRes(); await shares(as("aelson", { op: "list", group: "work" }), res);
  assert.deepEqual(res.body.shares.map((s) => s.data.name), ["Work salad"]);
  res = mockRes(); await shares(as("aelson", { op: "list", group: "family" }), res);
  assert.deepEqual(res.body.shares.map((s) => s.data.name), ["Arepa"]);

  // asking for a group you're not in is refused
  res = mockRes(); await shares(as("jasmine", { op: "list", group: "family" }), res);
  assert.equal(res.body.errorType, "notMember");
  res = mockRes(); await shares(as("jasmine", { op: "share", kind: "meal", item: { name: "sneak" }, group: "family" }), res);
  assert.equal(res.body.errorType, "notMember");
  assert.equal(DB.snapcal_shares.filter((x) => x.group_id === "family").length, 1, "nothing was posted into Family");
});

test("shares are visible to everyone and deletable only by their owner", async () => {
  reset();
  let res = mockRes();
  await shares(as("baby", { op: "share", kind: "meal", item: { name: "Arepa con huevo", calories: 420, proteinG: 22 }, group: "family" }), res);
  assert.equal(res.body.ok, true);
  const id = res.body.id;

  res = mockRes(); await shares(as("aelson", { op: "list" }), res);
  assert.equal(res.body.shares.length, 1);
  assert.equal(res.body.shares[0].owner, "baby");

  await shares(as("aelson", { op: "delete", id }), mockRes());
  assert.equal(DB.snapcal_shares.length, 1, "someone else can't delete it");
  await shares(as("baby", { op: "delete", id }), mockRes());
  assert.equal(DB.snapcal_shares.length, 0);
});

test("shared items are cleaned: bad photos dropped, numbers bounded, lists capped", () => {
  const meal = cleanItem("meal", {
    name: "x".repeat(300), calories: -50, proteinG: "abc",
    photo: "https://evil.example/tracker.png",           // not a data URL -> dropped
    items: Array.from({ length: 30 }, (_, i) => ({ name: `i${i}`, gramsEstimate: 10 })),
    extra: "ignored",
  });
  assert.equal(meal.name.length, 90);
  assert.equal(meal.calories, 0);
  assert.equal(meal.proteinG, 0);
  assert.equal(meal.photo, null, "only inline image data URLs are kept");
  assert.equal(meal.items.length, 12);
  assert.equal("extra" in meal, false);

  const big = cleanItem("meal", { name: "a", photo: "data:image/jpeg;base64," + "A".repeat(200000) });
  assert.equal(big.photo, null, "oversized photos are dropped");

  const idea = cleanItem("idea", { name: "Sancocho", ingredients: Array(40).fill("x"), steps: ["a", "", "b"] });
  assert.equal(idea.ingredients.length, 15);
  assert.deepEqual(idea.steps, ["a", "b"]);
});

test("nothing works without signing in", async () => {
  reset();
  const res = mockRes();
  await notes({ method: "POST", headers: {}, body: { op: "inbox" } }, res);
  assert.equal(res.code, 401);
  const res2 = mockRes();
  await shares({ method: "POST", headers: { "x-snapcal-token": "forged" }, body: { op: "list" } }, res2);
  assert.equal(res2.code, 401);
});

// --- Nano Banana doodles ------------------------------------------------------------

test("doodle generation: tries the cheapest model, falls back, and reports billing clearly", async () => {
  process.env.GEMINI_API_KEY = "k";
  const { default: doodle, buildDoodlePrompt, extractImage } = await import("../api/doodle.js");

  // prompt carries the pose and whether to base it on a photo
  const p = buildDoodlePrompt({ state: "wellFed", variant: "b", hasPhoto: true });
  assert.match(p, /a woman/); assert.match(p, /couch/); assert.match(p, /photo/);
  assert.doesNotMatch(buildDoodlePrompt({ state: "strong", variant: "a", hasPhoto: false }), /photo/);

  // both response casings are understood
  assert.deepEqual(extractImage({ candidates: [{ content: { parts: [{ text: "hi" }, { inlineData: { mimeType: "image/png", data: "QQ==" } }] } }] }), { image: "QQ==", mime: "image/png" });
  assert.deepEqual(extractImage({ candidates: [{ content: { parts: [{ inline_data: { mime_type: "image/jpeg", data: "Qg==" } }] } }] }), { image: "Qg==", mime: "image/jpeg" });
  assert.equal(extractImage({ candidates: [] }), null);

  // first model missing -> second model used
  const seen = [];
  globalThis.fetch = async (url) => {
    seen.push(new URL(url).pathname.split("/").pop());
    if (seen.length === 1) return { ok: false, status: 404, text: async () => "not found" };
    return { ok: true, status: 200, text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: "QUJD" } }] } }] }) };
  };
  let res = mockRes();
  await doodle(as("baby", { state: "strong", variant: "b" }), res);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.image, "QUJD");
  assert.deepEqual(seen, ["gemini-3.1-flash-lite-image:generateContent", "gemini-2.5-flash-image:generateContent"]);

  // a billing refusal stops immediately (it'd be the same on every model) and says why
  seen.length = 0;
  globalThis.fetch = async (url) => { seen.push(url); return { ok: false, status: 400, text: async () => "FAILED_PRECONDITION: billing required" }; };
  res = mockRes();
  await doodle(as("baby", { state: "idle" }), res);
  assert.equal(res.body.errorType, "billing");
  assert.equal(seen.length, 1);

  // not signed in -> nothing is generated
  let called = false;
  globalThis.fetch = async () => { called = true; };
  res = mockRes();
  await doodle({ method: "POST", headers: {}, body: { state: "strong" } }, res);
  assert.equal(res.code, 401);
  assert.equal(called, false);
});

// --- no group means no visibility ------------------------------------------------------

test("someone in no group sees only themselves, never everyone", async () => {
  reset();
  DB.snapcal_users.push({ username: "stray" });          // signed up with the shared code
  DB.snapcal_food_entries = [];
  const { default: compare } = await import("../api/compare.js");
  const res = mockRes();
  await compare(as("stray", { from: "2026-01-01" }), res);
  assert.ok(res.body.people, `expected people, got ${JSON.stringify(res.body)}`);
  assert.deepEqual(res.body.people.map((p) => p.owner), ["stray"], "no group -> only yourself");
  assert.deepEqual(res.body.groups, []);
});

test("the owner can place someone in a group; others can't", async () => {
  reset();
  DB.snapcal_users.push({ username: "stray" });
  const { default: groups } = await import("../api/groups.js");

  let res = mockRes(); await groups(as("thayra23", { op: "set", username: "stray", group: "family" }), res);
  assert.equal(res.body.errorType, "forbidden");
  assert.equal(DB.snapcal_group_members.filter((m) => m.username === "stray").length, 0);

  res = mockRes(); await groups(as("aelson", { op: "set", username: "stray", group: "work" }), res);
  assert.equal(res.body.ok, true, JSON.stringify(res.body));
  assert.deepEqual(res.body.people.find((p) => p.username === "stray").groups, ["work"]);

  // and can take them out again
  res = mockRes(); await groups(as("aelson", { op: "set", username: "stray", group: "work", member: false }), res);
  assert.deepEqual(res.body.people.find((p) => p.username === "stray").groups, []);

  // unknown people and groups are refused
  res = mockRes(); await groups(as("aelson", { op: "set", username: "ghost", group: "work" }), res);
  assert.equal(res.body.ok, false);
  res = mockRes(); await groups(as("aelson", { op: "set", username: "stray", group: "nope" }), res);
  assert.equal(res.body.ok, false);
});
