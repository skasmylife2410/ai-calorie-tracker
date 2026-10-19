// social.js — client side of notes (api/notes.js) and the shared feed (api/shares.js).
import { apiFetch } from "./net.js";

async function post(url, body) {
  try {
    const res = await apiFetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return await res.json();
  } catch (err) {
    return { ok: false, errorType: "network", message: "No connection." };
  }
}

// --- notes ------------------------------------------------------------------------
let inboxCache = { at: 0, notes: [] };

export async function inbox({ fresh = false } = {}) {
  if (!fresh && Date.now() - inboxCache.at < 60000) return inboxCache.notes;
  const out = await post("/api/notes", { op: "inbox" });
  if (out.ok) inboxCache = { at: Date.now(), notes: out.notes };
  return inboxCache.notes;
}

/** The note to show on Home: the newest unseen one from the last 48 hours, if any. */
export function noteToShow(notes, now = Date.now()) {
  return (notes ?? []).find((n) => !n.seen_at && now - Date.parse(n.created_at) < 48 * 3600 * 1000) ?? null;
}

export const sendNote = (to, body, gif = null) => post("/api/notes", { op: "send", to, body, ...(gif ? { gif } : {}) });
export const notePeople = () => post("/api/notes", { op: "people" });

export async function markNoteSeen(id) {
  inboxCache.notes = inboxCache.notes.map((n) => (n.id === id ? { ...n, seen_at: new Date().toISOString() } : n));
  return post("/api/notes", { op: "seen", id });
}

// --- shares -----------------------------------------------------------------------
export const listShares = (group = null) => post("/api/shares", { op: "list", ...(group ? { group } : {}) });
export const deleteShare = (id) => post("/api/shares", { op: "delete", id });

/** A comment is words, a photo, or both. The photo is shrunk to COMMENT_EDGE before upload. */
export async function addComment(shareId, body, photoDataUrl = null, gif = null) {
  const photo = photoDataUrl ? await shrinkPhoto(photoDataUrl, COMMENT_EDGE) : null;
  if (photoDataUrl && !photo) return { ok: false, errorType: "photo", message: null };
  return post("/api/shares", { op: "comment", shareId, body, ...(photo ? { photo } : gif ? { gif } : {}) });
}

/** GIPHY search through the server (trending when `q` is empty). -> {ok, gifs:[{id,w,h}]} */
export const searchGifs = (q = "", lang = "en") => post("/api/shares", { op: "gifs", q, lang });
export const deleteComment = (id) => post("/api/shares", { op: "uncomment", id });

/** Your own Friday recommendation (private — the server only ever returns the signed-in person's). */
// the Friday check-in changes once a week: one answer is kept for a few minutes, so redrawing
// the Us tab doesn't ask again each time
const recapCache = new Map();
export function myRecap(lang = "en") {
  const hit = recapCache.get(lang);
  if (hit && Date.now() - hit.at < 5 * 60000) return hit.answer;
  const answer = post("/api/weekly", { op: "mine", lang }).then((out) => {
    if (!out?.ok) recapCache.delete(lang); // never keep a failure
    return out;
  });
  recapCache.set(lang, { at: Date.now(), answer });
  return answer;
}

export const SHARE_EDGE = 720;   // posts fill the card width, so they need to be sharp on a 3x screen
export const COMMENT_EDGE = 480; // photo replies show smaller, inside the thread

/**
 * Shrinks a photo for the feed: longest edge SHARE_EDGE px, WebP where the browser can write it
 * (Safari falls back to JPEG). A post photo ends up ~50–120 KB, a comment photo ~20–60 KB; the
 * server's limits (api/shares.js) sit above both.
 */
export async function shrinkPhoto(dataUrl, edge = SHARE_EDGE) {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) return null;
  if (typeof document === "undefined") return dataUrl;
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = dataUrl;
    });
    const scale = Math.min(1, edge / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
    const webp = canvas.toDataURL("image/webp", 0.6);
    return webp.startsWith("data:image/webp") ? webp : canvas.toDataURL("image/jpeg", 0.6);
  } catch {
    return null;
  }
}

export const POST_MAX = 140;
export const CAPTION_MAX = 140; // a shared meal's caption
export const COMMENT_MAX = 100;

/** Today's post to your group: a short caption, a photo or a GIF, or words with either. One a day. */
export async function createPost(text, photoDataUrl = null, group = null, gif = null) {
  const photo = photoDataUrl ? await shrinkPhoto(photoDataUrl) : null;
  return post("/api/shares", {
    op: "share",
    kind: "post",
    ...(group ? { group } : {}),
    item: { text: String(text ?? "").trim().slice(0, POST_MAX), photo, ...(!photo && gif ? { gif } : {}) },
  });
}

/** Share one of your logged meals (a snapshot of it): its photo if it has one, and a caption (`note`). */
export async function shareMeal(entry, note = "", group = null) {
  const photo = entry?.photoDataUrl ? await shrinkPhoto(entry.photoDataUrl) : null;
  return post("/api/shares", {
    op: "share",
    kind: "meal",
    ...(group ? { group } : {}),
    item: {
      name: entry.name,
      calories: entry.calories,
      proteinG: entry.proteinG,
      carbsG: entry.carbsG,
      fatG: entry.fatG,
      micros: entry.micros ?? null,
      photo,
      items: entry.analysisItems ?? [],
      note: String(note ?? "").trim().slice(0, CAPTION_MAX),
      entryId: entry.entryId ?? entry.id ?? null, // sharing the same meal again doesn't post it twice
    },
  });
}

// --- groups -----------------------------------------------------------------------
// The groups you're in, kept for a minute: "Share" asks which one when there's more than one.
let groupsCache = { at: 0, out: null };

/** /api/groups: your groups with members, asks waiting for you, and names. Kept for a minute. */
export async function myGroupsInfo({ fresh = false } = {}) {
  if (!fresh && groupsCache.out && Date.now() - groupsCache.at < 60000) return groupsCache.out;
  const out = await post("/api/groups", {});
  if (out.ok) groupsCache = { at: Date.now(), out };
  return out;
}

/** Changes your groups (create, leave, add, accept, decline); answers with the new state. */
export async function changeGroups(body) {
  const out = await post("/api/groups", body);
  if (out.ok) groupsCache = { at: Date.now(), out };
  return out;
}

export async function sharingGroups() {
  const out = await myGroupsInfo();
  return out.ok ? out.groups.map((g) => ({ id: g.id, name: g.name })) : [];
}
