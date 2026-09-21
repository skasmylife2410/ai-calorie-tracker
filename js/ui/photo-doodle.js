// photo-doodle.js — turns a profile photo into a pen-and-ink sketch for the doodle's face.
//
// Runs on the phone, no server or AI: greyscale -> soften -> find edges (Sobel) -> keep the
// strongest ones as ink lines -> cut to a circle. The result is a small transparent PNG that
// sits inside the doodle's head, so the character looks like a drawing of you.
//
// Results are cached (memory + localStorage) keyed by a hash of the photo, so the work happens
// once per photo, not on every render.

const SIZE = 128;
const CACHE_PREFIX = "snapcal.faceDoodle.";
const memory = new Map();

function hashOf(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 7) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36) + str.length.toString(36);
}

/** Cached sketch for this photo, or null if it hasn't been made yet. Synchronous. */
export function cachedFaceDoodle(photoDataUrl) {
  if (!photoDataUrl) return null;
  const key = hashOf(photoDataUrl);
  if (memory.has(key)) return memory.get(key);
  try {
    const stored = localStorage.getItem(CACHE_PREFIX + key);
    if (stored) { memory.set(key, stored); return stored; }
  } catch { /* private mode */ }
  return null;
}

/** Makes (or returns the cached) sketch. Resolves to a PNG data URL, or null on failure. */
export async function makeFaceDoodle(photoDataUrl) {
  const cached = cachedFaceDoodle(photoDataUrl);
  if (cached) return cached;
  try {
    const img = await loadImage(photoDataUrl);
    const out = sketch(img);
    const key = hashOf(photoDataUrl);
    memory.set(key, out);
    try { localStorage.setItem(CACHE_PREFIX + key, out); } catch { /* storage full: memory only */ }
    return out;
  } catch {
    return null;
  }
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function sketch(img) {
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  // centre-crop to a square
  const side = Math.min(img.naturalWidth, img.naturalHeight);
  ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, SIZE, SIZE);
  const src = ctx.getImageData(0, 0, SIZE, SIZE).data;

  // greyscale
  const g = new Float32Array(SIZE * SIZE);
  for (let i = 0; i < g.length; i++) g[i] = 0.299 * src[i * 4] + 0.587 * src[i * 4 + 1] + 0.114 * src[i * 4 + 2];

  // soften (3x3 box blur twice) so skin texture and noise don't become lines
  const blur = (a) => {
    const b = new Float32Array(a.length);
    for (let y = 1; y < SIZE - 1; y++) for (let x = 1; x < SIZE - 1; x++) {
      let s = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += a[(y + dy) * SIZE + x + dx];
      b[y * SIZE + x] = s / 9;
    }
    return b;
  };
  const soft = blur(blur(g));

  // Sobel edge strength
  const mag = new Float32Array(SIZE * SIZE);
  for (let y = 1; y < SIZE - 1; y++) for (let x = 1; x < SIZE - 1; x++) {
    const p = (dx, dy) => soft[(y + dy) * SIZE + x + dx];
    const gx = -p(-1, -1) - 2 * p(-1, 0) - p(-1, 1) + p(1, -1) + 2 * p(1, 0) + p(1, 1);
    const gy = -p(-1, -1) - 2 * p(0, -1) - p(1, -1) + p(-1, 1) + 2 * p(0, 1) + p(1, 1);
    mag[y * SIZE + x] = Math.hypot(gx, gy);
  }

  // keep roughly the strongest 14% of edges as ink, whatever the photo's contrast
  const sorted = Float32Array.from(mag).sort();
  const cut = sorted[Math.floor(sorted.length * 0.86)] || 1;

  const out = ctx.createImageData(SIZE, SIZE);
  const r = SIZE / 2;
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const i = y * SIZE + x;
    const inside = (x - r) ** 2 + (y - r) ** 2 < (r - 1) ** 2;
    const ink = inside ? Math.max(0, Math.min(1, (mag[i] - cut) / cut + 0.35)) : 0;
    out.data[i * 4] = 28;
    out.data[i * 4 + 1] = 28;
    out.data[i * 4 + 2] = 30;
    out.data[i * 4 + 3] = mag[i] >= cut && inside ? Math.round(255 * ink) : 0;
  }
  ctx.putImageData(out, 0, 0);
  return canvas.toDataURL("image/png");
}
