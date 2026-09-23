// api/suggestions.js — a suggestion box. Anyone in the app can send one; the owner reads them.
//
// POST { op: "send", body }  -> { ok }
// POST { op: "list" }        -> { ok, suggestions }  own ones; everyone's if you're the owner
// POST { op: "done", id }    -> { ok }               owner marks one as handled

import { checkAuth } from "./_auth.js";
import { select, insert, patch, parseBody, newId, restBase } from "./_rest.js";
import { isAdmin } from "./_members.js";

const MAX = 600;
const PER_DAY = 10;
const fail = (res, errorType, message, status = 200) => res.status(status).json({ ok: false, errorType, message });

export default async function handler(req, res) {
  const me = checkAuth(req, res);
  if (!me) return;
  if (req.method !== "POST") return fail(res, "other", "Method not allowed", 405);
  if (!restBase()) return fail(res, "unconfigured", "Suggestions need Supabase configured.");

  const body = parseBody(req);
  const op = String(body.op ?? "list");

  try {
    if (op === "send") {
      const text = String(body.body ?? "").trim().replace(/\s+/g, " ");
      if (!text) return fail(res, "empty", "Write something first.");
      if (text.length > MAX) return fail(res, "tooLong", `Keep it under ${MAX} characters.`);
      const today = new Date(); today.setUTCHours(0, 0, 0, 0);
      const mine = await select("snapcal_suggestions", { select: "id", owner: `eq.${me}`, created_at: `gte.${today.toISOString()}`, limit: String(PER_DAY + 1) });
      if (mine.length >= PER_DAY) return fail(res, "limit", "That's plenty of ideas for one day — keep them coming tomorrow.");
      await insert("snapcal_suggestions", { id: newId(), owner: me, body: text });
      return res.status(200).json({ ok: true });
    }

    if (op === "list") {
      const params = { select: "id,owner,body,created_at,done", order: "created_at.desc", limit: "60" };
      if (!isAdmin(me)) params.owner = `eq.${me}`; // you only see your own unless you're the owner
      const suggestions = await select("snapcal_suggestions", params);
      return res.status(200).json({ ok: true, suggestions, isAdmin: isAdmin(me) });
    }

    if (op === "done") {
      if (!isAdmin(me)) return fail(res, "forbidden", "Only the app's owner can do that.");
      await patch("snapcal_suggestions", { id: `eq.${String(body.id ?? "")}` }, { done: true });
      return res.status(200).json({ ok: true });
    }

    return fail(res, "other", "Unknown operation.");
  } catch (err) {
    return fail(res, "other", err?.message ?? String(err));
  }
}
