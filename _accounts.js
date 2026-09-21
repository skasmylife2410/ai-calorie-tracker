// api/_accounts.js — user accounts stored in Supabase, replacing the APP_USERS env variable.
//
// Why: APP_USERS meant every change (adding a person, a forgotten passcode) was an edit to a
// hidden Vercel setting that nobody could read back. Accounts live in the database instead:
//   snapcal_users(username, password_hash, salt, must_change, created_at)
//
// Passwords are hashed with PBKDF2-SHA256 (210k iterations, per OWASP 2023) and a per-user
// random salt. The plain password is never stored and never leaves this file.
//
// Sessions are stateless: a token is `username.expiry.hmac`, signed with APP_SECRET. No session
// table to clean up, and revoking everything is just rotating APP_SECRET.

import crypto from "node:crypto";

const ITERATIONS = 210000;
const KEYLEN = 32;
const DIGEST = "sha256";
const SESSION_DAYS = 180; // long, because this is a phone app people keep open for months

export const USERNAME_RE = /^[a-z0-9_-]{2,40}$/;

export function normalizeUsername(raw) {
  return String(raw ?? "").trim().toLowerCase();
}

/** @returns {{salt:string, hash:string}} */
export function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.pbkdf2Sync(String(password), salt, ITERATIONS, KEYLEN, DIGEST).toString("hex");
  return { salt, hash };
}

/** Constant-time compare, so a wrong password can't be found by timing the response. */
export function verifyPassword(password, salt, expectedHash) {
  if (typeof salt !== "string" || typeof expectedHash !== "string") return false;
  const { hash } = hashPassword(password, salt);
  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(expectedHash, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function secret() {
  // APP_SECRET signs sessions. Falling back to the old APP_TOKEN keeps a deployment that hasn't
  // set APP_SECRET yet working rather than locking everyone out.
  return process.env.APP_SECRET || process.env.APP_TOKEN || "snapcal-dev-secret";
}

export function createSession(username, days = SESSION_DAYS) {
  const exp = Date.now() + days * 86400000;
  const body = `${username}.${exp}`;
  return `${body}.${sign(body)}`;
}

function sign(body) {
  return crypto.createHmac("sha256", secret()).update(body).digest("hex");
}

/**
 * @returns {string|null} the username, or null if the token is missing, forged or expired.
 */
export function readSession(token) {
  const parts = String(token ?? "").split(".");
  if (parts.length !== 3) return null;
  const [username, exp, mac] = parts;
  const expected = sign(`${username}.${exp}`);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  if (!Number.isFinite(Number(exp)) || Number(exp) < Date.now()) return null;
  if (!USERNAME_RE.test(username)) return null;
  return username;
}

/** Password rules kept deliberately mild: 8+ characters, anything goes. */
export function passwordProblem(password) {
  const p = String(password ?? "");
  if (p.length < 8) return "tooShort";
  if (p.length > 200) return "tooLong";
  return null;
}
