// api/groups.js — which groups the signed-in person belongs to, and who's in them.
// POST {} -> { ok, groups: [{ id, name, members: [...] }] }
import { checkAuth } from "./_auth.js";
import { parseBody, restBase } from "./_rest.js";
import { myGroups, membersOf } from "./_groups.js";

export default async function handler(req, res) {
  const me = checkAuth(req, res);
  if (!me) return;
  if (req.method !== "POST") return res.status(405).json({ ok: false, errorType: "other", message: "Method not allowed" });
  if (!restBase()) return res.status(200).json({ ok: false, errorType: "unconfigured", message: "Groups need Supabase configured." });
  try {
    const groups = await myGroups(me);
    const withMembers = await Promise.all(groups.map(async (g) => ({ ...g, members: await membersOf(g.id) })));
    return res.status(200).json({ ok: true, groups: withMembers });
  } catch (err) {
    return res.status(200).json({ ok: false, errorType: "other", message: err?.message ?? String(err) });
  }
}
