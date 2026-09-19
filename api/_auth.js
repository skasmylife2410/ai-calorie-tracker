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

import { readSession } from "./_accounts.js";

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
