// updater.test.mjs — automatic updates: the live version is reported without signing in, and a
// reload never happens over an open sheet or half-typed text.
import test from "node:test";
import assert from "node:assert/strict";

process.env.APP_SECRET = "test-secret";
process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.VERCEL_DEPLOYMENT_ID = "dpl_test123";

const { default: auth } = await import("../api/auth.js");
const { safeToReload } = await import("../js/updater.js");

const mockRes = () => ({ code: 200, body: null, headers: {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, setHeader(k, v) { this.headers[k] = v; } });

test("GET /api/auth?op=version reports the live deployment, uncached, without a session", async () => {
  const res = mockRes();
  await auth({ method: "GET", url: "/api/auth?op=version", headers: {} }, res);
  assert.deepEqual(res.body, { ok: true, version: "dpl_test123" });
  assert.equal(res.headers["Cache-Control"], "no-store");
  const other = mockRes();
  await auth({ method: "GET", url: "/api/auth?op=whoami", headers: {} }, other);
  assert.equal(other.code, 405, "nothing else answers GET");
});

/** A tiny stand-in for the page, with just what safeToReload looks at. */
function fakeDoc({ hidden = false, open = null, focused = null, typed = "" } = {}) {
  const inputs = typed ? [{ value: typed, offsetParent: {} }] : [];
  return {
    visibilityState: hidden ? "hidden" : "visible",
    activeElement: focused,
    querySelector: (sel) => (open && sel.includes(open) ? {} : null),
    querySelectorAll: () => inputs,
  };
}

test("reloading waits for a moment that loses nothing", () => {
  assert.equal(safeToReload(fakeDoc()), true, "nothing open");
  assert.equal(safeToReload(fakeDoc({ hidden: true, open: ".sheet-panel" })), true, "in the background, always fine");
  assert.equal(safeToReload(fakeDoc({ open: ".sheet-panel" })), false, "a sheet is open");
  assert.equal(safeToReload(fakeDoc({ open: ".fullscreen-cover" })), false, "the camera is open");
  assert.equal(safeToReload(fakeDoc({ focused: { tagName: "TEXTAREA" } })), false, "someone is typing");
  assert.equal(safeToReload(fakeDoc({ typed: "half a comment" })), false, "text waiting to be sent");
  assert.equal(safeToReload(fakeDoc({ focused: { tagName: "BUTTON" } })), true);
});
