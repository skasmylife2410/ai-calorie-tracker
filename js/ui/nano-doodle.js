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
// ".v2": the paper is fully cleared (see cleanPaper). Doodles saved before that are cleaned on the
// phone the first time they're needed, without asking the model to draw them again.
const cleanKey = (state, variant, avatar) => `${keyFor(state, variant, avatar)}.v2`;

export function cachedNanoDoodle(state, variant, avatar) {
  try { return localStorage.getItem(cleanKey(state, variant, avatar)); } catch { return null; }
}

function store(state, variant, avatar, url) {
  try {
    localStorage.setItem(cleanKey(state, variant, avatar), url);
    localStorage.removeItem(keyFor(state, variant, avatar)); // the old copy, if any
  } catch { /* storage full: still show it this time */ }
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
  // Saved before the paper was cleared properly: clean that copy instead of drawing a new one.
  let old = null;
  try { old = localStorage.getItem(keyFor(state, variant, avatar)); } catch { /* private mode */ }
  if (old) {
    try {
      const cleaned = await cleanPaper(old);
      store(state, variant, avatar, cleaned);
      return cleaned;
    } catch { /* fall through and draw it again */ }
  }
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
      store(state, variant, avatar, small);
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
  return cleanPaper(dataUrl, size);
}

/**
 * The model draws on paper that is white-ish but rarely pure white. Measure the paper from the
 * picture's edges, then keep only what is clearly darker than it (the ink, and any accent),
 * with smooth edges; everything paper-coloured becomes fully transparent. Leftover paper haze
 * was invisible on a white card but showed as a box in dark mode, or when a phone's browser
 * recolours pictures for its own dark mode.
 */
export async function cleanPaper(dataUrl, size = OUT_SIZE) {
  const img = await load(dataUrl);
  const scale = Math.min(1, size / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(img.naturalWidth * scale));
  c.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, c.width, c.height);
  const px = ctx.getImageData(0, 0, c.width, c.height);
  const d = px.data;
  const w = c.width, h = c.height;

  // paper: the typical lightness along the border (already-transparent pixels count as white)
  const edge = [];
  const sample = (x, y) => {
    const i = (y * w + x) * 4;
    edge.push(d[i + 3] < 40 ? 255 : Math.min(d[i], d[i + 1], d[i + 2]));
  };
  for (let x = 0; x < w; x += 2) { sample(x, 0); sample(x, h - 1); }
  for (let y = 0; y < h; y += 2) { sample(0, y); sample(w - 1, y); }
  edge.sort((a, b) => a - b);
  const paper = Math.max(170, edge[Math.floor(edge.length / 2)] ?? 255);

  for (let i = 0; i < d.length; i += 4) {
    const dark = paper - Math.min(d[i], d[i + 1], d[i + 2]);         // how much darker than the paper
    const ink = Math.max(0, Math.min(1, (dark - 18) / 70));           // within ~18 of paper: gone
    d[i + 3] = Math.round(d[i + 3] * ink);
  }
  ctx.putImageData(px, 0, 0);
  const webp = c.toDataURL("image/webp", 0.85);
  return webp.startsWith("data:image/webp") ? webp : c.toDataURL("image/png");
}
