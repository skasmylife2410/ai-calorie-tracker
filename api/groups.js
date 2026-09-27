// api/groups.js — which groups the signed-in person belongs to, and who's in them.
// POST {} -> { ok, groups: [{ id, name, members: [...] }] }
import { requireUser } from "./_auth.js";
import { parseBody, restBase } from "./_rest.js";
import { myGroups, membersOf } from "./_groups.js";
import { select, insert, remove, parseBody as readBody } from "./_rest.js";
import { isAdmin } from "./_members.js";
import { deleteAccount } from "./_account-data.js";
import { forgetAccount } from "./_auth.js";

export default async function handler(req, res) {
  const me = await requireUser(req, res);
  if (!me) return;
  if (req.method !== "POST") return res.status(405).json({ ok: false, errorType: "other", message: "Method not allowed" });
  if (!restBase()) return res.status(200).json({ ok: false, errorType: "unconfigured", message: "Groups need Supabase configured." });
  const body = readBody(req);
  const op = String(body.op ?? "mine");

  try {
    if (op === "remove") {
      // Removes a person from the app: their account and everything in it. Their phone is
      // signed out on its next request. Only the admin, and never the admin themselves.
      if (!isAdmin(me)) return res.status(200).json({ ok: false, errorType: "forbidden", message: "Only the app's owner can remove people." });
      const username = String(body.username ?? "").trim().toLowerCase();
      if (!username || username === me) return res.status(200).json({ ok: false, errorType: "other", message: "You can't remove yourself." });
      const exists = await select("snapcal_users", { select: "username", username: `eq.${username}`, limit: "1" });
      if (exists.length === 0) return res.status(200).json({ ok: false, errorType: "other", message: "No such account." });
      await deleteAccount(username);
      forgetAccount(username);
      body.op = "all"; // fall through: answer with the updated list
    }

    if (body.op === "all" || op === "all" || op === "set") {
      // Only the owner can see or change who is in which group.
      if (!isAdmin(me)) return res.status(200).json({ ok: false, errorType: "forbidden", message: "Only the app's owner can manage members." });
      const allGroups = await select("snapcal_groups", { select: "id,name", order: "created_at.asc", limit: "20" });

      if (op === "set") {
        const username = String(body.username ?? "").trim().toLowerCase();
        const groupId = String(body.group ?? "").trim();
        const shouldBeMember = body.member !== false;
        if (!username || !allGroups.some((g) => g.id === groupId)) {
          return res.status(200).json({ ok: false, errorType: "other", message: "Unknown person or group." });
        }
        const exists = await select("snapcal_users", { select: "username", username: `eq.${username}`, limit: "1" });
        if (exists.length === 0) return res.status(200).json({ ok: false, errorType: "other", message: "No such account." });
        if (shouldBeMember) {
          const already = await select("snapcal_group_members", { select: "username", group_id: `eq.${groupId}`, username: `eq.${username}`, limit: "1" });
          if (already.length === 0) await insert("snapcal_group_members", { group_id: groupId, username });
        } else {
          await remove("snapcal_group_members", { group_id: `eq.${groupId}`, username: `eq.${username}` });
        }
      }

      const users = await select("snapcal_users", { select: "username,created_at", order: "created_at.asc", limit: "100" });
      const memberships = await select("snapcal_group_members", { select: "group_id,username", limit: "200" });
      const people = users.map((u) => ({
        username: u.username,
        groups: memberships.filter((m) => m.username === u.username).map((m) => m.group_id),
      }));
      return res.status(200).json({ ok: true, groups: allGroups, people, isAdmin: true });
    }

    const groups = await myGroups(me);
    const withMembers = await Promise.all(groups.map(async (g) => ({ ...g, members: await membersOf(g.id) })));
    return res.status(200).json({ ok: true, groups: withMembers, isAdmin: isAdmin(me) });
  } catch (err) {
    return res.status(200).json({ ok: false, errorType: "other", message: err?.message ?? String(err) });
  }
}
