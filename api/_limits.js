// api/_limits.js — brute-force brakes for sign-in and passcodes.
//
// Every failed password or passcode guess is written to snapcal_auth_failures under one or more
// keys ("ip:1.2.3.4", "user:maria"). Once a key has MAX_FAILURES within WINDOW_MINUTES, further
// guesses from it are refused before the password is even checked. Successful sign-ins never
// touch the table. If the database can't be reached the brake stays off rather than locking
// everyone out (the passwords themselves still have to be right).

import { restBase, restHeaders } from "./_rest.js";

export const MAX_FAILURES = 10;
export const WINDOW_MINUTES = 15;

/** The caller's address as Vercel reports it (first hop of x-forwarded-for). */
export function clientIp(req) {
  const fwd = String(req.headers?.["x-forwarded-for"] ?? "").split(",")[0].trim();
  return fwd || String(req.headers?.["x-real-ip"] ?? "").trim() || "unknown";
}

/** True when any of `keys` has `max` or more recent failures. */
export async function isLocked(keys, max = MAX_FAILURES) {
  if (!restBase() || keys.length === 0) return false;
  const since = new Date(Date.now() - WINDOW_MINUTES * 60000).toISOString();
  try {
    const counts = await Promise.all(keys.map(async (key) => {
      const params = new URLSearchParams({ select: "id", key: `eq.${key}`, at: `gte.${since}`, limit: String(max) });
      const r = await fetch(`${restBase()}/rest/v1/snapcal_auth_failures?${params}`, { headers: restHeaders() });
      return r.ok ? (await r.json()).length : 0;
    }));
    return counts.some((n) => n >= max);
  } catch {
    return false;
  }
}

export async function recordFailure(keys) {
  if (!restBase() || keys.length === 0) return;
  try {
    await fetch(`${restBase()}/rest/v1/snapcal_auth_failures`, {
      method: "POST",
      headers: restHeaders({ Prefer: "return=minimal" }),
      body: JSON.stringify(keys.map((key) => ({ key: key.slice(0, 120) }))),
    });
  } catch {
    // best effort
  }
}

export function tooMany(res) {
  res.setHeader?.("Retry-After", String(WINDOW_MINUTES * 60));
  return res.status(429).json({ ok: false, errorType: "tooManyAttempts", message: `Too many wrong attempts. Try again in ${WINDOW_MINUTES} minutes.` });
}
