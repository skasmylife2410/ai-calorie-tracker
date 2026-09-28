// api/shares.js — meals and recipe ideas shared to the Us tab.
//
// POST { op: "list" }                   -> { ok, shares }  your group's, newest first, last 7 days,
//                                                            each with its comments
// POST { op: "share", kind, item }      -> { ok, id }      kind "meal" (a logged meal with its photo)
//                                                            or "post" (a short caption, photo optional)
//                                                            — one of either per person per day
// POST { op: "delete", id }             -> { ok }          only your own
// POST { op: "comment", shareId, body, photo? } -> { ok, comment } anyone in the post's group;
//                                                            a comment is words, a photo, or both
// POST { op: "uncomment", id }          -> { ok }          only your own comment
//
// A shared item is a snapshot: editing or deleting the meal in your log afterwards doesn't
// change what was shared. Photos are shrunk on the phone before upload (posts ~720px, comment
// photos ~480px). Everything older than FEED_DAYS is deleted by /api/weekly (and hidden here before that).

import { isSafeDataImage } from "../js/safe-src.js";
import { requireUser } from "./_auth.js";
import { select, insert, remove, parseBody, newId, restBase } from "./_rest.js";
import { resolveGroup } from "./_groups.js";
import { cleanMicros } from "../js/nutrition.js";
import { notify, displayName } from "./_push.js";
import { membersOf } from "./_groups.js";
import { localDay } from "./_week.js";

const MAX_PHOTO = 180_000;   // data-URL length; the phone sends ~720px WebP/JPEG, ~50–120 KB
const MAX_COMMENT_PHOTO = 90_000; // ~480px, ~20–60 KB
// Photos travel inline in the feed answer, and Vercel caps a response at 4.5 MB. Past this many
// photo bytes, the oldest photos in the answer are left out (the post or comment still shows).
const FEED_PHOTO_BUDGET = 3_200_000;
const PER_DAY = 1;           // posts per person per day (meal or post), by the app's local day
const POST_MAX = 140;        // caption length for a "post"
const FEED_SIZE = 20;        // newest posts shown
const FEED_DAYS = 7;
const COMMENT_MAX = 100;
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

/**
 * Keeps the feed answer under Vercel's response cap: walks posts newest first (and each post's
 * comments newest first) and, once FEED_PHOTO_BUDGET is spent, drops the remaining photos and
 * marks them `photoHidden` so the app can say so instead of silently losing them.
 */
export function fitPhotos(shares, budget = FEED_PHOTO_BUDGET) {
  let left = budget;
  const spend = (holder) => {
    const photo = holder?.photo;
    if (!photo) return;
    if (photo.length <= left) { left -= photo.length; return; }
    holder.photo = null;
    holder.photoHidden = true;
  };
  for (const sh of shares) {
    spend(sh.data);
    for (const c of [...(sh.comments ?? [])].reverse()) spend(c);
  }
  return shares;
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
  if (kind === "post") {
    const photo = isSafeDataImage(item.photo) && item.photo.length <= MAX_PHOTO ? item.photo : null;
    return { text: str(item.text, POST_MAX), photo };
  }
  if (kind === "meal") {
    const photo = typeof item.photo === "string" && isSafeDataImage(item.photo) && item.photo.length <= MAX_PHOTO ? item.photo : null;
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
  const me = await requireUser(req, res);
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
        group_id: `eq.${group.id}`, kind: "in.(meal,post)",
        created_at: `gte.${since}`, order: "created_at.desc", limit: String(FEED_SIZE),
      });
      const shares = rows.filter((r) => (r.kind === "post" ? r.data?.text || r.data?.photo : r.data?.photo));
      const comments = shares.length
        ? await select("snapcal_comments", { select: "id,share_id,owner,body,photo,created_at", share_id: `in.(${shares.map((r) => `"${r.id}"`).join(",")})`, order: "created_at.asc", limit: "500" })
        : [];
      for (const sh of shares) sh.comments = comments.filter((c) => c.share_id === sh.id);
      fitPhotos(shares);
      return res.status(200).json({ ok: true, shares, group });
    }

    if (op === "share") {
      const kind = body.kind === "post" ? "post" : body.kind === "meal" ? "meal" : null;
      if (!kind) return fail(res, "other", "Unknown kind of post.");
      const data = cleanItem(kind, body.item);
      if (kind === "meal") {
        if (!data.name) return fail(res, "empty", "It needs a name.");
        if (!data.photo) return fail(res, "photoOnly", "Only meals with a photo can be shared.");
      } else if (!data.text && !data.photo) {
        return fail(res, "empty", "Write something or add a photo.");
      }

      const { group, error } = await resolveGroup(me, typeof body.group === "string" ? body.group : null);
      if (error === "notMember") return fail(res, "notMember", "You're not in that group.");
      if (!group) return fail(res, "noGroup", "You're not in a group yet.");

      // one post a day, counted by the app's local day (not UTC, which would reset mid-evening)
      const since = new Date(Date.now() - 36 * 3600 * 1000).toISOString();
      const recent = await select("snapcal_shares", { select: "id,created_at", owner: `eq.${me}`, created_at: `gte.${since}`, limit: "10" });
      const today = localDay(new Date());
      if (recent.filter((r) => localDay(new Date(r.created_at)) === today).length >= PER_DAY) {
        return fail(res, "limit", "You've already posted today. You can post again tomorrow.");
      }

      const id = newId();
      await insert("snapcal_shares", { id, owner: me, kind, data, group_id: group.id });
      // everyone else in this group, and only this group
      const [who, members] = await Promise.all([displayName(me), membersOf(group.id).catch(() => [])]);
      await notify(members.filter((u) => u !== me), (lang) => ({
        title: kind === "post"
          ? (lang === "es" ? `${who} publicó algo` : `${who} posted`)
          : (lang === "es" ? `${who} compartió una comida` : `${who} shared a meal`),
        body: kind === "post" ? (data.text || (lang === "es" ? "Una foto" : "A photo")) : `${data.name} · ${Math.round(data.calories)} kcal`,
        url: "/?tab=shared",
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
      const photo = isSafeDataImage(body.photo) && String(body.photo).length <= MAX_COMMENT_PHOTO ? body.photo : null;
      if (body.photo && !photo) return fail(res, "photoTooBig", "That photo couldn't be added. Try another one.");
      if (!shareId || (!text && !photo)) return fail(res, "empty", "Write something or add a photo.");
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
      const comment = { id: newId(), share_id: shareId, owner: me, body: text, ...(photo ? { photo } : {}), created_at: new Date().toISOString() };
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
        body: text || (lang === "es" ? "Una foto" : "A photo"),
        url: "/?tab=shared",
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
