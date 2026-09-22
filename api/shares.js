// api/shares.js — meals and recipe ideas shared to the Us tab.
//
// POST { op: "list" }                  -> { ok, shares }  everyone's, newest first, last 30 days
// POST { op: "share", kind, item }     -> { ok, id }      kind: "meal" | "idea"
// POST { op: "delete", id }            -> { ok }          only your own
//
// A shared item is a snapshot: editing or deleting the meal in your log afterwards doesn't
// change what was shared. Photos are small thumbnails (the app already stores them that way).

import { checkAuth } from "./_auth.js";
import { select, insert, remove, parseBody, newId, restBase } from "./_rest.js";
import { resolveGroup } from "./_groups.js";

const MAX_PHOTO = 160_000;   // data-URL length; thumbnails are ~30–80 KB
const PER_DAY = 30;

const fail = (res, errorType, message, status = 200) => res.status(status).json({ ok: false, errorType, message });
const num = (v) => (Number.isFinite(Number(v)) ? Math.max(0, Math.round(Number(v) * 10) / 10) : 0);
const str = (v, max) => String(v ?? "").trim().slice(0, max);

/** Keep only the fields the Us feed shows, with sane bounds — never trust the client blindly. */
export function cleanItem(kind, item = {}) {
  const base = {
    name: str(item.name, 90),
    calories: num(item.calories),
    proteinG: num(item.proteinG),
    carbsG: num(item.carbsG),
    fatG: num(item.fatG),
    note: str(item.note, 200),
  };
  if (kind === "meal") {
    const photo = typeof item.photo === "string" && /^data:image\/(jpeg|png|webp);base64,/.test(item.photo) && item.photo.length <= MAX_PHOTO ? item.photo : null;
    const items = Array.isArray(item.items)
      ? item.items.slice(0, 12).map((i) => ({ name: str(i.name, 60), gramsEstimate: num(i.gramsEstimate), calories: num(i.calories), proteinG: num(i.proteinG), carbsG: num(i.carbsG), fatG: num(i.fatG) }))
      : [];
    return { ...base, photo, items };
  }
  return {
    ...base,
    minutes: num(item.minutes),
    ingredients: Array.isArray(item.ingredients) ? item.ingredients.slice(0, 15).map((x) => str(x, 90)).filter(Boolean) : [],
    steps: Array.isArray(item.steps) ? item.steps.slice(0, 10).map((x) => str(x, 200)).filter(Boolean) : [],
  };
}

export default async function handler(req, res) {
  const me = checkAuth(req, res);
  if (!me) return;
  if (req.method !== "POST") return fail(res, "other", "Method not allowed", 405);
  if (!restBase()) return fail(res, "unconfigured", "Sharing needs Supabase configured.");

  const body = parseBody(req);
  const op = String(body.op ?? "list");

  try {
    if (op === "list") {
      const { group, error } = await resolveGroup(me, typeof body.group === "string" ? body.group : null);
      if (error === "notMember") return fail(res, "notMember", "You're not in that group.");
      if (!group) return res.status(200).json({ ok: true, shares: [] });
      const since = new Date(Date.now() - 30 * 86400000).toISOString();
      const rows = await select("snapcal_shares", {
        select: "id,owner,kind,data,created_at,group_id",
        group_id: `eq.${group.id}`,
        created_at: `gte.${since}`, order: "created_at.desc", limit: "40",
      });
      return res.status(200).json({ ok: true, shares: rows, group });
    }

    if (op === "share") {
      const kind = body.kind === "idea" ? "idea" : body.kind === "meal" ? "meal" : null;
      if (!kind) return fail(res, "other", "Share a meal or an idea.");
      const data = cleanItem(kind, body.item);
      if (!data.name) return fail(res, "empty", "It needs a name.");

      const today = new Date(); today.setUTCHours(0, 0, 0, 0);
      const mine = await select("snapcal_shares", { select: "id", owner: `eq.${me}`, created_at: `gte.${today.toISOString()}`, limit: String(PER_DAY + 1) });
      if (mine.length >= PER_DAY) return fail(res, "limit", "That's a lot of sharing for one day.");

      const { group, error } = await resolveGroup(me, typeof body.group === "string" ? body.group : null);
      if (error === "notMember") return fail(res, "notMember", "You're not in that group.");
      if (!group) return fail(res, "noGroup", "You're not in a group yet.");

      const id = newId();
      await insert("snapcal_shares", { id, owner: me, kind, data, group_id: group.id });
      return res.status(200).json({ ok: true, id, group });
    }

    if (op === "delete") {
      const id = String(body.id ?? "");
      if (!id) return fail(res, "other", "Missing id.");
      await remove("snapcal_shares", { id: `eq.${id}`, owner: `eq.${me}` }); // owner filter: only your own
      return res.status(200).json({ ok: true });
    }

    return fail(res, "other", "Unknown operation.");
  } catch (err) {
    return fail(res, "other", err?.message ?? String(err));
  }
}
