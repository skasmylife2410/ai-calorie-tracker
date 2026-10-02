// crop.js — crop and resize a photo before it's posted or sent in a comment (Shared).
// Drag to move, pinch (or the slider) to zoom, pick a shape: the photo's own, square, 4:5 or
// 16:9. Done returns a new JPEG of just the framed part, at most CROP_EDGE px on its long side
// (social.shrinkPhoto then makes it feed-sized as before).

import { t } from "../i18n.js";
import { openSheet, navBar, wireNavBar } from "./sheet.js";

export const CROP_EDGE = 1440;
export const SHAPES = [
  { key: "original", ratio: null },
  { key: "square", ratio: 1 },
  { key: "portrait", ratio: 4 / 5 },
  { key: "wide", ratio: 16 / 9 },
];
const MAX_ZOOM = 4;

/**
 * The part of the image (in image pixels) that sits inside the frame, given how the image is
 * shown: scale (screen px per image px) and offset of its top-left corner from the frame's.
 * Kept inside the image. Exported for tests.
 */
export function cropRect({ imgW, imgH, frameW, frameH, scale, offX, offY }) {
  const w = Math.min(imgW, frameW / scale);
  const h = Math.min(imgH, frameH / scale);
  const x = Math.max(0, Math.min(imgW - w, -offX / scale));
  const y = Math.max(0, Math.min(imgH - h, -offY / scale));
  return { x, y, w, h };
}

/** Keeps the image covering the frame: no empty edges after a move or zoom. */
export function clampOffset({ imgW, imgH, frameW, frameH, scale, offX, offY }) {
  const dw = imgW * scale, dh = imgH * scale;
  return {
    offX: Math.min(0, Math.max(frameW - dw, offX)),
    offY: Math.min(0, Math.max(frameH - dh, offY)),
  };
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/** @returns {Promise<string|null>} the cropped JPEG data URL, or null when cancelled */
export async function openCropSheet(dataUrl) {
  let img;
  try { img = await loadImage(dataUrl); } catch { return dataUrl; }
  const imgW = img.naturalWidth, imgH = img.naturalHeight;
  if (!imgW || !imgH) return dataUrl;

  return new Promise((resolve) => {
    let result = null;
    openSheet({
      render(panel, close) {
        panel.innerHTML = `
          ${navBar({ title: t("crop.title"), leading: { label: t("app.cancel") }, trailing: { label: t("crop.done"), bold: true } })}
          <div class="sheet-panel-body crop-body">
            <div class="crop-stage" data-no-sheet-drag>
              <img class="crop-img" alt="" draggable="false"><div class="crop-frame"></div>
            </div>
            <label class="crop-zoom"><span aria-hidden="true">−</span>
              <input type="range" min="1" max="${MAX_ZOOM}" step="0.01" value="1" aria-label="${t("crop.zoom")}"><span aria-hidden="true">+</span></label>
            <div class="crop-shapes" role="group" aria-label="${t("crop.shape")}">
              ${SHAPES.map((s, i) => `<button type="button" data-shape="${i}" aria-pressed="${i === 0}">${t(`crop.${s.key}`)}</button>`).join("")}
            </div>
            <p class="crop-hint">${t("crop.hint")}</p>
          </div>`;
        const stage = panel.querySelector(".crop-stage");
        const frame = panel.querySelector(".crop-frame");
        const el = panel.querySelector(".crop-img");
        const slider = panel.querySelector('input[type="range"]');
        el.src = dataUrl;

        let shape = SHAPES[0];
        let frameW = 0, frameH = 0, base = 1, zoom = 1, offX = 0, offY = 0;

        const apply = () => {
          const scale = base * zoom;
          ({ offX, offY } = clampOffset({ imgW, imgH, frameW, frameH, scale, offX, offY }));
          el.style.width = `${imgW * scale}px`;
          el.style.height = `${imgH * scale}px`;
          el.style.transform = `translate(${frame.offsetLeft + offX}px, ${frame.offsetTop + offY}px)`;
          slider.value = String(zoom);
        };
        const layout = () => {
          const room = stage.getBoundingClientRect();
          const maxW = Math.max(100, room.width - 24), maxH = Math.max(100, room.height - 24);
          const ratio = shape.ratio ?? imgW / imgH;
          frameW = Math.min(maxW, maxH * ratio);
          frameH = frameW / ratio;
          frame.style.width = `${frameW}px`;
          frame.style.height = `${frameH}px`;
          frame.style.left = `${(room.width - frameW) / 2}px`;
          frame.style.top = `${(room.height - frameH) / 2}px`;
          base = Math.max(frameW / imgW, frameH / imgH); // cover the frame
          zoom = 1;
          offX = (frameW - imgW * base) / 2;
          offY = (frameH - imgH * base) / 2;
          apply();
        };
        /** Zoom around a point of the frame (px from its top-left), so it stays under the fingers. */
        const zoomTo = (next, cx = frameW / 2, cy = frameH / 2) => {
          const z = Math.min(MAX_ZOOM, Math.max(1, next));
          const k = z / zoom;
          offX = cx - (cx - offX) * k;
          offY = cy - (cy - offY) * k;
          zoom = z;
          apply();
        };

        // one finger moves, two fingers pinch
        const pts = new Map();
        let last = null;
        const centre = () => { const p = [...pts.values()]; return { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2, d: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) }; };
        stage.addEventListener("pointerdown", (e) => {
          stage.setPointerCapture?.(e.pointerId);
          pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
          last = pts.size === 2 ? centre() : { x: e.clientX, y: e.clientY };
        });
        stage.addEventListener("pointermove", (e) => {
          if (!pts.has(e.pointerId)) return;
          pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
          if (pts.size >= 2) {
            const c = centre();
            const r = frame.getBoundingClientRect();
            if (last?.d) zoomTo(zoom * (c.d / last.d), c.x - r.left, c.y - r.top);
            offX += c.x - last.x; offY += c.y - last.y;
            apply();
            last = c;
          } else if (last) {
            offX += e.clientX - last.x; offY += e.clientY - last.y;
            apply();
            last = { x: e.clientX, y: e.clientY };
          }
        });
        const up = (e) => { pts.delete(e.pointerId); last = pts.size === 1 ? { ...[...pts.values()][0] } : pts.size >= 2 ? centre() : null; };
        stage.addEventListener("pointerup", up);
        stage.addEventListener("pointercancel", up);
        stage.addEventListener("wheel", (e) => {
          e.preventDefault();
          const r = frame.getBoundingClientRect();
          zoomTo(zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08), e.clientX - r.left, e.clientY - r.top);
        }, { passive: false });
        slider.addEventListener("input", () => zoomTo(Number(slider.value)));
        panel.querySelectorAll("[data-shape]").forEach((b) => b.addEventListener("click", () => {
          shape = SHAPES[Number(b.dataset.shape)];
          panel.querySelectorAll("[data-shape]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
          layout();
        }));

        wireNavBar(panel, {
          onLeading: () => close(),
          onTrailing: () => {
            const r = cropRect({ imgW, imgH, frameW, frameH, scale: base * zoom, offX, offY });
            const k = Math.min(1, CROP_EDGE / Math.max(r.w, r.h));
            const canvas = document.createElement("canvas");
            canvas.width = Math.max(1, Math.round(r.w * k));
            canvas.height = Math.max(1, Math.round(r.h * k));
            canvas.getContext("2d").drawImage(img, r.x, r.y, r.w, r.h, 0, 0, canvas.width, canvas.height);
            result = canvas.toDataURL("image/jpeg", 0.88);
            close();
          },
        });
        // the sheet slides in; measure once it has its size
        requestAnimationFrame(() => requestAnimationFrame(layout));
        setTimeout(layout, 350);
      },
      onClosed() { resolve(result); },
    });
  });
}
