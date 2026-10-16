// nudge.test.mjs — reminders for people who haven't logged in 24 hours, without nagging.
import test from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_x";
const { nudgeDue, nudgeInactive } = await import("../api/weekly.js");

test("daily for 3 days, then every third day, never after two weeks", () => {
  assert.equal(nudgeDue(10), false, "logged today");
  assert.equal(nudgeDue(25), true);
  assert.equal(nudgeDue(24 * 2 + 5), true);
  assert.equal(nudgeDue(24 * 3 + 5), true);
  assert.equal(nudgeDue(24 * 4 + 5), false);
  assert.equal(nudgeDue(24 * 6 + 5), true);
  assert.equal(nudgeDue(24 * 15 + 5), false, "gone quiet: stop");
});

test("only people past 24 hours are picked", async () => {
  const now = Date.parse("2026-10-02T14:00:00Z");
  const iso = (h) => new Date(now - h * 3600000).toISOString();
  globalThis.fetch = async (url) => {
    const table = new URL(url).pathname.split("/").pop();
    const data = {
      snapcal_users: [{ username: "ana" }, { username: "ben" }, { username: "cy" }],
      snapcal_food_entries: [{ owner: "ana", logged_at: iso(3) }, { owner: "ben", logged_at: iso(30) }, { owner: "ben", logged_at: iso(50) }],
      snapcal_profile: [],
    }[table] ?? [];
    return { ok: true, status: 200, json: async () => data, text: async () => "" };
  };
  const out = await nudgeInactive(now);
  assert.equal(out.due, 1, "ben only: ana logged today, cy has nothing recent");
});

test("quiet rule: 3 full days without a meal warn, 2 days later the owner is told", async () => {
  const { quietDays } = await import("../js/nutrition.js");
  assert.deepEqual(quietDays("2026-10-12", "2026-10-01"), { warnDay: "2026-10-16", tellDay: "2026-10-18" }, "13, 14 and 15 empty");
  assert.deepEqual(quietDays("2026-10-06", "2026-10-17"), { warnDay: "2026-10-17", tellDay: "2026-10-19" }, "already quiet: the rule's first morning");
  assert.equal(quietDays(null), null, "never logged: not this rule");
});

test("quiet warnings: the phone's own day totals count, and the owner is never warned", async () => {
  const { quietWarnings, quietWarning, quietOwnerNote } = await import("../api/weekly.js");
  const now = Date.parse("2026-10-21T14:00:00Z"); // 9am in Chicago
  globalThis.fetch = async (url) => {
    const u = new URL(url);
    const table = u.pathname.split("/").pop();
    const select = u.searchParams.get("select") ?? "";
    const data = {
      snapcal_users: [{ username: "aelson" }, { username: "ana" }, { username: "bo" }, { username: "cy" }, { username: "di" }],
      // server meals: ana stopped on the 17th, bo's uploads stopped on the 10th, cy on the 15th
      snapcal_food_entries: [{ owner: "ana", day: "2026-10-17" }, { owner: "bo", day: "2026-10-10" }, { owner: "cy", day: "2026-10-15" }, { owner: "aelson", day: "2026-10-01" }],
      // bo's phone still logs every day; profile rows answer both the names and the day totals
      snapcal_profile: select.includes("daySummaries")
        ? [{ owner: "bo", days: { "2026-10-20": { meals: 3 }, "2026-10-21": { meals: 1 } } }]
        : [{ owner: "ana", name: "Ana" }, { owner: "cy", name: "Cy" }],
    }[table] ?? [];
    return { ok: true, status: 200, json: async () => data, text: async () => "" };
  };
  const out = await quietWarnings(now);
  assert.deepEqual(out.warned, ["ana"], "18, 19 and 20 empty");
  assert.deepEqual(out.told, ["cy"], "warned on the 19th, nothing since");
  assert.equal(quietWarning({ name: "Ana", days: 3, lang: "es" }).title, "Ana, 3 días sin registrar");
  assert.match(quietWarning({ name: "Ana", days: 3 }).body, /next 2 days/);
  assert.equal(quietOwnerNote(["Cy"]).title, "Cy still isn't logging");
  assert.equal(quietOwnerNote(["Cy", "Di"], "es").title, "2 personas siguen sin registrar");
});
