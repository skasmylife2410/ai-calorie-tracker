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

  const users = parseUsers(process.env.APP_USERS);
  if (users.size > 0) {
    const owner = provided !== "" ? users.get(provided) : undefined;
    if (owner) return owner;
    res.status(401).json({ errorType: "unauthorized", message: "Invalid or missing passcode." });
    return false;
  }

  const required = (process.env.APP_TOKEN || "").trim();
  if (required === "") return DEFAULT_OWNER; // no gate configured -> allow (local dev)
  if (provided === required) return DEFAULT_OWNER;

  res.status(401).json({ errorType: "unauthorized", message: "Invalid or missing passcode." });
  return false;
}
