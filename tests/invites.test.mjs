// invites.test.mjs — single-use invite links and the group cap.
import test from "node:test";
import assert from "node:assert/strict";

process.env.APP_SECRET = "test-secret";
process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_x";
process.env.INVITE_CODE = "arepa";
delete process.env.MAX_USERS;
delete process.env.ADMIN_USERS;

const { createSession } = await import("../api/_accounts.js");
const { default: invites } = await import("../api/invites.js");
const { default: auth } = await import("../api/auth.js");
const { maxUsers, isAdmin } = await import("../api/_members.js");

const mockRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
const as = (user, body) => ({ method: "POST", headers: { "x-snapcal-token": createSession(user) }, body });
const anon = (body) => ({ method: "POST", headers: {}, body });

// in-memory Supabase with the filters these endpoints use (eq, gt, is.null, conditional PATCH)
let DB;
const reset = () => { DB = {
  snapcal_users: [{ username: "aelson" }, { username: "baby" }, { username: "thayra23" }],
  snapcal_invites: [],
  snapcal_groups: [{ id: "family", name: "Family" }, { id: "work", name: "Work" }],
  snapcal_group_members: [
    { group_id: "family", username: "aelson", joined_at: "1" }, { group_id: "family", username: "baby", joined_at: "2" },
    { group_id: "family", username: "thayra23", joined_at: "3" }, { group_id: "work", username: "aelson", joined_at: "4" },
  ],
}; };
const ok = (row, params) => [...params.entries()].every(([k, v]) => {
  if (["select", "order", "limit"].includes(k)) return true;
  if (v === "is.null") return row[k] === null || row[k] === undefined;
  const [op, ...rest] = v.split("."); const val = rest.join(".");
  if (op === "eq") return String(row[k]) === val;
  if (op === "gt") return String(row[k]) > val;
  if (op === "in") return val.replace(/[()]/g, "").split(",").includes(String(row[k]));
  return true;
});
globalThis.fetch = async (url, opts = {}) => {
  const u = new URL(url); const table = u.pathname.split("/").pop(); const m = opts.method ?? "GET";
  const rows = DB[table];
  if (m === "GET") {
    if ((opts.headers ?? {}).Prefer === "count=exact") return { ok: true, headers: { get: () => `0-0/${rows.length}` }, json: async () => [] };
    return { ok: true, json: async () => rows.filter((r) => ok(r, u.searchParams)) };
  }
  if (m === "POST") { for (const r of JSON.parse(opts.body)) { const i = rows.findIndex((x) => x.username && x.username === r.username); if (i >= 0) rows[i] = { ...rows[i], ...r }; else rows.push({ revoked: false, used_by: null, ...r }); } return { ok: true, text: async () => "" }; }
  if (m === "PATCH") { const f = JSON.parse(opts.body); const hit = rows.filter((r) => ok(r, u.searchParams)); hit.forEach((r) => Object.assign(r, f)); return { ok: true, json: async () => hit, text: async () => "" }; }
};

test("the group holds 8 by default and aelson manages invites", () => {
  assert.equal(maxUsers(), 8);
  assert.equal(isAdmin("aelson"), true);
  assert.equal(isAdmin("baby"), false);
});

test("an invite link lets exactly one person in, once", async () => {
  reset();
  let res = mockRes(); await invites(as("aelson", { op: "create", group: "family" }), res);
  assert.equal(res.body.ok, true);
  const code = res.body.code;
  assert.match(code, /^[A-Za-z0-9_-]{20,}$/, "long enough that it can't be guessed");

  res = mockRes(); await invites(anon({ op: "check", code }), res);
  assert.deepEqual([res.body.valid, res.body.reason], [true, undefined], "the sign-up screen can check a link without an account");

  res = mockRes(); await auth(anon({ op: "signup", username: "camila", password: "mango12345", invite: code }), res);
  assert.equal(res.body.ok, true);
  assert.ok(DB.snapcal_users.some((u) => u.username === "camila"));

  res = mockRes(); await auth(anon({ op: "signup", username: "someoneelse", password: "mango12345", invite: code }), res);
  assert.equal(res.body.errorType, "inviteUsed");
  assert.ok(!DB.snapcal_users.some((u) => u.username === "someoneelse"));

  res = mockRes(); await invites(anon({ op: "check", code }), res);
  assert.deepEqual([res.body.valid, res.body.reason], [false, "used"]);
});

test("expired, cancelled and made-up links are refused with a clear reason", async () => {
  reset();
  DB.snapcal_invites.push({ code: "expiredexpiredexpired1", created_by: "aelson", expires_at: "2000-01-01T00:00:00Z", used_by: null, revoked: false });
  let res = mockRes(); await auth(anon({ op: "signup", username: "late", password: "mango12345", invite: "expiredexpiredexpired1" }), res);
  assert.equal(res.body.errorType, "inviteExpired");

  res = mockRes(); await invites(as("aelson", { op: "create", group: "family" }), res);
  const code = res.body.code;
  await invites(as("aelson", { op: "revoke", code }), mockRes());
  res = mockRes(); await auth(anon({ op: "signup", username: "cancelled", password: "mango12345", invite: code }), res);
  assert.equal(res.body.errorType, "inviteRevoked");

  res = mockRes(); await auth(anon({ op: "signup", username: "guesser", password: "mango12345", invite: "made-up-code-1234567" }), res);
  assert.equal(res.body.errorType, "badInvite");
});

test("only the owner can create or cancel links", async () => {
  reset();
  let res = mockRes(); await invites(as("baby", { op: "create", group: "family" }), res);
  assert.equal(res.body.errorType, "forbidden");
  res = mockRes(); await invites(as("baby", { op: "list" }), res);
  assert.equal(res.body.isAdmin, false);
  assert.deepEqual(res.body.invites, [], "non-owners don't see the codes");
  res = mockRes(); await invites(anon({ op: "create", group: "family" }), res);
  assert.equal(res.code, 401);
});

test("five open links fill the five free places; a sixth can't be made", async () => {
  reset();
  for (let i = 0; i < 5; i++) {
    const r = mockRes(); await invites(as("aelson", { op: "create", group: "family" }), r);
    assert.equal(r.body.ok, true, `link ${i + 1}`);
  }
  const sixth = mockRes(); await invites(as("aelson", { op: "create", group: "family" }), sixth);
  assert.equal(sixth.body.errorType, "full");

  // cancelling one frees a place again
  const code = DB.snapcal_invites[0].code;
  await invites(as("aelson", { op: "revoke", code }), mockRes());
  const again = mockRes(); await invites(as("aelson", { op: "create", group: "family" }), again);
  assert.equal(again.body.ok, true);
});


test("an invite link puts the new person in the group it was made for, and nowhere else", async () => {
  reset();
  let res = mockRes(); await invites(as("aelson", { op: "create", group: "work" }), res);
  const code = res.body.code;
  assert.equal(res.body.group, "work");

  res = mockRes(); await auth(anon({ op: "signup", username: "jasmine", password: "mango12345", invite: code }), res);
  assert.equal(res.body.ok, true);
  const joined = DB.snapcal_group_members.filter((m) => m.username === "jasmine");
  assert.deepEqual(joined.map((m) => m.group_id), ["work"], "joins Work only — not Family");
});

test("a link can only be made for a group you're in, and must name one", async () => {
  reset();
  let res = mockRes(); await invites(as("baby", { op: "create", group: "work" }), res);
  assert.equal(res.body.errorType, "forbidden", "not an admin at all");

  DB.snapcal_group_members.push({ group_id: "work", username: "baby", joined_at: "9" });
  process.env.ADMIN_USERS = "aelson,baby";
  res = mockRes(); await invites(as("baby", { op: "create", group: "family" }), res);
  assert.equal(res.body.ok, true, "baby is in Family, so this is allowed");
  res = mockRes(); await invites(as("baby", { op: "create" }), res);
  assert.equal(res.body.errorType, "noGroup", "a link must say which group");
  delete process.env.ADMIN_USERS;

  reset();
  res = mockRes(); await invites(as("aelson", { op: "create", group: "nosuchgroup" }), res);
  assert.equal(res.body.errorType, "notMember");
});
