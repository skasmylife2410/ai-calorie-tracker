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
