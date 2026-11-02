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
  // set APP_SECRET yet working rather than locking everyone out. The built-in value is public
  // (it's in this file), so it is only ever used on a laptop with ALLOW_ANONYMOUS=1: anywhere
  // else, no secret means no sessions at all rather than sessions anyone could forge.
  const s = (process.env.APP_SECRET || process.env.APP_TOKEN || "").trim();
  if (s) return s;
  return process.env.ALLOW_ANONYMOUS === "1" ? "snapcal-dev-secret" : "";
}

/**
 * Sessions carry a stamp of the password they were made with (a hash of its salt, which changes
 * with every new password). The server compares it with the account's current one on every
 * request (api/_auth.js), so changing or resetting a password signs out every other phone,
 * including a lost or stolen one.
 */
export function sessionStamp(salt) {
  return crypto.createHash("sha256").update(`snapcal-session:${salt}`).digest("hex").slice(0, 16);
}

/** Sessions made before stamps existed keep working until this date, while phones swap them
 *  for stamped ones on their next start (api/auth.js whoami). After it they're refused. */
export const LEGACY_SESSIONS_UNTIL = Date.parse("2026-11-15T00:00:00Z");

export function createSession(username, days = SESSION_DAYS, { salt = null } = {}) {
  if (!secret()) throw new Error("APP_SECRET is not set");
  const exp = Date.now() + days * 86400000;
  const body = salt ? `${username}.${exp}.${sessionStamp(salt)}` : `${username}.${exp}`;
  return `${body}.${sign(body)}`;
}

function sign(body) {
  return crypto.createHmac("sha256", secret()).update(body).digest("hex");
}

/**
 * @returns {{username:string, stamp:string|null}|null} who the token is for and its password
 *   stamp (null for an older, unstamped session), or null if missing, forged or expired.
 */
export function readSessionDetail(token) {
  const parts = String(token ?? "").split(".");
  if (parts.length !== 3 && parts.length !== 4) return null;
  const [username, exp] = parts;
  const stamp = parts.length === 4 ? parts[2] : null;
  const mac = parts[parts.length - 1];
  if (!secret()) return null;
  const expected = sign(parts.slice(0, -1).join("."));
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  if (!Number.isFinite(Number(exp)) || Number(exp) < Date.now()) return null;
  if (!USERNAME_RE.test(username)) return null;
  if (stamp !== null && !/^[0-9a-f]{16}$/.test(stamp)) return null;
  return { username, stamp };
}

/**
 * @returns {string|null} the username, or null if the token is missing, forged or expired.
 * Signature and expiry only: whether the password has changed since is checked by
 * api/_auth.js (sessionStillValid), which knows the account's current stamp.
 */
export function readSession(token) {
  return readSessionDetail(token)?.username ?? null;
}

/**
 * The passwords tried first by anyone guessing (the top of the public breach lists), all 8+
 * characters so the length rule doesn't already catch them. Compared lowercased.
 */
const COMMON_PASSWORDS = new Set([
  "password", "password1", "password12", "password123", "passw0rd", "p@ssw0rd", "p@ssword",
  "12345678", "123456789", "1234567890", "0123456789", "87654321", "11111111", "00000000",
  "12341234", "12121212", "11223344", "123123123", "1q2w3e4r", "1qaz2wsx", "qwertyui",
  "qwerty12", "qwerty123", "qwertyuiop", "asdfghjk", "asdfasdf", "zxcvbnm1", "abcd1234",
  "abc12345", "abcdefgh", "aa123456", "iloveyou", "iloveyou1", "sunshine", "princess",
  "football", "baseball", "superman", "starwars", "whatever", "trustno1", "letmein1",
  "welcome1", "welcome123", "changeme", "computer", "internet", "michelle", "jennifer",
  "contraseña", "contrasena", "contrasena1", "teamo123", "snapcal1", "snapcal123",
]);

/**
 * Password rules kept deliberately mild: 8+ characters, anything goes, except a password from
 * the guessing lists, one character repeated, or the username itself (NIST SP 800-63B 5.1.1.2).
 */
export function passwordProblem(password, username = "") {
  const p = String(password ?? "");
  if (p.length < 8) return "tooShort";
  if (p.length > 200) return "tooLong";
  const lower = p.toLowerCase();
  if (COMMON_PASSWORDS.has(lower) || /^(.)\1+$/.test(p)) return "common";
  if (username && lower.includes(String(username).toLowerCase())) return "common";
  return null;
}

/** What to tell someone whose new password passwordProblem() refused. */
export function passwordMessage(problem) {
  if (problem === "common") return "That password is too easy to guess. Pick something less common, and not your username.";
  if (problem === "tooLong") return "That password is too long (200 characters at most).";
  return "Password must be at least 8 characters.";
}

const DUMMY_SALT = crypto.randomBytes(16).toString("hex");
const DUMMY_HASH = hashPassword("not-a-real-password", DUMMY_SALT).hash;

/**
 * Same as verifyPassword, but takes as long when there is no such account. Without the decoy,
 * "no such user" answers in a millisecond and "wrong password" in ~100ms, so the identical
 * error message would still tell an attacker which usernames exist.
 */
export function checkPassword(password, user) {
  if (!user) {
    verifyPassword(password, DUMMY_SALT, DUMMY_HASH);
    return false;
  }
  return verifyPassword(password, user.salt, user.password_hash);
}
