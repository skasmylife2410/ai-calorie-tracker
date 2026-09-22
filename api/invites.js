// api/invites.js — single-use invite links.
//
// POST { op: "create" }       -> { ok, code, expiresAt }   admins only
// POST { op: "list" }         -> { ok, invites, members, max, isAdmin }
// POST { op: "revoke", code } -> { ok }                     admins only
// POST { op: "check", code }  -> { ok, valid, reason? }     public — lets the sign-up screen
//                                                           say "this link has expired" up front
//
// A link can't overbook the group: open invites + existing accounts may never exceed the cap,
// so five open links when there are five free places means no sixth can be made.

import crypto from "node:crypto";
import { checkAuth } from "./_auth.js";
import { select, insert, patch, parseBody, restBase } from "./_rest.js";
import { maxUsers, isAdmin, INVITE_DAYS } from "./_members.js";
import { myGroups, membersOf, isMember } from "./_groups.js";

const fail = (res, errorType, message, status = 200) => res.status(status).json({ ok: false, errorType, message });

/** 16 random bytes, URL-safe: unguessable, short enough for a link. */
export function newInviteCode() {
  return crypto.randomBytes(16).toString("base64url");
}

export async function openInvites() {
  const now = new Date().toISOString();
  return select("snapcal_invites", { select: "code,created_by,created_at,expires_at,group_id", used_by: "is.null", revoked: "eq.false", expires_at: `gt.${now}`, order: "created_at.desc", limit: "50" });
}

/** The group a valid invite is for, or null. Used by sign-up to place the new person. */
export async function inviteGroup(code) {
  const rows = await select("snapcal_invites", { select: "group_id", code: `eq.${code}`, limit: "1" });
  return rows[0]?.group_id ?? null;
}

/** Why a code can't be used right now, or null if it can. */
export async function inviteProblem(code) {
  if (!/^[A-Za-z0-9_-]{16,40}$/.test(String(code ?? ""))) return "unknown";
  const rows = await select("snapcal_invites", { select: "*", code: `eq.${code}`, limit: "1" });
  const inv = rows[0];
  if (!inv) return "unknown";
  if (inv.revoked) return "revoked";
  if (inv.used_by) return "used";
  if (Date.parse(inv.expires_at) <= Date.now()) return "expired";
  return null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return fail(res, "other", "Method not allowed", 405);
  if (!restBase()) return fail(res, "unconfigured", "Invites need Supabase configured.");
  const body = parseBody(req);
  const op = String(body.op ?? "list");

  try {
    // the only thing someone without an account may ask
    if (op === "check") {
      const problem = await inviteProblem(body.code);
      return res.status(200).json({ ok: true, valid: problem === null, reason: problem ?? undefined });
    }

    const me = checkAuth(req, res);
    if (!me) return;
    const admin = isAdmin(me);
    const members = await select("snapcal_users", { select: "username", limit: "100" });

    if (op === "list") {
      const invites = admin ? await openInvites() : [];
      const groups = await myGroups(me);
      const withMembers = await Promise.all(groups.map(async (g) => ({ ...g, members: (await membersOf(g.id)).length })));
      return res.status(200).json({ ok: true, invites, members: members.length, max: maxUsers(), isAdmin: admin, groups: withMembers });
    }

    if (!admin) return fail(res, "forbidden", "Only the app's owner can manage invites.");

    if (op === "create") {
      // Every link is for one group, and only for a group you're in yourself.
      const groupId = String(body.group ?? "").trim();
      if (!groupId) return fail(res, "noGroup", "Choose which group this invite is for.");
      if (!(await isMember(me, groupId))) return fail(res, "notMember", "You're not in that group.");

      const open = await openInvites();
      if (members.length + open.length >= maxUsers()) {
        return fail(res, "full", `All ${maxUsers()} places are taken or already invited.`);
      }
      const code = newInviteCode();
      const expiresAt = new Date(Date.now() + INVITE_DAYS * 86400000).toISOString();
      await insert("snapcal_invites", { code, created_by: me, expires_at: expiresAt, group_id: groupId });
      return res.status(200).json({ ok: true, code, expiresAt, group: groupId });
    }

    if (op === "revoke") {
      await patch("snapcal_invites", { code: `eq.${String(body.code ?? "")}`, used_by: "is.null" }, { revoked: true });
      return res.status(200).json({ ok: true });
    }

    return fail(res, "other", "Unknown operation.");
  } catch (err) {
    return fail(res, "other", err?.message ?? String(err));
  }
}
