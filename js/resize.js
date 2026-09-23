// resize.js — port of ImageResizer.swift. Browser-only (uses canvas/Image/createImageBitmap);
// not exercised by the Node test suite, but `computeTargetSize` is pure and is tested there.
//
// Portability note (spec §4, §15.5): iOS's UIGraphicsImageRenderer normalizes EXIF orientation
// automatically before redrawing. Browser <canvas> drawImage does NOT do this uniformly, so we
// prefer createImageBitmap(..., {imageOrientation:'from-image'}) (correct, modern browsers) and
// fall back to a manual EXIF-orientation parse + canvas transform for engines that lack it.

export const MAX_EDGE = 768;
export const JPEG_QUALITY = 0.8;

/**
 * Scan quality presets. What Gemini charges for an image depends on its SIZE, not its JPEG
 * quality: pictures are cut into 768px tiles and billed per tile, and anything up to 384px on
 * both sides is the cheapest single tile. JPEG quality changes the upload size and what the
 * photo costs to store, not the token count.
 *
 *   saver    512px — one tile, still enough detail for the model to name a plate of food
 *   standard 768px — the old default: more detail on busy plates, up to twice the tiles
 *   tiny     384px — cheapest possible; fine for one obvious item, weaker on mixed plates
 */
export const SCAN_PRESETS = {
  tiny:     { maxEdge: 384, quality: 0.55 },
  saver:    { maxEdge: 512, quality: 0.62 },
  standard: { maxEdge: 768, quality: 0.8 },
};

export const DEFAULT_SCAN_PRESET = "saver";

/** The preset for a profile, falling back to the saver default. */
export function scanPreset(name) {
  return SCAN_PRESETS[name] ?? SCAN_PRESETS[DEFAULT_SCAN_PRESET];
}

/**
 * Pure resize-target math, verbatim port of ImageResizer.targetSize. Never upscales.
 * @param {number} width
 * @param {number} height
 * @param {number} maxEdge
 * @returns {{width:number, height:number}}
 */
export function computeTargetSize(width, height, maxEdge = MAX_EDGE) {
  const longestEdge = Math.max(width, height);
  if (longestEdge <= maxEdge || longestEdge <= 0) return { width, height };
  const scale = maxEdge / longestEdge;
  return { width: width * scale, height: height * scale };
}

/** Reads the EXIF orientation tag (0x0112) from a JPEG ArrayBuffer. Returns 1 (identity) if absent/not JPEG. */
export function readExifOrientation(buffer) {
  const view = new DataView(buffer);
  if (view.byteLength < 4 || view.getUint16(0, false) !== 0xffd8) return 1;

  let offset = 2;
  const length = view.byteLength;
  while (offset + 4 <= length) {
    const marker = view.getUint16(offset, false);
    offset += 2;
    if (marker === 0xffe1) {
      const exifBlockLength = view.getUint16(offset, false);
      if (offset + 2 + 6 > length) return 1;
      if (view.getUint32(offset + 2, false) !== 0x45786966) return 1; // "Exif"
      const tiffOffset = offset + 8;
      if (tiffOffset + 8 > length) return 1;
      const little = view.getUint16(tiffOffset, false) === 0x4949;
      const firstIfdOffset = view.getUint32(tiffOffset + 4, little);
      const dirStart = tiffOffset + firstIfdOffset;
      if (dirStart + 2 > length) return 1;
      const entryCount = view.getUint16(dirStart, little);
      for (let i = 0; i < entryCount; i++) {
        const entryOffset = dirStart + 2 + i * 12;
        if (entryOffset + 12 > length) break;
        const tag = view.getUint16(entryOffset, little);
        if (tag === 0x0112) {
          return view.getUint16(entryOffset + 8, little);
        }
      }
      return 1;
    } else if (marker === 0xffda) {
      break; // start of scan — no more metadata segments
    } else if ((marker & 0xff00) === 0xff00) {
      offset += view.getUint16(offset, false);
    } else {
      break;
    }
  }
  return 1;
}

/** Applies the canvas transform equivalent to a given EXIF orientation (1-8). No-op for 1/unknown. */
function applyOrientationTransform(ctx, orientation, canvasWidth, canvasHeight) {
  switch (orientation) {
    case 2:
      ctx.transform(-1, 0, 0, 1, canvasWidth, 0);
      break;
    case 3:
      ctx.transform(-1, 0, 0, -1, canvasWidth, canvasHeight);
      break;
    case 4:
      ctx.transform(1, 0, 0, -1, 0, canvasHeight);
      break;
    case 5:
      ctx.transform(0, 1, 1, 0, 0, 0);
      break;
    case 6:
      ctx.transform(0, 1, -1, 0, canvasHeight, 0);
      break;
    case 7:
      ctx.transform(0, -1, -1, 0, canvasHeight, canvasWidth);
      break;
    case 8:
      ctx.transform(0, -1, 1, 0, 0, canvasWidth);
      break;
    default:
      break; // 1: identity
  }
}

function isSwappedOrientation(orientation) {
  return orientation >= 5 && orientation <= 8;
}

/**
 * Resizes an image Blob/File to <=768px longest edge, JPEG quality 0.8, never upscaling,
 * with EXIF orientation handled.
 * @param {Blob} blobOrFile
 * @param {{maxEdge?:number, quality?:number}} [options]
 * @returns {Promise<{blob:Blob, dataUrl:string, width:number, height:number}>}
 */
export async function resizeImage(blobOrFile, { maxEdge = MAX_EDGE, quality = JPEG_QUALITY } = {}) {
  let bitmap = null;
  let orientation = 1;
  let usedAutoOrientation = false;

  if (typeof createImageBitmap === "function") {
    try {
      bitmap = await createImageBitmap(blobOrFile, { imageOrientation: "from-image" });
      usedAutoOrientation = true;
    } catch {
      bitmap = null;
    }
  }

  if (!bitmap) {
    // Manual fallback: parse EXIF ourselves, decode raw (un-rotated) pixels, apply transform below.
    const buffer = await blobOrFile.arrayBuffer();
    orientation = readExifOrientation(buffer.slice(0));
    const freshBlob = new Blob([buffer], { type: blobOrFile.type || "image/jpeg" });
    if (typeof createImageBitmap === "function") {
      bitmap = await createImageBitmap(freshBlob, { imageOrientation: "none" }).catch(() => null);
    }
    if (!bitmap) {
      bitmap = await decodeViaImageElement(freshBlob);
      // <img>-decoded bitmaps are typically ALREADY auto-oriented by the browser; don't double-apply.
      usedAutoOrientation = true;
    }
  }

  const rawWidth = bitmap.width ?? bitmap.naturalWidth;
  const rawHeight = bitmap.height ?? bitmap.naturalHeight;
  const needsManualOrientation = !usedAutoOrientation && orientation !== 1;
  const displayWidth = needsManualOrientation && isSwappedOrientation(orientation) ? rawHeight : rawWidth;
  const displayHeight = needsManualOrientation && isSwappedOrientation(orientation) ? rawWidth : rawHeight;

  const target = computeTargetSize(displayWidth, displayHeight, maxEdge);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(target.width));
  canvas.height = Math.max(1, Math.round(target.height));
  const ctx = canvas.getContext("2d");
  // JPEG has no alpha — force an opaque white backdrop, matching format.opaque = true on iOS.
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (needsManualOrientation) {
    applyOrientationTransform(ctx, orientation, canvas.width, canvas.height);
    const drawW = isSwappedOrientation(orientation) ? canvas.height : canvas.width;
    const drawH = isSwappedOrientation(orientation) ? canvas.width : canvas.height;
    ctx.drawImage(bitmap, 0, 0, drawW, drawH);
  } else {
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  }

  if (typeof bitmap.close === "function") bitmap.close();

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  const dataUrl = canvas.toDataURL("image/jpeg", quality);
  return { blob, dataUrl, width: canvas.width, height: canvas.height };
}

function decodeViaImageElement(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (err) => {
      URL.revokeObjectURL(url);
      reject(err);
    };
    img.src = url;
  });
}

/** Convenience: resize an existing data: URL (e.g. a photo already staged in the store). */
export async function resizeDataUrl(dataUrl, options) {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  return resizeImage(blob, options);
}
