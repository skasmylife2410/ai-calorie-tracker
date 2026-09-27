// recovery.test.mjs — "Forgot password?" by email: never reveals who has an account, links are
// single-use and only their hash is stored, and setting an email needs the current password.
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

process.env.APP_SECRET = "test-secret";
process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_abc";
process.env.BREVO_API_KEY = "brevo-test";
process.env.MAIL_FROM = "sender@example.com";
process.env.APP_URL = "https://snapcal.example";

const { default: auth } = await import("../api/auth.js");
const acct = await import("../api/_accounts.js");

const mockRes = () => ({ code: 200, body: null, headers: {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, setHeader(k, v) { this.headers[k] = v; } });
const call = async (body, headers = {}) => { const res = mockRes(); await auth({ method: "POST", headers, body }, res); return res; };

/** A tiny in-memory PostgREST: users, reset links, failure counter, and an outbox. */
function fakeDb() {
  const db = { users: [], resets: [], failures: [], mail: [] };
  const pw = acct.hashPassword("oldpassword1");
  db.users.push({ username: "maria", email: "maria@example.com", salt: pw.salt, password_hash: pw.hash, must_change: false });
  db.users.push({ username: "noemail", email: null, salt: pw.salt, password_hash: pw.hash, must_change: false });
  const eq = (u, k) => { const v = u.searchParams.get(k); return v && v.startsWith("eq.") ? decodeURIComponent(v.slice(3)) : null; };
  globalThis.fetch = async (url, opts = {}) => {
    const u = new URL(url);
    const method = opts.method ?? "GET";
    const body = opts.body ? JSON.parse(opts.body) : null;
    const ok = (json = [], status = 200) => ({ ok: status < 300, status, json: async () => json, text: async () => "" });
    if (u.hostname === "api.brevo.com") { db.mail.push(body); return ok({}); }
    const table = u.pathname.split("/").pop();
    if (table === "snapcal_auth_failures") {
      if (method === "POST") { db.failures.push(...body); return ok(); }
      return ok(db.failures.filter((f) => f.key === eq(u, "key")));
    }
    if (table === "snapcal_users") {
      if (method === "GET") {
        const byName = eq(u, "username"), byEmail = eq(u, "email");
        return ok(db.users.filter((x) => (byName && x.username === byName) || (byEmail && x.email === byEmail)));
      }
      if (method === "PATCH") {
        const who = eq(u, "username");
        if (body.email && db.users.some((x) => x.email === body.email && x.username !== who)) return ok([], 409);
        Object.assign(db.users.find((x) => x.username === who), body);
        return ok();
      }
    }
    if (table === "snapcal_password_resets") {
      if (method === "POST") { db.resets.push(...body); return ok(); }
      if (method === "PATCH") {
        const hash = eq(u, "token_hash"), who = eq(u, "username");
        const hits = db.resets.filter((r) => !r.used_at && (hash ? r.token_hash === hash && Date.parse(r.expires_at) > Date.now() : r.username === who));
        hits.forEach((r) => { r.used_at = body.used_at; });
        return ok(hits);
      }
    }
    return ok();
  };
  return db;
}

test("forgot: same answer for a real account, one without email, and nobody", async () => {
  const db = fakeDb();
  const a = await call({ op: "forgot", identifier: "maria" });
  const b = await call({ op: "forgot", identifier: "noemail" });
  const c = await call({ op: "forgot", identifier: "ghost@example.com" });
  assert.deepEqual(a.body, { ok: true });
  assert.deepEqual(b.body, a.body);
  assert.deepEqual(c.body, a.body);
  assert.equal(db.mail.length, 1, "only the account with an email gets one");
  assert.equal(db.mail[0].to[0].email, "maria@example.com");
});

test("the emailed link points at APP_URL, only its hash is stored, and it works once", async () => {
  const db = fakeDb();
  await call({ op: "forgot", identifier: "maria@example.com" }, { host: "evil.example" });
  const link = db.mail[0].textContent.match(/https:\/\/\S+/)[0];
  assert.ok(link.startsWith("https://snapcal.example/?reset="), "never the request's Host");
  const token = new URL(link).searchParams.get("reset");
  assert.equal(db.resets[0].token_hash, crypto.createHash("sha256").update(token).digest("hex"));
  assert.ok(!JSON.stringify(db.resets).includes(token), "the raw token is not stored");

  const ok = await call({ op: "reset", token, newPassword: "brandnewpass" });
  assert.equal(ok.body.ok, true);
  assert.equal(acct.readSession(ok.body.token), "maria");
  const user = db.users.find((u) => u.username === "maria");
  assert.ok(acct.verifyPassword("brandnewpass", user.salt, user.password_hash));

  const again = await call({ op: "reset", token, newPassword: "anotherpass1" });
  assert.equal(again.body.errorType, "badReset");
});

test("forgot is limited per account", async () => {
  const db = fakeDb();
  for (let i = 0; i < 5; i++) await call({ op: "forgot", identifier: "maria" });
  assert.equal(db.mail.length, 3);
});

test("setting an email needs the session AND the current password", async () => {
  const db = fakeDb();
  const session = acct.createSession("maria");
  const noPass = await call({ op: "setEmail", username: "maria", password: "wrong", email: "new@example.com" }, { "x-snapcal-token": session });
  assert.equal(noPass.body.errorType, "unauthorized");
  const noSession = await call({ op: "setEmail", username: "maria", password: "oldpassword1", email: "new@example.com" });
  assert.equal(noSession.body.errorType, "unauthorized");
  const bad = await call({ op: "setEmail", username: "maria", password: "oldpassword1", email: "not an email" }, { "x-snapcal-token": session });
  assert.equal(bad.body.errorType, "badEmail");
  const good = await call({ op: "setEmail", username: "maria", password: "oldpassword1", email: "New@Example.com" }, { "x-snapcal-token": session });
  assert.deepEqual(good.body, { ok: true, email: "new@example.com" });
  assert.equal(db.users[0].email, "new@example.com");
});

test("without Brevo configured, forgot says so instead of pretending", async () => {
  fakeDb();
  const saved = process.env.BREVO_API_KEY;
  delete process.env.BREVO_API_KEY;
  try {
    const out = await call({ op: "forgot", identifier: "maria" });
    assert.equal(out.body.errorType, "mailOff");
  } finally {
    process.env.BREVO_API_KEY = saved;
  }
});
