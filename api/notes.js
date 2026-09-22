// api/notes.js — members leave each other a note that shows on the recipient's Home.
//
// POST { op: "send", to, body }   -> { ok }            (you can't send to yourself)
// POST { op: "inbox" }            -> { ok, notes }     newest first, last 7 days, to you
// POST { op: "seen", id }         -> { ok }            mark one of YOUR notes as read
// POST { op: "people" }           -> { ok, people }    who you can send to
//
// Limits keep it a nudge, not a chat: 200 characters, 20 notes a day per sender.

import { checkAuth } from "./_auth.js";
import { select, insert, patch, parseBody, newId, restBase } from "./_rest.js";

const MAX_LEN = 200;
const PER_DAY = 20;

const fail = (res, errorType, message, status = 200) => res.status(status).json({ ok: false, errorType, message });

export default async function handler(req, res) {
  const me = checkAuth(req, res);
  if (!me) return;
  if (req.method !== "POST") return fail(res, "other", "Method not allowed", 405);
  if (!restBase()) return fail(res, "unconfigured", "Notes need Supabase configured.");

  const body = parseBody(req);
  const op = String(body.op ?? "inbox");

  try {
    if (op === "people") {
      const rows = await select("snapcal_users", { select: "username", order: "created_at.asc", limit: "50" });
      return res.status(200).json({ ok: true, people: rows.map((r) => r.username).filter((u) => u !== me) });
    }

    if (op === "inbox") {
      const since = new Date(Date.now() - 7 * 86400000).toISOString();
      const notes = await select("snapcal_notes", {
        select: "id,from_user,body,created_at,seen_at",
        to_user: `eq.${me}`,
        created_at: `gte.${since}`,
        order: "created_at.desc",
        limit: "20",
      });
      return res.status(200).json({ ok: true, notes });
    }

    if (op === "seen") {
      const id = String(body.id ?? "");
      if (!id) return fail(res, "other", "Missing note id.");
      // only the recipient can mark a note as seen
      await patch("snapcal_notes", { id: `eq.${id}`, to_user: `eq.${me}` }, { seen_at: new Date().toISOString() });
      return res.status(200).json({ ok: true });
    }

    if (op === "send") {
      const to = String(body.to ?? "").trim().toLowerCase();
      const text = String(body.body ?? "").trim().replace(/\s+/g, " ");
      if (!text) return fail(res, "empty", "Write something first.");
      if (text.length > MAX_LEN) return fail(res, "tooLong", `Keep it under ${MAX_LEN} characters.`);
      if (to === me) return fail(res, "self", "You can't send a note to yourself.");

      const exists = await select("snapcal_users", { select: "username", username: `eq.${to}`, limit: "1" });
      if (exists.length === 0) return fail(res, "noSuchUser", "That person isn't in the app.");

      const today = new Date(); today.setUTCHours(0, 0, 0, 0);
      const sentToday = await select("snapcal_notes", { select: "id", from_user: `eq.${me}`, created_at: `gte.${today.toISOString()}`, limit: String(PER_DAY + 1) });
      if (sentToday.length >= PER_DAY) return fail(res, "limit", "That's enough notes for today.");

      await insert("snapcal_notes", { id: newId(), from_user: me, to_user: to, body: text });
      return res.status(200).json({ ok: true });
    }

    return fail(res, "other", "Unknown operation.");
  } catch (err) {
    return fail(res, "other", err?.message ?? String(err));
  }
}
