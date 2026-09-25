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
  if (!fresh && Date.now() - inboxCache.at < 60_000) return inboxCache.notes;
  const out = await post("/api/notes", { op: "inbox" });
  if (out.ok) inboxCache = { at: Date.now(), notes: out.notes };
  return inboxCache.notes;
}

/** The note to show on Home: the newest unseen one from the last 48 hours, if any. */
export function noteToShow(notes, now = Date.now()) {
  return (notes ?? []).find((n) => !n.seen_at && now - Date.parse(n.created_at) < 48 * 3600 * 1000) ?? null;
}

export const sendNote = (to, body) => post("/api/notes", { op: "send", to, body });
export const notePeople = () => post("/api/notes", { op: "people" });

export async function markNoteSeen(id) {
  inboxCache.notes = inboxCache.notes.map((n) => (n.id === id ? { ...n, seen_at: new Date().toISOString() } : n));
  return post("/api/notes", { op: "seen", id });
}

// --- shares -----------------------------------------------------------------------
export const listShares = (group = null) => post("/api/shares", { op: "list", ...(group ? { group } : {}) });
export const deleteShare = (id) => post("/api/shares", { op: "delete", id });

export const addComment = (shareId, body) => post("/api/shares", { op: "comment", shareId, body });
export const deleteComment = (id) => post("/api/shares", { op: "uncomment", id });

/** Your own Friday recommendation (private — the server only ever returns the signed-in person's). */
export const myRecap = () => post("/api/weekly", { op: "mine" });

export const SHARE_EDGE = 320;

/**
 * Shrinks a photo for the feed: longest edge SHARE_EDGE px, WebP where the browser can write it
 * (Safari falls back to JPEG). A feed post ends up ~15–30 KB instead of the 60–150 KB log photo.
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

/** Share one of your logged meals (a snapshot of it). Only meals with a photo can be shared. */
export async function shareMeal(entry, note = "", group = null) {
  const photo = await shrinkPhoto(entry?.photoDataUrl ?? null);
  if (!photo) return { ok: false, errorType: "photoOnly", message: "Only meals with a photo can be shared." };
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
      note,
    },
  });
}
