// nano-doodle.js — the Nano Banana doodle on the phone side (server: api/doodle.js).
//
// One picture per pose (strong / well fed / idle), per doodle choice (him / her), per profile
// photo. Each is generated once, shrunk to 360px and kept on the phone, so after the first day
// the doodle costs nothing and appears instantly. Change the photo and new ones are drawn.
//
// If generation fails (most often: the Gemini key has no billing, which image models need),
// the app keeps its own drawn doodle and doesn't try again for a week, so nobody sees errors
// or burns requests.

import { apiFetch } from "../net.js";

const PREFIX = "snapcal.nano.";
const FAIL_KEY = "snapcal.nanoFail";
const RETRY_AFTER_FAIL = 7 * 24 * 3600 * 1000;
const OUT_SIZE = 360;
let inFlight = null;

function hashOf(str) {
  const s = String(str ?? "none");
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 5) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36) + s.length.toString(36);
}

const keyFor = (state, variant, avatar) => `${PREFIX}${hashOf(avatar)}.${variant}.${state}`;

export function cachedNanoDoodle(state, variant, avatar) {
  try { return localStorage.getItem(keyFor(state, variant, avatar)); } catch { return null; }
}

/** Why the last attempt failed, if it's still within the cool-off — for the Profile screen. */
export function nanoFailure() {
  try {
    const f = JSON.parse(localStorage.getItem(FAIL_KEY) || "null");
    return f && Date.now() - f.at < RETRY_AFTER_FAIL ? f : null;
  } catch { return null; }
}

/**
 * Makes the doodle for this pose if it isn't cached. Resolves to a data URL, or null.
 * Only one request runs at a time; overlapping calls share it.
 */
export async function ensureNanoDoodle(state, variant, avatar) {
  const cached = cachedNanoDoodle(state, variant, avatar);
  if (cached) return cached;
  if (nanoFailure()) return null;
  if (inFlight) return inFlight.then(() => cachedNanoDoodle(state, variant, avatar));

  inFlight = (async () => {
    try {
      const photo = avatar ? await toJpegBase64(avatar, 512) : null;
      const res = await apiFetch("/api/doodle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state, variant, photo }),
      });
      const out = await res.json();
      if (!out.ok) {
        localStorage.setItem(FAIL_KEY, JSON.stringify({ at: Date.now(), errorType: out.errorType, message: out.message }));
        return null;
      }
      const small = await shrink(`data:${out.mime};base64,${out.image}`, OUT_SIZE);
      try { localStorage.setItem(keyFor(state, variant, avatar), small); } catch { /* storage full: still show it this time */ }
      return small;
    } catch {
      return null;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

function load(src) {
  return new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = src; });
}

async function toJpegBase64(dataUrl, size) {
  const img = await load(dataUrl);
  const side = Math.min(img.naturalWidth, img.naturalHeight);
  const c = document.createElement("canvas");
  c.width = c.height = Math.min(size, side);
  c.getContext("2d").drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.85).split(",")[1];
}

async function shrink(dataUrl, size) {
  const img = await load(dataUrl);
  const scale = Math.min(1, size / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement("canvas");
  c.width = Math.round(img.naturalWidth * scale);
  c.height = Math.round(img.naturalHeight * scale);
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, c.width, c.height);
  // The model draws on white. Turn the paper transparent — ink keeps its opacity, near-white
  // fades out smoothly — so the doodle sits on any card or background with no box around it.
  const px = ctx.getImageData(0, 0, c.width, c.height);
  const d = px.data;
  for (let i = 0; i < d.length; i += 4) {
    const lightness = Math.min(d[i], d[i + 1], d[i + 2]);
    if (lightness > 200) d[i + 3] = Math.round(d[i + 3] * Math.max(0, (255 - lightness) / 55));
  }
  ctx.putImageData(px, 0, 0);
  const webp = c.toDataURL("image/webp", 0.85);
  return webp.startsWith("data:image/webp") ? webp : c.toDataURL("image/png");
}
