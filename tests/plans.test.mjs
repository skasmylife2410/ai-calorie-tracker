// plans.test.mjs — planned group workouts: once or every week at a local time, answers per day
// (or every time) with each person's own split, and one reminder an hour before to the ones in.
import test from "node:test";
import assert from "node:assert/strict";

process.env.APP_SECRET = "test-secret";
process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_x";

const { createSession } = await import("../api/_accounts.js");
const { default: groups } = await import("../api/groups.js");
const { momentOf, dayIn, occurrences, goingOn, planReminders, splitName } = await import("../api/_plans.js");

const mockRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
const as = (user, body) => ({ method: "POST", headers: { "x-snapcal-token": createSession(user, undefined, { salt: "test-salt" }) }, body });
const call = async (user, body) => { const r = mockRes(); await groups(as(user, body), r); return r.body; };

let DB; const pushed = [];
const reset = () => { pushed.length = 0; DB = {
  snapcal_users: [{ username: "aelson" }, { username: "baby" }, { username: "thayra23" }, { username: "loner" }],
  snapcal_groups: [{ id: "family", name: "Family", created_by: "aelson" }, { id: "work", name: "Work", created_by: "aelson" }],
  snapcal_group_members: [
    { group_id: "family", username: "aelson", joined_at: "1" }, { group_id: "family", username: "baby", joined_at: "2" },
    { group_id: "family", username: "thayra23", joined_at: "3" }, { group_id: "work", username: "loner", joined_at: "4" },
  ],
  snapcal_profile: [{ owner: "baby", data: { displayName: "Mi baby" } }],
  snapcal_plans: [], snapcal_plan_rsvps: [], snapcal_plan_sent: [], snapcal_ticks: [], snapcal_push_subs: [],
}; };
const cond = (row, k, v) => {
  if (v === "is.null") return row[k] === null || row[k] === undefined;
  const [op, ...rest] = v.split("."); const val = rest.join(".");
  if (op === "eq") return String(row[k]) === val;
  if (op === "neq") return String(row[k]) !== val;
  if (op === "gt") return String(row[k]) > val;
  if (op === "in") return val.replace(/[()"]/g, "").split(",").includes(String(row[k]));
  throw new Error(`mock: unknown filter ${k}=${v}`);
};
const ok = (row, params) => [...params.entries()].every(([k, v]) => ["select", "order", "limit", "on_conflict"].includes(k) || cond(row, k, v));
const KEYS = { snapcal_plan_rsvps: ["plan_id", "day", "username"], snapcal_ticks: ["name"], snapcal_plan_sent: ["plan_id", "day", "kind"] };
globalThis.fetch = async (url, opts = {}) => {
  const u = new URL(url); const table = u.pathname.split("/").pop(); const m = opts.method ?? "GET";
  const rows = (DB[table] ??= []);
  if (m === "DELETE") { DB[table] = rows.filter((r) => !ok(r, u.searchParams)); return { ok: true, text: async () => "" }; }
  if (m === "GET") return { ok: true, json: async () => rows.filter((r) => ok(r, u.searchParams)) };
  if (m === "POST") {
    for (const r of [].concat(JSON.parse(opts.body))) {
      const key = KEYS[table];
      const same = key && rows.find((x) => key.every((k) => x[k] === r[k]));
      if (same && u.searchParams.get("on_conflict")) Object.assign(same, r);
      else if (same) return { ok: false, status: 409, text: async () => "duplicate" };
      else rows.push({ ended_at: null, ...r });
    }
    return { ok: true, text: async () => "" };
  }
  if (m === "PATCH") { const f = JSON.parse(opts.body); rows.filter((r) => ok(r, u.searchParams)).forEach((r) => Object.assign(r, f)); return { ok: true, json: async () => [], text: async () => "" }; }
};

test("times: a local time in the planner's zone, through daylight-saving changes", () => {
  // Bogotá is UTC-5 all year
  assert.equal(new Date(momentOf("2026-11-20", "18:00", "America/Bogota")).toISOString(), "2026-11-20T23:00:00.000Z");
  // Chicago: 6pm is 23:00 UTC in summer and 00:00 UTC (next day) in winter
  assert.equal(new Date(momentOf("2026-07-01", "18:00", "America/Chicago")).toISOString(), "2026-07-01T23:00:00.000Z");
  assert.equal(new Date(momentOf("2026-12-01", "18:00", "America/Chicago")).toISOString(), "2026-12-02T00:00:00.000Z");
  assert.equal(dayIn("America/Bogota", Date.parse("2026-11-21T03:00:00Z")), "2026-11-20", "10pm the day before in Bogotá");
});

test("sessions: once, or on the chosen weekdays, over the next week", () => {
  const now = Date.parse("2026-11-20T15:00:00Z"); // Friday, 10am in Bogotá
  const weekly = { tz: "America/Bogota", time: "18:00", weekdays: [1, 3, 5] };
  assert.deepEqual(occurrences(weekly, now).map((o) => o.day), ["2026-11-20", "2026-11-23", "2026-11-25"], "a week ahead: next Friday at 6pm is just past it");
  assert.deepEqual(occurrences({ tz: "America/Bogota", time: "07:00", day: "2026-11-22" }, now).map((o) => o.day), ["2026-11-22"]);
  assert.deepEqual(occurrences({ tz: "America/Bogota", time: "07:00", day: "2026-11-19" }, now), [], "past");
  // one that started an hour ago still shows (they may be at it)
  assert.equal(occurrences({ tz: "America/Bogota", time: "09:00", day: "2026-11-20" }, now).length, 1);
});

test("answers: a day's answer beats the every-time one", () => {
  const rs = [
    { plan_id: "p", day: "*", username: "baby", going: true, split: "push" },
    { plan_id: "p", day: "2026-11-23", username: "baby", going: false },
    { plan_id: "p", day: "2026-11-23", username: "thayra23", going: true, split: "legs" },
  ];
  assert.deepEqual(goingOn(rs, "p", "2026-11-23").filter((r) => r.going).map((r) => r.username), ["thayra23"]);
  assert.deepEqual(goingOn(rs, "p", "2026-11-25").filter((r) => r.going).map((r) => r.username), ["baby"]);
  assert.equal(splitName("custom", "Glutes & abs"), "Glutes & abs");
  assert.equal(splitName("pull", null, "es"), "Jalón");
});

test("planning, answering with your own split, and who can see or remove it", async () => {
  reset();
  const tomorrow = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
  assert.equal((await call("baby", { op: "planSave", group: "family", split: "push", time: "18:00", tz: "Nowhere/City", day: tomorrow })).ok, false, "bad time zone");
  assert.equal((await call("baby", { op: "planSave", group: "family", split: "custom", time: "18:00", tz: "America/Bogota", day: tomorrow })).ok, false, "custom needs a name");
  assert.equal((await call("loner", { op: "planSave", group: "family", split: "push", time: "18:00", tz: "America/Bogota", day: tomorrow })).errorType, "notMember");
  const made = await call("baby", { op: "planSave", group: "family", split: "push", place: " Smart  Fit 93 ", time: "18:00", tz: "America/Bogota", weekdays: [0, 1, 2, 3, 4, 5, 6, 9] });
  assert.equal(made.ok, true);
  assert.deepEqual(DB.snapcal_plans[0].weekdays, [0, 1, 2, 3, 4, 5, 6]);
  assert.equal(DB.snapcal_plans[0].place, "Smart Fit 93");

  const list = await call("thayra23", { op: "plans" });
  assert.ok(list.sessions.length >= 7);
  const s = list.sessions.find((x) => x.day === tomorrow);
  assert.deepEqual(s.going.map((g) => [g.name, g.split]), [["Mi baby", "push"]], "whoever plans it is in");
  assert.equal(s.me, null);
  assert.equal((await call("loner", { op: "plans" })).sessions.length, 0, "other groups don't see it");

  await call("thayra23", { op: "planAnswer", plan: made.id, day: tomorrow, going: true, split: "custom", custom: "Glutes & abs" });
  const after = (await call("aelson", { op: "plans" })).sessions.find((x) => x.day === tomorrow);
  assert.deepEqual(after.going.map((g) => [g.name, g.split, g.custom]).sort(), [["Mi baby", "push", null], ["Thayra23", "custom", "Glutes & abs"]]);
  assert.equal((await call("loner", { op: "planAnswer", plan: made.id, day: tomorrow, going: true })).ok, false);
  assert.equal((await call("thayra23", { op: "planAnswer", plan: made.id, day: "2020-01-01", going: true })).ok, false, "not a planned day");

  // every time: replaces their single-day answers
  await call("thayra23", { op: "planAnswer", plan: made.id, every: true, going: true, split: "legs" });
  assert.deepEqual(DB.snapcal_plan_rsvps.filter((r) => r.username === "thayra23").map((r) => r.day), ["*"]);

  assert.equal((await call("thayra23", { op: "planEnd", plan: made.id })).ok, false, "only whoever planned it");
  assert.equal((await call("baby", { op: "planEnd", plan: made.id })).ok, true);
  assert.equal((await call("aelson", { op: "plans" })).sessions.length, 0);
});

test("the reminder: once, an hour before, to the people who are in", async () => {
  reset();
  const now = Date.now();
  const at = new Date(now + 50 * 60000);
  const tz = "America/Bogota";
  const day = dayIn(tz, at.getTime());
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at);
  DB.snapcal_plans.push({ id: "p1", group_id: "family", created_by: "baby", split: "legs", place: "Smart Fit", time, tz, day, weekdays: null, ended_at: null });
  DB.snapcal_plan_rsvps.push({ plan_id: "p1", day: "*", username: "baby", going: true, split: "legs" }, { plan_id: "p1", day, username: "thayra23", going: false });
  const first = await planReminders(now);
  assert.equal(first.due, 1);
  assert.deepEqual(DB.snapcal_plan_sent.map((r) => [r.plan_id, r.day, r.kind]), [["p1", day, "hour"]]);
  assert.deepEqual(await planReminders(now + 1000), { skipped: true }, "at most once a minute");
  const again = await planReminders(now + 2 * 60000);
  assert.equal(DB.snapcal_plan_sent.length, 1, "never twice for the same session");
  assert.equal(again.sent ?? 0, 0);
});
