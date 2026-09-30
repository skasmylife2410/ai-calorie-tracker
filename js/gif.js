// gif.js — GIFs from GIPHY in posts, comments and notes.
//
// Only a GIF's id and size are stored ({id, w, h}); the picture itself is played straight from
// GIPHY's servers, so GIFs cost nothing against the feed's photo budget. The id is checked
// against a strict pattern everywhere it's used, and the URL is built here from it, so a stored
// value can never point an <img> anywhere but GIPHY. Searching goes through api/shares.js
// (op "gifs"), which holds the GIPHY_API_KEY and asks for PG-rated results only.

const ID = /^[A-Za-z0-9]{5,40}$/;

/** A clean {id, w, h}, or null. Width and height only size the box before the GIF arrives. */
export function cleanGif(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = String(raw.id ?? "");
  if (!ID.test(id)) return null;
  const dim = (v) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) && n > 0 ? Math.min(n, 2000) : 200;
  };
  return { id, w: dim(raw.w), h: dim(raw.h) };
}

/** "small" (200 px wide: picker, comments, notes) or "large" (posts, which fill the card). */
export function gifUrl(gif, size = "small") {
  const g = cleanGif(gif);
  if (!g) return "";
  return `https://media.giphy.com/media/${g.id}/${size === "large" ? "giphy.webp" : "200w.webp"}`;
}

/** An <img> for a GIF, sized by its shape so the thread doesn't jump when it loads. */
export function gifImgHtml(gif, { cls = "gif-img", size = "small", alt = "GIF" } = {}) {
  const g = cleanGif(gif);
  if (!g) return "";
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  return `<img class="${cls}" src="${gifUrl(g, size)}" width="${g.w}" height="${g.h}" style="aspect-ratio:${g.w}/${g.h}" alt="${esc(alt)}" loading="lazy" decoding="async" referrerpolicy="no-referrer">`;
}

/** The quick words under the search box: label key -> what is searched (English finds more). */
export const GIF_TOPICS = [
  { key: "trending", q: "" },
  { key: "yum", q: "yum" },
  { key: "proud", q: "proud of you" },
  { key: "gym", q: "workout" },
  { key: "highFive", q: "high five" },
  { key: "tired", q: "tired" },
];

/** GIPHY's answer -> [{id, w, h}] using the 200 px wide rendition's size. */
export function gifsFromGiphy(body) {
  const data = Array.isArray(body?.data) ? body.data : [];
  return data
    .map((d) => cleanGif({ id: d?.id, w: d?.images?.fixed_width?.width, h: d?.images?.fixed_width?.height }))
    .filter(Boolean);
}
