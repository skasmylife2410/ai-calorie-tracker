// api/auth.js — login, sign-up and password change. The only endpoint that sees plain passwords.
//
// POST { op: "login",  username, password }            -> { ok, token, mustChange }
// POST { op: "signup", username, password, invite }     -> { ok, token }
// POST { op: "change", username, password, newPassword }-> { ok, token }
// POST { op: "whoami" } with x-snapcal-token            -> { ok, username, email }
// POST { op: "setEmail", username, password, email }    -> { ok, email }   "" removes it
// POST { op: "forgot", identifier, lang }                -> { ok }          same answer either way
// POST { op: "reset", token, newPassword }               -> { ok, token, username }
// POST { op: "consent" }                 with session     -> { ok }   agrees to POLICY_VERSION
// POST { op: "export" }                  with session     -> { ok, data }  everything stored
// POST { op: "deleteAccount", password } with session     -> { ok }   removes it all
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
import { clientIp, isLocked, recordFailure, tooMany } from "./_limits.js";
import { mailConfigured, sendMail, appUrl } from "./_mail.js";
import { POLICY_VERSION } from "./_policy.js";
import { exportAccount, deleteAccount } from "./_account-data.js";
import crypto from "node:crypto";

const EMAIL_RE = /^[^\s@"<>()]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$/;
const RESET_MINUTES = 30;
const RESETS_PER_WINDOW = 3; // per account, per 15 minutes
const sha256 = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");

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
    // A new account is a plain insert: if the name was taken a moment ago the database refuses
    // it (409) instead of overwriting that person's password, as the old upsert would have.
    headers: restHeaders(),
    body: JSON.stringify(update ? row : [row]),
  });
  if (res.status === 409) {
    const err = new Error("taken");
    err.code = "taken";
    throw err;
  }
  if (!res.ok) throw new Error(`Supabase write failed (${res.status})`);
}

const fail = (res, code, message, status = 200) =>
  res.status(status).json({ ok: false, errorType: code, message });

export default async function handler(req, res) {
  if (req.method !== "POST") return fail(res, "other", "Method not allowed", 405);
  if (!restBase()) return fail(res, "unconfigured", "Accounts need Supabase configured.");

  let body;
  try {
    body = typeof req.body === "object" && req.body ? req.body : JSON.parse(req.body || "{}");
  } catch {
    return fail(res, "other", "Bad request.", 400);
  }
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
      return res.status(200).json({ ok: true, username, email: still.email ?? null, mailOn: mailConfigured(), needsConsent: still.consent_version !== POLICY_VERSION, policyVersion: POLICY_VERSION });
    } catch {
      return res.status(200).json({ ok: true, username }); // database hiccup: don't sign anyone out
    }
  }

  if (op === "forgot") return forgot(req, res, body);
  if (op === "consent" || op === "export" || op === "deleteAccount") return accountOp(req, res, body, op);
  if (op === "reset") return resetPassword(req, res, body);

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
      // Health data (meals, weight, photos) needs explicit agreement before any is collected.
      if (body.consent !== true) return fail(res, "consent", "Please agree to the privacy policy to create an account.");
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
      const now = new Date().toISOString();
      await writeUser({ username, salt, password_hash: hash, must_change: false, created_at: now, consent_version: POLICY_VERSION, consent_at: now });
      if (!viaShared) {
        const groupId = await inviteGroup(invite);
        if (groupId) await addMembership(groupId, username);
      }
      return res.status(200).json({ ok: true, token: createSession(username) });
    }

    // Password guesses (login, or a change authorised by the current password) are braked per
    // account and per address, so neither one name nor one machine can keep trying.
    const guessKeys = [`user:${username}`, `ip:${clientIp(req)}`];
    const sessionUser = readSession(req.headers["x-snapcal-token"]);
    const guessing = op !== "change" || sessionUser !== username;
    if (guessing && (await isLocked(guessKeys))) return tooMany(res);

    const user = await getUser(username);

    if (op === "setEmail") {
      // Needs both the session and the current password: otherwise anyone holding an unlocked
      // phone could point recovery at their own inbox and take the account later.
      const authorised = sessionUser === username && user && verifyPassword(password, user.salt, user.password_hash);
      if (!authorised) {
        await recordFailure(guessKeys);
        return fail(res, "unauthorized", "Wrong password.");
      }
      const email = String(body.email ?? "").trim().toLowerCase();
      if (email !== "" && (email.length > 254 || !EMAIL_RE.test(email))) return fail(res, "badEmail", "That email address doesn't look right.");
      const r = await fetch(`${restBase()}/rest/v1/snapcal_users?username=eq.${encodeURIComponent(username)}`, {
        method: "PATCH",
        headers: restHeaders(),
        body: JSON.stringify({ email: email || null }),
      });
      if (r.status === 409) return fail(res, "emailTaken", "That email is already used by another account.");
      if (!r.ok) throw new Error(`Supabase email update failed (${r.status})`);
      return res.status(200).json({ ok: true, email: email || null });
    }

    if (op === "change") {
      // Either a valid session for this user, or the current password, authorises the change.
      const session = readSession(req.headers["x-snapcal-token"]);
      const authorised = session === username || (user && verifyPassword(password, user.salt, user.password_hash));
      if (!user || !authorised) {
        await recordFailure(guessKeys);
        return fail(res, "unauthorized", "Wrong password.");
      }

      const problem = passwordProblem(body.newPassword);
      if (problem) return fail(res, problem, "New password must be at least 8 characters.");

      const { salt, hash } = hashPassword(String(body.newPassword));
      await writeUser({ username, salt, password_hash: hash, must_change: false }, { update: true });
      return res.status(200).json({ ok: true, token: createSession(username) });
    }

    // login — the same reply for "no such user" and "wrong password", so the form can't be used
    // to find out who has an account.
    if (!user || !verifyPassword(password, user.salt, user.password_hash)) {
      await recordFailure(guessKeys);
      return fail(res, "badLogin", "Wrong username or password.");
    }
    return res.status(200).json({ ok: true, token: createSession(username), mustChange: user.must_change === true });
  } catch (err) {
    if (err?.code === "taken") return fail(res, "taken", "That username is already taken.");
    console.error("auth:", err);
    return fail(res, "other", "Something went wrong. Try again.");
  }
}

/**
 * "Forgot password?": emails a single-use reset link if the account has an address on file.
 * The reply is identical whether or not the account or email exists, so the form can't be used
 * to find out who uses the app. Only the link's SHA-256 is stored.
 */
async function forgot(req, res, body) {
  if (!mailConfigured() || !appUrl()) return fail(res, "mailOff", "Email recovery isn't set up yet. Ask whoever runs the app to reset your password.");
  const sent = { ok: true };
  const id = String(body.identifier ?? "").trim().toLowerCase().slice(0, 254);
  if (!id) return fail(res, "empty", "Enter your username or email.");
  const ipKey = `ip:${clientIp(req)}`;
  if (await isLocked([`reset-${ipKey}`])) return tooMany(res);
  await recordFailure([`reset-${ipKey}`]); // every request counts toward the address's limit

  try {
    const field = id.includes("@") ? "email" : "username";
    const params = new URLSearchParams({ select: "username,email", [field]: `eq.${id}`, limit: "1" });
    const r = await fetch(`${restBase()}/rest/v1/snapcal_users?${params}`, { headers: restHeaders() });
    const user = r.ok ? (await r.json())[0] : null;
    if (!user?.email) return res.status(200).json(sent);
    if (await isLocked([`reset:${user.username}`], RESETS_PER_WINDOW)) return res.status(200).json(sent);
    await recordFailure([`reset:${user.username}`]);

    const token = crypto.randomBytes(32).toString("base64url");
    const expires = new Date(Date.now() + RESET_MINUTES * 60000).toISOString();
    const ins = await fetch(`${restBase()}/rest/v1/snapcal_password_resets`, {
      method: "POST",
      headers: restHeaders({ Prefer: "return=minimal" }),
      body: JSON.stringify([{ token_hash: sha256(token), username: user.username, expires_at: expires }]),
    });
    if (!ins.ok) throw new Error(`reset insert failed (${ins.status})`);

    const link = `${appUrl()}/?reset=${token}`;
    const es = body.lang === "es";
    const subject = es ? "Restablece tu contraseña de SnapCal" : "Reset your SnapCal password";
    const lines = es
      ? [`Hola ${user.username},`, "Alguien (ojalá tú) pidió restablecer tu contraseña de SnapCal.", `Ábrelo aquí en los próximos ${RESET_MINUTES} minutos:`, link, "Si no fuiste tú, ignora este correo: tu contraseña no cambia."]
      : [`Hi ${user.username},`, "Someone (hopefully you) asked to reset your SnapCal password.", `Open this within ${RESET_MINUTES} minutes:`, link, "If it wasn't you, ignore this email — your password stays the same."];
    const html = `<div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.5;color:#1c1c1e">
      <p>${lines[0]}</p><p>${lines[1]}</p>
      <p><a href="${link}" style="display:inline-block;background:#1c1c1e;color:#fff;text-decoration:none;padding:12px 20px;border-radius:12px;font-weight:600">${es ? "Elegir nueva contraseña" : "Choose a new password"}</a></p>
      <p style="color:#8e8e93;font-size:13px">${lines[2]}<br>${lines[4]}</p></div>`;
    await sendMail({ to: user.email, subject, text: lines.join("\n\n"), html });
  } catch (err) {
    console.error("forgot:", err);
  }
  return res.status(200).json(sent);
}

/** Sets a new password from a reset link, then signs the person in. */
async function resetPassword(req, res, body) {
  const token = String(body.token ?? "");
  const ipKey = [`ip:${clientIp(req)}`];
  if (await isLocked(ipKey)) return tooMany(res);
  const problem = passwordProblem(body.newPassword);
  if (problem) return fail(res, problem, "Password must be at least 8 characters.");
  const bad = async () => {
    await recordFailure(ipKey);
    return fail(res, "badReset", "That reset link has expired or was already used. Ask for a new one.");
  };
  if (!/^[A-Za-z0-9_-]{40,50}$/.test(token)) return bad();

  try {
    // Claim the link in one conditional update, so it can only ever be used once.
    const now = new Date().toISOString();
    const claim = await fetch(`${restBase()}/rest/v1/snapcal_password_resets?token_hash=eq.${sha256(token)}&used_at=is.null&expires_at=gt.${encodeURIComponent(now)}`, {
      method: "PATCH",
      headers: restHeaders({ Prefer: "return=representation" }),
      body: JSON.stringify({ used_at: now }),
    });
    const rows = claim.ok ? await claim.json() : [];
    const username = rows[0]?.username;
    if (!username) return bad();

    const { salt, hash } = hashPassword(String(body.newPassword));
    await writeUser({ username, salt, password_hash: hash, must_change: false }, { update: true });
    // any other links still out there for this account stop working too
    await fetch(`${restBase()}/rest/v1/snapcal_password_resets?username=eq.${encodeURIComponent(username)}&used_at=is.null`, {
      method: "PATCH", headers: restHeaders(), body: JSON.stringify({ used_at: now }),
    });
    return res.status(200).json({ ok: true, token: createSession(username), username });
  } catch (err) {
    console.error("reset:", err);
    return fail(res, "other", "Something went wrong. Try again.");
  }
}

/** Consent, data export and account deletion — all for the signed-in person only. */
async function accountOp(req, res, body, op) {
  const username = readSession(req.headers["x-snapcal-token"]);
  if (!username) return fail(res, "unauthorized", "Not signed in", 401);
  try {
    if (op === "consent") {
      const now = new Date().toISOString();
      await writeUser({ username, consent_version: POLICY_VERSION, consent_at: now }, { update: true });
      return res.status(200).json({ ok: true, policyVersion: POLICY_VERSION });
    }
    if (op === "export") {
      res.setHeader?.("Cache-Control", "no-store");
      return res.status(200).json({ ok: true, data: await exportAccount(username) });
    }
    // deleteAccount: the password again, so a borrowed unlocked phone can't erase someone
    const keys = [`user:${username}`, `ip:${clientIp(req)}`];
    if (await isLocked(keys)) return tooMany(res);
    const user = await getUser(username);
    if (!user || !verifyPassword(String(body.password ?? ""), user.salt, user.password_hash)) {
      await recordFailure(keys);
      return fail(res, "unauthorized", "Wrong password.");
    }
    await deleteAccount(username);
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error(`${op}:`, err);
    return fail(res, "other", "Something went wrong. Try again.");
  }
}
