// live.test.mjs — "Train together": go live for a group; people in it swipe through whoever is
// live. The server only passes the connection offer and answer between phones.
import test from "node:test";
import assert from "node:assert/strict";

process.env.APP_SECRET = "test-secret";
process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_x";

const { createSession } = await import("../api/_accounts.js");
const { default: groups } = await import("../api/groups.js");
const { iceServers, MAX_WATCHING, levelFromLog } = await import("../api/_live.js");
const { elapsed, twoDigits, workoutLabel, liveSupported } = await import("../js/ui/live.js");

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
  snapcal_live: [], snapcal_live_signals: [], snapcal_exercise: [],
}; };
const cond = (row, k, v) => {
  if (v === "is.null") return row[k] === null || row[k] === undefined;
  if (v === "not.is.null") return row[k] !== null && row[k] !== undefined;
  const [op, ...rest] = v.split("."); const val = rest.join(".");
  if (op === "eq") return String(row[k]) === val;
  if (op === "gt") return String(row[k]) > val;
  if (op === "gte") return String(row[k]) >= val;
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
  const start = await call("baby", { op: "liveStart", group: "family", muscle: "chest" });
  assert.equal(start.ok, true);

  const seen = await call("thayra23", { op: "live", group: "family" });
  assert.equal(seen.sessions.length, 1);
  assert.deepEqual([seen.sessions[0].name, seen.sessions[0].muscle, seen.sessions[0].level], ["Mi baby", "chest", "beginner"], "no log yet: beginner");
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
  const fam = await call("thayra23", { op: "liveStart", group: "family", muscle: "back" });
  const work = await call("loner", { op: "liveStart", group: "work", muscle: "arms" });
  const babyFeed = await call("baby", { op: "live" });
  assert.deepEqual(babyFeed.sessions.map((s) => s.id).sort(), [fam.id, work.id].sort());
  assert.equal(babyFeed.sessions.find((s) => s.id === work.id).group, "Work");
  assert.deepEqual((await call("aelson", { op: "live" })).sessions.map((s) => s.id), [fam.id], "not the Work stream");
});

test("only people in the group see or join it, and only the person live can answer", async () => {
  reset();
  const { id } = await call("baby", { op: "liveStart", group: "family", muscle: "legs" });
  assert.equal((await call("loner", { op: "live", group: "family" })).errorType, "notMember");
  assert.equal((await call("loner", { op: "liveJoin", id, offer: SDP })).errorType, "notMember");
  assert.equal((await call("loner", { op: "liveStart", group: "family", muscle: "legs" })).errorType, "notMember");
  const { signal } = await call("aelson", { op: "liveJoin", id, offer: SDP });
  assert.equal((await call("thayra23", { op: "liveAnswer", signal, answer: SDP })).ok, false, "someone else can't answer");
  assert.equal((await call("thayra23", { op: "liveWait", signal })).ok, false, "or read someone else's seat");
  assert.equal((await call("thayra23", { op: "liveBeat", id })).ok, false, "or read who's joining");
  assert.equal((await call("thayra23", { op: "liveEnd", id })).ok, false, "or end it");
});

test("bad input is refused, and a second session replaces the first", async () => {
  reset();
  assert.equal((await call("baby", { op: "liveStart", group: "family", muscle: "toes" })).ok, false);
  assert.equal((await call("baby", { op: "liveStart", group: "family" })).ok, false, "a workout is needed");
  const first = await call("baby", { op: "liveStart", group: "family", muscle: "back" });
  assert.equal((await call("aelson", { op: "liveJoin", id: first.id, offer: "<script>" })).ok, false, "only real connection offers");
  const second = await call("baby", { op: "liveStart", group: "family", muscle: "arms" });
  const list = await call("aelson", { op: "live", group: "family" });
  assert.deepEqual(list.sessions.map((s) => s.id), [second.id]);
});

test("a session holds a few people at most", async () => {
  reset();
  const { id } = await call("baby", { op: "liveStart", group: "family", muscle: "core" });
  for (let i = 0; i < MAX_WATCHING; i++) DB.snapcal_live_signals.push({ id: `s${i}`, live_id: id, viewer: `x${i}`, offer: SDP, answer: SDP, left_at: null, last_seen: now(), created_at: now() });
  assert.equal((await call("aelson", { op: "liveJoin", id, offer: SDP })).errorType, "full");
});

test("a TURN relay is offered only when it's fully configured", () => {
  assert.equal(iceServers({}).length, 1);
  assert.equal(iceServers({ LIVE_TURN_URLS: "turn:a.example:3478" }).length, 1);
  const withTurn = iceServers({ LIVE_TURN_URLS: "turn:a.example:3478, turns:a.example:443", LIVE_TURN_USERNAME: "u", LIVE_TURN_CREDENTIAL: "p" });
  assert.deepEqual(withTurn[1], { urls: ["turn:a.example:3478", "turns:a.example:443"], username: "u", credential: "p" });
});

test("the level comes from the exercise log, not from the phone", async () => {
  const today = "2026-11-20";
  const day = (n) => new Date(Date.parse(`${today}T00:00:00Z`) - n * 864e5).toISOString().slice(0, 10);
  const gym = (n, extra = {}) => ({ day: day(n), data: { activity: "gym", minutes: 45, intensity: "moderate", ...extra } });
  assert.equal(levelFromLog([], { today }).level, "beginner");
  // twice a week for eight weeks: average
  const twice = Array.from({ length: 16 }, (_, i) => gym(i * 3.5 | 0));
  assert.equal(levelFromLog(twice, { today, firstDay: day(200) }).level, "average");
  // four times a week, logging for months: expert; the same but only three weeks of history: not yet
  const four = Array.from({ length: 32 }, (_, i) => gym(Math.floor(i * 1.75)));
  assert.equal(levelFromLog(four, { today, firstDay: day(200) }).level, "expert");
  assert.equal(levelFromLog(four, { today, firstDay: day(20) }).level, "average");
  // easy walks, short sessions, deleted ones and two on one day don't add up
  const fluff = [gym(1, { activity: "walk", intensity: "easy" }), gym(2, { minutes: 10 }), gym(3, { deleted: true }), gym(4), gym(4), gym(80)];
  const out = levelFromLog(fluff, { today, firstDay: day(200) });
  assert.deepEqual([out.level, out.trainingDays, out.weeks], ["beginner", 1, 8]);
  assert.equal(levelFromLog([gym(1, { activity: "walk", intensity: "hard" })], { today }).trainingDays, 1, "a hard walk counts");

  // the server uses it when going live, whatever the phone sends
  reset();
  const now = new Date().toISOString().slice(0, 10);
  const back = (n) => new Date(Date.parse(`${now}T00:00:00Z`) - n * 864e5).toISOString().slice(0, 10);
  // (the mock ignores "order", so the oldest row goes first)
  DB.snapcal_exercise = [{ owner: "baby", day: back(300), data: { activity: "gym", minutes: 50 } }]
    .concat(Array.from({ length: 32 }, (_, i) => ({ owner: "baby", day: back(Math.floor(i * 1.75)), data: { activity: "gym", minutes: 50 } })));
  const start = await call("baby", { op: "liveStart", group: "family", muscle: "chest", level: "beginner" });
  assert.equal(start.level, "expert");
  assert.equal((await call("aelson", { op: "live" })).sessions[0].level, "expert");
  assert.equal((await call("baby", { op: "liveLevel" })).level, "expert");
});

test("the live clock and the watcher count", () => {
  const at = "2026-11-20T10:00:00Z";
  assert.equal(elapsed(at, Date.parse(at) + 247e3), "4:07");
  assert.equal(elapsed(at, Date.parse(at) + 3729e3), "1:02:09");
  assert.equal(elapsed(at, Date.parse(at) - 5e3), "0:00");
  assert.deepEqual([twoDigits(7), twoDigits(0), twoDigits(140)], ["07", "00", "99"]);
  assert.equal(liveSupported({}), false);
  assert.equal(typeof workoutLabel, "function");
});

test("deleting an account removes its live sessions and seats", async () => {
  const { readFile } = await import("node:fs/promises");
  const src = await readFile(new URL("../api/_account-data.js", import.meta.url), "utf8");
  assert.match(src, /\["snapcal_live", "owner"\]/);
  assert.match(src, /\["snapcal_live_signals", "viewer"\]/);
});

test("comments: the live phone passes each one on under the name the server gave, not too fast", async () => {
  const { chatRoom, cleanComment, COMMENT_MAX } = await import("../js/ui/live.js");
  let clock = 1000;
  const room = chatRoom({ now: () => clock });
  const chan = () => ({ readyState: "open", got: [], send(x) { this.got.push(JSON.parse(x)); } });
  const shown = [];
  room.onMessage((m) => shown.push(m));
  const a = chan(), b = chan();
  room.join("s1", a, "Thayra");
  room.join("s2", b, "Aelson");
  assert.deepEqual(b.got[0], { type: "history", items: [] });
  assert.deepEqual(a.got.at(-1), { type: "join", name: "Aelson" }, "everyone sees who joined");

  room.receive("s1", JSON.stringify({ type: "comment", text: "  vamos   con todo ", name: "Someone else" }));
  const c = { type: "comment", name: "Thayra", text: "vamos con todo" };
  assert.deepEqual(b.got.at(-1), c, "named by the seat it came from, never by what it claims");
  assert.deepEqual(shown.at(-1), c, "and the live phone shows it");

  room.receive("s1", JSON.stringify({ type: "comment", text: "again" }));
  assert.notEqual(b.got.at(-1).text, "again", "too soon after the last one");
  clock += 1000;
  room.receive("s1", JSON.stringify({ type: "comment", text: "again" }));
  assert.equal(b.got.at(-1).text, "again");

  room.receive("s2", "not json");
  room.receive("s2", JSON.stringify({ type: "join", name: "Fake" }));
  room.receive("nobody", JSON.stringify({ type: "comment", text: "hi" }));
  assert.equal(b.got.at(-1).text, "again", "anything else is ignored");

  room.receive("s2", JSON.stringify({ type: "heart" }));
  assert.deepEqual(a.got.at(-1), { type: "heart" });

  room.say("gracias!");
  assert.deepEqual(a.got.at(-1), { type: "comment", host: true, text: "gracias!" });

  const late = chan();
  room.join("s3", late, "Mi baby");
  assert.deepEqual(late.got[0].items.map((m) => m.text), ["vamos con todo", "again", "gracias!"], "a late arrival is caught up");
  room.leave("s3");
  assert.equal(room.size, 2);

  assert.equal(cleanComment("a".repeat(400)).length, COMMENT_MAX);
  assert.equal(cleanComment("   "), "");
});

test("watching is muted unless you turned the sound on (your own music keeps playing)", async () => {
  const { soundWanted, SOUND_KEY } = await import("../js/ui/live.js");
  const store = (v) => ({ getItem: (k) => (k === SOUND_KEY ? v : null) });
  assert.equal(soundWanted(store(null)), false, "off until chosen");
  assert.equal(soundWanted(store("1")), true);
  assert.equal(soundWanted(store("0")), false);
  assert.equal(soundWanted({ getItem() { throw new Error("private mode"); } }), false);
  const { readFile } = await import("node:fs/promises");
  const src = await readFile(new URL("../js/ui/live.js", import.meta.url), "utf8");
  const cam = src.slice(src.indexOf("async function camera"), src.indexOf("async function microphone"));
  assert.doesNotMatch(cam, /audio/, "going live doesn't open the mic (that would pause their music)");
});

test("the relay: Cloudflare credentials when it's set up, cached, never port 53, and nothing when it isn't", async () => {
  const { relayServers, resetRelayCache, connectServers } = await import("../api/_live.js");
  resetRelayCache();
  assert.deepEqual(await relayServers({}), []);
  let calls = 0;
  const fetchImpl = async (url, opts) => {
    calls++;
    assert.match(url, /rtc\.live\.cloudflare\.com\/v1\/turn\/keys\/KEY\/credentials\/generate-ice-servers$/);
    assert.equal(opts.headers.Authorization, "Bearer TOKEN");
    return { ok: true, json: async () => ({ iceServers: [{ urls: ["stun:stun.cloudflare.com:3478", "stun:stun.cloudflare.com:53"] }, { urls: ["turn:turn.cloudflare.com:3478?transport=udp", "turn:turn.cloudflare.com:53?transport=udp", "turns:turn.cloudflare.com:443?transport=tcp"], username: "u", credential: "c" }] }) };
  };
  const env = { CF_TURN_KEY_ID: "KEY", CF_TURN_API_TOKEN: "TOKEN" };
  const list = await relayServers(env, { fetchImpl, now: 1000 });
  assert.deepEqual(list[1], { urls: ["turn:turn.cloudflare.com:3478?transport=udp", "turns:turn.cloudflare.com:443?transport=tcp"], username: "u", credential: "c" });
  assert.ok(!list.some((s) => s.urls.some((u) => /:53\b/.test(u))));
  await relayServers(env, { fetchImpl, now: 2000 });
  assert.equal(calls, 1, "cached");
  const all = await connectServers(env, { fetchImpl, now: 3000 });
  assert.ok(all.length >= 3, "STUN plus the relay");
  resetRelayCache();
  assert.deepEqual(await relayServers(env, { fetchImpl: async () => ({ ok: false, status: 401 }), now: 4000 }), [], "a failure never breaks going live");
});
