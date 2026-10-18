// api/groups.js — which groups the signed-in person belongs to, and who's in them.
// POST {}                          -> { ok, groups: [{ id, name, members: [...] }], pending, sent, names, max }
// POST { op: "create", name }      -> the same answer, with the new group (you're its first member)
// POST { op: "leave", group }      -> the same answer; your last group can't be left
// POST { op: "add", group, username } -> asks someone from one of your groups to join this one
// POST { op: "accept" | "decline", group } -> answers an ask to join
// Owner only: { op: "all" | "set" | "remove" } (Profile › Members).
//
// Being in a group shows your log to everyone in it, so nobody is ever put in a group by someone
// else: an ask waits in snapcal_group_invites until the person says yes. A group someone made
// goes away with its last member; the owner's own groups (Family, Work) always stay.
import { requireUser } from "./_auth.js";
import { restBase, newId } from "./_rest.js";
import { myGroups, membersOf, isMember, sharesGroup } from "./_groups.js";
import { select, insert, remove, patch, parseBody as readBody } from "./_rest.js";
import { isAdmin, MAX_GROUPS, ADMIN } from "./_members.js";
import { deleteAccount } from "./_account-data.js";
import { forgetAccount } from "./_auth.js";
import { notify, displayName } from "./_push.js";

const NAME_MAX = 30;
const fail = (res, errorType, message) => res.status(200).json({ ok: false, errorType, message });
const cleanName = (v) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, NAME_MAX);
const inList = (xs) => `in.(${xs.map((x) => `"${x}"`).join(",")})`;
const titleCase = (u) => u.replace(/(^|[-_])([a-z])/g, (_, sep, c) => (sep ? " " : "") + c.toUpperCase());

/** Your groups with their members, asks waiting for you, asks you've sent, and everyone's name. */
async function mine(me) {
  const groups = await myGroups(me);
  const withMembers = await Promise.all(groups.map(async (g) => ({ ...g, members: await membersOf(g.id) })));
  const pendingRows = await select("snapcal_group_invites", { select: "group_id,invited_by", username: `eq.${me}`, limit: "20" });
  const pendingGroups = pendingRows.length
    ? await select("snapcal_groups", { select: "id,name", id: inList(pendingRows.map((r) => r.group_id)), limit: "20" })
    : [];
  const pending = pendingRows
    .map((r) => ({ group: r.group_id, name: pendingGroups.find((g) => g.id === r.group_id)?.name, by: r.invited_by }))
    .filter((p) => p.name);
  const sent = groups.length
    ? (await select("snapcal_group_invites", { select: "group_id,username", group_id: inList(groups.map((g) => g.id)), limit: "100" }))
      .map((r) => ({ group: r.group_id, username: r.username }))
    : [];
  const people = [...new Set([...withMembers.flatMap((g) => g.members), ...pending.map((p) => p.by)])];
  const profiles = people.length
    ? await select("snapcal_profile", { select: "owner,name:data->>displayName", owner: inList(people), limit: "200" })
    : [];
  const names = Object.fromEntries(people.map((u) => [u, String(profiles.find((p) => p.owner === u)?.name ?? "").trim() || titleCase(u)]));
  return { ok: true, me, groups: withMembers, pending, sent, names, max: MAX_GROUPS, isAdmin: isAdmin(me) };
}

/** A group someone made goes with its last member, with any links or asks still open for it. */
async function dropIfEmpty(groupId) {
  if ((await membersOf(groupId)).length > 0) return;
  const [g] = await select("snapcal_groups", { select: "id,created_by", id: `eq.${groupId}`, limit: "1" });
  if (!g || g.created_by === ADMIN) return;
  await patch("snapcal_invites", { group_id: `eq.${groupId}`, used_by: "is.null" }, { revoked: true });
  await remove("snapcal_group_invites", { group_id: `eq.${groupId}` });
  await remove("snapcal_groups", { id: `eq.${groupId}` });
}

export default async function handler(req, res) {
  const me = await requireUser(req, res);
  if (!me) return;
  if (req.method !== "POST") return res.status(405).json({ ok: false, errorType: "other", message: "Method not allowed" });
  if (!restBase()) return res.status(200).json({ ok: false, errorType: "unconfigured", message: "Groups need Supabase configured." });
  const body = readBody(req);
  const op = String(body.op ?? "mine");
  const groupId = String(body.group ?? "").trim();

  try {
    if (op === "create") {
      const name = cleanName(body.name);
      if (!name) return fail(res, "noName", "Give the group a name.");
      if ((await myGroups(me)).length >= MAX_GROUPS) return fail(res, "tooMany", `You can be in up to ${MAX_GROUPS} groups.`);
      const id = newId();
      await insert("snapcal_groups", { id, name, created_by: me });
      await insert("snapcal_group_members", { group_id: id, username: me });
      return res.status(200).json({ ...(await mine(me)), created: id });
    }

    if (op === "leave") {
      const groups = await myGroups(me);
      if (!groups.some((g) => g.id === groupId)) return fail(res, "notMember", "You're not in that group.");
      // with no group at all the Us and Shared tabs would have nothing to show
      if (groups.length === 1) return fail(res, "lastGroup", "It's your only group. Make or join another one first.");
      await remove("snapcal_group_members", { group_id: `eq.${groupId}`, username: `eq.${me}` });
      // your open links and asks for it go too, so nobody lands in a group through someone who left
      await patch("snapcal_invites", { group_id: `eq.${groupId}`, created_by: `eq.${me}`, used_by: "is.null" }, { revoked: true });
      await remove("snapcal_group_invites", { group_id: `eq.${groupId}`, invited_by: `eq.${me}` });
      await dropIfEmpty(groupId);
      return res.status(200).json(await mine(me));
    }

    if (op === "add") {
      const username = String(body.username ?? "").trim().toLowerCase();
      if (!(await isMember(me, groupId))) return fail(res, "notMember", "You're not in that group.");
      if (!username || username === me) return fail(res, "other", "Pick someone to add.");
      // only people you already see in one of your groups
      if (!(await sharesGroup(me, username))) return fail(res, "notMember", "You can only add people from your groups.");
      if (!(await isMember(username, groupId))) {
        const already = await select("snapcal_group_invites", { select: "username", group_id: `eq.${groupId}`, username: `eq.${username}`, limit: "1" });
        if (already.length === 0) {
          await insert("snapcal_group_invites", { group_id: groupId, username, invited_by: me });
          const [[g], who] = await Promise.all([select("snapcal_groups", { select: "name", id: `eq.${groupId}`, limit: "1" }), displayName(me)]);
          await notify([username], (lang) => ({
            title: lang === "es" ? `${who} te invitó a ${g?.name ?? ""}` : `${who} invited you to ${g?.name ?? ""}`,
            body: lang === "es" ? "Abre Nosotros para unirte." : "Open Us to join.",
            url: "/?tab=us",
            tag: `group-${groupId}`,
          }));
        }
      }
      return res.status(200).json(await mine(me));
    }

    if (op === "accept" || op === "decline") {
      const [ask] = await select("snapcal_group_invites", { select: "group_id", group_id: `eq.${groupId}`, username: `eq.${me}`, limit: "1" });
      if (op === "accept" && ask) {
        const [g] = await select("snapcal_groups", { select: "id", id: `eq.${groupId}`, limit: "1" });
        if (g && !(await isMember(me, groupId))) {
          if ((await myGroups(me)).length >= MAX_GROUPS) return fail(res, "tooMany", `You can be in up to ${MAX_GROUPS} groups.`);
          await insert("snapcal_group_members", { group_id: groupId, username: me });
        }
      }
      await remove("snapcal_group_invites", { group_id: `eq.${groupId}`, username: `eq.${me}` });
      return res.status(200).json(await mine(me));
    }

    if (op === "remove") {
      // Removes a person from the app: their account and everything in it. Their phone is
      // signed out on its next request. Only the admin, and never the admin themselves.
      if (!isAdmin(me)) return res.status(200).json({ ok: false, errorType: "forbidden", message: "Only the app's owner can remove people." });
      const username = String(body.username ?? "").trim().toLowerCase();
      if (!username || username === me) return res.status(200).json({ ok: false, errorType: "other", message: "You can't remove yourself." });
      const exists = await select("snapcal_users", { select: "username", username: `eq.${username}`, limit: "1" });
      if (exists.length === 0) return res.status(200).json({ ok: false, errorType: "other", message: "No such account." });
      const theirs = await myGroups(username);
      await deleteAccount(username);
      forgetAccount(username);
      for (const g of theirs) await dropIfEmpty(g.id);
      body.op = "all"; // fall through: answer with the updated list
    }

    if (body.op === "all" || op === "all" || op === "set") {
      // Only the owner can see or change who is in which group.
      if (!isAdmin(me)) return res.status(200).json({ ok: false, errorType: "forbidden", message: "Only the app's owner can manage members." });
      const allGroups = await select("snapcal_groups", { select: "id,name", order: "created_at.asc", limit: "100" });

      if (op === "set") {
        const username = String(body.username ?? "").trim().toLowerCase();
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
      const memberships = await select("snapcal_group_members", { select: "group_id,username", limit: "1000" });
      const people = users.map((u) => ({
        username: u.username,
        groups: memberships.filter((m) => m.username === u.username).map((m) => m.group_id),
      }));
      return res.status(200).json({ ok: true, groups: allGroups, people, isAdmin: true });
    }

    return res.status(200).json(await mine(me));
  } catch (err) {
    return res.status(200).json({ ok: false, errorType: "other", message: err?.message ?? String(err) });
  }
}
