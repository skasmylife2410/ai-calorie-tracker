// auth.test.mjs — accounts: hashing, sessions, and every way login can be abused.
import test from "node:test";
import assert from "node:assert/strict";

process.env.APP_SECRET = "test-secret";
process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_x";
process.env.INVITE_CODE = "arepa";

const acct = await import("../api/_accounts.js");
const { default: auth } = await import("../api/auth.js");
const { checkAuth } = await import("../api/_auth.js");

const mockRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
const req = (body, token) => ({ method: "POST", headers: token ? { "x-snapcal-token": token } : {}, body });

// a tiny in-memory stand-in for the snapcal_users table
let USERS = [];
globalThis.fetch = async (url, opts = {}) => {
  const u = new URL(url);
  const method = opts.method ?? "GET";
  if (method === "GET") {
    const eq = u.searchParams.get("username")?.replace("eq.", "");
    return { ok: true, json: async () => USERS.filter((r) => r.username === eq) };
  }
  const payload = JSON.parse(opts.body);
  if (method === "POST") USERS.push(...payload);
  if (method === "PATCH") {
    const eq = decodeURIComponent(u.searchParams.get("username").replace("eq.", ""));
    USERS = USERS.map((r) => (r.username === eq ? { ...r, ...payload } : r));
  }
  return { ok: true, text: async () => "" };
};

test("password hashing is salted and verifies only the right password", () => {
  const a = acct.hashPassword("arepa con queso");
  const b = acct.hashPassword("arepa con queso");
  assert.notEqual(a.salt, b.salt, "each hash gets its own salt");
  assert.notEqual(a.hash, b.hash, "same password, different stored hash");
  assert.equal(acct.verifyPassword("arepa con queso", a.salt, a.hash), true);
  assert.equal(acct.verifyPassword("arepa con quesos", a.salt, a.hash), false);
  assert.equal(acct.verifyPassword("", a.salt, a.hash), false);
  assert.equal(acct.verifyPassword("x", null, undefined), false);
});

test("sessions are signed, expire, and cannot be forged or re-pointed", () => {
  const token = acct.createSession("aelson");
  assert.equal(acct.readSession(token), "aelson");
  assert.equal(acct.readSession(token.replace("aelson", "baby")), null, "swapping the username breaks the signature");
  assert.equal(acct.readSession(token.slice(0, -4) + "0000"), null);
  assert.equal(acct.readSession("garbage"), null);
  assert.equal(acct.readSession(""), null);
  assert.equal(acct.readSession(acct.createSession("aelson", -1)), null, "expired token is rejected");
});

test("sign-up needs the invite code and a real password", async () => {
  USERS = [];
  let res = mockRes();
  await auth(req({ op: "signup", username: "thayra23", password: "cumbia7431", invite: "wrong" }), res);
  assert.equal(res.body.errorType, "badInvite");

  res = mockRes();
  await auth(req({ op: "signup", username: "thayra23", password: "short", invite: "arepa" }), res);
  assert.equal(res.body.errorType, "tooShort");

  res = mockRes();
  await auth(req({ op: "signup", username: "Thayra 23!", password: "cumbia7431", invite: "arepa" }), res);
  assert.equal(res.body.errorType, "badUsername");

  res = mockRes();
  await auth(req({ op: "signup", username: "THAYRA23", password: "cumbia7431", invite: "arepa" }), res);
  assert.equal(res.body.ok, true);
  assert.equal(acct.readSession(res.body.token), "thayra23", "usernames are lower-cased");

  res = mockRes();
  await auth(req({ op: "signup", username: "thayra23", password: "otherpassword", invite: "arepa" }), res);
  assert.equal(res.body.errorType, "taken");
});

test("login works, and wrong user and wrong password look identical", async () => {
  let res = mockRes();
  await auth(req({ op: "login", username: "thayra23", password: "cumbia7431" }), res);
  assert.equal(res.body.ok, true);
  assert.equal(acct.readSession(res.body.token), "thayra23");

  const wrongPass = mockRes();
  await auth(req({ op: "login", username: "thayra23", password: "nope12345" }), wrongPass);
  const noUser = mockRes();
  await auth(req({ op: "login", username: "nobody", password: "nope12345" }), noUser);
  assert.deepEqual(wrongPass.body, noUser.body, "the reply must not reveal who has an account");
});

test("changing a password needs the old one or a valid session, and invalidates nothing else", async () => {
  let res = mockRes();
  await auth(req({ op: "change", username: "thayra23", password: "wrongpass", newPassword: "newpassword1" }), res);
  assert.equal(res.body.errorType, "unauthorized");

  res = mockRes();
  await auth(req({ op: "change", username: "thayra23", password: "cumbia7431", newPassword: "newpassword1" }), res);
  assert.equal(res.body.ok, true);

  res = mockRes();
  await auth(req({ op: "login", username: "thayra23", password: "newpassword1" }), res);
  assert.equal(res.body.ok, true);

  res = mockRes();
  await auth(req({ op: "login", username: "thayra23", password: "cumbia7431" }), res);
  assert.equal(res.body.errorType, "badLogin", "the old password stops working");
});

test("a session identifies the caller to every other endpoint", () => {
  const res = mockRes();
  assert.equal(checkAuth({ headers: { "x-snapcal-token": acct.createSession("baby") } }, res), "baby");
  assert.equal(checkAuth({ headers: { "x-snapcal-token": "not-a-session" } }, mockRes()), false);
});

test("whoami reports the signed-in user and nothing else", async () => {
  let res = mockRes();
  await auth(req({ op: "whoami" }, acct.createSession("aelson")), res);
  assert.deepEqual(res.body, { ok: true, username: "aelson" });

  res = mockRes();
  await auth(req({ op: "whoami" }, "junk"), res);
  assert.equal(res.body.errorType, "unauthorized");
});

test("GET is rejected", async () => {
  const res = mockRes();
  await auth({ method: "GET", headers: {}, body: {} }, res);
  assert.equal(res.code, 405);
});
