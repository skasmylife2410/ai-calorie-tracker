// api/auth.js — login, sign-up and password change. The only endpoint that sees plain passwords.
//
// POST { op: "login",  username, password }            -> { ok, token, mustChange }
// POST { op: "signup", username, password, invite }     -> { ok, token }
// POST { op: "change", username, password, newPassword }-> { ok, token }
// POST { op: "whoami" } with x-snapcal-token            -> { ok, username }
//
// Sign-up needs INVITE_CODE, because the app sits on a public URL: without it anyone who found
// the address could create an account. Sharing the code with someone is how you invite them.

import {
  USERNAME_RE, normalizeUsername, hashPassword, verifyPassword,
  createSession, readSession, passwordProblem,
} from "./_accounts.js";

function restBase() {
  return (process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
}

function restHeaders(extra = {}) {
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || "").trim();
  const headers = { apikey: key, "Content-Type": "application/json", ...extra };
  if (key.startsWith("eyJ")) headers.Authorization = `Bearer ${key}`;
  return headers;
}

async function getUser(username) {
  const params = new URLSearchParams({ select: "*", username: `eq.${username}`, limit: "1" });
  const res = await fetch(`${restBase()}/rest/v1/snapcal_users?${params}`, { headers: restHeaders() });
  if (!res.ok) throw new Error(`Supabase read failed (${res.status})`);
  const rows = await res.json();
  return rows[0] ?? null;
}

async function writeUser(row, { update = false } = {}) {
  const url = update
    ? `${restBase()}/rest/v1/snapcal_users?username=eq.${encodeURIComponent(row.username)}`
    : `${restBase()}/rest/v1/snapcal_users`;
  const res = await fetch(url, {
    method: update ? "PATCH" : "POST",
    headers: restHeaders(update ? {} : { Prefer: "resolution=merge-duplicates" }),
    body: JSON.stringify(update ? row : [row]),
  });
  if (!res.ok) throw new Error(`Supabase write failed (${res.status}): ${await res.text().catch(() => "")}`);
}

const fail = (res, code, message, status = 200) =>
  res.status(status).json({ ok: false, errorType: code, message });

export default async function handler(req, res) {
  if (req.method !== "POST") return fail(res, "other", "Method not allowed", 405);
  if (!restBase()) return fail(res, "unconfigured", "Accounts need Supabase configured.");

  const body = typeof req.body === "object" && req.body ? req.body : JSON.parse(req.body || "{}");
  const op = String(body.op ?? "login");

  if (op === "whoami") {
    const username = readSession(req.headers["x-snapcal-token"]);
    return username ? res.status(200).json({ ok: true, username }) : fail(res, "unauthorized", "Not signed in");
  }

  const username = normalizeUsername(body.username);
  const password = String(body.password ?? "");

  if (!USERNAME_RE.test(username)) {
    return fail(res, "badUsername", "Usernames are 2-40 characters: letters, numbers, - and _.");
  }

  try {
    if (op === "signup") {
      const required = (process.env.INVITE_CODE || "").trim();
      if (required === "" || String(body.invite ?? "").trim() !== required) {
        return fail(res, "badInvite", "That invite code isn't right.");
      }
      const problem = passwordProblem(password);
      if (problem) return fail(res, problem, "Password must be at least 8 characters.");
      if (await getUser(username)) return fail(res, "taken", "That username is already taken.");

      const { salt, hash } = hashPassword(password);
      await writeUser({ username, salt, password_hash: hash, must_change: false, created_at: new Date().toISOString() });
      return res.status(200).json({ ok: true, token: createSession(username) });
    }

    const user = await getUser(username);

    if (op === "change") {
      // Either a valid session for this user, or the current password, authorises the change.
      const session = readSession(req.headers["x-snapcal-token"]);
      const authorised = session === username || (user && verifyPassword(password, user.salt, user.password_hash));
      if (!user || !authorised) return fail(res, "unauthorized", "Wrong password.");

      const problem = passwordProblem(body.newPassword);
      if (problem) return fail(res, problem, "New password must be at least 8 characters.");

      const { salt, hash } = hashPassword(String(body.newPassword));
      await writeUser({ username, salt, password_hash: hash, must_change: false }, { update: true });
      return res.status(200).json({ ok: true, token: createSession(username) });
    }

    // login — the same reply for "no such user" and "wrong password", so the form can't be used
    // to find out who has an account.
    if (!user || !verifyPassword(password, user.salt, user.password_hash)) {
      return fail(res, "badLogin", "Wrong username or password.");
    }
    return res.status(200).json({ ok: true, token: createSession(username), mustChange: user.must_change === true });
  } catch (err) {
    return fail(res, "other", err?.message ?? String(err));
  }
}
