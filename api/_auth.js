// api/_auth.js — shared passcode gate for serverless endpoints (Vercel skips files prefixed
// with "_" when building routes, so this never becomes its own endpoint).
//
// Multi-user mode: env APP_USERS = "name1:PIN1,name2:PIN2". The PIN the app sends decides
// WHO is calling; checkAuth() returns that person's name, which api/sync.js uses to keep each
// person's meals, water and profile separate.
// Single-user mode (original behaviour): env APP_TOKEN = "PIN" -> caller is DEFAULT_OWNER.
// Neither set -> gate disabled (local dev), caller is DEFAULT_OWNER.
//
// Returns the owner name (a non-empty string, so it is truthy) or false after sending a 401.

import { readSession, readSessionDetail, sessionStamp, LEGACY_SESSIONS_UNTIL } from "./_accounts.js";
import { clientIp, isLocked, recordFailure, tooMany } from "./_limits.js";

export const DEFAULT_OWNER = (process.env.APP_DEFAULT_USER || "aelson").trim().toLowerCase();

const NAME_RE = /^[a-z0-9_-]{1,40}$/;

/** Parses APP_USERS into a Map<pin, name>. Invalid pairs are ignored. */
export function parseUsers(raw) {
  const users = new Map();
  for (const pair of String(raw || "").split(",")) {
    const idx = pair.indexOf(":");
    if (idx <= 0) continue;
    const name = pair.slice(0, idx).trim().toLowerCase();
    const pin = pair.slice(idx + 1).trim();
    if (!NAME_RE.test(name) || pin === "") continue;
    users.set(pin, name);
  }
  return users;
}

export function checkAuth(req, res) {
  const provided = String(req.headers["x-snapcal-token"] || "").trim();

  // 1. Signed session from api/auth.js — the current scheme.
  const session = readSession(provided);
  if (session) return session;

  // 2. APP_USERS passcodes — kept so phones that haven't signed in yet keep working during the
  //    changeover. Remove the variable once everyone has an account.
  const users = parseUsers(process.env.APP_USERS);
  if (users.size > 0) {
    const owner = provided !== "" ? users.get(provided) : undefined;
    if (owner) return owner;
    res.status(401).json({ errorType: "unauthorized", message: "Invalid or missing passcode." });
    return false;
  }

  // 3. Legacy single passcode.
  const required = (process.env.APP_TOKEN || "").trim();
  if (required !== "" && provided === required) return DEFAULT_OWNER;

  // 4. Wide open, for `node dev-server.mjs` on a laptop only. This used to be the behaviour
  //    whenever APP_TOKEN happened to be unset, which meant that deleting APP_USERS in Vercel
  //    silently published everyone's food log to the internet as DEFAULT_OWNER. It now takes a
  //    deliberate ALLOW_ANONYMOUS=1.
  if (process.env.ALLOW_ANONYMOUS === "1" && required === "" && users.size === 0) {
    return DEFAULT_OWNER;
  }

  res.status(401).json({ errorType: "unauthorized", message: "Invalid or missing passcode." });
  return false;
}

/**
 * checkAuth() with a brake on guessing: a request carrying a token that is NOT a valid session
 * (an old passcode, or a guess) is refused once its address has too many recent failures, and a
 * wrong one is counted. Signed-in sessions never hit the database. Every endpoint uses this.
 */
export async function requireUser(req, res) {
  const provided = String(req.headers?.["x-snapcal-token"] || "").trim();
  let who;
  if (provided === "" || readSession(provided)) {
    who = checkAuth(req, res);
  } else {
    const keys = [`ip:${clientIp(req)}`];
    if (await isLocked(keys)) {
      tooMany(res);
      return false;
    }
    who = checkAuth(req, res);
    if (!who) await recordFailure(keys);
  }
  // Sessions and passcodes are checked without the database, so a removed person's phone would
  // otherwise keep working. Every request also confirms the account still exists, and that a
  // session was made with the account's current password (a change or reset signs out the rest).
  if (who && !(await accountExists(who))) {
    res.status(401).json({ errorType: "unauthorized", message: "That account no longer exists." });
    return false;
  }
  if (who && readSession(provided) && !(await sessionStillValid(provided))) {
    res.status(401).json({ errorType: "unauthorized", message: "Your password was changed. Sign in again." });
    return false;
  }
  return who;
}

/**
 * True when a signed session is for an existing account and was made with its current password.
 * Sessions from before password stamps are accepted until LEGACY_SESSIONS_UNTIL.
 */
export async function sessionStillValid(token, now = Date.now()) {
  const detail = readSessionDetail(token);
  if (!detail) return false;
  const account = await accountRecord(detail.username);
  if (!account.exists) return false;
  if (detail.stamp === null) return now < LEGACY_SESSIONS_UNTIL;
  if (account.salt === undefined) return true; // database hiccup or local dev: signature alone
  return detail.stamp === sessionStamp(account.salt);
}

/** The signed-in username when the session is still valid (see above), else null. */
export async function verifiedUser(req) {
  const token = String(req.headers?.["x-snapcal-token"] || "").trim();
  return (await sessionStillValid(token)) ? readSession(token) : null;
}

const EXISTS_TTL_MS = 30_000;
const existsCache = new Map(); // username -> { yes, at }

/** Forget a cached answer, so a removal takes effect at once on this server. */
export function forgetAccount(username) {
  existsCache.delete(username);
}

async function accountExists(username) {
  return (await accountRecord(username)).exists;
}

/** { exists, salt } for an account, cached briefly. salt is undefined when it couldn't be read. */
async function accountRecord(username) {
  const base = (process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  if (!base || process.env.ALLOW_ANONYMOUS === "1") return { exists: true, salt: undefined }; // local dev: no accounts table
  const hit = existsCache.get(username);
  if (hit && Date.now() - hit.at < EXISTS_TTL_MS) return hit.record;
  try {
    const { select } = await import("./_rest.js");
    const rows = await select("snapcal_users", { select: "username,salt", username: `eq.${username}`, limit: "1" });
    const row = Array.isArray(rows) ? rows[0] : null;
    const record = { exists: Boolean(row), salt: typeof row?.salt === "string" ? row.salt : undefined };
    existsCache.set(username, { record, at: Date.now() });
    return record;
  } catch {
    return { exists: true, salt: undefined }; // database hiccup: don't lock everyone out; checked again soon
  }
}
