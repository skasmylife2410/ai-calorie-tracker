// api/auth.js — login, sign-up and password change. The only endpoint that sees plain passwords.
//
// POST { op: "login",  username, password }            -> { ok, token, mustChange }
// POST { op: "signup", username, password, invite }     -> { ok, token }
// POST { op: "change", username, password, newPassword }-> { ok, token }
// POST { op: "whoami" } with x-snapcal-token            -> { ok, username }
//
// Sign-up needs INVITE_CODE, because the app sits on a public URL: without it anyone who found
// the address could create an account. Sharing the code with someone is how you invite them.
//
// There is also a hard cap on how many accounts can exist (MAX_USERS, default 3). The invite code
// can leak — someone forwards it, it is overheard — and the cap means that even then nobody new
// can get in. Raise it by setting MAX_USERS in Vercel; deleting an account frees a slot.

import {
  USERNAME_RE, normalizeUsername, hashPassword, verifyPassword,
  createSession, readSession, passwordProblem,
} from "./_accounts.js";
import { maxUsers as memberCap } from "./_members.js";
import { inviteProblem, inviteGroup } from "./invites.js";
import { addMembership } from "./_groups.js";

function restBase() {
  return (process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
}

function restHeaders(extra = {}) {
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || "").trim();
  const headers = { apikey: key, "Content-Type": "application/json", ...extra };
  if (key.startsWith("eyJ")) headers.Authorization = `Bearer ${key}`;
  return headers;
}

const maxUsers = memberCap;

/** Number of accounts that exist. Uses PostgREST's exact count so no rows are transferred. */
async function countUsers() {
  const res = await fetch(`${restBase()}/rest/v1/snapcal_users?select=username`, {
    headers: restHeaders({ Prefer: "count=exact", Range: "0-0" }),
  });
  if (!res.ok) throw new Error(`Supabase count failed (${res.status})`);
  const range = res.headers.get("content-range") || "";
  const total = Number(range.split("/")[1]);
  return Number.isFinite(total) ? total : 0;
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
    if (!username) return fail(res, "unauthorized", "Not signed in");
    // The session is signed and unexpired, but the account may no longer exist — renamed or
    // removed. Without this check the phone keeps working under a name nobody owns: it belongs
    // to no group, so the person sees only themselves, and anything it syncs lands in limbo.
    try {
      const still = await getUser(username);
      if (!still) return fail(res, "unauthorized", "That account no longer exists. Sign in again.");
    } catch {
      return res.status(200).json({ ok: true, username }); // database hiccup: don't sign anyone out
    }
    return res.status(200).json({ ok: true, username });
  }

  const username = normalizeUsername(body.username);
  const password = String(body.password ?? "");

  if (!USERNAME_RE.test(username)) {
    return fail(res, "badUsername", "Usernames are 2-40 characters: letters, numbers, - and _.");
  }

  try {
    if (op === "signup") {
      const invite = String(body.invite ?? "").trim();
      const shared = (process.env.INVITE_CODE || "").trim();
      const viaShared = shared !== "" && invite === shared;
      const linkProblem = viaShared ? null : await inviteProblem(invite);
      if (!viaShared && linkProblem) {
        const why = {
          used: "That invite link has already been used.",
          expired: "That invite link has expired. Ask for a new one.",
          revoked: "That invite link was cancelled.",
        }[linkProblem] ?? "That invite code isn't right.";
        return fail(res, linkProblem === "unknown" ? "badInvite" : `invite${linkProblem[0].toUpperCase()}${linkProblem.slice(1)}`, why);
      }
      const problem = passwordProblem(password);
      if (problem) return fail(res, problem, "Password must be at least 8 characters.");
      if (await getUser(username)) return fail(res, "taken", "That username is already taken.");

      const limit = maxUsers();
      if ((await countUsers()) >= limit) {
        return fail(res, "full", `This app is set up for ${limit} people and all ${limit} places are taken.`);
      }

      if (!viaShared) {
        // Claim the link BEFORE creating the account, in one conditional update: if two people
        // open the same link at once, only one update matches "still unused", so only one gets in.
        const claim = await fetch(`${restBase()}/rest/v1/snapcal_invites?code=eq.${encodeURIComponent(invite)}&used_by=is.null&revoked=eq.false`, {
          method: "PATCH",
          headers: restHeaders({ Prefer: "return=representation" }),
          body: JSON.stringify({ used_by: username, used_at: new Date().toISOString() }),
        });
        const claimed = claim.ok ? await claim.json().catch(() => []) : [];
        if (!Array.isArray(claimed) || claimed.length === 0) {
          return fail(res, "inviteUsed", "That invite link has already been used.");
        }
      }
      const { salt, hash } = hashPassword(password);
      await writeUser({ username, salt, password_hash: hash, must_change: false, created_at: new Date().toISOString() });
      if (!viaShared) {
        const groupId = await inviteGroup(invite);
        if (groupId) await addMembership(groupId, username);
      }
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
