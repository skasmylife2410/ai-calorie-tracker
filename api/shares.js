// api/shares.js — meals and recipe ideas shared to the Us tab.
//
// POST { op: "list" }                   -> { ok, shares }  your group's, newest first, last 7 days,
//                                                            each with its comments
// POST { op: "share", kind, item }      -> { ok, id }      meals with a photo only
// POST { op: "delete", id }             -> { ok }          only your own
// POST { op: "comment", shareId, body } -> { ok, comment } anyone in the post's group
// POST { op: "uncomment", id }          -> { ok }          only your own comment
//
// A shared item is a snapshot: editing or deleting the meal in your log afterwards doesn't
// change what was shared. Posts must carry a photo, shrunk on the phone to ~320px before
// upload. Everything older than FEED_DAYS is deleted by /api/weekly (and hidden here before that).

import { checkAuth } from "./_auth.js";
import { select, insert, remove, parseBody, newId, restBase } from "./_rest.js";
import { resolveGroup } from "./_groups.js";
import { cleanMicros } from "../js/nutrition.js";
import { notify, displayName } from "./_push.js";
import { membersOf } from "./_groups.js";

const MAX_PHOTO = 60_000;    // data-URL length; the phone sends ~320px WebP/JPEG, ~15–30 KB
const PER_DAY = 3;           // posts per person per day
const FEED_SIZE = 20;        // newest posts shown
const FEED_DAYS = 7;
const COMMENT_MAX = 200;
const COMMENTS_PER_DAY = 40;
const COMMENTS_PER_POST = 50;

const fail = (res, errorType, message, status = 200) => res.status(status).json({ ok: false, errorType, message });
const num = (v) => (Number.isFinite(Number(v)) ? Math.max(0, Math.round(Number(v) * 10) / 10) : 0);
const str = (v, max) => String(v ?? "").trim().slice(0, max);

/** Nutrient values from the client, capped at sane sizes (so someone copying the meal gets them too). */
function boundedMicros(raw) {
  const m = cleanMicros(raw);
  if (!m) return null;
  for (const k of Object.keys(m)) if (m[k] !== null) m[k] = Math.min(m[k], k.endsWith("Mg") ? 50000 : 2000);
  return m;
}

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
      ? item.items.slice(0, 12).map((i) => ({ name: str(i.name, 60), gramsEstimate: num(i.gramsEstimate), calories: num(i.calories), proteinG: num(i.proteinG), carbsG: num(i.carbsG), fatG: num(i.fatG), micros: boundedMicros(i.micros) }))
      : [];
    return { ...base, micros: boundedMicros(item.micros), photo, items };
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
      const since = new Date(Date.now() - FEED_DAYS * 86400000).toISOString();
      const rows = await select("snapcal_shares", {
        select: "id,owner,kind,data,created_at,group_id",
        group_id: `eq.${group.id}`, kind: "eq.meal",
        created_at: `gte.${since}`, order: "created_at.desc", limit: String(FEED_SIZE),
      });
      const shares = rows.filter((r) => r.data?.photo);
      const comments = shares.length
        ? await select("snapcal_comments", { select: "id,share_id,owner,body,created_at", share_id: `in.(${shares.map((r) => `"${r.id}"`).join(",")})`, order: "created_at.asc", limit: "500" })
        : [];
      for (const sh of shares) sh.comments = comments.filter((c) => c.share_id === sh.id);
      return res.status(200).json({ ok: true, shares, group });
    }

    if (op === "share") {
      if (body.kind !== "meal") return fail(res, "photoOnly", "Only meals with a photo can be shared.");
      const kind = "meal";
      const data = cleanItem(kind, body.item);
      if (!data.name) return fail(res, "empty", "It needs a name.");
      if (!data.photo) return fail(res, "photoOnly", "Only meals with a photo can be shared.");

      const today = new Date(); today.setUTCHours(0, 0, 0, 0);
      const mine = await select("snapcal_shares", { select: "id", owner: `eq.${me}`, created_at: `gte.${today.toISOString()}`, limit: String(PER_DAY + 1) });
      if (mine.length >= PER_DAY) return fail(res, "limit", `You can share ${PER_DAY} meals a day.`);

      const { group, error } = await resolveGroup(me, typeof body.group === "string" ? body.group : null);
      if (error === "notMember") return fail(res, "notMember", "You're not in that group.");
      if (!group) return fail(res, "noGroup", "You're not in a group yet.");

      const id = newId();
      await insert("snapcal_shares", { id, owner: me, kind, data, group_id: group.id });
      // everyone else in this group, and only this group
      const [who, members] = await Promise.all([displayName(me), membersOf(group.id).catch(() => [])]);
      const kcal = Math.round(data.calories);
      await notify(members.filter((u) => u !== me), (lang) => ({
        title: lang === "es" ? `${who} compartió una comida` : `${who} shared a meal`,
        body: `${data.name} · ${kcal} kcal`,
        url: "/?tab=us",
        tag: `post-${id}`,
      }));
      return res.status(200).json({ ok: true, id, group });
    }

    if (op === "delete") {
      const id = String(body.id ?? "");
      if (!id) return fail(res, "other", "Missing id.");
      await remove("snapcal_shares", { id: `eq.${id}`, owner: `eq.${me}` }); // owner filter: only your own
      return res.status(200).json({ ok: true });
    }

    if (op === "comment") {
      const shareId = String(body.shareId ?? "");
      const text = str(body.body, COMMENT_MAX);
      if (!shareId || !text) return fail(res, "empty", "Write something first.");
      const [post] = await select("snapcal_shares", { select: "id,group_id,created_at,owner,data->>name", id: `eq.${shareId}`, limit: "1" });
      if (!post || Date.parse(post.created_at) < Date.now() - FEED_DAYS * 86400000) return fail(res, "gone", "That post is gone.");
      const { group, error } = await resolveGroup(me, post.group_id);
      if (error || !group || group.id !== post.group_id) return fail(res, "notMember", "You're not in that group.");
      const today = new Date(); today.setUTCHours(0, 0, 0, 0);
      const [mineToday, onPost] = await Promise.all([
        select("snapcal_comments", { select: "id", owner: `eq.${me}`, created_at: `gte.${today.toISOString()}`, limit: String(COMMENTS_PER_DAY + 1) }),
        select("snapcal_comments", { select: "id", share_id: `eq.${shareId}`, limit: String(COMMENTS_PER_POST + 1) }),
      ]);
      if (mineToday.length >= COMMENTS_PER_DAY) return fail(res, "limit", "That's a lot of comments for one day.");
      if (onPost.length >= COMMENTS_PER_POST) return fail(res, "limit", "This post has reached its comment limit.");
      const comment = { id: newId(), share_id: shareId, owner: me, body: text, created_at: new Date().toISOString() };
      await insert("snapcal_comments", comment);
      // The post's owner, plus anyone who already commented on it — never the commenter.
      const earlier = await select("snapcal_comments", { select: "owner", share_id: `eq.${shareId}`, limit: "60" }).catch(() => []);
      const who = await displayName(me);
      const meal = String(post.name ?? "").slice(0, 60);
      const others = [...new Set(earlier.map((c) => c.owner))].filter((u) => u !== me && u !== post.owner);
      const msg = (mine) => (lang) => ({
        title: mine
          ? (lang === "es" ? `${who} comentó tu comida` : `${who} commented on your meal`)
          : (lang === "es" ? `${who} también comentó · ${meal}` : `${who} also commented · ${meal}`),
        body: text,
        url: "/?tab=us",
        tag: `comments-${shareId}`,
      });
      await Promise.all([post.owner !== me ? notify([post.owner], msg(true)) : null, notify(others, msg(false))]);
      return res.status(200).json({ ok: true, comment });
    }

    if (op === "uncomment") {
      const id = String(body.id ?? "");
      if (!id) return fail(res, "other", "Missing id.");
      await remove("snapcal_comments", { id: `eq.${id}`, owner: `eq.${me}` }); // only your own
      return res.status(200).json({ ok: true });
    }

    return fail(res, "other", "Unknown operation.");
  } catch (err) {
    return fail(res, "other", err?.message ?? String(err));
  }
}
