// safe-src.js — the only image sources the app puts into <img src="...">.
// Photos and avatars travel between people (Us feed, dashboard). A string that merely STARTS
// with "data:image/png;base64," could carry a quote and an onerror= handler, so the whole value
// must be plain base64. Anything else becomes "" and no image is shown.
const DATA_IMAGE = /^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/;

export function isSafeDataImage(value) {
  return typeof value === "string" && DATA_IMAGE.test(value);
}

/** A data: image, or a blob:/same-origin URL the app made itself; otherwise "". */
export function safeSrc(value) {
  if (isSafeDataImage(value)) return value;
  if (typeof value === "string" && /^(blob:|\/)[^"'<>\s]*$/.test(value)) return value;
  return "";
}
