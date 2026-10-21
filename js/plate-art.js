// plate-art.js — a picture of a mealtime's foods for a share that has no photos to make a collage
// from. The server draws it with the image model (api/doodle.js, op "plate"); here it's asked for, set on a
// white 4:3 frame the size of a post photo and kept for this visit, so reopening the share sheet
// doesn't pay for a second picture. When it can't be drawn (no credits, no connection, too slow)
// the answer is null and the share goes out with the board instead (js/ui/ingredient-board.js).

import { apiFetch } from "./net.js";
import { shrinkPhoto, SHARE_EDGE } from "./social.js";

const MAX_DRAW = 8;                 // foods in the picture (the server holds the same line)
const WAIT_MS = 30000;              // image models take a few seconds to ten; past this, the board
const MAX_PHOTO_CHARS = 170000;     // the server's photo limit (api/shares.js) is 180,000
const made = new Map();             // foods -> picture, for this visit

const keyOf = (foods) => foods.map((f) => `${f.name}|${Math.round(Number(f.gramsEstimate) || 0)}`).join(";");

/** The picture on a white SHARE_EDGE × ¾ frame, whatever shape the model drew it in. */
export async function frameOnWhite(dataUrl, edge = SHARE_EDGE) {
  if (typeof document === "undefined") return shrinkPhoto(dataUrl, edge);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = dataUrl;
    });
    const w = edge, h = Math.round(edge * 0.75);
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
    const scale = Math.min(w / (img.naturalWidth || 1), h / (img.naturalHeight || 1)); // contain: all of it shows
    const dw = (img.naturalWidth || 1) * scale, dh = (img.naturalHeight || 1) * scale;
    ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
    for (const q of [0.7, 0.5, 0.35]) {
      const webp = canvas.toDataURL("image/webp", q);
      const out = webp.startsWith("data:image/webp") ? webp : canvas.toDataURL("image/jpeg", q);
      if (out.length <= MAX_PHOTO_CHARS) return out;
    }
    return null;
  } catch {
    return null;
  }
}

/** Asks for the picture of these foods ({name, gramsEstimate}); a data URL, or null. */
export async function drawPlate(foods, { waitMs = WAIT_MS } = {}) {
  const list = (foods ?? []).filter((f) => String(f?.name ?? "").trim()).slice(0, MAX_DRAW);
  if (list.length === 0) return null;
  const key = keyOf(list);
  if (made.has(key)) return made.get(key);
  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), waitMs) : null;
  try {
    const res = await apiFetch("/api/doodle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op: "plate", foods: list.map((f) => ({ name: f.name, grams: f.gramsEstimate })) }),
      ...(ctrl ? { signal: ctrl.signal } : {}),
    });
    const out = await res.json();
    if (!out?.ok || !out.image) return null;
    const picture = await frameOnWhite(`data:${out.mime || "image/png"};base64,${out.image}`);
    if (picture) made.set(key, picture);
    return picture;
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
