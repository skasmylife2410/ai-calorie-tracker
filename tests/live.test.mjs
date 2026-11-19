// live.test.mjs — "Train together": go live for a group; people in it swipe through whoever is
// live. The server only passes the connection offer and answer between phones.
import test from "node:test";
import assert from "node:assert/strict";

process.env.APP_SECRET = "test-secret";
process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_x";

const { createSession } = await import("../api/_accounts.js");
const { default: groups } = await import("../api/groups.js");
const { iceServers, MAX_WATCHING } = await import("../api/_live.js");
const { orderSessions, workoutLabel, liveSupported } = await import("../js/ui/live.js");

const mockRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
const as = (user, body) => ({ method: "POST", headers: { "x-snapcal-token": createSession(user, undefined, { salt: "test-salt" }) }, body });
const call = async (user, body) => { const r = mockRes(); await groups(as(user, body), r); return r.body; };

let DB;
const reset = () => { DB = {
  snapcal_users: [{ username: "aelson" }, { username: "baby" }, { username: "thayra23" }, { username: "loner" }],
  snapcal_groups: [{ id: "family", name: "Family", created_by: "aelson" }, { id: "work", name: "Work", created_by: "aelson" }],
  snapcal_group_members: [
    { group_id: "family", username: "aelson", joined_at: "1" }, { group_id: "family", username: "baby", joined_at: "2" },
    { group_id: "family", username: "thayra23", joined_at: "3" }, { group_id: "work", username: "loner", joined_at: "4" },
  ],
  snapcal_profile: [{ owner: "baby", data: { displayName: "Mi baby" } }],
  snapcal_live: [], snapcal_live_signals: [],
}; };
const cond = (row, k, v) => {
  if (v === "is.null") return row[k] === null || row[k] === undefined;
  if (v === "not.is.null") return row[k] !== null && row[k] !== undefined;
  const [op, ...rest] = v.split("."); const val = rest.join(".");
  if (op === "eq") return String(row[k]) === val;
  if (op === "gt") return String(row[k]) > val;
  if (op === "lt") return String(row[k]) < val;
  if (op === "in") return val.replace(/[()"]/g, "").split(",").includes(String(row[k]));
  throw new Error(`mock: unknown filter ${k}=${v}`);
};
const ok = (row, params) => [...params.entries()].every(([k, v]) => {
  if (["select", "order", "limit"].includes(k)) return true;
  if (k === "or") return v.slice(1, -1).split(",").some((part) => { const [col, ...r] = part.split("."); return cond(row, col, r.join(".")); });
  return cond(row, k, v);
});
const now = () => new Date().toISOString();
globalThis.fetch = async (url, opts = {}) => {
  const u = new URL(url); const table = u.pathname.split("/").pop(); const m = opts.method ?? "GET";
  const rows = (DB[table] ??= []);
  if (m === "DELETE") { DB[table] = rows.filter((r) => !ok(r, u.searchParams)); return { ok: true, text: async () => "" }; }
  if (m === "GET") return { ok: true, json: async () => rows.filter((r) => ok(r, u.searchParams)) };
  if (m === "POST") { for (const r of [].concat(JSON.parse(opts.body))) rows.push({ created_at: now(), started_at: now(), last_seen: now(), ended_at: null, answer: null, left_at: null, ...r }); return { ok: true, text: async () => "" }; }
  if (m === "PATCH") { const f = JSON.parse(opts.body); const hit = rows.filter((r) => ok(r, u.searchParams)); hit.forEach((r) => Object.assign(r, f)); return { ok: true, json: async () => hit, text: async () => "" }; }
};
const SDP = "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\n";

test("go live, a groupmate joins, the answer comes back, and leaving and ending show up", async () => {
  reset();
  const start = await call("baby", { op: "liveStart", group: "family", muscle: "chest", level: "beginner" });
  assert.equal(start.ok, true);

  const seen = await call("thayra23", { op: "live", group: "family" });
  assert.equal(seen.sessions.length, 1);
  assert.deepEqual([seen.sessions[0].name, seen.sessions[0].muscle, seen.sessions[0].level], ["Mi baby", "chest", "beginner"]);
  assert.ok(seen.ice[0].urls.length, "always some STUN servers");

  const join = await call("thayra23", { op: "liveJoin", id: start.id, offer: SDP });
  assert.equal(join.ok, true);
  assert.equal((await call("thayra23", { op: "liveWait", signal: join.signal })).answer, null);

  const beat = await call("baby", { op: "liveBeat", id: start.id });
  assert.equal(beat.offers.length, 1);
  assert.deepEqual([beat.offers[0].viewer, beat.offers[0].offer], ["thayra23", SDP]);
  assert.equal(beat.watching, 0, "nobody is counted before they're connected");

  assert.equal((await call("baby", { op: "liveAnswer", signal: join.signal, answer: SDP })).ok, true);
  const wait = await call("thayra23", { op: "liveWait", signal: join.signal });
  assert.deepEqual([wait.answer, wait.ended], [SDP, false]);
  const beat2 = await call("baby", { op: "liveBeat", id: start.id });
  assert.deepEqual([beat2.offers.length, beat2.watching, beat2.left], [0, 1, []]);

  await call("thayra23", { op: "liveLeave", signal: join.signal });
  assert.deepEqual((await call("baby", { op: "liveBeat", id: start.id })).left, [join.signal]);

  await call("baby", { op: "liveEnd", id: start.id });
  assert.equal((await call("thayra23", { op: "live", group: "family" })).sessions.length, 0);
  assert.equal((await call("aelson", { op: "liveJoin", id: start.id, offer: SDP })).errorType, "ended");
});

test("the feed lists streams from every group you're in, and only those", async () => {
  reset();
  DB.snapcal_group_members.push({ group_id: "work", username: "baby", joined_at: "5" });
  const fam = await call("thayra23", { op: "liveStart", group: "family", muscle: "back", level: "average" });
  const work = await call("loner", { op: "liveStart", group: "work", muscle: "arms", level: "expert" });
  const babyFeed = await call("baby", { op: "live" });
  assert.deepEqual(babyFeed.sessions.map((s) => s.id).sort(), [fam.id, work.id].sort());
  assert.equal(babyFeed.sessions.find((s) => s.id === work.id).group, "Work");
  assert.deepEqual((await call("aelson", { op: "live" })).sessions.map((s) => s.id), [fam.id], "not the Work stream");
});

test("only people in the group see or join it, and only the person live can answer", async () => {
  reset();
  const { id } = await call("baby", { op: "liveStart", group: "family", muscle: "legs", level: "expert" });
  assert.equal((await call("loner", { op: "live", group: "family" })).errorType, "notMember");
  assert.equal((await call("loner", { op: "liveJoin", id, offer: SDP })).errorType, "notMember");
  assert.equal((await call("loner", { op: "liveStart", group: "family", muscle: "legs", level: "expert" })).errorType, "notMember");
  const { signal } = await call("aelson", { op: "liveJoin", id, offer: SDP });
  assert.equal((await call("thayra23", { op: "liveAnswer", signal, answer: SDP })).ok, false, "someone else can't answer");
  assert.equal((await call("thayra23", { op: "liveWait", signal })).ok, false, "or read someone else's seat");
  assert.equal((await call("thayra23", { op: "liveBeat", id })).ok, false, "or read who's joining");
  assert.equal((await call("thayra23", { op: "liveEnd", id })).ok, false, "or end it");
});

test("bad input is refused, and a second session replaces the first", async () => {
  reset();
  assert.equal((await call("baby", { op: "liveStart", group: "family", muscle: "toes", level: "beginner" })).ok, false);
  assert.equal((await call("baby", { op: "liveStart", group: "family", muscle: "back" })).ok, false);
  const first = await call("baby", { op: "liveStart", group: "family", muscle: "back", level: "average" });
  assert.equal((await call("aelson", { op: "liveJoin", id: first.id, offer: "<script>" })).ok, false, "only real connection offers");
  const second = await call("baby", { op: "liveStart", group: "family", muscle: "arms", level: "average" });
  const list = await call("aelson", { op: "live", group: "family" });
  assert.deepEqual(list.sessions.map((s) => s.id), [second.id]);
});

test("a session holds a few people at most", async () => {
  reset();
  const { id } = await call("baby", { op: "liveStart", group: "family", muscle: "core", level: "beginner" });
  for (let i = 0; i < MAX_WATCHING; i++) DB.snapcal_live_signals.push({ id: `s${i}`, live_id: id, viewer: `x${i}`, offer: SDP, answer: SDP, left_at: null, last_seen: now(), created_at: now() });
  assert.equal((await call("aelson", { op: "liveJoin", id, offer: SDP })).errorType, "full");
});

test("a TURN relay is offered only when it's fully configured", () => {
  assert.equal(iceServers({}).length, 1);
  assert.equal(iceServers({ LIVE_TURN_URLS: "turn:a.example:3478" }).length, 1);
  const withTurn = iceServers({ LIVE_TURN_URLS: "turn:a.example:3478, turns:a.example:443", LIVE_TURN_USERNAME: "u", LIVE_TURN_CREDENTIAL: "p" });
  assert.deepEqual(withTurn[1], { urls: ["turn:a.example:3478", "turns:a.example:443"], username: "u", credential: "p" });
});

test("the feed puts people at your level first, and the level filter keeps only them", () => {
  const s = [{ id: "a", level: "expert" }, { id: "b", level: "beginner" }, { id: "c", level: "expert" }, { id: "d", level: "beginner" }];
  assert.deepEqual(orderSessions(s, { level: "beginner" }).map((x) => x.id), ["b", "d", "a", "c"]);
  assert.deepEqual(orderSessions(s).map((x) => x.id), ["a", "b", "c", "d"]);
  assert.deepEqual(orderSessions(s, { level: "beginner", only: "expert" }).map((x) => x.id), ["a", "c"]);
  assert.equal(liveSupported({}), false);
  assert.equal(typeof workoutLabel, "function");
});

test("deleting an account removes its live sessions and seats", async () => {
  const { readFile } = await import("node:fs/promises");
  const src = await readFile(new URL("../api/_account-data.js", import.meta.url), "utf8");
  assert.match(src, /\["snapcal_live", "owner"\]/);
  assert.match(src, /\["snapcal_live_signals", "viewer"\]/);
});
