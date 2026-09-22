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
export const listShares = () => post("/api/shares", { op: "list" });
export const deleteShare = (id) => post("/api/shares", { op: "delete", id });

/** Share one of your logged meals (a snapshot of it). */
export function shareMeal(entry, note = "") {
  return post("/api/shares", {
    op: "share",
    kind: "meal",
    item: {
      name: entry.name,
      calories: entry.calories,
      proteinG: entry.proteinG,
      carbsG: entry.carbsG,
      fatG: entry.fatG,
      photo: entry.photoDataUrl ?? null,
      items: entry.analysisItems ?? [],
      note,
    },
  });
}

export function shareIdea(recipe, note = "") {
  return post("/api/shares", { op: "share", kind: "idea", item: { ...recipe, note } });
}
