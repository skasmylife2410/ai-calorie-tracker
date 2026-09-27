// privacy.test.mjs — "Delete my account" really removes the person from every table that holds
// something about them, and "Download my data" never includes secrets.
import test from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_abc";
const { exportAccount, deleteAccount } = await import("../api/_account-data.js");

function recorder() {
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    const u = new URL(url);
    calls.push({ method: opts.method ?? "GET", table: u.pathname.split("/").pop(), params: Object.fromEntries(u.searchParams), body: opts.body });
    return { ok: true, status: 200, json: async () => [], text: async () => "" };
  };
  return calls;
}

test("delete removes the person from every table that is about them, account last", async () => {
  const calls = recorder();
  await deleteAccount("maria");
  const deleted = calls.filter((c) => c.method === "DELETE");
  const tables = new Set(deleted.map((c) => c.table));
  for (const t of ["snapcal_profile", "snapcal_food_entries", "snapcal_water", "snapcal_exercise", "snapcal_weight",
    "snapcal_favorites", "snapcal_recaps", "snapcal_shares", "snapcal_comments", "snapcal_suggestions",
    "snapcal_notes", "snapcal_group_members", "snapcal_push_subs", "snapcal_users"]) {
    assert.ok(tables.has(t), `${t} is cleared`);
  }
  for (const c of deleted) assert.ok(Object.values(c.params).some((v) => v.includes("maria")), `${c.table} delete is scoped to maria`);
  const notes = deleted.filter((c) => c.table === "snapcal_notes").map((c) => Object.keys(c.params)[0]).sort();
  assert.deepEqual(notes, ["from_user", "to_user"], "notes sent and received");
  assert.equal(deleted[deleted.length - 1].table, "snapcal_users", "the account row goes last");
});

test("export asks for the account without password hash or salt, and push devices without keys", async () => {
  const calls = recorder();
  await exportAccount("maria");
  const user = calls.find((c) => c.table === "snapcal_users");
  assert.ok(!/password_hash|salt/.test(user.params.select));
  const push = calls.find((c) => c.table === "snapcal_push_subs");
  assert.ok(!/p256dh|auth|endpoint/.test(push.params.select));
  for (const c of calls) assert.ok(Object.values(c.params).some((v) => v.includes("maria")), `${c.table} read is scoped to maria`);
});
