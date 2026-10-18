// groups.test.mjs — anyone can make a group, ask people from their groups to join (they say
// yes or no), and leave a group, as long as they're still in one.
import test from "node:test";
import assert from "node:assert/strict";

process.env.APP_SECRET = "test-secret";
process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_x";

const { createSession } = await import("../api/_accounts.js");
const { default: groups } = await import("../api/groups.js");
const { default: invites } = await import("../api/invites.js");
const { default: shares } = await import("../api/shares.js");
const { MAX_GROUPS } = await import("../api/_members.js");

const mockRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
const as = (user, body) => ({ method: "POST", headers: { "x-snapcal-token": createSession(user) }, body });
const call = async (handler, user, body) => { const r = mockRes(); await handler(as(user, body), r); return r.body; };

let DB;
const reset = () => { DB = {
  snapcal_users: [{ username: "aelson" }, { username: "baby" }, { username: "thayra23" }, { username: "loner" }],
  snapcal_groups: [{ id: "family", name: "Family", created_by: "aelson" }, { id: "work", name: "Work", created_by: "aelson" }],
  snapcal_group_members: [
    { group_id: "family", username: "aelson", joined_at: "1" }, { group_id: "family", username: "baby", joined_at: "2" },
    { group_id: "family", username: "thayra23", joined_at: "3" }, { group_id: "work", username: "loner", joined_at: "4" },
  ],
  snapcal_group_invites: [], snapcal_invites: [], snapcal_shares: [], snapcal_comments: [],
  snapcal_profile: [{ owner: "baby", name: "Mi baby" }],
}; };
const ok = (row, params) => [...params.entries()].every(([k, v]) => {
  if (["select", "order", "limit"].includes(k)) return true;
  if (v === "is.null") return row[k] === null || row[k] === undefined;
  const [op, ...rest] = v.split("."); const val = rest.join(".");
  if (op === "eq") return String(row[k]) === val;
  if (op === "gt") return String(row[k]) > val;
  if (op === "gte") return String(row[k]) >= val;
  if (op === "in") return val.replace(/[()"]/g, "").split(",").includes(String(row[k]));
  return true;
});
globalThis.fetch = async (url, opts = {}) => {
  const u = new URL(url); const table = u.pathname.split("/").pop(); const m = opts.method ?? "GET";
  const rows = (DB[table] ??= []);
  if (m === "DELETE") { DB[table] = rows.filter((r) => !ok(r, u.searchParams)); return { ok: true, text: async () => "" }; }
  if (m === "GET") return { ok: true, json: async () => rows.filter((r) => ok(r, u.searchParams)) };
  if (m === "POST") { for (const r of JSON.parse(opts.body)) rows.push({ revoked: false, used_by: null, created_at: new Date().toISOString(), ...r }); return { ok: true, text: async () => "" }; }
  if (m === "PATCH") { const f = JSON.parse(opts.body); const hit = rows.filter((r) => ok(r, u.searchParams)); hit.forEach((r) => Object.assign(r, f)); return { ok: true, json: async () => hit, text: async () => "" }; }
};
const membersOf = (g) => DB.snapcal_group_members.filter((m) => m.group_id === g).map((m) => m.username).sort();

test("anyone can make a group; they're its first member", async () => {
  reset();
  const out = await call(groups, "baby", { op: "create", name: "  Gym   buddies  " });
  assert.equal(out.ok, true);
  const gym = out.groups.find((g) => g.id === out.created);
  assert.deepEqual([gym.name, gym.members], ["Gym buddies", ["baby"]]);
  assert.equal(DB.snapcal_groups.find((g) => g.id === out.created).created_by, "baby");
  assert.equal(out.names.baby, "Mi baby", "names come from profiles");
  assert.equal(out.names.thayra23, "Thayra23");

  assert.equal((await call(groups, "baby", { op: "create", name: "   " })).errorType, "noName");
  for (let i = out.groups.length; i < MAX_GROUPS; i++) assert.equal((await call(groups, "baby", { op: "create", name: `G${i}` })).ok, true);
  assert.equal((await call(groups, "baby", { op: "create", name: "One too many" })).errorType, "tooMany");
});

test("you can leave a group, but never your last one", async () => {
  reset();
  assert.equal((await call(groups, "baby", { op: "leave", group: "family" })).errorType, "lastGroup", "Family is baby's only group");
  assert.ok(membersOf("family").includes("baby"));

  const { created } = await call(groups, "baby", { op: "create", name: "Just us" });
  const out = await call(groups, "baby", { op: "leave", group: "family" });
  assert.equal(out.ok, true);
  assert.deepEqual(out.groups.map((g) => g.id), [created], "only the new group is left");
  assert.ok(!membersOf("family").includes("baby"));
  assert.equal((await call(groups, "baby", { op: "leave", group: "family" })).errorType, "notMember");
  assert.equal(DB.snapcal_groups.some((g) => g.id === "family"), true, "Family stays");
});

test("adding someone asks them first; they join only when they say yes", async () => {
  reset();
  const { created } = await call(groups, "baby", { op: "create", name: "Gym" });
  let out = await call(groups, "baby", { op: "add", group: created, username: "thayra23" });
  assert.equal(out.ok, true);
  assert.deepEqual(membersOf(created), ["baby"], "not a member yet");
  assert.deepEqual(out.sent, [{ group: created, username: "thayra23" }]);
  await call(groups, "baby", { op: "add", group: created, username: "thayra23" });
  assert.equal(DB.snapcal_group_invites.length, 1, "asking twice is one ask");

  out = await call(groups, "thayra23", {});
  assert.deepEqual(out.pending, [{ group: created, name: "Gym", by: "baby" }]);
  assert.equal(out.names.baby, "Mi baby");
  out = await call(groups, "thayra23", { op: "accept", group: created });
  assert.ok(out.groups.some((g) => g.id === created));
  assert.deepEqual(membersOf(created), ["baby", "thayra23"]);
  assert.deepEqual(out.pending, []);
  assert.equal(DB.snapcal_group_invites.length, 0);
});

test("saying no, people outside your groups, and groups you're not in", async () => {
  reset();
  const { created } = await call(groups, "baby", { op: "create", name: "Gym" });
  await call(groups, "baby", { op: "add", group: created, username: "aelson" });
  const out = await call(groups, "aelson", { op: "decline", group: created });
  assert.deepEqual([out.pending, membersOf(created)], [[], ["baby"]]);

  assert.equal((await call(groups, "baby", { op: "add", group: created, username: "loner" })).errorType, "notMember", "baby never sees loner");
  assert.equal((await call(groups, "thayra23", { op: "add", group: created, username: "aelson" })).errorType, "notMember", "thayra23 isn't in Gym");
  assert.equal((await call(groups, "baby", { op: "add", group: created, username: "baby" })).errorType, "other");
  // accepting an ask that isn't there does nothing
  await call(groups, "loner", { op: "accept", group: created });
  assert.deepEqual(membersOf(created), ["baby"]);
});

test("a group someone made goes with its last member, links and asks included", async () => {
  reset();
  const { created } = await call(groups, "baby", { op: "create", name: "Gym" });
  await call(groups, "baby", { op: "add", group: created, username: "thayra23" });
  const link = await call(invites, "baby", { op: "create", group: created });
  assert.equal(link.ok, true);
  await call(groups, "baby", { op: "leave", group: created });
  assert.equal(DB.snapcal_groups.some((g) => g.id === created), false);
  assert.equal(DB.snapcal_group_invites.length, 0);
  assert.equal(DB.snapcal_invites.find((i) => i.code === link.code).revoked, true, "nobody can sign up into it");
  // and an ask for it that's answered later is just dropped
  const out = await call(groups, "thayra23", { op: "accept", group: created });
  assert.equal(out.ok, true);
  assert.ok(!out.groups.some((g) => g.id === created));
});

test("someone who left a group takes their posts in it with them", async () => {
  reset();
  const recent = new Date().toISOString();
  DB.snapcal_shares.push(
    { id: "p1", owner: "baby", kind: "post", data: { text: "hola" }, created_at: recent, group_id: "family" },
    { id: "p2", owner: "thayra23", kind: "post", data: { text: "hi" }, created_at: recent, group_id: "family" },
  );
  let feed = await call(shares, "aelson", { op: "list", group: "family" });
  assert.deepEqual(feed.shares.map((s) => s.id).sort(), ["p1", "p2"]);
  await call(groups, "baby", { op: "create", name: "Gym" });
  await call(groups, "baby", { op: "leave", group: "family" });
  feed = await call(shares, "aelson", { op: "list", group: "family" });
  assert.deepEqual(feed.shares.map((s) => s.id), ["p2"]);
});
