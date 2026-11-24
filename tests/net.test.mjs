// A refused session sends people back to sign-in (never the old passcode prompt), keeping their meals.
import test from "node:test";
import assert from "node:assert/strict";

const store = new Map();
const mem = () => ({ getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) });
globalThis.localStorage = mem();
globalThis.sessionStorage = mem();
let reloads = 0;
globalThis.location = { reload: () => { reloads += 1; } };
let status = 200;
globalThis.fetch = async () => ({ status });

const net = await import("../js/net.js");

test("a 401 with a session clears it once and asks for sign-in; meals and username stay", async () => {
  localStorage.setItem("snapcal.apiToken", "old.session.token");
  localStorage.setItem("snapcal.username", "linahevel");
  localStorage.setItem("snapcal.foodEntries", "[1]");
  status = 401;
  const res = await net.apiFetch("/api/sync");
  await net.apiFetch("/api/notes");
  assert.equal(res.status, 401);
  assert.equal(net.getStoredToken(), "");
  assert.equal(reloads, 1);
  assert.equal(localStorage.getItem("snapcal.username"), "linahevel");
  assert.equal(localStorage.getItem("snapcal.foodEntries"), "[1]");
  assert.equal(net.takeSessionEnded(), true);
  assert.equal(net.takeSessionEnded(), false);
});

test("without a session a 401 doesn't reload (no loop on the sign-in screen)", async () => {
  status = 401;
  const before = reloads;
  await net.apiFetch("/api/gif");
  assert.equal(reloads, before);
});
